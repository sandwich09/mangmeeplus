# ADR 0006: Phase 1 Platform Stack Defaults

## Status

Accepted, amended by [[adr/0008-line-ai-access-and-auth|ADR 0008]]

## Context

Phase 1 needs a platform foundation before domain modules such as inventory, accounting, CRM, tax, approvals, and AI agents can be implemented.

The architecture chooses web as the full Business OS workspace, LINE OA/LIFF as the AI assistant/account-linking channel, Next.js web admin, NestJS ERP core, separate AI Gateway, workers, PostgreSQL, Redis-compatible queue/cache, object storage, and AWS-first hosting.

The project needs concrete implementation defaults so work can start without reopening broad technology decisions.

## Decision

Use these defaults for Phase 1:

- Monorepo: `pnpm` workspaces.
- Build orchestration: Turborepo-compatible task layout.
- Web admin: Next.js.
- Web frontend code organization: feature folders with separated components, CSS modules, models, constants, API files, and logic files.
- Shared theme source: `packages/design-tokens/tokens.json` with generated web CSS outputs.
- ERP core API: NestJS.
- Backend code organization: hexagonal modules with separated presentation, application/use cases, domain models/logic/ports, and infrastructure repositories/queries/db mapping.
- AI Gateway: NestJS service boundary for MVP consistency.
- Workers: Node.js TypeScript process.
- API style: REST first with shared TypeScript contracts for MVP implementation and OpenAPI documentation for inspection/integration.
- Database access and migrations: Prisma.
- Identity provider: LINE Login for MVP user login, with WatchDog-BMS first-party session/JWT issuance after backend validation.
- Optional identity broker: Cognito or another provider can be added later if operational needs justify it.
- Authorization source of truth: application database roles, permissions, company/workspace membership, and ABAC policies.
- Queue/cache/idempotency: Redis-compatible service with BullMQ in Phase 1.
- Local infrastructure: Docker Compose with PostgreSQL, Redis, and S3-compatible object storage.
- Deployment package: Docker containers for web, API, AI Gateway, and workers.
- Production runtime: ECS Fargate first for web, API, AI Gateway, and workers.
- Local dev auth: signed dev JWTs first; fixed dev identity headers only as local test fixtures.
- Infrastructure as code: AWS CDK when cloud provisioning starts.

## Consequences

### Positive

- Phase 1 can start with concrete conventions.
- REST and OpenAPI keep web, LINE webhook, LIFF account-linking, and AI integration simple.
- LINE Login reduces custom password security work and matches Thai SME adoption behavior.
- Application-owned permissions keep business authorization portable and auditable.
- Prisma gives typed database access and clear migrations for MVP speed.
- BullMQ maps naturally to Redis and can be replaced later if queue durability needs change.
- Containers keep deploy targets portable across local Docker, ECS Fargate, and other container hosts.
- CDK matches the AWS-first TypeScript stack.

### Trade-offs

- LINE adds platform dependency, LIFF constraints, and message-plan considerations.
- Prisma can be less flexible for some advanced SQL/reporting cases, so raw SQL or views may be needed later.
- Redis/BullMQ is not the same durability model as SQS. High-value background jobs need idempotency and retry design.
- Turborepo adds task orchestration config, even while the repo is still small.
- Local MinIO is only an S3-compatible emulator and must not hide AWS IAM/S3 policy testing before production.

## Alternatives Considered

### Custom username/password authentication

Rejected for Phase 1 because password storage, token rotation, MFA, and account recovery would add security risk and slow foundation work.

### Cognito hosted UI first

Deferred by ADR 0008. Cognito remains viable as a later identity broker, but MVP end-user login starts with LINE Login.

### GraphQL first

Rejected for Phase 1 because REST plus OpenAPI is simpler for service boundaries, web, LINE webhook, AI, and permission-focused endpoints.

### TypeORM or Drizzle instead of Prisma

Rejected for Phase 1 because Prisma provides a fast, typed MVP path with clear migration workflow.

### SQS first

Deferred. Redis/BullMQ is enough for local and first production, while SQS can be introduced later if managed queue durability becomes more important.

### Terraform instead of CDK

Deferred. CDK fits TypeScript and AWS-first development, but Terraform remains viable if multi-cloud provisioning becomes a priority.

## Implementation Notes

- Keep LINE authentication separate from application authorization.
- Validate LINE Login tokens and Messaging API webhook signatures server-side.
- Issue WatchDog-BMS first-party session/JWT after LINE identity validation.
- Store users, company/workspace membership, roles, permissions, and audit records in PostgreSQL.
- Every mutating API must validate company context and permission before writing data.
- API and AI Gateway must expose health endpoints for container orchestration.
- Workers must run without public inbound HTTP.
- Dockerfiles must build from repository root.
- `.env.example` must document local environment variables, but real secrets must stay out of git.
- Web feature code must follow `docs/guidelines/web-frontend-code-style.md`.
- Shared web behavior must be checked in `apps/web/src/common/` before creating new feature-local helpers.
- Web common code must include shared components, reusable functions, and theme styles under `apps/web/src/common/`.
- Backend feature code must follow `docs/guidelines/backend-hexagonal-code-style.md`.
- Shared backend behavior must be checked in service-local `src/common/` before creating module-local helpers.
- Controllers must call use cases and must not call repositories, queries, Prisma, queues, or external SDKs directly.

## Test Requirements

- Web, API, AI Gateway, and workers can be built from workspace scripts.
- Web route files stay thin and import feature components.
- Backend controllers stay thin and call application use cases.
- Domain logic is testable without NestJS, Prisma, HTTP, queues, or external SDKs.
- API and AI Gateway expose health endpoints.
- OpenAPI documentation is served for API and AI Gateway.
- Local Docker Compose can start PostgreSQL, Redis, MinIO, API, AI Gateway, workers, and web.
- Future auth tests must verify LINE Login validation, WatchDog-BMS session/JWT validation, company membership, permission checks, and deny-by-default behavior.

## Decisions Closed for First Implementation

- Identity: LINE Login plus backend-issued WatchDog-BMS session/JWT is enough for alpha. Cognito or another broker remains optional later.
- Queue: Redis/BullMQ stays for first production; review SQS before beta or before high-value durable background jobs.
- Runtime: ECS Fargate first. App Runner is not a default target for new deployments.
- API contract: shared TypeScript contracts first; OpenAPI docs required; generated clients later.

## Later Questions

- Should CloudFront/S3 be used for static assets later, or should web remain fully containerized for longer?
- Which OWNER actions need full MFA enforcement before beta instead of config/policy hooks only?
