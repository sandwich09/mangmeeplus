# Agent Memory: rd-filing-and-data-intake-research

Status: DONE 2026-08-03 — web research 3 สาย (รูปแบบยื่น RD / ช่องทางอัตโนมัติ / FlowAccount+PEAK flows) สรุปที่ `docs/research/rd-filing-and-data-intake-research.md`
Owner: thawtchai (ผู้ขอ) / Claude session 2026-08-03
Scope: หา template + ลำดับการกรอกข้อมูล + วิธีส่งมอบไฟล์ให้สรรพากร + เส้นทางส่งอัตโนมัติ เพื่อใช้เขียน spec ต่อ (ต่อยอดจาก accounting-tax-readiness-assessment)
Decisions:
- ภ.พ.30/36/ภ.ง.ด.51 = คีย์ฟอร์มเท่านั้น → เป้าของระบบคือหน้าสรุปให้คีย์ ไม่ใช่ไฟล์ (ทำให้ RA-15 แคบลง)
- ไฟล์ยื่นจริงตัวเดียว = .txt ใบแนบ ภ.ง.ด.1/1ก/2/2ก/3/3ก/53 → RD Prep → .rdx → อัปโหลด (RD Prep map คอลัมน์ได้ ไม่มี layout บังคับ — fix layout เองแล้วทดสอบกับ RD Prep)
- เส้นอัตโนมัติแนะนำ: (1) ไฟล์ให้ผู้ใช้อัปโหลด (2) e-Tax ผ่าน Service Provider API (3) e-WHT ผ่านธนาคาร (ตัด 50ทวิ+ภงด3/53, อัตรา 1% ถึง 31 ธ.ค. 2570) (4) RD Open API (มีจริงแต่ gated 3 บทบาท) (5) H2H ไม่ realistic
- Wizard เสนอ 6 ระยะ: Step 0 ตัวตนภาษี (ใหม่ — ติด RA-23) → wizard 5 ขั้นเดิม → ยอดยกมาแบบ PEAK 8 ขั้น (ติด RA-08/04) → master data lazy + RD TIN lookup → วงรอบเดือน → วงรอบปี
Open questions: (รายละเอียดใน §8 ของ doc) ประกาศ กค. ฉบับที่ 9 (18 พ.ย. 2568) อาจแก้วันสิ้นสุด +8 วัน; layout สปส.1-10; ทดสอบ layout กับ RD Prep จริง; roster SP/ธนาคาร e-WHT ปัจจุบัน; เงื่อนไขเข้า Open API
Artifacts: `docs/research/rd-filing-and-data-intake-research.md`
Verification: web research อ้าง primary sources (rd.go.th, efiling, etax, ETDA, DBD, SSO) ทุก claim มี URL; จุดยืนยันไม่ได้ระบุใน §8; ผลหนึ่งข้อที่ขัดกันระหว่างแหล่ง (Time Stamp >30M) ตัดสินตามแหล่งทางการ = ไม่จริง
Next: เลือกทำ spec แรกจากงานนี้ — แนะนำ (ก) Step 0 ตัวตนภาษี + TIN validation (ปลดล็อก RA-23) หรือ (ข) .txt ใบแนบ ภ.ง.ด. + ทะเบียนหัก ณ ที่จ่าย (คู่กับการแก้ RA-18/19/20); รอ owner ตัดสิน
