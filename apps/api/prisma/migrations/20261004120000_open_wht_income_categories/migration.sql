-- Owner decision 2026-10-04: open 12 global categories; insert the three exceptions as DRAFT.
-- Preserve existing codes, ids, names, rates, review notes and exceptional statuses.
INSERT INTO "WhtIncomeCategory"
  ("id", "code", "nameTh", "nameEn", "formType", "defaultRate", "status", "conditionNote", "updatedAt")
VALUES
  ('wht-catalog-service-ind', 'WHT_SERVICE_3', 'ค่าบริการ (บุคคลธรรมดา)', 'Service fee (individual)', 'PND3', 3.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-service-jur', 'WHT_SERVICE_5', 'ค่าบริการ (นิติบุคคล)', 'Service fee (juristic)', 'PND53', 3.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-rent-ind', 'WHT_RENT_IND', 'ค่าเช่า (บุคคลธรรมดา)', 'Rent (individual)', 'PND3', 5.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-rent-jur', 'WHT_RENT_JUR', 'ค่าเช่า (นิติบุคคล)', 'Rent (juristic)', 'PND53', 5.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-professional-ind', 'WHT_PROFESSIONAL_IND', 'ค่าวิชาชีพ (บุคคลธรรมดา)', 'Professional fee (individual)', 'PND3', 3.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-professional-jur', 'WHT_PROFESSIONAL_JUR', 'ค่าวิชาชีพ (นิติบุคคล)', 'Professional fee (juristic)', 'PND53', 3.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-advertising-ind', 'WHT_ADVERTISING_IND', 'ค่าโฆษณา (บุคคลธรรมดา)', 'Advertising fee (individual)', 'PND3', 2.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-advertising-jur', 'WHT_ADVERTISING_JUR', 'ค่าโฆษณา (นิติบุคคล)', 'Advertising fee (juristic)', 'PND53', 2.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-transport-ind', 'WHT_TRANSPORT_IND', 'ค่าขนส่ง (บุคคลธรรมดา)', 'Transport fee (individual)', 'PND3', 1.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-transport-jur', 'WHT_TRANSPORT_JUR', 'ค่าขนส่ง (นิติบุคคล)', 'Transport fee (juristic)', 'PND53', 1.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-dividend', 'WHT_DIVIDEND', 'เงินปันผล', 'Dividend', 'PND53', 10.0000, 'DRAFT', 'รอนักบัญชีตรวจสอบก่อนเปิดใช้', CURRENT_TIMESTAMP),
  ('wht-catalog-interest', 'WHT_INTEREST', 'ดอกเบี้ย', 'Interest', 'PND3', 1.0000, 'DRAFT', 'รอนักบัญชีตรวจสอบก่อนเปิดใช้', CURRENT_TIMESTAMP),
  ('wht-catalog-prize', 'WHT_PRIZE', 'รางวัล', 'Prize / award', 'PND3', 5.0000, 'DRAFT', 'รอนักบัญชีตรวจสอบก่อนเปิดใช้', CURRENT_TIMESTAMP),
  ('wht-catalog-other-ind', 'WHT_OTHER_IND', 'อื่นๆ (บุคคลธรรมดา)', 'Other (individual)', 'PND3', 3.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP),
  ('wht-catalog-other-jur', 'WHT_OTHER_JUR', 'อื่นๆ (นิติบุคคล)', 'Other (juristic)', 'PND53', 3.0000, 'ACTIVE', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "status" = EXCLUDED."status", "updatedAt" = CURRENT_TIMESTAMP
WHERE EXCLUDED."status" = 'ACTIVE' AND "WhtIncomeCategory"."status" <> 'ACTIVE';
