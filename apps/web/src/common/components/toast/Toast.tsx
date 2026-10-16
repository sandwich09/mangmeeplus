'use client';

import Link from 'next/link';
import { IconButton } from '@/common/components/button';
import type { ToastItem, ToastTone } from './toast.model';

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-brand-100 bg-success-50 text-success-700',
  warning: 'border-warning-100 bg-warning-50 text-warning-700',
  error: 'border-error-500/20 bg-error-50 text-error-700',
};

const TONE_CHIP: Record<ToastTone, string> = {
  success: 'bg-success-500/15 text-success-700',
  warning: 'bg-warning-500/20 text-warning-700',
  error: 'bg-error-500/15 text-error-700',
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
      className={`toast-enter pointer-events-auto flex w-fit max-w-[min(92vw,28rem)] items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-[0_12px_32px_-8px_rgba(16,24,40,0.18)] ${TONE_CLASS[item.tone]}`}
      onClick={onDismiss}
    >
      <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] ${TONE_CHIP[item.tone]}`}>{TONE_ICON[item.tone]}</span>
      {/* 24px lines: level with the 24px mark, and a wrapped bold Thai sentence keeps its marks apart. */}
      <span className="min-w-0 break-words leading-6">
        {item.message.split(/([A-Za-z0-9-]+)/).map((part, index) => index % 2
          ? <span key={index} className="whitespace-nowrap">{part}</span> : part)}
        {item.action && (
          <>
            {' · '}
            <Link href={item.action.href} className="underline underline-offset-2">{item.action.label}</Link>
          </>
        )}
      </span>
      <IconButton
        type="button"
        size="sm"
        label="ปิดการแจ้งเตือน"
        icon={<span aria-hidden="true">✕</span>}
        className="-mr-2 -mt-0.5 h-6 w-6 text-current hover:bg-black/5"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
      />
    </div>
  );
}
