#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <task-definition-json> <aws-region>" >&2
  exit 2
fi

task_definition="$1"
region="$2"
aws_bin="${AWS_BIN:-aws}"
max_attempts=5
attempt=1
error_file="$(mktemp "${TMPDIR:-/tmp}/watchdog-bms-register-task.XXXXXX")"
trap 'rm -f "$error_file"' EXIT
family="$(jq -er '.family|select(test("^[A-Za-z0-9_-]{1,255}$"))' "$task_definition")"
recovery_attempts="${REGISTER_TASK_RECOVERY_ATTEMPTS:-61}"
recovery_delay="${REGISTER_TASK_RECOVERY_DELAY_SECONDS:-5}"
scan_limit="${REGISTER_TASK_SCAN_LIMIT:-20}"
[[ "$recovery_attempts" =~ ^[1-9][0-9]*$ ]] && [ "$recovery_attempts" -le 120 ]
[[ "$recovery_delay" =~ ^[0-9]+$ ]] && [ "$recovery_delay" -le 60 ]
[[ "$scan_limit" =~ ^[1-9][0-9]*$ ]] && [ "$scan_limit" -le 100 ]
definition_arn_pattern="^arn:aws[a-zA-Z-]*:ecs:${region}:[0-9]{12}:task-definition/${family}:[1-9][0-9]*$"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

matching_registration() {
  local definitions arn described matches='[]'
  definitions="$(aws_cmd ecs list-task-definitions --family-prefix "$family" --status ACTIVE \
    --sort DESC --max-items "$scan_limit" --query taskDefinitionArns --output json --region "$region")" || return 2
  jq -e 'type=="array" and all(.[];type=="string")' <<< "$definitions" >/dev/null || return 2
  while IFS= read -r arn; do
    [[ "$arn" =~ $definition_arn_pattern ]] || continue
    described="$(aws_cmd ecs describe-task-definition --task-definition "$arn" \
      --include TAGS --output json --region "$region")" || return 2
    if jq -e --slurpfile expected "$task_definition" '
        def prune_empty:
          if type=="object" then
            with_entries(.value|=prune_empty)
            |with_entries(select(.value!=null and .value!=[] and .value!={}))
          elif type=="array" then map(prune_empty)
          else . end;
        def normalize_container($wanted):
          if (($wanted|has("cpu")|not) and .cpu==0) then del(.cpu) else . end
          |if (($wanted|has("memory")|not) and .memory==0) then del(.memory) else . end
          |if (($wanted|has("memoryReservation")|not) and .memoryReservation==0)
            then del(.memoryReservation) else . end
          |if (($wanted|has("essential")|not) and .essential==true)
            then del(.essential) else . end
          |reduce ["disableNetworking","privileged","readonlyRootFilesystem",
              "interactive","pseudoTerminal"][] as $key
            (.;if (($wanted|has($key)|not) and .[$key]==false) then del(.[$key]) else . end)
          |if (($wanted|has("versionConsistency")|not) and .versionConsistency=="enabled")
            then del(.versionConsistency) else . end;
        ($expected[0]|del(.tags)) as $wanted
        |(.taskDefinition
          |del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,
            .registeredAt,.registeredBy,.deregisteredAt)
          |if (($wanted|has("enableFaultInjection")|not) and .enableFaultInjection==false)
            then del(.enableFaultInjection) else . end
          |if ((.containerDefinitions|type)=="array"
              and (.containerDefinitions|length)==($wanted.containerDefinitions|length)) then
            .containerDefinitions=[range(0;(.containerDefinitions|length)) as $index
              |.containerDefinitions[$index]
              |normalize_container($wanted.containerDefinitions[$index])]
            else . end
          |prune_empty) as $actual
        |$actual==($wanted|prune_empty)
          and ((.tags//[])|sort_by(.key,.value))
            == (($expected[0].tags//[])|sort_by(.key,.value))
      ' <<< "$described" >/dev/null; then
      matches="$(jq -cn --argjson current "$matches" --arg arn "$arn" '$current+[$arn]')"
    fi
  done < <(jq -r --arg family "$family" '.[]
    |select((split("/")[-1]|split(":")[0])==$family)' <<< "$definitions")
  [ "$(jq 'length' <<< "$matches")" -ge 1 ] || return 3
  jq -er '.[0]' <<< "$matches"
}

# Reuse an exact ACTIVE definition left by a prior interrupted controller. RegisterTaskDefinition
# has no client token; content reconciliation is its idempotency boundary.
if recovered="$(matching_registration)"; then
  printf '%s\n' "$recovered"
  exit 0
else
  match_status=$?
  if [ "$match_status" -ne 3 ]; then
    echo 'ERROR: task-definition reconciliation authority is unavailable before registration' >&2
    exit "$match_status"
  fi
fi

while :; do
  if task_definition_arn="$(aws_cmd ecs register-task-definition \
    --cli-input-json "file://$task_definition" \
    --query taskDefinition.taskDefinitionArn --output text --region "$region" \
    2>"$error_file")"; then
    [[ "$task_definition_arn" =~ $definition_arn_pattern ]] || {
      echo 'ERROR: RegisterTaskDefinition returned an invalid task-definition ARN' >&2
      exit 1
    }
    printf '%s\n' "$task_definition_arn"
    exit 0
  else
    status=$?
  fi
  cat "$error_file" >&2
  if ! grep -Fq 'An error occurred (ClientException) when calling the RegisterTaskDefinition operation: Too many concurrent attempts to create a new revision of the specified family.' "$error_file"; then
    # The service may have accepted the definition before the response was lost. Never register a
    # second revision until the full eventual-consistency window has been searched by exact content.
    for ((check=1; check<=recovery_attempts; check+=1)); do
      if recovered="$(matching_registration 2>/dev/null)"; then
        printf '%s\n' "$recovered"
        exit 0
      fi
      [ "$check" -ge "$recovery_attempts" ] || [ "$recovery_delay" -eq 0 ] || sleep "$recovery_delay"
    done
    echo 'ERROR: task-definition registration outcome remains unknown after exact reconciliation' >&2
    exit "$status"
  fi
  if recovered="$(matching_registration 2>/dev/null)"; then
    printf '%s\n' "$recovered"
    exit 0
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[release-task] task-definition registration collision remained after $max_attempts attempts" >&2
    exit "$status"
  fi
  delay=$((1 << (attempt - 1)))
  echo "[release-task] transient task-definition registration collision; retry $((attempt + 1))/$max_attempts in ${delay}s" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
