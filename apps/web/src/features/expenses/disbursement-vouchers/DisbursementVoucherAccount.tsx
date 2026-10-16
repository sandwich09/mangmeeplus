'use client';

import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { quietButtonClass } from '@/common/components/button/button-classes';
import { canRevealDisbursementAccount } from './disbursement-voucher-account.logic';
import { revealDisbursementVoucherAccount } from './disbursement-vouchers.api';
import type { DisbursementVoucherHeader } from './disbursement-vouchers.model';

export function DisbursementVoucherAccount({ companyId, header, permissions, expanded = false }: {
  companyId: string; header: DisbursementVoucherHeader; permissions: readonly string[]; expanded?: boolean;
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
    if (controller.current || !canRevealDisbursementAccount(permissions, header.status) || !header.payeeAccountLast4) return;
    controller.current = new AbortController(); setBusy(true); setError(null);
    try {
      const result = await revealDisbursementVoucherAccount(companyId, header.id, controller.current.signal);
      if (active.current) setNumber(result.accountNumber);
    } catch (failure) { if (active.current) setError(failure); }
    finally { controller.current = null; if (active.current) setBusy(false); }
  };
  if (!header.payeeAccountLast4) return null;
  const numberField = <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
    <p>{!expanded && header.payeeBankName?.replace(/^ธนาคาร\s*/, '')} <span className="whitespace-nowrap font-mono">{number ? number.replace(/(.{4})(?=.)/g, '$1 ') : `xxx-${header.payeeAccountLast4}`}</span></p>
    {canRevealDisbursementAccount(permissions, header.status) && <button type="button" className={quietButtonClass} disabled={busy} aria-busy={busy}
      onClick={() => { if (number) { setNumber(null); setError(null); } else void reveal(); }}>
      {busy ? t('expenses.disbursement.working', 'th') : number ? t('expenses.disbursement.account_hide', 'th') : 'ดูเลขบัญชีเต็ม'}
    </button>}
    {error !== null && <p role="alert" className="text-error-700">{apiErrorMessage(error)}</p>}
  </div>;
  if (!expanded) return numberField;
  return <section className="mb-4 space-y-3" aria-label="โอนเข้าบัญชี">
    <h3 className="text-sm font-semibold">โอนเข้าบัญชี</h3>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-gray-500">ผู้รับเงิน</dt><dd>{header.payeeName}</dd></div>
      {header.payeeBankName && <div><dt className="text-gray-500">ธนาคาร</dt><dd>{header.payeeBankName}</dd></div>}
      {header.payeeAccountName && <div><dt className="text-gray-500">ชื่อบัญชี</dt><dd>{header.payeeAccountName}</dd></div>}
      <div><dt className="text-gray-500">เลขบัญชี</dt><dd>{numberField}</dd></div>
    </dl>
  </section>;
}
