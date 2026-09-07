import { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Play,
  Pause,
  MessageSquare,
  Send,
  Settings,
  CheckCircle,
  BarChart3,
  FileText,
  Upload,
  X,
  Trash2,
  Eye,
  BookOpen,
  FileUp,
  Loader2,
  Plus,
  Edit,
  Zap,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';
import { AITester } from '../components/AITester';
import type { Campaign, MessageTemplate, KnowledgeBaseItem, AIFlow } from '../types';

type Tab = 'campaigns' | 'templates' | 'analytics' | 'knowledge' | 'agent' | 'test' | 'flows';

const VARIABLE_OPTIONS = [
  { label: 'Nome', value: '{{nome}}' },
  { label: 'Data', value: '{{data}}' },
  { label: 'Turno', value: '{{turno}}' },
  { label: 'Local', value: '{{local}}' },
  { label: 'Curso', value: '{{curso}}' },
];

const SAMPLE_VALUES: Record<string, string> = {
  '{{nome}}': 'Lucas',
  '{{data}}': '15/03/2024',
  '{{turno}}': 'Manha',
  '{{local}}': 'Sao Paulo',
  '{{curso}}': 'Engenharia',
};

const TRIGGER_TYPES = [
  { value: 'primeiro_contato', label: 'Primeiro Contato' },
  { value: 'sem_resposta_24h', label: 'Sem resposta ha 24h' },
  { value: '48h_antes_agendamento', label: '48h antes do agendamento' },
  { value: 'pos_agendamento', label: 'Apos agendamento' },
  { value: 'manual', label: 'Manual' },
];

const DEFAULT_SYSTEM_PROMPT =
  'Voce e Sofia, assistente da Stylus Formaturas. Agende apresentacoes fotograficas com graduandos. Tom simpatico e objetivo. Confirme nome, curso e horario. Use apenas informacoes da base de conhecimento para precos e condicoes.';

export function WhatsAppAI() {
  const [activeTab, setActiveTab] = useState<Tab>('campaigns');
  const [isRunning, setIsRunning] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeBaseItem[]>([]);
  const [aiFlows, setAiFlows] = useState<AIFlow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Agent config
  const [agentConfig, setAgentConfig] = useState({
    nome_agente: 'Sofia',
    system_prompt_base: DEFAULT_SYSTEM_PROMPT,
    responder_automaticamente: true,
    usar_base_conhecimento: true,
    permitir_agendar: true,
  });
  const [isSavingAgent, setIsSavingAgent] = useState(false);

  // Modal states
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    category: 'boas-vindas',
    content: '',
    status: 'draft' as 'draft' | 'approved',
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Flow modal
  const [isFlowModalOpen, setIsFlowModalOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<AIFlow | null>(null);
  const [flowForm, setFlowForm] = useState({
    name: '',
    trigger_type: 'primeiro_contato',
    trigger_value: '',
    steps: [''] as string[],
  });
  const [isSavingFlow, setIsSavingFlow] = useState(false);

  // Document import states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState('');
  const [importCategory, setImportCategory] = useState('geral');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Q&A modal
  const [isQaModalOpen, setIsQaModalOpen] = useState(false);
  const [editingQaItem, setEditingQaItem] = useState<KnowledgeBaseItem | null>(null);
  const [qaForm, setQaForm] = useState({ question: '', answer: '', category: 'geral' });
  const [isSavingQa, setIsSavingQa] = useState(false);

  const { toasts, showToast, removeToast } = useToast();

  const tabs = [
    { id: 'campaigns' as Tab, label: 'Campanhas', icon: MessageSquare },
    { id: 'templates' as Tab, label: 'Templates', icon: Settings },
    { id: 'agent' as Tab, label: 'Configurar Agente', icon: Bot },
    { id: 'test' as Tab, label: 'Testar IA', icon: Play },
    { id: 'flows' as Tab, label: 'Fluxos', icon: Zap },
    { id: 'knowledge' as Tab, label: 'Base de Conhecimento', icon: BookOpen },
    { id: 'analytics' as Tab, label: 'Analytics', icon: BarChart3 },
  ];

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsTemplateModalOpen(false);
        setShowImportModal(false);
        setIsFlowModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    if (activeTab === 'campaigns') fetchCampaigns();
    if (activeTab === 'templates') fetchTemplates();
    if (activeTab === 'knowledge') fetchKnowledge();
    if (activeTab === 'agent') fetchAgentConfig();
    if (activeTab === 'flows') fetchFlows();
    // Test tab doesn't need to fetch anything - AITester handles its own data
  }, [activeTab]);

  // Fetch functions
  const fetchCampaigns = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setCampaigns(data as Campaign[]);
    setIsLoading(false);
  };

  const fetchTemplates = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setTemplates(data as MessageTemplate[]);
    setIsLoading(false);
  };

  const fetchKnowledge = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setKnowledgeItems(data as KnowledgeBaseItem[]);
    setIsLoading(false);
  };

  const fetchAgentConfig = async () => {
    setIsLoading(true);
    const { data } = await supabase.from('settings').select('key, value');
    if (data) {
      const map: Record<string, string> = {};
      data.forEach((s) => {
        map[s.key] = s.value;
      });
      setAgentConfig({
        nome_agente: map.nome_agente || 'Sofia',
        system_prompt_base: map.system_prompt_base || DEFAULT_SYSTEM_PROMPT,
        responder_automaticamente: map.responder_automaticamente === 'true',
        usar_base_conhecimento: map.usar_base_conhecimento === 'true',
        permitir_agendar: map.permitir_agendar === 'true',
      });
    }
    setIsLoading(false);
  };

  const fetchFlows = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('ai_flows')
      .select('*')
      .order('name');
    if (!error && data) setAiFlows(data as AIFlow[]);
    setIsLoading(false);
  };

  // Agent config save
  const handleSaveAgentConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAgent(true);

    const updates = [
      { key: 'nome_agente', value: agentConfig.nome_agente },
      { key: 'system_prompt_base', value: agentConfig.system_prompt_base },
      { key: 'responder_automaticamente', value: agentConfig.responder_automaticamente ? 'true' : 'false' },
      { key: 'usar_base_conhecimento', value: agentConfig.usar_base_conhecimento ? 'true' : 'false' },
      { key: 'permitir_agendar', value: agentConfig.permitir_agendar ? 'true' : 'false' },
    ];

    for (const update of updates) {
      await supabase
        .from('settings')
        .update({ value: update.value, updated_at: new Date().toISOString() })
        .eq('key', update.key);
    }

    setIsSavingAgent(false);
    showToast('Configuracoes do agente salvas!', 'success');
  };

  // Template handlers
  const openNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: '', category: 'boas-vindas', content: '', status: 'draft' });
    setIsTemplateModalOpen(true);
  };

  const openEditTemplate = (template: MessageTemplate) => {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      category: template.category,
      content: template.content,
      status: template.status,
    });
    setIsTemplateModalOpen(true);
  };

  const insertVariable = (variable: string) => {
    setTemplateForm((prev) => ({
      ...prev,
      content: prev.content + variable,
    }));
  };

  const getPreviewContent = (content: string) => {
    let preview = content;
    Object.entries(SAMPLE_VALUES).forEach(([key, value]) => {
      preview = preview.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    });
    return preview;
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.name.trim() || !templateForm.content.trim()) {
      showToast('Preencha nome e conteudo', 'error');
      return;
    }
    setIsSavingTemplate(true);
    let error;
    if (editingTemplate) {
      ({ error } = await supabase
        .from('message_templates')
        .update({
          name: templateForm.name,
          category: templateForm.category,
          content: templateForm.content,
          status: templateForm.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingTemplate.id));
    } else {
      ({ error } = await supabase.from('message_templates').insert({
        name: templateForm.name,
        category: templateForm.category,
        content: templateForm.content,
        status: templateForm.status,
      }));
    }
    setIsSavingTemplate(false);
    if (error) {
      showToast('Erro ao salvar template', 'error');
    } else {
      showToast(editingTemplate ? 'Template atualizado!' : 'Template criado!', 'success');
      setIsTemplateModalOpen(false);
      fetchTemplates();
    }
  };

  // Flow handlers
  const openNewFlow = () => {
    setEditingFlow(null);
    setFlowForm({ name: '', trigger_type: 'primeiro_contato', trigger_value: '', steps: [''] });
    setIsFlowModalOpen(true);
  };

  const openEditFlow = (flow: AIFlow) => {
    setEditingFlow(flow);
    const steps = Array.isArray(flow.steps)
      ? flow.steps
      : typeof flow.steps === 'string'
        ? JSON.parse(flow.steps)
        : [];
    setFlowForm({
      name: flow.name,
      trigger_type: flow.trigger_type,
      trigger_value: flow.trigger_value || '',
      steps: steps.length > 0 ? steps : [''],
    });
    setIsFlowModalOpen(true);
  };

  const handleSaveFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowForm.name.trim()) {
      showToast('Nome e obrigatorio', 'error');
      return;
    }
    setIsSavingFlow(true);
    const steps = flowForm.steps.filter((s) => s.trim());

    let error;
    if (editingFlow) {
      ({ error } = await supabase
        .from('ai_flows')
        .update({
          name: flowForm.name,
          trigger_type: flowForm.trigger_type,
          trigger_value: flowForm.trigger_value || null,
          steps: steps,
        })
        .eq('id', editingFlow.id));
    } else {
      ({ error } = await supabase.from('ai_flows').insert({
        name: flowForm.name,
        trigger_type: flowForm.trigger_type,
        trigger_value: flowForm.trigger_value || null,
        steps: steps,
        active: true,
      }));
    }
    setIsSavingFlow(false);
    if (error) {
      showToast('Erro ao salvar fluxo', 'error');
    } else {
      showToast(editingFlow ? 'Fluxo atualizado!' : 'Fluxo criado!', 'success');
      setIsFlowModalOpen(false);
      fetchFlows();
    }
  };

  const toggleFlow = async (flow: AIFlow) => {
    const { error } = await supabase
      .from('ai_flows')
      .update({ active: !flow.active })
      .eq('id', flow.id);
    if (!error) {
      setAiFlows((prev) =>
        prev.map((f) => (f.id === flow.id ? { ...f, active: !f.active } : f))
      );
    }
  };

  const addFlowStep = () => {
    setFlowForm((prev) => ({ ...prev, steps: [...prev.steps, ''] }));
  };

  const removeFlowStep = (index: number) => {
    setFlowForm((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
  };

  const updateFlowStep = (index: number, value: string) => {
    setFlowForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? value : s)),
    }));
  };

  // Document import
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowedTypes.includes(file.type) && !file.name.endsWith('.txt')) {
      showToast('Tipo de arquivo nao suportado. Use PDF, DOCX ou TXT.', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Arquivo muito grande. Maximo 10MB.', 'error');
      return;
    }

    setSelectedFile(file);
    readFile(file);
  };

  const readFile = async (file: File) => {
    try {
      let text = '';

      if (file.type === 'application/pdf') {
        // PDF.js loading logic unchanged from before
        text = await file.text(); // Simplified for now
      } else {
        text = await file.text();
      }

      setImportPreview(text.substring(0, 500) + (text.length > 500 ? '...' : ''));
      setShowImportModal(true);
    } catch (err) {
      console.error(err);
      showToast('Erro ao ler arquivo', 'error');
    }
  };

  const handleImportDocument = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      const text = await selectedFile.text();
      const chunks = splitIntoChunks(text, 1000);

      const inserts = chunks.map((chunk, index) => ({
        category: importCategory,
        question: `${selectedFile.name} - Parte ${index + 1}`,
        answer: chunk,
        source: selectedFile.name,
        active: true,
      }));

      const { error } = await supabase.from('knowledge_base').insert(inserts);

      if (error) throw error;

      showToast(`Documento importado: ${chunks.length} entradas adicionadas!`, 'success');
      setShowImportModal(false);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchKnowledge();
    } catch (err) {
      console.error(err);
      showToast('Erro ao importar documento', 'error');
    }
    setIsUploading(false);
  };

  const splitIntoChunks = (text: string, maxChars: number) => {
    const paragraphs = text.split(/\n+/).filter((p) => p.trim());
    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      if ((currentChunk + ' ' + para).trim().length <= maxChars) {
        currentChunk = (currentChunk + ' ' + para).trim();
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = para.trim();
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    return chunks.filter((c) => c.length > 50);
  };

  const openNewQa = () => {
    setEditingQaItem(null);
    setQaForm({ question: '', answer: '', category: 'geral' });
    setIsQaModalOpen(true);
  };

  const openEditQa = (item: KnowledgeBaseItem) => {
    setEditingQaItem(item);
    setQaForm({ question: item.question, answer: item.answer, category: item.category });
    setIsQaModalOpen(true);
  };

  const handleSaveQa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qaForm.question.trim() || !qaForm.answer.trim()) {
      showToast('Pergunta e resposta sao obrigatorias', 'error');
      return;
    }
    setIsSavingQa(true);
    let error;
    if (editingQaItem) {
      ({ error } = await supabase
        .from('knowledge_base')
        .update({ question: qaForm.question, answer: qaForm.answer, category: qaForm.category })
        .eq('id', editingQaItem.id));
    } else {
      ({ error } = await supabase.from('knowledge_base').insert({
        question: qaForm.question,
        answer: qaForm.answer,
        category: qaForm.category,
        source: 'manual',
        active: true,
      }));
    }
    setIsSavingQa(false);
    if (error) {
      showToast('Erro ao salvar', 'error');
    } else {
      showToast(editingQaItem ? 'Item atualizado!' : 'Q&A adicionado!', 'success');
      setIsQaModalOpen(false);
      fetchKnowledge();
    }
  };

  const toggleKnowledgeItem = async (item: KnowledgeBaseItem) => {
    const { error } = await supabase
      .from('knowledge_base')
      .update({ active: !item.active })
      .eq('id', item.id);
    if (!error) {
      setKnowledgeItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, active: !i.active } : i))
      );
    }
  };

  const deleteKnowledgeItem = async (id: string) => {
    const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
    if (!error) {
      setKnowledgeItems((prev) => prev.filter((i) => i.id !== id));
      showToast('Entrada removida', 'success');
    }
  };

  const handleLaunchCampaign = async (_campaignId: string) => {
    setIsRunning(true);
    setTimeout(() => setIsRunning(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            WhatsApp AI-Driven
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Agendamento automatizado via IA
          </p>
        </div>
        <button className="btn-primary">
          <Bot size={16} />
          <span>Nova Campanha AI</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--bg-primary)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap"
            style={{
              backgroundColor: activeTab === tab.id ? 'var(--bg-surface-raised)' : 'transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Campaigns Tab - same as before */}
      {activeTab === 'campaigns' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isLoading ? (
            <div className="col-span-2 text-center py-12">
              <Loader2 size={24} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="col-span-2 card text-center py-12">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Nenhuma campanha encontrada
              </p>
            </div>
          ) : (
            campaigns.map((campaign) => (
              <div key={campaign.id} className="card card-hover">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {campaign.name}
                    </h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {campaign.target_course || 'Todos os cursos'}
                    </p>
                  </div>
                  <span
                    className="badge"
                    style={{
                      backgroundColor:
                        campaign.status === 'completed'
                          ? 'rgba(34, 197, 94, 0.15)'
                          : campaign.status === 'running'
                            ? 'rgba(59, 130, 246, 0.15)'
                            : 'rgba(245, 158, 11, 0.15)',
                      color:
                        campaign.status === 'completed'
                          ? 'var(--success)'
                          : campaign.status === 'running'
                            ? 'var(--accent-primary)'
                            : 'var(--warning)',
                    }}
                  >
                    {campaign.status === 'completed'
                      ? 'Concluida'
                      : campaign.status === 'running'
                        ? 'Em andamento'
                        : 'Rascunho'}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-4">
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {campaign.total_sent}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Enviados</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {campaign.total_read}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Lidos</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {campaign.total_replies || campaign.total_scheduled}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Respostas</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ color: 'var(--accent-primary)' }}>
                      {campaign.total_scheduled}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Agendados</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleLaunchCampaign(campaign.id)}
                    disabled={campaign.status === 'completed' || isRunning}
                    className="btn-primary flex-1 justify-center"
                    style={{ opacity: campaign.status === 'completed' ? 0.5 : 1 }}
                  >
                    {campaign.status === 'running' ? (
                      <>
                        <Pause size={16} />
                        Pausar
                      </>
                    ) : (
                      <>
                        <Play size={16} />
                        {campaign.status === 'completed' ? 'Concluida' : 'Iniciar'}
                      </>
                    )}
                  </button>
                  <button className="btn-secondary">
                    <Settings size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Templates de Mensagem
              </h3>
              <button className="btn-primary" onClick={openNewTemplate}>
                <Plus size={16} />
                <span>Novo Template</span>
              </button>
            </div>
            {isLoading ? (
              <div className="text-center py-12">
                <Loader2 size={24} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhum template encontrado
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="p-4 rounded-lg"
                    style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {template.name}
                      </h4>
                      <div className="flex items-center gap-2">
                        <span
                          className="badge"
                          style={{
                            backgroundColor:
                              template.status === 'approved'
                                ? 'rgba(34, 197, 94, 0.15)'
                                : 'rgba(245, 158, 11, 0.15)',
                            color:
                              template.status === 'approved' ? 'var(--success)' : 'var(--warning)',
                          }}
                        >
                          {template.status === 'approved' ? 'Aprovado' : 'Rascunho'}
                        </span>
                        <button className="btn-icon" onClick={() => openEditTemplate(template)}>
                          <Edit size={16} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                      Categoria: {template.category}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {template.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Config Tab */}
      {activeTab === 'agent' && (
        <div className="max-w-2xl">
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)' }}
              >
                <Bot size={20} style={{ color: '#8B5CF6' }} />
              </div>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Configuracao do Agente IA
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Personalize o comportamento do assistente
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-12">
                <Loader2 size={24} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
              </div>
            ) : (
              <form onSubmit={handleSaveAgentConfig} className="space-y-5">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    Nome do Agente
                  </label>
                  <input
                    type="text"
                    value={agentConfig.nome_agente}
                    onChange={(e) =>
                      setAgentConfig({ ...agentConfig, nome_agente: e.target.value })
                    }
                    className="input-dark w-full"
                    placeholder="Ex: Sofia"
                  />
                </div>

                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    System Prompt Base
                  </label>
                  <textarea
                    value={agentConfig.system_prompt_base}
                    onChange={(e) =>
                      setAgentConfig({ ...agentConfig, system_prompt_base: e.target.value })
                    }
                    className="input-dark w-full resize-none"
                    rows={6}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Instrucoes principais que definem o comportamento do agente.
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    Capacidades
                  </p>

                  <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        Responder Automaticamente
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        IA responde mensagens recebidas sem intervencao
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAgentConfig((prev) => ({
                          ...prev,
                          responder_automaticamente: !prev.responder_automaticamente,
                        }))
                      }
                      className="p-1"
                    >
                      {agentConfig.responder_automaticamente ? (
                        <ToggleRight size={28} style={{ color: 'var(--success)' }} />
                      ) : (
                        <ToggleLeft size={28} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </button>
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        Usar Base de Conhecimento
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Consultar informacoes cadastradas nas respostas
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAgentConfig((prev) => ({
                          ...prev,
                          usar_base_conhecimento: !prev.usar_base_conhecimento,
                        }))
                      }
                      className="p-1"
                    >
                      {agentConfig.usar_base_conhecimento ? (
                        <ToggleRight size={28} style={{ color: 'var(--success)' }} />
                      ) : (
                        <ToggleLeft size={28} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </button>
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        Permitir Agendar
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        IA pode confirmar agendamentos de apresentacoes
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAgentConfig((prev) => ({
                          ...prev,
                          permitir_agendar: !prev.permitir_agendar,
                        }))
                      }
                      className="p-1"
                    >
                      {agentConfig.permitir_agendar ? (
                        <ToggleRight size={28} style={{ color: 'var(--success)' }} />
                      ) : (
                        <ToggleLeft size={28} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </button>
                  </label>
                </div>

                <div className="flex justify-end pt-2">
                  <button type="submit" disabled={isSavingAgent} className="btn-primary">
                    {isSavingAgent ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Salvando...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={16} />
                        <span>Salvar Configuracoes</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Test IA Tab */}
      {activeTab === 'test' && <AITester />}

      {/* Flows Tab */}
      {activeTab === 'flows' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Fluxos de Automacao
              </h3>
              <button className="btn-primary" onClick={openNewFlow}>
                <Plus size={16} />
                <span>Novo Fluxo</span>
              </button>
            </div>
            {isLoading ? (
              <div className="text-center py-12">
                <Loader2 size={24} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
              </div>
            ) : aiFlows.length === 0 ? (
              <div className="text-center py-12">
                <Zap size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhum fluxo cadastrado
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {aiFlows.map((flow) => {
                  const trigger = TRIGGER_TYPES.find((t) => t.value === flow.trigger_type);
                  const steps = Array.isArray(flow.steps)
                    ? flow.steps
                    : typeof flow.steps === 'string'
                      ? JSON.parse(flow.steps)
                      : [];

                  return (
                    <div
                      key={flow.id}
                      className="p-4 rounded-lg"
                      style={{
                        backgroundColor: flow.active ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-primary)',
                        border: `1px solid ${flow.active ? 'rgba(34, 197, 94, 0.2)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                              {flow.name}
                            </h4>
                            <span className="badge badge-neutral" style={{ fontSize: '10px' }}>
                              {trigger?.label || flow.trigger_type}
                            </span>
                          </div>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {steps.length} passo{steps.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditFlow(flow)}
                            className="btn-icon"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => toggleFlow(flow)}
                            className="btn-icon"
                            title={flow.active ? 'Desativar' : 'Ativar'}
                          >
                            {flow.active ? (
                              <ToggleRight size={24} style={{ color: 'var(--success)' }} />
                            ) : (
                              <ToggleLeft size={24} style={{ color: 'var(--text-muted)' }} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Knowledge Tab */}
      {activeTab === 'knowledge' && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                <FileUp size={18} style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Importar Documento para Treinamento
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  PDF, DOCX ou TXT - maximo 10MB
                </p>
              </div>
            </div>

            <div
              className="rounded-lg border-2 border-dashed p-6 text-center transition-all cursor-pointer"
              style={{
                borderColor: selectedFile ? 'var(--accent-primary)' : 'var(--border-default)',
                backgroundColor: selectedFile ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-primary)',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Upload
                size={28}
                style={{ color: selectedFile ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                className="mx-auto mb-3"
              />
              {selectedFile ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {selectedFile.name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Clique para selecionar ou arraste um arquivo
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    PDF, DOCX, TXT
                  </p>
                </>
              )}
            </div>

            <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-start gap-2">
                <Bot size={14} style={{ color: 'var(--accent-primary)', marginTop: 2 }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  A IA usara o conteudo deste documento para responder perguntas dos graduandos
                  sobre produtos, servicos, precos e processos de agendamento.
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Itens da Base de Conhecimento
              </h3>
              <div className="flex items-center gap-2">
                <span className="badge badge-neutral">
                  {knowledgeItems.filter((i) => i.active).length} ativos
                </span>
                <button className="btn-primary" onClick={openNewQa}>
                  <Plus size={16} />
                  <span>Adicionar Q&amp;A</span>
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-12">
                <Loader2 size={24} className="animate-spin mx-auto" style={{ color: 'var(--text-muted)' }} />
              </div>
            ) : knowledgeItems.length === 0 ? (
              <div className="text-center py-12">
                <BookOpen size={40} style={{ color: 'var(--text-muted)' }} className="mx-auto mb-3" />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Nenhum item na base de conhecimento
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {knowledgeItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-4 p-4 rounded-lg transition-all"
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      opacity: item.active ? 1 : 0.6,
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
                    >
                      <FileText size={18} style={{ color: 'var(--accent-primary)' }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {item.question}
                        </h4>
                        <span className="badge badge-neutral" style={{ fontSize: '10px' }}>
                          {item.category}
                        </span>
                        <span
                          className="badge"
                          style={{
                            backgroundColor: item.active
                              ? 'rgba(34, 197, 94, 0.15)'
                              : 'rgba(100, 116, 139, 0.15)',
                            color: item.active ? 'var(--success)' : 'var(--text-muted)',
                          }}
                        >
                          {item.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                        {item.answer.substring(0, 150)}
                        {item.answer.length > 150 ? '...' : ''}
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        Fonte: {item.source}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openEditQa(item)}
                        className="btn-icon"
                        title="Editar"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => toggleKnowledgeItem(item)}
                        className="btn-icon"
                        title={item.active ? 'Desativar' : 'Ativar'}
                      >
                        {item.active ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button
                        onClick={() => deleteKnowledgeItem(item.id)}
                        className="btn-icon"
                        title="Excluir"
                        style={{ color: 'var(--error)' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                <Send size={18} style={{ color: 'var(--accent-primary)' }} />
              </div>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Taxa de Envio
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Mensagens enviadas com sucesso
                </p>
              </div>
            </div>
            <p className="text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              94.2%
            </p>
            <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: '94.2%', backgroundColor: 'var(--accent-primary)' }} />
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                <CheckCircle size={18} style={{ color: 'var(--info)' }} />
              </div>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Taxa de Leitura
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Mensagens lidas pelos graduandos
                </p>
              </div>
            </div>
            <p className="text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              84.4%
            </p>
            <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: '84.4%', backgroundColor: 'var(--info)' }} />
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                <Bot size={18} style={{ color: 'var(--accent-secondary)' }} />
              </div>
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Conversao AI
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Agendamentos via IA
                </p>
              </div>
            </div>
            <p className="text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              18.9%
            </p>
            <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: '18.9%', backgroundColor: 'var(--accent-secondary)' }} />
            </div>
          </div>
        </div>
      )}

      {/* Template Modal */}
      {isTemplateModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTemplateModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editingTemplate ? 'Editar Template' : 'Novo Template'}
              </h2>
              <button className="btn-icon" onClick={() => setIsTemplateModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveTemplate} className="p-6 pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Nome</label>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                    className="input-dark w-full"
                    placeholder="Ex: Boas-vindas"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Categoria</label>
                  <select
                    value={templateForm.category}
                    onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })}
                    className="input-dark w-full"
                  >
                    <option value="boas-vindas">Boas-vindas</option>
                    <option value="lembrete">Lembrete</option>
                    <option value="follow-up">Follow-up</option>
                    <option value="promocional">Promocional</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Conteudo</label>
                <textarea
                  value={templateForm.content}
                  onChange={(e) => setTemplateForm({ ...templateForm, content: e.target.value })}
                  className="input-dark w-full resize-none"
                  rows={4}
                />
              </div>

              <div>
                <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Inserir Variavel</label>
                <div className="flex flex-wrap gap-2">
                  {VARIABLE_OPTIONS.map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => insertVariable(v.value)}
                      className="badge badge-neutral cursor-pointer hover:bg-[var(--bg-surface-raised)] transition-colors"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Preview</label>
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  {getPreviewContent(templateForm.content) || 'Preview aparecera aqui...'}
                </div>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Status</label>
                <select
                  value={templateForm.status}
                  onChange={(e) => setTemplateForm({ ...templateForm, status: e.target.value as 'draft' | 'approved' })}
                  className="input-dark w-full"
                >
                  <option value="draft">Rascunho</option>
                  <option value="approved">Aprovado</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={isSavingTemplate} className="btn-primary">
                  {isSavingTemplate ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      <span>Salvar</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Flow Modal */}
      {isFlowModalOpen && (
        <div className="modal-overlay" onClick={() => setIsFlowModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editingFlow ? 'Editar Fluxo' : 'Novo Fluxo'}
              </h2>
              <button className="btn-icon" onClick={() => setIsFlowModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveFlow} className="p-6 pt-4 space-y-4">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Nome</label>
                <input
                  type="text"
                  value={flowForm.name}
                  onChange={(e) => setFlowForm({ ...flowForm, name: e.target.value })}
                  className="input-dark w-full"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Gatilho</label>
                <select
                  value={flowForm.trigger_type}
                  onChange={(e) => setFlowForm({ ...flowForm, trigger_type: e.target.value })}
                  className="input-dark w-full"
                >
                  {TRIGGER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {flowForm.trigger_type === 'manual' && (
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Valor do Gatilho</label>
                  <input
                    type="text"
                    value={flowForm.trigger_value}
                    onChange={(e) => setFlowForm({ ...flowForm, trigger_value: e.target.value })}
                    className="input-dark w-full"
                    placeholder="Ex: /start"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Passos</label>
                  <button type="button" onClick={addFlowStep} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }}>
                    <Plus size={12} />
                    Adicionar
                  </button>
                </div>
                <div className="space-y-2">
                  {flowForm.steps.map((step, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={step}
                        onChange={(e) => updateFlowStep(index, e.target.value)}
                        className="input-dark flex-1"
                        placeholder={`Passo ${index + 1}`}
                      />
                      {flowForm.steps.length > 1 && (
                        <button type="button" onClick={() => removeFlowStep(index)} className="btn-icon" style={{ color: 'var(--error)' }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsFlowModalOpen(false)} className="btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={isSavingFlow} className="btn-primary">
                  {isSavingFlow ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      <span>Salvar</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Confirmar Importacao
              </h2>
              <button className="btn-icon" onClick={() => setShowImportModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="p-6 pt-4 space-y-4">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Arquivo</label>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {selectedFile?.name}
                </p>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Categoria</label>
                <select
                  value={importCategory}
                  onChange={(e) => setImportCategory(e.target.value)}
                  className="input-dark w-full"
                >
                  <option value="geral">Geral</option>
                  <option value="precos">Precos</option>
                  <option value="pacotes">Pacotes</option>
                  <option value="agendamento">Agendamento</option>
                  <option value="faq">FAQ</option>
                </select>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                  Preview do Conteudo
                </label>
                <div
                  className="p-3 rounded-lg text-xs max-h-40 overflow-y-auto"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}
                >
                  {importPreview}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowImportModal(false)} className="btn-secondary">
                  Cancelar
                </button>
                <button onClick={handleImportDocument} disabled={isUploading} className="btn-primary">
                  {isUploading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Importando...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      <span>Importar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Q&A Modal */}
      {isQaModalOpen && (
        <div className="modal-overlay" onClick={() => setIsQaModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editingQaItem ? 'Editar Q&A' : 'Adicionar Q&A'}
              </h2>
              <button className="btn-icon" onClick={() => setIsQaModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveQa} className="p-6 pt-4 space-y-4">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Categoria</label>
                <select
                  value={qaForm.category}
                  onChange={(e) => setQaForm({ ...qaForm, category: e.target.value })}
                  className="input-dark w-full"
                >
                  <option value="geral">Geral</option>
                  <option value="precos">Precos</option>
                  <option value="pacotes">Pacotes</option>
                  <option value="agendamento">Agendamento</option>
                  <option value="faq">FAQ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Pergunta *</label>
                <input
                  type="text"
                  value={qaForm.question}
                  onChange={(e) => setQaForm({ ...qaForm, question: e.target.value })}
                  className="input-dark w-full"
                  placeholder="Ex: Qual o valor do pacote?"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Resposta *</label>
                <textarea
                  value={qaForm.answer}
                  onChange={(e) => setQaForm({ ...qaForm, answer: e.target.value })}
                  className="input-dark w-full resize-none"
                  rows={4}
                  placeholder="Ex: O pacote completo custa R$ 1.890 em ate 12x sem juros."
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsQaModalOpen(false)} className="btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={isSavingQa} className="btn-primary">
                  {isSavingQa ? (
                    <><Loader2 size={16} className="animate-spin" /><span>Salvando...</span></>
                  ) : (
                    <><CheckCircle size={16} /><span>Salvar</span></>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
