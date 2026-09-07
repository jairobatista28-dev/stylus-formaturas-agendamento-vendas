import { useState } from 'react';
import {
  Search,
  MessageCircle,
  Send,
  Calendar,
  Paperclip,
  Smile,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  text: string;
  sent: boolean;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
}

interface ChatContact {
  id: string;
  name: string;
  phone: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
  avatar: string;
}

const mockContacts: ChatContact[] = [
  { id: '1', name: 'João Silva', phone: '11999990001', lastMessage: 'Gostaria de agendar para semana que vem', lastTime: '10:30', unread: 2, avatar: 'JS' },
  { id: '2', name: 'Maria Santos', phone: '11999990002', lastMessage: 'Confirmado para terça-feira!', lastTime: '09:15', unread: 0, avatar: 'MS' },
  { id: '3', name: 'Pedro Costa', phone: '11999990003', lastMessage: 'Qual o endereço do local?', lastTime: 'Ontem', unread: 1, avatar: 'PC' },
  { id: '4', name: 'Ana Oliveira', phone: '11999990004', lastMessage: 'Obrigada pela ajuda', lastTime: 'Ontem', unread: 0, avatar: 'AO' },
  { id: '5', name: 'Lucas Mendes', phone: '11999990005', lastMessage: 'Posso remarcar?', lastTime: 'Seg', unread: 3, avatar: 'LM' },
];

const mockMessages: Record<string, ChatMessage[]> = {
  '1': [
    { id: '1', text: 'Olá! Sou da Stylus Formaturas. Gostaria de agendar sua apresentação de material fotográfico?', sent: true, timestamp: '10:25', status: 'read' },
    { id: '2', text: 'Oi! Sim, eu gostaria. Qual a disponibilidade para a próxima semana?', sent: false, timestamp: '10:28', status: 'read' },
    { id: '3', text: 'Temos vagas na terça e quinta, nos turnos da manhã e tarde. Qual prefere?', sent: true, timestamp: '10:29', status: 'read' },
    { id: '4', text: 'Gostaria de agendar para semana que vem', sent: false, timestamp: '10:30', status: 'read' },
  ],
  '2': [
    { id: '1', text: 'Olá Maria! Podemos confirmar seu agendamento para terça-feira?', sent: true, timestamp: '09:10', status: 'read' },
    { id: '2', text: 'Confirmado para terça-feira!', sent: false, timestamp: '09:15', status: 'read' },
  ],
  '3': [
    { id: '1', text: 'Olá Pedro! Seu agendamento está confirmado para sexta-feira às 14h.', sent: true, timestamp: 'Ontem 15:00', status: 'read' },
    { id: '2', text: 'Qual o endereço do local?', sent: false, timestamp: 'Ontem 15:30', status: 'delivered' },
  ],
};

export function WhatsAppManual() {
  const [selectedContact, setSelectedContact] = useState<ChatContact | null>(mockContacts[0]);
  const [messageInput, setMessageInput] = useState('');
  const [search, setSearch] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const filteredContacts = mockContacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );

  const messages = selectedContact ? mockMessages[selectedContact.id] || [] : [];

  const handleSend = () => {
    if (!messageInput.trim() || !selectedContact) return;
    setMessageInput('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            WhatsApp Manual
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Conversas e agendamento manual
          </p>
        </div>
      </div>

      <div className="card overflow-hidden p-0" style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}>
        <div className="flex h-full">
          {/* Contacts Sidebar */}
          <div className="w-80 flex flex-col" style={{ borderRight: '1px solid var(--border-subtle)' }}>
            <div className="p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Buscar contato..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input-dark w-full pl-10"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => setSelectedContact(contact)}
                  className="w-full flex items-center gap-3 p-3 text-left transition-colors"
                  style={{
                    backgroundColor: selectedContact?.id === contact.id ? 'var(--bg-surface-raised)' : 'transparent',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold" style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
                    {contact.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {contact.name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {contact.lastTime}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                        {contact.lastMessage}
                      </span>
                      {contact.unread > 0 && (
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0" style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
                          {contact.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Chat Area */}
          {selectedContact ? (
            <div className="flex-1 flex flex-col">
              {/* Chat Header */}
              <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold" style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}>
                    {selectedContact.avatar}
                  </div>
                  <div>
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {selectedContact.name}
                    </h3>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {selectedContact.phone}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="btn-primary"
                    style={{ padding: '8px 14px', fontSize: '13px' }}
                  >
                    <Calendar size={14} />
                    Agendar
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sent ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className="max-w-[70%] rounded-lg px-4 py-2.5"
                      style={{
                        backgroundColor: message.sent ? 'var(--accent-primary)' : 'var(--bg-surface-raised)',
                        color: message.sent ? 'white' : 'var(--text-primary)',
                      }}
                    >
                      <p className="text-sm">{message.text}</p>
                      <div className={`flex items-center gap-1 mt-1 ${message.sent ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-xs" style={{ opacity: 0.7 }}>
                          {message.timestamp}
                        </span>
                        {message.sent && (
                          <span className="text-xs" style={{ opacity: 0.7 }}>
                            {message.status === 'read' ? '✓✓' : message.status === 'delivered' ? '✓✓' : '✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input Area */}
              <div className="p-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="flex items-end gap-2">
                  <button className="btn-icon">
                    <Paperclip size={20} />
                  </button>
                  <div className="flex-1">
                    <textarea
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={handleKeyPress}
                      placeholder="Digite uma mensagem..."
                      className="input-dark w-full resize-none"
                      rows={1}
                      style={{ maxHeight: '100px' }}
                    />
                  </div>
                  <button className="btn-icon">
                    <Smile size={20} />
                  </button>
                  <button
                    onClick={handleSend}
                    className="btn-primary"
                    style={{ padding: '10px 14px' }}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageCircle size={48} style={{ color: 'var(--text-muted)' }} className="mx-auto mb-3" />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Selecione um contato para iniciar a conversa
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && selectedContact && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Agendar Apresentação
                </h2>
                <button onClick={() => setShowScheduleModal(false)} className="btn-icon">
                  <span className="text-xl">×</span>
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Graduando</label>
                  <input type="text" defaultValue={selectedContact.name} className="input-dark w-full" disabled />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Telefone</label>
                  <input type="text" defaultValue={selectedContact.phone} className="input-dark w-full" disabled />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Data</label>
                    <input type="date" className="input-dark w-full" />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Turno</label>
                    <select className="input-dark w-full">
                      <option>Manhã</option>
                      <option>Tarde</option>
                      <option>Noite</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Local</label>
                  <select className="input-dark w-full">
                    <option>São Paulo</option>
                    <option>Rio de Janeiro</option>
                    <option>Campinas</option>
                    <option>Belo Horizonte</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendedor</label>
                  <select className="input-dark w-full">
                    <option>Ana Silva</option>
                    <option>Bruno Costa</option>
                    <option>Carla Mendes</option>
                    <option>Diego Oliveira</option>
                    <option>Fernanda Lima</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowScheduleModal(false)} className="btn-secondary">
                  Cancelar
                </button>
                <button onClick={() => setShowScheduleModal(false)} className="btn-primary">
                  <Calendar size={16} />
                  Agendar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
