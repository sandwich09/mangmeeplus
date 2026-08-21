'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { downloadDocumentAsPdf } from '@/common/files/download-document-pdf';
import { EmptyState } from '@/common/components/state/EmptyState';
import { LoadingState } from '@/common/components/state/LoadingState';
import { REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import {
  ATTACHMENT_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_ACCEPT,
  assertAllowedUploadFile,
} from '@/common/files/upload-file.logic';
import {
  listReimbursements, submitReimbursement, cancelReimbursement,
  reopenReimbursement, getReimbursement,
  setLineReceipt, previewReimbursementClaimForm,
  listApprovalQueue, approveReimbursement, rejectReimbursement,
  listFinanceQueue, financeReviewReimbursement, recordReimbursementPayment,
  getReimbursementPolicy, updateReimbursementPolicy,
  uploadClaimSignature, signReimbursementClaimForm, uploadSignedClaimFormCopy, fetchAttachmentPreviewBlob,
} from './reimbursements.api';
import {
  REQUEST_STATUS_LABELS, REQUEST_STATUS_TONES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
  FINANCE_REVIEW_LABELS, PAYMENT_METHOD_LABELS, RECEIPT_REQUIREMENT_LABELS, DUPLICATE_STATUS_LABELS,
  APPROVAL_STEP_STATUS_LABELS,
  CLAIM_SIGNATURE_ROLES, CLAIM_SIGNATURE_ROLE_LABELS, canUploadSignedCopy, eligibleSignatureRoles,
  reimbursementOwnActions, type ClaimSignatureRole,
} from './reimbursements.model';
// The background remover already ships in the expenses feature (signature assets);
// reimbursements already reuses that feature's upload helper, so reuse it too.
import { removeLightBackground } from '../expenses/expenses.model';
import {
  baht0, ICON, KPI, StatCard, ErrorBanner, InfoBanner,
  inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
} from '../expenses/ExpensesUi';
import {
  validatePaymentForm, sumLineAmounts, summariseQueue, matchesSearch, pageBounds,
  formatMoney, parseHubTab, visibleHubTabs, errorText, isStaleApprovalError, diffApprovalFields,
  type ApprovalFieldDiff, type HubTab,
} from './reimbursements.logic';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

/** Every banner in this feature goes through here, so API error codes never reach the user raw. */
function err(e: unknown) { return errorText(e); }

const HUB_TAB_LABELS: Record<HubTab, string> = {
  mine: 'รายการที่เกี่ยวข้อง', approvals: 'คิวอนุมัติ', finance: 'คิวการเงิน', policy: 'ตั้งค่านโยบาย',
};
const HUB_TAB_DESCRIPTIONS: Record<HubTab, string> = {
  mine: 'ติดตามคำขอของคุณและเอกสารที่คุณเป็นผู้อนุมัติ ผู้ตรวจ ผู้จ่าย หรือผู้ลงนาม',
  approvals: 'ตรวจคำขอที่รอคุณอนุมัติ ดูรายการและใบเสร็จก่อนตัดสินใจ',
  finance: 'ตรวจสอบคำขอที่อนุมัติแล้ว และบันทึกการจ่ายเงิน',
  policy: 'กำหนดเกณฑ์การอนุมัติ ใบเสร็จ และ SLA ของการเบิกจ่ายทั้งบริษัท',
};
const APPROVER_MODE_LABELS: Record<string, string> = {
  MANAGER_ROLE: 'ตามบทบาทผู้จัดการ',
  OWNER_ROLE: 'เจ้าของกิจการ',
  CUSTOM_ROLE: 'บทบาทที่กำหนด',
  CUSTOM_USER: 'ผู้ใช้ที่กำหนด',
};
const shortDate = (iso?: string) => (iso ? String(iso).slice(0, 10) : '—');
const attachmentPreviewMimeType = (fileName: string): 'application/pdf' | 'image/png' | 'image/jpeg' => (
  /\.pdf$/i.test(fileName) ? 'application/pdf' : /\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg'
);
type ReimbursementDocumentPreviewTarget =
  | { kind: 'claim-form'; reimbursementId: string; name: string }
  | { kind: 'attachment'; reimbursementId: string; attachmentId: string; fileName: string; mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' };

/**
 * FINANCE_REVIEW + อนุมัติจ่าย means the decision is already durable and only the expense
 * projections are missing (the saga threw between its two phases). The same finance-decision
 * endpoint resumes it, so the button offers to continue rather than to approve twice.
 */
const financeActionLabel = (row: { financeReviewStatus?: string }) =>
  (row.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการต่อ' : 'อนุมัติจ่าย');

function StatusBadge({ status }: { status: string }) {
  return <MangmeeBadge tone={REQUEST_STATUS_TONES[status] ?? 'slate'}>{REQUEST_STATUS_LABELS[status] ?? status}</MangmeeBadge>;
}
function PaymentBadge({ status }: { status: string }) {
  return <MangmeeBadge tone={PAYMENT_STATUS_TONES[status] ?? 'slate'}>{PAYMENT_STATUS_LABELS[status] ?? status}</MangmeeBadge>;
}
function RejectDialog({ requestNo, busy, onClose, onConfirm }: {
  requestNo?: string;
  busy?: boolean;
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
        <textarea ref={reasonRef} className={cx(inputClass, 'min-h-24 resize-y')} value={reason}
          onChange={e => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH}
          placeholder="เช่น ยอดไม่ตรงกับใบเสร็จ" />
        <div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/500</div>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="button" className={dangerClass} disabled={busy || !trimmed}
            onClick={() => onConfirm(trimmed)}>ปฏิเสธคำขอ</button>
        </div>
      </div>
    </Modal>
  );
}

function StaleApprovalDialog({ requestNo, diff, lines, currency, busy, error, onClose, onConfirm }: {
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
          <button type="button" className={successBtn} style={successBtnStyle} disabled={busy} onClick={onConfirm}>
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
                <tr key={row.key} className={row.changed ? 'bg-warning-50' : 'text-gray-500'}>
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
                    <td>{shortDate(line.incurredDate)}</td>
                    <td>{line.description}</td>
                    <td className="text-gray-500">{line.categoryLabelSnapshot ?? line.categoryKey}</td>
                    <td className="text-right tabular-nums">{formatMoney(line.amount)} {currency}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={4}>รวมเป็นเงิน</td>
                  <td className="text-right tabular-nums">{formatMoney(sumLineAmounts(lines))} {currency}</td>
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

function TablePager({ from, to, total, page, totalPages, onPage }: {
  from: number;
  to: number;
  total: number;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-4 text-sm text-gray-500">
      <div className="tabular-nums">แสดง {from}-{to} จาก {total} รายการ</div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
            disabled={page <= 1} onClick={() => onPage(page - 1)}>ก่อนหน้า</button>
          <span className="tabular-nums rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">{page} / {totalPages}</span>
          <button type="button" className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
            disabled={page >= totalPages} onClick={() => onPage(page + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}

export function ReimbursementsHubPage({ companyId, userId, permissions, roles }: {
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roles: readonly string[];
}) {
  const toast = useToast();
  const searchParams = useSearchParams();
  const tabs = useMemo(() => visibleHubTabs(permissions, roles), [permissions, roles]);
  // Initial tab only: deep links (LINE approvals card, notifications) land on the right queue,
  // and later tab clicks are not fought by the URL.
  const [tab, setTab] = useState<HubTab>(() => parseHubTab(searchParams.get('tab'), tabs));
  // ?focus=<requestId> from a notification/LINE deep link: opens that claim's drawer.
  const focusId = searchParams.get('focus') ?? undefined;
  // The drawer lives at hub level so every queue can open the same claim detail
  // with the actions its own audience is allowed to take.
  const [detail, setDetail] = useState<any | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [payFor, setPayFor] = useState<any | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // ใบเบิกค่าใช้จ่าย: rendered server-side as SVG, shown in the viewer, saved as PDF from there.
  const [claimForm, setClaimForm] = useState<{ name: string; url: string } | null>(null);
  const [claimFormSaving, setClaimFormSaving] = useState(false);
  const [claimFormError, setClaimFormError] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<DocumentPreviewSource | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ReimbursementDocumentPreviewTarget | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const claimFormSaveRequestRef = useRef(0);
  // Signing dialog for one signature block of the printed form.
  const [signFor, setSignFor] = useState<ClaimSignatureRole | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [staleReview, setStaleReview] = useState<{ before: any; detail: any } | null>(null);

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

  useEffect(() => {
    closeDocumentPreview();
  }, [companyId, detail?.id, closeDocumentPreview]);

  const openDetail = useCallback(async (id: string) => {
    closeDocumentPreview();
    setDrawerBusy(true); setDrawerError(null);
    try { setDetail(await getReimbursement(companyId, id)); }
    catch (e) { setDrawerError(err(e)); }
    finally { setDrawerBusy(false); }
  }, [closeDocumentPreview, companyId]);

  useEffect(() => { if (focusId) void openDetail(focusId); }, [focusId, openDetail]);

  const loadDocumentPreview = async (target: ReimbursementDocumentPreviewTarget) => {
    const requestId = ++previewRequestRef.current;
    claimFormSaveRequestRef.current += 1;
    const loadingKey = target.kind === 'claim-form' ? `claim-form:${target.reimbursementId}` : `attachment:${target.attachmentId}`;
    setPreviewLoadingKey(loadingKey);
    setDrawerError(null);
    try {
      if (target.kind === 'claim-form') {
        const nextPreview = await previewReimbursementClaimForm(companyId, target.reimbursementId);
        if (requestId !== previewRequestRef.current) return;
        releaseAttachmentPreviewUrl();
        setAttachmentPreview(null);
        setClaimFormError(null);
        setClaimFormSaving(false);
        setClaimForm({ name: target.name, url: nextPreview.svgDataUrl });
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
      setDrawerError(err(e));
      throw e;
    } finally {
      if (requestId === previewRequestRef.current) {
        setPreviewLoadingKey((current) => current === loadingKey ? null : current);
      }
    }
  };

  const openClaimForm = async () => {
    if (!detail) return;
    try {
      await loadDocumentPreview({
        kind: 'claim-form',
        reimbursementId: detail.id,
        name: `ใบเบิกค่าใช้จ่าย ${detail.requestNo ?? ''}`.trim(),
      });
    } catch {
      // The active request already reports its localized failure in the drawer.
    }
  };

  /** Fetch first so storage 404/MIME errors are visible before opening the document viewer. */
  const openAttachment = async (attachmentId: string, fileName: string) => {
    if (!detail) return;
    try {
      await loadDocumentPreview({
        kind: 'attachment',
        reimbursementId: detail.id,
        attachmentId,
        fileName,
        mimeType: attachmentPreviewMimeType(fileName),
      });
    } catch {
      // The active request already reports its localized failure in the drawer.
    }
  };

  const downloadClaimForm = async () => {
    if (!claimForm) return;
    const requestId = ++claimFormSaveRequestRef.current;
    const target = claimForm;
    setClaimFormSaving(true);
    setClaimFormError(null);
    try {
      await downloadDocumentAsPdf(target.url, target.name, { vector: true });
    } catch (e) {
      if (requestId === claimFormSaveRequestRef.current) setClaimFormError(err(e));
    } finally {
      if (requestId === claimFormSaveRequestRef.current) setClaimFormSaving(false);
    }
  };

  /**
   * Runs a drawer action, then refreshes both the drawer and the queue behind it —
   * on failure too: a two-phase action (finance อนุมัติจ่าย) makes its decision durable
   * before projecting, so a thrown error still leaves the claim changed. Refreshing only
   * on success is what left the drawer showing a pre-decision claim (BUG-7).
   */
  const drawerAction = async (fn: () => Promise<unknown>, successMessage?: string) => {
    if (!detail) return;
    setDrawerBusy(true); setDrawerError(null);
    try { await fn(); if (successMessage) toast.success(successMessage); }
    catch (e) { setDrawerError(err(e)); }
    finally {
      try { setDetail(await getReimbursement(companyId, detail.id)); }
      catch { /* keep the claim on screen — the action's own error is the one to show */ }
      setRefreshKey(k => k + 1);
      setDrawerBusy(false);
    }
  };

  const approveFromDrawer = async () => {
    if (!detail) return;
    setDrawerBusy(true); setDrawerError(null);
    try {
      await approveReimbursement(companyId, detail.id, undefined, detail.approvalSnapshotHash);
      setDetail(await getReimbursement(companyId, detail.id));
      setRefreshKey(k => k + 1);
      toast.success('อนุมัติคำขอเรียบร้อยแล้ว');
    } catch (e) {
      if (isStaleApprovalError(e)) {
        try {
          const fresh = await getReimbursement(companyId, detail.id);
          setStaleReview({ before: detail, detail: fresh });
        } catch (e2) { setDrawerError(err(e2)); }
      } else { setDrawerError(err(e)); }
    } finally { setDrawerBusy(false); }
  };

  // Reachable only if the workspace nav let a member in on `reimbursement.read`
  // alone; every queue below would answer 403, so say so instead of rendering one.
  if (tabs.length === 0) {
    return (
      <MangmeePage eyebrow="การเบิกจ่าย" title="การเบิกจ่ายและอนุมัติ" description="จัดการคำขอเบิกค่าใช้จ่ายและการอนุมัติ">
        <MangmeeCard className="p-6">
          <EmptyState title="ไม่มีสิทธิ์เข้าถึง" description="บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าการเบิกจ่าย" />
        </MangmeeCard>
      </MangmeePage>
    );
  }

  const queueProps = { companyId, refreshKey, onOpenDetail: openDetail };
  return (
    <MangmeePage
      eyebrow="การเบิกจ่าย"
      title="การเบิกจ่ายและอนุมัติ"
      description={HUB_TAB_DESCRIPTIONS[tab]}
      actions={(
        <div className="mangmee-segmented max-w-full overflow-x-auto">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={cx('mangmee-tab', tab === t && 'mangmee-tab-active')}>
              {HUB_TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    >
      {tab === 'mine' && <MyRequests
        {...queueProps}
        userId={userId}
        permissions={permissions}
        canCreate={permissions.includes('reimbursement.create')}
      />}
      {tab === 'approvals' && <ApprovalQueue {...queueProps} />}
      {tab === 'finance' && <FinanceQueue {...queueProps} onRecordPayment={setPayFor} />}
      {tab === 'policy' && <PolicySettings companyId={companyId} />}

      {detail && <DetailDrawer
        detail={detail}
        context={tab}
        userId={userId}
        permissions={permissions}
        busy={drawerBusy || previewLoadingKey !== null}
        error={drawerError}
        onClose={() => { closeDocumentPreview(); setDetail(null); setDrawerError(null); }}
        onPrintClaimForm={openClaimForm}
        onSign={setSignFor}
        onUploadSignedCopy={(file) => drawerAction(() => uploadSignedClaimFormCopy(companyId, detail.id, file), 'แนบสำเนาใบเบิกที่ลงนามเรียบร้อยแล้ว')}
        onOpenAttachment={openAttachment}
        onLineReceipt={(lineNo, file) => drawerAction(() => setLineReceipt(companyId, detail.id, detail.lines ?? [], lineNo, file), 'แนบใบเสร็จเรียบร้อยแล้ว')}
        onSubmit={() => drawerAction(() => submitReimbursement(companyId, detail.id), 'ส่งขออนุมัติเรียบร้อยแล้ว')}
        onCancel={() => drawerAction(() => cancelReimbursement(companyId, detail.id, 'ยกเลิกโดยผู้ขอ'), 'ยกเลิกคำขอเรียบร้อยแล้ว')}
        onReopen={() => drawerAction(() => reopenReimbursement(companyId, detail.id), 'เปิดคำขอกลับเป็นร่างแล้ว แก้ไขและส่งอนุมัติได้อีกครั้ง')}
        onApprove={approveFromDrawer}
        onRequestReject={() => setRejecting(true)}
        onFinanceApprove={() => drawerAction(() => financeReviewReimbursement(companyId, detail.id, {
          decision: 'APPROVED_FOR_PAYMENT',
          resolveDuplicate: detail.duplicateStatus === 'POSSIBLE_DUPLICATE',
          duplicateResolutionReason: detail.duplicateStatus === 'POSSIBLE_DUPLICATE' ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined,
        }), detail.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว')}
        onRecordPayment={() => setPayFor(detail)}
      />}
      {/* Sibling of the drawer so closing the preview does not close the claim behind it. */}
      {claimForm && <DocumentPreviewModal
        source={{ name: claimForm.name, mimeType: 'image/svg+xml', url: claimForm.url }}
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
              disabled={claimFormSaving}
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
      {/* Sibling of the drawer, like the print preview: closing the dialog keeps the claim open. */}
      {signFor && detail && <SignatureModal
        companyId={companyId}
        requestId={detail.id}
        role={signFor}
        ackHash={detail.claimSignatureAckHash}
        onClose={() => setSignFor(null)}
        onDone={async () => {
          setSignFor(null);
          setDetail(await getReimbursement(companyId, detail.id));
        }}
      />}
      {payFor && <PaymentModal
        companyId={companyId}
        request={payFor}
        onClose={() => setPayFor(null)}
        onDone={async () => {
          setPayFor(null);
          setRefreshKey(k => k + 1);
          if (detail) setDetail(await getReimbursement(companyId, detail.id));
        }}
      />}
      {rejecting && detail && <RejectDialog
        requestNo={detail.requestNo}
        busy={drawerBusy}
        onClose={() => setRejecting(false)}
        onConfirm={async reason => {
          await drawerAction(() => rejectReimbursement(companyId, detail.id, reason), 'ปฏิเสธคำขอเรียบร้อยแล้ว');
          setRejecting(false);
        }}
      />}
      {staleReview && <StaleApprovalDialog
        requestNo={staleReview.detail.requestNo ?? staleReview.before.requestNo}
        diff={diffApprovalFields(
          {
            reason: staleReview.before.reason,
            amount: formatMoney(staleReview.before.amount),
            currency: staleReview.before.currency,
            categoryLabel: staleReview.before.categoryLabelSnapshot ?? staleReview.before.categoryKey,
            lineCount: (staleReview.before.lines ?? []).length,
          },
          {
            reason: staleReview.detail.reason,
            amount: formatMoney(staleReview.detail.amount),
            currency: staleReview.detail.currency,
            categoryLabel: staleReview.detail.categoryLabelSnapshot ?? staleReview.detail.categoryKey,
            lineCount: (staleReview.detail.lines ?? []).length,
          },
        )}
        lines={staleReview.detail.lines ?? []}
        currency={staleReview.detail.currency}
        busy={drawerBusy}
        error={drawerError}
        onClose={() => setStaleReview(null)}
        onConfirm={async () => {
          const review = staleReview;
          if (!review) return;
          setDrawerBusy(true); setDrawerError(null);
          try {
            await approveReimbursement(companyId, review.detail.id, undefined, review.detail.approvalSnapshotHash);
            setStaleReview(null);
            setDetail(review.detail);
            setRefreshKey(k => k + 1);
            toast.success('อนุมัติคำขอเรียบร้อยแล้ว');
          } catch (e) { setDrawerError(err(e)); }
          finally { setDrawerBusy(false); }
        }}
      />}
    </MangmeePage>
  );
}

type QueueProps = { companyId: string; refreshKey: number; onOpenDetail: (id: string) => void };

// ── My Requests ───────────────────────────────────────────────────────────────
function MyRequests({ companyId, refreshKey, onOpenDetail, userId, permissions, canCreate }: QueueProps & {
  userId: string;
  permissions: readonly string[];
  canCreate: boolean;
}) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'pending' | 'approved' | 'paid'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const scope = permissions.includes('reimbursement.read_related') ? 'related' : 'own';
      const r = await listReimbursements(companyId, { scope });
      setData(r.items ?? []);
    }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, permissions]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };

  const summary = useMemo(() => summariseQueue(data), [data]);
  const statusCounts = useMemo(() => ({
    all: data.length,
    draft: data.filter(r => r.status === 'DRAFT').length,
    pending: data.filter(r => r.status === 'PENDING_APPROVAL').length,
    approved: data.filter(r => ['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'].includes(r.status)).length,
    paid: data.filter(r => r.status === 'PAID').length,
    review: data.filter(r => ['PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'].includes(r.status)).length,
  }), [data]);
  const filteredData = useMemo(() => {
    return data.filter(r => {
      if (statusFilter === 'draft' && r.status !== 'DRAFT') return false;
      if (statusFilter === 'pending' && r.status !== 'PENDING_APPROVAL') return false;
      if (statusFilter === 'approved' && !['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'].includes(r.status)) return false;
      if (statusFilter === 'paid' && r.status !== 'PAID') return false;
      return matchesSearch([
        r.requestNo,
        r.requesterDisplayNameSnapshot,
        r.reason,
        r.categoryLabelSnapshot ?? r.categoryKey,
        r.lineCount ?? 1,
        r.amount,
        r.currency,
        REQUEST_STATUS_LABELS[r.status] ?? r.status,
        PAYMENT_STATUS_LABELS[r.paymentStatus] ?? r.paymentStatus,
      ], query);
    });
  }, [data, statusFilter, query]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query, statusFilter]);
  const statusChips: Array<{ key: typeof statusFilter; label: string }> = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'draft', label: 'ร่าง' },
    { key: 'pending', label: 'รออนุมัติ' },
    { key: 'approved', label: 'อนุมัติแล้ว' },
    { key: 'paid', label: 'จ่ายแล้ว' },
  ];

  return (
    <div className="space-y-4">
      {/* Creating a claim is its own page: the form is long enough that expanding it inline
          pushed the list, filters and KPI cards out of view with no way back except ยกเลิก.
          Reading own claims and creating one are separate permissions — a link to a page that
          can only 403 on submit is worse than no link. */}
      {canCreate && (
        <div className="flex justify-end">
          <Link href={`/companies/${companyId}/reimbursements/new`} className={btnClass}>+ สร้างคำขอเบิก</Link>
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={ICON.doc} label="คำขอทั้งหมด" value={summary.count} sub="จำนวนใบ" {...KPI.sky} />
            <StatCard icon={ICON.edit} label="ร่างรอส่ง" value={statusCounts.draft} {...KPI.amber} />
            <StatCard icon={ICON.clock} label="รออนุมัติ/ตรวจสอบ" value={statusCounts.review} {...KPI.purple} />
            <StatCard icon={ICON.wallet} label="ยอดรวมที่ขอเบิก" value={baht0(summary.totalAmount)} {...KPI.brand} />
          </div>
          <MangmeeCard className="p-4">
            <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {statusChips.map(chip => (
                <button key={chip.key} onClick={() => setStatusFilter(chip.key)}
                  className={cx('inline-flex min-h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold transition sm:min-h-0',
                    statusFilter === chip.key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200')}>
                  {chip.label}
                  <span className={cx('tabular-nums inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-extrabold', statusFilter === chip.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500')}>{statusCounts[chip.key]}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {filteredData.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title={data.length === 0 ? 'ยังไม่มีคำขอเบิก' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                  description={data.length === 0 ? 'กด "สร้างคำขอเบิก" เพื่อเริ่มคำขอแรกของคุณ' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                />
              </div>
            ) : (
              <>
            <div className="hidden md:block" data-testid="reimbursements-mine-table">
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[980px]">
                <table className="mangmee-table">
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้ขอ</th><th className="!text-center">เหตุผล</th><th className="!text-center">หมวด</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">สถานะ</th><th className="!text-center">การจ่าย</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr><td colSpan={9}>
                        <EmptyState
                          title={data.length === 0 ? 'ยังไม่มีคำขอเบิก' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                          description={data.length === 0 ? 'กด "สร้างคำขอเบิก" เพื่อเริ่มคำขอแรกของคุณ' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                        />
                      </td></tr>
                    ) : pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td>{r.requesterDisplayNameSnapshot ?? '—'}</td>
                        <td>{r.reason}</td>
                        <td className="text-gray-500">{r.categoryLabelSnapshot ?? r.categoryKey}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.amount)} {r.currency}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td><PaymentBadge status={r.paymentStatus} /></td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
                              className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
                              onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
                              <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
                            </button>
                            {reimbursementOwnActions(r, userId, permissions).canSubmit && <button className={cx(btnClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} onClick={e => { e.stopPropagation(); action(r.id, () => submitReimbursement(companyId, r.id), 'ส่งขออนุมัติเรียบร้อยแล้ว'); }} disabled={busy === r.id}>ส่งอนุมัติ</button>}
                            {reimbursementOwnActions(r, userId, permissions).canCancel && <button className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} onClick={e => { e.stopPropagation(); action(r.id, () => cancelReimbursement(companyId, r.id, 'ยกเลิกโดยผู้ขอ'), 'ยกเลิกคำขอเรียบร้อยแล้ว'); }} disabled={busy === r.id}>ยกเลิก</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
            <div className="mt-3 space-y-3 md:hidden" data-testid="reimbursements-mine-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="relative p-4">
                  <Link
                    href={`?tab=mine&focus=${encodeURIComponent(r.id)}`}
                    aria-label={`ดูรายละเอียด ${r.requestNo ?? '—'}`}
                    className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500"
                    data-testid="reimbursements-mine-card"
                  />
                  <div className="pointer-events-none relative z-20">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.reason}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500">ผู้ขอ: {r.requesterDisplayNameSnapshot ?? '—'}</div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <StatusBadge status={r.status} />
                      <span className="shrink-0 text-xs text-gray-500">{shortDate(r.incurredDate)}</span>
                    </div>
                    <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.amount)} {r.currency}</div>
                  </div>
                  {(reimbursementOwnActions(r, userId, permissions).canSubmit || reimbursementOwnActions(r, userId, permissions).canCancel) && (
                    <div className="relative z-20 mt-4 space-y-2 border-t border-gray-100 pt-3">
                      {reimbursementOwnActions(r, userId, permissions).canSubmit && <button className={cx(btnClass, 'min-h-11 w-full')} onClick={() => action(r.id, () => submitReimbursement(companyId, r.id), 'ส่งขออนุมัติเรียบร้อยแล้ว')} disabled={busy === r.id}>ส่งอนุมัติ</button>}
                      {reimbursementOwnActions(r, userId, permissions).canCancel && <button className={cx(ghostClass, 'min-h-11 w-full')} onClick={() => action(r.id, () => cancelReimbursement(companyId, r.id, 'ยกเลิกโดยผู้ขอ'), 'ยกเลิกคำขอเรียบร้อยแล้ว')} disabled={busy === r.id}>ยกเลิก</button>}
                    </div>
                  )}
                </MangmeeCard>
              ))}
            </div>
            </>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
              page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
          </MangmeeCard>
        </>
      )}
    </div>
  );
}

// ── Detail drawer (lifted: reachable from every queue) ─────────────────────────
function DetailDrawer({ detail, context, userId, permissions, busy, error, onClose, onPrintClaimForm, onSign, onUploadSignedCopy, onOpenAttachment, onLineReceipt, onSubmit, onCancel, onReopen, onApprove, onRequestReject, onFinanceApprove, onRecordPayment }: {
  detail: any;
  context: HubTab;
  userId: string;
  permissions: readonly string[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPrintClaimForm: () => void;
  onSign: (role: ClaimSignatureRole) => void;
  onUploadSignedCopy: (file: File) => void;
  onOpenAttachment: (attachmentId: string, fileName: string) => void;
  onLineReceipt: (lineNo: number, file: File | null) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onReopen: () => void;
  onApprove: () => void;
  onRequestReject: () => void;
  onFinanceApprove: () => void;
  onRecordPayment: () => void;
}) {
  const lines: any[] = detail.lines ?? [];
  const { canEditDraft, canSubmit, canCancel, canReopen } = reimbursementOwnActions(detail, userId, permissions);
  const canApprove = context === 'approvals' && permissions.includes('reimbursement.approve') && detail.status === 'PENDING_APPROVAL';
  const canFinanceApprove = context === 'finance' && permissions.includes('reimbursement.finance_review') && detail.status === 'FINANCE_REVIEW';
  const canPay = context === 'finance' && permissions.includes('reimbursement.payment.record') && detail.status === 'READY_FOR_PAYMENT';
  const signatures: any[] = detail.signatures ?? [];
  const signedCopies: any[] = detail.signedCopies ?? [];
  const signableRoles = eligibleSignatureRoles(detail, userId);
  const canAttachSignedCopy = canUploadSignedCopy(detail, userId, permissions);
  const showActions = canSubmit || canCancel || canReopen || canApprove || canFinanceApprove || canPay;
  const footerButtons = detail.requestNo || showActions ? (
    <>
      {/* No requestNo, no document: drafts and claims cancelled out of DRAFT never got one. */}
      {detail.requestNo && <button className={ghostClass} disabled={busy} onClick={onPrintClaimForm}>พิมพ์ใบเบิก</button>}
      {canSubmit && <button className={btnClass} disabled={busy} onClick={onSubmit}>{busy ? 'กำลังดำเนินการ...' : 'ส่งอนุมัติ'}</button>}
      {canCancel && <button className={ghostClass} disabled={busy} onClick={onCancel}>ยกเลิกคำขอ</button>}
      {canReopen && <button className={btnClass} disabled={busy} onClick={onReopen}>{busy ? 'กำลังดำเนินการ...' : 'แก้ไขและยื่นใหม่'}</button>}
      {canApprove && <button className={successBtn} style={successBtnStyle} disabled={busy} onClick={onApprove}>อนุมัติ</button>}
      {canApprove && <button className={dangerClass} disabled={busy} onClick={onRequestReject}>ปฏิเสธ</button>}
      {canFinanceApprove && <button className={successBtn} style={successBtnStyle} disabled={busy} onClick={onFinanceApprove}>{financeActionLabel(detail)}</button>}
      {canPay && <button className={btnClass} disabled={busy} onClick={onRecordPayment}>บันทึกจ่าย</button>}
    </>
  ) : undefined;
  return (
    <Modal
      open
      size="xl"
      closeLabel="ปิด"
      onClose={onClose}
      title={(
        <div className="flex flex-wrap items-center gap-2">
          <span>รายละเอียดคำขอ {detail.requestNo ?? ''}</span>
          <StatusBadge status={detail.status} />
          <PaymentBadge status={detail.paymentStatus} />
        </div>
      )}
      footer={footerButtons}
    >
      <div className="space-y-4">
          <MangmeeCard className="p-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-500">ผู้ขอ</div>
                <div className="mt-1 font-semibold text-gray-900">{detail.requesterDisplayNameSnapshot ?? '—'}</div>
                <div className="mt-3 text-xs font-semibold text-gray-500">เหตุผล</div>
                <div className="mt-1 text-sm text-gray-700">{detail.reason ?? '—'}</div>
              </div>
              <div className="sm:text-right">
                <div className="text-xs font-semibold text-gray-500">ยอดรวม</div>
                <div className="mt-1 text-[28px] font-extrabold tabular-nums text-gray-900">{formatMoney(detail.amount)} {detail.currency}</div>
                <div className="mt-1 text-sm text-gray-500">คงค้าง {formatMoney(detail.outstandingAmount)} {detail.currency}</div>
              </div>
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <h4 className="text-sm font-bold text-gray-900">ข้อมูลคำขอ</h4>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Row k="หมวดหมู่" v={detail.categoryLabelSnapshot ?? detail.categoryKey} />
              <Row k="สถานะ" v={<StatusBadge status={detail.status} />} />
              <Row k="ตรวจสอบการเงิน" v={FINANCE_REVIEW_LABELS[detail.financeReviewStatus] ?? detail.financeReviewStatus} />
              {detail.financeReviewedByName && <Row k="ผู้ตรวจการเงิน" v={detail.financeReviewedByName} />}
              <Row k="การจ่าย" v={<PaymentBadge status={detail.paymentStatus} />} />
              <Row k="ใบเสร็จ" v={RECEIPT_REQUIREMENT_LABELS[detail.receiptRequirementStatus] ?? detail.receiptRequirementStatus} />
              <Row k="เหตุผลที่ไม่มีใบเสร็จ" v={detail.missingReceiptReason} />
              <Row k="ตรวจรายการซ้ำ" v={DUPLICATE_STATUS_LABELS[detail.duplicateStatus] ?? detail.duplicateStatus} />
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
                    <td>{shortDate(l.incurredDate)}</td>
                    <td>{l.description}</td>
                    <td className="text-gray-500">{l.purpose ?? '—'}</td>
                    <td className="text-gray-500">{l.categoryLabelSnapshot ?? l.categoryKey}</td>
                    <td className="text-right tabular-nums">{formatMoney(l.amount)}</td>
                    <td className="text-xs">
                      {l.attachmentId ? (
                        <button className="max-w-40 truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(l.attachmentId, l.attachmentFileName ?? 'receipt.jpg')}>
                          📎 {l.attachmentFileName ?? 'เปิดไฟล์แนบ'}
                        </button>
                      ) : <div className="text-gray-600">{l.linkedExpenseId ? '🔗 ค่าใช้จ่ายที่บันทึกไว้' : '—'}</div>}
                      {canEditDraft && (
                        <div className="mt-1 space-y-1">
                          <ThemedFile file={null} accept={ATTACHMENT_UPLOAD_ACCEPT} disabled={busy} onChange={file => { if (file) onLineReceipt(l.lineNo, file); }} />
                          {l.attachmentId && <button className="text-red-600 hover:underline" disabled={busy} onClick={() => onLineReceipt(l.lineNo, null)}>นำไฟล์ออก</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={5}>รวมเป็นเงิน</td>
                  <td className="text-right tabular-nums">{formatMoney(detail.amount)} {detail.currency}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          </MangmeeCard>

          {/* Signatures live on the document, so they only exist once the claim has one. */}
          {detail.requestNo && (
            <MangmeeCard className="p-4">
              <h4 className="mb-2 text-sm font-bold text-gray-900">ลายเซ็นในใบเบิก</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CLAIM_SIGNATURE_ROLES.map(role => {
                  const signed = signatures.find((s: any) => s.role === role);
                  return (
                    <div key={role} className="rounded-xl border border-gray-200 p-3 text-xs">
                      <div className="font-semibold text-gray-700">{CLAIM_SIGNATURE_ROLE_LABELS[role]}</div>
                      <div className="mt-2">
                        {signed ? (
                          <>
                            <MangmeeBadge tone="brand">ลงนามแล้ว</MangmeeBadge>
                            <div className="mt-2 text-gray-600">{signed.signedByName ?? signed.signedByUserId}</div>
                            <div className="text-gray-400">{shortDate(signed.signedAt)}</div>
                          </>
                        ) : <MangmeeBadge tone="slate">ยังไม่ลงนาม</MangmeeBadge>}
                      </div>
                      {/* Only the real actor of that step is offered the button; the server re-checks. */}
                      {signableRoles.includes(role) && (
                        <button className="mt-2 text-brand-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => onSign(role)}>
                          {signed ? 'ลงนามใหม่' : 'ลงนาม'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </MangmeeCard>
          )}

          {detail.requestNo && (
            <MangmeeCard className="p-4">
              <h4 className="mb-2 text-sm font-bold text-gray-900">ใบเบิกที่เซ็นแล้ว ({signedCopies.length})</h4>
              {signedCopies.length === 0
                ? <p className="text-xs text-gray-400">ยังไม่มีไฟล์ที่แนบกลับ</p>
                : (
                  <ul className="space-y-2 text-xs">
                    {signedCopies.map((copy: any) => (
                      <li key={copy.attachmentId} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2">
                        <button className="truncate text-brand-700 hover:underline" onClick={() => onOpenAttachment(copy.attachmentId, copy.fileName)}>📄 {copy.fileName}</button>
                        <span className="shrink-0 text-gray-400">{shortDate(copy.uploadedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              {canAttachSignedCopy && (
                <div className="mt-3 block text-xs font-semibold text-gray-600">
                  แนบใบเบิกที่เซ็นแล้ว (PDF/JPG/PNG)
                  <ThemedFile className="mt-1.5" file={null} accept={ATTACHMENT_UPLOAD_ACCEPT} disabled={busy} onChange={file => { if (file) onUploadSignedCopy(file); }} />
                </div>
              )}
            </MangmeeCard>
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
                        {APPROVAL_STEP_STATUS_LABELS[s.status] ?? s.status}
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
                      <span className="font-semibold tabular-nums text-gray-900">{formatMoney(p.paidAmount)} {p.currency}</span>
                    </div>
                    <div className="mt-1">{PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod} · {p.status === 'RECORDED' ? 'บันทึกแล้ว' : PAYMENT_STATUS_LABELS[p.status] ?? 'สถานะการจ่าย'}</div>
                    {p.paidByName && <div className="mt-1 text-gray-500">จ่ายโดย {p.paidByName}</div>}
                  </li>
                ))}
              </ul>
            </MangmeeCard>
          )}

          {error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}
function Row({ k, v }: { k: string; v: any }) {
  return <div><dt className="text-xs font-semibold text-gray-500">{k}</dt><dd className="mt-1 text-sm text-gray-900">{v ?? '—'}</dd></div>;
}

// ── Approval Queue ────────────────────────────────────────────────────────────
function ApprovalQueue({ companyId, refreshKey, onOpenDetail }: QueueProps) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [rejectFor, setRejectFor] = useState<any | null>(null);
  const [staleReview, setStaleReview] = useState<{ row: any; detail: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listApprovalQueue(companyId)); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  const approveRow = async (r: any) => {
    setBusy(r.id); setError(null);
    try {
      await approveReimbursement(companyId, r.id, undefined, r.approvalSnapshotHash);
      await load();
      toast.success('อนุมัติคำขอเรียบร้อยแล้ว');
    } catch (e) {
      if (isStaleApprovalError(e)) {
        try {
          setStaleReview({ row: r, detail: await getReimbursement(companyId, r.id) });
        } catch (e2) { setError(err(e2)); }
      } else { setError(err(e)); }
    } finally { setBusy(null); }
  };
  const summary = useMemo(() => summariseQueue(data), [data]);
  const filteredData = useMemo(() => data.filter(r => matchesSearch([
    r.requestNo,
    r.requesterDisplayNameSnapshot,
    r.reason,
    r.lineCount ?? 1,
    r.amount,
    r.currency,
    r.ageHours,
    r.slaRisk ? 'เกิน SLA' : '',
  ], query)), [data, query]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard icon={ICON.clock} label="รอคุณอนุมัติ" value={summary.count} {...KPI.amber} />
            <StatCard icon={ICON.wallet} label="ยอดรวมที่รออนุมัติ" value={baht0(summary.totalAmount)} {...KPI.purple} />
            <StatCard icon={ICON.alert} label="เกิน SLA" value={summary.flagged} danger={summary.flagged > 0} {...KPI.danger} />
          </div>
          <MangmeeCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {filteredData.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title={data.length === 0 ? 'ไม่มีรายการรออนุมัติ' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                  description={data.length === 0 ? 'คำขอที่รอคุณอนุมัติจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                />
              </div>
            ) : (
              <>
            <div className="hidden md:block" data-testid="reimbursements-approvals-table">
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[980px]">
                <table className="mangmee-table">
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้ขอ</th><th className="!text-center">เหตุผล</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">อายุ</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr><td colSpan={7}>
                        <EmptyState
                          title={data.length === 0 ? 'ไม่มีรายการรออนุมัติ' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                          description={data.length === 0 ? 'คำขอที่รอคุณอนุมัติจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                        />
                      </td></tr>
                    ) : pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td>{r.requesterDisplayNameSnapshot}</td>
                        <td>{r.reason}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.amount)} {r.currency}</td>
                        <td className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="tabular-nums">{r.ageHours} ชม.</span>
                            {r.slaRisk && <MangmeeBadge tone="danger">เกิน SLA</MangmeeBadge>}
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            {/* Approvers should read the line breakdown before deciding. */}
                            <button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
                              className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
                              onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
                              <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
                            </button>
                            <button className={cx(successBtn, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} style={successBtnStyle} disabled={busy === r.id} onClick={e => { e.stopPropagation(); approveRow(r); }}>อนุมัติ</button>
                            <button className={cx(dangerClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} disabled={busy === r.id} onClick={e => { e.stopPropagation(); setRejectFor(r); }}>ปฏิเสธ</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
            <div className="mt-3 space-y-3 md:hidden" data-testid="reimbursements-approvals-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.requesterDisplayNameSnapshot}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.slaRisk && <MangmeeBadge tone="danger">เกิน SLA</MangmeeBadge>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{r.ageHours} ชม.</span>
                  </div>
                  <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.amount)} {r.currency}</div>
                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                    <Link href={`?tab=approvals&focus=${encodeURIComponent(r.id)}`} className={cx(ghostClass, 'min-h-11 w-full')} data-testid="reimbursements-approvals-card">ดูรายละเอียด</Link>
                    <button className={cx(successBtn, 'min-h-11 w-full')} style={successBtnStyle} disabled={busy === r.id} onClick={() => approveRow(r)}>อนุมัติ</button>
                    <button className={cx(dangerClass, 'min-h-11 w-full')} disabled={busy === r.id} onClick={() => setRejectFor(r)}>ปฏิเสธ</button>
                  </div>
                </MangmeeCard>
              ))}
            </div>
            </>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
              page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
          </MangmeeCard>
        </>
      )}
      {rejectFor && <RejectDialog
        requestNo={rejectFor.requestNo}
        busy={busy === rejectFor.id}
        onClose={() => setRejectFor(null)}
        onConfirm={async reason => {
          await action(rejectFor.id, () => rejectReimbursement(companyId, rejectFor.id, reason), 'ปฏิเสธคำขอเรียบร้อยแล้ว');
          setRejectFor(null);
        }}
      />}
      {staleReview && <StaleApprovalDialog
        requestNo={staleReview.detail.requestNo ?? staleReview.row.requestNo}
        diff={diffApprovalFields(
          {
            reason: staleReview.row.reason,
            amount: formatMoney(staleReview.row.amount),
            currency: staleReview.row.currency,
            categoryLabel: staleReview.row.categoryLabelSnapshot ?? staleReview.row.categoryKey,
            lineCount: staleReview.row.lineCount ?? 1,
          },
          {
            reason: staleReview.detail.reason,
            amount: formatMoney(staleReview.detail.amount),
            currency: staleReview.detail.currency,
            categoryLabel: staleReview.detail.categoryLabelSnapshot ?? staleReview.detail.categoryKey,
            lineCount: (staleReview.detail.lines ?? []).length,
          },
        )}
        lines={staleReview.detail.lines ?? []}
        currency={staleReview.detail.currency}
        busy={busy === staleReview.row.id}
        error={error}
        onClose={() => setStaleReview(null)}
        onConfirm={async () => {
          const review = staleReview;
          if (!review) return;
          setBusy(review.row.id); setError(null);
          try {
            await approveReimbursement(companyId, review.row.id, undefined, review.detail.approvalSnapshotHash);
            setStaleReview(null);
            await load();
            toast.success('อนุมัติคำขอเรียบร้อยแล้ว');
          } catch (e) { setError(err(e)); }
          finally { setBusy(null); }
        }}
      />}
    </div>
  );
}

// ── Finance Queue ─────────────────────────────────────────────────────────────
function FinanceQueue({ companyId, refreshKey, onOpenDetail, onRecordPayment }: QueueProps & { onRecordPayment: (request: any) => void }) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listFinanceQueue(companyId)); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  /**
   * อนุมัติจ่าย commits its decision before it projects the claim expenses, so a failed call
   * still changes the row (financeReviewStatus becomes อนุมัติจ่าย while the status stays
   * รอตรวจสอบการเงิน). Reload either way, then restore the message `load` cleared, so the
   * user sees both what went wrong and the row's real state — with its ดำเนินการต่อ button.
   */
  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(id); setError(null);
    let failure: string | null = null;
    try { await fn(); } catch (e) { failure = err(e); }
    await load();
    if (failure) setError(failure);
    else if (successMessage) toast.success(successMessage);
    setBusy(null);
  };
  const summary = useMemo(() => summariseQueue(data), [data]);
  const filteredData = useMemo(() => data.filter(r => matchesSearch([
    r.requestNo,
    r.requesterDisplayNameSnapshot,
    r.lineCount ?? 1,
    r.outstandingAmount,
    r.amount,
    r.currency,
    REQUEST_STATUS_LABELS[r.status] ?? r.status,
    FINANCE_REVIEW_LABELS[r.financeReviewStatus] ?? r.financeReviewStatus,
    r.hasDuplicateBlocker ? 'อาจซ้ำ' : '',
  ], query)), [data, query]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard icon={ICON.clock} label="รอตรวจ/รอจ่าย" value={summary.count} {...KPI.sky} />
            <StatCard icon={ICON.wallet} label="ยอดคงค้างรวม" value={baht0(summary.outstandingAmount)} {...KPI.purple} />
            <StatCard icon={ICON.alert} label="พบรายการที่อาจซ้ำ" value={summary.flagged} danger={summary.flagged > 0} {...KPI.danger} />
          </div>
          <MangmeeCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {filteredData.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title={data.length === 0 ? 'ไม่มีรายการรอการเงิน' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                  description={data.length === 0 ? 'คำขอที่ผ่านการอนุมัติแล้วจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                />
              </div>
            ) : (
              <>
            <div className="hidden md:block" data-testid="reimbursements-finance-table">
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[980px]">
                <table className="mangmee-table">
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้ขอ</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">สถานะ</th><th className="!text-center">ตรวจการเงิน</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr><td colSpan={7}>
                        <EmptyState
                          title={data.length === 0 ? 'ไม่มีรายการรอการเงิน' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                          description={data.length === 0 ? 'คำขอที่ผ่านการอนุมัติแล้วจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                        />
                      </td></tr>
                    ) : pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td>{r.requesterDisplayNameSnapshot}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.outstandingAmount)} / {formatMoney(r.amount)} {r.currency}</td>
                        <td><div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} />{r.hasDuplicateBlocker && <MangmeeBadge tone="amber">อาจซ้ำ</MangmeeBadge>}</div></td>
                        <td className="text-xs text-gray-500">{FINANCE_REVIEW_LABELS[r.financeReviewStatus] ?? r.financeReviewStatus}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
                              className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
                              onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
                              <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
                            </button>
                            {r.status === 'FINANCE_REVIEW' && <button className={cx(successBtn, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} style={successBtnStyle} disabled={busy === r.id} onClick={e => { e.stopPropagation(); action(r.id, () => financeReviewReimbursement(companyId, r.id, { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: r.hasDuplicateBlocker, duplicateResolutionReason: r.hasDuplicateBlocker ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined }), r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว'); }}>{financeActionLabel(r)}</button>}
                            {(r.status === 'READY_FOR_PAYMENT') && <button className={cx(btnClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} disabled={busy === r.id} onClick={e => { e.stopPropagation(); onRecordPayment(r); }}>บันทึกจ่าย</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
            <div className="mt-3 space-y-3 md:hidden" data-testid="reimbursements-finance-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.requesterDisplayNameSnapshot}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.hasDuplicateBlocker && <MangmeeBadge tone="amber">อาจซ้ำ</MangmeeBadge>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{r.ageHours} ชม.</span>
                  </div>
                  <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.outstandingAmount)} / {formatMoney(r.amount)} {r.currency}</div>
                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                    <Link href={`?tab=finance&focus=${encodeURIComponent(r.id)}`} className={cx(ghostClass, 'min-h-11 w-full')} data-testid="reimbursements-finance-card">ดูรายละเอียด</Link>
                    {r.status === 'FINANCE_REVIEW' && <button className={cx(successBtn, 'min-h-11 w-full')} style={successBtnStyle} disabled={busy === r.id} onClick={() => action(r.id, () => financeReviewReimbursement(companyId, r.id, { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: r.hasDuplicateBlocker, duplicateResolutionReason: r.hasDuplicateBlocker ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined }), r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว')}>{financeActionLabel(r)}</button>}
                    {r.status === 'READY_FOR_PAYMENT' && <button className={cx(btnClass, 'min-h-11 w-full')} disabled={busy === r.id} onClick={() => onRecordPayment(r)}>บันทึกจ่าย</button>}
                  </div>
                </MangmeeCard>
              ))}
            </div>
            </>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
              page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
          </MangmeeCard>
        </>
      )}
    </div>
  );
}

// ── Claim-form signature dialog ───────────────────────────────────────────────

/** Photographed signatures come on paper: drop the light background so only the ink prints. */
async function toTransparentSignature(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('อ่านรูปลายเซ็นไม่สำเร็จ'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('เบราว์เซอร์ไม่รองรับ canvas');
    context.drawImage(image, 0, 0);
    context.putImageData(removeLightBackground(context.getImageData(0, 0, canvas.width, canvas.height)), 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('แปลงรูปลายเซ็นไม่สำเร็จ');
    return { blob, dataUrl: canvas.toDataURL('image/png') };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function SignatureModal({ companyId, requestId, role, ackHash, onClose, onDone }: {
  companyId: string;
  requestId: string;
  role: ClaimSignatureRole;
  ackHash?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [transparent, setTransparent] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (picked: File | null) => {
    setFile(null); setTransparent(null); setError(null);
    if (!picked) return;
    try {
      assertAllowedUploadFile(picked, 'image');
      setFile(picked);
      setTransparent(await toTransparentSignature(picked));
    }
    catch (e) { setError(e instanceof Error ? e.message : 'อ่านรูปลายเซ็นไม่สำเร็จ'); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('กรุณาเลือกรูปลายเซ็น (PNG/JPEG)'); return; }
    if (!ackHash) { setError('ไม่พบข้อมูลคำขอล่าสุด กรุณาเปิดคำขอใหม่'); return; }
    setBusy(true); setError(null);
    try {
      const upload = removeBackground && transparent
        ? new File([transparent.blob], `signature-${role.toLowerCase()}.png`, { type: 'image/png' })
        : file;
      const attachmentId = await uploadClaimSignature(companyId, requestId, role, upload);
      // The hash comes from the detail we are looking at: signing acknowledges this exact claim.
      await signReimbursementClaimForm(companyId, requestId, { role, signatureAttachmentId: attachmentId, snapshotHash: ackHash });
      onDone();
      toast.success('ลงนามใบเบิกเรียบร้อยแล้ว');
    } catch (e2) { setError(err(e2)); } finally { setBusy(false); }
  };

  return (
    <Modal open title={`ลงนาม — ${CLAIM_SIGNATURE_ROLE_LABELS[role]}`} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-xs text-gray-500">อัปโหลดรูปลายเซ็น (PNG/JPEG ไม่เกิน 2 MB) ระบบจะนำไปวางในช่อง{CLAIM_SIGNATURE_ROLE_LABELS[role]}ของใบเบิก</p>
        <div className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600">รูปลายเซ็น *</span>
          <ThemedFile file={file} accept={IMAGE_UPLOAD_ACCEPT} onChange={picked => void pick(picked)} />
        </div>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 px-3 py-2.5">
          <span className="text-xs font-semibold text-gray-600">ลบพื้นหลังให้อัตโนมัติ</span>
          <input type="checkbox" checked={removeBackground} onChange={e => setRemoveBackground(e.target.checked)} />
        </label>
        {transparent && removeBackground && (
          <img src={transparent.dataUrl} alt="ตัวอย่างลายเซ็น" className="mx-auto max-h-32 rounded-xl border border-gray-200 bg-white p-2" />
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={btnClass} disabled={busy || !file}>{busy ? 'กำลังลงนาม...' : 'ลงนาม'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({ companyId, request, onClose, onDone }: { companyId: string; request: any; onClose: () => void; onDone: () => void }) {
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
    } catch (e2) { setError(err(e2)); } finally { setBusy(false); }
  };

  return (
    <Modal open title={`บันทึกการจ่ายเงิน — ${request.requestNo}`} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-xs text-gray-500">จ่ายเต็มจำนวนคงค้าง {formatMoney(request.outstandingAmount)} {request.currency}</p>
        <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">จำนวนเงิน *</label><input className={inputClass} type="number" step="0.01" required value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">วิธีจ่าย</label>
          <ThemedSelect className={inputClass} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
        </div>
        <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">วันที่จ่าย *</label><ThemedDate className={inputClass} required value={form.paidAt} onChange={e => setForm(f => ({ ...f, paidAt: e.target.value }))} /></div>
        <div><label className="mb-1.5 block text-xs font-semibold text-gray-600">เลขอ้างอิง {(form.paymentMethod === 'BANK_TRANSFER' || form.paymentMethod === 'CHEQUE') && '*'}</label><input className={inputClass} value={form.paymentReference} onChange={e => setForm(f => ({ ...f, paymentReference: e.target.value }))} /></div>
        {error && <ErrorBanner message={error} />}
        <div className="flex gap-2 justify-end"><button type="button" className={ghostClass} onClick={onClose}>ยกเลิก</button><button type="submit" className={btnClass} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึกจ่าย'}</button></div>
      </form>
    </Modal>
  );
}

// ── Policy Settings ───────────────────────────────────────────────────────────
function PolicySettings({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [form, setForm] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setForm(await getReimbursementPolicy(companyId)); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await updateReimbursementPolicy(companyId, {
        approvalRequiredFromAmount: form.approvalRequiredFromAmount,
        approverMode: form.approverMode,
        defaultApproverRole: form.defaultApproverRole,
        allowSelfApproval: form.allowSelfApproval,
        requireReceipt: form.requireReceipt,
        allowMissingReceiptWithReason: form.allowMissingReceiptWithReason,
        duplicatePolicy: form.duplicatePolicy,
        financeReviewRequired: form.financeReviewRequired,
        slaHours: form.slaHours ? Number(form.slaHours) : null,
      });
      toast.success('บันทึกนโยบายเบิกจ่ายแล้ว'); await load();
    } catch (e2) { setError(err(e2)); } finally { setBusy(false); }
  };

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (!form) return <ErrorBanner message={error ?? 'โหลดนโยบายไม่สำเร็จ'} />;

  return (
    <form onSubmit={save} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4 xl:grid-cols-2">
        <MangmeeCard className="p-4 xl:col-span-2">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: KPI.sky.bg, color: KPI.sky.color }}>{ICON.doc}</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900">เกณฑ์การอนุมัติ</h3>
              <p className="mt-1 text-xs text-gray-500">กำหนดยอดและผู้รับผิดชอบในการอนุมัติคำขอ</p>
            </div>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">ต้องอนุมัติเมื่อยอดตั้งแต่ (บาท)</label>
              <input className={inputClass} type="number" step="0.01" value={form.approvalRequiredFromAmount} onChange={e => setForm((f: any) => ({ ...f, approvalRequiredFromAmount: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">โหมดผู้อนุมัติ</label>
              <ThemedSelect className={inputClass} value={form.approverMode} onChange={e => setForm((f: any) => ({ ...f, approverMode: e.target.value }))}>
                {Object.entries(APPROVER_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </ThemedSelect>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">บทบาทผู้อนุมัติเริ่มต้น</label>
              <input className={inputClass} value={form.defaultApproverRole ?? ''} onChange={e => setForm((f: any) => ({ ...f, defaultApproverRole: e.target.value }))} />
            </div>
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200 sm:col-span-2">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">อนุญาตให้อนุมัติคำขอตนเอง</span>
                <span className="mt-0.5 block text-xs text-gray-500">ผู้อนุมัติกดอนุมัติคำขอที่ตัวเองสร้างได้</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.allowSelfApproval} onChange={e => setForm((f: any) => ({ ...f, allowSelfApproval: e.target.checked }))} />
            </label>
          </div>
        </MangmeeCard>

        <MangmeeCard className="p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: KPI.amber.bg, color: KPI.amber.color }}>{ICON.receipt}</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900">ใบเสร็จและรายการซ้ำ</h3>
              <p className="mt-1 text-xs text-gray-500">ควบคุมหลักฐานประกอบและวิธีจัดการรายการที่อาจซ้ำ</p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">ต้องมีใบเสร็จ</span>
                <span className="mt-0.5 block text-xs text-gray-500">ทุกรายการต้องแนบใบเสร็จก่อนส่งอนุมัติ</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.requireReceipt} onChange={e => setForm((f: any) => ({ ...f, requireReceipt: e.target.checked }))} />
            </label>
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">อนุญาตไม่มีใบเสร็จได้หากระบุเหตุผล</span>
                <span className="mt-0.5 block text-xs text-gray-500">ผู้ขอกรอกเหตุผลแทนใบเสร็จได้ในบางกรณี</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.allowMissingReceiptWithReason} onChange={e => setForm((f: any) => ({ ...f, allowMissingReceiptWithReason: e.target.checked }))} />
            </label>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">นโยบายรายการซ้ำ</label>
              <ThemedSelect className={inputClass} value={form.duplicatePolicy} onChange={e => setForm((f: any) => ({ ...f, duplicatePolicy: e.target.value }))}>
                <option value="WARN">เตือน</option>
                <option value="BLOCK_SUBMIT">ระงับการส่ง</option>
                <option value="BLOCK_PAYMENT">ระงับการจ่าย</option>
              </ThemedSelect>
            </div>
          </div>
        </MangmeeCard>

        <MangmeeCard className="p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: KPI.purple.bg, color: KPI.purple.color }}>{ICON.wallet}</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900">การเงินและ SLA</h3>
              <p className="mt-1 text-xs text-gray-500">กำหนดขั้นตอนตรวจสอบก่อนจ่ายและเวลาที่คาดหวัง</p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">ต้องผ่านการตรวจสอบการเงินก่อนจ่าย</span>
                <span className="mt-0.5 block text-xs text-gray-500">คำขอที่อนุมัติแล้วต้องให้ฝ่ายการเงินตรวจก่อนบันทึกจ่าย</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.financeReviewRequired} onChange={e => setForm((f: any) => ({ ...f, financeReviewRequired: e.target.checked }))} />
            </label>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">SLA (ชั่วโมง)</label>
              <input className={inputClass} type="number" value={form.slaHours ?? ''} onChange={e => setForm((f: any) => ({ ...f, slaHours: e.target.value }))} />
            </div>
          </div>
        </MangmeeCard>
      </div>

      <aside>
        <MangmeeCard className="sticky top-4 h-fit p-4">
          <h3 className="text-sm font-bold text-gray-900">สรุปนโยบาย</h3>
          <dl className="mt-4 divide-y divide-gray-100">
            <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
              <dt className="text-xs text-gray-500">ต้องอนุมัติเมื่อยอด</dt>
              <dd className="text-sm font-semibold text-gray-800">≥ {formatMoney(form.approvalRequiredFromAmount)} บาท</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-xs text-gray-500">ผู้อนุมัติ</dt>
              <dd className="text-right text-sm font-semibold text-gray-800">{APPROVER_MODE_LABELS[form.approverMode] ?? form.approverMode}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-xs text-gray-500">ใบเสร็จ</dt>
              <dd><MangmeeBadge tone={form.requireReceipt ? 'brand' : 'slate'}>{form.requireReceipt ? 'จำเป็น' : 'ไม่บังคับ'}</MangmeeBadge></dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-xs text-gray-500">ตรวจการเงินก่อนจ่าย</dt>
              <dd><MangmeeBadge tone={form.financeReviewRequired ? 'brand' : 'slate'}>{form.financeReviewRequired ? 'เปิด' : 'ปิด'}</MangmeeBadge></dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3 last:pb-0">
              <dt className="text-xs text-gray-500">SLA</dt>
              <dd className="text-sm font-semibold text-gray-800">{form.slaHours === '' || form.slaHours == null ? 'ไม่กำหนด' : `${form.slaHours} ชั่วโมง`}</dd>
            </div>
          </dl>
          <div className="mt-4 space-y-3">
            {error && <ErrorBanner message={error} />}
            <button type="submit" className={cx(btnClass, 'w-full')} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึกนโยบาย'}</button>
          </div>
        </MangmeeCard>
      </aside>
    </form>
  );
}
