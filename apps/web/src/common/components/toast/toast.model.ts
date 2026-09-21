export type ToastTone = 'success' | 'warning' | 'error';

/**
 * One in-app link the toast carries, e.g. the counterparty spec's "· ดู" (§7). The caller passes
 * it only when the reader may open the target, so a toast never links to a refusal (§8).
 */
export type ToastAction = { href: string; label: string };

export type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
};

export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  success: 4_000,
  warning: 4_000,
  error: 6_000,
};

export const MAX_VISIBLE = 3;
export const DEDUP_MS = 1_000;
