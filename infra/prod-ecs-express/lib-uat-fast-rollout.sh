#!/usr/bin/env bash

uat_fast_rollout_snapshot() {
  local service_name="$1"
  aws_cmd ecs describe-services \
    --cluster "$CLUSTER_NAME" --services "$service_name" \
    --output json --region "$REGION"
}

validate_uat_fast_rollout_snapshot() {
  local service_name="$1" snapshot="$2"
  jq -e --arg service "$service_name" --arg alarm "${RESOURCE_PREFIX}/${service_name}/RollbackAlarm" '
    (.failures | length) == 0
    and (.services | length) == 1
    and .services[0].serviceName == $service
    and .services[0].status == "ACTIVE"
    and .services[0].deploymentController.type == "ECS"
    and (.services[0].deployments | length) == 1
    and .services[0].deployments[0].status == "PRIMARY"
    and .services[0].deployments[0].rolloutState == "COMPLETED"
    and .services[0].deploymentConfiguration.strategy == "CANARY"
    and .services[0].deploymentConfiguration.minimumHealthyPercent == 100
    and .services[0].deploymentConfiguration.maximumPercent == 200
    and .services[0].deploymentConfiguration.canaryConfiguration.canaryPercent == 5
    and .services[0].deploymentConfiguration.alarms == {
      alarmNames:[$alarm], rollback:true, enable:true
    }
    and .services[0].deploymentConfiguration.deploymentCircuitBreaker.enable == true
    and .services[0].deploymentConfiguration.deploymentCircuitBreaker.rollback == true
    and (.services[0].deploymentConfiguration.bakeTimeInMinutes | type) == "number"
    and (.services[0].deploymentConfiguration.canaryConfiguration.canaryBakeTimeInMinutes | type) == "number"
  ' <<< "$snapshot" >/dev/null
}

uat_fast_rollout_configuration() {
  jq -cS '
    .services[0].deploymentConfiguration
    | .bakeTimeInMinutes = 0
    | .canaryConfiguration.canaryBakeTimeInMinutes = 0
  ' <<< "$1"
}

verify_uat_fast_rollout_configuration() {
  local service_name="$1" snapshot desired actual
  [ "${DEPLOY_ENV:-}" = uat ] || return 0
  # ECS Express can report the exact deployment SUCCESSFUL a few seconds before the
  # standard ECS service view removes the draining deployment. Wait for both views to
  # converge before enforcing the steady-state canary/rollback contract.
  aws_cmd ecs wait services-stable \
    --cluster "$CLUSTER_NAME" --services "$service_name" --region "$REGION" || return $?
  snapshot="$(uat_fast_rollout_snapshot "$service_name")" || return $?
  validate_uat_fast_rollout_snapshot "$service_name" "$snapshot" || {
    echo "ERROR: UAT service $service_name is not stable with the reviewed canary/rollback controls" >&2
    return 1
  }
  desired="$(uat_fast_rollout_configuration "$snapshot")"
  actual="$(jq -cS '.services[0].deploymentConfiguration' <<< "$snapshot")"
  [ "$actual" = "$desired" ] || {
    echo "ERROR: UAT fast-canary configuration did not persist for $service_name" >&2
    return 1
  }
}

ensure_uat_fast_rollout_configuration() {
  local service_name="$1" snapshot desired actual updated
  [ "${DEPLOY_ENV:-}" = uat ] || return 0
  snapshot="$(uat_fast_rollout_snapshot "$service_name")" || return $?
  validate_uat_fast_rollout_snapshot "$service_name" "$snapshot" || {
    echo "ERROR: refusing to change rollout timing for an unstable or drifted UAT service: $service_name" >&2
    return 1
  }
  desired="$(uat_fast_rollout_configuration "$snapshot")"
  actual="$(jq -cS '.services[0].deploymentConfiguration' <<< "$snapshot")"
  if [ "$actual" != "$desired" ]; then
    updated="$(aws_cmd ecs update-service \
      --cluster "$CLUSTER_NAME" --service "$service_name" \
      --deployment-configuration "$desired" \
      --query 'service.deploymentConfiguration' --output json --region "$REGION")" || return $?
    [ "$(jq -cS . <<< "$updated")" = "$desired" ] || {
      echo "ERROR: ECS returned a different fast-canary configuration for $service_name" >&2
      return 1
    }
    aws_cmd ecs wait services-stable \
      --cluster "$CLUSTER_NAME" --services "$service_name" --region "$REGION" || return $?
  fi
  verify_uat_fast_rollout_configuration "$service_name"
}
