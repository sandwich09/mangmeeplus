-- CUST-02 (G4): the cross-company sweep discovery filters on status+expiresAt (expireStale /
-- findCompanyIdsWithSweepableProposals) and status+updatedAt (sweepStuckCommitting) with no
-- companyId predicate, so the existing companyId-leading indexes can't serve it. Add supporting
-- indexes leading with status. Additive.
CREATE INDEX "CrmBookingProposal_status_expiresAt_idx" ON "CrmBookingProposal"("status", "expiresAt");
CREATE INDEX "CrmBookingProposal_status_updatedAt_idx" ON "CrmBookingProposal"("status", "updatedAt");
