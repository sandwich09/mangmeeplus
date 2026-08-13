#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
workflow="$root/.github/workflows/deploy-production-v2.yml"
ready_workflow="$root/.github/workflows/production-readiness.yml"
runner="$root/infra/prod-ecs-express/run-release-task.sh"
deploy="$root/infra/prod-ecs-express/deploy.sh"
maintenance="$root/infra/prod-ecs-express/verify-production-maintenance.sh"
recovery="$root/.github/workflows/recover-release-intent.yml"

for required in \
  'UAT Release Passport V2' 'Production Readiness V2 run' \
  'validate-production-release-ready-v2.sh' 'validate-uat-release-passport-v2.sh' \
  'compare-production-ready-baseline-v2.sh' 'RELEASE_DATABASE_AUTHORITY: PRODUCTION_READY_V2' \
  'RELEASE_MODE: passport-promotion' 'PRODUCTION_READY_PENDING_CATALOG_HASH' \
  'wait-production-maintenance-ingress-drain.sh' 'verify-production-maintenance.sh all' \
  'validate-production-release-result-v2.sh' 'result.bundle' \
  'Recover an unsuccessful closed-stage promotion to the exact closed candidate' \
  'PROMOTION_SAFE_RECOVERY=true' 'Fail the requested promotion after a proved safe recovery' \
  'PRODUCTION_POLICY_READ_TOKEN_CONFIGURED=true' 'role-duration-seconds: 7200' \
  'AWS_DEPLOY_ROLE_ARN: ${{ vars.AWS_DEPLOY_ROLE_ARN }}' \
  "DEPLOYMENT_POLL_ATTEMPTS: '75'" 'timeout-minutes: 360' 'ALLOCATED_BEFORE_RELEASE_PREPARE' \
  'RECONCILIATION_MAY_BE_REQUIRED' 'run-production-release-prepare.sh'; do
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
preflight_line="$(line 'Prove maintenance bootstrap compatibility before closing Production')"
bootstrap_line="$(line 'Close the exact candidate before any Production database mutation')"
release_refresh_line="$(line 'Refresh Production deploy credentials for the durable release envelope')"
identity_line="$(line 'Persist the durable release operation identity before database preparation')"
prepare_line="$(line 'Recheck signed READY migration authority inside the durable database fence')"
rollout_line="$(line 'Roll out the exact UAT image digests without rebuilding')"
verify_line="$(line 'Verify exact digest, source, serving mode, health and deep DB readiness')"
retire_line="$(line 'Retire or reconcile launch-build authority')"
result_line="$(line 'Build, validate and sign Production Release Result V2')"
recovery_line="$(line 'Recover an unsuccessful closed-stage promotion')"
recovery_refresh_line="$(line 'Refresh Production deploy credentials for bounded closed-stage recovery')"
finalize_refresh_line="$(line 'Refresh Production deploy credentials for durable release finalization')"
recovery_fail_line="$(line 'Fail the requested promotion after a proved safe recovery')"
test "$ready_line" -lt "$security_line"
test "$security_line" -lt "$reader_line"
test "$reader_line" -lt "$deploy_role_line"
test "$deploy_role_line" -lt "$boundary_line"
test "$boundary_line" -lt "$preflight_line"
test "$preflight_line" -lt "$bootstrap_line"
test "$bootstrap_line" -lt "$release_refresh_line"
test "$release_refresh_line" -lt "$identity_line"
test "$identity_line" -lt "$prepare_line"
test "$prepare_line" -lt "$rollout_line"
test "$rollout_line" -lt "$verify_line"
test "$verify_line" -lt "$recovery_refresh_line"
test "$recovery_refresh_line" -lt "$recovery_line"
test "$recovery_line" -lt "$retire_line"
test "$recovery_line" -lt "$finalize_refresh_line"
test "$finalize_refresh_line" -lt "$retire_line"
test "$verify_line" -lt "$retire_line"
test "$retire_line" -lt "$recovery_fail_line"
test "$recovery_fail_line" -lt "$result_line"
test "$retire_line" -lt "$result_line"

grep -Fq "if: env.REQUIRES_CLOSED_STAGE == 'true'" "$workflow"
grep -Fq "if: inputs.requested_serving_mode == 'live'" "$workflow"
grep -Fq 'EFFECTIVE_TARGET=$effective_target' "$workflow"
grep -Fq 'bash infra/prod-ecs-express/deploy.sh "$EFFECTIVE_TARGET"' "$workflow"
grep -Fq 'RELEASE_DEPLOY_TARGET: ${{ env.EFFECTIVE_TARGET }}' \
  <(sed -n "${prepare_line},${rollout_line}p" "$workflow")
! sed -n "${rollout_line},${verify_line}p" "$workflow" | grep -Fq 'RELEASE_DEPLOY_TARGET:'
! sed -n "${recovery_line},${finalize_refresh_line}p" "$workflow" | grep -Fq 'RELEASE_DEPLOY_TARGET:'
grep -Fq 'DEPLOYMENT_EVIDENCE_DIR="$closed" RELEASE_TASKS_APPLIED_SHA=' "$workflow"
grep -Fq 'id: bootstrap-close' "$workflow"
grep -Fq 'id: release-prepare' "$workflow"
grep -Fq 'id: refresh-recovery' "$workflow"
grep -Fq 'id: refresh-finalize' "$workflow"
test "$(grep -Fc 'role-duration-seconds: 7200' "$workflow")" = 4
test "$(grep -Fc 'run-production-release-prepare.sh' "$workflow")" = 1
! sed -n "${prepare_line},${rollout_line}p" "$workflow" \
  | grep -Fq 'run-release-task.sh "$RELEASE_TASK_IMAGE" "$SOURCE_SHA" release-prepare'
grep -Fq '"RELEASE_OPERATION_ID=$operation_id"' "$workflow"
! grep -Fq '"RELEASE_PARENT_OPERATION_ID=$operation_id"' "$workflow"
grep -Fq "steps.bootstrap-close.outcome == 'failure'" "$workflow"
grep -Fq "steps.rollout.outcome == 'failure'" "$workflow"
grep -Fq "steps.verify-health.outcome == 'failure'" "$workflow"
! grep -Fq "steps.rollout.outcome != 'success'" "$workflow"
grep -Fq 'export RELEASE_MODE=maintenance-bootstrap MAINTENANCE_BOOTSTRAP_READONLY=true' "$workflow"
grep -Fq "steps.release-prepare.outcome == 'success'" "$workflow"
grep -Fq "steps.refresh-recovery.outcome == 'success'" "$workflow"
grep -Fq "steps.refresh-finalize.outcome == 'success'" "$workflow"
grep -Fq 'WORKER_INTERNAL_TOKEN="$(aws secretsmanager get-secret-value' "$workflow"
grep -Fq 'test "$ready_controller" = "$GITHUB_WORKFLOW_SHA"' "$workflow"
grep -Fq 'effectiveTarget:$target' "$ready_workflow"
grep -Fq 'alternate_expected_workflow="deploy-production-v2.yml"' "$runner"
grep -Fq 'RELEASE_MODE_INPUT" = passport-promotion' "$deploy"
grep -Fq 'deploy-production-v2.yml@refs/heads/main' "$maintenance"
grep -Fq 'promotion|maintenance-bootstrap|passport-promotion' "$maintenance"
grep -Fq 'deploy_workflow=deploy-production-v2.yml' "$recovery"
grep -Fq 'image_signer_workflow=deploy-uat.yml' "$recovery"
grep -Fq '.RELEASE_GITHUB_WORKFLOW_REF' "$recovery"
grep -Fq "inputs.intent_id == 'BOOTSTRAP_CLOSED'" "$recovery"
grep -Fq 'release-bootstrap-closed-recover' "$recovery"
grep -Fq 'RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON:' "$recovery"
grep -Fq 'production-v2-controller-evidence-${RELEASE_REF}-attempt-${attempt}' "$recovery"
grep -Fq 'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02' "$recovery"
grep -Fq 'test "$(wc -l < "$names"|tr -d '\''[:space:]'\'')" = 11' "$recovery"
grep -Fq 'release-prepare.log > "$expected"' "$recovery"
grep -Fq 'artifact_parent_task="$(jq -er' "$recovery"
grep -Fq 'test -z "$PARENT_TASK_ARN" || test "$PARENT_TASK_ARN" = "$artifact_parent_task"' "$recovery"

# The 360-minute job ceiling adds no happy-path wait. It reserves 40 minutes beyond the modeled
# slow failure path while each credential phase stays below its own fresh 120-minute STS session.
# Production all-target deploys two sequential waves; 75 x 20s bounds each wave at 25 minutes.
job_budget=$((360 * 60))
controller_before_deploy=$((30 * 60))
initial_boundary_close_and_drain=$((85 * 60))
release_prepare=$((35 * 60))
rollout=$((50 * 60))
verification=$((10 * 60))
closed_recovery=$((85 * 60))
finalization=$((10 * 60))
artifact_and_action_overhead=$((15 * 60))
modeled_failure_path=$((controller_before_deploy + initial_boundary_close_and_drain \
  + release_prepare + rollout + verification + closed_recovery + finalization \
  + artifact_and_action_overhead))
test "$modeled_failure_path" = $((320 * 60))
test $((job_budget - modeled_failure_path)) -ge $((40 * 60))
credential_budget=$((120 * 60))
test "$initial_boundary_close_and_drain" -lt "$credential_budget"
test $((release_prepare + rollout + verification)) -lt "$credential_budget"
test "$closed_recovery" -lt "$credential_budget"
test "$finalization" -lt "$credential_budget"

test "$(grep -Ec 'uses: [^[:space:]]+@[0-9a-f]{40}([[:space:]]|$)' "$workflow")" = \
  "$(grep -Ec '^[[:space:]]+(- )?uses:' "$workflow")"
ruby -e 'require "yaml"; ARGV.each { |path| YAML.load(File.read(path)) }' "$workflow" "$recovery"
bash -n "$runner" "$deploy" "$maintenance"
echo 'Production deploy workflow V2 contract: PASS'
