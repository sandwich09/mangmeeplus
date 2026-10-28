# Plan: สิทธิ์อ่านเอกสารฟรี 3 ใบและร่างรายจ่าย

วันที่: 2026-10-28 (Asia/Bangkok)
สถานะ: IMPLEMENTED / SCOPED BROWSER VERIFIED — desktop/mobile viewport + real local HTTP/DB ผ่าน; native/real provider/live และเส้นทาง UI ที่เหลือยังไม่รัน
Owner: thawatchai
อ้างอิง: [spec](../specs/free-expense-drafts-spec-th.md) · [impact 32 รายการ](../research/free-expense-drafts-impact-audit-2026-10-28-th.md) · [memory](../agent-memory/free-expense-drafts.md)

## 1. เป้าหมายและข้อจำกัด

ส่งมอบ flow เปิดร้านแล้วใช้ได้ทันทีสำหรับร้านที่ไม่เคยซื้อแพ็กเกจ อ่านเอกสารรายจ่าย 3 ใบต่อเดือน เก็บและแก้ร่างได้ ใช้เฉพาะคำสั่ง LINE ที่ไม่มีโมเดลตลอดเส้นทาง และแสดงข้อความจำกัดสิทธิ์ตามเหตุจริง

ร้านเคยซื้อแล้วหมดอายุไม่รวม; ห้าม free fallback หลัง paid quota หมด; ร้านถูกระงับ/ปิดโดย Admin ไม่ได้เปิดกลับ
งานนี้ใช้ pattern/route/admission/expense state เดิมก่อน ไม่มีระบบ subscription ใหม่ ไม่มี dependency ใหม่ ไม่แก้ package.json และไม่ใช้ legacy role-gate

ผู้ใช้อนุญาต implementation แล้ว ใช้ Sol สำหรับ access/auth และ quota/capture, Luna สำหรับเว็บ, root สำหรับ LINE/source integration ช่องที่ยังไม่ tick คือหลักฐานหรือขั้นตอนเปิดบริการที่ยังไม่รัน ไม่ถือว่า static audit แทน runtime tests

## 2. Product และ architecture checkpoint

- [x] บันทึกผู้ใช้ journey สิทธิ์และ non-goals
- [x] ยืนยัน Owner ว่าไม่รวมร้านที่เคยซื้อแล้วหมดอายุ
- [x] ตรวจ source ใน working tree และแยก static gap ออกจากความเสี่ยง
- [x] กำหนดข้อความ/guard precedence/สถานะไฟล์และผลลัพธ์
- [x] กำหนด API→frontend projection, quota source, source-state และ financial boundaries
- [x] ผูก gap กับ AC และ verification ขั้น implementation
- [x] จัด baseline ของโค้ดที่ใช้ implement จริงและตรวจงานค้างที่เปลี่ยนจาก audit
- [ ] ปิด runtime/schema/side-effect gaps ก่อนเปิดบริการ

ไม่สร้าง migration หรือเปิด gate เพื่อทดลองค้นหา error งาน discovery ในอนาคตต้องใช้ fixture/local database ที่ทิ้งได้

## 3. ลำดับ implementation ที่เล็กที่สุดและปลอดภัย

### P1 — Purchase history และ effective access

Gap: F01–03, F25, F27 · AC01–03, AC17

- [x] ต่อ billing source เดิมด้วยหลักฐาน lifetime purchase ที่ verified ครบ initial/repeat/renewal/deal/historical account; pending payment/source inconsistent ต้องเข้า recovery
- [x] สร้าง policy projection เดียวใน ERP แยก FREE_EXPENSE_DRAFTS จาก tier/status; ไม่มีการยืด term หรือทำทุกบริษัท ACTIVE
- [x] free access เป็น action capability เพิ่มเฉพาะรายจ่ายที่จำเป็น โดย intersect active membership/branch/record ownership และ explicit admin denies
- [x] ร้าน active trial/manual/grandfathered คงสิทธิ์เดิม; source unknown ไม่อนุมานเป็นฟรี
- [x] ตรวจ lifecycle provenance เมื่อมี termDisabledAt และ admin hold ซ้อน; ถือ lock ตาม Company→term order เดิม
- [x] เพิ่ม additive freeExpenseDrafts contract และ access fingerprint ให้ session/plan notice/usage projection โดย missing field ไม่ fail open

ตรวจ: truth table ของ source/lifecycle/actor; real DB fixture สำหรับ historical purchase และ admin hold; current paid source regressions ต้องไม่เปลี่ยน

Exit: มีคำตอบ authoritative ว่าบริษัทใดเข้า cohort และทำ action ใดได้ โดยไม่ให้โมเดลหรือ UI ตัดสิน

### P2 — Quota และ OCR cost boundary

Gap: F09–17, F23–24, F32 · AC04–05, AC10, AC14, AC18

- [x] ใช้ CompanyOcrUsageEvent และ company/month lock เดิม เพิ่ม free allowance discriminator/source ให้ผูกกับ job/result
- [x] จำกัด 3 จริงทั้ง legacy web OCR, LINE image, web capture, LINE file capture; ไม่ใช้ shadow mode กับ free source
- [x] แยก used-success/in-flight/remaining และ pin month/operation/source; เงินต้นทุนยังผ่าน reservation เดิม
- [x] refund เฉพาะ failure ไม่มี usable result; notification failure/read replay/delete ไม่คืนสิทธิ์ผิด
- [x] รองรับ last-unit race, rollover, interrupted worker, retry lease, paid upgrade ระหว่างงาน
- [x] ตรวจ OCR budget/default/model policy ผ่าน resolver เดิม; ไม่ให้ chat credit เพื่อปลด OCR; ไม่ทับ explicit override
- [x] ป้องกัน free auto-split หลายเอกสารต่อไฟล์; count provider chunks เป็น job เดิม; ภาพไม่ใช่เอกสารไม่กลายเป็น free chat
- [x] quota notice แยก source/month และจอง delivery หลัง commit; in-flight ไม่ใช้คำว่าอ่านครบแล้ว

ตรวจ: PG race เว็บ+LINE 4 งานเมื่อเหลือ 1; quota/readiness failure/refund replay; budget envelope และจำนวน provider calls; paid/trial/gift source ไม่ปะปน

Exit: สำเร็จไม่เกิน 3 ต่อบริษัท/เดือน ผลที่ล้มเหลวคืนถูกครั้งและ source พร้อมหลักฐานต้นทุนจริงใน fixture

### P3 — Auth และ source-only expense boundaries

Gap: F01–04, F18–20, F25, F31 · AC01, AC03, AC06–07, AC19

- [x] แยก action ฟรีจาก allowTermRecovery; allowlist exact method/route/action พร้อม use-case check
- [x] เปิดเฉพาะ list/detail/source draft fields/totals preview ที่ไม่มี AI/attachment read และ upload ที่ผูก admission
- [x] ตรวจ prerequisite API ที่ form ใช้: categories read, branches, profile/VAT facts และ evidence URLs ให้เพียง read scope ที่จำเป็น
- [x] ตรวจ writer side effects เช่น ensureVendorCounterparty, document number, tax calculation/financial events; ฟรีบันทึก source facts ได้โดยไม่ grant management/review/confirm ทั้งก้อน
- [x] ปิด create-empty/manual-entry, mark-ready, confirm, reject, void, payment, accountant-package, capture handoff/review/allocation, substitute issuance และ other-module actions
- [x] รองรับ CAS/reload/incomplete source draft โดยใช้ validation เดิม; รูป/ร่างที่ถูกเปลี่ยนหรือสิทธิ์ถอนต้องไม่ถูกเขียนทับ
- [x] internal tools, worker/drain/recovery/auto-post ตรวจ current policy/actor/source ก่อนเขียนและส่งผล
- [x] รักษา attachment tenant/branch/owner checks ตั้งแต่ upload intent→complete→download; ไม่ทำข้อมูลสูญหายเพราะ quota หมด

ตรวจ: HTTP integration + use-case/direct internal paths และ DB side-effect assertions; ทดสอบ permission ที่กว้างกว่าสิทธิ์ฟรียังถูกจำกัด action

Exit: ไม่มีการปลดโมดูลทั้งก้อนหรือ side effect ทางการเงิน แม้ข้าม UI มาเรียก API ตรง

### P4 — LINE no-model commands และ guard copy

Gap: F06–08, F13, F15, F20–22, F28–30 · AC08–13, AC19

- [x] คง public/support/picker/menu handlers ที่ไม่เรียกโมเดล; ปิด stale semantic-edit preview ของร้านฟรีและให้แก้ข้อเท็จจริงในเว็บ
- [x] free chat gate ก่อน text intake/router/planner/composer/embedding/ASR; ไม่รอ AI จำแนกเพื่อปฏิเสธ
- [x] free media ใช้ bounded expense document lane; mixed caption ไม่สั่ง advisor/financial mutation
- [x] ทำ collision matrix G01–G10 โดยรักษา public/support/resume/company picker/legal/opt-out/launch/admin/permission precedence
- [x] กำหนด machine reason ใหม่เฉพาะจำเป็น เช่น FREE_CHAT_NOT_INCLUDED/FREE_DOCUMENT_LIMIT_REACHED และ map ที่ boundary กลาง; legacy reason ไม่ถูก replace ทั้งระบบ
- [x] map reason + persisted state + actor capabilities เป็น copy ไทย; ไม่อ้างคืนสิทธิ์ถ้า compensation ยังไม่ยืนยัน และไม่ใช้ข้อความแพ็กเกจทับ financial-action refusal
- [x] ไม่มี welcome offer/counter 1–2/upsell; ใบ 3 แนบท้ายหลัง success; แจ้ง blocked ต่อข้อความที่ผู้ใช้ส่ง ไม่ push
- [x] help/service/public-policy copy ไม่ประกาศ free ให้ paid-expired และไม่โฆษณาสิ่งที่ actor ทำไม่ได้
- [x] telemetry เก็บ source/decision/reason/operation ที่จำเป็น ไม่เพิ่ม raw receipt/chat/PII

ตรวจ: stub/spies ทุก provider seam ต้องเป็น 0 สำหรับคำสั่งฟรี/refusal; ซ้อมข้อความผสม เมนู ชื่อปุ่มยืนยัน บริบทหมดอายุ และ support pause; transport failure/replay ต้องไม่มีคำตอบซ้ำผิดเหตุ

Exit: ไม่มีค่าโมเดลจากคำสั่งทั่วไปของร้านฟรีและทุก refusal อธิบายเหตุจริง

### P5 — เว็บและ purchase continuation

Gap: F05, F18, F21–24, F26–27, F29 · AC06, AC12–17

- [x] workspace shell/term banner/navigation/session ให้เข้ารายจ่าย mode ฟรีผ่าน route เดิม ไม่ติด redirect loop
- [x] ใช้ action projection คุมปุ่ม “เก็บร่าง”; ไม่เปิด canReview ทั้งก้อนเพื่อให้แก้ source ได้
- [x] loading/error/unavailable/permission/stale revision มีข้อความไทยและไม่ทิ้งข้อมูลที่กรอก
- [x] UI ใช้ usage จาก server; ใบ 1–2 ไม่มี counter และใบ 3 success แสดง note ตาม current Bangkok month; ไม่ fallback เป็น trial 15
- [x] upload/read-status/retry/attachment copy แยก stored/processed/saved/notified; มือถือใช้ได้
- [ ] deep link จาก LINE กลับร่างเดิมหลัง login/company selection/legal acceptance
- [x] ซื้อผ่าน flow เดิม จ่ายสำเร็จแล้วใช้ร่างเดิม; ไม่บวก free units/ไม่สร้าง trial forfeiture/ไม่เปลี่ยน invoice หรือ commission
- [x] paid-expired ยัง flow เดิม; paid customer ไม่เห็น free refusal; สมาชิกที่ไม่มี billing permission ไม่เห็นลิงก์ที่เปิดไม่ได้

ตรวจ: desktop และ mobile browser พร้อม actual HTTP/DB fixture; LINE native แยก acceptance ไม่อ้างจาก web channel=line

Exit: ผู้ใช้ทำ journey ได้ครบและข้อความในหน้าเว็บตรงกับ LINE/API

### P6 — Rollout readiness, regression และ docs reconciliation

Gap: F17, F20, F23–30 · AC14–20

- [x] shadow/dry-run cohort classification จาก fixture/ข้อมูลที่ได้รับอนุญาต แสดง eligible/blocked/unknown พร้อมเหตุ โดยไม่ mutate สิทธิ์
- [x] existing unpaid shops, new provisioning, active trial/manual, gifts, paid-expired, admin-disabled, grandfathered แยกครบ
- [x] sweep/expired notification/recovery/old sessions ใช้ current mode ไม่ lock งานฟรีหรือเปิด paid action
- [x] migration additive; rollout API/worker/contracts/web ให้ปิด action ที่ไม่รู้จักระหว่าง mixed version
- [ ] rollback หยุด admissions ใหม่แต่รักษา usage/drafts/attachments และ drain/refund ตาม operation เดิม; ไม่ลบ schema ย้อนข้อมูล
- [x] แก้ scoped amendment ใน spec เดิม: locked-signup, package, term, OCR, credit wording, help/support, receipt/correction/manual-entry และ checklist ที่เกี่ยวข้อง
- [x] อัปเดต memory ด้วย source SHA/hashes, commands, counts, failed/skipped cases และ browser evidence
- [ ] ถ้ามีคำสั่ง deploy ในอนาคต อ่าน runbooks สองฉบับตาม AGENTS.md ก่อนทุกครั้ง บันทึก UAT/READY/Production run IDs; ไม่ dispatch ซ้ำเพื่อหา error
- [ ] เรียก live complete ได้ต่อเมื่อ signed result และ customer OPEN acceptance ผ่านเท่านั้น

Exit: F01–F32 มีหลักฐานปิดหรือ blocker ระบุชัด; ไม่ mark implementation complete จาก static tests อย่างเดียว

## 4. Test matrix ที่ต้องรัน

| Test ID | กรณี | Evidence ขั้นต่ำ | AC / Gap |
| --- | --- | --- | --- |
| T01 | new/no_package/trial ended never-paid; signup pending | resolver + HTTP/DB | AC01/03; F01/02 |
| T02 | paid current/expired/refund/deal/repeat/mode mismatch/payment pending | source fixtures + billing regression | AC02/14; F03/23 |
| T03 | admin hold บน term-disabled / opt-out/legal/archived/no membership | auth/permission + LINE collision | AC03/11; F02/21 |
| T04 | หลายผู้ใช้/สาขา web+LINE แย่งใบที่ 3 | PG concurrency ไม่ skip | AC04; F09–11 |
| T05 | midnight Bangkok/in-flight/replay/refund/delete | fake clock + PG identity checks | AC05; F12/13 |
| T06 | provider failed/apply failed/notification failed/unknown cost | provider stubs + durable state | AC05/10/13; F12/15/17 |
| T07 | source draft edit/reload/stale/foreign record | HTTP/DB + browser | AC06; F18/19/31 |
| T08 | direct final-action/manual-create/capture-handoff/auto-post | negative API/worker + no financial events | AC07/19; F04/20 |
| T09 | all allowed commands + alias/picker/expired context | provider calls=0 at every seam | AC08; F07 |
| T10 | free chat/semantic edit/mixed intent/voice/caption | provider calls=0 except admitted OCR | AC09/10; F06/08 |
| T11 | support pause/resume/closed launch/no upload permission | branch-specific reply + no wrong write | AC11; F21/22 |
| T12 | success 1/2/3 และใบ 4 | copy/read count/notice idempotency | AC12; F13/29 |
| T13 | stored/no file/old draft/unknown count/refund pending | copy fixtures + transport retry | AC13; F15/32 |
| T14 | ซื้อระหว่าง read/refund/replay แล้วหมดอายุ | PG + paid transition checks | AC14/16; F23/25 |
| T15 | desktop/mobile/deep link/loading/error/permission | existing browser harness | AC15; F05/18/24 |
| T16 | active paid/trial/manual/gift/banking/other modules | existing focused regressions | AC16; F16/24/25 |
| T17 | sweep/rollout/rollback/stale session/recovery | integration + mixed-version fixture | AC17; F26/27/30 |
| T18 | one bill multi-page vs multiple bills/file; rate abuse | capture fixture + cost/row assertions | AC18; F14/17 |
| T19 | revoke/suspend/purchase change during worker/delivery | concurrency + no data leak | AC19; F20/28/31 |
| T20 | live release เมื่อได้รับคำสั่ง deploy | protocol evidence + native journey | AC20 |

## 5. ชุดตรวจที่มีอยู่แล้วและคำสั่งเริ่มต้น

รายการด้านล่างเป็นชุดตรวจที่ค้นไว้ตั้งแต่แผนเดิม ผลที่รันจริงและจำนวน test อยู่ใน memory/evidence; ไม่อ้างว่ารันครบทุกคำสั่งตัวอย่าง ข้ามเพราะไม่มี DB ไม่ถือว่าผ่าน

Focused source suites (รันจาก repository root):
~~~sh
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/auth.guard.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/application/use-cases/line-ai-combined-regression.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/system-partner-management/domain/logic/receipt-quota.logic.spec.ts src/modules/billing/application/billing-purchase-source.spec.ts src/modules/line-ai/application/company-ai-budget-reservation.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-receipts.pg.spec.ts src/modules/line-ai/onboarding-receipt-allowance.pg.spec.ts src/modules/expenses/expense-capture-read.pg.spec.ts src/modules/expenses/expense-source-draft.pg.spec.ts
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/web typecheck
~~~

เพิ่ม tests ใน suite เดิมตาม T01–T19 ก่อนพิจารณาสร้าง suite ใหม่ ไม่จำเป็นต้องรันทุก test ของ repo เมื่อ focused tests/typecheck ที่เกี่ยวข้องผ่านและไม่มี unresolved concern

Browser paths ที่ต่อยอดได้: [expenses](../../e2e/expenses.spec.ts), [capture intake](../../e2e/expense-capture-intake.spec.ts), [LINE recovery](../../e2e/line-recovery.spec.ts), [term/billing readiness](../../e2e/plan-term-billing-readiness.spec.ts), [customer billing](../../e2e/customer-billing-ux.spec.ts)
ใช้ harness/config ของแต่ละไฟล์; ไม่สมมติคำสั่ง launch หรือใช้บัญชีลูกค้าจริง

## 6. Copy review checklist

- [x] ทุกประโยคตอบได้ว่าเกิดอะไรขึ้น งานอยู่ขั้นไหน และผู้ใช้ทำอะไรต่อได้จริง
- [x] “เก็บร่างแล้ว” มี persisted result; “รับไฟล์แล้ว” มี durable file; “ไม่หัก” มี compensation proof
- [x] “ครบ 3 ใบ” ไม่รวม unresolved in-flight หรือ quota lookup error
- [x] ไม่มีการชวนซื้อก่อนครบ; free chat refusal เป็นข้อมูลสิทธิ์ ไม่ใช่โฆษณา
- [x] ไม่บอก paid-expired ว่าใช้สิทธิ์ฟรีได้; ไม่บอก free user ว่ายังไม่ได้เปิดร้าน
- [x] ไม่ใช้เครดิต AI/จำนวนเอกสาร/จำนวนเงินปะปนกัน
- [x] tail/CTA เฉพาะที่ actor ใช้ได้; ไม่บอกว่าซื้อแล้วจะข้าม security/permission/final-action guard
- [x] ตัวเลขและวันที่มาจาก server source เดียวกัน; Flex/text/web ความหมายตรงกัน
- [x] ผู้ใช้ไม่ต้องรู้คำว่า OCR, draft, quota, entitlement หรือ guard

## 7. การส่งมอบ

รอบนี้ส่ง implementation ใน working tree พร้อม spec/plan/audit/memory และผล unit/PG/typecheck ไม่ commit/push/deploy โดยอัตโนมัติ

เมื่อทำ implementation: handoff ต้องบอก behavior ก่อน/หลัง, scope ที่เปิดจริง, schema/contract changes, commands/results, source binding, browser/native evidence และ blockers ที่เหลือ โดยไม่ใช้สถานะ “ครบ” กลบ tests ที่ยังไม่ได้รัน

## 8. Local integration checkpoint 2026-10-28

- API ชุดรวมจาก scoped manifest ผ่าน; PostgreSQL แยกสำหรับ access/source และ quota/races ผ่านโดยไม่ skip; web focused tests และ API/web TypeScript ผ่าน ดูจำนวนสุดท้ายใน evidence
- ปิดจุดเชื่อมที่พบเพิ่ม: banner ยัง redirect, LINE/LIFF/password landing ไป renewal/dashboard, company switcher อ่าน free flag ของร้านปลายทาง, signup/FAQ เก่าบอกต้องจ่ายก่อน, third LINE read นับ reservation ของตัวเอง และ atomic source facts/quota rollback
- เอกสารเก็บ test groups แยกกัน ไม่บวกจำนวน overlapping runs เป็นยอดรวม
- T01–T14/T16–T19 มี local unit/DB evidence ตาม scope; T07/T15 ส่วน browser HTTP journey ยังไม่รัน ไม่มี fixture ร้านฟรีใน browser harness ขณะทำงาน; T20 และ live rollout/rollback อยู่นอกคำสั่งนี้
- Rollback ที่วางไว้: revert runtime พร้อมเก็บ additive columns/events/files ไว้; ห้ามลบ succeeded usage, draft หรือ attachment เพื่อย้อน rollout ต้องใช้ deployment protocol เมื่อต้องแตะ live

## Browser follow-up 2026-10-28

ผู้ใช้สั่งทดสอบกดจริงแล้ว รายละเอียดและขอบเขตใน [browser evidence](../evidence/free-expense-drafts-2026-10-28/browser/README.md)

- [x] Actual Chrome desktop/mobile390×844: login, sourceedit/incomplete-save/reload, originalview, uploads1–3, fourthdenial, post-limit save, manualdeep-route denial, paid-expired/adminhold boundaries
- [x] แก้และกดซ้ำ: เมนู/exportหลุด, จำนวนร่างไม่ตรงsource, ข้อความครบสิทธิ์ถูกซ่อน/ล้างจากStrictMode
- [x] ตรวจDBไม่มี financial/master/paidgrant/confirmedmutation และใบ4ไม่มีprovidercall/orphan
- [x] หลังแก้ web395tests + TypeScriptผ่าน
- [ ] LINE native/LIFF/legal/companyswitch journey, realprovider, PDF/HEIC asyncUI และ liveprotocol ยังคงเป็นงานก่อนรับรองเต็มขอบเขต
