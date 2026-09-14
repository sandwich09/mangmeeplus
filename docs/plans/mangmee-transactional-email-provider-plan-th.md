# แผน implement Postmark และใช้เอกสารลูกค้าจาก Stripe

> **Implementation status — IN PROGRESS:** สถานะโค้ด, CI, งานที่ยังค้าง และข้อจำกัดล่าสุดอยู่ที่ [implementation status](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผล E2E และ source ที่ทดสอบดู [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); แยกผลจำลองออกจากผล native provider และไม่รวมจำนวนทดสอบที่ซ้ำกัน. ข้อความตามวันที่ด้านล่างเป็นประวัติของแต่ละช่วงงาน. ยังไม่ deploy; การ merge develop/main ต้องผ่าน CI และตรวจ scope ที่ค้างก่อน.


สถานะ: **POSTMARK IMPLEMENTATION IN PROGRESS 2026-09-12; LOCAL TRANSPORT/PG/HTTP CHECKS PASS; FULL EM01–EM18 NOT COMPLETE**. Owner เลือก Postmark เพื่อมี Receipt ค่าอีเมลลงบัญชีบริษัท และให้ **Stripe ออก/ส่ง Invoice กับ Receipt ฝั่งลูกค้ามั่งมี**. [Spec](../specs/mangmee-transactional-email-provider-spec-th.md) / [Postmark API reference](../research/postmark-developer-reference-th.md) กำหนด contract ปัจจุบัน; ไม่ต้องเลือก provider ซ้ำ. ไม่มี account purchase/provider send/cloud change/deploy ในรอบเอกสาร.


EM05 verification increment2026-09-14: implemented and passed6 actual HTTP/PG/Next/390px browser groups. Explicit confirm, fragment/legacy handling, current-token loading/error/retry, profile return after lost response, proof purpose/expiry/single-use and transactional ACTIVE-user/resend-source races are verified. Auth93/web1703 and final API/web typechecks PASS; exact sources/mobile captures in email-verification-result.json. Independent of the primary150 and signup8 checkpoints. New CI pending; full EM05/EM09 recovery/retention/identity coverage remains open. Historical status at that checkpoint: email recovery was awaiting Owner approval. The 2026-09-15 owner amendment supersedes it; email recovery is now implemented and locally verified in email-password-reset-result.json.

## 1. ลำดับงาน

| ขั้น | งาน | Exit evidence / dependency | สถานะ |
|---|---|---|---|
| M0 Contract | เลือก Postmark, อ่าน endpoint/auth/error/webhook/attachment/receipt/sandbox และ map กับ port/outbox/SES field ปัจจุบัน; เลือกใช้ single-send API + app templates + Basic Auth webhook | spec §2–5 และ official reference ระบุได้; account-specific values ตรวจใน M4 ไม่บล็อกการเริ่มเขียน M1 ด้วย placeholder test config | **DOCS DONE**; account/domain/server read-only preflight recorded 2026-09-12 |
| M1 Adapter/config | เพิ่ม postmark enum/getters/factory branch และ PostmarkAuthMailerAdapter; timeout/JSON-result/error mapping/tracking off/attempt metadata; รักษา disabled/console/SES และ no-op/opt-in methods | focused tests, config/API typecheck, DI boot โดย deny external network; no package.json change เว้นเปลี่ยน dependency ที่จำเป็น | IMPLEMENTED / LOCAL CHECKS PASS; รวมอยู่ใน draft PR#558, CI ยังไม่ผ่านครบ |
| M2 Delivery reliability | เพิ่ม provider-aware attempt/latest claim pointer และ migration; integrate API-side claim drain/lease/mint-at-send, error-aware scheduling/unknown reconciliation, public Postmark endpoint, sanitized callback outbox/suppression | real PG concurrency/crash/callback-before-response/replay/legacy regression + browser/API/DB; ไม่เก็บ Postmark ID ใน SES column | IN PROGRESS: durable dispatch/callback/reconcile tested; complete recovery/browser/retention coverage remains |
| M3 Stripe customer documents | P26 reuse Stripe Invoice/PDF/Charge Receipt URL, company permission, unavailable/expired-link states และ Stripe email configuration/resend support | Stripe payment→invoice/receipt evidence และไม่สร้าง customer PDF/เลขใหม่/ส่งซ้ำด้วย Postmark. ไม่ต้องสร้าง custom tax-document subsystem | PARTIAL IMPLEMENTED: protected Invoice/PDF/Receipt links และ negative/return paths ผ่าน local simulated HTTP/browser; actual Stripe email settings/resend/provider acceptance ยังต้องพิสูจน์ |
| M4 Provider proof/rollout | provision account/server/stream/domain/keys/webhook auth, Sandbox proof, controlled live inbox, billing Receipt details, quota/retention/alerts/rollback | L0/L1/L2/L3 แยกผล; runbook protocol ครบก่อนเปิดจริง; provider selected ไม่เท่ากับ account approved/live ready | PARTIAL 2026-09-12: account approved/live; domain DKIM + custom Return-Path Verified; existing server/transactional stream confirmed, allowance 100 emails/period ([evidence](../agent-memory/postmark-domain-dns-2026-09-12.md)); integration/delivery proof/rollout NOT RUN |

M1/M2 สำหรับ P11 flow เดิมเริ่มได้โดยไม่รอ easy-signup code-vs-link/auto-approval หรือ e-Tax. หากจะเปิด signup/passwordless ใหม่ต้องผ่าน [E0–E3](unified-easy-signup-plan-th.md) และ returning login/recovery ด้วย. Runtime scope ไม่สร้าง general notification framework, broadcast, fiscal PDF generator, vendor invoice importer หรือ Postmark+Sender สอง adapter เผื่อไว้.

## 2. ไฟล์และ data migration

- Config: `packages/config/src/index.ts`, `apps/api/src/common/config/app-config.service.ts`, `apps/api/src/modules/auth/auth.module.ts` และ tests ของแต่ละส่วน; selector มี explicit Postmark branch แล้ว; disabled/console/SES ยังแยกตาม config.
- Adapter/template/port: เพิ่ม `apps/api/src/modules/auth/infrastructure/postmark-auth-mailer.adapter.ts` และ focused spec; reuse existing rendered templates. เพิ่ม delivery context/result ภายในเท่าที่ต้องผูก attempt ไม่เปลี่ยน auth semantics.
- Delivery: `external-signup/application/signup-claim-email.service.ts`, token service, outbox repository และ internal drain timer; เพิ่ม Postmark event controller/use-case แยกจาก SNS/SES validator. ต้อง reserve/exclude Postmark callback event type ใน generic drain และ register ใน API module.
- Schema: `EmailSendAttempt`, current claim-attempt reference และ index/unique ตาม spec §4; sanitized callback ใช้ OutboxEvent เดิม. Local suppression ที่เพิ่มต้องมี key provider/server/stream/recipient และ migration/retention ที่ชัดเจน ไม่ใช้ company ownership จาก callback.
- Migration additive: backfill legacy SES reference เท่าที่มี, ไม่แต่ง delivery evidence, คง SES field/endpointเพื่อ delayed event และ rollback. Postmark failure ห้าม retry ผ่าน SES อัตโนมัติ. Outbound rollback ไม่หยุดรับ callback ของ messages ที่ส่งไปแล้ว.
- Stripe: extend billing response/UI ตาม P26 ให้มีเอกสารที่สัมพันธ์กับ selected company; provider link เป็น sensitive capability. ไม่ proxy/download PDF โดยรับ URL จาก client และไม่เพิ่ม storage/numbering system แค่แสดง Stripe documents.

## 3. Acceptance matrix

แถว EM01–EM08/EM16/EM18 มี **PARTIAL LOCAL EVIDENCE 2026-09-12** ตาม [ผลตรวจ](../evidence/postmark-email-2026-09-12/README.md); ยังไม่ถือว่าแต่ละแถวผ่านครบ. EM09–EM15/EM17 ยังไม่มี full end-to-end/provider acceptance. Row IDs คงไว้เพื่อ cross-reference; ไม่เปลี่ยนผล runtime เดิมให้เป็น Postmark PASS. แถวที่ไม่ใช้กับรุ่นที่เปิดต้องมี explicit DEFERRED พร้อมเหตุผล; ห้าม defer signup recovery/delivery correctness ที่เปิดจริง.

| ID | วิธีทดสอบ | Assertion |
|---|---|---|
| EM01 | DI/config disabled/console/SES/postmark valid/missing/test-token | disabled ไม่ส่ง, console local-only, selectorไม่ตก SES, non-local reject POSTMARK_API_TEST, secrets ไม่อยู่ frontend bundle |
| EM02 | Fake HTTP success/ErrorCode!=0/missing MessageID/malformed/200 batch-shaped | exact contract, tracking off, recipient/stream/metadata ถูก, accepted แยก delivered; ไม่รับ HTTP 200 อย่างเดียว |
| EM03 | 401/422 codes 300/406/412/413/1235, HTTP 413, 429 มี/ไม่มี Retry-After, 5xx/timeout | config/permanent/suppression/retry/unknown ต่างกัน, bounded attempts/deadline, scrub provider error, no blind failover |
| EM04 | Real PG workersชนกัน, lease หมด, crash ก่อน/หลัง POST, callback ก่อน response, late response | attempt สร้างก่อนส่ง, CAS/latest generation ถูก, dedupe outbox, ไม่ regrant/provisionซ้ำ; possible duplicate email รายงานตามจริง |
| EM05 | Legacy claim/verify/reset: expired/used/unknown/resend/email change/cross-device | hash-only mint-at-send, atomic single use, ไม่ขยาย activation window, no secret DB/outbox/log, no token-purpose confusion |
| EM05a | Original signup claim history via actual Admin HTTP/PostgreSQL/browser | current global role/read permission, source/purpose/cursor isolation, truthful latest/legacy/delivery facts, pending/failed/expired navigation and mobile reload/return; no provider send/proof rotation/provision from reading; does not complete full EM05/EM09 |
| EM06 | Callback authผิด/missing, spoofed forwarded IP, wrong server/stream, malformed/oversize, DBdown | reject untrusted, 200 หลัง durable persist, 503 เพื่อ retry persistence failure, no HMAC requirement/unsafe SNS reuse |
| EM07 | Delivery/Bounce/SpamComplaint ซ้ำและสลับลำดับ, 2 recipients, unknown message/verification fixture | event keyไม่ใช้ MessageIDอย่างเดียว, quarantineแทนสร้างบัญชี, late deliveredไม่ล้างsuppression, old bounceไม่ทำ READYกลับ failed |
| EM08 | Inactive/hard/soft bounce, complaint, retry exhaustion, address recovery | no auto-reactivation, ไม่ POST duplicate แข่ง provider retry, no account/paid-right revoke, recoveryไม่บังคับ LINE |
| EM09 | Browser+real API/PG signup→proof→eligible provision→first receipt→logout→return/recovery | ไม่มี LINEได้ครบ, old/shared/held identitiesไม่ถูก bypass, no duplicate trial. Legacy Flow B ทดสอบได้ก่อน; new easy flow ต้อง E0–E2 |
| EM10 | Stripe signed test/sandbox payment→invoice links/receipt→billing page | invoice/customer/company/chargeผูกถูก, number/amount/statusตามStripe, no local PDF/number generator, no Postmark customer-receipt duplicate |
| EM11 | Foreign company/guessed invoice ID/payer≠OWNER, nullable PDF/receipt, expired link | server permissionก่อนให้providerURL, no membershipจากผู้จ่าย, no secret URL in logs/analytics, unavailable/refresh/recoveryตรงจริง |
| EM12 | Postmark L2 Sandbox + webhook verify/rotation/drop/paused/reconciliation | expected server type/stream, authenticated round trip, sandbox≠inbox; verifyทุก enabled event, unknownlookupไม่ถือ notfound=unsent |
| EM13 | Controlled live inbox L3, DKIM/SPF/DMARC, actual HTML/link and recovery | ผู้รับอนุญาตได้รับจริง, tracking off, no link auto-consume; API_TEST/Sandboxไม่ใช้แทน live proof |
| EM14 | Company Postmark billing Receipt setup/sample/actual when purchased | SUP-RECEIPTมี PDF, Bill To/memo/addressถูก, billing recipientถูก; docs confirmedแต่ยังไม่อ้าง actual Mangmee receipt |
| EM15 | Attachment contract local only / production omission | authไม่มีattachment; future attachmentเป็นBase64/private bytes, sizeหลังencodingอยู่ใต้cap, no public URL requirement; featureยังไม่เปิดไม่ต้องสร้าง UI |
| EM16 | Provider payload/errors/headers/traces/body dump and retention review | log/outboxไม่เก็บrawOTP/link/Content/Authorization, IncludeContent=false, diagnostic APIไม่persistbody, Postmark retentionระบุจริง |
| EM17 | Stripe receipt/invoice emails enabled/disabled, failed charge/refund/zero-due and resend | failureไม่สร้างpaidReceipt, actualcharge/creditแยก, settings+recipientจริง; resendไม่charge/new invoice, Postmark outageไม่กระทบStripe docs |
| EM18 | Additive migration + SES delayed events + outbound rollback | legacySESอ่านได้, PostmarkIDไม่ลงSESfield, callbacksเดิมdrainได้, shared signup/LINE/claim review policyไม่เปลี่ยน |

## 4. วิธีพิสูจน์และคำสั่งที่เตรียมไว้

**L0 local:** ใช้ fake HTTP edge ใน test กับ real API/PG/worker/browser; block network ไป Postmark/Stripe/LINE. Collector เก็บ proof ใน memoryเพื่อกรอกใน browser ไม่ persistใน report/screenshot/trace. Fault injection ต้องกำหนดลำดับ response/callback/worker crash ได้; ทดสอบ current request context/permission/business actionจริง ไม่ mock UI เป็น READY.

Test runner ปัจจุบันของ API คือ `tsx --test`; ใช้ API tsconfig สำหรับ decorators. คำสั่งจริงและ source hashes อยู่ใน [evidence](../evidence/postmark-email-2026-09-12/README.md). ไฟล์ใหม่คือ `src/modules/auth/infrastructure/postmark.client.spec.ts`, `src/modules/auth/postmark-delivery.pg.spec.ts` และ compiled `src/scripts/postmark-http-smoke.ts`. PG/HTTP ใช้ฐานข้อมูล localhost ที่แยกสำหรับ test; HTTP smoke boot AppModule จริงและปฏิเสธ fetch ไป provider ภายนอก.

CI registration เพิ่ม Postmark contract เข้า owned acceptance catalog และเพิ่ม isolated PG/HTTP step หลัง SWC boot build; มี draft PR/CI แล้วตาม task memory; ยังไม่ merge หรือ deploy. ไม่มี package.json/dependency edit.

**L1 validation:** PASS 2026-09-12 — public POSTMARK_API_TEST กับ payloadสังเคราะห์ได้ HTTP 200/ErrorCode 0/valid MessageID และ SubmittedAt; ไม่มี email delivery. ใช้ public POSTMARK_API_TEST token กับ payloadสังเคราะห์; proof คือ request/API resultเท่านั้น ไม่ใช่ live domain/message receipt. ไม่เก็บ test tokenเป็นproductionsecret.

**L2 provider Sandbox:** account serverต้องสร้างเป็น Sandbox อย่าง explicitและผูก IDที่config; อาจเห็น Delivered/webhookแต่ไม่มีinbox และนับquota. Fake bounce domain ทดสอบ hard/softได้; SpamComplaint ใช้ authenticated synthetic fixture แยกเพราะ generatorไม่รองรับ. ไม่ส่งเมลจริงแล้วกดreport spamเพื่อให้testผ่าน.

**L3 inbox:** หลังมีaccount/domain/recipientที่อนุญาต ตรวจการรับจริงและauth headers. การส่งภายนอก/ซื้อบริการ/ตั้งค่าcloudเป็นงานopsตามscopeที่อนุมัติ ไม่ทำเพียงเพื่อปิดcheckboxรอบdocs.

**Stripe document proof:** ใช้ signed fixtures/Stripe sandboxหลังมี P26 implementation; test receiptใช้ทางmanual/providerที่docsรองรับ ไม่ถือว่าtest modeเปิดautoemailให้เหมือนliveเสมอ. ตรวจดาวน์โหลดInvoice/Receipt, Stripe email settingsและreceiverแยกจากpay→access. ไม่ต้องมีPostmarkinvoiceemailในflowนี้.

Evidence อยู่ `docs/evidence/postmark-email-<date>/`: exact source revision/hash, command/config/server mode, red/green counts, sanitized correlation IDs, cleanup และข้อจำกัดต่อระดับ. ไม่ใช้ Stripe S-pre/SES foundationเป็นPostmarkpass. ผลรอบ 2026-09-12 แยก local/validation pass จาก Sandbox/inbox และ Stripe ที่ยังไม่ผ่านอย่างชัดเจน.

## 5. Operations และข้อที่ยังเปิด

- M4 ระบุ account owner/plan/approval/quota/serverID/transactional stream, verified domain+DKIM+custom Return-Path, WEB_BASE_URL/from, Postmark Basic Auth callback secretและrotation/allowlistที่ตรงproxy. Record actual valuesในsecureopsconfig ไม่ใส่secretในdocs.
- Confirm webhook verification ต่อevent type, retry/dropbehaviorจากdocsกับaccountจริง, alertsและreconciliationถ้าendpointกลับมาหลังproviderหยุดretry. ให้callbackของprevious providerรับได้ระหว่างrollback; outboundเลือกทีละprovider.
- Providerเก็บmessage contentตามretention; บันทึกเวลาจริง/ผู้เข้าถึง/ค่าใช้จ่าย. Postmarkreceiptเป็นค่าใช้จ่ายบริษัทเรา ไม่ทำvendorimporter และไม่ส่งซ้ำcustomerinvoiceที่Stripeส่งอยู่.
- Stripeตั้งbusiness details/customer billing email/successful-payment+refund/invoice emailsettingsตามP26; reviewราคา/ภาษี/withholdingในB06ยังต้องจบก่อนเปิดขาย. **Thai tax/e-Tax generator deferred** ไม่ขยายงานmail providerเพื่อทำสิ่งนี้.
- Easy-signup E0 ยังต้องเลือก code/link, returning login/recovery, eligibilityและfieldsก่อนruntimeflowใหม่. ข้อนี้ไม่ทำให้provider selectionกลับไปOPEN.

### C03 Postmark recovery implementation sequence — 2026-09-14

Add scoped email references to the existing Billing delivery list using the original billing.status.email outbox and provider-aware attempts. A durable RECONCILE_NOTIFICATION command performs bounded metadata lookup only; a separate RETRY_NOTIFICATION command reviews the resulting evidence and can reserve one READY successor generation within the existing five-attempt cap. Reuse current outbox headers, operation CAS/idempotency and attempt uniqueness; no new broker or provider failover. An unsent READY generation is resumed rather than duplicated. The sender claims READY immediately before dispatch, preserves all old attempts, checks current actor/verified recipient/purpose/template/server/stream/suppression and stops if another generation has already been accepted.

Prove CONFIG→review→READY→accepted, UNKNOWN→same-message lookup with no resend, empty lookup→visible possible duplicate, late positive callback, revoked operator before dispatch, suppression/changed identity/security hold, replay/two operators, cap exhaustion and original invoice/quota immutability with real PG/HTTP/browser. Keep accepted and delivered separate. Auth/claim/reset history and proof-lifecycle recovery remain an additional mail slice; this billing notification design is not their acceptance. Current native Postmark inbox proof is still not claimed.
- ก่อนแตะcloudอ่าน [cloud operations](../runbooks/cloud-environment-operations.md); ก่อน UAT/productionอ่าน [release protocol](../runbooks/uat-production-v2-deployment.md). ไม่มีdeployหรือเปิดpaidgateในรอบเอกสาร.

## 6. Definition of ready ของเอกสาร

- [x] Ownerเลือก Postmarkแล้วและแยก supplier Receipt / Stripe customer Invoice+Receipt ชัดเจน.
- [x] API/auth/error/webhook/idempotency/attachment/sandbox docsตรวจแล้ว; sender-specific assumptionsถูกแทนที่.
- [x] ระบุruntime gaps, migration, permission/state/secret boundariesและtest matrixที่ใช้จริง.
- [x] เชื่อม P11/P26/easy signup/ADR/mangmee_web และแยก scope tax/e-Taxที่ยังไม่ทำ.
- [ ] M1–M4 implementation + EM01–EM18; actual provider/Stripe document acceptance.

ผลตรวจเอกสาร/ลิงก์/fixturesบันทึกใน [task memory](../agent-memory/unified-easy-signup-2026-09-11.md). Docs-readyไม่ใช่production-ready; ไม่อ้าง API/inbox/E2Eผ่านจากการอ่านเอกสาร.

M3 billing recovery verification in progress 2026-09-14: exercise real company-scoped Admin API through Next rewrite as well as direct HTTP, including the namespaced original outbox reference in URL and query. Prove retry→READY→worker→acceptance and lookup→observed original attempt separately, with browser reload/back/history, withdrawn operator/content, suppression/changed recipient/cap/backoff, and late acceptance of an older generation. The old generation and billing ledgers must remain unchanged except observed provider facts; the new generation must not send after a positive older-generation observation. PostgreSQL13 TAP covers reservation and dispatch fencing. Focused Admin browser31 groups passed after fixing the encoded-colon route boundary; this overlaps the full integration suite. The final combined regression also checks that old transport errors stay in history and do not appear as the current accepted result. Full auth/claim/reset operations and native inbox acceptance remain open.

### EM09 continued acceptance — existing web claim journey

Run the actual public form and Admin approval endpoint, dedicated claim outbox worker/Postmark adapter, original token info and single-use claim, BFF password login, explicit legal gate, welcome skip-LINE, seeded seven-menu/FREE_TRIAL_15 access, first receipt upload and logout/login return. Simulate DNS/Postmark and unavailable AI Gateway transport, use actual local storage and real PostgreSQL/Nest/Next. Exercise unknown send→same-message lookup→same outbox replay before claim, expired link→status→resend without extending activation, and legacy/new fragment links with reload. Opening mail/history must not provision. Assert new proof never appears in a browser HTTP request URL, while its body reaches the real proof endpoint. Collect raw proof only in test memory, never in evidence. Preserve existing manual eligibility/approval and LINE recovery policy; the owner-approved email recovery extension is specified below. Native inbox/LINE and full EM09 identity/recovery variants remain separate.


### Owner amendment — email password recovery approved2026-09-15

Owner approved Postmark password-recovery links for verified email users, including users without LINE. This supersedes the earlier parked email-reset decision for this work; keep existing LINE recovery and eligibility/security holds. Implement an explicit request and confirmation flow with generic account-existence response, bounded request/send limits, verified current email/ACTIVE user and credential binding, fragment proof, single use/expiry, reissue revocation, atomic password update/session revocation/audit and safe lost-response recovery. Opening a link alone must not change a password. Retain old LINE Login/self-link restrictions unrelated to recovery. Test real HTTP/PG/browser with provider simulation and plain Thai mobile UX; no native customer email sends in synthetic tests. Runtime remains pending until implementation and evidence are recorded.


### Email recovery implementation contract — owner approval2026-09-15

- Forgot-password explicitly selects EMAIL or LINE; existing `/auth/password/reset-request` LINE contract stays compatible. EMAIL uses public POST `/auth/password/email-reset-request` with `{username}` and public POST `/auth/password/email-reset-confirm` with `{token,newPassword}`. Both use existing rate-limit service; POST only, strict field validation and no proof in GET/API URLs.
- Email request looks up normalized username/email, rejects ambiguous matches internally, requires ACTIVE user, enabled credential, verified current email and an ACTIVE membership in an ACTIVE company (or expiry-only disabled company as normal billing recovery). Admin/security holds remain. Same generic response for unknown/ineligible/suppressed/provider failure; provider latency is detached from the public response, minimum response duration retained. At most one request per account per60seconds and five perhour across identifiers/IPs, serialized under existing user/credential locks. Existing IP budgets also apply.
- Reuse PasswordResetToken without migration: versioned opaque `er1.<email-binding-digest>.<credential-binding-digest>.<random32bytes>` proof, only SHA256 of complete proof in DB. Binding digests contain user ID/current normalized email/emailVerifiedAt and current passwordHash/updatedAt, never raw email/password/password hash in the proof. A changed email, verification date or credential invalidates earlier proofs even if a different writer did not revoke their token rows. Reject legacy/non-email token formats for this route.
-30minute single-use lifetime. Current user/company/membership/credential rechecked under transaction locks before reserving token, immediately before dispatch, and before confirmation. Reissue revokes older PENDING reset tokens (including LINE) atomically; failure before reservation leaves existing proof intact. Prepare Postmark send attempt in the same transaction, bind purpose/recipient/deadline/intent to token, keep raw proof only in transient memory. Provider failure remains recoverable by explicit new request after cooldown; no blind replay of uncertain sends or durable raw-token queue.
- Confirm never changes password on page load. Require explicit matching new-password fields (8–128characters), reject reuse without burning proof, atomically claim unexpired token, rotate credential, clear temporary revealable password/expiry/forced-change, revoke every active auth session and other PENDING reset tokens, write security audit. No automatic login/token issuance: success returns only `{completed:true}` and next step is normal login with existing legal/company/platform gates.
- Lost confirmation response: same proof and same resulting current password may return the original completed outcome within5minutes of usedAt while email binding/current eligibility still hold; no credential/session/audit mutation or new access token. Different password, later credential rotation, expiry/revocation or changed email refuses retry. Browser distinguishes invalid link from temporary failure and offers retry, fresh request and login.
- Fragment proof via `/reset-password#token=...`, no tracking/analytics/raw proof logs; Postmark existing `TrackOpens:false, TrackLinks:None`. Referrer policy no-referrer and cache no-store for recovery page. Docs checked2026-09-15: [Postmark Email API](https://postmarkapp.com/developer/api/email-api), [link tracking](https://postmarkapp.com/developer/user-guide/tracking-links).
- Acceptance evidence must exercise real HTTP/PG/Next and simulated Postmark: known/unknown/unverified/ambiguous/disabled, username/email normalization, account and IP cooldown, current binding/security change races, provider rejection/uncertain response, expired/reissued/replayed/concurrent proofs, atomic audit rollback, old session rejection, no auto-login, fragment scanner GET, mobile44px/readable text, mismatch/reuse/retry/back/login. Keep LINE regression. This contract supersedes dormant email-reset code that auto-issued a login session; it grants no additional business access.


Local evidence2026-09-15: C07 configuration checks11, owner-approved email recovery7 and scheduled-policy regression12 real HTTP/PG/Next/Chromium groups PASS with simulated providers. Auth76, API/web typechecks,13 web error guards and maintenance pins PASS. See configuration-check-result.json and email-password-reset-result.json under docs/evidence/billing-integration-2026-09-13. Counts are separate and overlapping; remaining controls/mail/LINE/full acceptance and final CI/merges stay open. No native send/payment, CI dispatch, merge or deploy.
