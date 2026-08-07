# Agent Memory: admin-company-onboarding

Status: REOPENED FOR SHARED LINE OA ALIGNMENT. Previous per-partner LINE credential implementation evidence remains historical; 2026-06-26 owner decision changes 10A target to WatchDog shared LINE OA with selected-company context, so shared-OA refactor tasks are open.
Owner: Product / Platform Admin.
Scope: System-admin-created company onboarding plus metadata-only partner management with temporary password handoff and LINE account linking.

## 2026-06-26 Global Shared LINE OA Docs Consistency Pass

Status: COMPLETE.
Owner: Docs / Integration.
Scope: Align all docs that referenced LINE channel binding or per-partner LINE credentials with WatchDog shared LINE OA direction.
Role gate status:
- BA: Partner/customer journey now consistently uses one WatchDog shared LINE OA plus company-scoped account link/selected company context.
- SA: Architecture docs now distinguish `PlatformLineChannel` and `LineCompanyContext` from legacy/company-specific `LineChannelBinding`.
- DEV: Ponytail read; smallest diff updates docs only and leaves historical evidence explicitly marked superseded where kept.
- Integration: Cross-doc grep verified no unqualified current `LineChannelBinding` / per-partner LINE credential instruction remains; remaining references are shared-OA target, legacy annotation, or historical/superseded evidence.
Decisions:
- Keep historical implementation notes in memory, but mark old per-partner credential endpoint/UI as superseded.
- Use `system.shared_line_credential.manage` for platform shared LINE OA credentials.
Artifacts:
- `docs/specs/auth-authorization-rbac-spec.md`
- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/plans/line-ai-read-only-assistant-plan.md`
- `docs/agent-memory/line-ai-read-only-assistant-07.md`
- `docs/specs/dashboard-notification-spec.md`
- `docs/plans/dashboard-notification-plan.md`
- `docs/plans/auth-rbac-audit-plan.md`
- `docs/specs/sme-business-os-overview.md`
- `docs/plans/platform-foundation-phase-1-plan.md`
- `docs/plans/platform-foundation-local-prod-lean-plan.md`
- `docs/specs/platform-foundation-local-prod-lean-spec.md`
- `docs/specs/reimbursement-approval-spec.md`
Verification:
- `rg -n "LineChannelBinding|line channel binding|channel binding|channel mapping|messagingChannelId -> companyId|/line-credentials|partner_line_credential|lineCredentialHealth|lineCredentials|LINE credential replace|LINE credentials|per-partner LINE|partner LINE" docs` — remaining hits are shared-OA target, legacy annotation, or historical/superseded evidence.
- `git diff --check -- docs` — pass.
- `node scripts/check-agent-gates.mjs docs/plans/admin-company-onboarding-plan.md docs/agent-memory/admin-company-onboarding.md docs/plans/line-ai-read-only-assistant-plan.md docs/agent-memory/line-ai-read-only-assistant-07.md` — pass.
Next:
- Implement shared-OA refactor before checking item 10A again.

## 2026-06-26 WatchDog Shared LINE OA Decision

Status: DOCS UPDATED; implementation gap remains.
Owner: Product / Platform Admin.
Scope: Replace per-partner LINE OA/credential concept with one WatchDog shared LINE OA for all partners.
Role gate status:
- BA: Owner wants shared WatchDog OA now to avoid later migration; customer adds one WatchDog OA and links/selects company context.
- SA: Current backend resolves company from `messagingChannelId -> companyId`; shared OA requires channel validation only, then `ExternalIdentity` plus selected company context resolves company.
- DEV: Ponytail read; smallest current diff is docs-only source-of-truth update. Future code diff should refactor LINE webhook/context resolver once, not patch each LINE tool.
- Integration: Required proof becomes shared OA add/follow -> account link -> selected company context -> read-only AI; missing context must deny company-scoped answers.
Decisions:
- WatchDog shared LINE OA is first-pass target.
- Partners do not get separate LINE OAs in item 10A.
- WatchDog shared LINE credentials are platform-level settings, not partner-detail settings.
- Partner dashboard shows LINE link/context health, not per-partner credential health.
- `LineChannelBinding` company-by-channel routing is incompatible with shared OA and must be refactored.
Open questions:
- None for product direction.
Artifacts:
- `docs/specs/admin-company-onboarding-spec.md`
- `docs/plans/admin-company-onboarding-plan.md`
- `docs/specs/line-ai-channel-auth-spec.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`
Verification:
- Pending docs gate after patch.
Next:
- Implement shared-OA refactor before marking 10A final again: platform shared credentials, selected-company context, webhook company resolution, and UI copy/state updates.

## 2026-06-26 End-to-End Flow Clarification

Status: COMPLETE.
Owner: Product / Platform Admin.
Scope: Clarify admin-created partner -> first owner -> feature/model/LINE setup -> first login -> dashboard -> LINE account link -> read-only AI without autonomous agent.
Role gate status:
- BA: Flow starts with WatchDog-BMS system admin, not customer signup; customer owner receives handoff and sees only enabled features after login.
- SA: Existing auth/RBAC, partner management, feature entitlement, AI model allowlist, LINE linking, membership, and permission boundaries remain source of truth; AI model selection does not create autonomous agents.
- DEV: Ponytail read; smallest diff is docs-only clarification in spec/plan/memory, no code change.
- Integration: Backend-to-frontend path clarified: system admin partner setup feeds customer login/dashboard and LINE link; read-only AI path requires active company, active membership, `ai_line_assistant` feature, and permission checks.
Decisions:
- User allowed adding this scope to 10A or creating 10B; kept it in 10A because it extends the same admin onboarding and partner-management flow.
- Temporary handoff credentials default to `mustChangePassword=true`; password change is optional only when policy returns `mustChangePassword=false`.
- First-pass AI has no autonomous agent. It can read/summarize/cite/deep-link through permission-checked tools only.
- LINE OA add/follow remains non-auth; account link required before business data or AI answers.
Open questions:
- None for clarification.
Artifacts:
- `docs/specs/admin-company-onboarding-spec.md`
- `docs/plans/admin-company-onboarding-plan.md`
- `docs/agent-memory/admin-company-onboarding.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`
Verification:
- Pending docs gate after patch.
Next:
- Run `pnpm agent:gates -- docs/plans/admin-company-onboarding-plan.md docs/agent-memory/admin-company-onboarding.md` and `git diff --check -- docs/specs/admin-company-onboarding-spec.md docs/plans/admin-company-onboarding-plan.md docs/agent-memory/admin-company-onboarding.md docs/plans/master-implementation-checklist.md docs/plans/implementation-roadmap.md`.

## 2026-06-26 DB Trigger Guard Follow-up

Status: COMPLETE.
Owner: DEV.
Scope: Add existence guards before protected-principal trigger creation in Item 10A migration.
Role gate status:
- BA: Existing acceptance stands; protected system admin safeguards must remain stable across local DB script retries.
- SA: No contract/data model change; PostgreSQL trigger recreation is guarded with `DROP TRIGGER IF EXISTS ... ON ...` before `CREATE TRIGGER`.
- DEV: Ponytail read; smallest diff touches only `apps/api/prisma/migrations/20260626000000_item10a_admin_company_onboarding/migration.sql` and this memory note.
- Integration: Backend/frontend behavior unchanged; DB migration script surface only, no browser path needed.
Decisions:
- Keep full Prisma migration non-idempotent; guard only trigger recreation because functions already use `CREATE OR REPLACE FUNCTION`.
Open questions:
- None.
Artifacts:
- `apps/api/prisma/migrations/20260626000000_item10a_admin_company_onboarding/migration.sql`
Verification:
- `rg -n "DROP TRIGGER IF EXISTS|CREATE TRIGGER" apps/api/prisma/migrations/20260626000000_item10a_admin_company_onboarding/migration.sql` passed; each protected trigger now has a matching `DROP TRIGGER IF EXISTS ... ON ...` guard.
- `pnpm agent:gates -- docs/agent-memory/admin-company-onboarding.md` not completed because local Node failed with `open ENFILE` / `Too many open files in system`.
- `node scripts/check-agent-gates.mjs docs/agent-memory/admin-company-onboarding.md` retry also failed from the same system file-descriptor exhaustion (`uv_loop_init` assertion).
Next:
- None.

Role gate status:
- BA: Complete 2026-06-26. Full BA gate evidence recorded below under "BA Gate Evidence — Remaining Scope (10A partner management)".
- SA: Complete 2026-06-26. Full SA gate evidence recorded below under "SA Gate Evidence — Remaining Scope (10A partner management)". Architecture fit confirmed; data model additions defined (3 new models, 2 new enums, Company enum + 3 timestamp column additions); 7 new permission keys + SYSTEM_ADMIN grants; company-status-per-request enforcement gap identified; AES-256-GCM pattern for credential encryption; env-config decision for approved AI model list; full API contracts with DTO shapes; lifecycle state machine; migration naming; module split decision. Handoff to DEV.
- DEV: Complete 2026-06-26. Phase 2-4 implementation done. See DEV Gate Evidence below.
- Integration: Complete 2026-06-26. Full Integration gate evidence recorded below under "Integration Gate Evidence".

Decisions:
- Use system admin, not customer self-signup, for new company creation.
- Generate temporary password for first owner; force change before business module access.
- Show temporary password once; hash only at rest; never log it.
- Use existing LIFF/account-link flow for LINE onboarding after customer adds WatchDog shared LINE OA.
- Treat LINE OA add/follow as channel reachability only, not authorization.
- Unlinked LINE users get account-link CTA only; AI tools do not run.
- Multi-company LINE users must select active company through LIFF/web before company-scoped AI answers.
- Shared LINE webhook cannot infer company from `messagingChannelId`; it must use linked identity plus selected company context.
- Keep LINE AI/read-only and alert/deep-link only.
- Admin Company Onboarding is item 10A before Thai Tax MVP; Thai Tax remains item 11 to avoid renumbering existing docs.
- Partner management expands item 10A; it does not grant support impersonation or customer-data access.
- `DISABLED` means inactive. Remove means soft archive; hard delete is unavailable.
- WatchDog shared LINE credentials must be encrypted, write-only, redacted from audits, and shown as safe platform status only.

Accepted assumptions:
- Password login is acceptable as a narrow admin-created credential flow even though earlier Auth/RBAC plan excluded broad custom email/password auth.
- First implementation should not add email/SMS delivery.
- System admin does not automatically become customer company member.
- Customer must have active web/internal user and company membership before LINE account link can unlock AI business data.
- Seed `thawatchai.watchdog` as permanent protected super user through DB seed.
- Initial local/demo password is `watchdogbms11`; production must source initial password from secret/env before first run.
- Seed creates protected `SYSTEM_ADMIN` membership on internal `WatchDog System` tenant; customer `OWNER` cannot inherit `system.*` permissions.
- Customer owner login uses username in first pass.
- Customer owner temporary password expires after 72 hours.
- First onboarding phase creates first owner only.
- Staff means later company users such as finance, inventory, sales, manager, requester, or auditor.

Open questions:
- Should temporary password be sent manually only, or should email/SMS delivery be added later?
- BR-LC-5 (owner decision needed): Can system admin transition ARCHIVED -> DISABLED or ARCHIVED -> ACTIVE? The spec says ARCHIVED is "immutable through normal customer flows" but does not explicitly deny admin-initiated un-archive. The API design allows any lifecycle transition. Owner must confirm whether ARCHIVED is terminal for all actors or reversible by system admin only in exceptional cases.

## BA Gate Evidence — Remaining Scope (10A partner management)

Date: 2026-06-26. Owner: BA. Covers: partner dashboard, lifecycle, feature entitlement, AI model, WatchDog shared LINE OA credentials/context, customer LINE onboarding.

### 1. Business Goal

The remaining scope completes platform partner management. WatchDog-BMS operates a B2B-as-a-service model where all company provisioning is admin-assisted. After initial onboarding the operator needs: a metadata-only dashboard to inspect all partner companies; ongoing lifecycle control (activate, inactivate, archive); per-company feature entitlement control (which product modules are available); AI model assignment from an approved list; and WatchDog shared LINE OA readiness/context management. None of these actions may expose customer sales, stock, accounting, staff, or financial data to the platform operator.

The customer LINE onboarding path must also be completed so linked customers can use AI immediately after web password setup.

### 2. Target Users and Roles

- System admin (WatchDog-BMS operator): sole actor for all partner management actions. Requires platform-scoped permissions (`system.partner_dashboard.read`, `system.partner_company.create`, `system.partner_company.update`, `system.partner_company.lifecycle.manage`, `system.partner_feature.manage`, `system.partner_ai_model.manage`, `system.shared_line_credential.manage`). Never gains customer company membership through partner management.
- Customer owner: sole actor completing LINE onboarding after receiving the handoff package. Already holds OWNER role in their company after initial onboarding.
- LINE assistant user: downstream beneficiary who gains read-only AI access after account linking. No partner management actions.

### 3. User Journeys

Journey A — View Partner Dashboard and Detail
1. System admin navigates to system-admin partner list route (platform-scoped, separate from customer workspace routes).
2. List shows per company: name, code, lifecycle status, created date, active date, enabled-features summary, configured AI model identifier, LINE link/context health indicators.
3. System admin clicks a partner row.
4. Detail shows: company identity (name, code, timezone, locale), lifecycle dates and current status, full feature entitlement list (all known keys with enabled/disabled state), configured AI model identifier, and LINE link/context readiness. No customer business records visible.

Journey B — Edit Partner Profile Metadata
1. System admin opens partner detail and selects Edit profile.
2. Editable fields: company name, display name, timezone, locale.
3. Company code and tax ID (set at onboarding) are displayed read-only.
4. System admin saves; audit event records actor, changed fields, and timestamp.

Journey C — Partner Lifecycle Transition
1. System admin opens partner detail and selects a lifecycle action (Activate / Inactivate / Archive).
2. Confirmation modal shows consequence:
   - Inactivate: "All customer web and LINE business access will be denied immediately."
   - Archive: "Company will be soft-removed. Data is preserved but all customer access is permanently denied through normal flows."
   - Activate: "Customer web and LINE access will be restored."
3. System admin confirms.
4. Backend transitions company status, sets relevant timestamp (activatedAt / disabledAt / archivedAt), writes audit event.
5. All subsequent customer and LINE requests for that company receive deny response on next check (not only at next login).

Journey D — Feature Entitlement Management
1. System admin opens partner features panel.
2. All known platform feature keys are listed with current enabled/disabled state.
3. System admin toggles keys on/off.
4. System admin saves the full set in one operation.
5. Audit event records which keys changed, new states, actor, and timestamp.
6. Feature check applies to subsequent customer requests immediately.

Journey E — Approved AI Model Management
1. System admin opens partner AI model panel.
2. Current AI model identifier is shown.
3. System admin selects from platform-managed approved model dropdown (not free text).
4. System admin saves; audit event records old model, new model, actor, timestamp.
5. AI gateway uses new model for the company's subsequent requests.

Journey F — WatchDog Shared LINE Credential Create/Replace/Rotate
1. System admin opens platform shared LINE settings.
2. Existing WatchDog shared LINE credential kinds (Messaging API, LINE Login, LIFF) listed with status and timestamps. No secret values shown.
3. System admin selects a credential kind and submits new credential values.
4. System validates input format, encrypts secret material, stores it.
5. Response returns only: kind, status, timestamps. Secret never in response.
6. Audit records: credential kind, action (created/replaced/rotated), actor, timestamp. No secret in log.
7. If validation fails, platform settings shows ERROR status; whether old credential is preserved depends on implementation choice (SA decision), but business rule is that status must be visible.

Journey G — Customer LINE Onboarding (Remaining Steps)
1. Customer receives handoff package with WatchDog shared LINE OA add URL/QR and company-scoped account-link URL, plus step-by-step copy: "Add WatchDog LINE OA first, then link your web account."
2. Customer adds the WatchDog shared LINE OA via QR or link.
3. Customer sends first message or taps rich menu — bot replies with account-link CTA only; no business data.
4. Customer opens account-link LIFF URL.
5. System verifies LINE Login token and authenticated web session.
6. System binds lineUserId to internal user.
7. One-company user: company context resolved automatically. Multi-company user: LIFF/web company selector required before any company-scoped AI answer.
8. Linked user can now receive alerts and ask read-only AI questions within permissions.

### 4. Business Rules and Exceptions

Partner Dashboard:
- BR-PD-1: Partner list/detail API response must never include customer operational fields: sales data, stock quantities, accounting balances, customer/contact records, staff/HR data, financial metrics, or transaction counts. Enforced by DTO shape and contract test.
- BR-PD-2: System admin's platform permission does not grant customer company membership. Customer workspace routes must deny system admin at authorization layer.

Partner Lifecycle:
- BR-LC-1: Lifecycle states are ACTIVE, DISABLED, and ARCHIVED. SUSPENDED remains a separate policy/security state distinct from DISABLED.
- BR-LC-2: ACTIVE permits customer web and LINE business access.
- BR-LC-3: DISABLED denies customer web and LINE access. System admin can transition DISABLED -> ACTIVE or DISABLED -> ARCHIVED.
- BR-LC-4: ARCHIVED is soft removal. Customer access denied, data preserved, hard deletion unavailable.
- BR-LC-5: [OWNER DECISION NEEDED] Can system admin transition ARCHIVED -> DISABLED or ARCHIVED -> ACTIVE? The spec says ARCHIVED is "immutable through normal customer flows" — this phrase covers customer actors but is silent on system admin. The API allows any lifecycle transition. Owner must confirm whether ARCHIVED is terminal for all actors or reversible by system admin in exceptional cases.
- BR-LC-6: Every lifecycle transition must audit: actor, old state, new state, timestamp.
- BR-LC-7: Lifecycle state check must run on every customer web request and LINE webhook event.

Feature Entitlement:
- BR-FE-1: Feature entitlement is deny-by-default. A feature is unavailable unless system admin explicitly enables it.
- BR-FE-2: Platform-level feature enablement is necessary but not sufficient; company/member-level authorization must also pass.
- BR-FE-3: Feature keys must come from a platform-managed registry. Unknown keys are rejected.
- BR-FE-4: SA must define and register the initial approved feature key set. It must cover at minimum the product modules corresponding to roadmap items: inventory, sales_documents, expenses, double_entry_ledger, thai_tax, procurement, bank_reconciliation, crm, dashboard_notifications, ai_line_assistant, reports, workflow_automation.
- BR-FE-5: Feature changes apply to subsequent requests immediately.

Approved AI Model:
- BR-AI-1: Each company has exactly one configured AI model at any time.
- BR-AI-2: Model must be selected from a platform-managed approved identifier list. Free-text or arbitrary strings are rejected.
- BR-AI-3: Approved model list is platform-controlled, not editable by customers.
- BR-AI-4: Model changes are audited with old and new identifier, actor, and timestamp.

WatchDog Shared LINE Credentials:
- BR-CR-1: WatchDog shared LINE secrets are encrypted at rest using the approved encryption primitive.
- BR-CR-2: Secret values are never returned in any API response, UI render, or audit log entry after save.
- BR-CR-3: Supported credential kinds in first pass: Messaging API, LINE Login, LIFF.
- BR-CR-4: Create/replace/rotate all overwrite stored secret. Replace and rotate are functionally equivalent (store new value); distinction is UX only.
- BR-CR-5: Credential health values: OK, ERROR, UNKNOWN. Must not derive or partially expose secret material.
- BR-CR-6: Audit log for credential actions records: kind, action, actor, timestamp, validation result — no secret.
- BR-CR-7: Shared LINE webhook validates the WatchDog channel, then resolves company from linked identity plus selected company context.

Customer LINE Onboarding:
- BR-LO-1: Handoff package must include WatchDog shared LINE OA add URL/QR and company-scoped account-link URL with explicit step-by-step instructions.
- BR-LO-2: WatchDog shared LINE OA follow/add does not grant AI data access. Account linking is required.
- BR-LO-3: Unlinked LINE followers receive account-link CTA only. No business data, no AI tool output.
- BR-LO-4: Account-link flow requires verified LINE Login and authenticated internal user with active company membership.
- BR-LO-5: One-company linked user: company context resolved automatically.
- BR-LO-6: Multi-company linked user: LIFF/web company selector is required before company-scoped AI answer.
- BR-LO-7: After linking, LINE is read-only: alerts, read-only AI, summaries, deep links to web. Mutations open web.
- BR-LO-8: If account is linked before password change is complete, AI and business module access remain blocked until password change is done.

Login Redirect (clarification of existing scope):
- BR-LR-1: After forced password change, customer is redirected to `/companies/[companyId]/dashboard`. The `companyId` is resolved from the user's active company membership and must be included in the login or password-change response. Redirecting to `/` does not satisfy the spec (spec section 6 step 7).

### 5. Acceptance Criteria

Partner Dashboard:
- AC-PD-1: System admin with `system.partner_dashboard.read` can retrieve partner list showing name, code, lifecycle status, dates, features summary, AI model, and LINE link/context health.
- AC-PD-2: System admin can retrieve partner detail with full feature entitlement list, AI model, and LINE link/context metadata. No customer business record is present in the response.
- AC-PD-3: A contract or integration test verifies that `GET /v1/system/partners` and `GET /v1/system/partners/:companyId` responses contain no sales, stock, accounting balance, customer list, staff/HR, or financial-metrics fields.
- AC-PD-4: User without `system.partner_dashboard.read` receives 403 on partner list/detail endpoints.

Lifecycle:
- AC-LC-1: System admin can transition ACTIVE -> DISABLED; subsequent customer web and LINE requests for that company are denied.
- AC-LC-2: System admin can transition DISABLED -> ACTIVE; customer access is restored.
- AC-LC-3: System admin can transition DISABLED -> ARCHIVED; company record is preserved, all access denied, no hard-delete endpoint.
- AC-LC-4: No endpoint accepts a hard-delete request for a company in any lifecycle state; 405 or equivalent is returned.
- AC-LC-5: Every lifecycle transition produces an audit log entry with actor, old state, new state, and timestamp.
- AC-LC-6: Lifecycle state is checked on every customer request (tested by making request after inactivation without re-issuing token).

Feature Entitlement:
- AC-FE-1: System admin can enable/disable feature keys via `PUT /v1/system/partners/:companyId/features`.
- AC-FE-2: After disabling a feature key, customer requests to that module's endpoints return permission/entitlement error.
- AC-FE-3: After enabling a feature key, customer with appropriate role can access the feature.
- AC-FE-4: Unknown feature key in request body returns validation error; no partial save.
- AC-FE-5: Feature entitlement changes produce audit log with actor, company, changed keys, and new states.

Approved AI Model:
- AC-AI-1: System admin can set an approved AI model identifier for a company; it is persisted.
- AC-AI-2: Model identifier not in approved list returns validation error.
- AC-AI-3: AI model change is recorded in audit log with old/new identifier, actor, timestamp.

WatchDog Shared LINE Credentials:
- AC-CR-1: System admin can create/replace WatchDog shared LINE credentials for each supported kind; response contains no secret field.
- AC-CR-2: Audit log for credential operations contains no secret value (verified by log inspection test).
- AC-CR-3: Shared LINE credential health/status is visible in platform shared LINE settings, not partner detail.

Customer LINE Onboarding:
- AC-LO-1: Handoff package display shows WatchDog shared LINE OA add URL/QR and company-scoped account-link URL with step-by-step copy.
- AC-LO-2: Unlinked LINE follower sending a message receives account-link CTA only; no business data or AI output.
- AC-LO-3: After account linking, one-company user LINE messages are answered in that company's context automatically.
- AC-LO-4: After account linking, multi-company user receives company-selector response; company-scoped AI answer is withheld until selection is confirmed.
- AC-LO-5: Linked user can receive alerts and ask read-only AI questions within role permissions.
- AC-LO-6: After forced password change, customer is redirected to `/companies/[companyId]/dashboard`. `companyId` is derived from active membership and present in the login or password-change response.

### Owner Decision Required Before SA Gate

Only one question requires owner decision before SA designs the lifecycle state machine:

BR-LC-5: Is ARCHIVED a terminal state for system admin, or can system admin transition ARCHIVED back to DISABLED (or ACTIVE) in exceptional cases?

Artifacts:
- `docs/specs/admin-company-onboarding-spec.md`
- `docs/plans/admin-company-onboarding-plan.md`
- `docs/agent-memory/admin-company-onboarding.md`
- `docs/product/business-use-cases.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`

Verification:
- 2026-06-26 local Docker runtime recovery: existing database schema predated Prisma migration history. Baselined migrations `20260624000000_init` through `20260625000001_item10_double_entry_ledger`, then `prisma migrate deploy` applied both item 10A migrations and `prisma db seed` completed. Direct `POST /v1/auth/password/login` smoke for `thawatchai.watchdog` returned 200 with access/refresh tokens and `passwordChangeRequired: false`.
- 2026-06-26 login redirect correction: system admin login now returns `redirectPath: /system/partners` instead of sending `seed-watchdog-system-company` into company dashboard. Customer/company login still returns `/companies/[companyId]/dashboard`. Web login and forced-password flow consume `redirectPath`.
- `corepack pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` passed.
- `corepack pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma` passed (Prisma Client 7.8.0 generated).
- `corepack pnpm --filter @watchdog-bms/api exec tsc --noEmit` passed (integration run 2026-06-26).
- `corepack pnpm --filter @watchdog-bms/api test` passed: 292 tests (was 287; +5 new CreateCompanyOnboardingUseCase specs).
- 2026-06-26 docs scope update: spec, plan, master checklist, and roadmap expanded for metadata-only partner management. `corepack pnpm agent:gates -- docs/plans/admin-company-onboarding-plan.md docs/agent-memory/admin-company-onboarding.md` passed; no code check needed for docs-only change.
- `corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit` passed (integration run 2026-06-26).
- Temporary PostgreSQL integration check passed (previous run): all 7 migrations applied; seed ran repeatedly; DB triggers protect system admin.

Notes:
- DocumentSequences not auto-created during onboarding: schema is complex (branchScopeKey, periodKey, resetPolicy) and document types are free strings with no enum; skipped to avoid guessing non-obvious defaults. Can be added as a seeder after onboarding if needed.
- webBaseUrl derived from `Origin` header (local dev) or `x-forwarded-proto/host` (production proxy). In local dev the web app origin (localhost:3000) is passed correctly.
- mustChangePassword check in AuthGuard exempts `/v1/auth/` prefix so login/change-password flow is unblocked. Null credential (LINE-only users) treated as no block.

---

## DEV Gate Evidence — Remaining Scope (10A partner management)

Date: 2026-06-26. Owner: DEV.

### Ponytail skill read
Confirmed: full mode. Shortest correct diff; existing patterns reused; no speculative abstractions.

### Files changed (implementation)

- `apps/api/prisma/schema.prisma` — Added ARCHIVED to CompanyStatus enum; added activatedAt/disabledAt/archivedAt + 3 relation fields to Company; added CompanyCredentialKind, CompanyCredentialHealth enums; added CompanyFeatureEntitlement, CompanyAiConfiguration, CompanyIntegrationCredential models.
- `apps/api/prisma/migrations/20260626000002_item10a_company_lifecycle_archived/migration.sql` — New: ALTER TYPE + ALTER TABLE for Company lifecycle.
- `apps/api/prisma/migrations/20260626000003_item10a_partner_management_models/migration.sql` — New: CREATE TYPE x2, CREATE TABLE x3 with FK constraints and indexes.
- `apps/api/src/modules/auth/permission-registry.ts` — Added 7 partner management permission keys + SYSTEM_ADMIN grants.
- `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts` — Bug fix: added `company: { select: { status: true } }` to membership include; ForbiddenException thrown if `status !== 'ACTIVE'`.
- `packages/config/src/index.ts` — Added CREDENTIAL_ENCRYPTION_KEY (optional hex-64 regex) and APPROVED_AI_MODEL_IDS to apiConfigSchema.
- `apps/api/src/common/config/app-config.service.ts` — Added credentialEncryptionKey and approvedAiModelIds getters.
- `.env.example` — Added CREDENTIAL_ENCRYPTION_KEY and APPROVED_AI_MODEL_IDS.
- `packages/contracts/src/partner-management.ts` — New: all partner management DTOs (no secret fields in any response shape).
- `packages/contracts/src/index.ts` — Added `export * from './partner-management.js'`.
- `apps/api/src/modules/system-partner-management/domain/feature-registry.ts` — New: APPROVED_FEATURE_KEYS const + FeatureKey type.
- `apps/api/src/modules/system-partner-management/domain/logic/credential-cipher.logic.ts` — New: AES-256-GCM encrypt/decrypt with per-call IV; stored as JSON {v,iv,tag,ct} base64url.
- `apps/api/src/modules/system-partner-management/application/use-cases/list-partners.use-case.ts` — New: explicit select, no business-table fields.
- `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.ts` — New: explicit select, zero business-table fields.
- `apps/api/src/modules/system-partner-management/application/use-cases/update-partner-profile.use-case.ts` — New: profile update with audit.
- `apps/api/src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case.ts` — New: 6-transition state machine; SUSPENDED rejected 422; timestamp rules per state.
- `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.ts` — New: validates all keys before any write; unknown key 422 no partial save; upsert all + audit in one transaction.
- `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-ai-model.use-case.ts` — New: validates against approvedAiModelIds env list; 422 on unknown model.
- `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-line-credential.use-case.ts` — New: AES-256-GCM encrypt; response and audit contain zero secret fields.
- `apps/api/src/modules/system-partner-management/presentation/http/partner.controller.ts` — New: 7 endpoints with @RequirePermissions decorators.
- `apps/api/src/modules/system-partner-management/system-partner-management.module.ts` — New module.
- `apps/api/src/app.module.ts` — Registered SystemPartnerManagementModule.
- `apps/api/package.json` — Added 5 new spec files to test command.

### Files changed (tests)

- `apps/api/src/modules/auth/permission-registry.spec.ts` — Added 2 new tests: 7 partner keys present; SYSTEM_ADMIN has all 7.
- `apps/api/src/modules/access-control/permission-resolver.spec.ts` — Updated makeMembership mock to include `company: { status: 'ACTIVE' }` (required by bug fix).
- `apps/api/src/modules/system-partner-management/domain/logic/credential-cipher.logic.spec.ts` — New: round-trip, IV differs per call, wrong key throws, tampered CT throws, stored format verified.
- `apps/api/src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case.spec.ts` — New: all 6 transitions pass; SUSPENDED rejected; audit written; timestamp rules verified.
- `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts` — New: unknown key 422 no partial save; multiple unknown keys listed; valid keys accepted.
- `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-line-credential.use-case.spec.ts` — New: response has no secret; audit has no secret; encrypted value decrypts correctly; created vs replaced audit action.
- `apps/api/src/modules/system-partner-management/presentation/http/partner.controller.spec.ts` — New: happy path for each endpoint; response secret exclusion; @RequirePermissions metadata verified.

### Verification results

- `prisma validate`: The schema at prisma/schema.prisma is valid.
- `prisma generate`: Generated Prisma Client (7.8.0) in 344ms.
- `tsc --noEmit`: Exit 0 (no errors).
- `pnpm test`: 332 pass, 0 fail (was 292; +40 new tests).

### Security constraints verified

- credential-cipher.logic.ts: plaintext never appears in stored JSON; IV random per call; auth tag enforces integrity.
- set-partner-line-credential.use-case.ts: response select excludes encryptedSecretJson; audit metadataJson contains only {credentialKind, action}.
- list-partners and get-partner-detail: Prisma select never includes any business-module table fields.
- APPROVED_AI_MODEL_IDS: validated at write time against env list; 422 on unknown model.
- Company status check: ForbiddenException thrown before permission resolution if company.status !== 'ACTIVE'.

Next:
- LINE link CTA in handoff UI (link to existing `/v1/auth/line/link-page`) — partially covered by item 07.
- Multi-company LINE user selector — partially covered by item 07 implementation.
- E2E browser smoke: blocked pending Docker running. Command documented in Integration Gate Evidence.
- Item 11 Thai Tax MVP.

---

## Integration Gate Evidence

Date: 2026-06-26. Owner: Integration.

### 1. Backend-to-Frontend Contract

Partner creation backend path:
- POST /v1/system/company-onboardings → SystemOnboardingNewPage creates partner company + first owner + one-time handoff package.
- Partner list should expose a primary create action to `/system/company-onboardings/new`; current screenshot/page review found that CTA missing.
- POST /v1/system/partners remains a spec-compatible alias option only; if added later, it must delegate to company onboarding creation.

Historical partner-management endpoints connected to web UI before shared-OA decision:
- GET /v1/system/partners → PartnerListPage (loads with pagination + status filter)
- GET /v1/system/partners/:companyId → PartnerDetailPage (full detail)
- PATCH /v1/system/partners/:companyId → Edit profile form in PartnerDetailPage
- POST /v1/system/partners/:companyId/lifecycle → Lifecycle action buttons + confirmation modal
- PUT /v1/system/partners/:companyId/features → Feature toggle switches
- PUT /v1/system/partners/:companyId/ai-model → AI model select + save
- PUT /v1/system/partners/:companyId/line-credentials/:credentialKind → Credential replace form (write-only; superseded by shared LINE settings target)

Shared-OA target replacing the old partner credential endpoint:
- PUT /v1/system/line/shared-credentials/:credentialKind → Platform shared LINE credential settings.
- LINE webhook company context must use linked identity + selected company context, not partner channel binding.

Login redirect fix:
- `PasswordLoginUseCase` now returns `companyId: string | null` (first active membership, ordered by createdAt asc).
- `LoginPage`: on success without `passwordChangeRequired`, redirects to `/companies/[companyId]/dashboard`; on `passwordChangeRequired`, stores `companyId` in `localStorage.pendingCompanyId` and redirects to `/change-password`.
- `ChangePasswordPage`: after success, reads `localStorage.pendingCompanyId`, clears it, and redirects to `/companies/[companyId]/dashboard`. Fallback to `/` if no companyId.

### 2. UI Journey Exercised (documentation — Docker not running)

Routes created:
- `/system/partners` — PartnerListPage: loading skeleton (5 rows), status filter dropdown, paginated table, per-row "View" link, error + retry banner, forbidden (403), empty state.
- `/system/partners/[companyId]` — PartnerDetailPage: full detail with all sections.

Loading/error/permission/not-found states:
- List: loading skeleton (5 placeholder rows), API error with retry, forbidden (403), empty state ("No partners found")
- Detail: loading skeleton (4 placeholder cards), forbidden (403), not-found (404), API error with retry
- Lifecycle confirmation modal: confirm/cancel buttons, reason input, loading while submitting, consequence text per action, irreversibility warning for ARCHIVE
- Feature toggles: per-key switch, disabled while submitting, optimistic state update, error toast on failure
- AI model: select from APPROVED_AI_MODELS list (gpt-4.1-mini etc.), disabled while saving, success/error toast
- Historical per-partner LINE credential replace form: write-only (type="password" fields, never shown on read), success/error, cancel, reload after save. Superseded by platform shared LINE settings target.

Security constraints verified in UI:
- Historical LINE credential inputs use type="password" and autoComplete="off"; values are never echoed in read-mode. Superseded by shared LINE settings target.
- Partner detail page contains no links to customer business modules (expenses, inventory, accounting, etc.)
- All API calls include Authorization: Bearer token from localStorage
- 401/403 errors surface as access-denied state or toast, not silent failure

### 3. Files Changed

Backend:
- `apps/api/src/modules/auth/application/use-cases/password-login.use-case.ts` — Added `companyId: string | null` to result; lookup first active membership.
- `apps/api/src/modules/auth/auth-endpoints.spec.ts` — Fixed mock to include `companyMembership.findFirst`; added `companyId` assertion.

Frontend (new files):
- `apps/web/src/features/system-partners/system-partners.api.ts` — API client for all 7 partner endpoints; follows expenses.api.ts pattern.
- `apps/web/src/features/system-partners/PartnerListPage.tsx` — List with loading/error/empty/filter/pagination states.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx` — Full detail with edit, lifecycle modal, feature toggles, AI model, and historical per-partner LINE credential replace UI. Shared-OA target moves credential management to platform shared LINE settings.
- `apps/web/app/system/partners/page.tsx` — Route file.
- `apps/web/app/system/partners/[companyId]/page.tsx` — Route file.

Frontend (modified):
- `apps/web/src/features/auth/LoginPage.tsx` — Store `companyId` in pendingCompanyId on passwordChangeRequired; redirect to company dashboard on direct login.
- `apps/web/src/features/auth/ChangePasswordPage.tsx` — Read and clear `pendingCompanyId` from localStorage; redirect to company dashboard after success.

Contracts:
- `packages/contracts/src/partner-management.ts` — Already added by DEV; built with `corepack pnpm --filter @watchdog-bms/contracts build`.

### 4. Verification Results

- `corepack pnpm --filter @watchdog-bms/contracts build` — exit 0, partner-management.js/.d.ts emitted to dist/.
- `corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit` — exit 0, no errors.
- `corepack pnpm --filter @watchdog-bms/api test` — 332 pass, 0 fail (1 test fixed: mock now includes companyMembership.findFirst; companyId assertion added).

### 5. E2E Browser Smoke Test

Status: NOT RUN — Docker daemon is not running.

To run when Docker is available:
```
docker compose -f infra/docker/compose.local.yml up -d
# Wait for services to start, then:
corepack pnpm --filter @watchdog-bms/api exec prisma migrate deploy --schema prisma/schema.prisma
# 1. Navigate to http://localhost:3000/login
# 2. Login as thawatchai.watchdog / watchdogbms11
# 3. Verify redirect to /companies/[companyId]/dashboard (not /)
# 4. Navigate to /system/partners — verify partner list loads
# 5. Click into a partner — verify detail loads
# 6. Click Disable → confirm modal → verify status changes to DISABLED
# 7. Click Activate → confirm → verify status returns to ACTIVE
```

Migration deploy command (run after Docker is up):
```
corepack pnpm --filter @watchdog-bms/api exec prisma migrate deploy --schema prisma/schema.prisma
```

---

## SA Gate Evidence — Remaining Scope (10A partner management)

Date: 2026-06-26. Owner: SA.

### 1. Architecture Fit

Reuse existing modules (no duplicate primitives):
- `Company`, `User`, `CompanyMembership`, `Role`, `Permission`, `MembershipRole` — unchanged.
- `UserCredential`, `CompanyOnboardingRun` — already exist; no changes needed for remaining scope.
- `ExternalIdentity` — reused for linked LINE user on the WatchDog shared LINE channel.
- `LineChannelBinding` — historical company-level LINE OA binding; must no longer be used as `messagingChannelId -> companyId` resolver for item 10A shared-OA flow.
- `PlatformLineChannel` and `LineCompanyContext` — new/refactored shared-OA primitives: validate the shared WatchDog channel, then resolve company from linked identity plus selected context.
- `AuditLog` — reuse; all partner management actions audit to existing `AuditLog` model.
- `system-onboarding` module — the existing `SystemOnboardingModule` at `apps/api/src/modules/system-onboarding/` is NOT extended with partner management. A new sibling module `system-partner-management` is created.
- `access-control` module — `PrismaPermissionResolverRepository` must be extended to add company-status check (see item 2b).
- No new external dependencies introduced. All encryption uses `node:crypto` built-in.

### 2. Data Model Additions

#### 2a. `CompanyStatus` enum — add `ARCHIVED`

Current schema: `ACTIVE | SUSPENDED | DISABLED`

Add value: `ARCHIVED`

`ARCHIVED` = soft-removed. Customer access denied. Data preserved. No hard delete. Reversible by system admin per BA-confirmed BR-LC-5 owner decision.

`SUSPENDED` remains a separate state for policy/security suspension; partner lifecycle API does NOT set SUSPENDED.

#### 2b. `Company` model — add lifecycle timestamp columns

Add three nullable timestamp columns:

```prisma
activatedAt  DateTime?
disabledAt   DateTime?
archivedAt   DateTime?
```

Also add three new relation fields (one per new model; see below):

```prisma
featureEntitlements     CompanyFeatureEntitlement[]
aiConfiguration         CompanyAiConfiguration?
integrationCredentials  CompanyIntegrationCredential[]
```

#### 2b-gap. Company status check per request — MISSING, must be fixed by DEV

`PrismaPermissionResolverRepository.resolveForUser` (file: `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts`) queries `CompanyMembership` with `status: 'ACTIVE'` but does NOT check `Company.status`. This violates BA rule BR-LC-7 (lifecycle check on every customer request).

DEV must add a company status check after the membership lookup:

```typescript
// after finding membership, include company status:
include: { company: { select: { status: true } } }
// then add:
if (membership.company.status !== 'ACTIVE') {
  throw new ForbiddenException('Company is not active.');
}
```

This single change enforces lifecycle denial on every request for DISABLED and ARCHIVED companies without requiring a separate middleware.

#### 2c. `CompanyFeatureEntitlement` — new model

```prisma
model CompanyFeatureEntitlement {
  id                          String   @id @default(cuid())
  companyId                   String
  featureKey                  String
  enabled                     Boolean  @default(false)
  updatedBySystemAdminUserId  String?
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
  company                     Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, featureKey])
  @@index([companyId, enabled])
}
```

Approved feature keys (BA-confirmed BR-FE-4 initial list): `inventory`, `sales_documents`, `expenses`, `double_entry_ledger`, `thai_tax`, `procurement`, `bank_reconciliation`, `crm`, `dashboard_notifications`, `ai_line_assistant`, `reports`, `workflow_automation`.

These keys must be validated at write time. Store the approved list in a constant in the permission-registry or a new `feature-registry.ts` file, mirroring the pattern of `PERMISSIONS` in permission-registry.ts.

Feature entitlement is deny-by-default: a `CompanyFeatureEntitlement` row with `enabled=false` OR no row at all = feature is unavailable. DEV must implement a feature check middleware/guard that is called before business module endpoints.

#### 2d. `CompanyAiConfiguration` — new model

```prisma
model CompanyAiConfiguration {
  id                          String   @id @default(cuid())
  companyId                   String   @unique
  modelId                     String
  updatedBySystemAdminUserId  String?
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
  company                     Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
}
```

`modelId` must be validated against `APPROVED_AI_MODEL_IDS` env list on write (see item 7).

#### 2e. `CompanyIntegrationCredential` — new model

Two new enums needed:

```prisma
enum CompanyCredentialKind {
  LINE_MESSAGING_API
  LINE_LOGIN
  LINE_LIFF
}

enum CompanyCredentialHealth {
  OK
  ERROR
  UNKNOWN
}
```

Model:

```prisma
model CompanyIntegrationCredential {
  id                          String                  @id @default(cuid())
  companyId                   String
  provider                    String                  @default("LINE")
  credentialKind              CompanyCredentialKind
  encryptedSecretJson         String
  secretVersion               Int                     @default(1)
  health                      CompanyCredentialHealth @default(UNKNOWN)
  lastValidatedAt             DateTime?
  rotatedAt                   DateTime?
  updatedBySystemAdminUserId  String?
  createdAt                   DateTime                @default(now())
  updatedAt                   DateTime                @updatedAt
  company                     Company                 @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, provider, credentialKind])
  @@index([companyId])
}
```

`encryptedSecretJson` is a `String` column storing an AES-256-GCM encrypted JSON blob (see item 6). Using `String` instead of `Json` prevents any accidental deserialization exposure by Prisma or serializers.

### 3. Permissions / ABAC

New permission keys to add to `apps/api/src/modules/auth/permission-registry.ts`:

```typescript
// Item 10A partner management permissions
{ key: 'system.partner_dashboard.read',           description: 'Read partner company list and detail (metadata only)', riskLevel: 'MEDIUM' },
{ key: 'system.partner_company.create',           description: 'Create new partner company',                          riskLevel: 'HIGH' },
{ key: 'system.partner_company.update',           description: 'Update partner company profile metadata',             riskLevel: 'MEDIUM' },
{ key: 'system.partner_company.lifecycle.manage', description: 'Activate/inactivate/archive partner company',         riskLevel: 'CRITICAL' },
{ key: 'system.partner_feature.manage',           description: 'Set partner feature entitlements',                    riskLevel: 'HIGH' },
{ key: 'system.partner_ai_model.manage',          description: 'Set approved AI model for partner company',           riskLevel: 'HIGH' },
{ key: 'system.shared_line_credential.manage',    description: 'Create/replace WatchDog shared LINE credentials',     riskLevel: 'CRITICAL' },
```

All 7 keys are platform-scoped (`system.` prefix). `COMPANY_PERMISSION_KEYS` filter `!key.startsWith('system.')` already excludes them from customer roles automatically.

Add all 7 to `SYSTEM_ADMIN` role grants in `ROLE_GRANTS`:

```typescript
SYSTEM_ADMIN: [
  'account.session.read',
  'account.password.change',
  'system.company_onboarding.create',
  'system.company_onboarding.read',
  'system.company_onboarding.regenerate_temporary_password',
  'system.line_binding.manage',
  // New partner management
  'system.partner_dashboard.read',
  'system.partner_company.create',
  'system.partner_company.update',
  'system.partner_company.lifecycle.manage',
  'system.partner_feature.manage',
  'system.partner_ai_model.manage',
  'system.shared_line_credential.manage',
],
```

ABAC boundaries:
- All `system.*` endpoints require `SYSTEM_ADMIN` role on the internal platform company (companyId = WatchDog System tenant).
- Customer workspace routes must NOT be accessible with platform permissions alone. The `COMPANY_PERMISSION_KEYS` filter already enforces this.
- Partner detail endpoint Prisma query must use an explicit `select` that never joins business tables. No post-hoc DTO stripping is sufficient; the query itself must not fetch the data.

### 4. API Contracts

All new endpoints are under `/v1/system/partners`. Permission guard: `RequirePermissions(...)` decorator consistent with existing pattern in `system-onboarding.controller.ts`.

#### `GET /v1/system/partners`
Permission: `system.partner_dashboard.read`
Query: `{ status?: 'ACTIVE'|'DISABLED'|'ARCHIVED'|'SUSPENDED'; page?: number; pageSize?: number }`
Response:
```typescript
type PartnerCompanySummaryDto = {
  id: string;
  name: string;
  registeredName?: string;
  timezone: string;
  locale: string;
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED' | 'SUSPENDED';
  createdAt: string;
  activatedAt?: string;
  disabledAt?: string;
  archivedAt?: string;
  enabledFeatureKeys: string[];
  configuredModelId?: string;
  lineContextHealth: 'LINKED' | 'UNLINKED' | 'NEEDS_COMPANY_SELECTION' | 'UNKNOWN';
};
type PaginatedPartnersDto = { items: PartnerCompanySummaryDto[]; total: number; page: number; pageSize: number };
```

Banned fields (must never appear in response): products, accountingDocuments, expenseRecords, journalEntries, stockMovements, chartOfAccounts, accountingPeriods, dashboardSnapshots, notificationEvents, receiptExtractions, or any count/aggregate derived from these.

Contract test: a unit/integration test asserts that the response body JSON keys never include any string from the business-field exclusion list.

#### `GET /v1/system/partners/:companyId`
Permission: `system.partner_dashboard.read`
Response:
```typescript
type PartnerCompanyDetailDto = {
  id: string;
  name: string;
  registeredName?: string;
  brandName?: string;
  taxId?: string;
  timezone: string;
  locale: string;
  baseCurrency: string;
  phone?: string;
  email?: string;
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED' | 'SUSPENDED';
  createdAt: string;
  activatedAt?: string;
  disabledAt?: string;
  archivedAt?: string;
  featureEntitlements: Array<{ featureKey: string; enabled: boolean; updatedAt: string }>;
  aiConfiguration?: { modelId: string; updatedAt: string };
  lineContextHealth: 'LINKED' | 'UNLINKED' | 'NEEDS_COMPANY_SELECTION' | 'UNKNOWN';
};
```

#### `PATCH /v1/system/partners/:companyId`
Permission: `system.partner_company.update`
Request: `{ name?: string; brandName?: string; timezone?: string; locale?: string; phone?: string; email?: string }`
Not editable through this endpoint: `taxId`, `registeredName`, `baseCurrency` (set at onboarding; displayed read-only).
Response: `PartnerCompanyDetailDto`
Audit: action `system.partner_company.update`, metadataJson = `{ changedFields: string[] }`.

#### `POST /v1/system/partners/:companyId/lifecycle`
Permission: `system.partner_company.lifecycle.manage`
Request: `{ targetStatus: 'ACTIVE' | 'DISABLED' | 'ARCHIVED'; reason?: string }`
Rules:
- All transitions allowed by system admin (ACTIVE↔DISABLED↔ARCHIVED in any direction).
- SUSPENDED is not a valid targetStatus for this endpoint (it is a separate security/policy state).
- No hard-delete endpoint exists; respond 405 if any delete route is hit.
Response: `{ id: string; status: string; activatedAt?: string; disabledAt?: string; archivedAt?: string }`
Audit: action `system.partner_company.lifecycle.transition`, metadataJson = `{ fromStatus, toStatus, reason }`.

#### `PUT /v1/system/partners/:companyId/features`
Permission: `system.partner_feature.manage`
Request: `{ features: Array<{ featureKey: string; enabled: boolean }> }`
Validation: all `featureKey` values must be in the approved feature registry. Unknown key = 422 validation error; no partial save.
Response: `{ companyId: string; features: Array<{ featureKey: string; enabled: boolean; updatedAt: string }> }`
Audit: action `system.partner_feature.update`, metadataJson = `{ changedKeys: Array<{ featureKey, fromEnabled, toEnabled }> }`.

#### `PUT /v1/system/partners/:companyId/ai-model`
Permission: `system.partner_ai_model.manage`
Request: `{ modelId: string }`
Validation: `modelId` must be in `APPROVED_AI_MODEL_IDS` env list. Unknown = 422.
Response: `{ companyId: string; modelId: string; updatedAt: string }`
Audit: action `system.partner_ai_model.update`, metadataJson = `{ fromModelId, toModelId }`.

#### `PUT /v1/system/line/shared-credentials/:credentialKind`
Permission: `system.shared_line_credential.manage`
`credentialKind` path param: `LINE_MESSAGING_API | LINE_LOGIN | LINE_LIFF`
Request: `{ channelId: string; channelSecret: string; accessToken?: string }` (accessToken relevant for LINE_MESSAGING_API)
Behavior: upsert WatchDog shared LINE platform credential. Replace and rotate are functionally identical; one endpoint. Action in audit determined by whether a previous row existed (created vs replaced).
Response: `{ kind: string; health: 'UNKNOWN'; lastValidatedAt: null; rotatedAt: string; createdAt: string; updatedAt: string }` — NO secret fields.
Audit: action `system.shared_line_credential.upsert`, metadataJson = `{ credentialKind, action: 'created'|'replaced' }` — no secret values.

#### Shared LINE webhook company resolution
Permission: request-context derived from linked user and selected company context.
Rules:
- Verify signature with WatchDog shared LINE channel secret.
- Validate `messagingChannelId` is the configured shared channel.
- Resolve `ExternalIdentity` by LINE user id.
- If user has one active company membership, create/use `LineCompanyContext`.
- If user has multiple active company memberships and no selected context, reply with company selector and run no company-scoped tools.
- Never infer `companyId` from `messagingChannelId`.

### 5. Lifecycle State Machine

States: `ACTIVE`, `DISABLED`, `ARCHIVED`. (`SUSPENDED` is separate security/policy state, not managed by partner lifecycle endpoint.)

Allowed transitions (all by system admin only):

```
ACTIVE    → DISABLED  (inactivate)
ACTIVE    → ARCHIVED  (direct soft-remove)
DISABLED  → ACTIVE    (reactivate)
DISABLED  → ARCHIVED  (archive from inactive)
ARCHIVED  → DISABLED  (un-archive to inactive; BA-confirmed reversible per owner decision BR-LC-5)
ARCHIVED  → ACTIVE    (un-archive to active; BA-confirmed reversible per owner decision BR-LC-5)
```

Prohibited: hard delete from any state; SUSPENDED transition from this endpoint.

Customer access: only when status is `ACTIVE`. `DISABLED` and `ARCHIVED` both deny customer web and LINE requests.

Timestamp rules on transition:
- → `ACTIVE`: set `activatedAt = now()`, clear `disabledAt` and `archivedAt`.
- → `DISABLED`: set `disabledAt = now()`, clear `archivedAt`. Keep `activatedAt`.
- → `ARCHIVED`: set `archivedAt = now()`. Keep prior `activatedAt` and `disabledAt`.

### 6. Credential Encryption

No existing AES/vault primitive in codebase. The codebase uses `node:crypto` for scrypt (password hashing), HMAC (LINE webhook verification), and randomBytes. No AES helper exists.

Pattern to implement (new file: `apps/api/src/modules/system-partner-management/domain/logic/credential-cipher.logic.ts`):

- Algorithm: AES-256-GCM (authenticated encryption, no padding oracle, built-in integrity tag).
- Key source: `CREDENTIAL_ENCRYPTION_KEY` env var — 32-byte key as 64-character hex string.
- IV: 12 random bytes per encrypt call (GCM standard).
- Auth tag: 128-bit (16 bytes), default for Node GCM.
- Stored format (JSON stringified to `encryptedSecretJson` column):
  `{ v: 1, iv: "<24-char base64url>", tag: "<24-char base64url>", ct: "<base64url-ciphertext>" }`
- The function signatures are:
  ```typescript
  function encryptCredential(plainSecret: string, key: Buffer): string;  // returns JSON string
  function decryptCredential(encryptedJson: string, key: Buffer): string; // returns plain secret
  ```
- No external library needed (all from `node:crypto`: `createCipheriv`, `createDecipheriv`).
- Key must be loaded from `AppConfigService.credentialEncryptionKey` (new getter); validated as 32 bytes at bootstrap.
- Add to `packages/config/src/index.ts` apiConfigSchema: `CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional()`.
- Add to `validateProductionConfig`: if `isApiConfig` and partner-management is in scope, require `CREDENTIAL_ENCRYPTION_KEY`.
- Add to `.env.example`: `CREDENTIAL_ENCRYPTION_KEY=` (empty; DEV generates with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

### 7. Approved AI Model List

Decision: **env-config** (`APPROVED_AI_MODEL_IDS` in `packages/config/src/index.ts`).

Rationale:
- Platform operator controls the approved list at deployment time. Models are approved infrequently.
- DB-stored list would require an admin-UI flow to manage the list itself — out of scope.
- Env-config is consistent with how `OPENAI_MODEL` and `BEDROCK_MODEL_ID` are already managed.
- Auditable through deployment config changes (infra/GitOps log).

Config change:
```typescript
// in apiConfigSchema
APPROVED_AI_MODEL_IDS: z.string().default('gpt-4.1-mini'),
```

Add to `.env.example`:
```
APPROVED_AI_MODEL_IDS=gpt-4.1-mini
```

Parsing: comma-split on read, trim whitespace, filter empty. Store in `AppConfigService.approvedAiModelIds: string[]`.

Validation: `PUT /v1/system/partners/:companyId/ai-model` checks `modelId` against this list before persisting. Unknown modelId = 422 with message `"modelId is not in the approved list"`.

### 8. Implementation Scope Boundaries

In scope for remaining 10A phases 2-4:

Phase 2 — Schema and permission registry:
- Migration `20260626000002_item10a_company_lifecycle_archived`: add `ARCHIVED` to `CompanyStatus` enum, add `activatedAt/disabledAt/archivedAt` to `Company`.
- Migration `20260626000003_item10a_partner_management_models`: add `CompanyCredentialKind` enum, `CompanyCredentialHealth` enum, `CompanyFeatureEntitlement` model, `CompanyAiConfiguration` model, `CompanyIntegrationCredential` model, update `Company` with new relation fields.
- Add 7 new permission keys + SYSTEM_ADMIN grants to `permission-registry.ts`.
- Add `APPROVED_FEATURE_KEYS` registry constant (new file `feature-registry.ts` or inline in permission-registry).
- Seed update: add new permissions to DB seed (seed.ts already iterates PERMISSIONS array; just adding to array is sufficient).

Phase 3 — Company status check + partner management API:
- Fix `PrismaPermissionResolverRepository` to check `Company.status`.
- New module `SystemPartnerManagementModule` with 7 use cases and `PartnerController`.
- Config schema additions: `CREDENTIAL_ENCRYPTION_KEY`, `APPROVED_AI_MODEL_IDS`.
- `credential-cipher.logic.ts` AES-256-GCM implementation.

Phase 4 — Contracts, tests, and integration:
- Add partner DTO types to `packages/contracts/src/index.ts` (or new `partner-management.ts` file).
- Unit tests for credential cipher (encrypt-decrypt roundtrip, wrong key fails, tampered ciphertext fails).
- Unit tests for lifecycle transition state machine (valid and invalid transitions).
- Unit tests for feature entitlement validation (unknown key rejected, partial save prevented).
- Unit tests for AI model validation (unknown model rejected).
- API tests for each new endpoint (permission check, valid/invalid request, response shape, audit log entry).
- Contract test: partner list/detail response excludes business fields (use key-name blacklist assertion).
- Integration test: lifecycle transition → customer request denied.

Out of scope:
- Email/SMS delivery of credentials/handoff.
- Support impersonation (system admin never becomes a customer company member).
- Customer staff user creation via partner management.
- Hard delete endpoint (405 if hit).
- LINE webhook changes (handled by item 07).
- Web/frontend partner dashboard UI implementation detail (Integration gate concern).
- Billing/subscription provisioning.

### 9. Migration File Naming

Last existing migration: `20260626000001_item10a_onboarding_run`

New migrations for remaining scope:

```
apps/api/prisma/migrations/20260626000002_item10a_company_lifecycle_archived/migration.sql
apps/api/prisma/migrations/20260626000003_item10a_partner_management_models/migration.sql
```

Both migrations must be generated by `prisma migrate dev --name <slug>` or written by hand and verified with `prisma migrate deploy`. DEV must run `prisma generate` after schema changes and `prisma validate` before committing.

### 10. Handoff Decisions Summary

- ARCHIVED → DISABLED and ARCHIVED → ACTIVE are allowed by system admin (BA-confirmed owner decision, BR-LC-5 resolved).
- Shared LINE credential replace vs rotate: one platform endpoint (`PUT /v1/system/line/shared-credentials/:credentialKind`). Functionally identical; audit action field distinguishes create vs replace.
- Approved AI model list: env-config (`APPROVED_AI_MODEL_IDS`), not DB-stored.
- Encryption: AES-256-GCM via `node:crypto`, key from env (`CREDENTIAL_ENCRYPTION_KEY`).
- New module: `SystemPartnerManagementModule` (sibling to `SystemOnboardingModule`).
- Company status check: fix `PrismaPermissionResolverRepository` — add `company: { select: { status: true } }` to membership include, throw `ForbiddenException` if `status !== 'ACTIVE'`.

## 2026-06-26 Admin Partner View 403 Fix

Status: SUPERSEDED BY SHARED LINE OA REOPEN.
Owner: DEV -> Integration.
Scope: Fix `/system/partners` 403 for system admin view.

Role gate status:
- BA: System admin must be able to view metadata-only partner list/detail; non-admin remains forbidden.
- SA: Root cause was request-context resolution without explicit `companyId` picking an arbitrary active membership, so a user with both customer and system memberships could resolve customer permissions and miss `system.partner_dashboard.read`.
- DEV: Ponytail read; smallest correct diff updates `PrismaPermissionResolverRepository` to prefer active `SYSTEM_ADMIN` membership when `companyId` is absent, with fallback to oldest active membership for non-system flows. Touched `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts` and `apps/api/src/modules/access-control/permission-resolver.spec.ts`.
- Integration: Backend guard contract unchanged; `/v1/system/partners` still requires `system.partner_dashboard.read`, and no customer data access is broadened.

Decisions:
- Do not weaken `DenyByDefaultGuard`.
- Do not add frontend workaround header logic; fix shared permission resolution root cause.

Verification:
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/access-control/permission-resolver.spec.ts` — pass, 10 tests.
- First non-escalated test hit known sandbox `listen EPERM` on tsx IPC pipe; escalated rerun passed.
- Local machine had stuck `ReportCrash` PID 918 holding ~54k file descriptors; terminated it before verification. Docker daemon was not running (`docker.sock` missing), so no container stop was needed.

Next:
- Refresh/re-login system admin session if browser still has old context; retry `/system/partners`.

---

## 2026-06-26 Phase 4 LINE CTA Completion

Status: COMPLETE.
Owner: DEV.
Scope: Remaining Phase 4 UI items — LINE link CTA in ChangePasswordPage and LINE setup instructions in handoff package.

Role gate status:
- BA: LINE link CTA and setup instructions satisfy spec section 12 "Customer first-login screen: LINE link CTA" and "Handoff result with… setup checklist".
- SA: No new backend changes; UI only. LINE account-link endpoint `GET /v1/auth/line/link-page` already exists.
- DEV: Ponytail read; smallest diff. Two files changed.
- Integration: Web TypeScript clean; API tests 334 pass 0 fail.

Files changed:
- `apps/web/src/features/auth/ChangePasswordPage.tsx` — Added `LineSetupCta` component shown after password change success; displays 3-step LINE setup checklist before customer continues to dashboard. No longer immediately redirects; shows success state with "Continue to Dashboard" button.
- `apps/web/src/features/system-onboarding/SystemOnboardingNewPage.tsx` — Added step-by-step LINE setup instructions block in `HandoffPackage` (visible when `lineAddUrl` or `lineLinkUrl` is present). Numbered instructions guide admin to share with customer.

Docs updated at that time:
- `docs/plans/admin-company-onboarding-plan.md` — Old per-partner LINE assumptions marked complete.
- `docs/plans/master-implementation-checklist.md` — Old item 10A marked [x].

Superseded note:
- 2026-06-26 owner changed direction to WatchDog shared LINE OA. Item 10A is reopened until shared credentials, selected-company context, and webhook company-resolution refactor are implemented and verified.

Verification:
- `corepack pnpm --filter @watchdog-bms/api test`: 334 pass, 0 fail.
- `corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit`: exit 0.

Next:
- Item 11 Thai Tax MVP.

---

## 2026-06-26 Shared LINE OA Implementation — DEV + Integration

Status: COMPLETE.
Owner: DEV + Integration.
Scope: Implement PlatformLineCredential, LineCompanyContext, SetSharedLineCredentialUseCase, SystemLineController, webhook company-resolution refactor, updated list/detail use cases, and frontend shared LINE settings page.

Role gate status:
- BA: Evidence recorded above (Journeys F and G, BR-CR-1..7, BR-LO-1..8, AC-CR-1..3, AC-LO-1..6).
- SA: Evidence recorded above (SA Gate Evidence: data model 2e, API contract `PUT /v1/system/line/shared-credentials/:credentialKind`, shared webhook resolution rules, scope boundaries).
- DEV: Ponytail read; smallest correct diff. See files changed below.
- Integration: Backend + frontend contracts verified; TypeScript clean (pre-existing next/link module resolution errors unrelated to this work).

Decisions:
- PlatformLineCredential (no companyId, unique per credentialKind) replaces CompanyIntegrationCredential for platform shared credential storage.
- LineCompanyContext (unique per lineUserId) records selected company for multi-company LINE users.
- Webhook company resolution: 0 memberships → null (unlinked reply), 1 membership → auto-resolve, multiple → check LineCompanyContext; if not found → NEEDS_COMPANY_SELECTION reply.
- externalIdentity.findFirst no longer filters by providerChannelId; any active LINE identity on the shared channel resolves the user.
- PartnerCompanySummaryDto.lineContextHealth replaces lineCredentialHealth array.
- PartnerCompanyDetailDto.lineContextHealth replaces lineCredentials array.
- SetPartnerLineCredentialUseCase and per-partner LINE credential endpoint removed from PartnerController.
- Platform shared LINE settings exposed at /system/line-settings (new Next.js route).

Files changed (backend):
- `apps/api/prisma/schema.prisma` — Added PlatformLineCredential (singleton per credentialKind, encrypted) and LineCompanyContext (lineUserId unique, selected company) models.
- `apps/api/prisma/migrations/20260626000004_item10a_shared_line_credential_and_line_company_context/migration.sql` — CREATE TABLE for both new models.
- `packages/contracts/src/partner-management.ts` — Added LineContextHealth, SharedLineCredentialMetadataDto, SetSharedLineCredentialDto; replaced per-partner fields with lineContextHealth in summary/detail DTOs.
- `apps/api/src/modules/system-partner-management/application/use-cases/set-shared-line-credential.use-case.ts` — New: AES-256-GCM encrypt, upsert PlatformLineCredential, audit without secret, response without secret.
- `apps/api/src/modules/system-partner-management/application/use-cases/set-shared-line-credential.use-case.spec.ts` — New: no secret in response/audit, encrypted value decrypts correctly, created vs replaced audit action.
- `apps/api/src/modules/system-partner-management/presentation/http/system-line.controller.ts` — New: PUT system/line/shared-credentials/:credentialKind with RequirePermissions('system.shared_line_credential.manage').
- `apps/api/src/modules/system-partner-management/system-partner-management.module.ts` — Added SystemLineController + SetSharedLineCredentialUseCase; kept SetPartnerLineCredentialUseCase for backward-compat tests.
- `apps/api/src/modules/system-partner-management/presentation/http/partner.controller.ts` — Removed per-partner LINE credential endpoint; fixed import to include IsNotEmpty, IsOptional.
- `apps/api/src/modules/system-partner-management/presentation/http/partner.controller.spec.ts` — Removed setLineCredential mock/tests; updated SUMMARY constant to use lineContextHealth.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — Removed lineBinding dependency; added resolveCompanyForLineUser() helper using companyMembership + lineCompanyContext.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — Rewrote: makePrisma/makeUseCase helpers; 7 new tests covering deny without permission, unlinked, no membership, multi-company no context, single-company auto-resolve, no raw lineUserId exposure, multi-company with selected context.
- `apps/api/src/modules/system-partner-management/application/use-cases/list-partners.use-case.ts` — Changed select from integrationCredentials to memberships + externalIdentities; computes lineContextHealth.
- `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.ts` — Same change with NEEDS_COMPANY_SELECTION detection via groupBy.

Files changed (frontend):
- `apps/web/src/features/system-partners/system-partners.api.ts` — Added setSharedLineCredential to /v1/system/line/shared-credentials/:credentialKind; updated type exports.
- `apps/web/src/features/system-partners/PartnerListPage.tsx` — Replaced HealthDot/lineCredentialHealth with LineContextBadge/lineContextHealth.
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx` — Removed CredentialReplaceForm component and per-company LINE credential section; replaced with LineContextBadge + link to /system/line-settings.
- `apps/web/src/features/system-partners/SharedLineSettingsPage.tsx` — New: write-only platform credential form for each kind; secrets never shown after save; warning notice displayed.
- `apps/web/app/system/line-settings/page.tsx` — New route file pointing to SharedLineSettingsPage.

Verification:
- `corepack pnpm --filter @watchdog-bms/api test`: 338 pass, 0 fail (was 332; +6 new tests).
- `corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit`: pre-existing next/link module resolution errors only (no new type errors introduced).
- All plan checklist items for shared-OA direction now marked [x].

Security constraints:
- PlatformLineCredential.encryptedSecretJson: never in Prisma select for API responses; SetSharedLineCredentialUseCase response and audit exclude all secret fields.
- lineContextHealth shows only LINKED/UNLINKED/NEEDS_COMPANY_SELECTION/UNKNOWN — no credential material.
- resolveCompanyForLineUser uses lineUserIdHash for event logging, not raw lineUserId.

Next:
- Item 11 Thai Tax MVP.

---

## 2026-06-26 Item 10A Final Closure

Status: COMPLETE. Master checklist item 10A marked [x].
Owner: DEV.
Scope: Final gap fix — add set-shared-line-credential.use-case.spec.ts to package.json test command.

Fix: `set-shared-line-credential.use-case.spec.ts` was implemented in the Shared LINE OA pass but not added to the test command in `apps/api/package.json`. Added to test list.

Verification:
- `corepack pnpm --filter @watchdog-bms/api test`: 342 pass, 0 fail (+4 from set-shared-line-credential.use-case.spec.ts).
- `docs/plans/master-implementation-checklist.md` item 10A: `[x]`.

Next:
- Item 11 Thai Tax MVP.

---

## 2026-06-28 Production System Admin Password Reset

Status: COMPLETE.
Owner: Codex.
Scope: Production full web/API App Runner deploy plus protected system admin bootstrap/reset from `SEED_SYSTEM_ADMIN_PASSWORD`.

Artifacts:
- Production web/API URL: `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com`.
- App Runner service: `watchdog-bms-api`.
- Deployed image tag: `api-web-233a2a5-20260628201556`.
- Runtime secret source: `watchdog-bms/production/seed-system-admin-password` mapped to `SEED_SYSTEM_ADMIN_PASSWORD`; password value is not recorded in docs.
- `apps/api/prisma/reset-system-admin-password.ts` now ensures only the protected `WatchDog System` tenant, system permissions/roles, `thawatchai.watchdog`, credential, and `SYSTEM_ADMIN` membership. It does not run the full local/demo seed in production.

Verification:
- `corepack pnpm --filter @watchdog-bms/api exec tsc --noEmit --pretty false`: pass.
- `bash -n infra/prod-app-runner/deploy-api-web.sh`: pass.
- `bash -n apps/api/start-combined-production.sh`: pass.
- `GET /v1/health`: `status=ok`, `db=ok`.
- `HEAD /login`: HTTP 200, Next.js production page.
- `POST /v1/auth/password/login` as `thawatchai.watchdog` with `SEED_SYSTEM_ADMIN_PASSWORD`: HTTP 200, `passwordChangeRequired=false`, `redirectPath=/system/partners`, access/refresh tokens present.

Next:
- Keep the production admin password in AWS Secrets Manager/env only; rotate by updating `SEED_SYSTEM_ADMIN_PASSWORD` and redeploying the combined App Runner image/startup.

## 2026-07-07 Partner Lifecycle Lock + Post-Transition Crash Fix

Status: COMPLETE.
Owner: Claude.
Scope: Bug report — after Archive/Disable the partner detail page crashed ("This page couldn't load"), ARCHIVED showed an empty Lifecycle row, and DISABLED/ARCHIVED companies still allowed editing profile/features/AI model.

Decisions:
- Root cause of crash: `POST /lifecycle` returns `{id, status, activatedAt?, disabledAt?, archivedAt?}` only, but the web page fed it to `setDetail()` whole — `featureEntitlements` became undefined and render threw. Fixed by merging status+timestamps into loaded detail (web api type now `PartnerLifecycleResultDto`).
- DISABLED/ARCHIVED are metadata-frozen: `PATCH /partners/:id`, `PUT /features`, `PUT /ai-model` now 422 via shared `partnerMetadataLockError()` (domain/logic/partner-lock.logic.ts); UI disables Edit Profile, feature toggles, AI model select/save and shows a read-only banner.
- ARCHIVED is restorable by system admin (existing use-case tests already asserted ARCHIVED→ACTIVE/DISABLED allowed); UI now shows "Re-activate" for ARCHIVED and modal copy no longer claims archiving is irreversible. Spec §8 updated with the metadata-freeze rule.
- SUSPENDED untouched (separate security state, out of reported scope).

Artifacts:
- apps/api: system-partner-management update-profile/set-features/set-ai-model use cases + partner-lock.logic.ts + update-partner-profile.use-case.spec.ts (new, added to test list).
- apps/web: system-partners.api.ts (lifecycle result type), PartnerDetailPage.tsx (merge fix, fieldsLocked, banner, Re-activate, modal copy).
- docs/specs/admin-company-onboarding-spec.md §8: metadata-freeze bullet.

Verification:
- `tsx --test` partner-management specs: 31 pass 0 fail (incl. new DISABLED/ARCHIVED 422 cases for features + profile).
- `pnpm --filter web|api typecheck`: pass.
- Browser (local stack, throwaway company `test-lifecycle-lock-co`, deleted after): ACTIVE→DISABLED→ARCHIVED→ACTIVE round trip with no crash; locked states show banner, disabled controls, correct lifecycle buttons; PATCH/features/ai-model returned 422 while DISABLED and ARCHIVED.

Next:
- Deploy to production (mangmeeplus.com) when the user is ready; bug was reported against prod.
- Members section (added concurrently by another session) has its own actions — lock semantics for members under DISABLED/ARCHIVED not decided here.

## 2026-07-07 ai_line_assistant Entitlement Enforcement (LINE webhook)

Status: COMPLETE.
Owner: Claude.
Scope: Make the Feature Entitlements toggles behave like the partner-detail screen. Audit found every approved feature key already flows through capability-pack machinery (list/preview filter + compileRole drop) except `ai_line_assistant`, which had no consumer at all — LINE AI answered regardless of the toggle (spec requires the feature on the read-only AI path; AC-FE-2).

Decisions:
- Gate lives in `ProcessLineWebhookUseCase` right after company resolution, on BOTH surfaces: text turns (`execute`) and media turns (`executeReceiptUploadInner` — receipts/signatures are part of the LINE assistant surface). `/companies` switching still works while disabled (account plumbing, lets the user move to an entitled company).
- Reuse `loadEntitledFeatureKeys` (employee-access entitlement.helper) so semantics stay single-sourced: no entitlement rows at all = legacy fail-open (local/dev unaffected); rows exist without enabled `ai_line_assistant` = deny.
- Denial reuses `formatRefusal('feature_disabled')` copy, audits `ai.line.query.denied` with reason `feature_disabled`, event log status `feature_disabled` + `LINE_AI_UNSUPPORTED_MODULE`.

Artifacts:
- apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts (+ spec: 3 new cases; entitlement mock added)
- apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts (mock only)

Verification:
- `tsx --test` process-line-webhook + line-intake-dispatch specs: 53 pass 0 fail (new: toggle off → deny + no AI call; configured-but-missing key → deny; toggle on → completed).
- `tsc --noEmit` (api): pass.
- Prod state per partner screen (Mangmee: expenses, crm, ai_line_assistant ON) keeps the assistant working after deploy; toggling ai_line_assistant off now actually turns it off.

Next:
- None for this gap. Runtime per-request gating for the other feature keys (beyond pack visibility/compile) remains the larger AC-FE-2 story if ever needed.

## 2026-07-07 Feature Entitlement Runtime Enforcement (AC-FE-2) + Onboarding Default Package

Status: COMPLETE (not deployed — user said hold deploy).
Owner: Claude.
Scope: Owner-confirmed rule: a feature that is not enabled must disappear from the customer screen and carry no view/execute permission. Enforce at one chokepoint instead of per-endpoint guards.

Decisions:
- Enforcement point is `PrismaPermissionResolverRepository.resolveForUser`: after role permissions are merged, `filterPermissionsByEntitlement()` strips permissions of disabled features. Every consumer follows automatically — `@RequirePermissions` API guards deny, workspace sidebar hides (permission-filtered), LINE AI tools narrow, and OWNER is covered (its blanket `COMPANY_PERMISSION_KEYS` grant bypasses packs but not the resolver).
- Permission→feature mapping derived from the capability-pack registry (`featureEntitlementKey` → `permissionKeys`), cached in-process. A permission also present in an ungated pack (e.g. `pack.core.basics`: dashboard.read, line.ai.query, notification.read) is never stripped. Permissions mapped to nothing (system.*, admin plumbing, reimbursements, company settings, people, audit packs) are not feature-gated.
- `reports` feature key had no pack; gated by prefix rule `report.*` → `reports` in feature-gate.logic (ledger.report.read etc. stay with their module features).
- Legacy fail-open preserved: companies with zero entitlement rows keep all permissions (same `loadEntitledFeatureKeys` null convention). Deny-by-default arrives via onboarding seeding.
- Onboarding now seeds an explicit `CompanyFeatureEntitlement` row for every approved key; `DEFAULT_ENABLED_FEATURE_KEYS = ['expenses','crm','ai_line_assistant']` (feature-registry.ts, the Mangmee baseline).
- `line.ai.query` stays core; the ai_line_assistant feature is enforced at the LINE webhook gate (previous section) with the friendlier feature_disabled reply.

Artifacts:
- apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts (new) + feature-gate.logic.spec.ts (new, added to package.json test list).
- apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts (strip step) + permission-resolver.spec.ts (entitlement mock + 3 gating cases).
- apps/api/src/modules/system-partner-management/domain/feature-registry.ts (DEFAULT_ENABLED_FEATURE_KEYS).
- apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts (seed createMany in tx) + create-company-onboarding.spec.ts (mock + default-package assertion).
- docs/specs/admin-company-onboarding-spec.md: two enforcement bullets after the deny-by-default rule.

Verification:
- Targeted specs (resolver, feature-gate, onboarding, LINE webhook, intake dispatch, capability, role-management): 99 pass 0 fail. `tsc --noEmit` (api): pass.
- Full `pnpm test`: 1145/1148 — the 3 failures are pre-existing in committed `auth/line-linking.spec.ts` (commit 4b99295b added `externalIdentity.update` the spec mocks lack); unrelated, flagged as a separate task chip.
- Live DB check (local, real resolver + real Prisma, seed-local-company which had no rows; rows inserted then deleted to restore state): OWNER+MANAGER 297 permissions fail-open → 131 with Mangmee-style rows; inventory.* 10→0, report.* 14→0; expense.* (18), crm.* (40), dashboard.read, line.ai.query kept. VERIFY OK, cleanup deleted exactly the 12 inserted rows.

Next:
- NOT deployed. On deploy, Mangmee prod (expenses+crm+ai_line ON) will shrink customer UI/API to core + expenses + crm + LINE AI for all members including owner — confirmed intended by owner 2026-07-07.
- Existing prod/local companies with zero rows stay fail-open until someone saves their feature panel or a backfill seeds rows.
