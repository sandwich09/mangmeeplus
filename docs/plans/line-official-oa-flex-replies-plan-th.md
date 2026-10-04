# แผนการ์ดตอบกลับ Official OA

Spec: `docs/specs/line-official-oa-flex-replies-spec-th.md`

- [x] Owner อนุญาต API/ระบบตอบกลับ; แยก admin registration email จาก public contact email
- [x] เลือก isolated worktree จาก remote default branch เพื่อรักษางานค้างใน primary checkout
- [x] ปรับ Contact/Social draft และ PNG icons; ตรวจ iframe 320px, การ์ดกว้าง 260px, ไม่มีข้อความล้น; owner รับรูปแบบและขอเฉดสีเข้าคู่ rich menu
- [x] เพิ่ม config ของ OA Official และ controller แยก โดย reuse verifier/config/module patterns เดิม
- [x] ตรวจ HMAC isolation, known/unknown keyword routing, disabled mode และ error delivery: focused tests 5/5, system webhook regression 11/11, API typecheck ผ่านด้วย heap 8192 MiB
- [x] Owner ลงทะเบียน LINE Developers, verified admin email และยอมรับ Messaging API terms เอง; provider/channel เปิดแล้ว
- [x] ออก/เก็บ dedicated credential นอก Git; GET bot info ยืนยัน @107ewccg และ LINE validate/reply ตรวจทั้งสอง Flex ผ่าน HTTP 200 โดยไม่ส่งข้อความ
- [x] เพิ่ม tracked Production flag และ secure runtime resolution/version freshness ตาม Kamal/Postmark pattern; UAT คงปิด. Kamal tests 42/42 และ API tests/typecheck ผ่าน
- [ ] Provision Secrets Manager เฉพาะสอง key ของ Official OA; ไม่มีการอ่าน/แก้ AWS หรือ credentials ของ OA ระบบในขั้น local preparation
- [ ] เตรียมและดำเนิน deployment ตาม mandatory protocol, บันทึก exact source/run IDs และ signed acceptance
- [ ] Verify webhook/assets, เปิด OA webhook, ปิดเฉพาะสอง native auto replies หลังผ่าน; owner ทดสอบทั้งสองการ์ดบนโทรศัพท์

ไม่มี schema/identity/ERP/AI changes และไม่มี package.json หรือ dependency changes. คง rich menu, native welcome/how-to/package, manual chat และ OA ระบบตามเดิม.

## Owner-selected isolated publication — 2026-10-04

- [x] Owner authorized local checks/release instead of GitHub billing-blocked CI and selected OA-only scope
- [x] Existing non-root Production preflight passed; no ERP deployment. UAT is stopped and stays unchanged
- [x] Dedicated secret creation denied to existing non-root writer; no credential was provisioned and no IAM escalation
- [x] Build standalone Lambda artifact by reusing existing mapper/verifier/JSON/icons; local tests 5/5 and scoped template assertions PASS
- [ ] Prepare narrow CloudFormation change set and obtain an authorized non-root platform/deployment session
- [ ] Publish staging immutable version, check actual provider/three icon paths, promote live to the same version
- [ ] Verify and enable Official webhook; stop only native Social/Contact; retain signed ledger and owner phone result
