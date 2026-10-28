import { webLink } from '../../../../common/http/web-link';
import { expenseDocumentDateStatus, expenseEvidenceAssessment, expenseEvidenceImageMissing, EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL, civilDate } from '@watchdog-bms/contracts';
import {
  ACCOUNTANT_INDEX_COLUMNS,
  ACCOUNTANT_INDEX_COLUMN_LABELS,
  EXPENSE_STATUS_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS,
  TAX_EVIDENCE_STATUS_LABELS,
  TAX_EVIDENCE_REASON_LABELS,
  INPUT_VAT_RIGHT_LABELS,
  type ExpenseSummary,
  accountantIndexColumns,
  type AccountantIndexColumn,
  type AccountantIndexColumnSet,
  type AccountantPackageIndexRow,
  type EvidenceManifestEntry,
  type ExpenseAttachmentRef,
  type SourceDocumentType,
  type TaxEvidenceStatus,
} from '@watchdog-bms/contracts';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';
import { buildWorkbook, type WorkbookCell, type WorkbookSheet } from '../../../../common/export/xlsx.logic';
import { safeCsvCell } from '../../../../common/export/csv.logic';

export type AccountantIndexSource = {
  /** Spec §5.2: the source of `document_date_status`. Optional — a caller that has no AI summary
   *  (a manual entry) yields `verified`, which is what a hand-typed date is. */
  aiVerificationSummaryJson?: Record<string, unknown> | null;
  companyName: string;
  companyTaxId: string | null;
  branchCode: string | null;
  expenseId: string;
  expenseNumber: string | null;
  status: string;
  captureSource: string;
  sourceDocumentType: SourceDocumentType;
  taxEvidenceStatus: TaxEvidenceStatus;
  taxEvidenceReasonCode: string | null;
  inputVatClaimStatus?: ExpenseSummary['inputVatClaimStatus'];
  latestInputVatDecision?: ExpenseSummary['latestInputVatDecision'];
  inputVatRecordedBeforeReview?: boolean;
  postingStatus: string;
  postingError: string | null;
  journalEntryNumber: string | null;
  uploadedAt: string;
  expenseDate: string;
  requesterName: string | null;
  uploaderName: string | null;
  reviewerName: string | null;
  vendorNameSnapshot: string | null;
  vendorTaxIdSnapshot: string | null;
  vendorBranchCodeSnapshot: string | null;
  /** GAP-7. Optional: rows written before the column existed carry no address, and a package built
   *  from them must still export (§8 — a missing address never blocks). */
  vendorAddressSnapshot?: string | null;
  vendorDocumentNumber: string | null;
  categoryName: string | null;
  accountHintKey: string | null;
  description: string | null;
  quantity: string | null;
  subtotalAmount: string;
  /** §5.1: the charge rows' printed amounts. `subtotal_amount` is goods only, so without this the
   *  exported row does not add up to its own grand total. */
  additionalChargesAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentMethod: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  substituteReceiptRef: string | null;
  fundingSource?: string | null;
  certifyingPayerName?: string | null;
  substituteEvidenceProvenance?: string | null;
  primaryAttachmentId: string | null;
  attachments: ExpenseAttachmentRef[];
  /** R11: ids that carry this expense's hand-signed certificate, never its supporting evidence. */
  wetSignedScanAttachmentIds?: string[];
  webUrl: string;
  notes: string | null;
  /** Capture appendix §5: set only on a derived source; it rides in the evidence ref, not a column. */
  captureGroupId?: string | null;
};

const CAPTURE_SOURCE_TO_CHANNEL: Record<string, string> = {
  WEB_UPLOAD: 'WEB',
  WEB_MANUAL: 'WEB',
  LINE_UPLOAD: 'LINE',
  API_INTERNAL: 'API',
};

/**
 * The channel an accountant reads, never the storage enum. A capture source this map does not know
 * is a NEW enum value, and leaking its name into the one artefact that leaves the system turns an
 * internal rename into a changed export column; `OTHER` says the same thing and stays stable.
 */
export function exportSourceChannel(captureSource: string): string {
  return CAPTURE_SOURCE_TO_CHANNEL[captureSource] ?? 'OTHER';
}

/**
 * The key that ties an index row to a file in the evidence folder. A derived source carries its
 * capture group in it (appendix §5) so an accountant holding two receipts split out of one payment
 * can see they came from one job — and an ordinary expense's ref is byte-for-byte what it was, so
 * every existing package and golden still reconciles.
 */
export function evidenceRef(
  expenseNumber: string | null,
  expenseId: string,
  attachmentId: string,
  captureGroupId?: string | null,
): string {
  const base = `${expenseNumber ?? expenseId}-${attachmentId.slice(-8)}`;
  return captureGroupId ? `${base}-${captureGroupRef(captureGroupId)}` : base;
}

/** How a capture group is named to a human: the same token the evidence ref already carries. */
export function captureGroupRef(captureGroupId: string): string {
  return `g${captureGroupId.slice(-8)}`;
}

/** Accounting period = YYYY-MM from document date, falling back to uploaded date. */
export function accountingPeriod(expenseDate: string | null, uploadedAt: string): string {
  const source = expenseDate && expenseDate.length >= 7 ? expenseDate : civilDate(new Date(uploadedAt));
  return source.slice(0, 7);
}

/** R11: the photographed hand-signed form is part of the certificate, not evidence supporting the
 *  expense. Sweeping it into `supporting_evidence_refs` would tell an accountant the payment was
 *  documented twice, and would put the signature page in the supporting-evidence folder. */
export const WET_SIGNED_SCAN_EVIDENCE_ROLE = 'substitute.wet_signed_scan';

export function noReceiptDocumentLabel(source: Pick<AccountantIndexSource, 'sourceDocumentType' | 'taxEvidenceStatus' | 'aiVerificationSummaryJson'>): string | undefined {
  const problem = expenseEvidenceAssessment(source)?.receiptProblem;
  return source.sourceDocumentType === 'EXPENSE_NOTE_TEXT' && (problem === 'NOT_AVAILABLE' || problem === 'LOST') ? 'ไม่มีใบเสร็จ' : undefined;
}

export function buildAccountantIndexRow(source: AccountantIndexSource): AccountantPackageIndexRow & { sourceDocumentTypeLabel?: string; inputVatRightLabel?: string } {
  const primary = source.attachments.find((a) => a.id === source.primaryAttachmentId)
    ?? source.attachments.find((a) => a.purpose === 'expense.receipt.primary');
  const wetSignedScanIds = new Set(source.wetSignedScanAttachmentIds ?? []);
  const supporting = source.attachments.filter((a) => a.id !== primary?.id && !wetSignedScanIds.has(a.id));
  const documentDate = expenseDocumentDateStatus(source.aiVerificationSummaryJson) !== 'unverified' ? source.expenseDate : null;
  return {
    ...(noReceiptDocumentLabel(source) ? { sourceDocumentTypeLabel: noReceiptDocumentLabel(source) } : {}),
    ...(source.inputVatRecordedBeforeReview ? { inputVatRightLabel: 'ไม่ได้ใช้ภาษีซื้อ (บันทึกก่อนมีการตรวจสิทธิ)' } : {}),
    voucher_numbers: '', wht_certificate_numbers: '', bundle_file_names: '',
    input_vat_right: source.inputVatClaimStatus ?? '',
    input_vat_reason: source.latestInputVatDecision?.reason ?? '',
    input_vat_decided_by: source.latestInputVatDecision?.decidedByName ?? '',
    input_vat_decided_at: source.latestInputVatDecision?.decidedAt ?? '',
    company_name: source.companyName,
    company_tax_id: source.companyTaxId ?? '',
    branch_code: source.branchCode ?? '',
    accounting_period: accountingPeriod(documentDate, source.uploadedAt),
    uploaded_at: source.uploadedAt,
    document_date: documentDate ?? '',
    expense_number: source.expenseNumber ?? source.expenseId,
    expense_status: source.status,
    source_channel: exportSourceChannel(source.captureSource),
    source_document_type: source.sourceDocumentType,
    tax_evidence_status: source.taxEvidenceStatus,
    tax_evidence_reason: source.taxEvidenceReasonCode ?? '',
    posting_status: source.postingStatus,
    posting_error: source.postingError ?? '',
    journal_entry_number: source.journalEntryNumber ?? '',
    requester_name: source.requesterName ?? '',
    uploader_name: source.uploaderName ?? '',
    reviewer_name: source.reviewerName ?? '',
    vendor_name: source.vendorNameSnapshot ?? '',
    vendor_tax_id: source.vendorTaxIdSnapshot ?? '',
    vendor_address: source.vendorAddressSnapshot ?? '',
    vendor_branch_code: source.vendorBranchCodeSnapshot ?? '',
    vendor_document_number: source.vendorDocumentNumber ?? '',
    category_name: source.categoryName ?? '',
    account_hint_key: source.accountHintKey ?? '',
    description: source.description ?? '',
    quantity: source.quantity ?? '',
    subtotal_amount: source.subtotalAmount,
    discount_amount: source.discountAmount,
    taxable_amount: source.taxableAmount,
    vat_amount: source.vatAmount,
    wht_amount: source.whtAmount,
    grand_total_amount: source.grandTotalAmount,
    net_payable_amount: source.netPayableAmount,
    paid_amount: source.paidAmount,
    outstanding_amount: source.outstandingAmount,
    payment_method: source.paymentMethod ?? '',
    paid_at: source.paidAt ?? '',
    payment_reference: source.paymentReference ?? '',
    substitute_receipt_ref: source.substituteReceiptRef ?? '',
    funding_source: source.fundingSource ?? '',
    certifying_payer_name: source.certifyingPayerName ?? '',
    substitute_evidence_provenance: source.substituteEvidenceProvenance ?? '',
    primary_evidence_ref: primary ? evidenceRef(source.expenseNumber, source.expenseId, primary.id, source.captureGroupId) : '',
    supporting_evidence_refs: supporting.map((a) => evidenceRef(source.expenseNumber, source.expenseId, a.id, source.captureGroupId)).join(','),
    web_url: source.webUrl,
    notes: [source.notes, expenseEvidenceImageMissing(source) ? EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL : '',
      expenseEvidenceAssessment(source)?.note?.trim() ? `หมายเหตุ: ${expenseEvidenceAssessment(source)!.note!.trim()}` : ''].filter(Boolean).join(' · '),
    additional_charges_amount: source.additionalChargesAmount,
    // Spec §5.2: the accountant reads `document_date` beside this, so a placeholder can never pass
    // for a printed date in the one artefact that leaves the system.
    document_date_status: expenseDocumentDateStatus(source.aiVerificationSummaryJson),
  };
}

/** CSV in the exact column order required by the expense-receipt-upload spec. */
export function buildAccountantIndexCsv(rows: AccountantPackageIndexRow[]): string {
  const header = ACCOUNTANT_INDEX_COLUMNS.join(',');
  const body = rows.map((row) => ACCOUNTANT_INDEX_COLUMNS.map((col) => safeCsvCell(row[col] ?? '')).join(','));
  return [header, ...body].join('\n');
}

/** Amount/quantity columns are written as real numbers so Excel can sum them. */
const NUMERIC_COLUMNS = new Set<AccountantIndexColumn>([
  'quantity', 'subtotal_amount', 'additional_charges_amount', 'discount_amount', 'taxable_amount',
  'vat_amount', 'wht_amount',
  'grand_total_amount', 'net_payable_amount', 'paid_amount', 'outstanding_amount',
]);

/** Display dates in the XLSX only — the CSV keeps ISO for system-to-system consumers.
    `accounting_period` is a YYYY-MM key, not a date, and is deliberately excluded. */
const DATE_COLUMNS = new Set<AccountantIndexColumn>(['uploaded_at', 'document_date', 'paid_at']);

/** Enum codes become the same Thai wording the UI shows. */
const VALUE_LABELS: Partial<Record<AccountantIndexColumn, Record<string, string>>> = {
  expense_status: EXPENSE_STATUS_LABELS,
  source_document_type: SOURCE_DOCUMENT_TYPE_LABELS,
  tax_evidence_status: TAX_EVIDENCE_STATUS_LABELS,
  tax_evidence_reason: TAX_EVIDENCE_REASON_LABELS,
  input_vat_right: INPUT_VAT_RIGHT_LABELS,
};

function xlsxCell(column: AccountantIndexColumn, value: string): WorkbookCell {
  if (NUMERIC_COLUMNS.has(column)) {
    const amount = Number(value);
    return value !== '' && Number.isFinite(amount) ? column === 'quantity' ? amount : { value: amount, style: 3 } : '';
  }
  if (column === 'input_vat_decided_at' && value) return `${formatThaiExportDate(value)} ${new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(value))} น.`;
  if (DATE_COLUMNS.has(column)) return formatThaiExportDate(value);
  return VALUE_LABELS[column]?.[value] ?? value;
}

/** Real .xlsx of the accountant index, headed by Thai labels instead of column keys. */
export function buildAccountantIndexXlsx(
  rows: (AccountantPackageIndexRow & { sourceDocumentTypeLabel?: string; inputVatRightLabel?: string })[],
  columnSet: AccountantIndexColumnSet,
  paymentEvidenceRows: AccountantPackageIndexRow[] = [],
): Buffer {
  const sheet = (name: string, entries: typeof rows, columns: readonly AccountantIndexColumn[]): WorkbookSheet => ({
    name,
    freezeRows: 1,
    rows: [
      columns.map((col) => ACCOUNTANT_INDEX_COLUMN_LABELS[col]),
      ...entries.map((row) => columns.map((col) => col === 'web_url' && row[col]
        ? { value: 'เปิดไฟล์', formula: `HYPERLINK("${webLink(row[col]).replace(/"/g, '""')}","เปิดไฟล์")` }
        : col === 'input_vat_right' && row.inputVatRightLabel ? row.inputVatRightLabel
        : col === 'source_document_type' && row.sourceDocumentTypeLabel ? row.sourceDocumentTypeLabel : xlsxCell(col, row[col] ?? ''))),
    ],
  });
  return buildWorkbook([
    sheet('รายการค่าใช้จ่าย', rows, accountantIndexColumns(columnSet)),
    ...(paymentEvidenceRows.length ? [sheet('หลักฐานการจ่าย', paymentEvidenceRows, [
      'document_date', 'expense_number', 'vendor_name', 'voucher_numbers', 'wht_certificate_numbers', 'bundle_file_names', 'web_url', 'notes',
    ])] : []),
  ]);
}

export type ManifestEntrySource = {
  expenseId: string;
  expenseNumber: string | null;
  attachment: ExpenseAttachmentRef;
  /** R11: set when this attachment is an evidence's wet-signed scan, so its role says so. */
  isWetSignedScan?: boolean;
  sourceDocumentType: SourceDocumentType;
  taxEvidenceStatus: TaxEvidenceStatus;
  downloadUrl: string;
  downloadUrlExpiresAt: string;
  webUrl: string;
  captureGroupId?: string | null;
};

export function buildManifestEntry(source: ManifestEntrySource): EvidenceManifestEntry {
  return {
    evidence_ref: evidenceRef(source.expenseNumber, source.expenseId, source.attachment.id, source.captureGroupId),
    expense_id: source.expenseId,
    attachment_id: source.attachment.id,
    file_name: source.attachment.originalFileName,
    mime_type: source.attachment.mimeType,
    file_size_bytes: source.attachment.byteSize,
    ...(source.attachment.sourceExpenseId && { source_expense_id: source.attachment.sourceExpenseId }),
    ...(source.attachment.isHistorical !== undefined && { is_historical: source.attachment.isHistorical }),
    ...(source.attachment.substituteReceiptStatus && { substitute_receipt_status: source.attachment.substituteReceiptStatus }),
    evidence_role: source.attachment.isHistorical ? 'substitute.history' : source.isWetSignedScan ? WET_SIGNED_SCAN_EVIDENCE_ROLE : source.attachment.purpose,
    source_document_type: source.sourceDocumentType,
    tax_evidence_status: source.taxEvidenceStatus,
    download_url: source.downloadUrl,
    download_url_expires_at: source.downloadUrlExpiresAt,
    web_url: source.webUrl,
  };
}

/** UI year/month folder key from an ISO timestamp/date string. */
export function yearMonthBucket(isoDate: string): string {
  return isoDate.slice(0, 7);
}
