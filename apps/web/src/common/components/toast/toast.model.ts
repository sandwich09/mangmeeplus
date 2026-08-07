export type ToastTone = 'success' | 'warning' | 'error';

export type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
};

export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  success: 4_000,
  warning: 4_000,
  error: 6_000,
};

export const MAX_VISIBLE = 3;
export const DEDUP_MS = 1_000;
