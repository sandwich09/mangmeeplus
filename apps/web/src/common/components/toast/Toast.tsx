'use client';

import { IconButton } from '@/common/components/button';
import type { ToastItem, ToastTone } from './toast.model';

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-brand-100 bg-success-50 text-success-700',
  warning: 'border-warning-100 bg-warning-50 text-warning-700',
  error: 'border-error-500/20 bg-error-50 text-error-700',
};

const TONE_ICON: Record<ToastTone, string> = {
  success: '✓',
  warning: '⚠',
  error: '✕',
};

export function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={`toast-enter pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-lg ${TONE_CLASS[item.tone]}`}
      onClick={onDismiss}
    >
      <span aria-hidden="true">{TONE_ICON[item.tone]}</span>
      <span>{item.message}</span>
      <IconButton
        type="button"
        size="sm"
        label="ปิดการแจ้งเตือน"
        icon={<span aria-hidden="true">✕</span>}
        className="-mr-2 h-6 w-6 text-current hover:bg-black/5"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
      />
    </div>
  );
}
