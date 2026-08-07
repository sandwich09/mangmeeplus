#!/usr/bin/env bash
# Wave-parallel managed rollouts for infra/prod-ecs-express/deploy.sh.
#
# Sourced, never executed: it only defines functions, so the caller keeps its own
# shell options, credentials and deploy_<service> definitions. Written for bash
# 3.2 (macOS workstations): no `wait -n`, no associative arrays.
#
# Spec: docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md §4.3

# Prefix one job's merged stdout+stderr so concurrent 10-minute bakes stay
# readable and a failed service is identifiable from the log. Pure bash keeps it
# line-buffered and live (`sed -u` is GNU-only, `sed -l` is BSD-only).
wave_prefix_stream() {
  local service="$1" line
  while IFS= read -r line || [ -n "$line" ]; do
    printf '[wave:%s] %s\n' "$service" "$line"
  done
}

# run_rollout_wave <service>...
# Runs deploy_<service> for every named service concurrently and waits for ALL of
# them to reach a terminal state. Siblings are never killed: the managed ECS
# deployment keeps running server-side either way, so killing one only blinds us
# to its outcome. Returns non-zero naming every service that failed.
run_rollout_wave() {
  local pending="" entry service pid rc failed=""

  if [ "$#" -eq 0 ]; then
    echo "[wave] ERROR: no services given" >&2
    return 2
  fi

  echo "[wave] start: $*"
  for service in "$@"; do
    # pipefail inside the job so the rollout's status survives the prefix pipe.
    ( set -o pipefail; "deploy_$(printf '%s' "$service" | tr '-' '_')" 2>&1 | wave_prefix_stream "$service" ) &
    pending="$pending $!:$service"
  done

  # shellcheck disable=SC2086 # deliberate word split; service names hold no spaces
  for entry in $pending; do
    pid="${entry%%:*}"
    service="${entry#*:}"
    rc=0
    wait "$pid" || rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "[wave] service failed: $service (exit $rc)" >&2
      failed="${failed}${failed:+ }$service"
    fi
  done

  if [ -n "$failed" ]; then
    echo "[wave] FAILED: $failed" >&2
    return 1
  fi
  echo "[wave] done: $*"
  return 0
}

# run_rollout_by_readiness <probe-fn> <wave-fn> <bootstrap-fn> [args...]
#
# A readiness probe has three outcomes: 0 means the steady-state wave is safe,
# 1 is the one intentional bootstrap fallback, and every other status is an
# operational failure. Keep that distinction outside an `if probe; then ...
# else ...` so an SSM/AWS failure can never start the sequential writer.
run_rollout_by_readiness() {
  local probe_fn="$1" wave_fn="$2" bootstrap_fn="$3" probe_status=0
  shift 3

  "$probe_fn" || probe_status=$?
  case "$probe_status" in
    0) "$wave_fn" "$@" ;;
    1) "$bootstrap_fn" "$@" ;;
    *)
      echo "[deploy-all] ERROR: wave readiness failed (exit $probe_status); no deployment was started" >&2
      return "$probe_status"
      ;;
  esac
}
