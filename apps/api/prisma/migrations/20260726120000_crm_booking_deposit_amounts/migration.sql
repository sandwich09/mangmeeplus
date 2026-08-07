-- Booking-time amount snapshot for the manage-appointment popup (มัดจำ / คงเหลือที่ต้องจ่าย)
ALTER TABLE "CrmBooking" ADD COLUMN "depositAmount" DECIMAL(12,2);
ALTER TABLE "CrmBooking" ADD COLUMN "totalAmount" DECIMAL(12,2);
