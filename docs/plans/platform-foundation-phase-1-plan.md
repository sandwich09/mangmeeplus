# Platform Foundation Phase 1 Implementation Plan

## Linked Spec

- Spec: `docs/specs/enterprise-architecture-spec.md`
- Spec: `docs/specs/sme-business-os-overview.md`
- Spec: `docs/specs/line-ai-channel-auth-spec.md`
- Spec: `docs/specs/permission-matrix.md`
- Related ADRs:
  - `docs/adr/0001-docs-as-source-of-truth.md`
  - `docs/adr/0005-aws-first-hosting-and-deployment-strategy.md`
  - `docs/adr/0006-phase-1-platform-stack-defaults.md`

## Purpose

Create the first runnable platform foundation for WatchDog-BMS.

This phase should establish service boundaries, local infrastructure, container packaging, health checks, and core identity/tenant/permission/audit models before business modules are implemented.

## Current Repository Context

The repository has documentation plus an initial monorepo and Docker skeleton.

The initial app shells are intentionally thin:

- `apps/web`: Next.js web admin shell.
- `apps/web/src/common`: shared frontend code home.
- `apps/web/src/features`: feature-based frontend folders.
- `packages/design-tokens`: shared theme token source for web and LIFF.
- `apps/api`: NestJS ERP core shell.
- `apps/api/src/common`: shared ERP core backend code home.
- `apps/ai-gateway`: NestJS AI Gateway shell.
- `apps/ai-gateway/src/common`: shared AI Gateway backend code home.
- `apps/workers`: Node.js worker shell.
- `packages/contracts`: shared API/event contract placeholder.
- `packages/config`: shared environment schema placeholder.
- `infra/docker`: local Docker Compose and deployment contract docs.

## Scope

### In Scope

- `pnpm` workspace setup.
- Docker Compose local infrastructure.
- Web frontend feature-folder structure and common-first guideline.
- Shared design token package for web/LIFF theme sync.
- Backend hexagonal module structure and common-first guideline.
- Container Dockerfiles for web, API, AI Gateway, and workers.
- Health endpoints.
- OpenAPI docs for API and AI Gateway.
- Prisma setup for PostgreSQL.
- Core schema for company/workspace, users, roles, permissions, memberships, and audit log.
- LINE Login validation, first-party session/JWT validation, and local dev auth boundary.
- Deny-by-default permission guard skeleton.
- Structured logging baseline.
- Basic tests for health, auth boundary, permissions, and tenant context.

### Out of Scope

- Inventory workflows.
- Accounting/tax workflows.
- CRM/sales workflows.
- Real AI provider integration.
- Native mobile business feature implementation.
- Full LINE mini-app business workspace.
- Production AWS provisioning.
- Payment, marketplace, or tax filing integrations.

## Phase 1: Runnable Shells and Docker Contract

### Goal

Make every deployable service start locally and inside a container.

### Tasks

- [x] Create `pnpm` workspace.
- [x] Create web, API, AI Gateway, and worker app shells.
- [x] Add Dockerfiles for deployable services.
- [x] Add local Docker Compose for PostgreSQL, Redis, MinIO, web, API, AI Gateway, and workers.
- [x] Add `.env.example`, `.dockerignore`, and `.gitignore`.
- [x] Add health endpoint for API.
- [x] Add health endpoint for AI Gateway.
- [x] Add web frontend code style guideline.
- [x] Refactor web shell into feature folder with separated component, CSS, model, constants, API, and logic files.
- [x] Add web common folders for reusable functions, shared components, and theme styles.
- [x] Add shared design token package for web/LIFF theme sync.
- [x] Add backend hexagonal code style guideline.
- [x] Refactor API health endpoint into presentation, application use case, domain model, and domain logic folders.
- [x] Refactor AI Gateway health endpoint into presentation, application use case, domain model, and domain logic folders.
- [x] Install dependencies and create lockfile.
- [x] Verify Docker Compose config.
- [ ] Verify local Docker Compose build. Blocked locally because Docker daemon was not running.
- [x] Verify web/API/AI Gateway health checks through local dev servers.

### Tests

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `docker compose -f infra/docker/compose.local.yml --env-file .env config`
- `docker compose -f infra/docker/compose.local.yml --env-file .env up --build`
- `curl http://localhost:3001/v1/health`
- `curl http://localhost:3002/v1/health`

### Exit Criteria

- All service shells build.
- All service containers start locally.
- API and AI Gateway health endpoints return `status: ok`.
- Web shell loads locally.
- Web shell follows feature-folder and common-first guideline.
- Shared web components and theme tokens live under `apps/web/src/common/`.
- API and AI Gateway shell follow backend hexagonal module guideline.

## Phase 2: Database and Prisma Foundation

### Goal

Create source-of-truth data foundation for tenant, identity, permissions, and audit.

### Tasks

- [x] Add Prisma to `apps/api`.
- [x] Define initial Prisma schema.
- [x] Add migration workflow.
- [x] Add seed workflow for local owner/admin user and default roles.
- [x] Add database health check.
- [x] Add repository/service layer conventions.

### Initial Models

- `Company`
- `User`
- `ExternalIdentity`
- `PlatformLineChannel`
- `LineCompanyContext`
- `LineChannelBinding` (legacy/company-specific only)
- `CompanyMembership`
- `Role`
- `Permission`
- `RolePermission`
- `AuditLog`
- `OutboxEvent`

### Tests

- Migration runs against local PostgreSQL.
- Seed creates default company, owner role, admin role, and permissions.
- Database health check fails clearly when database is unreachable.

### Exit Criteria

- Local database can be migrated and seeded.
- Core tenant and permission records exist.
- Audit log table exists for future modules.

## Phase 3: LINE Login and Session Auth Boundary

### Goal

Add authentication boundary that validates LINE Login, issues/verifies WatchDog-BMS first-party sessions/JWTs, and supports local development.

### Tasks

- [x] Add auth module to API.
- [x] Add JWT verification interface.
- [x] Add local development auth strategy.
- [x] Add LINE Login validation adapter.
- [x] Add WatchDog-BMS first-party session/JWT issuer and verifier.
- [x] Add LINE account-linking use case.
- [x] Add LINE Messaging API webhook signature verifier.
- [x] Map verified identity to internal `User` and `CompanyMembership`.
- [x] Add request context with `userId`, `companyId`, `roles`, and `permissions`.

### Tests

- Request without identity is rejected for protected routes.
- Local dev identity maps to internal user.
- Invalid LINE Login token is rejected.
- Invalid LINE webhook signature is rejected.
- Unlinked LINE identity cannot access business data.
- Unknown user is rejected.
- Missing company context is rejected.

### Exit Criteria

- API has clear auth boundary.
- No protected route can proceed without user and company context.

## Phase 4: Permission and Audit Skeleton

### Goal

Enforce deny-by-default authorization and log sensitive activity.

### Tasks

- [x] Add permission guard.
- [x] Add permission decorator or route metadata.
- [x] Add ABAC policy hook for owner/assignee/location restrictions.
- [x] Add audit logging service.
- [x] Add sample protected route for permission tests.

### Tests

- Deny by default when permission metadata is missing or user lacks permission.
- Allowed request succeeds with required permission.
- Sensitive mutation writes audit log.
- AI Gateway cannot bypass ERP core permission checks.

### Exit Criteria

- Future modules can attach permission checks consistently.
- Audit logging path exists before stock/accounting/tax records are implemented.

## Phase 5: Worker and Outbox Baseline

### Goal

Prepare background processing without committing to business jobs yet.

### Tasks

- [x] Add `OutboxEvent` model.
- [ ] Add BullMQ connection.
- [ ] Add worker process lifecycle logging.
- [ ] Add sample no-op job.
- [ ] Add retry and idempotency guidance.

### Tests

- Worker connects to Redis.
- Sample job runs once.
- Failed job is retried according to configured policy.

### Exit Criteria

- Notifications, imports, reports, and AI background jobs have a safe foundation.

## Risks

- Dependency install requires network access and lockfile creation.
- Local auth and mock LINE login must not become security bypasses in production.
- Prisma schema choices affect every later module.
- Redis/BullMQ job semantics require idempotency for money, stock, tax, and notification workflows.
- Docker images may need optimization after real app code grows.

## First Implementation Decisions

- Phase 1 stops at local Docker plus app contracts and CI gates. Real AWS CDK stacks start when cloud provisioning begins.
- Local auth uses signed dev JWTs first. Fixed test headers are local test fixtures only.

## Later Questions

- Should API and AI Gateway share NestJS libraries or remain fully independent until duplication hurts?
