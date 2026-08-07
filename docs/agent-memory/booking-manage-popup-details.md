# Agent Memory: booking-manage-popup-details

Status: IMPLEMENTED + VERIFIED — 2026-07-26
Owner: Claude (direct implementation per owner request)
Scope: การจองออนไลน์ (bookings) — staff label rename, Auto Book display, and booking amount snapshot (มัดจำ/ราคารวม) end-to-end: prisma + migration + contracts + API + web.
Decisions:
- "ช่าง" → "พนักงานที่ดูแล" everywhere on BookingsPrototypePage (calendar card, create form, reschedule form; "ไม่เปลี่ยนช่าง" → "ไม่เปลี่ยนพนักงาน").
- Auto Book: bookings with `source === 'LINE'` (the AI auto-booking flow) display "Auto Book" instead of the staff name — pure helper `bookingStaffDisplay` in bookings.model.ts.
- Deposit data did NOT exist anywhere: added `depositAmount`/`totalAmount` Decimal(12,2) nullable columns to CrmBooking (migration 20260726120000_crm_booking_deposit_amounts), snapshot entered at create time only (create form gains two optional บาท inputs). Update path intentionally does not edit amounts (MVP). LINE bookings have no amounts.
- Validation in CreateCrmBookingUseCase: `parseBookingAmount` → finite ≥ 0, normalized toFixed(2); `deposit_exceeds_total` when both present.
- Manage popup (จัดการนัดหมาย) detail block: ชื่อลูกค้า (summary), เบอร์โทร (lazy `getCrmCustomer` per selection, OPERATIONAL primaryPhone, requires crm.customer.read else —), มัดจำ, คงเหลือที่ต้องจ่าย = total − deposit floored at 0 (`bookingAmountText`/`bookingOutstandingText`, unit-tested).
- CrmBookingRecord.depositAmount/totalAmount typed `unknown` (Prisma Decimal or fake string); mapper renders `String(value)` and omits when null.
Open questions: none. (Editing amounts after create + showing amounts on the calendar card = possible follow-ups.)
Artifacts: apps/api/prisma/schema.prisma + migrations/20260726120000_crm_booking_deposit_amounts; packages/contracts/src/crm.ts (CrmBookingSummary/CreateCrmBookingInput); apps/api crm-booking.use-case.ts, crm.mapper.ts, prisma-crm.repository.ts (BookingCreateData), crm.model.ts (CrmBookingRecord); apps/web bookings.model.ts(+spec), BookingsPrototypePage.tsx.
Verification: prisma validate ✓; prisma generate + API tsc --noEmit clean ✓; crm-booking.use-case.spec 24/24 ✓; contracts build ✓; web test 352/352 (348 + 4 new) ✓; web typecheck + build ✓. Manual browser walk pending stack.
Next: when stack up — create booking with amounts, verify popup shows all four rows, LINE auto-booking shows Auto Book.
