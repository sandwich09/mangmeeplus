# สารบัญแผนรวมมั่งมีพลัส (Master Plan Index)

สถานะ: **ACTIVE — VERIFIED INDEX 2026-08-27** (สาย 1–4 review แล้ว; สาย 5 Subscribe/Billing ไม่อยู่ใน scope รอบนี้)

ลำดับและกติกาคุมโดย [แผนหลัก 2.5 วัน §10](mangmee-brain-2-5-day-priority-plan-th.md), ภายใต้ scope ล่าสุดด้านล่าง. หลักฐานและเหตุผล verdict อยู่ใน [Coding-readiness Audit](mangmee-four-lane-coding-readiness-audit-th.md); phase/test/exit/gate ที่เติมอยู่ใน [Gap Closure Plan](mangmee-four-lane-gap-closure-plan-th.md). Baseline integration ล่าสุดที่ตรวจคือ `origin/develop@a2d8e793` (รวม P11 PR290, corrected AI PR288, docs checkpoint PR291 และ P24-2b PR292). Branch/worktree status ต้องแยกจาก integration/production status เสมอ.

คำสถานะ: `READY <phase>` = เริ่ม phase นั้นได้, `PARTIAL READY` = core/read-only เริ่มได้แต่ activation blocked, `IMPLEMENTED / VERIFY` = code มีแต่ rollout evidence ค้าง, `BLOCKED` = ห้ามเดาคำตอบ Owner/provider/expert.

## Scope ล่าสุด — เก็บข้อมูลรับ/จ่ายก่อน (Owner 2026-08-27)

- รอบนี้ยังไม่ต้องกระทบยอดบัญชี: **เลื่อน P15–P17 Revenue Foundation/Inbox/Matching และ P18–P20 การเชื่อมธนาคาร/QR/Gateway, Marketplace, POS/Partner API** รวมถึง revenue automation ที่พึ่งงานเหล่านี้. `DEFERRED BY OWNER` ไม่ใช่งานที่ต้องเสร็จก่อนส่งรอบนี้/merge main.
- เน้นบันทึกข้อมูลรายรับ รายจ่าย การรับ/จ่ายที่ผู้ใช้ระบุ และเอกสาร/หลักฐานผ่าน P27/expense/purchase journey เดิม; ไม่ต้องมี statement หรือผล matching จึงจะบันทึกได้. ไม่สร้างรายได้/VAT/journal จากเงินเข้าธนาคารโดยอัตโนมัติ.
- การเลื่อนนี้ไม่ลบข้อมูล/code ที่มีอยู่ ไม่ปิด feature ของบริษัทโดยพลการ และไม่เปลี่ยนกฎบัญชี/permission/audit/ยืนยันเอกสารเดิม. งานซื้อ–จ่าย/เอกสารภายในยังอยู่; คำว่า “PO” ในคำสั่งล่าสุดไม่ถูกใช้เป็นเหตุให้ลบหรือข้ามใบสั่งซื้อ.
- P15-0 ที่ทดสอบแล้วเก็บไว้ใน worktree แยก **ยังไม่ commit/push/PR/merge**. ไม่เพิ่ม migration เพื่อเตรียม reconciliation ที่ยังไม่ต้องใช้.
- งานอื่นในสาย 1–4 และการยกเว้น Subscribe คงเดิม. Financial correctness, local desktop/mobile, CI และ acceptance ของ scope ที่เหลือยังต้องผ่านก่อน main; การเลื่อนงานไม่ใช่การรับรอง production.
- บันทึกการตัดสินใจและสถานะจริง: [capture-first memory](../agent-memory/mangmee-capture-first-scope.md).
- สถานะส่งต่อ ณ audit 2026-08-27: partner-copy PR #284, sales-payment retry PR #285 (`145924a3` / CI `33036847494`), vendor-bill capture PR #286 (`21f109d5` / CI `33037405174`) และ expense-payment/date PR #287 (`11153296` / CI `33039136161`) **merged develop / CI SUCCESS**. Expense final integration 33/33 (ขาย6 + บิลผู้ขาย6 + รายจ่าย21), zero skipped/flaky; web1139/1139, ชุดตรวจ 128/128 รวม real PostgreSQL 6 เคส และ [ภาพ6ไฟล์/API proof](../evidence/expense-payment-capture-integrity/README.md) อยู่ใน Git. ดู [current capture delivery/acceptance](../agent-memory/capture-first-progress-audit.md); ไม่เท่ากับปิด P27/P28 หรืออนุมัติ main/Production.

## สาย 1 — รับคนให้ไหว (Ops/Monitoring/Scale)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P9 | Dashboard/alarm ครบชุด, funnel analytics, incident drill ทุก failure class | [production-ops-spec](../specs/production-ops-spec.md) + runbooks | [P9 closure](mangmee-four-lane-gap-closure-plan-th.md#p9--observability-and-drills) | P9-0/1a/1b/1c/2 **merged develop**; P9-1c PR #281 / CI `33032595709` / merge `d33f8d2e`; signup/SES coverage และ UAT drill gate ยังเปิด |
| OCR-GOV | เปิด/ปิด OCR, quota จำนวนครั้งรายบริษัท และ usage ฝั่ง Platform Admin (งานเสริมตาม Owner; ไม่เกี่ยว Subscribe และไม่แทนเลข P14 เดิม) | [spec](../specs/company-ocr-governance-spec-th.md) | [plan](company-ocr-governance-plan-th.md) | **MERGED DEVELOP `086a4549`** — PR #280, CI `33030846368` ผ่าน; code/test/migration/desktop+mobile browser evidence ครบ |
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
| P11 | Email delivery + claim account | [spec](../specs/mangmee-email-delivery-claim-spec-th.md) | [P11 plan](mangmee-four-lane-gap-closure-plan-th.md#p11--email-delivery--claim) | **PARTIAL — Phase 0 MERGED DEVELOP** `d8d9808e` / PR290 / CI `33040896057` SUCCESS บน `6f85339d`; รวม explicit WEB_BASE_URL fix แล้ว. Provider คง disabled; claim/delivery และ secret/TTL/sender/DNS/region gates ยังเปิด |
| P12 | LINE login: OAuth/LIFF + account linking + QR login | [spec](../specs/mangmee-line-login-link-journey-spec-th.md) | [P12 plan](mangmee-four-lane-gap-closure-plan-th.md#p12--line-loginlinkqr) | **READY P12-0/1**; live link/QR รอ console/deep-link gate |

## สาย 4 — โตต่อได้ (FlowAccount parity + รายรับ + ภาษี)

| งาน | หัวข้อ | Spec | Plan | สถานะ |
|---|---|---|---|---|
| P27 | สมุดรายรับ–รายจ่าย (ฝั่งขาย–รับเงิน) | [spec](../specs/mangmee-income-expense-ledger-spec-th.md) | [canonical plan](mangmee-income-expense-ledger-plan-th.md) + [status gate](mangmee-four-lane-gap-closure-plan-th.md#p27--income-expense-ledger) | Phase 0–6 **merged develop**; LED-FIN-07 และ external human/UAT/Production gates ยังเปิด |
| P28 | ซื้อ–จ่ายเงิน + ใบลดหนี้ฝั่งซื้อ | [spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) | [canonical plan](mangmee-purchase-to-pay-mvp-plan-th.md) + [gate](mangmee-four-lane-gap-closure-plan-th.md#p28--purchase-to-pay) | **BLOCKED** Owner §10 ข้อ 2–5 |
| P13 | พนักงานหลายบริษัทบน LINE | [spec](../specs/mangmee-line-multi-company-staff-spec-th.md) | [P13 plan](mangmee-four-lane-gap-closure-plan-th.md#p13--line-multi-company-staff) | **BLOCKED** active-membership/notification policy |
| P15–P17 | Auto Revenue foundation + Revenue Inbox + Matching | [spec](../specs/mangmee-revenue-inbox-matching-spec-th.md) | [P15–17 plan](mangmee-four-lane-gap-closure-plan-th.md#p15p17--revenue-foundationinboxmatching) | **DEFERRED BY OWNER 2026-08-27** — เก็บข้อมูลรับ/จ่ายก่อน; ไม่เป็น gate รอบนี้ |
| P18–P20 | Direct bank/QR/Gateway, Marketplace settlement, POS/Partner API | [provider-neutral contract](../specs/mangmee-revenue-connectors-contract-spec-th.md) + [marketplace partial](../specs/marketplace-import-spec.md) | [P18–20 plan](mangmee-four-lane-gap-closure-plan-th.md#p18p20--revenue-connectors) | **DEFERRED BY OWNER 2026-08-27** — รวม shared harness/adapter; ไม่เป็น gate รอบนี้ |
| P21 | Accountant review + tax workpaper ภ.พ.30 | [spec](../specs/mangmee-tax-workpaper-pp30-spec-th.md) | [P21 plan](mangmee-four-lane-gap-closure-plan-th.md#p21--tax-workpaper--accountant-review) | **READY P21-0 core**; form output รอ current fixture/expert |
| P22 | Controlled auto-accounting | [expense spec](../specs/expense-ledger-auto-post-spec.md) | [implemented plan](expense-ledger-auto-post-plan.md) + [P22 gate](mangmee-four-lane-gap-closure-plan-th.md#p22--controlled-auto-accounting) | expense เดิม **IMPLEMENTED / VERIFY**; revenue automation หลัง P17 **DEFERRED** ไม่ใช่ gate รอบนี้ |
| P24 | Growth/UX รอบเต็ม | [spec](../specs/mangmee-growth-ux-full-pass-spec-th.md) | [P24 plan](mangmee-four-lane-gap-closure-plan-th.md#p24--growthux-full-pass) | **PARTIAL** — P24-2a merged `b98e500f` / PR283; P24-2b merged `a2d8e793` / PR292 / exact-head CI33043955626 SUCCESS บน `d3a531d6`. Scoped local/Chrome + approved-origin33+61/manual draft-reload ผ่าน; full 40+/physical-device journeys ยังไม่ครบ; ไม่พึ่ง Billing |

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

1. P27 **LED-FIN-07**: durable draft เมื่อ VAT ยังไม่ชัด — เลือก review-state contract ก่อนเพิ่ม migration; ตอนนี้ fail closed ไม่แทนด้วย `NO_VAT` ([spec](../specs/mangmee-income-expense-ledger-spec-th.md), [Phase 3](mangmee-income-expense-ledger-plan-th.md#phase-3--บันทึกรายรับ--ใบลดหนี้เพิ่มหนี้-spec-f-led-1-f-led-6)).
2. P28 [§10 ข้อ 2–5](../specs/mangmee-purchase-to-pay-mvp-spec-th.md): เครดิตผู้ขายเกินค้าง/คืนเงิน, ใบเพิ่มหนี้เข้ารอบใด, two-step release และ pilot ใช้สต็อกหรือ direct bill. ไม่เลือกคำตอบแนะนำแทน Owner.
3. P10 [§8](../specs/mangmee-external-signup-contract-spec-th.md): ingress secret model, claim TTL/resend/revoke, duplicate taxId และแหล่ง `businessCategory` ที่ onboarding บังคับ.
4. P11 [§5](../specs/mangmee-email-delivery-claim-spec-th.md): sender domain/DNS owner/SES region. Disabled-safe Phase 0 merged แล้ว แต่ durable raw-link/key lifecycle และ claim TTL/resend/revoke ยังไม่ตัดสิน; claim/delivery core ยังไม่ครบ ไม่ใช่เพียงเปิด DNS.
5. P12 [§7](../specs/mangmee-line-login-link-journey-spec-th.md): Console Provider evidence และ handoff Q1–Q4; P13 [§5](../specs/mangmee-line-multi-company-staff-spec-th.md): active-membership + notification policy.
6. Brain-Real/Advisor/P21/P23: golden/reviewer evidence ตาม family; tax/form publication ต้องมี named reviewer, current sanitized fixture และ SLA ไม่ใช้ผล synthetic แทน.
7. P27 usability ผู้ใช้ 40+ ≥3 คน และ P24 physical-device journeys ยังเปิด; P25 รอ next-cohort workload/SLO ก่อนรัน capacity gate. Local Chromium ไม่ใช่หลักฐานผ่านสองรายการนี้.

AI PR288 head `29a0605b` รวม amount/date fix `86c72e7f` และ merged ที่ `c6f3d06f` เมื่อ 2026-08-27T05:30:29Z หลัง [fresh combined review/checks PASS](../agent-memory/capture-integration-final.md) และ exact-head CI `33041868515` SUCCESS. PR264 runtime จึง superseded แล้ว แต่ audit นี้ไม่ปิด PR เก่า. Old head70033af2/CI33040537029 เคยผ่านแต่ถูก HOLD เพราะตอบปี2026เป็นยอดแทน actual85 จึงใช้อนุมัติ head ใหม่ไม่ได้; ผล local/CI ไม่ใช่ live AI หรือ main acceptance. LINE recovery PR #265 ยังติด security findings 5 จุดและความหมาย one-time ที่ spec ขัดกัน (claim ครั้งเดียวหรือ login ครั้งเดียว). รายละเอียดอยู่ใน [delivery checkpoint](../agent-memory/capture-first-delivery-checkpoint.md) และ [security audit](../agent-memory/capture-first-progress-audit.md#pr265--security-hold-unmerged-branch-only); ไม่เลือก policy แทน Owner.

P24-2b มี scoped E2E61/61, web1140/1140, focused89/89, typechecks และ [ภาพเดิม8ไฟล์ + manual draft อีก1ไฟล์](../evidence/p24-scope-selector-targets/README.md). Capture บน web3004 ได้24/33 จาก local CORS อนุญาต3000เท่านั้น; ย้ายเฉพาะ own web โดยไม่แก้ API/guard แล้ว capture33/33 + selector61/61 ผ่านใน **2 runs รวม94เคส** ตามด้วย Chrome draft-save/reload จริง. PR292 merged เมื่อ 2026-08-27T06:08:41Z หลัง CI ของ head จริงผ่าน; ดู [ผลและข้อจำกัดแต่ละรอบ](../agent-memory/capture-first-delivery-checkpoint.md#p24-post-scope-capture-rerun). Docs PR291 / CI33043341836 SUCCESS ข้าม runtime jobs ตามแบบ docs-only ไม่ใช่หลักฐาน runtime/P24.

P15–P20 และ matching-dependent revenue automation **DEFERRED BY OWNER** ไม่อยู่ในรายการตัดสินใจ/งานที่ต้องเสร็จก่อน main รอบนี้. Main/UAT/Production ยังต้องผ่าน acceptance ของ active scope ตาม protocol.

P14/P26/Subscribe payment ไม่ถูกตัดสินหรือแก้ scope ใน audit นี้.
