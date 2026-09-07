import { useState, useEffect } from 'react';
import {
  CheckCircle,
  WifiOff,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { getSettings, getInstanceStatus } from '../lib/uazapi';
import { syncContactsFromUazapi } from '../lib/syncContacts';

export function WhatsAppConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('verificando...');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(localStorage.getItem('last_contact_sync'));

  useEffect(() => {
    loadSettingsAndSetStatus();
  }, []);

  const loadSettingsAndSetStatus = async () => {
    try {
      const settings = getSettings();
      const hasAll = settings.apiUrl && settings.apiToken && settings.instanceName;

      if (hasAll) {
        // Verifica status real da instancia
        const status = await getInstanceStatus();
        setIsConnected(status.connected);
        setConnectionStatus(status.connected ? 'Conectado' : status.status);

      // Sincronizacao automatica desativada - usuario deve clicar em "Sincronizar" manualmente
      } else {
        setIsConnected(false);
        setConnectionStatus('Configure em Configuracoes');
      }
    } catch {
      setIsConnected(false);
      setConnectionStatus('Erro ao carregar configuracoes');
    }
    setIsLoading(false);
  };

  const handleSyncContacts = async () => {
    setIsSyncing(true);
    try {
      const result = await syncContactsFromUazapi();
      if (result.success) {
        const now = Date.now().toString();
        localStorage.setItem('last_contact_sync', now);
        setLastSync(now);
        setConnectionStatus(
          `Conectado - ${result.synced} contatos, ${result.messages} mensagens`
        );

        // Dispara evento para atualizar lista em outros componentes
        window.dispatchEvent(new CustomEvent('contacts-synced', {
          detail: { synced: result.synced, messages: result.messages },
        }));

        setTimeout(() => setConnectionStatus('Conectado'), 5000);
      } else {
        setConnectionStatus(`Erro: ${result.error || 'Falha na sincronizacao'}`);
        setTimeout(() => setConnectionStatus('Conectado'), 3000);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setConnectionStatus(`Erro: ${errorMsg}`);
      setTimeout(() => setConnectionStatus('Conectado'), 3000);
    }
    setIsSyncing(false);
  };

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg"
      style={{
        backgroundColor: isConnected
          ? 'rgba(34, 197, 94, 0.1)'
          : 'rgba(239, 68, 68, 0.08)',
        border: `1px solid ${isConnected ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.2)'}`,
      }}
    >
      {isLoading ? (
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
      ) : isConnected ? (
        <CheckCircle size={20} className="flex-shrink-0" style={{ color: 'var(--success)' }} />
      ) : (
        <WifiOff size={20} className="flex-shrink-0" style={{ color: 'var(--error)' }} />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          WhatsApp {isConnected ? 'Conectado' : 'Desconectado'}
        </p>
        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {connectionStatus}
        </p>
      </div>

      {isConnected && (
        <button
          onClick={handleSyncContacts}
          disabled={isSyncing}
          className="btn-secondary flex items-center gap-1"
          style={{ padding: '6px 14px', fontSize: '13px' }}
          title="Sincronizar contatos do WhatsApp"
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
        </button>
      )}

      {!isConnected && (
        <a
          href="/#/users"
          className="btn-primary flex items-center gap-1"
          style={{ padding: '6px 14px', fontSize: '13px' }}
        >
          <Settings size={14} />
          <span>Configurar</span>
        </a>
      )}
    </div>
  );
}
