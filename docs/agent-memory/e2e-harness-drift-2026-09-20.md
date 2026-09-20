# Agent Memory: e2e harness drift 2026-09-20

Status: done — five drift items fixed on `codex/e2e-harness-drift-20260920`; two tests left red on purpose (below)
Owner: controller reviews/pushes/opens the PR; Opus 5 implemented in worktree `/private/tmp/mangmee-harness-20260920`
Scope: specs + `e2e/harness/e2e-utils.ts` + one api spec + `e2e/HANDOFF.md`. No product code, no `package.json`.

Decisions:
- `firstActiveBranch()` is called on ROOT creates only: `payment.use-case.ts:71`, `supplier-payment.use-case.ts:62` and `document.use-case.ts:119` inherit the branch from their allocation target / first bill / source document, so payments and source-linked documents need nothing.
- Two gates sat *behind* the branch gate and only surfaced once it passed: the seed writes the deprecated `CompanyTaxProfile.vatRegistered` bit but never a `CompanyVatRegistrationFact`, so every accounting create answered "VAT registration status must be confirmed" — hence `ensureVatRegistrationAnswered()`. And forms with no branch field of their own (AP's vendor bill) read `useBranchFilter()`, hence `useWorkspaceBranch()` seeding `watchdog.branchFilter.<companyId>`.
- `receipt-draft-continuity` drift was three renames, all from 2026-09-11: label `วันที่ค่าใช้จ่าย`→`วันที่เอกสาร` (`3d7379ef`), a second `บันทึกแบบร่าง` button in the review panel (`0283a3d0`, so the locator is scoped to the source-facts `<section>`), and the totals panel echoing the WHT message (`4361ed0b`, so the blocker is matched exactly). The 60 s timeout was the same stale date locator.
- EXP-26's export axis followed the branch enforcement itself (`88aef194`): the plain list is on the intake month, so the export sends `uploadedAt`.

Open questions:
- RESOLVED by `codex/expense-next-gate-ap-branch-20260920` (see `docs/agent-memory/expense-review-next-gate-and-ap-branch-2026-09-20.md`) — both tests are green and the file is 11/11. The `dataErrorCount` gate below was a real product defect and is fixed (`expenseDataStepBlocker`: the disable, the printed reason, the title and the `aria-describedby` are now one value), but it was NOT what held these two: on this branch both failed later, at `:163`, on step 2's own `expenses.doc_review_required_next` — the spec never answered สถานะหลักฐานภาษี nor pressed บันทึกการตรวจ, which that gate names in the hint beside the review form. Spec completed; the gate stands.
- RESOLVED by the same branch — the Decision below that AP's vendor bill is a "form with no branch field of its own" no longer holds: `CreateVendorBillForm` now carries `<TransactionBranchField>` + `useTransactionCreateBranchId()`, so `useWorkspaceBranch()` is no longer required for AP creates (AP-03/AP-04 keep it; new AP-06 deliberately runs without it, from "ทุกสาขา (รวม)").
- `receipt-draft-continuity` "incomplete receipt keeps the ordinary form and saves blank facts" (390px + 1280px) stays RED at `await expect(next).toBeEnabled()`. Not spec drift: measured `next.count() === 1`, `isDisabled() === false` immediately before the failing assertion, and the trace blocker reads `รายการที่ 2 หมวดหมู่ค่าใช้จ่าย: ยังขาดข้อมูล…` while both category comboboxes show `ค่าสาธารณูปโภค`. `ExpenseReviewPage.tsx:112` starts `dataErrorCount` at `null` and `:926` disables `ถัดไป` whenever `dataErrorCount !== 0`, so every re-report from `ExpensesPages.tsx:1107` re-disables the primary action with no message (`:832` leaves the title null). Owner decision needed.
- STILL OPEN, including the seed's missing `CompanyVatRegistrationFact` (the Decision above answers it per-run from the harness, not in `prisma/seed.ts`). Untouched, different bucket: EXP-01/02/04/09/24 (list locator + dataset drift), substitute DIGITAL (needs a seeded owner personal signature), and cross-file interference — AP-03 and WHT B1 pass alone but fail beside LED-06's launch-gate closure and the parallel supplier creates.

Artifacts: `e2e/harness/e2e-utils.ts` (+3 helpers), 9 specs, `apps/api/src/modules/billing/billing-grace.pg.spec.ts`, `e2e/HANDOFF.md` §3.

Verification (throwaway stack: pg 15511 / redis 16411 / minio 19111, API 3211, web 3212, `TZ=Asia/Bangkok`, fresh migrate+seed+gate-sync before every run, `--project=chromium --retries=0`):

| group | BEFORE (origin/develop worktree) | AFTER |
|---|---|---|
| accounting, accounts-payable, expenses, feature-entitlement-accessibility, income-expense-ledger, journal, procurement, wht-settlement, substitute-editable-navigation (61 tests) | 28 passed / 30 failed / 3 skipped | **50 passed / 8 failed / 3 skipped** (22 unexpected→expected, 0 regressions) |
| receipt-draft-continuity (11 tests) | 4 passed / 7 failed | **9 passed / 2 failed** (5 unexpected→expected, 0 regressions) |

`billing-grace.pg.spec.ts` 5 consecutive runs: 14 pass / 0 fail each. `pnpm --filter @watchdog-bms/api test` rc=0. `pnpm --filter @watchdog-bms/web lint` rc=0.

Next: owner call on the `ถัดไป` gate above; no workflow was edited because `ci.yml` runs Playwright only for `e2e/line-signup-contact-email.spec.ts` (the billing browser env is documented in `e2e/HANDOFF.md` §3 instead).
