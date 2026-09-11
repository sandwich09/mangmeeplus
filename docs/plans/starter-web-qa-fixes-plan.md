# Starter web QA fixes plan

Status: Complete for the approved local scope. Owner: Codex root.
Spec: [approved rules](../specs/starter-web-qa-fixes-spec.md).
Branch: codex/starter-qa-fixes-20260911 in the isolated main QA worktree.

1. Trace shared callers and existing tests for each finding; record neighboring impacts, not only the reported screen.
2. Correct starter onboarding/config diffs, quota messages and duplicate admin rendering; preserve existing companies.
3. Correct expense/reimbursement source status, summary deduplication and evidence/history exports together with scope and reversal checks.
4. Correct AI entry/discovery/request permission boundaries and permitted usage guidance; retain provider-unavailable behavior.
5. Correct role visibility, notification lifecycle and help copy using existing mechanisms.
6. Run focused unit/PostgreSQL checks for non-trivial data/permission/state logic, required build/type checks, then real browser regression journeys and exported artifact inspection.
7. Update QA report/memory with changed behavior, evidence and remaining external prerequisites. No commit/push/deploy requested.

Verification complete: [fix report and impact matrix](../qa/starter-fixes-regression-2026-09-11.md). Expense tests 1,245 pass; all 6 initially skipped PostgreSQL cases subsequently passed in the required 25-case payment run; adjacent API 253 pass, web 648 pass, guide 7 pass. Final focused document/export tests and build/type checks pass. Browser admin/owner/staff journeys and downloaded workbook/manifest facts verified; provider/LINE/mail remain explicitly untested.
