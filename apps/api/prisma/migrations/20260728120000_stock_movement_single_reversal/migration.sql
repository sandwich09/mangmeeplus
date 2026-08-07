-- A stock movement may be reversed at most once.
--
-- voidGoodsReceiptTrueReversal already skips movements that carry a reversing row, and its CAS
-- status claim runs first in the same transaction, so a second concurrent void of the same
-- receipt loses the claim before it can write anything. This constraint is the database-level
-- backstop for that invariant: it also covers any future path that reverses a movement without
-- going through the goods-receipt reference filter, which the query-side check cannot see.
-- It mirrors @@unique([companyId, sourceType, sourceId, entryType]) on JournalEntry, which is
-- what makes a second REVERSAL entry abort the vendor-bill void transaction.
--
-- NULL is not compared by a Postgres unique index, so ordinary (non-reversing) movements are
-- unaffected — only rows that actually carry a reversesMovementId are constrained.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StockMovement"
    WHERE "reversesMovementId" IS NOT NULL
    GROUP BY "reversesMovementId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'preflight failed: a stock movement is already reversed more than once — reconcile the duplicate reversals before applying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "StockMovement_reversesMovementId_key" ON "StockMovement"("reversesMovementId");
