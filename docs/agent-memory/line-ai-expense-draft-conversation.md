# Agent Memory: LINE AI Expense Draft Conversation

Status: Implementation and local review complete behind `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=false`; database-backed P-F06 artifact and real LINE OA P-F07 UAT remain. No deployment performed.

Owner: Product / Finance Platform / AI Gateway / LINE AI

Scope:

- Design a LINE-first conversational expense draft workflow.
- Free-text answers create/update a draft and return the full current draft every accepted turn.
- Ask all missing document/item questions together.
- Persist pause/end/silence/unrelated-task state and resume after 15+ turns without model memory.
- Keep category, accounting class, stock behavior, account, and tax suggestions separate.
- Implement the feature without deployment or any final financial mutation.

Decisions:

- `พัก` means pause and retain active missing questions; `หมด` means end the current input session and may leave an incomplete-ended draft.
- `ยกเลิก` cancels the conversation only; it does not delete evidence or the expense record.
- Silence causes no state transition or deletion.
- An unrelated request parks the draft and must not be parsed as an expense answer.
- All unresolved questions are returned together, grouped by document and every item.
- Free text is primary; stable question IDs and quick actions are optional aids.
- Durable state is database-backed and independent of the 15-turn/15-minute AI context.
- Phase 1 reuses `ExpenseRecord.sourceChannelMetadataJson` plus existing CAS/audit patterns; no migration or dependency planned.
- AI Gateway proposes candidates only; deterministic API logic owns validation, completeness, permissions, and persistence.
- The workflow stops at a reviewable `DRAFT` and cannot confirm, approve, pay, post, export, file tax, or delete.
- This dedicated workflow narrowly supersedes generic one-question clarification behavior; generic chat is unchanged.
- The first release is personal-chat only; groups/rooms retain the existing flow.
- The rollout flag defaults off and absence of the optional conversation provider falls back to the legacy capture behavior.
- Exact revision pinning stores the continuation `targetRevision` and row `updatedAt` together; stale web/LINE races fail closed.
- The receipt-delivery metadata write advances a still-current draft revision in the same transaction but refuses to rebase an already-stale draft.
- If the initial idempotency/audit update rolls back, only the untouched just-created DRAFT revision is removed, preventing an undiscoverable orphan on retry.
- Numeric grounding is item-local, unknown item references and ambiguous/negated categories are rejected, and replacing a total/unit-price representation removes the stale alternative.
- Clear income, deposit, loan, and transfer directions fail closed before an expense draft is created.
- Existing web review shows materialized values and missing-field badges; incomplete staged items remain in LINE/metadata until line invariants are satisfied.

Open questions:

- Record one real-database signed-webhook → draft/metadata/audit → outbound-payload artifact for P-F06.
- Run and approve the real LINE OA scenario set for P-F07 before enabling rollout.
- A future web-parity increment may render incomplete staged item rows; it is not required for LINE answer collection and is intentionally not fabricated as financial `ExpenseLine` data.

Artifacts:

- `docs/specs/line-ai-expense-draft-conversation-spec.md`
- `docs/plans/line-ai-expense-draft-conversation-plan.md`
- `apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.ts`
- `apps/api/src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.ts`

Verification:

- Official LINE protocol evidence and the original 97-test focused baseline remain recorded in the paired specification.
- Frozen install and Prisma generation completed without package manifest or lockfile changes.
- Focused feature/relevant regression group: 57 passed, 0 failed (domain, conversation use case, document capture, CAS authority, and delivered-receipt continuation repository specs).
- Contracts full suite: 125 passed, 0 failed.
- AI Gateway full suite: 574 passed, 0 failed.
- Config suite: 121 passed, 0 failed.
- Full API package test (including pretest): exit 0 after the final review fixes.
- Repository whole-chain acceptance passed: 21 repository scenarios and 3 controlled-external scenarios.
- API, AI Gateway, contracts, and config typechecks: exit 0; API typecheck was rerun after the final repository fix.
- `git diff --check`: exit 0; no `package.json` or lockfile changed.
- Real-database P-F06 artifact: not recorded. Real LINE OA P-F07 UAT: not run.

Next:

1. Commit and push the reviewed branch, then open a PR targeting `develop` with P-F06/P-F07 explicitly pending.
2. Keep the flag off; separately record P-F06 and run P-F07 before any enablement or production-ready claim.
