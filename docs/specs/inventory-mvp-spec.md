# Inventory MVP Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 05.

Active implementer target: Sonnet 4.6 or later.

## 2. Goal

Allow SME users to manage product master data, stock locations, immutable stock movements, movement-derived stock balance, internal QR labels, and web scan/action flows with enough auditability that stock levels can be trusted.

Inventory MVP turns stock movement records into the operational source of truth for later dashboard, notification, LINE AI read-only answers, procurement, sales, accounting, reports, and warehouse expansion work.

CRM customer publication, sale price, and service booking duration extend this same Product master through [[specs/crm-product-service-catalog-spec|CRM Product and Service Catalog Spec]]; CRM must not create a duplicate catalog table.

## 3. Non-goals

- Advanced warehouse automation, bin optimization, wave picking, or dedicated scanner hardware integration.
- Manufacturing, bill of materials, production orders, MRP, lot/batch cost accounting, or landed cost.
- Full inventory valuation, COGS posting, or ledger integration beyond explicit future hooks.
- Offline stock operation queue, delayed sync, or conflict resolution.
- Purchase order, goods receipt, vendor bill, or supplier/AP workflow.
- Marketplace import, sales channel sync, or POS integration.
- Configurable negative-stock/backorder policy.
- Direct inventory mutation from LINE or AI Gateway.
- GS1 Digital Link as the default label standard.

## 4. User Roles

- Owner: reviews stock status, low-stock signals, and audit trail.
- Admin: manages product master data, stock locations, internal labels, and module settings.
- Inventory staff: records stock-in, stock-out, transfer, count adjustment, and stock adjustment on web.
- Manager: reads stock status, movement history, and operational exceptions where ABAC allows.
- Finance/accountant: reads inventory transaction summaries for reconciliation and later accounting links.
- Auditor readonly: reads products, locations, movements, and audit history without mutation.
- AI assistant user: asks read-only inventory questions through permission-checked tools and receives web deep links.

## 5. Boundary and Ownership

Inventory owns:

- Product master records for stockable and non-stockable sellable items used by later modules.
- Product barcode aliases and internal QR label payloads.
- Inventory location records separate from company branch records.
- Stock movement creation, validation, immutability, movement history, and derived balance reads.
- Internal stock action flows: receive, issue, transfer, count adjustment, and manual adjustment.
- Inventory permissions, audit action names, and outbox events for stock source records.
- Web inventory pages under the workspace shell.

Data Model Core owns:

- `Company`, `Branch`, `CompanyMembership`, attachment, document sequence, audit, and outbox primitives.
- Membership branch scope and request context primitives.
- Document sequence key `inventory.movement` if item 04 implemented it.

Auth/RBAC owns:

- User/session identity.
- Membership, role, permission, and deny-by-default route behavior.
- Request context and permission guard.
- Audit append interface if already implemented by item 02.

Dashboard, notification, LINE AI, procurement, sales, accounting, reports, and warehouse modules own later workflows that read inventory records or create stock movements through Inventory-owned use cases.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service with health module and security guard skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/web`: Next.js App Router shell with `platform-foundation` feature example, CSS Modules, and shared common components.
- `packages/contracts`: shared TypeScript contract package exists and is currently thin.
- `apps/workers`: TypeScript worker shell only.
- No Prisma schema exists in this snapshot.
- ADR 0006 chooses Prisma, PostgreSQL, Redis/BullMQ, S3-compatible storage, NestJS hexagonal modules, and shared TypeScript contracts.
- Items 01 through 04 may add Prisma, auth, audit, outbox, request context, branch scope, shared HTTP client, web shell, and common UI before item 05 starts.

Implementation must inspect current code before editing. If Prisma/auth/audit/outbox/web shell already exists, extend it. Do not create duplicate tenant, branch, audit, outbox, HTTP client, or UI primitives.

## 7. Linked Plan and References

- Plan: [[plans/inventory-mvp-plan|Inventory MVP Plan]]
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 05.
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Web shell: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- LINE UX: [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
- AI Gateway: [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Web guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Negative stock ADR: [[adr/0002-inventory-negative-stock-policy|ADR 0002 Inventory Negative Stock Policy]]
- Balance source ADR: [[adr/0003-inventory-stock-balance-source-of-truth|ADR 0003 Inventory Stock Balance Source of Truth]]
- Movement immutability ADR: [[adr/0004-inventory-movement-immutability|ADR 0004 Inventory Movement Immutability]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 8. Product Decisions

- Tenant boundary is `companyId`.
- Branch and inventory location are different concepts. Inventory location may optionally reference `branchId`, but stock balance is scoped by `locationId`.
- Product SKU is unique per company.
- Location code is unique per company.
- Product barcode value is unique per company so scan/lookup never resolves ambiguously.
- Internal QR is the default MVP label standard.
- Supplier barcodes may be stored and searched as aliases, but internal operations use WatchDog internal QR.
- Negative stock is blocked by default.
- Stock balance is derived from stock movements. Do not expose direct balance mutation.
- Stock movement records are immutable after creation.
- Corrections use adjustment movements in MVP.
- Reversal movement fields may be included now, but reversal UI can wait until after MVP unless implementation cost is low.
- Stock count is represented as count adjustment movement records in MVP, not a separate count document workflow.
- Web is the only stock mutation surface in MVP.
- LINE and AI Gateway are read-only for inventory MVP.
- Inventory valuation and ledger posting are deferred, but movement records must keep future costing hooks explicit and nullable.

## 9. Core Rules

- Every stock change creates one or more `StockMovement` records.
- `StockMovement` update/delete routes must not exist for normal product behavior.
- Quantity input must be greater than zero.
- All movement creation validates tenant, active membership, permission, product status, location status, quantity, and negative-stock policy server-side.
- Stock-out, transfer-out, count-adjustment-out, and adjustment-out must fail when requested quantity exceeds available derived balance for the product/location.
- Negative-stock validation and movement insert must happen in the same trusted use case and database transaction when database support exists.
- Transfer creates linked outbound and inbound movements atomically with one `transferGroupId`.
- Source and destination locations in a transfer must be active, same company, and different.
- Adjustment and count adjustment require reason text.
- Backdated movements are not allowed in the first implementation. Use current server time for `occurredAt`.
- Product archive is allowed only when no active workflow needs the product; archived products remain visible in historical movements.
- Location archive is allowed only when current derived balance is zero unless owner explicitly adds relocation/clearance flow later.
- Internal QR payload stores opaque internal identifiers only. Client must resolve current record data through backend.
- AI Gateway must call permission-checked API/tool routes, never import API Prisma client or direct repositories.

## 10. Shared Contracts

Add or extend shared contracts under `packages/contracts/src`.

Recommended files:

```text
packages/contracts/src/inventory.ts
packages/contracts/src/index.ts
```

Minimum exported types:

```ts
export type InventoryRecordStatus = 'active' | 'archived';

export type ProductKind = 'stockable' | 'service' | 'non_stock';

export type InventoryLocationType = 'main' | 'warehouse' | 'storefront' | 'vehicle' | 'virtual' | 'other';

export type StockMovementType =
  | 'stock_in'
  | 'stock_out'
  | 'transfer_out'
  | 'transfer_in'
  | 'count_adjustment_in'
  | 'count_adjustment_out'
  | 'adjustment_in'
  | 'adjustment_out';

export type StockMovementDirection = 'in' | 'out';

export type ProductSummary = {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  kind: ProductKind;
  unit: string;
  status: InventoryRecordStatus;
  reorderPoint?: number;
};

export type InventoryLocationSummary = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: InventoryLocationType;
  branchId?: string;
  status: InventoryRecordStatus;
};

export type StockBalanceSummary = {
  companyId: string;
  productId: string;
  locationId: string;
  quantity: number;
  asOf: string;
};

export type StockMovementSummary = {
  id: string;
  companyId: string;
  movementNumber?: string;
  productId: string;
  locationId: string;
  movementType: StockMovementType;
  direction: StockMovementDirection;
  quantity: number;
  reason?: string;
  actorUserId: string;
  occurredAt: string;
};
```

Keep API DTOs explicit. Do not expose Prisma generated types, raw audit payloads, full outbox payloads, internal signed-url details, or security metadata to web clients.

## 11. Data Model Draft

Use Prisma/PostgreSQL. Prefer `String @id @default(cuid())` unless the repo has already standardized on UUIDs before item 05 starts.

### Product

```text
Product
- id
- companyId
- sku
- name
- description nullable
- category nullable
- unit
- kind: STOCKABLE, SERVICE, NON_STOCK
- reorderPoint nullable decimal
- status: ACTIVE, ARCHIVED
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt

Unique:
- companyId, sku

Indexes:
- companyId, status
- companyId, name
```

Rules:

- Only `STOCKABLE` products can receive stock movements.
- `SERVICE` and `NON_STOCK` products exist for future sales/accounting compatibility but do not affect stock.
- `reorderPoint` is nullable; low-stock signal is a placeholder until item 06.

### ProductBarcode

```text
ProductBarcode
- id
- companyId
- productId
- type: INTERNAL_QR, EAN13, UPC, CODE128, SUPPLIER, OTHER
- value
- source nullable
- status: ACTIVE, ARCHIVED
- createdAt
- updatedAt

Unique:
- companyId, value

Indexes:
- companyId, productId
- companyId, value
```

Rules:

- Internal QR value must be generated by backend.
- Supplier barcode aliases can resolve product lookup but do not become source-of-truth identifiers.

### InventoryLocation

```text
InventoryLocation
- id
- companyId
- branchId nullable
- code
- name
- type: MAIN, WAREHOUSE, STOREFRONT, VEHICLE, VIRTUAL, OTHER
- status: ACTIVE, ARCHIVED
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt

Unique:
- companyId, code

Indexes:
- companyId, status
- companyId, branchId
```

Rules:

- Location is separate from branch. A location may link to a branch for ABAC/reporting.
- Archived location remains visible in historical movements.

### StockMovement

```text
StockMovement
- id
- companyId
- movementNumber nullable
- productId
- locationId
- movementType
- direction: IN, OUT
- quantity decimal
- reason nullable
- referenceType nullable
- referenceId nullable
- transferGroupId nullable
- reversesMovementId nullable
- actorUserId
- occurredAt
- createdAt

Unique:
- companyId, movementNumber where movementNumber is not null

Indexes:
- companyId, productId, locationId, occurredAt
- companyId, productId, occurredAt
- companyId, locationId, occurredAt
- companyId, movementType, occurredAt
- companyId, transferGroupId
- companyId, referenceType, referenceId
```

Rules:

- `direction` is derived from movement type and stored to simplify queries.
- `quantity` stores positive values only. Balance logic applies sign by direction.
- `movementNumber` should use Data Model Core document sequence `inventory.movement` when available. If sequence service is not implemented yet, leave nullable and record gap in implementation notes.
- `reversesMovementId` is a future hook; normal MVP correction uses adjustment movement.

### StockBalance

No canonical editable stock balance table in MVP.

Read models calculate:

```text
sum(IN.quantity) - sum(OUT.quantity)
group by companyId, productId, locationId
```

A cached projection may be added later only if rebuildable from `StockMovement` and never user-editable.

### InternalQrLabel

```text
InternalQrLabel
- id
- companyId
- entityType: PRODUCT, LOCATION
- entityId
- payload
- labelText
- status: ACTIVE, ARCHIVED
- printedAt nullable
- printedByUserId nullable
- createdAt
- updatedAt

Unique:
- companyId, payload

Indexes:
- companyId, entityType, entityId
```

Rules:

- MVP supports product and location QR labels.
- Lot/batch QR payload remains reserved for advanced warehouse item 22.

## 12. Movement Semantics

Incoming movement types:

```text
stock_in
transfer_in
count_adjustment_in
adjustment_in
```

Outgoing movement types:

```text
stock_out
transfer_out
count_adjustment_out
adjustment_out
```

Stock action mapping:

```text
Receive stock -> stock_in
Issue stock -> stock_out
Transfer stock -> transfer_out + transfer_in with same transferGroupId
Count stock -> count_adjustment_in or count_adjustment_out for delta to counted quantity
Manual adjustment -> adjustment_in or adjustment_out
```

Count stock input:

- User selects product and location.
- User enters counted quantity.
- Backend derives current quantity.
- If counted quantity is greater than current quantity, create `count_adjustment_in` with delta.
- If counted quantity is less than current quantity, create `count_adjustment_out` with delta.
- If counted quantity equals current quantity, do not create movement; return no-op success with current balance.
- Count adjustment requires reason text.

## 13. API Behavior

Base route convention:

```text
/v1/companies/:companyId/inventory/...
```

Route `companyId` is a selection hint only. Backend must verify active membership, role/permission, and location/branch scope from server-side request context.

### Products

```text
GET    /products
POST   /products
GET    /products/:productId
PATCH  /products/:productId
POST   /products/:productId/archive
GET    /products/:productId/movements
GET    /products/:productId/balances
```

Behavior:

- List supports search by SKU/name/barcode, status filter, pagination, and stable sort.
- Create/update validate SKU uniqueness, required name, required unit, kind, and reorder point.
- Archive excludes product from active default lists but keeps historical access.
- Product detail includes barcode aliases and balance summary if requested by query option.

### Product Barcodes and QR Labels

```text
POST   /products/:productId/barcodes
POST   /products/:productId/internal-qr
GET    /labels/resolve?payload=<payload>
POST   /labels/:labelId/printed
```

Behavior:

- Add barcode validates uniqueness per company/value.
- Internal QR generation is idempotent per active product/location where practical.
- Resolve returns current product/location summary and allowed next actions.
- Mark printed records actor/time for audit.

### Locations

```text
GET    /locations
POST   /locations
GET    /locations/:locationId
PATCH  /locations/:locationId
POST   /locations/:locationId/archive
GET    /locations/:locationId/balances
```

Behavior:

- List supports search by code/name/type/status/branch.
- Create/update validate code uniqueness and branch access where branch link exists.
- Archive fails if derived current balance is non-zero.

### Movements and Balance

```text
GET    /movements
POST   /movements/receive
POST   /movements/issue
POST   /movements/transfer
POST   /movements/count
POST   /movements/adjust
GET    /balances
GET    /reports/stock
```

Behavior:

- Movement list supports filters: product, location, movement type, date range, reference type/id, actor, pagination.
- Receive creates one `stock_in`.
- Issue creates one `stock_out`.
- Transfer creates `transfer_out` and `transfer_in` atomically.
- Count creates count adjustment delta or no-op success.
- Adjust creates one adjustment movement.
- Balance queries derive totals from movement rows.
- Report endpoint returns product/location stock summary with optional low-stock flag.

Do not add `PATCH /movements/:id` or `DELETE /movements/:id`.

## 14. Permission Contract

Use these permission keys unless item 02 already defines a stricter naming convention. If existing keys differ, add aliases or update this spec before coding.

```text
inventory.product.read
inventory.product.manage
inventory.location.read
inventory.location.manage
inventory.movement.read
inventory.movement.create
inventory.movement.adjust
inventory.stock_count.create
inventory.report.read
inventory.label.manage
```

Default grants:

```text
OWNER: all inventory permissions
ADMIN: all inventory permissions except optional future high-risk override permissions
MANAGER: inventory.product.read, inventory.location.read, inventory.movement.read, inventory.report.read
INVENTORY: inventory.product.read, inventory.location.read, inventory.movement.read, inventory.movement.create, inventory.movement.adjust, inventory.stock_count.create, inventory.report.read, inventory.label.manage
FINANCE: inventory.product.read, inventory.location.read, inventory.movement.read, inventory.report.read
ACCOUNTANT: inventory.product.read, inventory.location.read, inventory.movement.read, inventory.report.read
MARKETING: inventory.product.read only, plus summary fields allowed by ABAC
AUDITOR_READONLY: inventory.product.read, inventory.location.read, inventory.movement.read, inventory.report.read
SALES: inventory.product.read and summary stock availability only where sales module later needs it
STAFF: no default inventory permissions
```

Location ABAC:

- If item 02 or item 04 provides branch/location scope, movement reads and writes must respect allowed locations.
- If location has `branchId`, user branch scope narrows allowed locations.
- If no ABAC implementation exists yet, enforce company-level permissions and leave an implementation note tied to item 02/04 integration. Do not fake ABAC on client only.

## 15. Audit and Outbox

Audit actions:

```text
inventory.product.created
inventory.product.updated
inventory.product.archived
inventory.location.created
inventory.location.updated
inventory.location.archived
inventory.barcode.created
inventory.label.generated
inventory.label.printed
inventory.movement.created
inventory.stock_count.created
inventory.negative_stock.denied
```

Always audit:

- Product create/update/archive.
- Location create/update/archive.
- Barcode and internal QR generation.
- Movement creation.
- Count adjustment.
- Manual adjustment.
- Negative-stock denial.
- Permission denial for mutation routes where audit module supports it.

Outbox events:

```text
inventory.product.created
inventory.product.updated
inventory.product.archived
inventory.location.created
inventory.location.updated
inventory.location.archived
inventory.movement.created
inventory.stock.low
```

MVP outbox payloads should be bounded and redacted. Include identifiers and summary values only:

```ts
type InventoryMovementCreatedPayload = {
  companyId: string;
  movementId: string;
  movementType: string;
  productId: string;
  locationId: string;
  quantity: string;
  actorUserId: string;
  occurredAt: string;
};
```

Do not include full product descriptions, raw notes beyond required reason summaries, secrets, signed URLs, or unrestricted user profile data in outbox payloads.

## 16. Web UI Behavior

Implement inside the web workspace from item 03. Route files stay thin and import feature components.

Recommended routes:

```text
/inventory/products
/inventory/products/new
/inventory/products/:productId
/inventory/locations
/inventory/movements
/inventory/movements/new
/inventory/stock-count
/inventory/scan
/inventory/reports/stock
```

Feature folder:

```text
apps/web/src/features/inventory/
  components/
  inventory.api.ts
  inventory.constants.ts
  inventory.logic.ts
  inventory.model.ts
```

Required screens:

- Product list with search, status filter, active/archived tabs, and create action.
- Product detail with summary, barcode/internal QR panel, balance by location, and recent movements.
- Product create/edit form.
- Location list and create/edit form.
- Movement history with filters and immutable movement detail drawer/modal.
- Stock action form for receive, issue, transfer, count, and adjustment.
- Scan page using web camera capability where supported and manual payload/barcode input fallback.
- Stock report table by product/location with low-stock flag when reorder point exists.

UI rules:

- Thai is default visible language. English copy must exist through dictionaries.
- Every API load/submit/filter/export/scan resolve shows a visible loader over the relevant scope.
- Permission states show forbidden/readonly UI without hiding server enforcement.
- Product/location archived records remain readable through historical movements.
- Internal QR label preview/print flow may use browser print; no dedicated label printer integration in MVP.
- Do not show direct balance edit UI.
- Do not show movement edit/delete UI.

## 17. LINE and AI Behavior

LINE is read-only for Inventory MVP.

Allowed:

- Ask current stock by product/location.
- Ask low-stock list where reorder point exists.
- Ask recent movement summary with source references.
- Receive low-stock or abnormal movement alert from later dashboard/notification item.
- Open web deep links for product, movement, stock count, or report pages.

Blocked:

- Receive stock.
- Issue stock.
- Transfer stock.
- Count stock.
- Adjust stock.
- Generate/print internal QR labels.
- Archive product/location.
- Override negative-stock denial.

AI Gateway rules:

- Use permission-checked ERP API/tool access only.
- Include source references for stock answers.
- State when permission or missing data prevents answer.
- Never mutate final inventory records from LINE.

## 18. Edge Cases

- Duplicate SKU in same company.
- Same SKU in different company.
- Duplicate location code.
- Duplicate barcode alias.
- Product archived while historical movements exist.
- Location archive attempted while non-zero balance exists.
- Stock movement with zero, negative, non-numeric, or over-precision quantity.
- Stock-out greater than available balance.
- Transfer source and destination are the same.
- Transfer source succeeds but destination insert would fail.
- Count input equals current balance.
- Concurrent stock-out requests for same product/location.
- Permission grants product read but not movement create.
- User has company access but not branch/location scope.
- Internal QR payload unknown, archived, malformed, wrong company, or wrong entity type.
- Web camera unavailable or scan decode fails.
- Network failure after scan but before save.
- Audit/outbox service unavailable.

## 19. Acceptance Criteria

- [ ] Product create/list/detail/update/archive works with company-scoped SKU uniqueness.
- [ ] Product barcode and internal QR label flows can identify active product records.
- [ ] Inventory location create/list/detail/update/archive works with company-scoped code uniqueness.
- [ ] Location archive is blocked while derived balance is non-zero.
- [ ] Receive, issue, transfer, count adjustment, and manual adjustment create immutable movement records.
- [ ] Movement update/delete is unavailable through normal API/service behavior.
- [ ] Stock balance is derived from movement records and matches movement history totals.
- [ ] Negative stock is blocked server-side, including concurrent stock-out attempts.
- [ ] Adjustment and count adjustment require reason text.
- [ ] Transfer creates linked outbound/inbound records atomically.
- [ ] Inventory routes are permission-protected and tenant-scoped.
- [ ] Location/branch ABAC is enforced where item 02/04 primitives exist.
- [ ] Inventory mutation and denial events write audit records where audit exists.
- [ ] Inventory source mutations emit bounded outbox events where outbox exists.
- [ ] Web inventory pages support product, location, movement, stock action, scan, and stock report workflows.
- [ ] LINE/AI inventory behavior is read-only and permission-checked.
- [ ] Shared contracts compile and are exported from `packages/contracts`.

## 20. Test Cases

Unit/domain:

- Movement type maps to correct direction/sign.
- Count adjustment delta returns in/out/no-op.
- Negative-stock validation rejects insufficient balance.
- QR payload parser accepts `WD1:P:<id>` and `WD1:LOC:<id>` and rejects malformed payloads.

Use case:

- Create product succeeds with valid input.
- Duplicate SKU in same company fails.
- Same SKU in different company succeeds.
- Archive product keeps movement history readable.
- Create location succeeds.
- Duplicate location code fails.
- Archive location with non-zero balance fails.
- Receive increases derived balance.
- Issue decreases derived balance.
- Issue below zero fails and creates no movement.
- Transfer changes source/destination balances atomically.
- Count above current balance creates count-adjustment-in.
- Count below current balance creates count-adjustment-out.
- Count equal current balance creates no movement.
- Adjustment without reason fails.
- Movement update/delete is unavailable.

Integration/API:

- Protected routes without permission are denied.
- Route `companyId` cannot access another company.
- Movement list filters by product, location, type, date range, and actor.
- Balance report matches SQL/grouped movement totals.
- Concurrent stock-out cannot make balance negative.
- Audit records are written for movement create and negative-stock denial where audit exists.
- Outbox event is written in same transaction as movement create where outbox exists.

Web:

- Product list/detail/form render with loading, empty, error, forbidden, and success states.
- Stock action form validates required product/location/quantity/reason fields.
- Scan page resolves internal QR payload and supports manual fallback.
- Movement history hides edit/delete actions.
- Thai and English labels exist for visible inventory UI.

AI/LINE:

- Read tool returns stock summary only with `inventory.report.read` or equivalent access.
- AI answer includes source references.
- Mutation attempts from LINE are blocked or routed to web deep link only.

## 21. Implementation Handoff

Sonnet 4.6 should start by reading:

1. `docs/plans/master-implementation-checklist.md`
2. `docs/plans/inventory-mvp-plan.md`
3. `docs/specs/inventory-mvp-spec.md`
4. `docs/specs/permission-matrix.md`
5. `docs/specs/data-model-core-spec.md`
6. `docs/specs/auth-authorization-rbac-spec.md`
7. `docs/specs/web-core-workspace-spec.md`
8. `docs/guidelines/backend-hexagonal-code-style.md`
9. `docs/guidelines/web-frontend-code-style.md`
10. ADR 0002, ADR 0003, ADR 0004, and ADR 0006.

First implementation pass should follow [[plans/inventory-mvp-plan|Inventory MVP Plan]] Phase 0 and Phase 1, then continue phase by phase.

If Prisma/auth/audit/outbox/web shell already exists from items 01 through 04, reuse and extend it. If schema, permission, or route conflicts appear, stop and report the conflict before coding further.
