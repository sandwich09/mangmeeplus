# Impact / Bug / Gap Audit: อ่านเอกสารฟรีและเก็บร่างรายจ่าย

วันที่: 2026-10-28 (Asia/Bangkok)
สถานะ: IMPLEMENTED WITH LOCAL EVIDENCE — ทะเบียนด้านล่างเก็บ baseline ก่อนแก้
อ้างอิง: [spec](../specs/free-expense-drafts-spec-th.md) · [plan](../plans/free-expense-drafts-plan-th.md)

## 1. ขอบเขตหลักฐาน

ตรวจเอกสารและ working tree ในเครื่องที่ HEAD 4a5817b4238379c2e3e3a24df996dd7168411eda มีไฟล์แก้ค้างจำนวนมาก โดยเฉพาะ LINE/correction/expenses/contracts จึงเป็นหลักฐานของ working tree ณ วันที่ตรวจ ไม่ใช่ผลของ commit เพียงอย่างเดียวหรือสิ่งที่ deploy อยู่

รอบ static audit เดิมไม่อ่าน cloud ไม่เรียก provider ไม่ส่ง LINE จริง และไม่เปลี่ยนฐานข้อมูลหรือรัน production checks; implementation ต่อมาทดสอบกับฐานข้อมูล local ตาม checkpoint ท้ายเอกสาร ไม่ยืนยันว่าเกิด bug กับลูกค้าแล้ว ช่อง “พบจากโค้ด” หมายถึงความไม่ตรงกับข้อกำหนดใหม่ที่ตรวจได้; ช่อง “ความเสี่ยง” ต้องพิสูจน์ด้วย runtime tests ใน implementation

มติสำคัญ: ฟรีเฉพาะร้านเปิดสำเร็จและยังไม่เคยซื้อแพ็กเกจ; ร้านเคยซื้อแล้วหมดอายุไม่รวม ไม่เพิ่ม legacy role-gate; ในรอบ implementation ผู้ใช้อนุญาต Luna/Sol มาช่วยอย่างชัดเจน

## 2. แหล่งหลักฐาน

| Ref | Source / symbol ที่ตรวจ | ข้อค้นพบ |
| --- | --- | --- |
| S01 | [signup provisioning](../../apps/api/src/modules/external-signup/application/provision-signup.use-case.ts), applyTrialGuards | เขียน zero-day term/lockUntilPackageBought และไม่สร้าง trial AI budget |
| S02 | [AuthGuard](../../apps/api/src/modules/auth/presentation/auth.guard.ts), isBillingRecoveryRoute / term expiry | recovery เป็น exact route; business route ที่ term หมดถูกปิด |
| S03 | [permission resolver](../../apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts) | company ต้อง ACTIVE หรือเข้า term-recovery แบบเฉพาะ; มี branch/role filtering |
| S04 | [LINE webhook](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts), execute / executeReceiptUploadInner / replyIfCompanyLocked | public/support/identity/company/opt-out/legal/launch/feature แยกกัน; text/media เป็นคนละทางเข้า |
| S05 | [AI client](../../apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts), requestLineIntakeRoute / requestReceiptOcr | router ข้อความเรียก runBudgeted scope chat; media scope OCR; ต้องกั้นก่อน router |
| S06 | [OCR admission](../../apps/api/src/modules/line-ai/application/company-ocr-governance.ts), admitCompanyOcr / receiptQuotaSnapshot / releaseCompanyOcrAdmission | lock ต่อ company/month; paid grants กับ monthly base ต่างกัน; monthly shadow mode ยังอนุญาตเกินได้ |
| S07 | [quota wording](../../apps/api/src/modules/system-partner-management/domain/logic/receipt-quota.logic.ts) | tier trial ใช้คำช่วงทดลอง; counter/limit fallback ไม่มี free source |
| S08 | [billing source](../../apps/api/src/modules/billing/application/billing-purchase-source.ts), billingPurchaseSource | จำแนก current source และ inconsistent; ไม่ใช่หลักฐาน lifetime never-purchased โดยตัวมันเอง |
| S09 | [receipt grants](../../apps/api/src/modules/billing/application/billing-receipt-grants.ts), paidReceiptBalance | expiry/account/source-owned paid/gift balance ต้องคงเดิม |
| S10 | [schema](../../apps/api/prisma/schema.prisma), CompanyPlanTerm / CompanyOcrUsageEvent / BillingReceiptGrant | event ยังไม่มี free discriminator; term มี quotaNoticeSentMonthKey; grant nullable account รองรับ gift |
| S11 | [workspace shell](../../apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx), [term view](../../apps/web/src/features/plan-term/plan-term.logic.ts) | locked shell จำกัดเส้นทาง; เปิดแค่ menu ไม่พอให้ deep link ใช้ได้ |
| S12 | [expense controller](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts) | GET/PATCH/upload และ mark-ready/confirm/payment/export อยู่ใต้ expenses เดียวกัน |
| S13 | [draft use case](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts) | source update ใช้ validation/CAS; บางทางมี ensureVendorCounterparty และ writer การเงินในไฟล์เดียวกัน |
| S14 | [capture controller](../../apps/api/src/modules/expenses/presentation/http/expense-capture.controller.ts) | upload/read-status/facts/review/allocation/handoff ต้องแยกสิทธิ์ราย action |
| S15 | [capture runner](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts) | admit ครั้งเดียวต่อ file job, มี autoSplit และ ownerStillValid; worker ต้องตรวจ commercial scope เพิ่ม |
| S16 | [review page](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx) | canReview/canMutateDraft/sourceDraftView ผูกกันบางส่วน; มีปุ่ม financial ขั้นต่อไป |
| S17 | [term sweep](../../apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.ts), [company lock](../../apps/api/src/modules/system-partner-management/application/lock-plan-term-company.ts) | sweep/status/notification ใช้ Company→term lock ร่วมกับ lifecycle |
| S18 | [budget policy](../../apps/api/src/modules/line-ai/application/company-ai-budget-policy.ts), [readiness](../../apps/api/src/modules/line-ai/application/company-ai-budget-readiness.ts) | SHARED/SPLIT/default/admin override แยกจากจำนวนเอกสาร; readiness ไม่รับประกัน provider step ถัดไป |
| S19 | [billing contract](../../packages/contracts/src/billing.ts), [term contract](../../packages/contracts/src/plan-term.ts) | cadence มี LEGACY_MONTH/PAID_GRANTS; paidPlan/tier/lockReason ยังไม่บอก free mode |
| S20 | [buffer](../../apps/api/src/modules/line-ai/application/line-message-buffer.service.ts), [recovery](../../apps/api/src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.ts) | async/recovery เป็นทางเข้าที่ต้องตรวจซ้ำร่วมกับ entrypoint และ delivery |
| S21 | [web upload logic](../../apps/web/src/features/expenses/expense-upload.logic.ts) | error mapping/retry แยก quota/credit; ต้องใช้ free reason และ storage truth |
| S22 | [auto-post worker](../../apps/workers/src/modules/expense-auto-post/expense-auto-post-worker.ts) | worker เป็น entrypoint อีกชุด ไม่ใช่สิ่งที่ซ่อนปุ่มแล้วปิดได้ |
| S23 | [public policy copy](../../apps/api/src/modules/line-ai/domain/logic/line-public-policy.logic.ts), [menu](../../apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts) | คำถามแพ็กเกจ/บริการมี deterministic route ที่ต้องปรับ scope และรักษา support pause |
| S24 | [source continuity](../specs/receipt-reliability-and-draft-continuity-spec.md), [credit wording](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md) | saved/result/delivery ต้องแยก; คำเครดิตเดิมใช้หลายเหตุ ไม่เหมาะใช้แทน “ครบ 3 ใบ” ทั้งหมด |

## 3. ทะเบียน impact / bug / gap

P0 = security/financial/data/cost boundary; P1 = core journey/copy/contract; P2 = presentation/operational clarity
รายการด้านล่างเป็น finding ณ baseline ไม่ใช่สถานะปัจจุบัน สถานะหลัง implementation และข้อจำกัดอยู่ใน checkpoint ท้ายเอกสาร

| ID | ประเภท/ระดับ | สิ่งที่พบหรือเสี่ยง | หลักฐาน | วิธีปิด gap / acceptance |
| --- | --- | --- | --- | --- |
| F01 | พบจากโค้ด P0 | no_package ถูก lock ก่อนถึง OCR/รายจ่าย | S01–04 | effective free mode และ term-only action guard; AC01/03 |
| F02 | ความเสี่ยง P0 | เปลี่ยน DISABLED→ACTIVE กว้าง ๆ อาจล้าง admin/security hold | S03/17 | พิสูจน์ provenance lock; ไม่ toggle status เพียงเพื่อฟรี; AC03/17 |
| F03 | พบจากโค้ด P0 | current billing source ไม่พอพิสูจน์ไม่เคยซื้อ; paid mapping หายอาจดูเหมือน trial | S08–10 | historical verified purchase/recovery source; AC02/14 |
| F04 | ความเสี่ยง P0 | ยกเว้น /expenses/* จะเปิด confirm/payment/export/handoff | S12/14 | exact action + use-case guard + state; AC07 |
| F05 | พบจากโค้ด P1 | shell/term notice/session ยังพาร้านฟรีไป locked page | S02/11/19 | additive shared projection, deep-link/session parity; AC01/15 |
| F06 | พบจากโค้ด P0 | ทั้ง text และ image มี AI/feature gate; เปิด assistant ก้อนเดียวทำให้ chat หลุด | S04/05 | document capability แยก general chat; explicit admin denies ยังมีผล; AC08–11 |
| F07 | พบจากโค้ด P0 | deterministic response อาจจ่ายโมเดลตอน intake ไปแล้ว | S05 และ credit-wording spec | allowlist ก่อน cost-bearing stage, assert all provider calls=0; AC08/09 |
| F08 | ความเสี่ยง P0 | caption/voice/mixed command/รูปคำถามลอดเข้า advisor หรือ semantic edits | S04/05 | expense-only scope ทุก fallback ไม่มี chat/ASR/embedding; AC09/10 |
| F09 | พบจากโค้ด P0 | monthly base นับ legacy events ที่ไม่มี paid grant; ไม่มี free source | S06/10 | source-tagged admission/month/identity; AC04/05/14 |
| F10 | พบจากโค้ด P0 | shadow quota ถ้าเอามาใช้ตรง ๆ จะอ่านเกิน 3 | S06 | free limit บังคับจริงโดยไม่เปลี่ยน legacy rollout semantics; AC04 |
| F11 | ความเสี่ยง P0 | web/LINE หลายคนแข่งใบสุดท้าย หรือสำเร็จเกินจาก worker | S06/15 | reserve ภายใต้ lock, count in-flight, CAS finish; AC04/05 |
| F12 | ความเสี่ยง P0 | อ่านล้มเหลวคืนผิดเดือน/ผิด paid source หรือคืนทั้งที่ผลบันทึกแล้ว | S06/15/24 | exact identity compensation; delivery failure ไม่ refund; AC05/13/14 |
| F13 | พบจากโค้ด P1 | quota notice ใช้ month marker เดิมและคำ trial/paid | S07/10 | free source-scoped notice หลัง success commit; AC12/13 |
| F14 | พบจากโค้ด P0 | capture file เดียวอ่านได้หลายเอกสารแล้ว autoSplit; 1 event ไม่เท่ากับ 1 บิล | S06/15 | free single-business-document scope, ปิด free autoSplit; AC18 |
| F15 | ความเสี่ยง P1 | ปฏิเสธแล้วอ้าง “เก็บแล้ว” ทั้งที่ไม่มีไฟล์ หรือเปิดรับ pending ไม่จำกัด | S04/21/24 | storage truth และ bounded upload/retention; AC13 |
| F16 | พบจากโค้ด P0 | free count ไม่ได้ทำให้ OCR มี budget; เปิด default chat เพื่อแก้จะเกิน scope | S01/18 | existing budget resolver/governed writer; OCR readiness proof; AC10 |
| F17 | ความเสี่ยง P0 | failures ที่คืนสิทธิ์ทำให้ attacker เรียก provider ซ้ำได้ | S05/06/18 | rate limit/cost holds/call limit เดิมยังบังคับ; AC10/18 |
| F18 | พบจากโค้ด P1 | draft source edit บางส่วนอิง canReview; ถ้าให้ review ทั้งก้อนจะเปิดขั้นอื่น | S12/13/16 | source-only action capability + validation/CAS; AC06/07/15 |
| F19 | พบจากโค้ด P0 | save source เดิมอาจ ensure vendor และกระทบ master/module อื่น | S13 | trace source-writer side effects และจำกัดตาม §4; AC06/07 |
| F20 | ความเสี่ยง P0 | internal/read worker/recovery/auto-post ไม่ผ่าน HTTP guard | S15/20/22 | recheck actor/company/policy/source ก่อน provider/apply/delivery; AC07/19 |
| F21 | ความเสี่ยง P1 | refusal ใหม่กลืน support pause, picker, opt-out, legal, feature close | S04/23 | collision tests และ reason-specific copy; AC11 |
| F22 | ความเสี่ยง P1 | ซื้อแพ็กเกจถูกนำเสนอเป็นทางแก้ suspension/permission/outage | S02/04/24 | reason owner เดิม, conditional tail/CTA, final-action refusal ก่อน upsell; AC11/13 |
| F23 | ความเสี่ยง P0 | จ่ายระหว่าง OCR หักสองกอง/สร้างซ้ำ/คืนฟรีเมื่อ paid หมดอายุ | S06/08/09 | frozen admission source + current apply check + immutable purchase history; AC14 |
| F24 | พบจากโค้ด P1 | BillingReceiptUsage/plan notice/session ไม่รองรับ free cadence; web hardcode ตัวเลขอาจไม่ตรง | S19/21 | additive contract + exhaustive consumer audit + unknown-safe UI; AC04/15/16 |
| F25 | ความเสี่ยง P0 | admin override/preset/gift/manual term ถูกทับจาก free provisioning/retry | S01/08/09/18 | no preset rewrite, explicit deny wins, active existing access wins; AC03/16 |
| F26 | ความเสี่ยง P1 | sweep/expired outbox ส่ง “ซื้อก่อนเริ่มใช้” ทั้งที่มี free access | S17/23 | notice projection ตาม current mode; source version/notification replay; AC17 |
| F27 | ความเสี่ยง P0 | rollout old/new clients, stale session หรือ policy-read failure fail open | S02/03/19/20 | versioned projection, conservative fallback, rollback preserve data; AC17/19 |
| F28 | ความเสี่ยง P1 | metadata leak หรือเก็บ raw receipt/text ใน audit เพื่อ debug guards | S04/06/20 | scoped reason/IDs/counts เท่าที่จำเป็น ไม่เก็บ raw PII เพิ่ม; AC19 |
| F29 | พบจาก docs P1 | locked-signup/trial/credit/help copy เดิมขัดสิทธิ์ฟรี | S01/07/23/24 | reconcile scoped amendments ทั้ง UI/docs/tests; AC01/12/16 |
| F30 | ความเสี่ยง P1 | การปรับ draft-control/correction พร้อมงานนี้ทำให้ route eligibility เปลี่ยน | dirty tree, S04/13/16/20 | baseline hashes และ re-audit changed symbols ก่อน implementation; AC08/09/16 |
| F31 | ความเสี่ยง P0 | อนุญาต upload/ดูรูปแต่ attachment API หรือ URL ข้าม scope | S02/03/12 | ตรวจ intent/complete/read/download/reload ทุกขั้น; AC06/19 |
| F32 | ความเสี่ยง P1 | quota ยังมีแต่ job ถูกปิดจาก cost/policy กลับบอกครบ 3 | S06/18/21 | known count กับ readiness แยกเหตุ; C07/C10 และ existing credit reasons; AC10/13 |

## 4. ผลกระทบต่อ module

| Module | สิ่งที่ต้องทำหรือคง |
| --- | --- |
| external-signup / system-onboarding | เปิดร้านสำเร็จเป็น prerequisite; copy/provision retry ต้องสะท้อน free scope; ไม่สร้าง signup flow ใหม่ |
| auth / access-control / lifecycle | term-only access, selected company, explicit deny, legal/opt-out/security; ห้ามปลดทั้งบริษัท |
| billing / sales / grants | lifetime purchase proof; upgrade paid เดิม; ไม่ grant ฟรีเป็น invoice/gift; commission ไม่เกิดก่อนซื้อ |
| contracts / session / navigation | effective actions + source/count/reset/version; company switch/deep link/error states |
| line-ai / buffer / recovery / outbound | no-model entry allowlist, media-only scope, support precedence, delivery truth, notice dedup |
| ai-gateway / budget / OCR clients | no chat fallback; OCR cost envelope; server-authenticated scope; provider-count assertions |
| expenses / captures / evidence | source-only draft edit, single document intake, file custody, retry and CAS, bill/slip binding |
| workers / auto-post / workflow | revalidation; ไม่มี financial action จาก free provenance โดยอ้อม |
| accounting-documents / counterparties | source save side effects ต้องไม่สร้าง/แก้ master โดยสิทธิ์กว้าง |
| reimbursement / payment / tax / ledger / procurement | ไม่ได้สิทธิ์ใหม่; verify จำนวน records/events ไม่เพิ่ม |
| banking / CRM / inventory / reports | ไม่ได้สิทธิ์ใหม่; banking OCR ไม่ใช่ช่องใช้ free allowance |
| admin / support / observability | แสดง source/reason ถูกต้อง; override ไม่ถูก reset; no raw PII logging |
| attachments / deletion lifecycle | scope และ retention เดิม; quota หมดไม่ลบข้อมูล; archive/delete ไม่กลายเป็น free eligibility |

## 5. กรณีที่ต้องพิสูจน์เพิ่มเติม

- ว่าประวัติ verified paid purchase ครบทุก flow รวม deal/repeat/old account โดยไม่เรียก provider ทุกข้อความ
- ว่า term-disabled แบบมี admin hold ซ้อนแยกได้จากข้อมูลที่มีจริง; ถ้าแยกไม่ได้ต้องหยุดเฉพาะบริษัทนั้น ไม่เดาปลด
- ว่า source-only edit ไม่เรียก vendor/master/financial writer ที่เกิน scope
- ว่า document lane ทำ OCR ได้ด้วย budget policy เดิมและไม่มี chat preparation cost แอบเพิ่ม
- ว่า multi-document classification/capture route ไม่ split ก่อน free scope check
- ว่า paid/trial/gift/month reset/refund/notice contracts ยังเดิมทุก consumer

สิ่งเหล่านี้เป็น acceptance ของ implementation ไม่ใช่ข้อมูลที่อ่าน cloud เพิ่มเพื่อปิด audit เอกสารนี้

## 6. Verification ของรอบเอกสาร

ทำแล้ว: อ่าน source/สเปกที่อ้าง, ตรวจ guard entrypoints และ shared quota/billing/schema/UI, บันทึก source symbols, ยืนยัน D06 จาก Owner, ตรวจ local links/AC-gap mapping และ whitespace ตามผลใน memory

ยังไม่ทำ: แก้โค้ด, migrate, unit/integration/PG/browser/native LINE/provider tests, deploy หรือเปิด customer gate ดังนั้นจำนวน bug ที่แก้แล้ว = 0; มี 32 รายการพร้อมแนวปิดและเกณฑ์ตรวจ ไม่อ้างว่าพฤติกรรมจริงผ่านแล้ว

## 7. สถานะหลัง implementation / หลักฐาน local

อ้างอิง [memory](../agent-memory/free-expense-drafts.md) และ [verification](../evidence/free-expense-drafts-2026-10-28/verification.json) ที่บันทึกคำสั่งและ source hashes ไม่ใช่ production evidence

| Gaps | สิ่งที่แก้และหลักฐาน | ขอบเขตที่ยังไม่รับรอง |
| --- | --- | --- |
| F01–04, F18–19, F25, F31 | shared eligibility/history + exact auth/action; source writer/attachment ownership; real PG history, concurrent upload, source-only save, zero finance/master side effects | live cohort/readiness |
| F05, F24, F27 | shared session/notice/usage; shell/banner, handoff/LIFF/password/root/company-switch landing; executable projection/landing tests | desktop/mobile browser journey ด้วย actual HTTP fixture |
| F06–08, F20–22, F28–30 | no-model gate ก่อน text routing, bounded media-only OCR, worker actor/current policy/delivery recheck, support/legal/financial collision tests | native LINE/real delivery |
| F09–17, F23, F32 | source-tagged reservations, max3 including pending, same-transaction source/completion, exact refunds, rollback outbox, once-per-month current notice; PG races/rollover/upgrade + governed mocked OCR budget | real provider cost/model and operational load |
| F26 | sweep excludes eligible free notices, additive migration, runtime revert preserves files/events by design | deployed mixed-version rollout/rollback ยังไม่ซ้อม |

พบและแก้เพิ่มระหว่าง integration: LINE image จองสิทธิ์ก่อน storage จึงต้องส่ง exact server-only reservation ให้ upload guard; ไม่เช่นนั้นใบที่ 3 ถูกปฏิเสธเพราะ reservation ของตัวเอง การเชื่อมนี้ตรวจด้วย actual InitReceiptUpload→CreateUploadIntent→local PG ส่วน provider/storage ใช้ stub

ไม่มีการอ่านหรือเปลี่ยน cloud, เรียก provider จริง, ส่ง LINE จริง หรือ deploy รอบนี้ จึงไม่ mark AC15 ส่วน browser/native หรือ AC20 ว่าผ่าน live
