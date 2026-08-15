# Branch Scope Visibility Plan

## 1. Status

v1.1, 2026-08-15. **Implemented and live-verified — all six phases, same day; E2E 5/5 against the
real local stack (twice).** Verification evidence per phase, including the live-run log and the
BSC-02 fixture root-cause, is in [[agent-memory/branch-selector-system-audit|the task memory]].
Outstanding: the §11 SQL audit per environment before Phase 6 ships to production; seed `dateAt()`
UTC drift filed as a separate background task. Two label sites beyond the plan's table were found
during implementation and fixed under the same R1 rule: `CrmReportsPrototypePage` (:143 divergent
derivation, CSV + subtitle) and `BookingsPrototypePage` (`สาขาที่กำลังดู` chip naming `branches[0]`
over all-branch data; the create-default `activeBranchId` deliberately kept its concrete-branch
fallback).

Authority: [[specs/branch-scope-visibility-spec|Branch Scope Visibility and Dashboard Branch Dimension Spec]]
Audit that produced it: [[agent-memory/branch-selector-system-audit|Branch Selector System Audit]]
Parent: [[specs/multi-company-branch-scope-spec|Multi-Company Owner and Branch Scope Spec]] ·
[[plans/multi-company-branch-scope-plan|Multi-Company Branch Scope Plan]]

## 2. Purpose

Make every branch-scope label on every surface derived from the query that produced the data beside
it, and close the one place where a branch-restricted user still receives company-wide figures.

## 3. Sequencing Constraint

The phases are ordered so that **no surface ever states a scope it does not have, at any commit**.

Phase 2 must not make the dashboard chip follow the selector, because at that point the dashboard is
still company-wide — that would swap today's lie for a worse one. Phase 2 makes the dashboard chip
say `ทั้งบริษัท`. Phase 3 gives the dashboard a real branch dimension and only then flips its chip to
follow the selector.

Phases 1, 2 and 5 are independent of 3 and 4 and can ship separately. Phase 4 depends on Phase 4a.

## 4. Scope

### In scope

Per spec §6. Five phases, ~19 files.

### Out of scope

Per spec §6. Notably: CRM customers/broadcast filtering (contracts change), URL-carried selection,
the three unrouted prototype components, and the two pre-existing test failures recorded in spec §4.9.

## 5. Phase 1 — Header selector tells the truth (D1)

**Files:** `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx`,
`apps/web/src/common/i18n/workspace-dictionary.ts`

1. Split `WorkspaceScope.tsx:103` — the single `if (!filter || filter.locked)` becomes two:
   - `!filter || (filter.branches.length === 0 && !filter.locked)` → `return null`. Nothing rendered
     while unresolved or after the swallowed failure at `:68-70`.
   - `filter.locked` → the same static chip, but labelled with
     `branchLabel(filter.branches[0]!)` instead of the constant.
2. Replace the constant at `:116` and `:141` with a dictionary lookup, and i18n the
   `' (สำนักงานใหญ่)'` suffix in `branchLabel` (`:87`) — it has no `en` counterpart today.
3. New dictionary keys in both `th` and `en` blocks: `branch.scope.all`, `branch.scope.company_wide`,
   `branch.suffix.head_office`. `dashboard.home.all_branches` stays for now; Phase 2 retires its
   hardcoded call sites.
4. Export `useBranchScopeLabel(): string | null` from `WorkspaceScope.tsx` — the single derived
   label source required by spec R1. Returns `null` when there is no resolved context, the selected
   branch's name when one is selected, and the all-branches string otherwise.

**Risk:** `branches.length === 0` is also the legitimate state for a company with no ACTIVE branch
rows. Rendering nothing there is correct — there is no branch to name.

**Check:** unit test on `useBranchScopeLabel` covering unresolved / all / selected / locked.

## 6. Phase 2 — Chips stop lying, without over-claiming (D3)

**Files:** `apps/web/src/common/components/mangmee/MangmeePage.tsx`,
`AddEmployeePrototypePage.tsx`, `PermissionMatrixPrototypePage.tsx`, `PoApprovalSettingsPage.tsx`,
`CustomersPrototypePage.tsx`, `DashboardPages.tsx`

`MangmeeBranchChip` stays a dumb presentational component. It does **not** read context — a shared
component that silently follows a global selector is exactly how a company-wide settings page ends
up captioned `สาขาสยาม`. Instead its `label` prop becomes **required**, so every call site is forced
to declare its intent and the compiler finds all of them.

Per spec R2:

| Call site | New label |
| --- | --- |
| `AddEmployeePrototypePage.tsx:613` | `t('branch.scope.company_wide')` |
| `PermissionMatrixPrototypePage.tsx:242` | `t('branch.scope.company_wide')` |
| `PoApprovalSettingsPage.tsx:190` | `t('branch.scope.company_wide')` |
| `CustomersPrototypePage.tsx:618` | `t('branch.scope.company_wide')` — the customer list is not branch-filtered yet (spec §6 out of scope); the per-row `branchName` at `:185` already carries branch detail |
| `BroadcastPage.tsx:95`, `BroadcastPrototypePage.tsx:119`, `MangmeeModulePrototypePage.tsx:343` | `t('branch.scope.company_wide')` — unrouted, changed only to satisfy the now-required prop |
| `DashboardPages.tsx:258` and `:266` | `t('branch.scope.company_wide')` **for this phase only**; Phase 3 replaces both with `useBranchScopeLabel()` |

**Gap this closes:** the compiler, not a reviewer, now guarantees a new page cannot inherit a
default branch caption.

**Check:** `pnpm --filter web typecheck` must fail before the call sites are updated and pass after
— that is the evidence the required prop caught all of them.

## 7. Phase 3 — Dashboard branch dimension (D2)

The largest phase. Order inside it matters.

### 7a. Close the cross-scope cache leak first

**File:** `apps/api/src/modules/dashboard-notifications/infrastructure/prisma-dashboard.repository.ts`

`findLatest(companyId, periodKind)` at `:44-49` ignores `scope` and `scopeKey` (spec §4.3).
Change the signature to `findLatest(companyId, periodKind, scope, scopeKey)` and add both to the
`where`. Update `DashboardSnapshotRepositoryPort`.

**This lands before any branch row can be written.** Reversing the order means a branch snapshot can
be served to a company-wide request the moment 7c ships.

### 7b. Migration

**File:** `apps/api/prisma/schema.prisma` + new migration

Add `BRANCH` to `enum DashboardScope` (`:1191`). Additive enum value; existing rows keep `COMPANY`.
No data backfill. The index at `:1316` already covers `[companyId, scope, scopeKey, generatedAt]`.

Run `pnpm --filter api prisma:validate` and `migration:review` before committing.

### 7c. Providers take a branch filter

**Files:** `application/providers/expense-summary.provider.ts`,
`application/providers/inventory-health.provider.ts`

`collectMetrics` input gains `branchIds?: string[]`.

- Expense provider — add `...(branchIds && { branchId: { in: branchIds } })` to all three where
  clauses (`:33`, `:41`, `:45`). Exact match, no `null` inclusion, per spec R4.
- Inventory provider — `stockMovement` has no `branchId` (spec §4.5). Filter by relation:
  `...(branchIds && { location: { branchId: { in: branchIds } } })` at `:40`. The product lookup at
  `:33` stays company-level; products are not branch-scoped, and a product with zero movements in
  the branch correctly reads as balance 0.

**Gap to watch:** `InventoryLocation.branchId` is nullable. Locations with a `null` branch are
company-central stock and, per R4's exact-match rule, appear only in the company-wide view. Assert
this in the provider spec so the choice is visible rather than accidental.

### 7d. Use-case gains the dimension

**File:** `application/use-cases/generate-snapshot.use-case.ts`

`execute()` options gain `branchId?: string`. Resolve once, near the top:

- `branchId` present and `ctx.scopes.branchIds` set and does not include it → `ForbiddenException`
  (spec R6). Note `isBranchInScope` returns `true` for `undefined` (spec §4.2), so the check must be
  written explicitly rather than delegated.
- `branchId` present → `scope = BRANCH`, `scopeKey = branchId`, `branchIds = [branchId]`.
- no `branchId`, `ctx.scopes.branchIds` set → `scope = BRANCH`,
  `scopeKey = [...branchIds].sort().join(',')`, `branchIds = ctx.scopes.branchIds`. **This is the
  D2 leak closing.**
- no `branchId`, unrestricted → `scope = COMPANY`, `scopeKey = undefined`, `branchIds = undefined`.
  Byte-identical to today (spec R7).

Thread `scope`/`scopeKey` into the `findLatest` call at `:50` and the `create` at `:82-94`
(which currently hardcodes `scope: 'company', scopeKey: undefined`). Pass `branchIds` into
`providerInput` at `:70`.

Leave `visibleWidgets` (`:101-105`) alone — permission filtering is orthogonal and still required.

**Gap to watch:** the entitlement cache-reuse guard at `:54-64` compares period and module set. It
does not compare scope, and does not need to once `findLatest` is scope-aware — but a test must pin
that, because the two mechanisms are easy to confuse.

### 7e. Controller

**File:** `presentation/http/dashboard.controller.ts`

Add `@Query('branchId')` to both GETs (`:13`, `:24`) and an optional `branchId` to
`GenerateDashboardSnapshotDto` for the POST (`:35`). Pass through.

### 7f. Verify the four other consumers still behave

No code change expected in any of them — the parameter is optional and they omit it — but each must
be checked and the result recorded (spec §4.4):

| Consumer | Expected |
| --- | --- |
| Worker sweep `notification-sweeps.use-cases.ts:77-90` | still one company-wide snapshot per active company; **must not** iterate branches |
| Daily owner summary `notification.use-cases.ts:262` | unchanged; recipients are OWNER/ADMIN |
| LINE AI `erp-dashboard-tools.use-case.ts:106` | a restricted LINE user now gets scoped figures — the fix propagating, verify it does |
| Reports adapter `report-source-adapters.ts:217` | unchanged for unrestricted callers |

### 7g. Web dashboard reads the selector

**Files:** `dashboard-notifications.api.ts`, `DashboardPages.tsx`

`getDashboard(companyId, periodKind)` (`:57`) gains `branchId`. `CompanyDashboardPage` (`:193`)
calls `useBranchFilter()`, adds `branchId` to the `load` callback deps at `:222` and to
`handleRefresh` at `:228`, and both chips (`:258`, `:266`) switch from the Phase 2 placeholder to
`useBranchScopeLabel()`.

**Gap to watch:** `load` is memoised on `[companyId, locale]` today. Omitting `branchId` from the
dep array produces a stale-data bug that looks exactly like the original complaint.

## 8. Phase 4 — Wire the modules whose server side is ready

### 8a. Add the 403 asserts first (spec R6)

**Files:** `procurement/application/use-cases/purchase-order.use-case.ts:85`,
`procurement/application/use-cases/vendor-bill.use-case.ts:317`,
`accounting-documents/application/use-cases/document.use-case.ts:291`

Each list use-case asserts an explicit `filter.branchId` against `ctx.scopes.branchIds` and throws
`ForbiddenException`, matching `location.use-cases.ts:19` and `crm-reports-summary.use-case.ts:80`.
The existing AND-narrow in the repositories stays as defence in depth.

**Do this before 8b.** Sending `branchId` from the UI while the server only AND-narrows means an
out-of-scope value renders an empty list instead of an error, which is the failure mode spec R6
exists to remove.

### 8b. Accounting documents and AP vendor bills gain the filter

| Layer | Accounting documents | AP vendor bills |
| --- | --- | --- |
| Controller | `accounting-document.controller.ts:58-67` — add `@Query('branchId')` | `procurement/presentation/http/vendor-bill.controller.ts` — add `@Query('branchId')` |
| Use case | `document.use-case.ts:291` | `vendor-bill.use-case.ts:317` filter type |
| Repository | `prisma-accounting.repository.ts:520` — `and.push({ branchId })` | `prisma-procurement.repository.ts:1159` — add to the inner filter object |
| Web client | `accounting-documents.api.ts:37` params | `accounts-payable.api.ts:15` params |
| Web page | `AccountingPages.tsx` list — already has `useBranchFilter()` at `:254`, currently create-only | `AccountsPayablePages.tsx` list — already has it at `:261`, currently create-only |

### 8c. Procurement PO and inventory locations

Server already accepts and (after 8a) asserts. Web only:

- `procurement/` has zero `branchId` references today — add `useBranchFilter()` to the PO list,
  send `branchId`, include it in the fetch deps.
- `inventory/inventory.api.ts:68` already types `branchId` — the page never passes it. Wire it.

**Gap to watch across 8b/8c:** every one of these pages must add `branchId` to its fetch dependency
array. This is the single most repeated mistake available in this phase; the existing correct
examples are `ExpensesPages.tsx:1325` and `BookingsPrototypePage.tsx:206`.

## 8bis. Phase 4c — Themed 403 dialog and stale-selection self-heal (spec R9)

**Files:** `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx`,
plus the pages that send `branchId`

Reuse only — no new component, no new copy:

- `AlertModal` (`common/components/modal/AlertModal.tsx`, props `open/title/message/onClose`)
- `t('error.forbidden')` (`workspace-dictionary.ts:364` / `:1628`)
- `error-message.logic.ts:34` already maps status 403 to that key

1. `BranchFilterProvider` exposes `reportBranchForbidden()`. It clears `branchId` to `''`, removes
   the `watchdog.branchFilter.<companyId>` key (`WorkspaceScope.tsx:32,78`), refetches branches and
   `me/context`, and raises the dialog once.
2. Pages that send `branchId` call it when a request fails with 403 **and** a branch was selected.
   A 403 with no branch selected is an ordinary permission error and keeps its existing inline
   treatment.

**Gap this closes:** `WorkspaceProvider` drops a stale saved selection only on mount
(`WorkspaceScope.tsx:66`). An admin revoking a branch mid-session leaves the open tab selecting a
branch it may no longer read — every request 403s and the dialog reappears forever. The reset is
what makes the dialog escapable; without it R9 makes the bug worse, not better.

**Check:** unit test that a 403 with a selection clears it, and that a 403 without one does not
touch the selection.

## 8ter. Phase 6 — All-branch role guardrail (spec R8)

Unblocked — role list closed by owner decision 2026-08-15.

**Files:** `apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts`,
`application/use-cases/update-employee.use-case.ts`,
`apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx`

1. Add beside the existing `FINANCIAL_ROLE_KEYS` (`employee-access.logic.ts:10`):

   ```ts
   export const ALL_BRANCH_ROLE_KEYS = [
     'OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW', 'ADMIN', 'AUDITOR_READONLY',
     ...FINANCIAL_ROLE_KEYS,
   ];
   ```

   Reuse, not a parallel list — `FINANCIAL_ROLE_KEYS` is already the codebase's name for
   finance-grade roles and its assignment is already owner-gated (`:44`).

   **Do not** fold in the four existing broad-read lists (`crm-customer.use-case.ts:58`,
   `crm.logic.ts:212`, `audit.controller.ts:21`, `workflow-task.use-case.ts:7`). They answer a
   different question — whose records, not which branches — and `MARKETING` is deliberately in one
   of them and not here. Spec R8 records why.
2. `UpdateEmployeeUseCase` — extend the scope validation block that already exists at
   `update-employee.use-case.ts:131-155`, next to its two sibling guards
   (`SELECTED_BRANCHES requires at least one branch.`, `DEFAULT_BRANCH_ONLY requires a default branch.`):
   - a narrowing write on a membership holding an `ALL_BRANCH_ROLE_KEYS` role → `ForbiddenException`
     naming the role;
   - assigning such a role to a narrowed membership → widen to `ALL_BRANCHES`, delete the scope rows
     and clear `defaultBranchId`, **in the same transaction as the role write**, audited at the
     existing HIGH-risk level used for scope changes (`:242`).
3. `AddEmployeePrototypePage.tsx` — when a selected role is in the list, disable the branch picker
   (`toggleBranch` at `:577`), force the "all branches" state that `:485` already computes, and show
   the reason. This stops the form from offering a choice the server will reject.

**Gap to watch:** widening on role assignment and the role write must share one transaction. Split
across two, a failure between them leaves an ACCOUNTANT pinned to one branch — the exact state this
phase exists to prevent.

**Check:** use-case tests for reject-narrowing, widen-on-assign, and that a non-listed role is
unaffected. Existing coverage to extend:
`employee-access/application/use-cases/update-employee-branch-scope.spec.ts`.

## 9. Phase 5 — Coverage that would have caught this

### 9a. E2E

**File:** `e2e/branch-scope.spec.ts` (new)

Feasible with existing seed data — `seed-local-company` has four ACTIVE branches and branch-tagged
CRM rows (spec §4.7). Harness: `e2e/harness/fixtures.ts`, `loginViaDevBff`.

1. Open a branch-filtered page, open the selector (`getByRole('button', { name: 'เลือกสาขา' })`,
   the locator `responsive.spec.ts:221` already proves works), pick a named branch.
2. Assert the header chip now reads that branch's name — the D1/D3 regression guard.
3. Assert the rendered data changed. CRM bookings is the best target: its seeded rows are
   branch-tagged across SIAM/AREE/THONG. Expenses is second choice — only one seeded expense is
   branch-tagged, to head office, so the assertion there is "non-empty becomes empty", which is
   weaker but still real.
4. Navigate to `/settings/permissions` with a branch selected and assert the chip reads
   `ทั้งบริษัท` — the R2 guard against the over-correction.

### 9b. Unit

| Target | Assertion |
| --- | --- |
| `generate-snapshot.use-case.spec.ts` | out-of-scope `branchId` → 403; restricted caller with no `branchId` never gets company-wide; unrestricted caller with no `branchId` byte-identical to today; cache reuse does not cross scopes |
| `prisma-dashboard.repository` | `findLatest` discriminates on `scope`/`scopeKey` |
| both provider specs | branch filter applied; null-branch inventory locations excluded from a branch view |
| PO / vendor bill / document list use-cases | out-of-scope `branchId` → 403 |
| `useBranchScopeLabel` | unresolved / all / selected / locked |

## 10. Risks and Gaps

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | `findLatest` ignoring scope leaks one branch's snapshot to another, or to the company view | Phase 7a lands first, with its own test |
| 2 | Worker sweep grows to companies × branches | 7f explicitly asserts the sweep stays company-wide; branch snapshots on demand only |
| 3 | Snapshot table cardinality | `scopeKey` bounded by branches + distinct membership scope combinations, not users (spec R5) |
| 4 | Four unrelated consumers of `GenerateSnapshotUseCase` | additive optional parameter; 7f checks each |
| 5 | Per-branch dashboard figures do not sum to the company total | intended (spec R4); company-central `branchId = null` rows belong to neither |
| 6 | Chip over-correction — a branch name above company-wide data | required `label` prop makes it a compile error, not a review miss (Phase 2) |
| 7 | Missing fetch dependency → stale data indistinguishable from the original bug | called out per page in §7g and §8; E2E in 9a catches it |
| 8 | `isBranchInScope(scopes, undefined) === true` misused as a "branch required" check | 7d writes the check explicitly |
| 9 | Two open tabs disagree on selection | known limitation, recorded in spec §6, not fixed |
| 10 | Enum migration on a live database | additive value, no backfill, no default change |
| 11 | R9 dialog with no reset traps the user in a repeating 403 | Phase 4c clears the selection and refetches; that is the point of the phase |
| 12 | Existing ADMIN/FINANCE/ACCOUNTANT memberships already narrowed in production | Phase 6 rejects future narrowing but does not migrate existing rows — audit them before rollout (see §11) |
| 13 | Phase 6 widen-on-role-assign split across two transactions | one transaction, asserted in the use-case test |
| 14 | Phase 6 removes the per-branch bookkeeper shape | accepted by owner 2026-08-15, recorded in spec R8 |

## 11. Verification

Run and record:

```bash
cd apps/api && npm test
```
```bash
cd apps/web && npm test
```
```bash
pnpm --filter api prisma:validate && pnpm --filter api migration:review
```
```bash
pnpm typecheck
```
```bash
npx playwright test e2e/branch-scope.spec.ts
```

Pass condition: no failures beyond the two recorded in spec §4.9 —
`orders upload-range lists by newest intake before applying the page limit` (api) and
`marks a document as backdated only when its Bangkok intake date is in a later month` (web).
Both pre-date this work and exist on `main`.

Manual, on a local stack with the seeded four-branch company, per spec §8 acceptance criteria:
switch branch on the dashboard and confirm the figures move and match the Expenses list filtered to
the same branch and period.

**Pre-rollout audit for Phase 6 (risk 12).** Phase 6 blocks future narrowing but migrates nothing.
Before it ships, list the memberships it would now reject, on each live environment:

```sql
SELECT m.id, m."companyId", r.key
FROM "CompanyMembership" m
JOIN "MembershipRole" mr ON mr."membershipId" = m.id
JOIN "Role" r ON r.id = mr."roleId"
WHERE m."branchScopeMode" <> 'ALL_BRANCHES'
  AND r.key IN ('OWNER','SYSTEM_ADMIN','COMPANY_VIEW','ADMIN','AUDITOR_READONLY','FINANCE','ACCOUNTANT');
```

An empty result means the guardrail is purely preventive. A non-empty one is a product decision —
those people are seeing less than this rule says they should — and must go to the owner before
Phase 6 lands, not after.

## 12. Phase Order

| Phase | Depends on | Blocked |
| --- | --- | --- |
| 1 — header selector (D1) | — | no |
| 2 — chips (D3) | 1 | no |
| 3 — dashboard branch dimension (D2) | 2 (7a before 7b/7c) | no |
| 4a/4b/4c — module wiring, 403 asserts, 403 dialog | 4a before 4b | no |
| 5 — E2E and unit coverage | 1–4 | no |
| 6 — all-branch role guardrail (R8) | — | no |

Phase 6 is independent of 1–5 and may run in parallel or last. Its only external dependency is the
pre-rollout audit in §11, which is a release gate, not a code dependency.

## 13. Next

No open decisions. Implement Phase 1 → 2 → 3 → 4 → 5, with Phase 6 any time after. Run the §11 audit
against UAT and production before Phase 6 ships. Record verification output per phase in
[[agent-memory/branch-selector-system-audit|the task memory]].
