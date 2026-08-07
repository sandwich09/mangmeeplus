-- CC7 ruling 5 — the repair generation that produced a normalization marker.
-- Additive and idempotent: existing markers keep the current normalizer version (0), so the
-- one-time APPLY does not drag onboarding-written EXPLICIT companies through a pointless pass.
-- Raising NORMALIZER_VERSION in code is what re-opens already-COMPLETED companies for repair.
ALTER TABLE "CompanyEntitlementNormalization"
  ADD COLUMN IF NOT EXISTS "normalizerVersion" INTEGER NOT NULL DEFAULT 0;
