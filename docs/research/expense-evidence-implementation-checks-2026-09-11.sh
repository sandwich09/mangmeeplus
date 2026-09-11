#!/usr/bin/env bash
# Run from the repository root with workspace dependencies installed.
set -euo pipefail
apps/api/node_modules/.bin/tsc -p packages/contracts/tsconfig.json
apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test \
  packages/contracts/src/expense-evidence.spec.ts \
  apps/api/src/modules/expenses/domain/logic/expense-document.logic.spec.ts \
  apps/api/src/modules/expenses/domain/logic/expense-status.logic.spec.ts \
  apps/api/src/modules/expenses/domain/logic/expense-source-draft.logic.spec.ts \
  apps/api/src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts \
  apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts \
  apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts \
  apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts \
  apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts \
  apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.substitute-number.spec.ts \
  apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts \
  apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
(
  cd apps/web
  ../api/node_modules/.bin/tsx --test src/features/expenses/expense-review-steps.logic.spec.ts src/features/expenses/expenses.model.spec.ts
)
