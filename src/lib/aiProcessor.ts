import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  contact_id: string;
  direction: 'in' | 'out';
  content: string;
  sent_by: string;
  created_at: string;
}

interface KnowledgeItem {
  category: string;
  question: string;
  answer: string;
  active: boolean;
}

interface AppSettings {
  nome_agente: string;
  system_prompt_base: string;
  responder_automaticamente: boolean;
  usar_base_conhecimento: boolean;
  permitir_agendar: boolean;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  course?: string;
  shift?: string;
  status: string;
  campaign_contact_id?: string;
}

interface CampaignContact {
  id: string;
  campaign_id: string;
  nome_formando: string;
  telefone: string;
  status: string;
  data_agendamento?: string;
  confirmacao_local?: string;
  turno_agendamento?: string;
}

/**
 * Processa mensagem usando a Edge Function ai-chat (Gemini)
 */
export async function processMessage(
  contactId: string,
  incomingText: string
): Promise<{ success: boolean; response?: string; error?: string }> {
  try {
    // Chama a Edge Function ai-chat que usa Gemini
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { contactId, message: incomingText, saveMessage: true },
    });

    if (error) {
      console.error('[processMessage] Erro na Edge Function:', error);
      return { success: false, error: error.message };
    }

    if (data?.error && !data?.response) {
      console.error('[processMessage] Erro retornado:', data.error);
      return { success: false, error: data.error };
    }

    return {
      success: true,
      response: data?.response || data?.fallback || 'Desculpe, nao consegui processar sua mensagem.',
    };
  } catch (error) {
    console.error('[processMessage] Erro:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Export helper function for campaign contact status updates
export async function updateCampaignContactStatus(
  campaignContactId: string,
  status: CampaignContact['status'],
  additionalData?: Partial<CampaignContact>
): Promise<boolean> {
  const updateData: Record<string, unknown> = { status, ...additionalData };

  const { error } = await supabase
    .from('campaign_contacts')
    .update(updateData)
    .eq('id', campaignContactId);

  return !error;
}

// Function to get pending campaign contacts for a campaign
export async function getPendingCampaignContacts(campaignId: string): Promise<CampaignContact[]> {
  const { data, error } = await supabase
    .from('campaign_contacts')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) {
    console.error('Error fetching pending contacts:', error);
    return [];
  }

  return (data || []) as CampaignContact[];
}

// Function to start campaign dispatch
export async function startCampaignDispatch(campaignId: string): Promise<void> {
  // Get campaign details
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (!campaign) return;

  // Get pending contacts
  const pendingContacts = await getPendingCampaignContacts(campaignId);

  // For each pending contact, add to message queue
  for (const contact of pendingContacts) {
    // Check if contact already exists
    let { data: existingContact } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', contact.telefone)
      .single();

    let contactId: string;

    if (!existingContact) {
      // Create new contact
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert({
          name: contact.nome_formando,
          phone: contact.telefone,
          contract_number: contact.numero_contrato,
          course: null,
          shift: null,
          status: 'lead',
          assigned_to: 'ia',
          campaign_contact_id: contact.id,
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating contact:', createError);
        continue;
      }

      contactId = newContact.id;
    } else {
      contactId = existingContact.id;

      // Update with campaign contact id
      await supabase
        .from('contacts')
        .update({ campaign_contact_id: contact.id })
        .eq('id', contactId);
    }

    // Update campaign contact with contact id
    await supabase
      .from('campaign_contacts')
      .update({ contact_id: contactId })
      .eq('id', contact.id);

    // Prepare initial message
    let message = campaign.initial_message || `Ola {{nome_formando}}, somos da Stylus Formaturas!`;
    message = message.replace(/\{\{nome_formando\}\}/gi, contact.nome_formando.split(' ')[0]);
    message = message.replace(/\{\{numero_contrato\}\}/gi, contact.numero_contrato || '');

    // Add to message queue
    await supabase.from('message_queue').insert({
      contact_id: contactId,
      campaign_id: campaignId,
      content: message,
      scheduled_for: new Date().toISOString(),
      status: 'pending',
    });

    // Update campaign contact status
    await supabase
      .from('campaign_contacts')
      .update({ status: 'em_atendimento' })
      .eq('id', contact.id);
  }

  console.log(`Campaign ${campaignId} dispatch started with ${pendingContacts.length} contacts`);
}
