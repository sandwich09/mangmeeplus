# แผน implement: LINE AI expense summary follow-up

สถานะ: implement และตรวจบนต้นทาง develop ล่าสุดแล้ว; ยังไม่ deploy หรือทดสอบ LINE จริง

## เป้าหมาย

แก้ follow-up เรื่องยอดค่าใช้จ่ายให้ยืนยันเกณฑ์เดิมได้อย่างปลอดภัย, refresh ช่วง/สาขาที่ระบุได้, และไม่สร้างตัวเลขจาก filter ที่ LINE tool ยังไม่มี

## ขอบเขตและการตัดสินใจ

- ใช้ ERP read tool และสิทธิ์/ABAC เดิมเท่านั้น; AI Gateway ไม่อ่าน ERP repository
- หลักฐานผลเดิมเป็น descriptor ที่ไม่มีจำนวนเงิน ผูกกับ `LineReadEvidence`, turn, chat recipient, current access fingerprint และ `LineTurnOutcome.deliveredAt`
- ยืนยันว่า “ผลก่อนหน้าใช้เกณฑ์นี้” ได้เฉพาะเมื่อ actual tool input/result ครอบคลุมทุก candidate period ที่ API สร้าง, ทุก call สำเร็จ, ไม่ truncated, และ outcome ส่งถึง LINE แล้ว; ถ้าพิสูจน์ไม่ได้ให้บอกกติกาทั่วไปหรือถามช่วง โดยไม่อ้างคำตอบเก่า
- descriptor ตรวจ current identity, company, membership, entitlement, permission, branch scope และ chat โดยไม่ re-query ERP; การ refresh ตัวเลขยังอ่าน ERP ใหม่ตาม flow ปกติ
- queued/reclaimed turns ต้องสร้าง follow-up context และ proof ภายใต้ chat เดิมกับ access ปัจจุบัน หรือ fail closed
- prepared lane ต้องไม่รับคำขอที่ระบุสาขา; full loops ต้องคง branch input และปฏิเสธ tool call ที่ละสาขาหรือส่งช่วงวันที่ไม่ครบ/ไม่ตรง candidate
- `expense.list_recent` ต้อง resolve ชื่อสาขาให้ unique และระบุข้อจำกัด catalog เมื่อเกิน lookup cap; ต้องไม่เลือกผลชื่อซ้ำตัวแรก
- unsupported status/payment/category filters ตอบข้อจำกัดของ tool โดยไม่ใช้ยอด default แทน
- mixed-intent turn ยังตอบหัวข้ออื่นที่ route ได้เมื่อคำขอ expense เป็นการยืนยันเกณฑ์หรือ filter ที่ระบบยังไม่รองรับ; คำถามที่ไม่มีบริบท expense ห้ามได้ fixed expense reply; status typo ต้องถามกลับก่อนอ่านยอด
- duplicate/unresolved branch ตอบเป็นภาษาใช้งานทั่วไปและให้เลือกสาขาจากเว็บ; ห้ามขอหรือแสดง code/UUID ในข้อความ LINE. Branch name/code ที่ผ่าน API resolution ใช้ resolved ID เป็น internal scope และคำตอบใช้ได้เฉพาะชื่อมนุษย์ที่ผู้ใช้พิมพ์
- Expense reply labels and as-of dates use Thai calendar wording; the answer card text equals the final reply text.

## จุดเปลี่ยน

1. API `LineReadEvidenceService`: บันทึก non-monetary effective period/branch/status/truncation/asOf descriptor จากผลจริง; สร้าง turn descriptor เฉพาะเมื่อ evidence และ tool calls ตรงกันและทุก requested period มี coverage
2. API LINE webhook/delivery: ผูก descriptor กับ outcome authorization; สร้าง prior context ได้เฉพาะ delivered outcome ใน chat เดิมและภายใต้ current access; รองรับ read-free criterion confirmation ผ่าน access-only authorization ที่ตรวจซ้ำได้เมื่อต้อง replay
3. AI Gateway: preserve period pair; อนุญาต multiple distinct `expense.list_recent` calls ใน JSON loop; force branch requests out of prepared lane และ enforce explicit branch input in full loops; deterministic answer path ใช้ descriptor เฉพาะเมื่อ API ส่ง proof ที่ผ่าน validation. เมื่อ orchestration flag ปิด ให้ยืนยันเกณฑ์ด้วย fixed read-free reply ที่ผ่าน permission/entitlement, รองรับ default เดือนปัจจุบันผ่าน expense tool เดิม และถามกลับสำหรับช่วง/สาขาที่ lane นี้ตรวจไม่ได้
4. API expense tool: reject one-sided date ranges, resolve branch by exact ID/code/name with duplicate detection, and signal lookup cap without false “not found”
5. Update task memory and focused checks for proof provenance, delivery/replay, period completeness, branch scope, unsupported filter, and all changed contracts.

## Verification

ผลคำสั่งและข้อจำกัด typecheck อยู่ใน [`docs/agent-memory/line-ai-expense-summary-followup-implementation-2026-09-25.md`](../agent-memory/line-ai-expense-summary-followup-implementation-2026-09-25.md). Full webhook-to-LINE E2E, real LINE, UAT, และ deploy ยังไม่ทำ

## Known boundary

The current expense list summary pages and counts in separate repository calls rather than one database snapshot. `truncated=false` proves the page cap was not hit, but does not guarantee transactionally consistent totals during concurrent writes. This change records that as a residual source-consistency risk.
