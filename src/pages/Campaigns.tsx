import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  CheckCircle,
  Play,
  Pause,
  Loader2,
  Eye,
  Trash2,
  Database,
  HardDrive,
  Calendar,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { parseMensagemCampanha, criarFilaEnvios, MessageBlock } from '../lib/campaign-message-parser';
import {
  fetchCampanhas,
  createCampanha,
  updateCampanhaStatus,
  deleteCampanha,
  fetchContatosByCampanha,
  updateContatoStatus,
  Campanha,
  ContatoCampanha,
} from '../lib/campaign-storage';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import { CampaignReportModal } from '../components/CampaignReportModal';
import { EnvioSeguroPanel } from '../components/EnvioSeguroPanel';
import { MENSAGEM_ULTIMA_OPORTUNIDADE, PROMPT_ULTIMA_OPORTUNIDADE } from '../lib/modelos-ultima-oportunidade';
import { MENSAGEM_BLACK_FRIDAY, PROMPT_BLACK_FRIDAY } from '../lib/modelos-black-friday';

const TURNOS_HORARIOS: Record<string, string> = {
  'Manha (8h as 12h)': 'Manha entre 08:00 e 12:00',
  'Tarde (13h as 17h)': 'Tarde entre 13:00 e 17:00',
  'Noite (18h as 20h)': 'Noite entre 18:00 e 20:00',
};

const ESCRITORIO_HORARIOS_MANHA = ['09:30', '10:30', '11:30'];
const ESCRITORIO_HORARIOS_TARDE = ['13:00', '14:00', '15:00', '16:00', '17:00'];

const ESCRITORIO_ENDERECO = 'Escritorio - Rua Judith Motta, Parque 10 de Novembro, Manaus - AM, CEP 69055-280';

// 'venda_ultima' e so do formulario: salva como tipo_atendimento = 'venda_material'
// + modalidade_venda = 'ultima_oportunidade' (venda sem visita, valores de pre-venda)
// 'venda_black_friday' idem, com modalidade_venda = 'black_friday' (desconto unico ate a data da Black)
type TipoAtendimento = 'visita_externa' | 'escritorio' | 'venda_material' | 'venda_ultima' | 'venda_black_friday';

// CPF vindo do Excel pode perder zeros a esquerda (vira numero) - repoe ate 11 digitos
function normalizarCpfPlanilha(valor: unknown): string | undefined {
  if (valor === null || valor === undefined) return undefined;
  let digitos = String(valor).replace(/\D/g, '');
  if (!digitos) return undefined;
  if (digitos.length >= 9 && digitos.length < 11) digitos = digitos.padStart(11, '0');
  if (digitos.length !== 11) return String(valor).trim() || undefined;
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

function normalizarEmailPlanilha(valor: unknown): string | undefined {
  const email = String(valor ?? '').trim().toLowerCase();
  return email || undefined;
}

type OpcaoAgendamento = { data: string; tipo?: 'visita_externa' | 'escritorio'; turnos: string[]; horarios?: string[] };

function formatarDatasDisponiveis(
  opcoes: OpcaoAgendamento[],
  tipoAtendimentoCampanha: TipoAtendimento = 'visita_externa'
): string {
  if (!opcoes || opcoes.length === 0) return '';
  return opcoes
    .filter((o) => o.data)
    .map((o) => {
      const [ano, mes, dia] = o.data.split('-');
      const dataFormatada = `${dia}/${mes}/${ano}`;
      // Usa o tipo da PROPRIA data (campanhas podem misturar visita externa
      // e escritorio); campanhas antigas sem "tipo" salvo usam o tipo geral
      // da campanha como fallback.
      const tipoLinha = o.tipo || (tipoAtendimentoCampanha === 'escritorio' ? 'escritorio' : 'visita_externa');
      if (tipoLinha === 'escritorio') {
        const horariosTxt = (o.horarios || []).join(', ');
        return `Dia ${dataFormatada} — Atendimento no escritorio — ${horariosTxt}`;
      }
      const turnosTxt = (o.turnos || [])
        .map((t) => TURNOS_HORARIOS[t] || t)
        .join('\n');
      return `Dia ${dataFormatada} — Visita externa\n${turnosTxt}`;
    })
    .join('\n\n') + '\n\n';
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  rascunho: { label: 'Rascunho', color: 'var(--text-muted)', bg: 'rgba(100, 116, 139, 0.15)' },
  aguardando_inicio: { label: 'Aguardando Inicio', color: 'var(--text-muted)', bg: 'rgba(100, 116, 139, 0.15)' },
  em_andamento: { label: 'Em Andamento', color: 'var(--info)', bg: 'rgba(59, 130, 246, 0.15)' },
  pausada: { label: 'Pausada', color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.15)' },
  concluida: { label: 'Concluida', color: 'var(--success)', bg: 'rgba(34, 197, 94, 0.15)' },
};

const DELETE_PASSWORD = '3673';

/** Busca todas as linhas de uma consulta em paginas de 1000 (limite do Supabase) */
async function buscarTodasPaginas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; inicio < 50000; inicio += 1000) {
    const { data, error } = await consulta(inicio, inicio + 999);
    if (error) throw error;
    todas.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return todas;
}

export function Campaigns() {
  const navigate = useNavigate();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteCampanhaId, setDeleteCampanhaId] = useState<string | null>(null);
  const [reportCampanha, setReportCampanha] = useState<Campanha | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [dataSource, setDataSource] = useState<'supabase' | 'local' | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    nome: '',
    descricao: '',
    mensagem_inicial: '',
    prompt_ia: '',
  });

  // Tipo de atendimento
  const [tipoAtendimento, setTipoAtendimento] = useState<TipoAtendimento>('visita_externa');

  // Opcoes de agendamento
  const [opcoesAgendamento, setOpcoesAgendamento] = useState<
    OpcaoAgendamento[]
  >([]);

  // File upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedContacts, setUploadedContacts] = useState<Array<{ nome: string; telefone: string; local?: string; curso?: string; numero_contrato?: string; data?: string }>>([]);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewBlocks, setPreviewBlocks] = useState<MessageBlock[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toasts, showToast, removeToast } = useToast();
  const ehVenda = tipoAtendimento === 'venda_material' || tipoAtendimento === 'venda_ultima' || tipoAtendimento === 'venda_black_friday';

  useEffect(() => {
    loadCampanhas();
  }, []);

  useEffect(() => {
    if (formData.mensagem_inicial && uploadedContacts.length > 0) {
      const blocks = parseMensagemCampanha(formData.mensagem_inicial, uploadedContacts[0].nome);
      setPreviewBlocks(blocks);
    } else {
      setPreviewBlocks([]);
    }
  }, [formData.mensagem_inicial, uploadedContacts]);

  const loadCampanhas = async () => {
    setIsLoading(true);
    const result = await fetchCampanhas();
    setCampanhas(result.data);
    setDataSource(result.source);
    setIsLoading(false);
  };

  const handleStartCampanha = async (campanha: Campanha, isRetry = false) => {
    console.log('[Campaign] handleStartCampanha called for:', campanha.id, campanha.nome, 'status:', campanha.status, 'isRetry:', isRetry);

    if (!isRetry) {
      // Trava atomica contra duplo disparo: so passa se conseguir mudar de rascunho/pausada para em_andamento
      const { data: linhaTravada } = await supabase
        .from('campanhas')
        .update({ status: 'em_andamento' })
        .eq('id', campanha.id)
        .in('status', ['rascunho', 'pausada'])
        .select('id')
        .maybeSingle();

      if (!linhaTravada) {
        showToast('Esta campanha ja foi iniciada (ou esta em andamento)', 'error');
        return;
      }
    }

    // First check if campanha already has contatos embedded
    let contatos: ContatoCampanha[] = campanha.contatos || [];

    // If no contatos embedded, fetch from storage
    if (contatos.length === 0) {
      const result = await fetchContatosByCampanha(campanha.id);
      contatos = result.data;
    }

    const pendentes = contatos.filter((c) => c.status === 'aguardando_inicio' || c.status === 'erro_envio');

    if (!pendentes || pendentes.length === 0) {
      showToast('Nenhum contato pendente. Todos ja foram enviados ou estao em conversa.', 'error');
      return;
    }

    console.log(`[Campaign] Encontrados ${pendentes.length} contatos pendentes (${pendentes.filter(c => c.status === 'erro_envio').length} erro_envio, ${pendentes.filter(c => c.status === 'aguardando_inicio').length} aguardando_inicio)`);

    // Reset erro_envio contacts back to aguardando_inicio so the dispatcher picks them up
    const erroContatos = pendentes.filter((c) => c.status === 'erro_envio');
    if (erroContatos.length > 0) {
      console.log(`[Campaign] Resetando ${erroContatos.length} contatos de erro_envio para aguardando_inicio`);
      for (const c of erroContatos) {
        await supabase
          .from('contatos_campanha')
          .update({ status: 'aguardando_inicio' })
          .eq('id', c.id);
      }
    }

    showToast(`Iniciando envio para ${pendentes.length} contatos...`, 'success');

    // Start sending messages in background
    startCampaignDispatch(campanha, pendentes);

    loadCampanhas();
  };

  const startCampaignDispatch = async (campanha: Campanha, contatos: ContatoCampanha[]) => {
    try {
      // Validar se o ID da campanha e um UUID valido
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(campanha.id)) {
        showToast('ID da campanha invalido. Recrie a campanha.', 'error');
        return;
      }

      // 1. Busca contatos existentes na tabela contatos_campanha para esta campanha
      // (paginado: o Supabase devolve no maximo 1000 linhas por consulta)
      const contatosExistentes = await buscarTodasPaginas<{ id: string; telefone: string }>((de, ate) =>
        supabase.from('contatos_campanha').select('id, telefone').eq('campanha_id', campanha.id).order('id').range(de, ate)
      );

      const TelefonesExistentes = new Set((contatosExistentes || []).map((c) => c.telefone));

      // 2. Insere apenas contatos que ainda nao existem (sem ID, deixa o banco gerar UUID)
      const contatosParaInserir = contatos
        .filter((c) => !TelefonesExistentes.has(c.telefone))
        .map((c) => ({
          campanha_id: campanha.id,
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

      if (contatosParaInserir.length > 0) {
        const { error: insertError } = await supabase
          .from('contatos_campanha')
          .insert(contatosParaInserir);

        if (insertError) {
          console.error('[Campaign] Erro ao inserir contatos:', insertError);
          showToast('Erro ao inserir contatos', 'error');
          return;
        }
      }

      // 3. Busca todos os contatos da campanha (com UUIDs reais)
      let fetchError: any = null;
      let contatosComUUID: any[] = [];
      try {
        contatosComUUID = await buscarTodasPaginas<any>((de, ate) =>
          supabase
            .from('contatos_campanha')
            .select('id, telefone, nome, numero_contrato, valor_tabela, valor_oferecido, formas_pagamento, opcoes_plano, prazo_reciclagem, quantidade_fotos')
            .eq('campanha_id', campanha.id)
            .eq('status', 'aguardando_inicio')
            .order('id')
            .range(de, ate)
        );
      } catch (e) {
        fetchError = e;
      }

      if (fetchError || !contatosComUUID || contatosComUUID.length === 0) {
        showToast('Nenhum contato disponivel para envio', 'error');
        return;
      }

     // 4. Insere mensagens na fila_envios usando o parser de blocos
      // Formata opcoes de agendamento para substituicao do placeholder {datas_disponiveis}
      const textoDatasFormatado = formatarDatasDisponiveis(campanha.opcoes_agendamento || [], campanha.tipo_atendimento || 'visita_externa');

      // Suporte a multiplas variantes de mensagem inicial: se o texto tiver
      // "===VARIANTE===" separando blocos, cada contato recebe uma variante
      // diferente em rodizio (nao aleatorio, pra garantir distribuicao
      // equilibrada) - reduz o padrao repetitivo de texto pro WhatsApp.
      const variantesMensagem = campanha.mensagem_inicial
        .split(/===VARIANTE===/gi)
        .map((v: string) => v.trim())
        .filter((v: string) => v.length > 0);

      for (let idx = 0; idx < contatosComUUID.length; idx++) {
        const contato = contatosComUUID[idx];
        const templateEscolhido = variantesMensagem[idx % variantesMensagem.length];

        const primeiroNome = (() => {
          const p = String(contato.nome || '').trim().split(/\s+/)[0] || '';
          return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
        })();
        let mensagemPersonalizada = templateEscolhido
          .replace(/\{primeiro_nome\}/gi, primeiroNome)
          .replace(/\{\{nome\}\}/gi, contato.nome)
          .replace(/{nome}/gi, contato.nome)
          .replace(/\{datas_disponiveis\}/gi, textoDatasFormatado);

        if ((campanha as any).tipo_atendimento === 'venda_material') {
          mensagemPersonalizada = mensagemPersonalizada
            .replace(/\{numero_contrato\}/gi, contato.numero_contrato || 'Nao informado')
            .replace(/\{valor_tabela\}/gi, contato.valor_tabela != null ? String(contato.valor_tabela) : 'valor sob consulta')
            .replace(/\{valor_oferecido\}/gi, contato.valor_oferecido != null ? String(contato.valor_oferecido) : 'valor sob consulta')
            .replace(/\{formas_pagamento\}/gi, contato.formas_pagamento || 'consulte as opcoes disponiveis')
            .replace(/\{opcoes_plano\}/gi, contato.opcoes_plano || 'consulte as opcoes disponiveis')
            .replace(/\{prazo_reciclagem\}/gi, contato.prazo_reciclagem || 'em breve')
            .replace(/\{prazo_pre_venda\}/gi, contato.prazo_reciclagem || 'em breve')
            .replace(/\{prazo_black_friday\}/gi, contato.prazo_reciclagem || 'em breve')
            .replace(/\{prazo_final\}/gi, contato.prazo_reciclagem || 'em breve')
            .replace(/\{quantidade_fotos\}/gi, (contato as any).quantidade_fotos || 'nao informado');
        }

        const blocos = parseMensagemCampanha(mensagemPersonalizada, contato.nome);

        const { success, error: filaError } = await criarFilaEnvios(
          supabase,
          contato.id,
          campanha.id,
          contato.telefone,
          blocos
        );

        if (!success) {
          console.error('[Campaign] Erro ao inserir na fila:', filaError);
          showToast('Erro ao criar fila de envio: ' + filaError, 'error');
          return;
        }
      }

      console.log(`[Campaign] Blocos inseridos na fila para ${contatosComUUID.length} contatos`);

      // 5. Chama o dispatcher para processar a fila
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey) {
        console.log('[Campaign] Chamando dispatcher:', `${supabaseUrl}/functions/v1/campaign-dispatcher`);
        fetch(`${supabaseUrl}/functions/v1/campaign-dispatcher`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }).then(res => {
          console.log('[Campaign] Dispatcher response status:', res.status);
        }).catch((err) => console.warn('[Campaign] Dispatcher invoke error:', err));
      } else {
        console.error('[Campaign] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
      }

      showToast(`${contatosComUUID.length} contatos inseridos na fila de envio!`, 'success');
      loadCampanhas();
    } catch (err) {
      console.error('[Campaign] Erro no dispatch:', err);
      showToast('Erro ao iniciar campanha', 'error');
    }
  };

  const handlePauseCampanha = async (campanha: Campanha) => {
    await updateCampanhaStatus(campanha.id, 'pausada');
    showToast('Campanha pausada', 'success');
    loadCampanhas();
  };

  const handleDeleteCampanha = async () => {
    if (!deleteCampanhaId || deletePassword !== DELETE_PASSWORD) {
      showToast('Senha incorreta', 'error');
      return;
    }

    setIsDeleting(true);
    await deleteCampanha(deleteCampanhaId);
    showToast('Campanha excluida', 'success');
    setDeleteCampanhaId(null);
    setDeletePassword('');
    loadCampanhas();
    setIsDeleting(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setParseError(null);
    setIsParsingFile(true);

    try {
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.csv') || file.type === 'text/csv') {
        const text = await file.text();
        const contacts = parseCSV(text);
        setUploadedContacts(contacts);
        showToast(`${contacts.length} contatos encontrados`, 'success');
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const contacts = await parseExcel(file);
        setUploadedContacts(contacts);
        showToast(`${contacts.length} contatos encontrados`, 'success');
      } else {
        throw new Error('Formato nao suportado. Use CSV ou Excel (.xlsx, .xls)');
      }
    } catch (err) {
      console.error('File parse error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro ao processar arquivo.';
      setParseError(errorMessage);
      setUploadedContacts([]);
      setUploadedFile(null);
    }

    setIsParsingFile(false);
  };

  const parseCSV = (text: string): Array<{ nome: string; telefone: string; local?: string; curso?: string; numero_contrato?: string; data?: string }> => {
    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '').trim();
    const lines = normalizedText.split('\n').filter((line) => line.trim());

    if (lines.length < 2) {
      throw new Error('Arquivo vazio ou sem cabecalho.');
    }

    const firstLine = lines[0];
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const separator = semicolonCount >= commaCount ? ';' : ',';

    const parseCSVLine = (line: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === separator && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    };

    const rawHeaders = parseCSVLine(firstLine);
    const headers = rawHeaders.map((h) =>
      h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    );

    const nomeIdx = headers.findIndex((h) => h.includes('nome') || h.includes('formando'));
    const telefoneIdx = headers.findIndex(
      (h) => h.includes('telefone') || h.includes('celular') || h.includes('fone') || h.includes('whatsapp') || h.includes('phone') || h.includes('tel')
    );
    const enderecoIdx = headers.findIndex((h) => h.includes('endereco') || h.includes('local') || h.includes('endereo'));
    const cursoIdx = headers.findIndex((h) => h.includes('curso') || h.includes('curso'));
    const contratoIdx = headers.findIndex((h) => h.includes('contrato') || h.includes('numero_contrato') || h.includes('numero contrato'));
    const dataIdx = headers.findIndex((h) => h === 'data' || h.includes('data '));
    const valorTabelaIdx = headers.findIndex((h) => h.includes('valor_tabela') || h.includes('valor tabela'));
    const valorOferecidoIdx = headers.findIndex((h) => h.includes('valor_oferecido') || h.includes('valor oferecido') || (h.includes('valor') && (h.includes('pre_venda') || h.includes('pre venda') || h.includes('pre-venda') || h.includes('prevenda') || h.includes('black'))));
    const formasPagamentoIdx = headers.findIndex((h) => h.includes('formas_pagamento') || h.includes('formas de pagamento') || h.includes('pagamento'));
    const opcoesPlanoIdx = headers.findIndex((h) => h.includes('opcoes_plano') || h.includes('opcoes de plano') || h.includes('plano'));
    const prazoReciclagemIdx = headers.findIndex((h) => h.includes('prazo_reciclagem') || h.includes('prazo de reciclagem') || h.includes('reciclagem') || h.includes('prazo'));
    const quantidadeFotosIdx = headers.findIndex((h) => h.includes('quantidade_fotos') || h.includes('quantidade de fotos') || h.includes('qtd_fotos') || h.includes('qtd fotos') || h.includes('numero de fotos'));
    const cpfIdx = headers.findIndex((h) => h.includes('cpf'));
    const emailIdx = headers.findIndex((h) => h.includes('email') || h.includes('e-mail') || h.includes('e mail'));

    if (nomeIdx === -1 || telefoneIdx === -1) {
      const foundHeaders = rawHeaders.join(', ');
      const missing = [];
      if (nomeIdx === -1) missing.push('nome');
      if (telefoneIdx === -1) missing.push('telefone');
      throw new Error(`Colunas obrigatorias nao encontradas: ${missing.join(', ')}\n\nCabecalhos encontrados: ${foundHeaders}`);
    }

    const contacts: Array<{ nome: string; telefone: string; local?: string; curso?: string; numero_contrato?: string; data?: string; valor_tabela?: string; valor_oferecido?: string; formas_pagamento?: string; opcoes_plano?: string; prazo_reciclagem?: string; quantidade_fotos?: string; cpf?: string; email?: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        if (values.length < Math.max(nomeIdx, telefoneIdx) + 1) continue;

        const nome = values[nomeIdx];
        const telefoneRaw = values[telefoneIdx] || '';
        const telefone = telefoneRaw.replace(/\D/g, '');

        if (!nome || !telefone || telefone.length < 10) continue;

        contacts.push({
          nome,
          telefone: telefone.length === 11 ? `55${telefone}` : telefone,
          local: enderecoIdx !== -1 ? (values[enderecoIdx] || undefined) : undefined,
          curso: cursoIdx !== -1 ? (values[cursoIdx] || undefined) : undefined,
          numero_contrato: contratoIdx !== -1 ? (values[contratoIdx] || undefined) : undefined,
          data: dataIdx !== -1 ? (values[dataIdx] || undefined) : undefined,
          valor_tabela: valorTabelaIdx !== -1 ? (values[valorTabelaIdx] || undefined) : undefined,
          valor_oferecido: valorOferecidoIdx !== -1 ? (values[valorOferecidoIdx] || undefined) : undefined,
          formas_pagamento: formasPagamentoIdx !== -1 ? (values[formasPagamentoIdx] || undefined) : undefined,
          opcoes_plano: opcoesPlanoIdx !== -1 ? (values[opcoesPlanoIdx] || undefined) : undefined,
          prazo_reciclagem: prazoReciclagemIdx !== -1 ? (values[prazoReciclagemIdx] || undefined) : undefined,
          quantidade_fotos: quantidadeFotosIdx !== -1 ? (values[quantidadeFotosIdx] || undefined) : undefined,
          cpf: cpfIdx !== -1 ? normalizarCpfPlanilha(values[cpfIdx]) : undefined,
          email: emailIdx !== -1 ? normalizarEmailPlanilha(values[emailIdx]) : undefined,
        });
      } catch (lineErr) {
        console.warn(`Error parsing line ${i + 1}:`, lineErr);
        continue;
      }
    }

    if (contacts.length === 0) {
      throw new Error('Nenhum contato valido encontrado.');
    }

    return contacts;
  };

  const parseExcel = async (file: File): Promise<Array<{ nome: string; telefone: string; local?: string; curso?: string; numero_contrato?: string; data?: string }>> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Arquivo Excel vazio.');
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      // Texto formatado (datas sempre em dd/mm/aaaa) + valores brutos (pra
      // formatar moeda e nao perder zeros/precisao de CPF e quantidade)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'dd/mm/yyyy' }) as string[][];
      const jsonRaw = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true }) as unknown[][];

      if (!jsonData || jsonData.length < 2) {
        throw new Error('Planilha vazia ou sem cabecalho.');
      }

      const rawHeaders = jsonData[0] || [];
      const headers = rawHeaders.map((h) =>
        String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      );

      const nomeIdx = headers.findIndex((h) => h.includes('nome') || h.includes('formando'));
      const telefoneIdx = headers.findIndex(
        (h) => h.includes('telefone') || h.includes('celular') || h.includes('fone') || h.includes('whatsapp') || h.includes('phone') || h.includes('tel')
      );
      const enderecoIdx = headers.findIndex((h) => h.includes('endereco') || h.includes('local') || h.includes('endereo'));
      const cursoIdx = headers.findIndex((h) => h.includes('curso'));
      const contratoIdx = headers.findIndex((h) => h.includes('contrato') || h.includes('numero_contrato'));
      const dataIdx = headers.findIndex((h) => h === 'data' || h.includes('data '));
      const valorTabelaIdx = headers.findIndex((h) => h.includes('valor_tabela') || h.includes('valor tabela'));
      const valorOferecidoIdx = headers.findIndex((h) => h.includes('valor_oferecido') || h.includes('valor oferecido') || (h.includes('valor') && (h.includes('pre_venda') || h.includes('pre venda') || h.includes('pre-venda') || h.includes('prevenda') || h.includes('black'))));
      const formasPagamentoIdx = headers.findIndex((h) => h.includes('formas_pagamento') || h.includes('formas de pagamento') || h.includes('pagamento'));
      const opcoesPlanoIdx = headers.findIndex((h) => h.includes('opcoes_plano') || h.includes('opcoes de plano') || h.includes('plano'));
      const prazoReciclagemIdx = headers.findIndex((h) => h.includes('prazo_reciclagem') || h.includes('prazo de reciclagem') || h.includes('reciclagem') || h.includes('prazo'));
      const quantidadeFotosIdx = headers.findIndex((h) => h.includes('quantidade_fotos') || h.includes('quantidade de fotos') || h.includes('qtd_fotos') || h.includes('qtd fotos') || h.includes('numero de fotos'));
      const cpfIdx = headers.findIndex((h) => h.includes('cpf'));
      const emailIdx = headers.findIndex((h) => h.includes('email') || h.includes('e-mail') || h.includes('e mail'));

      if (nomeIdx === -1 || telefoneIdx === -1) {
        const foundHeaders = rawHeaders.join(', ');
        const missing = [];
        if (nomeIdx === -1) missing.push('nome');
        if (telefoneIdx === -1) missing.push('telefone');
        throw new Error(`Colunas obrigatorias nao encontradas: ${missing.join(', ')}.\n\nCabecalhos encontrados: ${foundHeaders}`);
      }

      const contacts: Array<{ nome: string; telefone: string; local?: string; curso?: string; numero_contrato?: string; data?: string; valor_tabela?: string; valor_oferecido?: string; formas_pagamento?: string; opcoes_plano?: string; prazo_reciclagem?: string; quantidade_fotos?: string; cpf?: string; email?: string }> = [];

      for (let i = 1; i < jsonData.length; i++) {
        const values = jsonData[i] || [];
        const rawValues = jsonRaw[i] || [];
        const celulaData = (idx: number): string | undefined => {
          if (idx === -1) return undefined;
          const bruto = rawValues[idx];
          if (bruto instanceof Date) {
            const d = String(bruto.getUTCDate()).padStart(2, '0');
            const m = String(bruto.getUTCMonth() + 1).padStart(2, '0');
            return `${d}/${m}/${bruto.getUTCFullYear()}`;
          }
          return String(values[idx] || '') || undefined;
        };
        const celulaMoeda = (idx: number): string | undefined => {
          if (idx === -1) return undefined;
          const bruto = rawValues[idx];
          if (typeof bruto === 'number') {
            return bruto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          }
          return String(values[idx] || '') || undefined;
        };
        const celulaBruta = (idx: number): string | undefined => {
          if (idx === -1) return undefined;
          const bruto = rawValues[idx];
          if (bruto === null || bruto === undefined || bruto === '') return undefined;
          return typeof bruto === 'number' ? String(Math.round(bruto)) : String(bruto).trim() || undefined;
        };
        if (values.length < Math.max(nomeIdx, telefoneIdx) + 1) continue;

        const nome = values[nomeIdx];
        const telefoneRaw = values[telefoneIdx] || '';
        const telefone = String(telefoneRaw).replace(/\D/g, '');

        if (!nome || !telefone || telefone.length < 10) continue;

        contacts.push({
          nome: String(nome),
          telefone: telefone.length === 11 ? `55${telefone}` : telefone,
          local: enderecoIdx !== -1 ? String(values[enderecoIdx] || '') || undefined : undefined,
          curso: cursoIdx !== -1 ? String(values[cursoIdx] || '') || undefined : undefined,
          numero_contrato: contratoIdx !== -1 ? String(values[contratoIdx] || '') || undefined : undefined,
          data: dataIdx !== -1 ? String(values[dataIdx] || '') || undefined : undefined,
          valor_tabela: celulaMoeda(valorTabelaIdx),
          valor_oferecido: valorOferecidoIdx !== -1 ? String(values[valorOferecidoIdx] || '') || undefined : undefined,
          formas_pagamento: formasPagamentoIdx !== -1 ? String(values[formasPagamentoIdx] || '') || undefined : undefined,
          opcoes_plano: opcoesPlanoIdx !== -1 ? String(values[opcoesPlanoIdx] || '') || undefined : undefined,
          prazo_reciclagem: celulaData(prazoReciclagemIdx),
          quantidade_fotos: celulaBruta(quantidadeFotosIdx),
          cpf: cpfIdx !== -1 ? normalizarCpfPlanilha(celulaBruta(cpfIdx)) : undefined,
          email: emailIdx !== -1 ? normalizarEmailPlanilha(values[emailIdx]) : undefined,
        });
      }

      if (contacts.length === 0) {
        throw new Error('Nenhum contato valido encontrado.');
      }

      return contacts;
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Erro ao processar arquivo Excel.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nome.trim()) {
      showToast('Nome da campanha e obrigatorio', 'error');
      return;
    }

    if (!formData.mensagem_inicial.trim()) {
      showToast('Mensagem inicial e obrigatoria', 'error');
      return;
    }

    setIsSubmitting(true);

    // Converter opcoesAgendamento para formato JSON do banco
    const opcoesJson = opcoesAgendamento
      .filter((o) => o.data)
      .map((o) => ({
        data: o.data,
        tipo: o.tipo || 'visita_externa',
        turnos: o.turnos,
        ...(o.tipo === 'escritorio' ? { horarios: o.horarios || [] } : {}),
      }));

    // A campanha guarda um "tipo_atendimento" geral (usado pra filtrar base
    // de conhecimento). Se as datas usadas forem todas do mesmo tipo,
    // mantem esse tipo; se misturar visita externa e escritorio na mesma
    // campanha, marca como "mista".
    let tipoParaSalvar: string = tipoAtendimento === 'venda_ultima' || tipoAtendimento === 'venda_black_friday' ? 'venda_material' : tipoAtendimento;
    if (!ehVenda) {
      const tiposUsados = new Set(opcoesJson.map((o) => o.tipo));
      tipoParaSalvar = tiposUsados.size > 1 ? 'mista' : (opcoesJson[0]?.tipo || tipoAtendimento);
    }

    const result = await createCampanha(
      {
        nome: formData.nome.trim(),
        descricao: formData.descricao.trim() || null,
        mensagem_inicial: formData.mensagem_inicial.trim(),
        prompt_ia: formData.prompt_ia.trim() || null,
        tipo_atendimento: tipoParaSalvar,
        ...(tipoAtendimento === 'venda_ultima' ? { modalidade_venda: 'ultima_oportunidade' } : {}),
        ...(tipoAtendimento === 'venda_black_friday' ? { modalidade_venda: 'black_friday' } : {}),
        opcoes_agendamento: !ehVenda && opcoesJson.length > 0 ? opcoesJson : undefined,
      } as any,
      uploadedContacts
    );

    if (result.success) {
      showToast(
        `Campanha criada com ${uploadedContacts.length} contatos (${result.source === 'local' ? 'localStorage' : 'Supabase'})`,
        'success'
      );
      setIsModalOpen(false);
      resetForm();
      loadCampanhas();
    } else {
      showToast('Erro ao criar campanha: ' + (result.error || 'Erro desconhecido'), 'error');
    }

    setIsSubmitting(false);
  };

  const resetForm = () => {
    setFormData({ nome: '', descricao: '', mensagem_inicial: '', prompt_ia: '' });
    setTipoAtendimento('visita_externa');
    setOpcoesAgendamento([]);
    setUploadedFile(null);
    setUploadedContacts([]);
    setParseError(null);
    setPreviewBlocks([]);
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Campanhas
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Gerencie suas campanhas de WhatsApp
            </p>
            {dataSource && (
              <span
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded"
                style={{
                  backgroundColor: dataSource === 'supabase' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: dataSource === 'supabase' ? 'var(--success)' : 'var(--warning)',
                }}
              >
                {dataSource === 'supabase' ? <Database size={12} /> : <HardDrive size={12} />}
                {dataSource === 'supabase' ? 'Supabase' : 'LocalStorage'}
              </span>
            )}
          </div>
        </div>
        <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Nova Campanha
        </button>
      </div>

      <EnvioSeguroPanel onToast={showToast} />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
        </div>
      ) : campanhas.length === 0 ? (
        <div className="text-center py-12 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <FileSpreadsheet size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-muted)' }}>Nenhuma campanha criada</p>
          <button className="btn-primary mt-4" onClick={() => setIsModalOpen(true)}>
            <Plus size={18} />
            Criar Primeira Campanha
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {campanhas.map((campanha) => (
            <div
              key={campanha.id}
              className="p-5 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {campanha.nome}
                    </h3>
                    <span
                      className="px-2 py-1 rounded text-xs font-medium"
                      style={{
                        color: STATUS_CONFIG[campanha.status]?.color || 'var(--text-muted)',
                        backgroundColor: STATUS_CONFIG[campanha.status]?.bg || 'rgba(100, 116, 139, 0.15)',
                      }}
                    >
                      {STATUS_CONFIG[campanha.status]?.label || campanha.status}
                    </span>
                    {campanha.modalidade_venda === 'ultima_oportunidade' && (
                      <span
                        className="px-2 py-1 rounded text-xs font-medium flex items-center gap-1"
                        style={{ color: 'var(--warning)', backgroundColor: 'rgba(245, 158, 11, 0.15)' }}
                      >
                        <Sparkles size={12} />
                        Última oportunidade
                      </span>
                    )}
                    {campanha.modalidade_venda === 'black_friday' && (
                      <span
                        className="px-2 py-1 rounded text-xs font-medium flex items-center gap-1"
                        style={{ color: '#f8fafc', backgroundColor: '#111827', border: '1px solid #f59e0b' }}
                      >
                        <Sparkles size={12} style={{ color: '#f59e0b' }} />
                        Black Friday
                      </span>
                    )}
                  </div>
                  {campanha.descricao && (
                    <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                      {campanha.descricao}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>Criada em {new Date(campanha.criado_em).toLocaleDateString('pt-BR')}</span>
                    {(campanha.total_contatos ?? campanha.contatos?.length ?? 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <CheckCircle size={12} style={{ color: 'var(--success)' }} />
                        {campanha.total_contatos ?? campanha.contatos.length} contatos
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {campanha.status === 'rascunho' || campanha.status === 'pausada' ? (
                    <button
                      onClick={() => handleStartCampanha(campanha)}
                      className="btn-primary flex-1 justify-center"
                      style={{ padding: '8px 14px', fontSize: '13px' }}
                    >
                      <Play size={14} />
                      Iniciar
                    </button>
                  ) : campanha.status === 'em_andamento' ? (
                    <>
                      {((campanha.erros_envio ?? 0) > 0 || campanha.contatos?.some((c) => c.status === 'erro_envio')) && (
                        <button
                          onClick={() => handleStartCampanha(campanha, true)}
                          className="btn-primary flex-1 justify-center"
                          style={{ padding: '8px 14px', fontSize: '13px' }}
                        >
                          <RotateCcw size={14} />
                          Reiniciar
                        </button>
                      )}
                      <button
                        onClick={() => handlePauseCampanha(campanha)}
                        className="btn-secondary flex-1 justify-center"
                        style={{ padding: '8px 14px', fontSize: '13px' }}
                      >
                        <Pause size={14} />
                        Pausar
                      </button>
                    </>
                  ) : (
                    <button
                      disabled
                      className="btn-secondary flex-1 justify-center opacity-50"
                      style={{ padding: '8px 14px', fontSize: '13px' }}
                    >
                      <CheckCircle size={14} />
                      Concluida
                    </button>
                  )}
                  <button
                    onClick={() => setReportCampanha(campanha)}
                    className="btn-secondary"
                    style={{ padding: '8px 14px' }}
                    title="Relatório de produtividade"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteCampanhaId(campanha.id)}
                    className="btn-icon"
                    style={{ color: 'var(--error)' }}
                    title="Excluir campanha"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal - Create Campaign */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-4" style={{ flexShrink: 0 }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Nova Campanha
              </h2>
              <button className="btn-icon" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 pb-6" style={{ flex: 1 }}>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                      Nome da Campanha *
                    </label>
                    <input
                      type="text"
                      value={formData.nome}
                      onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                      className="input-dark w-full"
                      placeholder="Ex: Formandos Engenharia 2026"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                      Descricao
                    </label>
                    <textarea
                      value={formData.descricao}
                      onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                      className="input-dark w-full"
                      rows={2}
                      placeholder="Descricao opcional da campanha"
                    />
                  </div>
                </div>

                {/* Message */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Mensagem Inicial *
                  </h3>
                  <div>
                    <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                      Use {`{nome}`} para personalizar
                    </label>
                    <textarea
                      value={formData.mensagem_inicial}
                      onChange={(e) => setFormData({ ...formData, mensagem_inicial: e.target.value })}
                      className="input-dark w-full"
                      rows={8}
                      placeholder="Ola {nome}, tudo bem?&#10;&#10;[esperar 8s]&#10;&#10;Lembra daquele momento..."
                      required
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Use [esperar Xs] para aguardar um tempo, ou [aguardar_resposta] para esperar o contato responder antes de continuar.
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--info)' }}>
                      Dica: use {`{datas_disponiveis}`} no texto para inserir automaticamente as datas cadastradas no campo "Datas e Horarios Disponiveis".
                    </p>
                  </div>
                </div>

                {/* Tipo de Atendimento (padrao usado ao adicionar uma nova data -
                    cada data pode ter seu proprio tipo, veja abaixo) */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Tipo de Atendimento
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Define o tipo padrao ao adicionar uma nova data. Voce pode misturar Visita Externa
                    e Atendimento no Escritorio na mesma campanha, ajustando o tipo de cada data abaixo.
                  </p>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="tipoAtendimento"
                        value="visita_externa"
                        checked={tipoAtendimento === 'visita_externa'}
                        onChange={() => setTipoAtendimento('visita_externa')}
                        className="w-4 h-4"
                      />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Visita Externa</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="tipoAtendimento"
                        value="escritorio"
                        checked={tipoAtendimento === 'escritorio'}
                        onChange={() => setTipoAtendimento('escritorio')}
                        className="w-4 h-4"
                      />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Atendimento no Escritorio</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="tipoAtendimento"
                        value="venda_material"
                        checked={tipoAtendimento === 'venda_material'}
                        onChange={() => {
                          setTipoAtendimento('venda_material');
                          setOpcoesAgendamento([]);
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Venda de Material Fotografico</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="tipoAtendimento"
                        value="venda_ultima"
                        checked={tipoAtendimento === 'venda_ultima'}
                        onChange={() => {
                          setTipoAtendimento('venda_ultima');
                          setOpcoesAgendamento([]);
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Venda - Ultima Oportunidade (pre-venda)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="tipoAtendimento"
                        value="venda_black_friday"
                        checked={tipoAtendimento === 'venda_black_friday'}
                        onChange={() => {
                          setTipoAtendimento('venda_black_friday');
                          setOpcoesAgendamento([]);
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Venda - Black Friday</span>
                    </label>
                  </div>
                </div>

                {tipoAtendimento === 'venda_ultima' && (
                  <div className="space-y-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--warning)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Para formandos que <strong>agendaram e nao compraram</strong> ou que <strong>nunca agendaram</strong>.
                      A IA vende tudo pelo WhatsApp, <strong>sem visita</strong>, mantendo o valor de pre-venda como ultima
                      oportunidade. Na primeira resposta do formando ela envia <strong>1 foto dele (beca ou com a familia) em
                      visualizacao unica</strong>, apresenta os valores e, quando ele escolher a opcao, confere CPF/e-mail e
                      passa para o atendimento humano (link de pagamento + envio das fotos). A IA nunca fala de reciclagem
                      nem de perda das fotos e ignora conversas antigas de agendamento.
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Colunas da planilha: <strong>nome</strong>, <strong>telefone</strong>, <strong>numero_contrato</strong>,{' '}
                      <strong>valor_tabela</strong>, <strong>valor_oferecido</strong> (ou valor_pre_venda),{' '}
                      <strong>formas_pagamento</strong>, <strong>opcoes_plano</strong> (opcional),{' '}
                      <strong>prazo_reciclagem</strong> ou <strong>prazo_pre_venda</strong> (data final da pre-venda),{' '}
                      <strong>quantidade_fotos</strong>, <strong>email</strong> e <strong>cpf</strong>.
                    </p>
                    <p className="text-xs" style={{ color: 'var(--info)' }}>
                      Variaveis: {`{primeiro_nome}`}, {`{quantidade_fotos}`}, {`{valor_tabela}`}, {`{valor_oferecido}`},{' '}
                      {`{formas_pagamento}`}, {`{prazo_pre_venda}`}. Com a "abertura em dois passos" ligada (Envio seguro),
                      apague a primeira linha (cumprimento) da mensagem.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      onClick={() => {
                        setFormData((f) => ({
                          ...f,
                          mensagem_inicial: MENSAGEM_ULTIMA_OPORTUNIDADE,
                          prompt_ia: PROMPT_ULTIMA_OPORTUNIDADE,
                        }));
                        showToast('Mensagem e prompt da Ultima Oportunidade carregados', 'success');
                      }}
                    >
                      <Sparkles size={14} />
                      Usar modelo pronto (mensagem + prompt)
                    </button>
                  </div>
                )}

                {tipoAtendimento === 'venda_black_friday' && (
                  <div className="space-y-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid #f59e0b' }}>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Campanha de <strong>Black Friday</strong>: venda 100% pelo WhatsApp, <strong>sem visita</strong>, com
                      valores bem abaixo da tabela e <strong>desconto unico valido ate a data da Black</strong>. Na primeira
                      resposta do formando a IA envia <strong>1 foto dele (beca ou com a familia) em visualizacao unica</strong>,
                      apresenta tabela x valor Black Friday e, quando ele escolher a opcao, confere CPF/e-mail e passa para o
                      atendimento humano (link de pagamento + envio das fotos). Nunca fala de reciclagem/perda das fotos.
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Colunas da planilha: <strong>nome</strong>, <strong>telefone</strong>, <strong>numero_contrato</strong>,{' '}
                      <strong>valor_tabela</strong>, <strong>valor_oferecido</strong> (valor Black Friday),{' '}
                      <strong>formas_pagamento</strong>, <strong>opcoes_plano</strong> (opcional),{' '}
                      <strong>prazo_black_friday</strong> (data final do desconto), <strong>quantidade_fotos</strong>,{' '}
                      <strong>email</strong> e <strong>cpf</strong>.
                    </p>
                    <p className="text-xs" style={{ color: 'var(--info)' }}>
                      Variaveis: {`{primeiro_nome}`}, {`{quantidade_fotos}`}, {`{valor_tabela}`}, {`{valor_oferecido}`},{' '}
                      {`{formas_pagamento}`}, {`{prazo_black_friday}`}. Com a "abertura em dois passos" ligada (Envio seguro),
                      apague a primeira linha (cumprimento) de cada variacao.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      onClick={() => {
                        setFormData((f) => ({
                          ...f,
                          mensagem_inicial: MENSAGEM_BLACK_FRIDAY,
                          prompt_ia: PROMPT_BLACK_FRIDAY,
                        }));
                        showToast('Mensagem e prompt da Black Friday carregados', 'success');
                      }}
                    >
                      <Sparkles size={14} />
                      Usar modelo pronto (mensagem + prompt)
                    </button>
                  </div>
                )}

                {tipoAtendimento === 'venda_material' && (
                  <div className="space-y-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Nesse tipo de campanha, o valor e as condicoes de cada formando vem da propria
                      planilha (nao ha datas/horarios). Inclua na planilha, alem de nome e telefone,
                      as colunas: <strong>valor_tabela</strong>, <strong>valor_oferecido</strong>,{' '}
                      <strong>formas_pagamento</strong>, <strong>opcoes_plano</strong>,{' '}
                      <strong>prazo_reciclagem</strong> (esta ultima pode ser o mesmo texto pra todos,
                      ex: "31/10/2026"), <strong>quantidade_fotos</strong> (quantidade de fotos do acervo
                      do formando, a IA informa exatamente esse numero), <strong>cpf</strong> e{' '}
                      <strong>email</strong> (a IA pede pro formando confirmar esses dados depois que ele
                      escolhe a opcao, deixando tudo pronto pro link de pagamento).
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--info)' }}>
                      Dica: use {`{valor_tabela}`}, {`{valor_oferecido}`}, {`{formas_pagamento}`},{' '}
                      {`{opcoes_plano}`}, {`{prazo_reciclagem}`} e {`{quantidade_fotos}`} na mensagem
                      inicial e no prompt da IA para personalizar por contrato.
                    </p>
                  </div>
                )}

                {/* Dates and Times */}
                {!ehVenda && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Datas e Horarios Disponiveis
                    </h3>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={() =>
                        setOpcoesAgendamento([
                          ...opcoesAgendamento,
                          tipoAtendimento === 'escritorio'
                            ? { data: '', tipo: 'escritorio', turnos: [], horarios: [] }
                            : { data: '', tipo: 'visita_externa', turnos: [] },
                        ])
                      }
                    >
                      <Plus size={14} />
                      Adicionar Data
                    </button>
                  </div>

                  {opcoesAgendamento.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Nenhuma data adicionada. Clique em "Adicionar Data" para incluir opcoes de agendamento.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {opcoesAgendamento.map((opcao, idx) => {
                        const tipoDaData: 'visita_externa' | 'escritorio' = opcao.tipo || 'visita_externa';
                        return (
                        <div
                          key={idx}
                          className="flex flex-col gap-3 p-3 rounded-lg"
                          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
                        >
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)', minWidth: '60px' }}>
                              Opcao {idx + 1}
                            </span>
                            <input
                              type="date"
                              value={opcao.data}
                              onChange={(e) => {
                                const novas = [...opcoesAgendamento];
                                novas[idx].data = e.target.value;
                                setOpcoesAgendamento(novas);
                              }}
                              className="input-dark"
                              style={{ minWidth: '140px' }}
                            />
                            <div className="flex items-center gap-3 pl-2" style={{ borderLeft: '1px solid var(--border)' }}>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`tipoData-${idx}`}
                                  checked={tipoDaData === 'visita_externa'}
                                  onChange={() => {
                                    const novas = [...opcoesAgendamento];
                                    novas[idx] = { data: novas[idx].data, tipo: 'visita_externa', turnos: [] };
                                    setOpcoesAgendamento(novas);
                                  }}
                                  className="w-3.5 h-3.5"
                                />
                                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Visita Externa</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`tipoData-${idx}`}
                                  checked={tipoDaData === 'escritorio'}
                                  onChange={() => {
                                    const novas = [...opcoesAgendamento];
                                    novas[idx] = { data: novas[idx].data, tipo: 'escritorio', turnos: [], horarios: [] };
                                    setOpcoesAgendamento(novas);
                                  }}
                                  className="w-3.5 h-3.5"
                                />
                                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Escritorio</span>
                              </label>
                            </div>
                            <button
                              type="button"
                              className="btn-icon ml-auto"
                              style={{ padding: '4px', color: 'var(--error)' }}
                              onClick={() => {
                                setOpcoesAgendamento(
                                  opcoesAgendamento.filter((_, i) => i !== idx)
                                );
                              }}
                            >
                              <X size={14} />
                            </button>
                          </div>

                          {tipoDaData === 'visita_externa' ? (
                            <div className="flex items-center gap-4 pl-[72px]">
                              {['Manha (8h as 12h)', 'Tarde (13h as 17h)', 'Noite (18h as 20h)'].map(
                                (turno) => (
                                  <label
                                    key={turno}
                                    className="flex items-center gap-1 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={opcao.turnos.includes(turno)}
                                      onChange={(e) => {
                                        const novas = [...opcoesAgendamento];
                                        if (e.target.checked) {
                                          novas[idx].turnos.push(turno);
                                        } else {
                                          novas[idx].turnos = novas[idx].turnos.filter(
                                            (t) => t !== turno
                                          );
                                        }
                                        setOpcoesAgendamento(novas);
                                      }}
                                      className="w-4 h-4 rounded"
                                    />
                                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                      {turno.split(' ')[0]}
                                    </span>
                                  </label>
                                )
                              )}
                            </div>
                          ) : (
                            <div className="pl-[72px] space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)', minWidth: '48px' }}>Manha:</span>
                                {ESCRITORIO_HORARIOS_MANHA.map((horario) => (
                                  <label key={horario} className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={(opcao.horarios || []).includes(horario)}
                                      onChange={(e) => {
                                        const novas = [...opcoesAgendamento];
                                        const horarios = novas[idx].horarios || [];
                                        if (e.target.checked) {
                                          novas[idx].horarios = [...horarios, horario].sort();
                                        } else {
                                          novas[idx].horarios = horarios.filter((h) => h !== horario);
                                        }
                                        setOpcoesAgendamento(novas);
                                      }}
                                      className="w-4 h-4 rounded"
                                    />
                                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{horario}</span>
                                  </label>
                                ))}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)', minWidth: '48px' }}>Tarde:</span>
                                {ESCRITORIO_HORARIOS_TARDE.map((horario) => (
                                  <label key={horario} className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={(opcao.horarios || []).includes(horario)}
                                      onChange={(e) => {
                                        const novas = [...opcoesAgendamento];
                                        const horarios = novas[idx].horarios || [];
                                        if (e.target.checked) {
                                          novas[idx].horarios = [...horarios, horario].sort();
                                        } else {
                                          novas[idx].horarios = horarios.filter((h) => h !== horario);
                                        }
                                        setOpcoesAgendamento(novas);
                                      }}
                                      className="w-4 h-4 rounded"
                                    />
                                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{horario}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}

                {/* Preview Blocks */}
                {previewBlocks.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Preview dos Blocos ({previewBlocks.length} mensagens)
                    </h3>
                    <div className="space-y-2">
                      {previewBlocks.map((block, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg text-sm"
                          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                              Bloco {block.ordem}
                            </span>
                            {block.delayBloco > 0 && (
                              <span
                                className="text-xs px-2 py-0.5 rounded"
                                style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}
                              >
                                +{block.delayBloco}s delay
                              </span>
                            )}
                          </div>
                          <p style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                            {block.texto.substring(0, 200)}
                            {block.texto.length > 200 && '...'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Prompt */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Prompt da IA (Opcional)
                  </h3>
                  <div>
                    <textarea
                      value={formData.prompt_ia}
                      onChange={(e) => setFormData({ ...formData, prompt_ia: e.target.value })}
                      className="input-dark w-full"
                      rows={4}
                      placeholder="Voce e a Sophia, assistente de formaturas..."
                    />
                  </div>
                </div>

                {/* File Upload */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Importar Contatos
                  </h3>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <button
                    type="button"
                    className="w-full p-8 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-3 transition-all"
                    style={{
                      borderColor: uploadedFile ? 'var(--success)' : 'var(--border)',
                      backgroundColor: uploadedFile ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-primary)',
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isParsingFile ? (
                      <>
                        <Loader2 className="animate-spin" size={24} style={{ color: 'var(--primary)' }} />
                        <span style={{ color: 'var(--text-muted)' }}>Processando arquivo...</span>
                      </>
                    ) : uploadedFile ? (
                      <>
                        <CheckCircle size={24} style={{ color: 'var(--success)' }} />
                        <span style={{ color: 'var(--success)' }}>{uploadedFile.name}</span>
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          {uploadedContacts.length} contatos encontrados
                        </span>
                      </>
                    ) : (
                      <>
                        <Upload size={24} style={{ color: 'var(--text-muted)' }} />
                        <span style={{ color: 'var(--text-muted)' }}>Clique para selecionar arquivo CSV ou Excel</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Colunas obrigatorias: nome, telefone
                        </span>
                      </>
                    )}
                  </button>

                  {parseError && (
                    <div
                      className="flex items-start gap-2 p-3 rounded-lg"
                      style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                    >
                      <AlertCircle size={16} style={{ color: 'var(--error)', flexShrink: 0, marginTop: '2px' }} />
                      <span className="text-xs" style={{ color: 'var(--error)', whiteSpace: 'pre-wrap' }}>
                        {parseError}
                      </span>
                    </div>
                  )}
                </div>

                {/* Submit */}
                <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setIsModalOpen(false);
                      resetForm();
                    }}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Criando...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={16} />
                        <span>Criar Campanha</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteCampanhaId && (
        <div className="modal-overlay" onClick={() => setDeleteCampanhaId(null)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Confirmar Exclusao
              </h2>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                Digite a senha para confirmar a exclusao da campanha.
              </p>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="input-dark w-full mb-4"
                placeholder="Senha"
                autoFocus
              />
              <div className="flex justify-end gap-3">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setDeleteCampanhaId(null);
                    setDeletePassword('');
                  }}
                >
                  Cancelar
                </button>
                <button className="btn-primary" onClick={handleDeleteCampanha} disabled={isDeleting}>
                  {isDeleting ? <Loader2 className="animate-spin" size={18} /> : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {reportCampanha && (
        <CampaignReportModal
          campaignId={reportCampanha.id}
          campaignName={reportCampanha.nome}
          onClose={() => setReportCampanha(null)}
        />
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
