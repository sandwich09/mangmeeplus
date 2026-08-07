-- มั่งมี Flow A employee wizard: additive optional fields on EmployeeAccessProfile.
-- Email is intentionally NOT added here — it lives on User.email (already unique, already the login identity).
ALTER TABLE "EmployeeAccessProfile"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN "addressLine" TEXT,
  ADD COLUMN "postalCode" TEXT;
