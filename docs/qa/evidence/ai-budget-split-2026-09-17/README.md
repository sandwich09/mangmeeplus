# Split AI budget admin UI — browser evidence, 2026-09-17

Phase D2 of the [LINE-AI ledger/lifecycle remediation](../../../specs/line-ai-ledger-lifecycle-remediation-spec-th.md)
(§11.3, §12.4, §12.5; acceptance D-01, D-03, R-08). Real HTTP, real DOM, real screenshots — nothing
below is mocked: every number came out of Postgres through the NestJS route and was rendered by the
Next.js page, and the subjects that change something really did save through
`PUT /v1/system/partners/:id/ai-model`.

- Commit: `468eded254715f439487fc8a614f5c57dbdb634d` (branch `codex/line-ai-remediation-d2-split-admin-ui-20260917`)
- Playwright + chromium, **17 subjects × 1440 px and 390 px**. These are **element** screenshots (the
  AI budget card, the split panel, the breakdown section or the audit list), not full pages: a
  full-page shot of this card is ~400 KB of mostly empty column.
- Every 390 px capture asserts `scrollWidth - clientWidth <= 1`, so the bundle cannot contain a
  screenshot of a page that scrolls sideways.
- Several subjects assert rather than photograph, because a photograph cannot prove them: an unsaved
  draft not moving a saved number, every control on the card being genuinely `disabled`
  (`disabled:opacity-50` still photographs as a coloured button), and the second tab actually moving
  the CAS revision.
- No cloud, no LINE, no AI provider: no model is configured in the stack below, so no provider call
  is reachable. No real tenant, person or LINE id appears in any image.
- `AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true` existed ONLY in the environment of the throwaway API
  process started here. The flag still defaults to false and is wired into no deploy.

## What each screenshot proves

Each subject has a `-1440.png` and a `-390.png`.

| Subject | Proves |
| --- | --- |
| `shared-no-split` | A `SHARED` company: mode "งบรวมก้อนเดียว", the per-scope table, both bucket caps as "ยังไม่ตั้ง" and their money left as "ตามงบรวม" (neither reads as "unlimited" nor as a forgotten setting) |
| `shared-breakdown` | **D-01's web half**: total, byBudgetBucket, byRequestKind, byUsageBasis, per-call averages, cache cost both priced and "ไม่มีข้อมูล", the partial-coverage note and the cost-adjustment line that is not counted as a call |
| `pending-next-month` | A `SPLIT` policy scheduled for the next Bangkok month, shown as "เริ่มเดือน …" in its own box, separate from "ใช้อยู่", with the cancel action beside it |
| `split-no-usage` | `SPLIT` active this month on a company with no usage and no holds: both caps shown, money left equal to the cap |
| `split-reserved-unresolved` | spent / reserved / available per scope, reserved labelled "กันไว้ระหว่างเรียก AI" with the line saying it is neither spend nor a provider call, plus "กำลังตรวจสอบยอดที่จอง 1 รายการ" |
| `bucket-exhausted` | The OCR share spent to the satang: cap ฿7,000.00 and **money left ฿0.00**. An exhausted bucket is not a cap of 0 — the two labels are different facts |
| `policy-invalid` | `SPLIT_EXCEEDS_TOTAL` (฿9,000 + ฿7,000 against a ฿10,000 total) as a red notice saying AI is refused for this company and exactly what to fix |
| `breach-flag` | An actual settled above its reserved bound: the operator is told the scope is closed, the full actual is kept, and to check before changing caps |
| `validation-caps-exceed-total` | `C + O > T` refused client-side against the **saved** total, before any request — and the saved numbers above did not move with the unsaved draft (asserted) |
| `server-refusal-thai` | A real writer refusal (`partner_ai_budget_cap_below_bucket_spend`, lowering the OCR cap under what that bucket already spent) rendered in Thai through `translateApiError` |
| `conflict-409-after-second-tab` | A second tab saved first (asserted to have moved the revision), so this page's `expectedBudgetRevision` was stale: 409, the page reloads the saved state, then tells the operator to re-check |
| `zero-cap-saved` | **R-08**: a cap of `0` saved through the real page. The CAP reads "ปิดส่วนนี้ (0 บาท)" while the money left in that share reads ฿0.00 |
| `pending-cancelled` | **R-08**: `budgetPolicy: null` through the real page — the scheduled box is gone and the active policy is untouched |
| `audit-history` | **R-08**: the audit list after three real saves — a scheduled policy, an edit of it, and a cancellation — each a readable Thai before/after pair |
| `locked-company` | A `DISABLED` company: the panel names the **company status** as the reason, and the total-budget form, the OCR form and the split form on the same card are all read-only (asserted) |
| `read-only-operator` | A platform operator holding `system.partner_dashboard.read` but **not** `system.partner_ai_model.manage`: every number is readable while all three forms are read-only, and the sentence names the **permission** (asserted) |
| `activation-flag-off` | The same page served by an API **without** the activation flag: SPLIT is disabled with one explanatory sentence while SHARED and cancel-pending stay usable |

The run also asserts the control case that keeps the two read-only subjects honest: a manager on an
ACTIVE company keeps all three forms enabled and is shown no read-only sentence.

`captured.json` is the manifest the capture script wrote.

## Not captured here

- Loading / error / retry states and the company-switch guard: both are pre-existing behaviour of
  this card (the `generation` token and the `key={ai-budget-<companyId>}` remount), unchanged by D2
  and not photographed. **D-03 stays open** for them.
- The tenant-API denial of D-03 is covered by a focused assertion instead of a screenshot:
  `apps/api/src/modules/system-partner-management/presentation/http/partner.controller.spec.ts`
  drives the real `DenyByDefaultGuard` over `aiUsage` and `setAiModelConfig` for a tenant caller,
  for no session at all, and for a caller holding only the read permission.
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

# 2. schema + the repo's own seed. Do NOT export S3_ENDPOINT here: the seed's attachment-storage
#    step then tries to reach a MinIO that this stack does not run.
export DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15481/d2_evidence?schema=public'
(cd apps/api && ./node_modules/.bin/prisma migrate deploy)
(cd apps/api && APP_ENV=local NODE_ENV=development \
  CREDENTIAL_ENCRYPTION_KEY=<64 chars> PDPA_PSEUDONYMIZATION_KEY=<64 chars> \
  ../../node_modules/.bin/tsx prisma/seed.ts)

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

# 5. the read-only operator, then one capture run per viewport, re-seeding in between so both
#    passes describe the same world even though some subjects really save
tsx <scratch>/seed-readonly-operator.ts
for vp in desktop mobile; do
  tsx <scratch>/seed-budget-states.ts
  OUT_DIR=docs/qa/evidence/ai-budget-split-2026-09-17 MONTH_KEY=2026-09 VIEWPORT=$vp \
    FLAG_OFF_WEB=http://127.0.0.1:3073 READONLY_USERNAME=d2.readonly.operator \
    READONLY_PASSWORD=<password> node <scratch>/capture.mjs
done

# 6. teardown
docker rm -f mangmee-d2-evidence-pg mangmee-d2-evidence-redis
git checkout -- apps/web/next-env.d.ts    # `next dev` rewrites this tracked file to its distDir
rm -f apps/web/AGENTS.md apps/web/CLAUDE.md
rm -rf apps/web/.next/d2-evidence apps/web/.next/d2-flagoff apps/api/dist/e2e-3071
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
| `d2-exhausted` | `SPLIT` with the OCR share spent to the satang (฿7,000 of ฿7,000) |
| `d2-split-invalid` | `SPLIT` ฿9,000 / ฿7,000 of ฿10,000 → `SPLIT_EXCEEDS_TOTAL` |
| `d2-breach` | `SPLIT` with a settled actual above its reserved bound |
| `d2-locked` | `SPLIT`, company status `DISABLED` |
| `d2-conflict`, `d2-zerocap`, `d2-cancel`, `d2-history` | the four companies the capture WRITES to, each used by one subject only, so every other subject is identical in both viewport passes |

The read-only operator is a company-scoped `SYSTEM_ADMIN` role override (`Role` is unique on
`(scopeKey, key)`, the shape `docs/plans/company-role-override-plan.md` documents) holding the
platform permission set **minus** `system.partner_ai_model.manage`. The `/system/*` shell is gated on
the role key while the controls are gated on the permission, and there is exactly one real
SYSTEM_ADMIN role — so this is the only way to express that operator. Throwaway-database data only.
