\set ON_ERROR_STOP on
BEGIN;

INSERT INTO "Company" ("id", "name", "updatedAt") VALUES
  ('h03-company-1', 'H03 Company 1', now()),
  ('h03-company-2', 'H03 Company 2', now());
INSERT INTO "Branch" ("id", "companyId", "code", "name", "updatedAt") VALUES
  ('h03-branch-1', 'h03-company-1', 'H031', 'H03 Branch 1', now()),
  ('h03-branch-2', 'h03-company-2', 'H032', 'H03 Branch 2', now());
INSERT INTO "AccountingPeriod" ("id", "companyId", "periodKey", "startDate", "endDate", "updatedAt") VALUES
  ('h03-period-1', 'h03-company-1', '2026-07', '2026-07-01', '2026-07-31', now()),
  ('h03-period-2', 'h03-company-2', '2026-07', '2026-07-01', '2026-07-31', now());
INSERT INTO "ChartOfAccount" ("id", "companyId", "code", "nameTh", "accountClass", "normalBalance", "updatedAt") VALUES
  ('h03-account-1', 'h03-company-1', 'H03-1', 'H03 local 1', 'ASSET', 'DEBIT', now()),
  ('h03-account-2', 'h03-company-2', 'H03-2', 'H03 local 2', 'ASSET', 'DEBIT', now());
INSERT INTO "ChartOfAccount" ("id", "companyId", "code", "nameTh", "accountClass", "normalBalance", "isSystem", "updatedAt")
  VALUES ('h03-account-system', NULL, 'H03-SYS', 'H03 approved system', 'ASSET', 'DEBIT', true, now());

DO $$
BEGIN
  BEGIN
    INSERT INTO "JournalEntry" ("id", "companyId", "periodId", "entryNumber", "entryType", "entryDate", "createdByUserId", "updatedAt")
      VALUES ('h03-bad-period', 'h03-company-1', 'h03-period-2', 'H03-BAD-PERIOD', 'MANUAL', '2026-07-18', 'h03-user', now());
    RAISE EXCEPTION 'expected cross-company period rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

INSERT INTO "JournalEntry" ("id", "companyId", "periodId", "entryNumber", "entryType", "entryDate", "createdByUserId", "updatedAt")
  VALUES ('h03-journal-1', 'h03-company-1', 'h03-period-1', 'H03-JV-1', 'MANUAL', '2026-07-18', 'h03-user', now());

DO $$
BEGIN
  BEGIN
    INSERT INTO "JournalLine" ("id", "companyId", "journalEntryId", "accountId", "lineNumber", "debitAmount")
      VALUES ('h03-bad-account', 'h03-company-1', 'h03-journal-1', 'h03-account-2', 1, 100);
    RAISE EXCEPTION 'expected cross-company account rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "JournalLine" ("id", "companyId", "journalEntryId", "accountId", "branchId", "lineNumber", "debitAmount")
      VALUES ('h03-bad-branch', 'h03-company-1', 'h03-journal-1', 'h03-account-1', 'h03-branch-2', 1, 100);
    RAISE EXCEPTION 'expected cross-company branch rejection';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "JournalLine" ("id", "companyId", "journalEntryId", "accountId", "lineNumber", "debitAmount", "sourceType")
      VALUES ('h03-bad-source', 'h03-company-1', 'h03-journal-1', 'h03-account-1', 1, 100, 'forged.source');
    RAISE EXCEPTION 'expected manual provenance rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO "JournalLine" ("id", "companyId", "journalEntryId", "accountId", "branchId", "lineNumber", "debitAmount")
  VALUES ('h03-valid-local', 'h03-company-1', 'h03-journal-1', 'h03-account-1', 'h03-branch-1', 1, 100);
INSERT INTO "JournalLine" ("id", "companyId", "journalEntryId", "accountId", "lineNumber", "creditAmount")
  VALUES ('h03-valid-system', 'h03-company-1', 'h03-journal-1', 'h03-account-system', 2, 100);

UPDATE "ChartOfAccount" SET "status" = 'INACTIVE', "updatedAt" = now() WHERE "id" = 'h03-account-1';
DO $$
BEGIN
  BEGIN
    UPDATE "JournalEntry" SET "status" = 'POSTED', "updatedAt" = now() WHERE "id" = 'h03-journal-1';
    RAISE EXCEPTION 'expected inactive-account post rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SELECT 'H-03 database invariants PASS' AS result;
ROLLBACK;
