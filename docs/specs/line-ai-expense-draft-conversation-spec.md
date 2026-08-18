# LINE AI Expense Draft Conversation Specification

Status: IMPLEMENTED BEHIND A DEFAULT-OFF FLAG — deterministic repository behavior is proven; database-backed provider E2E and real LINE OA UAT remain release gates.

Date: 2026-08-19

Owner: Product / Finance Platform / AI Gateway / LINE AI

Related source-of-truth documents:

- `docs/adr/0008-line-ai-access-and-auth.md`
- `docs/adr/0010-line-ai-turn-ledger-redis-streams.md`
- `docs/specs/expense-receipt-upload-spec.md`
- `docs/specs/expense-category-default-tax-code-spec.md`
- `docs/specs/ai-draft-suggestion-layer-spec.md`
- `docs/specs/line-ai-message-buffering-spec.md`
- `docs/specs/line-ai-multi-intent-completion-spec.md`
- `docs/specs/line-ai-conversation-reliability-spec.md`
- `docs/plans/line-ai-expense-draft-conversation-plan.md`

## 1. Product outcome

A linked employee can describe an expense and answer missing information directly in a personal LINE chat. The system progressively saves a reviewable expense draft, displays the whole current draft after every accepted answer, and asks every remaining question in one response. A user does not have to open the web merely to supply ordinary missing fields.

The outcome is a draft that a person can understand and review before the existing accounting workflow is used. The assistant never confirms, approves, pays, exports, files tax, posts a journal, or silently treats an AI suggestion as an accounting fact.

Example:

> User: ซื้อกระดาษ A4 กับโน้ตบุ๊กมาใช้ที่ออฟฟิศ โน้ตบุ๊ก 1 เครื่อง 25,000 บาท

The system must preserve both items and must ask for the missing paper information too. It must not ask only about the laptop, and it must not invent quantity `1` or price `0` for the paper.

## 2. Meaning of “proven to work”

This specification uses four separate proof levels. They must never be collapsed into a single claim.

1. **Protocol feasibility proven** — official LINE documentation supports the required message, webhook, identity-linking, retry, and reply primitives.
2. **Repository baseline proven** — the current repository already passes focused tests for webhook security/idempotency, persistent continuation, missing-field preservation, and LINE intake processing.
3. **Repository feature behavior proven** — the implementation passes deterministic domain, use-case, webhook-orchestration, AI-boundary, regression, and repository whole-chain suites.
4. **Live feature behavior proven** — a database-backed signed-webhook E2E and recorded real LINE Official Account UAT pass with provider, audit, revision, and delivery artifacts.

Levels 1 and 2 were proven on 2026-08-18. Level 3 is proven locally as of 2026-08-19. Level 4 remains pending, so the flag stays off by default and this document is not evidence that the feature is deployed or live.

## 3. External feasibility evidence

The design relies only on documented LINE Messaging API behavior:

- Account linking can associate a LINE user with an application account: <https://developers.line.biz/en/docs/messaging-api/linking-accounts/>
- LINE sends message events by webhook; `webhookEventId` and redelivery behavior support durable idempotent handling: <https://developers.line.biz/en/docs/messaging-api/receiving-messages/>
- Webhook signatures must be verified against the exact raw request body with HMAC-SHA256: <https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/>
- Users can answer by ordinary text; quick replies are optional and support at most 13 buttons: <https://developers.line.biz/en/docs/messaging-api/using-quick-reply/>
- Messaging payload limits, reply tokens, and text message limits are defined by the Messaging API reference: <https://developers.line.biz/en/reference/messaging-api/nojs/>

The product contract therefore makes free text primary. Buttons are a convenience, never a dependency.

## 4. Users and authorization

### 4.1 Primary user

An active company member whose personal LINE identity is linked through `ExternalIdentity` and who has the existing LINE expense-upload capability.

### 4.2 Reviewer

A member with `expense.review` can review and correct the normal expense record in the web application. Reviewer-only accounting, tax, and final classification fields remain governed by existing permissions.

### 4.3 Authorization rules

- Re-resolve active membership, company, branch scope, legal acceptance, feature entitlement, and permissions on every LINE turn.
- By default only the originating user in the same personal chat and company may continue the draft through LINE.
- A reply from a different user or chat must not silently mutate the draft.
- If access is revoked after the draft was started, later replies fail closed without discarding the stored evidence.
- AI Gateway never reads or writes an ERP repository directly. It returns extraction candidates; the permission-checked API validates and commits them.

## 5. Scope

### 5.1 In scope

- Text or receipt-originated expense drafts in personal LINE chat.
- Multiple items in one draft.
- Free-form Thai answers, labeled answers, and answers by stable question number.
- A deterministic full question list covering document-level and every item-level gap.
- Current-draft rendering after every accepted answer.
- Pause, resume, end-input, cancel-conversation, silence, unrelated-task interruption, and multiple-draft disambiguation.
- Resume after 15 or more unrelated turns and after the current 15-minute AI context window expires.
- Human/reporting category suggestions separated from accounting, inventory, and tax suggestions.
- Durable field provenance, webhook idempotency, optimistic concurrency, and user-visible delivery truth.

### 5.2 Narrow extension to existing boundaries

This is a narrow LINE extension to create and update `ExpenseRecord` drafts. It does not expand LINE authority over final financial mutations. It supersedes the generic “one clarification per reply” behavior in `line-ai-multi-intent-completion-spec.md` only while the user is inside this dedicated deterministic draft-collection workflow. Generic chat and unrelated multi-intent behavior remain unchanged.

### 5.3 Out of scope

- Final confirmation, approval, payment, reimbursement approval, tax filing, journal posting, export, or deletion.
- Treating AI category, account, tax, or stock suggestions as confirmed facts.
- Creating an expense when the transaction direction is confidently income, deposit, loan, transfer, or another non-expense workflow.
- Group-room draft collection in the first release.
- Automatic reminders after user silence in the first release.
- A new accounting category master or automatic chart-of-accounts mutation.
- A web-only requirement for ordinary missing answers. The web remains available for attachments, review, conflicts, and fields that policy does not permit through LINE.

## 6. Classification model

The assistant must keep these axes separate. A value on one axis must not be used as proof for another.

| Axis | Purpose | Example | Authority |
| --- | --- | --- | --- |
| Transaction direction | Routes the record | expense, revenue, deposit, transfer, unknown | Deterministic API routing with AI candidate |
| Human/reporting category | Understandable reporting | office supplies, computer equipment, professional service | Active company `ExpenseCategory`; user/reviewer can select |
| Accounting class | Accounting treatment suggestion | OPEX, ASSET, INVENTORY, LIABILITY, REVENUE, UNKNOWN | Advisory until reviewed |
| Item behavior | Operational handling | STOCKABLE, NON_STOCK, SERVICE, UNKNOWN | Advisory until routed/reviewed |
| Account hint | Candidate account mapping | office supplies expense, computer equipment asset | Advisory and permission governed |
| Tax treatment | Candidate VAT/WHT treatment | no VAT evidence, VAT review required | Advisory; evidence and tax rules remain authoritative |

For the example above, “กระดาษ A4” may be suggested as office supplies/OPEX/non-stock and “โน้ตบุ๊ก” may be suggested as computer equipment/asset/non-stock. Those are separate item suggestions, not a single document-wide certainty.

If direction is not expense, the assistant shows the classification result and offers the correct existing workflow. It must not force the event into `ExpenseRecord` merely to continue the conversation.

## 7. Source-of-truth and persistence design

### 7.1 Durable state

The durable source of truth is the API database, not model chat history, `AiTurn`, Redis conversation context, or the LINE reply token.

Phase 1 reuses the proven continuation pattern in `ExpenseRecord.sourceChannelMetadataJson` under a new key, `lineExpenseDraftContinuation`. No schema migration or new dependency is planned unless implementation proves that metadata size, queryability, or retention is inadequate.

`ExpenseRecord` stores valid materialized header values and totals. `ExpenseLine` stores a line only after its required numeric invariants are valid. Incomplete item candidates remain bounded staged values in continuation metadata. Unknown quantity or price is `null`/absent, never a fabricated zero or one.

Because `expenseDate` is required by the current schema, a new text-only draft initially uses the webhook occurrence time as a clearly marked provisional source date until the user or source evidence supplies the transaction date.

### 7.2 Continuation shape

The persisted shape must be versioned and validated before use. This is a logical contract; exact TypeScript names may follow repository conventions.

```ts
type LineExpenseDraftContinuation = {
  schemaVersion: 1;
  workflowId: string;
  kind: 'EXPENSE_DRAFT_COLLECTION';
  companyId: string;
  userId: string;
  expenseId: string;
  chatKeyHash: string;
  status:
    | 'OPEN'
    | 'PAUSED'
    | 'PAUSED_INTERRUPTED'
    | 'INPUT_ENDED_COMPLETE'
    | 'INPUT_ENDED_INCOMPLETE'
    | 'CANCELLED'
    | 'STALE';
  version: number;
  targetRevision: string;
  header: {
    provisionalExpenseDate: string;
    expenseDate?: string;
    vendorName?: string;
    businessPurpose?: string;
  };
  items: Array<{
    itemRef: string;
    sourceText: string;
    description?: string;
    quantity?: string;
    unit?: string;
    unitPrice?: string;
    totalAmount?: string;
    expenseCategoryId?: string;
    suggestedCategoryId?: string;
    accountingClass?: string;
    itemBehavior?: string;
    taxTreatment?: string;
    confidence?: number;
    advisorySource?: 'AI_GATEWAY';
    advisoryRuleVersion?: 'line-expense-draft-v1';
  }>;
  provenance: Record<string, {
    source: 'LINE_USER_TEXT' | 'LINE_AI_SOURCE_GROUNDED' | 'LINE_MEDIA_OCR';
    acceptedAt: string;
    messageHash?: string;
    webhookEventId?: string;
    confidence?: number;
  }>;
  unresolvedQuestions: Array<{
    id: string;
    scope: 'DOCUMENT' | 'ITEM';
    itemRef?: string;
    field: string;
    prompt: string;
  }>;
  lastActivityAt: string;
  inputEndedAt?: string;
};
```

Only bounded source snippets, normalized values, hashes, and required provenance may be stored. Raw provider payload retention remains governed by the existing webhook/evidence policy.

### 7.3 Existing short-term context

`LINE_AI_CONTEXT_MAX_TURNS = 15` and the 15-minute conversation window continue to support natural-language continuity only. They must not decide whether a draft exists or may resume. Resumption is a database lookup scoped by company, linked user, personal chat, active status, and explicit target when required.

## 8. Completeness and question engine

### 8.1 Ownership

The API owns a deterministic completeness engine. The model may extract candidate fields, item boundaries, and category suggestions, but may not decide that all required fields are complete.

### 8.2 Required operation

After each input, the engine must:

1. Inspect document-level fields.
2. Inspect every recognized item, including incomplete staged items.
3. Apply document type, company configuration, permission, tax-evidence, and item-type rules.
4. Exclude facts already grounded by the source, a prior accepted answer, or a valid company default.
5. Produce one stable, ordered question for every unresolved required fact.
6. Persist that exact set before rendering the reply.

Question IDs must be stable across turns while the item identity remains stable, for example `D-DATE`, `D-VENDOR`, `I01-QTY`, `I01-UNIT-PRICE`, `I01-CATEGORY`, `I02-ASSET-USE`.

### 8.3 Minimum field policy

The exact required fields derive from the normal expense rules, but the collection engine distinguishes:

- **Source facts:** merchant/payee, document date, purpose, item description, quantity, unit or total price, currency, payment facts, and receipt/tax evidence.
- **User-facing classification:** category selection or confirmation when confidence is below the configured threshold or multiple active categories match.
- **Advisory classification:** accounting class, stock behavior, account hint, and tax treatment. These can remain review suggestions and must not block basic answer collection unless the existing expense workflow requires them.
- **Web/policy-only blockers:** attachment evidence, reviewer authority, stale conflict, or unsupported mutation. These are displayed separately and are never phrased as if a LINE text answer can satisfy them.

Blank text, hypothetical statements, questions, low-confidence guesses, or values that fail validation do not clear a missing field.

### 8.4 All questions at once

The assistant must ask the complete current question set in the same response cycle, grouped as:

1. Document-level questions.
2. Item 1 questions.
3. Item 2 questions.
4. Additional items in stable order.
5. Web/policy-only blockers.

It must not reveal only the first missing field. If a user answers only some questions, accepted answers are saved and the next reply again shows the whole draft plus every still-unresolved question.

## 9. Turn transaction

Every incoming LINE turn follows one permission-checked orchestration path:

1. Verify the webhook signature from the exact raw body.
2. Deduplicate by `webhookEventId`/message identity using existing delivery rules.
3. Resolve linked user, company, branch, membership, entitlement, and permissions.
4. Buffer/cohere messages according to the existing buffering specification.
5. Resolve the exact continuation. If multiple drafts could match and the user did not identify one, return target selection and perform no draft write.
6. Detect control intent (`พัก`, `ต่อ`, `หมด`, `ยกเลิก`) before ordinary field extraction.
7. Ask AI Gateway for structured candidates when needed; never pass database authority to the model.
8. Validate candidate answers deterministically, including category activity, numeric/date rules, item identity, and permissions.
9. Apply accepted facts, provenance, staged items, and materialized expense values with compare-and-swap against `targetRevision`/`updatedAt`.
10. Recompute the complete unresolved question set.
11. Persist the new continuation version and normal audit/outbox evidence.
12. Render the full compact draft and all unresolved questions.
13. Send the LINE response and track delivery truth. A provider failure cannot be reported internally as a user-visible completion.

Duplicate delivery of the same event returns or retries the same logical result and must not create another expense, line, answer, or audit mutation.

## 10. Conversation state semantics

| User/event | State/result | Questions in that reply | Data effect |
| --- | --- | --- | --- |
| Ordinary answer | `OPEN` | All remaining questions | Save only valid accepted facts |
| `พัก`, `หยุด`, `ไว้ก่อน` | `PAUSED` | No active interrogation; show resume instruction | Retain draft and unresolved questions |
| `ต่อ`, `ทำต่อ` | `OPEN` | Full current unresolved set | Resume durable draft |
| `หมด`, `จบ`, `ไม่มีแล้ว` and complete | `INPUT_ENDED_COMPLETE` | None until resumed | Freeze collection; mark ready for human review, never post |
| `หมด`, `จบ`, `ไม่มีแล้ว` and incomplete | `INPUT_ENDED_INCOMPLETE` | Show missing summary but stop asking | Retain incomplete draft; resume only on explicit continuation |
| `ยกเลิก`, `ไม่เอาแล้ว` | `CANCELLED` | None | Cancel conversation only; do not delete record/evidence |
| Unrelated task | `PAUSED_INTERRUPTED` | One short resume capsule after answering other task | Retain draft without consuming unrelated text as an answer |
| Silence/no event | No transition | No message required in MVP | Retain state; no finalize/delete |
| Stale web edit | `STALE` or refreshed `OPEN` after explicit choice | Show conflict/current state | Reject stale mutation; never overwrite newer data |

“พัก” and “หมด” are intentionally different. “พัก” means questions remain and the user intends to continue. “หมด” means the user has ended this collection session even if required facts are still missing.

### 10.1 Resume after 15 turns

After 15, 50, or more intervening turns, a direct continuation phrase or an answer that unambiguously maps to the only active paused draft reopens it. The system loads the database state and question IDs; it does not depend on retained model turns.

If there are multiple resumable drafts, the reply lists compact targets with stable draft reference, date, vendor/purpose, and total if known. The user must select one by reference or ordinal before any answer is applied.

## 11. Response contract

Every successful answer-collection response contains, in this order:

1. **Accepted this turn** — concise facts actually saved; omit if none.
2. **Current draft** — document header, all items, per-item human category, amount/quantity status, and advisory flags.
3. **Still needed** — all unresolved questions, grouped and numbered by stable ID.
4. **State and instruction** — for example, “ตอบได้หลายข้อในข้อความเดียว”, “พิมพ์ พัก”, or “พิมพ์ หมด”.
5. **Review boundary** — concise reminder that this is a draft when accounting/tax suggestions are shown.

Illustrative reply:

```text
บันทึกแล้ว: โน้ตบุ๊ก 1 เครื่อง ราคา 25,000 บาท

ร่างค่าใช้จ่าย WD-…
วันที่: ยังไม่ทราบ
ใช้เพื่อ: งานสำนักงาน
1) กระดาษ A4 — จำนวน ? — ราคา ? — หมวดแนะนำ อุปกรณ์สำนักงาน
2) โน้ตบุ๊ก — 1 เครื่อง × 25,000 — หมวดแนะนำ อุปกรณ์คอมพิวเตอร์
   แนวทางบัญชีแนะนำ: สินทรัพย์ (รอตรวจ)

ข้อมูลที่ยังต้องตอบทั้งหมด
D-DATE วันที่ซื้อคือวันไหน?
I01-QTY กระดาษ A4 จำนวนกี่รีม/แพ็ก?
I01-UNIT-PRICE กระดาษ A4 ราคาต่อหน่วยหรือยอดรวมเท่าไร?
I02-ASSET-USE โน้ตบุ๊กใช้โดยใคร/หน่วยงานใดเพื่อประกอบการตรวจสินทรัพย์?

ตอบหลายข้อในข้อความเดียวได้ เช่น “D-DATE วันนี้, I01-QTY 5 รีม, I01-UNIT-PRICE 650 รวม”
พิมพ์ “พัก” เพื่อกลับมาต่อ หรือ “หมด” เพื่อจบการกรอกและเก็บร่างไว้
```

Free text remains valid; question IDs reduce ambiguity but are not mandatory.

### 11.1 Length and splitting

The renderer must measure the actual Messaging API limit and split deterministically without dropping items or questions. Parts retain the same draft reference and stable numbering. Quick replies may expose common control actions but cannot replace text answers. If the full reply cannot fit in one provider reply batch, the operation stays saved and subsequent delivery follows the existing delivery-reliability contract; it must never silently truncate the unresolved list.

## 12. Draft materialization rules

- A high-confidence expense statement with at least one grounded purpose or item may create an `ExpenseRecord` in `DRAFT`, even when amount/category is not yet known.
- This is a deliberate narrow change from the current LINE text capture, which rejects incomplete amount/purpose/category input.
- The draft uses zero aggregate totals only as schema-safe aggregate defaults while no valid financial line exists. The reply must display unknown item values as `?`, never as zero.
- Create or update `ExpenseLine` only when description, positive quantity, and a valid unit/total amount can satisfy current line invariants.
- Recalculate totals using the existing expense calculator whenever materialized financial facts change.
- Retain the original message/OCR source and field-level provenance.
- `ExpenseRecord.status` remains `DRAFT`; collection completion is stored separately and does not imply expense confirmation.
- A non-expense direction must be handed off to the correct source module or held as a classification result; it must not create a misleading expense record.

## 13. Category and suggestion rules

- Match only active categories in the current company.
- Preserve the user's source wording even when a normalized category is selected.
- If one category match is sufficiently grounded, show it as “suggested” until accepted according to existing permission rules.
- If several categories are plausible, show the candidates and ask one category question for that item.
- Do not let a document-wide category overwrite differing item categories.
- Account/tax/inventory suggestions include confidence, rule/model version, source, and explanation sufficient for review.
- Changes to finance-only classification fields remain subject to the existing `expense.review` boundary.
- Default tax code behavior continues to follow `expense-category-default-tax-code-spec.md`; a category suggestion is not tax evidence.

## 14. Concurrency, audit, and delivery

### 14.1 Compare-and-swap

Each continuation mutation supplies the last `targetRevision`/`updatedAt`. A stale LINE or web edit fails closed, reloads the current draft, and tells the user what changed. Last-write-wins is forbidden for financial source facts.

### 14.2 Audit

Record at minimum:

- actor, company, branch/chat scope, workflow ID, expense ID;
- webhook event/message identity and bounded hash;
- before/after continuation version;
- each accepted/rejected candidate and rejection reason;
- field provenance and AI/rule version for suggestions;
- pause/end/cancel/resume transitions;
- stale conflicts, permission denial, duplicate suppression;
- outbound message intent and provider delivery outcome.

### 14.3 Delivery truth

A committed answer is not rolled back merely because the LINE response fails. Instead, retain the committed version, mark delivery pending through the existing outbox/turn mechanism, and retry safely. The next inbound turn must render from current persisted state, so the user can recover without duplicating facts.

## 15. Privacy and safety

- Do not include secrets, bank credentials, full tax IDs, or unnecessary personal data in chat summaries.
- Hash chat/provider identifiers where existing patterns require it.
- Bound free-text and metadata lengths.
- Do not log raw LINE content outside approved evidence/log retention.
- Ignore prompt instructions embedded in receipt text; receipt/OCR content is untrusted business data, not system instruction.
- Never infer that silence, “พัก”, or provider delivery failure means approval or confirmation.

## 16. Acceptance criteria

### AC-01 — Every item survives extraction

Given a message mentioning paper and a laptop, the draft contains two stable item references even if the paper has no quantity or price.

### AC-02 — All gaps are asked together

The first reply contains document-level gaps and gaps for both items. It does not ask only one missing field.

### AC-03 — Partial answers are cumulative

When the user answers only paper quantity, that fact appears in the next full draft, while paper price and all other gaps remain in the same question list.

### AC-04 — Unknown is not fabricated

Missing numeric values are stored as absent staged values and displayed as `?`; they are never silently coerced to `0` or `1` as an item fact.

### AC-05 — Category axes remain separate

The response distinguishes human category, accounting class, stock behavior, account hint, and tax suggestion. No suggestion causes posting.

### AC-06 — Pause differs from end-input

`พัก` results in `PAUSED`; `หมด` results in one of the two `INPUT_ENDED_*` states. Neither confirms or deletes the expense.

### AC-07 — Resume is durable

The same draft resumes after at least 15 unrelated turns and after the short-term context window expires.

### AC-08 — Unrelated tasks do not contaminate answers

An unrelated question is answered separately, the draft is parked, and its text is not accepted as a missing expense value.

### AC-09 — Multiple drafts fail closed

If more than one draft could receive an answer, no mutation occurs until the user identifies the target.

### AC-10 — Stale updates fail closed

A LINE answer based on an older draft revision cannot overwrite a newer web edit.

### AC-11 — Identity and permission are checked every turn

Unlinked, revoked, cross-company, cross-user, or disallowed branch input does not mutate the draft.

### AC-12 — Duplicate webhook is idempotent

Redelivery of the same webhook produces no duplicate draft, line, accepted answer, or audit mutation.

### AC-13 — Complete snapshot is always visible

Every reply that accepts at least one answer contains the whole compact draft and all current unresolved questions.

### AC-14 — Silence is safe

No reply causes no deletion, confirmation, or state transition. A later explicit resume still loads the draft.

### AC-15 — Delivery failure is recoverable

If LINE delivery fails after a commit, retry or the next response shows the committed state without applying the answer twice.

### AC-16 — No final financial mutation

No path in this feature can confirm, approve, pay, file tax, export, post, or delete the expense.

## 17. Proof matrix

### 17.1 Evidence already passed on 2026-08-18

| Proof | Evidence | Result |
| --- | --- | --- |
| P-B01 webhook authentication and enqueue boundary | `line-webhook.controller.spec.ts` | 8 passed |
| P-B02 missing-field preservation and real-value clearing | `expense-draft-ai-missing-fields.use-case.spec.ts` | 6 passed |
| P-B03 durable continuation, partial answers, pause/cancel, target selection, stale revision | `line-substitute-receipt-continuation.use-case.spec.ts` | 12 passed |
| P-B04 end-to-end LINE webhook orchestration baseline, context limits, permissions, idempotency, receipt/OCR paths | `process-line-webhook.use-case.spec.ts` | 71 passed |

Total focused baseline: **97 passed, 0 failed** after generating the local Prisma client. These tests prove reusable repository primitives, not the new all-questions expense workflow.

### 17.2 Implementation evidence as of 2026-08-19

| Proof gate | Required evidence | Current status |
| --- | --- | --- |
| P-F01 deterministic item/gap engine | `line-expense-draft-conversation.logic.spec.ts`, including paper+laptop, cross-item grounding, category ambiguity, price replacement, and lossless splitting | PASS |
| P-F02 state machine and persistent resume | `line-expense-draft-conversation.use-case.spec.ts` and `expense-draft-concurrency.use-case.spec.ts`, including exact revision pinning and transactional audit | PASS |
| P-F03 webhook integration | `line-intake-dispatch.use-case.spec.ts`, `process-line-webhook.use-case.spec.ts`, and existing signed-webhook controller coverage | PASS |
| P-F04 AI extraction boundary | `line-intake-router.agent.spec.ts` plus deterministic API rejection tests for ungrounded facts, unknown items/categories, and non-expense directions | PASS |
| P-F05 renderer/delivery | Lossless renderer tests plus existing webhook delivery-pending/idempotency regression suite | PASS |
| P-F06 local E2E | Repository whole-chain catalog passes 21 repository scenarios and 3 controlled-external scenarios; a single real-database signed-webhook → outbound artifact run is not yet recorded | PARTIAL |
| P-F07 real LINE OA UAT | Recorded test-account transcript, webhook IDs, draft revisions, audit evidence, screenshots | NOT RUN |
| P-F08 regression | Focused suites, full API/AI Gateway/contracts/config checks, typechecks, and whole-chain harness | PASS — exact final commands/results are recorded in task memory |

The feature flag remains off by default. An approved test company may be enabled only after the missing database-backed P-F06 artifact is recorded. Production rollout is prohibited until P-F07 passes and the product owner accepts the transcript against every acceptance criterion.

## 18. Required real LINE UAT scenarios

The UAT script must capture provider event IDs, internal workflow/draft IDs, revision numbers, outbound transcript, and resulting database/audit evidence for:

1. Paper plus laptop; verify questions for both items appear together.
2. One partial answer; verify snapshot and all remaining questions.
3. Multiple answers in one free-text message.
4. `พัก`, 15 or more intervening turns, then resume.
5. Silence followed by a later resume.
6. `หมด` while complete and while incomplete.
7. Unrelated task while a draft is open.
8. Two resumable drafts requiring selection.
9. Duplicate webhook/redelivery.
10. Simulated outbound delivery failure and retry/recovery.
11. Newer web edit followed by stale LINE answer.
12. Permission/membership revoked between turns.
13. Category ambiguity and separate per-item category suggestions.
14. A clearly non-expense transaction that is not forced into `ExpenseRecord`.

## 19. Release decision

The implementation is ready for code review behind its default-off flag. This is not a release authorization. “Works in production” may be stated only when the proof matrix contains recorded artifacts for every P-F gate, the flag/canary result is accepted, and no acceptance criterion remains inferred solely from AI behavior.
