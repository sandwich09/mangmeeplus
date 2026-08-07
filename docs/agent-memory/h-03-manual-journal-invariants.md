# Agent Memory: H-03 Manual Journal Invariants

Status: Complete locally; deployment evidence pending
Owner: Codex
Scope: Manual-journal create/post tenant, branch, account, and provenance integrity; database tenant relations; tests/docs/checklist.
Decisions:
- Reuse the existing branch-scope helper and one shared application guard for create and post.
- Allow only active posting accounts owned by the company or approved global system accounts (`companyId = null`, `isSystem = true`).
- Manual input cannot own source, tax, report, tenant, actor, or status metadata.
- Use composite FKs for period/journal/branch coherence and a database trigger for the account relation because accounts may be company-owned or global system rows.
Open questions: None.
Artifacts: `docs/specs/double-entry-ledger-closing-spec.md`, `docs/plans/double-entry-ledger-closing-plan.md`, ledger DTO/use-case/repository/schema/migration/tests, security remediation checklist.
Verification:
- H-03 negative/reconciliation tests 10/10; focused H-02/H-03 suite 17/17.
- Full API regression 2023/2023; API and contracts typechecks pass.
- Prisma validate/generate and `git diff --check` pass.
- All 67 migrations deploy from an empty disposable PostgreSQL database.
- `apps/api/prisma/verification/h03_manual_journal_invariants.sql` passes: cross-company period/account/branch, forged manual provenance, and inactive-account post are rejected; approved global system account is accepted. Transaction rolls back and the disposable database was removed.
- Caller review found no web manual-journal form/E2E path; public manual creation is the concrete DTO path. Generated/reversal callers remain server-generated.
Next: Deploy an immutable artifact, run migration preflight/backup against a production-like copy, verify historical data passes fail-closed checks, then run authorized AC-01 retest.
