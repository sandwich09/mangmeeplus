# Spec: Reimbursement CC2 Standalone Projection

Status: implementation contract for the production-shadow candidate

Normative parent: `docs/specs/feature-entitlement-decoupling-spec.md` CC2 and AC12. If this file
conflicts with the parent, the parent wins and production reimbursement writes stay quiesced.

## Outcome

An approved reimbursement remains usable when the `expenses` entitlement is OFF. The employee and
finance user do not enable another feature, migrate data, re-enter a receipt, choose an account or
repeat tax facts. The reimbursement service owns creation and confirmation of its expense
projection through the existing expense domain unit of work.

## Rules

1. Every claim-born expense stores `sourceReimbursementLineId`. The database enforces one
   `(companyId, sourceReimbursementLineId)` projection. Deployment backfills it from the exact
   `ReimbursementLine.linkedExpenseId` plus request-source match and aborts on zero/ambiguous legacy
   matches; it never asks a customer to repair a row.
2. When finance review is required, manager approval creates no projection. Finance
   `APPROVED_FOR_PAYMENT` creates/scans/confirms it. Without finance review, final manager approval
   performs the same orchestration before the request becomes `READY_FOR_PAYMENT`.
3. The shared expense-confirm unit performs the existing source/version, branch, substitute
   evidence, `validateConfirm`, tax evidence/finalization, period-lock, number, audit and outbox
   work. Reimbursement calls it through an explicit internal authority bound to the exact company,
   request, line and projection; no `expense.*` permission is granted to the actor and no Expenses
   route/UI is called.
4. A new claim projection starts with neutral VAT evidence. Reimbursement alone never proves
   `NON_CLAIMABLE`; until tax facts resolve, the expense-compatible adapter uses `vatMode=NEEDS_REVIEW`
   and `inputVatClaimStatus=NEEDS_REVIEW`, preserving gross amount and evidence for later resolution.
5. The expense duplicate scanner runs before confirmation. `NO_MATCH`/resolved false match resumes
   the same full confirm. A suspected or confirmed duplicate remains `READY_FOR_CONFIRMATION` and
   does not block cash payout. Confirmed duplicate is `postingStatus=not_required`; reimbursement
   finance owns the resolution action without requiring the Expenses entitlement. A later direct
   expense upload must see the claim-born projection through the same checksum/candidate index.
6. Payment readiness requires every claim-born line to have either a confirmed projection or the
   explicit suspected/confirmed-duplicate exception. Ledger being OFF never blocks reimbursement.
   If Ledger is ON, settlement posting may run only after every non-duplicate claim projection has
   a posted accrual; a suspected duplicate keeps settlement pending while cash payout remains valid.
7. Cancelling/voiding a request terminalizes every unposted claim projection. A posted projection
   requires an exact current-open reversal before the request can reach its terminal state. Period
   close counts only live unresolved claim projections.
8. Generic `expense.record` journal generation rejects every source except `CONFIRMED` (or the
   existing explicit VOID/reversal path). Internal reimbursement authority cannot bypass this.
9. `FEATURE_DEPENDENCIES` continues to contain no `reimbursement => expenses` edge.

## Security and failure behavior

- Tenant and branch scope are checked against both the reimbursement line and expense projection.
- Projection, request transition and any duplicate terminal state are compare-and-set/idempotent.
- Audit/outbox claims are emitted only for committed transitions. If cross-module orchestration
  cannot share one transaction, the request remains at its pre-decision state and an idempotent retry
  resumes from the unique source line; it never fabricates success.
- Missing/invalid source linkage, locked accounting/tax period, unresolved non-duplicate evidence,
  or missing accrual authority fails with a stable code and keeps typed/user data intact.

## Acceptance

- CC2-1..CC2-9 in `feature-entitlement-derived-views.md` are executable tests.
- Real PostgreSQL proves unique source-line races, retry after partial failure, backfill exactness,
  no-finance timing, finance timing, cancel compensation and payment/accrual ordering.
- A journey with `reimbursement=ON`, `expenses=OFF` reaches approval, finance/no-finance
  projection, payout and later Ledger backfill without expense permissions or customer re-entry.
- Production may not unquiesce reimbursement until these checks pass. Keeping writes quiesced is a
  containment state, not production completion.
