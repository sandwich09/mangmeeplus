# แผนรวม FlowAccount Parity (P27+P28) — สารบัญ

สถานะ: **ACTIVE — ภาค 1 อยู่ระหว่างทำ (Phase 0–2 ✅ → คิวถัดไป Phase 3); ภาค 2 เริ่มหลังภาค 1 จบ**

ไฟล์นี้เป็น**สารบัญอย่างเดียว** (กติกา Owner 2026-08-26: รวมแค่หัวข้อ แล้วลิงก์กลับเอกสารเดิม) — เนื้อหาเต็ม กติกาการทำงาน ความเสี่ยง และ test matrix อยู่ในแผนเดิมสองฉบับ ห้ามคัดลอกเนื้อหามาไว้ที่นี่:

| ภาค | แผนฉบับเต็ม | Spec |
|---|---|---|
| 1 — ขาย–รับเงิน (สมุดรายรับ–รายจ่าย, P27) | [mangmee-income-expense-ledger-plan-th.md](mangmee-income-expense-ledger-plan-th.md) | [spec](../specs/mangmee-income-expense-ledger-spec-th.md) |
| 2 — ซื้อ–จ่ายเงิน + ใบลดหนี้ฝั่งซื้อ (P28) | [mangmee-purchase-to-pay-mvp-plan-th.md](mangmee-purchase-to-pay-mvp-plan-th.md) | [spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) |

## คิวรวม 13 ขั้น (ทำบนลงล่าง)

| คิว | อ้างอิง | หัวข้อ | ประเมิน | สถานะ |
|---|---|---|---|---|
| 1 | [P27 Phase 0](mangmee-income-expense-ledger-plan-th.md) | ยืนยันสัญญา V1–V6 | 0.5 | ✅ 2026-08-26 |
| 2 | [P27 Phase 1](mangmee-income-expense-ledger-plan-th.md) | การเงินถูกก่อน (decimal + paymentNumber) | 1 | ✅ PR #247 |
| 3 | [P27 Phase 2](mangmee-income-expense-ledger-plan-th.md) | หมวดรายรับ (model→API→UI→bootstrap) | 1.5 | ✅ 2026-08-26 |
| 4 | [P27 Phase 3](mangmee-income-expense-ledger-plan-th.md) | บันทึกรายรับ 2 โหมด (bundle) + ใบลดหนี้/เพิ่มหนี้แบบ FlowAccount | 3 | ← **คิวถัดไป** |
| 5 | [P27 Phase 4](mangmee-income-expense-ledger-plan-th.md) | หน้าสมุด + export | 2 | |
| 6 | [P27 Phase 5](mangmee-income-expense-ledger-plan-th.md) | จัดระเบียบฝั่งรายจ่าย + ทางเข้า | 0.5 | |
| 7 | [P27 Phase 6](mangmee-income-expense-ledger-plan-th.md) | เปิดระบบฝั่งขาย: entitlement/nav/gate/E2E/หลักฐาน | 1.5 | |
| 8 | [P28 Phase 0](mangmee-purchase-to-pay-mvp-plan-th.md) | ยืนยันสัญญา W1–W5 | 0.5 | รอ Owner ตอบ P2P §10 ข้อ 2–5 ก่อนเริ่ม |
| 9 | [P28 Phase 1](mangmee-purchase-to-pay-mvp-plan-th.md) | SupplierCreditNote engine | 3 | |
| 10 | [P28 Phase 2](mangmee-purchase-to-pay-mvp-plan-th.md) | หน้าจอ S4 (CN) + S2 ปรับ | 2 | |
| 11 | [P28 Phase 3](mangmee-purchase-to-pay-mvp-plan-th.md) | S1 landing + S3 อนุมัติ/จ่ายรวมหลายบิล | 2 | |
| 12 | [P28 Phase 4](mangmee-purchase-to-pay-mvp-plan-th.md) | รวมฝั่งซื้อเข้าสมุด (F-P2P-4) + S5 | 1.5 | ต้องมาหลังคิว 5 (W4 ตอบโดยลำดับนี้) |
| 13 | [P28 Phase 5](mangmee-purchase-to-pay-mvp-plan-th.md) | เปิดระบบฝั่งซื้อ: nav/gate/E2E/หลักฐาน | 1.5 | |
| | | **รวม** | **~20 วัน** | ทำแล้ว ~3 เหลือ ~17 |

## หมายเหตุคิว

- ลำดับใหญ่ตาม [แผนหลัก §10](mangmee-brain-2-5-day-priority-plan-th.md): P27 → P28 → P13 → P15–P17 → P18–P24 → billing P14→P26 ท้ายสุด (Owner 2026-08-26)
- ค้างที่ Owner: [P2P spec §10](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) ข้อ 2–5 — ต้องตอบก่อนคิว 8 เริ่ม (ไม่ block ภาค 1)
- ทางลัดที่ Owner เลือกตัดได้ (ไม่ตัดเอง): ดู §0 ของแผนแต่ละฉบับ
