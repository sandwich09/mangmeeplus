# Stripe readiness review — local evidence, 2026-09-10

This is not a Stripe payment/E2E acceptance result. No Stripe account, database, cloud, card charge or external notification was accessed by these checks.

## Existing local tests

Run from the mangmeeplus root:

```sh
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=dot apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.spec.ts apps/api/src/modules/auth/auth.guard.spec.ts
```

Result: exit 0; 67 passing test dots. These cover the existing manual plan-term/auth behavior, not Stripe checkout, callbacks or paid activation.

## Reproduced manual-renew recovery gap (R01)

```sh
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json docs/evidence/stripe-readiness-2026-09-10/manual-renew-replay.probe.ts
```

Result: exit 0; **REPRODUCED GAP**, not acceptance PASS.

The [probe](manual-renew-replay.probe.ts) calls the current `RenewCompanyPlanTermUseCase` with in-memory dependencies. It starts with a term-expired DISABLED company and injects an exception from lifecycle activation after the term/audit transaction completes. Repeating the same request finds the SUCCESS audit and returns without calling activation again. The company stays DISABLED and its term-disabled marker has already been cleared.

This demonstrates a recovery defect in the reusable manual-renew path. It does not demonstrate a production occurrence or an existing Stripe charge. Runtime code was not changed. Before billing integration, completion tracking must cover activation as well as term updates, and crash/replay/concurrency tests must prove recovery without granting a second period or overriding a later admin hold.

Source: [manual renew](../../../apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.ts), [AuthGuard](../../../apps/api/src/modules/auth/presentation/auth.guard.ts), [expiry sweep](../../../apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.ts).

Full scope and unrun Stripe cases: [implementation/test plan](../../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md).
