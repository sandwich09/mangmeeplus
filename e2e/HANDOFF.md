# E2E Test Harness — Handoff to Codex CLI

**Role split:** This document + [`TEST-CASES.md`](./TEST-CASES.md) are authored by the harness engineer (Claude).
**You (Codex CLI) are the executor:** implement each test case as a Playwright spec, run it on localhost, triage failures, and report. Do not redesign the harness — extend it.

**Target:** Full-system E2E of WatchDog-BMS on localhost using Playwright (`@playwright/test`), against the seeded local stack (web `:3000`, API `:3001`, native postgres `:5432`).

---

## 1. Mission & definition of done

Implement and pass the test cases in [`TEST-CASES.md`](./TEST-CASES.md), grouped by priority:

- **P0 (blocking):** every "ready" module renders under real auth with no client error; core write flow (create → verify) works for inventory, expenses, accounting, reports. Auth/login works and is enforced.
- **P1 (core):** the primary journey of each ready module (list → open → mutate → assert backend truth via the `api` fixture).
- **P2 (breadth/edge):** planned-module placeholders, i18n toggle, permission-negative, loading/empty/error states, logout.

**Done =** P0 + P1 green in a clean run, results reported in the format of §7, every failure either fixed (if harness/test defect) or filed as a product bug with a trace (§6). Do not mark done with unexplained red or skipped P0/P1.

---

## 2. Harness-engineer principles (follow these)

1. **Deterministic before clever.** Same seed, same ports, same auth every run. If a test needs data, it reads the known seed (§4) or creates its own with a unique suffix — never depends on a previous test.
2. **One source of truth for the tricky parts.** Auth, base URLs, company id, and fixtures live in [`harness/`](./harness/). Import from there; do not re-implement cookie chunking per spec.
3. **Navigate by URL, assert by role.** The UI default locale is **Thai**; nav labels are Thai. Move between modules with `page.goto(...)`, not by clicking localized nav text. Assert on `getByRole('heading'|'button'|'link', { name: /…/ })` with a `th|en` regex where text may be localized.
4. **Every navigation carries an invariant.** Call `expectNoClientError(page)` after each load. A page that "renders" while flashing `Unauthorized` is a failure.
5. **Prove backend truth, not just pixels.** For write flows, assert the UI *and* re-read via the `api` fixture (or check the audit log / list endpoint). UI-only green hides broken contracts.
6. **Isolation & idempotency.** Mutations use a per-test unique token (e.g. `E2E-${testInfo.title}-${Date.now()}` — but note `Date.now()` is fine in specs, only forbidden inside Workflow scripts). Prefer creating disposable records over editing seed records.
7. **Quarantine, don't delete.** A test that fails for an environment reason you cannot fix gets `test.fixme()` with a one-line reason + the blocking dependency, and is listed in the report. Never silently skip.
8. **No silent caps.** If you cover fewer cases than the catalog, say which and why in the report.

---

## 3. Environment contract & bring-up

### Known-good topology (verified at handoff)
| Service | Where | Port | State at handoff |
|---|---|---|---|
| Postgres (**seeded**) | native | **5432** | UP, has `seed-local-company` |
| Redis | native/docker | 6379 | DOWN (optional — see below) |
| MinIO / S3 | docker | 19000 | DOWN (needed only for upload tests) |
| API (NestJS) | from source | 3001 | booted by Playwright `webServer` |
| Web (Next.js) | from source | 3000 | booted by Playwright `webServer` |

Playwright's `webServer` (in `playwright.config.ts`) **builds and boots the API and web from source** automatically and waits on `/health`. You do **not** start them by hand. It only needs the infra (DB/Redis) to already be up.

### ⚠️ Landmines (these will burn you — the runner handles them)
1. **DB port mismatch.** `.env` → `15433`, `.env.example` → `15432`, `playwright.config.ts` default → **`5432`**. The **seeded** DB is the native one on **5432**. **Do not `source .env`** for the test run, or `DATABASE_URL` will point at a dead docker port and the API will boot but every query 500s. Use [`run-local.sh`](./run-local.sh) which pins `5432`.
2. **Default locale is Thai.** Assert with `th|en` regexes. `getByRole('button', { name: /สร้างใหม่|generate/i })`.
3. **Nav "Coming Soon" ≠ dead route.** Some modules show a *planned* badge in the nav but their URL still renders a working page (e.g. `/accounting`). Test the route by URL; test the badge separately.
4. **No docker at handoff.** `docker` CLI was unavailable. Redis is only used by the line-ai ledger feature (not at boot), so the suite runs without it. Upload-dependent tests (expense receipt, attachments) need MinIO — quarantine them (`test.fixme`) unless you bring MinIO up.

### One-command run
```bash
e2e/run-local.sh                 # preflight (DB+seed+redis) then full suite
e2e/run-local.sh --grep @smoke   # P0 smoke only — run this FIRST to prove the rig
e2e/run-local.sh --grep @p1      # core flows
e2e/run-local.sh e2e/inventory.spec.ts   # one suite
```
First run rebuilds api/web (~2 min) before the first test. Reuse is on for non-CI (`reuseExistingServer`), so subsequent runs are fast.

### Two runs at once (same checkout)
```bash
API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020 e2e/run-local.sh e2e/login.spec.ts &
API_PORT=3023 WEB_PORT=3022 NEXT_DIST_DIR=.next/e2e-3022 e2e/run-local.sh e2e/login.spec.ts &
```
The API side isolates itself: build output goes to `apps/api/dist/e2e-<API_PORT>`
(override with `API_DIST_DIR`). Without it, both runs compile into the same `dist` while
the other run's `main.js` is still being loaded from it, and the half-written files crash
NestJS DI at boot (`Cannot read properties of undefined (reading 'name')` in `addController`).

**`NEXT_DIST_DIR` is yours to pass, and only for a second concurrent run.** It is
deliberately not defaulted per-port in `playwright.config.ts`: `next dev` rewrites the
*tracked* `apps/web/next-env.d.ts` to import route types from its distDir, and a deploy
ships the dirty tree. Nest it under `.next/` (never a sibling `.next-*`, which un-ignores it
and poisons Tailwind's source scan), and restore the file afterwards:
`git checkout -- apps/web/next-env.d.ts`.

Each new dist dir pays one cold compile. Two caveats: both runs share the seeded DB and the
seeded OWNER, so suites that log in and out interfere — prefer running *different* specs in
each. And two Next dev servers plus two API servers is memory-hungry; under pressure macOS
SIGKILLs them (`Killed: 9` in the `[WebServer]` output), which looks like a test failure but
is not one.
Without that, both runs compile into the same `dist` while the other run's `main.js`
is still being loaded from it, and the half-written files crash NestJS DI at boot
(`Cannot read properties of undefined (reading 'name')` in `addController`).
Each new port pays one cold compile; after that its cache is warm.


### Manual bring-up (only if you skip the runner)
```bash
# from repo root (WatchDog-BMS)
export DATABASE_URL='postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_bms?schema=public'
psql "$DATABASE_URL" -tAc "select id from \"Company\" where id='seed-local-company'"  # must print 1 row
# (re-seed if empty): cd apps/api && DATABASE_URL="$DATABASE_URL" corepack pnpm exec tsx prisma/seed.ts
corepack pnpm exec playwright test --grep @smoke
```

### The billing browser specs only run locally — and only with these three values

`billing-admin-menu-ux.spec.ts` (12 tests) and `billing-admin-directory.spec.ts` (5) skip
themselves on a default run, so they are silent everywhere: **no GitHub workflow runs them.**
`.github/workflows/ci.yml` invokes Playwright exactly once, for
`e2e/line-signup-contact-email.spec.ts`, and it never sets `BILLING_MODE` or `STRIPE_ACCOUNT_ID`.
Run them by hand when you touch `/system/billing/*`:

```bash
# A database of its own: the specs assert the NAME, not just the host.
export DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:5432/mangmee_ux?schema=public'
export BILLING_MODE=test          # packages/config enum is disabled|test|live; `live` is used nowhere
export STRIPE_ACCOUNT_ID=acct_TESTONLYLOCAL   # must match /^acct_[a-zA-Z0-9]+$/ — synthetic, no key exists
corepack pnpm exec playwright test e2e/billing-admin-menu-ux.spec.ts e2e/billing-admin-directory.spec.ts \
  --project=chromium --retries=0
```

- `mangmee_ux` is not optional: `billing-admin-menu-ux.spec.ts:29` and
  `billing-admin-directory.spec.ts:206,395` assert `url.pathname === '/mangmee_ux'`, and a
  `beforeAll` that trips that assert strands the other 11 tests in the file.
- `BILLING_MODE=test` must reach the **API**: with billing `disabled` the admin pages read no
  issues, settings or documents (5 of the 12 `billing-admin-menu-ux` tests fail, 2026-10-04). In the
  test process it also opens the `billing-admin-directory` issue-queue suite (`billing-admin-directory.spec.ts:119`).
- Migrate and seed that database like any other (`prisma migrate deploy` → `prisma/seed.ts` →
  `prisma/sync-feature-launch-gates.ts`); the specs create and delete their own companies.
- No Stripe request can succeed here and none is made: `STRIPE_SECRET_KEY` stays unset and the
  specs only need the id to match the `BillingAccount.stripeAccountId` rows they insert.

### `plan-term-billing-readiness.spec.ts` needs the LINE web handoff switched on

Start the **API** with `LINE_WEB_HANDOFF_ENABLED=true LINE_LIFF_ID=1234567890-test` (synthetic, as
in `docs/evidence/stripe-line-web-gap-2026-09-11/README.md`). Without them the handoff exchange
answers a bare 403 ("LINE login is not enabled."): BC03 lands on `/login?line=handoff-expired`,
GW02 shows "เปิดหน้าเว็บไม่สำเร็จ", and the GW04 rechecks fail on their `targetPath` assertion.

---

## 4. Fixtures, auth & seed data

### Auth (already solved — use it)
- **UI tests:** use the `authedPage` fixture. It POSTs the web BFF `/api/auth/dev-login`, which mints a real cookie session for the seeded **OWNER**. The page it hands you is logged in.
- **API tests:** use the `api` fixture — an `APIRequestContext` with `Authorization: Bearer <dev token>` + `X-Company-Id: seed-local-company` baked in (the API requires the company header for non-path-scoped calls).
- **Real login form** (for LOGIN-* cases): `#login-identifier` (name `username`), `#login-password` (name `password`), submit button `name: /เข้าสู่ระบบ|Sign in/`. Seeded creds below.

```ts
import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
// authedPage, api, companyId, urls are injected. See e2e/_reference.spec.ts.
```

### Seeded identities (`apps/api/prisma/seed.ts`)
| Purpose | Username | Password | Notes |
|---|---|---|---|
| Owner (full access) | `Owner` | `Owner@12345` | default dev-login identity |
| Company view (limited) | `Company` | `Company@123` | use for permission-negative cases |
| System admin | `thawatchai.watchdog` | `watchdogbms11` | `/system/*` routes |

### Seeded business data (deterministic — assert against these)
- Company `seed-local-company` ("WatchDog Local Company"), a **Room45 Eyelash salon** dataset.
- 3 branches: `SIAM`, `AREE`, `THONG`.
- 4 staff: มายด์/`SALES`, ไนซ์/`MANAGER`, แพรว/`SALES`, เตย/`SALES`.
- 14 CRM customers (`คุณพิม ชนกานต์`, `คุณจอย รุ่งเรือง` VIP, …) with conversations, deals, tasks, bookings across statuses NEW/OPEN/WAITING/RESOLVED/FOLLOW_UP.
- Products, accounting docs, expenses, workflow templates, CRM pipeline stages are seeded too — open the module and read the list; don't hardcode counts you haven't verified (seed may grow).

---

## 5. Module map (route → status → test depth)

Depth key: **FLOW** = full P0+P1 journey; **SMOKE** = renders + no client error (planned placeholders).

| Module | Route (`…/companies/:id/…`) | Nav status | Depth |
|---|---|---|---|
| Dashboard | `/dashboard` | ready | FLOW |
| Inbox (CRM) | `/inbox` | ready | FLOW |
| Inventory | `/inventory`, `/inventory/products[/new,/:id]`, `/inventory/movements[/new]`, `/inventory/stock-count`, `/inventory/scan`, `/inventory/locations`, `/inventory/reports/stock` | ready | FLOW |
| Expenses | `/expenses`, `/expenses/:id` | ready | FLOW |
| Accounting | `/accounting` | planned badge, route works | FLOW |
| Reports & BI | `/reports` | ready | FLOW |
| Journal / Ledger | `/journal` | ready | FLOW |
| Banking | `/banking` | ready | FLOW |
| Accounts Payable | `/accounts-payable` | ready | FLOW |
| Reimbursements | `/reimbursements` | ready | FLOW |
| Procurement | `/procurement` | ready | FLOW |
| Workflow | `/workflow` | ready | FLOW |
| AI Suggestions | `/ai-suggestions` | ready | FLOW |
| Notifications | `/notifications`, `/notifications/preferences`, `/notifications/rules` | ready | FLOW |
| CRM | `/crm`, `/crm/customers/:cid`, `/crm/payment-proofs` | ready | FLOW |
| Bookings | `/bookings` | ready | FLOW |
| Period Closing | `/period-closing` | planned | SMOKE |
| Sales | `/sales` | planned | SMOKE |
| Customers | `/customers` | planned | SMOKE |
| Sales Documents | `/sales-documents` | planned | SMOKE |
| Tax | `/tax` | planned | SMOKE |
| CRM Reports | `/crm-reports` | planned | SMOKE |
| Broadcast | `/broadcast` | planned | SMOKE |
| Settings | `/settings`, `/settings/{employees,roles,permissions,branches,security,po-approval,discount-policy,line-oa,access-overview,notification-rules,notifications}` | ready | FLOW (employees/roles/permissions), SMOKE (rest) |
| System admin | `/system/partners[/:id]`, `/system/company-onboardings/new`, `/system/line-settings` | — | FLOW (login as systemAdmin) |

Confirm the live nav against `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts` if a route 404s.

---

## 6. Failure triage protocol

When a test goes red, classify before you "fix":

1. **Rig defect** (selector too strict, race, wrong locale regex, missing `await`) → fix the test. Re-run.
2. **Environment defect** (DB down, wrong port, MinIO absent) → fix env or quarantine with `test.fixme('needs MinIO', …)`; note in report.
3. **Product bug** (contract mismatch, 500, wrong data, broken state) → **do not** loosen the test to pass. Capture:
   - the failing assertion + actual vs expected,
   - the Playwright trace (`trace: 'retain-on-failure'` is already on → `test-results/**/trace.zip`, view with `corepack pnpm exec playwright show-trace <zip>`),
   - the API status/body if an `api` call failed.
   File it in the report as `BUG-<n>` with repro steps.

Retry policy: no blanket retries. Flake is a bug — stabilize the selector/wait. If genuinely external, mark `@flaky` and report.

---

## 7. Reporting format (return this)

Produce `e2e/RESULTS.md` and echo a summary:

```
## E2E Run <ISO date> — <git sha>
Environment: web :3000 / api :3001 / db :5432 (seeded) / redis <up|down> / minio <up|down>
Command: e2e/run-local.sh
Result: <N> passed, <M> failed, <K> quarantined, <S> skipped   (P0 <x/y>, P1 <x/y>, P2 <x/y>)

### Failures
- CASE-ID — <one-line> — class=<rig|env|product> — trace=<path> — <BUG-n if product>

### Quarantined
- CASE-ID — reason — blocking dependency

### Bugs filed
- BUG-1 — <title> — route — expected vs actual — trace
```

Keep the Playwright HTML report (`playwright-report/`) and traces as evidence.

---

## 8. Guardrails / non-goals

- **Local only.** Never point tests at prod (`mangmeeplus.com`) or any non-localhost host.
- **No external side effects.** LINE messaging, LINE webhooks, real S3, Bedrock/OpenAI are out of scope — stub or skip. `MODEL_PROVIDER` is `disabled` in the test env; AI final-mutation is off.
- **Don't mutate seed identities' passwords** or delete seed branches/staff — other tests depend on them. Create your own throwaway records.
- **Don't commit** `.env`, tokens, `test-results/`, `playwright-report/` (already gitignored — verify).
- **Scope creep:** implement the catalog. If you find a case worth adding, add it under the right suite with a new ID and note it; don't rewrite existing passing suites.

---

## 9. Suggested execution order

1. `e2e/run-local.sh --grep @smoke` — prove the rig (auth, boot, DB) with `_reference.spec.ts`. If this is red, stop and fix the environment, not the tests.
2. Implement P0 FLOW suites one module at a time (inventory → expenses → accounting → reports → CRM → dashboard). Run each suite in isolation as you go.
3. P1 journeys, then P2 breadth (planned placeholders, i18n, permission-negative, logout).
4. Full run → write `RESULTS.md` → triage reds → re-run until P0+P1 green.

Start from [`_reference.spec.ts`](./_reference.spec.ts) and [`TEST-CASES.md`](./TEST-CASES.md).

## Lane D deferred coverage (2026-07-12)

- Full webhook autonomy: the local rig does not run the AI Gateway or Redis and has no usable LINE channel secret/identity chain.
- LIFF registration: the dev auth rig cannot provide a live LINE `idToken` for LINE verification.
- Receipt OCR ok-path: it requires a real model credential and the AI Gateway; the local no-key path remains covered separately.
