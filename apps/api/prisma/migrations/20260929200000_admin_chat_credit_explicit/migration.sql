-- Admin AI tab rework (Owner 2026-09-29): under SHARED an admin now sets a shop's chat credit in
-- "chatMonthlyBudgetSatang", and "monthlyBudgetSatang" becomes the safety ceiling only.
--
-- Before this release the resolver used a SHARED row's TOTAL override as its chat credit and ignored
-- any SHARED "chatMonthlyBudgetSatang" (an informational leftover). This one statement writes each
-- SHARED row's chat column to exactly the chat credit it has today:
--   * TOTAL override set   -> chat := the override (same credit, and it still wins over a sales deal);
--   * no TOTAL override    -> chat := NULL (the default or a live deal, as today; a leftover is cleared).
-- The TOTAL override itself is untouched, so every safety ceiling stays as it is. SPLIT rows keep
-- their own caps. A binary without this release ignores SHARED chat values, so a rollback reads the
-- same credit too.
--
-- Idempotent: after one run every SHARED row already has chat = override, so a re-run matches nothing.
UPDATE "CompanyAiConfiguration"
SET "chatMonthlyBudgetSatang" = "monthlyBudgetSatang"
WHERE "budgetMode" = 'SHARED'
  AND "chatMonthlyBudgetSatang" IS DISTINCT FROM "monthlyBudgetSatang";
