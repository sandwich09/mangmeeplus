'use client';

import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { primaryButtonClass as btnClass, secondaryButtonClass as ghostClass } from '@/common/components/button/button-classes';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { LoadingState } from '@/common/components/state/LoadingState';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { REQUEST_STATUS_LABELS } from './reimbursements.model';
import { categoryText, money } from './reimbursements.logic';
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
  read_failed: 'อ่านสถานะล่าสุดไม่ได้ ลองอีกครั้ง',
  result_unconfirmed: 'ยังยืนยันผลไม่ได้ ระบบจะตรวจจากร่างเดิมโดยไม่สร้างใบเบิกซ้ำ',
  connection_lost: 'การเชื่อมต่อขาดระหว่างตรวจผล กดตรวจสถานะจากระบบก่อน อย่าเพิ่งสร้างใบเบิกใหม่',
} as const;

const stateText: Record<string, string> = {
  cancelled: 'ยกเลิกร่างนี้แล้ว โดยไม่ยกเลิกใบเบิกใด ๆ',
  expired: 'ตัวอย่างนี้หมดอายุแล้ว กลับไปที่ LINE เพื่อสร้างตัวอย่างใหม่',
  stale: 'ข้อมูลต้นทางหรือใบเบิกเปลี่ยนไปแล้ว กลับไปที่ LINE เพื่อตรวจและสร้างตัวอย่างใหม่',
  needs_fields: 'ข้อมูลยังไม่ครบ กลับไปตอบคำถามใน LINE',
  needs_target: 'ไม่พบใบเบิกที่เลือกในขอบเขตปัจจุบัน กลับไปเลือกอีกครั้งใน LINE',
  result_unknown: noticeText.result_unconfirmed,
  forbidden: 'คุณไม่มีสิทธิ์เปิดร่างนี้ หรือบัญชี LINE ที่ผูกไว้เปลี่ยนไปแล้ว',
  feature_disabled: 'ปิดการบันทึกร่างจาก LINE ชั่วคราว สร้างใบเบิกในหน้าการเบิกจ่ายได้',
  write_quiesced: 'ระบบใบเบิกกำลังอัปเกรดชั่วคราว ลองยืนยันอีกครั้งภายหลัง',
  preview_not_fully_delivered: 'ยังแสดงรายละเอียดไม่ครบ จึงยังยืนยันไม่ได้',
};
/** A state nobody wrote a sentence for: what to do is still said, and the way back to the claims is above it. */
const UNKNOWN_STATE_TEXT = 'ยังใช้ร่างนี้ไม่ได้ กลับไปที่ LINE แล้วลองอีกครั้ง';

/* Owner rule 2026-09-27/29: plain Thai, no id, enum key, code, field path, ISO date or revision on screen,
 * and the words of the LINE card (apps/api/.../line-reimbursement-draft-card.logic.ts) for what a line holds; `money`
 * and `categoryText` are shared with the other claim pages (reimbursements.logic). Two things are said in the web's own
 * words (Thai UX standard, glossary): the shop is "ร้าน", and a claim is sent with "ส่งอนุมัติ". */
const receiptText: Record<string, string> = {
  REQUIRED: 'ยังขาดใบเสร็จบางรายการ', ATTACHED: 'มีหลักฐานครบทุกรายการแล้ว',
  MISSING_WITH_REASON: 'บางรายการไม่มีใบเสร็จ และระบุเหตุผลไว้แล้ว', WAIVED_BY_POLICY: 'ร้านไม่บังคับแนบใบเสร็จ',
};
/** A claimed bill as the customer knows it (document number · shop · date), never its record id. */
function sourceText(source: any): string {
  return [source?.certificate?.documentNumber ?? source?.seller?.documentNumber, source?.seller?.name,
    source?.expenseDate ? formatThaiDate(source.expenseDate) : undefined].filter(Boolean).join(' · ') || 'บิลที่เลือกไว้';
}
/** The card's per-line evidence words, by the same test as the claim's evidence status: a bill claimed by reference brings its own receipt. */
const evidenceText = (line: any) => line.attachmentId ? 'มีไฟล์แนบ' : line.linkedExpenseId ? 'ใช้ใบเสร็จจากบิลต้นทาง' : 'ยังไม่มีไฟล์แนบ';
/** Category · evidence · claimed bill, under the line's description on the phone card and in the table alike. */
const lineFacts = (line: any) => [categoryText(line.categoryLabel), evidenceText(line),
  line.linkedExpenseId ? `บิลต้นทาง: ${sourceText(line.sourceExpenseSnapshot)}` : ''].filter(Boolean).join(' · ');

const fieldLabels: Record<string, string> = {
  title: 'ชื่อรายการ', reason: 'เหตุผล', missingReceiptReason: 'เหตุผลที่ไม่มีใบเสร็จ',
  amount: 'ยอดรวม', categoryKey: 'หมวด', categoryLabel: 'หมวด', incurredDate: 'วันที่',
  receiptRequirementStatus: 'ใบเสร็จ', lines: 'รายการ', claimSignatures: 'ลายเซ็นเดิม',
};
/** A changed field that is one value: what it held before and what it will hold, in the words of the cards below. */
const fieldValue: Record<string, (value: any) => string> = {
  title: value => value?.title ?? '', reason: value => value?.reason ?? '', missingReceiptReason: value => value?.missingReceiptReason ?? '',
  amount: value => money(value?.amount, value?.currency),
  receiptRequirementStatus: value => receiptText[value?.receiptRequirementStatus] ?? 'ตรวจสอบหลักฐาน',
};
const warningLabels: Record<string, string> = {
  missing_receipt: 'บันทึกเป็นร่างได้ แต่ต้องแนบใบเสร็จให้ครบก่อนส่งอนุมัติ',
  signatures_invalidated: 'การแก้ไขนี้จะลบลายเซ็นเดิม และต้องเซ็นใหม่ภายหลัง',
};
const dtClass = 'text-sm text-gray-500';
const ddClass = 'mt-0.5 break-words text-sm font-semibold text-gray-900';

function Snapshot({ value, label }: { value: any; label?: string }) {
  if (!value) return null;
  const lines: any[] = value.lines ?? [];
  return (
    <>
      {label && <h2 className="text-base font-bold text-gray-900">{label}</h2>}
      <dl className={label ? 'mt-3 grid gap-3 sm:grid-cols-2' : 'grid gap-3 sm:grid-cols-2'}>
        <div><dt className={dtClass}>ผู้เบิก</dt><dd className={ddClass}>{value.requesterDisplayName}</dd></div>
        {value.branchName && <div><dt className={dtClass}>สาขา</dt><dd className={ddClass}>{value.branchName}</dd></div>}
        <div><dt className={dtClass}>ยอดรวม</dt><dd className={ddClass}><span className="mangmee-unit">{money(value.amount, value.currency)}</span></dd></div>
        <div><dt className={dtClass}>เหตุผล</dt><dd className={ddClass}>{value.reason}</dd></div>
        <div><dt className={dtClass}>ใบเสร็จ</dt><dd className={ddClass}>{receiptText[value.receiptRequirementStatus] ?? 'ตรวจสอบหลักฐาน'}</dd></div>
        {value.title && <div><dt className={dtClass}>ชื่อรายการ</dt><dd className={ddClass}>{value.title}</dd></div>}
        {value.missingReceiptReason && <div><dt className={dtClass}>เหตุผลที่ไม่มีใบเสร็จ</dt><dd className={ddClass}>{value.missingReceiptReason}</dd></div>}
      </dl>
      {/* A claim with no line has no list to draw: an empty table with its headers said nothing. */}
      {lines.length === 0 ? <p className="mt-4 text-sm text-gray-500">ยังไม่มีรายการ</p> : (
        <>
          {/* Phones: one row per line with a line between, as on the claim page. Four columns left the item a sliver of a 390 px screen. */}
          <div className="mt-4 divide-y divide-gray-100 border-t border-gray-100 sm:hidden" data-testid="draft-line-cards">
            {lines.map((line: any) => (
              <div className="py-3" key={line.lineRef}>
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0 break-words font-semibold text-gray-900">{line.description}</div>
                  <div className="mangmee-unit shrink-0 font-semibold">{money(line.amount, value.currency)}</div>
                </div>
                <div className="mangmee-unit mt-1 text-sm text-gray-500">{formatThaiDate(line.incurredDate)}</div>
                <div className="mt-0.5 break-words text-sm text-gray-500">{lineFacts(line)}</div>
              </div>
            ))}
          </div>
          <div className="mangmee-table-scroll mt-4 hidden sm:block" data-testid="draft-lines-table">
            <table className="min-w-full text-left text-sm">
              <thead><tr className="border-b text-gray-500"><th className="py-2 pr-3 font-semibold">รายการ</th><th className="py-2 pr-3 font-semibold">วันที่</th><th className="py-2 text-right font-semibold">ยอดเงิน</th></tr></thead>
              <tbody>{lines.map((line: any) => (
                <tr className="border-b last:border-0" key={line.lineRef}>
                  <td className="py-3 pr-3"><span className="font-semibold text-gray-900">{line.description}</span><div className="text-sm text-gray-500">{lineFacts(line)}</div></td>
                  <td className="whitespace-nowrap py-3 pr-3 tabular-nums">{formatThaiDate(line.incurredDate)}</td><td className="whitespace-nowrap py-3 text-right tabular-nums">{money(line.amount, value.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** What an edit changes, once: a field that is one value says what it was and what it will be; the lines are in the cards below. */
function Changes({ preview }: { preview: any }) {
  const seen = new Set<string>();
  const rows = (preview.diff as any[]).flatMap((item) => {
    // The signatures an edit removes are said by the warning under the cards, in a full sentence.
    if (item.fieldPath === 'claimSignatures') return [];
    const label = fieldLabels[item.fieldPath] ?? 'รายละเอียดอื่น';
    if (seen.has(label)) return [];
    seen.add(label);
    const read = fieldValue[item.fieldPath];
    return [{ label, before: read ? read(preview.before) || 'ไม่มี' : null, after: read ? read(preview.after) || 'ไม่มี' : null }];
  });
  if (rows.length === 0) return null;
  return (
    <MangmeeCard className="p-4 sm:p-5">
      <h2 className="text-base font-bold text-gray-900">สิ่งที่จะเปลี่ยน</h2>
      <dl className="mt-3 space-y-3">
        {rows.map(row => (
          <div key={row.label}>
            <dt className="text-sm font-semibold text-gray-900">{row.label}</dt>
            {row.before !== null ? (
              <dd className="mt-0.5 break-words text-sm text-gray-600"><span className="block">{`เดิม: ${row.before}`}</span><span className="block text-gray-900">{`ใหม่: ${row.after}`}</span></dd>
            ) : <dd className="mt-0.5 text-sm text-gray-600">ดูในข้อมูลหลังแก้ไขด้านล่าง</dd>}
          </div>
        ))}
      </dl>
    </MangmeeCard>
  );
}

export function ReimbursementDraftActionView({ companyId, state, onConfirm, onCancel, onRefresh }: {
  companyId: string;
  state: PageState;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const hubHref = `/companies/${encodeURIComponent(companyId)}/reimbursements`;
  // One frame for every state: the shop's page header, with the way back to the claims above the title. A state that
  // cannot go on (no right, expired, changed meanwhile) is therefore never a dead end.
  const frame = (title: string, children: ReactNode, description?: string) => (
    <MangmeePage back={<BackLink href={hubHref} label="กลับไปการเบิกจ่าย" />} title={title} description={description}>{children}</MangmeePage>
  );
  const checkStatus = <button type="button" className={ghostClass} onClick={onRefresh}>ตรวจสถานะจากระบบ</button>;

  if (state.kind === 'loading') return frame('ตรวจร่างใบเบิกจาก LINE', <MangmeeCard className="p-4"><LoadingState label="กำลังตรวจสอบตัวอย่างใบเบิก…" /></MangmeeCard>);
  if (state.kind === 'unknown') return frame('ร่างใบเบิกจาก LINE', <Notice tone="warning" action={checkStatus}>{noticeText[state.notice]}</Notice>);
  if (state.kind === 'error') {
    return frame('ร่างใบเบิกจาก LINE', <Notice tone="error" action={<button type="button" className={ghostClass} onClick={onRefresh}>ลองอีกครั้ง</button>}>{noticeText[state.notice]}</Notice>);
  }
  const result = state.result;
  if (result.status === 'applied') {
    const current = String(result.receipt.currentState ?? result.receipt.committedState);
    // The claim's document number once it has one (set at submit); its internal id stays in the link only.
    return frame('ร่างใบเบิกจาก LINE', (
      <>
        <Notice tone="success">บันทึกร่างใบเบิกแล้ว</Notice>
        <MangmeeCard className="space-y-3 p-4 sm:p-5">
          <p className="text-sm text-gray-700">{typeof result.receipt.requestNo === 'string' && result.receipt.requestNo ? `เลขที่ใบเบิก ${result.receipt.requestNo} · ` : ''}ยอด {money(result.receipt.amount, result.receipt.currency)} · สถานะปัจจุบัน {REQUEST_STATUS_LABELS[current] ?? 'เปิดใบเบิกเพื่อตรวจสอบ'}</p>
          {/* What is left to do, said only of a claim that is still a draft: nothing was sent for approval from LINE. */}
          {current === 'DRAFT' && <p className="text-sm text-gray-700">ยังไม่ได้ส่งอนุมัติ เปิดใบเบิกเพื่อตรวจและส่งอนุมัติ</p>}
          {result.receipt.requestId && (
            <ActionGroup>
              <Link className={btnClass} href={`${hubHref}/${encodeURIComponent(result.receipt.requestId)}`}>เปิดใบเบิก</Link>
            </ActionGroup>
          )}
        </MangmeeCard>
      </>
    ));
  }
  if (result.status !== 'preview') {
    const code = result.status === 'blocked' ? result.errorCode : result.status;
    return frame('ร่างใบเบิกจาก LINE', (
      <Notice tone={code === 'cancelled' ? 'success' : code === 'forbidden' ? 'error' : 'warning'} action={result.status === 'result_unknown' ? checkStatus : undefined}>
        {stateText[code] ?? UNKNOWN_STATE_TEXT}
      </Notice>
    ));
  }
  const preview = result.preview;
  const expired = Date.parse(preview.expiresAt) <= Date.now();
  // Each thing to mind is said once: the lost signatures were in the card and again in the list under it.
  const warnings: string[] = [...new Set<string>([
    ...(preview.warnings as string[]).map((item) => warningLabels[item] ?? 'ตรวจรายละเอียดและหลักฐานก่อนยืนยัน'),
    ...(preview.after?.signatureImpact === 'INVALIDATED' ? [warningLabels.signatures_invalidated!] : []),
  ])];
  const editing = Boolean(preview.before) && preview.operation !== 'CREATE';
  return frame('ตรวจร่างใบเบิกจาก LINE', (
    <>
      {editing && <Changes preview={preview} />}
      <MangmeeCard className="p-4 sm:p-5">
        <Snapshot value={preview.after} label={editing ? 'ข้อมูลหลังแก้ไข' : undefined} />
      </MangmeeCard>
      {/* The whole claim as it stands now, for whoever wants to compare line by line: behind one press, under the new one. */}
      {editing && (
        <MangmeeCard className="p-4 sm:p-5">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-bold text-gray-900 [&::-webkit-details-marker]:hidden">
              <span>ข้อมูลก่อนแก้ไข</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0 text-gray-500 transition-transform group-open:rotate-180"><path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </summary>
            <div className="mt-2"><Snapshot value={preview.before} /></div>
          </details>
        </MangmeeCard>
      )}
      {warnings.map((text) => <Notice key={text} tone="warning">{text}</Notice>)}
      {expired && <Notice tone="error">ตัวอย่างนี้หมดอายุแล้ว กลับไปสร้างตัวอย่างใหม่ใน LINE</Notice>}
      <ActionGroup>
        <button type="button" className={ghostClass} disabled={!!state.submitting} aria-busy={state.submitting === 'cancel'} onClick={onCancel}>ยกเลิกร่างนี้</button>
        <button type="button" className={btnClass} disabled={expired || !!state.submitting} aria-busy={state.submitting === 'confirm'} onClick={onConfirm}>ยืนยันบันทึกเป็นร่าง</button>
      </ActionGroup>
    </>
  ), 'บันทึกเป็นร่างเท่านั้น ยังไม่ส่งอนุมัติ');
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
