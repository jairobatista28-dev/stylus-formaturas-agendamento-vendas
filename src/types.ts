export interface Graduand {
  id: string;
  name: string;
  contract: string;
  course: string;
  email: string;
  phone: string;
  location: string;
  shift: string;
  created_at: string;
}

export interface Appointment {
  id: string;
  graduand_id: string;
  graduand_name: string;
  contract: string;
  course: string;
  date: string;
  shift: string;
  location: string;
  salesperson: string;
  salesperson_id: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | 'sold';
  sale_value: number | null;
  created_at: string;
  calendar_event_id: string | null;
}

export interface Salesperson {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'admin' | 'salesperson';
  default_location: string;
  total_sales: number;
  total_revenue: number;
  appointments_count: number;
}

export interface AIFlowStep {
  step: number;
  message: string;
  wait_seconds: number;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  course_target?: string;
  initial_message?: string;
  available_slots?: string;
  session_location?: string;
  session_duration?: string;
  scheduling_deadline?: string;
  conversation_tone?: string;
  objection_handling?: string;
  extra_info?: string;
  ai_prompt_extra?: string;
  ai_prompt?: string;
  delay_between_messages_ms?: number;
  max_overflow_attempts?: number;
  status: 'draft' | 'running' | 'paused' | 'finished';
  contacts_count?: number;
  sent_count?: number;
  scheduled_count?: number;
  overflow_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  contact_id?: string;
  conversation_id?: string;
  nome?: string;
  nome_formando: string;
  telefone: string;
  numero_contrato?: string;
  status: string;
  data_agendamento?: string;
  confirmacao_local?: string;
  turno_agendamento?: string;
  observacoes?: string;
  tentativas_envio?: number;
  ultima_interacao?: string;
  criado_em?: string;
  atualizado_em?: string;
  curso?: string;
  endereco?: string;
  attempts?: number;
  last_message_at?: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  course?: string;
  shift?: string;
  contract_number?: string;
  status: string;
  assigned_to: string;
  created_at: string;
  unread_count?: number;
}

export interface Message {
  id: string;
  contact_id: string;
  direction: 'in' | 'out';
  content: string;
  sent_by: string;
  delivered: boolean;
  read: boolean;
  created_at: string;
  status?: 'sent' | 'delivered' | 'read';
  seq?: number;
}

export interface MessageTemplate {
  id: string;
  name: string;
  category: string;
  content: string;
  status: 'draft' | 'approved';
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  source: string;
  active: boolean;
  created_at: string;
}

export interface AIFlow {
  id: string;
  name: string;
  trigger_type: string;
  trigger_value?: string;
  steps: string[];
  active: boolean;
  created_at: string;
}

export interface AppSettings {
  min_delay_seconds: number;
  max_delay_seconds: number;
  batch_size: number;
  batch_pause_minutes: number;
  whatsapp_connected: boolean;
  ai_enabled: boolean;
  nome_agente: string;
  responder_automaticamente: boolean;
  usar_base_conhecimento: boolean;
  permitir_agendar: boolean;
  system_prompt_base: string;
}

export interface AITrainingDocument {
  id: string;
  user_id: string;
  title: string;
  content: string;
  file_type: string;
  file_size: number;
  is_active: boolean;
  created_at: string;
}

export interface DashboardSummary {
  total_appointments: number;
  total_sales: number;
  total_revenue: number;
  total_reached: number;
  conversion_rate: number;
  average_ticket: number;
}

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export type StatusConfig = {
  label: string;
  color: string;
  badgeClass: string;
};
