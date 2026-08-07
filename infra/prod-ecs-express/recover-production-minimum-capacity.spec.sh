#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
subject="$repo_root/infra/prod-ecs-express/recover-production-minimum-capacity.sh"
suite="$(mktemp -d "${TMPDIR:-/tmp}/production-capacity-recovery-spec.XXXXXX")"
trap 'rm -rf -- "$suite"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { printf 'ok - %s\n' "$1"; }

service_name() {
  case "$1" in
    api-web) printf '%s' watchdog-bms-api-web-pub ;;
    ai-gateway) printf '%s' watchdog-bms-ai-gateway-v2 ;;
    workers) printf '%s' watchdog-bms-workers ;;
  esac
}

repository() {
  case "$1" in
    api-web) printf '%s' watchdog-bms-api ;;
    ai-gateway) printf '%s' watchdog-bms-ai-gateway ;;
    workers) printf '%s' watchdog-bms-workers ;;
  esac
}

health_path() {
  [ "$1" = workers ] && printf '%s' /health || printf '%s' /v1/health
}

index_for() {
  case "$1" in api-web) printf 1 ;; ai-gateway) printf 2 ;; workers) printf 3 ;; esac
}

make_service() {
  local root="$1" name="$2" minimum="$3" generation="$4"
  local service repo health index arn revision endpoint image created
  service="$(service_name "$name")"
  repo="$(repository "$name")"
  health="$(health_path "$name")"
  index="$(index_for "$name")"
  arn="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/$service"
  revision="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/$service/${generation}00000000000000000${index}"
  endpoint="wa-${name//-/}${index}.ecs.ap-southeast-1.on.aws"
  image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/$repo@sha256:$(printf '%064d' "$index")"
  created="2026-08-03T0${index}:00:0${generation}Z"
  jq -cnS --arg arn "$arn" --arg revision "$revision" --arg health "$health" \
    --arg endpoint "$endpoint" --arg image "$image" --arg created "$created" \
    --arg index "$index" --argjson minimum "$minimum" '
    {serviceArn:$arn,status:"ACTIVE",currentDeployment:null,activeConfigurations:[{
      cpu:"512",createdAt:$created,
      executionRoleArn:("arn:aws:iam::311414082667:role/execution-"+$index),
      healthCheckPath:$health,ingressPaths:[{accessType:"PUBLIC",endpoint:$endpoint}],memory:"1024",
      networkConfiguration:{securityGroups:[("sg-0000000000000000"+$index)],subnets:[("subnet-0000000000000000"+$index)]},
      primaryContainer:{awsLogsConfiguration:{logGroup:("/ecs/"+$index),logStreamPrefix:"ecs"},
        containerPort:3001,environment:[{name:"GIT_SHA",value:("000000000000000000000000000000000000000"+$index)}],
        image:$image,secrets:[{name:"DATABASE_URL",valueFrom:("arn:aws:ssm:ap-southeast-1:311414082667:parameter/db-"+$index)}]},
      scalingTarget:{autoScalingMetric:"AVERAGE_CPU",autoScalingTargetValue:70,maxTaskCount:2,minTaskCount:$minimum},
      serviceRevisionArn:$revision,taskRoleArn:("arn:aws:iam::311414082667:role/task-"+$index)
    }]}' > "$root/service-$name-$generation.json"
}

make_revision() {
  local root="$1" name="$2" generation="$3" service index arn revision target task
  service="$(service_name "$name")"
  index="$(index_for "$name")"
  arn="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/$service"
  revision="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/$service/${generation}00000000000000000${index}"
  target="arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/tg-$name/000000000000000$index"
  task="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-prod-$service:$((100 + index))"
  jq -cnS --arg arn "$arn" --arg revision "$revision" --arg target "$target" --arg task "$task" \
    --arg index "$index" '
    {clusterArn:"arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod",
     guardDutyEnabled:true,launchType:"FARGATE",
     loadBalancers:[{containerName:"Main",containerPort:3001,targetGroupArn:$target}],
     networkConfiguration:{securityGroups:[("sg-0000000000000000"+$index)],subnets:[("subnet-0000000000000000"+$index)]},
     platformFamily:"Linux",platformVersion:"1.4.0",serviceArn:$arn,serviceRegistries:[],
     serviceRevisionArn:$revision,taskDefinition:$task}' > "$root/revision-$name-$generation.json"
}

make_fixture() {
  local label="$1" minimum="${2:-0}" root
  root="$suite/$label"
  mkdir -p "$root/bin"
  : > "$root/calls.log"
  for name in api-web ai-gateway workers; do
    make_service "$root" "$name" "$minimum" 1
    make_service "$root" "$name" 1 2
    make_revision "$root" "$name" 1
    make_revision "$root" "$name" 2
  done
  printf '%s' "$root"
}

cat > "$suite/aws" <<'FAKE_AWS'
#!/usr/bin/env bash
set -euo pipefail
root="${FAKE_STATE_DIR:?}"
scenario="${FAKE_SCENARIO:-normal}"
printf '%q ' "$@" >> "$root/calls.log"
printf '\n' >> "$root/calls.log"

arg() {
  local wanted="$1" previous=""
  shift
  for value in "$@"; do
    [ "$previous" = "$wanted" ] && { printf '%s' "$value"; return; }
    previous="$value"
  done
  return 1
}

name_from_service() {
  case "$1" in
    *watchdog-bms-api-web-pub*) printf api-web ;;
    *watchdog-bms-ai-gateway-v2*) printf ai-gateway ;;
    *watchdog-bms-workers*) printf workers ;;
    *) exit 90 ;;
  esac
}

service_arn() {
  case "$1" in
    api-web) printf 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub' ;;
    ai-gateway) printf 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2' ;;
    workers) printf 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers' ;;
  esac
}

case "$*" in
  "sts get-caller-identity"*)
    [ "$scenario" = wrong_account ] && printf '999999999999\n' || printf '311414082667\n'
    ;;
  "ssm get-parameter"*)
    parameter="$(arg --name "$@")"
    name=""
    case "$parameter" in
      *api-web*) name=api-web ;;
      *ai-gateway*) name=ai-gateway ;;
      *workers*) name=workers ;;
      *) exit 91 ;;
    esac
    if [[ "$parameter" == *service-arn ]]; then
      if [ "$scenario" = wrong_pointer ]; then printf 'arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/not-reviewed\n'
      else service_arn "$name"; printf '\n'; fi
    else
      endpoint="$(jq -r '.activeConfigurations[0].ingressPaths[0].endpoint' "$root/service-$name-1.json")"
      [ "$scenario" = url_mismatch ] && endpoint=wa-not-the-active-service.ecs.ap-southeast-1.on.aws
      printf 'https://%s\n' "$endpoint"
    fi
    ;;
  "ecs describe-express-gateway-service"*)
    arn="$(arg --service-arn "$@")"
    name="$(name_from_service "$arn")"
    count_file="$root/read-$name.count"
    count=0; [ ! -f "$count_file" ] || count="$(<"$count_file")"
    count=$((count + 1)); printf '%s' "$count" > "$count_file"
    if [ -f "$root/updated-$name" ]; then
      post_file="$root/post-$name.count"
      post=0; [ ! -f "$post_file" ] || post="$(<"$post_file")"
      post=$((post + 1)); printf '%s' "$post" > "$post_file"
      if [ "$post" -eq 1 ]; then
        jq -cS --arg deployment "arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/${arn##*/}/deployment-1" \
          '.currentDeployment=$deployment' "$root/service-$name-1.json"
      else
        filter='.'
        case "$scenario" in
          after_image_drift) filter='.activeConfigurations[0].primaryContainer.image |= sub("@sha256:"; "-changed@sha256:")' ;;
          after_env_drift) filter='.activeConfigurations[0].primaryContainer.environment[0].value="ffffffffffffffffffffffffffffffffffffffff"' ;;
          after_network_drift) filter='.activeConfigurations[0].networkConfiguration.subnets=["subnet-fffffffffffffffff"]' ;;
          final_image_drift) [ "$post" -ge 4 ] && filter='.activeConfigurations[0].primaryContainer.image |= sub("@sha256:"; "-late@sha256:")' ;;
        esac
        jq -cS "$filter" "$root/service-$name-2.json"
      fi
    else
      filter='.'
      case "$scenario" in
        wrong_service) filter='.serviceArn |= sub("watchdog-bms-prod/"; "watchdog-bms-prod/not-reviewed-")' ;;
        dual_revision) filter='.activeConfigurations += [(.activeConfigurations[0] | .serviceRevisionArn += "9")]' ;;
        min_invalid) filter='.activeConfigurations[0].scalingTarget.minTaskCount=2' ;;
        missing_config) filter='del(.activeConfigurations[0].cpu)' ;;
        extra_config) filter='.activeConfigurations[0].unexpected=true' ;;
        missing_nested_config) filter='del(.activeConfigurations[0].primaryContainer.environment[0].value)' ;;
        extra_nested_config) filter='.activeConfigurations[0].primaryContainer.secrets[0].unexpected=true' ;;
        pre_image_drift) filter='.activeConfigurations[0].primaryContainer.image |= sub("@sha256:"; "-changed@sha256:")' ;;
        pre_env_drift) filter='.activeConfigurations[0].primaryContainer.environment[0].value="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"' ;;
        pre_network_drift) filter='.activeConfigurations[0].networkConfiguration.securityGroups=["sg-fffffffffffffffff"]' ;;
        moving_read) [ $((count % 2)) -eq 0 ] && filter='.activeConfigurations[0].createdAt="2026-08-03T23:59:59Z"' ;;
      esac
      jq -cS "$filter" "$root/service-$name-1.json"
    fi
    ;;
  "ecs describe-service-revisions"*)
    revision="$(arg --service-revision-arns "$@")"
    name="$(name_from_service "$revision")"
    generation=1
    [[ "$revision" == */2* ]] && generation=2
    filter='.'
    [ "$scenario" = wrong_cluster ] && filter='.clusterArn="arn:aws:ecs:ap-southeast-1:311414082667:cluster/not-production"'
    [ "$scenario" = wrong_lb_container_port ] && filter='.loadBalancers[0].containerPort=3999'
    [ "$scenario" = after_task_definition_drift ] && [ "$generation" = 2 ] \
      && filter='.taskDefinition |= sub(":[0-9]+$"; ":999")'
    jq -cS "$filter" "$root/revision-$name-$generation.json"
    ;;
  "ecs update-express-gateway-service"*)
    request="$(arg --cli-input-json "$@")"; request="${request#file://}"
    arn="$(jq -r '.serviceArn' "$request")"; name="$(name_from_service "$arn")"
    printf 'update %s\n' "$name" >> "$root/updates.log"
    [ "$scenario" = failed_update ] && exit 42
    touch "$root/updated-$name"
    revision="$(jq -r '.activeConfigurations[0].serviceRevisionArn' "$root/service-$name-2.json")"
    [ "$scenario" = invalid_update_target ] && revision="${revision%/*}/invalid"
    jq -cnS --arg targetRevision "$revision" '{targetRevision:$targetRevision}'
    ;;
  "ecs list-tasks"*)
    service="$(arg --service-name "$@")"; name="$(name_from_service "$service")"
    index=1; [ "$name" = ai-gateway ] && index=2; [ "$name" = workers ] && index=3
    health_count_file="$root/health-$name.count"
    health_count=0; [ ! -f "$health_count_file" ] || health_count="$(<"$health_count_file")"
    health_count=$((health_count + 1)); printf '%s' "$health_count" > "$health_count_file"
    if [ "$scenario" = zero_post_tasks ] \
      || { [ "$scenario" = delayed_runtime_health ] && [ "$health_count" -eq 1 ]; }; then
      jq -cnS '{taskArns:[],nextToken:null}'
    else
      id="$(printf '%032x' "$index")"
      next=null; [ "$scenario" = paginated_tasks ] && next=more
      jq -cnS --arg task "arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/$id" \
        --arg next "$next" '{taskArns:[$task],nextToken:(if $next == "null" then null else $next end)}'
    fi
    ;;
  "ecs describe-tasks"*)
    task=""
    for value in "$@"; do [[ "$value" == arn:aws:ecs:*:task/* ]] && task="$value"; done
    id="${task##*/}"; index=$((16#${id: -1}))
    case "$index" in 1) name=api-web ;; 2) name=ai-gateway ;; 3) name=workers ;; *) exit 92 ;; esac
    task_definition="$(jq -r '.taskDefinition' "$root/revision-$name-2.json")"
    [ -f "$root/updated-$name" ] || task_definition="$(jq -r '.taskDefinition' "$root/revision-$name-1.json")"
    [ "$scenario" = wrong_running_task_definition ] && task_definition="${task_definition%:*}:999"
    ip="10.0.0.$index"
    jq -cnS --arg task "$task" --arg taskDefinition "$task_definition" \
      --arg group "service:$(service_arn "$name" | awk -F/ '{print $NF}')" --arg ip "$ip" '
      {failures:[],tasks:[{taskArn:$task,taskDefinitionArn:$taskDefinition,group:$group,
       desiredStatus:"RUNNING",lastStatus:"RUNNING",attachments:[{type:"ElasticNetworkInterface",
       details:[{name:"privateIPv4Address",value:$ip}]}]}]}'
    ;;
  "elbv2 describe-target-health"*)
    group="$(arg --target-group-arn "$@")"
    case "$group" in *tg-api-web*) index=1 ;; *tg-ai-gateway*) index=2 ;; *tg-workers*) index=3 ;; *) exit 93 ;; esac
    state=healthy; [ "$scenario" = unhealthy_target ] && state=unhealthy
    ip="10.0.0.$index"; [ "$scenario" = target_task_mismatch ] && ip="10.9.9.$index"
    port=3001; [ "$scenario" = wrong_target_port ] && port=3999
    jq -cnS --arg ip "$ip" --arg state "$state" --argjson port "$port" \
      '{TargetHealthDescriptions:[{Target:{Id:$ip,Port:$port},TargetHealth:{State:$state}}]}'
    ;;
  *) echo "unexpected fake AWS call: $*" >&2; exit 94 ;;
esac
FAKE_AWS
chmod +x "$suite/aws"

cat > "$suite/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "${FAKE_STATE_DIR:?}/calls.log"; printf '\n' >> "$FAKE_STATE_DIR/calls.log"
scenario="${FAKE_SCENARIO:-normal}"
[ "$scenario" = curl_failure ] && exit 22
output=""
previous=""
for value in "$@"; do
  [ "$previous" = --output ] && output="$value"
  previous="$value"
done
[ -n "$output" ] || exit 95
case "$scenario" in
  http_unhealthy) printf '{"status":"degraded"}\n' > "$output" ;;
  oversized_http_body) printf '{"status":"ok","padding":"' > "$output"; head -c 17000 /dev/zero | tr '\0' x >> "$output"; printf '"}\n' >> "$output" ;;
  *) printf '{"status":"ok"}\n' > "$output" ;;
esac
case "$scenario" in
  http_201) printf 201 ;;
  http_202) printf 202 ;;
  http_302) printf 302 ;;
  *) printf 200 ;;
esac
FAKE_CURL
chmod +x "$suite/curl"

run_subject() {
  local root="$1" scenario="$2"
  shift 2
  AWS_BIN="$suite/aws" CURL_BIN="$suite/curl" FAKE_STATE_DIR="$root" FAKE_SCENARIO="$scenario" \
    RECOVERY_STABILITY_SECONDS=0 RECOVERY_POLL_SECONDS=0 RECOVERY_POLL_ATTEMPTS=3 \
    bash "$subject" "$@"
}

plan_fixture() {
  local root="$1" scenario="${2:-normal}" output
  output="$root/plan"
  mkdir "$output"
  run_subject "$root" "$scenario" plan "$output" > "$root/plan.stdout" 2> "$root/plan.stderr" \
    || { cat "$root/plan.stderr" >&2; tail -20 "$root/calls.log" >&2; return 1; }
  sed -n 's/^PLAN_SHA256=//p' "$root/plan.stdout"
}

expect_plan_failure() {
  local scenario="$1" root
  root="$(make_fixture "plan-$scenario")"
  mkdir "$root/plan"
  if run_subject "$root" "$scenario" plan "$root/plan" >"$root/stdout" 2>"$root/stderr"; then
    fail "$scenario plan unexpectedly succeeded"
  fi
  [ ! -s "$root/updates.log" ] || fail "$scenario plan made an update call"
  pass "plan rejects $scenario without mutation"
}

expect_apply_failure() {
  local scenario="$1" root hash
  root="$(make_fixture "apply-$scenario")"
  hash="$(plan_fixture "$root")"
  mkdir "$root/apply"
  if run_subject "$root" "$scenario" apply "$root/plan/production-minimum-capacity-plan.json" \
      "$hash" "$root/apply" >"$root/apply.stdout" 2>"$root/apply.stderr"; then
    fail "$scenario apply unexpectedly succeeded"
  fi
  pass "apply fails closed for $scenario"
}

for scenario in wrong_account wrong_pointer wrong_service wrong_cluster dual_revision moving_read \
  min_invalid missing_config extra_config missing_nested_config extra_nested_config wrong_lb_container_port; do
  expect_plan_failure "$scenario"
done

for scenario in pre_image_drift pre_env_drift pre_network_drift; do
  root="$(make_fixture "pre-$scenario")"
  hash="$(plan_fixture "$root")"
  mkdir "$root/apply"
  if run_subject "$root" "$scenario" apply "$root/plan/production-minimum-capacity-plan.json" \
      "$hash" "$root/apply" >"$root/apply.stdout" 2>"$root/apply.stderr"; then
    fail "$scenario unexpectedly succeeded"
  fi
  [ ! -s "$root/updates.log" ] || fail "$scenario mutated before rejecting approved-plan drift"
  pass "apply rejects $scenario before the first mutation"
done

for scenario in after_image_drift after_env_drift after_network_drift after_task_definition_drift \
  final_image_drift failed_update invalid_update_target zero_post_tasks unhealthy_target \
  target_task_mismatch wrong_target_port paginated_tasks wrong_running_task_definition url_mismatch \
  http_unhealthy http_201 http_202 http_302 oversized_http_body curl_failure; do
  expect_apply_failure "$scenario"
done

root="$(make_fixture success)"
hash="$(plan_fixture "$root")"
mkdir "$root/apply"
run_subject "$root" normal apply "$root/plan/production-minimum-capacity-plan.json" \
  "$hash" "$root/apply" > "$root/apply.stdout"
[ "$(grep -c '^update ' "$root/updates.log")" = 3 ] || fail "success did not make exactly three update calls"
jq -e --arg hash "$hash" '
  .schemaVersion == 1 and .planSha256 == $hash and .mutationCount == 3
  and (.services | map(.name)) == ["api-web","ai-gateway","workers"]
  and all(.services[]; .action == "UPDATE_MINIMUM"
    and .updateResult.targetRevision != null
    and (.runtimeHealth.runningTaskArns | length) == 1
    and .runtimeHealth.runningTaskPrivateIps == [.runtimeHealth.targetHealth.TargetHealthDescriptions[0].Target.Id]
    and .runtimeHealth.containerName == "Main" and .runtimeHealth.containerPort == 3001
    and .runtimeHealth.healthyTargets == [{privateIp:.runtimeHealth.runningTaskPrivateIps[0],port:3001,state:"healthy"}]
    and (.runtimeHealth.healthUrl | test("^https://wa-[a-z0-9]+[123]\\.ecs\\.ap-southeast-1\\.on\\.aws/(v1/health|health)$"))
    and (if .name == "workers"
      then .runtimeHealth.healthPath == "/health" and (.runtimeHealth.healthUrl | endswith("/health"))
      else .runtimeHealth.healthPath == "/v1/health" and (.runtimeHealth.healthUrl | endswith("/v1/health"))
      end)
    and .runtimeHealth.httpStatus == 200 and .runtimeHealth.httpBody.status == "ok")
' "$root/apply/production-minimum-capacity-result.json" >/dev/null || fail "success result contract is invalid"
pass "transitional rollout settles and exact min-only recovery records healthy runtime evidence"

root="$(make_fixture delayed-runtime)"
hash="$(plan_fixture "$root")"
mkdir "$root/apply"
run_subject "$root" delayed_runtime_health apply "$root/plan/production-minimum-capacity-plan.json" \
  "$hash" "$root/apply" > "$root/apply.stdout" 2> "$root/apply.stderr"
jq -e '.mutationCount == 3 and all(.services[]; .runtimeHealth.httpStatus == 200)' \
  "$root/apply/production-minimum-capacity-result.json" >/dev/null \
  || fail "delayed runtime health did not settle"
pass "runtime health polling tolerates bounded startup lag"

root="$(make_fixture replay 1)"
hash="$(plan_fixture "$root")"
mkdir "$root/apply"
run_subject "$root" normal apply "$root/plan/production-minimum-capacity-plan.json" \
  "$hash" "$root/apply" > "$root/apply.stdout"
[ ! -s "$root/updates.log" ] || fail "healthy min=1 replay called update"
jq -e '
  .mutationCount == 0 and all(.services[]; .action == "VERIFY_ONLY" and .updateResult == null
    and .runtimeHealth.httpStatus == 200)
' "$root/apply/production-minimum-capacity-result.json" >/dev/null || fail "replay result is invalid"
pass "healthy min=1 replay is read-only"

root="$(make_fixture hash-binding)"
hash="$(plan_fixture "$root")"
mkdir "$root/apply"
wrong_hash="f${hash:1}"
[ "${hash:0:1}" = f ] && wrong_hash="0${hash:1}"
if run_subject "$root" normal apply "$root/plan/production-minimum-capacity-plan.json" \
    "$wrong_hash" "$root/apply" >"$root/apply.stdout" 2>"$root/apply.stderr"; then
  fail "explicit plan hash mismatch unexpectedly succeeded"
fi
[ ! -s "$root/updates.log" ] || fail "hash mismatch mutated"
pass "embedded and explicit plan SHA must both match"

echo "production minimum-capacity recovery specs passed"
