# Manufacturing, MRP, and Advanced Warehouse Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 22.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/manufacturing-mrp-warehouse-plan|Manufacturing, MRP, and Advanced Warehouse Plan]]

Owner decisions for first pass:

- Web is the only mutation surface for production orders, warehouse tasks, lot/batch changes, and MRP conversion.
- LINE and AI are read-only or draft/suggestion only. They cannot issue materials, receive finished goods, approve production, convert MRP, adjust stock, or override warehouse controls.
- Inventory stock movements remain the operational stock source of truth. Manufacturing and warehouse flows must create source-linked inventory movements instead of editing balances directly.
- MRP suggestions are deterministic planning outputs first. AI may explain or prioritize suggestions, but cannot silently create final purchase orders or production orders.
- Costing hooks are required, but full manufacturing cost accounting can remain pending until ledger costing policy exists.
- Serial number first pass supports API/data model/manual table entry. One-by-one serial scan UI is deferred.
- Manufacturing costing first pass uses standard/planned cost snapshots. Actual cost and weighted average valuation are deferred until inventory valuation policy exists.
- MRP first demand source beyond stock/reorder is manual demand plan. Sales order demand adapter is next; marketplace demand adapter follows later.
- Cycle count approval requires approval for every variance by default. Configurable quantity/value threshold is deferred.

## 2. Goal

Ship the first trustworthy manufacturing, MRP, and advanced warehouse layer for WatchDog-BMS:

- Bill of materials with version control and component validation.
- Optional lightweight routing and work-center metadata for future capacity planning.
- Production orders with release, material issue, output receipt, scrap, and close workflow.
- Lot, batch, serial, expiration, bin, zone, and warehouse task support where product policy requires it.
- Reorder planning and MRP runs that calculate material shortages from demand, supply, inventory, BOM explosion, lead time, safety stock, and lot constraints.
- Draft suggestions for purchase, transfer, replenishment, and production.
- Warehouse automation primitives: putaway, picking, packing-ready tasks, bin transfer, replenishment, and cycle count.
- Source-linked stock movement, audit, outbox, reporting, AI/LINE read, and ledger/tax/reporting hooks.

Item 22 must extend inventory rather than replace it. Product and stock movement records from item 05 stay foundational. Procurement purchase orders and goods receipts from item 12 remain purchase-side source documents. Ledger item 10 remains accounting source of truth after posting rules exist.

## 3. Non-goals

- Rebuilding item 05 inventory product/location/movement primitives.
- Rebuilding item 12 procurement supplier, PO, goods receipt, vendor bill, or AP workflow.
- Full MES, OEE, shop-floor telemetry, machine integration, IoT, barcode scanner hardware management, or robotics WMS.
- Finite capacity scheduling, advanced constraint optimization, labor scheduling, or detailed shop-floor dispatch.
- Quality management system, nonconformance/CAPA, laboratory inspection, or regulated traceability certification.
- External carrier booking, shipping labels, customs, freight rating, or transport management.
- EDI, supplier portal, customer portal, marketplace mutation, or bank transfer execution.
- Multi-plant intercompany manufacturing, subcontract manufacturing, consignment stock, or complex landed cost allocation.
- Automatic accounting entries without item 10 posting rules and costing policy.
- Direct LINE/AI mutation for production, warehouse, purchasing, approval, stock, tax, accounting, or permissions.

## 4. User Roles

- Owner: sees production readiness, stock risk, MRP shortages, high-risk overrides, costing exposure, and warehouse bottlenecks.
- Admin: configures manufacturing, warehouse, planning, lot/serial policy, bins, zones, work centers, and role grants.
- Production planner: manages BOMs, production orders, MRP runs, and planning suggestions.
- Warehouse manager: manages warehouse layout, task queues, pick/putaway/replenishment rules, cycle counts, and overrides.
- Inventory user: executes warehouse tasks, material issue, receipt, bin transfer, and cycle count within permission scope.
- Finance: reads production cost summaries, WIP candidates, variance candidates, and source posting status.
- Accountant: reviews costing policy, source posting inputs, period close blockers, and audit trail.
- Manager: approves production release, shortage overrides, scrap, and MRP conversion where policy grants.
- Staff: executes assigned warehouse or production tasks only.
- Auditor readonly: reads manufacturing, warehouse, MRP, stock traceability, source posting status, and audit records.
- AI assistant user: asks scoped read-only questions and receives explanations with source refs and web deep links.

## 5. Boundary and Ownership

Manufacturing owns:

- BOM, BOM revision, component line, byproduct/co-product hooks, and effectivity rules.
- Production routing, work center, operation metadata, and first-pass duration/capacity hints.
- Production order lifecycle, component reservation, material issue, output receipt, scrap, and close workflow.
- Production source documents that call inventory movement use cases with stable source refs.
- MRP demand/supply/suggestion records and conversion workflow.
- Manufacturing permissions, audit names, outbox events, and web module pages.

Advanced warehouse owns:

- Warehouse zones and bins below item 05 inventory locations.
- Lot, batch, serial, expiration, quarantine/hold, and allocation behavior.
- Warehouse task queue, assignment, execution, exception, and override workflow.
- Putaway, pick, pack-ready, bin transfer, replenishment, cycle-count task behavior.
- Bin/lot/serial traceability read models derived from movement detail and warehouse tasks.

Inventory item 05 owns:

- Product, location, base movement validation, immutable stock movement records, and location-level balance derivation.
- Negative stock policy and core stock read APIs.

Procurement item 12 owns supplier and purchase-side documents. Item 22 may convert MRP purchase suggestions into draft purchase requests or purchase orders only through item 12 APIs and permissions.

Ledger item 10 owns posting rules, journal generation, period close, and financial statements. Item 22 exposes source posting inputs and respects closed-period policy.

Reports item 18 owns report catalog and export infrastructure. Item 22 registers manufacturing/warehouse datasets when report primitives exist.

AI Draft/Suggestion item 17 owns generic AI suggestion persistence. Item 22 may provide source evidence and draft adapters but does not create a separate AI memory system.

## 6. Current Repository Baseline

Current docs snapshot on 2026-06-23 shows item 22 follows:

- Item 05 Inventory MVP, including product, location, immutable stock movement, derived stock balance, and QR labels.
- Item 10 Double-Entry Ledger and Period Closing, including posting-rule and closed-period policy hooks.
- Item 12 Procurement, Supplier, and AP, including PO, goods receipt, vendor bill, supplier payment, and procurement source refs.
- Item 17 AI Draft and Suggestion Layer, including reviewed draft/suggestion contracts.
- Item 18 Reports and BI, including dataset registry and controlled export behavior.

Before implementation, inspect latest code again. Items 01 through 21 may add Prisma, auth, request context, audit, outbox, document sequence, attachments, inventory movement APIs, procurement APIs, ledger source adapters, report dataset registry, workflow hooks, web shell routes, shared API clients, and permission registry.

## 7. Linked References

- Plan: [[plans/manufacturing-mrp-warehouse-plan|Manufacturing, MRP, and Advanced Warehouse Plan]]
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 22
- Inventory: [[specs/inventory-mvp-spec|Inventory MVP Spec]]
- Procurement/AP: [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
- Ledger: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
- Reports: [[specs/reports-bi-spec|Reports BI Spec]]
- AI Draft/Suggestion: [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
- Workflow automation: [[specs/workflow-automation-spec|Workflow Automation Spec]]
- Permission matrix: [[specs/permission-matrix|Permission Matrix]]
- Web shell: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Web guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Inventory balance ADR: [[adr/0003-inventory-stock-balance-source-of-truth|ADR 0003 Inventory Stock Balance Source of Truth]]
- Movement immutability ADR: [[adr/0004-inventory-movement-immutability|ADR 0004 Inventory Movement Immutability]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 8. Core Product Decisions

- Tenant boundary is `companyId`.
- Base inventory location remains item 05 `InventoryLocation`. Item 22 adds zones and bins inside a location.
- Product SKU remains unique per company. Manufacturing adds planning and traceability fields to product or an extension table.
- Only stockable products can be manufactured, lot-tracked, serial-tracked, or used in stock movement quantity changes.
- BOM revisions are versioned and immutable after activation. Corrections create a new revision.
- A product cannot have an active BOM cycle. BOM explosion must detect direct and indirect cycles.
- One default active BOM revision per manufactured product is allowed for a given effective date unless implementation adds alternate BOM policy.
- Production orders snapshot BOM revision, component quantities, yield assumptions, routing, and product planning data at release.
- Released and closed production orders cannot silently mutate component requirements or output quantities. Corrections use controlled issue, receipt, scrap, reversal, or adjustment workflows.
- Material issue and output receipt create inventory stock movements through inventory APIs/use cases.
- Component reservation is a planning allocation, not stock movement. Stock changes only on issue, receipt, transfer, count, or adjustment.
- Lot/batch/serial selection is required when product traceability policy requires it.
- Expired or quarantined lots cannot be issued unless override permission and reason are recorded.
- Bin-level movement cannot bypass location-level stock policy. Bin balances must reconcile to item 05 location balance.
- Same-location bin transfers are allowed only through warehouse module with source-linked paired movement detail and audit.
- Negative stock remains blocked by default.
- MRP runs are reproducible snapshots. Re-running does not mutate previous suggestions.
- MRP suggestions remain draft until a permitted user converts them from web into purchase request/order, transfer, replenishment, or production-order drafts.
- AI explanations may rank or explain MRP suggestions but deterministic rules remain source of plan math.
- Costing fields use decimal-safe values. First pass may use planned/standard cost snapshots and source posting hooks before full variance accounting exists.
- LINE and AI are read-only for manufacturing and warehouse records in item 22.

## 9. Business Workflow

### Manufacturing Setup

1. Admin or production planner confirms product planning fields: supply type, planning policy, lead time, safety stock, reorder quantity, lot policy, and default location.
2. Production planner creates BOM draft for a manufactured product.
3. Planner adds components, quantities, scrap factor, unit, optional substitute group, and effective date.
4. System validates product status, stockable flags, unit compatibility, duplicate lines, and BOM cycles.
5. Planner activates BOM revision. Activated revision is locked and becomes available for production orders and MRP.
6. Optional routing/work-center metadata is attached for future capacity visibility and basic planned dates.

### Production Order

1. Planner creates production order manually or converts an MRP suggestion.
2. System snapshots BOM/routing and calculates component requirements.
3. Planner reviews availability, shortage, lot/expiration warnings, and estimated cost.
4. Authorized user releases production order.
5. Inventory or production staff reserves or picks components through warehouse tasks when enabled.
6. Staff issues material to production. System creates outbound stock movements with lot/bin details.
7. Staff receives finished goods, byproducts, or co-products. System creates inbound stock movements with lot/bin details.
8. Staff records scrap or yield variance with reason.
9. Planner closes production order after required material issue, output receipt, and variance checks pass.
10. System emits source posting inputs and reporting events.

### MRP Planning

1. Planner starts MRP run for company, branch/location scope, horizon, and product filters.
2. System loads on-hand balance, lot/expiration availability, open supply, demand, BOM explosion, lead times, safety stock, reorder policy, and existing planned orders.
3. System produces deterministic gross/net requirements and suggestion rows.
4. Planner reviews shortages, pegging, due dates, lead-time violations, and exception messages.
5. Planner accepts, edits, dismisses, or converts suggestions from web.
6. Converted suggestions call source module APIs: procurement for purchase suggestions, manufacturing for production suggestions, inventory/warehouse for transfer or replenishment tasks.

### Advanced Warehouse

1. Admin configures warehouse zones and bins under existing inventory locations.
2. Warehouse manager configures putaway, picking, replenishment, and cycle-count rules with simple first-pass priorities.
3. Goods receipt, production receipt, or transfer-in creates putaway tasks when bin policy requires.
4. Production issue, stock issue, or fulfillment source creates pick tasks when bin/lot allocation is needed.
5. Staff executes assigned tasks on web scanner-friendly screens.
6. System validates product, lot, bin, quantity, hold/expiration policy, task status, permission, and available balance.
7. Successful task execution creates or links inventory movement records and updates task status.
8. Exceptions require override permission and reason.

## 10. Statuses and Enumerations

Product supply type:

```text
PURCHASED
MANUFACTURED
PURCHASED_OR_MANUFACTURED
```

Planning policy:

```text
NONE
REORDER_POINT
MIN_MAX
MRP
```

Traceability policy:

```text
NONE
LOT
BATCH_EXPIRY
SERIAL
```

BOM revision status:

```text
DRAFT
ACTIVE
ARCHIVED
SUPERSEDED
```

Production order status:

```text
DRAFT
PLANNED
RELEASED
IN_PROGRESS
PARTIALLY_RECEIVED
COMPLETED
CLOSED
CANCELLED
VOIDED
```

Material issue status:

```text
DRAFT
POSTED
VOIDED
```

Production receipt status:

```text
DRAFT
POSTED
VOIDED
```

MRP run status:

```text
DRAFT
RUNNING
COMPLETED
FAILED
VOIDED
```

MRP suggestion type:

```text
PURCHASE
PRODUCE
TRANSFER
REPLENISH_BIN
EXPEDITE
CANCEL_OR_RESCHEDULE
```

MRP suggestion status:

```text
OPEN
ACCEPTED
DISMISSED
CONVERTED
EXPIRED
```

Lot/batch status:

```text
ACTIVE
QUARANTINED
EXPIRED
CONSUMED
ARCHIVED
```

Warehouse task type:

```text
PUTAWAY
PICK
PACK_READY
BIN_TRANSFER
REPLENISHMENT
CYCLE_COUNT
PRODUCTION_PICK
PRODUCTION_PUTAWAY
```

Warehouse task status:

```text
OPEN
ASSIGNED
IN_PROGRESS
BLOCKED
COMPLETED
CANCELLED
VOIDED
```

Costing status:

```text
NOT_REQUIRED
PENDING_POLICY
PENDING
POSTED
POSTING_ERROR
REVERSED
```

## 11. Shared Contracts

Add or extend shared contracts under `packages/contracts/src`.

Recommended file:

```text
packages/contracts/src/manufacturing.ts
```

Export from:

```text
packages/contracts/src/index.ts
```

Minimum exported contract groups:

- `ProductPlanningSummary`
- `BomSummary`
- `BomRevisionSummary`
- `BomComponentSummary`
- `ProductionOrderSummary`
- `ProductionOrderComponentSummary`
- `ProductionOrderOutputSummary`
- `MaterialIssueSummary`
- `ProductionReceiptSummary`
- `MrpRunSummary`
- `MrpRequirementSummary`
- `MrpSuggestionSummary`
- `WarehouseZoneSummary`
- `WarehouseBinSummary`
- `LotBatchSummary`
- `WarehouseTaskSummary`
- `ManufacturingCostSummary`
- `ManufacturingPostingSource`

Shared contracts must use strings for money, quantities, decimals, and dates. Do not expose Prisma generated types, raw audit payloads, raw AI prompts, internal cost-rule internals, or unrestricted source-module data.

## 12. Data Model Draft

Use Prisma/PostgreSQL where repo has standardized on it. Prefer repo ID convention. If no convention exists, use `String @id @default(cuid())`.

### ProductPlanningProfile

Extension table for item 05 `Product`.

```text
ProductPlanningProfile
- id
- companyId
- productId
- supplyType
- planningPolicy
- traceabilityPolicy
- defaultProductionLocationId nullable
- defaultIssueLocationId nullable
- defaultReceiptLocationId nullable
- leadTimeDays decimal
- safetyStockQuantity decimal nullable
- reorderPointQuantity decimal nullable
- reorderQuantity decimal nullable
- minQuantity decimal nullable
- maxQuantity decimal nullable
- yieldPercent decimal nullable
- standardCost decimal nullable
- status
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,productId
- index companyId,supplyType,planningPolicy
```

### Bom

```text
Bom
- id
- companyId
- productId
- code
- name
- status
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,code
- index companyId,productId,status
```

### BomRevision

```text
BomRevision
- id
- companyId
- bomId
- revisionCode
- status
- effectiveFrom nullable
- effectiveTo nullable
- outputQuantity decimal
- outputUnit
- scrapFactorPercent decimal nullable
- notes nullable
- activatedAt nullable
- activatedByUserId nullable
- createdByUserId
- createdAt
- updatedAt
- unique companyId,bomId,revisionCode
- index companyId,status,effectiveFrom
```

Rules:

- Draft revision can be edited.
- Active/superseded revision is locked.
- Activation validates no component cycle.
- Only one active default revision per product/effective date is allowed.

### BomComponent

```text
BomComponent
- id
- companyId
- bomRevisionId
- componentProductId
- lineNumber
- quantity decimal
- unit
- scrapPercent decimal nullable
- issueLocationId nullable
- substituteGroup nullable
- isOptional boolean
- notes nullable
- unique companyId,bomRevisionId,lineNumber
- index companyId,componentProductId
```

### WorkCenter

```text
WorkCenter
- id
- companyId
- code
- name
- branchId nullable
- locationId nullable
- status
- capacityUnit nullable
- defaultCapacityPerDay decimal nullable
- createdAt
- updatedAt
- unique companyId,code
```

### ProductionRoutingOperation

```text
ProductionRoutingOperation
- id
- companyId
- bomRevisionId
- sequenceNumber
- workCenterId nullable
- name
- plannedDurationMinutes decimal nullable
- setupMinutes decimal nullable
- notes nullable
- unique companyId,bomRevisionId,sequenceNumber
```

### ProductionOrder

```text
ProductionOrder
- id
- companyId
- orderNumber nullable
- productId
- bomRevisionId nullable
- status
- plannedQuantity decimal
- completedQuantity decimal
- scrappedQuantity decimal
- unit
- priority
- plannedStartDate nullable
- plannedDueDate nullable
- releaseDate nullable
- closeDate nullable
- issueLocationId nullable
- receiptLocationId nullable
- branchId nullable
- sourceType nullable
- sourceId nullable
- mrpSuggestionId nullable
- costingStatus
- postingStatus
- createdByUserId
- releasedByUserId nullable
- closedByUserId nullable
- createdAt
- updatedAt
- unique companyId,orderNumber where orderNumber is not null
- index companyId,status,plannedDueDate
- index companyId,productId,status
- index companyId,sourceType,sourceId
```

### ProductionOrderComponent

Snapshot of requirements at production order release.

```text
ProductionOrderComponent
- id
- companyId
- productionOrderId
- componentProductId
- bomComponentId nullable
- requiredQuantity decimal
- reservedQuantity decimal
- issuedQuantity decimal
- scrappedQuantity decimal
- unit
- issueLocationId nullable
- traceabilityPolicy
- substituteGroup nullable
- lineNumber
- unique companyId,productionOrderId,lineNumber
- index companyId,componentProductId
```

### ProductionOrderOutput

```text
ProductionOrderOutput
- id
- companyId
- productionOrderId
- productId
- outputType: PRIMARY | BYPRODUCT | COPRODUCT
- plannedQuantity decimal
- receivedQuantity decimal
- scrappedQuantity decimal
- unit
- receiptLocationId nullable
- traceabilityPolicy
- lineNumber
- unique companyId,productionOrderId,lineNumber
```

### LotBatch

```text
LotBatch
- id
- companyId
- productId
- lotNumber
- batchNumber nullable
- serialNumber nullable
- status
- manufactureDate nullable
- expirationDate nullable
- supplierId nullable
- sourceType nullable
- sourceId nullable
- notes nullable
- createdByUserId
- createdAt
- updatedAt
- unique companyId,productId,lotNumber where lotNumber is not null
- unique companyId,productId,serialNumber where serialNumber is not null
- index companyId,productId,status,expirationDate
```

Rules:

- Serial-tracked products require one serial per unit.
- Lot/batch products require lot or batch value on inbound movement.
- Expired/quarantined lot issue requires override permission and reason.

### WarehouseZone

```text
WarehouseZone
- id
- companyId
- locationId
- code
- name
- status
- createdAt
- updatedAt
- unique companyId,locationId,code
```

### WarehouseBin

```text
WarehouseBin
- id
- companyId
- locationId
- zoneId nullable
- code
- name nullable
- binType
- status
- capacityQuantity nullable
- capacityUnit nullable
- pickSequence nullable
- createdAt
- updatedAt
- unique companyId,locationId,code
- index companyId,locationId,status
- index companyId,zoneId
```

### StockMovementTrace

Extension detail for item 05 `StockMovement`.

```text
StockMovementTrace
- id
- companyId
- stockMovementId
- productId
- locationId
- fromBinId nullable
- toBinId nullable
- lotBatchId nullable
- serialNumber nullable
- quantity decimal
- sourceType nullable
- sourceId nullable
- createdAt
- index companyId,stockMovementId
- index companyId,productId,locationId,lotBatchId
- index companyId,fromBinId
- index companyId,toBinId
```

Rules:

- Sum of trace quantities must equal parent movement quantity for traced movements.
- Bin/lot balance read models derive from `StockMovement` plus `StockMovementTrace`.
- Do not create editable bin or lot balance as source of truth. Cached projections are rebuildable only.

### MaterialIssue

```text
MaterialIssue
- id
- companyId
- issueNumber nullable
- productionOrderId
- status
- issueDate
- postedAt nullable
- postedByUserId nullable
- voidedAt nullable
- voidedByUserId nullable
- reason nullable
- createdByUserId
- createdAt
- updatedAt
- unique companyId,issueNumber where issueNumber is not null
- index companyId,productionOrderId,status
```

### MaterialIssueLine

```text
MaterialIssueLine
- id
- companyId
- materialIssueId
- productionOrderComponentId
- productId
- locationId
- binId nullable
- lotBatchId nullable
- quantity decimal
- unit
- stockMovementId nullable
- lineNumber
- unique companyId,materialIssueId,lineNumber
```

### ProductionReceipt

```text
ProductionReceipt
- id
- companyId
- receiptNumber nullable
- productionOrderId
- status
- receiptDate
- postedAt nullable
- postedByUserId nullable
- voidedAt nullable
- voidedByUserId nullable
- reason nullable
- createdByUserId
- createdAt
- updatedAt
- unique companyId,receiptNumber where receiptNumber is not null
- index companyId,productionOrderId,status
```

### ProductionReceiptLine

```text
ProductionReceiptLine
- id
- companyId
- productionReceiptId
- productionOrderOutputId
- productId
- locationId
- binId nullable
- lotBatchId nullable
- quantity decimal
- scrapQuantity decimal
- unit
- stockMovementId nullable
- lineNumber
- unique companyId,productionReceiptId,lineNumber
```

### MrpRun

```text
MrpRun
- id
- companyId
- runNumber nullable
- status
- horizonStartDate
- horizonEndDate
- locationScope nullable
- productScope nullable
- inputHash
- startedAt nullable
- completedAt nullable
- failedAt nullable
- failedReason nullable
- createdByUserId
- createdAt
- unique companyId,runNumber where runNumber is not null
- index companyId,status,createdAt
```

### MrpRequirement

```text
MrpRequirement
- id
- companyId
- mrpRunId
- productId
- locationId nullable
- requirementDate
- requirementType
- grossQuantity decimal
- availableQuantity decimal
- netQuantity decimal
- sourceType nullable
- sourceId nullable
- parentRequirementId nullable
- peggingPath nullable
- index companyId,mrpRunId,productId,requirementDate
```

### MrpSupply

```text
MrpSupply
- id
- companyId
- mrpRunId
- productId
- locationId nullable
- supplyDate
- supplyType
- quantity decimal
- sourceType nullable
- sourceId nullable
- index companyId,mrpRunId,productId,supplyDate
```

### MrpSuggestion

```text
MrpSuggestion
- id
- companyId
- mrpRunId
- suggestionType
- status
- productId
- locationId nullable
- quantity decimal
- dueDate
- releaseByDate nullable
- sourceRequirementId nullable
- reasonCode
- explanation
- convertedSourceType nullable
- convertedSourceId nullable
- reviewedByUserId nullable
- reviewedAt nullable
- createdAt
- index companyId,mrpRunId,status
- index companyId,productId,dueDate
```

### WarehouseTask

```text
WarehouseTask
- id
- companyId
- taskNumber nullable
- taskType
- status
- priority
- productId nullable
- quantity decimal nullable
- fromLocationId nullable
- toLocationId nullable
- fromBinId nullable
- toBinId nullable
- lotBatchId nullable
- sourceType nullable
- sourceId nullable
- assignedToUserId nullable
- startedAt nullable
- completedAt nullable
- completedByUserId nullable
- exceptionCode nullable
- exceptionReason nullable
- createdByUserId nullable
- createdAt
- updatedAt
- unique companyId,taskNumber where taskNumber is not null
- index companyId,status,priority
- index companyId,assignedToUserId,status
- index companyId,sourceType,sourceId
```

## 13. MRP Calculation Rules

- MRP run reads only committed snapshot inputs for its run. Save input hash for reproducibility.
- Demand sources may include reorder point/min-max shortage, sales/fulfillment demand when a source adapter exists, production component demand, safety stock, and manual demand adjustments.
- Supply sources may include on-hand available balance, open purchase orders, open production orders, transfer-in, and planned supply already converted from previous suggestions.
- Lot availability excludes expired, quarantined, consumed, archived, and held quantities unless override mode is explicitly selected for planning review.
- BOM explosion uses active effective BOM revision for manufactured products.
- Purchased products create purchase suggestions unless supply type allows manufacturing and active BOM exists.
- Manufactured products create production suggestions when active BOM exists.
- Missing BOM for manufactured product creates exception suggestion, not silent zero demand.
- Lead-time calculation uses product planning lead time, supplier lead time when available, production lead time, and warehouse handling time where available.
- Safety stock is treated as demand inside the planning horizon.
- Reorder quantity/min/max rounds suggestions according to product policy.
- MRP must not create purchase orders, production orders, or warehouse tasks without explicit web conversion.
- MRP conversion re-checks permissions, current source state, product status, lot/bin policy, and stale suggestion age.

## 14. Inventory Movement Rules

- Material issue creates outbound stock movements with `referenceType = material_issue` and `referenceId = MaterialIssue.id`.
- Production receipt creates inbound stock movements with `referenceType = production_receipt` and `referenceId = ProductionReceipt.id`.
- Warehouse bin transfer creates paired movement details and source-linked stock movements. If item 05 transfer validation blocks same-location transfers, item 22 must extend inventory movement use cases in a documented way rather than writing balances directly.
- Putaway task links to goods receipt, production receipt, or transfer-in movement and records bin placement detail.
- Pick task links to material issue, stock issue, or fulfillment source and records lot/bin consumption detail.
- Cycle-count variance creates count adjustment movements with lot/bin trace detail.
- Every movement request validates active product, active location, active bin, lot policy, available balance, negative stock policy, permission, source status, and closed-period policy.
- Posted movements are immutable. Corrections use reversal/void policy or adjustment source documents.

## 15. Costing and Ledger Rules

- First pass must expose deterministic costing source inputs even when journal generation remains pending.
- Production order stores planned component cost snapshot when standard cost is available.
- Material issue source posting input should include component product, quantity, planned/standard cost, location, production order, and WIP candidate account hint where policy exists.
- Production receipt source posting input should include finished product, quantity, planned/standard cost, output location, production order, and finished goods account hint where policy exists.
- Scrap and variance source inputs must be explicit and auditable.
- If ledger costing policy is absent, set costing/posting status to `PENDING_POLICY` or `NOT_REQUIRED` according to current repo contract. Do not invent silent journal entries.
- If accounting period is closed, production issue, receipt, scrap, close, void, and cost posting must call item 10 close policy and fail unless policy allows.
- Costing math must use decimal-safe operations.

## 16. API Behavior

Base route convention:

```text
/v1/companies/:companyId/manufacturing
/v1/companies/:companyId/warehouse
/v1/companies/:companyId/mrp
```

Route `companyId` is a selection hint only. Backend must verify active membership, role/permission, company scope, branch/location/bin ABAC, and source record scope from server-side request context.

### Manufacturing Setup

```text
GET    /manufacturing/product-planning
PATCH  /manufacturing/products/:productId/planning
GET    /manufacturing/boms
POST   /manufacturing/boms
GET    /manufacturing/boms/:bomId
POST   /manufacturing/boms/:bomId/revisions
PATCH  /manufacturing/bom-revisions/:revisionId
POST   /manufacturing/bom-revisions/:revisionId/activate
POST   /manufacturing/bom-revisions/:revisionId/archive
GET    /manufacturing/work-centers
POST   /manufacturing/work-centers
PATCH  /manufacturing/work-centers/:workCenterId
```

### Production Orders

```text
GET    /manufacturing/production-orders
POST   /manufacturing/production-orders
GET    /manufacturing/production-orders/:productionOrderId
PATCH  /manufacturing/production-orders/:productionOrderId
POST   /manufacturing/production-orders/:productionOrderId/release
POST   /manufacturing/production-orders/:productionOrderId/cancel
POST   /manufacturing/production-orders/:productionOrderId/close
POST   /manufacturing/production-orders/:productionOrderId/material-issues
POST   /manufacturing/production-orders/:productionOrderId/receipts
GET    /manufacturing/production-orders/:productionOrderId/cost-summary
GET    /manufacturing/production-orders/:productionOrderId/traceability
```

### MRP

```text
GET    /mrp/runs
POST   /mrp/runs
GET    /mrp/runs/:mrpRunId
POST   /mrp/runs/:mrpRunId/start
GET    /mrp/runs/:mrpRunId/requirements
GET    /mrp/runs/:mrpRunId/supplies
GET    /mrp/runs/:mrpRunId/suggestions
POST   /mrp/suggestions/:suggestionId/accept
POST   /mrp/suggestions/:suggestionId/dismiss
POST   /mrp/suggestions/:suggestionId/convert
```

### Warehouse

```text
GET    /warehouse/zones
POST   /warehouse/zones
PATCH  /warehouse/zones/:zoneId
GET    /warehouse/bins
POST   /warehouse/bins
PATCH  /warehouse/bins/:binId
GET    /warehouse/lots
POST   /warehouse/lots
PATCH  /warehouse/lots/:lotBatchId
GET    /warehouse/tasks
POST   /warehouse/tasks
GET    /warehouse/tasks/:taskId
POST   /warehouse/tasks/:taskId/assign
POST   /warehouse/tasks/:taskId/start
POST   /warehouse/tasks/:taskId/complete
POST   /warehouse/tasks/:taskId/block
POST   /warehouse/tasks/:taskId/cancel
POST   /warehouse/bin-transfer
POST   /warehouse/cycle-count
GET    /warehouse/traceability
GET    /warehouse/bin-balances
GET    /warehouse/lot-balances
```

List routes support search, status filters, date filters, product/location/bin filters, pagination, and stable sorting. Mutation routes return stable error codes for forbidden, not found, stale state, closed period, missing BOM, BOM cycle, shortage, expired lot, quarantined lot, invalid bin, invalid status transition, posting unavailable, source dependency unavailable, and duplicate sequence.

## 17. Permission Contract

Use keys from [[specs/permission-matrix|Permission Matrix]]. If item 02 already implemented a stricter registry, add aliases or update this spec before coding.

Core keys:

```text
manufacturing.product-planning.read
manufacturing.product-planning.manage
manufacturing.bom.read
manufacturing.bom.manage
manufacturing.bom.activate
manufacturing.routing.read
manufacturing.routing.manage
manufacturing.production-order.read
manufacturing.production-order.create
manufacturing.production-order.update
manufacturing.production-order.release
manufacturing.production-order.issue-material
manufacturing.production-order.receive-output
manufacturing.production-order.scrap
manufacturing.production-order.close
manufacturing.production-order.void
manufacturing.cost.read
manufacturing.cost.review
mrp.run.read
mrp.run.create
mrp.run.execute
mrp.suggestion.review
mrp.suggestion.convert
warehouse.zone-bin.read
warehouse.zone-bin.manage
warehouse.lot.read
warehouse.lot.manage
warehouse.task.read
warehouse.task.create
warehouse.task.assign
warehouse.task.execute
warehouse.task.override
warehouse.cycle-count.create
warehouse.cycle-count.approve
warehouse.traceability.read
```

Sensitive actions:

- BOM activation/archive after use.
- Production order release, material issue, output receipt, scrap, close, cancel, and void.
- Lot quarantine/unquarantine and expired/quarantined lot override.
- Bin transfer override, cycle-count approval, and stock adjustment from warehouse count.
- MRP run execution and suggestion conversion.
- Cost review and posting-status changes.
- Traceability export if export infrastructure exists.

## 18. UI Behavior

### Web

Main navigation groups:

- Manufacturing
- MRP Planning
- Warehouse

Manufacturing screens:

- Product planning profile list/detail.
- BOM list/detail with revision tabs, component editor, cycle validation messages, and activation action.
- Work center and routing setup.
- Production order board/list/detail with status chips, shortage panel, component requirements, material issue tab, receipt tab, scrap/variance panel, cost summary, audit/activity, and source refs.

MRP screens:

- Run setup form with horizon, location scope, product filters, demand sources, and planning mode.
- Run result detail with requirement table, supply table, suggestions, exception messages, pegging path, and stale-input warning.
- Suggestion review queue with accept/dismiss/convert actions and source deep links.

Warehouse screens:

- Location/zone/bin setup inside existing inventory workspace.
- Lot/batch/serial registry and traceability search.
- Task queue with filters for assigned/open/blocked, priority, source type, location, bin, lot, and due date.
- Scanner-friendly task execution screen with product, quantity, from/to bin, lot/serial, exception reason, and confirm action.
- Cycle count flow with counted quantity, expected quantity after permission check, variance reason, and approval state when required.

UI must reuse existing app shell, shared components, API client, CSS module patterns, and error/loading/empty states. Do not create marketing landing pages for this module.

### LINE

Allowed:

- Read-only summaries: production due soon, shortages, open MRP suggestions, warehouse blocked tasks, expiring lots, low stock by location, and production order status.
- Source references and web deep links.
- Permission denial messages.

Not allowed:

- BOM edits or activation.
- Production release, issue, receipt, scrap, close, void, or approval.
- MRP run execution or suggestion conversion.
- Warehouse task completion, bin transfer, lot quarantine, cycle-count approval, or stock adjustment.
- Cost posting or ledger/tax/report export.

### AI

Allowed:

- Explain MRP suggestion reasons with source refs.
- Summarize production and warehouse bottlenecks.
- Suggest draft planning actions through item 17 review flow where available.
- Answer traceability questions from permission-checked read tools.

Blocked:

- Final mutation in manufacturing, warehouse, inventory, procurement, ledger, tax, approval, export, or permission modules.
- Direct database access by AI Gateway.
- Creating or converting MRP suggestions without web review and source-module permissions.

## 19. Audit, Outbox, and Notifications

Audit events:

- Product planning update.
- BOM create/update/activate/archive.
- Work center/routing update.
- Production order create/update/release/cancel/close/void.
- Material issue post/void.
- Production receipt post/void.
- Scrap/variance record.
- MRP run create/start/complete/fail.
- MRP suggestion accept/dismiss/convert.
- Zone/bin create/update/archive.
- Lot create/update/quarantine/unquarantine/archive.
- Warehouse task create/assign/start/complete/block/cancel/override.
- Cycle count create/approve/post adjustment.
- Cost review/posting status update.

Outbox events:

- `manufacturing.bom.activated`
- `manufacturing.production_order.released`
- `manufacturing.material_issue.posted`
- `manufacturing.production_receipt.posted`
- `manufacturing.production_order.closed`
- `mrp.run.completed`
- `mrp.suggestion.converted`
- `warehouse.task.created`
- `warehouse.task.completed`
- `warehouse.lot.expiring`
- `warehouse.cycle_count.variance_posted`

Notifications:

- Shortage before production release.
- Overdue production order.
- Production receipt variance.
- Blocked warehouse task.
- Expiring lot.
- MRP run failed.
- High-risk override performed.

## 20. Reporting and Read Models

Required read models or query ports:

- Production order status summary.
- Component shortage report.
- Planned vs issued vs received production variance.
- MRP suggestion summary by type/status/due date.
- Lot traceability forward/backward search.
- Bin balance by product/location/bin/lot.
- Warehouse task aging and blocked-task summary.
- Expiring lot summary.
- Production cost summary and posting status.

Reports/BI integration should register datasets only if item 18 registry exists. Missing report module must not block core item 22 behavior.

## 21. Edge Cases

- BOM activation would create cycle.
- BOM revision is active and user tries to edit component quantity.
- Product is manufactured but no active BOM exists.
- Component or output product is archived.
- Component shortage at release or issue.
- Negative stock would result from issue/pick/cycle-count adjustment.
- Lot expired, quarantined, wrong product, wrong location, or insufficient quantity.
- Serial-tracked product quantity is not one per serial row.
- Bin transfer source and destination are same bin.
- Same-location bin transfer conflicts with item 05 transfer validation.
- MRP run has stale demand/supply after source records change.
- Suggestion conversion repeats after already converted.
- Production order close while open material issue, receipt draft, blocked task, or variance review exists.
- Period close blocks material issue or receipt.
- Inventory movement API unavailable or returns partial failure.
- Procurement API unavailable when converting purchase suggestion.
- Ledger costing policy absent.
- AI request lacks source permission.

## 22. Acceptance Criteria

- [ ] BOM revisions can be drafted, validated, activated, locked, superseded, and used by production orders.
- [ ] BOM cycle detection blocks direct and indirect recursion.
- [ ] Product planning profile supports supply type, planning policy, lead time, safety stock, reorder, traceability, and cost hooks.
- [ ] Production order release snapshots BOM and validates shortages.
- [ ] Material issue creates immutable outbound stock movements with source refs and trace details.
- [ ] Production receipt creates immutable inbound stock movements with source refs and trace details.
- [ ] Lot/batch/serial rules are enforced on inbound and outbound movements.
- [ ] Warehouse zones/bins/tasks support putaway, pick, bin transfer, replenishment, and cycle count.
- [ ] Bin and lot balances reconcile to item 05 location-level stock balances.
- [ ] MRP run creates reproducible requirements, supplies, exceptions, and suggestions.
- [ ] MRP suggestion conversion re-checks permissions and source state and creates only draft/review source records.
- [ ] Costing/posting source inputs exist and respect ledger closed-period policy when item 10 exists.
- [ ] Web screens cover setup, execution, review, exceptions, and traceability.
- [ ] LINE and AI read-only behavior refuses final mutation and returns web deep links.
- [ ] Permissions, audit, outbox, and tests cover high-risk actions.

## 23. Test Cases

- Unit: BOM cycle detection, component explosion, required quantity calculation, yield/scrap math, and revision activation guards.
- Unit: MRP net requirement, lead-time offset, safety stock, reorder/min-max rounding, pegging, and stale suggestion guard.
- Unit: lot/serial validation, expiration/quarantine policy, bin transfer validation, and cycle-count variance.
- Unit: production status transitions, close eligibility, costing summary, and source posting payload mapping.
- Integration: material issue creates inventory movement through inventory port and rolls back on failure.
- Integration: production receipt creates lot/bin trace detail and output movement.
- Integration: MRP purchase suggestion conversion calls procurement draft API with permission checks.
- Integration: period close blocks issue/receipt/close when ledger hook exists.
- API: each mutation enforces company membership, permission, branch/location/bin scope, source status, and stable error codes.
- UI: BOM editor, production order release/issue/receipt, MRP review queue, warehouse task execution, and traceability search.
- Permission: inventory staff can execute assigned tasks but cannot activate BOM or convert MRP unless granted.
- AI/LINE: read summaries include source refs; mutation requests are refused.
- Edge: expired lot issue override requires permission and reason; duplicate conversion is idempotent or blocked.

## 24. Resolved Decisions and Backlog

Resolved first-pass decisions:

- Serial number workflow uses API/data model/manual table entry first.
- Costing uses standard/planned cost snapshots first.
- MRP first demand source is manual demand plan.
- Cycle count approval is required for every variance by default.

Backlog:

- Add one-by-one serial scan UI and hardware/scanner optimization after manual serial table works.
- Add actual cost or weighted average manufacturing valuation after inventory valuation policy exists.
- Add sales order demand adapter after manual demand plan; add marketplace demand adapter after sales demand is stable.
- Add configurable cycle-count approval threshold by quantity/value after real variance data exists.
