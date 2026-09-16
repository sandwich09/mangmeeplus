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
assert_rejected deploy-invalid-exact-greeting-boolean \
  'LINE_AI_EXACT_GREETING_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_AI_EXACT_GREETING_ENABLED=yes bash "$deploy" all
assert_rejected deploy-invalid-loading-on-accept-boolean \
  'LINE_AI_LOADING_ON_ACCEPT_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_AI_LOADING_ON_ACCEPT_ENABLED=yes bash "$deploy" all
assert_rejected deploy-invalid-debounce-experiment-boolean \
  'LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED=yes bash "$deploy" all
assert_rejected deploy-production-debounce-experiment-not-activated \
  'LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED=true is not activated for production yet' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED=true bash "$deploy" all
assert_rejected deploy-invalid-external-signup-boolean \
  'EXTERNAL_SIGNUP_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat EXTERNAL_SIGNUP_ENABLED=yes bash "$deploy" all
# Owner 2026-09-06 activates signup and quota together; malformed values must still fail.
assert_rejected deploy-invalid-line-signup-boolean \
  'LINE_SIGNUP_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_ENABLED=yes bash "$deploy" all
assert_rejected deploy-invalid-receipt-quota-boolean \
  'RECEIPT_QUOTA_ENFORCED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat RECEIPT_QUOTA_ENFORCED=yes bash "$deploy" all
assert_rejected deploy-invalid-line-signup-approval-mode \
  'LINE_SIGNUP_APPROVAL_MODE must be exactly MANUAL or AUTO_FREE' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_APPROVAL_MODE=auto bash "$deploy" all
# Owner 2026-09-06 selected AUTO_FREE in both environments; MANUAL remains an override.
grep -Fq 'LINE_SIGNUP_APPROVAL_MODE_INPUT="${LINE_SIGNUP_APPROVAL_MODE:-}"' "$deploy"
grep -Fq 'LINE_SIGNUP_APPROVAL_MODE_INPUT=AUTO_FREE' "$deploy"
assert_rejected deploy-invalid-line-signup-daily-cap \
  'LINE_SIGNUP_AUTO_DAILY_CAP must be a non-negative integer' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_AUTO_DAILY_CAP=twenty bash "$deploy" all
assert_rejected deploy-invalid-line-signup-business-hours \
  'LINE_SIGNUP_BUSINESS_HOURS must look like 09:00-18:00' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_BUSINESS_HOURS=9-6 bash "$deploy" all
# A2-01: every shape below passed the first (looser) validators and would have crash-looped the api
# task on `apiConfigSchema` instead. These are the exact zod rules, so the deploy stops here.
assert_rejected deploy-line-signup-business-days-not-a-weekday \
  'LINE_SIGNUP_BUSINESS_DAYS must look like MON-SAT' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_BUSINESS_DAYS=MON-GARBAGE bash "$deploy" all
assert_rejected deploy-line-signup-business-days-single-day \
  'LINE_SIGNUP_BUSINESS_DAYS must look like MON-SAT' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_BUSINESS_DAYS=MON bash "$deploy" all
assert_rejected deploy-line-signup-business-hours-impossible-clock \
  'LINE_SIGNUP_BUSINESS_HOURS must look like 09:00-18:00' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_BUSINESS_HOURS=29:59-29:59 bash "$deploy" all
assert_rejected deploy-line-signup-business-hours-hour-24 \
  'LINE_SIGNUP_BUSINESS_HOURS must look like 09:00-18:00' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_BUSINESS_HOURS=24:00-18:00 bash "$deploy" all
# zod says positive(), so 0 is not a legal warm-up ceiling, budget or reminder delay. A zero
# warm-up would refuse a trial shop's very first receipt.
assert_rejected deploy-line-signup-warmup-slips-zero \
  'LINE_SIGNUP_WARMUP_SLIPS must be a positive integer' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_WARMUP_SLIPS=0 bash "$deploy" all
assert_rejected deploy-line-free-ai-budget-zero \
  'LINE_FREE_AI_BUDGET_SATANG must be a positive integer' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_FREE_AI_BUDGET_SATANG=0 bash "$deploy" all
assert_rejected deploy-line-signup-admin-reminder-zero \
  'LINE_SIGNUP_ADMIN_REMINDER_MINUTES must be a positive integer' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_ADMIN_REMINDER_MINUTES=0 bash "$deploy" all
# L-C §15.6: an alert threshold of 0 would fire on a day nothing happened, so zod says positive().
assert_rejected deploy-line-signup-alert-threshold-zero \
  'LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY must be a positive integer' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY=0 bash "$deploy" all
assert_rejected deploy-line-signup-alert-threshold-not-a-number \
  'LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY must be a positive integer' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY=five bash "$deploy" all
assert_rejected deploy-line-signup-warmup-slips-not-a-number \
  'LINE_SIGNUP_WARMUP_SLIPS must be a positive integer' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_SIGNUP_WARMUP_SLIPS=ten bash "$deploy" all
# 0 IS legal for the daily cap (`nonnegative()`): it means "queue every application".
grep -Fq 'LINE_SIGNUP_AUTO_DAILY_CAP must be a non-negative integer' "$deploy" \
  || { echo 'FAIL: LINE_SIGNUP_AUTO_DAILY_CAP lost its validator'; exit 1; }
# Every P10-L switch reaches the api task definition, or UAT silently runs the shipped defaults
# (shadow mode for the ceiling) and proves nothing.
for p10l_var in LINE_SIGNUP_ENABLED LINE_SIGNUP_APPROVAL_MODE LINE_SIGNUP_AUTO_DAILY_CAP \
  LINE_SIGNUP_WARMUP_SLIPS LINE_FREE_AI_BUDGET_SATANG LINE_SIGNUP_ADMIN_REMINDER_MINUTES \
  LINE_SIGNUP_BUSINESS_DAYS LINE_SIGNUP_BUSINESS_HOURS RECEIPT_QUOTA_ENFORCED \
  LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY; do
  grep -Fq "{name:\"${p10l_var}\", value:\$" "$deploy" \
    || { echo "FAIL: ${p10l_var} is never written to the task definition"; exit 1; }
done
# L-A reads the handoff base from WEB_BASE_URL only, so the api container must carry it.
grep -Fq '{name:"WEB_BASE_URL", value:$publicWebUrl}' "$deploy" \
  || { echo 'FAIL: WEB_BASE_URL is not exported to the api task definition'; exit 1; }
assert_rejected deploy-invalid-email-provider \
  'EMAIL_PROVIDER must be exactly disabled, ses or postmark for cloud deploys' \
  env -i PATH="$PATH" DEPLOY_ENV=uat EMAIL_PROVIDER=local-console bash "$deploy" all
assert_rejected deploy-production-ses-not-activated \
  'EMAIL_PROVIDER=ses is not activated for production yet' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    EMAIL_PROVIDER=ses bash "$deploy" all
# Execute the real config/validation prefix without ever reaching AWS. This proves the release
# defaults and explicit rollback values, including the deliberately deferred Production email lane.
awk '/^RESOURCE_PREFIX=/{exit} {print}' "$deploy" > "$tmp_dir/config.sh"
cat >> "$tmp_dir/config.sh" <<'EOF'
printf '%s\n' "$LINE_SIGNUP_ENABLED_INPUT|$EXTERNAL_SIGNUP_ENABLED_INPUT|$LINE_SIGNUP_APPROVAL_MODE_INPUT|$RECEIPT_QUOTA_ENFORCED_INPUT|$LINE_AI_DRAFT_EDIT_ENABLED_INPUT|$EMAIL_PROVIDER_INPUT"
EOF
for stage in uat production; do
  expected_email=postmark
  actual="$(env -i PATH="$PATH" DEPLOY_ENV="$stage" PRODUCTION_SERVING_MODE=live bash "$tmp_dir/config.sh")"
  test "$actual" = "true|true|AUTO_FREE|true|true|$expected_email"
  actual="$(env -i PATH="$PATH" DEPLOY_ENV="$stage" PRODUCTION_SERVING_MODE=live \
    LINE_SIGNUP_ENABLED=true EXTERNAL_SIGNUP_ENABLED=true LINE_SIGNUP_APPROVAL_MODE=AUTO_FREE \
    RECEIPT_QUOTA_ENFORCED=true LINE_AI_DRAFT_EDIT_ENABLED=true bash "$tmp_dir/config.sh")"
  test "$actual" = "true|true|AUTO_FREE|true|true|$expected_email"
  actual="$(env -i PATH="$PATH" DEPLOY_ENV="$stage" PRODUCTION_SERVING_MODE=live \
    LINE_SIGNUP_ENABLED=false EXTERNAL_SIGNUP_ENABLED=false LINE_SIGNUP_APPROVAL_MODE=MANUAL \
    RECEIPT_QUOTA_ENFORCED=false LINE_AI_DRAFT_EDIT_ENABLED=false EMAIL_PROVIDER=disabled bash "$tmp_dir/config.sh")"
  test "$actual" = 'false|false|MANUAL|false|false|disabled'
done
assert_rejected deploy-invalid-draft-edit-boolean \
  'LINE_AI_DRAFT_EDIT_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=live \
    LINE_AI_DRAFT_EDIT_ENABLED=yes bash "$deploy" all
assert_rejected deploy-invalid-line-web-login-boolean \
  'LINE_WEB_LOGIN_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_WEB_LOGIN_ENABLED=yes bash "$deploy" all
# P12 activation gate passed 2026-08-30 (Owner console evidence): production no longer rejects
# LINE_WEB_LOGIN_ENABLED=true, and the default is ON in both environments — the contract greps
# below prove the fail-closed block is gone and the default has no environment branch.
grep -Fq 'LINE_WEB_LOGIN_ENABLED_INPUT=true' "$deploy"
if grep -Fq 'LINE_WEB_LOGIN_ENABLED=true is not activated' "$deploy"; then
  echo "FAIL: production still fails closed on LINE_WEB_LOGIN_ENABLED=true" >&2; exit 1
fi
# Owner parity decision 2026-08-30: production runs the same conversational and speed lanes as
# UAT. The contract greps prove every aligned flag defaults ON with no environment branch and no
# production fail-closed block; only the debounce EXPERIMENT keeps its production rejection above.
for aligned in LINE_WEB_HANDOFF_ENABLED LINE_AI_EXACT_GREETING_ENABLED \
    LINE_AI_LOADING_ON_ACCEPT_ENABLED LINE_AI_FUSED_PLAN_SHADOW_ENABLED \
    LINE_AI_PREPARED_SIMPLE_READ_ENABLED; do
  grep -Fq "${aligned}_INPUT=true" "$deploy"
  if grep -Fq "${aligned}=true is not activated" "$deploy"; then
    echo "FAIL: production still fails closed on ${aligned}=true" >&2; exit 1
  fi
done
grep -Fq 'LINE_AI_ADVISOR_MODE_INPUT=social' "$deploy"
if grep -Fq 'LINE_AI_ADVISOR_MODE=$LINE_AI_ADVISOR_MODE_INPUT is not activated' "$deploy"; then
  echo "FAIL: production still fails closed on advisor mode" >&2; exit 1
fi
grep -Fq 'LINE_AI_BUFFER_DEBOUNCE_MS_INPUT=1000' "$deploy"
grep -Fq 'sales.get_sales_summary::single_metric' "$deploy"
if grep -Fq 'LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES is not activated' "$deploy"; then
  echo "FAIL: production still fails closed on deterministic families" >&2; exit 1
fi
assert_rejected deploy-invalid-line-web-handoff-boolean \
  'LINE_WEB_HANDOFF_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_WEB_HANDOFF_ENABLED=yes bash "$deploy" all
assert_rejected deploy-invalid-fused-shadow-boolean \
  'LINE_AI_FUSED_PLAN_SHADOW_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_AI_FUSED_PLAN_SHADOW_ENABLED=yes bash "$deploy" all
assert_rejected deploy-invalid-prepared-simple-read-boolean \
  'LINE_AI_PREPARED_SIMPLE_READ_ENABLED must be exactly true or false' \
  env -i PATH="$PATH" DEPLOY_ENV=uat LINE_AI_PREPARED_SIMPLE_READ_ENABLED=yes bash "$deploy" all
assert_rejected deploy-invalid-deterministic-families-charset \
  'LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES must be a comma-separated allowlist of' \
  env -i PATH="$PATH" DEPLOY_ENV=uat \
    LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES='sales.get_sales_summary::single_metric bad' bash "$deploy" all
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
assert_rejected deploy-fast-maintenance-reaches-release-fence \
  'service rollout requires RELEASE_PARENT_OPERATION_ID' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
    RELEASE_MODE=fast-promotion PRODUCTION_IMAGE_MANIFEST=manifest.json \
    SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa REIMBURSEMENT_WRITE_QUIESCE=true \
    bash "$deploy" all
assert_rejected deploy-fast-maintenance-must-be-global \
  'maintenance_only requires an immutable quiesced all-target' \
  env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
    RELEASE_MODE=fast-promotion PRODUCTION_IMAGE_MANIFEST=manifest.json \
    SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa REIMBURSEMENT_WRITE_QUIESCE=true \
    bash "$deploy" api-web
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
grep -Fq 'if [[ "$log_group" == *"-api-web" ]]; then' "$deploy"
grep -Fq -- '--filter-name line-ai-accepted' "$deploy"
grep -Fq 'for terminal_class in delivered clarification intentional_noop permission_refusal feature_disabled' "$deploy"
grep -Fq 'provider_unavailable timeout delivery_pending failed_terminal' "$deploy"
grep -Fq 'metricNamespace=WatchDog/LineAI' "$deploy"
grep -Fq -- '--arg crmAutoReplyEnabled "$SERVING_CRM_AUTO_REPLY_ENABLED"' "$deploy"
grep -Fq '{name:"AI_GATEWAY_ENABLED", value:$aiEnabled}' "$deploy"
grep -Fq '[ "$agentcore_expected_source" = "$COMMIT" ]' "$deploy"
grep -Fq 'candidate_${DEPLOY_ENV}_${agentcore_expected_source:0:12}_${agentcore_expected_artifact:0:8}' "$deploy"
grep -Fq 'candidate_${deploy_env}_${agentcore_expected_source:0:12}_${agentcore_expected_artifact:0:8}' "$verify"
if grep -Fq '[ "$agentcore_expected_source" = "$SHA" ]' "$deploy"; then
  echo 'AgentCore full source is still compared with the 12-character deployment label' >&2
  exit 1
fi
grep -Fq '{name:"LINE_AI_LEDGER_ENABLED", value:$aiEnabled}' "$deploy"
# P12-1 web LINE login: UAT defaults on, production defaults off and rejects true, and the
# api-web container is the only consumer of the flag.
grep -Fq 'LINE_WEB_LOGIN_ENABLED_INPUT="${LINE_WEB_LOGIN_ENABLED:-}"' "$deploy"
grep -Fq -- '--arg lineWebLoginEnabled "$SERVING_LINE_WEB_LOGIN_ENABLED"' "$deploy"
test "$(grep -Fc '{name:"LINE_WEB_LOGIN_ENABLED", value:$lineWebLoginEnabled}' "$deploy")" -eq 1
# P12-3b deep-link handoff: same contract — UAT on (post-Q2), production off and rejects true,
# api-web container is the only consumer.
grep -Fq 'LINE_WEB_HANDOFF_ENABLED_INPUT="${LINE_WEB_HANDOFF_ENABLED:-}"' "$deploy"
grep -Fq -- '--arg lineWebHandoffEnabled "$SERVING_LINE_WEB_HANDOFF_ENABLED"' "$deploy"
test "$(grep -Fc '{name:"LINE_WEB_HANDOFF_ENABLED", value:$lineWebHandoffEnabled}' "$deploy")" -eq 1
# Exact-greeting 0-call lane: UAT defaults on, production defaults off and rejects true, and the
# api-web container is the only consumer of the flag.
grep -Fq 'LINE_AI_EXACT_GREETING_ENABLED_INPUT="${LINE_AI_EXACT_GREETING_ENABLED:-}"' "$deploy"
grep -Fq -- '--arg lineAiExactGreetingEnabled "$SERVING_LINE_AI_EXACT_GREETING_ENABLED"' "$deploy"
test "$(grep -Fc '{name:"LINE_AI_EXACT_GREETING_ENABLED", value:$lineAiExactGreetingEnabled}' "$deploy")" -eq 1
# S-4 draft edit (draft-control spec §8): both environments default on, the value is
# validated as an exact boolean, maintenance quiesces it, and BOTH containers carry it — the API is
# the authoritative executor and the gateway decides whether the tools are offered at all.
grep -Fq 'LINE_AI_DRAFT_EDIT_ENABLED_INPUT="${LINE_AI_DRAFT_EDIT_ENABLED:-}"' "$deploy"
grep -Fq 'LINE_AI_DRAFT_EDIT_ENABLED_INPUT=true' "$deploy"
grep -Fq 'ERROR: LINE_AI_DRAFT_EDIT_ENABLED must be exactly true or false' "$deploy"
grep -Fq 'SERVING_LINE_AI_DRAFT_EDIT_ENABLED=false' "$deploy"
test "$(grep -Fc -- '--arg lineAiDraftEditEnabled "$SERVING_LINE_AI_DRAFT_EDIT_ENABLED"' "$deploy")" -eq 2
test "$(grep -Fc '{name:"LINE_AI_DRAFT_EDIT_ENABLED", value:$lineAiDraftEditEnabled}' "$deploy")" -eq 2
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
grep -Fq '[ "$agentcore_expected_source" = "$commit" ]' "$verify"
manifest_line="$(grep -n -m1 'commit="$(bash infra/docker/validate-production-manifest.sh' "$verify" | cut -d: -f1)"
agentcore_source_line="$(grep -n -m1 '\[ "$agentcore_expected_source" = "$commit" \]' "$verify" | cut -d: -f1)"
test "$manifest_line" -lt "$agentcore_source_line"
grep -Fq 'curl_bin="${CURL_BIN:-curl}"' "$verify"
grep -Fq 'curl_retry=(--retry 2 --retry-delay 2 --retry-max-time 70 --retry-all-errors)' "$verify"
test "$(grep -Fc '"${curl_retry[@]}"' "$verify")" -eq 2
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
agentcore_runtime_arn=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator_production_candidate-ABCDEFGHIJ
agentcore_runtime_qualifier=candidate_production_aaaaaaaaaaaa_bbbbbbbb
agentcore_expected_source=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
agentcore_expected_artifact=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
agentcore_expected_contract=1

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
  LINE_AI_AGENT_RUNTIME:"agentcore",
  AGENTCORE_RUNTIME_ARN:"arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator_production_candidate-ABCDEFGHIJ",
  AGENTCORE_RUNTIME_QUALIFIER:"candidate_production_aaaaaaaaaaaa_bbbbbbbb",
  AGENTCORE_EXPECTED_SOURCE_COMMIT:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  AGENTCORE_EXPECTED_ARTIFACT_SHA256:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  AGENTCORE_EXPECTED_CONTRACT_VERSION:"1",
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
bad_ai_state="$(jq '.environment |= map(if .name == "AGENTCORE_RUNTIME_QUALIFIER" then .value = "candidate_production_aaaaaaaaaaaa_ffffffff" else . end)' <<< "$ai_state")"
if verify_service_environment ai-gateway "$bad_ai_state" 2>/dev/null; then
  echo 'AI verifier accepted a task bound to a different AgentCore endpoint' >&2
  exit 1
fi
bad_ai_artifact_state="$(jq '.environment |= map(if .name == "AGENTCORE_EXPECTED_ARTIFACT_SHA256" then .value = ("f" * 64) else . end)' <<< "$ai_state")"
if verify_service_environment ai-gateway "$bad_ai_artifact_state" 2>/dev/null; then
  echo 'AI verifier accepted a task expecting a different AgentCore artifact' >&2
  exit 1
fi

# Execute the actual input and serving blocks without AWS: both receipt lanes default on,
# explicit rollback stays off, and maintenance cannot resume conversations or replay outcomes.
awk '/^RESOURCE_PREFIX=/{exit} {print}' "$deploy" > "$tmp_dir/receipt-config.sh"
awk '/^SERVING_CRM_AUTO_REPLY_ENABLED=/{copy=1} copy && /^if \[ "\$DEPLOY_ENV" = production \]/{exit} copy {print}' "$deploy" >> "$tmp_dir/receipt-config.sh"
cat >> "$tmp_dir/receipt-config.sh" <<'EOF'
printf '%s\n' "$SERVING_LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED|$SERVING_LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED|$SERVING_EMAIL_PROVIDER"
EOF
for stage in uat production; do
  expected_email=postmark
  actual="$(env -i PATH="$PATH" DEPLOY_ENV="$stage" PRODUCTION_SERVING_MODE=live bash "$tmp_dir/receipt-config.sh")"
  test "$actual" = "true|true|$expected_email"
  actual="$(env -i PATH="$PATH" DEPLOY_ENV="$stage" PRODUCTION_SERVING_MODE=live \
    LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=false LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=false \
    bash "$tmp_dir/receipt-config.sh")"
  test "$actual" = "false|false|$expected_email"
  for receipt_flag in LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED LINE_AI_FLEX_TEXT_FALLBACK_ENABLED; do
    assert_rejected "invalid-$stage-$receipt_flag" "$receipt_flag must be exactly true or false" \
      env -i PATH="$PATH" DEPLOY_ENV="$stage" PRODUCTION_SERVING_MODE=live "$receipt_flag=yes" bash "$deploy" all
    test "$(grep -Fc "{name:\"$receipt_flag\", value:\$" "$deploy")" -eq 1
    for workflow in deploy-uat.yml deploy-production-v2.yml; do
      grep -Fq "$receipt_flag: \${{ vars.$receipt_flag || 'true' }}" "$repo_root/.github/workflows/$workflow"
    done
  done
done
actual="$(env -i PATH="$PATH" DEPLOY_ENV=production PRODUCTION_SERVING_MODE=maintenance_only \
  RELEASE_MODE=maintenance-bootstrap MAINTENANCE_BOOTSTRAP_READONLY=true \
  PRODUCTION_IMAGE_MANIFEST=manifest.json SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  REIMBURSEMENT_WRITE_QUIESCE=true LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true \
  LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true bash "$tmp_dir/receipt-config.sh" all)"
test "$actual" = 'false|false|disabled'
grep -Fq -- '--arg lineExpenseDraftConversationEnabled "$SERVING_LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED"' "$deploy"
grep -Fq -- '--arg lineAiTerminalOutcomeReplayEnabled "$SERVING_LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED"' "$deploy"

echo 'production serving-mode deploy contract: PASS'
