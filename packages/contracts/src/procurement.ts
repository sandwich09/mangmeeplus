// ---- Item 12: Procurement, Supplier, and Accounts Payable ----

// Runtime lists, with the types derived from them, so a value can be checked at
// the API boundary without a second hand-written copy that drifts from the type.
export const SUPPLIER_STATUSES = ['ACTIVE', 'ON_HOLD', 'ARCHIVED'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];
export const SUPPLIER_TYPES = ['JURISTIC_PERSON', 'INDIVIDUAL', 'FOREIGN', 'GOVERNMENT', 'OTHER'] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];
export type PurchaseRequestStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CONVERTED';
export type PurchaseOrderStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ISSUED'
  | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'PARTIALLY_BILLED' | 'BILLED' | 'CLOSED' | 'CANCELLED';
export type GoodsReceiptStatus = 'DRAFT' | 'POSTED' | 'VOIDED';
export type VendorBillStatus =
  | 'DRAFT' | 'NEEDS_REVIEW' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'PARTIALLY_PAID' | 'PAID' | 'VOIDED' | 'CREDITED';
export type SupplierPaymentStatus = 'DRAFT' | 'RECORDED' | 'VOIDED';
export const PURCHASE_LINE_TYPES = ['STOCK', 'SERVICE', 'NON_STOCK', 'ASSET_CANDIDATE', 'OTHER'] as const;
export type PurchaseLineType = (typeof PURCHASE_LINE_TYPES)[number];
export const PURCHASE_MATCHING_MODES = ['NONE', 'TWO_WAY_PO_BILL', 'THREE_WAY_PO_RECEIPT_BILL'] as const;
export type PurchaseMatchingMode = (typeof PURCHASE_MATCHING_MODES)[number];
export type PurchaseMatchingStatus = 'NOT_REQUIRED' | 'NOT_MATCHED' | 'MATCHED' | 'MATCHED_WITH_VARIANCE' | 'BLOCKED' | 'OVERRIDDEN';
// Import from expenses.js for internal use; index.ts already re-exports it from expenses.js
import type { InputVatClaimStatus } from './expenses.js';
export type ProcurementPostingStatus = 'not_required' | 'pending' | 'posted' | 'posting_error' | 'reversed';
export type ProcurementTaxSyncStatus = 'not_required' | 'pending' | 'synced' | 'sync_error' | 'reversed';
export const PROCUREMENT_VAT_MODES = ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT', 'NEEDS_REVIEW'] as const;
export type ProcurementVatMode = (typeof PROCUREMENT_VAT_MODES)[number];
// Stored in the shared AccountingPaymentMethod column, hence the cross-named
// registry entry in prisma-enum-parity.spec.ts.
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ---- Supplier ----

export type SupplierSummary = {
  id: string;
  companyId: string;
  counterpartyId: string;
  supplierCode?: string;
  supplierType: SupplierType;
  displayNameSnapshot: string;
  taxId?: string;
  branchCode?: string;
  status: SupplierStatus;
  defaultCurrency: string;
  email?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
};

export type SupplierDetail = SupplierSummary & {
  legalNameSnapshot?: string;
  vatRegistered?: boolean;
  defaultVatMode?: ProcurementVatMode;
  defaultInputVatClaimStatus?: InputVatClaimStatus;
  defaultWhtCategoryCode?: string;
  defaultPaymentTermsDays?: number;
  defaultExpenseCategoryKey?: string;
  defaultAccountHint?: string;
  contactName?: string;
  addressJson?: Record<string, unknown>;
  onHoldReason?: string;
};

export type CreateSupplierDto = {
  supplierCode?: string;
  supplierType?: SupplierType;
  displayName: string;
  legalName?: string;
  taxId?: string;
  branchCode?: string;
  vatRegistered?: boolean;
  defaultVatMode?: ProcurementVatMode;
  defaultInputVatClaimStatus?: InputVatClaimStatus;
  defaultWhtCategoryCode?: string;
  defaultPaymentTermsDays?: number;
  defaultExpenseCategoryKey?: string;
  defaultAccountHint?: string;
  defaultCurrency?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  addressJson?: Record<string, unknown>;
};

export type UpdateSupplierDto = {
  supplierCode?: string;
  supplierType?: SupplierType;
  displayName?: string;
  legalName?: string;
  taxId?: string;
  branchCode?: string;
  vatRegistered?: boolean;
  defaultVatMode?: ProcurementVatMode;
  defaultInputVatClaimStatus?: InputVatClaimStatus;
  defaultWhtCategoryCode?: string;
  defaultPaymentTermsDays?: number;
  defaultExpenseCategoryKey?: string;
  defaultAccountHint?: string;
  defaultCurrency?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  addressJson?: Record<string, unknown>;
  status?: SupplierStatus;
  onHoldReason?: string;
};

export type SupplierBankAccountSummary = {
  id: string;
  supplierId: string;
  bankName: string;
  bankCode?: string;
  accountName: string;
  accountNumberLast4: string;
  branchName?: string;
  isDefault: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
};

export type CreateSupplierBankAccountDto = {
  bankName: string;
  bankCode?: string;
  accountName: string;
  accountNumberLast4: string;
  branchName?: string;
  isDefault?: boolean;
};

// ---- Purchase Request ----

export type PurchaseRequestLineSummary = {
  id: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  description: string;
  unitName?: string;
  requestedQuantity: string;
  estimatedUnitPrice: string;
  discountAmount: string;
  vatMode: ProcurementVatMode;
  vatRate?: string;
  vatAmount: string;
  lineSubtotalAmount: string;
  lineTotalAmount: string;
  accountHint?: string;
  inventoryLocationId?: string;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type PurchaseRequestSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  requestNumber?: string;
  status: PurchaseRequestStatus;
  requesterUserId: string;
  neededByDate?: string;
  supplierId?: string;
  supplierDisplayName?: string;
  currency: string;
  grandTotalAmount: string;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseRequestDetail = PurchaseRequestSummary & {
  reason?: string;
  budgetCode?: string;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtEstimateAmount?: string;
  submittedAt?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  rejectedByUserId?: string;
  rejectedAt?: string;
  approvalNote?: string;
  convertedPurchaseOrderId?: string;
  lines: PurchaseRequestLineSummary[];
};

export type CreatePurchaseRequestLineDto = {
  lineNumber: number;
  lineType?: PurchaseLineType;
  productId?: string;
  description: string;
  unitName?: string;
  requestedQuantity: string;
  estimatedUnitPrice: string;
  discountAmount?: string;
  vatMode?: ProcurementVatMode;
  vatRate?: string;
  accountHint?: string;
  inventoryLocationId?: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type CreatePurchaseRequestDto = {
  branchId?: string;
  neededByDate?: string;
  supplierId?: string;
  reason?: string;
  budgetCode?: string;
  currency?: string;
  lines: CreatePurchaseRequestLineDto[];
};

export type ApproveRejectDto = {
  note?: string;
};

// ---- Purchase Order ----

export type PurchaseOrderLineSummary = {
  id: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  description: string;
  unitName?: string;
  orderedQuantity: string;
  receivedQuantity: string;
  billedQuantity: string;
  unitPrice: string;
  discountAmount: string;
  vatMode: ProcurementVatMode;
  vatRate?: string;
  vatAmount: string;
  whtCategoryCode?: string;
  whtRate?: string;
  whtEstimateAmount?: string;
  lineSubtotalAmount: string;
  lineTotalAmount: string;
  accountHint?: string;
  inventoryLocationId?: string;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type PurchaseOrderSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  purchaseOrderNumber?: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierDisplayName?: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  currency: string;
  grandTotalAmount: string;
  receivedAmount: string;
  billedAmount: string;
  outstandingAmount: string;
  matchingMode: PurchaseMatchingMode;
  postingStatus: ProcurementPostingStatus;
  taxSyncStatus: ProcurementTaxSyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderDetail = PurchaseOrderSummary & {
  sourcePurchaseRequestId?: string;
  paymentTermsDays?: number;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtEstimateAmount?: string;
  issuedAt?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  rejectedByUserId?: string;
  rejectedAt?: string;
  cancelReason?: string;
  closeReason?: string;
  lines: PurchaseOrderLineSummary[];
};

export type CreatePurchaseOrderLineDto = {
  lineNumber: number;
  lineType?: PurchaseLineType;
  productId?: string;
  description: string;
  unitName?: string;
  orderedQuantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatMode?: ProcurementVatMode;
  vatRate?: string;
  whtCategoryCode?: string;
  whtRate?: string;
  accountHint?: string;
  inventoryLocationId?: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type CreatePurchaseOrderDto = {
  supplierId: string;
  branchId?: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  paymentTermsDays?: number;
  currency?: string;
  matchingMode?: PurchaseMatchingMode;
  lines: CreatePurchaseOrderLineDto[];
};

export type CancelCloseDto = {
  reason: string;
};

// ---- Goods Receipt ----

export type GoodsReceiptLineSummary = {
  id: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  description: string;
  inventoryLocationId?: string;
  unitName?: string;
  orderedQuantity: string;
  previouslyReceivedQuantity: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  inventoryMovementId?: string;
  varianceReason?: string;
};

export type GoodsReceiptSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  goodsReceiptNumber?: string;
  status: GoodsReceiptStatus;
  purchaseOrderId: string;
  supplierId: string;
  supplierDisplayName?: string;
  receivedAt: string;
  receivedByUserId: string;
  postingStatus: ProcurementPostingStatus;
  createdAt: string;
  updatedAt: string;
};

export type GoodsReceiptDetail = GoodsReceiptSummary & {
  note?: string;
  inventoryMovementBatchRef?: string;
  voidedAt?: string;
  voidReason?: string;
  lines: GoodsReceiptLineSummary[];
};

export type CreateGoodsReceiptLineDto = {
  purchaseOrderLineId: string;
  lineNumber: number;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity?: string;
  inventoryLocationId?: string;
  varianceReason?: string;
};

export type CreateGoodsReceiptDto = {
  purchaseOrderId: string;
  branchId?: string;
  receivedAt?: string;
  note?: string;
  lines: CreateGoodsReceiptLineDto[];
};

export type VoidGoodsReceiptDto = {
  voidReason: string;
};

// ---- Vendor Bill ----

export type VendorBillLineSummary = {
  id: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  description: string;
  unitName?: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatMode: ProcurementVatMode;
  vatRate?: string;
  vatAmount: string;
  inputVatClaimStatus: InputVatClaimStatus;
  whtCategoryCode?: string;
  whtRate?: string;
  whtAmount: string;
  lineSubtotalAmount: string;
  lineTotalAmount: string;
  accountHint?: string;
  assetCandidate?: boolean;
  purchaseOrderLineId?: string;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type VendorBillSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  vendorBillNumber?: string;
  supplierDocumentNumber?: string;
  status: VendorBillStatus;
  supplierId: string;
  supplierDisplayName?: string;
  purchaseOrderId?: string;
  billDate: string;
  dueDate: string;
  currency: string;
  /** Pre-VAT base — what a withholding rate applies to when paying this bill. */
  taxableAmount: string;
  grandTotalAmount: string;
  /** Non-zero when the bill withheld at accrual, which forbids withholding again on payment. */
  whtAmount: string;
  netPayableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  matchingStatus: PurchaseMatchingStatus;
  inputVatClaimStatus: InputVatClaimStatus;
  pp36Candidate: boolean;
  taxEvidenceRequired: boolean;
  taxEvidenceReviewStatus: import('./transaction-tax.js').TaxEvidenceReviewStatus;
  reviewIssues: string[];
  postingStatus: ProcurementPostingStatus;
  taxSyncStatus: ProcurementTaxSyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type VendorBillDetail = VendorBillSummary & {
  goodsReceiptId?: string;
  receivedDate?: string;
  paymentTermsDays?: number;
  vatMode: ProcurementVatMode;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtCategoryCode?: string;
  whtRate?: string;
  whtAmount: string;
  matchingMode: PurchaseMatchingMode;
  matchingVarianceAmount: string;
  matchingOverrideReason?: string;
  taxInvoiceNumber?: string;
  taxInvoiceDate?: string;
  attachmentId?: string;
  taxEvidenceReviewedByUserId?: string;
  taxEvidenceReviewedAt?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  lines: VendorBillLineSummary[];
};

export type UpdateVendorBillTaxEvidenceDto = {
  taxInvoiceNumber: string;
  taxInvoiceDate: string;
  attachmentId: string;
};

export type ReviewVendorBillTaxEvidenceDto = {
  status: Extract<import('./transaction-tax.js').TaxEvidenceReviewStatus, 'VERIFIED' | 'REJECTED'>;
};

export type CreateVendorBillLineDto = {
  lineNumber: number;
  lineType?: PurchaseLineType;
  productId?: string;
  description: string;
  unitName?: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatMode?: ProcurementVatMode;
  vatRate?: string;
  inputVatClaimStatus?: InputVatClaimStatus;
  whtCategoryCode?: string;
  whtRate?: string;
  accountHint?: string;
  assetCandidate?: boolean;
  purchaseOrderLineId?: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
};

export type CreateVendorBillDto = {
  supplierId: string;
  branchId?: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  billDate: string;
  dueDate: string;
  receivedDate?: string;
  paymentTermsDays?: number;
  currency?: string;
  matchingMode?: PurchaseMatchingMode;
  vatMode?: ProcurementVatMode;
  supplierDocumentNumber?: string;
  taxInvoiceNumber?: string;
  taxInvoiceDate?: string;
  whtCategoryCode?: string;
  whtRate?: string;
  pp36Candidate?: boolean;
  attachmentId?: string;
  lines: CreateVendorBillLineDto[];
};

export type MatchOverrideDto = {
  overrideReason: string;
};

export type VoidVendorBillDto = {
  voidReason: string;
};

// ---- Supplier Payment ----

export type SupplierPaymentAllocationDto = {
  vendorBillId: string;
  amount: string;
  whtAmount?: string;
  /** Exact verified PAYMENT_EVIDENCE records consumed by this PP36 payment allocation. */
  pp36PaymentEvidenceIds?: string[];
};

export type SupplierPaymentSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  paymentNumber?: string;
  status: SupplierPaymentStatus;
  supplierId: string;
  supplierDisplayName?: string;
  paymentDate: string;
  method: PaymentMethod;
  currency: string;
  grossAmount: string;
  whtAmount: string;
  /** WhtIncomeCategory code the withholding was taken under. Present whenever whtAmount > 0. */
  whtCategoryCode?: string;
  /** Withholding rate as a PERCENT ('3.0000' = 3%). Present whenever whtAmount > 0. */
  whtRate?: string;
  netPaidAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  postingStatus: ProcurementPostingStatus;
  taxSyncStatus: ProcurementTaxSyncStatus;
  pp36RecognitionStatus?: 'ACTIVE' | 'REVERSED';
  createdAt: string;
  updatedAt: string;
};

export type SupplierPaymentDetail = SupplierPaymentSummary & {
  note?: string;
  bankAccountRef?: string;
  supplierBankAccountId?: string;
  externalReference?: string;
  recordedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  allocations: { vendorBillId: string; amount: string; whtAmount?: string; allocatedAt: string; pp36RecognitionStatus?: 'ACTIVE' | 'REVERSED' }[];
};

export type CreateSupplierPaymentDto = {
  /** Stable client-generated key reused when retrying the same payment request. */
  idempotencyKey?: string;
  supplierId: string;
  branchId?: string;
  paymentDate: string;
  method: PaymentMethod;
  currency?: string;
  /** Debt cleared on the bills, withholding included. Must equal the sum of allocation amounts. */
  grossAmount: string;
  whtAmount?: string;
  /** Required when whtAmount > 0 — the 50 ทวิ and the ภ.ง.ด. attachment both report the category. */
  whtCategoryCode?: string;
  /** Required when whtAmount > 0. PERCENT ('3.0000' = 3%); the income base is derived from it. */
  whtRate?: string;
  /** Cash actually paid out = grossAmount - whtAmount. */
  netPaidAmount: string;
  bankAccountRef?: string;
  supplierBankAccountId?: string;
  externalReference?: string;
  note?: string;
  allocations: SupplierPaymentAllocationDto[];
};

export type VoidSupplierPaymentDto = {
  voidReason: string;
};

// ---- AP Aging ----

export type ApAgingBucket = {
  label: string;
  minDays: number;
  maxDays?: number;
  amount: string;
  count: number;
};

export type ApAgingSupplierRow = {
  supplierId: string;
  supplierDisplayName: string;
  currency: string;
  totalOutstanding: string;
  buckets: ApAgingBucket[];
};

export type ApAgingResult = {
  asOfDate: string;
  currency: string;
  totalOutstanding: string;
  suppliers: ApAgingSupplierRow[];
};

// ---- Supplier Statement ----

export type SupplierStatementEntry = {
  date: string;
  type: 'bill' | 'payment' | 'credit';
  documentNumber?: string;
  description: string;
  amount: string;
  runningBalance: string;
};

export type SupplierStatement = {
  supplierId: string;
  supplierDisplayName: string;
  currency: string;
  fromDate?: string;
  toDate?: string;
  openingBalance: string;
  closingBalance: string;
  entries: SupplierStatementEntry[];
};

// ---- Source Posting Input ----

export type ProcurementSourcePostingLine = {
  sourceLineId: string;
  productId?: string;
  description: string;
  lineType: PurchaseLineType;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  netAmount: string;
  vatAmount: string;
  whtAmount?: string;
  accountHint?: string;
  assetCandidate?: boolean;
  inventoryReceiptRef?: string;
};

export type ProcurementSourcePostingInput = {
  companyId: string;
  branchId?: string;
  sourceType: 'vendor_bill' | 'supplier_payment' | 'vendor_bill_void' | 'supplier_payment_void' | 'vendor_credit_adjustment';
  sourceId: string;
  sourceEventType: string;
  idempotencyKey: string;
  documentNumber?: string;
  sourceDate: string;
  periodKey: string;
  supplierId: string;
  supplierSnapshot?: Record<string, unknown>;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  inputVatAmount: string;
  inputVatClaimStatus?: InputVatClaimStatus;
  whtAmount?: string;
  grossAmount: string;
  netPayableAmount: string;
  paidAmount?: string;
  outstandingAmount?: string;
  lines: ProcurementSourcePostingLine[];
  reversalOf?: string;
  postingStatus: ProcurementPostingStatus;
};

// ---- Filter/List DTOs ----

export type ListSuppliersFilter = {
  status?: SupplierStatus;
  supplierType?: SupplierType;
  taxId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ListPurchaseRequestsFilter = {
  status?: PurchaseRequestStatus;
  requesterUserId?: string;
  supplierId?: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type ListPurchaseOrdersFilter = {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type ListGoodsReceiptsFilter = {
  status?: GoodsReceiptStatus;
  purchaseOrderId?: string;
  supplierId?: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type ListVendorBillsFilter = {
  status?: VendorBillStatus;
  supplierId?: string;
  purchaseOrderId?: string;
  matchingStatus?: PurchaseMatchingStatus;
  postingStatus?: ProcurementPostingStatus;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type ListSupplierPaymentsFilter = {
  status?: SupplierPaymentStatus;
  supplierId?: string;
  method?: PaymentMethod;
  postingStatus?: ProcurementPostingStatus;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedProcurementResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

// ---- Document sequence keys ----

export const PROCUREMENT_SEQUENCE_KEYS = {
  PURCHASE_REQUEST: 'procurement.purchase_request',
  PURCHASE_ORDER: 'procurement.purchase_order',
  GOODS_RECEIPT: 'procurement.goods_receipt',
  VENDOR_BILL: 'accounts_payable.vendor_bill',
  PAYMENT: 'accounts_payable.payment',
} as const;
