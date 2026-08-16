-- Prisma runs this migration transactionally, so PostgreSQL cannot build these concurrently.
-- Fail before waiting on a long-held write lock; the release clone rehearsal remains authoritative.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE INDEX "ExpenseRecord_companyId_paymentStatus_dueDate_idx"
ON "ExpenseRecord"("companyId", "paymentStatus", "dueDate");

CREATE INDEX "ExpenseRecord_companyId_primaryAttachmentId_missingReceiptReason_idx"
ON "ExpenseRecord"("companyId", "primaryAttachmentId", "missingReceiptReason");
