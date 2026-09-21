'use client';

import { createContext, useContext } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import type { ToastAction } from './toast.model';

export type ToastContextValue = {
  success: (message: string, action?: ToastAction) => void;
  warning: (message: string, action?: ToastAction) => void;
  error: (input: unknown) => void;
};

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function toastErrorMessage(input: unknown): string {
  return typeof input === 'string' ? input : apiErrorMessage(input);
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
