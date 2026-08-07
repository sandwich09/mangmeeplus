import type {
  SupplierStatus, SupplierType, PurchaseRequestStatus, PurchaseOrderStatus,
  GoodsReceiptStatus, VendorBillStatus, SupplierPaymentStatus,
  PurchaseLineType, PurchaseMatchingMode, PurchaseMatchingStatus,
  InputVatClaimStatus, ProcurementPostingStatus, ProcurementTaxSyncStatus,
  ProcurementVatMode, PaymentMethod,
} from '@watchdog-bms/contracts';
import type { TaxEvidenceReviewStatus } from '@watchdog-bms/contracts';

export type { SupplierStatus, SupplierType, PurchaseRequestStatus, PurchaseOrderStatus,
  GoodsReceiptStatus, VendorBillStatus, SupplierPaymentStatus,
  PurchaseLineType, PurchaseMatchingMode, PurchaseMatchingStatus,
  InputVatClaimStatus, ProcurementPostingStatus, ProcurementTaxSyncStatus,
  ProcurementVatMode, PaymentMethod };

export type SupplierRecord = {
  id: string;
  companyId: string;
  counterpartyId: string;
  supplierCode?: string;
  supplierType: SupplierType;
  displayNameSnapshot: string;
  legalNameSnapshot?: string;
  taxId?: string;
  branchCode?: string;
  vatRegistered?: boolean;
  defaultVatMode?: ProcurementVatMode;
  defaultInputVatClaimStatus?: InputVatClaimStatus;
  defaultWhtCategoryCode?: string;
  defaultPaymentTermsDays?: number;
  defaultExpenseCategoryKey?: string;
  defaultAccountHint?: string;
  defaultCurrency: string;
  contactName?: string;
  email?: string;
  phone?: string;
  addressJson?: Record<string, unknown>;
  status: SupplierStatus;
  onHoldReason?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SupplierBankAccountRecord = {
  id: string;
  companyId: string;
  supplierId: string;
  bankName: string;
  bankCode?: string;
  accountName: string;
  accountNumberLast4: string;
  branchName?: string;
  isDefault: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseRequestLineRecord = {
  id: string;
  companyId: string;
  purchaseRequestId: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  skuSnapshot?: string;
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
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseRequestRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  requestNumber?: string;
  status: PurchaseRequestStatus;
  requesterUserId: string;
  neededByDate?: Date;
  supplierId?: string;
  supplierSnapshotJson?: Record<string, unknown>;
  reason?: string;
  budgetCode?: string;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtEstimateAmount?: string;
  grandTotalAmount: string;
  submittedAt?: Date;
  approvedByUserId?: string;
  approvedAt?: Date;
  rejectedByUserId?: string;
  rejectedAt?: Date;
  approvalNote?: string;
  convertedPurchaseOrderId?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  lines?: PurchaseRequestLineRecord[];
};

export type PurchaseOrderLineRecord = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  sourcePurchaseRequestLineId?: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  skuSnapshot?: string;
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
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseOrderRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  purchaseOrderNumber?: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierSnapshotJson?: Record<string, unknown>;
  sourcePurchaseRequestId?: string;
  orderDate: Date;
  expectedDeliveryDate?: Date;
  paymentTermsDays?: number;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtEstimateAmount?: string;
  grandTotalAmount: string;
  receivedAmount: string;
  billedAmount: string;
  outstandingAmount: string;
  matchingMode: PurchaseMatchingMode;
  postingStatus: ProcurementPostingStatus;
  taxSyncStatus: ProcurementTaxSyncStatus;
  issuedByUserId?: string;
  issuedAt?: Date;
  approvedByUserId?: string;
  approvedAt?: Date;
  rejectedByUserId?: string;
  rejectedAt?: Date;
  cancelledByUserId?: string;
  cancelledAt?: Date;
  cancelReason?: string;
  closedByUserId?: string;
  closedAt?: Date;
  closeReason?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  lines?: PurchaseOrderLineRecord[];
};

export type GoodsReceiptLineRecord = {
  id: string;
  companyId: string;
  goodsReceiptId: string;
  purchaseOrderLineId: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  description: string;
  inventoryLocationId?: string;
  orderedQuantity: string;
  previouslyReceivedQuantity: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  unitName?: string;
  inventoryMovementId?: string;
  varianceReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type GoodsReceiptRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  goodsReceiptNumber?: string;
  status: GoodsReceiptStatus;
  purchaseOrderId: string;
  supplierId: string;
  supplierSnapshotJson?: Record<string, unknown>;
  receivedAt: Date;
  receivedByUserId: string;
  note?: string;
  inventoryMovementBatchRef?: string;
  postingStatus: ProcurementPostingStatus;
  voidedByUserId?: string;
  voidedAt?: Date;
  voidReason?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  lines?: GoodsReceiptLineRecord[];
};

export type VendorBillLineRecord = {
  id: string;
  companyId: string;
  vendorBillId: string;
  purchaseOrderLineId?: string;
  goodsReceiptLineId?: string;
  lineNumber: number;
  lineType: PurchaseLineType;
  productId?: string;
  skuSnapshot?: string;
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
  taxSnapshot?: import('@watchdog-bms/contracts').TransactionTaxSnapshot;
  taxComponents?: import('@watchdog-bms/contracts').TransactionTaxComponentPreview[];
  createdAt: Date;
  updatedAt: Date;
};

export type VendorBillRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  vendorBillNumber?: string;
  supplierDocumentNumber?: string;
  status: VendorBillStatus;
  supplierId: string;
  supplierSnapshotJson?: Record<string, unknown>;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  billDate: Date;
  receivedDate?: Date;
  dueDate: Date;
  paymentTermsDays?: number;
  currency: string;
  vatMode: ProcurementVatMode;
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  inputVatClaimStatus: InputVatClaimStatus;
  whtCategoryCode?: string;
  whtRate?: string;
  whtAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  matchingMode: PurchaseMatchingMode;
  matchingStatus: PurchaseMatchingStatus;
  matchingVarianceAmount: string;
  matchingOverrideReason?: string;
  taxInvoiceNumber?: string;
  taxInvoiceDate?: Date;
  pp36Candidate: boolean;
  attachmentId?: string;
  taxEvidenceRequired: boolean;
  taxEvidenceReviewStatus: TaxEvidenceReviewStatus;
  reviewIssues: string[];
  taxEvidenceReviewedByUserId?: string;
  taxEvidenceReviewedAt?: Date;
  postingStatus: ProcurementPostingStatus;
  taxSyncStatus: ProcurementTaxSyncStatus;
  journalEntryId?: string;
  postingError?: string;
  approvedByUserId?: string;
  approvedAt?: Date;
  voidedByUserId?: string;
  voidedAt?: Date;
  voidReason?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  lines?: VendorBillLineRecord[];
};

export type SupplierPaymentAllocationRecord = {
  id: string;
  companyId: string;
  supplierPaymentId: string;
  vendorBillId: string;
  amount: string;
  whtAmount?: string;
  pp36RecognitionJson?: Array<{
    recognitionKey: string;
    vendorBillLineId: string;
    sourceTaxBaseAmount: string;
    evidenceIds: string[];
    preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto;
  }>;
  pp36RecognitionStatus?: 'ACTIVE' | 'REVERSED';
  pp36ReversedAt?: Date;
  pp36ReversedByUserId?: string;
  pp36ReversalReason?: string;
  allocatedAt: Date;
  createdByUserId: string;
  createdAt: Date;
};

export type SupplierPaymentRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  paymentNumber?: string;
  status: SupplierPaymentStatus;
  supplierId: string;
  supplierSnapshotJson?: Record<string, unknown>;
  paymentDate: Date;
  method: PaymentMethod;
  currency: string;
  grossAmount: string;
  whtAmount: string;
  /** WhtIncomeCategory code the withholding was taken under; set whenever whtAmount > 0. */
  whtCategoryCode?: string;
  /** Withholding rate as a PERCENT ('3.0000' = 3%); set whenever whtAmount > 0. */
  whtRate?: string;
  netPaidAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  bankAccountRef?: string;
  supplierBankAccountId?: string;
  externalReference?: string;
  note?: string;
  postingStatus: ProcurementPostingStatus;
  taxSyncStatus: ProcurementTaxSyncStatus;
  pp36RecognitionStatus?: 'ACTIVE' | 'REVERSED';
  journalEntryId?: string;
  recordedByUserId?: string;
  recordedAt?: Date;
  voidedByUserId?: string;
  voidedAt?: Date;
  voidReason?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  allocations?: SupplierPaymentAllocationRecord[];
};

export type PurchaseApprovalEventRecord = {
  id: string;
  companyId: string;
  sourceType: 'PURCHASE_REQUEST' | 'PURCHASE_ORDER' | 'VENDOR_BILL';
  sourceId: string;
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'OVERRIDDEN';
  actorUserId: string;
  note?: string;
  thresholdSnapshotJson?: Record<string, unknown>;
  createdAt: Date;
};

// H-07: no stored row means fail-closed defaults (self-approval blocked,
// dual approval disabled).
export type ProcurementApprovalPolicyRecord = {
  id: string;
  companyId: string;
  allowSelfApproval: boolean;
  dualApprovalThresholdAmount: string | null;
  createdByUserId: string;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};
