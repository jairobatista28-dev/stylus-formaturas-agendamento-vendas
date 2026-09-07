import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  Calendar,
  DollarSign,
  Users,
  Target,
  BarChart3,
  PieChart,
  Clock,
  Loader2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DateRangePicker } from '../components/DateRangePicker';
import { supabase } from '../lib/supabase';

const COLORS = ['#3B82F6', '#F59E0B', '#7C3AED', '#8B5CF6', '#EF4444', '#22C55E', '#EC4899', '#6366F1'];

// Mapeamento de status do banco (portugues) para codigos internos
const STATUS_MAP: Record<string, string> = {
  'Vendido': 'sold',
  'vendido': 'sold',
  'Agendado': 'scheduled',
  'agendado': 'scheduled',
  'Confirmado': 'confirmed',
  'confirmado': 'confirmed',
  'Concluído': 'completed',
  'Concluido': 'completed',
  'Cancelado': 'cancelled',
  'cancelado': 'cancelled',
  'No-show': 'no_show',
  'Pendente': 'pending',
  'pendente': 'pending',
  'Em negociação': 'in_negotiation',
  'Em negociacao': 'in_negotiation',
  'Reagendou': 'rescheduled',
  'Não compareceu': 'no_show',
  'Não compareceu na empresa': 'no_show',
  'Não estava em casa': 'no_show',
  'Sem condições financeiras': 'cancelled',
  'Irá adquirir em outro momento': 'pending',
  'Não gostou das fotos': 'cancelled',
  'sold': 'sold',
};

// Mapeamento reverso para exibicao
const STATUS_DISPLAY: Record<string, string> = {
  'sold': 'Vendido',
  'scheduled': 'Agendado',
  'confirmed': 'Confirmado',
  'completed': 'Concluido',
  'cancelled': 'Cancelado',
  'no_show': 'No-show',
  'pending': 'Pendente',
  'in_negotiation': 'Em negociacao',
  'rescheduled': 'Reagendado',
};

// Normaliza shift removendo acentos
const normalizeShift = (shift: string | null): string => {
  if (!shift) return '';
  const s = shift.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.includes('manh')) return 'Manha';
  if (s.includes('tard')) return 'Tarde';
  if (s.includes('noit')) return 'Noite';
  return shift;
};

const normalizeStatus = (status: string): string => {
  return STATUS_MAP[status] || status;
};

interface DBAppointment {
  id: string;
  date: string;
  shift: string | null;
  status: string;
  location: string | null;
  seller_name: string | null;
  sale_value: number | null;
  graduand_name: string | null;
}

interface SummaryData {
  total_appointments: number;
  total_sales: number;
  total_revenue: number;
  conversion_rate: number;
  average_ticket: number;
}

interface SalesRankingItem {
  name: string;
  total_sales: number;
  total_revenue: number;
  appointments_count: number;
}

export function Dashboard() {
  const [startDate, setStartDate] = useState(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(endOfMonth(new Date()));
  const [appointments, setAppointments] = useState<DBAppointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAppointments();
  }, []);

  const fetchAppointments = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('appointments')
      .select('id, date, shift, status, location, seller_name, sale_value, graduand_name')
      .order('date', { ascending: false });
    if (!error && data) setAppointments(data as DBAppointment[]);
    setIsLoading(false);
  };

  const handleDateChange = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
  };

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      try {
        const d = parseISO(a.date);
        return isWithinInterval(d, { start: startDate, end: endDate });
      } catch {
        return false;
      }
    });
  }, [appointments, startDate, endDate]);

  const summary = useMemo<SummaryData>(() => {
    const total_appointments = filteredAppointments.length;
    const sold = filteredAppointments.filter((a) => normalizeStatus(a.status) === 'sold');
    const total_sales = sold.length;
    const total_revenue = sold.reduce((sum, a) => sum + (a.sale_value || 0), 0);
    const conversion_rate = total_appointments > 0 ? (total_sales / total_appointments) * 100 : 0;
    const average_ticket = total_sales > 0 ? total_revenue / total_sales : 0;

    return {
      total_appointments,
      total_sales,
      total_revenue,
      conversion_rate,
      average_ticket,
    };
  }, [filteredAppointments]);

  const trendData = useMemo(() => {
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    return days.map((day) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayAppointments = filteredAppointments.filter((a) => a.date === dateStr);
      const daySales = dayAppointments.filter((a) => normalizeStatus(a.status) === 'sold');
      return {
        date: dateStr,
        appointments: dayAppointments.length,
        sales: daySales.length,
      };
    });
  }, [filteredAppointments, startDate, endDate]);

  const locationData = useMemo(() => {
    const locationCounts: Record<string, number> = {};
    filteredAppointments.forEach((a) => {
      const loc = a.location || 'Nao informado';
      locationCounts[loc] = (locationCounts[loc] || 0) + 1;
    });
    return Object.entries(locationCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [filteredAppointments]);

  const shiftData = useMemo(() => {
    const shifts = ['Manha', 'Tarde', 'Noite'];
    return shifts.map((shift) => ({
      name: shift,
      value: filteredAppointments.filter((a) => normalizeShift(a.shift) === shift).length,
    }));
  }, [filteredAppointments]);

  const salesRanking = useMemo<SalesRankingItem[]>(() => {
    const sellerStats: Record<string, { sales: number; revenue: number; count: number }> = {};
    filteredAppointments.forEach((a) => {
      const seller = a.seller_name || 'Sem vendedor';
      if (!sellerStats[seller]) sellerStats[seller] = { sales: 0, revenue: 0, count: 0 };
      sellerStats[seller].count++;
      if (normalizeStatus(a.status) === 'sold') {
        sellerStats[seller].sales++;
        sellerStats[seller].revenue += a.sale_value || 0;
      }
    });
    return Object.entries(sellerStats)
      .map(([name, stats]) => ({
        name,
        total_sales: stats.sales,
        total_revenue: stats.revenue,
        appointments_count: stats.count,
      }))
      .filter((sp) => sp.total_sales > 0)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 5);
  }, [filteredAppointments]);

  const statusDistribution = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    filteredAppointments.forEach((a) => {
      const normalizedStatus = normalizeStatus(a.status);
      const label = STATUS_DISPLAY[normalizedStatus] || a.status || 'Indefinido';
      statusCounts[label] = (statusCounts[label] || 0) + 1;
    });
    return Object.entries(statusCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredAppointments]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const summaryCards = [
    {
      title: 'Total Agendamentos',
      value: summary.total_appointments,
      icon: Calendar,
      color: 'var(--accent-primary)',
      bgColor: 'rgba(59, 130, 246, 0.1)',
    },
    {
      title: 'Total Vendas',
      value: summary.total_sales,
      icon: TrendingUp,
      color: 'var(--success)',
      bgColor: 'rgba(34, 197, 94, 0.1)',
    },
    {
      title: 'Receita Total',
      value: formatCurrency(summary.total_revenue),
      icon: DollarSign,
      color: 'var(--accent-secondary)',
      bgColor: 'rgba(245, 158, 11, 0.1)',
    },
    {
      title: 'Ticket Medio',
      value: formatCurrency(summary.average_ticket),
      icon: DollarSign,
      color: 'var(--info)',
      bgColor: 'rgba(59, 130, 246, 0.1)',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Visao geral do periodo: {format(startDate, 'dd MMM yyyy', { locale: ptBR })} - {format(endDate, 'dd MMM yyyy', { locale: ptBR })}
          </p>
        </div>
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={handleDateChange}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card, index) => (
          <div key={index} className="card card-hover">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {card.title}
                </p>
                <p className="text-2xl font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>
                  {card.value}
                </p>
              </div>
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: card.bgColor }}
              >
                <card.icon size={20} style={{ color: card.color }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* KPIs Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversion Rate */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
              <Target size={18} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div>
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Taxa de Conversao
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Agendamentos que viraram vendas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24">
              <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                <defs>
                  <linearGradient id="conversionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3B82F6" />
                    <stop offset="100%" stopColor="#7C3AED" />
                  </linearGradient>
                </defs>
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="var(--bg-surface-raised)"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="url(#conversionGradient)"
                  strokeWidth="3"
                  strokeDasharray={`${summary.conversion_rate}, 100`}
                  strokeLinecap="round"
                  className="transition-all duration-1000"
                  style={{ filter: 'drop-shadow(0 2px 4px rgba(59, 130, 246, 0.35))' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {summary.conversion_rate.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: 'linear-gradient(135deg, #3B82F6, #7C3AED)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {summary.total_sales} vendidos
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--bg-surface-raised)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {summary.total_appointments - summary.total_sales} nao convertidos
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Status Distribution */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)' }}>
              <PieChart size={18} style={{ color: '#8B5CF6' }} />
            </div>
            <div>
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Distribuicao por Status
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Agendamentos no periodo
              </p>
            </div>
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {statusDistribution.map((item, index) => (
              <div key={item.name} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sales Ranking */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
              <BarChart3 size={18} style={{ color: 'var(--info)' }} />
            </div>
            <div>
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Ranking de Vendas
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Top vendedores
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {salesRanking.length === 0 ? (
              <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>Nenhum dado disponivel</p>
            ) : (
              salesRanking.slice(0, 3).map((sp, index) => (
                <div key={sp.name} className="flex items-center gap-3">
                  <span className="text-sm font-semibold w-5" style={{ color: index === 0 ? 'var(--accent-secondary)' : 'var(--text-muted)' }}>
                    {index + 1}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm truncate mr-2" style={{ color: 'var(--text-primary)' }}>
                        {sp.name}
                      </span>
                      <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                        {formatCurrency(sp.total_revenue)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: salesRanking[0].total_revenue > 0
                            ? `${(sp.total_revenue / salesRanking[0].total_revenue) * 100}%`
                            : '0%',
                          backgroundColor: index === 0 ? 'var(--accent-secondary)' : 'var(--accent-primary)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trend Chart */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
              <TrendingUp size={18} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Tendencia de Agendamentos
            </h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorAppointments" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => format(parseISO(date), 'dd/MM')}
                  stroke="var(--text-muted)"
                  fontSize={12}
                  interval="preserveStartEnd"
                />
                <YAxis stroke="var(--text-muted)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                  }}
                  labelFormatter={(date) => format(parseISO(date as string), "dd 'de' MMMM", { locale: ptBR })}
                />
                <Area
                  type="monotone"
                  dataKey="appointments"
                  stroke="var(--accent-primary)"
                  fillOpacity={1}
                  fill="url(#colorAppointments)"
                  strokeWidth={2}
                  name="Agendamentos"
                />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="var(--success)"
                  fill="transparent"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  name="Vendas"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales by Salesperson */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
              <BarChart3 size={18} style={{ color: 'var(--accent-secondary)' }} />
            </div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Vendas por Vendedor
            </h3>
          </div>
          <div className="h-64">
            {salesRanking.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sem dados de vendas</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesRanking} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis type="number" stroke="var(--text-muted)" fontSize={12} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="var(--text-muted)"
                    fontSize={12}
                    width={100}
                    tickFormatter={(name) => name.length > 12 ? name.substring(0, 12) + '...' : name}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                    }}
                    formatter={(value: unknown) => [value as number, 'Vendas']}
                  />
                  <Bar dataKey="total_sales" fill="var(--accent-primary)" radius={[0, 4, 4, 0]} name="Vendas" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Distribution Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Location Distribution */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
              <PieChart size={18} style={{ color: 'var(--info)' }} />
            </div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Distribuicao por Local
            </h3>
          </div>
          <div className="h-64">
            {locationData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sem dados</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={locationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {locationData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                    }}
                  />
                </RePieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Shift Distribution */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)' }}>
              <Clock size={18} style={{ color: '#8B5CF6' }} />
            </div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Distribuicao por Turno
            </h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={shiftData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={4}
                  dataKey="value"
                  label={({ name, value }) => value > 0 ? `${name}: ${value}` : ''}
                  labelLine={false}
                >
                  {shiftData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                  }}
                />
                <Legend
                  formatter={(value) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
