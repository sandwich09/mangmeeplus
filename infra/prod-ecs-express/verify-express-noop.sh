#!/usr/bin/env bash
# Prove that an ECS Express update was a true no-op. The returned target must have been the sole
# active revision before the request and remain so across two reads; currentDeployment and the full
# deployment-ARN set must remain byte-for-byte stable. Any late/new rollout is UNKNOWN.
set -euo pipefail

if [ "$#" -ne 8 ] || [ "$1" != "--service-arn" ] || [ "$3" != "--target-revision" ] \
  || [ "$5" != "--before-deployments" ] || [ "$7" != "--before-service" ]; then
  echo "Usage: $0 --service-arn <arn> --target-revision <arn> --before-deployments <json> --before-service <json>" >&2
  exit 2
fi
service_arn="$2"
target_revision="$4"
before_deployments_file="$6"
before_service_file="$8"
aws_bin="${AWS_BIN:-aws}"
region="${AWS_REGION:-ap-southeast-1}"
stability_seconds="${NOOP_STABILITY_SECONDS:-2}"

[[ "$service_arn" =~ ^arn:aws:ecs:${region}:[0-9]{12}:service/[^/]+/[^/]+$ ]]
[[ "$target_revision" =~ ^arn:aws:ecs:${region}:[0-9]{12}:service-revision/[^/]+/[^/]+/[^/]+$ ]]
[[ "$stability_seconds" =~ ^[0-9]+$ ]]

normalize_deployments() { jq -cer 'if type == "array" and all(.[]; type == "string") then sort | unique else error("invalid deployment ARN set") end'; }
normalize_service() {
  jq -cer '
    if .currentDeployment != null
      and ((.currentDeployment | type) != "string" or (.currentDeployment | startswith("arn:") | not)) then
      error("currentDeployment has an invalid shape")
    elif (.activeRevisions | type) != "array" then error("active revision set is missing")
    else {currentDeployment:(.currentDeployment // null), activeRevisions:(.activeRevisions | sort | unique)} end
  '
}

before_deployments="$(normalize_deployments < "$before_deployments_file")"
before_service="$(normalize_service < "$before_service_file")"
if ! jq -e --arg target "$target_revision" '.activeRevisions == [$target]' <<< "$before_service" >/dev/null; then
  echo "ERROR: target revision was not the sole stable active revision before the request; no-op is unproven" >&2
  exit 75
fi

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

read_snapshot() {
  local deployment_response deployments service
  deployment_response="$(AWS_BIN="$aws_bin" AWS_REGION="$region" \
    bash "$(dirname "$0")/list-service-deployments-all.sh" --service-arn "$service_arn")"
  if ! jq -e '.nextToken == null' <<< "$deployment_response" >/dev/null; then
    echo "ERROR: deployment history is paginated; no-op comparison is not exhaustive" >&2
    return 75
  fi
  deployments="$(jq -c '.serviceDeployments | map(.serviceDeploymentArn)' \
    <<< "$deployment_response" | normalize_deployments)"
  service="$(aws_cmd ecs describe-express-gateway-service --service-arn "$service_arn" \
    --query 'service.{currentDeployment:currentDeployment,activeRevisions:activeConfigurations[].serviceRevisionArn}' \
    --output json --region "$region" | normalize_service)"
  jq -cn --argjson deployments "$deployments" --argjson service "$service" \
    '{deployments:$deployments,service:$service}'
}

first="$(read_snapshot)"
sleep "$stability_seconds"
second="$(read_snapshot)"
if [ "$first" != "$second" ]; then
  echo "ERROR: ECS Express state moved between no-op verification reads; state is UNKNOWN" >&2
  exit 75
fi
if ! jq -e --argjson beforeDeployments "$before_deployments" --argjson beforeService "$before_service" \
  --arg target "$target_revision" '
    .deployments == $beforeDeployments
    and .service == $beforeService
    and .service.activeRevisions == [$target]
  ' <<< "$second" >/dev/null; then
  echo "ERROR: a deployment/current revision changed after the update; no-op is unproven" >&2
  exit 75
fi

jq -c '.service' <<< "$second"
