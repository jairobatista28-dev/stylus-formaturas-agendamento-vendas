import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface BlocoMensagem {
  tipo: 'texto' | 'esperar_tempo' | 'aguardar_resposta';
  conteudo?: string;
  segundos?: number;
}

interface OpcaoAgendamento {
  data: string;
  turnos?: string[];  // Novo formato: ["Manha (8h as 12h)", "Tarde (13h as 17h)"]
  periodos?: { turno: string; horario: string }[];  // Formato antigo (compatibilidade)
  horarios?: string[];  // Atendimento no escritorio: ["09:30", "10:30", ...]
}

/**
 * Parser de mensagem - divide em blocos usando marcadores
 */
function parsearMensagem(mensagem: string): BlocoMensagem[] {
  const blocos: BlocoMensagem[] = [];

  // Regex para capturar [aguardar_resposta] e [esperar Xs]
  const regex = /\[(aguardar_resposta|esperar\s+(\d+)s?)\]/gi;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(mensagem)) !== null) {
    // Texto antes do marcador
    const textoAntes = mensagem.slice(lastIndex, match.index).trim();
    if (textoAntes) {
      blocos.push({ tipo: 'texto', conteudo: textoAntes });
    }

    // Bloco do marcador
    const marcador = match[1].toLowerCase();
    if (marcador === 'aguardar_resposta') {
      blocos.push({ tipo: 'aguardar_resposta' });
    } else if (marcador.startsWith('esperar')) {
      const segundos = parseInt(match[2]) || 5;
      blocos.push({ tipo: 'esperar_tempo', segundos });
    }

    lastIndex = match.index + match[0].length;
  }

  // Texto final apos ultimo marcador
  const textoFinal = mensagem.slice(lastIndex).trim();
  if (textoFinal) {
    blocos.push({ tipo: 'texto', conteudo: textoFinal });
  }

  // Se nenhum bloco, trata como texto unico
  if (blocos.length === 0 && mensagem.trim()) {
    blocos.push({ tipo: 'texto', conteudo: mensagem.trim() });
  }

  return blocos;
}

const ESCRITORIO_ENDERECO = 'Escritorio - Rua Judith Motta, Parque 10 de Novembro, Manaus - AM, CEP 69055-280';

// Numero do vendedor (Square) que recebe a notificacao quando um formando
// confirma interesse em comprar o material fotografico. Formato internacional.
const NUMERO_VENDEDOR_MATERIAL = '5592993809136';

// Dados de venda de um contato de campanha, usados apenas quando
// campanha.tipo_atendimento === 'venda_material'
interface DadosVenda {
  numero_contrato?: string;
  valor_tabela?: string | null;
  valor_oferecido?: string | null;
  formas_pagamento?: string | null;
  opcoes_plano?: string | null;
  prazo_reciclagem?: string | null;
}

/**
 * Renderiza opcoes de agendamento de forma literal
 */
function renderizarOpcoesAgendamento(opcoes: OpcaoAgendamento[], tipoAtendimento: string = 'visita_externa'): string {
  if (!opcoes || opcoes.length === 0) return '';

  return opcoes.map((opcao, idx) => {
    // Formata a data para DD/MM/YYYY
    let dataFormatada = opcao.data;
    if (opcao.data && opcao.data.includes('-')) {
      const [ano, mes, dia] = opcao.data.split('-');
      dataFormatada = `${dia}/${mes}/${ano}`;
    }

    if (tipoAtendimento === 'escritorio') {
      const horariosStr = (opcao.horarios || []).join(', ');
      return `- Opcao ${idx + 1}: ${dataFormatada} — ${horariosStr}`;
    }

    // Usa turnos se existir, senao usa periodos (compatibilidade)
    const turnosStr = opcao.turnos?.join(', ') ||
      opcao.periodos?.map(p => `${p.turno} (${p.horario})`).join(' ') || '';

    return `- Opcao ${idx + 1}: ${dataFormatada} — ${turnosStr}`;
  }).join('\n');
}

/**
 * Substitui variaveis no texto
 */
function substituirVariaveis(
  texto: string,
  nome: string,
  opcoesAgendamento: OpcaoAgendamento[],
  tipoAtendimento: string = 'visita_externa',
  dadosVenda?: DadosVenda
): string {
  let resultado = texto;

  // Substitui {nome}
  resultado = resultado.replace(/\{nome\}/gi, nome || 'Formando');
  resultado = resultado.replace(/\{\{nome\}\}/gi, nome || 'Formando');
  resultado = resultado.replace(/\{nome_formando\}/gi, nome || 'Formando');

  // Substitui {opcoes_agendamento} com renderizacao LITERAL
  const opcoesRenderizadas = renderizarOpcoesAgendamento(opcoesAgendamento, tipoAtendimento);
  resultado = resultado.replace(/\{opcoes_agendamento\}/gi, opcoesRenderizadas);

  // Substitui {datas_disponiveis} tambem (mesmo formato)
  resultado = resultado.replace(/\{datas_disponiveis\}/gi, opcoesRenderizadas);

  // Variaveis exclusivas do fluxo de venda de material fotografico
  if (tipoAtendimento === 'venda_material') {
    resultado = resultado.replace(/\{numero_contrato\}/gi, dadosVenda?.numero_contrato || 'Nao informado');
    resultado = resultado.replace(/\{valor_tabela\}/gi, valorOuPadrao(dadosVenda?.valor_tabela));
    resultado = resultado.replace(/\{valor_oferecido\}/gi, valorOuPadrao(dadosVenda?.valor_oferecido));
    resultado = resultado.replace(/\{formas_pagamento\}/gi, dadosVenda?.formas_pagamento || 'consulte as opcoes disponiveis');
    resultado = resultado.replace(/\{opcoes_plano\}/gi, dadosVenda?.opcoes_plano || 'consulte as opcoes disponiveis');
    resultado = resultado.replace(/\{prazo_reciclagem\}/gi, dadosVenda?.prazo_reciclagem || 'em breve');
  }

  return resultado;
}

/**
 * Retorna o texto de valor (ja formatado pelo usuario na planilha, podendo
 * conter mais de uma opcao, ex: "800,00 a vista ou no cartao em 6x de
 * 200,00") ou um texto padrao quando o campo estiver vazio. Nao tenta
 * converter/parsear como numero: o campo e texto livre para suportar
 * multiplas opcoes de valor/forma de pagamento sem quebrar.
 */
function valorOuPadrao(valor?: string | null): string {
  if (valor === null || valor === undefined || valor.trim() === '') return 'valor sob consulta';
  return valor;
}

/**
 * Calcula jitter aleatorio (base +/- 40%)
 */
function calcularJitter(segundosBase: number): number {
  const jitter = segundosBase * 0.4 * (Math.random() * 2 - 1); // -40% a +40%
  return Math.max(1, Math.round(segundosBase + jitter));
}

/**
 * Envia indicador de digitando via Uazapi
 */
async function enviarTypingIndicator(telefone: string, textoLen: number): Promise<void> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL');
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN');
  const uazapiInstance = Deno.env.get('UAZAPI_INSTANCE');

  if (!uazapiUrl || !uazapiToken) return;

  // Delay proporcional ao tamanho do texto: 30ms por caractere, max 4s
  const typingMs = Math.min(4000, textoLen * 30);

  try {
    await fetch(`${uazapiUrl}/chat/typing/${uazapiInstance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': uazapiToken,
      },
      body: JSON.stringify({
        number: telefone,
        time: typingMs,
      }),
    });
  } catch (err) {
    console.error('[Typing] Erro ao enviar indicador:', err);
  }
}

/**
 * Envia mensagem via Uazapi
 */
async function enviarMensagemUazapi(telefone: string, texto: string): Promise<boolean> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL');
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN');
  const uazapiInstance = Deno.env.get('UAZAPI_INSTANCE');

  if (!uazapiUrl || !uazapiToken || !texto) return false;

  try {
    // Envia indicador de digitando primeiro
    await enviarTypingIndicator(telefone, texto.length);

    const res = await fetch(`${uazapiUrl}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': uazapiToken,
      },
      body: JSON.stringify({
        number: telefone,
        text: texto,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Uazapi] Erro ${res.status}:`, err);
      return false;
    }

    console.log(`[Uazapi] Mensagem enviada para ${telefone}`);
    return true;
  } catch (err) {
    console.error('[Uazapi] Erro ao enviar mensagem:', err);
    return false;
  }
}

/**
 * Notifica o vendedor (Square) no WhatsApp quando um formando confirma
 * interesse em comprar o material fotografico, e registra em notificacoes_venda.
 */
async function notificarInteresseDeCompra(
  sb: any,
  contatoCampanhaId: string | undefined,
  campanhaId: string,
  nomeContato: string,
  dadosVenda: DadosVenda | undefined,
  planoEscolhido: string,
  formaPagamentoEscolhida: string
): Promise<void> {
  const mensagem = `🔔 Novo interessado em comprar material fotografico!\n` +
    `Nome: ${nomeContato}\n` +
    `Contrato: ${dadosVenda?.numero_contrato || 'Nao informado'}\n` +
    `Valor: ${valorOuPadrao(dadosVenda?.valor_oferecido)}\n` +
    `Plano: ${planoEscolhido || dadosVenda?.opcoes_plano || 'Nao especificado'}\n` +
    `Pagamento: ${formaPagamentoEscolhida || dadosVenda?.formas_pagamento || 'Nao especificado'}\n` +
    `\nAcesse o sistema para enviar o link de pagamento.`;

  await enviarMensagemUazapi(NUMERO_VENDEDOR_MATERIAL, mensagem);

  await sb.from('notificacoes_venda').insert({
    contato_campanha_id: contatoCampanhaId || null,
    campanha_id: campanhaId,
    mensagem_enviada: mensagem,
  });
}

/**
 * Verifica limite anti-ban
 */
async function verificarLimiteAntiban(sb: any, campanhaId: string): Promise<{ podeEnviar: boolean; motivo?: string }> {
  // Busca configuracoes da campanha
  const { data: campanha } = await sb
    .from('campanhas')
    .select('rate_limit_hora')
    .eq('id', campanhaId)
    .single();

  const rateLimitHora = campanha?.rate_limit_hora || 40;

  // Conta envios na ultima hora
  const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: logs } = await sb
    .from('envio_log')
    .select('sucesso')
    .eq('campanha_id', campanhaId)
    .gte('created_at', umaHoraAtras);

  if (!logs || logs.length === 0) {
    return { podeEnviar: true };
  }

  const totalEnvios = logs.length;
  const falhas = logs.filter((l: any) => !l.sucesso).length;
  const taxaFalha = falhas / totalEnvios;

  console.log(`[AntiBan] Taxa de falha: ${taxaFalha * 100}% (${falhas}/${totalEnvios})`);

  // Se taxa de falha > 5% e total > 20, pausa campanha
  if (taxaFalha > 0.05 && totalEnvios > 20) {
    await sb
      .from('campanhas')
      .update({ status: 'pausado_risco' })
      .eq('id', campanhaId);

    return { podeEnviar: false, motivo: 'Campanha pausada por risco de banimento (taxa de falha elevada)' };
  }

  // Verifica rate limit por hora
  if (totalEnvios >= rateLimitHora) {
    return { podeEnviar: false, motivo: `Limite de ${rateLimitHora} envios/hora atingido` };
  }

  return { podeEnviar: true };
}

/**
 * Loga envio
 */
async function logarEnvio(sb: any, campanhaId: string, telefone: string, sucesso: boolean): Promise<void> {
  await sb.from('envio_log').insert({
    campanha_id: campanhaId,
    contato_telefone: telefone,
    sucesso,
  });
}

/**
 * Busca base de conhecimento global
 */
async function buscarBaseConhecimentoGlobal(sb: any): Promise<string> {
  try {
    const { data, error } = await sb
      .from('base_conhecimento_global')
      .select('pergunta, resposta')
      .eq('ativo', true)
      .order('ordem', { ascending: true });

    if (error || !data || data.length === 0) {
      return '';
    }

    const formatted = data.map((item: any) =>
      `P: ${item.pergunta}\nR: ${item.resposta}`
    ).join('\n---\n');

    return `## BASE DE CONHECIMENTO GERAL (use para responder perguntas do contato, nunca invente informacoes fora daqui ou da base especifica da campanha):\n${formatted}`;
  } catch (err) {
    console.error('[BaseGlobal] Erro ao buscar:', err);
    return '';
  }
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

  // Extrai componentes da data YYYY-MM-DD
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
      data,                          // 2026-08-07
      `${dia}/${mes}`,               // 07/08
      `${dia}/${mes}/${ano}`,        // 07/08/2026
      `dia ${parseInt(dia, 10)}`,    // dia 7
      `dia ${dia}`,                  // dia 07
      `dia ${parseInt(dia, 10)} de ${parseInt(mes, 10)}`,  // dia 7 de 8
      `${parseInt(dia, 10)}/${parseInt(mes, 10)}`,         // 7/8
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
  // da campanha. Ex: turno "tarde" com opcao "Tarde (13h as 17h)" —
  // se o formando disse "13:00" ou "13h", conta como mencionar "tarde".
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
 * Chama Gemini para resposta contextual
 */
async function chamarGemini(
  sb: any,
  promptIa: string,
  baseConhecimentoCampanha: string,
  textoUsuario: string,
  nomeContato: string,
  opcoesAgendamento: OpcaoAgendamento[],
  history: Array<{ role: string; parts: Array<{ text: string }> }> = [],
  contextoAgendamento: string = '',
  tipoAtendimento: string = 'visita_externa',
  dadosVenda?: DadosVenda
): Promise<string> {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

  if (!geminiApiKey) {
    console.error('[Gemini] API Key nao configurada');
    return '';
  }

  try {
    const baseGlobal = await buscarBaseConhecimentoGlobal(sb);

    let systemInstruction = '';

    if (promptIa) {
      systemInstruction += promptIa;
    }

    if (baseGlobal) {
      systemInstruction += '\n\n' + baseGlobal;
    }

    if (baseConhecimentoCampanha) {
      systemInstruction += `\n\n## BASE DE CONHECIMENTO DA CAMPANHA (tem prioridade sobre a base geral em caso de conflito):\n${baseConhecimentoCampanha}`;
    }

    if (tipoAtendimento === 'venda_material') {
      // ================= FLUXO DE VENDA DE MATERIAL FOTOGRAFICO =================
      systemInstruction += `

## IDENTIDADE E OBJETIVO
Voce e uma assistente de vendas calorosa e humana, falando com ${nomeContato}, que ja e
formando(a) e ja teve contato anterior com a empresa. Seu objetivo e conduzir, com empatia
e argumentacao real, ate a decisao de compra do material fotografico da formatura dele(a).

## CONTEXTO REAL DESSA CAMPANHA (use isso pra dar peso genuino a urgencia, sem exagerar)
Esse formando ja teve uma oportunidade anterior de adquirir o material fotografico da
formatura dele(a) e, por algum motivo, nao finalizou. Essa campanha promocional existe
justamente porque a empresa esta dando essa segunda (e ultima) chance antes do material
entrar no processo de reciclagem/descarte definitivo - depois disso, nao ha como recuperar
as fotos. Por isso os valores estao abaixo da tabela normal: e uma condicao criada
especificamente pra quem ainda nao retirou o material, nao uma promocao generica. Trate essa
urgencia como um fato real da situacao dele(a), nunca como um gatilho de pressao artificial.

## DADOS DESTE CONTRATO (use exatamente estes valores, nunca invente outros)
Nome: ${nomeContato}
Numero do contrato: ${dadosVenda?.numero_contrato || 'Nao informado'}
Valor de tabela (cheio): ${valorOuPadrao(dadosVenda?.valor_tabela)}
Valor promocional oferecido: ${valorOuPadrao(dadosVenda?.valor_oferecido)}
Formas de pagamento disponiveis: ${dadosVenda?.formas_pagamento || 'consulte as opcoes disponiveis'}
Opcoes de plano/parcelamento: ${dadosVenda?.opcoes_plano || 'consulte as opcoes disponiveis'}
Prazo de reciclagem/perda do material: ${dadosVenda?.prazo_reciclagem || 'em breve'}

Observacao importante: os campos de valor acima podem conter mais de uma opcao no mesmo
texto (ex: "800,00 a vista ou no cartao em 6 parcelas de 200,00"). Quando isso acontecer,
apresente cada opcao de forma separada e clara pro formando (ex: "a vista sai por R$ 800,00,
ou se preferir, dividido no cartao fica em 6x de R$ 200,00"), nunca leia o texto cru como se
fosse um unico numero.

## REGRAS DE TOM
- Fale como uma pessoa real, proxima e calorosa. Frases curtas, nunca parecendo script.
- Nunca minta sobre prazos, nunca use caixa alta ou excesso de emojis.
- Sempre mencione o valor de tabela antes do valor promocional, para o desconto ter peso real.
- Se o cliente disser "nao tenho dinheiro agora", apresente as opcoes de plano como solucao.
- Se o cliente disser claramente "nao quero", respeite, agradeca e nao insista de novo.
- Nunca invente informacoes que nao estejam nos dados acima ou na base de conhecimento.

## REGRA CRITICA - VOCE NUNCA FECHA A VENDA SOZINHA
Voce NUNCA envia link de pagamento e NUNCA fecha a venda sozinha. Seu papel termina quando
o formando confirma verbalmente que quer comprar (ou pede o link/forma de pagamento). Nesse
momento, agradeca, confirme o plano escolhido e informe que o time vai finalizar o pagamento
com ele. Inclua OBRIGATORIAMENTE ao final da resposta o marcador tecnico exato:
###QUER_COMPRAR###{"plano_escolhido":"TEXTO_DO_PLANO","forma_pagamento_escolhida":"TEXTO_DA_FORMA"}###FIM###

Se o formando demonstrar que nao tem interesse, inclua: ###SEM_INTERESSE###
Se precisar transferir para atendimento humano, inclua: ###OVERFLOW###

${contextoAgendamento}

## INSTRUCAO FINAL
Se a pergunta do contato nao estiver coberta em nenhuma base acima, diga que vai verificar e NUNCA invente a resposta.`;
    } else {
      // ================= FLUXO DE AGENDAMENTO (comportamento original) =================
      const opcoesRenderizadas = renderizarOpcoesAgendamento(opcoesAgendamento, tipoAtendimento);

      const marcadorAgendamento = tipoAtendimento === 'escritorio'
        ? `###AGENDAMENTO_CONFIRMADO###{"data":"YYYY-MM-DD","horario":"HH:MM","local":"${ESCRITORIO_ENDERECO}"}###FIM###`
        : `###AGENDAMENTO_CONFIRMADO###{"data":"YYYY-MM-DD","turno":"NOME_DO_TURNO","local":"ENDERECO"}###FIM###`;

      const instrucaoMarcador = tipoAtendimento === 'escritorio'
        ? `Sempre que o formando confirmar uma data e horario (mesmo indiretamente, tipo "sim", "pode ser", "confirmado"), inclua OBRIGATORIAMENTE ao final da sua resposta o marcador tecnico exato:`
        : `Sempre que o formando confirmar uma data e turno (mesmo indiretamente, tipo "sim", "pode ser", "confirmado"), inclua OBRIGATORIAMENTE ao final da sua resposta o marcador tecnico exato:`;

      systemInstruction += `

## REGRAS CRITICAS DE AGENDAMENTO
As UNICAS opcoes validas de agendamento sao:
${opcoesRenderizadas}

NUNCA invente, sugira ou confirme datas ou horarios que nao estejam na lista acima.
Se o lead pedir uma data diferente, informe educadamente que so ha essas opcoes disponiveis.

Nome do contato: ${nomeContato}

## MARCADORES OBRIGATORIOS
${instrucaoMarcador}
${marcadorAgendamento}

Se o formando demonstrar que nao tem interesse, inclua: ###SEM_INTERESSE###
Se precisar transferir para atendimento humano, inclua: ###OVERFLOW###

${contextoAgendamento}

## INSTRUCAO FINAL
Se a pergunta do contato nao estiver coberta em nenhuma base acima, diga que vai verificar e NUNCA invente a resposta.`;
    }

    console.log('[Gemini] System Instruction:', systemInstruction.substring(0, 300) + '...');
    console.log('[Gemini] Historico tem', history.length, 'mensagens');

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction,
    });

    const chat = model.startChat({ history: history.length > 0 ? history : [] });
    const result = await chat.sendMessage(textoUsuario);
    const response = result.response.text();

    console.log('[Gemini] Resposta:', response.substring(0, 100) + '...');
    return response;
  } catch (err) {
    console.error('[Gemini] Erro:', err);
    return '';
  }
}

/**
 * Processa o proximo bloco de uma conversa
 */
async function processarProximoBloco(sb: any, conversaId: string): Promise<void> {
  // Busca conversa_estado
  const { data: conversa } = await sb
    .from('conversa_estado')
    .select('*, campanhas(*)')
    .eq('id', conversaId)
    .single();

  if (!conversa) {
    console.error('[Processor] Conversa nao encontrada:', conversaId);
    return;
  }

  const campanha = conversa.campanhas as any;
  const telefone = conversa.contato_telefone;
  const nome = conversa.contato_nome || 'Formando';

  console.log(`[Processor] Processando bloco ${conversa.bloco_atual} para ${nome}`);

  // Verifica limite anti-ban
  const { podeEnviar, motivo } = await verificarLimiteAntiban(sb, campanha.id);
  if (!podeEnviar) {
    console.log(`[Processor] Bloqueado por anti-ban: ${motivo}`);
    return;
  }

  // Parseia mensagem_inicial em blocos
  const mensagemFinal = campanha.mensagem_inicial || '';
  const blocos = parsearMensagem(mensagemFinal);

  // Parse opcoes_agendamento
  let opcoesAgendamento: OpcaoAgendamento[] = [];
  try {
    opcoesAgendamento = campanha.opcoes_agendamento || [];
  } catch {
    opcoesAgendamento = [];
  }

  const blocoAtual = conversa.bloco_atual;

  // Se nao ha mais blocos
  if (blocoAtual >= blocos.length) {
    await sb
      .from('conversa_estado')
      .update({ status: 'concluido', updated_at: new Date().toISOString() })
      .eq('id', conversaId);
    console.log(`[Processor] Conversa concluida para ${nome}`);
    await sb
      .from('contatos_campanha')
      .update({ status: 'em_conversa' })
      .eq('campanha_id', campanha.id)
      .eq('telefone', telefone);
    return;
  }

  const bloco = blocos[blocoAtual];

  // Para campanhas de venda de material, busca os dados especificos do contrato
  let dadosVendaBloco: DadosVenda | undefined;
  if (campanha.tipo_atendimento === 'venda_material') {
    const { data: contatoVenda } = await sb
      .from('contatos_campanha')
      .select('numero_contrato, valor_tabela, valor_oferecido, formas_pagamento, opcoes_plano, prazo_reciclagem')
      .eq('campanha_id', campanha.id)
      .eq('telefone', telefone)
      .maybeSingle();
    dadosVendaBloco = contatoVenda || undefined;
  }

  switch (bloco.tipo) {
    case 'texto': {
      // Substitui variaveis
      const textoFinal = substituirVariaveis(bloco.conteudo || '', nome, opcoesAgendamento, campanha.tipo_atendimento || 'visita_externa', dadosVendaBloco);

      // Envia mensagem
      const sucesso = await enviarMensagemUazapi(telefone, textoFinal);

      // Loga envio
      await logarEnvio(sb, campanha.id, telefone, sucesso);

      if (sucesso) {
        // Incrementa bloco e processa proximo
        await sb
          .from('conversa_estado')
          .update({
            bloco_atual: blocoAtual + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversaId);

        // Processa proximo bloco recursivamente
        await processarProximoBloco(sb, conversaId);
      } else {
        // Falha - incrementa tentativas
        await sb
          .from('conversa_estado')
          .update({
            tentativas_falha: conversa.tentativas_falha + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversaId);
      }
      break;
    }

    case 'esperar_tempo': {
      const segundosComJitter = calcularJitter(bloco.segundos || 5);
      const proximaExecucao = new Date(Date.now() + segundosComJitter * 1000);

      console.log(`[Processor] Aguardando ${segundosComJitter}s para ${nome}`);

      await sb
        .from('conversa_estado')
        .update({
          status: 'aguardando_tempo',
          proxima_execucao: proximaExecucao.toISOString(),
          bloco_atual: blocoAtual + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversaId);
      break;
    }

    case 'aguardar_resposta': {
      await sb
        .from('conversa_estado')
        .update({
          aguardando_resposta: true,
          status: 'aguardando_lead',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversaId);

      console.log(`[Processor] Aguardando resposta de ${nome}`);
      break;
    }
  }
}

/**
 * Handler principal
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Metodo nao permitido' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    console.log('[Processor] Acao recebida:', body.acao);

    switch (body.acao) {
      case 'iniciar_campanha': {
        const { campanha_id } = body;

        if (!campanha_id) {
          return new Response(JSON.stringify({ error: 'campanha_id obrigatorio' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Busca campanha
        const { data: campanha } = await sb
          .from('campanhas')
          .select('*')
          .eq('id', campanha_id)
          .single();

        if (!campanha) {
          return new Response(JSON.stringify({ error: 'Campanha nao encontrada' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Busca contatos_campanha sem conversa_estado
        const { data: contatos } = await sb
          .from('contatos_campanha')
          .select('*')
          .eq('campanha_id', campanha_id)
          .eq('status', 'aguardando_inicio');

        if (!contatos || contatos.length === 0) {
          return new Response(JSON.stringify({
            message: 'Nenhum contato pendente',
            total: 0,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        let criados = 0;
        const filaProcessamento: { conversaId: string; delayMs: number }[] = [];
        let delayAcumulado = 0;

        for (const contato of contatos) {
          // Verifica se ja existe conversa_estado
          const { data: existente } = await sb
            .from('conversa_estado')
            .select('id')
            .eq('campanha_id', campanha_id)
            .eq('contato_telefone', contato.telefone)
            .maybeSingle();

          if (existente) continue;

          // Cria conversa_estado
          const { data: novaConversa } = await sb
            .from('conversa_estado')
            .insert({
              campanha_id,
              contato_telefone: contato.telefone,
              contato_nome: contato.nome,
              bloco_atual: 0,
              status: 'ativo',
            })
            .select('id')
            .single();

          if (novaConversa) {
            criados++;
            // Espacamento aleatorio 20-90s entre contatos
            const espacamento = 20000 + Math.random() * 70000;
            delayAcumulado += espacamento;
            filaProcessamento.push({
              conversaId: novaConversa.id,
              delayMs: delayAcumulado,
            });

            // Atualiza status do contato
            await sb
              .from('contatos_campanha')
              .update({ status: 'enviando' })
              .eq('id', contato.id);
          }
        }

        // Atualiza status da campanha
        await sb
          .from('campanhas')
          .update({ status: 'running' })
          .eq('id', campanha_id);

        // Enfileira processamentos (simulado com chamadas recursivas para o primeiro)
        // Em producao, isso seria feito via cron ou queue
        if (filaProcessamento.length > 0) {
          console.log(`[Processor] Iniciando ${filaProcessamento.length} conversas`);
          // Processa o primeiro imediatamente (os outros sao processados pelo cron)
          setTimeout(() => {
            processarProximoBloco(sb, filaProcessamento[0].conversaId);
          }, 1000);
        }

        return new Response(JSON.stringify({
          success: true,
          conversas_criadas: criados,
          message: `Campanha iniciada com ${criados} contatos`,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'processar_cron': {
        // Busca conversas aguardando tempo
        const agora = new Date().toISOString();
        const { data: conversasAguardando } = await sb
          .from('conversa_estado')
          .select('id')
          .eq('status', 'aguardando_tempo')
          .lte('proxima_execucao', agora);

        console.log(`[Cron] ${conversasAguardando?.length || 0} conversas prontas para processar`);

        let processadas = 0;
        for (const conversa of conversasAguardando || []) {
          await sb
            .from('conversa_estado')
            .update({ status: 'ativo' })
            .eq('id', conversa.id);

          await processarProximoBloco(sb, conversa.id);
          processadas++;
        }

        return new Response(JSON.stringify({
          success: true,
          processadas,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

case 'resposta_recebida': {
  const { telefone, campanha_id, texto_resposta } = body;

  if (!telefone || !texto_resposta) {
    return new Response(JSON.stringify({ error: 'telefone e texto_resposta obrigatorios' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: conversa } = await sb
    .from('conversa_estado')
    .select('*, campanhas(*)')
    .eq('contato_telefone', telefone)
    .eq('aguardando_resposta', true)
    .maybeSingle();

  if (!conversa) {
    console.log(`[Processor] Nenhuma conversa aguardando resposta para ${telefone}`);
    return new Response(JSON.stringify({ message: 'Sem conversa ativa' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const campanha = conversa.campanhas as any;
  const nome = conversa.contato_nome || 'Formando';

  console.log(`[Processor] Resposta recebida de ${nome}: ${texto_resposta}`);

  // Busca dados completos do contato na campanha (nome, contrato, curso, endereco)
  const { data: contatoCampanhaData } = await sb
    .from('contatos_campanha')
    .select('id, nome, numero_contrato, curso, local, valor_tabela, valor_oferecido, formas_pagamento, opcoes_plano, prazo_reciclagem')
    .eq('campanha_id', campanha.id)
    .eq('telefone', telefone)
    .maybeSingle();

  const dadosContato = contatoCampanhaData || {};
  const nomeCompleto = dadosContato.nome || nome;

  // Busca ou cria contact_id (necessario para historico e agendamento)
  const { data: contatoDb } = await sb
    .from('contacts')
    .select('id, assigned_to')
    .eq('phone', telefone)
    .maybeSingle();

  let contactId = contatoDb?.id;

  // VERIFICACAO DE MODO MANUAL: se o contato esta em modo manual, salva a mensagem recebida mas nao chama a IA
  if (contatoDb?.assigned_to === 'manual') {
    console.log(`[Processor] Contato ${telefone} em modo manual - salvando mensagem sem acionar IA`);
    await sb.from('messages').insert({
      contact_id: contatoDb.id,
      direction: 'in',
      content: texto_resposta,
      sent_by: 'contato',
      seq: 0,
    });
    return new Response(JSON.stringify({ success: true, skipped: true, reason: 'manual_mode' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!contactId) {
    const { data: novoContato } = await sb
      .from('contacts')
      .insert({ phone: telefone, name: nome, status: 'lead', assigned_to: 'ia' })
      .select('id')
      .single();
    contactId = novoContato?.id;
  }

  // Salva mensagem recebida do formando
  if (contactId) {
    await sb.from('messages').insert({
      contact_id: contactId,
      direction: 'in',
      content: texto_resposta,
      sent_by: 'contato',
      seq: 0,
    });
  }

  // Busca historico para dar contexto real a IA
  let history: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let textosFormando: string[] = [];
  if (contactId) {
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

    // Remove a mensagem que acabou de ser inserida (sera enviada separadamente ao chat)
    if (history.length > 0 && history[history.length - 1].role === 'user') {
      history.pop();
    }

    // Gemini exige que o historico comece com 'user'
    while (history.length > 0 && history[0].role !== 'user') {
      history.shift();
    }
  }

  // Se ja existe agendamento, reforca isso no prompt para a IA nao repetir a pergunta
  let contextoAgendamento = '';
  if (contactId) {
    const { data: agendamentoRecente } = await sb
      .from('appointments')
      .select('date, shift, location')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (agendamentoRecente) {
      contextoAgendamento = `ATENCAO - ESTADO ATUAL: Este formando JA TEM uma visita confirmada para ${agendamentoRecente.date} no turno ${agendamentoRecente.shift}, endereco ${agendamentoRecente.location || 'Nao informado'}. NAO reinicie a apresentacao nem ofereca novas datas. Se ele pedir explicitamente para mudar, trate como reagendamento dentro das opcoes validas.`;
    }
  }

  const respostaIA = await chamarGemini(
    sb,
    campanha.prompt_ia || '',
    campanha.base_conhecimento || '',
    texto_resposta,
    nome,
    campanha.opcoes_agendamento || [],
    history,
    contextoAgendamento,
    campanha.tipo_atendimento || 'visita_externa',
    dadosContato as DadosVenda
  );

  if (respostaIA) {
    let novoStatus = 'em_conversa';

    // TRAVA DE SEGURANCA: verificar se a etapa de confirmacao de endereco aconteceu
    let etapaEnderecoOk = false;
    if (contactId) {
      const { data: msgsEndereco } = await sb
        .from('messages')
        .select('content')
        .eq('contact_id', contactId)
        .eq('direction', 'out')
        .eq('sent_by', 'ia')
        .order('created_at', { ascending: true })
        .limit(50);

      const jaConfirmouEndereco = (msgsEndereco || []).some((m: any) =>
        (m.content || '').includes('Consta esse endereço no sistema') ||
        (m.content || '').includes('Confirmando:')
      );

      etapaEnderecoOk = jaConfirmouEndereco;
    }

    // Processa agendamento confirmado (fluxo de agendamento apenas)
    if (campanha.tipo_atendimento !== 'venda_material' && respostaIA.includes('###AGENDAMENTO_CONFIRMADO###')) {
      if (!etapaEnderecoOk) {
        // IA tentou confirmar agendamento sem etapa de endereco - bloquear
        console.log(`[Processor] IA tentou confirmar agendamento sem etapa de endereço - bloqueado e redirecionado para contact_id: ${contactId}`);

        // Busca endereco do contato na tabela contatos_campanha
        const { data: contatoCampanha } = await sb
          .from('contatos_campanha')
          .select('local, nome')
          .eq('campanha_id', campanha.id)
          .eq('telefone', telefone)
          .maybeSingle();

        const endereco = contatoCampanha?.local || 'Não informado';
        const nomeContato = contatoCampanha?.nome || nome;
        const msgEndereco = `Perfeito, ${nomeContato}! Consta esse endereço no sistema: 📍 ${endereco}. Continua sendo esse? Para facilitar, pode me informar um ponto de referência também? 😊`;

        // Descarta a resposta da IA e envia a mensagem de confirmacao de endereco
        const sucessoEndereco = await enviarMensagemUazapi(telefone, msgEndereco);
        await logarEnvio(sb, campanha.id, telefone, sucessoEndereco);

        if (sucessoEndereco && contactId) {
          await sb.from('messages').insert({
            contact_id: contactId,
            direction: 'out',
            content: msgEndereco,
            sent_by: 'ia',
            seq: 0,
          });
        }

        // Mantem status em_conversa, sem avancar para agendado
        await sb
          .from('conversa_estado')
          .update({
            aguardando_resposta: true,
            status: 'aguardando_lead',
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversa.id);

        await sb
          .from('contatos_campanha')
          .update({ status: 'em_conversa' })
          .eq('campanha_id', campanha.id)
          .eq('telefone', telefone);

        return new Response(JSON.stringify({
          success: true,
          resposta_gerada: true,
          bloqueado: true,
          motivo: 'etapa_endereco_pendente',
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const jsonMatch = respostaIA.match(/###AGENDAMENTO_CONFIRMADO###([\s\S]*?)###FIM###/);
        if (jsonMatch && jsonMatch[1]) {
          const dados = JSON.parse(jsonMatch[1].trim());
          const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(dados.data);
          if (dataValida) {
            // VALIDACAO SERVER-SIDE: verifica se o formando realmente mencionou
            // a data e horario/turno em alguma mensagem anterior (direction='in')
            const horarioOuTurno = dados.turno || dados.horario || '';
            const dataValidada = validarDataHorarioMencionado(dados.data, horarioOuTurno, textosFormando, campanha?.opcoes_agendamento || []);

            if (!dataValidada) {
              console.error('[Processor] ALERTA: IA tentou confirmar agendamento sem validacao — data/horario nao encontrado nas mensagens do formando. contact_id:', contactId, 'dados:', dados);

              await sb
                .from('contatos_campanha')
                .update({ revisao_humana: true })
                .eq('campanha_id', campanha.id)
                .eq('telefone', telefone);

              if (contactId) {
                await sb.from('contacts').update({ revisao_humana: true }).eq('id', contactId);
              }

              console.log(`[Processor] Contato ${nome} marcado para revisao humana — possivel agendamento nao confirmado pelo cliente`);
            } else {

            const { error: appointmentError } = await sb.from('appointments').insert({
              graduand_name: nomeCompleto,
              contract_number: dadosContato.numero_contrato || 'Nao Informado',
              course: dadosContato.curso || 'Outros',
              date: dados.data,
              shift: dados.turno || dados.horario || '',
              location: dados.local || dadosContato.local || 'RESIDENCIA',
              status: 'Em negociacao',
              contact_id: contactId,
              campaign_contact_id: dadosContato.id,
              campaign_id: campanha.id,
              seller_name: 'INDEFINIDO',
            });
            if (appointmentError) {
              console.error('[Processor] ERRO ao inserir agendamento:', JSON.stringify(appointmentError));
            } else {
              console.log(`[Processor] Agendamento inserido para: ${nome}`);
              novoStatus = 'agendado';
            }
            }
          } else {
            console.error('[Processor] Data invalida recebida da IA:', dados.data);
          }
        }
      } catch (e) {
        console.error('[Processor] Falha ao parsear agendamento:', e);
      }
    }

    // Processa intencao de compra confirmada (fluxo de venda de material apenas)
    if (campanha.tipo_atendimento === 'venda_material' && respostaIA.includes('###QUER_COMPRAR###')) {
      let planoEscolhido = '';
      let formaPagamentoEscolhida = '';
      try {
        const jsonMatch = respostaIA.match(/###QUER_COMPRAR###([\s\S]*?)###FIM###/);
        if (jsonMatch && jsonMatch[1]) {
          const dados = JSON.parse(jsonMatch[1].trim());
          planoEscolhido = dados.plano_escolhido || '';
          formaPagamentoEscolhida = dados.forma_pagamento_escolhida || '';
        }
      } catch (e) {
        console.error('[Processor] Falha ao parsear QUER_COMPRAR:', e);
      }

      novoStatus = 'interessado_compra';

      await sb
        .from('contatos_campanha')
        .update({
          plano_escolhido: planoEscolhido || null,
          forma_pagamento_escolhida: formaPagamentoEscolhida || null,
        })
        .eq('id', dadosContato.id);

      await notificarInteresseDeCompra(
        sb,
        dadosContato.id,
        campanha.id,
        nomeCompleto,
        dadosContato as DadosVenda,
        planoEscolhido,
        formaPagamentoEscolhida
      );

      console.log(`[Processor] ${nomeCompleto} confirmou interesse de compra - Square notificado`);
    }

    if (respostaIA.includes('###SEM_INTERESSE###')) {
      novoStatus = 'sem_interesse';
    }

    if (respostaIA.includes('###OVERFLOW###')) {
      novoStatus = 'transferido_humano';
      if (contactId) {
        await sb.from('contacts').update({ assigned_to: 'manual' }).eq('id', contactId);
      }
    }

    const respostaLimpa = respostaIA
      .replace(/###AGENDAMENTO_CONFIRMADO###[\s\S]*?###FIM###/g, '')
      .replace(/###QUER_COMPRAR###[\s\S]*?###FIM###/g, '')
      .replace(/###OVERFLOW###/g, '')
      .replace(/###SEM_INTERESSE###/g, '')
      .trim();

    const sucesso = await enviarMensagemUazapi(telefone, respostaLimpa);
    await logarEnvio(sb, campanha.id, telefone, sucesso);

    if (sucesso) {
      if (contactId) {
        await sb.from('messages').insert({
          contact_id: contactId,
          direction: 'out',
          content: respostaLimpa,
          sent_by: 'ia',
          seq: 0,
        });
      }

      await sb
        .from('conversa_estado')
        .update({
          aguardando_resposta: false,
          bloco_atual: conversa.bloco_atual + 1,
          status: 'ativo',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversa.id);

      await sb
        .from('contatos_campanha')
        .update({ status: novoStatus })
        .eq('campanha_id', campanha.id)
        .eq('telefone', telefone);

      await processarProximoBloco(sb, conversa.id);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    resposta_gerada: !!respostaIA,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

      default:
        return new Response(JSON.stringify({ error: 'Acao desconhecida' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('[Processor] Erro:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
