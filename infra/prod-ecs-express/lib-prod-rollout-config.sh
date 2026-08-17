#!/usr/bin/env bash

# Production rollout timing, applied at the same call sites as the UAT fast-rollout helper.
# The canary/alarm/circuit-breaker shape is ONE contract for every environment
# (docs/specs/deploy-time-reduction-spec.md §3 invariant 4), so the shape validators, the snapshot
# read and the evidence projection are reused from lib-uat-fast-rollout.sh instead of copied - a
# second copy could drift away from the reviewed contract. Only the bake minutes are environment
# policy. Source lib-uat-fast-rollout.sh before this file.

prod_rollout_bake_policy() {
  # PRODUCTION_SERVING_MODE decides how much detection power a bake can actually deliver, so an
  # unset or unknown mode fails closed here instead of defaulting into either safety posture.
  case "${PRODUCTION_SERVING_MODE:-}" in
    maintenance_closed|maintenance_only)
      # No customer traffic: the target-group error-rate alarm has nothing real to observe, and its
      # TreatMissingData=notBreaching means a zero-traffic window cannot fire it either.
      printf '{"bakeTimeInMinutes":0,"canaryBakeTimeInMinutes":0}'
      ;;
    live)
      # Keep the post-shift window at 100% traffic: the RollbackAlarm needs 2 breaching one-minute
      # datapoints, so 3 minutes is the minimum meaningful bake. The 5% canary window cannot deliver
      # that detection at current traffic volume, so it costs time without buying safety.
      printf '{"bakeTimeInMinutes":3,"canaryBakeTimeInMinutes":0}'
      ;;
    *)
      echo "ERROR: PRODUCTION_SERVING_MODE must be maintenance_closed, maintenance_only or live to set production rollout timing" >&2
      return 2
      ;;
  esac
}

prod_rollout_configuration() {
  local policy
  policy="$(prod_rollout_bake_policy)" || return $?
  jq -cS --argjson policy "$policy" '
    .services[0].deploymentConfiguration
    | .bakeTimeInMinutes = $policy.bakeTimeInMinutes
    | .canaryConfiguration.canaryBakeTimeInMinutes = $policy.canaryBakeTimeInMinutes
  ' <<< "$1"
}

wait_for_prod_rollout_convergence() {
  local service_name="$1" snapshot desired actual evidence previous="" attempt
  local attempts="${PROD_ROLLOUT_POLL_ATTEMPTS:-12}"
  local delay="${PROD_ROLLOUT_POLL_SECONDS:-5}"
  [[ "$attempts" =~ ^[1-9][0-9]*$ && "$delay" =~ ^[0-9]+$ ]] || {
    echo "ERROR: production rollout polling controls are invalid" >&2
    return 2
  }
  for ((attempt=1; attempt<=attempts; attempt+=1)); do
    snapshot="$(uat_fast_rollout_snapshot "$service_name")" || return $?
    validate_uat_fast_rollout_controls "$service_name" "$snapshot" || {
      echo "ERROR: production service $service_name drifted from the reviewed canary/rollback controls" >&2
      return 1
    }
    desired="$(prod_rollout_configuration "$snapshot")" || return $?
    actual="$(jq -cS '.services[0].deploymentConfiguration' <<< "$snapshot")"
    [ "$actual" = "$desired" ] || {
      echo "ERROR: production rollout timing did not persist for $service_name" >&2
      return 1
    }
    if validate_uat_fast_rollout_snapshot "$service_name" "$snapshot"; then
      evidence="$(uat_fast_rollout_evidence "$snapshot")"
      if [ -n "$previous" ] && [ "$evidence" = "$previous" ]; then
        return 0
      fi
      previous="$evidence"
    elif validate_uat_fast_rollout_transition "$snapshot"; then
      previous=""
    else
      echo "ERROR: production service $service_name reported contradictory deployment state" >&2
      return 1
    fi
    [ "$attempt" -eq "$attempts" ] || [ "$delay" -eq 0 ] || sleep "$delay"
  done
  echo "ERROR: production service $service_name did not converge to two agreeing stable snapshots" >&2
  return 1
}

verify_prod_rollout_configuration() {
  local service_name="$1"
  [ "${DEPLOY_ENV:-}" = production ] || return 0
  # Same race UAT hit: ECS Express can report the exact deployment SUCCESSFUL a few seconds before
  # the standard ECS service view removes the draining deployment. Wait for both views to converge
  # before enforcing the steady-state timing and canary/rollback contract.
  aws_cmd ecs wait services-stable \
    --cluster "$CLUSTER_NAME" --services "$service_name" --region "$REGION" || return $?
  wait_for_prod_rollout_convergence "$service_name"
}

ensure_prod_rollout_configuration() {
  local service_name="$1" snapshot desired actual updated
  [ "${DEPLOY_ENV:-}" = production ] || return 0
  snapshot="$(uat_fast_rollout_snapshot "$service_name")" || return $?
  validate_uat_fast_rollout_snapshot "$service_name" "$snapshot" || {
    echo "ERROR: refusing to change rollout timing for an unstable or drifted production service: $service_name" >&2
    return 1
  }
  desired="$(prod_rollout_configuration "$snapshot")" || return $?
  actual="$(jq -cS '.services[0].deploymentConfiguration' <<< "$snapshot")"
  if [ "$actual" != "$desired" ]; then
    updated="$(aws_cmd ecs update-service \
      --cluster "$CLUSTER_NAME" --service "$service_name" \
      --deployment-configuration "$desired" \
      --query 'service.deploymentConfiguration' --output json --region "$REGION")" || return $?
    [ "$(jq -cS . <<< "$updated")" = "$desired" ] || {
      echo "ERROR: ECS returned a different rollout configuration for $service_name" >&2
      return 1
    }
    aws_cmd ecs wait services-stable \
      --cluster "$CLUSTER_NAME" --services "$service_name" --region "$REGION" || return $?
  fi
  verify_prod_rollout_configuration "$service_name"
}
