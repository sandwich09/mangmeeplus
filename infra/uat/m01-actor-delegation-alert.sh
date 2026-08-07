#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
run_id="${2:-}"
case "$mode" in
  install) ;;
  verify)
    [[ "$run_id" =~ ^m01-live-[0-9a-f]{12}-[0-9]+$ ]] || {
      echo "ERROR: verify requires the generated M01_RUN_ID" >&2
      exit 2
    }
    ;;
  *) echo "Usage: $0 <install|verify> [m01-run-id]" >&2; exit 2 ;;
esac

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
log_group="/ecs/watchdog-bms-uat-api-web"
filter_name="watchdog-bms-uat-m01-actor-delegation-denied"
namespace="WatchDogBMS/UAT/Security"
metric_name="M01ActorDelegationDenied"
alarm_name="watchdog-bms-uat-m01-actor-delegation-denied"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

if [ "$mode" = "install" ]; then
  aws_cmd logs put-metric-filter \
    --log-group-name "$log_group" \
    --filter-name "$filter_name" \
    --filter-pattern '{ $.path = "/v1/internal/ai/tools/invoke" && $.status = 401 }' \
    --metric-transformations "metricName=$metric_name,metricNamespace=$namespace,metricValue=1" \
    --region "$region"
  aws_cmd cloudwatch put-metric-alarm \
    --alarm-name "$alarm_name" \
    --alarm-description "UAT M-01 actor delegation denial detected" \
    --namespace "$namespace" \
    --metric-name "$metric_name" \
    --statistic Sum \
    --period 60 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    --region "$region"
  echo "[m01-alert] installed filter=$filter_name alarm=$alarm_name"
  exit 0
fi

start_time="$(( ($(date +%s) - 900) * 1000 ))"
logs_json="$(aws_cmd logs filter-log-events \
  --log-group-name "$log_group" \
  --start-time "$start_time" \
  --filter-pattern "\"$run_id\"" \
  --region "$region" \
  --output json)"
denied_count="$(jq --arg prefix "$run_id" '
  [.events[].message
    | fromjson?
    | select(
        .path == "/v1/internal/ai/tools/invoke"
        and .status == 401
        and (.requestId | type) == "string"
        and (.requestId | startswith($prefix))
      )
  ] | length
' <<< "$logs_json")"
if [ "$denied_count" -ne 4 ]; then
  echo "ERROR: expected 4 correlated actor-delegation denial logs, got $denied_count" >&2
  exit 1
fi

alarm_state=""
for _ in $(seq 1 16); do
  alarm_state="$(aws_cmd cloudwatch describe-alarms \
    --alarm-names "$alarm_name" \
    --query 'MetricAlarms[0].StateValue' \
    --output text \
    --region "$region")"
  [ "$alarm_state" = "ALARM" ] && break
  sleep 15
done
if [ "$alarm_state" != "ALARM" ]; then
  echo "ERROR: M-01 denial alarm did not enter ALARM (state=$alarm_state)" >&2
  exit 1
fi

jq -cn \
  --arg requestPrefix "$run_id" \
  --arg alarmName "$alarm_name" \
  --arg alarmState "$alarm_state" \
  --argjson deniedRequestLogs "$denied_count" \
  '{event:"m01_alert_evidence",requestPrefix:$requestPrefix,deniedRequestLogs:$deniedRequestLogs,alarmName:$alarmName,alarmState:$alarmState}'
