# Plan: ส่วนลดจากงานขาย — ลดบิลแรกให้ร้านใหม่ และเครดิตให้ร้านเดิม

ปรับล่าสุด 2026-09-29 · **แบบพร้อมลงมือหลัง prerequisite §1; ยังไม่เริ่ม implement และยังไม่มีสิทธิ์ deploy; ออก release เดียวกับ add-on เครดิต AI และอ่านรูป**

[Spec](../specs/sales-event-discounts-spec-th.md) · [Audit และผลตรวจซ้ำบน develop](../research/sales-event-discounts-e2e-impact-audit-2026-09-29-th.md) · [แผน add-on](chat-credit-and-receipt-addons-plan-th.md) · [แบบของงานข้ามทุก PR](purchase-without-setup/xx-cross-cutting.md) · [Runbook deploy](../runbooks/uat-production-v2-deployment.md) · [Runbook cloud](../runbooks/cloud-environment-operations.md). Memory ของงานนี้ยังไม่มีใน repo

ฐานที่ตรวจ: ทุก `file:line` ตรวจกับ develop `105b0dc6` (2026-09-29 หลัง #860 และ #862); #860 เลื่อนบรรทัดของ `billing.service.ts`, `billing.controller.ts`, `billing-admin.service.ts`, `billing-http-smoke.ts` และ `BillingPage.tsx` — ปรับแล้ว. ตอนลงมือให้ตรวจ anchor ซ้ำบน develop ล่าสุดก่อนแก้ (แบบ xx-cross-cutting §2.1). รหัส SD-O/SD-T/SD-Q/SD-E อยู่ในสเปก; ชื่อ PR ของแผนนี้ (SD-A…SD-F) คนละชุดกับรหัสเกณฑ์รับงาน SD-E01…

## 0. ส่งมอบอะไร และไม่ทำอะไร

ส่งมอบ: ชุดส่วนลด (ส่วนลดบิลแรก + เครดิตสำหรับร้านเดิม) และการมอบหมายในคอนโซลทีมขาย, QR 5 นาทีต่อชุดที่ใช้ได้ทั้งร้านใหม่และร้านเดิม, รับส่วนลดผ่าน LINE (LIFF), ลดบิลแรกของการซื้อที่เริ่มแพ็กเกจใหม่ใน 4 โหมดโดยไม่มี coupon พร้อมตัวเลือก "ใช้" (เลือกไว้แล้ว) / "ไม่ใช้ครั้งนี้" ต่อการซื้อ, การจอง/ใช้/ปล่อยสิทธิ์ที่ผูกกับ attempt ของแพ็กเกจ, การรับเครดิตเข้าร้านเดิมผ่านกลไกเพิ่มยอดของ add-on, บรรทัดราคาและกล่องบนหน้า billing, รายงานทีมขาย, การค้นหาของแอดมิน

ไม่ทำ: ลดรอบต่ออายุ, แก้ guard ของการต่ออายุหรือ grace, coupon/promotion code, ส่วนลดราคากับดีลหรือการซื้อ add-on, ledger เครดิตชุดที่สอง, แท็บใหม่บนหน้า billing, แจ้งเตือน LINE/อีเมล (SD-Q5), แก้ `package.json`, env ใหม่, key ใหม่ใน `policyJson`, AI tool

รอบเอกสารนี้แก้ spec และ plan ของงานนี้ และแก้สเปก/แผน add-on เฉพาะแหล่งยอด `SALES_EVENT`, การอ้างอิงถึงกัน และการออก release ร่วม. ไม่มีโค้ด ไม่มี schema ไม่เรียก provider ไม่ deploy

## 1. ลำดับงานและ prerequisite (SD-T2, SD-O6)

```
P1 งานแก้ purchase flow ─> P2 foundation (add-on PR A) ─┬─> add-on PR B ─┐
                                                        ├─> add-on PR C ─┼─> SD-F (เครดิตร้านเดิม) ─┐
                                                        ├─> add-on PR D, E, F, G ────────────────────┤
                                                        └─> SD-A ─> SD-B ─> SD-C ─> SD-D ────────────┼─> SD-E ─> native proof + UAT ร่วม ─> Production ร่วม
P3 คำตอบ Owner SD-Q1, Q2, Q3, Q5, Q8, Q9 ─────> เสร็จ 2026-09-29: รับค่าเริ่มต้นทั้งหมด (สเปก SD-O9)
```

| ID | Prerequisite | ทำไมงานนี้ต้องรอ |
|---|---|---|
| P1 | งานแก้ purchase flow ที่กำลังทำ: สถานะหลังกลับจาก Stripe, ปลดล็อก WorkspaceLayout, แผงผู้รับเอกสาร, label, ลิงก์ค้นหาแอดมิน, sync ข้อมูลร้านไป Stripe, คำศัพท์ | แก้ `BillingPage.tsx`, หน้า return และข้อความชุดเดียวกับที่ SD-D แก้ |
| P2 | Foundation = PR A ของแผน add-on (T-02, T-07): `BillingAttempt.productKind` และ `BillingInvoice.productKind` (`String @default("PACKAGE")`), ช่องจอง `BillingAccount.activeAddOnAttemptId` แยกจาก `activeAttemptId`, reader ของแพ็กเกจกรอง PACKAGE | การจองส่วนลดราคาผูกกับ attempt ของแพ็กเกจใน `activeAttemptId` เท่านั้น; ถ้า checkout ของ add-on ใช้ช่องเดียวกัน quote แพ็กเกจจะถูกบล็อก (`billing.service.ts:347`) และสถานะ "กำลังชำระ" จะผิด (SED-16); validator ของ add-on ต้องปฏิเสธ `eventDiscount` |
| P3 | **เสร็จ 2026-09-29**: Owner รับค่าเริ่มต้นของ SD-Q1, SD-Q2, SD-Q3, SD-Q5, SD-Q8, SD-Q9 ในสเปก §12 (SD-O9) | วันหมดอายุ, RESTART, เครดิตยอดขาย, ครั้งต่อชุด และร้านที่ยังไม่ย้าย กำหนดโค้ดของ SD-C และ SD-F |
| P4 | PR B และ PR C ของแผน add-on merge แล้ว: grant seam `applyAddOnGrant` ใน `apps/api/src/modules/billing/application/billing-addon-grants.ts` ทั้งฝั่งรูป (B4) และเครดิต AI (C7) พร้อมแหล่ง `SALES_EVENT` | SD-F เรียก seam นี้ ไม่สร้าง ledger เอง |

**Release ร่วม (SD-O6)**: ทุก PR ของงานนี้ (SD-A…SD-F) กับ add-on PR A–G อยู่ใน candidate เดียวกัน ผ่าน UAT → READY → Production รอบเดียว และเปิด gate `event_discounts`, `addon_chat_credit`, `addon_receipt_image` ในขั้นเดียวกัน. PR ใดที่ merge ก่อนต้องให้ gate ปิดไว้

การทำงานคู่กับ add-on: SD-A และ SD-B ไม่แตะไฟล์ billing จึงพัฒนาคู่ขนานกับ add-on ได้ แต่ merge หลัง P2. SD-C, SD-D และ SD-F แตะไฟล์ร่วมกับ add-on — ทีละ PR ต่อไฟล์ PR ที่ merge ทีหลัง rebase แล้วรันเทสต์ของไฟล์นั้นใหม่:

| ไฟล์ร่วม | งานนี้แก้ | add-on แก้ |
|---|---|---|
| `apps/api/src/modules/billing/application/billing.service.ts` | quote (ตัวเลือก), checkout, attempt, history, view ส่วนลด (SD-C) | สาขา ADD_ON ของ quote/checkout, status |
| `apps/api/src/modules/billing/presentation/billing.dto.ts`, `billing.controller.ts` | `eventDiscountChoice` ใน quote; route view และรับเครดิต | `purchaseIntent: 'ADD_ON'`, route ของ add-on |
| `apps/api/src/modules/billing/application/billing-reconciler.service.ts` | route, ใช้/ปล่อยสิทธิ์, ผูก CARD_AUTO | apply ของ add-on แยก |
| `apps/api/src/modules/billing/domain/paid-checkout-invoice.ts` | ยอดที่คาดหวัง `:22-23` เท่านั้น | validator ของ add-on แยกไฟล์ |
| `apps/api/src/modules/billing/application/billing-addon-grants.ts` (สร้างใน add-on PR B) | เรียกใช้เท่านั้น (SD-F) | seam และแหล่ง `SALES_EVENT` |
| `packages/contracts/src/billing.ts` | ฟิลด์ใหม่ + `BILLING_ACTIONS` | ชนิด quote/offer ของ add-on + gates |
| `apps/api/src/modules/auth/presentation/auth.guard.ts` (pin) | `/event-discount` ใน GET | route ของ add-on |
| `apps/web/src/features/billing/BillingPage.tsx` | กล่องตัวเลือก, บรรทัดการ์ด, ขั้นตรวจยอด, กล่องรับเครดิต | แท็บ "เครดิต AI และอ่านรูป", บรรทัดสรุปยอดใต้การ์ดแพ็กเกจปัจจุบัน |

## 2. PR briefs

ทุก PR: worktree ใหม่จาก `origin/develop` ล่าสุด → PR ไป develop → twin PR ไป main (admin-merge ตามมติ Owner); stage เฉพาะ path ที่แก้; ไม่แตะ `package.json`

### SD-A — ข้อมูลและคอนโซลทีมขาย (ชุด, มอบหมาย, QR, รายการ, เพิกถอน, สิทธิ์)

| ไฟล์ | งาน |
|---|---|
| `apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/<ts>_sales_event_discounts/migration.sql` | 4 model ตามสเปก §6.1 (String state, ไม่มี enum) รวมฟิลด์เครดิตของชุดและ ticket และ `redeemedAs`; index; partial unique สองตัวด้วย SQL ดิบ (แบบ `20260705010000_item15a_idempotency_and_channel_uniqueness`): `(companyId) WHERE state IN ('RESERVED','USED') AND "redeemedAs" = 'DISCOUNT'` และ `(batchId, companyId) WHERE state IN ('RESERVED','USED')` |
| `packages/contracts/src/sales.ts` | `SALES_PERMISSION_KEYS` เพิ่ม `'sales.event.manage'` (`:9-10`); `SALES_EVENT_BATCH_STATES`, `SALES_EVENT_TICKET_STATES`, `SALES_EVENT_REDEEM_PATHS`; ชนิด `SalesEventBatchInput`, `SalesEventBatchView`, `SalesEventQr`, `SalesEventTicketView` |
| `apps/api/src/modules/auth/permission-registry.ts` | entry ใหม่ใกล้ `:108-115`; grant ของ `MANGMEE_SALES_LEAD` (`:565`); SYSTEM_ADMIN ได้จาก `...SALES_PERMISSION_KEYS` (`:555`) |
| `apps/api/src/modules/sales-console/domain/sales-event.logic.ts` | ตรวจฟอร์ม (ส่วนลดเต็มบาท ≥ 0, เครดิตจำนวนเต็ม ≥ 0, อย่างน้อยหนึ่งค่า > 0), ช่วงเวลา, state machine (สเปก §6.2), อายุ QR, serial, ตรวจขั้นต่ำต่อ scope เมื่อส่วนลด > 0 (ราคาจาก policy ปัจจุบัน) |
| `apps/api/src/modules/sales-console/application/sales-events.service.ts` | สร้าง/แก้/สั่ง state, ค้นหาเซลล์ (หัวหน้า: ทีมตัวเอง; admin: ทั้งหมด; take 50 + cursor), ออก QR (hash token, `qrSvgDataUrl`), รายการส่วนลด (แยกใช้เป็นส่วนลด/เครดิต), เพิกถอน; audit ทุกคำสั่ง; ประกาศ constructor เอง (DI check) |
| `apps/api/src/modules/sales-console/presentation/http/sales-events.controller.ts` + `sales-events.dto.ts` | route `/v1/sales/events/*` (สเปก §7.1) ทุก handler เรียก `assertPlatformTenant` (`sales-context.ts:37`) + `@RequirePermissions` |
| `apps/api/src/modules/sales-console/sales-console.module.ts` | ลงทะเบียน controller/provider (imports เดิม `:30` มี BillingModule แล้ว) |
| `apps/api/src/modules/audit/domain/models/audit-action.ts` | action `sales.event.*` (ห้ามแตะบรรทัดที่ถูก pin แบบ literal: `PLATFORM_ACCESS_STATE_UPDATE`) |
| `apps/web/app/sales/events/page.tsx`, `apps/web/app/sales/events/[batchId]/page.tsx` | route หน้าเว็บ |
| `apps/web/src/features/sales-console/SalesEventsPage.tsx`, `SalesEventBatchForm.tsx`, `SalesEventBatchPage.tsx`, `sales-events.logic.ts`, `sales.api.ts` | ฟอร์ม (ส่วนลด, เครดิต AI, จำนวนอ่านรูปใบเสร็จ, checkbox เซลล์ + ค้นหา server, `datetime-local` + `+07:00`), รายการ, หน้าชุด, ปุ่ม QR พร้อมนับถอยหลัง |
| `apps/web/src/common/components/app-shell/SalesHeader.tsx` | เมนู "ส่วนลดจากงาน" ในกลุ่มงานขาย (ข้าง `:27-28`) |

เทสต์และที่ลงทะเบียน:
- `apps/api/src/modules/sales-console/domain/sales-event.logic.spec.ts` → whole-chain catalog suite `api-behavior` (`scripts/line-ai-whole-chain-acceptance.catalog.mjs:413`, ข้างรายการ sales `:424-427`)
- `apps/api/src/modules/sales-console/sales-event-discounts.pg.spec.ts` → `ci.yml` job Migrations and Boot ต่อจาก `:778` ด้วย `SALES_EVENT_TEST_DATABASE_URL="$DATABASE_URL"`; skip เมื่อ env ว่างแบบ `sales-console.pg.spec.ts`; เขียนและอ่านทุกคอลัมน์ใหม่ และทดสอบ partial unique ทั้งสองตัว
- ปรับ `apps/api/src/modules/auth/permission-registry.spec.ts:268-288` (หัวหน้ามี, เซลล์ไม่มี, SYSTEM_ADMIN มี, ร้านไม่มี)
- web: `sales-events.logic.spec.ts` (glob ของ web รันเอง)

เสร็จเมื่อ: SD-E01, SD-E02 และส่วนสิทธิ์ของ SD-E15 ผ่านที่ระดับ HTTP/PG; `migration:review` อ่านได้; `test:boot` ผ่าน. ประมาณ 3–4 วันทำงาน

### SD-B — รับส่วนลดผ่าน LINE (หน้า LIFF, claim API, gate)

| ไฟล์ | งาน |
|---|---|
| `packages/contracts/src/billing.ts` | `BILLING_ACTIONS` เพิ่ม `'event_discounts'` (`:39`); ตรวจว่าหน้าตั้ง gate ของแอดมินแสดง key ใหม่ |
| `apps/api/src/modules/sales-console/application/claim-event-discount.use-case.ts` | ตรวจ ID token (`LineIdTokenService`), rate limit ต่อ LINE user, หา QR ด้วย hash, ตรวจชุด/ช่วง/ผู้แจก/gate, ปฏิเสธตัวตนที่เป็นสมาชิก platform tenant (SD-Q3), transaction claim (lock batch, replay, cap, insert พร้อมตรึงส่วนลดและเครดิต, audit); คืน `next` จาก `ExternalIdentity` |
| `apps/api/src/modules/sales-console/presentation/http/public-event-discounts.controller.ts` + DTO | `@Public() @Controller('public/event-discounts')` `@Post('claim')` (แบบ `public-line-signup.controller.ts:83-94`) |
| `apps/api/src/modules/sales-console/sales-console.module.ts` | import `AuthModule` (export `LineIdTokenService`, `AuthRateLimitService` ไว้แล้วที่ `auth.module.ts:178`); ไม่แตะ `auth.module.ts` ที่ถูก pin |
| `apps/api/src/modules/auth/application/auth-rate-limit.service.ts` | bucket ของ claim ต่อ LINE user |
| `apps/api/src/modules/auth/presentation/auth.controller.ts` | `@Public() @Get('line/link-page/event-discount')` ข้าง `:520-526`; render ด้วย `liffPageHtml` ไม่ inject อะไรใหม่ |
| `apps/api/src/common/security/liff-page.security.ts` | mode `event-discount` ใน `LIFF_PAGE_SCRIPT` (`:131`): อ่าน `t`, ขอ ID token, POST claim, แสดงผลตามสเปก §3.3/§3.5 (เฉพาะสิ่งที่ชุดให้), ปุ่ม "เปิดมั่งมี" ผ่าน `POST /v1/auth/line/liff/session` เดิม หรือ "เปิดร้านใหม่" |

เทสต์และที่ลงทะเบียน:
- `apps/api/src/modules/sales-console/application/claim-event-discount.use-case.spec.ts` → catalog
- `apps/api/src/common/security/liff-event-discount-page.spec.ts` (HTML, CSP, ข้อความของชุดส่วนลดอย่างเดียว/เครดิตอย่างเดียว/ทั้งคู่, ไม่มีคำว่า "ตั๋ว") → catalog; `liff-page-contrast.spec.ts` เดิมต้องผ่าน
- เพิ่มกรณีใน `sales-event-discounts.pg.spec.ts`: cap=1 สองคนพร้อมกัน, replay, ตัวตน platform tenant, gate ปิด, ผู้แจกถูกถอด

เสร็จเมื่อ: SD-E03 และส่วน claim ของ SD-E16. ประมาณ 1.5–2 วัน

### SD-C — เชื่อม billing ของส่วนลดราคา (ตัวเลือก, quote, Checkout, หลักฐาน, CARD_AUTO, reconcile, allowlist, แอดมิน)

| ไฟล์และตำแหน่ง (develop `105b0dc6`) | งาน |
|---|---|
| `packages/contracts/src/billing.ts` | `BillingQuote.eventDiscount` (มี `choice` และ `applied`, `:121-148`), `BillingEventDiscountView` (มีทั้ง `discount` และ `credit`), `BillingAttemptView.eventDiscount`, `eventDiscountSatang` ในรายการประวัติ, lookup kind `EVENT_TICKET` (สเปก §7.2) |
| `apps/api/src/modules/billing/presentation/billing.dto.ts:90-100` + `billing.controller.ts:593` | `eventDiscountChoice?: 'USE' \| 'DECLINE'` (`@IsOptional() @IsIn`) ใน `BillingQuoteDto` และ whitelist ของ `bodyFields` |
| `apps/api/src/modules/billing/domain/billing-event-discount.logic.ts` | pure: เส้นทางตามสถานะร้าน (สเปก §4.1), ราคาต่อแบบภาษี (§5.1), ขั้นต่ำ 1000 สตางค์ (ค่าคงที่ร่วมกับ `billing-policy.ts:46`), เลือกรายการที่เสนอ (§4.3), ตัดสินตัวเลือก (ไม่ส่ง = USE), กติกา stale ตามตัวเลือก |
| `apps/api/src/modules/billing/application/billing-event-discount.ts` | DB: หารายการของผู้ใช้ผ่าน `ExternalIdentity` (LINE, ACTIVE), view ต่อร้าน, จอง, ใช้, ปล่อย; ตรวจดีล (`status 'APPROVED'` + `offerExpiresAt > now` แบบ `billing.service.ts:886-887`, หรือ `'PAID'`) |
| `billing.service.ts:58` | `BillingSnapshot.eventDiscount?` เป็น `{ choice: 'USE', … }` หรือ `{ choice: 'DECLINE', offeredTicketId }` |
| `billing.service.ts:66-67` | `paymentCheckoutSnapshot` จริงเมื่อ `eventDiscount.choice = 'USE'` (CARD_AUTO เป็น one-time) |
| `billing.service.ts:292` quote; ใส่ผลหลัง `:494` ก่อน `:522` | รับ `eventDiscountChoice`; ใส่ `quote.eventDiscount`/`snapshot.eventDiscount` ตามตัวเลือก; `quote.totalSatang` คงราคาเต็ม |
| `billing.service.ts` checkout transaction `:532-620` | ตรวจซ้ำตามตัวเลือกใน snapshot: USE → gate, ดีล, ร้านเคยใช้, ชุดนี้ร้านนี้เคยใช้, หมดอายุ, ชุด SUSPENDED, ตัวตนยังเป็นของผู้ใช้, version → stale ถ้าไม่ผ่าน แล้วจองหลังสร้าง attempt และตั้ง `activeAttemptId` (`:614-618`); DECLINE → ไม่ตรวจเหตุของส่วนลด; ไม่มีข้อเสนอตอน quote แต่มีตอนนี้ → stale |
| `billing.service.ts:735-736`, `:740` | `setup_future_usage` สำหรับ CARD_AUTO ที่เลือกใช้; `unit_amount = eventDiscount.applied.unitAmountSatang` |
| `billing.service.ts:763-770` | ปล่อยการจองเมื่อ attempt FAILED |
| `billing.service.ts:817-820` | `cardAdvanceTrial` ครอบ `eventDiscount` ที่ใช้ (portal cancel ระหว่างงวดแรก) |
| `billing.service.ts:1000-1015`, `:1042-1057` + method ใหม่ `eventDiscount(context)` | attempt view, ประวัติ (จาก ticket.invoiceId), view ของ route ใหม่ (ส่วน `credit` ของ view เติมใน SD-F) |
| `billing.controller.ts` (`@Controller('companies/:companyId/billing')` `:522`) | `@Get('event-discount')` |
| `apps/api/src/modules/billing/domain/paid-checkout-invoice.ts:22-23` | ยอดที่คาดหวังจาก `snapshot.eventDiscount` เมื่อ `choice = 'USE'`; การตรวจ discount `:30,35,41,49` ไม่แตะ |
| `billing-reconciler.service.ts:240`, `:419`, `:453`, `:478-479` | route attempt CARD_AUTO ที่ใช้ส่วนลดเข้า `reconcileOneTime` (ปกติ, นำเข้า, retry) |
| `billing-reconciler.service.ts:311-319` | ข้ามบิล $0 `subscription_create` ของ trial เมื่อ contract ใช้ส่วนลด |
| `billing-reconciler.service.ts:494-504` | ปล่อยการจองเมื่อ session หมดอายุ |
| `billing-reconciler.service.ts:547-557` | ใช้สิทธิ์หลัง upsert invoice ก่อน `:557` และก่อน HELD `:592-599`; ไม่ตรง → issue `EVENT_DISCOUNT_REVIEW` |
| `billing-reconciler.service.ts:658`, `:695`, `:1088-1144` | คง `activeAttemptId` จนผูก; ขยาย `bindPromptPayRenewal` ให้รับบัตรด้วยส่วนตรวจจาก `bindAdvanceDeal` `:793-800,823-832,834-851` |
| `apps/api/src/modules/billing/application/billing-collection.ts:83,203` | predicate trial ครอบ `eventDiscount` ที่ใช้ |
| `apps/api/src/modules/billing/application/billing-purchase-source.ts:14-17` | ข้อยกเว้นช่วงรอผูกครอบ CARD_AUTO |
| `apps/api/src/modules/auth/presentation/auth.guard.ts:102` | `/event-discount` ในกลุ่ม GET; sync pins (§3.2) |
| `apps/api/src/modules/billing/application/billing-admin.service.ts` (`lookup` `:160`, helper `:144`) + หน้าร้านของแอดมิน | ค้นเลขส่วนลด; แสดงรายการส่วนลดของร้าน |
| `apps/web/src/features/billing-admin/BillingIssueResolutionPanel.tsx:70` | แสดง `EVENT_DISCOUNT_REVIEW` แบบ issue ที่อ้าง invoice; ปิดด้วยมือหลังตรวจ |

เทสต์และที่ลงทะเบียน:
- `apps/api/src/modules/billing/domain/billing-event-discount.logic.spec.ts` → catalog (เส้นทางตามสถานะร้าน, ตัวอย่าง 499/100 ทั้งสามแบบภาษี, ขั้นต่ำ, เต็มบาท, ลำดับเลือก, ไม่ส่งตัวเลือก = USE, กติกา stale สามแบบ)
- `apps/api/src/modules/billing/billing-event-discount.pg.spec.ts` (ใหม่) → `ci.yml` Migrations and Boot ต่อจาก `:782` ด้วย `BILLING_EVENT_DISCOUNT_TEST_DATABASE_URL="$DATABASE_URL"`: quote ใช้/ไม่ใช้/ไม่ส่งค่า; DECLINE แล้ว Checkout ไม่ stale และ ticket ยัง ISSUED; ข้อเสนอเกิดหลัง quote → stale; USE → จอง→จ่าย→USED; ปล่อยเมื่อ FAILED/หมดอายุ; UNKNOWN คง; USED ก่อน HELD; RETRY_APPLY/IMPORT_INVOICE ตรวจซ้ำได้; ดีลกัน; หนึ่งรายการต่อร้านเมื่อแข่งกัน; ชุดเดียวกันซ้ำที่ร้านเดิมถูกกัน; CARD_AUTO one-time + ผูก trial ด้วย Stripe fixture (แบบ `billing-advance-deal.pg.spec.ts:16-67`) และบิลรอบสองราคาเต็มผ่าน `paidInvoiceEvidence`; grace ของรอบแรกหลัง trial เริ่มตามเดิม
- ขยาย spec เดิม: `paid-checkout-invoice.spec.ts` (catalog; ยอดลดผ่านเมื่อ USE, บรรทัดส่วนลดยังถูกปฏิเสธ, DECLINE ใช้ยอดเต็ม), `billing-collection.spec.ts` (catalog), `billing-admin-lookup.spec.ts` (catalog), `billing-purchase-source.pg.spec.ts` (`extended-tests.yml:286`), `auth.guard.spec.ts` (ชื่ออยู่ใน `apps/api/package.json` เดิม — แก้เนื้อหาเท่านั้น: GET `/v1/companies/:id/billing/event-discount` ผ่านเมื่อร้านล็อก; path ข้างเคียงและ POST ไม่ผ่าน)
- smoke: `apps/api/src/scripts/billing-event-discount-smoke.ts` + selector `BILLING_EVENT_DISCOUNT_ONLY=1` ใน `apps/api/src/scripts/billing-http-smoke.ts` (บล็อกใหม่ข้าง `:211`) + บรรทัดใน `extended-tests.yml` ต่อจาก `:292`
- ต้องผ่านโดยไม่แก้ (หลักฐานว่า renewal guard ไม่ถูกแตะ): `billing-schedule.spec.ts`, `billing-price-return.spec.ts`, `paid-invoice-promptpay.spec.ts`, `billing-refund-source.spec.ts`, `billing-grace.pg.spec.ts`, `billing-advance-deal.pg.spec.ts`

เสร็จเมื่อ: SD-E04–SD-E14, SD-E16, SD-E19, SD-E20, SD-E21, SD-E22, SD-E24 มีหลักฐาน HTTP/PG. ประมาณ 4.5–6.5 วัน (ส่วนที่เสี่ยงที่สุดคือ CARD_AUTO และเส้นทางกู้รายการ)

### SD-D — หน้าลูกค้าของส่วนลดราคา

| ไฟล์ | งาน |
|---|---|
| `apps/web/src/features/billing/BillingPage.tsx` | กล่องตัวเลือก "ใช้ส่วนลด…" (เลือกไว้แล้ว) / "ไม่ใช้ครั้งนี้" เหนือรายการแพ็กเกจ; ส่งค่าเข้า `requestQuote` (`:222`) เมื่อมีข้อเสนอเท่านั้น; บรรทัดบนการ์ดตามตัวเลือก (`:575-603`); ข้อความเหนือรายการแพ็กเกจ (ข้างการ์ดดีล `:532-559`); ขั้นตรวจยอด (`:635-643`): บรรทัดส่วนลด, "ชำระวันนี้" จาก `eventDiscount.applied.totalSatang`, "รอบถัดไปชำระราคาเต็ม", ลิงก์เปลี่ยนตัวเลือกที่ขอ quote ใหม่และล้างการยืนยัน; `:640` ไม่แก้ |
| หน้า return และส่วนประวัติของ billing | ข้อความสเปก §3.6 และแถวประวัติ |
| `apps/web/src/features/billing/billing.api.ts` | `getEventDiscount(companyId)`; `eventDiscountChoice` ใน quote |
| `apps/web/src/features/billing/billing-event-discount.logic.ts` | ค่าเริ่มต้น "ใช้", เลือกข้อความตาม `reason`, จัดรูปจำนวนเงิน (feature-local) |
| `apps/web/src/common/api/api-error-message.ts` | ข้อความรหัส `SALES_EVENT_*` |

เทสต์: web specs (`billing-event-discount.logic.spec.ts`, spec ของ BillingPage — glob รันเอง; ครอบค่าเริ่มต้น "ใช้", เปลี่ยนเป็น "ไม่ใช้", การ์ดไม่มีบรรทัดเมื่อไม่ใช้); ขยาย `api-error-coverage.spec.ts`; e2e `e2e/sales-event-discount.spec.ts` (หัวหน้าสร้างชุด → QR → claim ผ่าน fixture LINE → ร้านล็อกเห็น "ใช้" ถูกเลือกไว้ → ซื้อ CARD_ONCE ลดแล้ว → ประวัติ; อีกรอบเลือก "ไม่ใช้" จ่ายราคาเต็มแล้วใช้กับอีกร้าน; 390 px ด้วย `setViewportSize` แบบ `e2e/billing-admin-directory.spec.ts:74`) → step ใหม่ใน `extended-tests.yml` ต่อจาก step no-setup (`:336`) ใช้ DB `sales_event_discount_test`, พอร์ต 3161/3162, `NEXT_DIST_DIR: .next/sales-event-discount` (ตรวจว่าไม่ชน 3153–3156)

เสร็จเมื่อ: SD-E17, SD-E21–SD-E23 ที่หน้าเว็บ และส่วน UI ของ SD-E15. ประมาณ 2.5–3.5 วัน

**สถานะ SD-C + SD-D แบบ MVP (2026-09-29, branch `claude/sales-event-sd-cd-20260929`)** — ทำแล้วเฉพาะการซื้อจ่ายครั้งเดียว (CARD_ONCE, PROMPTPAY_ONCE) ที่เป็น INITIAL/RESTART: quote รับ `eventDiscountChoice` (ไม่ส่งแต่มีข้อเสนอ = USE) และเก็บ `snapshot.eventDiscount`; `quote.totalSatang` คงราคาเต็ม; Checkout จองรายการหลังสร้าง attempt (version fence, partial unique), stale เมื่อ quote ไม่มีข้อเสนอแต่ตอน Checkout มี, ไม่ stale เมื่อเลือกไม่ใช้; `price_data.unit_amount` เป็นยอดลดแล้ว; reconcile ใช้สิทธิ์ก่อนทางออก HELD และเปิด `EVENT_DISCOUNT_REVIEW` (อ้าง invoice) เมื่อรายการไม่ได้จองให้ attempt นี้; ปล่อยการจองเมื่อ Checkout ล้ม/ถูกปฏิเสธ, session หมดอายุ (รวมปุ่มยกเลิกและการยุติของแอดมิน) และ profile sync ล้ม; `paid-checkout-invoice.ts` รับยอดลดเฉพาะ snapshot ที่คำนวณตรงตามสูตร §5.1 (ใช้สูตรร่วม `eventDiscountUnitAmountSatang` ของ SD-A). หน้าแพ็กเกจอ่านข้อเสนอจาก `BillingStatus.eventDiscount` (route สถานะอยู่ใน allowlist อยู่แล้ว จึงไม่แตะ `auth.guard.ts`/pins); ไม่มี gate ตามมติ Owner (ชุดส่วนลดคือตัวควบคุม)

**TODO ต่อจาก MVP**: CARD_AUTO และ PROMPTPAY_RENEW ด้วยกลไก subscription `trialing` ตามสเปก §5.3 ข้อ 1–6 (`paymentCheckoutSnapshot`, `setup_future_usage`, route ของ reconciler และ `reconcileOriginalInvoice`/`importDiscoveredInvoice`, ข้ามบิล $0, predicate trial ใน `billing-collection.ts`/`billing.service.ts`, `billingPurchaseSource`) แล้วขยาย `EVENT_DISCOUNT_MODES` ทั้งฝั่ง API และเว็บ — วันนี้ quote สองโหมดนี้ไม่มีข้อเสนอ และหน้าเว็บบอกว่าส่วนลดใช้กับการจ่ายครั้งเดียว; ที่ยังไม่ทำ: `eventDiscountSatang` ในประวัติ, ข้อความหมดอายุ/ระงับบนหน้าแพ็กเกจ, smoke HTTP, e2e 390 px, และหลักฐาน PG ระดับ reconcile (paid → USED, RETRY_APPLY, IMPORT_INVOICE)

### SD-F — เครดิตสำหรับร้านเดิม (ใหม่, SD-O6)

ขึ้นกับ: SD-A, SD-B และ P4 (add-on PR B และ PR C). ไม่แตะ quote, checkout, reconciler หรือ Stripe

| ไฟล์ | งาน |
|---|---|
| `apps/api/src/modules/billing/application/billing-event-credit.ts` (ใหม่) | `redeemEventCredit(tx, …)`: ตรวจเงื่อนไขสเปก §4.1.2 (ร้าน ACTIVE, `PAID_CURRENT_MODE` ด้วย `billingPurchaseSource` `billing-purchase-source.ts:8-26`, ไม่อยู่ใน grace, readiness ของสินค้าตาม add-on §8.4/§16 ข้อ 9, ชุดนี้ร้านนี้ยังไม่เคยใช้, ticket ISSUED ไม่หมดอายุ ชุดไม่ SUSPENDED, gate เปิด); lock L1 `partner-ocr-config:{companyId}` → L4 `lockPlanTermCompany` → ticket (`ISSUED → USED`, `redeemedAs = 'CREDIT'`) → `applyAddOnGrant` หนึ่งครั้งต่อสินค้าที่ชุดให้ (`sourceKind 'SALES_EVENT'`, `sourceKey 'sales-event:<ticketId>:<productKind>'`) → audit; `redeemRequestKey` เดิมได้ผลเดิม |
| `apps/api/src/modules/billing/application/billing.service.ts` (method view) | เติมส่วน `credit` ของ `BillingEventDiscountView`: ข้อเสนอเครดิตของผู้ใช้สำหรับร้านนี้, `reason`, `availableFrom` (วันเปลี่ยนรอบของร้านจากเครื่องมือย้ายของ add-on PR G ถ้ามี) |
| `apps/api/src/modules/billing/presentation/billing.controller.ts` + `billing.dto.ts` | `@Post('event-discount/credit')` ใน controller `companies/:companyId/billing` (`:522`) + `BillingEventCreditDto` {ticketSerial, requestKey}; `assertOwner` |
| `packages/contracts/src/billing.ts` | ชนิดผลรับเครดิต (สเปก §7.2) |
| `apps/web/src/features/billing/BillingPage.tsx` + `billing.api.ts` | กล่อง "รับเครดิตเข้าร้านนี้" ใต้การ์ดแพ็กเกจปัจจุบัน (`:399`), สถานะหลังรับ, ข้อความเมื่อยังรับไม่ได้; ลิงก์ไปแท็บเครดิต AI และอ่านรูปของ add-on |
| `apps/api/src/modules/sales-console/application/sales-events.service.ts` | รายการส่วนลดของชุดแสดงการใช้เป็นเครดิต |

เทสต์และที่ลงทะเบียน:
- `apps/api/src/modules/billing/billing-event-credit.pg.spec.ts` (ใหม่) → `ci.yml` Migrations and Boot ต่อจาก บรรทัดของ `billing-event-discount.pg.spec.ts` ด้วย `BILLING_EVENT_CREDIT_TEST_DATABASE_URL="$DATABASE_URL"`: ร้านเดิมบัตร/QR/จ่ายครั้งเดียวรับได้; lot `SALES_EVENT` ของเครดิต AI และรูปพร้อมอายุ 12 เดือนและกลุ่ม "ทีมงาน"; ไม่มี attempt/invoice/การเปลี่ยน term; กดซ้ำและคำตอบหายไม่เพิ่มยอดซ้ำ; ชุดเดียวกันซ้ำถูกกัน; ชุดใหม่รับได้; ร้านที่มีดีลรับได้; ร้านใน grace และร้านที่ยังไม่ย้ายรับไม่ได้; ร้านใหม่ (ยังไม่มีแพ็กเกจ) ไม่มีเส้นทางเครดิต; แข่งกับการจองส่วนลดราคาของรายการเดียวกัน → สำเร็จทางเดียว; พนักงานไม่มีสิทธิ์ 403
- ขยาย `billing-event-discount.logic.spec.ts` (เส้นทางเครดิต) และ e2e `e2e/sales-event-discount.spec.ts` (ร้านเดิมกดรับเครดิตแล้วเห็นยอดเพิ่มเติม)
- ใช้ fixture ของ add-on PR B/C สำหรับ lot และร้านที่ย้ายแล้ว

เสร็จเมื่อ: SD-E25–SD-E30 มีหลักฐาน HTTP/PG และหน้าเว็บ. ประมาณ 2.5–3.5 วัน

### SD-E — รายงานและหน้าจอแอดมิน

| ไฟล์ | งาน |
|---|---|
| `sales-events.service.ts` + controller | `GET /v1/sales/events/report` ตามสเปก §10 (แยกส่วนลดกับเครดิต) ใช้กติกา `visibleAgents` (`sales-reports.service.ts:75`) |
| `apps/web/src/features/sales-console/SalesEventsPage.tsx` | ส่วนรายงานต่องาน/ชุด/เซลล์ |
| หน้าร้านใน `/system/billing/companies/:id` (web billing-admin) | ตารางส่วนลดของร้าน (serial, ชุด, ทาง, สถานะ, บิลหรือ lot) |

เทสต์: เพิ่มกรณีรายงานใน `sales-event-discounts.pg.spec.ts` (ใช้เป็นส่วนลด, ใช้เป็นเครดิต, หมดอายุ, คืนเงิน, นับบิลละครั้ง); web spec. ขึ้นกับ SD-C และ SD-F. เสร็จเมื่อ SD-E18, SD-E20. ประมาณ 1–2 วัน

### ประมาณการรวม

| ส่วน | วันทำงาน |
|---|---:|
| SD-A | 3–4 |
| SD-B | 1.5–2 |
| SD-C | 4.5–6.5 |
| SD-D | 2.5–3.5 |
| SD-F | 2.5–3.5 |
| SD-E | 1–2 |
| native proof + UAT ส่วนของงานนี้ | 2–3 |
| **รวม** | **17–24.5** |

ไม่รวม P1/P2/P4, งานของ add-on, เวลารอรีวิว/CI, การรอคิวไฟล์ร่วม และ release window ร่วม. เส้นทางวิกฤตคือ add-on PR A → PR B/C → SD-F และ PR A → SD-C → UAT test clock ของ CARD_AUTO; release จริงรอ add-on PR A–G ครบด้วย

## 3. งานข้ามทุก PR (แบบ xx-cross-cutting)

### 3.1 ลงทะเบียนเทสต์ (ห้ามแตะ `package.json`)

`apps/api/src/spec-suite-coverage.spec.ts:43-75` ทำให้ CI แดงเมื่อ `*.spec.ts` ของ API ไม่ถูกเอ่ยชื่อใน `apps/api/package.json`, catalog, `ci.yml` หรือ `extended-tests.yml` (ยกเว้น `*.pg.spec.ts` ที่ไม่รันเองเลย จึงต้องมีบรรทัดของตัวเอง). ห้ามใส่ชื่อไฟล์ที่ยังไม่มี

| ไฟล์ | PR | ลงทะเบียนที่ |
|---|---|---|
| `sales-console/domain/sales-event.logic.spec.ts` | SD-A | catalog `api-behavior` (`:413`) |
| `sales-console/sales-event-discounts.pg.spec.ts` | SD-A (ขยายใน SD-B, SD-E) | `ci.yml` ต่อจาก `:778` |
| `sales-console/application/claim-event-discount.use-case.spec.ts` | SD-B | catalog |
| `common/security/liff-event-discount-page.spec.ts` | SD-B | catalog |
| `billing/domain/billing-event-discount.logic.spec.ts` | SD-C (ขยายใน SD-F) | catalog |
| `billing/billing-event-discount.pg.spec.ts` | SD-C | `ci.yml` ต่อจาก `:782` |
| `billing/billing-event-credit.pg.spec.ts` | SD-F | `ci.yml` ต่อจากบรรทัดของ `billing-event-discount.pg.spec.ts` |
| `scripts/billing-event-discount-smoke.ts` | SD-C | selector `BILLING_EVENT_DISCOUNT_ONLY` + `extended-tests.yml` ต่อจาก `:292` |
| `e2e/sales-event-discount.spec.ts` | SD-D (ขยายใน SD-F) | step ใหม่ใน `extended-tests.yml` ต่อจาก `:336` |
| contracts spec (ถ้ามี) | — | `ci.yml:543` เท่านั้น (`packages/contracts/package.json` เป็นรายการตายตัว) |

Spec ที่ขยายเนื้อหาอยู่ในที่เดิมแล้ว: `paid-checkout-invoice.spec.ts`, `billing-collection.spec.ts`, `billing-admin-lookup.spec.ts`, `liff-start-handoff.spec.ts` (catalog); `auth.guard.spec.ts`, `permission-registry.spec.ts` (`apps/api/package.json` เดิม ไม่แก้รายการ); `billing-purchase-source.pg.spec.ts` (`extended-tests.yml:286`)

หลักฐาน PG/smoke/e2e ที่ไม่อยู่ใน release gate มาจาก Extended Tests (workflow_dispatch) บน branch ของ PR — บันทึก run id ใน memory ของงาน

### 3.2 Pins

`auth.guard.ts` ถูก pin (`infra/security/validate-production-maintenance-release.sh:25` `expected_auth_guard`, ตรวจที่ `:106`). PR SD-C ต้องทำในตัวเอง:

```bash
node infra/security/sync-production-maintenance-release-pins.mjs          # เขียน expected_* ใน validator และ EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256 ใน .github/workflows/deploy-production.yml:421
node infra/security/sync-production-maintenance-release-pins.mjs --check  # ต้อง exit 0
bash infra/security/validate-production-maintenance-release.spec.sh
bash infra/security/sync-production-maintenance-release-pins.spec.sh
git add infra/security/validate-production-maintenance-release.sh .github/workflows/deploy-production.yml
```

CI ตรวจที่ `ci.yml:322-323`, `:401` และ `:604`. ถ้า add-on แก้ allowlist ก่อนหรือหลัง PR ที่ merge ทีหลังต้อง sync ใหม่. SD-F ไม่แก้ allowlist. ไฟล์ pin ที่งานนี้ **ห้ามแตะ**: `auth.module.ts` (SD-B import AuthModule ฝั่ง sales-console แทน), `email-access.service.ts`, `refresh-session.use-case.ts`, login/session-gate/layout ของเว็บ, `packages/config/src/index.ts` (ไม่มี env ใหม่), บรรทัด literal ใน `audit-action.ts` และ `schema.prisma`

### 3.3 ความตรงกันของ workflow กับ main

SD-A, SD-C, SD-D และ SD-F แก้ `ci.yml` หรือ `extended-tests.yml`. ก่อน dispatch UAT `all` ต้องให้สองไฟล์บน main ตรงกับ candidate byte ต่อ byte (`deploy-uat.yml` เทียบ blob ของ `ci.yml`): merge develop → twin PR ไป main → ตรวจ `git rev-parse <candidate>:.github/workflows/ci.yml` เทียบ `git rev-parse origin/main:.github/workflows/ci.yml` (และ `extended-tests.yml`). ระหว่าง READY → Production ห้ามแตะ main

### 3.4 Migrations

- หนึ่ง migration ใน SD-A: `apps/api/prisma/migrations/<ts>_sales_event_discounts/migration.sql`. `<ts>` ต้องมากกว่าตัวล่าสุดบน develop ตอนลงมือ — develop `105b0dc6` จบที่ `20260929030000_email_verification_billing_recipient_proof_kind` — และหลัง migration ของ add-on PR A–C ที่ merge ก่อน (แผน add-on §3.4: `billing_product_foundation`, `receipt_unit_entries`, `ai_credit_ledger`). SD-F ไม่มี migration (ใช้ตารางของ add-on)
- additive เท่านั้น: `CREATE TABLE`, `CREATE INDEX`, `CREATE UNIQUE INDEX … WHERE` (ไม่ใช้ `CONCURRENTLY` เพราะ migration อยู่ใน transaction); ห้าม `DROP/TRUNCATE/DELETE` (`apps/api/prisma/verify-applied-migration-catalog.ts` ปฏิเสธ)
- ไม่มี Prisma enum; ค่าคงที่ใน contracts ตั้งชื่อไม่ชน enum (`prisma-enum-parity.spec.ts`)
- CI: `prisma:validate` → `migration:review` → fresh `migrate deploy` → PG specs → `test:boot` (`ci.yml:785`); PG spec ต้องเขียนและอ่านทุกคอลัมน์ใหม่เพราะไม่มีอะไรเทียบ migration กับ schema
- production: migration ค้าง → READY ต้องเดินเส้นทาง `APPEND_ONLY_PENDING` ตาม runbook

### 3.5 Contracts, DI, boot และ Release Contracts

- build `@watchdog-bms/contracts` ก่อน typecheck และเทสต์; web อ่าน contracts จาก `dist` จึงต้อง build ก่อน typecheck ของ web; API typecheck ใช้ script ของ package (มี heap flag) และอ่าน exit code จริง
- class `@Injectable()` ใหม่ทุกตัวประกาศ constructor เอง (`apps/api/scripts/check-di-metadata.mjs`, `ci.yml:468-470`); provider ใหม่อยู่ใน `providers` ของ module; `test:boot` จับ import วน
- ทุก body ใหม่เป็น class DTO (`body-validation-coverage.spec.ts`)
- งานนี้แตะ `infra/` (pins) และ `.github/` จึงเปิด job Release Contracts ตามปกติ; ห้ามเพิ่มอะไรใน `packages/contracts/src/line-ai.ts`

### 3.6 W00 manifest

`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts` hash ไฟล์ชุดหนึ่ง รวม `packages/config/src/index.ts`, `packages/contracts/src/{ai-tools,feature-entitlements,line-ai,menu-entitlements}.ts`, `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` และ `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`. แผนนี้ไม่แตะไฟล์เหล่านั้น (ไม่มี env ใหม่ ไม่มีข้อความ LINE ไม่มี AI tool; SD-F เรียก seam ของ add-on ฝั่ง billing) จึงไม่ต้อง regenerate. ถ้า PR ใดต้องแตะ ให้ regenerate และรีวิว manifest ใน PR เดียวกัน (`line-ai-capability-manifest.spec.ts`)

### 3.7 Readbacks ก่อน UAT (และซ้ำก่อน production)

| รายการ | วิธีอ่าน | ค่าที่ต้องเป็น |
|---|---|---|
| gates | `GET /v1/system/billing/settings` → gates | UAT: `event_discounts`, `addon_chat_credit`, `addon_receipt_image` เปิดพร้อมกันระหว่างทดสอบ; production: ปิดทั้งสามจนถึงขั้น §3.10 |
| candidate ร่วม | SHA ของ candidate | มีทุก PR ของงานนี้และ add-on PR A–G |
| `salesCompanyIds` | policy ที่ ACTIVE | `null` ทั้ง UAT และ production |
| taxTreatment | policy ที่ ACTIVE | UAT = production (`NOT_VAT_REGISTERED`) |
| `LINE_LIFF_ID` และ endpoint ของ LIFF app | task env ตาม runbook cloud; LINE Developers console | ตั้งค่าแล้ว; endpoint = `…/v1/auth/line/link-page` |
| `LINE_WEB_HANDOFF_ENABLED` | task env | `true` (ปุ่ม "เปิดมั่งมี" ใช้ handoff) |
| ร้านเดิมที่ย้ายไปรอบเครดิตใหม่ | readback ของ add-on PR G | จำนวนร้านที่จ่ายเงินแล้วแต่ยังไม่ย้าย (กำหนดวันจัดงานแรก, SD-Q9) |
| webhook ของ Stripe | Stripe dashboard ของแต่ละ environment | ไม่ต้องเพิ่ม event ใหม่ — ยืนยันว่าไม่มีใครเพิ่ม `invoice.created` โดยคิดว่าจำเป็น |
| permission ใหม่ | หลัง release task ที่รัน `prisma/sync-permissions.ts` (`run-release-task.sh:684`) | role หัวหน้ามี `sales.event.manage` |
| pins | `node infra/security/sync-production-maintenance-release-pins.mjs --check` | exit 0 |
| workflow parity | `git rev-parse` ตาม §3.3 | ตรงกับ main |
| เงื่อนไข rollback | query รายการ RESERVED และบัญชี CARD_AUTO ที่รอผูก (สเปก §11) | รู้ค่าก่อนทุก deploy/rollback |

### 3.8 Native proof

ตามตารางสเปก §14 — แต่ละข้อต้องมีผลใน UAT (test mode) ก่อนเปิด gate บน production. CARD_AUTO ใช้ Stripe test clock เลื่อนถึงสิ้นงวดแรก. เส้นทางเครดิตไม่ต้องใช้ Stripe. ไม่สร้าง provider object นอกขั้นตอน UAT ที่รีวิวแล้ว

### 3.9 UAT checklist (Stripe test mode; ทำตาม runbook; บันทึก UAT, READY และ Production run ID ของ release ร่วม)

| # | ขั้น | ผ่านเมื่อ |
|---|---|---|
| U1 | readbacks §3.7 | ครบทุกข้อ |
| U2 | หัวหน้าสร้างชุด 2 เซลล์ (ส่วนลด + เครดิต AI + รูป); เซลล์ที่ไม่ได้รับมอบหมายเปิด QR ไม่ได้; QR หมดใน 5 นาที | ตรงสเปก §3.1–§3.2 |
| U3 | คนแรกสแกนด้วย LINE จริง (iPhone และ Android) → รับได้; สแกนซ้ำได้รายการเดิม; บัญชีทีมขายสแกนถูกปฏิเสธ; พนักงานร้านเห็นข้อความ §3.5 | ตรง §3.3/§3.5 |
| U4 | ผู้รับที่ยังไม่มีบัญชี → "เปิดร้านใหม่" ผ่าน LIFF → ร้าน "ยังไม่มีแพ็กเกจ" → "ใช้" ถูกเลือกไว้ → CARD_ONCE รายเดือน → จ่าย → apply → ปลดล็อกในที่ | ส่วนลด USED; ประวัติแสดงยอดจริง; ใบเสร็จ Stripe แสดงราคาสุทธิไม่มีบรรทัดส่วนลด |
| U5 | ผู้ถือเลือก "ไม่ใช้ครั้งนี้" ที่ร้าน A → จ่ายราคาเต็ม → ไปซื้อครั้งแรกของร้าน B เลือก "ใช้" | ร้าน A ราคาเต็มไม่ stale; ร้าน B ลด; ร้าน A ยังไม่นับว่าใช้ส่วนลดราคาแล้ว |
| U6 | PROMPTPAY_ONCE และ PROMPTPAY_RENEW ที่เลือกใช้ | บิล QR แรกลด; บิล QR รอบถัดไปราคาเต็ม |
| U7 | CARD_AUTO ที่เลือกใช้ + test clock | จ่ายงวดแรกลด; subscription `trialing` ราคาเต็ม; "หยุดต่ออายุ" ระหว่างงวดแรกได้ (อีกร้าน); บิลรอบสองราคาเต็ม apply เป็น RENEWAL; บัตรปฏิเสธหลัง trial → grace เริ่ม |
| U8 | ร้านหมดอายุ (RESTART) ลดได้; ร้านที่แพ็กยังใช้งานไม่มีตัวเลือกส่วนลดแต่มีกล่องรับเครดิต; การซื้อ add-on ไม่ลด และ checkout add-on ที่ค้างไม่บล็อกการซื้อแพ็กเกจที่ใช้ส่วนลด | ตรง §4.1 |
| U9 | ร้านที่มีดีล APPROVED (ยังไม่มีแพ็กเกจ) | ไม่มีตัวเลือก + ข้อความ "มีดีลพิเศษอยู่แล้ว"; อนุมัติดีลระหว่าง quote ที่เลือกใช้กับ Checkout → stale |
| U10 | ร้านเดิม (บัตร, QR, จ่ายครั้งเดียว และร้านที่มีดีลที่กำลังใช้) กด "รับเครดิตเข้าร้านนี้" | lot `SALES_EVENT` อยู่ใน "ยอดเพิ่มเติม" ของแท็บเครดิต AI และอ่านรูป อายุ 12 เดือน; ใช้เครดิต AI ใน LINE ได้; ไม่มีใบแจ้งหนี้; กดซ้ำไม่เพิ่ม |
| U11 | รายการที่สองจากชุดเดียวกันที่ร้านเดิม; รายการจากชุดใหม่ที่ร้านเดิม; ผู้ถือดูแลสองร้านเดิมรับที่ร้านที่เลือก | ชุดเดิมถูกกัน; ชุดใหม่รับได้; อีกร้านไม่เห็นรายการที่ใช้แล้ว |
| U12 | ร้านที่ยังไม่ย้ายไปรอบเครดิตใหม่ และร้านในช่วง grace | ไม่มีปุ่มรับ; ข้อความตามเหตุ; ส่วนลดยัง ISSUED |
| U13 | หนึ่งร้านต่อส่วนลดราคา: ผู้ถือคนที่สองของร้านเดิมหลัง USED ไม่มีตัวเลือก; ผู้ถือคนเดียวเลือกใช้สองร้านพร้อมกัน → ร้านที่สอง stale | ตรง §4.3 |
| U14 | กดกลับจาก Stripe, ปุ่มยกเลิก, session หมดอายุ | รายการกลับเป็นใช้ได้; UNKNOWN คงการจอง |
| U15 | คืนเงินบางส่วนและทั้งหมดของบิลที่ลด; CARD_AUTO: หยุดต่ออายุแล้วยุติแพ็กระหว่างงวดแรก | ยอดคืนถูก; รายการยัง USED; รายงานหักคืน |
| U16 | แอดมิน: ค้นเลขส่วนลด; ใบที่ถูกถือไว้ → RETRY_APPLY หรือ IMPORT_INVOICE apply ได้; REVOKE lot เครดิตที่ให้ผิดตามกลไก add-on | ตรง SD-E11/SD-E20 |
| U17 | ปิด `event_discounts` | claim ถูกปฏิเสธ; quote ไม่มีตัวเลือก; ปุ่มรับเครดิตปิด; รายการที่จองแล้วและ lot ที่ให้แล้วเดินต่อ; ซ้อมเงื่อนไข rollback §11 |
| U18 | Extended Tests run id (PG, smoke, e2e) | บันทึกใน memory |

### 3.10 Production acceptance ของ release ร่วม (ภายในประมาณ 5 นาทีหลัง website-ready)

1. Readbacks §3.7 ซ้ำ (gate ทั้งสามยังปิด)
2. Owner เปิด `event_discounts`, `addon_chat_credit`, `addon_receipt_image` ในขั้นเดียวผ่าน SET_ACTION_GATE ที่รีวิวแล้ว; หัวหน้าสร้างชุดเล็ก (จำนวนแจก 2, มีทั้งส่วนลดและเครดิต)
3. สแกนรับด้วย LINE จริงสองบัญชี: บัญชีแรกกับร้านทดสอบภายในที่ "ยังไม่มีแพ็กเกจ" → "ใช้" → ซื้อ STARTER รายเดือนราคาจริง → apply → ตรวจใบเสร็จ ประวัติ และรายงานงาน; บัญชีที่สองกับร้านทดสอบภายในที่มีแพ็กเกจ → "รับเครดิตเข้าร้านนี้" → ตรวจยอดเพิ่มเติม
4. คืนเงินการซื้อในแอปตามขั้นตอนเดิม → รายการยัง USED และรายงานหักคืน; ถอน lot เครดิตทดสอบด้วย REVOKE ของ add-on
5. ทำ acceptance ของ add-on ตามแผน add-on §6 ใน release เดียวกัน แล้ว Owner ตัดสินว่าจะคง gate เปิดหรือปิด; บันทึกตาม runbook (UAT/READY/Production run ID, signed result, customer `OPEN`) — ไม่เรียกว่า live จนกว่าทั้งสองผ่าน

### 3.11 แก้เอกสารอื่น

| ไฟล์:บรรทัด | แก้เป็น | เมื่อ |
|---|---|---|
| `docs/specs/chat-credit-and-receipt-addons-spec-th.md` §6.1, §8.2, §16, §19 | แหล่งยอด `SALES_EVENT`, ทางเข้าของผู้ถือส่วนลด, release ร่วม | **ทำแล้วรอบนี้** |
| `docs/plans/chat-credit-and-receipt-addons-plan-th.md` §1, PR B, PR C, §5 | release ร่วม, `SALES_EVENT` ใน seam และตัวจัดสรร, candidate ร่วม | **ทำแล้วรอบนี้** |
| `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md:30` (§4) | กติกาเดิมคงไว้; เพิ่มอ้างอิงว่า "ส่วนลดราคาจากงานไม่ใช้กับดีลและไม่มี coupon; ร้านที่มีดีลรับเครดิตจากงานได้ (sales-event-discounts SD-O1/SD-O2/SD-O8, 2026-09-29)" | SD-C |
| `docs/plans/mangmee-sales-deals-and-locked-signup-plan-th.md:19,83` | กติกา "ห้ามแตะ `paid-checkout-invoice.ts`" เพิ่มข้อยกเว้นเฉพาะยอดที่คาดหวังของส่วนลดจากงาน `:22-23` | SD-C |
| `docs/runbooks/uat-production-v2-deployment.md` (หรือ runbook billing) | readbacks §3.7, release ร่วม และเงื่อนไข rollback สเปก §11 | SD-C |
| `docs/plans/mangmee-master-plan-index-th.md` | แถวของงานนี้และสถานะ | ทุก PR |
| `docs/agent-memory/sales-event-discounts-<date>.md` | สร้าง memory (Status/Verification/Next + run ID) | PR แรก |
| `docs/specs/mangmee-owned-billing-integration-spec-th.md:76` (B01/B08) | ไม่ต้องแก้ — ไม่มี invoice ที่มี coupon | — |

### 3.12 Release และ rollback

- ลำดับปล่อย: release ร่วมครั้งเดียวกับ add-on (§1); PR ที่ merge ก่อนต้อง gate ปิด
- ก่อน dispatch UAT: readbacks §3.7, workflow parity §3.3, ไม่มี run ของ flow เดียวกันค้าง (runbook)
- Rollback ตามสเปก §11: migration additive; ต้องไม่มีรายการ RESERVED และไม่มีบัญชี CARD_AUTO ที่รอผูก; ไม่เช่นนั้นปิด gate รอหรือ forward-fix; และอยู่ใต้กติกาถอยกลับของ add-on (ห้ามถอยไป binary ที่ไม่รู้จัก lot, add-on §11.4); บันทึกผลที่ binary เก่าทำให้ "หยุดต่ออายุ" ระหว่างงวดแรกใช้ไม่ได้ชั่วคราว

## 4. ผลรีวิว R2 → การปิด

รีวิว `R2-sales-event-discounts-report.md` (41 ข้อ) เทียบกับมติ 2026-09-29:

| ID | ระดับ | ผล | ปิดอย่างไร / อยู่ที่ |
|---|---|---|---|
| SED-01 | BLOCK | ไม่เกิดแล้ว | SD-O1: ไม่มีส่วนลดบน subscription จึงไม่มี arming; guard ไม่แตะ (สเปก §5.4); predicate trial ของ CARD_AUTO งวดแรกเป็นงานใน SD-C ไม่ใช่ guard ของ discount |
| SED-02 | BLOCK | ไม่เกิดแล้ว | รอบต่ออายุราคาเต็ม; `snapshot.quote` เป็นราคาเต็ม ส่วนลดแยกใน `eventDiscount` จึง `enforceGrace` ไม่แตะ (§5.4); UAT U7 |
| SED-03 | BLOCK | ปิด | SD-T1: `/event-discount` ใน allowlist + pins + `auth.guard.spec.ts` (SD-C, §3.2) |
| SED-04 | BLOCK | ไม่เกิดแล้ว | SD-O2: ส่วนลดราคาไม่ซ้อนดีล; `billing-package-request.ts` ไม่เปลี่ยน; เครดิตไม่มีราคาจึงไม่กระทบ attribution (SD-O8) |
| SED-05 | HIGH | ปิด | ยอดที่คาดหวังอยู่ใน snapshot ของ attempt ทุกทางตรวจซ้ำจึงได้ผลเดียวกัน (สเปก §5.2); `paid-invoice.ts` ไม่แตะ; smoke เดิมไม่แก้ + smoke ใหม่ |
| SED-06 | HIGH | ปิด | audit มีส่วน "ตรวจซ้ำบน develop 8a91bc1c"; anchor ในสเปก/แผนตรวจใหม่บน `105b0dc6` |
| SED-07 | HIGH | ปิด | SD-O1: ไม่มี coupon ทุกโหมด; `unit_amount` ทั้งสี่โหมด; ไม่ต้องแก้ sales-deals §4 หรือ owned-billing B01/B08 |
| SED-08 | HIGH | ปิด | SD-O3/SD-O7: ผูกผู้ถือตอนสแกน ใช้ได้หลังสมัคร; สถานะร้านตอนใช้เลือกเส้นทาง |
| SED-09 | HIGH | ปิด | gate ใน `BILLING_ACTIONS`, ขั้นต่ำเป็นค่าคงที่ในโค้ด, ไม่มี key ใน `policyJson`; validator ไม่ขึ้นกับ gate; เงื่อนไข rollback (สเปก §11) |
| SED-10 | HIGH | ไม่เกิดแล้ว | ไม่มี selection/target ที่เก็บไว้; ตัวเลือก `eventDiscountChoice` เป็นค่าของ quote ครั้งนั้น; quote pin `ticketId` + `ticketVersion`; ไม่ใช้ชื่อ `purchaseIntent` |
| SED-11 | HIGH | ปิด | §3 ของแผนนี้ |
| SED-12 | HIGH | ปิด | V1 ไม่มีข้อความ LINE หรือการแจ้งเตือนใหม่; การ์ดโปรโมชั่นและนโยบายสาธารณะคงราคาปกติ; SD-Q5 |
| SED-13 | HIGH | ปิด | SD-T2 ลำดับ §1, ตารางไฟล์ร่วม และ release ร่วม |
| SED-14 | MEDIUM | ปิด | scope = tiers + intervals ของส่วนลดราคา; purchase kind ตายตัว (SCHEDULED_CHANGE ลดไม่ได้ตามค่าเริ่มต้น SD-Q2); ขั้นต่ำตรวจตอนเผยแพร่และ quote; helper เดียวกับ quote |
| SED-15 | MEDIUM | ไม่เกิดแล้ว | ไม่มี selection ก่อนมี BillingAccount; จองใน transaction ที่สร้าง account (`billing.service.ts:613`); ไม่แตะ `BillingAccount.version` |
| SED-16 | MEDIUM | ปิด | ผูกกับ attempt ของแพ็กเกจหลัง foundation (P2); ไม่มีแท็บ; validator ของ add-on แยก |
| SED-17 | MEDIUM | ปิด | QR ไป LIFF ที่ไม่ผูกร้าน; เฉพาะผู้มีสิทธิ์จัดการแพ็กเกจที่เป็นผู้ถือ; พนักงานเห็นคำแนะนำบน LIFF (สเปก §3.5) |
| SED-18 | MEDIUM | ปิด | checkbox + ค้นหา server ในฟีเจอร์; `datetime-local` + `+07:00`; ตัดข้ออ้างว่ามีของกลางให้ใช้ซ้ำ |
| SED-19 | MEDIUM | ปิด | ตารางสิทธิ์สเปก §9; key ใหม่ใน contracts/registry/grant/spec; sync permissions ใน release task |
| SED-20 | MEDIUM | ปิด (แคบลง) | ไม่มี provider arming จึงไม่ต้องมีคำสั่ง arm/detach; การปล่อยตาม lifecycle ของ attempt เดิม; ค้นเลขส่วนลด, ตารางบนหน้าร้าน, issue `EVENT_DISCOUNT_REVIEW`; lot เครดิตถอนด้วย REVOKE ของ add-on |
| SED-21 | MEDIUM | ปิด | บรรทัดการ์ดคำนวณโดย server และแสดงตามตัวเลือก; `quote.totalSatang` ราคาเต็มทำให้ `BillingPage.tsx:640` ถูก; รอบต่ออายุไม่ลดจึงไม่มียอดขัดกัน |
| SED-22 | MEDIUM | ไม่เกิดแล้ว | ไม่มีส่วนลดรอบต่ออายุ |
| SED-23 | MEDIUM | ไม่เกิดแล้ว | การจองอยู่แค่ช่วง Checkout ไม่ผูกบิลต่ออายุ |
| SED-24 | MEDIUM | ไม่เกิดแล้ว | ไม่มี coupon; บิล $0 ของ trial ข้ามตามแบบเดิม (สเปก §5.3 ข้อ 4) |
| SED-25 | MEDIUM | ปิด | บรรทัดแสดงว่าราคาบนการ์ดลดลงเท่าไร; ไม่มี "ก่อน VAT"; เอกสาร Stripe ไม่มีชื่องานหรือบรรทัดส่วนลด |
| SED-26 | MEDIUM | ปิด | ข้อความ gate อีเมล/ที่อยู่ที่ถูกถอดไปแล้วถูกลบ; ลิงก์ purchase-without-setup; §3.11 |
| SED-27 | MEDIUM | ไม่เกิดแล้ว | ไม่มีการย้ายส่วนลดจากรอบต่ออายุมาการซื้อ |
| SED-28 | MEDIUM | ไม่เกิดแล้ว | ไม่ต้องรับ `invoice.created`; readback ยืนยัน |
| SED-29 | MEDIUM | ปิด | ทดสอบจริงเฉพาะ NOT_VAT (production วันนี้); แบบ VAT ด้วย unit test + native proof ก่อนจด VAT (สเปก §11, §14) |
| SED-30 | MEDIUM | ปิด | สเปก §7.1–§7.3 |
| SED-31 | LOW | ปิด | ตาราง state ต่อชั้น (สเปก §6.2–§6.3); ฟิลด์ `…Satang`; รหัสมี prefix; ไม่มี `MINIMUM_NOT_MET` |
| SED-32 | LOW | ปิด | prefix `SD-` ทุกชุด |
| SED-33 | LOW | ปิด | ลิงก์ LIFF แบบ `buildLineLinkPackage`; เก็บ hash; request log ไม่บันทึก query; claim ต้องมี LINE token ที่ตรวจแล้ว |
| SED-34 | LOW | ปิด | SD-O3: หมดอายุ = ปิดรับ + 30 วัน (SD-Q1); ส่วนลดราคาครั้งเดียวต่อร้าน (SD-O5); รายงานภาระคงค้าง |
| SED-35 | LOW | คงเดิม (มีก่อนแล้ว) | ดีลไม่ลดราคา จึงไม่รับช่วงปัญหานี้; ต้องแก้ก่อนจด VAT ตามงาน billing เดิม |
| SED-36 | LOW | ไม่เกิดแล้ว | ไม่มีบรรทัดส่วนลดบนใบ; การคืนเงินแบบ EXCLUSIVE ที่ปิดไว้อยู่แล้วเป็นเรื่องเดิม |
| SED-37 | LOW | ปิด | state machine ของชุด (สเปก §6.2); แสดง "ปิดรับ {วันเวลา}"; แปลงเวลา `+07:00` |
| SED-38 | LOW | ไม่อยู่ในขอบเขต | ไม่มี dropdown ของลูกค้า; ถ้าฟอร์มหัวหน้าใช้ ThemedSelect แล้วเจอกรณีเปิดแล้วถูกปิดใช้ ให้แยกงาน |
| SED-39 | LOW | ปิด | ส่วนลดเต็มบาทเท่านั้น |
| SED-40 | LOW | ปิด | SD-O4: ตัวเลือกต่อการซื้อเป็น radio สองข้อที่มีข้อความชัด ("ใช้ส่วนลด…" เลือกไว้แล้ว / "ไม่ใช้ครั้งนี้") ไม่ใช่ปุ่ม toggle ที่เก็บ selection; ไม่ใช้คำ "ใช้แล้ว" ใกล้ปุ่ม; หน้า return "ส่วนลดจะถูกใช้เมื่อยืนยันการชำระ" |
| SED-41 | LOW | ปิด | ปล่อยที่ `billing.service.ts:763-770` และ `billing-reconciler.service.ts:494-504`; UNKNOWN คง; USED ก่อน `:557` และ HELD `:592-599`; สูตร `evidenceHash` เดิมใช้ยอดที่ลดแล้วคงที่ต่อ attempt |

## 5. สถานะ

| ขั้น | สถานะ |
|---|---|
| D0 มติ UI เดิม (section/toggle/3 แถว) | ถูกแทนที่ด้วยมติ 2026-09-29 (สเปก §1.3) |
| D1 audit บน 4a5817b4 | เป็นประวัติ; ตรวจซ้ำบน develop แล้วใน audit |
| D2 ปรับเดโม | ยกเลิก — เดโมไม่อยู่ใน repo และแบบใหม่ไม่มีหน้าจอสะสม/เลือก |
| รอบเอกสาร 2026-09-29 (v2) | spec, plan, audit ปรับตามมติและรีวิว R2 (merge #862) |
| รอบเอกสาร 2026-09-29 (v3) | ตัวเลือกใช้/ไม่ใช้ (SD-O4), หนึ่งครั้งต่อร้าน (SD-O5), เครดิตร้านเดิม (SD-O6), QR เดียว (SD-O7), ดีลรับเครดิตได้ (SD-O8), release ร่วม; anchor ตรวจใหม่บน `105b0dc6`; สเปก/แผน add-on เพิ่ม `SALES_EVENT` และ release ร่วม |
| SD-A … SD-F | ยังไม่เริ่ม; รอ P1, P2, P4 (P3 เสร็จ 2026-09-29: Owner รับค่าเริ่มต้นของ SD-Q ที่เหลือ) |

ไม่ได้รันเทสต์ในรอบนี้ (งานเอกสาร). ตอนลงมือให้รันเทสต์ที่ระบุใน §2 บน worktree ของ develop ล่าสุด
