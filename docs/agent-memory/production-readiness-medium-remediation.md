# Agent Memory: production-readiness-medium-remediation

Status: IN PROGRESS — M8-01/M8-02 committed; M8-03 implemented and verified, preparing its atomic commit.
Owner: thawatchai
Scope: Verify, reclassify, fix and individually commit every finding in section 8 (MEDIUM) of
`docs/qa/production-readiness-audit-consolidated-2026-08-09.md`; record newly discovered bugs/gaps and fix them in the
same atomic issue when required for correctness.
Decisions:
- One finding/root cause per commit. A bundled bullet may split into atomic commits; false, already-fixed, accepted-scope
  or duplicate findings are closed with evidence instead of speculative code.
- Focused runnable verification is required before every commit; broader gates run after each domain group.
- Preserve and do not stage the pre-existing uncommitted accounting-UI changes in five `apps/web/src/features/expenses`
  and `web-core-workspace` files unless their owner resolves them or a later finding cannot be isolated.
- `production-readiness-audit-2026-08-09.md` and `production-readiness-usecase-audit-2026-08-09.md` remain untracked and
  out of all commits.
- CR-3 owner decision remains: accounting UI hidden, ledger core/background posting active.
Open questions:
- None blocking M8-01. Findings that require a product policy decision will be marked `DECISION_REQUIRED` rather than guessed.
Artifacts:
- Consolidated audit section 8 contains 49 top-level/bundled Medium findings across auth, finance/date, substitute receipt,
  settings/entitlement, dashboard/notifications/reports, LINE/AI, reimbursement, platform, i18n and onboarding.
- This memory tracks progress across turns; detailed disposition is written back beside each finding in the consolidated audit.
Verification:
- Baseline worktree inspected 2026-08-09. Five unrelated web files are modified; three QA audit files are untracked.
- M8-01 focused tests: 50/50 pass across token issuance, password login/reset/change, controller session binding and employee
  credential regeneration.
- M8-01 discovered and fixed a related TOCTOU race: an old password verified before a concurrent credential update could
  create a session after revocation. Password-backed issuance now locks and rechecks the credential version before creating
  the session in the same transaction.
- API `tsc --noEmit` reaches only 14 pre-existing test errors: 11 missing `ObjectVersionCleanupService` constructor arguments
  in `substitute-receipt.use-case.spec.ts` and 3 mock tuple typing errors in `report.use-cases.spec.ts`; no M8-01 file errors.
- M8-01 commit: `87d6c0e fix(auth): revoke sessions after credential changes`.
- M8-02 audit tests: 26/26 pass; RPT E2E file compiles/lists all 8 cases. The endpoint is tenant-explicit at
  `/companies/:companyId/audit/logs`, route/context mismatch fails before repository access, and specs/caller match.
- M8-02 commit: `5be8d78 fix(audit): bind log queries to route company`.
- M8-03 AuthGuard/deny-by-default tests: 25/25 pass. Central guard rejects conflicting header/route tenant selectors only
  after authentication/session validation and before context resolution; missing/invalid credentials retain 401 ordering.
Next:
- Commit M8-03 code/tests/specs plus this memory only; keep the shared untracked consolidated audit out of the atomic commit.
- M8-04: verify/fix stale permission and entitlement UI after mid-session changes.
