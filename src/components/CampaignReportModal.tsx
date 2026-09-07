import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Loader2,
  Send,
  CalendarCheck,
  MessageCircleOff,
  Users,
  Phone,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface CampaignReportModalProps {
  campaignId: string;
  campaignName: string;
  onClose: () => void;
}

interface NoReplyContact {
  id: string;
  nome: string;
  telefone: string;
}

export function CampaignReportModal({ campaignId, campaignName, onClose }: CampaignReportModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSent, setTotalSent] = useState(0);
  const [totalAppointments, setTotalAppointments] = useState(0);
  const [noReplyCount, setNoReplyCount] = useState(0);
  const [noReplyContacts, setNoReplyContacts] = useState<NoReplyContact[]>([]);
  const [showNoReplyList, setShowNoReplyList] = useState(false);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Total de envios: fila_envios com status = 'enviado' para esta campanha
      const { count: sentCount, error: sentError } = await supabase
        .from('fila_envios')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', campaignId)
        .eq('status', 'enviado');

      if (sentError) throw sentError;
      setTotalSent(sentCount || 0);

// 2. Agendamentos confirmados: via campaign_contact_id OU via numero_contrato (agendamentos manuais)
const STATUS_AGENDAMENTO = ['scheduled', 'Em negociacao'];

const { data: contatosDaCampanha, error: contatosError } = await supabase
  .from('contatos_campanha')
  .select('id, numero_contrato')
  .eq('campanha_id', campaignId);

if (contatosError) throw contatosError;

const contatoIds = (contatosDaCampanha || []).map((c) => c.id);
const contratosDaCampanha = Array.from(
  new Set(
    (contatosDaCampanha || [])
      .map((c) => c.numero_contrato)
      .filter((n): n is string => !!n)
  )
);

let apptCount = 0;

// 2a. Agendamentos vinculados diretamente via campaign_contact_id
if (contatoIds.length > 0) {
  const { count, error: apptError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .in('campaign_contact_id', contatoIds)
    .in('status', STATUS_AGENDAMENTO);

  if (apptError) throw apptError;
  apptCount += count || 0;
}

// 2b. Agendamentos manuais: sem campaign_contact_id, mas com contract_number batendo
if (contratosDaCampanha.length > 0) {
  const { count: manualCount, error: manualError } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .is('campaign_contact_id', null)
    .in('status', STATUS_AGENDAMENTO)
    .in('contract_number', contratosDaCampanha);

  if (manualError) throw manualError;
  apptCount += manualCount || 0;
}

setTotalAppointments(apptCount);

      // 3. Envios sem resposta: contatos_campanha onde interagiu_em é nulo
      const { count: noReplyTotal, error: noReplyCountError } = await supabase
        .from('contatos_campanha')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', campaignId)
        .is('interagiu_em', null);

      if (noReplyCountError) throw noReplyCountError;
      setNoReplyCount(noReplyTotal || 0);

      // 4. Lista de nomes e telefones dos contatos sem resposta
      const { data: noReplyData, error: noReplyListError } = await supabase
        .from('contatos_campanha')
        .select('id, nome, telefone')
        .eq('campanha_id', campaignId)
        .is('interagiu_em', null)
        .order('nome', { ascending: true });

      if (noReplyListError) throw noReplyListError;

      setNoReplyContacts(
        (noReplyData || []).map((c) => ({
          id: c.id,
          nome: c.nome || 'Sem nome',
          telefone: c.telefone || '',
        }))
      );
    } catch (err) {
      console.error('[Report] Erro ao carregar relatório:', err);
      setError('Não foi possível carregar o relatório. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length >= 10) {
      return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6, 10)}`;
    }
    return phone;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '720px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4" style={{ flexShrink: 0 }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Relatório de Produtividade
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              {campaignName}
            </p>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 pb-6" style={{ flex: 1 }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin" size={32} style={{ color: 'var(--accent-primary)' }} />
            </div>
          ) : error ? (
            <div
              className="flex items-start gap-2 p-4 rounded-lg"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
            >
              <AlertCircle size={18} style={{ color: 'var(--error)', flexShrink: 0, marginTop: '2px' }} />
              <span className="text-sm" style={{ color: 'var(--error)' }}>{error}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-3 gap-4">
                {/* Total Envios */}
                <div
                  className="p-5 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="flex items-center justify-center rounded-lg"
                      style={{
                        width: '36px',
                        height: '36px',
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      }}
                    >
                      <Send size={18} style={{ color: 'var(--info)' }} />
                    </div>
                  </div>
                  <p
                    className="text-3xl font-bold"
                    style={{ color: 'var(--text-primary)', lineHeight: '1.2' }}
                  >
                    {totalSent}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Mensagens enviadas
                  </p>
                </div>

                {/* Agendamentos */}
                <div
                  className="p-5 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="flex items-center justify-center rounded-lg"
                      style={{
                        width: '36px',
                        height: '36px',
                        backgroundColor: 'rgba(34, 197, 94, 0.15)',
                      }}
                    >
                      <CalendarCheck size={18} style={{ color: 'var(--success)' }} />
                    </div>
                  </div>
                  <p
                    className="text-3xl font-bold"
                    style={{ color: 'var(--text-primary)', lineHeight: '1.2' }}
                  >
                    {totalAppointments}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Agendamentos confirmados
                  </p>
                </div>

                {/* Sem Resposta */}
                <div
                  className="p-5 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="flex items-center justify-center rounded-lg"
                      style={{
                        width: '36px',
                        height: '36px',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      }}
                    >
                      <MessageCircleOff size={18} style={{ color: 'var(--warning)' }} />
                    </div>
                  </div>
                  <p
                    className="text-3xl font-bold"
                    style={{ color: 'var(--text-primary)', lineHeight: '1.2' }}
                  >
                    {noReplyCount}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Envios sem resposta
                  </p>
                </div>
              </div>

              {/* No Reply List Section */}
              <div
                className="rounded-xl"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowNoReplyList(!showNoReplyList)}
                  className="w-full flex items-center justify-between p-4"
                  style={{
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Users size={18} style={{ color: 'var(--warning)' }} />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      Contatos sem resposta
                    </span>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        color: 'var(--warning)',
                      }}
                    >
                      {noReplyContacts.length}
                    </span>
                  </div>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showNoReplyList ? 'Ocultar lista' : 'Ver lista'}
                  </span>
                </button>

                {showNoReplyList && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {noReplyContacts.length === 0 ? (
                      <p
                        className="text-sm text-center py-6"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Todos os contatos responderam às mensagens
                      </p>
                    ) : (
                      <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                        {noReplyContacts.map((contact, idx) => (
                          <div
                            key={contact.id}
                            className="flex items-center gap-3 px-4 py-3"
                            style={{
                              borderBottom:
                                idx < noReplyContacts.length - 1
                                  ? '1px solid var(--border-subtle)'
                                  : 'none',
                            }}
                          >
                            <div
                              className="flex items-center justify-center rounded-full flex-shrink-0"
                              style={{
                                width: '32px',
                                height: '32px',
                                backgroundColor: 'var(--bg-surface-raised)',
                              }}
                            >
                              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                {contact.nome.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className="text-sm font-medium truncate"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {contact.nome}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <Phone size={13} style={{ color: 'var(--text-muted)' }} />
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                {formatPhone(contact.telefone)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}