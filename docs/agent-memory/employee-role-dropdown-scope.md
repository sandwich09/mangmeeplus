# Agent Memory: employee-role-dropdown-scope

Status: Phases 1–5 implemented (2026-08-19, branch `feat/employee-role-picker-scope`); unit tests + typecheck green, browser/e2e pass not run.
- Spec: docs/specs/employee-access-role-picker-scope-spec.md (rules R1–R10; server-computed `assignableByCurrentUser` chosen over client mirror)
- Plan: docs/plans/employee-access-role-picker-scope-plan.md (Phases 1–5; adjacent findings register B1–B9)
- Checklist: Reorder Log entry added 2026-08-19.
Owner: thawatchai (proposal), agent discovery pass.
Scope: Proposal — role pickers shown to staff should list only roles the viewer can actually grant (and, on their own row, only their own role), instead of every role the store has followed by a 403.

## Problem as reported

พนักงานเห็น dropdown ที่แสดง role ทั้งหมดของร้าน เลือกแล้วเจอ error "ไม่มีสิทธิ์". ข้อเสนอ: แสดงเฉพาะ role ที่มีสิทธิ์ + ให้พนักงานเห็นว่าตัวเองถือ role ไหน.

## Surfaces found (live routes)

1. `/companies/:id/settings/access-overview` → `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
   - Role listbox dropdown at ~line 537 (`changeSelectedRole` ~line 358). Route gate: `access.employee.read`.
   - UI filter today: excludes OWNER/SYSTEM_ADMIN, inactive, and (when viewer lacks `access.role.manage`) roles with `hasPrivilegedGrant`.
   - Viewer-side gating ALREADY done (verified ~line 519): `selectedIsOwner || !canEditEmployee` renders a read-only RoleBadge (no chevron) instead of the picker button; `canEditEmployee = viewerPermissions.includes('access.employee.update')` (line 208). So read-only viewers (e.g. AUDITOR_READONLY) never get an interactive picker.
   - No self-row guard: viewer can open own row, pick any role → always 403 ("Users cannot change their own role assignment.", update-employee.use-case.ts ~55). Fix = extend the same read-only-badge branch to the self row.
2. `/companies/:id/settings/employees` → `AddEmployeePrototypePage.tsx` role chips (step 3, ~line 743; filter ~294). Same filter + keeps employee's current role.
3. Same access-overview page also has a role FILTER `ThemedSelect` (aria "เลือกตำแหน่ง", ~461–470; options `['ทุกตำแหน่ง', ...roles]` built ~267) listing every store role unfiltered — cannot 403 (view filter) but is the most visible "all roles of the store" dropdown a non-admin sees.
4. `EmployeeAccessPages.tsx` page components (role checkboxes, `assignableRoles` ~78) are NOT routed — file now serves as shared styles/helpers for the prototype pages. Ignore for fix (but it would regress the proposal if ever re-mounted).

## API guard (source of truth) — `roleGrantViolation`, apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts:36

Checks in order: (1) OWNER/SYSTEM_ADMIN never assignable; (2) requester is OWNER → allow; (3) role's raw permissionKeys must be ⊆ requester permissions; (4) FINANCE/ACCOUNTANT need `access.role.financial.assign` (registered CRITICAL, seeded to NO role → non-owner always 403). Plus self-change block in update-employee. Called from create-employee.use-case.ts:85 and update-employee.use-case.ts:63. Denials audit-logged then `ForbiddenException`.

## Gap = residual 403s the dropdown still allows

- Non-owner picks FINANCE/ACCOUNTANT (visible — they hold no PRIVILEGED_GRANT_KEYS) → 403 rule 4. Deterministic repro.
- Viewer with delegated `access.role.manage` but not full permission superset → 403 rule 3 (subset).
- Any viewer picks a role on their own row → 403 self-change.
- All 403s render as generic Thai "คุณไม่มีสิทธิ์ทำรายการนี้" (`error-message.logic.ts` maps every 403 → `error.forbidden`; server reason text intentionally hidden).

## Facts enabling the fix

- `listRoles` (GET settings/roles, needs `access.role.read`) returns every role WITH full raw `permissionKeys` → client can mirror the guard exactly.
- `viewerPermissions` passed to both pages = `fetchServerSession` = GET /v1/auth/me = same effective set the API guard receives. Parity OK.
- Precedent: capability packs already return per-item `grantableByCurrentUser` (list-capability-packs.use-case.ts:21) — same pattern could move role-grantability to the API.
- Shared guard constants already live in contracts (`PRIVILEGED_GRANT_KEYS`/`hasPrivilegedGrant` in access-matrix.ts, `FINANCIAL_ROLE_KEYS`/`NON_EDITABLE_ROLE_KEYS` in employee-access.ts) — a `grantableRoles()` helper belongs beside them.
- Branch selector precedent for "show only what you may pick": WorkspaceScope.tsx intersects branches with `me.scopes.branchIds` (branch-scope-visibility spec R3/R9).
- e2e harness `e2e/_roles-reference.spec.ts` can log in as every seeded QA role (`pageAs`) — use for verification.

## Decisions (specced 2026-08-19)

- Chose Option B: `listRoles` publishes per-role `assignableByCurrentUser` computed via `roleGrantViolation` (capability-pack precedent); web filters on the flag and never re-implements permission math. Server write guards unchanged (defense in depth).
- Current role stays pinned/visible in pickers even when not grantable; re-selecting it is a no-op (API evaluates grants only when the set changes).
- Self row and OWNER rows render the read-only badge; OWNER rows also lose the "แก้ไขข้อมูลพนักงาน" entry (B1). Degenerate one-option lists collapse to the badge.
- View-only role lists (filter dropdown "ทุกตำแหน่ง", permission-matrix rail) stay unfiltered.
- Sidebar shows ALL held roles (was roles[0]).

## Additional findings (subagent sweep, verified)

- Only ONE API lists company roles (GET settings/roles); its only callers are the four employee-access components. No reimbursement/workflow/expenses/CRM/LINE surface fetches company roles.
- No non-admin screen exists today that lists all store roles and 403s on selection — the gap lives entirely under employee-access.
- Proposal point 2 ("พนักงานรู้ role ตัวเอง"): no UI renders the member's own roles today. Sidebar shows only `session.roles[0]` (WorkspaceLayout.tsx:168); `MyCompany.roles` from /v1/auth/me/companies is fetched in WorkspaceScope.tsx but never displayed. `/v1/auth/me` (any session) is the right source.
- Spec ammo: employee-access-role-management-spec.md:101 documents the subset rule; v2 phase1 spec prescribes out-of-scope options rendered DISABLED WITH A REASON; contracts already carry `grantableByCurrentUser` (capability packs) and `droppedKeys.reason: 'above_granter_scope'` (role preview, employee-access.ts:291).
- Side inconsistency: `settings/employees/page.tsx` is the only employee-access route that skips `requireRoutePermission` (siblings guard); data still API-gated, UX shows load error instead of ForbiddenState.
- Related-but-different: reimbursement settings "บทบาทผู้อนุมัติเริ่มต้น" (ReimbursementsPages.tsx ~1603) is FREE TEXT for a role key; a typo/unheld role later blocks approvers with "บทบาทของคุณไม่ตรงกับผู้อนุมัติที่กำหนดไว้ในขั้นนี้" (not_eligible_approver_role). Fix there = ADD a constrained role picker (owner/admin-only page), separate work item.
- Positive in-repo precedent for "show only what you may act as": reimbursement claim sign tiles show ลงนาม only for `eligibleSignatureRoles` (reimbursements.model.ts:104–121).

## Implementation notes (2026-08-19)

- API: `ListRolesUseCase.execute(companyId, requester?)` sets `assignableByCurrentUser` per role by reusing `roleGrantViolation`; the requester arg is optional so `GetAccessMatrixUseCase` (no request context) keeps its unflagged read (spec R6).
- Web: one shared `features/employee-access/role-picker.logic.ts` (`assignableRoleOptions`, `isSelfEmployee`, `isRoleFieldReadOnly`) feeds both pickers — no client-side permission math anywhere now (`hasPrivilegedGrant` import dropped from both pages).
- B1 was already half-fixed at HEAD: the three-dot menu is wrapped in `!selectedIsOwner`, so only `editSelectedEmployee` needed the owner guard (now mirrors `deleteSelectedEmployee`).
- The wizard's `viewerPermissions` prop died with the client-side filter and was removed (its only consumer).
- Fail-closed nuance: an API build that does not send the flag makes every role non-grantable, so pickers collapse to the read-only badge. Acceptable (server-computed flag was the specced choice), but web and api must ship together.

Open questions:
- Whether the user also wants a self-service "my roles" display outside settings (proposal point 2 could be read that way).
Artifacts: this doc; spec + plan (phase boxes ticked).
Verification: `pnpm exec tsx --test` on `role-management.use-case.spec.ts` + 4 sibling employee-access specs (73 pass), full web suite `src/**/*.spec.ts` (966 pass, incl. new `role-picker.logic.spec.ts`), `tsc --noEmit` green for api/web/contracts.
Next: browser sweep as MANAGER/ADMIN/OWNER (picker contents, self row, sidebar at 390px) and a targeted `e2e/settings.spec.ts` run before merge.
