import { apiErrorMessage } from '../api/api-error-message';

export type ToastEvent = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

const listeners = new Set<(event: ToastEvent) => void>();

export function subscribeToastBus(listener: (event: ToastEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitToast(event: ToastEvent): void {
  listeners.forEach((listener) => listener(event));
}

export function emitApiErrorToast(error: unknown): void {
  emitToast({ tone: 'error', message: apiErrorMessage(error) });
}
