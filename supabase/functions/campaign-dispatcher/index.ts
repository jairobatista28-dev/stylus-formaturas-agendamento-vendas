import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Normaliza telefone: remove nao-digitos, garante o "9" no celular BR e o
// codigo do pais 55. Mesma logica usada em uazapi-webhook/index.ts - as duas
// funcoes precisam gerar EXATAMENTE o mesmo resultado pro mesmo numero, senao
// o mesmo contato acaba duplicado no banco (um criado ao disparar a campanha,
// outro quando a pessoa responde de verdade pelo WhatsApp).
function normalizePhone(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");

  // Remove o codigo do pais se ja existir, para padronizar o processamento
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }

  // Numero de celular BR com DDD: 11 digitos (DDD + 9 + numero)
  // Se vier com 10 digitos (sem o 9), adiciona o 9
  if (digits.length === 10) {
    digits = digits.slice(0, 2) + "9" + digits.slice(2);
  }

  return "55" + digits;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sistema anti-bloqueio inteligente: intervalos variados entre contatos
// Intercala segundos e minutos para parecer comportamento humano
const ANTI_BLOCK_INTERVALS = [
  5000,   // 5s
  7000,   // 7s
  8000,   // 8s
  9000,   // 9s
  12000,  // 12s
  15000,  // 15s
  18000,  // 18s
  22000,  // 22s
  28000,  // 28s
  35000,  // 35s
  45000,  // 45s
  60000,  // 1min
  75000,  // 1min15s
  90000,  // 1min30s
  120000, // 2min
];

function getRandomAntiBlockDelay(): number {
  const idx = Math.floor(Math.random() * ANTI_BLOCK_INTERVALS.length);
  const base = ANTI_BLOCK_INTERVALS[idx];
  // Adiciona uma variacao de +/- 2s para ainda mais imprevisibilidade
  const variation = Math.floor(Math.random() * 4000) - 2000;
  return Math.max(3000, base + variation);
}

// uazapiGO endpoint: POST /send/text (token header identifies the instance)
async function enviarMensagem(telefone: string, mensagem: string, sb: any): Promise<{ ok: boolean; erro?: string }> {
  try {
    let uazapiUrl = Deno.env.get("UAZAPI_URL") || Deno.env.get("UAZAPI_BASE_URL");
    let uazapiToken = Deno.env.get("UAZAPI_TOKEN");

    if (!uazapiUrl || !uazapiToken) {
      const { data: settings } = await sb
        .from("whatsapp_settings")
        .select("api_url, api_token")
        .limit(1)
        .maybeSingle();
      if (settings) {
        uazapiUrl = uazapiUrl || settings.api_url;
        uazapiToken = uazapiToken || settings.api_token;
      }
    }
    if (!uazapiUrl || !uazapiToken) {
      return { ok: false, erro: "uazapi_nao_configurada" };
    }

    let cleanPhone = telefone.replace(/\D/g, "");
    if (!cleanPhone.startsWith("55")) cleanPhone = `55${cleanPhone}`;

    const response = await fetch(`${uazapiUrl.replace(/\/$/, "")}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "token": uazapiToken },
      body: JSON.stringify({ number: cleanPhone, text: mensagem }),
    });
    const responseText = await response.text();
    console.log(`[Uazapi] ${cleanPhone}: status=${response.status} | ${responseText.substring(0, 300)}`);
    if (!response.ok) return { ok: false, erro: `${response.status}: ${responseText.substring(0, 300)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "erro_rede" };
  }
}

// ============================================================================
// ENVIO SEGURO (config na tabela envio_config)
// ============================================================================

interface EnvioConfig {
  abertura_ativa: boolean;
  abertura_venda: string;
  abertura_agendamento: string;
  incluir_sair: boolean;
  texto_sair: string;
  limite_inicial: number;
  incremento_semanal: number;
  limite_maximo: number;
  aquecimento_inicio: string;
  hora_inicio: number;
  hora_fim: number;
  dias_semana: number[];
  fuso: string;
  falhas_para_pausar: number;
  falhas_seguidas: number;
  pausado: boolean;
}

function partesNoFuso(fuso: string, d: Date = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour) % 24, minuto: Number(p.minute), diaSemana: dias[p.weekday] ?? 0,
  };
}

/** Inicio do dia de hoje (no fuso) em UTC */
function inicioDoDiaUTC(fuso: string): string {
  const agora = new Date();
  const p = partesNoFuso(fuso, agora);
  const localComoUTC = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  const offsetMs = localComoUTC - Math.floor(agora.getTime() / 60000) * 60000;
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia, 0, 0) - offsetMs).toISOString();
}

/** Limite de primeiros contatos hoje: comeca baixo e sobe por semana ate o maximo */
function limiteDeHoje(cfg: EnvioConfig): number {
  const inicio = new Date(`${cfg.aquecimento_inicio}T00:00:00Z`).getTime();
  const semanas = Math.max(0, Math.floor((Date.now() - inicio) / (7 * 86400000)));
  return Math.min(cfg.limite_maximo, cfg.limite_inicial + semanas * cfg.incremento_semanal);
}

function dentroDaJanela(cfg: EnvioConfig): boolean {
  const p = partesNoFuso(cfg.fuso);
  return (cfg.dias_semana || []).includes(p.diaSemana) && p.hora >= cfg.hora_inicio && p.hora < cfg.hora_fim;
}

function primeiroNome(nome?: string | null): string {
  const p = String(nome || "").trim().split(/\s+/)[0] || "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

function capitalizar(t?: string | null): string {
  return String(t || "").trim().toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function montarAbertura(cfg: EnvioConfig, tipo: string, nome: string, curso?: string | null): string {
  const modelo = tipo === "venda_material" ? cfg.abertura_venda : cfg.abertura_agendamento;
  const cursoTxt = curso && !/^outros?$/i.test(curso.trim()) ? ` de ${capitalizar(curso)}` : "";
  let texto = String(modelo || "")
    .replace(/\{primeiro_nome\}/gi, primeiroNome(nome))
    .replace(/\{nome\}/gi, nome || "")
    .replace(/\{curso\}/gi, cursoTxt)
    .trim();
  if (cfg.incluir_sair && cfg.texto_sair) texto += `\n\n${cfg.texto_sair}`;
  return texto;
}

/** Erros que indicam numero invalido (nao e sinal de bloqueio) */
function erroDeNumeroInvalido(erro?: string): boolean {
  return /not.{0,20}whatsapp|not.{0,10}exist|no.{0,10}account|not.{0,10}registered|invalid.{0,10}(number|phone|jid)|n[aã]o.{0,20}(existe|whatsapp)/i.test(erro || "");
}

async function registrarAlerta(sb: any, a: { tipo: string; gravidade: string; titulo: string; detalhe?: string }) {
  try {
    await sb.from("alertas_sistema").insert({ tipo: a.tipo, gravidade: a.gravidade, titulo: a.titulo, detalhe: a.detalhe || null });
  } catch (e) {
    console.warn("[Alerta] Falha ao registrar:", e);
  }
}

/** Conta a falha; ao atingir o limite, pausa os disparos e avisa no Painel de Alertas */
async function contarFalha(sb: any, cfg: EnvioConfig | null, erro?: string) {
  if (!cfg) return;
  const falhas = (cfg.falhas_seguidas || 0) + 1;
  if (falhas >= (cfg.falhas_para_pausar || 3)) {
    await sb.from("envio_config").update({
      falhas_seguidas: falhas,
      pausado: true,
      pausado_motivo: `${falhas} envios seguidos falharam. Último erro: ${String(erro || "").slice(0, 200)}`,
      pausado_em: new Date().toISOString(),
    }).eq("id", 1);
    await registrarAlerta(sb, {
      tipo: "envios_pausados",
      gravidade: "erro",
      titulo: "Disparos das campanhas PAUSADOS automaticamente",
      detalhe: `${falhas} envios seguidos falharam (possível bloqueio ou WhatsApp desconectado). Confira a conexão do WhatsApp e retome em Campanhas > Envio seguro. Último erro: ${String(erro || "").slice(0, 300)}`,
    });
    console.error(`[Dispatcher] PAUSADO apos ${falhas} falhas seguidas`);
  } else {
    await sb.from("envio_config").update({ falhas_seguidas: falhas }).eq("id", 1);
  }
}

async function zerarFalhas(sb: any, cfg: EnvioConfig | null) {
  if (cfg && cfg.falhas_seguidas > 0) await sb.from("envio_config").update({ falhas_seguidas: 0 }).eq("id", 1);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function obterContactId(sb: any, telefone: string, nome?: string | null): Promise<string | undefined> {
  const tel = normalizePhone(telefone);
  const { data: existente } = await sb.from("contacts").select("id").eq("phone", tel).maybeSingle();
  if (existente) return existente.id;
  const { data: novo } = await sb
    .from("contacts")
    .insert({ phone: tel, name: nome || tel, status: "lead", assigned_to: "ia" })
    .select("id")
    .single();
  return novo?.id;
}

/**
 * CAMPANHA "ULTIMA OPORTUNIDADE" (venda sem visita): no primeiro envio para o
 * formando, deixa o caminho livre para a IA de vendas desta campanha:
 *  - encerra conversas antigas (ex: de agendamento) que ainda esperavam resposta,
 *    para a resposta dele nao cair no fluxo antigo;
 *  - devolve o contato para a IA (pode ter ficado em modo manual no passado);
 *  - impede que campanhas de venda antigas mandem resgate/retorno para ele.
 */
async function prepararUltimaOportunidade(sb: any, contatoId: string, campanhaId: string, telefone: string, contactId?: string) {
  try {
    const tel = normalizePhone(telefone);
    const telefones = [...new Set([telefone, tel])];
    await sb
      .from("conversa_estado")
      .update({ aguardando_resposta: false, status: "concluido", updated_at: new Date().toISOString() })
      .in("contato_telefone", telefones)
      .neq("campanha_id", campanhaId)
      .neq("status", "concluido");

    if (contactId) {
      await sb.from("contacts").update({ assigned_to: "ia" }).eq("id", contactId);
    }

    const { data: antigos } = await sb
      .from("contatos_campanha")
      .select("id")
      .in("telefone", telefones)
      .neq("id", contatoId)
      .neq("status", "comprou");
    const idsAntigos = (antigos || []).map((a: any) => a.id);
    if (idsAntigos.length) {
      await sb
        .from("retornos_agendados")
        .update({ status: "cancelado", motivo: "ultima_oportunidade" })
        .in("contato_campanha_id", idsAntigos)
        .eq("status", "agendado");
      await sb
        .from("contatos_campanha")
        .update({ resgate_enviado_em: new Date().toISOString() })
        .in("id", idsAntigos)
        .is("resgate_enviado_em", null);
    }
    console.log(`[Dispatcher] Ultima oportunidade: historico antigo isolado para ${tel}`);
  } catch (e) {
    console.warn("[Dispatcher] Falha ao preparar ultima oportunidade:", e);
  }
}

async function somarEnviada(sb: any, campanhaId: string) {
  const { data: c } = await sb.from("campanhas").select("total_sent").eq("id", campanhaId).single();
  if (c) await sb.from("campanhas").update({ total_sent: (c.total_sent || 0) + 1 }).eq("id", campanhaId);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo nao permitido" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: cfgBruta } = await sb.from("envio_config").select("*").eq("id", 1).maybeSingle();
    const cfg = (cfgBruta || null) as EnvioConfig | null;

    if (cfg?.pausado) {
      return json({ pausado: true, message: "Disparos pausados (Campanhas > Envio seguro)" });
    }

    const { data: blocos, error: claimError } = await sb.rpc("claim_contact_blocks", { p_limit: 20 });
    if (claimError) {
      console.error("[Dispatcher] Erro ao claim blocos:", claimError);
      return json({ error: claimError.message }, 500);
    }
    if (!blocos || blocos.length === 0) return json({ message: "Nenhum item na fila" });

    blocos.sort((a: any, b: any) => a.ordem_bloco - b.ordem_bloco);
    const contatoId = blocos[0].contato_id;
    const ids = blocos.map((b: any) => b.id);
    const devolver = async () => {
      await sb.from("fila_envios").update({ status: "pendente" }).in("id", ids);
    };
    const cancelar = async () => {
      await sb.from("fila_envios").update({ status: "cancelado" }).in("id", ids);
    };

    const { data: contato } = await sb
      .from("contatos_campanha")
      .select("id, nome, status, curso, abertura_status, primeiro_envio_em, campanhas(*)")
      .eq("id", contatoId)
      .single();
    const telefone = blocos[0].telefone;
    const telNorm = normalizePhone(telefone);
    const tipo = (contato as any)?.campanhas?.tipo_atendimento || "visita_externa";
    // Venda direta (Ultima Oportunidade ou Black Friday): isola o historico antigo do formando
    const ultimaOportunidade = tipo === "venda_material" && ["ultima_oportunidade", "black_friday"].includes((contato as any)?.campanhas?.modalidade_venda);
    const continuacao = contato?.abertura_status === "liberada";
    const temBloco1 = blocos.some((b: any) => b.ordem_bloco === 1);
    const primeiroContato = !continuacao && temBloco1 && !contato?.primeiro_envio_em;

    // Contato que ja saiu da etapa inicial (respondeu, comprou...) nao recebe a abertura de novo
    if (!continuacao && temBloco1 && contato && !["aguardando_inicio", "enviando"].includes(contato.status)) {
      await cancelar();
      return json({ cancelado: true, motivo: `status_${contato.status}` });
    }

    if (primeiroContato) {
      // Pediu para nao receber (SAIR)
      const { data: saiu } = await sb.from("optout").select("telefone").eq("telefone", telNorm).maybeSingle();
      if (saiu) {
        await cancelar();
        await sb.from("contatos_campanha").update({ status: "sem_interesse" }).eq("id", contatoId);
        return json({ cancelado: true, motivo: "optout" });
      }
      if (cfg) {
        if (!dentroDaJanela(cfg)) {
          await devolver();
          return json({ aguardando: true, motivo: "fora_do_horario" });
        }
        const { count } = await sb
          .from("contatos_campanha")
          .select("id", { count: "exact", head: true })
          .gte("primeiro_envio_em", inicioDoDiaUTC(cfg.fuso));
        const limite = limiteDeHoje(cfg);
        if ((count || 0) >= limite) {
          await devolver();
          return json({ aguardando: true, motivo: "limite_diario", enviados_hoje: count, limite });
        }
      }
    }

    // ---------- ABERTURA EM DOIS PASSOS ----------
    if (primeiroContato && cfg?.abertura_ativa) {
      const texto = montarAbertura(cfg, tipo, contato?.nome || "", contato?.curso);
      await sleep(getRandomAntiBlockDelay());
      await sleep(Math.floor(Math.random() * 2000) + 2000);
      const r = await enviarMensagem(telefone, texto, sb);

      if (!r.ok) {
        await sb.from("fila_envios").update({ status: "cancelado" }).in("id", ids);
        await sb.from("contatos_campanha").update({ status: "erro_envio" }).eq("id", contatoId);
        if (!erroDeNumeroInvalido(r.erro)) await contarFalha(sb, cfg, r.erro);
        return json({ success: false, erro: r.erro });
      }

      await zerarFalhas(sb, cfg);
      const agora = new Date().toISOString();
      // O resto da campanha fica guardado ate o formando responder
      await sb.from("fila_envios").update({ status: "aguardando_resposta" }).in("id", ids);
      await sb.from("contatos_campanha").update({
        status: "saudacao_enviada",
        abertura_status: "enviada",
        abertura_enviada_em: agora,
        primeiro_envio_em: agora,
      }).eq("id", contatoId);
      const contactId = await obterContactId(sb, telefone, contato?.nome);
      if (ultimaOportunidade) await prepararUltimaOportunidade(sb, contatoId, blocos[0].campanha_id, telefone, contactId);
      if (contactId) {
        await sb.from("messages").insert({ contact_id: contactId, direction: "out", content: texto, sent_by: "ia", delivered: true, seq: 0 });
      }
      await somarEnviada(sb, blocos[0].campanha_id);
      console.log(`[Dispatcher] Abertura enviada para ${contato?.nome} - aguardando resposta`);
      return json({ success: true, abertura: true, contato_id: contatoId });
    }

    // ---------- ENVIO DOS BLOCOS (direto ou liberado pela resposta) ----------
    let contactId: string | undefined;
    let enviados = 0;
    for (const job of blocos) {
      if (enviados === 0) {
        // Continuacao e resposta a uma mensagem do formando: espera curta, como uma pessoa
        await sleep(continuacao ? 3000 + Math.random() * 3000 : getRandomAntiBlockDelay());
      } else if (job.delay_bloco > 0) {
        await sleep(job.delay_bloco * 1000);
      } else {
        await sleep(continuacao ? 4000 + Math.random() * 4000 : getRandomAntiBlockDelay());
      }
      await sleep(Math.floor(Math.random() * 2000) + 2000);

      let texto = job.mensagem;
      if (primeiroContato && job.ordem_bloco === 1 && cfg?.incluir_sair && cfg.texto_sair && !cfg.abertura_ativa) {
        texto += `\n\n${cfg.texto_sair}`;
      }

      const r = await enviarMensagem(job.telefone, texto, sb);
      if (!r.ok) {
        await sb.from("fila_envios").update({ status: "erro" }).eq("id", job.id);
        await sb.from("fila_envios").update({ status: "cancelado" }).eq("contato_id", job.contato_id).eq("status", "processando");
        await sb.from("contatos_campanha").update({ status: "erro_envio" }).eq("id", job.contato_id);
        if (!erroDeNumeroInvalido(r.erro)) await contarFalha(sb, cfg, r.erro);
        console.log(`[Dispatcher] Contato ${job.contato_id} marcado como erro_envio`);
        break;
      }

      await zerarFalhas(sb, cfg);
      enviados++;
      await sb.from("fila_envios").update({ status: "enviado" }).eq("id", job.id);
      if (!contactId) contactId = await obterContactId(sb, job.telefone, contato?.nome);
      if (contactId) {
        await sb.from("messages").insert({
          contact_id: contactId, direction: "out", content: texto, sent_by: "ia", delivered: true, seq: job.ordem_bloco,
        });
      }
      if (job.ordem_bloco === 1 && !continuacao) {
        if (ultimaOportunidade && primeiroContato) {
          await prepararUltimaOportunidade(sb, job.contato_id, job.campanha_id, job.telefone, contactId);
        }
        await sb.from("contatos_campanha").update({
          status: "saudacao_enviada",
          primeiro_envio_em: contato?.primeiro_envio_em || new Date().toISOString(),
        }).eq("id", job.contato_id);
      }
      if (!continuacao) await somarEnviada(sb, job.campanha_id);
    }

    // Terminou de enviar tudo desse contato
    const { data: restantes } = await sb
      .from("fila_envios")
      .select("id")
      .eq("contato_id", contatoId)
      .in("status", ["pendente", "aguardando_resposta"])
      .limit(1);
    if (!restantes || restantes.length === 0) {
      if (continuacao) {
        await sb.from("contatos_campanha").update({ abertura_status: "concluida" }).eq("id", contatoId);
      } else if (contato?.status === "enviando") {
        await sb.from("contatos_campanha").update({ status: "saudacao_enviada" }).eq("id", contatoId);
      }
    }

    return json({ success: true, processados: enviados, contato_id: contatoId, continuacao });
  } catch (error) {
    console.error("[Dispatcher] Erro geral:", error);
    return json({ error: error instanceof Error ? error.message : "Erro desconhecido" }, 500);
  }
});
