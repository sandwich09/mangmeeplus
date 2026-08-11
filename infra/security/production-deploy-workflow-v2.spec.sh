#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
workflow="$root/.github/workflows/deploy-production-v2.yml"
ready_workflow="$root/.github/workflows/production-readiness.yml"
runner="$root/infra/prod-ecs-express/run-release-task.sh"
deploy="$root/infra/prod-ecs-express/deploy.sh"
maintenance="$root/infra/prod-ecs-express/verify-production-maintenance.sh"

for required in \
  'UAT Release Passport V2' 'Production Readiness V2 run' \
  'validate-production-release-ready-v2.sh' 'validate-uat-release-passport-v2.sh' \
  'compare-production-ready-baseline-v2.sh' 'RELEASE_DATABASE_AUTHORITY: PRODUCTION_READY_V2' \
  'RELEASE_MODE: passport-promotion' 'PRODUCTION_READY_PENDING_CATALOG_HASH' \
  'wait-production-maintenance-ingress-drain.sh' 'verify-production-maintenance.sh all' \
  'validate-production-release-result-v2.sh' 'result.bundle' \
  'Recover an unsuccessful closed-stage promotion to the exact closed candidate' \
  'PROMOTION_SAFE_RECOVERY=true' 'Fail the requested promotion after a proved safe recovery'; do
  grep -Fq "$required" "$workflow" || { echo "ERROR: Production V2 workflow is missing $required" >&2; exit 1; }
done

for forbidden in 'pnpm ' 'npm ' 'yarn ' 'docker build' 'build-push-action' 'anchore/sbom-action' \
  'cosign sign ' 'cosign attest' 'uses: ./.github/workflows/ci.yml' 'prisma validate'; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "ERROR: Production V2 workflow repeats UAT source/build evidence: $forbidden" >&2
    exit 1
  fi
done

line() { grep -n -m1 "$1" "$workflow" | cut -d: -f1; }
ready_line="$(line 'validate-production-release-ready-v2.sh')"
security_line="$(line 'Configure read-only Production security credentials')"
reader_line="$(line 'Configure the dedicated A5 read-only controller')"
deploy_role_line="$(line 'Configure mutation-capable Production deploy credentials only after READY recheck')"
boundary_line="$(line 'Recheck stable service identity at the mutation boundary')"
prepare_line="$(line 'Recheck signed READY migration authority inside the durable database fence')"
rollout_line="$(line 'Roll out the exact UAT image digests without rebuilding')"
verify_line="$(line 'Verify exact digest, source, serving mode, health and deep DB readiness')"
retire_line="$(line 'Retire or reconcile launch-build authority')"
result_line="$(line 'Build, validate and sign Production Release Result V2')"
recovery_line="$(line 'Recover an unsuccessful closed-stage promotion')"
recovery_fail_line="$(line 'Fail the requested promotion after a proved safe recovery')"
test "$ready_line" -lt "$security_line"
test "$security_line" -lt "$reader_line"
test "$reader_line" -lt "$deploy_role_line"
test "$deploy_role_line" -lt "$boundary_line"
test "$boundary_line" -lt "$prepare_line"
test "$prepare_line" -lt "$rollout_line"
test "$rollout_line" -lt "$verify_line"
test "$verify_line" -lt "$recovery_line"
test "$recovery_line" -lt "$retire_line"
test "$verify_line" -lt "$retire_line"
test "$retire_line" -lt "$recovery_fail_line"
test "$recovery_fail_line" -lt "$result_line"
test "$retire_line" -lt "$result_line"

grep -Fq "if: env.REQUIRES_CLOSED_STAGE == 'true'" "$workflow"
grep -Fq "if: inputs.requested_serving_mode == 'live'" "$workflow"
grep -Fq 'EFFECTIVE_TARGET=$effective_target' "$workflow"
grep -Fq 'RELEASE_DEPLOY_TARGET: ${{ env.EFFECTIVE_TARGET }}' "$workflow"
grep -Fq 'bash infra/prod-ecs-express/deploy.sh "$RELEASE_DEPLOY_TARGET"' "$workflow"
grep -Fq 'DEPLOYMENT_EVIDENCE_DIR="$closed" RELEASE_TASKS_APPLIED_SHA=' "$workflow"
grep -Fq 'WORKER_INTERNAL_TOKEN="$(aws secretsmanager get-secret-value' "$workflow"
grep -Fq 'test "$ready_controller" = "$GITHUB_WORKFLOW_SHA"' "$workflow"
grep -Fq 'effectiveTarget:$target' "$ready_workflow"
grep -Fq 'alternate_expected_workflow="deploy-production-v2.yml"' "$runner"
grep -Fq 'RELEASE_MODE_INPUT" = passport-promotion' "$deploy"
grep -Fq 'deploy-production-v2.yml@refs/heads/main' "$maintenance"
grep -Fq 'promotion|maintenance-bootstrap|passport-promotion' "$maintenance"

test "$(grep -Ec 'uses: [^[:space:]]+@[0-9a-f]{40}([[:space:]]|$)' "$workflow")" = \
  "$(grep -Ec '^[[:space:]]+(- )?uses:' "$workflow")"
ruby -e 'require "yaml"; YAML.load(File.read(ARGV[0]))' "$workflow"
bash -n "$runner" "$deploy" "$maintenance"
echo 'Production deploy workflow V2 contract: PASS'
