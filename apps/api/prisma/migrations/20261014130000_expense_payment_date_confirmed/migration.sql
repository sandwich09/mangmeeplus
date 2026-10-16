-- Historical paidAt may be an automatic timestamp. Never infer a confirmed civil date.
ALTER TABLE "ExpensePayment" ADD COLUMN "paidAtConfirmed" BOOLEAN NOT NULL DEFAULT false;
