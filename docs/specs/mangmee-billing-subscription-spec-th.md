# ระบบจ่ายเงินและ Subscription (จำกัดการใช้ใบเสร็จ) — Spec P26

> **Implementation status — IN PROGRESS:** สถานะโค้ด, CI, งานที่ยังค้าง และข้อจำกัดล่าสุดอยู่ที่ [implementation status](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผล E2E และ source ที่ทดสอบดู [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); แยกผลจำลองออกจากผล native provider และไม่รวมจำนวนทดสอบที่ซ้ำกัน. ข้อความตามวันที่ด้านล่างเป็นประวัติของแต่ละช่วงงาน. ยังไม่ deploy; การ merge develop/main ต้องผ่าน CI และตรวจ scope ที่ค้างก่อน.


> **Owner amendment 2026-09-13:** [มติล่าสุด](mangmee-billing-pack-amendment-2026-09-12.md): ซื้อเริ่ม/จ่ายทันที, VAT OFF ปรับผ่าน Admin, upgrade จ่ายส่วนต่างเริ่มทันที/วันสิ้นรอบเดิม, downgrade สิ้นรอบที่จ่ายแล้ว, รายปีได้โควตา 12 เท่าทันที; ใช้หมดซื้อแพ็กเกจเต็มเพิ่ม ซื้อเฉพาะใบเป็น HIDDEN ตามมติล่าสุด: ซ่อนไว้ทุกช่องทางและยังไม่เปิดขาย. ซื้อแพ็กเกจเดิมซ้ำเพิ่มโควตาทันทีและต่ออายุจากวันหมดอายุเดิม; ยังไม่เปิดขายก่อน readiness. ไม่มี deploy; full paid E2E ยัง IN PROGRESS.

> **ขอบเขต merge 2026-09-11: เอกสารเท่านั้น** — ผล runtime repair/test ที่อ้างเป็นหลักฐานจาก branch งานแยก ยังไม่ใช่การนำโค้ดนั้นเข้า main/develop. ดู [สถานะส่งมอบเอกสาร](../agent-memory/billing-spec-docs-merge-2026-09-11.md).

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](../plans/mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

> **Controls 1–8 / no-deploy design 2026-09-11:** [C01–C08 spec](mangmee-billing-controls-spec-th.md) และ [implementation/CT01–CT32 plan](../plans/mangmee-billing-controls-plan-th.md) ครอบคลุมoverview, issue queue, safe repair, permissions, versioned policies, action gates, reconciliation และaudit/temporary overrides. Routine settingsผ่านเว็บหลังinitialimplementation; web/LINE/marketingอ่านapprovedrevisionเดียวกัน. ปิดขายใหม่ไม่หยุดpaid apply/recovery; rich menuเก่าต้องกลับไปstatus/supportได้. Target control suiteยังไม่implemented/NOT RUN; currentrepair evidenceแยกจากStripe/native acceptance.

> **LINE + web UI design 2026-09-11:** เพิ่ม [journey / U01–U12 / wireframes / target API](mangmee-line-web-billing-ui-spec-th.md) และ [แผน LB01–LB20](../plans/mangmee-line-web-billing-ui-plan-th.md). LINE payment ใช้ LIFF ยืนยันคนกด/เลือกบริษัท → handoff ไป app browser → Stripe ชุดเดียวกับเว็บ. ต้องแก้ expiry-scoped LINE recovery และรักษา billing return ผ่าน login; ปุ่ม LINE ปัจจุบันยังเป็นคำขอให้แอดมิน. Design เท่านั้น, runtime และ provider/device E2E ยัง NOT RUN.

> **Postmark / Stripe document decision 2026-09-11:** Owner เลือก Postmark สำหรับ app transactional mail และใช้ Receipt ค่า Postmarkลงบัญชีบริษัทเรา. **Invoice/Receipt ให้ลูกค้ามั่งมีใช้ Stripe สร้างและส่งโดยตรง** ตาม [provider spec §7](mangmee-transactional-email-provider-spec-th.md) และ [M3/EM10–EM17](../plans/mangmee-transactional-email-provider-plan-th.md). ไม่สร้าง PDF/เลขเอกสารคู่ขนานหรือส่ง receipt ซ้ำผ่าน Postmark; paid unlock ไม่รอ email. B06 ส่วนภาษี/ข้อมูลผู้ขายผู้ซื้อยัง OPEN; custom Thai tax/e-Tax deferred. Provider selectionปิดแล้ว แต่ Postmark/Stripe runtime acceptanceยังไม่ผ่าน.

สถานะปัจจุบัน: **STRIPE IMPLEMENTATION IN PROGRESS / LOCAL SIMULATION CHECKPOINTS PASS 2026-09-14**. รายละเอียด exact source, CI และงานค้างอยู่ใน implementation notice/agent memory; บันทึก S-pre ด้านล่างเป็นประวัติวันที่2026-09-11. Owner เลือก Stripe card auto-renew แทน K BIZ + EasySlip. ราคา paid 249/499/999/1,999 บาทต่อเดือนและ trial `FREE_TRIAL_15` ตาม §8 คงเดิม; paid offers disabled. B01/B02/B09 อัปเดตเฉพาะขอบเขต package amendment; ส่วนที่ยัง OPEN ต้องตัดสินก่อนเปิด behavior นั้น. งานรอบนี้แก้ความถูกต้องของฐานเดิมและพิสูจน์ simulation ไม่เปิดรับเงินจริงหรือ deploy.

ข้อกำหนดฝั่งเว็บไซต์ทางการ: [mangmee_web — Stripe billing](../../../mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md). เอกสารนี้เป็น source of truth ของ billing; ทั้งสอง repo ต้องเปลี่ยนราคา/สถานะขาย/ข้อความต่ออายุให้ตรงกันก่อนเปิดใช้.

สำหรับ developer: [Stripe API / event / object / testing reference](../research/stripe-developer-reference-th.md) รวบรวม official docs ที่ตรวจ 2026-09-10 พร้อม mapping เข้ากับ P26; อ่านร่วมกับแผน implementation ไม่ใช่หลักฐานว่า integration ผ่านแล้ว.

**Readiness review 2026-09-10:** ยังไม่มี Stripe runtime integration หรือ Stripe E2E ที่ผ่าน. เพิ่มข้อกำหนดปลดล็อก/รับมือ failure ใน §11–12 และ [แผน implementation + ทดสอบ](../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md) พร้อม business decision register; ผลตรวจเอกสารไม่ใช่ผลทดสอบการรับเงิน. พบ recovery gap ใน manual renew เดิมที่ต้องปิดก่อน reuse (หลักฐานในแผน).

**Historical red run 2026-09-11:** ทดสอบ existing web/API/DB จริงโดยจำลองผลจ่ายและใช้ manual-renew driver: browser ผ่าน 6/8, PostgreSQL recovery probes ผ่าน 1/4. พบ blockers R01/R02/R03/R05/R06; ยังไม่พร้อม reuse โดยตรงและไม่ใช่ Stripe E2E. ดู [ผลและคำสั่งรันซ้ำ](../evidence/stripe-readiness-2026-09-11/README.md).

**Executed repair 2026-09-11:** Owner ให้ลงมือและปิด proof loop. R01/R02/R03/R05/R06 แก้แล้ว; R07 มี fault-injection proof; R04 pricing bundle แก้แล้ว. [หลักฐานล่าสุด](../evidence/stripe-repair-2026-09-11/README.md): browser 20/20, PG 15/15, focused 198/198, marketing desktop/mobile ผ่าน. §14–15 และแผน §9 สอดคล้องกับ runtime ปัจจุบัน. ขณะ checkpoint S-pre นี้ยังไม่มี Stripe adapter; implementation และหลักฐานหลัง2026-09-12อยู่ใน integration evidence แยกต่างหาก.

ที่มา: การตัดสินใจ Owner 2026-08-25 — จำกัดการใช้ใบเสร็จต่อบริษัท ใช้ต่อต้อง subscribe; กติกาแม่อยู่ [แผนหลัก P26 + §13.8](../plans/mangmee-brain-2-5-day-priority-plan-th.md)

หลักฐานโค้ดอ้างอิง `develop` (สำรวจเชิงลึก 2026-08-26)

เอกสารแม่: [ai-usage-metering-and-monthly-budget-spec](ai-usage-metering-and-monthly-budget-spec.md) (มิเตอร์เงิน — implement แล้ว), [per-company-ai-budget-override-spec](per-company-ai-budget-override-spec.md) (rate override — ยัง proposed), [feature-entitlement-decoupling-spec](feature-entitlement-decoupling-spec.md)

## 1. เป้าหมาย

ขายเป็นแพ็กเกจ "จำนวนใบเสร็จที่ให้ AI อ่านต่อเดือน" ได้จริง โดย:

1. มีมิเตอร์นับ "ใบ" ที่ตรวจสอบได้และไม่โกงลูกค้า (retry/replay ไม่นับซ้ำ)
2. เลือกแพ็กเกจแล้วสิทธิ์ตรงตามแพ็กเกจจริง (ปิด PLATFORM-01)
3. จ่าย/ต่ออายุและ Invoice/Receipt ผ่าน Stripe ครบ; ภาษีและข้อมูลนิติบุคคลตาม B06 โดยไม่อ้างว่า Stripe document เป็น Thai tax/e-Tax อัตโนมัติ
4. โควตาเต็มขณะบริษัทยังมีสิทธิ์ใช้งาน = **AI หยุดอ่านใบใหม่เท่านั้น** — เอกสารลูกค้าไม่หาย อัปโหลด/กรอกเองและอ่านข้อมูลเดิมได้; การหมดอายุสมาชิกเป็นคนละเหตุและต้องใช้กติกา P29/§5 F-BILL-3

## 2. หลักการที่ห้ามละเมิด (ยกจากแผนหลักคำต่อคำ + เพิ่มจากหลักฐาน)

1. **ห้ามเปิด enforcement ก่อน** meter + หน้าชำระเงิน + ข้อความแจ้งล่วงหน้า ใช้งานได้จริงครบทั้งสาม
2. **ห้ามนับ retry/replay เป็นโควตา** และห้ามทำเอกสารหายเมื่อโควตาเต็ม (§13.8 ข้อ 4)
3. **ห้ามปน billing ledger ของ Mangmee เข้ากับบัญชี ERP ของลูกค้า** — ใบเสร็จค่าบริการ Mangmee อยู่ระบบบัญชีของ Mangmee เอง ไม่สร้าง `AccountingDocument`/`ExpenseRecord` ในบริษัทลูกค้า
4. Quota enforcement ต้องไม่ block "งานเอกสาร" และปฏิเสธเฉพาะ "การเรียก AI" — upload intent (`InitReceiptUploadUseCase`) **ไม่ตรวจโควตา AI** โดยเจตนา; ไม่ข้าม company status, membership, security หรือ term-expiry checks
5. เงินคิดเป็นสตางค์/Decimal เท่านั้น; เดือน = Bangkok month key เดียวกับมิเตอร์เงินที่ใช้อยู่ (`bangkokMonthKey` — `company-ai-usage-meter.ts:37`)

## 3. หลักฐานฐานเดิม (สำรวจ 2026-08-26 — ไม่ใช่สถานะ implementation ปัจจุบัน)

**Delta 2026-09-08:** trial/plan term และ receipt allowance มี implementation แล้ว; ใช้ [onboarding/trial fixes 2026-09-07](onboarding-trial-receipt-fixes-spec.md) และ `packages/contracts/src/plan-term.ts` เป็น current baseline. ตารางและรายการ NOT FOUND ด้านล่างเป็นหลักฐานวันที่ 2026-08-26 เท่านั้น ต้องตรวจซ้ำตอนทำแผน implementation P26 โดยเฉพาะ meter/admission/compensation ที่มีแล้ว ห้ามสร้างซ้ำหรือย้อนกติกา "อ่านล้มเหลวไม่กินโควตา". การเปลี่ยน provider ครั้งนี้ตรวจไม่พบ Stripe/EasySlip integration ใน `apps/` และ `packages/`; ไม่ได้ตรวจ cloud/deployment.

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
4. **PLATFORM-01 delta 2026-09-11**: self-signup ส่ง `modulePackage='starter'` และ onboarding seed `FEATURE_PACKAGE_PRESETS.starter` จริงแล้ว (7 เมนู/17 keys); ไม่ใช่ display-only หรือ DEFAULT_ENABLED ทุกกรณี. ส่วน paid package version→provenance/entitlement apply ผ่าน Stripe ยังไม่ implemented; ใช้ [package amendment](mangmee-package-entitlements-spec-th.md) ไม่ยก legacy admin default มาเป็น trial.
5. Quota UI ฝั่งลูกค้า/Owner + product events `quota_warning/quota_exhausted/subscribe_*` — ไม่มี (metering spec จงใจ defer)
6. Gap ข้างเคียงที่พบระหว่างตรวจ (บันทึกไว้ ไม่ใช่งาน P26): seam ที่ 5 `ai-gateway-draft.provider.ts` ยังไม่ผ่าน budget admission ทั้งที่ spec แม่ §7.5 สั่งไว้ (BILL-GAP-A)

## 4. Gap register (snapshot 2026-08-26; revalidate ตาม delta §3)

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
- **นิยามเป้าหมาย "1 ใบ"**: attachment ที่อ่านและบันทึกผลใช้ได้สำเร็จครั้งแรก ต่อ operationKind; retry/replay ของงานเดิมต้องไม่นับซ้ำ. ก่อนย้ายไป document-work-unit ต้อง reconcile deliberate re-read กับกติกาปัจจุบันใน [onboarding/trial fixes](onboarding-trial-receipt-fixes-spec.md#issue-4--failed-receipt-reading-does-not-spend-allowance) ไม่เปลี่ยนพฤติกรรมเงียบ ๆ
- Admission ก่อนเรียก provider เป็นการกันโควตาชั่วคราว; งานล้มเหลวต้องคืน admission ของ attempt/เดือนเดิมครั้งเดียวตามกลไก compensation ที่มีแล้ว. ห้ามถือว่า admission สำเร็จหรืออัปโหลดรูปสำเร็จเท่ากับอ่านสำเร็จ; reuse ledger/lock เป็นทางเลือกแรกก่อนเพิ่ม model ข้างต้น
- อ่านยอด: resolver เดียว คืน `{ used, limit, resetsOn (วันแรกเดือนถัดไป Bangkok), source: 'package'|'override' }`; ไม่มี limit (ยังไม่ enforce) → `limit: null`

### F-BILL-2 Package → entitlement จริง (ปิด PLATFORM-01)

- Model `BillingPackage` (versioned): `key, labelTh, monthlyDocumentLimit, featureKeys snapshot (subset ของ FEATURE_CATALOG), priceSatang?, status, version` — **ค่าจริงทุกช่องมาจากตาราง §8 ที่ Owner อนุมัติ**
- `CompanyBillingState`: `companyId unique, packageKey+packageVersion snapshot, effectiveFrom, overrideDocumentLimit?, grandfathered flag, updatedBy + audit`
- การใช้แพ็กเกจ reuse application service/transaction ของ partner features (idempotent commandId/CAS/epoch เดิม) พร้อม package grant provenance — **paid worker ไม่เรียก `PUT partner features` หรือ admin HTTP route**. ใช้ service identity และ atomic invoice apply ตาม owned design; preserve explicit overrides.
- onboarding: ช่อง `modulePackage` เปลี่ยนจาก string อิสระเป็นเลือกจาก `BillingPackage` และ seed entitlement ตาม snapshot (contract test เทียบทุก package กับสิทธิ์จริง — ตามวิธีปิดใน §13.3 PLATFORM-01)

<a id="billing-stripe"></a>
### F-BILL-3 ชำระเงินและต่ออายุ — Stripe

**มติ Owner 2026-09-08 / ขยาย 2026-09-11:** ใช้ **Stripe Payments + Billing + hosted Checkout** สำหรับบัตรและสมาชิกแบบรายเดือนหรือรายปีต่อบริษัทตาม [package amendment](mangmee-package-entitlements-spec-th.md); ใช้ **Customer Portal** สำหรับจัดการบัตร/ใบเรียกเก็บ/สมาชิกตาม approved capabilities. แทนแนวทาง K BIZ Thai QR + EasySlip วันที่ 2026-08-29 ทั้งหมดสำหรับค่าบริการ Mangmee. เป็น direct SaaS billing ของ Mangmee; ไม่ใช้ Connect เพื่อรับเงินแทนร้านลูกค้า.

#### Journey และขอบเขตสอง repo

- `mangmee_web` แสดงแพ็กเกจและสถานะที่ซื้อได้ แล้วส่งผู้ใช้เข้าแอป Mangmee เพื่อ login/เลือกบริษัท; หน้า marketing ไม่รับเลขบัตร ไม่สร้าง subscription และไม่เปิดสิทธิ์เอง. ข้อความช่วง planned ต้องระบุ “เร็ว ๆ นี้”; ห้ามอ้างว่าตัดบัตรได้แล้ว.
- ผู้มีสิทธิ์ OWNER ของบริษัทเลือก paid offer → backend ตรวจ membership/company/billing gate และ snapshot offer/version, THB, ราคาเป็นสตางค์ → map ไป Stripe recurring Price ที่ระบบกำหนด → สร้าง hosted Checkout `mode=subscription` ด้วย idempotency key ของ attempt → ลูกค้ายินยอมการต่ออายุและกรอกบัตรบน Stripe.
- ยอดรวมจริง (รวมภาษีตามนโยบายที่จะอนุมัติ), รอบรายเดือน, วันตัดเงินครั้งแรก/ครั้งถัดไป และเงื่อนไขยกเลิกต้องชัดก่อนยืนยัน. Frontend ส่งเพียง offer intent; ห้ามรับ price/customer/subscription ID หรือยอดจาก client เป็นหลักฐานความเป็นเจ้าของ/ราคา.
- Return/cancel จาก Checkout ให้หน้าแอปอ่าน billing state จาก backend: pending/สำเร็จ/จ่ายไม่ผ่าน/ต้องยืนยันบัตร/ยกเลิก checkout. การกลับ success URL หรือ `checkout.session.completed` อย่างเดียวไม่ใช่หลักฐานต่อสิทธิ์.
- Backend รับผลยืนยันที่ตรวจแล้ว → apply package ผ่าน entitlement/plan-term application logic เดิม → ผูก Invoice/Receipt ที่ Stripe สร้างกับบริษัทผู้ซื้อให้ดู/ดาวน์โหลดได้ แยกจาก ERP ลูกค้า; ไม่สร้าง PDF/เลขเอกสารซ้ำในแอป. การยกเลิกหน้า Checkout ไม่เท่ากับยกเลิก subscription ที่มีอยู่.
- Portal session ต้องสร้างฝั่ง backend หลังตรวจ OWNER และผูกกับ Stripe Customer ของบริษัทที่เลือกเท่านั้น; return URL อยู่ใน allowlist. เปิดการเปลี่ยน/ยกเลิกแพ็กเกจเฉพาะ policy ที่ผ่าน §10; เอกสารจาก Stripe ไม่ถือเป็นใบกำกับภาษีไทยของ Mangmee โดยอัตโนมัติ.

#### Source of truth และ webhook

- Stripe เป็นหลักฐานการเรียกเก็บเงิน/สถานะ subscription; Mangmee เป็นผู้ตัดสินสิทธิ์บริษัท/แพ็กเกจ/โควตา. เก็บ mapping แบบ durable ต่อ company + environment: Customer, Subscription, offer/version/Price, paid-through period และ invoice ที่ apply แล้ว. หนึ่งบริษัทมี base subscription ที่มีผลได้หนึ่งรายการ; การสมัครซ้ำ/concurrent checkout ต้องไม่เก็บเงินซ้ำ (รวม reuse/expire attempt เดิม).
- ตรวจ `Stripe-Signature` กับ raw body และ secret ของ environment; ปฏิเสธ event ผิด account/mode หรือ mapping ไม่ตรง company. Secrets อยู่ backend เท่านั้น; ไม่เก็บเลขบัตร/CVC ในระบบ Mangmee.
- รับ event ลง durable inbox/outbox ก่อนตอบสำเร็จ; dedupe event ID และ invoice ID แยกกัน. `invoice.paid` ใช้ต่อสิทธิ์ได้เมื่อยืนยันว่าเป็น subscription invoice/offer/currency/ยอดตามกติกาที่อนุมัติของบริษัทนั้นจริง; invoice ฟรีจาก trial หรือ invoice อื่นต้องไม่ให้สิทธิ์ paid โดยอัตโนมัติ.
- ใช้ `invoice.payment_failed`, `invoice.payment_action_required` และ `customer.subscription.updated/deleted` เพื่อสะท้อนสถานะจริง; event ซ้ำ มาช้า หรือสลับลำดับต้องไม่ต่อสิทธิ์/ออกเอกสารซ้ำ และ event เก่าต้องไม่ย้อน paid period หรือสถานะล่าสุด. ตรวจสถานะ Stripe ล่าสุดเมื่อจำเป็นและมี reconciliation/replay จากหลักฐาน durable สำหรับ webhook ตกหล่นหรือ apply ล้มเหลว.
- ต่อรอบจาก paid service period ที่ Stripe ยืนยัน ไม่ใช้เวลารับ webhook หรือบวก 30 วันทุกครั้ง. คง quota เดือนปฏิทิน Bangkok ตาม baseline; การจ่ายเงิน/ส่ง webhook ซ้ำไม่ reset โควตา. Trial/admin manual term ยังคงนับวันชั่วโมงจริงตาม P29.
- การจ่ายสำเร็จต้องไม่ปลด admin-disable, SUSPENDED หรือ ARCHIVED; การเปิดคืนอัตโนมัติทำได้เฉพาะ term-expired ตามกติกา P29. เส้นดูสถานะ/แก้บัตร/ต่ออายุต้องเข้าถึงได้สำหรับ OWNER ที่ยืนยันตัวตนแม้ term หมด โดยไม่เปิด business routes หรือข้าม security hold.

#### Trial, failed payment และเปิดใช้

- Trial ปัจจุบันใช้ `FREE_TRIAL` → `FREE_TRIAL_15` (§8), ไม่สร้าง payment attempt และไม่พึ่ง Stripe. **สมัคร trial ไม่ผูกบัตรตามมติ 2026-09-11; จังหวะคิดเงินเมื่อ opt-in paid และวัน trial ที่เหลือยัง TBD**; ห้ามการแก้ provider ทำให้ลูกค้า trial ถูกตัดเงินหรือเริ่ม trial ใหม่โดยอัตโนมัติ.
- จ่ายไม่ผ่าน/ต้องยืนยันบัตร: แจ้ง OWNER พร้อมทางแก้และ retry ตาม policy ที่จะอนุมัติ; grace duration, สิทธิ์ระหว่าง grace และหลัง retry หมดเป็น **TBD (§10)**. ไม่สมมติ 7 วันหรือ free fallback; กติกา trial/admin term ที่ใช้อยู่ใน P29 ไม่ถูกเปลี่ยนด้วย spec นี้.
- Integration mode แยกจาก offer availability: `DISABLED` เป็น default ไม่สร้าง checkout/portal สำหรับ billing ที่ยังปิด; `TEST` ใช้ Stripe sandbox/test mode และบริษัททดสอบที่แยกจากลูกค้าจริง; `LIVE` เปิดได้เมื่อ §10, mapping/account, signed webhook/replay/reconciliation, Stripe Invoice/Receipt + email settings และ end-to-end acceptance ผ่าน (B06 ภาษีที่ใช้จริงต้องชัด; custom e-Tax deferred). Test event ห้ามต่อสิทธิ์บริษัท live; การมี Stripe account/keys ไม่เปิดขายเอง.
- PromptPay ผ่าน Stripe เป็นช่องทางเสริมที่ **deferred**: ลูกค้าต้องสแกนใหม่แต่ละรอบ, ไม่ตัดอัตโนมัติ, Checkout subscription mode ไม่รองรับ; หากเพิ่มภายหลังต้องมี flow `send_invoice` และป้องกันชนกับการตัดบัตรเดิม. ไม่ใช่ fallback อัตโนมัติเมื่อบัตรจ่ายไม่ผ่าน.

อ้างอิงที่ตรวจ 2026-09-08: [Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [webhook verification/retries](https://docs.stripe.com/webhooks), [billing periods](https://docs.stripe.com/billing/subscriptions/billing-cycle), [Customer Portal](https://docs.stripe.com/customer-management), [Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries), [PromptPay limitations](https://docs.stripe.com/payments/promptpay).

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

- ขาย add-on รายใบ/top-up (รอพฤติกรรมจริง), หลายสกุลเงิน, custom Thai tax invoice/e-Tax ฝั่ง Mangmee (รุ่นแรกใช้ Stripe Invoice/Receipt; ไม่สร้าง PDF/เลขใหม่เอง และไม่เรียก e-Tax จนเข้าเกณฑ์), การคิดโควตากับ operationKind อื่น (statement/CRM AI — มิเตอร์รองรับด้วย operationKind อยู่แล้ว เปิดทีหลัง)

## 7. Invariants + tests

1. attachment เดิม + operationKind เดิม → นับ 1 เสมอไม่ว่าจะ retry/replay/สั่ง extract ซ้ำกี่ครั้ง (unit + concurrency test แบบเดียวกับ admission lease เดิม)
2. `Σ DocumentWorkUnit ต่อเดือน = CompanyDocumentMonthlyUsage.unitCount` (self-check)
3. quota เต็ม: upload สำเร็จ + draft อยู่ครบ + manual กรอกได้ + ข้อมูลเดิมอ่านได้ (E2E ทั้ง web และ LINE)
4. package apply = entitlement ตรง snapshot 100% ทุกแพ็กเกจ (contract test PLATFORM-01)
5. Stripe event/invoice ซ้ำ สลับลำดับ มาช้า หรือ webhook ตกหล่น/replay → ต่อ paid period ครั้งเดียวและอ้างเอกสาร Stripe เดิมโดยไม่สร้างซ้ำ; false signature/wrong account/test-live/cross-company/price tampering ต้องถูกปฏิเสธ; success redirect อย่างเดียวไม่เปิดสิทธิ์
6. kill switch P26 ปิด → หยุดการปฏิเสธจาก commercial enforcement ของ P26 ภายใน 1 tick; มิเตอร์ยังนับ และ security/term/operational guards เดิมยังทำงาน
7. เดือนตัดที่ Bangkok midnight — เคสข้ามเดือน/ปี
8. Checkout ซ้ำ/สองแท็บ/timeout ต้องไม่สร้าง base subscription หรือ charge ซ้ำ; cancel checkout, card decline, authentication required, first paid invoice, renewal และ portal กลับแอปแสดง backend state จริง
9. Paid period ตาม Stripe (รวมเดือนสั้น/วันสิ้นเดือน), ไม่ reset receipt usage เมื่อจ่ายซ้ำ; trial ไม่มี payment dependency และ renewal ไม่ปลด admin/security hold
10. Billing access สำหรับ OWNER ของบริษัทหมดอายุ, grace/cancellation/upgrade/refund และเอกสารภาษีต้องมี acceptance ตาม policy ที่ตกลงก่อน LIVE; ราคา/สถานะ/คำอธิบายบน `mangmee_web` ตรงกับแอปและ Stripe mapping

<a id="billing-offer-catalog"></a>
## 8. Offer catalog — ราคา paid 2026-08-30, trial 2026-09-05/07, provider Stripe 2026-09-08

Source ของราคา paid: เว็บ official commit `9d51823` (2026-08-30), แทนชุด 259/599/999/1299 เดิม. Trial ใช้ [External Signup §3A](mangmee-external-signup-contract-spec-th.md) และ [onboarding/trial fixes 2026-09-07](onboarding-trial-receipt-fixes-spec.md), default limits ตรง `PLAN_TIER_PRESETS`. `priceSatang` เป็น snapshot จำนวนเต็ม; ห้าม derive จาก label/client. ตารางนี้เป็น offer catalog ไม่ใช่ใบอนุญาตให้เปิดขาย; ภาษีรวมในราคาหรือบวกเพิ่มยัง TBD. ราคา/โควตาที่แสดงในเว็บต้องอ่านหรือเทียบกับ catalog นี้ก่อนเผยแพร่.

| offerKey | ชื่อบนเว็บ | ราคา/เดือน | priceSatang | เลือกใน auto-register ตอนนี้ | payment mode เมื่อเปิดจริง | quota/feature snapshot (จากเว็บ 2026-08-30) |
|---|---|---:|---:|---|---|---|
| `FREE_TRIAL` | ทดลองใช้ฟรี | ฟรี | 0 | **enabled — ทางเข้าเดียว** | `NONE` — ไม่เรียก Stripe/ไม่ผูกบัตร | `FREE_TRIAL_15` + starter7เมนู: 1 สาขา · ผู้ใช้รวม OWNER 2 คน · อ่านสลิป15ใบ/เดือนตั้งแต่วันแรก · default30วันจาก provision; admin override ตาม P29 |
| `STARTER_249` | เริ่มต้น (STARTER) | 249 บาท | 24,900 | **disabled — แสดง “เร็ว ๆ นี้”** | `STRIPE_CARD_SUBSCRIPTION` | 1 สาขา · พนักงาน 2 คน · อ่านสลิป 30 ใบ/เดือน |
| `BASIC_499` | เติบโต (BASIC) | 499 บาท | 49,900 | **disabled — แสดง “เร็ว ๆ นี้”** | `STRIPE_CARD_SUBSCRIPTION` | 2 สาขา · พนักงาน 5 คน · อ่านสลิป 50 ใบ/เดือน |
| `PRO_999` | มืออาชีพ (PRO) | 999 บาท | 99,900 | **disabled — แสดง “เร็ว ๆ นี้”** | `STRIPE_CARD_SUBSCRIPTION` | 5 สาขา · พนักงาน 10 คน · อ่านสลิป 100 ใบ/เดือน · บันทึกค่าใช้จ่าย+ใบเสร็จครบวงจร |
| `ENTERPRISE_1999` | ธุรกิจ (ENTERPRISE) | 1,999 บาท (preview) | 199,900 | **COMING_SOON_LOCKED — ห้ามจ่ายทั้ง month/year** | ยังไม่เปิดขาย; custom quote ห้าม bypass lock | 10 สาขา · ผู้ใช้รวม30คน · อ่านสลิป2,000ใบ/เดือน เป็น preview; ภ.ง.ด.53 +50ทวิ Coming soon ยังใช้ไม่ได้ |

รายปีที่ Owner เพิ่ม: STARTER **2,490**, BASIC **4,990**, PRO **9,990**, ENTERPRISE **19,990** บาท/ปี (Enterprise preview/locked). รายเดือน/รายปีใช้เพดานสาขา/ผู้ใช้เดิมตามตาราง รวม OWNER. Paidรายปีได้โควตาทั้งปี12เท่าทันที; ไม่ resetต้นเดือน. ซื้อแพ็กเกจเต็มซ้ำเพิ่มโควตาทันทีและต่ออายุจากวันหมดอายุเดิมตามมติ2026-09-13. ใช้ [canonical catalog และ7เมนู](mangmee-package-entitlements-spec-th.md) เป็นสัญญาร่วมกับ mangmee_web. STARTER/BASIC/PRO ยัง disabled จน readiness ผ่าน; generic sales-enable ไม่ปลด Enterprise. ไม่อนุมาน tax/proration policy จากราคา.

กติกาปัจจุบัน: ไม่มีการซื้อ/เลือก paid tier ตอน self-signup; ทุกช่องทางใช้ `FREE_TRIAL` และ provision `FREE_TRIAL_15`. `PRO_TRIAL` เป็น alias เก่าที่ normalize เป็น `FREE_TRIAL`; `requestedOfferKey` เป็น attribution เท่านั้น (P10 ยกเลิก `offer_not_available` แล้ว; key นอก catalog เป็น `null`). **การยอมรับ attribution ไม่ให้สิทธิ์ซื้อ**: checkout ในอนาคตต้องตรวจ paid availability/ราคา/OWNER แยกต่างหาก. `STRIPE_CARD_SUBSCRIPTION` เป็นชื่อ mode ใน spec ยังไม่มี runtime enum/integration. Trial ไม่ใช่ PRO ฟรีหรือแพ็กเกจฟรีถาวร.

ค่าที่ตอบแล้วและคำถามที่เหลือก่อนเปิด P26:

| ช่อง | ค่า |
|---|---|
| Trial (`FREE_TRIAL_15`): ระยะเวลา | default 30 วัน (ชั่วโมงจริง) จาก provision, config ต่อบริษัทได้ — กลไกอยู่ [P29 Company Plan Term](mangmee-company-plan-term-spec-th.md); เปลี่ยน trial tier ตามมติ 2026-09-05/07 |
| Trial: จำกัด "100 ร้านแรก" | ข้อจำกัดการรับสมัคร/auto-approve ใช้ [LINE-first signup](mangmee-line-first-signup-spec-th.md) ฉบับล่าสุด; ไม่เพิ่มหรือปลด cap ด้วยการเปลี่ยน provider เป็น Stripe |
| จบ trial แล้วเกิดอะไร | **ตอบแล้ว 2026-08-30:** ไม่ต่อ = disable บริษัทตรงเวลาวัน-ชั่วโมงจริงที่ครบกำหนด (ข้อมูลไม่หาย, renew โดยแอดมินแล้วกลับมาใช้ได้) — [P29](mangmee-company-plan-term-spec-th.md) §4B–4C |
| ลูกค้าปัจจุบัน + Controlled Beta: จำกัดด้วยหรือ grandfathered | **ตอบแล้ว (P29 §8 ข้อ 4):** ไม่มี term row = ไม่จำกัด จนกว่าแอดมินตั้งเอง; ไม่สร้าง Stripe subscription/ตัดบัตรให้ลูกค้าเดิมอัตโนมัติ |
| Grace period หลังจ่ายไม่สำเร็จ | **TBD (Owner)** — เกี่ยวเมื่อ P26 payment มา |
| งบ AI ของร้าน trial | **ตอบแล้ว 2026-08-30:** ใช้ default ของ platform ไปก่อน; ตอน convert เป็น paid งบเป็นบาทจะ**ไม่เท่าช่วง trial** — ต้องทำ break-even analysis (ต้นทุนอื่นนอกจาก AI) ก่อนตั้งเลขจริง |

## 9. หน้าจอ (กติกา F-LED-7 ทุกข้อ)

- S0 หน้า auto-register: free trial ชุดเดียวตาม §8 ไม่มีคำว่า PRO/ราคา; paid preview ถ้าแสดงต้อง disabled + “เร็ว ๆ นี้” พร้อม semantic disabled/เหตุผล. เว็บไซต์ทางการต้องแยก trial ออกจากการ์ด PRO paid เช่นกัน
- S1 settings "แพ็กเกจและการใช้งาน": ยอดใช้/วัน reset, paid-through/วันเรียกเก็บถัดไป, สถานะ subscription, ประวัติและทางเข้า Portal สำหรับ OWNER; loading/error/permission denied ต้องชัด
- S2 เลือกแพ็กเกจ → ตรวจยอด/เงื่อนไข → Stripe hosted Checkout → กลับแอปรอ backend ยืนยัน; ไม่เปิดจ่ายก่อน LIVE. สำรวจ routing แล้ว 2026-09-11: ใช้ [LINE + web UI spec](mangmee-line-web-billing-ui-spec-th.md) เป็น target routes/contracts, U01–U12 และ wireframes; endpoints ยังไม่ได้ implement
- S3 quota ใน upload/review/LINE และ S4 partner override ใช้ขอบเขตเดิม; หน้า term-expired ต้องมีทางเข้า billing สำหรับ OWNER เมื่อ integration เปิดแล้ว

## 10. มติที่ใช้ implement และเงื่อนไขเปิดใช้งาน

1. สมัคร trial ไม่ผูกบัตร: starter7เมนู/15ใบต่อเดือน/30วันตาม default. ยืนยันซื้อให้เริ่มและจ่ายทันที ไม่ทบวัน trial.
2. Stripe Payments/Billing + hosted Checkout สำหรับ card collection; Portal เปิดเฉพาะ payment-method update. แอปควบคุมซื้อซ้ำ/upgrade/downgrade/cancel/resume ตาม pack amendment; PromptPay deferred.
3. VAT ปัจจุบัน OFF เพราะบริษัทยังไม่จด VAT. Admin เปิดภายหลังด้วย inclusive/exclusive, issuer และ preview/independent approval; เอกสารเก่าไม่ถูกเปลี่ยน. รายละเอียดนิติบุคคล/บัญชี provider ต้องพร้อมก่อน LIVE.
4. Owner อนุญาต implement และ merge develop/main เมื่อ CI ผ่าน โดย **ไม่ deploy**. การเปิด customer gate/live rollout ต้องเป็นงานที่อนุญาตแยกตาม runbook.
5. Grace เริ่มต้น7วันสำหรับ renewal ลูกค้าที่เคยจ่าย พร้อมสิทธิ์เดิม/โควตาที่เหลือ ไม่ให้โควตาจาก unpaid invoice. หมด grace พักใช้และหยุด Stripe future debt; หนี้เก่า/refund/dispute ให้เจ้าหน้าที่ตรวจ.
6. ยกเลิกสิ้นรอบที่ซื้อไว้; ซื้อแพ็กเดิมซ้ำให้โควตาทันทีและต่อวันจาก expiry เดิม. รายปีได้12เท่าทันที; upgrade คิดส่วนต่างทุกช่วงที่เหลือและไม่ขยาย expiry, downgrade สิ้นรอบพร้อมเลือกสาขา/ผู้ใช้ที่จะคงไว้. Receipt-only HIDDEN; Enterprise/ภ.ง.ด.53/50ทวิ Coming soon และห้ามจ่าย.

ใช้ [pack amendment](mangmee-billing-pack-amendment-2026-09-12.md) และ [B01–B10/implementation plan](../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md) สำหรับสูตรและขอบเขตที่เหลือ. New easy-signup/passwordless E0 เป็นงานแยก; รักษา eligibility/approval ของ signup เดิม. ก่อน LIVE ต้องมี provider readiness/acceptance และตรวจราคา/CTA ทั้งสอง repo; การอนุมัติ spec ไม่ใช่การอนุญาต deploy.

## 11. จ่ายสำเร็จแล้วเปิดสิทธิ์อัตโนมัติ — acceptance ที่ต้องเกิดจริง

1. เปิดสิทธิ์ **บริษัทที่ซื้อและแพ็กเกจที่จ่าย** ให้สมาชิกที่มีสิทธิ์อยู่แล้ว; ไม่เปิด user ทั้งระบบ ไม่เพิ่มบทบาท และไม่แตะบริษัทอื่นของผู้จ่าย. การซื้อไม่ข้าม platform/customer gate, admin/security hold หรือ feature deny ที่แอดมินตั้งไว้.
2. แยกหลักฐาน `paid` ออกจากผล `access applied`: invoice/amount/currency/service period/offer/company ต้องตรวจแล้ว และ entitlement + plan term + lifecycle + cache/epoch ต้องเห็นผลครบก่อนบอก “ใช้งานแพ็กเกจแล้ว”. ชื่อสถานะเหล่านี้เป็น semantics ที่ต้องรองรับ ไม่บังคับเพิ่มตารางซ้ำกับของเดิม.
3. Persist inbox/verified invoice และคำสั่ง apply แบบ idempotent; การเปลี่ยนสิทธิ์/term/lifecycle ต้อง atomic หรือมี durable continuation ที่ resume ได้. ห้ามเขียน SUCCESS ที่ทำให้ replay ข้ามงานที่ยังไม่เสร็จ. Notification/เอกสารส่งไม่สำเร็จต้อง retry แยกโดยไม่เก็บเงินใหม่หรือปิดสิทธิ์ที่ apply แล้ว.
4. ห้ามเอา `RenewCompanyPlanTermUseCase` มาเรียกตรงทุก invoice: การบวกจำนวนวันคงที่ไม่แทน billing period. ช่องว่าง manual renew ที่เคย commit term/audit ก่อน lifecycle activation แก้และผ่าน S-pre แล้วตามหลักฐาน 2026-09-11; ปัจจุบัน paid invoice adapter ใช้ verified evidence/atomic grant และมี local simulation proof แยกจาก S-pre แล้ว. ใช้ logic เดิมเท่าที่ถูกต้องและเพิ่ม transaction/fence/recovery ของ paid apply; ไม่เพิ่ม endpoint ปลดล็อกที่ client สั่งเอง.
5. Renewal ต้องชนกับ expiry sweep/admin edit ได้อย่างปลอดภัย: recheck deadline/version/status ใน transaction/CAS ก่อน disable หรือ activate. Sweep ที่อ่านวันเก่าต้องไม่ปิดบริษัทที่เพิ่งจ่าย; payment เก่าต้องไม่ย้อนการยกเลิก/hold/แพ็กเกจใหม่.
6. หน้า return poll สถานะจาก backend แบบ bounded และแสดง “รับชำระแล้ว กำลังเปิดใช้งาน” เมื่อ paid แต่ apply ค้าง; มี reference และทางติดตาม ห้ามชวนจ่ายซ้ำ. Backend สามารถตรวจ Stripe ซ้ำด้วย mapping ที่ยืนยันตัวตนแล้วและเข้าทาง apply เดียวกับ webhook; ไม่เชื่อ browser claim.
7. ไม่รอเงิน payout เข้าธนาคารเพื่อเปิดสิทธิ์จาก invoice ที่ยืนยันแล้ว; แยก payment, fulfillment, tax document และ payout reconciliation. เปิดคืนหลัง term expiry ได้เมื่อ paid period ครอบเวลาปัจจุบันและไม่มีเหตุห้ามอื่น; invoice เก่าที่หมด service period แล้วไม่ให้เดือนใหม่ฟรี.
8. ต้องพิสูจน์ผ่าน browser/API จริงว่า business action ที่ถูกบล็อกก่อนจ่ายกลับทำได้หลัง paid apply, limits/feature ตรง offer, web session/LINE เห็นสถานะใหม่โดยไม่ต้องให้แอดมินกด. Screenshot “ชำระสำเร็จ” หรือ Stripe `active` อย่างเดียวไม่พอ: `active` อาจยังมี invoice เก่าค้าง และ `invoice.paid` อาจมาจาก credit/out-of-band; ช่องทางดังกล่าวต้องมี policy/หลักฐานที่อนุมัติ ไม่ถือเป็น card payment เงียบ ๆ. [Stripe lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
9. B01กำหนดเริ่ม/จ่ายทันทีเมื่อยืนยันซื้อ ไม่มี Stripe trial carry. Portal ต้องปิด subscription_update และ subscription_cancel; แอปใช้ owned commands เพื่อรักษาวัน/โควตาที่ซื้อสะสมและมีทางยกเลิก scheduled downgrade/cancellation ตามสิทธิ์. ใช้ hosted navigation ไม่ฝัง Portal ใน iframe. ข้อจำกัดและ test mapping อยู่ [แผน §4E](../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md#stripe-docs-review) และ [Stripe Portal](https://docs.stripe.com/customer-management#limitations).

## 12. Failure/recovery ที่ต้องส่งมอบ

| เหตุ | พฤติกรรมระบบและสิ่งที่ลูกค้าเห็น | ขอบเขต |
|---|---|---|
| Checkout ค้าง/ปิดหน้า/response หาย | แสดง pending/canceled ตามจริง; recover attempt เดิมและตรวจ Stripe ก่อนสร้างใหม่ | ไม่มี charge/subscription ซ้ำ แม้ retry หลัง Stripe idempotency window |
| จ่ายครั้งแรกไม่ผ่าน | ยังไม่เพิ่ม paid rights; trial/สิทธิ์ที่ชำระไว้เดิมคงตาม term; ให้แก้บัตร/ยืนยันผ่าน recovery ของ Checkout/current invoice ที่ยัง payable | ไม่ให้ grace ของลูกค้าเก่ากับ first-payment โดยอัตโนมัติ; terminal/void invoice ต้อง reconcile แล้วเริ่ม intent ใหม่ ไม่สั่ง pay invoice เก่า |
| เงินไม่พอชั่วคราวเมื่อถึงรอบต่ออายุ | แจ้ง OWNER และ retry จาก Stripe ตาม policy; ไม่สร้าง charge/retry loop ซ้อนใน Mangmee | grace/access ระหว่างค้างและ final action รอมติ §10 |
| บัตรหมดอายุ/ถูกปฏิเสธถาวร/3DS required | แสดงทางเปลี่ยนบัตรหรือยืนยันผ่าน Stripe; อัปเดต default payment method ที่ subscription ใช้จริง | อย่าพึ่ง Smart Retries อย่างเดียวกับ hard decline/ต้องให้ลูกค้ายืนยัน [Stripe retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries) |
| Stripe ยืนยัน paid แต่ DB/entitlement/lifecycle ล้มเหลว | เก็บสถานะ paid และงาน apply ค้าง; retry/reconcile + แจ้ง ops; หน้าจอให้ติดตามโดยไม่จ่ายใหม่ | ต้องผ่าน injected-crash + replay test ก่อน LIVE |
| Webhook ซ้ำ/ลำดับสลับ/ตกหล่น | dedupe invoice และ event, reconcile current provider facts, apply ผ่านทางเดียว | inbox ack หลัง durable receipt; ห้าม receipt success เท่ากับ fulfillment success |
| Provider/worker ล่ม หรือ invoice finalize ไม่ได้ | แยก service failure จากลูกค้าจ่ายไม่ผ่าน; ไม่สร้างหนี้/ปิดข้อมูลจาก unknown; รักษา paid rights ที่ยืนยันไว้ตามเวลา | treatment เมื่อข้าม paid-through ระหว่าง incident ต้องตกลง; ไม่เปิด grace ไม่จำกัด |
| จ่ายหลังค้างหลายรอบ/หลังยกเลิก | ตรวจ payable/latest invoice, debt/service period และสถานะ subscription; ให้กลับใช้งานตามสิทธิ์ที่จ่ายจริง | ต้องตกลงว่าจะเก็บหนี้เดิม/คิดรอบใหม่อย่างไร; canceled subscription ไม่ใช่แค่ renew row เดิม |
| Refund/partial refund/dispute | รักษาประวัติ charge/invoice/refund แยกกันและมี audit; แจ้ง ops; ไม่ replay paid เพื่อคืนสิทธิ์ที่ถูกถอน | ผลต่อสมาชิก/หนี้/credit note เป็น policy §10; refund ไม่เท่ากับ cancel subscription |
| แจ้งเตือนหรือเอกสาร Stripe/อีเมลยังไม่พร้อม | reconcile invoice/receipt URL หรือ operator resend ผ่าน Stripeตามสิทธิ์; ไม่สร้าง invoice/PDF ใหม่หรือส่ง receipt ซ้ำด้วย Postmark | ไม่ตัดเงินซ้ำ ไม่ย้อน paid apply และไม่บอกว่าส่งแล้ว |

Ops ต้องมีรายการ paid-but-not-applied, webhook/inbox lag, reconciliation mismatch, repeated payment failure, invoice finalization failure, refund/payout failure และผู้รับผิดชอบรับเรื่อง. Replay ต้องเห็น company/invoice/ผลเดิม/สิ่งที่จะทำก่อนดำเนินการและมี audit; ไม่แก้ DB เป็น paid โดยไม่มีหลักฐาน.

**Kill switch ต้องแยกหน้าที่:** ปิดการซื้อใหม่/เปลี่ยนแพ็กเกจแล้ว webhook และ recovery ของรายการที่รับเงินไปยังทำงาน. การปิดหน้าเว็บหรือ config ใน Mangmee **ไม่ได้หยุด Stripe ตัดรอบถัดไป**; incident runbook ต้องระบุผู้มีสิทธิ์และวิธีหยุด collection ฝั่ง Stripe แบบเจาะจงพร้อมหลักฐาน ไม่ cancel ลูกค้าทั้งหมดเป็นทางแก้ทั่วไป. Customer cancellation/recovery ต้องมีช่องทางใช้งานได้ระหว่าง incident.

## 13. Business review และหลักฐานทดสอบ

- ใช้ decision register B01–B10 และ test matrix T01–T42 ใน [แผน P26 Stripe](../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md). มติ 2026-09-13 ใน pack amendment ปิด paid start/grace/cancellation/upgrade/downgrade/annual allowance; readiness ยังต้องผ่านก่อนเปิดขาย.
- Paid quota เริ่มจาก verified paid-period grant; annual ให้ทั้งก้อน ×12. Bangkok monthly counting คงเฉพาะ legacy/trial และ operational budget. Quote แสดงยอดก่อน/หลังซื้อและ expiry; upgrade ไม่คืนจำนวนที่ใช้ไป และ ซื้อเฉพาะใบเป็น HIDDEN ไม่แสดงและไม่เปิดขาย; ซื้อเพิ่มเป็นแพ็กเกจเต็ม.
- พิจารณาลูกค้านิติบุคคลที่ต้องการเอกสารภาษี/หัก ณ ที่จ่าย, ผู้จ่ายกับบริษัทผู้รับสิทธิ์ต่างกัน, ลูกค้าเก่า/แอดมินให้สิทธิ์พิเศษ, ต้นทุน AI/OCR/support และค่าบริการ Stripe. ไม่เปลี่ยนราคา/ภาษี/สิทธิ์จากผลวิเคราะห์แทน Owner.
- `NOT RUN`, `REPRODUCED GAP`, `LOCAL PASS`, `SANDBOX PASS`, `UAT PASS` และ `LIVE ACCEPTED` ต้องแยกชัดในรายงาน; test cards/Stripe Test Clocks ไม่เคลื่อนเงินจริง และ local unit tests ไม่ใช่ E2E ของ Stripe. รอบ review 2026-09-10 ยังอยู่ก่อน implementation.

<a id="billing-recovery-contract"></a>
## 14. Recovery และสถานะที่แอป/เว็บไซต์ต้องใช้ร่วมกัน

เป็น semantic contract สำหรับ implementation; ยังไม่ใช่ DTO/routes ใหม่ที่เปิดใช้งานแล้ว. `GET /v1/plan-term/notice` เป็น route เดิมของ P29; billing status/checkout/Portal ให้บันทึก concrete method/path/DTO ใน shared contracts ก่อนทำ consumer ตามแผน §9C.

### 14A. บริษัทและสิทธิ์

- หน้า `/companies/:id/renew`, billing, return และ notice ต้องอ้างบริษัทที่เลือกเดียวกัน. Web ส่ง `X-Company-Id`, backend ตรวจ membership/roles ของบริษัทนั้น; explicit company ผิดต้องไม่ fallback ไปบริษัท default. เปลี่ยนบริษัทระหว่างโหลดต้องทิ้ง response เก่าและแยก cache ตาม company.
- OWNER ที่หมด term รวมบริษัทที่ term system เปลี่ยนเป็น DISABLED ต้องอ่านสถานะและใช้ recovery ที่เปิดแล้วได้ โดยธุรกิจทั่วไปยังถูกบล็อกจนมีสิทธิ์. ยกเว้นเฉพาะ term restriction ใน authenticated recovery scope; ห้ามข้าม revoked membership, tenant boundary, admin/security/platform holds.
- Employee เห็นข้อความกลาง “ติดต่อเจ้าของร้าน”; ไม่มีสิทธิ์ checkout/Portal/รายละเอียดการเงินของ OWNER. User ที่ไม่มี membership หรือหมด session ไม่ได้รับ billing data. Backend ตรวจ OWNER ใหม่ทุกครั้งรวมหลังเปลี่ยนเจ้าของบริษัท; payer ไม่ได้ role เพราะจ่าย.
- Admin/security hold เป็นคนละเหตุจาก term expiry แม้ status จะแสดง DISABLED เหมือนกัน. การจ่ายหรือ manual renew ไม่ปลด hold; กรณี paid แล้วติด hold ต้องเก็บ paid evidence และส่งติดตามตามสิทธิ์ ไม่บอกว่าเงินไม่ผ่านหรือชวนจ่ายซ้ำ. ช่องทาง cancellation/support ระหว่าง hold ใช้ permission policy เดิม ไม่เปิด business data.
- `200 null` ของ notice หมายถึงไม่มี term row เท่านั้น; 401 ให้ login, 403 ให้ permission state, 5xx/offline ให้ error + retry status. ห้ามรวมผลเหล่านี้เป็น null แล้วสรุปว่าผู้ใช้เป็น employee หรือไม่มีวันหมดอายุ.

### 14B. Payment, fulfillment และ access เป็นคนละสถานะ

Backend ต้องคืนสถานะของ selected company, reference, เวลาที่ตรวจล่าสุด, สิทธิ์/paid-through ที่ยืนยันแล้ว, allowed next action และเหตุที่แสดงลูกค้าได้. ไม่ส่งข้อมูลบัตร/secrets/raw error หรือ hosted session URL ไป analytics/log; UI ไม่คำนวณว่า paid/applied จาก query string.

| ข้อเท็จจริงที่ backend ยืนยัน | ข้อความ/พฤติกรรมลูกค้า | สิ่งที่ห้ามทำ |
|---|---|---|
| ยังตรวจผลไม่ได้ / provider timeout | “กำลังตรวจสอบการชำระเงิน”; ตรวจ attempt เดิมและแสดงทางติดตาม | แปลง unknown เป็น decline หรือสร้าง subscription ใหม่ทันที |
| ต้องแก้บัตร/ยืนยัน, ยังไม่มี paid invoice | แก้บัตร/ยืนยันผ่าน Stripe ที่ backend เลือกให้; สิทธิ์เดิมคงตามเวลา/policy | เพิ่ม paid rights หรือใช้ grace ของ renewal ให้ first failure เอง |
| Paid verified, apply pending/failed | “รับชำระแล้ว กำลังเปิดใช้งาน” + reference; bounded status polling แล้วช่องติดตาม; worker resume ได้แม้ปิด browser | ปุ่มจ่ายใหม่, manual unlock โดย client หรือโชว์ว่าสำเร็จครบแล้ว |
| Paid + apply complete + current access allowed | “ใช้งานแพ็กเกจแล้ว”; refresh term/entitlement/session/cache และใช้ protected business action ได้ | เพิ่ม role, reset used quota หรือเปิดบริษัทอื่น |
| Paid แต่ admin/security/platform hold หรือ service period ไม่ครอบเวลาปัจจุบัน | แจ้งข้อจำกัด/ช่องติดตามตามสิทธิ์ โดยยังเก็บหลักฐานรับชำระ | บอกว่าเปิดใช้งานแล้ว, ต่อเดือนใหม่ฟรี หรือปลด hold จาก event เก่า |
| Session canceled/expired หรือ subscription terminal | ตรวจสถานะ provider/collection และปิด intent เก่าก่อนเสนอเริ่มใหม่ | สมมติว่า browser back/cancel ยกเลิกสัญญาแล้ว หรือ pay void invoice |
| ไม่มี session / ไม่มีสิทธิ์ / ระบบอ่านสถานะล้มเหลว | login / permission denied / โหลดไม่สำเร็จ แยกกัน | ใช้ข้อความพนักงานหรือ “ชำระไม่ผ่าน” แทน error ทุกชนิด |

สถานะ `active` ของ Stripe อย่างเดียวไม่ยืนยันว่า invoice ทั้งหมดจ่ายแล้ว. สำหรับ initial automatic collection เอกสาร Stripe ระบุ `incomplete_expired`/void หลังหน้าต่างจ่าย 23 ชั่วโมง; ใช้ current object state และข้อจำกัดของ Checkout ตอน recovery ไม่ hard-code ให้ retry invoice เดิมตลอด. [Stripe subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview)

## 15. Correctness และเกณฑ์รับมอบก่อนเชื่อม Stripe

- ปิด R01/R05 ด้วย atomic completion หรือ durable continuation; คำขอเดิม/payload เดิมทำผลทางธุรกิจครั้งเดียว, payload ต่างต้อง conflict, คำสั่งต่าง key ที่ต่ออายุจริงต้องไม่ lost update. คีย์ manual renew แยกจาก Stripe invoice apply; การรับ provider event ไม่ใช่ผล apply สำเร็จ.
- ปิด R03 ด้วย shared transaction/fence ของ term/lifecycle/admin holds; การเช็กก่อน transaction หรือ lock เฉพาะ handler เดียวไม่พอ. ห้าม sweep ใช้ข้อมูลก่อน renewal ปิดบริษัทภายหลัง และห้าม activation ชนะ hold ที่ถูกสั่งไว้แล้ว.
- ปิด R02/R06 ตาม §14 พร้อม negative tests ของ employee/บริษัทอื่น/revoked membership, multi-company และ network error. Business APIs และ owner-only billing mutation ต้องตรวจสิทธิ์จริง ไม่พึ่งการซ่อนปุ่ม.
- ตรวจ R07: claim warning/expiry ต้องมี durable notification intent ที่กู้ได้ก่อน mark งานสำเร็จ. ใช้ notification/outbox machinery เดิม; แยกสร้าง event, ส่งและยืนยัน delivery. Retry หลัง worker ล่มต้องไม่ทำ lifecycle/payment ซ้ำ; external delivery ไม่อ้าง exactly-once โดยไม่มีหลักฐานจาก provider.
- แผน S-pre ต้องผ่าน existing browser 8/8 + PG 4/4 และ RG01–RG05 ที่เพิ่มก่อน reuse; S1–S3 ต้องมี RG06/Stripe invoice tests ของตัวเอง. เกณฑ์ S-pre ผ่านแล้วใน expanded browser 20/20 + PG 15/15 และ RG01–RG05; original red run ไม่ถูกแก้. ผลนี้ไม่ครอบคลุม S1–S3/RG06 หรือ T01–T42 ของ Stripe.
- R04 ต้องแก้และทดสอบ actual marketing bundle ให้ trial/paid availability/handoff ตรงแอป. สถานะ website spec ตรงอย่างเดียวไม่ใช่ browser acceptance.
- B01–B10 ต้องมีผู้ตัดสิน/วันที่/revision และ mapping ไป config/copy/test. Feature ที่รอ policy ต้องปิดทั้ง UI/API/Portal ตามขอบเขต; recovery/cancellation ที่ลูกค้ามีสิทธิ์อยู่แล้วต้องไม่ติดทางตัน. ห้ามถือ consent จาก signup หรือ metadata attribution เป็นยินยอมให้ตัดบัตรรายเดือน; บันทึก billing consent ของเงื่อนไข/ราคาที่แสดงก่อน Checkout.
- รับมอบ integration เมื่อมี provider sandbox + DB/API/UI evidence ของ applicable T01–T42, แก้ R01–R07 ตามระดับหลักฐาน และทำ ops acceptance ตามแผน. เปิด LIVE ต้องทำ protocol ของ repo แยกต่างหาก. รายละเอียดลำดับงาน/ไฟล์และชุดทดสอบอยู่ [แผนปิดช่องว่าง §9](../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md#stripe-closure-plan).

### 15A. Implemented boundaries และข้อจำกัดของ proof

- Company row lock ร่วมกันใน set/renew/lifecycle/sweep; term + activation + audit atomic. การ replay key เดิมแต่ days ต่างคืน conflict. Admin disable ซ้ำล้าง term marker จึงไม่ถูก renewal เปิดทับ.
- Warning/expiry claim และ NotificationEvent/Recipient/Delivery อยู่ transaction เดียว; reuse delivery worker ที่มีแล้ว. ไม่มี provider call ใน transaction. Report legacy R01 เป็น read-only และต้องตรวจประวัติ hold ก่อนซ่อมรายบริษัท.
- Auth recovery allowlist ตรวจ method/path ฝั่ง server: notice, auth/me/companies, legal acceptance, password change, logout; เฉพาะ ACTIVE membership ใน term-disabled company. Company ID ผิดไม่ fallback, security/admin holds และ business permissions ยัง enforce. Legal acceptance ไม่ถูก bypass.
- Notice `200 null` serialize เป็น JSON จริง; หน้า renew ส่ง companyId จาก route, แยก 401/403/5xx/offline/no-term, response บริษัทเดิมไม่ทับบริษัทใหม่.
- Marketing trial CTA เปิด **request modal เดิม** (lead flow); รอบนี้ไม่ submit lead หรือพิสูจน์ approval/provisioning และไม่เชื่อม paid handoff. Paid cards/JSON-LD/FAQ ไม่อ้างว่าเปิดรับเงินหรือกำหนด cancellation/refund ที่ยังไม่อนุมัติ.
- Proof การ “จ่ายแล้วใช้ได้” ใช้ authenticated **admin manual-renew driver** แทน payment outcome และกด business mutation จาก browser จริง. เป็นหลักฐาน existing access restoration เท่านั้น; Stripe subscription invoice/service-period adapter ต้องมี suite ของตนก่อนเรียกว่าเปิดสิทธิ์จากการตัดเงินจริงได้.


Restart financial-source follow-up2026-09-15: the shared restartSource validator (quote, Checkout and reconciler callers) must require an explicit boolean false for every historical charge dispute state. Missing/null/nonboolean data is unresolved evidence and follows the existing BILLING_RESTART_REVIEW recovery; it cannot open a new sale or confirm a replacement contract. This repairs the current truthiness check without changing refund/debt eligibility or creating a new policy. Prove false success, true/missing/nonboolean refusal, unchanged original account/paid history, and recovery when the original provider evidence becomes complete. [Stripe Charge object](https://docs.stripe.com/api/charges/object) documents disputed as boolean; checked2026-09-15. Use the existing local restart HTTP/browser fixture with simulated Stripe; no provider money mutation or deployment.

Verified: Restart source checkpoint2026-09-15: historical charge dispute state must be explicitly false in the shared quote/Checkout/reconciler validator. Missing/null/nonboolean evidence keeps the original paid history intact and returns the existing review path; complete evidence recovers through the original purchase flow. Local real HTTP/PostgreSQL/Next/Chromium69 scenario groups (17 browser groups, includes regressions), unit12 and catalog4 PASS/0skip; API typecheck/SWC PASS. restart-source-result.json binds3 sources and two inspected mobile captures. Providers simulated; not a full combined/native acceptance. No CI/push/merge/deploy.
