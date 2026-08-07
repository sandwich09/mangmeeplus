# ADR 0005: AWS-First Hosting and Deployment Strategy

## Status

Accepted

## Context

WatchDog-BMS will handle SME business data such as stock, accounting documents, tax records, approvals, attachments, audit logs, and AI tool access.

The product architecture already separates:

- LINE AI daily assistant and alert channel
- Next.js web admin
- NestJS ERP core
- AI Gateway
- Workers
- PostgreSQL
- Redis
- Object storage

The project needs a hosting decision that can start lean but still support security, backups, observability, private networking, queue workers, file storage, and future compliance needs.

## Decision

Use AWS as the default hosting target. Solo-dev MVP uses local and production first; staging is deferred until release risk, team size, or customer count justifies it.

The architecture should stay portable through Docker containers and standard managed services, but new deployment design should assume AWS first.

Default AWS mapping:

- Next.js web admin: containerized service on ECS Fargate for first production.
- NestJS ERP core: containerized service on ECS Fargate for first production.
- AI Gateway: separate containerized service on ECS Fargate for first production.
- Workers: ECS Fargate tasks or services. Workers should not depend on a public HTTP lifecycle.
- PostgreSQL: Amazon RDS for PostgreSQL.
- Redis-compatible queue/cache: Amazon ElastiCache for Redis or Valkey.
- Object storage: Amazon S3.
- Secrets: AWS Secrets Manager or SSM Parameter Store.
- Logs and metrics: Amazon CloudWatch.
- Container registry: Amazon ECR.
- DNS and certificates: Route 53 and AWS Certificate Manager.

Region policy:

- Default first production region: Asia Pacific Singapore (`ap-southeast-1`).
- Move to a Thailand region only after required runtime, data, storage, queue/cache, secret, log, and AI/model services are confirmed for the account and budget.
- Re-check service availability before production launch and before enabling AI providers.

App Runner note:

- App Runner is not a default target for new deployments because it is no longer open to new AWS customers as of the 2026-06-23 docs review.
- Existing App Runner usage is legacy rollback/migration source only. Because no real users are live yet, new production deploy work should move to ECS Express Mode/Fargate now instead of extending App Runner.

## Consequences

### Positive

- Production architecture aligns with financial, tax, stock, and audit-sensitive data.
- Managed PostgreSQL, Redis, object storage, secrets, logs, backups, and IAM are available in one cloud.
- Containers keep services portable and avoid early lock-in to a single framework-specific host.
- ECS Fargate gives a clean path for web, API, AI Gateway, and background workers.
- S3 signed URL flow fits receipts, PDFs, exports, and attachments.

### Trade-offs

- AWS setup is more complex than Render, Railway, or a single VPS.
- Cost modeling requires more discipline because compute, storage, logs, NAT, data transfer, and backups are billed separately.
- IAM, VPC, security groups, and deployment automation must be designed carefully.
- ECS Fargate has more setup work than simpler app platforms, so the platform foundation must keep deploy contracts small and repeatable.
- Production readiness requires backup/restore drills, monitoring, and migration gates earlier than a hobby deployment would.

## Alternatives Considered

### Render or Railway first

Rejected as the default because they are faster for prototypes but less aligned with long-term accounting, tax, audit, and controlled infrastructure needs.

They may still be used for disposable experiments, but not as the canonical staging or production target.

### Single VPS or AWS Lightsail instance

Rejected for production because patching, backups, restore testing, log retention, secret handling, and scaling would become manual operational risk.

Lightsail may be acceptable only for throwaway demos or a temporary preview environment with non-production data.

### Full Kubernetes from day one

Rejected for MVP because it adds operational complexity before the product needs it.

ECS Fargate is enough for container orchestration in the first production path.

## Implementation Notes

- Keep services containerized from the start.
- Define local and production first. Keep staging as a later environment when release risk justifies it.
- Local development should use Docker Compose for PostgreSQL, Redis, and object storage emulator.
- Production must use managed PostgreSQL, managed Redis-compatible cache/queue, S3, separate workers, secrets management, and structured logs.
- Infrastructure should be captured as code before production launch.
- DB migrations must be reviewed and run through deployment gates.
- Object uploads must use signed URLs and validate content type and file size.
- AI Gateway must call ERP core through permission-checked APIs or tools, not direct database access.

## Test Requirements

- Deployment pipeline can build and deploy web, API, AI Gateway, and workers independently.
- Migration workflow can run locally and has a reviewed production promote path against RDS PostgreSQL.
- Worker can process queued jobs without public inbound HTTP access.
- Object upload and download paths use signed URLs.
- Secrets are loaded from AWS-managed secret storage, not committed files.
- Restore test proves database backup can be restored before production launch.
- Health checks exist for web, API, AI Gateway, worker queue lag, database, and Redis-compatible service.

## Decisions Closed for First Implementation

- Infrastructure as code default: AWS CDK when cloud provisioning starts.
- Runtime default: ECS Fargate first.
- Region default: Asia Pacific Singapore (`ap-southeast-1`) first.
- Queue default: Redis/BullMQ first; review SQS before beta or before high-value durable background jobs.

## Later Questions

- Should CloudFront sit in front of the web app for the first public production release?
- Staging/UAT was approved on 2026-07-20 after the security-remediation release pipeline made pre-production acceptance necessary. It uses isolated data/services and promotes accepted commits from `develop` to `main`; see `docs/specs/uat-environment-spec.md`.
