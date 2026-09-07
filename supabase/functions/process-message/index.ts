import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { contactId, text } = await req.json();

    if (!contactId || !text) {
      return new Response(JSON.stringify({ error: 'Missing contactId or text' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing message for contact ${contactId}: ${text}`);

    // 1. Get settings
    const settings = await getSettings();

    if (settings.responder_automaticamente !== 'true') {
      return new Response(JSON.stringify({ success: false, error: 'Auto-response disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Get contact info
    const contact = await getContact(contactId);
    if (!contact) {
      return new Response(JSON.stringify({ error: 'Contact not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2.5. Skip AI if contact is in manual mode
    if (contact.assigned_to === 'manual') {
      console.log(`[ProcessMessage] Contact ${contactId} is in manual mode, skipping AI response`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'manual_mode' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Check for human handoff
    if (detectHumanHandoff(text)) {
      await handleHumanHandoff(contactId, contact);
      const responseText = 'Certo! Vou transferir voce para um atendente humano. Aguarde um momento...';
      await sendMessage(contactId, responseText, 'ia');
      await sendEvolutionMessage(contact.phone, responseText);
      return new Response(JSON.stringify({ success: true, response: responseText, handoff: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3.5. Check for reschedule/cancel intent - must redirect to human contact
    if (detectRescheduleIntent(text)) {
      const responseText = 'Entendido! Para remarcar ou cancelar sua visita, esse ajuste so pode ser feito presencialmente, diretamente no escritorio da empresa. Qualquer duvida, voce pode entrar em contato pelo numero (92) 99504-1576, mas a remarcacao em si precisa ser feita pessoalmente no local.';
      await sendMessage(contactId, responseText, 'ia');
      await sendEvolutionMessage(contact.phone, responseText);
      return new Response(JSON.stringify({ success: true, response: responseText, reschedule_redirect: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Get knowledge base
    const knowledgeBase = await getKnowledgeBase();

    // 5. Get recent messages
    const recentMessages = await getRecentMessages(contactId, 10);

    // 6. Generate response
    const response = generateResponse(contact, text, recentMessages, knowledgeBase, settings);

    // 7. Save outgoing message
    await sendMessage(contactId, response, 'ia');

    // 8. Send via Evolution API
    await sendEvolutionMessage(contact.phone, response);

    // 9. Check for scheduling and update campaign contact
    const schedulingInfo = detectScheduling(text, recentMessages);
    if (schedulingInfo && contact.campaign_contact_id) {
      await updateCampaignContactSchedule(contact.campaign_contact_id, schedulingInfo);
    }

    // 10. Update contact status if needed
    if (contact.campaign_contact_id) {
      await fetch(`${supabaseUrl}/rest/v1/campaign_contacts?id=eq.${contact.campaign_contact_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'em_atendimento' })
      });
    }

    return new Response(JSON.stringify({ success: true, response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Process message error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function getSettings(): Promise<Record<string, string>> {
  const response = await fetch(`${supabaseUrl}/rest/v1/settings?select=key,value`, {
    headers: {
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  });
  const data = await response.json();
  const map: Record<string, string> = {};
  data?.forEach((s: { key: string; value: string }) => {
    map[s.key] = s.value;
  });
  return map;
}

async function getContact(contactId: string): Promise<any> {
  const response = await fetch(`${supabaseUrl}/rest/v1/contacts?id=eq.${contactId}&select=*`, {
    headers: {
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  });
  const data = await response.json();
  return data?.[0] || null;
}

async function getKnowledgeBase(): Promise<any[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/knowledge_base?active=eq.true&select=*`, {
    headers: {
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  });
  return await response.json() || [];
}

async function getRecentMessages(contactId: string, limit: number): Promise<any[]> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/messages?contact_id=eq.${contactId}&select=*&order=created_at.desc&limit=${limit}`,
    {
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`
      }
    }
  );
  const data = await response.json();
  return data?.reverse() || [];
}

async function sendMessage(contactId: string, content: string, sentBy: string) {
  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      contact_id: contactId,
      direction: 'out',
      content,
      sent_by: sentBy,
      delivered: true,
      read: false
    })
  });
}

async function sendEvolutionMessage(phone: string, text: string) {
  try {
    const settings = await getSettings();
    const apiUrl = settings.evolution_api_url || 'https://api.evolution-api.com';
    const apiKey = settings.evolution_api_key;
    const instanceName = settings.evolution_instance_name || 'stylus_formaturas';

    if (!apiKey) {
      console.log('Evolution API key not configured, skipping real send');
      return;
    }

    let cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone.startsWith('55')) {
      cleanPhone = `55${cleanPhone}`;
    }

    await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        number: cleanPhone,
        options: { delay: 1500, presence: 'composing' },
        textMessage: { text }
      })
    });
  } catch (error) {
    console.error('Error sending Evolution message:', error);
  }
}

function detectHumanHandoff(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns = [
    'falar com atendente', 'falar com humano', 'atendente real',
    'pessoa real', 'nao quero rob', 'nao quero bot',
    'quero falar com alguem', 'transfer para atendente',
    'passa para humano', 'encerrar ia', 'desativar ia'
  ];
  return patterns.some(p => lower.includes(p));
}

function detectRescheduleIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();

  // Direct keywords for cancel/reschedule
  const directPatterns = [
    'cancelar', 'cancela', 'remarcar', 'remarca', 'reagendar', 'reagenda',
    'mudar o dia', 'mudar a data', 'mudar o horario', 'mudar de dia',
    'mudar para outro', 'trocar o dia', 'trocar a data', 'trocar o horario',
    'outro dia', 'outra data', 'outro horario', 'outra hora',
    'nao vou poder', 'nao poderei', 'nao vou conseguir', 'nao consigo ir',
    'nao vou dar', 'nao vou conseguir comparecer', 'nao posso ir',
    'nao poderei comparecer', 'nao poderei receber',
    'vou estar viajando', 'vou viajar', 'estarei viajando',
    'vou estar ocupado', 'vou estar indisponivel', 'tengo compromisso',
    'nao vai dar', 'nao da pra ir', 'nao da para ir',
    'desmarcar', 'desmarca', 'adiar', 'protelar',
    'tem como mudar', 'da pra mudar', 'se mudar', 'se remarcar',
    'preciso mudar', 'preciso remarcar', 'preciso cancelar',
    'quero cancelar', 'quero remarcar', 'quero mudar',
    'impossibilitad', 'indisponivel', 'nao disponivel',
    'nao tem como', 'sem condicoes',
  ];

  for (const p of directPatterns) {
    if (lower.includes(p)) return true;
  }

  // Pattern: "nao" + future verb indicating inability to attend
  const inabilityPatterns = [
    /nao\s+(vou|poderei|posso|consigo|vou conseguir)\s+(ir|comparecer|receber|estar|comparecer|participar)/i,
    /nao\s+vai\s+(dar|dar pra|dar para|ser possivel)/i,
    /impossivel\s+(ir|comparecer|receber|participar)/i,
  ];

  for (const p of inabilityPatterns) {
    if (p.test(lower)) return true;
  }

  return false;
}

async function handleHumanHandoff(contactId: string, contact: any) {
  // Update contact assigned_to
  await fetch(`${supabaseUrl}/rest/v1/contacts?id=eq.${contactId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ assigned_to: 'manual' })
  });

  // Update campaign contact if exists
  if (contact.campaign_contact_id) {
    await fetch(`${supabaseUrl}/rest/v1/campaign_contacts?id=eq.${contact.campaign_contact_id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ status: 'transbordado_humano' })
    });
  }
}

function generateResponse(
  contact: any,
  incomingText: string,
  recentMessages: any[],
  knowledgeBase: any[],
  settings: Record<string, string>
): string {
  const firstName = contact.name?.split(' ')[0] || 'la';
  const lowerText = incomingText.toLowerCase();
  const nomeAgente = settings.nome_agente || 'Sofia';

  // Check for scheduling mention
  const shiftMatch = lowerText.match(/\b(manha|manh|tarde|noite|m|\bt|n)\b/i);
  const dateMatch = lowerText.match(/(\d{1,2}\/\d{1,2}|\d{1,2} de \w+)/i);

  if ((shiftMatch || dateMatch) && settings.permitir_agendar === 'true') {
    const shift = shiftMatch ? shiftMatch[0].toLowerCase().replace('manh', 'manha') : 'turno a confirmar';
    const date = dateMatch ? dateMatch[0] : 'data a confirmar';
    return `Perfeito ${firstName}! Confirmando seu agendamento:\n\nData: ${date}\nTurno: ${shift.charAt(0).toUpperCase() + shift.slice(1)}\n\nA apresentacao sera no nosso estudio. Confirmo esse horario para voce?`;
  }

  if (lowerText.includes('sim') || lowerText.includes('confirm') || lowerText.includes('ok') || lowerText.includes('pode')) {
    const lastAI = [...recentMessages].reverse().find(m => m.direction === 'out');
    if (lastAI?.content?.includes('agendamento') || lastAI?.content?.includes('horario')) {
      return `Otimo, ${firstName}! Seu agendamento foi confirmado. Enviaremos um lembrete no dia anterior. Se precisar de algo, estamos a disposicao!`;
    }
  }

  if (lowerText.includes('preco') || lowerText.includes('valor') || lowerText.includes('quanto')) {
    const priceItem = knowledgeBase.find(k => k.category === 'precos' || k.question?.toLowerCase().includes('valor'));
    if (priceItem) {
      return `Oi ${firstName}! ${priceItem.answer} Posso ajudar com mais alguma coisa?`;
    }
  }

  if (lowerText.includes('agendar') || lowerText.includes('horario') || lowerText.includes('quando') || lowerText.includes('disponibil')) {
    if (settings.permitir_agendar === 'true') {
      return `Ola ${firstName}! Podemos agendar sua apresentacao. Tenho horarios disponiveis nas proximas 4 semanas.\n\nQual turno voce prefere? Manha (8h-12h), Tarde (13h-17h) ou Noite (18h-21h)?`;
    }
  }

  if (lowerText.includes('pacote') || lowerText.includes('inclui') || lowerText.includes('vem')) {
    const pkgItem = knowledgeBase.find(k => k.category === 'pacotes' || k.question?.toLowerCase().includes('inclui'));
    if (pkgItem) {
      return `${pkgItem.answer} Gostaria de agendar uma apresentacao para ver mais detalhes?`;
    }
  }

  if (lowerText.includes('local') || lowerText.includes('onde') || lowerText.includes('endereco')) {
    return `Nosso estudio fica no centro da cidade. Durante o agendamento, enviamos o endereco completo com mapa. Gostaria de agendar uma visita?`;
  }

  return `Ola ${firstName}! Sou ${nomeAgente}, da Stylus Formaturas. Estou aqui para ajudar com seu pacote fotografico de formatura. Em que posso ajudar voce hoje?`;
}

function detectScheduling(incomingText: string, recentMessages: any[]): { date: string; shift: string } | null {
  const lowerText = incomingText.toLowerCase();

  const isConfirmation = lowerText.includes('sim') || lowerText.includes('confirm') || lowerText.includes('ok') || lowerText.includes('pode ser');
  if (!isConfirmation) return null;

  const lastAI = [...recentMessages].reverse().find(m => m.direction === 'out');
  if (!lastAI?.content?.includes('agendamento')) return null;

  const conversationText = recentMessages.map(m => m.content).join(' ');
  const dateMatch = conversationText.match(/\b(\d{1,2}\/\d{1,2}\/?\d{0,4}|\d{1,2} de \w+(?: de \d{4})?)\b/i);
  const shiftMatch = conversationText.match(/\b(manha|manh|tarde|noite)\b/i);

  if (!dateMatch) return null;

  let scheduledDate: Date = new Date();
  const dateStr = dateMatch[1];
  const dateParts = dateStr.split('/');

  if (dateParts.length === 2) {
    const day = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1;
    scheduledDate = new Date(scheduledDate.getFullYear(), month, day);
  }

  const shift = shiftMatch ? shiftMatch[1].toLowerCase().replace('manh', 'manha') : 'manha';

  return {
    date: scheduledDate.toISOString(),
    shift: shift.charAt(0).toUpperCase() + shift.slice(1)
  };
}

async function updateCampaignContactSchedule(campaignContactId: string, info: { date: string; shift: string }) {
  await fetch(`${supabaseUrl}/rest/v1/campaign_contacts?id=eq.${campaignContactId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      status: 'agendado',
      data_agendamento: info.date,
      turno_agendamento: info.shift
    })
  });
}
