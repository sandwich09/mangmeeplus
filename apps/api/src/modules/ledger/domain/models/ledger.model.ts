import type {
  LedgerAccountClass, LedgerNormalBalance, JournalEntryType, JournalEntryStatus,
  AccountingPeriodStatus, LedgerJournalLineInput,
} from '@watchdog-bms/contracts';

export type { LedgerAccountClass, LedgerNormalBalance, JournalEntryType, JournalEntryStatus, AccountingPeriodStatus };

export type AccountRecord = {
  id: string;
  companyId: string | null;
  code: string;
  nameTh: string;
  nameEn: string | null;
  accountClass: LedgerAccountClass;
  reportGroup: string | null;
  normalBalance: LedgerNormalBalance;
  parentAccountId: string | null;
  isPosting: boolean;
  isSystem: boolean;
  isControlled: boolean;
  taxCategory: string | null;
  cashFlowCategory: string | null;
  sourceGroup1: string | null;
  sourceGroup2: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PeriodRecord = {
  id: string;
  companyId: string;
  periodKey: string;
  startDate: Date;
  endDate: Date;
  status: AccountingPeriodStatus;
  closedAt: Date | null;
  reopenedAt: Date | null;
  closeNote: string | null;
};

export type JournalLineRecord = {
  id: string;
  companyId: string;
  journalEntryId: string;
  accountId: string;
  branchId: string | null;
  lineNumber: number;
  description: string | null;
  debitAmount: string;
  creditAmount: string;
  currency: string;
  sourceType: string | null;
  sourceId: string | null;
  taxCode: string | null;
  taxSnapshot?: import('@watchdog-bms/contracts').TransactionTaxSnapshot;
  taxComponentKey?: import('@watchdog-bms/contracts').TransactionTaxComponentPreview['componentKey'];
  reportContributions?: import('@watchdog-bms/contracts').TaxReportContribution[];
  createdAt: Date;
};

export type JournalEntryRecord = {
  id: string;
  companyId: string;
  periodId: string;
  entryNumber: string;
  entryType: JournalEntryType;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfJournalEntryId: string | null;
  status: JournalEntryStatus;
  entryDate: Date;
  postedAt: Date | null;
  postedByUserId: string | null;
  memo: string | null;
  createdByUserId: string;
  lines?: JournalLineRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type PostingRuleRecord = {
  id: string;
  companyId: string | null;
  documentType: string;
  ruleKey: string;
  version: number;
  status: string;
  debitAccountId: string | null;
  creditAccountId: string | null;
  conditionJson: Record<string, unknown> | null;
  mappingJson: Record<string, unknown>;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type CreateJournalEntryInput = {
  companyId: string;
  periodId: string;
  entryType: JournalEntryType;
  sourceType?: string;
  sourceId?: string;
  reversalOfJournalEntryId?: string;
  entryDate: Date;
  memo?: string;
  createdByUserId: string;
  lines: LedgerJournalLineInput[];
};

export type PeriodCloseCheckResult = {
  checkKey: string;
  status: 'PASSED' | 'FAILED' | 'WARNING';
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  count?: number;
  amount?: string;
};
