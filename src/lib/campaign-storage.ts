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
  tipo_atendimento?: 'visita_externa' | 'escritorio';
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
      .select('id, nome, descricao, mensagem_inicial, prompt_ia, status, criado_em, opcoes_agendamento, tipo_atendimento')
      .order('criado_em', { ascending: false });

    if (error) {
      console.warn('[Storage] Supabase error, using local storage:', error.message);
      return { data: getLocalCampanhas(), source: 'local' };
    }

    // Try to fetch contacts for each campaign from Supabase
    const campanhasWithContatos: Campanha[] = [];
    for (const camp of data || []) {
      const { data: contatosData } = await supabase
        .from('contatos_campanha')
        .select('id, nome, telefone, status')
        .eq('campanha_id', camp.id);

      campanhasWithContatos.push({
        ...camp,
        contatos: contatosData?.map((c: any) => ({
          id: c.id,
          nome: c.nome,
          telefone: c.telefone,
          status: c.status || 'aguardando_inicio',
        })) || [],
      });
    }

    console.log('[Storage] Campanhas loaded from Supabase:', campanhasWithContatos.length);
    return { data: campanhasWithContatos, source: 'supabase' };
  } catch (err) {
    console.warn('[Storage] Supabase exception, using local storage:', err);
    return { data: getLocalCampanhas(), source: 'local' };
  }
}

export async function createCampanha(
  campanha: Omit<Campanha, 'id' | 'criado_em' | 'status' | 'contatos'>,
  contatos: Array<{ nome: string; telefone: string; local?: string; curso?: string; numero_contrato?: string; data?: string }>
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
      }));

      const { data: contatosInseridos, error: contatosError } = await supabase
        .from('contatos_campanha')
        .insert(contatosParaInserir)
        .select('id, nome, telefone, status, local, curso, numero_contrato');

      if (contatosError) {
        console.warn('[Storage] Error saving contacts to Supabase:', contatosError);
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
  // First try to get from localStorage (most reliable)
  const localCampanhas = getLocalCampanhas();
  const localCampanha = localCampanhas.find((c) => c.id === campanhaId);

  if (localCampanha && localCampanha.contatos && localCampanha.contatos.length > 0) {
    console.log('[Storage] Contatos loaded from localStorage:', localCampanha.contatos.length);
    return { data: localCampanha.contatos, source: 'local' };
  }

  // Try Supabase as fallback
  try {
    const { data, error } = await supabase
      .from('contatos_campanha')
      .select('id, nome, telefone, status, local, curso, numero_contrato')
      .eq('campanha_id', campanhaId);

    if (error) {
      throw error;
    }

    if (data && data.length > 0) {
      console.log('[Storage] Contatos loaded from Supabase:', data.length);
      return { data: data as ContatoCampanha[], source: 'supabase' };
    }
  } catch (err) {
    console.warn('[Storage] Supabase failed for contacts:', err);
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
