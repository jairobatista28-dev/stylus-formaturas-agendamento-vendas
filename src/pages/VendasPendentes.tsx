import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, ShoppingCart } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';

interface VendaPendente {
  id: string;
  nome: string;
  telefone: string;
  numero_contrato: string | null;
  valor_tabela: string | null;
  valor_oferecido: string | null;
  plano_escolhido: string | null;
  forma_pagamento_escolhida: string | null;
  formas_pagamento: string | null;
  opcoes_plano: string | null;
  status: string;
  link_pagamento_enviado: boolean;
  atualizado_em: string;
  campanha_id: string;
}

function formatarValor(valor: string | null): string {
  if (valor == null || valor.trim() === '') return 'Valor sob consulta';
  return valor;
}

export function VendasPendentes() {
  const { toasts, showToast, removeToast } = useToast();
  const [vendas, setVendas] = useState<VendaPendente[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'pendentes' | 'concluidas' | 'todas'>('pendentes');

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setLoading(true);
    const { data, error } = await supabase
      .from('contatos_campanha')
      .select(
        'id, nome, telefone, numero_contrato, valor_tabela, valor_oferecido, plano_escolhido, forma_pagamento_escolhida, formas_pagamento, opcoes_plano, status, link_pagamento_enviado, atualizado_em, campanha_id'
      )
      .in('status', ['interessado_compra', 'comprou'])
      .order('atualizado_em', { ascending: false });

    if (error) {
      console.error('[VendasPendentes] Erro ao carregar:', error);
      showToast('Erro ao carregar vendas pendentes', 'error');
    } else {
      setVendas((data || []) as VendaPendente[]);
    }
    setLoading(false);
  }

  async function marcarLinkEnviado(id: string) {
    const { error } = await supabase
      .from('contatos_campanha')
      .update({ link_pagamento_enviado: true })
      .eq('id', id);

    if (error) {
      showToast('Erro ao atualizar', 'error');
      return;
    }
    setVendas((atual) => atual.map((v) => (v.id === id ? { ...v, link_pagamento_enviado: true } : v)));
    showToast('Marcado como link enviado', 'success');
  }

  async function marcarComoConcluida(id: string) {
    const { error } = await supabase
      .from('contatos_campanha')
      .update({ status: 'comprou' })
      .eq('id', id);

    if (error) {
      showToast('Erro ao atualizar', 'error');
      return;
    }
    setVendas((atual) => atual.map((v) => (v.id === id ? { ...v, status: 'comprou' } : v)));
    showToast('Venda marcada como concluida!', 'success');
  }

  function copiarTelefone(telefone: string) {
    navigator.clipboard.writeText(telefone);
    showToast('Telefone copiado', 'success');
  }

  function abrirWhatsapp(telefone: string) {
    const numero = telefone.replace(/\D/g, '');
    window.open(`https://wa.me/${numero}`, '_blank');
  }

  const vendasFiltradas = vendas.filter((v) => {
    if (filtro === 'pendentes') return v.status === 'interessado_compra';
    if (filtro === 'concluidas') return v.status === 'comprou';
    return true;
  });

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Vendas Pendentes
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Formandos que confirmaram interesse de compra e aguardam o link de pagamento
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {(['pendentes', 'concluidas', 'todas'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            style={{
              backgroundColor: filtro === f ? 'var(--bg-surface-raised)' : 'transparent',
              color: filtro === f ? 'var(--text-primary)' : 'var(--text-muted)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>
      ) : vendasFiltradas.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
        >
          <ShoppingCart size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Nenhuma venda nesse filtro ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {vendasFiltradas.map((v) => (
            <div
              key={v.id}
              className="rounded-xl p-4"
              style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {v.nome}
                    </span>
                    {v.status === 'comprou' && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ backgroundColor: 'var(--success)', color: 'white' }}
                      >
                        <CheckCircle2 size={12} /> Concluida
                      </span>
                    )}
                    {v.status === 'interessado_compra' && v.link_pagamento_enviado && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--info)', color: 'white' }}
                      >
                        Link ja enviado
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Contrato: {v.numero_contrato || '-'} · {v.telefone}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => abrirWhatsapp(v.telefone)}
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                    title="Abrir conversa no WhatsApp Web"
                  >
                    <ExternalLink size={14} /> WhatsApp
                  </button>
                  <button
                    onClick={() => copiarTelefone(v.telefone)}
                    className="btn-icon"
                    style={{ padding: '6px' }}
                    title="Copiar telefone"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Valor de tabela</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{formatarValor(v.valor_tabela)}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Valor oferecido</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatarValor(v.valor_oferecido)}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Plano escolhido</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{v.plano_escolhido || v.opcoes_plano || '-'}</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pagamento escolhido</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{v.forma_pagamento_escolhida || v.formas_pagamento || '-'}</p>
                </div>
              </div>

              {v.status === 'interessado_compra' && (
                <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {!v.link_pagamento_enviado && (
                    <button
                      onClick={() => marcarLinkEnviado(v.id)}
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                      Marcar link como enviado
                    </button>
                  )}
                  <button
                    onClick={() => marcarComoConcluida(v.id)}
                    className="btn-primary"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                  >
                    <CheckCircle2 size={14} /> Marcar venda como concluida
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
