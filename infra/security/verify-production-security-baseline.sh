#!/usr/bin/env bash
set -euo pipefail

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

require_json_file() {
  local file="$1" limit="$2"
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(wc -c < "$file")" -le "$limit" ]
  jq -e 'type == "object"' "$file" >/dev/null
}

validate_baseline() {
  [ "$#" -eq 3 ] || {
    echo "Usage: $0 validate <observation.json> <output.json> <now-epoch>" >&2
    return 2
  }
  local observation="$1" output="$2" now="$3" canonical
  [[ "$now" =~ ^[1-9][0-9]*$ ]]
  require_json_file "$observation" 1048576
  canonical="$(mktemp "${TMPDIR:-/tmp}/production-security-baseline.XXXXXX")"
  trap 'rm -f "$canonical"' RETURN
  jq -cS . "$observation" > "$canonical"
  cmp -s "$observation" "$canonical" || {
    echo "ERROR: runtime security observation is not canonical jq -cS JSON" >&2
    return 1
  }
  jq -e --argjson now "$now" '
    def exact($keys): type == "object" and keys == ($keys | sort);
    def hash: type == "string" and test("^[0-9a-f]{64}$");
    def positive: type == "number" and . >= 1 and . <= 9007199254740991 and floor == .;
    def sha: type == "string" and test("^[0-9a-f]{40}$");
    def digest: type == "string" and test("^sha256:[0-9a-f]{64}$");
    . as $root
    | exact(["alerting","clamavCandidate","logMonitoring","observedAtEpoch","provider","rds","redis","schemaVersion"])
    and .schemaVersion == 1 and .provider == "AWS" and .observedAtEpoch == $now
    and (.rds
      | exact(["backupRetentionDays","deletionProtection","instanceArn","instanceIdentifier",
          "multiAZ","rawSha256","status","storageEncrypted"])
        and (.instanceIdentifier | type == "string" and test("^[a-z][a-z0-9-]{0,62}$"))
        and .instanceArn == ("arn:aws:rds:ap-southeast-1:311414082667:db:" + .instanceIdentifier)
        and .status == "available" and .storageEncrypted == true and .multiAZ == true
        and .deletionProtection == true and .backupRetentionDays >= 35
        and (.backupRetentionDays | positive) and (.rawSha256 | hash))
    and (.redis
      | exact(["atRestEncryptionEnabled","authTokenEnabled","automaticFailover","engine",
          "nodeCount","primaryClusterId","rawPrimaryClusterSha256","rawReplicationGroupSha256",
          "replicationGroupArn","replicationGroupId","snapshotRetentionDays","status",
          "transitEncryptionEnabled"])
        and (.replicationGroupId | type == "string" and test("^[a-z][a-z0-9-]{0,39}$"))
        and .replicationGroupArn == ("arn:aws:elasticache:ap-southeast-1:311414082667:replicationgroup:" + .replicationGroupId)
        and .engine == "redis" and .status == "available"
        and .atRestEncryptionEnabled == true and .transitEncryptionEnabled == true
        and .authTokenEnabled == true and .automaticFailover == "enabled"
        and (.nodeCount | positive and . >= 2)
        and (.primaryClusterId | type == "string" and test("^[a-zA-Z0-9-]{1,50}$"))
        and (.snapshotRetentionDays | positive and . >= 35)
        and (.rawReplicationGroupSha256 | hash) and (.rawPrimaryClusterSha256 | hash))
    and (.alerting
      | exact(["acknowledgement","actionableAlarmNames","alarmsRawSha256",
          "confirmedHumanSubscriptions","deliveredNotificationCount","deliveryMetricRawSha256",
          "ownerAccount","subscriptionsRawSha256","topicArn","topicRawSha256"])
        and (.topicArn | type == "string"
          and test("^arn:aws:sns:ap-southeast-1:311414082667:[A-Za-z0-9_-]{1,256}$")))
    and .alerting.ownerAccount == "311414082667"
    and (.alerting.topicRawSha256 | hash)
    and (.alerting.alarmsRawSha256 | hash)
    and (.alerting.subscriptionsRawSha256 | hash)
    and (.alerting.deliveryMetricRawSha256 | hash)
    and (.alerting.actionableAlarmNames | type == "array" and length >= 1
      and . == sort and length == (unique | length)
      and all(.[]; type == "string" and length >= 1 and length <= 255))
    and (.alerting.confirmedHumanSubscriptions | type == "array" and length >= 1
      and . == sort_by(.subscriptionArn) and (map(.subscriptionArn) | length == (unique | length))
      and all(.[]; exact(["endpointSha256","protocol","subscriptionArn"])
        and (.endpointSha256 | hash)
        and (.protocol == "email" or .protocol == "email-json" or .protocol == "sms")
        and (.subscriptionArn | type == "string"
          and test("^arn:aws:sns:ap-southeast-1:311414082667:[A-Za-z0-9_-]+:[0-9a-f-]{36}$"))))
    and (.alerting.deliveredNotificationCount | positive)
    and (.alerting.acknowledgement as $ack
      | $ack
      | exact(["ackFileSha256","acknowledgedAtEpoch","acknowledgedBy",
          "deliveryEvidenceSha256","endpointSha256","probePublishedAtEpoch",
          "recipientAcknowledged","schemaVersion","subscriptionArn",
          "syntheticMessageIdSha256","topicArn"])
        and .schemaVersion == 1 and .topicArn == $root.alerting.topicArn
        and .recipientAcknowledged == true
        and (.ackFileSha256 | hash) and (.endpointSha256 | hash)
        and (.deliveryEvidenceSha256 | hash) and (.syntheticMessageIdSha256 | hash)
        and (.acknowledgedBy | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$"))
        and (.probePublishedAtEpoch | positive) and (.acknowledgedAtEpoch | positive)
        and .probePublishedAtEpoch <= .acknowledgedAtEpoch
        and .acknowledgedAtEpoch <= $now and ($now - .acknowledgedAtEpoch) <= 3024000
        and any($root.alerting.confirmedHumanSubscriptions[];
          .subscriptionArn == $ack.subscriptionArn and .endpointSha256 == $ack.endpointSha256))
    and (.logMonitoring
      | exact(["groups","prefix"])
        and .prefix == "/ecs/watchdog-bms-prod-"
        and (.groups | type == "array" and length >= 1 and . == sort_by(.name)
          and (map(.name) | length == (unique | length))
          and all(.[]; exact(["kmsKeyArn","metricFilterCount","name","rawLogGroupSha256",
              "rawMetricFiltersSha256","retentionDays"])
            and (.name | type == "string" and startswith("/ecs/watchdog-bms-prod-"))
            and (.retentionDays | positive and . >= 90)
            and (.kmsKeyArn | type == "string"
              and test("^arn:aws:kms:ap-southeast-1:311414082667:key/[0-9a-f-]{36}$"))
            and (.metricFilterCount | positive)
            and (.rawLogGroupSha256 | hash) and (.rawMetricFiltersSha256 | hash))))
    and (.clamavCandidate as $c
      | $c | exact(["apiDigest","apiImage","candidateSource","checkedAtEpoch","cleanVerdict",
          "eicarVerdict","outputSha256","provider","scannerHost","scannerPort",
          "scannerVersion","sourceCommit","testScriptSha256"])
        and .provider == "COLOCATED_CLAMAV" and .candidateSource == "UAT_ACCEPTED_API_IMAGE"
        and (.sourceCommit | sha) and (.apiDigest | digest)
        and .apiImage == ("311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@" + .apiDigest)
        and .scannerHost == "127.0.0.1" and .scannerPort == 3310
        and (.scannerVersion | type == "string" and test("^ClamAV 1\\.5\\.[0-9]+/"))
        and .cleanVerdict == "CLEAN" and .eicarVerdict == "MALWARE_DETECTED"
        and (.testScriptSha256 | hash) and (.outputSha256 | hash)
        and (.checkedAtEpoch | positive) and .checkedAtEpoch <= $now
        and ($now - .checkedAtEpoch) <= 3600)
  ' "$observation" >/dev/null || {
    echo "ERROR: production runtime security baseline is incomplete or below policy" >&2
    return 1
  }
  cp "$observation" "$output"
  trap - RETURN
  rm -f "$canonical"
}

verify_clamav_candidate() {
  [ "$#" -eq 4 ] || {
    echo "Usage: $0 clamav <api-image@digest> <source-sha> <output.json> <now-epoch>" >&2
    return 2
  }
  local image="$1" source="$2" output="$3" now="$4" run_output version digest
  [[ "$image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$ ]]
  [[ "$source" =~ ^[0-9a-f]{40}$ ]]
  [[ "$now" =~ ^[1-9][0-9]*$ ]]
  digest="${image##*@}"
  test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" = "$source"
  run_output="$(mktemp "${TMPDIR:-/tmp}/production-clamav-candidate.XXXXXX")"
  trap 'rm -f "$run_output"' RETURN
  timeout 180 docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
    --platform linux/amd64 --entrypoint sh "$image" -eu -c '
      env -i PATH="$PATH" clamd --foreground=true --fail-if-cvd-older-than=7 >/tmp/clamd.log 2>&1 &
      daemon_pid=$!
      trap "kill $daemon_pid 2>/dev/null || true" EXIT
      ready=false
      i=0
      while [ "$i" -lt 60 ]; do
        if clamdscan --ping 1:1 >/dev/null 2>&1; then ready=true; break; fi
        i=$((i+1)); sleep 2
      done
      test "$ready" = true
      printf "%s" "ordinary clean candidate bytes" > /tmp/clean.bin
      printf "%s%s" "X5O!P%@AP[4\\PZX54(P^)7CC)7}\$EICAR-STANDARD-" \
        "ANTIVIRUS-TEST-FILE!\$H+H*" > /tmp/eicar.bin
      clamdscan --no-summary /tmp/clean.bin >/tmp/clean.out
      eicar_status=0
      clamdscan --no-summary /tmp/eicar.bin >/tmp/eicar.out 2>&1 || eicar_status=$?
      test "$eicar_status" -eq 1
      grep -Eq "Eicar(-Test)?-Signature FOUND" /tmp/eicar.out
      printf "scannerVersion=%s\ncleanVerdict=CLEAN\neicarVerdict=MALWARE_DETECTED\n" \
        "$(clamd --version | head -n 1)"
    ' > "$run_output"
  grep -Fxq 'cleanVerdict=CLEAN' "$run_output"
  grep -Fxq 'eicarVerdict=MALWARE_DETECTED' "$run_output"
  version="$(sed -n 's/^scannerVersion=//p' "$run_output")"
  test "$(printf '%s\n' "$version" | wc -l | tr -d '[:space:]')" = 1
  jq -cnS --arg source "$source" --arg image "$image" --arg digest "$digest" \
    --arg version "$version" --arg scriptHash "$(sha256_file "$0")" \
    --arg outputHash "$(sha256_file "$run_output")" --argjson now "$now" '
      {provider:"COLOCATED_CLAMAV",candidateSource:"UAT_ACCEPTED_API_IMAGE",
       sourceCommit:$source,apiImage:$image,apiDigest:$digest,scannerHost:"127.0.0.1",
       scannerPort:3310,scannerVersion:$version,cleanVerdict:"CLEAN",
       eicarVerdict:"MALWARE_DETECTED",testScriptSha256:$scriptHash,
       outputSha256:$outputHash,checkedAtEpoch:$now}
    ' > "$output"
  trap - RETURN
  rm -f "$run_output"
}

collect_baseline() {
  [ "$#" -eq 8 ] || {
    echo "Usage: $0 collect <output.json> <clamav.json> <ack.json> <rds-id> <redis-id> <topic-arn> <now-epoch> <region>" >&2
    return 2
  }
  local output="$1" clamav="$2" ack="$3" rds_id="$4" redis_id="$5" topic_arn="$6"
  local now="$7" region="$8" root rds_raw redis_raw primary_raw topic_raw subscriptions_raw
  local alarms_raw metric_raw primary_id topic_name start_epoch end_epoch log_groups_raw
  local subscriptions_summary logs_summary observation endpoint_file row endpoint_hash
  [ "$region" = ap-southeast-1 ]
  [[ "$rds_id" =~ ^[a-z][a-z0-9-]{0,62}$ ]]
  [[ "$redis_id" =~ ^[a-z][a-z0-9-]{0,39}$ ]]
  [[ "$topic_arn" =~ ^arn:aws:sns:ap-southeast-1:311414082667:[A-Za-z0-9_-]{1,256}$ ]]
  [[ "$now" =~ ^[1-9][0-9]*$ ]]
  require_json_file "$clamav" 65536
  require_json_file "$ack" 65536
  root="$(mktemp -d "${TMPDIR:-/tmp}/production-security-live.XXXXXX")"
  trap 'rm -rf "$root"' RETURN
  rds_raw="$root/rds.json"
  redis_raw="$root/redis.json"
  primary_raw="$root/redis-primary.json"
  topic_raw="$root/topic.json"
  subscriptions_raw="$root/subscriptions.json"
  alarms_raw="$root/alarms.json"
  metric_raw="$root/delivery-metric.json"
  log_groups_raw="$root/log-groups.json"

  aws rds describe-db-instances --region "$region" --db-instance-identifier "$rds_id" \
    --output json | jq -cS . > "$rds_raw"
  aws elasticache describe-replication-groups --region "$region" \
    --replication-group-id "$redis_id" --output json | jq -cS . > "$redis_raw"
  # The primary is still read, because engine identity and primaryClusterId must come from a real
  # node. Snapshot retention must NOT: ElastiCache records it on the replication group and mirrors
  # it onto whichever member is SnapshottingClusterId, which defaults to a replica so that the fork
  # a backup performs never lands on the node serving traffic. Reading it from the primary
  # therefore returns 0 for a correctly built two-node group, and the only ways to make that read
  # non-zero are to move snapshotting onto the primary — degrading production to satisfy a check —
  # or to run a single-node group, which M-17 forbids. Observed live on 2026-08-08:
  # replication group 35, replica -002 35, primary -001 0.
  primary_id="$(jq -er '[.ReplicationGroups[]?.NodeGroups[]?.NodeGroupMembers[]?
    | select(.CurrentRole == "primary") | .CacheClusterId] | select(length == 1) | .[0]' "$redis_raw")"
  aws elasticache describe-cache-clusters --region "$region" --cache-cluster-id "$primary_id" \
    --output json | jq -cS . > "$primary_raw"
  aws sns get-topic-attributes --region "$region" --topic-arn "$topic_arn" \
    --output json | jq -cS . > "$topic_raw"
  aws sns list-subscriptions-by-topic --region "$region" --topic-arn "$topic_arn" \
    --output json | jq -cS . > "$subscriptions_raw"
  aws cloudwatch describe-alarms --region "$region" --alarm-types MetricAlarm \
    --output json | jq -cS . > "$alarms_raw"

  start_epoch="$(jq -er '.probePublishedAtEpoch - 300 | select(. >= 1)' "$ack")"
  end_epoch="$(jq -er '.acknowledgedAtEpoch + 300' "$ack")"
  topic_name="${topic_arn##*:}"
  aws cloudwatch get-metric-statistics --region "$region" --namespace AWS/SNS \
    --metric-name NumberOfNotificationsDelivered --dimensions "Name=TopicName,Value=$topic_name" \
    --start-time "$(date -u -d "@$start_epoch" +%Y-%m-%dT%H:%M:%SZ)" \
    --end-time "$(date -u -d "@$end_epoch" +%Y-%m-%dT%H:%M:%SZ)" \
    --period 60 --statistics Sum --output json | jq -cS . > "$metric_raw"

  subscriptions_summary="$root/subscriptions-summary.json"
  : > "$subscriptions_summary"
  while IFS= read -r row; do
    endpoint_file="$root/endpoint"
    printf '%s' "$(jq -r '.Endpoint' <<< "$row")" > "$endpoint_file"
    endpoint_hash="$(sha256_file "$endpoint_file")"
    jq -cnS --arg arn "$(jq -er '.SubscriptionArn' <<< "$row")" \
      --arg protocol "$(jq -er '.Protocol' <<< "$row")" --arg endpoint "$endpoint_hash" \
      '{subscriptionArn:$arn,protocol:$protocol,endpointSha256:$endpoint}'
  done < <(jq -c '.Subscriptions[] | select((.Protocol == "email" or .Protocol == "email-json" or .Protocol == "sms")
    and (.SubscriptionArn | startswith("arn:aws:sns:")))' "$subscriptions_raw") \
    | jq -csS 'sort_by(.subscriptionArn)' > "$subscriptions_summary"

  aws logs describe-log-groups --region "$region" \
    --log-group-name-prefix /ecs/watchdog-bms-prod- --output json | jq -cS . > "$log_groups_raw"
  logs_summary="$root/logs-summary.json"
  : > "$logs_summary"
  while IFS= read -r row; do
    local name detail filters
    name="$(jq -er '.logGroupName' <<< "$row")"
    detail="$root/log-$(printf '%s' "$name" | sha256_stream).json"
    filters="$root/filters-$(printf '%s' "$name" | sha256_stream).json"
    aws logs describe-log-groups --region "$region" --log-group-name-prefix "$name" \
      --output json | jq -cS --arg name "$name" '{logGroups:[.logGroups[]|select(.logGroupName==$name)]}' > "$detail"
    aws logs describe-metric-filters --region "$region" --log-group-name "$name" \
      --output json | jq -cS . > "$filters"
    jq -cnS --arg name "$name" --arg kms "$(jq -er '.kmsKeyId' <<< "$row")" \
      --argjson retention "$(jq -er '.retentionInDays' <<< "$row")" \
      --argjson filters "$(jq -er '.metricFilters|length' "$filters")" \
      --arg detailHash "$(sha256_file "$detail")" --arg filterHash "$(sha256_file "$filters")" \
      '{name:$name,retentionDays:$retention,kmsKeyArn:$kms,metricFilterCount:$filters,
        rawLogGroupSha256:$detailHash,rawMetricFiltersSha256:$filterHash}'
  done < <(jq -c '.logGroups[]' "$log_groups_raw") | jq -csS 'sort_by(.name)' > "$logs_summary"

  observation="$root/observation.json"
  jq -cnS --argjson now "$now" --arg rdsId "$rds_id" --arg redisId "$redis_id" \
    --arg topic "$topic_arn" --arg rdsHash "$(sha256_file "$rds_raw")" \
    --arg redisHash "$(sha256_file "$redis_raw")" --arg primaryHash "$(sha256_file "$primary_raw")" \
    --arg topicHash "$(sha256_file "$topic_raw")" --arg subscriptionsHash "$(sha256_file "$subscriptions_raw")" \
    --arg alarmsHash "$(sha256_file "$alarms_raw")" --arg metricHash "$(sha256_file "$metric_raw")" \
    --arg ackHash "$(sha256_file "$ack")" --slurpfile rds "$rds_raw" --slurpfile redis "$redis_raw" \
    --slurpfile primary "$primary_raw" --slurpfile topicRaw "$topic_raw" \
    --slurpfile subscriptions "$subscriptions_summary" --slurpfile alarms "$alarms_raw" \
    --slurpfile metric "$metric_raw" --slurpfile ack "$ack" --slurpfile logs "$logs_summary" \
    --slurpfile clamav "$clamav" '
      ($rds[0].DBInstances | select(length==1) | .[0]) as $db
      | ($redis[0].ReplicationGroups | select(length==1) | .[0]) as $rg
      | ($primary[0].CacheClusters | select(length==1) | .[0]) as $cluster
      | {schemaVersion:1,provider:"AWS",observedAtEpoch:$now,
         rds:{instanceIdentifier:$rdsId,instanceArn:$db.DBInstanceArn,status:$db.DBInstanceStatus,
           storageEncrypted:$db.StorageEncrypted,multiAZ:$db.MultiAZ,
           deletionProtection:$db.DeletionProtection,backupRetentionDays:$db.BackupRetentionPeriod,
           rawSha256:$rdsHash},
         redis:{replicationGroupId:$redisId,replicationGroupArn:$rg.ARN,status:$rg.Status,
           engine:$cluster.Engine,atRestEncryptionEnabled:$rg.AtRestEncryptionEnabled,
           transitEncryptionEnabled:$rg.TransitEncryptionEnabled,authTokenEnabled:$rg.AuthTokenEnabled,
           automaticFailover:$rg.AutomaticFailover,nodeCount:([$rg.NodeGroups[].NodeGroupMembers[]]|length),
           primaryClusterId:$cluster.CacheClusterId,snapshotRetentionDays:$rg.SnapshotRetentionLimit,
           rawReplicationGroupSha256:$redisHash,rawPrimaryClusterSha256:$primaryHash},
         alerting:{topicArn:$topic,ownerAccount:$topicRaw[0].Attributes.Owner,
           topicRawSha256:$topicHash,
           actionableAlarmNames:([$alarms[0].MetricAlarms[]
             | select(.ActionsEnabled==true and (.AlarmActions|index($topic))) | .AlarmName]|unique|sort),
           alarmsRawSha256:$alarmsHash,confirmedHumanSubscriptions:$subscriptions[0],
           subscriptionsRawSha256:$subscriptionsHash,
           deliveredNotificationCount:([$metric[0].Datapoints[]?.Sum]|add//0),
           deliveryMetricRawSha256:$metricHash,
           acknowledgement:($ack[0]+{ackFileSha256:$ackHash})},
         logMonitoring:{prefix:"/ecs/watchdog-bms-prod-",groups:$logs[0]},
         clamavCandidate:$clamav[0]}
    ' > "$observation"
  validate_baseline "$observation" "$output" "$now"
  trap - RETURN
  rm -rf "$root"
}

case "${1:-}" in
  validate) shift; validate_baseline "$@" ;;
  clamav) shift; verify_clamav_candidate "$@" ;;
  collect) shift; collect_baseline "$@" ;;
  *) echo "Usage: $0 <validate|clamav|collect> ..." >&2; exit 2 ;;
esac
