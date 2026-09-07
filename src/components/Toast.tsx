import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import type { Toast as ToastType } from '../hooks/useToast';

interface ToastContainerProps {
  toasts: ToastType[];
  removeToast: (id: string) => void;
}

export function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg animate-slide-in"
          style={{
            backgroundColor:
              toast.type === 'error'
                ? 'rgba(239, 68, 68, 0.95)'
                : toast.type === 'success'
                  ? 'rgba(34, 197, 94, 0.95)'
                  : 'rgba(59, 130, 246, 0.95)',
            color: 'white',
            minWidth: '280px',
          }}
        >
          {toast.type === 'success' && <CheckCircle size={18} />}
          {toast.type === 'error' && <AlertCircle size={18} />}
          {toast.type === 'info' && <Info size={18} />}
          <span className="text-sm font-medium flex-1">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="p-1 rounded hover:bg-white/20 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
