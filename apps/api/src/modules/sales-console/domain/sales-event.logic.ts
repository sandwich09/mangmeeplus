/**
 * Pure rules of sales-event discount batches: the batch form, the claim window, the batch state
 * machine and the first-bill minimum price. No Prisma, no Nest. A QR has no clock of its own
 * (SD-O11): it works while `batchClaimOpen` holds and its เซลล์ is an active distributor.
 *
 * Spec: docs/specs/sales-event-discounts-spec-th.md §3.1, §3.2, §4.5, §5.1, §6.2, §6.3.
 * The QR token itself (hash, link, pattern) and the ticket serial/expiry belong to the claim side:
 * `sales-event-claim.logic.ts`.
 */
import {
  SALES_DEAL_BASE_TIERS,
  SALES_EVENT_CHAT_CREDIT_UNIT_SCALE,
  SALES_EVENT_NAME_MAX,
  SALES_EVENT_REASON_ACTIONS,
  SALES_EVENT_REASON_MAX,
  type BillingTaxTreatment,
  type SalesDealBaseTier,
  type SalesDealCadence,
  type SalesErrorCode,
  type SalesEventBatchAction,
  type SalesEventBatchInput,
  type SalesEventBatchState,
  type SalesEventScope,
  type SalesEventTicketCounts,
} from '@watchdog-bms/contracts';
import { quoteTotals } from '../../billing/domain/billing-policy';

/** Thrown with the code the console answers; `details` travels in the 400 body next to it. */
export class SalesEventRuleError extends Error {
  constructor(readonly code: SalesErrorCode, message: string, readonly details: Record<string, string> = {}) {
    super(message);
  }
}

/** Every amount lands in a Postgres `integer`; anything above would be a 500, not a refusal. */
const INT4_MAX = 2_147_483_647;
const INTERVALS: readonly SalesDealCadence[] = ['month', 'year'];

/**
 * The lowest price a discounted first bill may carry: ฿10, the same floor `parseBillingPolicy`
 * applies to every catalog price (`billing-policy.ts` offerTerms). A code constant, never a policy key
 * (SED-09). SD-C's quote reuses this and `eventDiscountUnitAmountSatang`, so the card and the checkout
 * can never disagree with what the lead was allowed to publish (SED-14).
 */
export const SALES_EVENT_MIN_UNIT_AMOUNT_SATANG = 1000;

export type SalesEventBatchValues = {
  eventName: string; batchName: string;
  discountSatang: number; rewardChatCreditUnits: number; rewardReceiptImageUnits: number;
  issueCap: number; claimStartsAt: Date; claimEndsAt: Date;
  scope: SalesEventScope; agentUserIds: string[];
};

function invalid(message: string): SalesEventRuleError {
  return new SalesEventRuleError('SALES_EVENT_BATCH_INVALID', message);
}

function name(raw: unknown, label: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > SALES_EVENT_NAME_MAX) throw invalid(`${label}ต้องมี 1–${SALES_EVENT_NAME_MAX} ตัวอักษร`);
  return value;
}

function wholeUnits(raw: unknown, step: number, label: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw > INT4_MAX || raw % step !== 0) {
    throw invalid(`${label}ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป`);
  }
  return raw;
}

function instant(raw: unknown, label: string): Date {
  const date = typeof raw === 'string' ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) throw invalid(`${label}ไม่ถูกต้อง`);
  return date;
}

/** Deduplicated, in the catalog's own order, so the same choice always stores the same JSON. */
function scopeFrom(raw: unknown): SalesEventScope {
  const scope = raw as Partial<SalesEventScope> | null;
  if (!scope || !Array.isArray(scope.tiers) || !Array.isArray(scope.intervals)
    || scope.tiers.some((tier) => !SALES_DEAL_BASE_TIERS.includes(tier))
    || scope.intervals.some((interval) => !INTERVALS.includes(interval))) {
    throw invalid('แพ็กเกจหรือรอบที่ลดได้ไม่ถูกต้อง');
  }
  return {
    tiers: SALES_DEAL_BASE_TIERS.filter((tier) => scope.tiers!.includes(tier)),
    intervals: INTERVALS.filter((interval) => scope.intervals!.includes(interval)),
  };
}

/**
 * Validates and normalises what the lead typed (spec §3.1). `current` is the stored batch when this is
 * an edit: the cap may not drop below what was already handed out, and a claim end left unchanged is
 * not re-checked against the clock, so a closed batch can still be renamed.
 */
export function validateSalesEventBatch(
  input: SalesEventBatchInput,
  now: Date,
  current?: { issuedCount: number; claimEndsAt: Date },
): SalesEventBatchValues {
  const eventName = name(input.eventName, 'ชื่องาน');
  const batchName = name(input.batchName, 'ชื่อชุด');
  // Whole baht (SED-39: no half-satang VAT) and whole AI credits; receipt images are whole already.
  const discountSatang = wholeUnits(input.discountSatang, 100, 'ส่วนลด');
  const rewardChatCreditUnits = wholeUnits(input.rewardChatCreditUnits, SALES_EVENT_CHAT_CREDIT_UNIT_SCALE, 'เครดิต AI');
  const rewardReceiptImageUnits = wholeUnits(input.rewardReceiptImageUnits, 1, 'จำนวนอ่านรูปใบเสร็จ');
  // Owner 2026-09-29: credit for shops that already pay is withdrawn for now ("ถอยก่อน"), so every
  // batch gives a discount. The credit columns and stored values stay as they are.
  if (discountSatang === 0) {
    throw new SalesEventRuleError('SALES_EVENT_REWARD_REQUIRED', 'ใส่ส่วนลดมากกว่า 0 บาท');
  }
  const issueCap = input.issueCap;
  if (typeof issueCap !== 'number' || !Number.isSafeInteger(issueCap) || issueCap < 1 || issueCap > INT4_MAX) {
    throw invalid('จำนวนแจกสูงสุดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  }
  if (current && issueCap < current.issuedCount) {
    throw invalid(`จำนวนแจกสูงสุดต้องไม่น้อยกว่าที่แจกไปแล้ว ${current.issuedCount} รายการ`);
  }
  const claimStartsAt = instant(input.claimStartsAt, 'เวลาเปิดรับ');
  const claimEndsAt = instant(input.claimEndsAt, 'เวลาปิดรับ');
  if (claimEndsAt.getTime() <= claimStartsAt.getTime()) throw invalid('เวลาปิดรับต้องหลังเวลาเปิดรับ');
  const endChanged = !current || current.claimEndsAt.getTime() !== claimEndsAt.getTime();
  if (endChanged && claimEndsAt.getTime() <= now.getTime()) throw invalid('เวลาปิดรับต้องยังไม่ผ่านไป');
  const scope = scopeFrom(input.scope);
  // Without a package and a cycle, a first-bill discount would apply to nothing at all.
  if (discountSatang > 0 && (scope.tiers.length === 0 || scope.intervals.length === 0)) {
    throw invalid('เลือกแพ็กเกจและรอบที่ลดได้อย่างน้อยอย่างละหนึ่ง');
  }
  const agents = Array.isArray(input.agentUserIds) ? input.agentUserIds : [];
  if (agents.some((id) => typeof id !== 'string' || !id.trim())) throw invalid('รายชื่อเซลล์ผู้แจกไม่ถูกต้อง');
  const agentUserIds = [...new Set(agents.map((id) => id.trim()))];
  if (agentUserIds.length === 0) throw invalid('เลือกเซลล์ผู้แจกอย่างน้อยหนึ่งคน');
  return {
    eventName, batchName, discountSatang, rewardChatCreditUnits, rewardReceiptImageUnits,
    issueCap, claimStartsAt, claimEndsAt, scope, agentUserIds,
  };
}

/** Spec §6.2. Anything not listed is not a transition: the screen that sent it is out of date. */
const TRANSITIONS: Readonly<Record<SalesEventBatchAction, { from: readonly SalesEventBatchState[]; to: SalesEventBatchState }>> = {
  PAUSE: { from: ['OPEN'], to: 'PAUSED' },
  RESUME: { from: ['PAUSED'], to: 'OPEN' },
  SUSPEND: { from: ['OPEN', 'PAUSED'], to: 'SUSPENDED' },
  // Lifting a suspension never reopens the claim by itself; the lead resumes separately.
  LIFT: { from: ['SUSPENDED'], to: 'PAUSED' },
};

export function nextBatchState(state: string, action: SalesEventBatchAction): SalesEventBatchState | null {
  const rule = TRANSITIONS[action];
  return rule && rule.from.includes(state as SalesEventBatchState) ? rule.to : null;
}

/** SUSPEND and LIFT change what customers holding a ticket can do, so each needs a reason. */
export function batchActionReason(action: SalesEventBatchAction, raw: unknown): string | null {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length > SALES_EVENT_REASON_MAX) throw invalid(`เหตุผลต้องไม่เกิน ${SALES_EVENT_REASON_MAX} ตัวอักษร`);
  if (!reason && SALES_EVENT_REASON_ACTIONS.includes(action)) throw invalid('ต้องระบุเหตุผล');
  return reason || null;
}

/** A QR can be shown, and a ticket claimed, only while the batch is OPEN inside [start, end). */
export function batchClaimOpen(batch: { state: string; claimStartsAt: Date; claimEndsAt: Date }, now: Date): boolean {
  return batch.state === 'OPEN' && batch.claimStartsAt.getTime() <= now.getTime() && now.getTime() < batch.claimEndsAt.getTime();
}

/**
 * The first-bill unit amount after the discount (spec §5.1). NOT_VAT and EXCLUSIVE take the discount
 * off the card price; INCLUSIVE takes it off the pre-VAT subtotal and adds VAT back, so the tax on the
 * discounted bill is the same rounding `quoteTotals` would produce for it.
 */
export function eventDiscountUnitAmountSatang(
  priceSatang: number, discountSatang: number, taxTreatment: BillingTaxTreatment | null,
): number {
  if (taxTreatment !== 'INCLUSIVE_VAT_7') return priceSatang - discountSatang;
  const subtotal = quoteTotals(priceSatang, taxTreatment).subtotalSatang - discountSatang;
  return subtotal + Math.round(subtotal * 7 / 100);
}

/** The first package/cycle in scope whose discounted first bill would fall under ฿10, or null. */
export function firstOfferBelowMinimum(
  offers: readonly { offerKey: string; interval: string; priceSatang: number }[],
  scope: SalesEventScope,
  discountSatang: number,
  taxTreatment: BillingTaxTreatment | null,
): { offerKey: SalesDealBaseTier; interval: SalesDealCadence } | null {
  if (discountSatang === 0) return null;
  for (const offer of offers) {
    if (!scope.tiers.includes(offer.offerKey as SalesDealBaseTier) || !scope.intervals.includes(offer.interval as SalesDealCadence)) continue;
    if (eventDiscountUnitAmountSatang(offer.priceSatang, discountSatang, taxTreatment) < SALES_EVENT_MIN_UNIT_AMOUNT_SATANG) {
      return { offerKey: offer.offerKey as SalesDealBaseTier, interval: offer.interval as SalesDealCadence };
    }
  }
  return null;
}

/** Folds `groupBy(state, redeemedAs)` rows and the expired-ISSUED count into the console's figures. */
export function ticketCounts(
  groups: readonly { state: string; redeemedAs: string | null; count: number }[],
  expiredIssued: number,
): SalesEventTicketCounts {
  const sum = (match: (group: { state: string; redeemedAs: string | null }) => boolean) =>
    groups.filter(match).reduce((total, group) => total + group.count, 0);
  const issued = sum(() => true);
  const stillIssued = sum((group) => group.state === 'ISSUED');
  return {
    issued,
    available: stillIssued - expiredIssued,
    inPayment: sum((group) => group.state === 'RESERVED'),
    usedAsDiscount: sum((group) => group.state === 'USED' && group.redeemedAs === 'DISCOUNT'),
    usedAsCredit: sum((group) => group.state === 'USED' && group.redeemedAs === 'CREDIT'),
    expired: expiredIssued,
    revoked: sum((group) => group.state === 'REVOKED'),
  };
}

/** Read-back of the stored scope. Total: a row written by an older build still renders. */
export function scopeFromJson(json: unknown): SalesEventScope {
  const scope = json as Partial<SalesEventScope> | null;
  return {
    tiers: SALES_DEAL_BASE_TIERS.filter((tier) => Array.isArray(scope?.tiers) && scope.tiers.includes(tier)),
    intervals: INTERVALS.filter((interval) => Array.isArray(scope?.intervals) && scope.intervals.includes(interval)),
  };
}
