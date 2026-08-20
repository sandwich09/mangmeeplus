-- Owner decision 2026-08-20 (superseding D10/D11): a signature is a PERSONAL asset — no approval
-- step at all. PENDING_OWNER_APPROVAL therefore becomes a state nothing can enter and nothing can
-- leave, which would strand every row already sitting in it.
--
-- Those rows are not a backlog of unreviewed submissions. The queue screen that could clear them
-- was parked for most of this feature's life, so what they actually are is people's OWN signatures,
-- already uploaded, waiting on a door that was never opened. Leaving them PENDING would make each
-- of those users re-send a photo the system is already holding.
--
-- Activation is recorded exactly the way creation records it from now on: by the person whose
-- signature it is. `approvedByUserId`/`approvedAt` keep their columns and now read as "activated
-- by / at".
--
-- REJECTED and ARCHIVED rows are deliberately untouched — those are decisions a human really made,
-- and the enum keeps every value so that history stays readable.
UPDATE "CompanySignatureAsset"
SET "status" = 'ACTIVE',
    "approvedByUserId" = "submittedByUserId",
    "approvedAt" = NOW(),
    "updatedAt" = NOW()
WHERE "status" = 'PENDING_OWNER_APPROVAL';
