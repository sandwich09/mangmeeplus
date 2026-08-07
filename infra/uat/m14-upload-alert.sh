#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
request_id="${2:-}"
case "$mode" in
  install) ;;
  verify)
    [[ "$request_id" =~ ^m14-live-eicar-[0-9]{14}-complete$ ]] || {
      echo "ERROR: verify requires the generated M-14 EICAR request id" >&2
      exit 2
    }
    ;;
  *) echo "Usage: $0 <install|verify> [m14-live-eicar-YYYYMMDDHHMMSS-complete]" >&2; exit 2 ;;
esac

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
log_group="/ecs/watchdog-bms-uat-api-web"
filter_name="watchdog-bms-uat-m14-attachment-upload-rejected"
namespace="WatchDogBMS/UAT/Security"
metric_name="M14AttachmentUploadRejected"
alarm_name="watchdog-bms-uat-m14-attachment-upload-rejected"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

if [ "$mode" = "install" ]; then
  aws_cmd logs put-metric-filter \
    --log-group-name "$log_group" \
    --filter-name "$filter_name" \
    --filter-pattern '{ $.msg = "attachment.upload.rejected" && $.riskLevel = "HIGH" }' \
    --metric-transformations "metricName=$metric_name,metricNamespace=$namespace,metricValue=1" \
    --region "$region"
  aws_cmd cloudwatch put-metric-alarm \
    --alarm-name "$alarm_name" \
    --alarm-description "UAT M-14 attachment upload rejection detected" \
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
  echo "[m14-alert] installed filter=$filter_name alarm=$alarm_name"
  exit 0
fi

start_time="$(( ($(date +%s) - 900) * 1000 ))"
event_count=0
for _ in $(seq 1 16); do
  logs_json="$(aws_cmd logs filter-log-events \
    --log-group-name "$log_group" \
    --start-time "$start_time" \
    --filter-pattern "\"$request_id\"" \
    --region "$region" \
    --output json)"
  event_count="$(jq --arg request_id "$request_id" '
    [.events[].message
      | fromjson?
      | select(
          .msg == "attachment.upload.rejected"
          and .riskLevel == "HIGH"
          and .requestId == $request_id
        )
    ] | length
  ' <<< "$logs_json")"
  [ "$event_count" -eq 1 ] && break
  sleep 15
done
if [ "$event_count" -ne 1 ]; then
  echo "ERROR: expected one correlated M-14 rejection log, got $event_count" >&2
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
  echo "ERROR: M-14 rejection alarm did not enter ALARM (state=$alarm_state)" >&2
  exit 1
fi

jq -cn \
  --arg requestId "$request_id" \
  --arg alarmName "$alarm_name" \
  --arg alarmState "$alarm_state" \
  --argjson rejectionLogs "$event_count" \
  '{event:"m14_alert_evidence",requestId:$requestId,rejectionLogs:$rejectionLogs,alarmName:$alarmName,alarmState:$alarmState}'
