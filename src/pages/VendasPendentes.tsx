import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Copy, ExternalLink, ShoppingCart } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { ResgatePanel } from '../components/ResgatePanel';
import { RetornosPanel, agendarRetornoManual } from '../components/RetornosPanel';

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
  quantidade_fotos: string | null;
  cpf: string | null;
  email: string | null;
  dados_confirmados_em: string | null;
  status: string;
  link_pagamento_enviado: boolean;
  atualizado_em: string;
  campanha_id: string;
}

function formatarValor(valor: string | null): string {
  if (valor == null || String(valor).trim() === '') return 'Valor sob consulta';
  const v = String(valor).trim();
  // Importacoes antigas gravaram moeda no formato americano ("R$ 1,500.00")
  const us = v.match(/^R\$\s*([\d,]+)\.(\d{2})$/);
  if (us) return `R$ ${us[1].replace(/,/g, '.')},${us[2]}`;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return v;
}

export function VendasPendentes() {
  const { toasts, showToast, removeToast } = useToast();
  const [vendas, setVendas] = useState<VendaPendente[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'pendentes' | 'concluidas' | 'todas'>('pendentes');
  const [retornoAberto, setRetornoAberto] = useState<string | null>(null);
  const [dataRetorno, setDataRetorno] = useState('');
  const [retornosPorContato, setRetornosPorContato] = useState<Record<string, string>>({});
  const [chaveRetornos, setChaveRetornos] = useState(0);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setLoading(true);
    const { data, error } = await supabase
      .from('contatos_campanha')
      .select(
        'id, nome, telefone, numero_contrato, valor_tabela, valor_oferecido, plano_escolhido, forma_pagamento_escolhida, formas_pagamento, opcoes_plano, quantidade_fotos, cpf, email, dados_confirmados_em, status, link_pagamento_enviado, atualizado_em, campanha_id'
      )
      .in('status', ['confirmando_dados', 'compra_futura', 'interessado_compra', 'comprou'])
      .order('atualizado_em', { ascending: false });

    const { data: rets } = await supabase
      .from('retornos_agendados')
      .select('contato_campanha_id, data_retorno')
      .eq('status', 'agendado');
    const mapa: Record<string, string> = {};
    (rets || []).forEach((r: { contato_campanha_id: string; data_retorno: string }) => (mapa[r.contato_campanha_id] = r.data_retorno));
    setRetornosPorContato(mapa);

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

  async function confirmarRetorno(id: string) {
    if (!dataRetorno) {
      showToast('Escolha a data do retorno', 'error');
      return;
    }
    const r = await agendarRetornoManual(id, dataRetorno, 'manual');
    showToast(r.mensagem, r.ok ? 'success' : 'error');
    if (r.ok) {
      setRetornoAberto(null);
      setDataRetorno('');
      setChaveRetornos((k) => k + 1);
      carregar();
    }
  }

  function copiarTexto(texto: string, rotulo: string) {
    navigator.clipboard.writeText(texto);
    showToast(`${rotulo} copiado`, 'success');
  }

  function abrirWhatsapp(telefone: string) {
    const numero = telefone.replace(/\D/g, '');
    window.open(`https://wa.me/${numero}`, '_blank');
  }

  const vendasFiltradas = vendas.filter((v) => {
    if (filtro === 'pendentes') return ['interessado_compra', 'confirmando_dados', 'compra_futura'].includes(v.status);
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

      <ResgatePanel onToast={showToast} />
      <RetornosPanel onToast={showToast} atualizarChave={chaveRetornos} />

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
                    {v.status === 'compra_futura' && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ backgroundColor: 'var(--info)', color: 'white' }}
                      >
                        <CalendarClock size={12} /> Compra programada
                        {retornosPorContato[v.id] ? ` · ${retornosPorContato[v.id].split('-').reverse().join('/')}` : ''}
                      </span>
                    )}
                    {v.status === 'confirmando_dados' && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--warning)', color: 'white' }}
                        title="O formando escolheu a opcao e a IA esta conferindo CPF e e-mail"
                      >
                        Conferindo dados
                      </span>
                    )}
                    {v.status === 'interessado_compra' && v.dados_confirmados_em && !v.link_pagamento_enviado && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--success)', color: 'white' }}
                      >
                        Pronto para o link
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
                    {v.quantidade_fotos ? ` · ${v.quantidade_fotos} fotos` : ''}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      CPF {v.dados_confirmados_em ? '(confirmado)' : '(nao confirmado)'}
                    </p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{v.cpf || '-'}</p>
                  </div>
                  {v.cpf && (
                    <button onClick={() => copiarTexto(v.cpf as string, 'CPF')} className="btn-icon" style={{ padding: '6px' }} title="Copiar CPF">
                      <Copy size={14} />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      E-mail {v.dados_confirmados_em ? '(confirmado)' : '(nao confirmado)'}
                    </p>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{v.email || '-'}</p>
                  </div>
                  {v.email && (
                    <button onClick={() => copiarTexto(v.email as string, 'E-mail')} className="btn-icon" style={{ padding: '6px' }} title="Copiar e-mail">
                      <Copy size={14} />
                    </button>
                  )}
                </div>
              </div>

              {v.status !== 'comprou' && (
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {retornoAberto === v.id ? (
                    <>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Formando vai comprar em:</span>
                      <input
                        type="date"
                        value={dataRetorno}
                        onChange={(e) => setDataRetorno(e.target.value)}
                        className="input-dark"
                        style={{ padding: '6px 10px' }}
                      />
                      <button onClick={() => confirmarRetorno(v.id)} className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                        Agendar retorno
                      </button>
                      <button onClick={() => setRetornoAberto(null)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setRetornoAberto(v.id);
                        setDataRetorno(retornosPorContato[v.id] || '');
                      }}
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      title="O formando disse que vai comprar em outra data: a IA chama ele de volta nesse dia"
                    >
                      <CalendarClock size={14} /> {retornosPorContato[v.id] ? 'Alterar retorno' : 'Agendar retorno'}
                    </button>
                  )}
                </div>
              )}

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
