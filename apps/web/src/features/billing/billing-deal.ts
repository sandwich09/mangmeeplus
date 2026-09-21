import { MENU_ENTITLEMENT_BINDINGS, type BillingPurchaseMode, type BillingStatus } from '@watchdog-bms/contracts';

/**
 * The sales team's ข้อเสนอพิเศษ on the customer's package page (spec §19.2 R10, §12 "หน้าแพ็กเกจ").
 *
 * The API hangs the whole approved offer on `BillingStatus.deal`, a short ride-along on
 * `BillingQuote.deal` and the same on `BillingAttemptView.deal`. All three are read structurally
 * rather than by type, so a status, quote or attempt that predates Phase 3 — or one whose stored
 * snapshot no longer parses — simply shows no card and no deal wording.
 */

/** Phase 3 sells a deal on the #667 one-time path only; Phase 5 adds the renewing modes (R10). */
export const DEAL_PURCHASE_MODES: readonly BillingPurchaseMode[] = ['CARD_ONCE', 'PROMPTPAY_ONCE'];

export type BillingDealOffer = NonNullable<BillingStatus['deal']>;
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
  // S39: the card uses the deal's own modes, never `availablePurchaseModes`. A renewing or unknown
  // mode from a newer API is dropped instead of drawing a radio nothing can be paid with.
  const purchaseModes = (Array.isArray(deal.purchaseModes) ? deal.purchaseModes : [])
    .filter(mode => DEAL_PURCHASE_MODES.includes(mode));
  return { ...(deal as BillingDealOffer), purchaseModes };
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
