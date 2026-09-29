import type { BillingOffer, BillingPolicy, BillingPurchaseMode, BillingQuote, BillingQuoteEventDiscount } from '@watchdog-bms/contracts';
import { quoteTotals } from './billing-policy';
import { eventDiscountUnitAmountSatang, SALES_EVENT_MIN_UNIT_AMOUNT_SATANG, scopeFromJson } from '../../sales-console/domain/sales-event.logic';

/** Sales-event discount (docs/specs/sales-event-discounts-spec-th.md §4–§5, SD-O12), pure rules only. */
export type EventDiscountAmounts = { unitAmountSatang: number; subtotalSatang: number; taxSatang: number; totalSatang: number; shownDiscountSatang: number };
/** `snapshot.eventDiscount` of the quote and, copied verbatim, of the immutable attempt. Absent = no offer at quote. */
export type EventDiscountSnapshot =
  | (BillingQuoteEventDiscount & { choice: 'USE'; applied: NonNullable<BillingQuoteEventDiscount['applied']>;
      ticketId: string; ticketVersion: number; batchId: string; salesUserId: string })
  | { choice: 'DECLINE'; offeredTicketId: string };

/** Spec §4.1.1 / SD-O12 (Owner 2026-09-29): any package payment the holder makes on the package page, chosen at payment. */
const KINDS = ['INITIAL', 'RESTART', 'REPEAT', 'SCHEDULED_CHANGE', 'FULL_PACKAGE_UPGRADE', 'UPGRADE'];
// ponytail: one-time modes only today; CARD_AUTO and PROMPTPAY_RENEW (first bill and renewals) wait for an Owner decision on automatic renewals.
export const EVENT_DISCOUNT_MODES: readonly BillingPurchaseMode[] = ['CARD_ONCE', 'PROMPTPAY_ONCE'];

/** The price the discount comes off: an UPGRADE charges its prorated difference, every other kind the offer price. */
export const eventDiscountBasis = (snapshot: { quote: Pick<BillingQuote, 'offer'>; upgrade?: { amountSatang: number } }) =>
  snapshot.upgrade?.amountSatang ?? snapshot.quote.offer.priceSatang;

/** Spec §5.1: price after a whole-baht discount D off P, per tax treatment. Null = this card gets no discount (never a partial one). */
export function eventDiscountAmounts(priceSatang: number, discountSatang: number, tax: BillingPolicy['taxTreatment']): EventDiscountAmounts | null {
  if (!Number.isSafeInteger(priceSatang) || !Number.isSafeInteger(discountSatang) || discountSatang <= 0 || discountSatang % 100 !== 0) return null;
  // One formula with the console's minimum-price check (SD-A), so a batch it accepts is the discount a quote gives.
  const unitAmountSatang = eventDiscountUnitAmountSatang(priceSatang, discountSatang, tax);
  if (unitAmountSatang < SALES_EVENT_MIN_UNIT_AMOUNT_SATANG || unitAmountSatang >= priceSatang) return null;
  return { unitAmountSatang, ...quoteTotals(unitAmountSatang, tax), shownDiscountSatang: priceSatang - unitAmountSatang };
}

/** Spec §4.1.1/§4.2: a catalog package payment paid in one go; never a deal or an automatic renewal. */
export function eventDiscountPurchase(quote: Pick<BillingQuote, 'purchaseMode' | 'purchase' | 'deal'>): boolean {
  return !quote.deal && !!quote.purchaseMode && EVENT_DISCOUNT_MODES.includes(quote.purchaseMode) && KINDS.includes(quote.purchase?.kind ?? '');
}

export function eventDiscountInScope(scopeJson: unknown, offer: Pick<BillingOffer, 'offerKey' | 'interval'>): boolean {
  const scope = scopeFromJson(scopeJson);
  return (scope.tiers as string[]).includes(offer.offerKey) && (scope.intervals as string[]).includes(offer.interval);
}

/** Spec §4.3: of the holder's usable tickets, the one that takes most off this card; ties → expires first, then id.
 *  Scope reads the target offer; the amounts come off `basisSatang` (an upgrade's difference, else the offer price). */
export function pickEventDiscount<T extends { id: string; discountSatang: number; expiresAt: Date; scopeJson: unknown }>(
  tickets: readonly T[], offer: Pick<BillingOffer, 'offerKey' | 'interval' | 'priceSatang'>, tax: BillingPolicy['taxTreatment'],
  basisSatang = offer.priceSatang): { ticket: T; amounts: EventDiscountAmounts } | null {
  let best: { ticket: T; amounts: EventDiscountAmounts } | null = null;
  for (const ticket of tickets) {
    const amounts = eventDiscountInScope(ticket.scopeJson, offer) ? eventDiscountAmounts(basisSatang, ticket.discountSatang, tax) : null;
    if (amounts && (!best || amounts.shownDiscountSatang > best.amounts.shownDiscountSatang || (amounts.shownDiscountSatang === best.amounts.shownDiscountSatang &&
        (ticket.expiresAt.getTime() - best.ticket.expiresAt.getTime() || ticket.id.localeCompare(best.ticket.id)) < 0))) best = { ticket, amounts };
  }
  return best;
}

/**
 * Spec §4.3 at Checkout. USE → reserve the quoted ticket (a failed reservation is stale). DECLINE → proceed, never
 * stale for a discount reason. No offer at quote → stale once the holder has one, so the buyer gets to choose.
 */
export function eventDiscountCheckoutRule(snapshot: Pick<EventDiscountSnapshot, 'choice'> | undefined, offerNow: boolean): 'RESERVE' | 'PROCEED' | 'STALE' {
  return snapshot?.choice === 'USE' ? 'RESERVE' : snapshot || !offerNow ? 'PROCEED' : 'STALE';
}

/**
 * Spec §5.2: what a paid one-time Checkout must show when the attempt snapshot chose USE — recomputed from the
 * snapshot's own price basis (`eventDiscountBasis`), discount and tax treatment. Null = the snapshot's discount does not add up.
 */
export function eventDiscountExpected(snapshot: { quote: Pick<BillingQuote, 'purchaseMode' | 'purchase' | 'deal' | 'offer'>;
  policy: Pick<BillingPolicy, 'taxTreatment'>; upgrade?: { amountSatang: number }; deal?: unknown; eventDiscount?: EventDiscountSnapshot }): EventDiscountAmounts | null {
  const discount = snapshot.eventDiscount;
  if (discount?.choice !== 'USE' || snapshot.deal || !eventDiscountPurchase(snapshot.quote) ||
      (snapshot.quote.purchase?.kind === 'UPGRADE') !== !!snapshot.upgrade) return null;
  const expected = eventDiscountAmounts(eventDiscountBasis(snapshot), discount.discountSatang, snapshot.policy.taxTreatment);
  const applied = discount.applied;
  return expected && applied && expected.unitAmountSatang === applied.unitAmountSatang && expected.subtotalSatang === applied.subtotalSatang &&
    expected.taxSatang === applied.taxSatang && expected.totalSatang === applied.totalSatang && expected.shownDiscountSatang === discount.shownDiscountSatang
    ? expected : null;
}
