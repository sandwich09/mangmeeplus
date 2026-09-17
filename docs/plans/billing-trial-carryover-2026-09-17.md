# Trial receipt carryover — approved scope and execution plan

Status: complete locally with scoped verification and the admin-browser limitations below. Owner authorized commit/push and admin merges to develop/main after CI on2026-09-17; deployment remains a subsequent step.

## Product rules

Owner approved preserving unused ordinary trial receipts on the company's first verified paid purchase during an active trial. Carry at most the unused standard trial allowance (15), once per company. Do not grant a fresh 15, revive an expired trial, extend trial days, or count separate admin gifts as trial quota. The carryover expires at the original end of this first purchased term and never extends on repeats, grace or free-day grants. Use the existing earliest-expiry consumption order.

The owner explicitly requires existing paid balances to carry in full on repeat/upgrade/cadence changes under the existing rules: **15 applies only to ordinary trial carryover**. Do not truncate purchased balances or unexpired admin gifts. Expired/revoked units remain unavailable. Lower-tier and annual-to-monthly changes remain scheduled after paid time; no immediate allowance mutation.

## Architecture and journey

- Reuse BillingReceiptGrant with a distinct TRIAL_CARRYOVER kind, bounded units and a company-level unique index. Preserve purchased invoice grants separately for proration, source evidence and immutable paid-history hashes.
- Quote derives a trial carryover estimate only from the actual trial term and ordinary web/LINE receipt admissions, excluding bank statements and admin-grant consumption. Bind the estimate into the existing server-owned snapshot. Old quotes remain compatible and do not receive an unreviewed bonus.
- On verified INITIAL payment only, under the existing OCR/company transaction locks, re-read ordinary trial balance, cap it by the reviewed estimate, and verify paid time precedes the trial end. Past paid grants or prior carryover prohibit re-grant. Invoice replays remain idempotent. Failed, refunded/disputed-before-apply, held and expired-trial payments do not grant until eligible verified application.
- Exclude the new promotional kind from operations that extend purchased grants (repeat, grace, free days); include unexpired carryover in ordinary paid balance and preserve it through upgrades without making it a paid proration segment. Existing refund/support policies remain unchanged.
- Review shows paid quota, conditional trial carryover and projected total with expiry, plus a short note that use during checkout can change the final balance. Trial days remain separate. Paid customers retain their existing summaries and unrestricted carryover. Preview mirrors this without live mutations.

## Verification plan

1. PostgreSQL checks: unused/used-up/expired/nontrial eligibility, admin gifts, cap15 only for trial, concurrent/replayed grant, consumption during checkout, first-purchase-only, expiry, large paid balances, repeat/upgrade isolation.
2. Actual Nest HTTP + PostgreSQL + browser with simulated payment provider: trial purchase review/payment/application, failures/held/replay; existing initial/repeat/upgrade/month-year/year-month/lower-tier/renewal/cancel/restart/refund/support flows.
3. Shared local-preview E2E at desktop/mobile for all existing journeys and new carryover copy/success state. API/web typechecks, build, diff check and screenshot inspection.
4. Record commands, results and limitations. No claim of native Stripe/live-release validation from simulated-provider checks.

## Verification evidence (local, 2026-09-17)

- Focused PostgreSQL tests: 33 passed, no failures/skips. Real usage, initial application/replay, paid-time evidence, exhausted/expired/custom trials, admin gifts, grace recovery, fixed promotional expiry and large paid balances. `/tmp/mangmee-trial-postgres.log`.
- Billing domain/application suites: 54 passed, no failures/skips. `/tmp/mangmee-trial-unit.log`.
- Shared preview desktop/mobile: 2 passed (13.2s); trial review and success, repeated purchased quota, upgrade, cadence changes, capacity controls, pending change and history. `/tmp/mangmee-trial-preview.log`.
- Active-trial HTTP/PostgreSQL/Chromium journey: 29 case checks passed. Quote1,209 (paid1,200 + trial9); use one during checkout, hold without granting, repair and apply exactly1,208; subsequent web/LINE use leaves1,206; duplicate/historical events preserve balance. `/tmp/mangmee-billing-trial-http.log`.
- Cadence HTTP/PostgreSQL/Chromium journey: 34 case checks passed. Full annual allowance, old balance retained, mixed-source upgrade and deferred annual→monthly/lower tier. `/tmp/mangmee-billing-cadence-http.log`.
- Customer HTTP/PostgreSQL/Chromium journeys: 108 case checks passed. Includes initial, repeat, upgrade, scheduled lower tier, stop/resume, expired restart, held-payment capacity repair, failure/retry, refund/dispute projection, documents and quota. `/tmp/mangmee-billing-customer-http.log`.
- All available paid offers: 12 browser journeys passed (STARTER/BASIC/PRO × monthly/yearly × web/LINE entry), including real HTTP quote/checkout/application, unpaid state, replay, separate purchased/trial grants, calendar term, capacity and protected documents. `/tmp/mangmee-billing-offer-matrix-http.log`.
- Offer-term configuration HTTP/PostgreSQL regression: 6 case checks passed. Updated the former 1,500 total expectation to purchased1,500 + trial15; repeat gives2,715 while the original15 retains its first-term expiry. Added verified paid-time evidence to the synthetic invoice. `/tmp/mangmee-billing-offer-terms-http.log`.
- Settlement HTTP/PostgreSQL regression: 10 case checks passed, including no mutation of paid days/quota/capacity or financial evidence. `/tmp/mangmee-billing-settlement-http.log`.
- API/web typechecks, contracts/API builds and diff check passed. Final API typecheck after smoke-fixture updates: `/tmp/mangmee-trial-api-types-final.log`. No package.json/dependency changes.
- Providers are simulated at the boundary (Stripe/Postmark/LINE), not native-provider or production validation. Counts above overlap and must not be summed as unique cases.
- Applied only the new migration to local test and UX databases. API3001 restarted and health200. No cloud changes, push, PR, merge or deployment.

### Reproducible checks and limits

The ignored local wrapper loads credentials without printing them. `/tmp/mangmee-billing-test-env.py` restricts these smoke runs to the dedicated localhost `watchdog_postmark_ci` database. Run the compiled `apps/api/dist/apps/api/src/scripts/billing-http-smoke.js` with that wrapper and one mode:

- `BILLING_BROWSER_E2E=1 BILLING_TRIAL_CARRYOVER_ONLY=1`
- `BILLING_BROWSER_E2E=1 BILLING_PLAN_CHANGE_ONLY=1`
- `BILLING_BROWSER_E2E=1 BILLING_CUSTOMER_JOURNEYS_ONLY=1`
- `BILLING_CONFIG_ONLY=1 BILLING_BROWSER_E2E=1 BILLING_OFFER_MATRIX_ONLY=1`
- `BILLING_CONFIG_ONLY=1 BILLING_OFFER_TERMS_ONLY=1`
- `BILLING_CONFIG_ONLY=1 BILLING_SETTLEMENT_ONLY=1`

The broad browser harness stopped on existing admin-only locators (settings reauthentication, quota toggle and resolved-case provider-event action) that no longer match those screens. Those admin UI suites are not certified by this work; customer mode isolates the requested entrepreneur journeys and still checks quota API behavior. The broad backend run reached offer terms after configuration/refund/admin scenarios, then failed an obsolete balance expectation. Its offer-terms and all-offer matrix subcases were updated for the approved trial bonus and rerun successfully; the entire broad backend command was not rerun. Keep these limits distinct from the passing customer E2E evidence.
