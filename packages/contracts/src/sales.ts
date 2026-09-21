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
export type SalesDealBaseTier = Exclude<PlanTierKey, 'FREE_TRIAL_15'>;
/** Runtime companion of `SalesDealBaseTier` — the paid tiers a deal may be built on (R3). */
export const SALES_DEAL_BASE_TIERS: readonly SalesDealBaseTier[] =
  ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'];

/** Frozen into PackageChangeRequest.offerSnapshotJson when the deal is submitted; immutable once APPROVED (R3/R4). */
export type SalesDealSnapshot = {
  version: 2;
  base: SalesDealBaseTier;
  /** What the customer pays for the whole deal, in satang (Q2: VAT-inclusive if any). ≥ 1, no floor/ceiling (D1). */
  priceSatang: number;
  /** 1–36 whole months from the paid-at instant (Phase 3 applies them via the one-time path, spec §19). */
  months: number;
  branchLimit: number; employeeLimit: number; monthlySlipLimit: number;
  featureKeys: string[];
  /** null = the tier default / platform budget; 0 closes AI for the shop. */
  aiMonthlyBudgetSatang: number | null;
  /** Customer-facing note, ≤ 200 chars, no PII, no "+" (S24). */
  description: string;
};
export type SalesDealInput = Omit<SalesDealSnapshot, 'version'> & { companyId: string; /** Team-visible only, ≤ 500 (S24). */ internalReason: string };
export type SalesDealSaveBody = SalesDealInput & { /** Required when updating a DRAFT/REJECTED deal. */ version?: number };
/** reject / cancel: the reason is what the agent reads back, so it is required (R5). */
export type SalesDealDecisionBody = { version: number; reason: string };
/** approve: the audit row already records who approved and whether it was their own deal. */
export type SalesDealApproveBody = { version: number; reason?: string };
export type SalesDealSubmitBody = { version: number };

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
  offerExpiresAt: string | null; rejectedReason: string | null;
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

export type SalesMyWorkKind = 'APPROVAL_PENDING' | 'DEAL_REJECTED' | 'DEAL_EXPIRED' | 'DEAL_APPROVED_WAITING' | 'DEAL_APPLIED';
export type SalesMyWorkItem = { kind: SalesMyWorkKind; deal: SalesDealView; at: string };
/** `badge` = items that need the caller's action (lead: pending approvals; sales: rejected + expired). */
export type SalesMyWorkDto = { items: SalesMyWorkItem[]; badge: number };

/** The customer-facing offer on `GET /v1/companies/:id/package-change-requests` (R10; the card itself is Phase 3). */
export type PackageChangeDealOffer = {
  dealId: string; base: SalesDealBaseTier; baseLabel: string; priceSatang: number; months: number;
  branchLimit: number; employeeLimit: number; monthlySlipLimit: number; featureKeys: string[];
  aiMonthlyBudgetSatang: number | null; description: string; offerExpiresAt: string;
};
export type PackageChangeRequestKind = 'CUSTOMER_REQUEST' | 'SALES_DEAL' | 'SPECIAL_INVOICE';

export type SalesReferralSource = 'SIGNUP_CODE' | 'SIGNUP_LINK' | 'ADMIN';
export const SALES_REFERRAL_ADMIN_WINDOW_DAYS = 30;
/** SYSTEM_ADMIN referral repair, within the window and always with a reason (D6 anti-gaming). */
export type SalesReferralUpdateBody = { salesCode: string | null; reason: string };

export const SALES_ERROR_CODES = ['SALES_DEAL_STATE_CONFLICT', 'SALES_DEAL_SELF_APPROVAL', 'SALES_DEAL_EXPIRED', 'SALES_DEAL_ALREADY_OPEN',
  'SALES_COMPANY_NOT_FOUND', 'SALES_COMPANY_HAS_OPEN_REQUEST', 'SALES_CODE_UNKNOWN', 'SALES_CODE_TAKEN', 'SALES_CODE_INVALID',
  'SALES_AGENT_SUSPENDED', 'SALES_AGENT_NOT_FOUND', 'SALES_TEAM_LEAD_INVALID',
  'SALES_AGENT_USERNAME_TAKEN', 'SALES_REFERRAL_WINDOW_CLOSED'] as const;
export type SalesErrorCode = typeof SALES_ERROR_CODES[number];
