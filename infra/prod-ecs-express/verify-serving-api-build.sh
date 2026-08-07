#!/usr/bin/env bash
# Controller-side F2 pin. The release task repeats this read under the durable DB writer fence.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <uat|production> <full-commit-sha>" >&2
  exit 2
fi
environment="$1"
expected_sha="$2"
case "$environment" in uat|production) ;; *) exit 2 ;; esac
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "ERROR: expected a full lowercase release SHA" >&2; exit 2; }

aws_bin="${AWS_BIN:-aws}"
region="${AWS_REGION:-ap-southeast-1}"
stability_seconds="${SERVING_BUILD_STABILITY_SECONDS:-2}"
parameter="/watchdog-bms/${environment}/ecs-express-api-web-service-arn"
service_arn="$($aws_bin ssm get-parameter --name "$parameter" --query Parameter.Value --output text --region "$region")"
cluster="watchdog-bms-prod"
service_name="watchdog-bms-api-web-pub"
if [ "$environment" = "uat" ]; then
  cluster="watchdog-bms-uat"
  service_name="watchdog-bms-uat-api-web"
fi
[[ "$service_arn" =~ ^arn:aws:ecs:${region}:[0-9]{12}:service/${cluster}/${service_name}$ ]] || {
  echo "ERROR: F2 api-web SSM identity is missing or outside ${environment}" >&2
  exit 75
}

read_state() {
  local service deployment_arn deployment history stability_evidence
  service="$($aws_bin ecs describe-express-gateway-service --service-arn "$service_arn" --output json --region "$region")"
  deployment_arn="$(jq -r '.service.currentDeployment // empty' <<< "$service")"
  if [ -n "$deployment_arn" ]; then
    [[ "$deployment_arn" =~ ^arn:aws:ecs:${region}:[0-9]{12}:service-deployment/${cluster}/${service_name}/[^/]+$ ]] || {
      echo "ERROR: F2 api-web currentDeployment has an invalid identity" >&2
      return 75
    }
    deployment="$($aws_bin ecs describe-service-deployments --service-deployment-arns "$deployment_arn" --output json --region "$region")"
    stability_evidence="$(jq -cS . <<< "$deployment")"
  else
    history="$($aws_bin ecs list-service-deployments --service "$service_arn" --max-results 100 --output json --region "$region")"
    if ! jq -e '.nextToken == null and (.serviceDeployments | length) > 0' <<< "$history" >/dev/null; then
      echo "ERROR: F2 settled deployment history is empty or paginated" >&2
      return 75
    fi
    deployment="$(jq -ce '
      [.serviceDeployments[] | select(.createdAt != null)]
      | (sort_by(.createdAt) | last.createdAt) as $newest
      | [ .[] | select(.createdAt == $newest) ]
      | if length != 1 then error("ambiguous newest deployment")
        else {serviceDeployments:[.[0]]} end
    ' <<< "$history")" || return 75
    deployment_arn="$(jq -r '.serviceDeployments[0].serviceDeploymentArn // empty' <<< "$deployment")"
    # Preserve the entire unpaginated history in the two-read comparison. Comparing only the
    # selected newest row misses a concurrent append/rewrite whose winner happens to stay the same.
    stability_evidence="$(jq -cS . <<< "$history")"
  fi
  jq -ce --arg serviceArn "$service_arn" --arg deploymentArn "$deployment_arn" --arg sha "$expected_sha" '
    . as $serviceResponse
    | $ARGS.named as $expected
    | ($serviceResponse.service) as $service
    | if $service.serviceArn != $expected.serviceArn or $service.status.statusCode != "ACTIVE" then
        error("api-web service is not exact and ACTIVE")
      elif ($service.activeConfigurations | length) != 1 then
        error("api-web does not have exactly one active configuration")
      else
        ($service.activeConfigurations[0]) as $active
        | ([$active.primaryContainer.environment[]? | select(.name == "GIT_SHA") | .value]) as $shas
        | if $shas != [$expected.sha] or ($shas[0] | test("^[0-9a-f]{40}$") | not) then
            error("requested SHA is not the exact full SHA serving api-web")
          else {serviceArn:$service.serviceArn,currentDeployment:($service.currentDeployment // null),
                effectiveDeployment:$expected.deploymentArn,
                targetRevisionArn:$active.serviceRevisionArn,buildReleaseId:$shas[0]} end
      end
  ' <<< "$service" | jq -ce --argjson deployment "$deployment" \
    --argjson stabilityEvidence "$stability_evidence" '
    . as $state
    | ($deployment.serviceDeployments) as $rows
    | if ($rows|length) != 1
      or $rows[0].serviceDeploymentArn != $state.effectiveDeployment
      or $rows[0].serviceArn != $state.serviceArn
      or $rows[0].status != "SUCCESSFUL"
      or ($rows[0].targetServiceRevisionArn // $rows[0].targetServiceRevision.arn) != $state.targetRevisionArn
      then error("current api-web deployment is not exact, successful and serving")
      else $state + {_stabilityEvidence:$stabilityEvidence} end
  '
}

first="$(read_state)"
sleep "$stability_seconds"
second="$(read_state)"
if [ "$first" != "$second" ]; then
  echo "ERROR: api-web serving identity moved between F2 preflight reads" >&2
  exit 75
fi
printf '%s\n' "$(jq -c 'del(._stabilityEvidence)' <<< "$second")"
