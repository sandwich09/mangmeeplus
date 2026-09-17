# Split AI budget admin UI — browser evidence, 2026-09-17

Phase D2 of the [LINE-AI ledger/lifecycle remediation](../../../specs/line-ai-ledger-lifecycle-remediation-spec-th.md)
(§11.3, §12.4, §12.5; acceptance D-01, D-03, R-08). Real HTTP, real DOM, real screenshots — nothing
below is mocked: every number came out of Postgres through the NestJS route and was rendered by the
Next.js page.

- Commit: `2cc26df96bcf337c3687a614fc4350db9befb041` (branch `codex/line-ai-remediation-d2-split-admin-ui-20260917`)
- Captured with Playwright + chromium at **1440 px** and **390 px** (the mobile-first width).
  Every 390 px capture also asserts `scrollWidth - clientWidth <= 1`, so a bundle can never contain
  a screenshot of a page that scrolls sideways.
- No cloud, no LINE, no AI provider: no model is configured in the stack below, so no provider call
  is reachable. No real tenant, person or LINE id appears in any image.
- `AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true` existed ONLY in the environment of the throwaway API
  process started here. The flag still defaults to false and is wired into no deploy.

## What each screenshot proves

Each subject has a `-1440.png` and a `-390.png`.

| Subject | Proves |
| --- | --- |
| `shared-no-split` | A `SHARED` company: mode "งบรวมก้อนเดียว", per-scope table with both bucket caps as "ยังไม่ตั้ง" (not "unlimited"), and the D1 breakdown with its partial-coverage and estimated-token notes above it |
| `pending-next-month` | A `SPLIT` policy scheduled for the next Bangkok month, shown as "เริ่มเดือน …" in its own box, separate from "ใช้อยู่", with the cancel action beside it |
| `split-no-usage` | `SPLIT` active this month on a company with no usage and no holds: both caps shown, available equal to the cap |
| `split-reserved-unresolved` | spent / reserved / available per scope, reserved labelled "กันไว้ระหว่างเรียก AI" with the line saying it is not spend and not a provider call, plus "กำลังตรวจสอบยอดที่จอง 1 รายการ" |
| `policy-invalid` | `SPLIT_EXCEEDS_TOTAL` (caps ฿9,000 + ฿7,000 against a ฿10,000 total) as a red notice that says AI is refused for this company and exactly what to fix |
| `breach-flag` | An actual settled above its reserved bound: the operator is told the scope is closed, the full actual is kept, and to check before changing caps |
| `validation-caps-exceed-total` | `C + O > T` refused client-side against the **saved** total, before any request — and the saved numbers above did not move with the unsaved draft (asserted, not just photographed) |
| `server-refusal-thai` | A real writer refusal (`partner_ai_budget_cap_below_bucket_spend`, lowering the OCR cap under what that bucket already spent) rendered in Thai through `translateApiError` |
| `conflict-409-after-second-tab` | A second tab saved first, so this page's `expectedBudgetRevision` was stale: 409, the page reloads the saved state, then tells the operator to re-check |
| `activation-flag-off` | The same page served by an API **without** the activation flag: SPLIT is disabled with one explanatory sentence while SHARED and cancel-pending stay usable |
| `read-only-operator` | A platform operator holding `system.partner_dashboard.read` but **not** `system.partner_ai_model.manage`: every number is there, the form is gone |

`captured.json` is the manifest the capture script wrote.

## Not captured here

- The audit-history rendering of a policy change / schedule / cancellation / activation is covered by
  `apps/api/src/modules/system-partner-management/application/partner-ai-adjustment-history.spec.ts`
  and the web label map, not by a screenshot in this bundle.
- A locked (`DISABLED` / `ARCHIVED`) company renders read-only exactly as it does today, through the
  page's existing `fieldsLocked` path; no separate capture was taken.
- UAT/production journeys stay open — this is a local stack.

## Exact commands

An isolated throwaway stack: unique ports, a unique database name, its own containers. It never
touches ports 15432 / 15439 / 15442 / 3000 / 3001, any existing container, or `migrate reset`.

```sh
# 1. throwaway infrastructure
docker run -d --name mangmee-d2-evidence-pg -p 127.0.0.1:15481:5432 \
  -e POSTGRES_USER=watchdog -e POSTGRES_PASSWORD=watchdog_local_password -e POSTGRES_DB=d2_evidence \
  postgres:16-alpine
docker run -d --name mangmee-d2-evidence-redis -p 127.0.0.1:16381:6379 redis:7-alpine

# 2. schema + the repo's own seed
export DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15481/d2_evidence?schema=public'
(cd apps/api && ./node_modules/.bin/prisma migrate deploy)
(cd apps/api && ../../node_modules/.bin/tsx prisma/seed.ts)   # APP_ENV=local, encryption keys as in playwright.config.ts

# 3. build and boot: API on 3071 (flag ON), web dev on 3070
pnpm --filter @watchdog-bms/config build
pnpm --filter @watchdog-bms/contracts build
API_DIST_DIR=dist/e2e-3071 pnpm --filter @watchdog-bms/api build
AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true PORT=3071 node apps/api/dist/e2e-3071/apps/api/src/main.js
NEXT_DIST_DIR=.next/d2-evidence PORT=3070 pnpm --filter @watchdog-bms/web dev

# 4. a second pair with the flag ABSENT, for activation-flag-off: API 3072, web 3073
PORT=3072 node apps/api/dist/e2e-3071/apps/api/src/main.js
NEXT_DIST_DIR=.next/d2-flagoff PORT=3073 NEXT_PUBLIC_API_URL=http://127.0.0.1:3072/v1 \
  pnpm --filter @watchdog-bms/web dev

# 5. synthetic states + the read-only operator, then the capture
tsx <scratch>/seed-budget-states.ts       # 7 companies, legacy + new-shaped events, aggregates,
                                          # one adjustment, live/unresolved/breach holds
tsx <scratch>/seed-readonly-operator.ts   # a company-scoped SYSTEM_ADMIN role override holding the
                                          # platform permission set MINUS system.partner_ai_model.manage
OUT_DIR=docs/qa/evidence/ai-budget-split-2026-09-17 MONTH_KEY=2026-09 \
  FLAG_OFF_WEB=http://127.0.0.1:3073 READONLY_USERNAME=d2.readonly.operator \
  node <scratch>/capture.mjs

# 6. teardown
docker rm -f mangmee-d2-evidence-pg mangmee-d2-evidence-redis
git checkout -- apps/web/next-env.d.ts    # `next dev` rewrites this tracked file to its distDir
rm -f apps/web/AGENTS.md apps/web/CLAUDE.md
```

The three scripts live under the session scratch directory, not in the repo: they exist to produce
this bundle and have no place in the product or in CI.

### Seeded states behind the screenshots

| Company | State |
| --- | --- |
| `d2-shared` | `SHARED`, ฿8,000 total; legacy rows with no metadata and no pricing snapshot + new-shaped rows + one `COST_ADJUSTMENT` → partial coverage, UNAVAILABLE cache cost |
| `d2-pending` | `SHARED` in force, `SPLIT` (฿3,000 / ฿7,000) scheduled for the next Bangkok month |
| `d2-split-fresh` | `SPLIT` ฿3,000 / ฿7,000 of ฿10,000, no usage, no holds |
| `d2-split-live` | `SPLIT` with ฿1,200 CHAT and ฿4,800 OCR spent, a `DISPATCHED` and an `UNRESOLVED` OCR hold, a `RESERVED` CHAT hold |
| `d2-split-invalid` | `SPLIT` ฿9,000 / ฿7,000 of ฿10,000 → `SPLIT_EXCEEDS_TOTAL` |
| `d2-breach` | `SPLIT` with a settled actual above its reserved bound |
| `d2-conflict` | `SPLIT`, used only by the 409 case, which really saves — kept separate so every other subject is identical in both viewport passes |
