-- Preserve dates already reviewed in the payment, voucher and substitute-receipt forms.
-- The seed is the known writer that copied expenseDate (identified by its exact key prefix).
-- Future omitted dates still default to false; this is a one-time classification of existing rows.
UPDATE "ExpensePayment"
SET "paidAtConfirmed" = (COALESCE(left("idempotencyKey", 20), '') <> 'client:seed-payment-');
