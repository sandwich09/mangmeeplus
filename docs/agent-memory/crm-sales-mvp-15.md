# Agent Memory: Item 15 CRM and Sales MVP

Status: Core gate-critical path implemented and verified (unit + use-case tests, typechecks). DB migration authored but NOT yet applied (no live DB in this environment). Checklist item 15 left UNCHECKED pending migration deploy + deferred sub-features.

Owner: implementer (main thread)

Scope:
Implemented the gate-critical CRM slice per [[crm-sales-mvp-plan]] / [[crm-sales-spec]]:
- Shared contracts `packages/contracts/src/crm.ts` (enums + DTOs) exported via index.
- Permission keys `crm.*` (30) + role grants in `apps/api/src/modules/auth/permission-registry.ts`.
- Prisma models (8): `CrmCustomer`, `CrmContactPerson`, `CrmLead`, `CrmPipelineStage`, `CrmOpportunity`, `CrmActivity`, `CrmFollowUpTask`, `CrmQuotationLink` + 14 enums. Migration `20260701120000_item15_crm_sales` (generated via `prisma migrate diff` old→new schema).
- API module `apps/api/src/modules/crm` (hexagonal): domain logic (+spec), repository, use-cases (customer/contact, lead, opportunity/pipeline/activity, follow-up, quotation, AI read), 5 controllers under `companies/:companyId/crm`. Registered in `app.module.ts`.
- Accounting boundary: CRM quotation-draft calls `CreateDocumentUseCase`/`GetDocumentUseCase` (now exported from `accounting-documents.module.ts`) — permission-checked (`accounting.quotation.create`) + audited by item 08. CRM never issues/approves/voids/converts.
- Web workspace `apps/web/src/features/crm` (CrmPages.tsx + crm.api.ts), route page wired (replaced planned placeholder), nav entry set `status: 'ready'`.
- AI/LINE read-only endpoints: follow-up priorities, customer/opportunity/pipeline summaries, dashboard summary — source refs + web deep links, permission-scoped, no mutation.

Decisions:
- ABAC fallback (team primitives absent): read-all roles = OWNER/ADMIN/MANAGER/FINANCE/ACCOUNTANT/AUDITOR_READONLY/MARKETING; SALES scoped to owned/assigned. Manager gets company-wide read (documented fallback) so team pipeline stays visible per acceptance criteria. Mutation-all = OWNER/ADMIN/MANAGER; SALES mutates only owned.
- Duplicate policy: create blocks only on exact tax-id match with an ACTIVE customer; phone/email/name return non-blocking warnings.
- Default pipeline stages lazily seeded per company on first CRM stage read (`ensureDefaultStages`). No seed.ts change.
- Lead conversion idempotent via `@@unique([companyId, convertIdempotencyKey])`; already-converted lead returns existing result.
- One active quotation link per opportunity; reuse existing unless `revisionReason` given or prior link VOIDED/REJECTED.

Deferred (documented backlog, NOT in this pass): customer CSV import preview/commit, duplicate-candidate table + merge workflow, customer segments, dashboard/notification delivery wiring (only read providers/outbox events emitted), CSV/JSON export endpoint (sanitizer `sanitizeCsvCell` exists in domain logic, not yet surfaced as a route). These are in-scope per plan but not gate-critical; open as follow-up before final checklist close.

Open questions:
- Team/branch ABAC primitives still absent — manager scope is company-wide-read fallback, revisit when team model lands.

Artifacts:
- API: apps/api/src/modules/crm/**
- Contracts: packages/contracts/src/crm.ts
- Web: apps/web/src/features/crm/**, apps/web/app/(workspace)/companies/[companyId]/crm/page.tsx
- Migration: apps/api/prisma/migrations/20260701120000_item15_crm_sales/migration.sql

Review fixes (adversarial business-alignment review, 2026-07-01):
- HIGH: `replaceStages` per-id update now scoped by `companyId` (was `where: { id }` — cross-tenant write hole).
- HIGH: `ListCrmActivitiesUseCase` now enforces ABAC — SALES must own the target customer/opportunity or is restricted to own activity (was unscoped read).
- MEDIUM: lead conversion now claims the lead atomically inside the tx (`updateMany where status != CONVERTED`) so concurrent conversions can't create duplicate customer/opportunity; loser returns the existing result.
- MEDIUM: AI opportunity summary redacts accounting-derived `quotationStatus` unless caller has `accounting.document.read`/`accounting.quotation.read`.
- LOW: WON-close only counts a non-VOIDED/REJECTED quotation link as satisfying the win-requires-quote rule.
- Regression tests added for the WON-void-link and activity-ABAC cases.

Verification:
- `cd apps/api && npm test` → 542 passing (incl. crm.logic.spec 9, crm-workflow.use-case.spec 16).
- `cd apps/api && npx tsc --noEmit` → clean.
- `cd apps/web && npx tsc --noEmit` → clean.
- `cd packages/contracts && npx tsc` → clean (dist rebuilt).
- `npx prisma validate` + `npx prisma generate` → OK.
- Migration deploy NOT run (P1010 no DB access in env). Run `prisma migrate deploy` against a live DB before enabling the module.

Next:
- Apply migration on a live DB and smoke-test the web CRM workflow end-to-end.
- Implement deferred sub-features (import/merge/segments/export route, dashboard-notification delivery) then close checklist item 15.
