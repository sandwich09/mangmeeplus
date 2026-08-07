# LINE AI Conversation Reliability and Continuity Spec

## 1. Status

- Status: Implemented for the reported UAT paths; real LINE integration UAT pending
- Date: 2026-07-26
- Owner: Product / AI Platform
- Scope: customer-facing CRM LINE OA and employee-facing shared LINE OA
- Execution plan: `docs/plans/line-ai-conversation-reliability-plan.md`
- Task memory: `docs/agent-memory/line-ai-conversation-reliability.md`

This spec is a cross-flow reliability contract. It does not replace the
customer and employee product specs. Where an older document permits a turn to
be marked complete before its customer-visible delivery is known, or permits a
legitimate turn to end silently, this spec supersedes that behavior.

## 2. Goal

Every eligible LINE message must reach one truthful terminal outcome:

1. the requested answer or action result is delivered;
2. one bounded clarification is delivered;
3. an explicit handoff or unavailable response is delivered and the turn is
   visible in an actionable staff/retry queue; or
4. an intentional-silence policy is applied and audited.

The system must not report a turn as completed merely because an AI model,
tool, or database step completed. Customer-visible delivery is part of
completion.

The same reliability rule applies to:

- end customers asking business questions;
- end customers discovering availability and making a booking;
- employees asking operational or business questions;
- employee multi-intent questions, clarification continuations, and ledger
  follow-ups;
- deterministic replies such as greetings, access guidance, company selection,
  mutation refusal, booking confirmation, and booking cancellation.

## 3. Source Documents

Customer flow:

- `docs/specs/crm-line-oa-customer-os-spec.md`
- `docs/plans/crm-line-oa-customer-os-plan.md`
- `docs/plans/crm-conversation-ai-toggle-codex-handoff.md`
- `docs/specs/crm-line-oa-customer-os-spec.md` §24, §25, §27–§33

Employee flow:

- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/specs/line-ai-local-agent-orchestration-spec.md`
- `docs/specs/line-ai-business-query-coverage-spec.md`
- `docs/specs/line-ai-message-buffering-spec.md`
- `docs/specs/line-ai-multi-intent-completion-spec.md`
- `docs/specs/line-ai-assistant-ux-spec.md`
- `docs/adr/0010-line-ai-turn-ledger-redis-streams.md`

Security and platform:

- `docs/specs/permission-matrix.md`
- `AGENTS.md`

## 4. Product Problem and UAT Evidence

### 4.1 Customer question continuity

UAT showed a normal first-time question receiving only the deterministic
holding message:

> ได้รับข้อความแล้วค่ะ เจ้าหน้าที่จะรีบติดต่อกลับนะคะ

The next legitimate question then received no response. The question was not a
duplicate; the reply agent returned a refusal, and holding-message dedup
suppressed another acknowledgement.

The current context window can classify outbound `SYSTEM` messages as `STAFF`,
so a prior automated holding or greeting may look like a human staff response
to the next model call. Customer-visible outbound rows are also loaded without
requiring successful delivery, allowing failed or pending messages to become
false conversational history.

### 4.2 Customer booking continuity

UAT showed all of the following in one booking journey:

- the availability reply displayed only 12:30–14:30, while 15:00 was still a
  valid slot omitted by the display limit;
- a later request for 15:00 created a proposal despite the earlier wording
  implying the displayed list was complete;
- natural confirmation text such as `จองครับ` did not confirm because the
  current confirmation path uses a deterministic phrase list;
- the AI asked for name and phone, but the dialogue did not distinguish a new
  customer from an existing CRM customer whose saved contact may be reused;
- the booking was not committed, so no booking appeared in the calendar;
- the final response was a staff-contact holding message, not a booking result;
- a later unrelated question received no answer.

The deterministic confirmation phrase list conflicts with the existing product
decision that booking confirmation must be semantic and contextual.

### 4.3 Employee Q&A delivery truth

The employee flow already has useful protections: fast webhook acknowledgement,
single-instance per-chat buffering/serialization, permission-checked tools,
multi-intent coverage, and a Redis Streams follow-up ledger.

However, the live turn currently:

1. persists `AiTurn`;
2. marks `LineWebhookEventLog` completed;
3. acknowledges open ledger entries; and only then
4. attempts LINE delivery as best effort.

`sendReply()` can return `failed_other` or `skipped`, but the caller does not
turn those outcomes into retryable delivery state. The reply-token push
fallback also ignores the push result. The ledger drain similarly acknowledges
`followed_up` without checking whether `sendPush()` returned `ok`.

Consequences:

- the employee can receive no reply while the event and turn appear complete;
- a failed reply can enter short-term conversation context as though the
  employee saw it;
- a clarification or follow-up can be acknowledged and permanently disappear
  after a failed push.

## 5. Personas and Channel Boundaries

### 5.1 Customer-facing company OA

- Actor: end customer, with or without linked CRM identity.
- Authority: public/company-scoped information and the customer's permitted
  journey only.
- Allowed final AI mutation: booking only, through existing deterministic API
  guardrails.
- Forbidden: employee ERP tools, other-customer data, finance/ledger/inventory
  internals, direct database access.

### 5.2 Employee-facing shared OA

- Actor: linked active employee with a currently active company membership.
- Authority: current permission and branch/ABAC scope.
- Allowed behavior: read, summary, clarification, and explicitly allowed draft
  creation.
- Forbidden: final money, accounting, stock, tax, approval, permission, export,
  or external-publishing mutation.
- Tools must remain behind the permission-checked WatchDog API boundary. AI
  Gateway and AgentCore must not access ERP repositories directly.

### 5.3 Hard separation

- Customer messages never enter the employee intent router or employee tools.
- Employee messages never enter CRM customer prompts or booking autonomy.
- Prompts, agent families, tool allowlists, and internal endpoints stay
  separate.
- This spec shares an outcome vocabulary and test matrix, not a new shared
  agent, repository, or delivery framework.

## 6. Canonical Turn Outcome Contract

Each accepted inbound source message or buffered employee segment has one
`sourceTurnId`. A turn may progress through internal work, but it is not
customer-visible complete until one terminal outcome is recorded.

| Outcome | Meaning | Delivery required | Retry/handoff required |
| --- | --- | --- | --- |
| `ANSWER_DELIVERED` | Grounded answer reached LINE | yes | no |
| `CLARIFICATION_DELIVERED` | One concrete clarification reached LINE | yes | open clarification may remain |
| `ACTION_RESULT_DELIVERED` | Booking/cancel/draft result reached LINE | yes | no |
| `HANDOFF_DELIVERED` | Honest handoff reached LINE | yes | actionable staff queue required |
| `UNAVAILABLE_DELIVERED` | Typed temporary/permanent unavailable result reached LINE | yes | retry when temporary |
| `DELIVERY_PENDING` | Response exists but LINE did not confirm acceptance | no | durable retry required |
| `INTENTIONAL_SILENCE` | Product policy intentionally sends nothing | no | audit reason required |
| `FAILED_TERMINAL` | Delivery/action cannot safely continue after bounded retries | no | visible operations/staff queue required |

Model outcomes such as `refused`, `needsHuman`, `uncertain`, provider errors, or
coverage gaps are intermediate routing signals. None is a silent terminal
customer outcome.

## 7. Shared Reliability Rules

### R1. Latest-source targeting

- The AI prompt and deterministic orchestration must identify the exact source
  message or buffered segment being answered.
- Prompt instructions must say to answer the latest customer/employee input,
  while using older turns only as context.
- Before a send, the pipeline must verify that the response is still current.
  A response generated for an older turn must not be delivered after a newer
  turn in the same conversation unless it is an explicit, labeled follow-up.

### R2. Ordered processing

- Employee processing keeps the existing per-chat buffer and serial queue.
- The webhook returns success only after its event row is persisted and the
  payload is accepted into the buffer. Persistence or append failure returns
  non-2xx so LINE can redeliver the source payload.
- An unexpected post-ack buffer failure records `delivery_pending` and attempts
  one explicit unavailable reply; it must not remain an unexplained
  `received` row.
- Customer autonomy jobs must be claimed in durable oldest-first order per
  conversation. Concurrent workers must not evaluate two open turns from the
  same conversation at once.
- A later turn may coalesce behind an earlier one, but it must not overtake it.
- Final booking mutation keeps the existing transaction lock and idempotency
  guards; turn ordering is additional and does not replace them.

### R3. Delivered context only

- Inbound messages may enter context once durably accepted.
- Assistant/staff/system output may enter model-visible context only when it was
  confirmed delivered.
- Holding messages, greetings, audit/status text, failed outbounds, pending
  outbounds, and internal notes must not masquerade as human staff answers.
- Each context role must be explicit: `CUSTOMER`/`EMPLOYEE`, `AI`, `STAFF`, or
  excluded operational `SYSTEM`.
- Tool-derived facts in employee history remain non-authoritative; current
  permission-checked tools are the business source of truth.

### R4. Delivery is explicit

- Every LINE adapter call returns a typed outcome.
- `ok` is the only immediate delivered result.
- `failed_token` may attempt push fallback; the push result must also be checked.
- `failed_other` and `skipped` are not success.
- A business event or ledger entry is acknowledged as delivered only after the
  final LINE call returns `ok`.
- Network ambiguity is treated as retryable with the existing idempotency and
  duplicate-tolerance rules; it is never silently recorded as delivered.
- LINE delivery, LINE media download, API-to-AI Gateway calls, and
  worker-to-API calls have bounded request timeouts. Repeatable drain/sweep
  schedule failures are logged and retried on their normal cadence.

### R5. Every legitimate turn gets an outcome

Legitimate text must not end at `reply_refused` or an equivalent internal
status. The fallback order is:

1. grounded answer/action result;
2. one bounded clarification;
3. typed unavailable response when the provider/tool cannot answer;
4. honest handoff placed in an actionable staff queue.

Intentional silence is limited to:

- high-confidence spam;
- channel/global/conversation autonomy disabled where the product explicitly
  defines pure human mode;
- revoked consent on the customer OA;
- unsupported event types that the applicable source spec explicitly ignores.

Every intentional-silence result records the exact reason.

### R6. Handoff must be true

A message promising staff contact may be sent only when the conversation or
turn is visible in the staff inbox/queue with unread/pending state. If no such
queue transition is confirmed, the copy must not claim that staff will contact
the user.

Holding-message dedup:

- is based on delivered operational messages, not text equality alone;
- never suppresses the real answer to a later source turn;
- resets after any delivered AI/staff answer;
- may suppress repeated acknowledgements during one unresolved burst only.

### R7. Plain LINE-safe content

- LINE replies use plain text unless they are intentionally constructed Flex
  messages.
- Customer and employee prompts must not emit Markdown markers.
- Customer reply normalization removes accidental Markdown emphasis/list
  artifacts before delivery without altering business values.
- Dates, times, amounts, names, and IDs must remain unchanged by formatting.

### R8. Bounded retry and truthful failure

- Retries must preserve company, channel/chat, actor, source turn, and original
  response/action identity.
- A retry for an older ordinary answer must not deliver after a newer answered
  turn. It is superseded or converted to an explicitly labeled follow-up.
- Transactional outcomes already committed, especially booking/cancellation,
  must remain retryable until their result is delivered or staff is alerted.
- After the delivery cap, the turn becomes `FAILED_TERMINAL` and must be
  observable/actionable; it must not disappear.

## 8. Customer Q&A Requirements

### C1. Context construction

- Query only customer-visible text with outbound `deliveryStatus = SENT`.
- Map inbound as `CUSTOMER`, sent AI as `AI`, sent human staff as `STAFF`.
- Exclude deterministic holding, delivery-error text, and other operational
  `SYSTEM` rows from the model window.
- A deterministic greeting may be retained only as `AI` conversational context
  if it was delivered; it must never be represented as human staff.
- Tag operational messages in existing message metadata instead of inferring
  their type from exact Thai copy.

### C2. Ordinary answer fallback

- The reply agent receives the exact latest source message and bounded context.
- `needsHuman`, malformed output, empty draft, provider timeout, and
  `reply_refused` map to a specific public outcome, not silence.
- A first-time catalog/service question must be answered from the
  customer-visible catalog/templates when data exists.
- If the company has no relevant public data, the reply must say that the
  information is unavailable and either ask one clarification or create a real
  handoff.

### C3. Customer turn serialization

- `CrmAutonomyJob` is the durable ordering authority.
- Only the oldest runnable job for one conversation may be processing.
- Context is loaded after the job owns that position.
- A crash/deploy leaves the job retryable.
- A retry checks channel/conversation/consent gates and whether a newer delivered
  answer already superseded the response.

## 9. Customer Booking Requirements

### B1. Explicit booking state

The booking dialogue uses an explicit state machine:

`DISCOVERY → SLOT_PROPOSED → COLLECTING_CONTACT (when required) → REVIEW_PENDING
→ COMMITTING → BOOKED`

Terminal alternatives:

`CANCELLED`, `EXPIRED`, `CONFLICTED`, `HANDED_TO_STAFF`.

- An existing active customer with a usable saved name and phone reuses those
  values; the AI must not ask for them again.
- A new LINE customer must provide an explicit booking name and phone. A LINE
  profile display name alone is not an explicit booking name.
- An incomplete existing customer is asked only for the missing field.
- Contact collection is explicit booking state tied to the active proposal. An
  unrelated question may be answered normally without losing that state or
  treating the question as a name.
- Contact writes fill booking gaps only. They must not overwrite a phone or a
  staff-edited name that became authoritative concurrently.
- The final booking transaction rechecks that a usable name and phone still
  exist. Missing contact never commits a booking.

### B2. Detailed review and double confirmation

After the slot and contact are complete, the AI must send a deterministic
review containing all of:

1. service/court;
2. booking date;
3. start and end time;
4. location/branch;
5. booking name; and
6. phone number.

The booking remains uncommitted until the customer confirms after receiving
that review. The delivered review is the authoritative confirmation snapshot.
If service, date/time, location/branch, name, or phone changes before commit,
the AI sends the updated review and requires another confirmation. The final
transaction rechecks the reviewed contact snapshot so a concurrent edit cannot
commit unreviewed data. Cancellation remains available during contact
collection and review. After commit, the success message repeats the confirmed
snapshot and states that the booking is confirmed.

### B3. Semantic confirmation

- Explicit cancellation remains a deterministic, fail-closed command.
- Natural confirmation understanding is model-driven and contextual while a
  proposal is active; deterministic phrases are only a safe fast path.
- Examples that must be understood in context include `จองครับ`, `ตามนั้น`,
  `เอาเวลานี้`, `โอเคค่ะ`, `ยืนยัน`, and equivalent Thai/English wording.
- Deterministic code still owns proposal provenance, expiry, consent,
  idempotency, slot recheck, transaction lock, and final mutation.
- `UNCLEAR` never commits. It produces one state-aware clarification or routes
  a clearly unrelated question through ordinary Q&A without losing the active
  proposal.

### B4. Staff and branch resolution

Resolution order:

1. assigned active employee plus an active, accessible default branch;
2. channel default active employee plus active channel default branch;
3. actionable staff handoff.

An assigned employee without a valid default branch does not suppress a valid
channel fallback. Employee and branch must be validated as a compatible,
active pair at settings time and revalidated at proposal/commit time.

Editing and saving an existing employee is sufficient once the active
membership, position, branch access, and default branch are valid. Deleting and
recreating the employee is not required.

### B5. Availability copy

- Availability is always computed by deterministic API logic with current
  bookings, buffer, branch, staff, duration, and current time.
- A limited display says it is partial, for example “5 ช่วงแรกจาก 8 ช่วง”.
- A slot omitted only because of the display limit remains valid, but the prior
  wording must not imply it was unavailable.
- General availability uses neutral copy. Conflict copy is used only when the
  user requested a specific unavailable slot.
- The proposed slot must be included in the confirmation question.

### B6. Commit and result

- A booking is successful only when a booking row is committed.
- The success response contains at least:
  - service/court;
  - date;
  - start and end time;
  - branch/location when available;
  - confirmed status.
- Price is included only when sourced from a captured catalog/booking value; it
  is never invented.
- If the booking committed but delivery failed, the state is
  `BOOKED + DELIVERY_PENDING`, not a rollback and not ordinary handoff.
- Booking/cancel/conflict/expired results bypass ordinary AI reply refusal and
  remain retryable as deterministic business outcomes.
- A calendar/inbox view must agree with the message. No “จองสำเร็จ” is sent
  before commit, and no committed booking is described as “เจ้าหน้าที่จะติดต่อ
  กลับ” without the actual booking summary.

## 10. Employee Q&A Requirements

### E1. Identity, company, and permission

- Resolve active LINE identity, user, company membership, selected company, and
  permissions at every live turn.
- Re-resolve permission and branch scopes for ledger follow-ups.
- Unlinked, inactive, ambiguous-company, forbidden, and mutation requests get a
  deterministic, delivered response unless the applicable source spec
  explicitly defines silence.
- No prompt or context may grant authority.

### E2. Subject-safe routing and complete answers

- The intake router distinguishes employee business subjects and never exposes
  customer-OA agents/tools.
- Every detected sub-request receives one grounded answer, one clarification,
  or one explicit unavailable reason, preserving user order.
- Empty/forbidden/unavailable data are distinct outcomes.
- The response composer may use only current permission-checked tool results for
  business facts.

### E3. Delivery-aware turn lifecycle

The employee event lifecycle is:

`received → processing → response_ready → delivered`

Retry alternatives:

`delivery_pending → delivered` or `delivery_pending → failed_terminal`.

- `AiTurn` may be persisted before delivery for audit, but
  `LineWebhookEventLog.status = completed/delivered` is written only after LINE
  returns `ok`.
- A generated answer whose delivery failed remains `delivery_pending`.
- The main turn ledger may close after business computation, but a durable
  retry entry must remain open until LINE delivery succeeds or the entry is
  parked. The current read/draft path may recompute under current permissions;
  exact rendered-payload replay is a separate hardening requirement.
- Existing Redis Streams infrastructure is reused; no new queue dependency or
  database model is required for this reliability pass.

### E4. Reply-token fallback

- `failed_token` triggers push.
- The push result is authoritative:
  - `ok` → delivered;
  - `failed_other`/`skipped` → delivery pending;
  - another invalid-target/permission terminal response → failed terminal and
    operational alert.
- All early deterministic reply sites use the same checked delivery helper.

### E5. Ledger follow-up

- The drain acknowledges `followed_up` only after `sendPush()` returns `ok`.
- A failed push remains claimable until the configured delivery cap.
- A parked entry is observable and includes reason, delivery count, company,
  chat key hash, source turn, and response type without raw secrets.
- A waiting clarification is not considered resolved until the response to the
  resolving turn is delivered or its delivery entry remains open.

### E6. Conversation context

- User previews may enter context after accepted processing.
- Assistant reply preview enters context only when its event is delivered.
- Existing permission filtering of reply previews remains.
- A failed or skipped LINE response must not cause a later answer to say or
  imply “as I said earlier”.

### E7. Buffer and multi-instance boundary

The current in-memory buffer and serial queue remain accepted for single
instance and temporary canary overlap. This task does not replace them.

A shared Redis/DB buffer becomes required only when:

- the API is permanently scaled to more than one active instance; or
- telemetry shows cross-instance fragment splitting or reply-order incidents.

Delivery durability is not deferred by this acceptance; it uses the existing
ledger now.

## 11. Failure Mode Matrix

| Flow | Failure | Required outcome |
| --- | --- | --- |
| Customer Q&A | reply agent refuses first legitimate question | clarification, unavailable response, or real handoff; never silent |
| Customer Q&A | previous holding exists | later question still receives its own outcome |
| Customer Q&A | failed outbound exists | excluded from model context and holding dedup |
| Customer Q&A | two rapid inbound messages | oldest-first processing; no stale answer overtakes |
| Customer Q&A | final cap changes during model call | typed cap/handoff outcome or intentional-silence reason per policy |
| Customer booking | assigned employee has no valid branch | use compatible channel default, else real handoff |
| Customer booking | availability list is truncated | copy labels truncation; omitted valid time is not called unavailable |
| Customer booking | natural confirmation | semantic classification; commit only on contextual confirm |
| Customer booking | proposal expired | explicit expired response and new discovery path |
| Customer booking | booking committed, LINE fails | booking remains; result queued for retry and staff alerted at cap |
| Customer booking | conflict at final insert | deterministic conflict + current alternatives delivered/retried |
| Employee Q&A | reply token expired | checked push fallback |
| Employee Q&A | reply network error | delivery pending; not completed |
| Employee Q&A | access token missing | skipped is delivery pending/operational error, not success |
| Employee Q&A | ledger follow-up push fails | entry stays unacked and reclaimable |
| Employee Q&A | answer failed delivery | assistant preview excluded from later context |
| Employee Q&A | multi-intent partial answer | uncovered sub-request remains in ledger |
| Employee Q&A | permission revoked before follow-up | explicit refusal if deliverable; ledger audited terminal |
| Both | provider timeout | typed temporary unavailable or retry/handoff |
| Both | duplicate webhook/job | idempotent one visible outcome |
| Both | crash after business result before send | durable delivery retry |

## 12. Observability and Operations

Every turn records:

- surface: `customer_oa` or `employee_oa`;
- company and conversation/chat hash;
- source message/event/job id;
- classification/route and confidence where applicable;
- response type;
- business state (`none`, `proposal`, `booked`, `cancelled`, `draft`, etc.);
- delivery path (`reply`, `push`, `retry`);
- delivery result and provider status class;
- attempt count and terminal reason;
- whether the output was admitted into conversation context.

Required counters:

- accepted inbound turns;
- delivered answers/clarifications/action results/handoffs;
- intentional silence by reason;
- model refusal/malformed/provider failure by agent;
- reply-token fallback attempts and success rate;
- delivery pending, retry success, and failed terminal;
- holding sent and holding dedup suppressed;
- booking proposed/confirmed/booked/booked-not-yet-delivered;
- employee ledger open/reclaimed/followed-up/parked.

Operational alerts:

- committed booking result reaches delivery cap;
- employee/customer delivery-pending age exceeds SLA;
- `completed` event without a delivered outcome;
- spike in `reply_refused`, `skipped`, or `failed_other`;
- employee ledger parked entries above zero;
- customer conversation has new inbound but no terminal outcome.

Do not log access tokens, reply tokens, raw phone numbers, raw LINE IDs, full
message bodies, model secrets, or signed actor delegations.

## 13. Security and Data Boundaries

- Tenant/company checks apply at intake, tool/API read, retry, and final
  mutation/delivery boundaries.
- Customer consent is rechecked before automated customer sends and booking
  commit.
- Employee membership/permission/branch scopes are rechecked before tool calls
  and ledger follow-up.
- Delivery retries never broaden data scope or reuse stale permissions.
- AI Gateway remains separate from ERP core and receives bounded context only.
- Customer and employee contexts are never joined.
- Existing preview/hash retention rules remain; any bounded delivery payload in
  Redis inherits the ledger TTL and must exclude secrets.

## 14. Acceptance Criteria

### Customer Q&A

- [x] A first-time “ขายอะไรบ้าง” question receives a grounded answer when a
  visible catalog exists.
- [x] `reply_refused` cannot be a silent terminal result.
- [x] A delivered holding does not suppress a later legitimate answer.
- [x] Failed/pending/system operational outbounds are absent from AI context.
- [x] Two rapid customer turns are processed oldest-first from fresh context.
- [x] Customer-facing plain text contains no literal Markdown emphasis markers.

### Customer booking

- [x] General afternoon availability labels a partial list when truncated.
- [x] Asking for an omitted but valid 15:00 slot produces a truthful proposal.
- [x] The semantic confirmation contract and prompt cover `จองครับ`, `ตามนั้น`,
  and `เอาเวลานี้` for the active
  delivered proposal; unrelated questions do not.
- [x] An existing customer with saved name/phone reuses them without another
  contact question.
- [x] A new LINE customer provides an explicit name and phone before review;
  an incomplete customer is asked only for missing fields.
- [x] The pre-commit review contains service, date, start-end time,
  location/branch, name, and phone, and no booking exists before the customer's
  final confirmation.
- [x] An unrelated question during contact collection is answered without
  being stored as a name or losing the active booking state.
- [x] The final booking transaction rejects missing contact after concurrent
  changes.
- [ ] Real LINE UAT confirms that a booking appears in the calendar and the customer receives a
  complete deterministic summary.
- [x] A committed booking with failed notification is persisted for retry and never reported
  as unbooked.
- [x] Saving a corrected employee/default branch makes the configuration usable
  without deleting and recreating the employee.

### Employee Q&A

- [x] A normal employee question is completed only after reply or push returns
  `ok`.
- [x] `failed_other` and `skipped` do not become completed delivery state.
- [x] A failed push fallback is not ignored.
- [x] Ledger drain does not acknowledge `followed_up` after failed/skipped push.
- [x] An undelivered employee answer is excluded from later assistant context.
- [x] A clarification resolution is not acknowledged when its response delivery fails.
- [x] Multi-intent, permission refusal, provider unavailable, company picker,
  and deterministic guard replies use the same delivery outcome contract.
- [x] A failed durable enqueue returns non-2xx instead of acknowledging and
  losing the webhook event.
- [x] LINE delivery, LINE media download, AI Gateway, and internal retry-worker
  HTTP calls are time-bounded.

### Cross-flow

- [ ] Customer agents cannot call employee tools; employee router cannot call
  customer booking agents.
- [ ] Duplicate webhook/job/retry produces no duplicate booking and at most one
  equivalent visible answer.
- [ ] Dashboards/logs can reconcile accepted inbound turns to delivered,
  intentional-silence, delivery-pending, or failed-terminal outcomes.
- [ ] Focused automated tests and real UAT LINE journeys pass for both OAs.

## 15. Non-goals

- No new omnichannel abstraction.
- No new model provider or dependency.
- No customer access to employee tools.
- No expansion of employee final-mutation permissions.
- No replacement of the existing booking transaction/locking design.
- No permanent shared employee message buffer until its documented scale trigger
  occurs.
- No redesign of the inbox UI beyond status/actionability needed to expose
  delivery pending or handoff.
- No attempt to guarantee exactly-once external delivery; business mutation is
  exactly-once/idempotent, while LINE delivery is at-least-once with bounded
  duplicate tolerance.

## 16. Release Gate

This reliability work is complete only when:

1. the focused customer and employee suites pass;
2. a contract test proves only delivered assistant output enters context;
3. a delivery-failure test proves the retry remains open;
4. the customer booking UAT journey produces a real calendar row and summary;
5. an employee question and a ledger follow-up both survive forced reply/push
   failure;
6. no regression expands customer data/tool access or employee mutation rights;
7. the UAT environment records zero unexplained accepted-turn-without-outcome
   cases during the agreed observation window.
