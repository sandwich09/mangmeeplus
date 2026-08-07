#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
collector="$root/infra/security/collect-production-a5-current-health.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-health-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

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

if [ "$service $operation" = "sts get-caller-identity" ]; then
  printf '311414082667\n'
  exit 0
fi

case "$args" in
  *watchdog-bms-ai-gateway-v2*|*ecs-express-ai-gateway-url*|*aaaaaaaaaaaaaaaa*)
    key=ai-gateway; name=watchdog-bms-ai-gateway-v2; path=/v1/health; octet=11; digit=a ;;
  *watchdog-bms-api-web-pub*|*ecs-express-api-web-url*|*bbbbbbbbbbbbbbbb*)
    key=api-web; name=watchdog-bms-api-web-pub; path=/v1/health; octet=12; digit=b ;;
  *watchdog-bms-workers*|*ecs-express-workers-url*|*cccccccccccccccc*)
    key=workers; name=watchdog-bms-workers; path=/health; octet=13; digit=c ;;
  *) key=unknown; name=unknown; path=/health; octet=99; digit=f ;;
esac
host="${name}.example.com"
endpoint="https://${host}"
service_arn="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/${name}"
revision="arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/${name}/1"
definition="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-prod-${key}:1"
task="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}"
eni="eni-${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}"
ip="10.0.0.${octet}"
target="arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/${name}/${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}${digit}"
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
      --arg target "$target" --arg path "$path" --argjson scaling "$scale" \
      --argjson current "$current" '{service:{serviceArn:$arn,status:{statusCode:"ACTIVE"},
        currentDeployment:$current,activeConfigurations:[{serviceRevisionArn:$revision,
        scalingTarget:$scaling,healthCheckPath:$path,primaryContainer:{containerPort:3000},
        ingressPaths:[{accessType:"PUBLIC",endpoint:$host,targetGroups:[{arn:$target}]}]}]}}' ;;
  "ecs describe-service-revisions")
    jq -cn --arg arn "$service_arn" --arg revision "$revision" --arg definition "$definition" \
      --arg host "$host" --arg target "$target" --argjson scaling "$scale" \
      '{serviceRevisions:[{serviceArn:$arn,serviceRevisionArn:$revision,taskDefinition:$definition,
        resolvedConfiguration:{scalingTarget:$scaling},loadBalancers:[{targetGroupArn:$target,
        containerName:"Main",containerPort:3000}],ecsManagedResources:{ingressPaths:[{
        accessType:"PUBLIC",endpoint:$host,targetGroups:[{arn:$target}]}]}}]}' ;;
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
      TargetGroupArn:$target,TargetType:"ip",Port:3000,HealthCheckPath:$path}]}' ;;
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
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --proto) [ "$2" = '=https' ]; seen_proto=true; shift 2 ;;
    --max-filesize) [ "$2" = 16384 ]; seen_bound=true; shift 2 ;;
    *) shift ;;
  esac
done
[ "$seen_proto" = true ] && [ "$seen_bound" = true ] && [ -n "$output" ]
printf '{"details":"ready","status":"ok"}\n' > "$output"
if [ "${FAKE_HEALTH_MODE:-ok}" = http ]; then printf '201'; else printf '200'; fi
FAKE_CURL
chmod +x "$fake_aws" "$fake_curl"

run_case() {
  local mode="$1" output="$2" state="$3"
  local command=(bash)
  [ "${SPEC_TRACE:-false}" != true ] || command+=( -x )
  mkdir "$output" "$state"
  FAKE_HEALTH_MODE="$mode" FAKE_STATE_DIR="$state" AWS_BIN="$fake_aws" CURL_BIN="$fake_curl" \
    A5_HEALTH_STABILITY_SECONDS=0 "${command[@]}" "$collector" "$output"
}

success="$work/success"
result_path="$(run_case ok "$success" "$work/state-ok")"
[ "$result_path" = "$success/current-health.json" ]
jq -e '
  .status=="PASS" and (.services|map(.service))==["ai-gateway","api-web","workers"]
  and all(.services[];.scalingTarget=={minTaskCount:1,maxTaskCount:2,
    autoScalingMetric:"AVERAGE_CPU",autoScalingTargetValue:70}
    and .healthBody=={details:"ready",status:"ok"}
    and .runningTaskPrivateIps==[.targetHealth[].privateIp])
' "$result_path" >/dev/null
if command -v sha256sum >/dev/null 2>&1; then
  actual_services_hash="$(jq -cjS '.services' "$result_path" | sha256sum | awk '{print $1}')"
else
  actual_services_hash="$(jq -cjS '.services' "$result_path" | shasum -a 256 | awk '{print $1}')"
fi
[ "$(jq -r '.servicesHash' "$result_path")" = "$actual_services_hash" ]

for mode in unstable scale target-ip group http; do
  if run_case "$mode" "$work/out-$mode" "$work/state-$mode" >/dev/null 2>&1; then
    echo "ERROR: current-health collector accepted adversarial mode $mode" >&2
    exit 1
  fi
done

grep -Fq -- "--service-name \"\$service_name\"" "$collector"
grep -Fq -- "--proto '=https'" "$collector"
grep -Fq -- "--max-filesize 16384" "$collector"
printf 'production-a5-current-health.spec: PASS\n'
