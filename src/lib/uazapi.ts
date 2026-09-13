// Uazapi WhatsApp Service - Uses Supabase as source of truth for settings

import { supabase } from './supabase';

const SETTINGS_KEY = 'whatsapp_settings';

interface WhatsAppSettings {
  apiUrl: string;
  apiToken: string;
  instanceName: string;
}

// Cache em memoria (fonte sincrona rapida)
let memoryCache: WhatsAppSettings | null = null;

// Funcao interna para ler do localStorage (cache local)
function getFromLocalStorage(): WhatsAppSettings | null {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        apiUrl: parsed.apiUrl?.trim() || '',
        apiToken: parsed.apiToken?.trim() || '',
        instanceName: parsed.instanceName?.trim() || 'stylus_formaturas',
      };
    }
  } catch (e) {
    console.error('[Uazapi] Error reading settings from localStorage:', e);
  }
  return null;
}

// Funcao interna para salvar no localStorage (cache local)
function saveToLocalStorage(settings: WhatsAppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      apiUrl: settings.apiUrl.trim(),
      apiToken: settings.apiToken.trim(),
      instanceName: settings.instanceName.trim(),
    }));
  } catch (e) {
    console.error('[Uazapi] Error saving settings to localStorage:', e);
  }
}

// Busca credenciais do Supabase e atualiza caches
export async function fetchSettingsFromSupabase(): Promise<WhatsAppSettings> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_settings')
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[Uazapi] Error fetching from Supabase:', error);
      // Retorna cache disponivel se houver erro
      return memoryCache || getFromLocalStorage() || { apiUrl: '', apiToken: '', instanceName: 'stylus_formaturas' };
    }

    if (data) {
      const settings: WhatsAppSettings = {
        apiUrl: data.api_url?.trim() || '',
        apiToken: data.api_token?.trim() || '',
        instanceName: data.instance_name?.trim() || 'stylus_formaturas',
      };
      memoryCache = settings;
      saveToLocalStorage(settings);
      console.log('[Uazapi] Settings loaded from Supabase');
      return settings;
    }

    // Se nao ha dados no Supabase, retorna cache local
    return memoryCache || getFromLocalStorage() || { apiUrl: '', apiToken: '', instanceName: 'stylus_formaturas' };
  } catch (e) {
    console.error('[Uazapi] Exception fetching settings:', e);
    return memoryCache || getFromLocalStorage() || { apiUrl: '', apiToken: '', instanceName: 'stylus_formaturas' };
  }
}

// Retorna o cache em memoria (sincrono, rapido)
export function getSettings(): WhatsAppSettings {
  if (memoryCache) {
    return memoryCache;
  }
  const localCache = getFromLocalStorage();
  if (localCache) {
    memoryCache = localCache;
    return localCache;
  }
  return { apiUrl: '', apiToken: '', instanceName: 'stylus_formaturas' };
}

// Salva credenciais no Supabase (fonte de verdade) e atualiza caches
export async function saveSettingsToStorage(settings: WhatsAppSettings): Promise<void> {
  const cleanSettings = {
    apiUrl: settings.apiUrl.trim(),
    apiToken: settings.apiToken.trim(),
    instanceName: settings.instanceName.trim(),
  };

  // Primeiro tenta fazer upsert no Supabase
  const { error } = await supabase
    .from('whatsapp_settings')
    .upsert({
      id: 1,
      api_url: cleanSettings.apiUrl,
      api_token: cleanSettings.apiToken,
      instance_name: cleanSettings.instanceName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (error) {
    console.error('[Uazapi] Error saving to Supabase:', error);
    throw new Error(`Erro ao salvar no Supabase: ${error.message}`);
  }

  // Atualiza caches locais
  memoryCache = cleanSettings;
  saveToLocalStorage(cleanSettings);
  console.log('[Uazapi] Settings saved to Supabase and caches updated');
}

export async function sendMsg(phone: string, text: string): Promise<string> {
  // Garante que temos as credenciais (busca fresco se cache vazio)
  let settings = getSettings();
  if (!settings.apiUrl || !settings.apiToken) {
    settings = await fetchSettingsFromSupabase();
  }

  if (!settings.apiUrl || !settings.apiToken) {
    throw new Error('Configure as credenciais do WhatsApp em Configuracoes');
  }

  // Format phone number
  let cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone.startsWith('55')) {
    cleanPhone = `55${cleanPhone}`;
  }

  const baseUrl = settings.apiUrl.replace(/\/$/, '');

  console.log(`[Uazapi] Enviando mensagem para ${cleanPhone}...`);

  // uazapiGO endpoint: POST /send/text (sem instancia na URL, token identifica a instancia)
  const res = await fetch(`${baseUrl}/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': settings.apiToken,
    },
    body: JSON.stringify({
      number: cleanPhone,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Uazapi erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  console.log(`[Uazapi] Mensagem enviada com sucesso`);
  return data?.key?.id || data?.id || data?.messageid || 'sent';
}

/**
 * Envia midia (imagem, documento, audio ou video) via uazapiGO (POST /send/media).
 * `file` aceita URL publica ou uma string base64 (ex: data URI ou base64 puro,
 * a uazapi aceita ambos). Retorna a fileUrl publica que a uazapi gera pro
 * arquivo enviado (util pra salvar em `messages.media_url`).
 */
export async function sendMedia(
  phone: string,
  file: string,
  tipo: 'image' | 'video' | 'document' | 'audio' | 'ptt' = 'image',
  legenda?: string,
  docName?: string
): Promise<{ messageId: string; fileUrl: string | null }> {
  let settings = getSettings();
  if (!settings.apiUrl || !settings.apiToken) {
    settings = await fetchSettingsFromSupabase();
  }

  if (!settings.apiUrl || !settings.apiToken) {
    throw new Error('Configure as credenciais do WhatsApp em Configuracoes');
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone.startsWith('55')) {
    cleanPhone = `55${cleanPhone}`;
  }

  const baseUrl = settings.apiUrl.replace(/\/$/, '');

  console.log(`[Uazapi] Enviando midia (${tipo}) para ${cleanPhone}...`);

  const res = await fetch(`${baseUrl}/send/media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': settings.apiToken,
    },
    body: JSON.stringify({
      number: cleanPhone,
      type: tipo,
      file,
      ...(legenda ? { text: legenda } : {}),
      ...(docName ? { docName } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Uazapi erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  console.log(`[Uazapi] Midia enviada com sucesso`);
  return {
    messageId: data?.key?.id || data?.id || data?.messageid || 'sent',
    fileUrl: data?.response?.fileUrl || data?.fileUrl || null,
  };
}

export async function getInstanceStatus(): Promise<{ connected: boolean; status: string }> {
  // Sempre busca fresco do Supabase antes de checar status
  const settings = await fetchSettingsFromSupabase();

  if (!settings.apiUrl || !settings.apiToken) {
    return { connected: false, status: 'Credenciais nao configuradas' };
  }

  const baseUrl = settings.apiUrl.replace(/\/$/, '');

  try {
    // uazapiGO endpoint: GET /instance/status (sem instancia na URL)
    const res = await fetch(`${baseUrl}/instance/status`, {
      method: 'GET',
      headers: {
        'token': settings.apiToken,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) return { connected: false, status: 'erro' };

    const data = await res.json();
    // uazapiGO pode retornar o status como objeto aninhado: {connected, jid, loggedIn, resetting}
    const statusObj = (data && typeof data.status === 'object' && data.status !== null)
      ? data.status
      : (data.instance && typeof data.instance === 'object' ? data.instance : data);
    const connected =
      statusObj.connected === true ||
      statusObj.loggedIn === true ||
      data.state === 'open' ||
      (typeof data.status === 'string' && (data.status === 'connected' || data.status === 'open'));
    const statusLabel = connected ? 'connected' : 'disconnected';
    return { connected, status: statusLabel };
  } catch (err) {
    console.error('[Uazapi] Erro ao verificar status:', err);
    return { connected: false, status: 'erro de conexao' };
  }
}

export interface UazapiChat {
  id: string;
  phone: string;
  jid?: string;
  name?: string;
  lastMessage?: {
    text: string;
    timestamp: number;
    fromMe: boolean;
  };
  unreadCount?: number;
}

export async function fetchChatsFromUazapi(): Promise<UazapiChat[]> {
  const settings = getSettings();

  if (!settings.apiUrl || !settings.apiToken) {
    console.warn('[Uazapi] Credenciais nao configuradas');
    return [];
  }

  const baseUrl = settings.apiUrl.replace(/\/$/, '');

  try {
    // uazapiGO endpoint: POST /chat/find (sem instancia na URL)
    const res = await fetch(`${baseUrl}/chat/find`, {
      method: 'POST',
      headers: {
        'token': settings.apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[Uazapi] /chat/find falhou: ${res.status} ${err}`);
      return [];
    }

    const data = await res.json();
    console.log('[Uazapi] Resposta completa:', JSON.stringify(data, null, 2));

    const rawItems = Array.isArray(data) ? data : (data.chats || data.contacts || data.data || []);
    console.log(`[Uazapi] ${rawItems.length} itens brutos recebidos antes do filtro`);
    if (rawItems.length > 0) {
      console.log('[Uazapi] Chaves do primeiro item:', Object.keys(rawItems[0]));
      console.log('[Uazapi] Primeiro item completo:', JSON.stringify(rawItems[0], null, 2));
    }

    const chats = normalizeChatsResponse(data);
    console.log(`[Uazapi] ${chats.length} chats carregados (apos filtro)`);
    return chats;
  } catch (err) {
    console.error('[Uazapi] Erro ao buscar chats:', err);
    return [];
  }
}

function normalizeChatsResponse(data: any): UazapiChat[] {
  const items = Array.isArray(data) ? data : (data.chats || data.contacts || data.data || []);

  return items
    .map((item: any) => {
      // Prioriza wa_chatid (formato JID real) e phone (formato com mascara)
      const jid = item.wa_chatid || item.jid || item.remoteJid || item.wa_chatlid || item.id || '';
      const rawPhone = item.phone || jid;
      const phone = String(rawPhone).replace(/\D/g, '').split('@')[0].replace(/^0+/, '');

      return {
        id: jid || phone,
        phone,
        jid,
        name: item.name || item.wa_contactName || item.pushName || item.notify || item.wa_name || phone || 'Contato',
        lastMessage: item.wa_lastMessageTextVote || item.lastMessage || item.wa_lastMsgTimestamp || item.conversationTimestamp ? {
          text: item.lastMessage?.body || item.lastMessage?.conversation || item.wa_lastMessageTextVote || item.lastMessageText || item.wa_lastMessageText || '',
          timestamp: item.lastMessage?.messageTimestamp || item.conversationTimestamp || item.wa_lastMsgTimestamp || Date.now(),
          fromMe: item.lastMessage?.fromMe || item.lastMessage?.key?.fromMe || item.wa_fromMe || false,
        } : undefined,
        unreadCount: item.unreadCount || item.wa_unreadCount || 0,
      };
    })
    .filter((chat) => {
      // Ignora grupos (@g.us), broadcast/status, listas de transmissao
      const jid = chat.jid || '';
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid === 'status@broadcast') {
        return false;
      }
      if (jid && !jid.includes('@s.whatsapp.net') && jid.includes('@')) {
        return false;
      }
      // Valida telefone brasileiro: 55 + DDD (2 digitos) + 9 + numero = 13 digitos
      // ou 55 + DDD + numero sem 9 = 12 digitos
      const digits = chat.phone;
      if (!digits || !/^\d+$/.test(digits)) return false;
      if (digits.length < 12 || digits.length > 13) return false;
      if (!digits.startsWith('55')) return false;
      // DDD valido (11-89, nao pode comecar com 0)
      const ddd = digits.substring(2, 4);
      if (!/^([1-9]\d)$/.test(ddd)) return false;
      return true;
    });
}
