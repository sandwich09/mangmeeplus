// ---- Item 08: Accounting Documents MVP ----

export type AccountingDocumentType =
  | 'QUOTATION'
  | 'INVOICE'
  | 'BILLING_NOTE'
  | 'RECEIPT'
  | 'TAX_INVOICE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE';

export type AccountingDocumentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'ISSUED'
  | 'VOIDED'
  | 'CREDITED'
  | 'DEBITED'
  | 'CLOSED';

export type AccountingPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOIDED';
export type AccountingPostingStatus = 'not_required' | 'pending' | 'posted' | 'posting_error' | 'reversed';
export type AccountingVatMode = 'NO_VAT' | 'VAT_INCLUDED' | 'VAT_EXCLUDED' | 'EXEMPT';
export type AccountingOutputTaxCode = 'O7' | 'OX' | 'O0';
export type AccountingPaymentDirection = 'RECEIVED' | 'PAID';
export type AccountingPaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'OTHER';
export type AccountingPaymentRecordStatus = 'DRAFT' | 'RECORDED' | 'VOIDED';
export type AccountingCounterpartyType = 'CUSTOMER' | 'VENDOR' | 'BOTH';
export type AccountingCounterpartyStatus = 'ACTIVE' | 'ARCHIVED';
export type AccountingTaxInvoiceType = 'FULL' | 'ABBREVIATED';
export type AccountingQuotationApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AccountingCounterpartySummary = {
  id: string;
  companyId: string;
  type: AccountingCounterpartyType;
  displayName: string;
  legalName?: string;
  taxId?: string;
  branchCode?: string;
  email?: string;
  phone?: string;
  status: AccountingCounterpartyStatus;
  createdAt: string;
  updatedAt: string;
};

export type AccountingCounterpartyDetail = AccountingCounterpartySummary & {
  billingAddressJson?: Record<string, unknown>;
  shippingAddressJson?: Record<string, unknown>;
};

export type AccountingDocumentLineSummary = {
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
  whtAmount: string;
  lineSubtotalAmount: string;
  lineTotalAmount: string;
  taxCategory?: string;
  revenueCategory?: string;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type AccountingDocumentSummary = {
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
  taxCodeSummary?: import('./transaction-tax.js').TaxHeaderSummary;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentStatus?: AccountingPaymentStatus;
  postingStatus: AccountingPostingStatus;
  createdAt: string;
  updatedAt: string;
};

export type AccountingDocumentDetail = AccountingDocumentSummary & {
  counterpartySnapshotJson?: Record<string, unknown>;
  sourceDocumentId?: string;
  sourceDocumentType?: string;
  convertedFromDocumentId?: string;
  unappliedCreditAmount?: string;
  taxStatus?: string;
  taxInvoiceType?: AccountingTaxInvoiceType;
  taxInvoiceId?: string;
  journalEntryId?: string;
  postingError?: string;
  note?: string;
  internalMemo?: string;
  issuedByUserId?: string;
  issuedAt?: string;
  voidedByUserId?: string;
  voidedAt?: string;
  voidReason?: string;
  approvalStatus?: AccountingQuotationApprovalStatus;
  submittedForApprovalAt?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  rejectedByUserId?: string;
  rejectedAt?: string;
  approvalNote?: string;
  lines: AccountingDocumentLineSummary[];
};

export type AccountingPaymentSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  paymentNumber?: string;
  direction: AccountingPaymentDirection;
  status: AccountingPaymentRecordStatus;
  counterpartyId?: string;
  counterpartyDisplayName?: string;
  method: AccountingPaymentMethod;
  /** Cash that moved. Bank reconciliation matches on this, so it excludes withheld tax. */
  amount: string;
  /** Tax the payer withheld from us. Settles the document without reaching the bank. */
  whtAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  currency: string;
  paidAt: string;
  postingStatus: AccountingPostingStatus;
  createdAt: string;
  updatedAt: string;
};

export type AccountingPaymentDetail = AccountingPaymentSummary & {
  counterpartySnapshotJson?: Record<string, unknown>;
  bankAccountRef?: string;
  externalReference?: string;
  note?: string;
  journalEntryId?: string;
  voidedByUserId?: string;
  voidedAt?: string;
  voidReason?: string;
  allocations: { id: string; documentId: string; documentNumber?: string; amount: string; whtAmount?: string; allocatedAt: string }[];
};

export type AccountingSourcePostingInput = {
  companyId: string;
  branchId?: string;
  sourceType: string;
  sourceId: string;
  sourceEventType: string;
  idempotencyKey: string;
  documentType?: AccountingDocumentType;
  documentId?: string;
  documentNumber?: string;
  documentDate?: string;
  counterpartyId?: string;
  counterpartySnapshot?: Record<string, unknown>;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  paidAmount?: string;
  outstandingAmount?: string;
  unappliedCreditAmount?: string;
  taxInvoiceRef?: string;
  outputTaxCode?: AccountingOutputTaxCode;
  taxCodeSummary?: import('./transaction-tax.js').TaxHeaderSummary;
  reversalOf?: string;
  postingStatus: AccountingPostingStatus;
  lines: AccountingSourcePostingLine[];
  paymentAllocations?: AccountingSourcePostingPayment[];
};

export type AccountingSourcePostingLine = {
  lineNumber: number;
  productId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxableAmount: string;
  vatRate?: string;
  vatAmount: string;
  whtRate?: string;
  whtAmount: string;
  lineTotalAmount: string;
  taxCategory?: string;
  revenueCategory?: string;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type AccountingSourcePostingPayment = {
  paymentId: string;
  amount: string;
  currency: string;
  direction: AccountingPaymentDirection;
  method: AccountingPaymentMethod;
  paidAt: string;
};

// List/filter DTOs
export type ListAccountingDocumentsFilter = {
  documentType?: AccountingDocumentType;
  status?: AccountingDocumentStatus;
  paymentStatus?: AccountingPaymentStatus;
  postingStatus?: AccountingPostingStatus;
  counterpartyId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type ListAccountingPaymentsFilter = {
  direction?: AccountingPaymentDirection;
  status?: AccountingPaymentRecordStatus;
  counterpartyId?: string;
  method?: AccountingPaymentMethod;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

// Document sequence keys
export const ACCOUNTING_SEQUENCE_KEYS = {
  QUOTATION: 'accounting.quotation',
  INVOICE: 'accounting.invoice',
  BILLING_NOTE: 'accounting.billing_note',
  RECEIPT: 'accounting.receipt',
  TAX_INVOICE: 'tax.invoice',
  PAYMENT: 'accounting.payment',
  CREDIT_NOTE: 'accounting.credit_note',
  DEBIT_NOTE: 'accounting.debit_note',
} as const;

export const ACCOUNTING_OUTPUT_TAX_CODE_LABELS: Record<AccountingOutputTaxCode, string> = {
  O7: 'ภาษีขาย 7%',
  OX: 'ยกเว้นภาษีขาย',
  O0: 'ภาษีขาย 0%',
};
