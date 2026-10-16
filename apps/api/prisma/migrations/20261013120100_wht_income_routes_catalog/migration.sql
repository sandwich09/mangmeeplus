-- New unconfirmed rates use 0 only as a non-selectable DRAFT placeholder. Existing rates are preserved.
INSERT INTO "WhtIncomeCategory" ("id", "code", "nameTh", "formType", "filingRoute", "defaultRate", "status", "updatedAt") VALUES
('wht_prize-route', 'WHT_PRIZE', 'รางวัลจากการประกวด แข่งขัน หรือชิงโชค (บุคคลธรรมดา)', 'PND3', 'SYSTEM_FILLS', 5.0000, 'ACTIVE', CURRENT_TIMESTAMP),
('wht_prize_jur-route', 'WHT_PRIZE_JUR', 'รางวัลจากการประกวด แข่งขัน หรือชิงโชค (นิติบุคคล)', 'PND53', 'SYSTEM_FILLS', 0.0000, 'DRAFT', CURRENT_TIMESTAMP),
('wht_interest-route', 'WHT_INTEREST', 'ดอกเบี้ย (บุคคลธรรมดา)', 'PND2', 'SEPARATE_PND2', 1.0000, 'DRAFT', CURRENT_TIMESTAMP),
('wht_interest_jur-route', 'WHT_INTEREST_JUR', 'ดอกเบี้ย (นิติบุคคล)', 'PND53', 'ACCOUNTANT_PREPARES', 0.0000, 'DRAFT', CURRENT_TIMESTAMP),
('wht_dividend_ind-route', 'WHT_DIVIDEND_IND', 'เงินปันผล (บุคคลธรรมดา)', 'PND2', 'SEPARATE_PND2', 0.0000, 'DRAFT', CURRENT_TIMESTAMP),
('wht_dividend-route', 'WHT_DIVIDEND', 'เงินปันผล (นิติบุคคล)', 'PND53', 'ACCOUNTANT_PREPARES', 10.0000, 'DRAFT', CURRENT_TIMESTAMP),
('wht_other_ind-route', 'WHT_OTHER_IND', 'อื่นๆ (บุคคลธรรมดา)', 'PND3', 'ACCOUNTANT_PREPARES', 3.0000, 'ACTIVE', CURRENT_TIMESTAMP),
('wht_other_jur-route', 'WHT_OTHER_JUR', 'อื่นๆ (นิติบุคคล)', 'PND53', 'ACCOUNTANT_PREPARES', 3.0000, 'ACTIVE', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "nameTh" = EXCLUDED."nameTh", "formType" = EXCLUDED."formType", "filingRoute" = EXCLUDED."filingRoute", "status" = EXCLUDED."status", "defaultRate" = CASE WHEN EXCLUDED."code" = 'WHT_PRIZE' THEN 5.0000 ELSE "WhtIncomeCategory"."defaultRate" END, "updatedAt" = CURRENT_TIMESTAMP;
