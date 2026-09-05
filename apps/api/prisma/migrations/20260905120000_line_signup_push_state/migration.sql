-- P10-L Slice L-B. Two additive nullable columns; no backfill, no default, no index.

-- §3.6: the day-7 "กันหลุด" card is claimed by stamping this before the push is queued, so two
-- concurrent sweeps produce exactly one card.
ALTER TABLE "CompanySignupRequest" ADD COLUMN     "profileGuardNudgedAt" TIMESTAMP(3);

-- §8: "ติดต่อเจ้าหน้าที่" pauses the assistant for this LINE user. A timestamp rather than a flag so
-- it expires on its own and no sweep has to remember to clear it.
ALTER TABLE "LineCompanyContext" ADD COLUMN     "aiPausedUntil" TIMESTAMP(3);
