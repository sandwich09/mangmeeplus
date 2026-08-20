-- Owner decision 2026-08-20: a signature is a PERSONAL asset, ACTIVE from creation by its own owner.
-- The prior migration re-activated the stranded PENDING_OWNER_APPROVAL rows but left the column
-- DEFAULT at PENDING_OWNER_APPROVAL — a state nothing can enter or leave. Any future insert path that
-- omits status would land an unrecoverable row, so the default is moved to the only live created state.
ALTER TABLE "CompanySignatureAsset" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
