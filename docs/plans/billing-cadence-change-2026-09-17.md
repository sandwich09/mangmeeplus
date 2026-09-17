# Billing cadence change — approved product rules and execution plan

Status: implemented and verified locally; owner authorized commit and admin merges to develop/main after clean CI on2026-09-17. UAT/Production deployment remains a subsequent step. Earlier paused-delivery notes below are historical evidence.

## Product and acceptance

Owner approved the business recommendation on 2026-09-17: a paid customer may buy the same tier annually while currently monthly. Charge the full annual catalog price once, grant the full annual receipt allowance only after verified payment, and append 12 calendar months to the existing paid-through date. Carry still-valid purchased receipts; do not revive expired/admin grants. Branch/user limits do not decrease. The next automatic annual payment is at the extended paid-through boundary. No credit/refund/proration of the existing monthly purchase.

Example: Basic monthly paid through 17 October 2026, annual price THB 4,990, annual allowance 600: pay THB 4,990 now, receive 600 receipts after payment, extend expiry to 17 October 2027, next annual payment then. Remaining purchased time is not lost. Prices/taxes/limits come from the accepted quote, never frontend constants.

Annual to monthly at the same tier and lower-tier changes in either cadence use the existing scheduled-change flow: no charge or capacity change now, existing rights until all paid time ends, target rights/allowance only on verified renewal payment. Owner chooses retained branches/members and acknowledges any suspension. A simultaneous higher-tier and cadence change remains two explicit transactions: upgrade within the current cadence, then change cadence. Do not invent a blended charge. If a monthly customer has an accepted scheduled change, annual conversion asks them to review/cancel that change first; do not silently override it.

## Architecture and boundaries

- Reuse BillingRepeat payment-mode Checkout, durable journals, source fence, paid evidence, one subscription, zero-price prepaid schedule, grants and recovery. No new database shape, permission or provider bypass.
- Persist original future interval separately from the purchased interval so source schedule validation continues checking the original monthly schedule. Legacy snapshots retain their fallback.
- Quote exposes optional previousInterval for truthful cadence-change copy. UI renders authoritative amounts and dates, one summary, consent and secondary back control.
- Mixed monthly/yearly prepaid grants must remain upgradeable: price each remaining segment against the target tier's catalog offer in that segment's cadence. Persist that target offer only for mixed segments and validate immutable earlier upgrades against it. Preserve existing source hashes for ordinary same-cadence history.
- Reuse collection preview/submit/apply for scheduled cadence changes; original internal SCHEDULE_DOWNGRADE action stays compatible, customer copy says change next period.
- Keep owner/email/gates/tax, source-state/version/hash, capacity, consent, payment verification and idempotency checks intact.

## Implementation and verification

1. Amend spec, quote metadata and repeat source/scheduled admission; mixed-source upgrade accounting.
2. Shared frontend/preview: same-tier annual CTA and four-field payment summary; clear next-step copy for pending changes and combined upgrades; scheduled target shows both cadences.
3. Focused API checks: monthly schedule source validation, ordinary and mixed upgrade history, monthly-to-annual checkout failure/recovery and once-only grants/calendar extension, subsequent upgrade/repeat, annual-to-monthly scheduling/cancellation. Use existing HTTP/PostgreSQL provider-simulated smoke.
4. Browser shared preview at desktop/mobile, typechecks/build and diff checks; inspect actual screenshots. Record limits: simulated provider checks are not a live Stripe release acceptance.
5. Record evidence in task memory; leave all work local for continued owner review.

## Verification evidence

- Shared preview Playwright: desktop/mobile 2/2 passed (15.2s), including full-price annual summary, consent reset on back, annual success/current marker and same-tier annual-to-monthly next-period review. Inspected annual-conversion screenshots at 1280px and 390px; no overflow.
- Focused API unit tests: 5/5 passed: proration, invoice-preview evidence, original monthly schedule validation despite annual target, successive mixed-cadence upgrades, and journal-bound zero-value cadence invoices with unrelated/foreign/paid-value rejection.
- Real Nest HTTP/PostgreSQL/browser with simulated Stripe/Postmark/LINE: 34 scenarios passed in `/tmp/mangmee-cadence-api.log`. Includes failed annual checkout retaining monthly terms, pending-change explicit cancellation, lost schedule-response recovery, full annual grant exactly once, native-like anchor reset/zero update invoice, original calendar anniversary on subsequent repeat, mixed-source upgrade, monthly-next schedule/cancel, existing paid renewal/capacity repair regression cases.
- Contracts build, API build, API/web TypeScript and `git diff --check` passed. Local API rebuilt/restarted on 3001, health HTTP 200. No real charge, email, live Stripe acceptance, schema change, push, PR, merge or deployment.
- First test launch selected a nonexistent isolated database; reran against existing dedicated local `watchdog_postmark_ci`. Product database was not used for smoke data. Generated Next route references and legacy screenshot were restored after verification.
- Provider semantics checked against [Stripe schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules), [billing cycle](https://docs.stripe.com/billing/subscriptions/billing-cycle), and [invoice reasons](https://docs.stripe.com/api/invoices/object). Existing no-proration schedule journal is retained; only zero update invoices validated during this command are recorded/recognized, never arbitrary updates.
