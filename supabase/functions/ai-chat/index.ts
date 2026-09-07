import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { contactId, message, saveMessage = true } = await req.json();

    if (!contactId || !message) {
      return new Response(JSON.stringify({ error: 'contactId and message required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Fetch settings
    const { data: settingsData } = await sb.from('settings').select('key, value');
    const settings: Record<string, string> = {};
    settingsData?.forEach((s) => settings[s.key] = s.value);

    const nomeAgente = settings.nome_agente || 'Sofia';
    const systemPromptBase = settings.system_prompt_base || `Voce e ${nomeAgente}, assistente amigavel da Stylus Formaturas.
Sua funcao e ajudar formandos a agendar apresentacoes fotograficas.
Regras:
- Responda de forma CURTA, educada e natural
- Tom simpatico e profissional
- Se o formando quiser agendar, solicite data e turno preferido
- Se o formando mencionar data/turno, confirme o agendamento com marcador:
  ###AGENDAMENTO_CONFIRMADO###{"data":"YYYY-MM-DD","turno":"manha|tarde|noite","local":"endereco"}###FIM###
- Se o formando nao tiver interesse: ###SEM_INTERESSE###
- Se precisar transferir para humano: ###OVERFLOW###
- Use emojis com modaracao

REGRA CRITICA DE REMARCACAO E CANCELAMENTO:
- Se o formando demonstrar QUALQUER intenção de cancelar, remarcar, reagendar, ou indicar que nao podera comparecer a visita agendada (exemplos: "nao vou poder receber", "preciso cancelar", "da pra mudar o dia?", "vou estar viajando nesse dia", "preciso remarcar", "nao consigo ir nesse horario", "tem como mudar para outro dia", etc.), voce DEVE:
  1. NAO tentar reagendar, cancelar ou alterar o agendamento pelo chat
  2. NAO oferecer novos horarios disponiveis
  3. NAO confirmar cancelamento nenhum
  4. NAO sugerir que a remarcacao pode ser feita por WhatsApp, ligacao ou qualquer outro canal remoto
  5. Responder EXATAMENTE com esta mensagem (sem alterar o conteudo):
     "Entendido! Para remarcar ou cancelar sua visita, esse ajuste so pode ser feito presencialmente, diretamente no escritorio da empresa. Qualquer duvida, voce pode entrar em contato pelo numero (92) 99504-1576, mas a remarcacao em si precisa ser feita pessoalmente no local."
  6. Deixar explicito que o comparecimento presencial ao escritorio e OBRIGATORIO para qualquer remarcacao ou cancelamento - nao e uma opcao entre chat/telefone/presencial
  7. O numero de telefone serve apenas como contato/referencia, NAO como canal para resolver a remarcacao
  8. Apos enviar essa mensagem, encerrar o fluxo de agendamento da conversa sem tentar continuar resolvendo a remarcacao
- Essa regra se aplica independentemente de como o formando formular o pedido - interprete a INTENCAO, nao dependa de palavras-chave exatas`;

    // 2. Fetch contact info
    const { data: contactData } = await sb.from('contacts').select('*').eq('id', contactId).single();
    if (!contactData) {
      return new Response(JSON.stringify({ error: 'Contact not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contact = contactData as any;

    // 3. Fetch knowledge base
    let knowledgeText = '';
    const { data: kbData } = await sb.from('knowledge_base').select('*').eq('active', true);
    if (kbData && kbData.length > 0) {
      knowledgeText = '\n\nBase de Conhecimento:\n';
      kbData.forEach((item: any) => {
        knowledgeText += `[${item.category}] P: "${item.question}" R: "${item.answer}"\n`;
      });
    }

    // 4. Fetch recent messages for context
    const { data: messagesData } = await sb
      .from('messages')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(20);

    const history: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    if (messagesData && messagesData.length > 0) {
      messagesData.forEach((msg: any) => {
        history.push({
          role: msg.direction === 'in' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      });
    }

    // Gemini requer que o historico comece com 'user'
    // Remove mensagens iniciais do model se houver
    while (history.length > 0 && history[0].role !== 'user') {
      history.shift();
    }

    // 5. Build system prompt with context
    let systemPrompt = systemPromptBase;
    systemPrompt += `\n\nContexto do contato:`;
    systemPrompt += `\n- Nome: ${contact.name || 'Formando'}`;
    if (contact.course) systemPrompt += `\n- Curso: ${contact.course}`;
    if (contact.shift) systemPrompt += `\n- Turno: ${contact.shift}`;
    systemPrompt += knowledgeText;

    // 6. Substitui variaveis no prompt
    systemPrompt = systemPrompt.replace(/\{\{?nome_formando\}?\}/gi, contact.name || 'Formando');
    systemPrompt = systemPrompt.replace(/\{\{?nome\}?\}/gi, contact.name || 'Formando');
    systemPrompt = systemPrompt.replace(/\{\{?telefone\}?\}/gi, contact.phone || '');
    systemPrompt = systemPrompt.replace(/\{\{?curso\}?\}/gi, contact.course || 'Nao informado');
    systemPrompt = systemPrompt.replace(/\{\{?numero_contrato\}?\}/gi, contact.contract_number || 'Nao informado');

    // 7. Call Gemini
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    console.log('[AI-Chat] GEMINI_API_KEY presente:', !!geminiApiKey);

    if (!geminiApiKey) {
      console.error('[AI-Chat] ERRO: GEMINI_API_KEY nao configurada');
      return new Response(JSON.stringify({
        error: 'API key nao configurada',
        fallback: generateFallbackResponse(contact, message)
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      console.log('[AI-Chat] Iniciando chamada Gemini...');
      console.log('[AI-Chat] Modelo: gemini-2.5-flash-lite');
      console.log('[AI-Chat] System Prompt:', systemPrompt.substring(0, 100) + '...');
      console.log('[AI-Chat] Mensagem:', message);

      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: systemPrompt,
      });

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(message);
      const responseText = result.response.text();

      console.log('[AI-Chat] Resposta:', responseText.substring(0, 100) + '...');

      // 7. Process special markers
      let cleanResponse = responseText;
      let schedulingData = null;
      let needsHandoff = false;
      let noInterest = false;

      // Check for scheduling
      const agendamentoMatch = responseText.match(/###AGENDAMENTO_CONFIRMADO###([\s\S]*?)###FIM###/);
      if (agendamentoMatch) {
        try {
          schedulingData = JSON.parse(agendamentoMatch[1].trim());
          cleanResponse = cleanResponse.replace(/###AGENDAMENTO_CONFIRMADO###[\s\S]*?###FIM###/g, '').trim();

          // Save appointment
          if (schedulingData && saveMessage) {
            await sb.from('appointments').insert({
              graduand_name: contact.name || 'Formando',
              contract_number: contact.contract_number || 'Nao Informado',
              course: contact.course || 'Outros',
              date: schedulingData.data,
              shift: schedulingData.turno,
              location: schedulingData.local || 'RESIDENCIA',
              status: 'Em negociacao',
              contact_id: contactId,
              seller_name: 'INDEFINIDO',
            });
            console.log('[AI-Chat] Agendamento salvo');
          }
        } catch (e) {
          console.error('[AI-Chat] Erro ao parsear agendamento:', e);
        }
      }

      // Check for overflow
      if (responseText.includes('###OVERFLOW###')) {
        needsHandoff = true;
        cleanResponse = cleanResponse.replace(/###OVERFLOW###/g, '').trim();
        if (saveMessage) {
          await sb.from('contacts').update({ assigned_to: 'manual' }).eq('id', contactId);
        }
      }

      // Check for no interest
      if (responseText.includes('###SEM_INTERESSE###')) {
        noInterest = true;
        cleanResponse = cleanResponse.replace(/###SEM_INTERESSE###/g, '').trim();
      }

      // 8. Send message via uazapi (WhatsApp real) and save if requested
      if (saveMessage) {
        let deliveryError: string | null = null;

        try {
          await sendViaUazapi(sb, contact.phone, cleanResponse);
        } catch (sendErr) {
          console.error('[AI-Chat] Erro ao enviar via uazapi:', sendErr);
          deliveryError = sendErr instanceof Error ? sendErr.message : 'Erro desconhecido ao enviar';
        }

        await sb.from('messages').insert([
          { contact_id: contactId, direction: 'in', content: message, sent_by: 'contato' },
          { contact_id: contactId, direction: 'out', content: cleanResponse, sent_by: 'ia' },
        ]);

        if (deliveryError) {
          return new Response(JSON.stringify({
            success: false,
            error: 'IA respondeu mas falhou ao enviar pelo WhatsApp',
            details: deliveryError,
            response: cleanResponse,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        response: cleanResponse,
        scheduling: schedulingData,
        handoff: needsHandoff,
        noInterest,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (geminiError) {
      console.error('[AI-Chat] Erro Gemini:', geminiError);
      return new Response(JSON.stringify({
        error: 'Erro ao comunicar com Gemini',
        details: geminiError instanceof Error ? geminiError.message : 'Unknown error',
        fallback: generateFallbackResponse(contact, message)
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('[AI-Chat] Erro geral:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function generateFallbackResponse(contact: any, message: string): string {
  const firstName = contact?.name?.split(' ')[0] || 'Formando';
  const lowerText = message.toLowerCase();

  // Check for reschedule/cancel intent first - highest priority
  const reschedulePatterns = [
    'cancelar', 'remarcar', 'reagendar', 'mudar o dia', 'mudar a data',
    'mudar o horario', 'nao vou poder', 'nao poderei', 'nao vou conseguir',
    'nao consigo ir', 'vou estar viajando', 'desmarcar', 'adiar',
    'outro dia', 'outra data', 'outro horario',
  ];
  for (const p of reschedulePatterns) {
    if (lowerText.includes(p)) {
      return 'Entendido! Para remarcar ou cancelar sua visita, esse ajuste so pode ser feito presencialmente, diretamente no escritorio da empresa. Qualquer duvida, voce pode entrar em contato pelo numero (92) 99504-1576, mas a remarcacao em si precisa ser feita pessoalmente no local.';
    }
  }

  if (lowerText.includes('preco') || lowerText.includes('valor') || lowerText.includes('quanto')) {
    return `Oi ${firstName}! Os valores variam conforme o pacote escolhido. Posso passar mais detalhes. Voce prefere um pacote completo ou basico?`;
  }

  if (lowerText.includes('agendar') || lowerText.includes('horario') || lowerText.includes('quando')) {
    return `Ola ${firstName}! Podemos agendar sua apresentacao. Qual turno voce prefere? Manha (8h-12h), Tarde (13h-17h) ou Noite (18h-21h)?`;
  }

  if (lowerText.includes('pacote') || lowerText.includes('inclui')) {
    return `${firstName}, nossos pacotes incluem ensaio fotografico, edicao e impressao. Gostaria de saber mais detalhes ou agendar uma apresentacao?`;
  }

  return `Ola ${firstName}! Sou Sofia, da Stylus Formaturas. Estou aqui para ajudar com seu pacote fotografico de formatura. Em que posso ajudar voce hoje?`;
}
async function sendViaUazapi(sb: any, phone: string, text: string): Promise<void> {
  const { data: settingsData, error } = await sb
    .from('whatsapp_settings')
    .select('*')
    .maybeSingle();

  if (error || !settingsData?.api_url || !settingsData?.api_token) {
    throw new Error('Credenciais do WhatsApp nao configuradas');
  }

  const baseUrl = String(settingsData.api_url).replace(/\/$/, '');
  let cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone.startsWith('55')) {
    cleanPhone = `55${cleanPhone}`;
  }

  const res = await fetch(`${baseUrl}/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': settingsData.api_token,
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
}