# Plan: ส่วนลดจากเซลล์ — UI ตามธีมเดิมและหนึ่งรายการต่อบิล

ปรับล่าสุด 2026-09-29 · **เอกสารและ dependency audit เสร็จ; UI ใหม่/production implementation ยังไม่เริ่ม**

[Spec](../specs/sales-event-discounts-spec-th.md) · [Audit / findings](../research/sales-event-discounts-e2e-impact-audit-2026-09-29-th.md) · [Memory](../agent-memory/sales-event-discounts-2026-09-28.md)

## Product และขอบเขต

หัวหน้าสร้างงาน/ชุดส่วนลด → เซลล์แจก QR → ลูกค้าเข้าสู่ร้านผ่าน login/signup เดิม → รับส่วนลดที่ Billing → สะสมได้ → เลือกหนึ่งรายการลดการซื้อปัจจุบันหรือบิลรายเดือน/รายปีถัดไป → verified paid ใช้สิทธิ์ครั้งเดียว → activation/report/refund แยกตามเดิม. ไม่ referral/rewards ไม่ย้าย SalesAttribution เดิม.

มติ UI ล่าสุดแทนเดโมก่อนหน้า:
- Section “ส่วนลด” มาก่อนแพ็กเกจ; โครงแถวและแท็บตามภาพ reference แต่ทุก control ใช้ธีม Mangmee เดิม.
- ปุ่ม “เลือก” → “ใช้ส่วนลด”; รายการอื่น disabled. กดรายการเดิมซ้ำยกเลิกสำเร็จก่อนเลือกใหม่. ไม่ direct replace ไม่มีกด “ใช้ส่วนลด” ซ้ำเพื่อยืนยันชำระ.
- 1–3 รายการแสดงเต็ม; 4 ขึ้นไปเลื่อนรายการภายในเพื่อดูทั้งหมด. แท็บ “ส่วนลดที่มี N / ประวัติส่วนลด”; count และ selection ไม่ขึ้นกับหน้าที่โหลด.
- คำบน UI ทั้งหัวหน้า/เซลล์/ลูกค้าเป็นส่วนลด; technical ticket IDs/model names คงได้. ไม่ใช้ native dropdown หรือสร้าง theme ใหม่.
- Receive ไม่ apply/charge. One active selection ต่อ company/account/mode และหนึ่งสิทธิ์ต่อหนึ่งบิล; ไม่มี FIFO/stacking. ไม่มี expiry หลังรับ. วันปิดรับไม่ทำให้รายปีหมดสิทธิ์ก่อนบิลถัดไป.
- สมัครเดิมคงทุก field/action; ไม่มี signup-ticket binding/การกัน cap ก่อนเข้าร้าน. VAT/floor คำนวณส่วนกลาง ไม่เพิ่ม input ให้ Sales/ลูกค้า.

รอบนี้ทำ docs/audit เท่านั้น. ไม่มี production code/schema/provider mutation/เงินจริง/deploy/package.json หรือแก้ prototype. ต้องอัปเดตเดโมเดิมก่อนใช้รับรอง UI ใหม่นี้; 53 walkthroughs/63 assertions เดิมไม่ใช่ผลของมติใหม่.

## Architecture และสิ่งที่ต้องยึด

1. ใช้ Billing quote/consent/attempt/account locks/operation/outbox/reconciler/issues/refund เดิม. Claim เป็น transaction แยกจาก select/clear และ Checkout.
2. Mutation เป็น desired state: select ID หรือ clear expected ID + version + idempotency. ไม่ใช้ toggle endpoint; server ปฏิเสธ select คนละรายการเมื่อมี active selection.
3. Quote pin selectionVersion ทั้งกรณี null/มีส่วนลด; Checkout revalidate version/target/terms ใน accepted transaction เดียว. UI ล้าง consent และทิ้ง response เก่าทุกครั้งที่ยอด/selection เปลี่ยน.
4. Clear ที่ ARMED ต้องรอ provider detach proof ก่อน unlock. UNKNOWN/accepted/RESERVED ห้ามเลือกใหม่/ปล่อยสิทธิ์จาก timeout. ชน invoice cutoff ให้แสดง source ที่ชนะจริง.
5. ราคา base contract/ดีล/สิทธิ์แพ็กคงเดิม. ส่วนลดเป็น evidence เฉพาะ invoice; cycle ถัดไปเต็มจนเลือกใหม่. Selection/read models ไม่เป็น authority ของยอดเงิน.
6. ใช้ provider floor ที่พิสูจน์ตาม mode/method/currency และ constraints Billing เดิม. Repo ไม่มี post-discount business minimum; ไม่ยกค่า demo เป็น policy ใหม่. Add-on ไม่อยู่ใน scope; ไม่ให้คูปองระดับ customer รั่วไปบิลอื่น.
7. Customer active membership + company.plan.manage. Sales platform tenant + active assignment/own queue. เพิ่ม permission sales.event.manage อย่าง explicit ใน contracts/registry/grants/audit tests; ไม่ถือว่ามีอยู่แล้ว.
8. Schema additive; หนึ่ง active selection ต่อ account, หนึ่ง active/consumed redemption ต่อสิทธิ์, invoice/attempt uniqueness, version/locks และ immutable paid evidence. Provider IO อยู่นอก DB transaction.
9. Rollout gate แยก claim/select/provider arm; gate OFF ยังอ่าน history และ reconcile accepted/refund ได้. ไม่มี destructive rollback ของ paid evidence.

## ขั้นงานและเกณฑ์จบ

| ขั้น / สถานะ | งานและ dependency | เกณฑ์จบ |
|---|---|---|
| D0 DONE | มติ UI/copy/3-row/toggle/theme + ปรับ spec ทั้ง flow | E19–E24 และข้อ supersede ชัดเจน ไม่มี copy/ตำแหน่ง/replace rule เก่าค้าง |
| D1 DONE | Source audit ตลอด frontend/contracts/auth/data/provider/financial/dependent modules | Audit findings A01–A22 มี source, impact, closure, acceptance และผล local regression |
| D2 TODO: demo | ใช้ canonical fragment เดิม ปรับแถว/copy/3-row/select-clear; เก็บข้อมูลที่บันทึกไว้ | UI ใหม่ผ่าน E19–E24; migration เก็บ issued/payment/assignment แต่เลิก direct replace; ไม่อ้างผล test เก่า |
| 0 TODO: contract readiness | Source/permission grants/provider floor/feature gate matrix; source of truth อยู่ใน spec | Advertised scope ทุก combination มี owner/config/readiness จริง; ไม่มีค่าขั้นต่ำสมมติ |
| 1 TODO: native proof | Checkout + next monthly/annual invoice + clear/detach + card/QR/deal/advance + VAT ทั้ง3 | Pin API/account/mode/cycle/evidence; pending/dunning/finalization race; next invoice full; collection hold ได้จริง |
| 2 TODO: data/API | Batch/assignment/claim/selection/target/redemption + runtime DTO + cursor/read model | PG race cap/selection/cutoff, company/mode isolation, idempotency/recovery; E04/E05/E12/E17/E20–E23 |
| 3 TODO: head/Sales/entry | ชื่องาน/ชุด text, assignmentหลายคน, dates, QR, safe login/signup/LINE return | Registry/grants/tenant/audit; stale QR/removed agent/cap/group; signupหน้าตาเดิม ไม่มี issue ก่อนมีร้าน |
| 4 TODO: customer/theme | Section ก่อน package/quote/renewal, rows3/scroll, select-clear, themed fields | No native select; consent/stale quote/cache/profile/capacity/permissions; responsive/accessibility E15/E19–E24 |
| 5 TODO: Billing integration | Discount evidence ใน quote/Checkout/recurring/schedule/collection/price-return/reconcile | E01–E10/E14/E16/E22/E23; legacy strict; ไม่ erase target/ลดซ้ำ/เก็บเต็มราคาเงียบ ๆ |
| 6 TODO: financial dependents | Paid consume/activation/receipts/AI quota/history/docs/notification/refund/settlement/event reports | E08/E11/E13/E25/E26; actual net money แยก package entitlements และ legacy attribution |
| 7 TODO: acceptance/recovery | HTTP+PG+native+browser+LINE+ops recovery matrix; code/docs/evidence review | E01–E27 มี evidence หรือ explicit blocker. ห้ามแทนด้วย simulation |

ขั้น 2–6 ทำภายใต้ admission ปิด. Native provider proof ที่ไม่ผ่านถือเป็น blocker ของ combination นั้น ไม่เปิดรับสิทธิ์พร้อมคำสัญญาที่ระบบยังให้ไม่ได้. D2 เป็นงาน prototype ต่อไป ไม่ได้ทำในรอบ docs นี้.

## UI implementation contract

ใช้โครง BillingPage/BillingCustomerFrame/MangmeePage. แยก feature-local component/logic/API/dictionary ตาม [frontend guideline](../guidelines/web-frontend-code-style.md) โดย reuse shared components; ไม่สร้าง common abstraction ใหม่ก่อนมีผู้ใช้จริงสองแห่ง.

Placement:
- Package: ส่วนลด → current package หรือ catalog/deal/capacity/quote ตามขั้นเดิม.
- Renewal: ส่วนลดชุดเดียวกัน → next-bill/collection controls เดิม.
- Payment history: ประวัติการเงินเดิม; ประวัติส่วนลดอยู่แท็บย่อยภายใน section ส่วนลด ไม่ซ้ำกับรายการ invoice.
- อย่าวาง section เฉพาะ showOverview; choosing/quote/profile detour ต้องไม่ทำให้ selection หาย.

Rows และ state:
- ชื่อ/จำนวนลด/เงื่อนไขซ้าย ปุ่มขวาใน card เดียว ใช้เส้นแบ่ง. ไม่สร้าง ticket-shaped cards/oversized discount blocks.
- 0 empty, 1/2/3 แถวพอดี, 4+ scroll ไม่ตัดข้อมูล. 20/100 ใช้ cursor ไม่โหลดทั้งหมดโดยสมมติ limit=3.
- Selection summary/record มาจาก server แยกจาก list page. เลือกรายการที่4/นอกหน้าปัจจุบันยัง disable ทั้ง collection; tab switch/refresh/back คงผล.
- Native button aria-pressed; same button toggles clear, pendingทุกแถว disabled, errorคงselectionล่าสุด. คำว่า “ใช้ส่วนลด” เป็นสถานะเลือกอยู่ ไม่เป็นหลักฐานจ่ายสำเร็จ.
- Long Thai names, zoom, keyboard focus/offscreen row, scrolling on touch; viewportสูงตาม3แถวจริงและไม่ตัดปุ่ม.
- หัวหน้าตั้งชื่องาน/ชุดเป็น text; assignment 10–20+ ค้นหา/ทีม/หลายหน้า/selection IDs/cancel/apply ตามเดิม. ไม่มีปุ่มเพิ่มชุดอีกชุดในฟอร์มปกติ ไม่มีวันหมดอายุหลังรับ ไม่มีช่องขั้นต่ำหลัง VAT.

Theme/dropdown:
- Reuse MangmeeCard/Button/Input tokens, ThemedSelect/SelectField/PopoverPanel, ThemedDate, Modal, CoverLoader.
- ใน scope ตรวจ head audience/scope/team picker, Sales batch/filter, BillingCapacityPicker, BillingAdjustments และ preview/demo controls; ไม่เปลี่ยน payment-mode radio หรือ cadence button เดิมเป็น dropdown โดยไม่จำเป็น.
- แก้ shared ThemedSelect open→disabled guard อย่างเล็กที่สุดก่อนเพิ่มผู้ใช้งานใหม่; test ต้องเปิดจริงแล้ว disable ไม่ใช่ SSR อย่างเดียว.
- Controlled option ถูกลบ/disabled ไม่แสดงตัวแรกเป็น selection ปลอม. Portal ไม่ถูก 3-row scroller/modal clip; closed menu ไม่กิน keyboard focus.
- ไม่แก้ทั่วแอปแบบเหมา; shared fix ต้องมี focused regression และตรวจ caller ที่เกี่ยวข้อง. Production UI ใช้ theme เดิมแม้ reference/เดโมเก่าจะมี native select.

## Dependency map และงานที่เชื่อม

| กลุ่ม | จุดต่อจริง | งาน/สิ่งที่ต้องคง |
|---|---|---|
| Theme | common/components/mangmee, field/ThemedSelect, PopoverPanel, ThemedDate, CoverLoader, app/globals.css | Use tokens/portal/focus/disabled; feature CSS ไม่ hardcode theme ใหม่ |
| Customer | BillingPage, BillingCustomerFrame, billing.api, billing-profile-navigation, BillingCapacityPicker | Placement/current quote/version/consent; membership/email/profile/capacity ไม่ bypass |
| Contracts/DTO | packages/contracts/src/billing.ts, sales.ts; billing.dto/controller | List/claim/select/clear/quote snapshot/reason schemas; no client-priced input |
| Auth/Sales | permission-registry, sales-context/controller, sales-agents/deals/reports services | Event manage grant ใหม่, active assignment, tenant/team scope, signed QR; ไม่ใช้ SalesAttribution เป็น event ledger |
| Signup/LINE | external-signup pages/use cases + existing auth/LINE safe return | Carry intent only; no form/claim/provisioning policy changes; token expired/claim closed revalidate |
| DB/concurrency | apps/api/prisma/schema.prisma; BillingAccount/Quote/Attempt/Invoice/Operation/Outbox/AuditLog | Additive tables/indexes/versions/locks; no backfill selection จากราคา/ประวัติ |
| Pricing | billing-policy/service, provider readiness/configuration, BillingSnapshot | Compute discount before VAT, floor proof, pin base+discounted totals; accepted immutable |
| Checkout/paid | paid-checkout-invoice, paid-invoice, Stripe client, reconciler | Expected discount evidence only; unknown/extra coupon rejected, zero/bootstrap not consume |
| Recurring/changes | billing-repeat, schedule, collection, price-return, restart, upgrade, sales-deal-price | Coupon detach/re-arm scoped cycle; no clearing or duplication by schedule/cadence/price return |
| Activation/usage | reconciler, receipt-grants, trial-carryover, feature-entitlements, capacity, applyDealRequest | Full package units/menu/capacity/period/AI-credit unchanged; financial total distinct |
| Financial output | invoice-details, financial/refunds/refund-source, settlement-source, history-export, notifications | Actual paid/tax/refund amounts; issued credit note source; no full-price refund |
| Adjacent planned add-ons | chat-credit-and-receipt-addons spec/contracts when implemented | ADD_ON excluded; no shared customer coupon/balance leakage; no selection retarget |
| Ops | billing-operations/reconciler/provider-scans/issues/readiness, deployment runbooks | Durable retry/recovery; feature flag doesn't stop accepted reconciliation/history |

Audit A01–A22 ให้ source links และผลกระทบรายจุด. Legacy SalesAttribution/Company.referralSalesUserId อาจถูกเรียกตาม flow เดิมอยู่แล้ว; งานนี้ไม่เพิ่ม referral หรือเปลี่ยนสูตร/ความหมายเดิม. Event report ใช้ redemption→actual invoice แยก; labels บอกยอดรับจริงเทียบราคาป้ายให้ชัดเจน.

## Verification และ acceptance matrix

| กลุ่ม | กรณีบังคับ | หลักฐานที่ต้องเก็บ |
|---|---|---|
| UI/theme E19/E20/E24 | 0/1/2/3/4/20/100, ชื่อยาว, 3แถว, เลือกแถว4, scroll+portal, Thai/English, mobile/zoom | Browser screenshot/DOM bounds, keyboard interaction, no native dropdown/theme drift |
| Select/clear E21–E23 | A selected→B disabled→A clear→B select; disabled direct API; double-click/lost reply/two tabs; selected offpage | Unit/state model + HTTP/PG + browser, fresh server version, same key same result |
| Purchase E01/E02/E04/E22 | Before package/after quote, full quote before select, discounted quote before clear, profile/email/capacity detours, out-of-order replies | Quote+consent+attempt snapshots และ no-charge evidence ใน rejected case |
| Renewal E03/E07/E10/E14/E23 | Monthly/annual next year, current purchase retarget, cutoff, retry/dunning/void, cancel/cadence/deal price return | Native invoice/coupon/cycle evidence; no second discount; verified detach/re-arm/collection hold |
| Distribution E03/E05/E12/E15/E17 | Empty creation,20agents, assignment remove, cap1 race, duplicate QR, signup closes late, foreign company | HTTP/PG/backend UI, immutable source/agent, signup unchanged |
| Financial E06/E08/E11/E13/E25/E26 | Paid-held/late paid/zero bootstrap/advance/full+partial refund/dispute/history/report/notification/settlement | Actual amount/base/tax/source/usage, idempotent apply, no over-refund/quota loss |
| Safety/recovery E09/E16/E18/E27 | Incompatible add-on/upgrade, gate OFF, revoke/suspend, permission revoked, rollback pending/unknown | Recovery journal/history preserved, no silent full-price collection, legacy guards |

มีอย่างน้อย 4 real payment modes (CARD_AUTO/CARD_ONCE/PROMPTPAY_ONCE/PROMPTPAY_RENEW) × month/year × supported source × VAT3 ที่เกี่ยวข้อง; ทำ explicit capability matrix ไม่สรุปจาก demo ที่รวม card/QR สองค่า. ใช้ pairwise ได้เฉพาะ visual combinations; financial/native source combinations ที่ advertise ต้องมี proof ครบ.

## ผลตรวจรอบเอกสารนี้

- Source audit: พบช่องว่าง A01–A22; ข้อกำหนดปิดช่องว่างอยู่ใน spec และขั้นงานข้างบน. ไม่อ้างว่าโค้ด feature ถูกแก้แล้ว.
- Local web regression 4/4 ผ่าน: ThemedSelect SSR, Mangmee interactive theme, profile-return2. Test SSR ยังไม่พิสูจน์ open→disabled.
- Local Billing regression 17/17 ผ่าน: paid Checkout/PromptPay, refund source, schedule, price return. เป็น baseline code เดิม ไม่ใช่ส่วนลด E2E ใหม่.
- ตรวจ links/acceptance mapping/obsolete wording/source paths หลังแก้เอกสาร; ผลบันทึกใน audit.
- ไม่รัน DB/native Stripe/live auth/LINE/new UI browser/UAT/Production; ไม่มี implementation ของ flow ใหม่ให้รัน.

## Recovery และ handoff

Claim close/pause หยุด issuance. Suspend ต้องตรวจทั้ง selected QUEUED/ARMED และ pending provider operations: ไม่ถือว่าหยุดแค่ UI แล้วปลอดภัย; detach/collection hold ตาม native proof ก่อนบิลที่สัญญา. Accepted/reconcile/paid apply/refund/history เดินต่อ. Clear ไม่ได้จากผลไม่แน่นอน; operator ต้องอ่าน source จริง ไม่ออกสิทธิ์ใหม่ชดเชยเอง.

Schema rollback ไม่ลบ selection/redemption/financial evidence. Deployment/retry ทุกครั้งต้องอ่าน [cloud runbook](../runbooks/cloud-environment-operations.md) และ [deployment protocol](../runbooks/uat-production-v2-deployment.md) ตาม scope; บันทึก run IDs/signed result/customer OPEN. รอบนี้ไม่มี authorization ให้ deploy.

งานถัดไปที่ review ได้คือ D2 demo ตามแพตเทิร์นใหม่ หรือขั้น 0–1 เมื่อสั่งทำ production; ทั้งสองยัง pending. ปรับเดโม path เดิมและ preserve saved progress ตาม memory ไม่ reset งานผู้ใช้.
