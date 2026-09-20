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

/** Revenue Code sections 82/9–82/10 and RD VAT Director-General Notification No. 82. */
export const ACCOUNTING_CREDIT_NOTE_REASON_CODES = [
  'GOODS_NOT_AS_AGREED',
  'GOODS_DAMAGED',
  'GOODS_QUANTITY_SHORT',
  'GOODS_PRICE_OVERSTATED',
  'SERVICES_NOT_AS_AGREED',
  'SERVICES_QUANTITY_SHORT',
  'SERVICES_PRICE_OVERSTATED',
  'GOODS_RETURNED',
  'SERVICE_CANCELLED',
  'LEGAL_COMPENSATION',
  'ADVANCE_OR_DEPOSIT_REFUND',
  'GOODS_RETURN_OR_EXCHANGE_TRADE_AGREEMENT',
  'SERVICE_DEFECT',
  'SERVICE_NOT_PROVIDED',
  'OTHER_PRESCRIBED',
] as const;

export const ACCOUNTING_DEBIT_NOTE_REASON_CODES = [
  'GOODS_QUANTITY_EXCESS',
  'GOODS_PRICE_UNDERSTATED',
  'SERVICES_EXCEED_AGREEMENT',
  'SERVICES_PRICE_UNDERSTATED',
  'OTHER_PRESCRIBED',
] as const;

export type AccountingAdjustmentReasonCode =
  | typeof ACCOUNTING_CREDIT_NOTE_REASON_CODES[number]
  | typeof ACCOUNTING_DEBIT_NOTE_REASON_CODES[number];

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

// Additive v2 shape for `AccountingCounterparty.billingAddressJson` (spec: vendor-address-and-
// counterparty-autosave §6). Every reader prefers `addressText` when present; existing writers
// (procurement's free-form addressJson, CON-9) keep working because they simply never populate
// these keys — the Prisma column stays untyped Json, this is a read/write contract on top of it,
// not a migration.
export const COUNTERPARTY_ADDRESS_SOURCES = ['MANUAL', 'EXPENSE_AUTO', 'RD_LOOKUP', 'OCR', 'PROCUREMENT'] as const;

export type CounterpartyAddressV2 = {
  /** What gets printed on a document. The only field every reader must check first. */
  addressText: string;
  postalCode?: string | null;
  /** Only when fetched from RD or entered as a structured address; never required. */
  structured?: import('./company-tax-identity.js').CompanyLegalAddress | null;
  provenance: {
    source: (typeof COUNTERPARTY_ADDRESS_SOURCES)[number];
    expenseId?: string;
    userId: string;
    at: string;
  };
  /** Other addresses seen on documents for this counterparty, newest first, capped at 5. */
  seenOnDocuments?: Array<{ addressText: string; expenseId: string; at: string }>;
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
  /** Current value available to the next correction after prior issued credit/debit notes. */
  correctionBasisAmount?: string;
  taxCategory?: string;
  revenueCategory?: string;
  /** FK to the RevenueCategory master (live row); `revenueCategory` above is the immutable
   *  name snapshot frozen at issue time. */
  revenueCategoryId?: string;
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
  adjustmentReasonCode?: AccountingAdjustmentReasonCode;
  adjustmentReasonText?: string;
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

// ---- Revenue categories (accounting.revenue_category.manage) ----
// Income-expense-ledger spec F-LED-2: company-scoped master for income categories.

export type RevenueCategoryStatus = 'ACTIVE' | 'ARCHIVED';

export type RevenueCategorySummary = {
  id: string;
  companyId: string;
  name: string;
  accountHintKey: string;
  /** Suggested OUTPUT Tax Code, as its stable external code. Never a definition id. */
  defaultOutputTaxCode: string | null;
  status: RevenueCategoryStatus;
  sortOrder: number;
};

export type CreateRevenueCategoryInput = {
  name: string;
  accountHintKey: string;
  defaultOutputTaxCode?: string;
  sortOrder?: number;
};

export type UpdateRevenueCategoryInput = {
  name?: string;
  accountHintKey?: string;
  defaultOutputTaxCode?: string | null;
  sortOrder?: number;
  status?: RevenueCategoryStatus;
};

export type RecordSimpleIncomeLineInput = {
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string;
  whtRate?: string;
  revenueCategoryId?: string;
};

export type RecordSimpleIncomeInput = {
  idempotencyKey: string;
  branchId?: string;
  documentDate: string;
  counterpartyId?: string;
  vatMode: AccountingVatMode;
  paymentMethod: AccountingPaymentMethod;
  note?: string;
  lines: RecordSimpleIncomeLineInput[];
};

export type RecordSimpleIncomeResult = {
  invoice: AccountingDocumentDetail;
  payment: AccountingPaymentSummary;
  receipt: AccountingDocumentDetail;
  replayed: boolean;
};

export type SalesDocumentRootAvailability = {
  canCreateSalesRoot: boolean;
};

export type IncomeExpenseLedgerCategoryAmount = {
  categoryId?: string;
  label: string;
  amount: string;
};

export type IncomeExpenseLedgerSideSummary = {
  available: boolean;
  unavailableReason?: 'NO_PERMISSION' | 'DATA_MISMATCH';
};

export type IncomeExpenseLedgerVatRegistrationAlert = {
  level: 'APPROACHING' | 'REACHED';
  periodBasis: 'ACCOUNTING_PERIOD';
  periodStart: string;
  periodEnd: string;
  salesDocumentTotal: string;
  thresholdAmount: string;
};

export type IncomeExpenseLedgerSummary = {
  period: { from: string; to: string; timezone: 'Asia/Bangkok' };
  income: IncomeExpenseLedgerSideSummary & {
    salesDocumentTotal?: string;
    receivedTotal?: string;
    withheldTaxTotal?: string;
    receivableOutstanding?: string;
    byCategory: IncomeExpenseLedgerCategoryAmount[];
    vatRegistrationAlert?: IncomeExpenseLedgerVatRegistrationAlert;
  };
  expense: IncomeExpenseLedgerSideSummary & {
    recordedExpenseTotal?: string;
    paidExpenseTotal?: string;
    byCategory: IncomeExpenseLedgerCategoryAmount[];
  };
  cashDifference?: string;
  documentDifference?: string;
};

export type IncomeExpenseLedgerEntryType = 'ALL' | 'INCOME' | 'EXPENSE' | 'RECEIVABLE';

export type IncomeExpenseLedgerEntry = {
  id: string;
  branchId?: string;
  side: 'INCOME' | 'EXPENSE';
  sourceType: 'accounting_document' | 'expense_record';
  date: string;
  dueDate?: string;
  referenceNumber?: string;
  counterpartyId?: string;
  partyName?: string;
  categoryLabels: string[];
  status: string;
  amount: string;
  outstandingAmount?: string;
  evidenceHref: string;
};

export type IncomeExpenseLedgerEntries = {
  period: { from: string; to: string; timezone: 'Asia/Bangkok' };
  data: IncomeExpenseLedgerEntry[];
  total: number;
  page: number;
  pageSize: number;
  includedSides: Array<'INCOME' | 'EXPENSE'>;
};

export type IncomeExpenseLedgerExport = {
  period: { from: string; to: string; timezone: 'Asia/Bangkok' };
  includedSides: Array<'INCOME' | 'EXPENSE'>;
  rowCount: number;
  csvFileName: string;
  csv: string;
  xlsxFileName: string;
  xlsxBase64: string;
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
