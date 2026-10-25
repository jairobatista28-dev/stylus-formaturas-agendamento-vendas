import { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Eye, RefreshCw, Save, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ResgateConfig {
  id: number;
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
}

interface ResgateEnvio {
  id: string;
  nome: string | null;
  telefone: string;
  data_ref: string;
  agendado_para: string;
  variante: number | null;
  status: 'agendado' | 'enviado' | 'cancelado' | 'erro';
  motivo: string | null;
  mensagem: string | null;
  prazo_prorrogado: string | null;
  enviado_em: string | null;
}

interface Candidato {
  nome: string;
  telefone: string;
  status: string;
  ultima_interacao: string | null;
  prazo_original: string | null;
  prazo_prorrogado: string | null;
  elegivel: boolean;
  motivo: string | null;
  previa: string | null;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const MOTIVOS: Record<string, string> = {
  vendido: 'Marcado como vendido',
  atendimento_manual: 'Em atendimento manual',
  conversa_recente: 'Respondeu recentemente',
  ja_resgatado: 'Ja recebeu resgate',
  fora_do_horario: 'Fora do horario (sera replanejado)',
  prazo_prorrogado_ja_vencido: 'Prazo prorrogado ja venceu',
  prazo_da_planilha_invalido: 'Prazo da planilha invalido',
  contato_removido: 'Contato removido',
};

function dataBR(iso: string | null): string {
  if (!iso) return '-';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function horaLocal(iso: string, fuso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso });
}

function hojeNoFuso(fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function motivoLegivel(m: string | null): string {
  if (!m) return '';
  if (m.startsWith('status_')) return `Status mudou (${m.replace('status_', '')})`;
  return MOTIVOS[m] || m;
}

const statusStyle: Record<ResgateEnvio['status'], { bg: string; label: string }> = {
  agendado: { bg: 'var(--info)', label: 'Agendado' },
  enviado: { bg: 'var(--success)', label: 'Enviado' },
  cancelado: { bg: 'var(--text-muted)', label: 'Cancelado' },
  erro: { bg: 'var(--error, #EF4444)', label: 'Erro' },
};

export function ResgatePanel({ onToast }: { onToast: (msg: string, tipo: 'success' | 'error') => void }) {
  const [cfg, setCfg] = useState<ResgateConfig | null>(null);
  const [envios, setEnvios] = useState<ResgateEnvio[]>([]);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [carregandoCand, setCarregandoCand] = useState(false);
  const [mensagemAberta, setMensagemAberta] = useState<string | null>(null);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    const { data: c, error } = await supabase.from('resgate_config').select('*').eq('id', 1).maybeSingle();
    if (error) {
      console.error('[Resgate] config:', error);
      return;
    }
    setCfg(c as ResgateConfig);

    const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data: e } = await supabase
      .from('resgate_envios')
      .select('*')
      .gte('data_ref', seteDiasAtras)
      .order('agendado_para', { ascending: false })
      .limit(100);
    setEnvios((e || []) as ResgateEnvio[]);
  }

  async function salvar(parcial?: Partial<ResgateConfig>) {
    if (!cfg) return;
    const novo = { ...cfg, ...parcial };
    if (novo.hora_fim <= novo.hora_inicio) {
      onToast('O horario final precisa ser depois do inicial', 'error');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('resgate_config')
      .update({
        ativo: novo.ativo,
        limite_diario: Math.max(1, Math.min(50, novo.limite_diario)),
        janela_dias: novo.janela_dias,
        silencio_minimo_dias: novo.silencio_minimo_dias,
        dias_prorrogacao: novo.dias_prorrogacao,
        base_prorrogacao: novo.base_prorrogacao,
        hora_inicio: novo.hora_inicio,
        hora_fim: novo.hora_fim,
        dias_semana: novo.dias_semana,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', 1);
    setSalvando(false);
    if (error) {
      onToast('Erro ao salvar: ' + error.message, 'error');
      return;
    }
    setCfg(novo);
    onToast(parcial && 'ativo' in parcial ? (novo.ativo ? 'Resgate automatico ATIVADO' : 'Resgate automatico pausado') : 'Configuracao salva', 'success');
  }

  async function verCandidatos() {
    setCarregandoCand(true);
    const { data, error } = await supabase.functions.invoke('resgate-vendas', { body: { acao: 'simular' } });
    setCarregandoCand(false);
    if (error || !data?.success) {
      onToast('Erro ao buscar candidatos', 'error');
      return;
    }
    setCandidatos(data.candidatos as Candidato[]);
  }

  if (!cfg) return null;

  const hoje = hojeNoFuso(cfg.fuso);
  const deHoje = envios.filter((e) => e.data_ref === hoje).sort((a, b) => a.agendado_para.localeCompare(b.agendado_para));
  const enviadosHoje = deHoje.filter((e) => e.status === 'enviado').length;
  const agendadosHoje = deHoje.filter((e) => e.status === 'agendado').length;
  const enviados7d = envios.filter((e) => e.status === 'enviado').length;

  const campoNum = (label: string, chave: keyof ResgateConfig, min: number, max: number, sufixo?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          value={cfg[chave] as number}
          onChange={(e) => setCfg({ ...cfg, [chave]: Number(e.target.value) })}
          className="input-dark"
          style={{ width: 84, padding: '6px 10px' }}
        />
        {sufixo && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sufixo}</span>}
      </div>
    </label>
  );

  return (
    <div className="rounded-xl p-4" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: cfg.ativo ? 'var(--success)' : 'var(--bg-surface-raised)' }}
          >
            <Zap size={18} style={{ color: cfg.ativo ? 'white' : 'var(--text-muted)' }} />
          </div>
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Resgate automático {cfg.ativo ? '· ativo' : '· pausado'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Hoje: {enviadosHoje} enviados · {agendadosHoje} agendados (limite {cfg.limite_diario}/dia) · {enviados7d} nos últimos 7 dias
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => carregar()} className="btn-icon" style={{ padding: '6px' }} title="Atualizar">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => salvar({ ativo: !cfg.ativo })}
            disabled={salvando}
            className={cfg.ativo ? 'btn-secondary' : 'btn-primary'}
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            {cfg.ativo ? 'Pausar' : 'Ativar'}
          </button>
          <button onClick={() => setAberto(!aberto)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
            Detalhes {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {aberto && (
        <div className="mt-4 pt-4 space-y-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {/* Configuracao */}
          <div className="space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Regras</p>
            <div className="flex flex-wrap gap-4">
              {campoNum('Abordagens por dia', 'limite_diario', 1, 50)}
              {campoNum('Interesse nos últimos', 'janela_dias', 1, 120, 'dias')}
              {campoNum('Sem conversa há pelo menos', 'silencio_minimo_dias', 0, 30, 'dias')}
              {campoNum('Prorrogação', 'dias_prorrogacao', 1, 120, 'dias')}
              {campoNum('Das', 'hora_inicio', 6, 22, 'h')}
              {campoNum('Até', 'hora_fim', 7, 23, 'h')}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Novo prazo contado a partir de</span>
              <select
                value={cfg.base_prorrogacao}
                onChange={(e) => setCfg({ ...cfg, base_prorrogacao: e.target.value as ResgateConfig['base_prorrogacao'] })}
                className="input-dark"
                style={{ maxWidth: 420, padding: '6px 10px' }}
              >
                <option value="prazo_planilha">Prazo da planilha + {cfg.dias_prorrogacao} dias</option>
                <option value="data_resgate">Data em que o formando recebe a mensagem + {cfg.dias_prorrogacao} dias</option>
              </select>
            </label>

            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs mr-1" style={{ color: 'var(--text-muted)' }}>Dias da semana:</span>
              {DIAS.map((d, i) => {
                const marcado = cfg.dias_semana.includes(i);
                return (
                  <button
                    key={d}
                    onClick={() =>
                      setCfg({
                        ...cfg,
                        dias_semana: marcado ? cfg.dias_semana.filter((x) => x !== i) : [...cfg.dias_semana, i].sort(),
                      })
                    }
                    className="px-2 py-1 text-xs rounded-md"
                    style={{
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: marcado ? 'var(--bg-surface-raised)' : 'transparent',
                      color: marcado ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>

            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Horários no fuso {cfg.fuso}. Nunca recebem resgate: vendidos, quem disse que não tem interesse,
              transferidos para humano, quem já está com o especialista aguardando o link e contatos em modo manual.
              Cada formando recebe no máximo uma abordagem de resgate.
            </p>

            <div className="flex gap-2">
              <button onClick={() => salvar()} disabled={salvando} className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                <Save size={14} /> Salvar regras
              </button>
              <button onClick={verCandidatos} disabled={carregandoCand} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                <Eye size={14} /> {carregandoCand ? 'Buscando...' : 'Ver quem será resgatado'}
              </button>
            </div>
          </div>

          {/* Candidatos */}
          {candidatos && (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Candidatos: {candidatos.filter((c) => c.elegivel).length} elegíveis de {candidatos.length}
              </p>
              {candidatos.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nenhum formando se encaixa nas regras agora.</p>
              )}
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {candidatos.map((c) => (
                  <div key={c.telefone} className="rounded-lg p-2" style={{ border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{c.nome}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {c.status === 'confirmando_dados' ? 'Parou na conferência de dados' : 'Conversou e não fechou'} ·
                          última interação {c.ultima_interacao ? new Date(c.ultima_interacao).toLocaleDateString('pt-BR') : '-'} ·
                          {c.elegivel ? ` novo prazo ${dataBR(c.prazo_prorrogado)}` : ` ${motivoLegivel(c.motivo)}`}
                        </p>
                      </div>
                      {c.previa && (
                        <button
                          onClick={() => setMensagemAberta(mensagemAberta === c.telefone ? null : c.telefone)}
                          className="btn-icon"
                          style={{ padding: '6px' }}
                          title="Ver prévia da mensagem"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                    </div>
                    {mensagemAberta === c.telefone && c.previa && (
                      <p className="text-xs mt-2 whitespace-pre-line p-2 rounded" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-raised)' }}>
                        {c.previa}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agenda / historico */}
          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <CalendarClock size={14} /> Abordagens (últimos 7 dias)
            </p>
            {envios.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Nenhuma abordagem ainda. Com o resgate ativo, a agenda do dia é montada automaticamente dentro do horário configurado.
              </p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {envios.map((e) => (
                  <div key={e.id} className="rounded-lg p-2" style={{ border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{e.nome || e.telefone}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {dataBR(e.data_ref)} às {horaLocal(e.enviado_em || e.agendado_para, cfg.fuso)} · abordagem {(e.variante ?? 0) + 1} ·
                          prazo {dataBR(e.prazo_prorrogado)}
                          {e.motivo ? ` · ${motivoLegivel(e.motivo)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: statusStyle[e.status].bg, color: 'white' }}>
                          {statusStyle[e.status].label}
                        </span>
                        {e.mensagem && (
                          <button
                            onClick={() => setMensagemAberta(mensagemAberta === e.id ? null : e.id)}
                            className="btn-icon"
                            style={{ padding: '6px' }}
                            title="Ver mensagem enviada"
                          >
                            <Eye size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {mensagemAberta === e.id && e.mensagem && (
                      <p className="text-xs mt-2 whitespace-pre-line p-2 rounded" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-raised)' }}>
                        {e.mensagem}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
