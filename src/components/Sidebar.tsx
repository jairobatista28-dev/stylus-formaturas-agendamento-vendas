import { useRef, useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar,
  MessageCircle,
  Camera,
  Settings,
  Users,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Upload,
  ShoppingCart,
} from 'lucide-react';

const AVATAR_STORAGE_KEY = 'stylus-admin-avatar';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (saved) setAvatarUrl(saved);
  }, []);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setAvatarUrl(result);
      localStorage.setItem(AVATAR_STORAGE_KEY, result);
    };
    reader.readAsDataURL(file);
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/appointments', label: 'Agendamentos', icon: Calendar },
    { path: '/campaigns', label: 'Campanhas', icon: MessageCircle },
  ];

  return (
    <aside
      className="h-screen flex flex-col transition-all duration-300"
      style={{
        width: collapsed ? '72px' : '260px',
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent-primary)' }}>
          <Camera size={20} className="text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              Stylus Formaturas
            </h1>
            <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
              Agendamento Ativo
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
            title={collapsed ? item.label : undefined}
          >
            <item.icon size={20} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        <NavLink
          to="/whatsapp"
          className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
          title={collapsed ? 'WhatsApp' : undefined}
        >
          <MessageCircle size={20} />
          {!collapsed && <span>WhatsApp</span>}
        </NavLink>

        <NavLink
          to="/vendas-pendentes"
          className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
          title={collapsed ? 'Vendas Pendentes' : undefined}
        >
          <ShoppingCart size={20} />
          {!collapsed && <span>Vendas Pendentes</span>}
        </NavLink>

        <NavLink
          to="/users"
          className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
          title={collapsed ? 'Configuração' : undefined}
        >
          <Settings size={20} />
          {!collapsed && <span>Configuração</span>}
        </NavLink>
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAvatarClick}
            className="relative w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden group ring-2 ring-transparent hover:ring-white/20 transition-all duration-200"
            style={{ backgroundColor: avatarUrl ? 'transparent' : 'var(--accent-primary)' }}
            title="Clique para alterar a foto"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Admin" className="w-full h-full object-cover" />
            ) : (
              <Users size={14} className="text-white" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <Upload size={12} className="text-white" />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                Admin User
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                Administrador
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center shadow-lg"
        style={{ backgroundColor: 'var(--bg-surface-raised)', border: '1px solid var(--border-default)' }}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  );
}
