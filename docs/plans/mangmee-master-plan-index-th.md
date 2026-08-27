# สารบัญแผนรวมมั่งมีพลัส (Master Plan Index)

สถานะ: **ACTIVE — VERIFIED INDEX 2026-08-27** (สาย 1–4 review แล้ว; สาย 5 Subscribe/Billing ไม่อยู่ใน scope รอบนี้)

ลำดับและกติกาคุมโดย [แผนหลัก 2.5 วัน §10](mangmee-brain-2-5-day-priority-plan-th.md). หลักฐานและเหตุผล verdict อยู่ใน [Coding-readiness Audit](mangmee-four-lane-coding-readiness-audit-th.md); phase/test/exit/gate ที่เติมอยู่ใน [Gap Closure Plan](mangmee-four-lane-gap-closure-plan-th.md). Baseline integration ล่าสุดที่ตรวจคือ `origin/develop@8b575285`; branch/worktree status ต้องแยกจาก integration/production status เสมอ.

คำสถานะ: `READY <phase>` = เริ่ม phase นั้นได้, `PARTIAL READY` = core/read-only เริ่มได้แต่ activation blocked, `IMPLEMENTED / VERIFY` = code มีแต่ rollout evidence ค้าง, `BLOCKED` = ห้ามเดาคำตอบ Owner/provider/expert.

## สาย 1 — รับคนให้ไหว (Ops/Monitoring/Scale)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P9 | Dashboard/alarm ครบชุด, funnel analytics, incident drill ทุก failure class | [production-ops-spec](../specs/production-ops-spec.md) + runbooks | [P9 closure](mangmee-four-lane-gap-closure-plan-th.md#p9--observability-and-drills) | **READY P9-0..P9-2**; UAT drill gate |
| OCR-GOV | เปิด/ปิด OCR, quota จำนวนครั้งรายบริษัท และ usage ฝั่ง Platform Admin (งานเสริมตาม Owner; ไม่เกี่ยว Subscribe และไม่แทนเลข P14 เดิม) | [spec](../specs/company-ocr-governance-spec-th.md) | [plan](company-ocr-governance-plan-th.md) | **IMPLEMENTED / LOCAL VERIFIED** — code/test/migration/desktop+mobile browser evidence ครบ; integration evidence และ CI/merge history อยู่ใน PR #280 |
| P25 ฉบับย่อ | Load/capacity บน UAT ที่ workload ของวงถัดไป | [production-a5-v2-spec](../specs/production-a5-v2-spec.md) | [P25 gate](mangmee-four-lane-gap-closure-plan-th.md#p25--capacity-gate) + [แผนเดิม](production-a5-v2-plan.md) | **EXECUTION INPUT** — รอ cohort/workload/SLO ไม่ใช่ code ใหม่ |

## สาย 2 — ความฉลาด AI "สมองมั่งมี" (ทำคู่ขนานทุกสาย)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| Brain-Real B1–B7 | hosted baseline → loading/debounce → fused-plan shadow → security + simple-read → family top-N | [spec](../specs/mangmee-brain-real-answers-spec.md) + [assessment](../specs/mangmee-brain-answer-architecture-assessment.md) + [catalog](../specs/mangmee-brain-user-questions-catalog.md) | [canonical plan](mangmee-brain-real-answers-plan.md) + [readiness gate](mangmee-four-lane-gap-closure-plan-th.md#brain-real--b1b7) | **PARTIAL READY**; real traffic/golden/reviewer gate ต่อ family |
| Advisor | น้องมั่งมีคุยต่อเนื่องเชิงที่ปรึกษา | [spec](../specs/line-ai-mangmee-advisor-conversation-spec.md) | [canonical plan](line-ai-mangmee-advisor-conversation-plan.md) + [gate](mangmee-four-lane-gap-closure-plan-th.md#advisor--conversation) | **Slice A READY**; knowledge/company slices blocked ตาม decision table |
| P23 | Knowledge Pack, web chat, retrieval | [spec](../specs/mangmee-accounting-tax-knowledge-spec-th.md) | [P23 plan](mangmee-four-lane-gap-closure-plan-th.md#p23--knowledge-pack) | **READY P23-0/1 product-help**; tax publish blocked |

## สาย 3 — สมัครง่าย (LINE register + LINE login) — ประตูรับคนจาก Marketing

ลำดับบังคับ P10 → P11 → P12:

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P10 | Auto-register จากเว็บทางการ (signed ingress, state, idempotency, claim-before-provision) | [spec](../specs/mangmee-external-signup-contract-spec-th.md) | [canonical plan](mangmee-external-signup-plan-th.md) + [status gate](mangmee-four-lane-gap-closure-plan-th.md#p10--external-signup) | **P10-0 CORE IMPLEMENTED + LOCAL VERIFIED**; public ingress รอ Owner §8 |
| P11 | Email delivery + claim account | [spec](../specs/mangmee-email-delivery-claim-spec-th.md) | [P11 plan](mangmee-four-lane-gap-closure-plan-th.md#p11--email-delivery--claim) | **CORE READY**; live รอโดเมน/DNS/region |
| P12 | LINE login: OAuth/LIFF + account linking + QR login | [spec](../specs/mangmee-line-login-link-journey-spec-th.md) | [P12 plan](mangmee-four-lane-gap-closure-plan-th.md#p12--line-loginlinkqr) | **READY P12-0/1**; live link/QR รอ console/deep-link gate |

## สาย 4 — โตต่อได้ (FlowAccount parity + รายรับ + ภาษี)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P27 | สมุดรายรับ–รายจ่าย (ฝั่งขาย–รับเงิน) | [spec](../specs/mangmee-income-expense-ledger-spec-th.md) | [canonical plan](mangmee-income-expense-ledger-plan-th.md) + [status gate](mangmee-four-lane-gap-closure-plan-th.md#p27--income-expense-ledger) | Phase 0–6 **merged develop**; LED-FIN-07 และ external human/UAT/Production gates ยังเปิด |
| P28 | ซื้อ–จ่ายเงิน + ใบลดหนี้ฝั่งซื้อ | [spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) | [canonical plan](mangmee-purchase-to-pay-mvp-plan-th.md) + [gate](mangmee-four-lane-gap-closure-plan-th.md#p28--purchase-to-pay) | **BLOCKED** Owner §10 ข้อ 2–5 |
| P13 | พนักงานหลายบริษัทบน LINE | [spec](../specs/mangmee-line-multi-company-staff-spec-th.md) | [P13 plan](mangmee-four-lane-gap-closure-plan-th.md#p13--line-multi-company-staff) | **BLOCKED** active-membership/notification policy |
| P15–P17 | Auto Revenue foundation + Revenue Inbox + Matching | [spec](../specs/mangmee-revenue-inbox-matching-spec-th.md) | [P15–17 plan](mangmee-four-lane-gap-closure-plan-th.md#p15p17--revenue-foundationinboxmatching) | **READY P15 read-only core**; posting/automation blocked |
| P18–P20 | Direct bank/QR/Gateway, Marketplace settlement, POS/Partner API | [provider-neutral contract](../specs/mangmee-revenue-connectors-contract-spec-th.md) + [marketplace partial](../specs/marketplace-import-spec.md) | [P18–20 plan](mangmee-four-lane-gap-closure-plan-th.md#p18p20--revenue-connectors) | shared harness **READY**; adapters **BLOCKED** provider selection |
| P21 | Accountant review + tax workpaper ภ.พ.30 | [spec](../specs/mangmee-tax-workpaper-pp30-spec-th.md) | [P21 plan](mangmee-four-lane-gap-closure-plan-th.md#p21--tax-workpaper--accountant-review) | **READY P21-0 core**; form output รอ current fixture/expert |
| P22 | Controlled auto-accounting | [expense spec](../specs/expense-ledger-auto-post-spec.md) | [implemented plan](expense-ledger-auto-post-plan.md) + [P22 gate](mangmee-four-lane-gap-closure-plan-th.md#p22--controlled-auto-accounting) | expense **IMPLEMENTED / VERIFY**; revenue blocked หลัง P17 |
| P24 | Growth/UX รอบเต็ม | [spec](../specs/mangmee-growth-ux-full-pass-spec-th.md) | [P24 plan](mangmee-four-lane-gap-closure-plan-th.md#p24--growthux-full-pass) | **READY baseline/UX**; ไม่พึ่ง Billing |

Gate ประจำสาย: **รัน P25 ฉบับเต็มซ้ำก่อนขยายวงทุกครั้ง** ([production-a5-v2-spec](../specs/production-a5-v2-spec.md))

### คิวย่อย FlowAccount Parity (P27+P28) — 13 ขั้น

| คิว | อ้างอิง | หัวข้อ | ประเมิน | สถานะ |
|---|---|---|---|---|
| 1 | [P27 Phase 0](mangmee-income-expense-ledger-plan-th.md) | ยืนยันสัญญา V1–V6 | 0.5 | ✅ 2026-08-26 |
| 2 | [P27 Phase 1](mangmee-income-expense-ledger-plan-th.md) | การเงินถูกก่อน (decimal + paymentNumber) | 1 | merged integration (`2f9d3c57`) |
| 3 | [P27 Phase 2](mangmee-income-expense-ledger-plan-th.md) | หมวดรายรับ (model→API→UI→bootstrap) | 1.5 | merged integration (`596776c0`) |
| 4 | [P27 Phase 3](mangmee-income-expense-ledger-plan-th.md) | บันทึกรายรับ 2 โหมด (bundle) + ใบลดหนี้/เพิ่มหนี้แบบ FlowAccount | 3 | core merged develop; LED-FIN-07 ยังรอ Owner |
| 5 | [P27 Phase 4](mangmee-income-expense-ledger-plan-th.md) | หน้าสมุด + export | 2 | 4A/4B/4C merged develop (`c5a33e06`) |
| 6 | [P27 Phase 5](mangmee-income-expense-ledger-plan-th.md) | จัดระเบียบฝั่งรายจ่าย + ทางเข้า | 0.5 | backend + ทางเข้าในสมุด merged develop |
| 7 | [P27 Phase 6](mangmee-income-expense-ledger-plan-th.md) | เปิดระบบฝั่งขาย: entitlement/nav/gate/E2E/หลักฐาน | 1.5 | merged develop (`8b575285`): API/web full green, PostgreSQL accounting/launch 14/14 + CRM bundle 1/1, browser LED-01..06 6/6 + entitlement off/on/off 1/1 |
| 8 | [P28 Phase 0](mangmee-purchase-to-pay-mvp-plan-th.md) | ยืนยันสัญญา W1–W5 | 0.5 | รอ Owner ตอบ P2P §10 ข้อ 2–5 ก่อนเริ่ม |
| 9 | [P28 Phase 1](mangmee-purchase-to-pay-mvp-plan-th.md) | SupplierCreditNote engine | 3 | |
| 10 | [P28 Phase 2](mangmee-purchase-to-pay-mvp-plan-th.md) | หน้าจอ S4 (CN) + S2 ปรับ | 2 | |
| 11 | [P28 Phase 3](mangmee-purchase-to-pay-mvp-plan-th.md) | S1 landing + S3 อนุมัติ/จ่ายรวมหลายบิล | 2 | |
| 12 | [P28 Phase 4](mangmee-purchase-to-pay-mvp-plan-th.md) | รวมฝั่งซื้อเข้าสมุด (F-P2P-4) + S5 | 1.5 | ต้องมาหลังคิว 5 (W4 ตอบโดยลำดับนี้) |
| 13 | [P28 Phase 5](mangmee-purchase-to-pay-mvp-plan-th.md) | เปิดระบบฝั่งซื้อ: nav/gate/E2E/หลักฐาน | 1.5 | |
| | | **รวมเดิม** | **~20 วัน** | ต้อง re-estimate หลัง Phase 3 merge และ Owner ปิด P28 §10 |

## สาย 5 — เก็บเงินได้ (Subscriber/Billing) — **ไม่ review ในรอบนี้**

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P14 | Document meter + per-company override (meter ก่อน enforcement เสมอ) | [per-company-ai-budget-override-spec](../specs/per-company-ai-budget-override-spec.md) + [ai-usage-metering-spec](../specs/ai-usage-metering-and-monthly-budget-spec.md) | เขียนตอนเข้าคิว | ท้ายคิว — ดึงมาก่อนได้เฉพาะโหมด "นับอย่างเดียว ไม่ปฏิเสธ" |
| P26 | Package→entitlement, หน้า subscribe/ชำระเงิน, enforcement อ่อนโยน | [mangmee-billing-subscription-spec](../specs/mangmee-billing-subscription-spec-th.md) | เขียนตอนเข้าคิว | spec ✅ กลไกครบ — **ตารางราคา §8 รอ Owner อนุมัติ** |

## Gate เปิด Marketing วงกว้าง

**สาย 1 + สาย 3 ต้องผ่านทั้งคู่** (รับโหลดได้ + สมัครเองได้) — รายละเอียดใน[แผนหลัก §10](mangmee-brain-2-5-day-priority-plan-th.md)

## ค้างที่ Owner/หลักฐาน (เฉพาะสาย 1–4)

1. P10 ingress/claim/duplicate policy — [spec §8](../specs/mangmee-external-signup-contract-spec-th.md)
2. P28 accounting/product policy — [spec §10 ข้อ 2–5](../specs/mangmee-purchase-to-pay-mvp-spec-th.md)
3. P13 active-membership + notification policy — [spec §5](../specs/mangmee-line-multi-company-staff-spec-th.md)
4. P15–P17 pilot/reviewer/matrix — [spec §7](../specs/mangmee-revenue-inbox-matching-spec-th.md)
5. P18–P20 provider + pilot + selection evidence — [contract §6](../specs/mangmee-revenue-connectors-contract-spec-th.md)
6. P21/P23/Advisor named accounting/tax reviewer + current sanitized fixture/SLA
7. P25 next-cohort workload inputs

P14/P26/Subscribe payment ไม่ถูกตัดสินหรือแก้ scope ใน audit นี้.
