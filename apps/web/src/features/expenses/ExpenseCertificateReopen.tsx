'use client';

import { useState, type ReactNode } from 'react';
import { ExpenseDisbursementReopenNotice } from './ExpenseDisbursementReopenNotice';
import type { ExpenseDetail } from './expenses.model';
import type { ExpenseCorrectionCapabilities, WhtCertificateHandoffDto } from '@watchdog-bms/contracts';

export type ExpenseCertificate = NonNullable<ExpenseCorrectionCapabilities['certificateOnExpense']>;
// "ของรายการนี้", not "ของเดือนนี้": a document dated last month is the usual case, and "this month" then names the wrong return.
export const TAX_FILING_ATTESTATION = 'ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้ หรือจะยื่นแก้ไขเพิ่มเติมเอง';
export const TAX_FILING_HELP = 'ถ้ายื่นไปแล้ว ข้อมูลในระบบจะไม่ตรงกับที่ยื่นไว้ คุณต้องยื่นแก้ไขกับกรมสรรพากรเอง';

export type TaxFilingChoice = '' | 'NOT_FILED' | 'FILED';
export function ExpenseTaxFilingChoice({ value, onChange, busy, name }: { value: TaxFilingChoice; onChange: (value: TaxFilingChoice) => void; busy: boolean; name: string }) {
  return <div className="space-y-2 text-sm leading-6 text-gray-700">
    {([['NOT_FILED', 'ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้'], ['FILED', 'ยื่นไปแล้ว จะแจ้งคนที่ยื่นภาษีให้ร้านยื่นแบบแก้ไข']] as const).map(([choice, label]) => <label key={choice} className="flex min-h-11 items-start gap-2">
      <input className="mt-1 h-5 w-5 shrink-0" type="radio" name={name} required value={choice} checked={value === choice} disabled={busy} onChange={() => onChange(choice)} /><span>{label}</span>
    </label>)}
    <p className="text-xs text-gray-600">ไม่แน่ใจ ให้ถามคนที่ยื่นภาษีให้ร้านก่อน</p>
    {value === 'FILED' && <p className="text-xs text-gray-600">ข้อมูลที่ยื่นไว้ไม่เปลี่ยนตาม ต้องให้คนที่ยื่นภาษีให้ร้านยื่นแบบแก้ไข</p>}
  </div>;
}

/** Dialogs and the card must name the same current certificate, including command answers before a re-read. */
export function currentExpenseCertificate(handoff: WhtCertificateHandoffDto | null, fallback: ExpenseCertificate | null | undefined, permissions: string[]): ExpenseCertificate | null {
  if (!handoff) return fallback ?? null;
  if (handoff.status === 'SYSTEM_ISSUED') return { kind: 'SYSTEM', number: handoff.currentCertificate?.number ?? handoff.certificateNumber,
    date: handoff.currentCertificate?.issuedAt ?? handoff.certificateIssuedAt, canCancel: permissions.includes('wht.certificate.correct') };
  if (handoff.status === 'EXTERNAL_LINKED') return { kind: 'EXTERNAL', number: handoff.externalCertificateNumber,
    date: handoff.externalIssuedDate, canCancel: permissions.includes('wht.external_certificate.link') };
  return null;
}

export function expenseCertificateReopenedMessage(certificate: Pick<ExpenseCertificate, 'kind' | 'number'>): string {
  const number = certificate.number ? `เลขที่ ${certificate.number}` : '';
  return certificate.kind === 'SYSTEM'
    ? `เปิดให้แก้ไขแล้ว และยกเลิกหนังสือรับรอง${number} แล้ว`
    : `เปิดให้แก้ไขแล้ว และยกเลิกการบันทึกหนังสือรับรอง${number} แล้ว`;
}

type Props = {
  certificate?: ExpenseCertificate | null;
  busy: boolean;
  payments?: ExpenseDetail['payments'];
  children: (attested: boolean, notice: ReactNode, footer: (content: ReactNode) => ReactNode, attestation: ReactNode) => ReactNode;
};

// Keep the certificate-free dialog's form and submit handler unchanged.
export function ExpenseCertificateReopen(props: Props) {
  return props.certificate ? <CertificateReopenAttestation {...props} certificate={props.certificate} /> : props.children(false, <ExpenseDisbursementReopenNotice payments={props.payments} />, content => content, null);
}

function CertificateReopenAttestation({ certificate, busy, children, payments }: Props & { certificate: ExpenseCertificate }) {
  const [choice, setChoice] = useState<TaxFilingChoice>('');
  const number = certificate.number ? ` เลขที่ ${certificate.number}` : '';
  return children(Boolean(choice), <div className="space-y-3 text-sm leading-6 text-gray-700">
    <div className="font-semibold">{certificate.kind === 'SYSTEM'
      ? 'เอกสารนี้ออกหนังสือรับรอง 50 ทวิแล้ว'
      : 'เอกสารนี้บันทึกไว้ว่าออกหนังสือรับรอง 50 ทวินอกระบบแล้ว'} <span className="whitespace-nowrap">{number.trim()}</span></div>
    {certificate.kind === 'EXTERNAL' && <p>ระบบยกเลิกใบที่ทำนอกระบบให้ไม่ได้ ร้านต้องยกเลิกเอง</p>}
    <ExpenseDisbursementReopenNotice payments={payments} />
  </div>, /* The buttons go to the window as they are: its shared footer gives them one width, stacked when the long name ("ยกเลิกหนังสือรับรองและแก้ไขเอกสาร") does not fit beside the other. */
  content => content, <ExpenseTaxFilingChoice name="expense-reopen-tax-filing" value={choice} onChange={setChoice} busy={busy} />);
}
