# Agent Memory: Expense leading-zero input fix

Status: IN PROGRESS.
Owner: Codex / root, 2026-08-29.
Scope: Fix the price/discount UI findings using the existing checkout and Web3000/API3003; no new worktree, service or dependency. The subsequent owner request adds employee single-role/card consistency work and authorizes PR/merge to develop followed by PR/merge to main; deployment is not requested.
Decisions:
- Branch `codex/expense-leading-zero-input` starts at verified remote develop `b19067658b04386ca6873ed1c9a9edfa87e4b0b6` in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-main-qa-20260828`. Preserve unrelated dirty `docs/agent-memory/main-ui-qa-uat-release-2026-08-28.md`; never include it in this PR.
- Product acceptance: typing/pasting `0400` becomes `400` immediately, `0007` becomes `7`, zero/empty/intermediate decimal input remains editable, and `0.402` / four decimal places remain exact. Manual and review price/discount fields must agree; cover the sibling substitute-receipt unit-price entry too.
- Architecture: use the existing forms sanitization module for string-only leading-zero normalization. Keep server Decimal(18,4) validation and all financial rounding, source-state, permissions, tenant/audit and explicit-save boundaries unchanged. Match manual input step to the existing four-decimal contract. No global number coercion or automatic save.
- Relevant source of truth: `docs/specs/expense-receipt-upload-spec.md` §19 review input and decimal-safe boundary; observed UI results in the original checkout's `docs/agent-memory/develop-leading-zero-ui-review.md`.
- Ponytail full; machine-specific skill path is absent, so read the repo-local skill. Small shared helper and existing tests/patterns; no new component/dependency.
Open questions: None for this fix. The later confirmed-reimbursement tax-review screenshot is a separate diagnosis, not authorization to repair UAT data or implement the proposed return-for-correction feature.
Artifacts: Shared forms helper/test, expense input consumers, focused browser regression, this memory; exact paths/results to be recorded.
Verification:
- Focused forms/expense/review/substitute model suites: 137 tests passed.
- Full web suite: 1,252 tests passed; web typecheck and git diff --check passed.
- Playwright EXP-INPUT regression discovered successfully with --list (CLI browser execution not run).
- Actual local UI: both manual and review price/discount fields normalize typed/pasted 0400 and 000400 to 400, preserve 0.402 and 0.0042 after blur, and have no native step mismatch. Reviewed fixture restored without saving/confirming a document.
- Local screenshots: original checkout docs/evidence/expense-leading-zero-input-fix/{manual-fixed,review-fixed}.png.
Next: Finish the added employee scope, verify the combined change, then scoped commit/PR/merge through develop and main under required CI. No UAT/Production record mutations or deployment.
