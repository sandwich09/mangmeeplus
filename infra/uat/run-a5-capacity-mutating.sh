#!/usr/bin/env bash
set -euo pipefail

# One-shot U5-C controller. It is callable only from the main-branch dedicated workflow; the exact
# preflight baseline and worker scaling are durably recorded before the first UAT mutation.
if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <uat-release-task-image@sha256:digest> <full-source-sha> <U5C-marker>" >&2
  exit 2
fi

release_image="$1"
source_sha="$2"
marker="$3"
approval_ref="${CONFIRM_U5_CAPACITY:-}"
expected_approval='owner-approved:2026-08-03:u5-c-v2'
authorization_file="${U5_CAPACITY_AUTHORIZATION_FILE:-}"
authorization_bundle="${U5_CAPACITY_AUTHORIZATION_BUNDLE:-}"
workload_manifest_hash="${U5_CAPACITY_WORKLOAD_MANIFEST_HASH:-}"
workflow_sha="${U5_CAPACITY_WORKFLOW_SHA:-}"
result_file="${U5_CAPACITY_RESULT_FILE:-}"
aws_bin="${AWS_BIN:-aws}"
region="${AWS_REGION:-ap-southeast-1}"
account_id="${AWS_ACCOUNT_ID:-}"
cluster='watchdog-bms-uat'
db_identifier='watchdog-bms-uat-db'
attempt_parameter='/watchdog-bms/uat/evidence/u5-capacity-v2'
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
capacity_started_by="u5c-${marker#U5C-}"
capacity_started_by="$(printf '%s' "$capacity_started_by" | tr '[:upper:]' '[:lower:]')"

[[ "$release_image" =~ ^[0-9]{12}\.dkr\.ecr\.${region}\.amazonaws\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$ ]] \
  || { echo 'ERROR: release image must be the immutable UAT API digest' >&2; exit 2; }
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'ERROR: source SHA must be full lowercase hex' >&2; exit 2; }
[[ "$marker" =~ ^U5C-[0-9A-F]{12,32}$ ]] || { echo 'ERROR: marker must be U5C-<12..32 uppercase hex>' >&2; exit 2; }
[ "$approval_ref" = "$expected_approval" ] || { echo 'ERROR: exact U5-C v2 owner approval is required' >&2; exit 2; }
[ "${DEPLOY_ENV:-uat}" = 'uat' ] || { echo 'ERROR: capacity controller is UAT-only' >&2; exit 2; }
[ "${GITHUB_ACTIONS:-}" = 'true' ] && [ "${GITHUB_REF:-}" = 'refs/heads/main' ] || {
  echo 'ERROR: U5-C is authorized only by the main-branch GitHub controller' >&2
  exit 2
}
expected_workflow_ref="${GITHUB_REPOSITORY:-}/.github/workflows/a5-capacity-uat.yml@refs/heads/main"
[ "${GITHUB_WORKFLOW_REF:-}" = "$expected_workflow_ref" ] || {
  echo "ERROR: U5-C must run from $expected_workflow_ref" >&2
  exit 2
}
[ "${GITHUB_ACTOR:-}" = MangmeeDev ] && [ "${GITHUB_TRIGGERING_ACTOR:-}" = MangmeeDev ] || {
  echo 'ERROR: only repository owner MangmeeDev may authorize or rerun U5-C' >&2
  exit 2
}
[[ "$workflow_sha" =~ ^[0-9a-f]{40}$ && "$workload_manifest_hash" =~ ^[0-9a-f]{64}$ ]] || {
  echo 'ERROR: immutable workflow/workload authorization binding is missing' >&2
  exit 2
}
[ -f "$authorization_file" ] && [ -f "$authorization_bundle" ] || {
  echo 'ERROR: signed U5-C authorization artifact is missing' >&2
  exit 2
}
[[ "$result_file" = /* ]] && [ -d "$(dirname "$result_file")" ] && [ ! -e "$result_file" ] || {
  echo 'ERROR: a fresh absolute U5_CAPACITY_RESULT_FILE is required' >&2
  exit 2
}
command -v cosign >/dev/null 2>&1 || { echo 'ERROR: cosign is required' >&2; exit 1; }
cosign verify-blob --bundle "$authorization_bundle" \
  --certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/a5-capacity-uat.yml@refs/heads/main" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --certificate-github-workflow-repository "$GITHUB_REPOSITORY" \
  --certificate-github-workflow-ref refs/heads/main \
  --certificate-github-workflow-sha "$workflow_sha" \
  --certificate-github-workflow-trigger workflow_dispatch "$authorization_file" >/dev/null
authorization_verified=true
authorization_hash="$(bash "$repo_root/infra/uat/validate-u5-capacity-authorization.sh" \
  "$authorization_file" "$source_sha" "$release_image" "$marker" "$workload_manifest_hash" \
  "$workflow_sha" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$GITHUB_ACTOR" \
  "$GITHUB_TRIGGERING_ACTOR" "$(date -u +%s)")"

aws_cmd() { "$aws_bin" "$@"; }
if [ -z "$account_id" ]; then
  account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
fi
[ "$account_id" = '311414082667' ] || { echo 'ERROR: unexpected AWS account' >&2; exit 2; }
[[ "$release_image" == "$account_id.dkr.ecr.$region.amazonaws.com/"* ]] \
  || { echo 'ERROR: release image belongs to another account/region' >&2; exit 2; }

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-u5-capacity.XXXXXX")"
preflight_log="$tmp_dir/preflight.log"
capacity_log="$tmp_dir/capacity.log"
cleanup_log="$tmp_dir/cleanup.log"
attempt_json="$tmp_dir/attempt.json"
worker_service_arn=''
api_service_arn=''
ai_service_arn=''
api_url=''
original_scaling=''
paused_scaling=''
baseline_hash=''
max_connections=''
api_state_hash=''
ai_state_hash=''
api_final_state_hash=''
ai_final_state_hash=''
worker_initial_state_hash=''
paused_worker_state_hash=''
worker_final_paused_state_hash=''
worker_restored_state_hash=''
service_5xx_metrics=''
service_5xx_metrics_hash=''
service_5xx_baselines=''
service_5xx_finals=''
service_5xx_baseline_watermarks=''
service_5xx_final_watermarks=''
service_5xx_final_metrics_hash=''
ignored_low_alarms='[]'
ignored_low_alarms_hash=''
alarm_initial_set_hash=''
alarm_final_set_hash=''
blocking_alarms_initial=''
blocking_alarms_final=''
monitor_window_start=''
wrapper_started_ms=''
attempt_started=false
attempt_terminal=false
workers_may_be_mutated=false
cleanup_verified=false
controller_done=false
capacity_pid=''
monitor_abort=''
high_cpu_samples=0
max_high_cpu_samples=0
last_cpu_timestamp=''
last_db_connections_timestamp=''
cpu_baseline_timestamp=''
db_connections_baseline_timestamp=''
max_cpu_percent=0
max_db_connections=0
max_db_connection_ratio=0
monitor_checks=0
worker_pause_verified=false
worker_restore_verified=false

sha256_value() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}';
  else shasum -a 256 | awk '{print $1}'; fi
}
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
epoch_ms() {
  local value
  value="$(date +%s%3N 2>/dev/null || true)"
  [[ "$value" =~ ^[0-9]{13}$ ]] && printf '%s\n' "$value" || printf '%s000\n' "$(date +%s)"
}
elapsed_ms() {
  [ -n "$wrapper_started_ms" ] || { printf '0\n'; return; }
  printf '%s\n' "$(( $(epoch_ms) - wrapper_started_ms ))"
}
five_minutes_ago() { date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ; }

find_service_5xx_metric() {
  local binding="$1"
  jq -ce --argjson binding "$binding" '
    [.MetricAlarms[]
      | select(.StateValue=="OK" and .ActionsEnabled==true
          and .AlarmArn==$binding.alarmArn)
      | . as $alarm
      | (if .Namespace=="AWS/ApplicationELB" and .MetricName=="HTTPCode_Target_5XX_Count"
          then [{dimensions:((.Dimensions // [])|sort_by(.Name,.Value))}]
          else [.Metrics[]?
            | select(.MetricStat.Metric.Namespace=="AWS/ApplicationELB"
                and .MetricStat.Metric.MetricName=="HTTPCode_Target_5XX_Count")
            | {dimensions:((.MetricStat.Metric.Dimensions // [])|sort_by(.Name,.Value))}]
          end) as $rawMetrics
      | ($rawMetrics
         | map(select((.dimensions|length)==2
             and ([.dimensions[].Name]|sort)==["LoadBalancer","TargetGroup"]))
         | unique_by(.dimensions|tojson)) as $metrics
      | select(($rawMetrics|length)==($metrics|length) and ($metrics|length)>=1)
      | {serviceName:$binding.serviceName,alarmName:$alarm.AlarmName,alarmArn:$alarm.AlarmArn,
         metrics:($metrics|sort_by(.dimensions|tojson))}
      | select(.metrics==$binding.metrics)]
    | if length==1 then .[0]
      else error("capacity_service_5xx_alarm_missing_or_ambiguous") end
  '
}

read_ignored_scale_in_alarms() {
  jq -c '[.MetricAlarms[]
    | select(.StateValue=="ALARM"
      and (.AlarmName|test("^TargetTracking-service/watchdog-bms-uat/[A-Za-z0-9_-]+-AlarmLow-[A-Za-z0-9-]+$")))
    | .AlarmName] | sort'
}

blocking_alarm_count() {
  jq '[((.MetricAlarms // []) + (.CompositeAlarms // []))[]
    | select(.AlarmName|contains("watchdog-bms-uat"))
    | select(.StateValue=="ALARM"
      and ((.AlarmName|test("^TargetTracking-service/watchdog-bms-uat/[A-Za-z0-9_-]+-AlarmLow-[A-Za-z0-9-]+$"))|not))]
    | length'
}

alarm_state_set() {
  jq -cS '[((.MetricAlarms // []) + (.CompositeAlarms // []))[]
    | select(.AlarmName|contains("watchdog-bms-uat"))
    | {alarmName:.AlarmName,state:.StateValue,actionsEnabled:.ActionsEnabled}]
    | sort_by(.alarmName)'
}

read_one_5xx_total() {
  local dimensions="$1"
  local queries result latest latest_epoch now_epoch canonical_latest total
  queries="$(jq -cn --argjson dimensions "$dimensions" '[
    {Id:"m5",MetricStat:{Metric:{Namespace:"AWS/ApplicationELB",
      MetricName:"HTTPCode_Target_5XX_Count",Dimensions:$dimensions},Period:60,Stat:"Sum"},ReturnData:true},
    {Id:"wm",MetricStat:{Metric:{Namespace:"AWS/ApplicationELB",
      MetricName:"HealthyHostCount",Dimensions:$dimensions},Period:60,Stat:"Average"},ReturnData:true}
  ]')"
  result="$(aws_cmd cloudwatch get-metric-data --metric-data-queries "$queries" \
    --start-time "$monitor_window_start" --end-time "$(iso_now)" --scan-by TimestampAscending \
    --region "$region" --output json)" || return 1
  jq -e '.MetricDataResults as $rows
    | ($rows|length)==2
    and ([$rows[].Id]|sort)==["m5","wm"]
    and all($rows[]; .StatusCode=="Complete"
      and (.Values|length)==(.Timestamps|length))
    and (($rows[]|select(.Id=="wm")|.Timestamps)|length)>0' \
    <<< "$result" >/dev/null || return 1
  latest="$(jq -r '.MetricDataResults[]|select(.Id=="wm")|.Timestamps[-1]' <<< "$result")"
  latest_epoch="$(date -d "$latest" +%s 2>/dev/null)" || return 1
  canonical_latest="$(date -u -d "$latest" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || return 1
  now_epoch="$(date +%s)"
  [ $((now_epoch - latest_epoch)) -ge -60 ] && [ $((now_epoch - latest_epoch)) -le 180 ] || return 1
  total="$(jq -r '[.MetricDataResults[]|select(.Id=="m5")|.Values[]]|add // 0' <<< "$result")"
  [[ "$total" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
  jq -cn --argjson total "$total" --arg watermark "$canonical_latest" \
    '{total:$total,watermark:$watermark}'
}

read_service_5xx_total() {
  local metric="$1" dimensions measurement value point point_epoch total=0 watermark='' watermark_epoch=''
  while IFS= read -r dimensions; do
    measurement="$(read_one_5xx_total "$dimensions")" || return 1
    value="$(jq -r '.total' <<< "$measurement")"
    point="$(jq -r '.watermark' <<< "$measurement")"
    point_epoch="$(date -d "$point" +%s 2>/dev/null)" || return 1
    total="$(awk -v total="$total" -v value="$value" 'BEGIN {print total+value}')"
    if [ -z "$watermark_epoch" ] || [ "$point_epoch" -lt "$watermark_epoch" ]; then
      watermark="$point"
      watermark_epoch="$point_epoch"
    fi
  done < <(jq -c '.metrics[].dimensions' <<< "$metric")
  [ -n "$watermark" ] || return 1
  jq -cn --argjson total "$total" --arg watermark "$watermark" \
    '{total:$total,watermark:$watermark}'
}

write_attempt() {
  local status="$1" evidence_hash="${2:-}" reason="${3:-}" result_hash="${4:-}" elapsed
  elapsed="$(elapsed_ms)"
  jq -cn \
    --arg status "$status" --arg sourceSha "$source_sha" \
    --arg markerHash "$(printf '%s' "$marker" | sha256_value)" \
    --arg approvalRefHash "$(printf '%s' "$approval_ref" | sha256_value)" \
    --arg baselineHash "$baseline_hash" --arg workerServiceArn "$worker_service_arn" \
    --arg authorizationHash "$authorization_hash" --arg workflowSha "$workflow_sha" \
    --arg workloadManifestHash "$workload_manifest_hash" --arg actor "$GITHUB_ACTOR" \
    --arg triggeringActor "$GITHUB_TRIGGERING_ACTOR" --arg runId "$GITHUB_RUN_ID" \
    --arg runAttempt "$GITHUB_RUN_ATTEMPT" \
    --arg service5xxMetricHash "$service_5xx_metrics_hash" \
    --argjson service5xxBaselines "${service_5xx_baselines:-null}" \
    --arg ignoredLowAlarmsHash "$ignored_low_alarms_hash" \
    --argjson ignoredLowAlarms "${ignored_low_alarms:-[]}" \
    --arg evidenceHash "$evidence_hash" --arg resultHash "$result_hash" \
    --arg reason "$reason" --arg updatedAt "$(iso_now)" \
    --argjson originalScaling "${original_scaling:-null}" --argjson elapsedMs "$elapsed" \
    '{status:$status,sourceSha:$sourceSha,markerHash:$markerHash,approvalRefHash:$approvalRefHash,
      authorizationHash:$authorizationHash,workflowSha:$workflowSha,
      workloadManifestHash:$workloadManifestHash,actor:$actor,triggeringActor:$triggeringActor,
      runId:$runId,runAttempt:$runAttempt,baselineHash:$baselineHash,
      service5xxMetricHash:$service5xxMetricHash,service5xxBaselines:$service5xxBaselines,
      ignoredLowAlarmsHash:$ignoredLowAlarmsHash,ignoredLowAlarms:$ignoredLowAlarms,
      workerServiceArn:$workerServiceArn,originalScaling:$originalScaling,
      evidenceHash:$evidenceHash,resultHash:(if $resultHash=="" then null else $resultHash end),
      reason:$reason,elapsedMs:$elapsedMs,updatedAt:$updatedAt}' > "$attempt_json"
  if [ "$status" = 'STARTED' ]; then
    aws_cmd ssm put-parameter --name "$attempt_parameter" --type String \
      --value "$(<"$attempt_json")" --no-overwrite --region "$region" >/dev/null
  else
    aws_cmd ssm put-parameter --name "$attempt_parameter" --type String \
      --value "$(<"$attempt_json")" --overwrite --region "$region" >/dev/null
    case "$status" in PASSED|FAILED|FAILED_CLEANUP|FAILED_RESTORE) attempt_terminal=true ;; esac
  fi
}

active_tasks() {
  AWS_BIN="$aws_bin" AWS_REGION="$region" \
    bash "$repo_root/infra/prod-ecs-express/active-release-tasks.sh" \
      --cluster "$cluster" --started-by "$1"
}

# Always proves the marker-specific active set empty from ECS; an empty local log is never evidence.
stop_capacity_tasks() {
  local tasks arn empty_checks=0
  # ECS ListTasks is eventually consistent with RunTask. Require three consecutive empty reads so
  # cancellation immediately after launch cannot mistake a not-yet-visible task for an empty set.
  for _ in $(seq 1 15); do
    tasks="$(active_tasks "$capacity_started_by")" || return 1
    if [ "$(jq 'length' <<< "$tasks")" -eq 0 ]; then
      empty_checks=$((empty_checks + 1))
      [ "$empty_checks" -ge 3 ] && return 0
      sleep 2
      continue
    fi
    empty_checks=0
    while IFS= read -r arn; do
      [ -n "$arn" ] || continue
      aws_cmd ecs stop-task --cluster "$cluster" --task "$arn" \
        --reason 'u5-capacity-controller-stop' --region "$region" >/dev/null 2>&1 || true
    done < <(jq -r '.[]' <<< "$tasks")
    # shellcheck disable=SC2046 # each value came from ECS and is one whitespace-free task ARN.
    aws_cmd ecs wait tasks-stopped --cluster "$cluster" --tasks $(jq -r '.[]' <<< "$tasks") \
      --region "$region" >/dev/null || return 1
  done
  return 1
}

resolve_parameter_arn() {
  local parameter="$1" expected="$2" value
  value="$(aws_cmd ssm get-parameter --name "$parameter" --query Parameter.Value --output text --region "$region")"
  [[ "$value" =~ $expected ]] || return 1
  printf '%s\n' "$value"
}

service_snapshot() {
  aws_cmd ecs describe-express-gateway-service --service-arn "$1" --region "$region" \
    | jq -cS '{status:.service.status.statusCode,currentDeployment:.service.currentDeployment,
      activeConfigurations:.service.activeConfigurations}'
}
service_hash() { service_snapshot "$1" | sha256_value; }
service_alarm_binding() {
  local service_arn="$1" revision_arn revision
  revision_arn="$(service_snapshot "$service_arn" | jq -er '
    if (.activeConfigurations|length)==1 then .activeConfigurations[0].serviceRevisionArn
    else error("capacity_service_revision_missing_or_ambiguous") end')" || return 1
  revision="$(aws_cmd ecs describe-service-revisions --service-revision-arns "$revision_arn" \
    --region "$region" --output json)" || return 1
  jq -ceS --arg serviceArn "$service_arn" --arg revisionArn "$revision_arn" \
    --arg region "$region" --arg account "$account_id" '
    select((.failures|length)==0 and (.serviceRevisions|length)==1)
    | .serviceRevisions[0]
    | select(.serviceArn==$serviceArn and .serviceRevisionArn==$revisionArn)
    | . as $revision
    | ([.ecsManagedResources.ingressPaths[]?
        | select(.accessType=="PUBLIC" and .loadBalancer.status=="ACTIVE"
            and (.targetGroups|length)>=1 and (.targetGroups|length)<=2
            and all(.targetGroups[]; .status=="ACTIVE"))] | if length==1 then .[0]
          else error("capacity_service_ingress_missing_or_ambiguous") end) as $ingress
    | ([.loadBalancers[]?
        | .targetGroupArn, .advancedConfiguration.alternateTargetGroupArn?]
        | map(select(.!=null)) | unique | sort) as $declaredTargetGroups
    | ([$ingress.targetGroups[].arn] | unique | sort) as $managedTargetGroups
    | select($declaredTargetGroups==$managedTargetGroups)
    | select(($ingress.loadBalancer.arn
          | startswith("arn:aws:elasticloadbalancing:"+$region+":"+$account+":loadbalancer/"))
        and all($managedTargetGroups[];
          startswith("arn:aws:elasticloadbalancing:"+$region+":"+$account+":targetgroup/")))
    | ([.ecsManagedResources.metricAlarms[]?
        | select(.status=="ACTIVE") | .arn] | unique
        | if length==1 then .[0] else error("capacity_service_alarm_missing_or_ambiguous") end) as $alarmArn
    | ($ingress.loadBalancer.arn
        | sub("^arn:aws:elasticloadbalancing:"+$region+":"+$account+":loadbalancer/";"")) as $loadBalancer
    | {serviceName:($serviceArn|split("/")[-1]),alarmArn:$alarmArn,
       metrics:([$managedTargetGroups[]
         | {dimensions:([{Name:"LoadBalancer",Value:$loadBalancer},
                          {Name:"TargetGroup",Value:(sub("^arn:aws:elasticloadbalancing:"+$region+":"+$account+":";""))}]
             | sort_by(.Name,.Value))}] | sort_by(.dimensions|tojson))}
    | select((.alarmArn|startswith("arn:aws:cloudwatch:"+$region+":"+$account+":alarm:"))
        and (.metrics|length)>=1 and (.metrics|length)<=2
        and all(.metrics[]; ([.dimensions[].Name]|sort)==["LoadBalancer","TargetGroup"]
          and all(.dimensions[]; (.Value|length)>0)))
  ' <<< "$revision"
}
assert_service_source_sha() {
  service_snapshot "$1" | jq -e --arg sha "$source_sha" '
    (.activeConfigurations|length)==1
    and ([.activeConfigurations[0].primaryContainer.environment[]?
      | select(.name=="GIT_SHA") | .value] == [$sha])
  ' >/dev/null
}

# Updating only scaling creates a new ECS Express revision, so createdAt/serviceRevisionArn are
# expected to change even after the exact original configuration is restored. Compare the full
# effective configuration (with order-insensitive AWS arrays), not deployment metadata; service
# stability and an empty currentDeployment are proven separately by assert_service_stable.
canonical_service_configuration() {
  jq -cS '
    {status,activeConfigurations:([
      .activeConfigurations[]
      | del(.createdAt,.serviceRevisionArn)
      | if .networkConfiguration.securityGroups then .networkConfiguration.securityGroups |= sort else . end
      | if .networkConfiguration.subnets then .networkConfiguration.subnets |= sort else . end
      | if .ingressPaths then .ingressPaths |= sort_by(.accessType,.endpoint) else . end
      | if .primaryContainer.environment then .primaryContainer.environment |= sort_by(.name,.value) else . end
      | if .primaryContainer.secrets then .primaryContainer.secrets |= sort_by(.name,.valueFrom) else . end
    ] | sort_by(.primaryContainer.image,.primaryContainer.containerPort,(.scalingTarget|tojson)))}'
}
service_configuration_hash() { service_snapshot "$1" | canonical_service_configuration | sha256_value; }

assert_service_stable() {
  local arn="$1" first second deployment state
  first="$(service_snapshot "$arn")" || return 1
  jq -e '.status=="ACTIVE" and (.activeConfigurations|length)==1' <<< "$first" >/dev/null || return 1
  deployment="$(jq -r '.currentDeployment // empty' <<< "$first")"
  if [ -n "$deployment" ] && [ "$deployment" != 'None' ]; then
    state="$(aws_cmd ecs describe-service-deployments --service-deployment-arns "$deployment" \
      --query 'serviceDeployments[0].status' --output text --region "$region")" || return 1
    case "$state" in SUCCESSFUL|ROLLBACK_SUCCESSFUL) ;; *) return 1 ;; esac
  fi
  sleep 2
  second="$(service_snapshot "$arn")" || return 1
  [ "$first" = "$second" ]
}

wait_service_stable() {
  local arn="$1"
  for _ in $(seq 1 60); do
    assert_service_stable "$arn" && return 0
    if [ -n "$wrapper_started_ms" ] && [ "$(elapsed_ms)" -ge 600000 ]; then return 1; fi
    sleep 5
  done
  return 1
}

task_count() {
  aws_cmd ecs list-tasks --cluster "$cluster" --service-name "${worker_service_arn##*/}" \
    --desired-status "$1" --query 'length(taskArns)' --output text --region "$region"
}

wait_worker_shape() {
  local expected="$1" require_zero="$2" stable=0 snapshot scaling running pending
  for _ in $(seq 1 60); do
    snapshot="$(service_snapshot "$worker_service_arn")" || { sleep 5; continue; }
    scaling="$(jq -cS 'if (.activeConfigurations|length)==1 then .activeConfigurations[0].scalingTarget else null end' <<< "$snapshot")"
    running="$(task_count RUNNING)" || { sleep 5; continue; }
    pending="$(task_count PENDING)" || { sleep 5; continue; }
    if [ "$scaling" = "$(jq -cS . <<< "$expected")" ] && [ "$pending" -eq 0 ]; then
      if [ "$require_zero" = 'true' ]; then
        [ "$running" -eq 0 ] || { stable=0; sleep 5; continue; }
      else
        minimum="$(jq -r '.minTaskCount' <<< "$expected")"
        [ "$running" -ge "$minimum" ] || { stable=0; sleep 5; continue; }
      fi
      stable=$((stable + 1))
      [ "$stable" -ge 2 ] && return 0
    else
      stable=0
    fi
    sleep 5
  done
  return 1
}

wait_worker_terminal_shape() {
  local expected="$1" require_zero="$2"
  # The first shape proves the requested revision became active; the terminal wait proves it can no
  # longer roll back underneath the workload; the final shape proves task counts after settlement.
  wait_worker_shape "$expected" "$require_zero" \
    && wait_service_stable "$worker_service_arn" \
    && wait_worker_shape "$expected" "$require_zero"
}

restore_workers() {
  [ "$workers_may_be_mutated" = 'true' ] || return 0
  [ "$cleanup_verified" = 'true' ] || return 1
  aws_cmd ecs update-express-gateway-service --service-arn "$worker_service_arn" \
    --scaling-target "$original_scaling" --region "$region" >/dev/null || return 1
  wait_worker_terminal_shape "$original_scaling" false || return 1
  worker_restored_state_hash="$(service_configuration_hash "$worker_service_arn")" || return 1
  [ "$worker_restored_state_hash" = "$worker_initial_state_hash" ] || return 1
  worker_restore_verified=true
  workers_may_be_mutated=false
  echo '[u5-capacity] exact worker scaling restored and read back'
}

run_capacity_mode() {
  local mode="$1" output="$2"
  DEPLOY_ENV=uat U5_CAPACITY_MARKER="$marker" U5_CAPACITY_APPROVAL_REF="$approval_ref" \
    U5_CAPACITY_BASELINE_HASH="$baseline_hash" \
    bash "$repo_root/infra/prod-ecs-express/run-release-task.sh" "$release_image" "$source_sha" "$mode" \
      >"$output" 2>&1
}

extract_artifact() {
  local file="$1" artifact="$2"
  tr '\t' '\n' < "$file" | grep -E "^\\{\"artifact\":\"${artifact}\"" | tail -1 || true
}

run_cleanup() {
  local evidence rc=0
  stop_capacity_tasks || return 1
  run_capacity_mode a5-capacity-cleanup "$cleanup_log" || rc=$?
  cat "$cleanup_log"
  evidence="$(extract_artifact "$cleanup_log" a5-capacity-cleanup-v2)"
  [ "$rc" -eq 0 ] && jq -e --arg baseline "$baseline_hash" '
    .cleanupVerified==true and .residue==0 and .expectedBaselineHash==$baseline
    and .afterBaselineHash==$baseline and .inspectedRelations>0
  ' <<< "$evidence" >/dev/null 2>&1
}

emit_pass_result() {
  local base_result="$tmp_dir/evidence-base.json" database_evidence="$tmp_dir/database-evidence.json"
  local candidate_result="$tmp_dir/evidence.json" result_hash database_hash database_max_ratio result_elapsed
  printf '%s\n' "$evidence" | jq -cS . > "$database_evidence"
  database_hash="$(sha256_file "$database_evidence")"
  database_max_ratio="$(jq '[.smoke.maxConnectionRatio,.full.maxConnectionRatio]|max' "$database_evidence")"
  result_elapsed="$(elapsed_ms)"

  jq -cnS \
    --rawfile authorization "$authorization_file" --slurpfile databaseEvidence "$database_evidence" \
    --arg authorizationHash "$authorization_hash" --arg releaseImage "$release_image" \
    --arg marker "$marker" \
    --arg workloadManifestHash "$workload_manifest_hash" --arg workflowSha "$workflow_sha" \
    --arg runId "$GITHUB_RUN_ID" --arg runAttempt "$GITHUB_RUN_ATTEMPT" \
    --arg actor "$GITHUB_ACTOR" --arg triggeringActor "$GITHUB_TRIGGERING_ACTOR" \
    --arg databaseHash "$database_hash" \
    --arg alarmInitialSetHash "$alarm_initial_set_hash" --arg alarmFinalSetHash "$alarm_final_set_hash" \
    --arg ignoredLowAlarmsHash "$ignored_low_alarms_hash" \
    --arg service5xxInitialHash "$service_5xx_metrics_hash" \
    --arg service5xxFinalHash "$service_5xx_final_metrics_hash" \
    --arg apiInitialHash "$api_state_hash" --arg apiFinalHash "$api_final_state_hash" \
    --arg aiInitialHash "$ai_state_hash" --arg aiFinalHash "$ai_final_state_hash" \
    --arg workerInitialHash "$worker_initial_state_hash" \
    --arg workerPausedHash "$paused_worker_state_hash" \
    --arg workerFinalPausedHash "$worker_final_paused_state_hash" \
    --arg workerRestoredHash "$worker_restored_state_hash" \
    --arg monitorAbort "$monitor_abort" \
    --arg lastCpuTimestamp "$last_cpu_timestamp" \
    --arg lastDbConnectionsTimestamp "$last_db_connections_timestamp" \
    --arg generatedAt "$(iso_now)" \
    --argjson ignoredLowAlarms "$ignored_low_alarms" \
    --argjson authorizationVerified "$authorization_verified" \
    --argjson service5xxBaselines "$service_5xx_baselines" \
    --argjson service5xxFinals "$service_5xx_finals" \
    --argjson service5xxBaselineWatermarks "$service_5xx_baseline_watermarks" \
    --argjson service5xxFinalWatermarks "$service_5xx_final_watermarks" \
    --argjson originalScaling "$original_scaling" --argjson pausedScaling "$paused_scaling" \
    --argjson workerPauseVerified "$worker_pause_verified" \
    --argjson workerRestoreVerified "$worker_restore_verified" \
    --argjson blockingInitial "$blocking_alarms_initial" --argjson blockingFinal "$blocking_alarms_final" \
    --argjson monitorChecks "$monitor_checks" --argjson maxCpuPercent "$max_cpu_percent" \
    --argjson maxDbConnections "$max_db_connections" \
    --argjson maxDbConnectionRatio "$max_db_connection_ratio" \
    --argjson maxConsecutiveHighCpuSamples "$max_high_cpu_samples" \
    --argjson databaseMaxConnectionRatio "$database_max_ratio" \
    --argjson controllerElapsedMs "$result_elapsed" '
      ($databaseEvidence[0]) as $db
      | {
        artifact:"U5_CAPACITY_RESULT_V1",schemaVersion:1,result:"PASS",
        authorization:{hash:$authorizationHash,content:$authorization,verified:$authorizationVerified},
        source:{sourceSha:$db.sourceCommit,releaseImage:$releaseImage,marker:$marker,
          markerHash:$db.markerHash,
          workloadManifestHash:$workloadManifestHash,workflowSha:$workflowSha,
          runId:$runId,runAttempt:$runAttempt,actor:$actor,triggeringActor:$triggeringActor},
        limits:$db.limits,
        database:{evidence:$db,evidenceHash:$db.evidenceHash,canonicalEvidenceHash:$databaseHash,
          baselineHash:$db.expectedBaselineHash,afterBaselineHash:$db.cleanup.afterBaselineHash,
          cleanupVerified:$db.cleanupVerified,residue:$db.cleanup.residue,
          inspectedRelations:$db.cleanup.inspectedRelations,maxConnectionRatio:$databaseMaxConnectionRatio},
        monitoring:{passed:($monitorAbort==""),abortReason:(if $monitorAbort=="" then null else $monitorAbort end),checks:$monitorChecks,
          alarm:{initialSetHash:$alarmInitialSetHash,finalSetHash:$alarmFinalSetHash,
            blockingInitial:$blockingInitial,blockingFinal:$blockingFinal,
            ignoredScaleInAlarms:$ignoredLowAlarms,ignoredScaleInHash:$ignoredLowAlarmsHash},
          service5xx:{initialMetricSetHash:$service5xxInitialHash,
            finalMetricSetHash:$service5xxFinalHash,baselineTotals:$service5xxBaselines,
            finalTotals:$service5xxFinals,baselineWatermarks:$service5xxBaselineWatermarks,
            finalWatermarks:$service5xxFinalWatermarks},
          database:{maxCpuPercent:$maxCpuPercent,maxDbConnections:$maxDbConnections,
            maxDbConnectionRatio:$maxDbConnectionRatio,
            maxConsecutiveHighCpuSamples:$maxConsecutiveHighCpuSamples,
            lastCpuTimestamp:$lastCpuTimestamp,lastDbConnectionsTimestamp:$lastDbConnectionsTimestamp},
          services:{apiInitialHash:$apiInitialHash,apiFinalHash:$apiFinalHash,
            aiInitialHash:$aiInitialHash,aiFinalHash:$aiFinalHash,
            workerPausedHash:$workerPausedHash,workerFinalPausedHash:$workerFinalPausedHash}},
        workers:{pauseVerified:$workerPauseVerified,restoreVerified:$workerRestoreVerified,originalScaling:$originalScaling,
          pausedScaling:$pausedScaling,initialStateHash:$workerInitialHash,
          pausedStateHash:$workerPausedHash,restoredStateHash:$workerRestoredHash},
        cleanup:{verified:$db.cleanupVerified,baselineHash:$db.expectedBaselineHash,afterBaselineHash:$db.cleanup.afterBaselineHash,
          residue:$db.cleanup.residue,inspectedRelations:$db.cleanup.inspectedRelations,
          outboxRows:$db.cleanup.outboxRows,inboxRows:$db.cleanup.inboxRows,
          companies:$db.cleanup.companies},
        timing:{controllerElapsedMs:$controllerElapsedMs,databaseElapsedMs:$db.elapsedMs,maxElapsedMs:600000},
        generatedAt:$generatedAt
      }
    ' > "$base_result"
  result_hash="$(sha256_file "$base_result")"
  jq -cS --arg resultHash "$result_hash" '.+{resultHash:$resultHash}' "$base_result" > "$candidate_result"
  bash "$repo_root/infra/uat/validate-u5-capacity-result.sh" "$candidate_result" \
    "$source_sha" "$release_image" "$marker" "$workload_manifest_hash" "$workflow_sha" \
    "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$GITHUB_ACTOR" "$GITHUB_TRIGGERING_ACTOR" >/dev/null
  mv "$candidate_result" "$result_file"
}

finish() {
  local rc=$?
  trap - EXIT INT TERM
  # Stop the local launcher before proving the remote startedBy set empty. Otherwise cancellation
  # can observe an empty eventually-consistent set and the still-running launcher can RunTask later.
  if [ -n "$capacity_pid" ]; then
    kill "$capacity_pid" 2>/dev/null || true
    wait "$capacity_pid" 2>/dev/null || true
    capacity_pid=''
  fi
  if [ "$controller_done" != 'true' ]; then
    if ! stop_capacity_tasks; then monitor_abort="${monitor_abort:-capacity_task_stop_unproved}"; fi
    if [ "$attempt_started" = 'true' ] && [ "$workers_may_be_mutated" = 'true' ]; then
      if [ -n "$baseline_hash" ] && run_cleanup; then
        cleanup_verified=true
        if restore_workers; then
          write_attempt FAILED '' "${monitor_abort:-controller_interrupted}" >/dev/null 2>&1 || true
        else
          write_attempt FAILED_RESTORE '' "${monitor_abort:-controller_interrupted}" >/dev/null 2>&1 || true
        fi
      else
        write_attempt FAILED_CLEANUP '' "${monitor_abort:-controller_interrupted}" >/dev/null 2>&1 || true
      fi
    elif [ "$attempt_started" = 'true' ] && [ "$attempt_terminal" != 'true' ]; then
      write_attempt FAILED '' "${monitor_abort:-controller_interrupted}" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$tmp_dir"
  exit "$rc"
}
trap 'exit 130' INT
trap 'exit 143' TERM
trap finish EXIT

# Approval is one-shot even after a failed attempt.
if aws_cmd ssm get-parameter --name "$attempt_parameter" --region "$region" >/dev/null 2>&1; then
  echo 'ERROR: U5-C v2 approval was already consumed; inspect its durable attempt record' >&2
  exit 1
fi

bash "$repo_root/infra/prod-ecs-express/verify-serving-api-build.sh" uat "$source_sha"
tag_digest="$(aws_cmd ecr describe-images --repository-name watchdog-bms-api \
  --image-ids "imageTag=uat-release-task-${source_sha}" --query 'imageDetails[0].imageDigest' \
  --output text --region "$region")"
[ "$tag_digest" = "${release_image##*@}" ] || { echo 'ERROR: release-task image does not match source SHA' >&2; exit 1; }
cosign verify \
  --certificate-identity "https://github.com/MangmeeDev/mangmeeplus/.github/workflows/deploy-uat.yml@refs/heads/main" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' "$release_image" >/dev/null

generic_tasks="$(active_tasks watchdog-bms-uat-release)"
[ "$(jq 'length' <<< "$generic_tasks")" -eq 0 ] || { echo 'ERROR: release/migration task is active' >&2; exit 1; }
marker_tasks="$(active_tasks "$capacity_started_by")"
[ "$(jq 'length' <<< "$marker_tasks")" -eq 0 ] || { echo 'ERROR: marker task already active' >&2; exit 1; }

api_service_arn="$(resolve_parameter_arn /watchdog-bms/uat/ecs-express-api-web-service-arn \
  "^arn:aws:ecs:${region}:${account_id}:service/${cluster}/watchdog-bms-uat-api-web")" || exit 1
ai_service_arn="$(resolve_parameter_arn /watchdog-bms/uat/ecs-express-ai-gateway-service-arn \
  "^arn:aws:ecs:${region}:${account_id}:service/${cluster}/watchdog-bms-uat-ai-gateway")" || exit 1
for parameter in /watchdog-bms/uat/ecs-express-workers-priv-service-arn /watchdog-bms/uat/ecs-express-workers-service-arn; do
  worker_service_arn="$(resolve_parameter_arn "$parameter" \
    "^arn:aws:ecs:${region}:${account_id}:service/${cluster}/watchdog-bms-uat-workers" 2>/dev/null || true)"
  [ -z "$worker_service_arn" ] || break
done
[ -n "$worker_service_arn" ] || { echo 'ERROR: UAT workers service missing' >&2; exit 1; }
api_url="$(aws_cmd ssm get-parameter --name /watchdog-bms/uat/ecs-express-api-web-url \
  --query Parameter.Value --output text --region "$region")"
[[ "$api_url" =~ ^https://[^[:space:]]+$ ]] || { echo 'ERROR: UAT API URL invalid' >&2; exit 1; }

assert_service_stable "$api_service_arn" || { echo 'ERROR: API service/deployment is not stable' >&2; exit 1; }
assert_service_stable "$ai_service_arn" || { echo 'ERROR: AI service/deployment is not stable' >&2; exit 1; }
assert_service_stable "$worker_service_arn" || { echo 'ERROR: worker service/deployment is not stable' >&2; exit 1; }
assert_service_source_sha "$api_service_arn" \
  && assert_service_source_sha "$ai_service_arn" \
  && assert_service_source_sha "$worker_service_arn" \
  || { echo 'ERROR: every UAT service must serve the exact capacity source SHA' >&2; exit 1; }
service_alarm_bindings="$(for service_arn in "$api_service_arn" "$ai_service_arn" "$worker_service_arn"; do
  service_alarm_binding "$service_arn"
done | jq -cs 'sort_by(.serviceName)')" || {
  echo 'ERROR: ECS could not prove the active alarm/target-group binding for every UAT service' >&2
  exit 1
}

alarm_inventory="$(aws_cmd cloudwatch describe-alarms --output json --region "$region")"
blocking_alarms_initial="$(blocking_alarm_count <<< "$alarm_inventory")"
[ "$blocking_alarms_initial" -eq 0 ] \
  || { echo 'ERROR: UAT has a non-scale-in alarm in ALARM state' >&2; exit 1; }
alarm_initial_set_hash="$(alarm_state_set <<< "$alarm_inventory" | sha256_value)"
alarm_final_set_hash="$alarm_initial_set_hash"
blocking_alarms_final="$blocking_alarms_initial"
ignored_low_alarms="$(read_ignored_scale_in_alarms <<< "$alarm_inventory")"
[ "$(jq 'length' <<< "$ignored_low_alarms")" -eq 3 ] || {
  echo 'ERROR: expected exactly three UAT target-tracking scale-in alarms before capacity run' >&2
  exit 1
}
ignored_low_alarms_hash="$(printf '%s' "$ignored_low_alarms" | sha256_value)"
service_5xx_metrics="$(for service_name in watchdog-bms-uat-api-web watchdog-bms-uat-ai-gateway watchdog-bms-uat-workers; do
  binding="$(jq -c --arg serviceName "$service_name" '.[]|select(.serviceName==$serviceName)' \
    <<< "$service_alarm_bindings")"
  find_service_5xx_metric "$binding" <<< "$alarm_inventory"
done | jq -cs 'sort_by(.serviceName)')" || {
  echo 'ERROR: every UAT service requires its exact active ECS-managed 5xx alarm/target groups' >&2
  exit 1
}
service_5xx_metrics_hash="$(printf '%s' "$service_5xx_metrics" | sha256_value)"
monitor_window_start="$(five_minutes_ago)"
service_5xx_baselines='{}'
service_5xx_baseline_watermarks='{}'
for service_name in watchdog-bms-uat-api-web watchdog-bms-uat-ai-gateway watchdog-bms-uat-workers; do
  metric="$(jq -c --arg serviceName "$service_name" '.[]|select(.serviceName==$serviceName)' <<< "$service_5xx_metrics")"
  measurement="$(read_service_5xx_total "$metric")" || {
    echo "ERROR: fresh 5xx metric unavailable for $service_name" >&2
    exit 1
  }
  total="$(jq -r '.total' <<< "$measurement")"
  watermark="$(jq -r '.watermark' <<< "$measurement")"
  awk -v total="$total" 'BEGIN {exit !(total == 0)}' || {
    echo "ERROR: recent 5xx exists before capacity run for $service_name" >&2
    exit 1
  }
  service_5xx_baselines="$(jq -c --arg serviceName "$service_name" --argjson total "$total" \
    '.+{($serviceName):$total}' <<< "$service_5xx_baselines")"
  service_5xx_baseline_watermarks="$(jq -c --arg serviceName "$service_name" --arg watermark "$watermark" \
    '.+{($serviceName):$watermark}' <<< "$service_5xx_baseline_watermarks")"
done
service_5xx_finals="$service_5xx_baselines"
service_5xx_final_watermarks="$service_5xx_baseline_watermarks"
service_5xx_final_metrics_hash="$service_5xx_metrics_hash"
api_state_hash="$(service_hash "$api_service_arn")"
ai_state_hash="$(service_hash "$ai_service_arn")"
worker_snapshot="$(service_snapshot "$worker_service_arn")"
worker_initial_state_hash="$(printf '%s\n' "$worker_snapshot" | canonical_service_configuration | sha256_value)"
original_scaling="$(jq -cS '.activeConfigurations[0].scalingTarget' <<< "$worker_snapshot")"
jq -e '.minTaskCount>=1 and .maxTaskCount>=.minTaskCount
  and (.autoScalingMetric|type)=="string" and .autoScalingTargetValue>0' \
  <<< "$original_scaling" >/dev/null || { echo 'ERROR: worker scaling target is not restorable' >&2; exit 1; }
paused_scaling="$(jq -cS '.minTaskCount=0 | .maxTaskCount=0' <<< "$original_scaling")"

health="$(curl --fail --silent --show-error --max-time 20 "${api_url%/}/v1/health")" \
  && jq -e '.status=="ok"' <<< "$health" >/dev/null \
  || { echo 'ERROR: UAT API health returned an error/5xx' >&2; exit 1; }

# The first Fargate pass is SELECT-only and computes the killed-cleanup authority.
baseline_hash=''
run_capacity_mode a5-capacity-preflight "$preflight_log"
cat "$preflight_log"
preflight_evidence="$(extract_artifact "$preflight_log" a5-capacity-preflight-v2)"
jq -e --arg sha "$source_sha" '.clean==true and .sourceCommit==$sha
  and (.baselineHash|test("^[0-9a-f]{64}$")) and .maxConnections>0 and .connectionRatio<0.70' \
  <<< "$preflight_evidence" >/dev/null || { echo 'ERROR: capacity preflight evidence invalid' >&2; exit 1; }
baseline_hash="$(jq -r '.baselineHash' <<< "$preflight_evidence")"
max_connections="$(jq -r '.maxConnections' <<< "$preflight_evidence")"
stop_capacity_tasks || { echo 'ERROR: preflight task terminal state cannot be proved' >&2; exit 1; }

metric_points() {
  aws_cmd cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name "$1" \
    --dimensions "Name=DBInstanceIdentifier,Value=$db_identifier" --statistics Average --period 60 \
    --start-time "$monitor_window_start" --end-time "$(iso_now)" \
    --query 'sort_by(Datapoints,&Timestamp)' --output json --region "$region"
}
metric_point() {
  metric_points "$1" | jq -c 'last // null'
}
validate_metric_point() {
  local point="$1" value timestamp point_epoch now_epoch canonical_timestamp
  value="$(jq -r '.Average // empty' <<< "$point")"
  timestamp="$(jq -r '.Timestamp // empty' <<< "$point")"
  [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] && [ -n "$timestamp" ] || return 1
  point_epoch="$(date -d "$timestamp" +%s 2>/dev/null)" || return 1
  canonical_timestamp="$(date -u -d "$timestamp" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || return 1
  now_epoch="$(date +%s)"
  [ $((now_epoch - point_epoch)) -ge -60 ] && [ $((now_epoch - point_epoch)) -le 300 ] || return 1
  printf '%s\t%s\n' "$value" "$canonical_timestamp"
}

metric_series_stats() {
  local series="$1" since="$2" high_threshold="${3:-}" since_epoch point value timestamp point_epoch
  local maximum=0 consecutive=0 max_consecutive=0 last_timestamp='' last_epoch='' now_epoch
  since_epoch="$(date -d "$since" +%s 2>/dev/null)" || return 1
  jq -e 'type=="array" and length>0' <<< "$series" >/dev/null || return 1
  while IFS= read -r point; do
    value="$(jq -r '.Average // empty' <<< "$point")"
    timestamp="$(jq -r '.Timestamp // empty' <<< "$point")"
    [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
    point_epoch="$(date -d "$timestamp" +%s 2>/dev/null)" || return 1
    [ "$point_epoch" -ge "$since_epoch" ] || continue
    timestamp="$(date -u -d "$timestamp" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || return 1
    maximum="$(awk -v maximum="$maximum" -v current="$value" \
      'BEGIN {print current>maximum ? current : maximum}')"
    if [ -n "$high_threshold" ] && awk -v value="$value" -v threshold="$high_threshold" \
      'BEGIN {exit !(value >= threshold)}'; then
      consecutive=$((consecutive + 1))
    else
      consecutive=0
    fi
    [ "$consecutive" -le "$max_consecutive" ] || max_consecutive="$consecutive"
    last_timestamp="$timestamp"
    last_epoch="$point_epoch"
  done < <(jq -c '.[]' <<< "$series")
  [ -n "$last_timestamp" ] || return 1
  now_epoch="$(date +%s)"
  [ $((now_epoch - last_epoch)) -ge -60 ] && [ $((now_epoch - last_epoch)) -le 300 ] || return 1
  jq -cn --argjson maximum "$maximum" --arg lastTimestamp "$last_timestamp" \
    --argjson maxConsecutive "$max_consecutive" \
    '{maximum:$maximum,lastTimestamp:$lastTimestamp,maxConsecutive:$maxConsecutive}'
}

monitor_watermarks_cover() {
  local required="$1" required_epoch cpu_epoch db_epoch
  required_epoch="$(date -d "$required" +%s 2>/dev/null)" || return 1
  if [[ "$required" =~ [.]([0-9]{3})Z$ ]] && [ "${BASH_REMATCH[1]}" != '000' ]; then
    required_epoch=$((required_epoch + 1))
  fi
  cpu_epoch="$(date -d "$last_cpu_timestamp" +%s 2>/dev/null)" || return 1
  db_epoch="$(date -d "$last_db_connections_timestamp" +%s 2>/dev/null)" || return 1
  [ "$cpu_epoch" -ge "$required_epoch" ] && [ "$db_epoch" -ge "$required_epoch" ] || return 1
  jq -e --argjson required "$required_epoch" '
    length==3 and all(.[]; (fromdateiso8601 >= $required))
  ' <<< "$service_5xx_final_watermarks" >/dev/null
}
cpu_pair="$(validate_metric_point "$(metric_point CPUUtilization)")" \
  || { echo 'ERROR: current RDS CPU metric missing/stale' >&2; exit 1; }
IFS=$'\t' read -r max_cpu_percent last_cpu_timestamp <<< "$cpu_pair"
cpu_baseline_timestamp="$last_cpu_timestamp"
if awk -v value="$max_cpu_percent" 'BEGIN {exit !(value >= 70)}'; then
  high_cpu_samples=1
  max_high_cpu_samples=1
fi
db_pair="$(validate_metric_point "$(metric_point DatabaseConnections)")" \
  || { echo 'ERROR: current RDS connection metric missing/stale' >&2; exit 1; }
IFS=$'\t' read -r max_db_connections last_db_connections_timestamp <<< "$db_pair"
db_connections_baseline_timestamp="$last_db_connections_timestamp"
max_db_connection_ratio="$(awk -v used="$max_db_connections" -v maximum="$max_connections" \
  'BEGIN {if (maximum<=0) exit 1; print used/maximum}')" \
  || { echo 'ERROR: current RDS connection ratio invalid' >&2; exit 1; }
awk -v ratio="$max_db_connection_ratio" 'BEGIN {exit !(ratio < 0.70)}' \
  || { echo 'ERROR: current RDS connection threshold exceeded' >&2; exit 1; }

# Atomic one-shot marker immediately precedes the first mutation and contains recovery inputs.
wrapper_started_ms="$(epoch_ms)"
write_attempt STARTED
attempt_started=true
workers_may_be_mutated=true
aws_cmd ecs update-express-gateway-service --service-arn "$worker_service_arn" \
  --scaling-target "$paused_scaling" --region "$region" >/dev/null
wait_worker_terminal_shape "$paused_scaling" true \
  || { monitor_abort=workers_pause_or_readback_failed; echo 'ERROR: exact worker pause not proved' >&2; exit 1; }
paused_worker_state_hash="$(service_configuration_hash "$worker_service_arn")"
worker_pause_verified=true

monitor_once() {
  local alarms_now current_alarm_hash current_low_alarms current_5xx_metrics current_5xx_hash service_name binding metric measurement current_total watermark baseline_total
  local generic_now capacity_now api_now ai_now worker_now running pending cpu_stats db_stats current_db_connection_ratio
  [ "$(elapsed_ms)" -lt 600000 ] || { monitor_abort=wall_clock_exceeded; return 1; }
  alarms_now="$(aws_cmd cloudwatch describe-alarms --output json --region "$region")" \
    || { monitor_abort=alarm_monitor_failed; return 1; }
  blocking_alarms_final="$(blocking_alarm_count <<< "$alarms_now")"
  [ "$blocking_alarms_final" -eq 0 ] \
    || { monitor_abort=uat_alarm_active; return 1; }
  current_alarm_hash="$(alarm_state_set <<< "$alarms_now" | sha256_value)" \
    || { monitor_abort=alarm_set_monitor_failed; return 1; }
  alarm_final_set_hash="$current_alarm_hash"
  [ "$alarm_final_set_hash" = "$alarm_initial_set_hash" ] \
    || { monitor_abort=alarm_set_changed; return 1; }
  current_low_alarms="$(read_ignored_scale_in_alarms <<< "$alarms_now")" \
    || { monitor_abort=scale_in_alarm_monitor_failed; return 1; }
  [ "$(printf '%s' "$current_low_alarms" | sha256_value)" = "$ignored_low_alarms_hash" ] \
    || { monitor_abort=scale_in_alarm_set_changed; return 1; }
  current_5xx_metrics="$(for service_name in watchdog-bms-uat-api-web watchdog-bms-uat-ai-gateway watchdog-bms-uat-workers; do
    binding="$(jq -c --arg serviceName "$service_name" '.[]|select(.serviceName==$serviceName)' \
      <<< "$service_alarm_bindings")"
    find_service_5xx_metric "$binding" <<< "$alarms_now"
  done | jq -cs 'sort_by(.serviceName)')" || { monitor_abort=service_5xx_alarm_missing; return 1; }
  current_5xx_hash="$(printf '%s' "$current_5xx_metrics" | sha256_value)"
  service_5xx_final_metrics_hash="$current_5xx_hash"
  [ "$current_5xx_hash" = "$service_5xx_metrics_hash" ] \
    || { monitor_abort=service_5xx_alarm_changed; return 1; }
  for service_name in watchdog-bms-uat-api-web watchdog-bms-uat-ai-gateway watchdog-bms-uat-workers; do
    metric="$(jq -c --arg serviceName "$service_name" '.[]|select(.serviceName==$serviceName)' <<< "$current_5xx_metrics")"
    measurement="$(read_service_5xx_total "$metric")" \
      || { monitor_abort=service_5xx_metric_missing; return 1; }
    current_total="$(jq -r '.total' <<< "$measurement")"
    watermark="$(jq -r '.watermark' <<< "$measurement")"
    baseline_total="$(jq -r --arg serviceName "$service_name" '.[$serviceName]' <<< "$service_5xx_baselines")"
    awk -v current="$current_total" -v baseline="$baseline_total" 'BEGIN {exit !(current == baseline)}' \
      || { monitor_abort=service_5xx_delta; return 1; }
    service_5xx_finals="$(jq -c --arg serviceName "$service_name" --argjson total "$current_total" \
      '.+{($serviceName):$total}' <<< "$service_5xx_finals")"
    service_5xx_final_watermarks="$(jq -c --arg serviceName "$service_name" --arg watermark "$watermark" \
      '.+{($serviceName):$watermark}' <<< "$service_5xx_final_watermarks")"
  done
  health="$(curl --fail --silent --show-error --max-time 20 "${api_url%/}/v1/health")" \
    && jq -e '.status=="ok"' <<< "$health" >/dev/null \
    || { monitor_abort=api_health_or_5xx; return 1; }
  generic_now="$(active_tasks watchdog-bms-uat-release)" \
    || { monitor_abort=release_task_monitor_failed; return 1; }
  [ "$(jq 'length' <<< "$generic_now")" -eq 0 ] || { monitor_abort=release_or_migration_interference; return 1; }
  capacity_now="$(active_tasks "$capacity_started_by")" \
    || { monitor_abort=capacity_task_monitor_failed; return 1; }
  [ "$(jq 'length' <<< "$capacity_now")" -le 1 ] || { monitor_abort=multiple_capacity_tasks; return 1; }
  api_now="$(service_hash "$api_service_arn")" || { monitor_abort=api_service_monitor_failed; return 1; }
  ai_now="$(service_hash "$ai_service_arn")" || { monitor_abort=ai_service_monitor_failed; return 1; }
  worker_now="$(service_configuration_hash "$worker_service_arn")" || { monitor_abort=worker_service_monitor_failed; return 1; }
  api_final_state_hash="$api_now"
  ai_final_state_hash="$ai_now"
  worker_final_paused_state_hash="$worker_now"
  [ "$api_now" = "$api_state_hash" ] && [ "$ai_now" = "$ai_state_hash" ] \
    && [ "$worker_now" = "$paused_worker_state_hash" ] \
    || { monitor_abort=service_or_deploy_interference; return 1; }
  running="$(task_count RUNNING)" && pending="$(task_count PENDING)" \
    || { monitor_abort=worker_task_monitor_failed; return 1; }
  [ "$running" -eq 0 ] && [ "$pending" -eq 0 ] || { monitor_abort=worker_interference; return 1; }

  cpu_stats="$(metric_series_stats "$(metric_points CPUUtilization)" "$cpu_baseline_timestamp" 70)" \
    || { monitor_abort=database_cpu_metric_missing; return 1; }
  max_cpu_percent="$(jq -r '.maximum' <<< "$cpu_stats")"
  last_cpu_timestamp="$(jq -r '.lastTimestamp' <<< "$cpu_stats")"
  high_cpu_samples="$(jq -r '.maxConsecutive' <<< "$cpu_stats")"
  max_high_cpu_samples="$high_cpu_samples"
  [ "$max_high_cpu_samples" -lt 2 ] || { monitor_abort=database_cpu_threshold; return 1; }

  db_stats="$(metric_series_stats "$(metric_points DatabaseConnections)" "$db_connections_baseline_timestamp")" \
    || { monitor_abort=database_connection_metric_missing; return 1; }
  max_db_connections="$(jq -r '.maximum' <<< "$db_stats")"
  last_db_connections_timestamp="$(jq -r '.lastTimestamp' <<< "$db_stats")"
  current_db_connection_ratio="$(awk -v used="$max_db_connections" -v maximum="$max_connections" \
    'BEGIN {if (maximum<=0) exit 1; print used/maximum}')" \
    || { monitor_abort=database_connection_ratio_invalid; return 1; }
  max_db_connection_ratio="$current_db_connection_ratio"
  awk -v used="$max_db_connections" -v maximum="$max_connections" 'BEGIN {exit !(maximum>0 && used/maximum < 0.70)}' \
    || { monitor_abort=database_connection_threshold; return 1; }
  monitor_checks=$((monitor_checks + 1))
}

(
  run_capacity_mode a5-capacity "$capacity_log"
) &
capacity_pid=$!

# Discover through ECS using the exact marker. More than one task is always an abort.
for _ in $(seq 1 90); do
  marker_tasks="$(active_tasks "$capacity_started_by")" || { monitor_abort=capacity_task_discovery_failed; break; }
  [ "$(jq 'length' <<< "$marker_tasks")" -le 1 ] || { monitor_abort=multiple_capacity_tasks; break; }
  [ "$(jq 'length' <<< "$marker_tasks")" -eq 1 ] && break
  kill -0 "$capacity_pid" 2>/dev/null || break
  sleep 2
done

while kill -0 "$capacity_pid" 2>/dev/null; do
  if ! monitor_once; then
    stop_capacity_tasks || monitor_abort=capacity_task_stop_unproved
    break
  fi
  sleep 15
done

capacity_rc=0
wait "$capacity_pid" || capacity_rc=$?
capacity_pid=''
stop_capacity_tasks || monitor_abort=capacity_task_stop_unproved
cat "$capacity_log"
evidence="$(extract_artifact "$capacity_log" a5-capacity-mutating-v2)"
if [ -z "$monitor_abort" ]; then
  workload_completed_at="$(jq -er '.completedAt' <<< "$evidence" 2>/dev/null || true)"
  if [ -z "$workload_completed_at" ]; then
    monitor_abort=capacity_completion_timestamp_missing
  else
    post_run_metrics_covered=false
    while [ "$(elapsed_ms)" -lt 540000 ]; do
      monitor_once || break
      if monitor_watermarks_cover "$workload_completed_at"; then
        post_run_metrics_covered=true
        break
      fi
      sleep 15
    done
    [ "$post_run_metrics_covered" = 'true' ] \
      || monitor_abort="${monitor_abort:-post_run_metric_watermark_missing}"
  fi
fi

limits_filter='(.limits == {
  smokeRows:100,fullRows:5000,seedChunkRows:250,maxSeedRowsPerSecond:500,
  claimBatchSizes:[1,25],claimConcurrencies:[1,2,5],processingConcurrency:2,
  backlogDepths:[100,500,1000,2500,5000],samplesPerDepthAndShape:20,
  lockConcurrencies:[2,5,10],lockIterations:20,lockHoldMs:10,maxWallMs:600000,
  claimP95AbortMs:250,lockP95AbortMs:500,connectionRatioAbort:0.70,
  statementTimeoutMs:2000,lockTimeoutMs:500,idleInTransactionTimeoutMs:5000
})'
if [ "$capacity_rc" -eq 0 ] && [ -z "$monitor_abort" ] \
  && jq -e --arg baseline "$baseline_hash" "$limits_filter and .passed==true
    and .cleanupVerified==true and .failureCode==null and .elapsedMs<=600000
    and .expectedBaselineHash==\$baseline and .cleanup.afterBaselineHash==\$baseline" \
      <<< "$evidence" >/dev/null 2>&1; then
  cleanup_verified=true
  evidence_hash="$(jq -r '.evidenceHash' <<< "$evidence")"
  if restore_workers && [ "$worker_pause_verified" = 'true' ] \
    && [ "$worker_restore_verified" = 'true' ] && [ "$(elapsed_ms)" -le 600000 ]; then
    emit_pass_result
    result_hash="$(jq -r '.resultHash' "$result_file")"
    write_attempt READY_TO_SIGN "$evidence_hash" '' "$result_hash"
    controller_done=true
    echo "[u5-capacity] READY_TO_SIGN evidenceHash=$evidence_hash elapsedMs=$(elapsed_ms)"
    exit 0
  fi
  monitor_abort="${monitor_abort:-restore_or_wrapper_deadline_failed}"
fi

if run_cleanup; then
  cleanup_verified=true
  if restore_workers; then
    write_attempt FAILED '' "${monitor_abort:-capacity_task_failed}"
  else
    write_attempt FAILED_RESTORE '' "${monitor_abort:-capacity_task_failed}"
  fi
else
  write_attempt FAILED_CLEANUP '' "${monitor_abort:-capacity_task_failed}"
  echo 'ERROR: cleanup/baseline proof failed; workers intentionally remain paused' >&2
fi
controller_done=true
exit 1
