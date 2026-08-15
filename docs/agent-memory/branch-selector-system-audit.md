# Agent Memory: branch-selector-system-audit

Status: Audit complete 2026-08-15. Owner accepted all three defects for repair the same day; spec and
plan written, implementation not started. No code changed yet.
Owner: thawatchai (product decisions)
Scope: Answer "does the header branch selector actually work, system-wide?" after the owner saw a
dashboard still labelled `ทุกสาขา (รวม)` while the header showed `Head Office (สำนักงานใหญ่)`.

Artifacts:
- Spec: [[specs/branch-scope-visibility-spec|Branch Scope Visibility and Dashboard Branch Dimension Spec]]
- Plan: [[plans/branch-scope-visibility-plan|Branch Scope Visibility Plan]]

## Verdict

The selector works. The label does not. Two separate things:

1. **Selection + server enforcement are real.** The selector writes a real `branchId`, pages that
   consume it re-fetch, the API filters on it, and out-of-scope branch requests fail closed (403).
2. **The `ทุกสาขา (รวม)` text the owner saw is hardcoded** in 10 places that never read the
   selector. On the dashboard it is also *factually* all-branches, because the dashboard has no
   branch dimension at all.

## Prior art (this is not a regression)

- Spec `docs/specs/multi-company-branch-scope-spec.md:60` — selector "feeds page filters via query
  param, **starting with Expenses list/summary**"; line 85 puts "branch-level dashboards" out of scope.
- Plan `docs/plans/multi-company-branch-scope-plan.md:37` — explicitly deferred: "Branch enforcement
  in other modules (ledger/sales/inventory/bank/reports)".
- Memory `docs/agent-memory/multi-company-branch-scope-10d.md` — shipped 2026-07-03, unit-verified
  48/48, and records "NOT yet verified live". Still true: no E2E covers branch switching.

So today's behaviour matches what was built. The gap is that 6 more modules grew branch wiring since,
the label never followed, and no test guards it.

## Wiring inventory (verified by reading code 2026-08-15)

Selector source: `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx`
(`BranchFilterProvider` mounted in `WorkspaceLayout.tsx:154`, `''` = all branches,
persisted per company in `localStorage` key `watchdog.branchFilter.<companyId>`).

### Reacts to the selector (re-fetches on change)

| Page | Call site |
| --- | --- |
| Expenses list | `ExpensesPages.tsx:1321` (deps `:1325`) |
| Expenses accountant package export | `ExpensesPages.tsx:1386` |
| Expenses upload / manual create (tagging) | `ExpensesPages.tsx:1820-1821` |
| Substitute receipt wizard | `SubstituteReceiptWizardPage.tsx:434` |
| CRM bookings | `BookingsPrototypePage.tsx:197` (deps `:206`) |
| CRM reports | `CrmReportsPrototypePage.tsx:79` |
| Tax reconciliation | `TaxReconciliationPage.tsx:48,69` |
| Trade tax evidence | `TradeTaxEvidencePage.tsx:82,93,95` |

### Reads the selector for **create only** — list ignores it

| Page | Call site | Consequence |
| --- | --- | --- |
| Accounting documents | `AccountingPages.tsx:299` | New doc tagged to branch; `listDocuments` has no `branchId` param at all (`accounting-documents.api.ts:37`, controller `accounting-document.controller.ts:58-67`) |
| Accounts payable | `AccountsPayablePages.tsx:297` | Same shape: bill tagged, AP list unfiltered |

### Ignores the selector entirely

`dashboard`, `inbox`, `sales`, `customers`, `inventory`, `procurement`, `workflow`,
`ai-suggestions`, `journal`, `sales-documents`, `reimbursements`, `banking`, `reports`,
`period-closing`, `crm`, all `settings/*`, `notifications`.

Notable: `procurement` (`purchase-order.controller.ts:26`) and `inventory`
(`inventory-location.controller.ts:37`) **already accept `branchId`** server-side. The web never sends it.

## The label bug the owner saw

`ทุกสาขา (รวม)` is printed unconditionally in 10 places:

- `MangmeePage.tsx:39` — `MangmeeBranchChip` default prop; every one of its 7 call sites uses the
  default (`AddEmployeePrototypePage.tsx:613`, `PoApprovalSettingsPage.tsx:190`,
  `PermissionMatrixPrototypePage.tsx:242`, `BroadcastPrototypePage.tsx:119`,
  `CustomersPrototypePage.tsx:618`, `BroadcastPage.tsx:95`, `MangmeeModulePrototypePage.tsx:343`)
- `DashboardPages.tsx:258` — the green chip in the screenshot
- `DashboardPages.tsx:266` — the `ภาพรวมธุรกิจ · ทุกสาขา (รวม)` subtitle
- `WorkspaceScope.tsx:107` — see next section

## Two defects worth deciding on

**D1 — branch-locked user is told the opposite of the truth.**
`WorkspaceScope.tsx:103-113`: when `filter.locked` (membership resolves to exactly one branch,
set at `:60-63`), the header renders the chip reading `ทุกสาขา (รวม)`. That user's data *is*
restricted to their single branch. Spec `:60` says this case should be **hidden**, not mislabelled.
Same fallback also covers "context not loaded yet", so a slow/failed `/auth/me` shows it too.

**D2 — dashboard ignores branch scope, not just the selector.**
`apps/api/src/modules/dashboard-notifications/` has **zero** references to `scopes` or `branchId`.
`generate-snapshot.use-case.ts:50` caches one snapshot per `(companyId, periodKind)` shared by all
users; `visibleWidgets()` (`:99-101`) filters by *permission* only. So a `SELECTED_BRANCHES`
employee holding `dashboard.read` sees **company-wide totals**. Everywhere else in the system that
same user is branch-restricted (`branchScopeWhere` counts: banking 41, ledger 17, reimbursements 15,
procurement 13, inventory 13, reports 2). The dashboard is the outlier.

Fixing D2 is not a label change: a per-branch dashboard needs the snapshot cache key and every
provider to take a branch dimension.

## Verification evidence (2026-08-15, this machine)

Server-side branch ABAC — focused runs, all green:

```
apps/api $ npx tsx --test src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts
  -> 29/29 pass, incl. "rejects an explicit branch filter outside the scope"
apps/api $ npx tsx --test src/modules/data-model-core/domain/logic/branch.logic.spec.ts \
    src/modules/employee-access/application/use-cases/update-employee-branch-scope.spec.ts \
    src/modules/data-model-core/application/use-cases/list-branches.use-case.spec.ts
  -> 56/56 pass
apps/api $ npx tsx --test src/modules/crm-inbox/application/use-cases/crm-reports-summary.use-case.spec.ts
  -> 10/10 pass, incl. "changes report numbers when branchId changes"
     and "rejects a requested branch outside ctx.scopes.branchIds"
```

Full suites (baseline, both failures pre-existing and unrelated — `git diff main...HEAD` on this
branch touches docs only):

- `apps/api $ npm test` — 1 failure: `orders upload-range lists by newest intake before applying the
  page limit` (`expense-related-access.use-case.spec.ts:122`, expects `uploadedAt` sort, gets
  `expenseDate`).
- `apps/web $ npm test` — 928/929; 1 failure: `marks a document as backdated only when its Bangkok
  intake date is in a later month`.

Both belong to the `date-miss` / expense-upload-date work, not to branch scope.

## Coverage gap

`grep -rn "เลือกสาขา\|ทุกสาขา\|branchFilter" e2e/` returns exactly one hit:
`e2e/responsive.spec.ts:221`, which only asserts the dropdown stays inside the viewport.
**No test anywhere asserts that switching the branch changes the data on screen.** That is why this
could drift unnoticed, and it is the thing to add regardless of which fix is chosen.

## Decisions (owner, 2026-08-15)

1. Fix all three defects **and** wire the modules whose server side is already ready — not label-only.
2. D1 — show the branch name when locked, rather than hiding the control as the parent spec §60 said.
   Hiding leaves a restricted user with no way to know which branch they are in.
3. D2 — company-wide figures for a branch-restricted employee is a scope leak and closes.
4. R4 all four rules confirmed, including that per-branch figures do not sum to the company total
   (company-central `branchId = null` rows belong to the combined view only).
5. R6 — an out-of-scope branch returns 403, shown in a themed dialog, not an inline error or an
   empty list (spec R9).
6. R8 — ADMIN, FINANCE and ACCOUNTANT are guaranteed all-branch. Accepted cost: a per-branch
   bookkeeper (one accountant over a subset of branches) becomes unrepresentable.
7. R8 — `COMPANY_VIEW` and `AUDITOR_READONLY` join them. Final list is seven roles:
   OWNER, SYSTEM_ADMIN, COMPANY_VIEW, ADMIN, AUDITOR_READONLY, FINANCE, ACCOUNTANT.
   Branch-scopable remainder: MANAGER, SALES, INVENTORY, MARKETING, STAFF.

**No open questions.** Every plan phase is unblocked. One release gate remains: the pre-rollout SQL
audit (plan §11) for live memberships already narrowed against the new rule.

Governing principle, so a future role does not need another round of questions: a role is all-branch
when its job is oversight of the whole business (governance, finance, audit); branch-scopable when
its job is running one location. The seed already follows this line — MANAGER at อารีย์, SALES at
สยาม/ทองหล่อ (`seed.ts:85-88`).

## Findings added while writing the spec (2026-08-15)

Four things the first audit pass did not surface, each verified in code:

- **`DashboardSnapshot` already has `scope` + `scopeKey` + a matching index**
  (`schema.prisma:1299-1317`). Only the `BRANCH` enum value is missing (`:1191`). The branch
  dimension is an additive enum migration, not a table change.
- **`findLatest(companyId, periodKind)` ignores `scope` and `scopeKey`**
  (`prisma-dashboard.repository.ts:44-49`). The moment any branch-scoped row exists, this can serve
  one branch's snapshot to another branch or to the company view. It has to be fixed *before*
  anything writes a branch row, not after.
- **`GenerateSnapshotUseCase` has five consumers**, not one: web controller, the 15-minute worker
  sweep, the daily owner summary notification, the LINE AI health-summary tool, and the reports
  dataset adapter. Any signature change must be additive and default to today's behaviour.
- **Making every chip follow the selector would be a worse bug.** Three of the four live
  `MangmeeBranchChip` pages (`/settings/employees`, `/settings/permissions`, `/settings/po-approval`)
  are company-wide by nature. The fix is a *required* `label` prop so the compiler forces each call
  site to declare intent — company-wide pages say `ทั้งบริษัท`.

Also confirmed testable: `seed-local-company` has four ACTIVE branches (HO plus Room45 SIAM/AREE/THONG,
`seed.ts:2841` → `:79-81`) and branch-tagged CRM rows (`seed.ts:595`), so the E2E is runnable against
existing seed data with no seed change.

## Findings added for the R8 role requirement (2026-08-15)

- **Branch scope has no role dimension today.** `resolveBranchIds()`
  (`prisma-permission-resolver.repository.ts:94-98`) reads `branchScopeMode` +
  `MembershipBranchScope` only. Role is never consulted.
- **ADMIN/FINANCE/ACCOUNTANT therefore already see all branches by default** — `branchScopeMode`
  defaults to `ALL_BRANCHES` (`schema.prisma:813`). What is missing is a *guarantee*: the employee
  form derives the mode from ticked branches alone (`AddEmployeePrototypePage.tsx:485`), so ticking
  a subset silently narrows the company accountant and nothing objects.
- **The codebase already has the concept.** `FINANCIAL_ROLE_KEYS = ['FINANCE', 'ACCOUNTANT']`
  (`employee-access.logic.ts:10`), and assigning those roles is already owner-gated behind
  `access.role.financial.assign` (`:44`). `ALL_BRANCH_ROLE_KEYS` extends it rather than starting a
  parallel list.
- **Guardrail beats resolver override.** Overriding the resolver would leave meaningless
  `MembershipBranchScope` rows in the database and leave the employee form accepting a narrowing
  that silently does nothing — the same defect class as D1/D3. Rejecting the write instead keeps the
  membership the single source of truth and adds no special case to the per-request hot path.
- **403 UI is all reuse.** `AlertModal` (`common/components/modal/AlertModal.tsx`),
  `t('error.forbidden')` (`workspace-dictionary.ts:364` / `:1628`), and the existing 403 mapping at
  `error-message.logic.ts:34`. No new component, no new copy.
- **The dialog alone would make things worse.** `BranchFilterProvider` drops a stale selection only
  on mount (`WorkspaceScope.tsx:66`). Revoke a branch mid-session and every request 403s forever.
  The selection reset is what makes the dialog escapable.
- **Four broad-read role lists already exist and none match each other** —
  `crm-customer.use-case.ts:58`, `crm.logic.ts:212`, `audit.controller.ts:21`,
  `workflow-task.use-case.ts:7`. `ALL_BRANCH_ROLE_KEYS` is correctly a fifth: those answer *whose
  records* a role reads, this answers *which branches*. They compose — MARKETING reads every
  customer via `CRM_READ_ALL_ROLES` yet stays branch-filterable, which is why it is absent here.
  Consolidating the four is explicitly out of scope and must not be attempted as a drive-by.

## Implementation log (2026-08-15, all phases same day)

Supervised implementation: Fable 5 reviewed every diff and re-ran every gate independently; Opus
agents implemented. Nothing committed — all changes in the `fix-branch` working tree
(56 files changed, ~747 insertions, plus untracked: `branch-scope-label.logic.ts(.spec)`,
`e2e/branch-scope.spec.ts`, migration `20260815120000_dashboard_scope_branch`).

| Phase | Shipped | Independently verified |
| --- | --- | --- |
| 1 | Selector truth: locked → branch name (no chevron), unresolved → nothing; `useBranchScopeLabel()` + `branch-scope-label.logic.ts` single source; 3 dictionary pairs | diff review; web tsc; suite green; E2E locator `เลือกสาขา` intact |
| 2 | `MangmeeBranchChip.label` required; 7 call sites + dashboard placeholder `ทั้งบริษัท` | tsc failed with exactly the 7 predicted call sites before the fix — compiler-enforced coverage |
| 3 srv | Scope-aware `findLatest` (NULL-exact) FIRST; `BRANCH` enum + migration; both providers branch-filtered (incl. `last_movement_at` after supervisor kickback); use-case 403-before-resolution; restricted-caller leak closed; 4 consumers verified unchanged (sweep stays 1 snapshot/company; LINE scoped by design via `toCtx`) | diff review line-by-line; prisma validate; 53 focused tests; migration matches `ADD VALUE IF NOT EXISTS` precedent |
| 3 web | `getDashboard/generateSnapshot` branchId; deps `[companyId, locale, branchId]`; chip/subtitle from `useBranchScopeLabel`, hidden when null | diff review; web suite 940/940 then |
| 4 | 403 asserts (PO/vendor-bill/documents, repo-never-called pinned); accounting+AP+PO+inventory lists wired end-to-end with deps quoted per page; `reportBranchForbidden` self-heal (localStorage cleared BEFORE refetch, single `AlertModal`, no loop) wired into 11 read call sites; `isBranchScope403` handles both `status`/`statusCode` shapes | diff review; api tsc; 4a specs green; web 943/943 |
| 6 | `ALL_BRANCH_ROLE_KEYS` (7 roles) in contracts beside existing shared lists; update-path reject naming the role + widen-on-assign in ONE transaction; create-path resume-draft door closed (wizard creates → narrows → re-enter rewrites roles; now widens with the role write); form locks picker | diff review incl. transaction placement; 70 focused tests; contracts spec |
| 5 | `e2e/branch-scope.spec.ts` BSC-01..05 (selection persists; DATA changes with branch; dashboard chip+`branchId=` request pinned together; company-wide page refuses to follow; HO suffix end-to-end); repo-level `findLatest` scope pin in registered correctness spec | `--list` re-run (5 tests); correctness spec 9/9; every asserted string traced to source file:line |
| strays | `CrmReportsPrototypePage` divergent label → `useBranchScopeLabel` (CSV `?? ''`, subtitle segment drops; dead key `crm_reports.branch_all` removed th+en); `BookingsPrototypePage` `สาขาที่กำลังดู` chip → `useBranchScopeLabel`, create-default `activeBranchId` kept concrete (server `branchId_required`) | diff review; grep zero consumers; web suite green |

Final gates (run by supervisor, not delegated): api full suite **zero failures** (twice — before and
after the Step-B spec extension); web **943/943**; api+web tsc clean; `prisma validate` clean;
`--list` 5 E2E tests. Baseline note: spec §4.9's two recorded failures no longer reproduce
(`date-miss` fix `9dbc564`); bar tightened to zero and met.

## Live E2E verification (2026-08-15, real stack)

Docker infra (`compose.local.yml`: postgres :15432, redis, minio), migration
`20260815120000_dashboard_scope_branch` applied with `prisma migrate deploy` + `prisma generate`,
seed present (company + 11 qa accounts), permissions synced. Host has no `psql`, so preflight ran
via `docker exec` — the only deviation from `e2e/run-local.sh`, equivalent in effect.

**Result: `e2e/branch-scope.spec.ts` 5/5 passed, twice** (implementer run and an independent
supervisor run). First run failed BSC-02 on a FIXTURE bug, not an app bug: seeded bookings are
UTC instants, so คุณเบล's 14:00 renders 21:00 Bangkok — outside the grid's 09:00–19:00 window
(`bookings.model.ts:15-16`) — while the page correctly counted it (`คิววันนี้ 1 คิว`) and both scope
labels were correct in the failure snapshot. BSC-02 now selects its fixture programmatically
(BOOKED, in-window local hour, branch-tagged, first-in-day, unique name; picked
`seed-crm-booking-k4` คุณจอย AREE 18:00 week +1) and fails with a named-drift message if no seeded
booking is renderable.

Post-run hygiene: the web dev server rewrites `apps/web/next-env.d.ts` on every boot (landmine noted
in `playwright.config.ts:11-14`) — reverted after each run; `test-results/` removed.

## Outstanding (release gates, not code)

1. **Plan §11 SQL audit** on UAT and production before Phase 6 ships — memberships already
   narrowed while holding an all-branch role are a product decision, not a migration.
2. **Duplicate-session warning**: the background chip for the Bookings mislabel was started by the
   owner before the fix landed here (`dismiss_task` refused: already started). If that spawned
   session applies its own edit to `BookingsPrototypePage.tsx`, it will duplicate/conflict — treat
   it as superseded and close it.
3. ~~Seed `dateAt()` drift~~ **FIXED 2026-08-15 (owner pulled the chip into the session).** Root
   cause was sharper than first diagnosed: `dateAt` used `setHours()` — **host-local**, not UTC — so
   the same seed produced different instants per machine (a reproducibility bug, not only display).
   Now built from `bangkokDayStart` as Bangkok wall-clock, one-line fix, all 15 call sites corrected
   at once; the 17:00 follow-up/due timestamps also stop landing one Bangkok day late. All four demo
   bookings render in-grid (DB verified: 09/07/04/11 UTC = 16:00/14:00/11:00/18:00 BKK). BOOK-01
   needed no change (navigates defensively, asserts no hour). Live runs green twice:
   `branch-scope + bookings` 11/11 (implementer and supervisor), CRM suites 11 passed / 1
   pre-existing LIFF skip. BSC-02's finder now picks `k8 THONG 16:00 week +0` — the programmatic
   fixture selection absorbing the data change with zero test edits, as designed. The chip-spawned
   session for `task_93777c11` (started before this landed) is superseded — close it if still open.
4. Docker infra containers left running for the owner
   (`docker compose -f infra/docker/compose.local.yml --env-file .env down` to stop).

## Next

Owner: run the live E2E + SQL audit, then commit/PR when satisfied. The work is uncommitted by
design — supervisor left the tree for owner review.
