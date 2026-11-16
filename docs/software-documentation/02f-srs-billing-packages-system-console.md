# 02f — SRS: Billing, แพ็กเกจ, Sales Console, Sales Demo และ System Console

เอกสารนี้เป็น Software Requirements Specification (SRS) ของส่วน "ขายและดูแลแพ็กเกจ" ของ MangmeePlus / WatchDog-BMS ได้แก่ โมดูล `billing` (แค็ตตาล็อก ใบเสนอราคา Checkout กับ Stripe ใบแจ้งหนี้ การต่ออายุ การเปลี่ยนแพ็กเกจ การคืนเงิน การกระทบยอด และคอนโซลผู้ดูแล) การบังคับใช้แพ็กเกจ (อายุแพ็กเกจ เพดานสาขา/พนักงาน/ใบเสร็จ การปิดทดลองใช้ฟรี) โมดูล `sales-console` (ทีมขาย ดีล งานอีเวนต์และตั๋วส่วนลด เครดิต) โมดูล `sales-demo` (ลิงก์เดโม) และหน้าจอผู้ดูแลแพลตฟอร์มทั้งหมดใต้ `apps/web/app/system/**` ทุกข้อกำหนดเขียนจากโค้ดจริง ไม่ใช่จาก spec; ที่ใดโค้ดไม่ตรงกับ spec จะระบุไว้ชัดเจน

- **Commit ต้นทาง:** `08850deaf` (`origin/main`, 2026-11-10) — checkout `closeout-docs-main`
- **AREA code:** `BILL` (รหัสข้อกำหนด `FR-BILL-nnn`; ข้อกำหนดที่ไม่ใช่ฟังก์ชันใช้ `NFR-BILL-nnn` เพื่อไม่ชนกับเอกสารอื่น)
- **ขอบเขตแพ็ก:** FREE_TRIAL_15, STARTER_249, BASIC_499, PRO_999, ENTERPRISE_1999 และ add-on (chat credit, receipt image)
- **ภาษา:** ไทย โดยคงชื่อ identifier, path, route, model, permission key, enum ตามโค้ด

## สารบัญ

1. [ภาพรวมและคำศัพท์](#1-ภาพรวมและคำศัพท์)
2. [แพ็กเกจ ราคา และ add-on](#2-แพ็กเกจ-ราคา-และ-add-on)
3. [กฎเงินและภาษี (สูตรที่แน่นอน)](#3-กฎเงินและภาษี-สูตรที่แน่นอน)
4. [State machine ทั้งหมดของ billing](#4-state-machine-ทั้งหมดของ-billing)
5. [Stripe: object, API call และ event ที่โค้ดจัดการ](#5-stripe-object-api-call-และ-event-ที่โค้ดจัดการ)
6. [Permission keys `system.*` และการอนุมัติ](#6-permission-keys-system-และการอนุมัติ)
7. [ข้อกำหนดฟังก์ชัน — ฝั่งลูกค้า (ร้าน)](#7-ข้อกำหนดฟังก์ชัน--ฝั่งลูกค้า-ร้าน)
8. [ข้อกำหนดฟังก์ชัน — เครื่องยนต์ billing เบื้องหลัง](#8-ข้อกำหนดฟังก์ชัน--เครื่องยนต์-billing-เบื้องหลัง)
9. [ข้อกำหนดฟังก์ชัน — คอนโซล billing ของผู้ดูแล](#9-ข้อกำหนดฟังก์ชัน--คอนโซล-billing-ของผู้ดูแล)
10. [ข้อกำหนดฟังก์ชัน — การบังคับใช้แพ็กเกจ](#10-ข้อกำหนดฟังก์ชัน--การบังคับใช้แพ็กเกจ)
11. [ข้อกำหนดฟังก์ชัน — Sales Console](#11-ข้อกำหนดฟังก์ชัน--sales-console)
12. [ข้อกำหนดฟังก์ชัน — Sales Demo](#12-ข้อกำหนดฟังก์ชัน--sales-demo)
13. [ข้อกำหนดฟังก์ชัน — System Console (นอก billing)](#13-ข้อกำหนดฟังก์ชัน--system-console-นอก-billing)
14. [ข้อกำหนดที่ไม่ใช่ฟังก์ชัน](#14-ข้อกำหนดที่ไม่ใช่ฟังก์ชัน)
15. [ภาคผนวก ก — ตาราง API ทั้งหมด](#15-ภาคผนวก-ก--ตาราง-api-ทั้งหมด)
16. [ภาคผนวก ข — หน้าจอ `/system/**` ทั้งหมด](#16-ภาคผนวก-ข--หน้าจอ-system-ทั้งหมด)
17. [ภาคผนวก ค — Prisma models](#17-ภาคผนวก-ค--prisma-models)
18. [ภาคผนวก ง — รหัสข้อผิดพลาด, issue kind, audit action](#18-ภาคผนวก-ง--รหัสข้อผิดพลาด-issue-kind-audit-action)
19. [ภาคผนวก จ — ไฟล์ทดสอบ](#19-ภาคผนวก-จ--ไฟล์ทดสอบ)
20. [สิ่งที่มีใน spec แต่ไม่พบในโค้ด / ข้อสังเกต](#20-สิ่งที่มีใน-spec-แต่ไม่พบในโค้ด--ข้อสังเกต)
21. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#21-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)

---

## 1. ภาพรวมและคำศัพท์

### 1.1 องค์ประกอบ

| ส่วน | ที่อยู่ในโค้ด | หน้าที่ |
|---|---|---|
| สัญญาข้อมูล billing | `packages/contracts/src/billing.ts`, `plan-term.ts`, `billing-company-profile.ts`, `sales.ts` | ชนิดข้อมูลร่วม API/เว็บ, ราคา, ชุด permission, ค่าคงที่ |
| โมดูล billing | `apps/api/src/modules/billing/**` | ทุกอย่างเรื่องเงินกับ Stripe |
| Stripe adapter | `apps/api/src/modules/billing/infrastructure/stripe.client.ts` | HTTP client เดียวที่คุยกับ `https://api.stripe.com/v1` |
| Controller | `apps/api/src/modules/billing/presentation/billing.controller.ts` | 5 controller: `BillingCatalogController`, `BillingAdminController`, `BillingController`, `StripeEventsController`, `BillingInternalController` |
| การบังคับใช้แพ็กเกจ | `apps/api/src/modules/system-partner-management/**` (plan term, capacity), `apps/api/src/modules/auth/**` (ล็อกร้านหมดอายุ) | อายุแพ็กเกจและเพดาน |
| Sales console | `apps/api/src/modules/sales-console/**` | ทีมขาย ดีล อีเวนต์ ตั๋ว |
| Sales demo | `apps/api/src/modules/sales-demo/**` | ลิงก์เดโม 3 วัน |
| เว็บผู้ดูแล | `apps/web/app/system/**` + `apps/web/features/**` | คอนโซลแพลตฟอร์ม |
| Worker | `apps/workers/**` | เรียก `internal/billing/*` ตามรอบเพื่อ drain คิว |

### 1.2 คำศัพท์หลัก

| คำ | ความหมายในโค้ด |
|---|---|
| Stripe account + livemode | ทุกแถว billing ผูกกับคู่ `(stripeAccountId, livemode)`; `BillingMode` = `TEST` / `LIVE`; ปิดระบบ = `DISABLED` (`AppConfigService.billingMode`) |
| BillingAccount | บัญชีเรียกเก็บของร้านหนึ่งร้านต่อหนึ่งคู่ `(stripeAccountId, livemode)` ถือ `customerId`, `baseSubscriptionId`, `paidThrough`, `renewalMode`, ช่องจอง (`activeAttemptId`, `activeCollectionOperationId`, `activeEmailOperationId`, `pendingPlanChangeId`) และ lease |
| Quote | ใบเสนอราคาที่เซิร์ฟเวอร์คำนวณและเก็บ snapshot (`BillingQuote`) อายุ 10 นาที |
| Attempt | ความพยายามจ่ายเงินหนึ่งครั้ง (`BillingAttempt`) = 1 Stripe Checkout Session |
| Snapshot (`BillingSnapshot`) | สัญญาที่ตรึงไว้ตอนเสนอราคา: offer, priceId, productId, policy, featurePlan, capacity, deal, promotion, eventDiscount ฯลฯ ทุกขั้นหลังจากนั้นอ่านจาก snapshot เท่านั้น |
| Policy / PolicyRevision | นโยบายการขายที่เผยแพร่แล้ว (`BillingPolicy` ใน `BillingPolicyRevision.policyJson`) |
| Gate | สวิตช์เปิด/ปิดการกระทำทางการเงิน 10 ตัว (`BILLING_ACTIONS`) ใน `BillingSettings.gatesJson` |
| Operation | คำสั่งของผู้ดูแลหรือระบบที่มีวงจร preview → submit → approve → run (`BillingOperation`) |
| Issue | เคสที่ระบบตรวจพบและต้องมีคนดู (`BillingIssue`) |
| paidThrough | วันที่สิทธิ์ที่จ่ายเงินแล้วสิ้นสุด (ของบัญชี) |
| Plan term | แถว `CompanyPlanTerm` ที่ตัดสินว่าร้านใช้งานได้ถึงเมื่อใดและเพดานเท่าใด |
| Plan manager | ผู้ใช้ของร้านที่ `canManagePlan()` เป็นจริง (เจ้าของหรือบทบาทที่มีสิทธิ์จัดการแพ็กเกจ) — ทุก endpoint ฝั่งร้านของ billing เรียก `BillingService.assertOwner()` |

---

## 2. แพ็กเกจ ราคา และ add-on

### 2.1 ค่าตั้งต้นของแต่ละแพ็ก (`PLAN_TIER_PRESETS`, `packages/contracts/src/plan-term.ts:133`)

| tierKey | ชื่อไทย | สาขา | พนักงาน | ใบเสร็จ/เดือน | ราคา/เดือน (สตางค์) | ราคา/ปี (สตางค์) | ขายผ่าน Stripe |
|---|---|---:|---:|---:|---:|---:|---|
| `FREE_TRIAL_15` | ทดลองใช้ฟรี | 1 | 2 | 15 | — | — | ไม่ขาย (ผู้ดูแลมอบได้จากหน้า partner; สมัครใหม่ไม่ได้รับแล้วตั้งแต่ 2026-09-20) |
| `STARTER_249` | เริ่มต้น (STARTER) | 1 | 2 | 30 | 24,900 | 249,000 | ใช่ |
| `BASIC_499` | เติบโต (BASIC) | 2 | 5 | 50 | 49,900 | 499,000 | ใช่ |
| `PRO_999` | มืออาชีพ (PRO) | 5 | 10 | 100 | 99,900 | 999,000 | ใช่ |
| `ENTERPRISE_1999` | ธุรกิจ (ENTERPRISE) | 10 | 30 | 500 | 199,900 | 1,999,000 | ใช่ เมื่อผูก Stripe Price แล้ว; ก่อนนั้นแสดง `COMING_SOON` |

- ราคารายปีตั้งต้น = ราคารายเดือน × 10 (`billingOffer()`, `billing.ts:75`) ผู้ดูแลแก้ราคา/เพดาน/จำนวนใบเสร็จต่อแพ็กได้ผ่าน `BillingPolicy.offerTerms` (มีผลกับการซื้อใหม่เท่านั้น)
- โควตาใบเสร็จของงวดที่จ่าย: `receiptAllowance = monthlySlipLimit × (interval === 'year' ? 12 : 1)` มอบครั้งเดียวทั้งงวด (`receiptAllowanceCadence: 'PAID_PERIOD'`)
- เมนูที่แต่ละแพ็กปลดล็อก: `featureKeys = TIER_FEATURE_PRESETS[tier]` (`packages/contracts/src/menu-entitlements.ts`; รายละเอียดเมนูต่อแพ็กอยู่ในเอกสาร SRS ของ entitlement)
- `BILLING_PAID_TIERS = ['STARTER_249','BASIC_499','PRO_999','ENTERPRISE_1999']` — ลำดับใน array คือ "อันดับ" ที่ใช้ตัดสิน upgrade/downgrade

### 2.2 วิธีจ่าย (`BillingPurchaseMode`)

| โหมด | Stripe Checkout mode | การต่ออายุ | Gate ที่ต้องเปิด |
|---|---|---|---|
| `CARD_AUTO` | `subscription` (บัตร) — ยกเว้นงวดแรกที่ใช้ส่วนลดงาน/โปรโมชัน/advance deal จะเป็น `payment` + `setup_future_usage: off_session` แล้วผูก subscription ภายหลัง | ตัดบัตรอัตโนมัติ | `new_sales` |
| `CARD_ONCE` | `payment` (บัตร) | ไม่ต่ออายุ ซื้อซ้ำเอง | `new_sales` + `card_once` |
| `PROMPTPAY_ONCE` | `payment` (PromptPay) | ไม่ต่ออายุ | `new_sales` + `promptpay_once` |
| `PROMPTPAY_RENEW` | `payment` (PromptPay) งวดแรก แล้วผูก subscription แบบ `collection_method: send_invoice` | ระบบออกบิล QR ทุกรอบ | `new_sales` + `promptpay_renew` |

### 2.3 Add-on (`BILLING_ADDON_OFFERS`, `billing.ts:105`)

| offerKey | productKind | ปริมาณ | unitScale | ราคา (สตางค์) | อายุ |
|---|---|---:|---:|---:|---|
| `CHAT_50` | `CHAT_CREDIT` | 5,000 หน่วย (= 50 เครดิต) | 100 | 29,900 | 12 เดือน |
| `CHAT_100` | `CHAT_CREDIT` | 10,000 (= 100 เครดิต) | 100 | 54,900 | 12 เดือน |
| `CHAT_300` | `CHAT_CREDIT` | 30,000 (= 300 เครดิต) | 100 | 149,900 | 12 เดือน |
| `RECEIPT_IMAGE_20` | `RECEIPT_IMAGE` | 20 รูป | 1 | 34,900 | 12 เดือน |
| `RECEIPT_IMAGE_50` | `RECEIPT_IMAGE` | 50 รูป | 1 | 79,900 | 12 เดือน |
| `RECEIPT_IMAGE_100` | `RECEIPT_IMAGE` | 100 รูป | 1 | 149,900 | 12 เดือน |

สถานะการทำงานจริงของ add-on ดู FR-BILL-066, FR-BILL-070 และหัวข้อ 20

---

## 3. กฎเงินและภาษี (สูตรที่แน่นอน)

หน่วยเงินทั้งหมดเป็น **สตางค์จำนวนเต็ม** สกุล `THB` (Stripe `currency: 'thb'`) ไม่มีทศนิยมลอย

### 3.1 ภาษีมูลค่าเพิ่ม (`quoteTotals()`, `apps/api/src/modules/billing/domain/billing-policy.ts:133`)

ให้ `P` = ราคาที่เรียกเก็บ (ราคาแพ็ก หรือส่วนต่าง upgrade หรือราคาหลังส่วนลดงาน) และ `taxTreatment` จาก policy

| taxTreatment | taxSatang | subtotalSatang | totalSatang |
|---|---|---|---|
| `NOT_VAT_REGISTERED` | `0` | `P` | `P` |
| `INCLUSIVE_VAT_7` | `P − round(P × 100 / 107)` | `P − taxSatang` | `P` |
| `EXCLUSIVE_VAT_7` | `round(P × 7 / 100)` | `P` | `P + taxSatang` |

- `round` = `Math.round` (ปัดครึ่งขึ้น)
- ค่าตั้งต้นของระบบ (`BILLING_DRAFT_POLICY`) คือ `NOT_VAT_REGISTERED`
- เมื่อไม่ใช่ `NOT_VAT_REGISTERED` policy ต้องมี `issuer` (ชื่อนิติบุคคล ที่อยู่ เลขภาษี 13 หลัก และ Stripe tax id `txi_…`) และ `taxRateId` (`txr_…`); `assertTaxSettings()` (`billing.service.ts:173`) ตรวจกับ Stripe ว่า Tax Rate `active`, `country = 'TH'`, `percentage = 7`, `inclusive` ตรงกับ treatment, Tax ID เป็น `th_vat` ของบัญชีเอง และถูกตั้งเป็น `default_account_tax_ids` ของ invoice settings ไม่ตรง → `BILLING_TAX_MISMATCH` / `CONTROL_INVOICE_IDENTITY_NOT_READY` / `CONTROL_ISSUER_REQUIRED`
- `NOT_VAT_REGISTERED` ห้ามมี `taxRateId` (parse ไม่ผ่าน)
- Stripe line item ใช้ `tax_behavior: 'exclusive'` เมื่อ `EXCLUSIVE_VAT_7` นอกนั้น `'inclusive'`; ใบแจ้งหนี้แนบ `account_tax_ids: [issuer.stripeTaxId]` เมื่อจด VAT

### 3.2 ข้อจำกัดราคาใน policy (`parseBillingPolicy()`)

- `offerTerms[tier].monthlyPriceSatang` / `annualPriceSatang`: จำนวนเต็ม ≥ 1,000 สตางค์ (10 บาท) และยอดรวมหลังภาษี ≤ 99,999,999 สตางค์ (`CONTROL_OFFER_PRICE_INVALID`)
- `monthlyReceiptAllowance`: 1 ถึง `floor(2147483647 / 12)` (`CONTROL_OFFER_RECEIPTS_INVALID`)
- `branchLimit`, `employeeLimit` (ต้องมาคู่กัน): 1–1000 (`CONTROL_OFFER_CAPACITY_INVALID`)
- `graceDays`: 0–30 (ค่าตั้งต้น 7)
- `refundLimitSatang`: 1–2,147,483,647 ต่อคำขอคืนเงินหนึ่งคำขอ; ไม่กำหนด = ปิดการคืนเงิน
- `salesCompanyIds`: ไม่กำหนด/null = ขายทุกร้าน, `[]` = ปิดขาย, มีรายการ (≤ 100) = ขายเฉพาะร้านที่ระบุ
- `supportSlaMinutes`: `{NORMAL,HIGH,CRITICAL}` แต่ละค่า 1–525,600 นาที
- `priceIds`, `zeroPriceIds`, `addOnPriceIds`: ต้องเป็น `price_…` ไม่ซ้ำกันข้ามทุกชุด
- `consentRevision`: `[a-zA-Z0-9_.-]{1,80}` (ตั้งต้น `billing-v2-upfront-annual`)

### 3.3 วันครบรอบและระยะบริการ (`billing-package.ts`)

- เขตเวลาคิดรอบ: Asia/Bangkok (UTC+7 คงที่ `BANGKOK_OFFSET_MS`)
- `packageAnchorDay(instant)` = วันที่ของเดือนตามเวลาไทย
- `appendPackageInterval(start, interval, anchorDay, count)`: เลื่อนเดือนไป `(interval==='year' ? 12 : 1) × count` เดือน แล้ววางวันที่ = `min(anchorDay, วันสุดท้ายของเดือนปลายทาง)` — นับเดือนครั้งเดียวจากจุดเริ่ม เพื่อรักษาวันครบรอบ (31 ม.ค. + 3 เดือน = 30 เม.ย.) `count` 1–1200
- ซื้อแพ็กเต็ม (`fullPackagePurchaseImpact`): ถ้า `paidThrough` เดิม > เวลาที่จ่าย ("continuing") บริการเริ่มที่ `paidThrough` เดิมและใช้ anchor เดิม มิฉะนั้นเริ่มที่เวลาจ่ายจริง; `paidThrough ใหม่ = appendPackageInterval(serviceStartsAt, interval, anchor, offer.intervalCount)`; ใบเสร็จคงเหลือ = `(continuing ? คงเหลือเดิม : 0) + receiptAllowance` — สิทธิ์ที่หมดอายุแล้วไม่ถูกปลุกคืน
- โปรโมชัน (`promotionBoundaries`): `paidEnd = appendPackageInterval(S, interval, anchor)`; `benefitEnd = appendPackageInterval(S, 'month', anchor, (year?12:1) + bonusMonths)`; ใบแจ้งหนี้เก็บ `periodEnd = paidEnd`, `benefitEnd` แยก; "บริการสิ้นสุด" ของใบแจ้งหนี้ = `benefitEnd ?? periodEnd` (`invoiceServiceEnd`)

### 3.4 Upgrade แบบคิดส่วนต่างตามเวลา (`proratedPackagePrice`, `proratedReceiptIncrease`, `billing-upgrade.ts`)

สำหรับแต่ละ "ช่วงที่จ่ายแล้ว" (segment = receipt grant ชนิด INITIAL/RENEWAL/REPEAT ที่ `serviceEnd > at`):

```
remaining = max(0, end − max(at, start))        (มิลลิวินาที)
duration  = end − start
ถ้า at อยู่ในช่วง และเป็น "วันเดียวกันตามเวลาไทย" กับ start:
    amount = newPrice − oldPrice                 (เต็มจำนวน)
    units  = newAllowance − oldAllowance
มิฉะนั้น:
    amount = floor(((newPrice − oldPrice) × remaining × 2 + duration) / (2 × duration))   (ปัดครึ่งขึ้น, BigInt)
    units  = floor(((newAllowance − oldAllowance) × remaining × 2 + duration) / (2 × duration))
ยอดเรียกเก็บ = Σ amount ของทุก segment ; ใบเสร็จที่เพิ่ม = Σ units
```

- วันแถมฟรี (`GRANT_FREE_DAYS` ที่สำเร็จ) ไม่ถูกคิดเงิน ถูกข้ามใน timeline; ถ้าเวลาที่เหลือเป็นวันแถมล้วน → `BILLING_UPGRADE_GIFT_ONLY`
- ส่วนต่างรวม < 1,000 สตางค์ → `BILLING_UPGRADE_BELOW_MINIMUM`
- ต้องห่างจากปลายช่วงแรก > 2,401 วินาที (≈ 40 นาที) มิฉะนั้น `BILLING_UPGRADE_BOUNDARY`
- "upgrade" นิยามโดย `isUpgrade()`: interval เดียวกัน และอันดับ tier สูงกว่า
- ตรวจยอดกับ Stripe ด้วย `POST /invoices/create_preview` (ยอด ภาษี ต้องตรง `quoteTotals` ทุกสตางค์) ไม่ตรง → `BILLING_UPGRADE_REVIEW`
- ระหว่างช่วงสิทธิ์โปรโมชัน (ยังมี `benefitEnd` ในอนาคตและยังไม่คืนเงินเต็ม) ห้าม upgrade ทันที → `PROMOTION_UPGRADE_DEFERRED` (แจ้งวันที่ทำได้)

### 3.5 ส่วนลดจากงาน (sales-event ticket) (`billing-event-discount.logic.ts`, `sales-event.logic.ts`)

ให้ `P` = ฐานราคา (ราคาแพ็ก หรือส่วนต่าง upgrade), `D` = ส่วนลดของตั๋ว (ต้องเป็นบาทเต็ม: `D % 100 === 0`, `D > 0`)

```
ถ้า taxTreatment ≠ INCLUSIVE_VAT_7 :  unit = P − D
ถ้า INCLUSIVE_VAT_7              :  s = subtotal(P) − D ;  unit = s + round(s × 7 / 100)
ใช้ได้ก็ต่อเมื่อ  1000 ≤ unit < P        (ขั้นต่ำ 10 บาท; ไม่มีส่วนลดบางส่วน)
ยอดงวดนี้ = quoteTotals(unit) ;  ส่วนลดที่แสดง = P − unit
```

- ใช้ได้กับ: โหมดจ่ายครั้งเดียว (`CARD_ONCE`, `PROMPTPAY_ONCE`) ทุกชนิดการซื้อ (`INITIAL, RESTART, REPEAT, SCHEDULED_CHANGE, FULL_PACKAGE_UPGRADE, UPGRADE`); โหมดต่ออายุ (`CARD_AUTO`, `PROMPTPAY_RENEW`) เฉพาะงวดแรก (`INITIAL`, `RESTART`); ไม่ใช้กับดีล
- ยอดใน quote หลัก (`totalSatang`) คงเป็นราคาเต็ม (= ราคาต่ออายุ) ยอดงวดนี้อยู่ใน `eventDiscount.applied`
- เลือกตั๋วอัตโนมัติ = ตั๋วที่ลดได้มากสุด; เสมอกัน → หมดอายุก่อน → id น้อยกว่า; ผู้ซื้อระบุ serial เองได้
- เอกสาร Stripe มีข้อความ "ราคา … บาท · ส่วนลดจากงาน {ชื่องาน} −… บาท" (description) แต่ Stripe discount amount = 0 (ลดที่ unit_amount)

### 3.6 การคืนเงิน

- คืนผ่าน Stripe Credit Note (`POST /credit_notes`) ต่อใบแจ้งหนี้ ยอด 1 ถึง `refundLimitSatang` ต่อคำขอ; ต้องไม่เกินยอดที่จ่ายลบยอดที่คืนแล้ว (ตรวจจาก preview ของ Stripe `GET /credit_notes/preview`)
- ภาษีของยอดคืน (`taxSatang` ใน `BillingRefundOperation`) มาจาก projection ของ Stripe
- ห้ามคืนเมื่อ charge ถูก dispute (`CONTROL_REFUND_DISPUTED`), มี refund ค้าง (`CONTROL_REFUND_PENDING`) หรือคืนเต็มแล้ว (`CONTROL_REFUND_FULL`)

### 3.7 Grace period

`graceEnd = paidThrough + graceDays × 86,400,000 ms` (ดู FR-BILL-036)

### 3.8 เดือนโควตา (แบบเก่า)

`billingMonth()` คืน `monthKey = YYYY-MM` ตามเวลาไทย และ `resetsAt` = วันที่ 1 เดือนถัดไป 00:00 เวลาไทย ใช้กับ cadence `LEGACY_MONTH` และ `FREE_MONTHLY_3`

---

## 4. State machine ทั้งหมดของ billing

### 4.1 Subscription / บัญชี (`BillingAccount`)

`subscriptionState` เป็นสำเนาค่า `status` ของ Stripe Subscription (`NONE` เมื่อยังไม่มี) ค่าที่โค้ดอ้างถึง: `trialing`, `active`, `past_due`, `unpaid`, `canceled`, `incomplete_expired` ร่วมกับ `renewalMode` (`NONE | CARD_AUTO | CARD_ONCE | PROMPTPAY_ONCE | PROMPTPAY_RENEW`), `paidThrough`, `graceEndsAt`, `cancelAtPeriodEnd`, `collectionPauseJson`

```
(ไม่มีบัญชี) ──checkout──▶ activeAttemptId ตั้ง (กำลังจ่าย)
   ├─ จ่ายไม่สำเร็จ/หมดอายุ ──▶ ปล่อยช่อง (กลับสถานะก่อนหน้า)
   └─ จ่ายแล้ว + apply ──▶
        • CARD_AUTO: baseSubscriptionId ตั้ง, subscriptionState=active|trialing, nextChargeAt ตั้ง
        • PROMPTPAY_RENEW / CARD_AUTO แบบ prepaid: paidThrough ตั้งก่อน แล้วผูก subscription (trialing ถึงสิ้นงวด) ภายหลัง
        • CARD_ONCE / PROMPTPAY_ONCE: renewalMode=…_ONCE, billingAnchorDay ตั้ง, ไม่มี subscription
active ──ยกเลิกการต่ออายุ──▶ cancelAtPeriodEnd=true ──ถึง paidThrough──▶ canceled
active ──ต่ออายุสำเร็จ (invoice.paid)──▶ active (paidThrough เลื่อน, graceEndsAt=null)
active ──ตัดเงินไม่ผ่าน──▶ past_due/unpaid ──▶ graceEndsAt ตั้ง (สิทธิ์ยืดถึง graceEnd)
        ├─ จ่ายทันใน grace ──▶ active
        └─ เลย graceEnd ──▶ ระบบ DELETE subscription ──▶ canceled ──▶ term หมดอายุ ──▶ RESTART ได้
canceled / incomplete_expired + paidThrough ผ่านแล้ว ──ซื้อใหม่──▶ RESTART (attempt ใหม่)
```

สถานะที่แสดงต่อร้าน (`billingState()`, `domain/billing-state.ts`):

| ฟิลด์ | ค่า | กฎ |
|---|---|---|
| `accessState` | `HELD` | `company.status ≠ ACTIVE` และไม่ใช่กรณี `DISABLED` เพราะ term หมด (`termDisabledAt`) |
| | `EXPIRED` | มี plan term และ `termEndsAt ≤ now` |
| | `ACTIVE` | นอกนั้น |
| `paymentState` | `FAILED` | `subscriptionState ∈ {past_due, unpaid}` หรือ (`canceled` และมี `graceEndsAt`) |
| | `PAID` | มี invoice ของ attempt ปัจจุบันที่ `providerStatus = paid` หรือไม่มี attempt แต่ invoice ล่าสุด paid |
| | `UNKNOWN` | attempt สถานะ `UNKNOWN` |
| | `PENDING` | มี attempt ค้าง |
| | `NONE` | นอกนั้น |
| `applyState` | `NONE / PENDING / APPLIED / HELD / FAILED` | = `BillingInvoice.applyStatus` ของใบล่าสุด |
| `documentState` | `NONE / PENDING` | มี invoice = `PENDING` (ค่า `READY` มีใน contract แต่ `billingState()` ไม่เคยคืน) |

### 4.2 Plan term (`CompanyPlanTerm`) — `planTermState()` (`plan-term.ts:55`)

ลำดับการตัดสิน: `ADMIN_HOLD` (company ไม่ ACTIVE และไม่ใช่ถูกปิดเพราะ term) → ไม่มีแถว = `ACTIVE` (grandfathered, fail open) → `NO_PACKAGE` (`termEndsAt ≤ termStartAt` และ `renewCount = 0`) → `EXPIRED` (`termEndsAt ≤ now` หรือ `termDisabledAt`) → `TRIAL` (`tierKey = FREE_TRIAL_15`) → `ACTIVE`

สถานะสี (`derivePlanTermState`): `EXPIRED` เมื่อ `now ≥ termEndsAt`; `WARNING` เมื่อเหลือ ≤ `warningDays` วัน; นอกนั้น `ACTIVE`; `daysLeft = ceil(msLeft / 1 วัน)`

### 4.3 Payment attempt (`BillingAttempt.status`)

| สถานะ | ความหมาย | เปลี่ยนไป |
|---|---|---|
| `CREATING` | สร้างแถวและจองช่อง `activeAttemptId` แล้ว ยังไม่ส่งคำขอเงิน | `REQUESTING` (ผ่าน barrier ก่อนส่ง), `FAILED` (Stripe ปฏิเสธ/ยังไม่เริ่มคำขอเงิน), `UNKNOWN`, `EXPIRED` (`BILLING_CHECKOUT_NOT_STARTED`) |
| `REQUESTING` | กำลัง `POST /checkout/sessions` | `OPEN` (ได้ session), `FAILED` (REJECTED), `UNKNOWN` (timeout/ผลไม่ชัด), `EXPIRED` |
| `OPEN` | มี Checkout Session เปิดอยู่ (อายุ 30 นาที: `expires_at = now + 1800`) | `COMPLETED`, `EXPIRED` |
| `UNKNOWN` | ผลคำขอไม่ชัด — เปิด issue `UNKNOWN_ATTEMPT` และคงการจองไว้จน reconcile | `OPEN/COMPLETED/EXPIRED/FAILED` หลัง reconcile อ่าน Stripe |
| `COMPLETED` | Checkout จบ (session `complete`) | ปลายทาง (invoice ไป apply ต่อ) |
| `EXPIRED` | session หมดอายุ/ถูกยกเลิก/ไม่เคยเริ่ม | ปลายทาง ปล่อยช่อง คืนสิทธิ์ตั๋ว/โปรโมชัน |
| `FAILED` | ไม่ได้สร้าง Checkout (`errorCode` เช่น `request_rejected`, `BILLING_PROFILE_SYNC_RETRY`) | ปลายทาง |

กฎปล่อยการจอง: ปล่อยเฉพาะเมื่อ "รู้แน่ว่าไม่มีคำขอเงินสำเร็จ" (ยังไม่เริ่มคำขอเงิน หรือ Stripe ตอบ REJECTED) นอกนั้นคงไว้ให้ reconciler; attempt ที่ไม่มี session ที่ Stripe จะถูกปิดเมื่อเงียบ ≥ 10 นาที (ร้านกดยกเลิกเอง = 60 วินาที; attempt ที่ถือสิทธิ์โปรโมชันรอ `createBy` = 10 นาทีจากจอง)

### 4.4 Invoice (`BillingInvoice`)

`providerStatus`: โค้ดบันทึกเฉพาะใบที่ `paid`; `applyStatus`:

| applyStatus | ความหมาย | สาเหตุ / ทางออก |
|---|---|---|
| `PENDING` (ค่าตั้งต้นของแถว) | บันทึกแล้ว รอ apply | reconcile รอบถัดไป |
| `APPLIED` | เขียน plan term, receipt grant, เมนู, account แล้ว (`appliedAt`) | ปลายทาง |
| `HELD` | จ่ายแล้วแต่ยังให้สิทธิ์ไม่ได้ `errorCode`: `BILLING_CAP_SELECTION_REQUIRED` (ร้านต้องเลือกสาขา/ผู้ใช้ที่คงไว้), `BILLING_ENTITLEMENT_REVIEW_REQUIRED` (ชุดเมนูเปลี่ยน), `access_review_required` (บริษัทถูกพัก, dispute/refund, ช่วงเวลาไม่ตรง, term เปลี่ยน ฯลฯ) | เปิด issue `PAID_HELD`; ร้านซ่อม capacity เอง หรือผู้ดูแลกด `RETRY_APPLY` |
| `FAILED` | มีใน contract; ไม่พบจุดเขียนค่านี้ใน reconciler ที่อ่าน | — |

ฟิลด์การเงินที่ติดตามหลังจ่าย: `refundedSatang`, `disputed`, `financialObservedAt`, `feeSatang`

### 4.5 Refund (`BillingOperation` type `REFUND`)

```
PREVIEW ──submit (ผู้ขอ, ต้อง reauth)──▶ AWAITING_APPROVAL ──approve──▶ QUEUED ──run/worker──▶ RUNNING
RUNNING ──สร้าง credit note + อ่านกลับ──▶ SUCCEEDED (refund succeeded)
                                       ├▶ QUEUED (refund ยัง pending/requires_action → อ่านซ้ำทุก 5 นาที)
                                       └▶ FAILED (refund failed/canceled → CONTROL_REFUND_FAILED)
RUNNING ──error──▶ UNKNOWN | BLOCKED | FAILED (CONTROL_REFUND_PROVIDER_REJECTED / _UNAVAILABLE / _REVIEW / CONTROL_REFUND_NOT_CREATED)
PREVIEW | AWAITING_APPROVAL ──cancel──▶ CANCELLED
```

สถานะ refund ที่ Stripe (`refundState`): `pending | requires_action | succeeded | failed | canceled`; PromptPay: Stripe คืนเงินหลังลูกค้าตอบอีเมลของ Stripe เท่านั้น จึงค้าง `requires_action` ได้ (เปิด issue `CONTROL_OPERATION_REVIEW`)

### 4.6 Command / Operation ทั่วไป (`BillingOperationState`)

`DRAFT → PREVIEW → AWAITING_APPROVAL → SCHEDULED → QUEUED → RUNNING → SUCCEEDED | UNKNOWN | BLOCKED | FAILED | CANCELLED` และสถานะเสริมที่โค้ดใช้กับคำสั่งเปลี่ยนแพ็ก: `APPLIED`, `SUPERSEDED`

| ชนิดคำสั่ง | วงจรที่ใช้จริง |
|---|---|
| คำสั่งของร้าน (`CANCEL_RENEWAL`, `RESUME_RENEWAL`, `SCHEDULE_DOWNGRADE`, `CANCEL_DOWNGRADE`, เปลี่ยนอีเมลผู้รับ) | `PREVIEW → QUEUED → RUNNING → SUCCEEDED / UNKNOWN / FAILED`; ถอน = `CANCELLED`; downgrade ที่ตั้งไว้ค้าง `SUCCEEDED` (ชี้โดย `pendingPlanChangeId`) จนใบต่ออายุงวดใหม่ apply → `APPLIED` หรือถูกแทน → `SUPERSEDED` |
| ตั้งค่า (`PUBLISH_POLICY`, `SET_ACTION_GATE`) | `DRAFT → PREVIEW → AWAITING_APPROVAL → (SCHEDULED →) SUCCEEDED`; `BLOCKED` เมื่อถึงเวลาแล้วสิทธิ์/ข้อมูลเปลี่ยน |
| ซ่อม (`RECONCILE`, `IMPORT_INVOICE`, `RETRY_APPLY`, `RETRY_NOTIFICATION`, `RECONCILE_NOTIFICATION`, `RETRY_PROVIDER_EVENT`) | `PREVIEW → QUEUED → RUNNING → SUCCEEDED / FAILED / BLOCKED`; retry / cancel ได้ |
| ปรับสิทธิ์ (`GRANT_OVERRIDE`, `REVOKE_OVERRIDE`, `GRANT_FREE_DAYS`, `CHANGE_COLLECTION`, `GRANT_RECEIPTS`, `REVOKE_RECEIPTS`, `ADDON_ADMIN_GRANT`, `ADDON_ADMIN_REVOKE`, `GRANT_SCOPE`, `REVOKE_SCOPE`, `UPDATE_BILLING_EMAIL` ฝั่งผู้ดูแล, `EXPIRE_CHECKOUT`) | `PREVIEW → AWAITING_APPROVAL → SUCCEEDED` (หรือ `QUEUED → RUNNING` เมื่อต้องเรียก Stripe) |
| ระบบสร้างเอง (`GRACE_EXPIRE`, `CUSTOMER_CAP_SELECTION_REPAIR`, `CUSTOMER_ADVANCE_RENEWING_DEAL`, `CUSTOMER_PREPAID_PLAN_CHANGE`, `SCHEDULE_PRICE_RETURN`, `DEAL_SUBSCRIPTION_CANCEL`, `APPLY_PLAN_MENUS`, `CUSTOMER_PROFILE_SYNC`, `OBSERVE_PROVIDER_INVOICE`, `SCAN_PROVIDER_INVOICES`, `SCAN_PROVIDER_BALANCE`, `CONFIGURE_PROVIDER_SCANS`, `CHECK_PROVIDER_CONFIGURATION`, `RECORD_SUPPORT_OUTCOME`, `PROMOTION_CAMPAIGN_DRAFT`) | ตามตารางในแต่ละ FR |

preview ทุกชนิดมีอายุ 10 นาที (`expiresAt = now + 600,000 ms`) และต้องส่ง `expectedVersion` + `previewHash` กลับมาตรงกัน มิฉะนั้น `CONTROL_PREVIEW_STALE`

### 4.7 Provider event (`BillingProviderEvent.status`)

`PENDING → PROCESSING → PROCESSED` ; ล้มเหลว → `RETRY` (backoff `min(3600, 30 × 2^min(attempts,7))` วินาที) ; ครั้งที่ 10 → `DEAD` + issue `PROVIDER_EVENT_FAILED` ; ผู้ดูแล retry `DEAD` ได้ ; lease 120 วินาที

### 4.8 Issue (`BillingIssue.state`)

`OPEN → (สถานะที่ผู้ดูแลตั้ง) → RESOLVED`; ตรวจพบซ้ำหลัง `RESOLVED` → กลับ `OPEN`, `episode + 1`, ล้างผู้รับผิดชอบและกำหนดติดตาม; `priority`: `HIGH` สำหรับ `PAID_HELD`, `PAID_NOT_APPLIED`, `FINANCIAL_REVIEW`, `DUPLICATE_SUBSCRIPTION`; นอกนั้น `NORMAL`; SLA (`slaDueAt`) = เวลาเปิด episode + `supportSlaMinutes[priority]`

### 4.9 Promotion right (`BillingPromotionRedemption.state`)

`RESERVED` (จองพร้อม attempt, `createBy` = +10 นาที) → `CONSUMED` (จ่ายแล้ว; `benefitAppliedAt` เมื่อ apply) ; `RESERVED → RELEASED` (พิสูจน์ได้ว่าไม่ได้จ่าย; `releaseCount + 1`; แถวเดิมจองใหม่ได้) ; หลังคืนเงินเต็ม → `entitlementAdjustedAt` (สถานะการปรับ: `NOT_REQUIRED | PENDING | REVIEW | ADJUSTED`)

### 4.10 Sales-event ticket และ batch

Ticket: `ISSUED → RESERVED (กำลังจ่าย) → USED` ; `RESERVED → ISSUED` (ปล่อยเมื่อ Checkout ไม่ได้จ่าย) ; `ISSUED → REVOKED` ; "หมดอายุ" ไม่ถูกเก็บ = `ISSUED` ที่ `expiresAt` ผ่านแล้ว
Batch: `OPEN ⇄ PAUSED` (PAUSE/RESUME) ; `OPEN|PAUSED → SUSPENDED` (SUSPEND) ; `SUSPENDED → PAUSED` (LIFT)

### 4.11 Sales deal (`PackageChangeRequest.status`, kind `SALES_DEAL`)

`DRAFT → PENDING_APPROVAL → APPROVED → PAID → APPLIED` ; `APPROVED → APPLIED` (จ่ายครั้งเดียว apply ใน commit เดียว) ; `APPROVED → EXPIRED` (เลย 3 วัน) ; `EXPIRED → APPLIED` (เฉพาะกรณี Checkout จ่ายแล้วแข่งกับ sweep) ; `PENDING_APPROVAL → REJECTED → DRAFT` ; `DRAFT|PENDING_APPROVAL|APPROVED|REJECTED → CANCELLED` ; ปลายทาง: `APPLIED, EXPIRED, CANCELLED` ; `priceState` ของดีลต่ออายุ: `PENDING → READY | FAILED → ARCHIVED`

---

## 5. Stripe: object, API call และ event ที่โค้ดจัดการ

### 5.1 Adapter (`infrastructure/stripe.client.ts`)

- เรียก `https://api.stripe.com/v1{path}` ด้วย `fetch` ตรง (ไม่ใช้ SDK) header `Stripe-Version: 2026-08-26.dahlia` (`STRIPE_API_VERSION`), body แบบ `application/x-www-form-urlencoded`, timeout 15 วินาที, `redirect: 'error'`
- เงื่อนไขก่อนเรียก: `billingMode ≠ disabled`, secret key ขึ้นต้น `sk_live_` (live) หรือ `sk_test_` (test) ตรงกับโหมด, มี `stripeAccountId`; path ต้องตรง `^/[a-z_]+(/[a-zA-Z0-9_]+)*$`
- ผลลัพธ์จัดเป็น 3 ชนิด (`StripeRequestError.outcome`): `REJECTED` (4xx ที่ไม่ใช่ 429), `RETRY` (429, เคารพ `retry-after` 1–86,400 วินาที, ตั้งต้น 60), `UNKNOWN` (5xx, เครือข่าย, JSON เสีย, `livemode` ไม่ตรง)
- เก็บจากคำตอบที่ถูกปฏิเสธเฉพาะ `error.code` และ `error.type` ที่เป็น token `[a-z0-9_]{1,64}` — ไม่ส่ง body ของ Stripe ลง log
- `assertAccount()`: `GET /account` ต้องได้ `id = stripeAccountId`
- `list()`: แบ่งหน้า `limit=100` สูงสุด 20 หน้า เกิน → `list_incomplete`
- `safeStripeUrl()`: ยอมเฉพาะ `https://checkout.stripe.com` (checkout), `billing.stripe.com` (portal), `invoice.stripe.com | pay.stripe.com | payments.stripe.com` (เอกสาร)
- `verifyStripeSignature()`: header `stripe-signature` (`t=…,v1=…`), HMAC-SHA256 ของ `"{t}.{rawBody}"` ด้วย webhook secret, เวลาคลาด ≤ 300 วินาที, body ≤ 262,144 ไบต์, เทียบแบบ timing-safe

### 5.2 Idempotency key ที่ส่งให้ Stripe

| การกระทำ | key |
|---|---|
| สร้าง Customer | `mm:{billingAccountId}:customer` |
| sync ชื่อ/ที่อยู่/อีเมล Customer | `mm:{attemptId}:billing-profile` |
| สร้าง Checkout Session | `mm:{attemptId}:checkout` |
| คำสั่ง collection ของร้าน | `mm:collection:{operationId}` และ `mm:collection:{operationId}:create` (สร้าง schedule) |
| ยกเลิก subscription เมื่อพ้น grace | `grace-expire:{accountId}:{paidThrough ms}` |
| Credit note คืนเงิน | `billing-refund-{operationId}` |

### 5.3 Stripe object ที่โค้ดอ่าน/เขียน

| Object | การใช้งาน | Endpoint ที่เรียก |
|---|---|---|
| Account | ยืนยันบัญชี, ตรวจ default tax id | `GET /account` |
| Customer | 1 ร้าน = 1 Customer ต่อโหมด; `metadata.billingAccountId` คือพันธะ; sync `name`, `address` (เมื่อ profile ครบ 5 ส่วน), `email` (ผู้รับเอกสาร) | `POST /customers`, `GET /customers/:id`, `POST /customers/:id`, `GET /customers` (ค้นด้วย metadata เมื่อผลสร้างไม่ชัด) |
| Product / Price | ราคา catalog (recurring, `per_unit`, `licensed`, `interval_count = 1`, `thb`, `unit_amount` = ราคา offer, `tax_behavior` ตรง policy), ราคา 0 บาท (`zeroPriceIds`) สำหรับจัดรอบ prepaid, ราคาเฉพาะดีลต่ออายุ (สร้างตอนอนุมัติดีลบน Product ของ tier ฐาน) | `GET /prices/:id`, `GET /prices`, `POST /prices`, `POST /prices/:id` (archive) |
| Tax Rate / Tax ID | ตรวจ VAT 7% TH | `GET /tax_rates/:id`, `GET /tax_ids/:id` |
| Checkout Session | `mode: subscription` (CARD_AUTO ปกติ) หรือ `mode: payment` + `invoice_creation.enabled` (ครั้งเดียว, PromptPay, งวดแรก prepaid); `client_reference_id = attemptId`; `metadata {billingAttemptId, billingAccountId}`; `locale: 'th'`; `billing_address_collection: 'required'`; `customer_update.address = 'never'` (profile ครบ) หรือ `'auto'`; `payment_method_types = ['card']` หรือ `['promptpay']`; `subscription_data.billing_mode.type = 'classic'` | `POST /checkout/sessions`, `GET /checkout/sessions/:id`, `GET /checkout/sessions` (list ตาม customer), `GET /checkout/sessions/:id/line_items`, `POST /checkout/sessions/:id/expire` |
| Subscription | สมาชิกตัดบัตร (`charge_automatically`) หรือออกบิล QR (`send_invoice`, `payment_method_types = ['promptpay']`); `metadata.billingAccountId` / `billingAttemptId`; `cancel_at_period_end`, `cancel_at`, `pause_collection` | `GET /subscriptions/:id`, `GET /subscriptions` (list), `POST /subscriptions`, `POST /subscriptions/:id`, `DELETE /subscriptions/:id` (`invoice_now: false, prorate: false`) |
| Subscription Schedule | downgrade ปลายรอบ, เปลี่ยนรอบ prepaid, คืนราคาปกติหลังดีลครบรอบ (`end_behavior: release`) | `POST /subscription_schedules` (`from_subscription`), `GET /subscription_schedules/:id`, `POST /subscription_schedules/:id` |
| Invoice + lines | หลักฐานการจ่าย; ต้องมี 1 line, ไม่มี discount/credit, `amount_paid = total`, `starting_balance = 0`; subscription: `billing_reason ∈ {subscription_create, subscription_cycle}`; ครั้งเดียว: `billing_reason = manual`, `collection_method = send_invoice`, `parent = null` | `GET /invoices/:id`, `GET /invoices` (list), `GET /invoices/:id/lines`, `POST /invoices/create_preview`, `POST /invoices/:id/send` (ส่งเอกสารซ้ำ) |
| Invoice Payment | ผูก invoice ↔ PaymentIntent (ต้องมี 1 รายการ `status: paid`) | `GET /invoice_payments` |
| PaymentIntent / Charge / PaymentMethod | `intent.status = succeeded`, `charge.paid && captured`, `payment_method_details.type` = `card` หรือ `promptpay`; `amount_refunded`, `disputed`; ค่าธรรมเนียมจาก `balance_transaction.fee`; บัตรที่บันทึกไว้สำหรับผูก subscription ภายหลัง | `GET /payment_intents/:id` (`expand: latest_charge.balance_transaction`), `GET /charges/:id`, `POST /charges/:id`, `GET /payment_methods/:id` |
| Refund / Credit Note | คืนเงินผ่าน credit note; อ่านสถานะ refund | `POST /credit_notes`, `GET /credit_notes/preview`, `GET /credit_notes/:id`, `GET /refunds/:id` |
| Dispute | อ่านเพื่อหา charge | `GET /disputes/:id` |
| Billing Portal | เฉพาะ flow `payment_method_update`; configuration ต้อง `payment_method_update.enabled = true`, `subscription_update.enabled = false`, `subscription_cancel.enabled = false`, ห้ามแก้ email | `GET /billing_portal/configurations/:id`, `POST /billing_portal/sessions` |
| Event | สแกนย้อนหลังหา event ที่ webhook พลาด | `GET /events` |
| Balance Transaction / Payout | settlement (ยอดรับ ค่าธรรมเนียม ภาษี payout) | `GET /balance_transactions`, `GET /payouts/:id` |

### 5.4 Webhook event ที่รับ (`BILLING_STRIPE_EVENTS`, `billing-reconciler.service.ts:44`)

Endpoint: `POST /v1/public/stripe-events` (public, ตรวจลายเซ็น) event ที่ไม่อยู่ในชุดนี้ตอบ `{accepted:true}` แล้วทิ้ง event ต้องผ่าน `validBillingEvent()`: `object = 'event'`, id `evt_…`, `api_version = 2026-08-26.dahlia`, `livemode` ตรงโหมด, `account` ว่างหรือตรงบัญชี, `data.object.id` รูปแบบถูก

**หลักการ:** ระบบไม่เชื่อ payload ของ event — เก็บเพียง `eventId`, `eventType`, `objectId`, `apiVersion`, hash ของ raw body ลง `BillingProviderEvent` แล้ว worker อ่าน object สดจาก Stripe (`handle()`), หา `BillingAccount` จาก `customer`, แล้วเรียก `reconcileAccount()` ซึ่งคำนวณสถานะทั้งหมดใหม่จาก Stripe ทุก event จึงให้ผลเดียวกัน (idempotent)

| Event | object ที่อ่านสด | ผลเฉพาะ event (นอกเหนือจาก `reconcileAccount`) |
|---|---|---|
| `checkout.session.completed` | Checkout Session | attempt → `COMPLETED`; ถ้า `mode: payment` ตรวจหลักฐานและ apply ใบแจ้งหนี้ครั้งเดียว; จับอีเมล/ที่อยู่จาก Checkout เป็นผู้รับเอกสาร (งวดแรกเท่านั้น) |
| `checkout.session.expired` | Checkout Session | attempt → `EXPIRED`, ปล่อย `activeAttemptId`, คืนตั๋วส่วนลด/สิทธิ์โปรโมชัน |
| `checkout.session.async_payment_succeeded` | Checkout Session | (PromptPay) เหมือน completed — จ่ายสำเร็จภายหลัง |
| `checkout.session.async_payment_failed` | Checkout Session | (PromptPay) reconcile อ่าน session สด: `expired` + `payment_status = unpaid` + ไม่มี invoice → attempt `EXPIRED` และคืนสิทธิ์; session ที่ `complete` แต่ยังไม่ `paid` → attempt ถูกตั้งเป็น `UNKNOWN` (คงการจอง) จน session เปลี่ยนสถานะ (`reconcileOneTime`, `billing-reconciler.service.ts:580-595`) |
| `invoice.paid` | Invoice | ตรวจ `paidInvoiceEvidence` แล้ว apply (งวดแรก = `INITIAL`, ต่ออายุ = `RENEWAL`) |
| `invoice.payment_failed` | Invoice | reconcile → subscription `past_due/unpaid` → เริ่ม grace |
| `invoice.payment_action_required` | Invoice | reconcile (สถานะการจ่ายสะท้อนผ่าน subscription) |
| `invoice.finalization_failed` | Invoice | reconcile; ถ้าทำต่อไม่ได้ pass ล้มเหลว → issue `RECONCILIATION_FAILED` |
| `customer.subscription.created` | Subscription | ผูก `baseSubscriptionId` (ต้องมี `metadata.billingAccountId` ตรง) |
| `customer.subscription.updated` | Subscription | อัปเดต `subscriptionState`, `cancelAtPeriodEnd`, `nextChargeAt`, `collectionPauseJson` |
| `customer.subscription.deleted` | Subscription | `subscriptionState = canceled`, `nextChargeAt = null`; ปิดคำสั่ง `GRACE_EXPIRE` ที่ค้าง |
| `charge.refunded` | Charge | บันทึก `refundedSatang` (`recordBillingFinancials`); ถ้าไม่พบ invoice ของ charge นั้น → issue `FINANCIAL_REVIEW` |
| `charge.dispute.created` / `.updated` / `.closed` | Dispute → Charge | บันทึก `disputed`; ไม่พบ invoice → `FINANCIAL_REVIEW` |
| `refund.created` / `refund.updated` | Refund → Charge | เหมือน `charge.refunded` |
| `refund.failed` | Refund → Charge | เพิ่ม issue `REFUND_FAILED` |

การแมปบัญชี: หา `BillingAccount` ด้วย `(stripeAccountId, livemode, customerId)`; ไม่พบ → อ่าน Customer แล้วใช้ `metadata.billingAccountId` ได้ก็ต่อเมื่อบัญชีนั้นยังไม่มี customer อื่นและมี attempt ค้าง มิฉะนั้น `billing.account_unmapped` (event ถูก retry แล้ว `DEAD`)

---

## 6. Permission keys `system.*` และการอนุมัติ

### 6.1 Permission ของ billing (`BILLING_PERMISSIONS`, 15 ตัว — ลงทะเบียนใน `apps/api/src/modules/auth/permission-registry.ts:32`)

| Key | ความเสี่ยง | ใช้ทำอะไรในโค้ด |
|---|---|---|
| `system.billing.read` | MEDIUM | เปิดคอนโซล billing, อ่าน overview/บริษัท/issue/operation/event/scan/การตั้งค่า; เป็นเงื่อนไขขั้นต่ำของทุก endpoint ผู้ดูแล (`operationLimit`) |
| `system.billing.financial.read` | MEDIUM | อ่านยอดเงิน ใบแจ้งหนี้ การคืนเงิน settlement การปรับสิทธิ์ และ reauth ระดับบริษัท |
| `system.billing.document.read` | MEDIUM | เปิดเอกสาร Stripe ของร้าน (`documents/:invoiceId/open`) |
| `system.billing.issue.manage` | HIGH | แก้ issue, มอบหมาย, บันทึก support outcome |
| `system.billing.reconcile.run` | CRITICAL | สั่ง reconcile/นำเข้าใบแจ้งหนี้, provider scan, settlement, configuration check, batch, retry provider event |
| `system.billing.apply.retry` | CRITICAL | คำสั่ง `RETRY_APPLY` |
| `system.billing.policy.manage` | CRITICAL | เผยแพร่ policy และทุกคำสั่งของแคมเปญโปรโมชัน |
| `system.billing.gate.manage` | CRITICAL | เปิด/ปิด gate, ปิดฉุกเฉิน, สั่งให้ Checkout หมดอายุ |
| `system.billing.approval.approve` | CRITICAL | อนุมัติคำสั่ง (ร่วมกับกฎ 6.3) |
| `system.billing.notification.retry` | CRITICAL | `RETRY_NOTIFICATION`, `RECONCILE_NOTIFICATION` |
| `system.billing.collection.manage` | CRITICAL | พัก/เปิดการเรียกเก็บ (`CHANGE_COLLECTION`) |
| `system.billing.refund.manage` | CRITICAL | สร้าง/ส่ง/รันคำขอคืนเงิน, ยุติแพ็กเกจหลังคืนเงิน |
| `system.billing.override.manage` | CRITICAL | ปรับเพดานชั่วคราว วันแถม ใบเสร็จแถม add-on แถม เปลี่ยนผู้รับเอกสารแทนร้าน ส่งเอกสารซ้ำ |
| `system.billing.audit.read` | MEDIUM | รวมรายการ audit ใน timeline |
| `system.billing.export` | CRITICAL | ส่งออก timeline และผล batch เป็น CSV |

นอกจากนี้ endpoint ขอบเขตผู้ปฏิบัติงาน (`operator-scopes`, `scope-directory`, `scope-changes`) ใช้ `admin.role.manage` และต้องเป็น `SYSTEM_ADMIN` ที่ role มี permission นี้ (`canManageScopes`)

**การคำนวณสิทธิ์จริง (`BillingAdminService.access()`, `billing-admin.service.ts:73`):** ผู้เรียกต้องมี membership ACTIVE ในบริษัท ACTIVE; `capabilities` = permission `system.billing.*` ที่มาจาก role ระบบ (`isSystem`, `scopeKey = 'system'`, `companyId = null`, ACTIVE) **และ** อยู่ใน `context.permissions`; `platformScope` = มี role `SYSTEM_ADMIN`; ผู้ที่ไม่ใช่ platform scope เห็นเฉพาะบริษัทใน `BillingOperatorScope` ที่ยังไม่ถูกเพิกถอนและไม่หมดอายุ

### 6.2 Permission `system.*` อื่นที่หน้า `/system/**` ใช้

| Key | ความเสี่ยง | ใช้กับ |
|---|---|---|
| `system.partner_dashboard.read` | MEDIUM | รายการ/รายละเอียดร้าน, plan term, team note, AI usage, credit holds |
| `system.partner_company.create` | HIGH | สร้างบริษัทลูกค้า |
| `system.partner_company.update` | MEDIUM | แก้ profile ร้าน, plan term (ตั้ง/ต่ออายุ/จบ warm-up), VAT registration, team note, ส่ง LINE ถึงร้าน, คิวคำขอเปลี่ยนแพ็ก, กล่อง support requests |
| `system.partner_company.lifecycle.manage` | CRITICAL | เปิด/ปิด/เก็บถาวรร้าน |
| `system.partner_feature.manage` | HIGH | เปิดปิดเมนู, manual expense web entry, disbursement voucher web entry |
| `system.partner_ai_model.manage` | HIGH | รุ่น AI ของร้าน, OCR config, ปล่อย/คิด credit hold, งบ AI แพลตฟอร์ม (`/system/ai-budget`) |
| `system.partner_line_credential.manage` | CRITICAL | LINE credential ของร้าน |
| `system.partner_member.read` | HIGH | รายชื่อสมาชิกร้าน, ค้นผู้ใช้ (`system/users/lookup`) |
| `system.partner_member.manage` | CRITICAL | รีเซ็ต/เปิดดูรหัสชั่วคราว, ยกเลิกผูก LINE, ออก link token, แก้ข้อมูลติดต่อ/ชื่อ |
| `system.company_onboarding.create` | HIGH | สร้าง onboarding, ตัดสินคำขอสมัคร, ออก claim ใหม่ |
| `system.company_onboarding.read` | MEDIUM | อ่าน onboarding, คิวคำขอสมัคร, timeline ร้าน |
| `system.company_onboarding.regenerate_temporary_password` | CRITICAL | ออกรหัสชั่วคราวเจ้าของใหม่, ออก LINE link เจ้าของใหม่ |
| `system.email_delivery.read` / `.manage` | HIGH | หน้า email delivery / นโยบายเก็บประวัติ |
| `system.line_binding.manage` | HIGH | LINE channel binding ของลูกค้า |
| `system.shared_line_credential.manage` | CRITICAL | credential ของ OA กลาง (`/system/line-settings`) |
| `system.home_theme.manage` | HIGH | ธีมหน้าแรกสาธารณะ |
| `system.executive.read` / `.export` / `.contact.read` | MEDIUM/HIGH/HIGH | รายงานผู้บริหาร |
| `system.executive.company_note.manage` (`COMPANY_TEAM_NOTE_MANAGE_PERMISSION`, `packages/contracts/src/company-team-note.ts`) | MEDIUM | แก้บันทึกของทีมต่อร้านจากรายงานผู้บริหาร (`system.company_team_note.update` เป็นชื่อ audit action ไม่ใช่ permission) |
| `system.executive_user.manage` | CRITICAL | บัญชีผู้บริหาร |
| `system.wht_income_category.manage` | HIGH | เปิด–ปิดประเภทเงินได้หัก ณ ที่จ่าย |
| `system.entitlement_exception.manage` | HIGH | แก้ข้อยกเว้น dependency ของ entitlement |
| `system.launch_gate.read` / `.manage` | MEDIUM/CRITICAL | launch gate และ `/system/platform-access` |
| `system.identity_reconciliation.resolve` | CRITICAL | กระทบยอดเลขภาษี/สาขา, แก้ identity ร้าน |
| `system.data_rights.manage` | CRITICAL | เคส data rights |

Permission ฝั่งขาย (`SALES_PERMISSION_KEYS` + demo): `sales.console.read`, `sales.company.search`, `sales.deal.create`, `sales.deal.approve`, `sales.team.manage`, `sales.report.read`, `sales.agent_profile.manage`, `sales.event.manage`, `sales.demo_link.create` — role แพลตฟอร์ม: `SYSTEM_ADMIN`, `MANGMEE_SALES_LEAD`, `MANGMEE_SALES` (`SALES_ROLE_KEYS`), `MANGMEE_EXECUTIVE`, `MANGMEE_EXECUTIVE_EXPORT`, `MANGMEE_EXECUTIVE_CONTACT`, `MANGMEE_EXECUTIVE_COMPANY_NOTE`

หมายเหตุ: คีย์รูป `system.release_operation.*`, `system.admin.cutover.*` ปรากฏใน contracts แต่ไม่มีหน้าใน `/system/**` (ดูหัวข้อ 21)

### 6.3 การอนุมัติ, dual control และกฎผู้ดูแลคนเดียว

`canApproveBillingChange()` (`application/billing-approval.ts`):

```
อนุมัติได้ เมื่อ  ผู้อนุมัติมี system.billing.approval.approve
            และ ( ผู้อนุมัติ ≠ ผู้ขอ
                  หรือ ( ผู้อนุมัติมี platformScope (SYSTEM_ADMIN) และมี permission "manage" ของคำสั่งนั้นเอง ) )
```

- ผลบันทึกเป็น `approvalMode`: `SECOND_REVIEWER` (คนละคน) หรือ `SINGLE_ADMIN` (คนเดียวกัน) — แสดงในทุก view ของ operation
- ผู้ปฏิบัติงานที่ได้สิทธิ์แบบ scope รายบริษัท (ไม่ใช่ platform scope) อนุมัติคำสั่งของตัวเองไม่ได้เสมอ ("Single-admin confirmation never extends delegated billing authority")
- ทุก submit/approve/run ของคำสั่งสำคัญต้องมี "หลักฐานยืนยันรหัสผ่าน" (`requireProof`): ผู้ใช้เรียก `POST system/billing/reauthenticate` ด้วยรหัสผ่านปัจจุบัน → ประทับ `AuthSession.billingReauthenticatedAt` + `billingCredentialVersion`; ใช้ได้ 5 นาที (`300_000 ms`) หรือจน session/credential หมดอายุ; เปลี่ยนรหัสผ่านแล้วหลักฐานเดิมใช้ไม่ได้; ไม่มี → `CONTROL_REAUTH_REQUIRED`; รหัสผิด → `CONTROL_REAUTH_FAILED`; จำกัด 5 ครั้ง/5 นาที/ผู้ใช้
- ตอนรันจริง ระบบตรวจซ้ำว่า ผู้ขอและผู้อนุมัติยังมีสิทธิ์และ credential version เดิม (`operationActor`, `actors`) มิฉะนั้น `CONTROL_PERMISSION_CHANGED`
- กฎเดียวกันกับโมดูลอื่น: ดีลขาย (`selfApproved` = ผู้อนุมัติเป็นเจ้าของดีลเอง ถูกบันทึกและแสดง), data rights (`*SingleAdmin` + เหตุผล, permission-step `system.data_rights.single_admin_step` เป็น audit action)

### 6.4 Gate (`BILLING_ACTIONS`)

`new_sales`, `card_once`, `promptpay_once`, `promptpay_renew`, `plan_changes`, `portal_payment_method`, `portal_change_plan`, `portal_cancel_subscription`, `notification_delivery`, `refunds` — ค่าตั้งต้นปิดทั้งหมด (`CLOSED_GATES`); `portal_change_plan` ถูกบังคับเป็น `false` เสมอ (`effectiveBillingGates`) และตั้งเป็น `true` ไม่ได้ (`CONTROL_ACTION_NOT_SUPPORTED`); เปิด `refunds` ได้เมื่อ policy มี `refundPolicy = MANUAL_REVIEW` และ `refundLimitSatang` (`CONTROL_REFUND_CONFIG_REQUIRED`)

---

## 7. ข้อกำหนดฟังก์ชัน — ฝั่งลูกค้า (ร้าน)

**ข้อกำหนดร่วมของทุก FR ในหัวข้อนี้ (เว้นแต่ระบุเป็นอื่น)**

- **ผู้ใช้/สิทธิ์:** ผู้ใช้ของร้านที่ล็อกอินแล้ว (`account.session.read` ที่ระดับ controller) และผ่าน `BillingService.assertOwner()` = membership ACTIVE, user ACTIVE และ `canManagePlan(roles)` (เจ้าของร้านหรือ role ที่มี `company.plan.manage`) มิฉะนั้น 403 "ต้องได้รับสิทธิ์จัดการแพ็กเกจบริษัท"
- **แพ็กที่ได้ใช้:** ทุกร้านทุกแพ็ก รวมร้านที่ยังไม่มีแพ็กเกจหรือหมดอายุ (เส้นทาง billing เป็น "recovery route" ที่ร้านถูกล็อกยังเข้าได้; `isBillingCustomerRecoveryPath()` ครอบ `/companies/:id/billing`, `/billing/return`, `/billing/invoices/:id`)
- **Rate limit:** คำสั่งทุกตัวที่เรียก `limit()` = 30 ครั้ง/60 วินาที ต่อ `(companyId, userId)` → 429 `BILLING_RATE_LIMIT`
- **รูปแบบข้อผิดพลาด:** ข้อผิดพลาดทางธุรกิจเป็น HTTP 409 `{code, message}` (`billingError`), input ผิดรูป 400 `BILLING_INPUT_INVALID` (ฟิลด์เกิน/ชนิดผิดถูกปฏิเสธด้วย `bodyFields()`)
- **Base route:** `/v1/companies/:companyId/billing` (`BillingController`)
- **หน้าจอ:** `/companies/[companyId]/billing`, `/billing/preview`, `/billing/return`, `/billing/invoices/[invoiceId]` (ใน `apps/web/app/(workspace)/…`), ตัวเลือกร้าน `/billing/companies`; component ใน `apps/web/features/billing/**`

### FR-BILL-001 แค็ตตาล็อกแพ็กเกจสาธารณะ

- **คำอธิบาย:** คืนรายการ offer 8 รายการ (4 tier × month/year) พร้อมราคา เพดาน เมนู ความพร้อมขาย และโปรโมชันที่เปิดอยู่
- **ผู้ใช้/สิทธิ์:** สาธารณะ (`@Public`), ไม่ต้องล็อกอิน
- **เงื่อนไขก่อนทำ:** ไม่มี; เมื่อ billing ปิด (`DISABLED`) คืน offer ทั้งหมด `UNAVAILABLE`
- **ขั้นตอนหลัก:** อ่าน `BillingSettings` + revision ที่ ACTIVE → สร้าง `billingOffer()` ทุกคู่ → ตั้ง `AVAILABLE` เมื่อ มี policy, `salesCompanyIds ≠ []`, gate `new_sales` เปิด, มี `priceIds[tier:interval]` และ `assertPolicyReady` ผ่าน
- **กฎธุรกิจ:** `ENTERPRISE_1999` ที่ยังไม่ผูก Price → `COMING_SOON`; tier อื่น → `UNAVAILABLE` + `BILLING_NOT_READY`; `validUntil = generatedAt + 30 วินาที`; `catalogRevision` = hash ของ (settings.version, revision id, offers, taxTreatment); ไม่ส่งบล็อก `trial` แล้ว (สมัครใหม่ไม่มีวันฟรี); `promotions` แสดงเฉพาะแคมเปญสถานะ `ACTIVE` และเฉพาะข้อมูลประกาศได้ (ไม่มี id/cap/การใช้); `Cache-Control: no-store, max-age=0`
- **ข้อมูล:** `BillingSettings`, `BillingPolicyRevision`
- **API:** `GET /v1/billing/catalog`
- **หน้าจอ:** หน้าแรกสาธารณะ/หน้าราคา, `/companies/[companyId]/billing`
- **ทดสอบ:** `e2e/customer-billing-ux.spec.ts`, `e2e/billing-preview.spec.ts`, `domain/billing-promotion.spec.ts`

### FR-BILL-002 สถานะ billing ของร้าน (หน้าแพ็กเกจ)

- **คำอธิบาย:** snapshot เดียว (`BillingStatus`) ที่หน้าแพ็กเกจใช้วาดทุกอย่าง: แพ็กปัจจุบัน วันสิ้นสุด วิธีต่ออายุ การกระทำที่อนุญาต เหตุผลที่ซื้อไม่ได้ ข้อเสนอพิเศษ ส่วนลด โปรโมชัน การใช้ใบเสร็จ issue ที่เปิดอยู่
- **ขั้นตอนหลัก:** อ่าน company + plan term + account → `purchaseSource()` → ตรวจ feature plan → อ่าน attempt/invoice ล่าสุด → คำนวณ `billingState()` → `allowedActions` → (ถ้า PROMPTPAY_RENEW) อ่านบิลค้างจาก Stripe → `purchaseBlockCode` → ดีล/ส่วนลด/โปรโมชัน
- **กฎธุรกิจ:**
  - `purchaseSource` (`billing-purchase-source.ts`): `NO_TERM`, `TRIAL` (term เป็น `FREE_TRIAL_15`), `ADMIN_MANUAL` (term ที่ผู้ดูแลตั้ง ไม่มีหลักฐานจ่าย), `PAID_CURRENT_MODE`, `PAID_EXPIRED_CURRENT_MODE`, `PAID_OTHER_MODE` (term ผูกกับ billing account อื่น เช่นโหมด test/live อื่น), `SOURCE_INCONSISTENT` (รูปร่างข้อมูลจ่ายเงินไม่ครบ/`termProjectionHash` ไม่ตรง) — สองค่าหลังปิดการซื้อ (`BILLING_SOURCE_REVIEW_REQUIRED`)
  - `allowedActions`: `new_sales` (ซื้อใหม่/ซื้อหลังหมด/ซื้อซ้ำบน subscription ที่ active เมื่อ `plan_changes` เปิดและมี `zeroPriceIds`), `portal_payment_method` (CARD_AUTO + มี subscription + gate), `portal_cancel_subscription` (subscription `active/past_due/unpaid` หรือ `trialing` สำหรับ PROMPTPAY_RENEW/prepaid), `plan_changes` (CARD_AUTO active, เหลือ > 10 นาทีก่อนสิ้นรอบ, ไม่ได้ยกเลิก, ไม่อยู่ใน grace)
  - `purchaseBlockCode` ลำดับตรวจ: `BILLING_NOT_READY` → `CONTROL_POLICY_NOT_READY` → `BILLING_COMPANY_HELD` → `BILLING_SALES_CLOSED` → `BILLING_COMPANY_SALES_CLOSED` → `BILLING_SOURCE_REVIEW_REQUIRED` / `BILLING_ENTITLEMENT_REVIEW_REQUIRED` → `BILLING_EMAIL_UPDATE_PENDING` → `BILLING_CHECKOUT_PENDING` → `BILLING_COLLECTION_PENDING` → `BILLING_PLAN_CHANGE_PENDING` → `BILLING_REFUND_PENDING` → `BILLING_COLLECTION_REVIEW` (เก็บเงินถูกพัก) → `BILLING_RESTART_REVIEW` → `BILLING_PACKAGE_STATE_INVALID` → `BILLING_PLAN_CHANGE_REQUIRED` (QR ต่ออายุยังไม่หมด) → `BILLING_MODE_NOT_READY` → `BILLING_REPEAT_NOT_READY`
  - `availablePurchaseModes`: ขณะยังมี `paidThrough` ในอนาคต ร้านที่มี subscription ซื้อได้เฉพาะ `CARD_AUTO`; ร้านแบบจ่ายครั้งเดียวซื้อได้เฉพาะโหมดครั้งเดียว
  - `nextChargeAt` เป็น null เมื่อโหมดครั้งเดียวหรือเก็บเงินถูกพัก; `lockReason` (`no_package`/`trial_ended`) มีเฉพาะเมื่อ `accessState = EXPIRED`
  - `reference` = เลขที่ร้านอ่านให้ทีมงาน: attempt ที่ค้างอยู่ (เมื่อยังไม่มี invoice ของมันเอง) มิฉะนั้น invoice
  - `usage.cadence`: `PAID_GRANTS` (ใบเสร็จจาก grant ของงวดที่จ่าย), `LEGACY_MONTH` (เพดานรายเดือนตาม term), `FREE_MONTHLY_3` (ร้านใช้ฟรีหลังทดลองหมด)
- **ข้อผิดพลาด:** 404 ไม่พบบริษัท; `BILLING_MAPPING_MISMATCH` เมื่อ subscription/บิลต่ออายุที่ Stripe ไม่ตรงพันธะ
- **ข้อมูล:** `Company`, `CompanyPlanTerm`, `BillingAccount`, `BillingAttempt`, `BillingInvoice`, `BillingIssue`, `BillingOperation`, `BillingSubscriptionContract`, `PackageChangeRequest`, `BillingPromotionRedemption`
- **API:** `GET /` (status), `POST /refresh` (202; ตั้ง `nextReconcileAt = now` ให้ worker ตรวจทันที)
- **ทดสอบ:** `application/billing-purchase-source.spec.ts`, `.pg.spec.ts`, `billing-plan-manage.spec.ts`, `e2e/customer-billing-ux.spec.ts`, `e2e/plan-term-billing-readiness.spec.ts`

### FR-BILL-003 ขอใบเสนอราคา (Quote)

- **คำอธิบาย:** เซิร์ฟเวอร์คำนวณยอด ภาษี วันสิ้นสุดที่คาด ผลต่อเมนู/เพดาน แล้วตรึงเป็น `BillingSnapshot` ใน `BillingQuote` (อายุ 10 นาที; upgrade = 10 นาทีนับจาก `prorationAt`; ซื้อต่อบนแพ็กครั้งเดียวไม่เกิน `paidThrough` เดิม)
- **Input:** `offerKey`, `interval` (หรือ `dealId` แทน), `purchaseMode` (ตั้งต้น `CARD_AUTO`), `capacity`, `purchaseIntent: 'FULL_PACKAGE'`, `eventDiscountChoice` (`USE`/`DECLINE`), `eventDiscountTicketSerial`, `benefitChoice` (`NORMAL`/`PROMOTION`/`EVENT_DISCOUNT`), `promotionCampaignId`; `billingEmail` รับไว้แต่ไม่ใช้
- **เงื่อนไขก่อนทำ (เรียงตามโค้ด):** Stripe เปิด (`BILLING_NOT_READY`) → มี policy + gate `new_sales` (`BILLING_SALES_CLOSED`) → gate ของโหมด (`BILLING_MODE_NOT_READY`) → ร้านอยู่ใน cohort (`BILLING_COMPANY_SALES_CLOSED`) → policy พร้อม (`CONTROL_POLICY_NOT_READY`) → `paidStart = IMMEDIATE` (`CONTROL_POLICY_NOT_SUPPORTED`) → มี Price ของ offer (`BILLING_OFFER_UNAVAILABLE`) → บริษัทไม่ถูกพัก (`BILLING_COMPANY_HELD`) → ไม่มี attempt ค้าง (`BILLING_EXISTING_SUBSCRIPTION`) → ไม่มี prepaid plan change ค้าง (`BILLING_PLAN_CHANGE_PENDING`) → ไม่ติดช่วงโปรโมชัน (`PROMOTION_UPGRADE_DEFERRED`) → แหล่งสิทธิ์สอดคล้อง (`BILLING_SOURCE_REVIEW_REQUIRED`) → ไม่มีคำขอคืนเงินค้าง (`BILLING_REFUND_PENDING`) → ไม่มีเปลี่ยนผู้รับเอกสารค้าง (`BILLING_EMAIL_UPDATE_PENDING`) → ไม่มีคำสั่ง collection ค้าง (`BILLING_COLLECTION_PENDING`) → Price ที่ Stripe ตรง offer (`BILLING_PRICE_MISMATCH`) → ภาษีตรง (`BILLING_TAX_MISMATCH`)
- **กฎการเปลี่ยนโหมด:** สมาชิก QR ที่ยังไม่หมดต้องรอสิ้นรอบ (`BILLING_PLAN_CHANGE_REQUIRED`); เริ่ม `PROMPTPAY_RENEW` ขณะมีสิทธิ์เหลือไม่ได้ และสลับระหว่างครอบครัว "ครั้งเดียว" กับ "ต่ออายุ" ขณะมีสิทธิ์เหลือไม่ได้ (`BILLING_MODE_CHANGE_PENDING`); ซื้อครั้งเดียวขณะยังมี subscription ที่ไม่ใช่ restart ไม่ได้
- **ชนิดการซื้อ (`purchase.kind`):** `INITIAL` (ครั้งแรก), `RESTART` (สิทธิ์เดิมหมดแล้ว), `REPEAT` (ซื้องวดถัดไปล่วงหน้า แพ็กเดิม), `UPGRADE` (ส่วนต่างตามเวลา §3.4), `FULL_PACKAGE_UPGRADE` (ซื้อแพ็กสูงกว่าเต็มราคา ต่อท้ายรอบเดิม; เฉพาะแพ็กครั้งเดียวที่ยัง active, ไม่ใช่ดีล), `SCHEDULED_CHANGE` (แพ็กครั้งเดียวเปลี่ยนเป็น tier ต่ำกว่า/interval อื่น มีผลที่ `paidThrough`), `ADVANCE_DEAL` (ดีลต่ออายุจ่ายล่วงหน้าขณะแพ็กครั้งเดียวยังไม่หมด)
- **ผลลัพธ์สำคัญ:** `subtotal/tax/total` (§3.1), `purchase.projectedPaidThrough`, `receiptUnitsAdded`, `projectedRemainingReceipts`, `featureImpact` (เมนูที่เพิ่ม/หาย), `capacity` (สาขา/ผู้ใช้ที่จะคง/ระงับ), `upgrade.segments`, `eventDiscount`, `promotion`, `deal`, `advanceDeal`, `billingProfile`, `billingEmail` (ผู้รับเอกสารปัจจุบัน → อีเมลบัญชีที่ยืนยันแล้ว → null = Checkout ถาม)
- **กฎเมนู:** การซื้อที่ "กำหนดชุดเมนูใหม่ทั้งชุด" (ครั้งแรก, restart หลังหมด, ดีล, full-package upgrade) ตรึง `featurePlan` ลง snapshot; upgrade/scheduled change แสดงผลกระทบแต่ไม่ตรึง (เมนูย้ายตอนมีผลจริง)
- **กฎ capacity:** ถ้าจำนวนสาขา/ผู้ใช้ ACTIVE เกินเพดานของ offer และไม่ส่ง `capacity` → `BILLING_CAP_SELECTION_REQUIRED`; ดีลข้ามการตรวจนี้ (ของเดิมไม่ถูกระงับ แต่เพิ่มใหม่ไม่ได้); เพดานที่ซื้อไว้สูงกว่าถูกรักษา (`purchasedCapacityOffer` = max ของเดิมกับ offer เมื่อ tier ใหม่ไม่ต่ำกว่า)
- **หนึ่งสิทธิประโยชน์ต่อการซื้อ:** `benefitChoice` เลือกได้อย่างเดียว; `PROMOTION` ที่ไม่มีสิทธิ์ → error พร้อมเหตุผล (ไม่เงียบกลับเป็นราคาปกติ); `EVENT_DISCOUNT` ที่ใช้ตั๋วไม่ได้ → `SALES_EVENT_TICKET_UNAVAILABLE`
- **ข้อมูล:** `BillingQuote` (`snapshotJson`), อ่าน `PackageChangeRequest`, `SalesEventTicket`, `BillingReceiptGrant`
- **API:** `POST /quote` (200 → `BillingQuote`), `GET /capacity?offerKey&interval` (→ `BillingCapacityOptions`)
- **หน้าจอ:** `/companies/[companyId]/billing/preview`
- **ทดสอบ:** `domain/billing-package.spec.ts`, `application/billing-upgrade.spec.ts`, `billing-capacity.spec.ts`, `billing-restart.spec.ts`, `billing-event-discount.spec.ts`, `domain/deal-offer.spec.ts`, `e2e/billing-preview.spec.ts`, `e2e/journeys/billing-renew-or-top-up.journey.spec.ts`, `e2e/journeys/package-upgrade-unlocks-50-tawi.journey.spec.ts`

### FR-BILL-004 เริ่มชำระเงิน (Checkout)

- **คำอธิบาย:** ยืนยัน quote + ยอมรับเงื่อนไข แล้วสร้าง Stripe Checkout Session และคืน URL
- **Input:** `quoteId`, `consentRevision`, `accepted: true`, `channel: 'web' | 'line'`; header `Idempotency-Key` (`[a-zA-Z0-9_-]{16,120}`; ไม่มี → `BILLING_IDEMPOTENCY_REQUIRED`)
- **เงื่อนไขก่อนทำ:** ไม่ใช่ร้านเดโม (`demo_action_unavailable`); quote เป็นของผู้ใช้/ร้านนี้ ยังไม่หมดอายุ policy revision เดิม และยังไม่เคยใช้ (`BILLING_QUOTE_STALE`)
- **ขั้นตอนหลัก:**
  1. Transaction ภายใต้ lock: (ถ้ามีโปรโมชัน) `lockPromotionFence` เป็น lock แรก → `lockPlanTermCompany` → `assertOwner` → ตรวจ replay ของ idempotency key (hash ต่าง = `BILLING_IDEMPOTENCY_CONFLICT`; ตรง = resume attempt เดิม)
  2. ตรวจซ้ำทุกอย่างที่ quote ตรึง: `settingsVersion`, consent (`BILLING_CONSENT_REQUIRED`), gate, cohort, สถานะบริษัท, billing profile (`assertBillingProfileUnchanged`), ผู้รับเอกสาร, purchase source, feature plan hash, `termVersion`, ดีล (ยังอยู่ในหน้าต่างข้อเสนอและไม่เปลี่ยน), restart/repeat/one-time/advance-deal source, capacity, ประวัติ upgrade (`sourceHash`), กฎส่วนลดงาน (`RESERVE`/`PROCEED`/`STALE`) — เปลี่ยนสิ่งใด = `BILLING_QUOTE_STALE`
  3. สร้าง `BillingAccount` (ถ้ายังไม่มี) + `BillingAttempt` (`CREATING`) + ตั้ง `activeAttemptId`; จองสิทธิ์โปรโมชัน (`reservePromotion`) และตั๋วส่วนลด (`reserveEventDiscount`) ใน transaction เดียวกัน
  4. นอก transaction: `assertAccount` → สร้าง/ตรวจ Customer (`metadata.billingAccountId`; ไม่ตรง = `BILLING_MAPPING_MISMATCH`) → sync profile (เขียน marker `collectionJson.profileSync` ก่อนส่ง)
  5. "Barrier" ก่อนคำขอเงิน: transaction ตรวจ gate/policy/บริษัท/profile/source อีกรอบ แล้ว CAS `CREATING → REQUESTING` (version 0)
  6. `POST /checkout/sessions` (รายละเอียด §5.3; `expires_at = now + 1800 s`; `success_url = {web}/companies/:id/billing/return?attempt=:attemptId`; `cancel_url` = เดียวกัน + `&checkout=canceled`) → ตรวจ session ที่ได้ → `REQUESTING → OPEN`
- **กฎธุรกิจ:** ราคาที่ส่ง Stripe ในโหมด payment = `eventDiscount unit` → `upgrade.amountSatang` → `offer.priceSatang` ผ่าน `price_data` บน Product ของ tier; โหมด subscription ใช้ `price: snapshot.priceId`; ซื้อซ้ำบน subscription (`snapshot.repeat`) ไปทาง `BillingRepeat.start()`; ก่อนจ่ายครั้งเดียวต้องไม่มี subscription ที่ยังเรียกเก็บได้ของ customer นั้น; การเปลี่ยน revision เพราะแคมเปญ (policy ฐานเดิม) ไม่ทำให้ attempt ที่จองไว้ตก (`basePolicyUnchanged`)
- **การจัดการผลไม่ชัด:** ดูกฎปล่อยการจองใน §4.3; ผลไม่ชัด → attempt `UNKNOWN` + issue `UNKNOWN_ATTEMPT` + คืน `{state:'UNKNOWN', checkoutUrl:null}`
- **ผลลัพธ์:** `{attemptId, state, checkoutUrl, expiresAt?}`
- **ข้อมูล:** `BillingAccount`, `BillingAttempt`, `BillingQuote`, `BillingPromotionRedemption`, `SalesEventTicket`, `AuditLog` (`billing.promotion.released`)
- **API:** `POST /checkout`
- **ทดสอบ:** `e2e/journeys/billing-first-card-renewal.journey.spec.ts`, `billing-first-promptpay.journey.spec.ts`, `billing-unfinished-payment.journey.spec.ts`, `e2e/billing-no-setup.spec.ts`, `application/billing-profile-recovery.spec.ts`

### FR-BILL-005 ดู/กลับไปจ่าย/ยกเลิกรายการชำระเงิน

- **คำอธิบาย:** หน้ากลับจาก Stripe อ่านผล attempt; ร้านเปิด Checkout เดิมต่อหรือยกเลิกเองได้
- **ขั้นตอนหลัก:** `GET attempts/:id` → `BillingAttemptView` (`paymentState`: `PAID` เมื่อมี invoice paid ของ attempt, `FAILED` เมื่อ attempt `FAILED/EXPIRED`, มิฉะนั้น `PENDING`; แนบข้อมูลดีล/ส่วนลด (`IN_PAYMENT`/`USED`)/โปรโมชัน); `resume` คืน URL เฉพาะเมื่อ attempt ยังเป็นช่องปัจจุบัน, gate ยังเปิด, session ที่ Stripe `open` และพันธะตรง; `cancel` (`BillingCheckoutExpiryService.cancelOwn`) สั่ง `POST /checkout/sessions/:id/expire` หรือปล่อย attempt ที่ไม่เคยมี session (เงียบ ≥ 60 วินาที)
- **กฎธุรกิจ:** `canCancelCheckout` เป็นจริงเมื่อมี session และ attempt ไม่อยู่ในสถานะ `COMPLETED/EXPIRED/FAILED` และยังไม่มี invoice paid ของ attempt นั้น; ยกเลิกไม่ได้เมื่อจ่ายแล้ว
- **ข้อผิดพลาด:** `BILLING_CHECKOUT_PENDING`, `BILLING_PURCHASE_PENDING`, `BILLING_MAPPING_MISMATCH`, 404
- **API:** `GET /attempts/:attemptId`, `POST /attempts/:attemptId/resume`, `POST /attempts/:attemptId/cancel`
- **หน้าจอ:** `/companies/[companyId]/billing/return`
- **ทดสอบ:** `application/billing-checkout-expiry-owner.spec.ts`, `e2e/journeys/billing-unfinished-payment.journey.spec.ts`

### FR-BILL-006 ประวัติการชำระเงินและเอกสาร (ใบแจ้งหนี้/ใบเสร็จ/ใบลดหนี้)

- **คำอธิบาย:** รายการใบแจ้งหนี้ของร้าน รายละเอียดการคืนเงิน/ใบลดหนี้ และลิงก์เปิดเอกสารที่ Stripe โฮสต์
- **ขั้นตอนหลัก:** `history` แบ่งหน้าด้วย cursor (`limit` 1–50, ตั้งต้น 20) เรียง `createdAt desc`; `adjustments/:kind` (`refunds` | `credit-notes`) อ่านสดจาก Stripe; `documents/:id/open` คืน URL ชนิด `invoice` | `receipt` | `pdf` | `credit-note` (ต้องส่ง `creditNoteId`) หลังตรวจว่าใบและบัญชีไม่เปลี่ยนระหว่างอ่าน (`sameInvoiceSource`)
- **กฎธุรกิจ:** เอกสารทางภาษี (ใบกำกับ/ใบเสร็จ) ออกโดย Stripe Invoicing ด้วยข้อมูลผู้ออก (`issuer`) และผู้ซื้อ (ชื่อ/ที่อยู่ของ Customer ที่ sync จาก billing profile); ระบบไม่สร้าง PDF เอง; URL ผ่าน `safeStripeUrl('document')` เท่านั้น; ร้านที่ถูก admin hold เปิดไม่ได้ (403); ทุกการเปิดบันทึก audit `billing.document.opened`
- **ข้อมูลใน `BillingInvoiceItem`:** offer, วิธีจ่าย (`CARD`/`PROMPTPAY`), `amountSatang`, `refundedSatang`, `disputed`, `periodStart/End`, โปรโมชัน (`paidEnd`, `benefitEnd`, `bonusReceiptUnits`), `documentActions.canResend`
- **API:** `GET /history`, `GET /invoices/:documentId/adjustments/:kind`, `POST /documents/:documentId/open`
- **หน้าจอ:** `/companies/[companyId]/billing`, `/billing/invoices/[invoiceId]` (`features/billing/BillingAdjustmentsPage`)
- **ทดสอบ:** `application/billing-financial.spec.ts`, `e2e/customer-billing-ux.spec.ts`

### FR-BILL-007 ส่งเอกสารซ้ำทางอีเมล

- **คำอธิบาย:** ร้านกดให้ Stripe ส่งใบแจ้งหนี้/ใบเสร็จไปยังผู้รับเอกสารอีกครั้ง
- **เงื่อนไข:** ใบ `paid` + `APPLIED`, มี `recipientEmail`, ไม่มีการเปลี่ยนผู้รับค้าง, อีเมลไม่เด้ง (`recipientBouncedAt` ว่าง; มิฉะนั้น `BILLING_RECIPIENT_BOUNCED`)
- **กฎ:** ทำแบบ synchronous ภายใต้ lease ของบัญชี; จำกัด 3 ครั้ง/เอกสาร/วัน; ผลลัพธ์ `{invoiceSent, receiptUpdated, recipientEmail, remainingToday}`; `receiptUpdated = false` เมื่ออีเมล receipt ไม่เปลี่ยน (Stripe ไม่ส่งซ้ำ)
- **API:** `POST /documents/:documentId/resend` (Stripe: `POST /invoices/:id/send`, `POST /charges/:id`)
- **ทดสอบ:** `application/billing-document-resend.spec.ts`

### FR-BILL-008 ผู้รับเอกสาร (อีเมล) และการเปลี่ยนด้วย OTP

- **คำอธิบาย:** อีเมลที่ Stripe ส่งเอกสารถึง เก็บที่ `BillingAccount.recipientEmail` พร้อมแหล่งที่มา `ACCOUNT_EMAIL | CUSTOMER_OTP | STRIPE_CHECKOUT | ADMIN`
- **ขั้นตอนเปลี่ยน:** (1) `recipient/otp/request` ส่งรหัส 6 หลักไปอีเมลใหม่ (ผูกกับ company + user + session; digest HMAC-SHA256 `BILLING_RECIPIENT_OTP_V1`) (2) `recipient/otp/confirm` → `recipientProofId` (ใช้ได้ 30 นาที) (3) `recipient/preview` สร้างคำสั่ง `UPDATE_BILLING_EMAIL` (4) `recipient/:id/submit` (ต้อง `accepted: true` + Idempotency-Key) → reconciler เขียนอีเมลลง Stripe Customer (`emailRecipient.advance`) (5) `cancel` ถอนได้ก่อนส่ง
- **กฎธุรกิจ:** ผู้รับถูกบันทึกครั้งแรกเมื่อการจ่ายงวดแรก apply (จาก quote หรือจากอีเมลที่กรอกใน Checkout); ระหว่าง PAID กับ APPLIED ยังว่าง; `canChange` = มี Customer และไม่มีการซื้อ/การเปลี่ยนค้าง; ขณะมีการเปลี่ยนค้าง ห้ามซื้อและห้ามเปิด portal (`BILLING_EMAIL_UPDATE_PENDING`); ที่อยู่ที่กรอกใน Checkout เก็บใน `checkoutAddressJson` เพื่อ "เสนอ" ให้ profile ร้าน ไม่เขียนทับเอง; อีเมลเด้งถูกบันทึก (`recipientBouncedAt`) และแจ้งเตือน (`billing.recipient.bounced`)
- **API:** `GET /recipient`, `POST /recipient/otp/request` (202), `POST /recipient/otp/confirm`, `POST /recipient/preview`, `GET /recipient/:id`, `POST /recipient/:id/:action` (`submit`|`cancel`)
- **ข้อมูล:** `BillingAccount`, `BillingOperation` (`UPDATE_BILLING_EMAIL`), `EmailAccessChallenge`
- **ทดสอบ:** `application/billing-recipient-otp.service.spec.ts`, `domain/billing-recipient-otp.logic.spec.ts`, `billing-email-recipient.postgres.spec.ts`, `billing-notifications-recipient.spec.ts`, `e2e/billing-no-setup.spec.ts`

### FR-BILL-009 ข้อมูลออกเอกสารของบริษัท (billing profile gate)

- **คำอธิบาย:** ชื่อและที่อยู่ที่ปรากฏบนใบกำกับ มาจาก `companyBillingProfile(company)` (`packages/contracts/src/billing-company-profile.ts`) ซึ่งรายงาน `missingFields`
- **กฎธุรกิจ ("purchase without setup"):** profile ที่ไม่ครบ **ไม่** ปิดการซื้อ — quote ตรึงสิ่งที่เห็น; ถ้าครบทั้ง 5 ส่วนของที่อยู่ ระบบส่ง `address` (country `TH`, line1, line2+ตำบล, อำเภอ=city, จังหวัด=state, postal_code) ขึ้น Stripe Customer และตั้ง Checkout `customer_update.address = 'never'`; ถ้าไม่ครบ ไม่ส่งที่อยู่ (ไม่ทับที่อยู่ที่ Checkout เก็บ) และตั้ง `'auto'`; Checkout บังคับเก็บที่อยู่เสมอ (`billing_address_collection: 'required'`)
- **การตรวจ drift:** profile เปลี่ยนหลัง quote → `BILLING_QUOTE_STALE` ("ชื่อหรือที่อยู่บนเอกสารเปลี่ยน")
- **Sync ภายหลัง:** เมื่อร้านหรือผู้ดูแลแก้ identity/profile (`CompanyIdentityUseCase.patch`, `UpdatePartnerProfileUseCase`) ระบบ enqueue `CUSTOMER_PROFILE_SYNC` (key `customer-sync:{companyId}:{version}`) ใน transaction เดียวกัน; worker เขียนขึ้น Stripe
- **ข้อมูล:** `Company` (ชื่อ ที่อยู่ เลขภาษี), `BillingAccount.checkoutAddressJson`, `BillingOperation`
- **หน้าจอ:** หน้าตั้งค่าบริษัทของร้าน + การ์ด profile ใน `/billing/preview`
- **ทดสอบ:** `application/billing-company-profile.spec.ts`, `billing-profile-recovery.spec.ts`, `e2e/billing-no-setup.spec.ts`

### FR-BILL-010 เลือกสาขา/ผู้ใช้ที่คงไว้เมื่อเกินเพดาน (capacity selection และการซ่อม)

- **คำอธิบาย:** เมื่อแพ็กที่จะซื้อ/เปลี่ยนมีเพดานต่ำกว่าที่ใช้อยู่ ร้านต้องเลือกสาขาและผู้ใช้ที่ "คงสิทธิ์"
- **กฎ (`billing-capacity.ts`):** นับสาขา ACTIVE และ membership ACTIVE ที่ไม่ใช่ `SYSTEM_ADMIN`; รายการ "ต้องคงไว้" (`required`): สำนักงานใหญ่ (เมื่อมีแห่งเดียว), สาขาที่มีคำขอเบิกจ่ายที่ยังไม่ปิด (สถานะไม่อยู่ใน `PAID, REJECTED, CANCELLED, VOIDED`), เจ้าของ (role `OWNER`), ผู้ขอ/ผู้อนุมัติปัจจุบันของคำขอเบิกจ่ายที่เปิดอยู่; selection ต้องมี ≥ 1 สาขา ≥ 1 ผู้ใช้ ไม่เกินเพดาน รวมสำนักงานใหญ่และเจ้าของ และผู้ใช้ที่คงไว้ทุกคนต้องเหลือสาขาที่เข้าถึงได้ + `defaultBranchId` ที่ใช้ได้; `sourceHash` ผูก selection กับสภาพข้อมูลตอนเลือก
- **ผลตอน apply (`applyCapacity`):** สาขาที่ไม่เลือก → `DISABLED`; membership ที่ไม่เลือก → `SUSPENDED` (+ `EmployeeAccessProfile` → `SUSPENDED`); ตั้ง `defaultBranchId`; audit `billing.capacity.applied`; ไม่มีการเปิดของที่ปิดอยู่กลับมา
- **การซ่อม:** ถ้าจ่ายแล้วแต่ selection ใช้ไม่ได้ ใบแจ้งหนี้เป็น `HELD` / `BILLING_CAP_SELECTION_REQUIRED`; ร้านส่ง selection ใหม่ (สร้าง operation `CUSTOMER_CAP_SELECTION_REPAIR` สถานะ `SUCCEEDED`, audit `billing.capacity.repair.confirmed`, ตั้ง reconcile ทันที)
- **API:** `GET /capacity`, `POST /attempts/:attemptId/capacity` (202), `POST /collection/:id/capacity` (สำหรับ plan change)
- **ข้อมูล:** `Branch`, `CompanyMembership`, `EmployeeAccessProfile`, `ReimbursementRequest`, `BillingOperation`
- **ทดสอบ:** `application/billing-capacity.spec.ts`

### FR-BILL-011 ยกเลิก/กลับมาต่ออายุอัตโนมัติ

- **คำอธิบาย:** ร้านหยุดการต่ออายุ (มีผลสิ้นรอบ — `cancellation: PERIOD_END`) หรือเปิดกลับ
- **เงื่อนไข:** gate `portal_cancel_subscription`; ไม่มี attempt/คำสั่งค้าง; ไม่มีหนี้ค้างที่ Stripe (`assertNoDebt`)
- **ขั้นตอน:** `collection/preview` (`CANCEL_RENEWAL` | `RESUME_RENEWAL`) → `PREVIEW` (แสดง `effectiveAt`, `nextRenewalTotalSatang`) → `submit` (`accepted: true`, Idempotency-Key) → `QUEUED` + `activeCollectionOperationId` → reconciler ส่ง `POST /subscriptions/:id` (`cancel_at_period_end`) ด้วย key `mm:collection:{id}` → อ่านกลับ → `SUCCEEDED`; `withdraw` ถอนก่อนส่ง
- **กฎธุรกิจ:** สิทธิ์ใช้งานคงอยู่ถึง `paidThrough`; ไม่มีการคืนเงินอัตโนมัติ; หลังยกเลิก `nextChargeAt = null`; ใช้ได้กับ subscription `trialing` ของ PROMPTPAY_RENEW / งวดแรก prepaid ด้วย
- **ข้อผิดพลาด:** `BILLING_COLLECTION_CLOSED`, `BILLING_COLLECTION_REVIEW`, `BILLING_COLLECTION_PENDING`
- **API:** `POST /collection/preview`, `GET /collection/:id`, `POST /collection/:id/:action` (`submit`|`withdraw`)
- **ทดสอบ:** `application/billing-collection.spec.ts`, `billing-schedule.spec.ts`, `e2e/journeys/billing-stop-auto-renewal.journey.spec.ts`

### FR-BILL-012 Downgrade ปลายรอบ (และยกเลิก downgrade)

- **คำอธิบาย:** ตาม policy `UPGRADE_PRORATED_DOWNGRADE_PERIOD_END` การลดแพ็ก/เปลี่ยนรอบของสมาชิกตัดบัตรมีผลที่ `paidThrough`
- **เงื่อนไข:** `allowedActions` มี `plan_changes` (gate `plan_changes`, CARD_AUTO active, เหลือ > 10 นาที)
- **ขั้นตอน:** `collection/preview` action `SCHEDULE_DOWNGRADE` + `offerKey`, `interval`, `capacity` (ถ้าเกินเพดาน) → ตรวจ Price เป้าหมาย → `submit` → reconciler สร้าง Subscription Schedule (`from_subscription`) แล้วเพิ่ม phase ราคาใหม่เริ่มที่สิ้นรอบ → `SUCCEEDED` และตั้ง `pendingPlanChangeId` + แถว `BillingSubscriptionContract` มีผลวันสิ้นรอบ; `CANCEL_DOWNGRADE` ลบ phase
- **ตอนมีผล:** ใบต่ออายุงวดใหม่ (RENEWAL) ที่ snapshot มี `planChangeId` → apply term/เพดาน/ใบเสร็จใหม่, operation → `APPLIED`, และย้ายเมนู (`queuePlanMenuMove` → `movePlanMenus`; ล้มเหลวถูก retry โดย `scan()`)
- **หน้าจอ:** แสดง `featureImpact` (เมนูที่จะหาย/ได้) และ `capacity` ก่อนยืนยัน (`withPlanMenuImpact`)
- **API:** เช่นเดียวกับ FR-BILL-011
- **ทดสอบ:** `application/billing-collection.spec.ts`, `billing-plan-menus.spec.ts`, `billing-schedule.spec.ts`

### FR-BILL-013 Upgrade ทันทีแบบคิดส่วนต่าง

- **คำอธิบาย:** เปลี่ยนเป็น tier สูงกว่าในรอบเดียวกัน จ่ายส่วนต่างตามเวลาที่เหลือ (§3.4) ได้ใบเสร็จเพิ่มตามสัดส่วน วันสิ้นสุดไม่เปลี่ยน
- **เงื่อนไข:** gate `plan_changes`; สำหรับ CARD_AUTO ต้องมี `zeroPriceIds` ของเป้าหมาย (ราคา 0 ใช้จัดรอบให้ subscription ไม่เก็บซ้ำในช่วงที่จ่ายล่วงหน้าแล้ว)
- **ขั้นตอน:** quote ชนิด `UPGRADE` → Checkout โหมด `payment` ยอด = ส่วนต่าง → เมื่อจ่ายแล้ว reconciler เพิ่ม receipt grant ชนิด `UPGRADE`, เปลี่ยน tier/เพดานใน term, ย้ายเมนู, (CARD_AUTO) ปรับ subscription/schedule ให้ต่ออายุที่ราคาใหม่ (`upgrade.nextRenewalTotalSatang`)
- **ข้อผิดพลาด:** `BILLING_UPGRADE_REVIEW`, `BILLING_UPGRADE_BOUNDARY`, `BILLING_UPGRADE_BELOW_MINIMUM`, `BILLING_UPGRADE_GIFT_ONLY`, `PROMOTION_UPGRADE_DEFERRED`, `BILLING_REPEAT_NOT_READY`
- **ทดสอบ:** `application/billing-upgrade.spec.ts`, `domain/billing-package.spec.ts`, `e2e/journeys/package-upgrade-unlocks-50-tawi.journey.spec.ts`

### FR-BILL-014 ซื้อซ้ำ/ต่ออายุล่วงหน้า (REPEAT) และเปลี่ยนแพ็กของแบบจ่ายครั้งเดียว

- **คำอธิบาย:** ร้านแบบจ่ายครั้งเดียวซื้องวดถัดไปก่อนหมด (ต่อท้าย `paidThrough` เดิมด้วย anchor เดิม ใบเสร็จคงเหลือสะสม); ร้านตัดบัตรซื้อซ้ำบน subscription ที่ active ผ่าน `BillingRepeat` (จ่ายครั้งเดียว แล้วเลื่อนรอบ subscription ด้วย schedule + ราคา 0)
- **กฎ:** แพ็กครั้งเดียวที่ยังไม่หมด: offer เดิม = `REPEAT`; tier สูงกว่า = `UPGRADE` หรือ `FULL_PACKAGE_UPGRADE` (ตาม `purchaseIntent`); tier ต่ำกว่า/interval อื่น = `SCHEDULED_CHANGE` มีผลที่ `paidThrough` (สร้าง operation `CUSTOMER_PREPAID_PLAN_CHANGE`; ถึงเวลา `applyDueOneTimePlanChange` เขียน term + ย้ายเมนู; ถ้าเกินเพดาน → `BLOCKED` / `BILLING_CAP_SELECTION_REQUIRED` ให้ร้านเลือก)
- **ข้อผิดพลาด:** `BILLING_PACKAGE_STATE_INVALID`, `BILLING_PLAN_CHANGE_PENDING`, `BILLING_REPEAT_NOT_READY`
- **ทดสอบ:** `application/billing-schedule.spec.ts`, `e2e/journeys/billing-renew-or-top-up.journey.spec.ts`

### FR-BILL-015 เริ่มใหม่หลังสิทธิ์หมด (RESTART)

- **คำอธิบาย:** ร้านที่ subscription เดิมสิ้นสุดแล้ว (`canceled`/`incomplete_expired`) และ `paidThrough` ผ่านแล้ว ซื้อแพ็กใหม่ได้
- **การตรวจ (`restartSource`):** ไม่อยู่ใน grace; ไม่มี issue `FINANCIAL_REVIEW` เปิดอยู่; ทุกใบแจ้งหนี้เดิม `APPLIED`, ไม่มี refund/dispute; ที่ Stripe: subscription เดิมสิ้นสุดจริง, ไม่มี subscription อื่นที่เก็บเงินได้, ทุก invoice เป็น `paid`/`void`, ทุก charge `succeeded` ไม่มี refund/dispute — ไม่ผ่าน → `BILLING_RESTART_REVIEW`
- **ผล:** สัญญาใหม่แทนที่สัญญาเดิม; ประวัติเดิมไม่ถูกลบ; pending plan change เดิม → `SUPERSEDED`; เมนูถูกตั้งตามแพ็กที่ซื้อใหม่ทั้งชุด
- **ทดสอบ:** `application/billing-restart.spec.ts`

### FR-BILL-016 จัดการบัตร (Stripe Billing Portal)

- **คำอธิบาย:** เปิด portal เฉพาะ flow เปลี่ยนวิธีชำระเงิน
- **เงื่อนไข:** `CARD_AUTO` + มี Customer + subscription; ไม่มีเปลี่ยนผู้รับค้าง; policy มี `portalConfigurationId`; gate `portal_payment_method`; บริษัทไม่ถูกพัก
- **ขั้นตอน:** ตรวจสภาพ (lock + version) → อ่านและตรวจ portal configuration (ไม่ตรง → issue `CONFIG_DRIFT` + `BILLING_PORTAL_CONFIG_MISMATCH`) → ตรวจสภาพซ้ำ → `POST /billing_portal/sessions` (`flow_data.type = payment_method_update`, `return_url = {web}/companies/:id/billing`) → audit `billing.portal.opened`
- **กฎ:** การเปลี่ยนแพ็ก/ยกเลิกผ่าน portal ถูกปิดถาวร (ใช้คำสั่งของระบบแทน)
- **API:** `POST /portal` body `{action: 'portal_payment_method'}` → `{url}`
- **ข้อผิดพลาด:** `BILLING_PORTAL_UNAVAILABLE`

### FR-BILL-017 ต่ออายุด้วย QR (PromptPay renew)

- **คำอธิบาย:** งวดแรกจ่ายด้วย PromptPay ผ่าน Checkout โหมด `payment`; เมื่อ apply แล้วระบบสร้าง Subscription `collection_method: send_invoice`, `payment_method_types: ['promptpay']` ที่ `trialing` ถึงสิ้นงวดแรก; ทุกรอบ Stripe ออกบิลให้ร้านสแกนจ่าย
- **หน้าร้าน:** `status` คืน `renewalInvoiceUrl` (hosted invoice) และ `renewalInvoiceDueAt` เมื่อมีบิล `open` ยอด > 0 ยังไม่จ่าย
- **กฎ:** ใบต่ออายุต้องเริ่มงวดตรง `paidThrough` เดิมพอดี มิฉะนั้น `HELD`; ไม่จ่ายเมื่อถึง `paidThrough` → เข้ากฎ grace (FR-BILL-036); ถ้าผูก subscription ไม่ได้ก่อนถึงขอบรอบ ระบบ "ยุติการผูก" (`billing.renewal_binding.ended`) และร้านกลายเป็นแบบไม่มีการต่ออายุ; ระหว่างสมาชิก QR ยังไม่หมด ซื้อแพ็กใหม่ไม่ได้ (`BILLING_PLAN_CHANGE_REQUIRED`)
- **ทดสอบ:** `domain/paid-invoice-promptpay.spec.ts`, `e2e/journeys/billing-first-promptpay.journey.spec.ts`

### FR-BILL-018 ใช้ส่วนลดจากงาน (event discount) ตอนซื้อ

- **คำอธิบาย:** ผู้จัดการแพ็กที่ LINE ของตนถือตั๋ว เลือกใช้ส่วนลดกับการจ่ายครั้งนี้
- **กฎ:** ดูสูตร §3.5; เส้นทาง (`path`): `DISCOUNT` เมื่อร้านจ่ายแพ็กได้ในครั้งเดียวตอนนี้, `CREDIT` (ถูกถอนไว้ — ทุก batch ต้องมีส่วนลด > 0), `null`; ร้านหนึ่งใช้ได้หนึ่งตั๋วต่อหนึ่งงาน (`EVENT_ALREADY_USED`); ร้านที่มีดีล active ใช้ไม่ได้ (`DEAL_ACTIVE`); batch ถูก suspend → ใช้ตั๋วไม่ได้จนกว่า lift; quote ที่ไม่มีข้อเสนอแต่ต่อมามี → Checkout ตอบ stale เพื่อให้ผู้ซื้อได้เลือก; `DECLINE` ไม่ทำให้ stale
- **วงจรตั๋ว:** จอง (`RESERVED`) ใน transaction ของ Checkout → `USED` เมื่อจ่ายยืนยัน (บันทึก `appliedDiscountSatang`, `invoiceId`) → คืน `ISSUED` เมื่อ Checkout ไม่ได้จ่าย; ถ้าจ่ายที่ราคาลดแต่ไม่พบตั๋วที่จองไว้ → issue `EVENT_DISCOUNT_REVIEW` (ไม่บล็อก apply)
- **API:** `GET /event-discount` (→ `BillingEventDiscountView`), ฟิลด์ใน `POST /quote`
- **ทดสอบ:** `application/billing-event-discount.spec.ts`, `domain/billing-event-discount.logic.spec.ts`, `sales-console/application/claim-event-discount.use-case.spec.ts`

### FR-BILL-019 โปรโมชันแถมเดือน (promotion campaign) ตอนซื้อ

- **คำอธิบาย:** ซื้อหนึ่งงวด ได้เดือนฟรีและใบเสร็จโบนัส หนึ่งครั้งต่อบริษัทต่อแคมเปญ (Release 1: เทมเพลตเดียว `BILLING_PROMOTION_STARTER_TEMPLATE` — `STARTER_249` รายเดือนและรายปี, `bonusMonths = 1`, `bonusReceiptUnits = 30`)
- **เหตุผลที่ใช้ไม่ได้ (`BillingPromotionUnavailableReason`):** `NOT_STARTED`, `ENDED`, `PAUSED`, `CAP_FULL`, `ALREADY_USED`, `IN_PROGRESS`, `CATALOG_STALE` (ราคา/ภาษี/ใบเสร็จของ offer ไม่ตรง `offerSignature` ที่เผยแพร่), `OFFER_NOT_COVERED`, `PURCHASE_KIND_UNSUPPORTED` (เช่น มี subscription live, ดีล, upgrade, scheduled change, หรือมีสิทธิ์ที่จ่ายแล้วเหลืออยู่ซึ่งไม่ใช่แพ็กครั้งเดียว offer เดียวกัน), `CHANGED`
- **ผล:** `paidEnd`/`benefitEnd` ตาม §3.3; ใบเสร็จรวม = ฐาน + โบนัส; โหมดต่ออายุ: เก็บเงินครั้งถัดไปที่ `benefitEnd` (CARD_AUTO จ่ายงวดแรกในโหมด payment + บันทึกบัตร แล้วผูก subscription `trialing` ถึง `benefitEnd`); `renewalSetupState`: `NOT_REQUIRED | PENDING | READY | REVIEW` (ค้างเกิน 23 ชม. หรือมี issue) `| CANCELLED`
- **หลังซื้อ:** ห้าม upgrade ทันทีจนถึง `benefitEnd` (`upgradeDeferredUntil`); คืนเงินเต็ม → สิทธิ์ที่ยังไม่ใช้ถูกยุติ (ดู FR-BILL-061)
- **ข้อมูล:** `BillingPromotionRedemption`, `BillingPolicyRevision.promotionJson`
- **ทดสอบ:** `domain/billing-promotion.spec.ts`, `e2e/billing-promotion.spec.ts`

### FR-BILL-020 ชำระข้อเสนอพิเศษจากทีมขาย (sales deal)

- **คำอธิบาย:** ร้านเห็นการ์ดข้อเสนอ (`BillingStatus.deal`) ที่ `APPROVED` และยังไม่หมดเขต (3 วันนับจากอนุมัติ) แล้วจ่ายผ่าน quote ที่ระบุ `dealId`
- **กฎ:** ราคา/เดือน/เพดาน/เมนู/เครดิต AI มาจาก snapshot ของดีลเท่านั้น (`offerKey`/`interval` ใน body ถูกละเลย); ดีลครั้งเดียว (v2/v4 ไม่ autoRenew) จ่ายได้เฉพาะโหมดครั้งเดียว ขาย N เดือนในครั้งเดียว (`intervalCount = months`) จ่ายผ่าน `price_data`; ดีลต่ออายุ (autoRenew, cadence month/year) จ่ายได้เฉพาะโหมดต่ออายุ ใช้ Stripe Price ของดีลเอง (ต้อง `priceState = READY` มิฉะนั้น `SALES_DEAL_PRICE_PENDING`); หน้าต่างข้อเสนอถูกตัดสินตอนสร้าง session — จ่ายหลังหมดเขตยัง apply; ดีลข้ามการตรวจ capacity
- **กรณีพิเศษ:** ร้านมี subscription CARD_AUTO ที่ active → "conversion": จ่ายดีลก่อน แล้ว reconciler ยกเลิก subscription เดิม (`DEAL_SUBSCRIPTION_CANCEL`, issue `DEAL_SUBSCRIPTION_CANCEL_PENDING` ถ้าค้าง); ร้านแพ็กครั้งเดียวยังไม่หมด + ดีลต่ออายุ → `ADVANCE_DEAL` (จ่ายตอนนี้ เริ่มรอบที่ `paidThrough` เดิม; operation `CUSTOMER_ADVANCE_RENEWING_DEAL`; `pendingDeal.state`: `PAID | PENDING_BINDING | HELD`); ไม่เข้าเงื่อนไข → `CONTROL_DEAL_SUBSCRIPTION_REVIEW`
- **ผลตอน apply (`applyDealRequest`):** ดีล → `APPLIED`; เขียน term/เพดาน/เมนูของดีล; ตั้งเครดิต AI ของดีล (v4 = chat credit, v2/v3 = งบรวม); บันทึก `SalesAttribution`; ดีล N รอบบันทึกวันคืนราคาปกติ (`returnAt`) และรอบสุดท้ายสร้าง `SCHEDULE_PRICE_RETURN` ให้ subscription กลับไปราคา catalog พร้อมรีเซ็ตเมนู/เครดิต/เพดานเป็นค่าของ tier
- **ทดสอบ:** `domain/deal-offer.spec.ts`, `application/billing-advance-deal.pg.spec.ts`, `billing-deal-subscription-cancel.spec.ts`, `billing-deal-chat-credit.spec.ts`, `billing-price-return.spec.ts`, `e2e/billing-advance-deal.spec.ts`, `e2e/sales-console.spec.ts`

### FR-BILL-021 ยกยอดใบเสร็จช่วงทดลองเมื่อซื้อครั้งแรก (trial carryover)

- **คำอธิบาย:** ร้านที่ยังอยู่ในช่วงทดลอง (`FREE_TRIAL_15` ยังไม่หมด ไม่เคยมี grant แบบจ่ายเงิน) ซื้อครั้งแรก จะได้ใบเสร็จทดลองที่ยังไม่ใช้ยกไป
- **สูตร:** `units = max(0, min(15, เพดานเดือนนี้ของ term) − ใช้ไปเดือนนี้)`; ตอน apply คิดซ้ำและใช้ค่าน้อยสุดของ (ตอน quote, ตอนจ่าย, ปัจจุบัน); 1–15 หน่วย; grant ชนิด `TRIAL_CARRYOVER` หมดอายุที่ `periodEnd` ของงวดที่จ่าย (ไม่ยืดตามเดือนฟรีของโปรโมชัน); ต้องจ่ายก่อน `trialEndsAt`
- **ข้อมูล:** `BillingReceiptGrant`
- **ทดสอบ:** `application/billing-receipt-allocator.spec.ts`

---

## 8. ข้อกำหนดฟังก์ชัน — เครื่องยนต์ billing เบื้องหลัง

**ข้อกำหนดร่วม:** ไม่มีผู้ใช้โดยตรง — ทำงานผ่าน endpoint ภายใน `/v1/internal/billing/*` (`@Public` แต่ต้องมี header `x-worker-token` ที่ผ่าน `assertWorkerToken`) ซึ่ง worker (`apps/workers/src/modules/billing/billing-worker.ts`) เรียกตามรอบ: `drain` ทุก 10 วินาที, `scan` ทุก 30 วินาที, `provider-scans/drain` ทุก 10 วินาที, `notifications/drain` ทุก 10 วินาที มีผลกับทุกแพ็ก ไม่มีหน้าจอ

### FR-BILL-030 รับ webhook จาก Stripe

- **คำอธิบาย/ขั้นตอน:** `POST /v1/public/stripe-events` → ต้องเปิด billing และมี webhook secret (503 ถ้าไม่มี) → ตรวจลายเซ็นกับ raw body (401 ถ้าไม่ผ่าน) → parse JSON (400) → `validBillingEvent` (400 "Stripe environment or version mismatch") → ถ้าไม่ใช่ event ที่สนใจ ตอบรับเฉย ๆ → `upsert` `BillingProviderEvent` ด้วย unique `(stripeAccountId, livemode, eventId)` (ซ้ำ = ไม่ทำอะไร) → 200 `{accepted:true}`; บันทึกไม่ได้ → 503 เพื่อให้ Stripe ส่งซ้ำ
- **กฎ:** ไม่ประมวลผลใน request; ไม่เก็บ payload เต็ม (เก็บ `evidenceHash`)
- **ข้อมูล:** `BillingProviderEvent` — **API:** `POST /v1/public/stripe-events` — **ทดสอบ:** `infrastructure/stripe.client.spec.ts`

### FR-BILL-031 ประมวลผล event (drain)

- **ขั้นตอน:** `reconciler.drain()` หยิบสูงสุด 10 แถว (เพดาน 25) สถานะ `PENDING/RETRY/PROCESSING` ที่ถึง `retryAt` และ lease หมด เรียงตาม `receivedAt` → `reconcileEvent`: claim ด้วย CAS + lease 120 วินาที + `attempts + 1` → `handle()` (§5.4) → สำเร็จ = `PROCESSED` + ปิด issue `PROVIDER_EVENT_FAILED`; ล้มเหลว = `RETRY` พร้อม backoff หรือ `DEAD` (ครั้งที่ 10) + เปิด issue
- **ลำดับใน `POST internal/billing/drain`:** checkout expiry → configuration checks → scheduled configuration → refunds → recipient admin changes → provider events → repair operations; ตอบ `{processed, failed}` รวม
- **API:** `POST /v1/internal/billing/drain`

### FR-BILL-032 กระทบสถานะบัญชีกับ Stripe (reconcile account + scan)

- **คำอธิบาย:** `reconcileAccount(accountId)` คือจุดเดียวที่เขียนสถานะการเงินของร้านจากความจริงที่ Stripe
- **ขั้นตอน (ย่อ ตามลำดับโค้ด `billing-reconciler.service.ts:263`):**
  1. ยึด lease ของบัญชี 120 วินาที (ไม่ได้ → `billing.reconciliation_busy`) และ `assertAccount`
  2. ถ้ายังไม่มี `customerId` แต่มี attempt: ค้น Customer ด้วย metadata (ไม่สร้างใหม่); ไม่พบ → ปล่อย attempt ที่ไม่เคยเริ่ม (`releaseUnstartedCheckout`)
  3. ปิดงาน profile sync ที่ค้าง (`settleProfileSync`: ส่งซ้ำด้วย key เดิมภายใน 1 ชม.; พ้น 1 ชม. + 10 นาที → attempt `FAILED` / `BILLING_PROFILE_SYNC_RETRY`)
  4. ใช้ plan change ของแพ็กครั้งเดียวที่ถึงกำหนด + ย้ายเมนู
  5. เดินคำสั่งเปลี่ยนอีเมลผู้รับ (`emailRecipient.advance`)
  6. ถ้ามี `activeCollectionOperationId`: เดินคำสั่งนั้น (free days / pause collection / price return / deal subscription cancel / collection) แล้วจบรอบ
  7. อ่าน charge/refund/dispute (`observeBillingCharges`)
  8. แยกเส้นทาง: repeat (`repeater.advance`) / ครั้งเดียว-PromptPay-prepaid (`reconcileOneTime`) / subscription ปกติ
  9. subscription ปกติ: อ่าน session → อัปเดต attempt (`OPEN`/`COMPLETED`/`EXPIRED`) → อ่าน subscription → ตรวจพันธะ (`billing.subscription_binding`, `billing.contract_binding`) → ตรวจ subscription ซ้ำซ้อน (issue `DUPLICATE_SUBSCRIPTION`) → วนใบแจ้งหนี้ `paid` เรียงตาม `created`: ยอด 0 ข้าม (หรือ issue `ZERO_INVOICE_REVIEW`), ยอด > 0 → `verifyAndApplyInvoice` (ล้มเหลว → issue `PAID_NOT_APPLIED`) → `enforceGrace` → อ่าน schedule → เขียน `baseSubscriptionId`, `renewalMode`, `subscriptionState`, `cancelAtPeriodEnd`, `nextChargeAt`, `collectionPauseJson`, ปล่อย `activeAttemptId`
  10. ปล่อย lease และตั้ง `nextReconcileAt = now + 5 นาที`
- **`scan()`:** retry การย้ายเมนูที่ค้าง แล้วหยิบสูงสุด 20 บัญชีที่ถึง `nextReconcileAt`; ล้มเหลว → issue `RECONCILIATION_FAILED` (ถูกปิดอัตโนมัติเมื่อรอบถัดไปสำเร็จ)
- **กฎ:** ทุกการเขียนอยู่ใน transaction ที่ `lockPlanTermCompany` + `assertLease` (lock แถวบัญชี `FOR UPDATE` และตรวจ token); worker ที่ lease หมดเขียนทับไม่ได้ (`billing.lost_lease`)
- **API:** `POST /v1/internal/billing/scan` — **ทดสอบ:** `application/billing-reconcile-command.spec.ts`, `billing-profile-recovery.spec.ts`

### FR-BILL-033 ตรวจหลักฐานและให้สิทธิ์จากใบแจ้งหนี้ subscription (`paidInvoiceEvidence` + `applyInvoice`)

- **หลักฐานที่ต้องตรงทุกข้อ (`domain/paid-invoice.ts`):** invoice `paid`, สกุล thb, `collection_method` ถูกโหมด, `billing_reason ∈ {subscription_create, subscription_cycle}`, ไม่ใช่ `paid_out_of_band`, `amount_remaining = 0`, `total = quote.totalSatang`, `amount_paid = total`, `starting_balance = 0`, ไม่มี credit note ก่อนจ่าย/discount, 1 line (ไม่ proration, `price = snapshot.priceId`, quantity 1), 1 invoice payment (`paid`), PaymentIntent `succeeded`, Charge `succeeded/paid/captured`, ชนิดวิธีจ่ายถูก, ภาษีรวม = `quote.taxSatang` — ผิด → `BILLING_INVOICE_MISMATCH`
- **`evidenceHash`** = hash ของ (invoice, subscription, customer, charge, ยอด, priceId, period) — ใบเดิมที่ hash เปลี่ยน → `billing.invoice_evidence_changed`
- **ชนิด:** `INITIAL` (`subscription_create` ที่ไม่ใช่ PromptPay renew) หรือ `RENEWAL`
- **เงื่อนไข HELD (ไม่ให้สิทธิ์):** ไม่ใช่สัญญาปัจจุบัน; `periodEnd ≤ paidThrough` เดิม; บริษัทถูก admin hold; dispute หรือมี refund; `periodEnd ≤ now` หรือ `periodStart > now`; (PromptPay renew) `periodStart ≠ paidThrough`; `termProjectionHash` ไม่ตรง; capacity ไม่พร้อม; feature plan เปลี่ยน
- **ผลเมื่อ apply (transaction เดียว):** upsert `BillingInvoice`; บันทึกผู้รับเอกสาร (เฉพาะ INITIAL); trial carryover; `applyCapacity`; `applyBillingFeaturePlan` (INITIAL หรือรอบคืนราคาดีล); upsert `CompanyPlanTerm` (tier, เพดาน, `termStartAt = periodStart`, `termEndsAt = periodEnd`, ล้าง `termDisabledAt`/warm-up/ธงเตือน, `renewCount + 1`); ถ้าร้านถูกปิดเพราะ term → เปิดกลับ (`lifecycle.execute … 'stripe_verified_paid'`); `grantPaidPackageReceipts` (หน่วย = `offer.receiptAllowance`, ใช้ได้ `[periodStart, periodEnd)`); อัปเดตบัญชี (`paidThrough = periodEnd`, `graceEndsAt = null`, `termProjectionHash`); invoice → `APPLIED`; ปิดคำขอแพ็กจาก LINE ที่จ่ายแล้ว/ถูกแทน; ดีล (`applyDealRequest`) หรือ referral attribution; ปิด issue `PAID_HELD`/`PAID_NOT_APPLIED`; audit `billing.invoice.applied` (CRITICAL); outbox `billing.invoice.applied` (key `billing:applied:{invoiceId}`)
- **ข้อมูล:** `BillingInvoice`, `BillingSubscriptionContract`, `CompanyPlanTerm`, `BillingReceiptGrant`, `BillingAccount`, `PackageChangeRequest`, `SalesAttribution`, `CompanyAiConfiguration`, `AuditLog`, `OutboxEvent`
- **ทดสอบ:** `domain/paid-invoice-promptpay.spec.ts`, `application/billing-feature-entitlements.spec.ts`, `.pg.spec.ts`

### FR-BILL-034 ตรวจหลักฐานและให้สิทธิ์จาก Checkout จ่ายครั้งเดียว (`paidPackageCheckoutEvidence` + `reconcileOneTime`)

- **หลักฐาน (`domain/paid-checkout-invoice.ts`):** session `mode: payment`, `status: complete`, `payment_status: paid`, ไม่มี subscription, `client_reference_id` + metadata ตรง attempt/บัญชี, `invoice_creation.enabled`, `amount_total = total ที่คาด`, `amount_tax = tax ที่คาด`, discount/shipping = 0; invoice `paid`, `billing_reason = manual`, `collection_method = send_invoice`, `parent = null`, metadata ตรง, `paid_at ≥ session.created`; 1 checkout line + 1 invoice line (price `one_time`, product = `productId`, `unit_amount` = ราคาที่เรียกเก็บ); payment/intent/charge ตรงยอดและวิธีจ่าย — ผิด → `BILLING_CHECKOUT_INVOICE_MISMATCH`; ยอดที่คาด = ยอดหลังส่วนลดงาน (ถ้าเลือก USE และคำนวณซ้ำได้ตรง) มิฉะนั้นยอด quote
- **ผลเมื่อ apply:** คำนวณ `fullPackagePurchaseImpact` จาก `paidAt` ที่ Stripe ยืนยัน; term/เพดาน/เมนู/ใบเสร็จ; `renewalMode` = โหมดที่ซื้อ, `billingAnchorDay`, `contractAttemptId`; upgrade → grant `UPGRADE` + tier ใหม่; โปรโมชัน → `consumePromotion`, `benefitEnd`, ใบเสร็จโบนัส, `markPromotionApplied`; ส่วนลดงาน → `useEventDiscount`; scheduled change → สร้าง `CUSTOMER_PREPAID_PLAN_CHANGE`
- **หลัง apply (โหมดต่ออายุ):** ผูก subscription — PROMPTPAY_RENEW (`send_invoice`) หรือ CARD_AUTO prepaid (ต้องมีบัตรที่บันทึกไว้ มิฉะนั้น `billing.card_renewal_card_not_saved`) โดย `POST /subscriptions` ที่ `trialing` ถึงสิ้นงวด (หรือ `benefitEnd`); บันทึก journal การส่งคำสั่งเพื่อไม่ส่งซ้ำ; พบ subscription ซ้ำ → error; ผูกไม่ทันขอบรอบ → ยุติการผูก (`billing.renewal_binding.ended`)
- **ทดสอบ:** `domain/paid-checkout-invoice.spec.ts`, `application/billing-advance-deal.pg.spec.ts`

### FR-BILL-035 การต่ออายุ

- **CARD_AUTO:** Stripe ตัดบัตรและส่ง `invoice.paid` → ใบ `RENEWAL` ถูกตรวจกับ snapshot ของสัญญาที่มีผล ณ วันเริ่มงวด (`BillingSubscriptionContract` ล่าสุดที่ `effectiveAt ≤ periodStart`; ไม่มี = snapshot ตั้งต้น) → apply เลื่อน `paidThrough` และมอบใบเสร็จงวดใหม่; สิทธิ์โปรโมชันไม่ถูกนำไปใช้กับรอบต่ออายุ (ตัด `promotion` ออกจาก snapshot)
- **PROMPTPAY_RENEW:** Stripe ออกบิล; ร้านจ่ายผ่าน hosted invoice; apply เหมือนกันแต่ต้องเริ่มงวดตรง `paidThrough`
- **CARD_ONCE / PROMPTPAY_ONCE:** ไม่มีการต่ออายุอัตโนมัติ `nextChargeAt = null`; ร้านซื้อซ้ำเอง (FR-BILL-014) หรือปล่อยหมดแล้ว RESTART
- **ราคาต่ออายุ:** ราคา catalog ที่ผูกใน subscription (ราคาเต็ม ไม่มีส่วนลดงาน/โปรโมชัน); ดีลต่ออายุใช้ราคาดีลจนครบ `cycles` แล้วคืนราคาปกติ
- **การเตือนก่อนหมด:** ดู FR-BILL-082 (บันไดเตือน 7/3/1 วันของ plan term)

### FR-BILL-036 Grace period เมื่อเก็บเงินต่ออายุไม่ได้ (`enforceGrace`)

- **เงื่อนไขเข้า:** subscription `past_due`/`unpaid` (หรือ PROMPTPAY_RENEW ที่ `active` แต่เลย `paidThrough` แล้ว) และ `policy.graceDays ≠ null`; ใบที่ค้างต้องเป็น "ใบต่ออายุของสัญญานี้จริง": `latest_invoice` สถานะ `open`, `billing_reason = subscription_cycle` (หรือ `subscription_create` สำหรับ QR), `collection_method` ถูก, `total = quote.totalSatang`, `amount_paid = 0`, 1 line ราคาตรง และ `period.start = paidThrough` — ไม่ตรง → issue `RENEWAL_REVIEW` และไม่ให้ grace ("สถานะของ provider อย่างเดียวให้สิทธิ์ฟรีไม่ได้")
- **ผล:** `graceEnd = paidThrough + graceDays วัน`; ถ้ายังไม่ถึง `graceEnd` และ term สิ้นสุดก่อนนั้น → ยืด `CompanyPlanTerm.termEndsAt = graceEnd`, ล้าง `termDisabledAt`, ยืดอายุ receipt grant เดิม (ไม่มอบใบเสร็จงวดใหม่), เปิดร้านกลับถ้าถูกปิดเพราะ term (`'stripe_renewal_grace'`), audit `billing.grace.started`; ตั้ง `BillingAccount.graceEndsAt`
- **เมื่อเลย `graceEnd`:** อ่าน subscription ซ้ำ → ถ้ายังค้างใบเดิม สร้าง operation `GRACE_EXPIRE` (`initiatorUserId = 'billing-worker'`) แล้ว `DELETE /subscriptions/:id` (`invoice_now: false, prorate: false`) → `SUCCEEDED`; ผลไม่ชัด → `UNKNOWN` + issue `GRACE_CANCELLATION_UNKNOWN` (ปิดเองเมื่อเห็น subscription `canceled`)
- **เมื่อจ่ายทันใน grace:** apply ใบต่ออายุ → `graceEndsAt = null` และคืนอายุ grant เดิมให้สิ้นที่ `paidThrough` เดิม
- **ผลต่อร้าน:** `paymentState = FAILED` ระหว่าง grace; ซื้อใหม่ไม่ได้จนกว่าจะจ่ายหรือ grace จบ (`BILLING_RESTART_REVIEW`)

### FR-BILL-037 ติดตามการคืนเงินและ dispute (`billing-financial.ts`, `observeBillingCharges`)

- **คำอธิบาย:** ทุก reconcile อ่าน charge ของใบแจ้งหนี้และบันทึก `refundedSatang`, `disputed`, `financialObservedAt`; event การเงินที่หา invoice ไม่เจอ → issue `FINANCIAL_REVIEW` (priority HIGH)
- **ผลต่อเนื่อง:** ใบที่มี refund/dispute ถูก `HELD` ถ้ายังไม่ apply; ปิดทาง RESTART/upgrade/repeat ที่อ้างใบนั้น; หักเครดิตยอดขายของเซลล์ (`SalesAttributionDeduction`) เมื่อเกิดภายใน 60 วันนับจากจ่าย (เวลาของ provider); โปรโมชันที่คืนเงินเต็ม → ยุติสิทธิ์ที่เหลือหรือ issue `PROMOTION_REVIEW`
- **ทดสอบ:** `application/billing-financial.spec.ts`, `billing-refund-source.spec.ts`, `sales-console/domain/sales-attribution.logic.spec.ts`

### FR-BILL-038 ตรวจพบและปิด issue อัตโนมัติ (`billing-issues.ts`)

- **กฎ:** issue มีเอกลักษณ์ `(stripeAccountId, livemode, kind, referenceId)`; `detectBillingIssue` สร้างหรือ "เปิดซ้ำ" (episode ใหม่) ภายใต้ advisory lock; `resolveBillingIssue` ปิดพร้อม `evidenceCode`; audit `billing.issue.detected` / `.reopened` / `.resolved` (actor `SERVICE: billing-issue-detector`); `PAID_HELD`/`PAID_NOT_APPLIED` ปิดได้เฉพาะเมื่อใบต้นเรื่อง `APPLIED` และ `paidSatang = totalSatang` (`ORIGINAL_INVOICE_APPLIED`)
- **รายการ kind:** ดูภาคผนวก ง

### FR-BILL-039 การแจ้งเตือน billing (`billing-notifications.service.ts`)

- **คำอธิบาย:** เมื่อใบแจ้งหนี้ apply ระบบแจ้ง "แพ็กเกจอัปเดตแล้ว" ผ่าน 3 ช่อง: `WEB` (แจ้งเตือนในระบบ — อัตโนมัติ), `LINE` (push ถึงผู้ใช้ที่ผูก LINE OA และเปิด trigger), `EMAIL` (outbox `billing.status.email` ถึงผู้รับเอกสารหรืออีเมลที่ยืนยันแล้วของเจ้าของ)
- **Gate:** `notification_delivery` ปิด → `NOTIFICATION_PAUSED`
- **เหตุที่ส่งไม่ได้ (`recoveryBlockedReason`):** `WEB_DELIVERY_AUTOMATIC`, `PREFERENCE_SUPPRESSED`, `LINE_CONFIGURATION_MISSING`, `NO_LINE_DELIVERY_TARGET`, `LINE_BINDING_CHANGED`, `LINE_UNKNOWN_REVIEW` (ผลไม่ชัดเกิน 23 ชม.), `LINE_RETRY_EXHAUSTED`, `VERIFIED_EMAIL_REQUIRED`, `RECIPIENT_MISSING`
- **หลักการ:** แจ้งเฉพาะผู้เกี่ยวข้อง (ผู้เริ่มรายการ/ผู้รับเอกสาร) ไม่กระจายถึงทุกเจ้าของ; อีเมลติดตามผลถึงระดับ `deliveredAt` และธง `possibleDuplicate`; ผู้ดูแลสั่งส่งซ้ำ/ตรวจผลผ่าน FR-BILL-052
- **API:** `POST /v1/internal/billing/notifications/drain`; อ่านผ่าน `GET system/billing/companies/:id/deliveries[/:deliveryId]`
- **ข้อมูล:** `OutboxEvent`, `EmailSendAttempt`, ตาราง notification ของ `dashboard-notifications`, issue `NOTIFICATION_REVIEW`, `NOTIFICATION_RECIPIENT_CHANGED`
- **ทดสอบ:** `application/billing-notifications-recipient.spec.ts`

### FR-BILL-040 ชุดเมนูตามแพ็ก (feature plan) และการย้ายเมนู

- **คำอธิบาย:** `billingFeaturePlan(companyId, featureKeys)` สร้างแผน: เมนูที่จะเปิด/ปิด และ `preservedAdmin` (เมนูที่ผู้ดูแลเปิดให้เป็นพิเศษซึ่งคงไว้) พร้อม `sourceHash`/`planHash`; `applyBillingFeaturePlan` เขียน entitlement ใน transaction ของ apply ภายใต้ `exclusiveEntitlementLock`; เมนูที่ถูกปิดเข้าสู่ runoff (`completeRunoffIfDrained`)
- **กฎ:** ซื้อ catalog → เมนู = `TIER_FEATURE_PRESETS[tier]`; ดีล → `featureKeys` ของดีล (ผ่าน `salesDealFeatureKeys`: เมนูแม่ที่ไม่ระบุเมนูย่อย = ทุกเมนูย่อยที่ขายได้); entitlement ของร้านที่ต้องตรวจโดยทีมงาน → `BILLING_ENTITLEMENT_REVIEW_REQUIRED`; การเปลี่ยนแพ็กกลางรอบย้ายเมนู "ตอนมีผล" ผ่าน operation `APPLY_PLAN_MENUS` (เขียนคิวใน commit เดียวกับ apply; retry โดย `scan()`)
- **ทดสอบ:** `application/billing-feature-entitlements.spec.ts`, `.pg.spec.ts`, `billing-plan-menus.spec.ts`

### FR-BILL-041 บัญชีใบเสร็จ (receipt grants)

- **คำอธิบาย:** โควตาอ่านรูปใบเสร็จของร้านที่จ่ายเงินเป็น "ล็อต" (`BillingReceiptGrant`) ชนิด `INITIAL`, `RENEWAL`, `REPEAT`, `UPGRADE`, `TRIAL_CARRYOVER` และล็อตจากผู้ดูแล/โปรโมชัน/add-on; แต่ละล็อตมี `units`, `availableAt`, `expiresAt`, `serviceStart/End`, `revokedAt`; การใช้บันทึกใน `ReceiptUnitEntry`
- **กฎ:** `unique (sourceKey)` ต่อใบแจ้งหนี้ทำให้ apply ซ้ำไม่มอบซ้ำ; ล็อตหมดอายุพร้อมงวด (ยืดได้เฉพาะช่วง grace); ยอดคงเหลือที่หน้าร้าน = `packageReceiptBalance`; ตัวเลขรวมจำกัดที่ int32
- **ทดสอบ:** `application/billing-receipt-allocator.spec.ts`

### FR-BILL-042 กฎการจบคำสั่ง, lease และ idempotency (billing command end rules)

- **กฎที่โค้ดบังคับ:**
  1. คำสั่งที่ส่งไป provider แล้ว "จบ" ได้เฉพาะจากการอ่าน provider (เห็นผล หรือพิสูจน์ได้ว่าไม่เคยเกิด) ไม่จบด้วยเวลาที่ผ่านไปอย่างเดียว
  2. คำสั่งเดิมถูกส่งซ้ำด้วย idempotency key เดิมภายใน 1 ชั่วโมงจากครั้งแรก (`RESEND_WINDOW_MS`); หลังจากนั้นแต่ละรอบ "อ่านอย่างเดียว"; เงียบอีก 10 นาที (`QUIET_MARGIN_MS`) แล้วไม่พบร่องรอย = ไม่เคยเกิด → จบแบบไม่มีผลและปล่อยร้าน
  3. Stripe ตอบ 400/402 ต่อคำสั่งสร้าง = provider ไม่ได้ทำอะไร → จบทันที (`…_PROVIDER_REJECTED`); 409/429/5xx/ไม่ตอบ = คงสถานะไม่ชัด
  4. คำสั่งที่ถูก `BLOCKED` ไม่ถูก retry อัตโนมัติ
  5. หนึ่งบัญชีมีได้ทีละหนึ่ง: attempt (`activeAttemptId`), คำสั่ง collection (`activeCollectionOperationId`), คำสั่งเปลี่ยนอีเมล (`activeEmailOperationId`), plan change ที่รอ (`pendingPlanChangeId`)
  6. คำสั่งของผู้ใช้ทุกตัวต้องมี `Idempotency-Key` (16–120 ตัว) + `requestHash`; key เดิมข้อมูลต่าง → `…_IDEMPOTENCY_CONFLICT`
  7. Optimistic concurrency ด้วย `version` + `previewHash`/`sourceHash`; ลำดับ lock: (promotion fence) → Company (`lockPlanTermCompany`) → `BillingSettings` → `BillingAccount`
- **ทดสอบ:** `application/billing-reconcile-command.spec.ts`, `billing-collection.spec.ts`, `billing-refund-source.spec.ts`

---

## 9. ข้อกำหนดฟังก์ชัน — คอนโซล billing ของผู้ดูแล

**ข้อกำหนดร่วม**

- **ผู้ใช้:** เจ้าหน้าที่แพลตฟอร์มที่มี role ระบบ (`SYSTEM_ADMIN` หรือ role ที่มี `system.billing.*`) — สิทธิ์ตามตาราง §6.1; ผู้ที่ไม่ใช่ `SYSTEM_ADMIN` ทำได้เฉพาะบริษัทในขอบเขต (FR-BILL-060)
- **แพ็ก:** ไม่ผูกกับแพ็ก (เครื่องมือของแพลตฟอร์ม)
- **Base route:** `/v1/system/billing` (`BillingAdminController`); ทุกคำสั่งผ่าน `operationLimit` = ต้องมี `system.billing.read` และไม่เกิน 30 ครั้ง/60 วินาที/ผู้ใช้; ทุก response `Cache-Control: no-store`
- **รูปแบบคำสั่ง:** `preview` (คืน operation + `previewHash`) → `submit` → `approve` (ตาม §6.3) → `run`/worker; ต้อง reauth (§6.3)
- **หน้าจอ:** `/system/billing/**` (ภาคผนวก ข) component ใน `apps/web/features/billing-admin/**`
- **ทดสอบร่วม:** `e2e/billing-admin-directory.spec.ts`, `e2e/billing-admin-menu-ux.spec.ts`, `e2e/billing-admin-document-tools.spec.ts`

### FR-BILL-050 ภาพรวมร้าน, รายละเอียดร้าน, timeline และการส่งออก

- **คำอธิบาย:** `overview` แสดงรายการร้านพร้อมสถานะ (`BillingOperatorCompany`: โหมด, subscription, `paidThrough`, แหล่ง `TRIAL | MANUAL | STRIPE | DEAL | OTHER_BILLING | NONE`, `planState`, เพดาน, attempt/คำสั่งที่ค้าง) ค้นด้วยชื่อ/รหัส, แบ่งหน้า (`page` หรือ `cursor`); `companies/:id` เพิ่ม usage, issue, ใบแจ้งหนี้ (เฉพาะผู้มี `financial.read`), ส่วนลดงานที่ร้านจอง/ใช้ (สูงสุด 25); `timeline` รวมเหตุการณ์ (attempt, invoice, operation, issue, audit ถ้ามี `audit.read`); `timeline/export` คืน CSV + `sha256`
- **สิทธิ์:** `system.billing.read`; ส่งออก `system.billing.export`; ยอดเงินต้อง `financial.read`
- **API:** `GET overview`, `GET companies/:id`, `GET companies/:id/timeline`, `POST companies/:id/timeline/export`
- **หน้าจอ:** `/system/billing`, `/system/billing/companies/[id]`
- **ทดสอบ:** `application/billing-overview-pagination.spec.ts`

### FR-BILL-051 คิว issue และบันทึกการติดตาม (support outcome)

- **คำอธิบาย:** รายการ issue กรองตาม `companyId`, `state`, คิว `UNASSIGNED`/`OVERDUE`; แก้ `state`, `note` (≤ 1000), ผู้รับผิดชอบ, ผู้สำรอง, `priority` (`NORMAL/HIGH/CRITICAL`), `followUpAt`; เปลี่ยน priority คำนวณ `slaDueAt` ใหม่จาก policy ของ episode (ไม่มีเกณฑ์เดิม → `CONTROL_SLA_REVIEW`); ผู้รับผิดชอบต้องเป็นเจ้าหน้าที่ที่มี `system.billing.read` + `issue.manage` และครอบคลุมบริษัทนั้น (`issueOperators`)
- **Support outcome:** บันทึกผลติดต่อ (`CUSTOMER_CONTACTED`, `PROVIDER_CONTACTED`, `REPLY_RECORDED`, `REVIEW_REQUESTED`) แบบ preview → submit/cancel (operation `RECORD_SUPPORT_OUTCOME`)
- **สิทธิ์:** อ่าน `system.billing.read`; แก้ `system.billing.issue.manage` (จำกัด 30 ครั้ง/นาที แยก bucket `billing-issue-update`)
- **API:** `GET issues`, `GET issues/:id`, `PATCH issues/:id`, `GET issues/:id/operators`, `GET issues/:id/outcomes[/:outcomeId]`, `POST issues/:id/outcomes/preview`, `POST issues/:id/outcomes/:outcomeId/:action`
- **หน้าจอ:** `/system/billing/issues`, `/system/billing/issues/[id]`

### FR-BILL-052 คำสั่งซ่อม (repair operations)

- **ชนิด:** `RECONCILE` (กระทบบัญชีทันที), `IMPORT_INVOICE` (นำเข้าใบที่ scan พบ — บันทึกอย่างเดียว ไม่เปลี่ยนสิทธิ์: `HELD` + `access_review_required`, audit `billing.invoice.imported`), `RETRY_APPLY` (ลอง apply ใบ `HELD`), `RETRY_NOTIFICATION`, `RECONCILE_NOTIFICATION`, `RETRY_PROVIDER_EVENT` (จากหน้า event)
- **ขั้นตอน:** `operations/preview` (`type`, `companyId`, `reason` ≤ 500, `expectedVersion`, `referenceId`, `invoiceSourceHash`/`findingSourceHash`) → `POST operations` (`previewId`, `previewHash`, Idempotency-Key; 202) → worker (`operations.drain`) → ดูผล `operations/:id`; `retry`/`cancel`
- **สิทธิ์ในบริการ:** ตามชนิด (`reconcile.run`, `apply.retry`, `notification.retry`)
- **API:** `GET operations`, `GET operations/:id`, `POST operations/preview`, `POST operations`, `POST operations/:id/:action`, `GET companies/:id/apply-invoices[/:id]`, `GET companies/:id/invoice-findings/:findingId`
- **หน้าจอ:** `/system/billing/operations/[id]`, `/companies/[id]/apply-invoices`, `/companies/[id]/invoice-findings/[findingId]`

### FR-BILL-053 Provider events

- **คำอธิบาย:** รายการ event ที่ยังไม่จบ (หรือทั้งหมดด้วย `all=true`), รายละเอียด (ชนิด, สถานะ, จำนวนครั้ง, `retryAt`, `errorCode`, issue ที่ผูก), สั่ง retry event ที่ `DEAD`/ค้าง ผ่าน preview (`sourceHash`, `reason`)
- **สิทธิ์:** อ่าน `system.billing.read`; retry `system.billing.reconcile.run`
- **API:** `GET provider-events`, `GET provider-events/:id`, `POST provider-events/:id/preview`
- **หน้าจอ:** `/system/billing/provider-events`, `/[id]`

### FR-BILL-054 Provider scans, ตารางสแกนอัตโนมัติ และ invoice scans/findings

- **คำอธิบาย:** (ก) สแกน event ย้อนหลังทั้งบัญชี Stripe ในช่วงเวลา (`GET /events`) เพื่อนำเข้า event ที่ webhook พลาด — นับ `seen/imported/known/ignored/incompatible`; (ข) สแกนใบแจ้งหนี้ของร้านหนึ่ง (`GET /invoices` ตาม customer) เทียบกับฐานข้อมูล → finding `MATCHED | LOCAL_MISSING | DIFFERENT`; (ค) ตารางสแกนอัตโนมัติ
- **Input:** `windowStart`, `windowEnd` (ISO UTC `…Z`), `reason`, Idempotency-Key; action `resume`/`cancel` ด้วย `expectedVersion`; มีงานค้าง → `CONTROL_SCAN_BUSY`
- **ตาราง:** `enabled`, `intervalHours` 1–168 (ตั้งต้น 24), `initialLookbackHours` 1–672 (ตั้งต้น 48); เปลี่ยนผ่าน preview → publish/cancel (operation `CONFIGURE_PROVIDER_SCANS`)
- **Issue ที่เกี่ยว:** `PROVIDER_SCAN_FAILED`, `PROVIDER_SCAN_COVERAGE_GAP`, `PROVIDER_SCAN_VERSION_UNSUPPORTED`, `PROVIDER_SCAN_SCHEDULE_BLOCKED`, `PROVIDER_INVOICE_SCAN_FAILED`, `PROVIDER_INVOICE_REVIEW`
- **สิทธิ์:** อ่าน `system.billing.read`; สั่ง `system.billing.reconcile.run`
- **API:** `GET/POST provider-scans`, `GET provider-scans/:id`, `POST provider-scans/:id/:action`, `GET provider-scans/schedule`, `GET …/schedule/history`, `GET …/schedule/operations/:id`, `POST …/schedule/preview`, `POST …/schedule/operations/:id/:action`, `GET/POST companies/:id/invoice-scans`, `GET companies/:id/invoice-scans/:scanId[/findings]`, `POST companies/:id/invoice-scans/:scanId/:action`; worker `POST internal/billing/provider-scans/drain`
- **หน้าจอ:** `/system/billing/provider-scans[/id]`, `/companies/[id]/invoice-scans[/scanId]`

### FR-BILL-055 Settlement และการกระทบยอดเงินเข้า

- **คำอธิบาย:** งานอ่าน Balance Transactions ของ Stripe ในช่วงเวลา แล้วจับคู่กับใบแจ้งหนี้/การคืนเงินในระบบ; ผลรวม (`BillingSettlementTotals`): `grossCharges`, `knownTax`, `unknownTaxCharges`, `fees`, `netMovement`, `payouts`, `payoutReversals`, `excluded`; finding ต่อรายการ: `MATCHED | DIFFERENT | MANUAL | LOCAL_MISSING` พร้อมยอด/ค่าธรรมเนียม/สุทธิ/ภาษี, `availability`, ข้อมูล payout (สถานะ, วันถึง, `reconciliation`: `MATCHED | PENDING | MANUAL | INCOMPLETE | FAILED`)
- **กฎ:** งานหนึ่งทีละงาน (`CONTROL_SCAN_BUSY`); action `run`/`resume`/`cancel`; issue `SETTLEMENT_SCAN_FAILED`, `SETTLEMENT_REVIEW`; ตัวอ่านเดียวกัน (`BillingCashMovementsService`) ถูกใช้โดยรายงานผู้บริหาร
- **สิทธิ์:** อ่าน `system.billing.financial.read`; สั่ง `system.billing.reconcile.run`
- **API:** `GET/POST settlements`, `GET settlements/:id`, `GET settlements/:id/findings`, `POST settlements/:id/:action`
- **หน้าจอ:** `/system/billing/settlements[/id]`
- **ทดสอบ:** `application/billing-settlement-source.spec.ts`

### FR-BILL-056 การตั้งค่า: policy, gate, ร่าง, ตั้งเวลา, ปิดฉุกเฉิน

- **คำอธิบาย:** `settings` คืน `BillingConfiguration` (version, โหมด, policy, gates, capabilities, `reauthenticatedUntil`, ร้านใน cohort)
- **ขั้นตอนเปลี่ยน:** `configuration-drafts` (บันทึกร่าง `DRAFT`) → `configuration-changes/preview` (`type`: `PUBLISH_POLICY` | `SET_ACTION_GATE`, `expectedVersion`, `policy`, `gates`, `reason`, `effectiveAt`?) → คำนวณ `impact` (จำนวน subscription, attempt ค้าง, quote ที่ยังไม่ใช้, plan change ที่รอ, คำสั่ง collection; ราคาก่อน/หลังทุก offer; cohort; refund limit; SLA) → `submit` (reauth + Idempotency-Key) → `approve` (ตรวจ provider: Price/Tax/Portal ผ่าน `validateProvider`) → มีผลทันที (revision ใหม่ `ACTIVE`, `settings.version + 1`) หรือ `SCHEDULED` ตาม `effectiveAt` (ล่วงหน้า ≥ 1 นาที ≤ 1 ปี; `CONTROL_SCHEDULE_TIME`) แล้ว worker/ผู้ดูแล `apply`; `cancel`
- **รายการที่ได้รับผลกระทบ:** `configuration-changes/:id/affected?kind=SUBSCRIPTION|ATTEMPT|QUOTE|PLAN_CHANGE|COLLECTION` (แบ่งหน้า, ตรวจ `matchesPreview`)
- **กฎ:** policy ใหม่มีผลกับการซื้อใหม่; สัญญาเดิมถือ snapshot ของตัวเอง; quote ที่ตรึง `settingsVersion` เก่า → stale; ต้องเป็น platform scope; `PUBLISH_POLICY` ต้อง `policy.manage`, `SET_ACTION_GATE` ต้อง `gate.manage`; ร้านใน `salesCompanyIds` ต้องมีอยู่จริง (`CONTROL_SALES_COMPANY_INVALID`); ถึงเวลาแล้วสิทธิ์เปลี่ยน → `BLOCKED` + issue `CONFIGURATION_SCHEDULE_REVIEW`
- **ปิดฉุกเฉิน:** `settings/emergency-close` (`gate.manage`, reauth, Idempotency-Key) ปิด gate ทันทีในขั้นเดียว (operation `SET_ACTION_GATE` สถานะ `SUCCEEDED` ไม่ต้องรออนุมัติ) — ใช้ได้เฉพาะการ "ปิด"
- **API:** `GET settings`, `GET configuration-changes`, `GET configuration-changes/:id`, `GET …/:id/affected`, `POST configuration-changes/preview`, `POST configuration-drafts`, `POST configuration-changes/:id/:action` (`submit|approve|cancel|apply`), `POST settings/emergency-close`
- **หน้าจอ:** `/system/billing/settings`, `/configuration-changes/[id]`, `/configuration-changes/[id]/affected`

### FR-BILL-057 ตรวจการตั้งค่ากับ Stripe (configuration checks)

- **คำอธิบาย:** งานเทียบ policy ปัจจุบันกับ Stripe รายรายการ: `POLICY`, `ACCOUNT`, `PRICE` (ต่อ offer), `PREPAID_PRICE`, `PORTAL`, `TAX` → `MATCH | DIFFERENT | UNAVAILABLE | NOT_CONFIGURED` พร้อมเหตุผล (`NOT_CONNECTED`, `POLICY_NOT_READY`, `MAPPING_DIFFERENT`, `PROVIDER_UNAVAILABLE`, `ACCOUNT_DIFFERENT`); สถานะงาน `QUEUED → RUNNING → SUCCEEDED | BLOCKED | CANCELLED`; ผลต่าง → issue `CONFIGURATION_DRIFT`
- **กฎ:** ทีละงาน (`CONTROL_CONFIGURATION_CHECK_ACTIVE`); `isCurrent` = ตรวจกับ `settingsVersion` ปัจจุบัน
- **สิทธิ์:** อ่าน `read`; สร้าง/run/cancel `reconcile.run`
- **API:** `GET configuration-checks[/id]`, `POST configuration-checks` (202), `POST configuration-checks/:id/:action`
- **หน้าจอ:** `/system/billing/configuration-checks[/id]`

### FR-BILL-058 ยืนยันรหัสผ่านซ้ำ (reauthentication)

- ตาม §6.3; ระดับแพลตฟอร์ม `POST reauthenticate` และระดับบริษัท `POST companies/:id/reauthenticate`, `GET companies/:id/reauthenticate` (อ่านว่าหลักฐานยังใช้ได้ถึงเมื่อใด); audit `billing.reauthenticated`; ข้อมูล: `AuthSession.billingReauthenticatedAt`, `billingCredentialVersion`, `UserCredential`

### FR-BILL-059 การอนุมัติและ dual control

- ตาม §6.3 — ใช้กับ: การตั้งค่า, คืนเงิน, ขอบเขตผู้ปฏิบัติงาน, ปรับเพดาน/วันแถม/พักเก็บเงิน, ใบเสร็จแถม, add-on แถม, เปลี่ยนผู้รับเอกสารแทนร้าน, แคมเปญ; ผู้ขอและผู้อนุมัติถูกบันทึก (`initiatorUserId`, `approverUserId`, `approvalMode`) และแสดงชื่อ (`requesterName`, `approverName`)
- **ทดสอบ:** `application/billing-approval.spec.ts`

### FR-BILL-060 ขอบเขตผู้ปฏิบัติงาน (operator scopes)

- **คำอธิบาย:** ให้เจ้าหน้าที่ที่ไม่ใช่ `SYSTEM_ADMIN` ทำงาน billing เฉพาะบริษัทที่ได้รับมอบ (`BillingOperatorScope`: user × company × โหมด, `expiresAt` ได้หรือไม่มี, `revokedAt`); สถานะ `ACTIVE | EXPIRED | REVOKED`
- **ขั้นตอน:** `scope-changes/preview` (`type`: `GRANT_SCOPE` | `REVOKE_SCOPE`, `userId`, `companyId`, `expiresAt | null`, `reason`) → `submit` → `approve` → มีผล; `scope-directory/:kind` ค้นผู้ใช้/บริษัท
- **กฎ:** เป้าหมายต้องเป็นผู้ใช้ ACTIVE ที่มี role ระบบซึ่งมี `system.billing.read` อยู่แล้ว และ **ไม่ใช่** `SYSTEM_ADMIN` (`CONTROL_SCOPE_TARGET_INVALID`); scope ไม่เพิ่ม permission — เพียงจำกัดบริษัท; ผู้ถือ scope อนุมัติคำสั่งตัวเองไม่ได้
- **สิทธิ์:** `admin.role.manage` + เป็น `SYSTEM_ADMIN` (`canManageScopes`)
- **API:** `GET operator-scopes`, `GET scope-directory/:kind`, `GET scope-changes[/id]`, `POST scope-changes/preview`, `POST scope-changes/:id/:action`
- **หน้าจอ:** `/system/billing/operator-scopes`, `/scope-changes/[id]`

### FR-BILL-061 คืนเงิน และยุติแพ็กเกจหลังคืนเงิน

- **เงื่อนไข:** gate `refunds` เปิด; policy มี `refundLimitSatang`; ยอด ≤ วงเงิน (`CONTROL_REFUND_LIMIT`); ไม่มี attempt/คำสั่ง/คำขอคืนเงินอื่นค้าง (`BILLING_REFUND_PENDING`); ไม่มี dispute; ยังคืนไม่เต็ม
- **ขั้นตอน:** `refund-review` (อ่านสดจาก Stripe: ยอดจ่าย, คืนแล้ว, วิธีจ่าย `card`/`promptpay`, รายการ refund/credit note, `sourceHash`, `blockedReason`) → `refund-preview` (`amountSatang`, `reason`, `memo`, `notifyCustomer`, `sourceHash`, `endPackage?`) → `submit` → `approve` → `run` (ผู้มี `refund.manage` หรือ `approval.approve` + reauth) หรือ worker (`refunds.drain`) → `POST /credit_notes` (key `billing-refund-{id}`) → อ่านกลับ → สถานะตาม §4.5 → บันทึก `refundedSatang`
- **ยุติแพ็กเกจ (`billing-end-package.ts`):** เลือก `endPackage` ตอนขอ หรือสั่งแยกหลังคืนเงินสำเร็จ (`end-package`): ตัด `paidThrough`/term ให้สิ้นสุดทันที, เพิกถอนใบเสร็จที่เหลือของงวดนั้น; ตรวจได้ก่อนด้วย `GET end-package` (`canEnd`, `blockedReason`); ต้องไม่มีคำขอคืนเงินค้าง; ใบนั้นต้องเป็นแพ็กที่ "กำลังให้บริการอยู่" (applied และวันสิ้นบริการตรงกับบัญชี/term ปัจจุบัน); ถ้า provider ยังจะเก็บเงินรอบถัดไป (CARD_AUTO/PROMPTPAY_RENEW ที่ยังไม่ยกเลิก) เจ้าหน้าที่ต้องยกเลิกการต่ออายุก่อน; มีผลเฉพาะเมื่อคำขอคืนเงินถึง `SUCCEEDED`
- **การผูกที่ซ่อมไม่ได้:** `unrepairedBinding` = `RENEWAL` (QR/บัตร prepaid ที่ผูกรอบถัดไปไม่ได้ — คืนเต็มเท่านั้นจึงปล่อยร้าน) หรือ `ADVANCE_DEAL`
- **โปรโมชัน:** คืนบางส่วน = คงทุกอย่าง; คืนเต็มสะสม = ยุติสิทธิ์ที่ยังไม่ใช้ (`entitlementAdjustedAt`) หรือ issue `PROMOTION_REVIEW`; สิทธิ์ "หนึ่งครั้งต่อบริษัท" ไม่คืนกลับ
- **สิทธิ์:** อ่าน `financial.read`; preview/end-package `refund.manage`; approve ตาม §6.3
- **ข้อผิดพลาด:** `CONTROL_REFUNDS_CLOSED`, `CONTROL_REFUND_LIMIT`, `CONTROL_REFUND_SOURCE_CHANGED`, `CONTROL_REFUND_DISPUTED`, `CONTROL_REFUND_PENDING`, `CONTROL_REFUND_FULL`, `CONTROL_REFUND_FAILED`, `CONTROL_REFUND_PROVIDER_REJECTED`, `CONTROL_REFUND_PROVIDER_UNAVAILABLE`, `CONTROL_REFUND_NOT_CREATED`, `CONTROL_REFUND_REVIEW`, `CONTROL_PERMISSION_CHANGED`
- **API:** `GET companies/:id/invoices/:invoiceId/refund-review`, `POST …/refund-preview`, `GET …/refund-requests`, `GET refunds/:id`, `POST refunds/:id/:action` (`submit|approve|cancel|run`), `GET|POST companies/:id/invoices/:invoiceId/end-package`, `GET companies/:id/invoices/:invoiceId/adjustments/:kind`
- **หน้าจอ:** `/system/billing/companies/[id]/invoices/[invoiceId]`, `…/refund`, `/system/billing/refunds/[id]`
- **ทดสอบ:** `application/billing-refund-source.spec.ts`, `billing-end-package.spec.ts`

### FR-BILL-062 สั่งให้ Checkout ที่ค้างหมดอายุ

- **คำอธิบาย:** ผู้ดูแลดูรายการ attempt ของร้าน ตรวจสถานะ session ที่ Stripe (`open | expired | complete`, `paid | unpaid | no_payment_required`) และสั่ง expire session ที่ยังเปิดและยังไม่จ่าย เพื่อปล่อยร้านจาก attempt ที่ค้าง
- **ขั้นตอน:** `checkouts/:attemptId` (review, `canExpire`, `blockedReason`) → `preview` (`reason`, `sourceHash`) → `submit` → `run` → `POST /checkout/sessions/:id/expire` → อ่านกลับ; ผลไม่ชัด → `CONTROL_CHECKOUT_OUTCOME_UNKNOWN` + รอ reconcile
- **สิทธิ์:** อ่าน `read`; สั่ง `gate.manage`
- **API:** `GET companies/:id/checkouts`, `GET companies/:id/checkouts/:attemptId`, `POST …/preview`, `GET …/requests`, `GET checkout-expiry/:id`, `POST checkout-expiry/:id/:action` (`submit|cancel|run`)
- **หน้าจอ:** `/system/billing/companies/[id]/checkouts[/attemptId]`, `/checkout-expiry/[id]`
- **ทดสอบ:** `application/billing-checkout-expiry-source.spec.ts`

### FR-BILL-063 Batch reconcile

- **คำอธิบาย:** สั่ง `RECONCILE` หลายร้านในครั้งเดียว (1–25 ร้านต่อ batch ไม่ซ้ำ); ความคืบหน้า `PREVIEW | PENDING | REVIEW | CHECKED | PARTIAL | STOPPED`; ผลต่อร้าน (สถานะ, attempt ค้าง, จำนวน issue, เคสที่ต้องดู); ส่งออก CSV + `sha256`
- **สิทธิ์:** อ่าน `read`; preview/submit/cancel `reconcile.run`; export `export`
- **API:** `GET batches`, `POST batches/preview`, `GET batches/:id`, `GET batches/:id/export`, `POST batches/:id/:action` (`submit|cancel`)
- **หน้าจอ:** `/system/billing/batches[/id]`

### FR-BILL-064 ปรับสิทธิ์แพ็กเกจของร้าน (plan adjustments)

- **ชนิด (`BillingPlanAdjustmentInput.type`):**
  - `GRANT_OVERRIDE` / `REVOKE_OVERRIDE` — เพดานชั่วคราว (`tierKey`, `branchLimit`, `employeeLimit`, `expiresAt`) เก็บใน `CompanyPlanTerm.capacityOverride`; หมดอายุเองโดยไม่ต้องมี worker; `expiresAt` ≤ `min(paidThrough, termEndsAt)`; ไม่แตะฐานที่ซื้อไว้
  - `GRANT_FREE_DAYS` — แถมวัน 1–3650 วัน: `paidThrough ใหม่ = paidThrough + days × 86,400,000 ms`; เลื่อน `nextChargeAt` ของ subscription ตาม; ยืด term และอายุ grant; วันแถมไม่ถูกคิดเงินตอน upgrade (§3.4)
  - `CHANGE_COLLECTION` (`collectionAction: PAUSE | RESUME`, `resumesAt?`) — พัก/เปิดการเก็บเงินของ subscription (Stripe `pause_collection`); ระหว่างพักร้านซื้อ/เปลี่ยน/ยกเลิกไม่ได้ (`BILLING_COLLECTION_REVIEW`)
- **หน้าจอแสดง:** ก่อน/หลัง, จำนวนสาขา/ผู้ใช้ ACTIVE, สิ่งที่ไม่เปลี่ยน (ใบเสร็จคงเหลือ, วันสิ้น term, วันเก็บเงินถัดไป, OCR, งบ AI และยอด hold)
- **สิทธิ์:** อ่าน/สั่งผ่าน route ที่ต้อง `financial.read`; บริการตรวจ `override.manage` (override/วันแถม) หรือ `collection.manage` (พักเก็บเงิน); อนุมัติตาม §6.3
- **ข้อผิดพลาด:** `CONTROL_PREVIEW_STALE`, `CONTROL_IDEMPOTENCY_CONFLICT`, `CONTROL_FREE_DAYS_REVIEW`; issue `ADMIN_ADJUSTMENT`
- **API:** `GET companies/:id/plan-adjustments`, `POST …/plan-adjustments/preview`, `GET plan-adjustments/:id`, `POST plan-adjustments/:id/:action` (`submit|approve|cancel`)
- **หน้าจอ:** `/system/billing/companies/[id]/plan-adjustments`, `/plan-adjustments/[id]`
- **ทดสอบ:** `application/billing-free-days.spec.ts`, `system-partner-management/domain/logic/plan-capacity.spec.ts`

### FR-BILL-065 แถม/ถอนใบเสร็จ (receipt adjustments)

- **คำอธิบาย:** `GRANT_RECEIPTS` (`units`, `expiresAt` ≤ `maxGrantExpiresAt`) สร้างล็อตของผู้ดูแล; `REVOKE_RECEIPTS` (`grantId`) ถอนส่วนที่ยังไม่ใช้; แสดง `readWarnings` เมื่อการอ่านรูปจะยังไม่ได้แม้มีใบเสร็จ: `OCR_DISABLED`, `OCR_LIMIT_REACHED`, `AI_BUDGET_REACHED`, `AI_OCR_BUDGET_REACHED`, `AI_CREDIT_HOLDS_PENDING`
- **สิทธิ์:** preview `override.manage`; อ่าน/คำสั่ง `financial.read`; อนุมัติตาม §6.3
- **API:** `GET companies/:id/receipt-adjustments`, `POST …/receipt-adjustments/preview`, `GET receipt-adjustments/:id`, `POST receipt-adjustments/:id/:action`
- **หน้าจอ:** `/system/billing/companies/[id]/receipt-adjustments`, `/receipt-adjustments/[id]`

### FR-BILL-066 แถม/ถอน add-on (credit grants)

- **คำอธิบาย:** ผู้ดูแลเพิ่มหน่วย add-on ให้ร้าน (`ADDON_ADMIN_GRANT`: `productKind`, `units`) หรือถอนส่วนที่ไม่ใช้ของล็อตทีม (`ADDON_ADMIN_REVOKE`: `grantId`); ไม่มีช่องวันหมดอายุ — ล็อตหมดอายุ 12 เดือนนับจากอนุมัติ; ถอนได้เฉพาะล็อตที่ทีมให้ (`ADD_ON_ADMIN`) ไม่ใช่ล็อตที่ซื้อหรือจากงาน
- **มุมมอง:** `BillingAddOnCredits.images` (`packageRemaining`, `additionalRemaining`, รายการล็อต: source `ADD_ON_PAID | ADD_ON_ADMIN | SALES_EVENT`, units/reserved/consumed/revoked/remaining, สถานะ `ACTIVE | PENDING | EXPIRED | REVOKED`)
- **ข้อสังเกตจากโค้ด:** view ของล็อตในบริการนี้สร้าง `productKind: 'RECEIPT_IMAGE'` (`billing-addon-admin-grants.service.ts:64`); เครดิตแชต AI อยู่ในบัญชีแยก (`AiCreditGrant`/`AiCreditEntry`, `line-ai/application/ai-credit-ledger.ts`)
- **สิทธิ์/API:** preview `override.manage`; `GET companies/:id/credits`, `POST companies/:id/credit-grants/preview`, `GET credit-grants/:id`, `POST credit-grants/:id/:action`
- **หน้าจอ:** แท็บเครดิตในหน้า `/system/billing/companies/[id]`
- **ทดสอบ:** `application/billing-addon-admin-grants.spec.ts`, `domain/billing-policy-addon.spec.ts`

### FR-BILL-067 เครื่องมือเอกสาร: เปิดเอกสาร, เปลี่ยนผู้รับแทนร้าน, ส่งซ้ำ

- **เปิดเอกสาร:** `POST companies/:id/documents/:invoiceId/open` (`document.read`) คืน URL Stripe; **เปลี่ยนผู้รับ:** `recipient-review` → `recipient-preview` (`newEmail`, `reason`, `sourceHash`, `supportRequestId?`; `override.manage`) → `submit` → `approve` → `run`/worker (operation `UPDATE_BILLING_EMAIL` แหล่ง `ADMIN`; ร้านได้รับแจ้ง `billing.recipient.changed`); **ส่งซ้ำ:** `POST companies/:id/invoices/:invoiceId/resend` (`override.manage`, ต้องมี `reason`) ทำทันที
- **API เพิ่ม:** `GET companies/:id/invoices/:invoiceId/recipient-requests`, `GET recipient-changes/:id`, `POST recipient-changes/:id/:action`
- **หน้าจอ:** `/system/billing/companies/[id]/invoices/[invoiceId]/recipient`, `/recipient-changes/[id]`
- **ทดสอบ:** `application/billing-document-admin.service.spec.ts`, `e2e/billing-admin-document-tools.spec.ts`

### FR-BILL-068 ค้นด้วยเลขอ้างอิง

- **คำอธิบาย:** `GET lookup?reference=` รับเลขอ้างอิงที่ลูกค้าอ่านให้ (8 ตัวแรก/เต็ม) คืน `{kind: INVOICE | ATTEMPT | OPERATION | ISSUE | EVENT_TICKET, id, companyId, companyName, href}`; `EVENT_TICKET` = serial 8 ตัวของตั๋วส่วนลด
- **สิทธิ์:** `system.billing.read` — **ทดสอบ:** `application/billing-admin-lookup.spec.ts`

### FR-BILL-069 แคมเปญโปรโมชัน (ผู้ดูแล)

- **คำอธิบาย:** สร้าง/แก้ร่างแคมเปญ (`internalName`, `description`, `displayName`, `rules`, `startsAt`, `endsAt`, `cap | null`), ดูตัวอย่างต่อ rule (ราคา ภาษี เดือนรวม ใบเสร็จรวม ตัวอย่าง `paidEnd`/`benefitEnd`, ยอดต่ออายุ, `blockers` เช่น `CONTROL_PROMOTION_CATALOG_STALE`), เผยแพร่, พัก, เปิดต่อ, จบ, และรายงาน
- **สถานะแคมเปญ:** `DRAFT | AWAITING_APPROVAL | SCHEDULED | ACTIVE | PAUSED | ENDED | CATALOG_STALE`
- **ขั้นตอน:** `promotion-campaign-drafts` (สร้าง/บันทึกร่าง; operation `PROMOTION_CAMPAIGN_DRAFT`) → `promotion-campaigns/:id/preview` (`action: PUBLISH | RESUME`) สร้าง configuration change ธรรมดา → `configuration-changes/:id/{submit|approve|cancel}` → เผยแพร่เป็น `BillingPolicyRevision` ใหม่ที่ policy ฐานเดิม + `promotionJson`; `pause` / `end` เป็นคำสั่งขั้นเดียว (reauth + Idempotency-Key)
- **กฎ:** Release 1 เผยแพร่ได้เฉพาะ rule ตามเทมเพลต STARTER; `offerSignature` ตรึง (tier, รอบ, ราคา, ภาษี, ใบเสร็จฐาน) — catalog เปลี่ยน = `CATALOG_STALE`; `usage.taken = reserved + consumed` (คืนเงินไม่ลด); พัก/จบไม่ยึดสิทธิ์ที่จองกับ Checkout ที่เปิดอยู่; รายงาน: reserved, paidAwaitingApply, applied, releasedBeforePay, refunded, fullyRefunded, rightsActive, เดือน/ใบเสร็จที่แถม, เงินรับ/คืน (ต้อง `financial.read`), รายร้าน
- **สิทธิ์:** อ่าน `read`; ทุกคำสั่ง `policy.manage` (ตรวจในบริการ)
- **API:** `GET promotion-campaigns`, `GET promotion-campaigns/:campaignId`, `GET …/report`, `POST promotion-campaign-drafts`, `POST promotion-campaign-drafts/:campaignId/discard`, `POST promotion-campaigns/:campaignId/preview`, `POST …/pause`, `POST …/end`
- **หน้าจอ:** `/system/billing/campaigns`, `/campaigns/new`, `/campaigns/[campaignId]`
- **ทดสอบ:** `domain/billing-promotion.spec.ts`, `e2e/billing-promotion.spec.ts`

### FR-BILL-070 สถานะของการขาย add-on ผ่าน Stripe

- **สิ่งที่มีในโค้ด:** ราคา/ปริมาณ (`BILLING_ADDON_OFFERS`), ช่อง policy `addOnPriceIds` (ตรวจรูปแบบและไม่ซ้ำ), คอลัมน์ `productKind` ใน `BillingAttempt`/`BillingInvoice`, ช่อง `BillingAccount.activeAddOnAttemptId`, ชนิดข้อมูล `BillingAddOnQuote`/`BillingAddOnSummary`, ล็อตแหล่ง `ADD_ON_PAID`, การแถมโดยผู้ดูแล (FR-BILL-066)
- **สิ่งที่ไม่มี:** ไม่พบ endpoint ขอ quote/checkout ของ add-on ใน `BillingController`; reconciler ปฏิเสธ attempt ที่ไม่ใช่ `PACKAGE` ด้วย `billing.addon_reconcile_unsupported`; `BillingStatus.addOns` มีคำอธิบาย "no server fills it yet" — สรุป: **ลูกค้ายังซื้อ add-on ผ่าน Stripe เองไม่ได้ ณ commit นี้** (ดูหัวข้อ 20)

---

## 10. ข้อกำหนดฟังก์ชัน — การบังคับใช้แพ็กเกจ

โค้ดหลัก: `apps/api/src/modules/system-partner-management/` (`domain/logic/plan-term.logic.ts`, `plan-capacity.ts`, `receipt-quota.logic.ts`, `application/plan-term-limit.ts`, `free-expense-access.ts`, `use-cases/company-plan-term.use-cases.ts`, `plan-term-sweep.use-case.ts`, `package-change-decision.use-case.ts`), `packages/contracts/src/plan-term.ts`

### FR-BILL-080 อายุแพ็กเกจ (plan term) และการล็อกร้าน

- **คำอธิบาย:** ทุกร้านมีได้หนึ่งแถว `CompanyPlanTerm` (tier, เพดาน, `termStartAt`, `termEndsAt`, `warningDays`, `renewCount`, `termDisabledAt`); สถานะตาม §4.2
- **กฎธุรกิจ:** ร้านที่ไม่มีแถว term = รุ่นเก่า ไม่จำกัด (fail open ทุก gate); หมดอายุทันทีที่ `now ≥ termEndsAt` (การตรวจตอนเข้าใช้และ sweep ใช้ฟังก์ชันเดียวกัน `isExpired`); ร้านที่หมดถูก sweep ตั้ง `Company.status = DISABLED` + `termDisabledAt` (ต่างจาก admin hold ซึ่งไม่ตั้ง `termDisabledAt`); `lockReason`: `no_package` (ไม่เคยมีแพ็ก: `termEndsAt ≤ termStartAt` และ `renewCount = 0`) หรือ `trial_ended`; ร้านที่ถูกล็อกเพราะ term ยังเข้าเส้นทาง billing recovery ได้ (หน้าแพ็กเกจ, return, ใบแจ้งหนี้, `event-discount`) เพื่อซื้อและกลับมาใช้งาน; ป้ายไทย: `พักการใช้งาน`, `ยังไม่มีแพ็กเกจ`, `หมดอายุ`, `กำลังทดลองใช้`, `ใช้งานได้`
- **ผู้ใช้:** ทุกผู้ใช้ของร้านเห็น notice (`PlanTermNoticeDto`: `derivedState`, `daysLeft`, `isOwner`, `canManagePlan`, `lockReason`, `freeExpenseDrafts`)
- **แพ็ก:** ทุกแพ็ก
- **ข้อมูล:** `CompanyPlanTerm`, `Company.status`
- **ทดสอบ:** `domain/logic/plan-term.logic.spec.ts`, `e2e/plan-term-billing-readiness.spec.ts`

### FR-BILL-081 ผู้ดูแลตั้ง/ต่ออายุ plan term ด้วยมือ

- **คำอธิบาย:** ผู้ดูแลกำหนด tier, เพดานสาขา/พนักงาน/ใบเสร็จต่อเดือน, จำนวนวัน (`termDays`, ตั้งต้น 30), `warningDays` (ตั้งต้น 7) และต่ออายุ (`days` ตั้งต้น 30 นับจาก `max(now, termEndsAt)`); วันคิดเป็น 24 ชม. เต็ม ไม่ใช่เดือนปฏิทิน (`addDays`); จบ warm-up ก่อนกำหนดได้
- **Input ร่วม:** `commandId`, `expectedVersion`, `reason` (`PlanTermAdjustmentBody`) — idempotent (`replayed`) และมีประวัติ (`plan-term/history`: `kind SET | RENEW`, `source SYSTEM_PARTNER_ADMIN | LINE_PACKAGE_REQUEST | LEGACY_ADMIN`, การเปลี่ยนรายฟิลด์)
- **กฎ:** ร้านที่ผู้ดูแลตั้งเอง = `purchaseSource ADMIN_MANUAL`; ค่าตั้งต้นของร้านที่ผู้ดูแลสร้างผ่าน onboarding = `STARTER_249` (`ONBOARDING_DEFAULT_TIER`); `termStartAt` ใช้เฉพาะตอนสร้างแถวแรก
- **สิทธิ์:** อ่าน `system.partner_dashboard.read`; เขียน `system.partner_company.update`
- **API:** `GET system/partners/:id/plan-term`, `GET …/plan-term/history`, `PUT …/plan-term`, `POST …/plan-term/renew`, `POST …/plan-term/end-warmup`
- **หน้าจอ:** `/system/partners/[companyId]` (แท็บแพ็กเกจ)
- **ทดสอบ:** `use-cases/company-plan-term.use-cases.spec.ts`, `e2e/system-admin.spec.ts`

### FR-BILL-082 Sweep วันหมดอายุและบันไดเตือน

- **คำอธิบาย:** `PlanTermSweepUseCase` (เรียกโดย worker) ปิดร้านที่ term หมดและส่งคำเตือนล่วงหน้า
- **กฎ:** บันไดเตือน 7, 3, 1 วัน (`WARNING_LADDER_DAYS`) ถึง **เจ้าของร้านเท่านั้น** ครั้งเดียวต่อจุดต่อ term (คอลัมน์ `warn7SentAt`, `warn3SentAt`, `warn1SentAt`); ยิงเฉพาะจุดที่ลึกที่สุดที่เข้าแล้ว (sweep หยุดไป 4 วันจะแจ้ง "เหลือ 3 วัน" ครั้งเดียว); แจ้งหมดอายุครั้งเดียว (`expiredNotifiedAt`); ธงทั้งหมดถูกล้างเมื่อ apply การจ่ายเงินใหม่; ช่องทางติดต่อในข้อความ: โทร `098-256-5628`, `contact@mangmeeplus.com` (ค่าคงที่ในโค้ด)
- **ทดสอบ:** `use-cases/plan-term-sweep.use-case.spec.ts`

### FR-BILL-083 เพดานสาขาและพนักงาน

- **คำอธิบาย:** `assertBranchLimit` / `assertEmployeeLimit` ถูกเรียกตอนสร้างสาขาและเพิ่มสมาชิก
- **กฎ:** นับสาขา `ACTIVE` และ membership `ACTIVE` ที่ไม่ใช่ `SYSTEM_ADMIN` (`planCapacityUsed`); `active ≥ limit` → 422 `plan_branch_limit_exceeded` (พร้อม `details.limit`, `details.active`) หรือข้อความเพดานพนักงาน; ไม่มีแถว term = ไม่จำกัด; ลดเพดานไม่กระทบของเดิม — เพียงเพิ่มใหม่ไม่ได้; เพดานที่ใช้จริง = override ชั่วคราวที่ยังไม่หมด (FR-BILL-064) มิฉะนั้นค่าใน term (`effectivePlanCapacity`)
- **ค่าตามแพ็ก:** ตาราง §2.1 (หรือ `offerTerms`/ดีล/override)
- **ทดสอบ:** `domain/logic/plan-capacity.spec.ts`, `application/billing-capacity.spec.ts`

### FR-BILL-084 โควตาอ่านรูปใบเสร็จ

- **คำอธิบาย:** เพดานการอ่านรูปด้วย AI (นับทุกรูปที่ผู้ช่วยอ่าน ไม่เฉพาะใบเสร็จ) บังคับที่ `admitCompanyOcr`
- **กฎ:** `effectiveMonthlySlipLimit`: ทดลอง = `monthlySlipLimit` ทันที; tier อื่น = `min(monthlySlipLimit, warmupSlipLimit)` ระหว่าง `now < warmupUntil` แล้วเป็น `monthlySlipLimit`; ไม่มี term = ไม่จำกัด; ร้านที่จ่ายเงินผ่าน Stripe ใช้ระบบล็อต (`PAID_GRANTS`, FR-BILL-041) แทนเพดานรายเดือน; ข้อความเมื่อชนโควตาเลือกตามแพ็ก/สิทธิ์ผู้อ่าน (ผู้ที่ซื้อได้ถูกชี้ไปซื้อ คนอื่นถูกบอกให้แจ้งเจ้าของ); แจ้งเตือนโควตาครั้งเดียวต่อเดือน (`quotaNoticeSentMonthKey`); tier ทดลองมีบรรทัดนับจำนวนต่อท้ายคำตอบสำเร็จ
- **ทดสอบ:** `domain/logic/receipt-quota.logic.spec.ts`

### FR-BILL-085 การทดลองใช้ฟรี และการปิดทดลองสำหรับผู้สมัครใหม่

- **คำอธิบาย:** `FREE_TRIAL_15` (15 รูป/เดือน, 1 สาขา, 2 ผู้ใช้) ยังเป็น tier ที่ผู้ดูแลมอบได้; `SIGNUP_TRIAL_TIER_KEY = 'FREE_TRIAL_15'` คงไว้ใน contract
- **พฤติกรรมจริง:** แค็ตตาล็อกไม่ประกาศ trial แล้ว และร้านที่สมัครใหม่ถูกสร้างในสถานะ "ยังไม่มีแพ็กเกจ" (`no_package`) ต้องซื้อหรือรับดีล/ลิงก์จากทีมขายก่อนใช้งาน (ตามหมายเหตุ Owner 2026-09-20 ในโค้ด `billing.service.ts:272`, `plan-term.ts:10`); `BillingPolicy.paidStart = 'AFTER_TRIAL'` มีใน type แต่ quote ปฏิเสธทุกค่าที่ไม่ใช่ `IMMEDIATE`
- **ทดสอบ:** `e2e/line-signup-contact-email.spec.ts`, `e2e/plan-term-billing-readiness.spec.ts`

### FR-BILL-086 สิทธิ์ใช้ฟรีหลังทดลองหมด (free expense drafts)

- **คำอธิบาย:** ร้านทดลองที่หมดอายุและไม่เคยซื้อ ยังบันทึก "ร่างค่าใช้จ่าย" ได้ในวงจำกัด (cadence `FREE_MONTHLY_3` — ค่า 3 ครั้ง/เดือนปรากฏในชื่อ cadence; ตัวนับอยู่ใน `line-ai/application/company-ocr-governance.ts` นอกขอบเขตเอกสารนี้)
- **เงื่อนไข (`isFreeExpenseDraftCompany`):** term เป็น `FREE_TRIAL_15`, หมดแล้ว, ไม่มี `billingReceiptAccountId`, ไม่มี `capacityOverride`, บริษัทไม่ถูกเก็บถาวร; ถ้า `DISABLED` ต้องเป็นการปิดโดยระบบด้วยเหตุ `no_package`/`term_expired` (ตรวจจาก audit ล่าสุด); ไม่มีร่องรอยการจ่ายเงินในทุก billing account
- **ขอบเขต:** เฉพาะ route ใน `isFreeExpenseDraftRoute` (อ่านสาขา/หมวด/identity/ที่อยู่, อัปโหลดและแก้ร่างค่าใช้จ่าย, capture groups, ดาวน์โหลดไฟล์แนบ) และ permission ถูก "ตัดให้เหลือ" เฉพาะร่าง (`freeExpenseDraftPermissions`) — ไม่มี review/confirm/สร้างธุรกรรมอื่น; ห้าม `shared-evidence` และ `accountant-package`; ไฟล์หลายเอกสารถูกขอให้แยกส่ง
- **ทดสอบ:** `application/free-expense-access.spec.ts`, `.pg.spec.ts`

### FR-BILL-087 คำขอเปลี่ยนแพ็กเกจจากลูกค้า (LINE)

- **คำอธิบาย:** ลูกค้ากด "ขอเปลี่ยนแพ็กเกจ" ใน LINE → แถว `PackageChangeRequest` kind `CUSTOMER_REQUEST` (ไม่ระบุ tier; `nextPlanTierKey()` เสนอขั้นถัดไปเป็นจุดเริ่มคุย); ผู้ดูแลเห็นคิวและตัดสิน
- **กฎ:** เมื่อร้านจ่ายผ่าน Stripe แล้ว คำขอที่จ่ายแล้วถูกปิด (`fulfillPaidPackageRequest`) และคำขอที่ยังไม่จ่ายอื่นถูก supersede (`supersedeUnpaidPackageRequest`) ใน transaction ของ apply
- **สิทธิ์/API:** `system.partner_company.update`; `GET system/package-change-requests`, `POST system/package-change-requests/:id/decision`
- **ทดสอบ:** `use-cases/package-change-decision.use-case.spec.ts`

---

## 11. ข้อกำหนดฟังก์ชัน — Sales Console

โค้ด: `apps/api/src/modules/sales-console/**`, `packages/contracts/src/sales.ts`, เว็บ `/sales/**` (`apps/web/features/sales-console/**`) ผู้ใช้คือทีมขายของมั่งมีเอง (role แพลตฟอร์ม `MANGMEE_SALES`, `MANGMEE_SALES_LEAD`, และ `SYSTEM_ADMIN`) — ไม่ใช่ role `SALES` ของร้านลูกค้า ไม่เห็นข้อมูลธุรกิจ/การเงินของร้าน; แพ็ก: ไม่ผูกกับแพ็ก (ดีลตั้งบนฐาน `STARTER_249 | BASIC_499 | PRO_999 | ENTERPRISE_1999`)

### FR-BILL-090 เข้าคอนโซลขายและงานของฉัน

- **API:** `GET /v1/sales/my-work`, `GET /v1/sales/deals`, `GET /v1/sales/me/profile`, `PATCH /v1/sales/me/profile` (`sales.console.read`) — เซลล์เห็นเฉพาะดีลของตน; lead/admin เห็นทั้งหมด (`canSeeAllDeals`)
- **หน้าจอ:** `/sales`, `/sales/my-work`, `/sales/deals`, `/sales/profile`

### FR-BILL-091 ค้นหาร้าน

- **กฎ:** คำค้น ≥ 2 ตัวอักษร คืน ≤ 20 รายการ ฟิลด์จำกัด: ชื่อ, `accessState` (`NO_PACKAGE | TRIAL | ACTIVE | EXPIRED` — ไม่เห็น admin hold), tier, จังหวัด, วันสร้าง, ดีลที่เปิดอยู่, จำนวนสาขา/พนักงาน, ราคา catalog ต่อเดือนของ tier ปัจจุบัน; ทุกการค้นถูก audit (`sales.company.searched`)
- **สิทธิ์/API:** `sales.company.search`; `GET /v1/sales/companies` — **หน้าจอ:** `/sales/companies`

### FR-BILL-092 สร้าง/แก้/ส่งดีล

- **ข้อมูลดีล (`SalesDealSnapshot`, `buildDealSnapshot`):** `base`; `priceSatang` ≥ 1 ไม่มีเพดาน (สูงกว่า catalog = คำเตือนในฟอร์ม ไม่ปฏิเสธ; ตัวเลขคือยอดที่ลูกค้าจ่ายทั้งหมด); `months` 1–36; `branchLimit`, `employeeLimit` 1–10,000; `monthlySlipLimit` 1–1,000,000; `featureKeys` (ต้องอยู่ใน `SALES_DEAL_ALLOWED_FEATURE_KEYS`); `aiMonthlyBudgetSatang` null หรือ ≥ 1 (0 ไม่ได้ — ปิด AI ทำโดยเอาเมนู `ai_line_assistant` ออก); `description` 1–200 ตัว ห้ามมี `+`; `internalReason` ≤ 500; ดีลต่ออายุ: `autoRenew`, `cadence` month/year, `cycles` 1–36 หรือ null (จนกว่าจะจบดีล) — เมื่อ autoRenew `priceSatang` คือราคาต่อรอบและ `months` ไม่ถูกใช้; snapshot version 4 = ยอด AI หมายถึง chat credit (null = 50 เครดิต)
- **กฎ:** ร้านหนึ่งมีดีลที่ยังไม่จบได้ทีละหนึ่ง (`DRAFT | PENDING_APPROVAL | APPROVED`); แก้ได้เฉพาะ `DRAFT`/`REJECTED` (บันทึกดีลที่ถูกปฏิเสธ → กลับ `DRAFT`); `APPROVED` แก้ไม่ได้ ต้องยกเลิกแล้วออกใหม่; เตือน `overLimit` เมื่อร้านใช้อยู่เกินเพดานของดีล (ของเดิมคงอยู่ เพิ่มไม่ได้)
- **สิทธิ์/API:** `sales.deal.create`; `POST /v1/sales/deals`, `PUT /v1/sales/deals/:dealId`, `POST …/submit`, `POST …/cancel`, `GET /v1/sales/deals/:dealId` (`sales.console.read`)
- **หน้าจอ:** `/sales/deals/new`, `/sales/deals/[id]`
- **ข้อมูล:** `PackageChangeRequest` (kind `SALES_DEAL`, `offerSnapshotJson`, `version`)
- **ทดสอบ:** `domain/sales-deal.logic.spec.ts`, `e2e/sales-console.spec.ts`

### FR-BILL-093 อนุมัติ/ปฏิเสธ/จบดีล

- **กฎ:** อนุมัติ → `APPROVED`, `offerExpiresAt = approvedAt + 3 วัน` (`SALES_DEAL_OFFER_DAYS`); บันทึก `approvedByUserId` และ `selfApproved` (อนุมัติดีลของตัวเอง — อนุญาตและมองเห็นได้ เป็นกฎ "ผู้ดูแลคนเดียว" ฝั่งขาย); ปฏิเสธ/ยกเลิกต้องมีเหตุผล; เจ้าของร้านได้รับ LINE แจ้งว่ามีข้อเสนอ — ข้อความ **ไม่มีตัวเลขใด ๆ** ("มีข้อเสนอพิเศษสำหรับร้านคุณ เปิดหน้าแพ็กเกจเพื่อดูรายละเอียดค่ะ") พร้อมลิงก์หน้าแพ็กเกจของร้านนั้นเท่านั้น; ดีลต่ออายุ: ตอนอนุมัติสร้าง Stripe Price เฉพาะดีล (`SalesDealPriceService`; `priceState PENDING → READY | FAILED`); "จบดีล" (`end`) สำหรับดีลต่ออายุ ต้องมีเหตุผล → archive Price และคืนราคาปกติ
- **สิทธิ์/API:** `sales.deal.approve`; `POST /v1/sales/deals/:dealId/approve | reject | end`
- **Audit:** `sales.deal.created/submitted/approved/expired/superseded/applied/ended/renewal_created`, `sales.deal.price_ready/price_failed/price_archived/price_archive_failed`, `sales.deal.offer_notice_failed`

### FR-BILL-094 Sweep ของดีล

- **API ภายใน (worker token):** `POST /v1/internal/sales/deals/expire-sweep` (ดีล `APPROVED` ที่เลย `offerExpiresAt` → `EXPIRED`; อ่านค่าหมดอายุแบบ derived ทันทีแม้ sweep ยังไม่รัน; ข้ามดีลที่มี Checkout เปิดอยู่; retry Price ที่ `PENDING/FAILED`), `POST …/deals/renewal-sweep` (สร้างดีลต่ออายุ/เตือนก่อนหมด — `renewalOfRequestId`, `renewalRemindedAt`), `POST /v1/internal/sales/daily-digest` (สรุปรายวัน)
- **ทดสอบ:** `domain/sales-renewal.logic.spec.ts`

### FR-BILL-095 งานอีเวนต์: ชุดส่วนลด (batch)

- **ข้อมูล batch (`validateSalesEventBatch`):** `eventName`, `batchName` (1–`SALES_EVENT_NAME_MAX`); `discountSatang` บาทเต็ม **> 0** (`SALES_EVENT_REWARD_REQUIRED`; การให้เครดิตแทนส่วนลดถูกถอนไว้ — คอลัมน์ `rewardChatCreditUnits`/`rewardReceiptImageUnits` ยังอยู่); `issueCap` ≥ 1 และไม่ต่ำกว่าที่แจกแล้ว; `claimStartsAt < claimEndsAt` และปลายยังไม่ผ่าน (เมื่อแก้ปลาย); `scope` = tier × interval ที่ลดได้ (อย่างน้อยอย่างละหนึ่ง); `agentUserIds` ≥ 1
- **กฎราคา:** ทุก offer ใน scope ต้องเหลือ ≥ 10 บาทหลังลด (`firstOfferBelowMinimum` เทียบราคา catalog ปัจจุบันจาก `BillingService.catalog()`)
- **สถานะ:** §4.10; `SUSPEND` และ `LIFT` ต้องมีเหตุผล; `LIFT` ไม่เปิดรับใหม่เอง
- **สิทธิ์/API:** จัดการ `sales.event.manage` (เฉพาะ `SYSTEM_ADMIN` และ `MANGMEE_SALES_LEAD`); อ่าน `sales.console.read`; `POST/GET /v1/sales/events/batches`, `GET/PATCH …/batches/:batchId`, `POST …/batches/:batchId/state`, `GET /v1/sales/events/agents`
- **หน้าจอ:** `/sales/events`, `/sales/events/[batchId]`
- **ข้อมูล:** `SalesEventBatch`, `SalesEventBatchAgent`
- **ทดสอบ:** `domain/sales-event.logic.spec.ts`

### FR-BILL-096 QR และการรับตั๋วส่วนลด

- **QR:** เซลล์ผู้แจกขอ QR ของ batch (`POST …/batches/:batchId/qr`, `sales.console.read`); token สุ่ม 32 ไบต์ (base64url 43 ตัว) เก็บเฉพาะ hash; ลิงก์เปิด LIFF (`event-discount`) ใน LINE; QR ไม่มีอายุของตัวเอง — ใช้ได้ตราบที่ batch `OPEN` ในช่วง `[claimStartsAt, claimEndsAt)` และเซลล์ยังเป็นผู้แจกที่ active
- **Claim:** `POST /v1/public/event-discounts/claim` (public; ระบุตัวด้วยบัญชี LINE) → ถ้าถือตั๋วของ batch นี้อยู่แล้วคืนใบเดิม; มิฉะนั้นตรวจ (`salesEventClaimRefusal`) ภายใต้ lock ของ batch แล้วออกตั๋ว: serial 8 ตัว (ไม่มี 0/O/1/I), `expiresAt = claimEndsAt + 30 วัน`, คัดลอกส่วนลด/scope ณ revision ที่ออก; ตั๋วผูกกับบัญชี LINE ของผู้ถือ (`holderProviderUserId`) ไม่ผูกกับร้านจนกว่าจะใช้
- **Audit:** `sales.event.qr_issued`, `sales.event.ticket_claimed`
- **ข้อมูล:** `SalesEventQrToken`, `SalesEventTicket`
- **ทดสอบ:** `domain/sales-event-claim.logic.spec.ts`, `application/claim-event-discount.use-case.spec.ts`

### FR-BILL-097 รายการตั๋ว เพิกถอน และรายงานงาน

- **API:** `GET /v1/sales/events/batches/:batchId/tickets` (`sales.console.read`), `POST /v1/sales/events/tickets/:ticketId/revoke` (`sales.event.manage`; เฉพาะตั๋วที่ยังไม่ใช้; บันทึก `revokedByUserId`, `revokeReason`), `GET /v1/sales/events/report` (`sales.report.read`)
- **ตัวเลข (`ticketCounts`):** issued, available (ISSUED ที่ยังไม่หมดอายุ), inPayment (RESERVED), used, revoked, expired
- **ทดสอบ:** `domain/sales-event-report.logic.spec.ts`

### FR-BILL-098 ทีมขายและโปรไฟล์เซลล์

- **Lead:** `GET/POST /v1/sales/team`, `GET /v1/sales/team/:userId/profile`, `POST /v1/sales/team/:userId/credential` (`sales.team.manage`) — สร้างเซลล์, ออก/รีเซ็ตรหัสผ่าน, อ่านโปรไฟล์ภาษี/ธนาคารของทีมตัวเอง
- **Admin:** `GET/POST /v1/system/sales-agents`, `PATCH …/:userId`, `GET …/:userId/profile`, `POST …/:userId/credential`, `GET …/export.csv`, `GET …/address-master` (`sales.agent_profile.manage`)
- **ข้อมูล (`SalesAgentProfile`):** `salesCode` (รหัสอ่านออกเสียงได้ ไม่มี 0/O/1/I เก็บตัวพิมพ์ใหญ่), `teamLeadUserId`, ชื่อตามกฎหมาย, เลขบัตร/เลขภาษี/เลขบัญชี (**เข้ารหัส** — คอลัมน์ `*Encrypted`), ธนาคาร, `whtRatePercent`, สถานะ/ระงับ
- **Audit:** `sales.agent.created/updated/suspended/credential_issued/profile_viewed/profile_exported`
- **หน้าจอ:** `/sales/team`, `/system/sales-team`

### FR-BILL-099 การนับยอดขาย (attribution), ธงตรวจสอบ และรายงาน

- **กฎนับ (`sales-attribution.logic.ts`):** ดีลที่ apply → เครดิตของเซลล์เจ้าของดีล (`source` ดีล); การซื้อ catalog ครั้งแรกนับให้เซลล์ที่แนะนำเมื่อจ่ายภายใน **14 วัน** นับจากร้านเปิด (รวมวันที่ 14); ใบต่ออายุ/upgrade ไม่นับ; การคืนเงินหรือ dispute ที่แพ้ภายใน **60 วัน** จากวันจ่าย (เวลาของ provider) หักเครดิตในเดือนที่บันทึก — หนึ่ง provider id หักครั้งเดียว ไม่หักเกินเครดิตคงเหลือ
- **ธง:** `self_referral`, `repeat_owner`, `referral_anomaly` — แถวที่มีธงนับ 0 จนกว่า Admin ตรวจ (`flagReviewedAt`); "ตัดออกจากยอด" คงธงไว้
- **API:** `PATCH /v1/system/partners/:id/referral`, `GET /v1/system/sales-attribution/flags`, `POST /v1/system/sales-attribution/:partnerCompanyId/review` (`sales.agent_profile.manage`); รายงาน `GET /v1/sales/reports/summary` (`sales.report.read`; ช่วงวันที่ `from`/`to`, จัดกลุ่มรายเดือนเวลาไทย: `dealActivations`, `referralActivations`, `amountSatang`, `flaggedCount`, รายการรอตรวจ)
- **ข้อมูล:** `SalesAttribution`, `SalesAttributionDeduction` — **หน้าจอ:** `/sales/reports`
- **Audit:** `sales.referral.changed`, `sales.attribution.flag_reviewed`
- **ทดสอบ:** `domain/sales-attribution.logic.spec.ts`

---

## 12. ข้อกำหนดฟังก์ชัน — Sales Demo

โค้ด: `apps/api/src/modules/sales-demo/**`; เว็บ `/d/[token]`, `/d/expired`, `/sales/demo-links`, `/system/demo-links`

### FR-BILL-110 สร้างลิงก์เดโม

- **กฎ:** อายุ 3 วัน (`DEMO_LINK_TTL_MS`); `aiCredit` 1–300 (ตั้งต้น 50); เก็บเฉพาะ `tokenHash`; URL `{webBaseUrl}/d/{rawToken}`; audit `sales.demo_link.create`
- **สิทธิ์/API:** `sales.demo_link.create`; `POST /v1/sales/demo-links` → `{url, expiresAt, aiCredit}`

### FR-BILL-111 เปิดลิงก์เดโม

- **ขั้นตอน:** `POST /v1/auth/demo/open` (public, rate-limited → `demo_rate_limited`) → lock ต่อ link → ถ้ายังไม่มีร้าน สร้างร้านตัวอย่าง (`reportClassification = DEMO`, แพ็ก `ENTERPRISE_1999` หมดอายุพร้อมลิงก์), ข้อมูลตัวอย่าง (ค่าใช้จ่าย, เบิกจ่าย, หัก ณ ที่จ่าย), ตั้ง `ocrMonthlyLimit = readLimit` (1–50), มอบเครดิต AI `aiCreditUnits × 100` หน่วย (source `sales-demo:{linkId}`) → ออก session ของ owner เดโมที่หมดอายุพร้อมลิงก์ (ลูกค้าเดโมไม่ต้องล็อกอิน LINE); ลิงก์หมด/ถูกปิด → 410 `demo_link_expired`
- **กฎ:** ทุกอย่างอยู่ใน transaction เดียว (ล้มเหลว = ไม่เหลือร้านครึ่ง ๆ กลาง ๆ); ผู้เปิดคนถัดไปเข้าร้านเดิม
- **ทดสอบ:** `application/sales-demo.service.spec.ts`, `presentation/sales-demo.controller.spec.ts`, `sales-demo-credit.spec.ts`, `demo-sample-data.spec.ts`, `.pg.spec.ts`

### FR-BILL-112 จัดการลิงก์เดโม

- **API:** `GET /v1/sales/demo-links` (สถานะ `WAITING | OPENED | EXPIRED`; เซลล์เห็นของตน, lead/admin เห็นทั้งหมด), `PATCH /:id` (แก้ `aiCredit` 1–300, `readLimit` 1–50, `expiresAt` ระหว่าง 10 นาทีถึง 30 วันจากตอนนี้; ลิงก์หมดแล้วแก้ไม่ได้), `POST /:id/reset` (ล้างร้านตัวอย่าง ลิงก์ยังใช้ได้ ผู้เปิดคนถัดไปได้ร้านใหม่เครดิตเต็ม), `DELETE /:id` (ปิดลิงก์และลบร้าน; แถวคงเป็นประวัติ ซ่อนจากรายการ)
- **กฎเครดิต:** เครดิตของลิงก์คือ "ยอดรวมของร้าน" — แก้แล้วระบบถอนล็อตที่เหลือและมอบใหม่ = `max(0, total × 100 − ใช้แล้ว − ที่ hold อยู่)`
- **Audit:** `sales.demo_link.update/reset/delete` — **หน้าจอ:** `/sales/demo-links`, `/system/demo-links`

### FR-BILL-113 แชต AI ในหน้าเดโม

- **คำอธิบาย:** ร้านเดโมใช้ LINE AI จริงผ่าน pop-up ในเว็บ (ไม่ผ่าน LINE): `POST /v1/companies/:companyId/demo-chat/messages` (ข้อความ 1–1,000 ตัวอักษร), `POST …/files` (รูป/PDF ≤ 10 MB: jpeg, png, webp, heic, pdf — ชนิดอื่นแปลงเป็น JPG/PNG ตอนรับ), `GET …/messages`
- **เงื่อนไข:** session เดโมของร้านนั้น role `OWNER`; ลิงก์ยังไม่หมด/ไม่ถูกปิด; ชนเพดานอ่านเอกสาร → 403 `demo_read_limit_reached`
- **ข้อมูล:** `DemoChatMessage` — **ทดสอบ:** `application/demo-chat.spec.ts`

### FR-BILL-114 ข้อจำกัดของร้านเดโมและการล้างข้อมูล

- **ข้อจำกัด (`demo-company-access.ts`):** ร้านเดโมถูกห้ามการกระทำที่มีค่าใช้จ่ายจริงหรือส่งออกนอกระบบ (`demo_action_unavailable`) รวมถึง Checkout ของ billing (`assertNotDemoCompany`), การส่งอีเมล/ข้อความจริง; การอ่านและแก้ข้อมูลตัวอย่างยังทำได้
- **Purge:** ร้านเดโมที่หมดอายุถูกลบ (ไฟล์ก่อน แล้วแถว; log แชต/คิว event/ผู้ใช้เดโมที่ไม่ได้อยู่ร้านอื่น) — แถว `SalesDemoLink` คงไว้เป็นประวัติการขาย; `force` สำหรับ reset/delete ก่อนหมดอายุ
- **ทดสอบ:** `application/demo-company-access.spec.ts`

---

## 13. ข้อกำหนดฟังก์ชัน — System Console (นอก billing)

**ข้อกำหนดร่วม:** `apps/web/app/system/layout.tsx` ตรวจ session ฝั่ง server ทุกครั้ง (`force-dynamic`): ไม่ล็อกอิน → `/login?next=…`; แพลตฟอร์มปิด → `/maintenance`; ไม่ใช่ `SYSTEM_ADMIN` และไม่มีสิทธิ์เปิดส่วน billing (`canOpenSystemBilling`) หรือส่วนผู้บริหาร (`canOpenSystemExecutive`) สำหรับ path นั้น → หน้า `SystemAccessDenied`; ต้องเปลี่ยนรหัสผ่าน → `/change-password`; ยังไม่ยอมรับเงื่อนไข → หน้ายอมรับ; แถบหัวแสดงสภาพแวดล้อม ("ระบบทดสอบ UAT" / "ระบบจริง" / "ทดสอบในเครื่อง"); เมนูซ้าย `SystemHeader` แสดงรายการตามสิทธิ์ การบังคับสิทธิ์จริงอยู่ที่ API (`@RequirePermissions`) แพ็ก: ไม่ผูกกับแพ็ก รายละเอียดเชิงลึกของบางโมดูล (ผู้บริหาร, data rights, สมัคร/onboarding, LINE, อีเมล) อยู่ใน SRS ของโมดูลนั้น — ที่นี่ระบุขอบเขตหน้าจอ, API และสิทธิ์ให้ครบ

### FR-BILL-120 รายการร้านและรายละเอียดร้าน (partners)

- **คำอธิบาย:** `/system/partners` รายการร้านทั้งหมด + ค้นผู้ใช้ (รวมหน้า `/system/users` เดิมซึ่ง redirect มาที่นี่); `/system/partners/[companyId]` รายละเอียด: profile, identity ภาษี, สถานะ lifecycle, plan term + ประวัติ, สมาชิก, เมนูที่เปิด, รุ่น AI/OCR, การใช้ AI และ credit holds, timeline, team note, ส่ง LINE ถึงร้าน, เซลล์ผู้แนะนำ
- **API (`system/partners`):** `GET /` , `GET /:id`, `PATCH /:id`, `POST /:id/lifecycle`, `GET/PATCH /:id/identity`, `GET /address-master`, `GET/PUT /:id/team-note`, `GET /:id/members`, `POST /:id/members/:uid/line-unlink | line-link-token | password/reset | password/reveal`, `PATCH /:id/members/:uid/contact | display-name`, `PUT /:id/features | ai-model | ocr-config | manual-expense-web-entry | disbursement-voucher-web-entry | vat-registration`, `GET /:id/ai-usage | ai-credit-holds | ai-adjustments`, `POST /:id/ai-credit-holds/:rid/release | charge-at-bound | acknowledge-breach`, plan term (FR-BILL-081), `GET /:id/timeline`, `POST /:id/line-message`; `GET system/users/lookup`
- **สิทธิ์:** ตาม §6.2 (`system.partner_*`, `system.identity_reconciliation.resolve`, `system.company_onboarding.read`)
- **กฎเด่น:** lifecycle (`ACTIVE`/`DISABLED`/`ARCHIVED`) ผ่าน `PartnerLifecycleTransitionUseCase` เดียวกับที่ billing ใช้เปิดร้านกลับ; การเปิดดูรหัสชั่วคราว/รีเซ็ตรหัสถูก audit ระดับ CRITICAL; การแก้ identity/profile enqueue `CUSTOMER_PROFILE_SYNC` (FR-BILL-009)
- **ทดสอบ:** `e2e/system-admin.spec.ts`, spec ใน `system-partner-management/application/use-cases/*.spec.ts`

### FR-BILL-121 คำขอสมัครและการสร้างบริษัท (signup requests, company onboardings)

- **หน้าจอ:** `/system/signup-requests` (คิว + รายการอนุมัติอัตโนมัติ), `/system/signup-requests/[id]/mail` (ประวัติส่งลิงก์ claim), `/system/company-onboardings/new`
- **API:** `GET system/signup-requests`, `GET …/auto-approved`, `GET …/:id/claim-deliveries` (`system.company_onboarding.read`); `POST …/:id/decision`, `POST …/:id/reissue-claim` (`system.company_onboarding.create`); `POST system/company-onboardings` (`.create`), `GET …/:id` (`.read`), `POST …/:id/regenerate-temporary-password`, `POST …/:id/reissue-owner-line-link` (`.regenerate_temporary_password`)
- **ข้อมูล:** `CompanySignupRequest`, `CompanyOnboardingRun` — **ทดสอบ:** `e2e/line-signup-contact-email.spec.ts`, `e2e/system-admin.spec.ts`

### FR-BILL-122 การเปิด–ปิดแพลตฟอร์ม (platform access)

- **คำอธิบาย:** `/system/platform-access` ตั้งสถานะการเข้าถึงแพลตฟอร์ม (เช่น ปิดปรับปรุง → ผู้ใช้ถูกพาไป `/maintenance`)
- **API:** `GET /v1/auth/platform-access` (public), `GET/PUT /v1/system/platform-access` (`system.launch_gate.manage`); audit `platform.access.state_update`; ข้อมูล `PlatformAccessControl`

### FR-BILL-123 บัญชีผู้บริหารและรายงานผู้บริหาร

- **หน้าจอ:** `/system/executive-users`, `/new`, `/[userId]`; `/system/executive` (ภาพรวม), `/customers`, `/usage`, `/revenue`, `/companies`, `/companies/[targetCompanyId]`; `/system/executive/compare` ถูกถอด (redirect ไป `/system/executive`)
- **API:** `system/executive-users` — `GET /`, `POST /`, `GET /:userId`, `POST /:userId/status | credential | access` (`system.executive_user.manage`); `system/executive` — `GET context | overview | companies | analysis | companies/:id | companies/:id/history` (`system.executive.read`), `POST exports` (+ `system.executive.export`), `PATCH companies/:id` (+ `system.executive.company_note.manage`)
- **กฎ:** สถานะบัญชี `PENDING_ACTIVATION | ACTIVE | SUSPENDED | REVOKED`; สิทธิ์ย่อย `canExport`, `canSeeContacts`, `canManageCompanyNote`; ข้อมูลรายได้ในรายงานอ่านผ่าน `BillingCashMovementsService` ของ billing เท่านั้น
- **ทดสอบ:** `e2e/executive-report.spec.ts`

### FR-BILL-124 การส่งอีเมลของแพลตฟอร์ม (email delivery)

- **หน้าจอ:** `/system/email-delivery` — **API:** `GET system/email-delivery`, `GET …/connection`, `GET …/retention` (`system.email_delivery.read`), `PUT …/retention` (+ `.manage`) — **ข้อมูล:** `EmailSendAttempt`, `EmailHistoryPolicy`, `EmailSuppression`

### FR-BILL-125 กล่องคำขอความช่วยเหลือ (support requests)

- **หน้าจอ:** `/system/support-requests` — **API (`system.partner_company.update`):** `GET system/support-requests`, `GET …/count`, `GET …/:id/thread`, `GET …/:id/messages/:mid/content`, `POST …/:id/claim | release | reclaim | reply | resolve | answered | resume-ai | pause-ai`
- **กฎเด่น:** เมื่อเจ้าหน้าที่รับเรื่อง AI ของร้านนั้นถูกพักไว้ (pause) และเปิดกลับได้; การเปลี่ยนผู้รับเอกสารของ billing อ้าง `supportRequestId` ได้ (FR-BILL-067)
- **ข้อมูล:** `LineSupportRequest`, `LineSupportMessage`, `LineSupportMessageBlob` — **Audit:** `system.support_request.claimed/released/reply/answered/resolved/pause_ai/resume_ai` — **ทดสอบ:** `e2e/system-support-resolution.spec.ts`, `e2e/client-support.spec.ts`

### FR-BILL-126 สิทธิ์ของเจ้าของข้อมูล (data rights)

- **หน้าจอ:** `/system/data-rights`, `/new`, `/[caseId]` — **API (`system.data_rights.manage`):** `POST/GET system/data-rights/cases`, `GET …/:caseId`, `POST …/:caseId/verify-identity | verify-authority | begin-retention-review | decisions | evidence | approve | start-execution | start-verification | complete | close`
- **กฎเด่น:** แต่ละขั้น (อนุมัติ, ดำเนินการ, ตรวจสอบ, ปิด) รองรับผู้ดูแลคนเดียวโดยต้องบันทึกเหตุผล (`approvalSingleAdmin` + `…Reason` ฯลฯ; audit `system.data_rights.single_admin_step`)
- **ข้อมูล:** `DataRightsCase`, `DataRightsDecisionRecord`, `DataRightsEvidenceRecord`, `DataRightsCaseActionRecord`

### FR-BILL-127 ธีมหน้าแรก (home theme)

- **หน้าจอ:** `/system/home-theme` (เฉพาะ `SYSTEM_ADMIN` ที่มี `system.home_theme.manage`) — **API:** `GET /v1/public/home-theme` (public), `GET/PUT /v1/system/home-theme` — **ข้อมูล:** `PublicHomeThemeSetting` (`event`, `version`) — audit `system.home_theme.update`

### FR-BILL-128 ตั้งค่า LINE กลาง (line settings)

- **หน้าจอ:** `/system/line-settings` — **API (`system.shared_line_credential.manage`):** `GET system/line/shared-credentials`, `PUT system/line/shared-credentials/:credentialKind` — **ข้อมูล:** `PlatformLineCredential` (ค่าลับไม่แสดงกลับ) — audit `system.shared_line_credential.published`

### FR-BILL-129 งบ AI ของแพลตฟอร์ม (AI budget)

- **หน้าจอ:** `/system/ai-budget` — **API (`system.partner_ai_model.manage`):** `GET/PUT system/ai-budget` — **ข้อมูล:** `PlatformAiBudgetConfig`; ค่า `aiMonthlyBudgetSatang` ที่แค็ตตาล็อก billing ประกาศมาจาก `AppConfigService` (งบความปลอดภัยรวมแบบเดิม ไม่ใช่โควตา chat 80 เครดิต) — **ทดสอบ:** `use-cases/set-platform-ai-budget.use-case.spec.ts`

### FR-BILL-130 ประเภทเงินได้หัก ณ ที่จ่าย (WHT income categories)

- **หน้าจอ:** `/system/wht-income-categories` — **API (`system.wht_income_category.manage`):** `GET system/wht-income-categories`, `PATCH …/:code` (เปิด–ปิดประเภทสำหรับทุกร้าน) — **ข้อมูล:** `WhtIncomeCategory` (`code`, `nameTh`, `formType`, `defaultRate`, `status`, `filingRoute`) — เกี่ยวกับแพ็ก: ฟีเจอร์ WHT/50 ทวิ เป็นเหตุที่เปิดขาย `ENTERPRISE_1999` (หมายเหตุใน `billing.ts:8`)

### FR-BILL-131 ทีมขายและลิงก์เดโมในคอนโซลระบบ

- `/system/sales-team` → FR-BILL-098 (มุม Admin), `/system/demo-links` → FR-BILL-112

### FR-BILL-132 API ระบบที่ไม่มีหน้าใน `/system/**` ของตัวเอง

- `system/identity-reconciliation/*` (`system.identity_reconciliation.resolve`) — ใช้จากหน้ารายละเอียดร้าน; `system/entitlement-exceptions` (`system.entitlement_exception.manage`); `system/launch-gates` (`commands`: `.manage`, `health`: `.read`); `system/package-change-requests` (FR-BILL-087) — ไม่พบ route ใต้ `apps/web/app/system/` ที่ชื่อตรงกับสาม API แรก (อาจถูกฝังในหน้าอื่นหรือใช้ผ่านเครื่องมือปฏิบัติการ — ไม่ได้ตรวจยืนยัน)

---

## 14. ข้อกำหนดที่ไม่ใช่ฟังก์ชัน

| ID | ชื่อ | ข้อกำหนด (ตามโค้ด) | หลักฐาน |
|---|---|---|---|
| NFR-BILL-001 | ความถูกต้องของเงิน | คำนวณเงินด้วยจำนวนเต็มสตางค์; สัดส่วนใช้ BigInt ปัดครึ่งขึ้น; ค่ารวมไม่เกิน int32 (2,147,483,647) | `domain/billing-package.ts`, `billing-policy.ts` |
| NFR-BILL-002 | ไม่เชื่อ payload ภายนอก | สิทธิ์เกิดจากการอ่าน Stripe สดและตรวจหลักฐานครบทุกฟิลด์เท่านั้น ไม่เคยจาก webhook payload หรือจากเบราว์เซอร์ | `paid-invoice.ts`, `paid-checkout-invoice.ts`, `reconciler.handle()` |
| NFR-BILL-003 | Idempotency | ทุกคำสั่งที่มีผลทางการเงินมี idempotency key ทั้งฝั่ง API (unique ต่อบัญชี/โหมด) และฝั่ง Stripe; apply ซ้ำไม่ให้สิทธิ์ซ้ำ (unique `providerInvoiceId`, `sourceKey`, outbox `eventKey`) | §5.2, `applyInvoice` |
| NFR-BILL-004 | Concurrency | lease 120 วินาทีต่อบัญชี/event/operation + `FOR UPDATE` fence; optimistic `version`; advisory lock ต่อบริษัท (`lockPlanTermCompany`, `partner-ocr-config:{companyId}`) และต่อ issue; ลำดับ lock คงที่ | `assertLease`, FR-BILL-042 |
| NFR-BILL-005 | Fail closed | gate ตั้งต้นปิด; policy ไม่ครบ = ไม่ขาย; `productKind` ไม่รู้จัก = error; แคมเปญที่ parse ไม่ได้ไม่ถูกใช้แต่ไม่ปิดการขายปกติ; ยกเว้น plan limit ของร้านรุ่นเก่าที่ fail open โดยตั้งใจ | `effectiveBillingGates`, `assertPolicyReady`, `billingProductKind` |
| NFR-BILL-006 | ความปลอดภัยของ webhook | HMAC-SHA256, timing-safe, ความคลาดเวลา ≤ 5 นาที, body ≤ 256 KiB, ตรวจ api version/โหมด/บัญชี | `verifyStripeSignature`, `validBillingEvent` |
| NFR-BILL-007 | ความลับและข้อมูลส่วนบุคคล | ไม่ log body ของ Stripe; เก็บเฉพาะ error code/type; URL ภายนอกผ่าน allowlist host; ข้อมูลภาษี/ธนาคารของเซลล์เข้ารหัส; token ของ QR/เดโมเก็บเฉพาะ hash; ข้อความ LINE เรื่องดีลไม่มีตัวเลข | `stripe.client.ts`, `SalesAgentProfile`, `sales-deal.logic.ts` |
| NFR-BILL-008 | Rate limiting | ร้าน 30/60 วิ ต่อ (company,user); ผู้ดูแล 30/60 วิ; แก้ issue 30/60 วิ; reauth 5/300 วิ; ส่งเอกสารซ้ำ 3/วัน/เอกสาร; เดโม open มี rate limit — ผ่าน `RedisRateLimitService` | `billing.controller.ts`, `billing-rate-limit-window.ts` |
| NFR-BILL-009 | Dual control และ step-up | คำสั่งเสี่ยงสูงต้อง preview → submit → approve + ยืนยันรหัสผ่านภายใน 5 นาที; ตรวจสิทธิ์และ credential version ซ้ำตอนรัน | §6.3 |
| NFR-BILL-010 | Audit | ทุกการเปลี่ยนสิทธิ์/เงิน/ตั้งค่า/เปิดเอกสารเขียน `AuditLog` พร้อม `riskLevel` (apply ใบแจ้งหนี้ = CRITICAL) และ `requestId` | ภาคผนวก ง |
| NFR-BILL-011 | แยกโหมด test/live | ทุกแถวผูก `(stripeAccountId, livemode)`; secret key ต้องตรง prefix; ข้อมูลข้ามโหมด = `PAID_OTHER_MODE`; สิทธิ์โปรโมชันแยก environment `LIVE`/`TEST` | `StripeClient.request`, `billingPurchaseSource` |
| NFR-BILL-012 | ความทนทานต่อ provider | timeout 15 วิ; แยก REJECTED/RETRY/UNKNOWN; backoff สูงสุด 1 ชม.; event ตาย = issue ให้คนดู; scan ทุก 5 นาทีต่อบัญชีเป็นตาข่ายเมื่อ webhook หาย; provider scan ย้อนหลัง | FR-BILL-031, 032, 054 |
| NFR-BILL-013 | เวลาและเขตเวลา | รอบบิลและเดือนโควตาคิดตาม Asia/Bangkok (UTC+7); เก็บเป็น UTC; วันใน plan term แบบ manual = 24 ชม. เต็ม | `billing-package.ts`, `plan-term.logic.ts` |
| NFR-BILL-014 | Cache | response billing ของผู้ดูแลและแค็ตตาล็อก `Cache-Control: no-store`; หน้า `/system` เป็น `force-dynamic` | controller, `system/layout.tsx` |
| NFR-BILL-015 | ไม่มี feature switch ตาม env | add-on และโหมดจ่ายเปิดด้วย policy/gate ในฐานข้อมูลที่ผ่านการอนุมัติ ไม่ใช่ env; ยกเว้นตัวช่วยทดสอบ local (`BILLING_RATE_LIMIT_WINDOW_SECONDS` ใช้ได้เฉพาะ `APP_ENV=local`) | `billing.ts:86`, `billing-rate-limit-window.ts` |
| NFR-BILL-016 | ภาษาและถ้อยคำ | ข้อความถึงลูกค้าเป็นไทย; ชื่อแพ็กสำหรับลูกค้าตัดรหัสในวงเล็บ (`shopPlanTierLabel`, `lineCustomerWording`); ราคามาจากแค็ตตาล็อกที่ active เท่านั้น | `billing.ts:779-796` |

---

## 15. ภาคผนวก ก — ตาราง API ทั้งหมด

Prefix ทั้งหมด `/v1`; สิทธิ์ในคอลัมน์ P คือ `@RequirePermissions` ของ route (บริการอาจตรวจเพิ่มตามที่ระบุใน FR)

### 15.1 สาธารณะและภายใน

| Method | Path | P | FR |
|---|---|---|---|
| GET | `billing/catalog` | public | 001 |
| POST | `public/stripe-events` | public + ลายเซ็น Stripe | 030 |
| POST | `internal/billing/drain` | worker token | 031 |
| POST | `internal/billing/scan` | worker token | 032 |
| POST | `internal/billing/provider-scans/drain` | worker token | 054, 055 |
| POST | `internal/billing/notifications/drain` | worker token | 039 |
| POST | `public/event-discounts/claim` | public (LINE identity) | 096 |
| POST | `internal/sales/deals/expire-sweep`, `internal/sales/deals/renewal-sweep`, `internal/sales/daily-digest` | worker token | 094 |
| POST | `auth/demo/open` | public | 111 |
| GET | `auth/platform-access`, `public/home-theme` | public | 122, 127 |

### 15.2 ร้าน — `companies/:companyId/billing` (ทุก route: `account.session.read` + plan manager)

| Method | Path | FR |
|---|---|---|
| GET | `` (status) | 002 |
| POST | `refresh` | 002 |
| GET | `event-discount` | 018 |
| POST | `quote` | 003 |
| GET | `capacity` | 003, 010 |
| POST | `checkout` | 004 |
| GET | `attempts/:attemptId` | 005 |
| POST | `attempts/:attemptId/resume`, `attempts/:attemptId/cancel` | 005 |
| POST | `attempts/:attemptId/capacity` | 010 |
| GET | `history` | 006 |
| GET | `invoices/:documentId/adjustments/:kind` | 006 |
| POST | `documents/:documentId/open` | 006 |
| POST | `documents/:documentId/resend` | 007 |
| GET | `recipient`, `recipient/:id` | 008 |
| POST | `recipient/otp/request`, `recipient/otp/confirm`, `recipient/preview`, `recipient/:id/:action` | 008 |
| POST | `collection/preview`, `collection/:id/:action`, `collection/:id/capacity` | 011, 012, 010 |
| GET | `collection/:id` | 011 |
| POST | `portal` | 016 |

เพิ่มเติม: `companies/:companyId/demo-chat/messages` (POST, GET), `…/demo-chat/files` (POST) — FR-BILL-113

### 15.3 ผู้ดูแล — `system/billing`

| กลุ่ม | Route (method) | P |
|---|---|---|
| ภาพรวม | `overview` (G), `companies/:id` (G), `companies/:id/timeline` (G), `lookup` (G) | `system.billing.read` |
| | `companies/:id/timeline/export` (P) | `system.billing.export` |
| Issue | `issues` (G), `issues/:id` (G), `issues/:id/outcomes` (G), `issues/:id/outcomes/:outcomeId` (G) | `read` |
| | `issues/:id` (PATCH), `issues/:id/operators` (G), `issues/:id/outcomes/preview` (P), `issues/:id/outcomes/:outcomeId/:action` (P) | `issue.manage` |
| ซ่อม | `operations` (G, P), `operations/:id` (G), `operations/preview` (P), `operations/:id/:action` (P), `companies/:id/apply-invoices[/:id]` (G), `companies/:id/invoice-findings/:findingId` (G) | `read` (+ ชนิดคำสั่งตรวจในบริการ) |
| Event | `provider-events` (G), `provider-events/:id` (G) | `read` |
| | `provider-events/:id/preview` (P) | `reconcile.run` |
| Scan | `provider-scans` (G), `provider-scans/:id` (G), `provider-scans/schedule` (G), `…/schedule/history` (G), `…/schedule/operations/:id` (G), `companies/:id/invoice-scans` (G), `…/invoice-scans/:scanId` (G), `…/invoice-scans/:scanId/findings` (G) | `read` |
| | `provider-scans` (P), `provider-scans/:id/:action` (P), `…/schedule/preview` (P), `…/schedule/operations/:id/:action` (P), `companies/:id/invoice-scans` (P), `…/invoice-scans/:scanId/:action` (P) | `reconcile.run` |
| Settlement | `settlements` (G), `settlements/:id` (G), `settlements/:id/findings` (G) | `financial.read` |
| | `settlements` (P), `settlements/:id/:action` (P) | `reconcile.run` |
| ตั้งค่า | `settings` (G), `configuration-changes` (G), `configuration-changes/:id` (G), `…/:id/affected` (G), `configuration-changes/preview` (P), `configuration-drafts` (P), `configuration-changes/:id/:action` (P), `reauthenticate` (P) | `read` (+ `policy.manage`/`gate.manage`/`approval.approve` + platform scope ในบริการ) |
| | `settings/emergency-close` (P) | `gate.manage` |
| | `configuration-checks` (G), `configuration-checks/:id` (G) | `read` |
| | `configuration-checks` (P), `configuration-checks/:id/:action` (P) | `reconcile.run` |
| แคมเปญ | `promotion-campaigns` (G), `promotion-campaigns/:campaignId` (G), `…/report` (G), `promotion-campaign-drafts` (P), `promotion-campaign-drafts/:campaignId/discard` (P), `promotion-campaigns/:campaignId/preview | pause | end` (P) | `read` (+ `policy.manage` ในบริการ) |
| ขอบเขต | `operator-scopes` (G), `scope-directory/:kind` (G), `scope-changes` (G), `scope-changes/:id` (G), `scope-changes/preview` (P), `scope-changes/:id/:action` (P) | `admin.role.manage` |
| คืนเงิน | `companies/:id/invoices/:invoiceId/refund-review` (G), `…/refund-requests` (G), `…/end-package` (G), `…/adjustments/:kind` (G), `refunds/:id` (G), `refunds/:id/:action` (P) | `financial.read` |
| | `companies/:id/invoices/:invoiceId/refund-preview` (P), `…/end-package` (P) | `refund.manage` |
| Checkout | `companies/:id/checkouts` (G), `…/checkouts/:attemptId` (G), `…/checkouts/:attemptId/requests` (G), `checkout-expiry/:id` (G) | `read` |
| | `companies/:id/checkouts/:attemptId/preview` (P), `checkout-expiry/:id/:action` (P) | `gate.manage` |
| Batch | `batches` (G), `batches/:id` (G) | `read` |
| | `batches/preview` (P), `batches/:id/:action` (P) | `reconcile.run` |
| | `batches/:id/export` (G) | `export` |
| ปรับสิทธิ์ | `companies/:id/plan-adjustments` (G), `…/plan-adjustments/preview` (P), `plan-adjustments/:id` (G), `plan-adjustments/:id/:action` (P), `companies/:id/receipt-adjustments` (G), `receipt-adjustments/:id` (G), `receipt-adjustments/:id/:action` (P), `companies/:id/credits` (G), `credit-grants/:id` (G), `credit-grants/:id/:action` (P), `companies/:id/reauthenticate` (G, P) | `financial.read` |
| | `companies/:id/receipt-adjustments/preview` (P), `companies/:id/credit-grants/preview` (P) | `override.manage` |
| เอกสาร | `companies/:id/documents/:invoiceId/open` (P) | `document.read` |
| | `companies/:id/invoices/:invoiceId/recipient-review` (G), `…/recipient-requests` (G), `recipient-changes/:id` (G), `recipient-changes/:id/:action` (P) | `financial.read` |
| | `companies/:id/invoices/:invoiceId/recipient-preview` (P), `…/resend` (P) | `override.manage` |
| การแจ้ง | `companies/:id/deliveries` (G), `companies/:id/deliveries/:deliveryId` (G) | `read` |

### 15.4 Sales, demo และ system อื่น

ดูรายการครบใน FR-BILL-090 ถึง FR-BILL-132 (controller: `sales-console/presentation/http/*.controller.ts`, `sales-demo/presentation/*.controller.ts`, `system-partner-management/presentation/http/*.controller.ts`, `external-signup/presentation/http/system-*.controller.ts`, `system-onboarding/…`, `executive-business/…`, `data-rights/data-rights.controller.ts`, `public-home-theme/home-theme.controller.ts`, `auth/presentation/platform-access.controller.ts`, `auth/presentation/system-email-delivery.controller.ts`, `tax/presentation/http/system-wht-income-category.controller.ts`, `feature-launch/…/launch-gate.controller.ts`, `system-identity-reconciliation/…`, `employee-access/…/entitlement-exception.controller.ts`)

---

## 16. ภาคผนวก ข — หน้าจอ `/system/**` ทั้งหมด

ทุก route อยู่ใต้ `apps/web/app/system/`; component อยู่ใน `apps/web/features/…`

| Route | Component | FR |
|---|---|---|
| `/system/billing` | `billing-admin/BillingAdminPage` | 050 |
| `/system/billing/companies/[id]` | `BillingAdminPage` | 050 |
| `/system/billing/issues`, `/issues/[id]` | `BillingAdminPage` | 051 |
| `/system/billing/operations/[id]` | `BillingOperationPanel` | 052 |
| `/system/billing/companies/[id]/apply-invoices`, `/[invoiceId]` | `BillingApplyInvoicesPage` | 052 |
| `/system/billing/companies/[id]/invoice-findings/[findingId]` | `BillingInvoiceFindingPage` | 052, 054 |
| `/system/billing/provider-events`, `/[id]` | `BillingProviderEventsPage` | 053 |
| `/system/billing/provider-scans`, `/[id]` | `BillingProviderScansPage` | 054 |
| `/system/billing/companies/[id]/invoice-scans`, `/[scanId]` | `BillingProviderScansPage` | 054 |
| `/system/billing/settlements`, `/[id]` | `BillingSettlementPage` | 055 |
| `/system/billing/settings` | `BillingConfigurationPage` | 056 |
| `/system/billing/configuration-changes/[id]` | `BillingConfigurationPage` | 056 |
| `/system/billing/configuration-changes/[id]/affected` | `BillingConfigurationImpactPage` | 056 |
| `/system/billing/configuration-checks`, `/[id]` | `BillingConfigurationChecksPage` | 057 |
| `/system/billing/operator-scopes`, `/scope-changes/[id]` | `BillingScopesPage` | 060 |
| `/system/billing/companies/[id]/invoices/[invoiceId]` | `billing/BillingAdjustmentsPage` | 061, 067 |
| `/system/billing/companies/[id]/invoices/[invoiceId]/refund`, `/system/billing/refunds/[id]` | `BillingRefundPage` | 061 |
| `/system/billing/companies/[id]/invoices/[invoiceId]/recipient`, `/system/billing/recipient-changes/[id]` | `BillingRecipientAdminPage` | 067 |
| `/system/billing/companies/[id]/checkouts`, `/[attemptId]`, `/system/billing/checkout-expiry/[id]` | `BillingCheckoutPage` | 062 |
| `/system/billing/batches`, `/[id]` | `BillingBatchPage` | 063 |
| `/system/billing/companies/[id]/plan-adjustments`, `/system/billing/plan-adjustments/[id]` | `BillingPlanAdjustmentsPage` | 064 |
| `/system/billing/companies/[id]/receipt-adjustments`, `/system/billing/receipt-adjustments/[id]` | `BillingReceiptAdjustmentsPage` | 065 |
| `/system/billing/companies/[id]/deliveries`, `/[deliveryId]` | `BillingDeliveryPanel` | 039, 052 |
| `/system/billing/campaigns`, `/new`, `/[campaignId]` | `BillingCampaignsPage`, `BillingCampaignFormPage`, `BillingCampaignDetailPage` | 069 |
| `/system/partners`, `/[companyId]` | `system-partners/PartnerListPage`, `PartnerDetailPage` | 120, 081 |
| `/system/users` | redirect → `/system/partners` | 120 |
| `/system/signup-requests`, `/[id]/mail` | `system-signup-requests/SignupQueuePage`, `SignupClaimHistoryPage` | 121 |
| `/system/company-onboardings/new` | `system-onboarding/SystemOnboardingNewPage` | 121 |
| `/system/platform-access` | `system-partners/PlatformAccessPage` | 122 |
| `/system/executive-users`, `/new`, `/[userId]` | `executive-users/ExecutiveUsersPage`, `ExecutiveUserPage` | 123 |
| `/system/executive`, `/customers`, `/usage`, `/revenue`, `/companies`, `/companies/[targetCompanyId]` | `executive-reports/ExecutiveReportPage` | 123 |
| `/system/executive/compare` | redirect → `/system/executive` | 123 |
| `/system/email-delivery` | `system-email-delivery/SystemEmailDeliveryPage` | 124 |
| `/system/support-requests` | `system-support-requests/SupportRequestsPage` | 125 |
| `/system/data-rights`, `/new`, `/[caseId]` | `system-data-rights/DataRightsListPage`, `DataRightsNewPage`, `DataRightsDetailPage` | 126 |
| `/system/home-theme` | `system-home-theme/HomeThemeSettingsPage` | 127 |
| `/system/line-settings` | `system-partners/SharedLineSettingsPage` | 128 |
| `/system/ai-budget` | `system-partners/PlatformAiBudgetPage` | 129 |
| `/system/wht-income-categories` | `system-wht-income-categories/WhtIncomeCategoriesPage` | 130 |
| `/system/sales-team` | `sales-console/SalesTeamPage` | 098 |
| `/system/demo-links` | `sales-console/SalesDemoLinksPage` | 112 |

หน้าฝั่งขาย (`apps/web/app/sales/`): `/sales`, `/sales/my-work`, `/sales/companies`, `/sales/deals`, `/sales/deals/new`, `/sales/deals/[id]`, `/sales/events`, `/sales/events/[batchId]`, `/sales/team`, `/sales/profile`, `/sales/reports`, `/sales/demo-links`; หน้าเดโม: `/d/[token]`, `/d/expired`

---

## 17. ภาคผนวก ค — Prisma models

แหล่ง: `apps/api/prisma/schema.prisma`

| Model | บทบาท | ฟิลด์สำคัญ |
|---|---|---|
| `BillingSettings` | แถวเดียวต่อ (account, livemode) | `version`, `policyRevisionId`, `gatesJson` |
| `BillingPolicyRevision` | policy ที่เผยแพร่ | `version`, `state`, `policyJson`, `promotionJson`, `createdByUserId`, `approvedByUserId`, `approvedAt` |
| `BillingOperatorScope` | ขอบเขตผู้ปฏิบัติงาน | `userId`, `companyId`, `expiresAt`, `revokedAt`, `version` |
| `BillingAccount` | บัญชีเรียกเก็บของร้าน | `customerId`, `baseSubscriptionId`, `activeAttemptId`, `activeAddOnAttemptId`, `activeEmailOperationId`, `activeCollectionOperationId`, `pendingPlanChangeId`, `contractAttemptId`, `collectionPauseJson`, `termProjectionHash`, `nextReconcileAt`, `subscriptionState`, `renewalMode`, `billingAnchorDay`, `cancelAtPeriodEnd`, `paidThrough`, `graceEndsAt`, `nextChargeAt`, `leaseToken`, `leaseUntil`, `recipientEmail`, `recipientSource`, `recipientBouncedAt`, `recipientBounceNotifiedAt`, `checkoutAddressJson`, `version`, `observedAt` |
| `BillingQuote` | ใบเสนอราคา | `companyId`, `initiatingUserId`, `policyRevisionId`, `snapshotJson`, `expiresAt` |
| `BillingAttempt` | ความพยายามจ่าย | `quoteId` (unique), `channel`, `idempotencyKey`, `requestHash`, `quoteSnapshot`, `productKind`, `policyRevisionId`, `consentRevision`, `consentAt`, `status`, `checkoutSessionId`, `subscriptionId`, `dealRequestId`, `collectionJson`, `errorCode`, `version` |
| `BillingSubscriptionContract` | สัญญาที่มีผลตามเวลา | `sourceAttemptId`, `effectiveAt`, `revision`, `snapshotJson` |
| `BillingInvoice` | ใบแจ้งหนี้ที่จ่ายแล้ว | `providerInvoiceId`, `sourceAttemptId`, `subscriptionId`, `providerNumber`, `offerSnapshot`, `contractSnapshot`, `productKind`, `totalSatang`, `paidSatang`, `taxSatang`, `feeSatang`, `refundedSatang`, `disputed`, `financialObservedAt`, `providerChargeId`, `periodStart`, `periodEnd`, `benefitEnd`, `providerStatus`, `evidenceHash`, `applyStatus`, `errorCode`, `appliedAt` |
| `BillingReceiptGrant` / `ReceiptUnitEntry` | ล็อตใบเสร็จและรายการใช้ | `sourceKey`, `sourceHash`, `kind`, `units`, `serviceStart/End`, `availableAt`, `expiresAt`, `revokedAt` / `operationKey`, `generation`, `kind`, `units` |
| `BillingPromotionRedemption` | สิทธิ์โปรโมชัน | `promotionEnvironmentId`, `campaignId`, `companyId`, `state`, `campaignRevision`, `termsHash`, `offerKey`, `interval`, `offerSignature`, `bonusMonths`, `bonusReceiptUnits`, `attemptId`, `invoiceId`, `acceptedAt`, `createBy`, `consumedAt`, `benefitAppliedAt`, `releasedAt`, `entitlementAdjustedAt`, `paidStart`, `paidEnd`, `bonusEnd`, `releaseCount` |
| `BillingProviderEvent` | event จาก Stripe | `eventId`, `eventType`, `objectId`, `apiVersion`, `evidenceHash`, `status`, `attempts`, `retryAt`, `leaseToken`, `leaseUntil`, `errorCode`, `receivedAt`, `processedAt` |
| `BillingIssue` | เคส | `kind`, `referenceId`, `state`, `assigneeUserId`, `backupUserId`, `priority`, `followUpAt`, `slaStartedAt`, `slaDueAt`, `slaPolicyRevisionId`, `episode`, `lastSeenAt`, `note`, `resolvedAt` |
| `BillingOperation` | คำสั่ง | `type`, `state`, `referenceId`, `proposedJson`, `resultJson`, `sourceVersion`, `version`, `reason`, `initiatorUserId`, `approverUserId`, `idempotencyKey`, `requestHash`, `expiresAt`, `scheduledFor`, `leaseToken`, `leaseUntil`, `errorCode`, `observedAt` |
| `CompanyPlanTerm` | อายุและเพดานแพ็ก | `tierKey`, `branchLimit`, `employeeLimit`, `monthlySlipLimit`, `capacityOverride`, `billingReceiptAccountId`, `termStartAt`, `termEndsAt`, `warningDays`, `renewCount`, `lastRenewedAt`, `termDisabledAt`, `warn7SentAt`, `warn3SentAt`, `warn1SentAt`, `expiredNotifiedAt`, `warmupUntil`, `warmupSlipLimit`, `quotaNoticeSentMonthKey`, `freeQuotaNoticeSentMonthKey` |
| `PackageChangeRequest` | คำขอเปลี่ยนแพ็ก / ดีลขาย | `kind`, `status`, `requestedTierKey`, `amountSatang`, `offerSnapshotJson`, `salesUserId`, `approvedByUserId`, `approvedAt`, `offerExpiresAt`, `rejectedReason`, `internalReason`, `selfApproved`, `renewalOfRequestId`, `renewalRemindedAt`, `stripePriceId`, `priceState`, `returnAt`, `version` |
| `SalesAgentProfile` | โปรไฟล์เซลล์ | `salesCode`, `teamLeadUserId`, `legalName`, `nationalIdEncrypted`, `taxIdEncrypted`, `bankAccountEncrypted`, `bankName`, `whtRatePercent`, `status`, `suspendedAt` |
| `SalesAttribution` / `SalesAttributionDeduction` | เครดิตยอดขาย | `salesUserId`, `source`, `amountSatang`, `months`, `interval`, `paidAt`, `refundedSatang`, `sourceInvoiceId`, `dealRequestId`, `flags`, `flagReviewedAt` / `kind`, `providerRef`, `amountSatang`, `occurredAt` |
| `SalesEventBatch` / `SalesEventBatchAgent` / `SalesEventQrToken` / `SalesEventTicket` | งานอีเวนต์ | batch: `discountSatang`, `rewardChatCreditUnits`, `rewardReceiptImageUnits`, `issueCap`, `issuedCount`, `claimStartsAt/EndsAt`, `scopeJson`, `state`, `revision`; ticket: `serial`, `holderProviderUserId`, `discountSatang`, `scopeJson`, `expiresAt`, `state`, `redeemedAs`, `companyId`, `attemptId`, `invoiceId`, `appliedDiscountSatang`, `reservedAt`, `usedAt`, `revokedAt` |
| `SalesDemoLink` / `DemoChatMessage` | ลิงก์เดโม | `tokenHash`, `expiresAt`, `companyId`, `openedAt`, `revokedAt`, `aiCreditUnits`, `readLimit` |
| `AiCreditGrant` / `AiCreditEntry` | บัญชีเครดิต AI (ใช้โดยดีล/เดโม/งาน) | `sourceKind`, `sourceKey`, `units`, `availableAt`, `expiresAt`, `invoiceId`, `operationId` |
| อื่นที่หน้า `/system` ใช้ | — | `CompanySignupRequest`, `CompanyOnboardingRun`, `PlatformAccessControl`, `PublicHomeThemeSetting`, `PlatformLineCredential`, `PlatformAiBudgetConfig`, `CompanyAiConfiguration`, `WhtIncomeCategory`, `LineSupportRequest`, `LineSupportMessage`, `DataRightsCase` (+ decision/evidence/action), `EmailSendAttempt`, `EmailHistoryPolicy`, `EmailSuppression`, `ExecutiveCompanyProfile`, `ExecutiveReportBuild`, `AuditLog`, `OutboxEvent`, `AuthSession` (`billingReauthenticatedAt`, `billingCredentialVersion`) |

---

## 18. ภาคผนวก ง — รหัสข้อผิดพลาด, issue kind, audit action

### 18.1 รหัสข้อผิดพลาด (จาก `billingError()` และ `code:` ในโมดูล billing)

**ฝั่งลูกค้า (`BILLING_*`):** `BILLING_CADENCE_PENDING_CHANGE`, `BILLING_CAP_SELECTION_REQUIRED`, `BILLING_CHECKOUT_INVOICE_MISMATCH`, `BILLING_CHECKOUT_PENDING`, `BILLING_COLLECTION_CLOSED`, `BILLING_COLLECTION_PENDING`, `BILLING_COLLECTION_REVIEW`, `BILLING_COMPANY_HELD`, `BILLING_COMPANY_SALES_CLOSED`, `BILLING_CONSENT_REQUIRED`, `BILLING_DEAL_EXPIRED`, `BILLING_DEAL_NOT_FOUND`, `BILLING_DEAL_SNAPSHOT_MISMATCH`, `BILLING_DOCUMENT_BINDING`, `BILLING_DOCUMENT_PENDING`, `BILLING_EMAIL_CHANGED`, `BILLING_EMAIL_UPDATE_PENDING`, `BILLING_ENTITLEMENT_REVIEW_REQUIRED`, `BILLING_EXISTING_SUBSCRIPTION`, `BILLING_IDEMPOTENCY_CONFLICT`, `BILLING_IDEMPOTENCY_REQUIRED`, `BILLING_INPUT_INVALID`, `BILLING_INVOICE_MISMATCH`, `BILLING_LOOKUP_AMBIGUOUS`, `BILLING_LOOKUP_EVENT_TICKET_UNUSED`, `BILLING_LOOKUP_TOO_SHORT`, `BILLING_MAPPING_MISMATCH`, `BILLING_MODE_CHANGE_PENDING`, `BILLING_MODE_NOT_READY`, `BILLING_NOT_CONFIGURED`, `BILLING_NOT_READY`, `BILLING_OFFER_UNAVAILABLE`, `BILLING_PACKAGE_STATE_INVALID`, `BILLING_PLAN_CHANGE_PENDING`, `BILLING_PLAN_CHANGE_REQUIRED`, `BILLING_PORTAL_CONFIG_MISMATCH`, `BILLING_PORTAL_UNAVAILABLE`, `BILLING_PRICE_MISMATCH`, `BILLING_PURCHASE_PENDING`, `BILLING_QUOTE_STALE`, `BILLING_RATE_LIMIT`, `BILLING_RECIPIENT_BOUNCED`, `BILLING_RECIPIENT_BUSY`, `BILLING_RECIPIENT_INVALID`, `BILLING_RECIPIENT_NO_CUSTOMER`, `BILLING_RECIPIENT_PROOF_INVALID`, `BILLING_RECIPIENT_UNAVAILABLE`, `BILLING_RECIPIENT_UNCHANGED`, `BILLING_REFUND_PENDING`, `BILLING_REPEAT_NOT_READY`, `BILLING_REPEAT_REVIEW`, `BILLING_RESEND_LIMIT`, `BILLING_RESEND_UNAVAILABLE`, `BILLING_RESTART_REVIEW`, `BILLING_SALES_CLOSED`, `BILLING_SOURCE_REVIEW_REQUIRED`, `BILLING_TAX_MISMATCH`, `BILLING_UPGRADE_BELOW_MINIMUM`, `BILLING_UPGRADE_BOUNDARY`, `BILLING_UPGRADE_GIFT_ONLY`, `BILLING_UPGRADE_REVIEW`, `PROMOTION_UNAVAILABLE`, `PROMOTION_UPGRADE_DEFERRED`, `SALES_DEAL_PRICE_PENDING`, `SALES_EVENT_TICKET_UNAVAILABLE`

**ฝั่งผู้ดูแล (`CONTROL_*`):** `CONTROL_ACTION_NOT_SUPPORTED`, `CONTROL_ASSIGNEE_REVIEW`, `CONTROL_CHECKOUT_OUTCOME_UNKNOWN`, `CONTROL_CHECKOUT_SOURCE_CHANGED`, `CONTROL_COLLECTION_REVIEW`, `CONTROL_CONFIGURATION_CHECK_ACTIVE`, `CONTROL_DEAL_SUBSCRIPTION_REVIEW`, `CONTROL_EXPORT_CHANGED`, `CONTROL_FREE_DAYS_REVIEW`, `CONTROL_GATE_POLICY_STALE`, `CONTROL_IDEMPOTENCY_CONFLICT`, `CONTROL_IMPACT_NOT_READY`, `CONTROL_INVOICE_IDENTITY_NOT_READY`, `CONTROL_INVOICE_SOURCE_CHANGED`, `CONTROL_INVOICE_TARGET_REQUIRED`, `CONTROL_ISSUER_REQUIRED`, `CONTROL_NOTIFICATION_REVIEW`, `CONTROL_OFFER_CAPACITY_INVALID`, `CONTROL_OFFER_PRICE_INVALID`, `CONTROL_OFFER_RECEIPTS_INVALID`, `CONTROL_OPERATION_IN_PROGRESS`, `CONTROL_PERMISSION_CHANGED`, `CONTROL_POLICY_NOT_READY`, `CONTROL_POLICY_NOT_SUPPORTED`, `CONTROL_PREVIEW_STALE`, `CONTROL_PROMOTION_CAP_BELOW_USED`, `CONTROL_PROMOTION_CATALOG_STALE`, `CONTROL_PROMOTION_ENDED`, `CONTROL_PROMOTION_INVALID`, `CONTROL_PROMOTION_NOT_FOUND`, `CONTROL_PROMOTION_OVERLAP`, `CONTROL_PROVIDER_DISABLED`, `CONTROL_REAUTH_FAILED`, `CONTROL_REAUTH_REQUIRED`, `CONTROL_RECIPIENT_NOT_CHANGED`, `CONTROL_REFUNDS_CLOSED`, `CONTROL_REFUND_CONFIG_REQUIRED`, `CONTROL_REFUND_DISPUTED`, `CONTROL_REFUND_FAILED`, `CONTROL_REFUND_FULL`, `CONTROL_REFUND_LIMIT`, `CONTROL_REFUND_NOT_CREATED`, `CONTROL_REFUND_PENDING`, `CONTROL_REFUND_PROVIDER_REJECTED`, `CONTROL_REFUND_PROVIDER_UNAVAILABLE`, `CONTROL_REFUND_REVIEW`, `CONTROL_REFUND_SOURCE_CHANGED`, `CONTROL_SALES_COMPANY_INVALID`, `CONTROL_SCAN_BUSY`, `CONTROL_SCHEDULE_NOT_DUE`, `CONTROL_SCHEDULE_REVIEW`, `CONTROL_SCHEDULE_TIME`, `CONTROL_SCOPE_TARGET_INVALID`, `CONTROL_SLA_REVIEW`

**รหัสนอก billing ที่เกี่ยวข้อง:** `plan_branch_limit_exceeded` (422), `demo_link_expired` (410), `demo_rate_limited` (429), `demo_read_limit_reached` (403), `demo_action_unavailable` (403), `SALES_EVENT_BATCH_INVALID`, `SALES_EVENT_REWARD_REQUIRED`

**ข้อผิดพลาดภายในของ reconciler** (ข้อความ `Error('billing.…')` ไม่ถึงผู้ใช้ — ทำให้รอบนั้นล้มเหลวและ retry): เช่น `billing.reconciliation_busy`, `billing.lost_lease`, `billing.customer_unknown`, `billing.account_unmapped`, `billing.session_binding`, `billing.subscription_binding`, `billing.contract_binding`, `billing.duplicate_subscription`, `billing.invoice_evidence_changed`, `billing.addon_reconcile_unsupported`, `billing.one_time_*`, `billing.advance_deal_*`, `billing.promptpay_renewal_*`, `billing.card_renewal_card_not_saved`, `billing.cancellation_unconfirmed`, `billing.grace_source_changed`, `billing.profile_sync_*`

### 18.2 Issue kind (`BillingIssue.kind`)

`UNKNOWN_ATTEMPT`, `RECONCILIATION_FAILED`, `PAID_NOT_APPLIED`, `PAID_HELD`, `FINANCIAL_REVIEW`, `REFUND_FAILED`, `DUPLICATE_SUBSCRIPTION`, `ZERO_INVOICE_REVIEW`, `RENEWAL_REVIEW`, `GRACE_CANCELLATION_UNKNOWN`, `REPEAT_RECOVERY`, `CUSTOMER_COLLECTION_REVIEW`, `CONTROL_OPERATION_REVIEW`, `ADMIN_ADJUSTMENT`, `EMAIL_RECIPIENT_REVIEW`, `NOTIFICATION_REVIEW`, `NOTIFICATION_RECIPIENT_CHANGED`, `PROVIDER_EVENT_FAILED`, `PROVIDER_SCAN_FAILED`, `PROVIDER_SCAN_COVERAGE_GAP`, `PROVIDER_SCAN_VERSION_UNSUPPORTED`, `PROVIDER_SCAN_SCHEDULE_BLOCKED`, `PROVIDER_INVOICE_SCAN_FAILED`, `PROVIDER_INVOICE_REVIEW`, `SETTLEMENT_SCAN_FAILED`, `SETTLEMENT_REVIEW`, `CONFIG_DRIFT`, `CONFIGURATION_DRIFT`, `CONFIGURATION_SCHEDULE_REVIEW`, `DEAL_SUBSCRIPTION_CANCEL_PENDING`, `SPECIAL_PRICE_RETURN_REVIEW`, `EVENT_DISCOUNT_REVIEW`, `PROMOTION_REVIEW`

### 18.3 Audit action ของ billing

`billing.advance_deal.applied`, `billing.advance_deal.cancelled`, `billing.capacity.applied`, `billing.capacity.repair.confirmed`, `billing.checkout.not_started`, `billing.checkout_expiry.owner_requested`, `billing.collection_control.applied`, `billing.collection_control.ended`, `billing.configuration.draft_saved`, `billing.configuration.promotion_draft_saved`, `billing.configuration.schedule_blocked`, `billing.customer_sync.observed`, `billing.customer_sync.review`, `billing.deal_subscription_cancelled`, `billing.document.opened`, `billing.document.resent`, `billing.entitlements.applied`, `billing.financial.observed`, `billing.free_days.applied`, `billing.free_days.ended`, `billing.grace.started`, `billing.history.exported`, `billing.invoice.applied`, `billing.invoice.imported`, `billing.issue.detected`, `billing.issue.reopened`, `billing.issue.resolved`, `billing.issue.updated`, `billing.operation.cancel`, `billing.operation.queued`, `billing.operator_document.opened`, `billing.package.ended`, `billing.package_request.fulfilled`, `billing.package_request.superseded`, `billing.plan_menus.moved`, `billing.portal.opened`, `billing.prepaid_plan_change.applied`, `billing.price_return.ended`, `billing.price_return.observed`, `billing.price_return.queued`, `billing.promotion.released`, `billing.reauthenticated`, `billing.recipient.bounced`, `billing.recipient.captured`, `billing.recipient.changed`, `billing.renewal_binding.ended`, `billing.support_outcome.previewed` (และ action ที่ประกอบชื่อแบบ dynamic ในบริการ refund/scope/adjustment ซึ่งไม่ปรากฏเป็น literal — ไม่ได้ไล่ครบ)

Outbox event: `billing.invoice.applied`, `billing.prepaid_plan_change.applied`, `billing.status.email`

---

## 19. ภาคผนวก จ — ไฟล์ทดสอบ

**API unit/integration — `apps/api/src/modules/billing/` (45 ไฟล์):** `application/`: `billing-addon-admin-grants.spec.ts`, `billing-admin-lookup.spec.ts`, `billing-advance-deal.pg.spec.ts`, `billing-approval.spec.ts`, `billing-capacity.spec.ts`, `billing-checkout-expiry-owner.spec.ts`, `billing-checkout-expiry-source.spec.ts`, `billing-collection.spec.ts`, `billing-company-profile.spec.ts`, `billing-deal-chat-credit.spec.ts`, `billing-deal-subscription-cancel.spec.ts`, `billing-document-admin.service.spec.ts`, `billing-document-resend.spec.ts`, `billing-email-recipient.postgres.spec.ts`, `billing-end-package.spec.ts`, `billing-event-discount.spec.ts`, `billing-feature-entitlements.pg.spec.ts`, `billing-feature-entitlements.spec.ts`, `billing-financial.spec.ts`, `billing-free-days.spec.ts`, `billing-notifications-recipient.spec.ts`, `billing-overview-pagination.spec.ts`, `billing-plan-manage.spec.ts`, `billing-plan-menus.spec.ts`, `billing-price-return.spec.ts`, `billing-profile-recovery.spec.ts`, `billing-purchase-source.pg.spec.ts`, `billing-purchase-source.spec.ts`, `billing-receipt-allocator.spec.ts`, `billing-recipient-otp.service.spec.ts`, `billing-reconcile-command.spec.ts`, `billing-refund-source.spec.ts`, `billing-restart.spec.ts`, `billing-schedule.spec.ts`, `billing-settlement-source.spec.ts`, `billing-upgrade.spec.ts`; `domain/`: `billing-event-discount.logic.spec.ts`, `billing-package.spec.ts`, `billing-policy-addon.spec.ts`, `billing-promotion.spec.ts`, `billing-recipient-otp.logic.spec.ts`, `deal-offer.spec.ts`, `paid-checkout-invoice.spec.ts`, `paid-invoice-promptpay.spec.ts`; `infrastructure/stripe.client.spec.ts`

**Sales:** `sales-console/application/claim-event-discount.use-case.spec.ts`; `sales-console/domain/`: `sales-attribution.logic.spec.ts`, `sales-deal.logic.spec.ts`, `sales-event-claim.logic.spec.ts`, `sales-event-report.logic.spec.ts`, `sales-event.logic.spec.ts`, `sales-renewal.logic.spec.ts`

**Demo:** `sales-demo/application/`: `demo-chat.spec.ts`, `demo-company-access.spec.ts`, `demo-sample-data.pg.spec.ts`, `demo-sample-data.spec.ts`, `sales-demo.service.spec.ts`; `sales-demo/presentation/`: `sales-demo-credit.spec.ts`, `sales-demo.controller.spec.ts`

**Plan term/partner:** `system-partner-management/domain/logic/plan-term.logic.spec.ts`, `plan-capacity.spec.ts`, `receipt-quota.logic.spec.ts`; `application/free-expense-access.spec.ts`, `.pg.spec.ts`; `application/use-cases/company-plan-term.use-cases.spec.ts`, `plan-term-sweep.use-case.spec.ts`, `package-change-decision.use-case.spec.ts`, `partner-lifecycle-transition.use-case.spec.ts` และ spec อื่นในโฟลเดอร์เดียวกัน

**E2E (Playwright, `e2e/`):** `billing-admin-directory.spec.ts`, `billing-admin-document-tools.spec.ts`, `billing-admin-menu-ux.spec.ts`, `billing-advance-deal.spec.ts`, `billing-no-setup.spec.ts` (+ `.fixture.ts`), `billing-preview.spec.ts`, `billing-promotion.spec.ts` (+ `.fixture.ts`), `customer-billing-ux.spec.ts`, `plan-term-billing-readiness.spec.ts`, `sales-console.spec.ts`, `system-admin.spec.ts`, `system-settings-ux.spec.ts`, `system-support-resolution.spec.ts`, `client-support.spec.ts`, `executive-report.spec.ts`, `line-signup-contact-email.spec.ts`; journeys: `journeys/billing-first-card-renewal.journey.spec.ts`, `billing-first-promptpay.journey.spec.ts`, `billing-renew-or-top-up.journey.spec.ts`, `billing-stop-auto-renewal.journey.spec.ts`, `billing-unfinished-payment.journey.spec.ts`, `package-upgrade-unlocks-50-tawi.journey.spec.ts`

**Smoke script:** `apps/api/src/scripts/*billing*` (50 ไฟล์ — สคริปต์ smoke กับฐานข้อมูล/HTTP จริง เช่น `billing-plan-adjustments-smoke.ts`)

**ช่องว่างที่สังเกตได้:** ไม่พบ spec หน่วยของ `billing-reconciler.service.ts`, `billing-refunds.service.ts`, `billing-configuration.service.ts`, `billing-provider-scans.service.ts`, `billing-settlement.service.ts` ใต้โฟลเดอร์โมดูล (ครอบคลุมผ่าน smoke script และ e2e); ไม่พบ test ไฟล์ในเว็บ `features/billing-admin` / `features/billing`

---

## 20. สิ่งที่มีใน spec แต่ไม่พบในโค้ด / ข้อสังเกต

| เรื่อง | ใน spec / contract | ในโค้ด ณ `08850deaf` |
|---|---|---|
| ลูกค้าซื้อ add-on (chat credit / receipt image) ผ่าน Stripe | `docs/plans/chat-credit-and-receipt-addons-plan-th.md` (PR A–E), ชนิด `BillingAddOnQuote`, `BillingAddOnSummary`, `addOnPriceIds` | **มีใน spec แต่ไม่พบในโค้ด** — มีเพียงฐานราก (PR A) และการแถมโดยผู้ดูแล (PR B); ไม่มี endpoint quote/checkout ของ add-on; reconciler ปฏิเสธ attempt ที่ไม่ใช่ PACKAGE (FR-BILL-070) |
| `BillingStatus.addOns` | มีใน contract | ไม่มีเซิร์ฟเวอร์เติมค่า (ระบุใน comment ของ contract เอง) |
| ส่วนลดงานแบบให้ "เครดิต" (`path: 'CREDIT'`, `redeemedAs: 'CREDIT'`, `rewardChatCreditUnits`, `rewardReceiptImageUnits`) | `docs/plans/sales-event-discounts-plan-th.md` | คอลัมน์และชนิดข้อมูลยังอยู่ แต่ `validateSalesEventBatch` บังคับส่วนลด > 0 ทุก batch (ถอนไว้ตามหมายเหตุ Owner 2026-09-29) — การใช้แบบเครดิตไม่ได้ตรวจยืนยันว่ายังทำงานปลายทาง |
| ทดลองใช้ฟรีสำหรับผู้สมัครใหม่ | `BillingCatalog.trial` (30 วัน, 15 ใบ), `paidStart: 'AFTER_TRIAL'` | แค็ตตาล็อกไม่ส่ง `trial`; สมัครใหม่ถูกสร้างเป็น `no_package`; quote รับเฉพาะ `IMMEDIATE` |
| เปลี่ยนแพ็กผ่าน Stripe Portal (`portal_change_plan`) | อยู่ใน `BILLING_ACTIONS` | ถูกบังคับปิดถาวรและตั้งเป็นจริงไม่ได้ |
| `documentState: 'READY'`, `applyStatus: 'FAILED'` | อยู่ใน contract | ไม่พบจุดที่โค้ดคืน/เขียนค่านี้ในไฟล์ที่ตรวจ |
| โปรโมชันหลายเทมเพลต | spec โปรโมชันพูดถึง "Release 1" | รองรับเทมเพลตเดียว (STARTER แถม 1 เดือน + 30 ใบ) |
| หนี้ค้าง (`debtRecovery`) และนโยบายคืนเงิน (`refundPolicy`) | ช่องใน policy | รับได้ค่าเดียว `MANUAL_REVIEW` — ไม่มีระบบทวงหนี้/คืนเงินอัตโนมัติ |
| ชุด permission `system.release_operation.*`, `system.admin.cutover.*` | อยู่ใน contracts | ไม่มีหน้าใน `/system/**` (เครื่องมือ deploy/cutover) |

**ข้อสังเกตเพิ่มเติมจากการอ่านโค้ด**

1. Route หลายตัวของผู้ดูแลติดป้ายสิทธิ์ที่ระดับ controller เพียง `system.billing.read` หรือ `financial.read` (เช่น `configuration-changes/:id/:action`, `refunds/:id/:action`, `plan-adjustments/:id/:action`, `promotion-campaigns/*/pause`) แล้วตรวจสิทธิ์ "manage/approve" ในชั้นบริการ — ผู้อ่านโค้ดต้องดูทั้งสองชั้น
2. `BillingCatalog.aiMonthlyBudgetSatang` เป็นงบรวมแบบเดิมจาก config ไม่ใช่โควตา chat credit
3. มี issue kind สองชื่อใกล้กัน: `CONFIG_DRIFT` (จาก portal ของร้าน) และ `CONFIGURATION_DRIFT` (จาก configuration check)
4. เบอร์โทรและอีเมลติดต่อฝังเป็นค่าคงที่ใน `plan-term.logic.ts`
5. เอกสารภาษี (ใบกำกับ/ใบเสร็จ/ใบลดหนี้) ทั้งหมดออกโดย Stripe — ระบบไม่เก็บ PDF เอง; หลังปิดบัญชี Stripe เอกสารจะเข้าถึงไม่ได้จากระบบนี้

---

## 21. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

- การขาย add-on ให้ลูกค้าผ่าน Stripe (`CHAT_50/100/300`, `RECEIPT_IMAGE_20/50/100`) — มีราคาและโครงข้อมูล แต่ไม่มีเส้นทางซื้อ; แจกได้เฉพาะโดยผู้ดูแล/งานอีเวนต์
- ส่วนลดงานแบบเครดิต (`CREDIT` path) — ถอนไว้
- ทดลองใช้ฟรีอัตโนมัติสำหรับผู้สมัครใหม่ (`FREE_TRIAL_15` ยังมอบด้วยมือได้ แต่ไม่ได้เปิดให้สมัครเอง)
- เปลี่ยนแพ็ก/ยกเลิกผ่าน Stripe Customer Portal (`portal_change_plan`) — ปิดถาวร
- หน้า `/system/executive/compare` — ถูกถอด (redirect)
- หน้า `/system/users` — รวมเข้ากับ `/system/partners`
- Permission/เครื่องมือ release และ cutover (`system.release_operation.*`, `system.admin.cutover.*`), launch gate (`system.launch_gate.*`), identity reconciliation, entitlement exception — เครื่องมือปฏิบัติการของแพลตฟอร์ม ไม่ใช่ฟีเจอร์ที่ขาย
- โมดูล `crm`, `crm-inbox`, `inventory`, `procurement`, `banking`, `ledger` ฯลฯ ไม่อยู่ในพื้นที่ของเอกสารนี้ — สถานะการขายของแต่ละเมนูดูจาก `TIER_FEATURE_PRESETS` ในเอกสาร SRS ของ entitlement





