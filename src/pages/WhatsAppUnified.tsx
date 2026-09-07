import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search,
  Send,
  Bot,
  User,
  Calendar,
  Loader2,
  MessageSquare,
  Check,
  X,
  UserPlus,
  CheckCheck,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sendMsg } from '../lib/uazapi';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { WhatsAppConnection } from '../components/WhatsAppConnection';
import type { Contact, Message, MessageTemplate, AppSettings } from '../types';

type ContactFilter = 'todos' | 'ia' | 'manual' | 'aguarda' | 'vendas';

interface ContactWithLastMsg extends Contact {
  lastMessage?: Message;
  lastAppointment?: { date: string; shift: string; status: string };
  tipo_atendimento_campanha?: string;
}

export function WhatsAppUnified() {
  const [contacts, setContacts] = useState<ContactWithLastMsg[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const [selectedContact, setSelectedContact] = useState<ContactWithLastMsg | null>(null);
  const [contactFilter, setContactFilter] = useState<ContactFilter>('todos');
  const [contactSearch, setContactSearch] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [isManualMode, setIsManualMode] = useState(true);

  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [newContactForm, setNewContactForm] = useState({ name: '', phone: '' });
  const [savingContact, setSavingContact] = useState(false);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: 'Manha',
    location: '',
    status: 'scheduled',
    notes: '',
  });
  const [savingSchedule, setSavingSchedule] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
const messagesContainerRef = useRef<HTMLDivElement>(null);
const shouldAutoScrollRef = useRef(true);
const lastMessageIdRef = useRef<string | null>(null);
  const realtimeConnectedRef = useRef(false);
  const selectedContactRef = useRef<ContactWithLastMsg | null>(null);
  const { toasts, showToast, removeToast } = useToast();

  // Funcao para processar mensagem via IA
  const processWithAI = useCallback(async (contactId: string, messageContent: string) => {
    console.log('[WhatsApp] Chamando IA para contato:', contactId, 'mensagem:', messageContent.substring(0, 50));
    try {
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { contactId, message: messageContent, saveMessage: true }
      });

      if (error) {
        console.error('[WhatsApp] Erro na Edge Function ai-chat:', error);
        return null;
      }

      if (data?.response) {
        console.log('[WhatsApp] Resposta da IA:', data.response.substring(0, 50));
        // Atualiza lista de mensagens
        fetchMessages(contactId);
        fetchContacts(true);
        return data.response;
      }

      if (data?.fallback) {
        console.log('[WhatsApp] Resposta fallback:', data.fallback.substring(0, 50));
        return data.fallback;
      }

      return null;
    } catch (err) {
      console.error('[WhatsApp] Erro ao processar com IA:', err);
      return null;
    }
  }, []);

  // Mantem ref atualizada
  useEffect(() => {
    selectedContactRef.current = selectedContact;
  }, [selectedContact]);

  useEffect(() => {
    fetchContacts();
    fetchTemplates();
    fetchSettings();

    // Listen for contacts sync events
    const handleContactsSynced = () => {
      fetchContacts(true);
    };
    window.addEventListener('contacts-synced', handleContactsSynced);

    return () => {
      window.removeEventListener('contacts-synced', handleContactsSynced);
    };
  }, []);

 useEffect(() => {
    if (selectedContact) {
      shouldAutoScrollRef.current = true;
      lastMessageIdRef.current = null;
      fetchMessages(selectedContact.id);
      setIsManualMode(selectedContact.assigned_to === 'manual');

      // Clear unread_count when opening conversation
      if (selectedContact.unread_count && selectedContact.unread_count > 0) {
        supabase
          .from('contacts')
          .update({ unread_count: 0 })
          .eq('id', selectedContact.id)
          .then(() => {
            setContacts((prev) =>
              prev.map((c) => (c.id === selectedContact.id ? { ...c, unread_count: 0 } : c))
            );
          });
      }
    }
  }, [selectedContact]);

  // Funcao auxiliar para ordenar contatos por ultima mensagem
  const sortContactsByLastMessage = (contactsList: ContactWithLastMsg[]): ContactWithLastMsg[] => {
    const sorted = [...contactsList].sort((a, b) => {
      const aTime = a.lastMessage?.created_at ? new Date(a.lastMessage.created_at).getTime() : 0;
      const bTime = b.lastMessage?.created_at ? new Date(b.lastMessage.created_at).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    // Log para debug
    console.log('[sortContactsByLastMessage] Input:', contactsList.length, 'Output:', sorted.length);
    sorted.slice(0, 3).forEach((c, i) => {
      console.log(`  [${i}] ${c.name} - lastMsg: ${c.lastMessage?.created_at || 'none'}`);
    });
    return sorted;
  };

  // Realtime listener for new messages and status updates
  useEffect(() => {
    console.log('[WhatsApp] Configurando Realtime...');

    const channel = supabase
      .channel('messages-realtime', {
        config: {
          broadcast: { self: true },
        },
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          console.log('[WhatsApp Realtime] ====== INSERT EVENT RECEIVED ======');
          console.log('[WhatsApp Realtime] Payload new:', payload.new);

          // Garantir que todos os campos existam
          const rawData = payload.new as Record<string, unknown>;
          const newMsg: Message = {
            id: String(rawData.id || ''),
            contact_id: String(rawData.contact_id || ''),
            direction: (rawData.direction as 'in' | 'out') || 'in',
            content: String(rawData.content || ''),
            sent_by: String(rawData.sent_by || 'contato'),
            delivered: Boolean(rawData.delivered),
            read: Boolean(rawData.read),
            created_at: String(rawData.created_at || new Date().toISOString()),
            status: (rawData.status as 'sent' | 'delivered' | 'read') || 'sent',
          };

          console.log('[WhatsApp Realtime] Mensagem processada:', newMsg.id, 'contact_id:', newMsg.contact_id, 'direction:', newMsg.direction);

                const currentSelectedContact = selectedContactRef.current;

          // Update messages list if viewing this contact
          if (currentSelectedContact?.id === newMsg.contact_id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) {
                console.log('[WhatsApp Realtime] Mensagem ja existe na lista');
                return prev;
              }
              console.log('[WhatsApp Realtime] Adicionando mensagem ao chat aberto, total:', prev.length + 1);
              return [...prev, newMsg];
            });
          }

          // Update contacts list: update lastMessage and re-sort
          setContacts((prev) => {
            console.log('[WhatsApp Realtime] Processando contato, prev length:', prev.length);
            console.log('[WhatsApp Realtime] newMsg.contact_id:', newMsg.contact_id, 'type:', typeof newMsg.contact_id);

            // Log todos os IDs de contatos para comparar
            prev.slice(0, 5).forEach(c => {
              console.log('[WhatsApp Realtime] Contato na lista:', c.id, c.name, 'type:', typeof c.id);
            });

            const existingContact = prev.find((c) => c.id === newMsg.contact_id);
            if (!existingContact) {
              console.log('[WhatsApp Realtime] Contato NAO ENCONTRADO para contact_id:', newMsg.contact_id);
              // Tenta refresh para buscar novo contato
              fetchContacts(true);
              return prev;
            }

            console.log('[WhatsApp Realtime] Contato ENCONTRADO:', existingContact.name, 'id:', existingContact.id);

            // Cria NOVO array com updated contact
            const updated = prev.map((c) => {
              if (c.id === newMsg.contact_id) {
                const newUnread = newMsg.direction === 'in' && currentSelectedContact?.id !== newMsg.contact_id
                  ? (c.unread_count || 0) + 1
                  : c.unread_count;
                console.log('[WhatsApp Realtime] Atualizando contato:', c.name, 'unread:', newUnread, 'msg time:', newMsg.created_at);
                // Retorna NOVO objeto para garantir mudanca de referencia
                return { ...c, lastMessage: newMsg, unread_count: newUnread };
              }
              return c;
            });

            // Re-sort - isso cria um novo array
            const sorted = sortContactsByLastMessage(updated);

            // Forca NOVA referencia do array para garantir re-render
            const sortedNewRef = [...sorted];

            console.log('[WhatsApp Realtime] Lista reordenada, len:', sortedNewRef.length);
            console.log('[WhatsApp Realtime] Primeiro:', sortedNewRef[0]?.name, 'lastMsg:', sortedNewRef[0]?.lastMessage?.created_at);
            console.log('[WhatsApp Realtime] Segundo:', sortedNewRef[1]?.name, 'lastMsg:', sortedNewRef[1]?.lastMessage?.created_at);
            return sortedNewRef;
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const updatedMsg = payload.new as Message;
          console.log('[WhatsApp Realtime] Status de mensagem atualizado:', updatedMsg.status);

          // Update message status in messages list
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMsg.id ? { ...m, status: updatedMsg.status } : m))
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contacts',
        },
        (payload) => {
          const updatedContact = payload.new as Contact;
          console.log('[WhatsApp Realtime] Contato atualizado:', updatedContact.id);
          setContacts((prev) => {
            const updated = prev.map((c) =>
              c.id === updatedContact.id ? { ...c, ...updatedContact } : c
            );
            return sortContactsByLastMessage(updated);
          });
        }
      )
      .subscribe((status) => {
        console.log('[WhatsApp Realtime] Status da conexao:', status);
        if (status === 'SUBSCRIBED') {
          console.log('[WhatsApp Realtime] Conectado com sucesso! Aguardando eventos...');
          realtimeConnectedRef.current = true;
          setRealtimeConnected(true);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.error('[WhatsApp Realtime] Erro na conexao:', status);
          realtimeConnectedRef.current = false;
          setRealtimeConnected(false);
        }
      });

    // Polling de backup - SEMPRE ativo a cada 5 segundos como garantia
    // O Realtime e instavel em alguns casos, entao polling garante funcionamento
    const pollInterval = setInterval(() => {
      console.log('[WhatsApp Polling] Atualizando...');
      fetchContacts(true);
      const currentSelected = selectedContactRef.current;
      if (currentSelected) {
        fetchMessages(currentSelected.id, true);
      }
    }, 5000); // 5 segundos - garante atualizacao mesmo se realtime falhar

    return () => {
      console.log('[WhatsApp Realtime] Desconectando...');
      realtimeConnectedRef.current = false;
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, []); // Removido selectedContact da dependencia - agora usa ref

 useEffect(() => {
  if (messages.length === 0) return;
  const lastMsg = messages[messages.length - 1];
  const isNewMessage = lastMsg.id !== lastMessageIdRef.current;
  lastMessageIdRef.current = lastMsg.id;

  if (isNewMessage && shouldAutoScrollRef.current) {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
}, [messages]);

const fetchContacts = async (silent = false) => {
  if (!silent) setIsInitialLoading(true);
  try {
    const { data: contactsData, error } = await supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && contactsData) {
      const contactIds = contactsData.map((c) => c.id);

      const { data: allMessages } = await supabase
        .from('messages')
        .select('*')
        .in('contact_id', contactIds)
        .order('created_at', { ascending: false });

      const { data: allAppointments } = await supabase
        .from('appointments')
        .select('contact_id, date, shift, status')
        .in('contact_id', contactIds)
        .order('created_at', { ascending: false });

      const lastMsgByContact = new Map<string, Message>();
      (allMessages || []).forEach((m) => {
        if (!lastMsgByContact.has(m.contact_id)) lastMsgByContact.set(m.contact_id, m as Message);
      });

      const lastAptByContact = new Map<string, { date: string; shift: string; status: string }>();
      (allAppointments || []).forEach((a) => {
        if (!lastAptByContact.has(a.contact_id)) lastAptByContact.set(a.contact_id, a);
      });

      // Busca dados de contrato e curso na tabela contatos_campanha pelo telefone
      const contactPhones = (contactsData as Contact[]).map((c) => c.phone);
      const { data: campanhaContatos } = await supabase
        .from('contatos_campanha')
        .select('telefone, numero_contrato, curso, campanhas(tipo_atendimento)')
        .in('telefone', contactPhones);

      const campanhaByPhone = new Map<string, { numero_contrato: string | null; curso: string | null; tipo_atendimento?: string }>();
      (campanhaContatos || []).forEach((cc: any) => {
        campanhaByPhone.set(cc.telefone, {
          numero_contrato: cc.numero_contrato,
          curso: cc.curso,
          tipo_atendimento: cc.campanhas?.tipo_atendimento,
        });
      });

      const contactsWithMsgs = (contactsData as Contact[]).map((contact) => {
        const campanhaData = campanhaByPhone.get(contact.phone);
        return {
          ...contact,
          contract_number: contact.contract_number || campanhaData?.numero_contrato || undefined,
          course: contact.course || campanhaData?.curso || undefined,
          tipo_atendimento_campanha: campanhaData?.tipo_atendimento,
          lastMessage: lastMsgByContact.get(contact.id),
          lastAppointment: lastAptByContact.get(contact.id),
        };
      });

      const sorted = sortContactsByLastMessage(contactsWithMsgs);
      setContacts(sorted);
      console.log('[fetchContacts] Carregados', sorted.length, 'contatos');
    }
  } catch (err) {
    console.error('[fetchContacts] Erro:', err);
  }
  if (!silent) setIsInitialLoading(false);
};

  const fetchMessages = async (contactId: string, silent = false) => {
    if (!silent) setIsLoadingMessages(true);
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .order('seq', { ascending: true });
    if (!error && data) setMessages(data as Message[]);
    if (!silent) setIsLoadingMessages(false);
  };

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from('message_templates')
      .select('*')
      .eq('status', 'approved')
      .order('name');
    if (data) setTemplates(data as MessageTemplate[]);
  };

  const fetchSettings = async () => {
    const { data } = await supabase.from('settings').select('*');
    if (data) {
      const settingsMap: Record<string, string> = {};
      data.forEach((s) => {
        settingsMap[s.key] = s.value;
      });
      setSettings({
        min_delay_seconds: parseInt(settingsMap.min_delay_seconds || '2'),
        max_delay_seconds: parseInt(settingsMap.max_delay_seconds || '8'),
        batch_size: parseInt(settingsMap.batch_size || '50'),
        batch_pause_minutes: parseInt(settingsMap.batch_pause_minutes || '5'),
        whatsapp_connected: settingsMap.whatsapp_connected === 'true',
        ai_enabled: settingsMap.ai_enabled === 'true',
        nome_agente: settingsMap.nome_agente || 'Sofia',
        responder_automaticamente: settingsMap.responder_automaticamente === 'true',
        usar_base_conhecimento: settingsMap.usar_base_conhecimento === 'true',
        permitir_agendar: settingsMap.permitir_agendar === 'true',
        system_prompt_base: settingsMap.system_prompt_base || '',
      });
    }
  };

  const normalizePhone = (phone: string): string => {
  let digits = phone.replace(/\D/g, '');

  // Remove o codigo do pais se ja existir, para padronizar o processamento
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }

  // Numero de celular BR com DDD: 11 digitos (DDD + 9 + numero)
  // Se vier com 10 digitos (sem o 9), adiciona o 9
  if (digits.length === 10) {
    digits = digits.slice(0, 2) + '9' + digits.slice(2);
  }

  return '55' + digits;
};

  const handleCreateContact = async () => {
    if (!newContactForm.name.trim() || !newContactForm.phone.trim()) {
      showToast('Preencha nome e telefone', 'error');
      return;
    }

    setSavingContact(true);
    const phoneNormalized = normalizePhone(newContactForm.phone);

    // Verifica se ja existe contato com esse telefone
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', phoneNormalized)
      .maybeSingle();

    if (existing) {
      showToast('Ja existe um contato com esse telefone', 'error');
      setSavingContact(false);
      return;
    }

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        name: newContactForm.name.trim(),
        phone: phoneNormalized,
        status: 'lead',
        assigned_to: 'manual',
      })
      .select()
      .single();

    if (error) {
      showToast('Erro ao criar contato: ' + error.message, 'error');
    } else {
      showToast('Contato criado com sucesso!', 'success');
      setShowNewContactModal(false);
      setNewContactForm({ name: '', phone: '' });
      await fetchContacts(true);
      if (created) setSelectedContact({ ...created, lastMessage: undefined });
    }
    setSavingContact(false);
  };

  // useMemo garante recalcular quando contacts mudar
  const filteredContacts = useMemo(() => {
    console.log('[filteredContacts] Recalculando, total contacts:', contacts.length);
    const filtered = contacts.filter((c) => {
      const matchesFilter =
        contactFilter === 'todos' ||
        (contactFilter === 'ia' && c.assigned_to === 'ia') ||
        (contactFilter === 'manual' && c.assigned_to === 'manual') ||
        (contactFilter === 'aguarda' && c.status === 'lead') ||
        (contactFilter === 'vendas' && c.tipo_atendimento_campanha === 'venda_material');

    const matchesSearch =
  !contactSearch || (c.name || '').toLowerCase().includes(contactSearch.toLowerCase());

      return matchesFilter && matchesSearch;
    });
    console.log('[filteredContacts] Filtrados:', filtered.length, 'Primeiro:', filtered[0]?.name);
    return filtered;
  }, [contacts, contactFilter, contactSearch]);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedContact) return;

    const sentBy = isManualMode ? 'manual' : 'ia';
    const textToSend = messageInput;

    try {
      // Envia de verdade pelo WhatsApp via uazapiGO ANTES de gravar como enviada
      await sendMsg(selectedContact.phone, textToSend);

      const { error } = await supabase.from('messages').insert({
        contact_id: selectedContact.id,
        direction: 'out',
        content: textToSend,
        sent_by: sentBy,
        delivered: true,
        read: false,
      });

      if (!error) {
        setMessageInput('');
        setMessageInput('');
shouldAutoScrollRef.current = true;
fetchMessages(selectedContact.id);
        fetchMessages(selectedContact.id);
        fetchContacts(true);
        showToast('Mensagem enviada', 'success');
      } else {
        showToast('Enviado no WhatsApp, mas erro ao salvar no banco', 'error');
      }
    } catch (err) {
      // sendMsg falhou - NAO grava como enviada, mostra o erro real
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      showToast(`Erro ao enviar: ${msg}`, 'error');
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm('Excluir esta mensagem?')) return;
    const { error } = await supabase.from('messages').delete().eq('id', messageId);
    if (error) {
      showToast('Erro ao excluir mensagem', 'error');
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    showToast('Mensagem excluida', 'success');
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('Excluir este contato e todas as suas mensagens?')) return;
    await supabase.from('messages').delete().eq('contact_id', contactId);
    const { error } = await supabase.from('contacts').delete().eq('id', contactId);
    if (error) {
      showToast('Erro ao excluir contato', 'error');
      return;
    }
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    if (selectedContact?.id === contactId) setSelectedContact(null);
    showToast('Contato excluido', 'success');
  };

  const handleAssignTo = async (assignTo: 'ia' | 'manual') => {
    if (!selectedContact) return;

    const { error } = await supabase
      .from('contacts')
      .update({ assigned_to: assignTo })
      .eq('id', selectedContact.id);

    if (!error) {
      const updated = { ...selectedContact, assigned_to: assignTo };
      setSelectedContact(updated);
      setContacts((prev) =>
        prev.map((c) => (c.id === selectedContact.id ? updated : c))
      );
      setIsManualMode(assignTo === 'manual');
      showToast(`Contato atribuido para ${assignTo === 'ia' ? 'IA' : 'Manual'}`, 'success');
    }
  };

  const handleSaveSettings = async () => {
    const updates = [
      { key: 'min_delay_seconds', value: tempSettings.min_delay_seconds.toString() },
      { key: 'max_delay_seconds', value: tempSettings.max_delay_seconds.toString() },
      { key: 'batch_size', value: tempSettings.batch_size.toString() },
      { key: 'batch_pause_minutes', value: tempSettings.batch_pause_minutes.toString() },
    ];

    for (const update of updates) {
      await supabase.from('settings').update({ value: update.value }).eq('key', update.key);
    }

    await fetchSettings();
    setEditingSettings(false);
    showToast('Configuracoes salvas!', 'success');
  };

  const handleToggleFlow = async (flow: AIFlow) => {
    const { error } = await supabase
      .from('ai_flows')
      .update({ active: !flow.active })
      .eq('id', flow.id);

    if (!error) {
      setAiFlows((prev) =>
        prev.map((f) => (f.id === flow.id ? { ...f, active: !f.active } : f))
      );
    }
  };

  const useTemplate = (template: MessageTemplate) => {
    let content = template.content;
    if (selectedContact) {
      content = content.replace(/\{\{nome\}\}/g, (selectedContact.name || '').split(' ')[0]);
      content = content.replace(/\{\{curso\}\}/g, selectedContact.course || '');
    }
    setMessageInput(content);
  };

  const formatPhoneDisplay = (phone: string): string => {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };

  const getInitials = (name: string | null | undefined) => {
    const safeName = name || '?';
    return safeName
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0] || '')
      .join('')
      .toUpperCase();
  };

  const getAssignmentBadge = (assignedTo: string) => {
    switch (assignedTo) {
      case 'ia':
        return { bg: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6', label: 'IA' };
      case 'manual':
        return { bg: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6', label: 'Manual' };
      default:
        return { bg: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', label: 'Aguarda' };
    }
  };

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return time;
  }

  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${day} · ${time}`;
};

  const formatDateLabel = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === now.toDateString()) return 'Hoje';
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  type ChatItem =
    | { type: 'divider'; key: string; label: string }
    | { type: 'message'; key: string; msg: Message };

  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = [];
    let lastDateKey = '';
    for (const msg of messages) {
      const dateKey = new Date(msg.created_at).toDateString();
      if (dateKey !== lastDateKey) {
        items.push({ type: 'divider', key: `divider-${dateKey}`, label: formatDateLabel(msg.created_at) });
        lastDateKey = dateKey;
      }
      items.push({ type: 'message', key: msg.id, msg });
    }
    return items;
  }, [messages]);

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin mx-auto mb-4" style={{ color: 'var(--accent-primary)' }} />
          <p style={{ color: 'var(--text-muted)' }}>Carregando contatos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WhatsAppConnection />

      <div className="h-[600px]">
        <div
          className="flex h-full rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
        >
          {/* Column 1: Contacts */}
          <div
            className="flex flex-col"
            style={{ width: '260px', backgroundColor: 'var(--bg-surface)', borderRight: '1px solid var(--border-subtle)' }}
          >
            <div className="p-3 space-y-2">
              <div className="flex gap-1 items-center">
                {(['todos', 'ia', 'manual', 'aguarda', 'vendas'] as ContactFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setContactFilter(f)}
                    className="flex-1 py-1.5 text-xs font-medium rounded-md transition-colors"
                    style={{
                      backgroundColor: contactFilter === f ? 'var(--bg-surface-raised)' : 'transparent',
                      color: contactFilter === f ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
                <button
                  onClick={() => setShowNewContactModal(true)}
                  title="Novo contato"
                  className="btn-icon flex-shrink-0"
                  style={{ padding: '6px', color: 'var(--accent-primary)' }}
                >
                  <UserPlus size={14} />
                </button>
              </div>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                />
                <input
                  type="text"
                  placeholder="Buscar contato..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="input-dark w-full pl-9"
                  style={{ fontSize: '12px', padding: '8px 10px 8px 34px' }}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredContacts.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Nenhum contato encontrado
                  </p>
                </div>
              ) : (
                filteredContacts.map((contact) => {
                  const badge = getAssignmentBadge(contact.assigned_to);
                  const hasUnread = (contact.unread_count || 0) > 0;
                  return (
                    <div
                      key={contact.id}
                      onClick={() => setSelectedContact(contact)}
                      className="group w-full p-3 text-left transition-colors cursor-pointer hover:bg-[var(--bg-surface-raised)]"
                      style={{
                        backgroundColor:
                          selectedContact?.id === contact.id ? 'var(--bg-surface-raised)' : 'transparent',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                            style={{
                              backgroundColor: `hsl(${((contact.name || '?').charCodeAt(0) % 36) * 10}, 60%, 50%)`,
                              color: 'white',
                            }}
                          >
                            {getInitials(contact.name)}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="text-sm truncate"
                              style={{
                                color: 'var(--text-primary)',
                                fontWeight: hasUnread ? 600 : 500,
                              }}
                            >
                              {contact.name || 'Sem nome'}
                            </span>
                            {contact.lastAppointment && (
                              <span className="flex items-center gap-0.5 flex-shrink-0" style={{ fontSize: '9px', color: '#22C55E' }}>
                                <CheckCircle2 size={12} style={{ color: '#22C55E' }} />
                                {(() => {
                                  const parts = contact.lastAppointment!.date.split('-');
                                  const dataFmt = parts.length === 3 ? `${parts[2]}/${parts[1]}` : contact.lastAppointment!.date;
                                  const shiftCap = contact.lastAppointment!.shift.charAt(0).toUpperCase() + contact.lastAppointment!.shift.slice(1);
                                  return `${dataFmt} · ${shiftCap}`;
                                })()}
                              </span>
                            )}
                            <div className="flex items-center gap-2">
                              {hasUnread && (
                                <span
                                  className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-semibold"
                                  style={{
                                    backgroundColor: '#25D366',
                                    color: 'white',
                                  }}
                                >
                                  {contact.unread_count}
                                </span>
                              )}
                              <span
                                className="badge flex-shrink-0"
                                style={{
                                  backgroundColor: badge.bg,
                                  color: badge.color,
                                  fontSize: '9px',
                                  padding: '2px 6px',
                                }}
                              >
                                {badge.label}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteContact(contact.id); }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                style={{ padding: '2px' }}
                              >
                                <Trash2 size={14} style={{ color: '#EF4444' }} />
                              </button>
                            </div>
                          </div>
                          <p
                            className="text-xs truncate mt-0.5"
                            style={{
                              color: hasUnread ? 'var(--text-primary)' : 'var(--text-muted)',
                              fontWeight: hasUnread ? 500 : 400,
                            }}
                          >
                            {contact.lastMessage?.content || 'Nenhuma mensagem'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 2: Chat */}
          <div
            className="flex-1 flex flex-col"
            style={{ backgroundColor: 'var(--bg-primary)', minWidth: 0 }}
          >
            {selectedContact ? (
              <>
                <div
                  className="p-4 flex items-center justify-between"
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold"
                      style={{
                        backgroundColor: `hsl(${((selectedContact.name || '?').charCodeAt(0) % 36) * 10}, 60%, 50%)`,
                        color: 'white',
                      }}
                    >
                      {getInitials(selectedContact.name)}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedContact.name || 'Sem nome'}
                      </h3>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span>{formatPhoneDisplay(selectedContact.phone)}</span>
                      </div>
                      {(selectedContact.contract_number || selectedContact.course) && (
                        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {selectedContact.contract_number && (
                            <span>Contrato: {selectedContact.contract_number}</span>
                          )}
                          {selectedContact.contract_number && selectedContact.course && <span>-</span>}
                          {selectedContact.course && (
                            <span>{selectedContact.course}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAssignTo('manual')}
                      className="btn-secondary"
                      style={{ padding: '6px 10px', fontSize: '11px' }}
                    >
                      <User size={12} />
                      Assumir
                    </button>
                    <button
                      onClick={() => handleAssignTo('ia')}
                      className="btn-secondary"
                      style={{ padding: '6px 10px', fontSize: '11px' }}
                    >
                      <Bot size={12} />
                      Para IA
                    </button>
                    <button
                      onClick={() => setShowScheduleModal(true)}
                      className="btn-primary"
                      style={{ padding: '6px 10px', fontSize: '11px' }}
                    >
                      <Calendar size={12} />
                      Agendar
                    </button>
                  </div>
                </div>

                <div
  ref={messagesContainerRef}
  onScroll={() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 100;
  }}
  className="flex-1 overflow-y-auto p-4 space-y-3"
>
                  {isLoadingMessages ? (
                    <div className="text-center py-8">
                      <Loader2 size={20} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-8">
                      <MessageSquare size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Nenhuma mensagem ainda
                      </p>
                    </div>
                  ) : (
                    chatItems.map((item) => {
                      if (item.type === 'divider') {
                        return (
                          <div key={item.key} className="flex justify-center my-3">
                            <span
                              className="px-3 py-1 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor: 'var(--bg-surface-raised)',
                                color: 'var(--text-muted)',
                                border: '1px solid var(--border-subtle)',
                              }}
                            >
                              {item.label}
                            </span>
                          </div>
                        );
                      }

                      const { msg } = item;
                      const isReceived = msg.direction === 'in';
                      const isAI = msg.sent_by === 'ia';
                      const msgStatus = msg.status || 'sent';

                      // Render checkmarks based on status
                      const renderCheckmarks = () => {
                        if (isReceived) return null;

                        if (msgStatus === 'read') {
                          return <CheckCheck size={14} style={{ color: '#34B7F1' }} />;
                        } else if (msgStatus === 'delivered') {
                          return <CheckCheck size={14} style={{ color: 'var(--text-muted)' }} />;
                        } else {
                          return <Check size={14} style={{ color: 'var(--text-muted)' }} />;
                        }
                      };

                      return (
                        <div
                          key={item.key}
                          className={`group flex items-center gap-2 ${isReceived ? 'justify-start' : 'justify-end'}`}
                        >
                          {isReceived && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              style={{ padding: '2px' }}
                            >
                              <Trash2 size={12} style={{ color: 'var(--text-muted)' }} />
                            </button>
                          )}
                          <div
                            className="max-w-[70%] p-3 rounded-lg text-sm"
                            style={{
                              backgroundColor: isReceived
                                ? 'var(--bg-surface)'
                                : isAI
                                  ? 'rgba(139, 92, 246, 0.2)'
                                  : 'rgba(59, 130, 246, 0.2)',
                              border: isReceived ? '1px solid var(--border-subtle)' : 'none',
                            }}
                          >
                            {!isReceived && (
                              <div className="flex items-center gap-1 mb-1">
                                <span
                                  className="text-[10px] font-medium"
                                  style={{ color: isAI ? '#8B5CF6' : '#3B82F6' }}
                                >
                                  {isAI ? 'IA' : 'Voce'}
                                </span>
                              </div>
                            )}
                            <p style={{ color: 'var(--text-primary)' }}>{msg.content}</p>
                            <div className="flex items-center justify-end gap-1 mt-1">
                              <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                {formatTime(msg.created_at)}
                              </span>
                              {renderCheckmarks()}
                            </div>
                          </div>
                          {!isReceived && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              style={{ padding: '2px' }}
                            >
                              <Trash2 size={12} style={{ color: 'var(--text-muted)' }} />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div
                  className="p-3"
                  style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={() => setIsManualMode(false)}
                      className="badge"
                      style={{
                        backgroundColor: !isManualMode ? 'rgba(139, 92, 246, 0.15)' : 'var(--bg-surface-raised)',
                        color: !isManualMode ? '#8B5CF6' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      <Bot size={12} />
                      IA
                    </button>
                    <button
                      onClick={() => setIsManualMode(true)}
                      className="badge"
                      style={{
                        backgroundColor: isManualMode ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-surface-raised)',
                        color: isManualMode ? '#3B82F6' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      <User size={12} />
                      Manual
                    </button>
                  </div>
                  <div className="flex items-end gap-2">
                    <textarea
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder={
                        isManualMode ? 'Digite sua mensagem...' : 'Mensagem que a IA vai enviar...'
                      }
                      className="input-dark flex-1 resize-none"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!messageInput.trim()}
                      className="btn-primary"
                      style={{
                        padding: '10px 16px',
                        backgroundColor: isManualMode ? 'var(--accent-primary)' : '#8B5CF6',
                      }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageSquare size={48} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Selecione um contato para iniciar
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Novo Contato */}
      {showNewContactModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewContactModal(false); }}
        >
          <div
            className="w-full max-w-sm rounded-xl p-6 space-y-5"
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)' }}
                >
                  <UserPlus size={16} style={{ color: 'var(--accent-primary)' }} />
                </div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Novo contato
                </h3>
              </div>
              <button
                onClick={() => setShowNewContactModal(false)}
                className="btn-icon"
                style={{ padding: '4px' }}
              >
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                  Nome completo
                </label>
                <input
                  type="text"
                  placeholder="Ex: Joao Silva"
                  value={newContactForm.name}
                  onChange={(e) => setNewContactForm({ ...newContactForm, name: e.target.value })}
                  className="input-dark w-full"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                  Telefone (com DDD)
                </label>
                <div className="flex gap-2">
                  <span
                    className="flex items-center px-3 rounded-lg text-sm font-medium flex-shrink-0"
                    style={{
                      backgroundColor: 'var(--bg-surface-raised)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    BR +55
                  </span>
                  <input
                    type="tel"
                    placeholder="(47) 99999-9999"
                    value={newContactForm.phone}
                    onChange={(e) => setNewContactForm({ ...newContactForm, phone: e.target.value })}
                    className="input-dark flex-1"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateContact(); }}
                  />
                </div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  O codigo do pais 55 sera adicionado automaticamente
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowNewContactModal(false)}
                className="btn-secondary flex-1"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateContact}
                disabled={savingContact || !newContactForm.name.trim() || !newContactForm.phone.trim()}
                className="btn-primary flex-1"
              >
                {savingContact ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                {savingContact ? 'Salvando...' : 'Criar contato'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Agendamento Manual */}
      {showScheduleModal && selectedContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowScheduleModal(false); }}
        >
          <div
            className="w-full max-w-md rounded-xl p-6 space-y-5"
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)' }}
                >
                  <Calendar size={16} style={{ color: '#22C55E' }} />
                </div>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Novo Agendamento
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {selectedContact.name || 'Sem nome'} - {formatPhoneDisplay(selectedContact.phone)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="btn-icon"
                style={{ padding: '4px' }}
              >
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!scheduleForm.date) {
                  showToast('Informe a data', 'error');
                  return;
                }
                setSavingSchedule(true);
                const { error: aptError } = await supabase.from('appointments').insert({
                  contact_id: selectedContact.id,
                  graduand_name: selectedContact.name || 'Sem nome',
                  contract_number: selectedContact.contract_number || null,
                  course: selectedContact.course || null,
                  date: scheduleForm.date,
                  shift: scheduleForm.shift,
                  location: scheduleForm.location || null,
                  status: scheduleForm.status,
                  notes: scheduleForm.notes || null,
                  seller_name: 'Manual',
                });
                setSavingSchedule(false);
                if (aptError) {
                  showToast('Erro ao criar agendamento: ' + aptError.message, 'error');
                } else {
                  showToast('Agendamento criado com sucesso!', 'success');
                  setShowScheduleModal(false);
                  setScheduleForm({
                    date: new Date().toISOString().split('T')[0],
                    shift: 'Manha',
                    location: '',
                    status: 'scheduled',
                    notes: '',
                  });
                  fetchContacts(true);
                }
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                    Data *
                  </label>
                  <input
                    type="date"
                    value={scheduleForm.date}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                    className="input-dark w-full"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                    Turno / Horario
                  </label>
                  <select
                    value={scheduleForm.shift}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, shift: e.target.value })}
                    className="input-dark w-full"
                  >
                    <option value="Manha">Manha</option>
                    <option value="Tarde">Tarde</option>
                    <option value="Noite">Noite</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                  Local
                </label>
                <input
                  type="text"
                  value={scheduleForm.location}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, location: e.target.value })}
                  className="input-dark w-full"
                  placeholder="Ex: Sao Paulo, Rio de Janeiro..."
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                  Status
                </label>
                <select
                  value={scheduleForm.status}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, status: e.target.value })}
                  className="input-dark w-full"
                >
                  <option value="scheduled">Agendado</option>
                  <option value="confirmed">Confirmado</option>
                  <option value="completed">Concluido</option>
                  <option value="cancelled">Cancelado</option>
                  <option value="Em negociacao">Em Negociacao</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                  Observacoes
                </label>
                <textarea
                  value={scheduleForm.notes}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })}
                  className="input-dark w-full resize-none"
                  rows={2}
                  placeholder="Opcional..."
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingSchedule}
                  className="btn-primary flex-1"
                >
                  {savingSchedule ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {savingSchedule ? 'Salvando...' : 'Agendar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
