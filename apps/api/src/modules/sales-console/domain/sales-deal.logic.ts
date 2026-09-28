/**
 * Pure rules of the sales console: the deal state machine, offer-snapshot validation, the sales
 * code alphabet, and expiry derivation. No Prisma, no Nest — everything here is decided from its
 * arguments so the spec next door can exercise it without a database.
 *
 * Spec: docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md R3–R5, S24, S31, Q2.
 */
import { randomInt } from 'node:crypto';
import {
  SALES_CODE_ALPHABET,
  SALES_CODE_DEFAULT_LENGTH,
  SALES_CODE_PATTERN,
  SALES_DEAL_DESCRIPTION_MAX,
  SALES_DEAL_CYCLES_MAX,
  SALES_DEAL_MONTHS_MAX,
  SALES_DEAL_OFFER_DAYS,
  SALES_DEAL_BASE_TIERS,
  SALES_DEAL_REASON_MAX,
  SALES_DEAL_ALLOWED_FEATURE_KEYS,
  type SalesDealBaseTier,
  type SalesDealCadence,
  type SalesDealSnapshot,
  type SalesDealStatus,
} from '@watchdog-bms/contracts';

export const DEAL_KIND = 'SALES_DEAL';
export const CUSTOMER_REQUEST_KIND = 'CUSTOMER_REQUEST';

/** Editable statuses (R4): APPROVED is immutable — cancel and re-issue instead. */
export const EDITABLE_DEAL_STATUSES: readonly SalesDealStatus[] = ['DRAFT', 'REJECTED'];
/** Statuses past which nothing may transition. */
export const FINAL_DEAL_STATUSES: readonly SalesDealStatus[] = ['APPLIED', 'EXPIRED', 'CANCELLED'];

/**
 * The only transitions that exist. PAID/APPLIED are written by Phase 3's payment path, not by any
 * endpoint in this module — they are listed so the table is the whole truth rather than half of it.
 */
const TRANSITIONS: Readonly<Record<SalesDealStatus, readonly SalesDealStatus[]>> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  // The one-time payment path applies in a single commit, so APPROVED -> APPLIED is real; PAID
  // stays the name for a payment observed without its apply. EXPIRED -> APPLIED exists only for
  // the race in which the sweep closes a deal whose Checkout had already been paid (S46).
  APPROVED: ['PAID', 'APPLIED', 'EXPIRED', 'CANCELLED'],
  PAID: ['APPLIED'],
  // A rejected deal becomes editable again, and saving it moves it back to DRAFT (R4).
  REJECTED: ['DRAFT', 'CANCELLED'],
  APPLIED: [],
  EXPIRED: ['APPLIED'],
  CANCELLED: [],
};

export function canTransitionDeal(from: SalesDealStatus, to: SalesDealStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function offerExpiryFrom(approvedAt: Date): Date {
  return new Date(approvedAt.getTime() + SALES_DEAL_OFFER_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * S17: an APPROVED deal whose window has closed reads EXPIRED the moment it is read, without
 * waiting for the nightly sweep — otherwise the offer card would linger for up to a day after it
 * stopped being honourable. The sweep writes the same conclusion to the row.
 */
export function derivedDealStatus(
  row: { status: string; offerExpiresAt: Date | null },
  now: Date,
): SalesDealStatus {
  const status = row.status as SalesDealStatus;
  if (status === 'APPROVED' && row.offerExpiresAt && row.offerExpiresAt.getTime() < now.getTime()) {
    return 'EXPIRED';
  }
  return status;
}

export function isOfferLive(row: { status: string; offerExpiresAt: Date | null }, now: Date): boolean {
  return derivedDealStatus(row, now) === 'APPROVED';
}

/** A random code that cannot be misread aloud: no 0/O and no 1/I (D6). */
export function generateSalesCode(length: number = SALES_CODE_DEFAULT_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += SALES_CODE_ALPHABET[randomInt(SALES_CODE_ALPHABET.length)];
  return code;
}

/** Codes are stored and compared upper-case; a customer typing "ton" must reach TON. */
export function normalizeSalesCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return SALES_CODE_PATTERN.test(code) ? code : null;
}

export type SnapshotDraft = {
  base: unknown; priceSatang: unknown; months: unknown; branchLimit: unknown; employeeLimit: unknown;
  monthlySlipLimit: unknown; featureKeys: unknown; aiMonthlyBudgetSatang: unknown; description: unknown;
  /** D-P5-1. Absent on every v2 row and on a one-time form submit. */
  autoRenew?: unknown; cadence?: unknown; cycles?: unknown;
};

/**
 * D-P5-1 read back: the ONE place that decides whether a stored snapshot is an auto-renewing deal.
 *
 * A v2 row has no switch at all, so it answers `false`, and a row whose cadence is anything but
 * month/year is treated the same way — an unreadable switch must never open a recurring charge.
 */
export function autoRenewOf(snapshot: Pick<SalesDealSnapshot, 'autoRenew' | 'cadence' | 'cycles'> | null | undefined):
  { autoRenew: boolean; cadence: SalesDealCadence | null; cycles: number | null } {
  const cadence = snapshot?.cadence;
  if (snapshot?.autoRenew !== true || (cadence !== 'month' && cadence !== 'year')) {
    return { autoRenew: false, cadence: null, cycles: null };
  }
  const cycles = snapshot.cycles;
  return { autoRenew: true, cadence,
    cycles: typeof cycles === 'number' && Number.isSafeInteger(cycles) && cycles >= 1 && cycles <= SALES_DEAL_CYCLES_MAX ? cycles : null };
}

/** Thrown with a `SalesErrorCode`-shaped reason the controller maps to a 400 body. */
export class SalesSnapshotError extends Error {}

function positiveInt(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new SalesSnapshotError(field);
  }
  return value;
}

/**
 * Validates and freezes what the sales agent typed (R3).
 *
 * Price has no ceiling and no floor beyond one satang (D1) — a deal above catalog is a warning the
 * form shows, never a refusal here. Q2: the number IS what the customer pays; no VAT is split out
 * while มั่งมี is not VAT-registered.
 */
export function buildDealSnapshot(draft: SnapshotDraft, snapshotVersion: 2 | 3 | 4 = 4,
  allowedFeatureKeys: readonly string[] = SALES_DEAL_ALLOWED_FEATURE_KEYS): SalesDealSnapshot {
  const base = draft.base;
  // D-P3-1: only the three tiers that have a Stripe catalog Price behind them. A deal's own
  // limits express any size, so dropping ENTERPRISE costs the sales team nothing.
  if (typeof base !== 'string' || !SALES_DEAL_BASE_TIERS.includes(base as SalesDealBaseTier)) {
    throw new SalesSnapshotError('base');
  }
  const description = typeof draft.description === 'string' ? draft.description.trim() : '';
  if (!description || description.length > SALES_DEAL_DESCRIPTION_MAX) throw new SalesSnapshotError('description');
  // S24: the customer-facing note is written as prose. "+" reads as a broken bullet in LINE and in
  // the offer card, and the Owner copy rule is to write "และ".
  if (description.includes('+')) throw new SalesSnapshotError('description_plus');
  if (!Array.isArray(draft.featureKeys) || draft.featureKeys.some((key) =>
    typeof key !== 'string' || !allowedFeatureKeys.includes(key))) {
    throw new SalesSnapshotError('featureKeys');
  }
  const aiBudget = draft.aiMonthlyBudgetSatang;
  // D-P3-2: blank (inherit) or at least one satang. Zero is refused because the only writer in the
  // platform refuses it: turning AI off is dropping the `ai_line_assistant` menu, not a nil budget.
  if (aiBudget !== null && (typeof aiBudget !== 'number' || !Number.isSafeInteger(aiBudget) || aiBudget < 1)) {
    throw new SalesSnapshotError('aiMonthlyBudgetSatang');
  }
  // D-P5-1: the switch is validated strictly (an unreadable cadence is an error at write time,
  // unlike the read-back in `autoRenewOf`, which must stay total for rows already in the table).
  const autoRenew = draft.autoRenew === undefined || draft.autoRenew === null ? false : draft.autoRenew;
  if (typeof autoRenew !== 'boolean') throw new SalesSnapshotError('autoRenew');
  const cadence = draft.cadence ?? null, cycles = draft.cycles ?? null;
  if (autoRenew) {
    // Stripe recurring prices are month or year; nothing else can be charged automatically (D-P5-2).
    if (cadence !== 'month' && cadence !== 'year') throw new SalesSnapshotError('cadence');
    if (cycles !== null) positiveInt(cycles, 'cycles', SALES_DEAL_CYCLES_MAX);
  } else if (cadence !== null || cycles !== null) {
    // A one-time deal that carries a cadence is a half-filled form, not a deal.
    throw new SalesSnapshotError('cadence');
  }
  return {
    version: snapshotVersion,
    base: base as SalesDealBaseTier,
    priceSatang: positiveInt(draft.priceSatang, 'priceSatang', Number.MAX_SAFE_INTEGER),
    months: positiveInt(draft.months, 'months', SALES_DEAL_MONTHS_MAX),
    branchLimit: positiveInt(draft.branchLimit, 'branchLimit', 10_000),
    employeeLimit: positiveInt(draft.employeeLimit, 'employeeLimit', 10_000),
    monthlySlipLimit: positiveInt(draft.monthlySlipLimit, 'monthlySlipLimit', 1_000_000),
    featureKeys: [...new Set(draft.featureKeys as string[])],
    aiMonthlyBudgetSatang: aiBudget as number | null,
    description,
    autoRenew,
    cadence: autoRenew ? cadence as SalesDealCadence : null,
    cycles: autoRenew ? cycles as number | null : null,
  };
}


/** Team-visible reason (S24). Bounded like every other paragraph that crosses a boundary. */
export function requireReason(raw: unknown, max = SALES_DEAL_REASON_MAX): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason || reason.length > max) throw new SalesSnapshotError('reason');
  return reason;
}

/**
 * S19/R14 — the approval notice the shop's OWNERs get on LINE.
 *
 * It carries NO numbers: not the price, not the tier, not the months, not the days left. Prices
 * never travel over LINE, and a digit here is the one way that rule breaks silently. The shop
 * reads the actual offer on its own package page, behind its own login.
 */
export const SALES_OFFER_NOTICE_TH = 'มีข้อเสนอพิเศษสำหรับร้านคุณ เปิดหน้าแพ็กเกจเพื่อดูรายละเอียดค่ะ';

/**
 * The package-page link for ONE shop, or undefined when no safe one can be built.
 *
 * Same containment rule as `safeTenantLink` in line-business-card.logic.ts: the result must stay
 * inside `/companies/<id>/` on the configured web origin, so a misconfigured base URL sends the
 * owner nowhere rather than somewhere else.
 */
export function tenantBillingLink(webBaseUrl: string | undefined, companyId: string): string | undefined {
  if (!webBaseUrl) return undefined;
  try {
    const base = new URL(webBaseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return undefined;
    const link = new URL(`/companies/${encodeURIComponent(companyId)}/billing`, `${base.origin}/`);
    // The in-app-browser escape is added by the push exit (system-line-push.ts, R-B1), not here.
    return link.origin === base.origin ? link.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The owner sees a card with one package-page action; an unavailable link leaves a useful notice. */
export function salesOfferNoticeMessage(webBaseUrl: string | undefined, companyId: string):
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: Record<string, unknown> } {
  const link = tenantBillingLink(webBaseUrl, companyId);
  if (!link) return { type: 'text', text: SALES_OFFER_NOTICE_TH };
  return {
    type: 'flex', altText: SALES_OFFER_NOTICE_TH,
    contents: {
      type: 'bubble', size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#15803D', paddingAll: '16px',
        contents: [{ type: 'text', text: 'ข้อเสนอพิเศษสำหรับร้านคุณ', color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true }] },
      body: { type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [{ type: 'text', text: 'เปิดหน้าแพ็กเกจเพื่อดูรายละเอียดค่ะ', color: '#1A2E22', size: 'md', wrap: true }] },
      footer: { type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{ type: 'button', style: 'primary', color: '#15803D',
          action: { type: 'uri', label: 'เปิดหน้าแพ็กเกจ', uri: link } }] },
    },
  };
}

/** S31: what the shop already runs that the deal's limits would not allow it to add to. */
export function overLimitCounts(
  snapshot: Pick<SalesDealSnapshot, 'branchLimit' | 'employeeLimit'>,
  usage: { branchCount: number; employeeCount: number },
): { branches: number; employees: number } {
  return {
    branches: Math.max(0, usage.branchCount - snapshot.branchLimit),
    employees: Math.max(0, usage.employeeCount - snapshot.employeeLimit),
  };
}
