#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 10 ]; then
  echo 'Usage: cleanup-one-shot-task.sh <account> <region> <cluster> <family> <started-by> <registration-requested> <task-definition-arn|-> <run-requested> <task-arn|-> <stop-reason>' >&2
  exit 2
fi

account_id="$1"
region="$2"
cluster="$3"
family="$4"
started_by="$5"
registration_requested="$6"
task_definition_arn="$7"
run_requested="$8"
task_arn="$9"
stop_reason="${10}"
aws_bin="${AWS_BIN:-aws}"
visibility_checks="${ONE_SHOT_CLEANUP_VISIBILITY_CHECKS:-61}"
visibility_delay="${ONE_SHOT_CLEANUP_VISIBILITY_DELAY_SECONDS:-5}"
stable_empty_checks="${ONE_SHOT_CLEANUP_STABLE_EMPTY_CHECKS:-3}"
stable_delay="${ONE_SHOT_CLEANUP_STABLE_DELAY_SECONDS:-1}"

[[ "$account_id" =~ ^[0-9]{12}$ ]]
[[ "$region" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$ ]]
[[ "$cluster" =~ ^[A-Za-z0-9_-]{1,255}$ ]]
[[ "$family" =~ ^[A-Za-z0-9_-]{1,255}$ ]]
[[ "$started_by" =~ ^[A-Za-z0-9_/-]{1,36}$ ]]
[[ "$stop_reason" =~ ^[A-Za-z0-9_./:=+@-]{1,255}$ ]]
case "$registration_requested:$run_requested" in
  true:true|true:false|false:false) ;;
  *) exit 2 ;;
esac
[[ "$visibility_checks" =~ ^[1-9][0-9]*$ ]] && [ "$visibility_checks" -le 120 ]
[[ "$visibility_delay" =~ ^[0-9]+$ ]] && [ "$visibility_delay" -le 10 ]
[[ "$stable_empty_checks" =~ ^[1-9][0-9]*$ ]] && [ "$stable_empty_checks" -le 10 ]
[[ "$stable_delay" =~ ^[0-9]+$ ]] && [ "$stable_delay" -le 10 ]

definition_pattern="^arn:aws[a-zA-Z-]*:ecs:${region}:${account_id}:task-definition/${family}:[1-9][0-9]*$"
task_pattern="^arn:aws[a-zA-Z-]*:ecs:${region}:${account_id}:task/${cluster}/[A-Za-z0-9_-]+$"
cluster_arn="arn:aws:ecs:${region}:${account_id}:cluster/${cluster}"
[ "$task_definition_arn" = - ] || [[ "$task_definition_arn" =~ $definition_pattern ]]
[ "$task_arn" = - ] || [[ "$task_arn" =~ $task_pattern ]]
$registration_requested || [ "$task_definition_arn" = - ]
$run_requested || [ "$task_arn" = - ]
if $run_requested; then
  [ "$task_definition_arn" != - ]
fi

if ! $registration_requested && ! $run_requested; then
  exit 0
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-one-shot-cleanup.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=2 "$aws_bin" "$@"
}

matching_tasks() {
  local running stopped candidates described='{"failures":[],"tasks":[]}' page chunk count offset
  running="$(aws_cmd ecs list-tasks --region "$region" --cluster "$cluster" \
    --started-by "$started_by" --output json)" || return 2
  stopped="$(aws_cmd ecs list-tasks --region "$region" --cluster "$cluster" --family "$family" \
    --desired-status STOPPED --output json)" || return 2
  jq -e 'type=="object" and (.taskArns|type)=="array" and all(.taskArns[];type=="string")' \
    <<< "$running" >/dev/null || return 2
  jq -e 'type=="object" and (.taskArns|type)=="array" and all(.taskArns[];type=="string")' \
    <<< "$stopped" >/dev/null || return 2
  candidates="$(jq -cn --argjson running "$running" --argjson stopped "$stopped" \
    --arg known "$task_arn" '$running.taskArns+$stopped.taskArns
      +(if $known=="-" then [] else [$known] end)|unique')" || return 2
  count="$(jq 'length' <<< "$candidates")"
  if [ "$count" -gt 0 ]; then
    for ((offset=0; offset<count; offset+=100)); do
      chunk="$(jq -r --argjson start "$offset" '.[$start:$start+100][]' <<< "$candidates")"
      # shellcheck disable=SC2086 # ECS task ARNs are validated below and form one variadic list.
      page="$(aws_cmd ecs describe-tasks --region "$region" --cluster "$cluster" \
        --tasks $chunk --output json)" || return 2
      described="$(jq -cn --argjson current "$described" --argjson page "$page" '
        if ($page|type)!="object" or ($page.tasks|type)!="array"
          or ($page.failures|type)!="array" then error("malformed DescribeTasks response")
        else {tasks:($current.tasks+$page.tasks),failures:($current.failures+$page.failures)} end
      ')" || return 2
    done
  fi
  jq -e --argjson candidates "$candidates" --arg cluster "$cluster_arn" \
    --arg taskPattern "$task_pattern" --arg started "$started_by" --arg group "family:$family" \
    --arg definition "$task_definition_arn" --arg familyDefinitionPattern "$definition_pattern" '
      (([.tasks[].taskArn]+[.failures[].arn])|sort)==($candidates|sort)
      and all($candidates[];test($taskPattern))
      and all(.failures[];.reason=="MISSING")
      and all(.tasks[];.clusterArn==$cluster and (.taskArn|test($taskPattern))
        and .startedBy==$started and .group==$group
        and (if $definition=="-" then (.taskDefinitionArn|test($familyDefinitionPattern))
          else .taskDefinitionArn==$definition end))
    ' <<< "$described" >/dev/null || return 4
  jq -c '{seen:((.tasks|length)>0),
    collision:((.tasks|length)>1),
    active:[.tasks[]|select((.lastStatus//"")!="STOPPED" or (.desiredStatus//"")!="STOPPED")|.taskArn]}' \
    <<< "$described"
}

cleanup_tasks() {
  local resolved=false empty=0 state active_count arn status delay max_checks cleanup_failed=false
  local collision=false
  tasks_quiescent=false
  task_semantic_failure=false
  local -a active=()
  if ! $run_requested; then
    tasks_quiescent=true
    return 0
  fi
  max_checks=$((visibility_checks+stable_empty_checks))
  for ((check=1; check<=max_checks; check+=1)); do
    status=0
    state="$(matching_tasks 2>"$work/tasks.err")" || status=$?
    if [ "$status" -eq 4 ]; then
      cat "$work/tasks.err" >&2
      echo 'ERROR: one-shot task cleanup found a task outside the exact request identity' >&2
      return 1
    elif [ "$status" -ne 0 ]; then
      cat "$work/tasks.err" >&2
      empty=0
    else
      if [ "$(jq -r '.seen' <<< "$state")" = true ]; then resolved=true; fi
      if [ "$(jq -r '.collision' <<< "$state")" = true ]; then collision=true; fi
      active_count="$(jq '.active|length' <<< "$state")"
      if [ "$active_count" -eq 0 ]; then
        if $resolved || [ "$check" -gt "$visibility_checks" ]; then
          empty=$((empty+1))
        else
          empty=0
        fi
        if [ "$empty" -ge "$stable_empty_checks" ]; then
          tasks_quiescent=true
          if $cleanup_failed || $collision; then task_semantic_failure=true; fi
          return 0
        fi
      else
        empty=0
        active=()
        while IFS= read -r arn; do active+=("$arn"); done < <(jq -r '.active[]' <<< "$state")
        for arn in "${active[@]}"; do
          if ! aws_cmd ecs stop-task --region "$region" --cluster "$cluster" --task "$arn" \
              --reason "$stop_reason" >/dev/null 2>"$work/stop.err"; then
            cat "$work/stop.err" >&2
            cleanup_failed=true
          fi
        done
        if ! aws_cmd ecs wait tasks-stopped --region "$region" --cluster "$cluster" \
            --tasks "${active[@]}" >/dev/null 2>"$work/wait.err"; then
          cat "$work/wait.err" >&2
          cleanup_failed=true
        fi
      fi
    fi
    [ "$check" -lt "$max_checks" ] || break
    if $resolved; then delay="$stable_delay"; else delay="$visibility_delay"; fi
    [ "$delay" -eq 0 ] || sleep "$delay"
  done
  $cleanup_failed || {
    echo 'ERROR: one-shot task cleanup did not prove a stable empty exact task set' >&2
    return 1
  }
  echo 'ERROR: one-shot task cleanup encountered an AWS cleanup failure' >&2
  return 1
}

active_task_definitions() {
  local listed active described status seen=false
  listed="$(aws_cmd ecs list-task-definitions --region "$region" --family-prefix "$family" \
    --status ACTIVE --output json)" || return 2
  jq -e 'type=="object" and (.taskDefinitionArns|type)=="array"
    and all(.taskDefinitionArns[];type=="string")' <<< "$listed" >/dev/null || return 2
  active="$(jq -ce --arg family "$family" --arg pattern "$definition_pattern" '
    [.taskDefinitionArns[]|select((split("/")[-1]|split(":")[0])==$family)] as $exact
    |if all($exact[];test($pattern)) then $exact else error("invalid task-definition ARN") end
  ' <<< "$listed")" || return 4
  if [ "$task_definition_arn" != - ]; then
    described="$(aws_cmd ecs describe-task-definition --region "$region" \
      --task-definition "$task_definition_arn" --output json)" || return 2
    status="$(jq -er --arg arn "$task_definition_arn" --arg family "$family" '
      .taskDefinition|select(.taskDefinitionArn==$arn and .family==$family)
      |.status|select(.=="ACTIVE" or .=="INACTIVE")
    ' <<< "$described")" || return 4
    seen=true
    if [ "$status" = ACTIVE ]; then
      active="$(jq -cn --argjson active "$active" --arg arn "$task_definition_arn" \
        '$active+[$arn]|unique')"
    else
      active="$(jq -cn --argjson active "$active" --arg arn "$task_definition_arn" \
        '$active|map(select(.!=$arn))')"
    fi
  elif [ "$(jq 'length' <<< "$active")" -gt 0 ]; then
    seen=true
  fi
  jq -cn --argjson seen "$seen" --argjson active "$active" \
    '{seen:$seen,collision:(($active|length)>1),active:$active}'
}

cleanup_task_definitions() {
  local resolved=false empty=0 state count arn status delay max_checks cleanup_failed=false
  local collision=false
  $registration_requested || return 0
  max_checks=$((visibility_checks+stable_empty_checks))
  for ((check=1; check<=max_checks; check+=1)); do
    status=0
    state="$(active_task_definitions 2>"$work/definitions.err")" || status=$?
    if [ "$status" -eq 4 ]; then
      cat "$work/definitions.err" >&2
      echo 'ERROR: one-shot cleanup found an invalid exact-family task definition' >&2
      return 1
    elif [ "$status" -ne 0 ]; then
      cat "$work/definitions.err" >&2
      empty=0
    else
      if [ "$(jq -r '.seen' <<< "$state")" = true ]; then resolved=true; fi
      if [ "$(jq -r '.collision' <<< "$state")" = true ]; then collision=true; fi
      count="$(jq '.active|length' <<< "$state")"
      if [ "$count" -eq 0 ]; then
        if $resolved || [ "$check" -gt "$visibility_checks" ]; then
          empty=$((empty+1))
        else
          empty=0
        fi
        if [ "$empty" -ge "$stable_empty_checks" ]; then
          if $cleanup_failed || $collision; then return 1; else return 0; fi
        fi
      else
        resolved=true
        empty=0
        while IFS= read -r arn; do
          if ! aws_cmd ecs deregister-task-definition --region "$region" --task-definition "$arn" \
              >/dev/null 2>"$work/deregister.err"; then
            cat "$work/deregister.err" >&2
            cleanup_failed=true
          fi
        done < <(jq -r '.active[]' <<< "$state")
      fi
    fi
    [ "$check" -lt "$max_checks" ] || break
    if $resolved; then delay="$stable_delay"; else delay="$visibility_delay"; fi
    [ "$delay" -eq 0 ] || sleep "$delay"
  done
  if $cleanup_failed; then
    echo 'ERROR: one-shot task-definition cleanup encountered an AWS cleanup failure' >&2
  else
    echo 'ERROR: one-shot cleanup did not prove a stable empty exact task-definition set' >&2
  fi
  return 1
}

cleanup_status=0
cleanup_tasks || cleanup_status=1
$tasks_quiescent && cleanup_task_definitions || cleanup_status=1
$task_semantic_failure && cleanup_status=1
exit "$cleanup_status"
