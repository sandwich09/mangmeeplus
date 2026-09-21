# Plan: บริษัทเดิมซื้อแพ็กเกจ catalog เอง

วันที่ 2026-09-21 · สถานะ **LOCAL IMPLEMENTATION / รอ integrated UAT และ release gate** · [Spec](../specs/mangmee-existing-company-self-purchase-spec-th.md) · [Memory](../agent-memory/legacy-company-self-purchase.md)

## ลำดับงานและจุดตรวจ

1. **Inventory / contract freeze**: สำรวจ read-only cohort ใน local/UAT และ Production ตาม runbook ก่อนแตะ cloud: no-term, manual, trial, paid current/other mode, empty account, deal, feature rows/override, capacity, hold, active attempt. บันทึกเพียง counts/anonymized examples. ตรวจกฎ paid deal→catalog ที่ยังรอ Owner ตัดสินก่อนเปิด cohort นี้; reconcile Sales spec R9/S14 กับ D5. ยืนยัน catalog policy/gates และ code source ที่กำลังเปลี่ยนจากงานอื่น
2. **Source และ quote admission**: ทำ classifier/eligibility ที่ status+quote+checkout ใช้ร่วมกัน; เอา blanket `BILLING_LEGACY_REVIEW_REQUIRED` ออกจาก no-term/manual เฉพาะที่ผ่าน preflight. แยก paid proof จาก BillingAccount row; quote snapshot pin term, feature, capacity, deal/hold revisions และ replacement policy; เพิ่ม DTO/error mapping/source copy. ไม่มี endpoint/dependency ใหม่ถ้า flow เดิมพอ
3. **Paid apply ที่ครบสิทธิ์**: ใช้ Company/account/invoice locks, source fences และ `BillingReconcilerService` เดิม. ประกอบ approved feature snapshot กับ Admin override/provenance ผ่าน entitlement transition service, capacity, paid receipt grants, term/lifecycle, audit/outbox และ APPLIED ใน transaction เดียว; มี paid+HELD/retry invoice เดิมเมื่อ preflight พลาดหรือ source drift. ตรวจ lock order กับ OCR/entitlement writers; เติม migration เฉพาะถ้าพิสูจน์ว่า schema เดิมแยก provenance ไม่ได้
4. **UI/LINE/ops**: หน้าเว็บและ LINE entry แสดง source/วันไม่ทบ/feature+capacity impact/consent, no-term label, status→quote เหตุผลตรงกัน, pending/failed/held recovery, company switch. Admin timeline/source/issue และ package request/deal supersede/attribution อ่านได้; public catalog/marketing ไม่ใส่ per-company eligibility
5. **Verification / release**: focused unit สำหรับ classifier/hash/impact, PostgreSQL transaction+fault/race สำหรับ apply และ writers, HTTP/auth for OWNER/employee/holds/modes, browser 390px/desktop และ native UAT Stripe card success/failure/duplicate/unknown. ตรวจ invoice, term, entitlements/protected action, web+LINE OCR, audit/outbox/notification, operator history. ก่อน UAT/Production อ่าน mandatory deployment runbook, เก็บ exact run IDs และ signed result/customer OPEN. ไม่เรียก release ผ่านจาก simulated test อย่างเดียว

## Gate ที่ห้ามข้าม

- EC01–EC10 ใน [spec §7](../specs/mangmee-existing-company-self-purchase-spec-th.md) มีหลักฐานหรือระบุ blocker ตรงข้อ; paid manual/no-term ต้องพิสูจน์จริงก่อนเปิด cohort นั้น
- ยังไม่มีมติ credit สำหรับ **ดีลที่ลูกค้าจ่ายแล้ว → catalog**: ปิด collectible quote เฉพาะ source `DEAL_APPLIED` จนตัดสิน; อย่าขยายข้อ no-carry ของ Admin term ไปใช้กับดีลโดยปริยาย
- ศึกษา feature provenance ก่อนเลือก migration/overwrite; ห้ามถือ `grantOrigin=null` เป็น package-owned ทั้งหมด และห้ามแปลง legacy fail-open เป็น paid โดยไม่แสดง feature impact
- เก็บ unrelated working-tree changes ไว้; ไม่แก้ `package.json`; ไม่ deploy ก่อนมีหลักฐานตาม release gate

## สถานะหลักฐาน 2026-09-21

ทำ source classifier, quote/checkout/status, feature snapshot และ paid apply, UI คำเตือน, Admin term writer fence, LINE request supersede ใน local แล้ว. ใช้ transition log เดิมแยกสิทธิ์ Admin จึงไม่ต้องเพิ่ม migration ของ entitlement; ไม่แก้ `package.json` หรือ cloud. ตรวจ unit 34 cases, local PostgreSQL 2 cases และ billing grace regression 13 cases ผ่าน; contracts/API/web typecheck ผ่าน. Local test DB `mangmee_billing_20260912` ถูกอัปเดต 4 migrations ที่ค้างเพื่อให้ schema ตรง Prisma ปัจจุบัน. UAT หลักฐานเก่า: no-term quote ถูก guard ปฏิเสธ; trial→paid ผ่าน Stripe Sandbox จริง.

**ถัดไปก่อน release:** เพิ่ม HTTP/auth และ browser/LINE journey สำหรับ EC01–EC10 (local preview E2E ที่ลองรอบนี้ติด dev-login 503 `platform_access_closed` ก่อนเข้าเพจ), ทดสอบ Stripe native paid/fail/duplicate/UNKNOWN บน UAT, inventory Production ตาม runbook, ตรวจ paid+HELD feature drift กับ support/refund path, เก็บ signed release/customer `OPEN`. ยังไม่ query Production หรือ deploy. Paid-deal→catalog รอ Owner ตัดสินมูลค่าที่เหลือเมื่อ deal runtime พร้อม
