# Agent Memory: Data Model Core (04)

Status: COMPLETE after recheck/fix on 2026-06-24
Owner: Codex
Scope: apps/api, apps/workers, packages/contracts, docs/plans/master-implementation-checklist.md

Role gate status:
- BA: Goal is shared tenant, branch, attachment, document sequence, audit, and outbox primitives for later business modules. Target users are Owner/Admin/Manager/Finance/Accountant/Staff/Auditor/AI users. Journey: admins set company/branches/sequences, users upload/link/read attachments, modules reserve/commit/void numbers and append outbox events. Rules/exceptions and acceptance criteria come from docs/specs/data-model-core-spec.md sections 8, 10-18.
- SA: Item 04 extends item 02 auth/RBAC/audit models without duplicate Company/User/Membership/AuditLog. Contracts stay in packages/contracts; API controllers call use cases; Prisma stays in infrastructure repositories. Tenant hint is route/header companyId but server verifies membership. Branch scope now derives from CompanyMembership.branchScopeMode + MembershipBranchScope. AI Gateway has no Prisma/data-model-core imports.
- DEV: Ponytail read. Smallest correct diff fixed gaps found during recheck: migration chain, branch scope request context, route company mismatch guard, active tax branch code uniqueness, attachment metadata validation, opaque local storage URLs, document number idempotency/disabled/company/status guards, void document number use case.
- Integration: Backend contracts, API, workers, root typecheck/test pass. No Item 04 web UI journey exists by spec; integration coverage is backend-to-contract, auth context, worker smoke, and existing web test suite.

## Decisions
- `20260624000000_init` is now a no-op marker because old init conflicted with item 02 schema; real schema path is item02 baseline then item04 additive migration.
- Local storage adapter returns opaque local URL tokens, not raw object keys.
- `ALL_BRANCHES` request scope leaves `scopes.branchIds` undefined; selected/default modes set explicit branch IDs.
- `document.number.void` added as exported use case for later modules; number allocation remains application-service only, not public HTTP.
- ~~Actual MinIO/S3 adapter remains later production storage work~~ (2026-07-10: `S3StorageAdapter` shipped — presigned PUT/GET + HeadObject, `ATTACHMENT_STORAGE` env factory selects S3 when `S3_BUCKET` set; local adapter stays the dev default).

## Artifacts
- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260624000000_init/migration.sql
- apps/api/prisma/migrations/20260624000002_item04_data_model_core/migration.sql
- apps/api/prisma/seed.ts
- apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts
- apps/api/src/modules/auth/presentation/auth.guard.ts
- apps/api/src/modules/data-model-core/
- apps/workers/src/modules/outbox/
- packages/contracts/src/index.ts
- docs/plans/master-implementation-checklist.md

Verification:
- `pnpm --filter @watchdog-bms/api typecheck` ✅
- `pnpm --filter @watchdog-bms/api test` ✅ 132/132
- `pnpm --filter @watchdog-bms/api prisma:validate` ✅
- `pnpm --filter @watchdog-bms/api migration:review` ✅
- Temp Postgres `prisma migrate deploy` ✅ applied 3 migrations from empty DB
- Temp Postgres `prisma db seed` ✅ created 1 company, 1 branch, sampled 4 item04 permissions, 5 default sequences
- `pnpm --filter @watchdog-bms/contracts typecheck` ✅
- `pnpm --filter @watchdog-bms/workers typecheck` ✅
- `pnpm --filter @watchdog-bms/workers test` ✅ 3/3
- `pnpm typecheck` ✅ 10/10 tasks
- `pnpm test` ✅ 10/10 tasks
- `pnpm security:audit` ✅ exit 0 at high threshold; registry reported 1 moderate vulnerability
- `rg "@prisma|PrismaClient|data-model-core|generated/prisma|apps/api/src/modules" apps/ai-gateway -S` ✅ no matches

Next:
- 05. Inventory MVP can use Branch, AttachmentObject, DocumentSequence, AuditLog, and OutboxEvent primitives.
- ~~Later storage work: replace local adapter with MinIO/S3-compatible signed URL adapter when production storage scope starts.~~ DONE 2026-07-10: `apps/api/src/modules/data-model-core/infrastructure/storage/s3-storage.adapter.ts` (H4 in `docs/plans/mvp1-launch-codex-handoff.md`).
