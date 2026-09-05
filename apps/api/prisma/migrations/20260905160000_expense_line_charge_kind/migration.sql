-- Spec `docs/specs/line-ai-draft-control-spec-th.md` S-1: additional charges (service charge,
-- delivery, packaging, …) become a field of their own on the expense line instead of an ordinary
-- product row named "service charge".
--
-- Additive only, and deliberately without a backfill: an existing OCR row whose description happens
-- to read "Service charge 10%" was recorded as a product line, and guessing its kind from free text
-- would rewrite accounting records from a string match. Those rows stay products; S-4 offers the
-- user an explicit "move it into the charge field" instead.
CREATE TYPE "ExpenseLineChargeKind" AS ENUM (
  'SERVICE_CHARGE', 'DELIVERY', 'PACKAGING', 'PLATFORM_FEE', 'TIP', 'ROUNDING', 'OTHER'
);

ALTER TABLE "ExpenseLine" ADD COLUMN "chargeKind" "ExpenseLineChargeKind";
