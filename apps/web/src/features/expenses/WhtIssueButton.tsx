'use client';

import { useEffect, useRef, useState } from 'react';
import { WHT_PRINT_CERTIFICATE_LABEL, WHT_PRINT_CERTIFICATE_BUSY_LABEL, whtPayeeAddress, type WhtCertificateHandoffDto } from '@watchdog-bms/contracts';
import { Button } from '@/common/components/button';
import { Modal } from '@/common/components/modal/Modal';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { amountText, btnClass } from './ExpensesUi';
import { formatTaxId } from './expenses.model';

type Props = { handoff: WhtCertificateHandoffDto | null; onIssue: () => Promise<void> | void; unpaid?: boolean; busy?: boolean; className?: string; label?: string };

export function WhtIssueButton({ handoff, onIssue, unpaid, busy = false, className = btnClass, label = WHT_PRINT_CERTIFICATE_LABEL }: Props) {
  const [open, setOpen] = useState(false);
  if (!handoff) return null;
  return <>
    <button type="button" data-primary-action="issue" className={className} disabled={busy} aria-busy={busy} onClick={() => setOpen(true)}>{busy ? WHT_PRINT_CERTIFICATE_BUSY_LABEL : label}</button>
    {open && <IssueConfirmation handoff={handoff} unpaid={unpaid} onIssue={onIssue} onClose={() => setOpen(false)} />}
  </>;
}

function IssueConfirmation({ handoff, unpaid, onIssue, onClose }: { handoff: WhtCertificateHandoffDto; unpaid?: boolean; onIssue: () => Promise<void> | void; onClose: () => void }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 600);
    return () => window.clearTimeout(timer);
  }, []);
  const issue = async () => {
    if (!ready || busy || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await onIssue(); onClose(); } finally { busyRef.current = false; setBusy(false); }
  };
  const facts = handoff.prefill;
  const payee = facts.payeeSnapshot;
  const word = (key: 'name' | 'tax_id' | 'address' | 'income' | 'gross' | 'withheld' | 'unpaid' | 'consequence' | 'confirm') => t(`expenses.certificate_issue.${key}`, 'th');
  return <Modal open title={`${WHT_PRINT_CERTIFICATE_LABEL} ให้ผู้รับเงิน`} size="sm" closeOnBackdrop={false} onClose={() => { if (!busyRef.current) onClose(); }}
    /* Plain buttons: the shared footer gives them one size, side by side or stacked with the acting one on top. */
    footer={<>
      <Button type="button" variant="secondary" disabled={busy} loading={false} onClick={onClose}>ปิด</Button>
      <Button type="button" variant="primary" disabled={!ready || busy} loading={busy} onClick={() => void issue()}>{busy ? WHT_PRINT_CERTIFICATE_BUSY_LABEL : word('confirm')}</Button>
    </>}>
    <dl className="space-y-2 break-words text-sm leading-6 text-gray-800">
      {[[word('name'), payee.name], [word('tax_id'), formatTaxId(payee.taxId ?? '') || '—'], [word('address'), whtPayeeAddress(handoff.payeeAddress, payee.address) || '—'],
        [word('income'), facts.incomeCategoryName || '—']].map(([label, value]) => <div key={label}><dt className="text-gray-500">{label}</dt><dd className="whitespace-pre-wrap">{value}</dd></div>)}
      <div className="flex flex-wrap items-center gap-2"><div><dt className="inline">{word('gross')}{' '}</dt><dd className="inline">{amountText(facts.grossAmount)} บาท</dd></div>
        {unpaid === true && <span className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{word('unpaid')}</span>}</div>
      <div><dt className="inline">{word('withheld')}{' '}</dt><dd className="inline">{amountText(facts.withheldAmount)} บาท</dd></div>
    </dl>
    <p className="mt-3 text-sm leading-6">{word('consequence')}</p>
  </Modal>;
}
