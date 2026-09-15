# Stripe configurable offer references — 2026-09-15

Checked official [Create a Price](https://docs.stripe.com/api/prices/create) and [Supported currencies](https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts). Prices carry integer minor-unit amounts, currency, product and recurring interval. VAT behavior is fixed once inclusive/exclusive is set. New Mangmee terms therefore require a matching original Price; publication reads/verifies the provider and does not create/update a native Price.

The documented THB settlement minimum is10THB. Current docs distinguish card-network digit maxima from other payment methods;8digits is not a universal card maximum. This implementation deliberately retains a conservative supported ceiling of99,999,999satang for a quoted total after VAT, below the signed32bit local money limit. Provider/network/payment-method limits can be narrower. It is an integration validation bound, not a commercial approval, balance or guarantee of charge acceptance. Receipt count keeps the existing signed32bit ledger bound, including annual12x and accumulated balances.

No provider mutation, credentials, live payment, deployment or CI was performed for these references.
