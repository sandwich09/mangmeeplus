# Feature: Admin Company Onboarding and Partner Management

## 1. Status

- Roadmap/checklist item: Auth/RBAC follow-up for item 02 plus Web Core follow-up for item 03.
- Owner: Product / Platform Admin.
- Date: 2026-06-26.

## 2. Goal

Let WatchDog-BMS system admin onboard and manage customer-company partners without customer self-signup.

System admin creates the company, creates the first owner user with a temporary password, configures partner feature entitlement, AI model, and WatchDog shared LINE OA access, then gives the customer a web URL plus shared LINE OA/account-link instructions. The system-admin partner dashboard shows platform metadata only: company identity, lifecycle status, created/active dates, enabled features, AI model, and LINE link/context health. It never exposes customer business data.

## 3. Source Docs

- Product/overview: [[product/business-model|Business Model Draft]], [[product/business-use-cases|Business Use Cases]]
- Related specs: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]], [[specs/web-core-workspace-spec|Web Core Workspace Spec]], [[specs/data-model-core-spec|Data Model Core Spec]], [[specs/permission-matrix|Permission Matrix]], [[specs/chart-of-accounts-master-data-bootstrap-spec|Chart of Accounts Master Data Bootstrap Spec]]
- Related plans: [[plans/auth-rbac-audit-plan|Auth RBAC Audit Plan]], [[plans/web-core-workspace-plan|Web Core Workspace Plan]], [[plans/data-model-core-plan|Data Model Core Plan]], [[plans/chart-of-accounts-master-data-bootstrap-plan|Chart of Accounts Master Data Bootstrap Plan]]
- Related ADRs: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]], [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Auth]]

## 4. Non-goals

- Public self-service signup.
- Customer-created companies.
- Automated billing/subscription provisioning.
- Email/SMS delivery provider integration.
- Full support staff impersonation.
- System-admin access to customer sales, stock, accounting, customer, staff, or other business records.
- Hard deletion of a company or its customer data.
- Creating or provisioning a separate LINE OA per partner.
- Returning stored WatchDog shared LINE credential values after save.
- LINE-based password reset or final permission changes.
- Letting LINE create companies, users, roles, or memberships.
- Treating LINE OA add/follow as authorization by itself.

## 5. User Roles

- System admin: WatchDog-BMS operator who onboards and manages partner-company lifecycle, feature entitlement, AI model, and shared LINE OA readiness. System admin sees platform metadata only, never customer business data.
- Customer owner: first user for the new company; receives temporary credentials and completes setup.
- Customer admin: later company admin who manages company users and settings.
- Staff: later customer-company users invited by owner/admin, such as finance, inventory, sales, manager, requester, or auditor users. Staff account creation is outside first onboarding phase.
- LINE assistant user: linked customer user who can receive alerts and ask read-only questions within permissions.

## 6. Business Journey

1. Trigger: new customer signs commercial agreement or pilot starts.
2. System admin opens system-admin onboarding screen.
3. System admin enters company profile, owner name, owner login identifier, module package, timezone, locale, and optional shared LINE handoff readiness notes.
4. System creates company, head office branch, owner user, active membership, OWNER role grants, notification workflow defaults, reviewed company chart-of-accounts master, and audit events in one onboarding transaction. Document sequences are provisioned lazily on first document use (`documentSequence.upsert` in data-model-core), not inside the onboarding transaction.
5. System generates a temporary password once and displays a handoff package.
6. System admin sends customer the web URL, company code or company URL, temporary login credentials, LINE OA add link/QR, and LINE account-link instructions through an approved external channel.
7. Customer owner signs in to web, changes password, confirms company profile, and opens `/companies/[companyId]/dashboard`.
8. Customer owner adds the WatchDog shared LINE OA.
9. First LINE message or rich-menu tap checks `lineUserId`.
10. If `lineUserId` is unlinked, bot sends safe account-link guidance only and no business data.
11. Customer owner links LINE through LIFF/account-link URL or rich menu.
12. Account-link flow verifies LINE Login, verifies web login/session, and binds `lineUserId` to the internal `User`.
13. Backend resolves the user's active `CompanyMembership`; for one-company users it selects that company, and for multi-company users it requires a LIFF/web company selector before AI answers company data. Company context is never inferred from the shared LINE channel alone.
14. LINE webhook maps linked LINE identity to the internal user/company request context.
15. Customer can use web for full work and LINE for read-only AI, alerts, summaries, and deep links.
16. System admin opens partner dashboard to review company identity, lifecycle, enabled features, configured AI model, and LINE link/context health.
17. System admin can create or edit a partner company, activate/inactivate it, archive it, and change enabled features/AI model. WatchDog shared LINE OA credentials are platform configuration, not per-partner configuration.
18. Inactivation blocks customer web and LINE business access. Archive is a soft removal: preserve records/audit and deny normal access.
19. System admin cannot open customer-company operational dashboards or business records through partner management.

### 6.1 End-to-End Clarified Flow

This is the first-pass operating flow from WatchDog-BMS admin setup to customer LINE AI use:

1. WatchDog-BMS system admin logs in with protected system-admin access.
2. System admin creates a partner company.
3. System creates the first customer owner user, temporary password, company membership, OWNER role, default branch/setup records, and audit events.
4. System admin configures the partner company before handoff:
   - enabled features/modules
   - approved AI model identifier
   - WatchDog shared LINE OA add/account-link readiness
5. System admin gives the customer owner the handoff package:
   - web login URL
   - username
   - one-time temporary password
   - company dashboard URL
   - WatchDog shared LINE OA add link/QR
   - owner LINE account-link QR/URL: auto-issued single-use `EmployeeLineLinkToken` bound to the owner's company, membership, and user; 72h expiry matching the temporary-password window (employee in-person QR keeps 15 minutes)
   - LINE account-link URL/instructions
6. Customer owner logs in to web for the first time.
7. If temporary password is still active, customer owner may change password immediately or be forced by policy before business module access. Password change is optional only when `mustChangePassword=false`; temporary handoff credentials default to `mustChangePassword=true`.
8. Customer owner lands on `/companies/[companyId]/dashboard`.
9. Web UI shows only features enabled by system admin and also filtered by the owner's membership permissions.
10. Customer owner adds the WatchDog shared LINE OA.
11. Before account linking, LINE replies with account-link guidance only; no business data and no AI answer.
12. Customer owner links LINE through LIFF/web account-link flow.
13. Backend verifies LINE Login identity, authenticated internal user/session, active company membership, company lifecycle, feature entitlement, and permissions.
14. Linked LINE user can ask read-only business questions through LINE when `ai_line_assistant` is enabled.
15. First-pass AI has no autonomous agent that can take actions. It can classify/read/summarize with permission-checked tools, cite sources, and deep-link to web. It cannot create, edit, approve, post, export, change password, change permissions, or change company setup.

## 7. Business Rules

- Company onboarding is system-admin-only.
- Seeded system admin `thawatchai.watchdog` is a permanent super user.
- Seeded system admin cannot be deleted, disabled, demoted, renamed, or stripped of protected grants through normal application flows.
- Seeded system admin password can be changed through the approved password-change/reset path.
- Seeded system admin email and phone are optional and can be added later.
- Customer owner must change temporary password before accessing business modules.
- First customer owner login identifier uses `username` in the first implementation; email and phone can be added later.
- Customer owner temporary password expires after 72 hours.
- Temporary password is displayed once, hashed at rest, expires, and is never logged.
- If password expires or is lost before first login, system admin must regenerate a new temporary password.
- First owner gets OWNER role for that company only.
- System admin access does not become automatic membership in customer companies unless explicit support access is later approved.
- System-admin partner management is platform-scoped metadata access, not customer-company membership or support impersonation.
- Partner dashboard contains only company identity, lifecycle dates/status, feature entitlement, configured AI model, and LINE link/context health. It excludes all customer operational and financial data.
- Company lifecycle: `ACTIVE` permits customer use; `DISABLED` is inactive and denies customer web/LINE access; `ARCHIVED` is soft-removed, immutable through normal customer flows, and never hard-deleted.
- While a company is `DISABLED` or `ARCHIVED`, partner profile, feature entitlements, and AI model are metadata-frozen: the API rejects writes (422) and the partner detail UI renders them read-only. Only lifecycle transitions remain available; `ARCHIVED` can be re-activated by a system admin.
- System admin can create partner company through the onboarding creation flow, then edit company profile, activate/inactivate/archive company, configure enabled features, and choose approved AI model.
- Partner list must expose a primary create action that opens the company onboarding creation screen, so the operator does not need to know the hidden `/system/company-onboardings/new` route.
- WatchDog shared LINE OA is the only first-pass LINE channel. Partners do not need separate LINE OAs.
- WatchDog shared LINE credentials are platform secrets, encrypted at rest, write-only after save, and returned only as non-secret metadata/health. Audit logs must never contain secret values.
- Feature entitlement is deny-by-default: a customer can use a feature only when platform admin enables it and company/member authorization also passes.
- Feature entitlement is enforced at permission resolution: permissions belonging to a disabled feature are stripped for every request (including OWNER), so business-module APIs deny, the workspace nav hides the module, and LINE AI tools narrow together. Core plumbing (dashboard, account, notification read) is never feature-gated. The `ai_line_assistant` toggle is enforced at the LINE webhook. Companies with no entitlement rows at all (legacy) remain fail-open until configured.
- New companies are seeded at onboarding with an explicit row for every approved feature key. Omitted `modulePackage` defaults to the 7-menu `starter` feature preset, independently of commercial `planTier`; an explicitly selected supported preset is honored. Commercial renewals/tier changes preserve company feature overrides. Existing companies are not rewritten. See [Starter QA decisions](starter-web-qa-fixes-spec.md) (2026-09-11).
- AI model choice is an approved model identifier/configuration, not arbitrary provider credentials or prompt editing.
- AI model choice only selects the provider/model used by approved read-only AI flows. It does not enable autonomous agents or final mutations.
- Customer company access always uses active `CompanyMembership`.
- `companyId` in URL/header remains a selection hint; backend must verify membership and permissions.
- LINE identity must be linked before business data appears in LINE.
- LINE OA add/follow creates only a channel-scoped LINE user id. It does not grant access to web company data.
- Account linking requires both verified LINE identity and authenticated web/internal user.
- LINE AI answers require a server-derived request context with `userId`, `companyId`, `membershipId`, roles, permissions, and scopes.
- Multi-company LINE users must choose active company through LIFF/web before company-scoped answers.
- Shared LINE webhook must resolve company from linked user membership plus selected company context, not from `messagingChannelId`.
- Unlinked LINE users receive link/invite-required guidance only.
- Every company create, user create, temporary password issue/reset, membership grant, role grant, LINE OA follow if captured, LINE binding, account-link success/failure, and onboarding completion is audited.

## 8. Boundary and Ownership

- Web owns system-admin onboarding UI, customer first-login password-change screen, company setup confirmation, and LINE link entry points.
- LINE/LIFF owns account linking, rich menu link entry, and deep links after web-authenticated context exists.
- Backend/API owns company creation, user credential creation, membership, role grants, permission checks, audit, temporary password rules, LINE webhook identity lookup, account-link validation, selected-company context, and request-context resolution.
- AI Gateway owns no onboarding mutation; it can only answer after LINE/user/company context is linked and permission-checked.
- Workers/notifications own optional welcome notifications only after the user is active and preferences allow it.
- Platform management owns company lifecycle, feature entitlement, approved AI-model selection, and WatchDog shared LINE OA platform credential metadata/rotation.
- Out of boundary: billing, public signup, per-partner LINE OA provisioning, email/SMS provider, direct LINE permission changes.

## 9. Data Model Draft

Reuse existing:

- `Company`: customer tenant.
- `User`: customer owner/admin/staff identity.
- `CompanyMembership`: membership and role scope.
- `Role`, `Permission`, `MembershipRole`: access grants.
- `Branch`: head office/default branch.
- `ExternalIdentity`: linked LINE user on the WatchDog shared LINE channel.
- `LineConversation`: optional conversation state, including pending account-link/company-selection state if already implemented by item 07.
- `AuthSession`: first-party web session.
- `AuditLog`: security and onboarding audit trail.

Add or extend only if missing:

- `Company`
  - add `activatedAt`, `disabledAt`, and `archivedAt` lifecycle timestamps
  - add `ARCHIVED` company status; preserve existing `SUSPENDED` behavior for policy/security suspension
  - source of truth: data-model-core/company lifecycle

- `UserCredential`
  - `id`
  - `userId`
  - `type`: `PASSWORD`
  - `passwordHash`
  - `status`: `TEMPORARY`, `ACTIVE`, `DISABLED`
  - `mustChangePassword`
  - `expiresAt`
  - `createdAt`
  - `updatedAt`
  - source of truth: backend auth module

- `CompanyOnboardingRun`
  - `id`
  - `companyId`
  - `ownerUserId`
  - `status`: `DRAFT`, `COMPLETED`, `CANCELLED`, `FAILED`
  - `modulePackage`
  - `handoffUrl`
  - `lineAddUrl`
  - `lineLinkUrl`
  - `createdBySystemAdminUserId`
  - `completedAt`
  - source of truth: backend onboarding module

- `CompanyFeatureEntitlement`
  - `companyId`
  - `featureKey`
  - `enabled`
  - `updatedBySystemAdminUserId`
  - `createdAt`
  - `updatedAt`
  - source of truth: platform partner-management module

- `CompanyAiConfiguration`
  - `companyId`
  - `modelId`
  - `updatedBySystemAdminUserId`
  - `createdAt`
  - `updatedAt`
  - source of truth: platform partner-management module

- `PlatformLineChannel`
  - singleton/shared WatchDog LINE OA configuration
  - `lineOfficialAccountId`
  - `messagingChannelId`
  - `liffChannelId`
  - encrypted secret payload, secret version, status, last-validated timestamp, rotated timestamp
  - never returns secret value through normal API/UI
  - source of truth: platform credential module; reuse existing secret/vault primitive if present

- `LineCompanyContext`
  - `externalIdentityId`
  - `userId`
  - `companyId`
  - `source`: `AUTO_SINGLE_COMPANY`, `LIFF_SELECTOR`, `WEB_SELECTOR`, `ACCOUNT_LINK_TARGET`
  - `selectedAt`
  - `expiresAt`
  - source of truth: LINE account-link/company-context module

- `LineChannelBinding`
  - Existing company-scoped `messagingChannelId -> companyId` binding is incompatible with WatchDog shared OA because one shared channel serves many companies.
  - Refactor current webhook routing so `messagingChannelId` validates the shared WatchDog channel, then `ExternalIdentity` plus `LineCompanyContext` resolves company.

- `SystemProtectedPrincipal`
  - Can be implemented as fields on `User` or a small protected-principal registry.
  - Required protected seed username: `thawatchai.watchdog`
  - Protected actions: delete, disable, demote, edit username, remove super-user permission set.
  - Mutable action: password change/reset through approved auth flow.
  - Optional later fields: email, phone.
  - source of truth: auth/access-control module

## 10. Permission and Audit

- System admin permissions:
  - `system.company_onboarding.create`
  - `system.company_onboarding.read`
  - `system.company_onboarding.regenerate_temporary_password`
  - `system.line_binding.manage`
  - `system.partner_dashboard.read`
  - `system.partner_company.create`
  - `system.partner_company.update`
  - `system.partner_company.lifecycle.manage`
  - `system.partner_feature.manage`
  - `system.partner_ai_model.manage`
  - `system.shared_line_credential.manage`
- Seeded super-user permissions:
  - Includes all system-admin onboarding permissions.
  - Is implemented as protected `SYSTEM_ADMIN` membership on the internal `WatchDog System` tenant, never on a customer company.
  - Customer-company roles, including `OWNER`, exclude `system.*` permissions.
  - Normal role-management flows cannot remove the protected super-user grant.
- Customer permissions reuse existing company-scoped keys.
- ABAC:
  - System admin endpoints are platform-scoped, not customer-company-scoped.
  - Customer owner endpoints require active membership after onboarding.
  - Partner dashboard is metadata-only; support access to customer records is denied unless a later support-access feature exists.
- Sensitive actions to audit:
  - company created
  - owner user created
  - temporary password issued/regenerated
  - membership/role granted
  - handoff package viewed
  - LINE OA followed if webhook event is captured
  - account-link requested
  - protected system admin password changed/reset
  - protected system admin update/delete/demote attempt denied
  - first login succeeded/failed
  - password changed
  - LINE identity link succeeded/failed/unlinked
  - LINE company selected for multi-company user
  - onboarding completed
  - partner dashboard viewed
  - partner company profile created/edited
  - partner company activated/inactivated/archived
  - feature entitlement changed
  - AI model changed
  - WatchDog shared LINE credential created/replaced/rotated/validation failed; never include secret values

## 11. API Behavior

- `POST /v1/system/company-onboardings`
  - Permission: `system.company_onboarding.create`
  - Creates company package and returns one-time handoff payload.
  - Must be transactional for company, owner, membership, roles, defaults, onboarding run, and audit.
  - First pass creates only one first owner account. Staff accounts are invited/created later by the customer owner/admin flow.
  - This is the primary partner-company create backend path for item 10A.

- `GET /v1/system/company-onboardings/:id`
  - Permission: `system.company_onboarding.read`
  - Returns metadata, not temporary password.

- `POST /v1/system/company-onboardings/:id/regenerate-temporary-password`
  - Permission: `system.company_onboarding.regenerate_temporary_password`
  - Returns new one-time temporary password and invalidates prior temporary password.
  - Also revokes any pending owner LINE link token and returns a fresh owner account-link QR/URL package, so an expired handoff can be fully refreshed in one call.

- `POST /v1/auth/password/login`
  - Public authentication endpoint.
  - Validates login identifier and password, rejects expired temporary password, returns first-party session only after password-change requirement is known.

- `POST /v1/auth/password/change`
  - Authenticated endpoint.
  - Required before business module access when `mustChangePassword=true`.
  - Wrong current-password input returns 400 `current_password_incorrect`, distinct from session/authentication 401; see [current-password error feedback](current-password-error-feedback-spec.md).

- Existing LINE account-link endpoints remain source for LINE identity linking.

- `GET /v1/system/partners`
  - Permission: `system.partner_dashboard.read`
  - Returns metadata-only partner list; never customer business metrics or records.

- `GET /v1/system/partners/:companyId`
  - Permission: `system.partner_dashboard.read`
  - Returns company identity, lifecycle dates/status, feature entitlement, configured AI model, and LINE link/context health only.

- `POST /v1/system/partners`
  - Permission: `system.partner_company.create`
  - Optional compatibility alias for partner-management clients.
  - If implemented, it must delegate to the same onboarding creation path as `POST /v1/system/company-onboardings` and return the same one-time handoff payload.
  - First-pass web UI may call `POST /v1/system/company-onboardings` directly, but partner list must link to that create flow.

- `PATCH /v1/system/partners/:companyId`
  - Permission: `system.partner_company.update`
  - Updates allowed company profile metadata only.

- `POST /v1/system/partners/:companyId/lifecycle`
  - Permission: `system.partner_company.lifecycle.manage`
  - Transitions `ACTIVE`, `DISABLED`, or `ARCHIVED`; hard delete is unavailable.

- `PUT /v1/system/partners/:companyId/features`
  - Permission: `system.partner_feature.manage`
  - Replaces validated feature entitlement set.

- `PUT /v1/system/partners/:companyId/ai-model`
  - Permission: `system.partner_ai_model.manage`
  - Sets one approved AI model identifier.

- `PUT /v1/system/line/shared-credentials/:credentialKind`
  - Permission: `system.shared_line_credential.manage`
  - Creates/replaces encrypted WatchDog shared LINE credential. Response is metadata-only and must not reveal stored secret.
  - This is platform-level setup, not partner-level setup.

- `POST /v1/auth/line/link`
  - Public/LIFF entry plus authenticated web confirmation depending on current auth pattern.
  - Validates LINE Login token and binds `providerUserId` to authenticated internal user only after invite/session/membership check passes.

- LINE webhook message/follow behavior:
  - Verify webhook signature before parsing event.
  - Map `lineUserId` to active `ExternalIdentity`.
  - If no active identity, reply with account-link CTA only.
  - Validate `messagingChannelId` against the WatchDog shared LINE channel.
  - If linked to one active company membership, store/use `LineCompanyContext`, build request context, and allow read-only AI.
  - If linked to multiple active memberships with no selected company, reply with company selector deep link and no company data.
  - If linked but company/user/membership is suspended, reply with safe unavailable message and no hidden data counts.

Error cases:

- Duplicate company tax id or login identifier returns typed validation error.
- Customer owner login identifier is `username` in the first pass.
- Temporary password not returned after initial response.
- Expired temporary password requires system-admin regenerate.
- Customer owner temporary password older than 72 hours is expired.
- Suspended company/user/membership denies login or module access.
- Attempts to delete, disable, demote, rename, or remove protected grants from `thawatchai.watchdog` are denied and audited.
- Unlinked LINE identity receives safe no-data response.
- LINE OA follower without account link cannot call AI tools.
- Multi-company LINE user without selected company cannot receive company-scoped answer.
- Shared LINE channel without selected company context cannot receive company-scoped answer.

## 12. UI Behavior

### Web

- System-admin screen:
  - Partner dashboard/list with company name/code, created/active dates, lifecycle status, enabled features, AI model, and LINE link/context health.
  - Partner detail actions: create, edit, activate, inactivate, archive, configure features, and select approved AI model.
  - Platform LINE settings action: manage WatchDog shared LINE OA credentials and health separately from partner detail.
  - No customer operational/financial dashboard or records.
  - Company profile form.
  - Owner user form.
  - Module package selector.
  - Shared LINE OA/account-link readiness fields.
  - Create onboarding run action.
  - Handoff result with web URL, login id, one-time temporary password, company dashboard URL, WatchDog shared LINE OA add URL/QR, company-scoped LINE account-link URL, and setup checklist.
- Customer first-login screen:
  - Temporary password login.
  - Forced password change before workspace access.
  - Company profile confirmation.
  - LINE link CTA.
- Workspace:
  - After setup, customer lands on `/companies/[companyId]/dashboard`.
  - Unauthorized routes show `ForbiddenState`.
  - Loading and error states follow Web Core Workspace patterns.

### LINE/LIFF

- WatchDog shared LINE OA add/follow alone does not enable AI data access.
- LINE rich menu includes `Link Account`, `Ask AI`, and `Open Web`.
- First message from unlinked LINE user replies with account-link CTA only.
- Account-link flow verifies LINE Login plus web/internal user login before binding.
- Unknown LINE user sees invite/link-required message.
- Multi-company user sees company selector before AI can answer company-scoped questions.
- Linked user can ask read-only questions and receive alerts.
- Any final create/update/approve/post/export/password/permission/company setup action opens web.

## 13. Edge Cases

- Customer loses temporary password before first login: system admin regenerates; old password invalid.
- Customer owner waits over 72 hours before first login: temporary password expires and system admin regenerates.
- Customer needs staff users during onboarding: first phase stops at first owner; owner/admin invites staff after company setup.
- Customer logs in but does not link LINE: web works; LINE data remains unavailable.
- Customer links wrong LINE account: owner/admin can unlink and relink from web.
- Owner user belongs to multiple companies: web requires company selection; LINE uses selected/default company or asks user to choose through LIFF/web.
- Customer adds WatchDog shared LINE OA but never links account: bot remains in link-required mode and AI tools do not run.
- Customer links LINE before changing temporary password: account link can be staged, but business module and AI access stays blocked until password is changed if auth policy requires first-login completion.
- Existing LINE user is removed from company: next LINE message must deny data after membership re-check.
- Company is suspended after onboarding: web and LINE deny business data.
- System admin attempts customer operational route with platform permission only: deny; partner dashboard remains metadata-only.
- System admin archives partner: retain data/audit; deny customer sessions and integrations; do not hard-delete.
- WatchDog shared LINE credential is replaced or rotation validation fails: old/new secret is never returned; platform settings shows safe status only.
- System admin views handoff package later: password is not shown again.

## 14. Acceptance Criteria

- [ ] System admin can create a company onboarding run from web.
- [ ] Seed creates permanent protected system admin `thawatchai.watchdog`.
- [ ] Protected system admin cannot be deleted, disabled, demoted, renamed, or stripped of protected grants through normal flows.
- [ ] Protected system admin password can be changed through approved auth flow.
- [ ] System creates company, owner user, membership, OWNER role assignment, default branch, notification workflow defaults, the reviewed 175-row company chart-of-accounts master, and audit records in one transaction. (Document sequences are provisioned lazily on first document use, outside this transaction.)
- [ ] Any chart bootstrap or post-condition failure rolls back the whole onboarding transaction and returns a visible stable error; no onboarding run becomes completed partially.
- [ ] First pass creates first owner only; staff accounts are later customer-admin scope.
- [ ] System displays temporary password once and never logs it.
- [ ] Customer owner temporary password expires after 72 hours.
- [ ] Customer owner can log in with temporary password and must change it before module access.
- [ ] Customer owner can open `/companies/[companyId]/dashboard`.
- [ ] Customer owner can link LINE through approved LIFF/account-link flow.
- [ ] LINE OA add/follow without account link cannot access AI business answers.
- [ ] Account-link flow binds verified LINE `lineUserId` to authenticated internal user and active company membership.
- [ ] Unlinked LINE user cannot see business data.
- [ ] Multi-company linked LINE user must select company before company-scoped AI answer.
- [ ] Linked LINE user can receive alerts and use read-only AI within permissions.
- [ ] Backend re-checks membership and permission for every web and LINE request.
- [ ] System admin can list and inspect partner metadata without customer business data.
- [ ] System admin can start partner-company creation from the partner list, complete the company onboarding flow, edit partner company, activate/inactivate/archive it, and hard delete is unavailable.
- [ ] System admin can configure per-partner feature entitlement and approved AI model.
- [ ] System admin can create/replace/rotate WatchDog shared LINE credentials; returned data never contains secret values.
- [ ] Lifecycle, feature, AI-model, and credential actions are permission-checked and audited.

## 15. Test Cases

- Unit: temporary password generation stores only hash and sets expiry.
- Unit: customer owner temporary password expires after 72 hours.
- Unit: protected system admin update/delete/demote/grant-removal guard denies normal mutation.
- Unit: onboarding run state cannot complete without company, owner, membership, and role grant.
- API: system admin can create onboarding run.
- API: seeded `thawatchai.watchdog` can authenticate and has onboarding permissions.
- API: non-system-admin cannot create onboarding run.
- API: temporary password is returned only on create/regenerate response.
- API: customer must change temporary password before protected business module access.
- API: inactive membership denies web and LINE access.
- Integration: create onboarding -> customer login -> password change -> dashboard access -> add WatchDog shared LINE OA -> unlinked bot refusal -> account link -> selected company context -> LINE read-only answer with source refs/web link.
- Integration: linked multi-company user receives company selector before company-scoped AI answer.
- UI: system-admin form loading, validation, duplicate, success, forbidden, and error states.
- API: system admin partner list/detail excludes customer operational/financial fields.
- API: system admin can activate/inactivate/archive company; archived company is not deleted.
- API: system admin changes feature entitlement/AI model; disabled feature is denied by runtime authorization.
- API: WatchDog shared LINE credential write/rotate response and audit log never expose secret value.
- Integration: onboarding creates all 175 company-owned chart rows; a forced chart failure leaves no company, owner, membership, branch, chart rows, or completed onboarding run.

## 16. Owner Update 2026-07-29 — Company Chart Master Bootstrap

- New companies receive the fixed reviewed `TH_SME_COA_V1` chart automatically; each company does not upload the source CSV separately.
- The chart is copied into company-owned rows inside the existing onboarding transaction.
- System-admin responses expose only template key/version/count/readiness, not customer chart details.
- Automatic posting and Tax Code activation remain blocked until accountant-reviewed mappings are complete.
- Full behavior, existing-company migration, compatibility impact, and verification are governed by [[specs/chart-of-accounts-master-data-bootstrap-spec|Chart of Accounts Master Data Bootstrap Spec]] and [[plans/chart-of-accounts-master-data-bootstrap-plan|its implementation plan]].
- Integration: platform partner dashboard -> edit lifecycle/features/AI, manage shared LINE settings, link customer to selected company context -> customer/LINE access reflects active entitlement; platform user remains unable to read business records.

## 16. Owner Decisions

- Seeded permanent system admin username is `thawatchai.watchdog`.
- Seeded system admin is protected from delete, disable, demote, username edit, and protected grant removal.
- Seeded system admin password can be changed.
- Seeded system admin email and phone are optional later fields.
- First customer owner login identifier uses `username`.
- Customer owner temporary password expires after 72 hours.
- First onboarding phase creates first owner only. Staff users are invited or created later by customer owner/admin.
- Staff means customer-company users under the owner/admin, such as finance, inventory, sales, manager, requester, or auditor users.
- Platform admin partner dashboard is metadata-only. It must not become customer operational support access.
- Inactive means `DISABLED`; remove means `ARCHIVED` soft removal, never hard delete.
- Per-company AI model selection uses approved model identifiers only.

## 17. Open Questions

- Should temporary password be sent manually only, or should email/SMS delivery be added later?
