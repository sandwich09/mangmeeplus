# สารบัญแผนรวมมั่งมีพลัส (Master Plan Index)

สถานะ: **ACTIVE — สารบัญอย่างเดียว ทุกสายงาน** (กติกา Owner 2026-08-26: รวมแค่หัวข้อ แล้วลิงก์กลับเอกสารเดิม — ห้ามคัดลอกเนื้อหามาไว้ที่นี่)

ลำดับและกติกาคุมโดย [แผนหลัก 2.5 วัน §10](mangmee-brain-2-5-day-priority-plan-th.md) — สารบัญนี้แค่กางคิวให้เห็นทุกสายในหน้าเดียว; งานใดยังไม่มีแผนส่งมอบ = เขียนตอนเข้าคิวตามกติกา docs-first

## สาย 1 — รับคนให้ไหว (Ops/Monitoring/Scale)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P9 | Dashboard/alarm ครบชุด, funnel analytics, incident drill ทุก failure class | [production-ops-spec](../specs/production-ops-spec.md) + runbooks | เขียนตอนเข้าคิว | รอคิว |
| P25 ฉบับย่อ | Load/capacity บน UAT ที่จำนวนผู้ใช้วงถัดไป | [production-a5-v2-spec](../specs/production-a5-v2-spec.md) | เขียนตอนเข้าคิว | รอคิว (ทำคู่ P9) |

## สาย 2 — ความฉลาด AI "สมองมั่งมี" (ทำคู่ขนานทุกสาย)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| Brain-Real B1–B7 | สมองมั่งมีตอบจริง: hosted baseline → loading-on-accept → debounce → fused-plan shadow → security suite + prepared simple-read → ขยาย family ตามคำถาม top-N | [mangmee-brain-real-answers-spec](../specs/mangmee-brain-real-answers-spec.md) + [assessment](../specs/mangmee-brain-answer-architecture-assessment.md) + [คลังคำถามผู้ใช้](../specs/mangmee-brain-user-questions-catalog.md) | [mangmee-brain-real-answers-plan](mangmee-brain-real-answers-plan.md) | ตามคิว B1–B7 ใน[แผนหลัก §10 ข้อ 2](mangmee-brain-2-5-day-priority-plan-th.md) |
| Advisor | น้องมั่งมีคุยต่อเนื่องเชิงที่ปรึกษา (Slice A ก่อน — มติ Owner 2026-08-22) | [line-ai-mangmee-advisor-conversation-spec](../specs/line-ai-mangmee-advisor-conversation-spec.md) | [line-ai-mangmee-advisor-conversation-plan](line-ai-mangmee-advisor-conversation-plan.md) | ต่อท้าย track B (B7) |
| P23 | สมองมั่งมีเต็ม + คลังความรู้ (Knowledge Pack, web chat, retrieval) | [mangmee-accounting-tax-knowledge-spec](../specs/mangmee-accounting-tax-knowledge-spec-th.md) | เขียนตอนเข้าคิว | รอคิว (หลัง track B) |

## สาย 3 — สมัครง่าย (LINE register + LINE login) — ประตูรับคนจาก Marketing

ลำดับบังคับ P10 → P11 → P12:

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P10 | Auto-register จากเว็บทางการ (HMAC, state machine, idempotency, provision-after-claim) | [mangmee-external-signup-contract-spec](../specs/mangmee-external-signup-contract-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ — **รอ Owner ตอบ §8 (3 ข้อ)** |
| P11 | Email delivery + claim account (SES, ลิงก์ตั้งรหัสครั้งเดียว) | [mangmee-email-delivery-claim-spec](../specs/mangmee-email-delivery-claim-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ |
| P12 | LINE login: OA กลาง + LIFF account linking + QR login บนเว็บ (เปิด `line/exchange`) | [mangmee-line-login-link-journey-spec](../specs/mangmee-line-login-link-journey-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ |

## สาย 4 — โตต่อได้ (FlowAccount parity + รายรับ + ภาษี)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P27 | สมุดรายรับ–รายจ่าย (ฝั่งขาย–รับเงิน) | [income-expense-ledger-spec](../specs/mangmee-income-expense-ledger-spec-th.md) | [แผนฉบับเต็ม](mangmee-income-expense-ledger-plan-th.md) | **กำลังทำ — Phase 0–2 ✅ → Phase 3** |
| P28 | ซื้อ–จ่ายเงิน + ใบลดหนี้ฝั่งซื้อ | [purchase-to-pay-mvp-spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) | [แผนฉบับเต็ม](mangmee-purchase-to-pay-mvp-plan-th.md) | ต่อจาก P27 — **รอ Owner ตอบ §10 ข้อ 2–5** |
| P13 | พนักงานหลายบริษัทบน LINE (active-membership-based) | [mangmee-line-multi-company-staff-spec](../specs/mangmee-line-multi-company-staff-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ |
| P15–P17 | Auto Revenue foundation + Revenue Inbox + Matching | [mangmee-revenue-inbox-matching-spec](../specs/mangmee-revenue-inbox-matching-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ |
| P18–P20 | Direct bank/QR/Gateway, Marketplace settlement, POS/Partner API | ([marketplace-import-spec](../specs/marketplace-import-spec.md) บางส่วน) | — | **spec เขียนเมื่อเลือก provider จริง** |
| P21 | Accountant review + tax workpaper ภ.พ.30 | [mangmee-tax-workpaper-pp30-spec](../specs/mangmee-tax-workpaper-pp30-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ |
| P22 | Controlled auto-accounting (precision-gated) | [expense-ledger-auto-post-spec](../specs/expense-ledger-auto-post-spec.md) | เขียนตอนเข้าคิว | spec ✅ ฝั่งรายจ่าย |
| P24 | Growth/UX รอบเต็ม (self-service signup, device matrix) | [mangmee-growth-ux-full-pass-spec](../specs/mangmee-growth-ux-full-pass-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ |

Gate ประจำสาย: **รัน P25 ฉบับเต็มซ้ำก่อนขยายวงทุกครั้ง** ([production-a5-v2-spec](../specs/production-a5-v2-spec.md))

### คิวย่อย FlowAccount Parity (P27+P28) — 13 ขั้น

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

## สาย 5 — เก็บเงินได้ (Subscriber/Billing) — **ท้ายคิวสุด (คำสั่ง Owner 2026-08-26)**

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P14 | Document meter + per-company override (meter ก่อน enforcement เสมอ) | [per-company-ai-budget-override-spec](../specs/per-company-ai-budget-override-spec.md) + [ai-usage-metering-spec](../specs/ai-usage-metering-and-monthly-budget-spec.md) | เขียนตอนเข้าคิว | ท้ายคิว — ดึงมาก่อนได้เฉพาะโหมด "นับอย่างเดียว ไม่ปฏิเสธ" |
| P26 | Package→entitlement, หน้า subscribe/ชำระเงิน, enforcement อ่อนโยน | [mangmee-billing-subscription-spec](../specs/mangmee-billing-subscription-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ กลไกครบ — **ตารางราคา §8 รอ Owner อนุมัติ** |

## Gate เปิด Marketing วงกว้าง

**สาย 1 + สาย 3 ต้องผ่านทั้งคู่** (รับโหลดได้ + สมัครเองได้) — รายละเอียดใน[แผนหลัก §10](mangmee-brain-2-5-day-priority-plan-th.md)

## ค้างที่ Owner ตอนนี้

1. P28 spec §10 ข้อ 2–5 (ก่อนคิวย่อยขั้น 8) — [spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md)
2. P26 ตารางราคา §8 (ก่อน implement billing) — [spec](../specs/mangmee-billing-subscription-spec-th.md)
3. P10 คำถาม §8 สามข้อ (ก่อนเริ่มสาย 3) — [spec](../specs/mangmee-external-signup-contract-spec-th.md)
4. เลือก provider จริง (payment / bank / marketplace) → ปลดล็อกการเขียน spec P18–P20
