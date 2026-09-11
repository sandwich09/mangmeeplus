# Stripe preparation — executed repair and proof loop, 2026-09-11

**S-pre COMPLETE / LOCAL PASS. Stripe integration NOT IMPLEMENTED; provider E2E NOT RUN.**

This closes the existing-access defects found in the [original red run](../stripe-readiness-2026-09-11/README.md) and the pre-LIVE marketing mismatch. Spec → implementation → DB/API/browser proof → updated plan is complete for this scope. It does not claim that Mangmee can collect a card payment yet.

Run ID: `2026-09-11T04:16:04.681Z` (11:16 Bangkok). Local web `:3020`, API `:3021`, PostgreSQL `:15432`, Redis `:6379`. Existing services on other ports were preserved. Both worktrees are dirty: use [source hashes](source-sha256.json) with the HEAD revisions in [results-summary.json](results-summary.json), rather than treating HEAD alone as the tested source.

| Layer | Final result | Evidence |
|---|---:|---|
| Real browser → BFF/API → PostgreSQL | **20 passed, 0 failed/skipped/flaky** | [suite](https://github.com/MangmeeDev/mangmeeplus/blob/2d52b4b249c18c61da44aab2e79fbdeda58afcd9/e2e/plan-term-billing-readiness.spec.ts), [output](browser-output.txt) |
| Real PostgreSQL concurrency/crash/replay | **15 passed, 0 failed** | [suite](recovery.pg.spec.ts), [output](postgres-output.txt) |
| Focused existing unit suites | **198 passed, 0 failed** | [output](focused-output.txt) |
| Actual sibling marketing bundle in Chromium | **1440px and 390px PASS** | [runner](https://github.com/MangmeeDev/mangmeeplus/blob/2d52b4b249c18c61da44aab2e79fbdeda58afcd9/e2e/stripe-marketing-readiness.mjs), [output](marketing-output.txt) |
| API/web production-source TypeScript | **PASS / PASS** | Reproducible configs and commands below |
| Full API TypeScript, including all specs | **Not clean: 2 unrelated existing errors** | `substitute-receipt-download.use-case.spec.ts:376,381`, Buffer/ArrayBufferLike in the pre-existing expense work; no billing production-source errors |
| Stripe SDK / Checkout / signed webhook / invoice apply | **NOT IMPLEMENTED / NOT RUN** | S0–S5 and RG06/T01–T42 remain open |
| UAT/Production/charge/lead submission | **NOT RUN** | No cloud/account/deployment operation or external message |

## What changed and what the tests prove

| Repair | Actual behavior and proof |
|---|---|
| R01 + R05 | Company row lock serializes term changes. Term, lifecycle activation and audit commit together. A failure after lifecycle SQL rolls everything back; a retry succeeds once. Eight same-key calls create one renewal/audit; different days conflict; different keys accumulate both periods. Lost-response replay does not extend twice. |
| R03 | Sweep selects candidates, then locks and reads current state. A renewal or SUSPENDED/ARCHIVED hold after SELECT prevents a stale disable/notice. Concurrent admin disable + renewal ends held. A repeated admin DISABLED command clears the old term marker. Concurrent sweeps produce one transition/event. Set limits and renewal both survive a race. |
| R07 | Term claim and existing NotificationEvent/Recipient/Delivery queue writes share a transaction. Injected delivery-insert failure after event creation rolls back claim/event/recipient; retry creates all durable rows. Partial old recipient/delivery state is repaired during cooldown without a second business event. Current-period checks suppress stale warning production. Existing delivery-worker unit tests remain green. |
| R02 + R06 | Authenticated method/path recovery allowlist resolves the selected term-disabled company. Password login works for an account with only that company. Legal acceptance still applies and can be completed while expired. Business APIs, foreign/revoked memberships and admin/security holds remain denied. OWNER cannot call admin renewal. Staff sees neutral recovery copy. |
| R06 UI | `companyId` is passed from the route. JSON null means no term; 401/403/500/network errors have separate UI and retry. Slow company A response cannot overwrite B; back/refresh retains the selected company. Desktop and 390px mobile controls work, including keyboard retry. |
| R04 | Marketing has one FREE_TRIAL section (30 days from activation, 1/2/15) and four paid offers with exact catalog values. Paid buttons have actual DOM `disabled=true` and an accessible explanation. Trial request modal opens with Enter/closes with Escape while external network is blocked. JSON-LD no longer says InStock; FAQ does not promise unapproved cancellation/refund terms. |

BR01 makes a real branch creation through the browser after simulated payment, then checks DB rows, limits, quota usage, roles and the other company. A forged `payment=success` URL and a simulated decline leave access blocked. The test driver uses the **existing authenticated system-admin manual-renew API**; it substitutes only the decision to renew. This is not an invoice/payment ledger, provider signature test, recurring charge or automatic Stripe paid-period application. Manual renewal retains `max(now, termEndsAt) + days`; a future Stripe adapter must apply the verified invoice service period instead.

Notifications here prove durable local intent and replay, not exactly-once LINE/email delivery. The normal worker owns post-commit delivery/retry; no external delivery was invoked. [Legacy recovery SQL](inspect-legacy-recovery.sql) is read-only, reports future-term/DISABLED mismatches with audit pointers, and never approves activation. Its fixture verifies that a later admin hold is flagged for review. No live or legacy customer repair was performed.

## Screens checked

- [Expired OWNER, mobile](mobile-recovery.png), [single-company password login recovery](single-company-recovery.png).
- [Before simulated payment](before-renew.png), [after real browser write](after-renew-write.png), [reactivated company](reactivated.png).
- [Marketing desktop](pricing-1440.png), [marketing 390px](pricing-390.png), [trial request modal](trial-390.png).

The marketing runner waits for the real splash animation to disappear and pricing cards to finish revealing. It inspects native disabled state; an empty boolean attribute was initially dropped by the bundle renderer, so the template now binds `disabled="{{ true }}"`. Screens were visually inspected after the final run. The request modal is the existing lead flow, not proof of app signup/approval/provisioning; it was never submitted.

## Reproduce

Run from `mangmeeplus` with installed workspace dependencies, local seeded PostgreSQL and Redis, and the sibling `mangmee_web` checkout. The test fixtures require the existing seed OWNER/SYSTEM_ADMIN and roles. Do not reset a shared database. Every browser/PG fixture requires loopback URLs and cleans only its generated IDs.

```sh
export DATABASE_URL='<existing local test PostgreSQL URL on 127.0.0.1:15432>'
DATABASE_URL="$DATABASE_URL" node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec docs/evidence/stripe-repair-2026-09-11/recovery.pg.spec.ts

REDIS_URL='redis://127.0.0.1:6379' API_PORT=3021 WEB_PORT=3020 \
E2E_API_BASE_URL='http://127.0.0.1:3021/v1' E2E_WEB_BASE_URL='http://127.0.0.1:3020' \
NEXT_DIST_DIR='.next/billing-repair-3020' MODEL_PROVIDER=disabled \
PLAYWRIGHT_JSON_OUTPUT_FILE='test-results/stripe-repair-2026-09-11/results.json' \
corepack pnpm exec playwright test e2e/plan-term-billing-readiness.spec.ts \
  --project=chromium --workers=1 --retries=0 --timeout=90000 \
  --output=test-results/stripe-repair-2026-09-11 --reporter=list,json

node e2e/stripe-marketing-readiness.mjs

NODE_OPTIONS='--max-old-space-size=12288' corepack pnpm exec tsc -p docs/evidence/stripe-repair-2026-09-11/api-production.tsconfig.json --noEmit
NODE_OPTIONS='--max-old-space-size=12288' corepack pnpm exec tsc -p docs/evidence/stripe-repair-2026-09-11/web-production.tsconfig.json --noEmit
```

`MANGMEE_WEB_ROOT` can point the marketing runner to a different local checkout. It serves the actual bundle on an ephemeral loopback port and aborts external requests. It never posts a lead or payment.

```sh
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec \
  apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.spec.ts \
  apps/api/src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case.spec.ts \
  apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.spec.ts \
  apps/api/src/modules/access-control/permission-resolver.spec.ts \
  apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts \
  apps/api/src/modules/auth/auth.guard.spec.ts \
  apps/api/src/modules/auth/auth-endpoints.spec.ts \
  apps/api/src/modules/auth/application/legal-acceptance.service.spec.ts
```

## Verification limits and cleanup

- Original red evidence is unchanged. Intermediate repair runs exposed the separate legal-acceptance query and empty-null HTTP response; both are fixed and included in the final 20/20 run. An old Next output directory also served stale 404 routes; the isolated repair output directory removed that environment issue without relaxing BR01/BR02.
- The added legal-recovery test first attempted to remove acceptance evidence; PostgreSQL correctly rejected deletion of append-only legal records. The final fixture starts with a new account that has not accepted terms. No trigger/policy was bypassed.
- Final generated `e2e-billing-*` companies/users/notification events/audit rows: **0 / 0 / 0 / 0**. **44 immutable legal action records remain** in the local DB by design (scalar evidence survives fixture deletion). This is not a claim that every test-related row was erased.
- Raw traces/results under ignored `test-results/` can contain local auth details and were not promoted. This directory contains sanitized summaries/logs/screens and source hashes. No package.json, dependency, database schema, deployment or Stripe configuration change. Generated `apps/web/next-env.d.ts` route import was restored after the runner.
- Full API typecheck required a larger heap and reports only the two pre-existing expense-spec Buffer errors noted above. Production-source API/web configs pass; this is scoped verification, not a whole-repository clean-build claim.
- Stripe business decisions B01–B10, account/SDK/API-version configuration, Checkout/Portal, signed webhook/invoice application, sandbox/provider E2E, fees/tax/refund operations and LIVE acceptance remain in the [implementation plan](../../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md). None is promoted to PASS by this report.
