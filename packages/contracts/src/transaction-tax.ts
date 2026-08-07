// Item 11B - stable transaction-tax semantics. SAP codes are profile-scoped aliases.

export const TAX_SOURCE_SYSTEMS = ['SAP_ERP', 'SAP_S4HANA', 'WATCHDOG', 'CUSTOM'] as const;
export type TaxSourceSystem = (typeof TAX_SOURCE_SYSTEMS)[number];

export const TRANSACTION_TAX_REGIMES = [
  'VAT', 'IMPORT_VAT', 'CUSTOMS_DUTY', 'EXCISE_TAX', 'MUNICIPAL_OR_OTHER_IMPORT_TAX',
  'WITHHOLDING_TAX', 'CORPORATE_INCOME_TAX_SUPPORT', 'OTHER_TRANSACTION_TAX',
] as const;
export type TransactionTaxRegime = (typeof TRANSACTION_TAX_REGIMES)[number];

export const TRANSACTION_TAX_DIRECTIONS = ['OUTPUT', 'INPUT', 'SELF_ASSESSED', 'WITHHELD_PAYABLE', 'WITHHELD_RECEIVABLE'] as const;
export type TransactionTaxDirection = (typeof TRANSACTION_TAX_DIRECTIONS)[number];

export const TRANSACTION_TAX_TREATMENTS = [
  'STANDARD', 'ZERO_RATED', 'EXEMPT', 'NON_TAXABLE', 'DEFERRED', 'REVERSE_CHARGE',
  'CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIALLY_DEDUCTIBLE', 'NONDEDUCTIBLE_EXPENSE',
  'NONDEDUCTIBLE_CAPITALIZED', 'OUTSIDE_SCOPE', 'NEEDS_REVIEW',
] as const;
export type TransactionTaxTreatment = (typeof TRANSACTION_TAX_TREATMENTS)[number];

export const TRANSACTION_TAX_CONTEXTS = [
  'DOMESTIC_SALE', 'DOMESTIC_PURCHASE', 'IMPORT_GOODS', 'IMPORT_SERVICE', 'EXPORT_GOODS',
  'EXPORT_SERVICE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT', 'MANUAL_TAX_ADJUSTMENT',
] as const;
export type TransactionTaxContext = (typeof TRANSACTION_TAX_CONTEXTS)[number];

export const TAX_ACCOUNT_ROLES = [
  'OUTPUT_VAT_PAYABLE', 'OUTPUT_VAT_DEFERRED', 'INPUT_VAT_CLAIMABLE', 'INPUT_VAT_PENDING',
  'INPUT_VAT_DEFERRED', 'IMPORT_VAT_CLAIMABLE', 'IMPORT_VAT_PENDING',
  'PP36_OUTPUT_VAT_PAYABLE', 'PP36_INPUT_VAT_CLAIMABLE', 'NONDEDUCTIBLE_VAT_EXPENSE',
  'NONDEDUCTIBLE_VAT_CAPITALIZED', 'CUSTOMS_DUTY_PAYABLE', 'CUSTOMS_DUTY_EXPENSE',
  'CUSTOMS_DUTY_CAPITALIZED', 'EXCISE_TAX_PAYABLE', 'EXCISE_TAX_EXPENSE_OR_COST',
  'IMPORT_TAX_SETTLEMENT_PAYABLE',
  'WHT_PAYABLE', 'WHT_RECEIVABLE',
] as const;
export type TaxAccountRole = (typeof TAX_ACCOUNT_ROLES)[number];

export type TaxConfigurationStatus = 'DRAFT' | 'REVIEW_REQUIRED' | 'ACTIVE' | 'RETIRED';
export type TaxEvidenceReviewStatus = 'DRAFT' | 'REVIEW_REQUIRED' | 'VERIFIED' | 'REJECTED';
export type TaxClaimability = 'NOT_APPLICABLE' | 'CLAIMABLE' | 'PENDING_EVIDENCE' | 'PARTIAL' | 'NONDEDUCTIBLE_EXPENSE' | 'NONDEDUCTIBLE_CAPITALIZED';
export type TaxHeaderSummary = 'NONE' | 'SINGLE' | 'MIXED';
export type TaxReportForm = 'PP30' | 'PP36' | 'TAX_LEDGER' | 'CUSTOMS_SUPPORT';
export type TaxReportAmountSource = 'TAX_BASE' | 'TAX_AMOUNT' | 'GROSS' | 'DUTY' | 'OTHER';
export type TaxCodeProfileTemplateKey = 'WATCHDOG_TH_DOMESTIC_EXPENSE_V1' | 'SAP_ERP_TH_LEGACY' | 'SAP_S4_TH_CURRENT';

export const TAX_ROUNDING_MODES = ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] as const;
export type TaxRoundingMode = (typeof TAX_ROUNDING_MODES)[number];

export type TransactionTaxRoundingPolicy = {
  roundingMode: TaxRoundingMode;
  /** Decimal places retained in tax-base, tax, and report amounts. Limited by ledger precision to 0..4. */
  roundingScale: number;
  /** Maximum absolute difference accepted when comparing entered, source, event, journal, and report tax amounts. */
  taxAmountTolerance: string;
};

export type TaxCodeProfileDto = TransactionTaxRoundingPolicy & {
  id: string;
  companyId: string;
  name: string;
  sourceSystem: TaxSourceSystem;
  sourceProfileKey: string;
  countryCode: string;
  sapClient: string | null;
  sapCompanyCode: string | null;
  isDefault: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateTaxCodeProfileInput = {
  name: string;
  sourceSystem: TaxSourceSystem;
  sourceProfileKey: string;
  countryCode?: string;
  sapClient?: string;
  sapCompanyCode?: string;
  isDefault?: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  sourceUrl?: string;
  roundingMode?: TaxRoundingMode;
  roundingScale?: number;
  taxAmountTolerance?: string;
};

export type TaxProfileSetupBlocker = {
  code: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  kind: 'DEFINITION' | 'ACCOUNT_RULE' | 'REPORT_RULE' | 'EFFECTIVE_WINDOW' | 'PROFILE_OVERLAP';
  accountRole?: TaxAccountRole;
  postingSide?: 'DEBIT' | 'CREDIT';
  formType?: TaxReportForm;
  boxKey?: string;
  amountSource?: TaxReportAmountSource;
};

export type TaxProfileSetupReadiness = {
  profileId: string;
  profileStatus: TaxCodeProfileDto['status'];
  definitionCount: number;
  activeDefinitionCount: number;
  canActivate: boolean;
  blockers: TaxProfileSetupBlocker[];
  warnings: Array<{ code: string; externalTaxCode?: string }>;
};

export type TaxCodeDefinitionDto = {
  id: string;
  companyId: string;
  profileId: string;
  externalCode: string;
  displayName: string;
  taxRegime: TransactionTaxRegime;
  direction: TransactionTaxDirection;
  treatment: TransactionTaxTreatment;
  transactionContexts: TransactionTaxContext[];
  rate: string;
  calculationMethod: 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE';
  sapAccountKey: string | null;
  claimabilityDefault: TaxClaimability;
  evidenceRuleKey: string | null;
  status: TaxConfigurationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
};

export type UpsertTaxCodeDefinitionInput = Omit<
  TaxCodeDefinitionDto,
  'id' | 'companyId' | 'status' | 'version' | 'reviewedByUserId' | 'reviewedAt'
> & { id?: string };

export type TransactionTaxSnapshot = {
  taxCodeDefinitionId: string | null;
  externalTaxCode: string | null;
  taxProfileKey: string | null;
  taxProfileVersion: number | null;
  /** Optional only for snapshots created before profile-level rounding was introduced. */
  roundingMode?: TaxRoundingMode;
  roundingScale?: number;
  taxAmountTolerance?: string;
  taxRegime: TransactionTaxRegime | null;
  taxDirection: TransactionTaxDirection | null;
  taxTreatment: TransactionTaxTreatment | null;
  taxContext: TransactionTaxContext | null;
  taxRate: string;
  /** Original commercial-document currency before statutory conversion. */
  sourceCurrency: string;
  /** Company functional currency used by tax reports and G/L tax lines. */
  taxCurrency: string;
  /** Functional-currency units per one source-currency unit. */
  exchangeRate: string;
  exchangeRateSource: string;
  exchangeRateDate: string;
  taxBaseAmount: string;
  taxAmount: string;
  claimability: TaxClaimability;
  evidenceStatus: TaxEvidenceReviewStatus;
  accountRuleVersion: number | null;
  reportRuleVersion: number | null;
  recognitionDate?: string | null;
  evidenceRefs?: string[];
};

export type TransactionTaxLineInput = {
  branchId?: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string;
  transactionContext: TransactionTaxContext;
  documentDate: string;
  paymentDate?: string;
  countryCode?: string;
  currency: string;
  /** Server-derived company functional currency and verified FX evidence. */
  taxCurrency?: string;
  exchangeRate?: string;
  exchangeRateSource?: string;
  exchangeRateDate?: string;
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  netAmount: string;
  grossAmount: string;
  enteredTaxAmount?: string;
  authoritativeCustomsValue?: string;
  authoritativeDutyAmount?: string;
  authoritativeExciseAmount?: string;
  authoritativeOtherTaxAmount?: string;
  authoritativeImportVatAmount?: string;
  /** Server-derived cumulative PP36 functional-currency tax base. Public callers are ignored unless an internal use case supplies the trusted override. */
  authoritativeSelfAssessedTaxBaseAmount?: string;
  /** Server-derived cumulative PP36 amount. Public callers are ignored unless an internal use case supplies the trusted override. */
  authoritativeSelfAssessedTaxAmount?: string;
  evidenceRefs?: string[];
  /** Server-derived from verified PP36_RECEIPT evidence; callers cannot self-assert this flag. */
  pp36InputClaimEvidenceVerified?: boolean;
  accountHint?: string;
  correctionSign?: 1 | -1;
};

export type TaxReportContribution = {
  formType: TaxReportForm;
  boxKey: string;
  amount: string;
  amountSource: TaxReportAmountSource;
};

export type TransactionTaxComponentPreview = {
  componentKey: 'VAT' | 'IMPORT_VAT' | 'PP36_OUTPUT' | 'PP36_INPUT' | 'CUSTOMS_DUTY' | 'EXCISE_TAX' | 'OTHER_IMPORT_TAX';
  snapshot: TransactionTaxSnapshot;
  accountRole: TaxAccountRole | null;
  accountId: string | null;
  accountAssignments: Array<{ accountRole: TaxAccountRole; accountId: string; postingSide: 'DEBIT' | 'CREDIT'; ruleVersion: number }>;
  reportContributions: TaxReportContribution[];
};

export type ResolveTransactionTaxPreviewDto = {
  components: TransactionTaxComponentPreview[];
  /** Compatibility summary only. Consumers must use components for posting/reporting. */
  snapshot: TransactionTaxSnapshot;
  accountRole: TaxAccountRole | null;
  accountId: string | null;
  reportContributions: TaxReportContribution[];
  warnings: string[];
  errors: string[];
  sourceChecksum: string;
  configurationChecksum: string;
};

export type TaxAccountDeterminationRuleDto = {
  id: string;
  companyId: string;
  taxCodeDefinitionId: string | null;
  taxRegime: TransactionTaxRegime;
  direction: TransactionTaxDirection;
  treatment: TransactionTaxTreatment;
  transactionContext: TransactionTaxContext | null;
  sourceModule: string | null;
  accountRole: TaxAccountRole;
  accountId: string;
  postingSide: 'DEBIT' | 'CREDIT';
  priority: number;
  status: TaxConfigurationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
};

export type UpsertTaxAccountDeterminationRuleInput = Omit<TaxAccountDeterminationRuleDto, 'id' | 'companyId' | 'status' | 'version'> & { id?: string };

export type TaxReportMappingRuleDto = {
  id: string;
  companyId: string;
  taxCodeDefinitionId: string;
  formType: TaxReportForm;
  boxKey: string;
  amountSource: TaxReportAmountSource;
  signRule: 'NORMAL' | 'INVERT';
  status: TaxConfigurationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
};

export type UpsertTaxReportMappingRuleInput = Omit<TaxReportMappingRuleDto, 'id' | 'companyId' | 'status' | 'version'> & { id?: string };

export type TradeTaxEvidenceDto = {
  id: string;
  companyId: string;
  branchId: string | null;
  transactionContext: TransactionTaxContext;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  evidenceType: string;
  referenceNumber: string;
  evidenceDate: string;
  countryCode: string | null;
  currency: string;
  exchangeRate: string | null;
  exchangeRateSource: string | null;
  customsValue: string;
  dutyAmount: string;
  exciseAmount: string;
  otherTaxAmount: string;
  importVatAmount: string;
  attachmentIds: string[];
  status: TaxEvidenceReviewStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
};

export type CreateTradeTaxEvidenceInput = Omit<TradeTaxEvidenceDto, 'id' | 'companyId' | 'status' | 'reviewedByUserId' | 'reviewedAt'>;

export type TaxReconciliationIssueCode =
  | 'MATCHED' | 'SOURCE_EVENT_MISMATCH' | 'EVENT_JOURNAL_MISMATCH' | 'REPORT_MISMATCH'
  | 'MISSING_TAX_CODE' | 'MISSING_ACCOUNT_RULE' | 'MISSING_REPORT_RULE' | 'EVIDENCE_PENDING' | 'CURRENCY_MISMATCH';

export type TaxReconciliationRunDto = {
  id: string;
  companyId: string;
  branchId: string | null;
  formType: TaxReportForm;
  periodKey: string;
  status: 'GENERATED' | 'NEEDS_REVIEW' | 'REVIEWED';
  checksum: string;
  blockingIssueCount: number;
  createdAt: string;
  reviewedAt: string | null;
};

export type TaxReconciliationLineDto = {
  id: string;
  runId: string;
  branchId: string | null;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  componentKey: TransactionTaxComponentPreview['componentKey'];
  taxEventId: string | null;
  journalEntryId: string | null;
  externalTaxCode: string | null;
  sourceCurrency: string | null;
  taxCurrency: string | null;
  sourceBaseAmount: string;
  sourceTaxAmount: string;
  eventBaseAmount: string;
  eventTaxAmount: string;
  journalTaxAmount: string;
  reportAmount: string;
  sourceEventDelta: string;
  eventJournalDelta: string;
  eventReportDelta: string;
  issueCode: TaxReconciliationIssueCode;
  blocking: boolean;
  sourceRefs: Array<{ sourceType: string; sourceId: string; sourceLineId?: string }>;
};

export type TaxReconciliationDetailDto = TaxReconciliationRunDto & {
  lines: TaxReconciliationLineDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type TransactionTaxAgentSummaryDto = {
  companyId: string;
  profile: TaxCodeProfileDto | null;
  periodKey: string | null;
  pp30: Pp30BoxesDto | null;
  componentSummary: Array<{
    componentKey: TransactionTaxComponentPreview['componentKey'] | 'LEGACY_VAT';
    transactionContext: TransactionTaxContext | null;
    eventCount: number;
    taxableBase: string;
    taxAmount: string;
    evidencePendingCount: number;
  }>;
  latestReconciliation: TaxReconciliationRunDto | null;
  needsReviewCount: number;
  evidenceReviewPendingCount: number;
  permissionChecked: true;
};

export type Pp30BoxesDto = {
  box1TotalSales: string;
  box2ZeroRatedSales: string;
  box3ExemptSales: string;
  box4TaxableSales: string;
  box5OutputTax: string;
  box6EligiblePurchases: string;
  box7InputTax: string;
  box8TaxPayable: string;
  box9TaxOverpaid: string;
};
