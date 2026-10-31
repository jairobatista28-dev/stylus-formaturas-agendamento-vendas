// Local Storage fallback for campaigns - avoids Supabase 406 errors

import { supabase } from './supabase';

const CAMPAIGNS_KEY = 'local_campanhas';

export interface ContatoCampanha {
  id: string;
  nome: string;
  telefone: string;
  status: string;
  local?: string;
  curso?: string;
  numero_contrato?: string;
  data?: string;
  valor_tabela?: string;
  valor_oferecido?: string;
  formas_pagamento?: string;
  opcoes_plano?: string;
  prazo_reciclagem?: string;
  quantidade_fotos?: string;
  cpf?: string;
  email?: string;
}

export interface Campanha {
  id: string;
  nome: string;
  descricao: string | null;
  mensagem_inicial: string;
  prompt_ia: string | null;
  status: string;
  criado_em: string;
  contatos: ContatoCampanha[];
  tipo_atendimento?: 'visita_externa' | 'escritorio' | 'venda_material';
  modalidade_venda?: 'padrao' | 'ultima_oportunidade' | 'black_friday';
  // Resumo vindo do banco (lista de campanhas carrega so os numeros, nao os contatos)
  total_contatos?: number;
  erros_envio?: number;
  opcoes_agendamento?: Array<{ data: string; turnos: string[]; horarios?: string[] }>;
}

function generateId(): string {
  return crypto.randomUUID();
}

// Local Storage operations
function getLocalCampanhas(): Campanha[] {
  try {
    const stored = localStorage.getItem(CAMPAIGNS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveLocalCampanhas(campanhas: Campanha[]): void {
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campanhas));
}

// Try Supabase first, fallback to localStorage
export async function fetchCampanhas(): Promise<{ data: Campanha[]; source: 'supabase' | 'local' }> {
  try {
    const { data, error } = await supabase
      .from('campanhas')
      .select('*')
      .order('criado_em', { ascending: false });

    if (error) {
      console.warn('[Storage] Supabase error, using local storage:', error.message);
      return { data: getLocalCampanhas(), source: 'local' };
    }

    // ANTES: uma consulta por campanha, uma depois da outra, trazendo TODOS os contatos
    // (com dezenas de campanhas e milhares de contatos a tela demorava muito para abrir).
    // AGORA: uma unica consulta ao banco devolve so os numeros (total e erros de envio).
    // Os contatos em si so sao buscados quando a campanha e iniciada/reiniciada.
    const resumo = new Map<string, { total: number; erros: number }>();
    const { data: resumoData, error: resumoError } = await supabase.rpc('resumo_campanhas');
    if (!resumoError) {
      (resumoData || []).forEach((r: any) => resumo.set(r.campanha_id, { total: Number(r.total) || 0, erros: Number(r.erros_envio) || 0 }));
    } else {
      // Funcao ainda nao criada no banco: busca em paralelo (bem mais rapido que em sequencia)
      console.warn('[Storage] resumo_campanhas indisponivel, usando contagem paralela:', resumoError.message);
      await Promise.all(
        (data || []).map(async (camp: any) => {
          const [{ count: total }, { count: erros }] = await Promise.all([
            supabase.from('contatos_campanha').select('id', { count: 'exact', head: true }).eq('campanha_id', camp.id),
            supabase.from('contatos_campanha').select('id', { count: 'exact', head: true }).eq('campanha_id', camp.id).eq('status', 'erro_envio'),
          ]);
          resumo.set(camp.id, { total: total || 0, erros: erros || 0 });
        })
      );
    }

    const campanhasWithContatos: Campanha[] = (data || []).map((camp: any) => ({
      ...camp,
      contatos: [],
      total_contatos: resumo.get(camp.id)?.total || 0,
      erros_envio: resumo.get(camp.id)?.erros || 0,
    }));

    console.log('[Storage] Campanhas loaded from Supabase:', campanhasWithContatos.length);
    return { data: campanhasWithContatos, source: 'supabase' };
  } catch (err) {
    console.warn('[Storage] Supabase exception, using local storage:', err);
    return { data: getLocalCampanhas(), source: 'local' };
  }
}

export async function createCampanha(
  campanha: Omit<Campanha, 'id' | 'criado_em' | 'status' | 'contatos'>,
  contatos: Array<{
    nome: string;
    telefone: string;
    local?: string;
    curso?: string;
    numero_contrato?: string;
    data?: string;
    valor_tabela?: string;
    valor_oferecido?: string;
    formas_pagamento?: string;
    opcoes_plano?: string;
    prazo_reciclagem?: string;
    quantidade_fotos?: string;
    cpf?: string;
    email?: string;
  }>
): Promise<{ success: boolean; campanhaId?: string; source: 'supabase' | 'local'; error?: string }> {
  const now = new Date().toISOString();

  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('campanhas')
      .insert({
        nome: campanha.nome,
        descricao: campanha.descricao,
        mensagem_inicial: campanha.mensagem_inicial,
        prompt_ia: campanha.prompt_ia,
        tipo_atendimento: (campanha as any).tipo_atendimento || 'visita_externa',
        // So envia a coluna quando e a campanha nova (campanhas antigas nao dependem dela)
        ...((campanha as any).modalidade_venda ? { modalidade_venda: (campanha as any).modalidade_venda } : {}),
        opcoes_agendamento: (campanha as any).opcoes_agendamento || null,
        status: 'rascunho',
      })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    const campanhaId = data?.id;
    if (!campanhaId) {
      throw new Error('ID da campanha nao retornado');
    }

    // Insert contacts without IDs - let the database generate UUIDs
    if (contatos.length > 0) {
      const contatosParaInserir = contatos.map((c) => ({
        campanha_id: campanhaId,
        nome: c.nome,
        telefone: c.telefone,
        status: 'aguardando_inicio',
        local: c.local || null,
        curso: c.curso || null,
        numero_contrato: c.numero_contrato || null,
        valor_tabela: c.valor_tabela || null,
        valor_oferecido: c.valor_oferecido || null,
        formas_pagamento: c.formas_pagamento || null,
        opcoes_plano: c.opcoes_plano || null,
        prazo_reciclagem: c.prazo_reciclagem || null,
        quantidade_fotos: c.quantidade_fotos || null,
        cpf: c.cpf || null,
        email: c.email || null,
      }));

      const { data: contatosInseridos, error: contatosError } = await supabase
        .from('contatos_campanha')
        .insert(contatosParaInserir)
        .select('id, nome, telefone, status, local, curso, numero_contrato, valor_tabela, valor_oferecido, formas_pagamento, opcoes_plano, prazo_reciclagem, quantidade_fotos, cpf, email');

      if (contatosError) {
        console.error('[Storage] Error saving contacts to Supabase:', contatosError);
        return {
          success: false,
          campanhaId,
          source: 'supabase',
          error: `A campanha foi criada, mas os contatos nao foram salvos: ${contatosError.message}`,
        };
      }

      // Save to localStorage as backup with real UUIDs
      const localCampanhas = getLocalCampanhas();
      localCampanhas.unshift({
        id: campanhaId,
        nome: campanha.nome,
        descricao: campanha.descricao,
        mensagem_inicial: campanha.mensagem_inicial,
        prompt_ia: campanha.prompt_ia,
        status: 'rascunho',
        criado_em: now,
        contatos: (contatosInseridos || []).map((c) => ({
          id: c.id,
          nome: c.nome,
          telefone: c.telefone,
          status: c.status,
          local: c.local,
          curso: c.curso,
          numero_contrato: c.numero_contrato,
          valor_tabela: c.valor_tabela,
          valor_oferecido: c.valor_oferecido,
          formas_pagamento: c.formas_pagamento,
          opcoes_plano: c.opcoes_plano,
          prazo_reciclagem: c.prazo_reciclagem,
          quantidade_fotos: c.quantidade_fotos,
          cpf: c.cpf,
          email: c.email,
        })),
      });
      saveLocalCampanhas(localCampanhas);
    } else {
      // Save to localStorage without contacts
      const localCampanhas = getLocalCampanhas();
      localCampanhas.unshift({
        id: campanhaId,
        nome: campanha.nome,
        descricao: campanha.descricao,
        mensagem_inicial: campanha.mensagem_inicial,
        prompt_ia: campanha.prompt_ia,
        status: 'rascunho',
        criado_em: now,
        contatos: [],
      });
      saveLocalCampanhas(localCampanhas);
    }

    console.log('[Storage] Campanha saved to Supabase:', campanhaId);
    return { success: true, campanhaId, source: 'supabase' };
  } catch (err) {
    console.warn('[Storage] Supabase failed, saving to localStorage:', err);

    // Fallback to localStorage with generated UUID
    const id = generateId();
    const newContatos: ContatoCampanha[] = contatos.map((c) => ({
      id: generateId(),
      nome: c.nome,
      telefone: c.telefone,
      status: 'aguardando_inicio',
      local: c.local,
      curso: c.curso,
      numero_contrato: c.numero_contrato,
      valor_tabela: c.valor_tabela,
      valor_oferecido: c.valor_oferecido,
      formas_pagamento: c.formas_pagamento,
      opcoes_plano: c.opcoes_plano,
      prazo_reciclagem: c.prazo_reciclagem,
      quantidade_fotos: c.quantidade_fotos,
      cpf: c.cpf,
      email: c.email,
    }));

    const newCampanha: Campanha = {
      ...campanha,
      id,
      status: 'rascunho',
      criado_em: now,
      contatos: newContatos,
    };

    const localCampanhas = getLocalCampanhas();
    localCampanhas.unshift(newCampanha);
    saveLocalCampanhas(localCampanhas);

    console.log('[Storage] Campanha saved to localStorage:', id);
    return { success: true, campanhaId: id, source: 'local' };
  }
}

export async function fetchContatosByCampanha(
  campanhaId: string
): Promise<{ data: ContatoCampanha[]; source: 'supabase' | 'local' }> {
  // Banco primeiro: o status precisa ser o atual (o localStorage guarda o status do momento
  // em que a campanha foi criada). Busca em paginas de 1000 (limite do Supabase).
  try {
    const todos: ContatoCampanha[] = [];
    for (let inicio = 0; inicio < 50000; inicio += 1000) {
      const { data, error } = await supabase
        .from('contatos_campanha')
        .select('id, nome, telefone, status, local, curso, numero_contrato')
        .eq('campanha_id', campanhaId)
        .order('id', { ascending: true })
        .range(inicio, inicio + 999);
      if (error) throw error;
      todos.push(...((data || []) as ContatoCampanha[]));
      if (!data || data.length < 1000) break;
    }
    if (todos.length > 0) {
      console.log('[Storage] Contatos loaded from Supabase:', todos.length);
      return { data: todos, source: 'supabase' };
    }
  } catch (err) {
    console.warn('[Storage] Supabase failed for contacts:', err);
  }

  // Sem banco: usa a copia local
  const localCampanhas = getLocalCampanhas();
  const localCampanha = localCampanhas.find((c) => c.id === campanhaId);
  if (localCampanha && localCampanha.contatos && localCampanha.contatos.length > 0) {
    console.log('[Storage] Contatos loaded from localStorage:', localCampanha.contatos.length);
    return { data: localCampanha.contatos, source: 'local' };
  }

  // Return empty if nothing found
  return { data: [], source: 'local' };
}

export async function updateCampanhaStatus(
  campanhaId: string,
  status: string
): Promise<{ success: boolean; source: 'supabase' | 'local' }> {
  // Try Supabase
  try {
    const { error } = await supabase
      .from('campanhas')
      .update({ status })
      .eq('id', campanhaId);

    if (error) {
      throw error;
    }
    console.log('[Storage] Status updated in Supabase');
  } catch (err) {
    console.warn('[Storage] Supabase failed for status update:', err);
  }

  // Always update localStorage
  const localCampanhas = getLocalCampanhas();
  const idx = localCampanhas.findIndex((c) => c.id === campanhaId);
  if (idx !== -1) {
    localCampanhas[idx].status = status;
    saveLocalCampanhas(localCampanhas);
  }

  return { success: true, source: 'local' };
}

export async function updateContatoStatus(
  campanhaId: string,
  contatoId: string,
  status: string
): Promise<{ success: boolean }> {
  // Try Supabase
  try {
    await supabase
      .from('contatos_campanha')
      .update({ status })
      .eq('id', contatoId);
  } catch (err) {
    console.warn('[Storage] Supabase update failed:', err);
  }

  // Always update localStorage
  const localCampanhas = getLocalCampanhas();
  const campanhaIdx = localCampanhas.findIndex((c) => c.id === campanhaId);
  if (campanhaIdx !== -1) {
    const contatoIdx = localCampanhas[campanhaIdx].contatos.findIndex((c) => c.id === contatoId);
    if (contatoIdx !== -1) {
      localCampanhas[campanhaIdx].contatos[contatoIdx].status = status;
      saveLocalCampanhas(localCampanhas);
    }
  }

  return { success: true };
}

export async function deleteCampanha(campanhaId: string): Promise<{ success: boolean }> {
  // Try Supabase
  try {
    await supabase.from('contatos_campanha').delete().eq('campanha_id', campanhaId);
    await supabase.from('campanhas').delete().eq('id', campanhaId);
    console.log('[Storage] Campanha deleted from Supabase');
  } catch (err) {
    console.warn('[Storage] Supabase delete failed:', err);
  }

  // Always delete from localStorage
  const localCampanhas = getLocalCampanhas().filter((c) => c.id !== campanhaId);
  saveLocalCampanhas(localCampanhas);

  return { success: true };
}
