# Plan: ส่วนลดจากงานขาย — ลดบิลแรกจาก QR ในงาน

ปรับล่าสุด 2026-09-29 · **แบบพร้อมลงมือหลัง prerequisite §1; ยังไม่เริ่ม implement และยังไม่มีสิทธิ์ deploy**

[Spec](../specs/sales-event-discounts-spec-th.md) · [Audit และผลตรวจซ้ำบน develop](../research/sales-event-discounts-e2e-impact-audit-2026-09-29-th.md) · [แบบของงานข้ามทุก PR](purchase-without-setup/xx-cross-cutting.md) · [Runbook deploy](../runbooks/uat-production-v2-deployment.md) · [Runbook cloud](../runbooks/cloud-environment-operations.md). Memory ของงานนี้ยังไม่มีใน repo (ลิงก์ของ DRAFT v1 ไม่มีไฟล์).

ฐานที่ตรวจ: develop `8a91bc1c` และ `origin/develop` `69fba9d3`. ทุก `file:line` ตรวจกับไฟล์จริงแล้ว; ตอนลงมือให้ตรวจ anchor ซ้ำบน develop ล่าสุดก่อนแก้ (แบบ xx-cross-cutting §2.1). หลังรีวิว develop ได้งานแก้ของโปรแกรมซื้อแพ็กเกจ (#860, develop `9130455a`) ซึ่งทำให้บรรทัดในไฟล์ billing/LINE/หน้าเว็บแพ็กเกจหลายไฟล์เลื่อน (ประมาณ 3 ใน 4 ของที่อ้างในไฟล์เหล่านั้น) — ก่อนลงมือแต่ละ PR ให้ตรวจ anchor ซ้ำบน develop ล่าสุด. รหัส SD-O/SD-T/SD-Q/SD-E อยู่ในสเปก

## 0. ส่งมอบอะไร และไม่ทำอะไร

ส่งมอบ: ชุดส่วนลดและการมอบหมายในคอนโซลทีมขาย, QR 5 นาที, รับส่วนลดผ่าน LINE (LIFF), ลดบิลแรกของการซื้อที่เริ่มแพ็กเกจใหม่ใน 4 โหมด โดยไม่มี coupon, การจอง/ใช้/ปล่อยสิทธิ์ที่ผูกกับ attempt ของแพ็กเกจ, บรรทัดราคาบนหน้า billing, รายงานทีมขาย, การค้นหาของแอดมิน

ไม่ทำ: ลดรอบต่ออายุ, แก้ guard ของการต่ออายุหรือ grace, coupon/promotion code, ส่วนลดกับดีลหรือ add-on, แท็บใหม่บนหน้า billing, แจ้งเตือน LINE/อีเมล (SD-Q5), แก้ `package.json`, env ใหม่, key ใหม่ใน `policyJson`, AI tool

รอบเอกสารนี้แก้เฉพาะ spec, plan และ audit. ไม่มีโค้ด ไม่มี schema ไม่เรียก provider ไม่ deploy

## 1. ลำดับงานและ prerequisite (SD-T2)

```
P1 งานแก้ purchase flow ที่กำลังทำ ─> P2 ฐาน billing ร่วม (foundation) ─┬─> ฟีเจอร์ add-on (ตามแผน add-on)
                                                                    └─> SD-A ─> SD-B ─> SD-C ─> SD-D ─> SD-E ─> native proof + UAT ─> Production
P3 คำตอบ Owner SD-Q1–SD-Q6 (หรือยอมรับค่าเริ่มต้น) ─────────────────────────> ต้องมีก่อนเริ่ม SD-C
```

| ID | Prerequisite | ทำไมส่วนลดต้องรอ |
|---|---|---|
| P1 | งานแก้ purchase flow ที่กำลังทำ: สถานะหลังกลับจาก Stripe, ปลดล็อก WorkspaceLayout, แผงผู้รับเอกสาร, label, ลิงก์ค้นหาแอดมิน, sync ข้อมูลร้านไป Stripe, คำศัพท์ | แก้ `BillingPage.tsx`, หน้า return และข้อความชุดเดียวกับที่ SD-D แก้; ข้อความของสเปกนี้ใช้คำศัพท์ชุดนั้น |
| P2 | Foundation ตามสเปก add-on (T-02, T-07): `BillingAttempt.productKind` และ `BillingInvoice.productKind` (`String @default("PACKAGE")`), ช่องจอง `BillingAccount.activeAddOnAttemptId` แยกจาก `activeAttemptId`, reader ของแพ็กเกจกรอง PACKAGE | การจองส่วนลดผูกกับ attempt ของแพ็กเกจใน `activeAttemptId` เท่านั้น; ถ้า checkout ของ add-on ใช้ช่องเดียวกัน quote แพ็กเกจจะถูกบล็อก (`billing.service.ts:345`) และสถานะ "กำลังชำระ" จะผิด (SED-16); validator ของ add-on ต้องปฏิเสธ `eventDiscount` |
| P3 | คำตอบ Owner SD-Q1–SD-Q6 หรือยอมรับค่าเริ่มต้นในสเปก §12 | กติกาวันหมดอายุ, RESTART, เครดิตยอดขาย และหนึ่งรายการต่อร้าน กำหนดโค้ดของ SD-C |

การทำงานคู่กับ add-on: SD-A และ SD-B ไม่แตะไฟล์ billing จึงพัฒนาคู่ขนานกับ add-on ได้ แต่ merge หลัง P2. SD-C และ SD-D แตะไฟล์ร่วมกับ add-on — ทีละ PR ต่อไฟล์ PR ที่ merge ทีหลัง rebase แล้วรันเทสต์ของไฟล์นั้นใหม่:

| ไฟล์ร่วม | ส่วนลดแก้ | add-on แก้ |
|---|---|---|
| `apps/api/src/modules/billing/application/billing.service.ts` | quote/checkout/attempt/history (§2 SD-C) | สาขา ADD_ON ของ quote/checkout, status |
| `apps/api/src/modules/billing/application/billing-reconciler.service.ts` | route, ใช้/ปล่อยสิทธิ์, ผูก CARD_AUTO | apply ของ add-on แยก |
| `apps/api/src/modules/billing/domain/paid-checkout-invoice.ts` | ยอดที่คาดหวัง `:22-23` เท่านั้น | validator ของ add-on แยก |
| `packages/contracts/src/billing.ts` | ฟิลด์ใหม่ + `BILLING_ACTIONS` | ชนิด quote/offer ของ add-on |
| `apps/api/src/modules/auth/presentation/auth.guard.ts` (pin) | `/event-discount` ใน GET | route ของ add-on |
| `apps/web/src/features/billing/BillingPage.tsx` | บรรทัดการ์ดและขั้นตรวจยอด | แท็บ "เครดิต AI และอ่านรูป" |

## 2. PR briefs

ทุก PR: worktree ใหม่จาก `origin/develop` ล่าสุด → PR ไป develop → twin PR ไป main (admin-merge ตามมติ Owner); stage เฉพาะ path ที่แก้; ไม่แตะ `package.json`

### SD-A — ข้อมูลและคอนโซลทีมขาย (ชุด, มอบหมาย, QR, รายการ, เพิกถอน, สิทธิ์)

| ไฟล์ | งาน |
|---|---|
| `apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/<ts>_sales_event_discounts/migration.sql` | 4 model ตามสเปก §6.1 (String state, ไม่มี enum) + index + partial unique `(companyId) WHERE state IN ('RESERVED','USED')` ด้วย SQL ดิบ (แบบ `20260705010000_item15a_idempotency_and_channel_uniqueness`) |
| `packages/contracts/src/sales.ts` | `SALES_PERMISSION_KEYS` เพิ่ม `'sales.event.manage'` (`:9-10`); `SALES_EVENT_BATCH_STATES`, `SALES_EVENT_TICKET_STATES`; ชนิด `SalesEventBatchInput`, `SalesEventBatchView`, `SalesEventQr`, `SalesEventTicketView` |
| `apps/api/src/modules/auth/permission-registry.ts` | entry ใหม่ใกล้ `:108-115`; grant ของ `MANGMEE_SALES_LEAD` (`:565`); SYSTEM_ADMIN ได้จาก `...SALES_PERMISSION_KEYS` (`:555`) |
| `apps/api/src/modules/sales-console/domain/sales-event.logic.ts` | ตรวจฟอร์ม, จำนวนเต็มบาท, ช่วงเวลา, state machine (สเปก §6.2), อายุ QR, serial, ตรวจขั้นต่ำต่อ scope (ราคาจาก policy ปัจจุบัน) |
| `apps/api/src/modules/sales-console/application/sales-events.service.ts` | สร้าง/แก้/สั่ง state, ค้นหาเซลล์ (หัวหน้า: ทีมตัวเอง; admin: ทั้งหมด; take 50 + cursor), ออก QR (hash token, `qrSvgDataUrl`), รายการส่วนลด, เพิกถอน; audit ทุกคำสั่ง; ประกาศ constructor เอง (DI check) |
| `apps/api/src/modules/sales-console/presentation/http/sales-events.controller.ts` + `sales-events.dto.ts` | route `/v1/sales/events/*` (สเปก §7.1) ทุก handler เรียก `assertPlatformTenant` (`sales-context.ts:37`) + `@RequirePermissions` |
| `apps/api/src/modules/sales-console/sales-console.module.ts` | ลงทะเบียน controller/provider (imports เดิม `:30` มี BillingModule แล้ว) |
| `apps/api/src/modules/audit/domain/models/audit-action.ts` | action `sales.event.*` (ห้ามแตะบรรทัดที่ถูก pin แบบ literal: `PLATFORM_ACCESS_STATE_UPDATE`) |
| `apps/web/app/sales/events/page.tsx`, `apps/web/app/sales/events/[batchId]/page.tsx` | route หน้าเว็บ |
| `apps/web/src/features/sales-console/SalesEventsPage.tsx`, `SalesEventBatchForm.tsx`, `SalesEventBatchPage.tsx`, `sales-events.logic.ts`, `sales.api.ts` | ฟอร์ม (checkbox เซลล์ + ค้นหา server, `datetime-local` + `+07:00`), รายการ, หน้าชุด, ปุ่ม QR พร้อมนับถอยหลัง |
| `apps/web/src/common/components/app-shell/SalesHeader.tsx` | เมนู "ส่วนลดจากงาน" ในกลุ่มงานขาย (ข้าง `:27-28`) |

เทสต์และที่ลงทะเบียน:
- `apps/api/src/modules/sales-console/domain/sales-event.logic.spec.ts` → whole-chain catalog suite `api-behavior` (`scripts/line-ai-whole-chain-acceptance.catalog.mjs:413`, ข้างรายการ sales `:424-427`)
- `apps/api/src/modules/sales-console/sales-event-discounts.pg.spec.ts` → `ci.yml` job Migrations and Boot ต่อจาก `:778` ด้วย `SALES_EVENT_TEST_DATABASE_URL="$DATABASE_URL"`; skip เมื่อ env ว่างแบบ `sales-console.pg.spec.ts`; เขียนและอ่านทุกคอลัมน์ใหม่
- ปรับ `apps/api/src/modules/auth/permission-registry.spec.ts:268-288` (หัวหน้ามี, เซลล์ไม่มี, SYSTEM_ADMIN มี, ร้านไม่มี)
- web: `sales-events.logic.spec.ts` (glob ของ web รันเอง)

เสร็จเมื่อ: SD-E01, SD-E02 และส่วนสิทธิ์ของ SD-E15 ผ่านที่ระดับ HTTP/PG; `migration:review` อ่านได้; `test:boot` ผ่าน. ประมาณ 3–4 วันทำงาน (API 1.5–2, เว็บ 1.5–2)

### SD-B — รับส่วนลดผ่าน LINE (หน้า LIFF, claim API, gate)

| ไฟล์ | งาน |
|---|---|
| `packages/contracts/src/billing.ts` | `BILLING_ACTIONS` เพิ่ม `'event_discounts'` (`:39`); ตรวจว่าหน้าตั้ง gate ของแอดมินแสดง key ใหม่ |
| `apps/api/src/modules/sales-console/application/claim-event-discount.use-case.ts` | ตรวจ ID token (`LineIdTokenService`), rate limit ต่อ LINE user, หา QR ด้วย hash, ตรวจชุด/ช่วง/ผู้แจก/gate, ปฏิเสธตัวตนที่เป็นสมาชิก platform tenant (SD-Q3), transaction claim (lock batch, replay, cap, insert, audit); คืน `next` จาก `ExternalIdentity` |
| `apps/api/src/modules/sales-console/presentation/http/public-event-discounts.controller.ts` + DTO | `@Public() @Controller('public/event-discounts')` `@Post('claim')` (แบบ `public-line-signup.controller.ts:83-94`) |
| `apps/api/src/modules/sales-console/sales-console.module.ts` | import `AuthModule` (export `LineIdTokenService`, `AuthRateLimitService` ไว้แล้วที่ `auth.module.ts:178`); ไม่แตะ `auth.module.ts` ที่ถูก pin |
| `apps/api/src/modules/auth/application/auth-rate-limit.service.ts` | bucket ของ claim ต่อ LINE user |
| `apps/api/src/modules/auth/presentation/auth.controller.ts` | `@Public() @Get('line/link-page/event-discount')` ข้าง `:520-526`; render ด้วย `liffPageHtml` ไม่ inject อะไรใหม่ |
| `apps/api/src/common/security/liff-page.security.ts` | mode `event-discount` ใน `LIFF_PAGE_SCRIPT` (`:131`): อ่าน `t`, ขอ ID token, POST claim, แสดงผลตามสเปก §3.3/§3.5, ปุ่ม "เปิดมั่งมี" ผ่าน `POST /v1/auth/line/liff/session` เดิม หรือ "เปิดร้านใหม่" |

เทสต์และที่ลงทะเบียน:
- `apps/api/src/modules/sales-console/application/claim-event-discount.use-case.spec.ts` → catalog
- `apps/api/src/common/security/liff-event-discount-page.spec.ts` (HTML, CSP, ข้อความ, ไม่มีคำว่า "ตั๋ว") → catalog; `liff-page-contrast.spec.ts` เดิมต้องผ่าน
- เพิ่มกรณีใน `sales-event-discounts.pg.spec.ts`: cap=1 สองคนพร้อมกัน, replay, ตัวตน platform tenant, gate ปิด, ผู้แจกถูกถอด

เสร็จเมื่อ: SD-E03 และส่วน claim ของ SD-E16. ประมาณ 1.5–2 วัน

### SD-C — เชื่อม billing (quote, Checkout, หลักฐาน, CARD_AUTO, reconcile, allowlist, แอดมิน)

| ไฟล์และตำแหน่ง | งาน |
|---|---|
| `packages/contracts/src/billing.ts` | `BillingQuote.eventDiscount` (`:121-148`), `BillingEventDiscountView`, `BillingAttemptView.eventDiscount`, `eventDiscountSatang` ในรายการประวัติ, lookup kind `EVENT_TICKET` (สเปก §7.2) |
| `apps/api/src/modules/billing/domain/billing-event-discount.logic.ts` | pure: ราคาต่อแบบภาษี (สเปก §5.1), ขั้นต่ำ 1000 สตางค์ (ค่าคงที่ร่วมกับ `billing-policy.ts:46`), เลือกรายการ (§4.3), ตัดสินสิทธิ์ (§4.1–§4.2) |
| `apps/api/src/modules/billing/application/billing-event-discount.ts` | DB: หารายการของผู้ใช้ผ่าน `ExternalIdentity` (LINE, ACTIVE), view ต่อร้าน, จอง, ใช้, ปล่อย; ตรวจดีล (`status 'APPROVED'` + `offerExpiresAt > now` แบบ `billing.service.ts:880-881`, หรือ `'PAID'`) |
| `billing.service.ts:58` | `BillingSnapshot.eventDiscount?` |
| `billing.service.ts:66-67` | `paymentCheckoutSnapshot` จริงเมื่อ `eventDiscount` (CARD_AUTO เป็น one-time) |
| `billing.service.ts` quote หลัง `:492` ก่อน `:520` | ใส่ `quote.eventDiscount`/`snapshot.eventDiscount`; `quote.totalSatang` คงราคาเต็ม |
| `billing.service.ts` checkout ใน transaction `:530-618` | ตรวจซ้ำ (gate, ดีล, ร้านเคยใช้, หมดอายุ, ชุด SUSPENDED, ตัวตนยังเป็นของผู้ใช้, รายการที่ดีที่สุดตรงกับที่ pin รวมกรณี quote ราคาเต็มที่ตอนนี้มีรายการใช้ได้) → stale; จองหลังสร้าง attempt และตั้ง `activeAttemptId` `:612-616` |
| `billing.service.ts:733-734`, `:738` | `setup_future_usage` สำหรับ CARD_AUTO ที่มีส่วนลด; `unit_amount = eventDiscount.unitAmountSatang` |
| `billing.service.ts:761-768` | ปล่อยการจองเมื่อ attempt FAILED |
| `billing.service.ts:815-818` | `cardAdvanceTrial` ครอบ `eventDiscount` (portal cancel ระหว่างงวดแรก) |
| `billing.service.ts:991-1006`, `:1033-1047` + method ใหม่ `eventDiscount(context)` | attempt view, ประวัติ (จาก ticket.invoiceId), view ของ route ใหม่ |
| `apps/api/src/modules/billing/presentation/billing.controller.ts` (`@Controller('companies/:companyId/billing')` `:521`) | `@Get('event-discount')` |
| `apps/api/src/modules/billing/domain/paid-checkout-invoice.ts:22-23` | ยอดที่คาดหวังจาก `snapshot.eventDiscount`; การตรวจ discount `:30,35,41,49` ไม่แตะ |
| `billing-reconciler.service.ts:240`, `:419`, `:453`, `:478-479` | route attempt CARD_AUTO ที่มี `eventDiscount` เข้า `reconcileOneTime` (ปกติ, นำเข้า, retry) |
| `billing-reconciler.service.ts:311-319` | ข้ามบิล $0 `subscription_create` ของ trial เมื่อ contract มี `eventDiscount` |
| `billing-reconciler.service.ts:494-504` | ปล่อยการจองเมื่อ session หมดอายุ |
| `billing-reconciler.service.ts:547-557` | ใช้สิทธิ์หลัง upsert invoice ก่อน `:557` และก่อน HELD `:592-599`; ไม่ตรง → issue `EVENT_DISCOUNT_REVIEW` |
| `billing-reconciler.service.ts:658`, `:695`, `:1088-1144` | คง `activeAttemptId` จนผูก; ขยาย `bindPromptPayRenewal` ให้รับบัตรด้วยส่วนตรวจจาก `bindAdvanceDeal` `:793-800,823-832,834-851` |
| `apps/api/src/modules/billing/application/billing-collection.ts:83,203` | predicate trial ครอบ `eventDiscount` |
| `apps/api/src/modules/billing/application/billing-purchase-source.ts:14-17` | ข้อยกเว้นช่วงรอผูกครอบ CARD_AUTO |
| `apps/api/src/modules/auth/presentation/auth.guard.ts:102` | `/event-discount` ในกลุ่ม GET; sync pins (§3.2) |
| `apps/api/src/modules/billing/application/billing-admin.service.ts` (`lookup` `:148`, helper `:138`) + หน้าร้านของแอดมิน | ค้นเลขส่วนลด; แสดงรายการส่วนลดของร้าน |
| `apps/web/src/features/billing-admin/BillingIssueResolutionPanel.tsx:70` | แสดง `EVENT_DISCOUNT_REVIEW` แบบ issue ที่อ้าง invoice; ปิดด้วยมือหลังตรวจ |

เทสต์และที่ลงทะเบียน:
- `apps/api/src/modules/billing/domain/billing-event-discount.logic.spec.ts` → catalog (ตัวอย่าง 499/100 ทั้งสามแบบภาษี, ขั้นต่ำ, เต็มบาท, ลำดับเลือก)
- `apps/api/src/modules/billing/billing-event-discount.pg.spec.ts` (ใหม่) → `ci.yml` Migrations and Boot ต่อจาก `:782` ด้วย `BILLING_EVENT_DISCOUNT_TEST_DATABASE_URL="$DATABASE_URL"`: quote→จอง→จ่าย→USED; ปล่อยเมื่อ FAILED/หมดอายุ; UNKNOWN คง; USED ก่อน HELD; RETRY_APPLY/IMPORT_INVOICE ตรวจซ้ำได้; ดีลกัน; หนึ่งรายการต่อร้านเมื่อแข่งกัน; CARD_AUTO one-time + ผูก trial ด้วย Stripe fixture (แบบ `billing-advance-deal.pg.spec.ts:16-67`) และบิลรอบสองราคาเต็มผ่าน `paidInvoiceEvidence`; grace ของรอบแรกหลัง trial เริ่มตามเดิม
- ขยาย spec เดิม: `paid-checkout-invoice.spec.ts` (catalog; ยอดลดผ่าน, บรรทัดส่วนลดยังถูกปฏิเสธ), `billing-collection.spec.ts` (catalog), `billing-admin-lookup.spec.ts` (catalog), `billing-purchase-source.pg.spec.ts` (`extended-tests.yml:286`), `auth.guard.spec.ts` (ชื่ออยู่ใน `apps/api/package.json` เดิม — แก้เนื้อหาเท่านั้น: GET `/v1/companies/:id/billing/event-discount` ผ่านเมื่อร้านล็อก; path ข้างเคียงและ POST ไม่ผ่าน)
- smoke: `apps/api/src/scripts/billing-event-discount-smoke.ts` + selector `BILLING_EVENT_DISCOUNT_ONLY=1` ใน `apps/api/src/scripts/billing-http-smoke.ts` (บล็อกใหม่ข้าง `:210`) + บรรทัดใน `extended-tests.yml` ต่อจาก `:292`
- ต้องผ่านโดยไม่แก้ (หลักฐานว่า renewal guard ไม่ถูกแตะ): `billing-schedule.spec.ts`, `billing-price-return.spec.ts`, `paid-invoice-promptpay.spec.ts`, `billing-refund-source.spec.ts`, `billing-grace.pg.spec.ts`, `billing-advance-deal.pg.spec.ts`

เสร็จเมื่อ: SD-E04–SD-E14, SD-E16, SD-E19, SD-E20 มีหลักฐาน HTTP/PG. ประมาณ 4–6 วัน (ส่วนที่เสี่ยงที่สุดคือ CARD_AUTO และเส้นทางกู้รายการ)

### SD-D — หน้าลูกค้า

| ไฟล์ | งาน |
|---|---|
| `apps/web/src/features/billing/BillingPage.tsx` | บรรทัดบนการ์ด (`:502-531`); ข้อความเหนือรายการแพ็กเกจ (ข้างการ์ดดีล `:459-486`); ขั้นตรวจยอด (`:561-569`): บรรทัดส่วนลด, "ชำระวันนี้" จาก `eventDiscount.totalSatang`, "รอบถัดไปชำระราคาเต็ม"; `:566` ไม่แก้ |
| หน้า return และส่วนประวัติของ billing | ข้อความสเปก §3.6 และแถวประวัติ |
| `apps/web/src/features/billing/billing.api.ts` | `getEventDiscount(companyId)` |
| `apps/web/src/features/billing/billing-event-discount.logic.ts` | เลือกข้อความตาม `reason`, จัดรูปจำนวนเงิน (feature-local) |
| `apps/web/src/common/api/api-error-message.ts` | ข้อความรหัส `SALES_EVENT_*` (คอนโซลทีมขาย) |

เทสต์: web specs (`billing-event-discount.logic.spec.ts`, spec ของ BillingPage — glob รันเอง); ขยาย `api-error-coverage.spec.ts`; e2e `e2e/sales-event-discount.spec.ts` (หัวหน้าสร้างชุด → QR → claim ผ่าน fixture LINE → ร้านล็อกซื้อ CARD_ONCE → ประวัติ; 390 px ด้วย `setViewportSize` แบบ `e2e/billing-admin-directory.spec.ts:74`) → step ใหม่ใน `extended-tests.yml` ต่อจาก step no-setup (`:336`) ใช้ DB `sales_event_discount_test`, พอร์ต 3161/3162, `NEXT_DIST_DIR: .next/sales-event-discount` (ตรวจว่าไม่ชน 3153–3156)

เสร็จเมื่อ: SD-E17 และส่วน UI ของ SD-E15. ประมาณ 2–3 วัน

### SD-E — รายงานและหน้าจอแอดมิน

| ไฟล์ | งาน |
|---|---|
| `sales-events.service.ts` + controller | `GET /v1/sales/events/report` ตามสเปก §10 ใช้กติกา `visibleAgents` (`sales-reports.service.ts:75`) |
| `apps/web/src/features/sales-console/SalesEventsPage.tsx` | ส่วนรายงานต่องาน/ชุด/เซลล์ |
| หน้าร้านใน `/system/billing/companies/:id` (web billing-admin) | ตารางส่วนลดของร้าน (serial, ชุด, สถานะ, บิล) |

เทสต์: เพิ่มกรณีรายงานใน `sales-event-discounts.pg.spec.ts` (ใช้แล้ว, หมดอายุ, คืนเงิน, นับบิลละครั้ง); web spec. เสร็จเมื่อ SD-E18, SD-E20. ประมาณ 1–2 วัน

### ประมาณการรวม

| ส่วน | วันทำงาน |
|---|---:|
| SD-A | 3–4 |
| SD-B | 1.5–2 |
| SD-C | 4–6 |
| SD-D | 2–3 |
| SD-E | 1–2 |
| native proof + UAT + production | 2–3 |
| **รวม** | **13.5–20** |

ไม่รวม P1/P2, เวลารอรีวิว/CI, การรอคิวไฟล์ร่วมกับ add-on และ release window. เส้นทางวิกฤตคือ P2 → SD-C → UAT test clock ของ CARD_AUTO

## 3. งานข้ามทุก PR (แบบ xx-cross-cutting)

### 3.1 ลงทะเบียนเทสต์ (ห้ามแตะ `package.json`)

`apps/api/src/spec-suite-coverage.spec.ts:43-75` ทำให้ CI แดงเมื่อ `*.spec.ts` ของ API ไม่ถูกเอ่ยชื่อใน `apps/api/package.json`, catalog, `ci.yml` หรือ `extended-tests.yml` (ยกเว้น `*.pg.spec.ts` ที่ไม่รันเองเลย จึงต้องมีบรรทัดของตัวเอง). ห้ามใส่ชื่อไฟล์ที่ยังไม่มี

| ไฟล์ | PR | ลงทะเบียนที่ |
|---|---|---|
| `sales-console/domain/sales-event.logic.spec.ts` | SD-A | catalog `api-behavior` (`:413`) |
| `sales-console/sales-event-discounts.pg.spec.ts` | SD-A (ขยายใน SD-B, SD-E) | `ci.yml` ต่อจาก `:778` |
| `sales-console/application/claim-event-discount.use-case.spec.ts` | SD-B | catalog |
| `common/security/liff-event-discount-page.spec.ts` | SD-B | catalog |
| `billing/domain/billing-event-discount.logic.spec.ts` | SD-C | catalog |
| `billing/billing-event-discount.pg.spec.ts` | SD-C | `ci.yml` ต่อจาก `:782` |
| `scripts/billing-event-discount-smoke.ts` | SD-C | selector `BILLING_EVENT_DISCOUNT_ONLY` + `extended-tests.yml` ต่อจาก `:292` |
| `e2e/sales-event-discount.spec.ts` | SD-D | step ใหม่ใน `extended-tests.yml` ต่อจาก `:336` |
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

CI ตรวจที่ `ci.yml:322-323`, `:401` และ `:604`. ถ้า add-on แก้ allowlist ก่อนหรือหลัง PR ที่ merge ทีหลังต้อง sync ใหม่. ไฟล์ pin ที่งานนี้ **ห้ามแตะ**: `auth.module.ts` (SD-B import AuthModule ฝั่ง sales-console แทน), `email-access.service.ts`, `refresh-session.use-case.ts`, login/session-gate/layout ของเว็บ, `packages/config/src/index.ts` (ไม่มี env ใหม่), บรรทัด literal ใน `audit-action.ts` และ `schema.prisma`

### 3.3 ความตรงกันของ workflow กับ main

SD-A, SD-C และ SD-D แก้ `ci.yml` หรือ `extended-tests.yml`. ก่อน dispatch UAT `all` ต้องให้สองไฟล์บน main ตรงกับ candidate byte ต่อ byte (`deploy-uat.yml` เทียบ blob ของ `ci.yml`): merge develop → twin PR ไป main → ตรวจ `git rev-parse <candidate>:.github/workflows/ci.yml` เทียบ `git rev-parse origin/main:.github/workflows/ci.yml` (และ `extended-tests.yml`). ระหว่าง READY → Production ห้ามแตะ main

### 3.4 Migrations

- หนึ่ง migration ใน SD-A: `apps/api/prisma/migrations/<ts>_sales_event_discounts/migration.sql`. `<ts>` ต้องมากกว่าตัวล่าสุดบน develop ตอนลงมือ — ณ 2026-09-29 ต้องหลัง `20260929030000` (ตัวล่าสุดที่ controller แจ้ง; `origin/develop` `69fba9d3` ยังมีล่าสุด `20260928210000_line_support_request_reference`) และหลัง migration ของ foundation
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

`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts` hash ไฟล์ชุดหนึ่ง รวม `packages/config/src/index.ts`, `packages/contracts/src/{ai-tools,feature-entitlements,line-ai,menu-entitlements}.ts`, `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` และ `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`. แผนนี้ไม่แตะไฟล์เหล่านั้น (ไม่มี env ใหม่ ไม่มีข้อความ LINE ไม่มี AI tool) จึงไม่ต้อง regenerate. ถ้า PR ใดต้องแตะ ให้ regenerate และรีวิว manifest ใน PR เดียวกัน (`line-ai-capability-manifest.spec.ts`)

### 3.7 Readbacks ก่อน UAT (และซ้ำก่อน production)

| รายการ | วิธีอ่าน | ค่าที่ต้องเป็น |
|---|---|---|
| gate `event_discounts` | `GET /v1/system/billing/settings` → gates | UAT: เปิดระหว่างทดสอบ; production: ปิดจนถึงขั้น §3.10 |
| `salesCompanyIds` | policy ที่ ACTIVE | `null` ทั้ง UAT และ production |
| taxTreatment | policy ที่ ACTIVE | UAT = production (`NOT_VAT_REGISTERED`) |
| `LINE_LIFF_ID` และ endpoint ของ LIFF app | task env ตาม runbook cloud; LINE Developers console | ตั้งค่าแล้ว; endpoint = `…/v1/auth/line/link-page` |
| `LINE_WEB_HANDOFF_ENABLED` | task env | `true` (ปุ่ม "เปิดมั่งมี" ใช้ handoff) |
| webhook ของ Stripe | Stripe dashboard ของแต่ละ environment | ไม่ต้องเพิ่ม event ใหม่ — ยืนยันว่าไม่มีใครเพิ่ม `invoice.created` โดยคิดว่าจำเป็น |
| permission ใหม่ | หลัง release task ที่รัน `prisma/sync-permissions.ts` (`run-release-task.sh:684`) | role หัวหน้ามี `sales.event.manage` |
| pins | `node infra/security/sync-production-maintenance-release-pins.mjs --check` | exit 0 |
| workflow parity | `git rev-parse` ตาม §3.3 | ตรงกับ main |
| เงื่อนไข rollback | query รายการ RESERVED และบัญชี CARD_AUTO ที่รอผูก (สเปก §11) | รู้ค่าก่อนทุก deploy/rollback |

### 3.8 Native proof

ตามตารางสเปก §14 — แต่ละข้อต้องมีผลใน UAT (test mode) ก่อนเปิด gate บน production. CARD_AUTO ใช้ Stripe test clock เลื่อนถึงสิ้นงวดแรก. ไม่สร้าง provider object นอกขั้นตอน UAT ที่รีวิวแล้ว

### 3.9 UAT checklist (Stripe test mode; ทำตาม runbook; บันทึก UAT, READY และ Production run ID)

| # | ขั้น | ผ่านเมื่อ |
|---|---|---|
| U1 | readbacks §3.7 | ครบทุกข้อ |
| U2 | หัวหน้าสร้างชุด 2 เซลล์; เซลล์ที่ไม่ได้รับมอบหมายเปิด QR ไม่ได้; QR หมดใน 5 นาที | ตรงสเปก §3.1–§3.2 |
| U3 | คนแรกสแกนด้วย LINE จริง (iPhone และ Android) → รับได้; สแกนซ้ำได้รายการเดิม; บัญชีทีมขายสแกนถูกปฏิเสธ; พนักงานร้านเห็นข้อความ §3.5 | ตรง §3.3/§3.5 |
| U4 | ผู้รับที่ยังไม่มีบัญชี → "เปิดร้านใหม่" ผ่าน LIFF → ร้าน "ยังไม่มีแพ็กเกจ" → บรรทัดส่วนลดบนการ์ด → CARD_ONCE รายเดือน → จ่าย → apply → ปลดล็อกในที่ | ส่วนลด USED; ประวัติแสดงยอดจริง; ใบเสร็จ Stripe แสดงราคาสุทธิไม่มีบรรทัดส่วนลด |
| U5 | PROMPTPAY_ONCE และ PROMPTPAY_RENEW ที่มีส่วนลด | บิล QR แรกลด; บิล QR รอบถัดไปราคาเต็ม |
| U6 | CARD_AUTO ที่มีส่วนลด + test clock | จ่ายงวดแรกลด; subscription `trialing` ราคาเต็ม; "หยุดต่ออายุ" ระหว่างงวดแรกได้ (อีกร้าน); บิลรอบสองราคาเต็ม apply เป็น RENEWAL; บัตรปฏิเสธหลัง trial → grace เริ่ม |
| U7 | ร้านหมดอายุ (RESTART) ใช้ได้; ร้านที่แพ็กยังใช้งาน (REPEAT/อัปเกรด) ไม่มีบรรทัด; add-on ไม่ลด และ checkout add-on ที่ค้างไม่บล็อกการซื้อแพ็กเกจที่มีส่วนลด | ตรง §4.1 |
| U8 | ร้านที่มีดีล APPROVED | ไม่มีบรรทัด + ข้อความ "มีดีลพิเศษอยู่แล้ว"; อนุมัติดีลระหว่าง quote กับ Checkout → stale |
| U9 | หนึ่งรายการต่อร้าน: ผู้ถือคนที่สองของร้านเดิมหลัง USED ไม่มีบรรทัด; ผู้ถือคนเดียวสองร้านพร้อมกัน → ร้านที่สอง stale | ตรง §4.3 |
| U10 | กดกลับจาก Stripe, ปุ่มยกเลิก, session หมดอายุ | รายการกลับเป็นใช้ได้; UNKNOWN คงการจอง |
| U11 | คืนเงินบางส่วนและทั้งหมดของบิลที่ลด; CARD_AUTO: หยุดต่ออายุแล้วยุติแพ็กระหว่างงวดแรก | ยอดคืนถูก; รายการยัง USED; รายงานหักคืน |
| U12 | แอดมิน: ค้นเลขส่วนลด; ใบที่ถูกถือไว้ → RETRY_APPLY หรือ IMPORT_INVOICE apply ได้ | ตรง SD-E11/SD-E20 |
| U13 | ปิด gate | claim ถูกปฏิเสธ; quote ไม่ลด; รายการที่จองแล้วเดินต่อ; ซ้อมเงื่อนไข rollback §11 |
| U14 | Extended Tests run id (PG, smoke, e2e) | บันทึกใน memory |

### 3.10 Production acceptance (ภายในประมาณ 5 นาทีหลัง website-ready)

1. Readbacks §3.7 ซ้ำ (gate ยังปิด)
2. Owner เปิด gate ผ่าน SET_ACTION_GATE ที่รีวิวแล้ว; หัวหน้าสร้างชุดเล็ก (จำนวนแจก 1) ให้ร้านทดสอบภายในที่ "ยังไม่มีแพ็กเกจ"
3. สแกนรับด้วย LINE จริง → ซื้อ STARTER รายเดือนราคาจริงที่มีส่วนลด → apply → ตรวจใบเสร็จ ประวัติ และรายงานงาน
4. คืนเงินในแอปตามขั้นตอนเดิม → รายการยัง USED และรายงานหักคืน
5. Owner ตัดสินใจว่าจะคง gate เปิดหรือปิด; บันทึกตาม runbook (UAT/READY/Production run ID, signed result, customer `OPEN`) — ไม่เรียกว่า live จนกว่าทั้งสองผ่าน

### 3.11 แก้เอกสารอื่น (ทำใน PR ที่เกี่ยว ไม่ได้ทำในรอบนี้)

| ไฟล์:บรรทัด | แก้เป็น | PR |
|---|---|---|
| `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md:30` (§4) | กติกาเดิมคงไว้; เพิ่มอ้างอิงว่า "ส่วนลดจากงานไม่ใช้กับดีลและไม่มี coupon (sales-event-discounts SD-O1/SD-O2, 2026-09-29)" | SD-C |
| `docs/plans/mangmee-sales-deals-and-locked-signup-plan-th.md:19,83` | กติกา "ห้ามแตะ `paid-checkout-invoice.ts`" เพิ่มข้อยกเว้นเฉพาะยอดที่คาดหวังของส่วนลดจากงาน `:22-23` | SD-C |
| สเปกและแผน add-on | layout ไม่มี section/แท็บของส่วนลด (T-08 ตรงแล้ว); validator ของ add-on ปฏิเสธ `eventDiscount`; รายการไฟล์ร่วมตาราง §1 | ประสานกับเจ้าของ add-on |
| `docs/runbooks/uat-production-v2-deployment.md` (หรือ runbook billing) | readbacks §3.7 และเงื่อนไข rollback สเปก §11 | SD-C |
| `docs/plans/mangmee-master-plan-index-th.md` | แถวของงานนี้และสถานะ | ทุก PR |
| `docs/agent-memory/sales-event-discounts-<date>.md` | สร้าง memory (Status/Verification/Next + run ID) แทนลิงก์ที่เสีย | PR แรก |
| `docs/specs/mangmee-owned-billing-integration-spec-th.md:76` (B01/B08) | ไม่ต้องแก้ — ไม่มี invoice ที่มี coupon | — |

### 3.12 Release และ rollback

- ลำดับปล่อย: SD-A และ SD-B ปล่อยก่อนได้โดย gate ปิด; SD-C และ SD-D ต้องอยู่ release เดียวกัน; SD-E ปล่อยหลังได้
- ก่อน dispatch UAT: readbacks §3.7, workflow parity §3.3, ไม่มี run ของ flow เดียวกันค้าง (runbook)
- Rollback ตามสเปก §11: migration additive; ต้องไม่มีรายการ RESERVED และไม่มีบัญชี CARD_AUTO ที่รอผูก; ไม่เช่นนั้นปิด gate รอหรือ forward-fix; บันทึกผลที่ binary เก่าทำให้ "หยุดต่ออายุ" ระหว่างงวดแรกใช้ไม่ได้ชั่วคราว

## 4. ผลรีวิว R2 → การปิด

รีวิว `R2-sales-event-discounts-report.md` (41 ข้อ) เทียบกับมติ 2026-09-29:

| ID | ระดับ | ผล | ปิดอย่างไร / อยู่ที่ |
|---|---|---|---|
| SED-01 | BLOCK | ไม่เกิดแล้ว | SD-O1: ไม่มีส่วนลดบน subscription จึงไม่มี arming; guard ไม่แตะ (สเปก §5.4); predicate trial ของ CARD_AUTO งวดแรกเป็นงานใน SD-C ไม่ใช่ guard ของ discount |
| SED-02 | BLOCK | ไม่เกิดแล้ว | รอบต่ออายุราคาเต็ม; `snapshot.quote` เป็นราคาเต็ม ส่วนลดแยกใน `eventDiscount` จึง `enforceGrace` ไม่แตะ (§5.4); UAT U6 |
| SED-03 | BLOCK | ปิด | SD-T1: `/event-discount` ใน allowlist + pins + `auth.guard.spec.ts` (SD-C, §3.2) |
| SED-04 | BLOCK | ไม่เกิดแล้ว | SD-O2: ไม่ซ้อนดีล; `billing-package-request.ts` ไม่เปลี่ยน; เงื่อนไขและข้อความสเปก §4.2 |
| SED-05 | HIGH | ปิด | ยอดที่คาดหวังอยู่ใน snapshot ของ attempt ทุกทางตรวจซ้ำจึงได้ผลเดียวกัน (สเปก §5.2); `paid-invoice.ts` ไม่แตะ; smoke เดิมไม่แก้ + smoke ใหม่ |
| SED-06 | HIGH | ปิด | audit มีส่วน "ตรวจซ้ำบน develop 8a91bc1c"; anchor ในสเปก/แผนตรวจใหม่ทั้งหมด; ผล PASS เดิมระบุว่าเป็นของ 4a5817b4 |
| SED-07 | HIGH | ปิด | SD-O1: ไม่มี coupon ทุกโหมด; `unit_amount` ทั้งสี่โหมด (CARD_AUTO ผ่านงวดแรกแบบ one-time); ไม่ต้องแก้ sales-deals §4 หรือ owned-billing B01/B08 |
| SED-08 | HIGH | ปิด | SD-O3: ผูกผู้ถือตอนสแกน ใช้ได้หลังสมัคร; ตัดตัวเลือกกลุ่มลูกค้า |
| SED-09 | HIGH | ปิด | gate ใน `BILLING_ACTIONS`, ขั้นต่ำเป็นค่าคงที่ในโค้ด, ไม่มี key ใน `policyJson`; validator ไม่ขึ้นกับ gate; เงื่อนไข rollback (สเปก §11) |
| SED-10 | HIGH | ไม่เกิดแล้ว | ไม่มี selection/target; quote pin `ticketId` + `ticketVersion`; ไม่ใช้ชื่อ `purchaseIntent` |
| SED-11 | HIGH | ปิด | §3 ของแผนนี้ |
| SED-12 | HIGH | ปิด | V1 ไม่มีข้อความ LINE หรือการแจ้งเตือนใหม่; การ์ดโปรโมชั่นและนโยบายสาธารณะคงราคาปกติ; SD-Q5 |
| SED-13 | HIGH | ปิด | SD-T2 ลำดับ §1 และตารางไฟล์ร่วม |
| SED-14 | MEDIUM | ปิด | scope = tiers + intervals; purchase kind ตายตัว (SCHEDULED_CHANGE ใช้ไม่ได้ตามค่าเริ่มต้น SD-Q2); ขั้นต่ำตรวจตอนเผยแพร่และ quote; helper เดียวกับ quote |
| SED-15 | MEDIUM | ไม่เกิดแล้ว | ไม่มี selection ก่อนมี BillingAccount; จองใน transaction ที่สร้าง account (`billing.service.ts:611`); ไม่แตะ `BillingAccount.version` |
| SED-16 | MEDIUM | ปิด | ผูกกับ attempt ของแพ็กเกจหลัง foundation (P2); ไม่มีแท็บ; validator ของ add-on แยก |
| SED-17 | MEDIUM | ปิด | QR ไป LIFF ที่ไม่ผูกร้าน; เฉพาะผู้มีสิทธิ์จัดการแพ็กเกจที่เป็นผู้ถือ; พนักงานเห็นคำแนะนำบน LIFF (สเปก §3.5) |
| SED-18 | MEDIUM | ปิด | checkbox + ค้นหา server ในฟีเจอร์; `datetime-local` + `+07:00`; ตัดข้ออ้างว่ามีของกลางให้ใช้ซ้ำ |
| SED-19 | MEDIUM | ปิด | ตารางสิทธิ์สเปก §9; key ใหม่ใน contracts/registry/grant/spec; sync permissions ใน release task |
| SED-20 | MEDIUM | ปิด (แคบลง) | ไม่มี provider arming จึงไม่ต้องมีคำสั่ง arm/detach; การปล่อยตาม lifecycle ของ attempt เดิม; ค้นเลขส่วนลด, ตารางบนหน้าร้าน, issue `EVENT_DISCOUNT_REVIEW` |
| SED-21 | MEDIUM | ปิด | บรรทัดการ์ดคำนวณโดย server; `quote.totalSatang` ราคาเต็มทำให้ `BillingPage.tsx:566` ถูก; รอบต่ออายุไม่ลดจึงไม่มียอดขัดกัน |
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
| SED-34 | LOW | ปิด | SD-O3: หมดอายุ = ปิดรับ + 30 วัน (SD-Q1); รายงานภาระคงค้าง |
| SED-35 | LOW | คงเดิม (มีก่อนแล้ว) | ดีลไม่ลด จึงไม่รับช่วงปัญหานี้; ต้องแก้ก่อนจด VAT ตามงาน billing เดิม |
| SED-36 | LOW | ไม่เกิดแล้ว | ไม่มีบรรทัดส่วนลดบนใบ; การคืนเงินแบบ EXCLUSIVE ที่ปิดไว้อยู่แล้วเป็นเรื่องเดิม |
| SED-37 | LOW | ปิด | state machine ของชุด (สเปก §6.2); แสดง "ปิดรับ {วันเวลา}"; แปลงเวลา `+07:00` |
| SED-38 | LOW | ไม่อยู่ในขอบเขต | ไม่มี dropdown ของลูกค้า; ถ้าฟอร์มหัวหน้าใช้ ThemedSelect แล้วเจอกรณีเปิดแล้วถูกปิดใช้ ให้แยกงาน |
| SED-39 | LOW | ปิด | ส่วนลดเต็มบาทเท่านั้น |
| SED-40 | LOW | ไม่เกิดแล้ว | ไม่มีปุ่ม toggle; ข้อความหน้า return สเปก §3.6 |
| SED-41 | LOW | ปิด | ปล่อยที่ `billing.service.ts:761-768` และ `billing-reconciler.service.ts:494-504`; UNKNOWN คง; USED ก่อน `:557` และ HELD `:592-599`; สูตร `evidenceHash` เดิมใช้ยอดที่ลดแล้วคงที่ต่อ attempt |

## 5. สถานะ

| ขั้น | สถานะ |
|---|---|
| D0 มติ UI เดิม (section/toggle/3 แถว) | ถูกแทนที่ด้วยมติ 2026-09-29 (สเปก §1.3) |
| D1 audit บน 4a5817b4 | เป็นประวัติ; ตรวจซ้ำบน develop แล้วใน audit |
| D2 ปรับเดโม | ยกเลิก — เดโมไม่อยู่ใน repo และแบบใหม่ไม่มีหน้าจอสะสม/เลือก |
| รอบเอกสาร 2026-09-29 | spec, plan, audit ปรับตามมติและรีวิว R2 |
| SD-A … SD-E | ยังไม่เริ่ม; รอ P1, P2 และคำตอบหรือค่าเริ่มต้นของ SD-Q1–SD-Q6 |

ไม่ได้รันเทสต์ในรอบนี้: checkout ที่ใช้ตรวจ (`/private/tmp/mangmee-pfv-review`) ไม่มี dependency ติดตั้ง. ตอนลงมือให้รันเทสต์ที่ระบุใน §2 บน worktree ของ develop ล่าสุด
