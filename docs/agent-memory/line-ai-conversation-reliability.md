# Agent Memory: line-ai-conversation-reliability

Status: Reported customer and employee UAT paths plus silent-failure hardening implemented; focused automated verification passed; deployed real-LINE UAT pending.
Owner: Product / AI Platform
Scope: Cross-flow LINE AI reliability for end-customer CRM Q&A + booking and employee shared-OA Q&A, including context, ordering, fallback, delivery truth, retry, clarification, and handoff.
Decisions:
- One outcome contract covers both surfaces, but customer and employee agents, tools, repositories, permissions, and prompts remain hard-separated.
- A turn is not customer-visible complete until LINE reply/push returns `ok`; model/tool/database completion alone is insufficient.
- Customer fixes reuse `CrmMessage`, `CrmAutonomyJob`, booking proposals, and existing outbound retry.
- Employee fixes reuse `LineWebhookEventLog` plus the existing Redis Streams ledger; no new dependency or database outbox is planned.
- Only delivered assistant/staff output may enter model context. Operational SYSTEM messages and pending/failed outbounds are excluded.
- Customer booking confirmation must become semantic/contextual; deterministic code remains authoritative for proposal provenance, expiry, slot availability, idempotency, permissions, consent, and commit.
- Assigned employee/branch resolution falls through to a valid compatible channel default; saving corrected employee configuration is sufficient, with no delete/recreate requirement.
- The configured channel default employee and branch are one pair. Runtime must not silently replace the configured channel branch with a different employee default branch.
- Autonomous booking revalidates the active staff-to-branch scope inside the final booking transaction.
- Existing customers reuse a saved usable name and phone. New LINE customers
  must provide an explicit booking name and phone; incomplete existing
  customers provide only missing fields.
- Booking contact collection is proposal-scoped and survives unrelated Q&A.
  The deterministic review must show service, date, start-end time,
  location/branch, name, and phone; only a later confirmation may commit.
- The delivered booking review is the authoritative confirmation snapshot. A
  change to service, slot, branch, name, or phone forces a new review and
  confirmation; the final transaction rejects an unreviewed contact change.
- Contact writes fill gaps without replacing concurrent staff data, and the
  final booking transaction revalidates contact before writing.
- Typed customer intake/reply refusal or provider failure returns public catalog/unavailable copy. Only a true high-confidence complaint/human route may use the staff-contact acknowledgement.
- Employee `AiTurn` and webhook completion advance only after LINE returns `ok`; failed delivery leaves the existing turn ledger open and excluded from conversation history.
- Employee webhook success now requires a durable event-log row. A failed
  enqueue propagates as non-2xx so LINE can redeliver instead of losing the
  accepted event.
- Unexpected buffer dispatch errors produce a durable `delivery_pending`
  record and one explicit unavailable delivery attempt rather than only a log.
- LINE reply/push and media download are time-bounded. API-to-AI time budgets
  cover the existing multi-call turn/OCR windows, and internal AI/CRM workers
  have a bounded HTTP wait.
- Failed AI draft, CRM inbox, and LINE ledger repeatable-job registration is
  logged and retried with the existing interval.
- Existing employee in-memory buffer remains accepted until permanent multi-instance scale or observed ordering incidents trigger the documented shared-buffer upgrade.
- Ponytail full applied: fix root boundaries, reuse existing storage/queues, no speculative shared framework or new dependency.
Open questions:
- Real-OA UAT must confirm the deployed customer calendar row, complete LINE summary, post-booking follow-up, employee push recovery, and absence of silent turns.
- The existing employee turn ledger recomputes a normal read/draft turn on retry under current permissions. Exact rendered-payload retry for every early deterministic response remains a separate hardening decision; no new ledger payload/schema was added in this pass.
- Operational alerts/dashboard reconciliation for aged/parked delivery remain rollout evidence, not yet verified locally.
Artifacts:
- `docs/specs/line-ai-conversation-reliability-spec.md`
- `docs/plans/line-ai-conversation-reliability-plan.md`
- Customer code: CRM context, autonomy ordering/fallback, booking proposal/commit, channel default validation, and customer prompt files under `apps/api/src/modules/crm*` and `apps/ai-gateway/src/modules/crm-customer-ai/`.
- Employee code: delivery-aware webhook and ledger drain under `apps/api/src/modules/line-ai/application/use-cases/`.
Verification:
- Repository/docs/code audit completed for customer context, autonomy, booking proposal/commit, outbound delivery/retry, employee webhook processing, conversation context, LINE adapter, and ledger drain.
- UAT evidence reviewed: customer ordinary question refusal/holding/silence; truncated slot presentation; natural confirmation not committed; no booking calendar row; post-journey silence.
- Local deterministic confirmation check previously reproduced natural confirm
  phrases such as `จองครับ`, `ตามนั้นค่ะ`, and `เอาเวลานี้เลยค่ะ` falling to
  `UNCLEAR`.
- Fresh AWS log query is currently blocked by expired `aws-demo` session; existing UAT/log evidence remains recorded in `docs/agent-memory/uat-ai-not-responding.md`.
- API focused regression (customer CRM Q&A/booking plus employee webhook/ledger): 296/296 passed in the final combined pass.
- Silent-path hardening regression: 80/80 focused API tests passed, including
  webhook redelivery, buffer dispatch fallback, deterministic rich delivery,
  LINE delivery timeout wiring, and AI Gateway timeout wiring.
- Worker retry helper test: 1/1 passed. API and workers typechecks passed.
- Booking contact regression covers new-customer name/phone collection,
  existing-customer reuse, detailed review, premature confirmation, unrelated
  Q&A, cancellation, disappearing contact, reviewed-data changes, and final
  transaction rejection.
- AI Gateway customer intake/reply focused regression: 22/22 passed.
- Direct API and workers TypeScript checks passed.
Next:
- Inspect the scoped diff and commit only this task without staging concurrent
  expense/AI usage work.
- If approved, deploy only UAT and run Phase 6 customer and employee real-OA
  checks there. Keep production disabled.
