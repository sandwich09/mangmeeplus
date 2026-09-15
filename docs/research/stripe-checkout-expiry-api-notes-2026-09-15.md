# Stripe Checkout expiry — implementation reference

Reviewed2026-09-15: [Expire a Checkout Session](https://docs.stripe.com/api/checkout/sessions/expire) and [Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object).

Stripe accepts POST `/checkout/sessions/:id/expire` for an open Checkout Session. The response is the Session object. An already expired or non-expirable Session produces an error, so error/timeout is not proof of cancellation. Expired Checkout can no longer be completed by the customer; this endpoint does not itself certify a refund, subscription cancellation or entitlement reversal.

Mangmee design inference: bind the native account/mode/Session/customer/client reference/metadata and historical consent quote to the exact local attempt, inspect current status before the POST and reread after any outcome. A concurrent completed/paid Session must enter existing payment reconciliation. A late positive expiry observation may recover a lost command result, but a new write still needs current authority, source, deadline and live leases. No native request was made for this reference review.
