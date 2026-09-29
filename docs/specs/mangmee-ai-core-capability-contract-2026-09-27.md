# Implementation contract: context, source facts และ capabilities

วันที่: 2026-09-27\
สถานะ: **Normative design v2.4; planned implementation ไม่ใช่ผลทดสอบ**\
Baseline: `origin/main f932b57766f5dd22c0d28aedd4bc06f210e374ef`\
Parent: [spec](mangmee-ai-understanding-and-advisor-reliability-spec-th.md), [plan](../plans/mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md)

## 1. Scope และ contract ownership

เอกสารนี้ล็อก W00–W05, W06A/B, W07A/B, W08/W09/W12 และส่วนร่วมของ W14/W15; รายละเอียด input/provider, delivery และ business writes อยู่ใน appendices ที่ parent §22 ระบุ ใช้ types เดิมใน `packages/contracts/src/line-ai.ts`, `ai-tools.ts`, `line-ai-prepared-plan.ts`, `line-ai-advisor-answer.ts` เพิ่ม versioned fields ไม่เพิ่ม orchestration framework ไม่สร้าง tool ต่อคำศัพท์ และไม่แก้ระบบสิทธิ์อีกชุด

ชื่อ type/field ที่เพิ่มในเอกสารเป็น **target code**; source baseline ยังไม่มีครบ การ rename ภายใน module ทำได้ แต่ wire enum, semantic meaning, limits, database constraints และ acceptance ต้องเปลี่ยนเอกสารพร้อมกัน ห้ามเติม nullable/default เพื่อซ่อนข้อมูลหายระหว่าง hop

Wire request v2 ต้องพก `contractVersion`, input evidence ตาม input appendix, `contextProjection`, `capabilitySnapshot`, `deadlineAt`, authenticated budget authority และ trace lineage ผ่าน API client → Gateway HTTP → runtime client → AgentCore handler → turn use case; response พก `coverage`, typed facts/source references, canonical answer/delivery intent และ state proposals กลับครบทุก hop Schema validation อยู่ทั้ง ingress/egress; strict version negotiation ไม่ silently parse v2 ด้วย v1

API เป็นผู้สร้าง owner/access/capability facts; Gateway เป็นผู้เสนอ meaning/plan/answer เท่านั้น API ตรวจ current permission/source revision ก่อนอ่าน เขียน และส่ง asynchronous result อีกครั้ง Model ไม่สร้าง company/member/branch/entity/action IDs จากข้อความเอง

## 2. Executable manifest และ effective capabilities

Build artifact `line-ai-capability-manifest.json` เป็น output ของ test/build parity จาก registry, DI/tool map และ API intake routes ไม่ใช่ registry ที่ต้องดูแลสิทธิ์ซ้ำ แต่ละ operation มี:

```ts
type CapabilityEntry = {
  operation: string; execution: 'read_tool'|'api_intake'|'web_only';
  implementation: 'wired'|'registered_unwired'|'deferred';
  inputSchemaVersion: string; supportedFields: string[];
  permissionPolicyRef: string; featureKeys: string[];
  channelKinds: ('USER'|'GROUP'|'ROOM')[];
  sourceModule: string; resultBasisVersion: string;
  runtimeContractVersion: 1|2; release: 'R1'|'R2'|'R3'|'DEFERRED';
};
```

Full build manifest ไม่ส่งทั้งหมดทุก turn; server เลือก effective operations ที่เกี่ยวข้องและ compact public descriptions ใช้ schema/prompt size allocator ใน input appendix Snapshot มี `manifestDigest`, `accessVersion`, `servingConfigDigest`, generatedAt และ operation-specific availability นำไปใช้พร้อมกันใน intake/planner/help/renderer คำนวณจาก registry+handler parity → contract compatibility → channel → feature/entitlement → effective permission → current serving flag ตามลำดับ; data sufficiency ตรวจหลังอ่านจริง ห้ามถือ group ready เพราะมีหนึ่ง operation ทำได้

`not_implemented`, `web_only`, `feature_disabled`, `forbidden`, `temporarily_unavailable`, `insufficient_data`, `needs_confirmation` map ลง existing ToolResult status พร้อม typed `reasonCode`; ไม่เปลี่ยน forbidden เป็น empty และไม่เปิดรายละเอียดของ operation ที่ผู้ใช้ไม่มีสิทธิ์เห็น Capability ready ไม่รับรองว่าบริษัทมีข้อมูลครบ

Parity tests ต้อง enumerate **ทุก registry operation** และทุก enabled API intake path; ทุกชื่อมี handler หรือ explicit non-ready reason, ทุก handler มี module provider/export/import ที่ resolve ได้ ตรวจทุก sold/enabled feature family: dashboard/company, sales, expenses, accounting/ledger, tax, workflow, inventory, procurement/AP, AR, banking, reimbursement, CRM และ attachment evidence ส่วน capture ไม่จำเป็นต้องอยู่ read toolMap

`bank.get_account_balances` และ `bank.get_reconciliation_status` ที่ registered-but-unwired ต้อง wire ใน W06B:

- เพิ่ม adapter ใน existing ERP tool layer และ import/export BankingModule use cases; ใช้ `ListBankAccountsUseCase` + `GetCashPositionUseCase` ผ่าน API domain สำหรับ balances ต้องมี **bank.account.read AND bank.cash.read** ปรับ registry ให้ตรงก่อน advertise ใช้ last reconciled balance/date เท่านั้น; absent balance = null/unknown ไม่ใช่ศูนย์ ไม่เรียกว่า live bank balance
- Reconciliation ใช้ permission-checked list sessions ตาม bank account/branch; registry `bank.reconciliation.read` ตรง domain; result ส่ง last completed session และ current pending/unmatched counts แยกวันที่/basis ไม่รวมสกุลเงินต่างกัน รายการ account ที่อ่านไม่ได้ไม่เปิดเผยชื่อ
- แก้ domain cash summary ให้อ่าน consistent snapshot และไม่โหลดทุก statement line เพื่อ count (aggregate/count + latest row/session ใน repeatable-read transaction); ไม่เพิ่ม bank feed/forecast หรือ mutation tool

## 3. Context storage, lifecycle และ concurrency

ใช้ `AiConversation` เดิมตาม parent §16.2 เพิ่ม nullable `channelKind` (USER/GROUP/ROOM), `messagingChannelId`, `chatKeyHash`, `membershipId`, `stateVersion` default0, `taskStateJson`, `stateExpiresAt`, `lifecycleEpoch` default0; schema binding check ยอมรับ legacy ทุก binding field null หรือ v2 ทุก field non-null เท่านั้น `channel` เดิมคงค่า `line` ซึ่งเป็น transport; `channelKind` ใหม่คือ LINE chat type จาก verified event (USER/GROUP/ROOM) ไม่เขียน USER ลง field channel เดิม. Private context/preferences ใช้ USER เท่านั้น; group public general ไม่อ่าน private bound row. Full owner = company/user/membership/channel/channelKind/messagingChannelId/chat hash; deterministic v2 ID = SHA256 ของ canonical full owner พร้อม prefix `line-v2:` ไม่ใช้ legacy `line-company-user`

เพิ่ม unique index full owner สำหรับ bound rows, index expiry และ company/member; loader query exact deterministic ID **และ** full owner ไม่เลือก latest conversation ข้าม OA Update CAS ใช้ owner+stateVersion+lifecycleEpoch แล้วเพิ่ม version; conflict reload current state และ merge เฉพาะ proposal ที่ยังอ้าง task/source revision เดิมได้ 1 ครั้ง ถ้ายัง conflict ส่ง typed stale state ไม่ last-write-wins

`taskStateJson` version2 ขนาด UTF8 ≤16KiB: ≤4 tasks, ≤8 subrequests/task; taskId API-issued, revision, kind, state, userGoal≤800 UTF16, validated slots, constraints, bounded candidate entity locators, delivered question refs, source revision locators และ attachment/page refs; ไม่เก็บ raw transcript หรือ financial totals เป็น authoritative state อายุ active projection15นาทีตาม parent Expiry ล้าง projectionเท่านั้น ไม่ลบ financial intake/preview/commit/delivery proof

Scope mismatch, membership disabled/unlinked, opt-out หรือ channel binding เปลี่ยน: API transaction increment lifecycleEpoch, clear projection, invalidate pending media and unsent private result; unlink/disabled ลบ preferences และ AiTurn/private context ตาม lifecycle policy; opt-out เก็บ explicit preferences จน expiry เดิมแต่ห้ามโหลดใช้ระหว่าง opt-out; worker อ่าน epoch อีกครั้งก่อน write/delivery การลบ cache เพียงอย่างเดียวไม่พอ ห้าม async writer upsert resurrect แถวเก่า หลังลบ private content ให้เหลือเฉพาะ minimal tombstoned bound row (owner IDs/epoch/versions ไม่มี AiTurn/goal/preferences) เป็น epoch authority ขณะมี retained jobs; cleanup หลัง jobs/receipts พ้น retention เดิม ไม่ hard-delete เพื่อ reset version

เพิ่ม binding และ `lifecycleEpoch`, `intakeStateId` nullable, `readJobId` nullable, `revision` default0 บน `LineIntakePendingMedia`; legacy unbound rows expire ไม่ auto-adopt Replace A→B ต้อง CAS persist B+revisionก่อนถาม/อ่าน; supplement มี ordered attachment refs ชัดเจน ใช้ attachment checksum เป็น dedupe ภายใน owner ไม่แชร์ข้าม tenant

Projection lifecycle: ACTIVE → WAITING_USER/WAITING_JOB/PAUSED → ACTIVE → COMPLETED; cancel → CANCELED, owner revoked → INVALIDATED เมื่อ business action committed แล้ว cancel ทำได้กับ remaining work/delivery ตาม delivery appendix ไม่เปลี่ยน APPLIED เป็น CANCELED

ถามความรู้แทรกไม่เปิด/resolve financial `LineIntakeState`; คง constraint ว่ามีเพียงหนึ่ง OPEN financial clarification ตาม store เดิม เมื่อมี financial task ใหม่ชนกันให้ถามเลือกพัก/ใช้รายการไหนครั้งเดียว ไม่สร้างหลาย OPEN rows ผ่าน context JSON

## 4. Semantic planning, correction และ conversational behavior

ต่อ semantic intake เดิมด้วย validated proposal `subrequests[]` แต่ละข้อมี server index, kind(read/general/write/help/public/file), goal, required evidence, requested filters, entity reference และ dependencies; ≤8 ข้อ/turn ถ้าเกิน ให้แสดงครบว่ารับกี่ข้อและให้เลือกชุดก่อน execute ห้าม execute prefix โดยเงียบ ๆ Raw evidence spans ใช้ input appendix; normalized text เป็น search hint ไม่ใช่ authority

ตัวอย่าง “แก้หมายเหตุเป็นค่าน้ำมัน แล้วกำไรกับเงินสดต่างกันยังไง” ต้องได้ write proposal + general subrequest; ตอบความรู้ได้ แต่การแก้ต้องผ่าน preview เดิม ข้อความ “อย่าเพิ่งบันทึก” เป็น constraint ของ proposal; classifier keyword ไม่อาจ override validated negation/correction Financial field ambiguous → clarification ไม่ fuzzy-correct amount/date/account ID

เลือก next step ตามผลจริง: safe clear general → answer, valid read → tool, ambiguous material slot → หนึ่งคำถาม, unsupported requested filter → อธิบายข้อจำกัดเฉพาะ filter, completed → stop ไม่ถามปิดท้ายทุกครั้ง เปลี่ยน subject ไม่ถูกบังคับกลับ intake เดิม Reference “อันที่สอง” ใช้ candidate list ที่ส่งสำเร็จแล้วและยังอยู่ scope; ไม่ใช้ list ที่แค่ generate แต่ส่งล้มเหลว

Recovery เดียวต่อเหตุใน turn: malformed proposal/schema → targeted repair ภายใน provider call budget; transient read → retry1เมื่อ remaining deadlineพอ; permission/feature denied → ไม่เปลี่ยน toolเพื่อเลี่ยง; confirmed empty → ตอบ empty; inconsistent evidence → partial/conflict Loop fingerprint = task revision + operation + canonical args + source snapshot; same result reused, different period/filter allowed Next clarification ต้องไม่ซ้ำ delivered question+slot value ถ้าระบบล่มให้บอก unavailable ไม่วนถามข้อมูลที่เคยได้รับ

General knowledge ไม่บังคับ ERP calls บริษัท-specific facts ต้อง tools, product instructions ต้อง manifest/approved cards, current claims ต้อง public lane Persona/style request ชนะ stored preference; ห้ามลด depth ทั้งหมดเพื่อให้ latencyผ่าน General greeting/short answer 0 ERP reads; ไม่กำหนด keyword whitelist ของธุรกิจที่บล็อกคำถามทั่วไป

Final check แบบ deterministic ใช้ validated coverage/facts/source/action receipts ก่อน render; second reviewer model **ไม่ใช่ default** เลขใหม่ในคำตอบต้อง bind fact/calculation/user hypothesis และแสดง hypothetical ชัด Model ไม่เปลี่ยน ToolResult forbidden/unavailable เป็นไม่มีรายการ

## 5. Queries, aggregates และ numeric source contracts

ขยาย schema ของ tools เดิม ไม่เพิ่ม arbitrary SQL DSL Canonical query มี civil date range/timezone, branch selection, date basis, domain status, category/vendor IDs, grouping, page limit/cursor ตาม operation support Table นี้คือ R1 query contract; fields ที่ไม่อยู่ supported schema คืน `UNSUPPORTED_FILTER` พร้อม field names ก่อนเรียก repository ไม่ strip แล้วอ่านความหมายอื่น

| Query | Accepted contract / default | Execution basis |
|---|---|---|
| Expense list/breakdown/compare | startDate/endDate หรือ periodKey; branchId; categoryId/vendorId; domain documentStatus/paymentStatus; groupBy category/vendor/day; limit1..50 default20, opaque cursor | บันทึกรายจ่ายตาม incurred/document date; paid ใช้ payment source จริง ไม่ใช้ updatedAt |
| Sales summary/compare | range/period; branchId; supported sale status; dateBasis recorded sale หรือ cash receipt ตาม metric | recorded sales ไม่เรียก accrual revenue; cash received ไม่ใช่ profit |
| Ledger/report summary | periodKey หรือ range; branch; explicit dataset operational/posted_ledger; metric allowlist | P&L requires posted ledger; permission ไม่เปลี่ยน dataset ไปแหล่งอื่น |
| Detail/explain/drill-down | API-returned entityId + source revision + inherited filters | detail ตรง aggregate scope; stale revision reread before comparison |
| Daily closing | company civil day/branch + existing domain status | แสดง pending/missing evidence ตาม API ไม่สร้าง schedule service |

Group/list bounds: list default20/max50 rows; grouped query default25/max25 groups per page sorted by descending exact aggregate then stable group key, with opaque nextGroupCursor bound to canonical filter/scope and the last group tuple. Group pagination never limits the total aggregate population. `completeness.groups` เพิ่ม `nextCursor:string|null` เช่น rows และ `hasMore` ต้องมาจาก bounded overfetch26 ไม่เดาจากจำนวนเท่ากับ25. Tool response envelope ≤64KiB UTF8, facts≤128/sourceRefs≤128; string decimal≤128 chars, metric/basis identifiers≤100 chars, source label≤200. Over-limit ที่ยังเล็กลงได้ลดเฉพาะ display rows/groups พร้อม actual counts/hasMore; aggregate/factsที่จำเป็นเกินจริงคืน `RESULT_TOO_LARGE` ไม่ตัด claim/source binding. Request slot/source facts ยังคง bounded และ input allocator ตรวจ actual rendered payload ทุกครั้ง

Read budget: independent reads concurrency≤2; แต่ละ DB read มี timeout=min(5,000ms, remaining work budget). Repeatable-read transaction maxWait≤1,000ms ภายใน remaining budget และ statement/transaction timeout≤5,000ms ที่เหลือหลังได้ connection; ไม่เปิด transaction ก่อนรอ model/network. Query timeoutคืน unavailable ไม่รับรอง zero/complete; ห้าม SQL paging timeout resetงบทั้งturn. Aggregate precisionไม่จำกัดเพื่อทำให้payloadเล็กลง

Names → authorized existing lookup IDs; duplicate names ask pick ใช้ actual enum schema ของ domain re-export เข้า tool input ไม่ copy strings อีกชุด `periodKey=YYYY-MM` validate month1..12, leap day/real calendar dates ด้วย existing civil-date helperที่ปรับให้ strict; supplied one endpoint = `INCOMPLETE_RANGE`, reversed/invalid = `INVALID_PERIOD` ไม่ silently default Omitted period defaults current company month และคืน applied period ชัดเจน; R1 business timezone ใช้ Asia/Bangkok ตรง input candidates/domain baseline; requested timezone อื่นที่ operation ไม่รองรับคืน UNSUPPORTED_FILTER ไม่ตีความเป็น Bangkok เงียบ ๆ วันที่จบ inclusive แปลงเป็น `[localStart, nextDayLocalStart)` ที่ DB ไม่ parse local midnightเป็นUTCตรง ๆ

Selected branchA หมายถึง A เท่านั้น ไม่รวม null/central rows; all-authorized branches ใช้ ABAC predicateเดิมรวม central เฉพาะเมื่อ domain policyให้ Central-only ต้อง explicit selection/permission ไม่อนุมาน nullเป็นA Query fingerprintรวม branch predicate+date/status/dataset; cacheใช้permission/scopeversionและ sourceversion TTLเพียงอย่างเดียวไม่ให้สิทธิ์

API ToolResult เพิ่ม `queryApplied`, `basisVersion`, `facts[]`, `completeness` เป็น optional backward-compatible v2 metadata; existing v1 fieldsคงเดิม Fact ที่ v2 composerใช้ต้องครบ:

```ts
type SourceFact = {
  id: string; metric: string; value: string|null; // canonical decimal, never JS float
  unit: 'money'|'count'|'percent'; currency: string|null;
  period: { startDate: string; endDate: string; timezone: string }|null;
  dateBasis: string; statusBasis: string; sourceRefIds: string[];
  asOf: string; state: 'known'|'empty'|'unknown'|'conflict';
};
type Completeness = {
  aggregate: 'complete'|'partial'|'unknown';
  rows: { returned: number; hasMore: boolean; nextCursor: string|null };
  groups: { returned: number; hasMore: boolean; nextCursor: string|null };
  businessRecording: 'unknown'; // complete query does not prove all business records entered
};
```

source refs API-issued/permission checked; amount value null forunknown Count uses canonical integerstring; monetary use domain Decimal through DB→aggregate→serialization ห้าม `Number()`/`parseFloat()` เพื่อ sum Decimal string consumer conversionเฉพาะ displayและต้องไม่สูญprecision Accounting web/export ที่ consume same repo ต้อง versioned additive metadata/keep old DTOจนmigrated ไม่เปลี่ยนค่ากลับเป็น floatหลังadapter

Expense aggregates เปลี่ยนจาก paginated OFFSET summation เป็น DB aggregate/groupBy ภายใต้ **repeatable-read transactionเดียวกับ counts/list snapshot**; aggregateไม่ถูกจำกัดด้วยtop5/15 group display ใช้ deterministic order + id cursorสำหรับdetails Cursorผูกfilter/scope/snapshot metadata แต่เป็น continuationใหม่ไม่รับรองfrozen dataตลอดหลายturn; ถ้าต้นทางเปลี่ยนคืน asOfใหม่และบอกการเทียบข้ามsnapshotไม่exact Query timeout→unavailable ไม่คืน partialเป็นcomplete

Calculation helperใช้Decimalเดิม: delta=current−previous, percent=delta/abs(previous)×100 โดย currency/metric/basis/scopeต้องตรง; previous0→percent null พร้อม reason ZERO_BASE, ทั้งคู่0→delta0/percent nullไม่Infinity Missing baselineไม่แทน0 Roundเฉพาะpresentationตามcurrency policy เก็บrawdecimalและoperandfactIds/formulaVersion ทุก computed fact Cause explanationแยกข้อมูลที่พิสูจน์ได้จากhypothesis

Required adversarial fixtures: 9007199254740993.01 precision; Feb29/nonleap/เดือน13; paidvsrecorded; branchA/null/B; read/writeconcurrentpage; permission permitsoperational butnotledger; mixedcurrency; emptyvsfailure; top5แต่aggregateครบ; unsupportedfilter; samecompanyscopechangedก่อนcachehit

## 6. Receipt correction และ question-only image/PDF

W07A reuse capture/read jobs/domain facts: ทุก field has attachment/page/role/localspan or boundingbox และ rawvalue; parserตรวจตัวเลข **ภายในspanที่อ้างและroleเดียวกัน** ไม่ใช่เพียงพบตัวเลขที่ใดก็ได้ในOCR “TOTAL1177 CASH1200 CHANGE23” ต้องได้ total1177 หรือambiguous ไม่accept total1200 citingTOTAL1177 Human override versionชนะlateOCR; validateamount/date/currency/tax/duplicate/totalreconciliationผ่านdomainเดิม beforepreview ไม่มี high-confidence shortcut

> **2026-09-29 note (Owner decision, "ลบทิ้งเลย"):** strict receipt evidence (W07A receipt grounding: `requireEvidenceV2` / `receiptEvidence` on receipt OCR, and `evidenceSource` / `fieldEvidenceVersion` on capture windows) was removed from the code. It was never tested against real receipts; its rules were too narrow for common Thai receipts; one failed field discarded the whole read; and a failed read cost about 60 s and 3 paid model calls. Receipt photos and PDF/file reads now use the normal read with its value cross-check. See `docs/agent-memory/web-receipt-evidence-v2-2026-09-29.md`.

> **2026-09-29 note (NAT05/NAT06 real-model re-test, Owner "แก้ให้ผ่านเลย"):** the reader copied page text verbatim but miscounted UTF-16 offsets, so every real answer failed `QA_RESULT_INVALID`. A fact/evidence claim is now located by its own text in the page excerpt (the stated span only picks between repeated copies; whitespace/NFC-normalised containment keeps a claim without a span) and a claim that cannot be located is dropped — never the answer. The reader sends no offsets, keeps `visibleText` to ≤ 8 printed lines and ≤ 2 facts per page, answers per question once (top-level `answerPageRefs` may come from `questionCoverage`), writes minified plain-text JSON with no attachment ids, and is capped at 3000 output tokens. Delivery: `recoverDocumentQaResults` acts only after the admitting turn's foreground window (the race left answered events `delivery_pending`), the foreground waits for a read another worker tick claimed, a failed/expired read keeps its file (`RESOLVED_RECEIPT`; only cancel expires it), and the file a chat is about is the newest one asked about (an order word such as "ไฟล์แรก" reads that file beside it). Routing: the intake router defines kind `file` (a question about an attached or earlier file, including ใบนี้/หน้าสอง/แทน) and "ทำร่าง…จากใบนี้" as a `write` (EXPENSE_DOCUMENT_CAPTURE); that write drafts from the current file through the durable capture read. Evidence: `docs/research/mangmee-natural-real-model-results-2026-09-27-th.md` §รันทวน 2026-09-29.

> **2026-09-30 note (regression slice on develop 8cafabcc):** a clause that only sets the scope of a file question — "แค่ถามนะ อย่าเพิ่งลงรายจ่าย", "อย่าเพิ่งบันทึก" — stays kind `file` about that file (kind `general` when the chat has no file), never kind `read`; #910's rule that a company-data question about an unsold module stays `read` is unchanged. A `file` clause may carry `filters.attachmentId` (the bridge honours it only when the user typed that id): rejecting it cost the turn an intake repair, and R2's whole-task ceiling (intake1+reader1, never three) then left no dispatch for the reader, so the customer got "ระบบตอบกลับไม่ได้ชั่วคราว". The ceiling itself is unchanged. The reader writes its answers as น้องมั่งมี (the shared persona lines), not in ครับ.

W07B เพิ่ม question-only entry ใน API dispatchก่อนfinancialcaptureadmission และก่อน PDFfastpath: classifyด้วยcaption+context+attachment metadata; ยังไม่อ่าน content เพื่อสร้างexpenseเอง Intentquestion-onlyไม่สร้าง ExpenseDraft/CaptureGroup/auto-handoff ถ้าข้อความไม่ชัดใช้ pending mediaถามcapturevsquestionครั้งเดียว Empty captionไม่ใช่อนุญาตfinancialwrite

Reuse `AttachmentObject`/`AttachmentBlob`/`AttachmentLink` และ validation/download abstractionsเดิม; baselineยังมีDBblobstorage ไม่สมมติS3wired เพิ่ม link target `LINE_DOCUMENT_QA` ที่ resolveสิทธิ์fullownerในAPIเท่านั้น ไม่เปลี่ยนไฟล์ให้public

เพิ่ม Prisma `LineDocumentQaJob` แบบboundeddurablejob: id, fullowner/epoch, turnId, attachmentsJson, inputSetHash, questionDigest, readerVersion, status, revision, leaseOwner/leaseUntil/fence, foregroundDeadlineAt, jobDeadlineAt, resultJson, errorCode, createdAt/expiresAt; unique(ownerDigest, turnId, inputSetHash, questionDigest, readerVersion), indexes(status,leaseUntil), (companyId,expiresAt) โดยหนึ่ง job ครอบคลุมทั้ง admitted task: attachmentsJson มี ordered entries `{attachmentId,contentHash,requestedPages}` ไม่เกิน5 และรวม requested pages ไม่เกิน20; inputSetHash ผูกทั้งชุดและลำดับ. ใช้ API worker เดิม ไม่เพิ่ม queue platform. Gateway readerเรียกผ่าน internal contract; ไม่อ่านDBเอง

Admission: JPEG/PNG/WebP/PDF≤10MiB/file, ≤5 attachments/turn, PDF≤20pages/file; total selectedpages≤20/turn Singleimage=page1 ตรวจmagicbytes+decode/pixel/decompression limitsเดิมก่อนinvoke; passwordPDF/unsupportedmime/outofrangepage→typed outcome ไม่autoexpense NativePDFใช้เฉพาะapprovedadapterรองรับจริง; otherwiseexistingextract/renderadapterที่ผ่านreaderfixture ถ้าไม่มี adapterสำหรับmodel/versionนั้น effectivecapability unavailable ไม่ส่งfilenameแทนfile

Result≤64KiBและ≤20pages มี attachmentId + page ordinal, visible-text spans, normalized fact/claim locators, confidence flags, coverage requested/read/failed; question-summary answerต้องผูกpage refs ห้ามอ้างอ่านทั้งไฟล์เมื่ออ่านเฉพาะหน้า2 Attachmentlink/accessตรวจอีกก่อนreaderและdelivery Samebytes differenttenantต้องไม่reuseprivateanswer Delete/unlink→invalidatejobไม่ส่งlateanswer

State QUEUED → READING (fenced lease) → ANSWER_READY → delivery appendix หรือ FAILED/EXPIRED/CANCELED. ล็อก foregroundDeadlineAt=admittedAt+40s และ jobDeadlineAt=admittedAt+15min ตั้งแต่รับงาน; ที่ 37s แจ้ง durable progress หากยังไม่จบ แต่ไม่ยกเลิก provider แล้วสั่งซ้ำเพราะเปลี่ยนเป็น background. ทั้ง task ใช้ไม่เกิน 2 provider dispatches รวม intake/repair: intake1+reader1 หรือ direct accepted QA1+repair1; ไม่ใช่ intake1+reader1+repair1. Reader timeout ต่อ call 45s, grant/work deadline เดิมและ counter เดิมตลอด worker recovery. QA-only profile รองรับ 20 selected pages รวมทุก attachment; legacy 8-page guard และ capture40calls ไม่ถูกขยายตาม. หาก model/reader ไม่ผ่าน admitted-page quality/feasibility ภายใน envelope นี้ ห้ามเปิด combination นั้นหรืออ่าน prefix แล้วอ้างครบ.

QA job status บอกสถานะการอ่านเท่านั้น: ANSWER_READY คงไว้เป็น immutable source revision ระหว่าง replay; delivery status/accepted prefix อยู่ใน LineDeliveryPlan และ task completion เกิดหลัง required answer coverage ได้รับ acceptance ครบ ไม่แก้ job result/hash เพียงเพราะ retry ส่งข้อความ.

Raw QA result retention24h thenpurge, owner-boundfollowuprefs taskTTL15min; attachmentsใช้existingretentionpolicyและลบQA-only orphanตาม24hเมื่อไม่มีlegal/domainlink/activejob ไม่ลบsharedcaptureattachment ค่าที่เพิ่มเป็นproductdefaultsซึ่งprivacy/retentionnoticeต้องตรวจเป็นactivationgate การแปลง “บันทึกเป็นรายจ่ายด้วย” ใช้explicitnewcapturecommandกับattachmentเดิม+domainidempotency ไม่ย้ายQArecordเป็นexpenseด้วยDBwriteลัด

## 7. Approved knowledge/help retrieval

W08 ใช้ P23 approved cards/content registryเดิม เพิ่ม manifest artifact build-time มี id/version/title/questions summary/body/sourceURL/required capability/risk/releaseRange/effectiveFrom/To/reviewDueAt/contentHash กรองapproved+currentrelease+audience+permission+effectiveก่อนเลือก ไม่ ingest docs/research/agentmemoryหรือmarketingclaimsอัตโนมัติ

รุ่นแรก boundedpack≤64cards, metadata≤12KiB, body≤4KiB/card; buildrejectoverflow ไม่ runtime truncate Eligible metadataผ่าน existing semantic intake selector ในcallเดิม ส่ง selectedcardIds≤5; exactIDallowlistตรวจserver แล้วfetchbodyตามhash เพิ่ม targeted retrieval callได้เฉพาะremainingW11budget ไม่บังคับextraeveryturn Lexicalmatchingเป็นhintไม่veto เมื่อไม่มีmatchไม่outside_scope Help พื้นฐานใช้ current capability manifest แม้ pack ปิดอยู่

Runtime returns approvedcardrefs only; rendererตรวจ release/expiry/permissionsซ้ำ, linkต้องมาจากmanifest ถ้าไม่มี eligible card ให้ตอบ capability จริงเท่าที่มีและระบุยังไม่มีคู่มือที่ตรวจแล้วในส่วนจำเพาะ Generalconceptตอบได้ตามpolicyโดยไม่ปลอมcitation Searchscoreไม่ใช่authoritativeness R3/R4riskใช้reviewedeffectivepackตามparent ไม่webfreshnessoverride

Evaluation≥20heldoutproductquestions/Thai paraphrasesแยกfamilyจากtraining: Recall@5≥0.95 และ **zero incorrect capability/button/permission instructions** positive+expired+wrongrelease+wrongrole controls หากเกิน64cardsให้แบ่งcuratedreleasepacksตามexistingmoduleแล้วbuild≤64eligibleperrequestไม่dropcardsตามkeyword; routepackเลือกsemanticภายในsameintake budget No vectorDB/new dependencyในรุ่นนี้

## 8. Public lookup: executable R2 lane

เพิ่ม API-owned registry `public.lookup` permission category read_summary ไม่มีERP companyfactsinput Capabilityต้องผ่านapprovedvendor/region/model+externalcosttariff+contracttestsและflagจึงready; เพิ่ม OpenAI Responses `web_search` capability path ใน approved provider adapter เดิม (baseline OpenAI adapter ใช้ Responses อยู่แล้ว) โดย modelเลือกexistingapprovedconfiguredmodelที่web-searchcapabilitytestผ่าน (baselinecandidate gpt-4.1-mini; ไม่automigrate provider/model) ถ้าenvironmentอนุมัติแค่Bedrock laneนี้offจนvendoractivationgateผ่าน ไม่มีsilentvendorfallback

Input `{publicQuestion, topic, locale, temporalIntent, sourcePolicyId}`; publicQuestion≤1000UTF16, topicenum business_general/product_public/news/rates/public_policy Searchrequestสร้างจากpublicsubrequestเท่านั้น ไม่ส่งrawhistory/receipt/companytoolresults/IDs/internalURLs FilterdenyknownprivateentitiesจากturnและPII patterns; หากแยกpublicquestionไม่ได้ outcome `PUBLIC_QUERY_REQUIRES_REPHRASE` บอกส่วนที่ค้นสาธารณะได้และให้ผู้ใช้ยืนยันถ้อยคำสาธารณะ ไม่ส่งข้อมูลก่อน การfilterไม่ใช่เหตุให้รับรองว่าfreeformไม่มีPII; fixtureต้องมีcanarysecretsและgatewayegressassertions

Providerrequest: `tools:[{type:'web_search',external_web_access:true,filters:{allowed_domains:policy.domains}}]`, `tool_choice:'required'`, `max_tool_calls:2`, `include:['web_search_call.action.sources']`, `store:false`; topicไม่มีdomainpolicyไม่เปิด Search+openรวมกัน≤2hostedcallsในresponseเดียว ไม่ใช้2search+3openแยกquotaอีกต่อไป Max source facts 5/output 4096 tokens ภายใต้ immutable profile/request budget; public ทั้ง turn ไม่เกิน 4 provider dispatches รวม intake/lookup/composer/repair และ hosted lookup เรียกได้ครั้งเดียวไม่มี retry; externalunitsreserve2และsettleactualunits+tokensด้วยpinnedtariff Usageunknownคงholdpendingreconciliationไม่free ตั้งproviderAbortเมื่อremainingdeadlineเหลือdeliveryreserve

Responsestool supports domainfilter/source list; `max_tool_calls` boundsbuiltintoolcalls ตาม [official web search guide](https://developers.openai.com/api/docs/guides/tools-web-search) และ [Responses create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) นี่เป็นadapterdesign ไม่ใช่หลักฐานvendorapprovedในenvironmentเรา

NormalizeเฉพาะproviderreturnedURLcitationsกับsupportinganswersegments/sourceactionsเป็น records `{id,url,title,publisher,publishedAt?,retrievedAt,supportingText,contentHash}`; source listหรือsnippetอย่างเดียวไม่พอให้claimverified ถ้าproviderไม่มีreadsupport mark `UNVERIFIED_SOURCE` ไม่mintquote/rawpagecontentเอง URLmustpublicHTTPS ไม่มีuserinfo/privatehost/IPliteral/metadata/internal URL ไม่serverfetch arbitraryURLs/redirectเองในรุ่นนี้; user URLนอกdomainpolicy→dated/generalanswerหรือบอกยังตรวจไม่ได้

Output status verified/partial/conflict/unavailable พร้อมclaim→sourceIds; citationใกล้claim, asOfแยกeffective date; news5min/docs24h/dynamic60scacheceilingsตามparent แต่“ล่าสุด”revalidatein-turn Topicไม่มีfreshnesspolicyไม่claimcurrent Externalpageinstructionเป็นuntrustedcontent ไม่มีtoolauthority Cacheไม่มีprivatedata; keypolicy/model/query/timewindow/sourcehashและboundedTTL

## 9. Preferences: executable R3 storage

เลือกเพิ่ม fieldsบนv2 `AiConversation` ตามparent: `preferenceJson`, `preferenceVersion` default0, `preferenceExpiresAt`; ไม่reuse AI opt-in booleanเพราะคนละข้อมูล Allowlistexact `{language:'th'|'en', detail:'short'|'normal'|'detailed', presentation:'prose'|'bullets'|'table'|'steps'}` ≤1KiB พร้อมperfieldsourceRequestId/confirmedAt/expiresAt ไม่มี arbitrarymemo

APIcommands list/set/deleteในconversationcontextservice: fullowner1:1only, expectedPreferenceVersion + lifecycleEpoch, idempotentrequestId, CASupdate≤1retry; currentturninstructionชนะstoredvalue Explicit “จำไว้ว่าชอบสั้น” setได้ ไม่ต้องถามconfirmซ้ำ; “ตอบสั้นหน่อย” currentturnเท่านั้น ไม่autostore Ambiguousdurableintentถามหนึ่งครั้ง อ่านไม่ต่อexpiry90days; expiredrowคืนemptyแล้วlazycleanup

Deleteone/all clearvalueทันทีและincrementversion; invalidatecontext/cacheก่อนตอบสำเร็จ oldproposalreplay witholdversion/epochreject, no upsertresurrection Audit operation+fieldnames+hashไม่มีdeletedvalues DBunavailableไม่อ้างว่าจำ/ลืมสำเร็จ sessioninstructionยังใช้ได้ Privacytextบอกscope/expiry/list/deleteก่อนเปิดR3 ไม่มีinferredfinancial/personalityprofile

> **2026-09-30 note (NAT11 real-model re-test, Owner "แก้ให้ผ่านเลย"):** only the exact command words ("จำไว้ว่าชอบสั้น", "จำอะไรไว้บ้าง", "ลืมรูปแบบคำตอบทั้งหมด") reached these commands, so natural requests ("ต่อไปตอบสั้น ๆ แบบนี้นะ จำไว้ได้มั้ย", "ตอนนี้จำอะไรเกี่ยวกับวิธีตอบฉันอยู่บ้าง", "ลืมเรื่องตอบสั้นไปก่อน") were answered by the composer, which promised to remember and stored nothing. The intake router of a bound 1:1 chat (trusted capability `responsePreference`, never a group) may now name the request as `responsePreference` {list | set allowlisted values | delete keys or all}; the API re-parses it (`parseLineAiResponsePreferenceCommand`) and runs the same list/set/delete commands, replying only with what storage confirmed. It runs only when the message asks nothing else (every clause general/help); a one-turn style beside a business question ("แต่อันเมื่อกี้ขอละเอียดหน่อย ทำไมยอดเพิ่ม") keeps its normal turn and stores nothing. Forgetting a value that is not stored writes nothing and says so. Delete no longer clears the chat's task state (spec §17.2: preference revision is separate from task state; NAT11 turn 5 must not drop open work); the preference version bump is the invalidation.

## 10. Implementation seams, checks และ migration order

แก้ existing filesตามownership: contracts → API ERP tool use cases/query repositories/context service → Gateway intake/planner/formatter → API dispatch/render/delivery integration ไม่ย้าย domainlogicเข้าGateway Newfilesเฉพาะpurefact/queryhelpers, contextrepository, QAjobrepository/readeradapter, approvedpackloader/publicadapterและfocusedtestsที่หาextensionเดิมไม่ได้

DB migrations additive: contextbinding/epoch/indexes→pendingmediabinding→QAjob→preferences; business/deliverytablesอยู่appendicesของตน Deploy schema/readers beforewriters; v2 negotiationoffจนallhopsพร้อม Oldwriterไม่touchnewboundstate, readersv1ไม่loadv2namespace Rollbackdisablev2admissionก่อน, drainretainedjobs/commitsด้วยcompatibleworker, keepcolumns/indexes/receipts ไม่drop/downgradeparserขณะที่มีnewjobs

Focusedchecks (เพิ่มcasesในไฟล์existing; newQA/context/public/preference suitesใช้same `tsx --test` pattern):

```sh
pnpm --filter @watchdog-bms/contracts exec tsx --test src/line-ai-prepared-plan.spec.ts src/line-ai-advisor-answer.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/line-intake-router.agent.spec.ts src/modules/line-ai/agents/line-ai-business-query-regression.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-procurement-ledger-tools.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.spec.ts
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/api typecheck
```

เพิ่ม actualPG testsสำหรับcontextCAS/lifecycle/aggregateconcurrency/QAdedupe/preferenceexpiry; realAPI+Gatewaytestsด้วยsyntheticcompany/branches/roles; provider-backedlanguage/image/pack/publicfixtureและLINEdeliveredjourneysอยู่implementationindex Unitmock/sourceprobeไม่พิสูจน์naturallanguagequality, toolMapDIไม่พิสูจน์data correct, routerevalไม่พิสูจน์mutationcommit เงื่อนไขเหล่านี้เป็นreleasegatesที่ลงโค้ดได้ทันที ไม่ใช่ประเด็นออกแบบที่ให้implementerเลือกใหม่
