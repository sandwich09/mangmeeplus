# P27 Phase 4B — local UI evidence (2026-08-27)

Branch: `codex/p27-ledger-ui-phase4b`

Scope: สมุดรายรับ–รายจ่าย desktop/mobile, 6 summary cards, category chart, filters, source links, receivable sorting, receive-payment modal, CSV/XLSX export และ dashboard entry. ไม่รวม subscription และยังไม่รวม Phase 4C VAT-threshold alert / Phase 6 launch gate.

## Browser proof

- Chrome local `http://127.0.0.1:3100`, API `127.0.0.1:3101`, PostgreSQL จริงที่ `localhost:15432`; login ด้วย local seed OWNER
- desktop 1280×900 และ mobile 390×844
- export จากปุ่มจริงตอบ 200 และ toast `ดาวน์โหลด 79 รายการแล้ว`
- รับชำระ `INV-202608-00026` จำนวน 500.00 บาทจาก modal จริง; toast สำเร็จ, แถวหายจาก receivable, ในแท็บทั้งหมดเหลือยอดค้าง `—`; summary เปลี่ยนรับแล้ว 17,322.06 → 17,822.06 และรอรับ 21,435.00 → 20,935.00
- พบ bug จากการจิ้ม: `CN-202608-00001` เคยเข้า receivable และขึ้นป้าย `รอรับ ฿1.03`; แก้ query/output ให้ credit note เป็นยอดปรับลด `-1.03` แต่ไม่มียอดค้าง/ปุ่มรับชำระ; reload desktop/mobile แล้วไม่พบใน receivable
- fresh Chrome console: error 0, warn 0 หลัง reload/fix/payment/export

## Images

1. `01-ledger-desktop.jpg` — desktop full page ก่อนรับชำระ
2. `02-export-success-desktop.jpg` — toast export 79 รายการ
3. `03-receive-payment-success-desktop.jpg` — receivable หลังรับชำระ (invoice เป้าหมายหาย)
4. `04-ledger-mobile-top.jpg` — mobile card list หลังแก้ credit note (ไม่มีป้ายรอรับ)
5. `05-ledger-mobile-summary.jpg` — mobile 2×3 summary หลังรับชำระ
6. `06-receive-payment-modal-mobile.jpg` — mobile payment modal, CTA และช่องกรอกไม่ล้น viewport

## Automated verification

- real PostgreSQL `prisma-accounting.repository.atomic-issue.spec.ts`: 9/9, 0 skipped
- focused API payment/money/atomic suite: 25/25
- web ledger/workspace focused: 83/83
- contracts: 196/196
- web full: 1109/1109
- API full: exit 0 (pretest + test)
- API/web typecheck: pass
- Prisma validate + migration deploy: pass (`20260827090000_accounting_payment_idempotency`)
- `git diff --check`: pass

Regression ที่เพิ่มจาก browser finding สร้าง credit note ที่มี persisted outstanding บวกโดยตั้งใจ แล้วพิสูจน์ว่า:

- summary ยังคงหักยอด credit note จากยอดขายเอกสาร
- ALL แสดง amount ติดลบและไม่ส่ง `outstandingAmount`
- RECEIVABLE คืน 0 เมื่อ invoice ปิดยอดแล้วและมีเพียง credit note ค้างในฐานข้อมูล
