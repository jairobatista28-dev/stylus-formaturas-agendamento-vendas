import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Play, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * ENVIO SEGURO DAS CAMPANHAS
 * Abertura em dois passos, SAIR, limite diario com aquecimento, horario
 * comercial e pausa automatica quando os envios comecam a falhar.
 * A regra e aplicada no servidor (campaign-dispatcher); aqui so configura e mostra.
 */

interface EnvioConfig {
  abertura_ativa: boolean;
  abertura_venda: string;
  abertura_agendamento: string;
  incluir_sair: boolean;
  texto_sair: string;
  resposta_sair: string;
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
  pausado_motivo: string | null;
  pausado_em: string | null;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function limiteDeHoje(cfg: EnvioConfig): { limite: number; semana: number } {
  const inicio = new Date(`${cfg.aquecimento_inicio}T00:00:00Z`).getTime();
  const semanas = Math.max(0, Math.floor((Date.now() - inicio) / (7 * 86400000)));
  return { limite: Math.min(cfg.limite_maximo, cfg.limite_inicial + semanas * cfg.incremento_semanal), semana: semanas + 1 };
}

function inicioDoDiaUTC(fuso: string): string {
  const agora = new Date();
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(agora)) p[x.type] = x.value;
  const localComoUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  const offset = localComoUTC - Math.floor(agora.getTime() / 60000) * 60000;
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - offset).toISOString();
}

export function EnvioSeguroPanel({ onToast }: { onToast: (msg: string, tipo: 'success' | 'error') => void }) {
  const [cfg, setCfg] = useState<EnvioConfig | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviadosHoje, setEnviadosHoje] = useState<number | null>(null);
  const [aguardandoResposta, setAguardandoResposta] = useState<number | null>(null);
  const [optouts, setOptouts] = useState<number | null>(null);

  async function carregar() {
    const { data, error } = await supabase.from('envio_config').select('*').eq('id', 1).maybeSingle();
    if (error || !data) {
      setErro('Rode a migration 20261103120000_envio_seguro no banco para ativar o envio seguro.');
      return;
    }
    setErro(null);
    setCfg(data as EnvioConfig);
    const [hoje, aguardando, saiu] = await Promise.all([
      supabase.from('contatos_campanha').select('id', { count: 'exact', head: true }).gte('primeiro_envio_em', inicioDoDiaUTC(data.fuso)),
      supabase.from('contatos_campanha').select('id', { count: 'exact', head: true }).eq('abertura_status', 'enviada'),
      supabase.from('optout').select('telefone', { count: 'exact', head: true }),
    ]);
    setEnviadosHoje(hoje.count ?? 0);
    setAguardandoResposta(aguardando.count ?? 0);
    setOptouts(saiu.count ?? 0);
  }

  useEffect(() => {
    carregar();
    const t = setInterval(() => !document.hidden && carregar(), 60000);
    return () => clearInterval(t);
  }, []);

  async function salvar(parcial: Partial<EnvioConfig>, msg = 'Configuração salva') {
    if (!cfg) return;
    const novo = { ...cfg, ...parcial };
    if (novo.hora_fim <= novo.hora_inicio) {
      onToast('O horário final precisa ser depois do inicial', 'error');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('envio_config')
      .update({
        abertura_ativa: novo.abertura_ativa,
        abertura_venda: novo.abertura_venda,
        abertura_agendamento: novo.abertura_agendamento,
        incluir_sair: novo.incluir_sair,
        texto_sair: novo.texto_sair,
        resposta_sair: novo.resposta_sair,
        limite_inicial: Math.max(1, novo.limite_inicial),
        incremento_semanal: Math.max(0, novo.incremento_semanal),
        limite_maximo: Math.max(novo.limite_inicial, novo.limite_maximo),
        aquecimento_inicio: novo.aquecimento_inicio,
        hora_inicio: novo.hora_inicio,
        hora_fim: novo.hora_fim,
        dias_semana: novo.dias_semana,
        falhas_para_pausar: Math.max(1, novo.falhas_para_pausar),
        falhas_seguidas: novo.falhas_seguidas,
        pausado: novo.pausado,
        pausado_motivo: novo.pausado_motivo,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', 1);
    setSalvando(false);
    if (error) {
      onToast('Erro ao salvar: ' + error.message, 'error');
      return;
    }
    setCfg(novo);
    onToast(msg, 'success');
  }

  if (erro) {
    return (
      <div className="rounded-xl p-4 mb-6 text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
        {erro}
      </div>
    );
  }
  if (!cfg) return null;

  const { limite, semana } = limiteDeHoje(cfg);
  const dias = [...cfg.dias_semana].sort().map((d) => DIAS[d]).join(', ');

  const campoNum = (rotulo: string, chave: keyof EnvioConfig, sufixo?: string) => (
    <label className="block">
      <span className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={cfg[chave] as number}
          onChange={(e) => setCfg({ ...cfg, [chave]: Number(e.target.value) })}
          className="input-dark w-full"
        />
        {sufixo && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sufixo}</span>}
      </div>
    </label>
  );

  return (
    <div className="rounded-xl p-4 mb-6" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}>
      {cfg.pausado && (
        <div className="rounded-lg p-3 mb-3 flex flex-col md:flex-row md:items-center gap-3" style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
          <AlertTriangle size={18} style={{ color: '#EF4444' }} className="flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: '#EF4444' }}>Disparos pausados automaticamente</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {cfg.pausado_motivo || 'Vários envios seguidos falharam.'} Confira se o WhatsApp está conectado antes de retomar.
            </p>
          </div>
          <button
            className="btn-primary"
            disabled={salvando}
            onClick={() => salvar({ pausado: false, pausado_motivo: null, falhas_seguidas: 0 }, 'Disparos retomados')}
          >
            <Play size={14} />
            Retomar disparos
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: cfg.pausado ? 'var(--bg-surface-raised)' : 'var(--success)' }}>
            <ShieldCheck size={18} style={{ color: cfg.pausado ? 'var(--text-muted)' : 'white' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Envio seguro</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Hoje: {enviadosHoje ?? '-'} de {limite} primeiros contatos · {dias}, {cfg.hora_inicio}h às {cfg.hora_fim}h · aquecimento semana {semana}
              {cfg.abertura_ativa && aguardandoResposta !== null && <> · {aguardandoResposta} aguardando resposta da abertura</>}
              {optouts !== null && <> · {optouts} pediram para sair</>}
            </p>
          </div>
        </div>
        <button onClick={() => setAberto(!aberto)} className="btn-secondary" style={{ fontSize: '12px' }}>
          {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Configurar
        </button>
      </div>

      {aberto && (
        <div className="mt-4 space-y-5">
          {/* Abertura */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={cfg.abertura_ativa} onChange={(e) => setCfg({ ...cfg, abertura_ativa: e.target.checked })} />
              Abertura em dois passos
            </label>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              O formando recebe primeiro só esta mensagem curta. A mensagem completa da campanha sai quando ele responder.
              Use {'{primeiro_nome}'} e {'{curso}'}. Com a abertura ativa, tire o "Oi, tudo bem?" do começo da mensagem da campanha.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Abertura - venda de fotos</span>
                <textarea rows={3} value={cfg.abertura_venda} onChange={(e) => setCfg({ ...cfg, abertura_venda: e.target.value })} className="input-dark w-full" style={{ resize: 'vertical' }} />
              </label>
              <label className="block">
                <span className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Abertura - agendamento</span>
                <textarea rows={3} value={cfg.abertura_agendamento} onChange={(e) => setCfg({ ...cfg, abertura_agendamento: e.target.value })} className="input-dark w-full" style={{ resize: 'vertical' }} />
              </label>
            </div>
          </div>

          {/* SAIR */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={cfg.incluir_sair} onChange={(e) => setCfg({ ...cfg, incluir_sair: e.target.checked })} />
              Oferecer a opção SAIR na primeira mensagem
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Frase do SAIR</span>
                <input value={cfg.texto_sair} onChange={(e) => setCfg({ ...cfg, texto_sair: e.target.value })} className="input-dark w-full" />
              </label>
              <label className="block">
                <span className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Resposta para quem pedir para sair</span>
                <input value={cfg.resposta_sair} onChange={(e) => setCfg({ ...cfg, resposta_sair: e.target.value })} className="input-dark w-full" />
              </label>
            </div>
          </div>

          {/* Volume */}
          <div className="space-y-2">
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Volume e horário</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {campoNum('Começar com', 'limite_inicial', '/dia')}
              {campoNum('Aumentar por semana', 'incremento_semanal', '/dia')}
              {campoNum('Limite máximo', 'limite_maximo', '/dia')}
              {campoNum('Pausar após falhas seguidas', 'falhas_para_pausar')}
              {campoNum('Das', 'hora_inicio', 'h')}
              {campoNum('Até', 'hora_fim', 'h')}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DIAS.map((d, i) => {
                const marcado = cfg.dias_semana.includes(i);
                return (
                  <button
                    key={d}
                    onClick={() => setCfg({ ...cfg, dias_semana: marcado ? cfg.dias_semana.filter((x) => x !== i) : [...cfg.dias_semana, i] })}
                    className="px-2.5 py-1 text-xs rounded-md"
                    style={{
                      backgroundColor: marcado ? 'var(--accent-primary)' : 'transparent',
                      color: marcado ? 'white' : 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              O limite vale só para o primeiro contato de cada formando. Respostas e a continuação da conversa não entram na conta.
              Aquecimento começou em {cfg.aquecimento_inicio.split('-').reverse().join('/')}.{' '}
              <button
                className="underline"
                onClick={() => salvar({ aquecimento_inicio: new Date().toLocaleDateString('en-CA') }, 'Aquecimento reiniciado a partir de hoje')}
              >
                Reiniciar aquecimento
              </button>
            </p>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={salvando} onClick={() => salvar({})}>
              {salvando && <Loader2 size={14} className="animate-spin" />}
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
