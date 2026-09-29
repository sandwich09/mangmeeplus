# แผนงาน: ซื้อเครดิต AI และจำนวนอ่านรูปใบเสร็จเพิ่ม (ADD_ON)

วันที่: 2026-09-28
อัปเดตล่าสุด: 2026-09-29 — เขียนแผนใหม่เป็น PR A–G ที่ลงมือได้ตามรีวิว R1 (F-01…F-35) และมติ Owner/controller 2026-09-29; อ้างอิงโค้ดตรวจบน develop `8a91bc1c` (origin/develop `69fba9d3` ต่างเฉพาะ `extended-tests.yml` บรรทัด 286)
สถานะ: **มติธุรกิจครบ (เหลือ Q1–Q7 ที่มีค่าเริ่มต้น); ยังไม่เริ่ม implementation; ต้องรอ prerequisite ใน §1**

อ้างอิง: [สเปก](../specs/chat-credit-and-receipt-addons-spec-th.md) · [audit แหล่งข้อมูลร่วม + ตรวจซ้ำ](../research/chat-credit-and-receipt-addons-unified-source-audit-2026-09-29-th.md) · [แผนส่วนลดจากเซลล์](sales-event-discounts-plan-th.md) · แบบงานข้ามระบบ [purchase-without-setup/xx-cross-cutting.md](purchase-without-setup/xx-cross-cutting.md) · [cloud operations](../runbooks/cloud-environment-operations.md) · [UAT/Production protocol](../runbooks/uat-production-v2-deployment.md)

เอกสาร E2E impact audit 2026-09-28, customer-balance consistency audit 2026-09-29 และ memory การคุย 2026-09-28 ที่ร่างเดิมอ้างไม่มีใน repository (F-24); scenario E01–E42 และ U01–U10 เขียนใหม่ใน §9–§10 จากข้อความในสเปก

## 0. กติการ่วมทุก PR

- worktree แยกจาก `origin/develop` ล่าสุด; PR ไป develop แล้ว twin ไป main (admin merge ตามมติ Owner); ไม่แตะ worktree ของ agent อื่นที่กำลังทำงาน; stage เฉพาะ path ที่แก้
- ก่อนแก้โค้ดอ่าน `.agents/skills/ponytail/SKILL.md` (full mode) และ `apps/web/AGENTS.md` ก่อนแก้เว็บ
- ห้ามแก้ `package.json` (ยกเว้น dependency); ไม่เพิ่ม env/flag ใหม่ (`packages/config/src/index.ts` ถูก hash ใน W00 และมี literal check ใน pins); DTO ใหม่ทุก field optional และเป็น class DTO (`forbidNonWhitelisted`); ไม่มี Prisma enum ใหม่ (String); migration additive เท่านั้น
- ห้ามเรียก add-on ว่า “top-up” ในโค้ด/contract (F-32); ห้ามใส่ helper ใหม่ใน `packages/contracts/src/line-ai.ts` (ถูกคัดลอกเข้า LINE AI release manifest `ci.yml:984`) (F-15)
- รหัส error ใหม่ต้องมีข้อความไทยใน `apps/web/src/common/api/api-error-message.ts` ใน PR ที่โยนรหัสนั้น (coverage spec บังคับ); ข้อความลูกค้าตาม glossary: “ยังไม่มีแพ็กเกจ”, “หมดอายุ”, “ถูกพักใช้งานโดยผู้ดูแล”, “เลือกแพ็กเกจ”, “เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจ”, “ทีมงาน”, “อีเมลรับเอกสาร”; LINE persona ลงท้าย “ค่ะ/นะคะ”; ไม่มีรหัส/อังกฤษในข้อความลูกค้า
- Verify ขั้นต่ำต่อ PR (คำสั่ง Owner 2026-09-21): typecheck ด้วย script ของ package (api มี heap flag), `test:boot`, spec ที่แตะ, `node scripts/run-line-ai-whole-chain-acceptance.mjs` เมื่อแตะ LINE-AI/billing ที่อยู่ใน catalog; PG/smoke/e2e ผ่าน Extended Tests (workflow_dispatch) แล้วบันทึก run id
- ทุก PR อัปเดต memory ของงาน (`docs/agent-memory/chat-credit-addons-implementation.md` ที่ PR แรกสร้าง) ตาม template ใน AGENTS

## 1. ลำดับงานและ dependency (T-07)

| ขั้น | งาน | ขึ้นกับ | จบเมื่อ |
| --- | --- | --- | --- |
| 0 | **งานแก้ purchase flow ที่กำลังทำ** (batch 1A/1B/2L/2W และ follow-up: หน้ากลับจากการชำระ, การปลดล็อก WorkspaceLayout, ลิงก์ lookup ของผู้ดูแล, sync ข้อมูลบริษัทไป Stripe, คำศัพท์ glossary รวม “80 credit / เดือน”) | — | merge develop + main; ตรวจ anchor ของแผนนี้ใหม่บน develop ใหม่ |
| 1 | **PR A — shared billing foundation** (prerequisite ร่วมของ add-on และส่วนลดจากงานอีเวนต์) | ขั้น 0 | merge + ขึ้น UAT และ Production ด้วย release ปกติ (ก่อนเผยแพร่ policy ที่มี `addOnPriceIds`) |
| 2a | PR B — ledger รูป + grant seam + admin grant (รูป) | PR A | merge |
| 2b | PR C — รอบเครดิต AI + ledger เครดิต AI + funding ของ LINE v2 SHARED + admin grant (เครดิต AI) | PR A (ทำคู่ขนานกับ B ได้; ใช้ seam ของ B เมื่อ B merge ก่อน ไม่งั้น C สร้าง seam แล้ว B rebase) | merge |
| 3 | PR D — lane AI v1 + parent authority | PR C | merge |
| 4 | PR E — ซื้อ: quote/checkout/reconcile/apply/คืนเงิน/แจ้งเตือน/API อ่านยอด | PR A, B (ส่วนเครดิต AI ของ apply ใช้ seam ของ PR C; ถ้า C ยังไม่ merge ให้ quote ของ offer เครดิต AI ตอบ `BILLING_ADDON_NOT_READY` จึงเปิดขายรูปก่อนได้) | merge |
| 5 | PR F — UI เว็บ/LINE/คอนโซล และข้อความ | PR E (contract), ขั้น 0 (BillingPage/glossary) | merge |
| 6 | PR G — readback cohort, เครื่องมือย้าย, ประกาศลูกค้า | PR B, C (+ D ก่อนย้ายร้านที่ใช้ CRM/draft) | merge |
| 7 | UAT (§5) → Production (§6) ตาม protocol | ทั้งหมดที่เกี่ยวกับสินค้าที่จะเปิด | signed result + customer `OPEN` |

- **ส่วนลดจากงานอีเวนต์** เริ่มได้หลัง PR A (แผนส่วนลดต้องระบุ PR A เป็น prerequisite ร่วม). PR ที่แก้ไฟล์ร่วมต้องต่อคิวทีละ PR ไม่ทำพร้อมกัน: `billing.service.ts` (quote/checkout/status), `paid-checkout-invoice.ts`, `billing-refund-source.ts`, `billing-reconciler.service.ts`, `packages/contracts/src/billing.ts`, `schema.prisma`, `BillingPage.tsx`, `auth.guard.ts` (sync pins ทุกครั้ง). ข้อตกลง: validator ของ add-on อยู่ไฟล์ใหม่ (`paid-addon-invoice.ts`) จึงไม่ชนกับการผ่อน validator แพ็กเกจของงานส่วนลด; การล็อกการเลือกส่วนลดดูเฉพาะ attempt ที่ `productKind = PACKAGE`
- เปิดขาย **รูป** ได้เมื่อ A, B, E, F (ส่วนรูป), G (cohort รูปพร้อม) ผ่าน UAT; เปิดขาย **เครดิต AI** ได้เมื่อ A, C, D, E, F, G ผ่าน UAT และ lane CHAT ทุกทางของร้านนั้นมี funding
- ปล่อยทีละฟีเจอร์ต่อ release; gate ของแต่ละสินค้าปิดเป็นค่าเริ่มต้น

## 2. PR briefs

ชื่อไฟล์เทสต์ใหม่เป็นชื่อคาดการณ์; ผู้ implement ใช้ชื่อจริงได้แต่ต้องลงทะเบียนตาม §3.1

### PR A — Shared billing foundation (prerequisite ร่วม) — F-01, F-09, F-13, F-22, F-35

| งาน | ไฟล์ (develop 8a91bc1c) | สิ่งที่ทำ |
| --- | --- | --- |
| A1 schema | `apps/api/prisma/schema.prisma` (`BillingAccount` `:9797-9844`, `BillingAttempt` `:9897-9924`, `BillingInvoice` `:9926-9957`) + migration `<ts>_billing_product_foundation` | `BillingInvoice.productKind String @default("PACKAGE")` + `@@index([billingAccountId, productKind, periodEnd])`; `BillingAttempt.productKind String @default("PACKAGE")`; `BillingAccount.activeAddOnAttemptId String? @unique`. ไม่มี enum; SQL เป็น `ADD COLUMN … DEFAULT` / `CREATE INDEX` เท่านั้น (ผ่าน guard `production-a5-evidence.logic.ts:592-612`) |
| A2 contracts | `packages/contracts/src/billing.ts` (`BILLING_ACTIONS` `:39`, `BillingPolicy` `:83-107`, `BillingQuote` `:121-144`, `BillingStatus` `:153-201`) | `BillingProductKind`, `BILLING_ADDON_OFFER_KEYS` (หกค่า) + ค่าคงที่ราคา/จำนวน (§4 ของสเปก), `BillingAddOnOffer`, `BillingAddOnQuote` (discriminant `productKind`), `BillingQuote.productKind?: 'PACKAGE'`, `BillingPolicy.addOnPriceIds?`, `BillingStatus.addOns?` (type เท่านั้น ค่าเติมใน PR E), เพิ่ม `addon_chat_credit`, `addon_receipt_image` ใน `BILLING_ACTIONS`. ชื่อ `as const` array ต้องไม่ชนชื่อ Prisma enum (`packages/contracts/src/prisma-enum-parity.spec.ts`) |
| A3 policy parser ผ่อนปรน | `apps/api/src/modules/billing/domain/billing-policy.ts:29-78`; ตัวแก้ config `billing-configuration.service.ts:30,92,106-109,197,225,442` | รับ `addOnPriceIds` (key หกค่า, `price_…`), price id ไม่ซ้ำข้าม `priceIds` ∪ `zeroPriceIds` ∪ `addOnPriceIds`; editor ของ policy รับ key ใหม่; gates ใหม่ผ่าน `effectiveBillingGates` (`:15-18`) ปิดเป็นค่าเริ่มต้น |
| A4 reader ของแพ็กเกจกรอง PACKAGE | `billing.service.ts:805`, `billing-admin.service.ts:91`, `billing-notifications.service.ts:376-377,420-421` (สี่จุดเดียวที่เรียง `periodEnd desc` ใน API) | เพิ่ม `productKind: 'PACKAGE'` ใน where; ตรวจ reader ของ attempt: `billing.service.ts:798`, `billing-admin.service.ts:92-102`, `billing-checkout-expiry.service.ts:58-105` ยังอ่านเฉพาะ `activeAttemptId` |
| A5 decoder ของ snapshot | `billing.service.ts` (type `BillingSnapshot`), `billing-reconciler.service.ts:236-243,419,453` | helper `snapshotProductKind(snapshot)` (ไม่มี field = PACKAGE); จุด dispatch ของ reconciler ปฏิเสธ snapshot add-on ด้วย error ชัดเจนจนกว่า PR E (กันไม่ให้ตกเข้า `reconcileOneTime`) |

- เทสต์: `packages/contracts/src/billing-addon.spec.ts` (ค่าคงที่หก offer, decoder, `BILLING_ACTIONS`) → `ci.yml:543`; `apps/api/src/modules/billing/domain/billing-policy-addon.spec.ts` (parser เก่า/ใหม่, ความไม่ซ้ำ, policy ที่ไม่มี key) → catalog; `apps/api/src/modules/billing/billing-product-foundation.pg.spec.ts` (ค่าเริ่มต้นของคอลัมน์, reader สี่จุดไม่เห็นใบ add-on ที่ `periodEnd` ใหม่กว่า, unique ของ slot) → `ci.yml` ต่อจาก `:782`
- จบเมื่อ: typecheck/boot/เทสต์ผ่าน; `git diff` ไม่แตะ behavior ของแพ็กเกจ; ขึ้น UAT และ Production แล้วก่อนขั้นเผยแพร่ policy (F-09 จังหวะ 1)
- ประมาณการ: 4–6 วันทำงาน

### PR B — Ledger รูป, grant seam ร่วม, admin grant ของรูป — F-16, F-17 (รูป), F-19 (LINE), F-21, C03–C06

| งาน | ไฟล์ | สิ่งที่ทำ |
| --- | --- | --- |
| B1 ตัวจัดสรรตามกลุ่ม | `billing/application/billing-receipt-grants.ts:8-22` | แทน FEFO รวมด้วย กลุ่มแพ็กเกจ (INITIAL/RENEWAL/REPEAT/UPGRADE/TRIAL_CARRYOVER) → ทีมงาน (ADMIN_ADJUSTMENT/ADD_ON_ADMIN) → ซื้อ (ADD_ON_PAID) แล้ว FEFO; เพิ่ม `packageReceiptBalance` สำหรับ flow แพ็กเกจ และเปลี่ยนผู้เรียก `billing.service.ts:495`, `billing-reconciler.service.ts:600`; คงผู้เรียก OCR (`company-ocr-governance.ts:96,101,298,306`) ให้ใช้ตัวจัดสรรใหม่ |
| B2 entry ของรูป | schema + migration `<ts>_receipt_unit_entries`; `line-ai/application/company-ocr-governance.ts:187-356,421-489` | ตาราง entry (logical operation คงที่, generation, lot, RESERVE/CONSUME/RELEASE/REVOKE unique); admission เขียน RESERVE, ผล OCR ที่ใช้ได้เขียน CONSUME, `releaseCompanyOcrAdmission` เขียน RELEASE; projection แยก reserved/consumed; resume เปลี่ยน id event (`:259-260`) ไม่ทำให้ entry หาย. กติกา D4/Q4 ใช้เฉพาะร้านที่ย้ายแล้ว |
| B3 จุดบันทึกผลใช้ได้ | web `expenses/infrastructure/receipt-ocr.client.ts:295-400`, LINE `line-ai/infrastructure/ai-gateway.client.ts:353-410,486-510`, capture `expenses/application/services/expense-capture-read-runner.service.ts:446-463,610-630` | ส่ง logical operation + คุณสมบัติไฟล์ (หน้าเดียว/หลายหน้า) ที่ server ตัดสินเข้า admission; บันทึก CONSUME เมื่อผลใช้งานได้ durable (รวม NEEDS_REVIEW); lot ADD_ON เลือกได้เฉพาะหน้าเดียว |
| B4 grant seam | ไฟล์ใหม่ `billing/application/billing-addon-grants.ts` | `applyAddOnGrant(tx, {...})` (สเปก §16 ข้อ 1) ฝั่งรูป: insert `BillingReceiptGrant` kind `ADD_ON_PAID`/`ADD_ON_ADMIN`, expiry `appendPackageInterval(at, 'year')`; ถือ L1 → L4; ไม่เรียก `grantPaidPackageReceipts` และไม่เขียน `CompanyPlanTerm` |
| B5 admin grant (รูป) | ไฟล์ใหม่ `billing/application/billing-addon-admin-grants.service.ts`; route ใน `billing/presentation/billing.controller.ts` (บล็อก `system/billing` `:74-`); DTO ใน `billing.dto.ts`; ลงทะเบียน provider ใน `billing.module.ts` | operation `ADDON_ADMIN_GRANT`/`ADDON_ADMIN_REVOKE` แบบ reviewed (preview → submit → approve, `canApproveBillingChange` `billing-approval.ts:7-10`); สิทธิ์ `override.manage`/`approval.approve`/`financial.read`; source hash ไม่รวม slot (C04); expiry คำนวณ ไม่รับจาก request (C03); ใช้ได้กับร้านที่ย้ายแล้ว |
| B6 การ์ดรูปหมดต่อรุ่นของยอด | `company-ocr-governance.ts:145-178`; `process-line-webhook.use-case.ts:10649-10687` | key ของ claim = `<monthKey>#<generation>` โดย generation = รุ่นของยอดรูปเพิ่มเติม (เช่น เวลา lot ล่าสุด); ไม่เขียน `CompanyPlanTerm` ตอนเพิ่มยอด |

- เทสต์: `billing/application/billing-receipt-allocator.spec.ts` (ลำดับกลุ่ม, FEFO, trial carryover, legacy base) → catalog; `billing/application/billing-addon-admin-grants.spec.ts` → catalog; `billing/receipt-addon-ledger.pg.spec.ts` (reserve/consume/release, สองเดือนแย่ง lot เดียว, generation เก่าไม่ปล่อยงานใหม่, resume) → `extended-tests.yml` step billing PG (`:286`); ขยาย `process-line-webhook.use-case.spec.ts` (อยู่ใน catalog แล้ว) สำหรับการ์ดตามรุ่น
- W00: `process-line-webhook.use-case.ts` ถูก hash → regenerate manifest (§3.5)
- ประมาณการ: 7–9 วันทำงาน

### PR C — รอบเครดิต AI, ledger เครดิต AI, funding ของ LINE v2 SHARED, admin grant เครดิต AI — T-01, T-04, O-01, F-05, F-06, F-18

| งาน | ไฟล์ | สิ่งที่ทำ |
| --- | --- | --- |
| C1 schema | migration `<ts>_ai_credit_ledger` | `AiCreditGrant`, `AiCreditEntry` (สเปก §8.2), `CompanyAiConfiguration.aiCreditCutoverAt DateTime?` + `aiCreditCutoverSource String?` (`schema.prisma:3951-`) |
| C2 ตัวคำนวณรอบ | ไฟล์ใหม่ `line-ai/application/ai-credit-cycles.ts` | จากใบ PACKAGE ที่ APPLIED + `billingAnchorDay` ใช้ `appendPackageInterval(periodStart, 'month', anchorDay, k)` (`billing/domain/billing-package.ts:23-34`) ตามสเปก §5.1; `RENEWAL_PENDING` จาก `graceEndsAt` + ใบต่ออายุที่เปิด (ตรวจแบบ `billing-reconciler.service.ts:1190-1206`); ปิดรอบเมื่อแพ็กเกจสิ้นสุด (`billing-end-package.ts:58-66`, grace หมด, term หมด); allowance จาก `resolveAiBudgetPolicy` (`company-ai-budget-policy.ts:130-180`) + Q5 |
| C3 funding ใน v2 | `line-ai/application/company-ai-budget-reservation.ts:290-401` (reserve), `:436-499` (cancel), `:601-641` (operator release), `:681-766` (charge at bound), `:768-927` (settle); `line-ai/application/line-ai-budget-authority.service.ts:292-341` | ร้านที่ย้ายแล้ว: ข้าม `chatCapSatang` (`:338`) แล้วจัดสรร upper bound แพ็กเกจ→ทีมงาน→ซื้อ ภายใต้ L1 ที่ถืออยู่ (`:321`); เขียน RESERVE ผูก reservation; pin `fundingContext.cycleKey` ใน `budgetAuthorityJson` ตอน `authorizeAndClaim` (`:319-336`); settle/cancel/release/charge แปลง entry ของ lot เดิม (lock เดือนเดิม, unique key); ผลปฏิเสธเชิงพาณิชย์คืน `reason`/`budgetScope: 'CHAT'` เดิม + field ภายในบอกสาเหตุเชิงพาณิชย์ให้ API ใช้ประกอบข้อความ ไม่เพิ่มรหัสใน `AI_BUDGET_REFUSAL_CODES` |
| C4 intake รูปไม่ตัดเครดิต AI | `line-ai-budget-authority.service.ts:126-127,311` | profile `line-intake-image/2` ไม่จัดสรร funding ของเครดิต AI (bucket ต้นทุนคงเดิม); บันทึก N-1 ของ audit ให้เจ้าของ LINE AI ยืนยัน |
| C5 hold เก่า | `system-partner-management/application/use-cases/partner-ai-credit-holds.use-case.ts:84-90`; `listAiBudgetCreditHolds` `company-ai-budget-reservation.ts:1034-` | ค้น UNRESOLVED/hold ที่มี funding ทุกเดือน (แบ่งหน้า) ไม่ใช่แค่สองเดือน (C11) |
| C6 เพดาน TOTAL | `set-partner-ai-model.use-case.ts:122-133,249-265`, `set-platform-ai-budget.use-case.ts:55-82`; readiness | readiness ของการขายตามสเปก §5.3; ตัวตั้งเพดานเตือนเมื่อจะลดต่ำกว่ายอดเชิงพาณิชย์ที่ถืออยู่ (อ่านอย่างเดียวใต้ lock เดิม ไม่สลับลำดับ lock) |
| C7 grant seam + admin grant เครดิต AI | `billing-addon-grants.ts`, `billing-addon-admin-grants.service.ts` (จาก PR B) | ฝั่งเครดิต AI ของ seam และของ admin grant |

- เทสต์: `line-ai/application/ai-credit-cycles.spec.ts` (วัน 15/29/30/31, ปีอธิกสุรทิน, รายปี 12 รอบ, ดีล N เดือน, one-time ต่อช่วง, `RENEWAL_PENDING` จ่าย/ไม่จ่าย, เลือกแพ็กเกจใหม่) → catalog `api-behavior`; `line-ai/application/ai-credit-funding.pg.spec.ts` (v2 reserve/settle/cancel/release/charge พร้อม funding; SHARED และ SPLIT; สองเดือนแย่ง lot เดียว; turn ข้ามขอบรอบ; hold เก่ากว่าสองเดือน) → `LINE_AI_RELIABILITY_POSTGRES_SUITES` ใน catalog (`scripts/line-ai-whole-chain-acceptance.catalog.mjs:533-`) ที่ `extended-tests.yml:276` รันด้วย `--reliability-postgres`; ขยาย `company-ai-budget-reservation.spec.ts` (catalog `:475`) และ `line-ai-budget-authority.pg.spec.ts` (catalog `:536`)
- ไม่แตะ contract ของ Gateway/AgentCore (grant v2 ไม่เปลี่ยน); ถ้าเพิ่ม provider ใน `line-ai.module.ts` → regenerate W00
- ประมาณการ: 10–14 วันทำงาน

### PR D — Lane AI v1 และ parent authority — C08, C10, F-06 (v1), F-17

| งาน | ไฟล์ | สิ่งที่ทำ |
| --- | --- | --- |
| D1 parent month | `line-ai/presentation/http/internal-ai-budget.controller.ts:109-129` | select `monthKey` ของ parent (`:111-114`) แล้วปฏิเสธเมื่อ `body.monthKey` ไม่ตรง; ใช้ month/รอบ/funding ของ parent (`:122-123` เลิกใช้ body) |
| D2 durable CHAT ใน SHARED | `line-ai/application/company-ai-usage-meter.ts:364-530` (`assertCompanyAiBudget`/`runWithCompanyAiBudgetAdmission`), `company-ai-budget-reservation.ts:335-337` | ร้านที่ย้ายแล้ว: lane CHAT ของ v1 จองแบบ durable ด้วย bound ที่ประกาศ (`aiBudgetStepBounds`) พร้อม funding แทนการเทียบใต้ lease; ร้าน legacy คงเดิม |
| D3 ผู้เรียก | CRM `crm-inbox/infrastructure/crm-ai-gateway.client.ts:84-96,169-180`, draft `ai-draft/application/use-cases/generate-suggestion.use-case.ts:130-155` | ส่ง attempt/step ที่ต้องใช้กับ D2; ตรวจว่า lane OCR (`receipt-ocr.client.ts:295-334`, `expense-capture-read.client.ts:158-171`, `statement-ai-extract.client.ts:54-66`) ไม่ใช้ funding ของเครดิต AI |

- เทสต์: ขยาย `internal-ai-budget.controller.spec.ts` (มีแล้ว, catalog `:476`) สำหรับ month mismatch และการสืบ month/รอบจาก parent; `company-ai-usage-meter.spec.ts` (มีแล้ว, อยู่ใน `apps/api/package.json` script `test` และ `extended-tests.yml:167`) สำหรับ durable CHAT ของร้านที่ย้าย; PG เพิ่มใน `ai-credit-funding.pg.spec.ts`
- W00: `internal-ai-budget.controller.ts` ถูก hash → regenerate
- ประมาณการ: 5–7 วันทำงาน

### PR E — ซื้อ: quote, checkout, reconcile, apply, คืนเงิน, แจ้งเตือน, API อ่านยอด — T-02, T-03, O-03, F-01, F-04, F-11, F-14, F-22, F-28, F-30, F-35

| งาน | ไฟล์ | สิ่งที่ทำ |
| --- | --- | --- |
| E1 quote | `billing/application/billing.service.ts:290-524`; `billing/presentation/billing.dto.ts:90-100`; `billing.controller.ts:590-604` | `purchaseIntent: 'ADD_ON'` + `addOnOfferKey` (DTO `@IsIn`), branch ทันทีหลัง `assertOwner` (`:291`) ไป `quoteAddOn()` ใหม่; guard ที่คง/ข้ามตามสเปก §9.2; ตรวจเงื่อนไขซื้อ §8.4 รวม Q1; อ่าน Price จริงและตรวจ one-time/THB/amount/tax behavior/product; เขียน `BillingQuote` พร้อม snapshot `{ productKind, addOn: { offerKey, quantityUnits, unitScale, priceId, productId, validityMonths } }` |
| E2 checkout | `billing.service.ts:526-774` | branch ใน transaction ตาม `snapshot.addOn` ก่อน `:549`; จอง `activeAddOnAttemptId` แบบ compare-and-set; สร้าง attempt `productKind`; session `mode: 'payment'`, `line_items: [{ price, quantity: 1 }]`, `invoice_creation`, `billing_address_collection: 'required'`, `customer_update` ตาม R-A3 (`:701,:740-741`), metadata มี `productKind`; ข้าม `:586` และ `:716-718`; barrier ก่อนเรียก Stripe (`:665-694`) ตรวจ slot add-on แทน; error path ปล่อยเฉพาะ slot add-on (`:761-772` รูปแบบเดียวกัน) |
| E3 validator | ไฟล์ใหม่ `billing/domain/paid-addon-invoice.ts` (อิงรูปแบบ `paid-checkout-invoice.ts:12-67`) | `paidAddOnCheckoutEvidence`: account/livemode/customer/attempt, Price id + product ตรง snapshot, quantity 1, ยอด/ภาษีตรง quote, ส่วนลดเป็นศูนย์ทุกระดับ (session/invoice/line), `paidAt` จาก `status_transitions.paid_at` |
| E4 reconcile | `billing/application/billing-reconciler.service.ts:189-376` (step ใหม่หลัง `:208` ก่อน `:209`), `:378-439` (import), `:441-472` (original invoice) | `reconcileAddOnAttempt(account, lease)`: session หมดเวลาไม่จ่าย → ล้าง slot; จ่ายแล้ว → เขียนใบ `productKind` (`periodStart = periodEnd = paidAt`) + ล้าง slot ใน transaction เดียว แล้ว apply; error → issue แล้วทำ logic แพ็กเกจต่อ (ห้าม `return`); import/original invoice แยก branch add-on ที่ไม่อิง slot |
| E5 apply | ไฟล์ใหม่ `billing/application/billing-addon-apply.ts` | `applyAddOnInvoice`: L1 → L4; recheck บริษัท/ผู้ซื้อ/แพ็กเกจ; เรียก grant seam; audit `billing.addon.applied`; outbox `billing:addon-applied:{invoiceId}`; `recordRecipientCapture` (`billing-recipient-capture.ts:43`) ด้วย capture ที่อ่านก่อน transaction (`readRecipientCapture` `:28`); ไม่แตะ field ใดใน invariant ของสเปก §9.2; hold → `applyStatus: 'HELD'` + issue `PAID_HELD` |
| E6 expiry/cancel | `billing-checkout-expiry.service.ts:20,58-105`; `billing-checkout-expiry-source.ts:9-27` | binding/โหมด session รู้ `productKind`; ตรวจ slot ตามชนิด attempt |
| E7 คืนเงิน/ข้อโต้แย้ง | `billing-refunds.service.ts:28,78,86-137,247-251`; `billing-refund-source.ts:51-158`; `billing-financial.ts:17-31` | preview/source hash รวม version ของ lot และหน่วยที่คืนได้; freeze (L1) ก่อนเรียก provider; สำเร็จ → REVOKE; ล้มเหลว → unfreeze; คืนจาก dashboard/ข้อโต้แย้ง → freeze + issue; ใบลดหนี้ของ add-on ต้องไม่มีส่วนลด |
| E8 แจ้งเตือน | `billing-notifications.service.ts:235-290`; `auth/infrastructure/auth-email.templates.ts:46-51` | หัวข้อ/เนื้อความตามชนิดใบ บน trigger `billing.package_updated` เดิม ไม่มีตัวเลข; renderer อีเมลใหม่ `renderBillingAddOnEmail`; ผู้รับ `planManagers` |
| E9 API อ่านยอด | `billing.service.ts:782-944` (status), route ใหม่ `GET companies/:companyId/billing/credits/history` ใน `billing.controller.ts:521-`; `auth/presentation/auth.guard.ts:98-104` | เติม `BillingStatus.addOns` (quotaSummary + pending attempt ของ add-on) และประวัติการใช้ยอด (plan manager, cursor); เพิ่ม GET exact ใน `isBillingRecoveryRoute` + sync pins (§3.2) — ประสานกับงานส่วนลดที่แก้ allowlist เดียวกัน |
| E10 ข้อความ error | `apps/web/src/common/api/api-error-message.ts` | ไทยของ `BILLING_ADDON_*` ห้ามมี “ผู้ดูแล” ในความหมายของผู้ดูแลร้าน (T-05) |

- เทสต์: `billing/application/billing-addon-quote.spec.ts` (branch/guard/สิทธิ์ custom role/Q1/เงื่อนไข §8.4) → catalog; `billing/domain/paid-addon-invoice.spec.ts` (ส่วนลดทุกระดับถูกปฏิเสธ, Price/product/quantity/ภาษี) → catalog; **`billing/billing-addon-apply.pg.spec.ts`** (invariant ของสเปก §9.2 สำหรับ CARD_AUTO, PROMPTPAY_RENEW, CARD_ONCE, advance deal; add-on OPEN/HELD/UNKNOWN + ต่ออายุ apply + grace + portal cancel + เปลี่ยนอีเมลรับเอกสาร + คืนเงินแพ็กเกจ + ซื้อแพ็กเกจใหม่; event ซ้ำ; คืนเงิน add-on) → **`ci.yml` ต่อจาก `:782`** (release gate เพราะปิด BLOCK F-01); smoke `BILLING_ADDON_ONLY=1` ใน `apps/api/src/scripts/billing-http-smoke.ts` (บล็อก selector แบบ `:210-258`) → step ใน `extended-tests.yml` (หลัง `:292`); ขยาย `auth.guard.spec.ts` (allow/deny ของร้านที่หมดอายุ) และเพิ่ม `billing-notifications-addon.spec.ts` (หัวข้อ/เนื้อความตามชนิดใบ ไม่มีตัวเลข) → catalog ถัดจาก `billing-notifications-recipient.spec.ts` (`:449`)
- ประมาณการ: 9–12 วันทำงาน

### PR F — UI เว็บ/LINE/คอนโซล และข้อความ — T-06, T-08, O-02, F-07, F-08, F-11, F-12, F-19, F-20, F-26, F-31, F-33, F-34, U07

| งาน | ไฟล์ | สิ่งที่ทำ |
| --- | --- | --- |
| F1 แท็บและส่วนซื้อ | `apps/web/src/features/billing/BillingPage.tsx` (`section` `:48`, แท็บ `:333-336`, overview `:337-`), `billing.api.ts`, `billing-display.ts`, `billing-error-text.ts` | แท็บ “เครดิต AI และอ่านรูป” (แสดงเมื่อมี `status.addOns`), บัตรยอดสองใบ, ส่วนซื้อสองส่วน, หน้าตรวจ/ยืนยัน, deep link `?section=addons&product=chat|image`, สรุปบนการ์ดแพ็กเกจ; 390 px ไม่มี horizontal scroll |
| F2 หน้ากลับ | `BillingPage.tsx` (`returning`, `:272` `notifyPlanTermChanged`) และหน้า `app/(workspace)/companies/[companyId]/billing/return/page.tsx` | attempt ของ add-on ไม่เรียก `notifyPlanTermChanged`; สถานะตามสเปก §7; rebase หลังงานแก้หน้ากลับของขั้น 0 |
| F3 ประวัติการใช้ยอด | component ใหม่ในแท็บ add-on | หนึ่งรายการต่อ logical operation, cursor, ไม่มี reserve/release |
| F4 LINE | `line-ai/domain/logic/line-business-card.logic.ts:490-534,615-639`, `line-ai-formatter.logic.ts:55-70`, `line-non-receipt-reply.logic.ts:143`, `process-line-webhook.use-case.ts:2498-2510,10649-10687`, `line-ai/application/use-cases/drain-line-ledger.use-case.ts:89,430,465` | copy ตามสเปก §17.4 สำหรับร้านที่ย้าย (ร้าน legacy คงข้อความเดิม); surface `addon_exhausted` mint ในเลน ห้าม mint ในกลุ่ม; staff ไม่มีปุ่ม; ขีดจำกัดของร้านใช้ postback `action=package-callback` (`line-staff-menu.logic.ts:19-20`); template version สำหรับข้อความในคิว (U07) |
| F5 หน้าอัปโหลด | `apps/web/src/features/expenses/expense-upload.logic.ts:198-218`, `ExpensesPages.tsx:303-309,517-530` | ล้าง latch เมื่อกลับเข้าหน้า/โฟกัส หรือเมื่อ status บอกยอดเปลี่ยน; ปุ่ม “ซื้อจำนวนอ่านรูปเพิ่ม” (plan manager) / “แจ้งเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจ” (พนักงาน) |
| F6 คอนโซลผู้ดูแล | หน้าใหม่ใต้ `apps/web/src/features/billing-admin/` (อิง `BillingReceiptAdjustmentsPage.tsx`), `apps/web/src/features/system-partners/PartnerDetailPage.tsx:1936-2224`, `PlatformAiBudgetPage.tsx:46-134` | หน้า “เพิ่มยอดให้ลูกค้า” (เลือกสินค้า จำนวน เหตุผล อายุแบบอ่านอย่างเดียว preview → อนุมัติ); เปลี่ยนป้ายเพดานเป็น “เพดานเครดิต AI ต่อเดือน (บาท)”/“เพดานเครดิต AI เริ่มต้นต่อเดือน (บาท)” และเลิกข้อความ “…จนกว่าจะเพิ่มเครดิตหรือขึ้นเดือนใหม่” (`PartnerDetailPage.tsx:1940`) |
| F7 ข้อความเซลล์และแพ็กเกจ | `apps/web/src/features/sales-console/SalesDealFormPage.tsx:449`, `SalesConsoleParts.tsx:93`, `apps/api/src/modules/sales-console/application/sales-deals.service.ts:645`, `BillingPage.tsx:469,520` | “เครดิตแชตต่อเดือน (credit)” → “เครดิต AI ต่อรอบเดือนของแพ็กเกจ” และหน่วย “เครดิต” (F-33) — ประสานกับงานแก้ “80 credit / เดือน” ของขั้น 0 |
| F8 error ของเว็บ | `apps/web/src/common/api/api-error-message.ts:965-968` | ร้านที่ย้าย: ข้อความตามสาเหตุ (ยอดหมด/ขีดจำกัดของร้าน “ติดต่อทีมงาน”) ไม่ใช่ “ให้ผู้ดูแลปรับแพ็กเกจ” |

- เทสต์: web specs ของ `BillingPage` (แท็บ, สถานะ, สิทธิ์, deep link) — glob ของ web รันเอง; `e2e/billing-addons.spec.ts` (ซื้อ → กลับ → ยอด, 390 px) → step ใหม่ใน `extended-tests.yml` แบบ `:320-336` (DB ของตัวเอง, พอร์ตไม่ชน); ขยาย `process-line-webhook.use-case.spec.ts`, `line-business-card` spec, `drain-line-ledger.use-case.spec.ts`; `api-error-coverage.spec.ts` (ไม่มี “งบ AI”/“โควตา AI”, ไม่มีข้อความขีดจำกัดที่ชี้ “ผู้ดูแล”)
- W00: `process-line-webhook.use-case.ts` → regenerate
- ประมาณการ: 9–12 วันทำงาน

### PR G — Readback cohort, เครื่องมือย้าย, ประกาศลูกค้า — D9, F-23, F-25

| งาน | ไฟล์ | สิ่งที่ทำ |
| --- | --- | --- |
| G1 รายงาน cohort (อ่านอย่างเดียว) | script ใหม่ `apps/api/src/scripts/ai-credit-cohort-report.ts` | นับร้านตามกลุ่มของสเปก §11.2 และร้าน legacy ของรูป; ไม่มี PII; รันบน UAT/Production ตาม runbook เท่านั้น |
| G2 คำสั่งย้าย | operation หรือ script ใหม่ (reviewed) | ต่อบริษัท: ตรวจช่วงที่ชำระ, ตั้ง `aiCreditCutoverAt` ที่ขอบรอบถัดไป (D9), ที่ขอบรอบปิดยอดจากแพ็กเกจเดิมและเปิดรอบแรก, idempotent, audit, dual reader |
| G3 หลักฐานการย้าย | อ่านอย่างเดียว | ก่อน/หลัง: grant/คงเหลือ/hold, ต้นทุนช่วงรอยต่อ, รอบแรก |
| G4 ประกาศลูกค้า | ข้อความ Owner อนุมัติ | แจ้งล่วงหน้าก่อนวันย้าย ไม่มีตัวเลขใน LINE |

- เทสต์: `line-ai/application/ai-credit-cutover.pg.spec.ts` (ก่อน/หลังต้นเดือน, ขอบรอบตรงต้นเดือนออกครั้งเดียว, ไม่มี calendar grant หลังย้าย, idempotent) → `LINE_AI_RELIABILITY_POSTGRES_SUITES` (catalog `:533-`); สคริปต์รายงานมี unit spec ของตัวจัดกลุ่ม → catalog
- ประมาณการ: 4–6 วันทำงาน

## 3. งานข้ามทุก PR (ตามแบบ `purchase-without-setup/xx-cross-cutting.md`) — T-09, F-10

### 3.1 ลงทะเบียนเทสต์ — ห้ามแตะ `package.json`

- `apps/api/src/spec-suite-coverage.spec.ts:43-75` บังคับให้ทุก `apps/api/src/**/*.spec.ts` ถูกอ้างชื่อใน script ของ `apps/api/package.json`, `scripts/line-ai-whole-chain-acceptance.catalog.mjs`, `.github/workflows/ci.yml` หรือ `.github/workflows/extended-tests.yml` (ยกเว้น `*.pg.spec.ts` ที่ต้องมี invocation ของตัวเองจึงจะรัน)
- Unit spec ของ API → suite `api-behavior` ของ catalog (`:413-`), ต่อจากบล็อกของ purchase-without-setup (`:443-453`) พร้อม comment บอกงาน; runner ของ job “LINE AI whole-chain acceptance” (`ci.yml:554`) รันให้
- Spec ของ contracts → รายการตายตัวที่ `ci.yml:543`
- PG ที่เป็น release gate (invariant ของ F-01/T-02: `billing-product-foundation.pg.spec.ts`, `billing-addon-apply.pg.spec.ts`) → step “Test Step 0 company tax identity against PostgreSQL” ต่อจาก `ci.yml:782` (DB `watchdog_step0_ci` ที่ `migrate deploy` จากศูนย์ `:773`); PG อื่นของ billing → step billing PG ของ `extended-tests.yml:277-292`; PG ของ AI → `LINE_AI_RELIABILITY_POSTGRES_SUITES` (catalog `:533-`, รันที่ `extended-tests.yml:276`). Spec ต้อง `skip` เมื่อ env ของ DB ว่าง
- Smoke → selector `BILLING_ADDON_ONLY=1` ใน `billing-http-smoke.ts` + บรรทัดใน `extended-tests.yml` หลัง `:292`; e2e → step ใหม่ใน `extended-tests.yml` คัดโครง `:320-336` (DB/พอร์ต/`NEXT_DIST_DIR` ของตัวเอง, 390 px ด้วย `setViewportSize`)
- Web spec ของ `apps/web` รันด้วย glob ไม่ต้องลงทะเบียน
- CI ตอน merge ให้แค่ unit/typecheck/boot/PG ที่อยู่ใน `ci.yml`; PG อื่น/smoke/e2e มาจาก Extended Tests (workflow_dispatch) ท้าย PR B, C, E, F และก่อน UAT — บันทึก run id ใน memory

### 3.2 Pins ของ `auth.guard.ts`

PR E แก้ `isBillingRecoveryRoute` (`auth.guard.ts:98-104`) ซึ่งถูก pin ใน `infra/security/validate-production-maintenance-release.sh:25` (`expected_auth_guard`) และตรวจที่ `:106`. ใน PR เดียวกัน:

```bash
node infra/security/sync-production-maintenance-release-pins.mjs
node infra/security/sync-production-maintenance-release-pins.mjs --check
bash infra/security/validate-production-maintenance-release.spec.sh
bash infra/security/sync-production-maintenance-release-pins.spec.sh
git add infra/security/validate-production-maintenance-release.sh .github/workflows/deploy-production.yml   # stage explicit paths เท่านั้น
```

งานส่วนลดแก้ allowlist เดียวกัน (route ส่วนลดของร้านที่ล็อก): PR ที่ merge ทีหลังต้อง rebase แล้ว sync pins ใหม่ ห้าม merge สอง PR ที่ sync pins จากฐานเดียวกัน

### 3.3 `ci.yml`/`extended-tests.yml` ต้อง byte-identical กับ main

ตอนนี้ develop `69fba9d3` กับ main `bcb55734` ตรงกันทั้งสองไฟล์ (ตรวจ `git diff origin/develop origin/main -- .github/workflows/ci.yml .github/workflows/extended-tests.yml` ว่าง). ทุก PR ที่แก้ workflow ต้อง twin ไป main ก่อน dispatch UAT `all` (`deploy-uat.yml` เทียบ blob ของ `ci.yml`; runbook UAT/Production). ตรวจ: `git rev-parse <candidate>:.github/workflows/ci.yml` = `git rev-parse origin/main:.github/workflows/ci.yml` และแบบเดียวกันกับ `extended-tests.yml`

### 3.4 Migrations

- ที่ `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<snake>/migration.sql`; timestamp ต้องเรียงหลัง migration ล่าสุดบน develop ตอนเริ่ม PR (controller แจ้งว่าล่าสุดตอนนี้คือ `20260929030000`; develop `69fba9d3` ที่ตรวจได้จบที่ `20260928210000_line_support_request_reference`). ถ้า develop มี migration ใหม่กว่าก่อน merge ให้ขยับ timestamp (คงชื่อท้าย) แล้วแก้ชื่อในแผนและ memory ใน PR เดียวกัน; งานส่วนลดใช้กติกาเดียวกัน จึงจอง slot ตามลำดับ merge ไม่จองล่วงหน้า
- ชื่อท้ายที่วางไว้: PR A `billing_product_foundation`; PR B `receipt_unit_entries`; PR C `ai_credit_ledger` (รวมคอลัมน์ cutover)
- Additive เท่านั้น (`ADD COLUMN … DEFAULT/NULL`, `CREATE TABLE`, `CREATE INDEX` ไม่ใช้ `CONCURRENTLY`); ไม่มี `DROP/TRUNCATE/DELETE` (guard `production-a5-evidence.logic.ts:592-612`); ไม่มี Prisma enum (`prisma-enum-parity.spec.ts`)
- CI: `prisma:validate` → `migration:review` → fresh `migrate deploy` (`ci.yml:773`) → PG specs → `test:boot` (`:785`); PG spec ของแต่ละ PR ต้องเขียน/อ่านทุกคอลัมน์ใหม่
- Release: migration ที่ค้างบน Production ทำให้ READY เดินทาง `APPEND_ONLY_PENDING` ตาม runbook; แก้ migration หลังออก passport = เริ่ม UAT ใหม่

### 3.5 Contracts, DI, boot, Release Contracts, W00

- ลำดับ: `pnpm --filter @watchdog-bms/contracts build` ก่อน typecheck/เทสต์ (web อ่าน contracts จาก `dist`) → `prisma generate` → typecheck ด้วย script ของ package
- Class `@Injectable()` ใหม่ (`BillingAddOnAdminGrantsService`, service apply/reconcile ของ add-on) ประกาศ constructor เอง (`apps/api/scripts/check-di-metadata.mjs` ที่ `ci.yml:468-470`) และอยู่ใน `providers` ของ `billing.module.ts`; boot ตรวจด้วย `test:boot`
- Body ใหม่ทุกตัวเป็น class DTO (`body-validation-coverage.spec.ts`)
- **W00**: manifest hash ไฟล์รวม `process-line-webhook.use-case.ts`, `internal-ai-budget.controller.ts`, `line-ai.module.ts`, `line-webhook.controller.ts`, `packages/config/src/index.ts` (`line-ai-capability-manifest.ts:35-48,597-603`). PR B/C/D/F ที่แตะไฟล์เหล่านี้ต้องรัน `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` แล้วรันซ้ำแบบไม่ตั้ง env ให้ผ่าน และ commit artifact ที่สร้างใหม่
- ห้ามแก้ `packages/contracts/src/line-ai.ts` (ถ้าจำเป็นจริงต้องวาง coordinated LINE AI release ตาม manifest) — แผนนี้ไม่ต้องแก้

### 3.6 Readbacks ก่อน UAT และก่อน Production

| รายการ | วิธีอ่าน | ค่าที่ต้องเป็น |
| --- | --- | --- |
| `salesCompanyIds` ของ policy ที่ ACTIVE | `GET /v1/system/billing/settings` (`billing.controller.ts:325`, `system.billing.read`) | `null` หรือมีร้านทดสอบ (สำหรับ UAT) |
| Gates | settings เดียวกัน | `addon_chat_credit`/`addon_receipt_image` = false จนถึงขั้นเปิดขายใน §5/§6 |
| Binary ที่อ่าน `addOnPriceIds` ได้ | SHA ที่ deploy บน UAT/Production (runbook) | มี PR A ก่อนเผยแพร่ policy ที่มี key นี้ (F-09) |
| Stripe Price หกตัว | Owner สร้างใน test mode (UAT) และ live mode (Production): one-time, THB, ยอดตาม §4 ของสเปก, tax behavior ตาม policy | ผูกใน `addOnPriceIds` ผ่าน PUBLISH_POLICY แบบ reviewed |
| LINE v2 พร้อม | `/internal/ai/line-reliability-capabilities` ตอบ ready (`ai-gateway.client.ts:158-169`), ค่า `LINE_AI_RELIABILITY_V2_MODE` ของ task (ค่าเริ่มต้น `on` `packages/config/src/index.ts:29`), AgentCore runtime ตาม runbook | ready; ถ้าไม่ ready ห้ามเปิดขายเครดิต AI |
| เพดาน TOTAL | `PlatformAiBudgetConfig` + override ของร้านทดสอบ | headroom ตามสเปก §5.3 |
| `RECEIPT_QUOTA_ENFORCED` | ค่า task (deploy ตั้ง true `infra/prod-ecs-express/deploy.sh:237-238,605`) | true |
| Cohort | `ai-credit-cohort-report` (PR G) | ตัวเลขต่อกลุ่มสำหรับ Q5 และรายชื่อร้านที่ย้ายได้ |
| Postmark UAT allowlist | secret ตาม runbook | อีเมลทดสอบอยู่ใน allowlist |

## 4. Migration, backfill และการย้าย (D9, §11 ของสเปก)

- [ ] ไม่ backfill เงินหรือ lot จากเพดานรายเดือน; `productKind` ของแถวเดิมได้ `PACKAGE` จากค่าเริ่มต้นของคอลัมน์ (ไม่มีสคริปต์ backfill)
- [ ] รายงาน cohort บน UAT แล้ว Production (อ่านอย่างเดียว ตาม runbook และประกาศก่อนใช้ session production)
- [ ] Owner ตอบ Q5 หรือยอมรับค่าเริ่มต้นก่อนย้ายร้านที่มี override
- [ ] ย้ายร้านทดสอบบน UAT ครบกลุ่ม: CARD_AUTO รายเดือน, PROMPTPAY_RENEW รายเดือน, CARD_ONCE รายปี, ดีลต่ออายุอัตโนมัติ, ดีลจ่ายครั้งเดียว, ร้านที่ขอบรอบตรงต้นเดือน
- [ ] หลักฐานรายบริษัท: ช่วงที่ชำระ, ยอด legacy ที่เหลือ, วันย้าย, รอบแรก, ต้นทุนช่วงรอยต่อ, grant/hold ก่อน/หลัง; ไม่มี PII
- [ ] ประกาศลูกค้า (ข้อความ Owner อนุมัติ) ก่อนวันย้ายของ Production
- [ ] ย้าย Production ทีละกลุ่มหลัง UAT ผ่าน และเปิด gate ต่อสินค้าหลังกลุ่มนั้นย้ายแล้ว

## 5. UAT (Stripe test mode) — ทำตามลำดับ บันทึกผลทุกข้อ

| # | ขั้น | ผ่านเมื่อ |
| --- | --- | --- |
| U1 | Readbacks §3.6; PR A–G อยู่ใน candidate เดียว; `ci.yml`/`extended-tests.yml` ตรง main | ครบทุกแถว |
| U2 | Owner สร้าง Price test mode หกตัว แล้วเผยแพร่ policy UAT ที่มี `addOnPriceIds` (หลัง binary UAT มี parser ใหม่) | catalog แสดง add-on หกชุด; ซื้อแพ็กเกจยังเปิดตามเดิม |
| U3 | ย้ายร้านทดสอบตาม §4 | รอบแรกตรงขอบช่วงที่ชำระ; ไม่มีเติมรายเดือนหลังย้าย |
| U4 | ร้าน CARD_AUTO ซื้อเครดิต AI 50 ด้วยบัตร | APPLIED ≤ 3 นาที; ยอดเพิ่มเติม +50; ประวัติมีรายการซื้อ; readback: subscription/`paidThrough`/`renewalMode`/`nextChargeAt`/เครดิตของดีล/referral ไม่เปลี่ยน; แจ้งเตือน LINE ไม่มีตัวเลข |
| U5 | ร้าน PROMPTPAY_RENEW ซื้อรูป 20 ด้วย QR | เหมือน U4 สำหรับรูป |
| U6 | เปิด checkout ของ add-on ค้างไว้ แล้วทำให้ถึงรอบต่ออายุของร้าน CARD_AUTO (test clock) | ต่ออายุ apply; ยกเลิกต่ออายุผ่าน portal ได้; เปลี่ยนอีเมลรับเอกสารได้; status ของแพ็กเกจไม่แสดง attempt ของ add-on |
| U7 | ร้าน PROMPTPAY_RENEW ถึงขอบรอบโดยยังไม่จ่าย QR | เครดิต AI รอบใหม่ใช้ได้ทันที; หน้าแสดง “กรุณาชำระค่าแพ็กเกจรอบใหม่ภายใน …”; ซื้อ add-on ตาม Q1; จ่ายแล้วไม่เติมซ้ำ; ไม่จ่ายจน grace หมด → รอบปิด ยอดเพิ่มเติมคงอยู่ |
| U8 | ใช้แชต LINE ส่วนตัวจนยอดจากแพ็กเกจหมด แล้วใช้ต่อ; ทดสอบแชตกลุ่มตาม Q3 | ตัดยอดเพิ่มเติมหลังยอดจากแพ็กเกจหมด; ยอดบนเว็บตรงกับการใช้ |
| U9 | ส่งรูปใบเสร็จ LINE/เว็บ, รูปที่ไม่ใช่ใบเสร็จ, PDF หลายหน้าเมื่อเหลือแต่ยอด ADD_ON | หนึ่งหน่วยต่อรูปที่อ่านได้; รูปผิดประเภทตาม D4/Q4; PDF ได้ข้อความ “ยอดเพิ่มเติมใช้ได้เฉพาะรูปใบเสร็จหนึ่งหน้า…” |
| U10 | ยอดหมด: ผู้มีสิทธิ์จัดการแพ็กเกจในแชตส่วนตัว / พนักงาน / ในกลุ่ม | ลิงก์แตะเดียวเปิดเบราว์เซอร์ภายนอกไปแท็บ add-on / ข้อความไม่มีปุ่ม / URL ธรรมดาไม่มี token |
| U11 | ตั้งเพดาน TOTAL ของร้านทดสอบให้ต่ำ | ข้อความ “ใช้งานนี้ถึงขีดจำกัดของร้านที่ทีมงานตั้งไว้ กรุณาติดต่อทีมงาน” + postback ติดต่อกลับ; ไม่มีปุ่มซื้อ; ซื้อใหม่ถูกปิด |
| U12 | คืนเงิน add-on ทั้งใบและบางส่วนในแอป; จำลองข้อโต้แย้ง | หน่วยถูก freeze แล้ว revoke/unfreeze ถูก; ไม่คืนเกิน; ประวัติแสดงคืนเงิน |
| U13 | ทีมงานเพิ่มยอดทั้งสองสินค้า (preview → อนุมัติ SINGLE_ADMIN) แล้ว revoke | ยอดเพิ่มเติมเปลี่ยน; ไม่มีช่องวันหมดอายุ; ไม่มีใบแจ้งหนี้; audit ครบ |
| U14 | หน้าอัปโหลดใบเสร็จหลังซื้อรูป | latch หายโดยไม่ต้อง reload; ปุ่มถูกต่อสิทธิ์ |
| U15 | มือถือ 390 px ทุกหน้าที่แตะ; ข้อความ LINE ที่ค้างในคิวก่อน deploy | สี่แท็บไม่มี horizontal scroll; drain ส่งข้อความเก่าได้ไม่ค้าง |
| U16 | Extended Tests run ids (PG/smoke/e2e) | บันทึกใน memory |

## 6. Production acceptance (ภายใน ~5 นาทีหลัง website-ready)

1. Owner ซื้อเครดิต AI 50 ด้วยบัตรจริงบนร้านที่จ่ายจริงแบบต่ออายุอัตโนมัติ → APPLIED, ยอด, ประวัติ, แจ้งเตือน LINE/อีเมลไม่มีตัวเลข
2. Owner ซื้อรูป 20 ด้วย PromptPay จริง → APPLIED
3. ใช้แชต LINE หลายข้อความและส่งรูปใบเสร็จหนึ่งรูป → ประวัติการใช้ตรง
4. Readback ของร้าน: subscription, วันต่ออายุ, `renewalMode`, เครดิตของดีล และ attribution ไม่เปลี่ยน; หน้าแพ็กเกจไม่แสดง attempt ของ add-on
5. คืนเงินในแอปหนึ่งรายการ add-on → หน่วยถูก revoke และเงินคืนตามยอด
6. บันทึกตาม runbook: UAT/READY/Production run ids, signed result, customer `OPEN` แล้วจึงรายงานว่าเปิดใช้จริง

## 7. แก้เอกสารที่เกี่ยวข้อง

| เอกสาร | สิ่งที่ต้องแก้ | เมื่อไร |
| --- | --- | --- |
| `docs/specs/ai-chat-credit-default-80-spec-th.md` | หมายเหตุหัวเอกสารแก้แล้วรอบนี้ (รอบตามช่วงที่ชำระ, O-01); เนื้อหา “ต่อเดือนปฏิทินไทย/ไม่มี top-up” ต้องระบุว่าใช้กับร้าน legacy | PR C |
| `docs/specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md` | หมายเหตุแก้แล้วรอบนี้; §3 เพิ่มแถว “เพดานเครดิต AI ต่อเดือน” (คอนโซล), วลีตามรอบของร้านที่ย้าย, คำตอบ Q6; §5.1/§5.2 ข้อความใหม่ | PR F |
| `docs/specs/mangmee-billing-pack-amendment-2026-09-12.md` | หมายเหตุแก้แล้วรอบนี้; ส่วน “ทางเลือกซื้อเฉพาะใบเสร็จ — HIDDEN” เปลี่ยนสถานะเป็น “แทนด้วยสินค้ารูปของ add-on” เมื่อเปิด gate | PR G / ตอนเปิดขาย |
| `docs/specs/mangmee-line-web-billing-ui-spec-th.md` | แท็บที่ 4 ตามสเปก §7.1 | PR F |
| `docs/specs/mangmee-billing-controls-spec-th.md` + สเปกผู้ดูแลคนเดียว | operation `ADDON_ADMIN_GRANT`/`ADDON_ADMIN_REVOKE`, gates ใหม่ | PR B / PR A |
| `docs/specs/line-ai-credit-hold-reconciliation-spec-th.md` | หมายเหตุแก้แล้วรอบนี้; เพิ่ม hold ที่มี funding และการค้นเกินสองเดือน | PR C |
| `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md` | เครดิต AI ของดีลเป็นต่อรอบเดือนของแพ็กเกจ | PR F |
| `docs/specs/mangmee-purchase-without-setup-spec-th.md` §9 | “ไม่แตะ BillingInvoice” ถูกแทนด้วย `productKind` ของ PR A | PR A |
| `docs/specs/sales-event-discounts-spec-th.md` / แผน | ระบุ PR A เป็น prerequisite ร่วม, ไม่มีแท็บ, ล็อกเฉพาะ attempt แพ็กเกจ | งานส่วนลด (ไม่อยู่ในไฟล์ของแผนนี้) |
| `docs/runbooks/uat-production-v2-deployment.md` | “binary ขั้นต่ำต่อ schema ของ policy” (F-09) | PR A |
| `docs/agent-memory/chat-credit-addons-implementation.md` | สร้างตอนเริ่ม PR A | PR A |

## 8. ประมาณการ (F-25)

วันทำงานของผู้ implement หนึ่งคน รวมเทสต์ที่ระบุ ไม่รวมเวลารอรีวิว/CI/UAT; ช่วงกว้างเพราะ PR C และ E แตะเงินและ lock ของระบบที่มีอยู่

| PR | ขนาด | วันทำงาน |
| --- | --- | ---: |
| A foundation | M | 4–6 |
| B ledger รูป + seam + admin | L | 7–9 |
| C รอบ + ledger เครดิต AI + v2 funding | XL | 10–14 |
| D lane v1 | M | 5–7 |
| E ซื้อ/apply/คืนเงิน/API | XL | 9–12 |
| F UI/LINE/คอนโซล/ข้อความ | L | 9–12 |
| G cohort/ย้าย/ประกาศ | M | 4–6 |
| งานข้ามระบบ (§3) กระจายทุก PR | S | 2–3 |
| UAT + Production acceptance + ย้ายทีละกลุ่ม | M | 4–6 |
| **รวม** | | **54–75** |

ถ้าแบ่งงานสองถึงสามสายคู่ขนาน (B ∥ C, แล้ว D ∥ E, แล้ว F ∥ G) ระยะเวลาจริงราว 6–9 สัปดาห์หลังขั้น 0 และ PR A; ตัวเลขนี้ยังไม่ได้พิสูจน์กับความเร็วจริงของทีม

## 9. Acceptance scenarios (AO-E) และที่พิสูจน์

รหัสขึ้นต้น AO- เพื่อไม่ชนกับ E01–E27 ของงานส่วนลด. AO-E01–AO-E42 เขียนใหม่จากสเปก (ต้นฉบับไม่มีใน repository); AO-E43–AO-E60 คือ E43–E60 ใน audit §5; AO-E61–AO-E72 มาจากรีวิว R1. ทุกข้อยัง **ไม่รัน**

| ID | Scenario | Spec | ที่พิสูจน์ (PR) |
| --- | --- | --- | --- |
| AO-E01 | Catalog/quote ทั้งหก offer ตรงราคา จำนวน อายุ ภาษี; body ปลอมราคา/จำนวนถูกปฏิเสธ | A01 | `billing-addon-quote.spec.ts` (E) |
| AO-E02 | บัตร: quote → checkout → paid → APPLIED → ยอด → ใช้ | A02 | `billing-addon-apply.pg.spec.ts`, smoke (E) |
| AO-E03 | QR: เช่นเดียวกับ AO-E02 รวม async payment | A02 | smoke (E) |
| AO-E04 | สองแท็บเปิด checkout พร้อมกัน → slot กันรายการที่สอง | A03 | PG (E) |
| AO-E05 | Event ซ้ำ/สลับลำดับ/คำตอบหาย → เพิ่มยอดครั้งเดียว | A03 | PG (E) |
| AO-E06 | ซื้อครั้งที่สองโดยตั้งใจหลังรายการแรกจบ → เพิ่มได้ | A03 | PG (E) |
| AO-E07 | Session หมดเวลา/ยกเลิก/ไม่สำเร็จ/UNKNOWN → ไม่เพิ่มยอด ปล่อย slot ถูกเวลา | A04 | PG (E) |
| AO-E08 | จ่ายแล้วแต่ apply ถูกพัก → กู้จากใบเดิม ไม่ชำระใหม่ ไม่อิง slot | A04 | PG (E) |
| AO-E09 | งานเดียวเกินยอดจากแพ็กเกจ → แบ่ง debit ข้ามแหล่ง | A05 | `ai-credit-funding.pg.spec.ts` (C) |
| AO-E10 | Hold/settle/correction reconcile กับ entries; available ไม่ติดลบ | A05 | PG (C) |
| AO-E11 | ขอบรอบวันที่ 15/29/30/31 และปีอธิกสุรทิน ตรงขอบช่วงที่ชำระ | A06 | `ai-credit-cycles.spec.ts` (C) |
| AO-E12 | รายปี 12 รอบ, ดีล N เดือน, one-time ต่อช่วง | A06 | cycles spec (C) |
| AO-E13 | Upgrade/ซื้อซ้ำ/ล่วงหน้า/ดีล/add-on ไม่สร้างรอบกลางรอบ | A06 | cycles spec (C) |
| AO-E14 | Reset แข่งกับ settle → ต้นทุนอยู่รอบเดิม | A06 | PG (C) |
| AO-E15 | ซื้อเพิ่ม/ต่อแพ็กไม่เปลี่ยนอายุ lot | A07 | PG (B/C) |
| AO-E16 | Lot หมดอายุขณะมี hold → settle กับ lot เดิม ไม่ชุบ | A07 | PG (C) |
| AO-E17 | แพ็กเกจหมดอายุ → ยอดเพิ่มเติมคงอยู่ใช้ไม่ได้; เลือกแพ็กเกจใหม่ → ใช้ได้; lot ที่หมดอายุไม่กลับมา | A07 | PG (C) |
| AO-E18 | รูปหนึ่งงานหลาย call/chunk → หนึ่งหน่วย | A08 | `receipt-addon-ledger.pg.spec.ts` (B) |
| AO-E19 | อ่านไม่มีผลใช้งานได้ → คืนหน่วยตาม D4/Q4; replay ไม่คิดซ้ำ | A08 | PG (B) |
| AO-E20 | PDF/หลายหน้าไม่ใช้ยอด ADD_ON; statement ไม่ใช้หน่วยรูป | A08 | PG (B), เทสต์ของ D |
| AO-E21 | เพดาน TOTAL/OCR ปิดขณะยังมียอด → `COMPANY_LIMIT` ไม่ชวนซื้อ | A09 | quote spec (E), LINE spec (F) |
| AO-E22 | SHARED และ SPLIT คุม concurrency ของยอดที่ซื้อ | A09 | PG (C) |
| AO-E23 | คืนเงินเต็ม/บางส่วน → หน่วย freeze แล้ว revoke/unfreeze | A10 | PG (E) |
| AO-E24 | คืนจาก dashboard/ข้อโต้แย้ง → freeze + issue ไม่สร้างหนี้ | A10 | PG (E) |
| AO-E25 | การใช้แข่งกับการคืนเงิน → ไม่คืนหน่วยที่ใช้แล้ว | A10 | PG (E) |
| AO-E26 | บริษัท/ผู้ใช้/account-mode ข้าม, ผู้ถูกถอนสิทธิ์จัดการแพ็กเกจ, quote เก่า, id ปลอม → ปฏิเสธ | A11 | quote spec (E) |
| AO-E27 | บทบาทกำหนดเองที่มี `company.plan.manage` ซื้อได้; พนักงานได้ 403 ที่ status | A11, A38 | quote spec (E), web spec (F) |
| AO-E28 | Payload ของลูกค้าไม่มียอดกันไว้/source breakdown (U01/U02) | A19 | status spec (E) |
| AO-E29 | ยอดสองสินค้ามาจาก snapshot เดียว; refresh พร้อมกันไม่บวกเอง (U04/U09) | A21 | PG (E) |
| AO-E30 | หน่วยเครดิต AI 0.01/รูปเต็ม/สตางค์ ถูกทุก consumer (U03) | A20 | contracts spec (A), web spec (F) |
| AO-E31 | ยอดศูนย์จริงต่างจากอ่านไม่ได้; null ไม่เป็นไม่จำกัด (U03) | A20 | web spec (F) |
| AO-E32 | แพ็กเกจหมดอายุ/ขีดจำกัดไม่ลบยอดที่เก็บ (U04) | A21 | PG (C) |
| AO-E33 | สาเหตุการปฏิเสธแยกยอดหมด/ไม่พอ/ขีดจำกัด/ทำอยู่/ไม่พร้อม/แพ็กเกจ (U05) | A22 | LINE spec (F), quote spec (E) |
| AO-E34 | Error ไม่ทราบผลก่อน/หลังส่งชำระมีข้อความตามขั้น (U08) | A22 | web spec (F) |
| AO-E35 | คำ/หน่วย/วันเติมรอบเหมือนกันทุกช่องทาง (U06) | A12, A24 | web + LINE spec (F) |
| AO-E36 | ประวัติหนึ่งรายการต่อ logical operation (U10) | A21 | history spec (E) |
| AO-E37 | ข้อความ LINE ในคิวจาก template เดิมส่งได้หลัง deploy (U07) | A24 | `drain-line-ledger.use-case.spec.ts` (F) |
| AO-E38 | Error ดิบ/enum ที่ไม่รู้จักไม่ถึงหน้าจอ (U08) | A23 | `api-error-coverage.spec.ts` (F) |
| AO-E39 | เปลี่ยนบริษัท/response มาช้าไม่ทับยอด (U09) | A23 | web spec (F) |
| AO-E40 | มุมมองผู้ดูแลยังเห็น source/hold ที่ใช้กู้ (U01/U02) | A23 | admin spec (B/C) |
| AO-E41 | ไม่มีข้อความ “เดือนหน้า”/“ติดต่อผู้ดูแล” ผิดสำหรับร้านที่ย้าย (U05/U06) | A22 | LINE + web spec (F) |
| AO-E42 | คืนหน่วย/คืนเงิน/หมดอายุแสดงตามหลักฐาน (U04/U10) | A21 | history spec (E) |
| AO-E43–AO-E60 | ตาม audit §5 (admin grant, เพดาน, writer, route, snapshot, parent/child, hold เก่า, หน่วย, ความเข้ากันได้) | A25–A32 | B, C, D, G ตามแถวของ audit |
| AO-E61 | ร้าน CARD_AUTO ที่มี add-on OPEN/HELD/UNKNOWN ได้รับการต่ออายุที่ apply และ grace ทำงาน | A33 | `billing-addon-apply.pg.spec.ts` (E) — release gate |
| AO-E62 | ร้าน PROMPTPAY_RENEW ที่มี add-on ค้าง: binding ต่ออายุ QR และ grace ทำงาน | A33 | PG (E) |
| AO-E63 | Add-on ค้างไม่บล็อกยกเลิกต่ออายุ, เปลี่ยนอีเมลรับเอกสาร, คืนเงินแพ็กเกจ, ซื้อแพ็กเกจใหม่ | A33 | PG (E) |
| AO-E64 | Invariant ของสเปก §9.2 สำหรับ CARD_AUTO, PROMPTPAY_RENEW, CARD_ONCE, advance deal | A35 | PG (E) |
| AO-E65 | Grace ของ QR: รอบใหม่ใช้ได้ที่ขอบรอบ; จ่ายแล้วไม่เติมซ้ำ; ไม่จ่ายรอบปิด | A34 | cycles spec + PG (C) |
| AO-E66 | Turn ของ LINE v2 ข้ามขอบรอบใช้รอบเดิม; grant v2 ไม่เปลี่ยน | A36 | `line-ai-budget-authority.pg.spec.ts` (C) |
| AO-E67 | Binary ใหม่อ่าน policy เก่า/ใหม่; price id ซ้ำข้าม map ถูกปฏิเสธ; gates ปิดเป็นค่าเริ่มต้น | A37 | `billing-policy-addon.spec.ts` (A) |
| AO-E68 | Reader สี่จุดของแพ็กเกจไม่เห็นใบ add-on | A13 | `billing-product-foundation.pg.spec.ts` (A) — release gate |
| AO-E69 | แจ้งเตือน add-on ไม่มีตัวเลขและไม่ใช้ข้อความแพ็กเกจ | A39 | notifications spec (E) |
| AO-E70 | การ์ดรูปหมดส่งใหม่เมื่อยอดเปลี่ยนรุ่น; latch เว็บล้าง | A39 | webhook spec (B), web spec (F) |
| AO-E71 | ลิงก์ LINE: mint ในเลน, ไม่ mint ในกลุ่ม, external browser, เฉพาะผู้มีสิทธิ์จัดการแพ็กเกจ | A40 | webhook spec (F) |
| AO-E72 | Validator ของ add-on ปฏิเสธส่วนลดทุกชนิดรวมส่วนลดจากงานอีเวนต์ | A01, O-03 | `paid-addon-invoice.spec.ts` (E) |

## 10. U01–U10 (D11) — เขียนใหม่และผูก PR

| จุด | งานที่ต้องทำ | PR / เกณฑ์ | สถานะ |
| --- | --- | --- | --- |
| U01 | API ยอดของลูกค้าส่งเฉพาะข้อมูลที่อนุญาต; รายละเอียดของผู้ดูแลแยกตามสิทธิ์ ครบ Web/LINE/export/ประวัติ | E, F / A19, A23; AO-E28, AO-E40 | ยังไม่เริ่ม |
| U02 | ยอดแถม+ซื้อเป็น `additionalRemainingUnits` ใหม่ โดยไม่เปลี่ยนความหมาย `monthlyAllowance.additionalRemaining` เดิม | E, F / A19, A20 | ยังไม่เริ่ม |
| U03 | บังคับหน่วยเครดิต/รูป/สตางค์ และ FINITE/UNLIMITED; แยกศูนย์จริงจากอ่านไม่ได้ | A, F / A20, A23; AO-E30, AO-E31 | ยังไม่เริ่ม |
| U04 | รวมเฉพาะตอนแสดง; คง lot, วันหมดอายุ, ลำดับใช้, สิทธิ์คืนเงิน และยอดระหว่างแพ็กเกจหมดอายุ | B, C, E / A10, A20, A21 | ยังไม่เริ่ม |
| U05 | Admission คืนสาเหตุจริงและปุ่มที่แก้เหตุได้ | C, D, F / A09, A22; AO-E33, AO-E41 | ยังไม่เริ่ม |
| U06 | คำ/วันเติม/หน่วยชุดเดียวตามสเปก §17.4 ทุกช่องทาง | F / A12, A22, A24 | ยังไม่เริ่ม |
| U07 | ข้อความ LINE ในคิวจาก template เดิมตรวจด้วย version ของ template | F / A24; AO-E37 | ยังไม่เริ่ม |
| U08 | Error fallback ภาษาไทยตามขั้น; ข้อมูลดิบอยู่ใน log/ผู้ดูแล; ผลจ่ายไม่ทราบให้ตรวจรายการเดิม | E, F / A04, A22, A23 | ยังไม่เริ่ม |
| U09 | อ่านยอดจาก snapshot เดียวของ server; guard ของบริษัท/request; ไม่บวกยอดเองบน client | E, F / A21, A23 | ยังไม่เริ่ม |
| U10 | ประวัติหนึ่งรายการต่อ logical operation; ไม่เปิด reserve/release ภายใน | E, F / A18, A21, A24 | ยังไม่เริ่ม |

## 11. ประวัติของเอกสาร

- 2026-09-28: ร่างสเปก/แผน P0–P7, มติ D1–D8, ราคาหกชุด
- 2026-09-29 (ร่าง): D9–D12, U01–U10, C01–C12/E43–E60; ตรวจเอกสารแบบ static บนฐาน `4a5817b4` (ฐานนี้ไม่ใช่บรรพบุรุษของ develop — F-02)
- 2026-09-29 (ฉบับนี้): แทน P0–P7 ด้วย PR A–G ตามรีวิว R1; เพิ่มมติ O-01–O-03, T-01–T-09, คำถาม Q1–Q7; ตรวจอ้างอิงใหม่บน develop `8a91bc1c`. Phase เดิมเทียบได้ดังนี้: P0 → §1/§4 + PR G; P1 → PR A (+ contract ส่วน E); P2 → PR B + PR C; P3 → PR E; P4 → PR C/D/E; P5 → PR F; P6 → §5/§9; P7 → §5–§6
- งานเอกสารรอบนี้ไม่แก้ application ไม่รันเทสต์ ไม่แตะ cloud/Stripe/provider
