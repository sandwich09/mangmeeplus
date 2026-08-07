-- RA-18: WHT payee taxpayer class on the expense capture path. The RD form follows the payee —
-- ภ.ง.ด.3 for บุคคลธรรมดา, ภ.ง.ด.53 for นิติบุคคล — so the class must be captured when the expense is
-- reviewed, not re-entered later when the company turns tax filing on.
--
-- Additive only: one nullable column reusing the existing "BuyerEntityKind" enum, no default and no
-- backfill. Existing rows stay NULL, which the sync reads as "not classified" (documented PND53
-- fallback), never as a stored JURISTIC fact.
--
-- Hand-written and idempotent because `prisma migrate dev` is blocked by the unhealed drift on
-- 20260728120000_stock_movement_single_reversal: apply with `prisma db execute`, then
-- `prisma migrate resolve --applied 20260804190000_expense_payee_entity_kind`.
ALTER TABLE "ExpenseRecord"
  ADD COLUMN IF NOT EXISTS "vendorEntityKindSnapshot" "BuyerEntityKind";
