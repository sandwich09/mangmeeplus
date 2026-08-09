-- Related-record ABAC resolves persisted actors across a reimbursement and its
-- evidence/decision/payment history. Keep every OR arm indexable at company scope.
CREATE INDEX "AttachmentLink_company_target_linker_idx"
  ON "AttachmentLink"("companyId", "targetType", "linkedByUserId", "targetId");

CREATE INDEX "ReimbursementRequest_companyId_createdByUserId_idx"
  ON "ReimbursementRequest"("companyId", "createdByUserId");
CREATE INDEX "ReimbursementRequest_companyId_updatedByUserId_idx"
  ON "ReimbursementRequest"("companyId", "updatedByUserId");
CREATE INDEX "ReimbursementRequest_companyId_submittedByUserId_idx"
  ON "ReimbursementRequest"("companyId", "submittedByUserId");
CREATE INDEX "ReimbursementRequest_company_finance_reviewer_idx"
  ON "ReimbursementRequest"("companyId", "financeReviewedByUserId");
CREATE INDEX "ReimbursementRequest_company_cancel_actor_idx"
  ON "ReimbursementRequest"("companyId", "cancellationPendingByUserId");

CREATE INDEX "ReimbursementClaimSignature_companyId_signedByUserId_idx"
  ON "ReimbursementClaimSignature"("companyId", "signedByUserId");
CREATE INDEX "ReimbursementApprovalStep_companyId_decisionByUserId_idx"
  ON "ReimbursementApprovalStep"("companyId", "decisionByUserId");
CREATE INDEX "ReimbursementPayment_companyId_paidByUserId_idx"
  ON "ReimbursementPayment"("companyId", "paidByUserId");
CREATE INDEX "ReimbursementPayment_companyId_voidedByUserId_idx"
  ON "ReimbursementPayment"("companyId", "voidedByUserId");
