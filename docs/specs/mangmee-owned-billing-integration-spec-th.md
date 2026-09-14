# ส่วนที่มั่งมีต้องทำเอง — developer design และขอบเขตการพิสูจน์

> **Implementation status — IN PROGRESS:** สถานะโค้ด, CI, งานที่ยังค้าง และข้อจำกัดล่าสุดอยู่ที่ [implementation status](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผล E2E และ source ที่ทดสอบดู [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); แยกผลจำลองออกจากผล native provider และไม่รวมจำนวนทดสอบที่ซ้ำกัน. ข้อความตามวันที่ด้านล่างเป็นประวัติของแต่ละช่วงงาน. ยังไม่ deploy; การ merge develop/main ต้องผ่าน CI และตรวจ scope ที่ค้างก่อน.


> **Owner amendment 2026-09-13:** [มติล่าสุด](mangmee-billing-pack-amendment-2026-09-12.md): ซื้อเริ่ม/จ่ายทันที, VAT OFF ปรับผ่าน Admin, upgrade จ่ายส่วนต่างเริ่มทันที/วันสิ้นรอบเดิม, downgrade สิ้นรอบที่จ่ายแล้ว, รายปีได้โควตา 12 เท่าทันที; ใช้หมดซื้อแพ็กเกจเต็มเพิ่ม ซื้อเฉพาะใบเป็น HIDDEN ตามมติล่าสุด: ซ่อนไว้ทุกช่องทางและยังไม่เปิดขาย. ซื้อแพ็กเกจเดิมซ้ำเพิ่มโควตาทันทีและต่ออายุจากวันหมดอายุเดิม; ยังไม่เปิดขายก่อน readiness. ไม่มี deploy; full paid E2E ยัง IN PROGRESS.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](../plans/mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

> **Controls 1–8 / no-deploy design 2026-09-11:** [C01–C08 spec](mangmee-billing-controls-spec-th.md) และ [implementation/CT01–CT32 plan](../plans/mangmee-billing-controls-plan-th.md) ครอบคลุมoverview, issue queue, safe repair, permissions, versioned policies, action gates, reconciliation และaudit/temporary overrides. Routine settingsผ่านเว็บหลังinitialimplementation; web/LINE/marketingอ่านapprovedrevisionเดียวกัน. ปิดขายใหม่ไม่หยุดpaid apply/recovery; rich menuเก่าต้องกลับไปstatus/supportได้. Target control suiteยังไม่implemented/NOT RUN; currentrepair evidenceแยกจากStripe/native acceptance.

สถานะ 2026-09-11: **DESIGN / current-entry repairs implemented locally; Stripe runtime NOT IMPLEMENTED**. ใช้ร่วมกับ [P26](mangmee-billing-subscription-spec-th.md), [UI U01–U12](mangmee-line-web-billing-ui-spec-th.md), [แผนและ LB01–LB20](../plans/mangmee-line-web-billing-ui-plan-th.md), [bug/impact/evidence](../research/stripe-line-web-gap-closure-2026-09-11.md). เอกสารนี้กำหนด implementation boundary และวิธีรับงาน ไม่ใช่หลักฐานว่ามี Checkout endpoint แล้ว.

## 1. ผู้รับผิดชอบแต่ละช่วง

| ช่วง | มั่งมีทำ | Stripe ทำ | ผลยืนยันที่มั่งมีต้องตรวจ |
|---|---|---|---|
| สมัคร/เข้าใช้ | web signup, LINE proof, account linking, company selection, legal acceptance, session | ไม่มีหน้าที่เชื่อมบัญชีมั่งมี | user + active membership + company + role จริง; email ติดต่อไม่ใช่ identity proof |
| ก่อนจ่าย | catalog, quota, billing profile, quote, consent, purchase intent | Price/Customer และยอดใน hosted Checkout ตาม config | offer/version/currency/tax/period ตรง quote และ policy ที่อนุมัติ |
| รับเงิน | API สร้าง Checkout, mapping และ idempotency | card entry, 3DS, collection, subscription invoice | verified provider state ของ invoice ที่ผูกบริษัทนี้ |
| หลังจ่าย | durable apply, entitlement/term, hold enforcement, UI refresh, support | webhook, Invoice/Receipt, payment status | paid กับ applied แยกกัน; business action ผ่านจึงแสดงเปิดใช้แล้ว |
| ตัดรอบ/บัตร/ยกเลิก | Portal session, policy capabilities, reconciliation, access | Billing/Portal/retry ตาม config | return ไม่ใช่หลักฐาน cancellation หรือ paid |
| เอกสาร/แจ้งเตือน | authorize document open, app/LINE status, outbox/dedupe | customer Invoice/Receipt และ email ที่เปิดตั้งค่าไว้ | มีเอกสารจริงก่อนแสดงลิงก์; Postmark ไม่สร้าง receipt ซ้ำ |
| Support/บัญชีมั่งมี | invoice/company reference, gross/fee/refund/payout reconciliation, operator audit | provider records และเอกสารค่าบริการตามบริการ | payment ไม่เท่ากับ payout; ไม่ลงบัญชีจากข้อความ LINE |

## 2. ตำแหน่งโค้ดและขอบเขตข้อมูล

- Module ใหม่ `apps/api/src/modules/billing/` ถือ application logic ของค่าบริการมั่งมี; DTO ใน `packages/contracts/src/billing.ts` ก่อนสร้าง consumer. เป็น **target paths** ยังไม่มี runtime. ไม่ใช้ payment/ledger ของธุรกิจลูกค้ามาเก็บ SaaS invoice.
- Reuse `Company`, membership/OWNER, permission resolver, Company row lock, `CompanyPlanTerm`, entitlement application, audit และ OutboxEvent/notification delivery. Stripe adapter อยู่ infrastructure; use case ไม่เรียก SDK จาก controller หรือ frontend.
- App UI อยู่ `apps/web/src/features/billing/` และ routes U02/U04–U12. ใช้ API error/CSRF/session/components เดิม. mangmee_web ส่งเพียง offer hint และ entry attribution ไป app; ไม่มี Stripe/Postmark secret หรือ provider mutation.
- LINE ใช้ webhook controller/buffer/`ProcessLineWebhookUseCase`, LIFF static script, ID verifier, handoff และ BFF เดิม. เก็บคนกดกับ chat destination คนละค่า. Group/room ไม่เป็น identity ของผู้ซื้อ.
- แยก development/test/live ด้วย account + mode ในทุก provider key, worker, query และ unique constraint; test invoice ไม่มีสิทธิ์แตะ live company.

### 2.1 Durable schema เป้าหมาย

ชื่อด้านล่างเป็น schema proposal ที่ developer ต้องสร้างใน migration S1; ไม่อ้างว่ามีตารางเหล่านี้แล้ว. หนึ่งแถวต่อหลักฐานธุรกิจ ไม่สร้างตารางซ้ำแยก web/LINE.

| Record | Fields ที่ต้องมี | Constraints / lifecycle |
|---|---|---|
| BillingAccount | companyId, stripeAccountId, livemode, customerId, baseSubscriptionId nullable, activeAttemptId nullable, version, observedAt | unique(companyId, stripeAccountId, livemode); unique(account, mode, customerId) และ baseSubscriptionId ที่ไม่ null. Company lock คุมการเปลี่ยน pointer |
| BillingAttempt | id opaque, billingAccountId, initiatingUserId, channel, idempotencyKey, requestHash, quoteSnapshot JSON/version, consentSnapshot, policyRevision, status, checkoutSessionId nullable, subscriptionId nullable, timestamps | unique(accountId,idempotencyKey), unique(account,mode,checkoutSessionId). เก็บ one-collectible-attempt ผ่าน activeAttemptId ภายใต้ lock; ห้าม clear pointer ขณะ UNKNOWN |
| BillingInvoice | id local, accountId, providerInvoiceId, subscriptionId, offer/Price snapshot, currency, invoice/line totals, periodStart/End, providerStatus, evidenceHash, applyStatus/error, appliedAt | unique(accountId,providerInvoiceId). invoice เดียวหลาย events/apply worker ใช้แถวเดียว. Local id ใช้ใน history/URL |
| BillingProviderEvent | account/mode/eventId, type, objectId, API version, receivedAt, verified payload/evidence, status, lease/version, attempts, retryAt, lastError | unique(account,mode,eventId); index(status,retryAt). บันทึก durable ก่อน 2xx; payload จำกัดสิทธิ์/ขนาด/retention และ redact logs |
| Existing OutboxEvent/Audit/Notification | operation key, company/user, invoice/attempt reference, before/after, revision | same transaction กับ paid apply; per recipient/channel dedupe และ recheck recipient ตอนส่ง |

Billing profile ใช้ Company billing snapshot ที่มีอยู่ถ้าครบ; snapshot ชื่อ/ที่อยู่/เลขภาษี/อีเมลใน quote แยกจาก profile ปัจจุบัน. ห้าม overwrite ประวัติ Invoice จากการแก้ profile. ไม่เก็บ PAN/CVC, raw handoff/Checkout/Portal/document URLs ใน DB log/analytics. Provider identifiers อยู่ backend; redacted reference เท่านั้นใน support screen ที่ไม่ผ่านสิทธิ์การเงิน.

Billing notification execution uses the existing paid-apply OutboxEvent, NotificationEvent/Recipient/Delivery and Postmark EmailSendAttempt. The dedicated consumer verifies the invoice is APPLIED, its company/account/mode and current ACTIVE OWNER recipients, then atomically creates the deduplicated in-app/LINE event before external delivery. A replay must not recreate a resolved billing event or mint a second delivery. External delivery observes notification_delivery gate, current OWNER/user/company security state, preferences and the exact configured LINE channel; never use a channel-agnostic identity fallback for billing. Postmark sends a status notice to a currently verified OWNER email with a durable invoice/user intent key; Stripe remains the issuer/sender of invoice/receipt documents. Do not attach or recreate fiscal PDFs. No verified email or linked LINE is an explicit delivery limitation; the web billing status/history remains available and operator cases retain failures.

Before external I/O persist the delivery intent and stable retry identity, and recheck source/recipient/gate. Provider acceptance, observed delivery and entitlement application remain separate states. Unknown email delivery uses existing Postmark lookup/backoff/possible-duplicate semantics; unknown LINE uses its stable retry key only within supported retention and otherwise needs operator review. Notification retries never perform billing or entitlement mutations. No provider network call while holding company/invoice state locks. Include duplicate outbox, worker crash, lost provider response, owner removal, wrong LINE channel, unverified email, bounce/suppression, gate close/reopen and absent recipient cases in local simulation before enabling this consumer.

Implementation boundary: billing owns both `billing.invoice.applied` and `billing.status.email` outbox events, and its WEB/LINE delivery rows. Generic consumers exclude those records. The LINE journal lives on existing NotificationDelivery metadata with a claim token, five-minute SENDING lease, original start time and a hash binding channel/recipient/message. Recover with the same delivery ID/retry key and unchanged binding for at most 23 hours; then retain an operator-review failure. Quiet hours defer delivery; explicit opt-out suppresses it. A missing channel/identity and revoked OWNER are visible skipped/suppressed outcomes. Payment drain results and notification results are separate. LINE acceptance does not prove inbox receipt; its retry key is valid for 24 hours according to [LINE retry documentation](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/), so the 23-hour application ceiling leaves a margin.

Migration: additive tables/nullable mappings ก่อนเปิด routes; ไม่มี backfill paid entitlement จากชื่อ tier เดิมหรือ manual term. Import ลูกค้าเก่าเฉพาะ mapping ที่ตรวจแล้วพร้อม audit/B09. ทดสอบ unique constraints ด้วย PostgreSQL จริง; rollout reader → worker → TEST routes → LIVE หลัง gates. Rollback ปิด new sales โดยยังรับ event/reconcile/status เดิมได้; ห้าม drop paid evidence.

## 3. Command และ transaction ที่ developer ต้องทำ

### 3.1 Quote และเริ่ม Checkout

1. Authenticate; path companyId เท่ากับ header; active OWNER + permission + legal + platform/company gate. Expiry recovery ใช้ action allowlist, ไม่ยก security hold.
2. Server อ่าน catalog/policy/usage/profile; สร้าง quote snapshot อายุ 10 นาที (technical expiry, ไม่ใช่สิทธิ์ใช้ฟรี), hash/version และ consent revision. ส่ง integer satang + THB และ Bangkok display dates. จำนวนเงินจริงจาก approved config เท่านั้น.
3. POST checkout รับ quoteId/version, fields, consent revision และ Idempotency-Key. Validate allowlist/length; ไม่รับ price/customer/subscriptionId/amount/returnUrl. Recheck snapshot; stale → 409 BILLING_QUOTE_STALE พร้อม review ใหม่. คง key เดิมเมื่อ network retry; same key/different requestHash → 409.
4. Company row lock → reuse existing command หรือ reserve activeAttemptId + persist CREATING. Commit ก่อนเรียก Stripe; ไม่ถือ DB lock ขณะ network call.
5. เรียก Stripe ด้วย stable idempotency key จาก account+attempt+operation. Customer creation ใช้ operation key อีกชนิดที่ stable; ห้ามสร้าง Customer ใหม่ในทุก retry.
6. Persist returned mapping ด้วย CAS/version. Lost response/timeout → UNKNOWN และ enqueue reconcile; UI มีเพียงตรวจสถานะ/support. ห้ามให้ key ใหม่เปิดอีก subscription. ห้าม rotate provider idempotency key อัตโนมัติเมื่ออายุผ่าน provider retention; ค้น mapping/metadata และ operator recovery ก่อน.
7. Return URL สร้างจาก configured app origin และ local attemptId; ค่า success/cancel query ไม่มี authority. ถ้า webhook มาถึงก่อน mapping ให้เก็บ unmapped event แล้ว bind ผ่าน persisted attempt metadata ที่ server ตั้งเอง; mapping mismatch ต้อง quarantine ไม่ grant.

### 3.2 Verified invoice → เปิดสิทธิ์

1. Verify Stripe raw body/signature, configured account/mode/API parser version; invalid → 4xx และไม่มี durable grant. ถ้า valid แต่ DB ไม่รับงาน → 5xx เพื่อ redelivery. Duplicate ที่รับ durable แล้วตอบ 2xx และคง pending work.
2. Worker claim lease/version; อ่าน Invoice/Subscription ล่าสุดตาม adapter. ตรวจ Customer/account/company, subscription base item, allowed Price/currency จาก historical approved contract ของรายการนั้น, invoice lines และ service period; ไม่ใช้currentcatalogเพียงอย่างเดียวปฏิเสธPriceที่เลิกขายหลังสร้างSessionแล้ว. ไม่ใช้ metadata จาก client หรือ event timestamp อย่างเดียวแทน version fence.
3. `invoice.paid` ที่ตรง approved rules → บันทึก verified invoice. Trial/zero/coupon/manual marked-paid/credit/out-of-band invoice ต้องเข้ากติกา B01/B08 ที่อนุมัติ; ขณะยังไม่อนุมัติไม่ให้ generic invoice.paid เปิด paid tier.
4. Company lock + invoice apply lock → reread current lifecycle, mapping, policy/offer version และ applied marker. Apply paid period จาก invoice base line ผ่าน application service ที่ใช้ transaction เดียวกัน; ไม่เรียก ADMIN manual-renew HTTP route และไม่บวก 30 วันจากวันรับ webhook.
5. Commit term/entitlements/version/audit/outbox/applied marker ร่วมกัน. Old invoice ไม่ย้อน period หรือ downgrade tier ใหม่; use max paid-through เฉพาะภายใต้ provenance/version ที่ตรวจแล้ว. ไม่ reset quota หรือสร้าง branch/user/role.
6. ถ้า admin/security hold ชนะ race ให้บันทึก paid + HELD และ reference สำหรับ support. ไม่ยก hold หรือส่ง “เปิดใช้แล้ว”. ถ้า crash ก่อน commit rollback ทั้งชุด; crash หลัง commit worker replay ต้อง no-op แล้วต่อ delivery ได้.
7. App refresh permission projection/session epoch หลัง commit; business API ยังตรวจ current state. Return page เห็น PAID/APPLYING จน read-after-write ยืนยัน APPLIED + access allowed. ไม่รอ email, LINE delivery หรือ payout ก่อนเปิดสิทธิ์.

### 3.3 Reconcile / lease / retry

- Webhook, return refresh และ scheduled repair เรียก reconciler เดียวกัน; refresh จาก UI rate limit แยกจาก worker. จัดลำดับ lock แบบเดียวเสมอ (Company → billing account → invoice) เพื่อเลี่ยง deadlock.
- Claim ด้วย CAS + lease expiry; ทุก final write ตรวจ version/fencing token. ใช้ retry/outbox pattern เดิม; exponential backoff พร้อม jitter/Retry-After, cap และ dead-letter ที่ replay invoice/attempt เดิมได้. ไม่มี blanket catch แล้ว mark processed.
- Reconcile pending/unknown/apply-failed และ recent subscriptions แบบ overlap cursor; เก็บ checkpoint หลัง durable enqueue. Provider outage ไม่เปลี่ยน PAID เป็น FAILED และไม่ทำ grant จาก cache ที่ไม่ผ่านหลักฐาน.
- terminal attempt ปลด active pointer หลังตรวจ provider ว่า collect ต่อไม่ได้จริงและไม่มี payable invoice/subscription ที่ชน; cancel/back ของ browser ไม่ปลดเอง. มี subscription เดิมให้แก้การชำระเดิม ไม่สร้างฐานสมาชิกใหม่.
- SLA สำหรับทดสอบภายใน: local/sandbox happy-path observed paid → access ภายใน 30 วินาที; เกิน 2 นาทีให้ UI support/reference และ ops alert paid-not-applied. เป็น acceptance target ไม่ใช่คำสัญญา SLA ลูกค้าหรือหลักฐานที่ผ่านแล้ว.

### 3.4 Integration edges จาก developer readiness review

ใช้ [control spec §7](mangmee-billing-controls-spec-th.md) กับ customer/provider flowด้วย: intent/body/keyคงเดิมผ่านBFF refresh; business reservationกันสองคนคนละkey; historicalquote/consent/Priceคงอยู่เมื่อpublishใหม่; explicitPortalconfigurationตามapprovedpolicyทุกsession. ปิดออกลิงก์ขายใหม่ไม่ยกเลิกhostedSessionที่ออกแล้ว; EXPIRE_CHECKOUTตามobservedstateและraceกับpaidแยกจากrefund. Automatic verified-paid fulfillmentใช้serviceidentityและcurrenthold ไม่ค้างเพราะpayer/operatorเดิมถูกถอนrole; pendingmanualcommandยังต้องreauthorize.

[Readiness / F01–F24](../research/billing-developer-readiness-2026-09-11.md) ระบุ E0/B01–B10/security/setup dependencies และ [DA01–DA08](../plans/mangmee-billing-controls-plan-th.md) เพิ่มnegative/raceacceptance. ไม่มีprovider/runtimepassใหม่จากการเติมเอกสารนี้.

## 4. Event → state → UI/LINE

| Input | Server action | สิ่งที่ผู้ใช้เห็น |
|---|---|---|
| Checkout completed / return success | lookup mapping และ reconcile; ไม่ grant จาก event นี้ลำพัง | กำลังตรวจผล |
| invoice.paid ผ่าน validation | verified invoice → atomic apply | รับชำระแล้ว/กำลังเปิดใช้ → เปิดใช้แล้ว หรือ paid+held |
| invoice.payment_failed | reconcile latest invoice; retain period ตาม policy | ชำระไม่สำเร็จ + แก้บัตร/ยืนยัน invoice เดิม |
| invoice.payment_action_required | authorized hosted next action | ต้องยืนยันกับธนาคาร ไม่ชวนเริ่มซื้อใหม่ |
| subscription updated/deleted | reread current policy/provider state; update next-charge/cancel/access projection | ยกเลิกมีผลเมื่อ… หรือสิ้นสุดแล้ว ตามสถานะจริง |
| invoice finalization failed / missing document | ops queue + document pending | ยังจัดเตรียมเอกสาร ไม่แสดงลิงก์ว่าง |
| refund/dispute/credit note | record financial fact + policy operation แยกจาก base paid apply | refund/dispute ตามหลักฐาน; ไม่กล่าวว่า cancel แล้วโดยอัตโนมัติ |
| LINE “จ่ายแล้ว” / รูปสลิป / forged postback | ไม่ถือเป็น provider proof; authorized status/support path | ตรวจสถานะในหน้าบริษัท; ไม่มี grant จาก chat |

State response ของ API ต้องมี `companyId`, `attemptId/reference`, `paymentState`, `applyState`, `accessState`, `subscriptionState`, `documentState`, `allowedActions`, `observedAt`, `policyRevision`. Missing/unknown axis ไม่ให้ clientอนุมาน success. Error envelope ใช้ `{code,message,requestId,retryAfterSeconds?}` ตาม convention เดิม; 401/403/404/409/429/503 ไม่กลืนเป็น empty/success. UI route/cache key รวม companyId; abort/discard stale response เมื่อสลับบริษัท. Polling และ wireframe ใช้ UI spec §3–5.

## 5. LINE rich menu, webhook และทางกลับ

**ซ่อม runtime รอบนี้:** rich menu Ver2 ยังใช้ 6 actions ตาม manifest เดิม; เปลี่ยนเนื้อหาโปรโมชั่นใน handler ให้ตรง trial/paid availability. ไม่ต้องเปลี่ยนรูปหลักที่ระบุเพียง Promotion Package; หยุดส่งโปสเตอร์เก่าที่บอก PRO ฟรี. `/companies` รวม term-disabled ที่มี expiry marker; เปลี่ยนแพ็กเกจต้องใช้บริษัทที่เลือกหรือถาม picker แล้วให้ยืนยันคำขออีกครั้ง. สิ่งนี้ยังเป็น support request ไม่ใช่การซื้อ.

| Action ปัจจุบัน | ปลายทางจริง / เงื่อนไข |
|---|---|
| โปรโมชั่น (message) | public package card → official pricing/trial หรือ support package request; ไม่มี checkout ขณะ paid ปิด |
| /companies (message) | linked account → list/switch + web handoff; recoverable expired ยังมองเห็น; admin hold ไม่เข้ารายการ recovery |
| ถ่ายใบเสร็จ (URI) | native LINE camera; ไม่มี webhook จากการกด URI เอง. เมื่อส่งรูปค่อยเข้า receipt flow และ quota/permission guards |
| action=line-rich-talk (postback) | signed webhook dispatcher → deterministic chat entry; free text ภายหลังใช้ AI gates |
| ดูค่าใช้จ่ายเดือนนี้ (message) | company/permission/business gates เดิม; expired ต้อง recovery ไม่เรียกเป็น payment command |
| ติดต่อเรา (message) | public contact/support; การเปิดเรื่องไม่แปลว่าต่ออายุแล้ว |

**เมื่อเปิด billing slice:** เพิ่ม CTA “แพ็กเกจและการชำระเงิน” ในการ์ด/บริษัทผ่าน generic `https://liff.line.me/{configuredId}/billing`; ไม่ต้องเปลี่ยน native menu ทั้งชุดเพื่อรับเงิน. Alias `action=billing-open`/ข้อความดังกล่าวคืน generic entry เท่านั้น ไม่มี side effect สร้าง Checkout/ต่ออายุ. GET/preview/forward/group ไม่ mint session ให้เจ้าของข้อความ. คนกดต้องผ่าน ID verifier/OWNER ใหม่ ตาม UI spec purpose=billing.

- LINE signature ตรวจ raw body ก่อน parser/queue; canonical channel มาจาก server config. แยก `actorLineUserId` และ chatId. Deduplicate webhookEventId; accept หลัง durable enqueue. Event ซ้ำ/สลับต้องไม่เปิด request หรือ paid apply ซ้ำ; ใช้ timestamp/context version กัน stale company selection.
- ไม่ส่ง hosted Checkout/Portal/document URL หรือ bearer handoff ของ billing เข้ากลุ่ม. Legacy business handoff มี group semantics อยู่เดิม; billing purpose ต้องห้าม reuse permissive group branch นี้และมี regression เฉพาะก่อนเปิดเส้น billing.
- LIFF เตรียม URL แล้วแสดงปุ่ม; user gesture เปิด external browser โดยตรง. ไม่ consume ใน LIFF ก่อน. Retry/refusal ล้าง URL เก่า; stale/used token ต้องพิสูจน์ใหม่. Browser สอง context ไม่แชร์ cookie; success/cancel/Portal อยู่ browser ที่มี session. ปุ่มกลับ LINE ใช้ OA URL จาก config; ปิด browser ก่อนกลับก็ recover ผ่านเมนูเดิมได้.
- Notification 1:1 ใช้ generic entry + local reference; current recipient OWNER/identity/preference ต้องผ่านตอนส่ง. paid/apply/outbox ไม่ขึ้นกับ OA blocked หรือ email failure. ไม่ใช้ reply token เป็น durable delivery key; fallback/retry ใช้ delivery subsystem เดิมและ dedupe.
- แผน LINE console ก่อนปล่อย: ตรวจ LIFF endpoints/scopes, webhook URL/canonical channel/secret, Use webhook/redelivery, deployed manifest profile/image hash และ default/per-user menu binding. เก็บ before/after/rollback profile; native iOS/Android tap จริงทุกช่อง. รอบนี้ไม่เรียก LINE API เพื่อเปลี่ยน OA จริง.

อ้างอิงตรวจ 2026-09-11: [LINE webhook และ redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/) และ [raw-body signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/). Redelivery ไม่รับประกันว่าจะมาครบหรือเรียงลำดับ; จึงต้องมี durable job/reconciliation ของเรา. Stripe ingress ใช้ [Stripe webhook guidance](https://docs.stripe.com/webhooks).

## 6. Technical/business failure และ support action

| ปัญหา | ผลกระทบ | การรับมือที่ต้องมี |
|---|---|---|
| จ่ายแล้วปิดหน้า / webhook ช้า | ลูกค้าคิดว่าต้องจ่ายซ้ำ | retain attempt, status/reference, worker reconcile; CTA ห้ามซื้อซ้ำขณะ collectible |
| จ่ายแล้วถูกระงับ | รับเงินแต่ใช้ไม่ได้ | paid+held, operatorตรวจ lifecycle/B09; ไม่ปลด hold จากการรับเงิน |
| สองบริษัท/สอง OWNER/หลายแท็บ | ผิดบริษัทหรือเก็บซ้ำ | company lock, unique intent, final review ชื่อบริษัท, isolation ทั้ง UI/DB/provider |
| เปลี่ยนเจ้าของ/ผู้ชำระต่างคน | เอกสารหรือ Portal หลุดสิทธิ์ | OWNER recheck; payer ไม่ได้ role; revoke application access และ operator procedure สำหรับ hosted URLs ที่ออกแล้ว |
| ค้างหนี้/บัตรเสีย/ธนาคารต้องยืนยัน | สิทธิ์หมด/ลูกค้าถูกเรียกซ้ำ | fix existing invoice; B03/B08; no free grace สมมติ/ไม่มี automatic PromptPay fallback |
| ภาษี/ที่อยู่/ยอดเปลี่ยน | ลูกค้ายืนยันยอดไม่ตรงเอกสาร | stale quote/review + final hosted total; Stripe Invoice/Receipt ไม่เท่ากับยืนยัน Thai e-Tax; B06 gate |
| refund/cancel/downgrade | เงิน/สิทธิ์/โควตาขัดกัน | policy operation แยก, effective date/period/version; ปิด action ทั้ง API/Portal ถ้า policyยังไม่พร้อม |
| lead/email ล้มเหลว | ลูกค้าคิดว่าสมัคร/แจ้งทีมแล้ว | เก็บ form, แสดงส่งไม่สำเร็จ, retry/contact. mailto draft ไม่ใช่ delivered; provider accepted ไม่ใช่เปิดบัญชีแล้ว |
| ปิด new-sales flag | recurring ยังตัดเงิน | worker/status/allowed cancellation/support ยังทำงาน; แยก disable new sales กับหยุด recurring |

Operator diagnostic view ต้องแสดง company/account mode, attempt/invoice references, observed provider state, apply error/age, latest lifecycle/term/version และ notification status ตาม role; ไม่มีบัตรหรือ secret. Actions: retry reconciliation/apply operation เดิม, resend allowed notification, เปิด provider Dashboard ผ่าน authorized mapping, record support outcome. ไม่ใส่ปุ่ม “force paid” หรือ “reset trial” เป็นวิธีแก้ทั่วไป. Finance reconciliation เปรียบเทียบ gross/tax/fee/refund/net/payout คนละคอลัมน์และไม่ใช้ payout delay บล็อกสิทธิ์.

## 7. Acceptance / policy boundary

- Existing journey repairs ต้องมี failing regression หรือ observed defect, focused checks, real app/API/DB path และ screenshot/error/isolation evidence; ไม่ใช้ตัวอย่าง UI เป็น E2E.
- New billing implementation ต้องผ่าน concurrency/crash/lease/unique tests ด้วย PostgreSQL, provider adapter failure injection, Stripe sandbox signed events/Checkout/3DS/Portal และ LB/T matrix. Screenshot-only/route.fulfill “paid” ไม่พิสูจน์การเปิดสิทธิ์.
- B01 trial conversion, B02 quota, B03 grace, B04 cancellation, B05 plan changes, B06 tax, B07 refund, B08 debt, B09 legacy overrides, B10 margin ใช้มติที่มีในแผนหลักเท่านั้น. Technical code อาจทำ TEST fixtures ได้ แต่ live-capable quote/collection ที่พึ่ง policy เปิดไม่ได้ก่อน policyRevision ที่อนุมัติ. ไม่เติมค่าธุรกิจจากตัวอย่าง test.
- Deliverable gate: migrations/contracts, adapter mapping, audit/outbox/recovery, U01–U12, rich-menu/webhook mappings, support/runbook และ evidence ทุกแถวต้องมี owner/status. Native LINE/Stripe provider ที่ยังไม่รันต้องเป็น NOT RUN ไม่รวมในยอด local PASS.

### Runtime public catalog contract — implementation 2026-09-13

`GET /v1/billing/catalog` returns `schemaVersion:1`, `catalogRevision`, `policyRevision`, `generatedAt`, `validUntil` (30 seconds), `taxTreatment`, eight month/year offers (three paid tiers plus locked Enterprise), and unchanged trial7/1/2/15/30 defaults. No provider IDs, personal data or secrets. `GET /api/public/billing/catalog` is the anonymous Next BFF: no credential forwarding, `no-store`, public read-only CORS, bounded upstream timeout and503 on failure. Customer quotes remain authoritative regardless of the public display.

Marketing polls every15seconds and refreshes on foreground/before selection; error or stale catalog disables new sales, retains clearly marked last-known display and offers retry/company-billing/support. TEST/DISABLED never enables public sale buttons. Revision changes require rereview. The fixed production destination is `https://mangmeeplus.com/billing/companies?offer=…&interval=…`; server authentication/legal gates retain the selection and only ACTIVE OWNER companies are offered. Query input never selects an external origin. Enterprise is independently locked even if catalog data incorrectly says AVAILABLE, and receipt-only offers are filtered out. Full signup/claim continuation remains a separate implementation milestone.
