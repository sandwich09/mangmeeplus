#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy="$repo_root/infra/prod-ecs-express/deploy.sh"
verify="$repo_root/infra/prod-ecs-express/verify-deployment.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-serving-mode.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

bash -n "$deploy"
bash -n "$verify"

assert_rejected() {
  local name="$1" expected="$2"
  shift 2
  if "$@" >"$tmp_dir/$name.log" 2>&1; then
    echo "expected $name to fail" >&2
    exit 1
  fi
  grep -Fq "$expected" "$tmp_dir/$name.log"
}

assert_rejected deploy-missing-mode \
  'PRODUCTION_SERVING_MODE is required in production' \
  env -i PATH="$PATH" DEPLOY_ENV=production bash "$deploy" all
assert_rejected deploy-invalid-mode \
  'PRODUCTION_SERVING_MODE must be exactly maintenance_only or live' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=closed bash "$deploy" all
assert_rejected deploy-invalid-maintenance-intent \
  'maintenance_only requires an immutable quiesced all-target bootstrap' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
    RELEASE_MODE=partial-incident PRODUCTION_IMAGE_MANIFEST=manifest.json \
    SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa REIMBURSEMENT_WRITE_QUIESCE=true \
    bash "$deploy" all
assert_rejected deploy-invalid-bootstrap-boolean \
  'MAINTENANCE_BOOTSTRAP_READONLY must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    MAINTENANCE_BOOTSTRAP_READONLY=yes bash "$deploy" all
assert_rejected deploy-bootstrap-flag-missing \
  'maintenance_only requires an immutable quiesced all-target bootstrap' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
    RELEASE_MODE=maintenance-bootstrap PRODUCTION_IMAGE_MANIFEST=manifest.json \
    SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa REIMBURSEMENT_WRITE_QUIESCE=true \
    bash "$deploy" all
assert_rejected deploy-bootstrap-wrong-target \
  'maintenance_only requires an immutable quiesced all-target bootstrap' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
    RELEASE_MODE=maintenance-bootstrap MAINTENANCE_BOOTSTRAP_READONLY=true \
    PRODUCTION_IMAGE_MANIFEST=manifest.json SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    REIMBURSEMENT_WRITE_QUIESCE=true bash "$deploy" api-web
assert_rejected deploy-bootstrap-wrong-release-mode \
  'maintenance_only requires an immutable quiesced all-target bootstrap' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
    RELEASE_MODE=promotion MAINTENANCE_BOOTSTRAP_READONLY=true \
    PRODUCTION_IMAGE_MANIFEST=manifest.json SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    REIMBURSEMENT_WRITE_QUIESCE=true bash "$deploy" all
assert_rejected deploy-bootstrap-live \
  'maintenance bootstrap requires production target=all' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    RELEASE_MODE=maintenance-bootstrap MAINTENANCE_BOOTSTRAP_READONLY=true \
    PRODUCTION_IMAGE_MANIFEST=manifest.json SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    REIMBURSEMENT_WRITE_QUIESCE=true bash "$deploy" all
assert_rejected deploy-bootstrap-mode-without-authority \
  'maintenance bootstrap requires production target=all' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    RELEASE_MODE=maintenance-bootstrap PRODUCTION_IMAGE_MANIFEST=manifest.json \
    SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa REIMBURSEMENT_WRITE_QUIESCE=true \
    bash "$deploy" all
assert_rejected deploy-bootstrap-reaches-evidence-gate \
  'no-database rollout requires DEPLOYMENT_EVIDENCE_DIR' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
    RELEASE_MODE=maintenance-bootstrap MAINTENANCE_BOOTSTRAP_READONLY=true \
    PRODUCTION_IMAGE_MANIFEST=manifest.json SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    REIMBURSEMENT_WRITE_QUIESCE=true bash "$deploy" all
assert_rejected verify-missing-mode \
  'PRODUCTION_SERVING_MODE is required in production' \
  env -i PATH="$PATH" DEPLOY_ENV=production bash "$verify" manifest.json all
assert_rejected verify-live-disabled-provider \
  'production live AI verification requires explicit MODEL_PROVIDER=bedrock or openai' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    MODEL_PROVIDER=disabled APPROVED_AI_PROVIDERS=bedrock bash "$verify" manifest.json all
assert_rejected verify-live-unapproved-provider \
  'production live MODEL_PROVIDER must appear in APPROVED_AI_PROVIDERS' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    MODEL_PROVIDER=bedrock APPROVED_AI_PROVIDERS=openai bash "$verify" manifest.json all

test "$(grep -Fc '{name:"PRODUCTION_SERVING_MODE", value:$productionServingMode}' "$deploy")" -eq 3
test "$(grep -Fc '{name:"GLOBAL_MAINTENANCE_MODE", value:$globalMaintenanceMode}' "$deploy")" -eq 1
grep -Fq '[ "$RELEASE_MODE_INPUT" = maintenance-bootstrap ]' "$deploy"
grep -Fq '[ "$RELEASE_MODE_INPUT" = promotion ]' "$deploy"
grep -Fq 'MAINTENANCE_BOOTSTRAP_READONLY_PROVED_SHA' "$deploy"
grep -Fq 'maintenance-bootstrap-no-database-intent' "$deploy"
grep -Fq 'no-database rollout cannot create a service' "$deploy"
grep -Fq '[ "$DEPLOY_ENV" = production ] && [ "$PRODUCTION_SERVING_MODE_INPUT" = maintenance_only ]' "$deploy"
grep -Fq 'SERVING_MODEL_PROVIDER=disabled' "$deploy"
grep -Fq 'production live AI rollout requires explicit MODEL_PROVIDER=bedrock or openai' "$deploy"
grep -Fq 'production live MODEL_PROVIDER must appear in APPROVED_AI_PROVIDERS' "$deploy"
grep -Fq -- '--arg crmAutoReplyEnabled "$SERVING_CRM_AUTO_REPLY_ENABLED"' "$deploy"
grep -Fq '{name:"AI_GATEWAY_ENABLED", value:$aiEnabled}' "$deploy"
grep -Fq '{name:"LINE_AI_LEDGER_ENABLED", value:$aiEnabled}' "$deploy"
grep -Fq -- '--arg modelProvider "$SERVING_MODEL_PROVIDER"' "$deploy"
for flag in \
  LINE_AI_AGENT_ORCHESTRATION_ENABLED \
  LINE_AI_TOOLUSE_LOOP_ENABLED \
  LINE_AI_COVERAGE_CRITIC_ENABLED \
  AI_AGENT_REGISTRY_ENABLED \
  AI_TOOL_POLICY_ENFORCED \
  AI_TOOL_AUDIT_ENABLED; do
  grep -Fq "{name:\"$flag\", value:\$aiEnabled}" "$deploy"
done
grep -Fq '{name:"QUEUE_ENABLED", value:$queueEnabled}' "$deploy"
grep -Fq '.activeCount == 1' "$verify"
ai_wave_line="$(grep -n -m1 'run_rollout_wave ai-gateway workers' "$deploy" | cut -d: -f1)"
api_wave_line="$(grep -n -m1 'run_rollout_wave api-web$' "$deploy" | cut -d: -f1)"
test "$ai_wave_line" -lt "$api_wave_line"

# Exercise the verifier's real jq contract without AWS: one exact value per required key passes,
# while a worker that still consumes queues in maintenance is rejected.
eval "$(sed -n '/^verify_service_environment()/,/^}/p' "$verify")"
serving_mode=maintenance_only
serving_ai_enabled=false
serving_crm_auto_reply=false
serving_model_provider=disabled
serving_approved_ai_providers=''
serving_queue_enabled=false
serving_maintenance_active=true

api_state="$(jq -cn '{environment:({
  PRODUCTION_SERVING_MODE:"maintenance_only",
  GLOBAL_MAINTENANCE_MODE:"true",
  CRM_AUTO_REPLY_ENABLED:"false",
  LINE_AI_LEDGER_ENABLED:"false",
  AI_GATEWAY_ENABLED:"false"
}|to_entries|map({name:.key,value:.value}))}')"
ai_state="$(jq -cn '{environment:({
  PRODUCTION_SERVING_MODE:"maintenance_only",
  MODEL_PROVIDER:"disabled",
  LINE_AI_AGENT_ORCHESTRATION_ENABLED:"false",
  LINE_AI_TOOLUSE_LOOP_ENABLED:"false",
  LINE_AI_COVERAGE_CRITIC_ENABLED:"false",
  AI_GATEWAY_ENABLED:"false",
  AI_AGENT_REGISTRY_ENABLED:"false",
  AI_TOOL_POLICY_ENFORCED:"false",
  AI_TOOL_AUDIT_ENABLED:"false",
  AI_FINAL_MUTATION_ENABLED:"false",
  AI_PROMPT_LOGGING_ENABLED:"false"
}|to_entries|map({name:.key,value:.value}))}')"
workers_state="$(jq -cn '{environment:({
  PRODUCTION_SERVING_MODE:"maintenance_only",
  QUEUE_ENABLED:"false"
}|to_entries|map({name:.key,value:.value}))}')"

verify_service_environment api-web "$api_state"
verify_service_environment ai-gateway "$ai_state"
verify_service_environment workers "$workers_state"
bad_workers_state="$(jq '.environment |= map(if .name == "QUEUE_ENABLED" then .value = "true" else . end)' <<< "$workers_state")"
if verify_service_environment workers "$bad_workers_state" 2>/dev/null; then
  echo 'maintenance verifier accepted QUEUE_ENABLED=true' >&2
  exit 1
fi

echo 'production serving-mode deploy contract: PASS'
