import { Suspense, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Sidebar } from './Sidebar';

function Carregando() {
  return (
    <div className="flex items-center justify-center py-24" style={{ color: 'var(--text-muted)' }}>
      <Loader2 size={22} className="animate-spin" />
    </div>
  );
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <main
        className="flex-1 overflow-y-auto transition-all duration-300"
        style={{ marginLeft: 0 }}
      >
        <div className="p-6 max-w-7xl mx-auto">
          {/* Cada tela carrega sob demanda; o menu lateral continua visivel */}
          <Suspense fallback={<Carregando />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
