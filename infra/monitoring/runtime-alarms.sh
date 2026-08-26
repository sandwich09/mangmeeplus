#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
environment="${2:-}"
case "$mode" in install|verify|retire-invalid-prod-redis) ;; *) echo "Usage: $0 <install|verify|retire-invalid-prod-redis> <uat|production>" >&2; exit 2 ;; esac
case "$environment" in uat|production) ;; *) echo "ERROR: environment must be uat or production" >&2; exit 2 ;; esac
[ "$mode" != retire-invalid-prod-redis ] || [ "$environment" = production ] \
  || { echo 'ERROR: legacy Redis alarm retirement is production-only' >&2; exit 2; }

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
expected_account="${EXPECTED_AWS_ACCOUNT_ID:-311414082667}"
topic="${SECURITY_ALERT_TOPIC_ARN:-}"
[ -n "$topic" ] || { echo 'ERROR: SECURITY_ALERT_TOPIC_ARN is required' >&2; exit 2; }

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}
fail() { echo "ERROR: $1" >&2; exit 1; }

account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
[ "$account_id" = "$expected_account" ] || fail "unexpected AWS account $account_id"
[ "$region" = ap-southeast-1 ] || fail "unexpected AWS region $region"
[[ "$topic" == arn:aws:sns:"${region}":"${account_id}":* ]] || fail 'alert topic is outside the expected account/region'

if [ "$environment" = production ]; then
  prefix=watchdog-bms-prod
  redis_group=watchdog-bms-prod-redis
  db_id=watchdog-bms-prod-db
  log_threshold=536870912
  db_memory_threshold=200000000
else
  prefix=watchdog-bms-uat
  redis_group=watchdog-bms-uat-redis-v2
  db_id=watchdog-bms-uat-db
  log_threshold=67108864
  db_memory_threshold=64000000
fi

cache_json="$(aws_cmd elasticache describe-cache-clusters --show-cache-node-info --output json --region "$region")"
nodes="$(jq -cer --arg group "$redis_group" '[
  .CacheClusters[]? | select(.ReplicationGroupId == $group)
  | . as $cluster | .CacheNodes[]?
  | {cacheClusterId:$cluster.CacheClusterId,cacheNodeId:.CacheNodeId}
] | select(length > 0) | sort_by(.cacheClusterId,.cacheNodeId)' <<< "$cache_json")" \
  || fail "no metric-bearing cache node found for $redis_group"

put_alarm() {
  aws_cmd cloudwatch put-metric-alarm "$@" --alarm-actions "$topic" --region "$region" >/dev/null
}

# --- P3 service alarms (plan §P3 item 2: login failure spike, 5xx, OCR/AI failure, AI queue age,
# upload failure) -------------------------------------------------------------------------------
#
# The infra alarms above read native AWS metrics. None of the five service signals has a native
# metric, so each is derived from the application log stream by a CloudWatch metric filter — the
# same mechanism `infra/prod-ecs-express/deploy.sh:ensure_log_group` already uses for
# `line.ai.accepted` / `line.ai.terminal` / the HIGH-risk security filter. Filters are created here
# so this script owns the whole install for these five, and re-running is idempotent.
#
# Every pattern keys on a STABLE dotted event name (`security-event.ts`: "free-text English
# sentences cannot be alarm keys"), except the two receipt-OCR gateway lines noted below, which are
# the only signal the web OCR lane emits today.
#
# THRESHOLDS ARE INITIAL VALUES, NOT MEASURED ONES. No B1 traffic baseline exists yet and runbook
# `feature-launch-control.md` OPEN-6 leaves every numeric threshold undefined; re-derive each from
# the first week of B1 data rather than tuning ad hoc. UAT and production deliberately share one
# value for the same reason — there is nothing yet that would justify a split.
service_namespace=WatchDog/Runtime
# `prefix` carries hyphens; metric names mirror deploy.sh's sanitized underscore style.
metric_prefix="$(tr '-' '_' <<< "$prefix")"
login_failure_threshold=20        # denied logins per 5 min; a real user retrying is ~3
api_5xx_threshold=10              # 5xx responses per 5 min, sustained over 2 periods
ai_failure_threshold=10           # AI/OCR failures per 5 min
ai_queue_wait_threshold=60000     # ms a turn waited in the buffer queue before dispatch (60 s)
upload_failure_threshold=10       # rejected attachment uploads per 5 min

put_metric_filter() {
  local log_group="$1" filter_name="$2" pattern="$3" metric="$4" value="${5:-1}"
  aws_cmd logs put-metric-filter \
    --log-group-name "$log_group" \
    --filter-name "$filter_name" \
    --filter-pattern "$pattern" \
    --metric-transformations \
      "metricName=${metric},metricNamespace=${service_namespace},metricValue=${value},defaultValue=0" \
    --region "$region" >/dev/null
}

install_service_alarms() {
  local api_log="/ecs/${prefix}-api-web" ai_log="/ecs/${prefix}-ai-gateway"

  # 1. Login failure spike — `auth.login.denied` (auth.controller.ts) covers both invalid
  #    credentials and rate-limited attempts. The existing HIGH-risk security alarm fires on ONE
  #    such event; this one is the volume signal an operator can act on.
  put_metric_filter "$api_log" login-failure '{ $.msg = "auth.login.denied" }' \
    "${metric_prefix}_login_denied"
  put_alarm \
    --alarm-name "${prefix}-login-failure-spike" \
    --alarm-description "${environment} denied logins spiked (credential stuffing or a broken login path)" \
    --namespace "$service_namespace" --metric-name "${metric_prefix}_login_denied" --statistic Sum \
    --period 300 --evaluation-periods 1 --datapoints-to-alarm 1 --threshold "$login_failure_threshold" \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching

  # 2. API 5xx — the request logger writes one `request` line per response with a root-level
  #    `status` (REQUEST_LOG_ENABLED defaults true). Two consecutive periods so a rollout blip does
  #    not page. Absolute count, not a ratio: a ratio needs metric math, and there is no baseline
  #    denominator to divide by yet.
  put_metric_filter "$api_log" api-5xx '{ $.msg = "request" && $.status >= 500 }' \
    "${metric_prefix}_api_5xx"
  put_alarm \
    --alarm-name "${prefix}-api-5xx-high" \
    --alarm-description "${environment} API is returning server errors to customers" \
    --namespace "$service_namespace" --metric-name "${metric_prefix}_api_5xx" --statistic Sum \
    --period 300 --evaluation-periods 2 --datapoints-to-alarm 2 --threshold "$api_5xx_threshold" \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching

  # 3. OCR/AI failure — one metric fed by two log groups: the AI gateway's provider failures and the
  #    API's terminal outcome classes. `feature_disabled` is deliberately EXCLUDED so closing the
  #    launch gate (the P3 kill switch) does not read as an outage on this alarm.
  #    The two `receipt OCR gateway *` lines are free text — the only OCR signal the web lane emits
  #    today; re-check this pattern if `receipt-ocr.client.ts` is reworded.
  # One line on purpose: a CloudWatch filter pattern is a single token stream, not a shell string.
  local ai_failure_pattern='{ ($.msg = "ai.provider.failure") || ($.msg = "line.ai.terminal" && $.terminalClass = "failed_terminal") || ($.msg = "line.ai.terminal" && $.terminalClass = "provider_unavailable") || ($.msg = "line.ai.terminal" && $.terminalClass = "timeout") || ($.msg = "receipt OCR gateway unreachable") || ($.msg = "receipt OCR gateway error") }'
  put_metric_filter "$api_log" ai-ocr-failure "$ai_failure_pattern" "${metric_prefix}_ai_ocr_failure"
  put_metric_filter "$ai_log" ai-ocr-failure "$ai_failure_pattern" "${metric_prefix}_ai_ocr_failure"
  put_alarm \
    --alarm-name "${prefix}-ai-ocr-failure-high" \
    --alarm-description "${environment} AI turns or receipt OCR are failing for users" \
    --namespace "$service_namespace" --metric-name "${metric_prefix}_ai_ocr_failure" --statistic Sum \
    --period 300 --evaluation-periods 1 --datapoints-to-alarm 1 --threshold "$ai_failure_threshold" \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching

  # 4. AI queue age — `line.ai.api_trace` already carries `queueWaitMs` (flush → worker dequeue) for
  #    every dispatched LINE turn, so the age is published directly instead of counted. Maximum, not
  #    Sum: one turn waiting a minute is the incident, not the total.
  put_metric_filter "$api_log" ai-queue-wait '{ $.msg = "line.ai.api_trace" }' \
    "${metric_prefix}_ai_queue_wait_ms" '$.queueWaitMs'
  put_alarm \
    --alarm-name "${prefix}-ai-queue-wait-high" \
    --alarm-description "${environment} LINE AI turns are queueing before dispatch" \
    --namespace "$service_namespace" --metric-name "${metric_prefix}_ai_queue_wait_ms" --statistic Maximum \
    --period 300 --evaluation-periods 2 --datapoints-to-alarm 2 --threshold "$ai_queue_wait_threshold" \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching

  # 5. Upload failure — `attachment.upload.rejected` is emitted by every attachment path (web
  #    complete-upload, LINE media, CRM inbox intake and its retry sweep).
  put_metric_filter "$api_log" upload-failure '{ $.msg = "attachment.upload.rejected" }' \
    "${metric_prefix}_upload_failure"
  put_alarm \
    --alarm-name "${prefix}-upload-failure-high" \
    --alarm-description "${environment} receipt/attachment uploads are being rejected" \
    --namespace "$service_namespace" --metric-name "${metric_prefix}_upload_failure" --statistic Sum \
    --period 300 --evaluation-periods 1 --datapoints-to-alarm 1 --threshold "$upload_failure_threshold" \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching
}

install_alarms() {
  local component node cache_id node_id suffix
  for component in api-web ai-gateway workers; do
    put_alarm \
      --alarm-name "${prefix}-log-ingest-${component}" \
      --alarm-description "${environment} CloudWatch raw log ingest exceeds the hourly cost guard" \
      --namespace AWS/Logs --metric-name IncomingBytes --statistic Sum \
      --dimensions "Name=LogGroupName,Value=/ecs/${prefix}-${component}" \
      --period 3600 --evaluation-periods 1 --datapoints-to-alarm 1 --threshold "$log_threshold" \
      --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching
  done
  while IFS= read -r node; do
    cache_id="$(jq -r '.cacheClusterId' <<< "$node")"
    node_id="$(jq -r '.cacheNodeId' <<< "$node")"
    suffix="${cache_id#${redis_group}-}"
    [ "$suffix" != "$cache_id" ] || suffix="$node_id"
    put_alarm \
      --alarm-name "${prefix}-redis-memory-high-${suffix}" \
      --alarm-description "${environment} Redis node memory exceeds the noeviction safety threshold" \
      --namespace AWS/ElastiCache --metric-name DatabaseMemoryUsagePercentage --statistic Maximum \
      --dimensions "Name=CacheClusterId,Value=${cache_id}" "Name=CacheNodeId,Value=${node_id}" \
      --period 300 --evaluation-periods 2 --datapoints-to-alarm 2 --threshold 75 \
      --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching
  done < <(jq -c '.[]' <<< "$nodes")
  put_alarm \
    --alarm-name "${prefix}-db-storage-low" \
    --alarm-description "${environment} RDS free storage is below 4 GB" \
    --namespace AWS/RDS --metric-name FreeStorageSpace --statistic Minimum \
    --dimensions "Name=DBInstanceIdentifier,Value=${db_id}" \
    --period 300 --evaluation-periods 2 --datapoints-to-alarm 2 --threshold 4000000000 \
    --comparison-operator LessThanThreshold --treat-missing-data notBreaching
  put_alarm \
    --alarm-name "${prefix}-db-memory-low" \
    --alarm-description "${environment} RDS free memory is below the environment baseline" \
    --namespace AWS/RDS --metric-name FreeableMemory --statistic Minimum \
    --dimensions "Name=DBInstanceIdentifier,Value=${db_id}" \
    --period 300 --evaluation-periods 3 --datapoints-to-alarm 3 --threshold "$db_memory_threshold" \
    --comparison-operator LessThanThreshold --treat-missing-data notBreaching
  if [ "$environment" = production ]; then
    put_alarm \
      --alarm-name "${prefix}-db-connections-high" \
      --alarm-description "production RDS connections approach the configured connection budget" \
      --namespace AWS/RDS --metric-name DatabaseConnections --statistic Maximum \
      --dimensions "Name=DBInstanceIdentifier,Value=${db_id}" \
      --period 300 --evaluation-periods 2 --datapoints-to-alarm 2 --threshold 150 \
      --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching
    put_alarm \
      --alarm-name "${prefix}-db-cpu-credits-low" \
      --alarm-description "production burstable RDS CPU credits are low" \
      --namespace AWS/RDS --metric-name CPUCreditBalance --statistic Minimum \
      --dimensions "Name=DBInstanceIdentifier,Value=${db_id}" \
      --period 300 --evaluation-periods 2 --datapoints-to-alarm 2 --threshold 50 \
      --comparison-operator LessThanThreshold --treat-missing-data notBreaching
  fi
  install_service_alarms
  echo "[runtime-alarms] installed environment=$environment"
}

iso_at() {
  date -u -d "@$1" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || date -u -r "$1" '+%Y-%m-%dT%H:%M:%SZ'
}

verify_alarm() {
  local alarm_name="$1" namespace="$2" metric="$3" statistic="$4" period="$5" evaluations="$6"
  local datapoints="$7" threshold="$8" comparison="$9" lookback_days="${10}"
  shift 10
  # A log-metric-filter metric carries no dimensions (its identity is the metric NAME, exactly as in
  # deploy.sh), so both the contract check and the datapoint probe must tolerate an empty set.
  local alarm_json start_epoch end_epoch start_time end_time count dimensions_json='[]'
  local stat_args=(--namespace "$namespace" --metric-name "$metric" --statistics "$statistic")
  if [ "$#" -gt 0 ]; then
    dimensions_json="$(printf '%s\n' "$@" | jq -Rsc '
      split("\n")[:-1] | map(capture("Name=(?<Name>[^,]+),Value=(?<Value>.*)")) | sort_by(.Name,.Value)
    ')"
    stat_args+=(--dimensions "$@")
  fi
  alarm_json="$(aws_cmd cloudwatch describe-alarms --alarm-names "$alarm_name" --output json --region "$region")"
  jq -e --arg name "$alarm_name" --arg namespace "$namespace" --arg metric "$metric" \
    --arg statistic "$statistic" --arg comparison "$comparison" --arg topic "$topic" \
    --argjson period "$period" --argjson evaluations "$evaluations" --argjson datapoints "$datapoints" \
    --argjson threshold "$threshold" --argjson dimensions "$dimensions_json" '
      (.MetricAlarms | length) == 1 and .MetricAlarms[0] as $a
      | $a.AlarmName == $name and $a.Namespace == $namespace and $a.MetricName == $metric
        and $a.Statistic == $statistic and $a.Period == $period
        and $a.EvaluationPeriods == $evaluations and $a.DatapointsToAlarm == $datapoints
        and $a.Threshold == $threshold and $a.ComparisonOperator == $comparison
        and $a.TreatMissingData == "notBreaching" and $a.AlarmActions == [$topic]
        and (($a.Dimensions | sort_by(.Name,.Value)) == $dimensions)
    ' <<< "$alarm_json" >/dev/null || fail "alarm contract mismatch: $alarm_name"
  end_epoch="$(date +%s)"; start_epoch="$((end_epoch - lookback_days * 86400))"
  start_time="$(iso_at "$start_epoch")"; end_time="$(iso_at "$end_epoch")"
  count="$(aws_cmd cloudwatch get-metric-statistics "${stat_args[@]}" \
    --start-time "$start_time" --end-time "$end_time" --period "$period" \
    --query 'length(Datapoints)' --output text --region "$region")"
  [[ "$count" =~ ^[0-9]+$ ]] && [ "$count" -gt 0 ] || fail "alarm dimension has no datapoints: $alarm_name"
}

verify_alarms() {
  local subscriptions component node cache_id node_id suffix
  subscriptions="$(aws_cmd sns list-subscriptions-by-topic --topic-arn "$topic" --output json --region "$region")"
  jq -e 'any(.Subscriptions[]?; (.SubscriptionArn | startswith("arn:aws:sns:")))' \
    <<< "$subscriptions" >/dev/null || fail 'alert topic has no confirmed subscription'
  for component in api-web ai-gateway workers; do
    verify_alarm "${prefix}-log-ingest-${component}" AWS/Logs IncomingBytes Sum 3600 1 1 \
      "$log_threshold" GreaterThanThreshold 14 "Name=LogGroupName,Value=/ecs/${prefix}-${component}"
  done
  while IFS= read -r node; do
    cache_id="$(jq -r '.cacheClusterId' <<< "$node")"; node_id="$(jq -r '.cacheNodeId' <<< "$node")"
    suffix="${cache_id#${redis_group}-}"; [ "$suffix" != "$cache_id" ] || suffix="$node_id"
    verify_alarm "${prefix}-redis-memory-high-${suffix}" AWS/ElastiCache \
      DatabaseMemoryUsagePercentage Maximum 300 2 2 75 GreaterThanThreshold 1 \
      "Name=CacheClusterId,Value=${cache_id}" "Name=CacheNodeId,Value=${node_id}"
  done < <(jq -c '.[]' <<< "$nodes")
  verify_alarm "${prefix}-db-storage-low" AWS/RDS FreeStorageSpace Minimum 300 2 2 \
    4000000000 LessThanThreshold 1 "Name=DBInstanceIdentifier,Value=${db_id}"
  verify_alarm "${prefix}-db-memory-low" AWS/RDS FreeableMemory Minimum 300 3 3 \
    "$db_memory_threshold" LessThanThreshold 1 "Name=DBInstanceIdentifier,Value=${db_id}"
  if [ "$environment" = production ]; then
    verify_alarm "${prefix}-db-connections-high" AWS/RDS DatabaseConnections Maximum 300 2 2 \
      150 GreaterThanThreshold 1 "Name=DBInstanceIdentifier,Value=${db_id}"
    verify_alarm "${prefix}-db-cpu-credits-low" AWS/RDS CPUCreditBalance Minimum 300 2 2 \
      50 LessThanThreshold 1 "Name=DBInstanceIdentifier,Value=${db_id}"
  fi
  verify_service_alarms
  echo "[runtime-alarms] verified environment=$environment datapoints=present subscription=confirmed"
}

# Same contract as the infra alarms, minus dimensions. A metric-filter metric only produces
# datapoints once its log group has received events, so this fails until the environment has served
# real traffic — which is the point: an alarm on a metric nothing writes is not a working alarm.
verify_service_alarms() {
  verify_alarm "${prefix}-login-failure-spike" "$service_namespace" \
    "${metric_prefix}_login_denied" Sum 300 1 1 "$login_failure_threshold" GreaterThanThreshold 1
  verify_alarm "${prefix}-api-5xx-high" "$service_namespace" \
    "${metric_prefix}_api_5xx" Sum 300 2 2 "$api_5xx_threshold" GreaterThanThreshold 1
  verify_alarm "${prefix}-ai-ocr-failure-high" "$service_namespace" \
    "${metric_prefix}_ai_ocr_failure" Sum 300 1 1 "$ai_failure_threshold" GreaterThanThreshold 1
  verify_alarm "${prefix}-ai-queue-wait-high" "$service_namespace" \
    "${metric_prefix}_ai_queue_wait_ms" Maximum 300 2 2 "$ai_queue_wait_threshold" GreaterThanThreshold 1
  verify_alarm "${prefix}-upload-failure-high" "$service_namespace" \
    "${metric_prefix}_upload_failure" Sum 300 1 1 "$upload_failure_threshold" GreaterThanThreshold 1
}

retire_invalid_prod_alarm() {
  [ "${CONFIRM_RETIRE_INVALID_PROD_REDIS_ALARM:-}" = DELETE_ZERO_DATAPOINT_ALARM ] \
    || fail 'set CONFIRM_RETIRE_INVALID_PROD_REDIS_ALARM=DELETE_ZERO_DATAPOINT_ALARM'
  verify_alarms >/dev/null
  local legacy_name=watchdog-bms-prod-redis-memory-high end_epoch start_epoch count remaining
  end_epoch="$(date +%s)"; start_epoch="$((end_epoch - 86400))"
  count="$(aws_cmd cloudwatch get-metric-statistics --namespace AWS/ElastiCache \
    --metric-name DatabaseMemoryUsagePercentage \
    --dimensions Name=ReplicationGroupId,Value=watchdog-bms-prod-redis \
    --start-time "$(iso_at "$start_epoch")" --end-time "$(iso_at "$end_epoch")" --period 300 \
    --statistics Maximum --query 'length(Datapoints)' --output text --region "$region")"
  [ "$count" = 0 ] || fail 'legacy alarm dimension unexpectedly has datapoints; do not retire automatically'
  aws_cmd cloudwatch delete-alarms --alarm-names "$legacy_name" --region "$region"
  remaining="$(aws_cmd cloudwatch describe-alarms --alarm-names "$legacy_name" \
    --query 'length(MetricAlarms)' --output text --region "$region")"
  [ "$remaining" = 0 ] || fail 'legacy invalid Redis alarm still exists after delete'
  echo "[runtime-alarms] retired alarm=$legacy_name after valid per-node verification"
}

case "$mode" in
  install) install_alarms ;;
  verify) verify_alarms ;;
  retire-invalid-prod-redis) retire_invalid_prod_alarm ;;
esac
