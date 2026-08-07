#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
runner="$repo_root/infra/prod-ecs-express/run-release-task.sh"
wrapper="$repo_root/infra/uat/run-a5-capacity-mutating.sh"
workflow="$repo_root/.github/workflows/a5-capacity-uat.yml"
validator="$repo_root/infra/uat/validate-u5-capacity-authorization.sh"
result_validator="$repo_root/infra/uat/validate-u5-capacity-result.sh"
manifest_builder="$repo_root/infra/uat/build-u5-capacity-workload-manifest.sh"
image='311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
sha='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
marker='U5C-0123456789AB'
approval='owner-approved:2026-08-03:u5-c-v2'
baseline="$(printf 'c%.0s' {1..64})"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/u5-capacity-spec.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

bash -n "$runner"
bash -n "$wrapper"
jq empty "$repo_root/infra/uat/github-deploy-role-policy.template.json"
bash -n "$validator"
bash -n "$result_validator"
bash -n "$manifest_builder"

# ECS Express creates a fresh service revision for a scaling-only update. Effective restore proof
# ignores only that deployment metadata and array order; any real configuration drift still fails.
eval "$(sed -n '/^canonical_service_configuration() {/,/^}/p' "$wrapper")"
service_before='{"status":"ACTIVE","currentDeployment":null,"activeConfigurations":[{"createdAt":"2026-08-03T00:00:00Z","serviceRevisionArn":"arn:old","networkConfiguration":{"securityGroups":["sg-b","sg-a"],"subnets":["subnet-b","subnet-a"]},"ingressPaths":[{"accessType":"PUBLIC","endpoint":"example"}],"primaryContainer":{"image":"repo@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","containerPort":3000,"environment":[{"name":"B","value":"2"},{"name":"A","value":"1"}],"secrets":[{"name":"Y","valueFrom":"secret-y"},{"name":"X","valueFrom":"secret-x"}]},"scalingTarget":{"minTaskCount":1,"maxTaskCount":2,"autoScalingMetric":"AVERAGE_CPU","autoScalingTargetValue":70}}]}'
service_restored="$(jq -c '.activeConfigurations[0].createdAt="2026-08-03T00:10:00Z" | .activeConfigurations[0].serviceRevisionArn="arn:new" | .activeConfigurations[0].networkConfiguration.securityGroups|=reverse | .activeConfigurations[0].primaryContainer.environment|=reverse' <<< "$service_before")"
test "$(canonical_service_configuration <<< "$service_before")" = \
  "$(canonical_service_configuration <<< "$service_restored")"
service_drift="$(jq -c '.activeConfigurations[0].scalingTarget.maxTaskCount=3' <<< "$service_restored")"
test "$(canonical_service_configuration <<< "$service_before")" != \
  "$(canonical_service_configuration <<< "$service_drift")"

common=(env AWS_ACCOUNT_ID=311414082667 AWS_REGION=ap-southeast-1 DEPLOY_ENV=uat
  RELEASE_TASK_RENDER_ONLY=true GITHUB_ACTIONS=true GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1
  GITHUB_ACTOR=spec GITHUB_ACTOR_ID=123 GITHUB_REPOSITORY=MangmeeDev/mangmeeplus
  GITHUB_WORKFLOW_REF=MangmeeDev/mangmeeplus/.github/workflows/a5-capacity-uat.yml@refs/heads/main
  U5_CAPACITY_MARKER="$marker" U5_CAPACITY_APPROVAL_REF="$approval")

"${common[@]}" A5_READONLY_DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-spec \
  bash "$runner" "$image" "$sha" a5-capacity-preflight > "$tmp_dir/preflight.json"
jq -e '.taskRoleArn==null and (.containerDefinitions[0].command[2]|contains("preflight"))
  and ([.containerDefinitions[0].environment[]|select(.name=="U5_CAPACITY_BASELINE_HASH")]|length)==0' \
  "$tmp_dir/preflight.json" >/dev/null

"${common[@]}" U5_CAPACITY_BASELINE_HASH="$baseline" \
  DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/database-url-spec \
  bash "$runner" "$image" "$sha" a5-capacity > "$tmp_dir/run.json"
jq -e --arg baseline "$baseline" '.taskRoleArn==null
  and (.containerDefinitions[0].command[2]|contains(" run"))
  and ([.containerDefinitions[0].environment[]|select(.name=="U5_CAPACITY_BASELINE_HASH" and .value==$baseline)]|length)==1' \
  "$tmp_dir/run.json" >/dev/null

if "${common[@]}" U5_CAPACITY_APPROVAL_REF=owner-approved:2026-08-03:wrong \
  A5_READONLY_DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-spec \
  bash "$runner" "$image" "$sha" a5-capacity-preflight >/dev/null 2>&1; then
  echo 'ERROR: wrong approval ref reached a capacity task' >&2
  exit 1
fi
if "${common[@]}" GITHUB_WORKFLOW_REF=MangmeeDev/mangmeeplus/.github/workflows/deploy-uat.yml@refs/heads/main \
  A5_READONLY_DATABASE_URL_SECRET_ARN=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/uat/a5-readonly-database-url-spec \
  bash "$runner" "$image" "$sha" a5-capacity-preflight >/dev/null 2>&1; then
  echo 'ERROR: non-dedicated workflow reached a capacity task' >&2
  exit 1
fi

grep -Fq 'group: watchdog-bms-uat-deploy' "$workflow"
grep -Fq 'test "$GITHUB_REF" = refs/heads/main' "$workflow"
grep -Fq 'path: controller' "$workflow"
grep -Fq 'github.triggering_actor' "$workflow"
grep -Fq 'github.workflow_sha' "$workflow"
grep -Fq 'git fetch --no-tags origin "+refs/heads/main:${controller_ref}"' "$workflow"
grep -Fq 'test "$U5_CAPACITY_WORKFLOW_SHA" = "$controller_tip"' "$workflow"
grep -Fq 'git fetch --no-tags origin "+refs/heads/develop:${candidate_ref}"' "$workflow"
grep -Fq 'test "$(git rev-parse --verify '\''FETCH_HEAD^{commit}'\'')" = "$candidate_tip"' "$workflow"
grep -Fq '"$GITHUB_WORKSPACE/controller/infra/uat/run-a5-capacity-mutating.sh"' "$workflow"
! grep -Fq 'git checkout --detach "$RELEASE_REF"' "$workflow"
grep -Fq "paused_scaling=\"\$(jq -cS '.minTaskCount=0 | .maxTaskCount=0'" "$wrapper"
grep -Fq 'write_attempt READY_TO_SIGN "$evidence_hash"' "$wrapper"
! grep -Fq 'write_attempt PASSED' "$wrapper"
grep -Fq 'HTTPCode_Target_5XX_Count' "$wrapper"
grep -Fq 'HealthyHostCount' "$wrapper"
! grep -Fq 'FILL(' "$wrapper"
grep -Fq 'service_5xx_delta' "$wrapper"
grep -Fq 'describe-service-revisions --service-revision-arns' "$wrapper"
grep -Fq 'exact active ECS-managed 5xx alarm/target groups' "$wrapper"
grep -Fq 'post_run_metric_watermark_missing' "$wrapper"
grep -Fq -- '--start-time "$monitor_window_start" --end-time "$(iso_now)"' "$wrapper"
grep -Fq 'every UAT service must serve the exact capacity source SHA' "$wrapper"
grep -Fq '[ "$empty_checks" -ge 3 ] && return 0' "$wrapper"
finish_kill_line="$(sed -n '/^finish() {/,/^}/p' "$wrapper" | grep -n 'kill "$capacity_pid"' | cut -d: -f1)"
finish_stop_line="$(sed -n '/^finish() {/,/^}/p' "$wrapper" | grep -n 'stop_capacity_tasks' | head -1 | cut -d: -f1)"
[ "$finish_kill_line" -lt "$finish_stop_line" ] \
  || { echo 'ERROR: cancellation can scan ECS before stopping the local launcher' >&2; exit 1; }
grep -Fq 'recent 5xx exists before capacity run' "$wrapper"
grep -Fq 'successful capacity task has no readable ${capacity_evidence_artifact} evidence' "$runner"
grep -Fq 'for _ in $(seq 1 12); do' "$runner"
grep -Fq 'ecs:ResourceTag/WatchdogOperation' "$repo_root/infra/uat/github-deploy-role-policy.template.json"
grep -Fq 'cloudwatch:GetMetricData' "$repo_root/infra/uat/github-deploy-role-policy.template.json"
grep -Fq 'read_ignored_scale_in_alarms' "$wrapper"
grep -Fq "[ \"\$(jq 'length' <<< \"\$ignored_low_alarms\")\" -eq 3 ]" "$wrapper"
grep -Fq 'emit_pass_result' "$wrapper"
grep -Fq 'cosign sign-blob --yes --bundle "$bundle" "$result"' "$workflow"
grep -Fq 'u5-capacity-result-${{ github.run_id }}-${{ github.run_attempt }}' "$workflow"
grep -Fq '${{ env.U5_CAPACITY_RESULT_DIR }}/evidence.json' "$workflow"
grep -Fq '${{ env.U5_CAPACITY_RESULT_DIR }}/evidence.bundle' "$workflow"
grep -Fq 'org.opencontainers.image.revision' "$workflow"
grep -Fq '.status="PASSED"' "$workflow"

restore_line="$(grep -n 'if restore_workers &&' "$wrapper" | cut -d: -f1)"
emit_line="$(grep -n '^    emit_pass_result$' "$wrapper" | cut -d: -f1)"
ready_line="$(grep -n 'write_attempt READY_TO_SIGN' "$wrapper" | tail -1 | cut -d: -f1)"
[ "$restore_line" -lt "$emit_line" ] && [ "$emit_line" -lt "$ready_line" ] \
  || { echo 'ERROR: canonical result is not produced after restore and before READY_TO_SIGN' >&2; exit 1; }
image_bind_line="$(grep -n 'Bind immutable OCI revision' "$workflow" | cut -d: -f1)"
authorize_line="$(grep -n 'Create and verify exact signed U5-C authorization' "$workflow" | cut -d: -f1)"
upload_line="$(grep -n 'Upload exact signed attempt result' "$workflow" | cut -d: -f1)"
finalize_line="$(grep -n 'Finalize durable PASS' "$workflow" | cut -d: -f1)"
durable_pass_line="$(grep -n '.status=\"PASSED\"' "$workflow" | cut -d: -f1)"
[ "$image_bind_line" -lt "$authorize_line" ] \
  || { echo 'ERROR: signed authorization can precede immutable image/source binding' >&2; exit 1; }
[ "$upload_line" -lt "$finalize_line" ] && [ "$finalize_line" -lt "$durable_pass_line" ] \
  || { echo 'ERROR: durable PASSED can precede exact signed artifact upload' >&2; exit 1; }
pause_terminal_line="$(grep -n 'wait_worker_terminal_shape "$paused_scaling" true' "$wrapper" | tail -1 | cut -d: -f1)"
pause_verified_line="$(grep -n '^worker_pause_verified=true$' "$wrapper" | cut -d: -f1)"
restore_terminal_line="$(grep -n 'wait_worker_terminal_shape "$original_scaling" false' "$wrapper" | cut -d: -f1)"
restore_verified_line="$(grep -n '^  worker_restore_verified=true$' "$wrapper" | cut -d: -f1)"
[ "$pause_terminal_line" -lt "$pause_verified_line" ] && [ "$restore_terminal_line" -lt "$restore_verified_line" ] \
  || { echo 'ERROR: worker pause/restore can be accepted before terminal deployment proof' >&2; exit 1; }

workflow_sha='dddddddddddddddddddddddddddddddddddddddd'
now="$(date +%s)"
marker_hash="$(printf '%s' "$marker" | shasum -a 256 | awk '{print $1}')"
for index in 0 1 2 3 4 5; do
  printf 'path-%s\t%s\n' "$index" ffffffffffffffffffffffffffffffffffffffff
done > "$tmp_dir/workload.tsv"
manifest_hash="$(shasum -a 256 "$tmp_dir/workload.tsv" | awk '{print $1}')"
workload_blobs="$(jq -Rn '[inputs|split("\t")|{path:.[0],blob:.[1]}]' < "$tmp_dir/workload.tsv")"
jq -cnS --arg sourceSha "$sha" --arg releaseImage "$image" --arg marker "$marker" \
  --arg markerHash "$marker_hash" \
  --arg manifestHash "$manifest_hash" --arg workflowSha "$workflow_sha" \
  --argjson workloadBlobs "$workload_blobs" --argjson now "$now" '
  {artifact:"u5-capacity-authorization-v2",schemaVersion:2,repository:"MangmeeDev/mangmeeplus",
   workflowRef:"MangmeeDev/mangmeeplus/.github/workflows/a5-capacity-uat.yml@refs/heads/main",
   workflowSha:$workflowSha,sourceSha:$sourceSha,releaseImage:$releaseImage,
   marker:$marker,markerHash:$markerHash,
   workloadManifestHash:$manifestHash,approvalRef:"owner-approved:2026-08-03:u5-c-v2",
   runId:"123",runAttempt:"1",actor:"MangmeeDev",triggeringActor:"MangmeeDev",
   workloadBlobs:$workloadBlobs,
   issuedAtEpoch:$now,expiresAtEpoch:($now+3600)}' > "$tmp_dir/authorization.json"
bash "$validator" "$tmp_dir/authorization.json" "$sha" "$image" "$marker" "$manifest_hash" \
  "$workflow_sha" 123 1 MangmeeDev MangmeeDev "$now" >/dev/null
if bash "$validator" "$tmp_dir/authorization.json" "$sha" "$image" "$marker" "$manifest_hash" \
  "$workflow_sha" 123 1 attacker MangmeeDev "$now" >/dev/null 2>&1; then
  echo 'ERROR: wrong actor passed authorization' >&2; exit 1
fi
if bash "$validator" "$tmp_dir/authorization.json" "$sha" "$image" "$marker" \
  "$(printf '0%.0s' {1..64})" "$workflow_sha" 123 1 MangmeeDev MangmeeDev "$now" >/dev/null 2>&1; then
  echo 'ERROR: candidate workload drift passed authorization' >&2; exit 1
fi
if bash "$validator" "$tmp_dir/authorization.json" "$sha" "$image" "$marker" "$manifest_hash" \
  ffffffffffffffffffffffffffffffffffffffff 123 1 MangmeeDev MangmeeDev "$now" >/dev/null 2>&1; then
  echo 'ERROR: wrong controller SHA passed authorization' >&2; exit 1
fi
jq -cS --argjson now "$now" '.expiresAtEpoch=$now' "$tmp_dir/authorization.json" \
  > "$tmp_dir/expired-authorization.json"
if bash "$validator" "$tmp_dir/expired-authorization.json" "$sha" "$image" "$marker" "$manifest_hash" \
  "$workflow_sha" 123 1 MangmeeDev MangmeeDev "$now" >/dev/null 2>&1; then
  echo 'ERROR: authorization remained valid at its exclusive expiry boundary' >&2; exit 1
fi
jq -cS '.workflowRef="MangmeeDev/mangmeeplus/.github/workflows/deploy-uat.yml@refs/heads/main"' \
  "$tmp_dir/authorization.json" > "$tmp_dir/wrong-ref.json"
if bash "$validator" "$tmp_dir/wrong-ref.json" "$sha" "$image" "$marker" "$manifest_hash" \
  "$workflow_sha" 123 1 MangmeeDev MangmeeDev "$now" >/dev/null 2>&1; then
  echo 'ERROR: wrong workflow ref passed authorization' >&2; exit 1
fi
jq -cS '.marker="U5C-FFFFFFFFFFFF"' "$tmp_dir/authorization.json" > "$tmp_dir/wrong-marker.json"
if bash "$validator" "$tmp_dir/wrong-marker.json" "$sha" "$image" "$marker" "$manifest_hash" \
  "$workflow_sha" 123 1 MangmeeDev MangmeeDev "$now" >/dev/null 2>&1; then
  echo 'ERROR: raw marker/hash mismatch passed authorization' >&2; exit 1
fi

sha256_path() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
rehash_result() {
  local input="$1" output="$2" base="$tmp_dir/result-rehash-base.json" hash
  jq -cS 'del(.resultHash)' "$input" > "$base"
  hash="$(sha256_path "$base")"
  jq -cS --arg resultHash "$hash" '.+{resultHash:$resultHash}' "$base" > "$output"
}
rehash_database_and_result() {
  local input="$1" output="$2" inner_base="$tmp_dir/inner-base.json"
  local inner_bound="$tmp_dir/inner-bound.json" root_bound="$tmp_dir/root-bound.json"
  local inner_hash canonical_hash
  jq -cS '.database.evidence|del(.evidenceHash)' "$input" > "$inner_base"
  inner_hash="$(sha256_path "$inner_base")"
  jq -cS --arg innerHash "$inner_hash" \
    '.database.evidence.evidenceHash=$innerHash | .database.evidenceHash=$innerHash' \
    "$input" > "$inner_bound"
  jq -cS '.database.evidence' "$inner_bound" > "$inner_base"
  canonical_hash="$(sha256_path "$inner_base")"
  jq -cS --arg canonicalHash "$canonical_hash" \
    '.database.canonicalEvidenceHash=$canonicalHash' "$inner_bound" > "$root_bound"
  rehash_result "$root_bound" "$output"
}

# Strict signed-result consumer fixture. Mutations are re-hashed so semantic failures cannot pass
# merely because the outer self-hash caught them first.
approval_hash="$(printf '%s' "$approval" | shasum -a 256 | awk '{print $1}')"
authorization_hash="$(sha256_path "$tmp_dir/authorization.json")"
hash_a="$(printf 'a%.0s' {1..64})"
hash_b="$(printf 'b%.0s' {1..64})"
hash_32="$(printf 'd%.0s' {1..32})"
jq -cnS --arg sourceSha "$sha" --arg markerHash "$marker_hash" --arg approvalHash "$approval_hash" \
  --arg baseline "$baseline" --arg hash32 "$hash_32" '
  def limits: {
    smokeRows:100,fullRows:5000,seedChunkRows:250,maxSeedRowsPerSecond:500,
    claimBatchSizes:[1,25],claimConcurrencies:[1,2,5],processingConcurrency:2,
    backlogDepths:[100,500,1000,2500,5000],samplesPerDepthAndShape:20,
    lockConcurrencies:[2,5,10],lockIterations:20,lockHoldMs:10,maxWallMs:600000,
    claimP95AbortMs:250,lockP95AbortMs:500,connectionRatioAbort:0.70,
    statementTimeoutMs:2000,lockTimeoutMs:500,idleInTransactionTimeoutMs:5000};
  def latency($count): {count:$count,p50Ms:1,p95Ms:2,p99Ms:3,maxMs:4};
  def claim_shapes($rows):
    [[100,500,1000,2500,5000][] as $depth | select($depth<=$rows)
      | [1,25][] as $batch | [1,2,5][] as $concurrency
      | {backlogDepth:$depth,batchSize:$batch,concurrency:$concurrency,
         latency:latency($concurrency*20)}];
  def cleanup($rows):
    {cleanupVerified:true,afterBaselineHash:$baseline,residue:0,inspectedRelations:3,
     fixtureOutboxRows:$rows,fixtureInboxRows:$rows,outboxRows:$rows,inboxRows:$rows,companies:1};
  {artifact:"a5-capacity-mutating-v2",targetEnvironment:"uat",sourceCommit:$sourceSha,
   markerHash:$markerHash,approvalRefHash:$approvalHash,expectedBaselineHash:$baseline,
   startedAt:"2026-08-03T00:00:00.000Z",completedAt:"2026-08-03T00:01:00.000Z",
   elapsedMs:60000,limits:limits,
   baseline:{outboxCount:1,outboxStateHash:$hash32,inboxCount:1,inboxStateHash:$hash32,
     nullCompanyOutbox:0},
   smoke:{rows:100,claimShapes:claim_shapes(100),
     processing:{rows:100,wallMs:100,rowsPerSecond:1000,itemLatency:latency(100)},
     locks:[],maxConnectionRatio:0.10},
   smokeCleanup:cleanup(100),
   full:{rows:5000,claimShapes:claim_shapes(5000),
     processing:{rows:5000,wallMs:5000,rowsPerSecond:1000,itemLatency:latency(5000)},
     locks:[[2,5,10][] as $concurrency
       | {concurrency:$concurrency,latency:latency($concurrency*20)}],
     maxConnectionRatio:0.20},
   cleanup:cleanup(5000),cleanupVerified:true,failureCode:null,passed:true}
  ' > "$tmp_dir/database-evidence-base.json"
database_evidence_hash="$(sha256_path "$tmp_dir/database-evidence-base.json")"
jq -cS --arg evidenceHash "$database_evidence_hash" '.+{evidenceHash:$evidenceHash}' \
  "$tmp_dir/database-evidence-base.json" > "$tmp_dir/database-evidence.json"
sha256_file() { sha256_path "$1"; }
sha256_value() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}
generated_iso="$(jq -nr --argjson epoch "$now" '$epoch|todateiso8601')"
iso_now() { printf '%s\n' "$generated_iso"; }
elapsed_ms() { printf '65000\n'; }
eval "$(sed -n '/^emit_pass_result() {/,/^}/p' "$wrapper")"

mkdir -p "$tmp_dir/result-output"
result_file="$tmp_dir/result-output/evidence.json"
authorization_file="$tmp_dir/authorization.json"
authorization_verified=true
source_sha="$sha"
release_image="$image"
workload_manifest_hash="$manifest_hash"
GITHUB_RUN_ID=123
GITHUB_RUN_ATTEMPT=1
GITHUB_ACTOR=MangmeeDev
GITHUB_TRIGGERING_ACTOR=MangmeeDev
baseline_hash="$baseline"
alarm_initial_set_hash="$hash_a"
alarm_final_set_hash="$hash_a"
ignored_low_alarms='["TargetTracking-service/watchdog-bms-uat/api-AlarmLow-a","TargetTracking-service/watchdog-bms-uat/ai-AlarmLow-b","TargetTracking-service/watchdog-bms-uat/workers-AlarmLow-c"]'
ignored_low_alarms_hash="$hash_b"
service_5xx_metrics_hash="$hash_a"
service_5xx_final_metrics_hash="$hash_a"
service_5xx_baselines='{"watchdog-bms-uat-ai-gateway":0,"watchdog-bms-uat-api-web":0,"watchdog-bms-uat-workers":0}'
service_5xx_finals="$service_5xx_baselines"
service_5xx_baseline_watermarks='{"watchdog-bms-uat-ai-gateway":"2026-08-03T00:00:00Z","watchdog-bms-uat-api-web":"2026-08-03T00:00:00Z","watchdog-bms-uat-workers":"2026-08-03T00:00:00Z"}'
service_5xx_final_watermarks='{"watchdog-bms-uat-ai-gateway":"2026-08-03T00:01:00Z","watchdog-bms-uat-api-web":"2026-08-03T00:01:00Z","watchdog-bms-uat-workers":"2026-08-03T00:01:00Z"}'
api_state_hash="$hash_a"
api_final_state_hash="$hash_a"
ai_state_hash="$hash_a"
ai_final_state_hash="$hash_a"
worker_initial_state_hash="$hash_a"
paused_worker_state_hash="$hash_b"
worker_final_paused_state_hash="$hash_b"
worker_restored_state_hash="$hash_a"
last_cpu_timestamp='2026-08-03T00:01:00Z'
last_db_connections_timestamp='2026-08-03T00:01:00Z'
original_scaling='{"minTaskCount":1,"maxTaskCount":2,"autoScalingMetric":"CPUUtilization","autoScalingTargetValue":70}'
paused_scaling='{"minTaskCount":0,"maxTaskCount":0,"autoScalingMetric":"CPUUtilization","autoScalingTargetValue":70}'
blocking_alarms_initial=0
blocking_alarms_final=0
monitor_checks=2
max_cpu_percent=10
max_db_connections=5
max_db_connection_ratio=0.05
max_high_cpu_samples=0
worker_pause_verified=true
worker_restore_verified=true
monitor_abort=''
evidence="$(<"$tmp_dir/database-evidence.json")"
emit_pass_result
bash "$result_validator" "$result_file" "$sha" "$image" \
  "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null

jq '.monitoring.passed=false' "$result_file" > "$tmp_dir/forged-pass-input.json"
rehash_result "$tmp_dir/forged-pass-input.json" "$tmp_dir/forged-pass.json"
if bash "$result_validator" "$tmp_dir/forged-pass.json" "$sha" "$image" \
  "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null 2>&1; then
  echo 'ERROR: forged monitoring PASS reached signed-result acceptance' >&2; exit 1
fi
jq '.cleanup.verified=false | .workers.restoreVerified=false' "$result_file" \
  > "$tmp_dir/missing-cleanup-input.json"
rehash_result "$tmp_dir/missing-cleanup-input.json" "$tmp_dir/missing-cleanup.json"
if bash "$result_validator" "$tmp_dir/missing-cleanup.json" "$sha" "$image" \
  "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null 2>&1; then
  echo 'ERROR: missing cleanup/restore reached signed-result acceptance' >&2; exit 1
fi
for watermark_mutation in databaseCpuWatermark service5xxWatermark; do
  case "$watermark_mutation" in
    databaseCpuWatermark) filter='.monitoring.database.lastCpuTimestamp="2026-08-03T00:00:59Z"' ;;
    service5xxWatermark) filter='.monitoring.service5xx.finalWatermarks["watchdog-bms-uat-api-web"]="2026-08-03T00:00:59Z"' ;;
  esac
  jq "$filter" "$result_file" > "$tmp_dir/${watermark_mutation}-input.json"
  rehash_result "$tmp_dir/${watermark_mutation}-input.json" "$tmp_dir/${watermark_mutation}.json"
  if bash "$result_validator" "$tmp_dir/${watermark_mutation}.json" "$sha" "$image" \
    "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null 2>&1; then
    echo "ERROR: stale post-run metric watermark passed: $watermark_mutation" >&2; exit 1
  fi
done
for semantic_mutation in claimP95 duplicateShape smokeCleanup subsecondWatermark; do
  case "$semantic_mutation" in
    claimP95) filter='.database.evidence.full.claimShapes[0].latency |= (.p95Ms=251 | .p99Ms=251 | .maxMs=251)' ;;
    duplicateShape) filter='.database.evidence.full.claimShapes[1] |=
      (.backlogDepth=.database.evidence.full.claimShapes[0].backlogDepth |
       .batchSize=.database.evidence.full.claimShapes[0].batchSize |
       .concurrency=.database.evidence.full.claimShapes[0].concurrency)' ;;
    smokeCleanup) filter='.database.evidence.smokeCleanup.outboxRows=99' ;;
    subsecondWatermark) filter='.database.evidence.completedAt="2026-08-03T00:01:00.999Z"' ;;
  esac
  if [ "$semantic_mutation" = duplicateShape ]; then
    jq '.database.evidence.full.claimShapes[0] as $first
      | .database.evidence.full.claimShapes[1].backlogDepth=$first.backlogDepth
      | .database.evidence.full.claimShapes[1].batchSize=$first.batchSize
      | .database.evidence.full.claimShapes[1].concurrency=$first.concurrency' \
      "$result_file" > "$tmp_dir/${semantic_mutation}-input.json"
  else
    jq "$filter" "$result_file" > "$tmp_dir/${semantic_mutation}-input.json"
  fi
  rehash_database_and_result "$tmp_dir/${semantic_mutation}-input.json" "$tmp_dir/${semantic_mutation}.json"
  if bash "$result_validator" "$tmp_dir/${semantic_mutation}.json" "$sha" "$image" \
    "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null 2>&1; then
    echo "ERROR: re-hashed semantic capacity forgery passed: $semantic_mutation" >&2; exit 1
  fi
done
for mutation in sourceSha marker markerHash workloadManifestHash authorizationHash authorizationContent authorizationVerified runId; do
  case "$mutation" in
    sourceSha) filter='.source.sourceSha="ffffffffffffffffffffffffffffffffffffffff"' ;;
    marker) filter='.source.marker="U5C-FFFFFFFFFFFF"' ;;
    markerHash) filter='.source.markerHash="0000000000000000000000000000000000000000000000000000000000000000"' ;;
    workloadManifestHash) filter='.source.workloadManifestHash="0000000000000000000000000000000000000000000000000000000000000000"' ;;
    authorizationHash) filter='.authorization.hash="0000000000000000000000000000000000000000000000000000000000000000"' ;;
    authorizationContent) filter='.authorization.content="{}"' ;;
    authorizationVerified) filter='.authorization.verified=false' ;;
    runId) filter='.source.runId="999"' ;;
  esac
  jq "$filter" "$result_file" > "$tmp_dir/${mutation}-input.json"
  rehash_result "$tmp_dir/${mutation}-input.json" "$tmp_dir/${mutation}.json"
  if bash "$result_validator" "$tmp_dir/${mutation}.json" "$sha" "$image" \
    "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null 2>&1; then
    echo "ERROR: wrong result binding passed: $mutation" >&2; exit 1
  fi
done
jq . "$result_file" > "$tmp_dir/noncanonical.json"
if bash "$result_validator" "$tmp_dir/noncanonical.json" "$sha" "$image" \
  "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null 2>&1; then
  echo 'ERROR: noncanonical result bytes passed' >&2; exit 1
fi
jq -cS '.resultHash="0000000000000000000000000000000000000000000000000000000000000000"' \
  "$result_file" > "$tmp_dir/self-hash-mismatch.json"
if bash "$result_validator" "$tmp_dir/self-hash-mismatch.json" "$sha" "$image" \
  "$marker" "$manifest_hash" "$workflow_sha" 123 1 MangmeeDev MangmeeDev >/dev/null 2>&1; then
  echo 'ERROR: result self-hash mismatch passed' >&2; exit 1
fi
gate_line="$(grep -n 'Require the main-only one-shot controller' "$workflow" | cut -d: -f1)"
credentials_line="$(grep -n 'Configure exact UAT deploy credentials' "$workflow" | cut -d: -f1)"
[ "$gate_line" -lt "$credentials_line" ] || { echo 'ERROR: actor/ref gate runs after AWS credentials' >&2; exit 1; }

# A candidate can use only the exact reviewed Git objects in the main-owned allowlist.
mkdir -p "$tmp_dir/git-fixture"
(
  cd "$tmp_dir/git-fixture"
  git init -q
  git config user.name spec
  git config user.email spec@example.com
  git config commit.gpgsign false
  : > approved.tsv
  for index in 1 2 3 4 5 6; do
    printf 'approved-%s\n' "$index" > "file-${index}"
    printf 'file-%s\t%s\n' "$index" "$(git hash-object "file-${index}")" >> approved.tsv
  done
  mkdir -p runtime-tree/nested
  printf 'approved runtime dependency\n' > runtime-tree/nested/dependency.ts
  git add -f runtime-tree
  staged_tree="$(git write-tree)"
  printf 'runtime-tree\t%s\n' "$(git rev-parse "${staged_tree}:runtime-tree")" >> approved.tsv
  git add file-* approved.tsv
  git commit -qm approved
  approved_sha="$(git rev-parse HEAD)"
  bash "$manifest_builder" "$approved_sha" manifest.tsv approved.tsv

  printf 'unreviewed transitive dependency\n' > runtime-tree/nested/dependency.ts
  git add -f runtime-tree
  git commit -qm tree-drift
  if bash "$manifest_builder" "$(git rev-parse HEAD)" changed-tree.tsv approved.tsv >/dev/null 2>&1; then
    echo 'ERROR: changed candidate runtime tree passed the approved allowlist' >&2
    exit 1
  fi
  git checkout "$approved_sha" -- runtime-tree
  git commit -qm restore-tree
  printf 'candidate drift\n' > file-3
  git add file-3
  git commit -qm drift
  if bash "$manifest_builder" "$(git rev-parse HEAD)" changed.tsv approved.tsv >/dev/null 2>&1; then
    echo 'ERROR: changed candidate blob passed the approved allowlist' >&2
    exit 1
  fi
)

# Existing autoscaling AlarmLow is an explicit scale-in signal, not a service incident; all other
# ALARM rows still block. Keep this fixture next to the static wrapper assertion to pin the regex.
alarm_fixture='{"MetricAlarms":[
  {"AlarmName":"TargetTracking-service/watchdog-bms-uat/api-AlarmLow-aaa","StateValue":"ALARM"},
  {"AlarmName":"TargetTracking-service/watchdog-bms-uat/ai-AlarmLow-bbb","StateValue":"ALARM"},
  {"AlarmName":"TargetTracking-service/watchdog-bms-uat/workers-AlarmLow-ccc","StateValue":"ALARM"}]}'
eval "$(sed -n '/^blocking_alarm_count() {/,/^}/p' "$wrapper")"
[ "$(blocking_alarm_count <<< "$alarm_fixture")" -eq 0 ]
blocking_fixture="$(jq '.MetricAlarms += [{AlarmName:"watchdog-bms-uat-security",StateValue:"ALARM"}]' <<< "$alarm_fixture")"
[ "$(blocking_alarm_count <<< "$blocking_fixture")" -eq 1 ]
composite_fixture="$(jq '.CompositeAlarms=[{AlarmName:"watchdog-bms-uat-composite",StateValue:"ALARM"}]' <<< "$alarm_fixture")"
[ "$(blocking_alarm_count <<< "$composite_fixture")" -eq 1 ]
other_environment_fixture="$(jq '.MetricAlarms += [{AlarmName:"watchdog-bms-prod-security",StateValue:"ALARM"}]' <<< "$alarm_fixture")"
[ "$(blocking_alarm_count <<< "$other_environment_fixture")" -eq 0 ]
eval "$(sed -n '/^alarm_state_set() {/,/^}/p' "$wrapper")"
[ "$(alarm_state_set <<< "$alarm_fixture")" = "$(alarm_state_set <<< "$other_environment_fixture")" ]

# A live rollback alarm can monitor both blue and green target groups. Exercise the wrapper's
# parser itself: it must retain both metrics, but fail closed on an unknown third target group.
eval "$(sed -n '/^find_service_5xx_metric() {/,/^}/p' "$wrapper")"
rollback_alarm_arn='arn:aws:cloudwatch:ap-southeast-1:311414082667:alarm:watchdog-bms-uat-api-web-RollbackAlarm'
rollback_alarm_fixture='{"MetricAlarms":[{"AlarmName":"watchdog-bms-uat-api-web-RollbackAlarm",
  "AlarmArn":"arn:aws:cloudwatch:ap-southeast-1:311414082667:alarm:watchdog-bms-uat-api-web-RollbackAlarm",
  "StateValue":"OK","ActionsEnabled":true,"Metrics":[
    {"Id":"blue5xx","MetricStat":{"Metric":{"Namespace":"AWS/ApplicationELB",
      "MetricName":"HTTPCode_Target_5XX_Count","Dimensions":[
        {"Name":"LoadBalancer","Value":"app/uat/blue"},{"Name":"TargetGroup","Value":"targetgroup/api-blue"}]}}},
    {"Id":"green5xx","MetricStat":{"Metric":{"Namespace":"AWS/ApplicationELB",
      "MetricName":"HTTPCode_Target_5XX_Count","Dimensions":[
        {"Name":"TargetGroup","Value":"targetgroup/api-green"},{"Name":"LoadBalancer","Value":"app/uat/green"}]}}}
  ]}]}'
rollback_binding="$(jq -cn --arg alarmArn "$rollback_alarm_arn" '
  {serviceName:"watchdog-bms-uat-api-web",alarmArn:$alarmArn,metrics:[
    {dimensions:[{Name:"LoadBalancer",Value:"app/uat/blue"},{Name:"TargetGroup",Value:"targetgroup/api-blue"}]},
    {dimensions:[{Name:"LoadBalancer",Value:"app/uat/green"},{Name:"TargetGroup",Value:"targetgroup/api-green"}]}
  ]}')"
parsed_rollback_alarm="$(find_service_5xx_metric "$rollback_binding" <<< "$rollback_alarm_fixture")"
jq -e '.serviceName=="watchdog-bms-uat-api-web" and (.metrics|length)==2' \
  <<< "$parsed_rollback_alarm" >/dev/null
unknown_shape="$(jq '.MetricAlarms[0].Metrics += [.MetricAlarms[0].Metrics[0]
  | .Id="canary5xx" | .MetricStat.Metric.Dimensions[1].Value="targetgroup/api-canary"]' \
  <<< "$rollback_alarm_fixture")"
if find_service_5xx_metric "$rollback_binding" <<< "$unknown_shape" >/dev/null 2>&1; then
  echo 'ERROR: unknown third target-group 5xx metric passed the controller' >&2
  exit 1
fi
malformed_shape="$(jq '.MetricAlarms[0].Metrics += [.MetricAlarms[0].Metrics[0]
  | .Id="malformed5xx" | .MetricStat.Metric.Dimensions=[{Name:"TargetGroup",Value:"targetgroup/api-blue"}]]' \
  <<< "$rollback_alarm_fixture")"
if find_service_5xx_metric "$rollback_binding" <<< "$malformed_shape" >/dev/null 2>&1; then
  echo 'ERROR: malformed extra 5xx metric passed the controller' >&2
  exit 1
fi
wrong_alarm_binding="$(jq -c '.alarmArn+="-stale"' <<< "$rollback_binding")"
if find_service_5xx_metric "$wrong_alarm_binding" <<< "$rollback_alarm_fixture" >/dev/null 2>&1; then
  echo 'ERROR: stale ECS-managed alarm ARN passed the controller' >&2
  exit 1
fi

# Bind alarm dimensions to the exact target groups and load balancer reported by the one active
# ECS service revision. Names alone are deliberately insufficient.
eval "$(sed -n '/^service_alarm_binding() {/,/^}/p' "$wrapper")"
region=ap-southeast-1
account_id=311414082667
service_arn='arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/watchdog-bms-uat-api-web'
fixture_revision_arn='arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-uat/watchdog-bms-uat-api-web/1'
target_group_blue='arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/api-blue/1'
target_group_green='arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/api-green/2'
load_balancer_arn='arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:loadbalancer/app/uat/1'
revision_fixture="$(jq -cn --arg serviceArn "$service_arn" --arg revisionArn "$fixture_revision_arn" \
  --arg blue "$target_group_blue" --arg green "$target_group_green" \
  --arg loadBalancer "$load_balancer_arn" --arg alarmArn "$rollback_alarm_arn" '
  {failures:[],serviceRevisions:[{serviceArn:$serviceArn,serviceRevisionArn:$revisionArn,
    loadBalancers:[{targetGroupArn:$blue,advancedConfiguration:{alternateTargetGroupArn:$green}}],
    ecsManagedResources:{ingressPaths:[{accessType:"PUBLIC",
      loadBalancer:{arn:$loadBalancer,status:"ACTIVE"},
      targetGroups:[{arn:$blue,status:"ACTIVE"},{arn:$green,status:"ACTIVE"}]}],
      metricAlarms:[{arn:$alarmArn,status:"ACTIVE"}]}}]}')"
service_snapshot() { jq -cn --arg revisionArn "$fixture_revision_arn" \
  '{activeConfigurations:[{serviceRevisionArn:$revisionArn}]}'; }
aws_cmd() { printf '%s\n' "$revision_fixture"; }
live_binding="$(service_alarm_binding "$service_arn")"
jq -e --arg alarmArn "$rollback_alarm_arn" '
  .serviceName=="watchdog-bms-uat-api-web" and .alarmArn==$alarmArn
  and (.metrics|length)==2
  and ([.metrics[].dimensions[]|select(.Name=="LoadBalancer")|.Value]|unique)==["app/uat/1"]
  and ([.metrics[].dimensions[]|select(.Name=="TargetGroup")|.Value]|sort)
    ==["targetgroup/api-blue/1","targetgroup/api-green/2"]' <<< "$live_binding" >/dev/null
valid_revision_fixture="$revision_fixture"
revision_fixture="$(jq -c '.serviceRevisions[0].serviceRevisionArn += "-stale"' \
  <<< "$valid_revision_fixture")"
if service_alarm_binding "$service_arn" >/dev/null 2>&1; then
  echo 'ERROR: wrong ECS service revision passed the controller' >&2
  exit 1
fi
revision_fixture="$(jq -c '
  .serviceRevisions[0].loadBalancers[0].targetGroupArn |= sub("311414082667";"999999999999")
  | .serviceRevisions[0].ecsManagedResources.ingressPaths[0].targetGroups[0].arn
      |= sub("311414082667";"999999999999")' <<< "$valid_revision_fixture")"
if service_alarm_binding "$service_arn" >/dev/null 2>&1; then
  echo 'ERROR: cross-account ECS target group passed the controller' >&2
  exit 1
fi
revision_fixture="$valid_revision_fixture"
revision_fixture="$(jq -c '.serviceRevisions[0].ecsManagedResources.ingressPaths[0].targetGroups[1].arn
  = "arn:aws:elasticloadbalancing:ap-southeast-1:311414082667:targetgroup/stale/3"' \
  <<< "$revision_fixture")"
if service_alarm_binding "$service_arn" >/dev/null 2>&1; then
  echo 'ERROR: ECS managed/declaration target-group drift passed the controller' >&2
  exit 1
fi

# Exercise the freshness helpers themselves without depending on BSD/GNU date differences locally.
(
  eval "$(sed -n '/^read_one_5xx_total() {/,/^}/p' "$wrapper")"
  eval "$(sed -n '/^monitor_watermarks_cover() {/,/^}/p' "$wrapper")"
  epoch_0059="$(jq -nr '"2026-08-03T00:00:59Z"|fromdateiso8601')"
  epoch_0100="$(jq -nr '"2026-08-03T00:01:00Z"|fromdateiso8601')"
  date() {
    if [ "$1" = '+%s' ]; then printf '%s\n' "$epoch_0100"; return; fi
    if [ "$1" = '-d' ]; then
      case "$2" in
        2026-08-03T00:00:59Z) printf '%s\n' "$epoch_0059" ;;
        2026-08-03T00:01:00Z|2026-08-03T00:01:00.000Z|2026-08-03T00:01:00.999Z) printf '%s\n' "$epoch_0100" ;;
        *) return 1 ;;
      esac
      return
    fi
    if [ "$1" = '-u' ] && [ "$2" = '-d' ]; then printf '%s\n' "$3"; return; fi
    return 1
  }
  iso_now() { printf '2026-08-03T00:01:00Z\n'; }
  aws_cmd() { printf '%s\n' "$metric_data_fixture"; }
  monitor_window_start='2026-08-02T23:55:00Z'
  region=ap-southeast-1
  metric_data_fixture='{"MetricDataResults":[
    {"Id":"m5","StatusCode":"Complete","Timestamps":[],"Values":[]},
    {"Id":"wm","StatusCode":"Complete","Timestamps":["2026-08-03T00:01:00Z"],"Values":[1]}]}'
  measurement="$(read_one_5xx_total '[]')"
  jq -e '.total==0 and .watermark=="2026-08-03T00:01:00Z"' <<< "$measurement" >/dev/null
  metric_data_fixture="$(jq -c '.MetricDataResults[1].StatusCode="PartialData"' <<< "$metric_data_fixture")"
  if read_one_5xx_total '[]' >/dev/null 2>&1; then
    echo 'ERROR: incomplete post-run metric data passed freshness validation' >&2
    exit 1
  fi

  last_cpu_timestamp='2026-08-03T00:01:00Z'
  last_db_connections_timestamp='2026-08-03T00:01:00Z'
  service_5xx_final_watermarks='{"api":"2026-08-03T00:01:00Z","ai":"2026-08-03T00:01:00Z","workers":"2026-08-03T00:01:00Z"}'
  monitor_watermarks_cover '2026-08-03T00:01:00.000Z'
  if monitor_watermarks_cover '2026-08-03T00:01:00.999Z'; then
    echo 'ERROR: same-second metric watermark passed a later millisecond completion' >&2
    exit 1
  fi
  service_5xx_final_watermarks='{"api":"2026-08-03T00:00:59Z","ai":"2026-08-03T00:01:00Z","workers":"2026-08-03T00:01:00Z"}'
  if monitor_watermarks_cover '2026-08-03T00:01:00.000Z'; then
    echo 'ERROR: one stale service watermark passed post-run coverage' >&2
    exit 1
  fi
)

echo 'A5 capacity controller safety spec passed'
