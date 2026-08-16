# LINE AI Owner Daily Closing Implementation Plan

## Linked Spec

- Spec: [[../specs/line-ai-owner-daily-closing-spec|LINE AI Owner Daily Closing Spec]]
- Feedback: [[../product/line-ai-owner-daily-closing-feedback-th|LINE AI สรุปค่าใช้จ่ายก่อนปิดร้าน]]
- Roadmap/checklist item: Active Cross-Cutting Production Gate — LINE AI Owner Daily Closing and Thai Business Vocabulary
- Related production gate: [[line-ai-production-parity-and-receipt-continuity-remediation-plan|Production Parity and Receipt Continuity Remediation]]

## Purpose

Replace the generic expense-summary path with one permission-checked, bounded daily-closing snapshot and truthful LINE answer. Implement vocabulary, query semantics, conversation/media behavior, performance evidence and immutable release proof together so testing does not merely reveal the next validation layer.

## Current Repository Context

- API tool registry and permission policy already exist; reuse them.
- `ExpenseListRecentTool` and `expense.get_breakdown` are useful evidence but do not satisfy daily-closing buckets.
- Expense domain already stores date, due date, currency, payment, evidence and duplicate state needed for the first contract.
- AI Gateway semantic router and dynamic tool catalog are authoritative; add glossary context, not a keyword shortcut.
- Existing 15-turn continuity, partial answers, side-question resume, controlled image replay, reconciliation CLI and immutable deployment manifest remain mandatory.

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md` and the ponytail full rule: smallest correct story, existing patterns first, no new dependency.
- AI Gateway never queries ERP repositories directly.
- No final financial/document mutation is added to LINE.
- Each completed story receives a focused check, one commit and push before the next story.
- Do not change timeout or release scope to make a failing test green; measure and fix the shared critical path.
- No UAT/Production action before reading both mandatory cloud/deployment runbooks in full and recording the exact candidate/run ids.

## Scope

### In Scope

- Thai abbreviation glossary and router/provider regression
- `expense.get_daily_closing` API tool, contract, permission/scope and bounded query
- deterministic/composed LINE daily-closing answer
- multi-currency/date/status/evidence/duplicate truth rules
- multi-entry handwritten clarification and continuity regression
- real local conversation plus supplied controlled-image gates
- hosted UAT concurrency/reconciliation/failure/rollback and immutable Production promotion

### Out of Scope

- Expected-document module for unseen bills
- LINE payment/approval/confirm/issue actions
- Customer-wide exception for an unverified LINE OA
- New dependencies or speculative reporting framework

## Story 0: Documentation Baseline

- [x] Save user feedback separately from application instructions.
- [x] Record verified current capability, gaps, constraints and controlled-image evidence.
- [x] Define daily-closing bucket semantics, glossary, media rules and release gate.
- [x] Commit and push documentation; update memory with commit/push evidence.

Tests: `git diff --check`, internal wiki-link resolution, self-review against repository symbols.

## Story 1: Thai Business Vocabulary and Intent Coverage

- [x] Add bounded glossary context for `ผปก`, `คชจ`, `ลค` and punctuation variants to the semantic intake router.
- [x] Preserve original message and forbid glossary-driven authorization/tool bypass.
- [x] Add deterministic corpus rows and router tests for expense/customer cases.
- [ ] Add configured-provider real-conversation rows after the daily-closing tool is registered in Story 2.
- [x] Verify non-business casual and mutation-refusal routes do not regress.
- [x] Commit and push (`840a195`).

Exit: shorthand selects the same governed tool family as its full Thai phrase, or clarifies when context is genuinely ambiguous.

## Story 2: Daily-Closing Read Contract

- [x] Register `expense.get_daily_closing` with existing expense read permissions and feature catalog.
- [x] Implement one bounded API use case using current membership/branch/own/related scope.
- [x] Separate expense/upload/due date lenses, rejected/voided, due/overdue/unscheduled, review/evidence/duplicate buckets and currencies.
- [x] Return exact decimal strings, bounded details and transparent truncation from one logical snapshot.
- [x] Add role/scope/cross-tenant, status, partial-payment, multi-currency, date-boundary and query-bound tests.
- [x] Commit and push.

Exit: contract passes focused API tests and does not scan unlimited expense history.

## Story 3: LINE Answer and Conversation Continuity

- [x] Enable the new tool for the accounting specialist/router catalog.
- [x] Add deterministic daily-closing reply; constrain model composition to value/currency/bucket-equal tool facts.
- [x] Include actionable read-only web links and honest `never submitted is unobservable` limitation.
- [x] Preserve partial text answers, intervening-question answer + resume and exactly 15-turn context.
- [x] Ensure multi-entry handwritten media asks type clarification and creates no single expense.
- [x] Add orchestrator/composer/API dispatch tests; commit and push.

Exit: the reported owner question returns actionable sections, not a generic menu or a single aggregate.

## Story 4: Look-Forward Whole-Path Verification

- [x] Run focused API, AI Gateway, web and contract typechecks/tests.
- [x] Run aggregate LINE production-remediation gate and controlled source-hashed supplied-image replay.
- [x] Invoke a real 15-turn configured-provider conversation for abbreviations, daily close, permission refusal and provider fallback evidence; exercise partial answers, side-question resume and media clarification through the local whole-chain/API paths.
- [x] Inspect query/model/tool stage timings, query count, truncation, currency and source-state reconciliation.
- [x] Fix shared root causes found by the whole matrix; each independent fix gets a commit and push.

Exit: no known layer remains intentionally hidden behind an earlier error and no unexpected mutation/delivery duplication occurs.

## Story 5: PR and Immutable Hosted UAT

- [ ] Push branch and open PR to `develop`; obtain required CI/review approval and merge.
- [ ] Promote the accepted develop revision to `main` through a separate reviewed PR without rebuild drift.
- [ ] Read cloud/deployment runbooks completely; fetch remote refs; record source SHA and retained ECS/AgentCore/contract candidate manifest.
- [ ] Dispatch exactly one UAT run and record `UAT_RUN_ID`; do not retry to discover errors.
- [ ] Run prod-shaped AgentCore conversation, expected-concurrency p50/p95/p99, supplied-image replay, role/security matrix, persisted-state reconciliation and forced failure/paired rollback.

Exit: signed UAT evidence identifies the exact immutable bytes and passes the whole matrix. A failed gate returns to code with root-cause analysis; no partial Production promotion.

## Story 6: READY, Production and Customer OPEN

- [ ] Freeze accepted `main`, create signed READY evidence and record `READY_RUN_ID`.
- [ ] Promote the exact UAT ECS image, AgentCore CodeZip/version/qualifier and contract; no Production rebuild.
- [ ] Record `PRODUCTION_RUN_ID`, canary observation, active task/runtime identity and paired rollback baseline.
- [ ] Re-run persisted reconciliation and bounded real LINE named-pilot scenarios.
- [ ] Record owner exception `Mangmee Plus Owner Pilot – 2026-08-16` and protected pilot roster evidence.
- [ ] Transition durable access `CLOSED → OPEN` only after final logout acceptance; verify it remains `OPEN`.
- [ ] Update memory/checklist with exact PRs, commits, run ids, metrics and customer acceptance.

Exit: `PROMOTED_LIVE` and customer `OPEN` both pass for the named pilot, with ECS/AgentCore/source identity equal. General customer readiness is not claimed from the pilot exception.

## Verification Matrix

| concern | evidence |
|---|---|
| vocabulary | corpus + semantic router + real-provider turns |
| finance correctness | unit/integration tests across dates/status/payment/currency |
| permission | owner/manager/accounting/staff, branch scope, revocation and cross-tenant attack |
| media | controlled source hashes; single handwritten and multi-entry clarification |
| continuity | partial answer, same-turn/side question, resume/cancel, 15-turn expiry |
| performance | tool/query/model timings plus hosted concurrency p50/p95/p99 |
| durability | persisted accepted-to-terminal reconciliation and redelivery/idempotency |
| release | exact manifest, signed UAT/READY/Production, canary/rollback, customer OPEN |

## Risks and Forward Controls

- Large outstanding history: aggregate/count plus bounded details, never load all rows.
- Snapshot race: use one transaction/logical snapshot for count/total/detail consistency.
- Mixed currency: group first and prevent composer from inventing a grand total.
- Permission change mid-conversation: re-resolve on every tool invocation and typed workflow resume.
- Model latency: one business tool call on the happy path; deterministic response remains complete.
- OA banner: named-pilot-only operational exception, not a technical readiness pass.

## Open Questions

- Future expected-document source is needed to report bills that never entered the system.
- Customer-wide LINE OA policy remains separate from the owner-controlled named pilot.
