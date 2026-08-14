#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
collector="$root/infra/security/collect-production-a5-current-health.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-health-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
fixture_created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

fake_aws="$work/aws"
fake_curl="$work/curl"

cat > "$fake_aws" <<'FAKE_AWS'
#!/usr/bin/env bash
set -euo pipefail
service="$1"
operation="$2"
shift 2
args=" $* "
mode="${FAKE_HEALTH_MODE:-ok}"
created_at="${FAKE_HEALTH_CREATED_AT:?}"

if [ "$service $operation" = "sts get-caller-identity" ]; then
  printf '311414082667\n'
  exit 0
fi

case "$args" in
  *watchdog-bms-ai-gateway-v2*|*ecs-express-ai-gateway-url*|*aaaaaaaaaaaaaaaa*)
    key=ai-gateway; name=watchdog-bms-ai-gateway-v2; path=/v1/health; octet=11; digit=a
    source_sha=eb515b9e1e92ca970bd14c67fdeebb6f859cf838
    image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-ai-gateway@sha256:8a159d8e1f3047ec0698f8b4e5209502129f2b2ebed8ba9e043abeff1bce3011"
    controls='[{"name":"MODEL_PROVIDER","value":"bedrock"},{"name":"APPROVED_AI_PROVIDERS","value":"bedrock,openai,typhoon"},{"name":"AI_GLOBAL_INFERENCE_PROFILE_APPROVED","value":"true"},{"name":"AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF","value":"DPO-2026-07-23-bedrock-global"},{"name":"LINE_AI_AGENT_ORCHESTRATION_ENABLED","value":"true"},{"name":"LINE_AI_TOOLUSE_LOOP_ENABLED","value":"true"},{"name":"LINE_AI_COVERAGE_CRITIC_ENABLED","value":"true"},{"name":"AI_GATEWAY_ENABLED","value":"true"},{"name":"AI_AGENT_REGISTRY_ENABLED","value":"true"},{"name":"AI_TOOL_POLICY_ENFORCED","value":"true"},{"name":"AI_TOOL_AUDIT_ENABLED","value":"true"},{"name":"AI_FINAL_MUTATION_ENABLED","value":"false"},{"name":"AI_PROMPT_LOGGING_ENABLED","value":"false"}]' ;;
  *watchdog-bms-api-web-pub*|*ecs-express-api-web-url*|*bbbbbbbbbbbbbbbb*)
    key=api-web; name=watchdog-bms-api-web-pub; path=/v1/health; octet=12; digit=b
    source_sha=eb515b9e1e92ca970bd14c67fdeebb6f859cf838
    image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:9c655e1a06ba0d4acb4bcfbd2975aac57ef5e34ef25cc455ae8e1c1f59c46e1c"
    controls='[{"name":"AI_GATEWAY_ENABLED","value":"true"},{"name":"CRM_AUTO_REPLY_ENABLED","value":"true"},{"name":"LINE_AI_LEDGER_ENABLED","value":"true"},{"name":"REIMBURSEMENT_WRITE_QUIESCE","value":"false"}]' ;;
  *watchdog-bms-workers*|*ecs-express-workers-url*|*cccccccccccccccc*)
    key=workers; name=watchdog-bms-workers; path=/health; octet=13; digit=c
    source_sha=0bdbe5088c2e121b74c74da9f28bf2a64e3576d7
    image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-workers@sha256:e9495744a9708d04c06564f6ddb2fd66342c3ccca87efd77d7e02fdce786c23f"
    controls='[{"name":"QUEUE_ENABLED","value":"true"}]' ;;
  *) key=unknown; name=unknown; path=/health; octet=99; digit=f ;;
esac
[ "$mode" != legacy-source ] || source_sha="dddddddddddddddddddddddddddddddddddddddd"
[ "$mode" != legacy-image ] || image="${image%@sha256:*}@sha256:$(printf 'd%.0s' {1..64})"
[ "$mode" != legacy-control ] || controls='[]'
if [ "$mode" = legacy-omitted-control-drift ] && [ "$key" = ai-gateway ]; then
  controls="$(jq -c 'map(if .name=="AI_PROMPT_LOGGING_ENABLED" then .value="true" else . end)' <<< "$controls")"
fi
mode_environment='[]'
if [ "$mode" = explicit ] || [ "$mode" = explicit-bad-control ] \
    || [ "$mode" = explicit-disabled-live ]; then
  mode_environment='[{"name":"PRODUCTION_SERVING_MODE","value":"live"}]'
fi
[ "$mode" != duplicate-mode ] || mode_environment='[{"name":"PRODUCTION_SERVING_MODE","value":"live"},{"name":"PRODUCTION_SERVING_MODE","value":"live"}]'
if [ "$mode" = explicit ] || [ "$mode" = explicit-bad-control ] \
    || [ "$mode" = explicit-disabled-live ]; then
  case "$key" in
    api-web) controls='[{"name":"GLOBAL_MAINTENANCE_MODE","value":"false"},{"name":"AI_GATEWAY_ENABLED","value":"true"},{"name":"LINE_AI_LEDGER_ENABLED","value":"true"},{"name":"REIMBURSEMENT_WRITE_QUIESCE","value":"false"},{"name":"CRM_AUTO_REPLY_ENABLED","value":"true"}]' ;;
    ai-gateway) controls='[{"name":"MODEL_PROVIDER","value":"bedrock"},{"name":"APPROVED_AI_PROVIDERS","value":"bedrock,openai"},{"name":"AI_GLOBAL_INFERENCE_PROFILE_APPROVED","value":"true"},{"name":"AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF","value":"DPO-2026-07-23-bedrock-global"},{"name":"LINE_AI_AGENT_ORCHESTRATION_ENABLED","value":"true"},{"name":"LINE_AI_TOOLUSE_LOOP_ENABLED","value":"true"},{"name":"LINE_AI_COVERAGE_CRITIC_ENABLED","value":"true"},{"name":"AI_GATEWAY_ENABLED","value":"true"},{"name":"AI_AGENT_REGISTRY_ENABLED","value":"true"},{"name":"AI_TOOL_POLICY_ENFORCED","value":"true"},{"name":"AI_TOOL_AUDIT_ENABLED","value":"true"},{"name":"AI_FINAL_MUTATION_ENABLED","value":"false"},{"name":"AI_PROMPT_LOGGING_ENABLED","value":"false"}]' ;;
    workers) controls='[{"name":"QUEUE_ENABLED","value":"true"}]' ;;
  esac
  if [ "$mode" = explicit-bad-control ] && [ "$key" = workers ]; then
    controls='[{"name":"QUEUE_ENABLED","value":"false"}]'
  fi
  if [ "$mode" = explicit-disabled-live ] && [ "$key" = ai-gateway ]; then
    controls="$(jq -c 'map(if .name=="MODEL_PROVIDER" then .value="disabled" else . end)' <<< "$controls")"
  fi
fi
if [ "$mode" = quiesced ] || [ "$mode" = quiesced-missing-approval-ref ]; then
  mode_environment='[{"name":"PRODUCTION_SERVING_MODE","value":"maintenance_only"}]'
  case "$key" in
    api-web) controls='[{"name":"GLOBAL_MAINTENANCE_MODE","value":"true"},{"name":"AI_GATEWAY_ENABLED","value":"false"},{"name":"LINE_AI_LEDGER_ENABLED","value":"false"},{"name":"REIMBURSEMENT_WRITE_QUIESCE","value":"true"},{"name":"CRM_AUTO_REPLY_ENABLED","value":"false"}]' ;;
    ai-gateway) controls='[{"name":"MODEL_PROVIDER","value":"disabled"},{"name":"APPROVED_AI_PROVIDERS","value":"bedrock,openai"},{"name":"AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF","value":"DPO-2026-07-23-bedrock-global"},{"name":"LINE_AI_AGENT_ORCHESTRATION_ENABLED","value":"false"},{"name":"LINE_AI_TOOLUSE_LOOP_ENABLED","value":"false"},{"name":"LINE_AI_COVERAGE_CRITIC_ENABLED","value":"false"},{"name":"AI_GATEWAY_ENABLED","value":"false"},{"name":"AI_AGENT_REGISTRY_ENABLED","value":"false"},{"name":"AI_TOOL_POLICY_ENFORCED","value":"false"},{"name":"AI_TOOL_AUDIT_ENABLED","value":"false"},{"name":"AI_FINAL_MUTATION_ENABLED","value":"false"},{"name":"AI_PROMPT_LOGGING_ENABLED","value":"false"}]' ;;
    workers) controls='[{"name":"QUEUE_ENABLED","value":"false"}]' ;;
  esac
  if [ "$mode" = quiesced-missing-approval-ref ] && [ "$key" = ai-gateway ]; then
    controls="$(jq -c 'map(select(.name!="AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF"))' <<< "$controls")"
  fi
fi
host="${name}.example.com"
endpoint="https://${host}"
service_arn="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/${name}"
revision_id=1
if [ "$mode" = quiesced ] && [ "$key" = workers ]; then revision_id=0604148482324959430; fi
if [ "$mode" = revision-alpha ] && [ "$key" = workers ]; then revision_id=a1; fi
revision="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/${name}/${revision_id}"
definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-prod-${key}:1"
task="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}"
eni="eni-${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}"
ip="10.0.0.${octet}"
target="arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/${name}/${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}"
alternate_target="arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/${name}-alternate/${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}"
max=2
[ "$mode" = scale ] && max=3
scale="$(jq -cn --argjson max "$max" '{minTaskCount:1,maxTaskCount:$max,autoScalingMetric:"AVERAGE_CPU",autoScalingTargetValue:70}')"

case "$service $operation" in
  "ssm get-parameter")
    parameter="$(printf '%s\n' "$args" | sed -n 's/.* --name \([^ ]*\).*/\1/p')"
    jq -cn --arg name "$parameter" --arg value "$endpoint" \
      '{Parameter:{Name:$name,Type:"String",Value:$value}}' ;;
  "ecs describe-express-gateway-service")
    counter="$FAKE_STATE_DIR/express-${key}"
    count=0
    [ ! -f "$counter" ] || read -r count < "$counter"
    count=$((count + 1))
    printf '%s\n' "$count" > "$counter"
    current=null
    [ "$mode" != unstable ] || [ "$count" -eq 1 ] || current='{"deploymentId":"changed"}'
    jq -cn --arg arn "$service_arn" --arg revision "$revision" --arg host "$host" \
      --arg path "$path" --argjson scaling "$scale" --argjson controls "$controls" \
      --argjson modeEnvironment "$mode_environment" \
      --arg source "$source_sha" --arg image "$image" --arg created "$created_at" \
      --argjson current "$current" '{service:{serviceArn:$arn,status:{statusCode:"ACTIVE"},
        currentDeployment:$current,activeConfigurations:[{serviceRevisionArn:$revision,
        createdAt:$created,scalingTarget:$scaling,healthCheckPath:$path,
        primaryContainer:{containerPort:3000,image:$image,
          environment:([{name:"GIT_SHA",value:$source}]+$controls+$modeEnvironment)},
        ingressPaths:[{accessType:"PUBLIC",endpoint:$host}]}]}}' ;;
  "ecs describe-service-revisions")
    jq -cn --arg arn "$service_arn" --arg revision "$revision" --arg definition "$definition" \
      --arg host "$host" --arg target "$target" --arg alternate "$alternate_target" \
      --arg path "$path" --argjson scaling "$scale" \
      '{serviceRevisions:[{serviceArn:$arn,serviceRevisionArn:$revision,taskDefinition:$definition,
        resolvedConfiguration:{loadBalancers:[{productionListenerRule:"listener-rule",
          targetGroupArn:$target}]},loadBalancers:[{targetGroupArn:$alternate,
        containerName:"Main",containerPort:3000,
        advancedConfiguration:{alternateTargetGroupArn:$target}}],ecsManagedResources:{autoScaling:{
          scalableTarget:{arn:"scalable-target",minCapacity:$scaling.minTaskCount,
            maxCapacity:$scaling.maxTaskCount,status:"ACTIVE",updatedAt:"now"},
          applicationAutoScalingPolicies:[{arn:"scaling-policy",metric:$scaling.autoScalingMetric,
            policyType:"TargetTrackingScaling",status:"ACTIVE",
            targetValue:$scaling.autoScalingTargetValue,updatedAt:"now"}]},ingressPaths:[{
        accessType:"PUBLIC",endpoint:$host,targetGroups:[
          {arn:$target,healthCheckPath:$path,healthCheckPort:3000,port:0,status:"ACTIVE"},
          {arn:$alternate,healthCheckPath:$path,healthCheckPort:3000,port:3000,status:"ACTIVE"}]}]}}]}' ;;
  "ecs list-tasks") jq -cn --arg task "$task" '{taskArns:[$task]}' ;;
  "ecs describe-tasks")
    group="service:${name}"
    [ "$mode" != group ] || group=service:wrong
    jq -cn --arg task "$task" --arg definition "$definition" --arg group "$group" \
      --arg eni "$eni" --arg ip "$ip" '{failures:[],tasks:[{taskArn:$task,
      taskDefinitionArn:$definition,lastStatus:"RUNNING",desiredStatus:"RUNNING",group:$group,
      attachments:[{type:"ElasticNetworkInterface",details:[{name:"networkInterfaceId",value:$eni},
      {name:"privateIPv4Address",value:$ip}]}]}]}' ;;
  "ec2 describe-network-interfaces")
    jq -cn --arg eni "$eni" --arg ip "$ip" '{NetworkInterfaces:[{
      NetworkInterfaceId:$eni,PrivateIpAddress:$ip,Status:"in-use"}]}' ;;
  "elbv2 describe-target-groups")
    jq -cn --arg target "$target" --arg path "$path" '{TargetGroups:[{
      TargetGroupArn:$target,TargetType:"ip",Protocol:"HTTP",Port:80,
      HealthCheckPort:"3000",HealthCheckPath:$path}]}' ;;
  "elbv2 describe-target-health")
    target_ip="$ip"
    [ "$mode" != target-ip ] || target_ip=10.9.9.9
    jq -cn --arg ip "$target_ip" '{TargetHealthDescriptions:[{
      Target:{Id:$ip,Port:3000},TargetHealth:{State:"healthy"}}]}' ;;
  *) printf 'unexpected fake AWS call: %s %s%s\n' "$service" "$operation" "$args" >&2; exit 90 ;;
esac
FAKE_AWS

cat > "$fake_curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
output=''
seen_proto=false
seen_bound=false
retry=false
retry_delay=false
retry_max_time=false
retry_all_errors=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --proto) [ "$2" = '=https' ]; seen_proto=true; shift 2 ;;
    --max-filesize) [ "$2" = 16384 ]; seen_bound=true; shift 2 ;;
    --retry) [ "$2" = 2 ]; retry=true; shift 2 ;;
    --retry-delay) [ "$2" = 2 ]; retry_delay=true; shift 2 ;;
    --retry-max-time) [ "$2" = 70 ]; retry_max_time=true; shift 2 ;;
    --retry-all-errors) retry_all_errors=true; shift ;;
    *) shift ;;
  esac
done
[ "$seen_proto$seen_bound$retry$retry_delay$retry_max_time$retry_all_errors" = truetruetruetruetruetrue ]
[ -n "$output" ]
printf '{"details":"ready","status":"ok"}\n' > "$output"
if [ "${FAKE_HEALTH_MODE:-ok}" = http ]; then printf '201'; else printf '200'; fi
FAKE_CURL
chmod +x "$fake_aws" "$fake_curl"

run_case() {
  local mode="$1" output="$2" state="$3"
  local command=(bash)
  [ "${SPEC_TRACE:-false}" != true ] || command+=( -x )
  mkdir "$output" "$state"
  FAKE_HEALTH_MODE="$mode" FAKE_HEALTH_CREATED_AT="$fixture_created_at" \
    FAKE_STATE_DIR="$state" AWS_BIN="$fake_aws" CURL_BIN="$fake_curl" \
    A5_HEALTH_STABILITY_SECONDS=0 "${command[@]}" "$collector" "$output"
}

success="$work/success"
result_path="$(run_case ok "$success" "$work/state-ok")"
[ "$result_path" = "$success/current-health.json" ]
jq -e '
  .status=="PASS" and (.services|map(.service))==["ai-gateway","api-web","workers"]
  and all(.services[];.servingMode=="live"
    and .scalingTarget=={minTaskCount:1,maxTaskCount:2,
    autoScalingMetric:"AVERAGE_CPU",autoScalingTargetValue:70}
    and .healthBody=={details:"ready",status:"ok"}
    and (.rawEvidence.describeExpressGatewayService.raw.second.service
      .activeConfigurations[0].ingressPaths[0]|has("targetGroups")|not)
    and (.rawEvidence.describeServiceRevisions.raw.serviceRevisions[0]
      .ecsManagedResources.ingressPaths[0].targetGroups|length)==2
    and .runningTaskPrivateIps==[.targetHealth[].privateIp])
' "$result_path" >/dev/null
if command -v sha256sum >/dev/null 2>&1; then
  actual_services_hash="$(jq -cjS '.services' "$result_path" | sha256sum | awk '{print $1}')"
else
  actual_services_hash="$(jq -cjS '.services' "$result_path" | shasum -a 256 | awk '{print $1}')"
fi
[ "$(jq -r '.servicesHash' "$result_path")" = "$actual_services_hash" ]

explicit="$work/explicit"
explicit_path="$(run_case explicit "$explicit" "$work/state-explicit")"
jq -e 'all(.services[];.servingMode=="live")' "$explicit_path" >/dev/null

for mode in unstable scale target-ip group http legacy-source legacy-image legacy-control \
    legacy-omitted-control-drift duplicate-mode explicit-bad-control explicit-disabled-live \
    quiesced-missing-approval-ref revision-alpha; do
  if run_case "$mode" "$work/out-$mode" "$work/state-$mode" >/dev/null 2>&1; then
    echo "ERROR: current-health collector accepted adversarial mode $mode" >&2
    exit 1
  fi
done

grep -Fq -- "--service-name \"\$service_name\"" "$collector"
grep -Fq -- "--proto '=https'" "$collector"
grep -Fq -- "--max-filesize 16384" "$collector"

capture="$root/infra/security/capture-production-a5-live-state.sh"
final_source="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
bridge_source="eb515b9e1e92ca970bd14c67fdeebb6f859cf838"
bridge_image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:9c655e1a06ba0d4acb4bcfbd2975aac57ef5e34ef25cc455ae8e1c1f59c46e1c"
final_image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:$(printf 'e%.0s' {1..64})"
quiesced="$work/quiesced"
quiesced_path="$(run_case quiesced "$quiesced" "$work/state-quiesced")"
pre="$work/pre"
mkdir "$pre"
bash "$capture" pre "$quiesced_path" "$bridge_source" "$bridge_image" \
  "$final_source" "$final_image" "$pre"
post="$work/post"
mkdir "$post"
bash "$capture" post-migration "$quiesced_path" "$pre/reimbursement-quiesce.json" \
  "$(printf 'a%.0s' {1..64})" "$post"
jq -e --slurpfile pre "$pre/reimbursement-quiesce.json" \
  '.status=="BRIDGE_ONLY_QUIESCED_POST_MIGRATION" and .bridgeProof==$pre[0].bridgeProof' \
  "$post/reimbursement-quiesce.json" >/dev/null

moved_health="$work/moved-health.json"
jq '(.services[]|select(.service=="api-web").runningTaskArns)=[
  "arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/dddddddddddddddddddddddddddddddd"]' \
  "$quiesced_path" > "$moved_health"
mkdir "$work/moved-post"
if bash "$capture" post-migration "$moved_health" "$pre/reimbursement-quiesce.json" \
  "$(printf 'a%.0s' {1..64})" "$work/moved-post" >/dev/null 2>&1; then
  echo "ERROR: POST_MIGRATION capture accepted a moved bridge task set" >&2
  exit 1
fi
printf 'production-a5-current-health.spec: PASS\n'
