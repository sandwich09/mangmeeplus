ALTER TABLE "Company"
ADD COLUMN "bookingBufferMinutes" INTEGER NOT NULL DEFAULT 60
CHECK ("bookingBufferMinutes" IN (0, 30, 60, 90, 120));
