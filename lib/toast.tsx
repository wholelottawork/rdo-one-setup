'use client';

import { createContext, useCallback, useContext, useState } from 'react';

// React port of src/toast.js — renders the original .toast-wrap / .toast
// markup (styled by the terminal stylesheet), same 3.2s lifetime.
type ToastType = '' | 'ok' | 'err';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const ToastContext = createContext<((message: string, type?: ToastType) => void) | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = '') => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(item => item.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div id="toastWrap" className="toast-wrap">
        {toasts.map(item => (
          <div key={item.id} className={`toast ${item.type}`.trim()}>{item.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
