# Receipt reliability and draft continuity implementation plan

Status: Git delivery complete through PR #473 (develop) and #474 (main). Owner requires both LINE receipt flags enabled in the next deployment; see the checklist below.

Spec: [receipt reliability and draft continuity](../specs/receipt-reliability-and-draft-continuity-spec.md).
Evidence baseline: [T01–T18 inventory](../research/line-receipt-reliability-ux-review-2026-09-07-th.md).

## Baseline and working boundary

- Pull develop using fast-forward; baseline `4b91953f`. Application code matches diagnosed `604ac785`.
- Work on `codex/receipt-reliability-remediation-20260907` in `../mangmeeplus-receipt-remediation-20260907`.
- Preserve local user changes and other worktrees. No package.json edit unless dependency change is necessary; none planned. No dependency addition planned.
- Spec and this plan precede application code. Reuse existing upload, outcome, worker, quota, expense update, metadata, validation, permissions and web form patterns.

## Coding allocation and ownership

All agents use the same dedicated checkout with disjoint file ownership. Only the coordinator commits, pushes, creates or merges PRs. Agents must announce a need to touch another lane's files before doing so.

| Lane / model | Bounded responsibility | Owned files | Evidence |
|---|---|---|---|
| Receipt delivery — GPT-6 Astra, xhigh | Durable capture identity, truthful saved result, outcome/recovery, push retries and safe diagnostics; inspect admission/dedup boundaries and implement narrow continuity fix | API line-ai use cases/adapter/domain and focused tests; relevant AI gateway intake/quota boundary only by coordination | T02–T08, plus affected retry/routing regressions |
| Draft integrity — GPT-6 Astra, xhigh | Preserve financial rows/charges/discounts, 40-item staging, resume revision refresh, explicit target lookup, partial source API/read projection/permissions, unified completeness and controls | API expenses domain/use cases/repository/presentation and contracts; exclude receipt-ocr-apply.service.ts and its OCR-only tests owned by coordinator | T11–T18; backend portions T10/T14–T17 |
| Web continuation — GPT-5.6 Sol, xhigh | Same-draft staged facts/rows, partial save, missing fields, visible ordinary-language actions, authorized web continuation, reload and validation states | Web expense feature and relevant i18n/tests only | T10/T14–T17; actual rendered journey where available |
| Coordinator | Zero-price shared apply fix, integration contract review, all-lane impact/bug/gap checks, permanent test coverage ledger, local/CI verification and PR delivery | OCR apply service/tests, docs/plan/memory and necessary integration corrections coordinated with owners | T01/T09 and cross-lane acceptance |

Draft integrity publishes the exact `sourceDraft` read/write contract and authority semantics to web continuation before that agent wires requests. Both coordinate modifications to contracts through the backend owner. Delivery asks backend owner/coordinator before changing expense repository. Backend must not edit process-line-webhook; provide required integration instructions to its owner.

## Execution checkpoints

1. [x] Update develop, create isolated branch/worktree, preserve pre-existing local files, read AGENTS/ponytail and relevant docs, record current defects.
2. [x] Write this spec/plan and copy sanitized investigation/acceptance evidence into branch.
3. [x] Implement each lane with focused permanent regressions; publish sourceDraft contract early.
4. [x] Integrate receipt → collection → partial web save → LINE resume without lossy row replacement or false completion. Inspect all final mutation paths and scope/permission boundaries.
5. [x] Run meaningful focused suites; contracts/API/gateway/web typechecks; applicable build/DB/browser checks. Complete T01–T18 evidence ledger with exact commands/results and scope limits. Do not substitute tests of a helper for the stateful path that originally failed.
6. [x] Review combined diff against UX, SA, BA and AI engineering requirements; inspect adjacent money/tax/duplicate/quota/stale and role flows. Resolve findings before accepting.
7. [x] Commit scoped files, push branch, create reviewable PR into develop with evidence. Wait for relevant CI; fix failures on this branch. Use authorized admin merge when needed after reviewing the actual result.
8. [x] Update local/remote develop, create develop → main PR with final scope and exact evidence, resolve conflicts without losing main-only release configuration, verify candidate/diff and checks, admin merge as authorized.
9. [x] Record PR URLs, commits, merged develop/main SHAs, final tests and remaining live acceptance. Update task memory and plan. Do not claim deployed behavior from a merge.

## Verification record

See the [T01–T18 implementation and verification ledger](../research/receipt-reliability-remediation-verification-2026-09-07.md): whole workspace passed; final real PostgreSQL 26/26 and browser 6/6 passed, with contracts/API/gateway/web type checks and permanent CI registration. Historical no-write reproductions remain pre-fix evidence in the review, not post-fix passes. GitHub CI and merge evidence follow in the PRs.

## Runtime boundary

Git delivery above did not dispatch a runtime release or flag change. Final merges, successful CI run IDs and matching file-tree proof are recorded in the [delivery memory](../agent-memory/receipt-reliability-and-draft-continuity.md).

## Required flags for the next deployment — owner directive 2026-09-07

The owner explicitly instructed that the next deployment must enable BOTH existing flags in UAT and Production:

| Flag | Required UAT value | Required Production value |
|---|---|---|
| `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED` | `true` | `true` |
| `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` | `true` | `true` |

- [ ] Verify that environment inputs are actually passed through the workflows/deploy scripts to every running consumer; both schema defaults are `false`, so omission is not acceptable. Repair missing wiring before deployment if needed.
- [ ] Deploy UAT with both enabled; read back the actual running values and verify LINE collection of all missing facts, partial answers/save-for-later/web/resume, and saved-outcome replay without repeating OCR or business writes.
- [ ] Promote Production with the same two enabled values; verify actual runtime readback and the customer journey. Record exact UAT/READY/Production run IDs, signed release result and customer OPEN acceptance under the [mandatory deployment protocol](../runbooks/uat-production-v2-deployment.md).

This records the required configuration for that future release; it does not dispatch a deployment now.
