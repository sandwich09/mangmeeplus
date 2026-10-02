# Billing purchase recovery audit and repair — 2026-10-02

Owner request: simulate E2E broadly across trial/expiry/full/differential purchase and dependencies, implement confirmed defects, and verify again. Local application changes and disposable test data are authorized. Production operations are outside this implementation.

## Product and acceptance

- Valid existing trials (active/expired), no-package shops, and expired paid terms can start their approved INITIAL/RESTART journey. Differential/full purchase obey current paid provenance and the approved package amendment.
- The customer sees why a purchase is blocked before a predictable local quote refusal, with the existing recovery action. Debt/refund/dispute, unknown Checkout, admin/security holds, permissions and tenant boundaries remain enforced.
- An open page refreshes eligibility at expiry and on returning to the foreground, including pending operation completion. Failed nonessential history loading does not erase a valid purchase page; status/catalog failures remain closed with retry.
- Every confirmed repair has executable regression evidence. Post-payment access, receipt grants, capacity selection, feature entitlements, recipient operations, old subscriptions, and the existing refund-end action are included in dependency verification.

## Architecture and scope

Use existing BillingStatus/quote/Checkout/reconciliation and recovery routes. Keep policy/source predicates shared where practical; expose optional specific block codes through the existing contract and error translation. No new provider, schema migration, package dependency, or package.json edit. Preserve all financial evidence and use existing operation fences.

## Execution

1. Base clean worktree on main; preserve unrelated work in the primary checkout. Read current specs and callers, comparing deployed source where the original incident matters.
2. Bring up task-owned local PostgreSQL/Redis, apply existing migrations, and reuse compiled Nest HTTP + Next/Chromium harness with simulated Stripe/Postmark/LINE.
3. Execute baseline and focused failure probes before runtime edits. Record findings by reproducibility, impact, dependency, and recovery requirement; inspect broader billing/term/auth/capacity/receipt/recipient regressions.
4. Repair confirmed shared-source/status/UI inconsistencies and any additional scoped defects the simulations reveal. Extend existing tests/harness, keeping successful provider/payment semantics intact.
5. Re-run focused checks, actual HTTP/database/browser scenarios and dependency regressions; build/typecheck contracts/API/web, review scoped diff, inspect captured UI where changed, and record any remaining proof limits.

## Initial probes from prior diagnosis

- Page held open across one-time expiry retains obsolete mode availability.
- Local FINANCIAL_REVIEW on terminal expired subscription is missing from status gating.
- Pending recipient change is missing from purchase gating.
- Existing refunded active one-time source advertises full/differential purchases that quote refuses.
- Missing specific blocker reasons for closed policy/gates, payable old subscription, pending plan/collection, pause, and grace.
- Promise.all history failure can erase the purchase page.
- Verify source guards are applied consistently to deals and ordinary catalog paths, and stale refresh cannot overwrite newer mutations or a newly selected company.

## Verification record

Implemented and verified confirmed defects. Full API/PG dependency acceptance passed 266 groups; customer HTTP/PG/Next/Chromium passed 113 groups; focused recovery passed 30 groups; one-time/no-setup passed 7 groups. Focused unit/frontend/PG checks passed 146 tests with no skips. See the [task memory](../agent-memory/billing-purchase-recovery-implementation-2026-10-02.md) for commands/logs and the [Thai evidence report](../research/billing-purchase-recovery-bugs-2026-10-02-th.md) for causes/impacts and remaining proof limits. Counts overlap across suites. The broader admin draft browser fixture still uses obsolete selectors; no full admin-browser pass is claimed. Simulated provider E2E is not native Stripe payment or a deployment acceptance.
