-- Goods-receipt void data-heal — APPLY script. PROPOSAL ONLY; NOT RUN.
--
-- Run gr-void-heal-survey.sql first and agree the row counts. Then run this inside a
-- transaction, re-run the survey while still open, and COMMIT only if candidates hit zero.
--
--   psql "$PGURL" -v actor='<system user id>' -f gr-void-heal-apply.sql
--
-- Both steps are idempotent: re-running changes nothing.
--
-- Heals ONLY the rows the survey marked SAFE. Rows marked "UNSAFE — would go negative" are
-- left untouched on purpose: the goods were already issued out, so reversing would create
-- negative stock. Those need a business decision (stock adjustment or correction receipt).

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1: reversing STOCK_OUT movements for SAFE candidates
-- Same shape voidGoodsReceiptTrueReversal writes: direction OUT, reversesMovementId set,
-- referenceType 'goods_receipt', referenceId = the goods receipt id.
-- movementNumber is left NULL so the heal does not consume the document-number sequence.
-- ---------------------------------------------------------------------------
WITH candidate AS (
  SELECT sm.*
  FROM "StockMovement" sm
  JOIN "GoodsReceipt" gr ON gr.id = sm."referenceId" AND gr.status = 'VOIDED'
  WHERE sm."referenceType" = 'goods_receipt'
    AND sm.direction = 'IN'
    AND sm."movementType" = 'STOCK_IN'
    AND NOT EXISTS (SELECT 1 FROM "StockMovement" r WHERE r."reversesMovementId" = sm.id)
),
balance AS (
  SELECT "companyId", "productId", "locationId",
         sum(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END) AS on_hand
  FROM "StockMovement" GROUP BY 1, 2, 3
),
safe_group AS (              -- reverse a (product, location) group only if the WHOLE group stays >= 0
  SELECT c."companyId", c."productId", c."locationId"
  FROM candidate c
  JOIN balance b ON b."companyId" = c."companyId" AND b."productId" = c."productId" AND b."locationId" = c."locationId"
  GROUP BY c."companyId", c."productId", c."locationId", b.on_hand
  HAVING b.on_hand - sum(c.quantity) >= 0
)
INSERT INTO "StockMovement"
  (id, "companyId", "productId", "locationId", "movementType", direction, quantity,
   reason, "referenceType", "referenceId", "reversesMovementId", "actorUserId", "occurredAt")
SELECT 'heal-grvoid-' || c.id, c."companyId", c."productId", c."locationId", 'STOCK_OUT', 'OUT', c.quantity,
       'Data heal: reversal of voided goods receipt (pre-fix void left stock inflated)',
       'goods_receipt', c."referenceId", c.id, :'actor', now()
FROM candidate c
JOIN safe_group s
  ON s."companyId" = c."companyId" AND s."productId" = c."productId" AND s."locationId" = c."locationId";

-- ---------------------------------------------------------------------------
-- Step 2: PO line receivedQuantity rollback, stated as a RECOMPUTE not a subtraction.
--
--   receivedQuantity := SUM(acceptedQuantity) over POSTED (non-voided) receipt lines
--
-- Written this way on purpose: subtracting the voided quantity is not idempotent — a second
-- run would subtract again — and it cannot distinguish lines already rolled back by the
-- post-fix void path. The recompute converges to the truth from any starting state, needs no
-- cutoff timestamp, and is safe to re-run. It also cannot go negative, so no clamp is needed.
--
-- Covers STOCK and non-STOCK lines alike, because post incremented receivedQuantity for every
-- line regardless of lineType.
--
-- Note this also rolls back PO lines for receipts whose stock reversal was skipped as UNSAFE.
-- That is deliberate: a VOIDED receipt should never count as received: the UNSAFE verdict is
-- about inventory, not PO fulfilment. Confirm with the business before running.
-- ---------------------------------------------------------------------------
WITH truth AS (
  SELECT pol.id AS line_id,
         coalesce(sum(grl."acceptedQuantity") FILTER (WHERE gr.status = 'POSTED'), 0) AS expected_received
  FROM "PurchaseOrderLine" pol
  LEFT JOIN "GoodsReceiptLine" grl ON grl."purchaseOrderLineId" = pol.id
  LEFT JOIN "GoodsReceipt"     gr  ON gr.id = grl."goodsReceiptId"
  GROUP BY pol.id
)
UPDATE "PurchaseOrderLine" pol
SET "receivedQuantity" = t.expected_received,
    "updatedAt" = now()
FROM truth t
WHERE pol.id = t.line_id
  AND pol."receivedQuantity" <> t.expected_received;

-- ---------------------------------------------------------------------------
-- Step 3: verify BEFORE committing — re-run the survey in this open transaction.
-- Expect: Q1/Q2 list only the UNSAFE rows; Q3 returns zero rows.
-- ---------------------------------------------------------------------------
\i goods-receipt-void-survey.sql

-- Change to COMMIT only after reading the output above.
ROLLBACK;
