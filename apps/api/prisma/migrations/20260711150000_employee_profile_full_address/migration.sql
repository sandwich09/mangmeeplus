ALTER TABLE "EmployeeAccessProfile"
  ADD COLUMN IF NOT EXISTS "province" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "subdistrict" TEXT;
