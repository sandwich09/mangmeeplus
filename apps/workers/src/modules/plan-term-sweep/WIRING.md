# P29 backend — integrator wiring

Everything else in P29 is already wired. The four edits below are in files this change was not
allowed to touch (`package.json`, the workers registry). Until they are applied:

- the sweep never runs (enforcement still holds — see "Why this is not urgent" below);
- three new spec files never execute, and `pnpm --filter @watchdog-bms/api test` fails on the
  `spec-suite-coverage` guard, which is exactly what that guard exists to say.

## 1. `apps/workers/src/main.ts` — register the sweep worker

```ts
import { startPlanTermSweepWorker } from './modules/plan-term-sweep/plan-term-sweep-worker.js';
```

and inside `if (config.QUEUE_ENABLED) { … }`:

```ts
  workers.push(startPlanTermSweepWorker(config.REDIS_URL));
  workerLog('info', { event: 'plan_term_sweep_worker_started' });
```

No new env var, no config-schema change, no `deploy.sh` change: the worker reuses
`INTERNAL_API_URL` + `WORKER_INTERNAL_TOKEN` through the shared `startScanWorker` helper, exactly
like `expense-auto-post`.

## 2. `apps/workers/package.json` — add the worker spec to `test`

```
src/modules/plan-term-sweep/plan-term-sweep-worker.spec.ts
```

## 3. `apps/api/package.json` — add the three API specs to `test`

```
src/modules/system-partner-management/domain/logic/plan-term.logic.spec.ts
src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.spec.ts
src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.spec.ts
```

These three are the only reason `apps/api`'s suite is red. Everything else passes
(5662/5761, 1 fail = the guard above). Verified independently: 15 + 24 + 12 = 51 pass.

## 4. Nothing to do in `app.module.ts`

All API providers and controllers are registered inside
`apps/api/src/modules/system-partner-management/system-partner-management.module.ts`, which the
root module already imports. The new module imports `DashboardNotificationsModule` for the
notification machinery.

## Why a missing sweep is not an outage

The deadline is enforced on access, in `AuthGuard`, to the hour — not by the sweep. Without the
worker an expired company is still refused every business route with `company_term_expired`; what
is missing is only the visible `Company.status → DISABLED` flip, `termDisabledAt`, and the
7/3/1-day warnings. `termDisabledAt` is what lets a renew re-enable a company automatically, so
the sweep should be wired before the first customer term is set in production.

## New routes this adds

| Route | Permission | Notes |
|---|---|---|
| `GET /v1/system/partners/:partnerCompanyId/plan-term` | `system.partner_dashboard.read` | `{ term: null }` = grandfathered |
| `PUT /v1/system/partners/:partnerCompanyId/plan-term` | `system.partner_company.update` | same key as the profile PATCH |
| `POST /v1/system/partners/:partnerCompanyId/plan-term/renew` | `system.partner_company.update` | idempotent on `requestId` |
| `GET /v1/plan-term/notice` | `account.session.read` | any member; exempt from the expiry block |
| `POST /v1/internal/plan-term/sweep` | `X-Worker-Token` | `@Public()`, worker only |

No new permission keys were introduced.
