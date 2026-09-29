-- SD-O12 (Owner 2026-09-29): "ฉันอยากให้ได้ส่วนลดใช้ได้ตลอด เลือกเมื่อจ่าย และถ้าเป็น event เดียวใช้ได้ครั้งเดียวต่อบริษัท ถ้าเป็น event ใหม่ก็ยังใช้ได้"
-- Replaces SD-O5 (one price discount per shop for its whole life). A shop now takes at most one ticket per event
-- (batches with the same stored eventName); the checkout transaction enforces it after the company lock.
-- "SalesEventTicket_batch_company_key" (one ticket per shop per batch) stays.
DROP INDEX IF EXISTS "SalesEventTicket_company_discount_key";
