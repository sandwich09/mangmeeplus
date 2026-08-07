#!/usr/bin/env bash
# Validate the exact deployment evidence consumed by post-deploy launch-build retirement.
set -euo pipefail

if [ "$#" -ne 12 ] || [ "$1" != "--file" ] || [ "$3" != "--service-arn" ] \
  || [ "$5" != "--source-sha" ] || [ "$7" != "--region" ] \
  || [ "$9" != "--account" ] || [ "${11}" != "--cluster" ]; then
  echo "Usage: $0 --file <json> --service-arn <arn> --source-sha <sha> --region <region> --account <id> --cluster <name>" >&2
  exit 2
fi
file="$2"
service_arn="$4"
source_sha="$6"
region="$8"
account="${10}"
cluster="${12}"

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$account" =~ ^[0-9]{12}$ ]]
[[ "$region" =~ ^[a-z]{2}-[a-z]+-[0-9]$ ]]
[[ "$service_arn" =~ ^arn:aws:ecs:${region}:${account}:service/${cluster}/[^/]+$ ]]

jq -cer \
  --arg serviceArn "$service_arn" --arg sourceSha "$source_sha" \
  --arg deploymentPrefix "arn:aws:ecs:${region}:${account}:service-deployment/${cluster}/" \
  --arg revisionPrefix "arn:aws:ecs:${region}:${account}:service-revision/${cluster}/" '
  if type != "object" or .service != "api-web" or .serviceArn != $serviceArn or .sourceSha != $sourceSha then
    error("deployment evidence identity does not match this api-web release")
  elif (.noOp | type) != "boolean" then error("deployment evidence noOp must be boolean")
  elif (.targetRevisionArn | type) != "string"
    or (.targetRevisionArn | startswith($revisionPrefix) | not)
    or (.targetRevisionArn | ltrimstr($revisionPrefix) | test("^[^/]+/[^/]+$") | not) then
    error("deployment evidence has no exact target revision ARN")
  elif .noOp == true and .deploymentArn != null then error("no-op evidence must not carry a deployment ARN")
  elif .noOp == false and ((.deploymentArn | type) != "string"
    or (.deploymentArn | startswith($deploymentPrefix) | not)
    or (.deploymentArn | ltrimstr($deploymentPrefix) | test("^[^/]+/[^/]+$") | not)) then
    error("rollout evidence has no exact deployment ARN")
  else {
    noOp,
    serviceArn,
    sourceSha,
    deploymentArn,
    targetRevisionArn
  } end
  ' "$file"
