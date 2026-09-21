# Agent Memory: One-time purchase source regression

Status: Complete on UAT. The implementation was admin merged to `develop` and `main`; exact-source Kamal deployment, signed acceptance, and the changed billing journey passed on 2026-09-21.
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

Release:

- Reviewed application candidate: `230ea6c4e1eae0fb842049793ae9bf22bee4dfb5`.
- Develop PR [#683](https://github.com/MangmeeDev/mangmeeplus/pull/683), merge `2baec4ff6fac188d20ac6a44d5562015d95d44d4`; exact candidate CI `35575538065` passed.
- Main PR [#684](https://github.com/MangmeeDev/mangmeeplus/pull/684), reviewed integration head `7d1dc7456cff53babfff838996dcb551f4407c23`, merge `b586a588aca07e125ac42f98a3688639e07ffc3c`; integration CI `35575863795` passed.
- Candidate `230ea6c4e1eae0fb842049793ae9bf22bee4dfb5` is an ancestor of both `origin/develop` and `origin/main`.
- UAT used the current Kamal path. GitHub UAT/READY/Production workflow IDs are `NOT_DISPATCHED`.
- Read-only UAT preflight `20260921T080931Z-58b04565` passed.
- UAT operation `20260921T080950Z-db54bc95` deployed exact main source `b586a588aca07e125ac42f98a3688639e07ffc3c` and finished `ACCEPTED_LINE_DEFERRED` in 1,472.28 seconds. All 11 phases passed; API/DB, AI Gateway, Workers/Redis/internal API, config readback, customer `OPEN`, build retirement, and KMS ECDSA signature verification passed. AgentCore `kamal_uat_a` is version 17 on the exact source.
- An earlier read-only preflight `20260921T080803Z-1f15a73b` failed before mutation because the current operator public IP was absent from both UAT SSH allowlists. Exact temporary `/32` rules `sgr-06d40b953574c3c6f` and `sgr-05549553d09db8eef` enabled the accepted operation and were revoked afterward; absence and no active operation were read back.
- Fresh authenticated UAT browser acceptance after deployment confirmed the package selector returned for the active one-time Starter account. Starter to Basic monthly quoted a ฿248.89 prorated difference, immediate rights, unchanged paid-through, and 19 additional receipts. Starter monthly to annual through PromptPay once quoted ฿2,490 prepaid, retained current rights through 21 October 2026, and showed the target end date 21 October 2027. Selecting card auto-renew showed the intended active-one-time explanation and disabled package checkout. No new payment attempt was created.

Operational gap:

- Kamal still reaches UAT through direct public SSH and source-IP allowlists. The two UAT instances are not registered as Systems Manager managed instances; their runtime roles have no SSM core policy, the deploy role cannot query/start SSM sessions, and current target validation assumes an IP address even though `sshProxyCommand` exists.
- Permanent remediation is a reviewed infrastructure change: enable and persist the SSM agent, add least-privilege instance and deploy-role session permissions, route Kamal SSH through Session Manager, prove deploy and recovery through that path, then remove public TCP 22 rules. This was not changed during the accepted application release.

Next: Product change is complete on UAT. Track the SSM transport remediation separately before the next release that would otherwise need another temporary operator-IP rule.
