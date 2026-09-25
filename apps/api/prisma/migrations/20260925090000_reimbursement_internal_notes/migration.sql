CREATE TABLE "ReimbursementInternalNote" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "reimbursementRequestId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReimbursementInternalNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReimbursementInternalNote_request_fkey" FOREIGN KEY ("companyId", "reimbursementRequestId")
    REFERENCES "ReimbursementRequest" ("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ReimbursementInternalNote_companyId_reimbursementRequestId_createdAt_idx"
  ON "ReimbursementInternalNote" ("companyId", "reimbursementRequestId", "createdAt");
