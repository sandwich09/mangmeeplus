# P26 — Stripe implementation, business decisions และการทดสอบ

> **Current delivery checkpoint — 2026-09-16:** โค้ดตามขอบเขตที่อนุมัติและ local acceptance ผ่านแล้ว ดู [ผลปัจจุบัน](../evidence/billing-integration-2026-09-13/final-integration-result.json), [CT/AP 57 กลุ่ม](../evidence/billing-integration-2026-09-13/final-acceptance-map.md) และ [สถานะส่งมอบ](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). กำลังรอ CI ก่อน Admin merge develop/main ทั้งสอง repo; ไม่ deploy. Native provider/device acceptance เป็นขั้นก่อนเปิดบริการจริง ข้อความ IN PROGRESS/BLOCKED/NOT RUN ตามวันที่เก่าด้านล่างเป็นประวัติและไม่ใช่งานโค้ดค้างปัจจุบัน. OTP/passwordless/auto-provision เป็นงานแยก ไม่รวมในขอบเขตส่งมอบของ branch billing นี้.

> **Implementation status — IN PROGRESS:** สถานะโค้ด, CI, งานที่ยังค้าง และข้อจำกัดล่าสุดอยู่ที่ [implementation status](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผล E2E และ source ที่ทดสอบดู [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); แยกผลจำลองออกจากผล native provider และไม่รวมจำนวนทดสอบที่ซ้ำกัน. ข้อความตามวันที่ด้านล่างเป็นประวัติของแต่ละช่วงงาน. ยังไม่ deploy; การ merge develop/main ต้องผ่าน CI และตรวจ scope ที่ค้างก่อน.


> **Owner amendment 2026-09-13:** [มติล่าสุด](../specs/mangmee-billing-pack-amendment-2026-09-12.md): ซื้อเริ่ม/จ่ายทันที, VAT OFF ปรับผ่าน Admin, upgrade จ่ายส่วนต่างเริ่มทันที/วันสิ้นรอบเดิม, downgrade สิ้นรอบที่จ่ายแล้ว, รายปีได้โควตา 12 เท่าทันที; ใช้หมดซื้อแพ็กเกจเต็มเพิ่ม ซื้อเฉพาะใบเป็น HIDDEN ตามมติล่าสุด: ซ่อนไว้ทุกช่องทางและยังไม่เปิดขาย. ซื้อแพ็กเกจเดิมซ้ำเพิ่มโควตาทันทีและต่ออายุจากวันหมดอายุเดิม; ยังไม่เปิดขายก่อน readiness. ไม่มี deploy; full paid E2E ยัง IN PROGRESS.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](../specs/mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

> **Developer-readiness follow-up 2026-09-11:** [F01–F24 / DG01–DG08](../research/billing-developer-readiness-2026-09-11.md) ตรวจsignup→web/LINE→payment→access→operations/restore. ใช้ [control handoff §7](../specs/mangmee-billing-controls-spec-th.md) และ [preflight/DA01–DA08](mangmee-billing-controls-plan-th.md) ก่อนimplementจุดต่อ. Foundationเริ่มได้; E0/B01–B10/privilegedauth/provider setupยังต้องครบสำหรับbehaviorที่เกี่ยวข้อง. TestmatricesยังNOT RUN; ห้ามอ่านคำว่าdesigncompleteว่าruntimeพร้อมหรือทุกมติอนุมัติแล้ว.

> **Controls 1–8 / no-deploy design 2026-09-11:** [C01–C08 spec](../specs/mangmee-billing-controls-spec-th.md) และ [implementation/CT01–CT32 plan](mangmee-billing-controls-plan-th.md) ครอบคลุมoverview, issue queue, safe repair, permissions, versioned policies, action gates, reconciliation และaudit/temporary overrides. Routine settingsผ่านเว็บหลังinitialimplementation; web/LINE/marketingอ่านapprovedrevisionเดียวกัน. ปิดขายใหม่ไม่หยุดpaid apply/recovery; rich menuเก่าต้องกลับไปstatus/supportได้. สถานะของ design note วันที่2026-09-11ถูกแทนที่ด้วย implementation notice และ C01–C08 plan ล่าสุด; local repair/Stripe simulation/native acceptance แยกกัน.

> **Owned design + LINE/web audit 2026-09-11:** [Developer design](../specs/mangmee-owned-billing-integration-spec-th.md), [GW bug/impact register](../research/stripe-line-web-gap-closure-2026-09-11.md) and [local evidence](../evidence/stripe-line-web-gap-2026-09-11/README.md) add rich-menu/webhook/company-context and handoff recovery repairs. Full Stripe/native provider acceptance remains NOT RUN.

> **S2/S4 design extension 2026-09-11:** ใช้ [LINE + web UI spec](../specs/mangmee-line-web-billing-ui-spec-th.md) และ [L0–L5 / LB01–LB20](mangmee-line-web-billing-ui-plan-th.md). L0 design DONE; app screens/company picker/paid return มี local simulated browser proofแล้ว ส่วน full native LINE/device acceptance ยังไม่ครบ. เพิ่ม LINE-only expired OWNER, explicit company selection, external-browser session และ safe return; ไม่ใช้ S-pre results แทน.

> **Postmark / Stripe document decision 2026-09-11:** [Postmark plan M3 / EM10–EM17](mangmee-transactional-email-provider-plan-th.md) กำหนดให้ Stripeสร้างและส่งInvoice/Receiptให้ลูกค้า; appแสดงproviderdocumentsหลังตรวจcompany permissionและตั้งStripe customer emailsให้ครบ. Receiptค่าPostmarkเป็นงานบัญชีบริษัทเรา ไม่ใช้Postmarkส่งreceiptซ้ำและไม่สร้างcustom PDF/numbering/e-Taxในscopeนี้. B06ให้ VAT OFF และ Admin preview/approval สำหรับเปิดภายหลัง; ข้อมูลนิติบุคคลและ provider document/email readiness ต้องยืนยันก่อนเปิด LIVE. ผล S-pre คงเป็นประวัติเดิม.

สถานะ ณ checkpoint เก่า 2026-09-11: **S-pre IMPLEMENTED + LOCAL ACCEPTANCE PASS; ก่อนเริ่ม Stripe implementation** — ปิด loop spec → runtime repair → real DB/API/browser proof และแก้ pricing ของ `mangmee_web`. [ผลรอบแก้](../evidence/stripe-repair-2026-09-11/README.md): browser 20/20, PostgreSQL 15/15, focused tests 198/198, marketing 1440px/390px ผ่าน. S0–S5 ส่วน Stripe, B01–B10 และ provider acceptance ยังเปิด; paid offers disabled, ไม่มี deploy/charge. แผนนี้ขยาย [Billing spec](../specs/mangmee-billing-subscription-spec-th.md) และ [สเปกเว็บ official](../../../mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md).

Developer ใช้ [Stripe developer reference](../research/stripe-developer-reference-th.md) สำหรับ official API paths, request fields, event handling, version-sensitive object joins และ setup/test links; นโยบายและสถานะ acceptance ยังคงอยู่ในแผนนี้.

## 1. Readiness ที่ตรวจได้จริง

| คำถาม | สถานะ implementation 2026-09-14 |
|---|---|
| เลือก provider/integration design แล้วหรือยัง | Stripe hosted Checkout/Billing; Portal จัดการวิธีชำระเงิน ส่วนซื้อซ้ำ/เปลี่ยนแพ็ก/ยกเลิกใช้คำสั่งของแอปตาม prepaid policy |
| Integration ใช้งานแล้วหรือยัง | มี BillingModule, durable webhook/event, account/invoice/attempt/grant schema และหน้าเว็บจริง; ยังไม่เปิดรับเงินจริงหรือ deploy |
| มีวิธีทดสอบจ่ายสำเร็จ/ไม่สำเร็จหรือไม่ | ชุด compiled AppModule + PostgreSQL + Next/Chromium ใช้ provider transport จำลอง; duplicate, lost response, stale quote, paid-held และ recovery อยู่ในหลักฐาน integration |
| Failure policy ครบหรือยัง | B01–B08 มีมติแล้วตามตารางด้านล่างและ pack amendment; remaining operator/refund/debt/override controls ยังต้อง implement/verify ตาม C01–C08 |
| E2E ผ่านแล้วหรือยัง | มี local simulated browser/API/PG checkpoints ตามหลักฐานล่าสุด; full matrix/native acceptance และ CI/merge ยังไม่ครบ ห้ามใช้จำนวนเคสเป็นการรับรองครบทุก flow |
| จ่ายแล้วเปิดอัตโนมัติหรือไม่ | verified financial chain → atomic paid term/receipt grant/lifecycle; return แสดงผลจาก backend และไม่รออีเมล ไม่มีการเพิ่มบทบาทจากผู้จ่าย |

หลักฐานปัจจุบัน: [integration/evidence](../evidence/billing-integration-2026-09-13/README.md) และ [task status/CI](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผลค้นหาและ S-pre วันที่2026-09-11 เป็นประวัติก่อน implementation; ไม่ใช่สถานะโค้ดปัจจุบัน. ไม่อนุมานว่าร้านที่มี tier paid ใน DB จ่ายเงินจริง.

### Repair register — ปิด existing-access defects และ marketing ก่อนเปิด paid

| ID | หลักฐาน / ผลกระทบ | เจ้าของงานและเกณฑ์ปิด |
|---|---|---|
| R01 | **CLOSED / PG01 + RG01 PASS**: term/lifecycle/audit อยู่ transaction เดียว; crash rollback และ replay ไม่ต่อซ้ำ | API/P29; มี read-only legacy recovery report แยก admin hold, ไม่มี batch activate |
| R02 | **CLOSED / BR05, BR07–09, BR13 PASS**: resolve recovery เฉพาะ authenticated routes และ selected term-disabled company | API/auth/legal acceptance; single-company login, employee/foreign/revoked/hold และ business denial ผ่าน |
| R03 | **CLOSED / PG03 + RG02 PASS**: sweep re-read หลัง Company row lock ร่วมกับ renew/set/lifecycle | renewal หลัง SELECT, admin hold และ concurrent sweep ไม่ถูก overwrite |
| R04 | **CLOSED for pre-LIVE pricing / marketing PASS 1440px + 390px**: trial 1/2/15/30 วันแยก, paid 4 controls disabled จริง, metadata/FAQ ตรง | `mangmee_web`; trial เปิด request modal เดิมด้วย keyboard. ไม่ส่ง lead และยังไม่พิสูจน์ paid handoff/Checkout T01/T41 |
| R05 | **CLOSED / PG02 + RG01 PASS**: company/action/requestId + normalized days ตรวจภายใน lock | 8 concurrent same-key → renewal/audit 1; different payload conflict; different keys ไม่ lost update. ไม่ใช่ charge dedupe proof |
| R06 | **CLOSED / BR06, BR10–12, BR14 PASS**: selected-company/error/no-term contract | 401/403/500/offline/retry, slow A→B/back/refresh, mobile และ keyboard ผ่าน |
| R07 | **CLOSED for term notification persistence / RG03 PASS**: claim + NotificationEvent/Recipient/Delivery commit เดียว | rollback หลัง event ก่อน delivery แล้ว retry สำเร็จ; ซ่อม partial delivery ระหว่าง cooldown โดยไม่สร้าง event ซ้ำ. ไม่อ้าง external exactly-once หรือ Stripe T25 PASS |

[ผลก่อนแก้](../evidence/stripe-readiness-2026-09-11/README.md) เก็บไว้ตามเดิม: browser 6/8, PG 1/4 ยืนยัน 5 blockers. [ผลหลังแก้](../evidence/stripe-repair-2026-09-11/README.md) มี expanded tests และ source hashes; R07 เดิมเป็น static risk รอบนี้ทดสอบ fault injection จริงแล้ว. Focused suite ล่าสุด **198/198**. ไม่ยกระดับ T01–T42 เป็น Stripe PASS จาก simulation.

## 2. Business decision register — แยกมติแล้วกับส่วนที่ยัง OPEN

| ID | ต้องตัดสินใจ | ข้อเสนอสำหรับรุ่นแรก / เหตุผล |
|---|---|---|
| B01 | Signup/ผูกบัตร/ช่วง trial ที่เหลือ | **มติ2026-09-13:** Signup ไม่ผูกบัตร/ไม่สร้าง subscription; starter7เมนู/15ใบตาม default. Ownerยืนยันซื้อระหว่างtrialเริ่มและจ่ายทันที ไม่ทบวันtrialและไม่เริ่มtrialซ้ำ |
| B02 | รอบจ่ายเทียบ quota | **มติ2026-09-13:** Ownerยืนยันmonth/year; paidรายปีให้360/600/1200ใบทั้งก้อนทันที ไม่มีresetต้นเดือน. ซื้อแพ็กเดิมซ้ำเพิ่มโควตาทันทีและต่ออายุจากpaid expiry. Trial/manualคงBangkokmonthly. Receipt-only HIDDEN ทุกช่องทางและห้ามขายตามมติล่าสุด |
| B03 | Grace/retry/access หลังจ่ายไม่ผ่าน | **มติ2026-09-13:** Ownerยืนยันdefault grace7วันเฉพาะrenewalลูกค้าที่เคยจ่าย พร้อมสิทธิ์แพ็กเดิม; ไม่สร้างโควตาจากinvoiceที่ยังไม่จ่าย. ครบกำหนดพักใช้และcancelStripeเพื่อหยุดหนี้ใหม่. Configแก้ผ่านAdminพร้อมpreview/approval; initialfailureไม่ให้grace |
| B04 | ยกเลิกและป้องกันเก็บเงินเกิน | **มติ2026-09-13:** Ownerยืนยันcancelสิ้นรอบที่จ่ายแล้ว แสดงpaidThrough/nextchargeและถอนก่อนมีผลได้. ซื้อแพ็กเกจซ้ำต้องเลื่อนcollectionให้ตรงวันสะสม ไม่ตัดเงินซ้ำก่อนหมด. Pending cancellationและrenewal raceต้องreconcile |
| B05 | Upgrade/downgrade/เกิน limit | **มติ2026-09-13:** Ownerยืนยันupgradeจ่ายส่วนต่างเริ่มทันที/วันสิ้นรอบเดิม และdowngradeสิ้นรอบที่จ่ายแล้ว. Upgradeหลังซื้ออายุล่วงหน้าคิดทุกช่วงที่ยังเหลือ. Downgradeมีเลือกสาขา/ผู้ใช้และover-cap recoveryไม่ลบข้อมูล. Mid-period interval switchยังปิดจนกำหนดanchor/credit |
| B06 | ภาษีและผู้จ่าย | **มติ2026-09-13:** Invoice/Receiptลูกค้าใช้Stripe; VATปัจจุบันOFFเพราะบริษัทยังไม่จดVAT. Adminเปิดภายหลังต้องเลือกinclusive/exclusiveและข้อมูลกิจการพร้อมpreview/approval. เอกสารเก่าไม่ถูกเปลี่ยน; fiscal correction/withholdingตรวจเป็นกรณี ไม่ถือStripePDFเป็นใบกำกับไทยครบเอง |
| B07 | Refund/dispute/จ่ายซ้ำ | **มติ2026-09-13:** Ownerยืนยันmanualreviewสำหรับrefund/dispute/จ่ายซ้ำ ตรวจcharge/invoice/รายการใช้ก่อนคืน พร้อมผู้รับผิดชอบ/audit/idempotency. Refundและcancelเป็นคนละaction; ไม่คืนquotaหรือปลดholdจากสถานะที่ยังไม่ยืนยัน |
| B08 | หนี้เก่าและกลับมาหลังปิด | **มติ2026-09-13:** Ownerยืนยันmanualreviewหนี้เก่า/กลับมาใช้. Invoiceเก่าที่periodหมดไม่สร้างรอบใหม่หรือquotaใหม่; ไม่auto-resubscribe/เก็บหนี้ใหม่หลังgraceexpiryโดยไม่ผ่านrecovery. ผลต่อfinancial/accessแยกกัน |
| B09 | ราคา/ข้อยกเว้น/สิทธิ์เจ้าของ | **ตัดสินเพิ่ม:** per-company month/year catalog; Enterpriseทั้งสองintervals + ภ.ง.ด.53/50ทวิ locked/Coming soon ห้าม custom checkout bypass. **ยัง OPEN:** legacy/custom override/grandfather/discount mapping. Payer ไม่ได้OWNERเพราะจ่าย; admin exceptionไม่ถูกoverwriteเงียบ ๆ |
| B10 | Margin, cash flow และ support | รวม processing + Billing, OCR/AI ที่วัดหน่วยถูก, storage/LINE/support/refund/free-trial cost. Payout delay/reserve ไม่ใช่ payment failure; ต้องมี cash buffer/reconciliation และเวลารับเรื่อง paid-but-locked ที่ทำได้จริง |

ราคาเดิมไม่เปลี่ยน: 249 / 499 / 999 / 1,999 THB. ตัวอย่างค่าบัตรในประเทศ + Billing ที่อัตรา 3.65% + 10 THB และ 0.7% คิดเป็น **20.83 / 31.71 / 53.46 / 96.96 THB** ตามลำดับ ก่อนภาษี/ค่าบริการอื่นที่อาจเกี่ยวข้อง; ไม่ใช่ net margin หรือค่าของบัตรต่างประเทศ. ตรวจ [Stripe Thailand pricing](https://stripe.com/en-th/pricing) 2026-09-10. งบ fixed cost 200,000 บาทเป็นประมาณการ Owner ที่ยังต้องยืนยันในงานวิเคราะห์ต้นทุนแยก; ห้ามหักซ้ำต่อช่องทาง และตัวเลขต้นทุน Q&A ไม่ใช่ต้นทุน OCR ต่อใบ.

## 3. แผน implementation ตามลำดับ

**S-pre DONE (local)**; S0–S4 มี implementation และ local simulation ตาม checkpoint ล่าสุดแล้ว แต่ยังไม่ครบทุก acceptance และ S5/merge ยังค้าง. งานที่ขึ้นกับ B01–B10 ต้องได้ข้อสรุปของข้อนั้นก่อน implement; การผ่าน S-pre ไม่เลือก trial/grace/refund policy ใหม่.

| Slice | งาน | Exit ที่ต้องมี |
|---|---|---|
| S-pre Existing access repair — **DONE** | API/P29 ปิด R01/R05 → R03/R07; API/web ปิด R02/R06. ตรวจ caller ทั้ง admin/manual renew, set term, lifecycle, sweep และ notice | ผ่าน expanded browser **20/20**, PG **15/15**, RG01–RG05; negative permissions/holds/ข้อมูล/quota/บริษัทอื่น, hashes และ cleanup อยู่ใน report |
| S0 Policy/catalog | ปิด B01–B10 ที่กระทบรุ่นแรก, แยกฟีเจอร์ deferred, pin stable Stripe API/SDK version และ Price mapping ของแต่ละ environment | app/marketing/Checkout แสดงคำสัญญาเดียวกัน; tax/account/collection/portal settings ระบุได้ |
| S1 Durable billing | reuse ledger/outbox/entitlement/term patterns; company/environment mapping, attempt uniqueness, invoice/event dedupe, source/version fence, pending apply + recovery | DB concurrency/crash tests และ RG06; S-pre ยังผ่าน; local invoice ledger แยก ERP และไม่มี duplicate base subscription/charge |
| S2 Checkout/Portal | authenticated OWNER/expired-company recovery, backend price validation, hosted sessions, session expiry/cancel/recovery, sanitized status/return URLs | API permission/price/test-live tests; disabled trial path ไม่พึ่ง provider; ใช้ recovery contract §9C |
| S3 Webhook/access | signature raw body, durable inbox, invoice reconciliation, paid apply, lifecycle/epoch refresh, retry queues, support diagnostics | จ่ายแล้วใช้ business action ได้จริง, duplicate/reorder/crash recover, no admin/security hold override |
| S4 Marketing/billing UI — **PARTIAL** | R04 pre-LIVE pricing ผ่านแล้ว; ยังต้องทำ U01–U12 ตาม LINE + web UI spec, LIFF browser handoff/expired recovery, Thai states ตาม P26 §14, owner notices และ policy-aware Portal | R06 ไม่ regress; desktop + mobile + keyboard + LINE return, no paid-success claim before actual apply |
| S5 Acceptance/ops | รัน matrix, record provider/DB/UI evidence; reconcile gross/fees/refund/payout; failure/rollback/support runbook | ทุก applicable P0 case ผ่านและ policy-conditional cases ผ่านหรือ feature ปิดจริง; release gate ครบก่อน LIVE |

โครง UI/API/DB ต้อง reuse รูปแบบเดิม; ไม่มีข้อกำหนดให้สร้าง billing service แยก, queue ใหม่, provider abstraction หลายเจ้า หรือ payment engine เอง. Stripe เป็นผู้ schedule/collect/retry; Mangmee เป็นผู้ถือสิทธิ์/นโยบาย/หลักฐาน apply.

## 4. วิธีทดสอบที่ต้องทำเมื่อ integration มีแล้ว

### 4A. เตรียม sandbox และข้อมูล

- ใช้ Stripe sandbox แยก local/CI/UAT และเฉพาะ test keys/test companies; assert mode/account ก่อนสร้างทุก object. ไม่มี live charge ใน test suite. Test cards ไม่เคลื่อนเงินจริง; Stripe แนะนำไม่ใช้เลขบัตรจริงทดสอบใน live mode. [Stripe testing](https://docs.stripe.com/testing)
- สร้าง OWNER A + บริษัท A, OWNER B + บริษัท B, employee A, บริษัท term-expired, admin-disabled, SUSPENDED/ARCHIVED และ grandfathered; เก็บ company/customer/subscription/Price mapping ของ run. Snapshot tier/limits/usage/permissions ก่อนทดสอบ; ห้ามนำข้อมูลลูกค้าจริงมาเป็น fixture.
- ใช้ local app/API + DB/Redis จริงใน Playwright harness เดิม และ Stripe hosted sandbox สำหรับ checkout. Provider fakes ใช้เฉพาะ failure/concurrency tests ที่ระบุว่า simulated; ห้ามนับ fake response เป็น gateway E2E.
- Forward event ด้วย Stripe CLI ไป webhook route **ที่ implementation สร้างจริง** หรือ sandbox webhook ของ UAT. บันทึก API version/event schema ที่ pin; endpoint forwarding secret ต่างจาก Dashboard endpoint secret. ห้ามพิมพ์ secrets ลงผลทดสอบ.

### 4B. บัตรทดสอบและขั้นตอน paid → access

| เคส | ค่าทดสอบบน hosted form | วิธีตรวจ |
|---|---|---|
| จ่ายสำเร็จ | `4242 4242 4242 4242` | future expiry/CVC ทดสอบ → invoice paid → paid apply → business action สำเร็จ |
| เงินไม่พอ | `4000 0000 0000 9995` | error จริง, ไม่มี paid rights/charge สำเร็จ และ retry ไม่สร้าง subscription ซ้ำ |
| 3DS | `4000 0025 0000 3155` | ผ่าน/ไม่ผ่าน/ปิด challenge แล้วกลับแอป ตรวจ required-action และ recovery |
| ผูกได้แต่ตัดไม่ได้ | `4000 0000 0000 0341` | ผูกหลังการชำระรอบแรกสำเร็จ แล้วใช้กับ renewal failure |

อ้างอิง [Stripe test values](https://docs.stripe.com/testing); ทดสอบผ่าน API ให้ใช้ PaymentMethod ทดสอบ เช่น `pm_card_visa` หรือ `pm_card_chargeCustomerFail` แทนส่งเลขบัตรจาก server. 3DS ต้องทดสอบผ่าน frontend จริง; Dashboard charge อย่างเดียวไม่พิสูจน์ challenge UX.

Happy-path ขั้นบังคับ: snapshot บริษัท A และ usage → เข้า marketing/app และเลือก A → ทำ Checkout → เก็บ invoice/payment/subscription IDs → รอ backend paid/apply → ตรวจ DB term/tier/entitlements/audit → reload session → เรียก business API ที่เคยถูกบล็อกและลองจาก UI → ตรวจบริษัท B/employee permissions ไม่เปลี่ยน → replay event → ยืนยันไม่มี renew/เอกสาร/charge เพิ่ม. ทำทั้งบริษัท trial ที่ยัง active และ term-expired โดยไม่ให้แอดมินช่วยเปิด.

### 4C. ต่ออายุ/ทดลองหมดด้วย Test Clocks

- สร้าง simulation customer/subscription ใน sandbox แล้ว advance ถึงปลาย trial/รอบจ่าย/รอบถัดไป; รอ clock ready และ invoice/event processing จบก่อน assert. Advance ตามข้อจำกัดของ clock; ไม่ใช้เวลารอคงที่เป็นหลักฐานสำเร็จ. [Stripe Test Clocks](https://docs.stripe.com/billing/testing/test-clocks), [API/advanced usage](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage)
- แยก lifecycle simulation ที่สร้างผ่าน API ออกจาก browser Checkout E2E และรายงานทั้งสองชุด. Test Clock เลื่อนเวลา Stripe เท่านั้น; การทดสอบ local term/grace/Bangkok quota ต้องควบคุมเวลา app/worker ใน test harness ด้วย โดยไม่เปลี่ยนนาฬิกาเครื่องหรือ environment ลูกค้าจริง.
- รอบแรกจ่ายผ่าน → เปลี่ยน default method ที่ subscription ใช้จริงเป็น decline-after-attach → advance รอบถัดไป → ตรวจ failed/retry/action-needed ตาม policy → เปลี่ยนกลับบัตรดี/จ่าย payable invoice เดิม → ตรวจเปิดคืนครั้งเดียว. ทดสอบ grace ก่อน/ตรง/หลัง deadline และ late payment เกิน paid period.
- สร้าง test subscription จริงเพื่อทดสอบ invoice/company binding. `stripe trigger` ส่ง event จำลองที่อาจไม่สัมพันธ์กับ subscription ของแอป จึงใช้ตรวจ plumbing ได้ แต่ใช้เป็นหลักฐาน full E2E ไม่ได้. [Stripe Billing testing](https://docs.stripe.com/billing/testing)

### 4D. Harness และการรายงาน

Reuse `playwright.config.ts` และ `e2e/harness/`; proposed files คือ `e2e/stripe-billing.spec.ts` และ `e2e/stripe-billing.responsive.spec.ts` (ยังไม่มี). หลังสร้างแล้วใช้ runner เดิม เช่น `corepack pnpm exec playwright test e2e/stripe-billing.spec.ts --project=chromium`; mobile ใช้ responsive suffix ที่ existing projects match. ห้ามเพิ่ม package.json script เพื่อชื่อคำสั่งใหม่.

Report แยก layer: UNIT/DB, PROVIDER-SANDBOX, BROWSER-E2E, UAT และ release acceptance. แต่ละ case ต้องมี run ID, commit SHA ทั้งสอง repo, test environment/account mode, policy/offer/API version, redacted provider IDs, before/after DB state, protected API result, trace/screenshots และผล assert. Card/CVC/secret/customer PII ไม่อยู่ใน artifacts.

<a id="stripe-docs-review"></a>
### 4E. ข้อจำกัดที่ตรวจจาก Stripe docs ตามคำขอ Owner 2026-09-10

ตรวจ [Stripe ประเทศไทย](https://stripe.com/en-th) ที่ Owner ส่งมาและเอกสาร technical ต่อไปนี้; หน้า marketing ไม่ยืนยันว่า account ของ Mangmee เปิด capability ใดแล้ว.

| ข้อเท็จจริงจาก official docs | ผลต่อสเปก/การทดสอบของ Mangmee |
|---|---|
| Portal เปลี่ยน subscription ที่ trialing อาจจบ trial และสร้าง invoice ทันทีตาม default; มี setting `trial_update_behavior=continue_trial` | B01 ต้องกำหนดก่อนเปิด plan changes ใน Portal; T05 ตรวจ Portal ด้วย ไม่ใช่แค่ Checkout [Portal limitations](https://docs.stripe.com/customer-management#limitations) |
| Subscription ที่มี scheduled update อาจแก้/ยกเลิกผ่าน Portal ไม่ได้ | ถ้า B05 ใช้ next-period schedule ต้องมีทาง cancel/จัดการ schedule ในแอปตาม policy เพื่อไม่ให้ลูกค้าติดทางตัน; T34–T36 ตรวจข้อจำกัดนี้ [Portal limitations](https://docs.stripe.com/customer-management#limitations) |
| Portal ใช้ iframe ไม่ได้และ session มีอายุจำกัด | ใช้ hosted navigation และสร้าง session ใหม่ผ่าน OWNER check; T41 รวม back/หมดอายุ/LINE in-app browser [Portal technical limitations](https://docs.stripe.com/customer-management#limitations) |
| Smart Retries ไม่แก้ hard decline/ต้องยืนยันบัตรด้วยตัวเอง | ให้ action-required และแก้ default method ที่ subscription ใช้จริง; T10–T14 ต้องแยกจากเงินไม่พอชั่วคราว [Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries) |
| Auto-cancel หลัง dispute มี delay ที่ Test Clocks ไม่รองรับ | T38 ต้องมี sandbox ที่ไม่ใช้ test clock สำหรับพฤติกรรม delay จริง หรือรายงานส่วนนี้ NOT RUN; advance clock ไม่ใช่หลักฐานผ่าน [Cancel after dispute](https://docs.stripe.com/billing/subscriptions/cancel#configure-automatic-cancellation-after-a-dispute) |
| PromptPay ใช้กับ Checkout subscription mode ไม่ได้; subscriptions/invoices เป็น `send_invoice` | deferred flow เท่านั้น; ไม่แสดง QR auto-renew และไม่เปิด fallback charge ซ้อนกับบัตร [PromptPay](https://docs.stripe.com/payments/promptpay) |

ผลค้น official [Thai account support](https://support.stripe.com/questions/supported-payment-methods-currencies-and-businesses-for-stripe-accounts-in-thailand?locale=th-TH) ระบุ Visa/Mastercard; full-page fetch ของ support ให้ error ในรอบนี้ จึงต้องยืนยันรายการ brand/currency/capability กับ account จริงก่อน LIVE. อย่านำรายชื่อทุกบัตรจาก global test-card catalog มาโฆษณาว่าบัญชีไทยรับได้ทั้งหมด. T02 ต้องครอบคลุมบัตร/สกุลเงินที่ account เปิดจริง; fee table ประเทศไทยอยู่ B10/§2.

## 5. Acceptance targets — T01–T42

ตารางนี้เป็นเป้าหมาย acceptance ที่กำหนดเมื่อ 2026-09-11 ไม่ใช่ผลทดสอบปัจจุบัน. หลายส่วนมีโค้ดและ local/provider evidence แล้วตาม [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); การรับรองครบทุกเงื่อนไขของแต่ละแถวยังต้องเทียบ source และขอบเขตของผลล่าสุด. ทุก case ที่ใช้กับรุ่นที่จะเปิดเป็น P0 release gate; cases ที่ขึ้นกับ B01–B10 ต้องมี policy answer หรือปิด feature นั้นอย่างพิสูจน์ได้และบันทึก DEFERRED พร้อมเหตุผลแทน PASS. ห้าม defer เส้นทางรับเงิน/เปิดสิทธิ์/ยกเลิก/recovery ที่รุ่นนั้นใช้งานจริง. Failure injection เป็น integration test คนละชั้นกับ browser/sandbox E2E.

| ID | สถานการณ์ | ผลที่ต้องตรวจ |
|---|---|---|
| T01 | Trial เดิม/Stripe ปิดหรือล่ม | สมัคร/ใช้ trial ตาม policy เดิม ไม่มี payment call |
| T02 | ซื้อครั้งแรก STARTER/BASIC/PRO × month/year; Enterpriseใช้ negative PE26–PE30 | ราคา/THB/interval/tax/limits/สิทธิ์ตรง snapshot; invoice paid และ protected action ใช้ได้ |
| T03 | บริษัทหมด term แล้วจ่าย | OWNER เข้า billing ได้, auto-open เฉพาะบริษัทนั้น, ข้อมูลเดิมอยู่ครบ |
| T04 | สมาชิกเดิม/LINE หลังจ่าย | refresh cache/epoch แล้วเห็นสิทธิ์บริษัทใหม่โดย role/scope เดิมไม่เพิ่ม |
| T05 | Trial conversion ก่อน/ตรง/หลังหมด และเปลี่ยนแผนผ่าน Portal | วันคิดเงิน/วัน trial/paid-through ตรง B01; ไม่เริ่ม trial ใหม่หรือจบ trial/ตัดเงินทันทีเพราะ Portal default ที่ไม่ได้อนุมัติ |
| T06 | Renewal ปกติ 2 รอบ | แต่ละ invoice apply ครั้งเดียว ไม่มี interval drift/บวก 30 วันเอง |
| T07 | วันที่ 28–31/ก.พ./ปีอธิกสุรทิน | paid period ตาม Stripe; local timezone/UI ถูกต้อง |
| T08 | ซื้อกลางเดือน/trial เคยใช้ quota | used/remaining/reset ตรง B02; ไม่ reset หรือขายโควตาที่ UI สัญญาผิด |
| T09 | Card decline/เงินไม่พอครั้งแรก | ไม่เปิด paid และไม่กระทบ trial/สิทธิ์เดิมก่อนหมด; retry เฉพาะ invoice ที่ยัง payable ผ่าน recovery ที่เข้ากับ Checkout state |
| T10 | 3DS ผ่าน/ไม่ผ่าน/ปิดกลางทาง | action-required ไม่ถูกนับ paid; ยืนยันต่อแล้ว apply ได้ครั้งเดียว |
| T11 | Expired/lost/stolen card/hard decline | ให้แก้บัตร/ยืนยัน; ไม่วน charge แบบ retry ซ้อนหรือสัญญาว่าจะสำเร็จเอง |
| T12 | ต่ออายุเงินไม่พอชั่วคราว | past_due/notice/retry/grace ตรง B03; Stripe เป็นผู้ collect |
| T13 | เปลี่ยนบัตรหลัง failure | แก้ default method ที่ถูกใช้จริง, จ่าย invoice เดิม, เปิดคืนครั้งเดียว |
| T14 | Grace ก่อน/ตรง/หลัง deadline | app guard/sweep/UI/LINE ใช้ policy เดียวกัน; initial payment ไม่ได้ grace ฟรี |
| T15 | Invoice finalize ล้มเหลว/Stripe 429/5xx | จัดเป็น billing service error, bounded backoff, ไม่สร้าง charge ใหม่จาก unknown |
| T16 | Checkout session หมดอายุ/ปุ่มยกเลิก/incomplete_expired | แยก session expiry กับ subscription/invoice terminal state; void invoice ไม่ retry pay; ปิด intent เก่าและตรวจ collection แล้วจึงสร้าง intent ใหม่; ไม่ยกเลิกสมาชิกเดิมโดยเผลอ |
| T17 | เครือข่ายหายหลัง Stripe รับคำสั่ง/ปิด browser หลังจ่าย | ตรวจ attempt/provider ก่อน retry; webhook เปิดสิทธิ์ได้โดยไม่ต้อง return |
| T18 | สองแท็บ/สอง OWNER ซื้อพร้อมกัน | durable lock/unique intent และ Stripe idempotency; มี base subscription/charge ชุดเดียว |
| T19 | Retry นานเกิน provider idempotency window | local durable attempt/reconciliation ป้องกันเรียกสร้างซ้ำ |
| T20 | Event ซ้ำและคนละ event สำหรับ invoice เดียว | inbox/event/invoice dedupe, renew/เอกสาร/notice ไม่ซ้ำ |
| T21 | Event เก่ามาหลัง cancel/upgrade/refund | ไม่ย้อน current state/paid period และไม่ปลด hold |
| T22 | Webhook ตกหล่น/ล่มก่อน durable receipt | provider retry/reconcile ได้; ไม่ ack success ก่อนเก็บหลักฐาน |
| T23 | Paid แล้ว crash ระหว่าง apply/lifecycle | งานค้าง resume ได้, paid evidence ไม่หาย, ไม่มีจ่ายใหม่; ปิด R01 |
| T24 | Renewal ชน expiry sweep/admin disable | CAS/version recheck, บริษัทจ่ายแล้วไม่โดน stale disable; hold ของแอดมินชนะ |
| T25 | Notification/email/LINE ส่งไม่สำเร็จ | retry แยก ไม่รื้อ paid rights/duplicate charge; หน้าแอปยังบอกสถานะจริง |
| T26 | ออก/ส่งเอกสารภาษีล้มเหลว | paid access ยังถูกต้อง, document job ค้างให้ติดตาม ไม่ออกเลข/เอกสารซ้ำ |
| T27 | Zero invoice/coupon/credit/out-of-band paid | มี authorized adjustment/policy; ไม่ตีความเป็น card payment หรือ grant เกิน offer |
| T28 | ต่อสิทธิ์แล้ว response หาย/cache เก่า | retry อ่านผลเดิม, refresh web/LINE; protected API ไม่ใช่แค่ UI success |
| T29 | Restore DB/replay backfill/worker restart | reconcile provider IDs/version/paid-through, ไม่สร้าง charge หรือต่อเดือนไม่จำกัด |
| T30 | User/employee/บริษัทอื่นปลอม ID | ปฏิเสธ checkout/portal/status/provider mapping ของบริษัทที่ไม่มีสิทธิ์ |
| T31 | Amount/Price/offer tamper/ราคาเปลี่ยนระหว่าง checkout | server snapshot/version/currency ตรวจจริง; invalidate/requote ชัดก่อนเก็บเงิน |
| T32 | Signature/raw-body/account/test-live mismatch | ไม่มี receipt/apply ที่เชื่อ event ปลอม; test event ไม่เปิด live company |
| T33 | Admin-disabled/SUSPENDED/ARCHIVED/platform closed | payment ไม่ปลด hold; แจ้ง paid-but-held/review ตามสิทธิ์โดยไม่เปิดข้อมูล |
| T34 | Cancel at period end/ถอน cancel/มี scheduled update อยู่ | ใช้ถึงวันตาม policy, หยุดรอบถัดไป; มีทางยกเลิกแม้ Portal จำกัดเพราะ schedule; ไม่บอกหยุดก่อน provider ยืนยัน |
| T35 | Cancel ชน renewal หรือยกเลิกแล้วสมัครใหม่ | รู้ว่า charge/invoice ใดเกิดแล้ว; ไม่มีทั้ง new/old subscription ตัดซ้ำ |
| T36 | Upgrade/downgrade/branch-seat เกิน limit | invoice/proration/effective date ตรง B05, ไม่ลบข้อมูลหรือเพิ่มสิทธิ์ก่อนจ่าย |
| T37 | Full/partial refund/refund failed/replayed | คืนครั้งเดียวตามหลักฐาน, status/credit note/access ตรง B07, cancel แยก |
| T38 | Dispute เปิด/ชนะ/แพ้/ถอน | ops evidence/audit/access policy ตรง, old paid event ไม่คืนสิทธิ์; auto-cancel delay ต้องทดสอบโดยไม่อ้าง Test Clock ที่ไม่รองรับ |
| T39 | หนี้หลาย invoice/late pay หลัง period หมด | เปิดเฉพาะ service period ที่มีสิทธิ์ตาม B08, ไม่มีเดือนใหม่ฟรีหรือบังคับจ่ายซ้ำโดยไม่แจ้ง |
| T40 | Payer ต่างคน/tax identity/OWNER เปลี่ยน/ลูกค้าเก่า custom | invoice recipient และ company rights แยกถูก, preserved admin terms/overrides, old owner เข้า Portal ไม่ได้ |
| T41 | Marketing/app/Checkout/Portal mobile+desktop | ราคา/trial/availability/ภาษา/keyboard/return/back/loading/error/permission ตรง; Portal session หมดอายุ/ไม่ใช้ iframe; LINE browser handoff ทดสอบจริง |
| T42 | Kill switch/incident/payout mismatch | ปิด new sales ได้โดย recovery/cancellation ทำงาน; มีวิธีหยุด collection ที่ Stripe ตาม scope; reconcile gross-fee-refund-payout ได้ |

## 6. Operational acceptance ก่อน LIVE

- บันทึกการตั้งค่า product/Price, billing interval, payment methods, invoice collection, retry/final action, tax/document, portal permissions, consent copy, stable API version, signing secrets rotation และ environment mapping; ไม่คัด test IDs/keys ไป live.
- ตั้ง actionable queues/alerts: paid-but-not-applied, inbox age/retry/dead-letter, mismatch, duplicate subscription, invoice.finalization_failed, recurring declines, refund/payout failures. ต้องมี owner/runbook และ reference ให้ support หา invoice/company ได้โดยไม่เห็นบัตร.
- เป้าทางวิศวกรรมที่เสนอสำหรับ acceptance: normal paid→usable p95 ≤30 วินาที, paid-but-pending เกิน 2 นาทีแจ้ง ops; ต้องวัดจริง/ยืนยันก่อนเป็น SLA ลูกค้า. ระหว่างรอแสดง pending พร้อมป้องกันการจ่ายซ้ำ.
- Reconciliation ควรทำทั้ง provider→local และ local→provider ด้วย watermark ที่ซ้อนช่วง/มี pagination; ตรวจ invoice/charge/refund ไม่ใช้ยอด payout เทียบกับราคา invoice ตรง ๆ. Scheduled scan/replay ต้อง idempotent และมี audit.
- Incident แยก customer decline จาก provider/app outage; freeze new sales ไม่ปิด webhook/apply ที่จำเป็น. อย่าสรุปว่าหยุดตัดเงินเพราะเว็บ disabled; ขั้นหยุด Stripe collection เป็นการเปลี่ยน live billing ที่ต้องมีขอบเขตและบันทึกตาม runbook.
- Pilot เปิดเฉพาะ approved cohort หลัง sandbox/browser/UAT ผ่าน. ใช้ธุรกรรมบริการจริงตาม scope ที่อนุมัติเมื่อเปิดใช้งาน; ไม่ใช้ live card transaction เป็น test แทน sandbox. อ่าน deployment protocol ก่อน UAT/Production run และบันทึก UAT/READY/Production IDs + signed result/customer OPEN ตามข้อกำหนด repo.
- Rollback ต้องคง paid evidence/processing/recovery ไว้; ไม่ย้อน schema จนสูญเสีย invoice mapping และไม่ cancel/refund ทั้งหมดโดยอัตโนมัติ. ผู้ปิด billing ต้องตรวจ subscription ที่ยังตัดรอบถัดไปได้.

## 7. สิ่งที่รันจริงใน review นี้

- Local baseline: plan-term use cases + AuthGuard 67 tests ผ่านด้วยคำสั่งใน [evidence README](../evidence/stripe-readiness-2026-09-10/README.md).
- Injected-failure probe: ยืนยัน R01; ต้องแก้ใน implementation. ไม่มี Stripe API/DB จริงถูกเรียกโดย probe.
- Stripe sandbox, Test Clocks, card checkout, renewal browser E2E, UAT และ live acceptance: **NOT RUN** เพราะยังไม่มี integration; ไม่มีหลักฐานให้เรียกผ่าน.
- Document consistency/links/`git diff --check`: บันทึกผลเมื่อจบ review ใน memory. ไม่มี runtime fix, secret/config change, deployment, commit หรือ push ในงานนี้.

## 8. Local simulation readiness — Owner ขอเพิ่ม 2026-09-11

Owner อนุญาตให้จำลองเพื่อพิสูจน์ความพร้อมก่อนเริ่ม Stripe integration. รอบนี้ทดสอบ **existing plan-term recovery ผ่านเว็บ/API/DB จริง** และ inject failure/interleaving ใน use case จริง; ไม่สร้าง Checkout/Stripe webhook จำลองขึ้นมาแล้วเรียกว่า production integration ผ่าน.

- เพิ่ม Playwright suite `e2e/plan-term-billing-readiness.spec.ts` ใช้ harness เดิมและบริษัททดสอบใหม่: expired access → simulated successful payment trigger → เรียก admin renew API เดิม → browser/protected business API ใช้ได้; ตรวจ sequential replay, quota/data/roles/บริษัทอื่น และ admin/security holds.
- Simulation trigger เป็น test driver ของ manual renewal จำนวนวันตาม P29 ไม่ใช่ Stripe adapter, signed invoice validation, paid service-period application หรือการซื้อ paid tier. Decline/no verified payment หมายถึงไม่เรียก renew; ทดสอบว่า access เดิมยังถูกบล็อก ไม่ใช่หลักฐานว่า webhook handler ปฏิเสธ event ได้แล้ว.
- เพิ่ม deterministic recovery probes สำหรับ R01 crash/replay, concurrent requestId และ stale sweep เพื่อวัดว่ากลไกเดิมพร้อม reuse หรือไม่. Probe ที่ assert behavior ที่ต้องการแล้ว fail ต้องรายงานเป็น blocker; ห้ามนับการ reproduce defect เป็น acceptance PASS.
- ใช้ PostgreSQL/Redis/เว็บ/API localhost เท่านั้น, fixture แยกจาก seed companies, cleanup เฉพาะ IDs ของ run, ไม่ส่ง LINE/email หรือใช้ Stripe/AI/cloud. ไม่แก้ package.json หรือ runtime billing policy.
- บันทึกคำสั่ง, ports, git SHA/dirty state, ผลแต่ละชั้นและ screenshot/trace ที่ไม่บรรจุ token ใน [memory รอบ simulation](../agent-memory/stripe-billing-simulated-readiness-2026-09-11.md). T01–T42 ของ Stripe ยังคง NOT RUN; ผลชุดนี้ให้ได้เพียง partial pre-integration evidence และรายการ blockers.

ผลก่อนแก้ (historical): [executed report](../evidence/stripe-readiness-2026-09-11/README.md), browser **6 passed / 2 failed**, real PostgreSQL probes **1 passed / 3 failed**. Blockers เป็น product behavior ไม่ใช่ rig/environment error; ไม่ skip/relax assertion. ผลนี้คงเป็นประวัติ red run; ผล S-pre หลังแก้อยู่ [repair report](../evidence/stripe-repair-2026-09-11/README.md).

<a id="stripe-closure-plan"></a>
## 9. แผนปิดช่องว่างสำหรับ developer — 2026-09-11

ข้อกำหนดส่วนนี้เป็นงานที่ต้องทำต่อ ไม่ใช่ผลทดสอบใหม่. Source contract อยู่ [P26 §14–15](../specs/mangmee-billing-subscription-spec-th.md#billing-recovery-contract) และ [P29 repair requirements](../specs/mangmee-company-plan-term-spec-th.md#plan-term-repair).

### 9A. S-pre: transaction, idempotency และ lifecycle

1. สำรวจ writers ของ `Company.status`, `CompanyPlanTerm` และ entitlement ก่อนแก้: manual renew, set term, lifecycle admin/security, sweep และ paid apply ในอนาคต. เลือก transaction/row lock หรือ CAS ที่ใช้ร่วมกันจริง; การ lock เฉพาะ renew หรือเช็กค่าก่อนเปิด transaction ไม่ปิด race. ใช้ลำดับ lock เดียวกันและ bounded retry สำหรับ transaction conflict; ไม่เรียก Stripe/LINE/email ระหว่างถือ DB lock.
2. สำหรับ manual renew ใช้ company transaction boundary: อ่าน current term/status + ตรวจ audit replay **ภายใน** boundary, เทียบ normalized command `(companyId, action, requestId, days)` แล้วคำนวณวันจาก current term. Key เดิม/payload เดิมคืนผลสำเร็จเดิมและอ่าน current access ได้โดยไม่แก้วันซ้ำ; key เดิมแต่ days ต่างต้อง conflict ชัดเจน. สองคำสั่งคนละ key ที่มีเจตนาต่อจริงต้องสะสมวันครบ ไม่ lost update. ใช้ audit/command pattern ที่มีอยู่; ห้ามเพิ่ม unique ให้ `AuditLog.requestId` ทั้งตารางเพราะหนึ่ง request มีหลาย audit actions ได้.
3. ทางแก้ที่ควรเริ่มคือ term update + lifecycle transition/audit ใน transaction เดียว ผ่าน logic เดิมที่รับ transaction ได้. ถ้า architecture ทำ atomic ไม่ได้ ต้องมี durable pending operation และ worker resume ก่อนคืน completion. จุด fail ก่อน commit ต้อง rollback ทั้งชุด; จุด fail หลัง commit ก่อน response ต้อง replay โดยไม่ต่อเพิ่ม. สำหรับระบบที่เคยค้างแบบ R01 ให้เพิ่ม read-only reconciliation report ของ audit/term/status ก่อนซ่อมเป็นรายบริษัท: หลักฐานไม่พอหรือมี admin hold ตามหลังให้ส่งตรวจ ไม่ activate บริษัท DISABLED ทั้งหมด.
4. Sweep ต้องอ่าน deadline/revision/status ใหม่ภายใน boundary ที่ใช้ตอนเปลี่ยน lifecycle; query batch เป็นเพียง candidate. ถ้าไม่ due แล้วให้ข้ามทั้ง disable/stamp/notification. Admin disable ที่เกิดกับบริษัท term-disabled อยู่แล้วต้องคง provenance ของ admin hold; ห้ามเหลือ marker ที่ทำให้ payment/replay ปลด hold ได้. ปิด race ทั้ง renew→sweep, sweep→renew และ admin/security hold→activation.
5. `warn*SentAt`/`expiredNotifiedAt` ไม่ใช้แทน durable delivery. เก็บ intent ที่กู้คืนได้ใน transaction เดียวกับการ claim แล้วให้ notification worker ส่งแยก implementation S-pre reuse ตาราง `NotificationEvent`/`NotificationRecipient`/`NotificationDelivery` ที่มี worker อยู่แล้ว โดยเขียนผ่าน transaction-bound repositories + advisory lock ตาม dedup key; ไม่เพิ่ม OutboxEvent consumer ซ้ำอีกชั้น. Worker `ProcessDueDeliveriesUseCase` ใช้ queue/retry เดิมหลัง commit. การกู้ partial legacy recipient ต้องสร้างเฉพาะ delivery ที่ขาดแม้อยู่ใน cooldown. Dedupe ตาม company + term revision/period + warning point/event; งานของรอบเก่าหลัง renew ต้องไม่ปิดบริษัทหรือส่งข้อความหมดอายุผิดรอบ.
6. “ครั้งเดียว” หมายถึง business mutation และ durable notification event ถูก dedupe; external delivery อาจ retry ได้และไม่อ้างว่า exactly-once ถ้าผู้ให้บริการไม่รับประกัน. การส่งล้มเหลวไม่ย้อน paid access, ไม่ทำเครื่องหมาย delivered และไม่ suppress การสร้าง delivery ที่ยังขาด.

### 9B. S1/S3: แยก provider receipt ออกจาก paid apply

| ขอบเขตข้อมูล | Invariant ที่ต้องบังคับใน DB/application |
|---|---|
| Customer/base subscription | mapping ต่อ company + environment + account; provider ID เดียวห้ามผูกหลายบริษัท. มี active base intent ได้ชุดเดียวรวม pending/unknown/past_due; ไม่ใช้ email หรือ metadata อย่างเดียวตัดสิน ownership |
| Attempt | เก็บ offer/version, normalized request fingerprint, policy revision และ provider IDs ที่รู้แล้ว; persist intent ก่อน provider call. Response หาย/500 ให้ตรวจ object เดิม ไม่สร้าง key ใหม่เพื่อหนี unknown |
| Inbox | unique account/environment/event ID; raw signature/mode ถูกก่อนรับ. DB เก็บไม่ได้ให้ non-2xx; duplicate ที่รับแล้วตอบได้โดยยังรักษางาน pending. Valid event ที่ mapping ยังไม่พร้อมอยู่ใน recovery queue ไม่ทิ้งและไม่ grant |
| Verified invoice/apply | unique account/environment/invoice ID สำหรับ base-period apply พร้อม invoice lines/Price/service period/provenance. คนละ event หรือ return reconciliation ของ invoice เดียวกันต้องเข้าทางเดียว; การแก้ subscription/refund เป็น operation/version ที่แยก ไม่เพิ่ม period จาก invoice เก่า |
| Term/entitlement/access | apply ตาม service period ที่ตรวจแล้ว + current hold/override + entitlement CAS/epoch. เก็บ verified payment ได้แม้ถูก hold แต่แสดง paid-but-held; ไม่ทับ admin deny หรือ quota used. Billing ledger อยู่ใน Mangmee ไม่สร้าง ERP expense ของบริษัทลูกค้า |
| Retry/reconcile | claim/lease มี fencing, bounded backoff และงานที่เกิน retry ย้ายไป ops queue ที่ replay ได้; crash ทุกจุด resume operation เดิม. Scheduled repair/return/webhook ใช้ invoice apply เดียวกัน |

ชื่อด้านบนเป็น logical records ไม่บังคับตารางใหม่ทุกแถว; reuse schema/helpers ที่มีและระบุ migration/unique scope จริงก่อนเริ่ม S1. ตัวอย่างใน repo: `OutboxEvent` และ `SetPartnerFeaturesUseCase` มี durable claim/CAS/command patterns; การอ่าน audit ก่อน transaction ของ manual renew รุ่นก่อน S-pre ไม่ใช่ precedent ที่ปลอดภัย; รุ่นแก้ตรวจภายใน Company row lock แล้ว.

Stripe ไม่รับประกันลำดับ event และ local queue ยังต้องทำงานต่อหลังตอบรับ webhook; key ของ Stripe อาจหมดอายุหลังอย่างน้อย 24 ชั่วโมง. จึงใช้ durable local attempt/invoice completion ร่วมกับ provider idempotency ไม่เอาอย่างใดอย่างหนึ่งแทนกัน. ทบทวน official docs 2026-09-11: [webhooks](https://docs.stripe.com/webhooks), [idempotent requests](https://docs.stripe.com/api/idempotent_requests).

### 9C. Recovery API/UI contract และ terminal attempts

- Reuse `GET /v1/plan-term/notice` สำหรับ P29 โดย selected company จาก route ต้องถูกส่งผ่าน `X-Company-Id`; API validate membership/permission ของบริษัทนั้น ไม่ fallback ไป default company เมื่อ explicit ID ไม่ถูกต้อง. Billing target routes เลือกหลังสำรวจ routing แล้วใน [UI spec §5](../specs/mangmee-line-web-billing-ui-spec-th.md); ต้องลง concrete DTO/error codes ใน `packages/contracts` และทำ backend ให้ตรงก่อน web consumer. ใช้ runtime BillingController/BillingAdminController และ packages/contracts/src/billing.ts เป็น concrete endpoint/DTO contract; UI spec เก็บ journey และ error/recovery obligations.
- Recovery scope ยกเว้นเฉพาะ term-expiry restriction สำหรับ authenticated current members; OWNER อ่านรายละเอียด/ทำ billing actions ที่เปิดแล้ว, employee เห็นข้อความกลางแต่สร้าง checkout/Portal ไม่ได้. รักษา membership revocation, tenant isolation, platform/security holds และ business routes. ไม่ทำ `@Public()` ให้ customer recovery route และไม่ขยาย bypass ให้ทุก route ของบริษัท DISABLED.
- แยก `200 null` (ไม่มี term), `401` (login), `403` (ไม่มีสิทธิ์), `5xx`/network failure และ loaded OWNER/employee. Helper ของ decorative banner ที่คืน null ทุก error ใช้เป็น contract ของ recovery page ไม่ได้. ระหว่างเปลี่ยนบริษัทให้ยกเลิก/ignore response เก่าและ clear cache ด้วย company identity.
- Checkout/status/Portal ต้องใช้ company/attempt ที่ backend ผูกไว้; ตรวจ OWNER ใหม่ทุกครั้งรวมหลังเปลี่ยนเจ้าของ. Client ส่งราคา, Stripe customer/subscription ID หรือ return URL เองเพื่อข้าม mapping ไม่ได้. สถานะส่ง server-derived next action + reference + observedAt; hosted URL อายุสั้นต้องสร้างหลัง authorization และไม่ลง analytics/log.
- Return page แสดง paid-pending จน apply สำเร็จ, poll แบบ bounded แล้วแสดงช่องติดตามเมื่อเกินเวลา; ใช้ retry-status ไม่ใช่ปุ่ม pay ใหม่. การกลับ browser ไม่ใช่เงื่อนไขของ activation: T17 ต้องปิด browser แล้วพิสูจน์ว่า webhook เปิดสิทธิ์ได้.
- First invoice ที่ยัง open/payable กับ `incomplete_expired`/void เป็นคนละ recovery. Stripe ระบุ initial automatic-collection subscription มีหน้าต่างจ่าย 23 ชั่วโมง และ Checkout ที่ยัง incomplete มีข้อจำกัดการแก้ invoice/subscription; ใช้ current Session/Invoice/Subscription state ตาม API version แทน hard-code ว่า retry invoice เดิมทุกกรณี. Terminal attempt ต้อง reconcile/ปิดเดิมก่อนสร้างใหม่ภายใต้ company intent lock. Checkout session expiry ไม่ใช่ timer เดียวกับ subscription expiry. [Stripe subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview)

### 9D. ชุดทดสอบเพิ่มที่ต้องเขียน — ทั้งหมด NOT RUN

RG01–RG05 ขยาย existing browser/PG suites ใน S-pre เฉพาะ manual renew/notice/business routes ที่มีแล้ว; ไม่ให้ S-pre ขึ้นกับ billing UI/Portal ที่ยังต้องสร้างใน S2–S4. นำ negative/context/error cases เดิมไปรันกับ billing routes อีกครั้งเมื่อมีจริงตาม T30/T41 และเพิ่ม paid-pending/poll-timeout ตาม T28. RG06 เพิ่มเมื่อ S1/S3 มีจริง. อย่าใช้ count ของ cases เดิมแทน coverage ใหม่. ถ้าทางแก้ R01 เปลี่ยนเป็น atomic rollback ให้ปรับ injection ให้พิสูจน์ rollback + replay success ตาม boundary ใหม่ โดยคง invariant ไม่ใช่ยกเลิก assertion เพราะ implementation เปลี่ยน.

| ID | ลำดับที่ต้องจำลอง | ผลบังคับ / ผูกกับ T |
|---|---|---|
| RG01 | same key พร้อมกัน; same key/different days; ต่าง key พร้อมกัน; crash ก่อน commit และหลัง commit ก่อน response | สำเร็จหนึ่ง operation ต่อ key; conflict payload; ต่าง key ไม่ lost update; replay ไม่เพิ่ม period/audit ซ้ำ — T18/T20/T23/T28 |
| RG02 | renewal แทรกระหว่าง sweep SELECT→stamp→disable; admin disable ซ้ำบน term-disabled; SUSPENDED/ARCHIVED ชน activation; หลาย sweep พร้อมกัน | term ปัจจุบันไม่ถูกปิดด้วยแถวเก่า, hold ชนะ payment, ไม่มี lifecycle/audit ซ้ำ — T24/T33 |
| RG03 | notification throw ก่อน event persist/หลัง event ก่อน delivery; worker restart; renew แล้ว replay warning เก่า | durable job ไม่หาย, recipients/delivery ที่ขาดกู้ได้, old notice ไม่ปิดสิทธิ์/ส่งผิดรอบ, ไม่ duplicate business event — T25 |
| RG04 | active/term-expired/term-disabled/admin-held × OWNER/employee/revoked/บริษัทอื่น; explicit ID ผิด | notice/auth/permission/business isolation ตาม P26 §14; OWNER ไม่มีสิทธิ์ admin renew; เพิ่ม employee checkout/Portal denial ใน S2 — T03/T30/T33 |
| RG05 | OWNER A→B ขณะ response A ช้า, default company ยัง active, 401/403/500/offline, refresh/back ของหน้า renew | context ถูกบริษัท, error ไม่แปลงเป็น employee/no-term; 390px/desktop/keyboard. เพิ่ม billing pending/poll-timeout/no-repay ใน S4 — T28/T41 |
| RG06 | webhook ก่อน mapping, duplicate/different event IDs ของ invoice เดียว, stale invoice หลัง upgrade/hold, invalid signature/test-live mismatch, terminal checkout, lost provider response | verified invoice apply ครั้งเดียว, unmapped recover ได้, no unauthorized grant/new duplicate subscription; snapshot parser ตรง version — T16–T24/T29–T32 |

### 9E. Business/config handoff และนิยาม “จบ”

- ปิด B01–B10 ด้วย decision record ที่มีผู้ตัดสิน/วันที่/revision/ผลต่อลูกค้า/Stripe setting/ข้อความทั้งสอง repo/test IDs. อย่านับคำสั่ง “แก้ plan/spec” เป็นอนุมัติ grace 7 วัน, ภาษี, proration หรือ refund. ส่วนที่ขาด policy ห้ามเปิด new sale/action ที่ขึ้นกับส่วนนั้น; existing paid recovery และ cancellation ต้องมีทางดำเนินการตามสิทธิ์เดิม.
- รุ่นแรกต้องระบุรายการที่เปิดและที่ปิดจริง เช่น trial conversion, coupon/zero invoice, plan changes, refund/debt flow, custom ENTERPRISE; ปิดปุ่มอย่างเดียวไม่พอ ต้องตรวจ API/Portal configuration ด้วย. Customer support ต้องมีทางจัดการ cancellation/refund ที่นโยบายรองรับแม้ยังไม่มี self-service UI.
- บันทึก cost/price/ภาษีที่อนุมัติ, billing consent version/วันรับเงื่อนไข/บริษัท/ผู้สั่งซื้อ, ช่องติดตาม paid-pending และผู้รับผิดชอบ incident; ห้ามเลือกตัวเลขใหม่จากค่า sample ของ Stripe. หน้า marketing/app/Checkout ต้องบอกค่าเดียวกันก่อนจ่าย.
- **จบงานเอกสาร — DONE:** P26/P29/เว็บอ้าง contract ชุดเดียว, R01–R07 มีผลจริงและ scope, B01–B10 ยังไม่ถือเป็นมติ.
- **จบ S-pre — DONE local:** expanded browser 20/20 + PG 15/15 รวม baseline/RG01–RG05, focused 198/198, production-source typecheck API/web ผ่าน. [หลักฐาน](../evidence/stripe-repair-2026-09-11/README.md) มี source SHA/DB/API/UI/cleanup และ read-only legacy report. Disposable company/user/notification/audit เหลือ 0; legal evidence แบบ append-only คงตาม policy. Marketing pre-LIVE ผ่าน 2 viewport. ยังไม่ deploy.
- **จบ integration:** S0–S5 ผ่าน, RG06 และ applicable T01–T42 มี provider sandbox + app DB/API/browser evidence, business policy/config ตรงทั้งสอง repo, R04 marketing ผ่านจริง. ห้ามนับ simulated manual renew เป็น Stripe PASS.
- **เปิดใช้จริง:** ทำ operational acceptance §6 และ deployment protocol ของ repoครบ; เอกสารครบหรือ sandbox ผ่านยังไม่ใช่ LIVE acceptance. ไม่เปิด paid offers จากงาน review นี้.


### Collection checkpoint and next restart slice — 2026-09-13

49combinedHTTP/browsergroupsPASS with simulatedStripe;5focusedcollectionworkerfaulttestsPASS;API/webtypechecksPASS. Ordinary/prepaidcancel/resume, immutablecommandreservation/withdrawal/permanentUIlink, source/permission/leasefences and provider-observedrecovery are implemented. Separate nativeStripeTestClockproof confirms cancel_at at purchasedexpiry, resumewithoutcharge, and automatictermination. See integrationevidence/source receipt. This does not complete the full change-plan/operator/LINE matrix.

Next implement explicit restart after expired and terminalStripecollection: samecustomer/newsubscription under a fresh reviewed purchase, old invoice/contract history preserved, no expired quota revival, currentpaid/grace/security/source checks, duplicate/debt/refund/dispute refusal, new paid evidence before switching contract/applying access. Lower-cap restart uses the same explicit branch/seat selection required by downgrade. Never clear old baseSubscriptionId just to bypass a guard. Continue remaining full-scope work and CI/merges;NO DEPLOY.

### Notification execution slice — 2026-09-13, verification in progress

Restart and mapped financial observations now have the 60-group checkpoint recorded in integration evidence. The next slice wires the existing payment outbox to current OWNER web/LINE notification rows and verified-email Postmark status notices. Test actual AppModule/PostgreSQL worker routes with synthetic Stripe, LINE and Postmark transports: duplicate/resolved event replay, stable LINE retry after lost response or crashed worker, wrong channel, owner withdrawal, unverified/suppressed email, Postmark unknown lookup, gate close/reopen and expired retry binding. Verify all notification failures leave paid term and receipt grants unchanged. No native LINE/inbox claim, no deployment. Operator delivery history and controlled retry remain part of the remaining control work.


### Current execution: prepaid upgrade

Implement the pack amendment's durable one-time difference payment with immutable paid-segment history and isolated Stripe invoice preview. Reuse repeat hold/journal/schedule/compensation, exact paid-chain parser and atomic grant rather than adding another payment engine. Required checks: monthly half-period and upfront annual, multiple prepaid years, repeated tier upgrades, consumed quota unchanged, exact next-renewal full price, stale quote/boundary/source/owner/tax changes, failed/expired/UNKNOWN/replay/concurrent request, wrong preview/payment, no access before confirmed payment/schedule, historical documents and web→LINE shared admission. Current status is implementation in progress, not acceptance PASS. No deploy.

2026-09-23 owner choice: STARTER used 1 receipt → BASIC on the same Bangkok purchase day gives 49 remaining and charges the full 250-baht tier difference; later days prorate money by exact time and round receipt deltas half up per paid segment. A separate full-price purchase on an active one-time package gives 29 + 50 = 79 remaining in the example, applies higher-tier features immediately after verified payment, and extends expiry from the old paid-through. Implement a pinned `FULL_PACKAGE_UPGRADE` quote using catalog Price, one-time payment evidence, unchanged source/debt/refund/capacity guards, and the existing repeat grant/term path. Keep sales deals and live auto-renewing subscriptions out of this choice. Verify quote totals, later upgrades across mixed paid-tier segments, profile detour, stale source and receipt apply. No deployment or sale gate change from this slice.

2026-09-14 capacity continuation: shared OWNER retained-resource DTO/source hash, read-only constraints/default-branch review, transactional paid application without history deletion, lower-cap restart and paid-held repair from original invoice, then scheduled downgrade using the same selection. Verify tenant/OWNER, stale selection, role/branch scope changes, concurrent activation, payment failure/replay, protected work, existing UI recovery and no second payment. Current78group checkpoint does not yet cover this selection addition.
