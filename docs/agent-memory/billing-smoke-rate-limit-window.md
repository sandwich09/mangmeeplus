# Agent Memory: billing-smoke-rate-limit-window

Status: Implemented on branch `ci/billing-smoke-short-rate-windows` (from origin/develop 69f41b60); measuring.
Owner: repo owner (follow-up to ci-fast-pr-gate, 2026-09-21).
Scope: `apps/api/src/modules/billing/billing-rate-limit-window.ts` (new), `billing.controller.ts` (four billing
buckets), `scripts/billing-http-smoke.ts` (harness env), four smokes with fixed 60 s sleeps.

Problem: billing smokes keep the real limiter on and wait out 429s (`retryAfterSeconds + 1`) or sleep a fixed
60–61 s before browser steps so the 30-command bucket drains. CI run 35551618056: one default
`billing-http-smoke.js` run ≈ 20 min of mostly silent waiting; the three suites took 12–24 min.

Decisions:
- `billingRateLimitWindowSeconds(productionSeconds)` returns the production window unless `APP_ENV=local`
  and `BILLING_RATE_LIMIT_WINDOW_SECONDS` is an integer 1–59, then `min(production, cap)`. Deployed UAT and
  Production always run `APP_ENV=production` (packages/config), so they cannot shorten a window.
- Applied to `billing-operator-commands`, `billing-issue-update`, `billing-command` (60 s) and
  `billing-reauthenticate` (300 s). Limits (30 / 5 requests) are unchanged.
- Reauthenticate is included because a faster suite re-authenticates more than 5 times inside 300 s and the
  configuration smoke treats a >60 s credential lockout as a failure (first measured run failed there).
- The harness defaults the cap to 10 s: the settlement forced-429 case needs ≥5 s of closure after priming.
  `BILLING_RATE_LIMIT_WINDOW_SECONDS=60` reproduces production timing.
- Fixed sleeps now wait `window(60) + 1` seconds. No new spec file: wiring one needs a package.json script edit.

Open questions:
- Non-billing buckets (auth, LINE credential publication, system email) keep production windows; revisit only if
  a faster suite starts tripping them.

Verification:
- Helper cases (13 env combinations × 60 s and 300 s windows): production/unset/invalid → production window.
- `tsc --noEmit` (TypeScript 5.9) on apps/api: clean.

Next: record before/after timing, open PR to develop.
