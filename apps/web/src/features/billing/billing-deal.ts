import { MENU_ENTITLEMENT_BINDINGS, type BillingPurchaseMode, type BillingStatus } from '@watchdog-bms/contracts';

/**
 * The sales team's ข้อเสนอพิเศษ on the customer's package page (spec §19.2 R10, §12 "หน้าแพ็กเกจ").
 *
 * The API hangs the whole approved offer on `BillingStatus.deal`, a short ride-along on
 * `BillingQuote.deal` and the same on `BillingAttemptView.deal`. All three are read structurally
 * rather than by type, so a status, quote or attempt that predates Phase 3 — or one whose stored
 * snapshot no longer parses — simply shows no card and no deal wording.
 */

/** Phase 3 sells a deal paid once (#667); Phase 5 (D-P5-4/Q8) adds the two renewing modes — a deal
 *  is one or the other, never both, so `dealPurchaseModes` picks the pair by the deal itself. */
export const DEAL_PURCHASE_MODES: readonly BillingPurchaseMode[] = ['CARD_ONCE', 'PROMPTPAY_ONCE'];
export const DEAL_AUTO_PURCHASE_MODES: readonly BillingPurchaseMode[] = ['CARD_AUTO', 'PROMPTPAY_RENEW'];

export function dealPurchaseModes(autoRenew: boolean): readonly BillingPurchaseMode[] {
  return autoRenew ? DEAL_AUTO_PURCHASE_MODES : DEAL_PURCHASE_MODES;
}

/** `autoRenew`/`cadence` are the status's own (D-P5-1). `cycles` is not on `BillingStatus['deal']`:
 *  the customer card simply omits "N รอบ แล้วกลับราคาปกติ" until it is, which is exactly what the
 *  helpers below do with a null. */
export type BillingDealOffer = NonNullable<BillingStatus['deal']> & { cycles?: number | null };
/** What a deal quote carries back so the confirm screen can name the offer (not the catalog tier). */
export type BillingDealQuote = { dealId: string; months: number; description?: string; baseLabel?: string };

/**
 * The deal this shop can pay right now, or null. Expiry is re-checked here because the offer lives
 * three days (R4) while this page polls status for minutes: a card whose quote the API would
 * refuse with `BILLING_DEAL_EXPIRED` must stop offering a button, not fail at the tap (S46).
 */
export function billingDeal(status: { deal?: unknown } | null | undefined, now: number = Date.now()): BillingDealOffer | null {
  const deal = (status?.deal ?? null) as Partial<BillingDealOffer> | null;
  if (!deal || typeof deal.dealId !== 'string' || typeof deal.priceSatang !== 'number' || typeof deal.months !== 'number') return null;
  if (typeof deal.offerExpiresAt !== 'string' || !(Date.parse(deal.offerExpiresAt) > now)) return null;
  // D-P5-1: only `month`/`year` exist (D-P5-2), so anything else is read as monthly rather than
  // reaching a customer as a machine token in "ทุก…".
  const autoRenew = deal.autoRenew === true;
  const cadence = deal.cadence === 'year' ? 'year' : 'month';
  const cycles = typeof deal.cycles === 'number' && Number.isInteger(deal.cycles) && deal.cycles > 0 ? deal.cycles : null;
  // S39: the card uses the deal's own modes, never `availablePurchaseModes`. A mode of the wrong
  // family, or an unknown one from a newer API, is dropped instead of drawing a radio nothing can
  // be paid with — an auto-renewing deal cannot be settled with a one-time payment and vice versa.
  const allowed = dealPurchaseModes(autoRenew);
  const purchaseModes = (Array.isArray(deal.purchaseModes) ? deal.purchaseModes : []).filter(mode => allowed.includes(mode));
  return { ...(deal as BillingDealOffer), autoRenew, cadence, cycles, purchaseModes };
}

type DealRenewal = Pick<BillingDealOffer, 'autoRenew' | 'cadence' | 'cycles'>;
const everyCycle = (deal: DealRenewal) => deal.cadence === 'year' ? 'ทุกปี' : 'ทุกเดือน';
const cycleTail = (deal: DealRenewal) => deal.cycles ? ` · ${deal.cycles} รอบ แล้วกลับราคาปกติ` : '';

/**
 * What the shop is agreeing to, on the card (§17.3/Q8). Card and QR are genuinely different
 * promises — one takes the money by itself, the other only sends a bill somebody has to scan — so
 * the sentence follows the mode the customer picked, not the deal alone.
 */
export function dealRenewalText(deal: DealRenewal, mode: BillingPurchaseMode | undefined): string {
  if (!deal.autoRenew) return 'จ่ายครั้งเดียว ไม่มีหักอัตโนมัติ';
  return (mode === 'PROMPTPAY_RENEW'
    ? `ออกบิล QR ${everyCycle(deal)} ที่ราคานี้ · สแกนจ่ายเอง`
    : `ตัดบัตรอัตโนมัติ${everyCycle(deal)} ที่ราคานี้ · ยกเลิกได้จากหน้าแพ็กเกจ`) + cycleTail(deal);
}

/** The same promise on the confirm screen, where the price beside it is already the deal's. */
export function dealConfirmText(deal: DealRenewal): string {
  return `ต่ออายุอัตโนมัติที่ราคาข้อเสนอพิเศษ ${everyCycle(deal)}${cycleTail(deal)}`;
}

/** The deal a quote was priced from, or the one an attempt paid for — same narrow read. */
export function billingQuoteDeal(quote: { deal?: unknown } | null | undefined): BillingDealQuote | null {
  const deal = (quote?.deal ?? null) as Partial<BillingDealQuote> | null;
  return deal && typeof deal.dealId === 'string' && typeof deal.months === 'number' ? deal as BillingDealQuote : null;
}

/**
 * The menus a deal grants, in nav order, worded as the customer reads them elsewhere. Same rule the
 * เซลล์ sells by (`SALES_DEAL_MENU_BINDINGS`): a menu counts only when every entitlement key behind
 * it is in the snapshot. Re-derived from the bindings rather than imported from the sales console,
 * whose module would pull the whole workspace dictionary into this customer page's bundle.
 */
export function dealMenuLabels(featureKeys: readonly string[] | null | undefined): string[] {
  const keys = new Set(featureKeys ?? []);
  return MENU_ENTITLEMENT_BINDINGS
    .filter(binding => binding.status === 'ready' && binding.navigation !== 'contextual'
      && binding.entitlementKeys.length > 0 && binding.entitlementKeys.every(key => keys.has(key)))
    .map(binding => binding.labelTh);
}

/** D-P3-2: empty = the package default, ≥ 1 บาท = that budget. A legacy 0 still means AI closed. */
export function dealAiCreditText(satang: number | null | undefined): string {
  if (satang === null || satang === undefined) return 'ใช้ค่าเริ่มต้นของแพ็กเกจ';
  if (satang <= 0) return 'ปิดการใช้งาน AI';
  return `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท / เดือน`;
}

