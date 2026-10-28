import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  CheckCheck,
  CreditCard,
  ImageOff,
  Loader2,
  MessageCircle,
  MicOff,
  ShieldAlert,
  Bot,
  Receipt,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * PAINEL DE ALERTAS
 * O que a IA e as rotinas automaticas fizeram de importante, para acompanhar
 * sem abrir os logs do Supabase. Atualiza em tempo real.
 */

interface Alerta {
  id: string;
  tipo: string;
  gravidade: 'info' | 'atencao' | 'erro';
  titulo: string;
  detalhe: string | null;
  contato_nome: string | null;
  telefone: string | null;
  lido: boolean;
  criado_em: string;
}

const TIPOS: Record<string, { rotulo: string; icone: typeof AlertTriangle }> = {
  venda_pronta: { rotulo: 'Vendas prontas', icone: CreditCard },
  comprovante: { rotulo: 'Comprovantes', icone: Receipt },
  foto_falhou: { rotulo: 'Fotos não enviadas', icone: ImageOff },
  audio_falhou: { rotulo: 'Áudios não transcritos', icone: MicOff },
  agendamento_conferir: { rotulo: 'Agendamentos a conferir', icone: CalendarCheck },
  trava_escolha: { rotulo: 'Travas de escolha', icone: ShieldAlert },
  ia_sem_resposta: { rotulo: 'IA sem resposta', icone: Bot },
};

const CORES = {
  erro: { cor: '#EF4444', fundo: 'rgba(239, 68, 68, 0.12)' },
  atencao: { cor: '#F59E0B', fundo: 'rgba(245, 158, 11, 0.12)' },
  info: { cor: '#3B82F6', fundo: 'rgba(59, 130, 246, 0.12)' },
};

function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem, ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${hora}`;
}

export function Alertas() {
  const navigate = useNavigate();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [soNaoLidos, setSoNaoLidos] = useState(true);
  const [tipo, setTipo] = useState<string>('todos');

  async function carregar() {
    const { data, error } = await supabase
      .from('alertas_sistema')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(500);
    if (error) {
      setErro(
        error.message.includes('alertas_sistema')
          ? 'A tabela de alertas ainda não existe. Rode a migration 20261101120000_alertas_sistema no bolt.'
          : 'Não foi possível carregar os alertas: ' + error.message
      );
    } else {
      setErro(null);
      setAlertas((data || []) as Alerta[]);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    const canal = supabase
      .channel('alertas-painel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alertas_sistema' }, (p) => {
        setAlertas((atual) => [p.new as Alerta, ...atual.filter((a) => a.id !== (p.new as Alerta).id)]);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  const visiveis = useMemo(
    () => alertas.filter((a) => (!soNaoLidos || !a.lido) && (tipo === 'todos' || a.tipo === tipo)),
    [alertas, soNaoLidos, tipo]
  );

  const contagem = useMemo(() => {
    const m: Record<string, number> = {};
    alertas.filter((a) => !a.lido).forEach((a) => (m[a.tipo] = (m[a.tipo] || 0) + 1));
    return m;
  }, [alertas]);

  const totalNaoLidos = alertas.filter((a) => !a.lido).length;

  async function marcarLido(id: string) {
    setAlertas((atual) => atual.map((a) => (a.id === id ? { ...a, lido: true } : a)));
    await supabase.from('alertas_sistema').update({ lido: true }).eq('id', id);
  }

  async function marcarTodosLidos() {
    const ids = visiveis.filter((a) => !a.lido).map((a) => a.id);
    if (!ids.length) return;
    setAlertas((atual) => atual.map((a) => (ids.includes(a.id) ? { ...a, lido: true } : a)));
    for (let i = 0; i < ids.length; i += 100) {
      await supabase.from('alertas_sistema').update({ lido: true }).in('id', ids.slice(i, i + 100));
    }
  }

  function abrirConversa(a: Alerta) {
    if (!a.lido) marcarLido(a.id);
    navigate(`/whatsapp?tel=${encodeURIComponent(a.telefone || '')}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Alertas
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {totalNaoLidos
              ? `${totalNaoLidos} ${totalNaoLidos === 1 ? 'alerta pede' : 'alertas pedem'} sua atenção`
              : 'Tudo em dia. Novos alertas aparecem aqui automaticamente.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoNaoLidos(!soNaoLidos)}
            className="btn-secondary"
            style={{ fontSize: '12px' }}
          >
            {soNaoLidos ? 'Mostrar lidos também' : 'Só não lidos'}
          </button>
          <button onClick={marcarTodosLidos} className="btn-primary" style={{ fontSize: '12px' }} disabled={!visiveis.some((a) => !a.lido)}>
            <CheckCheck size={14} />
            Marcar como lidos
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTipo('todos')}
          className="px-3 py-1.5 text-xs font-medium rounded-md"
          style={{
            backgroundColor: tipo === 'todos' ? 'var(--bg-surface-raised)' : 'transparent',
            color: tipo === 'todos' ? 'var(--text-primary)' : 'var(--text-muted)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          Todos
        </button>
        {Object.entries(TIPOS).map(([chave, t]) => (
          <button
            key={chave}
            onClick={() => setTipo(chave)}
            className="px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5"
            style={{
              backgroundColor: tipo === chave ? 'var(--bg-surface-raised)' : 'transparent',
              color: tipo === chave ? 'var(--text-primary)' : 'var(--text-muted)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {t.rotulo}
            {contagem[chave] ? (
              <span className="tabular-nums" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {contagem[chave]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {erro && (
        <div className="card p-4 text-sm" style={{ color: '#EF4444' }}>
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="flex items-center justify-center py-24" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : visiveis.length === 0 && !erro ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {soNaoLidos ? 'Nenhum alerta pendente.' : 'Nenhum alerta registrado ainda.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {visiveis.map((a, i) => {
            const t = TIPOS[a.tipo] || { rotulo: a.tipo, icone: AlertTriangle };
            const c = CORES[a.gravidade] || CORES.info;
            const Icone = t.icone;
            return (
              <div
                key={a.id}
                className="flex gap-3 p-4"
                style={{
                  borderTop: i ? '1px solid var(--border-subtle)' : undefined,
                  opacity: a.lido ? 0.55 : 1,
                }}
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: c.fundo }}>
                  <Icone size={17} style={{ color: c.cor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {a.titulo}
                    </p>
                    {a.contato_nome && (
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {a.contato_nome}
                      </p>
                    )}
                    <span className="text-[11px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                      {quando(a.criado_em)}
                    </span>
                  </div>
                  {a.detalhe && (
                    <p className="text-xs mt-1 break-words" style={{ color: 'var(--text-muted)' }}>
                      {a.detalhe}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    {a.telefone && (
                      <button onClick={() => abrirConversa(a)} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }}>
                        <MessageCircle size={12} />
                        Abrir conversa
                      </button>
                    )}
                    {!a.lido && (
                      <button onClick={() => marcarLido(a.id)} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }}>
                        <Check size={12} />
                        Marcar como lido
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
