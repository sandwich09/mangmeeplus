# Agent Memory: LINE real-model Round 1 fix-up

Status: F1–F5 and all ten controller-requested dispatch safety regressions fixed; requested full specs and API typecheck pass. Uncommitted diff ready for review. No live services or deployment.
Owner: Codex / owner request 2026-10-15
Scope: Text draft grounding, absent-preview delivery, truthful model acknowledgements, paired-card Thai formatting, model Markdown cleanup, stale-answer provenance and capture-context authority.
Decisions:
- Accept normalized hint tokens only in source order; numeric/date grounding remains separate. A grounded amount on a verified company-paid business capture can start a draft without a purpose hint.
- Remove reimbursement rollout-mode coupling from the verified business-expense capture signal.
- A draft tool may return an explained failure with no preview (live turn 3: EXPENSE_NOT_FOUND). Such failures need no preview proof; an alleged successful preview still fails closed when missing, and an existing preview retains its final-send revision check.
- Reuse semantic status grounding and the composed-text sanitizer for semantic, native and JSON planner questions, coverage-critic questions, casual compose, grounded compose and language polish. Model text cannot acknowledge writes; successful writes keep deterministic API acknowledgements. The no-write fallback does not imply a draft exists.
- Reuse existing date, money and status formatters for the paired record and its altText.
- Controller follow-up: all ten failing dispatch expectations encode safety rules and are retained. Reject answers/choices/mutation requests whose original clarification proof is stale before routing; only an independent question may discard stale context and continue (including the owner's “ทำไมเงียบ”). Respect the loader's fail-closed return.
- Conversation capture IDs require the same current capture/correction permissions as existing LINE candidate reads, with the existing tenant/creator/chat/branch predicate preserved. Revocation prevents even the ID query.
Open questions:
- Prior “pre-existing failures” attribution was incorrect: the comparison used rounds 1+2 HEAD, not original develop. Controller measured original 3ca26a37c at 361/0, round 1A 6a56e211f at 352/9, and round 2 95f6dc314 at 351/10. These are introduced regressions, now fixed in code rather than waived.
- Network/Docker/live UAT unavailable; supplied live traces are evidence, not a new live validation.
Artifacts:
- Updated expense draft spec and existing registered API/gateway specs. The F1 use-case spec embeds the complete exact turn-0 router JSON and proves one persisted draft with 2026-10-10, total 500, quantity 1 and no quantity question. The four-turn webhook replay also uses that exact router result.
- F2 webhook spec embeds the exact turn-2 gateway result and exercises V2 authorization/send: the real answer is delivered once without a nonexistent-preview proof or safety-net bubble. Existing tests still reject missing/disappeared successful previews.
- F3/F5 specs cover planner and compose claims, Markdown-wrapped claims, Thai decimal/date punctuation, native questions, critic questions and casual compose; reply and coverage agree.
- F4 webhook spec exercises the permission-checked GetExpense context and verifies 13 ต.ค. 2569 / 500.80 บาท / ร่าง in both card body and altText.
- `.live-r1/` remains untracked and unstaged; no package.json, policy flags, commits or deployment changes.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: pass (before typechecks).
- `pnpm --filter @watchdog-bms/api typecheck`: pass, exit 0 (`/tmp/r1-fixup-api-typecheck-final.log`).
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass, exit 0 (`/tmp/r1-fixup-gateway-typecheck-last.log`).
- API `exec node --import tsx --test`: expense-document use-case + logic, draft-conversation use-case + logic, process-line-webhook: 580 pass, 0 fail (`/tmp/r1-fixup-api-focused-final.log`).
- Gateway `exec node --import tsx --test`: orchestrator, response-composer, model-loop, native-loop, coverage-critic: 241 pass, 0 fail (`/tmp/r1-fixup-gateway-complete.log`).
- Dispatch changed route-confirmation test via `--test-name-pattern='confirms a business-expense route independently'`: 1 pass, 0 fail (`/tmp/r1-fixup-dispatch-focused.log`).
- Historical rounds-1+2 diagnostic: dispatch 351 pass/10 fail, provenance 3 pass/9 fail, receipt-authority 0 pass/1 fail. Those measurements reproduce the introduced regressions; they do not establish a passing original-develop baseline.
- Controller verification after code fixes: full dispatch 361 pass/0 fail (`/tmp/r1-controller-dispatch.log`); full webhook + expense-document initially 494 pass/0 fail (`/tmp/r1-controller-webhook-expense.log`). Final combined run of all three registered files, including the new stale-choice/category/mutation-question and capture-revocation regressions: 856 pass/0 fail (`/tmp/r1-controller-verified-specs.log`). `pnpm --filter @watchdog-bms/api typecheck`: pass, exit 0 (`/tmp/r1-controller-api-typecheck.log`).
- `git diff --check`: pass; index empty.
Next: Review the uncommitted diff. No controller-requested local checks remain; real-model/LINE UAT remains for an authorized environment.

## Controller per-test verdicts

All ten are real safety rules; no failing expectation was changed.
- Receipt `does not widen correction permissions or intercept unrelated workflow questions`: code fix; current capture/correction authority is required before listing context IDs.
- Provenance `missing`: code fix; absent proof cannot authorize an answer.
- Provenance `corrupt`: code fix; malformed proof cannot authorize an answer.
- Provenance `oversized`: code fix; out-of-bounds proof cannot authorize an answer.
- Provenance `wording`: code fix; an answer cannot bind to a changed question/content hash.
- Provenance `intent`: code fix; an answer cannot bind to a changed operation/content hash.
- Provenance `ordered_ids`: code fix; the offered choice ordering remains part of the binding.
- Provenance `amount`: code fix; changed source facts invalidate the original choice.
- Provenance `access`: code fix; changed permission fingerprint invalidates the original question.
- Provenance `channel`: code fix; a different recipient/channel invalidates the original question.
