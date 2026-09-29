import type { BillingOffer, BillingPolicy, BillingPurchaseMode, BillingQuote, BillingQuoteEventDiscount } from '@watchdog-bms/contracts';
import { quoteTotals } from './billing-policy';
import { eventDiscountUnitAmountSatang, SALES_EVENT_MIN_UNIT_AMOUNT_SATANG, scopeFromJson } from '../../sales-console/domain/sales-event.logic';

/** Sales-event first-bill discount (docs/specs/sales-event-discounts-spec-th.md §4–§5), pure rules only. */
export type EventDiscountAmounts = { unitAmountSatang: number; subtotalSatang: number; taxSatang: number; totalSatang: number; shownDiscountSatang: number };
/** `snapshot.eventDiscount` of the quote and, copied verbatim, of the immutable attempt. Absent = no offer at quote. */
export type EventDiscountSnapshot =
  | (BillingQuoteEventDiscount & { choice: 'USE'; applied: NonNullable<BillingQuoteEventDiscount['applied']>;
      ticketId: string; ticketVersion: number; batchId: string; salesUserId: string })
  | { choice: 'DECLINE'; offeredTicketId: string };

/** Spec §4.1.1: only the first bill of a purchase that starts a package. */
const KINDS = ['INITIAL', 'RESTART'];
// ponytail: one-time modes only today; CARD_AUTO and PROMPTPAY_RENEW follow with the trialing-subscription binding (plan SD-C, spec §5.3).
export const EVENT_DISCOUNT_MODES: readonly BillingPurchaseMode[] = ['CARD_ONCE', 'PROMPTPAY_ONCE'];

/** Spec §5.1: price after a whole-baht discount D off P, per tax treatment. Null = this card gets no discount (never a partial one). */
export function eventDiscountAmounts(priceSatang: number, discountSatang: number, tax: BillingPolicy['taxTreatment']): EventDiscountAmounts | null {
  if (!Number.isSafeInteger(priceSatang) || !Number.isSafeInteger(discountSatang) || discountSatang <= 0 || discountSatang % 100 !== 0) return null;
  // One formula with the console's minimum-price check (SD-A), so a batch it accepts is the discount a quote gives.
  const unitAmountSatang = eventDiscountUnitAmountSatang(priceSatang, discountSatang, tax);
  if (unitAmountSatang < SALES_EVENT_MIN_UNIT_AMOUNT_SATANG || unitAmountSatang >= priceSatang) return null;
  return { unitAmountSatang, ...quoteTotals(unitAmountSatang, tax), shownDiscountSatang: priceSatang - unitAmountSatang };
}

/** Spec §4.1.1/§4.2: a catalog first purchase paid in one go; never a deal, an upgrade or a renewal. */
export function eventDiscountPurchase(quote: Pick<BillingQuote, 'purchaseMode' | 'purchase' | 'deal' | 'upgrade'>): boolean {
  return !quote.deal && !quote.upgrade && !!quote.purchaseMode && EVENT_DISCOUNT_MODES.includes(quote.purchaseMode) && KINDS.includes(quote.purchase?.kind ?? '');
}

export function eventDiscountInScope(scopeJson: unknown, offer: Pick<BillingOffer, 'offerKey' | 'interval'>): boolean {
  const scope = scopeFromJson(scopeJson);
  return (scope.tiers as string[]).includes(offer.offerKey) && (scope.intervals as string[]).includes(offer.interval);
}

/** Spec §4.3: of the holder's usable tickets, the one that takes most off this card; ties → expires first, then id. */
export function pickEventDiscount<T extends { id: string; discountSatang: number; expiresAt: Date; scopeJson: unknown }>(
  tickets: readonly T[], offer: Pick<BillingOffer, 'offerKey' | 'interval' | 'priceSatang'>, tax: BillingPolicy['taxTreatment']): { ticket: T; amounts: EventDiscountAmounts } | null {
  let best: { ticket: T; amounts: EventDiscountAmounts } | null = null;
  for (const ticket of tickets) {
    const amounts = eventDiscountInScope(ticket.scopeJson, offer) ? eventDiscountAmounts(offer.priceSatang, ticket.discountSatang, tax) : null;
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
 * snapshot's own offer price, discount and tax treatment. Null = the snapshot's discount does not add up.
 */
export function eventDiscountExpected(snapshot: { quote: Pick<BillingQuote, 'purchaseMode' | 'purchase' | 'deal' | 'upgrade' | 'offer'>;
  policy: Pick<BillingPolicy, 'taxTreatment'>; upgrade?: unknown; deal?: unknown; eventDiscount?: EventDiscountSnapshot }): EventDiscountAmounts | null {
  const discount = snapshot.eventDiscount;
  if (discount?.choice !== 'USE' || snapshot.upgrade || snapshot.deal || !eventDiscountPurchase(snapshot.quote)) return null;
  const expected = eventDiscountAmounts(snapshot.quote.offer.priceSatang, discount.discountSatang, snapshot.policy.taxTreatment);
  const applied = discount.applied;
  return expected && applied && expected.unitAmountSatang === applied.unitAmountSatang && expected.subtotalSatang === applied.subtotalSatang &&
    expected.taxSatang === applied.taxSatang && expected.totalSatang === applied.totalSatang && expected.shownDiscountSatang === discount.shownDiscountSatang
    ? expected : null;
}
