import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Pause,
  Upload,
  FileSpreadsheet,
  Users,
  Calendar,
  CheckCircle,
  AlertCircle,
  Clock,
  Filter,
  Search,
  Loader2,
  X,
  RefreshCw,
  User,
  Bot,
  Download,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { pauseCampaign } from '../lib/campaign-runner';
import type { Campaign, CampaignContact } from '../types';

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  pending: { label: 'Pendente', color: 'var(--text-muted)', bg: 'rgba(100, 116, 139, 0.15)' },
  pendente: { label: 'Pendente', color: 'var(--text-muted)', bg: 'rgba(100, 116, 139, 0.15)' },
  sent: { label: 'Enviado', color: 'var(--info)', bg: 'rgba(59, 130, 246, 0.15)' },
  scheduled: { label: 'Agendado', color: 'var(--success)', bg: 'rgba(34, 197, 94, 0.15)' },
  agendado: { label: 'Agendado', color: 'var(--success)', bg: 'rgba(34, 197, 94, 0.15)' },
  overflow: { label: 'Overflow', color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.15)' },
  transbordado_humano: { label: 'Overflow', color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.15)' },
  failed: { label: 'Erro', color: 'var(--error)', bg: 'rgba(239, 68, 68, 0.15)' },
  erro_envio: { label: 'Erro', color: 'var(--error)', bg: 'rgba(239, 68, 68, 0.15)' },
  em_atendimento: { label: 'Em Atendimento', color: 'var(--info)', bg: 'rgba(59, 130, 246, 0.15)' },
  sem_resposta: { label: 'Sem Resposta', color: 'var(--text-muted)', bg: 'rgba(100, 116, 139, 0.15)' },
};

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [isAddContactsModalOpen, setIsAddContactsModalOpen] = useState(false);
  const [deleteCampaignId, setDeleteCampaignId] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // File upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedContacts, setUploadedContacts] = useState<
    Array<{ nome: string; telefone: string; numero_contrato?: string; curso?: string; endereco?: string }>
  >([]);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [isSavingContacts, setIsSavingContacts] = useState(false);

  const { toasts, showToast, removeToast } = useToast();

  useEffect(() => {
    if (id) {
      fetchCampaign();
      fetchContacts();
    }
  }, [id]);

  const fetchCampaign = async () => {
    if (!id) return;
    setIsLoading(true);
    const { data, error } = await supabase.from('campaigns').select('*').eq('id', id).single();
    if (error) {
      showToast('Erro ao carregar campanha', 'error');
      navigate('/campaigns');
    } else if (data) {
      setCampaign(data as Campaign);
    }
    setIsLoading(false);
  };

  const fetchContacts = async () => {
    if (!id) return;
    setIsLoadingContacts(true);
    let query = supabase.from('campaign_contacts').select('*').eq('campaign_id', id);

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    if (search) {
      query = query.or(`nome_formando.ilike.%${search}%,telefone.ilike.%${search}%`);
    }

    query = query.order('criado_em', { ascending: false });

    const { data, error } = await query;
    if (!error && data) {
      setContacts(data as CampaignContact[]);
    }
    setIsLoadingContacts(false);
  };

  useEffect(() => {
    fetchContacts();
  }, [statusFilter, search]);

  const handleStartCampaign = async () => {
    if (!campaign) return;
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-campaign', {
        body: { campanha_id: campaign.id },
      });

      if (error) {
        console.error('Erro ao iniciar campanha:', error);
        showToast(`Erro: ${error.message}`, 'error');
      } else if (data?.success) {
        showToast(`Campanha iniciada! ${data.contatos} contatos, ${data.itens_fila} mensagens`, 'success');
        fetchCampaign();
        fetchContacts();
      } else if (data?.message) {
        showToast(data.message, 'info');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      showToast(`Erro ao iniciar campanha: ${errorMsg}`, 'error');
    }
    setIsRunning(false);
  };

  const handlePauseCampaign = async () => {
    if (!campaign) return;
    setIsRunning(true);
    try {
      await pauseCampaign(campaign.id);
      showToast('Campanha pausada', 'success');
      fetchCampaign();
    } catch (err) {
      showToast('Erro ao pausar campanha', 'error');
    }
    setIsRunning(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsParsingFile(true);

    try {
      if (file.name.endsWith('.csv') || file.type === 'text/csv') {
        const text = await file.text();
        const parsed = parseContactsCSV(text);
        setUploadedContacts(parsed);
        showToast(`${parsed.length} contatos encontrados`, 'success');
      } else {
        showToast('Para arquivos Excel, use formato CSV', 'error');
        setUploadedFile(null);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao processar arquivo';
      showToast(errorMessage, 'error');
      setUploadedContacts([]);
    }

    setIsParsingFile(false);
  };

  const parseContactsCSV = (text: string) => {
    // Normalize line endings and handle BOM
    const normalizedText = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^\uFEFF/, '')
      .trim();

    const lines = normalizedText.split('\n').filter((l) => l.trim());

    if (lines.length < 2) {
      throw new Error('Arquivo vazio ou sem cabecalho.\nVerifique se o arquivo tem cabecalho na primeira linha e dados nas linhas seguintes.');
    }

    // Detect separator (semicolon for PT-BR, comma for US)
    const firstLine = lines[0];
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const separator = semicolonCount >= commaCount ? ';' : ',';

    // Parse CSV line properly handling quoted fields
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
      h.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
    );

    const nomeIdx = headers.findIndex((h) => h.includes('nome') || h.includes('formando'));
    const telefoneIdx = headers.findIndex((h) =>
      h.includes('telefone') || h.includes('celular') || h.includes('fone') || h.includes('whatsapp') || h.includes('phone') || h.includes('tel')
    );
    const contratoIdx = headers.findIndex(
      (h) => h.includes('contrato') || h.includes('numero') || h.includes('cnt')
    );
    const cursoIdx = headers.findIndex((h) => h.includes('curso'));
    const enderecoIdx = headers.findIndex((h) => h.includes('endereco') || h.includes('address'));

    if (nomeIdx === -1 || telefoneIdx === -1) {
      const foundHeaders = rawHeaders.join(', ');
      const missing = [];
      if (nomeIdx === -1) missing.push('nome');
      if (telefoneIdx === -1) missing.push('telefone');
      throw new Error(`Colunas obrigatorias nao encontradas: ${missing.join(', ')}.\n\nCabecalhos encontrados: ${foundHeaders}`);
    }

    const parsed: Array<{ nome: string; telefone: string; numero_contrato?: string; curso?: string; endereco?: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        if (values.length < Math.max(nomeIdx, telefoneIdx) + 1) continue;

        const nome = values[nomeIdx];
        const telefone = String(values[telefoneIdx] || '').replace(/\D/g, '');

        if (!nome || !telefone || telefone.length < 10) continue;

        parsed.push({
          nome,
          telefone: telefone.length === 11 ? `55${telefone}` : telefone,
          numero_contrato: contratoIdx !== -1 ? values[contratoIdx] : undefined,
          curso: cursoIdx !== -1 ? values[cursoIdx] : undefined,
          endereco: enderecoIdx !== -1 ? values[enderecoIdx] : undefined,
        });
      } catch (lineErr) {
        console.warn(`Error parsing line ${i + 1}:`, lineErr);
        continue;
      }
    }

    if (parsed.length === 0) {
      throw new Error('Nenhum contato valido encontrado.\n\nPossiveis causas:\n- Telefones com menos de 10 digitos\n- Campo nome vazio\n- Formato de arquivo incorreto');
    }

    return parsed;
  };

  const handleAddContacts = async () => {
    if (!id || uploadedContacts.length === 0) return;

    setIsSavingContacts(true);

    const contactsToInsert = uploadedContacts.map((c) => ({
      campaign_id: id,
      nome_formando: c.nome,
      telefone: c.telefone,
      numero_contrato: c.numero_contrato || null,
      status: 'pendente',
    }));

    const { error } = await supabase.from('campaign_contacts').insert(contactsToInsert);

    setIsSavingContacts(false);

    if (error) {
      console.error('Error adding contacts:', error);
      showToast('Erro ao adicionar contatos', 'error');
    } else {
      // Update contacts count
      await supabase
        .from('campaigns')
        .update({ contacts_count: (campaign?.contacts_count || 0) + uploadedContacts.length })
        .eq('id', id);

      showToast(`${uploadedContacts.length} contatos adicionados!`, 'success');
      setIsAddContactsModalOpen(false);
      setUploadedFile(null);
      setUploadedContacts([]);
      fetchContacts();
      fetchCampaign();
    }
  };

  const handleDeleteCampaign = async () => {
    if (!deleteCampaignId) return;

    if (deletePassword !== '3673') {
      showToast('Senha incorreta', 'error');
      return;
    }

    setIsDeleting(true);

    const { error } = await supabase.from('campaigns').delete().eq('id', deleteCampaignId);

    setIsDeleting(false);

    if (error) {
      showToast('Erro ao excluir campanha', 'error');
    } else {
      showToast('Campanha excluida com sucesso', 'success');
      navigate('/campaigns');
    }
  };

  const exportContacts = () => {
    const headers = ['Nome', 'Telefone', 'Contrato', 'Curso', 'Status'];
    const rows = contacts.map((c) => [
      c.nome,
      c.telefone,
      c.numero_contrato || '',
      c.curso || '',
      c.status,
    ]);

    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `campanha_${campaign?.name || 'contatos'}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <Loader2 size={32} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-12">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Campanha nao encontrada
        </p>
      </div>
    );
  }

  const stats = {
    total: contacts.length,
    pending: contacts.filter((c) => c.status === 'pending').length,
    sent: contacts.filter((c) => c.status === 'sent').length,
    scheduled: contacts.filter((c) => c.status === 'scheduled').length,
    overflow: contacts.filter((c) => c.status === 'overflow').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/campaigns')} className="btn-icon">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {campaign.name}
            </h1>
            <span
              className="badge"
              style={{
                backgroundColor:
                  campaign.status === 'finished'
                    ? 'rgba(34, 197, 94, 0.15)'
                    : campaign.status === 'running'
                      ? 'rgba(59, 130, 246, 0.15)'
                      : campaign.status === 'paused'
                        ? 'rgba(100, 116, 139, 0.15)'
                        : 'rgba(245, 158, 11, 0.15)',
                color:
                  campaign.status === 'finished'
                    ? 'var(--success)'
                    : campaign.status === 'running'
                      ? 'var(--accent-primary)'
                      : campaign.status === 'paused'
                        ? 'var(--text-muted)'
                        : 'var(--warning)',
              }}
            >
              {campaign.status === 'finished'
                ? 'Concluida'
                : campaign.status === 'running'
                  ? 'Em andamento'
                  : campaign.status === 'paused'
                    ? 'Pausada'
                    : 'Rascunho'}
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {campaign.description || `${stats.total} contatos importados`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === 'draft' && (
            <button
              onClick={handleStartCampaign}
              disabled={stats.total === 0 || isRunning}
              className="btn-primary"
              style={{ opacity: stats.total === 0 ? 0.5 : 1 }}
            >
              {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Iniciar Campanha
            </button>
          )}
          {campaign.status === 'running' && (
            <button onClick={handlePauseCampaign} disabled={isRunning} className="btn-secondary">
              {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Pause size={16} />}
              Pausar
            </button>
          )}
          {campaign.status === 'paused' && (
            <button onClick={handleStartCampaign} disabled={isRunning} className="btn-primary">
              {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Retomar
            </button>
          )}
          <button
            onClick={() => setDeleteCampaignId(campaign.id)}
            className="btn-icon"
            style={{ color: 'var(--error)' }}
            title="Excluir campanha"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {stats.total}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-semibold" style={{ color: 'var(--text-muted)' }}>
            {stats.pending}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pendentes</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-semibold" style={{ color: 'var(--info)' }}>
            {stats.sent}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Enviados</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-semibold" style={{ color: 'var(--success)' }}>
            {stats.scheduled}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Agendados</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-semibold" style={{ color: 'var(--warning)' }}>
            {stats.overflow}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Overflow</p>
        </div>
      </div>

      {/* Contacts List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Users size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Contatos da Campanha
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportContacts} className="btn-secondary" style={{ padding: '6px 12px' }}>
              <Download size={14} />
              <span>Exportar</span>
            </button>
            <button
              onClick={() => setIsAddContactsModalOpen(true)}
              className="btn-primary"
              style={{ padding: '6px 12px' }}
            >
              <Upload size={14} />
              <span>Importar</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-dark w-full pl-9"
              placeholder="Buscar por nome ou telefone..."
              style={{ fontSize: '13px' }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-dark"
            style={{ minWidth: '140px', fontSize: '13px' }}
          >
            <option value="all">Todos os status</option>
            <option value="pendente">Pendente</option>
            <option value="em_atendimento">Em Atendimento</option>
            <option value="agendado">Agendado</option>
            <option value="transbordado_humano">Overflow</option>
            <option value="sem_resposta">Sem Resposta</option>
            <option value="erro_envio">Erro</option>
          </select>
        </div>

        {/* Table */}
        {isLoadingContacts ? (
          <div className="text-center py-8">
            <Loader2 size={24} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-8">
            <Users size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhum contato encontrado
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Formando
                  </th>
                  <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Telefone
                  </th>
                  <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Contrato
                  </th>
                  <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Curso
                  </th>
                  <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Status
                  </th>
                  <th className="text-left p-3 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Tipo
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <td className="p-3" style={{ color: 'var(--text-primary)' }}>
                      {contact.nome_formando}
                    </td>
                    <td className="p-3" style={{ color: 'var(--text-secondary)' }}>
                      {contact.telefone}
                    </td>
                    <td className="p-3" style={{ color: 'var(--text-muted)' }}>
                      {contact.numero_contrato || '-'}
                    </td>
                    <td className="p-3" style={{ color: 'var(--text-muted)' }}>
                      {contact.curso || '-'}
                    </td>
                    <td className="p-3">
                      <span
                        className="badge"
                        style={{
                          backgroundColor: STATUS_CONFIG[contact.status]?.bg,
                          color: STATUS_CONFIG[contact.status]?.color,
                        }}
                      >
                        {STATUS_CONFIG[contact.status]?.label || contact.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        {contact.status === 'overflow' ? (
                          <>
                            <User size={12} style={{ color: 'var(--warning)' }} />
                            <span className="text-xs" style={{ color: 'var(--warning)' }}>
                              Manual
                            </span>
                          </>
                        ) : (
                          <>
                            <Bot size={12} style={{ color: '#8B5CF6' }} />
                            <span className="text-xs" style={{ color: '#8B5CF6' }}>
                              IA
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Contacts Modal */}
      {isAddContactsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddContactsModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Importar Contatos
              </h2>
              <button className="btn-icon" onClick={() => setIsAddContactsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="p-6 pt-4 space-y-4">
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all"
                style={{
                  borderColor: uploadedFile ? 'var(--success)' : 'var(--border-default)',
                  backgroundColor: uploadedFile ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-primary)',
                }}
                onClick={() => document.getElementById('file-input-add')?.click()}
              >
                <input
                  id="file-input-add"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                {isParsingFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ color: 'var(--text-muted)' }}>Processando...</span>
                  </div>
                ) : uploadedFile ? (
                  <div>
                    <CheckCircle size={32} className="mx-auto mb-2" style={{ color: 'var(--success)' }} />
                    <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {uploadedFile.name}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--success)' }}>
                      {uploadedContacts.length} contatos encontrados
                    </p>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                    <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Selecione arquivo CSV
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Colunas: nome, telefone, contrato, curso (opcional)
                    </p>
                  </>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => setIsAddContactsModalOpen(false)} className="btn-secondary">
                  Cancelar
                </button>
                <button
                  onClick={handleAddContacts}
                  disabled={uploadedContacts.length === 0 || isSavingContacts}
                  className="btn-primary"
                >
                  {isSavingContacts ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Importando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      <span>Importar {uploadedContacts.length} contatos</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteCampaignId && (
        <div className="modal-overlay" onClick={() => setDeleteCampaignId(null)}>
          <div
            className="modal-content"
            style={{ maxWidth: '400px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div
                className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
              >
                <Trash2 size={24} style={{ color: 'var(--error)' }} />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Excluir Campanha
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                Esta acao nao pode ser desfeita. Digite a senha para confirmar.
              </p>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="input-dark w-full mb-4"
                placeholder="Senha"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteCampaignId(null)}
                  className="btn-secondary flex-1"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteCampaign}
                  disabled={isDeleting || !deletePassword}
                  className="btn-primary flex-1"
                  style={{ backgroundColor: 'var(--error)' }}
                >
                  {isDeleting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  <span>Excluir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
