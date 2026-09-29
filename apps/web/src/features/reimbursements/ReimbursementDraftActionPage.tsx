'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { REQUEST_STATUS_LABELS } from './reimbursements.model';
import {
  cancelReimbursementDraftAction,
  confirmReimbursementDraftAction,
  getReimbursementDraftAction,
  type ReimbursementDraftActionResponse,
} from './reimbursements.api';

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: ReimbursementDraftActionResponse; submitting?: 'confirm' | 'cancel' }
  | { kind: 'unknown'; notice: 'result_unconfirmed' | 'connection_lost' }
  | { kind: 'error'; notice: 'read_failed' };

/** The page's own recovery copy. State carries a key, never free text, so no caught error can reach the screen. */
const noticeText = {
  read_failed: 'ไม่สามารถอ่านสถานะล่าสุดได้ กรุณาลองอีกครั้ง',
  result_unconfirmed: 'ยังยืนยันผลไม่ได้ ระบบจะตรวจจากร่างเดิมโดยไม่สร้างใบเบิกซ้ำ',
  connection_lost: 'การเชื่อมต่อขาดระหว่างตรวจผล กรุณาอ่านสถานะเดิมก่อน ห้ามสร้างรายการใหม่',
} as const;

const stateText: Record<string, string> = {
  cancelled: 'ยกเลิกร่างนี้แล้ว โดยไม่ยกเลิกใบเบิกใด ๆ',
  expired: 'ตัวอย่างนี้หมดอายุแล้ว กรุณากลับไปที่ LINE เพื่อสร้างตัวอย่างใหม่',
  stale: 'ข้อมูลต้นทางหรือใบเบิกเปลี่ยนไปแล้ว กรุณากลับไปที่ LINE เพื่อตรวจและสร้างตัวอย่างใหม่',
  needs_fields: 'ข้อมูลยังไม่ครบ กรุณากลับไปตอบคำถามใน LINE',
  needs_target: 'ไม่พบใบเบิกที่เลือกในขอบเขตปัจจุบัน กรุณากลับไปเลือกอีกครั้งใน LINE',
  forbidden: 'คุณไม่มีสิทธิ์เปิดร่างนี้ หรือบัญชี LINE ที่ผูกไว้เปลี่ยนไปแล้ว',
  feature_disabled: 'ปิดการบันทึกร่างจาก LINE ชั่วคราว',
  write_quiesced: 'ระบบใบเบิกกำลังอัปเกรดชั่วคราว กรุณาลองยืนยันอีกครั้งภายหลัง',
  preview_not_fully_delivered: 'ยังแสดงรายละเอียดไม่ครบ จึงยังยืนยันไม่ได้',
};

/* Owner rule 2026-09-27/29: plain Thai, no id, enum key, code, field path, ISO date or revision on screen,
 * and the same words as the LINE card (apps/api/.../line-reimbursement-draft-card.logic.ts). */
const satang = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "1,234.50 บาท", like formatMoney, but the decimal string is formatted as is (no float) and rounds half up like the API. */
function money(value: unknown, currency: unknown) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(value)) return 'ยังตรวจสอบจำนวนเงินไม่ได้';
  return `${satang.format(value as `${number}`)} ${!currency || currency === 'THB' ? 'บาท' : String(currency)}`;
}
const receiptText: Record<string, string> = {
  REQUIRED: 'ยังขาดใบเสร็จบางรายการ', ATTACHED: 'มีหลักฐานครบทุกรายการแล้ว',
  MISSING_WITH_REASON: 'บางรายการไม่มีใบเสร็จ และระบุเหตุผลไว้แล้ว', WAIVED_BY_POLICY: 'นโยบายบริษัทไม่บังคับแนบใบเสร็จ',
};
const categoryText = (line: { categoryLabel?: string }) => line.categoryLabel?.trim() || 'ยังไม่ได้เลือกหมวด';
/** A claimed bill as the customer knows it (document number · shop · date), never its record id. */
function sourceText(source: any): string {
  return [source?.certificate?.documentNumber ?? source?.seller?.documentNumber, source?.seller?.name,
    source?.expenseDate ? formatThaiDate(source.expenseDate) : undefined].filter(Boolean).join(' · ') || 'บิลที่เลือกไว้';
}

const fieldLabels: Record<string, string> = {
  request: 'สร้างร่างใบเบิก', title: 'ชื่อรายการ', reason: 'เหตุผล', missingReceiptReason: 'เหตุผลที่ไม่มีใบเสร็จ',
  amount: 'ยอดรวม', categoryKey: 'หมวดหมู่', categoryLabel: 'ชื่อหมวดหมู่', incurredDate: 'วันที่เกิดค่าใช้จ่าย',
  receiptRequirementStatus: 'สถานะหลักฐาน', lines: 'รายการค่าใช้จ่าย', claimSignatures: 'ลายเซ็นเดิม',
};
const warningLabels: Record<string, string> = {
  missing_receipt: 'บันทึกเป็นร่างได้ แต่ต้องแนบใบเสร็จให้ครบก่อนยื่นเบิก',
  signatures_invalidated: 'ลายเซ็นเดิมจะถูกลบ และต้องลงนามใหม่ภายหลัง',
};

function Snapshot({ value, label }: { value: any; label: string }) {
  if (!value) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" aria-label={label}>
      <h2 className="text-base font-semibold text-gray-900">{label}</h2>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-gray-500">ผู้ขอเบิก</dt><dd className="font-medium">{value.requesterDisplayName}</dd></div>
        {value.branchName && <div><dt className="text-gray-500">สาขา</dt><dd>{value.branchName}</dd></div>}
        <div><dt className="text-gray-500">ยอดรวม</dt><dd className="font-semibold tabular-nums">{money(value.amount, value.currency)}</dd></div>
        <div><dt className="text-gray-500">เหตุผล</dt><dd>{value.reason}</dd></div>
        <div><dt className="text-gray-500">สถานะหลักฐาน</dt><dd>{receiptText[value.receiptRequirementStatus] ?? 'กรุณาตรวจสอบหลักฐาน'}</dd></div>
        {value.title && <div><dt className="text-gray-500">ชื่อรายการ</dt><dd>{value.title}</dd></div>}
        {value.missingReceiptReason && <div><dt className="text-gray-500">เหตุผลที่ไม่มีใบเสร็จ</dt><dd>{value.missingReceiptReason}</dd></div>}
      </dl>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead><tr className="border-b text-gray-500"><th className="py-2 pr-3">#</th><th className="py-2 pr-3">รายการ</th><th className="py-2 pr-3">วันที่</th><th className="py-2 text-right">จำนวน</th></tr></thead>
          <tbody>{(value.lines ?? []).map((line: any) => (
            <tr className="border-b last:border-0" key={line.lineRef}>
              <td className="py-3 pr-3">{line.lineNo}</td><td className="py-3 pr-3">{line.description}<div className="text-xs text-gray-500">{[categoryText(line), line.attachmentId ? 'มีไฟล์แนบ' : 'ยังไม่มีไฟล์แนบ',
                line.linkedExpenseId ? `บิลต้นทาง: ${sourceText(line.sourceExpenseSnapshot)}` : ''].filter(Boolean).join(' · ')}</div></td>
              <td className="whitespace-nowrap py-3 pr-3 tabular-nums">{formatThaiDate(line.incurredDate)}</td><td className="whitespace-nowrap py-3 text-right tabular-nums">{money(line.amount, value.currency)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {value.signatureImpact === 'INVALIDATED' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">การแก้ไขนี้จะลบลายเซ็นเดิม และต้องลงนามใหม่ภายหลัง</p>}
    </section>
  );
}

export function ReimbursementDraftActionView({ companyId, state, onConfirm, onCancel, onRefresh }: {
  companyId: string;
  state: PageState;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  if (state.kind === 'loading') return <main className="mx-auto max-w-4xl p-6" aria-busy="true">กำลังตรวจสอบตัวอย่างใบเบิก…</main>;
  if (state.kind === 'unknown') return <main className="mx-auto max-w-4xl p-6"><h1 className="text-xl font-semibold">กำลังตรวจสอบผลการบันทึก</h1><p className="mt-2">{noticeText[state.notice]}</p><button type="button" className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-white" onClick={onRefresh}>ตรวจสถานะจากระบบ</button></main>;
  if (state.kind === 'error') return <main className="mx-auto max-w-4xl p-6"><h1 className="text-xl font-semibold">เปิดตัวอย่างไม่ได้</h1><p className="mt-2">{noticeText[state.notice]}</p><button type="button" className="mt-4 rounded-lg border px-4 py-2" onClick={onRefresh}>ลองอ่านสถานะอีกครั้ง</button></main>;
  const result = state.result;
  // The claim's document number once it has one (set at submit); its internal id stays in the link only.
  if (result.status === 'applied') return <main className="mx-auto max-w-4xl p-6"><h1 className="text-xl font-semibold text-emerald-800">บันทึกร่างใบเบิกแล้ว</h1><p className="mt-2">{typeof result.receipt.requestNo === 'string' && result.receipt.requestNo ? `เลขที่ใบเบิก ${result.receipt.requestNo} · ` : ''}ยอด {money(result.receipt.amount, result.receipt.currency)} · สถานะปัจจุบัน {REQUEST_STATUS_LABELS[String(result.receipt.currentState ?? result.receipt.committedState)] ?? 'กรุณาเปิดใบเบิกเพื่อตรวจสอบ'}</p>{result.receipt.requestId && <Link className="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-white" href={`/companies/${encodeURIComponent(companyId)}/reimbursements/${encodeURIComponent(result.receipt.requestId)}`}>เปิดใบเบิก</Link>}</main>;
  if (result.status !== 'preview') {
    const code = result.status === 'blocked' ? result.errorCode : result.status;
    return <main className="mx-auto max-w-4xl p-6"><h1 className="text-xl font-semibold">ร่างใบเบิกจาก LINE</h1><p className="mt-3">{stateText[code] ?? 'ยังดำเนินการกับร่างนี้ไม่ได้'}</p>{result.status === 'result_unknown' && <button type="button" className="mt-4 rounded-lg border px-4 py-2" onClick={onRefresh}>ตรวจสถานะจากระบบ</button>}</main>;
  }
  const preview = result.preview;
  const expired = Date.parse(preview.expiresAt) <= Date.now();
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header><p className="text-sm font-medium text-indigo-700">ตัวอย่างก่อนบันทึก</p><h1 className="text-2xl font-bold text-gray-950">ตรวจร่างใบเบิกจาก LINE</h1><p className="mt-1 text-sm text-gray-600">ระบบจะบันทึกเป็นร่างเท่านั้น ไม่ส่งอนุมัติ ไม่อนุมัติ และไม่จ่ายเงิน</p></header>
      {preview.before && <Snapshot value={preview.before} label="ข้อมูลก่อนแก้ไข" />}
      <Snapshot value={preview.after} label={preview.operation === 'CREATE' ? 'ร่างที่จะสร้าง' : 'ข้อมูลหลังแก้ไข'} />
      <section className="rounded-xl border border-gray-200 bg-gray-50 p-4"><h2 className="font-semibold">สิ่งที่จะเปลี่ยน</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{preview.diff.map((item: any, index: number) => <li key={`${item.fieldPath}:${index}`}>{fieldLabels[item.fieldPath] ?? 'รายละเอียดตามตัวอย่างด้านบน'}</li>)}</ul></section>
      {preview.warnings.length > 0 && <section className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950"><h2 className="font-semibold">โปรดตรวจสอบ</h2><ul className="mt-1 list-disc pl-5">{preview.warnings.map((item: string) => <li key={item}>{warningLabels[item] ?? 'กรุณาตรวจรายละเอียดและหลักฐานก่อนยืนยัน'}</li>)}</ul></section>}
      {expired && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">ตัวอย่างนี้หมดอายุแล้ว กรุณากลับไปสร้างตัวอย่างใหม่ใน LINE</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className="rounded-lg border border-gray-300 px-5 py-3 font-medium" disabled={!!state.submitting} onClick={onCancel}>{state.submitting === 'cancel' ? 'กำลังยกเลิก…' : 'ยกเลิกร่างนี้'}</button>
        <button type="button" className="rounded-lg bg-indigo-700 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={expired || !!state.submitting} onClick={onConfirm}>{state.submitting === 'confirm' ? 'กำลังบันทึก…' : 'ยืนยันบันทึกเป็นร่าง'}</button>
      </div>
    </main>
  );
}

export function ReimbursementDraftActionPage({ companyId, actionId }: { companyId: string; actionId: string }) {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try { setState({ kind: 'ready', result: await getReimbursementDraftAction(companyId, actionId) }); }
    catch { setState({ kind: 'error', notice: 'read_failed' }); }
  }, [actionId, companyId]);
  useEffect(() => { void load(); }, [load]);
  const mutate = async (kind: 'confirm' | 'cancel') => {
    if (state.kind !== 'ready' || state.result.status !== 'preview' || state.submitting) return;
    const { previewRevision, confirmationDigest } = state.result.preview;
    setState({ ...state, submitting: kind });
    try {
      const result = kind === 'confirm'
        ? await confirmReimbursementDraftAction(companyId, actionId, { previewRevision, confirmationDigest })
        : await cancelReimbursementDraftAction(companyId, actionId, { previewRevision, confirmationDigest });
      setState(result.status === 'result_unknown'
        ? { kind: 'unknown', notice: 'result_unconfirmed' }
        : { kind: 'ready', result });
    } catch {
      setState({ kind: 'unknown', notice: 'connection_lost' });
    }
  };
  return <ReimbursementDraftActionView companyId={companyId} state={state} onConfirm={() => void mutate('confirm')} onCancel={() => void mutate('cancel')} onRefresh={() => void load()} />;
}
