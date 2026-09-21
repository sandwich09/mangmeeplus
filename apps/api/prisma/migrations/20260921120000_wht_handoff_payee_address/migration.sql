-- Vendor address spec §10: the 50 ทวิ handoff can now carry a payee address typed by the operator.
--
-- Three columns BESIDE `prefillSnapshotJson`, never inside it. That snapshot is guarded by
-- `prefillSnapshotHash` so the facts the operator copies onto the external certificate cannot
-- drift; writing an address into the JSON would either break the hash or force a recompute, and
-- either way the guarantee is gone.
--
-- Additive and idempotent, with NO backfill: §8 says a missing address never blocks anything, so
-- every handoff frozen before today stays NULL and is filled in on the screen when someone needs it.
ALTER TABLE "WhtCertificateHandoff" ADD COLUMN IF NOT EXISTS "payeeAddress" VARCHAR(500);
ALTER TABLE "WhtCertificateHandoff" ADD COLUMN IF NOT EXISTS "payeeAddressByUserId" TEXT;
ALTER TABLE "WhtCertificateHandoff" ADD COLUMN IF NOT EXISTS "payeeAddressAt" TIMESTAMP(3);
