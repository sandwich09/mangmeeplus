'use client';

import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { ghostClass } from '../ExpensesUi';
import { canRevealDisbursementAccount } from './disbursement-voucher-account.logic';
import { revealDisbursementVoucherAccount } from './disbursement-vouchers.api';
import type { DisbursementVoucherHeader } from './disbursement-vouchers.model';

export function DisbursementVoucherAccount({ companyId, header, permissions }: {
  companyId: string; header: DisbursementVoucherHeader; permissions: readonly string[];
}) {
  const [number, setNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);
  const reveal = async () => {
    if (controller.current || !canRevealDisbursementAccount(permissions) || !header.payeeAccountLast4) return;
    controller.current = new AbortController(); setBusy(true); setError(null);
    try {
      const result = await revealDisbursementVoucherAccount(companyId, header.id, controller.current.signal);
      if (active.current) setNumber(result.accountNumber);
    } catch (failure) { if (active.current) setError(failure); }
    finally { controller.current = null; if (active.current) setBusy(false); }
  };
  if (!header.payeeAccountLast4) return null;
  return <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
    <p>{header.payeeBankName} {header.payeeAccountName} <span className="whitespace-nowrap font-mono">{number ? number.replace(/(.{4})(?=.)/g, '$1 ') : `xxx-${header.payeeAccountLast4}`}</span></p>
    {canRevealDisbursementAccount(permissions) && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy}
      onClick={() => { if (number) { setNumber(null); setError(null); } else void reveal(); }}>
      {t(busy ? 'expenses.disbursement.working' : number ? 'expenses.disbursement.account_hide' : 'expenses.disbursement.account_reveal', 'th')}
    </button>}
    {error !== null && <p role="alert" className="text-error-700">{apiErrorMessage(error)}</p>}
  </div>;
}
