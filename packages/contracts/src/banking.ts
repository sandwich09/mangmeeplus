// ---- Item 13: Bank Accounts and Reconciliation ----

import type { AiModelLineage, AiModelPolicy, AiUsageEntry } from './ai-lineage.js';

export type BankAccountStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type BankAccountType =
  | 'BANK_CHECKING'
  | 'BANK_SAVINGS'
  | 'CASH'
  | 'E_WALLET'
  | 'OTHER';

export type BankStatementImportStatus = 'PREVIEW' | 'COMMITTED' | 'VOIDED' | 'FAILED';

export type BankStatementLineSource = 'IMPORT' | 'MANUAL' | 'API_STUB';

export type BankStatementLineDirection = 'DEPOSIT' | 'WITHDRAWAL' | 'ZERO';

export type BankStatementLineStatus =
  | 'UNMATCHED'
  | 'SUGGESTED'
  | 'PARTIALLY_MATCHED'
  | 'MATCHED'
  | 'IGNORED'
  | 'VOIDED';

export type BankMatchStatus = 'SUGGESTED' | 'CONFIRMED' | 'REJECTED' | 'VOIDED';

export type BankMatchSourceType =
  | 'CUSTOMER_PAYMENT'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE_PAYMENT'
  | 'REIMBURSEMENT_PAYMENT'
  | 'BANK_ADJUSTMENT'
  | 'LEDGER_JOURNAL_LINE'
  | 'INTER_ACCOUNT_TRANSFER'
  | 'OTHER_SOURCE';

export type BankAdjustmentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'VOIDED'
  | 'POSTED'
  | 'POSTING_ERROR';

export type BankAdjustmentCategory =
  | 'BANK_FEE'
  | 'BANK_INTEREST'
  | 'OWNER_CONTRIBUTION'
  | 'OWNER_DRAW'
  | 'INTER_ACCOUNT_TRANSFER'
  | 'UNKNOWN_DEPOSIT'
  | 'UNKNOWN_WITHDRAWAL'
  | 'OTHER';

export type BankReconciliationStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'REOPENED'
  | 'VOIDED';

export type BankPostingStatus =
  | 'not_required'
  | 'pending'
  | 'posted'
  | 'posting_error'
  | 'reversed';

// Bank Account

export type BankAccountSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  displayName: string;
  bankName?: string;
  bankCode?: string;
  accountType: BankAccountType;
  accountNumberMasked?: string;
  accountNumberLast4?: string;
  accountHolderName?: string;
  currency: string;
  ledgerAccountId?: string;
  openingBalanceAmount: string;
  openingBalanceDate?: string;
  status: BankAccountStatus;
  createdAt: string;
  updatedAt: string;
};

export type BankAccountDetail = BankAccountSummary & {
  notes?: string;
  createdByUserId: string;
  updatedByUserId?: string;
};

export type CreateBankAccountDto = {
  companyId: string;
  branchId?: string;
  displayName: string;
  bankName?: string;
  bankCode?: string;
  accountType: BankAccountType;
  accountNumberMasked?: string;
  accountNumberLast4?: string;
  accountHolderName?: string;
  currency?: string;
  ledgerAccountId?: string;
  openingBalanceAmount?: string;
  openingBalanceDate?: string;
  notes?: string;
};

export type UpdateBankAccountDto = {
  displayName?: string;
  bankName?: string;
  bankCode?: string;
  accountNumberMasked?: string;
  accountNumberLast4?: string;
  accountHolderName?: string;
  ledgerAccountId?: string;
  openingBalanceAmount?: string;
  openingBalanceDate?: string;
  status?: BankAccountStatus;
  notes?: string;
};

// Statement Lines

export type BankStatementLineSummary = {
  id: string;
  companyId: string;
  bankAccountId: string;
  importId?: string;
  sourceType: BankStatementLineSource;
  rowNumber?: number;
  lineHash: string;
  postedDate: string;
  valueDate?: string;
  description: string;
  normalizedDescription?: string;
  counterpartyName?: string;
  bankReference?: string;
  chequeNumber?: string;
  direction: BankStatementLineDirection;
  signedAmount: string;
  currency: string;
  status: BankStatementLineStatus;
  duplicateOfLineId?: string;
  ignoredReason?: string;
  createdAt: string;
  updatedAt: string;
};

// Statement Import

export type BankStatementImportSummary = {
  id: string;
  companyId: string;
  bankAccountId: string;
  sourceType: BankStatementLineSource;
  originalFileName?: string;
  fileHash?: string;
  parserVersion: string;
  mappingJson?: Record<string, unknown>;
  statementStartDate?: string;
  statementEndDate?: string;
  status: BankStatementImportStatus;
  lineCount: number;
  duplicateLineCount: number;
  committedAt?: string;
  committedByUserId?: string;
  voidedAt?: string;
  voidedByUserId?: string;
  voidReason?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type BankStatementImportPreviewRow = {
  rowNumber: number;
  postedDate: string;
  description: string;
  signedAmount: string;
  direction: BankStatementLineDirection;
  currency: string;
  bankReference?: string;
  runningBalanceAmount?: string;
  isDuplicate: boolean;
  errors: string[];
};

export type BankStatementImportPreviewResult = {
  importId: string;
  bankAccountId: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errorRows: number;
  rows: BankStatementImportPreviewRow[];
  /** 1-based row numbers whose running balance breaks the continuity chain (spec §20 guardrail). */
  balanceChainBreaks: number[];
};

// Statement extraction (PDF/photo intake, spec §20)

export type BankStatementExtractionSourceKind = 'csv_xlsx' | 'pdf_text' | 'ocr';

/** Row keyed by the same canonical aliases the CSV preview path accepts. */
export type BankStatementExtractedRow = Record<string, string>;

export type BankStatementExtractResult = {
  sourceKind: BankStatementExtractionSourceKind;
  rows: BankStatementExtractedRow[];
  /** Per-row extraction confidence (0-1), parallel to rows. Always 1 for pdf_text. */
  rowConfidences: number[];
  /** 1-based row numbers failing the running-balance continuity guardrail. */
  balanceChainBreaks: number[];
  /** Model id when OCR ran; absent for pdf_text. */
  extractionModelId?: string;
  /** Every governed processor used by OCR; absent for pdf_text. */
  extractionModelLineage?: AiModelLineage[];
};

export type BankStatementAiExtractRequest = {
  requestId: string;
  companyId: string;
  userId: string;
  modelPolicy?: AiModelPolicy;
  attachment: {
    contentBase64: string;
    mimeType: 'image/jpeg' | 'image/png';
  };
};

export type BankStatementAiExtractRow = {
  postedDate?: string;
  description?: string;
  debit?: string;
  credit?: string;
  amount?: string;
  balance?: string;
  bankReference?: string;
  confidence?: number;
};

export type BankStatementAiExtractResponse = {
  status: 'ok' | 'not_configured' | 'failed';
  rows?: BankStatementAiExtractRow[];
  modelId?: string;
  modelLineage?: AiModelLineage[];
  errorCode?: string;
  /** One entry per model call the gateway made for this request; absent from an older gateway. */
  usage?: AiUsageEntry[];
};

// Match candidates

export type BankMatchCandidate = {
  sourceType: BankMatchSourceType;
  sourceId: string;
  sourceDisplayNumber?: string;
  companyId: string;
  bankAccountId?: string;
  direction: BankStatementLineDirection;
  paymentDate: string;
  amount: string;
  remainingUnmatchedAmount: string;
  currency: string;
  counterpartyName?: string;
  reference?: string;
  status: string;
  webUrl: string;
};

export type BankMatchWorkspaceResult = {
  lines: BankStatementLineSummary[];
  matchesByLine: Record<string, BankReconciliationMatchSummary[]>;
  candidates: BankMatchCandidate[];
};

// Reconciliation Match

export type BankReconciliationMatchSummary = {
  id: string;
  companyId: string;
  bankAccountId: string;
  statementLineId: string;
  sourceType: BankMatchSourceType;
  sourceId: string;
  sourceDisplayNumber?: string;
  allocatedAmount: string;
  currency: string;
  confidenceScore?: number;
  status: BankMatchStatus;
  suggestedBy?: string;
  suggestedReason?: string;
  confirmedByUserId?: string;
  confirmedAt?: string;
  rejectedByUserId?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  overrideReason?: string;
  createdAt: string;
  updatedAt: string;
};

// Bank Adjustment

export type BankAdjustmentSummary = {
  id: string;
  companyId: string;
  bankAccountId: string;
  adjustmentNumber?: string;
  category: BankAdjustmentCategory;
  status: BankAdjustmentStatus;
  adjustmentDate: string;
  description: string;
  signedAmount: string;
  currency: string;
  counterpartyName?: string;
  ledgerDebitAccountId?: string;
  ledgerCreditAccountId?: string;
  postingStatus: BankPostingStatus;
  createdAt: string;
  updatedAt: string;
};

export type BankAdjustmentDetail = BankAdjustmentSummary & {
  sourceStatementLineId?: string;
  postedJournalEntryId?: string;
  createdByUserId: string;
  approvedByUserId?: string;
  approvedAt?: string;
  voidedByUserId?: string;
  voidedAt?: string;
  voidReason?: string;
};

export type CreateBankAdjustmentDto = {
  companyId: string;
  bankAccountId: string;
  category: BankAdjustmentCategory;
  adjustmentDate: string;
  description: string;
  signedAmount: string;
  currency?: string;
  counterpartyName?: string;
  ledgerDebitAccountId?: string;
  ledgerCreditAccountId?: string;
  sourceStatementLineId?: string;
};

// Bank Adjustment Posting Input (for item 10 ledger)

export type BankAdjustmentPostingInput = {
  sourceType: 'BANK_ADJUSTMENT';
  sourceId: string;
  companyId: string;
  sourceNumber: string;
  sourceDate: string;
  description: string;
  currency: string;
  lines: {
    ledgerAccountId: string;
    debitAmount: string;
    creditAmount: string;
    description: string;
  }[];
};

// Reconciliation Session

export type BankReconciliationSessionSummary = {
  id: string;
  companyId: string;
  bankAccountId: string;
  sessionNumber: string;
  periodStartDate: string;
  periodEndDate: string;
  openingStatementBalanceAmount: string;
  closingStatementBalanceAmount: string;
  calculatedStatementMovementAmount: string;
  calculatedBookMovementAmount: string;
  calculatedBookBalanceAmount: string;
  differenceAmount: string;
  currency: string;
  status: BankReconciliationStatus;
  completedAt?: string;
  completedByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type BankReconciliationSessionDetail = BankReconciliationSessionSummary & {
  reopenedAt?: string;
  reopenedByUserId?: string;
  reopenReason?: string;
  voidedAt?: string;
  voidedByUserId?: string;
  voidReason?: string;
  createdByUserId: string;
};

// Cash Position

export type BankCashPositionSummary = {
  companyId: string;
  bankAccountId: string;
  bankAccountDisplayName: string;
  currency: string;
  lastReconciledDate?: string;
  lastReconciledBalance?: string;
  unreconciledLineCount: number;
  unmatchedLineCount: number;
  pendingAdjustmentCount: number;
  lastStatementDate?: string;
};
