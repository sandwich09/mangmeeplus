/**
 * Domain models for accounting documents (Item 08).
 * These are plain TypeScript types, not Prisma models.
 */

import type {
  AccountingDocumentType,
  AccountingDocumentStatus,
  AccountingPaymentStatus,
  AccountingPostingStatus,
  AccountingVatMode,
  AccountingOutputTaxCode,
  AccountingPaymentDirection,
  AccountingPaymentMethod,
  AccountingPaymentRecordStatus,
  AccountingCounterpartyType,
  AccountingCounterpartyStatus,
  AccountingTaxInvoiceType,
  AccountingQuotationApprovalStatus,
  AccountingDocumentLineSummary,
  ResolveTransactionTaxPreviewDto,
  TransactionTaxContext,
  TransactionTaxSnapshot,
} from '@watchdog-bms/contracts';

export type CounterpartyRecord = {
  id: string;
  companyId: string;
  type: AccountingCounterpartyType;
  displayName: string;
  legalName?: string;
  taxId?: string;
  branchCode?: string;
  email?: string;
  phone?: string;
  billingAddressJson?: Record<string, unknown>;
  shippingAddressJson?: Record<string, unknown>;
  status: AccountingCounterpartyStatus;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentLineRecord = {
  id: string;
  companyId: string;
  documentId: string;
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
  taxSnapshot?: TransactionTaxSnapshot;
  taxComponents?: ResolveTransactionTaxPreviewDto['components'];
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  documentType: AccountingDocumentType;
  documentNumber?: string;
  status: AccountingDocumentStatus;
  documentDate: Date;
  dueDate?: Date;
  counterpartyId?: string;
  counterpartySnapshotJson?: Record<string, unknown>;
  sourceDocumentId?: string;
  sourceDocumentType?: string;
  convertedFromDocumentId?: string;
  currency: string;
  vatMode: AccountingVatMode;
  outputTaxCode?: AccountingOutputTaxCode;
  taxCodeSummary?: import('@watchdog-bms/contracts').TaxHeaderSummary;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  unappliedCreditAmount?: string;
  paymentStatus?: AccountingPaymentStatus;
  taxStatus?: string;
  taxInvoiceType?: AccountingTaxInvoiceType;
  taxInvoiceId?: string;
  postingStatus: AccountingPostingStatus;
  journalEntryId?: string;
  postingError?: string;
  note?: string;
  internalMemo?: string;
  issuedByUserId?: string;
  issuedAt?: Date;
  voidedByUserId?: string;
  voidedAt?: Date;
  voidReason?: string;
  approvalStatus?: AccountingQuotationApprovalStatus;
  submittedByUserId?: string;
  submittedAt?: Date;
  approvedByUserId?: string;
  approvedAt?: Date;
  rejectedByUserId?: string;
  rejectedAt?: Date;
  approvalNote?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  lines?: DocumentLineRecord[];
};

export type PaymentRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  paymentNumber?: string;
  direction: AccountingPaymentDirection;
  status: AccountingPaymentRecordStatus;
  counterpartyId?: string;
  counterpartySnapshotJson?: Record<string, unknown>;
  method: AccountingPaymentMethod;
  /** Cash that moved; bank reconciliation matches on it. */
  amount: string;
  /** Tax the payer withheld from us — settles the document but never reaches the bank. */
  whtAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  currency: string;
  paidAt: Date;
  bankAccountRef?: string;
  externalReference?: string;
  note?: string;
  postingStatus: AccountingPostingStatus;
  journalEntryId?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  voidedByUserId?: string;
  voidedAt?: Date;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentAllocationRecord = {
  id: string;
  companyId: string;
  paymentId: string;
  documentId: string;
  amount: string;
  currency: string;
  allocatedAt: Date;
  createdByUserId: string;
  createdAt: Date;
};

// Input types for create/update operations
export type CreateCounterpartyInput = {
  companyId: string;
  type: AccountingCounterpartyType;
  displayName: string;
  legalName?: string;
  taxId?: string;
  branchCode?: string;
  email?: string;
  phone?: string;
  billingAddressJson?: Record<string, unknown>;
  shippingAddressJson?: Record<string, unknown>;
  createdByUserId: string;
};

export type UpdateCounterpartyInput = {
  companyId: string;
  counterpartyId: string;
  displayName?: string;
  legalName?: string;
  taxId?: string;
  branchCode?: string;
  email?: string;
  phone?: string;
  billingAddressJson?: Record<string, unknown>;
  shippingAddressJson?: Record<string, unknown>;
  status?: AccountingCounterpartyStatus;
  updatedByUserId: string;
};

export type CreateDocumentLineInput = {
  lineNumber: number;
  productId?: string;
  skuSnapshot?: string;
  description: string;
  unitName?: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatRate?: string;
  whtRate?: string;
  taxCategory?: string;
  revenueCategory?: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  transactionContext?: TransactionTaxContext;
  evidenceRefs?: string[];
};

export type CreateDocumentInput = {
  companyId: string;
  branchId?: string;
  documentType: AccountingDocumentType;
  documentDate: string;
  dueDate?: string;
  counterpartyId?: string;
  sourceDocumentId?: string;
  sourceDocumentType?: string;
  convertedFromDocumentId?: string;
  currency?: string;
  vatMode: AccountingVatMode;
  outputTaxCode?: AccountingOutputTaxCode;
  note?: string;
  internalMemo?: string;
  lines: CreateDocumentLineInput[];
  createdByUserId: string;
};

export type CreatePaymentInput = {
  companyId: string;
  branchId?: string;
  direction: AccountingPaymentDirection;
  counterpartyId?: string;
  method: AccountingPaymentMethod;
  /** Cash received. Withheld tax settles the document too but never reaches the bank. */
  amount: string;
  /** Tax the customer withheld from us. Requires RECEIVED plus an allocation target. */
  whtAmount?: string;
  currency?: string;
  paidAt: string;
  bankAccountRef?: string;
  externalReference?: string;
  note?: string;
  allocateToDocumentId?: string;
  createdByUserId: string;
};

export type ListDocumentsFilter = {
  companyId: string;
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

export type PaginatedDocuments = {
  data: DocumentRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListPaymentsFilter = {
  companyId: string;
  direction?: AccountingPaymentDirection;
  status?: AccountingPaymentRecordStatus;
  counterpartyId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedPayments = {
  data: PaymentRecord[];
  total: number;
  page: number;
  pageSize: number;
};
