# Multi-Company Owner and Branch Scope Enforcement Spec

Status: Approved by owner 2026-07-03 (chat decisions recorded here)
Related: [[data-model-core-spec|Data Model Core Spec]] §10.3/10.4, [[auth-authorization-rbac-spec|Auth/RBAC Spec]], [[employee-access-role-management-spec|Employee Access Spec]], [[line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]], [[web-core-workspace-spec|Web Core Workspace Spec]], [[admin-company-onboarding-spec|Admin Company Onboarding Spec]], [[permission-matrix|Permission Matrix]]

## 1. Goal

Two related access-scope features, one phase:

1. **Multi-company owner**: one owner user holds many companies (1 LINE account ↔ 1 user ↔ many memberships). Web must let that user list and switch companies; system admin must be able to onboard a new company attached to an existing owner username without creating a new user.
2. **Branch scope enforcement**: one company has many branches (สาขา) used inside the same pages as a filter dimension — not a separate profile like company. Membership branch scope (`branchScopeMode` + `MembershipBranchScope`) becomes **enforced** on web API and LINE AI reads/creates, starting with Expenses.

## 2. Owner Decisions (2026-07-03)

- Branch visibility is **assignment-driven, not role-hardcoded**: whatever branch scope is assigned to the membership decides what the user sees. Owner default = see all branches (`ALL_BRANCHES`). A company manager can see multiple branches like an owner by being assigned `ALL_BRANCHES` or multiple `SELECTED_BRANCHES`.
- Branch scope enforcement is **this phase**, not a later phase.
- LINE answers and LINE-created drafts must also be scoped by the employee's branch.
- Branch UX lives in the same pages (header filter + per-page filters); no separate branch profile switcher.
- After password change, users go straight to the dashboard (already shipped); company switching happens inside the workspace.

## 3. Users and Journeys

- **Owner (multi-company)**: logs in → lands on a company dashboard → header company switcher lists all active memberships → picks another company → same workspace shell renders that company. In LINE, `/companies` + `/company <n>` already switch context (shipped in 10B scope).
- **System admin**: onboarding form has "attach to existing owner" mode → enters existing owner username + new company name → gets handoff package without a new password ("ใช้บัญชีเดิม").
- **Employee (branch-restricted)**: admin assigns branch scope in Settings > Employees → employee sees only assigned-branch records in web lists and LINE answers; receipts sent via LINE become drafts tagged with the employee's branch.
- **Owner/manager (all branches)**: header branch selector filters the same page by "ทุกสาขา" or one branch.

## 4. Branch Scope Model (already in Prisma, now enforced)

`CompanyMembership.branchScopeMode`: `ALL_BRANCHES` (default) | `SELECTED_BRANCHES` (≥1 `MembershipBranchScope` row) | `DEFAULT_BRANCH_ONLY` (uses `defaultBranchId`). `resolveBranchIds()` already maps mode → `string[] | undefined` (undefined = unrestricted) into `RequestContext.scopes.branchIds` for both web and LINE contexts.

Enforcement rules (new):

- `scopes.branchIds === undefined` → unrestricted; no branch predicate added.
- `scopes.branchIds` defined → reads match `branchId IN scopes.branchIds OR branchId IS NULL`. Records with `branchId = null` are **company-central** and visible to everyone in the company.
- Explicit `branchId` filter or create/update input outside `scopes.branchIds` → 403 Forbidden (no silent narrowing).
- Create defaults: a branch-restricted creator without an explicit `branchId` gets `defaultBranchId` when in scope, else the first resolved scoped branch. Unrestricted creators default to `null` (company-central) unless they pass `branchId` (e.g. web selector active).
- Detail/mutation on a record whose `branchId` is outside scope → 404/403 (fail closed), same shape as cross-company access.
- Backward compatibility: all existing memberships are `ALL_BRANCHES`, so enforcement changes nothing until an admin assigns a narrower scope.

## 5. API Contract

- `GET /v1/auth/me` — response gains `scopes` (existing `RequestContext.scopes`), so web can render the branch selector from the same source of truth.
- `GET /v1/auth/me/companies` — permission `account.session.read`; returns `{ data: [{ companyId, companyName, roles: string[] }] }` for the caller's ACTIVE memberships in ACTIVE companies, ordered by membership createdAt.
- `GET /v1/companies/:companyId/expenses?branchId=...` — expose existing contract filter; validated against scope. List/summary/detail/draft-create/update/confirm use-cases enforce §4 rules.
- Employee management (`employee-access`): update employee accepts `branchScopeMode`, `defaultBranchId`, `branchIds[]` (replaces `MembershipBranchScope` set atomically; `SELECTED_BRANCHES` requires ≥1 valid ACTIVE branch of the same company). Employee detail/list expose current scope. Audited like role changes.
- Onboarding: `POST /v1/system/company-onboardings` accepts `attachExistingOwner?: boolean`. When true: `ownerUsername` must belong to an existing ACTIVE user (else 409 with clear message); create company + OWNER membership (`ALL_BRANCHES`) + HO branch + run; skip user/credential/temporary password; handoff package shows "ใช้บัญชีและรหัสผ่านเดิม"; skip owner LINE-link QR when the user already has an ACTIVE LINE identity (LINE `/companies` covers switching). Audit records attach mode.
- Branch management uses existing `companies/:companyId/branches` routes (`company.branch.read` / `company.branch.manage`). No new permission keys this phase.

## 6. LINE AI Behavior

- LINE webhook already resolves `scopes.branchIds` into the tool context; ERP read tools execute through the same use-cases, so list/summary answers inherit branch scoping with no tool-schema change.
- LINE receipt/text drafts inherit the create-default rule (§4), tagging the employee's branch automatically.
- Multi-branch or unrestricted LINE users get company-wide answers (aggregate across their scope). Per-branch breakdown commands (`/branches`, `/branch <n>`) are backlog, mirroring `/company`.
- LINE user-submitted branch ids never override server-resolved scope (consistent with [[line-ai-read-only-assistant-spec|read-only assistant spec]] override bans).

## 7. Web UX

- **Company switcher** (workspace header): visible when `me/companies` returns >1; shows current company name; switching navigates to `/companies/<id>/dashboard`. Login/landing continues to the default membership; the switcher is the picker (no separate interstitial page).
- **Branch selector** (workspace header, same-page filter): options = "ทุกสาขา" + ACTIVE branches intersected with `me.scopes.branchIds` (all branches when unrestricted). Hidden when the user resolves to a single branch (auto-locked) or the company has one branch. Selection persists per company (client-side) and feeds page filters via query param, starting with Expenses list/summary.
- **Settings > สาขา**: list/create/edit branches (existing API): code, name, type, taxBranchCode, status. Code locked after business records reference the branch (per data-model-core rules).
- **Settings > Employees**: employee form gains branch scope assignment (mode + branch multi-select + default branch), following existing role-assignment UI patterns.

## 8. Security and Audit

- Scope resolution stays server-side only; route/query/body branch ids are validated against resolved scope, never trusted.
- `SELECTED_BRANCHES` with zero active scoped branches keeps failing closed (existing resolver 403).
- Employee branch-scope changes and attach-existing-owner onboarding are audited (HIGH risk level, same pattern as role changes / onboarding create).
- No raw tokens/passwords in handoff changes; attach mode returns no credential material.

## 9. Acceptance Criteria / Gate

- [ ] Owner with 2 companies can switch companies from the web header and sees data swap accordingly.
- [ ] Admin can onboard a second company onto an existing owner username; no new password issued; owner LINE keeps working with `/companies`.
- [ ] Employee with `SELECTED_BRANCHES=[A]` sees only branch-A + company-central expenses in web list/summary and LINE answers; requesting `branchId=B` returns 403; branch-B record detail is not accessible.
- [ ] LINE receipt from that employee creates a draft tagged branch A.
- [ ] Owner/manager with all-branch scope can filter the same Expenses page per branch via the header selector.
- [ ] Branch CRUD works from Settings > สาขา; employee branch scope assignable from Settings > Employees; both audited.
- [ ] Focused tests cover scope predicate building, create defaults, out-of-scope 403s, LINE draft tagging, and attach-existing-owner guards.

## 10. Backlog (explicitly out of this phase)

- Branch enforcement wiring for modules beyond Expenses (ledger, sales/CRM, inventory, bank, reports) — same helper pattern, per-module passes.
- LINE `/branches` + `/branch <n>` context commands and per-branch LINE breakdowns.
- Per-branch document sequences UI, branch transfer/merge, branch-level dashboards, per-branch permissions beyond scope filtering.
- Server-persisted branch selection preference.
