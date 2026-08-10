#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <validated-context.json> <PRE_MUTATION|POST_MIGRATION|POST_DEPLOYMENT>" >&2
  exit 2
fi

context="$1"
stage="$2"
region=ap-southeast-1
account=311414082667
cluster=watchdog-bms-prod
service_name=watchdog-bms-api-web-pub
service_parameter=/watchdog-bms/production/ecs-express-api-web-service-arn
aws_bin="${AWS_BIN:-aws}"

fail() { echo "ERROR: production A5 current quiesce: $*" >&2; exit 1; }
aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

[ -f "$context" ] && [ ! -L "$context" ] || fail "context is not a regular file"
[[ "$stage" =~ ^(PRE_MUTATION|POST_MIGRATION|POST_DEPLOYMENT)$ ]] || fail "stage is invalid"
proof_filter='.reimbursementWriteQuiesce.bridgeProof'
[ "$stage" = POST_DEPLOYMENT ] && proof_filter='.reimbursementWriteQuiesce.finalUnquiescedProof'
proof="$(jq -ce "$proof_filter" "$context")" || fail "current proof is absent"
now="$(date -u +%s)"
max_age=600
[ "$stage" = POST_MIGRATION ] && max_age=1800
jq -e --argjson now "$now" --argjson maxAge "$max_age" '
  .observedAtEpoch <= $now and ($now - .observedAtEpoch) <= $maxAge
' <<< "$proof" >/dev/null || fail "current proof is stale or from the future"

service_arn="$(aws_cmd ssm get-parameter --name "$service_parameter" --region "$region" \
  --query Parameter.Value --output text)"
[ "$service_arn" = "arn:aws:ecs:${region}:${account}:service/${cluster}/${service_name}" ] \
  || fail "production api-web service identity is invalid"

work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-quiesce.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
aws_cmd ecs describe-express-gateway-service --service-arn "$service_arn" --region "$region" \
  --output json > "$work/service.json"
revision_arn="$(jq -er '.service.activeConfigurations[0].serviceRevisionArn' "$work/service.json")"
expected_revision="$(jq -er '.serviceRevisionArn' <<< "$proof")"
[ "$revision_arn" = "$expected_revision" ] || fail "active service revision differs from proof"
expected_image="$(jq -er '.image' <<< "$proof")"
expected_digest="${expected_image##*@}"
expected_source="$(jq -er '.sourceCommit' <<< "$proof")"
expected_flag="$(jq -r '.quiesceEnabled|if . then "true" else "false" end' <<< "$proof")"
jq -e --arg service "$service_arn" --arg revision "$expected_revision" \
  --arg image "$expected_image" --arg source "$expected_source" --arg flag "$expected_flag" '
    .service.serviceArn == $service and .service.status.statusCode == "ACTIVE"
    and .service.currentDeployment == null
    and (.service.activeConfigurations | length) == 1
    and .service.activeConfigurations[0].serviceRevisionArn == $revision
    and .service.activeConfigurations[0].primaryContainer.image == $image
    and ([.service.activeConfigurations[0].primaryContainer.environment[]?
      | select(.name == "GIT_SHA") | .value] == [$source])
    and ([.service.activeConfigurations[0].primaryContainer.environment[]?
      | select(.name == "REIMBURSEMENT_WRITE_QUIESCE") | .value] == [$flag])
  ' "$work/service.json" >/dev/null || fail "active configuration does not match current proof"

aws_cmd ecs describe-service-revisions --service-revision-arns "$revision_arn" --region "$region" \
  --output json > "$work/revision.json"
task_definition="$(jq -er --arg revision "$revision_arn" --arg service "$service_arn" \
  --arg image "$expected_image" --arg digest "$expected_digest" '
    select((.failures // []) | length == 0)
    | select((.serviceRevisions | length) == 1)
    | .serviceRevisions[0]
    | select(.serviceRevisionArn == $revision and .serviceArn == $service)
    | select([.containerImages[]? | select(.image == $image and .imageDigest == $digest)] | length == 1)
    | .taskDefinition | select(type == "string" and length > 0)
  ' "$work/revision.json")" || fail "service revision image/task definition does not match proof"

aws_cmd ecs list-tasks --cluster "$cluster" --service-name "$service_name" --desired-status RUNNING \
  --max-results 100 --region "$region" --output json > "$work/task-list.json"
jq -e '.nextToken == null and (.taskArns | type == "array" and length >= 1)' \
  "$work/task-list.json" >/dev/null || fail "running task list is empty or paginated"
jq -cS '.taskArns|sort' "$work/task-list.json" > "$work/actual-task-arns.json"
jq -cS '.activeTaskArns' <<< "$proof" > "$work/expected-task-arns.json"
cmp -s "$work/actual-task-arns.json" "$work/expected-task-arns.json" \
  || fail "running task set differs from proof"

task_arns="$(jq -r '.taskArns[]' "$work/task-list.json")"
# shellcheck disable=SC2086 # ECS task ARNs were schema-checked and contain no whitespace.
aws_cmd ecs describe-tasks --cluster "$cluster" --tasks $task_arns --region "$region" \
  --output json > "$work/tasks.json"
jq -e --arg taskDefinition "$task_definition" --arg group "service:$service_name" \
  --slurpfile expected "$work/expected-task-arns.json" '
    ((.failures // []) | length) == 0
    and ([.tasks[].taskArn] | sort) == $expected[0]
    and all(.tasks[];
      .taskDefinitionArn == $taskDefinition and .group == $group
      and .desiredStatus == "RUNNING" and .lastStatus == "RUNNING")
  ' "$work/tasks.json" >/dev/null || fail "running tasks do not belong to the proved revision"

printf '%s\n' "production A5 current quiesce proof verified"
