# Expense Ledger Auto-post Implementation Plan

## Status

Approved for implementation on 2026-07-29.

## Linked Spec

- Spec: [[specs/expense-ledger-auto-post-spec|Expense Ledger Auto-post with Accountant Exception Queue]]
- Expense source: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Ledger: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
- Known gaps: [[specs/finance-accounting-gaps-spec|Finance and Accounting Gaps]]
- Related guidelines: backend hexagonal, web frontend, and security implementation guidelines

## Purpose

Implement the agreed expense-to-ledger journey in small reviewable rounds: truthful source confirmation,
reliable accountant evidence/export, manual post/retry, per-company guarded Auto-post, and explicit
historical backfill.

## Current Repository Context

- Expense confirmation already atomically assigns `EXP-*`, writes the `expense.confirmed` outbox row, and
  sets `postingStatus='pending'`.
- `GenerateJournalFromSourceUseCase` already canonicalizes sources, validates rules/accounts/tax/period,
  generates a posted JV, writes source status, audits, and is idempotent.
- `POST /posting/generate` exists; Accounts Payable already calls it from web.
- Expense detail already receives `postingStatus` and `postingError`, but does not render them and does not
  expose `journalEntryId/entryNumber`.
- Evidence API already accepts document/posting filters, but web does not expose them.
- Evidence folders currently return `evidenceCount=0`; default evidence/export filters do not force
  confirmed status; export silently caps at 500 rows.
- Journal list/detail APIs exist, while the current journal web page only renders aggregate reports.
- Feature entitlements already provide an audited per-company toggle and `updatedAt`; reuse them instead of
  adding a policy table.
- Workers already use BullMQ repeatable jobs that call worker-token-protected internal API drains.

## Implementation Rules

- Ponytail full mode: reuse the canonical generator, feature entitlements, worker HTTP pattern, existing
  expense evidence page, and journal APIs; add no dependency.
- Do not consume `OutboxEvent.status` as a second subscriber. Scan authoritative pending expense rows.
- Keep controllers thin and worker contexts least privilege.
- Auto-post eligibility may prevent an attempt; it may never bypass canonical ledger validation.
- Keep all existing tenant, branch, permission, audit, tax, period, and final-mutation boundaries.
- One focused runnable check per non-trivial logic change.
- Review, commit, and push each completed phase separately.

## Scope

### In Scope

- New `expense_auto_post` entitlement, dependency validation, and partner UI explanation.
- Truthful confirmation/posting copy and state presentation.
- Default confirmed accounting-evidence scope, correct attachment counts, posting filters/status.
- Posting/JV columns and explicit truncation metadata in accountant XLSX.
- Expense manual post/retry and exact JV navigation.
- Compact generated-journal list/filter on the existing journal page.
- Worker-token-protected bounded expense Auto-post drain.
- Historical pending preview and explicitly confirmed bounded backfill.
- Focused unit/API/web/worker tests and one expense-to-JV browser journey where the existing harness permits.

### Out of Scope

- Auto-post for non-expense sources.
- ZIP evidence bundle, public links, permanent links, or external email delivery.
- New posting-rule editor or chart-of-account design.
- Bulk mutation of warning rows.
- Silent historical catch-up.

## Phase 0: Discovery and Alignment

### Goal

Confirm current code, contracts, feature gates, worker pattern, journal idempotency, and dirty-worktree safety.

### Tasks

- [x] Trace expense confirm -> outbox -> posting status.
- [x] Trace canonical journal generation and manual endpoint.
- [x] Trace evidence view/export and journal web gaps.
- [x] Select `CompanyFeatureEntitlement.updatedAt` as activation boundary.
- [x] Select pending-source scan rather than outbox publish status.
- [x] Isolate work on `codex/expense-ledger-auto-post` because the main worktree has unrelated merge state.

### Exit Criteria

- Product rules and architecture are explicit with no unresolved scope boundary.

## Phase 1: Truthful Expense and Evidence Surface

### Goal

Make current manual mode honest and make accountant evidence/export trustworthy before automation.

### Tasks

- [x] Change confirmation action/copy to source confirmation, not completed posting.
- [x] Expose expense journal id/number and posting error/status in contracts and UI.
- [x] Default shared evidence and package export to `CONFIRMED`.
- [x] Allow explicit voided filtering for audit.
- [x] Calculate folder `evidenceCount` from active attachment links.
- [x] Rename evidence completeness status and add document/posting status filters and columns.
- [x] Add posting status/error/JV reference to full export.
- [x] Add `totalMatched` and `truncated`; warn before exporting flagged rows and after bounded truncation.
- [x] Add manual expense post/retry using the existing generator.
- [x] Add a compact source-filterable JV list to the journal page.

### Tests

- Expense evidence use-case/repository focused tests.
- Expense export logic tests.
- Web evidence logic/model tests.
- Contracts build, API/web typecheck.

### Exit Criteria

- A confirmed pending expense is never presented as posted.
- Internal/external accountant paths show the same truthful source/posting state.
- Manual post/retry reaches the canonical generator and exact JV.

### Delivery

- Review phase diff.
- Commit and push Phase 1 independently.

## Phase 2: Per-company Auto-post and Exception Queue

### Goal

Enable guarded automatic posting only for new clean expenses while leaving exceptions visible and retryable.

### Tasks

- [x] Add `expense_auto_post` to approved feature keys and partner feature UI.
- [x] Reject invalid effective configuration where Auto-post is on and ledger is off.
- [x] Preserve the Auto-post activation boundary when unrelated feature settings change.
- [x] Add pure expense Auto-post evidence blocker logic with focused tests.
- [x] Resolve manual post/retry source from generated-journal truth so the accrual and later payment leg
  cannot hide one another behind the shared expense posting flag.
- [x] Add bounded drain use case:
  - active company;
  - both entitlements enabled;
  - confirmed after activation boundary;
  - posting status pending;
  - no evidence blocker;
  - no existing generated `expense.record` journal;
  - canonical generator remains authoritative.
- [x] 2026-08-10 hardening: scan append-only `ExpensePayment` candidates created after activation, require
  the parent accrual JV to be posted, and write a failed attempt only to that payment's posting state.
- [x] Add worker-token-protected internal controller with least-privilege system context.
- [x] Add BullMQ repeatable worker using the existing internal HTTP pattern.
- [x] Surface pending-warning and posting-error rows as accountant queue states.

### Tests

- Entitlement dependency tests.
- Auto-post blocker tests.
- Drain use-case tests for entitlement, activation boundary, warning skip, success, failure, and idempotency.
- Internal controller worker-token test.
- Worker job test.
- API/workers typecheck.

### Exit Criteria

- Only eligible new expenses post automatically.
- Warning/error rows remain visible for accountant action.
- Worker retries and accountant actions cannot create duplicate journals.

### Delivery

- Review phase diff.
- Commit and push Phase 2 independently.

## Phase 3: Historical Backfill

### Goal

Allow accountants to handle pre-activation pending expenses without silent catch-up.

### Tasks

- [x] Add preview query with activation time, eligible/manual counts, blocker summary, and bounded samples.
- [x] Add explicitly invoked bounded backfill mutation for eligible pre-activation expenses.
- [x] Add web preview and confirmation action.
- [x] Return posted/failed/skipped/remaining counts and keep failed rows retryable.
- [x] Audit execution summary without source payloads.

### Tests

- Preview/run permission and branch scope.
- Pre-activation boundary.
- Warning rows skipped.
- Closed period/config error fail closed.
- Concurrent/idempotent generation.

### Exit Criteria

- Enabling Auto-post never silently posts historical rows.
- Backfill impact is visible and requires an accountant confirmation.

### Delivery

- Review phase diff.
- Commit and push Phase 3 independently.

## Phase 4: Integration Verification and Handoff

### Goal

Verify the complete journey and reconcile source docs/task memory.

### Tasks

- [x] Run focused API, web, worker, contract, and Prisma validation.
- [ ] Run existing journal/expense browser checks in a deployed authenticated environment.
- [x] Verify confirm -> pending -> post -> exact JV through focused automated coverage and the
  user-verified confirmation/evidence/export journey.
- [x] Review permissions, loading/error/readonly states, and external export copy.
- [x] Update linked specs/known-gap status and task memory with exact evidence.

## Phase 5: Partial-payment lifecycle hardening (2026-08-10)

- [x] Add append-only `ExpensePayment` history and migrate legacy paid rows without rewriting ledger sources.
- [x] Accumulate paid/outstanding totals with Decimal arithmetic under one serializable lifecycle transaction.
- [x] Keep accrual and each settlement posting state/JV independent.
- [x] Post each partial payment manually or through the guarded drain after accrual posting.
- [x] Add payment history to expense detail and use the exact pending source id for manual posting.
- [x] Make substitute-receipt approval create only the missing payment fact.
- [x] Reverse and void every payment event atomically with expense void.
- [x] Expose each payment event as a separate bank-match candidate and preserve legacy confirmed match identity.

Final build note: the production build completed earlier in the implementation, but the final rerun after the
Phase 3 UI change hung in Next.js optimization twice and was stopped without a compile error. Final web
TypeScript validation passed. Live authenticated browser verification remains a rollout check because the
isolated worktree has no signed-in test environment.

### Exit Criteria

- Verification evidence and remaining deployment/rollout state are explicit.

### Delivery

- Review final diff.
- Commit and push documentation/handoff independently.

## Phase 6: Claim payouts reach the ledger (2026-10-01)

Spec section 17. Branch `claude/claim-payment-ledger-posting-20261001`; task memory
`docs/agent-memory/claim-payment-ledger-posting.md`.

- [x] Drain selects a ready `reimbursement.payment` under the expense-payment rules and waits for
  every claim accrual in SQL, so a payout that is not ready stays `pending`.
- [x] A frozen `reimbursement` family removes claim payouts from the drain only.
- [x] A failed payout is marked `posting_error` through the reimbursement repository.
- [x] The worklist endpoint also returns `posting_error` payouts.
- [x] The accounting-evidence screen lists unposted payouts and posts them through the existing
  generate endpoint, behind the same switch and rights as the other posting buttons.
- [x] The period-close check carries its three counts; the web names each kind, links to the screen
  that fixes it, and shows the checks when a close is refused.
- [x] Registered unit specs assert the claim, payment, journal and expense-record amounts, the
  void reversal and pay-again; an opt-in PostgreSQL spec proves the same against real tables.
- [ ] Owner or accountant decision: the settlement mapping for companies on `TH_SME_COA_V1`, and the
  ledger account of a typed claim line (spec section 17.3). Until then posting fails closed there.
- [ ] Owner decision: reopen the accounting screens (`ACCOUNTING_UI_HIDDEN`). Until then the worklist
  and the period-close screen are not visible to anyone.

## Integration Verification

- Backend/API: canonical source and journal contracts, entitlement dependency, worker token, branch scope.
- Web: confirmation copy, evidence queue, post/retry, export warning, JV deep link, partner toggle.
- Error states: missing evidence, tax review, account/rule missing, closed period, permission denied,
  truncated export, expired manifest explanation.
- Commands:
  - `corepack pnpm --filter @watchdog-bms/contracts build`
  - focused `tsx --test` suites for touched API/worker/web logic
  - `corepack pnpm --filter @watchdog-bms/api typecheck`
  - `corepack pnpm --filter @watchdog-bms/web typecheck`
  - `corepack pnpm --filter @watchdog-bms/workers typecheck`
  - `corepack pnpm --filter @watchdog-bms/web build`
  - focused Playwright journal/expense journey when environment is available

## Risks

- A worker using outbox publish state would race the workflow subscriber; source-row scan avoids it.
- Feature-toggle timestamps reset on re-enable; this is intentional and must be tested.
- Current export bounds may omit rows; explicit truncation metadata prevents false completeness.
- Auto-post evidence checks and UI flags can drift; keep shared rule names/conditions aligned in tests.
- Closed-period and mapping errors must never be converted into a bypassable manual action.

## Open Questions

None. Product decisions required for this scope were resolved on 2026-07-29.
