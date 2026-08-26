# Growth และ UX รอบเต็ม — Spec P24

สถานะ: **READY FOR BASELINE/UX CODING** — ไม่รอ P26; pricing/subscription/quota enforcement อยู่นอก scope การรีวิวนี้; แผนส่งมอบอยู่ใน [Four-lane Gap Closure Plan](../plans/mangmee-four-lane-gap-closure-plan-th.md#p24--growthux-full-pass)

ขอบเขตจาก [แผนหลัก P24](../plans/mangmee-brain-2-5-day-priority-plan-th.md): (1) self-service signup/trial + onboarding checklist + lead attribution (2) navigation ตามบทบาท + preference/memory แบบ opt-in ลบได้ (3) full real-device matrix + font/touch-target audit ทุกหน้าลูกค้า

## 1. ความสัมพันธ์กับ spec ที่มีอยู่ (ไม่เขียนซ้ำ)

| เรื่อง | ครอบโดย | P24 เติมอะไร |
|---|---|---|
| Mobile-first baseline (390px, dvh, touch targets) | [mobile-first-launch-features-spec](mobile-first-launch-features-spec.md) + ผล responsive เดิม (`e2e/RESPONSIVE-RESULTS-2026-08.md`) | ยกจาก "หน้า launch" เป็น **ทุกหน้าลูกค้า** + เกณฑ์ device matrix จริง (§3) |
| Theme/component เอกภาพ | [mangmee-system-ui-alignment-spec](mangmee-system-ui-alignment-spec.md) | audit ครอบหน้าใหม่ของ P27/P28 ด้วยเกณฑ์เดียวกัน |
| กติกา "ไม่มีปุ่มพาไปตาย" + สถานะกลาง | [ledger spec §F-LED-7](mangmee-income-expense-ledger-spec-th.md) | ประกาศเป็นมาตรฐานระบบ: ทุกหน้าใหม่หลัง 2026-08-26 ต้องผ่าน checklist F-LED-7 |
| Signup/trial | [P10/P11 specs](mangmee-external-signup-contract-spec-th.md) (สัญญา/กลไก) | P24 คือฝั่ง conversion: หน้า trial, onboarding checklist ในแอป, การวัด funnel |
| PDPA / opt-in memory | [pdpa-notice-and-ai-opt-out-spec](pdpa-notice-and-ai-opt-out-spec.md) | preference/memory ต้อง opt-in, ดู-ลบได้จากหน้าตั้งค่า, ไม่เก็บใน prompt log |

## 2. ข้อกำหนด

### 2.1 Self-service trial + onboarding checklist

- หลัง claim สำเร็จ (P11) ผู้ใช้ใหม่เห็น checklist 3 ข้อแรกในแอป (ผูกกับ StartHereHero เดิม): เชื่อม LINE → ถ่ายใบเสร็จใบแรก → เปิดสมุดรายรับ–รายจ่าย; ข้อที่ทำแล้วติ๊กจริงจากข้อมูล (ไม่ใช่ localStorage)
- Lead attribution: referral/campaign code ไหลจากฟอร์มสมัคร (P10 payload มีแล้ว) → เก็บบน Company record → รายงาน conversion ต่อ campaign แบบนับจำนวน ไม่เก็บ identifier ภายนอกเกินจำเป็น
- นิยาม "activated" ที่วัดได้: บริษัทที่มีใบเสร็จยืนยันแล้ว ≥1 ภายใน 7 วันหลัง claim — ใช้เป็นตัวเลขเดียวกันทั้ง product/marketing
- P24 ใช้ cohort/entitlement allowlist เดิมเพื่อเปิด trial แบบควบคุม; **ไม่กำหนดราคา วันหมดอายุ โควตา หรือ enforcement** และห้ามแอบพึ่ง P26 — ถ้าภายหลังมี billing ให้เชื่อมผ่าน entitlement contract แยก

### 2.2 Navigation ตามบทบาท + preference

- เมนูเรียงตามบทบาทหลักของ user ในบริษัทนั้น (Owner เห็นสมุด/งานค้างก่อน, พนักงานเห็นถ่ายใบเสร็จก่อน) — กติกา: การเรียงเปลี่ยนได้ การมองเห็นยังมาจาก permission/entitlement เดิมเท่านั้น (ห้ามใช้ preference เปิดสิทธิ์)
- preference (เมนูโปรด, แท็บเริ่มต้น, ภาษา) เก็บฝั่ง server ต่อ user+company, opt-in, มีหน้า "ดู/ลบข้อมูลการตั้งค่า" ตาม PDPA spec; ไม่มี preference ใดเปลี่ยนผลการคำนวณเงิน/ภาษี

### 2.3 Real-device matrix + audit

- Matrix ขั้นต่ำก่อนขยายวง: iOS Safari (iPhone SE/มาตรฐาน), Android Chrome (จอ 360–412px), iPad แนวตั้ง, desktop 1280+ — รันชุด `responsive` เดิม + เดินเอง 5 journey หลัก (login, ถ่ายใบเสร็จ→ยืนยัน, บันทึกรายรับ, สมุด, จ่ายบิล)
- Audit อัตโนมัติ: font ≥16px เนื้อหา, touch target ≥44px, contrast ผ่าน — เพิ่มเข้า checklist E2E responsive ที่มีอยู่ ไม่สร้างเครื่องมือใหม่
- ทุกหน้าที่ fail = issue พร้อม severity เข้าคิวแก้ก่อนเปิดวงถัดไป (เกณฑ์เดียวกับ Gate E)

## 3. Acceptance

1. ผู้ใช้ใหม่จากสมัครเอง → activated โดยไม่มีมนุษย์ช่วย ≥ เป้าที่ Owner ตั้งต่อ cohort (ตัวเลขตั้งหลังมี baseline — ห้ามตั้งจากความรู้สึก)
2. checklist สะท้อนสถานะจริง 100% (สุ่มตรวจ 20 บริษัท)
3. matrix + audit ผ่านทุก journey หลักบนอุปกรณ์จริงอย่างน้อย 1 เครื่องต่อกลุ่ม พร้อมหลักฐานรุ่น/ผล
4. preference ลบแล้วหายจริงทุก surface และไม่กระทบตัวเลขใด ๆ

## 4. คำถาม Owner (ไม่ block baseline)

1. เป้า activation rate แรกที่ยอมรับได้ (ตั้งหลังเห็น baseline cohort แรก; ไม่ block instrumentation/checklist/device audit)
