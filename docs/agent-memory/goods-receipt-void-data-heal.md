# Agent Memory: goods-receipt void — data heal

Status: SCRIPTS READY, NOT RUN against UAT/prod (2026-07-28). Local + sibling DBs surveyed: 0 affected rows.
Merged เข้า `develop` แล้ว (PR #48) ⇒ deploy gate ของ migration ด้านล่างมีผลจริงตั้งแต่ deploy รอบถัดไป.
Scope: `scripts/heal/goods-receipt-void-*.sql` (new)
Code fix that stops the bleeding: [[goods-receipt-void-true-reversal]]

## Why a heal is needed

Before the void fix, `VoidGoodsReceiptUseCase` only flipped status to VOIDED — no reversing stock
movement, no PO `receivedQuantity` rollback. Every receipt voided before the fix therefore left
on-hand stock inflated and its PO lines still counting the receipt as received. The code fix is not
retroactive; these scripts find and correct the rows it left behind.

## Survey result (local, read-only)

`docker :15432 / watchdog_bms`, `DATABASE_URL` passed explicitly (apps/api/.env has a stale value).

| metric | count |
| --- | --- |
| GoodsReceipt rows | 1 (POSTED) |
| GoodsReceipt VOIDED | 0 |
| StockMovement referenceType='goods_receipt' | 0 |
| **candidate unreversed IN movements on VOIDED GRs** | **0** |

Zero affected rows. The one goods receipt is seed data (`seed-goods-receipt-supplies`), POSTED, with
`inventoryMovementId = NULL` — inserted by the seeder, never posted through the use case, so it
produced no stock movement. The other 8 databases on the same instance (`watchdog_crm_019f543c`,
`watchdog_customer_verify_019f543c`, `watchdog_substitute_verify`, `watchdog_item11b_*`,
`watchdog_shadow`) also have 0 VOIDED goods receipts and 0 goods_receipt movements.

**The real population, if any, lives in UAT/prod — not queried, needs approval.**

## Artifacts

- `scripts/heal/goods-receipt-void-survey.sql` — read-only, no parameters. Q0 headline counts,
  Q1 candidate movements (product/location/qty), Q2 per-(company,product,location) SAFE vs UNSAFE
  verdict, Q3 PO line drift, Q4 voided GRs with no movements at all, Q5 pre-existing negatives.
- `scripts/heal/goods-receipt-void-apply.sql` — the heal, `-v actor='<user id>'`. Step 1 writes
  reversing STOCK_OUT rows (`reversesMovementId` set, `referenceType='goods_receipt'`,
  `movementNumber` NULL so the heal does not consume the document-number sequence). Step 2 recomputes
  PO line `receivedQuantity`. Wrapped in BEGIN/ROLLBACK with the survey re-run inside the open
  transaction; the operator flips ROLLBACK to COMMIT after reading the output.

## Decisions

- **Balance math mirrors `PrismaBalanceQuery.getBalance`**: `SUM(IN) - SUM(OUT)` per
  (companyId, productId, locationId), derived from StockMovement — there is no balance table. The
  survey keeps the raw signed value; the app clamps its reported value at 0, which would hide
  pre-existing negatives (hence Q5).
- **SAFE/UNSAFE is decided per (product, location) group, not per movement.** Two voided receipts on
  the same product+location must be evaluated together, or reversing them one at a time passes each
  individual check and still lands negative.
- **PO rollback is a RECOMPUTE, not a subtraction:** `receivedQuantity := SUM(acceptedQuantity)` over
  POSTED (non-voided) receipt lines. Subtracting is not idempotent (a second run subtracts again),
  cannot verify clean, and on the test fixture clamped a line with a legitimate POSTED receipt of 6
  down to 0. The recompute converges to truth from any starting state and needs no "when did the fix
  ship" cutoff.
- **PO rollback covers every line type**, because post increments `receivedQuantity` for every GR line
  while only STOCK lines produce a movement — service-only voided receipts leave PO lines overstated
  with no stock movement to find them by (that is what Q4 surfaces).
- **PO rollback applies to UNSAFE receipts too.** A VOIDED receipt should never count as received; the
  UNSAFE verdict is about inventory, not PO fulfilment. Flagged in the script for confirmation.
- **UNSAFE rows are never forced** — listed with their shortfall for a business decision (stock
  adjustment or correction receipt).

## Verification (scripts only)

Local DB has no affected rows, so a 0-row survey proves only that the SQL parses. Validated against a
synthetic fixture inside `BEGIN ... ROLLBACK` (no net change; counts re-checked after rollback):
4 voided receipts — one SAFE (20 in, 120 on hand), one UNSAFE (25 in, 30 issued out, 5 on hand), one
already-reversed control, one service-only with no movements.

- Q1/Q2 found both candidates and excluded the already-reversed control.
- Q2 verdicts: SAFE (120 → 100) and `UNSAFE — would go negative` (5 → -20, shortfall 20).
- After the heal: 1 reversal row for the SAFE case only, UNSAFE untouched, Q3 zero rows.
- Idempotency: run 3× in one transaction → run 1 `INSERT 0 1 / UPDATE 1`, runs 2-3 `INSERT 0 0 / UPDATE 0`.

Note: this validates the **scripts**. The shipped code fix is a different implementation from the one
the script author prototyped (inline repository transaction vs inventory-port batch) — its evidence
is in [[goods-receipt-void-true-reversal]], and it has unit coverage only, no live-DB run.

## Local migration state (context for whoever deploys)

`prisma migrate deploy` was blocked by P3009: `20260718190000_h11_attachment_evidence_immutability`
recorded as failed because someone had `db push`ed the schema first. Cleared only after confirming
h11's effects were complete (column and unique index both present, no duplicate rows) — the
[[project_prod_migration_drift_dirtytree]] trap is marking a *half*-applied migration as applied.
The local DB also holds extra tables from sibling branches sharing the instance; five of their
migrations are in `_prisma_migrations` but absent from this branch. Left alone on purpose.

Trap: `psql` rejects the `?schema=public` suffix Prisma's `DATABASE_URL` carries — pass the bare URL.

## Open questions

1. Approval to run the survey read-only against UAT, then prod.
2. UNSAFE rows, if prod has any: stock adjustment or correction receipt? Needs a business owner. The
   shipped code now *blocks* such voids, so this only concerns receipts voided before it.
3. Should the heal's reversing movements consume real `inventory.movement` document numbers?
   Currently NULL, matching how the code path leaves reversal movements.

## Next

- Get approval; run the survey against UAT, then prod, and report real counts before proposing writes.
- **Deploy gate:** this branch ships `20260728120000_stock_movement_single_reversal`. Its preflight
  aborts if any environment already holds a doubly-reversed movement — intended; triage the
  duplicates rather than bypassing. Check `migrate status` in UAT/prod before deploying, and verify
  effects before resolving anything.
- **Its timestamp sorts before three migrations already on `develop`** (`20260728191000`,
  `20260728192000`, `20260728200000`) because it was written on a branch cut earlier. Left as-is on
  purpose: the local shared DB already recorded this exact name, so renaming it would make the next
  local `migrate deploy` fail 42P07 on an index that already exists. `migrate status` reports
  "Database schema is up to date" with all 87 in place, and `migrate deploy` applies pending
  migrations by name regardless of order — a standalone CREATE UNIQUE INDEX has no ordering
  dependency.
