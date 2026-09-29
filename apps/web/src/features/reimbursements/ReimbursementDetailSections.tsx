'use client';

// The claim detail as sections, shared by the hub drawer and the journey page while both exist
// (the drawer goes in Phase 6). Markup moved from the drawer; test ids are kept on it.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { useToast } from '@/common/components/toast';
import { downloadDocumentAsPdf } from '@/common/files/download-document-pdf';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { RECEIPT_UPLOAD_ACCEPT } from '../expenses/expense-upload.logic';
import {
  dateShort, ErrorBanner, InfoBanner, inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
} from '../expenses/ExpensesUi';
import { ReimbursementSourceFacts } from './ReimbursementSourceFacts';
import { fetchAttachmentPreviewBlob, previewReimbursementClaimForm, recordReimbursementPayment } from './reimbursements.api';
import {
  REQUEST_STATUS_LABELS, REQUEST_STATUS_TONES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
  FINANCE_REVIEW_LABELS, PAYMENT_METHOD_LABELS, RECEIPT_REQUIREMENT_LABELS, DUPLICATE_STATUS_LABELS,
  APPROVAL_STEP_STATUS_LABELS, CLAIM_SIGNATURE_ROLE_LABELS,
  canUploadSignedCopy, canVoidRecordedPayment, claimSelfApproved, claimSignAction, claimSignatureSlots, reimbursementOwnActions,
  type ClaimSignatureRole,
} from './reimbursements.model';
import { buildClaimTimeline, categoryText, errorText, formatMoney, paperSignedLine, sumLineAmounts, validatePaymentForm, type ApprovalFieldDiff } from './reimbursements.logic';

export function StatusBadge({ status }: { status: string }) {
  return <MangmeeBadge tone={REQUEST_STATUS_TONES[status] ?? 'slate'}>{REQUEST_STATUS_LABELS[status] ?? '—'}</MangmeeBadge>;
}
export function PaymentBadge({ status }: { status: string }) {
  return <MangmeeBadge tone={PAYMENT_STATUS_TONES[status] ?? 'slate'}>{PAYMENT_STATUS_LABELS[status] ?? '—'}</MangmeeBadge>;
}

/**
 * FINANCE_REVIEW + อนุมัติจ่าย means the decision is already durable and only the expense
 * projections are missing (the saga threw between its two phases). The same finance-decision
 * endpoint resumes it, so the button offers to continue rather than to approve twice.
 */
export const financeActionLabel = (row: { financeReviewStatus?: string }) =>
  (row.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการต่อ' : 'อนุมัติจ่าย');

export function RejectDialog({ requestNo, busy, error, onClose, onConfirm }: {
  requestNo?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = reason.trim();
  // `autoFocus` loses to Modal's own mount effect, which focuses the dialog container.
  // Modal is the child component, so its effect runs first and this one wins.
  useEffect(() => { reasonRef.current?.focus(); }, []);
  return (
    <Modal open title={`ปฏิเสธคำขอ ${requestNo ?? ''}`.trim()} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">ระบุเหตุผลที่ปฏิเสธ ผู้ขอจะเห็นข้อความนี้</p>
        {error && <ErrorBanner message={error} />}
        <textarea ref={reasonRef} className={cx(inputClass, 'min-h-24 resize-y')} value={reason}
          onChange={e => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH}
          placeholder="เช่น ยอดไม่ตรงกับใบเสร็จ" />
        <div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/500</div>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="button" className={dangerClass} disabled={busy || !trimmed} aria-busy={Boolean(busy)}
            onClick={() => onConfirm(trimmed)}>ปฏิเสธคำขอ</button>
        </div>
      </div>
    </Modal>
  );
}

export function ReasonDialog({ title, description, confirmLabel, busy, error, danger = false, onClose, onConfirm }: {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = reason.trim();
  useEffect(() => { reasonRef.current?.focus(); }, []);
  return (
    <Modal open title={title} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{description}</p>
        {error && <ErrorBanner message={error} />}
        <textarea ref={reasonRef} className={cx(inputClass, 'min-h-24 resize-y')} value={reason}
          onChange={e => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH}
          placeholder="ระบุเหตุผลให้ชัดเจน" />
        <div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/500</div>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="button" className={danger ? dangerClass : btnClass} disabled={busy || !trimmed} aria-busy={Boolean(busy)}
            onClick={() => onConfirm(trimmed)}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

export function VoidPaymentDialog({ payment, busy, error, onClose, onConfirm }: {
  payment: any;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const trimmed = reason.trim();
  return (
    <Modal open title={`ยกเลิกการจ่าย ${payment.paymentNo ?? ''}`.trim()} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <div className="space-y-4">
        <ErrorBanner message="ระบบจะกลับรายการจ่ายและรายการบัญชีที่เกี่ยวข้อง ใบเบิกจะกลับไปสถานะรอจ่าย" />
        {error && <ErrorBanner message={error} />}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-gray-600">เหตุผล *</label>
          <textarea className={cx(inputClass, 'min-h-24 resize-y')} value={reason}
            onChange={e => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH}
            placeholder="เช่น บันทึกเลขอ้างอิงผิด หรือยกเลิกรายการโอนแล้ว" />
          <div className="mt-1 text-right text-xs text-gray-400 tabular-nums">{reason.length}/500</div>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-600">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
          <span>ยืนยันว่าได้ตรวจสอบและจัดการรายการเงินจริงกับธนาคาร/ผู้รับเงินแล้ว</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>กลับ</button>
          <button type="button" className={dangerClass} disabled={busy || !trimmed || !acknowledged} aria-busy={Boolean(busy)}
            onClick={() => onConfirm(trimmed)}>ยืนยันยกเลิกการจ่าย</button>
        </div>
      </div>
    </Modal>
  );
}

export function StaleApprovalDialog({ requestNo, diff, lines, currency, busy, error, onClose, onConfirm }: {
  requestNo?: string;
  diff: ApprovalFieldDiff[];
  lines: any[];
  currency: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      title={`ตรวจสอบข้อมูลล่าสุด ${requestNo ?? ''}`.trim()}
      size="lg"
      closeLabel="ปิด"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="button" className={successBtn} style={successBtnStyle} disabled={busy} aria-busy={Boolean(busy)} onClick={onConfirm}>
            อนุมัติด้วยข้อมูลล่าสุด
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <ErrorBanner message="คำขอนี้ถูกแก้ไขหลังจากส่งอนุมัติ กรุณาตรวจสอบข้อมูลล่าสุดก่อนตัดสินใจ" />
        <div className="overflow-x-auto">
          <table className="mangmee-table">
            <thead>
              <tr><th>ข้อมูล</th><th>ก่อนหน้า</th><th>ปัจจุบัน</th></tr>
            </thead>
            <tbody>
              {diff.map(row => (
                <tr key={row.key} className={cx(row.changed ? 'bg-warning-50' : 'text-gray-500', row.key === 'amount' && 'whitespace-nowrap')}>
                  <td>{row.label}</td>
                  <td className={row.changed ? 'text-gray-400 line-through' : 'text-gray-500'}>{row.before}</td>
                  <td className={row.changed ? 'font-bold text-gray-900' : 'text-gray-500'}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{row.after}</span>
                      {row.changed && <MangmeeBadge tone="amber">แก้ไขแล้ว</MangmeeBadge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {diff.every(row => !row.changed) && (
          <InfoBanner message="ระบบตรวจพบว่าคำขอถูกแก้ไข แต่ระบุจุดที่เปลี่ยนจากข้อมูลในคิวไม่ได้ (เช่น แก้ไขรายละเอียดรายการหรือวันที่) กรุณาตรวจรายการทั้งหมดด้านล่าง" />
        )}
        <div>
          <h4 className="mb-2 text-sm font-bold text-gray-900">รายการปัจจุบัน</h4>
          <div className="overflow-x-auto">
            <table className="mangmee-table">
              <thead>
                <tr><th>#</th><th>วันที่</th><th>รายการ</th><th>หมวด</th><th className="text-right">จำนวนเงิน</th></tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-gray-400">ไม่มีรายการ</td></tr>
                ) : lines.map((line: any) => (
                  <tr key={line.id ?? line.lineNo}>
                    <td className="text-gray-500">{line.lineNo}</td>
                    <td>{dateShort(line.incurredDate)}</td>
                    <td>{line.description}</td>
                    <td className="text-gray-500">{categoryText(line.categoryLabelSnapshot)}</td>
                    <td className="text-right tabular-nums">{formatMoney(line.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={4}>รวมเป็นเงิน</td>
                  <td className="text-right tabular-nums">{formatMoney(sumLineAmounts(lines), currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}

export function MissingSavedSignatureModal({ companyId, onClose }: {
  companyId: string;
  onClose: () => void;
}) {
  return (
    <Modal open title="ยังไม่มีลายเซ็นที่พร้อมใช้งาน" size="sm" closeLabel="ไว้ภายหลัง" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          กรุณาบันทึกลายเซ็นในฟีเจอร์ลายเซ็นและรอให้ลายเซ็นมีสถานะพร้อมใช้งาน แล้วกลับมาลงนามอีกครั้ง
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>ไว้ภายหลัง</button>
          <Link href={`/companies/${companyId}/expenses/signatures`} className={btnClass}>ไปหน้าลายเซ็น</Link>
        </div>
      </div>
    </Modal>
  );
}

/**
 * A4: a scan counts as the signed record only after the attacher declares both signatures are on it for
 * THIS claim number. Without the declaration it is kept as an ordinary attachment that signs nothing.
 */
function SignedCopyDialog({ requestNo, fileName, onClose, onSend }: {
  requestNo: string;
  fileName: string;
  onClose: () => void;
  onSend: (declared: boolean) => void;
}) {
  const [declared, setDeclared] = useState(false);
  return (
    <Modal open title="แนบใบเบิกที่เซ็นแล้ว" size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <div className="space-y-4">
        <p className="break-words text-sm text-gray-600">{fileName}</p>
        <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={declared} onChange={e => setDeclared(e.target.checked)} />
          <span>สำเนานี้มีลายเซ็นผู้เบิกและผู้อนุมัติครบ และตรงกับใบเบิกเลขที่ {requestNo}</span>
        </label>
        <p className="text-xs text-gray-500">ถ้ายังเซ็นไม่ครบ แนบเป็นไฟล์แนบทั่วไปได้ ระบบจะเก็บไว้ในประวัติ แต่ยังไม่นับว่าลงนามแล้ว</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={ghostClass} onClick={() => onSend(false)}>แนบเป็นไฟล์แนบทั่วไป</button>
          <button type="button" className={btnClass} disabled={!declared} onClick={() => onSend(true)}>แนบสำเนาที่ลงนามครบ</button>
        </div>
      </div>
    </Modal>
  );
}

/** Full payment only (MVP). A modal in the hub queue; inline in the journey card, never a modal on mobile. */
export function PaymentForm({ companyId, request, onCancel, onDone }: { companyId: string; request: any; onCancel: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ paidAmount: String(request.outstandingAmount), paymentMethod: 'CASH', paidAt: todayCivilDate(), paymentReference: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validatePaymentForm({ ...form, outstandingAmount: String(request.outstandingAmount) });
    if (v) { setError(v); return; }
    setBusy(true); setError(null);
    try {
      await recordReimbursementPayment(companyId, request.id, { ...form, paidAt: new Date(form.paidAt).toISOString(), paymentReference: form.paymentReference || undefined });
      onDone();
      toast.success('บันทึกจ่ายเรียบร้อยแล้ว');
    } catch (e2) { setError(errorText(e2)); } finally { setBusy(false); }
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <p className="text-xs text-gray-500">จ่ายเต็มจำนวนคงค้าง {formatMoney(request.outstandingAmount, request.currency)}</p>
      <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">จำนวนเงิน *</label><input className={inputClass} type="number" step="0.01" required value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} /></div>
      <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">วิธีจ่าย</label>
        <ThemedSelect className={inputClass} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </ThemedSelect>
      </div>
      <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">วันที่จ่าย *</label><ThemedDate className={inputClass} required value={form.paidAt} onChange={e => setForm(f => ({ ...f, paidAt: e.target.value }))} /></div>
      <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">เลขอ้างอิง {(form.paymentMethod === 'BANK_TRANSFER' || form.paymentMethod === 'CHEQUE') && '*'}</label><input className={inputClass} value={form.paymentReference} onChange={e => setForm(f => ({ ...f, paymentReference: e.target.value }))} /></div>
      {error && <ErrorBanner message={error} />}
      <div className="flex gap-2 justify-end"><button type="button" className={ghostClass} onClick={onCancel}>ยกเลิก</button><button type="submit" className={btnClass} disabled={busy} aria-busy={Boolean(busy)}>{busy ? 'กำลังบันทึก...' : 'บันทึกจ่าย'}</button></div>
    </form>
  );
}

const attachmentPreviewMimeType = (fileName: string): 'application/pdf' | 'image/png' | 'image/jpeg' => (
  /\.pdf$/i.test(fileName) ? 'application/pdf' : /\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg'
);
type ReimbursementDocumentPreviewTarget =
  | { kind: 'claim-form'; reimbursementId: string; name: string }
  | { kind: 'attachment'; reimbursementId: string; attachmentId: string; fileName: string; mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' };

/**
 * ใบเบิกค่าใช้จ่าย (rendered server-side as SVG, saved as PDF from the viewer) and authenticated
 * attachments, behind one latest-request gate. `onError(null)` clears the host's banner.
 */
export function useClaimDocumentPreview(companyId: string, onError: (message: string | null) => void) {
  const [claimForm, setClaimForm] = useState<{ name: string; url: string; pages: string[] } | null>(null);
  const [claimFormSaving, setClaimFormSaving] = useState(false);
  const [claimFormError, setClaimFormError] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<DocumentPreviewSource | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ReimbursementDocumentPreviewTarget | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const claimFormSaveRequestRef = useRef(0);

  const releaseAttachmentPreviewUrl = useCallback(() => {
    const url = previewUrlRef.current;
    previewUrlRef.current = null;
    if (url) URL.revokeObjectURL(url);
  }, []);

  const closeDocumentPreview = useCallback(() => {
    previewRequestRef.current += 1;
    claimFormSaveRequestRef.current += 1;
    releaseAttachmentPreviewUrl();
    setClaimForm(null);
    setClaimFormError(null);
    setClaimFormSaving(false);
    setAttachmentPreview(null);
    setPreviewTarget(null);
    setPreviewLoadingKey(null);
  }, [releaseAttachmentPreviewUrl]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    claimFormSaveRequestRef.current += 1;
    releaseAttachmentPreviewUrl();
  }, [releaseAttachmentPreviewUrl]);

  const loadDocumentPreview = async (target: ReimbursementDocumentPreviewTarget) => {
    const requestId = ++previewRequestRef.current;
    claimFormSaveRequestRef.current += 1;
    const loadingKey = target.kind === 'claim-form' ? `claim-form:${target.reimbursementId}` : `attachment:${target.attachmentId}`;
    setPreviewLoadingKey(loadingKey);
    onError(null);
    try {
      if (target.kind === 'claim-form') {
        const nextPreview = await previewReimbursementClaimForm(companyId, target.reimbursementId);
        if (requestId !== previewRequestRef.current) return;
        releaseAttachmentPreviewUrl();
        setAttachmentPreview(null);
        setClaimFormError(null);
        setClaimFormSaving(false);
        const pages = nextPreview.pageSvgDataUrls?.length ? nextPreview.pageSvgDataUrls : [nextPreview.svgDataUrl];
        setClaimForm({ name: target.name, url: pages[0]!, pages });
      } else {
        const blob = await fetchAttachmentPreviewBlob(companyId, target.attachmentId, target.mimeType);
        if (requestId !== previewRequestRef.current) return;
        const url = URL.createObjectURL(blob);
        releaseAttachmentPreviewUrl();
        previewUrlRef.current = url;
        setClaimForm(null);
        setClaimFormError(null);
        setAttachmentPreview({ name: target.fileName, mimeType: blob.type, url });
      }
      setPreviewTarget(target);
    } catch (e) {
      if (requestId !== previewRequestRef.current) return;
      onError(errorText(e));
      throw e;
    } finally {
      if (requestId === previewRequestRef.current) {
        setPreviewLoadingKey((current) => current === loadingKey ? null : current);
      }
    }
  };

  const openClaimForm = async (claim: { id: string; requestNo?: string }) => {
    try {
      await loadDocumentPreview({ kind: 'claim-form', reimbursementId: claim.id, name: `ใบเบิกค่าใช้จ่าย ${claim.requestNo ?? ''}`.trim() });
    } catch {
      // The active request already reports its localized failure through onError.
    }
  };

  /** Fetch first so storage 404/MIME errors are visible before opening the document viewer. */
  const openAttachment = async (reimbursementId: string, attachmentId: string, fileName: string) => {
    try {
      await loadDocumentPreview({ kind: 'attachment', reimbursementId, attachmentId, fileName, mimeType: attachmentPreviewMimeType(fileName) });
    } catch {
      // The active request already reports its localized failure through onError.
    }
  };

  const downloadClaimForm = async () => {
    if (!claimForm) return;
    const requestId = ++claimFormSaveRequestRef.current;
    const target = claimForm;
    setClaimFormSaving(true);
    setClaimFormError(null);
    try {
      await downloadDocumentAsPdf(target.pages, target.name, { vector: true });
    } catch (e) {
      if (requestId === claimFormSaveRequestRef.current) setClaimFormError(errorText(e));
    } finally {
      if (requestId === claimFormSaveRequestRef.current) setClaimFormSaving(false);
    }
  };

  // Siblings of the host's claim view, so closing a preview never closes the claim behind it.
  const previewModals = (
    <>
      {claimForm && <DocumentPreviewModal
        source={{ name: claimForm.name, mimeType: 'image/svg+xml', url: claimForm.url }}
        imagePageUrls={claimForm.pages}
        printSurface
        hideOpenNewTab
        closeLabel="ปิด"
        loadingLabel="กำลังเปิดเอกสาร..."
        errorLabel="แสดงเอกสารนี้ไม่สำเร็จ กรุณาลองสร้างตัวอย่างใหม่"
        retryLabel="ลองอีกครั้ง"
        openNewTabLabel="เปิดในแท็บใหม่"
        onClose={closeDocumentPreview}
        onRetry={previewTarget?.kind === 'claim-form' ? () => loadDocumentPreview(previewTarget) : undefined}
        footer={(
          <>
            {claimFormError && <p className="mr-auto text-xs font-semibold text-error-700">{claimFormError}</p>}
            <button
              className={successBtn}
              style={successBtnStyle}
              disabled={claimFormSaving} aria-busy={Boolean(claimFormSaving)}
              onClick={() => void downloadClaimForm()}
            >
              {claimFormSaving ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด PDF'}
            </button>
          </>
        )}
      />}
      {attachmentPreview && <DocumentPreviewModal
        source={attachmentPreview}
        closeLabel="ปิด"
        loadingLabel="กำลังเปิดเอกสาร..."
        errorLabel="แสดงเอกสารนี้ไม่สำเร็จ กรุณาลองใหม่"
        retryLabel="ลองอีกครั้ง"
        openNewTabLabel="เปิดในแท็บใหม่"
        onClose={closeDocumentPreview}
        onRetry={previewTarget?.kind === 'attachment' ? () => loadDocumentPreview(previewTarget) : undefined}
      />}
    </>
  );

  return { previewLoadingKey, closeDocumentPreview, openClaimForm, openAttachment, previewModals };
}

/** Who is paid back, why, and how much — the head of every claim view. */
export function ClaimSummaryCard({ detail }: { detail: any }) {
  return (
    <MangmeeCard className="p-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-500">ผู้เบิก / ผู้รับเงินคืน</div>
          <div className="mt-1 font-semibold text-gray-900">{detail.requesterDisplayNameSnapshot ?? '—'}</div>
          {detail.createdByName && <div className="mt-2 text-xs text-gray-500">ผู้จัดทำ: {detail.createdByName}</div>}
          <div className="mt-3 text-xs font-semibold text-gray-500">เหตุผล</div>
          <div className="mt-1 text-sm text-gray-700">{detail.reason ?? '—'}</div>
        </div>
        <div className="sm:text-right">
          <div className="text-xs font-semibold text-gray-500">ยอดรวม</div>
          <div className="mt-1 text-[28px] font-extrabold tabular-nums text-gray-900">{formatMoney(detail.amount, detail.currency)}</div>
          <div className="mt-1 text-sm text-gray-500">คงค้าง {formatMoney(detail.outstandingAmount, detail.currency)}</div>
        </div>
      </div>
    </MangmeeCard>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div><dt className="text-xs font-semibold text-gray-500">{k}</dt><dd className="mt-1 text-sm text-gray-900">{v ?? '—'}</dd></div>;
}

/**
 * Timeline, facts, lines with their evidence, signatures and signed copies, approval steps and
 * payments. Every write control repeats its own actor/permission/state check; the server re-checks.
 */
export function ClaimDetailSections({ detail, userId, permissions, busy, onOpenAttachment, onLineReceipt, onSign, onUploadSignedCopy, onRequestVoidPayment }: {
  detail: any;
  userId: string;
  permissions: readonly string[];
  busy: boolean;
  onOpenAttachment: (attachmentId: string, fileName: string) => void;
  onLineReceipt: (lineNo: number, file: File | null) => void;
  /** Every block this viewer may sign, from one tap (spec §9). */
  onSign: (roles: ClaimSignatureRole[]) => void;
  /** `confirmedRequestNo` = the A4 declaration was made; without it the scan is an ordinary attachment. */
  onUploadSignedCopy: (file: File, confirmedRequestNo?: string) => void;
  onRequestVoidPayment: (payment: any) => void;
}) {
  const [pendingCopy, setPendingCopy] = useState<File | null>(null);
  const lines: any[] = detail.lines ?? [];
  const timeline = buildClaimTimeline(detail);
  const { canEditDraft } = reimbursementOwnActions(detail, userId, permissions);
  const signatures: any[] = detail.signatures ?? [];
  const signedCopies: any[] = detail.signedCopies ?? [];
  const slots = claimSignatureSlots(detail);
  const signAction = claimSignAction(detail, userId);
  // A4: a declared paper scan signs the ผู้เบิก/ผู้อนุมัติ blocks. Newest first, so this is the copy that counts.
  const paperSigned = detail.documentSignedVia === 'PAPER' || detail.documentSignedVia === 'BOTH';
  const paperCopy = signedCopies.find((copy: any) => copy.acknowledgedAt);
  const canAttachSignedCopy = canUploadSignedCopy(detail, userId, permissions);
  return (
    <>
      {/* Where the claim is on its journey — the question the status chip alone never answered. */}
      <MangmeeCard className="p-4">
        <h4 className="mb-2 text-sm font-bold text-gray-900">เส้นทางของใบเบิก</h4>
        <ol className="space-y-2" data-testid="reimbursement-timeline">
          {timeline.map(step => (
            <li key={step.key} className="flex items-start gap-2 text-sm">
              <span aria-hidden className={cx('shrink-0', step.state === 'done' ? 'text-brand-600' : step.state === 'current' ? 'text-amber-600' : 'text-gray-300')}>
                {step.state === 'done' ? '✓' : step.state === 'current' ? '●' : '○'}
              </span>
              <span className={cx('min-w-0 flex-1', step.state === 'current' ? 'font-semibold text-gray-900' : step.state === 'done' ? 'text-gray-700' : 'text-gray-400')}>
                {step.label}
              </span>
              {step.date && <span className="shrink-0 text-xs tabular-nums text-gray-400">{dateShort(step.date)}</span>}
            </li>
          ))}
        </ol>
      </MangmeeCard>

      <MangmeeCard className="p-4">
        <h4 className="text-sm font-bold text-gray-900">ข้อมูลคำขอ</h4>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Row k="หมวดหมู่" v={categoryText(detail.categoryLabelSnapshot)} />
          <Row k="สถานะ" v={<StatusBadge status={detail.status} />} />
          <Row k="ตรวจสอบการเงิน" v={FINANCE_REVIEW_LABELS[detail.financeReviewStatus]} />
          {detail.financeReviewedByName && <Row k="ผู้ตรวจการเงิน" v={detail.financeReviewedByName} />}
          <Row k="การจ่าย" v={<PaymentBadge status={detail.paymentStatus} />} />
          <Row k="ใบเสร็จ" v={RECEIPT_REQUIREMENT_LABELS[detail.receiptRequirementStatus]} />
          <Row k="เหตุผลที่ไม่มีใบเสร็จ" v={detail.missingReceiptReason} />
          <Row k="ตรวจรายการซ้ำ" v={DUPLICATE_STATUS_LABELS[detail.duplicateStatus]} />
        </dl>
      </MangmeeCard>

      <MangmeeCard className="p-4">
        <h4 className="mb-2 text-sm font-bold text-gray-900">รายการเบิก ({lines.length})</h4>
        <div className="overflow-x-auto">
          <table className="mangmee-table">
            <thead>
              <tr>
                <th>#</th><th>วันที่</th><th>รายการ</th><th>วัตถุประสงค์</th><th>หมวด</th>
                <th className="text-right">จำนวนเงิน</th><th>ใบเสร็จ</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? <tr><td colSpan={7} className="text-center text-gray-400">ไม่มีรายการ</td></tr> : lines.map((l: any) => (
                <tr key={l.id ?? l.lineNo}>
                  <td className="text-gray-500">{l.lineNo}</td>
                  <td>{dateShort(l.incurredDate)}</td>
                  <td>{l.description}{l.sourceExpenseSnapshot && <ReimbursementSourceFacts source={l.sourceExpenseSnapshot} />}</td>
                  <td className="text-gray-500">{l.purpose ?? '—'}</td>
                  <td className="text-gray-500">{categoryText(l.categoryLabelSnapshot)}</td>
                  <td className="text-right tabular-nums">{formatMoney(l.amount)}</td>
                  <td className="text-xs">
                    {l.sourceExpenseSnapshot ? l.sourceExpenseSnapshot.attachments.map((file: { id: string; fileName: string }) => (
                      <button key={file.id} className="block min-h-11 max-w-48 truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(file.id, file.fileName)}>📎 {file.fileName}</button>
                    )) : l.attachmentId ? (
                      <button className="min-h-11 max-w-40 truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(l.attachmentId, l.attachmentFileName ?? 'receipt.jpg')}>
                        📎 {l.attachmentFileName ?? 'เปิดไฟล์แนบ'}
                      </button>
                    ) : <div className="text-gray-600">{l.linkedExpenseId ? '🔗 ค่าใช้จ่ายที่บันทึกไว้' : '—'}</div>}
                    {canEditDraft && !l.sourceExpenseSnapshot && (
                      <div className="mt-1 space-y-1">
                        <ThemedFile file={null} accept={RECEIPT_UPLOAD_ACCEPT} disabled={busy} loading={Boolean(busy)} onChange={file => { if (file) onLineReceipt(l.lineNo, file); }} />
                        <p className="leading-5 text-gray-400">PDF, JPG/JPEG, PNG, HEIC/HEIF หรือ GIF</p>
                        {l.attachmentId && <button className="min-h-11 text-red-600 hover:underline" disabled={busy} aria-busy={Boolean(busy)} onClick={() => onLineReceipt(l.lineNo, null)}>นำไฟล์ออก</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-medium">
                <td colSpan={5}>รวมเป็นเงิน</td>
                <td className="text-right tabular-nums">{formatMoney(detail.amount, detail.currency)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </MangmeeCard>

      {/* Signatures live on the document, so they only exist once the claim has one. */}
      {detail.requestNo && detail.status !== 'DRAFT' && (
        <div id="reimbursement-signatures" className="scroll-mt-24">
          <MangmeeCard className="p-4">
            <h4 className="mb-2 text-sm font-bold text-gray-900">ลายเซ็นในใบเบิก</h4>
            <div className={cx('grid grid-cols-2 gap-2', slots.length > 2 && 'sm:grid-cols-4')}>
              {slots.map(role => {
                const signed = signatures.find((s: any) => s.role === role);
                return (
                  // min-w-0 + break-words: a long value must wrap inside its own cell — on a
                  // narrow grid an unbroken string overflowed the card and sat on top of the
                  // neighbouring slot, swallowing its taps.
                  <div key={role} className="min-w-0 rounded-xl border border-gray-200 p-3 text-xs">
                    <div className="font-semibold text-gray-700">{CLAIM_SIGNATURE_ROLE_LABELS[role]}</div>
                    <div className="mt-2">
                      {signed ? (
                        <>
                          <MangmeeBadge tone="brand">ลงนามแล้ว</MangmeeBadge>
                          {/* Never a cuid: a missing name renders a dash, not the user id. */}
                          <div className="mt-2 break-words text-gray-600">{signed.signedByName ?? '—'}</div>
                          <div className="text-gray-400">{dateShort(signed.signedAt)}</div>
                        </>
                      ) : paperSigned && (role === 'REQUESTER' || role === 'APPROVER') ? (
                        <>
                          <MangmeeBadge tone="brand">ลงนามบนกระดาษ</MangmeeBadge>
                          {paperCopy && (
                            <button type="button" className="mt-1 block min-h-11 text-brand-700 underline decoration-1 underline-offset-4 hover:decoration-2"
                              onClick={() => onOpenAttachment(paperCopy.attachmentId, paperCopy.fileName)}>
                              ดูสำเนา
                            </button>
                          )}
                        </>
                      ) : <MangmeeBadge tone="slate">ยังไม่ลงนาม</MangmeeBadge>}
                    </div>
                  </div>
                );
              })}
            </div>
            {slots.length === 2 && claimSelfApproved(detail) && (
              <p className="mt-3 text-xs text-gray-600">ผู้เบิกและผู้อนุมัติเป็นบุคคลเดียวกัน อนุมัติรายการของตนเองตามนโยบายบริษัท</p>
            )}
            {/* One tap signs every block this viewer really acted on; the server re-checks each role. */}
            {signAction && (
              <button type="button" className={cx(ghostClass, 'mt-3 w-full sm:w-auto')} disabled={busy} aria-busy={Boolean(busy)}
                onClick={() => onSign(signAction.roles)}>
                {signAction.label}
              </button>
            )}
          </MangmeeCard>
        </div>
      )}

      {detail.requestNo && detail.status !== 'DRAFT' && (
        <div id="reimbursement-signed-copies" className="scroll-mt-24">
          <MangmeeCard className="p-4">
            <h4 className="mb-2 text-sm font-bold text-gray-900">ใบเบิกที่เซ็นแล้ว ({signedCopies.length})</h4>
            {signedCopies.length === 0
              ? <p className="text-xs text-gray-400">ยังไม่มีไฟล์ที่แนบกลับ</p>
              : (
                <ul className="space-y-2 text-xs">
                  {/* Attaching again never deletes: the newest declared scan counts, older ones stay viewable. */}
                  {signedCopies.map((copy: any) => (
                    <li key={copy.attachmentId} className="min-w-0 rounded-xl border border-gray-200 px-3 py-2">
                      <button className="block min-h-11 max-w-full truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(copy.attachmentId, copy.fileName)}>📄 {copy.fileName}</button>
                      <div className="break-words text-gray-500">
                        {copy.acknowledgedAt ? paperSignedLine(copy) : `ไฟล์แนบทั่วไป · แนบเมื่อ ${dateShort(copy.uploadedAt)}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            {canAttachSignedCopy && (
              <div className="mt-3 block text-xs font-semibold text-gray-600">
                แนบใบเบิกที่เซ็นแล้ว (PDF/JPG/PNG)
                <ThemedFile className="mt-1.5" file={null} accept={ATTACHMENT_UPLOAD_ACCEPT} disabled={busy} loading={Boolean(busy)} onChange={file => { if (file) setPendingCopy(file); }} />
              </div>
            )}
          </MangmeeCard>
          {pendingCopy && (
            <SignedCopyDialog
              requestNo={detail.requestNo}
              fileName={pendingCopy.name}
              onClose={() => setPendingCopy(null)}
              onSend={(declared) => { onUploadSignedCopy(pendingCopy, declared ? detail.requestNo : undefined); setPendingCopy(null); }}
            />
          )}
        </div>
      )}

      {detail.approvalSteps?.length > 0 && (
        <MangmeeCard className="p-4">
          <h4 className="mb-2 text-sm font-bold text-gray-900">ขั้นตอนอนุมัติ</h4>
          <ul className="space-y-2">
            {detail.approvalSteps.map((s: any) => (
              <li key={s.id} className="rounded-xl border border-gray-200 px-3 py-2.5 text-xs text-gray-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-gray-700">ขั้นที่ {s.sequenceNo}</span>
                  <MangmeeBadge tone={s.status === 'APPROVED' ? 'brand' : s.status === 'REJECTED' ? 'danger' : 'slate'}>
                    {APPROVAL_STEP_STATUS_LABELS[s.status] ?? '—'}
                  </MangmeeBadge>
                </div>
                <div className="mt-1">{s.decidedByName ? `โดย ${s.decidedByName}` : s.approverName ? `ผู้อนุมัติ: ${s.approverName}` : '—'}</div>
                {s.comment && <div className="mt-1 text-gray-500">{s.comment}</div>}
                {s.rejectionReason && <div className="mt-1 text-error-700">{s.rejectionReason}</div>}
              </li>
            ))}
          </ul>
        </MangmeeCard>
      )}
      {detail.payments?.length > 0 && (
        <MangmeeCard className="p-4">
          <h4 className="mb-2 text-sm font-bold text-gray-900">การจ่ายเงิน</h4>
          <ul className="space-y-2">
            {detail.payments.map((p: any) => (
              <li key={p.id} className="rounded-xl border border-gray-200 px-3 py-2.5 text-xs text-gray-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-gray-700">{p.paymentNo}</span>
                  <span className="font-semibold tabular-nums text-gray-900">{formatMoney(p.paidAmount, p.currency)}</span>
                </div>
                <div className="mt-1">{PAYMENT_METHOD_LABELS[p.paymentMethod] ?? '—'} · {p.status === 'RECORDED' ? 'บันทึกแล้ว' : PAYMENT_STATUS_LABELS[p.status] ?? 'สถานะการจ่าย'}</div>
                {p.paidByName && <div className="mt-1 text-gray-500">จ่ายโดย {p.paidByName}</div>}
                {p.status === 'VOIDED' && p.voidReason && <div className="mt-1 text-error-700">เหตุผลที่ยกเลิก: {p.voidReason}</div>}
                {canVoidRecordedPayment(p, permissions) && (
                  <button type="button" className="mt-2 min-h-11 text-error-700 underline underline-offset-4 disabled:opacity-50" disabled={busy} aria-busy={Boolean(busy)} onClick={() => onRequestVoidPayment(p)}>
                    ยกเลิกการจ่าย
                  </button>
                )}
              </li>
            ))}
          </ul>
        </MangmeeCard>
      )}
    </>
  );
}
