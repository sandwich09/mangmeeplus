#!/usr/bin/env bash
# ECS Express create returns currentDeployment + activeConfigurations (not targetConfiguration).
# Bind those exact returned identities and corroborate them with DescribeServiceDeployments.
set -euo pipefail

if [ "$#" -ne 10 ] || [ "$1" != "--response" ] || [ "$3" != "--cluster" ] \
  || [ "$5" != "--service-name" ] || [ "$7" != "--region" ] || [ "$9" != "--account" ]; then
  echo "Usage: $0 --response <json> --cluster <name> --service-name <name> --region <region> --account <id>" >&2
  exit 2
fi
response="$2"
cluster="$4"
service_name="$6"
region="$8"
account="${10}"
aws_bin="${AWS_BIN:-aws}"
attempts="${BIND_CREATE_POLL_ATTEMPTS:-12}"
poll_seconds="${BIND_CREATE_POLL_SECONDS:-5}"

[[ "$account" =~ ^[0-9]{12}$ ]]
[[ "$region" =~ ^[a-z]{2}-[a-z]+-[0-9]$ ]]
service_prefix="arn:aws:ecs:${region}:${account}:service/${cluster}/${service_name}"
deployment_prefix="arn:aws:ecs:${region}:${account}:service-deployment/${cluster}/${service_name}/"
revision_prefix="arn:aws:ecs:${region}:${account}:service-revision/${cluster}/${service_name}/"

bound="$(jq -cer \
  --arg service "$service_prefix" --arg deployment "$deployment_prefix" --arg revision "$revision_prefix" '
  if .serviceArn != $service then error("create returned the wrong service ARN")
  elif (.currentDeployment | type) != "string"
    or (.currentDeployment | startswith($deployment) | not)
    or (.currentDeployment | ltrimstr($deployment) | test("^[^/]+$") | not) then
    error("create returned no exact current deployment ARN")
  elif (.activeRevisions | type) != "array" or (.activeRevisions | length) != 1
    or (.activeRevisions[0] | type) != "string"
    or (.activeRevisions[0] | startswith($revision) | not)
    or (.activeRevisions[0] | ltrimstr($revision) | test("^[^/]+$") | not) then
    error("create returned anything other than one exact active revision")
  else {serviceArn, deploymentArn:.currentDeployment, targetRevisionArn:.activeRevisions[0]} end
  ' "$response")"
deployment_arn="$(jq -r '.deploymentArn' <<< "$bound")"
target_revision="$(jq -r '.targetRevisionArn' <<< "$bound")"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

for _ in $(seq 1 "$attempts"); do
  described="$(aws_cmd ecs describe-service-deployments --service-deployment-arns "$deployment_arn" \
    --query 'serviceDeployments' --output json --region "$region")"
  count="$(jq 'length' <<< "$described")"
  if [ "$count" -gt 1 ]; then
    echo "ERROR: exact create deployment ARN resolved to multiple records" >&2
    exit 76
  fi
  if [ "$count" -eq 1 ]; then
    if ! jq -e --arg service "$service_prefix" --arg target "$target_revision" '
      .[0].serviceArn == $service and .[0].targetServiceRevision.arn == $target
    ' <<< "$described" >/dev/null; then
      echo "ERROR: create deployment does not corroborate its returned service/revision identity" >&2
      exit 76
    fi
    printf '%s\n' "$bound"
    exit 0
  fi
  sleep "$poll_seconds"
done

echo "ERROR: returned create deployment never became describable; state is UNKNOWN" >&2
exit 75
