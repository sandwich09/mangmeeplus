# Auth RBAC Audit Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 02.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 1 only unless owner explicitly expands scope.

## Linked Specs

- [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- [[specs/permission-matrix|Permission Matrix]]
- [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- [[specs/platform-environment-config-spec|Platform Environment Config Spec]]
- [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]

## Purpose

Implement the security foundation for WatchDog-BMS before business modules ship:

- LINE Login identity validation and account linking.
- WatchDog-BMS first-party JWT/session issuance and verification.
- Server-derived request context with company membership.
- RBAC role/permission resolution.
- ABAC policy hook for record-level restrictions.
- Audit log persistence and redaction rules.
- AI Gateway permission inheritance and tool policy boundary.

## Current Repository Context

Existing scaffold:

- `apps/api`: NestJS ERP core with global `SecurityModule`, `DenyByDefaultGuard`, `@Public()`, and `@RequirePermissions(...)`.
- `apps/ai-gateway`: NestJS AI Gateway with matching deny-by-default guard skeleton.
- `packages/config`: shared config schema placeholder.
- `packages/contracts`: shared contract placeholder.
- No Prisma schema exists yet in the current repo snapshot.

The current guard expects `request.user.permissions`. Item 02 should replace that thin shape with a typed server-derived request context while preserving fail-closed behavior.

## Scope

### In Scope

- Prisma setup for ERP core identity/access/audit models if not already completed by item 01.
- Local signed dev JWT strategy for local/test only.
- First-party WatchDog-BMS JWT verifier/issuer interface and implementation.
- LINE Login verifier interface and production adapter contract.
- LINE Messaging webhook signature verifier.
- Account link/unlink use cases.
- Membership, role, permission, and scope resolution.
- Route permission enforcement from metadata.
- ABAC policy interface and first default policies.
- Audit service, repository, and required audit event taxonomy.
- API endpoints needed for login/session/me/account-link.
- Seed workflow for default roles and permissions.
- API tests for auth, membership, RBAC, ABAC hook, and audit.
- AI Gateway tool policy skeleton and tests proving no direct DB bypass.

### Out of Scope

- Full invite UI.
- Full MFA enrollment UX.
- Business modules such as inventory, accounting, tax, CRM, payroll, and reports.
- Final AI mutations.
- Production AWS provisioning.
- Native mobile app.
- Custom email/password auth.
- Full external accountant collaborator model beyond default role seed.

## Implementation Rule

Do not start business modules until protected routes deny by default, account linking works, and sensitive actions can be audited.

Production must fail startup when local/dev auth is enabled or LINE/JWT/audit config is unsafe.

## Role Gates

BA gate: Auth/RBAC/Audit protects owner/admin/manager/staff/auditor/LINE-linked user journeys by resolving identity, company membership, permissions, exceptions, and audit obligations before business modules ship.

SA gate: Architecture fits Nest API security/auth/access-control/audit modules plus AI Gateway auth boundary; Prisma owns users, external identities, memberships, roles, permissions, sessions, and audit logs; ABAC state transitions stay server-side.

DEV gate: Ponytail read; smallest correct diff keeps protected routes deny-by-default, centralizes permission/audit behavior, avoids business-module logic, and verifies API/AI focused tests plus Prisma validation.

Integration gate: Backend-to-AI contract verifies first-party JWT context, permission inheritance, no direct AI Gateway DB access, protected route failures, audit redaction, and no web/browser path because item 02 has no user-facing UI.

## Phase 1: Persistence, Contracts, and Seed

### Goal

Create the source-of-truth data foundation and typed contracts used by auth, RBAC, and audit.

### Tasks

- [ ] Add Prisma to `apps/api` if missing.
- [ ] Add `apps/api/prisma/schema.prisma` with the models listed in the spec handoff contract.
- [ ] Add migration scripts to `apps/api/package.json`.
- [ ] Add seed script for demo company, demo owner user, default permissions, and system roles.
- [ ] Add shared auth/request context types under `packages/contracts/src`.
- [ ] Add API domain models and repository ports for user, identity, membership, role, permission, and audit.
- [ ] Add infrastructure repository skeletons backed by Prisma.
- [ ] Document local seed credentials and tokens in `.env.example` using placeholder-only values.
- [ ] Keep raw tokens, secrets, and full payloads out of seed/log/audit data.

### Tests

- Unit test permission key registry has no duplicates.
- Unit test default role grants reference only existing permission keys.
- Migration validates locally against PostgreSQL.
- Seed creates one active company, one active owner membership, roles, permissions, and an audit-ready database.

### Exit Criteria

- `pnpm --filter @watchdog-bms/api typecheck` passes.
- `pnpm --filter @watchdog-bms/api test` passes.
- Local database can migrate and seed.
- Prisma schema includes required indexes and uniqueness constraints.
- No protected auth/RBAC code relies on client-provided roles or permissions.

## Phase 2: API Auth Boundary

### Goal

Authenticate requests and produce a trusted request context before protected routes run.

### Tasks

- [ ] Add `apps/api/src/modules/auth`.
- [ ] Add `TokenVerifierPort`, `TokenIssuerPort`, `LineIdentityVerifierPort`, and `SessionRepositoryPort`.
- [ ] Implement signed dev JWT verifier/issuer for `APP_ENV=local` and `NODE_ENV=test` only.
- [ ] Implement first-party WatchDog-BMS JWT verifier/issuer with issuer, audience, algorithm, expiry, and `kid`/secret strategy.
- [ ] Implement LINE Login verifier adapter contract.
- [ ] Add `RequestContextResolver` that maps token subject to internal user, company membership, roles, permissions, and scopes.
- [ ] Add request-context middleware/guard wiring before permission checks.
- [ ] Add endpoints:
  - `POST /v1/auth/dev/token` local/test only.
  - `POST /v1/auth/line/exchange`.
  - `POST /v1/auth/session/refresh`.
  - `POST /v1/auth/logout`.
  - `GET /v1/auth/me`.
- [ ] Update API OpenAPI metadata without exposing secret internals.

### Tests

- Public health route succeeds without auth.
- Protected route without token returns `401`.
- Protected route with invalid, expired, wrong-issuer, or wrong-audience token returns `401`.
- Local dev token endpoint is unavailable outside local/test.
- Unknown token subject returns `401`.
- Suspended user returns `403`.
- Missing company context for multi-company user returns `403`.
- Active single-company user can resolve default company context.

### Exit Criteria

- Every protected API request has a typed request context.
- Production config rejects dev auth.
- Error responses do not reveal token validation internals.

## Phase 3: Membership and RBAC Enforcement

### Goal

Resolve company membership and enforce route permission metadata consistently.

### Tasks

- [ ] Add `apps/api/src/modules/access-control`.
- [ ] Add `PermissionResolver` and `MembershipAccessResolver`.
- [ ] Replace guard use of `request.user.permissions` with typed request context permissions.
- [ ] Keep `@Public()` and `@RequirePermissions(...)` as the controller-level pattern.
- [ ] Add optional `@AuditAction(...)` metadata only where helpful for audit integration.
- [ ] Add sample internal test controller under test-only module or fixture.
- [ ] Add cache boundary for permission resolution using configured short TTL if Redis/cache exists; otherwise keep direct lookup and document cache follow-up.

### Tests

- Protected route without permission metadata returns `403`.
- Authenticated user without company membership returns `403`.
- Authenticated user without required permission returns `403`.
- Authenticated user with required permission succeeds.
- Role with duplicate permission grants resolves unique permission keys.
- Disabled membership immediately denies access.

### Exit Criteria

- No business route can be added without explicit permission metadata.
- Permission checks are server-side and company-scoped.
- OWNER role gets broad grants through seeded permissions, not through hard-coded bypass.

## Phase 4: ABAC Hook and Policy Defaults

### Goal

Prepare record-level policies needed by later modules without implementing module-specific business logic.

### Tasks

- [ ] Add `PolicyEvaluatorPort`.
- [ ] Add policy result type: `allow`, `deny`, `not_applicable`.
- [ ] Add default policies for company boundary, own record, team scope, branch scope, location scope, amount limit, document status, and closed period hook.
- [ ] Add helper for use cases to request policy checks after RBAC and before business mutation.
- [ ] Add tests with fake records and fake scopes.

### Tests

- Cross-company record denies or hides according to endpoint policy.
- Own-record policy allows owner/requester and denies other user.
- Branch/location scope denies access outside allowed scope.
- Amount limit denies over-limit approval.
- Policy denial returns `403` without exposing hidden record details.

### Exit Criteria

- Later modules can attach ABAC checks without redesigning auth.
- RBAC and ABAC remain separate in code and tests.

## Phase 5: Audit Foundation

### Goal

Persist security-relevant access and mutation events with redacted metadata.

### Tasks

- [ ] Add `apps/api/src/modules/audit`.
- [ ] Add `AuditLogRepositoryPort` and Prisma repository.
- [ ] Add `AuditService.record(...)`.
- [ ] Add audit metadata sanitizer/redactor.
- [ ] Add `AuditAction` enum/taxonomy matching the spec.
- [ ] Add automatic audit for login mapping failure, account link/unlink, company switch, role/permission change, export, and sensitive sample mutation.
- [ ] Add `GET /v1/audit/logs` protected by `audit.log.read` with pagination, tenant filter, and role/category ABAC filter.
- [ ] Ensure audit failures fail closed for high-risk mutations and fail with explicit error for required audit events.

### Tests

- Sensitive mutation writes audit log.
- Role change writes audit log.
- Audit metadata redacts tokens, cookies, auth headers, raw prompts, and full document payloads.
- Audit query is tenant-scoped and permission-protected.
- Audit query applies role/category ABAC: full company for OWNER/AUDITOR_READONLY, admin/security for ADMIN, accounting/tax/finance for ACCOUNTANT.
- High-risk mutation does not silently succeed if audit write fails.

### Exit Criteria

- Audit trail exists before inventory/accounting/tax mutations.
- Audit log cannot leak secrets or cross-tenant records.

## Phase 6: LINE Account Linking and Webhook Trust

### Goal

Link LINE identities to internal users and reject untrusted LINE events.

### Tasks

- [ ] Implement LINE identity validation adapter behind `LineIdentityVerifierPort`.
- [ ] Implement account link and unlink use cases.
- [ ] Implement LINE Messaging signature verifier.
- [ ] Add shared LINE channel validation plus selected-company context lookup; do not map company from `messagingChannelId` for WatchDog shared OA.
- [ ] Add webhook entrypoint that verifies signature before parsing business intent.
- [ ] Return link/invite-required response for unknown or unlinked LINE user.
- [ ] Audit link, unlink, failed mapping, and signature validation failures where safe.

### Tests

- Invalid LINE signature returns `401` or `403`.
- Expired LINE token fails exchange/link.
- Wrong LINE channel/audience fails.
- Unknown LINE user receives link/invite-required response and no business data.
- User removed from company cannot query that company from LINE.

### Exit Criteria

- LINE proves identity only; WatchDog-BMS remains authorization source of truth.
- Unlinked LINE users never see business data.

## Phase 7: AI Gateway Permission Boundary

### Goal

Ensure AI Gateway cannot bypass ERP core permissions when tools are added later.

### Tasks

- [ ] Add shared request context verifier in `apps/ai-gateway` for first-party tokens.
- [ ] Add tool policy model with required permission, risk level, confirmation requirement, and audit requirement.
- [ ] Add AI tool guard/interceptor skeleton that denies missing context, missing policy, missing permission, disabled audit, or final mutation.
- [ ] Ensure AI Gateway has no direct Prisma/database access to ERP source tables.
- [ ] Add stub/smoke tool endpoint or test fixture only, not real business tools.
- [ ] Add audit call contract to ERP core for sensitive tool invocation.

### Tests

- AI tool invocation without auth returns `401`.
- AI tool invocation without policy returns `403`.
- AI tool invocation without required permission returns `403`.
- AI final mutation is blocked by default.
- AI Gateway cannot import/use ERP Prisma client or direct business repositories.
- Sensitive AI tool invocation produces audit event through ERP core contract.

### Exit Criteria

- AI Gateway inherits user permissions and record scope.
- Later AI tools have a required policy/audit path before implementation.

## Required Commands

Run after each phase when relevant:

```sh
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/ai-gateway test
pnpm build
pnpm test
pnpm security:audit
```

Database phases also run migration/seed commands added by implementation.

## Integration Verification

- API auth boundary: protected routes without tokens return `401`; protected routes without permission metadata or missing permission return `403`.
- RBAC/ABAC boundary: server-derived request context and company membership drive permissions; client-supplied company hints are not trusted.
- Audit boundary: sensitive metadata redacts tokens, cookies, auth headers, raw prompts, full payloads, and oversized strings before persistence.
- AI Gateway boundary: WatchDog JWT verification provides user/session/permissions, `ai.tool.invoke` is required, final mutation remains blocked by default, and direct Prisma/DB access is absent from AI Gateway.
- UI/browser path: not applicable for item 02; web shell begins in item 03.

## Review Checklist

- [ ] Public routes are explicit with `@Public()`.
- [ ] Protected routes have `@RequirePermissions(...)`.
- [ ] Request context is server-derived.
- [ ] `X-Company-Id` is a selection hint only and is verified.
- [ ] No route trusts client-submitted role, permission, company ownership, price, tax, approval, or stock values.
- [ ] Auth errors do not leak token internals.
- [ ] Audit metadata redacts secrets and large/sensitive payloads.
- [ ] Role/permission changes are audited.
- [ ] AI Gateway has no direct ERP database bypass.
- [ ] Production rejects dev auth and disabled audit.

## First Sonnet 4.6 Handoff

Use this exact scope for the first implementation turn:

```text
Read:
- docs/plans/master-implementation-checklist.md
- docs/specs/auth-authorization-rbac-spec.md
- docs/specs/permission-matrix.md
- docs/specs/line-ai-channel-auth-spec.md
- docs/plans/auth-rbac-audit-plan.md
- docs/specs/platform-environment-config-spec.md
- docs/guidelines/security-implementation-guideline.md
- docs/guidelines/backend-hexagonal-code-style.md

Confirm item 02 is the target.
Implement Phase 1 only from docs/plans/auth-rbac-audit-plan.md.
Do not implement LINE production login, AI tools, business modules, or UI.
Add/adjust tests required by Phase 1.
Run relevant typecheck/test commands and summarize results.
If Prisma or database assumptions conflict with current repo state, report the adjustment before coding.
```

## Risks

- Prisma schema choices affect all later modules.
- Local dev auth can become a production bypass if config validation is weak.
- Role grants can drift from `docs/specs/permission-matrix.md` if seeded from scattered constants.
- Audit can leak sensitive data if metadata redaction is not centralized.
- AI Gateway can accidentally bypass ERP core if tool authors add direct database access.

## Owner Decisions

- `ACCOUNTANT` starts as a normal company membership role. A separate external collaborator model is deferred.
- Branch/location policy hooks are created in item 02. Mandatory enforcement starts with Inventory MVP and expands by module.
- Full company audit visibility belongs to `OWNER` and `AUDITOR_READONLY`. `ADMIN` gets admin/security audit categories; `ACCOUNTANT` gets accounting/tax/finance audit categories through ABAC filtering.
- OWNER MFA policy hooks cover role/permission changes, exports, tax actions, period close/unclose, and voiding issued documents. Full MFA UX is deferred.
- First LINE account linking flow uses admin-created user/invite link. Self-join is deferred.
