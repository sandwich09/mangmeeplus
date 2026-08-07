# Agent Memory: Inventory MVP (05)

Status: COMPLETE / VERIFIED after Codex recheck-fix on 2026-06-24
Owner: Codex
Scope: Product master, barcodes, internal QR labels, locations, immutable stock movements, movement-derived balance, stock report, web workspace routes

Role gate status:
- BA: Goal remains trustworthy SME stock control for Owner/Admin/Inventory/Manager/Finance/Accountant/Auditor/read-only AI users. Journey: manage product/location, scan/resolve labels, record receive/issue/transfer/count/adjustment, review balances/movements. Rules/exceptions: web-only mutation, no LINE/AI mutation, negative stock blocked, movement history immutable. Acceptance criteria from `docs/specs/inventory-mvp-spec.md` section 19 were rechecked.
- SA: Item 05 extends item 01-04 primitives: Nest hexagonal API, Prisma 7, request context, branch scope, audit, outbox, document sequence, shared contracts, and Next workspace shell. Contracts/routes now match inventory spec routes. Data model remains movement-derived, no balance table, locations stay separate from branches, ABAC branch scope filters location-linked reads/writes.
- DEV: Ponytail read. Smallest correct diff fixed gaps found in recheck: canonical API action routes, barcode/QR endpoints, active stockable product/location validation, branch-scope guards, exact decimal helpers, transaction/lock negative-stock guard, document movement numbers, product/location outbox events, ADMIN inventory grants, real web loaders/forms/routes. Touched files are API inventory module, auth permission registry, web inventory pages/API/model, contracts inventory query type, and this memory.
- Integration: Backend-to-frontend contract verified by API/web/contracts typecheck, API/web tests, Prisma validate, web production build, and browser route smoke on live Next dev server. Browser smoke covered inventory hub, products, product create, stock action, stock report, scan, and stock count routes without Next runtime errors. No full API-backed browser E2E was run because API+DB were not started for this recheck.

Decisions:
- Stock quantities are compared with 6-decimal fixed-scale bigint helpers at validation/logic/query boundaries to avoid JavaScript float drift.
- Negative-stock check and outbound insert use a PostgreSQL advisory transaction lock per company/product/location in `PrismaMovementRepository`.
- Inventory movement numbers use item 04 `inventory.movement` document sequence when available; if a company has no active sequence, movement creation continues with nullable `movementNumber`.
- Direct movement create endpoint was removed from HTTP; web/API use receive, issue, transfer, count, and adjust routes.
- Product SKU create normalizes to uppercase for service-level case-insensitive behavior.
- Web inventory pages call real API endpoints and show backend errors; no fake inventory rows remain.

Open questions:
- Full API-backed browser E2E should run when local API, DB, and auth token/cookie are available.

Artifacts:
- `apps/api/src/modules/inventory/`: API routes/use-cases/repositories updated for Item 05 gaps.
- `apps/api/src/modules/auth/permission-registry.ts`: ADMIN now receives inventory grants.
- `packages/contracts/src/inventory.ts`: location query contract includes search/type filters.
- `apps/web/src/features/inventory/InventoryPages.tsx`: real client loaders/forms for inventory routes.
- `apps/web/app/(workspace)/companies/[companyId]/inventory/`: routes now include products/new, products/[productId], stock-count, and real route wrappers.
- `docs/plans/master-implementation-checklist.md`: Item 05 remains ticked `[x]`.

Verification:
- `pnpm --filter @watchdog-bms/contracts typecheck`: pass.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `pnpm --filter @watchdog-bms/web typecheck`: pass.
- `pnpm --filter @watchdog-bms/api prisma:validate`: pass.
- `pnpm --filter @watchdog-bms/api test`: first sandbox run failed with `listen EPERM` on tsx IPC pipe; escalated rerun passed 171/171.
- `pnpm --filter @watchdog-bms/web test`: first sandbox run failed with `listen EPERM` on tsx IPC pipe; escalated rerun passed 89/89.
- `pnpm typecheck`: pass, 10/10 tasks.
- `pnpm test`: pass, 10/10 tasks (escalated due tsx IPC sandbox limit).
- `pnpm --filter @watchdog-bms/web build`: sandbox run hung and was interrupted; escalated rerun passed and built 10 inventory routes.
- Browser smoke on `http://127.0.0.1:3000`: inventory hub, products, product new, movement new, stock report, scan, stock-count routes rendered correct H1 and no Next error overlay.

Next:
- 06. Dashboard and Notification MVP can use inventory read/report/outbox hooks.
- Run full API-backed browser E2E after local API+DB auth session is available.
