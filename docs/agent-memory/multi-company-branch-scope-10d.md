# Agent Memory: multi-company-branch-scope-10d

Status: Implemented (API + LINE + web) and unit-verified 2026-07-03; awaiting live browser/LINE verification before checking 10D
Owner: thawatchai (product decisions), Claude (implementation)
Scope: Checklist item 10D. Multi-company owner (me/companies API, web header company switcher, onboarding attach-to-existing-owner) + branch scope enforcement (expenses API + LINE reads/drafts, Settings สาขา UI, employee branch-scope assignment, header branch selector).

Decisions:
- 2026-07-03 owner: branch visibility is assignment-driven via membership `branchScopeMode` + `MembershipBranchScope`; owner default = all branches; manager can see multiple branches by assignment; enforcement (including LINE) is this phase; branch is a same-page filter, not a separate profile.
- Records with `branchId = null` are company-central and visible to every scope; explicit out-of-scope branch requests fail closed (403); branch-restricted creators get their branch auto-tagged on create (defaultBranchId in scope, else first scoped branch); unrestricted creators default to null unless they pass branchId.
- Backward compatible: all existing memberships are ALL_BRANCHES, so nothing changes until an admin narrows a scope.
- No new permission keys; reuse `company.branch.read|manage` and audit patterns.

Foundation verified 2026-07-03 (survey):
- Prisma has `branchScopeMode` (default ALL_BRANCHES), `defaultBranchId`, `MembershipBranchScope`; `resolveBranchIds()` in data-model-core `branch.logic.ts` already resolves `RequestContext.scopes.branchIds` for web AND LINE contexts (`prisma-permission-resolver.repository.ts` loads scopes; LINE webhook passes them to gateway + tool contexts).
- `ListExpensesFilter.branchId` already in contracts; prisma-expense.repository where-clause already handles `branchId`; expense controller does NOT expose it; LINE `expense.list_recent` tool calls `ListExpensesUseCase` unscoped; LINE drafts (`expense-document.use-case.ts`) create with no branchId.
- Branches CRUD API exists (`companies/:companyId/branches`, `company.branch.read|manage`); zero web UI for branches; employee-access has `update-employee.use-case.ts` with no branch-scope support.
- AuthGuard accepts `X-Company-Id` header (fallback to `:companyId` route param) — `/auth/me` can be company-scoped without guard changes.
- Web has NO real session provider (workspace uses `createLocalOwnerSession()` dev fallback; header shows raw companyId as name); login returns single `companyId` and redirects there; no switcher/selector exists.

Artifacts:
- Spec: docs/specs/multi-company-branch-scope-spec.md (new)
- Plan: docs/plans/multi-company-branch-scope-plan.md (new)
- Checklist: item 10D added + reorder log 2026-07-03

Open questions: none blocking — owner confirmed assignment-driven model 2026-07-03.

Implemented 2026-07-03 (all four plan phases):
- API: `GET /v1/auth/me/companies` (active memberships) + `scopes`/`membershipId` added to `GET /v1/auth/me` (auth.controller.ts); onboarding `attachExistingOwner` mode (existing ACTIVE user by username → membership+OWNER+HO branch only; no user/credential/temp password; LINE QR skipped when owner already has an ACTIVE LINE identity; audited with `attachExistingOwner: true`).
- Branch ABAC: enforcement helpers `isBranchInScope`/`branchScopeWhere`/`resolveCreateBranchId` in data-model-core `branch.logic.ts`; permission resolver now orders defaultBranchId first in resolved `branchIds` so create paths tag `branchIds[0]` deterministically; expenses use-cases enforce on list (scope predicate incl. `branchId null` = company-central; explicit out-of-scope filter → 403), get/update/confirm/reject/void/mark-ready/record-payment (out-of-scope record fails closed), and create (restricted creators auto-tagged with their branch — root cause fix in `CreateExpenseDraftUseCase`, so web + LINE document intake + upload all inherit); expense controller exposes `branchId` query param.
- LINE: inherits automatically — webhook already resolves `scopes.branchIds`; gateway forwards `branchIds`; ERP tool `toCtx` maps them into `RequestContext.scopes`; `expense.list_recent` and LINE draft creation now scoped/tagged via the same use-cases.
- Employee scope management: `UpdateEmployeeInput` gains `branchScopeMode`/`defaultBranchId`/`branchIds` (atomic scope-row replace; validates ACTIVE same-company branches; rejects SELECTED_BRANCHES that would leave zero rows = lockout guard; HIGH-risk audit); employee list/detail expose current scope via mapper.
- Web: header company switcher + branch selector (`WorkspaceScope.tsx`, injected via new `companyArea` slot in AppHeader/WorkspaceShell; token-less dev-session mode falls back silently); `BranchFilterProvider` context feeds Expenses list `branchId`; Settings > สาขา page (`branch-settings/` feature, list/create/edit); employee detail panel assigns branch scope; onboarding form checkbox + no-password handoff variant.

Verification 2026-07-03:
- Focused 10D tests 48/48 (branch.logic enforcement helpers, expense scope enforcement, onboarding attach guards, employee scope update guards).
- Full suites: api 799/799 (was 785), web 117/117, ai-gateway 185/185; tsc clean on api, web, ai-gateway.
- Browser smoke (Next dev, no API): /companies/demo-co/expenses and /settings/branches render the new header + branches page with graceful fallback, zero console errors.
- NOT yet verified live: real login switcher with 2 companies, branch-scoped employee end-to-end (web+LINE), attach-existing-owner onboarding against real DB — needs prod deploy or full local stack.

Next: deploy to production when owner confirms, then live-verify the 10D gate checklist (multi-company switch, attach onboarding, scoped employee on web+LINE, LINE draft branch tagging) and check item 10D.
