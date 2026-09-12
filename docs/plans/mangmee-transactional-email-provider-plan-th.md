# แผน implement Postmark และใช้เอกสารลูกค้าจาก Stripe

สถานะ: **POSTMARK SELECTED / SPEC + API RESEARCH READY 2026-09-11; IMPLEMENTATION NOT STARTED**. Owner เลือก Postmark เพื่อมี Receipt ค่าอีเมลลงบัญชีบริษัท และให้ **Stripe ออก/ส่ง Invoice กับ Receipt ฝั่งลูกค้ามั่งมี**. [Spec](../specs/mangmee-transactional-email-provider-spec-th.md) / [Postmark API reference](../research/postmark-developer-reference-th.md) กำหนด contract ปัจจุบัน; ไม่ต้องเลือก provider ซ้ำ. ไม่มี account purchase/provider send/cloud change/deploy ในรอบเอกสาร.

## 1. ลำดับงาน

| ขั้น | งาน | Exit evidence / dependency | สถานะ |
|---|---|---|---|
| M0 Contract | เลือก Postmark, อ่าน endpoint/auth/error/webhook/attachment/receipt/sandbox และ map กับ port/outbox/SES field ปัจจุบัน; เลือกใช้ single-send API + app templates + Basic Auth webhook | spec §2–5 และ official reference ระบุได้; account-specific values ตรวจใน M4 ไม่บล็อกการเริ่มเขียน M1 ด้วย placeholder test config | **DOCS DONE**; actual account preflight NOT RUN |
| M1 Adapter/config | เพิ่ม postmark enum/getters/factory branch และ PostmarkAuthMailerAdapter; timeout/JSON-result/error mapping/tracking off/attempt metadata; รักษา disabled/console/SES และ no-op/opt-in methods | focused tests, config/API typecheck, DI boot โดย deny external network; no package.json change เว้นเปลี่ยน dependency ที่จำเป็น | NOT STARTED |
| M2 Delivery reliability | เพิ่ม provider-aware attempt/latest claim pointer และ migration; integrate API-side claim drain/lease/mint-at-send, error-aware scheduling/unknown reconciliation, public Postmark endpoint, sanitized callback outbox/suppression | real PG concurrency/crash/callback-before-response/replay/legacy regression + browser/API/DB; ไม่เก็บ Postmark ID ใน SES column | NOT STARTED |
| M3 Stripe customer documents | P26 reuse Stripe Invoice/PDF/Charge Receipt URL, company permission, unavailable/expired-link states และ Stripe email configuration/resend support | Stripe payment→invoice/receipt evidence และไม่สร้าง customer PDF/เลขใหม่/ส่งซ้ำด้วย Postmark. ไม่ต้องสร้าง custom tax-document subsystem | NOT STARTED; depends on P26 Stripe implementation/settings และ B06 ส่วนที่ใช้จริง |
| M4 Provider proof/rollout | provision account/server/stream/domain/keys/webhook auth, Sandbox proof, controlled live inbox, billing Receipt details, quota/retention/alerts/rollback | L0/L1/L2/L3 แยกผล; runbook protocol ครบก่อนเปิดจริง; provider selected ไม่เท่ากับ account approved/live ready | PARTIAL 2026-09-12: account approved/live; domain DKIM + custom Return-Path Verified; existing server/transactional stream confirmed, allowance 100 emails/period ([evidence](../agent-memory/postmark-domain-dns-2026-09-12.md)); integration/delivery proof/rollout NOT RUN |

M1/M2 สำหรับ P11 flow เดิมเริ่มได้โดยไม่รอ easy-signup code-vs-link/auto-approval หรือ e-Tax. หากจะเปิด signup/passwordless ใหม่ต้องผ่าน [E0–E3](unified-easy-signup-plan-th.md) และ returning login/recovery ด้วย. Runtime scope ไม่สร้าง general notification framework, broadcast, fiscal PDF generator, vendor invoice importer หรือ Postmark+Sender สอง adapter เผื่อไว้.

## 2. ไฟล์และ data migration

- Config: `packages/config/src/index.ts`, `apps/api/src/common/config/app-config.service.ts`, `apps/api/src/modules/auth/auth.module.ts` และ tests ของแต่ละส่วน; selector ปัจจุบันมี SES fallthrough ต้องแก้ branch อย่างชัดเจน.
- Adapter/template/port: เพิ่ม `apps/api/src/modules/auth/infrastructure/postmark-auth-mailer.adapter.ts` และ focused spec; reuse existing rendered templates. เพิ่ม delivery context/result ภายในเท่าที่ต้องผูก attempt ไม่เปลี่ยน auth semantics.
- Delivery: `external-signup/application/signup-claim-email.service.ts`, token service, outbox repository และ internal drain timer; เพิ่ม Postmark event controller/use-case แยกจาก SNS/SES validator. ต้อง reserve/exclude Postmark callback event type ใน generic drain และ register ใน API module.
- Schema: `EmailSendAttempt`, current claim-attempt reference และ index/unique ตาม spec §4; sanitized callback ใช้ OutboxEvent เดิม. Local suppression ที่เพิ่มต้องมี key provider/server/stream/recipient และ migration/retention ที่ชัดเจน ไม่ใช้ company ownership จาก callback.
- Migration additive: backfill legacy SES reference เท่าที่มี, ไม่แต่ง delivery evidence, คง SES field/endpointเพื่อ delayed event และ rollback. Postmark failure ห้าม retry ผ่าน SES อัตโนมัติ. Outbound rollback ไม่หยุดรับ callback ของ messages ที่ส่งไปแล้ว.
- Stripe: extend billing response/UI ตาม P26 ให้มีเอกสารที่สัมพันธ์กับ selected company; provider link เป็น sensitive capability. ไม่ proxy/download PDF โดยรับ URL จาก client และไม่เพิ่ม storage/numbering system แค่แสดง Stripe documents.

## 3. Acceptance matrix

ทุกแถวด้านล่าง **NOT RUN**. Row IDs EM01–EM14 คงไว้เพื่อ cross-reference แต่รายละเอียดปรับเป็น Postmark/Stripe ตาม Owner ล่าสุด; ยังไม่มีผล runtime เดิมที่ถูกเปลี่ยนเป็น PASS. แถวที่ไม่ใช้กับรุ่นที่เปิดต้องมี explicit DEFERRED พร้อมเหตุผล; ห้าม defer signup recovery/delivery correctness ที่เปิดจริง.

| ID | วิธีทดสอบ | Assertion |
|---|---|---|
| EM01 | DI/config disabled/console/SES/postmark valid/missing/test-token | disabled ไม่ส่ง, console local-only, selectorไม่ตก SES, non-local reject POSTMARK_API_TEST, secrets ไม่อยู่ frontend bundle |
| EM02 | Fake HTTP success/ErrorCode!=0/missing MessageID/malformed/200 batch-shaped | exact contract, tracking off, recipient/stream/metadata ถูก, accepted แยก delivered; ไม่รับ HTTP 200 อย่างเดียว |
| EM03 | 401/422 codes 300/406/412/413/1235, HTTP 413, 429 มี/ไม่มี Retry-After, 5xx/timeout | config/permanent/suppression/retry/unknown ต่างกัน, bounded attempts/deadline, scrub provider error, no blind failover |
| EM04 | Real PG workersชนกัน, lease หมด, crash ก่อน/หลัง POST, callback ก่อน response, late response | attempt สร้างก่อนส่ง, CAS/latest generation ถูก, dedupe outbox, ไม่ regrant/provisionซ้ำ; possible duplicate email รายงานตามจริง |
| EM05 | Legacy claim/verify/reset: expired/used/unknown/resend/email change/cross-device | hash-only mint-at-send, atomic single use, ไม่ขยาย activation window, no secret DB/outbox/log, no token-purpose confusion |
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

Test runner ปัจจุบันของ API คือ `tsx --test`. หลังเพิ่มไฟล์ตาม M1/M2 ใช้คำสั่งตัวอย่างต่อไปนี้; paths ของ Postmark เป็นไฟล์ที่จะสร้าง ไม่ได้มีผลรันทดสอบแล้ว:

```sh
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/infrastructure/postmark-auth-mailer.adapter.spec.ts src/modules/external-signup/application/postmark-event.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec tsc --noEmit
pnpm --filter @watchdog-bms/config exec tsc --noEmit
```

PG fixture และ Playwright reuse harness ที่ repo มี; เพิ่ม `postmark-email-delivery.pg.spec.ts` / `e2e/postmark-email-readiness.spec.ts` ตามตำแหน่งที่ reviewer เลือก แล้วบันทึกคำสั่งจริง. ไม่แก้ package.json เพียงเพิ่ม scripts/test path. Suite ใหม่ต้องจับ regression จริง ไม่ทดสอบแค่ object shape ซ้ำ implementation.

**L1 validation:** ใช้ public POSTMARK_API_TEST token กับ payloadสังเคราะห์; proof คือ request/API resultเท่านั้น ไม่ใช่ live domain/message receipt. ไม่เก็บ test tokenเป็นproductionsecret.

**L2 provider Sandbox:** account serverต้องสร้างเป็น Sandbox อย่าง explicitและผูก IDที่config; อาจเห็น Delivered/webhookแต่ไม่มีinbox และนับquota. Fake bounce domain ทดสอบ hard/softได้; SpamComplaint ใช้ authenticated synthetic fixture แยกเพราะ generatorไม่รองรับ. ไม่ส่งเมลจริงแล้วกดreport spamเพื่อให้testผ่าน.

**L3 inbox:** หลังมีaccount/domain/recipientที่อนุญาต ตรวจการรับจริงและauth headers. การส่งภายนอก/ซื้อบริการ/ตั้งค่าcloudเป็นงานopsตามscopeที่อนุมัติ ไม่ทำเพียงเพื่อปิดcheckboxรอบdocs.

**Stripe document proof:** ใช้ signed fixtures/Stripe sandboxหลังมี P26 implementation; test receiptใช้ทางmanual/providerที่docsรองรับ ไม่ถือว่าtest modeเปิดautoemailให้เหมือนliveเสมอ. ตรวจดาวน์โหลดInvoice/Receipt, Stripe email settingsและreceiverแยกจากpay→access. ไม่ต้องมีPostmarkinvoiceemailในflowนี้.

Evidence อยู่ `docs/evidence/postmark-email-<date>/`: exact source revision/hash, command/config/server mode, red/green counts, sanitized correlation IDs, cleanup และข้อจำกัดต่อระดับ. ไม่ใช้ Stripe S-pre/SES foundationเป็นPostmarkpass. ไม่มี evidence folder ใหม่ที่แอบอ้าง runtime pass ในรอบนี้.

## 5. Operations และข้อที่ยังเปิด

- M4 ระบุ account owner/plan/approval/quota/serverID/transactional stream, verified domain+DKIM+custom Return-Path, WEB_BASE_URL/from, Postmark Basic Auth callback secretและrotation/allowlistที่ตรงproxy. Record actual valuesในsecureopsconfig ไม่ใส่secretในdocs.
- Confirm webhook verification ต่อevent type, retry/dropbehaviorจากdocsกับaccountจริง, alertsและreconciliationถ้าendpointกลับมาหลังproviderหยุดretry. ให้callbackของprevious providerรับได้ระหว่างrollback; outboundเลือกทีละprovider.
- Providerเก็บmessage contentตามretention; บันทึกเวลาจริง/ผู้เข้าถึง/ค่าใช้จ่าย. Postmarkreceiptเป็นค่าใช้จ่ายบริษัทเรา ไม่ทำvendorimporter และไม่ส่งซ้ำcustomerinvoiceที่Stripeส่งอยู่.
- Stripeตั้งbusiness details/customer billing email/successful-payment+refund/invoice emailsettingsตามP26; reviewราคา/ภาษี/withholdingในB06ยังต้องจบก่อนเปิดขาย. **Thai tax/e-Tax generator deferred** ไม่ขยายงานmail providerเพื่อทำสิ่งนี้.
- Easy-signup E0 ยังต้องเลือก code/link, returning login/recovery, eligibilityและfieldsก่อนruntimeflowใหม่. ข้อนี้ไม่ทำให้provider selectionกลับไปOPEN.
- ก่อนแตะcloudอ่าน [cloud operations](../runbooks/cloud-environment-operations.md); ก่อน UAT/productionอ่าน [release protocol](../runbooks/uat-production-v2-deployment.md). ไม่มีdeployหรือเปิดpaidgateในรอบเอกสาร.

## 6. Definition of ready ของเอกสาร

- [x] Ownerเลือก Postmarkแล้วและแยก supplier Receipt / Stripe customer Invoice+Receipt ชัดเจน.
- [x] API/auth/error/webhook/idempotency/attachment/sandbox docsตรวจแล้ว; sender-specific assumptionsถูกแทนที่.
- [x] ระบุruntime gaps, migration, permission/state/secret boundariesและtest matrixที่ใช้จริง.
- [x] เชื่อม P11/P26/easy signup/ADR/mangmee_web และแยก scope tax/e-Taxที่ยังไม่ทำ.
- [ ] M1–M4 implementation + EM01–EM18; actual provider/Stripe document acceptance.

ผลตรวจเอกสาร/ลิงก์/fixturesบันทึกใน [task memory](../agent-memory/unified-easy-signup-2026-09-11.md). Docs-readyไม่ใช่production-ready; ไม่อ้าง API/inbox/E2Eผ่านจากการอ่านเอกสาร.
