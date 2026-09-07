import { supabase } from './supabase';
import { fetchChatsFromUazapi, UazapiChat } from './uazapi';

// Normaliza telefone BR: remove nao-digitos, adiciona codigo 55 e o digito 9 quando necessario
function normalizePhone(phone: string): string {
  if (!phone) return '';
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
}

// Valida se o telefone normalizado e um numero brasileiro valido (12 ou 13 digitos, comecando com 55)
function isValidBrazilianPhone(normalized: string): boolean {
  if (!normalized || !/^\d+$/.test(normalized)) return false;
  if (normalized.length < 12 || normalized.length > 13) return false;
  if (!normalized.startsWith('55')) return false;
  const ddd = normalized.substring(2, 4);
  if (!/^([1-9]\d)$/.test(ddd)) return false;
  return true;
}

export async function syncContactsFromUazapi(): Promise<{
  success: boolean;
  synced: number;
  messages: number;
  error?: string;
}> {
  try {
    const chats = await fetchChatsFromUazapi();

    if (chats.length === 0) {
      return { success: true, synced: 0, messages: 0 };
    }

    let syncedCount = 0;
    let messagesCount = 0;

    // Prepara dados para upsert em lote (normalizando e validando telefones BR)
    const contactsToUpsert = chats
      .map((chat) => ({
        phone: normalizePhone(chat.phone),
        name: chat.name || normalizePhone(chat.phone),
        status: 'lead' as const,
        assigned_to: 'ia' as const,
      }))
      .filter((c) => isValidBrazilianPhone(c.phone));

    if (contactsToUpsert.length === 0) {
      console.log('[Sync] Nenhum contato valido encontrado');
      return { success: true, synced: 0, messages: 0 };
    }

    // Upsert de contatos (inserir novos, atualizar existentes)
    const { data: upsertedContacts, error: upsertError } = await supabase
      .from('contacts')
      .upsert(contactsToUpsert, {
        onConflict: 'phone',
        ignoreDuplicates: false,
      })
      .select('id, phone, name');

    if (upsertError) {
      console.error('[Sync] Erro no upsert:', upsertError);
      return { success: false, synced: 0, messages: 0, error: upsertError.message };
    }

    syncedCount = upsertedContacts?.length || 0;
    console.log(`[Sync] ${syncedCount} contatos sincronizados`);

    // Mapeia telefone para ID
    const phoneToId = new Map((upsertedContacts || []).map((c) => [c.phone, c.id]));

    // Salva mensagens de cada contato
    for (const chat of chats) {
      if (!chat.lastMessage?.text) continue;

      const contactId = phoneToId.get(normalizePhone(chat.phone));
      if (!contactId) continue;

      // Verifica se mensagem ja existe (evita duplicados)
      const { data: existingMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('contact_id', contactId)
        .eq('content', chat.lastMessage.text)
        .maybeSingle();

      if (!existingMsg) {
        const { error: msgError } = await supabase.from('messages').insert({
          contact_id: contactId,
          direction: chat.lastMessage.fromMe ? 'out' : 'in',
          content: chat.lastMessage.text,
          sent_by: chat.lastMessage.fromMe ? 'ia' : 'contato',
          delivered: chat.lastMessage.fromMe,
        });

        if (!msgError) {
          messagesCount++;
        }
      }
    }

    console.log(`[Sync] ${messagesCount} mensagens salvas`);
    return { success: true, synced: syncedCount, messages: messagesCount };
  } catch (err) {
    console.error('[Sync] Erro:', err);
    return {
      success: false,
      synced: 0,
      messages: 0,
      error: err instanceof Error ? err.message : 'Erro desconhecido',
    };
  }
}

export async function syncSingleContactFromWebhook(
  telefone: string,
  nome?: string,
  mensagem?: string,
  direcao: 'in' | 'out' = 'in'
): Promise<string | null> {
  try {
    const phone = normalizePhone(telefone);
    if (!isValidBrazilianPhone(phone)) {
      console.warn(`[Sync] Telefone invalido ignorado: ${telefone}`);
      return null;
    }

    // Upsert do contato
    const { data: contato, error: upsertError } = await supabase
      .from('contacts')
      .upsert({
        phone,
        name: nome || phone,
        status: 'lead',
        assigned_to: 'ia',
      }, {
        onConflict: 'phone',
        ignoreDuplicates: false,
      })
      .select('id')
      .single();

    if (upsertError) {
      console.error('[Sync] Erro ao criar contato:', upsertError);
      return null;
    }

    const contactId = contato?.id;
    console.log(`[Sync] Contato sincronizado: ${telefone}`);

    // Salva mensagem se fornecida
    if (contactId && mensagem) {
      const { error: msgError } = await supabase.from('messages').insert({
        contact_id: contactId,
        direction: direcao,
        content: mensagem,
        sent_by: direcao === 'in' ? 'contato' : 'ia',
        delivered: direcao === 'out',
      });

      if (msgError) {
        console.warn('[Sync] Erro ao salvar mensagem:', msgError);
      }
    }

    return contactId;
  } catch (err) {
    console.error('[Sync] Erro:', err);
    return null;
  }
}
