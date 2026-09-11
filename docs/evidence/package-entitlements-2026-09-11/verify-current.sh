#!/usr/bin/env bash
# Existing implementation checks only; no claim of future paid E2E coverage.
set -euo pipefail
cd "$(dirname "$0")/../../.."
result_dir=docs/evidence/package-entitlements-2026-09-11
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=tap \
  "$result_dir/source-contract.spec.ts" \
  apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.spec.ts \
  apps/api/src/modules/external-signup/application/provision-signup.use-case.spec.ts \
  apps/api/src/modules/external-signup/application/provision-signup.plan-term.integration.spec.ts \
  apps/api/src/modules/external-signup/application/line-signup-auto-free.integration.spec.ts \
  apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.spec.ts \
  apps/api/src/modules/system-partner-management/domain/logic/receipt-quota.logic.spec.ts \
  apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts \
  packages/contracts/src/feature-entitlements.spec.ts > "$result_dir/focused.tap" 2>&1
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=tap \
  apps/api/src/modules/tax/application/use-cases/create-wht-certificate.use-case.spec.ts \
  apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.spec.ts \
  apps/api/src/modules/feature-launch/application/assert-specialist-routes-closed.spec.ts \
  > "$result_dir/tax-lock.tap" 2>&1
MARKETING_EVIDENCE_DIR="$result_dir/marketing" node e2e/stripe-marketing-readiness.mjs > "$result_dir/marketing.log" 2>&1
