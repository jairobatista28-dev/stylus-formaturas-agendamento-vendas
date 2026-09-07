import { Appointment, Salesperson, Campaign, DashboardSummary } from '../types';

export const mockSalespeople: Salesperson[] = [
  { id: '1', name: 'Ana Silva', email: 'ana@stylus.com', phone: '11999990001', role: 'salesperson', default_location: 'São Paulo', total_sales: 45, total_revenue: 67500, appointments_count: 120 },
  { id: '2', name: 'Bruno Costa', email: 'bruno@stylus.com', phone: '11999990002', role: 'salesperson', default_location: 'Rio de Janeiro', total_sales: 38, total_revenue: 53200, appointments_count: 95 },
  { id: '3', name: 'Carla Mendes', email: 'carla@stylus.com', phone: '11999990003', role: 'salesperson', default_location: 'São Paulo', total_sales: 52, total_revenue: 78000, appointments_count: 140 },
  { id: '4', name: 'Diego Oliveira', email: 'diego@stylus.com', phone: '11999990004', role: 'salesperson', default_location: 'Campinas', total_sales: 30, total_revenue: 42000, appointments_count: 80 },
  { id: '5', name: 'Fernanda Lima', email: 'fernanda@stylus.com', phone: '11999990005', role: 'admin', default_location: 'São Paulo', total_sales: 60, total_revenue: 96000, appointments_count: 160 },
];

export const generateMockAppointments = (): Appointment[] => {
  const statuses: Appointment['status'][] = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'sold'];
  const shifts = ['Manhã', 'Tarde', 'Noite'];
  const locations = ['São Paulo', 'Rio de Janeiro', 'Campinas', 'Belo Horizonte'];
  const courses = ['Engenharia', 'Medicina', 'Direito', 'Administração', 'Psicologia', 'Arquitetura'];
  
  const appointments: Appointment[] = [];
  
  for (let i = 1; i <= 50; i++) {
    const salesperson = mockSalespeople[i % mockSalespeople.length];
    const status = statuses[i % statuses.length];
    const date = new Date();
    date.setDate(date.getDate() - (i % 30));
    
    appointments.push({
      id: `app-${i}`,
      graduand_id: `grad-${i}`,
      graduand_name: `Graduando ${i}`,
      contract: `CNT-${2024}${String(i).padStart(4, '0')}`,
      course: courses[i % courses.length],
      date: date.toISOString().split('T')[0],
      shift: shifts[i % shifts.length],
      location: locations[i % locations.length],
      salesperson: salesperson.name,
      salesperson_id: salesperson.id,
      status,
      sale_value: status === 'sold' ? Math.floor(Math.random() * 1000 + 1000) : null,
      created_at: date.toISOString(),
      calendar_event_id: status !== 'cancelled' ? `cal-${i}` : null,
    });
  }
  
  return appointments;
};

export const mockAppointments = generateMockAppointments();

export const mockCampaigns: Campaign[] = [
  { id: '1', name: 'Campanha Engenharia 2024', audience_filter: 'course:Engenharia', status: 'completed', total_sent: 450, total_read: 380, total_responded: 120, total_scheduled: 85, created_at: '2024-01-15T10:00:00Z', created_by: 'Fernanda Lima' },
  { id: '2', name: 'Campanha Medicina Fevereiro', audience_filter: 'course:Medicina', status: 'running', total_sent: 200, total_read: 150, total_responded: 45, total_scheduled: 30, created_at: '2024-02-01T08:00:00Z', created_by: 'Fernanda Lima' },
  { id: '3', name: 'Campanha Direito Março', audience_filter: 'course:Direito', status: 'draft', total_sent: 0, total_read: 0, total_responded: 0, total_scheduled: 0, created_at: '2024-03-01T09:00:00Z', created_by: 'Ana Silva' },
];

export const getDashboardSummary = (startDate: Date, endDate: Date): DashboardSummary => {
  const filtered = mockAppointments.filter(a => {
    const d = new Date(a.date);
    return d >= startDate && d <= endDate;
  });
  
  const total_appointments = filtered.length;
  const sold = filtered.filter(a => a.status === 'sold');
  const total_sales = sold.length;
  const total_revenue = sold.reduce((sum, a) => sum + (a.sale_value || 0), 0);
  const total_reached = 850;
  const conversion_rate = total_appointments > 0 ? (total_sales / total_appointments) * 100 : 0;
  const average_ticket = total_sales > 0 ? total_revenue / total_sales : 0;
  
  return {
    total_appointments,
    total_sales,
    total_revenue,
    total_reached,
    conversion_rate,
    average_ticket,
  };
};

export const getTrendData = (startDate: Date, endDate: Date) => {
  const data = [];
  const current = new Date(startDate);
  
  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const count = mockAppointments.filter(a => a.date === dateStr).length;
    data.push({
      date: dateStr,
      appointments: count,
      sales: Math.floor(count * 0.4),
    });
    current.setDate(current.getDate() + 1);
  }
  
  return data;
};

export const getLocationDistribution = (startDate: Date, endDate: Date) => {
  const locations = ['São Paulo', 'Rio de Janeiro', 'Campinas', 'Belo Horizonte'];
  
  return locations.map(loc => ({
    name: loc,
    value: mockAppointments.filter(a => {
      const d = new Date(a.date);
      return a.location === loc && d >= startDate && d <= endDate;
    }).length,
  }));
};

export const getShiftDistribution = (startDate: Date, endDate: Date) => {
  const shifts = ['Manhã', 'Tarde', 'Noite'];
  
  return shifts.map(shift => ({
    name: shift,
    value: mockAppointments.filter(a => {
      const d = new Date(a.date);
      return a.shift === shift && d >= startDate && d <= endDate;
    }).length,
  }));
};

export const getSalesRanking = (startDate: Date, endDate: Date) => {
  return mockSalespeople.map(sp => {
    const spAppointments = mockAppointments.filter(a => {
      const d = new Date(a.date);
      return a.salesperson_id === sp.id && d >= startDate && d <= endDate;
    });
    const sales = spAppointments.filter(a => a.status === 'sold');
    const revenue = sales.reduce((sum, a) => sum + (a.sale_value || 0), 0);
    
    return {
      name: sp.name,
      total_sales: sales.length,
      total_revenue: revenue,
      average_ticket: sales.length > 0 ? revenue / sales.length : 0,
    };
  }).sort((a, b) => b.total_revenue - a.total_revenue);
};
