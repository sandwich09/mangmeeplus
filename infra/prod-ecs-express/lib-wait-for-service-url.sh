#!/usr/bin/env bash

# Source-only helper. The caller provides aws_cmd, service_url, AWS_BIN and REGION.
wait_for_service_url() {
  local arn="$1"
  local access_type="${2:-PUBLIC}"
  local expected_deployment="${3:-}"
  local expected_target_revision="${4:-}"
  local proven_noop="${5:-false}"
  local before_deployments="${6:-}"
  local before_service="${7:-}"
  local poll_attempts="${DEPLOYMENT_POLL_ATTEMPTS:-90}"
  local url=""
  case "$poll_attempts" in
    ''|*[!0-9]*|0*)
      echo "ERROR: DEPLOYMENT_POLL_ATTEMPTS must be a positive integer" >&2
      return 2
      ;;
  esac
  for _ in $(seq 1 "$poll_attempts"); do
    local status deployment_status deployment
    if ! status="$(aws_cmd ecs describe-express-gateway-service --service-arn "$arn" --query 'service.status.statusCode' --output text --region "$REGION")"; then
      echo "ERROR: cannot read ECS Express service status; AWS credentials may have expired" >&2
      exit 1
    fi
    echo "[ecs-express] status=$status arn=$arn" >&2
    url="$(service_url "$arn" "$access_type" || true)"
    # Read the bound rollout even while the outer service is DRAINING or has no ingress URL. A
    # rollback can become terminal in exactly that window; hiding it behind ACTIVE+URL turns a
    # decisive failure into a 30-minute timeout.
    if [ "$proven_noop" != "true" ]; then
      if [ -z "$expected_deployment" ] || [ -z "$expected_target_revision" ]; then
        echo "ERROR: a non-no-op rollout has no exact deployment/revision binding" >&2
        exit 1
      fi
      if ! deployment="$(aws_cmd ecs describe-service-deployments \
        --service-deployment-arns "$expected_deployment" \
        --query 'serviceDeployments[0].{status:status,serviceArn:serviceArn,targetRevision:targetServiceRevision.arn}' \
        --output json --region "$REGION")"; then
        echo "ERROR: cannot read ECS Express deployment status; AWS credentials may have expired" >&2
        exit 1
      fi
      if [ "$(jq -r '.serviceArn // empty' <<< "$deployment")" != "$arn" ] \
        || [ "$(jq -r '.targetRevision // empty' <<< "$deployment")" != "$expected_target_revision" ]; then
        echo "ERROR: bound deployment no longer matches the exact service/target revision; state is UNKNOWN" >&2
        exit 1
      fi
      deployment_status="$(jq -r '.status // empty' <<< "$deployment")"
      echo "[ecs-express] deployment=$deployment_status arn=$expected_deployment target=$expected_target_revision" >&2
      case "$deployment_status" in
        STOPPED|ROLLBACK_SUCCESSFUL|ROLLBACK_FAILED)
          echo "ERROR: ECS Express deployment ended with status ${deployment_status}: $expected_deployment" >&2
          exit 1
          ;;
      esac
    fi
    if [ "$status" = "ACTIVE" ] && [ -n "$url" ]; then
      if [ "$proven_noop" = "true" ]; then
        if [ -z "$before_deployments" ] || [ -z "$before_service" ]; then
          echo "ERROR: no-op verification has no before-state evidence" >&2
          exit 1
        fi
        if ! AWS_BIN="$AWS_BIN" AWS_REGION="$REGION" \
          bash "$(dirname "$0")/verify-express-noop.sh" \
            --service-arn "$arn" --target-revision "$expected_target_revision" \
            --before-deployments "$before_deployments" --before-service "$before_service" >/dev/null; then
          echo "ERROR: ECS Express no-op could not be proven stable; state is UNKNOWN" >&2
          exit 1
        fi
        printf '%s' "$url"
        return
      fi
      if [ "$deployment_status" = "SUCCESSFUL" ]; then
        local settled_first settled_second history_first history_second snapshot
        settled_first="$(aws_cmd ecs describe-express-gateway-service \
          --service-arn "$arn" \
          --query 'service.{status:status.statusCode,currentDeployment:currentDeployment,activeRevisions:activeConfigurations[].serviceRevisionArn}' \
          --output json --region "$REGION")" || return $?
        history_first="$(AWS_BIN="$AWS_BIN" AWS_REGION="$REGION" \
          bash "$(dirname "$0")/list-service-deployments-all.sh" --service-arn "$arn" \
          --query '{nextToken:nextToken,serviceDeployments:serviceDeployments[].{deploymentArn:serviceDeploymentArn,createdAt:createdAt}}' \
          | jq -c '
            .serviceDeployments |= sort_by(.createdAt,.deploymentArn)
          ')" || return $?
        sleep "${DEPLOYMENT_STABILITY_SECONDS:-2}"
        settled_second="$(aws_cmd ecs describe-express-gateway-service \
          --service-arn "$arn" \
          --query 'service.{status:status.statusCode,currentDeployment:currentDeployment,activeRevisions:activeConfigurations[].serviceRevisionArn}' \
          --output json --region "$REGION")" || return $?
        history_second="$(AWS_BIN="$AWS_BIN" AWS_REGION="$REGION" \
          bash "$(dirname "$0")/list-service-deployments-all.sh" --service-arn "$arn" \
          --query '{nextToken:nextToken,serviceDeployments:serviceDeployments[].{deploymentArn:serviceDeploymentArn,createdAt:createdAt}}' \
          | jq -c '
            .serviceDeployments |= sort_by(.createdAt,.deploymentArn)
          ')" || return $?

        # Validate contradictions before deciding whether the two reads merely moved while ECS
        # drained the previous active configuration.
        for snapshot in "$settled_first" "$settled_second"; do
          if ! jq -e --arg deployment "$expected_deployment" --arg target "$expected_target_revision" '
            ($target | sub("[^/]+$"; "")) as $revisionPrefix
            |
            (.activeRevisions | type) == "array"
            and (.activeRevisions | length) <= 2
            and ([.activeRevisions[] | select(
              type != "string" or length == 0 or (startswith($revisionPrefix) | not)
            )] | length) == 0
            and ((.activeRevisions | unique | length) == (.activeRevisions | length))
            and (.currentDeployment == null or .currentDeployment == $deployment)
          ' <<< "$snapshot" >/dev/null; then
            echo "ERROR: successful deployment has contradictory active service state; state is UNKNOWN" >&2
            return 1
          fi
        done
        for snapshot in "$history_first" "$history_second"; do
          if ! jq -e --arg deployment "$expected_deployment" '
            def iso_epoch:
              (if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$")
              then capture("^(?<base>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?<fraction>\\.[0-9]+)?(?<zone>Z|[+-][0-9]{2}:[0-9]{2})$")
              else error("malformed timestamp") end) as $part
              | ($part.base | strptime("%Y-%m-%dT%H:%M:%S") | mktime) as $local
              | if (($local | gmtime | strftime("%Y-%m-%dT%H:%M:%S")) != $part.base)
                then error("invalid calendar timestamp") else . end
              | (if $part.zone == "Z" then {hour:0, minute:0, sign:1} else {
                   hour: ($part.zone[1:3] | tonumber),
                   minute: ($part.zone[4:6] | tonumber),
                   sign: (if $part.zone[0:1] == "+" then 1 else -1 end)
                 } end) as $zone
              | if ($zone.hour > 23 or $zone.minute > 59) then error("invalid timezone offset") else . end
              | (($zone.hour * 3600 + $zone.minute * 60) * $zone.sign) as $offset
              | $local + (($part.fraction // "0") | tonumber) - $offset;
            (.serviceDeployments | map(. + {
              _epoch: (try (.createdAt | iso_epoch) catch null)
            })) as $rows
            |
            .nextToken == null
            and (.serviceDeployments | type) == "array"
            and ([$rows[] | select(
              (.deploymentArn | type) != "string" or (.deploymentArn | length) == 0
              or (.createdAt | type) != "string" or ._epoch == null
            )] | length) == 0
            and (([$rows[] | select(.deploymentArn == $deployment)] | length) as $expectedCount
              | $expectedCount <= 1
              and ($expectedCount == 0 or (([$rows[]._epoch] | max) as $newestAt
                | ([$rows[] | select(._epoch == $newestAt)] | length) == 1
                and ([$rows[] | select(._epoch == $newestAt)][0].deploymentArn == $deployment))))
          ' <<< "$snapshot" >/dev/null; then
            echo "ERROR: successful deployment has contradictory deployment history; state is UNKNOWN" >&2
            return 1
          fi
        done

        if [ "$settled_first" != "$settled_second" ] || [ "$history_first" != "$history_second" ]; then
          echo "[ecs-express] waiting for stable service/deployment evidence" >&2
        elif ! jq -e --arg deployment "$expected_deployment" '
          ([.serviceDeployments[] | select(.deploymentArn == $deployment)] | length) == 1
        ' <<< "$history_second" >/dev/null; then
          echo "ERROR: successful deployment is absent from stable deployment history; state is UNKNOWN" >&2
          return 1
        elif jq -e --arg deployment "$expected_deployment" --arg target "$expected_target_revision" '
          .status == "ACTIVE"
          and (.currentDeployment == null or .currentDeployment == $deployment)
          and .activeRevisions == [$target]
        ' <<< "$settled_second" >/dev/null; then
          printf '%s' "$url"
          return
        elif jq -e --arg target "$expected_target_revision" '
          .status != "ACTIVE"
          or (.activeRevisions | length) == 0
          or ((.activeRevisions | length) == 2 and (.activeRevisions | index($target)) != null)
        ' <<< "$settled_second" >/dev/null; then
          echo "[ecs-express] waiting for the previous active revision to drain" >&2
        else
          echo "ERROR: successful deployment settled on a different active target; state is UNKNOWN" >&2
          return 1
        fi
      fi
    fi
    if [ "$status" = "ACTIVE" ] && [ -z "$url" ]; then
      # Surface the actual ingressPaths so a mismatched accessType expectation
      # fails loudly instead of spinning for 30 minutes.
      aws_cmd ecs describe-express-gateway-service --service-arn "$arn" \
        --query 'service.activeConfigurations[0].ingressPaths' --output json --region "$REGION" >&2 || true
    fi
    sleep 20
  done
  echo "ERROR: ECS Express service did not become a stable ACTIVE singleton with a ${access_type} URL: $arn" >&2
  exit 1
}
