import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  Filter,
  Eye,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle,
  AlertCircle,
  Clock,
  Ban,
  ShoppingCart,
  Download,
  ChevronDown,
  ChevronUp,
  Check,
  Plus,
  Upload,
  Loader2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/Toast';

interface DBAppointment {
  id: string;
  contact_id: string | null;
  date: string;
  shift: string | null;
  status: string;
  notes: string | null;
  graduand_name: string | null;
  contract_number: string | null;
  course: string | null;
  location: string | null;
  seller_name: string | null;
  sale_value: number | null;
  created_at: string;
}

const statusConfig: Record<string, { label: string; badgeClass: string; icon: typeof CheckCircle }> = {
  scheduled: { label: 'Agendado', badgeClass: 'badge-info', icon: Clock },
  confirmed: { label: 'Confirmado', badgeClass: 'badge-info', icon: CheckCircle },
  completed: { label: 'Concluido', badgeClass: 'badge-success', icon: CheckCircle },
  cancelled: { label: 'Cancelado', badgeClass: 'badge-error', icon: Ban },
  no_show: { label: 'No-show', badgeClass: 'badge-warning', icon: AlertCircle },
  sold: { label: 'Vendido', badgeClass: 'badge-success', icon: ShoppingCart },
  'Vendido': { label: 'Vendido', badgeClass: 'badge-success', icon: ShoppingCart },
  'vendido': { label: 'Vendido', badgeClass: 'badge-success', icon: ShoppingCart },
  pending: { label: 'Pendente', badgeClass: 'badge-neutral', icon: Clock },
  'Em negociacao': { label: 'Em Negociacao', badgeClass: 'badge-warning', icon: Clock },
  'Em negociação': { label: 'Em Negociacao', badgeClass: 'badge-warning', icon: Clock },
  'Reagendou': { label: 'Reagendou', badgeClass: 'badge-info', icon: Clock },
  'Ira adquirir em outro momento': { label: 'Ira Adquirir Depois', badgeClass: 'badge-neutral', icon: Clock },
  'Nao compareceu': { label: 'Nao Compareceu', badgeClass: 'badge-warning', icon: AlertCircle },
  'Nao compareceu na empresa': { label: 'Nao Compareceu', badgeClass: 'badge-warning', icon: AlertCircle },
  'Nao estava em casa': { label: 'Nao Estava em Casa', badgeClass: 'badge-warning', icon: AlertCircle },
  'Sem condicoes financeiras': { label: 'Sem Condicoes', badgeClass: 'badge-error', icon: Ban },
  'Sem condições financeiras': { label: 'Sem Condicoes', badgeClass: 'badge-error', icon: Ban },
  'Nao gostou das fotos': { label: 'Nao Gostou', badgeClass: 'badge-error', icon: Ban },
};

const SHIFTS = ['Manha', 'Tarde', 'Noite'];
const PAGE_SIZES = [10, 25, 50, 100];

// Convert DD/MM/YYYY to YYYY-MM-DD, or return as-is if already ISO format
const parseDateToISO = (dateStr: string): string => {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const trimmed = dateStr.trim();

  // Check if already ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Check DD/MM/YYYY format
  const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Check D/M/YYYY format (single digits)
  const brMatch2 = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch2) {
    const [, day, month, year] = brMatch2;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try to parse Excel serial date number
  const numDate = Number(trimmed);
  if (!isNaN(numDate) && numDate > 1000 && numDate < 100000) {
    // Excel serial date: days since 1899-12-30
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + numDate * 86400000);
    return date.toISOString().split('T')[0];
  }

  // Fallback: return today
  console.warn('Could not parse date:', trimmed);
  return new Date().toISOString().split('T')[0];
};

type SortField = keyof DBAppointment;

const emptyForm = (): Omit<DBAppointment, 'id' | 'created_at' | 'contact_id'> => ({
  graduand_name: '',
  contract_number: '',
  course: '',
  date: new Date().toISOString().split('T')[0],
  shift: 'Manha',
  location: '',
  seller_name: '',
  status: 'scheduled',
  notes: '',
  sale_value: null,
});

export function Appointments() {
  const [appointments, setAppointments] = useState<DBAppointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sellerFilter, setSellerFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Modals
  const [viewModal, setViewModal] = useState<DBAppointment | null>(null);
  const [editModal, setEditModal] = useState<DBAppointment | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DBAppointment | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  // Form
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toasts, showToast, removeToast } = useToast();

  useEffect(() => {
    fetchAppointments();

    const channel = supabase
      .channel('appointments-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments' }, () => {
        fetchAppointments();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments' }, () => {
        fetchAppointments();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'appointments' }, () => {
        fetchAppointments();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchAppointments = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .order('date', { ascending: false });
    if (!error && data) setAppointments(data as DBAppointment[]);
    setIsLoading(false);
  };

  const sellers = useMemo(() => {
    const names = appointments
      .map((a) => a.seller_name)
      .filter((n): n is string => !!n);
    return [...new Set(names)].sort();
  }, [appointments]);

  const filtered = useMemo(() => {
    let data = [...appointments];

    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(
        (a) =>
          (a.graduand_name?.toLowerCase() || '').includes(q) ||
          (a.contract_number?.toLowerCase() || '').includes(q) ||
          (a.course?.toLowerCase() || '').includes(q) ||
          (a.seller_name?.toLowerCase() || '').includes(q) ||
          (a.location?.toLowerCase() || '').includes(q)
      );
    }

    if (statusFilter !== 'all') data = data.filter((a) => a.status === statusFilter);
    if (sellerFilter !== 'all') data = data.filter((a) => a.seller_name === sellerFilter);

    data.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return data;
  }, [appointments, search, statusFilter, sellerFilter, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === paginated.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(paginated.map((a) => a.id)));
    }
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRows(next);
  };

  const openNew = () => {
    setForm(emptyForm());
    setIsNewModalOpen(true);
  };

  const openEdit = (appt: DBAppointment) => {
    setEditModal(appt);
    setForm({
      graduand_name: appt.graduand_name || '',
      contract_number: appt.contract_number || '',
      course: appt.course || '',
      date: appt.date,
      shift: appt.shift || 'Manha',
      location: appt.location || '',
      seller_name: appt.seller_name || '',
      status: appt.status,
      notes: appt.notes || '',
      sale_value: appt.sale_value,
    });
  };

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.graduand_name?.trim() || !form.date) {
      showToast('Nome e data sao obrigatorios', 'error');
      return;
    }
    setIsSaving(true);
    const { error } = await supabase.from('appointments').insert([form]);
    setIsSaving(false);
    if (error) {
      showToast('Erro ao criar agendamento', 'error');
    } else {
      showToast('Agendamento criado!', 'success');
      setIsNewModalOpen(false);
      fetchAppointments();
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setIsSaving(true);
    const { error } = await supabase
      .from('appointments')
      .update({ ...form, updated_at: new Date().toISOString() })
      .eq('id', editModal.id);
    setIsSaving(false);
    if (error) {
      showToast('Erro ao atualizar agendamento', 'error');
    } else {
      showToast('Agendamento atualizado!', 'success');
      setEditModal(null);
      fetchAppointments();
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setIsDeleting(true);
    const { error } = await supabase.from('appointments').delete().eq('id', deleteConfirm.id);
    setIsDeleting(false);
    if (error) {
      showToast('Erro ao excluir', 'error');
    } else {
      showToast('Agendamento excluido', 'success');
      setDeleteConfirm(null);
      setAppointments((prev) => prev.filter((a) => a.id !== deleteConfirm.id));
    }
  };

  const handleExport = () => {
    const rows = filtered.map((a) => ({
      Nome: a.graduand_name || '',
      Contrato: a.contract_number || '',
      Curso: a.course || '',
      Data: a.date,
    'Turno/Horário': a.shift || '',
      Local: a.location || '',
      Vendedor: a.seller_name || '',
      Status: statusConfig[a.status]?.label || a.status,
      'Valor da Venda': a.sale_value ? `R$ ${a.sale_value.toFixed(2)}` : '',
      Observacoes: a.notes || '',
    }));

    const headers = Object.keys(rows[0] || {});
    const csv = [
      headers.join(';'),
      ...rows.map((r) => headers.map((h) => `"${String(r[h as keyof typeof r]).replace(/"/g, '""')}"`).join(';')),
    ].join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'agendamentos.csv';
    link.click();
  };

  const parseExcelWithSheetJS = async (file: File): Promise<Record<string, unknown>[]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
  };

  const parseCSV = async (file: File): Promise<Record<string, unknown>[]> => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headerLine = lines[0];
    const headers = headerLine.split(';').map((h) => h.replace(/^"|"$/g, '').trim());

    const parseRow = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ';' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (cols.length === 0 || !cols[0]) continue;
      const row: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        if (cols[idx] !== undefined) row[h] = cols[idx];
      });
      rows.push(row);
    }
    return rows;
  };

  const mapRowToAppointment = (row: Record<string, unknown>): Omit<DBAppointment, 'id' | 'created_at' | 'contact_id'> | null => {
    const getVal = (keys: string[]): string => {
      for (const k of keys) {
        const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()] ?? row[k.charAt(0).toUpperCase() + k.slice(1).toLowerCase()];
        if (val !== undefined && val !== null && String(val).trim()) return String(val).trim();
      }
      return '';
    };

    const name = getVal(['Nome', 'nome', 'graduand_name', 'cliente', 'Cliente', 'Cliente']);
    if (!name) return null;

    const rawDate = getVal(['Data', 'data', 'date', 'Date']);
    const parsedDate = parseDateToISO(rawDate);

    const status = getVal(['Status', 'status']) || 'scheduled';

    // Parse sale value from import
    const rawSaleValue = getVal(['Valor da Venda', 'valor da venda', 'valor_venda', 'Valor Venda', 'Valor', 'sale_value', 'Sale Value']);
    let saleValue: number | null = null;
    if (rawSaleValue) {
      const cleaned = rawSaleValue.replace(/[R$\s.]/g, '').replace(',', '.');
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0) {
        saleValue = parsed;
      }
    }

    return {
      graduand_name: name,
      contract_number: getVal(['Contrato', 'contrato', 'contract_number', 'Contract Number']),
      course: getVal(['Curso', 'curso', 'course', 'Course']),
      date: parsedDate,
      shift: getVal(['Turno', 'turno', 'shift', 'Shift']) || 'Manha',
      location: getVal(['Local', 'local', 'location', 'Location']),
      seller_name: getVal(['Vendedor', 'vendedor', 'seller_name', 'Seller Name']),
      status,
      notes: getVal(['Observacoes', 'observacoes', 'notes', 'Notes']),
      sale_value: saleValue,
    };
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const fileName = file.name.toLowerCase();
      let rowsData: Record<string, unknown>[];

      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        rowsData = await parseExcelWithSheetJS(file);
      } else if (fileName.endsWith('.csv')) {
        rowsData = await parseCSV(file);
      } else {
        showToast('Formato nao suportado. Use .csv, .xlsx ou .xls', 'error');
        setIsImporting(false);
        return;
      }

      if (rowsData.length === 0) {
        showToast('Arquivo vazio ou sem dados validos', 'error');
        setIsImporting(false);
        return;
      }

      const rows: Omit<DBAppointment, 'id' | 'created_at' | 'contact_id'>[] = [];
      for (const rowData of rowsData) {
        const mapped = mapRowToAppointment(rowData);
        if (mapped) rows.push(mapped);
      }

      if (rows.length === 0) {
        showToast('Nenhum dado valido encontrado. Verifique os nomes das colunas.', 'error');
        setIsImporting(false);
        return;
      }

      const { error } = await supabase.from('appointments').insert(rows);
      if (error) {
        showToast('Erro na importacao: ' + error.message, 'error');
      } else {
        showToast(`${rows.length} agendamentos importados!`, 'success');
        fetchAppointments();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      showToast('Erro ao importar: ' + msg, 'error');
    }

    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatCurrency = (value: number | null) => {
    if (!value) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'dd/MM/yyyy');
    } catch {
      return dateStr;
    }
  };

  const COLS = [
    { key: 'graduand_name' as SortField, label: 'Nome' },
    { key: 'contract_number' as SortField, label: 'Contrato' },
    { key: 'course' as SortField, label: 'Curso' },
    { key: 'date' as SortField, label: 'Data' },
    { key: 'shift' as SortField, label: 'Turno/Horário' },
    { key: 'location' as SortField, label: 'Local' },
    { key: 'seller_name' as SortField, label: 'Vendedor' },
    { key: 'status' as SortField, label: 'Status' },
    { key: 'sale_value' as SortField, label: 'Valor' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Agendamentos
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {isLoading ? 'Carregando...' : `${filtered.length} agendamentos encontrados`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="btn-secondary cursor-pointer">
            {isImporting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Importando...</span>
              </>
            ) : (
              <>
                <Upload size={16} />
                <span>Importar CSV/Excel</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleImportExcel}
              disabled={isImporting}
            />
          </label>
          <button onClick={handleExport} className="btn-secondary" disabled={filtered.length === 0}>
            <Download size={16} />
            <span>Exportar CSV</span>
          </button>
          <button onClick={openNew} className="btn-primary">
            <Plus size={16} />
            <span>Novo Agendamento</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar por nome, contrato, curso, vendedor..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input-dark w-full pl-10"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={16} style={{ color: 'var(--text-muted)' }} />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-dark"
            style={{ minWidth: '140px' }}
          >
            <option value="all">Todos os status</option>
            {Object.entries(statusConfig).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <select
            value={sellerFilter}
            onChange={(e) => { setSellerFilter(e.target.value); setPage(1); }}
            className="input-dark"
            style={{ minWidth: '160px' }}
          >
            <option value="all">Todos os vendedores</option>
            {sellers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : (
            <table className="table-dark">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={paginated.length > 0 && selectedRows.size === paginated.length}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </th>
                  {COLS.map((col) => (
                    <th
                      key={col.key}
                      className="cursor-pointer select-none"
                      onClick={() => handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        {sortField === col.key && (
                          sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="w-32">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={COLS.length + 2} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                      Nenhum agendamento encontrado
                    </td>
                  </tr>
                ) : (
                  paginated.map((appt) => {
                    const status = statusConfig[appt.status] || statusConfig.pending;
                    const StatusIcon = status.icon;
                    return (
                      <tr key={appt.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedRows.has(appt.id)}
                            onChange={() => toggleRow(appt.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="font-medium">{appt.graduand_name || '-'}</td>
                        <td>{appt.contract_number || '-'}</td>
                        <td>{appt.course || '-'}</td>
                        <td>{formatDate(appt.date)}</td>
                        <td>{appt.shift || '-'}</td>
                        <td>{appt.location || '-'}</td>
                        <td>{appt.seller_name || '-'}</td>
                        <td>
                          <span className={`badge ${status.badgeClass}`}>
                            <StatusIcon size={12} />
                            {status.label}
                          </span>
                        </td>
                        <td>{formatCurrency(appt.sale_value)}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setViewModal(appt)} className="btn-icon" title="Visualizar">
                              <Eye size={16} />
                            </button>
                            <button onClick={() => openEdit(appt)} className="btn-icon" title="Editar">
                              <Pencil size={16} />
                            </button>
                            <button onClick={() => setDeleteConfirm(appt)} className="btn-icon" title="Excluir" style={{ color: 'var(--error)' }}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!isLoading && filtered.length > 0 && (
          <div
            className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 gap-3"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {(page - 1) * pageSize + 1} – {Math.min(page * pageSize, filtered.length)} de {filtered.length}
              </span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="input-dark"
                style={{ padding: '6px 10px', fontSize: '13px' }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size} / pagina</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="btn-icon">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm px-3" style={{ color: 'var(--text-secondary)' }}>
                Pagina {page} de {totalPages}
              </span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="btn-icon">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New/Edit Modal (shared form) */}
      {(isNewModalOpen || editModal !== null) && (
        <div className="modal-overlay" onClick={() => { setIsNewModalOpen(false); setEditModal(null); }}>
          <div className="modal-content" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editModal ? 'Editar Agendamento' : 'Novo Agendamento'}
              </h2>
              <button onClick={() => { setIsNewModalOpen(false); setEditModal(null); }} className="btn-icon">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={editModal ? handleSaveEdit : handleSaveNew} className="p-6 pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Nome do Formando *</label>
                  <input
                    type="text"
                    value={form.graduand_name || ''}
                    onChange={(e) => setForm({ ...form, graduand_name: e.target.value })}
                    className="input-dark w-full"
                    placeholder="Nome completo"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Numero do Contrato</label>
                  <input
                    type="text"
                    value={form.contract_number || ''}
                    onChange={(e) => setForm({ ...form, contract_number: e.target.value })}
                    className="input-dark w-full"
                    placeholder="CNT-00000"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Curso</label>
                  <input
                    type="text"
                    value={form.course || ''}
                    onChange={(e) => setForm({ ...form, course: e.target.value })}
                    className="input-dark w-full"
                    placeholder="Ex: Engenharia"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Data *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="input-dark w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Turno/Horário</label>
                  <select
                    value={form.shift || 'Manha'}
                    onChange={(e) => setForm({ ...form, shift: e.target.value })}
                    className="input-dark w-full"
                  >
                    {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Local</label>
                  <input
                    type="text"
                    value={form.location || ''}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="input-dark w-full"
                    placeholder="Digite o local (ex: Sao Paulo, Rio de Janeiro...)"
                    list="locations-list"
                  />
                  <datalist id="locations-list">
                    <option value="Sao Paulo" />
                    <option value="Rio de Janeiro" />
                    <option value="Campinas" />
                    <option value="Belo Horizonte" />
                    <option value="Curitiba" />
                    <option value="Salvador" />
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendedor</label>
                  <input
                    type="text"
                    value={form.seller_name || ''}
                    onChange={(e) => setForm({ ...form, seller_name: e.target.value })}
                    className="input-dark w-full"
                    placeholder="Nome do vendedor"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="input-dark w-full"
                  >
                    {Object.entries(statusConfig).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                {(form.status === 'sold' || form.status.toLowerCase() === 'vendido') && (
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Valor da Venda *</label>
                    <input
                      type="number"
                      value={form.sale_value || ''}
                      onChange={(e) => setForm({ ...form, sale_value: e.target.value ? Number(e.target.value) : null })}
                      className="input-dark w-full"
                      placeholder="0.00"
                      step="0.01"
                      required
                    />
                  </div>
                )}
                <div className={form.status === 'sold' ? '' : 'col-span-2'}>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Observacoes</label>
                  <textarea
                    value={form.notes || ''}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="input-dark w-full resize-none"
                    rows={2}
                    placeholder="Opcional..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setIsNewModalOpen(false); setEditModal(null); }} className="btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={isSaving} className="btn-primary">
                  {isSaving ? (
                    <><Loader2 size={16} className="animate-spin" /><span>Salvando...</span></>
                  ) : (
                    <><Check size={16} /><span>{editModal ? 'Atualizar' : 'Criar'}</span></>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewModal && (
        <div className="modal-overlay" onClick={() => setViewModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Detalhes do Agendamento
                </h2>
                <button onClick={() => setViewModal(null)} className="btn-icon"><X size={20} /></button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  ['Nome', viewModal.graduand_name],
                  ['Contrato', viewModal.contract_number],
                  ['Curso', viewModal.course],
                  ['Data', formatDate(viewModal.date)],
                  ['Turno/Horário', viewModal.shift],
                  ['Local', viewModal.location],
                  ['Vendedor', viewModal.seller_name],
                  ['Status', statusConfig[viewModal.status]?.label || viewModal.status],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{value || '-'}</p>
                  </div>
                ))}
              </div>
              {viewModal.sale_value && (
                <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Valor da Venda</p>
                  <p className="text-lg font-semibold" style={{ color: 'var(--accent-primary)' }}>
                    {formatCurrency(viewModal.sale_value)}
                  </p>
                </div>
              )}
              {viewModal.notes && (
                <div className="mt-4">
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Observacoes</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{viewModal.notes}</p>
                </div>
              )}
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setViewModal(null); openEdit(viewModal); }} className="btn-secondary">
                  <Pencil size={16} />
                  Editar
                </button>
                <button onClick={() => setViewModal(null)} className="btn-secondary">Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)' }}>
                  <Trash2 size={20} style={{ color: 'var(--error)' }} />
                </div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Confirmar Exclusao</h2>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Excluir o agendamento de{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{deleteConfirm.graduand_name || 'este registro'}</strong>?
                Esta acao nao pode ser desfeita.
              </p>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">Cancelar</button>
                <button onClick={handleDelete} disabled={isDeleting} className="btn-danger">
                  {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  Excluir
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
