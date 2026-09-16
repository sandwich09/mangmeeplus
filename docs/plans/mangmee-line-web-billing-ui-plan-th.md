# แผน LINE + web billing UI และหลักฐานการทำงาน

> **Current delivery checkpoint — 2026-09-16:** โค้ดตามขอบเขตที่อนุมัติและ local acceptance ผ่านแล้ว ดู [ผลปัจจุบัน](../evidence/billing-integration-2026-09-13/final-integration-result.json), [CT/AP 57 กลุ่ม](../evidence/billing-integration-2026-09-13/final-acceptance-map.md) และ [สถานะส่งมอบ](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). กำลังรอ CI ก่อน Admin merge develop/main ทั้งสอง repo; ไม่ deploy. Native provider/device acceptance เป็นขั้นก่อนเปิดบริการจริง ข้อความ IN PROGRESS/BLOCKED/NOT RUN ตามวันที่เก่าด้านล่างเป็นประวัติและไม่ใช่งานโค้ดค้างปัจจุบัน. OTP/passwordless/auto-provision เป็นงานแยก ไม่รวมในขอบเขตส่งมอบของ branch billing นี้.

> **Implementation status — IN PROGRESS:** สถานะโค้ด, CI, งานที่ยังค้าง และข้อจำกัดล่าสุดอยู่ที่ [implementation status](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผล E2E และ source ที่ทดสอบดู [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); แยกผลจำลองออกจากผล native provider และไม่รวมจำนวนทดสอบที่ซ้ำกัน. ข้อความตามวันที่ด้านล่างเป็นประวัติของแต่ละช่วงงาน. ยังไม่ deploy; การ merge develop/main ต้องผ่าน CI และตรวจ scope ที่ค้างก่อน.


> **Owner amendment 2026-09-13:** [มติล่าสุด](../specs/mangmee-billing-pack-amendment-2026-09-12.md): ซื้อเริ่ม/จ่ายทันที, VAT OFF ปรับผ่าน Admin, upgrade จ่ายส่วนต่างเริ่มทันที/วันสิ้นรอบเดิม, downgrade สิ้นรอบที่จ่ายแล้ว, รายปีได้โควตา 12 เท่าทันที; ใช้หมดซื้อแพ็กเกจเต็มเพิ่ม ซื้อเฉพาะใบเป็น HIDDEN ตามมติล่าสุด: ซ่อนไว้ทุกช่องทางและยังไม่เปิดขาย. ซื้อแพ็กเกจเดิมซ้ำเพิ่มโควตาทันทีและต่ออายุจากวันหมดอายุเดิม; ยังไม่เปิดขายก่อน readiness. ไม่มี deploy; full paid E2E ยัง IN PROGRESS.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](../specs/mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

> **Controls 1–8 / no-deploy design 2026-09-11:** [C01–C08 spec](../specs/mangmee-billing-controls-spec-th.md) และ [implementation/CT01–CT32 plan](mangmee-billing-controls-plan-th.md) ครอบคลุมoverview, issue queue, safe repair, permissions, versioned policies, action gates, reconciliation และaudit/temporary overrides. Routine settingsผ่านเว็บหลังinitialimplementation; web/LINE/marketingอ่านapprovedrevisionเดียวกัน. ปิดขายใหม่ไม่หยุดpaid apply/recovery; rich menuเก่าต้องกลับไปstatus/supportได้. Target control suiteยังไม่implemented/NOT RUN; currentrepair evidenceแยกจากStripe/native acceptance.

> **Authorized closure audit 2026-09-11 — existing runtime repaired; integration remains open:** User requested Mangmee-owned design/spec and full web/LINE round-trip bug/gap/impact review and fixes. Track [GW01–GW10 and evidence](../research/stripe-line-web-gap-closure-2026-09-11.md); existing runtime repairs proceed first. This does not mark LB/provider/device tests PASS or select B01–B10.

สถานะ: **IMPLEMENTATION IN PROGRESS / actual local browser-API checkpoints PASS / full LB01–LB20 native acceptance incomplete**.

ใช้ [UI spec](../specs/mangmee-line-web-billing-ui-spec-th.md), [P26](../specs/mangmee-billing-subscription-spec-th.md) และ [แผน Stripe หลัก](mangmee-stripe-billing-implementation-and-test-plan-th.md). นี่เป็นรายละเอียด S2/S4/S5 ของแผนเดิม ไม่ใช่ payment backend อีกชุด. ผล S-pre manual renew และ marketing pre-LIVE ที่ผ่านแล้วคงขอบเขตเดิม.

## 1. ลำดับและ dependency

| งาน | ขอบเขตที่ต้องส่งมอบ | Exit / สถานะ |
|---|---|---|
| L0 Design | ตรวจ current LINE command/LIFF/handoff/renew/layout/marketing; U01–U12, route/API target, wireframe, state/permission, refs | DONE docs; ไม่ได้เลือก B01–B10 แทน Owner |
| L1 Contract + recovery (S1/S2) | shared DTO/error/action, company picker projection, billing purpose ใน LIFF, expiry-scoped handoff/session/guards, exact safe next ตลอด login/legal | PARTIAL IMPLEMENTED: billing DTO, authenticated company picker, return context และ OWNER recovery มี local proof; complete LINE external-browser/device chain ยังต้องตรวจ. Exit: LB01–LB05/LB09–LB11 ผ่าน local API/DB; default start และ business hold ไม่ regress |
| L2 App screens (S4) | U02/U04–U06/U08–U09/U11/U12 ใช้ components เดิม; state projection/quote review/consent/status/Portal entry/documents | PARTIAL IMPLEMENTED: actual purchase/repeat/change/cancel/return/documents และ Admin pages ผ่าน local browser/HTTP checkpoint; full U01–U12/state coverage ยังไม่ครบ และ LIVE ต้องผ่าน provider readiness |
| L3 LINE + marketing entries (S2/S4) | U01/U03, LIFF billing bridge/external browser, company selection, generic OA links, existing support command coexistence | PARTIAL: rich-menu/webhook/marketing correctness repaired; official paid handoff และ LINE expired recovery ใช้ backend เดียว; ไม่มี raw tokens ใน chat/analytics |
| L4 Stripe integration (S2/S3) | เชื่อม Checkout/Portal/verified event/paid apply ที่แผนหลักสร้างเข้าหน้าจอ; no-return recovery, documents, notifications | PARTIAL IMPLEMENTED: signed events/exact financial verification/atomic grant/protected documents และ recovery ผ่าน simulated provider E2E; native 3DS/card/provider email acceptance ยังแยกตรวจ |
| L5 Device/ops acceptance (S5) | native LINE iOS/Android, desktop browser, billing emails/documents, policy-aware cancellation/support, evidence register | NOT RUN; applicable P0 ผ่าน, deferred actions ปิด API/Portal จริง, ไม่เรียก LIVE พร้อมจน release gate ผ่าน |

ห้ามเปลี่ยน package-change request เป็นคำสั่งซื้อโดยเปลี่ยนชื่อปุ่มอย่างเดียว. ก่อน LIVE คง support flow เดิม; เมื่อ billing พร้อมเพิ่ม “แพ็กเกจและการชำระเงิน” เป็นทาง self-service และคง “ติดต่อเรื่องแพ็กเกจ” สำหรับ support/enterprise. ต้องแก้ handler ที่เคยหยิบบริษัท ACTIVE แรกไม่ให้คัดลอกพฤติกรรมนั้นมาใน billing.

Reuse LINE ID verifier, LineWebHandoffToken, BFF cookies/CSRF, membership/permission, P29 recovery, durable billing attempt และ notification delivery เดิม. ไม่เพิ่ม account/payment engine/queue/LIFF SDK อีกชุด. Handoff เดิม target tenant-root กว้างกว่า billing recovery: ต้องตรวจ purpose และ server-stored target allowlist ทั้ง mint/exchange ไม่เชื่อ client surface.

## 2. UI acceptance matrix

สถานะเริ่มต้นของ **ทุกแถว = NOT RUN**. P0 คือบังคับก่อนเปิดเส้นทางที่เกี่ยวข้อง; policy-dependent action ทดสอบเมื่อเปิด หรือพิสูจน์ว่าปิดทั้ง UI/API/Portal พร้อม support route ที่อนุญาต. คอลัมน์ Txx เชื่อมแผน Stripe หลัก ไม่ใช้ test count เดิมแทน coverage ใหม่.

| ID | กรณี | Assertion ที่ต้องเห็น | Mapping |
|---|---|---|---|
| LB01 | LINE OWNER: ACTIVE บริษัทเดียว | verified identity → browser session → quote/Checkout บริษัทเดิม ไม่ขอ password ใหม่ | U03–U08; T01/T41 |
| LB02 | LINE-only OWNER มีแต่ EXPIRED | LIFF/handoff/auth/layout/billing ผ่าน recovery; business API ยังบล็อกก่อน paid และผ่านหลัง apply | U03/U11; T03/T30 |
| LB03 | OWNER A ACTIVE + B EXPIRED | เลือก B ตั้งแต่ LINE และเว็บ; default A ไม่แทรก, invoice/rights ของ B, A ไม่เปลี่ยน | U02/U03; T28/T30 |
| LB04 | Employee, revoked, old owner, forged company/attempt/doc ID | ไม่มี Checkout/Portal/history/เอกสารข้ามสิทธิ์; ไม่มี auto-promote payer | U02/U09; T30/T40 |
| LB05 | Group/forwarded LINE link, unlink, suspended identity | generic link พิสูจน์คนกด; ไม่มี bearer/person data ใน chat; revoked handoff ใช้ไม่ได้, suspended ไม่ชวนสร้าง trial หลบ | U03; T30 |
| LB06 | เว็บสมัครโดยไม่มี LINE | signup เดิมที่ใช้ได้ → company → paid; ไม่บังคับ LINE และไม่สร้างบริษัทซ้ำเมื่อมา LINE ภายหลัง | U01/U02; T01/T40 |
| LB07 | เว็บ+LINE/หลายแท็บสร้างพร้อมกัน | same-company intent/charge/subscription ได้ชุดเดียว; response หายแล้วพบ attempt เดิม | U06/U08; T18/T29 |
| LB08 | เปลี่ยน offer/ราคา/ภาษี/profile/consent หลัง quote | stale quote ต้อง review ใหม่, server ไม่รับ client amount/Stripe ID/return URL | U05/U06; T31/T40 |
| LB09 | cookies คนละ browser / มีบัญชีอื่นค้าง | handoff ใน browser ปลายทาง; review ระบุบัญชี+บริษัทถูกต้อง; ไม่พึ่ง cookie LIFF | U03/U06; T41 |
| LB10 | handoff expired/replayed/blocked open | ขอ proof ใหม่หรือ login safe next; ไม่เปิด Checkout ซ้ำหรือเผย raw token | U03; T16/T41 |
| LB11 | session หมดหลังจ่าย, legal/password gate, fresh browser | login กลับ company+attempt เดิม; ไม่มีผลเงินก่อน authorize; LINE identity ไม่ถูกบังคับ password จาก billing | U08; T28/T30 |
| LB12 | 3DS สำเร็จ/ยกเลิก/ธนาคารปฏิเสธ | provider state → next action ถูก; paid rights ไม่เกิดก่อน verified payment/apply | U07/U08; T09–T11 |
| LB13 | ปิด Stripe/ปิด browser ก่อนกลับ | webhook/reconcile apply ได้เอง; กลับ LINE/เว็บใหม่เห็นสิทธิ์และ business action ทำได้ | U08/U04; T04/T20 |
| LB14 | webhook ช้า/ซ้ำ/สลับ, paid/apply crash, notification ล้ม | checking/paid-applying ไม่ชวนจ่ายซ้ำ; recover และ audit/term ถูกหนึ่งครั้ง | U08; T18–T25 |
| LB15 | back/cancel/Session expired/void/old invoice | แยก subscription cancel; payable vs terminal; ไม่เพิ่มเดือนฟรี/เก็บซ้ำ | U08/U11; T16/T39 |
| LB16 | renewal failed, grace boundary, held, scheduled cancel | banner/next charge/access ตรง policy; Portal return refresh; hold ไม่ถูกปลดจากจ่าย | U04/U10/U11; T12–T15/T33–T35 |
| LB17 | Invoice/Receipt pending/refund/expired URL/ผิดบริษัท | provider documents ถูกบริษัทและยอด; no null link/no duplicate PDF; external browser เปิดได้ | U09; T25/T37/T40 |
| LB18 | 401/403/429/5xx/offline, slow A→B, polling timeout | ไม่สลับ state ผิด, รักษา context, bounded polling/Retry-After, manual refresh/support | U04/U08; T28/T41 |
| LB19 | desktop/390px/keyboard และ native LINE iOS/Android | U01–U12 อ่าน/กดได้, focus/error/terms/3DS/return/Portal/documents ไม่ติดทางตัน | ทุก U; T41 |
| LB20 | blocked OA/email failure/duplicates, gate off, policy disabled | notification ไม่กำหนดสิทธิ์; new sales ปิดตรงสอง repo แต่ cancellation/status/support ที่อนุญาตยังเข้าถึง | U01/U04/U12; T25/T42 |

## 3. วิธีพิสูจน์ด้วยการจำลองและ provider จริง

- **D0 เอกสาร (รอบนี้):** ตรวจ source paths, local Markdown links, U01–U12/LB01–LB20 completeness และ diff whitespace. ไม่ถือว่า UI/runtime ผ่าน.
- **D1 Local simulation เมื่อมี implementation:** ใช้ browser → app/BFF/API/DB/worker จริงและ provider adapter fixture ที่ test boundary; ห้าม route.fulfill สถานะ success ของ UI แล้วเรียก integration ผ่าน. Fixture ต้องมี success/decline/action-required/unknown/apply-crash/duplicate และชะลอ response/reorder ได้; ระบุว่าเป็น mock Stripe. ทดสอบข้ามสอง browser contexts ที่ไม่แชร์ cookie เพื่อจำลอง LIFF/external handoff.
- **D2 Stripe sandbox:** ใช้ Checkout/Portal และ signed webhook ของ sandbox จริงตามแผนหลัก; แยก browser card/3DS กับ API/Test Clock renewal. เก็บ event/invoice/attempt IDs แบบ sanitized, DB before/after, request/response status และ protected business action. Test Clock ไม่เลื่อนเวลา app/worker; ควบคุมเวลา fixture อย่างแยกกัน.
- **D3 Native devices:** LINE app iOS + Android เวอร์ชันที่บันทึก, Safari/Chrome default browser, 3DS challenge, cancel/back/kill/reopen, OA entry, Portal และ Invoice/PDF. Browser automation mobile viewport เป็นเพียง web layout proof ไม่ใช่ LINE app proof. บันทึก OS/LINE/browser/LIFF SDK และ policy revision.
- **D4 Launch evidence:** email/document availability และ provider config ตาม [Postmark/Stripe plan](mangmee-transactional-email-provider-plan-th.md), owner policies, support runbook และ release acceptance. ไม่ส่งจริง/charge/deployจากการอ่านแผนนี้; การทำ provider/device proof ต้องอยู่ในขอบเขต environment ที่อนุญาต.

ข้อมูล fixture ขั้นต่ำ: OWNER LINE-only, OWNER web-only, employee, revoked/old owner; บริษัท A ACTIVE, B term-expired, C admin-held, D ยังมี trial และบริษัทไม่เกี่ยวข้อง. ทุก test ต้อง assertion isolation และ cleanup scoped IDs. ห้ามนำ LINE token/Checkout URL/raw email/document URL เข้า screenshot/log artifact; ใช้ test data และ redact ก่อนแนบ.

## 4. การปิด loop และผลรอบนี้

รอบออกแบบนี้ปิด L0: flow สองช่องทาง, U01–U12, low-fidelity wireframes, API target, recovery gaps, provider references และ matrix LB01–LB20 ลง spec/plan รวมถึง sibling alignment แล้ว. ตรวจเอกสารตาม [task memory](../agent-memory/stripe-line-web-billing-ui-2026-09-11.md).

สิ่งที่ยังไม่จบ runtime: L1–L5/S0–S5 ที่เกี่ยว, B01–B10 ที่เปิด, provider/browser/device tests. ห้ามติ๊ก implementation หรือ E2E PASS จากเอกสารหรือหลักฐาน S-pre. ตอนทำแต่ละ slice ให้อัปเดต test row เป็น PASS/FAIL/NOT RUN พร้อม command, exact source revision, environment และ artifact; ชื่อ command ของ suite ใหม่กำหนดเมื่อไฟล์จริงมีแล้ว ไม่ใส่คำสั่งที่ยังรันไม่ได้เป็นหลักฐาน.


## 5. ผล audit และลำดับถัดไป 2026-09-11

อ่าน [developer design](../specs/mangmee-owned-billing-integration-spec-th.md) สำหรับ schema/command/worker/event/ops ที่ต้อง implement และ [GW register](../research/stripe-line-web-gap-closure-2026-09-11.md) สำหรับทุก LB disposition. Current-entry fixes ไม่เปลี่ยนสถานะ full payment LB/T เป็น PASS.

- [x] Existing code: preserve safe next; expired LINE start/exchange; suspended/revoked identity; user-gesture external handoff/stale retry; current-company package request and webhook context; rich-menu promotion/trial parity; truthful marketing lead errors.
- [x] Evidence: local unit/controller/buffer + actual manifest, web/API/PostgreSQL recovery and separate browser contexts, real marketing bundle with intercepted delivery. คำสั่ง/ขอบเขตใน evidence README.
- [x] Design: U01–U12, owned/provider table, schema constraints, quote/consent, collectible intent lock, verified invoice/apply transaction, outbox/lease/reconcile, errors/holds/documents, LINE webhook/console rollout, support/business impacts.
- [ ] S1: implement proposed billing schema/DTO/uniques and PostgreSQL concurrency/crash tests; no new charge endpoint yet.
- [ ] S2/S3: provider adapter + approved policy/config TEST slice; signed ingress/invoice apply and reconciliation; shared auth including billing purpose/group restrictions.
- [ ] S4: real billing screens/Portal/history/documents, app/LINE notice, Postmark delivery integration. Current marketing provider success remains a lead request, not passwordless signup.
- [ ] S5: all applicable LB/T real sandbox and native-device paths with source/account/policy/device evidence; live release uses mandatory release protocol separately.

### Current adjustment documents and expired-owner recovery (2026-09-14)

Each original invoice links to `/companies/:companyId/billing/invoices/:invoiceId`; scoped Admin uses `/system/billing/companies/:companyId/invoices/:invoiceId`. Follow the C08 observation/document contract in the controls spec: separate refund/credit-note pages, bounded original-source cursors, current permissions, on-demand provider documents, no financial or entitlement mutation. Active-but-expired and expiry-disabled OWNER recovery includes this exact invoice page and GET adjustment endpoints; unrelated descendants/business actions and administrative holds remain blocked. Web layout/banner and LINE handoff use the same narrow recovery-path contract. Preserve session/password/legal/company gates and current OWNER authorization. Test provider error→retry, original invoice back/reload, revoked scope/document permission, expired owner access and denied business API; the latest evidence belongs in invoice-adjustments-result.json. Monetary refund/compensation commands remain separate unfinished C08 work.
