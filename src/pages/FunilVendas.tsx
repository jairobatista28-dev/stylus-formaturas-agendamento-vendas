import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';

/**
 * FUNIL DE VENDAS - material fotografico
 * Mostra, por campanha de venda, quantos formandos passaram por cada etapa,
 * onde a venda esta sendo perdida, o efeito da foto do formando e qual
 * abordagem de resgate (prorrogacao) converte mais.
 */

interface Linha {
  id: string;
  nome: string | null;
  telefone: string | null;
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

interface Venda {
  id: string;
  data_venda: string;
  formando: string;
  instituicao: string | null;
  curso: string | null;
  projeto: string | null;
  valor_total: number;
  valor_pix: number;
  valor_dinheiro: number;
  valor_cartao: number;
  valor_cartao_ac: number;
  valor_dcc: number;
  valor_boleto: number;
  forma_pagamento: string | null;
  origem: 'manual' | 'campanha' | 'planilha';
  contato_campanha_id: string | null;
  acerto: string | null;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Primeiro + ultimo nome, sem acento (para saber se a pessoa ja tem venda registrada) */
function chaveNome(n?: string | null): string {
  const t = String(n || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/-\s*\d+\s*$/, '')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((x) => x && !['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'].includes(x));
  return t.length ? `${t[0]} ${t[t.length - 1]}` : '';
}

function dataBR(iso: string): string {
  const [a, m, d] = String(iso || '').split('-');
  return d ? `${d}/${m}/${a}` : iso;
}

/** Le uma planilha de acerto (mesmo layout do Acerto_Jairo_*.xlsx) e devolve as vendas */
async function lerPlanilhaAcerto(arquivo: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const linhas: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const acerto = String((linhas.find((l) => l.some((c) => /ACERTO/i.test(String(c ?? '')))) || []).find((c) => /ACERTO/i.test(String(c ?? ''))) || arquivo.name).trim();
  const iHeader = linhas.findIndex((l) => l.some((c) => String(c ?? '').trim().toUpperCase() === 'FORMANDO'));
  if (iHeader < 0) throw new Error('Não encontrei a linha de cabeçalho com a coluna FORMANDO');
  const cab = linhas[iHeader].map((c) => String(c ?? '').trim().toUpperCase());
  const col = (nome: string) => cab.findIndex((c) => c === nome);
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0);
  const vendas: Record<string, unknown>[] = [];
  for (const l of linhas.slice(iHeader + 1)) {
    const formando = String(l[col('FORMANDO')] ?? '').trim();
    const ctt = String(l[col('CONTRATO CTT')] ?? '').trim();
    const total = num(l[col('TOTAL')]);
    const dv = l[col('DATA DA VENDA')];
    if (!formando || !ctt || total <= 0 || dv === null || dv === '') continue;
    let data = '';
    if (typeof dv === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30) + dv * 86400000);
      data = d.toISOString().slice(0, 10);
    } else {
      const m = String(dv).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!m) continue;
      data = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    const v = {
      pix: num(l[col('PIX')]),
      din: num(l[col('DINHEIRO')]),
      c2: num(l[col('CARTAO 2X')]),
      cac: num(l[col('CARTAO AC 2X')]),
      dcc: num(l[col('DCC')]),
      bol: num(l[col('BOLETO')]),
    };
    const formas = [
      v.pix && 'Pix', v.din && 'Dinheiro', v.c2 && 'Cartão 2x', v.cac && 'Cartão AC 2x', v.dcc && 'DCC', v.bol && 'Boleto',
    ].filter(Boolean).join(' + ');
    vendas.push({
      data_venda: data,
      formando,
      projeto: String(l[col('PROJETO')] ?? '').trim() || null,
      instituicao: String(l[col('INSTITUIÇÃO')] ?? l[col('INSTITUICAO')] ?? '').trim() || null,
      curso: String(l[col('CURSO')] ?? '').trim() || null,
      contrato_ctt: ctt,
      valor_total: total,
      valor_pix: v.pix,
      valor_dinheiro: v.din,
      valor_cartao: v.c2,
      valor_cartao_ac: v.cac,
      valor_dcc: v.dcc,
      valor_boleto: v.bol,
      forma_pagamento: formas || null,
      vendedor: String(l[col('VENDEDOR')] ?? '').trim() || null,
      origem: 'planilha',
      acerto,
    });
  }
  return vendas;
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
let idsComVenda = new Set<string>();
const vendeu = (l: Linha) => l.status === 'comprou' || idsComVenda.has(l.id);

function pct(parte: number, total: number): string {
  if (!total) return '0%';
  const v = (parte / total) * 100;
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;
}

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function FunilVendas() {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [campanhaSel, setCampanhaSel] = useState<string>('todas');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [mostrarLista, setMostrarLista] = useState(false);
  const [importando, setImportando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const { toasts, showToast, removeToast } = useToast();
  const navigate = useNavigate();

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
        .select('id, nome, telefone, campanha_id, status, interagiu_em, plano_escolhido, dados_confirmados_em, foto_enviada_em, resgate_enviado_em, resgate_variante, valor_oferecido, campanhas!inner(tipo_atendimento)')
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

    // Vendas realizadas (fonte oficial do total vendido)
    const todasVendas: Venda[] = [];
    for (let inicio = 0; inicio < 50000; inicio += 1000) {
      const { data, error } = await supabase
        .from('vendas')
        .select('id, data_venda, formando, instituicao, curso, projeto, valor_total, valor_pix, valor_dinheiro, valor_cartao, valor_cartao_ac, valor_dcc, valor_boleto, forma_pagamento, origem, contato_campanha_id, acerto')
        .order('data_venda', { ascending: false })
        .range(inicio, inicio + 999);
      if (error) {
        setErro(
          error.message.includes('vendas')
            ? 'A tabela de vendas ainda não existe. Rode a migration 20261102120000_vendas_realizadas no bolt.'
            : 'Não foi possível carregar as vendas: ' + error.message
        );
        break;
      }
      todasVendas.push(...((data || []) as Venda[]));
      if (!data || data.length < 1000) break;
    }
    setVendas(todasVendas);
    setCarregando(false);
  }

  async function importarPlanilha(arquivo: File) {
    setImportando(true);
    try {
      const novas = await lerPlanilhaAcerto(arquivo);
      if (!novas.length) {
        showToast('Nenhuma venda encontrada na planilha', 'error');
        return;
      }
      const { error } = await supabase.from('vendas').upsert(novas, { onConflict: 'contrato_ctt', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      const { data: vinc } = await supabase.rpc('vincular_vendas');
      showToast(
        `${novas.length} vendas lidas (as já registradas foram ignoradas). ${vinc?.sem_vinculo ?? 0} sem formando correspondente na base.`,
        'success'
      );
      await carregar();
    } catch (e) {
      showToast('Erro ao importar: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  // Formandos que tem venda registrada contam como vendidos, mesmo sem a marcacao no status
  idsComVenda = useMemo(() => new Set(vendas.map((v) => v.contato_campanha_id).filter(Boolean) as string[]), [vendas]);

  const base = useMemo(
    () => (campanhaSel === 'todas' ? linhas : linhas.filter((l) => l.campanha_id === campanhaSel)),
    [linhas, campanhaSel, idsComVenda]
  );

  const campanhaDoContato = useMemo(() => {
    const m = new Map<string, string>();
    linhas.forEach((l) => m.set(l.id, l.campanha_id));
    return m;
  }, [linhas]);

  const vendasFiltradas = useMemo(
    () => (campanhaSel === 'todas' ? vendas : vendas.filter((v) => v.contato_campanha_id && campanhaDoContato.get(v.contato_campanha_id) === campanhaSel)),
    [vendas, campanhaSel, campanhaDoContato]
  );

  // Marcados como vendido (status "comprou") mas sem a venda registrada com valor:
  // nao entram no faturamento ate o valor ser registrado no chat
  const vendidosSemValor = useMemo(() => {
    const comVenda = new Set(vendas.map((v) => chaveNome(v.formando)));
    const vistos = new Set<string>();
    return base.filter((l) => {
      if (l.status !== 'comprou' || idsComVenda.has(l.id)) return false;
      const k = chaveNome(l.nome);
      if (!k || comVenda.has(k) || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }, [base, vendas, idsComVenda]);

  const resumoVendas = useMemo(() => {
    const total = vendasFiltradas.reduce((s, v) => s + Number(v.valor_total || 0), 0);
    const daBase = vendasFiltradas.filter((v) => v.contato_campanha_id);
    const fora = vendasFiltradas.filter((v) => !v.contato_campanha_id);
    const soma = (lista: Venda[]) => lista.reduce((s, v) => s + Number(v.valor_total || 0), 0);
    const porMes = new Map<string, { qtd: number; valor: number }>();
    vendasFiltradas.forEach((v) => {
      const chave = String(v.data_venda).slice(0, 7);
      const atual = porMes.get(chave) || { qtd: 0, valor: 0 };
      atual.qtd++;
      atual.valor += Number(v.valor_total || 0);
      porMes.set(chave, atual);
    });
    const formas = [
      { nome: 'Pix', valor: vendasFiltradas.reduce((s, v) => s + Number(v.valor_pix || 0), 0) },
      { nome: 'Cartão 2x', valor: vendasFiltradas.reduce((s, v) => s + Number(v.valor_cartao || 0), 0) },
      { nome: 'Cartão AC 2x', valor: vendasFiltradas.reduce((s, v) => s + Number(v.valor_cartao_ac || 0), 0) },
      { nome: 'Dinheiro', valor: vendasFiltradas.reduce((s, v) => s + Number(v.valor_dinheiro || 0), 0) },
      { nome: 'DCC', valor: vendasFiltradas.reduce((s, v) => s + Number(v.valor_dcc || 0), 0) },
      { nome: 'Boleto', valor: vendasFiltradas.reduce((s, v) => s + Number(v.valor_boleto || 0), 0) },
    ].filter((f) => f.valor > 0);
    return {
      qtd: vendasFiltradas.length,
      total,
      ticket: vendasFiltradas.length ? total / vendasFiltradas.length : 0,
      daBase: { qtd: daBase.length, valor: soma(daBase) },
      fora: { qtd: fora.length, valor: soma(fora) },
      porMes: [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      formas,
    };
  }, [vendasFiltradas]);

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
    return {
      semInteresse: base.filter((l) => l.status === 'sem_interesse').length,
      compraFutura: base.filter((l) => l.status === 'compra_futura').length,
      aguardandoLink: base.filter((l) => l.status === 'interessado_compra').length,
      comEspecialista: base.filter((l) => l.status === 'transferido_humano').length,
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
  }, [campanhas, linhas, idsComVenda]);

  const maior = etapas[0]?.qtd || 1;

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
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
          <input
            ref={arquivoRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importarPlanilha(e.target.files[0])}
          />
          <button
            onClick={() => arquivoRef.current?.click()}
            className="btn-secondary"
            disabled={importando}
            title="Importar planilha de acerto (mesmo modelo do Acerto_Jairo). Vendas já registradas são ignoradas."
          >
            {importando ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Importar acerto
          </button>
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

      {/* VENDAS REALIZADAS (fonte oficial: tabela de vendas) */}
      {!carregando && vendas.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-1">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Vendas realizadas
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Planilhas de acerto + vendas registradas no chat {campanhaSel !== 'todas' && '(somente desta campanha)'}
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Vendas</p>
              <p className="text-2xl font-semibold tabular-nums" style={{ color: '#3B82F6' }}>{resumoVendas.qtd.toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Faturamento</p>
              <p className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{moeda(resumoVendas.total)}</p>
            </div>
            <div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ticket médio</p>
              <p className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{moeda(resumoVendas.ticket)}</p>
            </div>
            <div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Da base · fora da base</p>
              <p className="text-sm font-medium tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>
                {resumoVendas.daBase.qtd} ({moeda(resumoVendas.daBase.valor)})
              </p>
              <p className="text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                {resumoVendas.fora.qtd} ({moeda(resumoVendas.fora.valor)})
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Por mês</p>
              {resumoVendas.porMes.map(([mes, d]) => {
                const [a, m] = mes.split('-');
                return (
                  <div key={mes} className="flex justify-between text-xs py-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{MESES[Number(m) - 1]}/{a}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{d.qtd} vendas · {moeda(d.valor)}</span>
                  </div>
                );
              })}
            </div>
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Por forma de pagamento</p>
              {resumoVendas.formas.map((f) => (
                <div key={f.nome} className="flex justify-between text-xs py-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{f.nome}</span>
                  <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {moeda(f.valor)} <span style={{ color: 'var(--text-muted)' }}>({pct(f.valor, resumoVendas.total)})</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {vendidosSemValor.length > 0 && (
            <div className="rounded-lg p-3" style={{ backgroundColor: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)' }}>
              <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: '#F59E0B' }}>
                <AlertTriangle size={14} />
                {vendidosSemValor.length} {vendidosSemValor.length === 1 ? 'formando marcado' : 'formandos marcados'} como vendido sem o valor registrado (fora do faturamento)
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {vendidosSemValor.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => navigate(`/whatsapp?tel=${encodeURIComponent(l.telefone || '')}`)}
                    className="btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '11px' }}
                    title="Abrir a conversa e clicar em Registrar valor"
                  >
                    {l.nome}
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                Clique no nome, e no chat use o botão Registrar valor.
              </p>
            </div>
          )}

          <button
            onClick={() => setMostrarLista(!mostrarLista)}
            className="text-xs inline-flex items-center gap-1"
            style={{ color: 'var(--accent-primary)' }}
          >
            {mostrarLista ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {mostrarLista ? 'Esconder a lista de vendas' : `Ver as ${resumoVendas.qtd} vendas`}
          </button>
          {mostrarLista && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-medium py-1.5">Data</th>
                    <th className="text-left font-medium py-1.5">Formando</th>
                    <th className="text-left font-medium py-1.5">Instituição / curso</th>
                    <th className="text-left font-medium py-1.5">Pagamento</th>
                    <th className="text-left font-medium py-1.5">Origem</th>
                    <th className="text-right font-medium py-1.5">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {vendasFiltradas.map((v) => (
                    <tr key={v.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td className="py-1.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{dataBR(v.data_venda)}</td>
                      <td style={{ color: 'var(--text-primary)' }}>{v.formando}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{[v.instituicao, v.curso].filter(Boolean).join(' · ')}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{v.forma_pagamento || '-'}</td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            fontSize: '10px',
                            backgroundColor: v.contato_campanha_id ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)',
                            color: v.contato_campanha_id ? '#3B82F6' : '#F59E0B',
                          }}
                        >
                          {v.contato_campanha_id ? 'Base' : 'Fora da base'}
                        </span>
                      </td>
                      <td className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{moeda(Number(v.valor_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
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
