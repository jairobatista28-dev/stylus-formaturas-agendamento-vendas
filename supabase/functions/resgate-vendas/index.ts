import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * RESGATE AUTOMATICO - VENDA DE MATERIAL FOTOGRAFICO
 *
 * Acoes:
 *  - executar (cron a cada 10 min): planeja os envios do dia (no maximo
 *    `limite_diario`, em horarios aleatorios e espacados dentro da janela) e
 *    envia os que ja chegaram na hora. Antes de cada envio confere de novo se o
 *    formando continua elegivel (nao comprou, nao respondeu, nao foi assumido).
 *  - simular (tela de Vendas Pendentes): lista candidatos e previa das mensagens,
 *    sem enviar nada.
 *
 * RETORNO PROGRAMADO (formando que prometeu comprar em outra data):
 *  - agendar_retorno: registra a data (chamado pela IA de vendas ou pelo painel),
 *    validando o limite (prazo de reciclagem + dias de prorrogacao) e marcando
 *    excecao quando a data passa do prazo de guarda.
 *  - detectar_promessas: a IA le as conversas recentes e sugere datas prometidas
 *    (inclusive de conversas em atendimento manual) para voce confirmar.
 *  - executar: alem do resgate, envia os retornos do dia.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const MAX_ENVIOS_POR_EXECUCAO = 1;     // cron roda a cada 10 min -> no maximo 1 envio por rodada
const INTERVALO_MINIMO_MIN = 25;       // distancia minima entre dois resgates no mesmo dia
const ANTECEDENCIA_MINIMA_MIN = 5;     // primeiro horario planejado fica pelo menos 5 min a frente
const DIAS_MINIMOS_RESTANTES = 2;      // nao aborda se o prazo prorrogado acabar em menos de 2 dias

interface Config {
  ativo: boolean;
  limite_diario: number;
  janela_dias: number;
  silencio_minimo_dias: number;
  dias_prorrogacao: number;
  base_prorrogacao: 'prazo_planilha' | 'data_resgate';
  hora_inicio: number;
  hora_fim: number;
  dias_semana: number[];
  fuso: string;
  retornos_ativos?: boolean;
}

interface Candidato {
  contato_campanha_id: string;
  campanha_id: string;
  nome: string;
  telefone: string;
  status: string;
  numero_contrato: string | null;
  quantidade_fotos: string | null;
  prazo_reciclagem: string | null;
  ultima_interacao: string | null;
}

// ============================================================================
// DATAS E FUSO
// ============================================================================

/** Partes da data/hora atual (ou de `d`) no fuso informado */
function partesNoFuso(fuso: string, d: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour) % 24, minuto: Number(p.minute),
    diaSemana: dias[p.weekday] ?? 0,
    dataISO: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Diferenca (min) entre o horario local do fuso e UTC */
function offsetMinutos(fuso: string, d: Date = new Date()): number {
  const p = partesNoFuso(fuso, d);
  const comoUTC = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  return Math.round((comoUTC - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** Converte "hoje as HH:MM no fuso" para Date (UTC) */
function horarioLocalParaUTC(fuso: string, hora: number, minuto: number): Date {
  const p = partesNoFuso(fuso);
  const off = offsetMinutos(fuso);
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia, hora, minuto) - off * 60000);
}

/** Converte "data YYYY-MM-DD as HH:MM no fuso" para Date (UTC) */
function dataHoraLocalParaUTC(fuso: string, dataYMD: string, hora: number, minuto: number): Date {
  const [a, m, d] = dataYMD.split('-').map(Number);
  const off = offsetMinutos(fuso);
  return new Date(Date.UTC(a, m - 1, d, hora, minuto) - off * 60000);
}

function hojeUTC(fuso: string): Date {
  const p = partesNoFuso(fuso);
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia));
}

/**
 * Interpreta o prazo da planilha. Aceita 30/09/2026, 2026-09-30, 30-09-2026 e o
 * formato antigo das primeiras importacoes (9/30/26, mes/dia/ano com 2 digitos).
 */
function parsePrazo(texto?: string | null): Date | null {
  const t = String(texto || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  let a = +m[1], b = +m[2];
  let ano = +m[3];
  let dia: number, mes: number;
  if (m[3].length === 2) {
    ano += 2000;
    // formato antigo do Excel: m/d/aa (a menos que o primeiro numero nao possa ser mes)
    if (a > 12) { dia = a; mes = b; } else { mes = a; dia = b; }
  } else {
    if (b > 12) { mes = a; dia = b; } else { dia = a; mes = b; }
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function adicionarDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * 86400000);
}

function dataISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dataBR(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Novo prazo prorrogado para o candidato (ou null se nao for possivel abordar) */
function calcularPrazoProrrogado(c: Candidato, cfg: Config): { prazo: Date | null; motivo?: string } {
  const p = partesNoFuso(cfg.fuso);
  const hoje = new Date(Date.UTC(p.ano, p.mes - 1, p.dia));

  let prazo: Date;
  if (cfg.base_prorrogacao === 'data_resgate') {
    prazo = adicionarDias(hoje, cfg.dias_prorrogacao);
  } else {
    const original = parsePrazo(c.prazo_reciclagem);
    if (!original) return { prazo: null, motivo: 'prazo_da_planilha_invalido' };
    prazo = adicionarDias(original, cfg.dias_prorrogacao);
  }

  const diasRestantes = Math.round((prazo.getTime() - hoje.getTime()) / 86400000);
  if (diasRestantes < DIAS_MINIMOS_RESTANTES) return { prazo: null, motivo: 'prazo_prorrogado_ja_vencido' };
  return { prazo };
}

// ============================================================================
// MENSAGENS (6 abordagens diferentes)
// ============================================================================

function primeiroNome(nome?: string | null): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

function saudacao(fuso: string): string {
  const h = partesNoFuso(fuso).hora;
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function textoFotos(qtd?: string | null): string {
  const q = String(qtd || '').trim();
  if (/^\d+$/.test(q)) return `as suas ${Number(q).toLocaleString('pt-BR')} fotos`;
  return 'as suas fotos';
}

function textoPrazo(prazo: Date, fuso: string): string {
  const p = partesNoFuso(fuso);
  const hoje = Date.UTC(p.ano, p.mes - 1, p.dia);
  const dias = Math.round((prazo.getTime() - hoje) / 86400000);
  return dias <= 10 ? `${dataBR(prazo)} (faltam só ${dias} dias)` : dataBR(prazo);
}

const TOTAL_VARIANTES = 6;

function montarMensagemResgate(variante: number, c: Candidato, prazo: Date, fuso: string): string {
  const pn = primeiroNome(c.nome);
  const nome = pn ? `, ${pn}` : '';
  const sd = saudacao(fuso);
  const fotos = textoFotos(c.quantidade_fotos);
  const fotosCap = fotos.charAt(0).toUpperCase() + fotos.slice(1);
  const prazoTxt = textoPrazo(prazo, fuso);
  const contrato = c.numero_contrato ? ` (contrato ${c.numero_contrato})` : '';

  switch (variante % TOTAL_VARIANTES) {
    case 0:
      return `${sd}${nome}! Tudo bem? Aqui é a Sophia, do setor de fotografia da Stylus Formaturas.\n\n` +
        `Tenho uma boa notícia: conseguimos uma prorrogação para o seu material fotográfico, que estava indo para reciclagem. ${fotosCap} ficam disponíveis até ${prazoTxt}.\n\n` +
        `Ainda tem interesse em garantir? Posso te passar as condições de novo.`;
    case 1:
      return `${sd}${nome}! Lembrei de você por aqui. Há pouco tempo você chegou a ver as condições das fotos da sua formatura${contrato}.\n\n` +
        `O prazo tinha encerrado, mas a empresa liberou uma prorrogação excepcional até ${prazoTxt}. Depois disso o material é reciclado definitivamente.\n\n` +
        `Quer que eu deixe reservado pra você?`;
    case 2:
      return `Oi${nome}! ${sd}. Passando para te avisar pessoalmente: ${fotos} da formatura ainda estão guardadas com a gente, mas só até ${prazoTxt}.\n\n` +
        `Essa prorrogação foi concedida apenas para quem demonstrou interesse e não chegou a finalizar. Se fizer sentido pra você, te ajudo a concluir em poucos minutos.`;
    case 3:
      return `${sd}${nome}! Aqui é a Sophia, da Stylus Formaturas 📸\n\n` +
        `${fotosCap} da formatura ganharam uma prorrogação e ficam disponíveis até ${prazoTxt}. É a última janela antes da reciclagem.\n\n` +
        `Posso te mandar as opções de pagamento?`;
    case 4:
      return `${sd}${nome}, tudo bem? Sei que nem sempre é o melhor momento, por isso quis te avisar com antecedência: o prazo do seu material fotográfico foi prorrogado até ${prazoTxt}.\n\n` +
        `As condições especiais continuam valendo. Quer que eu te explique de novo as opções?`;
    default:
      return `${sd}${nome}! Retomando nossa conversa sobre as fotos da sua formatura: conseguimos estender o prazo do seu material até ${prazoTxt}.\n\n` +
        `Ficou alguma dúvida da última vez que eu possa esclarecer? Estou por aqui.`;
  }
}

// ============================================================================
// ENVIO (Uazapi)
// ============================================================================

async function enviarTexto(telefone: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const url = Deno.env.get('UAZAPI_BASE_URL')?.trim();
  const token = Deno.env.get('UAZAPI_TOKEN')?.trim();
  const instancia = Deno.env.get('UAZAPI_INSTANCE');
  if (!url || !token) return { ok: false, erro: 'uazapi_nao_configurada' };

  try {
    // Indicador "digitando..." proporcional ao tamanho do texto (como uma pessoa)
    await fetch(`${url}/chat/typing/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: telefone, time: Math.min(6000, texto.length * 35) }),
    }).catch(() => null);
    await new Promise((r) => setTimeout(r, Math.min(6000, 1500 + texto.length * 15)));

    const res = await fetch(`${url}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: telefone, text: texto }),
    });
    if (!res.ok) return { ok: false, erro: `uazapi_${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'erro_rede' };
  }
}

// ============================================================================
// PLANEJAMENTO E ENVIO
// ============================================================================

/** Horarios aleatorios, ordenados e espacados, entre `inicio` e `fim` */
function sortearHorarios(qtd: number, inicio: Date, fim: Date): Date[] {
  const janelaMin = Math.floor((fim.getTime() - inicio.getTime()) / 60000);
  if (qtd <= 0 || janelaMin <= 0) return [];
  const gap = Math.min(INTERVALO_MINIMO_MIN, Math.floor(janelaMin / qtd));
  const folga = Math.max(0, janelaMin - gap * (qtd - 1));
  const pontos = Array.from({ length: qtd }, () => Math.random() * folga).sort((a, b) => a - b);
  return pontos.map((p, i) => new Date(inicio.getTime() + (p + i * gap) * 60000));
}

async function carregarConfig(sb: any): Promise<Config | null> {
  const { data } = await sb.from('resgate_config').select('*').eq('id', 1).maybeSingle();
  return data as Config | null;
}

async function buscarCandidatos(sb: any, cfg: Config): Promise<Candidato[]> {
  const { data, error } = await sb.rpc('listar_candidatos_resgate', {
    p_janela_dias: cfg.janela_dias,
    p_silencio_dias: cfg.silencio_minimo_dias,
  });
  if (error) {
    console.error('[Resgate] Erro ao listar candidatos:', error);
    return [];
  }
  return (data || []) as Candidato[];
}

async function planejarDia(sb: any, cfg: Config): Promise<number> {
  const agora = new Date();
  const p = partesNoFuso(cfg.fuso);
  if (!cfg.dias_semana.includes(p.diaSemana)) return 0;

  const fimJanela = horarioLocalParaUTC(cfg.fuso, cfg.hora_fim, 0);
  const inicioJanela = new Date(Math.max(
    horarioLocalParaUTC(cfg.fuso, cfg.hora_inicio, 0).getTime(),
    agora.getTime() + ANTECEDENCIA_MINIMA_MIN * 60000,
  ));
  if (fimJanela.getTime() - inicioJanela.getTime() < 30 * 60000) return 0;

  const { data: jaHoje } = await sb
    .from('resgate_envios')
    .select('id, agendado_para, status')
    .eq('data_ref', p.dataISO)
    .in('status', ['agendado', 'enviado']);
  const vagas = cfg.limite_diario - (jaHoje?.length || 0);
  if (vagas <= 0) return 0;

  const candidatos = await buscarCandidatos(sb, cfg);
  const selecionados: Array<{ c: Candidato; prazo: Date }> = [];
  for (const c of candidatos) {
    const { prazo } = calcularPrazoProrrogado(c, cfg);
    if (prazo) selecionados.push({ c, prazo });
  }
  // Prioriza quem tem o prazo acabando antes (pra ninguem perder a janela)
  selecionados.sort((a, b) => a.prazo.getTime() - b.prazo.getTime());
  const lote = selecionados.slice(0, vagas);
  if (lote.length === 0) return 0;

  // Nao agenda colado em horarios ja usados hoje
  const ultimoUsado = (jaHoje || [])
    .map((r: any) => new Date(r.agendado_para).getTime())
    .reduce((m: number, t: number) => Math.max(m, t), 0);
  const inicio = new Date(Math.max(inicioJanela.getTime(), ultimoUsado + INTERVALO_MINIMO_MIN * 60000));
  const horarios = sortearHorarios(lote.length, inicio, fimJanela);
  if (horarios.length === 0) return 0;

  // Abordagens diferentes: rodizio a partir de um ponto aleatorio do dia
  const offsetVariante = Math.floor(Math.random() * TOTAL_VARIANTES) + (jaHoje?.length || 0);

  let criados = 0;
  for (let i = 0; i < horarios.length; i++) {
    const { c, prazo } = lote[i];
    const { error } = await sb.from('resgate_envios').insert({
      contato_campanha_id: c.contato_campanha_id,
      campanha_id: c.campanha_id,
      nome: c.nome,
      telefone: c.telefone,
      data_ref: p.dataISO,
      agendado_para: horarios[i].toISOString(),
      variante: (offsetVariante + i) % TOTAL_VARIANTES,
      prazo_prorrogado: dataISO(prazo),
      status: 'agendado',
    });
    if (!error) criados++;
    else console.warn('[Resgate] Nao agendou', c.nome, error.message);
  }
  console.log(`[Resgate] ${criados} abordagens agendadas para ${p.dataISO}`);
  return criados;
}

/** Confere, na hora do envio, se o formando ainda deve ser abordado */
async function motivoParaCancelar(sb: any, envio: any, cfg: Config): Promise<string | null> {
  const { data: cc } = await sb
    .from('contatos_campanha')
    .select('id, status, resgate_enviado_em')
    .eq('id', envio.contato_campanha_id)
    .maybeSingle();
  if (!cc) return 'contato_removido';
  if (cc.resgate_enviado_em) return 'ja_resgatado';
  if (!['em_conversa', 'confirmando_dados'].includes(cc.status)) return `status_${cc.status}`;

  const { data: comprou } = await sb
    .from('contatos_campanha')
    .select('id')
    .eq('telefone', envio.telefone)
    .eq('status', 'comprou')
    .limit(1);
  if (comprou && comprou.length > 0) return 'vendido';

  const { data: contato } = await sb
    .from('contacts')
    .select('id, assigned_to')
    .eq('phone', envio.telefone)
    .maybeSingle();
  if (contato?.assigned_to === 'manual') return 'atendimento_manual';

  if (contato?.id) {
    const limite = new Date(Date.now() - cfg.silencio_minimo_dias * 86400000).toISOString();
    const { data: recentes } = await sb
      .from('messages')
      .select('id')
      .eq('contact_id', contato.id)
      .eq('direction', 'in')
      .gte('created_at', limite)
      .limit(1);
    if (recentes && recentes.length > 0) return 'conversa_recente';
  }
  return null;
}

async function enviarPendentes(sb: any, cfg: Config): Promise<number> {
  const p = partesNoFuso(cfg.fuso);
  const dentroDoHorario = p.hora >= cfg.hora_inicio && p.hora < cfg.hora_fim;

  const { data: vencidos } = await sb
    .from('resgate_envios')
    .select('*')
    .eq('status', 'agendado')
    .lte('agendado_para', new Date().toISOString())
    .order('agendado_para', { ascending: true })
    .limit(10);

  let enviados = 0;
  for (const envio of vencidos || []) {
    // Agendamentos de dias anteriores que ficaram para tras: cancela (replaneja depois)
    if (envio.data_ref !== p.dataISO || !dentroDoHorario) {
      await sb.from('resgate_envios').update({ status: 'cancelado', motivo: 'fora_do_horario' }).eq('id', envio.id);
      continue;
    }
    if (enviados >= MAX_ENVIOS_POR_EXECUCAO) break;

    const motivo = await motivoParaCancelar(sb, envio, cfg);
    if (motivo) {
      await sb.from('resgate_envios').update({ status: 'cancelado', motivo }).eq('id', envio.id);
      console.log(`[Resgate] ${envio.nome}: cancelado (${motivo})`);
      continue;
    }

    const { data: cc } = await sb
      .from('contatos_campanha')
      .select('id, campanha_id, nome, telefone, status, numero_contrato, quantidade_fotos, prazo_reciclagem')
      .eq('id', envio.contato_campanha_id)
      .single();
    const prazo = new Date(`${envio.prazo_prorrogado}T00:00:00Z`);
    const texto = montarMensagemResgate(envio.variante ?? 0, cc as Candidato, prazo, cfg.fuso);

    const r = await enviarTexto(envio.telefone, texto);
    await sb.from('envio_log').insert({ campanha_id: envio.campanha_id, contato_telefone: envio.telefone, sucesso: r.ok });

    if (!r.ok) {
      await sb.from('resgate_envios').update({ status: 'erro', motivo: r.erro, mensagem: texto }).eq('id', envio.id);
      console.error(`[Resgate] Falha ao enviar para ${envio.nome}:`, r.erro);
      continue;
    }

    const agoraISO = new Date().toISOString();
    await sb.from('resgate_envios').update({ status: 'enviado', enviado_em: agoraISO, mensagem: texto }).eq('id', envio.id);
    await sb.from('contatos_campanha').update({
      prazo_prorrogado: envio.prazo_prorrogado,
      resgate_enviado_em: agoraISO,
      resgate_variante: envio.variante,
    }).eq('id', envio.contato_campanha_id);

    // Registra no chat (aparece no painel e entra no historico da IA)
    let { data: contato } = await sb.from('contacts').select('id').eq('phone', envio.telefone).maybeSingle();
    if (!contato) {
      const { data: novo } = await sb
        .from('contacts')
        .insert({ phone: envio.telefone, name: envio.nome || envio.telefone, status: 'lead', assigned_to: 'ia' })
        .select('id')
        .single();
      contato = novo;
    }
    if (contato?.id) {
      await sb.from('messages').insert({ contact_id: contato.id, direction: 'out', content: texto, sent_by: 'ia', seq: 0 });
    }

    // Garante que a resposta do formando volte para a IA de vendas
    await sb.from('conversa_estado').upsert({
      campanha_id: envio.campanha_id,
      contato_telefone: envio.telefone,
      contato_nome: envio.nome,
      bloco_atual: 9999,
      aguardando_resposta: true,
      status: 'aguardando_lead',
      updated_at: agoraISO,
    }, { onConflict: 'campanha_id,contato_telefone' });

    enviados++;
    console.log(`[Resgate] Enviado para ${envio.nome} (variante ${envio.variante})`);
  }
  return enviados;
}

// ============================================================================
// RETORNO PROGRAMADO
// ============================================================================

const NUMERO_VENDEDOR = '5592993809136';

/**
 * Prazo vigente e limite maximo para a compra de um contato:
 *  - prazoVigente: ate quando o material esta garantido hoje (prorrogado, se houver)
 *  - limite: prazo original + dias de prorrogacao (ou o prorrogado, se for maior)
 */
function calcularLimites(prazoReciclagem: string | null, prazoProrrogado: string | null, cfg: Config) {
  const original = parsePrazo(prazoReciclagem);
  const prorrogado = prazoProrrogado ? new Date(`${prazoProrrogado}T00:00:00Z`) : null;
  const prazoVigente = prorrogado || original;
  let limite: Date;
  if (original) {
    limite = adicionarDias(original, cfg.dias_prorrogacao);
    if (prorrogado && prorrogado > limite) limite = prorrogado;
  } else {
    limite = prorrogado || adicionarDias(hojeUTC(cfg.fuso), cfg.dias_prorrogacao);
  }
  return { prazoVigente, limite };
}

function horarioDoRetorno(dataYMD: string, cfg: Config): Date {
  // Sorteia um horario dentro da janela (1h depois do inicio ate 2h antes do fim)
  const ini = (cfg.hora_inicio + 1) * 60;
  const fim = Math.max(ini + 30, (cfg.hora_fim - 2) * 60);
  const minutos = ini + Math.floor(Math.random() * (fim - ini));
  let quando = dataHoraLocalParaUTC(cfg.fuso, dataYMD, Math.floor(minutos / 60), minutos % 60);
  // Retorno para hoje com horario que ja passou: daqui a 15-45 min
  if (quando.getTime() < Date.now()) quando = new Date(Date.now() + (15 + Math.random() * 30) * 60000);
  return quando;
}

interface ResultadoAgendamento {
  ok: boolean;
  motivo?: 'data_invalida' | 'data_passada' | 'acima_do_limite' | 'contato_nao_encontrado' | 'vendido' | 'erro';
  data?: string;
  limite?: string;
  prazo_vigente?: string | null;
  excecao?: boolean;
  retorno_id?: string;
}

async function agendarRetorno(
  sb: any,
  cfg: Config,
  args: { contato_campanha_id: string; data: string; origem?: 'ia' | 'manual' | 'ia_detectada'; trecho?: string | null }
): Promise<ResultadoAgendamento> {
  const origem = args.origem || 'manual';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.data || ''))) return { ok: false, motivo: 'data_invalida' };

  const { data: cc } = await sb
    .from('contatos_campanha')
    .select('id, campanha_id, nome, telefone, status, numero_contrato, prazo_reciclagem, prazo_prorrogado')
    .eq('id', args.contato_campanha_id)
    .maybeSingle();
  if (!cc) return { ok: false, motivo: 'contato_nao_encontrado' };
  if (cc.status === 'comprou') return { ok: false, motivo: 'vendido' };

  const data = new Date(`${args.data}T00:00:00Z`);
  const hoje = hojeUTC(cfg.fuso);
  const { prazoVigente, limite } = calcularLimites(cc.prazo_reciclagem, cc.prazo_prorrogado, cfg);
  const base = { data: args.data, limite: dataISO(limite), prazo_vigente: prazoVigente ? dataISO(prazoVigente) : null };

  if (data < hoje) return { ok: false, motivo: 'data_passada', ...base };
  if (data > limite) return { ok: false, motivo: 'acima_do_limite', ...base };

  const excecao = !prazoVigente || data > prazoVigente;
  const excecaoStatus = !excecao ? 'nao_aplica' : origem === 'manual' ? 'aprovada' : 'solicitada';

  // Um retorno ativo por contato: substitui o anterior
  await sb
    .from('retornos_agendados')
    .update({ status: 'cancelado', motivo: 'substituido_por_nova_data' })
    .eq('contato_campanha_id', cc.id)
    .eq('status', 'agendado');

  const { data: novo, error } = await sb
    .from('retornos_agendados')
    .insert({
      contato_campanha_id: cc.id,
      campanha_id: cc.campanha_id,
      nome: cc.nome,
      telefone: cc.telefone,
      data_retorno: args.data,
      agendado_para: horarioDoRetorno(args.data, cfg).toISOString(),
      prazo_limite: dataISO(limite),
      excecao,
      excecao_status: excecaoStatus,
      origem,
      trecho: args.trecho || null,
      status: 'agendado',
    })
    .select('id')
    .single();
  if (error) {
    console.error('[Retorno] Erro ao agendar:', error);
    return { ok: false, motivo: 'erro', ...base };
  }

  const atualiza: Record<string, unknown> = { status: 'compra_futura' };
  // Com excecao, o material fica guardado ate o limite (a IA passa a usar essa data)
  if (excecao) atualiza.prazo_prorrogado = dataISO(limite);
  await sb.from('contatos_campanha').update(atualiza).eq('id', cc.id);

  if (excecao && origem !== 'manual') {
    const aviso =
      `⚠️ *Pedido de excecao de prazo*\n\n` +
      `👤 *Nome:* ${cc.nome}\n` +
      `📄 *Contrato:* ${cc.numero_contrato || 'Nao informado'}\n` +
      `📅 *Quer comprar em:* ${dataBR(data)}/${data.getUTCFullYear()}\n` +
      `⏳ *Prazo de guarda atual:* ${prazoVigente ? dataBR(prazoVigente) + '/' + prazoVigente.getUTCFullYear() : 'nao informado'}\n` +
      `🛑 *Limite maximo:* ${dataBR(limite)}/${limite.getUTCFullYear()}\n\n` +
      `A IA informou que vai pedir autorizacao da supervisao. Sem recusa, a excecao vale como aprovada ` +
      `e a IA chama o formando na data. Para recusar: Vendas Pendentes > Retornos programados.`;
    await enviarTexto(NUMERO_VENDEDOR, aviso);
  }

  console.log(`[Retorno] ${cc.nome}: retorno em ${args.data} (origem ${origem}${excecao ? ', excecao' : ''})`);
  return { ok: true, ...base, excecao, retorno_id: novo?.id };
}

function montarMensagemRetorno(variante: number, r: any, cc: any, fuso: string): string {
  const pn = primeiroNome(cc.nome);
  const nome = pn ? `, ${pn}` : '';
  const sd = saudacao(fuso);
  const fotos = textoFotos(cc.quantidade_fotos);
  const limite = r.prazo_limite ? new Date(`${r.prazo_limite}T00:00:00Z`) : null;
  const linhaExcecao = r.excecao && limite
    ? `\n\nBoa notícia: a supervisão autorizou a exceção e o seu material está reservado até ${dataBR(limite)}.`
    : '';
  if (variante % 2 === 0) {
    return `${sd}${nome}! Tudo bem? Como combinamos, estou passando hoje para retomarmos a aquisição das ${fotos.replace('as suas ', 'suas ')} da formatura.${linhaExcecao}\n\nPosso te passar as opções de pagamento?`;
  }
  return `${sd}${nome}! Aqui é a Sophia, da Stylus Formaturas. Hoje é o dia que você tinha combinado comigo para garantir ${fotos} da formatura 📸${linhaExcecao}\n\nQuer que eu te mande as condições para finalizarmos?`;
}

async function enviarRetornos(sb: any, cfg: Config): Promise<number> {
  const { data: vencidos } = await sb
    .from('retornos_agendados')
    .select('*')
    .eq('status', 'agendado')
    .lte('agendado_para', new Date().toISOString())
    .order('agendado_para', { ascending: true })
    .limit(3);

  let enviados = 0;
  for (const r of vencidos || []) {
    if (r.excecao && r.excecao_status === 'recusada') {
      await sb.from('retornos_agendados').update({ status: 'cancelado', motivo: 'excecao_recusada' }).eq('id', r.id);
      continue;
    }
    const { data: cc } = await sb
      .from('contatos_campanha')
      .select('id, campanha_id, nome, telefone, status, quantidade_fotos')
      .eq('id', r.contato_campanha_id)
      .maybeSingle();
    if (!cc) {
      await sb.from('retornos_agendados').update({ status: 'cancelado', motivo: 'contato_removido' }).eq('id', r.id);
      continue;
    }
    const { data: comprou } = await sb.from('contatos_campanha').select('id').eq('telefone', r.telefone).eq('status', 'comprou').limit(1);
    if (cc.status === 'comprou' || (comprou && comprou.length > 0)) {
      await sb.from('retornos_agendados').update({ status: 'cancelado', motivo: 'vendido' }).eq('id', r.id);
      continue;
    }
    if (['sem_interesse', 'interessado_compra', 'confirmando_dados'].includes(cc.status)) {
      await sb.from('retornos_agendados').update({ status: 'cancelado', motivo: `status_${cc.status}` }).eq('id', r.id);
      continue;
    }

    const texto = montarMensagemRetorno(Math.floor(Math.random() * 2), r, cc, cfg.fuso);
    const res = await enviarTexto(r.telefone, texto);
    await sb.from('envio_log').insert({ campanha_id: r.campanha_id, contato_telefone: r.telefone, sucesso: res.ok });
    if (!res.ok) {
      await sb.from('retornos_agendados').update({ status: 'erro', motivo: res.erro, mensagem: texto }).eq('id', r.id);
      continue;
    }

    const agoraISO = new Date().toISOString();
    await sb.from('retornos_agendados').update({
      status: 'enviado',
      enviado_em: agoraISO,
      mensagem: texto,
      ...(r.excecao && r.excecao_status === 'solicitada' ? { excecao_status: 'aprovada' } : {}),
    }).eq('id', r.id);
    await sb.from('contatos_campanha').update({
      status: 'em_conversa',
      resgate_enviado_em: agoraISO, // evita que o mesmo formando receba tambem o resgate
    }).eq('id', cc.id);

    // Registra no chat e devolve a conversa para a IA de vendas
    let { data: contato } = await sb.from('contacts').select('id').eq('phone', r.telefone).maybeSingle();
    if (!contato) {
      const { data: novo } = await sb
        .from('contacts')
        .insert({ phone: r.telefone, name: r.nome || r.telefone, status: 'lead', assigned_to: 'ia' })
        .select('id')
        .single();
      contato = novo;
    }
    if (contato?.id) {
      await sb.from('messages').insert({ contact_id: contato.id, direction: 'out', content: texto, sent_by: 'ia', seq: 0 });
      await sb.from('contacts').update({ assigned_to: 'ia' }).eq('id', contato.id);
    }
    await sb.from('conversa_estado').upsert({
      campanha_id: r.campanha_id,
      contato_telefone: r.telefone,
      contato_nome: r.nome,
      bloco_atual: 9999,
      aguardando_resposta: true,
      status: 'aguardando_lead',
      updated_at: agoraISO,
    }, { onConflict: 'campanha_id,contato_telefone' });

    enviados++;
    console.log(`[Retorno] Enviado para ${r.nome}`);
  }
  return enviados;
}

/** Pede ao Gemini para identificar, na conversa, uma promessa de compra em data futura */
async function analisarConversa(textoConversa: string, hojeBR: string, ano: number): Promise<{ promessa: boolean; data: string | null; trecho: string | null }> {
  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave) return { promessa: false, data: null, trecho: null };
  const prompt =
    `Hoje e ${hojeBR} (ano ${ano}). Abaixo esta uma conversa de WhatsApp entre a empresa (EMPRESA) e um formando (FORMANDO) ` +
    `sobre a compra das fotos da formatura.\n\n` +
    `Identifique se o FORMANDO disse que vai comprar/pagar/adquirir em uma data futura especifica (ex: "dia 05", "dia 10/11", ` +
    `"quando receber dia 5", "mes que vem dia 15", "sexta"). Converta para YYYY-MM-DD considerando a data de hoje: se o ` +
    `formando disse so o dia, use a proxima ocorrencia desse dia; se disse dia/mes que ja passou neste ano e a conversa e ` +
    `recente, provavelmente quis dizer o proximo mes - nesse caso use o proximo mes. Se ele nao indicou data, promessa=false.\n\n` +
    `Responda SOMENTE com JSON: {"promessa": true|false, "data": "YYYY-MM-DD" ou null, "trecho": "frase exata do formando" ou null}\n\n` +
    `CONVERSA:\n${textoConversa}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${chave}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      }
    );
    if (!res.ok) return { promessa: false, data: null, trecho: null };
    const j = await res.json();
    const texto = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const out = JSON.parse(texto.replace(/```json|```/g, '').trim());
    const dataOk = typeof out.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out.data);
    return { promessa: !!out.promessa && dataOk, data: dataOk ? out.data : null, trecho: out.trecho || null };
  } catch (e) {
    console.warn('[Retorno] Falha ao analisar conversa:', e);
    return { promessa: false, data: null, trecho: null };
  }
}

async function detectarPromessas(sb: any, cfg: Config) {
  // Contatos de venda que nao compraram e nao tem retorno ativo, com conversa nos ultimos 45 dias
  const { data: contatos } = await sb
    .from('contatos_campanha')
    .select('id, nome, telefone, status, numero_contrato, prazo_reciclagem, prazo_prorrogado, campanhas!inner(tipo_atendimento)')
    .eq('campanhas.tipo_atendimento', 'venda_material')
    .in('status', ['em_conversa', 'interessado_compra', 'confirmando_dados', 'transferido_humano', 'saudacao_enviada', 'sem_retorno']);

  const { data: ativos } = await sb.from('retornos_agendados').select('contato_campanha_id').eq('status', 'agendado');
  const comRetorno = new Set((ativos || []).map((a: any) => a.contato_campanha_id));
  const { data: vendidos } = await sb.from('contatos_campanha').select('telefone').eq('status', 'comprou');
  const telVendidos = new Set((vendidos || []).map((v: any) => v.telefone));

  const lista = (contatos || []).filter((c: any) => !comRetorno.has(c.id) && !telVendidos.has(c.telefone));
  const limite45 = new Date(Date.now() - 45 * 86400000).toISOString();
  const p = partesNoFuso(cfg.fuso);
  const hojeBR = `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;

  // Monta as conversas (so de quem escreveu algo recentemente)
  const fila: Array<{ c: any; conversa: string }> = [];
  for (const c of lista) {
    if (fila.length >= 40) break;
    const { data: contato } = await sb.from('contacts').select('id').eq('phone', c.telefone).maybeSingle();
    if (!contato) continue;
    const { data: msgs } = await sb
      .from('messages')
      .select('direction, content, created_at')
      .eq('contact_id', contato.id)
      .gte('created_at', limite45)
      .order('created_at', { ascending: false })
      .limit(25);
    if (!msgs || !msgs.some((m: any) => m.direction === 'in')) continue;
    const conversa = msgs.slice().reverse()
      .map((m: any) => `[${new Date(m.created_at).toLocaleDateString('pt-BR', { timeZone: cfg.fuso })}] ${m.direction === 'in' ? 'FORMANDO' : 'EMPRESA'}: ${String(m.content || '').slice(0, 400)}`)
      .join('\n');
    fila.push({ c, conversa });
  }

  const sugestoes: any[] = [];
  for (let i = 0; i < fila.length; i += 5) {
    const lote = fila.slice(i, i + 5);
    const resultados = await Promise.all(lote.map((f) => analisarConversa(f.conversa, hojeBR, p.ano)));
    resultados.forEach((r, k) => {
      if (!r.promessa || !r.data) return;
      const c = lote[k].c;
      const { prazoVigente, limite } = calcularLimites(c.prazo_reciclagem, c.prazo_prorrogado, cfg);
      const data = new Date(`${r.data}T00:00:00Z`);
      sugestoes.push({
        contato_campanha_id: c.id,
        nome: c.nome,
        telefone: c.telefone,
        status: c.status,
        data_sugerida: r.data,
        trecho: r.trecho,
        prazo_vigente: prazoVigente ? dataISO(prazoVigente) : null,
        limite: dataISO(limite),
        excecao: !prazoVigente || data > prazoVigente,
        acima_do_limite: data > limite,
        data_passada: data < hojeUTC(cfg.fuso),
      });
    });
  }
  return { analisados: fila.length, sugestoes };
}

// ============================================================================
// HANDLER
// ============================================================================

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Metodo nao permitido' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json().catch(() => ({}));
    const acao = body?.acao || 'executar';
    const cfg = await carregarConfig(sb);
    if (!cfg) return json({ error: 'resgate_config nao encontrada' }, 500);

    if (acao === 'simular') {
      const candidatos = await buscarCandidatos(sb, cfg);
      const lista = candidatos.map((c, i) => {
        const { prazo, motivo } = calcularPrazoProrrogado(c, cfg);
        return {
          nome: c.nome,
          telefone: c.telefone,
          status: c.status,
          ultima_interacao: c.ultima_interacao,
          prazo_original: c.prazo_reciclagem,
          prazo_prorrogado: prazo ? dataISO(prazo) : null,
          elegivel: !!prazo,
          motivo: motivo || null,
          previa: prazo ? montarMensagemResgate(i % TOTAL_VARIANTES, c, prazo, cfg.fuso) : null,
        };
      });
      return json({ success: true, total: lista.length, elegiveis: lista.filter((l) => l.elegivel).length, candidatos: lista });
    }

    if (acao === 'agendar_retorno') {
      const r = await agendarRetorno(sb, cfg, {
        contato_campanha_id: body.contato_campanha_id,
        data: body.data,
        origem: body.origem,
        trecho: body.trecho,
      });
      return json({ success: r.ok, ...r });
    }

    if (acao === 'detectar_promessas') {
      const r = await detectarPromessas(sb, cfg);
      return json({ success: true, ...r });
    }

    if (acao === 'executar') {
      // Retornos combinados com o formando rodam mesmo com o resgate pausado
      const retornos = cfg.retornos_ativos === false ? 0 : await enviarRetornos(sb, cfg);
      if (!cfg.ativo) return json({ success: true, ativo: false, retornos });
      const agendados = await planejarDia(sb, cfg);
      const enviados = await enviarPendentes(sb, cfg);
      return json({ success: true, agendados, enviados, retornos });
    }

    return json({ error: 'Acao desconhecida' }, 400);
  } catch (e) {
    console.error('[Resgate] Erro:', e);
    return json({ error: e instanceof Error ? e.message : 'erro' }, 500);
  }
});
