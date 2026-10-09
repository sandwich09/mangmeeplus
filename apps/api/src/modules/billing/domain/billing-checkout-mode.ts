import type { BillingPurchaseMode, BillingQuote } from '@watchdog-bms/contracts';
import { eventDiscountCardAuto, type EventDiscountSnapshot } from './billing-event-discount.logic';

/** Paid in a one-time `mode: 'payment'` Checkout by the purchase mode alone. */
export const paymentCheckoutMode = (mode: BillingPurchaseMode | undefined) => mode === 'CARD_ONCE' || mode === 'PROMPTPAY_ONCE' || mode === 'PROMPTPAY_RENEW';
type PrepaidSnapshot = { quote: Pick<BillingQuote, 'purchaseMode'>; eventDiscount?: Pick<EventDiscountSnapshot, 'choice'>; promotion?: unknown; repeat?: unknown };
/**
 * A CARD_AUTO first period paid now in a payment Checkout that saves the card, its full-price subscription bound afterwards:
 * SD-O13's discounted first bill, or a promotion purchase (promotion spec §7; never a repeat on a live subscription, plan R10).
 * A promotion is read from its own snapshot — `eventDiscount.choice` is never set to fake it.
 */
export const prepaidCardAuto = (snapshot: PrepaidSnapshot | null | undefined): boolean =>
  eventDiscountCardAuto(snapshot) || (snapshot?.quote.purchaseMode === 'CARD_AUTO' && !!snapshot.promotion && !snapshot.repeat);
/**
 * The one answer to "was this snapshot's Checkout created as `mode: 'payment'`?", shared by Checkout creation and every
 * later read of that session. A renewing advance deal (CARD_AUTO too), SD-O13's discounted CARD_AUTO first period and a
 * CARD_AUTO promotion purchase are paid once, then bind their subscription (spec §5.3).
 */
export const paymentCheckoutSnapshot = (snapshot: PrepaidSnapshot & { advanceDeal?: unknown }) =>
  paymentCheckoutMode(snapshot.quote.purchaseMode) || !!snapshot.advanceDeal || prepaidCardAuto(snapshot);
