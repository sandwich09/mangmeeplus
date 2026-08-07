-- CreateEnum
CREATE TYPE "AccountingCounterpartyType" AS ENUM ('CUSTOMER', 'VENDOR', 'BOTH');

-- CreateEnum
CREATE TYPE "AccountingCounterpartyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AccountingDocumentType" AS ENUM ('QUOTATION', 'INVOICE', 'BILLING_NOTE', 'RECEIPT', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "AccountingDocumentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'VOIDED', 'CREDITED', 'DEBITED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountingPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOIDED');

-- CreateEnum
CREATE TYPE "AccountingPostingStatus" AS ENUM ('not_required', 'pending', 'posted', 'posting_error', 'reversed');

-- CreateEnum
CREATE TYPE "AccountingVatMode" AS ENUM ('NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AccountingPaymentDirection" AS ENUM ('RECEIVED', 'PAID');

-- CreateEnum
CREATE TYPE "AccountingPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountingPaymentRecordStatus" AS ENUM ('DRAFT', 'RECORDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AccountingTaxInvoiceType" AS ENUM ('FULL', 'ABBREVIATED');

-- CreateEnum
CREATE TYPE "AccountingQuotationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('NOT_REQUESTED', 'NOT_CONFIGURED', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AiVerificationStatus" AS ENUM ('NOT_VERIFIED', 'VERIFYING', 'AI_VERIFIED', 'PARTIAL', 'NEEDS_REVIEW', 'FAILED', 'HUMAN_VERIFIED');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('NOT_CHECKED', 'NO_MATCH', 'POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ExpensePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpensePostingStatus" AS ENUM ('not_required', 'pending', 'posted', 'posting_error', 'reversed');

-- CreateEnum
CREATE TYPE "ExpenseVatMode" AS ENUM ('NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "InputVatClaimStatus" AS ENUM ('CLAIMABLE', 'NON_CLAIMABLE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCaptureSource" AS ENUM ('WEB_UPLOAD', 'WEB_MANUAL', 'LINE_UPLOAD', 'API_INTERNAL');

-- CreateEnum
CREATE TYPE "ExpenseCategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DuplicateCandidateStatus" AS ENUM ('OPEN', 'DISMISSED', 'CONFIRMED_DUPLICATE');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('JURISTIC_PERSON', 'INDIVIDUAL', 'FOREIGN', 'GOVERNMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierBankAccountStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_BILLED', 'BILLED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "VendorBillStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOIDED', 'CREDITED');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('DRAFT', 'RECORDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PurchaseLineType" AS ENUM ('STOCK', 'SERVICE', 'NON_STOCK', 'ASSET_CANDIDATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseMatchingMode" AS ENUM ('NONE', 'TWO_WAY_PO_BILL', 'THREE_WAY_PO_RECEIPT_BILL');

-- CreateEnum
CREATE TYPE "PurchaseMatchingStatus" AS ENUM ('NOT_REQUIRED', 'NOT_MATCHED', 'MATCHED', 'MATCHED_WITH_VARIANCE', 'BLOCKED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "PurchaseApprovalAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "PurchaseApprovalSourceType" AS ENUM ('PURCHASE_REQUEST', 'PURCHASE_ORDER', 'VENDOR_BILL');

-- CreateEnum
CREATE TYPE "ProcurementTaxSyncStatus" AS ENUM ('not_required', 'pending', 'synced', 'sync_error', 'reversed');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('BANK_CHECKING', 'BANK_SAVINGS', 'CASH', 'E_WALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "BankStatementImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'VOIDED', 'FAILED');

-- CreateEnum
CREATE TYPE "BankStatementLineSource" AS ENUM ('IMPORT', 'MANUAL', 'API_STUB');

-- CreateEnum
CREATE TYPE "BankStatementLineDirection" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'ZERO');

-- CreateEnum
CREATE TYPE "BankStatementLineStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'PARTIALLY_MATCHED', 'MATCHED', 'IGNORED', 'VOIDED');

-- CreateEnum
CREATE TYPE "BankMatchStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "BankMatchSourceType" AS ENUM ('CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE_PAYMENT', 'REIMBURSEMENT_PAYMENT', 'BANK_ADJUSTMENT', 'LEDGER_JOURNAL_LINE', 'INTER_ACCOUNT_TRANSFER', 'OTHER_SOURCE');

-- CreateEnum
CREATE TYPE "BankAdjustmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'VOIDED', 'POSTED', 'POSTING_ERROR');

-- CreateEnum
CREATE TYPE "BankAdjustmentCategory" AS ENUM ('BANK_FEE', 'BANK_INTEREST', 'OWNER_CONTRIBUTION', 'OWNER_DRAW', 'INTER_ACCOUNT_TRANSFER', 'UNKNOWN_DEPOSIT', 'UNKNOWN_WITHDRAWAL', 'OTHER');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'COMPLETED', 'REOPENED', 'VOIDED');

-- AlterTable
ALTER TABLE "OutboxEvent" ALTER COLUMN "aggregateType" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "AccountingCounterparty" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "AccountingCounterpartyType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "branchCode" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "billingAddressJson" JSONB,
    "shippingAddressJson" JSONB,
    "status" "AccountingCounterpartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingCounterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "documentType" "AccountingDocumentType" NOT NULL,
    "documentNumber" TEXT,
    "status" "AccountingDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "documentDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "counterpartyId" TEXT,
    "counterpartySnapshotJson" JSONB,
    "sourceDocumentId" TEXT,
    "sourceDocumentType" TEXT,
    "convertedFromDocumentId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "vatMode" "AccountingVatMode" NOT NULL DEFAULT 'NO_VAT',
    "subtotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unappliedCreditAmount" DECIMAL(18,4),
    "paymentStatus" "AccountingPaymentStatus",
    "taxStatus" TEXT,
    "taxInvoiceType" "AccountingTaxInvoiceType",
    "taxInvoiceId" TEXT,
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'not_required',
    "journalEntryId" TEXT,
    "postingError" TEXT,
    "note" TEXT,
    "internalMemo" TEXT,
    "issuedByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "approvalStatus" "AccountingQuotationApprovalStatus",
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingDocumentLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "productId" TEXT,
    "skuSnapshot" TEXT,
    "description" TEXT NOT NULL,
    "unitName" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(6,4),
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "whtRate" DECIMAL(6,4),
    "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineSubtotalAmount" DECIMAL(18,4) NOT NULL,
    "lineTotalAmount" DECIMAL(18,4) NOT NULL,
    "taxCategory" TEXT,
    "revenueCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "paymentNumber" TEXT,
    "direction" "AccountingPaymentDirection" NOT NULL,
    "status" "AccountingPaymentRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "counterpartyId" TEXT,
    "counterpartySnapshotJson" JSONB,
    "method" "AccountingPaymentMethod" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unappliedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "bankAccountRef" TEXT,
    "externalReference" TEXT,
    "note" TEXT,
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'not_required',
    "journalEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPaymentAllocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "accountHintKey" TEXT NOT NULL,
    "taxCategory" TEXT,
    "inputVatDefault" "InputVatClaimStatus" NOT NULL DEFAULT 'NON_CLAIMABLE',
    "status" "ExpenseCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "expenseNumber" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "captureSource" "ExpenseCaptureSource" NOT NULL DEFAULT 'WEB_MANUAL',
    "vendorCounterpartyId" TEXT,
    "vendorSnapshotJson" JSONB,
    "vendorNameSnapshot" TEXT,
    "vendorTaxIdSnapshot" TEXT,
    "vendorBranchCodeSnapshot" TEXT,
    "vendorDocumentNumber" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "vatMode" "ExpenseVatMode" NOT NULL DEFAULT 'NO_VAT',
    "inputVatClaimStatus" "InputVatClaimStatus" NOT NULL DEFAULT 'NON_CLAIMABLE',
    "subtotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPayableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentStatus" "ExpensePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentMethod" "ExpensePaymentMethod",
    "paidAt" TIMESTAMP(3),
    "bankAccountRef" TEXT,
    "expenseCategoryId" TEXT,
    "accountHintKey" TEXT,
    "taxCategory" TEXT,
    "duplicateStatus" "DuplicateStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "duplicateOfExpenseId" TEXT,
    "duplicateOverrideReason" TEXT,
    "primaryAttachmentId" TEXT,
    "extractionId" TEXT,
    "aiVerificationStatus" "AiVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "aiVerifiedFieldsJson" JSONB,
    "aiVerificationSummaryJson" JSONB,
    "aiVerificationConfidence" DOUBLE PRECISION,
    "aiVerifiedAt" TIMESTAMP(3),
    "lineMessageId" TEXT,
    "lineEventId" TEXT,
    "lineReplyTokenHash" TEXT,
    "missingReceiptReason" TEXT,
    "postingStatus" "ExpensePostingStatus" NOT NULL DEFAULT 'not_required',
    "journalEntryId" TEXT,
    "postingError" TEXT,
    "note" TEXT,
    "internalMemo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(8,4),
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "whtRate" DECIMAL(8,4),
    "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineSubtotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expenseCategoryId" TEXT,
    "accountHintKey" TEXT,
    "taxCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptExtraction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "rawTextHash" TEXT,
    "extractedFieldsJson" JSONB,
    "confidenceJson" JSONB,
    "warningCodesJson" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAiVerification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "extractionId" TEXT,
    "provider" TEXT NOT NULL,
    "modelId" TEXT,
    "status" "AiVerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "verifiedFieldsJson" JSONB,
    "insertedFieldsJson" JSONB,
    "validationResultsJson" JSONB,
    "confidenceJson" JSONB,
    "warningCodesJson" JSONB,
    "duplicateCandidateIdsJson" JSONB,
    "promptInputHash" TEXT,
    "rawOutputHash" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedFromChannel" TEXT NOT NULL DEFAULT 'WEB',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptAiVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseDuplicateCandidate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "candidateExpenseId" TEXT NOT NULL,
    "reasonCodesJson" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "DuplicateCandidateStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseDuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "supplierType" "SupplierType" NOT NULL DEFAULT 'JURISTIC_PERSON',
    "displayNameSnapshot" TEXT NOT NULL,
    "legalNameSnapshot" TEXT,
    "taxId" TEXT,
    "branchCode" TEXT,
    "vatRegistered" BOOLEAN,
    "defaultVatMode" "AccountingVatMode",
    "defaultInputVatClaimStatus" "InputVatClaimStatus",
    "defaultWhtCategoryCode" TEXT,
    "defaultPaymentTermsDays" INTEGER,
    "defaultExpenseCategoryKey" TEXT,
    "defaultAccountHint" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'THB',
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressJson" JSONB,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "onHoldReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumberLast4" TEXT NOT NULL,
    "branchName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "SupplierBankAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "requestNumber" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requesterUserId" TEXT NOT NULL,
    "neededByDate" TIMESTAMP(3),
    "supplierId" TEXT,
    "supplierSnapshotJson" JSONB,
    "reason" TEXT,
    "budgetCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "subtotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "whtEstimateAmount" DECIMAL(18,4),
    "grandTotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "convertedPurchaseOrderId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "lineType" "PurchaseLineType" NOT NULL DEFAULT 'STOCK',
    "productId" TEXT,
    "skuSnapshot" TEXT,
    "description" TEXT NOT NULL,
    "unitName" TEXT,
    "requestedQuantity" DECIMAL(18,4) NOT NULL,
    "estimatedUnitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatMode" "AccountingVatMode" NOT NULL DEFAULT 'NO_VAT',
    "vatRate" DECIMAL(6,4),
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineSubtotalAmount" DECIMAL(18,4) NOT NULL,
    "lineTotalAmount" DECIMAL(18,4) NOT NULL,
    "accountHint" TEXT,
    "inventoryLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "purchaseOrderNumber" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierId" TEXT NOT NULL,
    "supplierSnapshotJson" JSONB,
    "sourcePurchaseRequestId" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" TIMESTAMP(3),
    "paymentTermsDays" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "subtotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "whtEstimateAmount" DECIMAL(18,4),
    "grandTotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "billedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "matchingMode" "PurchaseMatchingMode" NOT NULL DEFAULT 'THREE_WAY_PO_RECEIPT_BILL',
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'not_required',
    "taxSyncStatus" "ProcurementTaxSyncStatus" NOT NULL DEFAULT 'not_required',
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "sourcePurchaseRequestLineId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "lineType" "PurchaseLineType" NOT NULL DEFAULT 'STOCK',
    "productId" TEXT,
    "skuSnapshot" TEXT,
    "description" TEXT NOT NULL,
    "unitName" TEXT,
    "orderedQuantity" DECIMAL(18,4) NOT NULL,
    "receivedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "billedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatMode" "AccountingVatMode" NOT NULL DEFAULT 'NO_VAT',
    "vatRate" DECIMAL(6,4),
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "whtCategoryCode" TEXT,
    "whtRate" DECIMAL(6,4),
    "whtEstimateAmount" DECIMAL(18,4),
    "lineSubtotalAmount" DECIMAL(18,4) NOT NULL,
    "lineTotalAmount" DECIMAL(18,4) NOT NULL,
    "accountHint" TEXT,
    "inventoryLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "goodsReceiptNumber" TEXT,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSnapshotJson" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "inventoryMovementBatchRef" TEXT,
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'not_required',
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "lineType" "PurchaseLineType" NOT NULL DEFAULT 'STOCK',
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "inventoryLocationId" TEXT,
    "orderedQuantity" DECIMAL(18,4) NOT NULL,
    "previouslyReceivedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQuantity" DECIMAL(18,4) NOT NULL,
    "acceptedQuantity" DECIMAL(18,4) NOT NULL,
    "rejectedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitName" TEXT,
    "inventoryMovementId" TEXT,
    "varianceReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "vendorBillNumber" TEXT,
    "supplierDocumentNumber" TEXT,
    "status" "VendorBillStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierId" TEXT NOT NULL,
    "supplierSnapshotJson" JSONB,
    "purchaseOrderId" TEXT,
    "goodsReceiptId" TEXT,
    "billDate" TIMESTAMP(3) NOT NULL,
    "receivedDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentTermsDays" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "vatMode" "AccountingVatMode" NOT NULL DEFAULT 'NO_VAT',
    "subtotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inputVatClaimStatus" "InputVatClaimStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "whtCategoryCode" TEXT,
    "whtRate" DECIMAL(6,4),
    "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPayableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "matchingMode" "PurchaseMatchingMode" NOT NULL DEFAULT 'THREE_WAY_PO_RECEIPT_BILL',
    "matchingStatus" "PurchaseMatchingStatus" NOT NULL DEFAULT 'NOT_MATCHED',
    "matchingVarianceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "matchingOverrideReason" TEXT,
    "taxInvoiceNumber" TEXT,
    "taxInvoiceDate" TIMESTAMP(3),
    "pp36Candidate" BOOLEAN NOT NULL DEFAULT false,
    "attachmentId" TEXT,
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'not_required',
    "taxSyncStatus" "ProcurementTaxSyncStatus" NOT NULL DEFAULT 'not_required',
    "journalEntryId" TEXT,
    "postingError" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorBillId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "goodsReceiptLineId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "lineType" "PurchaseLineType" NOT NULL DEFAULT 'STOCK',
    "productId" TEXT,
    "skuSnapshot" TEXT,
    "description" TEXT NOT NULL,
    "unitName" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatMode" "AccountingVatMode" NOT NULL DEFAULT 'NO_VAT',
    "vatRate" DECIMAL(6,4),
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inputVatClaimStatus" "InputVatClaimStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "whtCategoryCode" TEXT,
    "whtRate" DECIMAL(6,4),
    "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineSubtotalAmount" DECIMAL(18,4) NOT NULL,
    "lineTotalAmount" DECIMAL(18,4) NOT NULL,
    "accountHint" TEXT,
    "assetCandidate" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillMatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorBillId" TEXT NOT NULL,
    "vendorBillLineId" TEXT,
    "purchaseOrderId" TEXT,
    "purchaseOrderLineId" TEXT,
    "goodsReceiptId" TEXT,
    "goodsReceiptLineId" TEXT,
    "matchStatus" "PurchaseMatchingStatus" NOT NULL DEFAULT 'NOT_MATCHED',
    "quantityVariance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountVariance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tolerancePolicyJson" JSONB,
    "overrideReason" TEXT,
    "overriddenByUserId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBillMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "paymentNumber" TEXT,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierId" TEXT NOT NULL,
    "supplierSnapshotJson" JSONB,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "method" "AccountingPaymentMethod" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "whtAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPaidAmount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unappliedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bankAccountRef" TEXT,
    "supplierBankAccountId" TEXT,
    "externalReference" TEXT,
    "note" TEXT,
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'not_required',
    "taxSyncStatus" "ProcurementTaxSyncStatus" NOT NULL DEFAULT 'not_required',
    "journalEntryId" TEXT,
    "recordedByUserId" TEXT,
    "recordedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "vendorBillId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "whtAmount" DECIMAL(18,4),
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseApprovalEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" "PurchaseApprovalSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "action" "PurchaseApprovalAction" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "note" TEXT,
    "thresholdSnapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "displayName" TEXT NOT NULL,
    "bankName" TEXT,
    "bankCode" TEXT,
    "accountType" "BankAccountType" NOT NULL DEFAULT 'BANK_CHECKING',
    "accountNumberMasked" TEXT,
    "accountNumberLast4" TEXT,
    "accountHolderName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "ledgerAccountId" TEXT,
    "openingBalanceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "openingBalanceDate" TIMESTAMP(3),
    "status" "BankAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "sourceType" "BankStatementLineSource" NOT NULL DEFAULT 'IMPORT',
    "originalFileName" TEXT,
    "fileHash" TEXT,
    "parserVersion" TEXT NOT NULL DEFAULT '1',
    "mappingJson" JSONB,
    "statementStartDate" TIMESTAMP(3),
    "statementEndDate" TIMESTAMP(3),
    "status" "BankStatementImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateLineCount" INTEGER NOT NULL DEFAULT 0,
    "committedAt" TIMESTAMP(3),
    "committedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "importId" TEXT,
    "sourceType" "BankStatementLineSource" NOT NULL DEFAULT 'IMPORT',
    "rowNumber" INTEGER,
    "lineHash" TEXT NOT NULL,
    "postedDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "normalizedDescription" TEXT,
    "counterpartyName" TEXT,
    "bankReference" TEXT,
    "chequeNumber" TEXT,
    "direction" "BankStatementLineDirection" NOT NULL,
    "signedAmount" DECIMAL(18,4) NOT NULL,
    "debitAmount" DECIMAL(18,4),
    "creditAmount" DECIMAL(18,4),
    "runningBalanceAmount" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "duplicateOfLineId" TEXT,
    "ignoredReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationMatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementLineId" TEXT NOT NULL,
    "sourceType" "BankMatchSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceDisplayNumber" TEXT,
    "allocatedAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "confidenceScore" INTEGER,
    "status" "BankMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "suggestedBy" TEXT,
    "suggestedReason" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliationMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "adjustmentNumber" TEXT,
    "category" "BankAdjustmentCategory" NOT NULL,
    "status" "BankAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "adjustmentDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "signedAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "counterpartyName" TEXT,
    "ledgerDebitAccountId" TEXT,
    "ledgerCreditAccountId" TEXT,
    "sourceStatementLineId" TEXT,
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'not_required',
    "postedJournalEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "sessionNumber" TEXT NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "periodEndDate" TIMESTAMP(3) NOT NULL,
    "openingStatementBalanceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "closingStatementBalanceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "calculatedStatementMovementAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "calculatedBookMovementAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "calculatedBookBalanceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "differenceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationSessionLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "statementLineId" TEXT NOT NULL,
    "statusAtCompletion" "BankStatementLineStatus" NOT NULL,
    "matchedAmountAtCompletion" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ignoredReasonAtCompletion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliationSessionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationEvidenceExport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "exportHash" TEXT NOT NULL,
    "fileAttachmentId" TEXT,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "BankReconciliationEvidenceExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingCounterparty_companyId_type_status_idx" ON "AccountingCounterparty"("companyId", "type", "status");

-- CreateIndex
CREATE INDEX "AccountingCounterparty_companyId_displayName_idx" ON "AccountingCounterparty"("companyId", "displayName");

-- CreateIndex
CREATE INDEX "AccountingDocument_companyId_documentType_status_idx" ON "AccountingDocument"("companyId", "documentType", "status");

-- CreateIndex
CREATE INDEX "AccountingDocument_companyId_branchId_documentDate_idx" ON "AccountingDocument"("companyId", "branchId", "documentDate");

-- CreateIndex
CREATE INDEX "AccountingDocument_companyId_counterpartyId_idx" ON "AccountingDocument"("companyId", "counterpartyId");

-- CreateIndex
CREATE INDEX "AccountingDocument_companyId_paymentStatus_idx" ON "AccountingDocument"("companyId", "paymentStatus");

-- CreateIndex
CREATE INDEX "AccountingDocument_companyId_postingStatus_idx" ON "AccountingDocument"("companyId", "postingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingDocument_companyId_documentType_documentNumber_key" ON "AccountingDocument"("companyId", "documentType", "documentNumber");

-- CreateIndex
CREATE INDEX "AccountingDocumentLine_companyId_productId_idx" ON "AccountingDocumentLine"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingDocumentLine_documentId_lineNumber_key" ON "AccountingDocumentLine"("documentId", "lineNumber");

-- CreateIndex
CREATE INDEX "AccountingPayment_companyId_direction_status_idx" ON "AccountingPayment"("companyId", "direction", "status");

-- CreateIndex
CREATE INDEX "AccountingPayment_companyId_paidAt_idx" ON "AccountingPayment"("companyId", "paidAt");

-- CreateIndex
CREATE INDEX "AccountingPayment_companyId_counterpartyId_idx" ON "AccountingPayment"("companyId", "counterpartyId");

-- CreateIndex
CREATE INDEX "AccountingPayment_companyId_postingStatus_idx" ON "AccountingPayment"("companyId", "postingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPayment_companyId_paymentNumber_key" ON "AccountingPayment"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "AccountingPaymentAllocation_companyId_documentId_idx" ON "AccountingPaymentAllocation"("companyId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPaymentAllocation_paymentId_documentId_key" ON "AccountingPaymentAllocation"("paymentId", "documentId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_companyId_status_idx" ON "ExpenseCategory"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_companyId_name_key" ON "ExpenseCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_status_expenseDate_idx" ON "ExpenseRecord"("companyId", "status", "expenseDate");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_branchId_expenseDate_idx" ON "ExpenseRecord"("companyId", "branchId", "expenseDate");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_vendorCounterpartyId_idx" ON "ExpenseRecord"("companyId", "vendorCounterpartyId");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_paymentStatus_idx" ON "ExpenseRecord"("companyId", "paymentStatus");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_postingStatus_idx" ON "ExpenseRecord"("companyId", "postingStatus");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_duplicateStatus_idx" ON "ExpenseRecord"("companyId", "duplicateStatus");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_lineMessageId_idx" ON "ExpenseRecord"("companyId", "lineMessageId");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_captureSource_idx" ON "ExpenseRecord"("companyId", "captureSource");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRecord_companyId_expenseNumber_key" ON "ExpenseRecord"("companyId", "expenseNumber");

-- CreateIndex
CREATE INDEX "ExpenseLine_companyId_expenseCategoryId_idx" ON "ExpenseLine"("companyId", "expenseCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseLine_expenseId_lineNumber_key" ON "ExpenseLine"("expenseId", "lineNumber");

-- CreateIndex
CREATE INDEX "ReceiptExtraction_companyId_status_createdAt_idx" ON "ReceiptExtraction"("companyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptExtraction_companyId_expenseId_attachmentId_key" ON "ReceiptExtraction"("companyId", "expenseId", "attachmentId");

-- CreateIndex
CREATE INDEX "ReceiptAiVerification_companyId_status_createdAt_idx" ON "ReceiptAiVerification"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExpenseDuplicateCandidate_companyId_expenseId_status_idx" ON "ExpenseDuplicateCandidate"("companyId", "expenseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseDuplicateCandidate_companyId_expenseId_candidateExpe_key" ON "ExpenseDuplicateCandidate"("companyId", "expenseId", "candidateExpenseId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_counterpartyId_key" ON "SupplierProfile"("counterpartyId");

-- CreateIndex
CREATE INDEX "SupplierProfile_companyId_status_idx" ON "SupplierProfile"("companyId", "status");

-- CreateIndex
CREATE INDEX "SupplierProfile_companyId_taxId_idx" ON "SupplierProfile"("companyId", "taxId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_companyId_counterpartyId_key" ON "SupplierProfile"("companyId", "counterpartyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_companyId_supplierCode_key" ON "SupplierProfile"("companyId", "supplierCode");

-- CreateIndex
CREATE INDEX "SupplierBankAccount_companyId_supplierId_status_idx" ON "SupplierBankAccount"("companyId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_companyId_status_idx" ON "PurchaseRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_companyId_branchId_status_idx" ON "PurchaseRequest"("companyId", "branchId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_companyId_requesterUserId_idx" ON "PurchaseRequest"("companyId", "requesterUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_companyId_requestNumber_key" ON "PurchaseRequest"("companyId", "requestNumber");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_companyId_productId_idx" ON "PurchaseRequestLine"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequestLine_purchaseRequestId_lineNumber_key" ON "PurchaseRequestLine"("purchaseRequestId", "lineNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_status_idx" ON "PurchaseOrder"("companyId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_branchId_status_idx" ON "PurchaseOrder"("companyId", "branchId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_supplierId_idx" ON "PurchaseOrder"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_orderDate_idx" ON "PurchaseOrder"("companyId", "orderDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_purchaseOrderNumber_key" ON "PurchaseOrder"("companyId", "purchaseOrderNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_companyId_productId_idx" ON "PurchaseOrderLine"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_lineNumber_key" ON "PurchaseOrderLine"("purchaseOrderId", "lineNumber");

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_purchaseOrderId_status_idx" ON "GoodsReceipt"("companyId", "purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_supplierId_idx" ON "GoodsReceipt"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_receivedAt_idx" ON "GoodsReceipt"("companyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_companyId_goodsReceiptNumber_key" ON "GoodsReceipt"("companyId", "goodsReceiptNumber");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_companyId_productId_idx" ON "GoodsReceiptLine"("companyId", "productId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_companyId_inventoryLocationId_idx" ON "GoodsReceiptLine"("companyId", "inventoryLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_goodsReceiptId_lineNumber_key" ON "GoodsReceiptLine"("goodsReceiptId", "lineNumber");

-- CreateIndex
CREATE INDEX "VendorBill_companyId_status_idx" ON "VendorBill"("companyId", "status");

-- CreateIndex
CREATE INDEX "VendorBill_companyId_supplierId_idx" ON "VendorBill"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "VendorBill_companyId_dueDate_idx" ON "VendorBill"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "VendorBill_companyId_postingStatus_idx" ON "VendorBill"("companyId", "postingStatus");

-- CreateIndex
CREATE INDEX "VendorBill_companyId_taxSyncStatus_idx" ON "VendorBill"("companyId", "taxSyncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_companyId_vendorBillNumber_key" ON "VendorBill"("companyId", "vendorBillNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_companyId_supplierId_supplierDocumentNumber_key" ON "VendorBill"("companyId", "supplierId", "supplierDocumentNumber");

-- CreateIndex
CREATE INDEX "VendorBillLine_companyId_productId_idx" ON "VendorBillLine"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBillLine_vendorBillId_lineNumber_key" ON "VendorBillLine"("vendorBillId", "lineNumber");

-- CreateIndex
CREATE INDEX "VendorBillMatch_companyId_vendorBillId_idx" ON "VendorBillMatch"("companyId", "vendorBillId");

-- CreateIndex
CREATE INDEX "VendorBillMatch_companyId_matchStatus_idx" ON "VendorBillMatch"("companyId", "matchStatus");

-- CreateIndex
CREATE INDEX "SupplierPayment_companyId_supplierId_status_idx" ON "SupplierPayment"("companyId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierPayment_companyId_paymentDate_idx" ON "SupplierPayment"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "SupplierPayment_companyId_postingStatus_idx" ON "SupplierPayment"("companyId", "postingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_companyId_paymentNumber_key" ON "SupplierPayment"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_companyId_vendorBillId_idx" ON "SupplierPaymentAllocation"("companyId", "vendorBillId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentAllocation_supplierPaymentId_vendorBillId_key" ON "SupplierPaymentAllocation"("supplierPaymentId", "vendorBillId");

-- CreateIndex
CREATE INDEX "PurchaseApprovalEvent_companyId_sourceType_sourceId_idx" ON "PurchaseApprovalEvent"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BankAccount_companyId_status_idx" ON "BankAccount"("companyId", "status");

-- CreateIndex
CREATE INDEX "BankAccount_companyId_ledgerAccountId_idx" ON "BankAccount"("companyId", "ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_companyId_displayName_key" ON "BankAccount"("companyId", "displayName");

-- CreateIndex
CREATE INDEX "BankStatementImport_companyId_bankAccountId_status_idx" ON "BankStatementImport"("companyId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_bankAccountId_postedDate_idx" ON "BankStatementLine"("companyId", "bankAccountId", "postedDate");

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_bankAccountId_status_idx" ON "BankStatementLine"("companyId", "bankAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_companyId_bankAccountId_lineHash_key" ON "BankStatementLine"("companyId", "bankAccountId", "lineHash");

-- CreateIndex
CREATE INDEX "BankReconciliationMatch_companyId_bankAccountId_status_idx" ON "BankReconciliationMatch"("companyId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "BankReconciliationMatch_companyId_sourceType_sourceId_idx" ON "BankReconciliationMatch"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BankAdjustment_companyId_bankAccountId_status_idx" ON "BankAdjustment"("companyId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "BankAdjustment_companyId_postingStatus_idx" ON "BankAdjustment"("companyId", "postingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BankAdjustment_companyId_adjustmentNumber_key" ON "BankAdjustment"("companyId", "adjustmentNumber");

-- CreateIndex
CREATE INDEX "BankReconciliationSession_companyId_bankAccountId_status_idx" ON "BankReconciliationSession"("companyId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "BankReconciliationSession_companyId_periodStartDate_periodE_idx" ON "BankReconciliationSession"("companyId", "periodStartDate", "periodEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliationSession_companyId_sessionNumber_key" ON "BankReconciliationSession"("companyId", "sessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliationSessionLine_companyId_sessionId_statement_key" ON "BankReconciliationSessionLine"("companyId", "sessionId", "statementLineId");

-- CreateIndex
CREATE INDEX "BankReconciliationEvidenceExport_companyId_sessionId_idx" ON "BankReconciliationEvidenceExport"("companyId", "sessionId");

-- AddForeignKey
ALTER TABLE "AccountingCounterparty" ADD CONSTRAINT "AccountingCounterparty_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "AccountingCounterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocumentLine" ADD CONSTRAINT "AccountingDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AccountingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocumentLine" ADD CONSTRAINT "AccountingDocumentLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "AccountingCounterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPaymentAllocation" ADD CONSTRAINT "AccountingPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "AccountingPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPaymentAllocation" ADD CONSTRAINT "AccountingPaymentAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AccountingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPaymentAllocation" ADD CONSTRAINT "AccountingPaymentAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRecord" ADD CONSTRAINT "ExpenseRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRecord" ADD CONSTRAINT "ExpenseRecord_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "ExpenseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptExtraction" ADD CONSTRAINT "ReceiptExtraction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptExtraction" ADD CONSTRAINT "ReceiptExtraction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "ExpenseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAiVerification" ADD CONSTRAINT "ReceiptAiVerification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAiVerification" ADD CONSTRAINT "ReceiptAiVerification_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "ExpenseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseDuplicateCandidate" ADD CONSTRAINT "ExpenseDuplicateCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseDuplicateCandidate" ADD CONSTRAINT "ExpenseDuplicateCandidate_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "ExpenseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseDuplicateCandidate" ADD CONSTRAINT "ExpenseDuplicateCandidate_candidateExpenseId_fkey" FOREIGN KEY ("candidateExpenseId") REFERENCES "ExpenseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProfile" ADD CONSTRAINT "SupplierProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProfile" ADD CONSTRAINT "SupplierProfile_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "AccountingCounterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLine" ADD CONSTRAINT "VendorBillLine_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "VendorBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLine" ADD CONSTRAINT "VendorBillLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLine" ADD CONSTRAINT "VendorBillLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillMatch" ADD CONSTRAINT "VendorBillMatch_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "VendorBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillMatch" ADD CONSTRAINT "VendorBillMatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "VendorBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseApprovalEvent" ADD CONSTRAINT "PurchaseApprovalEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationMatch" ADD CONSTRAINT "BankReconciliationMatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationMatch" ADD CONSTRAINT "BankReconciliationMatch_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationMatch" ADD CONSTRAINT "BankReconciliationMatch_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "BankStatementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAdjustment" ADD CONSTRAINT "BankAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAdjustment" ADD CONSTRAINT "BankAdjustment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationSession" ADD CONSTRAINT "BankReconciliationSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationSession" ADD CONSTRAINT "BankReconciliationSession_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationSessionLine" ADD CONSTRAINT "BankReconciliationSessionLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationSessionLine" ADD CONSTRAINT "BankReconciliationSessionLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BankReconciliationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationSessionLine" ADD CONSTRAINT "BankReconciliationSessionLine_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "BankStatementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationEvidenceExport" ADD CONSTRAINT "BankReconciliationEvidenceExport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationEvidenceExport" ADD CONSTRAINT "BankReconciliationEvidenceExport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BankReconciliationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "CompanyIntegrationCredential_companyId_provider_credentialKind_" RENAME TO "CompanyIntegrationCredential_companyId_provider_credentialK_key";

-- RenameIndex
ALTER INDEX "DashboardSnapshot_companyId_periodKind_periodStart_periodEnd_ge" RENAME TO "DashboardSnapshot_companyId_periodKind_periodStart_periodEn_idx";

-- RenameIndex
ALTER INDEX "DocumentSequence_companyId_branchScopeKey_documentType_periodKe" RENAME TO "DocumentSequence_companyId_branchScopeKey_documentType_peri_key";

-- RenameIndex
ALTER INDEX "NotificationEvent_companyId_sourceModule_sourceType_sourceId_id" RENAME TO "NotificationEvent_companyId_sourceModule_sourceType_sourceI_idx";
