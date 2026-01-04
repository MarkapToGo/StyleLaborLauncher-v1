import { create } from 'zustand';
import type { Toast } from '../types';
import { generateId } from '../lib/utils';

interface ToastState {
  toasts: Toast[];
  
  // Actions
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  
  // Convenience methods
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = generateId();
    const newToast: Toast = { ...toast, id, duration: toast.duration ?? 5000 };
    set({ toasts: [...get().toasts, newToast] });
    
    // Auto remove after duration
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, newToast.duration);
    }
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter(t => t.id !== id) });
  },

  clearToasts: () => {
    set({ toasts: [] });
  },

  success: (title, message) => {
    get().addToast({ type: 'success', title, message });
  },

  error: (title, message) => {
    get().addToast({ type: 'error', title, message, duration: 8000 });
  },

  warning: (title, message) => {
    get().addToast({ type: 'warning', title, message });
  },

  info: (title, message) => {
    get().addToast({ type: 'info', title, message });
  },
}));
