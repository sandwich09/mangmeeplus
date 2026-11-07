import Decimal from 'decimal.js';
import { coerceCivilDate } from '@watchdog-bms/contracts';
import { effectiveVatStatus, type VatFactRow } from '../../../data-model-core/domain/logic/company-vat-registration.logic';
import { groupExpenseLines, allocateToHeader, type PurchaseJournalExpense, type PurchaseJournalGroup } from './accounting-software-export.logic';
import { E_WHT_WORDS, type WhtRemittance, ACCOUNTANT_WORKBOOK_SHEETS, ACCOUNTANT_WORKBOOK_COLUMNS, ACCOUNTANT_WORKBOOK_COLUMN_LABELS,
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

export function accountantWhtRemittance(amount: string, remittance?: WhtRemittance | null): string {
  if (!(Number(amount) > 0)) return E_WHT_WORDS['W-X2'].noWithholding;
  return E_WHT_WORDS['W-X2'][remittance ?? 'unspecified'];
}

export type AccountantIndexSource = {
  whtRemittance?: WhtRemittance | null;
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
  expenseNumber: string; kind: 'receipts' | 'substituteReceipts' | 'paymentSlips' | 'vouchers' | 'supportingFiles' | 'whtCertificates' | 'claimForms' | 'recordPacks';
  attachmentId?: string; expenseIds?: readonly string[]; path: string; part: number; version?: 'current' | 'superseded'; replacedBy?: string; skippedReason?: string; referenceReason?: string;
};
export type AccountantWorkbookRow = Partial<Record<typeof ACCOUNTANT_WORKBOOK_COLUMNS[number] | 'shop_branch', string | number | null>> & {
  dateStatus?: ReturnType<typeof expenseDocumentDateStatus>; lastPaidAtConfirmed?: boolean; primaryFile?: AccountantWorkbookFile;
  sourceDocumentTypeLabel?: string; inputVatRightLabel?: string; sourceExpenseId?: string;
};
export type AccountantPaymentRow = Partial<Record<typeof ACCOUNTANT_PAYMENT_SHEET_COLUMNS[number], string | number | null>> & {
  paidAtConfirmed?: boolean; paymentFile?: AccountantWorkbookFile; sourceExpenseId?: string;
};
export type AccountantWithholdingRow = Partial<Record<typeof ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS[number], string | number | null>> & {
  faults?: readonly string[]; sourceExpenseId?: string;
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
  const display = file.path + (file.referenceReason ? ` · ${file.referenceReason}` : '');
  if (file.part !== currentPart) return `อยู่ในชุดที่ ${file.part}: ${display}`;
  const escaped = file.path.replace(/"/g, '""');
  return { value: display, formula: `HYPERLINK("${escaped}","${display.replace(/"/g, '""')}")` };
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
  sources?: AccountantExportSource[]; bankRemitted?: AccountantWithholdingRow[];
  company?: AccountantPurchaseContext['company']; branches?: AccountantPurchaseContext['branches']; registrationFacts?: VatFactRow[];
}): Buffer {
  const { rows, payments, withholding, files, visible, about } = input;
  const part = input.part ?? 1, bundled = input.part !== undefined;
  const label = (value: unknown, labels: Record<string, string>) => value == null || value === '' ? 'ยังไม่ระบุ' : labels[String(value)] ?? 'อื่น ๆ';
  const money = accountantMoney;
  const text = (value: unknown) => value == null ? '' : String(value);
  const date = (value: unknown) => value ? formatThaiExportDate(String(value)) : 'ยังไม่ระบุ';
  const sheet = (name: string, columns: readonly string[], labels: Record<string, string>, entries: WorkbookCell[][]): WorkbookSheet => ({
    name, freezeRows: 1, rows: [columns.map(column => labels[column]!), ...entries],
  });
  const expenseColumns: string[] = ACCOUNTANT_WORKBOOK_COLUMNS.filter(column => column !== 'primary_file' || bundled);
  if (visible.shopBranch) expenseColumns.splice(2, 0, 'shop_branch');
  if (bundled) expenseColumns.push('record_files');
  const expenseLabels = { ...ACCOUNTANT_WORKBOOK_COLUMN_LABELS, ...ACCOUNTANT_WORKBOOK_OPTIONAL_COLUMN_LABELS };
  const ordered = rows.slice().sort((a, b) => text(a.document_date).localeCompare(text(b.document_date)) || text(a.expense_number).localeCompare(text(b.expense_number)));
  const orderedPayments = payments.slice().sort((a, b) => text(a.paid_at).localeCompare(text(b.paid_at)));
  const orderedWithholding = withholding.slice().sort((a, b) => text(a.paid_at).localeCompare(text(b.paid_at)));
  const sources = input.sources ?? ordered.map(workbookRowSource);
  const selected = sources.filter(source => source.selected !== false);
  const groups = selected.map(accountantTaxGroups);
  const expenseRows = new Map(ordered.map((row, index) => [row.sourceExpenseId ?? String(row.expense_number ?? ''), index + 2]));
  const purchase = buildAccountantPurchaseTaxRows(groups, { ...input, expenseRows });
  const issues = buildAccountantFollowUpRows(sources, visible.certificates === true, files);
  const issueRows = issues.map(issue => {
    const expenseIndex = ordered.findIndex(row => row.sourceExpenseId ? row.sourceExpenseId === issue.sourceId : row.expense_number === issue.expenseNumber);
    const paymentIndex = orderedPayments.findIndex(row => row.sourceExpenseId ? row.sourceExpenseId === issue.sourceId : row.expense_number === issue.expenseNumber);
    const withholdingIndex = orderedWithholding.findIndex(row => row.sourceExpenseId ? row.sourceExpenseId === issue.sourceId : row.expense_number === issue.expenseNumber);
    const target = expenseIndex >= 0 ? [ACCOUNTANT_WORKBOOK_SHEETS.expenses, expenseIndex + 2] : paymentIndex >= 0
      ? [ACCOUNTANT_WORKBOOK_SHEETS.payments, paymentIndex + 2] : withholdingIndex >= 0
        ? [ACCOUNTANT_WORKBOOK_SHEETS.withholding, withholdingIndex + 2] : [ACCOUNTANT_WORKBOOK_SHEETS.about, 1];
    return [issue.expenseNumber, issue.message, { value: 'ดูรายการ', formula: `HYPERLINK("#'${target[0]}'!A${target[1]}","ดูรายการ")` }];
  });
  const sheets: WorkbookSheet[] = [
    { name: ACCOUNTANT_WORKBOOK_SHEETS.followUp, freezeRows: 1, rows: [['เลขที่รายการ', 'สิ่งที่ต้องตาม', 'ดูรายการ'],
      ...(issueRows.length ? issueRows : [['ไม่พบรายการที่ต้องตามเอกสารจากข้อมูลในไฟล์นี้']])] },
    buildAccountantMonthSummary(groups, payments, withholding, input.bankRemitted ?? [], purchase),
    sheet(ACCOUNTANT_WORKBOOK_SHEETS.expenses, expenseColumns, expenseLabels, ordered.map(row => expenseColumns.map(column => {
    const value = row[column as keyof AccountantWorkbookRow];
    if (column.endsWith('_amount')) return money(value);
    if (column === 'document_date') return row.dateStatus === 'unverified' ? 'ยังไม่ระบุ' : date(value);
    if (column === 'uploaded_at') return date(value);
    if (column === 'last_paid_at') return paidAtLabel(text(value), row.lastPaidAtConfirmed);
    if (column === 'currency') return accountantCurrencyLabel(text(value));
    if (column === 'vendor_branch') return vendorBranchLabel(text(value));
    if (column === 'expense_number') return value ? text(value) : 'ยังไม่มีเลขที่';
    if (column === 'source_document_type') return row.sourceDocumentTypeLabel ?? label(value, SOURCE_DOCUMENT_TYPE_LABELS);
    if (column === 'expense_status') return label(value, EXPENSE_STATUS_LABELS);
    if (column === 'input_vat_right') return row.inputVatRightLabel ?? label(value, INPUT_VAT_RIGHT_LABELS);
    if (column === 'tax_evidence_status') return label(value, TAX_EVIDENCE_STATUS_LABELS);
    if (column === 'notes') {
      const packets = files?.filter(file => file.kind === 'recordPacks' && file.expenseIds?.includes(row.sourceExpenseId ?? '')) ?? [];
      return [...new Set([accountantNotes({ dateStatus: row.dateStatus }), text(value), bundled && packets.length > 1 ? `มีชุดเอกสารรายการ ${packets.length} ชุด ดูแผ่นไฟล์ทั้งหมด` : ''].filter(Boolean))].join(' · ');
    }
    if (column === 'record_files') return primaryFileCell(files?.filter(file => file.kind === 'recordPacks' && file.expenseIds?.includes(row.sourceExpenseId ?? '')).sort((a, b) => a.path.localeCompare(b.path))[0], part);
    if (column === 'primary_file') return primaryFileCell(row.primaryFile ?? files?.find(file => file.expenseNumber === row.expense_number && ['receipts', 'substituteReceipts'].includes(file.kind) && file.version !== 'superseded'), part);
    return text(value);
  })))];
  if (payments.length) {
    const columns = ACCOUNTANT_PAYMENT_SHEET_COLUMNS.filter(column => (column !== 'voucher_numbers' || visible.vouchers) && (column !== 'payment_file' || bundled));
    sheets.push(sheet(ACCOUNTANT_WORKBOOK_SHEETS.payments, columns, ACCOUNTANT_PAYMENT_SHEET_COLUMN_LABELS,
      orderedPayments.map(row => columns.map(column => {
        if (column === 'paid_at') return paidAtLabel(text(row.paid_at), row.paidAtConfirmed);
        if (column === 'amount') return money(row.amount);
        if (column === 'currency') return accountantCurrencyLabel(text(row.currency));
        if (column === 'payment_method') return label(row.payment_method, EXPENSE_PAYMENT_METHOD_LABELS);
        if (column === 'payment_file') return primaryFileCell(row.paymentFile, part);
        return text(row[column]);
      }))));
  }
  if (withholding.length) {
    const columns = ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS.filter(column => column !== 'certificate_numbers' || visible.certificates);
    sheets.push(sheet(ACCOUNTANT_WORKBOOK_SHEETS.withholding, columns, ACCOUNTANT_WITHHOLDING_SHEET_COLUMN_LABELS,
      orderedWithholding.map(row => columns.map(column => {
        if (column === 'paid_at') return date(row.paid_at);
        if (column === 'gross_amount' || column === 'withheld_amount') return money(row[column]);
        if (column === 'currency') return accountantCurrencyLabel(text(row.currency));
        if (column === 'payee_branch') return vendorBranchLabel(text(row.payee_branch));
        if (column === 'form_type') return ({ PND2: 'ภ.ง.ด.2', PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' } as Record<string, string>)[text(row.form_type)] ?? 'ยังไม่ระบุ';
        if (column === 'income_type') return row.income_type ? text(row.income_type) : 'ยังไม่ระบุ';
        if (column === 'rate') return row.rate != null && row.rate !== '' && Number.isFinite(Number(row.rate)) ? Number(row.rate) : 'ยังไม่ระบุ';
        if (column === 'status') return ({ FILED: 'ยื่นแล้ว', LOCKED: 'งวดปิดแล้ว ตรวจกับแบบที่ยื่น', READY: 'ยังไม่ยื่น · ข้อมูลครบตามแบบ', NEEDS_REVIEW: `ยังไม่ยื่น · ต้องตรวจ: ${(row.faults ?? []).join(' · ')}` } as Record<string, string>)[text(row.status)] ?? 'ยังไม่ระบุ';
        return text(row[column]);
      }))));
  }
  sheets.push(purchase.sheet);
  if (bundled && files?.length) {
    const multiple = new Set(files.map(file => file.part)).size > 1;
    const columns = ACCOUNTANT_FILES_SHEET_COLUMNS.filter(column => column !== 'part' || multiple);
    const kinds = { receipts: 'เอกสารค่าใช้จ่าย', substituteReceipts: 'ใบรับรองแทนใบเสร็จ', paymentSlips: 'หลักฐานการจ่าย', vouchers: 'ใบสำคัญจ่าย', supportingFiles: 'เอกสารประกอบการจ่าย', whtCertificates: 'หนังสือรับรอง 50 ทวิ', claimForms: 'ใบเบิก', recordPacks: 'ชุดเอกสารรายการ' };
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
    'หัก ณ ที่จ่าย': withholding.length ? `${withholding.length} แถว` : 'ไม่มีแถวในแผ่นหัก ณ ที่จ่าย',
    'สกุลเงิน': 'ยอดเงินเป็นสกุลตามคอลัมน์สกุลเงิน อย่ารวมต่างสกุล',
    'การตรวจไฟล์': bundled ? files?.some(file => file.part !== part) ? 'ไฟล์ชุดอื่นยังไม่ได้ตรวจในครั้งนี้' : 'ตรวจไฟล์ของชุดนี้แล้ว' : 'ไฟล์ต้นฉบับตรวจตอนดาวน์โหลดชุดเอกสาร',
    ...(sources.some(source => source.receiptCheckUnavailable) ? { 'ใบเสร็จจากใบเบิก': 'ข้อมูลเดิมบางรายการยังระบุไฟล์ใบเสร็จต้นทางไม่ได้' } : {}),
    'ช่องว่าง': 'ช่องว่าง = ไม่มีข้อมูลนี้ในมั่งมี หรือไม่เกี่ยวกับรายการนี้ (เช่น รายการที่ไม่มีหัก ณ ที่จ่าย)',
    ...(bundled ? { 'ชุดที่': part } : {}),
    ...(bundled && files?.length ? { 'วิธีเปิดไฟล์': 'แตกไฟล์ ZIP ก่อน แล้วเปิดไฟล์นี้ในคอมพิวเตอร์ ลิงก์ในคอลัมน์ไฟล์จึงจะเปิดเอกสารได้' } : {}),
  };
  sheets.push({ name: ACCOUNTANT_WORKBOOK_SHEETS.about, rows: [['หัวข้อ', 'ค่า'], ...Object.entries(facts)], freezeRows: 1 });
  return buildWorkbook(sheets);
}

export type AccountantExportSource = Omit<PurchaseJournalExpense, 'payments'> & {
  whtRemittance?: string | null; selected?: boolean; branchId?: string | null; status?: string; receivedAt?: Date | string | null; uploadedAt?: Date | string;
  dateStatus?: ReturnType<typeof expenseDocumentDateStatus>; vatMode?: string;
  netPayableAmount?: MoneyValue; paidAmount?: MoneyValue; outstandingAmount?: MoneyValue;
  primaryAttachmentId?: string | null; attachments?: readonly Pick<ExpenseAttachmentRef, 'id' | 'purpose' | 'status' | 'isHistorical'>[];
  receiptCheckUnavailable?: boolean; substituteAttachmentIds?: readonly string[];
  sourceEvidenceUnavailable?: boolean; substituteStatuses?: readonly string[]; certificateNumber?: string;
  /** P2 supplies the authorized signed-claim reader's result, never an inferred signature state. */
  claimProblem?: { key: 'CLAIM_UNSIGNED' | 'CLAIM_UNAVAILABLE'; message: string };
  payments?: readonly { id?: string; status: string; paidAt: Date | string; paidAtConfirmed?: boolean; amount?: MoneyValue }[];
};
type MoneyValue = string | number | { toString(): string };
type AccountantPurchaseContext = {
  company?: { registeredName?: string | null; taxId?: string | null } | null;
  branches?: readonly { id: string; name: string; taxBranchCode: string | null; isVatEstablishment: boolean }[];
  registrationFacts?: readonly VatFactRow[]; expenseRows?: ReadonlyMap<string, number>;
};
type AccountantTaxRecord = { source: AccountantExportSource; groups: PurchaseJournalGroup[]; error?: string };
type PurchaseExclusion = { source: AccountantExportSource; reason: string; base: string; vat: string };
type PurchaseProjection = { sheet: WorkbookSheet; included: { source: AccountantExportSource; base: string; vat: string }[]; excluded: PurchaseExclusion[] };
const decimalAmount = (value: MoneyValue | null | undefined) => new Decimal(String(value ?? 0).trim() || '0').toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
function accountantMoney(value: unknown): WorkbookCell {
  if (value == null || value === '') return '';
  return Number.isFinite(Number(value)) ? { value: decimalAmount(String(value)).toNumber(), style: 3 } : 'ยังไม่ระบุ';
}
export function accountantCurrencyLabel(code: string): string {
  const label = expenseCurrencyLabel(code);
  return label === 'สกุลเงินอื่น' && code ? `${label} (${code.toUpperCase()})` : label;
}
function sourceDay(source: AccountantExportSource): string {
  if (source.dateStatus === 'unverified' || !source.expenseDate) return '';
  try { return coerceCivilDate(source.expenseDate); } catch { return ''; }
}
function workbookRowSource(row: AccountantWorkbookRow): AccountantExportSource {
  return { id: String(row.expense_number ?? ''), expenseNumber: String(row.expense_number ?? 'ยังไม่มีเลขที่'), expenseDate: String(row.document_date ?? ''),
    currency: String(row.currency ?? ''), taxableAmount: String(row.taxable_amount ?? 0), vatAmount: String(row.vat_amount ?? 0),
    grandTotalAmount: String(row.grand_total_amount ?? 0), whtAmount: String(row.wht_amount ?? 0), netPayableAmount: String(row.net_payable_amount ?? 0),
    paidAmount: String(row.paid_amount ?? 0), outstandingAmount: String(row.outstanding_amount ?? 0), dateStatus: row.dateStatus,
    inputVatClaimStatus: String(row.input_vat_right ?? ''), taxEvidenceStatus: String(row.tax_evidence_status ?? ''), status: String(row.expense_status ?? ''),
    sourceDocumentType: String(row.source_document_type ?? ''), vendorDocumentNumber: String(row.vendor_document_number ?? ''),
    vendorNameSnapshot: String(row.vendor_name ?? ''), vendorTaxIdSnapshot: String(row.vendor_tax_id ?? ''), vendorBranchCodeSnapshot: String(row.vendor_branch ?? ''),
    categoryName: String(row.category_name ?? ''), lines: [] };
}
function accountantTaxGroups(source: AccountantExportSource): AccountantTaxRecord {
  const treatment = source.vatMode === 'NO_VAT' ? 'NON_VAT' : source.vatMode === 'EXEMPT' ? 'EXEMPT'
    : !decimalAmount(source.vatAmount).isZero() ? 'STANDARD' : 'UNRESOLVED';
  // ponytail: one header-backed line covers legacy records without inventing a VAT rate.
  const lines = source.lines.length ? source.lines : [{ lineNumber: 1, description: source.note ?? '', taxableAmount: source.taxableAmount,
    vatAmount: source.vatAmount, vatRate: '0', vatTreatment: treatment, categoryName: source.categoryName, expenseCategoryId: source.expenseCategoryId }];
  try {
    return { source, groups: allocateToHeader(groupExpenseLines(source, lines), {
      taxableAmount: decimalAmount(source.taxableAmount).toFixed(2), vatAmount: decimalAmount(source.vatAmount).toFixed(2) }) };
  } catch {
    return { source, groups: [], error: 'ยอดบรรทัดไม่ตรงกับยอดเอกสาร จึงยังแยกยอดไม่ได้' };
  }
}

export function buildAccountantFollowUpRows(sources: readonly AccountantExportSource[], certificatesVisible: boolean, files: readonly AccountantWorkbookFile[] = []) {
  const issues: { sourceId: string; expenseNumber: string; problemKey: string; message: string }[] = [];
  const seen = new Set<string>();
  const add = (source: AccountantExportSource, key: string, message: string) => {
    const identity = `${source.id}:${key}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    issues.push({ sourceId: source.id, expenseNumber: source.expenseNumber ?? 'ยังไม่มีเลขที่', problemKey: key, message });
  };
  const skippedAttachments = new Set(files.flatMap(file => file.skippedReason && file.attachmentId ? [file.attachmentId] : []));
  const receiptTypes = new Set(['RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'HANDWRITTEN_CASH_BILL', 'CUSTOMS_VAT_RECEIPT', 'PP36_RECEIPT']);
  for (const source of sources) {
    const receipt = receiptTypes.has(source.sourceDocumentType ?? '') && source.attachments?.some(file => !file.isHistorical && !skippedAttachments.has(file.id) && !source.substituteAttachmentIds?.includes(file.id) && ['ACTIVE', 'active'].includes(file.status)
      && (file.id === source.primaryAttachmentId || file.purpose === 'expense.receipt.primary'));
    if (!receipt && !source.receiptCheckUnavailable) add(source, 'RECEIPT_MISSING', 'ยังไม่มีไฟล์ใบเสร็จหรือใบกำกับภาษีในชุดนี้');
    if (source.sourceDocumentType === 'TAX_INVOICE') {
      if (!source.vendorTaxIdSnapshot?.trim()) add(source, 'INVOICE_TAX_ID', 'ใบกำกับภาษียังไม่มีเลขผู้เสียภาษีผู้ขาย');
      if (!source.vendorBranchCodeSnapshot?.trim()) add(source, 'INVOICE_BRANCH', 'ใบกำกับภาษียังไม่มีสาขาผู้ขาย');
    }
    if (source.substituteStatuses?.some(status => ['PREPARED', 'PAYER_CERTIFIED'].includes(status))) add(source, 'SUBSTITUTE_UNSIGNED', 'ใบรับรองแทนใบเสร็จยังเซ็นไม่ครบ');
    if (decimalAmount(source.whtAmount).gt(0) && source.whtRemittance !== 'E_WHT') {
      if (!certificatesVisible) add(source, 'WHT_CERTIFICATE_UNCHECKED', 'สิทธิ์นี้ตรวจหนังสือรับรอง 50 ทวิไม่ได้');
      else if (!source.certificateNumber) add(source, 'WHT_CERTIFICATE_MISSING', 'ยังไม่มีหนังสือรับรอง 50 ทวิในข้อมูลที่ส่งออก');
    }
    for (const [index, payment] of (source.payments ?? []).entries()) {
      if (payment.status === 'RECORDED' && payment.paidAtConfirmed === false) add(source, `PAYMENT_DATE_UNCONFIRMED:${payment.id ?? index}`, 'การจ่ายครั้งนี้ยังไม่ยืนยันวันที่');
    }
    if (decimalAmount(source.outstandingAmount).gt(0) || ['UNPAID', 'PARTIALLY_PAID'].includes(source.paymentStatus ?? '') && decimalAmount(source.netPayableAmount).gt(0)) add(source, 'OUTSTANDING', 'รายการนี้ยังจ่ายไม่ครบ');
    if (source.claimProblem) add(source, source.claimProblem.key, source.claimProblem.message);
    if (source.sourceEvidenceUnavailable) add(source, 'FILE_SKIPPED:source', 'หลักฐานต้นทางบางส่วนไม่พร้อมใช้งาน');
    for (const file of files) if ((file.expenseIds ? file.expenseIds.includes(source.id) : file.expenseNumber === source.expenseNumber) && file.skippedReason) add(source, `FILE_SKIPPED:${file.path}`, file.skippedReason);
  }
  return issues;
}

export function buildAccountantPurchaseTaxRows(records: readonly AccountantTaxRecord[], context: AccountantPurchaseContext): PurchaseProjection {
  const columns = ['ลำดับที่', 'วัน เดือน ปี', 'เลขที่/เล่มที่', 'ชื่อผู้ขายสินค้า/ผู้ให้บริการ', 'เลขประจำตัวผู้เสียภาษีอากรของผู้ขายสินค้า/ผู้ให้บริการ',
    'สำนักงานใหญ่', 'สาขาที่', 'มูลค่าสินค้าหรือบริการ', 'จำนวนเงินภาษีมูลค่าเพิ่ม'];
  const sheet: WorkbookSheet = { name: ACCOUNTANT_WORKBOOK_SHEETS.purchaseTax, freezeRows: 1, rows: [] };
  const included: PurchaseProjection['included'] = [], excluded: PurchaseExclusion[] = [];
  const blocks = new Map<string, { source: AccountantExportSource; base: string; vat: string }[]>();
  for (const record of records) {
    const source = record.source, day = sourceDay(source), key = `${day.slice(0, 7)}:${source.branchId ?? ''}`;
    if (!blocks.has(key)) blocks.set(key, []);
    const block = blocks.get(key)!;
    if (record.error) { excluded.push({ source, reason: record.error, base: String(source.taxableAmount), vat: String(source.vatAmount) }); continue; }
    for (const group of record.groups) {
      if (decimalAmount(group.vatAmount).isZero()) continue;
      let reason = '';
      if (group.inputVatRight !== 'ใช้ได้ตามเงื่อนไข') reason = `สิทธิภาษีซื้อ${group.inputVatRight}`;
      else if (source.status !== 'CONFIRMED') reason = 'รายการยังไม่ยืนยัน';
      else if (source.currency.toUpperCase() !== 'THB') reason = 'ยอดเป็นสกุลเงินอื่น ยังไม่มีอัตราแปลงเป็นบาท';
      else if (!day) reason = 'ยังไม่มีวันที่เอกสารที่ยืนยันแล้ว';
      else {
        const registration = effectiveVatStatus(context.registrationFacts ?? [], day as Parameters<typeof effectiveVatStatus>[1]);
        if (registration === 'NOT_REGISTERED') reason = 'ร้านไม่ได้จด VAT ในช่วงรายการนี้ จึงไม่มีรายงานภาษีซื้อ';
        else if (registration === 'UNKNOWN') reason = 'ยังไม่มีข้อมูลยืนยันการจด VAT ของร้านในช่วงรายการนี้';
      }
      const branch = context.branches?.find(row => row.id === source.branchId);
      if (!reason && (!context.company?.registeredName?.trim() || !/^\d{13}$/.test(context.company.taxId ?? '')
        || !branch?.isVatEstablishment || !branch.name.trim() || !/^\d{5}$/.test(branch.taxBranchCode ?? ''))) reason = 'ข้อมูลร้านยังไม่ครบสำหรับรายงานภาษีซื้อ';
      if (!reason && (!source.vendorDocumentNumber?.trim() || !source.vendorNameSnapshot?.trim()
        || source.sourceDocumentType === 'TAX_INVOICE' && (!/^\d{13}$/.test(source.vendorTaxIdSnapshot ?? '') || !/^\d{5}$/.test(source.vendorBranchCodeSnapshot ?? '')))) reason = 'ข้อมูลผู้ขายหรือเลขที่เอกสารยังไม่ครบ';
      if (reason) excluded.push({ source, reason, base: group.taxableAmount, vat: group.vatAmount });
      else block.push({ source, base: group.taxableAmount, vat: group.vatAmount });
    }
  }
  const receiptOrder = (source: AccountantExportSource) => {
    const value = source.receivedAt ?? source.uploadedAt;
    return value instanceof Date ? value.getTime() : Date.parse(value ?? sourceDay(source)) || 0;
  };
  const monthFormatter = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
  for (const [key, entries] of [...blocks].sort(([a], [b]) => a.localeCompare(b))) {
    const [month, branchId] = key.split(':');
    const branch = context.branches?.find(row => row.id === branchId);
    const monthLabel = month ? monthFormatter.format(new Date(`${month}-01T00:00:00Z`)) : 'ยังไม่ระบุเดือน';
    sheet.rows.push(['เดือนภาษี', monthLabel], ['ชื่อผู้ประกอบการ', context.company?.registeredName?.trim() || 'ยังไม่ระบุ'],
      ['เลขประจำตัวผู้เสียภาษีอากร', context.company?.taxId?.trim() || 'ยังไม่ระบุ'], ['ชื่อสถานประกอบการ', branch?.name ?? 'ยังไม่ระบุ'],
      ['สำนักงานใหญ่/สาขาที่', branch?.taxBranchCode === '00000' ? 'สำนักงานใหญ่' : branch?.taxBranchCode ?? 'ยังไม่ระบุ']);
    const selectedRecords = records.filter(record => `${sourceDay(record.source).slice(0, 7)}:${record.source.branchId ?? ''}` === key);
    if (!entries.length) {
      const reasons = [...new Set(excluded.filter(row => selectedRecords.some(record => record.source.id === row.source.id)).map(row => row.reason))];
      const statuses = selectedRecords.map(record => {
        const day = sourceDay(record.source);
        return day ? effectiveVatStatus(context.registrationFacts ?? [], day as Parameters<typeof effectiveVatStatus>[1]) : 'UNKNOWN';
      });
      const message = statuses.every(status => status === 'NOT_REGISTERED') ? 'ร้านไม่ได้จด VAT ในช่วงรายการนี้ จึงไม่มีรายงานภาษีซื้อ'
        : statuses.every(status => status === 'UNKNOWN') ? 'ยังไม่มีข้อมูลยืนยันการจด VAT ของร้านในช่วงรายการนี้'
          : reasons.find(reason => reason.startsWith('ข้อมูลร้าน')) ?? 'ไม่พบรายการภาษีซื้อที่ใช้สิทธิได้ในชุดที่เลือก';
      sheet.rows.push([message]);
      continue;
    }
    const documents = new Map<string, typeof entries[number]>();
    for (const entry of entries) {
      const previous = documents.get(entry.source.id);
      documents.set(entry.source.id, { source: entry.source, base: decimalAmount(previous?.base).plus(entry.base).toFixed(2), vat: decimalAmount(previous?.vat).plus(entry.vat).toFixed(2) });
    }
    const ordered = [...documents.values()].sort((a, b) => receiptOrder(a.source) - receiptOrder(b.source)
      || (a.source.expenseNumber ?? '').localeCompare(b.source.expenseNumber ?? '') || a.source.id.localeCompare(b.source.id));
    sheet.rows.push(columns);
    for (const [index, entry] of ordered.entries()) {
      included.push(entry);
      const source = entry.source;
      sheet.rows.push([index + 1, formatThaiExportDate(sourceDay(source)), source.vendorDocumentNumber ?? '', source.vendorNameSnapshot ?? '', source.vendorTaxIdSnapshot ?? '',
        source.vendorBranchCodeSnapshot === '00000' ? '✓' : '', source.vendorBranchCodeSnapshot === '00000' ? '' : source.vendorBranchCodeSnapshot ?? '', accountantMoney(entry.base), accountantMoney(entry.vat)]);
    }
    sheet.rows.push(['รวม', '', '', '', '', '', '', accountantMoney(ordered.reduce((sum, entry) => sum.plus(entry.base), new Decimal(0))), accountantMoney(ordered.reduce((sum, entry) => sum.plus(entry.vat), new Decimal(0)))]);
  }
  if (!records.length) sheet.rows.push(['ไม่พบรายการภาษีซื้อที่ใช้สิทธิได้ในชุดที่เลือก']);
  sheet.rows.push(['จัดตามเดือนวันที่เอกสาร ระบบยังไม่ได้เก็บเดือนที่ใช้สิทธิภาษีซื้อ'], ['แสดงเฉพาะรายจ่ายที่เลือก ให้สำนักงานบัญชีตรวจเดือนใช้สิทธิก่อนใช้รายงาน'],
    ['รายการที่ไม่มีวันที่รับเอกสารเรียงตามวันที่ส่งเข้า']);
  if (excluded.length) {
    sheet.rows.push(['รายการที่ไม่อยู่ในรายงาน', 'เหตุผล', 'สกุลเงิน', 'มูลค่าก่อน VAT', 'VAT']);
    for (const entry of excluded) {
      const row = context.expenseRows?.get(entry.source.id), number = entry.source.expenseNumber ?? 'ยังไม่มีเลขที่';
      const link = row ? { value: number, formula: `HYPERLINK("#'${ACCOUNTANT_WORKBOOK_SHEETS.expenses}'!A${row}","${number.replace(/"/g, '""')}")` } : number;
      sheet.rows.push([link, entry.reason, accountantCurrencyLabel(entry.source.currency), accountantMoney(entry.base), accountantMoney(entry.vat)]);
    }
  }
  return { sheet, included, excluded };
}

export function buildAccountantMonthSummary(records: readonly AccountantTaxRecord[], payments: readonly AccountantPaymentRow[], withholding: readonly AccountantWithholdingRow[], bankRemitted: readonly AccountantWithholdingRow[], purchase: PurchaseProjection): WorkbookSheet {
  const entries = new Map<string, { kind: string; name: string; currency: string; amounts: Decimal[]; ids: Set<string> }>();
  const add = (kind: string, name: string, source: { id: string; currency: string }, amounts: readonly (MoneyValue | undefined)[], groupKey = name) => {
    const currency = source.currency.toUpperCase(), key = JSON.stringify([kind, groupKey, currency]);
    let entry = entries.get(key);
    if (!entry) { entry = { kind, name, currency, amounts: Array.from({ length: 7 }, () => new Decimal(0)), ids: new Set() }; entries.set(key, entry); }
    entry.ids.add(source.id);
    for (let index = 0; index < entry.amounts.length; index++) entry.amounts[index] = entry.amounts[index]!.plus(decimalAmount(amounts[index]));
  };
  const selectedIds = new Set(records.map(record => record.source.id));
  const selectedNumbers = new Set(records.map(record => record.source.expenseNumber));
  for (const { source, groups, error } of records) {
    add('รายจ่ายที่เลือก', 'รวม', source, [source.taxableAmount, source.vatAmount, source.grandTotalAmount, source.whtAmount, source.netPayableAmount, source.paidAmount, source.outstandingAmount]);
    if (error) {
      add('สิทธิภาษีซื้อ', 'รอตรวจสอบ', source, [source.taxableAmount, source.vatAmount]);
      add('แยกตามหมวด', error, source, [source.taxableAmount, source.vatAmount, source.grandTotalAmount]);
      add('แยกตาม VAT', error, source, [source.taxableAmount, source.vatAmount, source.grandTotalAmount]);
    }
    for (const group of groups) {
      const amounts = [group.taxableAmount, group.vatAmount, decimalAmount(group.taxableAmount).plus(group.vatAmount).toFixed(2)];
      add('แยกตามหมวด', group.categoryNames.join(', ') || 'ยังไม่ระบุหมวด', source, amounts, group.categoryIds.join(','));
      add('แยกตาม VAT', ({ STANDARD: 'มี VAT', ZERO_RATED: 'VAT 0%', EXEMPT: 'ยกเว้น VAT', NON_VAT: 'ไม่มี VAT' } as Record<string, string>)[group.vatTreatment] ?? 'ยังไม่ระบุการใช้ VAT', source, amounts);
      add('สิทธิภาษีซื้อ', group.inputVatRight, source, amounts);
    }
    const rounding = decimalAmount(source.grandTotalAmount).minus(decimalAmount(source.taxableAmount)).minus(decimalAmount(source.vatAmount));
    if (!error && !rounding.isZero()) add('แยกตามหมวด', 'ส่วนต่างปัดเศษยอดรวม', source, ['0', '0', rounding.toFixed(2)]);
    const selectedWht = [...withholding, ...bankRemitted].filter(row => row.sourceExpenseId === source.id || !row.sourceExpenseId && row.expense_number === source.expenseNumber)
      .reduce((sum, row) => sum.plus(decimalAmount(String(row.withheld_amount ?? 0))), new Decimal(0));
    add('ส่วนต่างหัก ณ ที่จ่าย', 'ภาษีทั้งเอกสารเทียบกับการจ่ายในช่วง', source, ['0', '0', '0', decimalAmount(source.whtAmount).minus(selectedWht).toFixed(2)]);
    for (const [index, payment] of (source.payments ?? []).entries()) if (payment.paidAtConfirmed === false && payment.status === 'RECORDED') {
      add('การจ่ายที่ยังไม่ยืนยันวันที่', 'ยอดจ่ายที่ยังไม่ยืนยันวันที่', { id: payment.id ?? `${source.id}-${index}`, currency: source.currency }, ['0', '0', '0', '0', '0', payment.amount]);
    }
  }
  for (const [index, payment] of payments.entries()) add('การจ่ายในช่วง', 'รวม', { id: String(index), currency: String(payment.currency ?? '') }, ['0', '0', '0', '0', '0', String(payment.amount ?? 0)]);
  const formLabels: Record<string, string> = { PND2: 'ภ.ง.ด.2', PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' };
  for (const [index, row] of withholding.entries()) {
    const selected = row.sourceExpenseId ? selectedIds.has(row.sourceExpenseId) : selectedNumbers.has(String(row.expense_number));
    const rate = row.rate == null || row.rate === '' || !Number.isFinite(Number(row.rate)) ? null : new Decimal(String(row.rate)).toString();
    const name = `${formLabels[String(row.form_type)] ?? 'ยังไม่ระบุแบบ'} · ${rate === null ? 'ยังไม่ระบุอัตรา' : `${rate}%`}`;
    add(selected ? 'หัก ณ ที่จ่ายในช่วง' : 'หัก ณ ที่จ่ายจากรายจ่ายนอกช่วงเอกสาร', name, { id: String(index), currency: String(row.currency ?? '') },
      [String(row.gross_amount ?? 0), '0', '0', String(row.withheld_amount ?? 0)], JSON.stringify([row.form_type, rate]));
  }
  for (const [index, row] of bankRemitted.entries()) add('e-WHT', 'ธนาคารนำส่งในช่วง', { id: String(index), currency: String(row.currency ?? '') }, [String(row.gross_amount ?? 0), '0', '0', String(row.withheld_amount ?? 0)]);
  for (const entry of purchase.included) add('ภาษีซื้อในรายงาน', 'ใช้สิทธิได้และข้อมูลครบ', entry.source, [entry.base, entry.vat]);
  for (const entry of purchase.excluded) add('ภาษีซื้อที่ไม่อยู่ในรายงาน', entry.reason, entry.source, [entry.base, entry.vat]);
  return { name: ACCOUNTANT_WORKBOOK_SHEETS.summary, freezeRows: 1,
    rows: [['หัวข้อ', 'รายการ', 'สกุลเงิน', 'มูลค่าก่อน VAT', 'VAT', 'ยอดรวมตามเอกสาร', 'หัก ณ ที่จ่าย', 'ยอดจ่ายสุทธิ', 'จ่ายแล้ว', 'ค้างจ่าย', 'จำนวนรายการ'],
      ...[...entries.values()].map(entry => [entry.kind, entry.name, accountantCurrencyLabel(entry.currency), ...entry.amounts.map(value => accountantMoney(value)), entry.ids.size]),
      ...(!entries.size ? [['ไม่มีรายการตามที่เลือก']] : [])] };
}
