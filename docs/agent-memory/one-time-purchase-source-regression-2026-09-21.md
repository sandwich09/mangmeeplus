# Agent Memory: One-time purchase source regression

Status: Implementation and verification are complete. On 2026-09-21 the owner authorized admin merges to `develop` and `main`, followed by UAT deployment. Release identifiers and acceptance result are pending.
Owner: Codex
Scope: Restore purchases for valid one-time paid terms, support package and interval changes while a one-time term is active, close collection and reconciliation gaps, and verify related billing journeys across API, web, database, and browser layers.

Decisions:

- A valid `CARD_ONCE` or `PROMPTPAY_ONCE` term has no base subscription. Its source proof must match the account's exact `contractAttemptId`, an `APPLIED` paid invoice, its `appliedAt`, and the same `periodEnd` as `paidThrough`. Malformed or unrelated payment mappings fail closed.
- A transitional `PROMPTPAY_RENEW` source without a subscription is accepted only while `activeAttemptId === contractAttemptId` and the exact paid invoice is already applied.
- Repeating the same package and interval during an active one-time term charges the full price, grants the full quota immediately, and extends the existing paid-through date.
- A same-interval upgrade charges the prorated price difference, grants the prorated quota after verified payment, applies the target package immediately, and preserves the existing paid-through date.
- A downgrade or interval change charges the full target price now, keeps current package rights until the old paid-through date, then applies the prepaid target package and extends the term by the target interval.
- While a one-time term is active, checkout allows `CARD_ONCE` and `PROMPTPAY_ONCE`. Automatic card or PromptPay renewal becomes available after expiry.
- A paid prepaid transition cannot be withdrawn. If capacity has drifted before the transition becomes due, reconciliation blocks safely with `BILLING_CAP_SELECTION_REQUIRED`; the owner can provide a fresh compatible selection and reconciliation applies the already-paid transition once without a second payment.
- Package rights are reconciled to the purchased package. Company-specific administrator grants remain separate.
- The billing page distinguishes the current package end date, the prepaid target package, its effective date, and its final paid-through date.

Open questions: None for this scope. A paid administrator deal moving to a catalog package remains a separate product policy.

Artifacts:

- `apps/api/src/modules/billing/application/billing-purchase-source.ts`
- `apps/api/src/modules/billing/application/billing-purchase-source.spec.ts`
- `apps/api/src/modules/billing/application/billing-purchase-source.pg.spec.ts`
- `apps/api/src/modules/billing/application/billing.service.ts`
- `apps/api/src/modules/billing/application/billing-reconciler.service.ts`
- `apps/api/src/modules/billing/application/billing-schedule.ts`
- `apps/api/src/modules/billing/application/billing-collection.ts`
- `apps/api/src/modules/billing/application/billing-collection.spec.ts`
- `apps/web/src/features/billing/BillingPage.tsx`
- `apps/web/src/features/billing/BillingCollectionPanel.tsx`
- `apps/web/src/features/billing/BillingPreviewPage.tsx`
- `apps/web/src/features/billing/billing-preview.fixture.ts`
- `packages/contracts/src/billing.ts`
- `packages/contracts/src/billing-labels.ts`
- `e2e/billing-preview.spec.ts`
- `docs/specs/billing-promptpay-qr-spec-th.md`

Verification:

- Contracts build: passed.
- API TypeScript check: passed.
- Web TypeScript check: passed.
- Billing unit suite excluding PostgreSQL specs: 79 passed, 0 failed.
- Auth and plan-term non-PostgreSQL regression suite: 621 passed, 0 failed.
- Web unit suite: 1,863 passed, 0 failed.
- PostgreSQL source, quote, checkout, prepaid transition, capacity repair, and idempotency integration spec: 2 passed, 0 failed.
- Browser E2E `e2e/billing-preview.spec.ts`: 2 passed at 1280 px and 390 px. Covered active one-time mode selection, immediate upgrade, scheduled downgrade, monthly-to-annual prepaid change, paid pending state, blocked capacity repair, and existing automatic-renewal flows.
- Customer billing HTTP/PostgreSQL/Chromium provider-simulation smoke: passed across profile, tenant, checkout replay, signed webhook, apply/repair, notifications, documents, collection, repeat/restart, refund/dispute, upgrade/downgrade, capacity, quota, and admin AI paths.
- Provider smoke used simulated Stripe, Postmark, and LINE integrations; no real payment was made.
- `git diff --check`: passed after removing generated test artifacts.

Next: Create one exact reviewed candidate, merge it to `develop` and `main` after required CI, then deploy that candidate to UAT under the mandatory release protocol and record the terminal signed result.
