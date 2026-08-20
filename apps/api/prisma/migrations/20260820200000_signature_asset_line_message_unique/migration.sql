-- A13: two deliveries of the same LINE webhook event both read "no signature asset for this
-- lineMessageId yet" and both created one, because [companyId, lineMessageId] was only an index.
-- The owner then approves one of the twins and the other sits in the pending queue forever. The
-- uniqueness has to live where the race is, not in an application-level read.
--
-- Web-created assets carry lineMessageId NULL, and Postgres treats NULLs as distinct in a unique
-- index, so any number of them still coexist. Existing LINE duplicates (none expected: the
-- application read has always run first) would make this fail loudly rather than silently discard
-- a row of a legal-signature table, which is the correct outcome for someone to look at.

-- DropIndex
DROP INDEX "CompanySignatureAsset_companyId_lineMessageId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "CompanySignatureAsset_companyId_lineMessageId_key" ON "CompanySignatureAsset"("companyId", "lineMessageId");
