# Expense KPI responsive follow-up — 2026-09-11

On `codex/expense-running-number-20260911`, following EXP implementation `3d7379ef` and table column `52d56727`.

The shared expense `StatCard` scales the amount from 18–26px using its available text width. Cards below 18rem stack their icon above the amount; wider cards keep the horizontal layout. Exceptionally long values wrap instead of clipping or abbreviating monetary precision. Expense KPIs use five columns only from 1536px; medium screens keep two/three columns. No number, API, data, permissions or payment rule changes.

Verification:
- `pnpm --filter @watchdog-bms/web exec tsc --noEmit` passed (exit 0).
- Real local API + Chromium: expense list, reimbursement list and substitute receipt hub at 1920, 1536, 1440, 1280, 1024, 768, 640 and 390px. All 24 combinations passed value scroll-width and text-fragment bounds checks. Expense rows were loaded before measuring; the actual total was ฿10,931.00.
- Two layout-only stress values (฿999,999,999.99 and ฿999,999,999,999.99) passed at 1536px. These temporarily changed DOM text only.
- Total: 26 observations, zero clipped values, zero expense/reimbursement business mutations. See `browser-review.json`. Final 1440/1536/390 screenshots visually inspected.
- An initial probe measured loading zeros; corrected it to wait for real expense rows and reject a zero first total, then reran. Evidence here is from the final run.

The local launcher was `/tmp/expense-number-impl-run.py` with API 3011/web 3012, cloned DB `expense_number_impl_20260911`. Browser probe retained at `/tmp/expense-kpi-responsive-review.ts`; copy to `scripts/expense-kpi-responsive-review.tmp.ts` for its repository-relative existing auth harness import before running via workspace tsx. Task-owned servers stopped, generated next-env restored, temporary probe removed. No new dependency or permanent layout test suite.

Shared component consumers include reimbursement approvals/finance. The representative list/hub pages above were browser-tested; no claim that every permission-specific page or an actual older-user usability study was run.

User explicitly authorized commit/push into develop and main after verification. Deployment and draft-numbering flag activation remain separate.
