# Data Model Core Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 04.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/data-model-core-spec|Data Model Core Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 04. Data Model Core
- Related specs:
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/enterprise-architecture-spec|Enterprise Architecture Spec]]
  - [[specs/platform-environment-config-spec|Platform Environment Config Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the shared data primitives that later business modules need:

- Company profile and branch records.
- Membership branch scope.
- Attachment object metadata and attachment links.
- Document sequence config and idempotent number reservation.
- Audit action extensions.
- Transactional outbox repository and worker claim path.
- Shared contracts for web, API, workers, and AI tools.

This plan should give Sonnet 4.6 enough detail to implement without reopening architecture or product decisions.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/workers`: TypeScript worker shell only.
- `packages/contracts`: shared package exists but currently thin.
- `packages/config`: shared config schema exists but currently thin.
- No Prisma schema exists in this snapshot.
- Local Docker Compose already includes PostgreSQL, Redis, and MinIO-compatible object storage.
- Auth/RBAC item 02 may add Prisma/auth/audit schema before item 04 starts.

Before implementation, inspect latest code again because item 01, item 02, and item 03 may add config, Prisma, auth, request-context, audit, web shell, or contract helpers.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/data-model-core-spec.md`.
3. Read `docs/specs/auth-authorization-rbac-spec.md`.
4. Read `docs/specs/permission-matrix.md`.
5. Read `docs/guidelines/backend-hexagonal-code-style.md`.
6. Inspect `apps/api`, `apps/workers`, `packages/contracts`, `packages/config`, and current Prisma state.
7. Start at Phase 0: Baseline and Schema Reconciliation.

Do not mark Master Implementation Checklist item 04 complete until Phase 0 through Phase 7 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Create shared tenant, sequence, attachment, audit, and outbox primitives before module-specific tables depend on them.
- Reuse Prisma/schema/auth/audit code from item 01 or item 02 if already present. Do not duplicate models or modules.
- If no Prisma setup exists, add it under `apps/api` following ADR 0006 and current package conventions.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, db mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Write business mutations with tenant, permission, validation, audit, and outbox boundaries in the use case layer.
- Do not expose raw object storage keys, signed-url internals, secrets, raw uploaded files, or full outbox payloads to web clients.
- AI Gateway must not import API Prisma client or direct ERP repositories.
- Each phase must leave `@watchdog-bms/api` typecheckable.

## Scope

### In Scope

- Prisma schema and migration for item 04 models.
- Seed data for head office branch, item 04 permission keys, role grants, and default document sequences.
- Shared TypeScript contracts in `packages/contracts`.
- Branch domain, use cases, repository, query, and HTTP endpoints.
- Membership branch scope resolver and request-context integration.
- Attachment storage port, local/MinIO/S3-compatible adapter boundary, repository, use cases, and HTTP endpoints.
- Document sequence config and transactional number reservation service.
- Audit action taxonomy and audit integration for branch, attachment, sequence, and document-number actions.
- Outbox repository, claim/update behavior, and worker smoke path.
- Unit, use case, controller, and database integration tests where project test setup supports them.

### Out of Scope

- Inventory, accounting, expense, tax, CRM, workflow, reports, marketplace, payroll, fixed assets, manufacturing, or AI business records.
- Full file preview UI.
- OCR, document extraction, or AI document parsing.
- PDF generation.
- Final notification delivery.
- Production infrastructure provisioning.
- Immutable/tamper-evident audit hashing.
- External accountant collaborator model.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- Prisma IDs: `String @id @default(cuid())`.
- Default branch: code `HO`, name `Head Office`, type `HEAD_OFFICE`, tax branch code `00000`.
- Branch code remains editable only until business records reference the branch; after that, lock code and allow profile/status edits only.
- Default locale/timezone/currency: `th-TH`, `Asia/Bangkok`, `THB`.
- Document sequence padding: `5`.
- Document reset policy: monthly for accounting, tax, inventory movement, and expense claim defaults.
- Attachment max size: default 25 MB per file in local and production until beta changes it.
- Attachment storage: use existing storage config if present; otherwise define storage port and local adapter contract, with MinIO/S3 adapter follow-up in same phase if config is ready.
- Document sequence config changes: MVP requires `document.sequence.manage` and high-risk audit only; add OWNER/MFA policy gate before beta.
- Outbox worker: implement claim/update/no-op smoke path first. Real delivery belongs to later modules.
- API routes: `/v1/companies/:companyId/...`; route `companyId` is verified against server request context.

## Phase 0: Baseline and Schema Reconciliation

### Goal

Confirm current implementation state and prevent duplicate schema/module work.

### Tasks

- [ ] Inspect `apps/api/package.json`, `apps/api/prisma`, `apps/api/src/common`, `apps/api/src/modules`, `apps/workers`, `packages/contracts`, and `packages/config`.
- [ ] Confirm whether Prisma already exists.
- [ ] Confirm whether auth/request-context/audit modules from item 02 already exist.
- [ ] Confirm current permission key registry and seed location.
- [ ] Confirm current test command behavior for API, workers, contracts, and root workspace.
- [ ] Decide exact extension path:
  - extend existing Prisma/auth/audit modules, or
  - create missing Prisma setup and item 04 modules.
- [ ] Record any schema conflicts in implementation notes before coding.

### Tests

- No code tests required in this phase unless existing setup changed.

### Exit Criteria

- Implementer knows whether to add or extend Prisma.
- Implementer knows exact files to touch.
- No duplicate `Company`, `User`, `CompanyMembership`, `AuditLog`, or `OutboxEvent` plan remains unresolved.

## Phase 1: Prisma Schema, Migrations, and Seed

### Goal

Create database source-of-truth primitives for branch, branch scope, attachment, document sequencing, audit extensions, and outbox.

### Tasks

- [ ] Add Prisma to `apps/api` if still missing.
- [ ] Add or extend `apps/api/prisma/schema.prisma`.
- [ ] Verify or add existing auth-owned models from item 02: `User`, `Company`, `CompanyMembership`, `AuditLog`, role/permission tables.
- [ ] Add item 04 models:
  - `Branch`
  - `MembershipBranchScope`
  - `AttachmentObject`
  - `AttachmentLink`
  - `DocumentSequence`
  - `DocumentNumber`
  - `OutboxEvent`
- [ ] Add enums from the spec if missing.
- [ ] Add indexes and uniqueness constraints from the spec.
- [ ] Add migration scripts to `apps/api/package.json` if missing.
- [ ] Add seed script updates:
  - demo head office branch
  - item 04 permission keys
  - role grants
  - default document sequences
- [ ] Keep secrets and raw object storage values out of seed data.
- [ ] Add migration/seed README note if no existing Prisma docs exist.

### Tests

- `pnpm --filter @watchdog-bms/api typecheck`
- Prisma validate/generate command added by implementation.
- Migration applies against local PostgreSQL when local infra is available.
- Seed creates one active company, active owner membership, one active head office branch, item 04 permissions, grants, and default sequences.

### Exit Criteria

- Empty local database can migrate and seed.
- Prisma generated client typecheck passes.
- Unique constraints block duplicate branch code and duplicate document number.
- Item 04 schema extends item 02 models without duplication.

## Phase 2: Shared Contracts, Domain Models, and Ports

### Goal

Expose stable TypeScript contracts and hexagonal backend interfaces before HTTP endpoints.

### Tasks

- [ ] Add or extend `packages/contracts/src/core-data.ts`.
- [ ] Add or extend:
  - `packages/contracts/src/company.ts`
  - `packages/contracts/src/attachments.ts`
  - `packages/contracts/src/document-sequences.ts`
  - `packages/contracts/src/outbox.ts`
- [ ] Export new contracts from `packages/contracts/src/index.ts`.
- [ ] Add `apps/api/src/modules/data-model-core` if no better existing module exists.
- [ ] Add domain models for branch, branch scope, attachment, document sequence, document number, and outbox event.
- [ ] Add domain ports:
  - `BranchRepositoryPort`
  - `AttachmentRepositoryPort`
  - `AttachmentStoragePort`
  - `DocumentSequenceRepositoryPort`
  - `OutboxRepositoryPort`
  - audit integration port if existing audit service is not directly injectable.
- [ ] Add pure domain logic for branch validation, branch scope resolution, attachment metadata validation, document sequence formatting, and outbox payload redaction.
- [ ] Keep visible API DTOs separate from persistence rows.

### Tests

- `pnpm --filter @watchdog-bms/contracts typecheck`
- `pnpm --filter @watchdog-bms/api typecheck`
- Unit tests for:
  - branch validation
  - branch scope resolver
  - document sequence formatter
  - attachment metadata validator
  - outbox payload redaction

### Exit Criteria

- Later phases can implement use cases without inventing contract/model shapes.
- Domain logic has no NestJS, Prisma, storage SDK, HTTP, or queue imports.

## Phase 3: Branch and Membership Scope API

### Goal

Let company admins manage branches and let request context expose branch scope safely.

### Tasks

- [ ] Implement Prisma branch mapper/repository/query.
- [ ] Implement use cases:
  - `list-branches`
  - `create-branch`
  - `update-branch`
  - `resolve-membership-branch-scope`
  - `update-membership-branch-scope` if item 02 user/admin APIs need it now.
- [ ] Add HTTP controller routes:
  - `GET /v1/companies/:companyId/branches`
  - `POST /v1/companies/:companyId/branches`
  - `PATCH /v1/companies/:companyId/branches/:branchId`
- [ ] Enforce `company.branch.read` and `company.branch.manage`.
- [ ] Verify route company id against request context.
- [ ] Block archiving the only active head office branch.
- [ ] Audit branch create/update/archive and branch scope update.
- [ ] Integrate branch scope into request context if item 02 context resolver exists; otherwise add resolver port and document integration point.

### Tests

- `pnpm --filter @watchdog-bms/api test`
- Branch list requires auth and `company.branch.read`.
- Branch create/update require `company.branch.manage`.
- Duplicate branch code returns `409`.
- Archiving only active head office returns `422`.
- Cross-company branch access returns `403` or `404` according to existing policy.
- Branch create/update writes audit log.
- Branch scope resolver returns expected branch ids.

### Exit Criteria

- Branch records are tenant-scoped, permission-protected, audited, and available to later modules.
- Request context can provide branch scope or has a clear tested integration point.

## Phase 4: Attachment Storage and Attachment API

### Goal

Provide one shared attachment upload/link/download pattern for later modules.

Implementation hardening update 2026-07-18 (H-11): shared upload now uses short exact-size/create-only intents, transactional tenant pending-byte quota, quarantined mismatch handling, server-derived byte checksum, immutable final evidence keys, provider checksum/version pinning, and version-pinned download/OCR/signature reads. Production deploy enables bucket versioning and pending-key lifecycle; historical active objects require release inventory before H-11 production acceptance.

### Tasks

- [ ] Add storage config keys if missing, using `packages/config`.
- [ ] Add `AttachmentStoragePort`.
- [ ] Implement local/MinIO/S3-compatible adapter according to existing config readiness.
- [ ] Implement Prisma attachment mapper/repository.
- [ ] Implement use cases:
  - `create-upload-intent`
  - `complete-attachment-upload`
  - `create-download-url`
  - `link-attachment-to-target`
  - `delete-attachment`
- [ ] Add HTTP controller routes from the spec.
- [ ] Enforce `attachment.create`, `attachment.read`, and `attachment.delete`.
- [ ] Validate tenant, content type, size limit, storage metadata, status, and link target shape.
- [ ] Redact signed URLs and raw object keys from logs and audit metadata.
- [ ] Audit upload intent, upload complete, download URL creation, link, and delete.

### Tests

- `pnpm --filter @watchdog-bms/api test`
- Upload intent creates `PENDING_UPLOAD`.
- Completion validates metadata and marks `ACTIVE`.
- Reuse/overwrite, oversize, provider-checksum mismatch, and client-checksum substitution are rejected; reviewed downloads remain pinned to the recorded object version.
- Oversize or disallowed MIME type rejects.
- Download URL does not expose raw object key.
- Deleted/quarantined attachment cannot get download URL.
- Attachment link unique constraint prevents duplicate target/purpose link.
- Attachment audit metadata excludes signed URL and object credentials.

### Exit Criteria

- Later modules can attach files without writing their own storage metadata tables.
- Storage behavior is testable behind a port.

## Phase 5: Document Sequence Service

### Goal

Provide transactional, idempotent document number allocation for later business modules.

### Tasks

- [ ] Implement Prisma document sequence mapper/repository.
- [ ] Implement pure formatter for prefix templates and period keys.
- [ ] Implement use cases:
  - `list-document-sequences`
  - `upsert-document-sequence`
  - `reserve-document-number`
  - `commit-document-number`
  - `cancel-document-number`
  - `void-document-number`
- [ ] Add HTTP routes for sequence config:
  - `GET /v1/companies/:companyId/document-sequences`
  - `PUT /v1/companies/:companyId/document-sequences/:documentType`
- [ ] Keep number allocation as application service for modules, not a normal public endpoint.
- [ ] Enforce `document.sequence.read` and `document.sequence.manage` for config routes.
- [ ] Allocate numbers inside a database transaction.
- [ ] Lazily upsert catalog-backed system sequences on first reservation.
- [ ] Carry the latest active prefix, padding, and reset policy into a missing
  period while treating `DISABLED` as an explicit stop.
- [ ] Keep concurrent first-use creation idempotent through the existing unique
  key and database upsert.
- [ ] Use `idempotencyKey` for reservation retries.
- [ ] Audit config changes and number lifecycle changes.
- [ ] Append outbox events for sequence update and number commit where useful.

### Tests

- `pnpm --filter @watchdog-bms/api test`
- Formatter renders `{YYYY}`, `{YY}`, `{MM}`, `{BRANCH}`, `{DOC}`, and `{SEQ}`.
- Invalid template rejects.
- Disabled sequence rejects allocation.
- Repeated idempotency key returns same reservation.
- Same idempotency key with different parameters returns `409`.
- Concurrent reservations do not duplicate numbers.
- Committed and voided numbers are not reused.
- Sequence config changes write audit log.

### Exit Criteria

- Later modules can request document numbers without implementing their own sequence logic.
- Allocation is safe under retry and concurrency.

## Phase 6: Outbox and Worker Smoke Path

### Goal

Make transactional events available to workers without building module-specific delivery.

### Tasks

- [ ] Implement Prisma outbox mapper/repository.
- [ ] Add outbox append helper for API use cases.
- [ ] Add claim batch, mark published, mark failed, and dead-letter behavior.
- [ ] Add retry/backoff calculation.
- [ ] Add payload redaction/validation.
- [ ] Add worker module under `apps/workers/src/modules/outbox` or existing worker convention.
- [ ] Add no-op/smoke publisher that can claim and mark a safe test event.
- [ ] Add guardrail test that AI Gateway does not import/use API Prisma client or direct ERP repositories.

### Tests

- `pnpm --filter @watchdog-bms/workers typecheck`
- `pnpm --filter @watchdog-bms/workers test` if worker tests exist.
- Outbox append stores event with stable event key.
- Duplicate event key does not create duplicate event.
- Claim batch respects status, availableAt, and lock.
- Failed event increments attempts and schedules retry.
- Dead event is not claimed by default.
- Payload sanitizer rejects or redacts secret-like fields.

### Exit Criteria

- API can append outbox events transactionally.
- Worker can claim and update events safely.
- Real delivery can be added by later modules without changing table shape.

## Phase 7: Integration Verification and Handoff

### Goal

Prove item 04 primitives are ready for business modules.

### Tasks

- [ ] Run required typecheck/test commands.
- [ ] Verify local migrate/seed from empty DB where local infra is available.
- [ ] Verify OpenAPI metadata for new endpoints if API docs are wired.
- [ ] Confirm audit records for branch, attachment, sequence, and outbox actions.
- [ ] Confirm seed role grants match spec.
- [ ] Confirm no raw object keys, signed URLs, secrets, full files, or full outbox payloads appear in audit/log snapshots.
- [ ] Update implementation notes in this plan if decisions changed during coding.
- [ ] Update Master Implementation Checklist item 04 only after implementation and verification are done.

### Tests

- `pnpm --filter @watchdog-bms/api typecheck`
- `pnpm --filter @watchdog-bms/api test`
- `pnpm --filter @watchdog-bms/contracts typecheck`
- `pnpm --filter @watchdog-bms/workers typecheck`
- `pnpm --filter @watchdog-bms/workers test` if present.
- `pnpm typecheck`
- `pnpm test`

### Exit Criteria

- Shared data primitives are migrated, seeded, tested, permission-protected, and audited.
- Inventory MVP can start without redefining tenant, branch, attachment, sequence, audit, or outbox primitives.

## Required Commands

Run after each phase when relevant:

```sh
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/workers typecheck
pnpm --filter @watchdog-bms/workers test
pnpm typecheck
pnpm test
pnpm security:audit
```

Database phases also run migration, generate, and seed commands added by implementation.

If local PostgreSQL/MinIO is not running, document the exact skipped integration command and blocker.

## Review Checklist

- [ ] No duplicate auth-owned models were created.
- [ ] Prisma generated types do not leak into domain models.
- [ ] Controllers call use cases only.
- [ ] All new protected routes have `@RequirePermissions(...)`.
- [ ] Company id is verified as a selection hint, not trusted as authority.
- [ ] Branch scope is server-derived.
- [ ] Attachment APIs never expose raw object keys.
- [ ] Signed URLs are short-lived and redacted from logs/audit.
- [ ] Document number allocation is transactional and idempotent.
- [ ] Committed/voided document numbers are never reused.
- [ ] Outbox events are bounded, redacted, and idempotent.
- [ ] Audit metadata redacts secrets, raw files, signed URLs, tokens, and full outbox payloads.
- [ ] AI Gateway has no direct ERP database access.

## First Sonnet 4.6 Handoff

Use this exact scope for the first implementation turn:

```text
Read:
- docs/plans/master-implementation-checklist.md
- docs/specs/data-model-core-spec.md
- docs/plans/data-model-core-plan.md
- docs/specs/auth-authorization-rbac-spec.md
- docs/specs/permission-matrix.md
- docs/guidelines/backend-hexagonal-code-style.md
- docs/guidelines/security-implementation-guideline.md
- docs/adr/0006-phase-1-platform-stack-defaults.md

Inspect:
- apps/api/package.json
- apps/api/src/common
- apps/api/src/modules
- apps/api/prisma if it exists
- apps/workers
- packages/contracts
- packages/config

Implement:
- Phase 0: Baseline and Schema Reconciliation
- Phase 1: Prisma Schema, Migrations, and Seed

Do not implement inventory, accounting, expense, tax, CRM, workflow, reports, marketplace, OCR, AI business tools, or final notification delivery in this first pass.
If Prisma/auth/audit/outbox already exists, extend it. If schema conflicts appear, stop and report the conflict before coding further.
```

## Risks

- Item 01 or item 02 may create overlapping Prisma models. Mitigation: Phase 0 reconciliation before edits.
- Document sequence concurrency bugs can corrupt finance/tax records. Mitigation: transaction tests and idempotency key.
- Attachment storage can leak private object paths or signed URLs. Mitigation: storage port, redaction tests, DTO review.
- Outbox payloads can accidentally store secrets or large raw payloads. Mitigation: payload sanitizer and bounded contract tests.
- Branch scope may be confused with inventory location scope. Mitigation: keep Branch and future Inventory Location separate.

## Resolved Owner Decisions

- Branch codes lock after any business record references the branch.
- Attachment max size default is 25 MB per file for both local and production until beta.
- Document sequence config changes use `document.sequence.manage` plus high-risk audit during MVP; add OWNER/MFA policy gate before beta.

## Open Questions

- None for item 04 docs handoff.
