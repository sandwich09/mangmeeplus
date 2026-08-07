# Admin Company Onboarding and Partner Management Plan

## Linked Spec

- Spec: [[specs/admin-company-onboarding-spec|Admin Company Onboarding Spec]]
- Chart master follow-up: [[specs/chart-of-accounts-master-data-bootstrap-spec|Chart of Accounts Master Data Bootstrap Spec]] and [[plans/chart-of-accounts-master-data-bootstrap-plan|implementation plan]]
- Roadmap/checklist item: Auth/RBAC item 02 follow-up plus Web Core item 03 follow-up.
- Related ADRs: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]], [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Auth]]
- Related guidelines: [[guidelines/security-implementation-guideline|Security Implementation Guideline]], [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]], [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]

## Purpose

Implement system-admin-created customer onboarding plus platform partner management: create company, first owner account, temporary password, default setup including the reviewed company chart-of-accounts master, feature entitlement, approved AI model, WatchDog shared LINE OA setup, lifecycle actions, and customer handoff URL.

This is needed because the desired sales motion is admin-assisted setup and partner operation, not public self-signup or customer-data support access.

## Clarified End-to-End Flow

1. System admin creates the partner company.
2. System creates the first owner user with temporary credentials, OWNER membership, and the reviewed company-owned chart-of-accounts master in the same transaction.
3. System admin configures partner features, approved AI model, and WatchDog shared LINE OA/account-link readiness before handoff.
4. System admin gives owner the web URL, username, one-time temporary password, dashboard URL, WatchDog shared LINE OA add link/QR, and company-scoped account-link instructions.
5. Customer owner logs in for the first time.
6. Temporary handoff credentials default to `mustChangePassword=true`; password change is optional only if policy returns `mustChangePassword=false`.
7. Customer owner lands on `/companies/[companyId]/dashboard`.
8. Customer web UI shows enabled features only, then applies normal role/permission filtering.
9. Customer adds WatchDog shared LINE OA.
10. Unlinked LINE user receives account-link guidance only.
11. Customer links LINE through LIFF/web.
12. Linked user can ask read-only AI questions through LINE only when company lifecycle is active, membership is active, `ai_line_assistant` is enabled, and permission checks pass.
13. First-pass AI has no autonomous agent. It can read/summarize/cite/deep-link through permission-checked tools only; final mutations stay in web.

## Current Repository Context

- Apps/packages to inspect:
  - `apps/api/src/modules/auth`
  - `apps/api/src/modules/access-control`
  - `apps/api/src/modules/data-model-core`
  - `apps/api/src/modules/line-ai`
  - `apps/api/prisma/schema.prisma`
  - `apps/web/src/features/web-core-workspace`
  - `packages/contracts/src`
- Existing patterns to reuse:
  - `Company`, `User`, `CompanyMembership`, `Role`, `Permission`, `MembershipRole`
  - `ExternalIdentity`, selected-company context, and current `LineChannelBinding` code path to refactor away from company-by-channel routing
  - existing company status, AI Gateway model configuration, and encrypted-secret/vault primitive if present
  - LINE webhook signature verifier and account-link use cases
  - LINE AI unlinked-user refusal and read-only tool flow
  - request context resolver
  - permission registry
  - audit service
  - web workspace shell and forbidden/loading/error states
- Known dependencies:
  - Use current NestJS, Prisma, Next.js, and existing crypto/password primitives where present.
  - Do not add email/SMS or auth-provider dependency in first pass.
- Open implementation risks:
  - Existing Auth/RBAC spec originally made LINE Login primary and custom email/password out of scope. This plan adds platform-admin-created password credentials only for web login and first handoff.

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md`.
- Read `.agents/skills/ponytail/SKILL.md` before code edits.
- Keep smallest correct diff.
- Reuse auth/company/LINE primitives; do not duplicate tenant, role, permission, audit, or account-link modules.
- Store password hash only. Never log or persist generated temporary password.
- Customer must change temporary password before business module access.
- Seed permanent protected system admin `thawatchai.watchdog` through database seed.
- Initial system admin password is `watchdogbms11` for local/demo seed; production deployment should source it from a secret/env value before first run.
- Protected system admin cannot be deleted, disabled, demoted, renamed, or stripped of protected grants through normal flows, but password can be changed.
- Customer owner temporary password expires after 72 hours.
- First pass creates only the first owner account per company. Staff users are owned by item 10C Employee Access and Role Management as later customer owner/admin scope.
- LINE/AI remain read-only for onboarding and business data.
- AI model selection does not enable autonomous agents; it selects the approved model used by read-only AI flows.
- WatchDog shared LINE OA add/follow is not authorization. AI business answers require account link plus active membership and selected-company context.
- Multi-company LINE users must select company through LIFF/web before company-scoped AI answers.
- Shared LINE webhook must not resolve company from `messagingChannelId`; one shared channel serves all partners.
- Platform partner dashboard is metadata-only: no sales, stock, accounting, customer, staff, or other business records.
- Map inactive to `DISABLED`; add `ARCHIVED` soft removal if company lifecycle has no archive state.
- Store WatchDog shared LINE secrets encrypted and write-only. API/UI returns credential kind, status, timestamps, and validation health only.
- Per-company AI model must be selected from approved model identifiers.

## Scope

### In Scope

- System-admin permission keys.
- Protected system-admin seed user and protected super-user grant.
- Backend onboarding run use case.
- Password credential persistence if missing.
- Temporary password generation, hashing, expiry, regenerate flow, and forced change.
- Company, owner, membership, role, branch, sequence, notification defaults, and audit creation.
- Handoff payload with web URL, WatchDog shared LINE OA add URL/QR, and company-scoped LINE account-link URL.
- System-admin web onboarding page.
- Partner list primary create action that links to the onboarding creation page.
- System-admin partner list/detail dashboard with metadata-only visibility.
- Partner company create through onboarding flow, then edit, activate/inactivate/archive lifecycle from partner management.
- Per-company feature entitlement and approved AI model management.
- WatchDog shared LINE credential create/replace/rotate and safe health status.
- Shared LINE selected-company context for one-company, multi-company, and account-link target flows.
- Customer first-login forced password change.
- Customer owner `username` login identifier in first pass.
- LINE account-link entry from handoff.
- LINE webhook behavior for unlinked followers, linked one-company users, linked multi-company users, and suspended memberships.
- Focused tests for security and happy path.

### Out of Scope

- Public signup.
- Email/SMS delivery.
- Billing/subscription.
- Bulk staff import.
- First-phase staff creation during onboarding.
- Support impersonation.
- Customer business-data access through system-admin partner dashboard.
- Hard company deletion.
- Credential secret read-back, audit-log storage, or web exposure.
- Per-partner LINE Official Account provisioning.
- LINE mutation for company/user/password/permission setup.

## Role Gates

- BA gate: System admin onboards and operates partner companies without reading customer business data; customer starts web/LINE after active feature entitlement.
- SA gate: Reuses company tenant boundary, status, RBAC, audit, account-link, selected-company context, AI Gateway model allowlist, and existing secret/vault primitive. Platform dashboard is metadata-only and never grants company membership.
- DEV gate: Ponytail read; smallest diff extends existing onboarding/system module and refactors LINE company resolution once at the webhook/context resolver boundary.
- Integration gate: Verify system admin creates/edits/lifecycle-manages partner, feature entitlement, AI model, and shared LINE health; customer/LINE access respects active status, selected company context, and enabled features; platform user cannot read business records.

## Phase 0: Discovery and Alignment

### Goal

Confirm current auth, Prisma, permission registry, audit, web shell, and LINE link implementation before editing.

### Tasks

- [x] Read linked spec, Auth/RBAC spec, LINE auth spec, Web Core spec, Data Model Core spec, permission matrix, and security guideline.
- [x] Inspect current code paths for auth token issue, request context, membership, role grants, audit logging, LINE webhook handling, unlinked LINE replies, AI Gateway request context, and LINE account linking.
- [x] Confirm whether password credential model or helper already exists.
- [x] Confirm existing company lifecycle state, AI-model allowlist/configuration, and encrypted-secret/vault primitive before adding persistence.
- [x] Confirm current LINE webhook still maps `messagingChannelId -> companyId`; record shared-OA refactor scope before implementation.
- [x] Record blockers or accepted assumptions in `docs/agent-memory/admin-company-onboarding.md`.

### Tests

- None unless discovery changes code.

### Exit Criteria

- Implementation path has no duplicate auth/company/LINE model.

## Phase 1: Contracts, Permission Keys, and Persistence

### Goal

Add minimum backend contract and storage needed for onboarding and password handoff.

### Tasks

- [x] Add system-admin permission keys to registry.
- [x] Add shared contracts for onboarding request/response and temporary password handoff.
- [x] Add or reuse shared contracts for LINE handoff state: add URL/QR, account-link URL, selected company, unlinked state, linked state.
- [x] Add `UserCredential` if no password credential exists.
- [x] Add `CompanyOnboardingRun` if no existing onboarding run/audit record covers the need.
- [x] Add migration and seed grants for protected system admin.
- [x] Seed `thawatchai.watchdog` as permanent protected super user.
- [x] Seed initial password from env/secret, with local/demo default `watchdogbms11` if allowed by environment policy.
- [x] Add guard or policy so normal flows cannot delete, disable, demote, rename, or strip protected grants from `thawatchai.watchdog`.
- [x] Add platform partner-management permissions and shared contracts.
- [x] Add `ARCHIVED` company lifecycle state plus activated/disabled/archived timestamps; never hard delete.
- [x] Add/reuse per-company feature entitlement and approved AI-model configuration.
- [x] Add/refactor WatchDog shared LINE platform credential records with write-only API contract and safe health metadata.
- [x] Add selected-company context contract for shared LINE OA users.
- [x] Deprecate company-scoped LINE channel binding as company resolver for shared-OA webhook flow.

### Tests

- Permission registry no duplicates.
- Prisma validation/migration check.
- Credential model does not expose `passwordHash` in API contracts.
- Protected system admin cannot be removed or demoted through normal repository/use-case path.
- Seeded `thawatchai.watchdog` can authenticate and has onboarding permissions.
- Partner list/detail contract excludes business/financial fields and secret values.
- Credential persistence encrypts secret material and API/audit mapping cannot return it.

### Exit Criteria

- Backend can represent onboarding, partner lifecycle, feature entitlement, AI model, WatchDog shared LINE credential metadata, and selected-company context safely.

## Phase 2: Backend Use Cases and APIs

### Goal

Create transactional system-admin onboarding and customer password login/change flow.

### Tasks

- [x] Implement onboarding create use case as the primary partner-company create path.
- [x] Implement temporary password generation using existing crypto or Node crypto.
- [x] Hash password with existing auth pattern; if absent, use Node `crypto.scrypt`/`scryptSync` with per-credential salt.
- [x] Create company, owner user, membership, OWNER role grants, head office
  branch, notification defaults, onboarding run, and audit logs in one
  transaction; provision document sequences lazily on first use through Data
  Model Core.
- [x] Use `username` as first-pass login identifier for customer owner.
- [x] Set customer owner temporary password expiry to 72 hours.
- [x] Return WatchDog shared LINE OA add URL/QR and company-scoped account-link URL in one-time handoff package.
- [x] Implement regenerate temporary password use case.
- [x] Implement password login endpoint.
- [x] Implement forced password change endpoint.
- [x] Block business module access until password changed.
- [x] Implement platform partner list/detail metadata query.
- [x] Implement partner profile update and lifecycle transitions: active, disabled, archived; no hard delete endpoint.
- [x] Implement feature entitlement and approved AI-model update use cases.
- [x] Implement WatchDog shared LINE credential create/replace/rotate use cases with encrypted write-only payload and validation status.
- [x] Refactor LINE webhook company resolution from channel binding to linked identity plus selected company context.
- [x] Deny platform admin access to customer business-data routes unless future support access explicitly exists.

### Tests

- System admin creates onboarding.
- Non-system-admin denied.
- Duplicate login/company validation.
- Temporary password returned once.
- Temporary password older than 72 hours denied.
- Forced password change required.
- Audit events written.
- Partner list/detail excludes business fields and secrets.
- Disabled/archived partner denies customer web and LINE access.
- Disabled feature denies applicable runtime entry.
- Shared LINE credential response/audit logs never expose secret.
- Shared LINE channel does not answer company-scoped questions until company context is selected.

### Exit Criteria

- Customer can authenticate only while partner is active; platform admin can manage partner metadata/configuration without gaining business-data access.

## Phase 3: System Admin Onboarding and Partner Management UI

### Goal

Give WatchDog-BMS operator onboarding plus metadata-only partner management.

### Tasks

- [x] Add system-admin route guarded by system permission.
- [x] Add company and owner form.
- [x] Add optional LINE binding/link readiness fields.
- [x] Add create action with loading, validation, duplicate, forbidden, and error states.
- [x] Show one-time handoff package with web URL, login id, temporary password, dashboard URL, WatchDog shared LINE OA add URL/QR, and company-scoped LINE account-link URL.
- [x] Prevent password from reappearing after navigation/reload.
- [x] Add/update partner dashboard/list and detail page: company name/code, created/active dates, lifecycle status, feature entitlement, AI model, and LINE link/context health.
- [x] Add primary create action from partner list to `/system/company-onboardings/new`.
- [x] Add edit, activate/inactivate/archive actions with confirmation/error states.
- [x] Add feature toggle/configuration and approved AI-model selector.
- [x] Move LINE credential replace/rotate form out of partner detail into platform shared LINE settings; never render saved secret.
- [x] Ensure no customer business dashboard/record links exist in system admin UI.

### Tests

- Web form logic tests if logic is non-trivial.
- Browser/E2E path when existing framework is available.

### Exit Criteria

- Operator can onboard/manage partner configuration without direct database work or customer-data access.

## Phase 4: Customer First Login, LINE OA Add, and Account Link

### Goal

Let customer owner complete onboarding, add WatchDog shared LINE OA, link LINE identity, select/confirm company context, and use AI through company-scoped request context.

### Tasks

- [x] Add first-login password-change screen.
- [x] Route customer to company dashboard after password change.
- [x] Add LINE link CTA using existing LIFF/account-link flow.
- [x] Add handoff/rich-menu copy that explains: add WatchDog shared LINE OA first, then link account before AI can access company data.
- [x] Ensure unlinked LINE follower receives account-link CTA and no AI tool execution.
- [x] Bind verified LINE Login `providerUserId` to authenticated internal user only after invite/session/membership check.
- [x] Resolve one-company LINE users automatically and multi-company users through LIFF/web company selector without using channel-to-company binding.
- [x] Handle already linked, wrong account, expired link, and unlinked LINE states.
- [x] Ensure LINE AI/read-only tools use current membership and permission checks.

### Tests

- Temporary login -> password change -> dashboard.
- Add WatchDog shared LINE OA -> unlinked bot reply -> account-link CTA.
- LINE link success.
- Linked one-company user can ask read-only AI question.
- Linked multi-company user gets company selector before company-scoped AI answer.
- Unlinked LINE user denied business data.
- Suspended membership denies web and LINE access.
- System admin partner dashboard shows metadata-only data and omits customer business fields.
- Partner lifecycle/feature/model/credential UI has loading, validation, forbidden, error, and success states.

### Exit Criteria

- Customer can use web and linked LINE after onboarding.

## Integration Verification

- Backend/API contract: system-admin onboarding create is the primary partner-company create path; partner list/detail, lifecycle, feature entitlement, AI model, WatchDog shared LINE credential metadata/rotation, password login/change, LINE add/link handoff, selected-company context, and permission failures stay metadata-only and permission-checked.
- Web journey: system admin starts create from partner list, completes onboarding/handoff, returns to partner management to edit partner, changes lifecycle/features/model and shared LINE settings; customer logs in, changes password, reaches dashboard, adds WatchDog shared LINE OA, opens LINE link CTA, selects/confirm company context, and returns to web deep links.
- Loading/error/permission states: partner list/detail, create/edit, lifecycle confirmation, shared credential validation, forbidden system page, expired password, unlinked LINE, multi-company selection required, missing selected company context, disabled/archived partner.
- E2E/browser check: use existing E2E/browser automation if present; otherwise document exact reason not run.
- Commands:
  - `pnpm --filter @watchdog-bms/api test`
  - `pnpm --filter @watchdog-bms/web test`
  - focused browser smoke when app can run locally

## Risks

- Password auth expands security surface. Keep it limited to admin-created temporary credentials plus user-changed web password.
- Manual credential handoff can leak if sent through unsafe channels. First pass records warning and one-time display; email/SMS secure delivery can follow later.
- LINE identity is channel-scoped. Shared channel validation must fail closed, but company context must come from linked identity plus selected membership.
- Treating LINE follow as identity proof would leak data. Follow event must only start link-required guidance.
- Multi-company LINE ambiguity can leak wrong-company context. Require selected company before answering.
- Partner dashboard can become support impersonation by accident. Keep response DTO/UI metadata-only and add contract tests for excluded business fields.
- Shared credential read-back or audit logging would leak secrets. Use encrypted write-only storage and redacted audit metadata.

## Open Questions

- Should temporary password be sent manually only, or should email/SMS delivery be added later?

## Follow-up 2026-07-29 — Chart Master Integration

The original onboarding implementation is complete without chart bootstrap. The additive chart work is tracked in [[plans/chart-of-accounts-master-data-bootstrap-plan|Chart of Accounts Master Data Bootstrap Plan]], checklist item 10H.

That plan must fix the confirmed Tax Code header compatibility, hard-coded posting-code collisions, and bank ledger-link validation before automatic chart bootstrap is enabled. Onboarding must call the resulting bootstrap service inside its current transaction and must not report success when any chart row or post-condition fails.
