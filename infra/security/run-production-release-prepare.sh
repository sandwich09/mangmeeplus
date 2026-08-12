#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
runner="$script_dir/../prod-ecs-express/run-release-task.sh"

proxy_aws() {
  local real_aws="${PRODUCTION_RELEASE_PREPARE_REAL_AWS_BIN:-}"
  [ -n "$real_aws" ] && [ -x "$real_aws" ] || {
    echo 'ERROR: the release-prepare AWS proxy has no executable real AWS CLI' >&2
    exit 2
  }

  if [ "$#" -lt 3 ] || [ "$1" != ecs ] || [ "$2" != wait ] || [ "$3" != tasks-stopped ]; then
    exec "$real_aws" "$@"
  fi
  shift 3

  local deadline="${RELEASE_PREPARE_WAIT_DEADLINE_EPOCH:-}"
  [[ "$deadline" =~ ^[1-9][0-9]*$ ]] || {
    echo 'ERROR: the release-prepare waiter has no shared absolute deadline' >&2
    exit 2
  }

  local cluster='' region='' saw_tasks=false response expected_json
  local -a tasks=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --cluster)
        [ "$#" -ge 2 ] && [ -z "$cluster" ] || {
          echo 'ERROR: invalid duplicate or missing --cluster for the release-prepare waiter' >&2
          exit 2
        }
        cluster="$2"
        shift 2
        ;;
      --tasks)
        [ "$saw_tasks" = false ] || {
          echo 'ERROR: duplicate --tasks for the release-prepare waiter' >&2
          exit 2
        }
        saw_tasks=true
        shift
        while [ "$#" -gt 0 ] && [[ "$1" != --* ]]; do
          tasks+=("$1")
          shift
        done
        ;;
      --region)
        [ "$#" -ge 2 ] && [ -z "$region" ] || {
          echo 'ERROR: invalid duplicate or missing --region for the release-prepare waiter' >&2
          exit 2
        }
        region="$2"
        shift 2
        ;;
      *)
        echo "ERROR: unsupported release-prepare waiter argument: $1" >&2
        exit 2
        ;;
    esac
  done

  [[ "$cluster" =~ ^[A-Za-z0-9_-]+$ ]] || {
    echo 'ERROR: invalid release-prepare ECS cluster' >&2
    exit 2
  }
  [[ "$region" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$ ]] || {
    echo 'ERROR: invalid release-prepare AWS region' >&2
    exit 2
  }
  [ "$saw_tasks" = true ] && [ "${#tasks[@]}" -ge 1 ] && [ "${#tasks[@]}" -le 100 ] || {
    echo 'ERROR: release-prepare waiter requires between 1 and 100 task ARNs' >&2
    exit 2
  }
  local task
  for task in "${tasks[@]}"; do
    [[ "$task" =~ ^arn:aws[a-zA-Z-]*:ecs:[a-z0-9-]+:[0-9]{12}:task/[A-Za-z0-9._/-]+$ ]] || {
      echo "ERROR: invalid release-prepare ECS task ARN: $task" >&2
      exit 2
    }
  done

  local attempts="${RELEASE_PREPARE_WAIT_ATTEMPTS:-421}"
  local delay="${RELEASE_PREPARE_WAIT_SECONDS:-5}"
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] && [ "$attempts" -le 1000 ] || {
    echo 'ERROR: RELEASE_PREPARE_WAIT_ATTEMPTS must be between 1 and 1000' >&2
    exit 2
  }
  [[ "$delay" =~ ^[0-9]+$ ]] && [ "$delay" -le 60 ] || {
    echo 'ERROR: RELEASE_PREPARE_WAIT_SECONDS must be between 0 and 60' >&2
    exit 2
  }
  expected_json="$(printf '%s\n' "${tasks[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')"

  local wait_work describe_out describe_err aws_pid aws_status now remaining sleep_for
  wait_work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-prepare-wait.XXXXXX")"
  describe_out="$wait_work/describe.json"
  describe_err="$wait_work/describe.err"
  trap 'rm -rf -- "$wait_work"' EXIT

  local check
  for ((check = 1; check <= attempts; check += 1)); do
    now="$(date -u +%s)"
    if [ "$now" -ge "$deadline" ]; then
      echo 'ERROR: release-prepare ECS task wait reached its shared 35-minute deadline' >&2
      exit 255
    fi

    : > "$describe_out"
    : > "$describe_err"
    AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=2 \
      "$real_aws" ecs describe-tasks --cluster "$cluster" \
        --tasks "${tasks[@]}" --region "$region" \
        --cli-connect-timeout 5 --cli-read-timeout 10 \
        > "$describe_out" 2> "$describe_err" &
    aws_pid=$!
    while kill -0 "$aws_pid" 2>/dev/null; do
      now="$(date -u +%s)"
      if [ "$now" -ge "$deadline" ]; then
        kill -KILL "$aws_pid" 2>/dev/null || true
        wait "$aws_pid" 2>/dev/null || true
        echo 'ERROR: release-prepare ECS task wait reached its shared 35-minute deadline' >&2
        exit 255
      fi
      sleep 1
    done
    aws_status=0
    wait "$aws_pid" || aws_status=$?
    if [ "$aws_status" -ne 0 ]; then
      cat "$describe_err" >&2
      echo 'ERROR: ECS describe-tasks failed while waiting for release-prepare' >&2
      exit 1
    fi
    response="$(< "$describe_out")"
    jq -e 'type == "object" and (.tasks | type == "array") and (.failures | type == "array")' \
      <<< "$response" >/dev/null || {
      echo 'ERROR: malformed ECS describe-tasks response while waiting for release-prepare' >&2
      exit 1
    }
    if ! jq -e --argjson expected "$expected_json" '
        all(.failures[];
          .reason == "MISSING" and (.arn | type == "string")
          and (.arn as $arn | $expected | index($arn) != null))
      ' <<< "$response" >/dev/null; then
      echo 'ERROR: ECS reported a terminal or foreign task lookup failure during release-prepare' >&2
      jq -c '{failures}' <<< "$response" >&2
      exit 1
    fi
    jq -e --argjson expected "$expected_json" '
      [.tasks[].taskArn] as $observed
      | [.failures[].arn] as $missing
      | (($observed + $missing) | length) == (($observed + $missing) | unique | length)
      and all($observed[]; . as $arn | $expected | index($arn) != null)
      and all(.tasks[];
        .lastStatus as $status
        | ["PROVISIONING","PENDING","ACTIVATING","RUNNING","DEACTIVATING","STOPPING","DEPROVISIONING","STOPPED"]
        | index($status) != null)
    ' <<< "$response" >/dev/null || {
      echo 'ERROR: ECS returned an unexpected task identity or lifecycle status during release-prepare' >&2
      jq -c '{tasks:[.tasks[]|{taskArn,lastStatus}]}' <<< "$response" >&2
      exit 1
    }
    if jq -e --argjson expected "$expected_json" '
      ([.tasks[].taskArn] | sort) == ($expected | sort)
      and all(.tasks[]; .lastStatus == "STOPPED")
    ' <<< "$response" >/dev/null; then
      exit 0
    fi
    if [ "$check" -lt "$attempts" ]; then
      now="$(date -u +%s)"
      remaining=$((deadline - now))
      [ "$remaining" -gt 0 ] || {
        echo 'ERROR: release-prepare ECS task wait reached its shared 35-minute deadline' >&2
        exit 255
      }
      sleep_for="$delay"
      [ "$sleep_for" -le "$remaining" ] || sleep_for="$remaining"
      [ "$sleep_for" -eq 0 ] || sleep "$sleep_for"
    fi
  done

  echo "ERROR: release-prepare ECS task wait exceeded $attempts checks at ${delay}s intervals" >&2
  jq -c '{tasks:[.tasks[]|{taskArn,lastStatus}]}' <<< "$response" >&2
  exit 255
}

if [ "${PRODUCTION_RELEASE_PREPARE_AWS_PROXY:-false}" = true ]; then
  proxy_aws "$@"
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <watchdog-bms-api@sha256:digest> <full-commit-sha>" >&2
  exit 2
fi

real_aws="${AWS_BIN:-aws}"
real_aws="$(command -v "$real_aws")" || {
  echo "ERROR: AWS CLI is not executable: $real_aws" >&2
  exit 2
}
[ "$real_aws" != "$script_dir/run-production-release-prepare.sh" ] || {
  echo 'ERROR: release-prepare AWS proxy cannot wrap itself' >&2
  exit 2
}

export PRODUCTION_RELEASE_PREPARE_AWS_PROXY=true
export PRODUCTION_RELEASE_PREPARE_REAL_AWS_BIN="$real_aws"
export RELEASE_PREPARE_WAIT_DEADLINE_EPOCH="$(( $(date -u +%s) + 35 * 60 ))"
export AWS_BIN="$script_dir/run-production-release-prepare.sh"
exec bash "$runner" "$1" "$2" release-prepare
