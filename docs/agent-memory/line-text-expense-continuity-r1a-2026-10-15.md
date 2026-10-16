# Agent Memory: LINE text expense continuity — Round 1 lane A

Status: Controller A5 follow-up implemented and locally verified; uncommitted diff ready for review.
Owner: Round 1 lane A / owner decision 2026-10-15
Scope: A1–A6 of the owner's production LINE transcript; existing personal-chat draft and delivery boundaries only.

Decisions:
- Spoken Thai months count as dates only with an explicit numeric day before and year after; full month/period parsing stays separate.
- Grounded total-only items use quantity 1 and unit price equal to total. Unknown amounts remain absent, and stated quantities win.
- Item descriptions use grounded description/purpose hints; absent descriptions remain a neutral staged item with a description question.
- Exactly one OPEN draft with unresolved questions may claim a grounded plain answer before model routing. Questions, explicit new captures, non-expense directions, multiple drafts and ambiguous item answers stay outside that matcher.
- Matching is read-only; persistence still calls the existing draft use case and its owner, tenant, branch, status and revision guards.
- Ineligible capture routes with one pending draft pin that draft and continue/re-ask it through the existing continuation path.
- Waiting-question delivery plans freeze and revalidate the original source proof on replay; the proof excludes raw ledger/chat addressing fields.
- A text business turn with no delivered message or saved outcome sends the existing plain Thai failure reply; a delivery-owner CAS prevents competing with a queue producer.
- Clarification routing snapshots compare sorted expense ids/revisions, excluding status/questions. New snapshots are taken after interrupting the draft. Stale incoming clarifications are consumed and dropped before routing fresh input; final delivery-source checks remain fail closed.
- No new flags, dependencies, package.json changes, final-mutation policy changes, commits or deployment.

Open questions:
- None on the scoped implementation. Real LINE/database UAT is unavailable in this offline sandbox.

Artifacts:
- packages/contracts/src/line-ai-value-normalizer.ts and existing spec; line-ai.ts adds optional route-context revision.
- apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.ts and existing spec.
- apps/api/src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.ts and existing spec.
- apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts and existing spec.
- Existing expense-document.use-case.spec.ts now asserts the owner-approved total-only convention.
- Paired draft specification §7.1/AC-04 and implementation plan reflect the owner decision.

Verification:
- `pnpm --filter @watchdog-bms/contracts build`: exit 0.
- `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test src/line-ai-value-normalizer.spec.ts`: 136 passed, 0 failed.
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.spec.ts src/modules/expenses/domain/logic/expense-source-draft.logic.spec.ts src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`: 528 passed, 0 failed.
- Webhook suite replays all four owner turns with the real draft use case and stubbed persistence/router/gateway: one capture, same draft, grounded date/500/quantity 1, accepted category, four replies, no source-changed denial.
- Additional webhook cases cover ineligible capture continuation, v2 waiting-proof save/replay/tamper rejection, stale question dropping, and snapshots after interrupt.
- `pnpm --filter @watchdog-bms/api typecheck`: exit 0 after correcting the test target-library compatibility and explicitly typing stale ids; contracts build precedes it.
- `git diff --check`: passed.
- Live LINE, network, Docker and database UAT: not run (sandbox constraints).

Next: Review the uncommitted diff and perform real LINE/database UAT in an authorized environment; no deployment performed.

## Controller follow-up: prevent fallback double sends

- Controller review found that high-level delivery tracking did not cover every text send path.
- Added one acceptance tracker shared by reply/push transport helpers, sendMessages results and V2 results. Every direct reply/push in this use case now routes through those helpers.
- Frozen V2 batches are marked accepted immediately after transport acceptance, before durable bookkeeping; later persistence failure cannot trigger a second error bubble.
- Existing permission, source validation, delivery ownership and fallback eligibility guards remain in place.
- New existing-file PLW cases prove exactly one outbound send for plain deliverReply, deliverRequiredMessages, deliverMessages, direct sendMessages, V2 replay and delivery controls without a persisted outcome; successful push survives later bookkeeping failure; a silent admitted turn gets exactly one plain fallback.
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`: 439 passed, 0 failed.
- `pnpm --filter @watchdog-bms/api typecheck`: passed, exit 0 (log `/tmp/r1a-a5-review-typecheck.log`).
- `git diff --check`: passed.
- Next: review the uncommitted diff; no further implementation or local verification pending.
