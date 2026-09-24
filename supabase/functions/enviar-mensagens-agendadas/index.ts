import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

/**
 * Envia mensagem de texto via Uazapi (mesmo padrao usado em
 * campanha-processor e uazapi-webhook).
 */
async function enviarMensagemUazapi(telefone: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL');
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN');

  if (!uazapiUrl || !uazapiToken) {
    return { ok: false, erro: 'UAZAPI_BASE_URL ou UAZAPI_TOKEN nao configurados' };
  }

  try {
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
      return { ok: false, erro: `Uazapi ${res.status}: ${err}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : 'Erro desconhecido ao enviar' };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const agora = new Date().toISOString();

    const { data: pendentes, error: erroBusca } = await sb
      .from('mensagens_agendadas')
      .select('id, contact_id, conteudo, contacts(phone)')
      .eq('enviado', false)
      .lte('enviar_em', agora)
      .order('enviar_em', { ascending: true })
      .limit(50);

    if (erroBusca) {
      console.error('[MensagensAgendadas] Erro ao buscar pendentes:', erroBusca);
      return new Response(JSON.stringify({ error: erroBusca.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let enviadas = 0;
    let falhas = 0;

    for (const msg of pendentes || []) {
      const telefone = (msg as any).contacts?.phone;

      if (!telefone) {
        await sb
          .from('mensagens_agendadas')
          .update({ erro: 'Contato sem telefone / nao encontrado' })
          .eq('id', msg.id);
        falhas++;
        continue;
      }

      const resultado = await enviarMensagemUazapi(telefone, msg.conteudo);

      if (resultado.ok) {
        await sb
          .from('mensagens_agendadas')
          .update({ enviado: true, erro: null })
          .eq('id', msg.id);

        await sb.from('messages').insert({
          contact_id: msg.contact_id,
          direction: 'out',
          content: msg.conteudo,
          sent_by: 'agendado',
          delivered: true,
          read: false,
        });

        enviadas++;
      } else {
        await sb
          .from('mensagens_agendadas')
          .update({ erro: resultado.erro })
          .eq('id', msg.id);
        falhas++;
      }
    }

    console.log(`[MensagensAgendadas] Processadas: ${enviadas} enviadas, ${falhas} falharam`);

    return new Response(JSON.stringify({ enviadas, falhas, total: (pendentes || []).length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[MensagensAgendadas] Erro geral:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
