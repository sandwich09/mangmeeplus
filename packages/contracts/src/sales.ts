import type { PlanTierKey } from './plan-term.js';

/**
 * Sales console contracts (spec docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md §5, §9–§12, §17–§19).
 * Platform-tenant roles for มั่งมี's own sales team. Never the tenant role `SALES` (S06).
 */
export const SALES_ROLE_KEYS = ['MANGMEE_SALES_LEAD', 'MANGMEE_SALES'] as const;
export type SalesRoleKey = typeof SALES_ROLE_KEYS[number];
export const SALES_PERMISSION_KEYS = ['sales.console.read', 'sales.company.search', 'sales.deal.create', 'sales.deal.approve',
  'sales.team.manage', 'sales.report.read', 'sales.agent_profile.manage'] as const;
export type SalesPermissionKey = typeof SALES_PERMISSION_KEYS[number];

export const SALES_DEAL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'APPLIED', 'EXPIRED', 'REJECTED', 'CANCELLED'] as const;
export type SalesDealStatus = typeof SALES_DEAL_STATUSES[number];
/** Statuses that still hold the company's one non-final deal (R3/S18). */
export const SALES_DEAL_OPEN_STATUSES: readonly SalesDealStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
export const SALES_DEAL_OFFER_DAYS = 3;
export const SALES_DEAL_MONTHS_MAX = 36;
export const SALES_DEAL_DESCRIPTION_MAX = 200;
export const SALES_DEAL_REASON_MAX = 500;
/**
 * D-P3-1: ENTERPRISE_1999 is NOT a deal base. The one-time Stripe path reads the base tier's
 * catalog Price for its product id, and ENTERPRISE has no Price — `paidVariant` and
 * `paid-checkout-invoice.ts` know only these three. A deal expresses any size through its own
 * branch/employee/slip limits, so nothing is lost.
 */
export type SalesDealBaseTier = Exclude<PlanTierKey, 'FREE_TRIAL_15' | 'ENTERPRISE_1999'>;
/** Runtime companion of `SalesDealBaseTier` — the paid tiers a deal may be built on (R3). */
export const SALES_DEAL_BASE_TIERS: readonly SalesDealBaseTier[] =
  ['STARTER_249', 'BASIC_499', 'PRO_999'];

/** D-P5-1: an auto-renewing deal bills every month or every year — the only two Stripe recurring
 *  intervals `assertStripePrice` and `paidInvoiceEvidence` accept. */
export type SalesDealCadence = 'month' | 'year';
/** D-P5-1: "N รอบแล้วกลับราคาปกติ" — 1–36 cycles; `null` means "จนกว่าจะเพิกถอน". */
export const SALES_DEAL_CYCLES_MAX = 36;
/**
 * D-P5-3: where this deal's own Stripe Price stands. `null`/absent on every one-time deal.
 * Only `READY` may be quoted. `PENDING`/`FAILED` are retried by the sales sweep; `ARCHIVED` is a
 * Price that has been deactivated in Stripe because the deal ended, was cancelled or expired.
 */
export const SALES_DEAL_PRICE_STATES = ['PENDING', 'READY', 'FAILED', 'ARCHIVED'] as const;
export type SalesDealPriceState = typeof SALES_DEAL_PRICE_STATES[number];

/** Frozen into PackageChangeRequest.offerSnapshotJson when the deal is submitted; immutable once APPROVED (R3/R4). */
export type SalesDealSnapshot = {
  /** 2 = Phase 3 (one-time only). 3 = D-P5-1, which added the three auto-renew fields below.
   *  A stored v2 row reads back as `autoRenew: false` — it predates the switch, it is not one. */
  version: 2 | 3;
  base: SalesDealBaseTier;
  /** What the customer pays for the whole deal, in satang (Q2: VAT-inclusive if any). ≥ 1, no floor/ceiling (D1). */
  priceSatang: number;
  /** 1–36 whole months from the paid-at instant (Phase 3 applies them via the one-time path, spec §19).
   *  IGNORED when `autoRenew` — then `priceSatang` is the price of ONE cycle (D-P5-1/D-P5-2). */
  months: number;
  branchLimit: number; employeeLimit: number; monthlySlipLimit: number;
  featureKeys: string[];
  /**
   * null = inherit the platform budget. D-P3-2: zero is refused — closing AI is done by dropping
   * the `ai_line_assistant` menu from `featureKeys`, which is the only writer the platform has.
   */
  aiMonthlyBudgetSatang: number | null;
  /** Customer-facing note, ≤ 200 chars, no PII, no "+" (S24). */
  description: string;
  /**
   * D7/D-P5-1: charge every cycle (card) or bill every cycle (QR) instead of once. One approval
   * covers every cycle of this deal — D3's re-approval loop is for one-time deals only.
   *
   * Optional because a stored v2 row simply does not have it. Never read these three directly:
   * `autoRenewOf()` (sales-deal.logic.ts) is the one reader, and it answers `false`/`null`/`null`
   * for a v2 row and for any row whose cadence is not month/year.
   */
  autoRenew?: boolean;
  /** The billing cycle when `autoRenew`; `null` otherwise. */
  cadence?: SalesDealCadence | null;
  /** `N` cycles then back to the catalog price (D-P5-6), or `null` = until the lead ends it. */
  cycles?: number | null;
};
export type SalesDealInput = Omit<SalesDealSnapshot, 'version'> & { companyId: string; /** Team-visible only, ≤ 500 (S24). */ internalReason: string };
export type SalesDealSaveBody = SalesDealInput & { /** Required when updating a DRAFT/REJECTED deal. */ version?: number };
/** reject / cancel: the reason is what the agent reads back, so it is required (R5). */
export type SalesDealDecisionBody = { version: number; reason: string };
/** approve: the audit row already records who approved and whether it was their own deal. */
export type SalesDealApproveBody = { version: number; reason?: string };
export type SalesDealSubmitBody = { version: number };
/** D-P5-6 "จบดีล": a lead or SYSTEM_ADMIN ends an auto-renewing deal; the reason is audited. */
export type SalesDealEndBody = { version: number; reason: string };

export type SalesCompanyAccessState = 'NO_PACKAGE' | 'TRIAL' | 'ACTIVE' | 'EXPIRED';
export type SalesCompanySearchItem = {
  companyId: string; name: string; accessState: SalesCompanyAccessState; tierKey: PlanTierKey | null; province: string | null;
  createdAt: string; openDealId: string | null; openDealStatus: SalesDealStatus | null;
  /** S31: what the shop runs today, so the deal form can warn before the deal is ever saved. */
  branchCount: number; employeeCount: number;
  /**
   * Catalog list price per month of the shop's current paid tier (STARTER_249 when it has none),
   * for the "สูงกว่าราคา catalog" warning. Multiply by the deal's months to compare.
   */
  catalogMonthlyPriceSatang: number;
};
export type SalesCompanySearchDto = { items: SalesCompanySearchItem[] };
export const SALES_COMPANY_SEARCH_MIN_CHARS = 2;
export const SALES_COMPANY_SEARCH_LIMIT = 20;

/**
 * Q9 — where a deal stands on the bank-transfer fallback. `NONE` is every deal that was never
 * paid by slip, including one paid through Stripe.
 */
export const SALES_DEAL_SLIP_STATES = ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
export type SalesDealSlipState = typeof SALES_DEAL_SLIP_STATES[number];

export type SalesDealView = {
  id: string; status: SalesDealStatus; version: number;
  company: SalesCompanySearchItem;
  salesUserId: string; salesDisplayName: string;
  snapshot: SalesDealSnapshot; internalReason: string;
  /** Catalog price of `base` for the same number of months (monthly price × months), for the "สูงกว่า catalog" warning. */
  catalogPriceSatang: number;
  /** Current usage above the deal's limits (S31): the shop keeps them, cannot add more. */
  overLimit: { branches: number; employees: number };
  approvedByUserId: string | null; approvedByDisplayName: string | null; approvedAt: string | null; selfApproved: boolean;
  /** Stripe's verified payment instant, and when the shop's term was actually opened (Phase 3). */
  paidAt: string | null; appliedAt: string | null;
  offerExpiresAt: string | null; rejectedReason: string | null;
  /** D3: the APPLIED deal this renewal offer was cloned from, so the console can say "ต่ออายุจาก". */
  renewalOfRequestId: string | null;
  /** Q9 bank-transfer fallback. */
  slipState: SalesDealSlipState;
  /** Q7: the renewal mode of the live subscription this deal will cancel when it is paid, if any. */
  conversionOf: 'CARD_AUTO' | 'PROMPTPAY_RENEW' | null;
  /**
   * D-P5-1 read back defensively: a v2 snapshot has no switch, so it reads `false`/`null`/`null`
   * here rather than `undefined`. The console never has to know which version a row was written at.
   */
  autoRenew: boolean; cadence: SalesDealCadence | null; cycles: number | null;
  /** D-P5-3: `null` on a one-time deal. Anything but `READY` means the offer cannot be paid yet. */
  priceState: SalesDealPriceState | null;
  /** D-P5-6: when the shop goes back to the catalog price, once that is decided. */
  returnAt: string | null;
  createdAt: string; updatedAt: string;
};
export type SalesDealListDto = { items: SalesDealView[] };

export const SALES_CODE_PATTERN = /^[A-Z0-9]{3,6}$/;
/** Default random codes avoid 0/O/1/I (D6). */
export const SALES_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SALES_CODE_DEFAULT_LENGTH = 4;
export type SalesAgentStatus = 'ACTIVE' | 'SUSPENDED';
export type SalesAgentView = {
  userId: string; username: string; displayName: string; phoneNumber: string | null; email: string | null;
  role: SalesRoleKey; teamLeadUserId: string | null; teamLeadDisplayName: string | null;
  status: SalesAgentStatus; salesCode: string; lineLinked: boolean; hasProfile: boolean;
  createdAt: string; suspendedAt: string | null;
};
export type SalesAgentListDto = { items: SalesAgentView[] };
/**
 * Decrypted tax/bank data: SYSTEM_ADMIN only, every read audited (S10).
 * Every field is nullable because a lead-created agent has no payroll record yet — the read
 * answers with nulls rather than 404, so the Owner's form opens on an empty record.
 */
export type SalesAgentProfileDto = { legalName: string | null; nationalId: string | null; taxId: string | null; address: string | null; bankName: string | null; bankAccount: string | null; whtRatePercent: number };
export type SalesAgentProfileInput = { legalName: string; nationalId: string; taxId?: string | null; address: string; bankName: string; bankAccount: string; whtRatePercent: number };
export type SalesAgentCreateBody = {
  username: string; displayName: string; phoneNumber?: string; email?: string; role: SalesRoleKey;
  teamLeadUserId?: string | null; /** Omitted = generated. */ salesCode?: string; profile?: SalesAgentProfileInput;
};
export type SalesAgentUpdateBody = {
  displayName?: string; phoneNumber?: string | null; email?: string | null; teamLeadUserId?: string | null; salesCode?: string;
  status?: SalesAgentStatus; profile?: SalesAgentProfileInput; /** Required for status changes. */ reason?: string;
};
export type SalesAgentCredentialHandoff = { userId: string; username: string; temporaryPassword: string; expiresAt: string | null; lineNotified: boolean };
export type SalesAgentCreateResult = { agent: SalesAgentView; credential: SalesAgentCredentialHandoff };

export type SalesMyWorkKind = 'APPROVAL_PENDING' | 'DEAL_REJECTED' | 'DEAL_EXPIRED' | 'DEAL_APPROVED_WAITING' | 'DEAL_APPLIED' | 'DEAL_SUPERSEDED'
  /** D3: the agent's own renewal offer is sitting with the lead. */
  | 'DEAL_RENEWAL_PENDING'
  /** Q9: a customer's transfer slip is waiting for the Owner to confirm it (SYSTEM_ADMIN only). */
  | 'DEAL_SLIP_PENDING'
  /** D-P5-6: this auto-renewing deal goes back to the catalog price within 14 days. */
  | 'DEAL_ENDING';
export type SalesMyWorkItem = { kind: SalesMyWorkKind; deal: SalesDealView; at: string };
/** `badge` = items that need the caller's action (lead: pending approvals; sales: rejected + expired). */
export type SalesMyWorkDto = { items: SalesMyWorkItem[]; badge: number };

/** The customer-facing offer on `GET /v1/companies/:id/package-change-requests` (R10; the card itself is Phase 3). */
export type PackageChangeDealOffer = {
  dealId: string; base: SalesDealBaseTier; baseLabel: string; priceSatang: number; months: number;
  branchLimit: number; employeeLimit: number; monthlySlipLimit: number; featureKeys: string[];
  aiMonthlyBudgetSatang: number | null; description: string; offerExpiresAt: string;
  /** D-P5-1: "ตัดบัตร/ออกบิลทุกเดือน(ปี) ที่ราคานี้" instead of "จ่ายครั้งเดียว". */
  autoRenew?: boolean; cadence?: SalesDealCadence | null; cycles?: number | null;
  /** Q9: `PENDING` replaces the pay buttons with "รอทีมงานตรวจสลิป"; `REJECTED` lets them retry. */
  slipState: SalesDealSlipState;
  /** Why the team turned the slip down — the only slip text a customer ever reads. */
  slipRejectedReason?: string;
};
export type PackageChangeRequestKind = 'CUSTOMER_REQUEST' | 'SALES_DEAL' | 'SPECIAL_INVOICE';

// ── Phase 4: reports, anti-gaming flags, bank-transfer fallback ─────────────────────────────

/** §17.2: a shop is counted once, the first time it is paid for. `DEAL` beats `REFERRAL`. */
export type SalesAttributionSource = 'DEAL' | 'REFERRAL';
/** §17.1 anti-gaming. A row carrying any of these counts ZERO until a SYSTEM_ADMIN reviews it. */
export const SALES_ATTRIBUTION_FLAGS = ['self_referral', 'repeat_owner', 'referral_anomaly'] as const;
export type SalesAttributionFlag = typeof SALES_ATTRIBUTION_FLAGS[number];
/** The referral window (§17.1, Owner round 3): paid within 14 days of the shop opening, or nobody. */
export const SALES_REFERRAL_WINDOW_DAYS = 14;
/** Refund/dispute deducted from the agent's total when it lands inside this window (§17.1). */
export const SALES_ATTRIBUTION_REFUND_WINDOW_DAYS = 60;
/** One sales code attributing more than this many shops in a Bangkok day is an anomaly (§17.1). */
export const SALES_REFERRAL_DAILY_ANOMALY_LIMIT = 20;

/** `GET /v1/sales/reports/summary` — one row per agent per Bangkok month. No financial documents (S21). */
export type SalesReportRow = {
  salesUserId: string; displayName: string; teamLeadUserId: string | null;
  /** Phase 4 leftover: the lead's name, so the report groups without a second lookup client-side. */
  teamLeadDisplayName: string | null;
  /** Shops opened by a deal this agent wrote, and by a signup that named their code. */
  dealActivations: number; referralActivations: number;
  /** Net of refunds; flagged rows contribute 0 until reviewed. */
  amountSatang: number;
  flaggedCount: number;
};
export type SalesReportMonth = { monthKey: string; rows: SalesReportRow[] };
export type SalesReportSummary = { months: SalesReportMonth[]; from: string; to: string };
/** How many months one report request may span — a lead asking for "everything" is a mistake, not a need. */
export const SALES_REPORT_MAX_MONTHS = 24;
export const SALES_REPORT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `GET /v1/system/sales-attribution/flags` — the Owner's review queue (SYSTEM_ADMIN). */
export type SalesAttributionFlagRow = {
  companyId: string; companyName: string;
  salesUserId: string; salesDisplayName: string;
  source: SalesAttributionSource; amountSatang: number; refundedSatang: number; paidAt: string;
  flags: SalesAttributionFlag[]; flaggedAt: string | null;
  reviewedAt: string | null; reviewNote: string | null;
};
export type SalesAttributionFlagListDto = { items: SalesAttributionFlagRow[] };
/** `keep: true` = "ตัดออก" (the flag stands, the row keeps counting 0); false = "ยืนยันว่าไม่ผิดปกติ". */
export type SalesAttributionFlagReviewBody = { keep: boolean; reason: string };

/**
 * Q9 bank-transfer fallback — the account a customer is shown when they choose to transfer.
 *
 * ponytail: a constant, not a BillingPolicy column. There is no policy field for a bank account
 * today and one shop-independent account serves every deal; add the column when a second account
 * exists.
 */
export const SALES_SLIP_BANK_ACCOUNT_TH = {
  bankName: 'ธนาคารกสิกรไทย',
  accountName: 'บจก. มั่งมียั่งยืน',
  accountNumber: '237-2-48525-9',
  note: 'โอนแล้วแนบสลิปในหน้านี้ ทีมงานตรวจและเปิดใช้งานให้ภายในวันทำการ',
} as const;
/** What the customer may attach as a transfer slip. Scanned by the normal attachment pipeline. */
export const SALES_SLIP_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const SALES_SLIP_TARGET_TYPE = 'package_change_request';
export const SALES_SLIP_PURPOSE = 'payment_slip';

export type SalesDealSlipUploadIntentBody = { originalFileName: string; mimeType: string; byteSize: number };
export type SalesDealSlipUploadIntent = {
  attachmentId: string; uploadUrl: string; uploadMethod: string;
  uploadHeaders: Record<string, string>; expiresAt: string;
};
export type SalesDealSlipCompleteBody = { attachmentId: string; checksumSha256?: string };
/** `GET /v1/system/sales-deals/slips` — deals whose customer says they transferred. */
export type SalesDealSlipRow = {
  dealId: string; companyId: string; companyName: string;
  salesUserId: string; salesDisplayName: string;
  amountSatang: number; months: number; baseLabel: string;
  slipAttachmentId: string | null; submittedAt: string | null;
};
export type SalesDealSlipListDto = { items: SalesDealSlipRow[] };
export type SalesDealSlipDecisionBody = { reason: string };

export type SalesReferralSource = 'SIGNUP_CODE' | 'SIGNUP_LINK' | 'ADMIN';
export const SALES_REFERRAL_ADMIN_WINDOW_DAYS = 30;
/** SYSTEM_ADMIN referral repair, within the window and always with a reason (D6 anti-gaming). */
export type SalesReferralUpdateBody = { salesCode: string | null; reason: string };

export const SALES_ERROR_CODES = ['SALES_DEAL_STATE_CONFLICT', 'SALES_DEAL_SELF_APPROVAL', 'SALES_DEAL_EXPIRED', 'SALES_DEAL_ALREADY_OPEN',
  'SALES_COMPANY_NOT_FOUND', 'SALES_COMPANY_HAS_OPEN_REQUEST', 'SALES_CODE_UNKNOWN', 'SALES_CODE_TAKEN', 'SALES_CODE_INVALID',
  'SALES_AGENT_SUSPENDED', 'SALES_AGENT_NOT_FOUND', 'SALES_TEAM_LEAD_INVALID',
  'SALES_AGENT_USERNAME_TAKEN', 'SALES_REFERRAL_WINDOW_CLOSED',
  // Phase 4
  'SALES_SLIP_STATE_CONFLICT', 'SALES_SLIP_REQUIRED', 'SALES_REPORT_RANGE_INVALID', 'SALES_FLAG_REVIEW_INVALID',
  // Phase 5 (D-P5-3 / D-P5-6)
  'SALES_DEAL_PRICE_PENDING', 'SALES_DEAL_END_INVALID'] as const;
export type SalesErrorCode = typeof SALES_ERROR_CODES[number];
