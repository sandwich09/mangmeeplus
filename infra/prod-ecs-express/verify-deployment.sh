#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <production-image-manifest.json> <all|api-web|ai-gateway|workers>" >&2
  exit 2
fi

manifest="$1"
target="$2"
region="${AWS_REGION:-ap-southeast-1}"
deploy_env="${DEPLOY_ENV:-production}"
case "$deploy_env" in
  production|uat) ;;
  *) echo "ERROR: DEPLOY_ENV must be production or uat" >&2; exit 2 ;;
esac
serving_mode="${PRODUCTION_SERVING_MODE:-}"
case "$serving_mode" in
  maintenance_only|live) ;;
  '')
    if [ "$deploy_env" = production ]; then
      echo "ERROR: PRODUCTION_SERVING_MODE is required in production and must be maintenance_only or live" >&2
      exit 2
    fi
    serving_mode=live
    ;;
  *) echo "ERROR: PRODUCTION_SERVING_MODE must be exactly maintenance_only or live" >&2; exit 2 ;;
esac
serving_ai_enabled=true
serving_crm_auto_reply="${CRM_AUTO_REPLY_ENABLED:-false}"
serving_model_provider="${MODEL_PROVIDER:-disabled}"
serving_approved_ai_providers="${APPROVED_AI_PROVIDERS:-}"
serving_queue_enabled=true
serving_maintenance_active=false
if [ "$serving_mode" = maintenance_only ]; then
  serving_ai_enabled=false
  serving_crm_auto_reply=false
  serving_model_provider=disabled
  serving_queue_enabled=false
  serving_maintenance_active=true
fi
if [ "$deploy_env" = production ] && [ "$serving_mode" = live ] \
  && { [ "$target" = all ] || [ "$target" = ai-gateway ]; }; then
  case "$serving_model_provider" in bedrock|openai) ;; *)
    echo "ERROR: production live AI verification requires explicit MODEL_PROVIDER=bedrock or openai" >&2
    exit 2
  esac
  approved_providers=",${serving_approved_ai_providers//[[:space:]]/},"
  case "$approved_providers" in *",${serving_model_provider},"*) ;; *)
    echo "ERROR: production live MODEL_PROVIDER must appear in APPROVED_AI_PROVIDERS" >&2
    exit 2
  esac
fi
param_prefix="/watchdog-bms/${deploy_env}"
aws_bin="${AWS_BIN:-aws}"
account_id="$(env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY "$aws_bin" sts get-caller-identity --query Account --output text --region "$region")"
commit="$(bash infra/docker/validate-production-manifest.sh "$manifest" "$account_id" "$region")"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

# L-13: the public health body no longer carries `.db` — it is liveness only and issues no query.
# Database status moved to the worker-token-guarded readiness route, so assert it there. The check
# needs an operator token; when none is present it is reported as an explicit skip, never dropped.
verify_api_readiness() {
  local url="$1" readiness
  if [ -z "${WORKER_INTERNAL_TOKEN:-}" ]; then
    echo "[verify-deployment] SKIPPED db readiness: WORKER_INTERNAL_TOKEN not set in this environment" >&2
    return 0
  fi
  readiness="$(curl --fail --silent --show-error --max-time 20 \
    -H "X-Worker-Token: ${WORKER_INTERNAL_TOKEN}" "${url%/}/v1/internal/health/readiness")"
  jq -e '.status == "ok" and .db == "ok"' <<< "$readiness" >/dev/null
  echo "[verify-deployment] service=api-web db=ok (internal readiness)"
}

verify_service_environment() {
  local service="$1" state="$2"
  jq -e \
    --arg service "$service" \
    --arg mode "$serving_mode" \
    --arg aiEnabled "$serving_ai_enabled" \
    --arg crmAutoReply "$serving_crm_auto_reply" \
    --arg modelProvider "$serving_model_provider" \
    --arg approvedAiProviders "$serving_approved_ai_providers" \
    --arg queueEnabled "$serving_queue_enabled" \
    --arg maintenanceActive "$serving_maintenance_active" '
      . as $state |
      def value($name):
        [$state.environment[]? | select(.name == $name) | .value]
        | if length == 1 then .[0] else null end;
      value("PRODUCTION_SERVING_MODE") == $mode
      and (
        if $service == "api-web" then
          value("GLOBAL_MAINTENANCE_MODE") == $maintenanceActive
          and value("CRM_AUTO_REPLY_ENABLED") == $crmAutoReply
          and value("LINE_AI_LEDGER_ENABLED") == $aiEnabled
          and value("AI_GATEWAY_ENABLED") == $aiEnabled
        elif $service == "ai-gateway" then
          value("MODEL_PROVIDER") == $modelProvider
          and (if $mode == "live" then value("APPROVED_AI_PROVIDERS") == $approvedAiProviders else true end)
          and all([
            "LINE_AI_AGENT_ORCHESTRATION_ENABLED",
            "LINE_AI_TOOLUSE_LOOP_ENABLED",
            "LINE_AI_COVERAGE_CRITIC_ENABLED",
            "AI_GATEWAY_ENABLED",
            "AI_AGENT_REGISTRY_ENABLED",
            "AI_TOOL_POLICY_ENFORCED",
            "AI_TOOL_AUDIT_ENABLED"
          ][]; value(.) == $aiEnabled)
          and value("AI_FINAL_MUTATION_ENABLED") == "false"
          and value("AI_PROMPT_LOGGING_ENABLED") == "false"
        elif $service == "workers" then
          value("QUEUE_ENABLED") == $queueEnabled
        else false
        end
      )
    ' <<< "$state" >/dev/null || {
      echo "ERROR: active ${service} environment does not match PRODUCTION_SERVING_MODE=${serving_mode}" >&2
      return 1
    }
}

verify_service() {
  local service="$1" repository="$2" arn_parameter="$3" url_parameter="$4" health_path="$5"
  local expected_image arn state url health
  expected_image="$(jq -er --arg service "$service" --arg repository "$repository" \
    '.images[] | select(.service == $service and .repository == $repository) | .image' "$manifest")"
  arn="$(aws_cmd ssm get-parameter --name "$arn_parameter" --query Parameter.Value --output text --region "$region")"
  state="$(aws_cmd ecs describe-express-gateway-service --service-arn "$arn" --region "$region" \
    --query '{status:service.status.statusCode,activeCount:length(service.activeConfigurations),image:service.activeConfigurations[0].primaryContainer.image,gitSha:service.activeConfigurations[0].primaryContainer.environment[?name==`GIT_SHA`]|[0].value,environment:service.activeConfigurations[0].primaryContainer.environment}' --output json)"
  jq -e --arg image "$expected_image" --arg sha "$commit" \
    '.status == "ACTIVE" and .activeCount == 1 and .image == $image and .gitSha == $sha and (.environment | type == "array")' <<< "$state" >/dev/null
  verify_service_environment "$service" "$state"
  url="$(aws_cmd ssm get-parameter --name "$url_parameter" --query Parameter.Value --output text --region "$region")"
  health="$(curl --fail --silent --show-error --max-time 20 "${url%/}${health_path}")"
  jq -e '.status == "ok"' <<< "$health" >/dev/null
  if [ "$service" = "api-web" ]; then
    verify_api_readiness "$url"
  fi
  echo "[verify-deployment] service=$service status=ACTIVE sha=$commit servingMode=$serving_mode health=ok"
}

case "$target" in
  all)
    verify_service api-web watchdog-bms-api "${param_prefix}/ecs-express-api-web-service-arn" "${param_prefix}/ecs-express-api-web-url" /v1/health
    verify_service ai-gateway watchdog-bms-ai-gateway "${param_prefix}/ecs-express-ai-gateway-service-arn" "${param_prefix}/ecs-express-ai-gateway-url" /v1/health
    verify_service workers watchdog-bms-workers "${param_prefix}/ecs-express-workers-service-arn" "${param_prefix}/ecs-express-workers-url" /health
    ;;
  api-web)
    verify_service api-web watchdog-bms-api "${param_prefix}/ecs-express-api-web-service-arn" "${param_prefix}/ecs-express-api-web-url" /v1/health
    ;;
  ai-gateway)
    verify_service ai-gateway watchdog-bms-ai-gateway "${param_prefix}/ecs-express-ai-gateway-service-arn" "${param_prefix}/ecs-express-ai-gateway-url" /v1/health
    ;;
  workers)
    verify_service workers watchdog-bms-workers "${param_prefix}/ecs-express-workers-service-arn" "${param_prefix}/ecs-express-workers-url" /health
    ;;
  *)
    echo "ERROR: unsupported deploy target: $target" >&2
    exit 2
    ;;
esac
