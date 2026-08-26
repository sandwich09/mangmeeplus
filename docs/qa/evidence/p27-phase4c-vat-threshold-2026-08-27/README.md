# P27 Phase 4C — VAT threshold local evidence

วันที่: 2026-08-27

Branch: `codex/p27-vat-threshold-phase4c`

Target: `develop`

## สิ่งที่พิสูจน์

- alert แสดงเฉพาะ company-wide scope + VAT fact `NOT_REGISTERED`
- ใช้ยอด issued sales documents ตั้งแต่ต้นรอบบัญชีถึงวันนี้ หัก CREDIT_NOTE
- `< 1,440,000` ไม่เตือน; `>= 1,440,000` เตือนใกล้เกณฑ์; `>= 1,800,000` ใช้ข้อความ “แตะหรือเกิน” โดยไม่ฟันธงหน้าที่ภาษี
- ถ้า period/status/scope ไม่พร้อม หรือ VAT accessor ชั่วคราวล้ม จะซ่อน alert โดยไม่ทำให้สมุดหลักล่ม
- UI ภาษาไทยอ่านง่าย, CTA ขั้นต่ำ 44px, ใช้ได้ที่ desktop 1280×900 และ mobile 390×844
- สถานะ REACHED มีข้อความ 30 วันแบบมีเงื่อนไขและลิงก์หลักเกณฑ์กรมสรรพากร
- browser console `error/warn = 0`

## ภาพจาก local UI จริง

- `desktop-1280x900-top.png` — APPROACHING ด้านบนของหน้า
- `desktop-1280x900-full.png` — APPROACHING แบบเต็มหน้า
- `mobile-390x844-top.png` — สรุป 6 ช่องบนมือถือ
- `mobile-390x844-alert.png` — APPROACHING บนมือถือ
- `mobile-390x844-full.png` — APPROACHING แบบเต็มหน้า
- `desktop-1280x900-reached.png` — REACHED สีแดง + conditional deadline
- `mobile-390x844-reached.png` — REACHED สีแดง + conditional deadline

## Verification

- API domain: 22/22 pass
- Web ledger logic: 9/9 pass
- Real PostgreSQL accounting integration: 9/9 pass, 0 skip
- Full API suite: exit 0
- Full Web suite: 1110/1110 pass
- Contracts suite: 196/196 pass
- `@watchdog-bms/contracts build`: pass
- API typecheck: pass
- Web typecheck: pass
- Nest boot DI smoke: pass; every provider resolved
- `git diff --check`: pass
- Chrome local DOM ยืนยัน official link และ conditional 30-day copy; console error/warn = 0 ทั้ง desktop/mobile

ข้อมูล QA เป็นเอกสาร `QA-VAT-ALERT-20260827` แบบชั่วคราวใน local database เท่านั้น หลังถ่ายหลักฐานลบแล้วและคืน VAT fact เดิมเป็น `REGISTERED`; ตรวจซ้ำได้ `qaCount=0` และหน้าไม่เหลือ alert/เอกสาร QA

## แหล่งกฎหมายที่ใช้กำกับข้อความ

- กรมสรรพากร: https://www.rd.go.th/7061.html
- ประมวลรัษฎากร มาตรา 85/1: https://www.rd.go.th/5208.html
- พระราชกฤษฎีกา ฉบับที่ 432: https://www.rd.go.th/22841.html
- ผู้ประกอบกิจการที่ไม่ต้องจด VAT: https://www.rd.go.th/7060.html
