import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Envia mensagem via Uazapi
 */
async function enviarMensagemUazapi(telefone: string, texto: string): Promise<boolean> {
  const uazapiUrl = Deno.env.get('UAZAPI_BASE_URL');
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN');
  const uazapiInstance = Deno.env.get('UAZAPI_INSTANCE');

  if (!uazapiUrl || !uazapiToken || !texto) return false;

  try {
    const response = await fetch(`${uazapiUrl}/message/sendText/${uazapiInstance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${uazapiToken}`,
      },
      body: JSON.stringify({ number: telefone, text: texto }),
    });
    console.log(`[Uazapi] Follow-up enviado para ${telefone}: ${response.status}`);
    return response.ok;
  } catch (err) {
    console.error('Erro ao enviar follow-up:', err);
    return false;
  }
}

/**
 * Function para enviar follow-up de 24h para contatos sem resposta
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('[Follow-up] Iniciando verificação de contatos sem resposta...');

    // Busca contatos com saudacao_enviada ha mais de 24h sem follow_up_enviado
    // ou com sem_retorno (reativação)
    const vinteQuatroHorasAtras = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: contatosPendentes, error } = await sb
      .from('contatos_campanha')
      .select(`
        id,
        nome,
        telefone,
        status,
        criado_em,
        updated_at,
        follow_up_enviado
      `)
      .eq('status', 'saudacao_enviada')
      .eq('follow_up_enviado', false)
      .lt('criado_em', vinteQuatroHorasAtras);

    if (error) {
      console.error('[Follow-up] Erro ao buscar contatos:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!contatosPendentes || contatosPendentes.length === 0) {
      console.log('[Follow-up] Nenhum contato pendente encontrado');
      return new Response(JSON.stringify({ enviados: 0, mensagem: 'Nenhum contato pendente' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Follow-up] Encontrados ${contatosPendentes.length} contatos pendentes`);

    let enviados = 0;
    let erros = 0;

    for (const contato of contatosPendentes) {
      const nomeContato = contato.nome || 'Formando';

      // Mensagem de follow-up
      const mensagemFollowUp = `Oi, ${nomeContato}!
Tem alguem por ai?
Estou passando rapidinho para confirmar se voce deseja ser atendido(a) para a apresentacao do seu material fotografico.
Quando puder, e so me responder se deseja seguir com o atendimento ou nao.`;

      // Envia mensagem
      const enviado = await enviarMensagemUazapi(contato.telefone, mensagemFollowUp);

      if (enviado) {
        // Atualiza follow_up_enviado e status
        await sb
          .from('contatos_campanha')
          .update({
            follow_up_enviado: true,
            status: 'sem_retorno',
          })
          .eq('id', contato.id);

        console.log(`[Follow-up] Enviado para ${nomeContato} (${contato.telefone})`);
        enviados++;
      } else {
        console.error(`[Follow-up] Falha ao enviar para ${nomeContato}`);
        erros++;
      }
    }

    console.log(`[Follow-up] Finalizado: ${enviados} enviados, ${erros} erros`);

    return new Response(JSON.stringify({
      success: true,
      enviados,
      erros,
      total: contatosPendentes.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Follow-up] Erro critico:', err);
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
