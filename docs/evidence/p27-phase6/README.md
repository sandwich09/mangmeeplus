# P27 Phase 6 — Local Launch-Gate Evidence

วันที่: 2026-08-27
ขอบเขต: local เท่านั้น; ไม่ใช่ UAT/Production และไม่แทน human usability test อายุ 40+ อย่างน้อย 3 คน

## สิ่งที่พิสูจน์

- Critical Playwright LED-01..06 ผ่าน 6/6: ขายสดครบ invoice/payment/receipt, ออกบิลแล้วรับชำระ, archive หมวด, CSV/XLSX parity, permission negative และ CLOSED/runoff behavior
- CLOSED ซ่อนการสร้างเอกสารใหม่, ส่งใบเสนอราคาอนุมัติ และฟอร์มเพิ่มคู่ค้า แต่ยังเปิด edit, issue/payment, linked tax invoice, void และ correction ของรายการเดิม; LED-06 ยิง payment + linked receipt + linked tax-invoice draft + non-VAT credit-note draft สำเร็จจริง ไม่ได้ตรวจแค่ปุ่ม
- Desktop 1280×900 และ mobile 390×844 ไม่มี horizontal overflow; console error = 0
- Real PostgreSQL race: root-first/close-first รวม actual simple-income/conversion preflight, payment-create/payment-void, receipt-create/payment-void, receipt issue/void, tax-create/receipt-void, tax invoice ข้าม invoice/receipt family และ CRM Inbox deal+quotation bundle ผ่านจริง; ฝั่งแพ้ได้ business error ที่คาด ไม่ใช่ deadlock/P2034
- Platform Admin ทำ entitlement `sales_documents` แบบ off → on → off ผ่าน UI จริงบนบริษัท fixture ที่ลบคืนใน `finally`; desktop/mobile ไม่มี overflow หรือ client error
- Focused accounting/CRM/launch-gate regression และ spec-suite coverage ผ่าน; contracts build และ API/web typecheck ผ่าน
- Full API `pretest + test` exit 0, API DI boot smoke ผ่าน และ full web suite 1,112/1,112 ผ่าน

## ภาพหลักฐาน

- `sales-close-desktop.png` — หน้า “ขายและรับเงิน” ตอน CLOSED บน desktop
- `sales-close-mobile.png` — หน้าเดียวกันที่ viewport 390×844
- `platform-admin-entitlement-off-desktop.png` — Platform Admin หลังจบรอบ off/on/off
- `platform-admin-entitlement-off-mobile.png` — หน้าเดียวกันที่ viewport 390×844

## คำสั่งที่รัน

```bash
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/api test:boot
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/web typecheck
DATABASE_URL='postgresql://…local…' pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/accounting-documents/infrastructure/prisma-accounting.repository.atomic-issue.spec.ts \
  src/modules/crm/infrastructure/prisma-crm.repository.spec.ts
DATABASE_URL='postgresql://…local…' pnpm exec playwright test e2e/income-expense-ledger.spec.ts --project=chromium --workers=1
DATABASE_URL='postgresql://…local…' pnpm exec playwright test e2e/system-admin.spec.ts --project=chromium --workers=1 --grep 'SYS-04'
```

Real-DB launch/lifecycle race และ atomic-issue/simple-income suites อยู่ใน `prisma-accounting.repository.atomic-issue.spec.ts`; ใช้ `DATABASE_URL` จาก local workspace แล้ว PostgreSQL cases 14/14 ผ่าน ไม่มี skipped test. CRM atomic bundle real-DB อยู่ใน `prisma-crm.repository.spec.ts` และผ่าน 1/1; strict file pair รวม harness/unit เป็น 26/26. CI สร้างฐานข้อมูล P27 แยก, รัน `prisma migrate deploy`, ตั้ง `P27_REQUIRE_POSTGRES=true` และเรียกสองไฟล์นี้โดยตรง จึงไม่ผ่านแบบ skip เงียบ

ก่อน E2E มีการ sync permission registry ใน local database (`346 permissions`, `13 roles`, `1,452 grants`, `0 revoked`) เพื่อให้ fixture สะท้อน registry ปัจจุบัน ไม่มีการแตะ cloud/UAT/Production
