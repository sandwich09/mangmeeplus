-- คำนำหน้า becomes its own field instead of being concatenated into displayName.
-- Additive and deliberately NOT backfilled: the product has no real users yet, so existing rows keep
-- the title inside displayName and leave titlePrefix null (owner decision 2026-08-15).
-- See docs/agent-memory/employee-title-prefix-field.md.
ALTER TABLE "EmployeeAccessProfile" ADD COLUMN "titlePrefix" TEXT;
