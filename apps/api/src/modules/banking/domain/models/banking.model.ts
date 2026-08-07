/**
 * Domain models for banking / reconciliation (Item 13).
 * Plain TypeScript types — no Prisma, no NestJS imports.
 * Dates are Date objects; amounts are decimal strings.
 */

import type {
  BankAccountStatus,
  BankAccountType,
  BankStatementImportStatus,
  BankStatementLineSource,
  BankStatementLineDirection,
  BankStatementLineStatus,
  BankMatchStatus,
  BankMatchSourceType,
  BankAdjustmentStatus,
  BankAdjustmentCategory,
  BankReconciliationStatus,
  BankPostingStatus,
} from '@watchdog-bms/contracts';

export type BankAccountRecord = {
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
  openingBalanceDate?: Date;
  status: BankAccountStatus;
  notes?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BankLedgerAccountRecord = {
  id: string;
  companyId: string | null;
  code: string;
  accountClass: string;
  normalBalance: string;
  reportGroup: string | null;
  cashFlowCategory: string | null;
  isPosting: boolean;
  isControlled: boolean;
  status: string;
};

export type BankStatementImportRecord = {
  id: string;
  companyId: string;
  bankAccountId: string;
  sourceType: BankStatementLineSource;
  originalFileName?: string;
  fileHash?: string;
  parserVersion: string;
  mappingJson?: Record<string, unknown>;
  statementStartDate?: Date;
  statementEndDate?: Date;
  status: BankStatementImportStatus;
  lineCount: number;
  duplicateLineCount: number;
  committedAt?: Date;
  committedByUserId?: string;
  voidedAt?: Date;
  voidedByUserId?: string;
  voidReason?: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BankStatementLineRecord = {
  id: string;
  companyId: string;
  bankAccountId: string;
  importId?: string;
  sourceType: BankStatementLineSource;
  rowNumber?: number;
  lineHash: string;
  postedDate: Date;
  valueDate?: Date;
  description: string;
  normalizedDescription?: string;
  counterpartyName?: string;
  bankReference?: string;
  chequeNumber?: string;
  direction: BankStatementLineDirection;
  signedAmount: string;
  debitAmount?: string;
  creditAmount?: string;
  runningBalanceAmount?: string;
  currency: string;
  status: BankStatementLineStatus;
  duplicateOfLineId?: string;
  ignoredReason?: string;
  createdByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BankReconciliationMatchRecord = {
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
  confirmedAt?: Date;
  rejectedByUserId?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
  overrideReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BankAdjustmentRecord = {
  id: string;
  companyId: string;
  bankAccountId: string;
  adjustmentNumber?: string;
  category: BankAdjustmentCategory;
  status: BankAdjustmentStatus;
  adjustmentDate: Date;
  description: string;
  signedAmount: string;
  currency: string;
  counterpartyName?: string;
  ledgerDebitAccountId?: string;
  ledgerCreditAccountId?: string;
  sourceStatementLineId?: string;
  postingStatus: BankPostingStatus;
  postedJournalEntryId?: string;
  createdByUserId: string;
  approvedByUserId?: string;
  approvedAt?: Date;
  voidedByUserId?: string;
  voidedAt?: Date;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BankReconciliationSessionRecord = {
  id: string;
  companyId: string;
  bankAccountId: string;
  sessionNumber: string;
  periodStartDate: Date;
  periodEndDate: Date;
  openingStatementBalanceAmount: string;
  closingStatementBalanceAmount: string;
  calculatedStatementMovementAmount: string;
  calculatedBookMovementAmount: string;
  calculatedBookBalanceAmount: string;
  differenceAmount: string;
  currency: string;
  status: BankReconciliationStatus;
  completedAt?: Date;
  completedByUserId?: string;
  reopenedAt?: Date;
  reopenedByUserId?: string;
  reopenReason?: string;
  voidedAt?: Date;
  voidedByUserId?: string;
  voidReason?: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BankReconciliationSessionLineRecord = {
  id: string;
  companyId: string;
  sessionId: string;
  statementLineId: string;
  statusAtCompletion: BankStatementLineStatus;
  matchedAmountAtCompletion: string;
  ignoredReasonAtCompletion?: string;
  createdAt: Date;
};

// Input types

export type CreateBankAccountInput = {
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
  createdByUserId: string;
};

export type UpdateBankAccountInput = {
  companyId: string;
  bankAccountId: string;
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
  updatedByUserId: string;
};

export type CreateStatementImportInput = {
  companyId: string;
  bankAccountId: string;
  sourceType: BankStatementLineSource;
  originalFileName?: string;
  fileHash?: string;
  parserVersion: string;
  mappingJson?: Record<string, unknown>;
  statementStartDate?: string;
  statementEndDate?: string;
  createdByUserId: string;
};

export type CreateStatementLineInput = {
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
  debitAmount?: string;
  creditAmount?: string;
  runningBalanceAmount?: string;
  currency: string;
  duplicateOfLineId?: string;
  createdByUserId?: string;
};

export type CreateMatchInput = {
  companyId: string;
  bankAccountId: string;
  statementLineId: string;
  sourceType: BankMatchSourceType;
  sourceId: string;
  sourceDisplayNumber?: string;
  allocatedAmount: string;
  currency: string;
  confidenceScore?: number;
  suggestedBy?: string;
  suggestedReason?: string;
  overrideReason?: string;
};

export type CreateBankAdjustmentInput = {
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
  createdByUserId: string;
};

export type CreateReconciliationSessionInput = {
  companyId: string;
  bankAccountId: string;
  sessionNumber: string;
  periodStartDate: string;
  periodEndDate: string;
  openingStatementBalanceAmount: string;
  currency: string;
  createdByUserId: string;
};
