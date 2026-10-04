import { COMPANY_TEAM_NOTE_MANAGE_PERMISSION } from './company-team-note.js';
import { SIGNUP_DISCOVERY_SOURCE_OPTIONS } from './external-signup.js';
import { PLAN_TERM_STATE_LABEL_TH, type PlanTermState } from './plan-term.js';
import { REPORT_INDUSTRY_GROUPS } from './report-labels.js';

/** Executive accounts: BE spec §16.1 API07–10/API14/API15 and §17. */
export const EXECUTIVE_ROLE_KEYS = ['MANGMEE_EXECUTIVE', 'MANGMEE_EXECUTIVE_EXPORT', 'MANGMEE_EXECUTIVE_CONTACT', 'MANGMEE_EXECUTIVE_COMPANY_NOTE'] as const;
export const EXECUTIVE_PERMISSION_KEYS = ['system.executive.read', 'system.executive.export', 'system.executive.contact.read', 'system.executive_user.manage', COMPANY_TEAM_NOTE_MANAGE_PERMISSION] as const;
export const EXECUTIVE_ACCOUNT_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type ExecutiveAccountStatus = typeof EXECUTIVE_ACCOUNT_STATUSES[number];
export type ExecutiveUserAccess = { canExport: boolean; canSeeContacts: boolean; canManageCompanyNote?: boolean };
export type ExecutiveUserCreateBody = ExecutiveUserAccess & {
  username: string; displayName: string; phoneNumber?: string; email?: string;
};
export type ExecutiveUserListQuery = { q?: string; status?: ExecutiveAccountStatus; page?: number; pageSize?: number };
export type ExecutiveUserView = ExecutiveUserAccess & {
  userId: string; username: string; displayName: string; phoneNumber: string | null; email: string | null;
  status: ExecutiveAccountStatus; canRead: boolean; lastWebEntryAt: string | null; temporaryPasswordExpiresAt: string | null;
};
export type ExecutiveUserListDto = {
  items: ExecutiveUserView[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type ExecutiveUserCredential = { userId: string; username: string; temporaryPassword: string; expiresAt: string };
export type ExecutiveUserCreateResult = { user: ExecutiveUserView; credential: ExecutiveUserCredential };
export type ExecutiveUserReasonBody = { reason: string };
export type ExecutiveUserStatusBody = ExecutiveUserReasonBody & { status: 'ACTIVE' | 'SUSPENDED' };
export type ExecutiveUserAccessBody = ExecutiveUserReasonBody & ExecutiveUserAccess;

// ── Executive report: the read API01–API06 (BE spec §12.4, §13, §16.1–§16.5) ─────────────────────

/** Every reason a figure is partial or missing (§16.5), plus the sub-reasons of PAYMENT_HISTORY_INCOMPLETE (§13.2). */
export const EXECUTIVE_REASON_CODES = ['ACTIVITY_HISTORY_INCOMPLETE', 'PAYMENT_HISTORY_INCOMPLETE', 'BILLING_SCAN_NOT_COMPLETE', 'UNMATCHED_MONEY',
  'PURCHASE_KIND_UNKNOWN', 'ADDON_NOT_ON_SALE', 'CLASSIFICATION_INCOMPLETE', 'INDUSTRY_NOT_PROVIDED', 'HISTORY_BEFORE_COLLECTION',
  'HISTORY_BEFORE_FIRST_BUILD', 'SOURCE_ROWS_PURGED', 'SOURCE_STALE', 'NOT_YET_REGISTERED', 'RANGE_MONTH_NOT_BUILT', 'DISTINCT_USERS_NOT_AVAILABLE', 'MONTH_SUMMARY_INCOMPLETE', 'NOT_ENTITLED', 'TOO_FEW_COMPANIES', 'NO_POSITIVE_NET'] as const;
export type ExecutiveReasonCode = typeof EXECUTIVE_REASON_CODES[number];
export const EXECUTIVE_PAID_EVER_REASONS = ['BILLING_SOURCE_REVIEW', 'MANUAL_TERM_NO_RECEIPT', 'LEGACY_NO_TERM', 'BILLING_SCAN_NOT_COMPLETE', 'UNMATCHED_MONEY'] as const;
export type ExecutivePaidEverReason = typeof EXECUTIVE_PAID_EVER_REASONS[number];

const planStateLabels = Object.fromEntries((['ACTIVE', 'TRIAL', 'NO_PACKAGE', 'EXPIRED', 'ADMIN_HOLD'] as const satisfies readonly PlanTermState[])
  .map((state) => [state, PLAN_TERM_STATE_LABEL_TH[state]]));

/**
 * Every value a report filter takes (§12.4) with its words on screen, ALL first. API01 lists them as the filter options and the
 * web shows the same words for the values on rows and chips, so a word is spelled here only. The sellers of `referringSales`
 * come from the data (API01): "ชื่อ · รหัสเซลล์".
 */
export const EXECUTIVE_REPORT_LABELS: Record<'industry' | 'discovery' | 'referringSales' | 'companyStatus' | 'planState' | 'usageGroup' | 'paidEver'
  | 'receiptAdoption' | 'spendCohort' | 'signupRail', Readonly<Record<string, string>>> = {
  industry: { ALL: 'ทุกธุรกิจ', ...Object.fromEntries(REPORT_INDUSTRY_GROUPS.map((group) => [group.key, group.label])), UNKNOWN: 'ไม่ระบุ' },
  discovery: { ALL: 'ทุกช่องทาง', ...Object.fromEntries(SIGNUP_DISCOVERY_SOURCE_OPTIONS.map((option) => [option.value, option.label])),
    UNKNOWN: 'ไม่ระบุ', BEFORE_COLLECTION: 'ก่อนเริ่มเก็บข้อมูล', ADMIN_CREATED: 'ผู้ดูแลสร้าง' },
  referringSales: { ALL: 'ทั้งหมด', NONE: 'ไม่มีเซลล์ผู้แนะนำ', UNKNOWN: 'ไม่ระบุ', UNRESOLVED: 'เซลล์ที่ไม่พบข้อมูลแล้ว' },
  companyStatus: { ALL: 'ทุกสถานะ', ACTIVE: 'ใช้งานอยู่', SUSPENDED: 'ระงับชั่วคราว', DISABLED: 'ปิดใช้งาน', ARCHIVED: 'เก็บถาวร' },
  planState: { ALL: 'ทุกสถานะ', ...planStateLabels },
  usageGroup: { ALL: 'ทั้งหมด', NOT_STARTED: 'จ่ายแล้ว ยังไม่เริ่มใช้', INACTIVE: 'เคยใช้ แต่ไม่ใช้ในเดือน', ACTIVE: 'จ่ายแล้ว ใช้งานในเดือน', NOT_PAID: 'ยังไม่เคยชำระเงิน' },
  paidEver: { ALL: 'ทั้งหมด', YES: 'เคยชำระเงิน', NO: 'ยังไม่เคยชำระเงิน', UNKNOWN: 'ยังประเมินไม่ได้' },
  receiptAdoption: { ALL: 'ทุกบริษัท', EVER: 'เคยเพิ่มใบเสร็จ', NEVER: 'ยังไม่พบการเพิ่มใบเสร็จ', UNKNOWN: 'ยังประเมินไม่ได้', NOT_ENTITLED: 'ไม่มีในแพ็กเกจ' },
  // The two TIE values are opened from a sentence under a group, not offered in the filter (API01 leaves them out).
  spendCohort: { ALL: 'ทุกบริษัท', TOP20: 'ลูกค้าที่จ่ายสูงสุด 20% แรก', REST: 'ลูกค้านอกกลุ่มที่จ่ายสูงสุด 20% แรก', TO80: 'บริษัทที่รวมยอดรับถึง 80%',
    BOUNDARY_TIE: 'จ่ายเท่ากับลำดับสุดท้ายของลูกค้าที่จ่ายสูงสุด 20% แรก', TO80_BOUNDARY_TIE: 'จ่ายเท่ากับลำดับสุดท้ายของบริษัทที่รวมยอดรับถึง 80%' },
  // 'email-otp': existing wording approved by the owner on 2026-10-03 (spec §15, D12).
  signupRail: { ALL: 'ทั้งหมด', 'official-site': 'สมัครทางเว็บไซต์', 'line-oa': 'สมัครทาง LINE', 'email-otp': 'สมัครด้วยรหัสอีเมล', ADMIN_CREATED: 'ผู้ดูแลสร้าง', UNKNOWN: 'ไม่ระบุ' },
};
export type ExecutiveFilterKey = keyof typeof EXECUTIVE_REPORT_LABELS;
/** The words of the list's yes/no filters as chips: the card or line each one opens (plain-language spec, N02, N03, N05, N12). */
export const EXECUTIVE_FLAG_LABELS: Record<'usageAssessed' | 'activeInPeriod' | 'paidInPeriod' | 'positiveNetInPeriod' | 'fullyRefunded' | 'joinedInPeriod', Readonly<Record<string, string>>> = {
  usageAssessed: { false: 'ยังประเมินไม่ได้', true: 'ไม่รวมบริษัทที่ยังประเมินไม่ได้' },
  activeInPeriod: { true: 'ใช้งานในเดือน' },
  paidInPeriod: { true: 'ชำระในเดือน' },
  positiveNetInPeriod: { true: 'จ่ายมากกว่ายอดคืนในเดือน' },
  fullyRefunded: { true: 'คืนเงินเต็มจำนวน' },
  joinedInPeriod: { true: 'ลูกค้าใหม่ในช่วงนี้' },
};
/** A province, channel, group or rail nobody recorded (plain-language spec: ไม่ทราบ … → ไม่ระบุ). */
export const EXECUTIVE_UNKNOWN_LABEL = 'ไม่ระบุ';
/** The package of a company with no package data at all (no term row). */
export const EXECUTIVE_NO_PLAN_DATA_LABEL = 'ยังไม่มีข้อมูลแพ็กเกจ';
/** Words added after a referrer the admin put in or changed later (`referrer.source = ADMIN`). */
export const EXECUTIVE_REFERRER_ADMIN_SUFFIX = '(ผู้ดูแลแก้ไข)';

/** The list's orders (§12.4) with their words; ties go to the company that joined first. */
export const EXECUTIVE_SORT_OPTIONS = [
  { sortBy: 'joinedAt', sortDir: 'desc', label: 'สมัครล่าสุดก่อน' },
  { sortBy: 'companyName', sortDir: 'asc', label: 'ชื่อบริษัท ก → ฮ' },
  { sortBy: 'netReceipts', sortDir: 'desc', label: 'ยอดรับสุทธิในเดือน มาก → น้อย' },
  { sortBy: 'lastActivityAt', sortDir: 'desc', label: 'ใช้ระบบล่าสุดก่อน' },
  { sortBy: 'expenseReceiptCount', sortDir: 'desc', label: 'ใบเสร็จในเดือน มาก → น้อย' },
  { sortBy: 'activeDays', sortDir: 'desc', label: 'วันใช้งาน มาก → น้อย' },
  { sortBy: 'aiRequests', sortDir: 'desc', label: 'ใช้ผู้ช่วย มาก → น้อย' },
] as const;
export type ExecutiveSortBy = typeof EXECUTIVE_SORT_OPTIONS[number]['sortBy'];
export const EXECUTIVE_RANKING_METRICS = ['expenseReceiptCount', 'activeDays', 'aiRequests'] as const;
export type ExecutiveRankingMetric = typeof EXECUTIVE_RANKING_METRICS[number];

/**
 * How the revenue table groups billing's `purchaseKind` (§14.1). Q22: a purchase after the package ran out (RETURN) is shown
 * with the renewals; the company history uses the same grouping. Regrouping is a change here only.
 */
export const EXECUTIVE_PURCHASE_GROUPS = [
  { key: 'FIRST_PURCHASE', label: 'ซื้อครั้งแรก', kinds: ['FIRST_PURCHASE'] },
  { key: 'RENEWAL', label: 'ต่ออายุ', kinds: ['RENEWAL', 'RETURN'] },
  { key: 'UPGRADE', label: 'อัปเกรด', kinds: ['UPGRADE'] },
  { key: 'ADD_ON', label: 'ส่วนเสริม', kinds: ['ADD_ON'] },
  { key: 'UNKNOWN', label: 'ยังไม่จัดประเภท', kinds: ['UNKNOWN'] },
] as const;
export type ExecutivePurchaseGroup = typeof EXECUTIVE_PURCHASE_GROUPS[number]['key'];

/** The kinds of event the company history returns (§16.1 API06), with their words. No other kind is returned. */
export const EXECUTIVE_HISTORY_EVENT_LABELS = {
  SIGNED_UP: 'สมัคร', ACTIVATED: 'เปิดใช้งาน', SUSPENDED: 'ระงับชั่วคราว', DISABLED: 'ปิดใช้งาน', ARCHIVED: 'เก็บถาวร',
  PACKAGE_PURCHASED: 'ซื้อแพ็กเกจ', PACKAGE_RENEWED: 'ต่ออายุแพ็กเกจ', PACKAGE_EXPIRED: 'แพ็กเกจหมดอายุ',
} as const;
export type ExecutiveHistoryEventKind = keyof typeof EXECUTIVE_HISTORY_EVENT_LABELS;

// ── Requests (§12.4). Query values are strings, as they travel in the URL. ──

export const EXECUTIVE_PERIOD_PRESETS = ['THIS_MONTH', 'LAST_MONTH', 'THIS_QUARTER', 'THIS_YEAR', 'LAST_12_MONTHS', 'ALL'] as const;
export type ExecutivePeriodPreset = typeof EXECUTIVE_PERIOD_PRESETS[number];
/** The legacy month is accepted alone during URL migration; pairs must be supplied together. */
export type ExecutivePeriodRequest = { from?: string; to?: string; month?: string };
export type ExecutivePreset = { key: ExecutivePeriodPreset; from: string | null; to: string | null; available: boolean; unbuiltBoundaryMonths: string[] };
export type ExecutiveReportQuery = ExecutivePeriodRequest & { buildId?: string; industry?: string; discovery?: string; referringSales?: string };
export type ExecutiveCompaniesQuery = ExecutiveReportQuery & {
  companyStatus?: string; planState?: string; usageGroup?: string; usageAssessed?: 'true' | 'false'; activeInPeriod?: 'true'; paidInPeriod?: 'true';
  positiveNetInPeriod?: 'true'; paidEver?: string; fullyRefunded?: 'true'; receiptAdoption?: string; spendCohort?: string; signupRail?: string;
  joinedInPeriod?: 'true'; q?: string; sortBy?: ExecutiveSortBy; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number;
};
export type ExecutiveAnalysisQuery = ExecutiveReportQuery & {
  section: 'usage' | 'revenue' | 'customers' | 'compare';
  /** usage: adoption | ranking; revenue: summary | top; customers: industry | discovery | sales. */
  view?: string; metric?: ExecutiveRankingMetric;
  /** compare only: industry | discovery | referringSales | company, and the two sides (a group key, a sales code, or a company id). */
  dimension?: string; sideA?: string; sideB?: string;
};
export type ExecutiveHistoryQuery = ExecutivePeriodRequest & { buildId?: string; page?: number; pageSize?: number };
/**
 * The complete API03 query (besides month and buildId) that opens the companies behind a card, a group row or a chart segment:
 * the request's own filters plus the item's. The list it opens has exactly the count shown (§12.4, RB-19).
 */
export type ExecutiveDrilldownFilters = { from?: string; to?: string } & Partial<Record<Exclude<keyof ExecutiveCompaniesQuery, 'month' | 'from' | 'to' | 'buildId' | 'q' | 'page' | 'pageSize'>, string>>;

// ── Responses (§16.2) ──

export type ExecutiveCoverage = 'complete' | 'partial' | 'unavailable';
/** A count. Partial: `value` is null and `knownValue` is what is confirmed ("อย่างน้อย N"). Unavailable: both absent. */
export type ExecutiveAffectedMonth = { month: string; reasonCodes: ExecutiveReasonCode[] };
export type ExecutiveCount = { value: number | null; knownValue?: number; coverage: ExecutiveCoverage; reasonCodes: ExecutiveReasonCode[]; affectedMonths?: ExecutiveAffectedMonth[]; comparison?: ExecutivePeriodComparison };
export type ExecutivePeriodComparison = {
  period: ExecutiveRangePeriod; current: ExecutiveCount; previous: ExecutiveCount; absoluteChange: number | null; percentChange: number | null;
  status: 'COMPLETE' | 'UNCHANGED' | 'ZERO_BASE' | 'NEGATIVE_BASE' | 'NO_PREVIOUS' | 'PARTIAL'; affectedMonths: ExecutiveAffectedMonth[]; includesOpenMonth: boolean;
};
/** Satang, THB. Partial money is never "at least": `knownValue` is the total of what is confirmed ("ยอดเฉพาะรายการที่ยืนยันแล้ว"). */
export type ExecutiveMoney = ExecutiveCount & { currency: 'THB' };
/** A share or an average, rounded half up from whole numbers by the backend; null when the denominator is 0. */
export type ExecutiveRatio = { value: number | null; numerator: number; denominator: number; comparison?: ExecutivePeriodComparison };
export type ExecutiveOption = { value: string; label: string };
export type ExecutiveBuildRef = { id: string; asOf: string; definitionVersion: number; dimensionVersion: number; monthRevision: number; monthRevisedAt: string | null };
export type ExecutiveRangePeriod = { from: string; to: string; monthCount: number; appliedPreset: ExecutivePeriodPreset | null; timeZone: 'Asia/Bangkok'; startInclusive: string; endExclusive: string; effectiveEndExclusive: string; includesOpenMonth: boolean };
/** Legacy fields remain during the web migration. New responses always include the range fields. */
export type ExecutivePeriod = Partial<ExecutiveRangePeriod> & { month: string; timeZone: 'Asia/Bangkok'; startInclusive: string; endExclusive: string; effectiveEndExclusive: string; isPartialMonth: boolean };
export type ExecutiveDataSource = 'billing' | 'activity' | 'aiCost' | 'profile';
export type ExecutiveDataThrough = Record<ExecutiveDataSource, string | null> & { oldest: string | null; lagging: ExecutiveDataSource[] };
export type ExecutiveSourceCoverage = { coverage: ExecutiveCoverage; reasonCodes: ExecutiveReasonCode[]; affectedMonths?: ExecutiveAffectedMonth[] };
export type ExecutiveMonthMetadata = { month: string; built: boolean; isPartialMonth: boolean; revision: number | null; revisedAt: string | null; dataThrough: ExecutiveDataThrough; coverage: Record<'money' | 'usage' | 'aiCost' | 'population', ExecutiveSourceCoverage> };
export type ExecutivePeriodMetric = 'companies' | 'newCompanies' | 'activeCompanies' | 'companiesWithReceipts' | 'positiveNetCompanies' | 'paidEverCompanies' | 'fullyRefundedCompanies' | 'receiptsSatang' | 'refundsSatang' | 'netReceiptsSatang' | 'feesSatang' | 'taxSatang' | 'aiCostSatang' | 'expenseReceiptCount' | 'documents' | 'aiRequests' | 'netReceiptsPerCompanySatang' | 'expenseReceiptsPerCompany' | 'activeCompanyShare' | 'paidCompanyShare' | 'activeDays';
export type ExecutiveMonthlySeries = { side?: 'A' | 'B'; metric: ExecutivePeriodMetric; timeBasis: 'PERIOD' | 'END_OF_PERIOD'; points: Array<{ month: string; metricValue: ExecutiveCount; coverage: ExecutiveCoverage; reasonCodes: ExecutiveReasonCode[] }> };

export type ExecutiveEnvelope = {
  requestId: string;
  build: ExecutiveBuildRef;
  /** The request named a buildId that is no longer the current set: reload the cards and tables once. */
  buildChanged: boolean;
  /** Reasons that hold for the whole answer: SOURCE_STALE, or why `spendCohort` has no members this month. */
  reasonCodes: ExecutiveReasonCode[];
  period: ExecutivePeriod;
  months?: ExecutiveMonthMetadata[]; previousMonths?: ExecutiveMonthMetadata[];
  periodComparisons?: Partial<Record<ExecutivePeriodMetric, ExecutivePeriodComparison>>; monthlySeries?: ExecutiveMonthlySeries[];
  dataThrough: ExecutiveDataThrough;
  appliedFilters: { global: Record<string, ExecutiveOption>; directory: Record<string, ExecutiveOption> };
  population: {
    eligibleCount: ExecutiveCount; excludedTestInternalCount: number; unclassifiedCount: number;
    excludedTestInternalNetReceiptsSatang: number;
    /** Net money of companies not classified yet: with the line above and `unmatchedMoney` the month reconciles with the provider. */
    unclassifiedNetReceiptsSatang: number;
    excludedTestInternalMoneyCoverage?: ExecutiveSourceCoverage; unclassifiedMoneyCoverage?: ExecutiveSourceCoverage;
  };
  unmatchedMoney: { count: number; receiptsSatang: number; refundsSatang: number; otherSatang: number; coverage?: ExecutiveSourceCoverage };
  /** The month's money and usage sources: what every figure of this answer stands on. */
  coverage: { money: ExecutiveSourceCoverage; usage: ExecutiveSourceCoverage };
};

export type ExecutiveDrillCount = { count: number; drilldownFilters: ExecutiveDrilldownFilters };
export type ExecutivePaidUsage = {
  basis: 'EVER_PAID_BEFORE_CUTOFF';
  paidEver: ExecutiveDrillCount;
  groups: Array<{ key: 'NOT_STARTED' | 'INACTIVE' | 'ACTIVE' | 'NOT_PAID'; count: number; drilldownFilters: ExecutiveDrilldownFilters }>;
  /** Paid, but the usage history is too short to place them (ACTIVITY_HISTORY_INCOMPLETE). */
  usageUnassessed: ExecutiveDrillCount;
  fullyRefunded: ExecutiveDrillCount;
  /** Payment not provable either way (PAYMENT_HISTORY_INCOMPLETE), by sub-reason; no list filter splits the sub-reasons. */
  paymentUnknown: ExecutiveDrillCount & { byReason: Partial<Record<ExecutivePaidEverReason, number>> };
};
export type ExecutiveReceiptAdoption = {
  population: number; ever: number; never: number; unknown: number; notEntitled: number;
  segments: Array<{ key: 'EVER' | 'NEVER' | 'UNKNOWN' | 'NOT_ENTITLED'; count: number; share: ExecutiveRatio; drilldownFilters: ExecutiveDrilldownFilters }>;
  roundingNote: boolean; coverage: ExecutiveCoverage; reasonCodes: ExecutiveReasonCode[]; timeBasis: 'CURRENT';
};
export type ExecutiveTie = { count: number; netSatang: number };
export type ExecutiveSpendConcentration = {
  population: number; positiveCompanyCount: number | null; positiveNetTotalSatang: number | null; signedNetTotalSatang: number; negativeNetSatang: number | null;
  /** `population − positiveCompanyCount`: net of the month 0 or below, companies with no money at all included. Like `positiveCompanyCount`, under `coverage`. */
  nonPositiveCount: number | null;
  /** Paid in the month but not more than was refunded in the month: why "ชำระในเดือน" is larger than `positiveCompanyCount`. */
  receiptsWithoutPositiveNet: number | null;
  topTargetCount: number; topCount: number | null; topShare: ExecutiveRatio | null; prefix80Count: number | null; prefix80Share: ExecutiveRatio | null;
  /** Everyone in scope outside the 20% group (`population − topCount`, those paying 0 or less included) and its part of the positive total. */
  restCount: number | null; restShare: ExecutiveRatio | null;
  /** Each group's companies as a share of `population`: the 20% group is K = ceil(N × 0.2) companies, which is not exactly 20%. */
  topCompanyShare: ExecutiveRatio | null; prefix80CompanyShare: ExecutiveRatio | null; restCompanyShare: ExecutiveRatio | null;
  /** The shares of the 20% group and of the rest, in money or in companies, miss 100.0 only because of rounding (UI spec: a note says so). */
  roundingNote: boolean;
  boundaryTie?: ExecutiveTie; prefix80BoundaryTie?: ExecutiveTie;
  periodBasis: 'SELECTED_MONTH' | 'SELECTED_PERIOD'; coverage: ExecutiveCoverage; reasonCodes: ExecutiveReasonCode[];
  drilldownFilters: Partial<Record<'TOP20' | 'REST' | 'TO80' | 'BOUNDARY_TIE' | 'TO80_BOUNDARY_TIE', ExecutiveDrilldownFilters>>;
};

export type ExecutiveContext = {
  requestId: string;
  capabilities: Record<'readReport' | 'export' | 'seeContacts' | 'manageAccounts', { allowed: boolean }>;
  filters: Record<ExecutiveFilterKey, ExecutiveOption[]>;
  sortOptions: ReadonlyArray<{ sortBy: ExecutiveSortBy; sortDir: 'asc' | 'desc'; label: string }>;
  currentMonth: string; defaultMonth: string;
  defaultPeriod?: { from: string; to: string; appliedPreset: ExecutivePeriodPreset }; presets?: ExecutivePreset[];
  /** Months that can be asked for, oldest first; null before the first build. */
  months: { first: string; last: string } | null;
  /** The months the data set holds, oldest first: a month in `months` but not here has not been built yet (503 until it is). */
  builtMonths: string[];
  /** First month each source holds data for (`YYYY-MM`); null = the source has no row yet. */
  earliestAvailableMonth: Record<'aiUsage' | 'receiptReading' | 'billing' | 'discovery', string | null>;
  build: Omit<ExecutiveBuildRef, 'monthRevision' | 'monthRevisedAt'> | null;
};

export type ExecutiveOverview = ExecutiveEnvelope & {
  metrics: {
    newCompanies?: ExecutiveCount & { drilldownFilters: ExecutiveDrilldownFilters };
    companies: ExecutiveCount & { unclassifiedCount: number; drilldownFilters: ExecutiveDrilldownFilters };
    /** `breakdown` says why the card is larger than the "paid and used" group: the companies that used it without that group. */
    activeCompanies: ExecutiveCount & { drilldownFilters: ExecutiveDrilldownFilters; breakdown: { paidActive: number; notPaid: number; paymentUnknown: number; fullyRefunded: number } };
    companiesWithReceipts: ExecutiveCount & { drilldownFilters: ExecutiveDrilldownFilters };
    netReceiptsSatang: ExecutiveMoney & { drilldownFilters: ExecutiveDrilldownFilters };
  };
  paidUsage: ExecutivePaidUsage;
  expenseReceiptAdoption: ExecutiveReceiptAdoption;
  spendConcentration: Pick<ExecutiveSpendConcentration, 'topCount' | 'population' | 'topShare' | 'periodBasis' | 'coverage' | 'reasonCodes'>;
};

export type ExecutiveSeller = { label?: string; salesCode?: string };
export type ExecutiveCompanyRow = {
  /** Internal: the key and the detail page path only. Never shown. */
  id: string;
  displayName: string; registeredName: string | null; provinceLabel: string; joinedAt: string;
  industryGroup: { key: string; label: string }; companyStatus: string; planState: string; planLabel: string;
  discovery: { key: string; label: string; otherText?: string }; signupRail: string;
  referrer: { kind: 'KNOWN' | 'NONE' | 'UNKNOWN' | 'UNRESOLVED'; label: string; salesCode?: string; source?: 'SIGNUP_CODE' | 'ADMIN' };
  creditedSeller: ExecutiveSeller;
  paidEver: { value: 'YES' | 'NO' | 'UNKNOWN'; reason?: string }; fullyRefunded: boolean;
  usageGroup: 'NOT_STARTED' | 'INACTIVE' | 'ACTIVE' | 'NOT_PAID' | null; usageUnassessedReason?: string; receiptAdoption: string;
  coverage?: { money: ExecutiveSourceCoverage; usage: ExecutiveSourceCoverage };
  metrics: { receiptsSatang: number | null; refundsSatang: number | null; netReceiptsSatang: number | null; activeDays: number | null; activeUsers: number | null; documents: number | null;
    aiRequests: number | null; expenseReceiptCountInPeriod: number | null; expenseReceiptCountLifetime: number };
  lastActivityAt: string | null;
  /** With a metric order: the rank among the companies in scope (ties share it: 1, 1, 3), and for net receipts the cumulative share. */
  rank?: number; cumulativeShare?: ExecutiveRatio | null;
};
export type ExecutiveCompanies = ExecutiveEnvelope & {
  summary: { netReceiptsSatang: ExecutiveMoney };
  items: ExecutiveCompanyRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  sort: { sortBy: ExecutiveSortBy; sortDir: 'asc' | 'desc' };
};

export type ExecutiveGroupRow = {
  key: string; label: string; companies: { count: number; share: ExecutiveRatio; comparison?: ExecutivePeriodComparison };
  companiesWithReceipts: ExecutiveCount; paidEverCompanies: number; activeCompanies: ExecutiveCount; netReceiptsSatang: ExecutiveMoney;
  drilldownFilters: ExecutiveDrilldownFilters;
};
export type ExecutiveCreditedRow = { seller: ExecutiveSeller; companies: number; waiting: number; creditSatang: number };
export type ExecutiveMoneyRow = { receiptsSatang: ExecutiveMoney; refundsSatang: ExecutiveMoney; netReceiptsSatang: ExecutiveMoney; feesSatang: ExecutiveMoney; taxSatang: ExecutiveMoney };
export type ExecutiveCompareSide = {
  key: string; label: string; drilldownFilters: ExecutiveDrilldownFilters | null;
  periodComparisons?: Partial<Record<ExecutivePeriodMetric, ExecutivePeriodComparison>>;
  companies: ExecutiveCount; netReceiptsSatang: ExecutiveMoney; netReceiptsPerCompanySatang: ExecutiveRatio | null;
  /** Averages and shares are null when a figure they come from is "at least" or unavailable (spec §13.1). */
  expenseReceiptCount: ExecutiveCount; expenseReceiptsPerCompany: ExecutiveRatio | null; everAddedReceiptShare: ExecutiveRatio | null; activeCompanies: ExecutiveCount;
};
export type ExecutiveAnalysis = ExecutiveEnvelope & {
  section: ExecutiveAnalysisQuery['section']; view: string;
  expenseReceiptAdoption?: ExecutiveReceiptAdoption; paidUsage?: ExecutivePaidUsage;
  usageRanking?: { metric: ExecutiveRankingMetric; total: number; coverage: ExecutiveCoverage; reasonCodes: ExecutiveReasonCode[];
    items: Array<{ id: string; displayName: string; registeredName: string | null; provinceLabel: string; value: number; rank: number }>;
    boundaryTie?: { count: number; value: number }; drilldownFilters: ExecutiveDrilldownFilters };
  revenue?: ExecutiveMoneyRow & {
    byPurchaseGroup: Array<{ key: ExecutivePurchaseGroup; label: string } & ExecutiveMoneyRow>;
    disputedInvoiceCount: number | null;
    /** Six months up to the selected one. A month with no money data is null, never 0. */
    trend: Array<{ month: string; isPartialMonth: boolean; disputedInvoiceCount?: ExecutiveCount; netReceiptsSatang: ExecutiveMoney; receiptsSatang: ExecutiveMoney; refundsSatang: ExecutiveMoney }>;
  };
  spendConcentration?: ExecutiveSpendConcentration;
  groups?: ExecutiveGroupRow[]; roundingNote?: boolean;
  /** Industry view: how many companies have a group at all. */
  industryCoverage?: ExecutiveRatio;
  /** Sales view: first-payment credit per credited seller, as it stands now (§14.3); never to be added to money received. */
  creditedSellers?: { timeBasis: 'CURRENT'; asOf: string; rows: ExecutiveCreditedRow[] };
  comparison?: { dimension: string; base: 'ALL_CUSTOMER_COMPANIES'; sideA: ExecutiveCompareSide; sideB: ExecutiveCompareSide;
    difference: Record<'companies' | 'netReceiptsSatang' | 'netReceiptsPerCompanySatang' | 'expenseReceiptCount' | 'expenseReceiptsPerCompany' | 'everAddedReceiptShare' | 'activeCompanies', number | null> };
};

export type ExecutiveOwnerContact = { status: 'OK' | 'NO_CURRENT_OWNER' | 'MULTIPLE_OWNERS' | 'SOURCE_UNAVAILABLE' | 'NOT_PERMITTED'; email?: string | null; phoneNumber?: string | null };
export type ExecutivePeriodSummary = Omit<NonNullable<ExecutiveCompanyDetail['month']>, 'paidInMonth' | 'positiveNetInMonth' | 'fullyRefunded' | 'usage'> & {
  disputedInvoiceCount?: ExecutiveCount; fullyRefunded: boolean | null; paidInPeriod: boolean | null; positiveNetInPeriod: boolean | null;
  coverage: Record<'money' | 'usage' | 'aiCost', ExecutiveSourceCoverage>;
  usage: { [K in keyof NonNullable<ExecutiveCompanyDetail['month']>['usage']]: number | null } & { activeUsersCoverage: ExecutiveSourceCoverage };
};
export type ExecutiveCompanyDetail = ExecutiveEnvelope & {
  /** Values as they are now (`build.asOf`), not of the selected month. Contact data only for a caller allowed to see it. */
  company: Pick<ExecutiveCompanyRow, 'id' | 'displayName' | 'registeredName' | 'provinceLabel' | 'joinedAt' | 'industryGroup' | 'companyStatus' | 'planState'
    | 'planLabel' | 'discovery' | 'signupRail' | 'referrer' | 'receiptAdoption' | 'lastActivityAt'> & {
    timeBasis: 'CURRENT'; businessTypeLabel: string | null; businessTypeOtherText: string | null;
    planEndsAt: string | null; currentActiveMemberCount: number; currentBranchCount: number;
    creditedSeller: ExecutiveSeller & { creditSatang?: number; creditedAt?: string | null; state?: string | null };
    paidEver: { value: 'YES' | 'NO' | 'UNKNOWN'; reason?: string }; fullyRefunded: boolean;
    lifetimeReceiptsSatang: number; lifetimeRefundsSatang: number; expenseReceiptCountLifetime: number;
    firstActivityAt: string | null; lastWebEntryAt: string | null; lastLineActivityAt: string | null;
    ownerContact: ExecutiveOwnerContact;
  };
  periodSummary?: ExecutivePeriodSummary | null; periodReasonCodes?: ExecutiveReasonCode[];
  monthlyHistory?: Array<ExecutiveMonthMetadata & { applicable: boolean; summary: ExecutivePeriodSummary | null; reasonCodes: ExecutiveReasonCode[] }>;
  /** The selected month; null with `monthReasonCodes: ['NOT_YET_REGISTERED']` when the company joined after it. */
  month: null | {
    paidEver: { value: 'YES' | 'NO' | 'UNKNOWN'; reason?: string }; fullyRefunded: boolean; paidInMonth: boolean; positiveNetInMonth: boolean;
    usageGroup: 'NOT_STARTED' | 'INACTIVE' | 'ACTIVE' | 'NOT_PAID' | null; usageUnassessedReason?: string;
    /** `aiCostSatang`: the measured cost of the assistant and of receipt reading, with its own coverage (spec §16.6, approved by the owner 2026-10-03). */
    money: ExecutiveMoneyRow & { aiCostSatang: ExecutiveMoney };
    usage: { activeDays: number; activeDaysLine: number; activeDaysWeb: number; activeUsers: number; activeUsersLine: number; activeUsersWeb: number;
      documents: number; confirmedExpensesLine: number; confirmedExpensesWeb: number; issuedDocuments: number; aiRequests: number;
      expenseReceiptCountInPeriod: number; expenseReceiptsLine: number; expenseReceiptsWeb: number };
  };
  /** NOT_YET_REGISTERED; SOURCE_ROWS_PURGED (counters kept after the shop deleted rows); HISTORY_BEFORE_FIRST_BUILD on a "paid, not started" company created before the first build. */
  monthReasonCodes: ExecutiveReasonCode[];
};
export type ExecutiveHistoryEvent = { kind: ExecutiveHistoryEventKind; at: string; planLabel?: string };
export type ExecutiveCompanyHistory = { requestId: string; build?: ExecutiveEnvelope['build']; buildChanged?: boolean; period?: ExecutivePeriod; items: ExecutiveHistoryEvent[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

/** API13: server chooses the template. All filters apply to the entire result, never a page. */
export const EXECUTIVE_EXPORT_REPORT_KEYS = ['overview', 'companies', 'usage', 'revenue', 'customers', 'compare', 'detail'] as const;
export type ExecutiveExportReportKey = typeof EXECUTIVE_EXPORT_REPORT_KEYS[number];
export type ExecutiveExportFilters = Omit<ExecutiveCompaniesQuery, 'month' | 'from' | 'to' | 'buildId' | 'sortBy' | 'sortDir' | 'page' | 'pageSize'>;
export type ExecutiveExportBody = ExecutivePeriodRequest & {
  buildId: string; reportKey: ExecutiveExportReportKey; subview?: string; filters: ExecutiveExportFilters;
  sortBy?: ExecutiveSortBy; sortDir?: 'asc' | 'desc'; comparison?: { dimension: string; sideA: string; sideB: string };
  targetCompanyId?: string; includeContacts: boolean; format: 'xlsx';
};
