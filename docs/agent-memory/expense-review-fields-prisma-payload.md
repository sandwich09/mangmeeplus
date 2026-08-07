# Agent Memory: Expense review-fields Prisma payload

Status: Fixed and locally verified; production deployment pending
Owner: WatchDog-BMS product owner
Scope: Expense review-field save path and `ExpenseLine` Prisma persistence boundary
Decisions:
- Production `PATCH /expenses/:expenseId/review-fields` failed because resolver-only `transactionContext` reached `prisma.expenseLine.upsert()`.
- Persist `ExpenseLine` through an explicit Prisma-field allowlist rather than spreading the runtime tax resolver object. This also blocks `externalTaxCode`, `sourceLineId`, `evidenceRefs`, authoritative import/customs amounts, `taxSnapshot`, and `taxComponents` from leaking into create or update data.
- Continue deriving persisted tax snapshot/component columns from the resolved `taxSnapshot` and `taxComponents` only.
Open questions:
- None for the code fix. Production still needs the API/web ECS deploy path before the UI retry can pass.
Artifacts:
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.tax-snapshot.spec.ts`
Verification:
- Production CloudWatch request `50759b0a-05cc-4ffc-9daf-8aaf47b4648f` confirmed `PrismaClientValidationError: Unknown argument transactionContext` on 2026-07-15.
- Focused expense/tax tests: 29/29 passed.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed.
- `git diff --check`: passed before the final memory update.
Next:
- Deploy `api-web`, wait for ECS rollout success, then retry saving the reviewed category and preparing the substitute receipt in the production UI.
