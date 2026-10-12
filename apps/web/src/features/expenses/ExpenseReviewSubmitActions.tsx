'use client';

import { useRef } from 'react';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { btnClass, ghostClass, successBtn, successBtnStyle } from './ExpensesUi';

export function ExpenseReviewSubmitActions({ canConfirm, busy, disabled, confirmDisabled, title, onConfirm, onSend }: {
  canConfirm: boolean; busy: boolean; disabled: boolean; confirmDisabled: boolean; title?: string;
  onConfirm: () => Promise<unknown>; onSend: () => Promise<unknown>;
}) {
  const pending = useRef(false);
  const run = async (action: () => Promise<unknown>, blocked: boolean) => {
    if (busy || blocked || pending.current) return;
    pending.current = true;
    try { await action(); } finally { pending.current = false; }
  };
  return <>
    {canConfirm ? <>
      <button type="button" className={successBtn} style={successBtnStyle} disabled={busy || disabled || confirmDisabled} aria-busy={busy} title={title} onClick={() => void run(onConfirm, disabled || confirmDisabled)}>{t('expenses.confirm_and_post', 'th')}</button>
      <button type="button" className={ghostClass} disabled={busy || disabled} aria-busy={busy} onClick={() => void run(onSend, disabled)}>ส่งให้คนอื่นตรวจ</button>
    </> : <div className="text-right">
      <button type="button" className={btnClass} disabled={busy || disabled} aria-busy={busy} title={title} onClick={() => void run(onSend, disabled)}>{t('expenses.send_for_review', 'th')}</button>
    </div>}
  </>;
}
