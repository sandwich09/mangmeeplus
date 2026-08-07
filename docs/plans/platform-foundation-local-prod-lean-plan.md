# Platform Foundation Local/Prod Lean Implementation Plan

## Linked Spec

- Spec: `docs/specs/platform-foundation-local-prod-lean-spec.md`
- Related specs:
  - `docs/specs/line-ai-channel-auth-spec.md`
  - `docs/specs/platform-environment-config-spec.md`
  - `docs/specs/auth-authorization-rbac-spec.md`
  - `docs/specs/permission-matrix.md`
  - `docs/specs/ai-gateway-agents-spec.md`
- Related guideline:
  - `docs/guidelines/security-implementation-guideline.md`
- Related ADRs:
  - `docs/adr/0005-aws-first-hosting-and-deployment-strategy.md`
  - `docs/adr/0006-phase-1-platform-stack-defaults.md`

## Purpose

Implement the platform foundation for a one-developer flow where local is the only development/integration environment and production is the only deploy target in the first promote path.

This plan replaces broad staging-first sequencing with a lean local-to-production path while keeping hard gates for config, auth, RBAC, audit, AI safety, and CI.

## Current Repository Context

Already present:

- `pnpm` workspace.
- Web, API, AI Gateway, worker, and LINE AI/account-linking shell direction.
- Dockerfiles for deployable services.
- Local Docker Compose with PostgreSQL, Redis, MinIO, API, AI Gateway, workers, and web.
- API and AI Gateway health endpoints.
- `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule` skeletons.
- Thin `packages/config` schema.
- `.env.example` with local defaults.

Missing:

- Local/prod config validation.
- Prisma schema and migration workflow.
- Identity, membership, RBAC, audit, and outbox persistence.
- LINE Login validation, first-party session/JWT verifier, and local dev auth boundary.
- LINE webhook signature validation.
- Request context resolver.
- Permission resolution from database.
- Audit service and repository.
- Structured redacted logging baseline.
- AI tool policy/audit enforcement.
- CI workflow and security gates.

## Execution Rules

- Do not add business modules until Phase 4 exit criteria pass.
- Do not introduce staging work in this plan.
- Keep local defaults convenient, but production fail-fast.
- Any local-only bypass must be impossible when `APP_ENV=production`.
- AI can start disabled; safety gates still need tests.
- Each phase must leave the repo in a buildable state.

## Role Gates

BA gate: Business goal is solo-dev local/prod runtime readiness; users are owner/developer/admin; journey is configure, run, validate, seed, and promote; rules defer staging/business workflows and require fail-fast security; acceptance is build/run, config validation, health, seed, logs, and CI gates.

SA gate: Architecture fit is pnpm monorepo with web/API/AI Gateway/workers, Docker local infra, Prisma/PostgreSQL, Redis, MinIO/S3, first-party JWT/LINE auth boundary, deny-by-default permissions, ABAC hook, audit, and AI policy envelope. Contracts are shared env schemas, RequestContext, Prisma models, and tool policy metadata. Data model impact is tenant/user/identity/membership/role/permission/audit/outbox only. Permissions/ABAC deny by default and ERP core repeats checks for AI tool-backed access. Scope excludes business workflows and production AWS provisioning.

DEV gate: Ponytail rule applies: smallest correct diff, existing Nest/Prisma/config patterns first, no new dependencies for foundation checks. Touched areas are config schemas, API/AI/workers bootstrap, Prisma seed/migration review, Docker local env, CI, and focused tests.

Integration gate: Backend-to-frontend contract is web root status plus API/AI health endpoints under `/v1/health`; local Docker passes required service env; loading/error/permission states are limited to foundation status and protected-route test fixtures; E2E/browser path is local health/browser verification when Docker/dev servers are available.

## Integration Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm config:validate`
- `pnpm security:audit`
- `pnpm --filter @watchdog-bms/api prisma:validate`
- `pnpm --filter @watchdog-bms/api migration:review`
- `docker compose -f infra/docker/compose.local.yml --env-file .env.example config`
- Local stack/browser health path: `pnpm docker:local`, then `curl http://localhost:3001/v1/health`, `curl http://localhost:3002/v1/health`, and open `http://localhost:3000`.

## Migration Run Order

Local:

1. Copy `.env.example` to `.env`.
2. Start infrastructure: `pnpm docker:local:infra`.
3. Review schema: `pnpm --filter @watchdog-bms/api prisma:validate`.
4. Review generated SQL: `pnpm --filter @watchdog-bms/api migration:review`.
5. Apply migrations: `pnpm --filter @watchdog-bms/api exec prisma migrate deploy`.
6. Seed local owner/company/roles/permissions: `pnpm --filter @watchdog-bms/api exec prisma db seed`.

Production:

1. Confirm production secrets/config/backups exist.
2. Run migration review in CI before image promotion.
3. Run `prisma migrate deploy` as a one-off deploy job before app rollout.
4. Run seed only as an explicit deploy job for system roles/permissions; never seed blindly from app startup.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/platform-foundation-local-prod-lean-spec.md`.
3. Read `docs/specs/platform-environment-config-spec.md`.
4. Inspect the current codebase before editing.
5. Start at Phase 1: Shared Config and Secret Hygiene.

Scope priority:

1. This lean local/prod plan is the active execution path.
2. `docs/plans/platform-foundation-phase-1-plan.md` is historical/broader phase context.
3. `docs/plans/platform-environment-setup-plan.md` is staging-capable reference context.
4. If docs disagree, prefer this lean plan for implementation order.

Do not mark Master Implementation Checklist item 01 complete until Phase 1 through Phase 7 exit criteria pass, fast promote checks are documented or automated, and local verification succeeds.

## First Implementation Defaults

Use these defaults unless the owner explicitly changes them:

- Local dev auth starts with signed dev JWTs; any fixed test identity is test-only and guarded by `APP_ENV=local`.
- Production infrastructure code is out of scope for this pass; implement app config, Docker, CI, and deploy contract first.
- First production runtime target is ECS Fargate for web, API, AI Gateway, and workers.
- Workers use BullMQ/Redis for first launch; SQS decision moves to pre-beta review.
- OWNER MFA starts as config/policy placeholder; full MFA flow can wait until auth foundation is stable.
- Production secrets use AWS Secrets Manager or SSM references; non-secret runtime values can stay plain env vars.
- Default production AWS region is Asia Pacific Singapore (`ap-southeast-1`) unless the required runtime, data, and AI services are confirmed in a Thailand region for the account.
- API contract starts with shared TypeScript contract package; OpenAPI documentation remains required and generated clients can come later.
- App Runner is not a default target for new deployments because it is no longer open to new AWS customers as of the 2026-06-23 docs review.

## Scope

### In Scope

- Local/prod environment contract.
- Shared config schema.
- Secret redaction.
- Prisma identity/RBAC/audit/outbox schema.
- Local seed for owner/admin roles and permissions.
- Auth module with local dev strategy, LINE Login validation, and first-party session/JWT verifier.
- LINE account linking and webhook signature validation.
- Server-derived request context.
- Deny-by-default permission guard backed by resolved permissions.
- ABAC policy hook skeleton.
- Audit logging service.
- Structured request logs with request id.
- AI Gateway safety config and tool policy gate.
- CI/security gate for promote.

### Out of Scope

- Staging environment.
- Business workflows for inventory, accounting, tax, CRM, or sales.
- Real AI provider integration.
- AI memory.
- Final AI mutation.
- Full AWS CDK production stack beyond required config/deploy contract.
- Native mobile production release automation.

## Phase 0: Freeze Lean Contract

### Goal

Make local/prod lean path explicit in docs.

### Tasks

- [x] Add local/prod lean spec.
- [x] Add local/prod lean implementation plan.
- [x] Link spec and plan from docs home/index.

### Tests

- Docs links resolve inside Obsidian vault.

### Exit Criteria

- Developers can find the lean source of truth from `docs/Home.md` and `docs/README.md`.

## Phase 1: Shared Config and Secret Hygiene

### Goal

Every service loads typed config through `packages/config` and fails fast on unsafe production values.

### Tasks

- [x] Add `APP_ENV` with lean values: `local`, `production`.
- [x] Expand `packages/config` into service-specific schemas for API, AI Gateway, web, and workers.
- [x] Add production fail-fast rules from the spec.
- [x] Add redaction helper for sensitive keys and values.
- [x] Update `.env.example` with safe local placeholders for required variables.
- [x] Wire API, AI Gateway, web, and workers to shared config helpers.
- [x] Add tests for missing production LINE/session config, unsafe CORS, dev auth in production, disabled audit, and disabled log redaction.

### Tests

- `pnpm --filter @watchdog-bms/config test`
- `pnpm typecheck`
- Production config fixture rejects unsafe values.
- Local config fixture accepts `.env.example` values.

### Exit Criteria

- No service reads raw environment variables directly except through config bootstrap.
- Production cannot start with local-only auth, wildcard CORS, missing LINE/session config, disabled audit, or disabled redaction.

## Phase 2: Database, RBAC, Audit, and Outbox Schema

### Goal

Create source-of-truth persistence for tenant, identity, permissions, audit, and future background jobs.

### Tasks

- [x] Add Prisma to `apps/api`.
- [x] Add schema models: `Company`, `User`, `ExternalIdentity`, `LineChannelBinding` (legacy/company-specific), `CompanyMembership`, `Role`, `Permission`, `RolePermission`, `MembershipRole`, `AuditLog`, `OutboxEvent`.
- [ ] Shared LINE OA follow-up: add/refactor `PlatformLineChannel` and `LineCompanyContext`; keep `LineChannelBinding` only as legacy/company-specific binding.
- [x] Add migration scripts.
- [x] Add local seed script for default company, owner user, roles, and permissions.
- [x] Add database health check.
- [x] Add repository conventions under API hexagonal module structure.
- [x] Document migration run order for local and production deploy.

### Tests

- Migration runs against local PostgreSQL.
- Seed creates owner/admin roles and default permission keys.
- Database health check fails clearly when PostgreSQL is unreachable.
- Prisma generated client typecheck passes.

### Exit Criteria

- Local database can migrate and seed from empty state.
- Minimum identity/RBAC/audit/outbox records exist.
- Production migration path is documented and not tied to app container startup.

## Phase 3: Auth Boundary and Request Context

### Goal

Authenticate requests and derive trusted user/company context before protected routes.

### Tasks

- [x] Add API auth module.
- [x] Add JWT verifier interface.
- [x] Add local dev auth adapter allowed only when `APP_ENV=local`.
- [x] Add LINE Login validation adapter.
- [x] Add WatchDog-BMS first-party session/JWT issuer and verifier.
- [x] Add LINE account-linking use case.
- [x] Add LINE Messaging API webhook signature verifier.
- [x] Map verified subject to internal `User`.
- [x] Resolve `CompanyMembership` from `X-Company-Id` or default membership.
- [x] Attach `RequestContext` with user, company, membership, roles, permissions, and request id.
- [x] Add tests for missing token, invalid token, expired token, unknown user, missing company, inactive membership, and valid context.

### Tests

- Public health route succeeds without auth.
- Protected route without auth returns `401`.
- Unknown internal user returns `401` or `403` according to auth mapping policy.
- Missing or invalid company membership returns `403`.
- Invalid LINE Login token returns `401`.
- Invalid LINE webhook signature returns `401` or `403`.
- Unlinked LINE identity cannot access business data.
- Dev auth fails when `APP_ENV=production`.

### Exit Criteria

- Protected routes cannot execute without verified identity and company context.
- Local dev remains convenient without creating production bypass.

## Phase 4: Permission, ABAC Hook, and Audit Enforcement

### Goal

Make authorization deny by default and record sensitive actions from the beginning.

### Tasks

- [x] Resolve permissions from membership roles.
- [x] Wire resolved permissions into `DenyByDefaultGuard`.
- [x] Keep missing route metadata as `403`.
- [x] Add policy interface for ABAC decisions.
- [x] Add placeholder policies for own/team/location/amount/status checks.
- [x] Add audit service and repository.
- [x] Add sample protected mutation route or test fixture for permission and audit tests.
- [x] Add AI Gateway rule that ERP core repeats permission checks for tool-backed reads/mutations.

### Tests

- Protected route without permission metadata returns `403`.
- Authenticated user without required permission returns `403`.
- Authenticated user with required permission succeeds.
- Fake ABAC denial returns `403`.
- Sensitive mutation writes audit log.
- Cross-company access is denied or hidden.
- AI Gateway cannot bypass ERP core permission checks.

### Exit Criteria

- Future business modules can attach route permission checks, ABAC policy checks, and audit events without redesign.
- Business feature implementation may start after this phase if Phase 1-4 tests pass.

## Phase 5: Logging, HTTP Security, and Runtime Safety

### Goal

Make services safe enough for first production exposure.

### Tasks

- [x] Add structured JSON logger.
- [x] Add request id middleware and propagation.
- [x] Add request logs with method, path, status, duration, and request id.
- [x] Redact auth headers, cookies, passwords, tokens, prompts, and document payloads.
- [x] Add CORS allowlist enforcement.
- [x] Add body size limit config.
- [x] Add production Swagger guard.
- [x] Add rate limit config and storage adapter.
- [x] Disable SQL logs outside local debugging.

### Tests

- Request receives or preserves request id.
- Logs redact known sensitive fields.
- Production config rejects empty or wildcard CORS.
- Production config rejects public Swagger unless explicit protected decision exists.
- Oversized payload is rejected.

### Exit Criteria

- Logs are useful for debugging but do not leak secrets.
- Public production endpoints have bounded CORS, body size, and rate limit behavior.

## Phase 6: AI Gateway Safety Envelope

### Goal

Allow AI Gateway to run safely with agents disabled, and prevent tool execution unless policy and audit are enabled.

### Tasks

- [x] Add AI Gateway config schema.
- [x] Default `MODEL_PROVIDER=disabled`.
- [x] Add agent registry config and per-agent enable flags.
- [x] Add tool policy interface with required permission, risk level, confirmation, and audit fields.
- [x] Enforce `AI_TOOL_POLICY_ENFORCED=true` before tool execution.
- [x] Enforce `AI_TOOL_AUDIT_ENABLED=true` before tool execution.
- [x] Keep `AI_FINAL_MUTATION_ENABLED=false`.
- [x] Keep `AI_PROMPT_LOGGING_ENABLED=false`.
- [x] Add max token, max tool call, timeout, and AI rate limit config.
- [x] Add tests proving tools cannot run when policy or audit is disabled.

### Tests

- AI Gateway health works while AI is disabled.
- Tool execution fails when policy enforcement is disabled.
- Tool execution fails when audit is disabled.
- Final mutation fails by config.
- Prompt logging cannot be enabled in production.

### Exit Criteria

- AI Gateway can be deployed without enabling AI behavior.
- Future agents inherit permission, audit, and no-final-mutation rules.

## Phase 7: CI and Production Promote Gate

### Goal

Block unsafe production deploys with a small automated gate.

### Tasks

- [x] Add GitHub Actions workflow or equivalent CI.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm security:audit`.
- [x] Add secret scan.
- [x] Build Docker images for web, API, AI Gateway, and workers.
- [x] Add production config validation check with sample required variables.
- [x] Add migration dry-run or review step.
- [x] Document manual production promote checklist for one developer.

### Tests

- CI fails on typecheck error.
- CI fails on test error.
- CI fails on known secret pattern.
- CI fails on unsafe production config fixture.
- Docker build succeeds for deployable services.

### Exit Criteria

- Production promote is a repeatable command/checklist, not tribal memory.
- No production deploy can proceed when core safety gates fail.

## Fast Promote Checklist

Before first production deploy:

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm security:audit`
- [ ] secret scan passes
- [ ] Docker images build
- [ ] local infra starts
- [ ] migrations run locally
- [ ] seed works locally
- [ ] production config validates
- [ ] production secrets exist in AWS Secrets Manager or SSM
- [ ] LINE Login and Messaging API config exists
- [ ] WatchDog-BMS session/JWT secret exists
- [ ] backups enabled
- [ ] AI remains disabled or AI safety tests pass

## Risks

- Removing staging speeds promotion but increases production blast radius if CI gates are weak.
- Local dev auth can become a production bypass if fail-fast rules are incomplete.
- Prisma schema choices affect all later modules.
- Audit table design affects accounting, tax, stock, and permission history.
- Redis/BullMQ needs idempotency discipline for future money, stock, tax, and notification jobs.
- AI tool policies must be enforced in both AI Gateway and ERP core.

## First Implementation Decisions

- Local dev auth: signed dev JWTs first; fixed dev headers are test-only fixtures and mock LINE Login can come later.
- Runtime: ECS Fargate first for web, API, AI Gateway, and workers.
- Queue: BullMQ/Redis first; review SQS before beta or before high-value durable background jobs.
- MFA: add owner/high-risk policy config and hooks first; full MFA flow later.
- Secrets: use AWS Secrets Manager or SSM references for secrets; use plain environment variables only for non-secret runtime values.
- Region: default to Asia Pacific Singapore (`ap-southeast-1`) until Thailand region availability, cost, and model/service support are confirmed.
- API contract: shared TypeScript contract package first; OpenAPI docs required; generated clients later.

## Later Questions

- Should CloudFront sit in front of the web app for the first public production release?
- Should staging be added before the first paying customer or only before multi-user production risk grows?
- Which owner actions require full MFA enforcement before beta instead of config-only policy hooks?
