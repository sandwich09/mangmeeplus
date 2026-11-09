-- Owner 2026-11-09: sales can raise or lower how many documents a demo link may read.
ALTER TABLE "SalesDemoLink" ADD COLUMN "readLimit" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "SalesDemoLink" ADD CONSTRAINT "SalesDemoLink_readLimit_check" CHECK ("readLimit" BETWEEN 1 AND 50);
