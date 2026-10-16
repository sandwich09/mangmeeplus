import type { CSSProperties } from 'react';
import type { OverlayRect } from '@/common/functions/overlay-geometry';
import { MAX_VISIBLE, TOAST_DURATION_MS, type ToastItem, type ToastTone } from './toast.model';

export type ToastInput = Pick<ToastItem, 'tone' | 'message' | 'action'>;

export function visibleToasts(items: ToastItem[]): ToastItem[] {
  return [...items].reverse();
}

export function addToast(items: ToastItem[], input: ToastInput, now: number): ToastItem[] {
  if (items.some((item) => item.tone === input.tone && item.message === input.message)) {
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


export function toastStackStyle(width: number, layoutHeight: number, bounds: OverlayRect, column?: OverlayRect): CSSProperties {
  if (width < 640) return { top: 'auto', bottom: `calc(${layoutHeight - bounds.bottom}px + 0.75rem + env(safe-area-inset-bottom, 0px))` };
  return { top: `calc(${bounds.top}px + 0.75rem + env(safe-area-inset-top, 0px))`,
    ...(column ? { left: column.left, right: 'auto', width: column.right - column.left } : {}) };
}
