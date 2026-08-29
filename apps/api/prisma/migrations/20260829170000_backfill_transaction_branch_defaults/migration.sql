-- Backfill branches for transactional rows created before 88aef194 (2026-08-27) made
-- TRANSACTION_BRANCH_REQUIRED mandatory. Those rows carry branchId NULL and are stranded: every
-- later lifecycle gate (reimbursement decisions and payment, goods receipt from a PO, supplier
-- payment from a bill, expense confirm/payment) requires the row's own branch, and reimbursements
-- and procurement expose no way to set one after creation.
--
-- Assignment rule (Owner decision 2026-08-29, same priority the Owner confirmed 2026-08-27 for the
-- LINE receipt lane in line-receipt-branch.logic.ts):
--   1. the company's sole ACTIVE branch;
--   2. otherwise the company's sole ACTIVE HEAD_OFFICE branch;
--   3. otherwise leave NULL — a row this rule cannot decide must be resolved by a person, never
--      guessed into an accounting record. Count the remainder with:
--        SELECT 'ReimbursementRequest' AS t, count(*) FROM "ReimbursementRequest" WHERE "branchId" IS NULL
--        UNION ALL SELECT 'ExpenseRecord', count(*) FROM "ExpenseRecord" WHERE "branchId" IS NULL
--        UNION ALL SELECT 'PurchaseOrder', count(*) FROM "PurchaseOrder" WHERE "branchId" IS NULL;
--
-- AccountingDocument and JournalLine are deliberately NOT backfilled: documents accept a branch on
-- update (an escape hatch exists) and NULL there still means company-central; posted journal lines
-- are accounting history and are not rewritten.
--
-- updatedAt is deliberately untouched so optimistic-concurrency checks (expectedUpdatedAt) in
-- flight keep matching.

UPDATE "ExpenseRecord" r
SET "branchId" = t.branch_id
FROM (
  SELECT b."companyId",
         CASE WHEN count(*) = 1 THEN min(b.id)
              WHEN count(*) FILTER (WHERE b.type = 'HEAD_OFFICE') = 1 THEN min(b.id) FILTER (WHERE b.type = 'HEAD_OFFICE')
         END AS branch_id
  FROM "Branch" b
  WHERE b.status = 'ACTIVE'
  GROUP BY b."companyId"
) t
WHERE r."companyId" = t."companyId" AND r."branchId" IS NULL AND t.branch_id IS NOT NULL;

UPDATE "ReimbursementRequest" r
SET "branchId" = t.branch_id
FROM (
  SELECT b."companyId",
         CASE WHEN count(*) = 1 THEN min(b.id)
              WHEN count(*) FILTER (WHERE b.type = 'HEAD_OFFICE') = 1 THEN min(b.id) FILTER (WHERE b.type = 'HEAD_OFFICE')
         END AS branch_id
  FROM "Branch" b
  WHERE b.status = 'ACTIVE'
  GROUP BY b."companyId"
) t
WHERE r."companyId" = t."companyId" AND r."branchId" IS NULL AND t.branch_id IS NOT NULL;

UPDATE "PurchaseRequest" r
SET "branchId" = t.branch_id
FROM (
  SELECT b."companyId",
         CASE WHEN count(*) = 1 THEN min(b.id)
              WHEN count(*) FILTER (WHERE b.type = 'HEAD_OFFICE') = 1 THEN min(b.id) FILTER (WHERE b.type = 'HEAD_OFFICE')
         END AS branch_id
  FROM "Branch" b
  WHERE b.status = 'ACTIVE'
  GROUP BY b."companyId"
) t
WHERE r."companyId" = t."companyId" AND r."branchId" IS NULL AND t.branch_id IS NOT NULL;

UPDATE "PurchaseOrder" r
SET "branchId" = t.branch_id
FROM (
  SELECT b."companyId",
         CASE WHEN count(*) = 1 THEN min(b.id)
              WHEN count(*) FILTER (WHERE b.type = 'HEAD_OFFICE') = 1 THEN min(b.id) FILTER (WHERE b.type = 'HEAD_OFFICE')
         END AS branch_id
  FROM "Branch" b
  WHERE b.status = 'ACTIVE'
  GROUP BY b."companyId"
) t
WHERE r."companyId" = t."companyId" AND r."branchId" IS NULL AND t.branch_id IS NOT NULL;

UPDATE "GoodsReceipt" r
SET "branchId" = t.branch_id
FROM (
  SELECT b."companyId",
         CASE WHEN count(*) = 1 THEN min(b.id)
              WHEN count(*) FILTER (WHERE b.type = 'HEAD_OFFICE') = 1 THEN min(b.id) FILTER (WHERE b.type = 'HEAD_OFFICE')
         END AS branch_id
  FROM "Branch" b
  WHERE b.status = 'ACTIVE'
  GROUP BY b."companyId"
) t
WHERE r."companyId" = t."companyId" AND r."branchId" IS NULL AND t.branch_id IS NOT NULL;

UPDATE "VendorBill" r
SET "branchId" = t.branch_id
FROM (
  SELECT b."companyId",
         CASE WHEN count(*) = 1 THEN min(b.id)
              WHEN count(*) FILTER (WHERE b.type = 'HEAD_OFFICE') = 1 THEN min(b.id) FILTER (WHERE b.type = 'HEAD_OFFICE')
         END AS branch_id
  FROM "Branch" b
  WHERE b.status = 'ACTIVE'
  GROUP BY b."companyId"
) t
WHERE r."companyId" = t."companyId" AND r."branchId" IS NULL AND t.branch_id IS NOT NULL;

-- Evidence follows its claim: attachments referenced by a backfilled reimbursement (line evidence
-- and the primary receipt) inherit the claim's branch when they have none, so the DRAFT edit lane's
-- evidence-branch equality check (reimbursement-evidence.service.ts) cannot strand the same claim
-- again one gate later.

UPDATE "AttachmentObject" a
SET "branchId" = r."branchId"
FROM "ReimbursementLine" l
JOIN "ReimbursementRequest" r
  ON r."companyId" = l."companyId" AND r.id = l."reimbursementRequestId"
WHERE a.id = l."attachmentId"
  AND a."companyId" = r."companyId"
  AND a."branchId" IS NULL
  AND r."branchId" IS NOT NULL;

UPDATE "AttachmentObject" a
SET "branchId" = r."branchId"
FROM "ReimbursementRequest" r
WHERE a.id = r."primaryAttachmentId"
  AND a."companyId" = r."companyId"
  AND a."branchId" IS NULL
  AND r."branchId" IS NOT NULL;
