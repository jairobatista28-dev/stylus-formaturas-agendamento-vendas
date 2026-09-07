import { supabase } from './supabase';
import { sendMsg } from './uazapi';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fill(t: string, c: any): string {
  return t
    .replace(/\{\{nome_formando\}\}/g, c.nome || '')
    .replace(/\{\{nome\}\}/g, c.nome || '')
    .replace(/{nome}/gi, c.nome || '')
    .replace(/\{\{numero_contrato\}\}/g, c.numero_contrato || '')
    .replace(/\{\{curso\}\}/g, c.curso || '');
}

export async function runCampaign(id: string) {
  try {
    const { data: camp, error: campError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (campError || !camp) {
      console.error('[Campaign] Campanha nao encontrada:', campError);
      return;
    }

    await supabase.from('campaigns').update({ status: 'running' }).eq('id', id);

    const { data: contacts, error: contactsError } = await supabase
      .from('campaign_contacts')
      .select('*')
      .eq('campaign_id', id)
      .eq('status', 'pending')
      .order('created_at');

    if (contactsError) {
      console.error('[Campaign] Erro ao buscar contatos:', contactsError);
      return;
    }

    if (!contacts || contacts.length === 0) {
      await supabase.from('campaigns').update({ status: 'finished' }).eq('id', id);
      console.log('[Campaign] Nenhum contato pendente');
      return;
    }

    console.log(`[Campaign] Iniciando envio para ${contacts.length} contatos`);

    for (const c of contacts) {
      // Verifica se a campanha foi pausada
      const { data: cur } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', id)
        .single();

      if (cur?.status === 'paused' || cur?.status === 'finished') {
        console.log('[Campaign] Campanha pausada/finalizada, parando loop');
        break;
      }

      try {
        const msg = fill(camp.initial_message || '', c);

        // Cria conversa (ignora erro se ja existir)
        const { data: conv } = await supabase
          .from('conversations')
          .insert({
            campaign_contact_id: c.id,
            campaign_id: id,
            phone: c.telefone,
            status: 'active',
            messages: [{ role: 'assistant', content: msg, timestamp: new Date().toISOString() }],
          })
          .select()
          .single();

        // Envia mensagem via WhatsApp
        await sendMsg(c.telefone, msg);

        // Atualiza status do contato
        await supabase
          .from('campaign_contacts')
          .update({
            status: 'sent',
            conversation_id: conv?.id,
            last_message_at: new Date().toISOString(),
            attempts: (c.attempts || 0) + 1,
          })
          .eq('id', c.id);

        // Incrementa contador manualmente (sem RPC)
        const { data: currentCamp } = await supabase
          .from('campaigns')
          .select('total_sent')
          .eq('id', id)
          .single();

        if (currentCamp) {
          await supabase
            .from('campaigns')
            .update({ total_sent: (currentCamp.total_sent || 0) + 1 })
            .eq('id', id);
        }

        console.log(`[Campaign] Mensagem enviada para ${c.telefone}`);

        // Delay anti-bloqueio: 40-90 segundos entre contatos
        const antiBlockDelay = 40000 + Math.floor(Math.random() * 50000);
        console.log(`[Campaign] Aguardando ${antiBlockDelay / 1000}s antes do proximo contato`);
        await wait(antiBlockDelay);
      } catch (sendErr) {
        console.error(`[Campaign] Erro ao enviar para ${c.telefone}:`, sendErr);
        await supabase
          .from('campaign_contacts')
          .update({ status: 'failed' })
          .eq('id', c.id);
      }
    }

    // Finaliza campanha se todos os contatos foram processados
    const { data: pending } = await supabase
      .from('campaign_contacts')
      .select('id')
      .eq('campaign_id', id)
      .eq('status', 'pending')
      .limit(1);

    if (!pending || pending.length === 0) {
      await supabase.from('campaigns').update({ status: 'finished' }).eq('id', id);
      console.log('[Campaign] Campanha finalizada');
    }
  } catch (err) {
    console.error('[Campaign] Erro geral:', err);
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', id);
  }
}

export async function pauseCampaign(id: string) {
  await supabase.from('campaigns').update({ status: 'paused' }).eq('id', id);
  console.log('[Campaign] Campanha pausada');
}
