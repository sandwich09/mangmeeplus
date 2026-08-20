# Authentication, Authorization, and RBAC Spec

## 1. Goal

Define the identity and access model for WatchDog-BMS before business modules are implemented.

This spec covers:

- Authentication: who the user is.
- Authorization: what the user can do in a company.
- RBAC: role-to-permission grants.
- ABAC hooks: record-level and policy conditions that narrow RBAC.
- Audit: security-relevant access and mutation trail.

## 2. Design Principles

- Deny by default.
- Authentication and authorization are separate concerns.
- LINE Login validates user identity for LINE and LIFF account-link entry; WatchDog-BMS owns first-party session issuance, company membership, roles, permissions, policy rules, and audit.
- Cognito or another identity broker may be used behind the backend later, but MVP end-user login is LINE Login.
- Tenant boundary is always company/workspace.
- Server derives trusted user, company, membership, roles, and permissions.
- Client-submitted company context is only a selection hint and must be verified server-side.
- UI hiding is not access control.
- AI tools inherit the exact permissions and record scope of the requesting user.
- Sensitive actions are audited even when allowed.

## 3. Current Scaffold

The codebase already has the first fail-closed boundary:

- `DenyByDefaultGuard`: blocks non-public routes without permission metadata and auth context.
- `@Public()`: marks health or intentionally public routes.
- `@RequirePermissions(...)`: marks protected routes with required permission keys.
- `SecurityModule`: registers the guard globally in API and AI Gateway.

The next implementation phase must add JWT verification, request context loading, membership lookup, role/permission resolution, and audit persistence.

## 4. Authentication Model

### Production

Use LINE Login as the primary identity provider for LINE and LIFF users.

Production API should accept only WatchDog-BMS first-party sessions or JWTs issued after backend validation of LINE identity. Business APIs should not rely on long-lived raw LINE access tokens as application credentials.

Login/token exchange verifies LINE identity using:

- `iss`: expected LINE issuer.
- `aud` or `client_id`: expected LINE Login channel id.
- `exp`, `nbf`, and token use.
- nonce/state where applicable.
- signature validation through LINE-supported verification.
- Supported algorithm allowlist.

API verifies WatchDog-BMS first-party sessions/JWTs using:

- expected issuer.
- expected audience or client id.
- expiration and not-before time.
- signature validation.
- session revocation where applicable.

Rejected cases:

- Missing token.
- Expired token.
- Invalid issuer.
- Invalid audience/client id.
- Invalid signature.
- Unlinked LINE identity.
- Disabled or unknown mapped user.

### Local Development

Local development may use one of these strategies:

- Signed dev JWT with a local-only secret.
- Fixed dev identity header allowed only when `NODE_ENV=development`.
- Mock LINE Login adapter allowed only when `APP_ENV=local`.

Local auth must never be enabled in `staging` or `production`.

## 5. Request Context

Every authenticated request gets a server-created context:

```ts
type RequestContext = {
  requestId: string;
  authSubject: string;
  userId: string;
  companyId: string;
  membershipId: string;
  roles: string[];
  permissions: string[];
  scopes: {
    branchIds?: string[];
    locationIds?: string[];
    teamIds?: string[];
  };
};
```

Rules:

- `authSubject` comes from the first-party WatchDog-BMS session/JWT subject.
- `authSubject` maps back to an internal `User`, which may be linked to a LINE `ExternalIdentity`.
- `userId` is the internal user id mapped from `authSubject`.
- `companyId` is selected from a header, route, subdomain, or session preference, then verified against membership.
- Normal employee users may have only one active company membership. Only users with an active `OWNER` membership may hold active memberships in more than one company.
- Unknown or inactive membership is rejected.
- Removed or inactive company membership fails closed for web, LIFF, LINE webhook processing, deep links, notifications, uploads, AI tools, and internal API calls.
- Suspended user or company is rejected.

## 6. Data Model

Minimum tables:

- `User`
- `AuthSession`
- `ExternalIdentity`
- `PlatformLineChannel`
- `LineCompanyContext`
- `LineChannelBinding` (legacy/company-specific binding only; shared WatchDog OA must not resolve company from channel id)
- `Company`
- `CompanyMembership`
- `Role`
- `Permission`
- `RolePermission`
- `MembershipRole`
- `AuditLog`

Recommended fields:

```text
User
- id
- email
- displayName
- status
- createdAt
- updatedAt

AuthSession
- id
- userId
- tokenId
- status
- issuedAt
- expiresAt
- revokedAt
- createdAt
- updatedAt

ExternalIdentity
- id
- userId
- provider
- providerUserId
- providerChannelId
- status
- linkedAt
- lastLoginAt

PlatformLineChannel
- id
- lineOfficialAccountId
- messagingChannelId
- liffChannelId
- status
- secretVersion
- lastValidatedAt
- createdAt
- updatedAt

LineCompanyContext
- id
- externalIdentityId
- userId
- companyId
- source
- selectedAt
- expiresAt
- createdAt
- updatedAt

LineChannelBinding (legacy/company-specific only)
- id
- companyId
- lineOfficialAccountId
- messagingChannelId
- liffChannelId
- status
- createdAt
- updatedAt

Company
- id
- name
- taxId
- status
- createdAt
- updatedAt

CompanyMembership
- id
- companyId
- userId
- status
- defaultBranchId
- createdAt
- updatedAt

Role
- id
- companyId nullable for system roles
- key
- name
- description
- isSystem

Permission
- id
- key
- description
- riskLevel

RolePermission
- roleId
- permissionId

MembershipRole
- membershipId
- roleId

AuditLog
- id
- companyId
- actorUserId
- action
- targetType
- targetId
- requestId
- metadataJson
- createdAt
```

## 7. Permission Naming

Use stable permission keys:

```text
module.resource.action
```

Examples:

```text
inventory.product.read
inventory.product.create
inventory.stock_movement.create
accounting.invoice.read
accounting.invoice.issue
accounting.invoice.void
tax.report.export
admin.user.manage
admin.role.manage
ai.tool.invoke
audit.log.read
```

Action vocabulary:

- `read`
- `create`
- `update`
- `delete`
- `approve`
- `issue`
- `void`
- `export`
- `manage`
- `invoke`

Avoid vague permissions such as `admin` or `full_access` in route metadata. OWNER can still receive all defined permissions through role grants.

## 8. Default Roles

Seed roles should align with `docs/specs/permission-matrix.md`:

- OWNER
- ADMIN
- MANAGER
- SALES
- INVENTORY
- FINANCE
- ACCOUNTANT
- MARKETING
- STAFF
- AUDITOR_READONLY

Rules:

- System roles can be seeded globally.
- Company-specific custom roles can be added later.
- OWNER must still pass audit; owner role is not an audit bypass.
- Role changes are sensitive and always audited.
- The internal employee roles (`OWNER`, `ADMIN`, `MANAGER`, `SALES`, `INVENTORY`, `FINANCE`,
  `ACCOUNTANT`, `MARKETING`, `STAFF`) receive the feature-gated employee self-service baseline:
  own expense capture/evidence/draft maintenance, own reimbursement request lifecycle, and own
  personal signature. This does not grant review, approval, payment, role administration, or access
  to another employee's rows.
- `AUDITOR_READONLY`, platform/view roles, and company custom roles are not inferred to be internal
  employees. Custom roles opt in through the existing self-service capability packs.

### 8.1 Owner-delegated granting (team decision 2026-07-28)

These are standing product rules, not implementation accidents. When someone asks
"why can't the admin do X", the answer is here.

1. **A default ADMIN cannot hand out permissions.** `access.role.manage`,
   `admin.role.manage`, and `access.role_template.manage` are NOT in the default
   ADMIN grants. The owner delegates role management by composing a custom role
   that carries those keys and assigning it to the specific admin they trust.
   No other admin can pass that role on: the assign-subset rule blocks granting
   any permission the assigner does not hold (`roleGrantViolation`,
   `employee-access.logic.ts`).
2. **ADMIN still runs day-to-day staffing.** Creating employees and assigning
   roles whose permissions are a subset of the admin's own remains allowed.
3. **FINANCE and ACCOUNTANT role assignment requires the owner** — gated by the
   owner-only `access.role.financial.assign` (pre-existing rule).
4. **Company-wide reimbursement visibility is owner-granted.** Composing
   `reimbursement.read` into a custom role (create or update) requires
   `access.role.financial.assign` (`ownerGatedGrantViolation`). Assigning an
   existing system role that already carries the key (e.g. MANAGER) is normal
   employee management and is deliberately not gated.

### 8.2 Reimbursement approval and visibility (team decision 2026-07-28)

1. The requester always sees their own request status (`reimbursement.read_own`):
   approved, awaiting transfer, paid.
2. ACCOUNTANT and OWNER see which requests are still owed to employees —
   `reimbursement.read` + the finance queue (`reimbursement.finance_review`).
3. Approvers are **OWNER / ADMIN / MANAGER** (`reimbursement.approve`/`.reject`).
   Paying stays FINANCE-only (`reimbursement.payment.record`), so the approver
   and the payer are always different hands; the per-user self-approval guard
   applies on top.

### 8.3 Related-record visibility (owner decision 2026-08-09)

1. A company member who is related to a business record may view that record and its linked document chain. Relationship
   includes creator/requester, current assignee/handler, approver, payer/payee or payment actor, issuer/void actor, and the
   same actors reached through source, conversion, allocation, evidence, or parent/child links.
2. Relationship is an additive **view-only ABAC path**. It never grants update, approve, issue, pay, void, delete, export,
   or another final mutation. Every mutation still requires its action permission/role and the current state transition.
3. Tenant, active membership, feature entitlement, branch scope, and sensitive-field redaction remain mandatory. A linked
   record outside the caller's tenant or branch scope is not made visible by the relationship graph.
4. Collection APIs include only broadly readable records plus related records. A related-read permission such as
   `accounting.document.read_related`, `expense.read_own`, or `reimbursement.read_own` is the feature-entitlement gate;
   relation checks are repeated by the source module and are not delegated to UI or AI Gateway.
5. Relationship follows persisted links transitively in both directions until the finite graph reaches closure. Traversal
   is cycle-safe and reapplies tenant/branch scope when every candidate id becomes a record; an action actor does not become
   authorized merely because they know an id.

## 9. Authorization Pipeline

Every protected request follows this order:

```text
HTTP request
-> request id
-> token verification
-> internal user lookup
-> company context selection
-> membership lookup
-> role and permission resolution
-> route permission metadata check
-> ABAC policy check
-> use case input validation
-> business action
-> audit event when required
```

Guard behavior:

- `@Public()` skips auth and permission checks.
- Missing auth on protected route returns `401`.
- Missing route permission metadata returns `403`.
- Missing permission returns `403`.
- Missing or invalid company membership returns `403`.
- ABAC policy denial returns `403`.

## 10. ABAC Policy Hooks

RBAC answers "can this role perform this action type?"

ABAC answers "can this user perform this action on this specific record now?"

Initial ABAC checks:

- Own record only.
- Assigned team only.
- Allowed branch only.
- Allowed stock location only.
- Amount approval limit.
- Document status allows transition.
- Accounting period is not closed.
- Tax-sensitive action requires extra permission.

Example:

```text
Permission: reimbursement.request.approve
ABAC: user must be assigned approver OR manager of requester.
ABAC: amount must be within approval limit.
ABAC: request status must be submitted.
```

## 11. Route Metadata Pattern

Controllers should declare security intent near the route:

```ts
@Get(':id')
@RequirePermissions('inventory.product.read')
getProduct() {}

@Post()
@RequirePermissions('inventory.product.create')
createProduct() {}
```

Public routes must be explicit:

```ts
@Public()
@Get('health')
getHealth() {}
```

No business route should be public.

## 12. AI Gateway Authorization

AI Gateway must not bypass ERP core authorization.

Rules:

- AI Gateway verifies user context before tool invocation.
- Tool definitions declare required permissions and risk level.
- ERP core repeats permission and policy checks for source-of-truth reads and mutations.
- AI cannot directly query business tables.
- AI cannot perform final money, stock, tax, or permission mutations without deterministic server validation.
- Tool calls touching customer, stock, finance, tax, export, or permission data are audited.

Tool policy fields:

```text
toolKey
requiredPermission
riskLevel
allowedActions
requiresConfirmation
auditRequired
```

## 13. Audit Requirements

Always audit:

- Login mapping failure caused by unknown internal user.
- LINE account link and unlink.
- Company context switch.
- User invite, disable, role change, permission change.
- Export.
- Receipt/bill image capture and document extraction when it creates or updates a draft.
- AI tool invocation touching sensitive data.
- Stock adjustment.
- Accounting document issue, void, credit note, debit note.
- Payment create/update.
- Tax report generation/export.
- Period close/unclose.
- Workflow rule enable/disable.

Audit event minimum:

```text
actorUserId
companyId
action
targetType
targetId
requestId
result
metadataJson
createdAt
```

Do not store raw tokens, passwords, full prompts, or full document payloads in audit metadata. Store hashes or redacted summaries.

## 14. API Headers

Recommended headers:

```text
Authorization: Bearer <watchdog-access-token>
X-Company-Id: <company-id>
X-Request-Id: <request-id>
```

Rules:

- `Authorization` required for protected routes after LINE Login/session exchange.
- `X-Company-Id` required when user belongs to more than one company.
- Server may generate `X-Request-Id` if missing.
- Server must validate that requested company belongs to the authenticated user.

## 15. Error Model

Recommended responses:

- `401 Unauthorized`: missing/invalid/expired token.
- `403 Forbidden`: valid identity but no membership, permission, or policy access.
- `404 Not Found`: resource does not exist or is intentionally hidden across tenant boundary.
- `422 Unprocessable Entity`: valid JSON but invalid business input.

Do not reveal:

- Whether another company owns a resource.
- Internal role grant details.
- SQL details.
- Token validation internals.

## 16. Implementation Phases

### Phase 1: Auth Boundary

- Add auth module.
- Add JWT verifier interface.
- Add WatchDog-BMS first-party session/JWT verifier.
- Add LINE Login token validation and account-linking flow.
- Add local dev auth adapter.
- Add request context type and provider.
- Add tests for missing token, invalid token, and public route.

### Phase 2: Membership and RBAC

- Add identity/access data model.
- Add seed roles and permissions.
- Resolve membership roles into permissions.
- Wire request context into guard.
- Add tests for no membership, no route permission metadata, no permission, and allowed permission.

### Phase 3: ABAC and Audit

- Add policy interface.
- Add first policies: own record, branch/location scope, amount limit.
- Add audit log service and repository.
- Add tests for cross-company denial and sensitive mutation audit.

### Phase 4: AI Gateway Tool Policy

- Add tool permission metadata.
- Add AI tool audit.
- Ensure AI Gateway calls ERP core through permission-checked APIs.
- Add tests proving AI cannot bypass ERP permission checks.

## 17. Required Tests

- Public health route succeeds without auth.
- Protected route without token returns `401`.
- Protected route without permission metadata returns `403`.
- LINE login with invalid token returns `401`.
- Unlinked LINE identity cannot access business data.
- Authenticated user without company membership returns `403`.
- Authenticated user without required permission returns `403`.
- Authenticated user with required permission succeeds.
- Cross-company resource access is denied or hidden.
- Sensitive mutation writes audit log.
- Role change writes audit log.
- AI tool invocation is scoped to user permissions.

## 18. First Implementation Decisions

- Local dev auth uses signed dev JWTs first. Fixed dev headers are local test fixtures only; mock LINE Login can come later.
- OWNER MFA starts as policy/config hooks for exports, tax actions, role changes, permission changes, and other high-risk actions. Full MFA UX/enrollment can follow after auth foundation is stable.
- `ACCOUNTANT` starts as a normal company membership role. A separate external collaborator model is deferred.
- Branch/location policy hooks are implemented in item 02, but mandatory enforcement starts with Inventory MVP and expands module by module.
- First account-linking flow uses an admin-created internal user or invite link before LINE identity is attached. Self-join is deferred.

## 19. Implementation Handoff Contract

This section is the implementation-ready contract for Master Implementation Checklist item 02. The linked plan controls sequencing. The spec below controls behavior and interfaces.

### 19.1 Target Source Paths

Use existing NestJS service boundaries and backend hexagonal guideline.

API source paths:

```text
apps/api/prisma/schema.prisma
apps/api/prisma/seed.ts
apps/api/src/common/security/
apps/api/src/common/request-context/
apps/api/src/modules/auth/
apps/api/src/modules/access-control/
apps/api/src/modules/audit/
```

AI Gateway source paths:

```text
apps/ai-gateway/src/common/security/
apps/ai-gateway/src/common/request-context/
apps/ai-gateway/src/modules/tool-policy/
```

Shared contract paths:

```text
packages/contracts/src/auth.ts
packages/contracts/src/access-control.ts
packages/contracts/src/audit.ts
packages/contracts/src/index.ts
```

Do not put business logic inside controllers or guards. Controllers wire HTTP only. Guards enforce boundary rules. Use cases and domain services own auth, RBAC, policy, and audit decisions.

### 19.2 Required Ports and Domain Services

API ports:

```ts
export interface TokenVerifierPort {
  verifyAccessToken(rawToken: string): Promise<VerifiedAuthToken>;
}

export interface TokenIssuerPort {
  issueAccessToken(input: IssueAccessTokenInput): Promise<IssuedToken>;
  issueRefreshToken(input: IssueRefreshTokenInput): Promise<IssuedToken>;
}

export interface LineIdentityVerifierPort {
  verifyLoginToken(input: VerifyLineLoginTokenInput): Promise<VerifiedLineIdentity>;
}

export interface LineWebhookSignatureVerifierPort {
  verifySignature(input: VerifyLineWebhookSignatureInput): Promise<boolean>;
}

export interface RequestContextResolverPort {
  resolve(input: ResolveRequestContextInput): Promise<RequestContext>;
}

export interface PermissionResolverPort {
  resolveForMembership(input: ResolvePermissionsInput): Promise<ResolvedAccess>;
}

export interface PolicyEvaluatorPort {
  evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult>;
}

export interface AuditLogRepositoryPort {
  append(event: AuditEventInput): Promise<AuditEventRecord>;
  list(input: AuditLogListInput): Promise<PaginatedAuditLog>;
}
```

Concrete implementations should live under each module's `infrastructure/` folder. Pure models, enums, and policy logic should live under `domain/`.

### 19.3 Request Context Contract

The API must attach one typed context to every authenticated protected request:

```ts
type RequestContext = {
  requestId: string;
  authSubject: string;
  sessionId?: string;
  userId: string;
  companyId: string;
  membershipId: string;
  roles: string[];
  permissions: string[];
  scopes: {
    branchIds?: string[];
    locationIds?: string[];
    teamIds?: string[];
  };
  authProvider: 'watchdog' | 'line' | 'dev';
};
```

Rules:

- `requestId` comes from `X-Request-Id` or is generated server-side.
- `companyId` comes from `X-Company-Id`, route context, session preference, or single active membership.
- When both `X-Company-Id` and route `:companyId` are present they must be identical; an authenticated mismatch is rejected before request-context resolution.
- `companyId` is always verified against active membership.
- `X-Company-Id` and explicit company selection are required only for owner multi-company sessions. Non-owner employees should resolve from their single active company membership.
- `roles`, `permissions`, and `scopes` come from database records only.
- Guards and use cases read request context from a typed helper, not from ad hoc `request.user`.

### 19.4 Prisma Model Contract

Use Prisma/PostgreSQL. Prefer `String @id @default(cuid())` unless the repo has already standardized on UUIDs before implementation starts.

Required enums:

```text
UserStatus: ACTIVE, SUSPENDED, DISABLED
CompanyStatus: ACTIVE, SUSPENDED, DISABLED
MembershipStatus: ACTIVE, INVITED, SUSPENDED, DISABLED
IdentityProvider: LINE, DEV
ExternalIdentityStatus: ACTIVE, UNLINKED, DISABLED
AuthSessionStatus: ACTIVE, REVOKED, EXPIRED
RoleStatus: ACTIVE, DISABLED
PermissionRiskLevel: LOW, MEDIUM, HIGH, CRITICAL
AuditResult: SUCCESS, DENIED, FAILED
AuditRiskLevel: LOW, MEDIUM, HIGH, CRITICAL
```

Required models and constraints:

```text
User
- id
- email nullable unique
- displayName
- status
- createdAt
- updatedAt

AuthSession
- id
- userId
- tokenId unique
- status
- issuedAt
- expiresAt
- revokedAt nullable
- createdAt
- updatedAt
- index userId,status,expiresAt

ExternalIdentity
- id
- userId
- provider
- providerUserId
- providerChannelId
- status
- linkedAt
- lastLoginAt nullable
- createdAt
- updatedAt
- unique provider,providerChannelId,providerUserId
- index userId,provider,status

PlatformLineChannel
- id
- lineOfficialAccountId
- messagingChannelId
- liffChannelId
- status
- secretVersion
- lastValidatedAt
- createdAt
- updatedAt
- unique messagingChannelId

LineCompanyContext
- id
- externalIdentityId
- userId
- companyId
- source
- selectedAt
- expiresAt
- createdAt
- updatedAt
- index userId,companyId
- index externalIdentityId,expiresAt

LineChannelBinding (legacy/company-specific only)
- id
- companyId
- lineOfficialAccountId
- messagingChannelId
- liffChannelId
- status
- createdAt
- updatedAt
- unique companyId,messagingChannelId
- index messagingChannelId,status

Company
- id
- name
- taxId nullable
- status
- createdAt
- updatedAt

CompanyMembership
- id
- companyId
- userId
- status
- defaultBranchId nullable
- createdAt
- updatedAt
- unique companyId,userId
- index userId,status
- policy: at most one active non-OWNER company membership per user; active multi-company membership is OWNER-only

Role
- id
- companyId nullable
- scopeKey
- key
- name
- description nullable
- isSystem
- status
- createdAt
- updatedAt
- unique scopeKey,key

Permission
- id
- key unique
- description
- riskLevel
- createdAt
- updatedAt

RolePermission
- roleId
- permissionId
- unique roleId,permissionId

MembershipRole
- membershipId
- roleId
- unique membershipId,roleId

AuditLog
- id
- companyId nullable
- actorUserId nullable
- action
- targetType
- targetId nullable
- requestId
- result
- riskLevel
- metadataJson
- createdAt
- index companyId,createdAt
- index actorUserId,createdAt
- index targetType,targetId
- index requestId
```

`Role.scopeKey` prevents duplicate system roles when `companyId` is nullable. Use `system` for global roles and company id for company-local custom roles.

### 19.5 Permission Registry Seed

Seed permission keys from one registry so route metadata, tests, and role grants cannot drift.

Minimum item 02 permission keys:

```text
account.session.read
account.identity.link
account.identity.unlink
company.setup.read
company.setup.manage
admin.user.read
admin.user.manage
admin.role.read
admin.role.manage
audit.log.read
ai.tool.invoke
```

Initial grants:

```text
OWNER: all seeded permissions
ADMIN: account.*, company.setup.*, admin.user.*, admin.role.*, audit.log.read, ai.tool.invoke
MANAGER: account.session.read, company.setup.read, ai.tool.invoke
SALES: account.session.read, ai.tool.invoke
INVENTORY: account.session.read, ai.tool.invoke
FINANCE: account.session.read, company.setup.read, ai.tool.invoke
ACCOUNTANT: account.session.read, company.setup.read, audit.log.read, ai.tool.invoke
MARKETING: account.session.read, ai.tool.invoke
STAFF: account.session.read, ai.tool.invoke
AUDITOR_READONLY: account.session.read, company.setup.read, audit.log.read, ai.tool.invoke
```

Rules:

- Do not use `admin` or `full_access` as route metadata.
- OWNER receives all permissions through role grants, not hard-coded bypass.
- `audit.log.read` is ABAC-filtered by audit category and role. `OWNER` and `AUDITOR_READONLY` can read all company audit records. `ADMIN` can read admin/security audit categories. `ACCOUNTANT` can read accounting/tax/finance audit categories.
- Future business modules may add new permission keys in their own migrations/seeds, but must keep this naming convention.

### 19.6 API Endpoint Contract

All routes are under `/v1`.

```text
POST /auth/dev/token
- Public route.
- Local/test only.
- Issues first-party access/refresh token for seeded dev user.
- Production or staging returns 404 or 403 and startup should fail if enabled.

POST /auth/line/exchange
- Public route.
- Accepts LINE Login token/code exchange input.
- Verifies LINE identity.
- Maps active ExternalIdentity to active internal user.
- Issues first-party access/refresh token.
- Unknown/unlinked identity returns link-required response without business data.

POST /auth/line/link
- Protected route.
- Permission: account.identity.link.
- Verifies LINE identity and links it to current internal user.
- Audits success, denial, and failure.

POST /auth/line/unlink
- Protected route.
- Permission: account.identity.unlink.
- Unlinks LINE identity from current user or admin-selected user when user management permission exists.
- Audits success, denial, and failure.

POST /auth/session/refresh
- Public or refresh-token route.
- Verifies refresh token/session status.
- Rotates token id where implemented.
- Revoked/expired session returns 401.

POST /auth/logout
- Protected route.
- Revokes current session/token id.
- Audits logout/session revocation.

GET /auth/me
- Protected route.
- Permission: account.session.read.
- Returns current user, active company, memberships, roles, permissions, and scopes safe for UI.

GET /companies/:companyId/audit/logs
- Protected route.
- Permission: audit.log.read.
- Resolves tenant from the route and requires it to match the request context.
- Applies role/category ABAC filter: full company for OWNER/AUDITOR_READONLY, admin/security for ADMIN, accounting/tax/finance for ACCOUNTANT.
- Returns bounded paginated audit records.
```

Admin role/user endpoints can be deferred until business UI exists, but role-change use cases and tests must exist before any route can mutate roles.

### 19.7 Guard and Error Behavior

Required order:

```text
request id
-> public route check
-> token extraction
-> token verification
-> request context resolution
-> route permission metadata check
-> permission check
-> ABAC hook where use case requests it
-> use case validation/action
-> audit event when required
```

Response rules:

- Missing token: `401`.
- Invalid/expired token: `401`.
- Unknown or disabled user: `401` or `403`; prefer `403` when identity is valid but disabled.
- Missing company context for owner multi-company user: `403`.
- Non-owner user with more than one active company membership: `403` and audit policy violation until Admin fixes membership.
- Inactive membership: `403`.
- Missing permission metadata on protected route: `403`.
- Missing permission: `403`.
- Cross-company hidden record: `404` when endpoint policy chooses to hide existence.
- Validation error: `422`.

Do not expose SQL errors, token validation internals, role grant internals, or cross-company ownership hints.

### 19.8 Audit Action Taxonomy

Use stable dot-separated audit action keys.

Minimum item 02 actions:

```text
auth.login.exchange
auth.login.denied
auth.session.refresh
auth.session.logout
auth.identity.link
auth.identity.unlink
auth.company.switch
admin.user.invite
admin.user.disable
admin.role.assign
admin.role.revoke
admin.permission.grant
admin.permission.revoke
audit.log.read
ai.tool.invoke
```

Audit metadata rules:

- Store ids, hashes, counts, state transitions, and short summaries.
- Do not store raw access tokens, refresh tokens, cookies, passwords, LINE raw payloads, full prompts, full tool outputs, full document payloads, or full exported files.
- For denied events, store denial category, not hidden policy details.
- For auth failures before user resolution, `actorUserId` may be null.
- For companyless failures, `companyId` may be null.

High-risk actions must fail closed if audit write fails:

- role or permission mutation
- export
- tax action
- period close/unclose
- voiding issued document
- identity link/unlink
- tax/report generation or export
- stock/accounting/payment mutation when those modules exist
- AI tool invocation touching finance, tax, customer, stock, permission, or export data

### 19.9 LINE Trust Contract

LINE Login and LINE Messaging are separate trust paths:

- LINE Login proves interactive user identity for login/linking.
- LINE Messaging webhook proves event came from LINE channel.
- Neither path grants company access by itself.
- Internal `User`, active `ExternalIdentity`, active `CompanyMembership`, role grants, permissions, and ABAC scope are required before business data is shown.
- MVP account linking starts from an admin-created internal user or invite link. Unknown LINE identities get link/invite-required response and no business data.
- Self-join without admin-created invite is deferred.
- Owner/admin offboarding or inactivation takes effect immediately: valid LINE identity, valid webhook signature, existing session, cached `LineCompanyContext`, or old deep link must not expose company data after membership becomes inactive.

Implementation must reject:

- invalid LINE signature
- expired LINE token
- wrong issuer
- wrong audience/channel id
- nonce/state mismatch where applicable
- unknown/unlinked LINE user for business data
- disabled external identity
- removed company membership
- inactive company membership

### 19.10 AI Gateway Boundary

AI Gateway must not use Prisma or direct ERP repositories for business data.

Required tool policy shape:

```ts
type ToolPolicy = {
  toolKey: string;
  requiredPermission: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  allowedActions: string[];
  requiresConfirmation: boolean;
  auditRequired: boolean;
  finalMutationAllowed: false;
};
```

Rules:

- Missing tool policy denies execution.
- Missing request context denies execution.
- Missing permission denies execution.
- `finalMutationAllowed` remains `false` for item 02.
- Sensitive tool invocation audits through ERP core.
- ERP core repeats permission and ABAC checks on every source-of-truth read/mutation.

### 19.11 Acceptance Criteria for Item 02

- [ ] Local dev can obtain a signed first-party token only in local/test.
- [ ] Production config rejects dev auth.
- [ ] First-party token verification checks issuer, audience, expiry, not-before, signature, and allowed algorithm.
- [ ] LINE Login verifier contract exists and is testable with mocked provider responses.
- [ ] LINE webhook signature verifier rejects invalid signatures before event processing.
- [ ] `GET /v1/auth/me` returns server-derived context for allowed user.
- [ ] Protected route without token returns `401`.
- [ ] Protected route without permission metadata returns `403`.
- [ ] Authenticated user without company membership returns `403`.
- [ ] Authenticated user without required permission returns `403`.
- [ ] Authenticated user with required permission succeeds.
- [ ] Cross-company access is denied or hidden.
- [ ] Role/permission seed matches the minimum registry in this spec.
- [ ] Sensitive auth/admin/audit actions write audit logs.
- [ ] Audit metadata redacts secrets and sensitive payloads.
- [ ] Audit log query enforces tenant and role/category ABAC filters.
- [ ] AI Gateway denies tool invocation without context, policy, permission, and audit readiness.

### 19.12 Sonnet 4.6 Implementation Notes

First implementation pass should implement Phase 1 from `docs/plans/auth-rbac-audit-plan.md` only.

Before coding, the implementation model must inspect current repo state and confirm whether Prisma already exists. If missing, add Prisma under `apps/api` as part of Phase 1. If item 01 later adds a conflicting database convention first, follow the newer repo convention and update this spec before coding.

Do not implement business modules, full UI, final AI tools, or production AWS deployment as part of item 02.

## 20. Resolved Owner Decisions

- Branch/location restrictions are prepared in item 02 and enforced first by Inventory MVP.
- External accountant access starts as normal `ACCOUNTANT` membership. Separate collaborator model is deferred.
- Immutable/tamper-evident audit is deferred, but audit rows for auth, role/permission, identity link, export, tax, period close, issued document void, stock, accounting, payment, and AI sensitive tool events must exist before related modules ship.
- First customer invite/linking flow is admin-created internal user or invite link, then LINE identity attach.

## 21. Owner Update 2026-07-06 — Web Login via LINE

- The web LoginPage must offer "เข้าสู่ระบบด้วย LINE" alongside password login.
- Flow reuses existing primitives: LINE Login obtains an ID token; the backend verifies it with the existing LINE Login verifier and issues a normal first-party session through the existing exchange path (`POST /v1/auth/line/exchange`) when the LINE identity maps to an active linked `User` via `ExternalIdentity`.
- Unlinked LINE identities never receive a session or business data; they get the link/invite-required flow consistent with §20 and the LINE AI Channel/Auth Spec.
- Sessions issued via LINE login are identical to password sessions for permissions, audit, revocation (item 02B), and `mustChangePassword` handling.
- Tracked as checklist item 02C.

## 22. Owner Update 2026-07-06 — External Accountant and Auditor Collaborators

- Supersedes the §20 decision "External accountant access starts as normal `ACCOUNTANT` membership. Separate collaborator model is deferred."
- Both accountants and auditors may be external people (accounting office / audit firm) through the guest/external-collaborator access feature (permission-scoped, no seat cost per the 10C+ owner decision).
- Every external collaborator membership must carry an explicit "external" flag/toggle, visible in team/employee UI, in approval records (e.g., item 10E close approvals), and in audit metadata.
- External collaborators receive only the permissions their collaborator role grants; nothing about the external flag widens or narrows permissions by itself.
