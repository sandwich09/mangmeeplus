# Data Model Core Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 04.

Active implementer target: Sonnet 4.6 or later.

## 2. Goal

Create the shared data foundation that every business module can depend on without redefining tenant, branch, actor, attachment, document numbering, audit, and event-outbox behavior.

The result should let Inventory, Accounting Documents, Expenses, Tax, CRM, Workflow, Reports, AI tools, and Workers share the same source-of-truth primitives.

## 3. Non-goals

- Implementing inventory, accounting, expense, tax, CRM, workflow, report, or marketplace business records.
- Building full file preview, OCR, document extraction, or PDF generation.
- Building final notification delivery.
- Building production object storage infrastructure beyond the application adapter contract.
- Replacing Auth/RBAC/Audit item 02. This item extends and verifies those primitives instead of duplicating them.
- Creating external accountant/collaborator model.
- Implementing immutable/tamper-evident audit hashing. Keep append-only audit now; hashing can follow later.

## 4. User Roles

- Owner: manages company setup, branches, numbering defaults, attachments, and audit visibility.
- Admin: manages company/branch setup, numbering, and attachment policy.
- Manager: reads company/branch context and uploads/links operational attachments where module permission allows.
- Finance/accountant: uses document sequence, attachment, audit, and company tax/branch data for finance/tax records.
- Staff: uploads attachments and reads allowed records through later modules.
- Auditor readonly: reads audit and attachment metadata where allowed.
- AI assistant user: can receive answers only through permission-checked API/tool access to these primitives.

## 5. Boundary and Ownership

Data Model Core owns:

- Company profile shape needed by later modules.
- Branch records and branch-scoped membership grants.
- Shared actor fields and tenant conventions.
- Attachment object metadata and attachment-to-record links.
- Document sequence configuration and number reservation/commit rules.
- Outbox event table and claim/update behavior.
- Shared audit event shape extensions required by business modules.
- Shared TypeScript contracts for these primitives.

Auth/RBAC/Audit owns or may already own:

- User authentication and sessions.
- External identity and LINE bindings.
- Company membership base record.
- Role, permission, role grants, and request context resolution.
- Audit guard/service boundary.

Business modules own:

- Module records and validations.
- Module-specific status workflows.
- Module-specific attachment purposes.
- Module-specific event payload schemas.
- Module-specific audit actions.

Workers own:

- Event dispatch implementation.
- Retry/backoff scheduling.
- Notification/import/report execution.

## 6. Current Repository Baseline

As of 2026-06-23:

- `apps/api` is NestJS with health module and security skeleton.
- `apps/api/src/common/security` has `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- No Prisma schema exists in the current snapshot.
- `.env.example` and local Docker Compose already define PostgreSQL, Redis, and MinIO-compatible local storage values.
- ADR 0006 chooses Prisma, PostgreSQL, Redis/BullMQ, S3-compatible object storage, NestJS hexagonal modules, and shared TypeScript contracts.
- Auth/RBAC item 02 may create `Company`, `User`, `CompanyMembership`, `Role`, `Permission`, `AuditLog`, and related schema before item 04 starts.

Implementation must inspect the repo before editing. If item 01 or item 02 already added Prisma/schema/models, extend the existing implementation with additive migrations and do not create duplicate tables/modules.

## 7. Linked Plan and References

- Plan: [[plans/data-model-core-plan|Data Model Core Plan]]
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 04.
- Architecture: [[specs/enterprise-architecture-spec|Enterprise Architecture Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Platform env: [[specs/platform-environment-config-spec|Platform Environment Config Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 8. Core Rules

- Tenant boundary is `companyId`.
- Every tenant-owned table has `companyId`, except global configuration and auth/session tables where item 02 already defines scope.
- Route `companyId`, `X-Company-Id`, or stored company preference is only a selection hint. Backend must verify active membership and permissions.
- Business records include `createdByUserId`, `updatedByUserId`, `createdAt`, and `updatedAt` unless the record is append-only.
- Soft delete uses explicit status/deleted fields only where business evidence must remain. Do not physically delete audit, document number, or outbox history through user flows.
- Prisma generated types must not be used as domain models.
- Controllers must call use cases, not repositories, queries, Prisma, storage SDKs, or queues directly.
- Attachments store object metadata and signed-url references, not public URLs.
- Document numbers are allocated inside a database transaction and never reused after commit.
- Outbox events are written in the same database transaction as the source business mutation whenever a mutation creates a business event.
- AI Gateway must access these records through permission-checked ERP APIs/tools, not direct database connections.

## 9. Shared Contracts

Add or extend shared contracts under `packages/contracts/src`.

Recommended files:

```text
packages/contracts/src/core-data.ts
packages/contracts/src/company.ts
packages/contracts/src/attachments.ts
packages/contracts/src/document-sequences.ts
packages/contracts/src/outbox.ts
packages/contracts/src/audit.ts
packages/contracts/src/index.ts
```

Minimum exported types:

```ts
export type CoreRecordStatus = 'active' | 'inactive' | 'archived';

export type AddressSnapshot = {
  line1: string;
  line2?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  countryCode: 'TH' | string;
};

export type BranchSummary = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: 'head_office' | 'branch' | 'online' | 'warehouse';
  taxBranchCode?: string;
  status: CoreRecordStatus;
};

export type AttachmentObjectSummary = {
  id: string;
  companyId: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string;
  status: 'pending_upload' | 'active' | 'quarantined' | 'deleted';
};

export type DocumentSequenceKey = {
  companyId: string;
  branchId?: string;
  documentType: string;
  periodKey: string;
};

export type ReservedDocumentNumber = {
  id: string;
  documentType: string;
  documentNumber: string;
  status: 'reserved' | 'committed' | 'cancelled' | 'voided';
};

export type OutboxEventContract<TPayload = unknown> = {
  id: string;
  companyId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  occurredAt: string;
};
```

Keep API DTOs explicit. Do not expose raw storage object keys, raw signed-url signing inputs, Prisma row names, or internal retry lock fields to web clients.

## 10. Prisma Model Contract

Use Prisma/PostgreSQL. Prefer `String @id @default(cuid())` unless the repo has already standardized on UUIDs before item 04 starts.

If item 01 or item 02 already created a model, do not recreate it. Add missing fields through additive migrations or create companion tables.

### 10.1 Required Enums

```text
CompanyStatus: ACTIVE, SUSPENDED, DISABLED
BranchStatus: ACTIVE, DISABLED, ARCHIVED
BranchType: HEAD_OFFICE, BRANCH, ONLINE, WAREHOUSE
MembershipBranchScopeMode: ALL_BRANCHES, SELECTED_BRANCHES, DEFAULT_BRANCH_ONLY
AttachmentStatus: PENDING_UPLOAD, ACTIVE, QUARANTINED, DELETED
AttachmentVisibility: INTERNAL, ACCOUNTING, AUDIT, CUSTOMER_VISIBLE
DocumentSequenceStatus: ACTIVE, DISABLED
DocumentResetPolicy: NONE, MONTHLY, YEARLY
DocumentNumberStatus: RESERVED, COMMITTED, CANCELLED, VOIDED
OutboxEventStatus: PENDING, PROCESSING, PUBLISHED, FAILED, DEAD
OutboxEventPriority: LOW, NORMAL, HIGH
```

Reuse item 02 auth/audit enums when present.

### 10.2 Existing Auth-Owned Models to Verify

These models may already exist from item 02. Item 04 must verify they support later modules:

```text
User
- id
- email nullable unique
- displayName
- status
- createdAt
- updatedAt

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
- indexes from item 02
```

Add these only if missing:

```text
Company
- registeredName nullable
- brandName nullable
- vatRegistered boolean default false
- phone nullable
- email nullable
- addressJson nullable
- timezone default "Asia/Bangkok"
- locale default "th-TH"
- baseCurrency default "THB"

CompanyMembership
- branchScopeMode default ALL_BRANCHES
```

Do not rename `Company.name` in the first item 04 migration. Later UI can decide whether to show `name`, `registeredName`, or `brandName`.

### 10.3 Branch

```text
Branch
- id
- companyId
- code
- name
- type
- taxBranchCode nullable
- addressJson nullable
- phone nullable
- email nullable
- status
- createdByUserId nullable
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,code
- index companyId,status
- index companyId,taxBranchCode
```

Rules:

- Every active company must have one default head office branch.
- Default local seed uses branch code `HO` and tax branch code `00000`.
- `taxBranchCode` is optional until tax/accounting setup is complete, but when set it must be unique per company among active branches.
- Branch code is editable only before business records reference the branch. After first business record reference, lock `Branch.code`; users can still update branch name, address, phone, email, and status according to policy.
- Branch is not the same as inventory location. Inventory locations are added by Inventory MVP and may link to branch later.

### 10.4 Membership Branch Scope

```text
MembershipBranchScope
- id
- membershipId
- branchId
- createdAt
- unique membershipId,branchId
- index branchId
```

Rules:

- `ALL_BRANCHES` means no per-branch rows are required.
- `SELECTED_BRANCHES` requires at least one active `MembershipBranchScope`.
- `DEFAULT_BRANCH_ONLY` uses `CompanyMembership.defaultBranchId`.
- Request context `scopes.branchIds` comes from this model and membership mode.

### 10.5 Attachment Object and Link

```text
AttachmentObject
- id
- companyId
- branchId nullable
- storageProvider
- bucket
- objectKey
- objectVersionId nullable for legacy/non-versioned providers
- originalFileName
- mimeType
- byteSize
- checksumSha256 nullable
- visibility
- status
- uploadedByUserId
- uploadedAt nullable
- deletedAt nullable
- metadataJson nullable
- createdAt
- updatedAt
- index companyId,status,createdAt
- index companyId,checksumSha256
- index uploadedByUserId,createdAt

AttachmentLink
- id
- companyId
- attachmentId
- targetType
- targetId
- purpose
- linkedByUserId
- createdAt
- unique attachmentId,targetType,targetId,purpose
- index companyId,targetType,targetId
```

Rules:

- `objectKey` is internal and never returned directly to web clients.
- Default attachment max size is 25 MB per file for local and production until beta changes it.
- Download/view uses short-lived signed URLs from the storage port.
- User uploads land under a `pending/` key using a configurable TTL capped at five minutes. The signed request binds exact content length, MIME type, and create-only semantics; pending bytes are tenant-quota bounded and expire through provider lifecycle policy.
- Upload completion must HEAD and read the exact provider version, derive SHA-256 from server-read bytes, and ignore client-supplied size/checksum as authority. A mismatch quarantines the attachment.
- Verified bytes are written to a new create-only `evidence/<company>/<sha256>/<uuid>` key with provider checksum validation. `ACTIVE` records persist the final key, SHA-256, and provider version id; every later download/server read pins that version.
- Production S3-compatible storage must have versioning enabled. Missing final provider version is a fail-closed completion error.
- Deleting an attachment through product UI sets status to `DELETED`; object hard-delete is a separate retention/ops concern.
- Attachment links are generic, but target record access still comes from the owning module permission and ABAC policy.
- OCR/extraction uses `AttachmentObject` later, but item 04 does not implement OCR.

### 10.6 Document Sequence and Number

```text
DocumentSequence
- id
- companyId
- branchId nullable
- branchScopeKey
- documentType
- periodKey
- prefixTemplate
- nextNumber
- padding
- resetPolicy
- status
- createdByUserId nullable
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,branchScopeKey,documentType,periodKey
- index companyId,documentType,status

DocumentNumber
- id
- companyId
- branchId nullable
- sequenceId
- documentType
- documentNumber
- status
- ownerType nullable
- ownerId nullable
- idempotencyKey
- reservedByUserId
- reservedAt
- committedAt nullable
- cancelledAt nullable
- voidedAt nullable
- createdAt
- updatedAt
- unique companyId,documentType,documentNumber
- unique companyId,documentType,idempotencyKey
- index companyId,ownerType,ownerId
- index sequenceId,status
```

Rules:

- `branchScopeKey` is non-null because PostgreSQL unique constraints do not treat multiple `NULL` values as duplicates. Use `GLOBAL` when `branchId` is null; otherwise use the branch id.
- `documentType` uses stable lowercase dot keys, such as `accounting.invoice`, `accounting.receipt`, `tax.invoice`, `inventory.movement`, and `expense.claim`.
- `periodKey` format:
  - `ALL` for no reset.
  - `YYYY` for yearly reset.
  - `YYYY-MM` for monthly reset.
- Number allocation must run inside one database transaction.
- For catalog-backed system document types, the first reservation lazily upserts
  the missing sequence. A later period inherits the latest active configuration;
  a company with no prior configuration uses the system default.
- An explicit `DISABLED` sequence is never bypassed by lazy provisioning. A
  disabled latest period keeps later periods blocked until an administrator
  activates or updates the configuration.
- Concurrent first reservations use the sequence unique key/upsert so only one
  period row is created.
- Allocation increments `DocumentSequence.nextNumber` and creates `DocumentNumber` with status `RESERVED`.
- Commit changes a reserved number to `COMMITTED` and sets owner fields.
- Cancel before commit changes status to `CANCELLED`.
- Void after commit changes status to `VOIDED`; the visible document number is never reused.
- `idempotencyKey` is required for allocation so duplicate client retries return the same reservation.
- Prefix templates may use `{YYYY}`, `{YY}`, `{MM}`, `{BRANCH}`, `{DOC}`, and `{SEQ}` placeholders.

Default seed sequence examples:

```text
accounting.invoice: INV-{YYYY}{MM}-{SEQ}
accounting.receipt: REC-{YYYY}{MM}-{SEQ}
tax.invoice: TAX-{YYYY}{MM}-{SEQ}
inventory.movement: MOV-{YYYY}{MM}-{SEQ}
expense.claim: EXP-{YYYY}{MM}-{SEQ}
```

Use padding `5` unless the owner changes it.

### 10.7 Outbox Event

```text
OutboxEvent
- id
- companyId nullable
- eventType
- aggregateType
- aggregateId
- eventKey
- payloadJson
- headersJson nullable
- status
- priority
- attempts
- availableAt
- lockedAt nullable
- lockedBy nullable
- publishedAt nullable
- lastError nullable
- createdAt
- updatedAt
- unique eventKey
- index status,availableAt,priority
- index companyId,createdAt
- index aggregateType,aggregateId
```

Rules:

- `eventKey` is a stable idempotency key for duplicate prevention.
- Source mutation and outbox insert happen in the same database transaction when possible.
- Worker claims events with a short lock, increments attempts, and marks `PUBLISHED`, `FAILED`, or `DEAD`.
- Payloads store ids, hashes, counts, and small event details. Do not store raw files, full exports, raw prompts, access tokens, or secrets.
- Item 04 may implement only a repository/claimer and no-op worker smoke path. Real notification/report/import delivery belongs to later modules.

## 11. Permission Keys

Add these permission keys if missing:

```text
company.branch.read
company.branch.manage
attachment.read
attachment.create
attachment.delete
document.sequence.read
document.sequence.manage
outbox.event.read
```

Default grants:

```text
OWNER: all item 04 permissions
ADMIN: company.branch.*, attachment.*, document.sequence.*, outbox.event.read
MANAGER: company.branch.read, attachment.read, attachment.create
SALES: company.branch.read, attachment.read, attachment.create
INVENTORY: company.branch.read, attachment.read, attachment.create
FINANCE: company.branch.read, attachment.read, attachment.create, document.sequence.read
ACCOUNTANT: company.branch.read, attachment.read, attachment.create, document.sequence.read, outbox.event.read
MARKETING: company.branch.read, attachment.read, attachment.create
STAFF: company.branch.read, attachment.read, attachment.create
AUDITOR_READONLY: company.branch.read, attachment.read, document.sequence.read, outbox.event.read
```

Routes still need module-specific permissions later. `attachment.create` only allows upload metadata; linking or reading an attached object for a target record must also pass target record permission when the target module exists.

## 12. API Behavior

All routes are under `/v1`. Route `companyId` is a tenant selection hint and must be verified against request context.

### Branches

```text
GET /companies/:companyId/branches
- Permission: company.branch.read
- Returns active/archived branches with filters for status and type.

POST /companies/:companyId/branches
- Permission: company.branch.manage
- Creates branch.
- Validates unique branch code and active tax branch code.
- Audits create success/denial/failure.

PATCH /companies/:companyId/branches/:branchId
- Permission: company.branch.manage
- Updates branch profile/status.
- Blocks archiving the only active head office branch.
- Audits update/status change.
```

### Document Sequences

```text
GET /companies/:companyId/document-sequences
- Permission: document.sequence.read
- Lists sequence config by document type, branch, period, and status.

PUT /companies/:companyId/document-sequences/:documentType
- Permission: document.sequence.manage
- Upserts sequence config for document type/branch/reset policy.
- Audits config changes as high-risk events. MVP does not require extra OWNER approval beyond `document.sequence.manage`; before beta, add OWNER/MFA policy gate for sequence changes.
```

Number allocation should be an application service used by business modules, not a public user-facing endpoint by default. Tests may call the use case directly.

### Attachments

```text
POST /companies/:companyId/attachments/upload-intent
- Permission: attachment.create
- Creates AttachmentObject in PENDING_UPLOAD and returns a short-lived signed upload URL plus required exact-size/create-only headers.

POST /companies/:companyId/attachments/:attachmentId/complete
- Permission: attachment.create
- Verifies provider metadata and bytes, copies verified bytes to an immutable versioned final key, and only then moves status to ACTIVE.

GET /companies/:companyId/attachments/:attachmentId/download-url
- Permission: attachment.read
- Returns short-lived signed download URL after tenant and attachment policy checks.

POST /companies/:companyId/attachments/:attachmentId/links
- Permission: attachment.create plus target module permission when target module exists.
- Creates AttachmentLink.

DELETE /companies/:companyId/attachments/:attachmentId
- Permission: attachment.delete
- Marks attachment DELETED after policy check; does not hard-delete object in user flow.
```

### Audit and Outbox

Audit routes from item 02 remain canonical. Item 04 may add filters for branch, target type, and attachment/document-sequence actions if the audit module already exists.

Outbox routes are not required for normal users. If an ops endpoint is added, it must be protected by `outbox.event.read`, return metadata only, and never expose full sensitive payloads.

## 13. Domain Ports

Required ports:

```ts
export interface BranchRepositoryPort {
  create(input: CreateBranchRecord): Promise<BranchRecord>;
  update(input: UpdateBranchRecord): Promise<BranchRecord>;
  findById(input: FindBranchByIdInput): Promise<BranchRecord | null>;
  list(input: ListBranchesInput): Promise<PaginatedBranches>;
}

export interface AttachmentStoragePort {
  createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownloadUrl>;
  getObjectMetadata(input: GetObjectMetadataInput): Promise<StoredObjectMetadata>;
}

export interface AttachmentRepositoryPort {
  createPending(input: CreatePendingAttachmentInput): Promise<AttachmentRecord>;
  markActive(input: MarkAttachmentActiveInput): Promise<AttachmentRecord>;
  markDeleted(input: MarkAttachmentDeletedInput): Promise<AttachmentRecord>;
  linkToTarget(input: LinkAttachmentInput): Promise<AttachmentLinkRecord>;
  findById(input: FindAttachmentInput): Promise<AttachmentRecord | null>;
}

export interface DocumentSequenceRepositoryPort {
  upsertConfig(input: UpsertDocumentSequenceInput): Promise<DocumentSequenceRecord>;
  reserveNumber(input: ReserveDocumentNumberInput): Promise<ReservedDocumentNumberRecord>;
  commitNumber(input: CommitDocumentNumberInput): Promise<ReservedDocumentNumberRecord>;
  cancelReservation(input: CancelDocumentNumberInput): Promise<ReservedDocumentNumberRecord>;
}

export interface OutboxRepositoryPort {
  append(input: AppendOutboxEventInput): Promise<OutboxEventRecord>;
  claimBatch(input: ClaimOutboxBatchInput): Promise<OutboxEventRecord[]>;
  markPublished(input: MarkOutboxPublishedInput): Promise<void>;
  markFailed(input: MarkOutboxFailedInput): Promise<void>;
}
```

Concrete Prisma/storage implementations live in `infrastructure/`. Domain/application code depends only on ports.

## 14. Audit Actions

Add stable audit action keys:

```text
company.branch.create
company.branch.update
company.branch.archive
company.branch.scope.update
attachment.upload.intent
attachment.upload.complete
attachment.download_url.create
attachment.link.create
attachment.delete
document.sequence.create
document.sequence.update
document.number.reserve
document.number.commit
document.number.cancel
document.number.void
outbox.event.append
outbox.event.publish
outbox.event.fail
```

Audit metadata rules:

- Include companyId, branchId, target type/id, document type, document number, attachment id, size, checksum hash, and status transition where useful.
- Do not include raw signed URLs, storage credentials, object contents, raw uploaded files, full outbox payloads, tokens, cookies, or secret headers.
- High-risk config changes such as sequence format changes and branch archiving must fail closed if audit write fails.

## 15. Outbox Event Naming

Use dot-separated event types:

```text
company.branch.created
company.branch.updated
attachment.uploaded
attachment.linked
document.number.reserved
document.number.committed
document.sequence.updated
```

Later modules add their own event types, such as:

```text
inventory.movement.created
accounting.invoice.issued
expense.receipt.uploaded
tax.period.due_soon
crm.follow_up.due
```

Payload shape:

```ts
type CoreOutboxPayload = {
  companyId?: string;
  actorUserId?: string;
  requestId?: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  data: Record<string, unknown>;
};
```

Payload must stay bounded and JSON-serializable.

## 16. Edge Cases

- Company has no branch: seed or repair creates head office branch before business modules run.
- Attempt to archive only active head office branch: reject with `422`.
- Duplicate branch code: `409`.
- User selects branch outside scope: `403`.
- Attachment upload intent created but never completed: status remains `PENDING_UPLOAD`; cleanup can be later worker job.
- Attachment object exists but metadata does not match expected content type/size: quarantine or reject completion.
- Upload URL is reused or the pending key already exists: provider/local adapter rejects without overwriting bytes.
- Provider versioning is disabled or final checksum/version cannot be verified: fail closed and do not activate the attachment.
- Signed URL requested for deleted/quarantined attachment: `403` or `404` according to policy.
- Document number allocation retry with same idempotency key: return existing reservation.
- Document number allocation retry with same idempotency key but different sequence parameters: `409`.
- Sequence disabled: allocation rejects with `422`.
- Prefix template invalid or generated number exceeds safe length: reject config/update.
- Outbox worker crashes after claiming event: event becomes claimable again after lock timeout.
- Outbox payload contains known secret-like fields: reject append or redact before write.

## 17. Acceptance Criteria

- [ ] Prisma schema has company, branch, membership branch scope, attachment, document sequence, document number, audit, and outbox primitives without duplicating item 02 models.
- [ ] Local migration runs from empty PostgreSQL.
- [ ] Local seed creates demo company, owner, head office branch, item 04 permission keys, role grants, and default document sequences.
- [ ] API request context exposes branch scope from membership records.
- [ ] Branch endpoints enforce tenant, permission, validation, and audit.
- [ ] Attachment upload-intent, complete, download-url, link, and delete use cases enforce tenant and permissions.
- [ ] Storage adapter never exposes raw object key as public URL.
- [ ] Document number reservation is transactional, idempotent, and never reuses committed numbers.
- [ ] First use of a catalog-backed document type lazily creates its sequence, and a new period inherits the latest active configuration without bypassing `DISABLED`.
- [ ] Outbox repository can append, claim, publish, and fail events with retry metadata.
- [ ] Audit metadata redacts signed URLs, credentials, raw file content, tokens, and full outbox payloads.
- [ ] AI Gateway has no direct Prisma/database access to these source tables.
- [ ] `pnpm --filter @watchdog-bms/api typecheck` passes.
- [ ] `pnpm --filter @watchdog-bms/api test` passes.
- [ ] `pnpm --filter @watchdog-bms/contracts typecheck` passes.

## 18. Required Test Cases

Unit tests:

- Branch validation rejects duplicate/empty code and archiving last active head office.
- Branch scope resolver returns all/selected/default branches according to membership mode.
- Document sequence formatter renders period and prefix placeholders correctly.
- Document sequence formatter rejects invalid template placeholders.
- Document sequence reservation lazily provisions a catalog-backed type, carries
  active configuration into a new period, and rejects missing unknown or
  explicitly disabled types.
- Attachment metadata validator rejects disallowed MIME type and oversize object.
- Outbox redaction rejects or redacts secret-like payload fields.

Use case tests with fake ports:

- Create branch requires `company.branch.manage`.
- List branches requires `company.branch.read`.
- Create upload intent requires `attachment.create`.
- Create download URL requires `attachment.read`.
- Reserve document number returns same reservation for repeated idempotency key.
- Commit document number fails if reservation belongs to another company.
- Append outbox event includes request id and actor id when available.

Database integration tests:

- Migration applies against PostgreSQL.
- Unique constraints prevent duplicate branch code and duplicate document number.
- Concurrent document number reservations do not produce duplicate numbers.
- Outbox claim batch locks events and respects retry metadata.
- Attachment link unique constraint prevents duplicate target/purpose link.

Controller tests:

- Missing token returns `401`.
- Missing permission returns `403`.
- Cross-company branch or attachment access returns `403` or `404` according to policy.
- Branch create/update writes audit log.
- Sequence update writes audit log.

Worker tests:

- Claimed outbox event can be marked published.
- Failed event increments attempts and schedules next availability.
- Dead event is not claimed again by default.

## 19. Implementation Handoff Contract

Suggested source paths:

```text
apps/api/prisma/schema.prisma
apps/api/prisma/seed.ts
apps/api/src/common/prisma/
apps/api/src/common/request-context/
apps/api/src/common/storage/
apps/api/src/modules/data-model-core/
apps/api/src/modules/audit/
apps/workers/src/modules/outbox/
packages/contracts/src/core-data.ts
packages/contracts/src/company.ts
packages/contracts/src/attachments.ts
packages/contracts/src/document-sequences.ts
packages/contracts/src/outbox.ts
```

If item 02 already created `apps/api/src/modules/audit`, extend it instead of creating another audit module.

Recommended `data-model-core` layout:

```text
apps/api/src/modules/data-model-core/
  domain/
    models/
    logic/
    ports/
  application/
    dto/
    use-cases/
  infrastructure/
    db/
    repositories/
    storage/
  presentation/
    http/
  data-model-core.module.ts
```

First implementation pass should not implement later business modules. It should make shared primitives usable and tested.

## 20. Sonnet 4.6 Implementation Notes

Before coding:

1. Read `docs/plans/master-implementation-checklist.md`.
2. Read this spec.
3. Read `docs/plans/data-model-core-plan.md`.
4. Read `docs/specs/auth-authorization-rbac-spec.md`.
5. Read `docs/specs/permission-matrix.md`.
6. Read `docs/guidelines/backend-hexagonal-code-style.md`.
7. Inspect current `apps/api`, `apps/workers`, `packages/contracts`, `packages/config`, and Prisma state.

First pass scope should be Phase 0 and Phase 1 from the linked plan unless the owner explicitly expands scope.

If Prisma, auth, audit, or outbox already exists from item 01 or item 02, reuse and extend it. Report any schema conflict before coding.

## 21. Resolved Owner Decisions

- Branch codes lock after any business record references the branch. Profile fields can still change under normal branch-management permission.
- Attachment max size default is 25 MB per file for both local and production until beta.
- Document sequence config changes require `document.sequence.manage` during MVP and must be audited as high-risk. Add OWNER/MFA policy gate before beta.
