# Agent Memory: production-readiness-medium-remediation

Status: IN PROGRESS — M8-01..M8-06 committed; M8-07 implemented and verified, preparing its atomic commit.
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
- M8-03 commit: `efe097f fix(auth): reject conflicting company selectors`.
- M8-04 focused web tests: 26/26 pass; contracts build and web `tsc --noEmit` pass. Visible workspaces revalidate access
  every 60 seconds, on focus/visibility return and immediately after stable permission/feature denial. Fingerprints include
  roles, effective permissions and branch scopes; fetches are single-flight and denied mutations are never retried.
- M8-04 commit: `5e53f11 fix(web): refresh stale access context`.
- M8-05 focused API tests: 124/124 pass. Journal source dates, persisted `@db.Date` values, document numbers, tax periods
  and closed-period guards now share the Bangkok civil-date boundary. A `2026-08-31T19:00:00Z` settlement posts on
  `2026-09-01` in `2026-09`; malformed/out-of-range monthly keys fail instead of rolling silently.
- M8-05 related gaps fixed in the same root-cause change: accounting/procurement/inventory sequence numbers and tax form
  periods also used host-local or UTC month calculations and could disagree with their journal. API `tsc --noEmit` still
  reports only the established 14 errors in substitute-receipt/report specs and no M8-05 file error.
- M8-05 commit: `6a70e2e fix(finance): normalize Bangkok business periods`.
- A concurrent CR-2 commit initially swept M8-05 staging and all untracked QA files into one commit. The latest local commit
  was split without losing content: CR-2 is `1b71614`, M8-05 is `6a70e2e`, and all three QA files remain outside git.
- M8-06 Thai-date boundary tests: 6/6 pass; web `tsc --noEmit` passes. Shared date/time/month formatters and three bypassing
  timestamp call sites now render in `Asia/Bangkok`; the UTC Aug-31 19:00 instant renders as Sep-1 02:00 in Bangkok.
- M8-06 commit: `062cc73 fix(web): render business dates in Bangkok time`.
- M8-07 focused tests: DeleteExpense 33/33 and web expense model 47/47 pass; web `tsc --noEmit` passes. Delete now checks
  branch scope and permission before document state/linked data, preserves company-central visibility, and uses a final
  `updatedAt` + tenant + branch-scope CAS so a concurrent confirm/branch move rolls the transaction back.
- Concurrent unrelated LINE media work appeared in two source files plus its memory while M8-07 ran; it remains unstaged.
Next:
- Re-run API typecheck after the M8-07 fixture type correction, then commit M8-07 only; keep QA and LINE media work out.
- M8-08: add optimistic concurrency to draft update and align UI retry/conflict behavior.
