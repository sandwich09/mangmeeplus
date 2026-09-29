# Contract: AI มั่งมีสร้างและแก้เอกสารธุรกิจผ่าน LINE

Status: implementation contract; **ยังไม่ใช่ implementation หรือหลักฐาน release**\
Version: 1.0 — normative appendix ของ understanding/advisor spec v2.4\
Date: 2026-09-27\
Baseline: `f932b57766f5dd22c0d28aedd4bc06f210e374ef`; ตรวจด้วย `git show` และเทียบ working tree โดยไม่แก้ source\
Scope: รายการรายจ่าย, ใบรับรองแทนใบเสร็จรับเงิน, ใบเบิก **DRAFT create/update**; employee LINE OA แบบ 1:1 เท่านั้น

เอกสารนี้ตัดสิน contract ที่ต้องใช้เขียนโค้ด ไม่เพิ่ม autonomous submit/certify/approve/pay/post, group/room writer, CRM OA writer, voice หรือ financial profile. คำว่า ticket ในงานนี้หมายถึงเอกสารธุรกิจ ไม่ใช่ support ticket. ใช้ร่วมกับ [spec หลัก](mangmee-ai-understanding-and-advisor-reliability-spec-th.md) §16/19.6, [plan](../plans/mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md) และ [input/budget appendix](mangmee-ai-input-provider-budget-contract-2026-09-27.md). หากตาราง capability กว้างกว่า operation matrix ด้านล่าง ให้ใช้ matrix นี้สำหรับ financial write.

## 1. ของเดิมที่ต้อง reuse และส่วนที่จะเพิ่ม

| พื้นฐานใน pinned source | สิ่งที่ reuse / ต้องเปลี่ยน |
|---|---|
| `expenses/application/use-cases/line-draft-update.use-case.ts:143–255,296–457` | Preview จาก domain calculation เดียวกับ apply, record guards, exact previewId, CAS, duplicate reconciliation, audit, vendor/counterparty หลัง commit และ final revision proof มีแล้ว; เปลี่ยนหลักฐานจาก prefix text เป็น evidence contract ที่ครบ |
| `expenses/application/services/line-draft-preview.store.ts:29–47,128` | TTL preview 600s, claim 1,800s, applied cache 120s และ exact-preview claim มีแล้ว; cache ไม่ใช่สิทธิ์สร้างซ้ำเมื่อผล apply ไม่ทราบ |
| `expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts:1725–1828,2137–2230` | Continuation/accepted fields, preflight, explicit ISSUE/FORM, review → prepare → reserve document number โดย workflowId, แล้วไป web ลงนาม/อนุมัติ; semantic proposal ไม่สร้าง authority ใหม่ |
| `reimbursements/application/use-cases/reimbursement-request.use-case.ts:117–225` | Create/update domain rules, requester/branch/evidence validation, derive header from lines; เพิ่ม expected revision ของ preview และ transactional action receipt |
| `reimbursements/infrastructure/prisma-reimbursement.repository.ts:352–427` | Create transaction, source checks, request lock, draft CAS, full line replacement และ signature invalidation; reuse ผ่าน transaction-aware methods ห้าม copy rules ไป gateway |
| `reimbursements/presentation/http/reimbursement.dtos.ts:30–62` | Field limits ที่เว็บใช้; LINE ต้อง validate runtime เช่นเดียวกัน ไม่พึ่ง TypeScript type |
| `line-ai/application/use-cases/process-line-webhook.use-case.ts:4938–5030` | ใบเบิกเดิมเป็น clarification/handoff; ไม่อ้างว่ามี LINE writer แล้ว |
| `employee-access/domain/logic/feature-gate.logic.ts:75–91` | Feature off strip create/submit/update-own แต่ retain finance-review และงาน in-flight; gate ต้องพิจารณา operation + effective permissions จริง |

Paths ในตารางนี้ relative ต่อ `apps/api/src/modules/`. `packages/contracts/src/ai-tools.ts:116–120` deliberately ไม่ gate reimbursement read tools ทั้ง module. `ReimbursementsModule` ต้อง export use cases ที่ internal adapter ใช้จริง พร้อม built-image DI check.

Working tree ที่ตรวจ: expense preview/apply/store/correction ข้างต้นตรงกับ pinned f932 แม้ `git status` เทียบ local HEAD จะแสดง dirty; **ไม่จัด PR819 vendor autosave เป็นงานใหม่**. `packages/contracts/src/expenses.ts` ใน working tree ขาด WHT fields บางตัวจาก pinned source; งานนี้ไม่ลบ/ย้อน/สร้าง fields เหล่านั้นเอง ให้ integrate จาก accepted branch ก่อนทำ implementation.

## 2. Operation × state × authority

| Operation ที่แสดงใน capability manifest | State ที่อนุญาต | Authority / ผลที่รับรอง |
|---|---|---|
| `expense.capture` | ยังไม่มี record; explicit capture intent | Reuse text/image/PDF capture + duplicate/idempotency/receipt quota เดิม; ผลเป็น draft/review state ที่ domain คืนจริง การส่งรูปพร้อมคำถามอย่างเดียวไม่ใช่คำสั่ง capture |
| `expense.draft.set_header` | DRAFT / NEEDS_REVIEW / READY_FOR_CONFIRMATION | expenseDate, vendorName, documentNumber, noteAppend; model สร้าง preview เท่านั้น, actor กด exact confirm เพื่อ apply |
| `expense.draft.set_line` | เช่นเดียวกัน | description, amount, vatTreatment, chargeKind ของหนึ่งแถว; ถ้าไม่บอกแถวและมีหลายแถวต้องถาม |
| `expense.draft.add_charge/remove_line/set_vat_mode` | เช่นเดียวกัน | รูปแบบ patch เดิม; คำนวณด้วย domain Decimal/VAT logic, add charge ที่มีอยู่ต้องเสนอย้าย/แก้แทนคิดซ้ำ |
| `substitute.collect/update_fields/pause/resume/cancel_collection` | OPEN / PAUSED continuation ของ source expense ที่ยัง eligible | เปลี่ยน accepted facts/continuation เท่านั้น ยกเว้น explicit existing category workflow ที่ตรวจสิทธิ์และ CAS อยู่แล้ว; ไม่ถือยอดใน continuation ว่าแก้ expense สำเร็จ |
| `substitute.prepare` | OPEN, preflight ครบ, pending ISSUE/FORM ของ revision ปัจจุบัน | Reuse review + prepare; reserve number once ต่อ workflowId; แสดง “เตรียมแล้ว รอลงนาม” ไม่ใช่ “ออกแล้ว” |
| `substitute.amend_prepared/correct_signed/certify/approve` | ตาม web domain เดิม | LINE อธิบายและเปิด authorized exact web route; ไม่เพิ่ม LINE writer ใน appendix นี้ |
| `reimbursement.draft.preview_create` → confirm | ยังไม่มี request;ครบ required fields | ใหม่ใน R2: สร้างเพียง DRAFT; requester/branch/evidence ผ่าน domain; actionId เดิมสร้างได้ไม่เกินหนึ่ง record |
| `reimbursement.draft.preview_update` → confirm | DRAFT เท่านั้น | ใหม่ใน R2: แก้ allowed header/lines ของ record ที่ resolve แล้ว ด้วย expected revision จาก preview |
| Reimbursement update เมื่อ PENDING_APPROVAL / APPROVED / REJECTED / CANCELLED / FINANCE_REVIEW / READY_FOR_PAYMENT / PARTIALLY_PAID / PAID / VOIDED | ไม่อนุญาต LINE draft writer | แจ้งสถานะจริงและ authorized domain/web action; ไม่ reopen/withdraw/cancel request อัตโนมัติเพื่อให้แก้ได้ |
| Reimbursement submit/reopen/withdraw/approve/reject/finance/pay/post/sign | ทุก state | ไม่ใช่ tools ของงานนี้; existing web workflow และ read/queue tools คงอยู่ |

`cancel_collection` หรือ cancel preview ไม่ใช่ void/cancel เอกสารที่บันทึกแล้ว. คำถาม “แก้ได้ไหม” เป็น read-only capability query; “อย่าเพิ่งแก้ แค่อธิบาย” ห้ามสร้าง preview หรือ write. การขอหลายเอกสารทำแยก action และรายงานผลแยก ไม่มี batch atomicity ใหม่.

ขอบเขต field ของ expense LINE เป็นห้า patch types เดิมเท่านั้น ไม่เปิดทุก field ของ web PATCH; header vendor ≤200, documentNumber ≤60, line description ≤200, noteAppend และ note รวมหลัง append ≤500 UTF-16 units, lineNumber 1..200. ตัวเลขเป็น decimal string ตาม existing parser/domain; percentage (0,100]. เกิน limit คืน `field_too_long` พร้อม field/limit ห้าม `.slice()` แล้วรับสำเร็จ. ค่า enum จาก contracts เดิม ไม่ให้ model สร้าง enum/tax code/บัญชีใหม่.

## 3. Trusted owner, target resolution และ input provenance

API derive owner จาก webhook ที่ตรวจ signature/LINE identity แล้ว: `{companyId, actorUserId, membershipId, channel:'line', messagingChannelId, channelKind:'USER', chatKeyHash, ownerEpoch}`. `ownerEpoch` ใช้ identity/access invalidation ตาม spec หลัก; hash ไม่แทนการตรวจ active identity/membership/branch. ไม่มี owner field ที่ model ส่งแล้ว override ได้. CRM/group/room/unknown channel ต้องไม่โหลด private target/proposal. Actor finance ที่ทำแทน requester ต้องยังอยู่ employee 1:1 เดิม; owner ของ action คือ actor ไม่ใช่ requester.

Wire mapping ให้ตรง [core contract](mangmee-ai-core-capability-contract-2026-09-27.md) §3 และ [delivery contract](mangmee-ai-reliability-delivery-contract-2026-09-27.md): `actorUserId = userId`, `ownerEpoch = AiConversation.lifecycleEpoch`, `channel = AiConversation.channel` คือ transport `'line'`, และ `channelKind = AiConversation.channelKind` คือ USER ใน scope นี้ (เป็นคนละ field). Use deterministic bound conversation ID ตาม core และ compare full owner รวม transport + channel kind + current lifecycleEpoch; เป็น alias ของ authority เดียว ไม่เพิ่ม epoch counter หรือ conversation ownership ชุดใหม่. API-owned action key ต้องออกจาก accepted task intent ก่อนเรียก model และอยู่รอดใน ledger/recovery locator; model output/retry/ข้อความว่า “ลองอีกครั้ง” ห้าม mint key ใหม่.

Target selector เป็น `{kind:'active_task',taskId}` หรือ `{kind:'offered_choice',choiceId}` ที่ API ออกให้ owner นี้ หรือ document reference ที่ API resolve โดย current permission. Model เสนอข้อความอ้างอิงได้ แต่ไม่ mint expenseId/requestId/attachmentId/categoryId/userId. Existing scoped read record ที่คืน ID แล้วใช้เป็น locatorได้ แต่ API reauthorize และเทียบ type/state ทุกครั้ง. ไม่เลือก newest ข้าม document type; พบ 2 candidates ถามเลือก, พบ 0 ไม่สร้างใหม่แทน update. Choice มี TTL 600s และผูก source revision; stale choice re-resolve ก่อน preview.

ทุก field proposal ต้องมี typed provenance:

```ts
type InputSourceRef = {
  partId: string; startUtf16: number; endUtf16: number; rawSha256: string;
}; // half-open span ของ original message part ตาม InputEvidenceV2
type FieldProof =
  | { kind: 'USER_TEXT'; refs: InputSourceRef[]; candidateId?: string }
  | { kind: 'RECORD'; recordRef: string; revision: string; fieldPath: string }
  | { kind: 'ATTACHMENT'; attachmentRef: string; revision: string;
      page: number; extractionRef: string; fieldPath: string }
  | { kind: 'USER_CHOICE'; choiceId: string; choiceRevision: string }
  | { kind: 'SERVER_DEFAULT'; key: 'ACTOR_AS_REQUESTER' | 'COMPANY_CURRENCY' };
type ProposedValue<T> = { value: T; proof: FieldProof };
```

ชื่อ `InputSourceRef` ป้องกันชนกับ existing `SourceRef` ของ read-tool citations; อย่าเปลี่ยน global citation type. Source/candidate/choice/extraction refs เป็น API-issued locators; fieldPath ต้องอยู่ allowlist ของแต่ละ document. USER_TEXT refs 1..8 ต่อ field, substring/digest ต้องตรง original part; stringหลาย spansประกอบได้เฉพาะตามลำดับต้นทางด้วย newlineที่แสดงใน preview ห้าม model เขียน fact ใหม่เอง. Amount/date ต้องเลือก deterministic candidateId ที่ผูก span/canonical reading; numeric record copy ต้อง cite exact record field; arithmetic เช่น total/percentage เป็น server computation ไม่ใช่ model proof.

ใช้ InputEvidenceV2 เดียวกับ semantic/intake: ≤20 original parts, ≤12,000 UTF-16 units และ ≤48,000 UTF-8 bytes; candidate envelope exhaustive ≤128 amounts/64 dates/32 periods และ serialized ≤48KiB (49,152 bytes), candidate IDs เป็น full SHA-256. Preserve case/newlines, ห้ามใช้ normalized/groundingText prefix เป็น sole evidence. Overflow คืน `evidence_overflow` ก่อน financial dispatch; ไม่ execute prefixหรือ ignore fieldท้ายข้อความ. Dateอิง Bangkok + acceptedAt ของข้อความต้นทาง; ambiguous date/currency/payer/from→to ต้องถาม ไม่ autocorrect ตัวเลข/วันที่/ผู้จ่าย.

Semantic extraction เป็นผู้เสนอ field แม้ไม่มี label หรือประโยคมีคำถามแทรก; deterministic validation ตรวจ span/type/enum/current record/negation/permission. ยกเลิก whole-line question veto และ “ไม่มี label จึงไม่รับ” แต่ไม่ยกเลิก grounding. ตัวอย่าง “ใช้ส่งของให้ลูกค้า ร้านสมใจรับเงิน แล้วทำต่อยังไง” รับ businessPurpose/payeeName ที่พิสูจน์ได้พร้อมตอบคำถาม; “ไม่ใช่สมชาย จ่ายให้สมใจ” ห้ามรับชื่อจาก negated span. หาก field conflict ถามเฉพาะ field นั้นและรักษา accepted fields อื่น; **ไม่มี partial financial apply**.

## 4. สัญญาใบเบิกใหม่: command และ fields

เพิ่ม contracts/runtime validators ใน `packages/contracts/src/reimbursements.ts` และ internal API DTO โดยใช้ domain input เดิม; ไม่สร้าง universal financial-command framework. Tools ให้ model เรียกได้เพียง `reimbursement.draft.preview_create`, `reimbursement.draft.preview_update` และ bounded scoped `reimbursement.draft.get_options` เพื่อเลือก requester/branch/category/source expense. Options มีอย่างละไม่เกิน 20 choices ต่อ responseพร้อม continuation/query เมื่อเกิน; ไม่เท่ากับเลือก 20 รายการแรกเป็นคำตอบทั้งหมด. Scope permission predicate ของ optionsเหมือน `ListReimbursementSourcesUseCase` เดิม; descriptions/IDs ของคนอื่นไม่ออกถ้าไม่มี finance-review.

Category catalog ของ manual claim ให้ย้ายรายการที่เว็บมีอยู่ (`ReimbursementCreatePage.tsx:21–27`) ไป shared contracts constant โดยไม่เปลี่ยน taxonomy: `travel` เดินทาง, `meals` อาหาร, `supplies` วัสดุอุปกรณ์, `accommodation` ที่พัก, `other` อื่น ๆ. Web และ LINE อ่าน constant เดียวกัน; API ออก choice IDs จาก catalog นี้. Linked source line ใช้ category จาก validated source snapshot แม้เป็น key อื่น และรักษาค่านั้นเมื่อไม่ได้แก้; ห้ามเอา catalog ใหม่ไป reject historical source rows.

```ts
type ReimbursementDraftProposalV1 = {
  schemaVersion: 1;
  taskId: string; taskRevision: number; // API context reference, not authority
  operation: 'CREATE' | 'UPDATE';
  targetRef?: string; // UPDATE only; scoped API locator
  fields: {
    title?: ProposedValue<string>;
    reason?: ProposedValue<string>;
    missingReceiptReason?: ProposedValue<string | null>;
  };
  requesterChoiceId?: string; branchChoiceId?: string; // CREATE only
  lineChanges?: Array<
    | { operation: 'ADD'; values: ProposedClaimLine }
    | { operation: 'SET'; lineRef: string; values: Partial<ProposedClaimLine> }
    | { operation: 'REMOVE'; lineRef: string }
  >;
};
// ProposedClaimLine field names match ReimbursementLineInput. All user-set values
// have ProposedValue<T>; IDs are opaque choices; sourceExpenseUpdatedAt is API-owned.
```

LINE proposal ใช้ changes เพื่อไม่ให้ model ต้อง echo lines ทั้งใบ แต่ API hydrate complete current rows แล้วสร้าง **full replacement** แบบ domain เดิม. Max 50 lineChanges / 50 resulting lines; CREATE ใช้ ADD เท่านั้น. lineRef ออกโดย API จาก `{requestId,lineId,lineNo,revision}`; ไม่มีการจับแถวด้วยลำดับหลัง remove ที่เปลี่ยนแล้ว. Deny duplicate/conflicting changes ต่อ lineRef ใน proposalเดียว, dense lineNo 1..N สร้างโดย APIหลัง resolve; ADD orderตาม input. SET ต้องมีอย่างน้อยหนึ่ง field; untouched fields/attachments/source snapshotsคงเดิม. REMOVE ต้องแสดงแถวที่จะลบใน previewและ explicit user proof; เหลือ 0 lines ไม่อนุญาต.

| Field | Required / fixed limits / semantics |
|---|---|
| requester, branch | CREATE: requester default actor; finance may choose active same-company/branch memberผ่าน options. Unique authorized branchจึงเลือกได้เอง; หลายสาขาถาม. UPDATE ไม่เปลี่ยน requester/branch ผ่าน LINE |
| title / reason / missingReceiptReason | title ≤200 optional; reason 1..1,000 requiredก่อน preview CREATE; missingReceiptReason ≤500 optional, explicit null clears. UPDATE omitted preserves. title empty stringclears; reason cannotclear |
| currency | CREATE จาก current company reimbursement policy; show in preview. UPDATE preserve. Explicit currencyอื่นที่ policyไม่ตรงให้แจ้ง/ใช้เว็บ; ไม่แปลงสกุลเงินเอง |
| description / purpose | description 1..500 required; purpose ≤500 optional. Optional purpose clearด้วย empty string. เกินlimitถามย่อ/ให้ผู้ใช้ยืนยันข้อความย่อใหม่ ห้ามเงียบตัด |
| incurredDate | valid civil `YYYY-MM-DD`; deterministic source/date option; domain `reimbursementIncurredDateError` ยังตัดสิน future/invalid dates |
| category | categoryKey 1..80 + server label≤160 จาก current allowed options; ไม่มี free-form category keyจากmodel และไม่เดาหมวดเพื่อให้ required fieldsครบ |
| amount | positive decimal string `^\d{1,14}(?:\.\d{1,4})?$`; reuse `normalizeReimbursementAmount`, domain max line/total `99999999999999.99`; previewใช้ค่าหลัง domain normalization แต่ลูกค้าเห็นเป็นบาทสองตำแหน่งพร้อมคั่นหลักพัน เช่น `1,234.50 บาท` ไม่ใช่ทศนิยมสี่ตำแหน่งที่เก็บ (Owner rule 2026-09-27/29, §5.1). ห้าม `Number` floating pointเป็นยอดคำนวณ |
| attachment / linked expense | อย่างละหนึ่ง optionalต่อ lineตาม domain input; choiceID resolveเป็นID≤64; explicit null detaches; source expense revision/snapshotและattachment snapshot APIอ่านเอง |
| aggregate fields | amount/category/date headers/receiptRequirementStatus สร้างด้วย `deriveHeaderFromLines`/`computeReceiptRequirement`; modelส่งไม่ได้ |

Proposal JSON ≤128KiB; reject oversize whole proposal. Required fieldยังไม่ครบให้ `needs_fields` พร้อม field pathsและaccepted context, ไม่สร้าง placeholder request. Partial accepted fields เก็บใน action row สถานะ COLLECTING ตาม §6; task projection ≤16KiB เก็บเพียง locator/revision/ช่องที่ขาด ไม่ยัดทุก line เข้า model. Source spans ต้อง validate ก่อนบันทึกเป็น accepted fields พร้อม API validation receipt `{fieldPath,valueDigest,proof,validatedAt}`; เมื่อ original event หมด retention ใช้ accepted receipt ที่ API บันทึกเอง ไม่ยอมรับ model ส่ง receipt ใหม่. ถ้าหลักฐานเดิมยังไม่เคย validate และหายแล้วต้องถามซ้ำเฉพาะ field นั้น. Draft saveยอม missing receiptตาม policyเดิมและบอกสถานะ `REQUIRED` เป็นประโยคไทย (“ยังขาดใบเสร็จบางรายการ”) ไม่พิมพ์ค่า enum (§5.1); ไม่แสร้งว่าพร้อม submit.

## 5. Preview และ confirmation

API proposal pipeline: current owner/access → feature/action gate → target/options resolve → field/source validation → hydrate complete candidate → reuse domain validate/resolveSourceLines/evidence/derive-header → create preview. No request/line/signature/document-number mutationระหว่างpreview. ให้แยก domain prepare/validate function ที่เรียกทั้ง preview/applyหรือใช้ existing transaction dry-run pattern; ห้ามจำลองราคา/ยอดอีกสูตรหนึ่งใน LINE formatter. Validationที่ต้องอ่านDBอ่านผ่าน domain API/repoฝั่งERPเท่านั้น.

`ReimbursementDraftPreviewV1` มี `{schemaVersion:1, actionId, previewRevision, operation, expiresAt, expectedRequestUpdatedAt?, targetRef?, before?, after, diff[], warnings[], confirmationDigest}`. `after` เป็น domain result snapshotที่ใช้ยืนยันจริง; include requester,branch,currency,ทุก resulting line, preserved/detached evidence, total, DRAFT, missing receipt/signature impact. Branch มี `branchId` สำหรับ authority และ `branchName` (optional, อ่านจาก branch ของบริษัทตอนสร้าง preview) สำหรับแสดงผลเท่านั้น; `branchName` ไม่อยู่ใน command จึงไม่ทำให้ preview stale. Digest SHA-256 จาก canonical serialized command + owner binding + all source revisions + expected request revision + normalized after snapshot; ไม่hashเฉพาะคำสรุป.

Previewอายุ600s ไม่ต่ออายุโดยretry. แก้proposalเดิมสร้าง `previewRevision + 1`, digest/expiryใหม่, old button invalid. ใช้หนึ่ง active financial previewต่อ owner เช่น existing expense UX; การส่งgeneral side questionไม่supersede preview. หากจะเริ่มอีก financial previewถาม replace/cancelก่อน; ไม่ล้าง PendingMedia/intake/jobหรือ completed receipt.

Postback `{action:'reimbursement_draft_confirm'|'reimbursement_draft_cancel',actionId,previewRevision,confirmationDigest}` ไม่มี editable fields/record IDsในpayload. Exact current owner + preview match mandatory. ไม่มี tool `apply` ให้ model, การตอบ “โอเค” ใน general chatไม่apply. หาก text “ยืนยัน” ต้อง render exact current cardให้กด; ไม่ parse free textไป mutation. Apply/cancel/recovery เป็น deterministic zero-model API handlers.

ก่อนเปิดปุ่ม confirm ต้องส่ง previewครบเป็น bounded messagesที่มี actionId/part order หรือ authorized read-only preview page; ถ้า multipartไม่ครบ/UNKNOWN ให้ปิด confirmด้วย `preview_not_fully_delivered`. เพื่อไม่บังคับรับรองจาก clipped card: LINE-only confirmationอนุญาตเมื่อ diffที่เขียนและ resulting totalครบใน≤5 messages แต่ละ text≤4,500 UTF-16. ใบใหญ่ใช้ exact preview pageที่auth/revalidateownerและแสดงfull resultพร้อมconfirm same action; endpointใหม่มีroute `/companies/:companyId/reimbursements/draft-actions/:actionId`,ไม่มีpublic bearer URL. Versioned delivery contractของspecหลักเป็น authorityเรื่องUNKNOWN/ACCEPTED; preview deliveryไม่ใช่ businesscommit.

HTTP surface ของหน้า preview: `GET /companies/:companyId/reimbursements/draft-actions/:actionId` คืน exact preview + revision/digest/expiry หลัง full-owner authorization; `POST .../:actionId/confirm` และ `POST .../:actionId/cancel` รับเพียง `{previewRevision,confirmationDigest}` พร้อม existing authenticated session/LINE handoff context. GET ไม่เปลี่ยน financial state; POST ใช้ domain handler เดียวกับ LINE postback. Web-render receipt ผูก action revision/digest ที่ผู้ใช้เปิดจริงก่อน confirm; ไม่มี model-tool route ไป POST เหล่านี้. Controller ใช้ current operation predicate ตาม §8 ไม่บังคับ create permission กับ UPDATE ทุกกรณี. Reuse existing web auth/CSRF/handoff controls.

**หมายเหตุ 2026-09-30 (NAT04 ใบเบิกจากบิลที่ส่งไว้):** แก้จากผลโมเดลจริง ไม่เปลี่ยนสัญญาเดิม

- **อ่านร่างกลับแล้วไม่ "เปลี่ยนไปแล้ว":** `get` เตรียม command ใหม่แล้วเทียบกับ command ที่เก็บ แต่เทียบของสดกับ JSON ที่เก็บไว้ บรรทัดที่ไม่มีไฟล์ใบเสร็จ (เบิกจากบิลที่บันทึกไว้) มี `attachmentSnapshot: undefined` ซึ่ง JSON ไม่มี จึงเป็น stale ทุกครั้งที่แชตแสดงร่าง ตอนนี้เทียบในรูป JSON แบบเดียวกับที่ `preview` บันทึก
- **รายการบิลถึงผู้ใช้:** `readDisplayOptions` ตรวจซ้ำและแสดงเฉพาะบิลที่เบิกได้ (`eligible`) บิลที่เบิกไม่ได้เคยทำให้การตรวจซ้ำล้มแล้วซ่อนทั้งรายการ; รายการแสดงร้าน วันที่แบบไทย และยอด
- **คำถาม "เบิกใบไหน" มาพร้อมรายการ:** เมื่อ planner ถามก่อนเรียก options gateway เรียก `reimbursement.draft.get_options` (อ่านอย่างเดียว) ให้ API พิมพ์รายการบิลคู่กับคำถาม และไม่เรียก planning รอบสอง
- **locator และ span มาจากระบบ ไม่ให้โมเดลจำหรือนับ:** gateway คง `taskId`/`actionId` ของ get_options เฉพาะค่าที่ API ออกให้ (locator ของ turn นี้ หรือ action ที่ task จำไว้) — `taskRef` ของบทสนทนาไม่ใช่ task ของร่าง; preview ใช้ locator และ task revision จาก get_options ของ turn เดียวกัน และคำของผู้ใช้ (`fields.reason` ฯลฯ) ได้ span ที่ตรงตัวครั้งเดียวในข้อความ ตามกฎ quote ของ compact decoder; API ยังตรวจ id ค่า และ proof ทุกตัวเหมือนเดิม
- **ต่อคำขอเบิกข้าม turn:** turn ที่ router ต่อ task เดิม (`taskRef`) ใช้ action ที่ task นั้นจำไว้ (`reimbursementActionId*`) ได้ แทนการปฏิเสธเป็น `FINANCIAL_ACTION_SELECTION_REQUIRED`; สาขาเริ่มต้นเลือกด้วยกฎสาขาสมาชิกเดียวกับ LINE capture และยังเปลี่ยนได้
- **router:** คำถามว่าบิลที่ผู้ใช้จ่ายเองเบิกได้ไหม อ่าน `reimbursement.get_summary` ไม่ใช่ความรู้ทั่วไป; ข้อความถัดไปที่ชี้บิล ("บิลร้าน X ที่ส่งไว้") ต่อคำขอเบิกเดิมแม้ไม่มีคำกริยา

### 5.1 ข้อความที่ลูกค้าเห็น (Owner rule 2026-09-27/29)

Owner rule: ข้อความถึงลูกค้าและ UI ใช้ภาษาไทยธรรมดา **ห้ามมี machine token** — id, enum key, รหัสสถานะภายใน, error code, field path, raw JSON หรือทศนิยมเกินจำเป็น. กฎนี้แทนข้อความเดิมในเอกสารนี้ที่ให้การ์ดแสดง “ค่าตรงตัว”: ความถูกต้องยังอยู่ที่ domain snapshot/digest/postback เดิม และยอดเงินยังตรงถึงสตางค์. การ์ด LINE ของร่างใบเบิก (`line-reimbursement-draft-card.logic.ts`) แสดงดังนี้:

| ข้อมูล | ลูกค้าเห็น |
|---|---|
| สาขา | ชื่อสาขา (`branchName`); preview เก่าที่ไม่มีชื่อให้ละบรรทัดสาขา ไม่พิมพ์ id |
| สถานะ | ป้ายไทย เช่น DRAFT → “ร่าง”, PENDING_APPROVAL → “รออนุมัติ” |
| หลักฐานต่อรายการ | รายการมีไฟล์ของตัวเอง → “มีไฟล์แนบ”; เบิกบิลที่บันทึกไว้โดยไม่มีไฟล์ของรายการ → “ใช้ใบเสร็จจากบิลต้นทาง”; ไม่มีทั้งสองอย่าง → “ยังไม่มีไฟล์แนบ”. ใช้เกณฑ์เดียวกับ receiptRequirementStatus (`isLineEvidenced`) จึงไม่มีรายการที่บอกว่ายังไม่มีไฟล์ขณะสถานะบอกว่าหลักฐานครบ (2026-09-30); diff ใช้ป้าย “หลักฐาน รายการที่ N”; เปลี่ยนไฟล์ → “เปลี่ยนเป็นไฟล์ใหม่” |
| บิลต้นทาง | เลขที่เอกสาร · ชื่อร้าน · วันที่ จาก source snapshot; ไม่มีข้อมูลให้ “บิลที่เลือกไว้”; ไม่ผูกบิลให้ละไว้ |
| receiptRequirementStatus | ประโยคไทย เช่น REQUIRED → “ยังขาดใบเสร็จบางรายการ” |
| หมวด | ป้ายหมวดภาษาไทยเท่านั้น; ไม่มีป้ายให้ “ยังไม่ได้เลือกหมวด” (ไม่ fallback เป็น categoryKey) |
| ยอดเงิน | `1,234.50 บาท` (ปัดครึ่งขึ้นที่สตางค์ด้วย `normalizeReimbursementAmount`) |
| วันที่ | รูปแบบ พ.ศ. เช่น “27 ก.ย. 2569” |
| diff (UPDATE) | ป้ายไทย + ค่าเก่า → ค่าใหม่ที่จัดรูปแบบแล้ว เช่น “ยอดเงิน รายการที่ 1: 300.00 → 350.00 บาท”, “เพิ่มรายการที่ 3: …”, “ลบรายการที่ 2: …”; การเปลี่ยนลายเซ็นบอกด้วยประโยคลายเซ็นประโยคเดียว; fieldPath ที่ไม่รู้จักแสดง “ข้อมูลอื่นในใบเบิกมีการเปลี่ยนแปลง” |
| warnings | ประโยคไทยต่อรหัส (`missing_receipt`), รหัสที่ไม่รู้จักใช้ประโยคกลาง |
| ปุ่มยืนยัน | “บันทึกเป็นร่าง” / “ยกเลิกร่างนี้” |

Postback data (`action`, `actionId`, `previewRevision`, `confirmationDigest`) ไม่ใช่ข้อความที่ลูกค้าอ่านจึงคงเดิม และลิงก์เว็บของ preview ใหญ่คงเดิม. ตัวเลือกบิล/รายการในใบเบิกใช้รูปแบบยอดเงินเดียวกัน. Unit test ของการ์ดตรวจว่าไม่มี cuid/uuid/hash, `DRAFT`, code ตัวพิมพ์ใหญ่, field path, snake/camelCase key, ทศนิยม ≥3 ตำแหน่ง หรือ JSON ในข้อความที่มองเห็นทุกแบบ.

หน้าเว็บ preview (`apps/web/src/features/reimbursements/ReimbursementDraftActionPage.tsx`) ใช้คำชุดเดียวกับการ์ดสำหรับ สาขา, สถานะ, หลักฐานต่อรายการ, บิลต้นทาง, receiptRequirementStatus, หมวด, ยอดเงิน, วันที่ และ warning `missing_receipt`; ข้อความหัวหน้าเป็น “ระบบจะบันทึกเป็นร่างเท่านั้น …”. ยอดเงินจัดรูปจากสตริงทศนิยมโดยตรง (ไม่ผ่าน float) ปัดครึ่งขึ้นที่สตางค์. หน้าบันทึกแล้วบอกเลขที่ใบเบิก (`requestNo`) เมื่อมี ส่วน `requestId` อยู่ในลิงก์ “เปิดใบเบิก” เท่านั้น. หน้าเว็บไม่แสดง `previewRevision` (“รุ่น N”) แต่ยังส่ง `{previewRevision,confirmationDigest}` ไปกับ confirm/cancel เหมือนเดิม. หน้าเว็บแสดงข้อมูลก่อน/หลังแก้ไขเป็นสองการ์ด รายการ “สิ่งที่จะเปลี่ยน” จึงบอกเพียงชื่อช่อง. `ReimbursementDraftActionPage.qa.spec.ts` ตรวจทุก state ของหน้าด้วยรูปแบบ machine token ชุดเดียวกับการ์ด บวกวันที่ ISO และคำว่า “รุ่น”.

## 6. Action storage, idempotency และ transaction

เพิ่ม Prisma model **`ReimbursementDraftAction`** ใน `apps/api/prisma/schema.prisma` สำหรับใบเบิกเท่านั้น; no generic event-sourced workflow. PG เป็น source of truth; Redisใช้ rate-limit/cacheได้แต่ไม่มีสิทธิ์ตัดสินว่า createสำเร็จหรือไม่.

| Column | Type / invariant |
|---|---|
| id | UUID, API random; stable business actionId; PK |
| companyId / actorUserId / membershipId / messagingChannelId | bounded existing IDs; company FK + actor referencesตามrepo deletion policy; never acceptfrommodel |
| channel / channelKind / chatKeyHash / ownerEpoch | transport `line`, kind `USER`, SHA-256 hex64, trusted epoch; full-owner equalityทุกload/write/delivery |
| taskId / actionOrdinal / intentKeyHash | taskUUID, integer≥1, SHA-256; unique `(companyId,intentKeyHash)` derived by API from owner+taskId+actionOrdinal. Sameaccepted CREATE intent/retryใช้ ordinalเดิม; userexplicitnewclaimจึง increment |
| operation / status | CREATE or UPDATE; COLLECTING / PREVIEW / APPLIED / CANCELLED / EXPIRED / STALE |
| previewRevision / requestId / expectedRequestUpdatedAt | 0 ขณะ COLLECTING, ≥1 เมื่อ PREVIEW; request nullableก่อนCREATEapply; ISO/DBtimestamprevision mandatoryforUPDATEpreview |
| commandJson / previewJson / sourceProofJson | JSONBรวม≤128KiBต่อaction; exacttypedvalues + source digests/revisions, no rawmessage/image/providerprompt. Enforce applicationvalidator+DB octet limit |
| confirmationDigest / resultJson / appliedRequestUpdatedAt | digest64 เมื่อ PREVIEW, nullable ตอน COLLECTING; receipt≤4KiB; revisionnullableก่อนapply. Result records committedrequestId/state=DRAFT/amount/currency/commit time/digest; currentstateและ `requestNo` (เมื่อมีหลัง submit) อ่านใหม่เมื่อreplay; requestIdอยู่ใน receiptเพื่อ recovery ไม่แสดงต่อลูกค้า |
| previewDeliveryId | nullable ID ของ durable delivery ที่ผูก actionId/previewRevision/digest; API ตรวจ ACCEPTED ครบทุก preview part ก่อน LINE confirm; preview page ใช้ server receipt ของ exact revision ที่แสดง |
| createdAt / updatedAt / expiresAt / appliedAt | DBtimestamps; COLLECTING expires 2h หลัง accepted update แต่ไม่เกิน createdAt+24h; PREVIEW fixed600s; appliedAtimmutable |

COLLECTING row สร้างเมื่อ API ยอมรับ explicit claim intent หลังผ่าน current owner/permission/feature gates; เก็บบาง field ได้แต่ยังไม่มี business request และไม่มี confirm button. accepted partial changes ใช้ row lock + task/action revision CAS. เมื่อครบจึง COLLECTING → PREVIEW; เปลี่ยนข้อเสนอที่ยังไม่ครบกลับ COLLECTING และ invalidate exact old preview. Expired collection ไม่ฟื้นด้วย late worker; ผู้ใช้เริ่ม/กลับทำต่อผ่าน authenticated new proposal โดยเลือก accepted facts ที่ยังเก็บได้ตาม retention อย่างชัดเจน. Context expiry ไม่ลบ row หรือ financial result.

`intentKeyHash` ไม่hashbusinessvaluesเป็นdedup: คนอาจเบิกจำนวนเดียวกันสองครั้งจริง. Accepted task intentlocatorsต้องpersistก่อนofferingpreviewและledgerretryreuse; processrestart/duplicatewebhookต้องload sameintentKey. Uniqueinsertใช้ `ON CONFLICT`/safe transactionpatternของrepo ห้าม catch P2002แล้วcontinueในtransactionที่aborted. DB row lock serializesconfirm/cancel/replace. ไม่มี long-lived APPLYINGstate/leaseใหม่: mutationtransactionสั้นไม่เรียกprovider/LINE/network.

Apply algorithmที่implementationต้องรักษา:

1. Resolve authenticated current owner และ current access ก่อนเปิด action. Begin DB transaction; lock company plan-term ตามเดิม แล้ว action row; UPDATE จึง lock request ตาม existing `lockRequest` order. Lock order คงที่ทั้งสอง entrypoints เพื่อลด deadlock.
2. APPLIED → ห้าม execute mutationอีก; current read authorizationผ่านแล้วคืน receiptเดิมพร้อมcurrent recordstate; write quiesce/disabled writer ไม่ขวาง read-only recovery. CANCELLED/EXPIRED/STALE → no write; COLLECTING → needs_fields. สำหรับ PREVIEW จึง check quiesce/feature/opt-out/launch/operation permission ตาม §8, exact revision/digest, fully delivered, unexpired. Current DB timestamp เป็นผู้ตัดสิน expiry.
3. Recheck active membership/requester/branch, current write permission/entitlement predicate, sourceexpense/attachment revisions และpolicy factsที่มีผลต่อpreviewภายในtransaction. CREATEใช้company-policycurrency/receipt rulesที่previewผูกไว้; หากpolicyเปลี่ยน materialให้ STALE/newpreview. UPDATEต้องcompare **stored preview expectedRequestUpdatedAt** กับcurrentrecordและDRAFT ไม่ใช้ freshlyreadversionแทนexpected.
4. Reuse `CreateReimbursementDraftUseCase`/`UpdateReimbursementDraftUseCase` preparation + repository transaction-aware internal methods. Add optional existing-transaction parameter/internalmethodและ`expectedUpdatedAt` inputสำหรับnewLINEpath; web callersเดิมยังใช้freshreadCASจนwebrevisioncontractทำแยก. Neverเรียกmethodที่เปิดtransactionใหม่ภายในactiontransactionแล้วถือว่าatomic.
5. CREATEinsertrequest+alllines once; UPDATECAS/fullreplace+signatureinvalidationตามdomain. Sourceassertionsยังอยู่ในtransaction; rollbackทั้งชุดหากหนึ่งlineไม่ผ่าน. Headertotal/calculationต้องตรง previewdigestหลังdomainnormalize มิฉะนั้น stale/no write.
6. Write durable audit of action/actor/request/previewdigestและ result receipt + `status=APPLIED` **ในtransactionเดียวกับrequest mutation**. Current fire-and-forget create/update auditไม่ใช้เป็นdedupproof; newLINEpathต้องsuppressduplicate auditแล้วใช้transaction-aware audit writer. หากdomainมีoutboxที่เกี่ยวกับdraftจริงให้คงไว้ ห้ามemit submitted/approval/paymenteventsจากdraft.
7. Commitแล้วจึงformat/deliver. Networktimeout/processcrashก่อนรู้ผล → outcome `result_unknown`, recoveryอ่านactionbykeyเท่านั้น; ถ้าAPPLIEDคืนsameID ไม่createใหม่. ถ้าDBยืนยันPREVIEWยังอยู่และtransactionrolledbackจึงretrysameactionได้; หากDBอ่านไม่ได้ให้pendingไม่เดา. Confirmซ้ำ100ครั้งต้องมีหนึ่งbusinessmutation/auditreceipt.

หาก validation/CAS throw แล้ว transaction rollback, mark action STALE ใน transaction ใหม่ที่ compare exact previewRevision/digest และยังไม่ APPLIED เท่านั้น; ห้าม failure handler overwrite ผล commit จาก concurrent winner. Cancel/expiry ใช้ row lock เดียวกันและไม่มี provider/network call.

ไม่สร้าง global idempotency layer; create+update action rowเดียวพอ. `expectedUpdatedAt` เพิ่มใน internal typed contractแบบrequiredforLINE; existingwebAPIcompatibilityไม่อนุญาตLINE adapter fallbackไปoldsignature. RequestupdatedAtใช้repository `nextVersion` เดิมให้strictlyadvance. API schema/writer capabilityต้องnegotiated; oldreaderที่ไม่รู้schemaV1ต้องrejectoperationอย่างtruthful ไม่strip fieldsแล้วsubmit.

Retention: pending payloadหมดอายุตาม COLLECTING/PREVIEW deadlines ข้างต้น และclear command/preview/sourceProofภายใน24hจากexpiry/cancel; APPLIED clear proposalpayloadหลังcommitได้ทันทีเมื่อ durable receiptครบ. Minimal actiontombstone `{id,intentKeyHash,owner refs,operation,status,requestId,appliedRevision,digest,timestamps}` และfinancial auditเก็บตามlifetime/retentionของbusinessrecordเดิม ไม่ใช้conversationTTLลบ. Unapplied tombstonesretain30daysแล้วpurge; expired actionIdที่ไม่มีrow **ไม่สามารถสร้าง/confirmใหม่**—ต้องnewexplicitproposal/newaction. Appliedrequestยังอยู่จึงห้ามpurgetombstoneเพราะจะเปิดcreateซ้ำ. Account/company deletionใช้existingdata-rightsretention/anonymization; rawusertextไม่เพิ่มในtableนี้.

## 7. Source expense, attachment, signature และ downstream boundaries

- `linkedExpenseId` ต้องผ่าน `resolveSourceLines` และ `assertReimbursementSources`: samecompany/branch/requester/currency, eligible financialsource, no stale expense. Snapshot+`sourceExpenseUpdatedAt`มาจากfreshAPI readและbindpreview. Linkedlineที่modelพยายามแก้amount/date/categoryขัดกับsourceไม่override snapshot; ถามว่าจะ edit sourceผ่านexpenseflowก่อน หรือ explicitdetachแล้วกรอกmanualline. ไม่มีimplicitdetachเพื่อให้validateผ่าน.
- Reuse `ReimbursementEvidenceService.validate`: ACTIVEattachment, samebranch, requesterownershipหรือfinance/retained-ownerexceptionตามdomain; recheckattachment/sourceundertransaction. Exactsource idsเปลี่ยนระหว่างpreview→confirmทำให้stale. Uploadเป็นexistingattachmentpipeline with malware/status/branch checks; model/LINEmessageIDไม่ใช่attachmentID. Question-onlymediaห้ามautoexpensecreate; claimreceiptต้องattachกับclaimlineอย่างexplicitไม่ต้องสร้างexpenseเพื่อทำevidence.
- LINE media adapterใหม่ reuse upload-intent → bytes → complete แบบ `reimbursements.api.ts:47–72`: attachment.create permission, visibility INTERNAL, exact branch, ACTIVE หลัง complete/scanning. Stage upload ก่อน preview; successful action บันทึก `ReimbursementLine.attachmentId` + validated attachment snapshot **ใน request transaction เดียวกัน** นี่คือ association ของ receipt เดิม ไม่สร้าง generic AttachmentLink หรือ signed-copy link เพิ่ม. Pending upload ยังไม่เป็น evidence; ถ้าผู้ใช้จะบันทึกโดยยังไม่มีไฟล์ ต้องสร้าง preview ใหม่ที่แสดง missing receipt และยืนยันเอง. Unlinked upload cleanup ห้ามลบไฟล์ที่ successful claim line อ้างอยู่เพราะ reply timeout. ถ้าเพิ่มไฟล์ภายหลังแล้วล้มเหลวให้คง draft ID เดิมและเสนอ update ใบเดิม ไม่ create ซ้ำ.
- Existing update replaces linesและdeletes claim signaturesเมื่อlineschanged; newLINEadapterต้องไม่bypass. Header/materialchangesใช้current claim-formhash/ack rulesเช่นweb; previewเตือนsignatureinvalidatedถ้ามี. ไม่copyoldsignatureลงแก้ไขใหม่ และไม่ mint requesterack/signatureจากคำว่าconfirmdraft.
- Submitยังwebเท่านั้น: source-review/receipt-policy/double-claimguard, document-number `reimb-submit:${id}`, frozenapprovalpolicy/snapshot, approverassignment/outbox/materializedclaimexpenses/paymentledgerยังอยู่domainเดิม. Draftsaveห้ามtriggerprojectionที่จะบันทึกexpenseซ้ำหรือจองเลขsubmit.
- Expenseeditที่เป็นsourceของsubstitute/reimbursementต้องinvalidateold preview/eligibilityด้วยrevision; resumeอ่านsourceใหม่. Existingexpenseapply + vendorautosaveเป็นสองoutcomes: หลังexpensecommitสำเร็จauto-savefailureไม่เปลี่ยนเป็น“แก้ไม่สำเร็จ”. Preservefinalexpense revisionafterlinkและexisting duplicate/cache/read-summaryinvalidation; deliveryretryอ่านresult ไม่รันautosave/prepare/OCRใหม่.

## 8. Permissions, gates, billing และ error protocol

| Gate | CREATE | UPDATE / replay |
|---|---|---|
| Channel/identity | employeeOA1:1, currentbinding/member/legal/support/launch controls | เหมือนกัน; unlink/revokeไม่adoptoldactionจากactorcompanyอย่างเดียว |
| Domain permission | `reimbursement.create`; prepareforotherต้องfinance_review | requester==actor +update_own_draft ORfinance_review; branchDRAFTalways. Replaysต้องcurrentread/operationauthorityก่อนเผยrecord |
| Feature/package | current reimbursement entitlementสำหรับnewclaim; unknownentitlementlookupfailclosed | effectivepermissionsตามexistingfeaturegate; update_ownอาจถูกstripเมื่อoffแต่finance_reviewretained. ไม่restorestrippedpermission ไม่blockretainedread/queueทั้งmodule |
| AI feature/opt-out | semanticproposalต้องai_line_assistant/querypermissionและopt-inตามexistingpolicy | opt-out/ownerinvalidatedหยุดnewapply; cancel/localrecoverstatusยังไม่ใช้modelและต้องไม่เปิดprivatefactsถ้าสิทธิ์หาย |
| Rollout | `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED=true` default per owner update 2026-09-27; servercapabilityavailableต่อเมื่อAPI+gateway+runtime+postbackready | offหยุดnewpreviewและuncommittedapply; appliedrecovery/read/cancelยังอยู่ ไม่ลบreceipt |
| Write quiesce | `REIMBURSEMENT_WRITE_QUIESCE` ก่อนpreview/apply | same domain checkสำหรับinternaladapter; reusecode `reimbursement_upgrade_in_progress`, retryAfter60; currentcontrollerguardอย่างเดียวไม่พอ |
| Credits/usage | reuseintake/model laneusagehold+measuredsettlementจากbudgetappendix | previewvalidator/confirm/cancel/recoveryไม่เรียกmodel ไม่คิดAIซ้ำ; no-modelconfirmไม่ต้องreserveprovidercreditใหม่ แต่domain/quiesce/opt-outยังต้องผ่าน |

ปรับ quiesce checkเป็นexisting shared assertionที่HTTPguardและnewusecaseเรียก ไม่สร้างsecurityframeworkใหม่. Modelusage chargeเฉพาะactualinvocationและtrace/actionlocators; sameOCR/source reuseretryไม่คิดreceiptOCRใหม่. Manualclaimdraftไม่มีreceiptcapturequota chargeเพิ่ม; attachmentOCRที่ผู้ใช้ร้องขอใช้approvedlaneเดียวตามbudgetappendix ไม่แอบเรียกexpensecaptureproviderเพื่ออ่านไฟล์. Companyusageentitlement/costlookupfailureไม่แปลว่าlegacyunlimited; explicit no-entitlement-rowlegacycaseเท่านั้นที่ใช้policyเดิม.

Response unionใช้ `status` แบบtyped: `needs_fields | needs_target | preview | applied | cancelled | expired | stale | blocked | result_unknown`. `blocked.errorCode` allowlist: `forbidden`, `feature_disabled`, `unsupported_channel`, `write_quiesced`, `invalid_provenance`, `evidence_overflow`, `field_too_long`, `invalid_field`, `source_changed`, `invalid_source`, `state_not_editable`, `preview_not_fully_delivered`, `rate_limited`, `store_unavailable`, `schema_unsupported`. ใส่ `fieldPaths/limit/retryAfter` เฉพาะที่มีจริง; ลูกค้าเห็นประโยคไทยหนึ่งประโยคต่อ errorCode (fieldPaths แปลงเป็นชื่อช่อง, path ภายในเช่น `activeAction` ไม่แสดง) ไม่เห็นรหัส ส่วนรหัสอยู่ใน result/log/audit (§5.1); notfound/other-tenantใช้same `needs_target`ภายนอกไม่leak. Rate limitreusepreviewfamily20peractorcompany/300s; exhaustionไม่consumeconfirmationหรือลบacceptedfacts. Auditไม่มีrawprompt/sourcecontent.

Stale: invalidateexactpreviewแล้วเสนอrefreshsameoperationtarget ถ้าสิทธิ์ยังอยู่; ห้ามauto-rebase/auto-confirm. Unknown: “กำลังตรวจผลบันทึก”พร้อมactionlocatorภายใน ไม่บอกfailedแล้วชวนสร้างใหม่. Appliedตอบ“บันทึกร่างใบเบิกแล้ว”+authorizedlink+stateจริงเป็นป้ายไทย และเลขที่ใบเบิกเมื่อมีแล้ว ห้ามแสดง requestId (§5.1); currentrecordsubsequentlysubmittedให้บอกสร้างสำเร็จก่อนหน้านี้และสถานะปัจจุบัน ไม่อ้างยังDRAFT. UI/LINEcard/capability/helpใช้same operation manifest ไม่บอกสร้างได้เมื่อwriterflagยังoff.

## 9. Migration และ rollout ที่ตัดสินแล้ว

1. Additivemigration table/indexes/DBsizechecks; no financialrowbackfill, no changeexistingrequeststatus/number, no package.json edits. AppliedreceiptmustnotdependonnullableRedisstate. Registercleanupในexistingmaintenancepatternและrecordmetricswithoutcontents.
2. Contracts+readersก่อนwriters: schemaV1 validators/owner/SourceRef/actionresponseต้องผ่านAPI→gateway→AgentCoreและnative/JSONfallback. Oldartifactreturnsunsupportedwriter ไม่pretendhandoffcreated. Newfeatureflagfalseทุกenvironmentจนcapabilityprobeผ่าน.
3. Domaintransaction/CAS/idempotency + localPGtestsก่อนLINEsurface. Exposeget-options/preview/internalpostbackDI onlyaftercontroller/contextdelegationparity. Keepwebcreate/updatecompatibility; addoptionalexpectedversionentrypointwithoutweakeningexistingdomainchecks.
4. R1: existingexpense/substitute semanticprovenance/longtext/negativecases และ honestreimbursementhandoff. R2:เปิดnewclaimdraftwriterสำหรับcohortหลังtext/image/fileparity,previewdelivery,PGconcurrency,lostresponse,source/signatureregressionsผ่าน. R1จบไม่เท่ากับใบเบิกLINEcreate/updateจบ.
5. Rollback: flagoffstopsnewpreview/apply; keepbackwardcompatibleactionreader/recovery/cancelและtable. ห้ามdroptable/forgetAPPLIEDkey/retryoldnon-idempotentcreateเพื่อrollback. Signedsubstituteweb/retainedapprovalqueueไม่ถูกปิดพร้อมnewwriter.

## 10. Implementation impact และ acceptance ที่ต้องทำ

| Surface / exact files | Required change / test evidence |
|---|---|
| `packages/contracts/src/reimbursements.ts`, `line-ai.ts`, `ai-tools.ts` | Versionedproposal/preview/result/runtimevalidators, scopedtoolmetadata; rejectunknown/oversize/IDsnotissued/invalidspan; no applytool |
| `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts`, `infrastructure/prisma-reimbursement.repository.ts`, `reimbursements.module.ts` | Reuseprepare/validate, transaction-awarewrite, previewexpectedrevision, durableaudit+receipt, explicitDI/export |
| New `apps/api/src/modules/reimbursements/application/use-cases/line-reimbursement-draft.use-case.ts` | Ownnewactionworkflow; no provider. Focus tests in sibling `.spec.ts`; new PG suite `apps/api/src/modules/reimbursements/line-reimbursement-draft.pg.spec.ts` |
| New `apps/api/src/modules/line-ai/application/use-cases/erp-reimbursement-draft-tools.use-case.ts` + `.spec.ts`/`.di.spec.ts` | Scopedoptions/previewonly; contextdelegation/fullowner, buildDI; register `internal-tools.controller.ts` + `line-ai.module.ts` |
| `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` + `.spec.ts` | Text/image/PDFintentparitybeforecapturefastpath, exactpostback, sourceproofdelivery, sidequestionvsconfirm, pendingmedia/invalidation, ledgerrecoveryreuseactionID |
| New `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.ts` + `.spec.ts` | Fullpreview/diff/warnings, limit→exactpreviewpage, nofakecreated/approved; confirmdisableduntilpreviewfullydelivered |
| Existing `expenses/.../line-draft-update.*`, `line-correction.*`, `line-substitute-receipt-continuation.*` | Span-basedsemanticproposals replacefieldlabelveto/prefixgrounding; preservesallguards/exactpreview/counterpartypostcommit; no signedsubstitutewriter |
| New `apps/web/src/features/reimbursements/ReimbursementDraftActionPage.tsx` + `.qa.spec.ts`, route `apps/web/app/(workspace)/companies/[companyId]/reimbursements/draft-actions/[actionId]/page.tsx` | Full read-only preview + same action confirm; loading/expired/stale/permission/quiesce/UNKNOWN/APPLIED; no second create on lost response. Component state/API tests ต้องทดสอบ behavior ไม่ใช้ source regex เป็นหลักฐาน UX เพียงอย่างเดียว |
| `apps/api/prisma/schema.prisma` + migration, `packages/config/src/index.ts`, `AppConfigService` | Table/index/limit/retention, disabledbydefaultflag, API/Gatewayconfigparity; no unrelatedcontractrevert |

Acceptance required (newtests must assert businessrows/audit/sourceversions,ไม่ตรวจแค่replycontains):

| ID | Thai/input/race | Expected |
|---|---|---|
| BD01 | “ขอเบิกค่าทางด่วนเมื่อวาน 120 บาท ฉันสำรองจ่าย ไปพบลูกค้า” | Collectonlymissingbranch/category/evidencefacts; fullpreview→oneDRAFT afterbutton; reason/purposegrounded; no submit |
| BD02 | “ไม่ต้องสร้างใบเบิก แค่บอกว่าต้องกรอกอะไร” | Helpanswer, zeroactionpreview/businessrow/providerwrite |
| BD03 | “แก้ใบเบิกเมื่อกี้ ค่ารถจาก 120 เป็น 150 ส่วนค่าน้ำเหมือนเดิม” | ResolveexactDRAFT/currentline; preserveotherline/evidence; previewold→new; confirmCAS |
| BD04 | 2 drafttargets /2same-descriptionlines /twofundingpayers | Onefocusedclarification; no guessednewest/row/payer; acceptedfactsretained |
| BD05 | Extra20+amounts then “แต่ยอดที่แก้จริง 999”; importantfieldafter1000chars; Thai5kbubble | Fulladmitted evidence/candidates selectsrightvalue; beyondcontractoverflow zero mutation, nofinancialprefix |
| BD06 | “ร้านสมใจรับเงิน ใช้ส่งของให้ลูกค้า แล้วต้องทำยังไงต่อ” while substituteOPEN | Acceptgroundedunlabeledfields+answerquestion; preserveworkflow; noissue/signature |
| BD07 | Webedit/submit/sourceexpense/attachmentrevocation betweenpreview→confirm | Stale/forbidden/all-or-nothing no overwrittenwebdata, no invisible detach |
| BD08 | 2 simultaneousconfirm; confirm+cancel; replacepreview+oldbutton | Onecommittedactionorcancelwinner, same ID, no secondrequest/audit; oldbuttoncannotapplynewrevision |
| BD09 | Crash afterDBcommit beforeHTTP/LINEreply; retry/recoverdayslater | OneDRAFT/actionreceipt; rereadcurrentstate; no provider/OCR/numberreservation/autosaveagain |
| BD10 | Differenttenant/branch/OA/chat/actor; unlink/relink; featureoff/quiesce/optout | Failclosedbeforedata/mutation; appliedfinancialreceiptretained; authorizedretainedreadsstillwork |
| BD11 | 50lines/line51, field500/501, 128KiBoverflow, missingcategory, zero/negativeamount | Exactboundedvalidation; no silentcut/partialcreate; fullpreviewpageforlargevaliddraft |
| BD12 | Photo/PDFclaim; media-onlyquestion; attachmentuploadfailsafterdraftcreated | Correctlane, no expensefromquestiononly, no unsupportedafterunnecessaryOCR; knowncreatedIDsurvivesattachmentfailure |
| BD13 | Existingclaimsignatures + changedlines; sourceexpensealreadyclaimed; concurrentdoubleclaim | Domaininvalidation/source/duplicatepolicy preserved; no reusedsignature or domainbypass |
| BD14 | Expensevendorchange→auto-savefailure; successfulcounterpartylinkchangesrevision | Expensestillreportedcommitted; secondaryoutcomeexplicit; replyproofmatchesfinalrevision; no repeatedautosave |
| BD15 | Mixedold/newAPI/Gateway/runtime, flagoff, previewdeliverypartial/UNKNOWN | Truthfulcapability, no strippedauthorityfields/fallbackdirectwrite; nodraftconfirmbeforefullpreview |

Commands below are exact intended checks **หลังimplementation**; newtestfilesยังไม่ถูกสร้างในdocs-onlytaskนี้. ใช้local/scratch PostgreSQLเท่านั้น; missingenv/skipไม่ถือว่าผ่านPGgate.

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/reimbursements/application/use-cases/line-reimbursement-draft.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-reimbursement-draft-tools.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-reimbursement-draft-tools.di.spec.ts src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts src/modules/reimbursements/application/services/reimbursement-evidence.service.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.atomic-lines.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts src/modules/reimbursements/presentation/http/reimbursement-write-quiesce.guard.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/expenses/domain/logic/line-draft-update.logic.spec.ts src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/reimbursements/line-reimbursement-draft.pg.spec.ts src/modules/expenses/line-draft-update.pg.spec.ts
pnpm --filter @watchdog-bms/api exec prisma validate
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/web exec tsx --test src/features/reimbursements/ReimbursementDraftActionPage.qa.spec.ts src/features/reimbursements/reimbursements.api.spec.ts
```

NewPGsuiteต้องใช้ explicit `LINE_REIMBURSEMENT_DRAFT_TEST_DATABASE_URL` และrejectnonlocalhostunlessdedicatedscratch opt-in; existingexpensesuiteใช้ `LINE_DRAFT_EDIT_TEST_DATABASE_URL`. CI ต้องsupplyทั้งสองและfailถ้าจำนวนPGtestsrunเป็น0. Include builtimageDItest, contract parserroundtrip/native+JSONsameproposal, authenticatedwebpreviewjourneyและLINEsyntheticpostbacktest. Domain testsห้ามcallprovider/customerLINE. Customeracceptance/deployทำตามrunbookแยกหลังlocalevidenceครบ ไม่ถือว่าเอกสารนี้อนุมัติdeploy.

Done ของappendixนี้หมายถึง BD01–BD15และoperationmatrixที่อยู่R1/R2ผ่านพร้อมevidence, capabilityตรงservingartifact, no P0/P1unresolved; ไม่ใช้จำนวนtestsแทนresult และไม่ถือwebhandoffเป็นLINEcreate/updateสำเร็จ.
