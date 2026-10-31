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
  tipo?: 'visita_externa' | 'escritorio';
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
  quantidade_fotos?: string | null;
  cpf?: string | null;
  email?: string | null;
}

/**
 * Renderiza opcoes de agendamento de forma literal
 */
function renderizarOpcoesAgendamento(opcoes: OpcaoAgendamento[], tipoAtendimentoCampanha: string = 'visita_externa'): string {
  if (!opcoes || opcoes.length === 0) return '';

  return opcoes.map((opcao, idx) => {
    // Formata a data para DD/MM/YYYY
    let dataFormatada = opcao.data;
    if (opcao.data && opcao.data.includes('-')) {
      const [ano, mes, dia] = opcao.data.split('-');
      dataFormatada = `${dia}/${mes}/${ano}`;
    }

    // Usa o tipo salvo na PROPRIA data (campanhas podem misturar visita
    // externa e escritorio); campanhas antigas sem "tipo" salvo caem no
    // tipo geral da campanha como fallback.
    const tipoLinha = opcao.tipo || (tipoAtendimentoCampanha === 'escritorio' ? 'escritorio' : 'visita_externa');

    if (tipoLinha === 'escritorio') {
      const horariosStr = (opcao.horarios || []).join(', ');
      return `- Opcao ${idx + 1}: ${dataFormatada} (atendimento no escritorio) — ${horariosStr}`;
    }

    // Usa turnos se existir, senao usa periodos (compatibilidade)
    const turnosStr = opcao.turnos?.join(', ') ||
      opcao.periodos?.map(p => `${p.turno} (${p.horario})`).join(' ') || '';

    return `- Opcao ${idx + 1}: ${dataFormatada} (visita externa) — ${turnosStr}`;
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
    resultado = resultado.replace(/\{prazo_pre_venda\}/gi, dadosVenda?.prazo_reciclagem || 'em breve');
    resultado = resultado.replace(/\{prazo_black_friday\}/gi, dadosVenda?.prazo_reciclagem || 'em breve');
    resultado = resultado.replace(/\{prazo_final\}/gi, dadosVenda?.prazo_reciclagem || 'em breve');
    resultado = resultado.replace(/\{quantidade_fotos\}/gi, dadosVenda?.quantidade_fotos || 'nao informado');
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
 * Divide o texto de valor/opcoes (que pode conter mais de uma opcao, ex:
 * "800,00 a vista ou no cartao em 6x de 200,00") em uma lista numerada de
 * planos, pra exibir de forma clara na notificacao ao vendedor, sem repetir
 * o mesmo texto em "valor" e "plano". Aceita quebra de linha, ";" ou a
 * palavra "ou" como separador entre opcoes.
 */
function formatarPlanosDisponiveis(texto?: string | null): string {
  if (!texto || texto.trim() === '') return 'Nao especificado';

  const partes = texto
    .split(/\r?\n|;|\s+ou\s+/gi)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (partes.length <= 1) return `▫️ ${texto.trim()}`;

  return partes
    .map((p, i) => `▫️ Plano ${String(i + 1).padStart(2, '0')}: ${p}`)
    .join('\n');
}

// ============================================================================
// VENDA DE MATERIAL FOTOGRAFICO - CONFERENCIA DE DADOS (CPF / E-MAIL)
// ============================================================================

// Prazo informado ao formando para receber o link de pagamento
const PRAZO_LINK_PAGAMENTO = '48 horas';

// true  = na conferencia o CPF aparece parcialmente (123.***.***-45), por seguranca
// false = mostra o CPF completo (123.456.789-45)
const MASCARAR_CPF_NA_CONFERENCIA = true;

// Status de contatos_campanha que encerram o atendimento da IA na venda
const STATUS_VENDA_ENCERRADA = ['sem_interesse', 'transferido_humano', 'interessado_compra', 'comprou'];

function somenteDigitos(v?: string | null): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Normaliza CPF vindo da planilha (repoe zeros a esquerda perdidos pelo Excel) */
function normalizarCPF(v?: string | null): string {
  let d = somenteDigitos(v);
  if (d.length >= 9 && d.length < 11) d = d.padStart(11, '0');
  return d;
}

function cpfValido(v?: string | null): boolean {
  const cpf = normalizarCPF(v);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += parseInt(base[i], 10) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9), 10) === parseInt(cpf[9], 10) &&
    digito(cpf.slice(0, 10), 11) === parseInt(cpf[10], 10);
}

function formatarCPF(v?: string | null): string {
  const d = normalizarCPF(v);
  if (d.length !== 11) return String(v ?? '');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function cpfParaExibir(v?: string | null): string {
  const d = normalizarCPF(v);
  if (d.length !== 11) return String(v ?? '');
  return MASCARAR_CPF_NA_CONFERENCIA ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : formatarCPF(d);
}

function emailValido(v?: string | null): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());
}

/** Procura um CPF digitado na mensagem (com ou sem pontuacao) */
function extrairCPF(texto: string): string | null {
  const candidatos = texto.match(/\d[\d.\-\s]{9,16}\d/g) || [];
  for (const c of candidatos) {
    const d = somenteDigitos(c);
    if (d.length === 11) return d;
  }
  return null;
}

function extrairEmail(texto: string): string | null {
  const m = texto.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

function normalizarTexto(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Classifica a resposta do formando na conferencia: confirmou, negou ou outra coisa */
function classificarConfirmacao(textoOriginal: string): 'sim' | 'nao' | 'indefinido' {
  const t = normalizarTexto(textoOriginal);
  if (t === 's' || t === 'ss') return 'sim';
  if (t === 'n') return 'nao';
  const negativo = /\b(nao|errado|errada|errados|incorreto|incorreta|incorretos|mudou|mudei|mudaram|desatualizado|desatualizada|trocar|troquei|alterar|corrigir)\b/.test(t);
  if (negativo) return 'nao';
  const positivo = /\b(sim|sin|isso|correto|correta|corretos|certo|certa|certos|ok|okay|confirmo|confirmado|confirmados|confirmada|pode|positivo|exato|exatamente|perfeito|beleza|blz|claro|yes|si|uhum|aham|tudo certo)\b/.test(t) ||
    /\u{1F44D}|\u{2705}|\u{1F44C}/u.test(textoOriginal);
  return positivo ? 'sim' : 'indefinido';
}

function primeiroNome(nome?: string | null): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  if (!p) return '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function descreverPlano(plano?: string | null, forma?: string | null): string {
  const p = String(plano || '').trim();
  const f = String(forma || '').trim();
  if (!p && !f) return 'a opção escolhida';
  if (!p) return f;
  if (!f || p.toLowerCase().includes(f.toLowerCase())) return p;
  return `${p} (${f})`;
}

/** "340" -> "340" | "1234" -> "1.234" | texto livre fica como esta */
function formatarQuantidadeFotos(q?: string | null): string {
  const bruto = String(q ?? '').trim();
  if (!bruto) return '';
  if (/^\d+$/.test(bruto)) return Number(bruto).toLocaleString('pt-BR');
  return bruto;
}

function textoPedidoDadosFaltantes(faltaCpf: boolean, faltaEmail: boolean): string {
  if (faltaCpf && faltaEmail) return 'o seu CPF e o seu e-mail atualizados';
  if (faltaCpf) return 'o seu CPF completo';
  return 'o seu e-mail atualizado';
}

/** Mensagem enviada logo apos o formando escolher a opcao: confirma a escolha e pede a conferencia de CPF/e-mail */
function montarMensagemConferencia(nome: string, plano: string | null | undefined, forma: string | null | undefined, cpf?: string | null, email?: string | null): string {
  const pn = primeiroNome(nome);
  const temCpf = cpfValido(cpf);
  const temEmail = emailValido(email);
  const temPlano = !!(String(plano || '').trim() || String(forma || '').trim());
  const abertura = temPlano
    ? `Perfeito${pn ? ', ' + pn : ''}! Anotei sua escolha: ${descreverPlano(plano, forma)}.`
    : `Perfeito${pn ? ', ' + pn : ''}! Antes de passar seu atendimento para o nosso especialista, preciso só de uma conferência rápida.`;

  if (!temCpf && !temEmail) {
    return `${abertura}\n\nPra deixar tudo pronto para o envio do seu link de pagamento, me informe, por favor, ${textoPedidoDadosFaltantes(true, true)}.`;
  }

  const linhas: string[] = [];
  if (temCpf) linhas.push(`CPF: ${cpfParaExibir(cpf)}`);
  if (temEmail) linhas.push(`E-mail: ${String(email).trim().toLowerCase()}`);

  let pedido = `Pra deixar tudo pronto para o envio do seu link de pagamento, confirma pra mim se ${linhas.length > 1 ? 'seus dados estão corretos e atualizados' : 'esse dado está correto e atualizado'}:\n\n${linhas.join('\n')}`;
  if (!temCpf || !temEmail) {
    pedido += `\n\nE me informe também ${textoPedidoDadosFaltantes(!temCpf, !temEmail)}, por favor.`;
  } else {
    pedido += `\n\nEstá tudo certo? Se algum dado mudou, é só me mandar o correto por aqui.`;
  }
  return `${abertura}\n\n${pedido}`;
}

// ============================================================================
// VENDA - TRAVA DE ESCOLHA (a IA so registra a opcao quando o formando ESCOLHEU)
// ============================================================================

/** Divide o texto de planos ("600,00 a vista ou 4x de 200,00 no cartao") em opcoes separadas */
function dividirOpcoesPlano(texto?: string | null): string[] {
  // Protege o que esta entre parenteses: "600,00 (1x ou 3x sem juros)" e UMA opcao so
  const protegido = String(texto || '').replace(/\([^)]*\)/g, (m) => m.replace(/\bou\b/gi, '\u0000'));
  return protegido
    .split(/\r?\n|;|\s+ou\s+|op[cç][aã]o\s*0?\d+\s*[:\-]/gi)
    .map((p) => p.replace(/\u0000/g, 'ou').trim().replace(/^[-–•▫️\s]+/, ''))
    .filter((p) => p.length > 2);
}

const NUM_OPCAO: Record<string, number> = {
  '1': 1, '01': 1, um: 1, uma: 1, primeira: 1, primeiro: 1,
  '2': 2, '02': 2, dois: 2, duas: 2, segunda: 2, segundo: 2,
  '3': 3, '03': 3, tres: 3, terceira: 3, terceiro: 3,
};

/**
 * Analisa SO a mensagem atual do formando e diz se ela contem uma escolha
 * concreta de opcao. "sim", "ok", "pode ser", "quero ver", perguntas e
 * hesitacoes NAO sao escolha (exceto "sim/quero" quando so existe 1 opcao).
 */
function detectarEscolha(textoOriginal: string, dados: any): { escolheu: boolean; plano?: string; forma?: string } {
  const t = normalizarTexto(textoOriginal);
  if (!t) return { escolheu: false };
  const opcoes = dividirOpcoesPlano(dados?.valor_oferecido || dados?.opcoes_plano);

  // Hesitacao, recusa ou duvida: nunca e escolha
  const hesitacao = /\b(vou pensar|pensar|pensando|depois|mais tarde|amanha|outro dia|semana que vem|mes que vem|nao sei|talvez|caro|cara|sem dinheiro|nao tenho|agora nao|nao quero|nao posso|nao da|nao consigo|nao vou|deixa|duvida|desconto|consigo um|melhor preco|negociar)\b/.test(t);
  const pergunta = /\?/.test(textoOriginal) || /\b(qual|quais|quanto|quantas|quantos|como|onde|quando|tem como|e se|seria)\b/.test(t);

  let numero: number | null = null;
  const mNum = t.match(/\b(?:opcao|plano|op|numero|n)\s*(0?[1-3]|um|uma|dois|duas|tres|primeira|primeiro|segunda|segundo|terceira|terceiro)\b/) ||
    t.match(/^(?:a |o |quero (?:a |o )?|vou (?:de |na |no )?|pode ser (?:a |o )?)?(0?[1-3]|primeira|primeiro|segunda|segundo|terceira|terceiro)(?: opcao)?$/);
  if (mNum) numero = NUM_OPCAO[mNum[1]] || null;

  const querVista = /\b(pix|a vista|avista|vista|transferencia)\b/.test(t);
  const querCartao = /\b(cartao|credito|parcelad[oa]|parcelar|parcelas?|\d{1,2}\s*x|vezes)\b/.test(t);
  const querBoleto = /\bboleto\b/.test(t);
  const intencaoCompra = /\b(sim|quero|vou querer|vamos|bora|fechado|fechar|fecho|pode ser|pode|aceito|topo|beleza|ok|manda|garantir|garanto|compro|comprar)\b/.test(t);

  // Valor citado que bate com uma das opcoes (ex: "o de 600")
  let porValor: string | undefined;
  const valores = t.match(/\b\d{2,5}\b/g) || [];
  for (const v of valores) {
    const op = opcoes.find((o) => normalizarTexto(o).replace(/\./g, '').includes(v));
    if (op) { porValor = op; break; }
  }

  let plano: string | undefined;
  if (numero && opcoes[numero - 1]) plano = opcoes[numero - 1];
  else if (querVista) plano = opcoes.find((o) => /pix|vista/i.test(normalizarTexto(o)));
  else if (querCartao) plano = opcoes.find((o) => /cart|parcel|\dx|\d x/i.test(normalizarTexto(o)));
  else if (querBoleto) plano = opcoes.find((o) => /boleto/i.test(normalizarTexto(o)));
  else if (porValor) plano = porValor;

  const forma = querVista ? 'Pix / a vista' : querCartao ? 'Cartao (parcelado)' : querBoleto ? 'Boleto' : undefined;
  const escolhaExplicita = !!(numero || querVista || querCartao || querBoleto || porValor);

  if (hesitacao && !escolhaExplicita) return { escolheu: false };
  if (escolhaExplicita) {
    // "qual a diferenca do pix pro cartao?" e duvida, nao escolha
    if (pergunta && !intencaoCompra && !numero) return { escolheu: false };
    if (/\bnao\b/.test(t) && !intencaoCompra) return { escolheu: false };
    return { escolheu: true, plano, forma };
  }
  // So uma opcao disponivel: precisa de intencao clara de compra ("quero", "fechado",
  // "pode reservar"). "sim", "ok" ou "pode" sozinhos podem ser resposta a outra pergunta.
  const intencaoForte = /\b(quero|vou querer|fechado|fechar|fecho|aceito|topo|bora|garantir|garanto|compro|comprar|reservar|reserva)\b/.test(t);
  if (opcoes.length === 1 && intencaoForte && !pergunta && !hesitacao) {
    return { escolheu: true, plano: opcoes[0] };
  }
  return { escolheu: false };
}

/** Formando pediu para ver foto/previa */
function pediuFoto(texto: string): boolean {
  const t = normalizarTexto(texto);
  return /\b(previa|amostra|foto|fotos|imagem)\b/.test(t) &&
    /\b(ver|veja|mostra|mostrar|manda|mandar|envia|enviar|tem|teria|da pra|consigo|posso|quero|gostaria|como ficou|como ficaram)\b/.test(t);
}

/** A IA escreveu que vai mandar uma foto/previa */
function prometeuFoto(texto: string): boolean {
  const t = normalizarTexto(texto);
  return /\b(envi|mand|mostr|separ)\w*\b.{0,60}\b(foto|previa|imagem)/.test(t) ||
    /\b(foto|previa|imagem)\w*\b.{0,40}\b(envi|mand|cheg)\w*/.test(t);
}

/** Remove frases em que a IA promete enviar foto (usado quando a foto nao pode ser enviada) */
function removerPromessaDeFoto(texto: string): string {
  const frases = texto.split(/(?<=[.!?])\s+|\n+/);
  const limpas = frases.filter((f) => !prometeuFoto(f));
  const r = limpas.join(' ').replace(/\s{2,}/g, ' ').trim();
  return r || texto;
}

/** Mensagem do sistema quando a IA tentou registrar uma escolha que o formando nao fez */
function montarPerguntaEscolha(nome: string, dados: any): string {
  const pn = primeiroNome(nome);
  const opcoes = dividirOpcoesPlano(dados?.valor_oferecido || dados?.opcoes_plano);
  if (opcoes.length >= 2) {
    const lista = opcoes.map((o, i) => `Opção ${String(i + 1).padStart(2, '0')}: ${o}`).join('\n');
    return `Pra eu reservar certinho${pn ? ', ' + pn : ''}, qual das opções fica melhor pra você?\n\n${lista}`;
  }
  return `Pra eu reservar certinho${pn ? ', ' + pn : ''}: posso seguir com a sua reserva nessa condição?`;
}

/** Mensagem final: dados confirmados, atendimento repassado ao especialista humano */
function montarMensagemRepasseHumano(nome: string, plano: string | null | undefined, forma: string | null | undefined, dadosAtualizados: boolean, ultimaOportunidade = false, blackFriday = false): string {
  const pn = primeiroNome(nome);
  if (blackFriday) {
    return `Tudo certo${pn ? ', ' + pn : ''}! \u2705 ${dadosAtualizados ? 'Atualizei e confirmei seus dados.' : 'Seus dados estão confirmados.'}\n\n` +
      `Sua condição Black Friday está garantida${(String(plano || '').trim() || String(forma || '').trim()) ? ` (${descreverPlano(plano, forma)})` : ''}. Agora vou passar seu atendimento para um especialista da nossa equipe: ele te envia o link de pagamento em até ${PRAZO_LINK_PAGAMENTO} e, assim que o pagamento for confirmado, cuida do envio das suas fotos.\n\n` +
      `Foi um prazer te atender! \u{1F4F8}`;
  }
  if (ultimaOportunidade) {
    return `Tudo certo${pn ? ', ' + pn : ''}! \u2705 ${dadosAtualizados ? 'Atualizei e confirmei seus dados.' : 'Seus dados estão confirmados.'}\n\n` +
      `Sua condição de pré-venda está garantida${(String(plano || '').trim() || String(forma || '').trim()) ? ` (${descreverPlano(plano, forma)})` : ''}. Agora vou passar seu atendimento para um especialista da nossa equipe: ele te envia o link de pagamento em até ${PRAZO_LINK_PAGAMENTO} e, assim que o pagamento for confirmado, cuida do envio das suas fotos.\n\n` +
      `Foi um prazer te atender! \u{1F4F8}`;
  }
  return `Tudo certo${pn ? ', ' + pn : ''}! \u2705 ${dadosAtualizados ? 'Atualizei e confirmei seus dados.' : 'Seus dados estão confirmados.'}\n\n` +
    `Agora vou repassar seu atendimento para um especialista da nossa equipe. Ele vai finalizar com você, enviando o link de pagamento referente à sua escolha${(String(plano || '').trim() || String(forma || '').trim()) ? ` (${descreverPlano(plano, forma)})` : ''} em até ${PRAZO_LINK_PAGAMENTO}.\n\n` +
    `Assim que o pagamento for confirmado, suas fotos são liberadas para você. Obrigada pela confiança! \u{1F4F8}`;
}

// ============================================================================
// CAMPANHA "ULTIMA OPORTUNIDADE" (venda sem visita, valores de pre-venda)
// ============================================================================

/** Temas que NUNCA podem aparecer nessa campanha (reciclagem, perda das fotos etc.) */
const REGEX_TEMA_PROIBIDO = /recicl|descart|destru[ií]|apagad|apagar|exclu[ií]d|excluir|delet|sumir|sumirem|perder (as |suas |o |seu )?(fotos|material|lembran)|(fotos|material)[^.!?\n]{0,30}(perdid|apagad|exclu[ií]d|descartad)|prazo de guarda|prorroga/i;

function contemTemaProibido(texto: string): boolean {
  return REGEX_TEMA_PROIBIDO.test(String(texto || '').replace(/###[\s\S]*$/, ''));
}

/** Remove as frases que tocam em reciclagem/perda (ultimo recurso, se a IA insistir) */
function removerTemaProibido(texto: string): string {
  const frases = texto.split(/(?<=[.!?])\s+|\n+/);
  return frases.filter((f) => !REGEX_TEMA_PROIBIDO.test(f)).join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** Mensagem que claramente recusa/encerra (nesse caso nao manda o kit de fotos) */
function mensagemNegativa(texto: string): boolean {
  const t = normalizarTexto(texto);
  return /\b(nao quero|nao tenho interesse|sem interesse|nao me interessa|para de|pare de|parem de|nao me mande|nao mande mais|me tira|me remove|remover|bloquear|bloqueio|denunciar|sair|stop|chega|engano|numero errado|nao sou|nao conheco)\b/.test(t);
}

/** "dd/mm/aaaa" (ou aaaa-mm-dd) -> Date UTC; null se nao for data */
function lerDataBR(v?: string | null): Date | null {
  const t = String(v || '').trim();
  let m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])));
  }
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

function dataCurtaBR(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** Prompt de sistema da campanha Ultima Oportunidade (venda direta, sem visita) */
function montarPromptUltimaOportunidade(nomeContato: string, dadosVenda: DadosVenda | undefined, contextoExtra: string): string {
  const qtd = formatarQuantidadeFotos(dadosVenda?.quantidade_fotos);
  const prazo = dadosVenda?.prazo_reciclagem || '';
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Manaus' });
  return `

## IDENTIDADE
Voce e a Sophia, consultora senior de material fotografico da Stylus Formaturas. Ha anos voce ajuda
formandos a guardar para sempre o registro de um dos dias mais importantes da vida deles. Voce vende
com seguranca, carinho e argumentos reais: o formando sente que esta sendo bem atendido, nunca pressionado.
Esta falando com ${nomeContato}.

## O MOMENTO DESTA CONVERSA (regra prioritaria - leia com atencao)
Esta e uma conversa de VENDA DIRETA pelo WhatsApp: tudo e resolvido por aqui, SEM VISITA e sem
representante. Este formando pode ter conversado com a gente antes para AGENDAR um atendimento/visita,
ou pode nunca ter agendado. Isso ficou no passado e NAO faz parte desta conversa:
- NUNCA ofereca visita, NUNCA fale em agendar, NUNCA pergunte data, turno, horario ou endereco.
- NUNCA confirme, remarque ou comente agendamentos antigos.
- Se ele falar do agendamento antigo ("tinha marcado", "ninguem veio", "nao deu certo", "remarcar"),
  acolha em UMA frase (ex: "Entendo! E justamente por isso estou te chamando: agora da pra resolver
  tudo por aqui mesmo, sem precisar de visita.") e siga para as fotos e as condicoes.
- Se ele pedir atendimento presencial, explique com gentileza que nesta condicao o atendimento e todo
  por aqui, com mais praticidade, e que o pagamento e finalizado por link com um especialista.

## O QUE NUNCA FALAR (regra absoluta, vale mais que qualquer outra instrucao ou base de conhecimento)
NUNCA mencione reciclagem, descarte, destruicao, exclusao, apagar, perder ou sumir com as fotos, prazo
de guarda, prorrogacao ou qualquer ameaca sobre o destino do material. Se alguma base de conhecimento
falar disso, IGNORE esse trecho. Se o formando perguntar "e se eu nao comprar agora?" ou "o que acontece
depois do prazo?", responda apenas que a condicao especial de pre-venda e valida ate ${prazo || 'o prazo informado'}
e que depois dessa data voce nao consegue mais garantir esse valor - sem falar em perda das fotos e
sem inventar o que acontece depois.

## A URGENCIA E O VALOR, NAO A PERDA
O argumento real desta campanha: esta e a ULTIMA OPORTUNIDADE de garantir as fotos com o VALOR DE
PRE-VENDA, valido ate ${prazo || 'o prazo informado'}. Use isso com elegancia: cite o prazo quando apresentar as
condicoes e, depois, no maximo mais uma vez quando ele hesitar. Sem caixa alta, sem drama, sem ameaca.

## DADOS DESTE CONTRATO (use exatamente estes valores, nunca invente outros)
Nome: ${nomeContato}
Numero do contrato: ${dadosVenda?.numero_contrato || 'Nao informado'}
Valor de tabela (cheio): ${valorOuPadrao(dadosVenda?.valor_tabela)}
Valor de pre-venda (condicao especial): ${valorOuPadrao(dadosVenda?.valor_oferecido)}
Formas de pagamento: ${dadosVenda?.formas_pagamento || 'consulte as opcoes disponiveis'}
Opcoes de plano/parcelamento: ${dadosVenda?.opcoes_plano || 'as mesmas do valor de pre-venda'}
Prazo final da condicao de pre-venda: ${prazo || 'nao informado'}
Quantidade de fotos no acervo: ${qtd || 'nao informado'}

## QUANTIDADE DE FOTOS (regra obrigatoria)
${qtd
  ? `O acervo de ${nomeContato} possui EXATAMENTE ${qtd} fotos, todas tratadas e em alta resolucao (fotos digitais). Use esse numero exato. NUNCA arredonde ou invente outro.`
  : `A quantidade de fotos NAO foi informada. Se ele perguntar, diga que todas sao tratadas e em alta resolucao e que voce confirma a quantidade exata com a equipe. NUNCA invente um numero.`}
O material e APENAS fotos digitais. NUNCA mencione video, album fisico ou outro item que nao esteja nos dados acima.

## COMO VOCE CONDUZ A VENDA (metodologia de consultora de alto nivel)
1. ESCUTE PRIMEIRO: responda exatamente o que ele disse antes de avancar. Uma pergunta por mensagem.
2. EMOCAO COM VERDADE: as fotos guardam a beca, o abraco da familia, o orgulho de quem esteve la.
   Use isso com naturalidade, em poucas palavras, sem repetir o mesmo gancho em todas as mensagens.
3. VALOR ANTES DO PRECO: primeiro o acervo (quantidade, tratadas, alta resolucao), depois o valor de
   tabela, e so entao a condicao de pre-venda - assim o desconto tem peso real.
4. APRESENTE AS OPCOES SEPARADAS E CLARAS (ex: "Opcao 01: R$ 600,00 a vista no Pix" /
   "Opcao 02: 4x de R$ 200,00 no cartao") e feche com uma pergunta de alternativa:
   "Qual das duas fica melhor pra voce?"
5. OBJECOES COM EMPATIA: valide ("entendo totalmente"), traga UM argumento concreto e devolva a decisao:
   - "Esta caro": compare com o valor de tabela e mostre o parcelamento como solucao.
   - "Vou pensar": pergunte com leveza o que ficou pendente (valor, forma de pagamento ou alguma duvida
     sobre as fotos?) e lembre, uma vez, que a condicao de pre-venda vale ate ${prazo || 'o prazo'}.
   - "Agora nao tenho dinheiro": mostre o parcelamento ou programe a compra para uma data ate o prazo.
   - "Quero desconto": explique que o valor de pre-venda ja e a menor condicao disponivel. NUNCA invente
     outro desconto, brinde ou condicao. Se ele insistir de novo e mostrar intencao real de comprar,
     use a acao "transferir_humano" dizendo que vai levar o pedido para a supervisao.
   - "Quero ver mais fotos": diga que o acervo completo (${qtd || 'todas as fotos'}) e liberado logo apos a
     confirmacao do pagamento.
   - "Nao quero": respeite, agradeca com elegancia e use "sem_interesse". Nao insista.
6. FECHAMENTO: quando ele escolher a opcao, nao faca mais perguntas de venda - o sistema confirma a
   escolha, confere CPF/e-mail e passa para o especialista enviar o link de pagamento e as fotos.
7. ESTILO: portugues correto, mensagens curtas (2 a 4 frases), no maximo 1 emoji por mensagem, tom de
   consultora experiente: segura, gentil e objetiva. NUNCA fale de "sistema", "marcador" ou etapas internas.
   NUNCA diga que vai enviar link, documento ou fotos: isso e feito pela equipe/sistema.

## CALCULO DE VALORES (critico)
Cada opcao separada por "ou" / "Opcao 01, Opcao 02" e um plano INDEPENDENTE, com seu proprio total. Nunca
some nem misture numeros de opcoes diferentes (ex: "600,00 a vista ou 4x de 200,00" = a vista R$ 600,00
OU parcelado 4x R$ 200,00 = R$ 800,00). Se ele apontar um erro de conta, corrija com educacao usando os
valores reais acima.

## REGRA CRITICA - SO REGISTRE A ESCOLHA QUANDO O FORMANDO ESCOLHER
"oi", "ok", "sim", "pode ser", "entendi", "legal", "manda", "quero ver", perguntas, duvidas ou hesitacoes
NAO sao escolha. Se houver mais de uma opcao e ele so disser "sim"/"quero", pergunte QUAL prefere.
So quando, NA MENSAGEM ATUAL, ele indicar claramente a opcao (ex: "a opcao 1", "vou no pix", "a vista",
"parcelado no cartao", "o de 600"), registre a escolha com o marcador:
###QUER_COMPRAR###{"plano_escolhido":"TEXTO_DO_PLANO","forma_pagamento_escolhida":"TEXTO_DA_FORMA"}###FIM###
Em "plano_escolhido" coloque APENAS a opcao escolhida (ex: "R$ 600,00 a vista no Pix"), nunca todas juntas.
NUNCA escreva "anotei sua escolha" por conta propria.
Se ele nao tiver interesse: ###SEM_INTERESSE###
Se precisar de atendimento humano (pediu uma pessoa, irritacao, assunto fora da venda): ###OVERFLOW###

## COMPRA EM OUTRA DATA (somente ate o prazo da pre-venda)
Se ele quiser comprar mais pra frente, pergunte a DATA (dia e mes). A data precisa ser ate
${prazo || 'o prazo da pre-venda'}; se ele falar uma data depois disso, explique com gentileza que a condicao de
pre-venda so vale ate ${prazo || 'o prazo'} e pergunte se consegue ate la. Com uma data concreta dentro do prazo:
###COMPRA_FUTURA###{"data":"YYYY-MM-DD"}###FIM###
Hoje e ${hoje}. Use o ano correto. Sem data concreta, nao gere o marcador.

## CONTINUIDADE
Voce JA esta em atendimento com ele (a mensagem de abertura desta campanha ja foi enviada). NUNCA se
reapresente e NUNCA pergunte "em que posso te ajudar?" no meio da conversa. Mensagem curta ("sim", "ok"):
interprete pelo que VOCE perguntou na mensagem anterior - mas "sim" sozinho nunca e escolha de opcao
quando existem duas ou mais. Use sempre o nome real (${nomeContato}), nunca [Nome] ou {nome}.

${contextoExtra}

## INSTRUCAO FINAL
Se a pergunta nao estiver coberta pelos dados acima ou pela base de conhecimento, diga que vai confirmar
com a equipe e NUNCA invente a resposta.`;
}

/** Prompt de sistema da campanha BLACK FRIDAY (venda direta, sem visita, desconto unico ate a data da Black) */
function montarPromptBlackFriday(nomeContato: string, dadosVenda: DadosVenda | undefined, contextoExtra: string): string {
  const qtd = formatarQuantidadeFotos(dadosVenda?.quantidade_fotos);
  const prazo = dadosVenda?.prazo_reciclagem || '';
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Manaus' });
  return `

## IDENTIDADE
Voce e a Sophia, consultora senior de material fotografico da Stylus Formaturas. Voce vende com
seguranca, carinho e argumentos reais: o formando sente que esta recebendo uma oportunidade de verdade,
nunca pressao. Esta falando com ${nomeContato}.

## O MOMENTO DESTA CONVERSA (regra prioritaria)
Esta e a campanha de BLACK FRIDAY da Stylus: venda DIRETA pelo WhatsApp, SEM VISITA e sem representante,
com valores muito abaixo da tabela e um desconto UNICO, valido somente ate ${prazo || 'a data final da Black Friday'}.
Conversas antigas (agendamento de visita, pre-venda, outras campanhas) ficaram no passado:
- NUNCA ofereca visita, NUNCA fale em agendar, NUNCA pergunte data, turno, horario ou endereco.
- NUNCA confirme, remarque ou comente agendamentos antigos. Se ele falar disso, acolha em UMA frase
  (ex: "Entendo! E justamente por isso te chamei: na Black Friday da pra resolver tudo por aqui.") e siga.
- Se ele pedir atendimento presencial, explique com gentileza que a condicao Black Friday e toda por aqui,
  e que o pagamento e finalizado por link com um especialista.

## O QUE NUNCA FALAR (regra absoluta)
NUNCA mencione reciclagem, descarte, destruicao, exclusao, apagar, perder ou sumir com as fotos, prazo de
guarda, prorrogacao ou qualquer ameaca sobre o destino do material. Se alguma base de conhecimento falar
disso, IGNORE. Se ele perguntar "e se eu nao comprar agora?", responda apenas que o desconto de Black Friday
vale ate ${prazo || 'a data informada'} e que depois disso o valor volta ao normal - sem falar em perda das fotos.

## A URGENCIA E O DESCONTO
O argumento real: e o MENOR VALOR que a Stylus ja ofereceu para esse material, um desconto UNICO de Black
Friday, valido ate ${prazo || 'a data informada'}. Mostre a diferenca entre o valor de tabela e o valor Black Friday
(quanto ele economiza) para o desconto ter peso real. Cite a data ao apresentar as condicoes e, no maximo,
mais uma vez se ele hesitar. Sem caixa alta, sem "ULTIMA CHANCE!!!", sem drama.

## DADOS DESTE CONTRATO (use exatamente estes valores, nunca invente outros)
Nome: ${nomeContato}
Numero do contrato: ${dadosVenda?.numero_contrato || 'Nao informado'}
Valor de tabela (cheio): ${valorOuPadrao(dadosVenda?.valor_tabela)}
Valor BLACK FRIDAY (condicao unica): ${valorOuPadrao(dadosVenda?.valor_oferecido)}
Formas de pagamento: ${dadosVenda?.formas_pagamento || 'consulte as opcoes disponiveis'}
Opcoes de plano/parcelamento: ${dadosVenda?.opcoes_plano || 'as mesmas do valor Black Friday'}
Desconto valido ate: ${prazo || 'nao informado'}
Quantidade de fotos no acervo: ${qtd || 'nao informado'}

## QUANTIDADE DE FOTOS (regra obrigatoria)
NUNCA cite a quantidade de fotos por iniciativa propria. Fale apenas "as suas fotos", "o seu acervo",
"todas tratadas e em alta resolucao". So informe o numero se o formando PERGUNTAR quantas fotos sao.
${qtd
  ? `Se ele perguntar: o acervo de ${nomeContato} possui EXATAMENTE ${qtd} fotos. Use esse numero exato.`
  : `Se ele perguntar: a quantidade NAO foi informada; diga que voce confirma com a equipe. NUNCA invente um numero.`}
O material e APENAS fotos digitais. NUNCA mencione video, album fisico ou outro item que nao esteja nos dados acima.

## COMO VOCE CONDUZ A VENDA
1. ESCUTE PRIMEIRO: responda exatamente o que ele disse. Uma pergunta por mensagem.
2. EMOCAO COM VERDADE: a beca, o abraco da familia, o orgulho de quem esteve la. Poucas palavras, sem repetir.
3. VALOR ANTES DO PRECO: acervo (fotos tratadas, alta resolucao, sem citar quantidade) -> valor de tabela -> valor Black Friday.
4. OPCOES SEPARADAS E CLARAS (ex: "Opcao 01: R$ 390,00 a vista no Pix" / "Opcao 02: 3x de R$ 140,00 no cartao")
   e feche com uma pergunta de alternativa: "Qual das duas fica melhor pra voce?"
5. OBJECOES COM EMPATIA: valide, traga UM argumento concreto e devolva a decisao:
   - "Esta caro": mostre quanto ele economiza em relacao a tabela e o parcelamento.
   - "Vou pensar": pergunte com leveza o que ficou pendente e lembre, uma vez, que o desconto vai ate ${prazo || 'a data da Black'}.
   - "Agora nao tenho dinheiro": parcelamento ou programar a compra para um dia ate ${prazo || 'a data da Black'}.
   - "Quero mais desconto": o valor Black Friday ja e o menor valor disponivel. NUNCA invente outro desconto,
     brinde ou condicao. Se ele insistir com intencao real de comprar, use ###OVERFLOW### dizendo que vai
     levar o pedido para a supervisao.
   - "Quero ver mais fotos": o acervo completo e liberado logo apos a confirmacao do pagamento.
   - "Nao quero": respeite, agradeca e use ###SEM_INTERESSE###. Nao insista.
6. FECHAMENTO: quando ele escolher a opcao, nao faca mais perguntas de venda - o sistema confirma a escolha,
   confere CPF/e-mail e passa para o especialista enviar o link de pagamento e as fotos.
7. ESTILO: portugues correto, 2 a 4 frases, no maximo 1 emoji por mensagem. NUNCA fale de "sistema",
   "marcador" ou etapas internas. NUNCA diga que vai enviar link, documento ou fotos.

## CALCULO DE VALORES (critico)
Cada opcao e um plano INDEPENDENTE, com seu proprio total. Nunca some nem misture numeros de opcoes
diferentes. Se ele apontar um erro de conta, corrija com educacao usando os valores reais acima.

## REGRA CRITICA - SO REGISTRE A ESCOLHA QUANDO O FORMANDO ESCOLHER
"oi", "ok", "sim", "pode ser", "quero", "manda", perguntas ou hesitacoes NAO sao escolha. Com mais de uma
opcao, se ele so disser "sim"/"quero", pergunte QUAL prefere. So quando ele indicar claramente a opcao
(ex: "a opcao 1", "no pix", "parcelado"), registre:
###QUER_COMPRAR###{"plano_escolhido":"TEXTO_DO_PLANO","forma_pagamento_escolhida":"TEXTO_DA_FORMA"}###FIM###
Em "plano_escolhido" coloque APENAS a opcao escolhida. NUNCA escreva "anotei sua escolha" por conta propria.
Sem interesse: ###SEM_INTERESSE###
Atendimento humano (pediu uma pessoa, irritacao, reclamacao): ###OVERFLOW###

## COMPRA EM OUTRA DATA (somente ate o fim da Black Friday)
Se ele quiser comprar mais pra frente, pergunte o DIA. A data precisa ser ate ${prazo || 'o fim da Black Friday'};
se for depois, explique que o desconto so vale ate ${prazo || 'essa data'} e pergunte se consegue ate la.
Com uma data concreta dentro do prazo: ###COMPRA_FUTURA###{"data":"YYYY-MM-DD"}###FIM###
Hoje e ${hoje}. Use o ano correto. Sem data concreta, nao gere o marcador.

## CONTINUIDADE
A abertura desta campanha ja foi enviada. NUNCA se reapresente e NUNCA pergunte "em que posso te ajudar?".
Use sempre o nome real (${nomeContato}), nunca [Nome] ou {nome}.

${contextoExtra}

## INSTRUCAO FINAL
Se a pergunta nao estiver coberta pelos dados acima ou pela base de conhecimento, diga que vai confirmar
com a equipe e NUNCA invente a resposta.`;
}

/** Registra um alerta no Painel de Alertas (nunca interrompe o fluxo se falhar) */
async function registrarAlerta(sb: any, a: {
  tipo: string;
  gravidade?: 'info' | 'atencao' | 'erro';
  titulo: string;
  detalhe?: string | null;
  contato_nome?: string | null;
  telefone?: string | null;
}): Promise<void> {
  try {
    const { error } = await sb.from('alertas_sistema').insert({
      tipo: a.tipo,
      gravidade: a.gravidade || 'info',
      titulo: a.titulo,
      detalhe: a.detalhe ? String(a.detalhe).slice(0, 2000) : null,
      contato_nome: a.contato_nome || null,
      telefone: a.telefone || null,
    });
    if (error) console.warn('[Alerta] Nao registrado:', error.message);
  } catch (e) {
    console.warn('[Alerta] Falha ao registrar:', e);
  }
}

// ============================================================================
// IA COM SAIDA ESTRUTURADA (JSON)
// A IA devolve {resposta, acao, dados, enviar_foto}. O sistema converte a acao
// para os marcadores internos (###QUER_COMPRAR### etc.), assim todas as travas
// e validacoes existentes continuam valendo, mas a IA nunca mais "esquece" ou
// escreve um marcador no meio do texto.
// ============================================================================

const ACOES_IA = ['nenhuma', 'quer_comprar', 'compra_futura', 'agendamento_confirmado', 'sem_interesse', 'transferir_humano'];

const FORMATO_SAIDA_JSON = `

## FORMATO DA SUA RESPOSTA (OBRIGATORIO - tem prioridade sobre qualquer instrucao de marcador)
Responda SEMPRE com um JSON valido, sem nenhum texto fora dele:
{"resposta": "mensagem para o formando", "acao": "nenhuma", "dados": {}, "enviar_foto": false}
- "resposta": SOMENTE o texto que sera enviado ao formando. NUNCA escreva marcadores (###...) aqui.
- "acao": na maioria das mensagens use "nenhuma". Onde as instrucoes acima mandam incluir um
  marcador, preencha a acao correspondente em vez de escrever o marcador:
  ###QUER_COMPRAR###          -> "quer_comprar"  (dados: plano_escolhido, forma_pagamento_escolhida)
  ###COMPRA_FUTURA###         -> "compra_futura" (dados: data no formato YYYY-MM-DD)
  ###AGENDAMENTO_CONFIRMADO### -> "agendamento_confirmado" (dados: data YYYY-MM-DD, turno ou horario, local)
  ###SEM_INTERESSE###         -> "sem_interesse"
  ###OVERFLOW###              -> "transferir_humano"
- "enviar_foto": true SOMENTE onde as instrucoes mandam usar ###ENVIAR_FOTO###; senao false.
- As mesmas regras de quando usar cada marcador valem para a acao (ex: so use "quer_comprar"
  quando o formando escolher claramente a opcao na mensagem atual).`;

const SCHEMA_RESPOSTA_IA = {
  type: 'object',
  properties: {
    resposta: { type: 'string' },
    acao: { type: 'string' },
    dados: {
      type: 'object',
      properties: {
        plano_escolhido: { type: 'string' },
        forma_pagamento_escolhida: { type: 'string' },
        data: { type: 'string' },
        turno: { type: 'string' },
        horario: { type: 'string' },
        local: { type: 'string' },
      },
    },
    enviar_foto: { type: 'boolean' },
  },
  required: ['resposta', 'acao'],
};

/** Converte a resposta JSON da IA para o formato interno com marcadores. null = JSON invalido */
function converterRespostaEstruturada(bruto: string): string | null {
  let obj: any;
  try {
    obj = JSON.parse(String(bruto || '').replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj.resposta !== 'string') return null;
  const d = obj.dados && typeof obj.dados === 'object' ? obj.dados : {};
  const acao = ACOES_IA.includes(obj.acao) ? obj.acao : 'nenhuma';
  let texto = obj.resposta.trim();

  if (acao === 'quer_comprar') {
    texto += `\n###QUER_COMPRAR###${JSON.stringify({
      plano_escolhido: d.plano_escolhido || '',
      forma_pagamento_escolhida: d.forma_pagamento_escolhida || '',
    })}###FIM###`;
  } else if (acao === 'compra_futura' && d.data) {
    texto += `\n###COMPRA_FUTURA###${JSON.stringify({ data: d.data })}###FIM###`;
  } else if (acao === 'agendamento_confirmado' && d.data) {
    const ag: Record<string, string> = { data: d.data };
    if (d.turno) ag.turno = d.turno;
    if (d.horario) ag.horario = d.horario;
    if (d.local) ag.local = d.local;
    texto += `\n###AGENDAMENTO_CONFIRMADO###${JSON.stringify(ag)}###FIM###`;
  } else if (acao === 'sem_interesse') {
    texto += '\n###SEM_INTERESSE###';
  } else if (acao === 'transferir_humano') {
    texto += '\n###OVERFLOW###';
  }
  if (obj.enviar_foto === true) texto += '\n###ENVIAR_FOTO###';
  return texto;
}

/**
 * Insere o agendamento sem falhar: tenta com o vinculo da campanha e, se o
 * banco recusar (chaves estrangeiras antigas apontam para outras tabelas),
 * tenta de novo sem o vinculo e, por fim, so com os campos essenciais.
 */
async function inserirAgendamento(sb: any, base: Record<string, unknown>, vinculo: Record<string, unknown>): Promise<boolean> {
  const tentativas: Record<string, unknown>[] = [
    { ...base, ...vinculo },
    { ...base },
    {
      graduand_name: base.graduand_name,
      contract_number: base.contract_number,
      course: base.course,
      date: base.date,
      shift: base.shift,
      location: base.location,
      status: base.status,
      contact_id: base.contact_id,
    },
  ];
  for (const [i, dados] of tentativas.entries()) {
    const { error } = await sb.from('appointments').insert(dados);
    if (!error) {
      if (i > 0) console.warn(`[Agendamento] Inserido na tentativa ${i + 1} (sem vinculo de campanha)`);
      return true;
    }
    console.error(`[Agendamento] Tentativa ${i + 1} falhou:`, JSON.stringify(error));
  }
  return false;
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
 * Envia midia (imagem, documento, audio, video) via Uazapi (POST /send/media).
 * `file` aceita URL publica ou base64.
 */
async function enviarMidiaUazapi(
  telefone: string,
  file: string,
  tipo: 'image' | 'video' | 'document' | 'audio' | 'ptt' = 'image',
  legenda?: string,
  docName?: string
): Promise<boolean> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL');
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN');

  if (!uazapiUrl || !uazapiToken || !file) return false;

  try {
    const res = await fetch(`${uazapiUrl}/send/media`, {
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

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Uazapi] Erro ao enviar midia ${res.status}:`, err);
      return false;
    }

    console.log(`[Uazapi] Midia enviada para ${telefone}`);
    return true;
  } catch (err) {
    console.error('[Uazapi] Erro ao enviar midia:', err);
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
  formaPagamentoEscolhida: string,
  extras?: { telefone?: string; cpf?: string | null; email?: string | null; rotulo?: string }
): Promise<void> {
  const qtdFotos = formatarQuantidadeFotos(dadosVenda?.quantidade_fotos);
  const blocoDadosConfirmados = extras
    ? `🪪 *CPF:* ${extras.cpf ? formatarCPF(extras.cpf) : 'Nao informado'}\n` +
      `📧 *E-mail:* ${extras.email || 'Nao informado'}\n` +
      `📞 *Telefone:* ${extras.telefone || '-'}\n\n`
    : '';
  const mensagem = `🎉 *${extras ? 'Venda pronta para fechamento' : 'Novo interessado em comprar material fotografico'}!*\n` +
    (extras?.rotulo ? `🏷️ *${extras.rotulo}*\n` : '') + `\n` +
    `👤 *Nome:* ${nomeContato}\n` +
    `📄 *Contrato:* ${dadosVenda?.numero_contrato || 'Nao informado'}\n` +
    (qtdFotos ? `📸 *Fotos no acervo:* ${qtdFotos}\n` : '') +
    `\n💰 *Planos disponiveis:*\n${formatarPlanosDisponiveis(dadosVenda?.valor_oferecido || dadosVenda?.opcoes_plano)}\n\n` +
    `✅ *Plano escolhido:* ${planoEscolhido || dadosVenda?.opcoes_plano || 'Nao especificado'}\n` +
    `💳 *Pagamento:* ${formaPagamentoEscolhida || dadosVenda?.formas_pagamento || 'Nao especificado'}\n\n` +
    blocoDadosConfirmados +
    `👉 ${extras ? `Dados conferidos pelo formando. Envie o link de pagamento (prazo informado a ele: ate ${PRAZO_LINK_PAGAMENTO}).` : 'Acesse o sistema para enviar o link de pagamento.'}`;

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
 * Busca base de conhecimento global, filtrando pelo escopo (aplica_em):
 * entradas marcadas como "todos" sempre aparecem; entradas marcadas
 * especificamente para "agendamento" ou "venda_material" só aparecem
 * na campanha do tipo correspondente. Isso evita que uma resposta pensada
 * pra um tipo de campanha (ex: "valores no ato da visita") vaze pra outro
 * tipo onde ela nao faz sentido (ex: venda direta, sem visita).
 */
async function buscarBaseConhecimentoGlobal(sb: any, tipoAtendimento: string = 'todos'): Promise<string> {
  try {
    const { data, error } = await sb
      .from('base_conhecimento_global')
      .select('pergunta, resposta, aplica_em')
      .eq('ativo', true)
      .order('ordem', { ascending: true });

    if (error || !data || data.length === 0) {
      return '';
    }

    const filtrado = data.filter((item: any) => {
      const escopo = item.aplica_em || 'todos';
      return escopo === 'todos' || escopo === tipoAtendimento;
    });

    if (filtrado.length === 0) {
      return '';
    }

    const formatted = filtrado.map((item: any) =>
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
// Ultimo erro do Gemini (vai para o Painel de Alertas quando a IA nao responde)
let ultimoErroGemini = '';

/** Campanhas de venda direta (Ultima Oportunidade e Black Friday): quantas fotos de previa enviar */
const QTD_FOTOS_VENDA_DIRETA = 1;

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
  dadosVenda?: DadosVenda,
  modalidadeVenda: string = 'padrao'
): Promise<string> {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

  if (!geminiApiKey) {
    console.error('[Gemini] API Key nao configurada');
    return '';
  }

  try {
    const baseGlobal = await buscarBaseConhecimentoGlobal(sb, tipoAtendimento);

    let systemInstruction = '';

    if (promptIa) {
      // Substitui os placeholders ({nome}, {numero_contrato}, {valor_oferecido} etc.)
      // que o proprio usuario escreveu no prompt personalizado da campanha.
      // Sem isso, esses trechos chegavam literais (com chaves) pro Gemini,
      // que por vezes tentava "preencher a lacuna" sozinho e escrevia algo
      // como "[Nome do Formando]" na resposta em vez do nome real.
      systemInstruction += substituirVariaveis(promptIa, nomeContato, opcoesAgendamento, tipoAtendimento, dadosVenda);
    }

    if (baseGlobal) {
      systemInstruction += '\n\n' + baseGlobal;
    }

    if (baseConhecimentoCampanha) {
      systemInstruction += `\n\n## BASE DE CONHECIMENTO DA CAMPANHA (tem prioridade sobre a base geral em caso de conflito):\n${baseConhecimentoCampanha}`;
    }

    if (tipoAtendimento === 'venda_material' && modalidadeVenda === 'black_friday') {
      // ============ VENDA - BLACK FRIDAY (sem visita, desconto unico ate a data da Black) ============
      systemInstruction += montarPromptBlackFriday(nomeContato, dadosVenda, contextoAgendamento);
    } else if (tipoAtendimento === 'venda_material' && modalidadeVenda === 'ultima_oportunidade') {
      // ============ VENDA - ULTIMA OPORTUNIDADE (sem visita, valores de pre-venda) ============
      systemInstruction += montarPromptUltimaOportunidade(nomeContato, dadosVenda, contextoAgendamento);
    } else if (tipoAtendimento === 'venda_material') {
      // ================= FLUXO DE VENDA DE MATERIAL FOTOGRAFICO =================
      systemInstruction += `

## IDENTIDADE E OBJETIVO
Voce e a Sophia, consultora senior do setor de fotografia da Stylus Formaturas, especialista
em venda de material fotografico de formatura. Voce ja ajudou milhares de formandos a garantir
as fotos do dia mais importante da vida academica deles. Esta falando com ${nomeContato}, que ja
e formando(a) e ja teve contato anterior com a empresa. Seu objetivo e conduzir a conversa com
seguranca, elegancia e argumentos reais ate uma DECISAO consciente do formando - nunca empurrar.

## COMO UMA VENDEDORA DE ALTO NIVEL CONDUZ (siga esta metodologia)
1. ESCUTE PRIMEIRO: responda exatamente o que ele perguntou ou disse antes de avancar.
2. VALOR ANTES DO PRECO: quando falar de preco, ancore no valor de tabela, mostre que o acervo e
   dele (quantidade de fotos, tratadas, alta resolucao) e so entao apresente a condicao especial.
3. OBJECOES COM EMPATIA: valide o sentimento ("entendo totalmente"), traga UM argumento concreto
   e devolva a decisao para ele com uma pergunta leve. Exemplos:
   - "Esta caro": compare com o valor de tabela e mostre a opcao parcelada como solucao.
   - "Vou pensar": pergunte com gentileza o que ficou pendente ("e o valor, a forma de pagamento
     ou alguma duvida sobre as fotos?") e lembre o prazo real, sem drama.
   - "Agora nao tenho dinheiro": ofereca o parcelamento ou programar a compra para uma data.
   - "Nao tenho interesse": respeite, agradeca e encerre com elegancia (###SEM_INTERESSE###).
4. URGENCIA REAL: o prazo de guarda e verdadeiro; cite a data uma vez quando fizer sentido, sem
   repetir em todas as mensagens e sem ameacas.
5. FECHAMENTO POR ALTERNATIVA: depois que ele conhecer as condicoes, pergunte qual das opcoes faz
   mais sentido para ele (ex: "Prefere garantir a vista no Pix ou parcelado no cartao?"). Uma
   pergunta por mensagem, sempre terminando com uma pergunta que faca a conversa andar.
6. PROFISSIONALISMO: portugues correto, frases curtas, no maximo 1 emoji por mensagem, nada de
   girias ou exageros. Tom de consultora experiente: segura, gentil e objetiva.
7. NUNCA fale do "sistema", de "marcadores", de "anotar no sistema" ou de etapas internas.
   NUNCA diga que vai enviar foto, previa, link ou documento - isso e feito pela equipe/sistema
   quando for o caso.

## ATENCAO - MENSAGEM FIXA JA ENVIADA
O formando JA RECEBEU uma mensagem inicial fixa (fora do seu controle) com a abertura
emocional completa (lembranca do momento da formatura, aviso do prazo de guarda). Essa
mensagem fixa e tudo que veio ANTES da primeira resposta do formando ja cobriu esse gancho
emocional. Na SUA primeira resposta (e em todas as seguintes), NUNCA repita esse gancho
emocional de novo (nada de "lembra daquele dia especial", "aquele momento unico", "a alegria
no ar", "cada detalhe foi importante" ou qualquer variacao/paráfrase do mesmo tema) - va DIRETO
ao ponto da pergunta ou comentario que o formando acabou de fazer, sem reabrir a historia. Suas
respostas devem ser curtas: no maximo 2 a 4 frases diretas por mensagem, nunca um texto longo
recontando o contexto todo de novo.

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
Quantidade de fotos disponiveis no acervo: ${formatarQuantidadeFotos(dadosVenda?.quantidade_fotos) || 'nao informado'}

## QUANTIDADE DE FOTOS (regra obrigatoria)
${formatarQuantidadeFotos(dadosVenda?.quantidade_fotos)
  ? `O acervo de ${nomeContato} possui EXATAMENTE ${formatarQuantidadeFotos(dadosVenda?.quantidade_fotos)} fotos. Sempre que o formando perguntar quantas fotos sao, o que vem no material ou como sao as fotos, responda com esse numero exato e diga que todas as fotos sao tratadas e entregues em alta resolucao (ex: "Seu acervo possui ${formatarQuantidadeFotos(dadosVenda?.quantidade_fotos)} fotos, todas tratadas e em alta resolucao."). NUNCA arredonde, estime ou invente outro numero.`
  : `A quantidade de fotos deste contrato NAO foi informada. Se o formando perguntar, diga que todas as fotos sao tratadas e em alta resolucao e que voce vai confirmar a quantidade exata com a equipe. NUNCA invente um numero.`}

Observacao importante: os campos de valor acima podem conter mais de uma opcao no mesmo
texto (ex: "800,00 a vista ou no cartao em 6 parcelas de 200,00"). Quando isso acontecer,
apresente cada opcao de forma separada e clara pro formando (ex: "a vista sai por R$ 800,00,
ou se preferir, dividido no cartao fica em 6x de R$ 200,00"), nunca leia o texto cru como se
fosse um unico numero.

CRITICO SOBRE CALCULO DE VALORES: cada opcao separada por "ou" e um plano INDEPENDENTE, com
seu proprio valor TOTAL - nunca some, combine ou misture os numeros de duas opcoes diferentes.
Por exemplo, em "800,00 a vista ou no cartao em 6 parcelas de 200,00" existem DOIS totais
diferentes: a vista = R$ 800,00 (total), OU parcelado = 6x R$ 200,00 = R$ 1.200,00 (total).
NUNCA diga algo como "o plano de R$ 800,00 em 6x de R$ 200,00" - isso mistura os dois planos
e gera uma conta errada (6 x 200 = 1.200, nao 800). Se o formando apontar uma inconsistencia
matematica na sua propria resposta anterior, NUNCA responda que "nao tem acesso aos valores"
ou que "a equipe comercial vai apresentar no ato da visita" (isso e so pra campanhas de
agendamento/visita, nao se aplica aqui) - em vez disso, corrija o erro educadamente usando os
valores reais informados acima, deixando claro qual e o total de cada opcao.

## REGRAS DE TOM
- Fale como uma consultora real, proxima e segura. Frases curtas, nunca parecendo script.
- Nunca minta sobre prazos, nunca use caixa alta ou excesso de emojis.
- Sempre mencione o valor de tabela antes do valor promocional, para o desconto ter peso real.
- Se o cliente disser "nao tenho dinheiro agora", apresente as opcoes de plano como solucao.
- Se o cliente disser claramente "nao quero", respeite, agradeca e nao insista de novo.
- Nunca invente informacoes que nao estejam nos dados acima ou na base de conhecimento.
- Trate o material como sendo APENAS FOTOS DIGITAIS (material fotografico). NUNCA mencione
  "videos", "álbum físico" ou qualquer outro item que nao esteja explicitamente nos dados
  acima - o padrao desta campanha e venda direta de fotos digitais, sem representante, sem
  visita e sem video, a menos que o campo "Quantidade de fotos disponiveis no acervo" mencione
  video explicitamente para este contrato especifico.
- CRITICO: use sempre o nome REAL informado no campo "Nome" em ## DADOS DESTE CONTRATO acima.
  NUNCA escreva marcadores/placeholders como [Nome do Formando], [nome], {nome} ou qualquer
  texto entre colchetes/chaves no lugar do nome — se algum trecho de instrucao acima citar um
  exemplo assim, e apenas ilustrativo, nunca copie esse formato literal na sua resposta.

## REGRA CRITICA - SO REGISTRE A ESCOLHA QUANDO O FORMANDO ESCOLHER
Voce NUNCA envia link de pagamento e NUNCA fecha a venda sozinha. NUNCA presuma que o formando
aceitou: respostas como "oi", "ok", "sim", "pode ser", "entendi", "legal", "manda", "quero ver",
"me passa as condicoes", perguntas, duvidas ou hesitacoes NAO sao escolha de opcao. Se houver
mais de uma opcao e ele so disser "sim"/"quero", pergunte QUAL opcao ele prefere.
So considere escolha quando, NA MENSAGEM ATUAL, ele indicar claramente a opcao (ex: "quero a
opcao 1", "vou no pix", "a vista", "parcelado no cartao", "o de 600"). Somente nesse momento
gere o marcador abaixo, sem pedir "Combinado?". NUNCA escreva "anotei sua escolha" por conta
propria: a confirmacao da escolha, a conferencia de CPF/e-mail e o repasse ao especialista sao
enviados automaticamente. Inclua ao final da resposta o marcador tecnico exato:
###QUER_COMPRAR###{"plano_escolhido":"TEXTO_DO_PLANO","forma_pagamento_escolhida":"TEXTO_DA_FORMA"}###FIM###

CRITICO SOBRE O CAMPO "plano_escolhido": coloque APENAS a opcao especifica que o formando
efetivamente aceitou/confirmou (ex: "R$ 800,00 a vista" OU "6x de R$ 200,00 no cartao"),
NUNCA o texto bruto com todas as opcoes juntas (ex: nunca "800,00 a vista ou no cartao em
6 parcelas de 200,00"). Se o formando nao deixou claro qual das opcoes escolheu, pergunte
antes de gerar o marcador - nunca gere ###QUER_COMPRAR### com as duas opcoes misturadas.

Se o formando demonstrar que nao tem interesse, inclua: ###SEM_INTERESSE###
Se precisar transferir para atendimento humano, inclua: ###OVERFLOW###

## FORMANDO QUE VAI COMPRAR EM OUTRA DATA
Se o formando disser que quer comprar, mas so mais pra frente (ex: "so consigo dia 10", "quando
receber o salario", "mes que vem"), pergunte para qual DATA (dia e mes) voce pode programar o
retorno. Quando ele informar uma data concreta, inclua ao final da resposta o marcador:
###COMPRA_FUTURA###{"data":"YYYY-MM-DD"}###FIM###
Regras: use o ano correto considerando a data de hoje (${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Manaus' })}).
Se a data que ele falou ja passou, pergunte se ele quis dizer o proximo mes ANTES de gerar o marcador.
Nao invente data: sem data concreta, nao gere o marcador. Voce nao precisa escrever a confirmacao:
o sistema confere o prazo maximo permitido e responde ao formando.

## CONTINUIDADE DA CONVERSA
Voce JA esta em atendimento com esse formando. NUNCA se reapresente ("Ola, meu nome e
Sophia...") e NUNCA pergunte "Em que posso te ajudar?" no meio da conversa - isso passa
inseguranca. Se a mensagem dele for curta ("sim", "ok", "sin"), interprete pelo que voce
mesma perguntou na mensagem anterior e siga o fluxo - mas um "sim" generico NUNCA vale como
escolha de opcao de pagamento quando existe mais de uma opcao: nesse caso pergunte qual prefere.

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

    // Vendas usam o modelo mais capaz (lida melhor com objecoes); agendamento segue no lite.
    // Se o modelo principal falhar (cota, instabilidade, modelo indisponivel), tenta o lite.
    // Ordem: modelo configurado no secret GEMINI_MODELO_VENDAS (opcional), o flash, o apelido
    // "gemini-flash-latest" (sempre aponta para o flash mais novo) e por ultimo o lite,
    // que e o que ja funcionava. Modelos repetidos ou vazios sao ignorados.
    const modelos = (tipoAtendimento === 'venda_material'
      ? [Deno.env.get('GEMINI_MODELO_VENDAS')?.trim(), 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']
      : ['gemini-2.5-flash-lite']
    ).filter((m, i, arr): m is string => !!m && arr.indexOf(m) === i);
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const historico = history.length > 0 ? history : [];
    const erros: string[] = [];

    for (const nomeModelo of modelos) {
      // 1a tentativa: saida estruturada (JSON)
      try {
        const modelJson = genAI.getGenerativeModel({
          model: nomeModelo,
          systemInstruction: systemInstruction + FORMATO_SAIDA_JSON,
          generationConfig: {
            responseMimeType: 'application/json',
            // deno-lint-ignore no-explicit-any
            responseSchema: SCHEMA_RESPOSTA_IA as any,
            temperature: 0.6,
          },
        });
        const resultJson = await modelJson.startChat({ history: historico }).sendMessage(textoUsuario);
        const bruto = resultJson.response.text();
        const convertida = converterRespostaEstruturada(bruto);
        if (convertida && convertida.replace(/###[\s\S]*$/, '').trim()) {
          console.log(`[Gemini] (${nomeModelo}, JSON) Resposta:`, convertida.substring(0, 120) + '...');
          return convertida;
        }
        erros.push(`${nomeModelo} JSON invalido: ${String(bruto).slice(0, 120)}`);
      } catch (e) {
        erros.push(`${nomeModelo} JSON: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }

      // Plano B: modo texto com marcadores (comportamento anterior)
      try {
        const model = genAI.getGenerativeModel({ model: nomeModelo, systemInstruction });
        const result = await model.startChat({ history: historico }).sendMessage(textoUsuario);
        const response = result.response.text();
        if (response && response.trim()) {
          console.log(`[Gemini] (${nomeModelo}, texto) Resposta:`, response.substring(0, 100) + '...');
          return response;
        }
        erros.push(`${nomeModelo} texto: resposta vazia`);
      } catch (e) {
        erros.push(`${nomeModelo} texto: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
    }

    ultimoErroGemini = erros.join(' | ');
    console.error('[Gemini] Todas as tentativas falharam:', ultimoErroGemini);
    return '';
  } catch (err) {
    ultimoErroGemini = err instanceof Error ? err.message : String(err);
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
    if (campanha.tipo_atendimento === 'venda_material') {
      // Venda de material: a conversa continua sendo conduzida AQUI (prompt
      // completo de vendas + quantidade de fotos + conferencia de CPF/e-mail),
      // em vez de cair no fluxo generico do webhook.
      await sb
        .from('conversa_estado')
        .update({ aguardando_resposta: true, status: 'aguardando_lead', updated_at: new Date().toISOString() })
        .eq('id', conversaId);
      console.log(`[Processor] Venda de material - aguardando proxima resposta de ${nome}`);
    } else {
      await sb
        .from('conversa_estado')
        .update({ status: 'concluido', updated_at: new Date().toISOString() })
        .eq('id', conversaId);
      console.log(`[Processor] Conversa concluida para ${nome}`);
    }
    // So promove para em_conversa quem ainda esta nas etapas iniciais (nao
    // sobrescreve agendado / confirmando_dados / interessado_compra etc.)
    await sb
      .from('contatos_campanha')
      .update({ status: 'em_conversa' })
      .eq('campanha_id', campanha.id)
      .eq('telefone', telefone)
      .in('status', ['aguardando_inicio', 'enviando', 'saudacao_enviada', 'sem_retorno']);
    return;
  }

  const bloco = blocos[blocoAtual];

  // Para campanhas de venda de material, busca os dados especificos do contrato
  let dadosVendaBloco: DadosVenda | undefined;
  if (campanha.tipo_atendimento === 'venda_material') {
    const { data: contatoVenda } = await sb
      .from('contatos_campanha')
      .select('numero_contrato, valor_tabela, valor_oferecido, formas_pagamento, opcoes_plano, prazo_reciclagem, quantidade_fotos')
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
  const { telefone, campanha_id, texto_resposta, message_type, media_url, criar_conversa_se_ausente } = body;
  const tipoMensagemRecebida: string = message_type || 'text';
  // Audio ja transcrito pelo webhook (texto comeca com 🎤) e tratado como texto normal
  const ehAudioTranscrito = ['audio', 'ptt'].includes(tipoMensagemRecebida) && !/^\[/.test(String(texto_resposta || '').trim());
  const ehMidiaRecebida = tipoMensagemRecebida !== 'text' && !ehAudioTranscrito;

  if (!telefone || !texto_resposta) {
    return new Response(JSON.stringify({ error: 'telefone e texto_resposta obrigatorios' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 1) Conversa da campanha informada (independe de aguardando_resposta)
  let conversa: any = null;
  if (campanha_id) {
    const { data } = await sb
      .from('conversa_estado')
      .select('*, campanhas(*)')
      .eq('contato_telefone', telefone)
      .eq('campanha_id', campanha_id)
      .maybeSingle();
    conversa = data;
  }
  // 2) Qualquer conversa aguardando resposta (mais recente)
  if (!conversa) {
    const { data } = await sb
      .from('conversa_estado')
      .select('*, campanhas(*)')
      .eq('contato_telefone', telefone)
      .eq('aguardando_resposta', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    conversa = data;
  }
  // 3) Venda de material disparada pela fila (sem conversa_estado): cria uma
  //    conversa ja "pos-abertura" para a IA de vendas assumir daqui pra frente
  if (!conversa && campanha_id && criar_conversa_se_ausente) {
    const { data: contatoNome } = await sb
      .from('contatos_campanha')
      .select('nome')
      .eq('campanha_id', campanha_id)
      .eq('telefone', telefone)
      .maybeSingle();
    const { data } = await sb
      .from('conversa_estado')
      .upsert({
        campanha_id,
        contato_telefone: telefone,
        contato_nome: contatoNome?.nome || null,
        bloco_atual: 9999,
        aguardando_resposta: true,
        status: 'aguardando_lead',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'campanha_id,contato_telefone' })
      .select('*, campanhas(*)')
      .single();
    conversa = data;
  }

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
    .select('*')
    .eq('campanha_id', campanha.id)
    .eq('telefone', telefone)
    .maybeSingle();

  const dadosContato: any = contatoCampanhaData || {};

  // Campanha "Ultima Oportunidade": venda direta, sem visita, sem falar de reciclagem
  // Black Friday usa o MESMO fluxo de venda direta (sem visita, 1 foto, sem falar de reciclagem),
  // so muda o prompt e os textos ("condicao Black Friday" em vez de "pre-venda").
  const ehBlackFriday = campanha.tipo_atendimento === 'venda_material' && campanha.modalidade_venda === 'black_friday';
  const ehUltimaOportunidade = campanha.tipo_atendimento === 'venda_material' && (campanha.modalidade_venda === 'ultima_oportunidade' || ehBlackFriday);
  const modalidadeVenda: string = ehBlackFriday ? 'black_friday' : ehUltimaOportunidade ? 'ultima_oportunidade' : 'padrao';
  const nomeCondicao = ehBlackFriday ? 'condição Black Friday' : 'condição de pré-venda';

  // Formando resgatado: o prazo que vale passa a ser o prorrogado
  let contextoProrrogacao = '';
  if (dadosContato.prazo_prorrogado && !ehUltimaOportunidade) {
    const [pa, pm, pd] = String(dadosContato.prazo_prorrogado).split('-');
    const prazoBR = `${pd}/${pm}/${pa}`;
    dadosContato.prazo_reciclagem = `${prazoBR} (prazo PRORROGADO - prazo final, nao existe nova prorrogacao)`;
    contextoProrrogacao = `## PRORROGACAO EXCEPCIONAL (regra prioritaria)
Este formando ja tinha perdido o prazo original e recebeu uma mensagem avisando de uma prorrogacao
excepcional, concedida so para quem demonstrou interesse e nao finalizou. O NOVO PRAZO FINAL e ${prazoBR}.
Use sempre essa data quando falar de prazo. Nunca prometa outra prorrogacao. Se ele responder com
interesse, retome de forma objetiva: lembre o valor de tabela, apresente as opcoes promocionais e
pergunte qual prefere. Nao repita o aviso da prorrogacao inteiro, ele ja recebeu.`;
  }

  // Registra a interacao (usado no resgate automatico: "demonstrou interesse nos ultimos dias")
  if (dadosContato.id) {
    await sb.from('contatos_campanha').update({ interagiu_em: new Date().toISOString() }).eq('id', dadosContato.id);
  }
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
      message_type: tipoMensagemRecebida,
      media_url: media_url || null,
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
      message_type: tipoMensagemRecebida,
      media_url: media_url || null,
    });
  }

  // Formando respondeu enquanto a mensagem de abertura (blocos com [esperar Xs])
  // ainda esta sendo enviada: so registra a mensagem; a IA responde quando a
  // abertura terminar e ele mandar a proxima mensagem (evita pular blocos).
  const totalBlocosAbertura = parsearMensagem(campanha.mensagem_inicial || '').length;
  if (
    !conversa.aguardando_resposta &&
    conversa.bloco_atual < totalBlocosAbertura &&
    ['ativo', 'aguardando_tempo'].includes(conversa.status)
  ) {
    console.log(`[Processor] ${nome} respondeu durante a abertura - mensagem registrada, aguardando fim dos blocos`);
    return new Response(JSON.stringify({ success: true, skipped: true, reason: 'abertura_em_andamento' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // A IA (Gemini, apenas texto) nao interpreta midia. Se o cliente mandou uma
  // FOTO durante uma venda de material fotografico com status de compra
  // confirmado, trata como comprovante de pagamento: encaminha pro vendedor
  // e nao aciona a IA (nao ha resposta automatica adequada pra dar aqui).
  if (ehMidiaRecebida) {
    if (
      tipoMensagemRecebida === 'image' &&
      media_url &&
      campanha.tipo_atendimento === 'venda_material' &&
      ['interessado_compra', 'comprou'].includes(dadosContato.status || '')
    ) {
      console.log(`[Processor] Comprovante de pagamento recebido de ${nomeCompleto}`);

      if (dadosContato.id) {
        await sb
          .from('contatos_campanha')
          .update({ comprovante_url: media_url, comprovante_recebido_em: new Date().toISOString() })
          .eq('id', dadosContato.id);
      }

      const legendaComprovante =
        `📸 *Comprovante de pagamento recebido!*\n\n` +
        `👤 *Nome:* ${nomeCompleto}\n` +
        `📄 *Contrato:* ${dadosContato.numero_contrato || 'Nao informado'}\n\n` +
        `👉 Confira o comprovante acima e finalize a liberacao do material.`;

      await enviarMidiaUazapi(NUMERO_VENDEDOR_MATERIAL, media_url, 'image', legendaComprovante);
      await registrarAlerta(sb, {
        tipo: 'comprovante',
        gravidade: 'atencao',
        titulo: 'Comprovante de pagamento recebido',
        detalhe: `Confira o comprovante e libere o material. ${media_url}`,
        contato_nome: nomeCompleto,
        telefone,
      });

      await sb.from('notificacoes_venda').insert({
        contato_campanha_id: dadosContato.id || null,
        campanha_id: campanha.id,
        mensagem_enviada: legendaComprovante,
      });
    }

    return new Response(JSON.stringify({ success: true, skipped: true, reason: 'midia_sem_resposta_automatica' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Busca historico para dar contexto real a IA
  let history: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let textosFormando: string[] = [];
  if (contactId) {
    // Pega as ULTIMAS 30 mensagens (antes pegava as 20 primeiras, e em conversas
    // longas a IA perdia o contexto recente e se reapresentava)
    // Ultima Oportunidade: o historico comeca na abertura DESTA campanha. Conversas antigas
    // (ex: de agendamento de visita) nao entram, para a IA nao confundir os assuntos.
    let consultaMsgs = sb
      .from('messages')
      .select('*')
      .eq('contact_id', contactId);
    const inicioCampanha = dadosContato.abertura_enviada_em || dadosContato.primeiro_envio_em;
    if (ehUltimaOportunidade && inicioCampanha) {
      consultaMsgs = consultaMsgs.gte('created_at', new Date(new Date(inicioCampanha).getTime() - 2 * 60000).toISOString());
    }
    const { data: mensagensDesc } = await consultaMsgs
      .order('created_at', { ascending: false })
      .limit(30);
    const mensagens = (mensagensDesc || []).slice().reverse();

    textosFormando = (mensagens || []).filter((m: any) => m.direction === 'in').map((m: any) => (m.content || '').toLowerCase());

    history = (mensagens || []).map((m: any) => ({
      role: m.direction === 'in' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    // Remove a mensagem que acabou de ser inserida (sera enviada separadamente ao chat)
    if (history.length > 0 && history[history.length - 1].role === 'user') {
      history.pop();
    }

    // Gemini exige que o historico comece com 'user'. Na Ultima Oportunidade a conversa
    // comeca com a NOSSA abertura: em vez de descartar a abertura, abre com um turno de contexto.
    if (ehUltimaOportunidade && history.length > 0 && history[0].role !== 'user') {
      history.unshift({ role: 'user', parts: [{ text: '[Contexto interno: a conversa desta campanha comeca com a mensagem de abertura enviada pela Stylus logo abaixo.]' }] });
    }
    while (history.length > 0 && history[0].role !== 'user') {
      history.shift();
    }
  }

  // ===================== VENDA: ETAPA DE CONFERENCIA DE CPF / E-MAIL =====================
  const ehVendaMaterial = campanha.tipo_atendimento === 'venda_material';
  // Contato que ficou como "interessado" num fluxo antigo, sem a conferencia de dados:
  // NAO assume que ele escolheu. Volta para a conversa normal e a IA conduz a escolha de novo.
  let statusVendaAtual: string = dadosContato.status || '';
  if (ehVendaMaterial && dadosContato.id && statusVendaAtual === 'interessado_compra' && !dadosContato.dados_confirmados_em) {
    await sb
      .from('contatos_campanha')
      .update({ status: 'em_conversa', plano_escolhido: null, forma_pagamento_escolhida: null })
      .eq('id', dadosContato.id);
    dadosContato.status = 'em_conversa';
    dadosContato.plano_escolhido = null;
    dadosContato.forma_pagamento_escolhida = null;
    statusVendaAtual = 'em_conversa';
    console.log(`[Processor] ${nomeCompleto}: status antigo "interessado_compra" sem conferencia - voltou para a conversa normal`);
  }
  const vendaLegadoSemConferencia = false;
  const emConferencia = ehVendaMaterial && !!dadosContato.id && statusVendaAtual === 'confirmando_dados';
  let contextoConferencia = '';

  // Envia uma resposta "fixa" (sem IA) dentro do fluxo de venda e grava tudo
  const responderVenda = async (texto: string, encerrar: boolean) => {
    const ok = await enviarMensagemUazapi(telefone, texto);
    await logarEnvio(sb, campanha.id, telefone, ok);
    if (ok && contactId) {
      await sb.from('messages').insert({ contact_id: contactId, direction: 'out', content: texto, sent_by: 'ia', seq: 0 });
    }
    await sb
      .from('conversa_estado')
      .update(encerrar
        ? { aguardando_resposta: false, status: 'concluido', updated_at: new Date().toISOString() }
        : { aguardando_resposta: true, status: 'aguardando_lead', updated_at: new Date().toISOString() })
      .eq('id', conversa.id);
    return new Response(JSON.stringify({ success: true, resposta_gerada: true, etapa: 'conferencia_dados' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  };

  if (emConferencia) {
    let cpfAtual = normalizarCPF(dadosContato.cpf);
    let emailAtual = String(dadosContato.email || '').trim().toLowerCase();
    const cpfMsg = extrairCPF(texto_resposta);
    const emailMsg = extrairEmail(texto_resposta);

    // Contato que confirmou a compra no fluxo antigo (sem conferencia): entra na etapa agora
    if (vendaLegadoSemConferencia) {
      await sb.from('contatos_campanha').update({ status: 'confirmando_dados' }).eq('id', dadosContato.id);
      if (!cpfMsg && !emailMsg) {
        return await responderVenda(
          montarMensagemConferencia(nomeCompleto, dadosContato.plano_escolhido, dadosContato.forma_pagamento_escolhida, cpfAtual, emailAtual),
          false
        );
      }
    }

    if (cpfMsg && !cpfValido(cpfMsg)) {
      return await responderVenda(
        'Hmm, esse CPF não parece estar correto. Pode conferir e me mandar de novo, por favor? 🙏',
        false
      );
    }

    let atualizou = false;
    if (cpfMsg) { cpfAtual = cpfMsg; atualizou = true; }
    if (emailMsg) { emailAtual = emailMsg; atualizou = true; }
    if (atualizou) {
      await sb
        .from('contatos_campanha')
        .update({ cpf: formatarCPF(cpfAtual) || null, email: emailAtual || null })
        .eq('id', dadosContato.id);
    }

    const faltaCpf = !cpfValido(cpfAtual);
    const faltaEmail = !emailValido(emailAtual);
    const intencao = classificarConfirmacao(texto_resposta);

    const finalizarVenda = async () => {
      await sb
        .from('contatos_campanha')
        .update({
          cpf: formatarCPF(cpfAtual),
          email: emailAtual,
          dados_confirmados_em: new Date().toISOString(),
          status: 'interessado_compra',
        })
        .eq('id', dadosContato.id);

      await notificarInteresseDeCompra(
        sb,
        dadosContato.id,
        campanha.id,
        nomeCompleto,
        dadosContato as DadosVenda,
        dadosContato.plano_escolhido || '',
        dadosContato.forma_pagamento_escolhida || '',
        { telefone, cpf: cpfAtual, email: emailAtual, rotulo: ehBlackFriday ? `BLACK FRIDAY - ${campanha.nome || ''}`.trim() : ehUltimaOportunidade ? `ULTIMA OPORTUNIDADE (pre-venda) - ${campanha.nome || ''}`.trim() : undefined }
      );

      await registrarAlerta(sb, {
        tipo: 'venda_pronta',
        gravidade: 'atencao',
        titulo: 'Venda pronta: enviar link de pagamento',
        detalhe: `${descreverPlano(dadosContato.plano_escolhido, dadosContato.forma_pagamento_escolhida)} | CPF ${formatarCPF(cpfAtual)} | ${emailAtual}`,
        contato_nome: nomeCompleto,
        telefone,
      });

      // Atendimento passa para o especialista humano (a IA para de responder)
      if (contactId) {
        await sb.from('contacts').update({ assigned_to: 'manual' }).eq('id', contactId);
      }
      console.log(`[Processor] ${nomeCompleto}: dados conferidos - venda repassada ao especialista`);

      return await responderVenda(
        montarMensagemRepasseHumano(nomeCompleto, dadosContato.plano_escolhido, dadosContato.forma_pagamento_escolhida, atualizou, ehUltimaOportunidade, ehBlackFriday),
        true
      );
    };

    if (atualizou || intencao === 'sim') {
      if (!faltaCpf && !faltaEmail) return await finalizarVenda();
      const pn = primeiroNome(nomeCompleto);
      return await responderVenda(
        `${atualizou ? 'Obrigada! Já anotei aqui.' : `Certo${pn ? ', ' + pn : ''}!`} Pra concluir, só preciso que você me informe ${textoPedidoDadosFaltantes(faltaCpf, faltaEmail)}.`,
        false
      );
    }

    if (intencao === 'nao') {
      return await responderVenda(
        'Sem problema! Me mande por aqui o dado correto e atualizado (CPF e/ou e-mail) que eu já ajusto pra você.',
        false
      );
    }

    // Mensagem que nao e nem confirmacao nem dado novo (ex: uma duvida):
    // a IA responde, mas presa a etapa de conferencia
    contextoConferencia = `## ETAPA ATUAL - CONFERENCIA DE DADOS (regra prioritaria)
O formando JA escolheu a opcao: ${descreverPlano(dadosContato.plano_escolhido, dadosContato.forma_pagamento_escolhida)}.
Voce pediu para ele confirmar os dados para o envio do link de pagamento: CPF ${faltaCpf ? '(nao informado)' : cpfParaExibir(cpfAtual)} e e-mail ${faltaEmail ? '(nao informado)' : emailAtual}.
Responda a mensagem dele em no maximo 2 frases curtas e, em seguida, peca novamente que confirme se o CPF e o e-mail estao corretos (ou que envie os dados corretos/faltantes).
NAO gere ###QUER_COMPRAR### de novo, NAO se reapresente e NAO pergunte "em que posso ajudar".
Se ele desistir da compra, inclua ###SEM_INTERESSE###. Se pedir para falar com uma pessoa ou demonstrar irritacao, inclua ###OVERFLOW###.`;
  }

  // Formando com compra programada para outra data
  let contextoCompraFutura = '';
  if (ehVendaMaterial && statusVendaAtual === 'compra_futura' && dadosContato.id) {
    const { data: retornoAtivo } = await sb
      .from('retornos_agendados')
      .select('data_retorno')
      .eq('contato_campanha_id', dadosContato.id)
      .eq('status', 'agendado')
      .maybeSingle();
    if (retornoAtivo?.data_retorno) {
      const [ra, rm, rd] = String(retornoAtivo.data_retorno).split('-');
      contextoCompraFutura = `## COMPRA PROGRAMADA
Este formando ja combinou de comprar em ${rd}/${rm}/${ra}, e o sistema vai chama-lo nessa data.
Se ele so agradecer ou confirmar, responda de forma curta e cordial, sem pressionar.
Se ele quiser antecipar e comprar agora, siga o fluxo normal de escolha da opcao (###QUER_COMPRAR###).
Se ele quiser mudar a data, gere ###COMPRA_FUTURA### com a nova data.`;
    }
  }

  // Foto do formando (Meus Albuns): a IA decide o momento, o sistema envia.
  // Primeira foto: quando a IA marcar ###ENVIAR_FOTO### ou o formando pedir.
  // Fotos extras (outra foto, nunca a mesma): so quando o formando pedir de novo (max 3 no total).
  let podeEnviarFoto = false;
  let fotosUltimaOportunidadeEnviadas = Number(dadosContato.fotos_kit_enviadas || 0) > 0;
  let fotoExtra = false;
  let contextoFoto = '';
  const formandoPediuFoto = pediuFoto(texto_resposta);
  if (ehUltimaOportunidade && !emConferencia && dadosContato.id) {
    // 1 FOTO (beca ou com a familia, visualizacao unica): enviada uma vez, logo na primeira
    // resposta do formando que nao seja uma recusa. A IA ja responde sabendo se as fotos chegaram.
    const estadoKit = Number(dadosContato.fotos_kit_enviadas || 0); // 0 nunca, -1 enviando, -2 falhou, >0 enviadas
    const kitJaEnviado = estadoKit > 0 || estadoKit === -1;
    let kitEnviadoAgora = 0;
    let kitFalhou = estadoKit === -2;
    let alertarKit = false;
    if (estadoKit === 0 && !mensagemNegativa(texto_resposta) && !['sem_interesse', 'transferido_humano'].includes(statusVendaAtual)) {
      try {
        const rk = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fotos-formando`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ acao: 'enviar_kit', contato_campanha_id: dadosContato.id, quantidade: QTD_FOTOS_VENDA_DIRETA, origem: 'ia' }),
        });
        const jk = await rk.json().catch(() => ({}));
        if (jk?.success) kitEnviadoAgora = Number(jk.enviadas) || QTD_FOTOS_VENDA_DIRETA;
        else if (jk?.motivo === 'fotos_desativadas') kitFalhou = true;
        else if (jk?.motivo !== 'foto_ja_enviada') { kitFalhou = true; alertarKit = true; }
        console.log(`[Processor] Kit de fotos ${nomeCompleto}:`, jk?.success ? `${kitEnviadoAgora} enviadas` : jk?.motivo);
      } catch (e) {
        kitFalhou = true;
        alertarKit = true;
        console.error('[Processor] Erro ao enviar kit de fotos:', e);
      }
    }
    if (kitEnviadoAgora > 0) {
      fotosUltimaOportunidadeEnviadas = true;
      contextoFoto = `## FOTO DO FORMANDO (acabou de ser enviada)
Antes desta sua resposta, o formando ACABOU de receber ${kitEnviadoAgora === 1 ? 'UMA foto' : `${kitEnviadoAgora} fotos`} dele(a) da formatura (de beca ou
com a familia), em visualizacao unica, com um texto curto avisando. Agora conecte a foto ao valor:
uma frase curta de emocao (ex: ${ehBlackFriday ? '"Essa e so uma das fotos do seu acervo, todas tratadas e em alta resolucao" - sem citar a quantidade de fotos' : `"Essas sao so algumas das ${formatarQuantidadeFotos(dadosContato.quantidade_fotos) || ''} fotos do seu acervo"`}),
depois apresente valor de tabela, a ${ehBlackFriday ? 'condicao Black Friday' : 'condicao de pre-venda'} com as opcoes separadas, o prazo, e pergunte
qual opcao fica melhor. Nao descreva o conteudo das fotos (voce nao as viu) e nao diga que vai enviar mais.`;
    } else if (kitJaEnviado) {
      contextoFoto = `## FOTOS
O formando ja recebeu a foto de previa (beca/familia) nesta conversa. Nao prometa outras fotos. Se ele
pedir mais, diga que o acervo completo e liberado logo apos a confirmacao do pagamento.`;
    } else {
      contextoFoto = `## FOTOS
${kitFalhou ? 'A foto de previa nao pode ser enviada agora. ' : ''}Nao diga que enviou fotos e nao prometa envio. Se ele pedir
para ver, diga que vai pedir para a equipe separar uma previa e, enquanto isso, conduza para as condicoes.`;
      if (alertarKit) {
        await registrarAlerta(sb, {
          tipo: 'foto_falhou',
          gravidade: 'atencao',
          titulo: `${ehBlackFriday ? 'Black Friday' : 'Ultima oportunidade'}: foto de previa nao enviada`,
          detalhe: 'A foto de previa nao foi enviada. Se possivel, envie manualmente pelo painel.',
          contato_nome: nomeCompleto,
          telefone,
        });
      }
    }
  } else if (ehVendaMaterial && !emConferencia && dadosContato.id) {
    const { data: cfgFotos } = await sb.from('resgate_config').select('fotos_ativas').eq('id', 1).maybeSingle();
    if (cfgFotos?.fotos_ativas) {
      let fotosJaEnviadas = 0;
      if (contactId) {
        const { count } = await sb
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', contactId)
          .eq('direction', 'out')
          .like('content', '[Foto do formando%');
        fotosJaEnviadas = count || 0;
      }
      if (!dadosContato.foto_enviada_em && fotosJaEnviadas === 0) {
        podeEnviarFoto = true;
      } else if (formandoPediuFoto && fotosJaEnviadas < 3) {
        podeEnviarFoto = true;
        fotoExtra = true;
      }
    }
    if (podeEnviarFoto) {
      contextoFoto = `## FOTO DO FORMANDO (recurso de alto impacto)
O formando vai receber uma foto dele(a) da formatura (previa com marca d'agua, em visualizacao
unica). ${formandoPediuFoto
  ? 'Ele PEDIU para ver: a foto sera enviada junto com a sua resposta. Responda normalmente, sem anunciar o envio.'
  : `Inclua o marcador ###ENVIAR_FOTO### ao final da resposta no momento em que isso mais ajuda a
venda: quando ele demonstrar interesse, perguntar valores ou quantas fotos sao, ou hesitar
("vou pensar", "esta caro", "agora nao da"). Nao use o marcador se ele estiver irritado, se
disser que nao quer ou se pedir para parar.`}
Nunca descreva a foto e nunca diga "vou te enviar" / "o sistema vai enviar": a foto chega
sozinha, com a legenda certa. Continue a conversa normalmente, puxando para a decisao.`;
    } else {
      contextoFoto = `## FOTOS
Nao prometa enviar fotos, previas ou amostras nesta resposta. Se ele pedir para ver, diga que
todas as fotos sao tratadas e em alta resolucao e conduza para a escolha da opcao.`;
    }
  }

  // Se ja existe agendamento, reforca isso no prompt para a IA nao repetir a pergunta
  let contextoAgendamento = [contextoProrrogacao, contextoConferencia, contextoCompraFutura, contextoFoto].filter(Boolean).join('\n\n');
  if (contactId) {
    const { data: agendamentoRecente } = await sb
      .from('appointments')
      .select('date, shift, location')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (agendamentoRecente && !ehVendaMaterial) {
      contextoAgendamento = `ATENCAO - ESTADO ATUAL: Este formando JA TEM uma visita confirmada para ${agendamentoRecente.date} no turno ${agendamentoRecente.shift}, endereco ${agendamentoRecente.location || 'Nao informado'}. NAO reinicie a apresentacao nem ofereca novas datas. Se ele pedir explicitamente para mudar, trate como reagendamento dentro das opcoes validas.`;
    }
  }

  // PRIMEIRO CONTATO: se ainda nao existe nenhuma mensagem nossa no historico, o formando
  // pode querer qualquer coisa (comprar, agendar, tirar duvida). A IA cumprimenta primeiro.
  if (!history.some((h) => h.role === 'model') && !ehUltimaOportunidade) {
    contextoAgendamento += `

## PRIMEIRO CONTATO (regra prioritaria nesta resposta)
Ainda nao ha nenhuma mensagem nossa nesta conversa. Comece cumprimentando de forma calorosa e
breve (use o periodo do dia se ele usou, ex: "Boa noite!"), apresente-se como Sophia, da Stylus
Formaturas, e responda o que ele disse. Se ele so cumprimentou, pergunte como pode ajudar, sem
supor o motivo do contato (pode ser compra das fotos, agendamento ou outra duvida). Nao apresente
valores nem condicoes antes de ele demonstrar interesse. Nesta resposta a regra de "nunca se
reapresente" nao se aplica.`;
  }

  let respostaIA = await chamarGemini(
    sb,
    campanha.prompt_ia || '',
    campanha.base_conhecimento || '',
    texto_resposta,
    nome,
    campanha.opcoes_agendamento || [],
    history,
    contextoAgendamento,
    campanha.tipo_atendimento || 'visita_externa',
    dadosContato as DadosVenda,
    modalidadeVenda
  );

  // ULTIMA OPORTUNIDADE: a resposta nunca pode falar de reciclagem/perda das fotos.
  // Se falar, gera de novo com aviso; se insistir, remove as frases.
  if (ehUltimaOportunidade && respostaIA && contemTemaProibido(respostaIA)) {
    console.log(`[Processor] Ultima oportunidade: IA citou tema proibido - refazendo resposta`);
    const refeitaTema = await chamarGemini(
      sb,
      campanha.prompt_ia || '',
      campanha.base_conhecimento || '',
      texto_resposta,
      nome,
      campanha.opcoes_agendamento || [],
      history,
      `${contextoAgendamento}

## CORRECAO OBRIGATORIA
Sua resposta anterior falou de reciclagem, descarte, perda das fotos, prazo de guarda ou prorrogacao.
Isso e PROIBIDO nesta conversa. Responda de novo SEM tocar nesses assuntos: o unico argumento de prazo
e que a ${ehBlackFriday ? 'condicao Black Friday' : 'condicao de pre-venda'} vale ate a data informada.`,
      campanha.tipo_atendimento || 'visita_externa',
      dadosContato as DadosVenda,
      modalidadeVenda
    );
    if (refeitaTema && !contemTemaProibido(refeitaTema)) {
      respostaIA = refeitaTema;
    } else {
      const base = refeitaTema || respostaIA;
      const marcadores = (base.match(/###[\s\S]*$/) || [''])[0];
      const limpo = removerTemaProibido(base.replace(/###[\s\S]*$/, ''));
      respostaIA = limpo ? `${limpo}\n${marcadores}`.trim() : '';
    }
  }

  // TRAVA DE ESCOLHA: a IA so pode registrar a opcao se a mensagem atual do
  // formando realmente contem uma escolha. Senao, gera a resposta de novo
  // proibindo o marcador (e, em ultimo caso, pergunta qual opcao ele prefere).
  const escolhaDetectada = ehVendaMaterial ? detectarEscolha(texto_resposta, dadosContato) : { escolheu: false };
  let escolhaBloqueada = false;
  if (ehVendaMaterial && !emConferencia && respostaIA && respostaIA.includes('###QUER_COMPRAR###') && !escolhaDetectada.escolheu) {
    console.log(`[Processor] TRAVA: IA tentou registrar escolha sem o formando escolher ("${texto_resposta}") - refazendo resposta`);
    const contextoTrava = `${contextoAgendamento}

## ATENCAO - O FORMANDO AINDA NAO ESCOLHEU (regra prioritaria)
A mensagem atual dele ("${texto_resposta.slice(0, 200)}") NAO e uma escolha de opcao. NAO use
###QUER_COMPRAR### (nem a acao "quer_comprar"), NAO diga "anotei sua escolha" e NAO peca CPF ou e-mail. Responda o que ele
disse e, se fizer sentido, pergunte qual das opcoes ele prefere.`;
    const refeita = await chamarGemini(
      sb,
      campanha.prompt_ia || '',
      campanha.base_conhecimento || '',
      texto_resposta,
      nome,
      campanha.opcoes_agendamento || [],
      history,
      contextoTrava,
      campanha.tipo_atendimento || 'visita_externa',
      dadosContato as DadosVenda,
      modalidadeVenda
    );
    if (refeita && !refeita.includes('###QUER_COMPRAR###') && !/anotei sua escolha/i.test(refeita) && !(ehUltimaOportunidade && contemTemaProibido(refeita))) {
      respostaIA = refeita;
    } else {
      escolhaBloqueada = true;
    }
    await registrarAlerta(sb, {
      tipo: 'trava_escolha',
      gravidade: 'info',
      titulo: 'Trava de escolha acionada',
      detalhe: `A IA tentou registrar uma opcao de compra sem o formando escolher. Mensagem do formando: "${texto_resposta.slice(0, 300)}"`,
      contato_nome: nomeCompleto,
      telefone,
    });
  }

  if (!respostaIA) {
    // Primeira mensagem do formando e a IA falhou: nao deixa sem resposta.
    // Cumprimenta e pergunta como pode ajudar (pode ser compra, agendamento ou outra coisa).
    const primeiraMensagem = history.length === 0;
    if (primeiraMensagem) {
      const pn = primeiroNome(nomeCompleto);
      respostaIA = `Olá${pn ? ', ' + pn : ''}! Tudo bem? Aqui é a Sophia, da Stylus Formaturas 😊 Me conta, como posso te ajudar?`;
    }
    await registrarAlerta(sb, {
      tipo: 'ia_sem_resposta',
      gravidade: 'erro',
      titulo: primeiraMensagem ? 'A IA falhou: foi enviada a saudacao padrao' : 'A IA nao respondeu',
      detalhe: `Mensagem do formando: "${String(texto_resposta).slice(0, 200)}". ${primeiraMensagem ? 'Acompanhe a conversa.' : 'Responda manualmente.'} Erro: ${ultimoErroGemini || 'sem detalhe'}`,
      contato_nome: nomeCompleto,
      telefone,
    });
  }

  if (respostaIA) {
    let novoStatus = emConferencia ? 'confirmando_dados' : (statusVendaAtual === 'compra_futura' ? 'compra_futura' : 'em_conversa');
    // Quando definido, substitui o texto da IA por uma mensagem padronizada do sistema
    let respostaSistema: string | null = null;
    if (escolhaBloqueada) {
      respostaSistema = montarPerguntaEscolha(nomeCompleto, dadosContato);
    }

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
              // Nao perde o agendamento: registra, mas sinaliza para conferencia humana
              console.error('[Processor] ALERTA: data/horario nao encontrado nas mensagens do formando - agendamento registrado para conferencia. contact_id:', contactId, 'dados:', dados);
              await sb
                .from('contatos_campanha')
                .update({ revisao_humana: true })
                .eq('campanha_id', campanha.id)
                .eq('telefone', telefone);
              if (contactId) {
                await sb.from('contacts').update({ revisao_humana: true }).eq('id', contactId);
              }
              await registrarAlerta(sb, {
                tipo: 'agendamento_conferir',
                gravidade: 'atencao',
                titulo: 'Agendamento para conferir',
                detalhe: `A IA confirmou ${dados.data} (${dados.turno || dados.horario || 'sem turno'}), mas a data/turno nao aparece claramente nas mensagens do formando. Confira com ele.`,
                contato_nome: nomeCompleto,
                telefone,
              });
            }

            const ok = await inserirAgendamento(sb, {
              graduand_name: nomeCompleto,
              contract_number: dadosContato.numero_contrato || 'Nao Informado',
              course: dadosContato.curso || 'Outros',
              date: dados.data,
              shift: dados.turno || dados.horario || '',
              location: dados.local || dadosContato.local || 'RESIDENCIA',
              status: 'Em negociacao',
              contact_id: contactId,
              seller_name: 'INDEFINIDO',
              notes: dataValidada ? null : 'CONFERIR: a IA confirmou, mas a data/turno nao aparece claramente nas mensagens do formando.',
            }, { campaign_contact_id: dadosContato.id, campaign_id: campanha.id });
            if (ok) {
              console.log(`[Processor] Agendamento inserido para: ${nome}`);
              novoStatus = 'agendado';
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
    if (ehVendaMaterial && !emConferencia && !escolhaBloqueada && respostaIA.includes('###QUER_COMPRAR###')) {
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
      // A opcao que o formando citou na mensagem prevalece sobre a interpretacao da IA
      if (escolhaDetectada.plano) planoEscolhido = escolhaDetectada.plano;
      if (escolhaDetectada.forma && !formaPagamentoEscolhida) formaPagamentoEscolhida = escolhaDetectada.forma;

      // Escolha feita: em vez de a IA "improvisar" o fechamento, o sistema
      // confirma a opcao e ja pede a conferencia de CPF/e-mail. O vendedor so
      // e notificado quando os dados estiverem conferidos (pronto pro link).
      novoStatus = 'confirmando_dados';

      await sb
        .from('contatos_campanha')
        .update({
          plano_escolhido: planoEscolhido || null,
          forma_pagamento_escolhida: formaPagamentoEscolhida || null,
        })
        .eq('id', dadosContato.id);

      respostaSistema = montarMensagemConferencia(
        nomeCompleto,
        planoEscolhido,
        formaPagamentoEscolhida,
        dadosContato.cpf,
        dadosContato.email
      );

      console.log(`[Processor] ${nomeCompleto} escolheu a opcao (${planoEscolhido}) - iniciando conferencia de dados`);
    }

    // Formando prometeu comprar em outra data: programa o retorno automatico
    if (ehVendaMaterial && !emConferencia && !respostaSistema && respostaIA.includes('###COMPRA_FUTURA###') && dadosContato.id) {
      let dataPrometida = '';
      try {
        const m = respostaIA.match(/###COMPRA_FUTURA###([\s\S]*?)###FIM###/);
        if (m && m[1]) dataPrometida = String(JSON.parse(m[1].trim()).data || '');
      } catch (e) {
        console.error('[Processor] Falha ao parsear COMPRA_FUTURA:', e);
      }

      let r: any = null;
      // Ultima Oportunidade: a compra programada so vale ate o prazo da pre-venda (sem excecao)
      const prazoPreVenda = ehUltimaOportunidade ? lerDataBR(dadosContato.prazo_reciclagem) : null;
      const dataPedida = /^\d{4}-\d{2}-\d{2}$/.test(dataPrometida) ? new Date(`${dataPrometida}T00:00:00Z`) : null;
      const foraDoPrazoPreVenda = !!(prazoPreVenda && dataPedida && dataPedida.getTime() > prazoPreVenda.getTime());
      if (foraDoPrazoPreVenda) {
        r = { ok: false, motivo: 'fora_prazo_pre_venda' };
      } else try {
        const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/resgate-vendas`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            acao: 'agendar_retorno',
            contato_campanha_id: dadosContato.id,
            data: dataPrometida,
            origem: 'ia',
            trecho: texto_resposta,
          }),
        });
        r = await resp.json();
      } catch (e) {
        console.error('[Processor] Erro ao agendar retorno:', e);
      }

      const pn = primeiroNome(nomeCompleto);
      const fmt = (iso?: string | null) => {
        if (!iso) return '';
        const [a, m, d] = iso.split('-');
        return `${d}/${m}/${a}`;
      };

      if (foraDoPrazoPreVenda && prazoPreVenda) {
        respostaSistema = `Entendo${pn ? ', ' + pn : ''}! Só preciso te avisar com transparência: a ${nomeCondicao} vale até ${dataCurtaBR(prazoPreVenda)}. Depois dessa data eu não consigo mais garantir esse valor pra você.\n\nConsegue programar até ${dataCurtaBR(prazoPreVenda)}? Me diz o dia que fica melhor.`;
      } else if (ehUltimaOportunidade && r?.ok) {
        novoStatus = 'compra_futura';
        respostaSistema = `Combinado${pn ? ', ' + pn : ''}! Anotei aqui: no dia ${fmt(r.data)} eu te chamo por aqui para finalizarmos, com a sua ${nomeCondicao} garantida até lá. 📸`;
      } else if (ehUltimaOportunidade && r?.motivo === 'acima_do_limite') {
        respostaSistema = `Entendo${pn ? ', ' + pn : ''}! Só preciso te avisar com transparência: a ${nomeCondicao} tem prazo${dadosContato.prazo_reciclagem ? ` (até ${dadosContato.prazo_reciclagem})` : ''} e depois disso eu não consigo mais garantir esse valor.\n\nQual dia dentro desse prazo fica melhor pra você?`;
      } else if (r?.ok) {
        novoStatus = 'compra_futura';
        respostaSistema = r.excecao
          ? `Combinado${pn ? ', ' + pn : ''}! Como essa data passa do prazo de guarda do seu material, vou solicitar à nossa supervisão uma autorização especial para abrir uma exceção e manter suas fotos reservadas.\n\nNo dia ${fmt(r.data)} eu te chamo por aqui para finalizarmos, tudo bem? 📸`
          : `Combinado${pn ? ', ' + pn : ''}! Anotei aqui: no dia ${fmt(r.data)} eu te chamo por aqui para finalizarmos a aquisição das suas fotos.\n\nAté lá, seu material fica reservado. 📸`;
      } else if (r?.motivo === 'acima_do_limite') {
        respostaSistema = `Entendo${pn ? ', ' + pn : ''}! Só preciso te avisar com transparência: o seu material só pode ficar guardado até ${fmt(r.limite)}, mesmo com autorização especial. Depois disso ele vai para reciclagem e não tem como recuperar.\n\nConsegue programar a compra até ${fmt(r.limite)}? Me diz a data que fica melhor pra você.`;
      } else if (r?.motivo === 'data_passada' || r?.motivo === 'data_invalida') {
        respostaSistema = `Só pra eu anotar certinho${pn ? ', ' + pn : ''}: em qual dia e mês você pretende finalizar a compra?`;
      }
      console.log(`[Processor] COMPRA_FUTURA ${nomeCompleto}: ${dataPrometida} ->`, r?.ok ? 'agendado' : r?.motivo);
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

    const respostaLimpa = respostaSistema ?? respostaIA
      .replace(/###AGENDAMENTO_CONFIRMADO###[\s\S]*?###FIM###/g, '')
      .replace(/###QUER_COMPRAR###[\s\S]*?###FIM###/g, '')
      .replace(/###QUER_COMPRAR###/g, '')
      .replace(/###COMPRA_FUTURA###[\s\S]*?###FIM###/g, '')
      .replace(/###COMPRA_FUTURA###/g, '')
      .replace(/###ENVIAR_FOTO###/g, '')
      .replace(/###FIM###/g, '')
      .replace(/###OVERFLOW###/g, '')
      .replace(/###SEM_INTERESSE###/g, '')
      .trim();

    // FOTO DO FORMANDO: enviada ANTES do texto, para a resposta da IA nunca
    // prometer uma foto que nao chegou. Dispara quando a IA marcou, quando o
    // formando pediu para ver ou quando a IA escreveu que ia mandar.
    const statusQueBloqueiamFoto = ['sem_interesse', 'transferido_humano', 'confirmando_dados'];
    const querFoto = respostaIA.includes('###ENVIAR_FOTO###') || formandoPediuFoto || prometeuFoto(respostaLimpa);
    let fotoEnviada = false;
    if (podeEnviarFoto && querFoto && !statusQueBloqueiamFoto.includes(novoStatus) && dadosContato.id) {
      try {
        const rf = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fotos-formando`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ acao: 'enviar', contato_campanha_id: dadosContato.id, origem: 'ia', forcar: fotoExtra }),
        });
        const jf = await rf.json().catch(() => ({}));
        fotoEnviada = !!jf?.success;
        console.log(`[Processor] Foto do formando ${nomeCompleto}:`, fotoEnviada ? 'enviada' : jf?.motivo);
      } catch (e) {
        console.error('[Processor] Erro ao enviar foto do formando:', e);
      }
    }
    // Sem foto enviada, tira do texto qualquer promessa de foto
    const textoFinal = !fotoEnviada && !fotosUltimaOportunidadeEnviadas && prometeuFoto(respostaLimpa) ? removerPromessaDeFoto(respostaLimpa) : respostaLimpa;

    const sucesso = textoFinal ? await enviarMensagemUazapi(telefone, textoFinal) : false;
    await logarEnvio(sb, campanha.id, telefone, sucesso);

    if (sucesso) {
      if (contactId) {
        await sb.from('messages').insert({
          contact_id: contactId,
          direction: 'out',
          content: textoFinal,
          sent_by: 'ia',
          seq: 0,
        });
      }

      await sb
        .from('contatos_campanha')
        .update({ status: novoStatus })
        .eq('campanha_id', campanha.id)
        .eq('telefone', telefone);

      // Formando decidiu (comprar agora, desistir ou ir para humano): cancela retorno programado
      if (ehVendaMaterial && dadosContato.id && ['confirmando_dados', 'sem_interesse', 'transferido_humano'].includes(novoStatus)) {
        await sb
          .from('retornos_agendados')
          .update({ status: 'cancelado', motivo: `status_${novoStatus}` })
          .eq('contato_campanha_id', dadosContato.id)
          .eq('status', 'agendado');
      }

      if (ehVendaMaterial && STATUS_VENDA_ENCERRADA.includes(novoStatus)) {
        // Venda encerrada pela IA (sem interesse / transferido): fecha a conversa
        await sb
          .from('conversa_estado')
          .update({ aguardando_resposta: false, status: 'concluido', updated_at: new Date().toISOString() })
          .eq('id', conversa.id);
      } else {
        await sb
          .from('conversa_estado')
          .update({
            aguardando_resposta: false,
            bloco_atual: conversa.bloco_atual + 1,
            status: 'ativo',
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversa.id);

        await processarProximoBloco(sb, conversa.id);
      }
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
