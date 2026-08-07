-- Per-company employee contact email, distinct from the login email on User.
-- Used to enforce that a cross-company account attached as an employee uses a different email here.
ALTER TABLE "EmployeeAccessProfile"
  ADD COLUMN IF NOT EXISTS "email" TEXT;
