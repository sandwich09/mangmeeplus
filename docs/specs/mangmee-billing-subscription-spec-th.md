# ระบบจ่ายเงินและ Subscription (จำกัดการใช้ใบเสร็จ) — Spec P26

สถานะ: **DRAFT — กลไกครบ, ตารางราคา (§8) รอ Owner อนุมัติก่อนเริ่ม implement** (ตามหัวข้อ P26 ของแผนหลัก: "Spec + pricing ที่ Owner อนุมัติ" เป็นขั้นแรก); แผนส่งมอบเขียนตอนเข้าคิว

ที่มา: การตัดสินใจ Owner 2026-08-25 — จำกัดการใช้ใบเสร็จต่อบริษัท ใช้ต่อต้อง subscribe; กติกาแม่อยู่ [แผนหลัก P26 + §13.8](../plans/mangmee-brain-2-5-day-priority-plan-th.md)

หลักฐานโค้ดอ้างอิง `develop` (สำรวจเชิงลึก 2026-08-26)

เอกสารแม่: [ai-usage-metering-and-monthly-budget-spec](ai-usage-metering-and-monthly-budget-spec.md) (มิเตอร์เงิน — implement แล้ว), [per-company-ai-budget-override-spec](per-company-ai-budget-override-spec.md) (rate override — ยัง proposed), [feature-entitlement-decoupling-spec](feature-entitlement-decoupling-spec.md)

## 1. เป้าหมาย

ขายเป็นแพ็กเกจ "จำนวนใบเสร็จที่ให้ AI อ่านต่อเดือน" ได้จริง โดย:

1. มีมิเตอร์นับ "ใบ" ที่ตรวจสอบได้และไม่โกงลูกค้า (retry/replay ไม่นับซ้ำ)
2. เลือกแพ็กเกจแล้วสิทธิ์ตรงตามแพ็กเกจจริง (ปิด PLATFORM-01)
3. จ่าย/ต่ออายุ/ใบกำกับภาษีฝั่ง Mangmee ครบ
4. โควตาเต็ม = **AI หยุดอ่านใบใหม่เท่านั้น** — เอกสารลูกค้าไม่หาย อัปโหลด/กรอกเองได้เสมอ ข้อมูลเดิมอ่านได้เสมอ

## 2. หลักการที่ห้ามละเมิด (ยกจากแผนหลักคำต่อคำ + เพิ่มจากหลักฐาน)

1. **ห้ามเปิด enforcement ก่อน** meter + หน้าชำระเงิน + ข้อความแจ้งล่วงหน้า ใช้งานได้จริงครบทั้งสาม
2. **ห้ามนับ retry/replay เป็นโควตา** และห้ามทำเอกสารหายเมื่อโควตาเต็ม (§13.8 ข้อ 4)
3. **ห้ามปน billing ledger ของ Mangmee เข้ากับบัญชี ERP ของลูกค้า** — ใบเสร็จค่าบริการ Mangmee อยู่ระบบบัญชีของ Mangmee เอง ไม่สร้าง `AccountingDocument`/`ExpenseRecord` ในบริษัทลูกค้า
4. Enforcement ทุกจุดต้อง fail-open ต่อ "งานเอกสาร" และ fail-closed เฉพาะ "การเรียก AI" — upload intent (`InitReceiptUploadUseCase`) **ไม่ตรวจโควตา** โดยเจตนา
5. เงินคิดเป็นสตางค์/Decimal เท่านั้น; เดือน = Bangkok month key เดียวกับมิเตอร์เงินที่ใช้อยู่ (`bangkokMonthKey` — `company-ai-usage-meter.ts:37`)

## 3. Current truth (สำรวจ 2026-08-26)

### 3.1 ของที่มีจริงแล้ว (นำมาใช้ต่อ ไม่สร้างซ้ำ)

| ส่วน | หลักฐาน | ใช้กับ P26 อย่างไร |
|---|---|---|
| **มิเตอร์เงิน AI ต่อบริษัท implement ครบ** (แม้ header spec ยังเขียนว่า proposed — stale): `AiUsageEvent`/`CompanyAiMonthlyUsage`/`AiFxRate`/`PlatformAiBudgetConfig` + `CompanyAiConfiguration.monthlyBudgetSatang`; admission แบบ Redis lease ต่อบริษัท/เดือน; fail-closed `AI_BUDGET_UNAVAILABLE` | `schema.prisma:2949-3011`; `company-ai-usage-meter.ts:95-278` | โครง meter/เดือน/lease/upsert เป็นแบบให้มิเตอร์นับใบ (F-BILL-1) ลอกได้ทั้งชุด |
| เตือน 80%/100% แบบ exactly-once ต่อเดือน (security event HIGH, CloudWatch จับอยู่) | `company-ai-usage-meter.ts:196-203,359-372`; `security-event.ts:34,41` | pattern เดียวกันสำหรับ `quota_warning/quota_exhausted` |
| จุดรวมการอ่านใบเสร็จทุกช่องทาง (web+LINE) พร้อม rate limit + budget admission | `receipt-ocr.client.ts:22-41,79` | จุดตัดสินโควตาใบ (F-BILL-4) เสียบที่นี่จุดเดียว |
| Seam ปฏิเสธสุภาพบน LINE + audit DENIED มีแบบอยู่แล้ว | `process-line-webhook.use-case.ts:3448-3457` | ข้อความ "โควตาเดือนนี้เต็ม" ฝั่ง LINE ใช้ template นี้ |
| Entitlement flip ต่อบริษัท: CAS + epoch + `EntitlementCommand/Transition` append-only + audit HIGH ใน tx เดียว + `grantOrigin` มีคอลัมน์รอ | `set-partner-features.use-case.ts:247-579`; `schema.prisma:2926-2934,7534,7550` | package→entitlement (F-BILL-2) เขียนผ่านทางนี้ ไม่สร้าง path ใหม่ |
| Override + audit pattern ระดับ CRITICAL (before/after values, ceiling ไม่ clamp, grandfather ชัด) | `set-partner-ai-model.use-case.ts:38-115` | ลอกให้ per-company quota override (F-BILL-6) |
| Notification machinery (`NotificationRule/Event/Recipient/Delivery/Preference`) | `schema.prisma:1339-1431` | เตือน Owner 80/100% (F-BILL-5) ขี่ของเดิม |
| Kill switch pattern `BLOCK_NEW_ROOT` | `expense-launch-gate.ts`, `launch-gate.guard.ts:98` | ปิด enforcement ได้ใน 15 นาที (F-BILL-6) |
| โทนข้อความเตือนแบบไม่ block (แบนเนอร์ 1.8M ของสมุด) | [ledger spec §7.9 ข้อ 6](mangmee-income-expense-ledger-spec-th.md) | โทนเดียวกันสำหรับ 80% |

### 3.2 ของที่ **ไม่มีเลย** (ยืนยัน NOT FOUND ทุกรายการ)

1. **มิเตอร์นับใบ (document-work-unit)** — ไม่มี model/โค้ดใด ๆ; unique `(companyId, attachmentId, operationKind)` ตาม §13.8 ข้อ 3 ยังเป็นเพียงข้อความในแผน; ตาราง guard ของแผนระบุ "ยังไม่มี canonical meter"
2. **Package/Plan/Subscription/Pricing model** — ไม่มีทั้ง schema/constants (ที่ชื่อคล้าย `TaxFilingPackage` เป็นเรื่องแบบภาษี ไม่เกี่ยว)
3. **Payment provider** — ไม่มี SDK/integration ใด ๆ ในทั้ง repo (ตรวจ stripe/omise/gbprime/2c2p/promptpay แล้ว)
4. **PLATFORM-01 ยืนยันคาที่เดิม**: `modulePackage` เป็น string โชว์เฉย ๆ 10 จุด (`schema.prisma:2895` → onboarding `:338` → audit metadata) ส่วน entitlement เกิดจาก `DEFAULT_ENABLED_FEATURE_KEYS` เท่ากันทุกแพ็กเกจ (`create-company-onboarding.use-case.ts:293-296`)
5. Quota UI ฝั่งลูกค้า/Owner + product events `quota_warning/quota_exhausted/subscribe_*` — ไม่มี (metering spec จงใจ defer)
6. Gap ข้างเคียงที่พบระหว่างตรวจ (บันทึกไว้ ไม่ใช่งาน P26): seam ที่ 5 `ai-gateway-draft.provider.ts` ยังไม่ผ่าน budget admission ทั้งที่ spec แม่ §7.5 สั่งไว้ (BILL-GAP-A)

## 4. Gap register

| ID | ปัญหา | แก้ใน |
|---|---|---|
| BILL-01 | ไม่มีมิเตอร์นับใบ → ขายเป็นจำนวนใบไม่ได้ ตอบลูกค้าไม่ได้ว่าใช้ไปเท่าไร | F-BILL-1 |
| BILL-02 | PLATFORM-01: แพ็กเกจไม่ใช่ของจริง | F-BILL-2 |
| BILL-03 | ไม่มีทางรับเงิน/ต่ออายุ/เอกสารภาษีฝั่ง Mangmee | F-BILL-3 |
| BILL-04 | ไม่มี enforcement (และดีแล้ว — ห้ามมีจนครบเงื่อนไข §2.1) | F-BILL-4 |
| BILL-05 | Owner มองไม่เห็นยอดใช้/เพดาน/วัน reset | F-BILL-5 |
| BILL-06 | ไม่มี override/kill switch สำหรับ enforcement | F-BILL-6 |
| BILL-GAP-A | seam `ai-gateway-draft.provider.ts` ไม่เข้า budget admission (หนี้จาก spec metering §7.5) | งานแทรกเล็กก่อน/พร้อม F-BILL-1 |

## 5. ขอบเขต (F-BILL-1..6 ตามลำดับงาน P26 เป๊ะ)

### F-BILL-1 มิเตอร์นับใบ (durable document-work-unit)

- Model ใหม่ `DocumentWorkUnit`: `companyId, attachmentId, operationKind ('receipt_ocr' ก่อน), monthKey (Bangkok), expenseId?, firstAdmittedAt, sourceRoute` + **`@@unique([companyId, attachmentId, operationKind])`** (ตาม §13.8 ข้อ 3 คำต่อคำ) + aggregate `CompanyDocumentMonthlyUsage` (`@@unique([companyId, monthKey])`, `unitCount`) — โครงเดียวกับคู่ `AiUsageEvent`/`CompanyAiMonthlyUsage` ที่พิสูจน์แล้ว
- **นิยาม "1 ใบ"**: attachment หนึ่งไฟล์ที่ผ่าน admission ให้ AI อ่านสำเร็จครั้งแรก ต่อ operationKind — upsert ด้วย unique ข้างบน: ครั้งแรก insert + increment aggregate; retry/replay/extract ซ้ำของ attachment เดิม = no-op (**ไม่นับซ้ำโดยโครงสร้าง ไม่ใช่โดยวินัย**)
- จุดบันทึก: ใน `receipt-ocr.client.ts` หลัง admission สำเร็จ ก่อนเรียก provider (จุดเดียว ครอบทั้ง web+LINE) — transaction เดียวกับรูปแบบ `recordCompanyAiUsage`
- อ่านยอด: resolver เดียว คืน `{ used, limit, resetsOn (วันแรกเดือนถัดไป Bangkok), source: 'package'|'override' }`; ไม่มี limit (ยังไม่ enforce) → `limit: null`

### F-BILL-2 Package → entitlement จริง (ปิด PLATFORM-01)

- Model `BillingPackage` (versioned): `key, labelTh, monthlyDocumentLimit, featureKeys snapshot (subset ของ FEATURE_CATALOG), priceSatang?, status, version` — **ค่าจริงทุกช่องมาจากตาราง §8 ที่ Owner อนุมัติ**
- `CompanyBillingState`: `companyId unique, packageKey+packageVersion snapshot, effectiveFrom, overrideDocumentLimit?, grandfathered flag, updatedBy + audit`
- การใช้แพ็กเกจ = คำสั่งที่แปลงเป็น `PUT partner features` ชุดเดียวกับปัจจุบัน (idempotent commandId/CAS/epoch เดิม) โดยตั้ง `grantOrigin: 'package:<key>@<version>'` (คอลัมน์มีอยู่แล้ว) — **ไม่มี path เขียน entitlement ใหม่**
- onboarding: ช่อง `modulePackage` เปลี่ยนจาก string อิสระเป็นเลือกจาก `BillingPackage` และ seed entitlement ตาม snapshot (contract test เทียบทุก package กับสิทธิ์จริง — ตามวิธีปิดใน §13.3 PLATFORM-01)

### F-BILL-3 ชำระเงินและต่ออายุ

- **Payment provider = การตัดสินใจ Owner (§10 ข้อ 2)** — spec กำหนดเกณฑ์คัดเลือกแทนการเดา: รองรับ PromptPay + บัตร, recurring/renewal, ออกใบเสร็จ/ใบกำกับภาษีอิเล็กทรอนิกส์ฝั่งเราได้, webhook มี signature + retry, มี sandbox
- Flow: หน้า subscribe (เลือกแพ็กเกจ→ชำระ→ยืนยัน) → webhook ยืนยันเงิน (signature + idempotency ตาม pattern REVENUE-07: unique `(provider, externalTransactionId)` + payload hash) → ต่ออายุ `CompanyBillingState` → ออกเอกสารภาษีฝั่ง Mangmee (ระบบบัญชีของ Mangmee เอง — หลักการ §2.3)
- จ่ายไม่สำเร็จ/หมดอายุ: grace period (ค่าจาก §8) → ลดเป็นแพ็กเกจฟรี **ไม่ล็อกข้อมูล** (กติกา §2.2)

### F-BILL-4 Enforcement อ่อนโยน (เปิดได้เมื่อ §2.1 ครบเท่านั้น)

- จุดเดียว: `receipt-ocr.client.ts` — ก่อน admission เงิน เช็ค `used >= limit` → คืน `errorCode: 'DOCUMENT_QUOTA_EXCEEDED'` (ไม่แตะ rate/budget เดิม)
- ผลต่อผู้ใช้ per seam:
  - web upload (`InitReceiptUploadUseCase`): **ไม่ block** — ใบเข้าเป็น draft สถานะ "รอ AI อ่านเมื่อต่ออายุ/กรอกเองได้เลย" + banner
  - web extraction (`RequestReceiptExtractionUseCase`): ปุ่ม "ให้ AI อ่าน" เปลี่ยนเป็น disabled+เหตุผล (กติกา F-LED-7: บอกก่อนกด ไม่ให้กดแล้ว error)
  - LINE photo: ตอบสุภาพตาม template `:3448-3457` — "โควตาอ่านใบเสร็จเดือนนี้เต็มแล้วค่ะ ใบนี้เก็บไว้ให้แล้ว กรอกเองได้ที่ [ลิงก์] หรือต่ออายุที่ [ลิงก์]" + audit DENIED
- ข้อความทุกจุดต้องบอก 3 อย่าง: เก็บใบให้แล้ว (ไม่หาย), ทำเองต่อได้, ต่ออายุที่ไหน

### F-BILL-5 Owner เห็นยอดใช้

- หน้า settings "แพ็กเกจและการใช้งาน": ใบที่ใช้/เพดาน/วัน reset + แถบ % + ประวัติชำระ; แบนเนอร์ 80% (เหลือง โทนเดียวกับแบนเนอร์ 1.8M) และ 100% (แดง + CTA ต่ออายุ)
- เตือนผ่าน `NotificationRule` เดิม (trigger ใหม่ `billing.quota_warning/exhausted`) — LINE push ใช้ช่องแจ้งเตือนเดิม
- Partner console: การ์ดยอดใช้ใบ ข้าง ๆ การ์ด AI budget เดิม (`PartnerDetailPage.tsx:1167-1194` เป็นแบบ)

### F-BILL-6 ควบคุมและถอยกลับ

- Kill switch: flag `BILLING_ENFORCEMENT_ENABLED` (default off ทุก env จนผ่าน gate) + ปิดได้ภายใน 15 นาทีตามกติกา P3; ปิดแล้ว = ระบบนับมิเตอร์ต่อแต่ไม่ปฏิเสธใคร
- Override รายบริษัท: `overrideDocumentLimit` — pattern audit CRITICAL before/after ตาม `set-partner-ai-model.use-case.ts:82-115` เป๊ะ
- Product events 4 ตัวตามแผน: `quota_warning / quota_exhausted / subscribe_started / subscribe_succeeded` (security-event pattern เดิม)

## 6. สิ่งที่ไม่ทำในรอบแรก

- ขาย add-on รายใบ/top-up (รอพฤติกรรมจริง), หลายสกุลเงิน, ใบกำกับ e-Tax ฝั่ง Mangmee (ออก PDF ก่อนตามความสามารถจริง — ห้ามเรียก e-Tax จนเข้าเกณฑ์ OS spec §12.6), การคิดโควตากับ operationKind อื่น (statement/CRM AI — มิเตอร์รองรับด้วย operationKind อยู่แล้ว เปิดทีหลัง)

## 7. Invariants + tests

1. attachment เดิม + operationKind เดิม → นับ 1 เสมอไม่ว่าจะ retry/replay/สั่ง extract ซ้ำกี่ครั้ง (unit + concurrency test แบบเดียวกับ admission lease เดิม)
2. `Σ DocumentWorkUnit ต่อเดือน = CompanyDocumentMonthlyUsage.unitCount` (self-check)
3. quota เต็ม: upload สำเร็จ + draft อยู่ครบ + manual กรอกได้ + ข้อมูลเดิมอ่านได้ (E2E ทั้ง web และ LINE)
4. package apply = entitlement ตรง snapshot 100% ทุกแพ็กเกจ (contract test PLATFORM-01)
5. webhook ชำระเงินซ้ำ/replay → สถานะเดิม ไม่ต่ออายุซ้ำ ไม่ออกใบเสร็จซ้ำ
6. kill switch ปิด → ไม่มีการปฏิเสธใด ๆ ภายใน 1 tick; มิเตอร์ยังนับ
7. เดือนตัดที่ Bangkok midnight — เคสข้ามเดือน/ปี

## 8. ตารางราคา — **รอ Owner กำหนด (บล็อกการ implement ทั้ง spec)**

| ช่อง | ค่า |
|---|---|
| แพ็กเกจฟรี: อ่านได้กี่ใบ/เดือน | **TBD (Owner)** |
| แพ็กเกจจ่าย: ชื่อ/ราคา/จำนวนใบ (กี่ tier) | **TBD (Owner)** |
| ลูกค้าปัจจุบัน + Controlled Beta: จำกัดด้วยหรือ grandfathered (นานเท่าไร) | **TBD (Owner)** |
| Grace period หลังจ่ายไม่สำเร็จ | **TBD (Owner)** |
| Trial (ผูกกับ P24 §4 ข้อ 1) | **TBD (Owner)** |

## 9. หน้าจอ (กติกา F-LED-7 ทุกข้อ)

- S1 settings "แพ็กเกจและการใช้งาน" (F-BILL-5), S2 หน้า subscribe/ชำระ (3 ขั้น: เลือก→จ่าย→สำเร็จ; ปุ่มจ่าย disabled จนเลือกแพ็กเกจ+ยอมรับเงื่อนไข), S3 สถานะ quota ใน upload/review/LINE (F-BILL-4 copy ครบ 3 อย่าง), S4 partner console override — รายละเอียด wireframe เขียนในแผนส่งมอบตอนเข้าคิว (หลังราคาอนุมัติ)

## 10. คำถามที่ Owner ต้องตอบก่อนเริ่ม implement

1. **ตารางราคา §8 ทั้งตาราง** (ข้อบังคับจากแผนหลัก — "Spec + pricing ที่ Owner อนุมัติ")
2. **Payment provider**: ให้ผมประเมินเทียบ 3 เจ้าตามเกณฑ์ §F-BILL-3 แล้วเสนอ หรือคุณมีเจ้าที่ใช้อยู่แล้ว?
3. ใบกำกับภาษีค่าบริการฝั่ง Mangmee: ออกในนามบริษัทไหน ใครเป็นผู้ลงนาม/นักบัญชีฝั่ง Mangmee?
4. ยืนยันคิว: P26 เริ่มหลัง P27 จบ (ตามลำดับ §10 แผนหลัก: P14→P26 อยู่ก่อน "โตต่อได้" สายอื่น)?
