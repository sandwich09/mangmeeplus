# LINE AI Conversation Reliability and Continuity Plan

## 1. Status

- Status: Reported UAT paths implemented and automatically verified; real LINE UAT pending
- Date: 2026-07-26
- Spec: `docs/specs/line-ai-conversation-reliability-spec.md`
- Memory: `docs/agent-memory/line-ai-conversation-reliability.md`
- Target branch: `develop`

## 2. Delivery Strategy

Fix the shared failure class at each existing boundary, without combining the
customer and employee agents or adding a new framework:

- customer flow reuses `CrmMessage`, `CrmAutonomyJob`, booking proposals, and
  existing outbound retry;
- employee flow reuses `LineWebhookEventLog`, the LINE reply adapter, and the
  existing Redis Streams ledger;
- both flows adopt the same semantic outcome contract through tests and
  observability, not a new cross-module runtime abstraction.

No new dependency is planned. Avoid a database migration unless implementation
proves existing `contentJson`, event status, and ledger fields cannot represent
the required states.

### Implementation checkpoint

Completed in this pass:

- webhook enqueue failures now return non-2xx for LINE redelivery, and an
  accepted row cannot be treated as durable when the event store or in-memory
  append fails;
- unexpected post-ack buffer dispatch failures are parked as
  `delivery_pending` and attempt a truthful unavailable reply;
- LINE reply/push, LINE media download, endpoint-specific AI Gateway calls,
  OCR, and worker-to-API calls are bounded by timeouts;
- deterministic rich LINE replies now stop the flow on failed delivery, while
  repeatable AI/LINE/CRM worker jobs retry and log scheduling failures;
- customer context admits only delivered non-operational output;
- typed intake/reply refusal and provider failure degrade to a truthful public
  catalog/unavailable reply instead of a holding-message dead end;
- customer autonomy is oldest-first per conversation;
- booking availability copy discloses truncation, semantic confirmation is
  contextual, existing contact is reused, new/incomplete contact is collected,
  and both pre-commit review and post-commit copy contain the complete booking
  summary;
- channel default employee/branch is validated as one compatible pair at save,
  proposal, and final autonomous commit boundaries;
- employee AI turns remain `PROCESSING`/`ERROR` and webhook events remain
  `delivery_pending` until LINE reply or push returns `ok`;
- ledger follow-up is acknowledged only after confirmed push delivery.

Still required before closing the release gate:

- customer and employee real-OA UAT against the deployed environment;
- operational reconciliation/alert verification for parked or aged delivery;
- a follow-up hardening pass if the product requires exact rendered-payload
  retry for every early deterministic employee response. The current existing
  turn ledger safely retries normal read/draft AI turns by recomputing them
  under current permissions rather than storing an additional payload shape.

## 3. Baseline Findings

### Customer-facing OA

- `SYSTEM` outbounds are mapped to `STAFF` in the model window.
- customer context does not filter outbound delivery status.
- reply refusal becomes `reply_refused`, then holding; a later holding can be
  suppressed by text-based dedup and leave silence.
- autonomy jobs are durable but launched concurrently per inbound message.
- confirmation relies on deterministic phrases despite the semantic-confirm
  product rule.
- slot display truncates to five without disclosing that more valid slots
  exist.
- assigned employee without branch blocks channel default fallback.
- success notification is not a complete booking summary and can fail after
  commit.
- customer prompts can emit Markdown that LINE displays literally.

### Employee-facing OA

- buffering and per-chat serialization exist in one API instance.
- `AiTurn`, event completion, and ledger acknowledgement happen before LINE
  delivery.
- `failed_other`/`skipped` are ignored by the main delivery helper.
- reply-token fallback does not inspect the push result.
- ledger drain acknowledges follow-up after any `sendPush()` result.
- undelivered assistant previews can enter later conversation context.

## 4. Phase 0 — Freeze Evidence and Add Regression Fixtures

### Work

- Add sanitized UAT scenarios to focused test fixtures:
  - customer first-time catalog question;
  - holding followed by a new question;
  - availability truncation and request for an omitted valid slot;
  - semantic booking confirmation;
  - booking success notification failure;
  - employee reply `failed_other`;
  - employee fallback push failure;
  - ledger drain push failure;
  - undelivered reply excluded from context.
- Capture current failing assertions before implementation.
- Keep UAT identifiers and personal data out of fixtures and logs.

### Expected files

- `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.spec.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-auto-reply.use-case.spec.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-assist.use-case.spec.ts`
- `apps/api/src/modules/crm-inbox/domain/logic/crm-auto-reply.logic.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts`

### Exit

- Each reported failure has one focused red test at its root boundary.

## 5. Phase 1 — Customer Context and Honest Fallback

### Work

1. Correct context roles:
   - inbound → `CUSTOMER`;
   - delivered AI/deterministic greeting → `AI`;
   - delivered human → `STAFF`;
   - operational `SYSTEM` → excluded.
2. Filter customer outbound context to sent/delivered rows.
3. Tag holding/greeting/operational outbounds in existing `contentJson`; stop
   inferring operational meaning from exact Thai text.
4. Pass the exact source/latest message identity into the customer prompt and
   require the reply to answer it.
5. Replace silent `reply_refused` handling with a typed fallback:
   - one bounded clarification;
   - typed unavailable response; or
   - real handoff.
6. Make holding dedup inspect delivered operational metadata only and scope
   suppression to one unresolved burst.
7. Add customer LINE plain-text prompt instruction and a small deterministic
   normalizer for accidental Markdown markers.

### Expected files

- `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-assist.use-case.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-auto-reply.use-case.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.ts`
- `apps/api/src/modules/crm-inbox/infrastructure/crm-ai-context.repository.ts`
- `apps/api/src/modules/crm-inbox/domain/logic/crm-auto-reply.logic.ts`
- `apps/ai-gateway/src/modules/crm-customer-ai/agents/crm-customer-reply.agent.ts`
- focused specs beside those files

### Smallest-diff rule

Reuse `CrmMessage.contentJson` and existing delivery status. Do not add a new
message subtype table or a shared prompt framework.

### Exit

- A first-time legitimate question cannot finish at `reply_refused`.
- Failed/pending/operational output cannot become false staff context.
- A holding does not silence a later turn.

## 6. Phase 2 — Customer Durable Turn Ordering

### Work

1. Make the job repository claim only the oldest runnable
   `CrmAutonomyJob` for one conversation.
2. Load the conversation and context after the job owns the conversation
   position.
3. When a job completes, trigger the next pending job for that conversation.
4. At the final send boundary:
   - recheck channel/conversation/consent/cap gates;
   - verify no newer delivered response supersedes the source;
   - mark stale ordinary replies superseded rather than pushing them late.
5. Preserve current crash retry, idempotency key, and booking transaction locks.
6. Update retry selection so pending/failed outbound rows do not count as a
   newer delivered answer.

### Expected files

- `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.ts`
- `apps/api/src/modules/crm-inbox/infrastructure/prisma-crm-inbox.repository.ts`
- customer autonomy job repository port/records and focused specs

### Smallest-diff rule

Use the existing durable job rows and status transitions. Do not introduce a
second queue or an in-memory-only customer lock.

### Exit

- Two rapid customer messages evaluate oldest-first with fresh context across
  concurrent workers.
- Crash/retry cannot deliver a stale answer after a newer delivered turn.

## 7. Phase 3 — Customer Booking Dialogue and Result

### Work

1. Keep explicit cancellation and bare affirmative commands as deterministic
   fail-closed paths, then use the CRM intake semantic classifier for natural
   contextual confirmation:
   - invoke it only with an active delivered proposal and bounded context;
   - keep all mutation guardrails deterministic.
2. Add explicit contact collection tied to the active proposal:
   - reuse a saved usable name and phone for an existing customer;
   - require explicit name and phone for a new LINE customer;
   - ask an incomplete existing customer only for missing fields;
   - fill gaps without overwriting concurrent staff edits;
   - keep the state active when an unrelated question is answered.
3. Add a deterministic double-confirm review containing service, date,
   start-end time, location/branch, name, and phone. Commit only after the
   customer confirms this delivered review, then repeat the details in the
   success message. Persist the delivered review snapshot with the outbound
   message; if a reviewed field changes, send a new review and require another
   confirmation. Recheck the reviewed contact snapshot in the final
   transaction.
4. Fix employee/branch fallback:
   - validate active assigned employee + accessible active branch;
   - fall through to the channel default compatible pair when invalid/missing;
   - hand off only when neither pair resolves.
5. Validate the compatible default employee/branch pair at settings write time.
6. Split general-availability and conflict response templates.
7. Mark truncated availability lists, for example `5 ช่วงแรกจาก N`.
8. Expand deterministic booking success copy with service/court, date,
   start-end, branch, name, phone, and confirmed status; include price only
   from stored source data.
9. Make booking/cancel/conflict/expired notifications delivery-retryable and
   independent of ordinary AI refusal/caps after the business result exists.
10. Keep `BOOKED + DELIVERY_PENDING` distinct from booking failure.

### Expected files

- `apps/api/src/modules/crm-inbox/domain/logic/crm-booking-proposal.logic.ts`
- `apps/api/src/modules/crm-inbox/domain/logic/crm-auto-reply.logic.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-auto-reply.use-case.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.ts`
- `apps/api/src/modules/crm/infrastructure/prisma-crm.repository.ts`
- channel settings validator/use case and focused specs
- `apps/ai-gateway/src/modules/crm-customer-ai/agents/` booking agent files
- API↔gateway CRM booking contracts and focused specs

### Smallest-diff rule

Reuse the booking proposal row, delivered outbound metadata, and existing
status/CAS/transaction locks. Add no schema or generic workflow engine.

### Exit

- The UAT tennis-court journey produces one real booking and one complete
  delivered summary.
- Natural contextual confirmation works; unrelated questions never commit.
- Existing contact is reused; new/incomplete contact is collected; the detailed
  review is delivered before the final confirmation can commit.
- Correcting employee/branch configuration works after save, without employee
  recreation.

## 8. Phase 4 — Employee Delivery-Aware Completion

### Work

1. Change the common employee delivery helper to return a final typed result:
   - reply `ok` → delivered;
   - reply `failed_token` + push `ok` → delivered;
   - any final `failed_other`/`skipped` → pending/terminal as classified.
2. Route all deterministic reply sites through that result; do not ignore it.
3. Change event lifecycle:
   - persist turn/audit as `response_ready`;
   - mark event `completed` only after delivery `ok`;
   - mark `delivery_pending` otherwise.
4. Reuse the Redis Streams ledger entry as the durable retry authority. For the
   current read/draft path, recompute under current permissions; defer exact
   rendered-payload persistence to a separate hardening pass.
5. Acknowledge the delivery entry only after reply/push returns `ok`.
6. Keep the business-computation turn entry separate from delivery state so a
   provider retry does not repeat successful tool work unnecessarily.
7. At the delivery cap, park the entry and emit an operational alert.
8. Exclude assistant reply preview from conversation context unless the linked
   webhook event is delivered.

### Expected files

- `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts`
- `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts`
- focused specs for adapter/use case/ledger/drain

### Smallest-diff rule

Reuse `LineWebhookEventLog.status` (free-form), Redis Streams, TTL, delivery cap,
and worker drain. Do not add a database outbox or another worker unless the
existing ledger cannot safely preserve the bounded payload.

### Privacy bound

Any future delivery payload must be bounded, TTL-limited, and contain no access
tokens, reply tokens, raw LINE ID, signed delegation, or unrestricted tool
result. The current implementation adds no new payload.

### Exit

- `failed_other` and `skipped` cannot become completed.
- A failed push remains reclaimable.
- An undelivered assistant preview is absent from future context.

## 9. Phase 5 — Employee Clarification and Follow-up Closure

### Work

1. In ledger drain, inspect `sendPush()` and acknowledge `followed_up` only on
   `ok`.
2. Leave failed follow-ups claimable; park at the configured cap.
3. Do not close a waiting clarification merely because its resolving AI turn
   computed. Close it after delivered response, or link it to the open delivery
   entry.
4. Apply current identity, company, permission, and scope checks before every
   follow-up.
5. Preserve multi-intent coverage semantics: answered, one clarification, or
   explicit unavailable per sub-request.
6. Exercise company picker, unlinked, forbidden, mutation refusal, provider
   error, tool error, and multi-intent replies through the checked delivery
   helper.

### Expected files

- `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts`
- focused specs

### Exit

- Kill-after-compute and forced-push-failure tests leave an open retry.
- A successful retry delivers and then empties the relevant ledger entry.

## 10. Phase 6 — Cross-Flow Integration and UAT

### Automated verification

Run the smallest relevant checks first, then the affected package suites:

```text
node --import tsx --test <focused customer spec files>
node --import tsx --test <focused employee spec files>
pnpm -C apps/api test
pnpm -C apps/ai-gateway test
pnpm -C packages/contracts test
pnpm -C apps/api typecheck
pnpm -C apps/ai-gateway typecheck
```

Use the repository-supported Node version. Do not use `tsx -e` where the local
IPC sandbox prevents it; `node --import tsx` is the verified fallback.

### Customer UAT journey

1. Greeting.
2. First-time “ขายอะไรบ้าง”.
3. Follow-up product/service detail.
4. Ask for tennis-court recommendation.
5. Ask general afternoon availability.
6. Select a valid slot omitted from the first limited display.
7. For a new customer, provide name and phone; for an existing customer,
   verify saved contact is reused.
8. Verify the pre-commit review contains service, date, start-end time,
   location/branch, name, and phone, while the calendar still has no booking.
9. Confirm the review with `จองครับ`.
10. Verify the complete success summary in LINE.
11. Verify the booking row in the online-booking calendar.
12. Ask an unrelated new question after booking; verify a fresh answer.
13. Force reply/push failure after commit; verify retry and no duplicate booking.

### Employee UAT journey

1. Linked employee asks one permitted business question.
2. Ask a three-intent Thai question; verify all three outcomes in order.
3. Trigger one clarification and answer it.
4. Ask a forbidden/final-mutation question; verify deterministic refusal.
5. Expire the reply token; verify push success.
6. Force reply and push failure; verify `delivery_pending`, then recover and
   verify retry.
7. Force ledger follow-up push failure; verify it remains open and later
   delivers.
8. Ask a follow-up after a failed delivery; verify the model does not assume the
   missing answer was seen.

### Separation tests

- Customer request cannot invoke any employee tool.
- Employee request cannot invoke CRM customer booking agents.
- Permission revocation between compute and retry fails closed.
- Company switch/tenant scope does not leak context across companies.

### Operational verification

- Reconcile accepted inbound count with delivered + intentional silence +
  delivery pending + failed terminal.
- Inspect `reply_refused`, holding dedup, push fallback, parked ledger, and
  booked-not-yet-delivered metrics.
- Live UAT must be performed only after environment credentials are valid.

### Exit

- All acceptance criteria in the spec are evidenced.
- No unexplained silent turn remains in the UAT observation window.

## 11. Rollout

1. Deploy customer context/fallback fixes first because they are low-risk and
   directly address current UAT silence.
2. Deploy customer ordering and booking semantic confirmation behind the
   existing CRM autonomy kill switches.
3. Deploy employee delivery-aware status with ledger enabled and verify Redis
   reachability.
4. Canary using logs/audit only during bake, following the existing deployment
   runbook.
5. Run one customer and one employee real-OA journey after the revision is
   stable.
6. Roll back by disabling the applicable AI/autonomy flag; never roll back to a
   state that reports failed delivery as completed.

## 12. Risks and Controls

| Risk | Control |
| --- | --- |
| Duplicate external LINE delivery after ambiguous network failure | stable source/delivery id, bounded retry, duplicate-tolerant copy |
| Duplicate booking | existing proposal CAS, idempotency, staff lock, slot recheck |
| Redis unavailable | main employee turn still computes; delivery remains non-complete and operations are alerted |
| Customer queue stalls behind poisoned job | bounded attempts, terminal failure + next-job release |
| Semantic confirm false positive | active delivered proposal + bounded context + confidence + deterministic final guards |
| Handoff promise without staff action | require actionable inbox state before promise |
| Context exposes stale permissions/data | delivery filter plus current permission/tool re-resolution |
| Payload retention in ledger | bounded rendered message, TTL, no secrets/raw identity |
| Concurrent dirty worktree | touch only scoped files; stage/commit explicit paths |

## 13. Definition of Done

- Product behavior, state transitions, permissions, delivery semantics, and
  failure outcomes match the spec.
- Customer and employee focused tests fail before and pass after the change.
- Backend↔AI Gateway contracts and LINE adapter outcomes are verified.
- Real UAT proves both question-answer and booking/employee follow-up journeys.
- Docs, implementation checklist, and task memory record actual deviations and
  verification commands.
- Only scoped files are committed; unrelated worktree changes remain untouched.
