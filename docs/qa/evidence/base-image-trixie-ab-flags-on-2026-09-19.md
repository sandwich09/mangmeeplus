# Trixie base image — A/B verification with EVERY env-gated flag ON

**Candidate:** merged main `9d4a80bc` (trixie) — **Baseline:** `a923b7e9` (bookworm)
**Scope:** every env-gated e2e flag turned ON, re-measuring the journeys the flags-off run left untested
**Produced:** 2026-09-19, by an Opus agent, under controller review — companion to `base-image-trixie-ab-verification-2026-09-19.md`

Follow-up to `trixie-ab-verification.md`, whose §7.4 admitted the gated flags were left unset so both
sides skipped the same tests. Owner order: **"flag บางตัว (billing/Stripe live) ต้องเปิดหมดนะ"**.
This run turns every gate ON and re-measures the previously dead journeys on both image sets.

| | trixie (candidate) | bookworm (baseline) |
|---|---|---|
| commit | `9d4a80bc16b6cacecaeef25f31362b564a0ea7fa` | `a923b7e921f735838ccf4b180d19cc7f87154db8` |
| release images | `mangmee-complete-{api-web,ai-gateway,workers,tools}:9d4a80bc…` | `…:a923b7e9…` |
| OS-matched test image | `mangmee-abf-ws:trixie` — Debian **13**, glibc **2.41** | `mangmee-abf-ws:bookworm` — Debian **12**, glibc **2.36** |
| Node in both | v22.23.2 | v22.23.2 |

Worktree: temporary, not committed to the repo — detached at `9d4a80bc`, verified by `rev-parse`.
The shared checkout and the four other worktrees were never touched.

---

## 1. Flag table

Inventory method: `grep process.env e2e/*.spec.ts`, `grep -n 'test.skip(\|test.fixme(' e2e/*.spec.ts`,
`grep process.env e2e/harness/*.ts`, plus `.github/workflows/ci.yml` lines 655-859
(`billing-integration` matrix), `infra/kamal/config.json`, `e2e/HANDOFF.md`, `playwright.config.ts`
and `docs/qa/evidence/**`. That inventory is complete: every `skip(`/`fixme(` guard in `e2e/` is in
this table or in §5.

### 1a. Flags set on the **API container** (identical on both stacks)

| Flag | Value | Why that value | Unlocks |
|---|---|---|---|
| `BILLING_MODE` | `test` | `packages/config` enum is `disabled\|test\|live`; `billing-admin-directory.spec.ts:119` demands exactly `test`; `billing-http-smoke.ts:58` sets `test` itself. **`live` is never used anywhere in the repo** and would need a real Stripe secret. | `billing-admin-directory` "issue queue" suite |
| `STRIPE_ACCOUNT_ID` | `acct_TESTONLYABFLAGS` | `packages/config/src/index.ts:378` requires `^acct_[a-zA-Z0-9]+$`. The specs only need it to match the `BillingAccount.stripeAccountId` they insert. Same synthetic-account pattern as `docs/qa/evidence/line-ai-credit-wording-2026-09-18/README.md:87` (`acct_TESTONLYH1EVIDENCE`). **No real Stripe key exists in this run**; `STRIPE_SECRET_KEY` is unset, so no Stripe request can succeed. | `billing-admin-menu-ux` (12), `billing-admin-directory` (5) |
| `EXPENSE_DRAFT_NUMBERING_ENABLED` | `true` | UAT/production value in `infra/kamal/config.json` | draft EXP numbering used by `expense-number-save`, `expense-running-number` |
| `AI_BUDGET_SPLIT_ACTIVATION_ENABLED` | `true` | UAT/production value in `infra/kamal/config.json` | AI credit split reads |
| `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED` | `true` | UAT/production value in `infra/kamal/config.json` | group intake routes |
| `PRODUCTION_SERVING_MODE` / `GLOBAL_MAINTENANCE_MODE` | `live` / `false` | carried from the previous report — `web-api-proxy.mjs` exits 1 without them | the api-web release image at all |
| `TZ` | `Asia/Bangkok` | carried from the previous report | BOOK-01 and every Bangkok-calendar assertion |

`BILLING_MODE`/`STRIPE_ACCOUNT_ID` are also set on `web` and the feature flags on `workers`, so all
three release images run with the same flags.

### 1b. Flags set for the **Playwright test process**

| Flag | Value | Where the guard is | Unlocks |
|---|---|---|---|
| `DATABASE_URL` | per group, see §1c | many `test.skip(!databaseUrl)` | system-admin, system-support-resolution, plan-term-billing-readiness, income-expense-ledger, billing-* (was already set in the previous run) |
| `S3_E2E` | `1` | `expenses.spec.ts` ×8, `reimbursement-receipt.spec.ts` | receipt upload journeys (**was already set** in the previous run) |
| `S3_ENDPOINT` | `http://127.0.0.1:19093` | `playwright.config.ts:31` defaults S3_E2E=1 to `:19000`, which is another session's MinIO | points at this stack's MinIO |
| `EXPENSE_NUMBER_LIVE` | `1` | `expense-number-save.spec.ts:4`, `expense-running-number.spec.ts:3` | 2 + 1 tests |
| `EXPENSE_NUMBER_SOURCE_ID` | `qa-exp-number-impl-linked-abflags` | `expense-running-number.spec.ts:10` (default `qa-exp-number-impl-linked1` **does not exist in `prisma/seed.ts`**) | the linked reject/reopen/payout proof |
| `EXP_PROOF_UI` | `1` | `expense-running-number.spec.ts:40,52` | the browser steps inside that proof |
| `SUBSTITUTE_NAVIGATION_LIVE` | `1` | `substitute-editable-navigation.spec.ts:12` | 2 tests (DIGITAL + PAPER) |
| `RESPONSIVE_VIEWPORT` | `375x667` | `responsive.spec.ts:166` | re-runs the mobile invariants at the 375px floor (`e2e/RESPONSIVE-RESULTS.md:20`) |
| `RESPONSIVE_BASELINE` (+`_DIR`) | `1` + scratch dir | `responsive-baseline.spec.ts:15` | 1 test (6 desktop parity screenshots) |
| `RECEIPT_CONTINUITY_TEST_DATABASE_URL` | = `DATABASE_URL`, path `/watchdog_bms` | `receipt-draft-continuity.spec.ts:8,15,16` | 11 tests |
| `AUTH_RECOVERY_TEST_DATABASE_URL` | `…/watchdog_recovery_review_ab` | `line-recovery.spec.ts:33,41` (`pathname` must match `/_recovery_review_/`) | 2 tests |
| `API_DIST_DIR` | `dist` | `receipt-draft-continuity.spec.ts:17` and `line-recovery.spec.ts:37` load **compiled** API modules; line-recovery hard-codes `apps/api/dist/…`, so plain `dist` is the only value that satisfies both | both |
| `WORKER_INTERNAL_TOKEN` | `local-worker-token` | `expense-capture-intake.spec.ts:102` | (already set previously) |
| `BILLING_MODE`, `STRIPE_ACCOUNT_ID` | same as the API | `billing-admin-directory.spec.ts:118-119` reads them from the **test** process too | the issue-queue suite |

### 1c. Four guards pin a **database name or bucket name**, and they conflict

These cannot all be satisfied by one API process, so the gated specs were split into five groups,
each run against the same images with only the API's `DATABASE_URL` / `S3_BUCKET` swapped:

| Group | API `DATABASE_URL` | API `S3_BUCKET` | Specs | Guard that forces it |
|---|---|---|---|---|
| **A** | `watchdog_bms` | `watchdog-bms-local` | expenses, reimbursement-receipt, expense-number-save, expense-running-number, substitute-editable-navigation, responsive-baseline, system-admin, system-support-resolution, plan-term-billing-readiness, income-expense-ledger | — |
| **Ares / Amob** | `watchdog_bms` | `watchdog-bms-local` | responsive (chromium / mobile-chromium) at `RESPONSIVE_VIEWPORT=375x667` | — |
| **B** | `mangmee_ux` | `watchdog-bms-local` | billing-admin-menu-ux, billing-admin-directory | `expect(url.pathname).toBe('/mangmee_ux')` — `billing-admin-menu-ux.spec.ts:29`, `billing-admin-directory.spec.ts:206,395` |
| **C** | `watchdog_bms` | `receipt-remediation-abflags` | receipt-draft-continuity | `expect(url.pathname).toBe('/watchdog_bms')` **and** `expect(process.env.S3_BUCKET).toMatch(/^receipt-remediation-/)` — `receipt-draft-continuity.spec.ts:15,25` |
| **D** | `watchdog_recovery_review_ab` | `watchdog-bms-local` | line-recovery | `expect(url.pathname).toMatch(/_recovery_review_/)` — `line-recovery.spec.ts:41` |

All three databases were created in the same Postgres container and independently
`prisma migrate deploy` + `prisma/seed.ts` + `prisma/sync-feature-launch-gates.ts`'d; all three
reported the identical gate result `opened=16 closed-baseline=4 unchanged=0 attested=0 skipped=2`
on both operating systems.

### 1d. Flags that are NOT runnable, and why

| Flag / guard | Verdict |
|---|---|
| `BILLING_MODE=live` + a real Stripe account | **NOT RUNNABLE LOCALLY, and not required by any spec.** No spec, script or CI job ever sets `live`; `apps/api/src/scripts/billing-http-smoke.ts:58` hard-codes `BILLING_MODE: 'test'` and simulates `api.stripe.com` by replacing `globalThis.fetch`. CI never sets `STRIPE_ACCOUNT_ID` or `BILLING_MODE` at all — which is exactly why the billing e2e specs are dead in CI too. A real live Stripe key was neither used nor needed. |
| `ACCOUNTING_UI_HIDDEN` | not an env flag — `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:14` is `export const ACCOUNTING_UI_HIDDEN: boolean = true` (owner decision 2026-08-09). 3 journal tests stay closed by product decision. |
| `test.skip(!isMobile, …)` in `responsive.spec.ts` | project-gated, not env-gated: those 72 tests run in `mobile-chromium`, which this report runs. |

---

## 2. Stack recipe deltas vs the previous report

Same `infra/docker/compose.local.yml` + `scratchpad/compose.ab-override.yml`, same release images,
same `TZ=Asia/Bangkok`, same "`platform: linux/amd64` on the four app services only, and
`DOCKER_DEFAULT_PLATFORM` unset for `compose up`" rule. Deltas:

1. **New ports** (nothing in the reserved list): Postgres `15493`, Redis `16393`, MinIO `19093/19094`,
   API `3194`, ai-gateway `3195`, web container `3196`, host `next dev` `3197`.
   Projects `mangmee-abf-trixie` / `mangmee-abf-bookworm`.
2. **A third compose override**, `scratchpad/abflags/compose.flags.yml`, adds the §1a flags and
   parameterises `DATABASE_URL`/`S3_BUCKET` on `api`, `web` and `workers` only — so the group swaps
   never recreate postgres/redis/minio and never re-init the volume.
3. **Three databases per side** instead of one (`watchdog_bms`, `mangmee_ux`,
   `watchdog_recovery_review_ab`) — see §1c — each migrated + seeded + gate-synced with the
   release `tools` image.
4. **A second MinIO bucket**, `receipt-remediation-abflags`, created with versioning enabled
   (`mc version enable`), because `receipt-draft-continuity.spec.ts:25` refuses any other name.
5. **A host-side API build.** `receipt-draft-continuity` and `line-recovery` `require()` *compiled*
   API modules from `apps/api/dist/…` inside the test process, so the worktree needed
   `pnpm install --frozen-lockfile` → config/contracts build → `prisma generate` →
   `API_DIST_DIR=dist pnpm --filter @watchdog-bms/api build`. The API **under test** is still the
   container; `dist` is only the specs' own library.
6. **`next dev` started by hand on 3197** instead of by Playwright's `webServer`, so the six
   invocations per side share one warm Next server instead of paying six cold Turbopack compiles.
   Playwright reuses both servers (`reuseExistingServer`, `CI` unset), exactly as before.
7. **One fixture the repo cannot seed.** `expense-running-number.spec.ts` needs a linked
   NEEDS_REVIEW expense that `prisma/seed.ts` does not create; the repo ships the seeding probe at
   `docs/qa/evidence/expense-running-number-implementation-2026-09-11/fixture-seed.probe.ts`, whose
   guard pins the 2026-09-11 review database name. I ran a **scratchpad copy** of that probe with
   only that one DB-name string repointed at this throwaway `watchdog_bms`
   (`scratchpad/abflags/expense-number-fixture.ts`). It produced
   `qa-exp-number-impl-linked-abflags` on branch `seed-room45-branch-siam` on both sides. No repo
   file was modified; the temporary copy placed in `apps/api/` for `tsx` resolution was deleted (§7).
8. **Billing smoke image**: `mangmee-abf-ws:{trixie,bookworm}` rebuilt from the same pinned base
   digests (`node:22-trixie-slim@sha256:c5849ff9…`, `node:22-bookworm-slim@sha256:48e4b67d…`).
   Gotcha worth keeping: the repo `.dockerignore` excludes `**/*.spec.ts`, and **Docker applies the
   context-root `.dockerignore` to a throwaway Dockerfile too** — the first build produced images
   with 1 spec file. Removing `.dockerignore` from the staged context gave `specs(api)=589` on both.
   Verified twins: `node=v22.23.2` both, `debian=13/glibc=2.41` vs `debian=12/glibc=2.36`,
   `specs(api)=589` both, `e2e=61` both, chromium `1228` both, API `dist` present both.

---

## 3. Gated e2e A/B table, flags ON

`pnpm exec playwright test <specs> --project=<chromium|mobile-chromium> --retries=0 --reporter=list,json`,
six invocations per side, 325 tests per side.

### 3a. Totals

| bucket | count |
|---|---|
| PASS on trixie **and** bookworm | **202** |
| FAIL on both (identical assertion) | **44** |
| SKIP on both | **78** |
| **FAIL on trixie only (candidate regression)** | **0** |
| FAIL on bookworm only | **1** |
| any other status mismatch | **0** |
| **total per side** | **325** |

Per side the raw numbers are trixie **203 passed / 44 failed / 78 skipped** and bookworm
**202 passed / 45 failed / 78 skipped** — the single difference is the bookworm-only failure in §3d.

### 3b. What the flags actually changed — before (flags off) vs after (flags on), per spec

Left column is the previous report's `trixie-chromium` result, right column is this run. The numbers
were byte-identical on bookworm in both runs, so one table covers both operating systems.

| spec | project | flags OFF | flags ON | what the flag did |
|---|---|---|---|---|
| `billing-admin-menu-ux.spec.ts` | chromium | 1 fail + 11 did-not-run | **12 pass** | `DATABASE_URL` on `/mangmee_ux` + `STRIPE_ACCOUNT_ID`; the old failure was literally `Expected "/mangmee_ux" Received "/watchdog_bms"` in `beforeAll`, which then stranded the other 11 |
| `billing-admin-directory.spec.ts` | chromium | 1 pass + 3 fail + 1 skip | **5 pass** | same, plus `BILLING_MODE=test` for the issue-queue suite. Two of the three old failures were the `/mangmee_ux` assert; the third was a 60 s timeout that does not recur |
| `expense-number-save.spec.ts` | chromium | 2 skip | **2 pass** | `EXPENSE_NUMBER_LIVE=1` |
| `expense-running-number.spec.ts` | chromium | 1 skip | **1 pass** | `EXPENSE_NUMBER_LIVE=1` + `EXPENSE_NUMBER_SOURCE_ID` fixture + `EXP_PROOF_UI=1` (the browser steps really ran) |
| `substitute-editable-navigation.spec.ts` | chromium | 2 skip | **2 fail, both sides, same assertion** | `SUBSTITUTE_NAVIGATION_LIVE=1`. New information: see §3c |
| `responsive-baseline.spec.ts` | chromium | 1 skip | **1 pass** | `RESPONSIVE_BASELINE=1`; 6 desktop screenshots written per side |
| `receipt-draft-continuity.spec.ts` | chromium | 11 skip | **trixie 4 pass / 7 fail, bookworm 3 pass / 8 fail** | `RECEIPT_CONTINUITY_TEST_DATABASE_URL` + `receipt-remediation-*` bucket + host `API_DIST_DIR`. New information: see §3c |
| `line-recovery.spec.ts` | chromium | 2 skip + 2 fail | **2 pass + 2 fail (the same 2)** | `AUTH_RECOVERY_TEST_DATABASE_URL`; the two DB-gated login/forced-change tests now pass on both |
| `responsive.spec.ts` | mobile-chromium | 97 pass / 5 fail / 3 skip | **97 pass / 5 fail / 3 skip** | `RESPONSIVE_VIEWPORT=375x667` re-runs the whole mobile suite at the 375 px floor and lands on exactly the same result as the Pixel-7 default |
| `responsive.spec.ts` | chromium | 26 pass / 7 fail / 72 skip | **25 pass / 5 fail / 75 skip** | the override shrinks every desktop test to 375×667, which removes the 7 desktop-width failures and auto-skips the 3 desktop-parity tests |
| `expenses.spec.ts` | chromium | 22 pass / 7 fail | 22 pass / 7 fail | `S3_E2E` was **already** on in the previous run — unchanged, and identical on both sides |
| `reimbursement-receipt.spec.ts` | chromium | 1 fail | 1 fail | same |
| `system-admin.spec.ts` | chromium | 8 pass / 1 fail | **9 pass** | not a flag: the old `SYS-01B` failure was a seeded-article count on a re-used database; on a fresh seed it passes on both |
| `system-support-resolution.spec.ts` | chromium | 2 pass | 2 pass | unchanged |
| `plan-term-billing-readiness.spec.ts` | chromium | 19 pass / 11 fail | 19 pass / 11 fail | `BILLING_MODE=test` + `STRIPE_ACCOUNT_ID` changed **nothing**: 6 still die on the `commandId must be shorter than or equal to 120 characters` manual-renew driver, the rest on missing `ต่ออายุ`/`เปิดหน้าเว็บ` controls |
| `income-expense-ledger.spec.ts` | chromium | 2 pass / 4 fail | 2 pass / 4 fail | unchanged — all four are `422 TRANSACTION_BRANCH_REQUIRED` |

**31 tests per side went from "never executed" to executed** (11 + 1 + 2 + 1 + 2 + 1 + 11 + 2), of
which **22 pass on trixie and 21 on bookworm**. A further 4 tests per side went from failing-only-
because-the-flag-was-missing to passing (the 3 `/mangmee_ux` asserts and the `billing-admin-directory`
mobile timeout).

### 3c. The two journeys the flags revealed (identical on both operating systems)

These are the only genuinely new findings; both fail the same way on Debian 12 and Debian 13, so
neither is the base image's doing.

1. `substitute-editable-navigation.spec.ts`, both DIGITAL and PAPER:
   `{"code":"EXPENSE_EVIDENCE_REVIEW_REQUIRED","message":"ระบุปัญหาเอกสารและบันทึกการตรวจล่าสุดก่อนจัดทำใบรับรอง"}`
   — the spec's own `review-fields` PATCH no longer satisfies the API's evidence-review
   precondition before it posts `substitute-receipt`. Spec-vs-API drift, not an OS effect.
2. `receipt-draft-continuity.spec.ts`, 7 of 11 on both sides:
   - ×4 `expect(locator).toContainText('เลือกวันที่')` on `getByRole('combobox', { name: /^วันที่ค่าใช้จ่าย/ })` — element not found
   - ×1 `Test timeout of 60000ms exceeded` (reviewer/OCR-quantity case)
   - ×1 strict-mode violation on the WHT `getByRole('status')` message
   - ×1 `getByRole('button', { name: 'บันทึกแบบร่าง' })` expected 0, received 1

### 3d. The one asymmetry — bookworm-only

| test | trixie | bookworm |
|---|---|---|
| `receipt-draft-continuity.spec.ts` · `incomplete ordinary draft rejects stale save without replacing a newer vendor` | **PASS** | FAIL — `expect(locator).toHaveValue('ข้อมูลจากหน้าเก่า')`, received `ข้อมูลล่าสุดจากอีกหน้า` |

A stale-write race in the spec's own two-page fixture, failing on the **baseline**. It is not a
candidate regression, and there is no test in the other direction.

I re-ran that single test twice on the same live bookworm stack
(`--grep "incomplete ordinary draft rejects stale save"`): **pass 1 PASSED (3.2 s), pass 2 FAILED
with the identical assertion**. It alternates within one operating system, so it is a flake in the
spec's own fixture, not a property of Debian 12.
Evidence: `scratchpad/abflags/logs/bookworm-C-rerun{1,2}.log`,
`scratchpad/abflags/pw/bookworm-C-rerun{1,2}.json`.

### 3e. Where the 44 FAIL/FAIL sit

| cause | count |
|---|---|
| `422 TRANSACTION_BRANCH_REQUIRED` (`กรุณาเลือกสาขาของรายการก่อนบันทึก`) — the seeded company is multi-branch and the API-level fixtures send no branch | 7 (EXP-06/07/26, LED-01/02/04/06) |
| `manual-renew driver: commandId must be shorter than or equal to 120 characters` | 6 |
| `receipt-draft-continuity` date-combobox / WHT / draft-button drift (§3c) | 7 |
| `responsive.spec.ts` retry buttons measured 20 px against a ≥44 px target (5 tests × 2 projects) | 10 |
| `substitute-editable-navigation` `EXPENSE_EVIDENCE_REVIEW_REQUIRED` | 2 |
| expenses list locator/strict-mode + summary tiles (EXP-01/02/04/09) | 4 |
| `plan-term-billing-readiness` missing `ต่ออายุ` / `เปิดหน้าเว็บ` / retry controls + 1 timeout | 5 |
| `line-recovery` missing `หากไม่ได้รับข้อความหรือยังไม่ได้ผูก LINE` copy | 2 |
| REIMBRCPT-01 row not visible | 1 |

Every one of these is on the brief's known-drift list or is new-but-symmetric (§3c).

Evidence: `scratchpad/compare-flags-on.txt` (bucketed, with assertions),
`scratchpad/per-test-flags-on.txt` (all 325 tests, `trixie bookworm group file :: test`),
raw reports `scratchpad/abflags/pw/{trixie,bookworm}-{A,Ares,Amob,B,C,D}.json`,
traces/screenshots under `scratchpad/abflags/pw/<side>-<group>/results/`,
baseline screenshots under `scratchpad/abflags/baseline-{trixie,bookworm}/`.

---

## 4. Billing smoke scripts — trixie vs bookworm

### 4a. How this was run

CI's `billing-integration` job (`.github/workflows/ci.yml:655-859`) was replicated invocation by
invocation — **29 commands** across its three matrix suites (`backend`, `customer`, `operations`),
not just `billing-http-smoke.js`. Each ran inside the OS-matched test image with the API `dist`
built the way CI's "Build isolated billing API" step builds it
(`config build && contracts build && prisma generate && api build`).

Isolated providers and infrastructure, as CI configures them:

- Postgres container `abf-billing-pg` (user `watchdog` / `watchdog_ci`, seed DB
  `watchdog_recovery_ci`), with the two databases **named exactly as CI names them** —
  `watchdog_postmark_ci` and `email_otp_test` — each `prisma migrate deploy`'d.
  `billing-http-smoke.ts:55` refuses any other database name.
- Redis container `abf-billing-redis` started with `--network container:abf-billing-pg`, and the
  test container joined the same netns, so `127.0.0.1:5432` and `127.0.0.1:6379` resolve inside the
  container exactly as they do on a GitHub runner (the script asserts the host is localhost).
- Providers simulated by the script itself, never real: `globalThis.fetch` is replaced and asserts
  that the only external origin is `api.stripe.com`; `BILLING_MODE: 'test'`,
  `STRIPE_SECRET_KEY: sk_test_<run>`, `POSTMARK_SERVER_TOKEN: 'POSTMARK_API_TEST'`, synthetic LINE
  channel secrets. **No real provider credential was used and no real payment was made.**
- `BILLING_BROWSER_E2E=1` on the same cases CI sets it, which makes the script spawn a real
  `next dev` and a real headless Chromium inside the container (`billing-browser-smoke.ts`), so
  those runs are real-Nest + real-Postgres + real-Next + real-Chromium.

Deltas vs CI worth recording: `postgres:16-alpine` instead of CI's pinned `postgres:18.3-alpine`
(the image already cached locally), and everything runs as emulated `linux/amd64` on Apple Silicon,
which is why wall times are several times CI's.

### 4b. Results — mode → rc → passed count, trixie vs bookworm

| suite | case (CI invocation) | trixie rc | bookworm rc | trixie | bookworm | passed |
|---|---|---|---|---|---|---|
| backend | `python3 infra/postmark/config_test.py` | 0 | 0 | 1s | 1s | OK |
| backend | `tsx --test` postmark-config + ai-adjustment-history + email-otp + account-email-otp.postgres + billing-email-recipient.postgres + email-access.pg | 0 | 0 | 10s | 9s | **52** |
| backend | `tsx --test` postmark-delivery.pg + billing-receipts/grace/trial-carryover/caps/issues.pg + line-delivery-access/read-evidence/ledger-delivery.pg | 0 | 0 | 21s | 21s | **138** |
| backend | `tsx --test` billing-settings.pg + billing-issue-resolution.pg | 0 | 0 | 6s | 6s | **7** |
| backend | `tsx --test` line-binding.pg | 0 | 0 | 8s | 9s | **15** |
| backend | `postmark-http-smoke.js` | 0 | 0 | 3s | 4s | **8** |
| backend | `billing-http-smoke.js` (default, no `*_ONLY`) | **not measured** — see §4d | **0** | (killed / re-run cut) | 1232s | **259** (bookworm) |
| customer | `BILLING_TRIAL_CARRYOVER_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 35s | 35s | **31** |
| customer | `BILLING_PLAN_CHANGE_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 96s | 99s | **36** |
| customer | `BILLING_SIGNUP_JOURNEY_ONLY=1` | **1** | **1** | 19s | 19s | 0 |
| customer | `BILLING_PROVIDER_SCANS_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 22s | 23s | **7** |
| customer | `BILLING_EMAIL_VERIFICATION_ONLY=1` | 0 | 0 | 22s | 23s | **10** |
| customer | `BILLING_EMAIL_ACCESS_ONLY=1` | **1** | **1** | 59s | 60s | 0 |
| customer | `BILLING_EMAIL_RESET_ONLY=1` | 0 | 0 | 35s | 33s | **7** |
| customer | `BILLING_APPLY_RETRY_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 32s | 31s | **18** |
| customer | `BILLING_REPEAT_APPLY_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 134s | 135s | **70** |
| customer | `tsx --test` system-line-push + set-shared-line-credential | 0 | 0 | 3s | 3s | **18** |
| customer | `BILLING_LINE_CREDENTIALS_ONLY=1` | 0 | 0 | 19s | 18s | **8** |
| customer | `BILLING_LINE_BINDING_ONLY=1` | 0 | 0 | 24s | 25s | **7** |
| customer | `playwright test e2e/line-signup-contact-email.spec.ts --workers=1` | 0 | 0 | 44s | 45s | **7 tests** |
| operations | `BILLING_SUPPORT_OUTCOMES_ONLY=1` | 0 | 0 | 23s | 23s | **6** |
| operations | `BILLING_SCAN_SCHEDULE_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 85s | 84s | **9** |
| operations | `BILLING_INVOICE_SCANS_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 86s | 86s | **8** |
| operations | `BILLING_INVOICE_IMPORT_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 146s | 144s | **9** |
| operations | `BILLING_SALES_COHORT_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 196s | 197s | **78** |
| operations | `… BILLING_CONFIG_ONLY=1 BILLING_SUPPORT_SLA_ONLY=1` | 0 | 0 | 31s | 30s | **8** |
| operations | `… BILLING_CONFIG_ONLY=1 BILLING_SCHEDULED_POLICY_ONLY=1` | 0 | 0 | 80s | 78s | **12** |
| operations | `… BILLING_CONFIG_ONLY=1 BILLING_READINESS_ONLY=1` | 0 | 0 | 93s | 92s | **19** |
| operations | `BILLING_ADJUSTMENTS_ONLY=1 BILLING_BROWSER_E2E=1` | 0 | 0 | 107s | 107s | **29** |

**28 of the 28 comparable cases match on both operating systems in rc *and* in the exact `passed`
list, name for name.** The 29th (`billing-http-smoke.js` default) has a bookworm result only (§4d).

Totals for the 28 comparable cases: **26 rc 0 / 2 rc 1 on trixie, and 26 rc 0 / 2 rc 1 on bookworm**,
with **≈652 named smoke cases plus 230 `node:test` assertions plus 7 Playwright tests** passing
identically on both.

Full `passed` lists, every case name, both sides, with an explicit diff per case:
`scratchpad/billing-passed-lists.md`. Raw stdout per case:
`scratchpad/abflags/billing/{trixie,bookworm}/<case>.log`.

### 4c. The two failing cases — identical on both bases

| case | assertion, verbatim, identical on trixie and bookworm |
|---|---|
| `BILLING_SIGNUP_JOURNEY_ONLY=1` | `403 !== 200` at `checkSignupJourney (signup-journey-smoke.js:269)`; the browser layer reports `{"pathname":"/companies/billing-http-<run>/billing","error":"Expected values to be strictly equal:\n\n403 !== 200"}` |
| `BILLING_EMAIL_ACCESS_ONLY=1` | `locator.waitFor: Timeout 30000ms exceeded` at `checkEmailAccess (email-access-smoke.js:422)`, waiting for `getByRole('row').filter({ hasText: 'Manual <run>' }).getByText('อีเมล เบอร์โทร หรือชื่อร้าน')` on `/system/signup-requests` |

Both fail the same way on Debian 12 and Debian 13, so neither is a base-image effect. The
coordinator reports that today's PR CI for this same source is green on all three billing suites
(runs `35441644988` / `35441653690`) — **I did not verify those runs myself**; on that basis these
two are local-harness effects (emulated amd64 timing, `postgres:16` instead of `18.3`), not product
failures.

### 4d. What is missing, stated plainly

`billing-http-smoke.js` in its **default mode** has **no trixie measurement**. I killed the first
trixie attempt at 863 s after misreading a 0 % CPU sample as a hang; bookworm then completed the
same case in **1232 s with rc 0 and 259 named cases passed**, which proves the case was still
working when I killed it. I queued a trixie re-run, and the owner's time cut stopped it mid-flight
at roughly 7 of its ~20 minutes. So for this one case the record is: **bookworm rc 0 / 259 passed;
trixie not measured.** Every other case in this suite, including all 28 others and every one of the
browser-backed modes, matched exactly.

Owner's time cut, stated plainly: the bookworm side of `billing-http-smoke.js` default mode was not
re-run and the trixie side of that one case has no measurement; CI's green Billing Integration jobs
on the same source are the baseline.

---

## 5. Still skipped after the flags, and exactly why

### 5a. Still skipped inside the specs this run executed — 78 per side, all in `responsive.spec.ts`

| count | project | guard text (verbatim) | why it cannot be turned on |
|---|---|---|---|
| **72** | chromium | `test.skip(!isMobile, 'Responsive invariants run only in mobile-chromium.')` (`responsive.spec.ts:572`) | `isMobile` is a **Playwright project property**, not an env flag. These 72 are not lost: they are the same tests that run and pass in `mobile-chromium` (group Amob, 97 pass). |
| **3** | chromium | `test.skip(Boolean(viewportOverride), 'Desktop parity is meaningless under a viewport override.')` (`responsive.spec.ts:788`) | caused **by** turning `RESPONSIVE_VIEWPORT` on. Without the override these 3 run (and passed in the previous report). Mutually exclusive with the 375 px floor run by design. |
| **3** | mobile-chromium | `test.skip(isMobile === true, 'Desktop card-view parity runs only in chromium.')` (`responsive.spec.ts:785`) | the same 3 desktop-parity tests; they only ever run on chromium without an override. |

Everything else that was skipped in the previous report **now runs**: 0 skipped in groups A, B, C, D.

### 5b. Guards elsewhere in `e2e/` that no flag can open (not run in this pass, listed for completeness)

| spec | tests | guard | why |
|---|---|---|---|
| `journal.spec.ts` | 3 | `test.skip(ACCOUNTING_UI_HIDDEN, 'Ledger UI is intentionally closed for this launch.')` | `ACCOUNTING_UI_HIDDEN` is a hard-coded `const … = true` in `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts:14` (owner decision 2026-08-09), not an environment variable |
| `business-smoke.spec.ts` | 1 | `test.describe.skip('legacy business smoke — replaced by catalog specs')` | retired on purpose |
| `reports-bi-smoke.spec.ts` | 1 | `test.describe.skip('legacy reports smoke — replaced by reports.spec.ts catalog cases')` | retired on purpose |
| `crm.spec.ts` | 1 | `test.skip('LIFF-REGISTER @p2 blocked: AUTH_PROVIDER=dev does not stub LineLoginVerifierAdapter; customer-register requires a real LINE idToken verified by api.line.me', async () => {})` | needs a real LINE id token from `api.line.me`; unconditionally skipped, body empty |
| `cross-cutting.spec.ts` | 1 | `test.fixme('XC-02 @p1 workspace language control switches and persists locale')` | quarantined, no flag |
| `crm-reports.spec.ts` | 0 | `test.skip(summary.total === 0, 'seed is older than the current quarter — re-seed the e2e DB')` | conditional, did not fire on a fresh seed |
| `expense-capture-intake.spec.ts` | 0 | `test.skip(!WORKER_TOKEN, 'draining the read job needs WORKER_INTERNAL_TOKEN')` | `WORKER_INTERNAL_TOKEN` was already set, so it did not fire |
| `responsive.spec.ts` ×2 | 0 | `test.skip(browserName !== 'chromium', …)` | did not fire on either chromium project |

### 5c. The one flag value that is deliberately not used

`BILLING_MODE=live`. Nothing in the repository sets it: `packages/config` merely allows the value,
`billing-http-smoke.ts:58` hard-codes `test`, and **CI itself never sets `BILLING_MODE` or
`STRIPE_ACCOUNT_ID` in any job** — which is why `billing-admin-menu-ux.spec.ts` and one
`billing-admin-directory` suite are dead in CI too, exactly as they were dead in the previous
report. Running "live" would require a real Stripe secret key and would issue real API calls;
that is a prohibited action and is not what any spec asks for. Marked **NOT RUNNABLE LOCALLY**,
with the exact guard quoted in §1d.

---

## 6. Trixie-only failures

**None.**

Out of 325 gated browser tests per side and every billing script in §4, **no test failed on trixie
and passed on bookworm**. The brief's "re-run twice on a fresh reseeded trixie stack" step was
therefore not needed — there was nothing to re-run. The only asymmetry in the whole run points the
other way (§3d: one `receipt-draft-continuity` stale-write case fails on the **baseline** only).

For completeness, the state comparison is exhaustive, not sampled: `scratchpad/per-test-flags-on.txt`
lists all 325 tests with both statuses side by side; `MISMATCH` appears once, on that bookworm row.

---

## 7. Cleanup

Verified by count after the fact, not just issued:

| item | state |
|---|---|
| `docker compose -p mangmee-abf-trixie down -v` and `-p mangmee-abf-bookworm down -v` | containers, networks and volumes removed — `mangmee-abf*` containers **0**, volumes **0** |
| isolated billing infra `abf-billing-pg`, `abf-billing-redis` | removed — **0** |
| throwaway test images `mangmee-abf-ws:{trixie,bookworm}` | deleted — **0** remaining |
| host `next dev` on 3197 | stopped — **0** listeners |
| three throwaway databases | dropped with the postgres volumes |
| MinIO bucket `receipt-remediation-abflags` | dropped with the minio volume |
| worktree artefacts | `apps/api/abflags-expense-number-seed.ts`, generated `apps/web/{AGENTS,CLAUDE}.md` deleted; `apps/web/next-env.d.ts` and `docs/evidence/p27-phase6/platform-admin-entitlement-off-{desktop,mobile}.png` restored with `git checkout --` (those two PNGs are written by `system-admin.spec.ts:207,214` — running that spec dirties the repo, which is worth knowing) |
| staged build context `scratchpad/abflags/ws-context` | removed |
| worktree (temporary, not committed) | removed and pruned — **0** entries in `worktree list` |
| `/tmp/mangmee-heavy.lock` | **released** (it is a `mkdir` lock; never created as a file) |
| the five release image sets per side | **kept** — 10 `mangmee-complete-*:{9d4a80bc,a923b7e9}` tags still present, as instructed |
| evidence kept | `scratchpad/abflags/` (160 MB: playwright JSON + traces + screenshots, billing logs, scripts) plus `trixie-ab-flags-on.md`, `compare-flags-on.txt`, `per-test-flags-on.txt`, `billing-passed-lists.md` |

**Untouched:** the shared checkout (not committed) — no git command of any kind was run there this
session — and the four other worktrees: the UAT-deploy worktree (used read-only, as the brief
instructed, to add and remove my own worktree), the trixie worktree, this docs worktree, and the
marketplace W09 worktree. All nine neighbour containers
(`mangmee-w09-{pg,redis,minio}`, `mangmee-ux-*`, `mangmee-email-otp-pg`, `docker-postgres-1`,
`docker-redis-1`) are still up. No reserved port was bound at any point.

### One rule I broke, disclosed

During final cleanup I ran `pkill -f "next-server"` to stop my own `next dev` on 3197. That pattern
is not specific to my process and it **also killed the W09 session's `next dev` on port 3078**
(pids 10611/10617). I confirmed the damage and its limits:

- port 3078 now has **0** listeners; it had a listener before my `pkill`
- the W09 **API on 3077 is still running** (node pid 10595) and all three `mangmee-w09-*` containers
  are up, so only the web dev server died
- nothing in the marketplace W09 worktree was read, written or built by me

I did **not** try to restart it: I do not know that session's env/flags and its worktree is off
limits to me. **That session needs to restart its own `next dev` on 3078.** The correct command for
me would have been `pkill -f "3197"` alone, or killing the recorded pid; a bare process-name pattern
on a shared machine was the mistake.

---

## Verdict

With **every env-gated flag ON**, trixie still shows **no regression against bookworm**.

- **325 gated browser tests per side**: 202 PASS/PASS, 44 FAIL/FAIL with identical assertions,
  78 SKIP/SKIP, **0 trixie-only failures**. The one asymmetry is a bookworm-side flake that
  alternates pass/fail within Debian 12 itself.
- **28 of 29 replicated CI billing invocations** match on both bases in return code *and* in the
  exact `passed` case list — including every `BILLING_BROWSER_E2E=1` mode, which runs real Chromium
  against a real `next dev` against real Postgres. The 29th (`billing-http-smoke.js` default) has a
  bookworm result only, for the reason in §4d.
- **31 tests per side that had never executed now execute**, 22 of them green, and the flags also
  turned 4 previously-failing tests green. The billing admin surface — 12 + 5 browser tests that
  were dead in the previous report *and are dead in CI* — is now proven green on both bases.
- The two journeys the flags newly expose as broken (`substitute-editable-navigation`
  `EXPENSE_EVIDENCE_REVIEW_REQUIRED`, and 7 of 11 `receipt-draft-continuity` cases) fail identically
  on Debian 12 and Debian 13. They are spec-vs-API drift worth fixing, but they are not this
  change's doing and they are equally broken on the build currently serving UAT.
- `BILLING_MODE=live` with a real Stripe account was **not** run: no spec, script or CI job sets it,
  and it would require a real payment credential. Recorded as NOT RUNNABLE LOCALLY with the guard
  quoted in §1d.
