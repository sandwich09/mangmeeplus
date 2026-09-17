-- Split CHAT/OCR budget policy on the existing company AI configuration row (remediation spec
-- §12.4, ADR 0013 §3). Additive only: one defaulted text column, one defaulted int column and
-- three nullable columns. No backfill, no rewrite — every existing company keeps behaving exactly
-- as it does today because `budgetMode` defaults to 'SHARED'.
--
-- An OLD binary that does not know these columns keeps working: it never selects or writes them,
-- its INSERTs still satisfy every NOT NULL through the defaults, and it can only ever serve
-- SHARED companies because nothing can set 'SPLIT' without the new writer.
ALTER TABLE "CompanyAiConfiguration"
  ADD COLUMN "budgetMode" TEXT NOT NULL DEFAULT 'SHARED',
  ADD COLUMN "chatMonthlyBudgetSatang" INTEGER,
  ADD COLUMN "ocrMonthlyBudgetSatang" INTEGER,
  ADD COLUMN "budgetConfigVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pendingBudgetPolicy" JSONB,
  ADD CONSTRAINT "CompanyAiConfiguration_budgetMode_check" CHECK ("budgetMode" IN ('SHARED', 'SPLIT')),
  -- 0 is legal and means "this bucket is closed"; only a negative allocation is nonsense.
  ADD CONSTRAINT "CompanyAiConfiguration_chatMonthlyBudgetSatang_check" CHECK ("chatMonthlyBudgetSatang" >= 0),
  ADD CONSTRAINT "CompanyAiConfiguration_ocrMonthlyBudgetSatang_check" CHECK ("ocrMonthlyBudgetSatang" >= 0);
