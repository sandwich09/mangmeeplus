# Audit: ส่วนลดจากเซลล์ — UI, E2E impact, bug/gap และ dependencies

วันที่ 2026-09-29 · **Source/design audit; ยังไม่มี implementation ของส่วนลดใหม่ใน production**

> **สถานะเอกสาร (ปรับ 2026-09-29):** ส่วน "ขอบเขตและข้อสรุป" ถึง "ข้อจำกัดและ next state" ข้างล่างเป็น **ประวัติ** ของ audit ที่ตรวจบน `4a5817b4` ซึ่งไม่ใช่บรรพบุรุษของ develop (merge-base `69bdc327` ลงวันที่ 2026-09-22; develop `8a91bc1c` นำหน้า merge-base 504 commits) จึงเก็บไว้ตามเดิม ไม่แก้เนื้อหา ยกเว้นเปลี่ยนลิงก์สองจุดที่ชี้ไฟล์ที่ไม่มีใน repo เป็นข้อความธรรมดา. สถานะปัจจุบันอยู่ที่ส่วน [ตรวจซ้ำบน develop 8a91bc1c (2026-09-29)](#ตรวจซ้ำบน-develop-8a91bc1c-2026-09-29) ท้ายเอกสาร. แบบที่ใช้ต่อคือ [spec ปัจจุบัน (DRAFT v3)](../specs/sales-event-discounts-spec-th.md) ซึ่งเปลี่ยนตามมติ Owner 2026-09-29 (ลดบิลแรกเท่านั้น, ไม่ซ้อนดีล, ผู้ถือคือคนสแกน QR, ผู้ซื้อเลือกใช้หรือไม่ใช้ต่อการซื้อ, ร้านเดิมได้เครดิตผ่านกลไกของ add-on และออก release ร่วม) — หลายข้อข้างล่างจึงไม่เกิดแล้ว. รหัส A01–A22 ของเอกสารนี้ = SD-A01–SD-A22 ในชุดเอกสารส่วนลด (ไม่ใช่ A01–A32 ของสเปก add-on)

[Spec](../specs/sales-event-discounts-spec-th.md) · [Plan](../plans/sales-event-discounts-plan-th.md) · Memory (ไฟล์ `docs/agent-memory/sales-event-discounts-2026-09-28.md` ยังไม่มีใน repo)

## ขอบเขตและข้อสรุป

ตรวจ working tree ที่ HEAD 4a5817b4238379c2e3e3a24df996dd7168411eda พร้อม local changes ที่มีอยู่แล้ว; ไม่แตะงานอื่น. ครอบคลุมหัวหน้าสร้าง/assignment → Sales QR → login/signup/LINE → Billing list/select/clear/quote/consent → Checkout/renewal → verified paid/activation → history/notification/refund/report/settlement/recovery.

มติใหม่เป็น list rows3/scroll ก่อนแพ็กเกจ, copy “ส่วนลด”, same-button select/clear และปิดรายการอื่นทั้งหมด. Spec/plan รอบนี้ปิดช่องว่างเชิงออกแบบ A01–A22; **ไม่ได้หมายความว่าแก้โค้ดหรือผ่าน real E2E แล้ว**. D2 prototype และ production steps0–7 ยัง pending. ไม่มี referral ใหม่.

ประเภท: D = เดโมผิดมติใหม่, B = พฤติกรรม shared component ที่พบจาก source, G = integration gap ของ feature ที่ยังไม่มี. P1 คือเงื่อนไขต้องปิดก่อนเปิด feature เพราะเกี่ยวกับเงิน/สิทธิ์/selection; P2 คือ UI/contract/consistency. ไม่มีข้อใดเป็นข้อกล่าวหาว่าระบบ production ปัจจุบันกำลังใช้ส่วนลดผิด เพราะ feature ยังไม่ได้ implement.

## Findings และ closure

| ID / ระดับ | หลักฐาน / gap | ผลกระทบและข้อกำหนดปิด | Acceptance / ขั้น |
|---|---|---|---|
| A01 D/P2 | เดโม packageView วาง overview ก่อน wallet; [BillingPage](../../apps/web/src/features/billing/BillingPage.tsx) ใช้ showOverview แยกจาก purchasing ที่บรรทัด303/401 | วางส่วนลดนอกเงื่อนไข overview ก่อน package/catalog/quote; ใช้ selection เดียวใน renewal. เพิ่มแล้วไม่หายระหว่างเลือกแพ็ก | E19; D2/4 |
| A02 D/P2 | เดโม owned.map ทุกแถว, card ต่อรายการ/คำว่าตั๋ว, ไม่มี list viewport/history discount | เปลี่ยนเป็น section/แท็บ/แถวธีมเดิม เห็นไม่เกิน3 ที่เหลือ scroll, countไม่เท่าจำนวนหน้า, historyต่างจาก invoice history. No expiry copy จาก reference | E19/E20; D2/4 |
| A03 D/P1 | เดโม useTicket ที่บรรทัด191–197 เขียน applied ทับ IDเดิม; ปุ่ม selected disabled ขณะที่รายการอื่นเลือกได้ | กลับพฤติกรรม: selected เป็น “ใช้ส่วนลด” กดซ้ำ clear; รายการอื่น disabled; backend ห้าม direct replacement | E21; D2/2/4 |
| A04 B/P2 | [ThemedSelect](../../apps/web/src/common/components/field/ThemedSelect.tsx): select() ไม่ตรวจ disabled; disabled อยู่ที่ summary แต่ option ใช้เฉพาะ option.disabled; ไม่มี effect ปิด open เมื่อ disabled เปลี่ยน | Source แสดงช่อง open→disabled ยังมี option mutation; ต้องปิดเมนูและ guard ทุก action ใน shared component. ไม่ถือว่า browser-reproduced แล้ว; SSR test เดิมไม่ครอบคลุม | E24; 4 |
| A05 B/P2 | ThemedSelect: selected = find(current) ?? options[0] แต่ current value ยังเป็นค่าที่หาไม่เจอ | Controlled stale/removed value อาจแสดง label ตัวแรกทั้งที่ไม่ได้เลือก. Caller/shared behavior ต้องแสดง unavailable/placeholderและไม่ submit ค่าปลอม; ทดสอบ async option removal | E24; 4 |
| A06 D/G/P2 | เดโม helper สร้าง native select; production [BillingCapacityPicker](../../apps/web/src/features/billing/BillingCapacityPicker.tsx)/[BillingAdjustmentsPage](../../apps/web/src/features/billing/BillingAdjustmentsPage.tsx) ใช้ ThemedSelect; [BillingPreviewPage](../../apps/web/src/features/billing/BillingPreviewPage.tsx):51 ยัง native | ไม่ใช้เดโม native select เป็น UI มาตรฐาน. Reuse ThemedSelect/SelectField/PopoverPanel/ThemedDate; audit named screens เท่านั้น ไม่เหมาเปลี่ยน radio/cadence หรือทั้งระบบ. Portal ต้องไม่โดน 3-row scroller clip | E24; D2/4 |
| A07 G/P1 | [billing contracts](../../packages/contracts/src/billing.ts):120/201 และ [DTO](../../apps/api/src/modules/billing/presentation/billing.dto.ts):96 ยังไม่มี selection/list/discount fields | เพิ่ม typed list+selected record+versions+reasons/runtime validators; active selection globalต่อaccount ไม่ขึ้นกับ visible3/page/cycle. Client disabledไม่ใช่ authority | E20/E21; 2 |
| A08 G/P1 | ยังไม่มี durable select/clear commands; [schema](../../apps/api/prisma/schema.prisma) มี BillingAccount/Quote/Attempt/Invoice/Operation แต่ไม่มี event-discount model | Desired-state command + expectedVersion/idempotency; ไม่ใช้ retry toggle. DB uniqueness/locks กันสองbrowser, double-click, claimcap1. Clear ไม่ใช่ delete row แล้วลืม provider | E05/E22/E23; 2/5 |
| A09 G/P1 | [billing.service](../../apps/api/src/modules/billing/application/billing.service.ts):462/503/509–540 snapshot/checkout ตรวจ settings/consent/source แต่ยังไม่มี discount selection fence | Pin selectionVersionแม้ null และ discount evidence; reject quoteเต็มก่อนselect/quoteลดก่อนclear; invalidate quote/consent; accepted/reservation atomic. ทิ้ง responseเก่าที่กลับช้า | E02/E04/E22; 2/4/5 |
| A10 G/P1 | Current purchase และ next renewal แชร์ account; [billing-repeat](../../apps/api/src/modules/billing/application/billing-repeat.ts)/[collection](../../apps/api/src/modules/billing/application/billing-collection.ts) มี operation/snapshot เดิม | ARMED clear ต้อง detach proof ก่อนunlock. Resolve current-purchase retargetต้องถอนnext-cycleก่อน; cutoffชนะแล้วปฏิเสธclear. Pending/UNKNOWNคงlockและrecoveryเดิม | E04/E07/E23; 1/5 |
| A11 G/P1 | [paid-checkout-invoice](../../apps/api/src/modules/billing/domain/paid-checkout-invoice.ts):30–49 และ [paid-invoice](../../apps/api/src/modules/billing/domain/paid-invoice.ts):28–38 reject nonzero discount | ใส่ coupon อย่างเดียวจะทำ paidถูกพัก/reject. เพิ่ม expected discount evidence แบบแคบ; legacy/foreign/extra couponยังreject. ป้องกันจ่ายแล้ว UIชวนจ่ายซ้ำ | E06/E08/E14; 1/5 |
| A12 G/P1 | [schedule](../../apps/api/src/modules/billing/application/billing-schedule.ts):14/19 ปฏิเสธ/clear discounts; [repeat](../../apps/api/src/modules/billing/application/billing-repeat.ts):100/120/333 และ [price-return](../../apps/api/src/modules/billing/application/billing-price-return.ts):65/104 มี no-discount assumptions | Schedule/cadence/ดีลกลับราคาปกติอาจ erase หรือrejectส่วนลดที่promise. Serialize reconcile/detach/rearmกับoperationเดิม; ห้ามลบguardทั้งหมด. Next full invoiceต้องมีproof | E07/E14/E23; 1/5 |
| A13 G/P1 | [billing-policy](../../apps/api/src/modules/billing/domain/billing-policy.ts):29–48/125: quoteTotals ไม่มีdiscount; policyไม่มีpost-discount minimum; offerTerms min เป็นราคาสินค้าก่อนVAT | ใช้base totalsเดิมและcomputeลดก่อนVAT; pinราคา/ภาษี. เพิ่มshared provider-floor readiness ไม่ยกdemo100บาท/offerTermsมาเป็นminimumหลังลด. Inclusiveต้องnative-proofตรงทุกสตางค์ | E02/E09; 0/1/5 |
| A14 G/P1 | [refund-source](../../apps/api/src/modules/billing/application/billing-refund-source.ts):89/99 reject discount credit note; [invoice-details](../../apps/api/src/modules/billing/application/billing-invoice-details.ts):20 ผูกactual totals | คืนเต็ม/บางส่วนต้องตามยอดรับหลังลดกับsource line/tax; credit-note matchingต้องรู้expected discount. Refund-before-paid/disputeไม่คืนสิทธิ์หรือcap. No over-refund | E11/E26; 1/6 |
| A15 G/P1 | [reconciler](../../apps/api/src/modules/billing/application/billing-reconciler.service.ts):605–660/1345–1380 ส่งoffer quota/priceเข้าgrant/deal/attribution | แยกfinancial paid totalจากoffer entitlements. ห้ามdiscountลดreceipt units/AI credit/period/capacityหรือgrantก่อนpaid. Paid-heldยังconsumeครั้งเดียวแต่activationรอ | E08/E25; 5/6 |
| A16 G/P2 | [SalesAttribution writer](../../apps/api/src/modules/sales-console/application/sales-attribution.write.ts):35–45 หนึ่งrecordต่อcompany, [sales reports](../../apps/api/src/modules/sales-console/application/sales-reports.service.ts):53–66 ใช้legacyamount | ใช้recordนี้เป็นevent reportไม่ได้: monthly/multipleสิทธิ์จะขาดหรือยอดป้ายไม่ใช่เงินจริง. Event reportแยกredemption→invoice; legacyformula/attributionคงเดิม ไม่เพิ่มreferral | E12/E13/E26; 6 |
| A17 G/P1 | [BillingPage](../../apps/web/src/features/billing/BillingPage.tsx):222–258 มีemail/profile/capacity detours; [profile-navigation](../../apps/web/src/features/billing/billing-profile-navigation.ts) whitelist purchase return | Sectionก่อนpackageต้องไม่bypass gates; read selection serverหลังreturn/reload/companyswitch. URLไม่พกauthorityของส่วนลด; stale requestจากcompanyเก่าต้องdiscard | E01/E15/E22; 3/4 |
| A18 G/P1 | [signup pages](../../apps/web/src/features/external-signup/SignupPage.tsx)/[status](../../apps/web/src/features/external-signup/SignupStatusPage.tsx)/[welcome](../../apps/web/src/features/external-signup/SignupWelcomePage.tsx) ไม่มีdiscount entry; existing QR claimยังไม่มี | Safe return intentผ่านlogin/signup/LINEเท่านั้น ไม่มีissueก่อนmembership. Claimตอนพร้อมต้องrevalidate5minQR/window/assignment; signupเสร็จหลังปิดรับไม่ได้สิทธิ์ย้อนหลัง | E03/E05/E15; 3 |
| A19 G/P1 | [assertOwner](../../apps/api/src/modules/billing/application/billing.service.ts):102 ตรวจcompany.plan.manage; [sales-context](../../apps/api/src/modules/sales-console/application/sales-context.ts)/[controller](../../apps/api/src/modules/sales-console/presentation/http/sales.controller.ts) ตรวจplatformtenant; [registry](../../apps/api/src/modules/auth/permission-registry.ts) ยังไม่มีsales.event.manage | เพิ่มpermission/grants/testsจริง. Head/agent/customer/foreigncompany/inactive assignment/revoke permissionต้องทดสอบ HTTP. ปิดปุ่มอย่างเดียวไม่พอ | E12/E15/E16; 0/2/3 |
| A20 G/P1 | [add-on spec](../specs/chat-credit-and-receipt-addons-spec-th.md):74/167 ห้ามdiscountและแยกADD_ON intent | ส่วนลดนี้ครอบคลุมfull-package/dealที่รองรับ ไม่ไหลไปADD_ON/ส่วนต่าง/หนี้/repair. ไม่ติดcustomer-widecoupon/balance; selectionเดิมคงtargetบิลแพ็ก | E09/E25; 0/5/7 |
| A21 G/P1 | [operations](../../apps/api/src/modules/billing/application/billing-operations.service.ts), [notifications](../../apps/api/src/modules/billing/application/billing-notifications.service.ts), [financial](../../apps/api/src/modules/billing/application/billing-financial.ts), [settlement](../../apps/api/src/modules/billing/application/billing-settlement-source.ts) เป็นdownstreamของinvoice/evidence | Mappingผิดทำให้notice/reportคืนราคาเต็มหรือgateOFFหยุดrecovery. History/docs/noticeอ่านactualsnapshot; rollbackไม่ลบevidence; suspendต้องdisarm/holdที่provider ไม่ใช่UIอย่างเดียว | E06/E13/E16/E26/E27; 5/6/7 |
| A22 G/P2 | Spec/plan/เดโมเดิมใช้ตำแหน่งใต้แพ็ก, direct replace, minimumสมมติ และ demo มี card/QRแค่2ค่า; core docs guard couponตามpolicyเดิม | ลบข้อความขัดกัน, markเดโมhistorical, เพิ่ม cross-doc links/conditional overlay scope. Real matrixใช้4paymentmodes×VAT×source/month/year; local21testsไม่แทนE2Eใหม่ | E19–E27; D0/D1/D2/7 |

## Invariants ที่ต้องเดินครบ

- Distribution: assignment/revision/window/company/cap ถูกตรวจใน transaction; responseหายคืนrecordเดิม; attribution agentแรกไม่ถูกscanอื่นเขียนทับ.
- Selection: 0หรือ1ต่อaccount; other rows disabledเป็นprojectionของserver state; clearต้องอ้างexpected ID/version. สามแถวเป็นviewportเท่านั้น ไม่ใช่limitสิทธิ์หรือlimitตรวจselection.
- Money: receiveไม่เปลี่ยนยอด; selectคำนวณquote/next estimate; clearคำนวณราคาเต็มหลังdetachจริง; Checkout freeze และ subsequentcallbacksใช้snapshotเดียว.
- Recurrence: onceเป็นprovider lifecycle, USEDเป็นverified paid; finalized-unpaidไม่ปล่อยสิทธิ์; followinginvoiceเต็มราคาเว้นแต่เลือกใหม่. No FIFO.
- Entitlements: discountลดเงินแต่ไม่ลดแพ็ก/วัน/receipt/AI quota; paid-held/advanceยังไม่grantก่อนboundaryเดิม.
- Financial: consumeครั้งเดียว, refundสูงสุดactual paid, no refund of discount as cash, reportsไม่บวกquoted/queuedเป็นรายได้.
- Identity: company/account/mode/ticket/invoice/source binding; UI/cache/LINE/profileไม่ย้ายข้ามบริษัท; backendchecksเป็นauthority.
- Compatibility: legacyไม่มีexpectedeventdiscountยังreject coupon/extra lines; ADD_ON/upgrade/debt/repairไม่รับ overlay; ไม่แก้legacyreferral.

## Provider facts ที่ตรวจซ้ำ

อ้างอิง official docs 2026-09-29; เป็นข้อจำกัด API ไม่ใช่ native proof ของบัญชีนี้:
- once discount อาจถูกนำออกจาก subscription หลัง invoice finalized; invoiceยังเก็บ applied discount. จึงต้องตรวจinvoice/paid evidence ไม่ใช้การไม่มีcouponเป็นเหตุคืนสิทธิ์. [Stripe coupons](https://docs.stripe.com/billing/subscriptions/coupons)
- Invoice draftกับfinalizedมีขอบเขตแก้ไขต่างกัน; proofต้องครอบคลุมก่อนcutoffและclear/detachที่แข่งกัน ไม่อาศัยwebhookมาทัน. [Update invoice](https://docs.stripe.com/api/invoices/update), [Invoice transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions)
- Credit-note lines เป็นsourceสำหรับการคืนจากinvoiceเดิม; ห้ามใช้ส่วนลดเป็นเครดิตเงินสดหรือคำนวณคืนจากcatalogปัจจุบัน. [Credit-note lines](https://docs.stripe.com/api/credit_notes/lines)

Repo pin STRIPE_API_VERSION ที่ packages/contracts/src/billing.ts:6 = 2026-08-26.dahlia. ไม่สร้าง provider objects หรือเรียกบัญชีจริง. Tax rounding/inclusive amount_off, clear/re-arm และcollection holdยังต้องnative proofตามplan.

## Verification ที่ทำจริง

1. Read-only source trace และsearch ของnamed modules/DTO/permission/schema/shared controls; ไม่มีSalesDiscount/selection integrationในproductionpathsที่ตรวจ. ไม่ใช่full static analysisทั้งrepo.
2. Web focused tests **4/4 PASS**, exit0:
   pnpm --filter @watchdog-bms/web exec tsx --test src/common/components/field/ThemedSelect.spec.ts src/common/components/mangmee/mangmee-interactive-theme.spec.ts src/features/billing/billing-profile-navigation.spec.ts
3. Billing focused tests **17/17 PASS**, exit0:
   pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/domain/paid-checkout-invoice.spec.ts src/modules/billing/domain/paid-invoice-promptpay.spec.ts src/modules/billing/application/billing-refund-source.spec.ts src/modules/billing/application/billing-schedule.spec.ts src/modules/billing/application/billing-price-return.spec.ts
4. ตรวจdoc links/source paths/E01–E27/findings A01–A22/ข้อความขัดกัน/whitespace. รายละเอียดสรุปเก็บใน audit verification (ไฟล์ `docs/evidence/sales-ticket-demo-2026-09-28/spec-audit-2026-09-29.json` ไม่อยู่ใน repo).
5. **ไม่ได้รัน**: browser reproductionของA04/A05, UIใหม่/real API+DB/concurrency/auth/Stripe/LINE/UAT/Production. เดโมและscreenshotsก่อนหน้ายังเก็บไว้ไม่ได้แก้หรืออ้างผ่านมติใหม่.

## ข้อจำกัดและ next state

Design closure: ข้อกำหนด/เหตุผล/แผนทดสอบทุกfindingถูกผูกในspec+planแล้ว. Implementation closure: **ยังpendingทั้งหมดที่ต้องแก้โค้ด**. Local baseline testsช่วยยืนยันseamsเดิม แต่ไม่พิสูจน์รองรับdiscount. ก่อนเริ่มfeatureต้องnative-proof/migrate/permission/gatesตามplan; ไม่มีdeploymentauthorizationจากงานreviewนี้.

## ตรวจซ้ำบน develop 8a91bc1c (2026-09-29)

### ฐานและวิธีตรวจ

- โค้ด: develop `8a91bc1c` (checkout แบบ detached ที่สะอาด) และ `origin/develop` `69fba9d3` ซึ่งต่างจาก `8a91bc1c` เฉพาะ `.github/workflows/extended-tests.yml:286` (ลงทะเบียน `billing-advance-deal.pg.spec.ts` และ `billing-purchase-source.pg.spec.ts`)
- ยืนยันด้วย git ว่า `4a5817b4` ไม่เป็นบรรพบุรุษของ `8a91bc1c`; merge-base = `69bdc327` (2026-09-22); develop นำหน้า merge-base 504 commits (รวม purchase-without-setup PR A–E ทั้งชุด) — ตรงกับรีวิว R2 (SED-06)
- คำตัดสินรายข้อมาจากรีวิว R2 §2 และตรวจตำแหน่ง `file:line` ใหม่ด้วยตนเองทุกข้อที่อ้างในตาราง; คอลัมน์ขวาสุดคือผลหลังมติ Owner 2026-09-29 (สเปก §1)
- ไม่ได้รันเทสต์: checkout ที่ใช้ตรวจไม่มี dependency ติดตั้ง และรอบนี้เป็นงานเอกสาร

### คำตัดสินรายข้อ

| ID | เดิมอ้างว่า | ผลบน 8a91bc1c | ตำแหน่งปัจจุบัน | หลังมติ 2026-09-29 |
|---|---|---|---|---|
| SD-A01 | overview แยกจาก purchasing; เดโมวาง overview ก่อน | ยืนยัน (บรรทัดเลื่อน); ส่วนเดโมตรวจไม่ได้ | `BillingPage.tsx:315-316`, `:337` (เดิมอ้าง 303/401) | ไม่เกิดแล้ว — ไม่มี section ส่วนลด; บรรทัดส่วนลดอยู่บนการ์ด `:502-531` |
| SD-A02 | เดโมใช้การ์ดต่อรายการ ไม่มี viewport/ประวัติ | ตรวจไม่ได้ (เดโมไม่อยู่ใน repo) | — | ไม่เกิดแล้ว — ไม่มีรายการ แท็บ หรือกล่อง 3 แถว |
| SD-A03 | เดโม `useTicket` เขียนทับรายการเดิม | ตรวจไม่ได้ (เดโม) | — | ไม่เกิดแล้ว — ไม่มี select/replace |
| SD-A04 | ThemedSelect ไม่กันการเลือกเมื่อ disabled ขณะเปิด | ยืนยัน (ไฟล์ไม่เปลี่ยน) | `ThemedSelect.tsx:79-84` (`select`), `:135-136` (summary), `:171` | นอกขอบเขต — ลูกค้าไม่ใช้ dropdown; ฟอร์มหัวหน้าใช้ checkbox และ `datetime-local`; ถ้าต้องแก้เป็นงานแยก (SED-38) |
| SD-A05 | ค่าที่หาไม่เจอแสดงเป็นตัวเลือกแรก | ยืนยันพร้อมรายละเอียด: label ตกไป `options[0]` แต่ hidden input ยังเป็นค่าเดิมและไม่ยิง `onChange` | `ThemedSelect.tsx:74`, `:111-112` | นอกขอบเขตเหมือน SD-A04 |
| SD-A06 | เดโมใช้ native select; หน้า preview ใช้ native | ยืนยันส่วนโค้ด; หน้า preview เป็นเครื่องมือ local | `BillingPreviewPage.tsx:51` (ลิงก์จาก `BillingPage.tsx:324`); `BillingCapacityPicker.tsx:73` และ `BillingAdjustmentsPage.tsx:122` ใช้ ThemedSelect | ไม่เกี่ยวแล้ว |
| SD-A07 | contracts/DTO ไม่มีฟิลด์ส่วนลด | ยืนยัน (บรรทัดเลื่อน) | `packages/contracts/src/billing.ts:121-148` (BillingQuote), `:153` (BillingStatus); `billing.dto.ts:90-100`; `billing.controller.ts:591-592` | ปิดในเอกสาร — field dictionary สเปก §7.2 (route ใหม่ + ฟิลด์ optional; DTO ของ quote ไม่เปลี่ยน) |
| SD-A08 | ไม่มีคำสั่ง select/clear และ model | ยืนยัน | `schema.prisma` กลุ่ม Billing ไม่มี model ส่วนลด | ปิดในเอกสาร — ไม่มี select/clear; 4 ตารางสเปก §6.1 (String state, ไม่มี enum) |
| SD-A09 | snapshot/Checkout ไม่มี fence ของ selection | ยืนยัน (บรรทัดเลื่อน) | `billing.service.ts:479` (totals), `:520` (snapshot), `:530-618` (transaction จอง), `:555` (consent); เดิมอ้าง 462/503/509–540 | ปิดในเอกสาร — quote pin `eventDiscount` (ticketId+version หรือไม่มี); Checkout ตรวจซ้ำและจองในธุรกรรมเดียว (สเปก §4.3, §6.3) |
| SD-A10 | การซื้อปัจจุบันกับรอบต่ออายุแชร์ account; clear ที่ ARMED ต้องมี detach proof | ยืนยันในภาพรวม | `billing-repeat.ts`, `billing-collection.ts`, reconciler | ไม่เกิดแล้ว — ไม่มี ARMED หรือส่วนลดรอบต่ออายุ (SD-O1) |
| SD-A11 | validator ปฏิเสธส่วนลดทุกชนิด | ยืนยันตรงทุกบรรทัด | `paid-checkout-invoice.ts:30,35,41,49` (ยอดที่คาดหวัง `:22-23`, `:43`, `:48`); `paid-invoice.ts:26,28,36-38` | ปิดในเอกสาร — แก้เฉพาะยอดที่คาดหวัง `:22-23`; การตรวจส่วนลดคงเดิม; `paid-invoice.ts` ไม่แตะ |
| SD-A12 | schedule/repeat/price-return สมมติว่าไม่มีส่วนลด | ยืนยันแต่ไม่ครบ | `billing-schedule.ts:14,19,63`; `billing-repeat.ts:100,120-122,131,334,337,348` (เดิมอ้าง 333); `billing-price-return.ts:65,104`; ที่ขาด: `billing-collection.ts:28-31,122,210,221`, `billing-free-days.ts:44,78,88`, `enforceGrace` `billing-reconciler.service.ts:1196,1203` | ไม่เกิดแล้ว — ไม่มีส่วนลดบน subscription; guard ทั้งหมดไม่แตะ (สเปก §5.4) |
| SD-A13 | `quoteTotals` ไม่มีส่วนลด; ไม่มีขั้นต่ำหลังลด | ยืนยัน (ไฟล์ไม่เปลี่ยน) | `billing-policy.ts:29-48` (ขั้นต่ำ `offerTerms` `:46`), `:125-129` | ปิดในเอกสาร — สูตรสเปก §5.1; ขั้นต่ำ 1000 สตางค์เป็นค่าคงที่ร่วม ไม่อยู่ใน `policyJson` |
| SD-A14 | refund-source ปฏิเสธ credit note ที่มีส่วนลด | ยืนยัน | `billing-refund-source.ts:89,98` (เดิมอ้าง 99); `billing-invoice-details.ts:20` | ไม่เกิดแล้ว — ใบไม่มีบรรทัดส่วนลด (`unit_amount`) การคืนเงินเดิมใช้ได้ |
| SD-A15 | reconciler ส่งโควตา/ราคาของ offer ไป grant, ดีล และ attribution | ยืนยัน (บรรทัดเลื่อน); สิทธิ์แพ็กถูกต้อง, attribution ของดีลใช้ราคาป้าย | one-time `billing-reconciler.service.ts:607-632,668-676`; advance `:1006-1007`; subscription `:1338-1361,1384-1395` (เดิมอ้าง 605–660/1345–1380) | สิทธิ์แพ็กจาก offer ถูกต้อง; ยอดของดีลไม่เกิดปัญหาแล้วเพราะดีลไม่ลด (SD-O2) |
| SD-A16 | SalesAttribution หนึ่งแถวต่อร้าน; รายงานใช้แถวนี้ | ยืนยัน (ไฟล์ไม่เปลี่ยน) | `sales-attribution.write.ts:35-50`; `sales-reports.service.ts:51-66` | attribution คงเดิม; รายงานงานแยกและไม่รวมยอดเซลล์ (SD-Q3) |
| SD-A17 | BillingPage มี detour อีเมล/โปรไฟล์/capacity | ล้าสมัยบางส่วน — gate อีเมลและโปรไฟล์ถูกถอดโดย purchase-without-setup | `billing.service.ts:316-327` (R-A1); `BillingPage.tsx:199-234` (เหลือ capacity/cadence), `:338-340` (โน้ตที่ไม่บล็อก), `:554-558` (ลิงก์โปรไฟล์ที่ไม่บังคับ), `:66-82` (resume) | เขียนใหม่ — การซื้อที่มีส่วนลดใช้ detour เดิม; server คำนวณส่วนลดใหม่ทุก quote; URL ไม่พกส่วนลด |
| SD-A18 | หน้า signup ไม่มีทางเข้าส่วนลด; ยังไม่มี QR claim | ยืนยัน | `apps/web/src/features/external-signup/SignupPage.tsx`, `SignupStatusPage.tsx`, `SignupWelcomePage.tsx` | claim เป็นหน้า LIFF แยก ทำได้ทั้งก่อนหรือหลังสมัคร; ฟอร์มสมัครไม่แก้; ปัญหากลุ่มลูกค้าไม่เกิดแล้ว (SD-O3) |
| SD-A19 | `assertOwner` ใช้ plan.manage; ทีมขายตรวจ platform tenant; ไม่มี `sales.event.manage` | ยืนยันเกือบทั้งหมด; `sales.report.read` เป็นของหัวหน้า/admin และการมองข้ามทีมตัดสินจาก role | `billing.service.ts:118-138`; `sales-context.ts:37-48`; `permission-registry.ts:108-115,565-573`; `packages/contracts/src/sales.ts:9-10` | ปิดในเอกสาร — ตารางสิทธิ์สเปก §9 |
| SD-A20 | สเปก add-on ห้ามส่วนลดและแยก ADD_ON | ยืนยัน; สเปก add-on ฉบับปรับ 2026-09-29 บันทึกเป็นมติ O-03 (บรรทัดที่อ้างเดิมเลื่อนแล้ว) | สเปก add-on มติ O-03 | SD-T3; validator ของ add-on ปฏิเสธ `eventDiscount`; foundation แยกช่องจอง |
| SD-A21 | operations/notifications/financial/settlement อยู่ปลายน้ำของหลักฐาน | ยืนยันในภาพรวม | `billing-operations.service.ts:18` (RETRY_APPLY/IMPORT_INVOICE); `billing-notifications.service.ts:265` (ไม่มีตัวเลข, S41); `billing-financial.ts:9-13`; `billing-timeline.ts:23`; `billing-admin.service.ts:254` | reader แสดงยอดจริงอยู่แล้ว; ไม่มีการแจ้งเตือนใหม่; เพิ่มการค้นหาของแอดมินและ issue `EVENT_DISCOUNT_REVIEW` |
| SD-A22 | เอกสารเดิม/เดโมขัดกัน; ต้องมี matrix 4 โหมด × VAT | ตรวจได้เฉพาะเอกสาร | — | ไม่ต้องแก้ sales-deals §4 หรือ owned-billing B01/B08 (ไม่มี coupon); ลิงก์ purchase-without-setup; matrix = 4 โหมดบน NOT_VAT + unit test ของ VAT + native proof ก่อนจด VAT |

สรุป: ยืนยัน 13 ข้อ (SD-A04, A07, A08, A09, A10, A11, A13, A14, A15, A16, A18, A20, A21), ยืนยันแต่ไม่ครบ 1 (A12), ยืนยันพร้อมรายละเอียด 2 (A05, A19), ล้าสมัยบางส่วน 1 (A17), ตรวจได้บางส่วน 3 (A01, A06, A22), ตรวจไม่ได้ 2 (A02, A03). หลังมติ: ไม่เกิดแล้ว 7 ข้อ (A01, A02, A03, A06, A10, A12, A14), นอกขอบเขต 2 (A04, A05), ปิดในเอกสาร 13 (A07, A08, A09, A11, A13, A15, A16, A17, A18, A19, A20, A21, A22)

### ผลตรวจเดิมที่ใช้ไม่ได้แล้ว

- "Web 4/4 PASS" และ "Billing 17/17 PASS" ข้างบนรันบน `4a5817b4` พร้อม local changes จึงไม่เป็นหลักฐานของ develop. spec web ทั้งสาม (ThemedSelect, ธีม, profile-navigation) ไม่เกี่ยวกับแบบใหม่แล้ว
- รอบนี้ไม่ได้รันซ้ำ. ตอนลงมือให้รันบน worktree ของ develop ล่าสุด: ห้า spec billing เดิม (`paid-checkout-invoice.spec.ts`, `paid-invoice-promptpay.spec.ts`, `billing-refund-source.spec.ts`, `billing-schedule.spec.ts`, `billing-price-return.spec.ts`) เป็น baseline ก่อนแก้ และรายการใน plan §2 SD-C หลังแก้
- ส่วน "Provider facts" ข้างบนเกี่ยวกับ coupon ซึ่งไม่ใช้แล้ว (SD-O1). พฤติกรรม Stripe ที่แบบใหม่พึ่งอยู่ในสเปก §14 พร้อมการตรวจบน UAT ทีละข้อ. เลขบรรทัดของ `STRIPE_API_VERSION` ปัจจุบันคือ `packages/contracts/src/billing.ts:7`

### ข้อที่รีวิว R2 พบเพิ่มนอก A01–A22

41 finding (SED-01…SED-41) และวิธีปิดอยู่ใน [plan §4](../plans/sales-event-discounts-plan-th.md#4-ผลรีวิว-r2--การปิด). ข้อที่ audit เดิมไม่มีเลยและเป็นตัวกำหนดแบบใหม่: allowlist ของ auth guard สำหรับร้านที่ล็อก (SED-03), attribution ของดีลเมื่อซ้อนส่วนลด (SED-04, ไม่เกิดแล้ว), grace ของรอบต่ออายุที่ลด (SED-02, ไม่เกิดแล้ว), ความหมายของกลุ่มลูกค้าใหม่ (SED-08) และงานข้าม PR (SED-11)
