CREATE TABLE "LineReadEvidence" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "inputJson" JSONB NOT NULL,
  "resultHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LineReadEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LineReadEvidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LineReadEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LineReadEvidence_companyId_userId_requestId_createdAt_idx" ON "LineReadEvidence"("companyId", "userId", "requestId", "createdAt");
CREATE INDEX "LineReadEvidence_createdAt_idx" ON "LineReadEvidence"("createdAt");
