import { DEDUP_MS, MAX_VISIBLE, TOAST_DURATION_MS, type ToastItem, type ToastTone } from './toast.model';

export type ToastInput = Pick<ToastItem, 'tone' | 'message' | 'action'>;

export function visibleToasts(items: ToastItem[]): ToastItem[] {
  return [...items].reverse();
}

export function addToast(items: ToastItem[], input: ToastInput, now: number): ToastItem[] {
  if (items.some((item) => item.tone === input.tone && item.message === input.message && now - item.id < DEDUP_MS)) {
    return items;
  }
  return [...items, { id: now, ...input }].slice(-MAX_VISIBLE);
}

export function removeToast(items: ToastItem[], id: number): ToastItem[] {
  return items.some((item) => item.id === id) ? items.filter((item) => item.id !== id) : items;
}

export function toastDuration(tone: ToastTone): number {
  return TOAST_DURATION_MS[tone];
}
