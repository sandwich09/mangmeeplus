#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
script="$repo_root/infra/monitoring/runtime-alarms.sh"
policy="$repo_root/infra/production/monitoring-bootstrap-policy.template.json"
deploy="$repo_root/infra/prod-ecs-express/deploy.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-runtime-alarms-spec.XXXXXX")"
trap '[ "${KEEP_TMP:-false}" = true ] || rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE:?}"
command="$1/$2"
shift 2
printf '%s %s\n' "$command" "$*" >> "${FAKE_CALL_LOG:?}"

arg() {
  local wanted="$1" previous='' value
  shift
  for value in "$@"; do
    [ "$previous" = "$wanted" ] && { printf '%s' "$value"; return; }
    previous="$value"
  done
}

dimensions() {
  local active=false value
  for value in "$@"; do
    if [ "$value" = --dimensions ]; then active=true; continue; fi
    if [[ "$value" == --* ]]; then active=false; fi
    [ "$active" = true ] && printf '%s\n' "$value"
  done
  return 0
}

case "$command" in
  sts/get-caller-identity) printf '%s\n' "${FAKE_ACCOUNT:-311414082667}" ;;
  elasticache/describe-cache-clusters)
    jq -cn '{CacheClusters:[
      {CacheClusterId:"watchdog-bms-prod-redis-001",ReplicationGroupId:"watchdog-bms-prod-redis",CacheNodes:[{CacheNodeId:"0001"}]},
      {CacheClusterId:"watchdog-bms-prod-redis-002",ReplicationGroupId:"watchdog-bms-prod-redis",CacheNodes:[{CacheNodeId:"0001"}]},
      {CacheClusterId:"watchdog-bms-uat-redis",ReplicationGroupId:null,CacheNodes:[{CacheNodeId:"0001"}]}
    ]}'
    ;;
  sns/list-subscriptions-by-topic)
    jq -cn '{Subscriptions:[{SubscriptionArn:"arn:aws:sns:ap-southeast-1:311414082667:alerts:confirmed",Protocol:"email"}]}'
    ;;
  logs/put-metric-filter)
    group="$(arg --log-group-name "$@")"; name="$(arg --filter-name "$@")"
    pattern="$(arg --filter-pattern "$@")"; transformation="$(arg --metric-transformations "$@")"
    transformation_json="$(jq -cn --arg value "$transformation" '
      $value | split(",") | map(capture("(?<key>[^=]+)=(?<value>.*)")) | from_entries
      | if has("defaultValue") then .defaultValue |= tonumber else . end
    ')"
    next="$(jq --arg group "$group" --arg name "$name" --arg pattern "$pattern" \
      --argjson transformation "$transformation_json" '
      .filters[$group][$name]={filterName:$name,filterPattern:$pattern,metricTransformations:[$transformation]}
    ' "$state")"
    printf '%s\n' "$next" > "$state"
    ;;
  logs/describe-metric-filters)
    group="$(arg --log-group-name "$@")"; prefix="$(arg --filter-name-prefix "$@")"
    jq -c --arg group "$group" --arg prefix "$prefix" '
      {metricFilters:[.filters[$group][]? | select(.filterName | startswith($prefix))]}
    ' "$state"
    ;;
  cloudwatch/put-dashboard)
    name="$(arg --dashboard-name "$@")"; body="$(arg --dashboard-body "$@")"
    next="$(jq --arg name "$name" --arg body "$body" '.dashboards[$name]=$body' "$state")"
    printf '%s\n' "$next" > "$state"
    printf '{"DashboardValidationMessages":[]}\n'
    ;;
  cloudwatch/get-dashboard)
    name="$(arg --dashboard-name "$@")"
    jq -c --arg name "$name" --arg account "${FAKE_ACCOUNT:-311414082667}" '
      {DashboardName:$name,DashboardArn:("arn:aws:cloudwatch::"+$account+":dashboard/"+$name),DashboardBody:.dashboards[$name]}
    ' "$state"
    ;;
  cloudwatch/put-metric-alarm)
    name="$(arg --alarm-name "$@")"; namespace="$(arg --namespace "$@")"; metric="$(arg --metric-name "$@")"
    statistic="$(arg --statistic "$@")"; period="$(arg --period "$@")"; evaluations="$(arg --evaluation-periods "$@")"
    datapoints="$(arg --datapoints-to-alarm "$@")"; threshold="$(arg --threshold "$@")"
    comparison="$(arg --comparison-operator "$@")"; missing="$(arg --treat-missing-data "$@")"
    topic="$(arg --alarm-actions "$@")"
    dims="$(dimensions "$@" | jq -Rsc 'split("\n")[:-1] | map(capture("Name=(?<Name>[^,]+),Value=(?<Value>.*)"))')"
    next="$(jq --arg name "$name" --arg namespace "$namespace" --arg metric "$metric" --arg statistic "$statistic" \
      --arg comparison "$comparison" --arg missing "$missing" --arg topic "$topic" --argjson dims "$dims" \
      --argjson period "$period" --argjson evaluations "$evaluations" --argjson datapoints "$datapoints" \
      --argjson threshold "$threshold" '.alarms[$name]={AlarmName:$name,Namespace:$namespace,MetricName:$metric,
        Statistic:$statistic,Period:$period,EvaluationPeriods:$evaluations,DatapointsToAlarm:$datapoints,
        Threshold:$threshold,ComparisonOperator:$comparison,TreatMissingData:$missing,AlarmActions:[$topic],Dimensions:$dims}' "$state")"
    printf '%s\n' "$next" > "$state"
    ;;
  cloudwatch/describe-alarms)
    name="$(arg --alarm-names "$@")"
    if [[ " $* " == *' --query length(MetricAlarms) '* ]]; then
      jq -r --arg name "$name" 'if .alarms[$name] then 1 else 0 end' "$state"
    else
      jq -c --arg name "$name" '{MetricAlarms:(if .alarms[$name] then [.alarms[$name]] else [] end),CompositeAlarms:[]}' "$state"
    fi
    ;;
  cloudwatch/get-metric-statistics)
    if [ "${FAKE_ZERO_DATAPOINTS:-false}" = true ] || [[ " $* " == *' Name=ReplicationGroupId,'* ]]; then
      printf '0\n'
    else
      printf '1\n'
    fi
    ;;
  cloudwatch/delete-alarms)
    name="$(arg --alarm-names "$@")"
    next="$(jq --arg name "$name" 'del(.alarms[$name])' "$state")"; printf '%s\n' "$next" > "$state"
    ;;
  *) echo "unexpected fake AWS call: $command $*" >&2; exit 9 ;;
esac
EOF
chmod +x "$tmp_dir/aws"

reset_state() {
  printf '{"alarms":{},"dashboards":{},"filters":{}}\n' > "$tmp_dir/state.json"
  : > "$tmp_dir/calls.log"
}

run_alarm() {
  local selected_mode="$1" selected_environment="$2"
  shift 2
  env AWS_BIN="$tmp_dir/aws" AWS_REGION=ap-southeast-1 FAKE_STATE="$tmp_dir/state.json" \
    FAKE_CALL_LOG="$tmp_dir/calls.log" \
    SECURITY_ALERT_TOPIC_ARN=arn:aws:sns:ap-southeast-1:311414082667:watchdog-bms-production-security-alerts \
    "$@" bash "$script" "$selected_mode" "$selected_environment"
}

reset_state
run_alarm install uat | grep -Fq 'installed environment=uat'
test "$(jq '.alarms | length' "$tmp_dir/state.json")" -eq 11
test "$(grep -c '^logs/put-metric-filter ' "$tmp_dir/calls.log")" -eq 7
test "$(grep -c '^cloudwatch/put-dashboard ' "$tmp_dir/calls.log")" -eq 1
run_alarm verify uat | grep -Fq 'datapoints=present subscription=confirmed'
jq -e '
  .alarms["watchdog-bms-uat-log-ingest-workers"].Threshold == 67108864
  and .alarms["watchdog-bms-uat-db-memory-low"].Threshold == 64000000
  and .alarms["watchdog-bms-uat-api-5xx-high"].MetricName == "watchdog_bms_uat_api_5xx"
  and .alarms["watchdog-bms-uat-ai-ocr-failure-high"].MetricName == "watchdog_bms_uat_ai_ocr_failure"
  and .alarms["watchdog-bms-uat-api-5xx-high"].AlarmActions == ["arn:aws:sns:ap-southeast-1:311414082667:watchdog-bms-production-security-alerts"]
  and .alarms["watchdog-bms-uat-redis-memory-high-0001"].Dimensions == [
    {Name:"CacheClusterId",Value:"watchdog-bms-uat-redis"},{Name:"CacheNodeId",Value:"0001"}]
  and ((.dashboards["watchdog-bms-uat-customer-journeys"] | fromjson) as $dashboard
    | ($dashboard.widgets | length) == 6
    and any($dashboard.widgets[]; .properties.title == "LINE AI — accepted and terminal outcomes (LIVE)")
    and any($dashboard.widgets[]; .properties.stat == "p95" and .properties.period == 300
      and .properties.metrics == [["WatchDog/Runtime", "watchdog_bms_uat_api_response_latency_ms", {label:"All completed API requests (incl. health/internal)"}]])
    and any($dashboard.widgets[]; .properties.markdown? | strings | contains("PARTIAL/PLANNED rows must never be presented as live")))
  and .filters["/ecs/watchdog-bms-uat-api-web"]["api-response-latency"] == {
    filterName:"api-response-latency", filterPattern:"{ $.msg = \"request\" && $.durationMs >= 0 }",
    metricTransformations:[{metricName:"watchdog_bms_uat_api_response_latency_ms",metricNamespace:"WatchDog/Runtime",metricValue:"$.durationMs",unit:"Milliseconds"}]
  }
' "$tmp_dir/state.json" >/dev/null

reset_state
run_alarm install production | grep -Fq 'installed environment=production'
test "$(jq '.alarms | length' "$tmp_dir/state.json")" -eq 14
test "$(grep -c '^logs/put-metric-filter ' "$tmp_dir/calls.log")" -eq 7
test "$(grep -c '^cloudwatch/put-dashboard ' "$tmp_dir/calls.log")" -eq 1
run_alarm verify production | grep -Fq 'verified environment=production'
jq -e '
  .alarms["watchdog-bms-prod-log-ingest-api-web"].Threshold == 536870912
  and .alarms["watchdog-bms-prod-db-memory-low"].Threshold == 200000000
  and .alarms["watchdog-bms-prod-db-connections-high"].Threshold == 150
  and .alarms["watchdog-bms-prod-db-cpu-credits-low"].Threshold == 50
  and .alarms["watchdog-bms-prod-redis-memory-high-001"].Dimensions[0].Name == "CacheClusterId"
  and .alarms["watchdog-bms-prod-redis-memory-high-002"].Dimensions[0].Name == "CacheClusterId"
  and .filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].metricTransformations == [
    {metricName:"watchdog_bms_prod_api_response_latency_ms",metricNamespace:"WatchDog/Runtime",metricValue:"$.durationMs",unit:"Milliseconds"}]
  and ((.dashboards["watchdog-bms-prod-customer-journeys"] | fromjson | tostring) as $dashboard
    | ($dashboard | contains("_ecs_watchdog_bms_prod_api_web_line_ai_accepted"))
    and ($dashboard | contains("companyId") | not)
    and ($dashboard | contains("documentId") | not))
' "$tmp_dir/state.json" >/dev/null
! grep -Fq 'Name=ReplicationGroupId' "$tmp_dir/calls.log"

cp "$tmp_dir/state.json" "$tmp_dir/valid-state.json"
for mutation in \
  'del(.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"])' \
  '.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].metricTransformations[0].defaultValue=0' \
  '.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].metricTransformations[0].dimensions={companyId:"$.companyId"}' \
  '.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].emitSystemFieldDimensions=["@aws.account"]' \
  '.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].fieldSelectionCriteria="@aws.region = \"us-east-1\""' \
  '.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].applyOnTransformedLogs=true' \
  '.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].filterPattern="{ $.msg = \"request\" }"' \
  '.dashboards["watchdog-bms-prod-customer-journeys"] |= (fromjson | .widgets[5].properties.stat="Average" | tojson)'; do
  jq "$mutation" "$tmp_dir/valid-state.json" > "$tmp_dir/state.json"
  if run_alarm verify production >/dev/null 2>&1; then
    echo 'ERROR: accepted latency metric/dashboard drift' >&2; exit 1
  fi
done
cp "$tmp_dir/valid-state.json" "$tmp_dir/state.json"

# AWS may echo empty optional fields and response metadata; these do not change the metric.
jq '.filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"] += {
  creationTime:123,logGroupName:"/ecs/watchdog-bms-prod-api-web",
  emitSystemFieldDimensions:[],fieldSelectionCriteria:"",applyOnTransformedLogs:false
} | .filters["/ecs/watchdog-bms-prod-api-web"]["api-response-latency"].metricTransformations[0].dimensions={}' \
  "$tmp_dir/valid-state.json" > "$tmp_dir/state.json"
run_alarm verify production | grep -Fq 'verified environment=production'
cp "$tmp_dir/valid-state.json" "$tmp_dir/state.json"

if run_alarm verify production FAKE_ZERO_DATAPOINTS=true >/dev/null 2>&1; then
  echo 'ERROR: accepted alarms with zero datapoints' >&2; exit 1
fi
if run_alarm retire-invalid-prod-redis production >/dev/null 2>&1; then
  echo 'ERROR: retired the invalid alarm without explicit confirmation' >&2; exit 1
fi
# Seed the exact invalid alarm so retirement can prove only that name was removed.
jq '.alarms["watchdog-bms-prod-redis-memory-high"]={AlarmName:"watchdog-bms-prod-redis-memory-high"}' \
  "$tmp_dir/state.json" > "$tmp_dir/with-legacy.json"
mv "$tmp_dir/with-legacy.json" "$tmp_dir/state.json"
run_alarm retire-invalid-prod-redis production \
  CONFIRM_RETIRE_INVALID_PROD_REDIS_ALARM=DELETE_ZERO_DATAPOINT_ALARM \
  | grep -Fq 'retired alarm=watchdog-bms-prod-redis-memory-high'
jq -e 'has("watchdog-bms-prod-redis-memory-high") | not' < <(jq '.alarms' "$tmp_dir/state.json") >/dev/null
test "$(jq '.alarms | length' "$tmp_dir/state.json")" -eq 14

reset_state
if run_alarm install uat FAKE_ACCOUNT=999999999999 >/dev/null 2>&1; then
  echo 'ERROR: accepted the wrong AWS account' >&2; exit 1
fi

jq -e '
  any(.Statement[]; .Sid=="BaselineAlarms"
    and (.Action | index("cloudwatch:GetMetricStatistics"))
    and (.Action | index("cloudwatch:DeleteAlarms")))
  and any(.Statement[]; .Sid=="DiscoverRedisMetricDimensions"
    and .Action=="elasticache:DescribeCacheClusters")
  and any(.Statement[]; .Sid=="RuntimeMetricFilters" and .Effect=="Allow"
    and .Action==["logs:PutMetricFilter", "logs:DescribeMetricFilters", "logs:DeleteMetricFilter"]
    and .Resource==[
      "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:log-group:/ecs/watchdog-bms-uat-api-web:*",
      "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:log-group:/ecs/watchdog-bms-uat-ai-gateway:*",
      "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:log-group:/ecs/watchdog-bms-prod-api-web:*",
      "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:log-group:/ecs/watchdog-bms-prod-ai-gateway:*"])
  and any(.Statement[]; .Sid=="CustomerJourneyDashboard"
    and (.Action | index("cloudwatch:PutDashboard"))
    and (.Action | index("cloudwatch:GetDashboard"))
    and .Resource=="arn:aws:cloudwatch::<ACCOUNT_ID>:dashboard/watchdog-bms-*-customer-journeys")
' "$policy" >/dev/null
test "$(grep -c 'Name=ReplicationGroupId' "$script")" -eq 1
for terminal_class in delivered clarification intentional_noop permission_refusal feature_disabled \
  budget_refusal provider_unavailable timeout delivery_pending failed_terminal; do
  grep -Fq "$terminal_class" "$deploy"
  # Every class the API can emit must also be on the dashboard, or a refusal simply disappears.
  grep -Fq "_line_ai_${terminal_class}" "$script"
done

echo 'runtime-alarms.spec.sh: ok'
