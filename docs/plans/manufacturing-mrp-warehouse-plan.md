# Manufacturing, MRP, and Advanced Warehouse Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 22.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/manufacturing-mrp-warehouse-spec|Manufacturing, MRP, and Advanced Warehouse Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 22. Manufacturing, MRP, and Advanced Warehouse
- Related specs:
  - [[specs/inventory-mvp-spec|Inventory MVP Spec]]
  - [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
  - [[specs/reports-bi-spec|Reports BI Spec]]
  - [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0003-inventory-stock-balance-source-of-truth|ADR 0003 Inventory Stock Balance Source of Truth]]
  - [[adr/0004-inventory-movement-immutability|ADR 0004 Inventory Movement Immutability]]
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement manufacturing, MRP, and advanced warehouse as an extension of current inventory, procurement, ledger, AI suggestion, workflow, and reporting foundations:

- BOM and product planning setup.
- Production orders with material issue, output receipt, scrap, and close.
- Lot/batch/serial, zones, bins, and warehouse task execution.
- Deterministic MRP runs and reviewable suggestions.
- Costing/posting hooks for ledger policy.
- Web workflows and read-only AI/LINE summaries.

This plan should give Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current docs snapshot on 2026-06-23 shows item 22 should start after these foundations exist or are planned:

- Item 05 inventory owns products, locations, immutable stock movements, movement-derived balance, negative-stock policy, and QR labels.
- Item 10 ledger owns posting rules, generated journals, period close, and source posting adapters.
- Item 12 procurement owns supplier, purchase request/order, goods receipt, vendor bill, and supplier payment.
- Item 17 AI draft/suggestion owns generic suggestion persistence and web review.
- Item 18 reports owns dataset registry and controlled exports.
- Item 16 workflow owns safe automation, tasks, SLA, and notification adapters.

Before implementation, inspect latest code again because items 01 through 21 may add Prisma, auth, request context, audit, outbox, document sequence, attachment storage, inventory APIs, procurement APIs, ledger adapters, report datasets, workflow hooks, web route shell, shared API client, and permission registry.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Owner decisions confirmed after handoff review:

- Serial number first pass supports API/data model/manual table entry. One-by-one serial scan UI is backlog.
- Manufacturing costing first pass uses standard/planned cost snapshots. Actual cost and weighted average valuation are backlog until inventory valuation policy exists.
- MRP first demand source beyond stock/reorder is manual demand plan. Sales order demand adapter comes next; marketplace demand adapter comes later.
- Cycle count approval requires approval for every variance by default. Configurable quantity/value threshold is backlog.

Start point:

1. Read this plan first.
2. Read `docs/specs/manufacturing-mrp-warehouse-spec.md`.
3. Read `docs/specs/inventory-mvp-spec.md`.
4. Read `docs/specs/procurement-supplier-ap-spec.md`.
5. Read `docs/specs/double-entry-ledger-closing-spec.md`.
6. Read `docs/specs/reports-bi-spec.md`.
7. Read `docs/specs/ai-draft-suggestion-layer-spec.md`.
8. Read `docs/specs/permission-matrix.md`.
9. Read backend/frontend/security guidelines and ADR 0003/0004/0006.
10. Inspect `apps/api`, `apps/web`, `apps/workers`, `packages/contracts`, `packages/config`, and current Prisma state.
11. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 22 complete until Phase 0 through Phase 11 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 21.
- Extend existing Prisma/auth/audit/outbox/document-sequence/attachment/request-context primitives. Do not duplicate them.
- Extend item 05 inventory movement behavior through application ports or APIs. Do not write stock balance directly.
- Keep inventory movement immutable. Corrections use reversal, void policy, or adjustment records.
- Keep bin/lot balances derived from stock movements plus trace detail. Cached projections must be rebuildable and never user-editable.
- Keep BOM revisions immutable after activation. Corrections create new revisions.
- Keep production order release, issue, receipt, scrap, close, and void auditable.
- Keep MRP deterministic, snapshot-based, and non-mutating until web conversion.
- MRP conversion must re-check source state, permissions, and stale suggestion age.
- Use decimal-safe quantity, cost, and money math. Use string contracts for decimals.
- Respect ledger period close when item 10 exists.
- Respect procurement APIs when converting purchase suggestions. Do not create purchase records directly from manufacturing repositories.
- Respect item 17 for generic AI suggestion storage if it exists. Do not create a competing AI workflow.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not expose Prisma generated types as domain or API contracts.
- LINE and AI remain read-only or draft/suggestion only. All final mutation happens on web/API.
- AI Gateway must call permission-checked ERP APIs/tools only. It must not import API Prisma client or manufacturing repositories.
- Each phase must leave touched packages typecheckable.

## Scope

### In Scope

- Shared manufacturing/MRP/warehouse contracts in `packages/contracts`.
- API module(s) for manufacturing, MRP, and warehouse using repo hexagonal structure.
- Product planning profile, BOM, BOM revision, component, work center, routing metadata.
- Production order, component snapshot, output snapshot, material issue, production receipt, scrap/variance, and close.
- Lot/batch/serial, zones, bins, warehouse task queue, putaway, pick, bin transfer, replenishment, and cycle count.
- MRP run, requirement, supply, suggestion, exception, pegging, and conversion workflow.
- Permission keys and default grants.
- Audit/outbox integration.
- Inventory movement integration with source refs and trace detail.
- Ledger costing/posting source inputs and period close checks.
- Procurement conversion adapters for purchase suggestions.
- Report/query read models and optional dataset registration when item 18 exists.
- Web manufacturing, MRP, and warehouse pages.
- Read-only AI/LINE tools or summaries when current AI Gateway integration points exist.
- Tests for contracts, domain logic, use cases, API behavior, UI behavior, permission boundaries, and source integration.

### Out of Scope

- MES/OEE, shop-floor device integration, robotics, scanner hardware fleet management, and IoT.
- Finite capacity scheduling and optimization solver.
- Quality management/CAPA/regulated certification.
- External carrier booking, shipping labels, customs, freight, and transport management.
- Supplier/customer portal, EDI, marketplace mutation, and bank/tax execution.
- Complex landed cost, subcontract manufacturing, consignment, intercompany manufacturing, and multi-currency manufacturing revaluation.
- Automatic ledger entries without item 10 costing/posting policy.
- LINE/AI final manufacturing, warehouse, procurement, inventory, ledger, tax, approval, export, or permission mutation.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: repo standard; otherwise `String @id @default(cuid())`.
- Document sequence keys:
  - `manufacturing.bom`
  - `manufacturing.production_order`
  - `manufacturing.material_issue`
  - `manufacturing.production_receipt`
  - `mrp.run`
  - `warehouse.task`
- Route bases:
  - `/v1/companies/:companyId/manufacturing`
  - `/v1/companies/:companyId/mrp`
  - `/v1/companies/:companyId/warehouse`
- Default traceability policy: `NONE`.
- Default supply type: `PURCHASED`.
- Default planning policy: `NONE` unless reorder fields exist from item 05, then `REORDER_POINT`.
- Default production order release policy: manager/owner/planner release required when shortages exist.
- Default MRP horizon: 30 days.
- Default MRP suggestion stale window: 24 hours before conversion requires refresh warning or re-run.
- Default serial workflow: API/data model/manual table entry. Do not build one-by-one serial scan UI in first pass.
- Default MRP demand source: manual demand plan plus stock/reorder inputs. Sales and marketplace adapters stay unavailable until later phases/scopes.
- Default cycle-count approval: any variance requires approval unless company policy later sets threshold.
- Default costing mode: standard/planned cost snapshot when available; otherwise costing status `PENDING_POLICY`.
- Default expired/quarantined lot issue: blocked unless `warehouse.task.override` and reason are present.
- Default LINE/AI mutation response: refuse and deep-link to web.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect existing modules for inventory, procurement, ledger, reports, workflow, AI draft/suggestion, auth, audit, outbox, document sequence, attachments, request context, and permissions.
- [ ] Confirm inventory movement API/use case names, movement enum values, source reference fields, negative stock policy, transfer validation, reversal policy, and stock balance query ports.
- [ ] Confirm whether inventory already has lot/bin/serial hooks. If not, plan additive trace detail extension.
- [ ] Confirm procurement draft PR/PO creation APIs for MRP purchase suggestion conversion.
- [ ] Confirm ledger source adapter names, posting status writer contract, costing policy hooks, and period close policy.
- [ ] Confirm report dataset registry names if item 18 exists.
- [ ] Confirm AI draft/suggestion adapter names if item 17 exists.
- [ ] Confirm workflow/task/notification hooks if item 16 exists.
- [ ] Confirm current permission key registry and seed location.
- [ ] Confirm current web route registry, navigation pattern, API client, loader, table, form, drawer/modal, scanner-friendly UI primitives, dictionary/i18n, and error state primitives.
- [ ] Confirm current AI Gateway tool registration pattern if item 07 exists.
- [ ] Confirm current test commands for root, API, web, workers, contracts, config, and Prisma.
- [ ] Decide module split: one `manufacturing` module with MRP/warehouse subdomains, or separate `manufacturing`, `mrp`, and `warehouse` modules following repo conventions.
- [ ] Record conflicts or unavailable primitives in implementation notes before coding.

### Tests

- No code tests required unless reconciliation changes setup.

### Exit Criteria

- Implementer knows exact files to touch.
- Implementer knows whether to add or extend Prisma.
- Implementer knows inventory, procurement, ledger, reports, workflow, AI, audit, outbox, permission, and web integration points.
- No duplicate stock balance, vendor/purchase, ledger, report, workflow, or AI primitive plan remains unresolved.

## Phase 1: Contracts, Domain Model, and Pure Logic

### Goal

Create framework-free contracts and business logic before persistence and HTTP wiring.

### Tasks

- [ ] Add `packages/contracts/src/manufacturing.ts`.
- [ ] Export manufacturing contracts from `packages/contracts/src/index.ts`.
- [ ] Add API module folder(s), following current conventions:
  - `apps/api/src/modules/manufacturing/domain/models`
  - `apps/api/src/modules/manufacturing/domain/logic`
  - `apps/api/src/modules/manufacturing/domain/ports`
  - `apps/api/src/modules/manufacturing/application/use-cases`
  - `apps/api/src/modules/manufacturing/application/dto`
  - `apps/api/src/modules/manufacturing/infrastructure`
  - `apps/api/src/modules/manufacturing/presentation/http`
- [ ] If repo convention prefers separate modules, add `mrp` and `warehouse` modules with same hexagonal structure and shared contracts.
- [ ] Define enums and DTOs for product planning, BOM, BOM revision, component, work center, routing, production order, material issue, production receipt, lot/batch, zone/bin, warehouse task, MRP run, requirement, supply, suggestion, and costing source.
- [ ] Define domain errors with stable codes for forbidden, not found, duplicate code/sequence, invalid status transition, locked revision, BOM cycle, missing BOM, stale suggestion, shortage, negative stock, expired lot, quarantined lot, invalid bin, source dependency unavailable, procurement conversion failure, inventory failure, period closed, costing policy missing, and override required.
- [ ] Add pure logic:
  - BOM component validation
  - BOM cycle detection
  - BOM revision activation guard
  - BOM explosion
  - yield/scrap quantity calculation
  - production order status transitions
  - material issue eligibility
  - production receipt eligibility
  - production close eligibility
  - lot/serial policy validation
  - expiration/quarantine issue guard
  - bin transfer validation
  - cycle-count variance calculation
  - MRP demand/supply netting
  - lead-time offset calculation
  - reorder/min-max rounding
  - MRP pegging path generation
  - MRP stale conversion guard
  - standard/planned cost summary
  - source posting input mapping

### Tests

- `packages/contracts` typecheck.
- Domain unit tests for BOM validation and cycle detection.
- Domain unit tests for BOM explosion, yield, scrap, and required quantities.
- Domain unit tests for production status transitions and close guards.
- Domain unit tests for lot/serial/bin validation.
- Domain unit tests for MRP netting, lead time, safety stock, min/max, and pegging.
- Domain unit tests for costing summary and source posting mapping.

### Exit Criteria

- Contracts compile and export from shared package.
- Core business rules are testable without NestJS, Prisma, inventory API, procurement API, or web.
- Domain errors have stable codes usable by API and web.

## Phase 2: Database Model, Migrations, and Seeds

### Goal

Persist manufacturing/MRP/warehouse state using additive models and existing primitives.

### Tasks

- [ ] Extend existing Prisma schema or ORM model with additive manufacturing/MRP/warehouse tables.
- [ ] Link planning profiles to item 05 `Product`.
- [ ] Link warehouse zones/bins to item 05 `InventoryLocation`.
- [ ] Link `StockMovementTrace` to item 05 `StockMovement`.
- [ ] Add BOM, BOM revision, BOM component, work center, routing operation, production order, production component/output snapshot, material issue/line, production receipt/line, lot/batch, MRP run/requirement/supply/suggestion, warehouse zone/bin/task models.
- [ ] Add enums or constrained string fields according to repo convention.
- [ ] Add unique constraints:
  - product planning profile per company/product
  - BOM code per company
  - BOM revision code per BOM
  - work center code per company
  - zone/bin code per location
  - lot/serial uniqueness per company/product
  - document numbers per company where sequence exists
- [ ] Add indexes for company/status/date/product/location/bin/lot/source filters.
- [ ] Add permission seed entries and default role grants.
- [ ] Add document sequence seeds if Data Model Core sequence exists.
- [ ] Add default manufacturing/warehouse settings if config/settings primitive exists; otherwise use domain defaults and record settings backlog.
- [ ] Add migration and seed tests or smoke commands where repo supports them.

### Tests

- Prisma/schema validation.
- Migration generation/validation.
- Seed smoke test for permissions/sequences.
- Repository mapper unit tests if current repo style supports them.

### Exit Criteria

- Schema is additive and does not duplicate product, location, stock movement, supplier/procurement, ledger, report, audit, outbox, or AI primitives.
- Primary list/report screens have supporting indexes.
- Permission and sequence seeds are available.

## Phase 3: Product Planning, BOM, Work Center, and Routing

### Goal

Implement manufacturing setup records and BOM versioning.

### Tasks

- [ ] Implement product planning profile repository/query ports.
- [ ] Implement planning profile create/update/read use cases.
- [ ] Implement BOM create/update/list/detail use cases.
- [ ] Implement BOM revision draft/update/activate/archive/supersede use cases.
- [ ] Implement BOM cycle detection on activation.
- [ ] Implement component validation for stockable status, unit, duplicate line, quantity, substitute group, and archived product.
- [ ] Implement active/effective revision selector.
- [ ] Implement work center list/create/update/archive use cases.
- [ ] Implement routing operation create/update behavior tied to BOM revision drafts.
- [ ] Add audit/outbox for planning/BOM/routing changes.
- [ ] Add permission checks for planning/BOM/routing routes.

### Tests

- Planning profile validates product and default locations.
- BOM activation blocks direct and indirect cycles.
- Active revision is locked.
- New revision supersedes previous effective default revision according to policy.
- Archived product cannot be component or output in active BOM.
- Unauthorized BOM activation returns `403`.

### Exit Criteria

- Planner can set product planning fields, create BOM draft, activate revision, and read active BOM.
- Production and MRP phases can call BOM selector and explosion logic.

## Phase 4: Lot, Serial, Zone, Bin, and Traceability Foundation

### Goal

Add warehouse traceability primitives that reconcile with item 05 stock balance.

### Tasks

- [ ] Implement lot/batch/serial repository/query ports.
- [ ] Implement lot create/update/quarantine/unquarantine/archive use cases.
- [ ] Implement zone/bin create/update/archive use cases.
- [ ] Implement movement trace repository linked to inventory movement.
- [ ] Implement trace detail validation for lot policy, serial quantity, active bin, location ownership, and quantity sum.
- [ ] Implement bin balance and lot balance query ports derived from stock movements plus trace detail.
- [ ] Implement traceability forward/backward query ports by product, lot, serial, source document, and movement.
- [ ] Integrate trace validation into later movement adapters through ports.
- [ ] Add audit/outbox for lot/bin changes and high-risk lot overrides.

### Tests

- Lot uniqueness per company/product is enforced.
- Serial uniqueness per company/product is enforced.
- Expired/quarantined lot blocks issue without override.
- Trace line sum must equal movement quantity.
- Bin/lot balance reconciles to location balance for sample movements.
- Archived bin cannot receive new movement trace.

### Exit Criteria

- Lot/bin/traceability layer exists without editable balance source.
- Later production and warehouse phases can attach trace detail to inventory movements.

## Phase 5: Production Orders, Material Issue, and Output Receipt

### Goal

Implement production execution through inventory movement APIs.

### Tasks

- [ ] Implement production order create/update/list/detail.
- [ ] Implement production order release with BOM/routing snapshot, component/output snapshot, shortage check, and document sequence.
- [ ] Implement production order cancel policy.
- [ ] Implement material issue draft/post/void use cases.
- [ ] Material issue post calls inventory movement API/use case with outbound movement and source refs.
- [ ] Attach lot/bin trace detail to issue movement where required.
- [ ] Update production component issued quantities.
- [ ] Implement production receipt draft/post/void use cases.
- [ ] Production receipt post calls inventory movement API/use case with inbound movement and source refs.
- [ ] Create or link lot/batch/serial records for output where policy requires.
- [ ] Update production output received and scrap quantities.
- [ ] Implement production close with open draft/blocker checks.
- [ ] Implement inventory failure rollback/consistent error handling.
- [ ] Add audit/outbox for release, issue, receipt, scrap, close, cancel, and void.
- [ ] Add ledger period close checks before accounting-relevant issue/receipt/close/void.

### Tests

- Release snapshots active BOM and blocks missing BOM.
- Release warns/blocks shortage according to policy.
- Material issue creates outbound stock movement with `material_issue` source refs.
- Production receipt creates inbound stock movement with `production_receipt` source refs.
- Lot/serial/bin trace is required according to product policy.
- Negative stock issue blocks.
- Inventory failure rolls back issue/receipt or leaves no partial posted document.
- Close blocks when draft issue/receipt or blocked task exists.
- Closed period blocks issue/receipt/close when ledger hook exists.

### Exit Criteria

- Production order can move from draft to released to issued/received to closed through audited web/API workflow.
- No manufacturing code writes inventory balance directly.

## Phase 6: MRP Engine and Suggestion Conversion

### Goal

Implement deterministic, snapshot-based planning runs and reviewable suggestions.

### Tasks

- [ ] Implement MRP input collectors for product planning profile, on-hand inventory, open production orders, open purchase orders/supply from procurement, safety stock, lead time, and manual demand hooks.
- [ ] Add source adapter interfaces for sales/fulfillment/marketplace demand when those modules exist; mark unavailable sources explicitly.
- [ ] Implement MRP run create/start/list/detail.
- [ ] Persist requirement, supply, exception, pegging path, and suggestion rows.
- [ ] Implement BOM explosion for dependent demand.
- [ ] Implement netting, lead-time offset, reorder/min-max rounding, and exception generation.
- [ ] Implement suggestion review: accept, dismiss, expire.
- [ ] Implement suggestion conversion:
  - purchase suggestion -> procurement draft PR/PO through item 12 API/use case
  - produce suggestion -> production order draft
  - transfer/replenishment suggestion -> warehouse task or inventory transfer draft
- [ ] Re-check permissions, stale age, product status, source availability, and current balance before conversion.
- [ ] Add audit/outbox for MRP run and conversion.

### Tests

- MRP run produces reproducible rows from same input hash.
- BOM explosion creates dependent demand.
- Safety stock creates net requirement.
- Lead-time offset produces release-by date.
- Missing BOM creates exception, not silent zero.
- Purchase suggestion conversion uses procurement adapter and respects permission.
- Production suggestion conversion creates draft production order.
- Duplicate conversion is idempotent or blocked with stable error.
- Stale suggestion conversion requires refresh/re-run.

### Exit Criteria

- Planner can run MRP, review shortages/exceptions, and convert suggestions through approved source modules.
- MRP never creates final purchase/production/warehouse mutation without web review.

## Phase 7: Warehouse Tasks, Putaway, Pick, Replenishment, and Cycle Count

### Goal

Implement operational warehouse task queue and execution flows.

### Tasks

- [ ] Implement warehouse task create/list/detail/assign/start/block/cancel/complete use cases.
- [ ] Implement task generation adapters for goods receipt, production receipt, production material issue, inventory transfer, and MRP replenishment suggestions where source modules exist.
- [ ] Implement putaway task completion with lot/bin trace update and source movement link.
- [ ] Implement pick/production-pick completion with availability, lot policy, bin policy, and source movement link.
- [ ] Implement same-location bin transfer through allowed advanced warehouse movement path and trace detail.
- [ ] Implement replenishment task from reserve/bin to pick/bin location.
- [ ] Implement cycle-count create/count/approve/post adjustment.
- [ ] Cycle-count variance creates inventory count adjustment movement with lot/bin trace detail.
- [ ] Implement blocked task and override reason workflow.
- [ ] Add audit/outbox/notification hooks for task creation/completion/block/override and count variance.

### Tests

- Assigned task can be executed only by allowed user or manager override.
- Putaway validates destination bin and lot status.
- Pick validates available bin/lot quantity and blocks expired/quarantined lot without override.
- Bin transfer cannot use same source/destination bin.
- Replenishment updates bin trace without changing total location balance.
- Cycle-count variance creates count adjustment movement after approval.
- Task exception/override is audited with reason.

### Exit Criteria

- Warehouse manager can manage task queue.
- Inventory user can execute scanner-friendly task flows.
- Bin/lot balances reconcile after task completion.

## Phase 8: Costing, Ledger, Reports, Workflow, and Notifications

### Goal

Wire source outputs to downstream foundations without creating parallel systems.

### Tasks

- [ ] Implement manufacturing cost summary query from production order planned/issued/received quantities and standard/planned cost.
- [ ] Implement ledger source posting input adapters for material issue, production receipt, scrap, and variance.
- [ ] Implement posting status writer/reader integration if item 10 exists.
- [ ] Implement closed-period policy checks where not already wired.
- [ ] Register report/query datasets if item 18 dataset registry exists.
- [ ] Add notification hooks for shortages, blocked tasks, expiring lots, MRP failure, overdue production, and high-risk overrides.
- [ ] Add workflow trigger hooks if item 16 exists, without enabling unsafe final mutations.
- [ ] Add read models for production status, shortage report, MRP suggestion summary, warehouse task aging, expiring lots, bin balance, lot traceability, and cost summary.

### Tests

- Cost summary uses decimal-safe math.
- Ledger source payload includes source refs, quantities, cost values, product/location, and posting status.
- Closed period blocks accounting-relevant mutation.
- Missing ledger policy returns `PENDING_POLICY` or typed unavailable state.
- Report queries enforce permissions and source scope.
- Notification payload includes source refs and web links.

### Exit Criteria

- Downstream modules can read manufacturing/warehouse state through defined ports.
- No duplicate ledger/report/workflow/notification systems are created.

## Phase 9: Web UI

### Goal

Build complete web workflows for setup, planning, execution, review, and traceability.

### Tasks

- [ ] Add feature folder(s) under `apps/web/src/features` following current conventions.
- [ ] Add routes/navigation for Manufacturing, MRP Planning, and Warehouse inside existing workspace shell.
- [ ] Build product planning profile screen.
- [ ] Build BOM list/detail/revision editor with component table and activation flow.
- [ ] Build work center/routing setup screens.
- [ ] Build production order list/detail with release, issue, receipt, scrap, close, cost summary, traceability, audit/source refs, and status panels.
- [ ] Build MRP run setup/detail/suggestion review queue with accept/dismiss/convert.
- [ ] Build warehouse zone/bin setup.
- [ ] Build lot/batch/serial registry and traceability search.
- [ ] Build warehouse task queue and scanner-friendly task execution screen.
- [ ] Build cycle-count screen with variance approval path.
- [ ] Implement API client functions, loaders/actions, form validation, permissions-driven controls, empty/loading/error states, and deep links.
- [ ] Keep UI dense, operational, and consistent with existing design. Do not create landing/marketing pages.

### Tests

- Component/UI tests where current setup supports them.
- Manual or automated browser checks for key pages on desktop and mobile widths.
- Permission-state checks for hidden/disabled actions and backend `403` handling.
- Form validation checks for BOM, production issue/receipt, MRP run, task completion, and cycle count.

### Exit Criteria

- Target users can complete item 22 workflows from web without API-only gaps.
- Text fits, tables/actions are scannable, and task execution works in narrow viewport.

## Phase 10: Read-Only AI/LINE and Source Draft Hooks

### Goal

Expose safe summaries, explanations, and draft requests without final mutation.

### Tasks

- [ ] Add permission-checked read tools/API payloads for production summary, MRP suggestions, warehouse tasks, expiring lots, shortages, and traceability.
- [ ] Add AI Gateway tool registrations if item 07 integration exists.
- [ ] Add item 17 source evidence/draft adapters if AI draft/suggestion layer exists.
- [ ] Add LINE summary/deep-link responses if LINE assistant exists.
- [ ] Refuse LINE/AI mutation for BOM, production issue/receipt, MRP conversion, warehouse task completion, cycle-count approval, stock adjustment, cost posting, export, and permissions.
- [ ] Add source refs, redaction, and permission-denied responses.

### Tests

- AI read tool returns only permitted records and source refs.
- AI/LINE mutation request is refused with web deep link.
- Missing permission returns scoped denial without leaking data.
- Draft suggestion hooks create reviewable records only when item 17 exists and source permissions pass.

### Exit Criteria

- AI/LINE can explain manufacturing/warehouse state safely.
- No final business mutation is available through AI/LINE.

## Phase 11: Verification, Hardening, and Docs

### Goal

Verify behavior end-to-end and record implementation completion evidence.

### Tasks

- [ ] Run format/lint/typecheck/test commands for touched packages.
- [ ] Run database migration validation and seed smoke checks.
- [ ] Run API integration tests for production, MRP, and warehouse workflows.
- [ ] Run web build and browser smoke checks.
- [ ] Verify audit/outbox records for high-risk actions.
- [ ] Verify permission boundaries for Owner, Admin, Manager, Inventory, Finance, Accountant, Staff, and Auditor Readonly.
- [ ] Verify inventory movement immutability and derived balance reconciliation.
- [ ] Verify period close blocks accounting-relevant mutation where ledger exists.
- [ ] Verify AI/LINE mutation refusal.
- [ ] Update implementation notes with actual commands and any deferred gaps.
- [ ] Update Master Implementation Checklist item 22 only after all exit criteria pass.

### Tests

- Root/package test command set from current repo.
- Database migration/seed smoke.
- API integration tests.
- Web build/UI smoke.
- Permission/audit/AI refusal tests.

### Exit Criteria

- All planned tests pass or documented owner-approved exceptions exist.
- Master checklist links remain correct.
- Item 22 can be marked complete only after verified production/MRP/warehouse behavior works end to end.

## Risks

- Existing inventory movement model may not support lot/bin trace detail or same-location bin transfers. Resolve by extending movement details through inventory-owned use cases, not by direct balance writes.
- Existing procurement module may not expose draft PR/PO creation ports. Resolve by adding explicit adapter or typed unavailable state before MRP purchase conversion.
- Costing policy may not exist. Keep source posting payloads and `PENDING_POLICY` status rather than inventing journals.
- MRP can become slow on large datasets. Start with scoped horizons, indexed queries, saved run snapshots, and pagination.
- Lot/serial/bin rules can make UI complex. Keep first pass scanner-friendly and table-driven before hardware integrations.
- Branch/location/bin ABAC may be incomplete. Enforce server-side company and location scope first, then plug into stricter ABAC when available.

## Resolved Decisions and Backlog

Resolved first-pass decisions:

- Serial workflow: manual table entry plus API/data model support.
- Production costing: standard/planned cost snapshot only.
- MRP demand source: manual demand plan first.
- Cycle count approval: every variance requires approval.

Backlog:

- One-by-one serial scan UI and hardware/scanner optimization.
- Actual cost or weighted average manufacturing valuation after inventory valuation policy exists.
- Sales order demand adapter after manual demand plan; marketplace demand adapter after sales demand is stable.
- Configurable cycle-count approval threshold by quantity/value after real variance data exists.
