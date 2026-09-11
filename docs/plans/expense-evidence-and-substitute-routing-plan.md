# Plan: Expense evidence and substitute receipt routing

Date: 2026-09-11
Status: IMPLEMENTED; focused tests and local API/database/browser verification passed. [Implementation evidence](../research/expense-evidence-implementation-verification-2026-09-11.md) records partial/manual acceptance limits. No merge/deploy.

Source of truth: [spec](../specs/expense-evidence-and-substitute-routing-spec.md), [tax/code audit](../research/substitute-receipt-tax-routing-audit-2026-09-11.md)

## Product and architecture decisions

- Preserve the current expense wizard, document review endpoint, substitute workflow and permissions. Introduce an explicit reviewed evidence route independent of VAT eligibility.
- Preserve the owner's zero-attachment cash policy, immutable SRC numbering, editable/issued boundaries, expenseDate/paymentDate separation and one inline review warning.
- The proposed additional product decision is reviewer acceptance of sufficient alternative evidence with a reason and evidence references. This is not an automatic CIT ruling or a new tax override permission.
- Reuse the existing review JSON with a typed versioned assessment; no new table, workflow engine, dependency or package.json edit is planned. Any need for a migration must first be justified in the spec.
- Latest user decision removes accounting handoff: no send-to-accountant button, assignment/queue/notification or REQUEST_REVIEW intent. Partial Save draft and reopen are the pending-work recovery. Existing review/confirm permissions and ready submission behavior remain.

## 1. Establish the change boundary

- [x] Audit primary tax sources and trace current FE/API/LINE paths.
- [x] Reproduce abbreviated-receipt and handwritten eligibility gaps using synthetic helper inputs.
- [x] Record existing test baseline: 138 tests / 26 suites pass.
- [x] Define routes, safe pending states, final-mutation boundaries and E2E matrix in spec.
- [x] Extend evidence to 217 existing tests, 17 helper probes, 8 real local browser/API observations and a 28-state conditional recovery model. Record G20/G21 and T37–T42 from the actual pending-work gaps; see [proof report](../research/expense-evidence-recovery-proof-2026-09-11.md).
- [ ] Before coding, capture the current diff of branch `codex/substitute-step3-edit-20260910`. Preserve unrelated and earlier local edits; do not switch branch or reset the worktree.
- [ ] Read current applicable AGENTS/Ponytail and inspect any changes since the baseline. Check every caller of eligibility/review/confirm, including standalone and LINE; add new findings to the spec before implementation.

## 2. Shared contract and backend — before enabling new UI routes

Likely files:

- `packages/contracts/src/expenses.ts`
- `apps/api/src/modules/expenses/domain/models/expense.model.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-document.logic.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` — confirm has its own in-transaction substitute guard; prepare/issue also write relevant fields. Reuse the same decision inside these boundaries.
- Existing read mapper and attachment/extraction writers only where needed to preserve and validate assessment.

Work:

1. Define typed review v2 input/read projection and validation. Reuse the existing metadata subkey and CAS transaction. Never trust client reviewer/time, attachment ownership or a supplied canConfirm flag.
2. Centralize the evidence-route decision alongside existing eligibility. Distinguish permission to open the wizard, completeness to prepare, and final confirm. Add ABB to the valid-source guard with explicit missing/incomplete exceptions; split handwriting from receiptless text.
3. Support saving pending drafts separately from completing a review. Reuse review-fields without acknowledgement and partial draft APIs within their permissions; preserve the existing draft lifecycle. Reopen the same expense and retrieve saved fields per spec §7.6. Save draft must not call mark-ready or add submission contracts. Preserve ready completeness, review/confirm and claim/issued authority.
4. Validate the current assessment on final confirm, both use-case preflight and repository lock/CAS recheck. Make accepted alternative evidence satisfy the evidence requirement without deleting missingReason or fabricating a primary receipt. Bind input VAT checks to the selected invoice. Do not change payment/VAT/WHT engines to achieve this.
5. Invalidate review only for relevant semantic changes; preserve no-op review, history and legitimate prepare/issue transitions on the same facts. Distinguish source from certificate-owned fields. Preserve existing accepted-source-VAT permissions/transaction behavior. Inspect OCR JSON writers so they cannot silently erase or recreate human review.
6. Return existing-style validation errors with stable codes and targets. A rejection must leave drafts and numbering unchanged.

Verification: domain decision table and permission/CAS integration tests for spec T01–T21, T28–T31, T35–T41. Assert actual records/events, not only HTTP status. Use current test runner commands and scripts; do not alter package.json.

## 3. Frontend and accessibility

Likely files:

- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`
- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- Existing client API adapter and tests as contract changes require.

Work:

1. Consume the shared/server route projection in all entry points: review card, empty viewer, check-bill action, footer, deep link and existing-certificate actions.
2. Replace the generic no-receipt shortcut with contextual evidence/problem actions. Do not create a document on open/navigation. Show Save draft at step 2 without requiring Next first; remove the current step-1/sourceDraft-only visibility assumption. Do not add accounting handoff UI.
3. Keep Save review explicit, current and atomic. Correct prefilled values can be acknowledged unchanged. Pending inputs are not implicitly saved by Next. Back retaining in-memory values is not persistence: save/reload must prove draft durability. Failed or partly successful saves, stale revision and expired session need accurate status and retry without discarding input or leaking it to another principal.
4. Make the card short, dropdowns aligned and labels readable; one inline warning, no duplicate footer reminder. Focus/scroll to new content and validation target without covering it with the sticky footer.
5. Standalone: replace implicit unresolved classification conversion with explicit fact confirmation and the same review endpoint before prepare. No extra whole-page wizard or rejected payment-date panel.

Verification: existing model tests plus Chromium real UI/API paths T01, T05, T09, T13–T18, T20, T22, T24–T25, T30–T33, T37–T42. Desktop/mobile screenshots must show full labels, single warning and visible next action.

## 4. AI/LINE integration

Locate callers by searching `collectSubstituteReceiptEligibilityIssues`, prepare tools, review-fields and tax reason codes; do not maintain a second policy in prompts.

1. AI can suggest classification and extract facts, but not mark human review complete or infer no receipt from no VAT/handwriting/attachment purpose.
2. For authorized LINE prepare, bind explicit user acknowledgement to the selected expense and source revision, call permission-checked review API, then prepare. Unsupported/ambiguous cases hand off to the existing authenticated web screen with the actual reason.
3. Preserve paper/digital signing boundaries, full funding behavior and safe own-domain continuation links. No production LINE messages are sent during development tests.

Verification: contract/integration scenarios T19–T23, T29; mock external delivery, assert correct target expense and no extra preparation on retries. Regression for receiving several receipts and discussing one of them must remain distinct from a batch acknowledgement.

## 5. End-to-end acceptance and regression

- [x] Update synthetic fixtures: `e2e/expenses.spec.ts` currently uses a small arbitrary PNG as a primary attachment. New tests must explicitly classify/review the document facts; never relax validation to keep the arbitrary-file assumption.
- [x] Extend existing expense and substitute E2E rather than adding a separate test framework. Check `e2e/substitute-cancelled-view-only.spec.ts`, reimbursement suites and ledger tests for affected assumptions.
- [x] Run the spec matrix by layer: unit for pure decisions, integration for authoritative mutation/security, browser for the complete user journeys. Record each Txx as passed/failed/not run with evidence.
- [x] Check persistence after reload, expense/SRC counts, number immutability, signed revision/download behavior, company/employee payment behavior and absence of accidental VAT/WHT events.
- [ ] For each rejection, demonstrate the recovery path on the same draft and explain the remaining requirement. No impossible review→issued→review dependency.
- [ ] Map all 28 model states to implemented actions/endpoints/permissions and persisted results. Model reachability alone does not satisfy T42; rerun actual source/alternative/certificate final transaction paths after implementation. Preserve waiting states for unsupported currency, partial funding, rendering limits, closed periods and unavailable actors instead of fabricating completion.
- [x] Use only test-owned company/records; cleanup exact fixture IDs. Do not modify production or another user's receipts.
- [ ] Arrange T34 usability with representative older/non-accounting users when available; record separately from automated checks. Until then mark it not run and document the proxy accessibility findings.

Baseline logs already available:

- `/tmp/substitute-tax-audit-tests-20260911.log` — 138 existing tests passed; not proof of new flow.
- `/tmp/substitute-tax-audit-repro-20260911.log` — current helper gap reproduction; not a database mutation or legal verdict.
- Latest superseding focused baseline: API 180 + web 37 tests passed. Real browser/API observations, source hashes, fixture cleanup and model output are archived in [evidence JSON](../research/expense-evidence-recovery-evidence-2026-09-11.json); commands and limitations are in the [proof report](../research/expense-evidence-recovery-proof-2026-09-11.md).

## 6. Documentation, rollout and handoff

1. Update the explicit-review spec and LINE spec with the final implemented routing semantics, preserving historical owner decisions and audit evidence.
2. Add exact verification commands/results and remaining gaps to task memory. Do not say all E2E passed until the matrix has actual results.
3. Release backend additive support before enabling FE/LINE writes of new assessment. Do not expose alternative-evidence UI while confirm still requires an issued certificate for that route.
4. Rollback must retain read/processing support for newly stored routes; never delete assessments or automatically convert them to certificates.
5. Keep this planning round separate from application delivery. When implementation resumes, use the existing branch and current CI evidence, preserving prior authorized scope and the user's latest instructions.

## Historical completion evidence for the planning round

- Product, tax distinctions, UX, routes and exceptions: spec §§1–6.
- Contracts, permissions, state transitions and cross-channel integration: spec §§7–8.
- Risk register, acceptance and compatibility: spec §§9–12.
- Proof of current gaps, conditional recovery graph and remaining real E2E obligations: spec §13 / proof report. Current spec has 21 risks and 42 acceptance scenarios.
- Implementation/test/release sequence: this plan.
- No application code change or claim of new E2E success in this round.

## Implementation handoff (2026-09-11)

- Completed shared evidence review contract, draft/review/confirm transaction checks, three-route UI, standalone/LINE review boundary, OCR history retention and stale detection.
- Fixed issues found during actual tests: PostgreSQL JSONB property order invalidating review, LINE review changing the continuation revision, API response returning pre-ack metadata, generated artifacts invalidating source review, old prepared amendments requiring a marker they never had, and hidden/deleted file selection losing its explanation.
- Runnable checks: API/contracts 761 + web 111 passed; real PostgreSQL continuity 17 passed; Playwright EXP-05/08/EVIDENCE 3 passed after final build; API/web typechecks passed. Three synthetic source/alternative/certificate journeys also reached CONFIRMED.
- Exact own test data/object cleanup verified. No sequence reset, production action, merge or dependency change.
- Remaining acceptance: full device/zoom/keyboard matrix, exhaustive browser failure injection and T34 human usability. See [case-by-case evidence](../research/expense-evidence-implementation-verification-2026-09-11.md).
