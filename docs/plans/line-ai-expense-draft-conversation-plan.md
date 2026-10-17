# LINE AI Expense Draft Conversation Implementation Plan

Status: IMPLEMENTED AND LOCALLY REVIEWED BEHIND A DEFAULT-OFF FLAG — P-F06 database-backed artifact and P-F07 real LINE OA UAT remain before rollout; no deployment is authorized.

Date: 2026-08-19

Specification: `docs/specs/line-ai-expense-draft-conversation-spec.md`

## 1. Delivery objective

Fix-up 2 (2026-10-15): default grounded total/payee item descriptions before materialization; expose actual source-draft missing fields and offer category repair through existing draft-edit preview/confirm then round-2 action cards; ignore unsupported current-message continuation hints. Verify registered focused specs, full dispatch/webhook/feature-coverage/orchestrator specs, contracts build, API and gateway package typechecks. No new flags, dependencies, package edits or live operations.

Deliver the smallest permission-safe LINE workflow that persists incomplete multi-item expense drafts, accepts free-text answers, displays the current draft on every accepted turn, asks all remaining questions together, and resumes independently of short-term AI context.

The code-review deliverable is complete only when implementation and deterministic regression evidence pass. Release readiness remains separate and additionally requires the database-backed E2E artifact and recorded real LINE UAT in the specification proof matrix.

## 2. Architecture decision for phase 1

Reuse existing boundaries and patterns:

- `ExpenseRecord` remains the normal draft root.
- `ExpenseLine` contains only financially valid materialized lines.
- `ExpenseRecord.sourceChannelMetadataJson.lineExpenseDraftContinuation` holds bounded incomplete item state, question IDs, provenance, and workflow state.
- `updatedAt`/target revision provides compare-and-swap protection.
- Existing webhook log, turn/outbox delivery, linked identity, permission, category, audit, tax, and total-calculation mechanisms remain authoritative.
- AI Gateway returns structured candidates through permission-checked tools/APIs and never writes repositories.
- No new dependency and no Prisma migration in the initial implementation.

If bounded metadata cannot safely meet query, retention, or concurrency requirements, stop and write an ADR for a dedicated continuation table. Do not silently add a second source of truth.

## 3. Work record

### Phase 0 — Freeze contracts and proof harness — COMPLETE

1. Add stable control intents and response/result contracts for expense draft collection in the existing contracts package.
2. Define the versioned continuation parser and maximum metadata/text sizes.
3. Create fixtures for signed LINE text events, linked identity, company categories, multiple items, duplicates, and stale revisions.
4. Record the existing 97-test baseline command/results before behavior changes.

Likely files:

- `packages/contracts/src/line-ai.ts`
- existing LINE/expense test fixture modules

Exit evidence:

- Contracts compile.
- Existing tests remain green.
- No final financial mutation exists in the new contract.

### Phase 1 — Deterministic item and completeness engine — COMPLETE

1. Implement pure logic to normalize item candidates without discarding incomplete items.
2. Generate stable item references and stable question IDs.
3. Compute document, item, classification, and web-only blockers together.
4. Keep unknown numeric facts absent; never create fake price values. Owner decision 2026-10-15: grounded total-only items use quantity `1` unless a quantity was stated (spec §7.1/AC-04).
5. Separate human category, accounting class, item behavior, account, and tax suggestions.
6. Render the full compact draft and all unresolved questions from deterministic state.

Likely new files following existing module conventions:

- `apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.ts`
- `apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts`

Minimum tests:

- Paper plus laptop produces two items and questions for both.
- Document gaps and every item gap appear in one ordered list.
- Partial answers preserve every unanswered field.
- Blank, question, hypothetical, invalid number/date, and low-confidence candidate do not clear a gap.
- Stable IDs remain stable after unrelated fields change.
- Category suggestions are per item and separate from accounting/tax axes.
- Rendering splits at provider limits without dropping or duplicating a question.

Exit evidence: P-F01 passes with direct mapping from tests to AC-01 through AC-05 and AC-13.

### Phase 2 — Durable continuation repository and use case — COMPLETE

1. Add a strict parser for `lineExpenseDraftContinuation`; ignore/fail safe on malformed or unsupported versions.
2. Implement start, answer, pause, resume, end-input, cancel-conversation, interrupted pause, and stale transitions.
3. Materialize a safe `ExpenseRecord DRAFT` with provisional source date and no fabricated financial line.
4. Materialize/update `ExpenseLine` only after existing invariants are satisfied and recalculate totals with existing helpers.
5. Persist field provenance and audit/outbox records.
6. Use CAS against current expense revision for every write.
7. Resolve one exact workflow or return `TARGET_REQUIRED` with no mutation.

Likely files:

- new use case under `apps/api/src/modules/expenses/application/use-cases/`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- expense module provider registration
- focused use-case/repository specifications

Minimum tests:

- Resume succeeds after the in-memory/Redis AI context is absent and after 15+ unrelated turns.
- Pause and end-input have different states.
- End-input incomplete stores missing fields but stops active questioning.
- Cancel never deletes expense/evidence.
- Multiple active drafts require selection.
- Cross-user/company/chat and revoked access fail closed.
- A stale revision cannot overwrite a newer web edit.
- Same webhook/message identity is idempotent.
- Database mutation and audit evidence are transactional.

Exit evidence: P-F02 passes and covers AC-06 through AC-12 and AC-14.

### Phase 3 — AI extraction boundary — COMPLETE

1. Extend the existing LINE AI intake contract to return bounded structured candidates: control intent, target reference, document facts, item facts, item mapping, and classification suggestions.
2. Require source spans/confidence where the current contract supports them.
3. Treat model output as untrusted candidates; the API completeness engine owns validation and completion.
4. Add deterministic fallback parsing for stable question IDs and labeled answers so ordinary answering does not depend on probabilistic model behavior.
5. Reject embedded prompt instructions from OCR/receipt/source text.

Likely files:

- `apps/ai-gateway/src/modules/line-ai/` orchestrator/response contract modules
- `packages/contracts/src/ai-tools.ts`
- API LINE intake dispatch adapter

Minimum tests:

- Model omission cannot remove a known item.
- Model suggestion cannot set reviewer-only fields.
- Invalid category ID, amount, or date is rejected.
- Question-ID/labeled answers work with AI unavailable.
- Non-expense direction does not create an expense.

Exit evidence: P-F04 passes with a fake/deterministic model provider.

### Phase 4 — LINE webhook orchestration — COMPLETE

1. Insert the dedicated workflow resolver after signature/identity/permission/buffering checks and before generic clarification handling.
2. Detect control intents before mapping ordinary answers.
3. Route unrelated tasks without consuming their text as draft data, then show a resume capsule.
4. Preserve existing receipt/media/OCR behavior and allow the same deterministic engine to compute remaining fields.
5. Retain generic one-clarification behavior outside this dedicated workflow.

Likely files:

- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.ts`
- associated focused specs

Minimum tests:

- Signed webhook reaches the correct draft once.
- Answer, pause, end, cancel, resume, target selection, and unrelated task route correctly.
- Permissions and membership are re-resolved each turn.
- Existing receipt/OCR and non-expense LINE scenarios do not regress.

Exit evidence: P-F03 passes.

### Phase 5 — Response and delivery truth — COMPLETE

1. Render “accepted”, “current draft”, “all still needed”, state controls, and review boundary in the specified order.
2. Split messages deterministically within current LINE limits while preserving draft reference and question numbering.
3. Reuse reply/push/outbox behavior so a provider error is stored as delivery pending, not false completion.
4. Make retries idempotent and render from the latest committed version.

Minimum tests:

- Long multi-item draft loses no item/question.
- Duplicate delivery retry sends the same logical version without another data mutation.
- Next inbound message after failed outbound delivery sees the committed answer.

Exit evidence: P-F05 and AC-15 pass.

### Phase 6 — Web review parity — PARTIAL BY DESIGN

1. Ensure existing expense review can display materialized values, source wording, missing fields, and continuation state without granting LINE new final authority.
2. Display stale/current revision conflicts using existing update behavior.
3. Ensure reviewer changes invalidate or recompute obsolete question/suggestion state safely.

Prefer existing expense detail UI and metadata presentation patterns. Do not build a new web wizard merely to complete LINE collection.

Exit evidence:

- Existing review shows materialized header/line values and `aiVerificationSummaryJson.missingFields`.
- Incomplete staged items remain visible in the LINE snapshot and continuation metadata, but are not rendered as financial lines in the current web UI until quantity and price satisfy line invariants.
- Existing loading/error/permission states remain correct.
- A newer web edit is protected from stale LINE overwrite.

### Phase 7 — Local E2E and regression — PARTIAL

Build a deterministic local path:

1. Send a correctly signed LINE-like webhook.
2. Resolve a linked identity and active company permissions.
3. Create/update the database draft and continuation.
4. Capture the exact outbound LINE payload/transcript.
5. Query resulting draft, lines, metadata version, audit, webhook, and delivery evidence.

Run:

- all new unit/use-case/integration tests;
- the existing focused 97-test baseline;
- relevant API, AI Gateway, contracts, type, and lint checks selected by touched files;
- the repository E2E path when available.

Exit evidence: P-F08 passes and repository whole-chain scenarios pass. P-F06 remains partial until one real-database signed-webhook → stored draft/audit → outbound payload artifact is recorded.

### Phase 8 — Real LINE OA UAT — NOT RUN

Use a non-production or approved UAT company and linked test users. Execute every scenario in section 18 of the specification. For each scenario retain:

- timestamp and test user/company;
- LINE screenshots/transcript;
- `webhookEventId`, workflow ID, expense ID, and revision sequence;
- accepted/rejected fields and question set per turn;
- final expense/line/metadata/audit/delivery evidence;
- expected versus actual result and approver.

No production claim is allowed from mocked webhook tests alone.

Exit evidence: P-F07 passes and the product owner signs the UAT result.

### Phase 9 — Controlled rollout — FLAG COMPLETE, ROLLOUT NOT STARTED

1. Add a narrowly scoped feature flag, default off: `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED` or the repository-equivalent configuration pattern.
2. Enable for the UAT company only.
3. Observe duplicate, stale, denied, extraction-fallback, delivery-failure, and abandoned-draft metrics without logging sensitive message bodies.
4. Canary a small approved company set.
5. Roll back by disabling the feature flag; keep existing drafts/evidence readable and resumable through a safe web path.

Any UAT or Production deploy must follow `docs/runbooks/uat-production-v2-deployment.md` at execution time. This plan does not authorize a deployment.

## 4. Test traceability

Implementation PRs must attach a table mapping every AC-01 through AC-16 to a test name or real-UAT artifact. An acceptance criterion with only a code-review assertion is incomplete.

| Acceptance | Deterministic repository evidence | Live evidence |
| --- | --- | --- |
| AC-01, AC-02, AC-04 | `preserves every item and asks only the next required gap without inventing paper numbers`; `does not borrow another item number as evidence for an incomplete item` | P-F07 pending |
| AC-03, AC-13 | `accepts several numbered answers, keeps the full snapshot, and leaves only real gaps`; `applies several answers with CAS, materializes valid lines, and returns all remaining questions` | P-F07 pending |
| AC-05 | paper+laptop advisory assertions; category ambiguity/negation tests; `fails closed on a clearly non-expense direction even when model hints look complete` | P-F07 pending |
| AC-06 | `keeps pause, end-input, cancel, and resume as distinct non-financial states`; use-case no-final-mutation test | P-F07 pending |
| AC-07, AC-14 | `resumes from the database after the entire 15-turn AI context has unrelated content`; persistent route-context test | P-F07 pending |
| AC-08 | `parks an open draft for an unrelated business question and appends a resume capsule`; both interruption use-case tests | P-F07 pending |
| AC-09 | `fails closed when several drafts exist and no exact target is selected`; explicit `ร่าง N` selection test | P-F07 pending |
| AC-10 | `uses the revision of the loaded continuation snapshot for CAS, not a later detail read`; optimistic-concurrency and pinned-next-revision assertions | P-F07 pending |
| AC-11 | permission resolver runs before draft discovery; cross-user/watchdog-auth/closed-status authority tests; capture denial test | P-F07 pending |
| AC-12 | `a duplicate continuation webhook applies its answer exactly once`; `redelivery with the same LINE message id returns the existing expense without creating another draft` | P-F07 pending |
| AC-15 | `keeps a committed continuation answer and marks delivery pending when LINE fails`; existing delivery-pending recovery suite | P-F07 pending |
| AC-16 | allowed-field whitelist, DRAFT-only authority, finance-field rejection, and no-final-mutation state test | P-F07 pending |

At minimum, the proof bundle contains:

- exact commands and zero-failure results;
- deterministic paper+laptop transcript;
- database state before/after each accepted answer;
- >15-turn resume transcript with the short-term context absent;
- duplicate event, stale edit, permission revocation, and delivery failure evidence;
- real LINE test-account transcript and screenshots;
- explicit evidence that no confirm/approve/pay/post/export/delete endpoint was invoked.

## 5. Operational observability

Add structured, non-sensitive events for:

- workflow started/resumed/paused/input-ended/cancelled;
- answer candidates accepted/rejected by reason;
- question count and item count, not raw content;
- target-required and stale conflicts;
- duplicate suppression;
- permission denial;
- outbound delivery pending/retried/failed;
- workflow age and abandoned drafts.

Suggested initial alerts are delivery-failure spikes, stale-conflict spikes, duplicate draft creation (must remain zero), and persistence parse failures.

## 6. Risks and controls

| Risk | Control |
| --- | --- |
| AI silently loses an incomplete item | Deterministic item refs, source preservation, paper+laptop tests |
| Model declares completeness incorrectly | API-owned completeness engine |
| Short context expiration loses draft | Database continuation lookup independent of `AiTurn`/Redis context |
| User answer applies to wrong draft | Exact target selection and fail-closed ambiguity |
| LINE and web race | CAS using current revision |
| Category suggestion becomes accounting fact | Separate axes, provenance, reviewer authority, no posting |
| Long reply drops questions | Deterministic splitting and lossless renderer tests |
| Provider delivery fails after commit | Delivery-pending/outbox recovery and idempotent rendering |
| Metadata becomes too large or hard to query | Bounded schema; stop and write ADR before table migration |
| Existing receipt flow regresses | Preserve focused baseline and run regression proof |

## 7. Handoff and stop conditions

Stop implementation and request a product/architecture decision if:

- non-expense directions need a new source module rather than an existing handoff;
- company policy makes a field’s LINE collectability ambiguous;
- metadata limits require a dedicated persistence model;
- a new final mutation or reviewer permission is proposed;
- real LINE limits prevent lossless delivery within the required user experience.

Implementation is complete only after all P-F gates pass. Deployment is a separate authorized action governed by the deployment runbook.
