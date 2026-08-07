ALTER TABLE "Product"
  ADD COLUMN "salePrice" DECIMAL(65,30),
  ADD COLUMN "bookingDurationMinutes" INTEGER,
  ADD COLUMN "customerVisible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_bookingDurationMinutes_check"
  CHECK (
    "bookingDurationMinutes" IS NULL OR
    ("bookingDurationMinutes" BETWEEN 60 AND 180 AND "bookingDurationMinutes" % 30 = 0)
  );

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_salePrice_check"
  CHECK ("salePrice" IS NULL OR "salePrice" >= 0);
