# Audit: ส่วนลดจากเซลล์ — UI, E2E impact, bug/gap และ dependencies

วันที่ 2026-09-29 · **Source/design audit; ยังไม่มี implementation ของส่วนลดใหม่ใน production**

[Spec](../specs/sales-event-discounts-spec-th.md) · [Plan](../plans/sales-event-discounts-plan-th.md) · [Memory](../agent-memory/sales-event-discounts-2026-09-28.md)

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
4. ตรวจdoc links/source paths/E01–E27/findings A01–A22/ข้อความขัดกัน/whitespace. รายละเอียดสรุปเก็บใน [audit verification](../evidence/sales-ticket-demo-2026-09-28/spec-audit-2026-09-29.json).
5. **ไม่ได้รัน**: browser reproductionของA04/A05, UIใหม่/real API+DB/concurrency/auth/Stripe/LINE/UAT/Production. เดโมและscreenshotsก่อนหน้ายังเก็บไว้ไม่ได้แก้หรืออ้างผ่านมติใหม่.

## ข้อจำกัดและ next state

Design closure: ข้อกำหนด/เหตุผล/แผนทดสอบทุกfindingถูกผูกในspec+planแล้ว. Implementation closure: **ยังpendingทั้งหมดที่ต้องแก้โค้ด**. Local baseline testsช่วยยืนยันseamsเดิม แต่ไม่พิสูจน์รองรับdiscount. ก่อนเริ่มfeatureต้องnative-proof/migrate/permission/gatesตามplan; ไม่มีdeploymentauthorizationจากงานreviewนี้.
