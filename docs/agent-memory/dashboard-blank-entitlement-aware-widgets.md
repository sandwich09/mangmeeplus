# Agent Memory: Dashboard blank on UAT — restore overview + entitlement-aware widgets

Status: Code complete, locally verified. NOT committed, NOT deployed.
Owner: develop
Scope: Restore the dashboard business-overview section that a parallel-session commit deleted, and make
the snapshot widgets render only for features the company actually has enabled.

## Trigger

UAT company `cms5pgtnz00431v32z27tehev` (New Nail Near Me) rendered a dashboard with header, period tabs
and refresh only — everything below was blank. `GET /dashboard` was healthy (the page showed
`อัปเดตล่าสุด 11:00 น.`, no error banner).

## Root cause

Two same-day commits on 2026-07-29 collided in the shared worktree:

- `c3e4ed41` (15:19) removed the `SHOW_BUSINESS_OVERVIEW = false` flag → restored the overview section.
- `8edddb93` (16:39) committed a parallel session's working tree, which was still based on the
  *pre-restore* state. Its message says it dropped "unused" `Card`/`SectionTitle`/`MetricRow`/`WidgetCard`
  helpers — true only under the old flag — so it deleted the render block c3e4ed41 had restored 80 minutes
  earlier (93 lines). It also weakened e2e `DASH-02` to assert on the CRM summary heading instead.

`8edddb93` is an ancestor of `HEAD` and of the UAT image `d94a62be`, so the blank page is what shipped.
The CRM daily-brief card (the only other body content) is gated on `crm.inbox.read`, which
`filterPermissionsByEntitlement` strips when the `crm` family is off — as it is for that company. Nothing
left to render.

## Decisions

- Restored the deleted render block verbatim (helpers + loading skeleton + `ภาพรวม` section + `no_data`
  empty card). Kept the existing `availableWidgets` filter (`!unavailableReason && metrics.length > 0`) as
  the "only enabled features" mechanism — providers already return an unavailable widget when their
  permission was stripped, so no new gating concept was introduced.
- Added `ExpenseSummaryProvider` (mirrors `InventoryHealthProvider`: Prisma direct, read-only,
  company-scoped, no cross-module import). Without it, an expenses-only company like the UAT one had zero
  eligible widgets even with the render restored — `InventoryHealthProvider` was the only provider.
  Metrics: confirmed expenses in period (money, period-scoped), receipts pending review (worklist,
  current-state), unpaid outstanding (money, current-state).
- `ExpenseSummaryProvider` requires `expense.read` and deliberately rejects `expense.read_own` — the
  metrics are company-wide aggregates an own-drafts-only role must not see.
- Tightened `InventoryHealthProvider`'s gate to `inventory.report.read || inventory.movement.read`,
  dropping `inventory.product.read`. `feature-gate.logic.ts` maps the `inventory.product.` prefix to
  `product_catalog` (sold separately), so the old gate kept reorder-point and stock-movement metrics
  visible to companies with the Inventory feature switched OFF. Found while verifying the entitlement rule
  end-to-end; it is a pre-existing leak, not a regression from this change.
- `GenerateSnapshotUseCase` now fans out to both providers via `Promise.all`, keeping the per-provider
  `.catch(() => [])` so one failing provider cannot blank the dashboard.
- Reverted e2e `DASH-02` to assert `ภาพรวม|Overview` — the section every entitled company renders.

## Open questions

- Should more providers follow (sales/AR, tax, banking)? The spec lists them as "future providers" pending
  their source modules. Not built — no request yet.
- The 15-minute snapshot cache means a deployed change takes up to 15 min to appear for users without
  `dashboard.snapshot.generate`. Self-healing; no heal script needed.

## Artifacts

- api: `modules/dashboard-notifications/application/providers/expense-summary.provider.ts` (+ `.spec.ts`)
- api: `modules/dashboard-notifications/application/providers/inventory-health.provider.ts` (gate) (+ `.spec.ts`)
- api: `modules/dashboard-notifications/application/use-cases/generate-snapshot.use-case.ts`
- api: `modules/dashboard-notifications/dashboard-notifications.module.ts`
- api: `package.json` (both new specs registered — the test script is a hand-maintained file list)
- web: `features/dashboard-notifications/DashboardPages.tsx`
- e2e: `dashboard.spec.ts` (DASH-02)

## Verification

- New provider specs: 8/8 pass (`tsx --test .../providers/*.spec.ts`).
- `pnpm test:boot` → "Nest resolved every provider in 312ms" (new injectable wired correctly).
- web `tsc --noEmit` → 0 errors. api `tsc --noEmit` → 17 pre-existing errors, none in touched files
  (company-vat-registration.logic.spec, process-line-webhook.use-case, prisma-reimbursement.repository).
- Full api suite: 3999 tests, 3929 pass, 53 fail. Every failure is a DB-backed spec tracing to the single
  missing column `Company.legalIdentityVersion` (migration `20260804180000_company_tax_identity_step0` not
  applied to the local dev DB). Zero dashboard/provider failures. `report-entitlement.race.spec.ts` aborts
  the run on the same drift and was excluded to get totals.
- Live browser (`web-verify-3004` + `api-verify-3012`, seed-local-company, dev sign-in OWNER), toggling
  `CompanyFeatureEntitlement.enabled` directly and force-refreshing each time:
  - inventory ON + expenses ON → both cards render with real numbers.
  - expenses OFF → expense card gone, inventory card stays.
  - inventory OFF (product_catalog still ON) → inventory card gone, expense card stays. This is the UAT
    company's exact shape and is the case the gate fix repairs.
  - both OFF → `ภาพรวม` heading + `ยังไม่มีข้อมูลสำหรับช่วงเวลานี้`, instead of the blank page reported.
  - No browser console errors. All entitlements restored to their original values afterwards.

## Next

1. Commit and push (nothing committed yet).
2. Deploy to UAT. No migration involved. Existing cached snapshots expire within 15 minutes.
3. Re-check `cms5pgtnz00431v32z27tehev` after deploy: it should show `ค่าใช้จ่ายและใบเสร็จ` only.
4. Unrelated blocker for whoever runs the api suite locally: apply
   `20260804180000_company_tax_identity_step0` to the local dev DB.
