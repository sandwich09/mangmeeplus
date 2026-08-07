# LINE AI Capture Correction Implementation Plan

## Status

- IMPLEMENTATION LOG (2026-08-04): phases 1–3 built and committed on `develop`; every package suite green (`apps/api`, `apps/ai-gateway`, `packages/contracts`) with `tsc --noEmit` clean. What is NOT built, and why, is listed under "Residual gaps" at the bottom — read that before calling this done.
- State: Approved — phase 0 decisions recorded 2026-08-03 (spec §1/§17); review rounds r2 (7 groups), r3 (4 blockers + P1s), r4 (3 blockers + P1s 4–8), r5 (4 P0 + P1s), and r6 (4 P0: EXP-SEC-01 cross-tenant prerequisite, full duplicate-writer lock coverage, durable clarification consumption, CRM attention-state + notification reconcile; 2 P1) folded into spec+plan 2026-08-03. The EXP-SEC-01 hotfix is implemented and verified locally; correction-feature implementation has not started.
- BLOCKING PREREQUISITE (r6): EXP-SEC-01 — the cross-tenant duplicate-candidate resolution hole (spec §4) is pre-existing and independent of this feature, but correction reconciliation must not ship on top of it. Fix and verify it first (own change/hotfix is fine); phase 2 does not start until it is merged.
- Phase 3 releasability (r4): NOT independently releasable until the CRM LINE webhook surface's `BLOCKED_OWNERSHIP` is resolved.
- r3/r5 headline requirements now binding: tx-aware apply plumbing (no naive wrapping — repo methods self-transact with advisory locks); duplicate-writer lock hierarchy (message → company reconciliation → expense); single-transaction/single-CAS OCR write set; v1 delivery guarantee relaxed (spec §17.10) with clarification ack decoupled from delivery (ack at terminal outcome); CUST-12 precedence matrix + confirm-turn TOCTOU guard + per-message idempotent handoff.
- Release gate (owner 2026-08-03): phases 1+2 ship to UAT together; phase 1 completion is an implementation gate only, not a release. Phase 3 release additionally requires the `BLOCKED_OWNERSHIP` resolution above.
- Rollout order (strict, spec §12): EXP-SEC-01 hotfix merged/verified → enum migration → API deploy → gateway deploy. Never gateway before API.
- Owner: thawatchai
- Date: 2026-08-03 (incident-driven; see spec §1).

## Linked Spec

[[specs/line-ai-capture-correction-spec|LINE AI Post-Capture Correction Spec]] — includes the surveyed gap register (RECEIPT-07..10, CUST-12..13) and the phase definitions this plan implements.

## Purpose

Stop LINE correction messages from creating duplicate expense drafts; make corrections land on the record the user means (guidance first, applied correction second); close the two adjacent leaks the incident exposed (ledger ack, reply honesty); contain the CRM booking reschedule trap.

## Current Repository Context

- Router intents + prompt: `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts` (`LINE_INTAKE_ROUTER_SYSTEM_PROMPT`, `INTAKE_ROUTE_INTENTS`, `INTAKE_MIN_ACTION_CONFIDENCE`, `applyCaptureHintValueGuards`).
- Contracts: `packages/contracts/src/line-ai.ts` (`LineIntakeRouteIntent`, `LineIntakeRouteRequest`, `LineIntakeRoutePlan`, `LineIntakeCaptureHints`), `packages/contracts/src/ai-tools.ts` (`ToolCategory` — note: no `draft_update`; phase 2 does NOT add a model-callable tool, so no category change).
- Dispatcher: `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — text intake branches at ~:745 (capture), ~:789 (signature), ~:805 (clarify); QA-path ledger ack at ~:944 (`openWaiting` → `ledger.ack`); `formatPaypersReply` ~:346; `loadConversationContext` ~:1136.
- Capture (create) path to be bypassed for corrections: `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts` (`CaptureLineExpenseNoteUseCase`).
- Mutation path to reuse: `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts` (`UpdateExpenseDraftUseCase` — permission owner+`expense.update` or `expense.review`, finance-only field list, editable-status gate).
- Ledger: `apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts` (`openWaitingUser`, `ack`).
- CUST-12 containment: `apps/api/src/modules/crm/domain/logic/crm-booking.logic.ts` (`bookingReminderText`), `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.ts` (post-commit reschedule fall-through).

## Implementation Rules

- Ponytail full: shortest correct diff, reuse `UpdateExpenseDraftUseCase`/guard helpers/reply patterns; **no new mutation semantics** (tx-aware signatures/overloads on existing write paths are required and allowed — r3; the advisory-lock key, signed-evidence guards, and material-field checks must survive the refactor byte-for-byte in behavior); no new dependencies; no speculative abstraction for "other record types".
- Deterministic guards decide every write; the model only routes and selects from server-provided candidates (same philosophy as capture hints / value candidates).
- Every phase lands with its focused checks green before the next starts; router prompt changes always land together with router spec cases.
- Additive contract changes only (older gateway keeps working).

## Scope

### In Scope

- Phase 1: correction intent (guidance reply, no correction mutation), durable clarification consumption on intake terminal branches, honest text-note reply values.
- Phase 2: applied corrections through `UpdateExpenseDraftUseCase` with candidate/membership/value guards + provenance + idempotency.
- Phase 3: CUST-12 containment (reminder copy + post-commit reschedule handoff reply/flag).

### Out of Scope

- CRM booking reschedule state machine (own spec/plan; open question 3 in spec).
- CUST-13 contact-fill correction acknowledgement.
- Media re-send supersede (RECEIPT-10 — closed by design), attachment replacement, correction-feature web UI changes, new permissions. The Phase-0 EXP-SEC-01 hotfix's duplicate-resolution UI is the explicit exception.
- Table/column migrations — the single additive `AiTurnIntent.CORRECTION` enum value is the only schema change in scope.
- Category / source-document-type corrections from LINE (spec §5 deferral) and partial multi-field apply.

## Phase 0: Discovery and Alignment

### Goal

Pin the product decisions and clear the security prerequisite before correction mutation work.

### Tasks

- ~~Decide `AiTurn.intent` value~~ — DECIDED 2026-08-03: new `CORRECTION` enum member (additive `AiTurnIntent` migration; `ALTER TYPE ... ADD VALUE`, no data rewrite).
- ~~Confirm `READY_FOR_CONFIRMATION` editability from LINE~~ — DECIDED 2026-08-03: allowed. (Amended r3: `EXTRACTING` is nevertheless excluded from LINE correction candidates — web-parity; see spec §8/§17.2.)
- ~~Confirm phase-1-only ship~~ — DECIDED 2026-08-03: NO; phases 1+2 release to UAT together (see Status release gate).

### Security prerequisite (r6, blocking phase 2)

- EXP-SEC-01 hotfix IMPLEMENTED + VERIFIED LOCALLY, expanded 2026-08-04 (review/merge pending): every current writer enters `runDuplicateCheck`/`resolveDuplicateCandidate`, which take the company reconciliation lock before the expense lock and re-read company/current branch/editable/non-posted state. Normalized-field and checksum scans, detail responses, and resolve targets filter the candidate expense by branch ABAC; detail also redacts a hidden header-level `duplicateOfExpenseId`. Resolution updates only `{ id, companyId, expenseId, status: OPEN }`, requires a 3–500 character reason, chooses one confirmed winner, recomputes the aggregate, and awaits `audit.log(entry, tx)`. Rescan uses status-preserving upsert, soft-closes only visible stale `OPEN` evidence, reopens only system-stale evidence, and never downgrades human/confirmed evidence.
- Specs cover cross-company/wrong-expense/out-of-scope target ids, current and candidate branch gates, hidden candidate preservation, missing expense, terminal + explicit posted state, multi-candidate aggregate/single winner, soft stale closure/reopen rules, confirmed preservation, audit rollback/reason metadata, writer routing (upload/OCR/LINE pending media), pending-media branch propagation, and Web confirm/dismiss paths.
- PASS 2026-08-04 — execution evidence: `prisma validate`; API + Web `tsc --noEmit`; focused cross-surface regressions; full `@watchdog-bms/api` suite; full `@watchdog-bms/web` suite (651/651); `git diff --check`. The workspace lockfile requires pnpm 9, so verification used pinned pnpm `9.15.0`.

### Exit Criteria

Decisions met 2026-08-03 (recorded here, in spec §1/§17, and in task memory). EXP-SEC-01 code, Web journey, and cross-surface specs are implemented and green locally as of 2026-08-04; the prerequisite closes after review/merge. Phase 2 remains blocked until that merge.

## Phase 1: Correction Route + Guidance Reply + Hygiene (api + gateway, no correction mutation)

### Goal

The incident message sequence produces zero new records and a correct, honest reply; the clarification ledger stops leaking.

### Tasks

- Prisma: additive `AiTurnIntent` value `CORRECTION` + migration; `persistIntakeTurn` accepts the new intent for correction turns.
- Contracts: add `'EXPENSE_CAPTURE_CORRECTION'` to `LineIntakeRouteIntent`; add bounded `recentCapturedExpenses` to `LineIntakeRouteRequest`.
- Contracts: `LineIntakeRoutePlan` += `resolvedClarificationIds` (membership-guarded); `LineAiOpenClarification` += `clarifyForIntent`/`candidateExpenseIds` (≤5, gateway bounds-check); NEW runtime export `AI_TURN_INTENT_VALUES` (full enum incl. `CORRECTION`) + REGISTRY entry in `prisma-enum-parity.spec.ts` — the spec has no AiTurnIntent registration today, so the export is created first (distinct from apps/api's local normalization subset `AI_TURN_INTENTS`).
- Gateway: extend `LINE_INTAKE_ROUTER_SYSTEM_PROMPT` route meanings (correction ≠ capture; spend note still needs amount+purpose); add the new intent to `INTAKE_ROUTE_INTENTS` and the low-confidence downgrade guard (downgrade clears hints + uses correction-specific clarify copy); emit `resolvedClarificationIds` for answered entries only.
- Ledger: `sub_request` entries gain `clarifyForIntent` (+ `candidateExpenseIds` when relevant); `openWaitingUser` filters by the turn's `userId`; ack path takes explicit entry ids.
- Durable-marker seam (existing `OutboxEvent`, no schema change): central key builders produce `expense.line_correction.applied:line_message:<companyId>:<lineMessageIdHash>` and `ai.line.clarification.consumed:line_clarification:<companyId>:<ledgerKeyHash>:<entryId>` (`ledgerKeyHash = hashMessagePreview(entry.key)`, never raw chat identity). Marker writes run the existing `validateOutboxPayload`/`redactOutboxPayload` guards, use the caller's `Prisma.TransactionClient`, and throw on failure — do NOT use `OutboxAppendService`, which uses the root client and swallows errors. Marker reads use exact `eventKey + companyId`, batch for open clarifications, and ignore row status. A marker-read error returns a typed temporary-unavailable result that the dispatcher turns into the existing safe retry reply; it must not continue with an empty clarification list. Both marker event types are permanent retention exclusions.
- Capture provenance for chat isolation: ALL THREE capture paths store bounded `chatKeyHash` in `sourceChannelMetadataJson` — text note (`CaptureLineExpenseNoteUseCase`), direct media (`initReceiptUpload` post-update), and pending-media clarify resolution (`createReceiptDraftFromPendingMedia`).
- API dispatcher: populate `recentCapturedExpenses` (new read-only repo query: LINE_UPLOAD + creator + statuses {DRAFT, NEEDS_REVIEW, READY_FOR_CONFIRMATION} — `EXTRACTING` excluded (r3, matches web edit-blocking) + **branch ABAC scope** + **chatKeyHash match** + 24h, take 5, newest first) into `tryRouteIntake`; add the `EXPENSE_CAPTURE_CORRECTION` branch → guidance reply per target matrix (0 → list link; 1 → record summary+link; >1 → list link naming top candidates) with **permission-aware copy** (editable vs view/forward variant per computed `expense.update`/`expense.review`), `persistIntakeTurn` (`CORRECTION`), event log, audit `expense.line_correction.guide`; on delivery failure mark event `delivery_pending` (ops visibility — v1 relaxed delivery, spec §17.10).
- Deterministic clarify inheritance: correction-turn CLARIFY appends its ledger entry with `clarifyForIntent: EXPENSE_CAPTURE_CORRECTION`; dispatcher treats an answer to such an entry as a correction turn without re-classification trust.
- Transactional consumption (r5 timing, r6 durability; scope corrected during implementation 2026-08-04 — clarifications only ever exist on the TEXT path, because `openWaitingUser` is loaded there and media/pending-media events never carry an answer, so the finalizer list is text capture + the guidance/signature/QA text branches, not the media completion paths): pass only `resolvedClarificationIds ∩ same userId` into each terminal finalizer. Text-note capture, receipt/direct-or-pending-media completion, signature-asset creation, and correction apply must insert all consumption markers in the SAME transaction as their final business mutation; add the minimum tx-aware plumbing to those existing finalizers—an after-commit dispatcher append is forbidden. Guidance writes its markers in one short non-swallowing transaction after composing the terminal reply and before delivery. Only after commit does the dispatcher attempt Redis `XACK` as cleanup. Replace the QA path's blanket ack with the same ids; CLARIFY keeps entries open. A concurrent second consumer that loses the marker unique race rolls its mutation back and follows the already-consumed outcome.
- Reply honesty: pass inserted `expenseDate`/`vendorName` from `CaptureLineExpenseNoteUseCase` result into `formatPaypersReply` (text path) so ยังไม่ระบุ only shows for genuinely missing values.
- Register every new spec file in the owning package's `package.json` test list (repo convention — unregistered specs silently never run).

### Tests

- Router spec: correction phrasings → new intent; capture phrasings unchanged; low-confidence downgrade clears hints + correction copy; `resolvedClarificationIds` only for answered entries.
- Dispatch spec: correction branch creates nothing; target matrix grid (0/1/many); cross-user group isolation (B never carries/acks A's entries); same-user cross-chat exclusion (chatKeyHash); revoked-branch exclusion; stale (>24h) exclusion; ack-only-consumed (unrelated waiting entries survive); permission-aware copy per role; text-note reply shows inserted date.
- Ledger/marker specs: `openWaitingUser` userId filter + batched durable-marker suppression; equal Redis ids in different streams do not collide; marker lookup failure yields safe retry + zero dispatch/mutation; Redis absent / `XACK` throw / crash-after-commit; explicit-id ack; `OutboxAppendService` is not called for markers.
- Intake-finalizer specs: text capture, receipt/pending-media completion, and signature creation commit business rows + all consumed markers atomically; marker failure rolls back the business mutation; guidance marker commits before reply delivery.
- Regression: full existing intake dispatch + router suites green.

### Exit Criteria

Incident-shaped fixture (capture → correct-date → clarify → date answer) ends with exactly one expense and a guidance reply carrying its link. Implementation gate only — UAT release waits for phase 2 (owner release gate, Status).

## Phase 2: Applied Correction (mutation via existing draft update)

### Goal

The same sequence ends with the ORIGINAL draft corrected (17 มิ.ย. 2569 → 20 ก.ค. 2569) and a confirmation reply.

### Tasks

- Contracts: add `LineIntakeCorrectionHints` (+ `correctionHints` on `LineIntakeRoutePlan`) — NO `expenseCategoryId`/`sourceDocumentType` (deferred fields).
- Gateway: prompt emits `correctionHints` for the new intent (target from `recentCapturedExpenses` only; amount/expenseDate selected from `valueCandidates`); parse + reuse `applyCaptureHintValueGuards`; strip hints whose target id is not in the request's candidate list (membership guard).
- PREREQ — tx-aware plumbing (r3-1, widened r4-4): `UpdateExpenseDraftUseCase.execute` and repository writes `updateExpense`/`upsertLines` accept an optional injected `Prisma.TransactionClient` (default = today's self-owned transactions, zero behavior change for existing callers); the READS the correction depends on (`findById`/`findByIdWithRelations`) also go through the injected client; thread it into `ExpenseTransactionTaxService.resolveLines(..., db)` (param exists); preserve the `substitute-receipt` advisory-lock key, signed-evidence guards, and material-field checks; use `audit.log(entry, tx)` (in-tx variant THROWS → rollback) for the correction audit; a caller option SUPPRESSES the use case's internal `void expense.review.update` audit on the correction path (no false-positive review audit outside the tx).
- API: new `CorrectLineCapturedExpenseUseCase` (expenses module) implementing the ATOMIC apply unit (spec §8) ON TOP of that plumbing: one outer transaction takes the message-scoped lock (`companyId:lineMessageIdHash:line-correction`) then the company reconciliation lock; exact-prechecks the company-scoped marker `expense.line_correction.applied:line_message:<companyId>:<lineMessageIdHash>` and replays its bounded payload on a hit; locks+re-reads the target (status/creator/branch re-check); resolves target by the matrix (1 candidate, or valid `targetExpenseId`; NEVER newest-fallback); maps the v1 fields; enforces evidence/string/direction guards; applies all-or-nothing; appends capped `corrections[]`; writes in-tx audit; then inserts the apply marker through that SAME tx. The marker stores target id + old→new pairs and is target-independent. Marker/audit failure rolls back everything. A defensive `P2002` is caught only outside the aborted tx, then the exact company-scoped marker is re-read for the confirmation reply.
- OCR single-transaction write set (r3-2, r4-2, structural r5-2): restructure `ReceiptOcrApplyService.apply` so header, lines, duplicate reconciliation + `duplicateStatus`, AND the summary/`missingFields` update currently done afterwards by `RequestReceiptExtractionUseCase` all commit in ONE transaction guarded by ONE `updatedAt` CAS (token captured before the external OCR call), acquiring the company reconciliation lock per the hierarchy; on stale → nothing written, `stale_skipped` returned + audited `expense.ocr.apply_skipped_stale`, and the use case writes nothing further. Apply the same CAS to the `not_expense_document` branch's summary write. Tests cover correction-during-OCR in both orders and stale-skip of every member of the write set.
- In-tx duplicate RECONCILIATION (r3-5, inside r4-2, lock hierarchy r5-1): runs INSIDE the atomic apply transaction, before provenance/audit — recompute matches, close stale OPEN candidates (both relationship directions), use the EXP-SEC follow-up's tx-aware/status-preserving `createDuplicateCandidate`, recompute `duplicateStatus` from the surviving OPEN set, and leave resolved rows untouched.
- Duplicate-writer LOCK HIERARCHY (r5-1, full call-site inventory r6-2): implement the fixed acquisition order — (1) message-scoped advisory lock `companyId:lineMessageIdHash:line-correction` BEFORE target resolution in the correction unit; (2) company-scoped `companyId:duplicate-reconciliation` advisory lock BEFORE any expense advisory lock in EVERY duplicate writer — `CorrectLineCapturedExpenseUseCase`, `CompleteReceiptUploadUseCase` (upload scan), `ReceiptOcrApplyService` follow-up, `DuplicateCheckUseCase` (manual rescan), `ResolveDuplicateUseCase` (human resolve, post-EXP-SEC-01), and the pending-media clarify completion path in `process-line-webhook.use-case.ts`; (3) expense `substitute-receipt` locks via the tx-aware path. Sorted-set locking alone is rejected (deadlocks against the already-held target lock). Concurrent tests: A↔B corrections; same message hash, two deliveries, different model targets → exactly one apply; correction × manual rescan, × human resolve, × pending-media completion → committed reconciliation preserved.
- Grounding evidence set (r4-1): guard evaluation builds evidence = current turn + the `resolvedClarificationIds` entries' stored `text` (candidates recomputed with `todayIso` from each entry's `askedAt`); correction hints use MANDATORY-evidence guards — `applyCaptureHintValueGuards`' empty-candidate skip is closed for corrections (no candidate anywhere in evidence → strip → clarify/guidance); string span checks run against every evidence text.
- Clarify answer revalidation (r3-6): when a correction clarify is answered, re-run the candidate query fresh and intersect with the stored `candidateExpenseIds` — the snapshot is never authorization.
- Structured candidate labels + hint shape (r4-6/7): label builder emits doc-type/date/amount/time only (no vendor/category text); `correctionHints` fields become `{to, from?}` with the direction guard (`from` must equal current value; unprovable direction → clarify); `note` maps to header note only.
- Privacy (r4-8): `lineMessageIdHash` (existing `hashMessagePreview`) replaces raw LINE message ids EVERYWHERE in correction artifacts — `corrections[]`, audit metadata, the idempotency check, and the message-scoped lock key; `corrections[]` capped at 20 in JSON (audit = full history).
- Durable consumption: reuse the phase-1 marker seam/finalizer contract; correction apply inserts company/stream-scoped consumption markers in its atomic transaction, then attempts Redis cleanup after commit.
- Parity spec (3 explicit steps, r5): import the `line-ai.ts` namespace in `prisma-enum-parity.spec.ts`, add it to `SOURCES`, then add the `AI_TURN_INTENT_VALUES`/`AiTurnIntent` REGISTRY entry (the parity spec file is already registered in the contracts package test list).
- Provenance durability: make every `aiVerificationSummaryJson` writer (receipt-ocr-apply, extraction, classification override in `UpdateExpenseDraftUseCase`) merge-preserve `corrections[]`.
- Dispatcher: correction branch tries apply; ambiguous target → clarify naming candidates; ANY field-guard failure → nothing applied, phase-1 guidance reply (never create, never silent drop, no partial apply).
- Reply: confirmation template naming old → new values + web link.

### Tests

- Use case spec: v1 allowlist mapping (deferred fields refused; amount refused on OCR-line/VAT/tax-code targets; `EXTRACTING` target refused), string source-span guard, all-or-nothing multi-field, status gate fallback, provenance + audit + apply/consumption markers in ONE transaction (audit/marker failure → rollback), message-scoped-lock idempotency under concurrent same-message deliveries INCLUDING different model-chosen targets and same hash across companies, A↔B corrections deadlock-free under the lock hierarchy, delivery-fail-after-commit (no re-apply, `delivery_pending`, consumed marker already durable), in-tx duplicate RECONCILIATION after value change (stale OPEN closed both directions; resolutions untouched), old→new audit metadata.
- Tx-plumbing regression: substitute-receipt advisory-lock key + signed-evidence guards behave identically with and without an injected transaction client; existing web PATCH callers unchanged.
- OCR CAS spec: correction lands mid-OCR → stale apply skipped + audited; OCR applies first → correction still applies on fresh read; both orders.
- Summary-writer specs: OCR re-run / extraction / classification override preserve `corrections[]`.
- Dispatch spec: applied vs clarify vs fallback matrix (bad/absent target with many candidates → clarify; posted record, cross-user, cross-chat, ambiguous date, two-field one-failing → nothing applied).
- Router spec: hints emitted only with valid candidate ids.

### Exit Criteria

Incident fixture asserts the original record's date changed, second record never created, audit trail complete.

## Phase 3: CUST-12 Containment (crm)

### Goal

Stop the product from inviting a chat reschedule it cannot perform; give reschedule messages an honest outcome.

### Tasks

- `bookingReminderText`: replace "หากต้องการเลื่อน/ยกเลิก แจ้งได้ในแชทนี้" with staff-contact copy (deterministic string only).
- ~~Discovery subtask~~ — RESOLVED by direct read (r4/r5): flag = `CrmConversation.status → OPEN` + `priority → HIGH` (fields verified on the model); visibility = notification-center event (inbox ordering ignores priority, so the fields alone are insufficient — see notification task below).
- Reschedule/cancel detection in `process-inbound-line-message.use-case.ts`: detect against the ACTUAL booking table — upcoming `CrmBooking.status = 'BOOKED'` for this conversation/customer (`sourceConversationId`/`customerId`, future `startAt`) — never the latest proposal's status (false negatives: CANCELLED/CONFLICTED proposal with a live booking; false positives: BOOKED proposal whose booking staff already cancelled).
- On detection: handoff reply + concrete staff flag (conversation reopen/priority raise + audit `crm.booking.reschedule_handoff` + outbox `crm.booking.reschedule_requested`); skip autonomous booking evaluation for that turn. Detection stays narrow (explicit move/cancel wording) so legitimate NEW bookings from the same customer still evaluate.
- Precedence matrix (r3-4): booking check runs BEFORE `tryResolveBookingProposal`; pending proposals (`PROPOSED`/`AWAITING_CONFIRMATION`) are CANCELLED with audited reason `superseded_by_reschedule_handoff`; `CONFIRMED`/`COMMITTING` proposals are left untouched and their id rides in the flag payload for staff reconciliation.
- Handoff transaction (r3-8, concrete r4-5): ONE transaction under the conversation/customer lock — proposal CAS per matrix + `CrmConversation.status → OPEN`/`priority → HIGH` + audit-existence check + outbox append with `eventKey` idempotencyPart = inbound `CrmMessage.id` via a NON-swallowing append path (current helper's silent catch is unacceptable here); autonomy-job retries therefore cannot double-flag.
- Staff notification (r4-5): reuse the SLA-breach pattern — `CreateOrUpdateNotificationEventUseCase` to assignee + inbox managers (the new-conversation scanner does not cover existing-conversation reschedules; inbox ordering ignores priority — the notification event is the real visibility).
- Final TOCTOU guard (r4-3, moved to confirm-turn r5-3): bookings commit on the explicit-CONFIRM turn, not the reschedule-wording turn — so at proposal commit, re-derive origin intent deterministically from the origin message loaded via `proposal.sourceMessageId` (same reschedule/cancel detector; no schema change); when it fires, COMPOSE the upcoming-`BOOKED` re-check into the commit's `assertWithinTx` alongside the existing `assertAutonomyEnabledWithinTx` (never replace it); the hook throws a TYPED error that the handler routes into the FULL idempotent handoff (flag + outbox + notification + reply policy) — not the generic `HANDED_TO_STAFF` shortcut. Two-turn concurrent test: reschedule-like request → proposal → rival booking commits → confirm → rollback + full handoff.
- Send helper options (r5-P1, third option r6-4): split `capExempt`, `respectSendBlocks`, and `preserveAttentionState` into independent options (today `deterministic=true` consumes the AI cap, `holdingReason` bypasses the kill-switch recheck, and ANY successful send zeroes `unreadCount` and advances status via `statusAfterStaffReply` → `WAITING_CUSTOMER`, undoing the handoff flag); handoff reply uses all three (`capExempt: true, respectSendBlocks: true, preserveAttentionState: true`) — message row and `lastMessageAt`/`lastOutboundAt`/preview still update.
- Notification ensure — real reconciliation (r5-P1, r6-4): fixed order handoff-tx → ensure-notification → reply. `CreateOrUpdateNotificationEventUseCase` is NOT idempotent today (returns early on cooldown before touching recipients; never repairs missing per-channel deliveries when the recipient row exists; `NotificationDelivery` has no `@@unique([recipientId, channel])`). Extend the safety-trigger path to take a company+dedup-key advisory lock and use ONE notification transaction that ensures the event, current assignee/manager recipients, and exactly one web + one LINE delivery per recipient; cooldown never short-circuits reconciliation. Every caller of this safety-trigger ensure uses the same lock. The autonomy retry path runs it even when audit/outbox rows exist or newer outbound short-circuits the rest. Alternative: add the delivery unique constraint, which reopens schema scope.
- Proposal CAS after TOCTOU rollback (r6-P1a): in the handoff transaction, CAS a `COMMITTING` proposal (whose booking just rolled back) to `HANDED_TO_STAFF`; the "untouched" rule stays only for the pre-check path where a commit may genuinely be in flight.
- Release dependency (r4-5): CRM LINE webhook surface is `BLOCKED_OWNERSHIP` — no gate exists to ride; resolving that ownership is a phase 3 release PRECONDITION (phase 3 is not independently releasable until then).

### Tests

- Attention-state spec: after a handoff reply the conversation is still `OPEN`/`HIGH` with unread preserved; notification ensure reconciles missing deliveries and is not skipped by cooldown; `COMMITTING` → `HANDED_TO_STAFF` CAS after a TOCTOU rollback.
- Logic spec for the reminder copy; inbound use case spec covering ALL booking/proposal status combinations: real BOOKED booking + cancelled/conflicted proposal → handoff (no false negative); staff-cancelled booking + BOOKED proposal → normal evaluation (no false positive); handoff turn creates no proposal/booking row and raises the flag + audit + outbox exactly once.

### Exit Criteria

No autonomous booking can be created by a message referencing an already-booked appointment.

## Integration Verification

All packages run `tsx --test` with an explicit spec-file list in `package.json` — new spec files MUST be added to that list or they never run. Requires installed workspace dependencies (`pnpm install`).

- Contracts: `pnpm --filter @watchdog-bms/contracts test` (includes `prisma-enum-parity.spec.ts`, which must pass with the new enum value).
- API focused: `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts src/modules/line-ai/application/line-ai-ledger.service.spec.ts src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.spec.ts src/modules/crm/domain/logic/crm-booking.logic.spec.ts` plus every NEW spec file.
- Gateway focused: `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/line-intake-router.agent.spec.ts src/modules/line-ai/agents/intent-router.agent.spec.ts`.
- Schema: `pnpm --filter @watchdog-bms/api exec prisma validate`; migration reviewed as additive-only (`ALTER TYPE "AiTurnIntent" ADD VALUE 'CORRECTION'`).
- Full suites before release: `pnpm --filter @watchdog-bms/api test`, `pnpm --filter @watchdog-bms/ai-gateway test`, plus each package's build/typecheck via the existing turbo pipeline.
- Manual UAT replay on uat-mangmeeplus: original incident sequence; group-chat cross-user correction; same-user cross-chat correction; correction after web confirmation; concurrent redelivery.
- Verify ledger state via Redis after UAT replay (no stuck `waiting_user` entries; unrelated entries survived).
- UAT data cleanup (audited web actions, never direct DB): edit expense `cms63g60k0073225t1pvbyndi` date 17 มิ.ย. 2569 → 20 ก.ค. 2569 via web PATCH flow; remove stray note `cms63kejl007k225tljnqx1b5` via the existing delete-expense flow.
- Ops runbook — `delivery_pending` (forensic only, no production reader today): periodically inspect `LineWebhookEventLog` rows stuck at `delivery_pending` (correction confirmations whose reply AND push both failed); the record itself is already corrected — verify via the expense audit trail; adding a real monitor/alert is future work, tracked with the durable-replay fast-follow (spec §17.10).

## Risks

- Router misclassifies genuine new spend notes as corrections → capture volume drops. Mitigation: correction requires recent-candidate context (server sends none → model told capture remains valid); regression corpus in router spec; monitor `line.intake-route` intent mix after deploy.
- Prompt growth degrades routing quality → keep route-meaning additions ≤ 6 lines; rerun business-query regression corpus.
- Concurrency/idempotency → message-scoped lock + in-lock check inside the single apply transaction (spec §8), tested with concurrent same-`lineMessageId` deliveries including different model-chosen targets; the webhook event-claim stays as outer layer.
- Company-wide reconciliation lock contention → duplicate writes are low-frequency per company; accepted v1 ceiling (ponytail note in code), upgrade path = computed lock-sets.
- A duplicate writer added later without the hierarchy silently reintroduces the race → the hierarchy is asserted in one shared helper that every writer must call (grep-able), plus the cross-writer concurrent specs above.
- Outbox marker rows accumulate and the workflow drain may record a second unmatched-inbox row → accepted at this low volume; payloads are bounded/redacted and marker event types are explicit retention exclusions. Revisit with a dedicated marker table only when measured growth or an outbox-retention policy makes that simpler.
- Tx refactor regressing substitute-receipt/signed-evidence guards → guards + advisory-lock key covered by regression specs before the correction use case lands; default-parameter design keeps existing callers on today's code path.
- In-flight OCR overwriting a fresh correction → `updatedAt` CAS + both-interleavings tests; `EXTRACTING` excluded from candidates.
- Lost confirmation after commit (relaxed v1) → push fallback + `delivery_pending` event for ops; risk accepted by decision §17.10, fast-follow recorded.
- Provenance loss on OCR re-run → merge-preserve rule + summary-writer specs; audit row is the durable fallback either way.
- Out-of-order deploy re-opens the bug (new gateway + old API routes corrections to QA path) → strict rollout order in Status; release checklist item.
- Group-chat ledger leak → per-user filter + ack-only-consumed, covered by dispatch/ledger specs.
- CUST-12 detection heuristic too broad (blocks legitimate new bookings) → detection limited to explicit move/cancel wording + actual upcoming BOOKED booking; spec'd tests cover false-positive and false-negative sides.

## Open Questions

Tracked in spec §17 — items 1–3 resolved / timing-resolved 2026-08-03; remaining open: reschedule design choice (owned by the upcoming CUST-12 spec) and the deferred quick-reply affordance (phase 2 polish).


## Residual gaps after the phase 1–3 implementation (2026-08-04)

Recorded so the next reviewer does not have to rediscover them.

- **Phase 3 confirm-turn TOCTOU guard — NOT built.** The containment gate stops a reschedule
  message before autonomous booking, which closes the reported path. The narrower race the spec
  also names — a rival booking committed between the gate and a LATER confirm turn — still needs
  the `AutonomousBookingTxHooks.assertWithinTx` composition described in §7.2.5.
- **Phase 3 notification + send-policy — PARTIALLY built.** The handoff flags the conversation
  (`OPEN`/`HIGH`), audits, and appends an outbox event keyed on the inbound message. It does NOT
  yet raise a notification-center event, and the reply goes out through the existing
  `holdingReason` path rather than the `capExempt` × `respectSendBlocks` × `preserveAttentionState`
  split the spec asks for. `holdingReason` happens to preserve conversation status (the status
  update is skipped for holding messages, covered by test), but it also bypasses the kill-switch
  recheck, and whether the outbound append clears `unreadCount` is unverified.
- **Phase 3 release gate unchanged**: the CRM LINE webhook surface is still `BLOCKED_OWNERSHIP`.
- **Correction candidate query** rides the existing `(companyId, captureSource)` index; the
  upgrade index is named in a code comment if volumes ever demand it.
- **Plan scope correction (already folded above):** media and pending-media completion cannot
  consume clarifications — only the text path loads them — so those finalizers were deliberately
  left alone.
