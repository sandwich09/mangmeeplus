# Branch Scope Visibility and Dashboard Branch Dimension Spec

## 1. Status

v1.1, 2026-08-15. **Implemented (all six plan phases) and verified end to end: api and web suites
zero failures, typecheck clean, and `e2e/branch-scope.spec.ts` 5/5 against a real local stack
(docker infra, migration applied, twice — implementer and supervisor runs).** Outstanding before
production: the plan §11 SQL audit on each live environment before the Phase 6 guardrail ships.

Owner accepted all three defects for repair on 2026-08-15 after reading
[[agent-memory/branch-selector-system-audit|the branch selector system audit]]; implementation
completed the same day. Verification evidence lives in the task memory.

Linked plan: [[plans/branch-scope-visibility-plan|Branch Scope Visibility Plan]]

Authority this spec extends, and must not contradict:

- [[specs/multi-company-branch-scope-spec|Multi-Company Owner and Branch Scope Spec]] — owns
  `branchScopeMode`, `MembershipBranchScope`, `RequestContext.scopes.branchIds`, the enforcement
  rule "records with `branchId = null` are company-central and visible to every scope", and the
  header selector itself. This spec **widens** its §60 "starting with Expenses list/summary" and
  **reverses** its §85 exclusion of branch-level dashboards.
- [[plans/multi-company-branch-scope-plan|Multi-Company Branch Scope Plan]] — §37 deferred
  "branch enforcement in other modules". This spec closes part of that deferral.
- [[agent-memory/multi-company-branch-scope-10d|10D task memory]] — records what shipped 2026-07-03.

## 2. Reported Defects

### D1 — A branch-locked user is told the opposite of the truth

`apps/web/src/features/web-core-workspace/WorkspaceScope.tsx:103-113` renders the literal string
`ทุกสาขา (รวม)` whenever `!filter || filter.locked`.

`locked` is set at `:60-63` when the membership resolves to exactly one visible branch, and the same
line pins `branchId` to that branch. So the person whose data is restricted to a single branch is
the one person told they are seeing all branches.

The condition also conflates a second, unrelated state: `filter` is `null` before
`BranchFilterProvider` resolves, and stays effectively empty when `/v1/auth/me` or the branches call
fails (`:68-70` swallows the error). A network failure therefore renders a confident false claim.

`Multi-Company Owner and Branch Scope Spec` §60 says this case should be **hidden**. It is not.

### D2 — The dashboard ignores branch scope entirely, not just the selector

`apps/api/src/modules/dashboard-notifications/` contains zero references to `scopes` or `branchId`.

- `generate-snapshot.use-case.ts:82-94` writes every snapshot as `scope: 'company'`,
  `scopeKey: undefined`.
- `visibleWidgets()` (`:101-105`) filters the stored widgets by **permission only**.
- Both providers query Prisma with `{ companyId }` alone
  (`expense-summary.provider.ts:33,41,45`, `inventory-health.provider.ts:33,40`).

Consequence: an employee whose membership is `SELECTED_BRANCHES` and who holds `dashboard.read`
plus `expense.read` sees **company-wide totals**. Every other read surface that person touches is
branch-restricted — `branchScopeWhere` appears 41 times in banking, 17 in ledger, 15 in
reimbursements, 13 in procurement, 13 in inventory. The dashboard is the single outlier.

This is a branch-scope leak in the numbers, not a labelling problem, and it reaches LINE as well:
`erp-dashboard-tools.use-case.ts:106` serves the same snapshot to `dashboard.get_business_health_summary`.

### D3 — Ten hardcoded `ทุกสาขา (รวม)` strings that never read the selector

The string the owner photographed is printed unconditionally in ten places:

| Location | Live route |
| --- | --- |
| `DashboardPages.tsx:258` (chip) | `/dashboard` |
| `DashboardPages.tsx:266` (subtitle) | `/dashboard` |
| `MangmeePage.tsx:39` — `MangmeeBranchChip` default prop, used bare by all 7 call sites: | |
| ↳ `AddEmployeePrototypePage.tsx:613` | `/settings/employees` |
| ↳ `PermissionMatrixPrototypePage.tsx:242` | `/settings/permissions` |
| ↳ `PoApprovalSettingsPage.tsx:190` | `/settings/po-approval` |
| ↳ `CustomersPrototypePage.tsx:618` | `/customers` |
| ↳ `BroadcastPage.tsx:95` | not routed |
| ↳ `BroadcastPrototypePage.tsx:119` | not routed |
| ↳ `MangmeeModulePrototypePage.tsx:343` | not routed |
| `WorkspaceScope.tsx:107` | every page (D1) |

Making all of them simply mirror the selector would replace one lie with a worse one: three of the
four live chip pages (`/settings/employees`, `/settings/permissions`, `/settings/po-approval`) show
**company-wide** data that no branch selection changes. A chip reading `สาขาสยาม` above a
company-wide permission matrix is a more damaging error than the current one.

## 3. Users and Product Goal

Primary users:

- **Owner / manager with all-branch scope** — switches branch to compare one shop against another,
  and must be able to trust that every number on screen belongs to the branch named on screen.
- **Branch-restricted staff (`SELECTED_BRANCHES` / `DEFAULT_BRANCH_ONLY`)** — must never be shown
  another branch's figures, and must be told which branch they are looking at.
- **Accountant / finance** — needs company-wide totals to stay reachable and unchanged by default.
- **LINE users** — inherit the same rule through the ERP tools, with no separate policy.

Goal: **what the page says its scope is, is what the page actually queried.** Every branch label on
every surface is derived from the query that produced the data on that surface, never typed as a
constant.

## 4. Verified Current-State Evidence

Discovery completed 2026-08-15 by reading code and running tests. Every claim below was checked, not
inferred.

### 4.1 The selector works

`BranchFilterProvider` (`WorkspaceScope.tsx:34`) is mounted once in `WorkspaceLayout.tsx:154`.
`branchId = ''` means all branches. Selection persists in `localStorage` under
`watchdog.branchFilter.<companyId>` (`:32`, `:78`). Options come from
`/v1/companies/:id/branches?status=ACTIVE&pageSize=100` intersected with `me.scopes.branchIds`
(`:54-58`). `BranchOption = { id, code, name, type }`.

Eight pages already re-fetch on change: Expenses list (`ExpensesPages.tsx:1321`, deps `:1325`),
Expenses export (`:1386`), Expenses upload/manual create tagging (`:1820-1821`),
`SubstituteReceiptWizardPage.tsx:434`, `BookingsPrototypePage.tsx:197`,
`CrmReportsPrototypePage.tsx:79`, `TaxReconciliationPage.tsx:48,69`,
`TradeTaxEvidencePage.tsx:82,93,95`.

### 4.2 Server-side enforcement already exists, in three different shapes

`branch.logic.ts:58-61` — `branchScopeWhere({branchIds})` →
`{ OR: [{ branchId: { in: branchIds } }, { branchId: null }] }`, `{}` when unrestricted.
`branch.logic.ts:48-52` — `isBranchInScope(scopes, branchId)` returns **true** for
`null`/`undefined` branchId, so it cannot by itself reject a missing filter.

| Shape | Behaviour for an out-of-scope explicit `branchId` | Examples |
| --- | --- | --- |
| **Assert → 403** | `ForbiddenException` | expenses (`expense-branch-scope.use-case.spec.ts`), `crm-reports-summary.use-case.ts:80`, `transaction-tax-reconciliation.use-case.ts:26`, `location.use-cases.ts:19` |
| **AND-narrow** | silently empty result | `prisma-procurement.repository.ts:651` (PO), `:1159` (vendor bills), `prisma-accounting.repository.ts:520` (documents) |
| **Replace-scope** | would leak — safe only because the use-case asserts first | `prisma-expense.repository.ts:629` |

All three are secure today. They are not consistent, and the third is one refactor away from a leak.

### 4.3 The dashboard schema already has the column this needs

`apps/api/prisma/schema.prisma:1299-1317`:

```prisma
model DashboardSnapshot {
  scope     DashboardScope @default(COMPANY)
  scopeKey  String?
  @@index([companyId, scope, scopeKey, generatedAt])
}
enum DashboardScope { COMPANY  ROLE  USER }   // schema.prisma:1191
```

`scope` + `scopeKey` + a matching index exist. `BRANCH` is not yet a member of the enum.

**Landmine:** `prisma-dashboard.repository.ts:44-49` —
`findLatest(companyId, periodKind)` queries `where: { companyId, periodKind }` and
**ignores `scope` and `scopeKey` completely**. The moment any branch-scoped row is written, this
method can return a branch snapshot to a company-wide request, or one branch's snapshot to another
branch. Fixing `findLatest` is a precondition, not a follow-up.

### 4.4 `GenerateSnapshotUseCase` has five consumers

| # | Consumer | File |
| --- | --- | --- |
| 1 | Web dashboard read (3 routes) | `dashboard.controller.ts:13,24,35` |
| 2 | Worker sweep, all ACTIVE companies, `forceGenerate`, `periodKind: 'today'` | `notification-sweeps.use-cases.ts:77-90` |
| 3 | Daily owner summary notification | `notification.use-cases.ts:262` |
| 4 | LINE AI `dashboard.get_business_health_summary` | `erp-dashboard-tools.use-case.ts:106` |
| 5 | Reports dataset source adapter | `report-source-adapters.ts:217` |

Any signature change must be additive and default to today's company-wide behaviour, or four
unrelated surfaces break.

### 4.5 Both providers can be branch-scoped from existing columns

- `ExpenseRecord.branchId` exists — direct.
- `StockMovement` has no `branchId` but has `locationId` (`schema.prisma:1267`), and
  `InventoryLocation.branchId` is nullable (`schema.prisma:1154`) — reachable by relation filter.
  Products themselves are company-level, so "low stock" per branch means balances derived from
  movements at that branch's locations.

### 4.6 The modules that could be wired, and what each still needs

| Module | Server state | Missing |
| --- | --- | --- |
| Procurement PO list | accepts `branchId`, AND-narrowed (`purchase-order.controller.ts:26`, repo `:651`) | web never sends it; no 403 on out-of-scope |
| Inventory locations | accepts `branchId`, asserts 403 (`location.use-cases.ts:19-20`) | web never sends it |
| Accounting documents list | repo already applies `branchScopeWhere` (`:520`); no `branchId` filter anywhere | controller param + use-case assert + repo predicate + web |
| AP vendor bills list | repo already applies `branchScopeWhere` (`:1159`); `ListVendorBillsUseCase.execute` filter has no `branchId` (`vendor-bill.use-case.ts:317`) | controller param + use-case assert + repo predicate + web |
| CRM customers | `ListCrmCustomersFilter` (`packages/contracts/src/crm.ts:256-265`) has no `branchId` | contract + controller + use-case + repo + web |

### 4.7 Testability is real

`seed.ts:2841` calls `seedRoom45DemoWorkspace(company.id, …)` with `company.id = seed-local-company`,
and that function creates three additional ACTIVE branches (`SIAM`, `AREE`, `THONG`, `seed.ts:79-81`)
inside the same company. The E2E default company therefore has **four** active branches. CRM
bookings, customers and opportunities are seeded with a real `branchId` (`seed.ts:595`). Exactly one
expense is branch-tagged, to head office (`seed.ts:3347`).

E2E harness: `e2e/harness/fixtures.ts`, `COMPANY_ID = seed-local-company`, `loginViaDevBff`.
Existing branch coverage: `e2e/responsive.spec.ts:221` only, which asserts the dropdown stays inside
the viewport and nothing about data.

### 4.8 i18n

`t(key, locale)` (`workspace-i18n.logic.ts:4`), `SupportedLocale = 'th' | 'en'`, `th` falls back for
missing `en`. `dashboard.home.all_branches` exists at `:183` / `:1447`; `crm_reports.branch_all` at
`:213` / `:1477`. `branchLabel()` (`WorkspaceScope.tsx:87`) appends the Thai literal
`' (สำนักงานใหญ่)'` with no `en` counterpart.

### 4.9 Test baseline before any change

- `apps/api $ npm test` — one failure, `orders upload-range lists by newest intake before applying
  the page limit` (`expense-related-access.use-case.spec.ts:122`).
- `apps/web $ npm test` — 928/929; one failure, `marks a document as backdated only when its Bangkok
  intake date is in a later month`.

Both belong to the in-flight expense upload-date work and exist on `main`
(`git diff main...HEAD` on this branch touches documentation only). They are the accepted baseline;
this work must not add to them.

**Baseline update during implementation (2026-08-15):** both recorded failures stopped reproducing
once the merged `date-miss` fix (`9dbc564`) settled — verified standalone (8/8) and in full runs.
The acceptance bar was therefore tightened from "no failures beyond these two" to **zero failures
in both suites**, and met (api full suite clean; web 943/943).

## 5. Product Rules

### R1 — A scope label states what the query did

Every branch label is derived from the selection that produced the data beside it. No component may
contain a branch-scope string as a constant.

### R2 — Three honest scope states, and pages must declare which they are

| Page kind | Selection | Label |
| --- | --- | --- |
| Branch-filtered | none | `ทุกสาขา (รวม)` / `All branches (combined)` |
| Branch-filtered | branch X | branch X's name |
| **Company-wide by nature** | any | `ทั้งบริษัท` / `Company-wide` — never a branch name |

`/settings/employees`, `/settings/permissions` and `/settings/po-approval` are company-wide by
nature. Their chips must say so, and must not follow the selector.

### R3 — The header selector never states a scope it does not have

- `locked` (restricted to exactly one branch) → show **that branch's name**, non-interactive.
  This overrides §60 of the parent spec, which says hide it: hiding leaves a restricted user with no
  way to know which branch they are in, which is the confusion this work exists to remove.
- context not yet loaded, or the lookup failed → render **nothing**. A missing chip is honest; a
  confident wrong one is not.

The single `!filter || filter.locked` branch at `WorkspaceScope.tsx:103` must be split.

### R4 — The dashboard gains a branch dimension

- Unrestricted caller, no selection → company-wide snapshot. **Unchanged from today.**
- Any caller, branch X selected and in scope → snapshot computed over branch X only.
- Restricted caller, no selection → snapshot computed over `ctx.scopes.branchIds` only. Never
  company-wide. This is the leak in D2 and it closes here.
- Explicit branch outside `ctx.scopes.branchIds` → **403**, matching expenses and CRM reports (R6).

Branch figures use **exact `branchId` match**, not `branchScopeWhere`. Rationale: the Expenses list
already behaves this way for an explicit selection (`prisma-expense.repository.ts:629-630` replaces
the scope predicate), and the dashboard card must not disagree with the list it links to.
Consequence, which is intended and must be stated in the UI copy: company-central rows
(`branchId = null`) appear under `ทุกสาขา (รวม)` and under no individual branch, so per-branch
figures need not sum to the company total.

### R5 — Snapshot caching stays bounded and can never cross scopes

- `DashboardScope` gains `BRANCH`.
- `scopeKey` is `null` for company-wide, the branch id for a single branch, and the sorted
  comma-joined `branchIds` for a restricted caller with no selection. Cardinality is bounded by
  (branches + distinct membership scope combinations) per company, not by user count.
- `findLatest` **must** match on `scope` and `scopeKey`. Precondition, per §4.3.
- The worker sweep keeps generating the company-wide snapshot only. Branch snapshots are generated
  on demand. Sweep cost must not become companies × branches.

### R6 — One fail mode for an out-of-scope explicit branch: 403

Every list that accepts a `branchId` asserts it against `ctx.scopes.branchIds` in the use-case and
throws `ForbiddenException`. AND-narrowing stays as the second line of defence but stops being the
only one. Silent-empty is removed as an observable behaviour because it is indistinguishable from
"this branch has no data", which hides both bugs and probing.

### R7 — No behaviour change for an unrestricted user who never touches the selector

Default company-wide reads, the worker sweep, the daily owner summary, the reports dataset and
existing API responses stay byte-identical when no branch is selected and the caller is unrestricted.

### R8 — Company-wide roles are guaranteed all-branch, by guardrail not by override

Owner decision 2026-08-15: ADMIN, FINANCE and ACCOUNTANT must be able to see every branch, the same
as OWNER.

**Current state (verified, not assumed):** branch scope is resolved purely from the membership —
`branchScopeMode` (`schema.prisma:813`, default `ALL_BRANCHES`) and `MembershipBranchScope` rows,
via `resolveBranchIds()` (`prisma-permission-resolver.repository.ts:94-98`). Role plays no part.
So these roles **already** see all branches by default. What is missing is a guarantee: the employee
form derives the mode from ticked branches alone
(`AddEmployeePrototypePage.tsx:485` — `branchIds.length === branches.length ? 'ALL_BRANCHES' : 'SELECTED_BRANCHES'`),
so an admin who ticks three of five branches silently narrows the company accountant, and nothing
objects.

**Rule:** a membership holding any role in `ALL_BRANCH_ROLE_KEYS` must be `ALL_BRANCHES`. This is
enforced at the **write path**, not by overriding the resolver:

- `UpdateEmployeeUseCase` rejects a narrowing write for such a membership, in the validation block
  that already exists at `update-employee.use-case.ts:131-155`, with a message naming the role.
- Assigning one of these roles to an already-narrowed membership widens it to `ALL_BRANCHES` in the
  same transaction, and is audited.
- The employee form disables the branch picker for these roles and states why.

**Why guardrail rather than a resolver override.** An override in
`prisma-permission-resolver.repository.ts` would leave `MembershipBranchScope` rows in the database
that no longer mean anything, and would leave the employee form happily accepting a narrowing that
silently does nothing — the same class of defect as D1 and D3, which this work exists to remove.
The guardrail keeps the membership the single source of truth, adds no special case to the hot path
every request goes through, and makes the misconfiguration impossible to save rather than harmless
to save.

**Cost, stated plainly:** a per-branch bookkeeper — one ACCOUNTANT responsible for two of ten
branches — becomes unrepresentable. If a company needs that, the person takes a non-financial role
plus a custom permission set instead. Owner accepted this on 2026-08-15.

`ALL_BRANCH_ROLE_KEYS` extends the existing `FINANCIAL_ROLE_KEYS = ['FINANCE', 'ACCOUNTANT']`
(`employee-access.logic.ts:10`) — a concept the codebase already has, whose assignment is already
owner-gated behind `access.role.financial.assign` (`:44`). The new constant lives beside it:

```
ALL_BRANCH_ROLE_KEYS = [
  'OWNER', 'SYSTEM_ADMIN',      // non-assignable to company staff; listed defensively
  'COMPANY_VIEW', 'ADMIN',      // company oversight
  'AUDITOR_READONLY',           // read-only audit
  ...FINANCIAL_ROLE_KEYS,       // FINANCE, ACCOUNTANT
]
```

`COMPANY_VIEW` and `AUDITOR_READONLY` added by owner decision 2026-08-15.

`OWNER` and `SYSTEM_ADMIN` are in `NON_ASSIGNABLE_ROLE_KEYS` (`employee-access.logic.ts:9`) and
cannot reach the employee form at all, so the guardrail can never fire for them through the UI.
They are listed so a future direct-write path inherits the rule rather than re-deriving it.

#### The principle, so a new role does not need a guess

**A role is all-branch when its job is oversight of the whole business — governance, finance, or
audit. A role is branch-scopable when its job is running one location.**

That leaves exactly five branch-scopable roles out of the twelve in the catalog
(`permission-registry.ts:938-949`): `MANAGER`, `SALES`, `INVENTORY`, `MARKETING`, `STAFF`. The seed
already assigns branches along that line — `MANAGER` at อารีย์, `SALES` at สยาม/ทองหล่อ
(`seed.ts:85-88`) — so the split matches how the system is already used.

#### Relationship to the four broad-read role lists that already exist

The codebase already carries four ad-hoc "reads broadly" lists, none of them identical:

| Constant | Members |
| --- | --- |
| `crm-customer.use-case.ts:58` `operationalAll` | OWNER, ADMIN, AUDITOR_READONLY, SYSTEM_ADMIN |
| `crm.logic.ts:212` `CRM_READ_ALL_ROLES` | OWNER, ADMIN, FINANCE, ACCOUNTANT, AUDITOR_READONLY, MARKETING |
| `audit.controller.ts:21` `FULL_AUDIT_ROLES` | OWNER, AUDITOR_READONLY |
| `workflow-task.use-case.ts:7` `BROAD_READ_ROLES` | OWNER, ADMIN, AUDITOR_READONLY |

`ALL_BRANCH_ROLE_KEYS` is a fifth list and that is correct, not duplication: those four answer
"**whose records** may this role read" (ownership projection), this one answers "**which branches**".
The two compose — a `MARKETING` user reads every customer under `CRM_READ_ALL_ROLES` **and** is still
branch-filtered by `isBranchInScope`, which is why `MARKETING` is deliberately absent here.

Consolidating the four existing lists is not in this scope and must not be attempted as a drive-by.

### R9 — A 403 is shown in a themed dialog and the UI recovers itself

An out-of-scope branch request (R6) must not surface as a bare inline error or a silent empty list.

- Use the existing themed `AlertModal` (`common/components/modal/AlertModal.tsx`) with
  `t('error.forbidden')`, which exists in both locales
  (`workspace-dictionary.ts:364` / `:1628`) and is already the 403 mapping in
  `error-message.logic.ts:34`. No new component and no new copy.
- **Self-heal, and this is the part that matters.** `BranchFilterProvider` drops a stale saved
  selection only on mount (`WorkspaceScope.tsx:66`). If an admin revokes a branch while the tab is
  open, the saved selection goes out of scope and every subsequent request 403s — a modal the user
  can dismiss but never escape. On a branch-scope 403 the provider must clear the selection back to
  all-branches, clear the `localStorage` key, and refetch. The dialog explains; the reset unblocks.

Existing surfaces that already show a 403 inline (`setError(err(ex))`) keep doing so. R9 governs the
branch-scope case only.

## 6. Scope

### In scope

1. **D1** — split the locked / not-loaded states in `BranchSelector`; show the branch name when
   locked; render nothing while unresolved.
2. **D3** — a single derived label source; chips on the four live pages tell the truth per R2;
   `dashboard.home.all_branches` usage becomes derived.
3. **D2** — branch dimension through `GenerateSnapshotUseCase`, `findLatest`, both providers, the
   `DashboardScope` enum, and the web dashboard read path.
4. **Wiring** the modules whose server side is ready or one assert away: procurement PO list,
   inventory locations list, accounting documents list, AP vendor bills list.
5. **R6** — 403 asserts added to procurement PO, AP vendor bills, accounting documents.
6. **R8** — `ALL_BRANCH_ROLE_KEYS` guardrail in `UpdateEmployeeUseCase` and the employee form.
7. **R9** — themed 403 dialog plus stale-selection self-heal in `BranchFilterProvider`.
8. E2E coverage that switches branch and asserts the data changed.

### Out of scope

- CRM customers / broadcast branch filtering — needs a contracts change
  (`packages/contracts/src/crm.ts:256`); deferred to a follow-up.
- The three unrouted prototype components (`BroadcastPage`, `BroadcastPrototypePage`,
  `MangmeeModulePrototypePage`).
- Ledger, banking, reimbursements, reports, workflow, sales-documents branch **filters** — their
  membership-scope enforcement already works; adding user-facing filters is separate product work.
- Server-persisted branch preference, and carrying the selection in the URL. Selection stays
  client-side per the parent spec. Known limitation to record, not fix: two open tabs do not sync,
  so a branch changed in one tab is picked up by the other only on remount.
- Per-branch document sequences, branch transfer/merge, branch-level permissions.
- The two pre-existing test failures in §4.9.

## 7. Contract Changes

Additive only. Every new parameter is optional and omitting it reproduces today's behaviour.

| Surface | Change |
| --- | --- |
| `GET /v1/companies/:companyId/dashboard` | new optional `branchId` query param |
| `GET /v1/companies/:companyId/dashboard/snapshots/latest` | new optional `branchId` query param |
| `POST /v1/companies/:companyId/dashboard/snapshots/generate` | new optional `branchId` body field |
| `GET /v1/companies/:companyId/accounting/documents` | new optional `branchId` query param |
| `GET /v1/companies/:companyId/accounts-payable/vendor-bills` | new optional `branchId` query param |
| `DashboardScope` enum | add `BRANCH` (Prisma migration) |
| `DashboardSnapshotRepositoryPort.findLatest` | gains `scope` + `scopeKey` arguments |

No permission keys are added. No existing response field changes shape.

## 8. Acceptance Criteria

- [ ] A user restricted to one branch sees that branch's name in the header, never `ทุกสาขา (รวม)`.
- [ ] While branch context is unresolved, or after the lookup fails, no branch label is rendered.
- [ ] Selecting branch X updates every visible branch label on branch-filtered pages to X's name.
- [ ] `/settings/employees`, `/settings/permissions`, `/settings/po-approval` read `ทั้งบริษัท`
      regardless of the selection.
- [ ] Dashboard totals change when the branch changes, and match the Expenses list filtered to the
      same branch for the same period.
- [ ] A `SELECTED_BRANCHES` user with `dashboard.read` never receives a company-wide figure.
- [ ] `GET /dashboard?branchId=<out-of-scope>` → 403. Same for accounting documents, AP vendor
      bills, procurement PO.
- [ ] A company-wide request never receives a branch-scoped cached snapshot, and vice versa.
- [ ] Worker sweep still writes exactly one snapshot per active company per period kind.
- [ ] LINE `dashboard.get_business_health_summary` returns branch-scoped figures for a restricted user.
- [ ] Reports dataset and daily owner summary outputs are unchanged for unrestricted callers.
- [ ] E2E: switching branch on a seeded multi-branch company changes rendered data.
- [ ] An ADMIN / FINANCE / ACCOUNTANT membership cannot be saved as branch-narrowed; the employee
      form disables the picker and says why.
- [ ] Assigning one of those roles to a narrowed membership widens it to `ALL_BRANCHES` and audits it.
- [ ] A branch-scope 403 shows the themed `AlertModal`, and the selection resets to all-branches so
      the user is not trapped in a repeating dialog.
- [ ] `apps/api` and `apps/web` suites show no failures beyond the two recorded in §4.9.

## 9. Open Questions

**None. All decisions taken by owner on 2026-08-15:**

1. Fix scope — all three defects plus module wiring, not label-only.
2. R3 — show the branch name when locked, rather than hiding the control as the parent spec said.
3. R4 — all four rules confirmed, including per-branch figures not summing to the company total.
4. R6 — 403 confirmed, with a themed dialog (R9).
5. R8 — ADMIN, FINANCE and ACCOUNTANT are guaranteed all-branch, accepting that a per-branch
   bookkeeper becomes unrepresentable.
6. R8 — `COMPANY_VIEW` and `AUDITOR_READONLY` join them. `ALL_BRANCH_ROLE_KEYS` is closed at seven
   roles, and the oversight-versus-location principle in R8 governs any role added later.

Every phase of [[plans/branch-scope-visibility-plan|the plan]] is unblocked.

One item remains a **release gate rather than a question** — the pre-rollout audit in plan §11.
If any live ADMIN / FINANCE / ACCOUNTANT / COMPANY_VIEW / AUDITOR_READONLY membership is currently
branch-narrowed, those people are seeing less than R8 says they should, and the owner decides how to
widen them before Phase 6 ships.
