#!/usr/bin/env bash
# The builds SERVING right now, derived from ECS Express `service.activeConfigurations` and printed
# as the comma-separated list `retire-launch-builds.ts` treats as authority.
#
# Two call shapes:
#   active-launch-builds.sh                      filter only — the activeConfigurations JSON on stdin.
#   active-launch-builds.sh --service-arn <arn> --deployment-arn <arn> --target-revision-arn <arn>
#                                                read it from the platform, bound to the exact rollout
#                                                this workflow started. Exit 75 means "not settled".
#
# UAT r6 item 4a. Both deploy workflows used to read the list inline with
# `--query '...environment[?name==`GIT_SHA`].value' | jq 'flatten | unique | join(",")'`, which is
# silently lossy in exactly the direction that destroys a live build: a configuration whose container
# carries NO GIT_SHA contributes an empty array that `flatten` erases, and a malformed value passes
# straight through. Either way a build still taking traffic is missing from the "active" list, and
# the post-deploy pass then retires its launch-gate authority.
#
# UAT r7 item 1. Counting the values in aggregate was still lossy: one configuration carrying TWO
# GIT_SHA entries paid for another configuration carrying none, so the totals matched and a serving
# build was again erased. Validation is therefore PER CONFIGURATION — every active configuration must
# name its service revision and carry exactly one full 40-hex GIT_SHA, or this exits non-zero and
# emits nothing, and the caller retires NOTHING.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  service_arn=""
  deployment_arn=""
  target_revision_arn=""
elif { [ "$#" -eq 6 ] || [ "$#" -eq 8 ]; } && [ "$1" = "--service-arn" ] && [ -n "$2" ] \
  && [ "$3" = "--deployment-arn" ] && [ -n "$4" ] \
  && [ "$5" = "--target-revision-arn" ] && [ -n "$6" ] \
  && { [ "$#" -eq 6 ] || { [ "$7" = "--legacy-descriptor-file" ] && [ -n "$8" ]; }; }; then
  service_arn="$2"
  deployment_arn="$4"
  target_revision_arn="$6"
  legacy_descriptor_file="${8:-}"
else
  echo "Usage: $0 [--service-arn <arn> --deployment-arn <arn> --target-revision-arn <arn> [--legacy-descriptor-file <json>]]   (no arguments: JSON on stdin)" >&2
  exit 2
fi
legacy_descriptor_file="${legacy_descriptor_file:-}"

active_manifest() {
  jq -er '
    if type != "array" then error("expected a service.activeConfigurations array, got \(type)") else . end
    | if length == 0 then
        error("no active configuration is serving; refusing to derive an active build list")
      elif length > 2 then
        error("\(length) active configurations are serving, above the two-build launch window")
      else . end
    | map(
        (.serviceRevisionArn // "") as $revision
        | [.primaryContainer.environment[]? | select(.name == "GIT_SHA") | .value] as $shas
        | if ($revision | type) != "string" or ($revision | startswith("arn:") | not) then
            error("an active configuration carries no serviceRevisionArn: \(tojson)")
          elif ($shas | length) != 1 then
            error("active configuration \($revision) carries \($shas | length) GIT_SHA value(s), expected exactly 1: \($shas | tojson)")
          elif ($shas[0] | type) != "string" or ($shas[0] | test("^[0-9a-f]{40}$") | not) then
            error("active configuration \($revision) GIT_SHA is not a full 40-hex commit: \($shas | tojson)")
          else
            {revision:$revision, sha:$shas[0]}
          end
      )
    | sort_by(.revision)
  '
}

active_builds() { active_manifest | jq -er 'map(.sha) | unique | join(",")'; }

if [ -z "$service_arn" ]; then
  active_builds
  exit 0
fi

aws_bin="${AWS_BIN:-aws}"
poll_attempts="${ACTIVE_BUILDS_POLL_ATTEMPTS:-30}"
poll_seconds="${ACTIVE_BUILDS_POLL_SECONDS:-20}"
stability_seconds="${ACTIVE_BUILDS_STABILITY_SECONDS:-15}"

# DEFER (75, EX_TEMPFAIL): it is not safe to retire against this state. The caller must use no active
# list, retire nothing, fail the workflow and leave the durable parent unresolved for reconciliation.
defer() {
  echo "[active-launch-builds] deferred to reconciliation: $1" >&2
  exit 75
}

# Bind the read to the exact deployment ARN returned by this workflow's update call. Looking up
# `service.currentDeployment` here can silently select a newer rollout after cancellation/retry.
deployment="$("$aws_bin" ecs describe-service-deployments \
  --service-deployment-arns "$deployment_arn" \
  --query 'serviceDeployments[0].{status:status,serviceArn:serviceArn,targetRevision:targetServiceRevision.arn,createdAt:createdAt}' \
  --output json)"
if [ "$(jq -r '.serviceArn // empty' <<< "$deployment")" != "$service_arn" ]; then
  defer "deployment $deployment_arn does not belong to service $service_arn"
fi
if [ "$(jq -r '.targetRevision // empty' <<< "$deployment")" != "$target_revision_arn" ]; then
  defer "deployment $deployment_arn does not target the authorized revision $target_revision_arn"
fi

# UAT r7 item 1(a) — a mid-rollout service reports the configurations of BOTH builds and swaps them
# out from under the reader, so retirement waits for the platform's own terminal verdict. Only
# SUCCESSFUL (rolled out) and ROLLBACK_SUCCESSFUL (rolled back, and the survivor is now stable) are
# safe; every other state defers, including ROLLBACK_FAILED, where the service is in no known state.
deployment_state=""
for _ in $(seq 1 "$poll_attempts"); do
  deployment_state="$("$aws_bin" ecs describe-service-deployments \
    --service-deployment-arns "$deployment_arn" --query 'serviceDeployments[0].status' --output text)"
  case "$deployment_state" in
    SUCCESSFUL|ROLLBACK_SUCCESSFUL) break ;;
    PENDING|IN_PROGRESS|ROLLBACK_IN_PROGRESS|STOP_REQUESTED)
      deployment_state=""
      sleep "$poll_seconds"
      ;;
    *) defer "deployment ${deployment_arn} is ${deployment_state}" ;;
  esac
done
if [ -z "$deployment_state" ]; then
  defer "deployment did not reach SUCCESSFUL or ROLLBACK_SUCCESSFUL within $((poll_attempts * poll_seconds))s"
fi

current_deployment="$("$aws_bin" ecs describe-express-gateway-service \
  --service-arn "$service_arn" --query 'service.currentDeployment' --output text)"
if [ -n "$current_deployment" ] && [ "$current_deployment" != "None" ] \
  && [ "$current_deployment" != "$deployment_arn" ]; then
  defer "a newer deployment is current ($current_deployment), not the workflow deployment $deployment_arn"
fi

# UAT r7 item 1(b) — a terminal deployment status is not proof the configuration set has settled: a
# drained configuration can disappear moments later, and a list read across that edge names a build
# that is no longer serving next to one that is. Two agreeing reads, or defer.
read_active() {
  "$aws_bin" ecs describe-express-gateway-service --service-arn "$service_arn" \
    --query 'service.activeConfigurations' --output json | active_manifest
}
read_active_raw() {
  "$aws_bin" ecs describe-express-gateway-service --service-arn "$service_arn" \
    --query 'service.activeConfigurations' --output json
}
read_service_state() {
  "$aws_bin" ecs describe-express-gateway-service --service-arn "$service_arn" \
    --query 'service.{status:status.statusCode,currentDeployment:currentDeployment,activeConfigurations:activeConfigurations}' \
    --output json
}
read_deployment_history() {
  AWS_BIN="$aws_bin" bash "$(dirname "$0")/list-service-deployments-all.sh" \
    --service-arn "$service_arn" \
    --query '{nextToken:nextToken,serviceDeployments:serviceDeployments[].{deploymentArn:serviceDeploymentArn,createdAt:createdAt}}' \
    | jq -c '.serviceDeployments |= sort_by(.createdAt,.deploymentArn)'
}

validate_exact_legacy() {
  local raw="$1" descriptor configuration config_hash
  [ -n "$legacy_descriptor_file" ] && [ -f "$legacy_descriptor_file" ] || return 1
  [ "$(jq -r '.serviceArn // empty' "$legacy_descriptor_file")" = "$service_arn" ] || return 1
  descriptor="$(jq -c '.descriptor' "$legacy_descriptor_file")"
  [ "$(jq '[.[] | [.primaryContainer.environment[]? | select(.name == "GIT_SHA") | .value] | select(length == 1 and (.[0] | test("^[0-9a-f]{12}$")))] | length' <<< "$raw")" -eq 1 ] || return 1
  configuration="$(jq -c '.[] | select([.primaryContainer.environment[]? | select(.name == "GIT_SHA") | .value] | length == 1 and (.[0] | test("^[0-9a-f]{12}$")))' <<< "$raw")"
  config_hash="$(jq -cS '{
    executionRoleArn,taskRoleArn,cpu:(.cpu|tostring),memory:(.memory|tostring),
    networkConfiguration:{securityGroups:((.networkConfiguration.securityGroups // [])|sort),subnets:((.networkConfiguration.subnets // [])|sort)},
    healthCheckPath,
    primaryContainer:{image:.primaryContainer.image,containerPort:.primaryContainer.containerPort,
      awsLogsConfiguration:(.primaryContainer.awsLogsConfiguration // null),repositoryCredentials:(.primaryContainer.repositoryCredentials // null),
      command:(.primaryContainer.command // []),environment:((.primaryContainer.environment // [])|sort_by(.name,.value)),
      secrets:((.primaryContainer.secrets // [])|sort_by(.name,.valueFrom))},scalingTarget
  }' <<< "$configuration" | shasum -a 256 | awk '{print $1}')"
  jq -e --arg revision "$(jq -r '.serviceRevisionArn' <<< "$configuration")" \
    --arg sha "$(jq -r '[.primaryContainer.environment[] | select(.name == "GIT_SHA") | .value][0]' <<< "$configuration")" \
    --arg image "$(jq -r '.primaryContainer.image' <<< "$configuration")" --arg hash "$config_hash" \
    '.revisionArn == $revision and .sourceSha == $sha and .image == $image and .configHash == $hash' \
    <<< "$descriptor" >/dev/null
}

# First UAT cutover starts from one historical 12-character descriptor with null
# currentDeployment. SUCCESS waits until that exact descriptor is fully drained; rollback never
# feeds the short SHA into retirement and instead defers to exact intent recovery/cleanup.
if [ -n "$legacy_descriptor_file" ]; then
  settled_raw=""
  for _ in $(seq 1 "$poll_attempts"); do
    raw="$(read_active_raw)"
    short_count="$(jq '[.[] | [.primaryContainer.environment[]? | select(.name == "GIT_SHA") | .value] | select(length == 1 and (.[0] | test("^[0-9a-f]{12}$")))] | length' <<< "$raw")"
    if [ "$short_count" -eq 0 ]; then settled_raw="$raw"; break; fi
    validate_exact_legacy "$raw" || defer "legacy api-web descriptor differs from the persisted first-cutover descriptor"
    if [ "$deployment_state" = "ROLLBACK_SUCCESSFUL" ]; then
      [ "$(jq 'length' <<< "$raw")" -eq 1 ] \
        || defer "rollback has the legacy descriptor plus another active configuration"
      defer "exact legacy rollback requires recover-release-intent; the short SHA is never attested or retired"
    fi
    sleep "$poll_seconds"
  done
  [ -n "$settled_raw" ] || defer "successful first-cutover did not drain the exact legacy descriptor"
fi

first_service="$(read_service_state)"
first_history="$(read_deployment_history)"
sleep "$stability_seconds"
second_service="$(read_service_state)"
second_history="$(read_deployment_history)"
if [ "$first_service" != "$second_service" ] || [ "$first_history" != "$second_history" ]; then
  defer "the service/deployment-history evidence moved between two reads"
fi
if ! jq -e --arg deployment "$deployment_arn" '
  .nextToken == null
  and (.serviceDeployments | length) >= 1
  and (.serviceDeployments[-1] as $newest
    | ([.serviceDeployments[] | select(.deploymentArn == $deployment)] | length) == 1
      and $newest.deploymentArn == $deployment
      and ([.serviceDeployments[] | select(.createdAt == $newest.createdAt)] | length) == 1)
' <<< "$second_history" >/dev/null; then
  defer "the workflow deployment is not the unique latest bounded service deployment"
fi
if ! jq -e --arg deployment "$deployment_arn" '
  .status == "ACTIVE" and (.currentDeployment == null or .currentDeployment == $deployment)
' <<< "$second_service" >/dev/null; then
  defer "the ACTIVE service has a different non-null current deployment"
fi
second="$(jq -c '.activeConfigurations' <<< "$second_service" | active_manifest)"
if [ "$(jq 'length' <<< "$second")" -ne 1 ]; then
  defer "terminal retirement requires one stable active configuration"
fi
target_revision="$(jq -r '.targetRevision // empty' <<< "$deployment")"
if [ "$deployment_state" = "SUCCESSFUL" ] \
  && ! jq -e --arg revision "$target_revision" '.[0].revision == $revision' <<< "$second" >/dev/null; then
  defer "successful deployment $deployment_arn target revision $target_revision is no longer active; a newer rollout superseded it"
fi
jq -er 'map(.sha) | unique | join(",")' <<< "$second"
