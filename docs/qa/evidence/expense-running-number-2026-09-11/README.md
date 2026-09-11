# Evidence: expense numbering proof — 2026-09-11

Purpose: evidence for the pending [EXP spec](../../../specs/expense-running-number-flowaccount-spec-th.md), not release approval.

## Files

- `postgres-and-sequence.log`: 60 pass = 54 real PostgreSQL integration + 6 sequence logic/mock.
- `legacy-migration.log`: 3 pass against real PostgreSQL, existing reimbursement compatibility migration only.
- `baseline-browser.log`: unchanged baseline suite, 2 pass / 8 fail; classification in the [proof report](../../../research/expense-running-number-proof-2026-09-11-th.md).
- `linked-api-steps.json`: reduced, non-session API observations; one source-backed request progresses through reject/reopen/finance return/pay/void. Retry void returns 422.
- `linked-api-retry-failure.log`: strict API probe stops on that 422; this expected target-behavior assertion remains failed.
- `recovery-final.log`: final GET/DB-backed verification after recovery/cancellation; does not assert a second cancellation occurred.
- `db-inspection.json`: final source, request, projection and payment state, no duplicate ExpensePayment, plus snapshot hash experiment.
- `paper-render.log`, `paper-with-exp.svg`: real renderer regression reproduced with synthetic data; this is SVG evidence, not visual PDF acceptance.
- `*.probe.ts`: investigation harness sources. These are not installed product code or a green release suite. The linked probe deliberately documents an unmet retry expectation.
- `manifest.json`: hashes for evidence and the prebuilt API entrypoint, source commit and local environment identity.

Raw traces/session network artifacts remain under `/tmp/expense-number-proof-*results`; they are not copied into this evidence pack. Logs do not establish Production behavior.

## Reproduction setup

Use baseline `a3bfed76309a207d242b9aa27bc6b11b4f9077e4` in an isolated checkout with dependencies and generated Prisma client. This run used `/tmp/mangmee-substitute-editable-navigation-20260910` and its existing `dist/substitute-review` API artifact; this was not a fresh release build.

Create a fresh local PostgreSQL clone containing seeded users/branches/signature/files; never use customer data or a shared writable review DB. The seed and DB inspection probes refuse any DATABASE_URL without `/expense_number_proof_20260911`; verify the host is localhost as well. The linked probe refuses API endpoints other than `127.0.0.1:3011`. API env and clone runner remain in `/tmp/expense-number-proof-run.py`; credentials are not embedded here.

Apply the existing baseline migrations to the clone through normal Prisma migration history before running tests. Initial clone needed the two 20260910110000/20260910120000 substitute migrations. No EXP migration exists yet.

Commands used after configuring the isolated runner:

```sh
python3 /tmp/expense-number-proof-run.py exec pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts

python3 /tmp/expense-number-proof-run.py exec pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts src/modules/expenses/infrastructure/substitute-expense-edit.pg.spec.ts src/modules/expenses/infrastructure/substitute-funding.pg.spec.ts src/modules/data-model-core/infrastructure/repositories/document-sequence-branch-collision.spec.ts

python3 /tmp/expense-number-proof-run.py exec pnpm exec playwright test --project=chromium --workers=1 e2e/substitute-editable-navigation.spec.ts e2e/substitute-cancelled-view-only.spec.ts e2e/reimbursements.spec.ts
```

To replay investigation probes, copy `fixture-seed.probe.ts` / `db-inspect.probe.ts` to `apps/api/expense-number-proof-seed.ts` / `apps/api/expense-number-proof-inspect.ts`, and `linked-flow.probe.ts` to `e2e/expense-number-proof.spec.ts` in that disposable checkout. The source imports depend on these locations. Seed `reversal3` on a fresh clone; never overwrite an existing source fixture. Supply the existing local S3 settings and valid seed identities. The linked test changes only allowSelfApproval/requireReceipt/financeReviewRequired in the clone, then restores their values. MANAGER approves the frozen MANAGER step.

```sh
python3 /tmp/expense-number-proof-run.py exec pnpm --filter @watchdog-bms/api exec tsx expense-number-proof-seed.ts reversal3
python3 /tmp/expense-number-proof-run.py exec pnpm exec playwright test --project=chromium --workers=1 --grep='Proof:' e2e/expense-number-proof.spec.ts
python3 /tmp/expense-number-proof-run.py exec pnpm exec playwright test --project=chromium --workers=1 --grep='Recovery proof' e2e/expense-number-proof.spec.ts
python3 /tmp/expense-number-proof-run.py exec pnpm --filter @watchdog-bms/api exec tsx expense-number-proof-inspect.ts
```

The first test is expected to fail on duplicate void with the baseline implementation. Recovery reads its local JSON evidence and completes/inspects the same request. API-only mode is the default; `EXP_PROOF_UI=1` opts into the currently unproven browser steps. The old current fixture DB retains investigation attempts for diagnosis; use a fresh clone and unique fixture names for a clean replay. Do not report fixture retries as new coverage.

The pending spec requires clean-build browser, migration and posted-ledger acceptance after implementation. It cannot be accepted merely by rerunning the existing green PG tests.
