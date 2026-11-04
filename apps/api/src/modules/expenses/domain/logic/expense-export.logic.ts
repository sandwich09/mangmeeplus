import { ACCOUNTANT_WORKBOOK_SHEETS, ACCOUNTANT_WORKBOOK_COLUMNS, ACCOUNTANT_WORKBOOK_COLUMN_LABELS,
  ACCOUNTANT_WORKBOOK_OPTIONAL_COLUMN_LABELS, ACCOUNTANT_PAYMENT_SHEET_COLUMNS, ACCOUNTANT_PAYMENT_SHEET_COLUMN_LABELS,
  ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS, ACCOUNTANT_WITHHOLDING_SHEET_COLUMN_LABELS, ACCOUNTANT_FILES_SHEET_COLUMNS, ACCOUNTANT_FILES_SHEET_COLUMN_LABELS,
  EXPENSE_PAYMENT_METHOD_LABELS, expenseCurrencyLabel } from '@watchdog-bms/contracts';
import { expenseDocumentDateStatus, expenseEvidenceAssessment, expenseEvidenceImageMissing, EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL, civilDate } from '@watchdog-bms/contracts';
import {
  ACCOUNTANT_INDEX_COLUMNS,
  EXPENSE_STATUS_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS,
  TAX_EVIDENCE_STATUS_LABELS,
  TAX_EVIDENCE_REASON_LABELS,
  INPUT_VAT_RIGHT_LABELS,
  type ExpenseSummary,
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

export type AccountantWorkbookFile = {
  expenseNumber: string; kind: 'receipts' | 'substituteReceipts' | 'paymentSlips' | 'vouchers' | 'supportingFiles' | 'whtCertificates';
  path: string; part: number; version?: 'current' | 'superseded'; replacedBy?: string; skippedReason?: string;
};
export type AccountantWorkbookRow = Partial<Record<typeof ACCOUNTANT_WORKBOOK_COLUMNS[number] | 'shop_branch', string | number | null>> & {
  dateStatus?: ReturnType<typeof expenseDocumentDateStatus>; lastPaidAtConfirmed?: boolean; primaryFile?: AccountantWorkbookFile;
  sourceDocumentTypeLabel?: string; inputVatRightLabel?: string;
};
export type AccountantPaymentRow = Partial<Record<typeof ACCOUNTANT_PAYMENT_SHEET_COLUMNS[number], string | number | null>> & {
  paidAtConfirmed?: boolean; paymentFile?: AccountantWorkbookFile;
};
export type AccountantWithholdingRow = Partial<Record<typeof ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS[number], string | number | null>> & {
  faults?: readonly string[];
};

export function vendorBranchLabel(code: string | null | undefined): string {
  return !code ? '' : code === '00000' ? 'สำนักงานใหญ่' : /^\d{5}$/.test(code) ? `สาขา ${code}` : 'ยังไม่ระบุ';
}
export function shopBranchLabel(branch: { name: string; isVatEstablishment?: boolean; taxBranchCode?: string | null }): string {
  return [branch.name, branch.isVatEstablishment ? vendorBranchLabel(branch.taxBranchCode) : ''].filter(Boolean).join(' · ');
}
export function accountantNotes(input: {
  dateStatus?: string; hasImage?: boolean; evidenceNote?: string | null; taxEvidenceStatus?: string | null;
  taxEvidenceReason?: string | null; inputVatClaimStatus?: string | null; inputVatReason?: string | null;
}): string {
  return [input.dateStatus === 'implausible' ? 'วันที่เอกสารควรตรวจอีกครั้ง' : '', input.hasImage === false ? 'ยังไม่มีรูปเอกสาร' : '',
    input.evidenceNote ? `หมายเหตุ: ${input.evidenceNote}` : '', input.taxEvidenceStatus !== 'USABLE_FOR_TAX' ? input.taxEvidenceReason : '',
    ['NON_CLAIMABLE', 'NEEDS_REVIEW'].includes(input.inputVatClaimStatus ?? '') && input.inputVatReason ? `สิทธิภาษีซื้อ: ${input.inputVatReason}` : ''].filter(Boolean).join(' · ');
}
export function primaryFileCell(file: AccountantWorkbookFile | undefined, currentPart: number): WorkbookCell {
  if (!file) return 'ไม่มีไฟล์';
  if (file.skippedReason) return `ไม่ได้รวม: ${file.skippedReason}`;
  if (!file.path || /^(?:[a-z]+:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/i.test(file.path)) return 'ไม่มีไฟล์';
  if (file.part !== currentPart) return `อยู่ในชุดที่ ${file.part}: ${file.path}`;
  const escaped = file.path.replace(/"/g, '""');
  return { value: file.path, formula: `HYPERLINK("${escaped}","${escaped}")` };
}
export function paidAtLabel(paidAt: string | Date | null | undefined, confirmed = true): string {
  if (!paidAt) return '';
  const date = formatThaiExportDate(paidAt instanceof Date ? paidAt.toISOString() : paidAt);
  return confirmed ? date : `ยังไม่ยืนยัน (${date})`;
}

/** A separate projection: no legacy CSV fields, application links or employee audit metadata. */
export function buildAccountantWorkbook(input: {
  rows: AccountantWorkbookRow[]; payments: AccountantPaymentRow[]; withholding: AccountantWithholdingRow[];
  files?: AccountantWorkbookFile[]; part?: number;
  visible: { shopBranch?: boolean; vouchers?: boolean; certificates?: boolean };
  about: Record<string, string | number>;
}): Buffer {
  const { rows, payments, withholding, files, visible, about } = input;
  const part = input.part ?? 1, bundled = input.part !== undefined;
  const label = (value: unknown, labels: Record<string, string>) => value == null || value === '' ? 'ยังไม่ระบุ' : labels[String(value)] ?? 'อื่น ๆ';
  const money = (value: unknown): WorkbookCell => value == null || value === '' ? '' : Number.isFinite(Number(value)) ? { value: Number(value), style: 3 } : 'ยังไม่ระบุ';
  const text = (value: unknown) => value == null ? '' : String(value);
  const date = (value: unknown) => value ? formatThaiExportDate(String(value)) : 'ยังไม่ระบุ';
  const sheet = (name: string, columns: readonly string[], labels: Record<string, string>, entries: WorkbookCell[][]): WorkbookSheet => ({
    name, freezeRows: 1, rows: [columns.map(column => labels[column]!), ...entries],
  });
  const expenseColumns: string[] = ACCOUNTANT_WORKBOOK_COLUMNS.filter(column => column !== 'primary_file' || bundled);
  if (visible.shopBranch) expenseColumns.splice(2, 0, 'shop_branch');
  const expenseLabels = { ...ACCOUNTANT_WORKBOOK_COLUMN_LABELS, ...ACCOUNTANT_WORKBOOK_OPTIONAL_COLUMN_LABELS };
  const ordered = rows.slice().sort((a, b) => text(a.document_date).localeCompare(text(b.document_date)) || text(a.expense_number).localeCompare(text(b.expense_number)));
  const sheets: WorkbookSheet[] = [sheet(ACCOUNTANT_WORKBOOK_SHEETS.expenses, expenseColumns, expenseLabels, ordered.map(row => expenseColumns.map(column => {
    const value = row[column as keyof AccountantWorkbookRow];
    if (column.endsWith('_amount')) return money(value);
    if (column === 'document_date') return row.dateStatus === 'unverified' ? 'ยังไม่ระบุ' : date(value);
    if (column === 'uploaded_at') return date(value);
    if (column === 'last_paid_at') return paidAtLabel(text(value), row.lastPaidAtConfirmed);
    if (column === 'currency') return expenseCurrencyLabel(text(value));
    if (column === 'vendor_branch') return vendorBranchLabel(text(value));
    if (column === 'expense_number') return value ? text(value) : 'ยังไม่มีเลขที่';
    if (column === 'source_document_type') return row.sourceDocumentTypeLabel ?? label(value, SOURCE_DOCUMENT_TYPE_LABELS);
    if (column === 'expense_status') return label(value, EXPENSE_STATUS_LABELS);
    if (column === 'input_vat_right') return row.inputVatRightLabel ?? label(value, INPUT_VAT_RIGHT_LABELS);
    if (column === 'tax_evidence_status') return label(value, TAX_EVIDENCE_STATUS_LABELS);
    if (column === 'notes') return [...new Set([accountantNotes({ dateStatus: row.dateStatus }), text(value)].filter(Boolean))].join(' · ');
    if (column === 'primary_file') return primaryFileCell(row.primaryFile ?? files?.find(file => file.expenseNumber === row.expense_number && ['receipts', 'substituteReceipts'].includes(file.kind) && file.version !== 'superseded'), part);
    return text(value);
  })))];
  if (payments.length) {
    const columns = ACCOUNTANT_PAYMENT_SHEET_COLUMNS.filter(column => (column !== 'voucher_numbers' || visible.vouchers) && (column !== 'payment_file' || bundled));
    sheets.push(sheet(ACCOUNTANT_WORKBOOK_SHEETS.payments, columns, ACCOUNTANT_PAYMENT_SHEET_COLUMN_LABELS,
      payments.slice().sort((a, b) => text(a.paid_at).localeCompare(text(b.paid_at))).map(row => columns.map(column => {
        if (column === 'paid_at') return paidAtLabel(text(row.paid_at), row.paidAtConfirmed);
        if (column === 'amount') return money(row.amount);
        if (column === 'currency') return expenseCurrencyLabel(text(row.currency));
        if (column === 'payment_method') return label(row.payment_method, EXPENSE_PAYMENT_METHOD_LABELS);
        if (column === 'payment_file') return primaryFileCell(row.paymentFile, part);
        return text(row[column]);
      }))));
  }
  if (withholding.length) {
    const columns = ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS.filter(column => column !== 'certificate_numbers' || visible.certificates);
    sheets.push(sheet(ACCOUNTANT_WORKBOOK_SHEETS.withholding, columns, ACCOUNTANT_WITHHOLDING_SHEET_COLUMN_LABELS,
      withholding.slice().sort((a, b) => text(a.paid_at).localeCompare(text(b.paid_at))).map(row => columns.map(column => {
        if (column === 'paid_at') return date(row.paid_at);
        if (column === 'gross_amount' || column === 'withheld_amount') return money(row[column]);
        if (column === 'currency') return expenseCurrencyLabel(text(row.currency));
        if (column === 'payee_branch') return vendorBranchLabel(text(row.payee_branch));
        if (column === 'form_type') return ({ PND2: 'ภ.ง.ด.2', PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' } as Record<string, string>)[text(row.form_type)] ?? 'ยังไม่ระบุ';
        if (column === 'income_type') return row.income_type ? text(row.income_type) : 'ยังไม่ระบุ';
        if (column === 'rate') return row.rate != null && row.rate !== '' && Number.isFinite(Number(row.rate)) ? Number(row.rate) : 'ยังไม่ระบุ';
        if (column === 'status') return ({ FILED: 'ยื่นแล้ว', LOCKED: 'งวดปิดแล้ว ตรวจกับแบบที่ยื่น', READY: 'ยังไม่ยื่น · ข้อมูลครบตามแบบ', NEEDS_REVIEW: `ยังไม่ยื่น · ต้องตรวจ: ${(row.faults ?? []).join(' · ')}` } as Record<string, string>)[text(row.status)] ?? 'ยังไม่ระบุ';
        return text(row[column]);
      }))));
  }
  if (bundled && files?.length) {
    const multiple = new Set(files.map(file => file.part)).size > 1;
    const columns = ACCOUNTANT_FILES_SHEET_COLUMNS.filter(column => column !== 'part' || multiple);
    const kinds = { receipts: 'เอกสารค่าใช้จ่าย', substituteReceipts: 'ใบรับรองแทนใบเสร็จ', paymentSlips: 'หลักฐานการจ่าย', vouchers: 'ใบสำคัญจ่าย', supportingFiles: 'เอกสารประกอบการจ่าย', whtCertificates: 'หนังสือรับรอง 50 ทวิ' };
    sheets.push(sheet(ACCOUNTANT_WORKBOOK_SHEETS.files, columns, ACCOUNTANT_FILES_SHEET_COLUMN_LABELS, files.map(file => {
      const values: Record<string, WorkbookCell> = { expense_number: file.expenseNumber || 'ยังไม่มีเลขที่', kind: kinds[file.kind],
        version: file.kind !== 'substituteReceipts' ? '' : file.version === 'superseded' ? file.replacedBy ? 'ฉบับเดิม (มีฉบับใหม่แทนแล้ว)' : 'ยกเลิกแล้ว (ไม่มีฉบับใหม่)' : 'ฉบับที่ใช้อยู่',
        replaced_by: file.replacedBy ? primaryFileCell(files.find(next => next.path === file.replacedBy) ?? { ...file, path: file.replacedBy }, part) : '',
        file: primaryFileCell(file, part), part: file.part };
      return columns.map(column => values[column]!);
    })));
  }
  const facts: Record<string, string | number> = { ...about,
    'จำนวนรายการ': rows.length, 'จำนวนการจ่าย': payments.length,
    'การจ่ายที่ยังไม่ยืนยันวันที่': `${payments.filter(row => row.paidAtConfirmed === false).length} รายการ ไม่อยู่ในแผ่นหัก ณ ที่จ่าย`,
    'หัก ณ ที่จ่าย': withholding.length ? `${withholding.length} แถว` : 'ไม่มีรายการหัก ณ ที่จ่ายในช่วงนี้',
    'สกุลเงิน': 'ยอดเงินเป็นสกุลตามคอลัมน์สกุลเงิน อย่ารวมต่างสกุล',
    'ช่องว่าง': 'ช่องว่าง = ไม่มีข้อมูลนี้ในมั่งมี หรือไม่เกี่ยวกับรายการนี้ (เช่น รายการที่ไม่มีหัก ณ ที่จ่าย)',
    ...(bundled ? { 'ชุดที่': part } : {}),
    ...(bundled && files?.length ? { 'วิธีเปิดไฟล์': 'แตกไฟล์ ZIP ก่อน แล้วเปิดไฟล์นี้ในคอมพิวเตอร์ ลิงก์ในคอลัมน์ไฟล์จึงจะเปิดเอกสารได้' } : {}),
  };
  sheets.push({ name: ACCOUNTANT_WORKBOOK_SHEETS.about, rows: [['หัวข้อ', 'ค่า'], ...Object.entries(facts)], freezeRows: 1 });
  return buildWorkbook(sheets);
}
