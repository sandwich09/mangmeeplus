CREATE INDEX "ExpenseRecord_companyId_createdByUserId_idx" ON "ExpenseRecord"("companyId", "createdByUserId");
CREATE INDEX "ExpenseRecord_companyId_updatedByUserId_idx" ON "ExpenseRecord"("companyId", "updatedByUserId");
CREATE INDEX "ExpenseRecord_companyId_reviewedByUserId_idx" ON "ExpenseRecord"("companyId", "reviewedByUserId");
CREATE INDEX "ExpenseRecord_companyId_confirmedByUserId_idx" ON "ExpenseRecord"("companyId", "confirmedByUserId");
CREATE INDEX "ExpenseRecord_companyId_rejectedByUserId_idx" ON "ExpenseRecord"("companyId", "rejectedByUserId");
CREATE INDEX "ExpenseRecord_companyId_voidedByUserId_idx" ON "ExpenseRecord"("companyId", "voidedByUserId");
CREATE INDEX "ExpenseRecord_company_substitute_generator_idx" ON "ExpenseRecord"("companyId", "substituteReceiptGeneratedByUserId");

CREATE INDEX "ExpensePayment_companyId_createdByUserId_idx" ON "ExpensePayment"("companyId", "createdByUserId");
CREATE INDEX "ExpensePayment_companyId_voidedByUserId_idx" ON "ExpensePayment"("companyId", "voidedByUserId");

CREATE INDEX "ExpSubEvidence_company_preparer_status_idx"
  ON "ExpenseSubstituteReceiptEvidence"("companyId", "preparedByUserId", "status");
CREATE INDEX "ExpSubEvidence_company_approver_status_idx"
  ON "ExpenseSubstituteReceiptEvidence"("companyId", "approverUserId", "status");
CREATE INDEX "ExpSubEvidence_company_issuer_status_idx"
  ON "ExpenseSubstituteReceiptEvidence"("companyId", "issuedByUserId", "status");
