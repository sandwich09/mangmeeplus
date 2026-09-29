import type { BillingPurchaseMode, BillingQuote } from '@watchdog-bms/contracts';
import { eventDiscountCardAuto, type EventDiscountSnapshot } from './billing-event-discount.logic';

/** Paid in a one-time `mode: 'payment'` Checkout by the purchase mode alone. */
export const paymentCheckoutMode = (mode: BillingPurchaseMode | undefined) => mode === 'CARD_ONCE' || mode === 'PROMPTPAY_ONCE' || mode === 'PROMPTPAY_RENEW';
/**
 * The one answer to "was this snapshot's Checkout created as `mode: 'payment'`?", shared by Checkout creation and every
 * later read of that session. A renewing advance deal (CARD_AUTO too) and SD-O13's discounted CARD_AUTO first period are
 * paid once, then bind their subscription (spec §5.3).
 */
export const paymentCheckoutSnapshot = (snapshot: { quote: Pick<BillingQuote, 'purchaseMode'>; advanceDeal?: unknown;
  eventDiscount?: Pick<EventDiscountSnapshot, 'choice'> }) =>
  paymentCheckoutMode(snapshot.quote.purchaseMode) || !!snapshot.advanceDeal || eventDiscountCardAuto(snapshot);
