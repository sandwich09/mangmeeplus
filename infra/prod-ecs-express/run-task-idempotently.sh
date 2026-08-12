#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 4 ] || [ "$2" != -- ] || [ "$3" != ecs ] || [ "$4" != run-task ]; then
  echo 'Usage: run-task-idempotently.sh <client-token> -- ecs run-task <arguments...>' >&2
  exit 2
fi

client_token="$1"
shift 2
[[ "$client_token" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || {
  echo 'ERROR: ECS RunTask client token must be 1-64 safe ASCII characters' >&2
  exit 2
}
for argument in "$@"; do
  [ "$argument" != --client-token ] || {
    echo 'ERROR: caller must not supply a second ECS RunTask client token' >&2
    exit 2
  }
done

aws_bin="${AWS_BIN:-aws}"
max_attempts="${RUN_TASK_IDEMPOTENT_ATTEMPTS:-9}"
delay="${RUN_TASK_IDEMPOTENT_INITIAL_DELAY_SECONDS:-2}"
max_delay="${RUN_TASK_IDEMPOTENT_MAX_DELAY_SECONDS:-90}"
deadline_seconds="${RUN_TASK_IDEMPOTENT_DEADLINE_SECONDS:-300}"
[[ "$max_attempts" =~ ^[1-9][0-9]*$ ]] && [ "$max_attempts" -le 20 ]
[[ "$delay" =~ ^[0-9]+$ ]] && [ "$delay" -le 300 ]
[[ "$max_delay" =~ ^[0-9]+$ ]] && [ "$max_delay" -le 300 ]
[[ "$deadline_seconds" =~ ^[1-9][0-9]*$ ]] && [ "$deadline_seconds" -le 600 ]
deadline=$(( $(date -u +%s) + deadline_seconds ))

cluster=''
task_definition=''
started_by=''
region=''
network_configuration=''
arguments=("$@")
for ((index=0; index<${#arguments[@]}; index+=1)); do
  case "${arguments[$index]}" in
    --cluster) cluster="${arguments[$((index+1))]:-}" ;;
    --task-definition) task_definition="${arguments[$((index+1))]:-}" ;;
    --started-by) started_by="${arguments[$((index+1))]:-}" ;;
    --region) region="${arguments[$((index+1))]:-}" ;;
    --network-configuration) network_configuration="${arguments[$((index+1))]:-}" ;;
  esac
done
[[ "$cluster" =~ ^[A-Za-z0-9_-]{1,255}$ ]]
[[ "$task_definition" =~ ^arn:aws[a-zA-Z-]*:ecs:[a-z0-9-]+:[0-9]{12}:task-definition/[A-Za-z0-9_-]{1,255}:[1-9][0-9]*$ ]]
[[ "$started_by" =~ ^[A-Za-z0-9_/-]{1,36}$ ]]
[[ "$region" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$ ]]
expected_subnets="$(jq -cer '
  .awsvpcConfiguration.subnets
  |select(type=="array" and length>=1 and length<=16
    and all(.[];type=="string" and test("^subnet-[0-9a-f]{8,17}$")))
  |sort|unique' <<< "$network_configuration")"
family="${task_definition##*/}"
family="${family%:*}"

work="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-run-task.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=2 \
    "$aws_bin" "$@"
}

matching_task() {
  local running stopped candidates described matches='[]' count offset chunk
  running="$(aws_cmd ecs list-tasks --cluster "$cluster" --started-by "$started_by" \
    --region "$region" --output json)" || return 2
  # ECS forbids combining startedBy with another filter. Search recent stopped tasks by the exact
  # family, then bind their startedBy and full task-definition ARN through DescribeTasks.
  stopped="$(aws_cmd ecs list-tasks --cluster "$cluster" --family "$family" \
    --desired-status STOPPED --region "$region" --output json)" || return 2
  jq -e 'type=="object" and (.taskArns|type)=="array"
    and all(.taskArns[];type=="string") and ((.nextToken//"")|type)=="string"' \
    <<< "$running" >/dev/null || return 2
  jq -e 'type=="object" and (.taskArns|type)=="array"
    and all(.taskArns[];type=="string") and ((.nextToken//"")|type)=="string"' \
    <<< "$stopped" >/dev/null || return 2
  candidates="$(jq -cn --argjson running "$running" --argjson stopped "$stopped" \
    '$running.taskArns+$stopped.taskArns|unique')"
  count="$(jq 'length' <<< "$candidates")"
  [ "$count" -gt 0 ] || return 3
  for ((offset=0; offset<count; offset+=100)); do
    chunk="$(jq -r --argjson start "$offset" '.[$start:$start+100][]' <<< "$candidates")"
    # shellcheck disable=SC2086 # validated task ARNs are passed as the CLI's variadic task list.
    described="$(aws_cmd ecs describe-tasks --cluster "$cluster" --tasks $chunk \
      --region "$region" --output json)" || return 2
    matches="$(jq -cn --argjson current "$matches" --arg startedBy "$started_by" \
      --arg definition "$task_definition" --argjson subnets "$expected_subnets" \
      --argjson described "$described" '
        if ($described|type)!="object" or ($described.tasks|type)!="array"
          or ($described.failures|type)!="array" or ($described.failures|length)!=0
        then error("malformed DescribeTasks response")
        else $current+[$described.tasks[]
          |select(.startedBy==$startedBy and .taskDefinitionArn==$definition
            and any(.attachments[]?.details[]?;
              .name=="subnetId" and (.value as $value|any($subnets[];.==$value))))] end
      ')" || return 2
  done
  case "$(jq 'length' <<< "$matches")" in
    0) return 3 ;;
    1) jq -cn --argjson matches "$matches" '{tasks:$matches,failures:[]}' ;;
    *) return 4 ;;
  esac
}

# Prove reconciliation authority before mutation and recover a task left by the same logical
# request. This closes accepted-but-response-lost outcomes across controller/process retries.
if recovered="$(matching_task)"; then
  printf '%s\n' "$recovered"
  exit 0
else
  match_status=$?
  if [ "$match_status" -ne 3 ]; then
    echo 'ERROR: ECS task reconciliation authority or identity is unavailable before RunTask' >&2
    exit "$match_status"
  fi
fi

for ((attempt=1; attempt<=max_attempts; attempt+=1)); do
  if [ "$(date -u +%s)" -ge "$deadline" ]; then
    if recovered="$(matching_task 2>/dev/null)"; then
      printf '%s\n' "$recovered"
      exit 0
    fi
    echo 'ERROR: idempotent ECS RunTask exceeded its bounded retry window' >&2
    exit "${status:-1}"
  fi
  : > "$work/output.json"
  : > "$work/error.txt"
  status=0
  aws_cmd "$@" --client-token "$client_token" --cli-connect-timeout 5 --cli-read-timeout 10 \
    > "$work/output.json" 2> "$work/error.txt" || status=$?
  if [ "$status" -eq 0 ]; then
    if jq -e 'type=="object" and (.tasks|type)=="array" and (.failures|type)=="array"' \
        "$work/output.json" >/dev/null; then
      cat "$work/output.json"
      exit 0
    fi
    echo 'ERROR: ECS RunTask returned malformed JSON; reconciling the stable request identity' >&2
    status=1
  fi
  cat "$work/error.txt" >&2
  if recovered="$(matching_task 2>/dev/null)"; then
    printf '%s\n' "$recovered"
    exit 0
  else
    match_status=$?
    if [ "$match_status" -eq 4 ]; then
      echo 'ERROR: ECS task reconciliation found more than one task for one logical request' >&2
      exit 1
    fi
  fi
  now="$(date -u +%s)"
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "ERROR: idempotent ECS RunTask did not return its result after $max_attempts attempts" >&2
    exit "$status"
  fi
  if [ "$now" -ge "$deadline" ]; then
    echo 'ERROR: idempotent ECS RunTask exceeded its bounded retry window' >&2
    exit "$status"
  fi
  echo "[run-task] response unavailable; retrying the same client token ($((attempt+1))/$max_attempts) in ${delay}s" >&2
  remaining=$((deadline-now))
  sleep_for="$delay"
  [ "$sleep_for" -le "$remaining" ] || sleep_for="$remaining"
  [ "$sleep_for" -eq 0 ] || sleep "$sleep_for"
  delay=$((delay*2))
  [ "$delay" -le "$max_delay" ] || delay="$max_delay"
done
