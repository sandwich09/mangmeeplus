# Postmark transactional email และขอบเขตเอกสาร Stripe

สถานะล่าสุด 2026-09-15: **POSTMARK SELECTED / NATIVE SERVERS AND MANUAL SMTP DELIVERY VERIFIED; APPLICATION E2E / ROLLOUT PENDING**. [หลักฐานการส่ง](../evidence/postmark-native-delivery-2026-09-15.md) แยกจาก source implementation ใน [PR #558](https://github.com/MangmeeDev/mangmeeplus/pull/558); การ merge เอกสารไม่รวมการนำ source นั้นขึ้น develop/main หรือเปิด runtime.

> **Implementation status — IN PROGRESS:** สถานะโค้ด, CI, งานที่ยังค้าง และข้อจำกัดล่าสุดอยู่ที่ [implementation status](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผล E2E และ source ที่ทดสอบดู [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); แยกผลจำลองออกจากผล native provider และไม่รวมจำนวนทดสอบที่ซ้ำกัน. ข้อความตามวันที่ด้านล่างเป็นประวัติของแต่ละช่วงงาน. ยังไม่ deploy; การ merge develop/main ต้องผ่าน CI และตรวจ scope ที่ค้างก่อน.


สถานะ: **POSTMARK SELECTED / IMPLEMENTATION SPEC READY 2026-09-11; runtime และ provider E2E ยัง NOT IMPLEMENTED / NOT RUN**.

Owner เลือก **Postmark** แล้ว เพราะมี Receipt ค่าบริการให้บริษัทมั่งมีเก็บลงบัญชี และยืนยันขอบเขตว่า **Invoice/Receipt ให้ลูกค้าที่จ่ายค่ามั่งมีใช้ Stripe**. การเปลี่ยนเอกสารนี้ไม่ใช่การเปิดบัญชี ซื้อบริการ activate provider หรือ deploy. Sender.net ถูกแทนที่ในแผนปัจจุบัน; ผลสำรวจเดิมเป็นประวัติเท่านั้น.

Source of truth: [Postmark developer reference](../research/postmark-developer-reference-th.md), [implementation/test plan](../plans/mangmee-transactional-email-provider-plan-th.md), [P11 claim](mangmee-email-delivery-claim-spec-th.md), [easy signup](unified-easy-signup-spec-th.md), [P26 billing](mangmee-billing-subscription-spec-th.md), [Stripe reference](../research/stripe-developer-reference-th.md), [ADR-0009](../adr/0009-auth-security-email-delivery.md), [mangmee_web alignment](../../../mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md).

## 1. ขอบเขตและผู้รับผิดชอบ

| งาน | เจ้าของ / ขอบเขตที่เลือก |
|---|---|
| Verify / reset / claim และ app transactional mail ที่เปิดใช้อยู่ | Postmark เป็น transport; app สร้าง/ตรวจ identity proof, permission, consent และ recovery |
| Receipt ค่าใช้ Postmark ของมั่งมี | Postmark ออก PDF Receipt หลังรับชำระ; บริษัทมั่งมีเก็บหลักฐานซื้อบริการ ไม่ใช่เอกสารของ tenant |
| Invoice / payment Receipt / refund Receipt ของลูกค้ามั่งมี | Stripe Billing/Payments สร้างเอกสารและ Stripe ส่ง customer email ตาม settings; แอปแสดงเอกสารที่ผูกกับบริษัทที่ถูกสิทธิ์ |
| Paid access / quota / plan term | server-side Stripe verification และ P26/P29; อีเมลหรือเอกสารดาวน์โหลดไม่ใช่หลักฐานเปิดสิทธิ์ |
| Thai VAT tax invoice / e-Tax | แยกเป็นขอบเขตภาษีที่ต้องตกลงหากต้องการ; ไม่มี custom fiscal generator/numbering/e-Tax implementation ในงาน Postmark นี้ |

ลูกค้าใช้เว็บโดยไม่ต้องมี LINE ได้ตาม easy-signup direction. การเลือก Postmark ไม่ได้เปลี่ยน email code/link, auto-approval หรือ policy ของบัญชีเดิม. ไม่มี campaign, mailing-list subscription, marketing consent หรือ general EMAIL channel ทั้งระบบเพิ่มในงานนี้. ไม่สร้าง customer invoice/PDF ซ้ำแล้วส่งผ่าน Postmark; Stripe เป็นผู้ส่งเอกสารการจ่ายเงินของรุ่นแรก.

## 2. ฐานโค้ดและ migration ที่จำเป็น

- Config ปัจจุบันรองรับ `disabled|local-console|ses|postmark`; `AuthMailerPort`/factory อยู่ใน auth module และเลือก Postmark อย่างชัดเจน พร้อมตรวจ missing config โดยไม่ fall through ไป SES.
- `SignupClaimEmailService` รันใน API Nest container; workers เป็น timer เรียก internal drain. Reuse `OutboxEvent` lease/claimToken/eventKey/availableAt และรายการ event ที่ generic workflow drain ต้อง exclude; ไม่สร้างคิวหรือ worker service ใหม่.
- Legacy SES claim sender เขียน ID ไป `CompanySignupRequest.claimEmailSesMessageId` หลังส่ง; SES/SNS event handler ค้นด้วยช่องนี้. **ห้ามใส่ Postmark MessageID ลงช่อง SES** หรือส่ง Postmark JSON เข้า SNS verifier. Schema/consumer migration อยู่ §4.
- Auth port มี verify/reset/claim/rejection/support และ notice บางชนิดยัง no-op. Sender ใหม่ต้องรักษาสัญญาเดิมและ opt-in ของแต่ละ method; ไม่ทำให้ทุก notice ส่งจริงเพียงเพราะเปลี่ยน provider. Dashboard notification มี WEB/LINE ไม่ใช่ email foundation สำหรับ auth ที่อาจไม่มี company.

ไฟล์หลัก: `packages/config/src/index.ts`, `apps/api/src/common/config/app-config.service.ts`, `apps/api/src/modules/auth/auth.module.ts`, `auth/domain/ports/auth-mailer.port.ts`, auth infrastructure/templates, `external-signup/application/signup-claim-email.service.ts`, `external-signup/application/ses-event.use-case.ts` และ Prisma schema/migrations/tests.

## 3. Postmark adapter และ API contract

### 3.1 Config และ transport

เพิ่ม `EMAIL_PROVIDER=postmark` แบบ additive; default disabled, local-console เฉพาะ local และ SES เดิมคงใช้ได้. ชื่อด้านล่างเป็น **config ที่ต้องเพิ่มตอน implement** ยังไม่มีใน runtime:

| Config | สัญญา |
|---|---|
| `POSTMARK_SERVER_TOKEN` | server token ใน backend secret store; ไม่ใช้ account token. Reject `POSTMARK_API_TEST` นอก local test harness |
| `POSTMARK_SERVER_ID` | positive expected ServerID สำหรับผูก callback/attempt ให้ตรง environment |
| `POSTMARK_MESSAGE_STREAM` | transactional stream ID; ใช้ `outbound` เป็นค่าเริ่มต้นและส่ง explicit ทุก request; ตรวจชนิด stream จริงก่อน rollout |
| `POSTMARK_FROM_ADDRESS`, `POSTMARK_FROM_NAME` | validated address/name ที่ ops ตั้ง; sender/domain verified. ไม่รับ From จาก browser |
| `POSTMARK_WEBHOOK_USERNAME`, `POSTMARK_WEBHOOK_PASSWORD` | Basic Auth สำหรับ webhook แยกจาก API token; ต้องพร้อมก่อน activate และมี rotation overlap ที่จำกัดเวลา |
| `WEB_BASE_URL` | explicit HTTPS frontend origin สำหรับ raw proof links; ไม่ fallback ไป API origin |

เพิ่ม getters, config validation, DI branch และ `PostmarkAuthMailerAdapter` หลัง port เดิม. ใช้ native fetch/HTTP helper ที่มี โดย timeout 10 วินาที, ไม่ follow redirects ไป origin อื่น และไม่เพิ่ม SDK ถ้าไม่จำเป็น. L0 inject transport ใน test เท่านั้น; endpoint production fixed ที่ `https://api.postmarkapp.com/email`.

**Environment sender decision — 2026-09-15:** ผู้ใช้ยืนยัน UAT From `developer@mangmeeplus.com` และ Production From `contact@mangmeeplus.com`. Dedicated Live servers ที่สร้างแล้วคือ UAT `20950027` และ Production `20950034`; ทั้งคู่ใช้ `outbound` Transactional. Server IDs และ From ต้องจับคู่ตาม environment ใน application configuration. การ verify domain หรือแยก Postmark server อย่างเดียวไม่จำกัดผู้ส่งใน native UI ซึ่งยังเลือก signature ข้าม environment ได้. [หลักฐาน native delivery](../evidence/postmark-native-delivery-2026-09-15.md) ยืนยันการรับโดย Gmail SMTP ของ From ที่ถูกต้อง แต่ไม่แทนการตรวจ deployed token/guard/webhook หรือ Inbox placement.

### 3.2 Request / result

`POST /email` ใช้ `X-Postmark-Server-Token`, `Content-Type/Accept: application/json`. ใช้ existing app-rendered text/html templates; ตั้ง `TrackOpens=false`, `TrackLinks=None`, MessageStream explicit. Auth mail มีผู้รับหนึ่งคน ไม่มี Cc/Bcc/attachment. `Tag` เป็น purpose และ `Metadata.sendAttemptId` เป็น opaque UUID ของ attempt; ไม่ส่ง raw proof/เลขภาษี/tenant ID ใน metadata. รูปแบบ field/attachment และตัวอย่างส่งอ้าง [Postmark Email API](https://postmarkapp.com/developer/api/email-api).

Accepted ต้องเป็น HTTP 200 + ErrorCode=0 + valid MessageID/SubmittedAt. `sendAccountClaim` คืน MessageID ตาม port เดิม; `sendSupportRequestNotice` true เฉพาะ accepted. Missing/malformed success เป็น unknown/contract error ไม่ใช่ success. Adapter normalize error เป็น code ที่ scrub แล้ว ไม่คืน provider body ให้ browser หรือ log ทั้ง request/response. ไม่ใช้ batch ในรุ่นแรก.

เพิ่ม optional delivery context ของ mail input เท่าที่ต้องส่ง attempt ID โดยไม่ขยาย claim token ให้ใช้ login. ให้ transport result ภายในมี provider/server/stream/MessageID เพื่อบันทึก attempt แม้ public port method คืน void; ตรวจ caller + ทุก adapter ให้ compile/รักษาผล disabled. ไม่ต้องเปลี่ยน UI/API ทุกจุดเป็น Postmark-specific type.

### 3.3 Failure policy

| ผล | การจัดการในมั่งมี |
|---|---|
| 401 / ErrorCode 10 | auth/config fault; หยุด retry ฉบับเดิมจนแก้ config, alert ops |
| 422 validation หรือ stream/account ไม่พร้อม | permanent/config category แยก invalid recipient; ไม่บอกผู้ใช้ว่าส่งแล้ว. จับ 300/402/403, 412/413, 1235/1236 ตาม reference; HTTP 413 payload ใหญ่เป็นคนละกรณีกับ ErrorCode 413 |
| ErrorCode 406 | inactive recipient; suppress/recovery ตาม §5 ไม่ force-reactivate |
| 429 | retry โดยใช้ Retry-After ถ้ามีและ valid; ถ้าไม่มีใช้ app backoff. ไม่สันนิษฐานว่า Postmark รับรอง header นี้ทุกครั้ง |
| 5xx / timeout / response loss / malformed success | ผลอาจรับส่งแล้ว; persist UNKNOWN, reconcile ก่อน retry และไม่ failover ข้าม provider อัตโนมัติ |

**Postmark ไม่มี idempotency key** ตาม [official support](https://postmarkapp.com/support/article/what-is-an-idempotency-key). ค่าเริ่มต้น retry ของ app: รวมไม่เกิน 5 send attempts ต่อ intent, เว้น 1/5/15/60 นาที + jitter สูงสุด 20%, หยุดก่อน proof/request deadline และเคารพ backoff ที่ยาวกว่าของ provider. เป็น technical default ไม่ใช่ SLA ส่งถึง inbox. Unknown รออย่างน้อยหนึ่งนาทีก่อนค้นด้วย metadata attempt ID; ใช้ Messages API bounded lookup และตรวจ server/stream/recipient. ไม่พบผลไม่ได้แปลว่ายังไม่ส่ง; เมื่อ retry ให้ออก attempt ใหม่และบันทึก possible duplicate. Retry budget หมดให้ ops/user recovery จาก intent เดิม ไม่วนจนเสีย quota.

## 4. Durable attempts และ legacy compatibility

### 4.1 ข้อมูลขั้นต่ำ

เพิ่ม `EmailSendAttempt` สำหรับผูกผลส่ง/การส่งซ้ำ โดย reuse outbox เดิมเป็นคิว. ข้อมูล: opaque id, intent key/purpose, subject reference (signup request หรือ user), optional companyId/outboxEventId, generation, provider, providerServerId/stream, recipient snapshot ที่ได้รับสิทธิ์, providerMessageId nullable, send status, submitted/deadline/settled timestamps, error code และ delivery/suppression facts. **ไม่มี raw token/OTP/body/attachment bytes ในตารางหรือ outbox**.

Unique `(intentKey,generation)` และ `(provider,providerServerId,providerMessageId)` เมื่อ ID มีค่า; index unknown/next recovery ตามงานที่ใช้. `dispatchStartedAt` ต้องจองด้วย CAS ก่อน POST; worker/replay อีกตัวส่ง attempt เดิมไม่ได้. Unknown retry ออก generation ใหม่พร้อม `possibleDuplicate` ที่ติดไปกับประวัติ และไม่ใช้ negative/incomplete lookup เป็นหลักฐานว่ายังไม่ส่ง. เพิ่ม latest claim-attempt pointer ใน signup request เพื่อ CAS; backfill legacy SES reference เฉพาะที่มีจริง ไม่แต่ง deliveredAt หรือ generation history. คง `claimEmailSesMessageId` สำหรับ rollback/SES callback เก่า; Postmark ใช้ attempt ใหม่. การลบ legacy field เป็นงานถัดไปหลัง drain/retention ไม่รวมรอบนี้.

Callback ใช้ sanitized `OutboxEvent` ที่ reserve event type เช่น `email.postmark.event.received`; unique eventKey กัน replay, ไม่เพิ่ม message broker/inbox framework. เก็บเฉพาะ field ที่จำเป็นต่อ mapping, discard Content/Subject/Details/body/header secrets ก่อน persistence. Event ที่ยัง map ไม่ได้เก็บในคิวเพื่อ reconcile และมี retention/alert ตาม operational policy ไม่ให้สร้าง account จาก payload.

### 4.2 ส่งและรับผลแบบไม่สร้างสิทธิ์ซ้ำ

Claim operator history slice (2026-09-14): add a permanent read-only history beneath the existing signup queue, gated by current active SYSTEM_ADMIN plus system.company_onboarding.read. Bind every attempt/cursor to the original signup request and account_claim purpose, order by createdAt/id and return bounded pages. Show original request state/version, latest-attempt pointer, provider/generation and recorded accepted/delivered/suppressed/deadline/recovery times; legacy SES last-sent evidence remains separately labelled, never invented as delivered. Do not return address, body/link/token, intent key, provider message/server ID or raw provider diagnostics. Reads never create an attempt, rotate proof, send mail, extend a claim window or provision. Queue→history→reload/pages→queue remains usable for pending, failed and expired claims; current existing reissue/eligibility controls remain authoritative. Auth verify/reset history and general retention/monitoring remain separate remaining work.

1. Claim consumer ตรวจ state/lease แล้ว transaction สร้าง attempt + update latest generation + mint hash ตาม P11; raw proof อยู่ memory ตอนส่ง. กำหนด attempt ก่อน POST เพื่อรับ callback ที่มาก่อน response ได้.
2. POST ผ่าน selected adapter. Write result ด้วย expected generation/lease/latest pointer; response เก่าไม่ทับ current state. Metadata attempt ID เป็น correlation เท่านั้น; callback ต้องผ่าน auth และตรวจ server/stream/recipient/message binding ก่อนผูก ID ที่ยังว่าง.

การผูก callback ที่ไม่มี MessageID ใน attempt ยังต้อง serialize ที่แถว attempt แล้วอ่าน binding ใหม่; callback สองข้อความห้ามแข่งกันเขียน ID คนละค่า. JSON parser ของ provider endpoint จำกัด 256 KiB ครอบคลุม case/trailing slash ที่ router รับ และห้ามคืน/บันทึก parser error ที่ยก raw content มาอ้าง; ใช้ข้อความกลาง 400/413.
3. หลัง accepted update `claimEmailLastSentAt` เฉพาะ current attempt; success/callback/replay ไม่ทำ provision เอง. เมื่อ automatic resend/retry ต้อง revoke proof เก่าตาม mint-at-send และไม่ขยาย activation window. การ reissue โดย Admin เป็นคำสั่งเดิมตาม P11 ที่เริ่ม claimWindowStartedAt ใหม่โดยไม่แก้ approvedAt; ไม่ใช่ผลจาก callback/transport retry. Claim เดิม TTL 72 ชั่วโมงตาม P11 ไม่ยืมไปเป็น OTP/login TTL.
4. Hard bounce ของ latest pending claim เปลี่ยน EMAIL_PENDING→EMAIL_FAILED ด้วย CAS + audit transaction; late bounce ของ attempt เก่าหรือคำขอ READY ไม่ย้อน business state. Callback-before-response ที่ terminal แล้วต้องไม่ถูก accepted response ลบผล bounce.
5. Raw proof ที่ส่งอาจค้างในอีเมลรุ่นเก่า; UI ชี้ฉบับล่าสุดและมี resend/recovery. App log/outbox/hash-only ยังรักษาเดิม แต่ Postmark เป็นผู้ประมวลผลเนื้อหาและมี provider retention; อย่าอ้างว่าไม่มีสำเนา secret นอก memory ของแอปเลย.

Claim-link privacy amendment 2026-09-14: new account-claim mail uses `/claim-account?r=<requestId>#token=<proof>`. Browsers send the non-secret request reference to the web server; the fragment remains in the browser and the proof is submitted only in the existing POST body. No tracking. The client supports existing `?token=` mail and moves that proof into the fragment after hydration so reloads and subsequent navigation omit it; the first legacy request may already have reached an access log. Reject duplicate or conflicting proof parameters. Opening, refreshing, changing the link and checking status never consume the proof; only the existing atomic claim mutation does. Expired links lead to public status/resend, which preserves the activation window. Do not claim this fixes provider content retention, browser history or the separate verify/reset journeys. Password-reset channel remains subject to the Owner decision.

Verification-link recovery increment 2026-09-14 (implemented; focused6/PG/browser proof recorded, full scope remains open): retain the existing email-change/verification authorization and public POST contract; email reset was parked at this checkpoint; the owner amendment2026-09-15 below now authorizes it. New `/verify-email#token=<proof>` links keep the proof out of HTTP URLs, support legacy query links and reject ambiguous parameters with the same parser as claim. Merely opening/reloading a link must not consume it or change the account: show an explicit confirmation button. Bind in-flight results to the current token, distinguish invalid/expired/used links from temporary transport/service failure, and never show success while the request is pending. A temporary or lost response keeps a retry and login→current account email path; replay of an already-used proof remains rejected and must not write the email again. Login/account settings provide the existing authorized resend/correction route. Profile copy follows the currently verified recovery channels; email recovery is now authorized by the later owner amendment. Revalidate token state/expiry and current ACTIVE user inside the shared account-email transaction before the final claim; a concurrent revoke, account hold, resend or expiry must prevent the obsolete mutation. Unique-email contention returns a safe conflict without consuming proof. Resend must acquire the same account-email lock and re-read the original pending proof/current ACTIVE user before revoking or minting; a request prechecked before a newer email correction or successful confirmation cannot recreate an obsolete email proof or send it. An expired request routes to the existing authenticated new-email request, rather than silently extending old proof authority. Verify with actual Next/Nest/PostgreSQL/browser, request-URL privacy, open/reload/no mutation, explicit success, failure/retry, legacy/used/expired links, account return and concurrent transaction checks; no native recipient send is required for this synthetic proof.

Verify/reset ที่ยังเป็น direct send ให้บันทึก attempt/result โดยไม่เปลี่ยนเป็น login mechanism ใหม่. การทำ easy signup/passwordless E0–E2 ยังต้องออกแบบ/implement แยก; no provider event can verify email, attach ownership, approve trial หรือ grant paid access.

## 5. Webhook, suppression และการติดตาม

ใช้ backend route `POST /public/postmark-events` แยกจาก `/public/ses-events`. ไม่มี user session requirement แต่ **ต้องตรวจ Basic Auth ผ่าน HTTPS**, constant-time secret comparison และ trusted proxy/IP allowlist ตามเครือข่ายจริง; ไม่เชื่อ X-Forwarded-For ตรง ๆ. Postmark ไม่ sign webhook จึงไม่มี HMAC/timestamp signature requirement ที่ implement ไม่ได้. เก็บ credentials ใน HttpAuth settings ไม่ฝัง URL และไม่ log Authorization. [Webhook auth/config](../research/postmark-developer-reference-th.md)

- รับ JSON จำกัด 256 KiB ก่อน parse; schema allowlist RecordType, ServerID, MessageStream และ field ของแต่ละ event. เปิด Delivery/Bounce/SpamComplaint, IncludeContent=false; Open/Click/Broadcast ไม่เปิด.
- ผูก attempt ด้วย provider/environment/server/stream/MessageID และ recipient; ถ้า callback มาก่อน result ใช้ opaque metadata ID ที่มีใน DB แล้ว และต้องตรง expected fields ทั้งหมด. Unknown authenticated event ไม่ให้สิทธิ์; persist sanitized pending/quarantine แล้ว 200 (รองรับ provider verification fixtures โดยไม่สร้างคำขอ).
- Dedupe **Delivery** จาก server+stream+MessageID+normalized recipient+DeliveredAt+RecordType; **Bounce/SpamComplaint** ใช้ RecordType+server+stream+event ID. ถ้าขาด event ID ใช้ stable normalized tuple/message/time/type แทน. X-PM-Webhook-Trace-Id เก็บเพื่อ diagnostics ได้ แต่ไม่ใช้ MessageID ตัวเดียวลบ event ประเภทอื่น/ผู้รับอื่น.
- หลัง auth/validate และ durable append สำเร็จคืน **200**; duplicate คืน 200; DB unavailable คืน **503**; auth ผิดคืน 401, malformed/oversize คืน 400/413 โดยไม่ retry processing เอง. ไม่ใช้ HTTP 4xx เป็นวิธีขอ retry. Monitor webhook verification/pause/exhaustion และ reconcile แม้ provider หยุด retry แล้ว.
- Delivery คือ receiving server accepted; แสดงส่งถึงเซิร์ฟเวอร์อีเมลแล้ว ไม่รับรอง inbox หรืออ่านแล้ว. Late Delivery ไม่ล้าง suppression/complaint. Hard bounce/Inactive/SpamComplaint หยุดส่งอัตโนมัติใน server/stream scope; record local suppression ที่ผูก recipient+scope และ sync กับ provider. ไม่เอา suppression ไป revoke account/paid rights.
- `CanActivate=true` ไม่ใช่คำอนุมัติให้ resend ล้าง suppression; address recovery ต้อง proof/permission/ops policy. Soft failure ของข้อความ accepted แล้วไม่ให้ app ยิงฉบับใหม่แข่งกับการ retry delivery ของ provider; reconcile เมื่อ terminal/ครบ deadline. Complaint เปลี่ยนหน้า help/recovery แต่ไม่บังคับให้ลูกค้าต้องมี LINE.

Metrics: queue age, accepted/unknown/permanent failure, webhook lag/pause, retry exhaustion, hard bounce/complaint และ suppression แยก live/sandbox. Alert เป็น operational evidence ไม่มี raw payload/PII. การเปิด Postmark ต้องตั้ง domain/DKIM/Return-Path, actual stream/server, rate/plan/retention และ owners; credentials ของ callback เก่ายังคงรับผลระหว่าง rollback แม้ outbound provider ถูกเปลี่ยน/disabled.

## 6. Receipt ค่า Postmark ของบริษัทมั่งมี

**SUP-RECEIPT ยืนยันในระดับ official docs แล้ว**: Postmark ออก PDF Receipt หลังรับชำระและส่งให้ billing contacts; company/address/Tax ID ใส่ receipt memo. ตั้ง Bill To/memo/billing address ให้ถูกก่อนซื้อและเก็บ receipt คู่ payment evidence สำหรับลงบัญชีค่าอีเมลของบริษัทเรา. [Receipt guide](https://postmarkapp.com/support/article/how-do-i-customize-a-receipt-generate-pdf-receipts-add-additional-email-addresses-for-receipts)

ไม่ต้องสร้าง automated vendor-receipt importer เพื่อ integrate auth mail. ยังไม่ได้ซื้อจึงไม่มี actual Mangmee receipt evidence. Vendor Receipt ไม่รับรอง Thai VAT tax invoice/สิทธิภาษีซื้อโดยตัวมันเอง; เรื่องนี้ไม่เปลี่ยนว่า Owner เลือก Postmark แล้ว.

## 7. Invoice และ Receipt ฝั่งลูกค้าใช้ Stripe

Owner ยืนยันให้ reuse **Stripe-generated customer Invoice/Receipt**. Stripe subscription สร้าง invoice และ successful payment มี Receipt; การส่งอีเมลต้องตั้ง customer email/settings ให้ถูก. ไม่ส่งซ้ำผ่าน Postmark โดย default และไม่สร้าง PDF/เลขเอกสารคู่ขนาน. [Stripe receipts](https://docs.stripe.com/receipts)

- App billing mapping เก็บ Stripe customer/subscription/invoice/payment reference ต่อบริษัท. หน้าประวัติเอกสารใช้ invoice number/status/amount/currency และ link จาก Stripe: `hosted_invoice_url`, `invoice_pdf`, receipt จาก Charge.`receipt_url` ของ payment ที่สัมพันธ์กับ invoice. ใช้ Stripe API version ที่ P26 pin; อย่าสมมติ top-level invoice.charge มีทุก version. [Invoice object](https://docs.stripe.com/api/invoices/object), [Charge object](https://docs.stripe.com/api/charges/object)
- Endpoint อ่านเอกสาร reuse P26 billing permission: ตรวจ OWNER/ผู้มีสิทธิ์ของ selected company ฝั่ง serverก่อนคืน link. Provider URLs เป็น sensitive capability เมื่อแชร์ออกไปแล้วไม่ต้องผ่าน login มั่งมีซ้ำ; ไม่ log/ใส่ analytics/cache public และไม่อ้างว่าลิงก์ Stripe ถูก tenant-authorize ทุกครั้งที่เปิด. Metadata/email ของผู้จ่ายไม่ได้มอบ membership.
- Draft/finalization pending อาจยังไม่มี invoice PDF; no successful charge/zero-due/credit/out-of-band อาจไม่มี card Receipt. คืน availability ตามจริงพร้อม refresh/recovery ไม่ fabricate URL/Receipt หรือถือ receipt_number เป็น payment ID. Stripe success redirect และ receipt available ไม่แทน signed billing webhook/paid apply.
- เปิด Stripe customer emails สำหรับ successful payments/refunds และตั้ง invoice notifications ที่ต้องใช้ตาม `charge_automatically`; ไม่เปลี่ยนเป็น send_invoice เพียงเพื่อส่งเอกสาร. ใส่ข้อมูลนิติบุคคล/branding/support และ verified billing recipient ของบริษัท. ทดสอบผลจริงของ configuration ไม่อ้างว่าส่งแล้วจาก invoice.paid เพียงอย่างเดียว.
- เมื่อเมลไม่ถึง ให้เปิดเอกสารในแอป/Stripe Portal หรือ operator resend ผ่าน Stripe หลังตรวจสิทธิ์. URL เก่าหมดอายุต้องรับมือผ่าน provider recovery; ไม่ตัดเงินซ้ำ/สร้าง invoice ใหม่เพื่อส่งสำเนา. Refund ส่ง/แสดงเอกสารตาม Stripe status จริง ไม่หมายถึง cancellation หรือ credit note ไทยเสร็จแล้ว.
- One-time Checkout ไม่ใช่ flow subscription รุ่นนี้; หากเพิ่มภายหลังตรวจ `invoice_creation`/ค่าใช้จ่ายตาม Stripe ก่อนเปิด. ไม่เพิ่ม setting นั้นเข้า subscription โดยคัดลอกตัวอย่าง mode=payment.

แยก **payment verified / access applied / invoice ready / receipt available / email sent**. Postmark outage ไม่กระทบ Stripe-generated documents; Stripe email failure ไม่ rollback paid rights. B06 ยังต้องตัดสินข้อมูลผู้ขาย/ผู้ซื้อ การคิดภาษีและ withholding ที่ใช้จริง; **custom Thai tax invoice/e-Tax deferred** ไม่เป็นงาน prerequisite ของ Postmark adapter และไม่แสดงว่า Stripe Receipt คือใบกำกับภาษีไทยที่รับรองแล้ว.

## 8. Attachment และ future document scope

Postmark รองรับ Base64 Attachments จาก private storage และ Cc จริง. หากมี app transactional attachment ที่อนุมัติในอนาคต ให้ใช้ bytes โดยไม่เปิด public URL; จำกัดรวมหลัง encoding ต่ำกว่า 10 MB และตรวจ ContentType/ชื่อไฟล์. Hash/private artifact ต้นฉบับอยู่ในแอป ไม่ใช้ provider activity เป็นคลังเอกสาร. รุ่นนี้ auth ไม่มี attachment และ customer payment docs ส่งโดย Stripe จึงไม่ต้องสร้าง attachment/export UI. e-Tax/PDF-A/CC/inbound validation เป็นงานแยกหาก Owner เลือกภายหลัง.

## 9. Cross-repo และ acceptance

`mangmee_web` handoff เข้า app signup/billing; ไม่มี Postmark/Stripe secret, ไม่มี form ส่ง OTP ตรง และไม่แสดง ready/sent จาก mailto. Copy เอกสารฝั่งลูกค้าใช้ “Invoice/Receipt ผ่าน Stripe” เฉพาะเมื่อ feature gate พร้อม; ห้ามเติม Thai tax/e-Tax promise จากการเปลี่ยน provider.

[แผน M0–M4 / EM01–EM18](../plans/mangmee-transactional-email-provider-plan-th.md) แยก local fake, API validation token, Postmark Sandbox, actual inbox และ Stripe document evidence. Sender research ไม่ใช่ contract ปัจจุบัน; SES/Stripe S-pre results ไม่ใช่ Postmark pass. งานเอกสารพร้อมให้เริ่ม M1/M2; account/domain/ops proof, easy-signup policy และ Stripe billing implementation เป็น dependencies ที่มีสถานะแยกชัดเจน.


### Owner amendment — email password recovery approved2026-09-15

Owner approved Postmark password-recovery links for verified email users, including users without LINE. This supersedes the earlier parked email-reset decision for this work; keep existing LINE recovery and eligibility/security holds. Implement an explicit request and confirmation flow with generic account-existence response, bounded request/send limits, verified current email/ACTIVE user and credential binding, fragment proof, single use/expiry, reissue revocation, atomic password update/session revocation/audit and safe lost-response recovery. Opening a link alone must not change a password. Retain old LINE Login/self-link restrictions unrelated to recovery. Test real HTTP/PG/browser with provider simulation and plain Thai mobile UX; no native customer email sends in synthetic tests. Current implementation and local proof are recorded in [email-password-reset evidence](../evidence/billing-integration-2026-09-13/email-password-reset-result.json) and [actual login/return proof](../evidence/billing-integration-2026-09-13/portal-consistency-result.json). These do not certify native inbox delivery or the remaining EM matrix.


### Email recovery implementation contract — owner approval2026-09-15

- Forgot-password explicitly selects EMAIL or LINE; existing `/auth/password/reset-request` LINE contract stays compatible. EMAIL uses public POST `/auth/password/email-reset-request` with `{username}` and public POST `/auth/password/email-reset-confirm` with `{token,newPassword}`. Both use existing rate-limit service; POST only, strict field validation and no proof in GET/API URLs.
- Email request looks up normalized username/email, rejects ambiguous matches internally, requires ACTIVE user, enabled credential, verified current email and an ACTIVE membership in an ACTIVE company (or expiry-only disabled company as normal billing recovery). Admin/security holds remain. Same generic response for unknown/ineligible/suppressed/provider failure; provider latency is detached from the public response, minimum response duration retained. At most one request per account per60seconds and five perhour across identifiers/IPs, serialized under existing user/credential locks. Existing IP budgets also apply.
- Reuse PasswordResetToken without migration: versioned opaque `er1.<email-binding-digest>.<credential-binding-digest>.<random32bytes>` proof, only SHA256 of complete proof in DB. Binding digests contain user ID/current normalized email/emailVerifiedAt and current passwordHash/updatedAt, never raw email/password/password hash in the proof. A changed email, verification date or credential invalidates earlier proofs even if a different writer did not revoke their token rows. Reject legacy/non-email token formats for this route.
-30minute single-use lifetime. Current user/company/membership/credential rechecked under transaction locks before reserving token, immediately before dispatch, and before confirmation. Reissue revokes older PENDING reset tokens (including LINE) atomically; failure before reservation leaves existing proof intact. Prepare Postmark send attempt in the same transaction, bind purpose/recipient/deadline/intent to token, keep raw proof only in transient memory. Provider failure remains recoverable by explicit new request after cooldown; no blind replay of uncertain sends or durable raw-token queue.
- Confirm never changes password on page load. Require explicit matching new-password fields (8–128characters), reject reuse without burning proof, atomically claim unexpired token, rotate credential, clear temporary revealable password/expiry/forced-change, revoke every active auth session and other PENDING reset tokens, write security audit. No automatic login/token issuance: success returns only `{completed:true}` and next step is normal login with existing legal/company/platform gates.
- Lost confirmation response: same proof and same resulting current password may return the original completed outcome within5minutes of usedAt while email binding/current eligibility still hold; no credential/session/audit mutation or new access token. Different password, later credential rotation, expiry/revocation or changed email refuses retry. Browser distinguishes invalid link from temporary failure and offers retry, fresh request and login.
- Fragment proof via `/reset-password#token=...`, no tracking/analytics/raw proof logs; Postmark existing `TrackOpens:false, TrackLinks:None`. Referrer policy no-referrer and cache no-store for recovery page. Docs checked2026-09-15: [Postmark Email API](https://postmarkapp.com/developer/api/email-api), [link tracking](https://postmarkapp.com/developer/user-guide/tracking-links).
- Acceptance evidence must exercise real HTTP/PG/Next and simulated Postmark: known/unknown/unverified/ambiguous/disabled, username/email normalization, account and IP cooldown, current binding/security change races, provider rejection/uncertain response, expired/reissued/replayed/concurrent proofs, atomic audit rollback, old session rejection, no auto-login, fragment scanner GET, mobile44px/readable text, mismatch/reuse/retry/back/login. Keep LINE regression. This contract supersedes dormant email-reset code that auto-issued a login session; it grants no additional business access.


### Remaining mail monitoring implementation target — 2026-09-15

Implement a bounded read-only operational overview for the configured Postmark server/transactional stream, using existing EmailSendAttempt, EmailSuppression and sanitized OutboxEvent rows. Separate accepted attempts, receiving-server delivery, unknown outcomes, retry waiting/exhaustion, suppressed attempts and pending/unmapped callback facts; show the observation window/oldest pending time and distinguish attempts from unique intents. Unknown or absent provider coverage is not zero or success. No raw recipient, subject, body, proof, provider payload or credentials in overview/history DTOs.

Use a dedicated current global `system.email_delivery.read` permission plus active system Admin role, current membership/user/company and final authority recheck. The existing onboarding permission must not implicitly reveal all reset/verification mail. Proposed route `/system/email-delivery` with bounded25-row original-attempt history and validated cursor/filter. A separate explicit read-only connection check may inspect /server and /message-streams/{configured stream}, with exact identity/type and safe projection; no native modification or message send. Native server mode remains separate from Stripe mode and local environment. Do not infer content retention or plan quota from these responses. Current no-deploy/no-live-send boundary remains.

UI for nontechnical Admin: state what needs checking, last observed time, separate Postmark acceptance and recipient-server delivery, readable history, reload/error/no-permission/empty states and original supported signup/billing recovery paths where current permissions authorize them. Never provide a generic resend of an auth proof or clear suppression from this overview. Per-purpose current recovery remains authoritative; a held account or expired proof cannot be bypassed. Global retention deletion/actual provider retention and remaining auth identity proof are separate outstanding work, with no guessed retention period.

Prove local HTTP/PG/browser scope withdrawal, server/stream isolation, exact cursors and25+1 bounds, no PII/secrets in DTO/audit, duplicate/late/unmapped facts, disabled outbound with retained history, provider errors and malformed/foreign native configuration, and no send/proof/account/grant mutation. Read-only monitoring does not certify native inbox delivery or full EM acceptance. Official reference: ../research/postmark-monitoring-api-notes-2026-09-15.md.

Native configuration projection is an allowlist: configured server and stream each resolve MATCHED/MISMATCH/UNKNOWN; mode is LIVE/SANDBOX/UNKNOWN; transactional and archived are nullable booleans. A mismatched/unknown server cannot establish the configured server's mode or stream facts. A mismatched/unknown stream cannot establish its type or archive state. Only explicit ArchivedAt:null proves an active stream; a valid timestamp proves archived, absent/malformed data stays unknown. Drop every other native field, including ApiTokens, names, URLs and ExpectedPurgeDate; no content-retention or sending-quota claim can come from this projection. Unknown facts never count as a successful configuration check.

Monitoring read contract: `/system/email-delivery` shows local attempts created in the preceding seven days (explicit start/end and attempts versus distinct intents), observed acceptance/delivery/suppression and possible-duplicate attempts. These are historical evidence, not current proof validity or a provider bill. Pending/review/recovery-due counts cover retained attempts of all ages; a failed older generation may remain in history even after a later success. Callback received/pending/failed counts cover locally retained, deduplicated events received in the same seven-day window, including unmapped events; no callback is not proof of a paused webhook. History itself spans all retained attempts with optional closed purpose/review filters,25+1 keyset pages, and cursors bound to current server/stream/filter. Missing configuration returns unavailable counts, never all-server history or zero-as-success. Outbound disabled still permits current configured historical reads.

`GET /system/email-delivery/connection` is an explicit, separately throttled read of the configured Postmark identities. Recheck current authority after provider response and before returning. It never sends an email, changes provider settings, clears suppression, rotates a proof or changes customer rights. A matching Sandbox is a successful identity check, not live readiness. UI separates local evidence from this observation and from the still-unverified provider retention/allowance. Account-claim rows may link to their original Admin history only with the additional current onboarding read authority; other purposes direct operators to the existing customer recovery or company billing workflow without a generic resend button.

Billing-status history may link only its exact original billing outbox/invoice/company with current billing read capability and the configured Stripe account/mode. Unknown, foreign or unbound rows expose no billing destination. Local monitoring evidence is recorded in ../evidence/billing-integration-2026-09-13/email-monitoring-result.json; full mail acceptance remains open.
