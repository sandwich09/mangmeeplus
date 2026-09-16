# Plan: Optional LINE email + email OTP + verified email ก่อนชำระเงิน

วันที่: 2026-09-15
สถานะ 2026-09-16: SOURCE IMPLEMENTED / LOCAL VERIFICATION — dependency integration เสร็จแล้ว; CI และ native UAT/Production readiness ยังไม่ผ่านครบ ไม่มี feature flag ใหม่
Spec: [signup-optional-email-otp-billing-spec-th.md](../specs/signup-optional-email-otp-billing-spec-th.md)
Memory: [task state](../agent-memory/signup-optional-email-impact-2026-09-15.md)

## 0. Readiness review — 2026-09-15

- ขอบเขต UX/SA/dev, migration และ acceptance มีแล้ว พร้อมเริ่ม P0 จากนั้น P1–P2 ตาม exit criteria ไม่ถือว่า P0 ทุกข้อเสร็จหรือเริ่ม billing integration ได้ทันที
- ตรวจ source ที่ workspace HEAD `c0c925968e945d452a2b483b4ddd8b5fec99e847` พร้อม working changes: LINE submit/resume/status ยังต้องมี email, account email verification ยังส่ง raw link token ผ่าน mailer และ billing quote ยังรับ billingEmail จาก request ไม่พบ marker ของ OTP/revision/gate ใหม่ในพื้นที่ source ที่ตรวจ
- Provider/source dependency: [PR #558](https://github.com/MangmeeDev/mangmeeplus/pull/558) ยัง OPEN ตอนตรวจ และ checkout มีงานร่วมค้างอยู่ ต้องเลือก baseline ที่รวม compatible provider/billing changes ก่อนลงมือใน worktree แยก ห้ามถือว่าเอกสารที่ merge แล้วหมายถึงโค้ด provider merge แล้ว
- [Native delivery evidence](../evidence/postmark-native-delivery-2026-09-15.md) ผ่านเฉพาะการส่งจากหน้า Postmark: UAT server `20950027` / developer และ Production server `20950034` / contact (`outbound`) ถึง Gmail SMTP; ยังไม่ใช่ app OTP E2E
- Local canonical `infra/postmark/config.json` ยังระบุ UAT `ses`, Production `disabled`, secrets ว่าง ณ review นี้ จึงต้องจัดการ secret references, token-to-server binding, callbacks และ OTP key ใน release work พร้อมทดสอบผ่านแอปจริง ไม่ได้ตรวจหรือเปลี่ยน deployed runtime ในรอบนี้
- เพิ่ม account-merge writer และการ invalidate proof ของทั้ง source/target ใน P0/P2/A16/A29 แล้ว ส่วน D01 คงเป็น design default ตาม §1 ไม่ใช่คำยืนยันเลือกจากผู้ใช้
- Amendment ล่าสุด: always-on behavior ใน build, target-specific preflight/config/secret integration, cutover/rollback และ final customer acceptance อยู่ใน scope งานนี้ ไม่ทิ้ง activation หลัง deploy; เพิ่ม G21–G28, A49–A70 และ R01–R08 โดย A01–A70 ทั้งหมดยัง NOT RUN

## 1. ผลลัพธ์ที่ต้องส่งมอบ

LINE สมัครโดยเว้น email ได้จริงจนเปิดร้าน/กลับมาใช้ร้านเดิม ก่อนเริ่มชำระใหม่ user ต้องผูกและยืนยัน email ด้วย OTP เปลี่ยน email ต้องยืนยันกล่องใหม่ก่อนสลับ current address ไม่ทำให้ account/trial/เอกสาร/เงินซ้ำ และไม่กั้นการรับผลเงินเดิม/การยกเลิกต่ออายุ

ยึด design default D01 ใน spec: billing recipient สำหรับรายการใหม่เป็น verified account email ของผู้กดชำระ อีเมลรับเอกสารแผนกบัญชีแยกยังไม่รวม ถ้าเปลี่ยน D01 ต้องแก้ recipient entity/permission/OTP binding/consent/E2E ก่อนเริ่ม billing slice ไม่ทำเพียงเพิ่ม free-text input

Reuse โครงสร้าง Auth/Postmark/Billing ปัจจุบัน ไม่สร้างบริการ OTP ภายนอก ไม่เพิ่ม dependency ไม่แก้ package.json นอก dependency change และไม่ย้ายไฟล์ unrelated ใน checkout ที่มีงานค้าง

ผลส่งมอบต้องเป็น no-email signup + OTP + verified-email payment rule ที่ทำงานใน UAT และ Production เมื่อ release ของ target นั้นสำเร็จ ไม่มี `*_ENABLED` ใหม่, remote switch, company rollout list หรือ dashboard activation ของฟีเจอร์นี้ Config/secret/provider ถูกเตรียมและตรวจใน release โดยอัตโนมัติจาก canonical inputs; ถ้าค่าขาดหรือไม่ตรงให้ fail readiness ไม่มีสถานะสำเร็จแล้วรอคนเปิด flag

นโยบาย security/legal/customer access และ commercial billing เดิมยังใช้ตามสิทธิ์ปัจจุบัน แผนนี้ไม่เปิดรับเงินหรือ bypass maintenance ให้เอง การเปิดลูกค้าตาม release protocol ต้องเสร็จภายใน release acceptance จึงรายงานพร้อมใช้ได้ `PROMOTED_CLOSED` ยังเป็น deployed-not-launched ไม่ใช่ผลส่งมอบพร้อมใช้ที่ผู้ใช้ขอ

## 2. Source map และจุดที่ต้องแตะ

| ส่วน | ไฟล์/พื้นที่หลัก | ข้อควรระวัง |
|---|---|---|
| Signup contract/DTO | `packages/contracts/src/external-signup.ts`, `external-signup/presentation/http/public-line-signup.controller.ts` | web claim ยัง required; missing/null/blank แยกจาก malformed |
| Signup logic | `external-signup/domain/line-signup.logic.ts`, `application/submit-line-signup.use-case.ts`, `get-line-signup-status.use-case.ts` | helper required ใช้ร่วมกับ account profile; review history/replay/hash ต้องไม่หาย |
| LIFF/UI | `auth/presentation/auth.controller.ts`, `common/security/liff-page.security.ts`, queue/status pages | HTML และ JS คนละจุด; saved submission มี version/fields เก่า |
| Account security | `auth/application/use-cases/{account-profile,request-email-change,resend-email-verification,confirm-email-verification,unlink-line-identity,account-merge}.use-case.ts` | direct email setter/link routes ห้ามหลบ OTP; merge ย้าย email/verifiedAt ระหว่างสอง user ต้อง invalidate proof ที่ได้รับผลกระทบของทั้งคู่ |
| Identity/reauth | existing LINE login transaction / nonce / `LineIdTokenService`, auth controller/BFF | same principal/channel/purpose, fresh proof ไม่ใช่ client profile |
| Mail | auth mailer port, Postmark adapter/template, `EmailDeliveryService`, callback/monitoring | transport result แยก verified, ไม่เก็บ raw OTP/ไม่ blind resend |
| Data | `apps/api/prisma/schema.prisma` + additive migration | User email revision, token proof kind/binding, LINE intake policy, indexes |
| Billing | `billing.service.ts`, `billing-repeat.ts`, `billing-collection.ts`, operation/portal configuration/source helpers | new authorization vs observation/reconciliation ต้องแยกกัน |
| Web | CompanyProfilePage/security, BillingPage/collection panel, auth verify fallback, common API error copy/BFF | expired account route, return context, selection preservation, no auto-charge |
| Permission/expiry | current permission resolver, session and term-expiry recovery allowlist | own-account OTP ต้องเข้าได้จาก expiry-only context แต่ไม่ขยาย ERP/security-held access |
| Config / deployment | root `packages/config/src/index.ts`, `apps/api/src/common/config/app-config.service.ts`, `infra/postmark/config.{json,py}`, `infra/prod-ecs-express/deploy.sh`, `infra/kamal/release.py` | inspect effective config หลัง override/maintenance; environment-scoped OTP key ผ่าน auth secret contract เดิม |
| Release proof / controllers | root `.github/workflows/{deploy-uat,production-readiness,deploy-production-v2}.yml`, `infra/uat/verify-deploy-readiness.sh`, `infra/security/collect-production-runtime-readiness-v2.sh`, Kamal release evidence hooks | extend controller/test เดิมสำหรับ target readiness, old-writer drain, signed source/config proof; ไม่สร้าง pipeline คู่ขนานหรือข้าม validator |

เส้นทางไฟล์ตารางอ้างจาก `apps/api/src/modules/` เว้นแต่ระบุ root อื่น ให้ค้นชื่อปัจจุบันก่อนแก้เพราะมี billing work ต่อเนื่องอยู่ ไม่คัดลอก snapshot ที่เก่ากว่าทับงานล่าสุด

## 3. ลำดับ implement และ exit criteria

### P0 — Freeze contract และ inventory

- [x] บันทึก user requirements, design defaults, invariant, UX/state/action matrix และ impact register
- [x] อ่าน spec/plan หลักล่าสุดและส่วนที่ owner เปลี่ยนใน billing/provider ตรวจ baseline revision/source ใหม่ก่อน implement
- [x] สร้าง isolated worktree จาก branch เป้าหมายที่ตกลงสำหรับ implementation รักษา dirty checkout เดิม
- [x] ใช้ D01 account recipient เดียวเป็น implementation baseline ตาม spec; หากไม่มีคำสั่งเปลี่ยน scope ไม่สร้าง approval task ใหม่ ส่วน web claim/passwordless recovery ไม่เผลอขยาย
- [ ] ไล่ writer ทั้งหมดที่เปลี่ยน User.email/verifiedAt/credential/identity รวม account merge ของ source/target และ final provider calls ทุกประเภท ใช้ source inventory ที่ระบุเส้นทางจริง ไม่มีช่อง financial retry ที่ตกหล่น
- [x] กำหนด schema/lock order กับ retry semantics ร่วมกับ billing/reset/initial-password ก่อนเขียน migration
- [ ] Inventory local fixture cohorts ตาม §6; native environment inventory ทำเฉพาะ release work หลังอ่าน runbook
- [ ] ระบุ release path จริงของ UAT Kamal และ Production V2 จาก runbook; evidence bridge/Passport ต้องเป็นชนิดที่ validator ยอมรับ ไม่แทนด้วย operation ID คนละระบบ
- [ ] Inventory effective config writers/overrides, existing signup switches, old API/worker writers และ rollback-compatible artifact; ผูกทุก dependency กับ P1/P6/P7/R01–R08 ไม่มีงาน “เปิด flag ทีหลัง”

Exit: contract ที่เลือก implement ไม่มีข้อกำหนดสวนกัน, billing fields/permissions/locks และ migration policy ชัด ไม่ใช้ “provider เชื่อมแล้ว” เป็นหลักฐาน OTP เสร็จ

### P1 — Additive model และ compatible readers

- [x] เพิ่ม User.emailRevision, token OTP fields/proofKind/request idempotency และ intakePolicyVersion ตาม spec
- [x] Backward compatible readers สำหรับ LINK legacy, no-email legacy signup และ old billing snapshots; ไม่ mark verified/backfill หลักฐานปลอม
- [x] Additive index/migration ที่ตรวจ duplicate/partial uniqueness; expire/revoke PENDING rows ก่อน insert replacement ใน transaction
- [x] Define minimal shared email eligibility/binding construction ที่เรียกจาก auth/billing ได้โดยไม่สร้าง generic policy framework
- [x] เพิ่ม OTP secret/config validation ตาม existing secret handling; key แยกและ versioned ไม่มี default secret
- [ ] Implement spec §10 environment contract: authoritative environment ใน HMAC, `EMAIL_OTP_HMAC_KEY`/version แยก UAT/Production, API/worker version consistency; local simulator แยกและไม่ถูกเลือกใน cloud release
- [ ] พิสูจน์ migration บน disposable copy พร้อม rollback-reader compatibility

Exit: old data อ่านได้, migration ไม่เปลี่ยน email/identity/financial facts, no-email cohort ไม่ถูก auto-provision

### P2 — OTP application flow และ Postmark transport

- [x] Implement authenticated request/status/confirm/resend/cancel, current permission, currentPassword หรือ fresh LINE reauth
- [x] CSPRNG 6-digit string, HMAC binding, server TTL/counters, per-user/recipient limits และ existing trusted-IP limiter
- [x] Atomic request reservation/replacement/audit/idempotency; send outside transaction และ binding recheck
- [ ] Atomic confirm: one winner, User revision/address/verifiedAt, related proof invalidation, other-session revocation, audit rollback
- [x] Compatible account-merge writer: source/target revision และ applicable challenge/reset/security/quote proof invalidation ใน transaction เดียว รักษา existing merge authority และไม่สร้าง verified evidence ใหม่; deterministic two-user lock order ตาม P0
- [x] Preserve current email ระหว่าง pending; expired pending ไม่กั้น current verified email ถาวร
- [x] Same current verified target เป็น no-op; active pending อื่นยังต้อง confirm/cancel ชัดเจน, canonicalization ไม่ตัด plus/dots และ UAT non-allowlisted target ล้มก่อนเปลี่ยน challenge/budget
- [ ] Shared budgets/database time หลาย instance; limiter outage ไม่ข้ามเพดานและไม่เปลี่ยน proof เดิม; expiry gate ไม่พึ่ง cleanup worker ต้องทำงานทัน
- [x] Reuse Postmark attempt/error/suppression/reconcile และ OTP template; no raw OTP queue/log/URL/analytics
- [x] Lost request/confirm response ใช้ read/status ของ reservation เดิม; ส่งใหม่ภายใต้ budget โดย code เก่าถูก revoke
- [x] Security notice หลัง commit ไปช่องทางเก่าที่เชื่อถือได้; เพิ่ม supported purpose/template หาก port เดิมยังไม่มี ห้าม no-op แล้วบอก notified
- [x] ปิด new link/direct unverified-account-email bypass แบบ backward-readable contract; legacy verification page มีทาง request OTP ใหม่

Exit: actual HTTP + real PG ยืนยันการผูก/เปลี่ยนได้และ race/failure ไม่ทำให้ wrong user/wrong email verified; mail simulation ครบ ไม่ต้องมี LINE สำหรับผู้มี credential

### P3 — Optional LINE intake และ last-login protection

- [x] Optional intake normalizer เรียก required validator เดิมเมื่อมีค่า; DTO/contract/LIFF HTML/JS/status consistent
- [ ] Policy-aware resume/retry/empty correction, exact submission replay, prior review signals และ admin resolution
- [ ] explicit owned continuation สำหรับ legacy addressless partial row ไม่สร้างคำขอ/ร้าน/trial ใหม่
- [x] ห้ามถอด active login สุดท้ายที่ backend; usable credential ต้องมี login identifier และสถานะ/expiry ผ่าน verified email อย่างเดียวไม่พอ
- [ ] Guard race กับ first-password, password disable, identity unlink/link และ session revocation
- [x] API self-unlink ปฏิเสธ last-login พร้อมข้อความไปตั้ง backup password; product ปัจจุบันไม่มีปุ่ม self-unlink ของลูกค้า แสดง backup-password/support path ที่ไม่บังคับก่อนใช้งาน (ไม่เพิ่มการกู้บัญชีจาก contact-only data)

Exit: LINE no-email first/add shop เดินครบทั้ง auto/manual/retry/reject/reopen; web/email-claim เดิมไม่เปลี่ยน ไม่มี last-login lockout จาก unlink

### P4 — Verified email gate ก่อน financial authorization

- [x] Server-derived emailRequirement/current recipient; firm quote เพิ่ม proof snapshot/version; old quote ไม่มี proof ให้ requote
- [x] Gate ใน transaction ที่ reserve attempt และก่อน first provider mutation; current actor/selected company/owner/status ไม่ใช้ client boolean
- [ ] ครบ initial/repeat/upgrade/restart/manual collection/resume/new payment URL/เปิด auto-renewal กลับ/แก้บัตรที่อาจเรียกเก็บ ไม่ gate อ่าน/cancel/downgrade-without-charge/paid reconciliation
- [x] Reuse source/version/lease/idempotency guards; already dispatched attempts รักษา original authorization/evidence ไม่มี retry สร้าง attempt ใหม่จาก timeout
- [x] ป้องกัน provider portal แก้ customer email โดยไม่ผ่าน OTP/authorization: ตรวจ configuration รวม customer_update email capability และเลือก restricted flow ที่รองรับจริง ไม่สมมติว่าซ่อนช่องใน app ครบแล้ว
- [ ] Provider URL เก่า/hosted invoice ที่ยังจ่ายได้: inventory และ bound original-authorization semantics; reuse original expiry/reconcile workflow ไม่อ้างว่าปิดปุ่มคือ revoke URL
- [x] `UPDATE_BILLING_EMAIL` สำหรับ current selected company/อนาคต: preview ระบุผู้รับเดิม/ใหม่ ใช้ current verified user email, owner authority, exact source/version, operation idempotency, provider readback/recovery ไม่แตะราคา/วัน/สิทธิ์/เงิน
- [x] New recipient ไม่ fan-out ไปทุกบริษัท; old invoice/receipt/contract snapshots immutable, future recipient change มี audit/version แยก
- [ ] Expiry-only own-account OTP route และกลับเข้า billing ทำงาน; security holds และ membership withdrawal ยังปฏิเสธ

Exit: ไม่มีเส้นทางเริ่มจ่ายใหม่ด้วย unverified/mismatched email และไม่มี paid event/เอกสาร/cancel ถูก gate ทำเสีย; existing automatic renewal เป็น retained-contract cohort ที่รายงานชัด

### P5 — UX integration

- [x] Shared OTP panel/page ใน account และ billing ที่ใช้ API/state machine เดียวกัน ไม่มี form หลายชุดที่กติกาไม่ตรง
- [x] Missing/unverified/pending/verified/expired/rate-limit/delivery-unknown/loading/error/permission states มี Thai copy/next step
- [ ] เก็บ selection/context แบบ allowlist; session expire/LINE→external browser/mail app/multi-tab กลับบริษัทและตัวเลือกเดิมได้หลัง reauth
- [ ] OTP 6 หลัก single input, paste/leading zero, mobile 320/390/768/1280 และ zoom 200%, 44px targets, focus/keyboard/screen reader
- [x] Verification success ต้อง requote/review/explicit payment consent ใหม่ ไม่ auto-charge; หากราคา/สิทธิ์/selected company เปลี่ยนบอกชัด
- [ ] Current verified email + provider outage ยังซื้อได้; unverified outage ใช้งานส่วนอื่น/ดูเอกสาร/cancel ได้
- [x] Billing recipient ของสัญญาเดิมต่างจาก account emailใหม่แสดงตรง และมีปุ่ม change future recipient ของบริษัทที่เลือก

Exit: เดิน flow ด้วย browser จริงโดยไม่พึ่งบอกผู้ใช้ให้ refresh เองทุก error; screenshot + transition assertions ไม่ใช้ screenshot อย่างเดียวเป็น proof

### P6 — Integration, regression และ acceptance

- [ ] รัน matrix §5 ด้วย actual API/PG/web/LIFF และ provider simulator รวม delayed/unknown/native-like callbacks
- [ ] Focused API/web typecheck, relevant auth/signup/billing tests แล้ว full workspace checks ตาม CI ปัจจุบัน
- [x] ทดสอบ migration cohorts จาก disposable database ไม่ใช้ production write หรือ customer inbox เป็น test fixture
- [ ] Controlled native Postmark inbox acceptance เมื่อมี test mailbox ที่อนุญาต: verify correct sender/server/stream, accepted/delivered, OTP entry, expiry/resend; ไม่ใช้ native Stripe charge เพื่อพิสูจน์ auth gate
- [ ] QA มือถือ/ผู้ใช้ทั่วไปให้ทำงานจริง รวมอย่างน้อย walkthrough ผู้สูงวัยเมื่อมีผู้ทดสอบ; ระบุ sample/ข้อจำกัด ไม่อ้างผล usability ถ้ามีเพียง automation
- [ ] Evidence เก็บ exact commit/source hashes, commands, result counts/skips, screenshots และ known limitations; ไม่รวม raw email/OTP/token/password/provider body
- [ ] Runtime/config tests เรียก actual render/preflight/controller functions กับ fixtures: no activation flag, wrong overrides/provider/server/origin, missing secret, UAT allowlist เข้า Production, secret drift หลัง READY ต้อง fail ก่อน mutation ไม่ใช้ grep อย่างเดียวเป็น proof
- [ ] Rehearse deploy จริงใน disposable environment: old-writer drain, pending LINK cutover, cached client, crash/checkpoint/resume, multi-instance restart และ compatible rollback หลังเกิด OTP/addressless/paid facts ใหม่
- [x] Clone fixtures ห้ามส่ง email/payment จริง: isolate outbound, ไม่เริ่ม customer queue และไม่ใช้ production secrets เป็น runtime test inputs
- [ ] Native app proof แยก environment: UAT ใช้ mailboxes ที่อนุญาตใน allowlist; Production ใช้ controlled account/mailboxes ที่อนุญาต ทดสอบ OTP โดยไม่ก่อ native charge และไม่เปลี่ยน account email ลูกค้าจริง

Exit: acceptance หลักครบและ failures ไม่มี financial/account integrity gap ที่เปิดอยู่; หาก native inbox ยังไม่ตรวจต้องระบุ readiness ยังไม่ผ่าน ไม่ติ๊กครบจาก mocks

### P7 — Release ที่พร้อมใช้ ไม่มี activation ภายหลัง

ทำตามลำดับนี้เมื่อมี implementation/deployment task ที่อนุญาต; การแก้แผนรอบนี้ไม่ dispatch run หรือแก้ cloud

1. **Prepare both targets:** integrate provider/billing dependency ที่ reviewed แล้ว, provision secret references และ OTP keys แยก environment, canonical `provider=postmark` ทั้งคู่, intended callback URL/auth configuration และ confirmed test mailbox scope รวม old/new address ไม่อาศัย diagnostic template จาก native UI ไม่มี secret value ใน repo; handler/auth ของ candidate ทดสอบจริงหลัง rollout ไม่คาดให้ old runtime รองรับ key/endpoint ใหม่ก่อน deploy
2. **Release proof:** implement R01–R08 ใน controller/evidence hooks เดิม ตรวจ rendered config หลังทุก override รวม serving mode, schema/lock rehearsal, image/controller digest และ secret freshness; ใช้ actual current target inventory หลังอ่าน runbooks ถ้าขาดให้ fail ที่ preflight ไม่ใช่ deploy แล้วค่อยแก้ provider
3. **Apply/drain/cutover:** schema additive → rollout isolation/drain old API/worker admissions → revoke scoped legacy LINK อย่าง idempotent → compatible candidate API/worker/web/LIFF → runtime readback ก่อน expose; register/verify native callback against candidate ตาม protocol และตรวจ durable/auth behavior ก่อนส่งมอบ เก็บ original unknown/dispatched attempt และ callbacks ไม่ล้าง queue; rehearsal ต้องพิสูจน์แต่ละ failure boundary
4. **UAT acceptance:** normal no-email signup/ERP, actual OTP/change/cancel/resend, payment summary/explicit consent, expiry recovery, migration/rollback, mobile/older-user walkthrough และ correct environment sender/callback ผ่าน A matrix ตามชนิดหลักฐาน ไม่เปิด flag หลัง rollout
5. **Restart/redeploy proof:** ใช้ candidate/config เดิมผ่าน controller ที่อนุมัติใน operation ถัดไปหลัง run เดิม terminal พิสูจน์ว่า provider/keys/policy/recipient isolation และ pending OTP/budgets คงอยู่ ไม่ต้องเปิดสวิตช์ซ้ำ; ห้าม dispatch duplicate เพื่อทดสอบ recovery
6. **Production promotion:** exact UAT-approved immutable digests, fresh Production preflight/READY, migration cohorts และ rollback readiness ผ่านตาม protocol ไม่ rebuild image หรือ copy UAT data/secrets; record candidate/controller/UAT/READY/Production IDs และ artifact digests
7. **Customer-ready acceptance:** serving mode/legal/PlatformAccess ตาม [mandatory protocol](../runbooks/uat-production-v2-deployment.md), correct live rendered values และ public OPEN/normal auth/logout acceptance ครบใน release เดียว พร้อม controlled Production app OTP/return-to-summary proof ไม่ส่งมอบ activation task ให้ผู้ใช้และไม่เพิ่ม admin endpoint สำหรับ bypass OTP ถ้า customer path ยัง CLOSED/ทำ OTP ไม่ได้ ห้ามรายงาน ready
8. **Handoff:** evidence source/config ตรงจริง, metrics request/accepted/delivered/verified/error แยกกัน, known limitations ชัด, all required rows/R gates มีผลและไม่มี feature flag/provider/key/callback setup ค้าง หาก fail ใช้ exact operation recovery/compatible artifact ตาม spec §10.4 ไม่ restore DB หรือถอยไปเปิด unverified payment

Exit: UAT_READY และ PROD_READY ต้องผ่าน R01–R08 ของ target นั้นจริง; signed deployed-but-closed, UI provider send หรือ source/tests อย่างเดียวไม่ใช่ live feature acceptance

## 4. Verification strategy / commands

Baseline เดิมที่ตรวจแล้วใน impact audit: 106 tests ผ่าน (zero skipped) ใน `/tmp/signup-optional-email-impact-20260915-tests.log`:

```sh
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/external-signup/domain/line-signup.logic.spec.ts src/modules/auth/application/use-cases/account-profile.use-case.spec.ts src/modules/auth/line-liff-signup.spec.ts
```

คำสั่งนี้ยืนยัน old behavior เท่านั้น ระหว่าง implementation ต้องเพิ่ม tests ที่ assert contract ใหม่และ boundary จริง ไม่แค่ snapshot implementation รันผ่าน pattern เดิม `pnpm --filter @watchdog-bms/api exec tsx --test <focused-spec-files>` และ real-PG runner ที่ตั้ง `DATABASE_URL` ไป disposable database เท่านั้น

หลัง focused checks ผ่านใช้ `pnpm typecheck` / `pnpm test` ตาม scripts ที่มีอยู่; ไม่แก้ package.json เพื่อเพิ่ม alias ของงานนี้ Browser/HTTP smoke ใช้ pattern scripts ใน `apps/api/src/scripts/` และ local provider simulation ปัจจุบัน ไม่รัน smoke/build ทับ process หรือ frozen evidence ของงานอื่น

Native send แยกจาก local proof ต้องมี test address ที่ระบุสำหรับทดสอบและ config ที่ตรวจตาม runbook ห้ามหยิบ email ลูกค้าจริงจาก database มาใช้ ห้าม log credentials หรือ raw OTP ใน test report

## 5. Acceptance matrix

ทุกแถวเริ่ม NOT RUN สำหรับ feature ใหม่ ติ๊กได้เมื่อมีหลักฐานตามชนิด ไม่ใช้ baseline tests เดิมแทน

| ID | Scenario / assertion | ชั้นหลัก | Gap |
|---|---|---|---|
| A01 | New LINE omitted/null/blank email → one user/company/trial; malformed nonblank still rejects | HTTP/PG/LIFF | G01/G03 |
| A02 | Lost submit response, same/different tabs, reopen LIFF → exact same request/shop | HTTP/PG/browser | G02 |
| A03 | Auto cap/repeat trial/prior rejection/known shop rules still apply without email | PG/integration | G04 |
| A04 | Existing duplicate email then cleared cannot silently skip review | PG/admin/UI | G04 |
| A05 | Manual/REQUEST_INFO/reject/reapply/provision failure/READY recovery without email | HTTP/PG/LIFF | G02 |
| A06 | Web signup/claim link and legacy client still work; web email remains required | HTTP/browser | G18 |
| A07 | Legacy partial null requires owned explicit continuation, old hash replay preserved | PG/LIFF | G02/G18 |
| A08 | No-credential LINE user requests OTP after fresh same-user reauth; wrong user/channel/stale proof rejected | HTTP/PG | G09 |
| A09 | Password user requires current password; disabled/security-held/foreign user cannot change | HTTP/PG | G09/G16 |
| A10 | 6-digit leading zero/paste/correct code → verify same account exactly once | HTTP/PG/browser | G06/G07 |
| A11 | Wrong/expired/revoked/old-resend code does not verify or overwrite old email | PG/browser | G07/G08 |
| A12 | 5 attempts atomic and aggregate hourly budget cannot reset by resend/target changes | PG/concurrency | G07 |
| A13 | Same requestKey replays without extra email/budget; changed body conflicts | HTTP/PG | G08/G15 |
| A14 | Concurrent confirm/resend/cancel/target change exactly one valid version | PG/concurrency | G08 |
| A15 | Email taken concurrently / username collision → conflict, no account merge/orphan | real PG | G16 |
| A16 | Password/reset/identity/role/session changes and explicit account merge invalidate applicable bindings; source/target OTP and merge-vs-confirm race cannot verify the wrong user | HTTP/real PG concurrency | G09/G19 |
| A17 | Audit failure rolls back email/used proof/session updates; lost response reads completed outcome | PG/HTTP | G19 |
| A18 | No raw OTP/email/credential in logs/URL/analytics/outbox; key rotation does not accept old revoked proof | capture/source/security | G07/G15 |
| A19 | Reauthentication age checked at challenge start; in-window code entry is not needlessly re-prompted at minute 5 | clock/HTTP/browser | G06/G09 |
| A20 | Crash before dispatch, accepted reply lost, unknown send, late mail, duplicate callback recover truthfully | PG/provider simulation | G15 |
| A21 | Suppression/permanent/provider-down → no fake success/no suppression clear; new request budget applies | HTTP/mail simulation | G15 |
| A22 | Existing verified email + mail provider down still passes payment gate | HTTP/billing | G17 |
| A23 | Pending new target keeps current email; cancel/expiry returns to usable old verified email | PG/browser | G08/G17 |
| A24 | Unlink last LINE without usable credential rejected; verified email alone still insufficient; race with credential disable | PG/HTTP | G05 |
| A25 | Set backup username/password without email → login; unlink only after usable alternative | HTTP/browser | G05/G20 |
| A26 | Missing/unverified email cannot firm quote/checkout via direct API or client-forged flag | HTTP/PG | G11/G16 |
| A27 | Every initial/repeat/upgrade/restart/manual-collection/resume new-money path checks gate | integration/provider spy | G11 |
| A28 | Other OWNER's verified email/foreign company context cannot authorize current actor | HTTP/PG | G16 |
| A29 | Change email/request pending or merge source/target after quote → stale/refusal before dispatch, selection retained, no new charge from stale proof | real PG race/browser/provider spy | G11/G19 |
| A30 | OTP success returns fresh summary; no auto-charge; changed price/usage/company needs explicit consent | browser/HTTP | G06/G11 |
| A31 | Email change after dispatched checkout retains original recipient/attempt; complete-vs-expire race reconciles one payment | PG/provider simulation | G12/G18 |
| A32 | Paid webhook/application/refund/credit note still process after email changed/null; no duplicate ledger/grant | actual paid-prefix simulation/PG | G12 |
| A33 | Read history/download old documents/cancel auto-renewal do not require new OTP | HTTP/browser | G17 |
| A34 | Existing scheduled renewals follow retained contracts; new reopen/financial action follows gate | scheduler/provider simulation | G18 |
| A35 | Expired-term owner enters email OTP and returns to renewal; security-held account still denied | HTTP/browser | G13 |
| A36 | Same user multiple companies keeps memberships; email change does not fan-out Stripe customers/history | PG/provider spy | G14 |
| A37 | Selected-company future-recipient change: owner preview, source stale/revoked role, exact-key lost response/readback | HTTP/PG/provider simulation | G14/G19 |
| A38 | Stripe portal cannot bypass verified recipient via customer-email editing; config drift fails visibly | adapter/HTTP | G10/G11 |
| A39 | Existing link/direct email setter cannot bypass OTP after cutover; pending web claim/reset unaffected | HTTP/migration/browser | G10/G18 |
| A40 | Legacy quotes/addressless rows/verified users/issued sessions/cohort replay match migration rules | migrated PG copy | G18 |
| A41 | Rollback compatible readers keep core/read/reconcile and do not re-enable unsafe writes | migration/release rehearsal | G18 |
| A42 | OTP input 320/390px, zoom 200%, keyboard/screen reader/error focus/long target email | actual browser | G06 |
| A43 | Close mail app, different device, session expiry, reload, company switch → same principal/context or safe prompt | actual web/LIFF | G06/G16 |
| A44 | OWNER without email runs expense/SRC/RB create/sign/approve/print/download, permissions unchanged | API/PG/browser/PDF | G14 |
| A45 | Monitoring separates request/accepted/delivered/verified, no secrets and no generic admin OTP resend | HTTP/monitoring | G15 |
| A46 | Controlled native inbox OTP delivered and entered; expiry/resend works; record source + server/stream identity safely | native test mailbox | G15 |
| A47 | Verified email but no credential UI/help does not promise passwordless login/reset; recovery help reachable without lost LINE | browser/support walkthrough | G20 |
| A48 | User/older-user walkthrough can skip at signup, understand prompt, correct typo, cancel change and return to purchase | human usability + browser | G06/G20 |
| A49 | Fresh/existing users get optional LINE email, OTP and payment rule from the deployed build without feature switches or tenant opt-in | HTTP/browser/config contract | G21 |
| A50 | Missing provider/OTP secret, disabled/SES override, false live signup config or wrong origin fails candidate preflight; previous serving state unchanged before mutation | actual config renderer/controller fixtures | G21/G25 |
| A51 | Wrong/cross-environment server/token/key/channel/origin rejected; UAT OTP cannot verify Production even with copied challenge metadata | config/native identity + HTTP/security | G22 |
| A52 | UAT disallowed old/new target fails before reservation without losing a valid challenge; production has no UAT allowlist and never redirects recipient to a tester | mail adapter/HTTP/browser | G22/G27 |
| A53 | Old API/worker admissions drained before new policy exposed; legacy direct email/link/payment mutations cannot succeed during cutover | disposable rollout/concurrency | G23 |
| A54 | Cached old LIFF/web contract gets safe reload/upgrade with form/selection retained; no duplicate signup/shop/payment and no legacy bypass | actual old/new browser + HTTP | G23 |
| A55 | Migration retry after interruption handles duplicate/expired pending/index cohorts without inventing verification or modifying old hashes; checkpoints/counts match | disposable migrated PG/release task | G24/G27 |
| A56 | Rehearsal clone with pending mail/billing work cannot send or charge externally; test runtime has isolated credentials and outbound policy | clone/network/provider spy | G22/G24 |
| A57 | Compatible rollback after new null signup/OTP/email change/paid event preserves current facts, consumes no proof twice and leaves reconciliation/cancel usable | migrated PG/rollback rehearsal | G24 |
| A58 | Each target's app sends/accepts OTP with its intended From/server/stream, correct origin and actual permitted mailbox; provider UI delivery alone cannot pass | native UAT + controlled Production app/browser | G25/G28 |
| A59 | Bad webhook auth/wrong server/stream rejected; durable duplicate/late/bounce callbacks through cutover/rollback never revive code or grant verification/paid rights | callback ingress/provider simulation/native | G22/G25 |
| A60 | Secret/config/controller drift between READY and runtime mutation stops release without guessed retry or cross-environment fallback | controller fixtures/secret metadata | G22/G28 |
| A61 | Two API instances/restart share expiry/attempt/resend budgets; DB/limiter failure does not grant verification or reset budget, and recovery is readable | real PG/limiter/concurrency/clock | G26 |
| A62 | Coordinated OTP key rotation revokes old challenges, retires old instances and permits fresh request; verified email/sessions/paid facts not reset by key change | deployment rehearsal/HTTP | G26 |
| A63 | Same normalized verified email creates no challenge/budget use; it does not silently cancel a different active change; typo/plus alias follows existing normalization and explicit correction | HTTP/browser | G27 |
| A64 | Legacy null/blank address with non-null verifiedAt does not pass email gate or receive invented email; valid historical verified users need no mass reverify | migrated PG/API | G27 |
| A65 | Expired pending stops blocking even when cleanup worker is delayed; cancel/rate-limit/resend recovery preserves original email and refreshes summary | real PG/clock/browser | G27 |
| A66 | Post-release mail outage does not crash/restart ERP; verified users still pass email rule while unverified users get truthful recovery; docs/cancel/paid callbacks work | runtime fault injection/HTTP | G25 |
| A67 | Actual UAT and Production LINE reauth use their approved channel/origin/nonce; returning from mail/expired session retains correct company and never reprovisions user | native LINE/browser/HTTP | G06/G22/G28 |
| A68 | Normal redeploy/restart retains canonical Postmark and OTP rule without a flag action, and preserves pending challenge/budgets/verified state | controller + runtime/readback | G21/G26 |
| A69 | Production rejects unapproved digest/stale Passport or incompatible UAT proof; CLOSED or missing normal customer acceptance cannot produce feature-ready result | signed release validator/customer HTTP | G28 |
| A70 | Failure at each migration/drain/cutover/provider boundary uses original operation recovery; no duplicate dispatch, lost paid event or unsafe rollback | release rehearsal/ledger assertions | G24/G28 |

## 6. Migration rehearsal inventory

Fixtures ต้องมี verified/unverified/null users, LINE-only/password-only/both/no usable credential, two OWNERs, owner of multiple companies, account-merge source/target ที่มี pending proofs/quotes ทั้งกรณีย้าย email และเก็บ email ของ target เดิม, term-expired/security-held/withdrawn membership, old/new LINE request revisions ทุก nonterminal state, duplicate email/username collision, pending LINK/OTP/reset/claim, unknown mail attempt, unused old quote/new quote, open/complete/unknown provider checkout, legacy paid subscription/recurring recipient, actual paid ERP/billing facts

ก่อน/หลัง migration เปรียบเทียบ user/company/trial counts, membership/credential/verifiedAt/address, request IDs/hashes/review facts, paid/ledger/document checksums ไม่มี synthetic verified timestamps หรือ mass-email update ถ้า migration เปลี่ยน legacy account-verification tokens ต้องตรง cutover scope และมีจำนวน/เหตุผลที่ audit ได้

เพิ่ม fixtures: null/blank email ที่มี verifiedAt ผิดรูป, expired pending แต่ cleanup ยังไม่ทำ, interrupted migration/index creation, pending OTP ของคนละ key/environment, queued mail/unknown checkout ขณะ drain, old cached client และ confirmed email/paid facts ที่เกิดหลัง cutoverก่อน rollback แต่ละ fixture อยู่ใน disposable environment ที่ไม่ส่งไป real recipient/payment provider

## 7. Evidence และ completion rule

สร้าง evidence directory ของงานนี้เมื่อเริ่ม implementation เก็บ manifest + exact source revision, command exit codes, meaningful counts/skips และรูปที่ดูจริง ไม่อ้างว่ารายจ่าย/PDF/native mail ผ่านจาก typecheck

Product/architecture evidence: D01, action matrix, states, email vs login/recovery distinction และ accepted migration exceptions ชัด

Implementation evidence: scoped diff/no dependency churn, final writer/consumer inventory, crypto/budget/atomicity/current authority/lock-order tests

Integration evidence: A01–A70 และ R01–R08 โดยชนิดหลักฐานครบ หรือระบุแถวที่ยังไม่ผ่านและผลกระทบต่อ release อย่างตรงไปตรงมา; spec/plan complete ไม่เท่ากับ implementation หรือ UAT/Production complete

รอบเขียนเอกสารนี้ตรวจได้เฉพาะความครบ/link/source consistency ไม่รัน implementation E2E และไม่สั่ง CI/merge/deploy/ส่งเมลจริง

## 8. Release gates และเกณฑ์พร้อมใช้ของแต่ละ environment

Gates ต่อไปนี้เป็น required checks ใน release เดิม ไม่ใช่ feature flags ค่าเริ่มต้นทุกตัว NOT RUN; ห้ามเปลี่ยนเป็น PASS จากการแก้เอกสาร

R01/R03 และ input/native identity ของ R02 ตรวจให้พร้อมก่อน mutation; R04 และ actual candidate callback/OTP/customer acceptance ของ R02/R06/R08 ตรวจหลัง rollout ก่อนส่งมอบ ไม่ผูก preflight กับ endpoint ใหม่ที่ old runtime ยังไม่มี ความล้มเหลวช่วงหลังทำให้ release ไม่สำเร็จและใช้ recovery เดิม ไม่ dispatch อีก run เพื่อค้น error

| ID | ต้องผ่านก่อนส่งมอบ | หลักฐาน/ขอบเขต |
|---|---|---|
| R01 | Source/config พร้อม ไม่มี activation ค้าง | reviewed candidate/controller/CI, rendered live config หลัง overrides, provider Postmark และ existing signup config ถูกต้อง, ไม่มี feature switch ใหม่; A49/A50 |
| R02 | Target identity/secrets/transport พร้อม | dedicated server/stream/From/origin/LINE channel, key/ref/version, quota/sender, authenticated callback และ UAT recipient isolation; A51/A52/A59/A60 |
| R03 | Schema/cohorts/rollback พร้อมก่อน cutover | additive migration dry run + interruption recovery บน isolated clone, counts/facts, rollback-compatible artifact และ zero external sends; A55–A57 |
| R04 | Runtime ทุก writer/reader ใช้ contract ที่ compatible | old-writer drain/in-flight outcome, scoped LINK retirement, client upgrade, current schema/digests/config, callback continuity; A53/A54/A70 |
| R05 | Core security/payment rule ผ่าน | A01–A45/A47 ตาม test layer รวม actual PG/API/browser, no bypass/duplicate charge/last-login lockout และ ERP/SRC/RB regressions; evidence จาก candidate เดียว |
| R06 | App/native/UX พร้อมใน target จริง | A46/A48/A58/A67: UAT มี native OTP + human usability และ LINE flow; Production มี target-specific controlled OTP/LINE/return-context smoke ด้วย authorized fixtures ใช้ UAT evidence สำหรับ destructive/fault scenarios ไม่ยิงเงินจริงหรือ spam ลูกค้า |
| R07 | Operability คงอยู่หลัง restart/rollback/failure | A61–A66/A68/A70, config ไม่กลับ SES/disabled, key/limit/expiry continuity, verified user/core/reconciliation ไม่เสียจาก mail outage; fault tests บน disposable/UAT ไม่ทำลาย Production |
| R08 | Signed release และ customer path ผ่าน | exact immutable promoted digests, valid Passport/READY/result, secret/config freshness, all required run/operation IDs, serving/legal/OPEN และ normal login/logout acceptance ตาม controller ที่ใช้; A69 |

**UAT_READY** = R01–R08 ครบในขอบเขต UAT และ test layers ที่กำหนด รวม app inbox/LINE flow และ restart/redeploy; acceptance exception ของ Kamal smoke เดิมไม่ยกเว้น business journey ที่งานนี้เปลี่ยน

**PROD_READY** = UAT candidate evidence ที่ยัง valid + R01–R08 สำหรับ Production โดย R05/R07 reuse signed source/rehearsal evidence ได้เมื่อ source ตรง ส่วน R02/R04/R06/R08 ต้องตรวจ target จริงใหม่ ไม่มี data/secret/test outcome ของ UAT มารับรอง production mailbox หรือ deployed state แทน

Release ledger ใช้ manifest/artifact เดิม บันทึกเพิ่มเฉพาะ policy/schema versions, environment identity, sender/server/stream, secret refs/version metadata, cohort/cutover checkpoint, rollback artifact, per-check evidence และ remaining failures ไม่เก็บ OTP/password/token/provider body ใช้ `N/A` สำหรับ run ID ที่ไม่เกี่ยวกับ controller นั้นพร้อมเหตุผลและ validator path จริง ห้ามเติม historical run ID ให้ดูครบ

ถ้า check ใด required ยัง NOT RUN/FAIL หรือมี manual activation ค้าง สถานะคือ **NOT READY** พร้อม failing boundary แม้ image deploy แล้ว การแก้เอกสารรอบนี้ส่งมอบแผนที่ implement ได้ ไม่ใช่หลักฐานว่า UAT/Production ปัจจุบันพร้อมแล้ว


## Current implementation evidence (2026-09-15)

ดู [task memory](../agent-memory/signup-optional-email-impact-2026-09-15.md) สำหรับคำสั่ง/ผลและข้อจำกัดล่าสุด: PostgreSQL feature tests 20 ผ่าน; actual HTTP + Next browser OTP/recipient smoke ผ่าน; migration จาก pending LINK ผ่านบนฐานสังเคราะห์ ผู้ให้บริการจำลองทั้งหมด การทดสอบชุดใหญ่และ CI/integration base ยังดำเนินการ ไม่ถือเป็น UAT_READY/PROD_READY และไม่ติ๊ก A01–A70/R01–R08 ทั้งชุด

เพิ่ม regression กรณี session-only ตั้งรหัสผ่านแรกเพื่อ bypass email reauthentication: ต้องถูกปฏิเสธจนผ่าน fresh LINE proof พร้อมข้อความและทางกลับมาตั้งรหัสผ่าน ต้องตรวจ expired/replayed/wrong-account proof ด้วย


## Local implementation handoff — 2026-09-16

See [commands, results and limits](../evidence/signup-optional-email-local-2026-09-16.md). Completed source checkboxes do not imply native acceptance. Partially covered multi-device/zoom/audit-fault/full rollback/deployment rows remain unchecked.

Integration dependency is the still-open Stripe/Postmark PR #558 and its subsequent local baseline `c0c925968e945d452a2b483b4ddd8b5fec99e847`; develop does not yet contain the Billing module. Preserve concurrent source work and do not admin-merge all unrelated predecessor changes merely to land this feature. CI must pass for the exact final integrated source before merging either develop or main.

Native readiness remains blocked on the absent environment-scoped Postmark/OTP secrets, application-native sender/token/callback proof and the mandatory release protocol. Defaults are canonical and no activation flag is added. Do not disable the email requirement or mark a release successful to get around missing configuration.

Final integration regression: verify an existing password longer than128 characters through the real OTP browser/API path. Preserve the final portal source/authority/email-proof check after provider response; test customer/email changes during that response and refuse portal configurations that expose direct email editing. Record evidence before the final correction push.
