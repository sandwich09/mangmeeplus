# แผนงาน: ซื้อเครดิตแชตและจำนวนอ่านรูปเพิ่ม

วันที่: 2026-09-28
อัปเดตล่าสุด: 2026-09-29 — D12 ปรับเครดิตเดิมและ source ร่วม; รวม A01–A32/E01–E60
สถานะ: **มติธุรกิจครบและปรับเอกสารแล้ว; implementation ทุก phase ยังไม่เริ่ม**

อ้างอิง [สเปก](../specs/chat-credit-and-receipt-addons-spec-th.md), [task memory](../agent-memory/chat-credit-and-receipt-addons-discussion-2026-09-28.md) และ [E2E impact audit](../research/chat-credit-and-receipt-addons-e2e-impact-audit-2026-09-28-th.md). Scope รอบนี้คือ spec+plan และ source/dependency audit เท่านั้น ไม่มี code/config/payment/deploy หรือการรันทดสอบระบบเพิ่มตามคำขอ Owner

## 1. ผลส่งมอบและลำดับงาน

ผลสุดท้ายของ implementation คือ OWNER ซื้อสินค้าทั้งหกแบบ one-time และ admin ให้ยอดแถม/ชดเชยผ่านกลไก ADD_ON ร่วมได้ ได้ยอดบริษัทตรงชนิด ใช้ยอดแพ็กก่อนซื้อเพิ่ม ดูวัน reset/expiry และประวัติได้ พร้อมกู้ paid-held/refund/duplicate โดยไม่เปลี่ยนสิทธิ์แพ็กหลัก

ทำตามลำดับ: มติและ contract → data/cycle/funding → paid apply → ต่อการใช้งาน → UI/operations → verification/migration → release. ไม่เปิดขายก่อน debit/recovery พร้อม และไม่สร้างบริการ wallet/payment ชุดใหม่

D12 ขยายทุก phase ให้รวมระบบปรับยอด/เพดานเดิมและ consumers ตาม §15. [Audit source ร่วม](../research/chat-credit-and-receipt-addons-unified-source-audit-2026-09-29-th.md) เพิ่ม C01–C12/E43–E60; ข้อความที่กล่าว 42 cases ในบันทึกก่อนหน้าเป็นขอบเขต ณ รอบนั้น เกณฑ์รวมล่าสุดคือ 60 cases ที่ยังไม่รัน

| Phase | งานหลัก | ขึ้นกับ | เกณฑ์จบ | สถานะ |
| --- | --- | --- | --- | --- |
| P0 | ตรวจ paid anchor/continuity, authority ของ legacy caps และ technical cutover/lock design | มติ D1–D12 + discovery | source/lock/cohort matrix และตัวอย่าง cutover ตรวจได้ | Pending technical work |
| P1 | Shared contracts/catalog/policy | P0 เฉพาะมติที่กระทบ contract | หก offer และ ADD_ON snapshot แยกจาก FULL_PACKAGE | Pending |
| P2 | Durable grants/funding และ anniversary cycles | P1 | จอง/ตัด/คืน/หมดอายุ idempotent; legacy ไม่เปลี่ยนความหมาย | Pending |
| P3 | One-time checkout/paid apply/reconcile | P1, P2 | paid→grant ครั้งเดียว; package/collection invariant | Pending |
| P4 | CHAT/OCR consumption และ refund/dispute | P2, P3 | ใช้ซื้อเพิ่มจริงได้และกู้รายการได้ | Pending |
| P5 | Customer Web/LINE และ operator/history | P1–P4 contracts | journey/loading/error/permission/recovery ครบ | Pending |
| P6 | ตรวจ integration และเตรียม migration | P2–P5 | evidence ของ A01–A32/E01–E60 พร้อม; cutover ย้อนตรวจได้ | Pending |
| P7 | Release เมื่อมีคำสั่งให้นำขึ้นระบบ | P6 + release protocol | signed result + customer OPEN acceptance และยอดเดิมคงอยู่ | Not authorized in this task |

## 2. P0 — มติและการตรวจที่ต้องจบก่อนลงมือ

- [x] ราคายืนยัน: CHAT 50/100/300 = 299/549/1499 บาท; IMAGE 20/50/100 = 349/799/1499 บาท
- [x] อายุ purchased lots 12 เดือนต่อการซื้อ Owner ยืนยันในระหว่างจัดทำเอกสาร
- [x] เครดิตแพ็กตัดก่อนซื้อเพิ่ม; reset ตามรอบสมาชิก; default 80/รอบ; รายปี 12 รอบแชต; receipt annual allowance คงเดิม
- [x] D2: Owner ยืนยันเก็บยอดซื้อเพิ่มที่ยังไม่หมดอายุไว้ใช้เมื่อกลับมาสมัคร; expiry 12 เดือนยังเดินต่อจากวันซื้อเดิม
- [x] D3: paid tier/deal ที่ซื้อได้; trial/manual/grace และสิทธิ์ที่มี operational cap ปิด ตามข้อเสนอใน spec
- [x] D4: รับรอง V1 image-page unit, การอ่านใหม่โดยลูกค้า, แพ็ก/ของแถมก่อน purchased และ PDF exclusion โดยไม่เปลี่ยนสิทธิ์แพ็กเดิม
- [x] D5: refund หน่วยที่ใช้บางส่วน/ข้อยกเว้นและการ freeze; financial approvals ใช้ระบบเดิม
- [x] D11: Owner รับแนวทางแก้ U01–U10 ทั้งหมดตามคำแนะนำ; tracking อยู่ §14 ไม่ใช่การยืนยันว่า implementation ผ่านแล้ว
- [x] D12: รวมการแก้ admin/config/package/usage/readers/UI ให้แหล่งข้อมูลและ field/value ตรงกัน; tracking อยู่ §15
- [x] D9: คงการเติมเดิมจนถึงวันครบรอบถัดไป แล้ว reset allowance เต็ม; รับต้นทุนรอยต่อ ไม่ prorate ไม่ reset ยอดซื้อ/แถม
- [ ] ตรวจ anchor continuity และ cutover ของบริษัทเดิมจาก paid source ตาม D9; บริษัทที่หลักฐานไม่ครบยังอยู่ legacy ไม่เดาวันซื้อ
- [ ] ทำ lock matrix จาก writers จริง: billing apply/refund, OCR reserve/release, CHAT reservation/settle/correction, reset และ config. ระบุลำดับ company-wide lot lock ที่ไม่ย้อนลำดับเดิมและครอบคลุมคำขอสองเดือน
- [ ] ตรวจว่าสร้าง bound จากโมเดลจริงใน SHARED ได้โดยไม่เปลี่ยน policy เป็น SPLIT หรือสร้าง monthly cap พิเศษให้ลูกค้า; หากไม่พร้อม product readiness ต้องปิดก่อนขาย
- [ ] บันทึกความเสี่ยง margin แพ็กหลักโดยคง rights เดิม; ไม่รวมการลด Enterprise quota ใน scope นี้

มติธุรกิจ D1–D12 ครบแล้ว; งาน P0 ที่ยังเปิดเป็นการตรวจ source และออกแบบทางเทคนิค ไม่ใช่รอ Owner ตอบเพิ่ม. ก่อน code edits อ่าน ponytail full ตาม AGENTS; ไม่แก้ package.json หรือเพิ่ม dependency โดยไม่มีเหตุจำเป็น

## 3. P1 — Contracts, catalog และ policy publication

ไฟล์หลัก: packages/contracts/src/billing.ts, billing/domain/billing-policy.ts, billing/presentation/billing.dto.ts, billing.controller.ts และ billing configuration/readiness services

- [ ] เพิ่ม typed add-on offer แยกชนิดสินค้า/หน่วย พร้อม validityMonths=12, THB integer satang และหก approved prices; ไม่มี arbitrary amount หรือ package tier ปลอม
- [ ] Quote/snapshot ใช้ ADD_ON discriminator; decoder ของ snapshot เก่ายังคง FULL_PACKAGE. Pin policy/price/tax/account-mode/source/consent และ reject mixed deal/interval/promotion fields
- [ ] Policy field ใหม่ไม่มีค่า = closed/unavailable. แยก CHAT/IMAGE sale readiness จาก gate กลางและ payment-mode gates เดิม; publication preview ต้องแสดง product impact
- [ ] ขยาย customer status/history ตาม spec §17: รวม admin+purchased เป็น additional; ไม่ส่ง reserved/internal breakdown. Internal/operator contracts ยังคง included/gift/purchased/held/expired. Cursor/event ID stable; balance error ไม่กลายเป็น zero
- [ ] ระบุผู้มีสิทธิ์ read quota กับ financial/history/document ตามช่องทางเดิม ไม่ให้การโชว์ยอดกับพนักงานเปิดสิทธิ์ billing ทั้งชุด

Evidence เป้าหมาย: contract decode/validation และ API↔web type compatibility; snapshot เดิมไม่เปลี่ยน semantics (A01, A11, A13)

## 4. P2 — Grants, anniversary และ commercial reservations

ไฟล์หลัก: apps/api/prisma/schema.prisma + additive migration, company-ai-usage-meter.ts, company-ai-budget-policy.ts, company-ai-budget-reservation.ts, billing-receipt-grants.ts

- [ ] เพิ่ม CHAT grants/funding entries เท่าที่ §8 ต้องใช้ พร้อม integer bounds, company/account ownership, unique paid/cycle/settlement sources, invoice/reservation references และ indexes ตาม query จริง
- [ ] เก็บ anchor จาก paid continuity โดยแยกจาก calendar monthKey. คำนวณวัน 29/30/31, leap year และ 12 monthly cycles จาก anchor ต้นทาง ไม่บวก 30 วันหรือ chain-clamp จน anchor ไหล
- [ ] สร้าง included cycle แบบ lazy/idempotent ภายใน paid coverage; ไม่ mint เดือนที่ข้ามและไม่ reset จากการ upgrade/repeat/top-up
- [ ] Funding จอง included ก่อน purchased FEFO; แบ่งหนึ่ง debit หลาย lots. เก็บ original cycle/lot บน hold เพื่อ settle/correct ข้ามรอบได้
- [ ] ต่อ paid wallet reservation กับ AiBudgetReservation ใน SHARED/SPLIT โดยรักษา operational safety policy. ให้ usage cost เดิมเป็น source ที่ไม่ถูกแก้ด้วย refund/compensation
- [ ] ขยาย receipt grant ด้วย ADD_ON validity/helper ที่ไม่แก้ CompanyPlanTerm และแยกการ sort package/gift/purchased. Package REPEAT ห้ามขยาย expiry ADD_ON
- [ ] สร้าง read model balance/lots/history ที่คำนวณ available หลัง hold; audit entries ใช้ reference ไม่เก็บข้อความ/ภาพลูกค้าเพิ่ม

Evidence เป้าหมาย: PG transaction/concurrency/unique constraints และ cycle/expiry cases A05–A09. ต้องมีผลว่า two-month reservations แย่ง purchased lot เดียวกันไม่ใช้เกินได้ และ reset ไม่ย้าย settlement ไปยอดใหม่

## 5. P3 — ซื้อ จ่าย เพิ่มยอด และกู้รายการ

ไฟล์หลัก: billing.service.ts, stripe.client.ts, paid-checkout-invoice.ts, paid-invoice.ts, billing-reconciler.service.ts, billing-checkout-expiry.service.ts, billing-issues.ts, billing-notifications.service.ts

- [ ] Branch ADD_ON ก่อน package paidVariant/repeat/restart/subscription checks ที่ไม่เกี่ยวข้อง; reuse OWNER/profile/company gate และ active-attempt concurrency เดิม
- [ ] Reuse one-time CARD_ONCE/PROMPTPAY_ONCE กับ quote เดิม; ไม่สร้าง recurring Price/subscription หรือเลื่อน collection. หก native Price mappings เป็นงาน configuration ภายหลัง ไม่สร้างใน phase เอกสาร
- [ ] Paid validation รองรับ exact add-on Price/units/invoice line/tax และ account-mode; ไม่ weaken package validators ให้รับ invoice ใดก็ได้
- [ ] Transaction: verified source + source hash → grant → apply marker → audit/outbox. Unique invoice/line/attempt source รองรับ lost response และ replay
- [ ] Reconciler/financial reads รู้ว่า add-on invoice ไม่ใช่ package period. เปรียบเทียบ baseSubscriptionId/paidThrough/nextChargeAt/tier/capacity ก่อนหลัง
- [ ] Paid-held/retry ใช้ source เดิม; accepted paid orders ยังคงกู้ได้เมื่อ gates ปิด/ราคาเปลี่ยน/สมาชิกเปลี่ยน. Unknown payment ไม่สร้าง replacement charge
- [ ] Existing Checkout expiry/cancel และ operator repair ใช้ได้กับ add-on โดยไม่ไป resume/restore collection ของ package ที่ไม่เคยถูกพัก

Evidence เป้าหมาย: A01–A04, A11, A13 ทั้งวิธีจ่ายที่เปิดใช้งาน และ deliberate second purchase ต่างจาก retry

## 6. P4 — การใช้จริง คืนเงิน และข้อมูลการเงิน

ไฟล์หลัก: company-ai-usage-meter.ts, company-ocr-governance.ts, process-line-webhook.use-case.ts, expenses/infrastructure/receipt-ocr.client.ts, billing-refund-source.ts, billing-refunds.service.ts, billing-financial.ts, billing-settlement.service.ts

- [ ] ทำให้การมี purchased CHAT ใช้ต่อได้หลัง included หมด โดยไม่เพิ่ม monthly admin cap และไม่ bypass TOTAL/model/security controls
- [ ] รวม intake/plan/loop/response calls ให้คิด CHAT ครั้งเดียวต่อ invocation; OCR routing/extract ไม่ตัด CHAT. Gateway ไม่เขียน DB
- [ ] OCR request fence จอง/ใช้/คืนหนึ่งหน่วยตาม D4; อ่านซ้ำภายใน operation เดิมไม่เพิ่มหน่วย. ค่า failed provider attempts ยังคงอยู่ใน cost report
- [ ] Refund preview ผูก lot/unused units/held units/เงินจริงกับ original invoice; freeze ก่อน provider I/O และ recheck version. Apply reversal/refund evidence ครั้งเดียว
- [ ] Partial refund rounding และหน่วยย่อย CHAT ชัดเจน; units ไม่เท่ากับบาทขาย. Dashboard-origin refund/dispute/late cost correction มี review และไม่ลบ consumed evidence
- [ ] ขยาย history/settlement รายงาน cash vs remaining service obligation vs contribution โดยไม่สร้าง accounting recognition policy ใหม่

Evidence เป้าหมาย: A05, A08–A10, A14; usage-vs-refund และ expiry-vs-refund races ต้องตรวจใน DB จริงเมื่อเริ่ม implementation

## 7. P5 — Web, LINE และ operator

ไฟล์หลัก: apps/web/src/features/billing/BillingPage.tsx และ billing client/contracts เดิม, billing-admin, LINE billing entry/credit refusal. อ่าน apps/web/AGENTS.md ก่อนแก้ web

- [ ] แยกบัตร “เครดิตแชต” และ “จำนวนอ่านรูปใบเสร็จ”; ลูกค้าเห็นจากแพ็กเกจ/ยอดเพิ่มเติม/คงเหลือรวมตาม §17. ยอดเพิ่มเติมรวม admin+ซื้อ ไม่แสดงยอดกันไว้หรือ source breakdown
- [ ] UI placement ตาม spec §7.1: เพิ่มแท็บ “เครดิตและรูป” ถัดจาก “แพ็กเกจ”, แสดงยอดก่อนสาม price cards ต่อสินค้า, ปุ่มซื้อเพิ่มจาก overview/LINE เข้า section ที่ตรงกัน. Mobile cards เรียงลง; ราคาอ่าน catalog เดียวกับ quote. ตำแหน่งนี้เป็นข้อเสนอในเอกสาร ยังไม่ใช่หน้าจอที่ deploy แล้ว
- [ ] รายการซื้อเพิ่มแสดง expiry ต่อ lot และ next expiry; เครดิตแพ็กแสดงวันเวลาครบรอบ ไม่ใช้ป้ายต้นเดือนเดิม
- [ ] Review/checkout/return ใช้ flow เดิมที่รองรับ mobile และ LINE handoff; ไม่ส่ง company/actor authority จาก group chat หรือ query string อย่างเดียว
- [ ] Hint token ตามสเปก ไม่อ้างจำนวนข้อความรับประกัน; hint รูปบอกชนิด/หน่วยที่ใช้ได้. หน้าลูกค้าไม่แสดง provider cost หรือ margin
- [ ] pending/unknown/paid-applying/paid-held/failure/expired/no-permission/empty/loading มีทางไปต่อถูกต้อง; polling ไม่สร้าง payment ใหม่
- [ ] หน้าประวัติลูกค้าแสดงการซื้อ ได้รับเพิ่ม ใช้ คืนหน่วย หมดอายุ และคืนเงินในภาษาไทย; ไม่แสดง reserve/release ภายใน. Operator เห็นแหล่งยอด/hold/reference/recovery ตาม scope โดยไม่เปิดข้อมูลนั้นใน customer DTO
- [ ] ปิด sale gate แล้วยังดูยอด ใช้ยอดที่มีสิทธิ์ และกู้รายการเดิมได้; ข้อความ cap blocked ไม่ชวนเติมเครดิตเพื่อแก้ผิดสาเหตุ

Evidence เป้าหมาย: A07, A11–A12; browser desktop/mobile และ Web→LINE handoff เท่าที่มี path เดิม ไม่สร้าง prototype ใหม่แทน feature integration

## 8. P6 — Verification และ migration evidence

Owner ระบุไม่ทดสอบเพิ่มในงานประเมิน/เอกสารครั้งนี้: **รายการด้านล่างยังไม่รัน**. เป็นเกณฑ์ส่งมอบ implementation ที่มีผลต่อเงินจริง ไม่ใช้ประวัติ test เก่ามารับรอง add-on ใหม่

| ชุดตรวจ | กรณีหลัก | Spec IDs |
| --- | --- | --- |
| Product/contracts | ราคา/หน่วย/expiry/tax, legacy decode, มติ D1–D5 ฉบับที่ยืนยันครบ | A01, A07, A11, A13 |
| DB ledger | grant once, split funding, expiry/reset concurrency, duplicate/late settle, refund races | A03, A05–A07, A10 |
| Payment/apply | one-time card/QR, lost responses, async payment, wrong invoice/account-mode, paid-held recovery, subscription invariants | A02–A04, A11, A13 |
| Consumption | CHAT multi-call, deterministic no-call, OCR one unit/multi-call/failure, unsupported files, operational caps | A05, A08–A09 |
| UI/integration | buy→pay→grant→use ทั้งสองสินค้า; loading/error/permission/pending/history/return mobile | A02, A07, A12 |
| Migration/report | legacy cohort/cutover/anchor, no paid backfill, annual/prepaid/deal/admin preservation, contribution reconciliation | A06, A13–A14 |

เริ่มจาก focused tests ที่มีอยู่ใน billing-package, meter/reservation, billing-receipts, paid-checkout-invoice และ refund source แล้วเพิ่มเฉพาะ invariant ใหม่. ใช้ PG checks สำหรับ race/atomicity และ browser flow สำหรับการเชื่อม API→UI; ไม่เขียน unit test ที่เพียงเทียบ constants ซ้ำทั้งตาราง. ไม่รัน broad suites ซ้ำเมื่อไม่มีความเปลี่ยนแปลงหรือความเสี่ยงที่ต้องพิสูจน์เพิ่ม

Migration evidence ที่ต้องแนบ:

- [ ] additive migration และ legacy/default-closed readers; estimate rows/lock scope จาก read-only preflight ที่ได้รับอนุญาต
- [ ] รายบริษัทแสดง source anchor, current legacy remaining, cutover time, first cycle และเหตุผลกลุ่มที่ยัง migrate ไม่ได้; ไม่เก็บ PII ใน evidence
- [ ] ช่วงเปลี่ยนผ่านเป็นไปตามมติ D9: บันทึก legacy grants ก่อน cutover และ transition cost; หลัง cutover ไม่มี calendar reset และ anniversary grant ซ้อนกัน. Existing invoices/usage snapshots ไม่ rewrite
- [ ] grants/funding/holds/remaining aggregate reconcile; cutover ไม่ต้องเรียก provider หรือจ่ายเงินลูกค้าเพื่อพิสูจน์ data migration
- [ ] readiness record ผูก source SHA, schema/policy versions, account/mode, acceptance IDs และผลจริง. ช่องที่ยังไม่ตรวจเป็น pending พร้อมเหตุผล

## 9. P7 — Release และ recovery ภายหลัง

ขั้นนี้ไม่อยู่ในคำขอให้เขียนเอกสาร. เมื่อมีคำสั่งให้นำขึ้นระบบ ต้องอ่าน [cloud operations](../runbooks/cloud-environment-operations.md) และ [deployment protocol](../runbooks/uat-production-v2-deployment.md) ฉบับปัจจุบันก่อนทุก deploy/promotion/retry/gate change

- [ ] ลง compatible schema/readers และ consumer/refund paths ก่อน sale gates; สร้าง/ตรวจ approved native add-on prices โดย snapshot ไม่อาศัย local constants อย่างเดียว
- [ ] บันทึก exact UAT, READY, Production run IDs; ไม่ dispatch ซ้ำเพื่อหา error ถัดไป. signed result และ customer OPEN acceptance ต้องครบก่อนรายงาน live
- [ ] ก่อนเปิดแต่ละ product ตรวจการย้ายตาม D9 ที่ตกลงแล้ว, reservation/cycle readiness, gate/current tax, original package regression, balance/history และ repair path ของสินค้านั้น
- [ ] ปิดเฉพาะ new purchases ได้ทันทีด้วย controls เดิมที่ขยาย product scope โดยไม่หยุด fulfillment/reconcile/refund ของรายการจ่ายแล้ว
- [ ] Recovery คง paid lots/cost history และใช้ version-compatible readers/forward repair; ไม่ rollback schema/data ที่จะลบสิทธิ์ลูกค้า

## 10. สถานะงานเอกสารรอบนี้

- [x] อ่าน source/docs/contracts/schema ที่เกี่ยวข้อง และแยกฐานเดิมกับ target design
- [x] เขียน spec ครอบคลุม product, architecture, state transitions, permissions, migration และ A01–A14
- [x] เขียนแผน P0–P7 พร้อม module impact/dependencies/evidence
- [x] ตรวจ local links 21 จุด ตารางราคาหก offer และสูตรต้นทุนทั้งหกแถว, A01–A14, whitespace ของเอกสารใหม่ด้วย Python stdlib; git diff --check ของเอกสารเดิมที่แก้ผ่าน. อัปเดต memory และใส่ลิงก์มติใหม่ในสเปกเดิมแล้ว
- [ ] Implementation / tests / live payment / deployment — ยังไม่ทำ

## 11. งานเพิ่มจาก E2E impact audit — ผูกกับ phase เดิม

ผลตรวจ source ใน audit มี F01–F12 และ acceptance E01–E22. รายการนี้เป็น dependency ที่ต้องรวมใน implementation ไม่ใช่ phase แยกที่ค่อยทำหลังเปิดขาย; รายละเอียด target อยู่ spec §15. ไม่มีข้อใดถูกติ๊กว่าแก้โค้ดแล้วจากการเขียนเอกสาร

| Phase | งานที่ต้องเพิ่มให้ครบ | Modules เพิ่ม/จุดที่ต้องระวัง | Evidence |
| --- | --- | --- | --- |
| P0 | ทำ cohort transition calculation ตาม D9 ก่อน/หลังต้นเดือนและ anniversary; pin Bangkok calculator/paid coverage; lock matrix ครอบคลุมทุก writer | package UTC interval helper, plan-term/lifecycle, calendar aggregates, billing/refund/config/usage locks | F03/F05/F08; E07/E09/E10/E15 |
| P1 | ADD_ON native one-time Price branch และ bundle quantity=1; invoice productKind queryable + legacy PACKAGE; status แยก package payment กับ pending add-on | billing-policy/provider-configuration, DTO/contracts, billing.service status/readers | F01/F02; E01/E05/E20 |
| P2 | CHAT funding รองรับ SHARED; receipt commercial entries มี stable operation/generation; migrate projections ไม่ count released rows | schema, meter/reservation, receipt balance/OCR governance | F03/F07; E06/E07/E14 |
| P3 | Filter package readers ก่อน periodEnd sort; apply/retry/cancel/expiry dispatch ตามสินค้า; activeAttempt compare-and-set; no package fulfillment/referral | reconciler, operations/import/retry surface, checkout-expiry, collection, package-request | F01/F02/F12; E02–E05/E20/E22 |
| P4 | API budget-step inherit month/cycle context จาก parent; ตรวจ envelope ทุก child call และ actual provider bounds | internal-ai-budget controller, Gateway budget-seam/provider/durability/shutdown, provider factory/AgentCore | F03/F04/F10; E07/E08/E19 |
| P4 | ต่อ trusted file eligibility ทุก admission caller และ capture job/chunks; one-unit success/release/stable generation | expense-capture-read-runner/preprocess, Web receipt, LINE intake/receipt, bank statement client, orphan recovery | F06/F07; E11–E14 |
| P4 | Pin usage versions/refund allocation; cumulative rounding; ทุก financial observer เข้า ADD_ON lot reconciliation เดียวกัน | refund-source/refunds/financial/settlement, issue/retry, billing receipt adjustments | F08; E15–E17 |
| P4–P5 | Operator release/charge/late correction ใช้ funding seam; unresolved holds เก่ากว่าสองเดือนยังค้นได้; retention ไม่ลบ commercial evidence | partner-ai-credit-holds, admin usage/adjustments, reservation engine, LINE/AI retention dependency | F10; E19 |
| P5 | Lapsed member อ่าน retained balance ได้ตาม scope; exact recovery GET routes เท่านั้น; แยก security disable | AuthGuard, plan-term sweep/lifecycle, quota/history contracts | F09; E18 |
| P5 | Product-specific UI/copy ครบ return/history/documents/notification และ no-upsell เมื่อ operational cap block | BillingPage/billing.api, LINE refusal/handoff, billing-admin, billing notifications/auth-email | F11; E20/E21 |
| P6 | เพิ่ม E01–E22 ใน evidence matrix; cost/refund/attribution/remaining obligation reconcile; package regression | settlement/report, sales-console attribution, legacy readers and migration cohorts | F01–F12; A01–A14 |
| P7 | Consumer/refund/auth/repair พร้อมก่อน gate ของสินค้านั้น; runtime evidence ไม่แทนด้วย static audit | protocol/run IDs/schema-policy-account-mode readiness | ทุก P1 ที่กระทบสินค้า + journey P2 ผ่าน |

ลำดับสำคัญ: product-aware readers และ stable funding ต้องมาก่อนรับ payment ใหม่; UI ที่แสดงยอดต้องอ่าน projection เดียวกับ admission/refund. ไม่เปิด IMAGE เพียงเพราะมี BillingReceiptGrant อยู่แล้ว และไม่เปิด CHAT เพียงเพราะ meter มี monthly cap

### 11.1 Lock/cutover handoff ที่ยังต้องเติมใน P0

- [ ] ตารางทุก writer: lock แรก→ลำดับถัดไป→row/FK lock→version recheck→commit; รวมสองเดือน/รอบใช้งาน lot เดียวและ refund/expiry พร้อม usage. ห้ามเพิ่ม company wallet lock ต่างลำดับระหว่าง billing กับ AI/OCR
- [ ] ตัวอย่างบริษัทก่อน/หลัง cutover ระบุ paid continuity, legacy balance/reset, transition grants, consumed/held, first anniversary allowance และ paid coverage; บอก explicitly หากต้องขอมติสิทธิ์ช่วงรอยต่อ
- [ ] นิยาม commercial child-call context ข้าม anniversary/expiry กับ operational month แยกกัน; reservation ก่อน boundary settle ได้ แต่การเริ่มงานใหม่ไม่เปิด lot ที่หมดอายุ
- [ ] Technical refund allocation/rounding fixture ตาม original invoice โดยไม่อนุมาน unit price จากรายการขายใหม่; D5 อนุมัติแล้ว; technical allocation ยังต้องมี evidence
- [ ] Matrix paid/deal cohorts ระบุ receipt account binding, legacy quota enforcement และ purchased-lot consumer readiness; cohort ที่ยังไม่มีทางใช้ยอดไม่เปิดขาย และไม่แก้ term/legacy rights เพื่อบังคับใช้ grant

### 11.2 สถานะหลัง audit

- [x] ไล่ source ครบ payment→grant→CHAT/OCR→refund→membership→views/operations และระบุ dependent modules ใน audit
- [x] แยก source inconsistency F04 ออกจาก future integration gaps; บันทึกว่า working tree ไม่ใช่ deployed-source verification
- [x] ขยาย spec §15 และแผนนี้ให้มี invoice discriminator, native Price protocol, parent authority, receipt durable effects, financial observers และ recovery routes
- [ ] แก้ runtime / รัน E01–E22 / ตรวจ Production journey — ไม่อยู่ในงานเอกสารรอบนี้

## 12. ขยาย admin console เข้ากลไก ADD_ON ร่วม

มติ D6: การซื้อและ admin เพิ่มยอดใช้กลไกเพิ่มยอดเดียวกัน ทั้งรูป/แชต ตาม spec §16. D3–D5 รับตามคำแนะนำแล้ว; D7 ยืนยันยอดแถม/ชดเชยเท่านั้น และ D8 ยืนยันอายุ 12 เดือน/แพ็ก→admin→ซื้อแล้ว. D9 ยืนยันคง legacy จน anniversary แล้วเริ่ม allowance เต็ม ไม่ prorate; รอบปกติเต็มเดือนตาม anchor. สิ่งเหล่านี้ไม่เปลี่ยนราคา approved

| Phase | งานเพิ่มเติม | Dependency / evidence |
| --- | --- | --- |
| P0 | ใช้มติ D7–D9 ที่ยืนยันแล้วและนำ admin grant/revoke writers เข้า lock matrix; รักษา legacy grant/override semantics | admin receipt adjustments, AI budget settings, A15–A18 |
| P1 | Typed admin preview/command/view รองรับ productKind และ grant source; อำนาจ customer payment กับ admin operation แยกตาม permission เดิม | contracts, billing-admin controller/DTO/client |
| P2 | Application seam เดียวสำหรับ PAID_CHECKOUT/ADMIN_GRANT พร้อม product-specific unit validation, stable source and atomic entries | grant helpers/ledger, receipt projections, no direct grant writes outside seam |
| P3 | Paid apply และ admin-approved apply เรียก seam เดียว; source proof คนละชนิดและ client ปลอมชนิดไม่ได้ | reconciler, BillingReceiptAdjustmentsService, approval/credential fences |
| P4 | Consumer ใช้ admin lots ตาม D8; revoke/compensation มี source/hold fencing; admin grant ฟรีไม่เกิด financial refund หรือ revenue | OCR/CHAT usage, adjustments/refunds/reporting |
| P5 | Admin console ใช้รูปแบบเลือก CHAT/IMAGE, จำนวน, expiry, reason และ preview ร่วม; customer balance รวมยอดที่ admin ให้กับยอดซื้อเป็นยอดเพิ่มเติม; history แสดงเหตุการณ์จริงตามสิทธิ์ โดยรายละเอียด source อยู่ operator | billing-admin UI, billing/LINE balance, notifications |
| P6 | E23–E27 เพิ่มจาก E01–E22 รวม 27 scenarios; A15–A18 เพิ่มจาก A01–A14 | แผนตรวจเท่านั้น ยังไม่รัน |

- [x] ตรวจ admin receipt flow เดิม: grant เขียน BillingReceiptGrant โดยตรง, expiry จำกัดด้วย term/paidThrough และมี approve/credential/source checks ที่ต้องคงไว้
- [x] ตรวจ AI admin setting เดิม: monthly budget/cap override ไม่ใช่ purchased/admin credit grant; ไม่ใช้แทนการเพิ่มยอด
- [x] ปรับ spec/audit ให้มี admin source, shared application, no fake invoice และ legacy preservation
- [x] D7–D8 ยืนยันแล้ว: admin ให้ยอดแถม/ชดเชย อายุ 12 เดือน พักใช้เมื่อสมาชิกหมด ลำดับแพ็ก→admin→ซื้อ ทั้งสองสินค้า
- [x] D9 ยืนยันคงการเติมเดิมจนถึงวันครบรอบ ไม่ prorate. การทำเครื่องหมายนี้รับรองมติเท่านั้น; implementation/evidence ยังไม่เริ่ม

## 13. D10 — รวมยอดเพิ่มเติม ซ่อนข้อมูลภายใน และตรวจ field/wording ทั้ง flow

Owner ยืนยัน 2026-09-29: ลูกค้าเห็น **จากแพ็กเกจ / ยอดเพิ่มเติม / คงเหลือรวม**; ยอดเพิ่มเติมรวม admin gift กับ paid, ไม่มียอดกันไว้บนจอ. [Spec §17](../specs/chat-credit-and-receipt-addons-spec-th.md) กำหนด customer DTO, หน่วย, สูตร, fixture และ copy matrix. [Audit U01–U10/E28–E42](../research/chat-credit-and-receipt-addons-customer-balance-consistency-audit-2026-09-29-th.md) ระบุ source/module dependencies; ทั้งหมดเป็น target ที่ยังไม่ implement

| Phase | งานที่ต้องรวมใน phase เดิม | จุดตรวจ/ผลส่งมอบ |
| --- | --- | --- |
| P1 | เพิ่ม typed quotaSummary allowlist แยก customer/operator, literal unitScale, finite/unlimited และ public use/purchase states; catalog/admin/history quantityUnits vs priceSatang | ไม่ reinterpret old monthlyAllowance.additionalRemaining; validate types/default/missing/unknown version; backend→frontend contract |
| P2 | Server consistent snapshot รวม admin+paid และหัก reservations/refund freeze ครั้งเดียว; dates/expiry aggregation; no customer source breakdown | package+additional=total; no negative/NaN/zero-on-error; funding order/expiry/refund provenanceคงเดิม |
| P3 | Customer return/status/history ใช้ summary ใหม่หลัง committed grant; error/CTAแยกก่อนส่งจ่าย/กำลังตรวจผล/paid-applying/review | No optimistic increment, no wrong package renewal text, no recharge on unknown |
| P4 | Admission คืน public cause ที่แยก commercial exhaustion/insufficient/ops cap/processing/unavailable/membership; customer history aggregate logical operation | ไม่เดาจาก budgetScope อย่างเดียว; no false refund/no-charge/file-saved statements; typed error codeยังอยู่ภายใน |
| P5 | BillingPage/billing.api/billing-display/overview/detail/preview/history/adjustments/notification/customer export ใช้ labels/fieldsชุดเดียว | ช่อง admin/paid รวม, no held row/tooltip, Mobile/Desktop/screen readerตรงกัน |
| P5 | ExpensesPages, banking.logic, workspace dictionary, common api-error-message/authed-fetch/toast และ per-page handlers | Thai safe fallback; unknown plain Errorไม่ออก UI; actionตรงstage ไม่ใช่แค่เปลี่ยนคำ |
| P4–P5 | LINE webhook/business-card/formatter/non-receipt/public-policy/drain/delivery/notify อ่าน safe projection/copy | ไม่ให้ LLMแต่ง balance; calendar vs anniversaryถูก; queue template migration/verificationไม่ค้างหรือส่งซ้ำ |
| P5 | Admin receipt/billing overview/AI credit holds ยังมี source/holdsตามpermission พร้อม presenterแยก | customer sanitizationไม่ทำoperatorกู้/refundไม่ได้; same arithmeticต่างaudience |
| P6 | ตรวจ E28–E42 เพิ่มจาก E01–E27; A19–A24 พร้อม originalpackage/legacyregressions | 42 scenariosยังNot run; source/schema/policy/template versionsและactualevidenceครบก่อนclaimผ่าน |

### 13.1 รายการตรวจ consistency ก่อนรับ implementation

- [ ] ตรวจ producer→consumer ของทุก field ใน spec §17.3; quantityUnits CHAT100/IMAGE1, satang100, customer label unitsและprecision; original invoice/snapshotไม่reprice
- [ ] สองสินค้าคำนวณใน snapshotเดียว; summary/readiness/use/purchase statesไม่ขัดกัน; pending/expired/disabled/errorไม่ใช้ remaining=0 แทนเหตุ
- [ ] Catalog→quote→checkout→applied→balance→history/noticeใช้product/quantity/price/companyเดียวกัน; admin grantไม่มีpaid invoiceและไม่cash-refund
- [ ] Customer payload/DOM/tooltip/aria-label/export/LINE/emailไม่มี reserved/sourceHash/raw internal error/admin breakdown; operator scopeยังครบ. Fieldหายไม่fallbackไปrawobject
- [ ] ตรวจทุกbranchใน copy matrix พร้อม valid next action: profile/login/permission/stale quote/closed sales/unknown payment/paid-held/partialrefund/filetype/operationalcap/long-runningงาน
- [ ] Pending LINE/static refusal payloadก่อนเปลี่ยนtemplateยัง verify/reconcileได้; ไม่ปิดintegrityguardหรือrewriteส่งสำเร็จแล้ว. No duplicate delivery
- [ ] Company switch/back/refresh/mobile handoff/out-of-order responsesไม่ใช้balance/priceจากบริษัทเก่าหรือ snapshotเก่า;หลังmutationอ่านserverใหม่
- [ ] Unknown enum/plain Error/network failureมีThai fallbackตามstage;messageไม่มีคำสัญญาเรื่องcharge/refund/retainedfileที่sourceยังไม่ยืนยัน
- [ ] Browser assertionsใช้labelsจริงและfieldvalues ไม่เพียง screenshotดูสวย;ถ้าจำลองproviderต้องรายงานว่าเป็นsimulationและยังไม่ใช่livepaidE2E

### 13.2 สถานะงานเอกสารรอบนี้

- [x] อ่าน source ของ customer/admin formatter, billing contracts/read model, Web error/i18n/expense/banking consumers และ LINE immediate/drain integrity dependencies
- [x] แก้ข้อกำหนดเดิมให้ไม่ขัด D10 เพิ่ม spec §17/A19–A24 และ audit U01–U10/E28–E42; แนบ JSON fixtureและสูตรที่ตรวจได้
- [x] Document check PASS: 72 local links/48 source-line bounds, A01–A24/E01–E42/U01–U10/D1–D10, ราคาหกชุดเดิม, JSON field allowlist/types/scales/UTC dates/sums และ whitespace; git diff --check ของ legacy notes ผ่าน. ไม่มี application/browser/payment E2E
- [ ] แก้ application / run runtime E2E / deploy — ยังไม่ทำตามขอบเขต spec+plan และ source audit

## 14. แนวทางแก้ 10 จุดที่ Owner รับแล้ว — D11

Owner ตอบ “เอาตามที่แนะนำปรับเลย มีคำถามเพิ่มไหม” หลังสรุป U01–U10. บันทึกเป็นมติ D11 และปรับ spec/plan ในขอบเขตเอกสารเดิม. รายการด้านล่างเป็นงาน implementation ที่ยังไม่เริ่ม; reuse contracts/helpers/permission/guards เดิมเมื่อความหมายตรง ไม่สร้างระบบใหม่เพื่อแก้แต่ละจุด

| จุด | งานที่ต้องทำ | Phase / เกณฑ์ตรวจรับ | สถานะ implementation |
| --- | --- | --- | --- |
| U01 | Customer quota API ส่งเฉพาะข้อมูลที่อนุญาต; operator detail แยกตามสิทธิ์ ครบ Web/LINE/export/history | P1, P5 / A19, A23; E28, E40 | ยังไม่เริ่ม |
| U02 | แปลงยอด gift/paid เป็น additionalRemainingUnits ใหม่; แยก customer/operator presenter โดยไม่เปลี่ยนความหมาย field เดิม | P1, P5 / A19, A20; E28, E35, E40 | ยังไม่เริ่ม |
| U03 | บังคับหน่วยเครดิต/รูป/สตางค์และ finite/unlimited; แยกยอดศูนย์จริงจากข้อมูลขาดหรืออ่านไม่ได้ | P1–P2 / A20, A23; E30, E31 | ยังไม่เริ่ม |
| U04 | รวมเฉพาะยอดแสดงผล; รักษารายการต้นทาง วันหมดอายุ ลำดับใช้ สิทธิ์คืนเงิน และยอดระหว่างสมาชิกหมด | P2, P4 / A10, A20, A21; E29, E32, E42 | ยังไม่เริ่ม |
| U05 | ให้ admission ส่งสาเหตุจริงและปุ่มทางไปต่อที่แก้เหตุได้ แยกยอดไม่พอกับขีดจำกัดบริษัท/สมาชิก/ระบบ | P4–P5 / A09, A22; E33, E41 | ยังไม่เริ่ม |
| U06 | ใช้คำไทย/วันเติม/หน่วยชุดเดียวตาม spec §17.4 ในเว็บ อัปโหลด LINE เอกสาร ประวัติ และอีเมล | P5 / A12, A22, A24; E35, E41 | ยังไม่เริ่ม |
| U07 | รองรับ LINE refusal ที่ค้างจาก template เดิมด้วย version-aware verification หรือ controlled re-render ภายใต้ lock/fence เดิม | P4–P5 / A24; E37 | ยังไม่เริ่ม |
| U08 | Thai error fallback ตามขั้นตอน; raw diagnostics อยู่ operator/log; ผลจ่ายไม่ทราบให้ตรวจรายการเดิม | P3, P5 / A04, A22, A23; E34, E38 | ยังไม่เริ่ม |
| U09 | อ่านยอดจาก server snapshot เดียว; รักษา company/request guards; refresh หลัง commit ไม่เพิ่มยอดเองบน client | P2–P3, P5 / A21, A23; E29, E39 | ยังไม่เริ่ม |
| U10 | ประวัติหนึ่งรายการต่อ logical operation; ผลงาน/คืนหน่วย/คืนเงินอ้างหลักฐานจริง; ไม่เผย reserve/release ภายใน | P4–P5 / A18, A21, A24; E36, E42 | ยังไม่เริ่ม |

ลำดับงานยังยึด P1–P6: กำหนด contract และหน่วยก่อน → ledger/projection และ source-bound money → admission/payment/customer consumers → copy/error/history ครบช่องทาง. U07 ต้องพร้อมก่อนนำข้อความ LINE ใหม่ไปใช้ ไม่รอแก้หลังเกิดคิวค้าง. ปิดแต่ละจุดด้วยหลักฐานเฉพาะที่ระบุ แล้วตรวจเส้นทางร่วม E01–E42; การอนุมัติแนวทางไม่ทำให้ผลตรวจกลายเป็น Pass

ไม่มีคำถามธุรกิจค้างในขอบเขตนี้: Owner ตอบ D9 ว่า “คงการเติมเดิมจนถึงวันครบรอบ (แนะนำ)”. ตัวอย่างบริษัทที่ครบรอบวันที่ 15: เติมเดิม 1 ต.ค. → reset included เต็ม 15 ต.ค. → ไม่เติม 1 พ.ย. → reset 15 พ.ย.; ยอดซื้อ/แถมไม่เปลี่ยน. ตรวจวันครบรอบตรงต้นเดือนให้ออก grant ครั้งเดียว และตรวจต้นทุนรอยต่อใน E07/E09/E10 ตาม spec §11. รอบปกติยังเป็นเดือนปฏิทินตามวันครบรอบ ไม่ใช่ 30 วันตายตัว. รายละเอียด lock/transaction/template compatibility เป็นงานออกแบบทางเทคนิคที่ทีมทำต่อได้ ไม่โยนให้ Owner เลือกวิธีเขียนโค้ด

หลักฐานตรวจเอกสาร D9/D11: PASS ทั้ง 5 เอกสาร/72 local links และ source bounds, มติ D1–D11, A01–A24/E01–E42, mapping U01–U10 ครบและยังไม่เริ่ม implementation, ราคาหกชุดเดิม, JSON units/ยอดรวม, ตัวอย่างช่วงย้ายและไม่มีข้อความปัจจุบันว่ารอ D9. ตรวจ whitespace ผ่าน; ไม่มี application/runtime E2E หรือการนำขึ้นระบบ

## 15. D12 — ปรับเครดิตเดิมและใช้ source ร่วมทั้ง flow

งานส่วนนี้รวมกับ P0–P6 เดิม ไม่เป็นโครงการแยก. ยอดลูกค้าและเพดานต้นทุนมี authority คนละชนิด; ทุก caller ใช้ shared resolver/projector ตาม spec §18 แล้วแยก customer/operator permissions. ไม่แก้เฉพาะชื่อบนหน้าจอ ไม่ทำให้ทุก request ผ่านด้วยการถอด safety/เงิน/สิทธิ์ guards และไม่กล่าวว่าระบบพร้อมเพราะ plan ครบ

| Phase | งานเพิ่มที่ต้องส่งมอบ | Dependency / acceptance | สถานะ |
| --- | --- | --- | --- |
| P0 | Writer/reader/action matrix จาก source จริง; จำแนก SHARED default/override, SPLIT active/pending, CHAT/TOTAL deals, manual/trial/paid/annual; pin legacy allowance provenance/cutover | policy resolver, deal apply/return, platform default, lifecycle; C01/C07/C10; A25/A29/A32 | ยังไม่เริ่ม implementation |
| P1 | Shared product/unit/source contract และ admin grant DTO; adapter แยก config semantics/legacy operations; public reason/actions ยึด §17/§18 | contracts billing/partner/AI, API controllers, typed errors; C01–C04/C12; E43/E46/E57/E58 | ยังไม่เริ่ม implementation |
| P2 | Ledger allocator/projection ร่วม; source class→FEFO, expiry12เดือน, transaction snapshot/context; wallet reservation ใช้ได้ทั้ง SHARED/SPLIT | receipt-grants/OCR governance, CHAT reservation/cycle; C03/C05/C09; E44/E47/E53/E60 | ยังไม่เริ่ม implementation |
| P2–P3 | Paid/admin เข้า shared application; admin ไม่เรียก cap setter/สร้าง invoice; activeAttempt/exclusivity เฉพาะ source เกี่ยวข้อง; preview/apply/retry คืนผลเดิม | adjustments/configuration/approval, billing apply/account locks; C02/C04; E43/E45/E56 | ยังไม่เริ่ม implementation |
| P3 | ปรับ package/deal/default/free-days/grace/trial writers โดยคง package-kind whitelist และสิทธิ์เก่า; แยก period/anniversary/lot expiry | billing-reconciler/package-request/free-days/trial-carryover, platform/company config, plan sweep; C06/C07; E48–E50 | ยังไม่เริ่ม implementation |
| P4 | ตรวจทุก provider lane: LINE, Web receipt, capture, statement, CRM, draft; trusted product classification, no-provider path, logical operation allocation | meter, clients/runner, API internal budget, Gateway step/settle; C08/C10; E51/E52/E54/E59 | ยังไม่เริ่ม implementation |
| P4 | ครอบคลุม refund/revoke/compensation/usage correction/operator holds ที่เก่ากว่าสองเดือน; pin original funding; cost/unit effects แยก | reservation/holds, financial observers, retention/recovery; C11; E55/E56 | ยังไม่เริ่ม implementation |
| P5 | Customer/operator snapshots จาก source ร่วม; admin สองงาน “เพิ่มยอดให้ลูกค้า” และ “ตั้งเพดานต้นทุน AI”; error/form/copy ทุกช่องทางรวม CRM/draft | BillingPage/admin/partner/platform UI, expenses/banking, timeline/preview/alerts, LINE queue, common errors; C09/C12; E53/E57–E59 | ยังไม่เริ่ม implementation |
| P6 | Existing tests + เฉพาะ invariants ใหม่; E01–E60 source→API→DB→Gateway→UI, rollback compatibility/cohort reconciliation | A01–A32, original package regression, runbook ก่อน live work; E60 | ยังไม่รัน |

### 15.1 รายการตรวจ source และเงื่อนไขก่อน implementation

- [ ] ทุก field ใน spec §18.1/§18.5 มี authoritative writer และรายชื่อ consumer; ห้ามใช้ cost/cap aggregate เป็น commercial balance หรือให้ UI คำนวณ net อีกสูตร
- [ ] Default/deal/legacy CHAT allowance ที่ migrate ไม่เป็นด่าน 80 ซ้ำหลังใช้ included หมด; explicit operational caps คงอยู่พร้อม source provenance และคำไทยที่ต่างจากยอดซื้อ
- [ ] แยก admin grant preconditions ออกจาก config validation: เพิ่มยอดไม่ต้องเปิด SPLIT/เลือก model/ปรับ C+O/TOTAL/รอเดือนหน้า; usage/readiness ยังตรวจเงื่อนไขจริง และ customer checkout ไม่ขายให้ cohort ที่ยังใช้ไม่ได้
- [ ] New gift preview ระบุ validity policy 12 เดือน; apply pin วันจริง; ไม่ใช้ old maxExpiry หรือ request expiresAt เป็น authority. Legacy operations ที่ค้างต้องใช้ decoder/version เดิม ไม่แปลงคำขอที่เคยอนุมัติเงียบ ๆ
- [ ] Paid/admin/config/refund/reserve/settle/cutover ใช้ lock order เดียว; config platform writer ไม่ย้อน company locks. Account checkout lock ไม่กลายเป็น blanket block ต่อ gift ที่ไม่แก้ payment source
- [ ] Package renewal/REPEAT/UPGRADE/free-days/grace ปรับเฉพาะ package kinds เดิม; deal/default reset ไม่แตะ purchased/admin source; alias kind เพื่อเลี่ยง validator เป็นสิ่งต้องห้าม
- [ ] Parent company/month/cycle/lot/model/pricing inheritance ปิด F04; deterministic ไม่เข้าด่าน provider ถ้าไม่เรียก AI; statement/PDF ไม่ถูกขาย IMAGE เพราะมี OCR bucket
- [ ] RepeatableRead/asOf/context ที่ใช้ในหน้าผู้ดูแลอยู่แล้วถูก reuse; company generation/caches ไม่ทำ summary คนละเวลา. ไม่อ้างว่า current code ไม่มี cache guards เพราะ admission เดิมใช้ fresh read อยู่แล้ว
- [ ] ทุกกรณีปฏิเสธจาก audit §4 ระบุ action ที่ถูกต้อง: reload preview, กลับ operation เดิม, แก้ cap ที่ field ถูก, ต่อสมาชิก, ติดต่อผู้ดูแล. Unknown result ไม่ชวนส่งใหม่หรือปลอม successful/no-charge/refund
- [ ] Operator diagnostics ยังเข้าถึงผ่านสิทธิ์เดิม; public payload/history/export ไม่ส่ง holds/source hash/cost/raw errors; queued LINE template compatibility พร้อมก่อนแก้ copy

### 15.2 วิธีตรวจรับโดยใช้ของเดิม

1. ตรวจ contract/validation/Thai mapping ด้วย focused tests ของ set-partner-ai-model, set-platform-ai-budget และ ai-budget.logic; เพิ่มเฉพาะการแยก grant กับ cap, field units/null และ typed public causes
2. ตรวจ PG integration สำหรับ grant+paid+usage/config/refund concurrency, parent month/cycle, multiple API instances, source ordering, expiry/cutover และ old-month recovery. Assertions ต้องตรวจทั้ง ledger/effects/member/config/invoice/outbox ไม่ใช่แค่ HTTP 200
3. ต่อ browser paths ที่มีใน audit §6 ให้ครอบคลุม valid journey และ loading/error/permission/stale/pending/return ทั้ง desktop/mobile; เพิ่ม admin product selector/preview→approve→balance และ customer buy→pay→grant→use แยกสินค้า. CRM/draft/background path ต้องมี evidence จาก caller จริง ไม่อนุมานจาก LINE ผ่าน
4. ตรวจ reconciliation ด้วย fixtures ที่มี package/gift/paid หลาย expiry: operatorและcustomerผลรวมตรง, ราคาหกชุดไม่เปลี่ยน, source lot ไม่สลับ, receipts/giftไม่มี financial invoice ปลอม. เก็บ evidence ต่อ source SHA/schema/policy/template/cohort; simulation ระบุให้ชัด ไม่เรียก live paid acceptance
5. เปิดเฉพาะ consumer/cohort/product ที่ตรวจพร้อมตาม P7. Sale gate ปิดต้องยังอ่าน/ใช้/กู้สิทธิ์เดิมได้; compatible rollback เท่านั้น. การรัน scripts ที่เขียน DB/provider ต้องใช้ environment ที่กำหนดสำหรับ implementation ไม่รันในงานเอกสารนี้

### 15.3 สถานะรอบนี้

- [x] ตรวจ source ของ current admin cap/gift writers, read models, deal/default/lifecycle mutation filters, provider consumers, error/Thai UI และ existing test/browser inventory
- [x] เพิ่ม audit C01–C12/E43–E60, spec §18/A25–A32 และ plan §15; D12 เป็นขอบเขตที่ Owner ขอให้แก้ร่วมกัน ไม่ต้องรอคำตอบธุรกิจเพิ่ม
- [x] Document validation PASS: 9 docs/132 local links/84 source-line bounds, D1–D12/A01–A32/E01–E60/C01–C12, scenario references, หกราคา/หน่วย/อายุเดิม, JSON allowlist/ยอด/วันที่ และ D9 ไม่มีสถานะค้าง; whitespace และ git diff --check ของ legacy notes ผ่าน. เป็นหลักฐานเอกสารเท่านั้น
- [ ] Application implementation, runtime E2E, live payment/provider, deployment/sale gate — ยังไม่ทำ
