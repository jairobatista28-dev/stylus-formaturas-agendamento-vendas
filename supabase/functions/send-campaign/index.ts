import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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
    const { campanha_id } = body;

    if (!campanha_id) {
      return new Response(JSON.stringify({ error: 'campanha_id obrigatorio' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Trava atomica contra duplo disparo: so passa se conseguir mudar de rascunho/pausada para em_andamento
    const { data: linhaTravada, error: lockError } = await sb
      .from('campanhas')
      .update({ status: 'em_andamento' })
      .eq('id', campanha_id)
      .in('status', ['rascunho', 'pausada'])
      .select('id')
      .maybeSingle();

    if (lockError) {
      return new Response(JSON.stringify({ error: lockError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!linhaTravada) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Esta campanha ja foi iniciada (ou esta em andamento)',
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Busca campanha
    const { data: campanha, error: campError } = await sb
      .from('campanhas')
      .select('*')
      .eq('id', campanha_id)
      .single();

    if (campError || !campanha) {
      return new Response(JSON.stringify({ error: 'Campanha nao encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Busca contatos pendentes
    const { data: contatos, error: contatosError } = await sb
      .from('contatos_campanha')
      .select('*')
      .eq('campanha_id', campanha_id)
      .eq('status', 'aguardando_inicio')
      .order('criado_em');

    if (contatosError) {
      return new Response(JSON.stringify({ error: contatosError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!contatos || contatos.length === 0) {
      return new Response(JSON.stringify({
        message: 'Nenhum contato pendente para envio',
        total: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse dos blocos de mensagem (JSON string or array)
    let blocos: { mensagem: string; delay?: number }[] = [];
    try {
      if (campanha.blocos_mensagem) {
        blocos = typeof campanha.blocos_mensagem === 'string'
          ? JSON.parse(campanha.blocos_mensagem)
          : campanha.blocos_mensagem;
      }
    } catch {
      blocos = [];
    }

    // Se nao tem blocos, processa mensagem_inicial com marcadores [esperar Xs]
    if (blocos.length === 0 && campanha.mensagem_inicial) {
      const mensagemOriginal = campanha.mensagem_inicial;
      const regexEspera = /\[esperar\s+(\d+)s?\]/gi;

      // Divide o texto onde encontram os marcadores
      const partes = mensagemOriginal.split(regexEspera);

      // Extrai todos os delays dos marcadores
      const delays = [...mensagemOriginal.matchAll(regexEspera)].map(m => parseInt(m[1]));

      // Monta os blocos: texto + delay do proximo marcador
      for (let i = 0; i < partes.length; i += 2) {
        const texto = (partes[i] || '').trim();
        const delay = delays[Math.floor(i / 2)] || 0;

        if (texto) {
          blocos.push({ mensagem: texto, delay });
        }
      }

      // Se nao encontrou marcadores, usa mensagem completa
      if (blocos.length === 0 && mensagemOriginal.trim()) {
        blocos = [{ mensagem: mensagemOriginal.trim() }];
      }

      console.log(`[SendCampaign] Mensagem inicial processada: ${blocos.length} blocos`);
    }

    if (blocos.length === 0) {
      return new Response(JSON.stringify({ error: 'Campanha sem mensagens configuradas' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Funcao para substituir variaveis
    const fillVars = (template: string, contato: any): string => {
      return template
        .replace(/\{\{nome_formando\}\}/g, contato.nome_formando || contato.nome || '')
        .replace(/\{\{nome\}\}/g, contato.nome_formando || contato.nome || '')
        .replace(/\{\{numero_contrato\}\}/g, contato.numero_contrato || '')
        .replace(/\{\{curso\}\}/g, contato.curso || '')
        .replace(/\{\{telefone\}\}/g, contato.telefone || '');
    };

    // Popula a fila de envios
    const filaItems: any[] = [];
    let ordemGlobal = 0;

    for (const contato of contatos) {
      for (let i = 0; i < blocos.length; i++) {
        const bloco = blocos[i];
        const msg = fillVars(bloco.mensagem, contato);
        const delay = bloco.delay || 0;

        filaItems.push({
          contato_id: contato.id,
          campanha_id: campanha_id,
          telefone: contato.telefone,
          mensagem: msg,
          ordem_bloco: i + 1,
          delay_bloco: delay,
          status: 'pendente',
          ordem_global: ordemGlobal++,
        });
      }
    }

    // Insere em lotes
    const BATCH_SIZE = 100;
    let inseridos = 0;

    for (let i = 0; i < filaItems.length; i += BATCH_SIZE) {
      const batch = filaItems.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await sb.from('fila_envios').insert(batch);
      if (insertError) {
        console.error('[SendCampaign] Erro ao inserir lote:', insertError);
      } else {
        inseridos += batch.length;
      }
    }

    // Atualiza status da campanha
    await sb
      .from('campanhas')
      .update({ status: 'running' })
      .eq('id', campanha_id);

    // Atualiza status dos contatos
    await sb
      .from('contatos_campanha')
      .update({ status: 'enviando' })
      .eq('campanha_id', campanha_id)
      .eq('status', 'aguardando_inicio');

    console.log(`[SendCampaign] Campanha ${campanha_id} iniciada: ${contatos.length} contatos, ${inseridos} itens na fila`);

    return new Response(JSON.stringify({
      success: true,
      campanha_id,
      contatos: contatos.length,
      itens_fila: inseridos,
      message: `Campanha iniciada com ${contatos.length} contatos`,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[SendCampaign] Erro:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
