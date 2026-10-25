import { useEffect, useState } from 'react';
import { CalendarCheck, ChevronDown, ChevronUp, RefreshCw, Sparkles, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Retorno {
  id: string;
  contato_campanha_id: string;
  nome: string | null;
  telefone: string;
  data_retorno: string;
  agendado_para: string;
  prazo_limite: string | null;
  excecao: boolean;
  excecao_status: 'nao_aplica' | 'solicitada' | 'aprovada' | 'recusada';
  origem: 'ia' | 'manual' | 'ia_detectada';
  trecho: string | null;
  status: 'agendado' | 'enviado' | 'cancelado' | 'erro';
  motivo: string | null;
  mensagem: string | null;
  enviado_em: string | null;
}

interface Sugestao {
  contato_campanha_id: string;
  nome: string;
  telefone: string;
  status: string;
  data_sugerida: string;
  trecho: string | null;
  prazo_vigente: string | null;
  limite: string;
  excecao: boolean;
  acima_do_limite: boolean;
  data_passada: boolean;
}

function dataBR(iso: string | null | undefined): string {
  if (!iso) return '-';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

const ORIGEM: Record<Retorno['origem'], string> = {
  ia: 'Combinado com a IA',
  manual: 'Agendado manualmente',
  ia_detectada: 'Encontrado pela IA na conversa',
};

const MOTIVO_AGENDAR: Record<string, string> = {
  acima_do_limite: 'A data passa do limite máximo de guarda do material',
  data_passada: 'Essa data já passou',
  data_invalida: 'Data inválida',
  vendido: 'Esse formando já está como vendido',
  contato_nao_encontrado: 'Contato não encontrado',
};

/** Chama a Edge Function para agendar um retorno (usado aqui e nos cards de Vendas Pendentes) */
export async function agendarRetornoManual(
  contatoCampanhaId: string,
  data: string,
  origem: 'manual' | 'ia_detectada' = 'manual',
  trecho?: string | null
): Promise<{ ok: boolean; mensagem: string }> {
  const { data: r, error } = await supabase.functions.invoke('resgate-vendas', {
    body: { acao: 'agendar_retorno', contato_campanha_id: contatoCampanhaId, data, origem, trecho },
  });
  if (error || !r) return { ok: false, mensagem: 'Erro ao agendar retorno' };
  if (!r.ok) {
    const extra = r.motivo === 'acima_do_limite' ? ` (limite: ${dataBR(r.limite)})` : '';
    return { ok: false, mensagem: (MOTIVO_AGENDAR[r.motivo] || 'Nao foi possivel agendar') + extra };
  }
  return {
    ok: true,
    mensagem: `Retorno agendado para ${dataBR(r.data)}${r.excecao ? ' (com exceção de prazo, aprovada)' : ''}`,
  };
}

export function RetornosPanel({ onToast, atualizarChave }: { onToast: (msg: string, tipo: 'success' | 'error') => void; atualizarChave?: number }) {
  const [retornos, setRetornos] = useState<Retorno[]>([]);
  const [aberto, setAberto] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null);
  const [analisados, setAnalisados] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [datasEditadas, setDatasEditadas] = useState<Record<string, string>>({});

  useEffect(() => {
    carregar();
  }, [atualizarChave]);

  async function carregar() {
    const trintaDiasAtras = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('retornos_agendados')
      .select('*')
      .or(`status.eq.agendado,data_retorno.gte.${trintaDiasAtras}`)
      .order('data_retorno', { ascending: true })
      .limit(200);
    if (error) {
      console.error('[Retornos]', error);
      return;
    }
    setRetornos((data || []) as Retorno[]);
  }

  async function atualizar(id: string, campos: Partial<Retorno>, msg: string) {
    const { error } = await supabase.from('retornos_agendados').update(campos).eq('id', id);
    if (error) {
      onToast('Erro: ' + error.message, 'error');
      return;
    }
    onToast(msg, 'success');
    carregar();
  }

  async function cancelar(r: Retorno) {
    await atualizar(r.id, { status: 'cancelado', motivo: 'cancelado_manualmente' }, 'Retorno cancelado');
    await supabase.from('contatos_campanha').update({ status: 'em_conversa' }).eq('id', r.contato_campanha_id).eq('status', 'compra_futura');
  }

  async function procurarPromessas() {
    setBuscando(true);
    const { data, error } = await supabase.functions.invoke('resgate-vendas', { body: { acao: 'detectar_promessas' } });
    setBuscando(false);
    if (error || !data?.success) {
      onToast('Erro ao analisar conversas', 'error');
      return;
    }
    setAnalisados(data.analisados || 0);
    setSugestoes(data.sugestoes || []);
    // Promessa vencida: o campo comeca vazio para voce escolher uma nova data
    const iniciais: Record<string, string> = {};
    (data.sugestoes || []).forEach((s: Sugestao) => (iniciais[s.contato_campanha_id] = s.data_passada ? '' : s.data_sugerida));
    setDatasEditadas(iniciais);
  }

  async function confirmarSugestao(s: Sugestao) {
    const data = datasEditadas[s.contato_campanha_id];
    if (!data) {
      onToast('Escolha a data do retorno', 'error');
      return;
    }
    const r = await agendarRetornoManual(s.contato_campanha_id, data, 'ia_detectada', s.trecho);
    onToast(r.mensagem, r.ok ? 'success' : 'error');
    if (r.ok) {
      setSugestoes((atual) => (atual || []).filter((x) => x.contato_campanha_id !== s.contato_campanha_id));
      carregar();
    }
  }

  const agendados = retornos.filter((r) => r.status === 'agendado');
  const historico = retornos.filter((r) => r.status !== 'agendado').reverse();
  const excecoesPendentes = agendados.filter((r) => r.excecao && r.excecao_status === 'solicitada').length;

  return (
    <div className="rounded-xl p-4" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
            <CalendarCheck size={18} style={{ color: 'var(--info)' }} />
          </div>
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Retornos programados</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {agendados.length} agendados
              {excecoesPendentes > 0 ? ` · ${excecoesPendentes} exceção(ões) aguardando sua decisão` : ''} · a IA chama o formando na data combinada
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={carregar} className="btn-icon" style={{ padding: '6px' }} title="Atualizar">
            <RefreshCw size={14} />
          </button>
          <button onClick={procurarPromessas} disabled={buscando} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
            <Sparkles size={14} /> {buscando ? 'Lendo conversas...' : 'Procurar promessas nas conversas'}
          </button>
          <button onClick={() => setAberto(!aberto)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
            Detalhes {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {sugestoes && (
        <div className="mt-4 pt-4 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              A IA leu {analisados} conversas e encontrou {sugestoes.length} promessa(s) de compra com data
            </p>
            <button onClick={() => setSugestoes(null)} className="btn-icon" style={{ padding: '4px' }} title="Fechar">
              <X size={14} />
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Confira a data antes de confirmar. Ao confirmar, o retorno fica agendado sem enviar nada ao formando agora.
          </p>
          {sugestoes.map((s) => {
            const data = datasEditadas[s.contato_campanha_id] || '';
            const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date());
            const vazia = !data;
            const passada = !vazia && data < hoje;
            const acima = !vazia && data > s.limite;
            const bloqueado = vazia || passada || acima;
            const excecao = !vazia && (!s.prazo_vigente || data > s.prazo_vigente);
            return (
              <div key={s.contato_campanha_id} className="rounded-lg p-3" style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{s.nome}</p>
                    {s.trecho && (
                      <p className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>“{s.trecho}”</p>
                    )}
                    {s.data_passada && (
                      <p className="text-xs" style={{ color: 'var(--warning)' }}>
                        Promessa vencida: tinha combinado {dataBR(s.data_sugerida)} e não comprou. Escolha uma nova data.
                      </p>
                    )}
                    <p className="text-xs" style={{ color: bloqueado && !vazia ? 'var(--warning)' : 'var(--text-muted)' }}>
                      Prazo de guarda: {dataBR(s.prazo_vigente)} · limite máximo: {dataBR(s.limite)}
                      {acima ? ' · data acima do limite' : passada ? ' · essa data já passou' : excecao ? ' · precisa de exceção (será aprovada ao confirmar)' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={data}
                      min={hoje}
                      max={s.limite}
                      onChange={(e) => setDatasEditadas({ ...datasEditadas, [s.contato_campanha_id]: e.target.value })}
                      className="input-dark"
                      style={{ padding: '6px 10px' }}
                    />
                    <button
                      onClick={() => confirmarSugestao(s)}
                      disabled={bloqueado}
                      className="btn-primary"
                      style={{ padding: '6px 12px', fontSize: '12px', opacity: bloqueado ? 0.5 : 1 }}
                    >
                      Agendar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {aberto && (
        <div className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Próximos retornos</p>
            {agendados.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nenhum retorno agendado.</p>
            )}
            {agendados.map((r) => (
              <div key={r.id} className="rounded-lg p-3" style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {r.nome || r.telefone} · <strong>{dataBR(r.data_retorno)}</strong>
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {ORIGEM[r.origem]} · limite {dataBR(r.prazo_limite)}
                      {r.trecho ? ` · “${r.trecho.slice(0, 80)}”` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.excecao && r.excecao_status === 'solicitada' && (
                      <>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--warning)', color: 'white' }}>
                          Exceção solicitada
                        </span>
                        <button
                          onClick={() => atualizar(r.id, { excecao_status: 'aprovada' }, 'Exceção aprovada')}
                          className="btn-primary"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                        >
                          Aprovar
                        </button>
                        <button
                          onClick={() => atualizar(r.id, { excecao_status: 'recusada' }, 'Exceção recusada: o retorno não será enviado')}
                          className="btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                        >
                          Recusar
                        </button>
                      </>
                    )}
                    {r.excecao && r.excecao_status === 'aprovada' && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--success)', color: 'white' }}>
                        Exceção aprovada
                      </span>
                    )}
                    {r.excecao && r.excecao_status === 'recusada' && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--text-muted)', color: 'white' }}>
                        Exceção recusada
                      </span>
                    )}
                    <button onClick={() => cancelar(r)} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {historico.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Histórico (30 dias)</p>
              {historico.map((r) => (
                <div key={r.id} className="rounded-lg p-2" style={{ border: '1px solid var(--border-subtle)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {r.nome || r.telefone} · {dataBR(r.data_retorno)} ·{' '}
                    {r.status === 'enviado' ? 'Enviado' : r.status === 'erro' ? `Erro (${r.motivo})` : `Cancelado (${r.motivo})`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
