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
async function enviarMensagem(telefone: string, mensagem: string, sb: any): Promise<boolean> {
  try {
    let uazapiUrl = Deno.env.get("UAZAPI_URL");
    let uazapiToken = Deno.env.get("UAZAPI_TOKEN");

    // Fall back to whatsapp_settings table if env vars not set
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
      console.error("[Uazapi] Configuracao incompleta. URL:", !!uazapiUrl, "Token:", !!uazapiToken);
      return false;
    }

    // Limpa o telefone
    let cleanPhone = telefone.replace(/\D/g, "");
    if (!cleanPhone.startsWith("55")) {
      cleanPhone = `55${cleanPhone}`;
    }

    const baseUrl = uazapiUrl.replace(/\/$/, "");
    const endpoint = `${baseUrl}/send/text`;
    const payload = { number: cleanPhone, text: mensagem };

    console.log(`[Uazapi] Enviando para ${cleanPhone} | URL: ${endpoint} | Msg: ${mensagem.substring(0, 80)}...`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "token": uazapiToken,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    console.log(`[Uazapi] Resposta: status=${response.status} | body=${responseText.substring(0, 500)}`);

    if (!response.ok) {
      console.error(`[Uazapi] Erro ${response.status}: ${responseText}`);
      return false;
    }

    console.log(`[Uazapi] Mensagem enviada com sucesso para ${cleanPhone}`);
    return true;
  } catch (err) {
    console.error("[Uazapi] Excecao ao enviar:", err);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo nao permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // ATOMIC LOCK: claim all pending blocks for one contact in a single transaction
    // This prevents concurrent dispatchers (cron + manual) from grabbing the same contact
    const { data: blocosDoContato, error: claimError } = await sb
      .rpc("claim_contact_blocks", { p_limit: 20 });

    if (claimError) {
      console.error("[Dispatcher] Erro ao claim blocos:", claimError);
      return new Response(JSON.stringify({ error: claimError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!blocosDoContato || blocosDoContato.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhum item na fila" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const primeiroContatoId = blocosDoContato[0].contato_id;

    console.log(`[Dispatcher] Reivindicados ${blocosDoContato.length} blocos para contato ${primeiroContatoId}`);

    // Verifica status do contato
    const { data: contato } = await sb
      .from("contatos_campanha")
      .select("id, nome, status")
      .eq("id", primeiroContatoId)
      .single();

    let contactId: string | undefined;

    // Processa cada bloco em sequencia (for-of com await)
    for (const job of blocosDoContato) {
      console.log(`[Dispatcher] Processando bloco ${job.ordem_bloco} para ${job.telefone}`);

      // Verifica se contato ainda e valido para bloco 1
      if (job.ordem_bloco === 1 && contato && contato.status !== "aguardando_inicio" && contato.status !== "enviando") {
        await sb.from("fila_envios").update({ status: "cancelado" }).eq("id", job.id);
        continue;
      }

      // Sistema anti-bloqueio inteligente:
      // - Bloco 1 (primeiro contato): intervalo variado de 5s a 2min antes de enviar
      // - Blocos 2+: usa o delay_bloco especifico do marcador [esperar Xs]
      if (job.ordem_bloco === 1) {
        const antiBlockDelay = getRandomAntiBlockDelay();
        console.log(`[Anti-Bloqueio] Aguardando ${(antiBlockDelay / 1000).toFixed(1)}s antes do envio`);
        await sleep(antiBlockDelay);
      } else if (job.delay_bloco > 0) {
        console.log(`[Delay] Aguardando ${job.delay_bloco}s entre blocos`);
        await sleep(job.delay_bloco * 1000);
      } else {
        // Sem delay_bloco definido: usa intervalo anti-bloqueio variado
        const fallbackDelay = getRandomAntiBlockDelay();
        console.log(`[Anti-Bloqueio] Aguardando ${(fallbackDelay / 1000).toFixed(1)}s (fallback)`);
        await sleep(fallbackDelay);
      }

      // Simulacao de digitacao
      const typingDelay = Math.floor(Math.random() * 2000) + 2000;
      await sleep(typingDelay);

      // Envia mensagem
      const enviado = await enviarMensagem(job.telefone, job.mensagem, sb);

      if (enviado) {
        await sb.from("fila_envios").update({ status: "enviado" }).eq("id", job.id);

        // Salva na tabela messages
        const telefoneNormalizado = normalizePhone(job.telefone);

        if (!contactId) {
          const { data: existingContact } = await sb
            .from("contacts")
            .select("id")
            .eq("phone", telefoneNormalizado)
            .maybeSingle();

          if (existingContact) {
            contactId = existingContact.id;
          } else {
            const { data: newContact } = await sb
              .from("contacts")
              .insert({
                phone: telefoneNormalizado,
                name: contato?.nome || telefoneNormalizado,
                status: "lead",
                assigned_to: "ia",
              })
              .select("id")
              .single();
            contactId = newContact?.id;
          }
        }

        if (contactId) {
          await sb.from("messages").insert({
            contact_id: contactId,
            direction: "out",
            content: job.mensagem,
            sent_by: "ia",
            delivered: true,
            seq: job.ordem_bloco,
          });
        }

        // Atualiza status para saudacao_enviada DEPOIS do primeiro bloco
        if (job.ordem_bloco === 1) {
          await sb
            .from("contatos_campanha")
            .update({ status: "saudacao_enviada" })
            .eq("id", job.contato_id);
          console.log(`[Dispatcher] Saudacao enviada para ${job.telefone}`);
        }

        // Incrementa contador da campanha
        const { data: campanhaAtual } = await sb
          .from("campanhas")
          .select("total_sent")
          .eq("id", job.campanha_id)
          .single();

        if (campanhaAtual) {
          await sb
            .from("campanhas")
            .update({ total_sent: (campanhaAtual.total_sent || 0) + 1 })
            .eq("id", job.campanha_id);
        }
      } else {
        await sb.from("fila_envios").update({ status: "erro" }).eq("id", job.id);
        console.error(`[Dispatcher] Erro ao enviar bloco ${job.ordem_bloco} para contato ${job.contato_id}`);

        // Cancela todos os outros blocos pendentes deste contato
        await sb
          .from("fila_envios")
          .update({ status: "cancelado" })
          .eq("contato_id", job.contato_id)
          .eq("status", "processando");

        // Marca o contato como erro_envio
        await sb
          .from("contatos_campanha")
          .update({ status: "erro_envio" })
          .eq("id", job.contato_id);

        console.log(`[Dispatcher] Contato ${job.contato_id} marcado como erro_envio - pulando para proximo contato`);

        break;
      }
    }

    // Verifica se ainda ha blocos pendentes para este contato
    const { data: blocosRestantes } = await sb
      .from("fila_envios")
      .select("id")
      .eq("contato_id", primeiroContatoId)
      .eq("status", "pendente")
      .limit(1);

    if (!blocosRestantes || blocosRestantes.length === 0) {
      const { data: contatoFinal } = await sb
        .from("contatos_campanha")
        .select("status")
        .eq("id", primeiroContatoId)
        .single();

      if (contatoFinal?.status === "enviando") {
        await sb
          .from("contatos_campanha")
          .update({ status: "saudacao_enviada" })
          .eq("id", primeiroContatoId);
      }

      console.log(`[Dispatcher] Todos os blocos enviados - contato aguardando resposta`);
    }

    return new Response(JSON.stringify({
      success: true,
      processados: blocosDoContato.length,
      contato_id: primeiroContatoId,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[Dispatcher] Erro geral:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Erro desconhecido",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
