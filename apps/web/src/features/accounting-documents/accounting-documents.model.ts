// Web-side model types for accounting documents (mirrors backend contracts)
import type { TaxHeaderSummary, TransactionTaxComponentPreview, TransactionTaxSnapshot } from '@watchdog-bms/contracts';

export type AccountingDocumentType =
  | 'QUOTATION' | 'INVOICE' | 'BILLING_NOTE' | 'RECEIPT'
  | 'TAX_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';

export type AccountingDocumentStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  | 'ISSUED' | 'VOIDED' | 'CREDITED' | 'DEBITED' | 'CLOSED';

export type AccountingPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOIDED';
export type AccountingPostingStatus = 'not_required' | 'pending' | 'posted' | 'posting_error' | 'reversed';
export type AccountingVatMode = 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT';
export type AccountingOutputTaxCode = 'O7' | 'OX' | 'O0';
export type AccountingPaymentDirection = 'RECEIVED' | 'PAID';
export type AccountingPaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'OTHER';
export type AccountingCounterpartyType = 'CUSTOMER' | 'VENDOR' | 'BOTH';
export type AccountingCounterpartyStatus = 'ACTIVE' | 'ARCHIVED';

export type CounterpartySummary = {
  id: string;
  companyId: string;
  type: AccountingCounterpartyType;
  displayName: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  status: AccountingCounterpartyStatus;
  createdAt: string;
  updatedAt: string;
};

export type DocumentLineSummary = {
  id: string;
  lineNumber: number;
  productId?: string;
  skuSnapshot?: string;
  description: string;
  unitName?: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatRate?: string;
  vatAmount: string;
  whtRate?: string;
  whtAmount?: string;
  lineSubtotalAmount?: string;
  lineTotalAmount: string;
  correctionBasisAmount?: string;
  taxCategory?: string;
  revenueCategory?: string;
  taxSnapshot?: TransactionTaxSnapshot;
  taxComponents?: TransactionTaxComponentPreview[];
};

export type DocumentSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  documentType: AccountingDocumentType;
  documentNumber?: string;
  status: AccountingDocumentStatus;
  documentDate: string;
  dueDate?: string;
  counterpartyId?: string;
  counterpartyDisplayName?: string;
  currency: string;
  vatMode: AccountingVatMode;
  outputTaxCode?: AccountingOutputTaxCode;
  taxCodeSummary?: TaxHeaderSummary;
  grandTotalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentStatus?: AccountingPaymentStatus;
  postingStatus: AccountingPostingStatus;
  createdAt: string;
  updatedAt: string;
};

export type DocumentDetail = DocumentSummary & {
  sourceDocumentId?: string;
  sourceDocumentType?: string;
  convertedFromDocumentId?: string;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  note?: string;
  issuedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  approvalStatus?: string;
  submittedByUserId?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  rejectedAt?: string;
  approvalNote?: string;
  lines: DocumentLineSummary[];
};

export type PaymentSummary = {
  id: string;
  companyId: string;
  direction: AccountingPaymentDirection;
  status: string;
  method: AccountingPaymentMethod;
  amount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  currency: string;
  paidAt: string;
  postingStatus: AccountingPostingStatus;
  createdAt: string;
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const DOCUMENT_TYPE_LABELS: Record<AccountingDocumentType, string> = {
  QUOTATION: 'ใบเสนอราคา',
  INVOICE: 'ใบแจ้งหนี้',
  BILLING_NOTE: 'ใบวางบิล',
  RECEIPT: 'ใบเสร็จรับเงิน',
  TAX_INVOICE: 'ใบกำกับภาษี',
  CREDIT_NOTE: 'ใบลดหนี้',
  DEBIT_NOTE: 'ใบเพิ่มหนี้',
};

export const DOCUMENT_STATUS_LABELS: Record<AccountingDocumentStatus, string> = {
  DRAFT: 'ร่าง',
  PENDING_APPROVAL: 'รอการอนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  ISSUED: 'ออกแล้ว',
  VOIDED: 'ยกเลิกแล้ว',
  CREDITED: 'ออกใบลดหนี้แล้ว',
  DEBITED: 'ออกใบเพิ่มหนี้แล้ว',
  CLOSED: 'ปิดแล้ว',
};

export const PAYMENT_STATUS_LABELS: Record<AccountingPaymentStatus, string> = {
  UNPAID: 'ยังไม่ชำระ',
  PARTIALLY_PAID: 'ชำระบางส่วน',
  PAID: 'ชำระแล้ว',
  OVERDUE: 'เกินกำหนด',
  VOIDED: 'ยกเลิกแล้ว',
};

export const PAYMENT_METHOD_LABELS: Record<AccountingPaymentMethod, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  CARD: 'บัตร',
  CHEQUE: 'เช็ค',
  OTHER: 'อื่นๆ',
};

export const OUTPUT_TAX_CODE_LABELS: Record<AccountingOutputTaxCode, string> = {
  O7: 'O7 — ภาษีขาย 7%',
  OX: 'OX — ยกเว้นภาษีขาย',
  O0: 'O0 — ภาษีขาย 0%',
};
