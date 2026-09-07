import { useState, useEffect } from 'react';
import {
  Bot,
  Send,
  Play,
  Loader2,
  FileText,
  Eye,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { processMessage } from '../lib/aiProcessor';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import type { Contact, KnowledgeBaseItem } from '../types';

interface PromptPreview {
  systemPrompt: string;
  conversationContext: string;
  incomingText: string;
  fullPrompt: string;
}

export function AITester() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    response?: string;
    error?: string;
  } | null>(null);
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeBaseItem[]>([]);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [settings, setSettings] = useState({
    nome_agente: 'Sofia',
    responder_automaticamente: true,
    usar_base_conhecimento: true,
    permitir_agendar: true,
  });

  const { toasts, showToast, removeToast } = useToast();

  useEffect(() => {
    fetchContacts();
    fetchKnowledge();
    fetchSettings();
  }, []);

  const fetchContacts = async () => {
    const { data } = await supabase.from('contacts').select('*').order('name');
    if (data) setContacts(data as Contact[]);
  };

  const fetchKnowledge = async () => {
    const { data } = await supabase
      .from('knowledge_base')
      .select('*')
      .eq('active', true)
      .order('category');
    if (data) setKnowledgeItems(data as KnowledgeBaseItem[]);
  };

  const fetchSettings = async () => {
    const { data } = await supabase.from('settings').select('key, value');
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((s) => {
        map[s.key] = s.value;
      });
      setSettings({
        nome_agente: map.nome_agente || 'Sofia',
        responder_automaticamente: map.responder_automaticamente === 'true',
        usar_base_conhecimento: map.usar_base_conhecimento === 'true',
        permitir_agendar: map.permitir_agendar === 'true',
      });
    }
  };

  const handleTest = async () => {
    if (!selectedContact || !testMessage.trim()) {
      showToast('Selecione um contato e digite uma mensagem', 'error');
      return;
    }

    setIsLoading(true);
    setResult(null);
    setPromptPreview(null);

    try {
      // First, let's build the prompt preview manually
      const promptPreview = await buildPromptPreview(selectedContact, testMessage);
      setPromptPreview(promptPreview);

      // Then process the message
      const result = await processMessage(selectedContact.id, testMessage);
      setResult(result);

      if (result.success) {
        showToast('Resposta gerada com sucesso!', 'success');
      } else {
        showToast(result.error || 'Erro ao processar', 'error');
      }
    } catch (error) {
      showToast('Erro ao processar mensagem', 'error');
      setResult({ success: false, error: String(error) });
    }

    setIsLoading(false);
  };

  const buildPromptPreview = async (
    contact: Contact,
    incomingText: string
  ): Promise<PromptPreview> => {
    // Build system prompt
    let systemPrompt = settings.nome_agente
      ? `Voce e ${settings.nome_agente}, assistente da Stylus Formaturas. Agende apresentacoes fotograficas com graduandos. Tom simpatico e objetivo. Confirme nome, curso e horario. Use apenas informacoes da base de conhecimento para precos e condicoes.`
      : 'Voce e um assistente da Stylus Formaturas.';

    // Add contact context
    systemPrompt += '\n\nContexto do contato:';
    systemPrompt += `\n- Nome: ${contact.name}`;
    if (contact.course) systemPrompt += `\n- Curso: ${contact.course}`;
    if (contact.shift) systemPrompt += `\n- Turno: ${contact.shift}`;
    systemPrompt += `\n- Status: ${contact.status}`;

    // Add knowledge base if enabled
    if (settings.usar_base_conhecimento && knowledgeItems.length > 0) {
      systemPrompt += '\n\nBase de Conhecimento:';
      knowledgeItems.forEach((item) => {
        systemPrompt += `\n[${item.category}] P: "${item.question}" R: "${item.answer}"`;
      });
    }

    // Fetch recent messages
    const { data: messagesData } = await supabase
      .from('messages')
      .select('*')
      .eq('contact_id', contact.id)
      .order('created_at', { ascending: false })
      .limit(10);

    let conversationContext = 'Historico de conversa:';
    if (messagesData && messagesData.length > 0) {
      messagesData.reverse().forEach((msg) => {
        const sender = msg.direction === 'in' ? 'Contato' : 'IA';
        conversationContext += `\n${sender}: ${msg.content}`;
      });
    } else {
      conversationContext += ' (nenhuma mensagem anterior)';
    }

    const fullPrompt = `${systemPrompt}\n\n${conversationContext}\n\nMensagem recebida: "${incomingText}"\n\nSua resposta:`;

    return {
      systemPrompt,
      conversationContext,
      incomingText,
      fullPrompt,
    };
  };

  const quickTests = [
    { label: 'Preco do pacote', message: 'Qual o valor do pacote?' },
    { label: 'Agendar', message: 'Quero agendar minha apresentacao' },
    { label: 'O que inclui', message: 'O que vem no pacote?' },
    { label: 'Como funciona', message: 'Como funciona o processo?' },
  ];

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)' }}
          >
            <Bot size={20} style={{ color: '#8B5CF6' }} />
          </div>
          <div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Testador de IA
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Simule mensagens e veja como a IA responde
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Contact Selection */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              Contato
            </label>
            <select
              value={selectedContact?.id || ''}
              onChange={(e) => {
                const contact = contacts.find((c) => c.id === e.target.value);
                setSelectedContact(contact || null);
              }}
              className="input-dark w-full"
            >
              <option value="">Selecione um contato</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name} - {contact.course || 'Sem curso'}
                </option>
              ))}
            </select>
          </div>

          {/* Selected Contact Info */}
          {selectedContact && (
            <div
              className="p-3 rounded-lg"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Nome:</span>{' '}
                  <span style={{ color: 'var(--text-primary)' }}>{selectedContact.name}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Curso:</span>{' '}
                  <span style={{ color: 'var(--text-primary)' }}>
                    {selectedContact.course || '-'}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Turno:</span>{' '}
                  <span style={{ color: 'var(--text-primary)' }}>
                    {selectedContact.shift || '-'}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Status:</span>{' '}
                  <span style={{ color: 'var(--text-primary)' }}>{selectedContact.status}</span>
                </div>
              </div>
            </div>
          )}

          {/* Quick Test Buttons */}
          <div>
            <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              Testes Rapidos
            </label>
            <div className="flex flex-wrap gap-2">
              {quickTests.map((test) => (
                <button
                  key={test.label}
                  onClick={() => setTestMessage(test.message)}
                  className="badge badge-neutral cursor-pointer hover:bg-[var(--bg-surface-raised)] transition-colors"
                >
                  {test.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message Input */}
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              Mensagem do Contato
            </label>
            <textarea
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              className="input-dark w-full resize-none"
              rows={3}
              placeholder="Ex: Qual o valor do pacote?"
            />
          </div>

          {/* Test Button */}
          <button
            onClick={handleTest}
            disabled={isLoading || !selectedContact || !testMessage.trim()}
            className="btn-primary w-full justify-center"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Processando...</span>
              </>
            ) : (
              <>
                <Play size={16} />
                <span>Testar Resposta IA</span>
              </>
            )}
          </button>

          {/* Settings Info */}
          <div
            className="p-3 rounded-lg text-xs"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Configuracoes Atuais:
            </p>
            <div className="grid grid-cols-2 gap-1">
              <span style={{ color: 'var(--text-muted)' }}>Agente:</span>
              <span style={{ color: 'var(--text-primary)' }}>{settings.nome_agente}</span>
              <span style={{ color: 'var(--text-muted)' }}>Auto-resposta:</span>
              <span style={{ color: settings.responder_automaticamente ? 'var(--success)' : 'var(--error)' }}>
                {settings.responder_automaticamente ? 'Ativo' : 'Inativo'}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>Base conhecimento:</span>
              <span style={{ color: settings.usar_base_conhecimento ? 'var(--success)' : 'var(--error)' }}>
                {settings.usar_base_conhecimento ? `${knowledgeItems.length} itens` : 'Desativado'}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>Permite agendar:</span>
              <span style={{ color: settings.permitir_agendar ? 'var(--success)' : 'var(--error)' }}>
                {settings.permitir_agendar ? 'Sim' : 'Nao'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge Base Preview */}
      <div className="card">
        <button
          onClick={() => setShowKnowledge(!showKnowledge)}
          className="flex items-center justify-between w-full"
        >
          <div className="flex items-center gap-2">
            <FileText size={16} style={{ color: 'var(--accent-primary)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Base de Conhecimento ({knowledgeItems.length} itens)
            </span>
          </div>
          {showKnowledge ? (
            <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
          ) : (
            <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
          )}
        </button>

        {showKnowledge && (
          <div className="mt-4 space-y-2">
            {knowledgeItems.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-lg text-xs"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="badge badge-neutral" style={{ fontSize: '10px' }}>
                    {item.category}
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {item.question}
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)' }}>{item.answer}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Resultado
            </h3>
            <span
              className="badge"
              style={{
                backgroundColor: result.success
                  ? 'rgba(34, 197, 94, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)',
                color: result.success ? 'var(--success)' : 'var(--error)',
              }}
            >
              {result.success ? 'Sucesso' : 'Erro'}
            </span>
          </div>

          {result.response ? (
            <div
              className="p-4 rounded-lg"
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Bot size={14} style={{ color: '#8B5CF6' }} />
                <span className="text-xs font-medium" style={{ color: '#8B5CF6' }}>
                  Resposta IA
                </span>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {result.response}
              </p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhuma resposta gerada
            </p>
          )}

          {result.error && (
            <p className="text-sm mt-2" style={{ color: 'var(--error)' }}>
              {result.error}
            </p>
          )}
        </div>
      )}

      {/* Prompt Preview */}
      {promptPreview && (
        <div className="card">
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-2">
              <Eye size={16} style={{ color: 'var(--accent-primary)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Ver Prompt Completo (debug)
              </span>
            </div>
            {showPrompt ? (
              <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
            ) : (
              <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
            )}
          </button>

          {showPrompt && (
            <div className="mt-4 space-y-4">
              {/* System Prompt */}
              <div>
                <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  System Prompt
                </h4>
                <pre
                  className="p-3 rounded-lg text-xs overflow-x-auto"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {promptPreview.systemPrompt}
                </pre>
              </div>

              {/* Conversation Context */}
              <div>
                <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  Contexto da Conversa
                </h4>
                <pre
                  className="p-3 rounded-lg text-xs overflow-x-auto"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {promptPreview.conversationContext}
                </pre>
              </div>

              {/* Incoming Message */}
              <div>
                <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  Mensagem Recebida
                </h4>
                <div
                  className="p-3 rounded-lg text-xs"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {promptPreview.incomingText}
                </div>
              </div>

              {/* Full Prompt */}
              <div>
                <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--accent-primary)' }}>
                  Prompt Completo (enviado para a IA)
                </h4>
                <pre
                  className="p-4 rounded-lg text-xs overflow-x-auto"
                  style={{
                    backgroundColor: 'rgba(139, 92, 246, 0.05)',
                    border: '1px solid rgba(139, 92, 246, 0.2)',
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {promptPreview.fullPrompt}
                </pre>
              </div>

              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Este prompt e construido dinamicamente com base nas configuracoes do agente,
                base de conhecimento ativa e historico de mensagens do contato.
              </p>
            </div>
          )}
        </div>
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
