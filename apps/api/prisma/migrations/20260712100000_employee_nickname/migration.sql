-- ชื่อเล่น: call-name displayed in bookings and individual permissions (falls back to displayName).
ALTER TABLE "EmployeeAccessProfile"
  ADD COLUMN IF NOT EXISTS "nickname" TEXT;
