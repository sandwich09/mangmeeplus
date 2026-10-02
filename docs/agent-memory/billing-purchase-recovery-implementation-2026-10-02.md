# Agent Memory: billing-purchase-recovery-implementation-2026-10-02

Status: Confirmed purchase/status/recovery repairs implemented and verified locally; owner authorized merging into main and develop, no deployment.
Owner: Codex / Thawatchai
Scope: User authorized broad simulated purchase E2E, gap/dependency impact analysis, implementation of confirmed defects, and verification after changes.
Decisions:
- Worktree `/Users/thawatchai/.codex/worktrees/billing-purchase-recovery/mangmeeplus`, branch `codex/billing-purchase-recovery-20261002`. Audit context used main `f20a1101e6ef5a827b2054eaa887c6cbbd984826`; actual branch base is `d2b67b87247afaf856c3d260c1b25226cb1ea5d3` (billing/auth/workspace files unchanged between these refs). Primary checkout remains untouched.
- Follow Ponytail full from the current repo skill (legacy absolute skill location is stale); reuse real billing HTTP/browser harness and installed dependencies. No package.json edits.
- Task-owned local DB/Redis only; provider transports simulated. Existing manual/security/financial/tenant fences remain.
Open questions: None blocking scoped repairs. Financial policy is unchanged; future uncertain policy findings must be separated from code defects.
Artifacts: `docs/plans/billing-purchase-recovery-audit-2026-10-02.md`; preceding read-only diagnosis remains in the primary checkout.
Verification:
- Dependencies installed offline with frozen lockfile; contracts/config built; existing 273 migrations applied to task-owned local PostgreSQL 18.3 and Prisma generated. Redis is also task-owned.
- Baseline focused unit suites: 92 passed, no skips. Baseline real HTTP/database/browser recovery probes: 7 passed / 15 desired-behavior failures, after removing fixture-only invalid upgrade history and wrong button selector. Logs `/tmp/billing-recovery-red2-20261002.log`.
- First repaired HTTP/PG/Chromium suite: 21/22 passed; remaining expectation assumed the overview returned instead of the preserved chooser. Corrected this assertion to require an enabled purchase card and unchanged billing URL.
- Repaired mobile HTTP/PG/Chromium run: 22/22 passed, `/tmp/billing-recovery-final-20261002.log`; expanded gate/admin-Checkout suite 25/25 passed. Final focused acceptance: **30/30 groups passed**, `/tmp/billing-recovery-release7-20261002.log`, exit 0. Evidence directory `/tmp/billing-recovery-release7-browser-20261002`; includes full/differential BASIC review, explicit consent without automatic payment, queued focus, delayed status, expired modes, history 503/pending and permission-denial ordering.
- Focused backend suites: 94 passed, no skips; frontend fetch/billing/workspace suites: 50 passed, no skips; PostgreSQL source/capacity suites: 2 passed, no skips.
- API/web/contracts typechecks passed after allocating 8 GiB to the API typechecker (default heap exhausted); API/contracts/config builds passed. Final web checks/typecheck passed after independent history loading and request-order fencing.
- Full API/database dependency run: **266 groups passed**, `/tmp/billing-recovery-dependencies-http8-20261002.log`, exit 0. Verified financial retries, refund/end, scopes/authority, capacity/defaults, feature menus, quota/OCR, recipient delivery, provider callbacks and audits.
- An intermediate parallel pair of full harnesses shared SYSTEM_ADMIN role grants and invalidated cleanup assertions. That run is excluded; the 266-group acceptance ran alone.
- Broad baseline/retake exposed fixture drift: background leases update updatedAt while financial/version/source fields are unchanged; postal-code edits intentionally clear dependent address fields; manual hold text now explicitly identifies admin hold; ENTERPRISE is now a valid paid tier; isolated owners need explicit company.plan.manage; capacity suspension invalidates current bound LINE context (anonymous legacy rows are intentionally cleared). Corrected assertions/input order, retaining state/financial assertions.
- Local fixtures and simulated provider transports only. No real payment, customer mutation or cloud deployment.
- Customer HTTP/PG/Next/Chromium acceptance: **113 groups passed**, `/tmp/billing-recovery-customer3-browser-20261002.log`, exit 0, after independent history loading. Includes quote/consent/Checkout, verified apply/unlock, documents/LINE, repeat, refund, restart, capacity/menus/quota, billing operations and runtime gate close/reopen. Final permission-order guard is covered by the subsequent 30-group focused acceptance.
- Separate no-setup one-time Checkout/apply/recipient/mail/OTP acceptance: **7 groups passed**, `/tmp/billing-recovery-one-time-no-setup-final-20261002.log`, exit 0.
- Additional late gap reproduced: an unresolved history request kept the purchase entry hidden even with ready status/catalog. Baseline pending-history probe failed in `/tmp/billing-recovery-history-delay-red-20261002.log`; independent loading fixed it. 401/403 remain closed, and older permitted reads cannot repopulate data after a newer denial.
- Purchase expiry fixtures now update invoice/grant serviceEnd/expiresAt together. The earlier added browser upgrade failure was inconsistent synthetic history; financial history guards remain unchanged.
Next: Merge the reviewed patch into main and develop via scoped PRs and verify both remote branch heads contain the repair. Any UAT/Production release must follow the mandatory deployment protocol in a separate authorized release task.

- Browser admin configuration follow-up: policy publication/VAT/reversion path now follows the current topic selector, draft and reauthentication UI. The broader admin draft browser fixture still assumes removed selectors/links in `billing-configuration-drafts-smoke.ts:69`; no product defect was established there. Full admin browser traversal is not claimed.

## Reproduction and verification commands

Run from the worktree root. Tests used task-owned local PostgreSQL/Redis, all 273 existing migrations, and simulated transports. Counts overlap between suites.

```sh
export BILLING_TEST_DATABASE_URL=postgresql://watchdog:watchdog_local_test@127.0.0.1:15497/watchdog_postmark_ci
export REDIS_URL=redis://127.0.0.1:16497
corepack pnpm --filter @watchdog-bms/api build
node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
BILLING_CUSTOMER_JOURNEYS_ONLY=1 BILLING_BROWSER_E2E=1 BILLING_BROWSER_EVIDENCE_DIR=/tmp/billing-recovery-customer3-browser-20261002 node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
BILLING_PURCHASE_RECOVERY_ONLY=1 BILLING_BROWSER_E2E=1 BILLING_BROWSER_EVIDENCE_DIR=/tmp/billing-recovery-release7-browser-20261002 node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
BILLING_NO_SETUP_ONLY=1 node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
NODE_OPTIONS=--max-old-space-size=8192 corepack pnpm --filter @watchdog-bms/api exec tsc --noEmit
corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit
corepack pnpm --filter @watchdog-bms/api exec tsx --tsconfig tsconfig.json --test src/modules/billing/application/billing-purchase-source.spec.ts src/modules/billing/application/billing-restart.spec.ts src/modules/billing/application/billing-end-package.spec.ts src/modules/billing/application/billing-collection.spec.ts src/modules/billing/domain/billing-package.spec.ts src/modules/auth/auth.guard.spec.ts src/modules/access-control/permission-resolver.spec.ts
corepack pnpm --filter @watchdog-bms/web exec tsx --test src/common/api/authed-fetch.spec.ts src/features/billing/BillingPage.qa.spec.ts src/features/billing/billing-error-text.spec.ts src/features/web-core-workspace/workspace-layout.qa.spec.ts
corepack pnpm --filter @watchdog-bms/api exec tsx --tsconfig tsconfig.json --test src/modules/billing/application/billing-purchase-source.pg.spec.ts
git diff --check
```

Unit logs: `/tmp/billing-recovery-unit-green-20261002.log` (94), `/tmp/billing-recovery-web-final-tests-20261002.log` (50), `/tmp/billing-recovery-pg-tests-20261002.log` (2). Final typecheck/build logs: `/tmp/billing-recovery-api-final-typecheck-20261002.log`, `/tmp/billing-recovery-web-final-typecheck-20261002.log`, `/tmp/billing-recovery-api-final-build-20261002.log`.

Final handoff:
- Final API/web typechecks and `git diff --check` passed, exit 0. No manifest/lockfile/dependency changes.
- Visually inspected the mobile purchase blocker, recovered purchase, upgrade review and full BASIC review/consent captures. Customer/downgrade evidence retained under `/tmp/billing-recovery-customer3-browser-20261002`.
- Restored only harness-generated `apps/web/next-env.d.ts` and the overwritten historical downgrade screenshot, preserving the new screenshot in the temporary evidence directory.
- Removed task-owned `billing-recovery-pg-20261002` and `billing-recovery-redis-20261002` containers after checks. Primary checkout/services and other tasks' Next servers are untouched. Recreate local DB/Redis and apply the existing migrations before rerunning database scenarios.
- The owner subsequently authorized commit/merge into both main and develop. Integration preflight: origin/main `d2b67b87247afaf856c3d260c1b25226cb1ea5d3`, origin/develop `603f461ddc8c0783092ff41e7572378990150e11`; complete trees match, histories differ. Prepare a develop integration branch so each PR shows only this scoped patch, retaining the original repair commit in both histories. PR CI is automatic; deploy workflows require explicit dispatch, which is outside this request.
