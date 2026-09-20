import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Normaliza telefone: remove nao-digitos e garante codigo do pais 55
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

// Mapeia turnos salvos para texto de horario correspondente
const TURNOS_HORARIOS: Record<string, string> = {
  'Manha (8h as 12h)': 'Manha entre 08:00 e 12:00',
  'Tarde (13h as 17h)': 'Tarde entre 13:00 e 17:00',
  'Noite (18h as 20h)': 'Noite entre 18:00 e 20:00',
};

// Formata opcoes de agendamento [{data, turnos}] em texto legivel
function formatarOpcoesAgendamento(opcoes: Array<{ data: string; turnos: string[] }>): string {
  if (!opcoes || opcoes.length === 0) return '';
  return opcoes
    .filter((o) => o.data)
    .map((o) => {
      const [ano, mes, dia] = o.data.split('-');
      const dataFormatada = `${dia}/${mes}/${ano}`;
      const turnosTxt = (o.turnos || [])
        .map((t) => TURNOS_HORARIOS[t] || t)
        .join('\n');
      return `Dia ${dataFormatada}\n${turnosTxt}`;
    })
    .join('\n\n') + '\n\n';
}

interface UazapiWebhookBody {
  event: string;
  instance: string;
  data: {
    key: { remoteJid: string; fromMe: boolean; id: string };
    message?: { conversation?: string; extendedTextMessage?: { text: string } };
    body?: string;
    status?: string;
  };
  message?: {
    fromMe: boolean;
    key?: { id: string };
    text?: string;
    content?: { text: string };
    chatid?: string;
  };
  chat?: { wa_chatid?: string; wa_lastMessageTextVote?: string };
}

/**
 * Verifica se um evento webhook ja foi processado.
 * Estrategia dupla:
 *   1. Por message_id (chave primaria na tabela de dedup)
 *   2. Por telefone + conteudo + janela de tempo (cobre reenvios com IDs diferentes/ausentes)
 */
async function verificarDuplicata(
  sb: ReturnType<typeof createClient>,
  message_id: string,
  telefone: string,
  conteudo: string,
  janelaSegundos: number
): Promise<boolean> {
  // 1. Checagem por message_id (se presente)
  if (message_id) {
    const { data: existente } = await sb
      .from('webhook_events_processados')
      .select('message_id')
      .eq('message_id', message_id)
      .maybeSingle();
    if (existente) {
      console.log(`[Dedup] Duplicata por message_id: "${message_id}"`);
      return true;
    }
  }

  // 2. Checagem por telefone + conteudo + janela de tempo
  if (telefone && conteudo) {
    const limite = new Date(Date.now() - janelaSegundos * 1000).toISOString();
    const { data: recentes, error } = await sb
      .from('webhook_events_processados')
      .select('message_id')
      .eq('telefone', telefone)
      .eq('conteudo', conteudo)
      .gte('processado_em', limite);
    if (!error && recentes && recentes.length > 0) {
      console.log(`[Dedup] Duplicata por telefone+conteudo+janela: tel=${telefone} conteudo="${conteudo.substring(0, 40)}" encontrados=${recentes.length}`);
      return true;
    }
  }

  return false;
}

/**
 * Registra um evento webhook como processado.
 * Usa UPSERT para tratar message_id ausente (gera um fallback unico).
 */
async function registrarEventoProcessado(
  sb: ReturnType<typeof createClient>,
  message_id: string,
  telefone: string,
  conteudo: string
): Promise<void> {
  const idFinal = message_id || `noid_${telefone}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const { error } = await sb
    .from('webhook_events_processados')
    .upsert(
      { message_id: idFinal, telefone, conteudo, processado_em: new Date().toISOString() },
      { onConflict: 'message_id' }
    );
  if (error) {
    console.warn(`[Dedup] Erro ao registrar evento processado:`, error.message);
  }
}

/**
 * Chama a IA Gemini para resposta contextual
 * @param promptIa - Prompt da IA vindo da campanha (injetado como systemInstruction)
 * @param textoUsuario - Mensagem recebida do formando
 * @param contatoData - Dados do contato para substituicao de variaveis
 * @param history - Historico da conversa
 */
async function chamarGemini(
  promptIa: string,
  textoUsuario: string,
  contatoData: {
    nome: string;
    telefone: string;
    curso?: string;
    numero_contrato?: string;
    endereco?: string;
    valor_tabela?: number | string | null;
    valor_oferecido?: number | string | null;
    formas_pagamento?: string | null;
    opcoes_plano?: string | null;
    prazo_reciclagem?: string | null;
    quantidade_fotos?: string | null;
  },
  history: Array<{ role: string; parts: Array<{ text: string }> }> = [],
  baseConhecimento: Array<{ pergunta: string; resposta: string }> = [],
  opcoesAgendamento: Array<{ data: string; turnos: string[] }> = []
): Promise<string> {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  console.log('[Gemini] Iniciando chamada - API Key presente:', !!geminiApiKey);
  console.log('[Gemini] Prompt IA da campanha:', promptIa ? promptIa.substring(0, 100) + '...' : '(vazio - usando default)');

  if (!geminiApiKey) {
    console.error('[Gemini] ERRO: GEMINI_API_KEY nao configurada');
    return '';
  }

  try {
    // Substitui todos os placeholders no prompt
    let systemPrompt = promptIa || '';

    // Variaveis de substituicao (formato {nome}, {{nome}}, {nome_formando}}, etc.)
    systemPrompt = systemPrompt.replace(/\{\{?nome_formando\}?\}/gi, contatoData.nome);
    systemPrompt = systemPrompt.replace(/\{\{?nome\}?\}/gi, contatoData.nome);
    systemPrompt = systemPrompt.replace(/\{\{?telefone\}?\}/gi, contatoData.telefone);
    systemPrompt = systemPrompt.replace(/\{\{?curso\}?\}/gi, contatoData.curso || 'Nao informado');
    systemPrompt = systemPrompt.replace(/\{\{?numero_contrato\}?\}/gi, contatoData.numero_contrato || 'Nao informado');
    systemPrompt = systemPrompt.replace(/\{\{?endere[cç]o\}?\}/gi, contatoData.endereco || 'Nao informado');
    systemPrompt = systemPrompt.replace(/\{\{?local\}?\}/gi, contatoData.endereco || 'Nao informado');
    systemPrompt = systemPrompt.replace(/\{nome\}/gi, contatoData.nome);

    // Variaveis exclusivas do fluxo de venda de material fotografico (so tem
    // efeito se a campanha tiver esses placeholders no prompt_ia personalizado)
    systemPrompt = systemPrompt.replace(/\{valor_tabela\}/gi, contatoData.valor_tabela ?? 'valor sob consulta');
    systemPrompt = systemPrompt.replace(/\{valor_oferecido\}/gi, contatoData.valor_oferecido ?? 'valor sob consulta');
    systemPrompt = systemPrompt.replace(/\{formas_pagamento\}/gi, contatoData.formas_pagamento || 'consulte as opcoes disponiveis');
    systemPrompt = systemPrompt.replace(/\{opcoes_plano\}/gi, contatoData.opcoes_plano || 'consulte as opcoes disponiveis');
    systemPrompt = systemPrompt.replace(/\{prazo_reciclagem\}/gi, contatoData.prazo_reciclagem || 'em breve');
    systemPrompt = systemPrompt.replace(/\{quantidade_fotos\}/gi, contatoData.quantidade_fotos || 'nao informado');

    // Substitui placeholder {opcoes_agendamento} pelas opcoes reais
    const textoOpcoesFormatado = formatarOpcoesAgendamento(opcoesAgendamento);
    systemPrompt = systemPrompt.replace(/\{opcoes_agendamento\}/gi, textoOpcoesFormatado);

    // Blindagem: nunca deixe a IA copiar um marcador de exemplo (tipo
    // "[Nome do Formando]") como se fosse texto literal a ser enviado
    systemPrompt +=
      `\n\nCRITICO: use sempre o nome real do contato (${contatoData.nome}) nas suas respostas. ` +
      'NUNCA escreva marcadores/placeholders como [Nome do Formando], [nome], {nome} ou qualquer ' +
      'texto entre colchetes/chaves no lugar do nome - se algum trecho de instrucao acima citar um ' +
      'exemplo assim, e apenas ilustrativo, nunca copie esse formato literal na sua resposta.';

    // Substitui placeholder {Nome} nas respostas da base de conhecimento
    const baseConhecimentoFormatada = baseConhecimento.map((item) => ({
      pergunta: item.pergunta,
      resposta: item.resposta.replace(/\{Nome\}/gi, contatoData.nome),
    }));

    // Injeta base de conhecimento no prompt
    if (baseConhecimentoFormatada && baseConhecimentoFormatada.length > 0) {
      systemPrompt +=
        '\n\nBASE DE CONHECIMENTO (use estas informa\u00e7\u00f5es para responder perguntas do formando fora do fluxo de agendamento - NUNCA invente respostas quando a informa\u00e7\u00e3o estiver aqui):\n' +
        baseConhecimentoFormatada.map((item) => `P: ${item.pergunta}\nR: ${item.resposta}`).join('\n\n');
    }

    // Prompt default se nao houver personalizado na campanha
    if (!systemPrompt.trim()) {
      systemPrompt = `Voce e Sophia, assistente amigavel da Stylus Formaturas.
Contexto: Atendimento ao formando ${contatoData.nome}.
Regras:
- Responda de forma CURTA, educada e natural
- REGRA OBRIGATORIA E CRITICA: sempre que o formando confirmar uma data e turno (mesmo que de forma indireta, tipo "sim", "pode ser", "confirmado"), voce DEVE incluir na sua resposta, OBRIGATORIAMENTE, o marcador tecnico exato abaixo, com a data no formato YYYY-MM-DD.
EXEMPLO DE COMO RESPONDER QUANDO O FORMANDO CONFIRMAR (siga este padrao exato):
Formando disse: "sim, pode ser dia 17 de manha"
Sua resposta deve ser exatamente assim:
"Perfeito, {nome}! Sua visita ficou agendada:
<calendario> 17/07/2026
<relogio> Manha
<pino> [endereco confirmado]
Aguarde nosso representante no dia combinado <camera>
Parabens pela conquista! <formatura>
###AGENDAMENTO_CONFIRMADO###{"data":"2026-07-17","turno":"manha","local":"[endereco confirmado]"}###FIM###"
O marcador ###AGENDAMENTO_CONFIRMADO###...###FIM### e OBRIGATORIO e deve vir sempre junto com a frase de confirmacao, nunca isolado, nunca omitido.
- Se o formando demonstrar que nao tem interesse: ###SEM_INTERESSE###
- Se precisar transferir para humano: ###OVERFLOW###
- Nao use emojis demais
- NUNCA invente ou cite um endereco diferente do fornecido. Se nao houver endereco informado, diga que vai verificar e confirmar em seguida.
- As unicas datas/turnos validos sao os de {opcoes_agendamento}, mesmo durante reagendamento. Nunca aceite, confirme ou gere ###AGENDAMENTO_CONFIRMADO### com data fora dessa lista.
- Sempre que o formando fizer uma pergunta que nao seja sobre escolher data/turno ou confirmar endereco, consulte primeiro a BASE DE CONHECIMENTO fornecida antes de responder. Se a pergunta estiver coberta la, use a resposta de la (adaptando o tom se necessario). Se nao estiver coberta, diga que vai verificar e retornar, ou direcione para atendimento humano - nunca invente.
- Seja simpatica e profissional`;
    }

    // Injeta a data/hora REAIS (fuso de Brasilia) para a IA nunca
    // "alucinar" uma data errada (ex: usar uma data do proprio treinamento
    // dela em vez do dia real de hoje). Aplicado sempre, tanto no prompt
    // personalizado da campanha quanto no prompt default.
    const agora = new Date();
    const dataHoraAtualBR = agora.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    systemPrompt +=
      `\n\nDATA E HORA ATUAIS REAIS (fuso de Brasilia): ${dataHoraAtualBR}. ` +
      'Use SEMPRE esta informacao como referencia para "hoje", "amanha", "essa semana", etc. ' +
      'NUNCA use uma data do seu proprio conhecimento/treinamento - a informacao acima e a unica correta.';

    console.log('[Gemini] System Prompt (final):', systemPrompt.substring(0, 300) + '...');
    console.log('[Gemini] Mensagem do usuario:', textoUsuario);
    console.log('[Gemini] Historico tem', history.length, 'mensagens');

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction: systemPrompt,
    });

    console.log('[Gemini] Modelo configurado: gemini-2.5-flash-lite');

    const chat = model.startChat({ history: history.length > 0 ? history : [] });
    const result = await chat.sendMessage(textoUsuario);
    const responseText = result.response.text();

    console.log('[Gemini] Resposta recebida:', responseText.substring(0, 100) + '...');
    return responseText;
  } catch (err) {
    console.error('[Gemini] ERRO ao chamar Gemini:', err);
    if (err instanceof Error) {
      console.error('[Gemini] Mensagem de erro:', err.message);
      console.error('[Gemini] Stack trace:', err.stack);
    }
    return '';
  }
}

/**
 * Envia mensagem via Uazapi
 */
async function enviarMensagemUazapi(telefone: string, texto: string): Promise<void> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL')?.trim();
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN')?.trim();
  console.log('[Uazapi] Config - URL:', uazapiUrl, '| Token presente:', !!uazapiToken);
  if (!uazapiUrl || !uazapiToken || !texto) {
    console.error('[Uazapi] Configuracao ausente - abortando envio');
    return;
  }
  try {
    const resp = await fetch(`${uazapiUrl}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': uazapiToken,
      },
      body: JSON.stringify({ number: telefone, text: texto }),
    });
    const respBody = await resp.text();
    console.log(`[Uazapi] Status HTTP: ${resp.status} | Corpo da resposta: ${respBody}`);
    if (!resp.ok) {
      console.error(`[Uazapi] FALHA no envio - status ${resp.status}`);
      return;
    }
    console.log(`[Uazapi] Mensagem enviada com sucesso para ${telefone}`);
  } catch (err) {
    console.error('[Uazapi] Erro de rede ao enviar mensagem:', err);
  }
}

/**
 * Envia midia (imagem, documento, audio, video) via Uazapi (POST /send/media).
 * `file` aceita URL publica ou base64. `tipo` segue o enum da uazapi:
 * image | video | videoplay | document | audio | myaudio | ptt | ptv | sticker.
 */
async function enviarMidiaUazapi(
  telefone: string,
  file: string,
  tipo: 'image' | 'video' | 'document' | 'audio' | 'ptt' = 'image',
  legenda?: string,
  docName?: string
): Promise<boolean> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL')?.trim();
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN')?.trim();
  if (!uazapiUrl || !uazapiToken || !file) {
    console.error('[Uazapi] Configuracao ausente ou arquivo vazio - abortando envio de midia');
    return false;
  }
  try {
    const resp = await fetch(`${uazapiUrl}/send/media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': uazapiToken,
      },
      body: JSON.stringify({
        number: telefone,
        type: tipo,
        file,
        ...(legenda ? { text: legenda } : {}),
        ...(docName ? { docName } : {}),
      }),
    });
    const respBody = await resp.text();
    console.log(`[Uazapi] Midia - Status HTTP: ${resp.status} | Corpo: ${respBody}`);
    if (!resp.ok) {
      console.error(`[Uazapi] FALHA no envio de midia - status ${resp.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Uazapi] Erro de rede ao enviar midia:', err);
    return false;
  }
}

/**
 * Baixa (via Uazapi) o arquivo de uma mensagem de midia recebida e retorna a
 * URL publica hospedada pela Uazapi (valida por ~2 dias). Usa `return_link`
 * (padrao true), sem pedir base64 pra nao pesar o payload.
 */
async function baixarMidiaUazapi(messageId: string): Promise<{ fileUrl: string | null; mimetype: string | null }> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL')?.trim();
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN')?.trim();
  if (!uazapiUrl || !uazapiToken || !messageId) {
    console.error('[Uazapi] Configuracao ausente ou messageId vazio - abortando download de midia');
    return { fileUrl: null, mimetype: null };
  }
  try {
    const resp = await fetch(`${uazapiUrl}/message/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': uazapiToken,
      },
      body: JSON.stringify({ id: messageId, return_link: true, return_base64: false }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[Uazapi] FALHA ao baixar midia - status ${resp.status}: ${err}`);
      return { fileUrl: null, mimetype: null };
    }
    const data = await resp.json();
    return { fileUrl: data?.fileURL || data?.fileUrl || null, mimetype: data?.mimetype || null };
  } catch (err) {
    console.error('[Uazapi] Erro de rede ao baixar midia:', err);
    return { fileUrl: null, mimetype: null };
  }
}

// Tipos de mensagem da uazapi que representam midia (nao texto puro)
const TIPOS_MIDIA = ['image', 'video', 'document', 'audio', 'ptt', 'sticker'];

// Numero do vendedor (Square) que recebe a notificacao quando um formando
// confirma interesse em comprar o material fotografico. Formato internacional.
const NUMERO_VENDEDOR_MATERIAL_LEGADO = '5592993809136';

/**
 * Notifica o vendedor (Square) no WhatsApp quando um formando confirma
 * interesse em comprar, e registra em notificacoes_venda. Usado apenas
 * no fluxo legado (contatos sem conversa_estado ainda).
 */

/**
 * Divide o texto de valor/opcoes (que pode conter mais de uma opcao, ex:
 * "800,00 a vista ou no cartao em 6x de 200,00") em uma lista numerada de
 * planos, pra exibir de forma clara na notificacao ao vendedor.
 */
function formatarPlanosDisponiveisLegado(texto?: string | null): string {
  if (!texto || String(texto).trim() === '') return 'Nao especificado';

  const partes = String(texto)
    .split(/\r?\n|;|\s+ou\s+/gi)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (partes.length <= 1) return `▫️ ${String(texto).trim()}`;

  return partes
    .map((p, i) => `▫️ Plano ${String(i + 1).padStart(2, '0')}: ${p}`)
    .join('\n');
}

async function notificarInteresseDeCompraLegado(
  sb: any,
  contatoCampanhaId: string | undefined,
  campanhaId: string | undefined,
  nomeContato: string,
  contatoCampanha: any,
  planoEscolhido: string,
  formaPagamentoEscolhida: string
): Promise<void> {
  const mensagem = `🎉 *Novo interessado em comprar material fotografico!*\n\n` +
    `👤 *Nome:* ${nomeContato}\n` +
    `📄 *Contrato:* ${contatoCampanha?.numero_contrato || 'Nao informado'}\n\n` +
    `💰 *Planos disponiveis:*\n${formatarPlanosDisponiveisLegado(contatoCampanha?.valor_oferecido ?? contatoCampanha?.opcoes_plano)}\n\n` +
    `✅ *Plano escolhido:* ${planoEscolhido || contatoCampanha?.opcoes_plano || 'Nao especificado'}\n` +
    `💳 *Pagamento:* ${formaPagamentoEscolhida || contatoCampanha?.formas_pagamento || 'Nao especificado'}\n\n` +
    `👉 Acesse o sistema para enviar o link de pagamento.`;

  await enviarMensagemUazapi(NUMERO_VENDEDOR_MATERIAL_LEGADO, mensagem);

  await sb.from('notificacoes_venda').insert({
    contato_campanha_id: contatoCampanhaId || null,
    campanha_id: campanhaId || null,
    mensagem_enviada: mensagem,
  });
}

/**
 * Fluxo padrao de IA (sem campanha ativa)
 */
async function executarFluxoIaPadrao(
  telefone: string,
  texto: string,
  sb: any
): Promise<void> {
  const telefoneNormalizado = normalizePhone(telefone);

  let { data: contato } = await sb
    .from('contacts')
    .select('*')
    .eq('phone', telefoneNormalizado)
    .maybeSingle();

  if (!contato) {
    const { data: novoContato } = await sb
      .from('contacts')
      .insert({
        phone: telefoneNormalizado,
        name: telefoneNormalizado,
        status: 'lead',
        assigned_to: 'ia',
      })
      .select()
      .single();
    contato = novoContato;
  }

  const { data: mensagens } = await sb
    .from('messages')
    .select('*')
    .eq('contact_id', contato.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const historico = (mensagens || []).reverse();
  const textosFormandoSaaS = (mensagens || []).filter((m: any) => m.direction === 'in').map((m: any) => (m.content || '').toLowerCase());

  const { data: baseConhecimentoBrutaPadrao } = await sb
    .from('base_conhecimento_global')
    .select('pergunta, resposta, aplica_em')
    .eq('ativo', true);

  // Sem campanha ativa (fluxo padrao), so faz sentido usar as perguntas
  // genericas ("todos"), nunca as especificas de agendamento ou venda de material
  const baseConhecimento = (baseConhecimentoBrutaPadrao || []).filter(
    (item: any) => (item.aplica_em || 'todos') === 'todos'
  );

  const resposta = await chamarGemini('', texto, {
    nome: contato.name || 'Formando',
    telefone: telefoneNormalizado,
    curso: contato.course,
    numero_contrato: contato.contract_number,
    endereco: '',
  }, [], baseConhecimento || []);

  if (!resposta) {
    await sb.from('messages').insert({
      contact_id: contato.id,
      direction: 'in',
      content: texto,
      sent_by: 'contato',
    });
    return;
  }

  // Processa agendamento
  if (resposta.includes('###AGENDAMENTO_CONFIRMADO###')) {
    try {
      const jsonMatch = resposta.match(/###AGENDAMENTO_CONFIRMADO###([\s\S]*?)###FIM###/);
      if (jsonMatch && jsonMatch[1]) {
        const dados = JSON.parse(jsonMatch[1].trim());

        const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(dados.data);
        if (!dataValida) {
          console.error('[SaaS] Data invalida recebida da IA, abortando insert:', dados.data);
        } else {
          const horarioOuTurno = dados.turno || dados.horario || '';
          const dataValidada = validarDataHorarioMencionado(dados.data, horarioOuTurno, textosFormandoSaaS, []);

          if (!dataValidada) {
            console.error('[SaaS] ALERTA: IA tentou confirmar agendamento sem validacao — data/horario nao encontrado nas mensagens do formando. contact_id:', contato.id, 'dados:', dados);

            await sb.from('contacts').update({ revisao_humana: true }).eq('id', contato.id);
            console.log(`[SaaS] Contato ${contato.id} marcado para revisao humana — possivel agendamento nao confirmado pelo cliente`);
          } else {

          await sb.from('appointments').insert({
            graduand_name: contato.name || 'Formando',
            contract_number: contato.contract_number || 'Nao Informado',
            course: contato.course || 'Outros',
            date: dados.data,
            shift: dados.turno || dados.horario || '',
            location: dados.local || 'RESIDENCIA',
            status: 'Em negociacao',
            contact_id: contato.id,
            seller_name: 'INDEFINIDO',
          });
          console.log(`[SaaS] Agendamento inserido para: ${contato.name}`);
          }
        }
      }
    } catch (e) {
      console.error('[Erro] Falha ao parsear JSON de agendamento:', e);
    }
  }

  // Processa overflow
  if (resposta.includes('###OVERFLOW###')) {
    await sb.from('contacts').update({ assigned_to: 'manual' }).eq('id', contato.id);
  }

  const respostaLimpa = resposta
    .replace(/###AGENDAMENTO_CONFIRMADO###[\s\S]*?###FIM###/g, '')
    .replace(/###OVERFLOW###/g, '')
    .replace(/###SEM_INTERESSE###/g, '')
    .trim();

  await sb.from('messages').insert([
    { contact_id: contato.id, direction: 'in', content: texto, sent_by: 'contato' },
    { contact_id: contato.id, direction: 'out', content: respostaLimpa, sent_by: 'ia' },
  ]);

  if (respostaLimpa) await enviarMensagemUazapi(telefone, respostaLimpa);
}

/**
 * Valida se a data e horario/turno confirmados pela IA realmente aparecem
 * nas mensagens enviadas pelo formando. Comparacao simples de texto.
 */
function validarDataHorarioMencionado(
  data: string,
  horarioOuTurno: string,
  textosFormando: string[],
  opcoesAgendamento: any[] = []
): boolean {
  if (!data || !horarioOuTurno || textosFormando.length === 0) return false;

  const horarioLower = horarioOuTurno.toLowerCase().trim();
  const todosTextos = textosFormando.join(' ');
  const textosSemAcento = todosTextos.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const [ano, mes, dia] = data.split('-');
  if (!ano || !mes || !dia) return false;

  // Se a campanha tem opcoes de agendamento, verifica se a data e valida
  const dataEhValida = opcoesAgendamento.length === 0 ||
    opcoesAgendamento.some((o: any) => o.data === data);
  if (!dataEhValida) return false;

  // Se ha apenas uma data disponivel, o formando nao precisa mencionar
  // a data explicitamente — basta escolher o turno/horario
  const unicaData = opcoesAgendamento.length === 1;
  if (!unicaData) {
    const variantesData = [
      data,
      `${dia}/${mes}`,
      `${dia}/${mes}/${ano}`,
      `dia ${parseInt(dia, 10)}`,
      `dia ${dia}`,
      `dia ${parseInt(dia, 10)} de ${parseInt(mes, 10)}`,
      `${parseInt(dia, 10)}/${parseInt(mes, 10)}`,
    ];
    const dataEncontrada = variantesData.some((v) => todosTextos.includes(v.toLowerCase()));
    if (!dataEncontrada) return false;
  }

  // Para horarios (HH:MM), aceita tambem sem zero a esquerda
  if (/^\d{2}:\d{2}$/.test(horarioLower)) {
    const [h, m] = horarioLower.split(':');
    const semZero = `${parseInt(h, 10)}:${m}`;
    return todosTextos.includes(horarioLower) || todosTextos.includes(semZero);
  }

  // Para turnos (manha, tarde, noite), aceita com e sem acento
  const horarioSemAcento = horarioLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (textosSemAcento.includes(horarioSemAcento)) return true;

  // Se o turno nao foi encontrado literalmente, verifica se o formando
  // mencionou um horario que pertence a esse turno, baseado nas opcoes
  const opcaoData = opcoesAgendamento.find((o: any) => o.data === data);
  if (opcaoData && Array.isArray(opcaoData.turnos)) {
    for (const turnoLabel of opcaoData.turnos) {
      const labelSemAcento = (turnoLabel || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (labelSemAcento.includes(horarioSemAcento)) {
        const horariosMatch = turnoLabel.match(/(\d{1,2})\s*[:h]\s*(\d{2})?/gi);
        if (horariosMatch) {
          for (const h of horariosMatch) {
            const hLimpo = h.toLowerCase().replace(/\s+/g, '');
            const hDoisPontos = hLimpo.replace('h', ':00');
            if (textosSemAcento.includes(hLimpo) || todosTextos.includes(hLimpo) ||
                textosSemAcento.includes(hDoisPontos) || todosTextos.includes(hDoisPontos)) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Fluxo de Campanha com IA conduzindo
 */
async function executarFluxoCampanha(
  contatoCampanha: any,
  campanha: any,
  telefone: string,
  textoRecebido: string,
  sb: any,
  telefoneNormalizado: string
): Promise<void> {
  const nomeContato = contatoCampanha.nome || 'Formando';
  const enderecoContato = contatoCampanha.local || '';
  const statusAtual = contatoCampanha.status;

  console.log(`[Campanha] Fluxo IA para ${nomeContato}, status: ${statusAtual}`);

  // Busca ou cria contact na tabela contacts
  let contactId: string | undefined;
  const { data: existingContact } = await sb
    .from('contacts')
    .select('id')
    .eq('phone', telefoneNormalizado)
    .maybeSingle();

  if (existingContact) {
    contactId = existingContact.id;
  } else {
    const { data: newContact } = await sb
      .from('contacts')
      .insert({
        phone: telefoneNormalizado,
        name: nomeContato,
        status: 'lead',
        assigned_to: 'ia',
      })
      .select('id')
      .single();
    contactId = newContact?.id;
  }

  // Salva mensagem recebida
  if (contactId) {
    await sb.from('messages').insert({
      contact_id: contactId,
      direction: 'in',
      content: textoRecebido,
      sent_by: 'contato',
    });

    // Incrementa unread_count
    const { data: contactData } = await sb
      .from('contacts')
      .select('unread_count')
      .eq('id', contactId)
      .maybeSingle();
    if (contactData) {
      await sb
        .from('contacts')
        .update({ unread_count: (contactData.unread_count || 0) + 1 })
        .eq('id', contactId);
    }
  }

  // Busca historico de mensagens para contexto (se em_conversa ou agendado)
  let history: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let textosFormando: string[] = [];

  if (statusAtual === 'em_conversa' || statusAtual === 'agendado') {
    const { data: mensagens } = await sb
      .from('messages')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(20);

    textosFormando = (mensagens || []).filter((m: any) => m.direction === 'in').map((m: any) => (m.content || '').toLowerCase());

    history = (mensagens || []).map((m: any) => ({
      role: m.direction === 'in' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    // Gemini requer que o historico comece com 'user'
    while (history.length > 0 && history[0].role !== 'user') {
      history.shift();
    }
  }

  // Monta prompt com dados da campanha
  const promptIa = campanha?.prompt_ia || '';

  // Dados do contato para substituicao de variaveis no prompt
  const contatoData = {
    nome: nomeContato,
    telefone: telefoneNormalizado,
    curso: contatoCampanha.curso,
    numero_contrato: contatoCampanha.numero_contrato,
    endereco: enderecoContato,
    valor_tabela: contatoCampanha.valor_tabela,
    valor_oferecido: contatoCampanha.valor_oferecido,
    formas_pagamento: contatoCampanha.formas_pagamento,
    opcoes_plano: contatoCampanha.opcoes_plano,
    prazo_reciclagem: contatoCampanha.prazo_reciclagem,
    quantidade_fotos: contatoCampanha.quantidade_fotos,
  };

  // Busca base de conhecimento global (filtrada pelo tipo de atendimento da campanha,
  // pra nao misturar respostas pensadas pra agendamento/visita com venda de material)
  const { data: baseConhecimentoBruta } = await sb
    .from('base_conhecimento_global')
    .select('pergunta, resposta, aplica_em')
    .eq('ativo', true);

  const tipoAtendimentoCampanha = campanha?.tipo_atendimento || 'todos';
  const baseConhecimento = (baseConhecimentoBruta || []).filter((item: any) => {
    const escopo = item.aplica_em || 'todos';
    return escopo === 'todos' || escopo === tipoAtendimentoCampanha;
  });

  // Se ja agendado, busca agendamento mais recente para contexto
  let promptComContexto = promptIa;
  if (statusAtual === 'agendado' && contactId) {
    const { data: agendamentoRecente } = await sb
      .from('appointments')
      .select('date, shift, location')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (agendamentoRecente) {
      promptComContexto +=
        `\n\nATENCAO - ESTADO ATUAL: Este formando JA TEM uma visita confirmada para ${agendamentoRecente.date} no turno ${agendamentoRecente.shift}, endereco ${agendamentoRecente.location || enderecoContato || 'Nao informado'}. NAO reinicie a apresentacao nem ofereca novas datas. Se ele disser apenas algo como 'obrigado', 'blz', 'ok', responda de forma breve e cordial, sem repetir dados do agendamento. Se ele pedir explicitamente para mudar a data/turno, trate como reagendamento: pergunte qual das opcoes validas em {opcoes_agendamento} ele prefere - NUNCA aceite, confirme ou gere o marcador ###AGENDAMENTO_CONFIRMADO### com uma data fora dessa lista, mesmo em reagendamento.`;
    }
  }

  // Chama Gemini com historico e prompt da campanha
  const resposta = await chamarGemini(
    promptComContexto,
    textoRecebido,
    contatoData,
    history,
    baseConhecimento || [],
    campanha?.opcoes_agendamento || []
  );

  if (!resposta) {
    console.log('[Campanha] Gemini nao respondeu');
    return;
  }

  console.log(`[Campanha] Resposta Gemini: ${resposta.substring(0, 100)}...`);
  console.log('[Campanha] Resposta COMPLETA para debug:', resposta);
  console.log('[Campanha] Contem marcador AGENDAMENTO_CONFIRMADO?', resposta.includes('###AGENDAMENTO_CONFIRMADO###'));

  // Processa marcadores
  let novoStatus = statusAtual;
  let assignedTo = 'ia';

  // ###AGENDAMENTO_CONFIRMADO###
  if (resposta.includes('###AGENDAMENTO_CONFIRMADO###')) {
    try {
      const jsonMatch = resposta.match(/###AGENDAMENTO_CONFIRMADO###([\s\S]*?)###FIM###/);
      if (jsonMatch && jsonMatch[1]) {
        const dadosAgendamento = JSON.parse(jsonMatch[1].trim());

        const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(dadosAgendamento.data);
        if (!dataValida) {
          console.error('[Campanha] Data invalida recebida da IA, abortando insert:', dadosAgendamento.data);
        } else {
          // VALIDACAO SERVER-SIDE: verifica se o formando realmente mencionou
          // a data e horario/turno em alguma mensagem anterior (direction='in')
          const horarioOuTurno = dadosAgendamento.turno || dadosAgendamento.horario || '';
          const dataValidada = validarDataHorarioMencionado(dadosAgendamento.data, horarioOuTurno, textosFormando, campanha?.opcoes_agendamento || []);

          if (!dataValidada) {
            console.error('[Campanha] ALERTA: IA tentou confirmar agendamento sem validacao — data/horario nao encontrado nas mensagens do formando. contact_id:', contactId, 'dados:', dadosAgendamento);

            await sb
              .from('contatos_campanha')
              .update({ revisao_humana: true })
              .eq('id', contatoCampanha.id);

            if (contactId) {
              await sb.from('contacts').update({ revisao_humana: true }).eq('id', contactId);
            }

            console.log(`[Campanha] Contato ${nomeContato} marcado para revisao humana — possivel agendamento nao confirmado pelo cliente`);
          } else {

        const { error: appointmentError } = await sb.from('appointments').insert({
          graduand_name: contatoCampanha.nome,
          contract_number: contatoCampanha.numero_contrato || 'Nao Informado',
          course: contatoCampanha.curso || 'Outros',
          date: dadosAgendamento.data,
          shift: dadosAgendamento.turno || dadosAgendamento.horario || '',
          location: dadosAgendamento.local || enderecoContato || 'RESIDENCIA',
          status: 'Em negociacao',
          contact_id: contactId,
          campaign_contact_id: contatoCampanha.id,
          campaign_id: campanha?.id,
          seller_name: 'INDEFINIDO',
        });
        if (appointmentError) {
          console.error('[Campanha] ERRO ao inserir agendamento:', JSON.stringify(appointmentError), '| Dados enviados:', JSON.stringify(dadosAgendamento));
        } else {
          console.log(`[Campanha] Agendamento inserido para: ${nomeContato}`);
        }
        novoStatus = 'agendado';
        }
        }
      }
    } catch (e) {
      console.error('[Erro] Falha ao parsear agendamento - JSON recebido:', jsonMatch?.[1], '| Erro:', e);
    }
  }

  // ###QUER_COMPRAR### (fluxo de venda de material fotografico)
  if (resposta.includes('###QUER_COMPRAR###')) {
    let planoEscolhido = '';
    let formaPagamentoEscolhida = '';
    try {
      const jsonMatchVenda = resposta.match(/###QUER_COMPRAR###([\s\S]*?)###FIM###/);
      if (jsonMatchVenda && jsonMatchVenda[1]) {
        const dadosVenda = JSON.parse(jsonMatchVenda[1].trim());
        planoEscolhido = dadosVenda.plano_escolhido || '';
        formaPagamentoEscolhida = dadosVenda.forma_pagamento_escolhida || '';
      }
    } catch (e) {
      console.error('[Campanha] Falha ao parsear QUER_COMPRAR:', e);
    }

    novoStatus = 'interessado_compra';

    await notificarInteresseDeCompraLegado(
      sb,
      contatoCampanha.id,
      campanha?.id,
      nomeContato,
      contatoCampanha,
      planoEscolhido,
      formaPagamentoEscolhida
    );

    console.log(`[Campanha] ${nomeContato} confirmou interesse de compra (fluxo legado) - Square notificado`);
  }

  // ###SEM_INTERESSE###
  if (resposta.includes('###SEM_INTERESSE###')) {
    novoStatus = 'sem_interesse';
    console.log(`[Campanha] Contato ${nomeContato} sem interesse`);
  }

  // ###OVERFLOW###
  if (resposta.includes('###OVERFLOW###')) {
    novoStatus = 'transferido_humano';
    assignedTo = 'manual';
    console.log(`[Campanha] Overflow para: ${nomeContato}`);
  }

  // Atualiza status do contato na campanha
  await sb
    .from('contatos_campanha')
    .update({
      status: novoStatus,
      follow_up_enviado: true, // Marca que houve interacao
      interagiu_em: new Date().toISOString(),
    })
    .eq('id', contatoCampanha.id);

  // Se overflow, atualiza contacts tambem
  if (assignedTo === 'manual' && contactId) {
    await sb.from('contacts').update({ assigned_to: 'manual' }).eq('id', contactId);
  }

  // Limpa resposta e envia
  const respostaLimpa = resposta
    .replace(/###AGENDAMENTO_CONFIRMADO###[\s\S]*?###FIM###/g, '')
    .replace(/###QUER_COMPRAR###[\s\S]*?###FIM###/g, '')
    .replace(/###OVERFLOW###/g, '')
    .replace(/###SEM_INTERESSE###/g, '')
    .trim();

  // Salva resposta da IA
  if (contactId && respostaLimpa) {
    await sb.from('messages').insert({
      contact_id: contactId,
      direction: 'out',
      content: respostaLimpa,
      sent_by: 'ia',
    });
  }

  // Envia mensagem imediatamente
  if (respostaLimpa) {
    await enviarMensagemUazapi(telefone, respostaLimpa);
  }

  // Se estava em saudacao_enviada ou sem_retorno, agora vai para em_conversa
  if (statusAtual === 'saudacao_enviada' || statusAtual === 'sem_retorno') {
    await sb
      .from('contatos_campanha')
      .update({ status: 'em_conversa' })
      .eq('id', contatoCampanha.id);
  }
}

/**
 * Funcao Principal do Webhook
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('OK', { headers: corsHeaders });
  }

  try {
    const body: UazapiWebhookBody = await req.json().catch(() => null);
    console.log('[RAW BODY]', JSON.stringify(body));
    if (!body) return new Response('OK', { headers: corsHeaders });

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const event = (body as any).event || '';
    const msg = (body as any).message || body.message;
    const data = (body as any).data || body.data;

    // Handler para eventos de ACK
    if (event.includes('ack') || event.includes('update') || (data?.status && !msg?.text)) {
      console.log('[ACK EVENT]', JSON.stringify(body, null, 2));

      const msgId = data?.key?.id || data?.id || msg?.key?.id;
      const ackStatus = data?.status || msg?.status;

      if (msgId && ackStatus) {
        let newStatus = 'sent';
        const statusLower = String(ackStatus).toLowerCase();
        if (statusLower === 'read' || ackStatus === 3 || statusLower === '3') {
          newStatus = 'read';
        } else if (statusLower === 'delivered' || ackStatus === 2 || statusLower === '2') {
          newStatus = 'delivered';
        }

        if (newStatus !== 'sent') {
          await sb.from('messages').update({ status: newStatus }).eq('id', msgId);
          console.log(`[ACK] Mensagem ${msgId} atualizada para: ${newStatus}`);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ignora mensagens enviadas pelo proprio bot
    const fromMe = msg?.fromMe || data?.key?.fromMe;
    if (fromMe) {
      return new Response(JSON.stringify({ success: true, message: 'Ignorado: enviado por mim' }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Extrai telefone, tipo de mensagem e texto/legenda
    const remoteJid = msg?.chatid || (body as any).chat?.wa_chatid || '';
    const telefoneCliente = remoteJid.split('@')[0];
    const tipoMensagem = (msg?.messageType || '').toLowerCase();
    const ehMidia = TIPOS_MIDIA.includes(tipoMensagem);
    const legendaOuTexto = msg?.text || msg?.content?.text || (body as any).chat?.wa_lastMessageTextVote || '';

    // Extrai message_id de todos os locais possiveis do payload da uazapi
    const rawMessageId = msg?.key?.id || data?.key?.id || (body as any).key?.id || '';

    // So descarta se nao tiver telefone, ou se nao tiver nem texto nem midia
    if (!telefoneCliente || (!legendaOuTexto && !ehMidia)) {
      return new Response('OK', { headers: corsHeaders });
    }

    // Se for midia (foto, documento, audio...), baixa o arquivo na Uazapi pra
    // obter uma URL publica que possamos salvar/encaminhar
    let mediaUrlRecebida: string | null = null;
    if (ehMidia && rawMessageId) {
      const download = await baixarMidiaUazapi(rawMessageId);
      mediaUrlRecebida = download.fileUrl;
      console.log(`[Webhook] Midia (${tipoMensagem}) baixada: ${mediaUrlRecebida || 'FALHOU'}`);
    }

    const placeholdersPorTipoMidia: Record<string, string> = {
      image: '[Imagem recebida]',
      video: '[Video recebido]',
      document: '[Documento recebido]',
      audio: '[Audio recebido]',
      ptt: '[Audio recebido]',
      sticker: '[Figurinha recebida]',
    };

    // Texto usado no historico/dedup/IA: legenda quando houver, senao um
    // placeholder legivel de acordo com o tipo de midia
    const textoRecebido = legendaOuTexto || placeholdersPorTipoMidia[tipoMensagem] || '[Midia recebida]';

    const telefoneNormalizado = normalizePhone(telefoneCliente);

    console.log(`[Webhook] Mensagem de ${telefoneCliente}: "${textoRecebido}"`);
    console.log(`[Webhook] message_id extraido: "${rawMessageId}" | tel_normalizado: ${telefoneNormalizado}`);
    console.log(`[Webhook] msg.key:`, JSON.stringify(msg?.key), '| data.key:', JSON.stringify(data?.key));

    // ========================================================================
    // DEDUPLICACAO ROBUSTA — executa antes de QUALQUER processamento (IA, DB)
    // Estrategia dupla:
    //   1. Por message_id (se presente) — chave primaria na tabela de dedup
    //   2. Por telefone + conteudo + janela de 15s — cobre reenvios com IDs diferentes
    // ========================================================================
    const JANELA_DEDUP_SEGUNDOS = 15;
    const ehDuplicata = await verificarDuplicata(sb, rawMessageId, telefoneNormalizado, textoRecebido, JANELA_DEDUP_SEGUNDOS);

    if (ehDuplicata) {
      console.log(`[Webhook] DUPLICATA detectada — ignorando. msg_id="${rawMessageId}" tel=${telefoneNormalizado} texto="${textoRecebido.substring(0, 50)}"`);
      return new Response(JSON.stringify({ success: true, message: 'Duplicata ignorada' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Registra o evento como processado o mais cedo possivel
    await registrarEventoProcessado(sb, rawMessageId, telefoneNormalizado, textoRecebido);
    console.log(`[Webhook] Evento registrado como processado: msg_id="${rawMessageId}"`);

    // VERIFICACAO DE MODO MANUAL: se o contato esta em modo manual, salva a mensagem mas nao chama a IA
    const { data: contatoManual } = await sb
      .from('contacts')
      .select('id, assigned_to, unread_count')
      .eq('phone', telefoneNormalizado)
      .maybeSingle();

    if (contatoManual?.assigned_to === 'manual') {
      console.log(`[Webhook] Contato ${telefoneNormalizado} em modo manual - salvando mensagem sem acionar IA`);
      await sb.from('messages').insert({
        contact_id: contatoManual.id,
        direction: 'in',
        content: textoRecebido,
        sent_by: 'contato',
        message_type: ehMidia ? tipoMensagem : 'text',
        media_url: mediaUrlRecebida,
      });
      await sb.from('contacts').update({ unread_count: (contatoManual.unread_count || 0) + 1 }).eq('id', contatoManual.id);

      // Se o cliente mandou uma FOTO e ele tem uma venda de material fotografico
      // pendente (link de pagamento ja enviado), trata como comprovante de
      // pagamento: encaminha pro vendedor (Square) e registra no contato da campanha
      if (tipoMensagem === 'image' && mediaUrlRecebida) {
        const { data: contatoVendaComprovante } = await sb
          .from('contatos_campanha')
          .select('id, campanha_id, nome, numero_contrato, status, campanhas!inner(tipo_atendimento)')
          .eq('telefone', telefoneNormalizado)
          .eq('campanhas.tipo_atendimento', 'venda_material')
          .in('status', ['interessado_compra', 'comprou'])
          .order('atualizado_em', { ascending: false })
          .maybeSingle();

        if (contatoVendaComprovante) {
          console.log(`[Webhook] Comprovante de pagamento recebido de ${contatoVendaComprovante.nome}`);

          await sb
            .from('contatos_campanha')
            .update({ comprovante_url: mediaUrlRecebida, comprovante_recebido_em: new Date().toISOString() })
            .eq('id', contatoVendaComprovante.id);

          const legendaComprovante =
            `📸 *Comprovante de pagamento recebido!*\n\n` +
            `👤 *Nome:* ${contatoVendaComprovante.nome}\n` +
            `📄 *Contrato:* ${contatoVendaComprovante.numero_contrato || 'Nao informado'}\n\n` +
            `👉 Confira o comprovante acima e finalize a liberacao do material.`;

          await enviarMidiaUazapi(NUMERO_VENDEDOR_MATERIAL_LEGADO, mediaUrlRecebida, 'image', legendaComprovante);

          await sb.from('notificacoes_venda').insert({
            contato_campanha_id: contatoVendaComprovante.id,
            campanha_id: contatoVendaComprovante.campanha_id,
            mensagem_enviada: legendaComprovante,
          });
        }
      }

      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'manual_mode' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 0. Verifica se ha conversa_estado aguardando resposta (state machine)
    const { data: conversaEstado } = await sb
      .from('conversa_estado')
      .select('*, campanhas(*)')
      .eq('contato_telefone', telefoneNormalizado)
      .eq('aguardando_resposta', true)
      .maybeSingle();

    if (conversaEstado) {
      console.log(`[Webhook] ConversaEstado encontrada para ${telefoneNormalizado} - acionando campanha-processor`);

      // Chama campanha-processor com acao resposta_recebida
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/campanha-processor`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            acao: 'resposta_recebida',
            telefone: telefoneNormalizado,
            campanha_id: conversaEstado.campanha_id,
            texto_resposta: textoRecebido,
            message_type: ehMidia ? tipoMensagem : 'text',
            media_url: mediaUrlRecebida,
          }),
        });
      } catch (err) {
        console.error('[Webhook] Erro ao chamar campanha-processor:', err);
      }

      return new Response(JSON.stringify({ success: true, message: 'Processado via state machine' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Verifica se contato esta em campanha ativa
    // Status validos para atendimento IA: saudacao_enviada, sem_retorno, em_conversa, agendado
    const { data: contatoCampanha, error } = await sb
      .from('contatos_campanha')
      .select('*, campanhas(*)')
      .eq('telefone', telefoneNormalizado)
      .in('status', ['saudacao_enviada', 'sem_retorno', 'em_conversa', 'agendado'])
      .limit(1)
      .maybeSingle();

    if (error) console.error('Erro ao buscar contato campanha:', error);

    // FLUXO DE CAMPANHA ATIVA
    if (contatoCampanha && !error) {
      const campanha = contatoCampanha.campanhas as any;
      console.log(`[Campanha Ativa] ${contatoCampanha.nome} - status: ${contatoCampanha.status}`);
      await executarFluxoCampanha(
        contatoCampanha,
        campanha,
        telefoneCliente,
        textoRecebido,
        sb,
        telefoneNormalizado
      );

      return new Response(JSON.stringify({ success: true, message: 'Processado na campanha' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // FLUXO PADRAO
    const { data: contatoParaUnread } = await sb
      .from('contacts')
      .select('id, unread_count')
      .eq('phone', telefoneNormalizado)
      .maybeSingle();

    if (contatoParaUnread) {
      await sb
        .from('contacts')
        .update({ unread_count: (contatoParaUnread.unread_count || 0) + 1 })
        .eq('id', contatoParaUnread.id);
    }

    await executarFluxoIaPadrao(telefoneCliente, textoRecebido, sb);

    return new Response(JSON.stringify({ success: true, message: 'Processado no fluxo comum' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (globalError) {
    console.error('[Erro Critico Webhook]:', globalError);
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
