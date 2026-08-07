# Inventory MVP Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 05.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/inventory-mvp-spec|Inventory MVP Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 05. Inventory MVP
- Related specs:
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0002-inventory-negative-stock-policy|ADR 0002 Inventory Negative Stock Policy]]
  - [[adr/0003-inventory-stock-balance-source-of-truth|ADR 0003 Inventory Stock Balance Source of Truth]]
  - [[adr/0004-inventory-movement-immutability|ADR 0004 Inventory Movement Immutability]]
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the first trustworthy stock management slice for WatchDog-BMS:

- Product master data.
- Product barcode aliases and internal QR labels.
- Inventory locations.
- Immutable stock movements.
- Movement-derived stock balance.
- Web stock action and scan flows.
- Permission, audit, and outbox integration.
- Read-only inventory data access for later LINE AI and dashboard work.

This plan should give Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/web`: Next.js App Router app with feature folders, CSS Modules, shared `Badge`, `Stack`, and modal placeholder docs.
- `apps/workers`: TypeScript worker shell.
- `packages/contracts`: shared contract package exists but currently thin.
- `packages/config`: shared config package exists but currently thin.
- No Prisma schema exists in this snapshot.
- Root, API, web, and contracts packages expose build/typecheck/test scripts.

Before implementation, inspect latest code again because items 01 through 04 may add config, Prisma, auth, request context, audit, outbox, web workspace shell, shared API client, common UI, branch scope, or contracts.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/inventory-mvp-spec.md`.
3. Read `docs/specs/permission-matrix.md`.
4. Read `docs/specs/data-model-core-spec.md`.
5. Read `docs/specs/auth-authorization-rbac-spec.md`.
6. Read `docs/specs/web-core-workspace-spec.md`.
7. Read `docs/guidelines/backend-hexagonal-code-style.md`.
8. Read `docs/guidelines/web-frontend-code-style.md`.
9. Inspect `apps/api`, `apps/web`, `apps/workers`, `packages/contracts`, `packages/config`, and current Prisma state.
10. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 05 complete until Phase 0 through Phase 8 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 04.
- If Prisma is missing, add it under `apps/api` following ADR 0006 and existing package conventions.
- If Prisma/auth/audit/outbox already exists, extend it with additive migrations and module code. Do not duplicate `Company`, `Branch`, `CompanyMembership`, `AuditLog`, `OutboxEvent`, or request context models.
- Keep branch and inventory location separate. Location may reference branch, but balance uses location.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Keep balance canonical source as movement rows. Do not build direct editable balance table.
- Make stock movement records append-only. Do not expose movement update/delete routes.
- Write movement creation, negative-stock validation, audit append, and outbox append in one transaction when underlying repositories support transactions.
- Use server time for `occurredAt` in MVP. Do not add backdated movement UI.
- Enforce permissions on the server. Web permission checks are UX only.
- Add Thai and English visible labels for web inventory UI.
- AI Gateway and LINE must remain read-only for item 05.
- Each phase must leave `@watchdog-bms/api`, `@watchdog-bms/web`, and `@watchdog-bms/contracts` typecheckable when touched.

## Scope

### In Scope

- Shared inventory contracts in `packages/contracts`.
- Prisma schema/migration/seed for inventory models if Prisma exists or is added.
- API inventory module using hexagonal folder structure.
- Product, barcode, internal QR label, inventory location, movement, balance, and stock report use cases.
- Permission keys and role grants for inventory.
- Audit action integration for inventory source records where audit exists.
- Outbox event integration for inventory source records where outbox exists.
- Web inventory feature folder with product, location, movement, stock action, scan, and report screens.
- Web camera scan where browser support exists plus manual fallback.
- Tests for contracts, domain logic, use cases, API behavior, and UI logic where current test setup supports them.

### Out of Scope

- Dedicated scanner hardware.
- Offline mode.
- Purchase orders, goods receipt, supplier/AP workflow.
- Sales document stock reservation/deduction.
- Full dashboard notification delivery.
- LINE inventory mutation.
- AI inventory mutation or draft stock movements.
- Inventory valuation, COGS, and ledger posting.
- Manufacturing, BOM, MRP, lot/batch tracking, expiration tracking, serial numbers, warehouse bins, picking, packing, and shipping.
- Marketplace import.
- Production infra provisioning.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: `String @id @default(cuid())` unless the repo already standardizes UUIDs before item 05 starts.
- Product kinds: `STOCKABLE`, `SERVICE`, `NON_STOCK`.
- Product status: `ACTIVE`, `ARCHIVED`.
- Location status: `ACTIVE`, `ARCHIVED`.
- Location types: `MAIN`, `WAREHOUSE`, `STOREFRONT`, `VEHICLE`, `VIRTUAL`, `OTHER`.
- Default location seed: code `MAIN`, name `Main Stock`, type `MAIN`.
- SKU normalization: trim whitespace; compare uniqueness case-insensitively if DB convention supports it. If not, use lowercased normalized SKU field or service-level guard.
- Quantity: decimal with positive input; no negative stored quantity.
- Quantity precision: use a decimal type suitable for whole or fractional units. Avoid JavaScript floating-point math in domain calculations.
- Movement numbers: use Data Model Core document sequence `inventory.movement` when available; otherwise nullable and documented.
- Internal QR payloads:
  - `WD1:P:<productId>`
  - `WD1:LOC:<locationId>`
- Lot payload `WD1:L:<lotId>` is reserved, not implemented in item 05.
- Count stock is represented as count-adjustment movement delta.
- Reversal DB field may be included as nullable future hook. Reversal UI is deferred unless trivial.
- Low-stock flag: `balance <= reorderPoint` only when reorder point is set; notifications belong to item 06.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect `apps/web/app`, `apps/web/src/common`, `apps/web/src/features`, and current workspace shell/routes from item 03.
- [ ] Inspect `packages/contracts/src` and existing export style.
- [ ] Confirm whether Prisma already exists.
- [ ] Confirm whether auth/request-context/audit modules from item 02 exist.
- [ ] Confirm whether Data Model Core branch, document sequence, attachment, audit, and outbox modules from item 04 exist.
- [ ] Confirm current permission key registry and seed location.
- [ ] Confirm current web HTTP client, loader, forbidden, table, modal/drawer, form, route, and dictionary primitives.
- [ ] Confirm current test commands for root, API, web, workers, contracts, and config.
- [ ] Decide extension path:
  - extend existing Prisma/auth/audit/outbox/web shell, or
  - create missing Prisma/inventory-specific pieces with clear notes.
- [ ] Record any schema, route, permission, or UI conflicts in implementation notes before coding.

### Tests

- No code tests required unless reconciliation changes setup.

### Exit Criteria

- Implementer knows exact files to touch.
- Implementer knows whether to add or extend Prisma.
- Implementer knows how inventory will plug into auth, audit, outbox, document sequence, web shell, and shared contracts.
- No duplicate tenant/auth/audit/outbox/web-core plan remains unresolved.

## Phase 1: Contracts, Domain Model, and Pure Logic

### Goal

Create framework-free inventory contracts and business logic before persistence and HTTP wiring.

### Tasks

- [ ] Add or extend `packages/contracts/src/inventory.ts`.
- [ ] Export inventory contracts from `packages/contracts/src/index.ts`.
- [ ] Add API inventory module folder:
  - `apps/api/src/modules/inventory/domain/models`
  - `apps/api/src/modules/inventory/domain/logic`
  - `apps/api/src/modules/inventory/domain/ports`
  - `apps/api/src/modules/inventory/application/use-cases`
  - `apps/api/src/modules/inventory/application/dto`
  - `apps/api/src/modules/inventory/infrastructure`
  - `apps/api/src/modules/inventory/presentation/http`
- [ ] Define domain models/enums for product, barcode, internal QR label, location, stock movement, movement direction, balance, and stock report row.
- [ ] Add pure logic:
  - movement type to direction/sign
  - balance calculation from movement summaries
  - negative-stock validation
  - count adjustment delta calculation
  - internal QR payload build/parse/validate
  - product/location archive eligibility checks
- [ ] Add domain errors with stable codes for duplicate SKU, invalid quantity, insufficient stock, inactive product, inactive location, same transfer location, forbidden, not found, and malformed QR.

### Tests

- `packages/contracts` typecheck.
- Domain unit tests for movement sign mapping.
- Domain unit tests for balance calculation.
- Domain unit tests for count delta in/out/no-op.
- Domain unit tests for negative-stock validation.
- Domain unit tests for QR payload parser.

### Exit Criteria

- Shared contracts compile and are exported.
- Domain logic has no NestJS, Prisma, HTTP, storage, queue, or browser imports.
- Core business rules are covered by pure tests.

## Phase 2: Prisma Schema, Migration, and Seed

### Goal

Create database source-of-truth records for products, barcodes, labels, locations, and immutable stock movements.

### Tasks

- [ ] Add Prisma to `apps/api` if still missing and item 04 did not already add it.
- [ ] Add or extend `apps/api/prisma/schema.prisma`.
- [ ] Reuse existing `Company`, `User`, `Branch`, `CompanyMembership`, `AuditLog`, `OutboxEvent`, `DocumentSequence`, and `DocumentNumber` models if they exist.
- [ ] Add inventory enums:
  - `ProductKind`
  - `InventoryRecordStatus`
  - `InventoryLocationType`
  - `ProductBarcodeType`
  - `InternalQrEntityType`
  - `StockMovementType`
  - `StockMovementDirection`
- [ ] Add inventory models:
  - `Product`
  - `ProductBarcode`
  - `InventoryLocation`
  - `InternalQrLabel`
  - `StockMovement`
- [ ] Add uniqueness constraints and indexes from the spec.
- [ ] Add migration scripts if missing.
- [ ] Add seed updates:
  - default `MAIN` location for demo company if demo data exists
  - inventory permission keys
  - default role grants
  - document sequence `inventory.movement` when sequence module exists
- [ ] Add migration/seed README note if no existing Prisma docs exist.

### Tests

- Prisma validate/generate command.
- Migration applies to local/test database where current setup supports it.
- Seed is idempotent.
- Schema-level uniqueness checks for SKU, location code, and barcode.

### Exit Criteria

- Inventory schema is additive and does not duplicate previous shared models.
- Prisma generated client typecheck passes.
- Seed can run repeatedly without duplicate permission/location/sequence records.

## Phase 3: Repositories, Queries, and Transaction Boundary

### Goal

Implement persistence adapters and read queries behind ports without leaking Prisma into domain/application.

### Tasks

- [ ] Define ports:
  - `ProductRepositoryPort`
  - `ProductBarcodeRepositoryPort`
  - `InventoryLocationRepositoryPort`
  - `InternalQrLabelRepositoryPort`
  - `StockMovementRepositoryPort`
  - `StockBalanceQueryPort`
  - `InventoryReportQueryPort`
  - `InventoryTransactionPort`
  - optional `AuditPort`, `OutboxPort`, `DocumentSequencePort`
- [ ] Implement Prisma mappers for inventory models.
- [ ] Implement Prisma repositories for products, barcodes, locations, labels, and movements.
- [ ] Implement query classes for product list, location list, movement history, balances, label resolve, and stock report.
- [ ] Implement transaction wrapper so movement validation and inserts share one DB transaction.
- [ ] Implement row-level filters for company and branch/location scope where request context exists.
- [ ] Keep query DTOs explicit and web-safe.

### Tests

- Repository integration tests where DB test setup exists.
- Query integration tests for balance summary and movement filters.
- Mapper tests if persistence/domain shapes differ.
- Transaction test for transfer atomicity.

### Exit Criteria

- Persistence code lives only under `infrastructure`.
- Application/domain imports only ports and domain models.
- Derived balance query matches movement rows.
- Transfer cannot partially persist.

## Phase 4: Product, Barcode, Label, and Location Use Cases

### Goal

Implement master-data workflows with tenant, permission, validation, audit, and outbox behavior.

### Tasks

- [ ] Implement product use cases:
  - create product
  - update product
  - archive product
  - get product detail
  - list products
- [ ] Implement barcode/label use cases:
  - add product barcode
  - generate internal product QR
  - generate internal location QR
  - resolve label payload
  - mark label printed
- [ ] Implement location use cases:
  - create location
  - update location
  - archive location
  - get location detail
  - list locations
- [ ] Enforce permissions:
  - product read/manage
  - location read/manage
  - label manage
- [ ] Enforce validation:
  - required SKU/name/unit
  - SKU uniqueness
  - barcode uniqueness
  - required location code/name/type
  - location archive blocked when non-zero balance
- [ ] Write audit events where audit exists.
- [ ] Append outbox events where outbox exists.

### Tests

- Create/update/archive product success and validation failures.
- Duplicate SKU fails within company and succeeds across companies.
- Add duplicate barcode fails.
- Internal QR generation resolves current product/location.
- Create/update/archive location success and validation failures.
- Location archive with non-zero balance fails.
- Permission denial tests for mutation routes/use cases.
- Audit/outbox tests where infrastructure exists.

### Exit Criteria

- Product and location master data can be managed safely.
- Internal QR labels resolve to current backend records.
- Master-data mutation is tenant-scoped, permission-protected, audited, and evented where infrastructure exists.

## Phase 5: Movement Use Cases and Balance Rules

### Goal

Implement inventory stock actions as immutable movement creation workflows.

### Tasks

- [ ] Implement receive stock use case.
- [ ] Implement issue stock use case.
- [ ] Implement transfer stock use case.
- [ ] Implement count stock use case.
- [ ] Implement manual adjustment use case.
- [ ] Implement movement history query use case.
- [ ] Implement balance query use case.
- [ ] Implement stock report query use case.
- [ ] Validate active stockable product and active location.
- [ ] Validate positive decimal quantity.
- [ ] Validate required reason for adjustment and count adjustment.
- [ ] Validate negative-stock block for outgoing movement types.
- [ ] Use server time for `occurredAt`.
- [ ] Use document sequence `inventory.movement` when available.
- [ ] Create audit events for movement created, count created, adjustment created, and negative-stock denial.
- [ ] Append bounded outbox event for movement created.
- [ ] Do not implement movement update/delete behavior.

### Tests

- Receive increases balance.
- Issue decreases balance.
- Issue below available balance fails and creates no movement.
- Transfer decreases source and increases destination with same `transferGroupId`.
- Transfer same source/destination fails.
- Transfer below available balance fails and creates no movement.
- Count above current balance creates `count_adjustment_in`.
- Count below current balance creates `count_adjustment_out`.
- Count equal current balance creates no movement.
- Adjustment without reason fails.
- Concurrent stock-out attempts cannot produce negative balance.
- Movement history includes correction movements.
- Movement update/delete route/use case is absent.
- Audit/outbox writes are transactional where supported.

### Exit Criteria

- Current balance is fully explainable from movement history.
- Negative stock is blocked server-side.
- Stock movement history is append-only.
- All stock mutation paths are permission-protected and auditable where infrastructure exists.

## Phase 6: HTTP API Controllers

### Goal

Expose inventory use cases through protected REST endpoints with stable DTOs.

### Tasks

- [ ] Add `inventory.module.ts` and register it in API app module.
- [ ] Add controllers under `presentation/http`.
- [ ] Add request DTO validation with `class-validator` or existing repo validation pattern.
- [ ] Add `@RequirePermissions(...)` to every protected route.
- [ ] Add routes:
  - `GET /v1/companies/:companyId/inventory/products`
  - `POST /v1/companies/:companyId/inventory/products`
  - `GET /v1/companies/:companyId/inventory/products/:productId`
  - `PATCH /v1/companies/:companyId/inventory/products/:productId`
  - `POST /v1/companies/:companyId/inventory/products/:productId/archive`
  - `POST /v1/companies/:companyId/inventory/products/:productId/barcodes`
  - `POST /v1/companies/:companyId/inventory/products/:productId/internal-qr`
  - `GET /v1/companies/:companyId/inventory/locations`
  - `POST /v1/companies/:companyId/inventory/locations`
  - `GET /v1/companies/:companyId/inventory/locations/:locationId`
  - `PATCH /v1/companies/:companyId/inventory/locations/:locationId`
  - `POST /v1/companies/:companyId/inventory/locations/:locationId/archive`
  - `POST /v1/companies/:companyId/inventory/locations/:locationId/internal-qr`
  - `GET /v1/companies/:companyId/inventory/labels/resolve`
  - `POST /v1/companies/:companyId/inventory/labels/:labelId/printed`
  - `GET /v1/companies/:companyId/inventory/movements`
  - `POST /v1/companies/:companyId/inventory/movements/receive`
  - `POST /v1/companies/:companyId/inventory/movements/issue`
  - `POST /v1/companies/:companyId/inventory/movements/transfer`
  - `POST /v1/companies/:companyId/inventory/movements/count`
  - `POST /v1/companies/:companyId/inventory/movements/adjust`
  - `GET /v1/companies/:companyId/inventory/balances`
  - `GET /v1/companies/:companyId/inventory/reports/stock`
- [ ] Map domain errors to stable HTTP status and error codes.
- [ ] Ensure no movement update/delete endpoints exist.
- [ ] Add OpenAPI metadata if current API conventions include Swagger decorators.

### Tests

- Controller or API integration tests for success and validation failures.
- Permission-denied tests.
- Cross-company access denial test.
- Route smoke tests for all list/detail/mutation endpoints.
- Confirm movement update/delete routes return 404 or do not compile into router.

### Exit Criteria

- API exposes stable inventory routes.
- All protected routes deny by default without permissions.
- Controllers contain no business logic.

## Phase 7: Web Inventory Workspace

### Goal

Build usable web-first inventory workflows on top of the workspace shell from item 03.

### Tasks

- [ ] Add `apps/web/src/features/inventory/`.
- [ ] Add `inventory.model.ts`, `inventory.constants.ts`, `inventory.logic.ts`, and `inventory.api.ts`.
- [ ] Reuse shared HTTP client, loaders, forbidden states, modal/drawer, table, buttons, forms, badges, and layout primitives from web core where available.
- [ ] Add thin route files for:
  - `/inventory/products`
  - `/inventory/products/new`
  - `/inventory/products/[productId]`
  - `/inventory/locations`
  - `/inventory/movements`
  - `/inventory/movements/new`
  - `/inventory/stock-count`
  - `/inventory/scan`
  - `/inventory/reports/stock`
- [ ] Add product list/detail/create/edit components.
- [ ] Add barcode/internal QR panel and label preview/print action.
- [ ] Add location list/create/edit components.
- [ ] Add movement history table with filters and immutable detail drawer/modal.
- [ ] Add stock action form for receive, issue, transfer, count, and adjustment.
- [ ] Add scan page:
  - browser camera path where supported
  - manual payload/barcode input fallback
  - resolve result card
  - allowed next actions based on permission
- [ ] Add stock report table by product/location with low-stock flag.
- [ ] Add Thai and English dictionaries for visible labels and messages.
- [ ] Add visible loaders for every API load, filter, submit, scan resolve, and print-mark action.
- [ ] Add empty, error, forbidden, archived, and read-only states.
- [ ] Update workspace navigation/module registry if item 03 has one.

### Tests

- Web typecheck.
- Pure UI logic tests for form validation, balance formatting, count delta display, and route builders.
- Component/render tests where current setup supports them.
- Manual browser smoke test:
  - product list
  - create product
  - product detail
  - location list
  - movement form
  - movement history
  - scan manual fallback
  - stock report
- Responsive smoke check for desktop and mobile widths if browser tooling exists.

### Exit Criteria

- Inventory staff can complete MVP stock workflows on web.
- Owner/admin can review current stock and movement history.
- Web UI has no direct balance edit or movement edit/delete action.
- Thai/English labels exist and fit the shared workspace patterns.

## Phase 8: AI/LINE Read-Only Hooks, Verification, and Handoff

### Goal

Prepare inventory data for later LINE AI and dashboard work without adding mutation from AI/LINE.

### Tasks

- [ ] Add API/tool-friendly read methods for stock summary, low-stock list, and recent movement summary if AI Gateway integration points exist.
- [ ] Confirm AI Gateway does not import API Prisma client or inventory repositories directly.
- [ ] Document read-only inventory tool contract or integration note in the AI Gateway module if item 07 is not implemented yet.
- [ ] Confirm mutation attempts from LINE are blocked or deferred to web deep links only.
- [ ] Confirm low-stock event placeholder does not send final notifications in item 05.
- [ ] Run verification commands.
- [ ] Record verification commands and results in implementation summary.
- [ ] Update Master Implementation Checklist item 05 only after all exit criteria pass.

### Verification Commands

Use exact commands available in the repo after implementation. Expected baseline commands:

```text
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/web test
pnpm typecheck
pnpm test
```

If Prisma is added, also run current repo equivalents of:

```text
pnpm --filter @watchdog-bms/api prisma validate
pnpm --filter @watchdog-bms/api prisma generate
pnpm --filter @watchdog-bms/api prisma migrate dev --name inventory_mvp
```

If web implementation needs runtime verification, start dev server and verify inventory routes in browser.

### Exit Criteria

- Inventory read hooks are permission-aware and mutation-free.
- AI Gateway has no direct DB/repository access to inventory source tables.
- Verification commands pass or failures are documented with concrete reasons.
- Implementation summary includes files changed, migrations, seed behavior, tests run, and known follow-ups.

## Review Checklist

- [ ] Product SKU uniqueness is company-scoped.
- [ ] Location code uniqueness is company-scoped.
- [ ] Barcode uniqueness is company-scoped.
- [ ] Branch and inventory location are not conflated.
- [ ] Only stockable active products can receive movements.
- [ ] Archived products/locations remain readable through historical movements.
- [ ] Quantity is decimal-safe and always positive at rest.
- [ ] Balance derives from movement rows, not editable stock balance.
- [ ] Movement update/delete routes do not exist.
- [ ] Transfer is atomic and linked by `transferGroupId`.
- [ ] Negative-stock check and movement insert share one trusted transaction.
- [ ] Count stock writes delta movement or no-op success.
- [ ] Adjustment/count adjustment require reason text.
- [ ] Server enforces tenant, permission, and location/branch scope.
- [ ] Audit metadata redacts sensitive payloads and records mutation/denial events.
- [ ] Outbox payloads are bounded, redacted, and idempotent where possible.
- [ ] AI Gateway does not import/use API Prisma client or direct repositories.
- [ ] Web route files are thin.
- [ ] Web feature code separates components, API, constants, logic, models, and CSS.
- [ ] Visible loaders cover API waits.
- [ ] Thai and English labels are present for inventory UI.
- [ ] No LINE or AI final inventory mutation exists.

## Definition of Done

- Phase 0 through Phase 8 exit criteria are complete.
- Product, barcode, label, location, movement, balance, and stock report behavior is implemented.
- Stock balance derives correctly from immutable movement records.
- Negative stock is blocked by server validation and concurrency-safe persistence.
- Inventory mutation is permission-protected, tenant-scoped, audited, and evented where shared infrastructure exists.
- Web inventory workflows are usable in the workspace shell.
- LINE/AI inventory behavior remains read-only.
- Tests cover critical business rules and permission boundaries.
- Verification commands and results are recorded in implementation summary.

## First Handoff Prompt for Sonnet 4.6

```text
Implement Master Implementation Checklist item 05: Inventory MVP.

Start with docs/plans/inventory-mvp-plan.md Phase 0 and Phase 1 only. Read docs/specs/inventory-mvp-spec.md, permission matrix, data model core spec, auth/RBAC spec, web core spec, backend/frontend guidelines, and ADR 0002/0003/0004/0006 before editing.

Inspect current repo state first. If Prisma/auth/audit/outbox/web shell already exists, extend it. If schema or route conflicts appear, stop and report them before coding. Keep item 05 unchecked until all phases and verification pass.
```

## Risks

- Items 01 through 04 may introduce different schema, auth, request context, or UI conventions. Mitigation: Phase 0 reconciliation before edits.
- Concurrent stock movements can bypass negative-stock checks if validation and insert are not transactional. Mitigation: one transaction plus row/table lock or serializable strategy appropriate for current Prisma/PostgreSQL setup.
- Decimal quantities can drift if implemented with JavaScript floating-point math. Mitigation: decimal type and string/Decimal handling at boundaries.
- Cached balance can drift if added early. Mitigation: no canonical balance table in MVP.
- Backdated movement can complicate current balance and audit. Mitigation: server-time `occurredAt` only in MVP.
- Branch scope can be confused with location scope. Mitigation: separate `Branch` and `InventoryLocation`, with optional `branchId`.
- Web scan can fail on unsupported browsers. Mitigation: manual payload/barcode fallback.
- AI/LINE mutation can creep into item 05. Mitigation: read-only hooks and explicit blocked mutation tests.

## Backlog After MVP

- Reversal movement UI and correction chain display.
- Configurable negative-stock/backorder policy.
- Cached rebuildable stock balance projection.
- Lot/batch, serial number, expiry, bin, and warehouse workflows.
- Purchase goods receipt and supplier/AP integration.
- Sales reservation/deduction integration.
- Inventory valuation, costing policy, COGS, and ledger posting.
- GS1 Digital Link optional support.
- Dedicated scanner/label printer integration.
- Offline stock count flow.
