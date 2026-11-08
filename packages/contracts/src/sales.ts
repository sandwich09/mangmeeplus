import { FEATURE_CATALOG } from './feature-entitlements.js';
import { SALES_DEAL_ALLOWED_FEATURE_KEYS } from './menu-entitlements.js';
import type { PlanTierKey } from './plan-term.js';

/**
 * Sales console contracts (spec docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md §5, §9–§12, §17–§19).
 * Platform-tenant roles for มั่งมี's own sales team. Never the tenant role `SALES` (S06).
 */
export const SALES_ROLE_KEYS = ['MANGMEE_SALES_LEAD', 'MANGMEE_SALES'] as const;
export type SalesRoleKey = typeof SALES_ROLE_KEYS[number];
export const SALES_PERMISSION_KEYS = ['sales.console.read', 'sales.company.search', 'sales.deal.create', 'sales.deal.approve',
  'sales.team.manage', 'sales.report.read', 'sales.agent_profile.manage',
  // Sales-event discounts (docs/specs/sales-event-discounts-spec-th.md §9): set up, pause, suspend and
  // edit a batch and revoke its tickets. SYSTEM_ADMIN and MANGMEE_SALES_LEAD only.
  'sales.event.manage'] as const;
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
 * Every paid tier, the free trial excepted (R3). D-P3-1 used to exclude ENTERPRISE_1999 because
 * the one-time Stripe path reads the base tier's catalog Price for its product id and ENTERPRISE
 * had none; Phase 6 (Owner 2026-09-21) opened ENTERPRISE for purchase and gave it its own Product
 * and Prices, so it is a deal base like the rest. A deal on a base whose Price the Owner has not
 * bound yet still fails cleanly at quote with `BILLING_OFFER_UNAVAILABLE`.
 */
export type SalesDealBaseTier = Exclude<PlanTierKey, 'FREE_TRIAL_15'>;
/** Runtime companion of `SalesDealBaseTier` — the paid tiers a deal may be built on (R3). */
export const SALES_DEAL_BASE_TIERS: readonly SalesDealBaseTier[] =
  ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'];

/**
 * What a deal's menu list means (B3). A parent menu named with NONE of its submenus sells every
 * submenu of it a deal may sell; a parent named with some of them sells exactly those.
 *
 * Paying a package writes every catalog key that is not in the list as OFF, so a deal built one
 * menu at a time, which carried `expenses` alone, switched every expense submenu off. One rule for
 * the deal builder, the save and the hand-off to billing, so all three agree on any deal, old or new.
 * Order is kept and nothing is added to a list the rule does not change.
 */
export function salesDealFeatureKeys(
  featureKeys: readonly string[],
  sellable: readonly string[] = SALES_DEAL_ALLOWED_FEATURE_KEYS,
): string[] {
  const keys = new Set(featureKeys);
  for (const feature of FEATURE_CATALOG) {
    if (!keys.has(feature.key) || feature.submenus.some((submenu) => keys.has(submenu.key))) continue;
    for (const submenu of feature.submenus) if (sellable.includes(submenu.key)) keys.add(submenu.key);
  }
  return [...keys];
}

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
  /** 2 = one-time; 3 = auto-renew; 4 = the AI amount means CHAT credit, not total budget. */
  version: 2 | 3 | 4;
  base: SalesDealBaseTier;
  /** What the customer pays for the whole deal, in satang (Q2: VAT-inclusive if any). ≥ 1, no floor/ceiling (D1). */
  priceSatang: number;
  /** 1–36 whole months from the paid-at instant (Phase 3 applies them via the one-time path, spec §19).
   *  IGNORED when `autoRenew` — then `priceSatang` is the price of ONE cycle (D-P5-1/D-P5-2). */
  months: number;
  branchLimit: number; employeeLimit: number; monthlySlipLimit: number;
  featureKeys: string[];
  /**
   * In v2/v3 this is a TOTAL budget override. In v4 it is CHAT credit; null = 50 credit.
   * D-P3-2: zero is refused — closing AI is done by dropping
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
 * Decrypted tax/bank data: admin, self or own-team lead only; every read audited (S10).
 * Every field is nullable because older accounts or API callers may omit a payroll record — the
 * read answers with nulls rather than 404, so the profile form opens on an empty record.
 */
export type SalesAgentProfileDto = { legalName: string | null; nationalId: string | null; taxId: string | null; address: string | null; bankName: string | null; bankAccount: string | null; whtRatePercent: number };
export type SalesAgentProfileInput = { legalName: string; nationalId: string; taxId?: string | null; address: string; bankName: string; bankAccount: string; whtRatePercent: number };
export type SalesAgentSelfProfileInput = Omit<SalesAgentProfileInput, 'whtRatePercent'>;
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
  /** D-P5-6: this auto-renewing deal goes back to the catalog price within 14 days. */
  | 'DEAL_ENDING';
export type SalesMyWorkItem = { kind: SalesMyWorkKind; deal: SalesDealView; at: string };
/** `badge` = items that need the caller's action (lead: pending approvals; sales: rejected + expired). */
export type SalesMyWorkDto = { items: SalesMyWorkItem[]; badge: number };

/** The customer-facing offer on `GET /v1/companies/:id/package-change-requests` (R10; the card itself is Phase 3). */
export type PackageChangeDealOffer = {
  dealId: string; base: SalesDealBaseTier; baseLabel: string; priceSatang: number; months: number;
  branchLimit: number; employeeLimit: number; monthlySlipLimit: number; featureKeys: string[];
  aiMonthlyBudgetSatang: number | null; creditScope?: 'CHAT' | 'TOTAL'; description: string; offerExpiresAt: string;
  /** D-P5-1: "ตัดบัตร/ออกบิลทุกเดือน(ปี) ที่ราคานี้" instead of "จ่ายครั้งเดียว". */
  autoRenew?: boolean; cadence?: SalesDealCadence | null; cycles?: number | null;
};
export type PackageChangeRequestKind = 'CUSTOMER_REQUEST' | 'SALES_DEAL' | 'SPECIAL_INVOICE';

// ── Phase 4: reports and anti-gaming flags ──────────────────────────────────────────────────

/** §17.2: a shop is counted once, the first time it is paid for. `DEAL` beats `REFERRAL`. */
export type SalesAttributionSource = 'DEAL' | 'REFERRAL';
/** §17.1 anti-gaming. A row carrying any of these counts ZERO until the Owner clears them (`salesCreditState`). */
export const SALES_ATTRIBUTION_FLAGS = ['self_referral', 'repeat_owner', 'referral_anomaly'] as const;
export type SalesAttributionFlag = typeof SALES_ATTRIBUTION_FLAGS[number];
/**
 * Where the credit of a row stands (§17.1). A row that carries a flag counts ZERO: while nobody
 * has reviewed it (WAITING), and for good once the Owner kept the flag with "ตัดออกจากยอด"
 * (EXCLUDED). "ยืนยันว่าไม่ผิดปกติ" clears the flags, and only a row without flags counts
 * (COUNTED). One rule for the report and for the Owner's review queue, so they cannot disagree.
 */
export type SalesCreditState = 'COUNTED' | 'WAITING' | 'EXCLUDED';
export function salesCreditState(flags: readonly string[], reviewedAt: Date | string | null | undefined): SalesCreditState {
  if (flags.length === 0) return 'COUNTED';
  return reviewedAt ? 'EXCLUDED' : 'WAITING';
}
/**
 * Owner 2026-10-02: a shop is an opened shop ("ร้านที่เปิดได้") and carries an amount only while its
 * credit is COUNTED. A WAITING shop is neither, in any figure, and is reported on its own as
 * waiting for review; once the Owner confirms it, it counts in the month of its payment. An
 * EXCLUDED shop is in no figure at all. The one place that decides it: the report and the daily
 * digest both ask here.
 */
export function salesCountsAsActivation(state: SalesCreditState): boolean {
  return state === 'COUNTED';
}
/** The referral window (§17.1, Owner round 3): paid within 14 days of the shop opening, or nobody. */
export const SALES_REFERRAL_WINDOW_DAYS = 14;
/**
 * A refund or a lost payment dispute takes the credit back when it happens within this many days
 * of the payment, counted to the provider's own time of it, never to the time this system noticed
 * (§17.1, owner 2026-10-02).
 */
export const SALES_ATTRIBUTION_REFUND_WINDOW_DAYS = 60;
/** What takes sales credit back: a refund that succeeded, or a payment dispute that was lost. */
export type SalesDeductionKind = 'REFUND' | 'DISPUTE';
/** One sales code attributing more than this many shops in a Bangkok day is an anomaly (§17.1). */
export const SALES_REFERRAL_DAILY_ANOMALY_LIMIT = 20;

/** `GET /v1/sales/reports/summary` — one row per agent per Bangkok month. No financial documents (S21). */
export type SalesReportRow = {
  salesUserId: string; displayName: string; teamLeadUserId: string | null;
  /** Phase 4 leftover: the lead's name, so the report groups without a second lookup client-side. */
  teamLeadDisplayName: string | null;
  /** Shops opened by a deal this agent wrote, and by a signup that named their code. A shop waiting for review is in neither. */
  dealActivations: number; referralActivations: number;
  /** This month's credit less this month's `deductions`, so it may be negative; flagged rows contribute 0 until reviewed. */
  amountSatang: number;
  /** Shops waiting for the Owner's review: no opened shop and no amount yet, each named in the month's `waiting`. */
  flaggedCount: number;
};
/**
 * One shop waiting for the Owner's review, shown as its own line in the Bangkok month of its
 * payment, which is the month it counts in once confirmed (owner 2026-10-02). The shop's name and
 * why it waits, no document (S21).
 */
export type SalesReportWaiting = {
  salesUserId: string; source: SalesAttributionSource; companyName: string; flags: SalesAttributionFlag[];
};
/**
 * One deduction, shown as its own line in the Bangkok month it was recorded in — the month of the
 * payment keeps its figure (§17.1, owner 2026-10-02). A shop name and a month, no document (S21).
 */
export type SalesReportDeduction = {
  salesUserId: string; kind: SalesDeductionKind; companyName: string;
  /** Bangkok month of the payment whose credit this takes back. */
  paidMonthKey: string;
  /** Positive satang; the agent's row for this month already has it taken off. */
  amountSatang: number;
  /** The provider's time: the refund, or the dispute being opened. */
  occurredAt: string;
};
/** `deductions` and `waiting` are absent only on an answer that predates the field. */
export type SalesReportMonth = {
  monthKey: string; rows: SalesReportRow[]; deductions?: SalesReportDeduction[]; waiting?: SalesReportWaiting[];
};
export type SalesReportSummary = { months: SalesReportMonth[]; from: string; to: string };
/**
 * `GET /v1/sales/events/report` (sales-event spec §10): event → batch → เซลล์, over tickets ISSUED in
 * the month range. Kept apart from `SalesReportSummary` on purpose — a ticket is never sales credit
 * (SD-Q3); sales credit still follows the deal / referral attribution. No LINE identity, no document.
 * ponytail: discount path only; SD-F adds the credit units granted.
 */
export type SalesEventReportFigures = SalesEventTicketCounts & {
  /** Σ `discountSatang` of tickets still usable: the most the open tickets could still cost. */
  openDiscountSatang: number;
  /** Σ `appliedDiscountSatang` of tickets USED as a first-bill discount. RESERVED is not counted. */
  appliedDiscountSatang: number;
  /** Σ `paidSatang` / `refundedSatang` of the bills those tickets were used on, one bill once. */
  paidSatang: number; refundedSatang: number;
};
export type SalesEventReportAgent = { salesUserId: string; displayName: string; figures: SalesEventReportFigures };
export type SalesEventReportBatch = { batchId: string; batchName: string; figures: SalesEventReportFigures; agents: SalesEventReportAgent[] };
export type SalesEventReportEvent = { eventName: string; figures: SalesEventReportFigures; batches: SalesEventReportBatch[] };
export type SalesEventReport = {
  from: string; to: string; events: SalesEventReportEvent[]; totals: SalesEventReportFigures;
  /** More tickets than one request reads: narrow the months. */
  truncated: boolean;
};

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

export type SalesReferralSource = 'SIGNUP_CODE' | 'SIGNUP_LINK' | 'ADMIN';
export const SALES_REFERRAL_ADMIN_WINDOW_DAYS = 30;
/** SYSTEM_ADMIN referral repair, within the window and always with a reason (D6 anti-gaming). */
export type SalesReferralUpdateBody = { salesCode: string | null; reason: string };

export const SALES_ERROR_CODES = ['SALES_DEAL_STATE_CONFLICT', 'SALES_DEAL_SELF_APPROVAL', 'SALES_DEAL_EXPIRED', 'SALES_DEAL_ALREADY_OPEN',
  'SALES_COMPANY_NOT_FOUND', 'SALES_COMPANY_HAS_OPEN_REQUEST', 'SALES_CODE_UNKNOWN', 'SALES_CODE_TAKEN', 'SALES_CODE_INVALID',
  'SALES_AGENT_SUSPENDED', 'SALES_AGENT_NOT_FOUND', 'SALES_TEAM_LEAD_INVALID',
  'SALES_AGENT_USERNAME_TAKEN', 'SALES_REFERRAL_WINDOW_CLOSED',
  // Phase 4
  'SALES_REPORT_RANGE_INVALID', 'SALES_FLAG_REVIEW_INVALID',
  // Phase 5 (D-P5-3 / D-P5-6)
  'SALES_DEAL_PRICE_PENDING', 'SALES_DEAL_END_INVALID',
  // Sales-event discounts, console (spec §7.3). SD-B/SD-C/SD-F add the claim and redemption codes.
  'SALES_EVENT_BATCH_INVALID', 'SALES_EVENT_REWARD_REQUIRED', 'SALES_EVENT_DISCOUNT_TOO_HIGH', 'SALES_EVENT_BATCH_STALE',
  'SALES_EVENT_NOT_FOUND', 'SALES_EVENT_CLAIM_CLOSED', 'SALES_EVENT_ISSUE_FULL', 'SALES_EVENT_AGENT_INACTIVE',
  'SALES_EVENT_TICKET_NOT_REVOCABLE',
  // Sales-event discounts, LINE claim (spec §7.3, SD-B). The LIFF page carries its own copy too.
  // SALES_EVENT_QR_INVALID: no QR with this token exists. A QR never expires on its own (SD-O11).
  'SALES_EVENT_QR_INVALID', 'SALES_EVENT_SELF_CLAIM'] as const;
export type SalesErrorCode = typeof SALES_ERROR_CODES[number];

// ── Sales-event discounts (docs/specs/sales-event-discounts-spec-th.md §6, §7.1, §9) ──────────────
// A batch ("ชุดส่วนลด") issues one ticket ("ส่วนลดจากงาน") per LINE identity that scans its QR. The UI
// never says "ตั๋ว". No switch: a discount exists only when a lead or admin creates a batch (SD-O10).

/** Spec §6.2. "ปิดรับแล้ว" is the claim window, never a state. */
export const SALES_EVENT_BATCH_STATES = ['OPEN', 'PAUSED', 'SUSPENDED'] as const;
export type SalesEventBatchState = typeof SALES_EVENT_BATCH_STATES[number];
/** Spec §6.3. Expired is read from time: ISSUED and `expiresAt <= now`. */
export const SALES_EVENT_TICKET_STATES = ['ISSUED', 'RESERVED', 'USED', 'REVOKED'] as const;
export type SalesEventTicketState = typeof SALES_EVENT_TICKET_STATES[number];
/** How a ticket was used, once: the first-bill discount of a new shop, or credit into a paying shop. */
export const SALES_EVENT_REDEEM_PATHS = ['DISCOUNT', 'CREDIT'] as const;
export type SalesEventRedeemPath = typeof SALES_EVENT_REDEEM_PATHS[number];
/** PAUSE: OPEN→PAUSED, RESUME: PAUSED→OPEN, SUSPEND: OPEN|PAUSED→SUSPENDED, LIFT: SUSPENDED→PAUSED. */
export const SALES_EVENT_BATCH_ACTIONS = ['PAUSE', 'RESUME', 'SUSPEND', 'LIFT'] as const;
export type SalesEventBatchAction = typeof SALES_EVENT_BATCH_ACTIONS[number];
/** SUSPEND stops tickets already handed out, and LIFT restores them: both are audited with a reason. */
export const SALES_EVENT_REASON_ACTIONS: readonly SalesEventBatchAction[] = ['SUSPEND', 'LIFT'];
/** What the console and the customer read about one ticket; `EXPIRED` is derived from time. */
export type SalesEventTicketDisplayState = 'AVAILABLE' | 'IN_PAYMENT' | 'USED' | 'EXPIRED' | 'REVOKED';

/** `POST /v1/public/event-discounts/claim` (spec §3.3, §7.2). The LIFF ID token is the only identity input. */
export type SalesEventClaimBody = { idToken: string; qrToken: string; requestKey: string };
/** What the scan page shows: only what the batch gives, never the LINE identity. `replay`: this LINE
 *  account already held a ticket from the batch, and this is that ticket. `next` picks the page's one
 *  button: an account linked to this LINE opens มั่งมี, anyone else opens a new shop. */
export type SalesEventClaimResult = {
  ticket: { serial: string; eventName: string; discountSatang: number; chatCreditUnits: number;
    receiptImageUnits: number; expiresAt: string };
  replay: boolean;
  next: 'OPEN_PACKAGE' | 'SIGN_UP';
};

export const SALES_EVENT_NAME_MAX = 120;
export const SALES_EVENT_REASON_MAX = 500;
/** A ticket can be used until the batch's claim end (at the revision it was issued) plus this (SD-Q1). */
export const SALES_EVENT_TICKET_VALID_DAYS = 30;
/** AI credit is stored in 0.01-credit units, the add-on `unitScale` of CHAT_CREDIT. */
export const SALES_EVENT_CHAT_CREDIT_UNIT_SCALE = 100;
/** Page size of every list in the console (batches, tickets, the เซลล์ search). */
export const SALES_EVENT_PAGE_SIZE = 50;

/** Which package cards the first-bill discount applies to (spec §4.5). Credit has no scope. */
export type SalesEventScope = { tiers: SalesDealBaseTier[]; intervals: SalesDealCadence[] };

/** `POST /v1/sales/events/batches`. Amounts are satang / 0.01-credit units; times are ISO instants. */
export type SalesEventBatchInput = {
  eventName: string; batchName: string;
  /** Whole baht (a multiple of 100), ≥ 0. */
  discountSatang: number;
  /** Whole AI credits (a multiple of 100), ≥ 0. */
  rewardChatCreditUnits: number;
  rewardReceiptImageUnits: number;
  issueCap: number;
  /** [claimStartsAt, claimEndsAt), entered as Thai time and sent as UTC instants. */
  claimStartsAt: string; claimEndsAt: string;
  scope: SalesEventScope;
  /** The เซลล์ who may show the QR: a lead picks from their own team, SYSTEM_ADMIN from everyone. */
  agentUserIds: string[];
};
/** `PATCH /v1/sales/events/batches/:batchId` — a new revision, fenced by the version the form read. */
export type SalesEventBatchUpdate = SalesEventBatchInput & { expectedVersion: number };
/** `POST /v1/sales/events/batches/:batchId/state`. `reason` is required for SUSPEND and LIFT. */
export type SalesEventBatchStateBody = { action: SalesEventBatchAction; expectedVersion: number; reason?: string };
/** `POST /v1/sales/events/tickets/:ticketId/revoke` — ISSUED tickets only. */
export type SalesEventTicketRevokeBody = { reason: string; expectedVersion: number };

export type SalesEventAgentOption = { userId: string; displayName: string; salesCode: string };
export type SalesEventAgentSearch = { items: SalesEventAgentOption[]; nextCursor: string | null };

/** Counted over the tickets the caller may see: a เซลล์ counts only what they handed out. */
export type SalesEventTicketCounts = {
  issued: number; available: number; inPayment: number; usedAsDiscount: number; usedAsCredit: number;
  expired: number; revoked: number;
};

export type SalesEventBatchView = {
  id: string; eventName: string; batchName: string;
  discountSatang: number; rewardChatCreditUnits: number; rewardReceiptImageUnits: number;
  issueCap: number; issuedCount: number;
  claimStartsAt: string; claimEndsAt: string;
  scope: SalesEventScope;
  state: SalesEventBatchState;
  /** OPEN and inside the claim window right now — the only time a QR can be shown. */
  claimOpen: boolean;
  revision: number; version: number;
  createdByUserId: string; createdByDisplayName: string;
  agents: { userId: string; displayName: string; active: boolean }[];
  /** The caller is an active distributor of this batch. */
  isDistributor: boolean;
  /** The caller may edit it, change its state and revoke its tickets. */
  canManage: boolean;
  counts: SalesEventTicketCounts;
  createdAt: string; updatedAt: string;
};
export type SalesEventBatchList = { items: SalesEventBatchView[]; nextCursor: string | null };

/**
 * `POST /v1/sales/events/batches/:batchId/qr`. The image is rendered by the API; no URL leaves it.
 * Owner 2026-09-29 (SD-O11): a QR has no clock of its own, so it can be printed or put on a screen.
 * It works while its batch is OPEN inside the claim window and its เซลล์ is still an active
 * distributor — `expiresAt` is the claim end when it was issued; extending the batch extends it.
 */
export type SalesEventQr = { qrImageUrl: string; expiresAt: string };

/** No LINE identity and no financial document, ever (spec §7.1). */
export type SalesEventTicketView = {
  id: string; serial: string; state: SalesEventTicketDisplayState; redeemedAs: SalesEventRedeemPath | null;
  salesUserId: string; salesDisplayName: string;
  discountSatang: number; rewardChatCreditUnits: number; rewardReceiptImageUnits: number;
  expiresAt: string; issuedAt: string; usedAt: string | null; revokedAt: string | null; revokeReason: string | null;
  version: number;
};
export type SalesEventTicketList = { items: SalesEventTicketView[]; nextCursor: string | null };
