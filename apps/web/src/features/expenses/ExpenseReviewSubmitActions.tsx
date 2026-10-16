'use client';

import { useRef, type ReactNode } from 'react';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { btnClass, ghostClass } from './ExpensesUi';

export function ExpenseReviewSubmitActions({ canConfirm, busy, disabled, confirmDisabled, title, onConfirm, onSend, canSend = true, back }: {
  back?: ReactNode; canSend?: boolean; canConfirm: boolean; busy: boolean; disabled: boolean; confirmDisabled: boolean; title?: string;
  onConfirm: () => Promise<unknown>; onSend: () => Promise<unknown>;
}) {
  const pending = useRef(false);
  const run = async (action: () => Promise<unknown>, blocked: boolean) => {
    if (busy || blocked || pending.current) return;
    pending.current = true;
    try { await action(); } finally { pending.current = false; }
  };
  // The shared group stacks narrow rows with the acting button above Back.
  return canConfirm ? <ActionGroup>
    {back}
    {canSend && <button type="button" className={ghostClass} disabled={busy || disabled} aria-busy={busy} onClick={() => void run(onSend, disabled)}>ส่งให้ตรวจ</button>}
    <button type="button" className={btnClass} disabled={busy || disabled || confirmDisabled} aria-busy={busy} title={title} onClick={() => void run(onConfirm, disabled || confirmDisabled)}>{t('expenses.confirm_and_post', 'th')}</button>
  </ActionGroup> : canSend || back ? <ActionGroup>{back}{canSend && <button type="button" className={btnClass} disabled={busy || disabled} aria-busy={busy} title={title} onClick={() => void run(onSend, disabled)}>{t('expenses.send_for_review', 'th')}</button>}</ActionGroup> : null;
}
