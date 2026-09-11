#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
result_dir=docs/evidence/package-access-2026-09-11
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-concurrency=2 --test-reporter=tap \
  apps/api/src/modules/access-control/permission-resolver.spec.ts \
  apps/api/src/modules/employee-access/application/entitlement.helper.spec.ts \
  apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts \
  apps/api/src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts \
  apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts \
  apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts \
  apps/api/src/modules/line-ai/infrastructure/actor-delegation.service.spec.ts \
  apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts \
  apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts \
  apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts > "$result_dir/api.tap" 2>&1
node_modules/.bin/tsx --tsconfig apps/ai-gateway/tsconfig.json --test --test-concurrency=2 --test-reporter=tap \
  apps/ai-gateway/src/agentcore/runtime.spec.ts \
  apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts \
  apps/ai-gateway/src/modules/line-ai/agents/agent-tools.registry.spec.ts \
  apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts \
  apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts > "$result_dir/gateway.tap" 2>&1
node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=tap \
  apps/web/src/features/system-partners/system-partners.logic.spec.ts \
  apps/web/src/features/system-partners/plan-term.logic.spec.ts \
  apps/web/src/common/auth/session-gate.logic.spec.ts > "$result_dir/web.tap" 2>&1
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-concurrency=2 --test-reporter=tap \
  apps/api/src/modules/dashboard-notifications/application/use-cases/generate-snapshot.use-case.spec.ts \
  apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts \
  apps/api/src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts \
  apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts \
  apps/api/src/modules/reimbursements/application/use-cases/reimbursement-related-access.use-case.spec.ts \
  apps/api/src/modules/reimbursements/application/use-cases/reimbursement-branch-scope.use-case.spec.ts \
  apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.spec.ts \
  apps/api/src/modules/employee-access/application/use-cases/employee-lifecycle.use-case.spec.ts \
  apps/api/src/modules/employee-access/application/use-cases/update-employee-branch-scope.spec.ts \
  apps/api/src/modules/data-model-core/application/use-cases/create-branch.use-case.spec.ts \
  apps/api/src/modules/data-model-core/application/use-cases/list-branches.use-case.spec.ts > "$result_dir/user-features.tap" 2>&1
