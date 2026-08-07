-- Goods-receipt void data-heal SURVEY (READ ONLY — no writes, no locks beyond MVCC snapshot)
--
-- Population: GoodsReceipt.status='VOIDED' whose STOCK_IN movements
-- (referenceType='goods_receipt', referenceId=gr.id, direction='IN') have no reversing
-- movement (no StockMovement.reversesMovementId pointing at them).
--
-- Balance math mirrors PrismaBalanceQuery.getBalance:
--   balance(company, product, location) = SUM(IN.quantity) - SUM(OUT.quantity)
-- (the app clamps the reported value at 0; this survey keeps the raw signed value so
--  pre-existing negatives are visible).
--
-- Usage:
--   psql "$PGURL" -f gr-void-heal-survey.sql
--
-- No parameters. Both sections are stated against the current truth rather than against a
-- "when did the fix ship" cutoff, so the survey needs no deploy timestamp and doubles as the
-- post-heal verification: after a correct heal, Q1/Q2 list only the UNSAFE rows and Q3 is empty.

\set ON_ERROR_STOP on
\timing off

\echo '================ Q0: headline counts ================'
SELECT 'GoodsReceipt rows'                       AS metric, count(*)::text AS value FROM "GoodsReceipt"
UNION ALL SELECT 'GoodsReceipt VOIDED',           count(*)::text FROM "GoodsReceipt" WHERE status = 'VOIDED'
UNION ALL SELECT 'GoodsReceipt VOIDED (posted, i.e. has GR number)',
                                                  count(*)::text FROM "GoodsReceipt" WHERE status = 'VOIDED' AND "goodsReceiptNumber" IS NOT NULL
UNION ALL SELECT 'StockMovement ref=goods_receipt IN',
                                                  count(*)::text FROM "StockMovement" WHERE "referenceType" = 'goods_receipt' AND direction = 'IN'
UNION ALL SELECT 'StockMovement reversal rows (any)',
                                                  count(*)::text FROM "StockMovement" WHERE "reversesMovementId" IS NOT NULL
UNION ALL SELECT 'StockMovement reversal rows ref=goods_receipt',
                                                  count(*)::text FROM "StockMovement" WHERE "reversesMovementId" IS NOT NULL AND "referenceType" = 'goods_receipt'
UNION ALL SELECT '>> CANDIDATE unreversed IN movements on VOIDED GRs',
                                                  count(*)::text
  FROM "StockMovement" sm
  JOIN "GoodsReceipt" gr ON gr.id = sm."referenceId" AND gr.status = 'VOIDED'
  WHERE sm."referenceType" = 'goods_receipt' AND sm.direction = 'IN' AND sm."movementType" = 'STOCK_IN'
    AND NOT EXISTS (SELECT 1 FROM "StockMovement" r WHERE r."reversesMovementId" = sm.id)
UNION ALL SELECT '>> CANDIDATE distinct VOIDED GRs affected',
                                                  count(DISTINCT gr.id)::text
  FROM "StockMovement" sm
  JOIN "GoodsReceipt" gr ON gr.id = sm."referenceId" AND gr.status = 'VOIDED'
  WHERE sm."referenceType" = 'goods_receipt' AND sm.direction = 'IN' AND sm."movementType" = 'STOCK_IN'
    AND NOT EXISTS (SELECT 1 FROM "StockMovement" r WHERE r."reversesMovementId" = sm.id);

\echo ''
\echo '================ Q1: candidate movements (product / location / inflated qty) ================'
SELECT gr."companyId",
       c.name                       AS company,
       gr.id                        AS gr_id,
       gr."goodsReceiptNumber"      AS gr_no,
       gr."voidedAt",
       gr."voidReason",
       sm.id                        AS movement_id,
       sm."movementNumber",
       sm."productId",
       p.name                       AS product,
       sm."locationId",
       loc.name                     AS location,
       sm.quantity                  AS inflated_qty,
       sm."occurredAt"              AS received_at
FROM "StockMovement" sm
JOIN "GoodsReceipt"      gr  ON gr.id = sm."referenceId" AND gr.status = 'VOIDED'
JOIN "Company"           c   ON c.id  = gr."companyId"
JOIN "Product"           p   ON p.id  = sm."productId"
JOIN "InventoryLocation" loc ON loc.id = sm."locationId"
WHERE sm."referenceType" = 'goods_receipt'
  AND sm.direction = 'IN'
  AND sm."movementType" = 'STOCK_IN'
  AND NOT EXISTS (SELECT 1 FROM "StockMovement" r WHERE r."reversesMovementId" = sm.id)
ORDER BY gr."companyId", gr."voidedAt", sm."productId", sm."locationId";

\echo ''
\echo '================ Q2: heal safety per (company, product, location) ================'
\echo 'SAFE = reversal keeps balance >= 0. UNSAFE = goods already issued out; needs a business decision.'
WITH candidate AS (
  SELECT sm.id, sm."companyId", sm."productId", sm."locationId", sm.quantity
  FROM "StockMovement" sm
  JOIN "GoodsReceipt" gr ON gr.id = sm."referenceId" AND gr.status = 'VOIDED'
  WHERE sm."referenceType" = 'goods_receipt'
    AND sm.direction = 'IN'
    AND sm."movementType" = 'STOCK_IN'
    AND NOT EXISTS (SELECT 1 FROM "StockMovement" r WHERE r."reversesMovementId" = sm.id)
),
to_reverse AS (
  SELECT "companyId", "productId", "locationId",
         count(*)      AS movements_to_reverse,
         sum(quantity) AS qty_to_reverse
  FROM candidate
  GROUP BY 1, 2, 3
),
balance AS (
  SELECT sm."companyId", sm."productId", sm."locationId",
         sum(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END) AS on_hand
  FROM "StockMovement" sm
  GROUP BY 1, 2, 3
)
SELECT t."companyId",
       p.name                                   AS product,
       loc.name                                 AS location,
       t.movements_to_reverse,
       t.qty_to_reverse,
       coalesce(b.on_hand, 0)                   AS on_hand_now,
       coalesce(b.on_hand, 0) - t.qty_to_reverse AS on_hand_after_heal,
       CASE WHEN coalesce(b.on_hand, 0) - t.qty_to_reverse >= 0 THEN 'SAFE'
            ELSE 'UNSAFE — would go negative' END AS verdict,
       CASE WHEN coalesce(b.on_hand, 0) - t.qty_to_reverse >= 0 THEN 0
            ELSE t.qty_to_reverse - coalesce(b.on_hand, 0) END AS shortfall
FROM to_reverse t
LEFT JOIN balance b
       ON b."companyId" = t."companyId" AND b."productId" = t."productId" AND b."locationId" = t."locationId"
JOIN "Product"           p   ON p.id   = t."productId"
JOIN "InventoryLocation" loc ON loc.id = t."locationId"
ORDER BY verdict DESC, t."companyId", p.name, loc.name;

\echo ''
\echo '================ Q3: PO lines whose receivedQuantity drifted from the truth ================'
\echo 'Truth = SUM(acceptedQuantity) over POSTED (non-voided) goods receipt lines for that PO line.'
\echo 'Stated as a recompute, not a delta, so it is idempotent and doubles as the post-heal check:'
\echo 'after a correct heal this returns ZERO rows. Covers STOCK and non-STOCK lines alike, because'
\echo 'post incremented receivedQuantity for every line regardless of lineType.'
WITH truth AS (
  SELECT pol.id AS line_id,
         coalesce(sum(grl."acceptedQuantity") FILTER (WHERE gr.status = 'POSTED'), 0) AS expected_received,
         string_agg(DISTINCT gr."goodsReceiptNumber", ', ' ORDER BY gr."goodsReceiptNumber")
           FILTER (WHERE gr.status = 'VOIDED') AS voided_grs
  FROM "PurchaseOrderLine" pol
  LEFT JOIN "GoodsReceiptLine" grl ON grl."purchaseOrderLineId" = pol.id
  LEFT JOIN "GoodsReceipt"     gr  ON gr.id = grl."goodsReceiptId"
  GROUP BY pol.id
)
SELECT pol."companyId",
       po."purchaseOrderNumber"  AS po_no,
       po.status                 AS po_status,
       pol."lineNumber",
       pol.description,
       pol."lineType",
       pol."orderedQuantity",
       pol."receivedQuantity"                     AS received_now,
       t.expected_received,
       pol."receivedQuantity" - t.expected_received AS overstated_by,
       t.voided_grs
FROM truth t
JOIN "PurchaseOrderLine" pol ON pol.id = t.line_id
JOIN "PurchaseOrder"     po  ON po.id  = pol."purchaseOrderId"
WHERE pol."receivedQuantity" <> t.expected_received
ORDER BY pol."companyId", po."purchaseOrderNumber", pol."lineNumber";

\echo ''
\echo '================ Q4: VOIDED GRs with no stock movements at all ================'
\echo 'Service-only receipts, or receipts whose movements were never written. Still need PO rollback (Q3).'
SELECT gr."companyId", gr.id AS gr_id, gr."goodsReceiptNumber", gr."voidedAt",
       count(grl.id)                                              AS gr_lines,
       count(*) FILTER (WHERE grl."lineType" = 'STOCK')           AS stock_lines,
       sum(grl."acceptedQuantity")                                AS total_accepted_qty
FROM "GoodsReceipt" gr
LEFT JOIN "GoodsReceiptLine" grl ON grl."goodsReceiptId" = gr.id
WHERE gr.status = 'VOIDED'
  AND NOT EXISTS (
    SELECT 1 FROM "StockMovement" sm
    WHERE sm."referenceType" = 'goods_receipt' AND sm."referenceId" = gr.id
  )
GROUP BY 1, 2, 3, 4
ORDER BY gr."companyId", gr."voidedAt";

\echo ''
\echo '================ Q5: pre-existing negative balances (context, not caused by this bug) ================'
SELECT sm."companyId", p.name AS product, loc.name AS location,
       sum(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END) AS on_hand
FROM "StockMovement" sm
JOIN "Product"           p   ON p.id   = sm."productId"
JOIN "InventoryLocation" loc ON loc.id = sm."locationId"
GROUP BY 1, 2, 3
HAVING sum(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END) < 0
ORDER BY 4;
