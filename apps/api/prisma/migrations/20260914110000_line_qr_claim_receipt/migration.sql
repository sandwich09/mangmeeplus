-- Existing USED tokens have no proof receipt; require a fresh Admin QR instead of guessing.
ALTER TABLE "EmployeeLineLinkToken"
ADD COLUMN "claimedLineUserId" TEXT,
ADD COLUMN "claimedLineChannelId" TEXT;
