// ─── Enums ───────────────────────────────────────────────────────────────────
export type LedgerAccountClass =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'COST'
  | 'EXPENSE'
  | 'TAX_EXPENSE'
  | 'SUSPENSE';

export type LedgerNormalBalance = 'DEBIT' | 'CREDIT';

export type JournalEntryType = 'GENERATED' | 'MANUAL' | 'REVERSAL' | 'OPENING_BALANCE' | 'CLOSING';

export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'VOIDED';

export type AccountingPeriodStatus = 'OPEN' | 'CLOSING_REVIEW' | 'CLOSED' | 'REOPENED';

export type PeriodCloseRunStatus = 'STARTED' | 'PASSED' | 'FAILED' | 'CLOSED' | 'REOPENED';

export type PostingRuleStatus = 'ACTIVE' | 'INACTIVE';

// ─── Shared value types ───────────────────────────────────────────────────────
export type MoneyAmount = { amount: string; currency: string };

export type LedgerSourceRef = {
  sourceType: string;
  sourceId: string;
  sourceEventType?: string;
};

export type ExpenseBackfillBlocker =
  | 'NO_ACTIVE_EVIDENCE'
  | 'TAX_EVIDENCE_NEEDS_REVIEW'
  | 'NOT_TAX_EVIDENCE'
  | 'VENDOR_NAME_MISSING';

export type ExpenseBackfillPreview = {
  activationAt: string;
  totalHistoricalPending: number;
  eligibleCount: number;
  manualReviewCount: number;
  blockerCounts: Record<ExpenseBackfillBlocker, number>;
  samples: Array<{
    expenseId: string;
    expenseNumber: string | null;
    vendorNameSnapshot: string | null;
    confirmedAt: string;
    blockers: ExpenseBackfillBlocker[];
  }>;
};

export type ExpenseBackfillResult = {
  activationAt: string;
  eligibleAtStart: number;
  attempted: number;
  posted: number;
  failed: number;
  skipped: number;
  remaining: number;
};

// ─── Chart of Accounts ───────────────────────────────────────────────────────
export type ChartOfAccountSummary = {
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
};

export type ChartTemplateMetadata = {
  templateKey: string;
  templateVersion: number;
  accountsChecksum: string;
  mappingManifestVersion: number;
  mappingManifestChecksum: string;
  accountCount: number;
  mappingSuggestions: Array<{
    key: string;
    accountCode: string;
    kind: 'POSTING' | 'TAX' | 'CONTROL';
    reviewStatus: 'REVIEW_REQUIRED';
  }>;
};

export type ChartTemplateConflictClassification =
  | 'EXACT'
  | 'MISSING'
  | 'UNUSED_CONFLICT'
  | 'IN_USE_CONFLICT';

export type ChartTemplatePreviewRow = {
  code: string;
  existingAccountId: string | null;
  classification: ChartTemplateConflictClassification;
  dependencyCount: number;
  dependencies: Record<string, number>;
  differingFields: string[];
};

export type ChartTemplatePreviewResult = {
  templateKey: string;
  templateVersion: number;
  templateChecksum: string;
  previewChecksum: string;
  exact: number;
  missing: number;
  unusedConflicts: number;
  inUseConflicts: number;
  rows: ChartTemplatePreviewRow[];
};

export type ChartTemplateApplyMode = 'MISSING_ONLY' | 'REPLACE_UNUSED';

export type ApplyChartTemplateInput = {
  expectedTemplateChecksum: string;
  expectedPreviewChecksum: string;
  mode?: ChartTemplateApplyMode;
  acknowledgeConflicts?: boolean;
};

export type ChartOfAccountsReadiness = {
  chartTemplateApplied: boolean;
  chartTemplateKey: string | null;
  chartTemplateVersion: number | null;
  chartTemplateChecksum: string | null;
  chartTemplateAppliedAt: string | null;
  chartAccountCount: number;
  chartConflicts: number;
  requiredPostingRolesMissing: string[];
  requiredTaxAccountRolesMissing: string[];
  taxProfilesNeedingReview: number;
  bankLedgerLinksInvalid: number;
  legacyTaxHeaderMismatches: number;
  sourcePostingErrors: number;
  taxConfigurationRequired: boolean;
  readyForManualLedger: boolean;
  readyForAutomaticPosting: boolean;
};

export type ApplyChartTemplateResult = {
  templateKey: string;
  templateVersion: number;
  templateChecksum: string;
  created: number;
  updated: number;
  skipped: number;
  acknowledgedConflicts: number;
  accountCount: number;
  readiness: ChartOfAccountsReadiness;
};

export type CreateChartOfAccountInput = {
  code: string;
  nameTh: string;
  nameEn?: string;
  accountClass: LedgerAccountClass;
  reportGroup?: string;
  normalBalance: LedgerNormalBalance;
  parentAccountId?: string;
  isPosting?: boolean;
  taxCategory?: string;
  cashFlowCategory?: string;
};

export type UpdateChartOfAccountInput = {
  nameTh?: string;
  nameEn?: string;
  reportGroup?: string;
  taxCategory?: string;
  cashFlowCategory?: string;
  status?: string;
};

// ─── Accounting Period ────────────────────────────────────────────────────────
export type AccountingPeriodSummary = {
  id: string;
  companyId: string;
  periodKey: string;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  closedAt: string | null;
  reopenedAt: string | null;
};

// ─── Journal Entry ────────────────────────────────────────────────────────────
export type JournalLineSummary = {
  id: string;
  accountId: string;
  accountCode: string | null;
  accountNameTh: string | null;
  branchId: string | null;
  lineNumber: number;
  description: string | null;
  debitAmount: string;
  creditAmount: string;
  currency: string;
  taxCode: string | null;
  sourceType: string | null;
  sourceId: string | null;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponentKey?: import('./transaction-tax.js').TransactionTaxComponentPreview['componentKey'];
};

export type JournalEntrySummary = {
  id: string;
  companyId: string;
  periodId: string;
  periodKey: string | null;
  entryNumber: string;
  entryType: JournalEntryType;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfJournalEntryId: string | null;
  status: JournalEntryStatus;
  entryDate: string;
  postedAt: string | null;
  memo: string | null;
  totalDebit: string;
  totalCredit: string;
  createdAt: string;
};

export type JournalEntryDetail = JournalEntrySummary & {
  lines: JournalLineSummary[];
};

export type LedgerJournalLineInput = {
  accountId: string;
  branchId?: string;
  description?: string;
  debitAmount?: string;
  creditAmount?: string;
  currency?: string;
  taxCode?: string;
  sourceType?: string;
  sourceId?: string;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
  taxComponentKey?: import('./transaction-tax.js').TransactionTaxComponentPreview['componentKey'];
};

export type ManualJournalLineInput = Pick<LedgerJournalLineInput,
  'accountId' | 'branchId' | 'description' | 'debitAmount' | 'creditAmount' | 'currency'
>;

export type CreateManualJournalInput = {
  entryDate: string;
  memo?: string;
  lines: ManualJournalLineInput[];
};

// ─── Source Posting Input ─────────────────────────────────────────────────────
export type LedgerSourcePostingInput = {
  companyId: string;
  branchId?: string;
  sourceType: string;
  sourceId: string;
  sourceEventType: string;
  idempotencyKey: string;
  documentNumber?: string;
  sourceDate: string;
  periodKey: string;
  currency: string;
  counterpartyId?: string;
  totalAmount: string;
  taxTotal?: string;
  whtTotal?: string;
  paidAmount?: string;
  lines: Array<{
    sourceLineId?: string;
    description?: string;
    quantity?: string;
    netAmount: string;
    vatAmount?: string;
    whtAmount?: string;
    categoryKey?: string;
    /**
     * Identity of the line's ExpenseCategory, used to look up its REVIEWED ledger account
     * (audit CR-2). Distinct from `categoryKey`/`accountHint` above, which are suggestions and must
     * never be posting authority.
     */
    expenseCategoryId?: string;
    accountHint?: string;
    taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot;
    taxComponents?: import('./transaction-tax.js').TransactionTaxComponentPreview[];
  }>;
  payment?: {
    paymentDate?: string;
    method?: string;
    amount: string;
    reference?: string;
  };
};

// ─── Reports ─────────────────────────────────────────────────────────────────
export type GlAccountLine = {
  accountId: string;
  accountCode: string;
  accountNameTh: string;
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  endingBalance: string;
  normalBalance: LedgerNormalBalance;
  lines?: Array<{
    journalEntryId: string;
    entryNumber: string;
    entryDate: string;
    memo: string | null;
    debitAmount: string;
    creditAmount: string;
    sourceType: string | null;
    sourceId: string | null;
  }>;
};

export type TrialBalanceLine = {
  accountId: string;
  accountCode: string;
  accountNameTh: string;
  accountClass: LedgerAccountClass;
  reportGroup?: string | null;
  normalBalance: LedgerNormalBalance;
  totalDebit: string;
  totalCredit: string;
  balance: string;
};

export type TrialBalanceSummary = {
  periodKey: string;
  totalDebit: string;
  totalCredit: string;
  difference: string;
  lines: TrialBalanceLine[];
};

export type PnlSection = {
  section: 'REVENUE' | 'COST' | 'EXPENSE' | 'TAX_EXPENSE';
  total: string;
  lines: Array<{ accountId: string; accountCode: string; accountNameTh: string; balance: string }>;
};

export type PnlReport = {
  periodKey: string;
  revenue: string;
  totalCost: string;
  grossProfit: string;
  totalExpense: string;
  taxExpense: string;
  netProfit: string;
  sections: PnlSection[];
};

export type BalanceSheetSection = {
  section: 'ASSET' | 'LIABILITY' | 'EQUITY';
  total: string;
  lines: Array<{ accountId: string; accountCode: string; accountNameTh: string; balance: string }>;
};

export type BalanceSheetReport = {
  periodKey: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  sections: BalanceSheetSection[];
};

// ─── Period Close ─────────────────────────────────────────────────────────────
export type PeriodCloseCheck = {
  checkKey: string;
  status: 'PASSED' | 'FAILED' | 'WARNING';
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  count?: number;
  amount?: string;
  /** The named parts of `count`, so a client can say WHAT is pending instead of one total. */
  breakdown?: Record<string, number>;
};

export type PeriodCloseRunSummary = {
  id: string;
  periodId: string;
  status: PeriodCloseRunStatus;
  checks: PeriodCloseCheck[];
  requestedByUserId: string;
  createdAt: string;
  completedAt: string | null;
};

// ─── Thai label constants ─────────────────────────────────────────────────────
export const LEDGER_ACCOUNT_CLASS_LABELS: Record<LedgerAccountClass, string> = {
  ASSET:       'สินทรัพย์',
  LIABILITY:   'หนี้สิน',
  EQUITY:      'ส่วนของผู้ถือหุ้น',
  REVENUE:     'รายได้',
  COST:        'ต้นทุน',
  EXPENSE:     'ค่าใช้จ่าย',
  TAX_EXPENSE: 'ภาษีเงินได้นิติบุคคล',
  SUSPENSE:    'บัญชีพัก',
};

export const JOURNAL_ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  DRAFT:    'ร่าง',
  POSTED:   'บันทึกแล้ว',
  REVERSED: 'ยกเลิก (กลับรายการ)',
  VOIDED:   'ยกเลิก',
};

export const JOURNAL_ENTRY_TYPE_LABELS: Record<JournalEntryType, string> = {
  GENERATED:       'สร้างจากเอกสาร',
  MANUAL:          'บันทึกด้วยมือ',
  REVERSAL:        'กลับรายการ',
  OPENING_BALANCE: 'ยอดยกมา',
  CLOSING:         'ปิดงบ',
};

export const ACCOUNTING_PERIOD_STATUS_LABELS: Record<AccountingPeriodStatus, string> = {
  OPEN:            'เปิด',
  CLOSING_REVIEW:  'ระหว่างตรวจสอบก่อนปิด',
  CLOSED:          'ปิดแล้ว',
  REOPENED:        'เปิดใหม่',
};

export const LEDGER_SEQUENCE_KEY = 'ledger.journal';
