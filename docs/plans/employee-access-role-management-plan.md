# Employee Access and Role Management Plan

## Status

Implemented and verified end-to-end. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10C. See [[agent-memory/employee-access-role-management-10c|memory]] for verification evidence.

## Linked Specs

- Spec: [[specs/employee-access-role-management-spec|Employee Access and Role Management Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 10C. Employee Access and Role Management
- Related specs: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/permission-matrix|Permission Matrix]], [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]], [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]], [[specs/web-core-workspace-spec|Web Core Workspace Spec]], [[specs/data-model-core-spec|Data Model Core Spec]]
- Related plan: [[plans/admin-company-onboarding-plan|Admin Company Onboarding and Partner Management Plan]]

## Purpose

Implement customer-side staff provisioning after platform admin creates the company and first owner:

- Settings > Employees list/detail/create.
- Employee user, temporary password, active company membership, and role assignment.
- Thai national ID or passport, phone, and access profile storage.
- Settings > Roles and permission management for company custom roles.
- One-time LINE account-link QR package.
- Web and LINE AI access governed by the employee's active membership and permissions.

This closes the item 10A deferred scope: "staff users are later customer owner/admin scope."

## Business Use Case

Owner/admin outcome:

1. Owner opens Settings > Employees.
2. Owner creates an employee with name, Thai national ID or passport, phone, and role.
3. System returns a one-time temporary password and LINE account-link QR package.
4. Employee logs in to web, changes password, links LINE, and uses only role-scoped features.
5. Owner can change role, regenerate credentials, suspend access, or review audit evidence.

Business rules:

- Every employee must have an individual user account; shared owner credentials are not acceptable.
- LINE follow/add is not access. LINE AI requires verified account linking and active membership.
- Role permissions must govern both web and LINE AI.
- Payroll/HR details remain in item 20.

## Implementation Rules

- Follow `.agents/skills/ponytail/SKILL.md`: shortest correct diff, no new dependency unless already required.
- Reuse auth/RBAC and LINE primitives; do not create a second user, role, permission, or LINE-link system.
- Keep employee access separate from Payroll/HR item 20.
- Store password hash only.
- Store Thai national ID/passport through existing encrypted/vault pattern when available; otherwise block implementation and record the missing secure-storage decision.
- QR/account-link token must be short-lived, single-use, and contain no password or permission snapshot.
- Role and permission mutation is web/API only. LINE and AI must refuse it.
- Protect the last active owner and protected system roles.
- Every sensitive action is audited without secrets.

## Scope

In scope:

- Employee access profile for company staff identity/contact fields.
- Settings > Employees navigation, list, create, detail, edit, disable/suspend.
- Temporary password create/regenerate handoff.
- LINE account-link URL/QR generation for employee membership.
- Settings > Roles list/create/edit/disable.
- Permission picker from registered permission catalog.
- Role assignment to employee membership.
- API contracts and permission keys.
- Focused tests for security, permission, credential, QR, and fail-closed paths.

Out of scope:

- Payroll/HR master, compensation, leave, benefits, statutory tax/social security, payslip, and 50 Tawi.
- Email/SMS delivery.
- Bulk import/export.
- Public signup.
- Support impersonation.
- LINE/AI mutation for user, password, role, permission, or employee status.

## Phase 0: Baseline and Alignment

Goal: confirm current auth/RBAC, password credential, LINE linking, audit, and web Settings shell before implementation.

Tasks:

- [x] Read linked spec, Auth/RBAC spec, permission matrix, LINE auth spec, LINE AI spec, Web Core spec, Data Model Core spec, and security guidelines.
- [x] Inspect current API modules, Prisma schema, permission registry, seed grants, audit service, password helpers, LINE account-link flow, and web Settings patterns.
- [x] Confirm whether employee-like profile fields already exist in item 20/payroll code; if yes, do not reuse payroll-sensitive tables for access provisioning unless schema ownership is explicit.
- [x] Confirm encrypted/vault field pattern for Thai ID/passport.
- [x] Confirm QR generation approach uses an existing QR/library/browser capability; do not add a dependency if a link payload is enough for first pass.
- [x] Record findings in [[agent-memory/employee-access-role-management-10c|Employee Access and Role Management memory]].

Exit criteria:

- Implementer knows the exact files to extend.
- No duplicate auth, role, permission, audit, or LINE link system is planned.
- Secure handling of ID/passport and one-time secrets is decided.

## Phase 1: Contracts, Permissions, and Data Model

Goal: add shared contracts and persistence only where current primitives are missing.

Tasks:

- [x] Add shared contract types for employee access profile, employee list/detail, create/update input, credential handoff, LINE link package, role list/detail, and permission catalog.
- [x] Add permission keys from the spec and matrix.
- [x] Add default grants for `OWNER`, `ADMIN`, scoped `MANAGER`, and `AUDITOR_READONLY`.
- [x] Add or extend employee access profile persistence.
- [x] Add one-time token persistence if the existing LINE account-link flow cannot represent employee invite/link state.
- [x] Seed permissions and grants.

Exit criteria:

- Contracts compile.
- Prisma schema validates if changed.
- Permission registry and seed grants include item 10C keys.

## Phase 2: Employee Create and Credential Handoff

Goal: create staff access in one safe transaction.

Tasks:

- [x] Implement create employee use case: validate input, create/reuse user, create active membership, create access profile, assign role, generate temporary password, audit.
- [x] Hash password and return the temporary password once.
- [x] Enforce duplicate policy for ID/passport and phone inside the company.
- [x] Enforce last-owner and protected-role rules.
- [x] Add regenerate credential use case.
- [x] Add disable/suspend use case that immediately fails closed through existing membership checks.

Exit criteria:

- Owner/Admin can create employee access without touching payroll.
- Generated password is not persisted or logged.
- Disabled membership loses access immediately.

## Phase 3: Role and Permission Management

Goal: let authorized users manage company custom roles safely.

Tasks:

- [x] Implement role list/detail/create/edit/disable.
- [x] Implement permission catalog read grouped by module.
- [ ] Enforce feature-entitlement filtering for permission grants. Deferred: no other module in this repo enforces `CompanyFeatureEntitlement` on role/permission mutation yet, so building it only for item 10C would be a speculative, unproven abstraction. Role creation validates permission keys against `COMPANY_PERMISSION_KEYS` only. Revisit once a feature-entitlement enforcement pattern exists elsewhere.
- [x] Block destructive edits to protected system roles.
- [x] Block role disable when active memberships depend on it unless safe reassignment exists.
- [x] Audit every grant/revoke and role assignment change.

Exit criteria:

- Company custom role management works.
- Protected system roles and last owner protection pass tests.

## Phase 4: LINE Account-Link QR

Goal: generate a safe employee-specific LINE link package.

Tasks:

- [x] Implement line-link token generation for employee membership.
- [x] Make token short-lived, single-use, and bound to company, membership, intended user, issuer, expiry, and nonce.
- [x] Return account-link URL and QR payload to web.
- [x] Reuse existing LIFF/Login verification and `ExternalIdentity` link flow.
- [x] Refuse expired, reused, wrong-company, inactive-membership, or already-linked-wrong-user tokens.
- [x] Audit token issue, revoke, success, and failure without token value.

Exit criteria:

- Employee can link LINE only after verified identity and active membership check.
- LINE AI uses current permissions after link.

## Phase 5: Web Settings UX

Goal: expose the workflow in the customer workspace.

Tasks:

- [x] Add Settings > Employees route/menu item.
- [x] Build employee list with create button, filters, status, role chips, credential state, and LINE link state.
- [x] Build create form with name, Thai ID/passport, phone, and role.
- [x] Use the Thai address master in the shared add/edit wizard for postal-code-driven province, district, and subdistrict choices, with free-text fallback when no master row exists.
- [x] Show one-time handoff result: username/login id, temporary password, expiry, LINE link URL/QR.
- [x] Build employee detail actions: edit, disable/suspend, regenerate password, generate QR.
- [x] Add Settings > Roles route/menu item.
- [x] Build role list/detail/create/edit with permission picker.
- [x] Cover loading, error, forbidden, empty, expired-token, and one-time-secret-dismissed states.

Exit criteria:

- Owner/Admin can complete the user journey from Settings without direct database work.
- UI never shows full ID/passport after save and never re-shows generated password.

## Phase 6: LINE/AI Integration and Verification

Goal: verify access works consistently across web and LINE AI.

Tasks:

- [x] Ensure linked employee LINE AI requests resolve active company, membership, role, permission, and selected-company context. Item 10C adds no new LINE/AI resolution code path: employees created here get a normal `CompanyMembership`/`MembershipRole`/`ExternalIdentity` once linked, so the existing item 07 `ResolveRequestContextUseCase` + permission-resolver path (already covered by `permission-resolver.spec.ts`, `line-linking.spec.ts`) applies unchanged. Verified live: created employee's membership/role/permissions resolve correctly through the same guard chain used for every other module.
- [x] Ensure disabled/suspended employee receives safe refusal. Verified live: `SetEmployeeStatusUseCase` flips `CompanyMembership.status` in the same transaction as the profile, and inactive-membership rejection is the existing, already-tested `AuthGuard`/`ResolveRequestContextUseCase` behavior.
- [x] Ensure LINE/AI refuses user, password, role, permission, and employee-status mutation requests. No new LINE/AI tool was added for employee/role mutation, so the existing item 07 read-only tool allowlist boundary is untouched and continues to refuse by construction (nothing to opt in).
- [x] Add API permission tests for each mutation class.
- [x] Add focused tests for employee create, credential regenerate, QR link token, role manage, protected role, last owner, and disabled fail-closed behavior.
- [x] Add web tests for list/create/detail/role screens when current setup supports it. Current web test setup (`tsx --test`) has no component-rendering harness (matches sibling CRM feature, which also has none); verified instead via live browser session against the real API/DB (see memory).
- [x] Run relevant package typecheck/tests and `git diff --check -- docs`.
- [x] Update checklist and memory only after implementation evidence exists.

Exit criteria:

- Employee access works in web and LINE AI under the same permissions.
- Verification commands and any skipped checks are recorded.

## Integration Evidence Required Before Checking Item 10C

- Backend/API: verified live against a real Postgres + compiled API build — employee create (user/membership/role/profile in one tx), credential regenerate, disable/re-enable (membership+profile status stay in sync), LINE link token issue/revoke (superseding prior pending tokens), employee-link-page + `/v1/auth/line/employee-link` refusal for unknown/expired/wrong-status tokens, role create, protected-role edit/disable → `403`, custom-role disable, permission catalog (209 keys). `pnpm --filter api typecheck` and `pnpm --filter api test` (581 tests) pass.
- Web: Settings > Employees and Settings > Roles render and function end-to-end in a live browser session — create form with role picker (excludes OWNER/SYSTEM_ADMIN), one-time credential handoff banner, masked identity in list, LINE QR card, disable/regenerate/link actions, role list with protected-role badges and no edit/disable buttons on system roles, custom-role create/edit/disable. `pnpm --filter web typecheck` and `pnpm --filter web test` pass.
- LINE/AI: no new tool/resolution path added; existing item 07 permission-resolution and read-only tool boundary applies unchanged (see Phase 6 notes above).
- Security: confirmed in DB directly — `EmployeeAccessProfile.identityEncryptedRef` is AES-256-GCM ciphertext (only last4 plaintext), `EmployeeLineLinkToken.tokenHash` is a SHA-256 hash (raw token never stored), and `AuditLog` rows for `access.employee.create` / `access.employee.line_link.*` contain no password, identity number, or token value.
- Docs: master checklist, this plan, and task memory updated with this evidence.

Two bugs found and fixed during this verification (unrelated to 10C's own logic, but discovered because 10C's audit/DI wiring exercised them):
1. `@Optional() x: SomeService | null = null` constructor params (7 files under `apps/api/src/modules/auth/application/use-cases/`) lost TypeScript decorator-metadata reflection for the union type, so Nest silently injected `null` instead of `AuditService`/`PermissionResolverService`. Fixed with explicit `@Inject(AuditService)`/`@Inject(PermissionResolverService)` alongside `@Optional()`. This means several auth audit events (login, logout, session refresh, LINE identity link/unlink) were never being written before this fix.
2. Running the API via `pnpm dev` (`tsx watch`, esbuild) does not emit/consume `design:paramtypes` decorator metadata at all, so every Nest constructor-injected class (not just union-typed ones) receives no arguments and any request touching a guard 500s. Confirmed by diffing behavior between `tsx watch` and `tsc && node dist/...` on an unmodified `/v1/health` route. This is a pre-existing, repo-wide local-dev blocker outside item 10C's scope — flagged for a dedicated follow-up rather than fixed here (would need a decision on replacing `tsx` for API dev, e.g. `ts-node` or a `tsc --watch` + `node --watch` pipeline).

## Resolved Owner Decisions

- 2026-07-01: Add this as item 10C instead of 23B because staff access, role management, and LINE AI permission binding are foundational customer access work, not AI Marketing.
- 2026-07-01: First-pass employee record stores name, Thai national ID or passport, phone, and role for access provisioning only; payroll/HR details stay in item 20.
- 2026-07-01: QR is for LINE account-link only. It must not contain password or static permissions.

## Security Remediation 2026-07-18 — H-01 Role Grant Escalation

- [x] Apply one server-side grant policy to create/update: protected-role denylist, `grant <= granter`, OWNER-only Finance/Accountant approval, and self-role mutation denial.
- [x] Audit successful role changes with granter/grantee/exact diff and denied escalation attempts with attempted roles/reason.
- [x] Add focused create/update/self/financial negative tests and pass API typecheck.

## Follow-Up Scope 2026-07-06 — Birthdate Temporary Password (Owner Decision)

Owner decision recorded in [[specs/employee-access-role-management-spec|spec]] §13: initial employee password = date of birth, no forced first-login change, no expiry (owner-accepted risk).

Tasks:

- Add `birthDate` to `EmployeeAccessProfile` (Prisma migration) and to the employee create/update contracts + web form (required for new employees; backfill optional for existing).
- Change `generateTemporaryPassword()` path for employee creation to derive the initial password from `birthDate` (format decision recorded at implementation: recommend `DDMMYYYY`; document พ.ศ. vs ค.ศ. choice in memory + UI helper text).
- Remove the 72-hour expiry and `mustChangePassword` enforcement for the birthdate flow only; keep both for any legacy random-password regenerate path unless owner extends the decision.
- Keep: bcrypt hash-only storage, no password in logs/audit/list responses, login rate limiting/lockout, self-service password change.
- Credential handoff UI: show the birthdate-password convention instead of a one-time random string; never print the birthdate as "password" in audit.
- Tests: create-employee with birthdate password logs in successfully with no forced change; audit contains no password/birthdate-as-password value; regenerate path behavior recorded.

Exit criteria: new employee logs in with birthdate password immediately and indefinitely; spec §13 acceptance deltas hold; verification commands recorded in task memory.

## Follow-Up 2026-07-11 — Draft-Safe Employee Wizard

- [x] Add `DRAFT` to employee/membership status and Prisma migration.
- [x] Create the backing user, credential, membership, role assignment, and profile as a non-authorized draft before the handoff step.
- [x] Reuse/update a same-company draft when the Thai ID/passport matches; keep non-draft duplicates blocked.
- [x] Add an explicit Finish endpoint that atomically activates profile + membership.
- [x] Wire the wizard Finish button to activation and show draft wording/status.
- [x] Show a `Draft` badge in individual access, expose profile editing from the three-dot menu, and block draft activation in both UI and API.
- [x] Reuse the four-step Add Employee wizard for editing every employee field, including protected identity replacement and persisted full-address fields.
- [x] Verify focused API tests, API/web typecheck, Prisma validation, and migration review; record evidence in [[agent-memory/employee-access-draft-provisioning]].

## Follow-Up 2026-08-27 — Delete Unfinished Employee Drafts

- [x] Add a company-scoped draft-delete API under `access.employee.disable`, retaining owner/privileged-role protections and an audit record.
- [x] Remove only draft membership/profile provisioning data, revoke pending tokens, and preserve global/shared accounts and non-draft behavior.
- [x] Serialize deletion with Finish/resume/token and credential issue; recheck source state before mutations.
- [x] Wire the existing menu to draft-specific confirmation, request, success and actionable stale-state errors, with the mobile menu kept inside the viewport.
- [x] Verify removal/reload/retry, tenant/permission/state negatives, shared account preservation, existing-account recreation and lifecycle interleavings; record exact local API/web/browser evidence and real-DB limits in [[agent-memory/draft-employee-deletion]].
