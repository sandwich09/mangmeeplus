'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useSearchParams } from 'next/navigation';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { ForbiddenState } from '@/common/components/state';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { listVendorBills, getVendorBill, createVendorBill, matchVendorBill, submitVendorBill, approveVendorBill, rejectVendorBill, voidVendorBill, getSupplierPayment, listSupplierPayments, createSupplierPayment, voidSupplierPayment, generateSourceJournal, releasePp36InputClaim, getApAging, reviewVendorBillTaxEvidence, updateVendorBillTaxEvidence, getApprovalPolicy, updateApprovalPolicy, listWhtHandoffs, linkExternalWhtCertificate, setWhtHandoffPayeeAddress, listWhtIncomeCategories, issueSystemWhtCertificate, correctSystemWhtCertificate, issueSystemWhtReplacementCopy } from './accounts-payable.api';
import { downloadArtifact } from '@/common/files/download-artifact';
import type { WhtIncomeCategoryOption } from './accounts-payable.api';
import type { PaymentMethod, SupplierPaymentDetail, SupplierPaymentSummary, SupplierSummary, TradeTaxEvidenceDto, TransactionTaxContext, VendorBillDetail, VendorBillSummary } from '@watchdog-bms/contracts';
import { listSuppliers } from '@/features/procurement/procurement.api';
import { TransactionTaxLineSelector } from '@/features/tax/TransactionTaxLineSelector';
import { listTradeTaxEvidence, uploadTradeTaxEvidenceAttachment } from '@/features/tax/transaction-tax.api';
import { useBranchFilter } from '@/features/web-core-workspace/WorkspaceScope';
import { TransactionBranchField, useTransactionCreateBranchId } from '@/features/web-core-workspace/TransactionBranchField';
import { isBranchScope403 } from '@/features/web-core-workspace/branch-scope-label.logic';
import { canSubmitSupplierPayment, isSupplierPaymentWithholdingValid, isVendorBillTaxEvidenceBlocked, isVendorBillTaxEvidenceCompleteForReview, canIssueSystemWhtCertificate, canCorrectWhtCertificate, canIssueWhtReplacementCopy } from './accounts-payable.model';
import { parseAccountsPayableTab, visibleAccountsPayableTabs, whtHandoffPayeeAddress, whtLinkErrorOutcome, type AccountsPayableTab } from './accounts-payable.logic';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state/LoadingState';
import { fetchAttachmentPreviewBlob } from '@/features/expenses/expenses.api';

function err(e: unknown) { return apiErrorMessage(e); }
const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const ghostClass = 'rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const dangerClass = 'rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50';

const VB_STATUS_LABELS: Record<string, string> = { DRAFT: 'ร่าง', NEEDS_REVIEW: 'รอตรวจสอบ', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ', PARTIALLY_PAID: 'ชำระบางส่วน', PAID: 'ชำระแล้ว', VOIDED: 'ยกเลิก', CREDITED: 'เครดิต' };
const MATCH_STATUS_LABELS: Record<string, string> = { NOT_REQUIRED: '-', NOT_MATCHED: 'ไม่ตรง', MATCHED: 'ตรง', MATCHED_WITH_VARIANCE: 'ตรงแต่มีส่วนต่าง', BLOCKED: 'บล็อก', OVERRIDDEN: 'ข้ามกฎ' };
const PAYMENT_STATUS_LABELS: Record<string, string> = { DRAFT: 'ร่าง', RECORDED: 'บันทึกแล้ว', VOIDED: 'ยกเลิก' };

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  const colorMap: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700', NEEDS_REVIEW: 'bg-yellow-100 text-yellow-700',
    PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800', APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700', VOIDED: 'bg-red-50 text-red-400',
    PAID: 'bg-green-100 text-green-700', PARTIALLY_PAID: 'bg-blue-100 text-blue-700',
    MATCHED: 'bg-green-100 text-green-700', NOT_MATCHED: 'bg-red-100 text-red-700',
    MATCHED_WITH_VARIANCE: 'bg-orange-100 text-orange-700', OVERRIDDEN: 'bg-purple-100 text-purple-700',
    RECORDED: 'bg-green-100 text-green-700',
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[status] ?? 'bg-gray-100 text-gray-600'}`}>{map[status] ?? status}</span>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div>;
}

function Pp36ClaimAction({ companyId, billId, lineId, supplierId, canClaim, canPost }: { companyId: string; billId: string; lineId: string; supplierId: string; canClaim: boolean; canPost: boolean }) {
  const toast = useToast();
  const [receipts, setReceipts] = useState<TradeTaxEvidenceDto[]>([]);
  const [payments, setPayments] = useState<SupplierPaymentDetail[]>([]);
  const [evidenceId, setEvidenceId] = useState('');
  const [supplierPaymentId, setSupplierPaymentId] = useState('');
  const [claimDate, setClaimDate] = useState(todayCivilDate());
  const [reason, setReason] = useState('ยืนยันใบเสร็จ ภ.พ.36 จากกรมสรรพากร');
  const [adjustmentId, setAdjustmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(canClaim);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!canClaim) return;
    const loadOptions = async () => {
      setOptionsLoading(true);
      setError('');
      try {
        const [rows, paymentRows] = await Promise.all([
          listTradeTaxEvidence(companyId, { sourceType: 'procurement.vendor_bill', sourceId: billId, transactionContext: 'IMPORT_SERVICE', status: 'VERIFIED' }),
          listSupplierPayments(companyId, { supplierId, pageSize: 100 }).then((result) => Promise.all(result.data.map((payment) => getSupplierPayment(companyId, payment.id)))),
        ]);
        const exact = rows.filter((item) => item.evidenceType === 'PP36_RECEIPT' && item.sourceLineId === lineId);
        const recognized = paymentRows.filter((payment) => payment.status === 'RECORDED' && payment.allocations.some((allocation) => allocation.vendorBillId === billId && allocation.pp36RecognitionStatus === 'ACTIVE'));
        setReceipts(exact); setEvidenceId((current) => current || exact[0]?.id || '');
        setPayments(recognized); setSupplierPaymentId((current) => current || recognized[0]?.id || '');
      } catch (cause) {
        setError(err(cause));
      } finally {
        setOptionsLoading(false);
      }
    };
    void loadOptions();
  }, [billId, canClaim, companyId, lineId, supplierId]);
  if (!canClaim) return null;
  async function release() {
    setBusy(true); setError('');
    try {
      const result = await releasePp36InputClaim(companyId, billId, lineId, { supplierPaymentId: supplierPaymentId || undefined, evidenceId, claimDate, reason });
      setAdjustmentId(result.adjustmentId);
      toast.success('ปล่อยสิทธิภาษีซื้อเรียบร้อยแล้ว');
    } catch (cause) { setError(err(cause)); } finally { setBusy(false); }
  }
  return <div className="mt-2 grid gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs sm:grid-cols-2">
    <ThemedSelect value={evidenceId} disabled={optionsLoading} onChange={(event) => setEvidenceId(event.target.value)}>
      {optionsLoading ? <option value="">กำลังโหลด...</option> : <><option value="">เลือกใบเสร็จ ภ.พ.36 ที่ยืนยันแล้ว</option>{receipts.map((item) => <option key={item.id} value={item.id}>{item.referenceNumber} · {item.evidenceDate}</option>)}</>}
    </ThemedSelect>
    {(optionsLoading || payments.length > 0) && <ThemedSelect value={supplierPaymentId} disabled={optionsLoading} onChange={(event) => setSupplierPaymentId(event.target.value)}>{optionsLoading ? <option value="">กำลังโหลด...</option> : <><option value="">เลือกการจ่ายที่รับรู้ ภ.พ.36</option>{payments.map((payment) => <option key={payment.id} value={payment.id}>{payment.paymentNumber ?? payment.id.slice(0, 8)} · {formatThaiDate(payment.paymentDate)}</option>)}</>}</ThemedSelect>}
    <ThemedDate className={inputClass} value={claimDate} onChange={(event) => setClaimDate(event.target.value)} />
    <input className={`${inputClass} sm:col-span-2`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เหตุผลการปล่อยสิทธิภาษีซื้อ" />
    <button className={btnClass} disabled={busy || optionsLoading || !evidenceId || (payments.length > 0 && !supplierPaymentId) || !reason.trim()} aria-busy={Boolean(busy)} onClick={() => void release()}>{busy ? 'กำลังปล่อยสิทธิ...' : 'ปล่อยสิทธิภาษีซื้อ ภ.พ.36'}</button>
    {adjustmentId && canPost && <button className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => { setBusy(true); setError(''); void generateSourceJournal(companyId, 'tax.pp36_input_claim', adjustmentId).then(() => toast.success('ลงบัญชีรายการปล่อยสิทธิเรียบร้อยแล้ว')).catch((cause) => setError(err(cause))).finally(() => setBusy(false)); }}>ลงบัญชีรายการปล่อยสิทธิ</button>}
    {!optionsLoading && !receipts.length && <a className="font-bold text-brand-700 underline sm:col-span-2" href={`/companies/${companyId}/tax/evidence?${new URLSearchParams({ context: 'IMPORT_SERVICE', sourceType: 'procurement.vendor_bill', sourceId: billId, sourceLineId: lineId })}`}>แนบและให้ผู้มีสิทธิ์ยืนยัน PP36_RECEIPT บรรทัดนี้ก่อน</a>}
    {error && <p role="alert" className="sm:col-span-2 text-error-700">{error}</p>}
  </div>;
}

const TAX_EVIDENCE_ISSUE_LABELS: Record<string, string> = {
  missing_supplier_tax_id: 'ผู้ขายยังไม่มีเลขประจำตัวผู้เสียภาษี',
  supplier_vat_registration_not_confirmed: 'ยังไม่ได้ยืนยันว่าผู้ขายจดทะเบียน VAT',
  missing_tax_invoice_number: 'ยังไม่มีเลขที่ใบกำกับภาษี',
  missing_tax_invoice_date: 'ยังไม่มีวันที่ใบกำกับภาษี',
  missing_active_tax_invoice_attachment: 'ยังไม่มีไฟล์ใบกำกับภาษีที่อัปโหลดสำเร็จ',
  tax_evidence_review_required: 'รอผู้อนุมัติตรวจหลักฐาน',
  tax_evidence_rejected: 'ผู้อนุมัติปฏิเสธหลักฐาน',
};

type VendorBillAttachmentPreviewTarget = {
  attachmentId: string;
  name: string;
};

function VendorBillTaxEvidencePanel({ companyId, bill, canEdit, canUpload, canReview, canReadAttachment, onUpdated }: {
  companyId: string;
  bill: VendorBillDetail;
  canEdit: boolean;
  canUpload: boolean;
  canReview: boolean;
  canReadAttachment: boolean;
  onUpdated: (bill: VendorBillDetail) => void;
}) {
  const toast = useToast();
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState(bill.taxInvoiceNumber ?? '');
  const [taxInvoiceDate, setTaxInvoiceDate] = useState(bill.taxInvoiceDate?.slice(0, 10) ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState<DocumentPreviewSource | null>(null);
  const [previewTarget, setPreviewTarget] = useState<VendorBillAttachmentPreviewTarget | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const releaseAttachmentPreviewUrl = useCallback(() => {
    const url = previewUrlRef.current;
    previewUrlRef.current = null;
    if (url) URL.revokeObjectURL(url);
  }, []);
  const closeAttachmentPreview = useCallback(() => {
    previewRequestRef.current += 1;
    releaseAttachmentPreviewUrl();
    setAttachmentPreview(null);
    setPreviewTarget(null);
    setPreviewLoading(false);
  }, [releaseAttachmentPreviewUrl]);
  useEffect(() => () => {
    previewRequestRef.current += 1;
    releaseAttachmentPreviewUrl();
  }, [releaseAttachmentPreviewUrl]);
  useEffect(() => {
    previewRequestRef.current += 1;
    releaseAttachmentPreviewUrl();
    setTaxInvoiceNumber(bill.taxInvoiceNumber ?? '');
    setTaxInvoiceDate(bill.taxInvoiceDate?.slice(0, 10) ?? '');
    setFile(null);
    setAttachmentPreview(null);
    setPreviewTarget(null);
    setPreviewLoading(false);
  }, [bill.id, bill.taxInvoiceDate, bill.taxInvoiceNumber, bill.attachmentId, companyId, releaseAttachmentPreviewUrl]);
  if (!bill.taxEvidenceRequired) return null;
  const editable = canEdit && ['DRAFT', 'NEEDS_REVIEW'].includes(bill.status);
  const reviewable = canReview && ['DRAFT', 'NEEDS_REVIEW'].includes(bill.status) && isVendorBillTaxEvidenceCompleteForReview(bill);

  async function saveEvidence() {
    setBusy(true); setError('');
    try {
      const attachmentId = file ? await uploadTradeTaxEvidenceAttachment(companyId, bill.branchId, file) : bill.attachmentId;
      if (!attachmentId) throw new Error('กรุณาเลือกไฟล์ใบกำกับภาษี');
      const updated = await updateVendorBillTaxEvidence(companyId, bill.id, { taxInvoiceNumber, taxInvoiceDate, attachmentId });
      onUpdated(updated); setFile(null); toast.success('บันทึกหลักฐานเรียบร้อยแล้ว');
    } catch (cause) { setError(err(cause)); } finally { setBusy(false); }
  }
  async function review(status: 'VERIFIED' | 'REJECTED') {
    setBusy(true); setError('');
    try {
      const updated = await reviewVendorBillTaxEvidence(companyId, bill.id, { status });
      onUpdated(updated); toast.success(status === 'VERIFIED' ? 'ยืนยันหลักฐานเรียบร้อยแล้ว' : 'ปฏิเสธหลักฐานเรียบร้อยแล้ว');
    } catch (cause) { setError(err(cause)); } finally { setBusy(false); }
  }
  async function loadAttachmentPreview(target: VendorBillAttachmentPreviewTarget) {
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    setError('');
    try {
      const blob = await fetchAttachmentPreviewBlob(companyId, target.attachmentId);
      if (requestId !== previewRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      releaseAttachmentPreviewUrl();
      previewUrlRef.current = url;
      setPreviewTarget(target);
      setAttachmentPreview({ name: target.name, mimeType: blob.type, url });
    } catch (cause) {
      if (requestId !== previewRequestRef.current) return;
      setError(err(cause));
      throw cause;
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  }
  async function openAttachment() {
    if (!bill.attachmentId) return;
    const label = bill.taxInvoiceNumber?.trim() || bill.vendorBillNumber?.trim() || 'เอกสารหลักฐานภาษี';
    try {
      await loadAttachmentPreview({ attachmentId: bill.attachmentId, name: `ใบกำกับภาษี ${label}` });
    } catch {
      // The active request already reports its localized failure in this panel.
    }
  }

  return <>
  <section className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>หลักฐานภาษีซื้อในประเทศ</strong>
      <StatusBadge status={bill.taxEvidenceReviewStatus} map={{ DRAFT: 'ยังไม่เริ่ม', REVIEW_REQUIRED: 'รอตรวจ', VERIFIED: 'ยืนยันแล้ว', REJECTED: 'ปฏิเสธ' }} />
    </div>
    {bill.reviewIssues.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-900">{bill.reviewIssues.map((issue) => <li key={issue}>{TAX_EVIDENCE_ISSUE_LABELS[issue] ?? issue}</li>)}</ul>}
    {editable ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input className={inputClass} value={taxInvoiceNumber} onChange={(event) => setTaxInvoiceNumber(event.target.value)} placeholder="เลขที่ใบกำกับภาษี" disabled={busy} />
      <ThemedDate className={inputClass} value={taxInvoiceDate} onChange={(event) => setTaxInvoiceDate(event.target.value)} disabled={busy} />
      {canUpload && <ThemedFile className="sm:col-span-2" file={file} accept={ATTACHMENT_UPLOAD_ACCEPT} onChange={setFile} disabled={busy} loading={Boolean(busy)} />}
    </div> : <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      <div><dt className="text-xs text-gray-600">เลขที่ใบกำกับภาษี</dt><dd className="font-medium">{bill.taxInvoiceNumber ?? '—'}</dd></div>
      <div><dt className="text-xs text-gray-600">วันที่ใบกำกับภาษี</dt><dd className="font-medium">{bill.taxInvoiceDate ? formatThaiDate(bill.taxInvoiceDate) : '—'}</dd></div>
    </dl>}
    <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {editable && (bill.attachmentId || canUpload) && <button className={btnClass} disabled={busy || !taxInvoiceNumber.trim() || !taxInvoiceDate || (!file && !bill.attachmentId)} aria-busy={Boolean(busy)} onClick={() => void saveEvidence()}>{busy ? 'กำลังบันทึก...' : 'บันทึกหลักฐาน'}</button>}
      {bill.attachmentId && canReadAttachment && <button className={ghostClass} disabled={busy || previewLoading} aria-busy={Boolean(previewLoading)} onClick={() => void openAttachment()}>{previewLoading ? 'กำลังเปิด...' : 'เปิดไฟล์หลักฐาน'}</button>}
      {reviewable && <button className={btnClass + ' bg-green-600 hover:bg-green-700'} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void review('VERIFIED')}>ยืนยันหลักฐาน</button>}
      {canReview && ['DRAFT', 'NEEDS_REVIEW'].includes(bill.status) && <button className={dangerClass + ' order-last sm:order-none'} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void review('REJECTED')}>ปฏิเสธหลักฐาน</button>}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-error-700">{error}</p>}
  </section>
  {attachmentPreview && <DocumentPreviewModal
    source={attachmentPreview}
    closeLabel="ปิด"
    loadingLabel="กำลังเปิดเอกสาร..."
    errorLabel="แสดงไฟล์หลักฐานไม่สำเร็จ กรุณาลองใหม่"
    retryLabel="ลองอีกครั้ง"
    openNewTabLabel="เปิดในแท็บใหม่"
    onClose={closeAttachmentPreview}
    onRetry={previewTarget ? () => loadAttachmentPreview(previewTarget) : undefined}
  />}
  </>;
}

function CreateVendorBillForm({ companyId, canCreate, onCreated }: { companyId: string; canCreate: boolean; onCreated: (id: string) => void }) {
  const toast = useToast();
  // Owner report 2026-09-20: this posted `useBranchFilter()`'s branch, which is blank under the
  // all-branches read filter by design, so a multi-branch company met 422 TRANSACTION_BRANCH_REQUIRED
  // with no control to answer it. Same field and same client-side refusal as the accounting draft form.
  const createBranchId = useTransactionCreateBranchId();
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState('');
  const [context, setContext] = useState<TransactionTaxContext>('DOMESTIC_PURCHASE');
  const [billDate, setBillDate] = useState(todayCivilDate());
  const [dueDate, setDueDate] = useState(todayCivilDate());
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [externalTaxCode, setExternalTaxCode] = useState<string>();
  const [vatRate, setVatRate] = useState('');
  const [vatMode, setVatMode] = useState<'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT'>('NO_VAT');
  const [busy, setBusy] = useState(false);
  const [suppliersLoading, setSuppliersLoading] = useState(canCreate);
  const [error, setError] = useState('');
  const [submitErrorRevision, setSubmitErrorRevision] = useState(0);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (submitErrorRevision === 0) return;
    errorSummaryRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    errorSummaryRef.current?.focus({ preventScroll: true });
  }, [submitErrorRevision]);
  useEffect(() => {
    if (!canCreate) return;
    const loadSuppliers = async () => {
      setSuppliersLoading(true);
      try {
        const result = await listSuppliers(companyId, { status: 'ACTIVE', pageSize: 100 });
        const rows = result.data ?? [];
        setSuppliers(rows); setSupplierId((current) => current || rows[0]?.id || '');
      } catch (cause) {
        setError(err(cause));
      } finally {
        setSuppliersLoading(false);
      }
    };
    void loadSuppliers();
  }, [canCreate, companyId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!createBranchId) throw new Error('กรุณาเลือกสาขาของรายการ');
      const created = await createVendorBill(companyId, {
        supplierId, branchId: createBranchId, billDate, dueDate, currency: 'THB', vatMode,
        supplierDocumentNumber: supplierDocumentNumber.trim() || undefined,
        matchingMode: 'NONE',
        pp36Candidate: context === 'IMPORT_SERVICE',
        lines: [{ lineNumber: 1, description, quantity, unitPrice, vatMode, vatRate: vatRate || undefined, inputVatClaimStatus: definitionId ? 'NEEDS_REVIEW' : 'NON_CLAIMABLE', taxCodeDefinitionId: definitionId || undefined, externalTaxCode, transactionContext: context }],
      });
      onCreated(created.id);
      toast.success('บันทึกบิลผู้ขายฉบับร่างแล้ว');
    } catch (cause) { setError(err(cause)); setSubmitErrorRevision((current) => current + 1); } finally { setBusy(false); }
  }
  const amount = String(Number(quantity || 0) * Number(unitPrice || 0));
  return <details className="rounded-xl border border-gray-200 bg-white p-4" open>
    <summary className="cursor-pointer font-bold text-gray-900">บันทึกบิลผู้ขาย</summary>
    {error && <div ref={errorSummaryRef} role="alert" tabIndex={-1} className="mt-3 scroll-mt-[calc(var(--app-header-h)+1rem)] rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{error}</div>}
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
      <div className="sm:col-span-2">
        <TransactionBranchField value={createBranchId} invalid={!createBranchId} hint="สาขาของกิจการเราที่รับบิลนี้ ไม่ใช่สาขาของผู้ขายที่พิมพ์อยู่บนบิล" />
      </div>
      <div className="space-y-1">
        <label htmlFor="vendor-bill-supplier" className="block text-sm font-medium text-gray-700">ผู้ขาย</label>
        <ThemedSelect id="vendor-bill-supplier" aria-label="ผู้ขาย" value={supplierId} disabled={!canCreate || suppliersLoading} onChange={(event) => setSupplierId(event.target.value)}>{suppliersLoading ? <option value="">กำลังโหลด...</option> : suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.displayNameSnapshot}</option>)}</ThemedSelect>
      </div>
      <div className="space-y-1">
        <label htmlFor="vendor-bill-context" className="block text-sm font-medium text-gray-700">ประเภทการซื้อ</label>
        <ThemedSelect id="vendor-bill-context" aria-label="ประเภทการซื้อ" value={context} onChange={(event) => { setContext(event.target.value as TransactionTaxContext); setDefinitionId(''); setExternalTaxCode(undefined); setVatRate(''); setVatMode('NO_VAT'); }}><option value="DOMESTIC_PURCHASE">ซื้อในประเทศ</option><option value="IMPORT_GOODS">นำเข้าสินค้า</option><option value="IMPORT_SERVICE">บริการต่างประเทศ / ภ.พ.36</option></ThemedSelect>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor="vendor-bill-source-number" className="block text-sm font-medium text-gray-700">เลขที่เอกสารผู้ขาย (ถ้ามี)</label>
        <input id="vendor-bill-source-number" name="supplierDocumentNumber" className={inputClass} value={supplierDocumentNumber} onChange={(event) => setSupplierDocumentNumber(event.target.value)} maxLength={80} disabled={!canCreate || busy} aria-describedby="vendor-bill-source-number-help" placeholder="เช่น INV-001" />
        <p id="vendor-bill-source-number-help" className="text-sm text-gray-500">หากไม่มีเลขให้เว้นว่าง เลขนี้ไม่แทนเลขที่ใบกำกับภาษีในส่วนหลักฐานภาษี</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="vendor-bill-date" className="block text-sm font-medium text-gray-700">วันที่เอกสาร</label>
        <ThemedDate id="vendor-bill-date" className={inputClass} value={billDate} onChange={(event) => setBillDate(event.target.value)} required />
      </div>
      <div className="space-y-1">
        <label htmlFor="vendor-bill-due-date" className="block text-sm font-medium text-gray-700">วันที่ครบกำหนดชำระ</label>
        <ThemedDate id="vendor-bill-due-date" className={inputClass} value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor="vendor-bill-description" className="block text-sm font-medium text-gray-700">รายละเอียดสินค้า/บริการ</label>
        <input id="vendor-bill-description" className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="รายละเอียด" required />
      </div>
      <div className="space-y-1">
        <label htmlFor="vendor-bill-quantity" className="block text-sm font-medium text-gray-700">จำนวน</label>
        <input id="vendor-bill-quantity" className={inputClass} type="number" step="0.0001" min="0" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
      </div>
      <div className="space-y-1">
        <label htmlFor="vendor-bill-unit-price" className="block text-sm font-medium text-gray-700">ราคาต่อหน่วย (บาท)</label>
        <input id="vendor-bill-unit-price" className={inputClass} type="number" step="0.01" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} required />
      </div>
      <div className="sm:col-span-2"><TransactionTaxLineSelector companyId={companyId} branchId={createBranchId || undefined} sourceType="procurement.vendor_bill" sourceId="new-vendor-bill" sourceLineId="line-1" transactionContext={context} direction={context === 'IMPORT_SERVICE' ? 'SELF_ASSESSED' : 'INPUT'} documentDate={billDate} netAmount={amount} grossAmount={amount} value={definitionId} onChange={(id, definition) => { setDefinitionId(id); setExternalTaxCode(definition?.externalCode); setVatRate(definition?.rate ?? ''); setVatMode(context === 'IMPORT_SERVICE' || !definition || definition.calculationMethod === 'NONE' ? 'NO_VAT' : definition.treatment === 'EXEMPT' ? 'EXEMPT' : definition.calculationMethod === 'INCLUSIVE' ? 'VAT_INCLUDED' : 'VAT_EXCLUDED'); }} /></div>
      {['IMPORT_GOODS', 'IMPORT_SERVICE'].includes(context) && <p className="text-xs text-amber-700 sm:col-span-2">รายการนำเข้าจะอยู่สถานะ pending evidence จนแนบและยืนยันหลักฐานในหน้า Tax Evidence</p>}
      <button disabled={!canCreate || busy || !supplierId || !description} aria-busy={Boolean(busy)} className={`${btnClass} sm:col-span-2`}>{busy ? 'กำลังบันทึก...' : 'บันทึกฉบับร่าง'}</button>
    </form>
  </details>;
}

// ── H-07 Approval Policy (maker-checker) ─────────────────────────────────────
function ApprovalPolicyPanel({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const toast = useToast();
  const [allowSelfApproval, setAllowSelfApproval] = useState(false);
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoaded(false);
      setError(null);
      try {
        const policy = await getApprovalPolicy(companyId);
        setAllowSelfApproval(policy.allowSelfApproval);
        setThreshold(policy.dualApprovalThresholdAmount ? String(Number(policy.dualApprovalThresholdAmount)) : '');
        setLoaded(true);
      } catch (cause) {
        setError(err(cause));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [companyId]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await updateApprovalPolicy(companyId, { allowSelfApproval, dualApprovalThresholdAmount: threshold.trim() ? threshold.trim() : null });
      toast.success('บันทึกนโยบายการอนุมัติแล้ว');
    } catch (cause) { setError(err(cause)); } finally { setBusy(false); }
  };

  return <details className="rounded border border-gray-200 bg-white p-4">
    <summary className="cursor-pointer text-sm font-medium">นโยบายการอนุมัติ (maker-checker)</summary>
    {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
    {loading ? <LoadingState label="กำลังโหลด..." /> : loaded && <div className="mt-3 space-y-3 text-sm">
      {canManage ? <>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allowSelfApproval} onChange={(event) => setAllowSelfApproval(event.target.checked)} />
          อนุญาตให้ผู้ส่งขออนุมัติบิลอนุมัติเองได้ทุก role (ค่าเริ่มต้น: OWNER/ADMIN/MANAGER อนุมัติเองได้อยู่แล้ว role อื่นต้องมีผู้อนุมัติคนละคนกับผู้ส่ง)
        </label>
        <label className="flex items-center gap-2">
          ยอดบิลตั้งแต่
          <input className={inputClass + ' max-w-40'} type="number" min="0" step="0.01" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="ปิดใช้งาน" />
          บาทขึ้นไป ต้องมีผู้อนุมัติ 2 คน (เว้นว่าง = ปิดใช้งาน)
        </label>
        <button className={btnClass + ' text-xs py-1 px-3'} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void save()}>{busy ? 'กำลังบันทึก...' : 'บันทึกนโยบาย'}</button>
      </> : <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-xs text-gray-500">อนุมัติรายการของตนเอง</dt><dd className="font-medium">{allowSelfApproval ? 'อนุญาต' : 'ไม่อนุญาต'}</dd></div>
        <div><dt className="text-xs text-gray-500">เกณฑ์ผู้อนุมัติ 2 คน</dt><dd className="font-medium">{threshold ? `ตั้งแต่ ${Number(threshold).toLocaleString('th-TH')} บาท` : 'ปิดใช้งาน'}</dd></div>
      </dl>}
    </div>}
  </details>;
}

// ── Vendor Bill List ──────────────────────────────────────────────────────────
function VendorBillList({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [data, setData] = useState<VendorBillSummary[]>([]);
  const [selected, setSelected] = useState<VendorBillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [openingBillId, setOpeningBillId] = useState<string | null>(null);
  const billOpenPendingRef = useRef(false);
  const billOpenRequestRef = useRef(0);
  const branch = useBranchFilter();
  const branchId = branch?.branchId || undefined;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listVendorBills(companyId, { status: statusFilter || undefined, branchId }); setData(r.data ?? []); }
    catch (e) {
      if (isBranchScope403(e, branchId)) { branch?.reportBranchForbidden(); return; }
      setError(err(e));
    }
    finally { setLoading(false); }
    // `branch` is deliberately absent: reportBranchForbidden is stable per companyId, which is here.
  }, [companyId, statusFilter, branchId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSelected(null);
    setDeepLinkLoading(false); setOpeningBillId(null);
    return () => { billOpenRequestRef.current += 1; billOpenPendingRef.current = false; };
  }, [companyId]);
  const openBill = useCallback(async (id: string) => {
    if (billOpenPendingRef.current) return;
    billOpenPendingRef.current = true;
    const requestId = ++billOpenRequestRef.current;
    setDeepLinkLoading(true); setOpeningBillId(id); setError(null);
    try {
      const bill = await getVendorBill(companyId, id);
      if (requestId === billOpenRequestRef.current) setSelected(bill);
    } catch (cause) {
      if (requestId === billOpenRequestRef.current) setError(err(cause));
    } finally {
      if (requestId === billOpenRequestRef.current) {
        billOpenPendingRef.current = false; setDeepLinkLoading(false); setOpeningBillId(null);
      }
    }
  }, [companyId]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('billId');
    if (!id) return;
    void openBill(id);
  }, [openBill]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null); setInfo(null);
    try {
      await fn();
      await load();
      if (selected?.id === id) setSelected(await getVendorBill(companyId, id));
      if (successMessage) toast.success(successMessage);
    } catch (e) {
      setError(err(e));
      await load();
      if (selected?.id === id) setSelected(await getVendorBill(companyId, id));
    } finally { setActionLoading(null); }
  };

  // H-07: a 200 from approve with the bill still PENDING_APPROVAL means a
  // partial dual approval was recorded — tell the approver explicitly.
  const approveWithFeedback = async (id: string) => {
    const result = await approveVendorBill(companyId, id);
    if (result?.status === 'PENDING_APPROVAL') {
      setInfo('บันทึกการอนุมัติของคุณแล้ว — บิลนี้ต้องมีผู้อนุมัติคนที่สองตามนโยบาย dual approval');
    } else toast.success('อนุมัติบิลเรียบร้อยแล้ว');
  };

  const rejectBill = async (id: string) => {
    const note = await promptInput({ title: 'ปฏิเสธบิล', label: 'เหตุผลปฏิเสธ' });
    if (!note) return;
    await action(id, () => rejectVendorBill(companyId, id, note), 'ปฏิเสธบิลเรียบร้อยแล้ว');
  };

  const voidBill = async (id: string) => {
    const reason = await promptInput({ title: 'ยกเลิกบิล', label: 'เหตุผลยกเลิก' });
    if (!reason) return;
    await action(id, () => voidVendorBill(companyId, id, reason), 'ยกเลิกบิลเรียบร้อยแล้ว');
  };

  return (
    <div className="space-y-4">
      <CreateVendorBillForm companyId={companyId} canCreate={permissions.includes('procurement.vendor_bill.create') && permissions.includes('procurement.vendor_bill.direct_entry')} onCreated={(id) => { void load(); void openBill(id); }} />
      {permissions.includes('procurement.approval_policy.read') && <ApprovalPolicyPanel companyId={companyId} canManage={permissions.includes('procurement.approval_policy.manage')} />}
      <div className="flex gap-2">
        <ThemedSelect className={inputClass + ' max-w-xs'} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(VB_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </ThemedSelect>
        <button className={ghostClass} onClick={load} disabled={loading} aria-busy={loading}>กรอง</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {info && <div className="rounded border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">{info}</div>}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">เลขที่บิล</th><th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">จับคู่</th><th className="px-4 py-3">ยอดสุทธิ</th>
                <th className="px-4 py-3">วันที่บิล</th><th className="px-4 py-3">ครบกำหนด</th>
                <th className="px-4 py-3">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((b) => (
                <tr key={b.id} className="cursor-pointer hover:bg-gray-50" aria-busy={openingBillId === b.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea') && actionLoading === null) void openBill(b.id); }}>
                  <td className="px-4 py-3 font-medium"><button type="button" className="text-left disabled:opacity-50" disabled={deepLinkLoading || actionLoading !== null} aria-busy={openingBillId === b.id} onClick={() => void openBill(b.id)}>{b.vendorBillNumber ?? b.supplierDocumentNumber ?? b.id.slice(0, 8)}</button></td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} map={VB_STATUS_LABELS} /></td>
                  <td className="px-4 py-3"><StatusBadge status={b.matchingStatus} map={MATCH_STATUS_LABELS} /></td>
                  <td className="px-4 py-3">{Number(b.netPayableAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-gray-500">{formatThaiDate(b.billDate)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatThaiDate(b.dueDate)}</td>
                  <td className="px-4 py-3 flex gap-1 flex-wrap">
                    {permissions.includes('procurement.vendor_bill.match') && b.purchaseOrderId && ['DRAFT', 'NEEDS_REVIEW'].includes(b.status) && (
                      <button className={ghostClass + ' text-xs py-1 px-2'} disabled={actionLoading === b.id} aria-busy={Boolean(actionLoading === b.id)} onClick={() => action(b.id, () => matchVendorBill(companyId, b.id), 'จับคู่บิลเรียบร้อยแล้ว')}>จับคู่</button>
                    )}
                    {permissions.includes('procurement.vendor_bill.create') && ['DRAFT', 'NEEDS_REVIEW'].includes(b.status) && (
                      <button className={btnClass + ' text-xs py-1 px-2'} title={isVendorBillTaxEvidenceBlocked(b) ? 'ต้องบันทึกและยืนยันหลักฐานภาษีซื้อก่อน' : undefined} disabled={actionLoading === b.id || isVendorBillTaxEvidenceBlocked(b)} aria-busy={Boolean(actionLoading === b.id)} onClick={() => action(b.id, () => submitVendorBill(companyId, b.id), 'ส่งขออนุมัติเรียบร้อยแล้ว')}>ส่งขออนุมัติ</button>
                    )}
                    {permissions.includes('procurement.vendor_bill.approve') && b.status === 'PENDING_APPROVAL' && <>
                      <button className={btnClass + ' text-xs py-1 px-2 bg-green-600 hover:bg-green-700'} title={isVendorBillTaxEvidenceBlocked(b) ? 'หลักฐานภาษีซื้อยังไม่ผ่านการยืนยัน' : undefined} disabled={actionLoading === b.id || isVendorBillTaxEvidenceBlocked(b)} aria-busy={Boolean(actionLoading === b.id)} onClick={() => action(b.id, () => approveWithFeedback(b.id))}>อนุมัติ</button>
                      <button className={dangerClass + ' text-xs py-1 px-2'} disabled={actionLoading === b.id} aria-busy={Boolean(actionLoading === b.id)} onClick={() => void rejectBill(b.id)}>ปฏิเสธ</button>
                    </>}
                    {permissions.includes('procurement.vendor_bill.void') && b.status === 'APPROVED' && (
                      <button className={dangerClass + ' text-xs py-1 px-2'} disabled={actionLoading === b.id} aria-busy={Boolean(actionLoading === b.id)} onClick={() => void voidBill(b.id)}>ยกเลิก</button>
                    )}
                    {permissions.includes('journal.entry.create') && permissions.includes('journal.entry.post') && ['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(b.status) && ['pending', 'not_required'].includes(b.postingStatus) && (
                      <button className={ghostClass + ' text-xs py-1 px-2'} disabled={actionLoading === b.id} aria-busy={Boolean(actionLoading === b.id)} onClick={() => action(b.id, () => generateSourceJournal(companyId, b.pp36Candidate ? 'procurement.vendor_bill.commercial' : 'procurement.vendor_bill', b.id), 'ลงบัญชีบิลเรียบร้อยแล้ว')}>ลงบัญชีบิล</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deepLinkLoading ? <LoadingState label="กำลังโหลด..." /> : selected && <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex justify-between gap-3"><div><strong>{selected.vendorBillNumber ?? selected.supplierDocumentNumber ?? selected.id}</strong><div className="text-xs text-gray-500">{selected.status} · {selected.supplierDisplayName ?? selected.supplierId}</div></div><span className="text-xs font-bold text-gray-500">{selected.status === 'DRAFT' || selected.status === 'NEEDS_REVIEW' ? 'Draft' : 'ล็อก Tax Snapshot แล้ว'}</span></div>
        <VendorBillTaxEvidencePanel
          companyId={companyId}
          bill={selected}
          canEdit={permissions.includes('procurement.vendor_bill.create')}
          canUpload={permissions.includes('attachment.create')}
          canReview={permissions.includes('procurement.vendor_bill.approve')}
          canReadAttachment={permissions.includes('attachment.read')}
          onUpdated={(updated) => { setSelected(updated); void load(); }}
        />
        <div className="mt-3 divide-y">{selected.lines.map((line) => { const taxContext = line.taxSnapshot?.taxContext; const evidenceHref = taxContext && ['IMPORT_GOODS', 'IMPORT_SERVICE'].includes(taxContext) ? `/companies/${companyId}/tax/evidence?${new URLSearchParams({ context: taxContext, sourceType: 'procurement.vendor_bill', sourceId: selected.id, sourceLineId: line.id })}` : null; return <div key={line.id} className="py-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{line.description}<small className="block font-mono text-gray-500">Line ID: {line.id}</small>{evidenceHref && <a className="text-xs font-bold text-brand-700 underline" href={evidenceHref}>แนบ/ตรวจหลักฐานภาษีบรรทัดนี้</a>}</span><span className="font-mono">{line.taxSnapshot?.externalTaxCode ?? 'No Tax Code'} {line.taxComponents?.length ? `· ${line.taxComponents.length} components` : ''}</span></div>{['PARTIALLY_PAID', 'PAID'].includes(selected.status) && taxContext === 'IMPORT_SERVICE' && <Pp36ClaimAction companyId={companyId} billId={selected.id} lineId={line.id} supplierId={selected.supplierId} canClaim={permissions.includes('tax.review_issue.resolve')} canPost={permissions.includes('journal.entry.create') && permissions.includes('journal.entry.post')} />}</div>; })}</div>
      </div>}
      {inputPromptDialog}
    </div>
  );
}

function CreateSupplierPaymentForm({ companyId, canCreate, onCreated }: { companyId: string; canCreate: boolean; onCreated: () => void }) {
  const toast = useToast();
  const [bills, setBills] = useState<VendorBillSummary[]>([]);
  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentEvidence, setPaymentEvidence] = useState<TradeTaxEvidenceDto[]>([]);
  const [paymentEvidenceIds, setPaymentEvidenceIds] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState(todayCivilDate());
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Withholding: blank means none. Kept as strings so a half-typed rate does not become 0.
  const [whtCategories, setWhtCategories] = useState<WhtIncomeCategoryOption[]>([]);
  const [whtCategoryCode, setWhtCategoryCode] = useState('');
  const [whtRate, setWhtRate] = useState('');
  const [whtAmount, setWhtAmount] = useState('');
  const attemptKey = useRef('');
  useEffect(() => {
    if (!canCreate) return;
    Promise.all([listVendorBills(companyId, { status: 'APPROVED', pageSize: 100 }), listVendorBills(companyId, { status: 'PARTIALLY_PAID', pageSize: 100 })])
      .then(([approved, partial]) => {
        const next = [...(approved.data ?? []), ...(partial.data ?? [])].filter((bill) => Number(bill.outstandingAmount) > 0);
        setBills(next); setBillId((current) => current || next[0]?.id || '');
      }).catch((cause) => setError(err(cause)));
    // An empty catalog is a valid state — the seeded categories are DRAFT until an accountant
    // activates them — so this failing must not block recording a plain payment.
    listWhtIncomeCategories(companyId).then(setWhtCategories).catch(() => setWhtCategories([]));
  }, [canCreate, companyId]);
  const bill = bills.find((item) => item.id === billId);
  const billWhtAmount = bill?.whtAmount ?? '0';
  const billCarriesWht = Number(billWhtAmount) > 0;
  const whtDisabled = billCarriesWht || whtCategories.length === 0;
  useEffect(() => {
    setAmount(bill?.outstandingAmount ?? '');
    setPaymentEvidenceIds([]);
    setWhtCategoryCode(''); setWhtRate(''); setWhtAmount('');
    attemptKey.current = '';
    if (!bill?.pp36Candidate) { setPaymentEvidence([]); return; }
    void listTradeTaxEvidence(companyId, { sourceType: 'procurement.vendor_bill', sourceId: bill.id, transactionContext: 'IMPORT_SERVICE', status: 'VERIFIED' })
      .then((rows) => setPaymentEvidence(rows.filter((item) => item.evidenceType === 'PAYMENT_EVIDENCE')))
      .catch((cause) => setError(err(cause)));
  }, [bill?.id, bill?.outstandingAmount, bill?.pp36Candidate, companyId]);
  const resetAttempt = () => { attemptKey.current = ''; };
  const withheldAmount = Math.max(0, Number(whtAmount) || 0);
  const netTransfer = Math.max(0, (Number(amount) || 0) - withheldAmount);
  // Suggested only when the whole outstanding is being cleared: on a partial payment there is no
  // single right answer for how much of the taxable base this instalment covers.
  const suggestWht = (rate: string) => {
    const base = Number(bill?.taxableAmount ?? '0');
    if (!bill || !rate || Number(amount) !== Number(bill.outstandingAmount) || !(base > 0)) return '';
    return ((base * Number(rate)) / 100).toFixed(2);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!bill) return;
    setBusy(true); setError('');
    try {
      const idempotencyKey = attemptKey.current || globalThis.crypto.randomUUID();
      attemptKey.current = idempotencyKey;
      // `amount` is the debt cleared; withholding comes off the cash, never off the settlement.
      const withheld = withheldAmount.toFixed(2);
      await createSupplierPayment(companyId, {
        idempotencyKey,
        supplierId: bill.supplierId, branchId: bill.branchId, paymentDate, method, currency: bill.currency,
        grossAmount: amount, whtAmount: withheld, netPaidAmount: netTransfer.toFixed(2),
        ...(withheldAmount > 0 ? { whtCategoryCode, whtRate } : {}),
        externalReference: reference || undefined,
        allocations: [{ vendorBillId: bill.id, amount, whtAmount: withheld, pp36PaymentEvidenceIds: bill.pp36Candidate ? paymentEvidenceIds : undefined }],
      });
      const remaining = Math.max(0, Number(bill.outstandingAmount) - Number(amount));
      setBills((rows) => remaining === 0 ? rows.filter((item) => item.id !== bill.id) : rows.map((item) => item.id === bill.id ? { ...item, status: 'PARTIALLY_PAID', paidAmount: String(Number(item.paidAmount) + Number(amount)), outstandingAmount: String(remaining) } : item));
      setReference(''); setPaymentEvidenceIds([]); attemptKey.current = ''; onCreated();
      toast.success('บันทึกจ่ายเจ้าหนี้เรียบร้อยแล้ว');
    } catch (cause) { setError(err(cause)); } finally { setBusy(false); }
  }
  const canSubmit = Boolean(bill) && canSubmitSupplierPayment({
    amount, outstandingAmount: bill?.outstandingAmount ?? '0',
    pp36Candidate: bill?.pp36Candidate ?? false, pp36PaymentEvidenceIds: paymentEvidenceIds,
    wht: { whtAmount, whtCategoryCode, whtRate, billWhtAmount },
  });
  return <details className="rounded-xl border border-gray-200 bg-white p-4" open>
    <summary className="cursor-pointer font-bold text-gray-900">บันทึกจ่ายเจ้าหนี้</summary>
    {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
      <ThemedSelect value={billId} onChange={(event) => { setBillId(event.target.value); resetAttempt(); }} required>
        <option value="">เลือก Vendor Bill</option>
        {bills.map((item) => <option key={item.id} value={item.id}>{item.vendorBillNumber ?? item.supplierDocumentNumber ?? item.id.slice(0, 8)} · {item.outstandingAmount} {item.currency}{item.pp36Candidate ? ' · ภ.พ.36' : ''}</option>)}
      </ThemedSelect>
      <ThemedDate className={inputClass} value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); resetAttempt(); }} required />
      <input className={inputClass} type="number" min="0.01" step="0.01" max={bill?.outstandingAmount} value={amount} onChange={(event) => { setAmount(event.target.value); resetAttempt(); }} placeholder="ยอดจ่ายครั้งนี้" required />
      <ThemedSelect value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod); resetAttempt(); }}><option value="BANK_TRANSFER">โอนเงิน</option><option value="CASH">เงินสด</option><option value="CHEQUE">เช็ค</option><option value="CARD">บัตร</option><option value="OTHER">อื่น ๆ</option></ThemedSelect>
      <input className={inputClass} value={reference} onChange={(event) => { setReference(event.target.value); resetAttempt(); }} placeholder="เลขอ้างอิงการจ่าย" required={method === 'BANK_TRANSFER' || method === 'CHEQUE'} />
      <fieldset className="sm:col-span-2 rounded border border-gray-200 p-3" disabled={whtDisabled}>
        <legend className="px-1 text-xs font-bold text-gray-700">หัก ณ ที่จ่าย</legend>
        {billCarriesWht
          ? <p className="text-xs text-gray-600">ใบแจ้งหนี้นี้หักภาษี ณ ที่จ่ายไว้แล้วตอนตั้งหนี้ ({billWhtAmount}) จึงหักซ้ำที่การจ่ายไม่ได้</p>
          : whtCategories.length === 0
            ? <p className="text-xs text-amber-800">ยังไม่มีหมวดเงินได้ที่เปิดใช้งาน — ให้ผู้ทำบัญชีตรวจและเปิดใช้หมวดก่อนจึงจะหักภาษี ณ ที่จ่ายได้</p>
            : <div className="grid gap-3 sm:grid-cols-3">
              <ThemedSelect
                aria-label="หมวดเงินได้"
                value={whtCategoryCode}
                onChange={(event) => {
                  const code = event.target.value;
                  const picked = whtCategories.find((item) => item.code === code);
                  const rate = picked ? String(Number(picked.defaultRate)) : '';
                  setWhtCategoryCode(code); setWhtRate(rate);
                  setWhtAmount(code ? suggestWht(rate) : '');
                  resetAttempt();
                }}
              >
                <option value="">ไม่หักภาษี</option>
                {whtCategories.map((item) => <option key={item.code} value={item.code}>{item.nameTh} · {Number(item.defaultRate)}% · {item.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}</option>)}
              </ThemedSelect>
              <input
                className={inputClass} type="number" min="0" max="100" step="0.0001" aria-label="อัตราหัก ณ ที่จ่าย (%)"
                value={whtRate} placeholder="อัตรา %" disabled={!whtCategoryCode}
                onChange={(event) => { setWhtRate(event.target.value); setWhtAmount(suggestWht(event.target.value)); resetAttempt(); }}
              />
              <input
                className={inputClass} type="number" min="0" step="0.01" aria-label="ยอดภาษีหัก ณ ที่จ่าย"
                value={whtAmount} placeholder="ยอดหัก" disabled={!whtCategoryCode}
                onChange={(event) => { setWhtAmount(event.target.value); resetAttempt(); }}
              />
              <p className="sm:col-span-3 text-xs text-gray-600">
                ตัดหนี้ {Number(amount) || 0} · หัก {withheldAmount} · <strong>โอนจริง {netTransfer.toFixed(2)}</strong>
                {' '}— ยอดหักที่เสนอคิดจากฐานก่อน VAT ของใบแจ้งหนี้ ปรับได้
              </p>
              {/* Without this the submit button just goes dead — most often after the operator
                  lowers the paid amount below a withholding suggested for the full outstanding. */}
              {!isSupplierPaymentWithholdingValid(Number(amount) || 0, { whtAmount, whtCategoryCode, whtRate, billWhtAmount })
                && <p className="sm:col-span-3 text-xs font-bold text-error-600">ยอดหักต้องมากกว่า 0 และน้อยกว่ายอดตัดหนี้ พร้อมระบุหมวดเงินได้และอัตรา 0–100%</p>}
            </div>}
      </fieldset>
      {bill?.pp36Candidate && <div className="sm:col-span-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <p>เลือก PAYMENT_EVIDENCE ที่ยืนยันแล้วสำหรับยอดจ่ายครั้งนี้; PP36_RECEIPT ใช้ปล่อยสิทธิภาษีซื้อภายหลัง</p>
        <div className="mt-2 grid gap-2">{paymentEvidence.map((item) => <label key={item.id} className="flex gap-2"><input type="checkbox" checked={paymentEvidenceIds.includes(item.id)} onChange={(event) => { setPaymentEvidenceIds((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)); resetAttempt(); }} />{item.referenceNumber} · {item.evidenceDate}</label>)}</div>
        {!paymentEvidence.length && <a className="mt-2 inline-block font-bold text-brand-700 underline" href={`/companies/${companyId}/tax/evidence?${new URLSearchParams({ context: 'IMPORT_SERVICE', sourceType: 'procurement.vendor_bill', sourceId: bill.id })}`}>แนบและยืนยัน PAYMENT_EVIDENCE ก่อนจ่าย</a>}
      </div>}
      <button disabled={!canCreate || busy || !canSubmit} aria-busy={Boolean(busy)} className={`${btnClass} sm:col-span-2`}>{busy ? 'กำลังบันทึก...' : `บันทึกจ่าย ${amount || '0'} ${bill?.currency ?? ''}`}</button>
    </form>
  </details>;
}

// ── Supplier Payment List ─────────────────────────────────────────────────────
function SupplierPaymentList({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [data, setData] = useState<SupplierPaymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listSupplierPayments(companyId); setData(r.data ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setActionLoading(null); }
  };

  const voidPayment = async (id: string) => {
    const reason = await promptInput({ title: 'ยกเลิกการจ่าย', label: 'เหตุผลยกเลิก' });
    if (!reason) return;
    await action(id, () => voidSupplierPayment(companyId, id, reason), 'ยกเลิกการจ่ายเรียบร้อยแล้ว');
  };

  return (
    <div className="space-y-4">
      <CreateSupplierPaymentForm companyId={companyId} canCreate={permissions.includes('procurement.supplier_payment.create') && permissions.includes('procurement.supplier_payment.release')} onCreated={() => void load()} />
      <div className="flex justify-end"><button className={ghostClass} onClick={load} disabled={loading} aria-busy={loading}>รีเฟรช</button></div>
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr><th className="px-4 py-3">เลขที่</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">ยอดจ่าย</th><th className="px-4 py-3">วิธีจ่าย</th><th className="px-4 py-3">วันที่</th><th className="px-4 py-3">การกระทำ</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.paymentNumber ?? p.id.slice(0, 8)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} map={PAYMENT_STATUS_LABELS} /></td>
                  <td className="px-4 py-3">
                    {Number(p.netPaidAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
                    {/* The column is cash out. When tax was withheld that differs from the debt
                        cleared, and hiding the gap makes the payment look short against the bill. */}
                    {Number(p.whtAmount) > 0 && <small className="block text-xs text-gray-500">
                      ตัดหนี้ {Number(p.grossAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} · หัก ณ ที่จ่าย {Number(p.whtAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </small>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.method}</td>
                  <td className="px-4 py-3 text-gray-500">{formatThaiDate(p.paymentDate)}</td>
                  <td className="px-4 py-3 flex gap-1">
                    {permissions.includes('journal.entry.create') && permissions.includes('journal.entry.post') && p.status === 'RECORDED' && ['pending', 'not_required'].includes(p.postingStatus) && <button className={ghostClass + ' text-xs py-1 px-2'} disabled={actionLoading === p.id} aria-busy={Boolean(actionLoading === p.id)} onClick={() => action(p.id, () => generateSourceJournal(companyId, 'procurement.supplier_payment', p.id), 'ลงบัญชีการจ่ายเรียบร้อยแล้ว')}>ลงบัญชี</button>}
                    {permissions.includes('journal.entry.create') && permissions.includes('journal.entry.post') && p.status === 'RECORDED' && p.pp36RecognitionStatus === 'ACTIVE' && <button className={ghostClass + ' text-xs py-1 px-2'} disabled={actionLoading === p.id} aria-busy={Boolean(actionLoading === p.id)} onClick={() => action(p.id, () => generateSourceJournal(companyId, 'procurement.supplier_payment.pp36', p.id), 'ลงบัญชี ภ.พ.36 เรียบร้อยแล้ว')}>ลงบัญชี ภ.พ.36</button>}
                    {permissions.includes('procurement.supplier_payment.void') && p.status === 'RECORDED' && <button className={dangerClass + ' text-xs py-1 px-2'} disabled={actionLoading === p.id} aria-busy={Boolean(actionLoading === p.id)} onClick={() => void voidPayment(p.id)}>ยกเลิก</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inputPromptDialog}
    </div>
  );
}

// ── AP Aging ──────────────────────────────────────────────────────────────────
function ApAgingPanel({ companyId }: { companyId: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    getApAging(companyId).then(setData).catch(e => setError(err(e))).finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const buckets = [
    { key: 'not_due', label: 'ยังไม่ถึงกำหนด' },
    { key: '0_30', label: '0–30 วัน' },
    { key: '31_60', label: '31–60 วัน' },
    { key: '61_90', label: '61–90 วัน' },
    { key: '91_plus', label: '91+ วัน' },
  ];
  const suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  const bucketTotals = buckets.map((_, index) => suppliers.reduce((sum: number, row: any) => sum + Number(row.buckets?.[index]?.amount ?? 0), 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-lg font-medium text-gray-900">AP Aging ณ วันที่ {data.asOfDate}</h2>
        <div className="text-sm text-gray-500">ยอดค้างชำระรวม: <span className="font-semibold text-gray-900">{Number(data.totalOutstanding ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span></div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {buckets.map((b, index) => {
          return (
            <div key={b.key} className="rounded border border-gray-200 p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">{b.label}</div>
              <div className="text-lg font-semibold text-gray-900">{bucketTotals[index].toLocaleString('th-TH', { minimumFractionDigits: 0 })}</div>
            </div>
          );
        })}
      </div>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr><th className="px-4 py-3">ผู้จำหน่าย</th><th className="px-4 py-3">ยอดค้างชำระ</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {suppliers.length === 0 ? <tr><td colSpan={2} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : suppliers.map((s: any) => (
              <tr key={s.supplierId} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{s.supplierDisplayName}</td>
                <td className="px-4 py-3">{Number(s.totalOutstanding ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ACCOUNTS_PAYABLE_TAB_LABELS: Record<AccountsPayableTab, string> = {
  bills: 'ใบวางบิล',
  payments: 'การชำระเงิน',
  wht: 'หนังสือรับรองหัก ณ ที่จ่าย',
  aging: 'AP Aging',
};


// ── 50 ทวิ external handoff ───────────────────────────────────────────────────
//
// The system cannot issue the withholding certificate itself while its statutory render is still
// behind a specialist gate. Rather than refuse, it hands the operator everything it already knows
// so the certificate can be issued externally and linked back. Nothing here is re-keyed, and a
// field the system could not derive is shown as blank rather than guessed.
const WHT_HANDOFF_STATUS_LABELS: Record<string, string> = {
  REQUIRED: 'รอออกเอกสารภายนอก',
  EXTERNAL_LINKED: 'แนบเอกสารแล้ว',
  SYSTEM_ISSUED: 'ระบบออกให้แล้ว',
  CANCELLED: 'ยกเลิก',
};

function WhtHandoffPanel({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const canLink = permissions.includes('wht.external_certificate.link');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData((await listWhtHandoffs(companyId)) ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        ระบบจะออกหนังสือรับรองหัก ณ ที่จ่ายให้ภายนอก แล้วแนบเข้ามาได้ — ข้อมูลการจ่ายและภาษีถูกบันทึกไว้แล้ว ไม่ต้องกรอกซ้ำ
      </div>
      <div className="flex justify-end"><button type="button" className={`${ghostClass} min-h-11 min-w-11`} onClick={load} disabled={loading} aria-busy={loading}>รีเฟรช</button></div>
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr><th className="px-4 py-3">ผู้รับเงิน</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">ยอดจ่าย</th><th className="px-4 py-3">ภาษีหัก</th><th className="px-4 py-3">แบบ</th><th className="px-4 py-3">วันที่จ่าย</th><th className="px-4 py-3">การกระทำ</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการที่ต้องออกหนังสือรับรอง</td></tr> : data.map((h: any) => (
                <Fragment key={h.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{h.prefill?.payeeSnapshot?.name ?? '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={h.status} map={WHT_HANDOFF_STATUS_LABELS} /></td>
                    <td className="px-4 py-3">{Number(h.prefill?.grossAmount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</td>
                    <td className="px-4 py-3">{Number(h.prefill?.withheldAmount ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</td>
                    <td className="px-4 py-3 text-gray-500">{h.prefill?.formType ?? <span className="text-amber-700">ต้องระบุ</span>}</td>
                    <td className="px-4 py-3 text-gray-500">{h.prefill?.paymentDate ? formatThaiDate(h.prefill.paymentDate) : '-'}</td>
                    <td className="px-4 py-3">
                      <button
                        id={`wht-handoff-toggle-${h.id}`}
                        type="button"
                        className={`${ghostClass} min-h-11 min-w-11 px-2 text-xs`}
                        aria-expanded={openId === h.id}
                        aria-controls={`wht-handoff-detail-${h.id}`}
                        onClick={() => setOpenId(openId === h.id ? null : h.id)}
                      >
                        {openId === h.id ? 'ปิด' : 'ดูข้อมูลสำหรับออกเอกสาร'}
                      </button>
                    </td>
                  </tr>
                  {openId === h.id && (
                    <tr><td colSpan={7} className="bg-gray-50 px-4 py-4">
                      <div
                        id={`wht-handoff-detail-${h.id}`}
                        role="region"
                        aria-label={`ข้อมูลหนังสือรับรองของ ${h.prefill?.payeeSnapshot?.name ?? 'ผู้รับเงิน'}`}
                      >
                        <WhtHandoffDetail companyId={companyId} handoff={h} canLink={canLink} permissions={permissions} onLinked={() => { setOpenId(null); void load(); }} onStale={() => void load()} />
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WhtHandoffDetail({ companyId, handoff, canLink, permissions, onLinked, onStale }: { companyId: string; handoff: any; canLink: boolean; permissions: readonly string[]; onLinked: () => void; onStale: () => void }) {
  const [number, setNumber] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [issuedDate, setIssuedDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §10: the payee address the frozen prefill never had. Its own small form, not part of the link
  // submit — the address is useful long before the external certificate exists.
  const [addressDraft, setAddressDraft] = useState('');
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressNotice, setAddressNotice] = useState<string | null>(null);
  // §4.1: issuing in the system. Nothing ever populates WhtCertificate.pdfAttachmentId — the mint
  // response is the only place the PDF bytes ever exist — so the artifact is kept in memory only
  // long enough to offer a second download in this same screen session, never persisted or refetched.
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issuedPdf, setIssuedPdf] = useState<{ certificateNumber: string; fileName: string; mimeType: string; contentBase64: string } | null>(null);
  // Correction & replacement plan §5.1: same "download immediately, keep in memory for a same-session
  // re-download" shape as `issuedPdf` above — no PDF is ever persisted server-side.
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [correctedPdf, setCorrectedPdf] = useState<{ certificateNumber: string; fileName: string; mimeType: string; contentBase64: string } | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const p = handoff.prefill ?? {};
  // Prefill from the handoff's own frozen facts — the only certificate content this screen already
  // has (no GET-certificate-by-id endpoint exists to re-read what a prior correction changed).
  const [correctForm, setCorrectForm] = useState(() => ({
    incomeCategoryCode: p.incomeCategoryCode ?? '', incomeCategoryName: p.incomeCategoryName ?? '',
    whtRate: p.whtRate ?? '', grossAmount: p.grossAmount ?? '', withheldAmount: p.withheldAmount ?? '',
    paymentDate: p.paymentDate ? p.paymentDate.slice(0, 10) : '', formType: p.formType ?? 'PND53',
    payeeName: p.payeeSnapshot?.name ?? '', payeeTaxId: p.payeeSnapshot?.taxId ?? '',
    payeeAddress: p.payeeSnapshot?.address ?? '', payeeBranchCode: p.payeeSnapshot?.branchCode ?? '',
    reason: '',
  }));
  const linked = handoff.status === 'EXTERNAL_LINKED';
  // Drift found while reading the real code (spec §4.1 note): this used to check only
  // EXTERNAL_LINKED, so a SYSTEM_ISSUED row still showed the "แนบเอกสารที่ออกภายนอก" form.
  const issued = handoff.status === 'SYSTEM_ISSUED';
  const payeeAddress = whtHandoffPayeeAddress(handoff, canLink);

  const doIssue = async () => {
    setIssuing(true); setIssueError(null);
    try {
      const result = await issueSystemWhtCertificate(companyId, handoff.id);
      downloadArtifact(result.pdfArtifact);
      setIssuedPdf({ certificateNumber: result.certificateNumber, ...result.pdfArtifact });
      // Reload the list (not `onLinked`, which also collapses this panel) — the row must stay open
      // so the "issued" banner and the re-download button below can actually be seen.
      onStale();
    } catch (e) {
      setIssueError(err(e));
    } finally { setIssuing(false); }
  };

  const doCorrect = async () => {
    setCorrectBusy(true); setCorrectError(null);
    try {
      const result = await correctSystemWhtCertificate(companyId, handoff.id, {
        corrected: {
          formType: correctForm.formType as 'PND3' | 'PND53',
          incomeCategoryCode: correctForm.incomeCategoryCode || undefined,
          incomeCategoryName: correctForm.incomeCategoryName || undefined,
          whtRate: correctForm.whtRate || undefined,
          grossAmount: correctForm.grossAmount || undefined,
          withheldAmount: correctForm.withheldAmount || undefined,
          paymentDate: correctForm.paymentDate ? new Date(correctForm.paymentDate).toISOString() : undefined,
          payeeSnapshot: {
            name: correctForm.payeeName || undefined,
            taxId: correctForm.payeeTaxId || undefined,
            address: correctForm.payeeAddress || undefined,
            branchCode: correctForm.payeeBranchCode || undefined,
          },
        },
        reason: correctForm.reason.trim(),
      });
      downloadArtifact(result.pdfArtifact);
      setCorrectedPdf({ certificateNumber: result.certificateNumber, ...result.pdfArtifact });
      setCorrectOpen(false);
      onStale();
    } catch (e) {
      setCorrectError(err(e));
    } finally { setCorrectBusy(false); }
  };

  const doReplace = async () => {
    setReplaceBusy(true); setReplaceError(null);
    try {
      const result = await issueSystemWhtReplacementCopy(companyId, handoff.id);
      downloadArtifact(result.pdfArtifact);
      onStale();
    } catch (e) {
      setReplaceError(err(e));
    } finally { setReplaceBusy(false); }
  };

  const saveAddress = async () => {
    setAddressBusy(true); setAddressError(null); setAddressNotice(null);
    try {
      const saved = await setWhtHandoffPayeeAddress(companyId, handoff.id, { payeeAddress: addressDraft.trim() });
      // §8: the address is stored whether or not the registry took it. Saying so beats going quiet
      // and letting the next document prefill from a registry that never got the write.
      setAddressNotice(saved.counterpartyAutoSave?.failed
        ? 'บันทึกที่อยู่ในรายการนี้แล้ว แต่ยังไม่ได้บันทึกลงทะเบียนคู่ค้า ลองใหม่ได้จากหน้าคู่ค้า'
        : 'บันทึกที่อยู่ผู้รับเงินแล้ว');
      setAddressDraft('');
      onStale();
    } catch (e) {
      setAddressError(err(e));
      // The server refuses once the certificate exists, which means this row is stale on screen.
      if ((e as { code?: unknown } | null)?.code === 'wht_handoff_address_not_editable') onStale();
    } finally { setAddressBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await linkExternalWhtCertificate(companyId, handoff.id, {
        // Caller-stable so a retry after a dropped response replays instead of double-linking.
        commandId: `link:${handoff.id}:${number}`,
        externalCertificateNumber: number, externalEvidenceRef: evidenceRef, issuedDate,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onLinked();
    } catch (e) {
      // The server's conflict codes say more than the message does — in particular whether what is
      // on screen is now stale and must be refetched.
      const outcome = whtLinkErrorOutcome(e);
      setError(outcome.message);
      if (outcome.reload) onStale();
    } finally { setBusy(false); }
  };

  const Field = ({ label, value }: { label: string; value: unknown }) => (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value ? String(value) : <span className="text-amber-700">ไม่มีข้อมูล — ต้องระบุตอนออกเอกสาร</span>}</dd>
    </div>
  );

  const fieldId = (name: string) => `wht-handoff-${handoff.id}-${name}`;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">ข้อมูลสำหรับออกหนังสือรับรอง (คัดลอกไปใช้ได้)</h4>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Field label="ผู้จ่ายเงิน" value={p.payerSnapshot?.companyName} />
          <Field label="เลขประจำตัวผู้เสียภาษี (ผู้จ่าย)" value={p.payerSnapshot?.taxId} />
          <Field label="ที่อยู่ผู้จ่าย" value={p.payerSnapshot?.address} />
          <Field label="ผู้รับเงิน" value={p.payeeSnapshot?.name} />
          <Field label="เลขประจำตัวผู้เสียภาษี (ผู้รับ)" value={p.payeeSnapshot?.taxId} />
          <Field label="สาขา" value={p.payeeSnapshot?.branchCode} />
          <div className="sm:col-span-3">
            <dt className="text-xs text-gray-500" id={fieldId('payee-address-label')}>ที่อยู่ผู้รับเงิน</dt>
            <dd className="text-sm text-gray-900">
              {payeeAddress.text ? (
                <span className="whitespace-pre-line break-words">{payeeAddress.text}</span>
              ) : payeeAddress.canType ? (
                <div className="mt-1 flex flex-col gap-2">
                  <textarea
                    id={fieldId('payee-address')}
                    aria-labelledby={fieldId('payee-address-label')}
                    className={inputClass}
                    rows={2}
                    maxLength={500}
                    value={addressDraft}
                    onChange={(e) => setAddressDraft(e.target.value)}
                    placeholder="พิมพ์ที่อยู่ผู้รับเงินตามที่จะพิมพ์ลงหนังสือรับรอง"
                    disabled={addressBusy}
                  />
                  <button
                    type="button"
                    className={`${ghostClass} self-start`}
                    style={{ minHeight: 44, minWidth: 44 }}
                    aria-busy={addressBusy}
                    disabled={addressBusy || !addressDraft.trim()}
                    onClick={() => void saveAddress()}
                  >
                    {addressBusy ? 'กำลังบันทึก...' : 'บันทึกที่อยู่'}
                  </button>
                </div>
              ) : (
                // Same wording as every other empty field: a viewer without the mutation permission
                // gets a plain reading, never a control they cannot use.
                <span className="text-amber-700">ไม่มีข้อมูล — ต้องระบุตอนออกเอกสาร</span>
              )}
              {addressError && <div className="mt-2"><ErrorBanner message={addressError} /></div>}
              {addressNotice && <p role="status" aria-live="polite" className="mt-1 text-xs text-gray-600">{addressNotice}</p>}
            </dd>
          </div>
          <Field label="แบบ" value={p.formType} />
          <Field label="ประเภทเงินได้" value={p.incomeCategoryName ?? p.incomeCategoryCode} />
          <Field label="อัตราภาษี" value={p.whtRate} />
          <Field label="จำนวนเงินที่จ่าย" value={p.grossAmount} />
          <Field label="ภาษีที่หักไว้" value={p.withheldAmount} />
          <Field label="วันที่จ่าย" value={p.paymentDate ? formatThaiDate(p.paymentDate) : null} />
        </dl>
      </div>
      {issued ? (
        <div role="status" aria-live="polite" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <p>ระบบออกหนังสือรับรองให้แล้ว{(correctedPdf ?? issuedPdf) ? ` · เลขที่ ${(correctedPdf ?? issuedPdf)!.certificateNumber}` : ''}</p>
          {(correctedPdf ?? issuedPdf) && (
            <button type="button" className={`${ghostClass} mt-2`} style={{ minHeight: 44, minWidth: 44 }} onClick={() => downloadArtifact((correctedPdf ?? issuedPdf)!)}>
              ดาวน์โหลด PDF อีกครั้ง
            </button>
          )}
          {/* Correction & replacement plan §5.1: same block, gated by canCorrectWhtCertificate/
              canIssueWhtReplacementCopy — both axes (route-readiness + permission) already fold in. */}
          {canCorrectWhtCertificate(handoff, permissions) && (
            <div className="mt-3 border-t border-green-200 pt-3">
              <button
                type="button"
                className={`${ghostClass} min-h-11 min-w-11`}
                aria-expanded={correctOpen}
                aria-controls={fieldId('correct-form')}
                onClick={() => setCorrectOpen((value) => !value)}
              >
                {correctOpen ? 'ปิดฟอร์มแก้ไข' : 'แก้ไขหนังสือรับรอง'}
              </button>
              {correctOpen && (
                <form id={fieldId('correct-form')} className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void doCorrect(); }}>
                  <label className="block" htmlFor={fieldId('correct-income-code')}>
                    <span className="text-xs text-gray-600">รหัสประเภทเงินได้</span>
                    <input id={fieldId('correct-income-code')} className={inputClass} value={correctForm.incomeCategoryCode} onChange={(e) => setCorrectForm((f) => ({ ...f, incomeCategoryCode: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-income-name')}>
                    <span className="text-xs text-gray-600">ชื่อประเภทเงินได้</span>
                    <input id={fieldId('correct-income-name')} className={inputClass} value={correctForm.incomeCategoryName} onChange={(e) => setCorrectForm((f) => ({ ...f, incomeCategoryName: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-form-type')}>
                    <span className="text-xs text-gray-600">แบบ</span>
                    <ThemedSelect id={fieldId('correct-form-type')} className={inputClass} value={correctForm.formType} disabled={correctBusy} onChange={(e) => setCorrectForm((f) => ({ ...f, formType: e.target.value }))}>
                      <option value="PND3">ภ.ง.ด.3</option>
                      <option value="PND53">ภ.ง.ด.53</option>
                    </ThemedSelect>
                  </label>
                  <label className="block" htmlFor={fieldId('correct-rate')}>
                    <span className="text-xs text-gray-600">อัตราภาษี (%)</span>
                    <input id={fieldId('correct-rate')} className={inputClass} value={correctForm.whtRate} onChange={(e) => setCorrectForm((f) => ({ ...f, whtRate: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-gross')}>
                    <span className="text-xs text-gray-600">จำนวนเงินที่จ่าย</span>
                    <input id={fieldId('correct-gross')} className={inputClass} value={correctForm.grossAmount} onChange={(e) => setCorrectForm((f) => ({ ...f, grossAmount: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-withheld')}>
                    <span className="text-xs text-gray-600">ภาษีที่หักไว้</span>
                    <input id={fieldId('correct-withheld')} className={inputClass} value={correctForm.withheldAmount} onChange={(e) => setCorrectForm((f) => ({ ...f, withheldAmount: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-payment-date')}>
                    <span className="text-xs text-gray-600">วันที่จ่าย</span>
                    <ThemedDate id={fieldId('correct-payment-date')} className={inputClass} value={correctForm.paymentDate} onChange={(e) => setCorrectForm((f) => ({ ...f, paymentDate: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-payee-name')}>
                    <span className="text-xs text-gray-600">ชื่อผู้รับเงิน</span>
                    <input id={fieldId('correct-payee-name')} className={inputClass} value={correctForm.payeeName} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeName: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-payee-taxid')}>
                    <span className="text-xs text-gray-600">เลขประจำตัวผู้เสียภาษี (ผู้รับ)</span>
                    <input id={fieldId('correct-payee-taxid')} className={inputClass} value={correctForm.payeeTaxId} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeTaxId: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block" htmlFor={fieldId('correct-payee-branch')}>
                    <span className="text-xs text-gray-600">สาขา</span>
                    <input id={fieldId('correct-payee-branch')} className={inputClass} value={correctForm.payeeBranchCode} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeBranchCode: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block sm:col-span-2" htmlFor={fieldId('correct-payee-address')}>
                    <span className="text-xs text-gray-600">ที่อยู่ผู้รับเงิน</span>
                    <input id={fieldId('correct-payee-address')} className={inputClass} value={correctForm.payeeAddress} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeAddress: e.target.value }))} disabled={correctBusy} />
                  </label>
                  <label className="block sm:col-span-2" htmlFor={fieldId('correct-reason')}>
                    <span className="text-xs text-gray-600">เหตุผลที่แก้ไข (บังคับ)</span>
                    <input id={fieldId('correct-reason')} className={inputClass} value={correctForm.reason} onChange={(e) => setCorrectForm((f) => ({ ...f, reason: e.target.value }))} disabled={correctBusy} placeholder="เช่น พิมพ์ยอดผิด แก้ที่อยู่ผู้รับเงิน" />
                  </label>
                  {correctError && <div className="sm:col-span-2"><ErrorBanner message={correctError} /></div>}
                  <div className="sm:col-span-2">
                    <button type="submit" className={btnClass} style={{ minHeight: 44, minWidth: 44 }} aria-busy={correctBusy} disabled={correctBusy || !correctForm.reason.trim()}>
                      {correctBusy ? 'กำลังแก้ไข...' : 'ยืนยันแก้ไข'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          {canIssueWhtReplacementCopy(handoff, permissions) && (
            <div className="mt-3 border-t border-green-200 pt-3">
              {replaceError && <div className="mb-2"><ErrorBanner message={replaceError} /></div>}
              <button type="button" className={`${ghostClass} min-h-11 min-w-11`} aria-busy={replaceBusy} disabled={replaceBusy} onClick={() => void doReplace()}>
                {replaceBusy ? 'กำลังออกใบแทน...' : 'ออกใบแทน'}
              </button>
            </div>
          )}
        </div>
      ) : linked ? (
        <div role="status" aria-live="polite" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          แนบแล้ว: เลขที่ {handoff.externalCertificateNumber} · หลักฐาน {handoff.externalEvidenceRef}{handoff.externalIssuedDate ? ` · ออกเมื่อ ${formatThaiDate(handoff.externalIssuedDate)}` : ''}{handoff.linkNote ? ` · ${handoff.linkNote}` : ''}
        </div>
      ) : (
        <div className="space-y-4">
          {/* WHT certificate system issuance plan §4.1 (S1/S9): both gate axes — route-readiness
              (`handoff.systemIssuanceOpen`) and the permission axis, which already folds in the
              `wht_50bis` entitlement. Placed beside the external-attach form below; the operator
              picks one path. */}
          {canIssueSystemWhtCertificate(handoff, permissions) && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">พิมพ์เอกสารทวิ 50</h4>
              {issueError && <ErrorBanner message={issueError} />}
              <button type="button" className={btnClass} style={{ minHeight: 44, minWidth: 44 }} aria-busy={issuing} disabled={issuing} onClick={() => void doIssue()}>
                {issuing ? 'กำลังพิมพ์เอกสาร...' : 'พิมพ์เอกสารทวิ 50'}
              </button>
            </div>
          )}
          {canLink && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">แนบหนังสือรับรองที่ออกภายนอกแล้ว</h4>
              {error && <ErrorBanner message={error} />}
              <form className="grid gap-2 sm:grid-cols-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <label className="block" htmlFor={fieldId('number')}>
                  <span className="sr-only">เลขที่หนังสือรับรอง</span>
                  <input id={fieldId('number')} className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="เลขที่หนังสือรับรอง" disabled={busy} />
                </label>
                <label className="block" htmlFor={fieldId('evidence')}>
                  <span className="sr-only">อ้างอิงหลักฐานหรือไฟล์</span>
                  <input id={fieldId('evidence')} className={inputClass} value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} placeholder="อ้างอิงหลักฐาน/ไฟล์" disabled={busy} />
                </label>
                <label className="block" htmlFor={fieldId('issued-date')}>
                  <span className="sr-only">วันที่ออกหนังสือรับรอง</span>
                  <ThemedDate id={fieldId('issued-date')} className={inputClass} value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} disabled={busy} />
                </label>
                <label className="block" htmlFor={fieldId('note')}>
                  <span className="sr-only">หมายเหตุ (ถ้ามี)</span>
                  <input id={fieldId('note')} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" disabled={busy} />
                </label>
                <button type="submit" className={btnClass} style={{ minHeight: 44, minWidth: 44 }} aria-busy={busy} disabled={busy || !number.trim() || !evidenceRef.trim() || !issuedDate}>
                  {busy ? 'กำลังแนบ...' : 'แนบเอกสาร'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Hub Page ──────────────────────────────────────────────────────────────────
export function AccountsPayableHubPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const searchParams = useSearchParams();
  const tabs = useMemo(() => visibleAccountsPayableTabs(permissions), [permissions]);
  // Preserve the existing ?billId= behavior; ?tab= only chooses the initial panel.
  const [tab, setTab] = useState<AccountsPayableTab>(() => parseAccountsPayableTab(searchParams.get('tab'), tabs));

  if (tabs.length === 0) {
    return <div className="p-6"><ForbiddenState /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">เจ้าหนี้การค้า</h1>
      <div className="flex w-full items-center overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:overflow-x-visible">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{ACCOUNTS_PAYABLE_TAB_LABELS[t]}</button>
        ))}
      </div>
      <div>
        {tab === 'bills' && <VendorBillList companyId={companyId} permissions={permissions} />}
        {tab === 'payments' && <SupplierPaymentList companyId={companyId} permissions={permissions} />}
        {tab === 'wht' && <WhtHandoffPanel companyId={companyId} permissions={permissions} />}
        {tab === 'aging' && <ApAgingPanel companyId={companyId} />}
      </div>
    </div>
  );
}
