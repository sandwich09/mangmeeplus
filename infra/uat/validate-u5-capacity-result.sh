#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 10 ]; then
  echo "Usage: $0 <evidence.json> <source-sha> <release-image> <marker> <manifest-hash> <workflow-sha> <run-id> <run-attempt> <actor> <triggering-actor>" >&2
  exit 2
fi

result="$1"
source_sha="$2"
release_image="$3"
marker="$4"
manifest_hash="$5"
workflow_sha="$6"
run_id="$7"
run_attempt="$8"
actor="$9"
triggering_actor="${10}"
script_dir="$(cd "$(dirname "$0")" && pwd)"

[ -f "$result" ] && [ "$(wc -c < "$result")" -le 262144 ] \
  || { echo 'ERROR: U5-C result is absent or too large' >&2; exit 1; }
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}

validator_tmp="$(mktemp -d "${TMPDIR:-/tmp}/u5-capacity-result.XXXXXX")"
canonical="$validator_tmp/canonical.json"
authorization="$validator_tmp/authorization.json"
trap 'rm -rf "$validator_tmp"' EXIT
jq -cS . "$result" > "$canonical"
cmp -s "$result" "$canonical" \
  || { echo 'ERROR: U5-C result bytes are not canonical jq -cS JSON' >&2; exit 1; }
jq -er '.authorization.content | type=="string"' "$result" >/dev/null \
  || { echo 'ERROR: embedded signed authorization content is absent' >&2; exit 1; }
jq -rj '.authorization.content' "$result" > "$authorization"

result_epoch="$(jq -er '.generatedAt | fromdateiso8601' "$result")" \
  || { echo 'ERROR: U5-C result generatedAt is invalid' >&2; exit 1; }
authorization_hash="$(bash "$script_dir/validate-u5-capacity-authorization.sh" \
  "$authorization" "$source_sha" "$release_image" "$marker" "$manifest_hash" \
  "$workflow_sha" "$run_id" "$run_attempt" "$actor" "$triggering_actor" "$result_epoch")"
actual_result_hash="$(jq -cS 'del(.resultHash)' "$result" | sha256_stream)"
actual_database_hash="$(jq -cS '.database.evidence' "$result" | sha256_stream)"
actual_database_evidence_hash="$(jq -cS '.database.evidence | del(.evidenceHash)' "$result" | sha256_stream)"
marker_hash="$(printf '%s' "$marker" | sha256_stream)"
approval_hash="$(printf '%s' 'owner-approved:2026-08-03:u5-c-v2' | sha256_stream)"

jq -e \
  --rawfile authorization "$authorization" \
  --arg authorizationHash "$authorization_hash" --arg sourceSha "$source_sha" \
  --arg releaseImage "$release_image" --arg marker "$marker" --arg markerHash "$marker_hash" \
  --arg manifestHash "$manifest_hash" --arg workflowSha "$workflow_sha" \
  --arg runId "$run_id" --arg runAttempt "$run_attempt" --arg actor "$actor" \
  --arg triggeringActor "$triggering_actor" --arg resultHash "$actual_result_hash" \
  --arg databaseHash "$actual_database_hash" --arg databaseEvidenceHash "$actual_database_evidence_hash" \
  --arg approvalHash "$approval_hash" '
  def exact_keys($wanted): keys == ($wanted|sort);
  def hash64: type=="string" and test("^[0-9a-f]{64}$");
  def hash32: type=="string" and test("^[0-9a-f]{32}$");
  def iso8601: type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$");
  def iso8601_millis: type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$");
  def iso8601_epoch: if iso8601 then fromdateiso8601 else error("invalid_iso8601") end;
  def iso8601_millis_epoch:
    if iso8601_millis then
      capture("^(?<second>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})[.](?<millis>[0-9]{3})Z$")
      | ((.second+"Z"|fromdateiso8601) + ((.millis|tonumber)/1000))
    else error("invalid_iso8601_millis") end;
  def exact_limits: . == {
    smokeRows:100,fullRows:5000,seedChunkRows:250,maxSeedRowsPerSecond:500,
    claimBatchSizes:[1,25],claimConcurrencies:[1,2,5],processingConcurrency:2,
    backlogDepths:[100,500,1000,2500,5000],samplesPerDepthAndShape:20,
    lockConcurrencies:[2,5,10],lockIterations:20,lockHoldMs:10,maxWallMs:600000,
    claimP95AbortMs:250,lockP95AbortMs:500,connectionRatioAbort:0.70,
    statementTimeoutMs:2000,lockTimeoutMs:500,idleInTransactionTimeoutMs:5000
  };
  def latency($expectedCount;$p95Limit):
    exact_keys(["count","maxMs","p50Ms","p95Ms","p99Ms"])
    and .count==$expectedCount
    and ([.p50Ms,.p95Ms,.p99Ms,.maxMs]|all(.[]; type=="number" and .>=0))
    and .p50Ms<=.p95Ms and .p95Ms<=.p99Ms and .p99Ms<=.maxMs
    and .p95Ms<=$p95Limit;
  def expected_claim_shapes($rows):
    [[100,500,1000,2500,5000][] as $depth | select($depth<=$rows)
      | [1,25][] as $batch | [1,2,5][] as $concurrency
      | {backlogDepth:$depth,batchSize:$batch,concurrency:$concurrency}];
  def claim_shapes($rows):
    type=="array"
    and ([.[]|{backlogDepth,batchSize,concurrency}]|sort_by(.backlogDepth,.batchSize,.concurrency))
      == (expected_claim_shapes($rows)|sort_by(.backlogDepth,.batchSize,.concurrency))
    and all(.[];
      exact_keys(["backlogDepth","batchSize","concurrency","latency"])
      and (. as $shape | $shape.latency | latency($shape.concurrency*20;250)));
  def processing($rows):
    exact_keys(["itemLatency","rows","rowsPerSecond","wallMs"])
    and .rows==$rows and (.wallMs|type)=="number" and .wallMs>=0
    and (.rowsPerSecond|type)=="number" and .rowsPerSecond>0
    and (.itemLatency|latency($rows;1e100));
  def phase($rows;$withLocks):
    exact_keys(["claimShapes","locks","maxConnectionRatio","processing","rows"])
    and .rows==$rows and (.claimShapes|claim_shapes($rows))
    and (.processing|processing($rows))
    and (.maxConnectionRatio|type)=="number" and .maxConnectionRatio>=0
    and .maxConnectionRatio<0.70
    and (if $withLocks then
      ([.locks[]|.concurrency]|sort)==[2,5,10]
      and all(.locks[];
        exact_keys(["concurrency","latency"])
        and (. as $lock | $lock.latency | latency($lock.concurrency*20;500)))
      else .locks==[] end);
  def cleanup_shape($rows):
    exact_keys(["afterBaselineHash","cleanupVerified","companies","fixtureInboxRows",
      "fixtureOutboxRows","inboxRows","inspectedRelations","outboxRows","residue"])
    and .cleanupVerified==true and (.afterBaselineHash|hash64)
    and .residue==0 and .inspectedRelations>0
    and .fixtureOutboxRows==$rows and .fixtureInboxRows==$rows
    and .outboxRows==$rows and .inboxRows==$rows and .companies==1;
  def services: ["watchdog-bms-uat-ai-gateway","watchdog-bms-uat-api-web","watchdog-bms-uat-workers"];

  exact_keys(["artifact","schemaVersion","result","resultHash","authorization","source",
    "limits","database","monitoring","workers","cleanup","timing","generatedAt"])
  and .artifact=="U5_CAPACITY_RESULT_V1" and .schemaVersion==1 and .result=="PASS"
  and .resultHash==$resultHash and (.resultHash|hash64)
  and (.generatedAt|iso8601)

  and (.authorization|exact_keys(["hash","content","verified"]))
  and .authorization.hash==$authorizationHash
  and .authorization.content==$authorization
  and .authorization.verified==true

  and (.source|exact_keys(["sourceSha","releaseImage","marker","markerHash","workloadManifestHash",
    "workflowSha","runId","runAttempt","actor","triggeringActor"]))
  and .source.sourceSha==$sourceSha and .source.releaseImage==$releaseImage
  and .source.marker==$marker and .source.markerHash==$markerHash
  and .source.workloadManifestHash==$manifestHash
  and .source.workflowSha==$workflowSha and .source.runId==$runId
  and .source.runAttempt==$runAttempt and .source.actor==$actor
  and .source.triggeringActor==$triggeringActor
  and (.limits|exact_limits)

  and (.database|exact_keys(["evidence","evidenceHash","canonicalEvidenceHash","baselineHash",
    "afterBaselineHash","cleanupVerified","residue","inspectedRelations","maxConnectionRatio"]))
  and .database.canonicalEvidenceHash==$databaseHash
  and .database.evidenceHash==.database.evidence.evidenceHash
  and (.database.evidenceHash|hash64) and (.database.canonicalEvidenceHash|hash64)
  and .database.evidenceHash==$databaseEvidenceHash
  and (.database.evidence|exact_keys(["approvalRefHash","artifact","baseline","cleanup",
    "cleanupVerified","completedAt","elapsedMs","evidenceHash","expectedBaselineHash",
    "failureCode","full","limits","markerHash","passed","smoke","smokeCleanup",
    "sourceCommit","startedAt","targetEnvironment"]))
  and .database.evidence.artifact=="a5-capacity-mutating-v2"
  and .database.evidence.targetEnvironment=="uat"
  and .database.evidence.sourceCommit==$sourceSha
  and .database.evidence.markerHash==$markerHash
  and .database.evidence.approvalRefHash==$approvalHash
  and .database.evidence.expectedBaselineHash==.database.baselineHash
  and (.database.evidence.limits|exact_limits)
  and (.database.evidence.startedAt|iso8601_millis)
  and (.database.evidence.completedAt|iso8601_millis)
  and (.database.evidence.elapsedMs|type)=="number"
  and .database.evidence.elapsedMs>=0 and .database.evidence.elapsedMs<=600000
  and (.database.evidence.baseline|exact_keys(["inboxCount","inboxStateHash",
    "nullCompanyOutbox","outboxCount","outboxStateHash"]))
  and .database.evidence.baseline.outboxCount>=0
  and .database.evidence.baseline.inboxCount>=0
  and .database.evidence.baseline.nullCompanyOutbox>=0
  and (.database.evidence.baseline.outboxStateHash|hash32)
  and (.database.evidence.baseline.inboxStateHash|hash32)
  and .database.evidence.passed==true and .database.evidence.failureCode==null
  and .database.evidence.cleanupVerified==true
  and (.database.evidence.smoke|phase(100;false))
  and (.database.evidence.smokeCleanup|cleanup_shape(100))
  and (.database.evidence.full|phase(5000;true))
  and (.database.evidence.cleanup|cleanup_shape(5000))
  and .database.evidence.smokeCleanup.afterBaselineHash==.database.baselineHash
  and .database.evidence.cleanup.afterBaselineHash==.database.afterBaselineHash
  and .database.baselineHash==.database.afterBaselineHash
  and .database.cleanupVerified==true and .database.residue==0
  and .database.evidence.cleanup.residue==.database.residue
  and .database.evidence.cleanup.inspectedRelations==.database.inspectedRelations
  and (.database.inspectedRelations|type)=="number" and .database.inspectedRelations>0
  and (.database.maxConnectionRatio|type)=="number"
  and .database.maxConnectionRatio>=0 and .database.maxConnectionRatio<0.70
  and .database.maxConnectionRatio==([.database.evidence.smoke.maxConnectionRatio,
    .database.evidence.full.maxConnectionRatio]|max)

  and (.monitoring|exact_keys(["passed","abortReason","checks","alarm","service5xx","database","services"]))
  and .monitoring.passed==true and .monitoring.abortReason==null
  and (.monitoring.checks|type)=="number" and .monitoring.checks>=1
  and (.monitoring.alarm|exact_keys(["initialSetHash","finalSetHash","blockingInitial",
    "blockingFinal","ignoredScaleInAlarms","ignoredScaleInHash"]))
  and (.monitoring.alarm.initialSetHash|hash64)
  and .monitoring.alarm.initialSetHash==.monitoring.alarm.finalSetHash
  and .monitoring.alarm.blockingInitial==0 and .monitoring.alarm.blockingFinal==0
  and (.monitoring.alarm.ignoredScaleInHash|hash64)
  and (.monitoring.alarm.ignoredScaleInAlarms|type)=="array"
  and (.monitoring.alarm.ignoredScaleInAlarms|length)==3
  and all(.monitoring.alarm.ignoredScaleInAlarms[];
    test("^TargetTracking-service/watchdog-bms-uat/[A-Za-z0-9_-]+-AlarmLow-[A-Za-z0-9-]+$"))
  and (.monitoring.service5xx|exact_keys(["initialMetricSetHash","finalMetricSetHash",
    "baselineTotals","finalTotals","baselineWatermarks","finalWatermarks"]))
  and (.monitoring.service5xx.initialMetricSetHash|hash64)
  and .monitoring.service5xx.initialMetricSetHash==.monitoring.service5xx.finalMetricSetHash
  and (.monitoring.service5xx.baselineTotals|keys|sort)==services
  and (.monitoring.service5xx.finalTotals|keys|sort)==services
  and (.monitoring.service5xx.baselineWatermarks|keys|sort)==services
  and (.monitoring.service5xx.finalWatermarks|keys|sort)==services
  and .monitoring.service5xx.baselineTotals==.monitoring.service5xx.finalTotals
  and all(.monitoring.service5xx.finalTotals[]; type=="number" and .==0)
  and all(.monitoring.service5xx.baselineWatermarks[]; iso8601)
  and all(.monitoring.service5xx.finalWatermarks[]; iso8601)
  and (.monitoring.database|exact_keys(["maxCpuPercent","maxDbConnections",
    "maxDbConnectionRatio","maxConsecutiveHighCpuSamples","lastCpuTimestamp",
    "lastDbConnectionsTimestamp"]))
  and (.monitoring.database.maxCpuPercent|type)=="number" and .monitoring.database.maxCpuPercent>=0
  and (.monitoring.database.maxDbConnections|type)=="number" and .monitoring.database.maxDbConnections>=0
  and (.monitoring.database.maxDbConnectionRatio|type)=="number"
  and .monitoring.database.maxDbConnectionRatio>=0 and .monitoring.database.maxDbConnectionRatio<0.70
  and (.monitoring.database.maxConsecutiveHighCpuSamples|type)=="number"
  and .monitoring.database.maxConsecutiveHighCpuSamples>=0
  and .monitoring.database.maxConsecutiveHighCpuSamples<2
  and (.monitoring.database.lastCpuTimestamp|iso8601)
  and (.monitoring.database.lastDbConnectionsTimestamp|iso8601)
  and ((.database.evidence.completedAt|iso8601_millis_epoch) as $completed
    | all(.monitoring.service5xx.finalWatermarks[]; (iso8601_epoch >= $completed))
      and ((.monitoring.database.lastCpuTimestamp|iso8601_epoch) >= $completed)
      and ((.monitoring.database.lastDbConnectionsTimestamp|iso8601_epoch) >= $completed))
  and (.monitoring.services|exact_keys(["apiInitialHash","apiFinalHash","aiInitialHash",
    "aiFinalHash","workerPausedHash","workerFinalPausedHash"]))
  and all(.monitoring.services[]; hash64)
  and .monitoring.services.apiInitialHash==.monitoring.services.apiFinalHash
  and .monitoring.services.aiInitialHash==.monitoring.services.aiFinalHash
  and .monitoring.services.workerPausedHash==.monitoring.services.workerFinalPausedHash

  and (.workers|exact_keys(["pauseVerified","restoreVerified","originalScaling","pausedScaling",
    "initialStateHash","pausedStateHash","restoredStateHash"]))
  and .workers.pauseVerified==true and .workers.restoreVerified==true
  and (.workers.originalScaling.minTaskCount|type)=="number" and .workers.originalScaling.minTaskCount>=1
  and .workers.originalScaling.maxTaskCount>=.workers.originalScaling.minTaskCount
  and .workers.pausedScaling.minTaskCount==0 and .workers.pausedScaling.maxTaskCount==0
  and (.workers.initialStateHash|hash64) and (.workers.pausedStateHash|hash64)
  and (.workers.restoredStateHash|hash64)
  and .workers.initialStateHash==.workers.restoredStateHash
  and .workers.initialStateHash!=.workers.pausedStateHash

  and (.cleanup|exact_keys(["verified","baselineHash","afterBaselineHash","residue",
    "inspectedRelations","outboxRows","inboxRows","companies"]))
  and .cleanup.verified==true and .cleanup.baselineHash==.database.baselineHash
  and .cleanup.afterBaselineHash==.database.afterBaselineHash and .cleanup.residue==0
  and .cleanup.inspectedRelations==.database.inspectedRelations
  and .cleanup.outboxRows==.database.evidence.cleanup.outboxRows
  and .cleanup.inboxRows==.database.evidence.cleanup.inboxRows
  and .cleanup.companies==.database.evidence.cleanup.companies
  and .cleanup.outboxRows==5000 and .cleanup.inboxRows==5000 and .cleanup.companies==1

  and (.timing|exact_keys(["controllerElapsedMs","databaseElapsedMs","maxElapsedMs"]))
  and .timing.controllerElapsedMs>=0 and .timing.controllerElapsedMs<=600000
  and .timing.databaseElapsedMs==.database.evidence.elapsedMs
  and .timing.databaseElapsedMs>=0 and .timing.databaseElapsedMs<=600000
  and .timing.maxElapsedMs==600000
  ' "$result" >/dev/null

printf '%s\n' "$actual_result_hash"
