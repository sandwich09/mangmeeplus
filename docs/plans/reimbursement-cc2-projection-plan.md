# Plan: Reimbursement CC2 Standalone Projection

Spec: `docs/specs/reimbursement-cc2-projection-spec.md`

Working rule: ponytail full; reuse existing expense confirm/duplicate/posting paths; no dependency.

1. [in progress] Add and backfill the unique claim-line projection identity with fail-closed SQL.
2. [pending] Make materialization a reusable idempotent repository operation rather than part of
   manager approval unconditionally.
3. [pending] Add an explicit reimbursement-bound internal entry into the existing full expense
   confirm use case; retain branch, source CAS, tax, period, audit and outbox checks.
4. [pending] Orchestrate scan + confirm at finance approval or no-finance final approval with neutral
   VAT evidence and duplicate exceptions.
5. [pending] Gate payment/settlement ordering, terminalize unposted projections on cancel and reject
   generic posting of unconfirmed expenses.
6. [pending] Expose the smallest reimbursement-owned duplicate resolution/read state needed for a
   finance user while Expenses is OFF.
7. [pending] Add CC2 unit/contract/real-PostgreSQL tests and run focused typecheck/tests.
8. [pending] Record exact remaining blocker. If any P0 remains, leave production unquiesce blocked.

Explicit integration gates: branch/ABAC must be proven on internal confirmation; audit/outbox must
describe committed outcomes only. These are blockers, not permission shortcuts or later polish.
