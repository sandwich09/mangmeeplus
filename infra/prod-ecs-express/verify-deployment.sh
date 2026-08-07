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

verify_service() {
  local service="$1" repository="$2" arn_parameter="$3" url_parameter="$4" health_path="$5"
  local expected_image arn state url health
  expected_image="$(jq -er --arg service "$service" --arg repository "$repository" \
    '.images[] | select(.service == $service and .repository == $repository) | .image' "$manifest")"
  arn="$(aws_cmd ssm get-parameter --name "$arn_parameter" --query Parameter.Value --output text --region "$region")"
  state="$(aws_cmd ecs describe-express-gateway-service --service-arn "$arn" --region "$region" \
    --query '{status:service.status.statusCode,image:service.activeConfigurations[0].primaryContainer.image,gitSha:service.activeConfigurations[0].primaryContainer.environment[?name==`GIT_SHA`]|[0].value}' --output json)"
  jq -e --arg image "$expected_image" --arg sha "$commit" \
    '.status == "ACTIVE" and .image == $image and .gitSha == $sha' <<< "$state" >/dev/null
  url="$(aws_cmd ssm get-parameter --name "$url_parameter" --query Parameter.Value --output text --region "$region")"
  health="$(curl --fail --silent --show-error --max-time 20 "${url%/}${health_path}")"
  jq -e '.status == "ok"' <<< "$health" >/dev/null
  if [ "$service" = "api-web" ]; then
    verify_api_readiness "$url"
  fi
  echo "[verify-deployment] service=$service status=ACTIVE sha=$commit health=ok"
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
