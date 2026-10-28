import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * FUNIL DE VENDAS - material fotografico
 * Mostra, por campanha de venda, quantos formandos passaram por cada etapa,
 * onde a venda esta sendo perdida, o efeito da foto do formando e qual
 * abordagem de resgate (prorrogacao) converte mais.
 */

interface Linha {
  id: string;
  campanha_id: string;
  status: string | null;
  interagiu_em: string | null;
  plano_escolhido: string | null;
  dados_confirmados_em: string | null;
  foto_enviada_em: string | null;
  resgate_enviado_em: string | null;
  resgate_variante: number | null;
  valor_oferecido: number | string | null;
}

interface Campanha {
  id: string;
  nome: string;
}

const STATUS_RESPONDEU = ['em_conversa', 'confirmando_dados', 'compra_futura', 'interessado_compra', 'comprou', 'sem_interesse', 'transferido_humano'];
const STATUS_ESCOLHEU = ['confirmando_dados', 'interessado_compra', 'comprou'];
const STATUS_NAO_ABORDADO = ['pendente', 'aguardando_inicio', 'erro'];

const abordado = (l: Linha) => !STATUS_NAO_ABORDADO.includes(l.status || 'pendente');
const respondeu = (l: Linha) => !!l.interagiu_em || STATUS_RESPONDEU.includes(l.status || '');
const escolheu = (l: Linha) => !!l.plano_escolhido || STATUS_ESCOLHEU.includes(l.status || '');
const confirmou = (l: Linha) => !!l.dados_confirmados_em || l.status === 'comprou';
const vendeu = (l: Linha) => l.status === 'comprou';

function pct(parte: number, total: number): string {
  if (!total) return '0%';
  const v = (parte / total) * 100;
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;
}

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function valorNumerico(v: number | string | null): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const m = String(v).match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:\.\d+)?/);
  if (!m) return 0;
  return Number(m[0].includes(',') ? m[0].replace(/\./g, '').replace(',', '.') : m[0]) || 0;
}

export function FunilVendas() {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [campanhaSel, setCampanhaSel] = useState<string>('todas');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    setErro(null);

    const { data: camps, error: errCamps } = await supabase
      .from('campanhas')
      .select('id, nome')
      .eq('tipo_atendimento', 'venda_material')
      .order('criado_em', { ascending: false });
    if (errCamps) {
      setErro('Não foi possível carregar as campanhas: ' + errCamps.message);
      setCarregando(false);
      return;
    }
    setCampanhas((camps || []) as Campanha[]);

    // Contatos das campanhas de venda, em paginas de 1000
    const todas: Linha[] = [];
    const PAGINA = 1000;
    for (let inicio = 0; inicio < 100000; inicio += PAGINA) {
      const { data, error } = await supabase
        .from('contatos_campanha')
        .select('id, campanha_id, status, interagiu_em, plano_escolhido, dados_confirmados_em, foto_enviada_em, resgate_enviado_em, resgate_variante, valor_oferecido, campanhas!inner(tipo_atendimento)')
        .eq('campanhas.tipo_atendimento', 'venda_material')
        .order('id')
        .range(inicio, inicio + PAGINA - 1);
      if (error) {
        setErro('Não foi possível carregar os formandos: ' + error.message);
        break;
      }
      todas.push(...((data || []) as unknown as Linha[]));
      if (!data || data.length < PAGINA) break;
    }
    setLinhas(todas);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  const base = useMemo(
    () => (campanhaSel === 'todas' ? linhas : linhas.filter((l) => l.campanha_id === campanhaSel)),
    [linhas, campanhaSel]
  );

  const etapas = useMemo(() => {
    const total = base.length;
    const lista = [
      { nome: 'Na base', descricao: 'formandos importados na planilha', qtd: total },
      { nome: 'Abordados', descricao: 'receberam a primeira mensagem', qtd: base.filter(abordado).length },
      { nome: 'Responderam', descricao: 'interagiram com a IA', qtd: base.filter(respondeu).length },
      { nome: 'Escolheram a opção', descricao: 'definiram plano e pagamento', qtd: base.filter(escolheu).length },
      { nome: 'Dados conferidos', descricao: 'CPF e e-mail confirmados', qtd: base.filter(confirmou).length },
      { nome: 'Vendidos', descricao: 'pagamento concluído', qtd: base.filter(vendeu).length },
    ];
    return lista;
  }, [base]);

  const extras = useMemo(() => {
    const respondentes = base.filter(respondeu);
    const comFoto = respondentes.filter((l) => !!l.foto_enviada_em);
    const semFoto = respondentes.filter((l) => !l.foto_enviada_em);
    const vendidos = base.filter(vendeu);
    return {
      semInteresse: base.filter((l) => l.status === 'sem_interesse').length,
      compraFutura: base.filter((l) => l.status === 'compra_futura').length,
      aguardandoLink: base.filter((l) => l.status === 'interessado_compra').length,
      comEspecialista: base.filter((l) => l.status === 'transferido_humano').length,
      faturamento: vendidos.reduce((soma, l) => soma + valorNumerico(l.valor_oferecido), 0),
      foto: {
        com: comFoto.length,
        comVendas: comFoto.filter(vendeu).length,
        sem: semFoto.length,
        semVendas: semFoto.filter(vendeu).length,
      },
    };
  }, [base]);

  const abordagens = useMemo(() => {
    const mapa = new Map<number, { enviados: number; responderam: number; venderam: number }>();
    base
      .filter((l) => l.resgate_enviado_em && l.resgate_variante !== null && l.resgate_variante !== undefined)
      .forEach((l) => {
        const v = l.resgate_variante as number;
        const atual = mapa.get(v) || { enviados: 0, responderam: 0, venderam: 0 };
        atual.enviados++;
        if (l.interagiu_em && new Date(l.interagiu_em) > new Date(l.resgate_enviado_em as string)) atual.responderam++;
        if (vendeu(l)) atual.venderam++;
        mapa.set(v, atual);
      });
    const lista = [...mapa.entries()]
      .map(([variante, d]) => ({ variante, ...d, taxa: d.enviados ? d.venderam / d.enviados : 0 }))
      .sort((a, b) => a.variante - b.variante);
    const melhor = lista.filter((a) => a.enviados >= 5).sort((a, b) => b.taxa - a.taxa)[0];
    return { lista, melhor: melhor?.variante ?? null };
  }, [base]);

  const porCampanha = useMemo(() => {
    return campanhas
      .map((c) => {
        const ls = linhas.filter((l) => l.campanha_id === c.id);
        return {
          ...c,
          total: ls.length,
          responderam: ls.filter(respondeu).length,
          vendidos: ls.filter(vendeu).length,
        };
      })
      .filter((c) => c.total > 0);
  }, [campanhas, linhas]);

  const maior = etapas[0]?.qtd || 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Funil de Vendas
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Onde cada formando está na venda do material fotográfico e onde as vendas estão sendo perdidas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={campanhaSel}
            onChange={(e) => setCampanhaSel(e.target.value)}
            className="input-dark"
            style={{ minWidth: '220px' }}
          >
            <option value="todas">Todas as campanhas de venda</option>
            {campanhas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <button onClick={carregar} className="btn-secondary" disabled={carregando} title="Atualizar números">
            {carregando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Atualizar
          </button>
        </div>
      </div>

      {erro && (
        <div className="card p-4 text-sm" style={{ color: '#EF4444' }}>
          {erro}
        </div>
      )}

      {carregando && !linhas.length ? (
        <div className="flex items-center justify-center py-24" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : base.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Nenhum formando em campanhas de venda ainda. Importe uma planilha em Campanhas para o funil aparecer aqui.
        </div>
      ) : (
        <>
          {/* Funil */}
          <div className="card p-5">
            <div className="space-y-1">
              {etapas.map((etapa, i) => {
                const largura = Math.max(2, (etapa.qtd / maior) * 100);
                const anterior = i > 0 ? etapas[i - 1].qtd : null;
                const perdidos = anterior !== null ? anterior - etapa.qtd : 0;
                const ultima = i === etapas.length - 1;
                return (
                  <div key={etapa.nome}>
                    {anterior !== null && (
                      <div className="flex items-center gap-3 py-1 pl-[180px] max-md:pl-0">
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {pct(etapa.qtd, anterior)} seguiram
                          {perdidos > 0 && <> · {perdidos.toLocaleString('pt-BR')} ficaram na etapa anterior</>}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
                      <div className="md:w-[168px] flex-shrink-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {etapa.nome}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {etapa.descricao}
                        </p>
                      </div>
                      <div className="flex-1 flex items-center gap-3">
                        <div className="flex-1 h-9 rounded-md overflow-hidden" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
                          <div
                            className="h-full rounded-md flex items-center px-3 transition-all duration-500"
                            style={{
                              width: `${largura}%`,
                              backgroundColor: ultima ? '#3B82F6' : `rgba(59, 130, 246, ${0.22 + i * 0.1})`,
                            }}
                          />
                        </div>
                        <div className="w-[92px] text-right">
                          <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                            {etapa.qtd.toLocaleString('pt-BR')}
                          </span>
                          <span className="text-[11px] ml-1" style={{ color: 'var(--text-muted)' }}>
                            {pct(etapa.qtd, maior)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Situacao atual */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { rotulo: 'Faturamento dos vendidos', valor: moeda(extras.faturamento), cor: '#3B82F6' },
              { rotulo: 'Aguardando link de pagamento', valor: extras.aguardandoLink, cor: '#F59E0B' },
              { rotulo: 'Compra programada', valor: extras.compraFutura, cor: '#8B5CF6' },
              { rotulo: 'Com especialista', valor: extras.comEspecialista, cor: '#14B8A6' },
              { rotulo: 'Sem interesse', valor: extras.semInteresse, cor: '#EF4444' },
            ].map((c) => (
              <div key={c.rotulo} className="card p-4" style={{ borderLeft: `3px solid ${c.cor}` }}>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {c.rotulo}
                </p>
                <p className="text-lg font-semibold tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>
                  {typeof c.valor === 'number' ? c.valor.toLocaleString('pt-BR') : c.valor}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Efeito da foto */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Efeito da foto do formando
              </h2>
              <p className="text-xs mt-0.5 mb-4" style={{ color: 'var(--text-muted)' }}>
                Entre os formandos que responderam, quanto cada grupo comprou
              </p>
              {[
                { rotulo: 'Receberam foto', total: extras.foto.com, vendas: extras.foto.comVendas },
                { rotulo: 'Não receberam foto', total: extras.foto.sem, vendas: extras.foto.semVendas },
              ].map((g) => {
                const taxa = g.total ? (g.vendas / g.total) * 100 : 0;
                return (
                  <div key={g.rotulo} className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>{g.rotulo}</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {g.vendas} de {g.total} · <strong>{pct(g.vendas, g.total)}</strong>
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, taxa)}%`, backgroundColor: '#3B82F6' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Abordagens de resgate */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Abordagens de prorrogação
              </h2>
              <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--text-muted)' }}>
                Qual das mensagens de resgate traz mais respostas e vendas
              </p>
              {abordagens.lista.length === 0 ? (
                <p className="text-xs py-4" style={{ color: 'var(--text-muted)' }}>
                  Nenhuma mensagem de prorrogação enviada ainda.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th className="text-left font-medium py-1.5">Abordagem</th>
                        <th className="text-right font-medium py-1.5">Enviadas</th>
                        <th className="text-right font-medium py-1.5">Responderam</th>
                        <th className="text-right font-medium py-1.5">Venderam</th>
                      </tr>
                    </thead>
                    <tbody>
                      {abordagens.lista.map((a) => {
                        const destaque = a.variante === abordagens.melhor;
                        return (
                          <tr key={a.variante} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <td className="py-2" style={{ color: 'var(--text-primary)' }}>
                              Abordagem {a.variante + 1}
                              {destaque && (
                                <span className="badge ml-2" style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#3B82F6', fontSize: '10px' }}>
                                  melhor conversão
                                </span>
                              )}
                            </td>
                            <td className="text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{a.enviados}</td>
                            <td className="text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {a.responderam} <span style={{ color: 'var(--text-muted)' }}>({pct(a.responderam, a.enviados)})</span>
                            </td>
                            <td className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                              {a.venderam} <span style={{ color: 'var(--text-muted)' }}>({pct(a.venderam, a.enviados)})</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                    O destaque só aparece para abordagens com pelo menos 5 envios.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Por campanha */}
          {campanhaSel === 'todas' && porCampanha.length > 1 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Por campanha
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }}>
                      <th className="text-left font-medium py-1.5">Campanha</th>
                      <th className="text-right font-medium py-1.5">Formandos</th>
                      <th className="text-right font-medium py-1.5">Responderam</th>
                      <th className="text-right font-medium py-1.5">Vendidos</th>
                      <th className="text-right font-medium py-1.5">Conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porCampanha.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => setCampanhaSel(c.id)}
                        className="cursor-pointer hover:bg-[var(--bg-surface-raised)]"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                      >
                        <td className="py-2" style={{ color: 'var(--text-primary)' }}>{c.nome}</td>
                        <td className="text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{c.total}</td>
                        <td className="text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{c.responderam}</td>
                        <td className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{c.vendidos}</td>
                        <td className="text-right tabular-nums font-semibold" style={{ color: '#3B82F6' }}>{pct(c.vendidos, c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
