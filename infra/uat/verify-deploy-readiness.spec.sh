#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
script="$repo_root/infra/uat/verify-deploy-readiness.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-uat-readiness.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
service=""
secret=""
parameter=""
for ((i=1; i<=$#; i++)); do
  case "${!i}" in
    --service-arn|--services|--secret-id|--name)
      next=$((i + 1))
      case "${!i}" in
        --service-arn|--services) service="${!next}" ;;
        --secret-id) secret="${!next}" ;;
        --name) parameter="${!next}" ;;
      esac
      ;;
  esac
done
case "$1/$2" in
  sts/get-caller-identity) echo 311414082667 ;;
  ssm/get-parameter)
    component="${parameter#*/watchdog-bms/uat/ecs-express-}"
    component="${component%-service-arn}"
    echo "arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/watchdog-bms-uat-${component}"
    ;;
  ecs/describe-express-gateway-service)
    name="${service##*/}"
    active='[{"serviceRevisionArn":"arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/'"$name"'/1","primaryContainer":{"image":"repo@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","environment":[{"name":"GIT_SHA","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]},"networkConfiguration":{"securityGroups":["sg-1"],"subnets":["subnet-1"]},"scalingTarget":{"minTaskCount":1,"maxTaskCount":2}}]'
    [ "${FAKE_DUAL_ACTIVE:-false}" = true ] && active="$(jq -c '. + [.[0]]' <<< "$active")"
    printf '{"service":{"status":{"statusCode":"ACTIVE"},"activeConfigurations":%s}}\n' "$active"
    ;;
  ecs/describe-services)
    name="$service"
    jq -cn --arg service "$name" --arg alarm "watchdog-bms-uat/${name}/RollbackAlarm" '{
      failures:[], services:[{serviceName:$service,status:"ACTIVE",deploymentController:{type:"ECS"},
      deployments:[{status:"PRIMARY",rolloutState:"COMPLETED"}],deploymentConfiguration:{
      deploymentCircuitBreaker:{enable:true,rollback:true},minimumHealthyPercent:100,maximumPercent:200,
      alarms:{alarmNames:[$alarm],rollback:true,enable:true},strategy:"CANARY",bakeTimeInMinutes:0,
      canaryConfiguration:{canaryPercent:5,canaryBakeTimeInMinutes:0}}}]}'
    ;;
  secretsmanager/describe-secret)
    [ "$secret" != "watchdog-bms/uat/${FAKE_MISSING_SECRET:-__none__}" ] || exit 4
    echo "arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:${secret}-abc123"
    ;;
  cloudwatch/describe-alarms)
    state="${FAKE_ALARM_STATE:-OK}"
    jq -cn --arg state "$state" '{CompositeAlarms:[],MetricAlarms:[
      {AlarmName:"watchdog-bms-uat/watchdog-bms-uat-api-web/RollbackAlarm",StateValue:$state},
      {AlarmName:"watchdog-bms-uat/watchdog-bms-uat-ai-gateway/RollbackAlarm",StateValue:$state},
      {AlarmName:"watchdog-bms-uat/watchdog-bms-uat-workers/RollbackAlarm",StateValue:$state}]}'
    ;;
  *) echo "unexpected fake AWS call: $*" >&2; exit 9 ;;
esac
EOF
chmod +x "$tmp_dir/aws"

run() {
  AWS_BIN="$tmp_dir/aws" AWS_REGION=ap-southeast-1 DEPLOY_ENV=uat \
    ECS_CLUSTER_NAME=watchdog-bms-uat bash "$script"
}

run | grep -Fq 'UAT deploy readiness verified before image publication'
if FAKE_DUAL_ACTIVE=true run >/dev/null 2>&1; then
  echo "ERROR: accepted dual active revisions" >&2
  exit 1
fi
if FAKE_MISSING_SECRET=database-url run >/dev/null 2>&1; then
  echo "ERROR: accepted a missing required secret" >&2
  exit 1
fi
if FAKE_ALARM_STATE=ALARM run >/dev/null 2>&1; then
  echo "ERROR: accepted a rollback alarm in ALARM" >&2
  exit 1
fi
if AWS_BIN="$tmp_dir/aws" DEPLOY_ENV=production bash "$script" >/dev/null 2>&1; then
  echo "ERROR: accepted a non-UAT environment" >&2
  exit 1
fi

echo "UAT early deploy readiness: pass"
