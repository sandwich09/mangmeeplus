# Agent Memory: reimbursement-cc2-projection

Status: IN PROGRESS at 2026-08-04 handoff; production reimbursement unquiesce blocked. Canonical
handoff: `docs/agent-memory/feature-entitlement-u5-production-handoff.md`.
Owner: CC2 implementation lane
Scope: standalone reimbursement projection, confirmation, duplicates, payment/ledger ordering and
cancel compensation; no AWS, commit or push
Decisions:
- Preserve the existing fail-closed snapshot/approval-step/race patch and satang normalization.
- Use additive source-line uniqueness and automatic exact backfill; no user migration/input.
- Reuse the full expense confirm and duplicate domains through explicit reimbursement authority;
  never grant expense permissions or require the Expenses UI.
- Cash payout may proceed for the CC2 duplicate exception, but Ledger settlement cannot outrun the
  accrual; Ledger OFF remains valid.
Open questions:
- None may be answered by weakening CC2. An implementation gap keeps unquiesce blocked.
Artifacts:
- `docs/specs/reimbursement-cc2-projection-spec.md`
- `docs/plans/reimbursement-cc2-projection-plan.md`
Verification:
- Prisma initially failed P1012 because the one-to-one source-line relation lacked an exact
  defining-side compound unique. The handoff session added the matching Prisma and migration
  triple unique; `corepack pnpm --filter @watchdog-bms/api prisma:validate` then passed.
- A subsequent typecheck returned exit 0 while files were still changing, so it is not accepted as
  frozen-byte evidence. Focused and real-PostgreSQL CC2 suites are not complete.

Next:
- Delete the unreachable legacy `approveRequestAtomic` materializer after migrating callers/tests;
  it currently fails closed with `legacy_reimbursement_approval_path_disabled`.
- Finish branch/role/bank-account/payment/audit-outbox invariants, cancellation/reconciler DI and
  duplicate-resolution UX/API.
- Run frozen-byte typecheck, focused tests, DI boot, migration replay and real-PostgreSQL
  cross-tenant/race/rollback tests before unquiesce.
