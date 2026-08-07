# Multi-Company Owner and Branch Scope Enforcement Plan

Spec: [[specs/multi-company-branch-scope-spec|Multi-Company Owner and Branch Scope Spec]]
Checklist: item 10D in [[plans/master-implementation-checklist|Master Implementation Checklist]]
Memory: [[agent-memory/multi-company-branch-scope-10d|task memory]]

Existing foundation (verified 2026-07-03): `branchScopeMode`/`defaultBranchId`/`MembershipBranchScope` in Prisma; `resolveBranchIds()` (data-model-core `branch.logic.ts`) already resolves `RequestContext.scopes.branchIds` for web and LINE; `ListExpensesFilter.branchId` in contracts; repository where-clause handles `branchId`; branches CRUD API exists (`company.branch.read|manage`); AuthGuard accepts `X-Company-Id` header. Gap = enforcement + management APIs + all web UI.

## Phase 1 — Multi-company trio (API + web)

1. `GET /v1/auth/me/companies`: active memberships in active companies → `{ data: [{ companyId, companyName, roles }] }`.
2. `GET /v1/auth/me`: add `scopes` to response.
3. Web header company switcher (AppHeader): fetch me/companies when signed in; dropdown; navigate `/companies/<id>/dashboard`; also fixes header showing raw companyId by using the real company name.
4. Onboarding attach mode: `attachExistingOwner?: boolean` on `POST /v1/system/company-onboardings`; existing ACTIVE user by username; membership+OWNER role+HO branch+run without user/credential/password; skip owner LINE-link token when an ACTIVE LINE identity exists; audit metadata `attachExistingOwner: true`; web onboarding form checkbox + handoff renders no-password variant.

## Phase 2 — Branch scope enforcement (API + LINE)

1. Shared helper next to `resolveBranchIds` (data-model-core domain logic): scope→Prisma predicate (`IN scope OR null`), in-scope assertion, create-default resolution (`defaultBranchId in scope → it; else first scoped; unrestricted → input ?? null`).
2. Expenses use-cases enforce: list/summary (merge scope predicate; explicit out-of-scope filter → 403), detail + mutations (out-of-scope record → fail closed), `CreateExpenseDraftUseCase` create-default (root cause: web + LINE document intake + upload all route through it).
3. Expense controller exposes `branchId` query param (contract already has it).
4. LINE inherits via same use-cases (`expense.list_recent` tool → ListExpensesUseCase; drafts → CreateExpenseDraftUseCase). Verify tool context `toCtx` carries `scopes.branchIds`.

## Phase 3 — Branch web UX

1. Settings > สาขา: page + feature component (list/create/edit via existing branches API), card link in settings hub.
2. Employee branch scope assignment: employee-access update use-case + controller accept `branchScopeMode`/`defaultBranchId`/`branchIds[]` (atomic replace, validate ACTIVE same-company branches, `SELECTED_BRANCHES` ≥1, audited); employee form UI.
3. Header branch selector: fetch branches + `/auth/me` (with `X-Company-Id`) scopes; "ทุกสาขา" + scoped branches; hidden when single effective branch; persists per company (localStorage); small React context in web-core-workspace provides `{branchId, setBranchId}`; Expenses list/summary consume it → `branchId` param.

## Phase 4 — Verification + docs

- Unit tests: scope helper logic; expenses list/create enforcement (in/out of scope, defaults); employee scope update guards; onboarding attach guards; me/companies shape.
- `pnpm --filter api test` + web tests + typechecks.
- Update checklist 10D status, task memory with evidence, spec corrections if scope shifted.

## Out of scope (backlog)

Branch enforcement in other modules (ledger/sales/inventory/bank/reports), LINE `/branches` commands + per-branch LINE breakdowns, per-branch sequences UI, server-persisted branch preference, full web session provider rework (dev-session fallback kept; switcher/selector fetch what they need directly).
