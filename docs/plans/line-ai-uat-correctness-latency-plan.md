# LINE AI UAT Correctness, Reimbursement Intent, and Latency Implementation Plan

## สถานะ

- สถานะ: **MERGE-SAFE default-off; ยังไม่ ACTIVATION-READY** — Phase 0 eval freeze เสร็จ (§14.2 ผูกกับ
  assessor จริงแล้ว), Phase 1B/6B/§10.1 multipart มี code + tests หลัง flag ที่ปิดอยู่, behavior phases อื่น
  ยัง gated และ Phase 3B DRAFT-only รอ owner GO
- Linked spec: `docs/specs/line-ai-uat-correctness-latency-spec.md`
- วันที่: 2026-08-21
- มี code change แล้ว แต่ **ไม่มี deploy และไม่มีการเปลี่ยน config/flag ใน environment ใด** ค่า default
  ให้พฤติกรรมเดิมทั้งหมด
- ยังไม่ ACTIVATION-READY จนกว่าจะมี: durable replay ของ terminal outcome, DB-backed neutral intake state,
  text fallback เมื่อ Flex delivery ล้ม และ configured-provider replay + UAT canary
- ไม่มี reimbursement writer ใน PR นี้ Phase 3B ยังบล็อกที่ owner GO
- 1,000 ms debounce ยังเป็น experiment candidate หลักของ implementation เดิม PR นี้ไม่ได้เปิดหรือ deploy

## วัตถุประสงค์

แก้ UAT defects ที่มีรากร่วมกันโดยใช้ diff เล็กที่สุดใน architecture เดิม: router เข้าใจ semantic intent
ครั้งเดียว, source modules คุม deterministic authority, ledger จำ typed clarification, trusted renderer
สร้าง Flex card และ latency lanes เดิมลด serial model work

## Ponytail decision

- เพิ่มหนึ่ง reimbursement intake intent ไม่สร้าง router ใหม่
- ใช้ `CreateReimbursementDraftUseCase`, permission/branch/policy logic และ reimbursement state machine เดิม
- ใช้ line ledger เป็น orchestration reference แต่ financial continuation authority ต้อง DB-backed
- แก้ shared completeness gate จุดเดียว ไม่ patch ราย call site
- ใช้ latency/autonomy flags, corpus และ runner เดิม
- dependency ใหม่: ไม่มี
- `package.json` change: ไม่มี
- typed financial continuation ต้อง DB-backed; DRAFT-only เพิ่ม unique idempotency ตาม Phase 3B

## Scope

### ในขอบเขต

- expense completeness/field-specific clarification
- typed clarification merge/conflict handling
- semantic reimbursement route + shadow
- handoff-only safety route และ optional DRAFT-only creation
- terminal Flex card สำหรับ expense/reimbursement
- capture/reimbursement timing stages
- 1,000 ms debounce experiment, loading-on-accept, casual/simple-read prepared lanes ตาม spec เดิม
- eval corpus, configured-provider replay, UAT canary และ rollback evidence

### นอกขอบเขต

- reimbursement final mutations
- advance/petty cash/inventory withdrawal
- media-to-claim auto-link ใน phase แรก
- เปลี่ยน model tier ก่อน quality evidence
- production deploy ใน implementation PR แรก

## Phase 0 — Baseline, docs และ eval freeze

### งาน

- [ ] ยืนยัน source SHA/config ของ UAT และเก็บ event ids/timings ของ 4 canonical UAT cases
- [x] เพิ่ม `capture_execute`, `render` timing โดยไม่ log raw text/LINE id — `reimbursement_execute`
  ยังไม่เพิ่มโดยตั้งใจ เพราะ release นี้ไม่มี reimbursement execution ให้วัด (ดู `timeStage`)
- [x] freeze routing/completeness/merge/presentation dataset ตาม spec §14 — ครบทั้งสามชุด: §14.1 semantic
  routing ใน `scripts/line-ai-substitute-routing.corpus.ts` (92 rows รวม `LINE_AI_SEMANTIC_COVERAGE_CASES`
  61 rows ผ่านทุก bucket minimum, **structural เท่านั้น**), §14.2 `LINE_AI_COMPLETENESS_MERGE_MANIFEST`
  (22 rows) และ §14.3 `LINE_AI_PRESENTATION_PERMISSION_MANIFEST` (21 rows: `implemented_fixture` 13 /
  `required_gap` 8) ใน `scripts/line-ai-latency-autonomy.corpus.ts` โดย integrity spec พิสูจน์
  count/id/enum/mutation-safety/URL policy/evidence split เชิงกลไก
- [x] ผูก §14.2 กับ assessor จริง — integrity spec เรียก `assessLineTextExpenseCapture` กับทุก expense row
  (20 rows) ด้วย frozen active-category map ไม่มี DB/network; 2 claim rows ถูกกันออกด้วย `lane` เพราะยังไม่มี
  deterministic assessor §14.1 ยังต้องรอ configured-provider replay จึงยังไม่มี route-accuracy evidence
- [ ] amend/reference `line-ai-expense-draft-conversation`, `reimbursement-approval`, message buffering,
  latency/autonomy และ permission matrix ให้ boundary ใหม่ไม่ขัดกัน
- [x] เพิ่ม exact UAT rows ใน latency corpus และแก้ protected reimbursement expectations ใน substitute corpus
- [ ] บันทึก baseline p50/p95/model calls/token/cost แยก journey

### Exit

- ทุก defect มี failing deterministic/provider fixture และ baseline trace ที่อ้างอิงได้
- §14.1 ยังเป็น structural freeze เท่านั้น: route accuracy ต้องรอ configured-provider replay
  (`run-line-ai-operator-language-eval`) ซึ่งยังไม่มี credential จึงยังไม่มี agreement evidence
- §14.2 ผูกกับ assessor จริงแล้ว (expense rows) แต่ยังไม่ใช่หลักฐาน mutation หรือ full-flow
- §14.3 ยังมี `required_gap` 8 rows ที่ยังไม่มี implementation จึงห้ามอ่านว่า presentation/permission ผ่านแล้ว
- Phase 0 ยังไม่ปิด: source SHA/config + event id ของ 4 UAT cases, doc amendment ที่เกี่ยวข้อง และ baseline
  p50/p95/model call/token/cost ยังไม่ได้บันทึก

## Phase 1A — Typed clarification infrastructure (default-off)

### งาน

- [x] เพิ่ม contract `semanticOutcome` และ `fundingSource` แบบ bounded พร้อม mutation veto สำหรับ
  `AMBIGUOUS`/`UNKNOWN`; ยังไม่ activate routing behavior
- [x] บังคับ exactly one deterministic amount candidate สำหรับ future final create; mismatch/ambiguity fail closed
- [x] เพิ่ม typed `missingFields`, `acceptedFields`, `conflictingFields` ใน incomplete result
- [x] แทน `TEXT_EXPENSE_CLARIFY_REPLY` แบบคงที่ด้วย deterministic formatter ตาม missing fields
- [x] เพิ่ม DB-backed neutral intake state ผูก company/user/chat hash พร้อม version/TTL/provenance —
  model `LineIntakeState` + migration `20260826120000_line_intake_state` (partial unique index บน OPEN row
  ต่อ company+user+chatKeyHash) และ `LineIntakeStateRepository` ที่ fail **closed**; gate ด้วย
  `LINE_AI_INTAKE_STATE_MODE` (`off` default | `shadow` | `on`)
- [x] ให้ open clarification เก็บ bounded state reference ไม่ใช่ financial source of truth — ledger header
  ระบุการ demote ชัดเจน: `valueCandidates`/`clarifyQuestion` เป็น snapshot ของถ้อยคำเท่านั้น ไม่ใช่ source of
  truth ของยอดเงิน และเมื่อ mode = `on` durable state (ไม่ใช่ Redis stream) เป็นตัวตัดสิน financial continuation
- [ ] merge follow-up โดยรักษาค่าเดิม; conflicting amount ต้องถาม; explicit correction เท่านั้นที่แทนค่าได้ —
  ทำแล้วสองข้อหลัง (conflict ถาม, correction grammar ปิด) ส่วน “รักษาค่าเดิม” ยัง **ไม่ครบ**: state เก็บ
  `acceptedHintsJson`/`provenanceJson` ไว้แล้ว แต่ routing region ยังไม่ได้อ่านค่าเดิมกลับมา merge เข้ากับ
  follow-up (WP-B ปิดเฉพาะ zero-write guarantees สี่ข้อ)
- [x] state outage/stale/cross-owner -> zero write — gate อยู่ **ก่อน** `captureExpenseNote.execute` ทุกกรณี
  จึงเป็น zero-write โดยโครงสร้าง; owner triple อยู่ใน WHERE ของทั้ง read และ resolve UPDATE
- [x] consume state และ create/replay marker ให้ atomic หรือ unique-idempotent ไม่มี duplicate window —
  consume เป็น conditional UPDATE เดียว (CAS บน `version` + status OPEN + TTL) จึง atomic ในตัวและ replay
  ซ้ำได้แบบ idempotent; **ยังไม่ได้** รวม consume กับ source write ไว้ใน transaction เดียว — ใช้ลำดับ
  CAS-ก่อน-write แทน ซึ่งกันการเขียนซ้ำได้ แต่ถ้า source write ล้มหลัง CAS ผู้ใช้ต้องถามใหม่
- [ ] persist canonical terminal outcome ก่อน resolve state; delivery retry/reply-token failure replay outcome เดิม
- [ ] service total เดียวใช้ system quantity representation ที่ audit ได้; สินค้า/หลายรายการห้ามใช้

### ไฟล์/จุดหลักที่คาดว่าจะกระทบ

- `packages/contracts/src/line-ai.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-document.logic.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- DB neutral-intake state repository/migration, line ledger references และ focused specs

### Verification

- exact 50/60 บาท UAT phrases ใน test/default-off path
- amount-only/purpose-only/date/conflict/correction/model-mismatch/ungrounded-purpose/redelivery
- flag-off regression ของ expense draft conversation
- no write on incomplete/conflict

### Exit

- ยังไม่ปิด: typed assessor + formatter tests ผ่านแล้ว แต่ DB-backed neutral state และ replay ยังไม่มี จึงยัง
  ไม่ครบ exit และ production behavior/completeness expansion ยังไม่เปิด

## Phase 2 — Reimbursement semantic route ใน shadow

### งาน

- [x] เพิ่ม semantic result 3 ทาง, `fundingSource` และ `REIMBURSEMENT_REQUEST_START` +
  `reimbursementHints` แบบ bounded
- [x] เพิ่ม semantic definition/examples/boundaries ใน intake prompt (เฉพาะเมื่อ capability เปิด)
- [x] parse/rebuild intent/hints ทุก API->Gateway boundary ด้วย explicit membership
- [ ] ส่ง reimbursement/expense/open-clarification context ที่จำเป็น โดยเป็น DATA ไม่ใช่ authority
- [ ] shadow compare intent ใหม่กับ `clarify_only` โดยไม่เพิ่ม blocking model call ใน user path — `shadow`
  เป็น NO-GO scaffold ที่ inert เท่ากับ `off` โดยตั้งใจ; agreement ต้องมาจาก offline provider replay
- [ ] log agreement/disagreement reason แบบ enum และทำ human adjudication
- [x] update substitute/latency/operator protected sets ให้รู้จัก route ใหม่

### Negative boundaries บังคับ

- ordinary expense, reimbursement read, question, negation, stock withdrawal, advance, payment voucher,
  substitute receipt, correction, mixed social+business, permission/feature disabled

### Exit

- fixed route corpus 100%, live shadow อย่างน้อย 7 วัน/500 adjudicated turns (Thai >= 350, English >= 75,
  mixed/noisy >= 75, critical negative แต่ละกลุ่ม >= 60 และ negative รวม >= 300), wrong write 0,
  critical false positive 0 และ one-sided 95% upper bound <= 1%; invalid output fallback ปลอดภัย

## Phase 3A.1 — Primary `clarify_only` guard + handoff card contract

### งาน

- [x] dispatcher อ่าน intent ใหม่หลัง router; ห้ามส่งเข้า `CaptureLineExpenseNoteUseCase`
- [x] สร้าง/test dedicated reimbursement clarification/handoff card ก่อนเปิด primary flag
- [x] recheck active linked member, legal, entitlement `reimbursement`, `reimbursement.create` และ branch create scope
- [x] bare/ambiguous `เบิก...` ถาม payer/source-of-funds และ zero write
- [ ] ถ้าข้อมูลขาด ใช้ typed clarification state จาก Phase 1A — ตอนนี้ใช้ ledger clarification เท่านั้น
- [ ] เปิด canary ในโหมด `clarify_only`: strong claim และ ambiguous ถูกกันออกจาก expense mutation แต่ยัง
  ไม่ activate handoff CTA — code + tests พร้อม แต่ยังไม่ได้เปิดใน environment ใด
- [x] permission/entitlement denied ต้องไม่มี CTA และไม่มี financial query params
- [ ] terminal outcome persist ก่อน state resolve; LINE delivery retry ต้อง replay เดิมโดยไม่ route ใหม่ —
  ลำดับ persist-ก่อน-ส่ง ทำแล้ว แต่ `persistIntakeTurn` เป็น best-effort และยังไม่มี replay seam
- [x] audit route/outcome; mutation count ต้องเป็นศูนย์

### Exit

- `clarify_only` primary แล้วข้อความ “ขอเบิก” ไม่สร้าง wrong-domain expense; handoff card contract ผ่าน tests

## Phase 1B — Expense completeness activation หลัง guard

### งาน

- [x] เปิด `businessPurpose` completeness เฉพาะ route ที่ server ยืนยัน
  `BUSINESS_EXPENSE + COMPANY_PAID` — code + tests; ผูกกับ `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` ที่ปิดอยู่
  จึงยังไม่มีผลใน runtime
- [x] `REIMBURSEMENT_CLAIM`, `AMBIGUOUS` และ `UNKNOWN` veto expense mutation ก่อน completeness gate
- [x] เปิด typed field-specific formatter จาก Phase 1A (state ยังเป็น ledger เดิม)
- [ ] สร้าง/test dedicated expense terminal card ก่อนเปิด canary แยกจาก semantic canary

### Verification

- exact `ค่าวิน 60 บาท ไปพบลูกค้า` สร้าง expense draft โดยไม่ถามซ้ำ
- exact `ขอเบิก...`/bare `เบิก...` สร้างศูนย์ `ExpenseRecord`
- conflict 60/200, explicit correction, missing purpose และ redelivery

### Exit

- ข้อมูล expense ครบไม่ถามซ้ำ; field ขาดถามเฉพาะที่ขาด; wrong-domain expense เป็นศูนย์

## Phase 3A.2 — Handoff-only primary activation

### งาน

- [x] strong `REIMBURSEMENT_CLAIM + EMPLOYEE_PAID` ที่ผ่าน authority ส่ง trusted handoff card ไป
  `/reimbursements/new` — code + tests หลัง mode `handoff` ที่ยังไม่ได้เปิด
- [x] `AMBIGUOUS`/`UNKNOWN` ใช้ payer/source choice card หรือ quick reply และ zero write
- [x] denied/expired/cross-company/branch mismatch ตอบ deterministic text ไม่มี CTA
- [ ] URL ไม่มี financial query params และ expired reply-token replay terminal outcome เดิม — URL policy
  ผ่าน test แล้ว ส่วน replay ยังไม่มี

### Exit

- release แรกเข้า reimbursement journey ถูกห้อง เป็น first-party card และยังสร้างศูนย์ domain record

## Phase 3B — DRAFT-only reimbursement creation (ต้องมี owner GO)

### งาน

- [ ] เพิ่ม API/source use case สำหรับ LINE handoff ที่เรียก `CreateReimbursementDraftUseCase` เดิม
- [ ] amend `reimbursement-approval-spec` และ permission matrix ก่อนเริ่ม mutation code
- [ ] derive idempotency key จาก company + hashed LINE event/message id
- [ ] ใช้ `ReimbursementRequest.idempotencyKey` และเพิ่ม unique `(companyId, idempotencyKey)` แบบ nullable
  พร้อม migration/duplicate preflight; public web create behavior ต้องไม่เปลี่ยน
- [ ] create one grounded line; ห้าม default/invent missing receipt reason
- [ ] map `CreateReimbursementRequestInput` ครบ: server branch, grounded reason, one line ที่มี date,
  description, optional purpose, active category key และ amount; omit currency/missing-receipt fields ถ้าไม่มี
  source-verified value
- [ ] branch scope, `reimbursement.create`, entitlement และ requester identity ต้องใช้ source authority เดิม
- [ ] bind clarification consumption/replay result ให้ retry ได้ object เดิม
- [ ] audit source channel แบบ bounded
- [ ] ห้าม submit หรือ materialize claim expense ใน path นี้

### Verification

- permission/feature/branch/legal denied -> zero request
- first call/retry/redelivery/concurrent duplicate -> one DRAFT
- DRAFT fields/source/audit ถูกต้อง
- no `ExpenseRecord` until existing reimbursement lifecycle materializes projection
- web can open/fix/submit the created draft under existing permissions

### Exit

- exact UAT request creates one reimbursement DRAFT only after required fields complete

## Phase 4 — Flex renderer hardening และ optional card

### งาน

- [ ] reuse clarification/handoff card จาก Phase 3A และ expense card จาก Phase 1B; เพิ่ม optional
  reimbursement draft card เมื่อ Phase 3B ได้ owner GO โดยใช้ `line-business-card.logic.ts` เป็น primitive
- [x] singular completion ต้องไม่ผ่าน plain-text-only helper (หลัง
  `LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED` ที่ default-off)
- [x] multi-part path ให้ terminal part เป็น Flex; missing-field clarification ยัง text ส่วน semantic
  payer/source choice ใช้ trusted card/quick reply
- [ ] safe tenant URL ต้องตรวจ object type/path/company
- [ ] persisted `replyText`/correction lookup/audit preview คง canonical text เดิม
- [ ] body/altText/button/quick reply อยู่ใน LINE limits; ห้ามตัด required fields
- [ ] long reply ใช้ lossless text parts + concise terminal card; Flex validation failure fallback เป็น text —
  ส่วน lossless >1,200/>4,800 + concise card ทำแล้วและมี fixture (part ที่เกิน 5,000 ถูกปฏิเสธ ไม่ตัดเงียบ)
  ส่วน Flex-failure text fallback ยังไม่มี

### Verification

- unit snapshot ของ Flex structure/alt text/safe link
- unsafe origin/cross-company/path encoding ถูกปฏิเสธ
- real LINE UAT เห็น first-party green card ไม่ใช่ link preview

### Exit

- expense link ไป `/expenses/:id`; handoff ไป `/reimbursements/new`; optional draft card ไป claim เดียวกัน

## Phase 5 — Waiting UX และ 1,000 ms debounce experiment

ใช้ implementation/flags จาก `line-ai-latency-and-autonomy-lanes` ไม่เขียนใหม่

### งาน

- [ ] เปิด trace-only baseline ก่อน
- [ ] canary loading-on-accept 5% -> 25% -> 100%
- [ ] เก็บ 1,000/1,500/2,500 ms cohorts พร้อมกันตาม sample/statistical gates เดิม
- [ ] ตัดสิน 1,000 ms ก่อน; 1,500 ms เป็น predeclared fallback เท่านั้น
- [ ] freeze latency-affecting flags ตลอด measurement window
- [ ] device UAT ยืนยัน visible acknowledgement; server acceptance อย่างเดียวไม่พอ

### Exit

- acknowledgement p95 <=1s และ candidate ที่เลือกไม่เพิ่ม split/duplicate/re-ask เกิน gate

## Phase 6 — Casual latency

### 6A Fused casual

- [ ] consume verified zero-tool casual prepared plan ใน Gateway
- [ ] ข้าม inner intent router แต่คง existing Nong Mangmee composer
- [ ] gate attachment/open clarification/mixed business/crisis/privacy/refusal
- [ ] call count 3 -> <=2

### 6B Exact standalone greeting

- [x] versioned exact allowlist หลังทุก security/context gateและหลัง turn buffering
- [x] deterministic Nong Mangmee reply; zero model calls
- [x] ถ้ามี second bubble, attachment, open clarification หรือ business text ให้ fallback upward
- [x] ห้ามใช้ lane นี้เป็น regex synonym engine สำหรับ business intent

### Exit

- ยังไม่ปิด: code + tests พิสูจน์ 3 -> 0 model calls บน lane นี้และ mixed greeting+business ยัง route ปกติ
  แต่ flag ยังปิด และยังไม่มี provider corpus replay/persona review

## Phase 7 — Text router cost/latency

### งาน

- [ ] แยก text-only dynamic schema ออกจาก media/OCR prompt โดยไม่ตัด context ที่ text capture ต้องใช้
- [ ] ย้าย static glossary/tool/intent definitions เข้า cacheable prefix
- [ ] ลด max output tokens ให้พอดี bounded schema
- [ ] reuse provider client ตาม boundary เดิม
- [ ] วัด cache read/write, provider throttling/retry/cold start
- [ ] เปรียบเทียบ prompt ใหม่กับ current strong model; ยังไม่เปลี่ยน tier

### Exit

- text router p50/p95/token/cost ดีขึ้นตาม spec และ protected provider corpusไม่ถอย

## Phase 8 — Simple reads, deterministic denials และ media tail

### 8A Simple reads

- เปิด prepared simple-read family ทีละ family ตาม plan เดิม; one model + one tool + deterministic formatter

### 8B Authority terminals

- permission/feature/legal/company gates ที่รู้ก่อน semantic routing ตอบ deterministic 0-call

### 8C Media

- เพิ่ม per-stage OCR/download/classify/create timing
- reuse OCR/classification result ไม่เรียกซ้ำ
- parallelize เฉพาะ independent safe reads; mutation/order ยังคง serial
- media prompt/provider changes แยก canary จาก debounce/casual experiment

### Exit

- simple read และ denial budgets ผ่าน; media p95 ลดลงโดย OCR correctness/source boundaries ไม่ถอย

## Integration verification

### Contract/API

- explicit enum parity/parser tests ทุก receiver
- no blind cast/raw Flex/model authority
- reimbursement source module owns mutation; Gateway no repository
- idempotency/concurrency/branch/permission/feature/legal tests

### LINE journey

- clarification -> follow-up -> handoff/Flex -> web; optional DRAFT path จึงมี one object assertion
- quick replies, loading, status bubble ordering, expired reply-token push fallback
- one-to-one onlyสำหรับ write; group behavior unchanged/deniedตาม spec

### Web journey

- handoff card opens create-claim route under current permission
- optional DRAFT card opens own claim detail และ requesterแก้ date/evidence/reasonก่อน submitผ่านเว็บเดิม
- forbidden/feature-off/branch mismatch states remain honest

### Commands ตอน implementation

- focused contracts tests/typecheck
- expense document logic/use-case specs
- reimbursement request/repository idempotency specs
- process webhook + buffer + card specs
- latency/substitute/new corpus integrity and configured-provider eval
- `git diff --check`

ห้ามแก้ `package.json` เพื่อเพิ่ม test script; รัน focused command โดยตรงตาม repo pattern

### หลักฐานที่รันจริง (หลังรอบ consistency pass สุดท้าย)

- API focused suites ผ่าน 388/388, corpora/eval ผ่าน 33/33, `@watchdog-bms/config` 130/130,
  AI Gateway 69/69 และ contracts 39/39
- typecheck ผ่านทั้ง `@watchdog-bms/api`, `@watchdog-bms/ai-gateway`, `@watchdog-bms/config` และ
  `@watchdog-bms/contracts` หลัง regenerate Prisma client ใน workspace; generated output ไม่มี tracked diff
- `git diff --check` ผ่าน
- ยังไม่มี: configured-provider replay, live shadow, canary, UAT run และ deploy ใด ๆ

## Rollout gates

| Gate | GO เมื่อ | Rollback |
| --- | --- | --- |
| typed infra | focused fixtures 100%, flag/default path unchanged | keep feature off |
| reimbursement shadow | 7d/500 adjudicated + language/negative minima, critical FP 0, 95% upper <=1% | remain shadow |
| clarify-only guard | wrong-domain expense 0, card/permission/replay pass | deterministic clarify-only fallback |
| expense completeness | guard active + fixed fixtures 100%, no wrong write | disable completeness flag |
| handoff primary | wrong-domain expense 0, denied CTA 0 | `clarify_only` |
| DRAFT 5/25/100 | idempotency/permission/UAT pass | handoff-only; retain created drafts |
| card | safe links/LINE client pass | text renderer |
| debounce/loading | existing statistical gates pass | prior cohort/config |
| casual/simple lanes | protected quality/safety pass | full agentic fallback |

ทุก behavior-changing lane default-off หรือ shadow จน evidence gate ของมันผ่าน การ rollback ห้ามลบหรือ
ย้าย business records ที่สร้างถูกต้องแล้ว

## ความเสี่ยงหลัก

- เพิ่ม intent กระทบ router intent อื่นทั้งหมด -> ป้องกันด้วย shadow + protected corpus
- chat-created reimbursement เปลี่ยน product boundary เดิม -> owner GO + DRAFT-only
- retry สร้าง claim ซ้ำ -> DB-backed unique idempotency + concurrency test
- expense projection ซ้ำ -> ห้ามสร้าง Expense ก่อน claim lifecycle
- follow-up overwriteยอด -> typed conflict rule
- generic card ตัด long reply -> structured concise card
- latency prompt slimming ลดความเข้าใจ -> configured-provider no-regression ก่อน canary
- เปลี่ยน debounce พร้อม prompt ทำให้สรุปสาเหตุไม่ได้ -> แยก experiment windows

## Definition of done

- spec acceptance criteria ผ่านครบ
- Claude และ Codex review คนละรอบ ไม่มี P0/P1 ค้าง; Phase 3B product decision อาจคง pending ได้
- focused/full relevant checks มีผลบันทึกใน memory
- UAT exact screenshots ถูก replay และมี trace/card/object evidence
- ไม่มี code/config/deploy claim ว่า production ดีขึ้นก่อน signed UAT/deployment protocol
