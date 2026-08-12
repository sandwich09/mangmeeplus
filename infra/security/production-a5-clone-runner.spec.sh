#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
runner="$repo_root/infra/security/run-production-a5-clone.sh"
reconstruct="$repo_root/infra/security/reconstruct-production-a5-clone-result.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-clone-runner.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT

bash -n "$runner" "$reconstruct"
for required in \
  'snapshot-type automated' '129600' 'aws rds modify-db-instance' \
  '--manage-master-user-password --apply-immediately' \
  'alias/aws/secretsmanager' \
  'b2e68e7f-e098-4b88-a92a-5a0f4fe2924a' \
  'watchdog-bms-production-a5-clone-execution' 'migrationTaskRoleArn:null' \
  '"--tsconfig","/app/apps/api/tsconfig.json"' \
  '{name:"PGDATABASE",value:$database}' '{name:"PGHOST",value:$host}' \
  '{name:"PGPASSWORD",valueFrom:($secret+":password::"+$version)}' \
  '{name:"PGUSER",valueFrom:($secret+":username::"+$version)}' \
  'temporaryDatabaseSecretVersionId' \
  '{name:"GIT_SHA",value:$source}' \
  'select(.name=="GIT_SHA")|.value])==[$source]' \
  'DBInstanceNotFound' 'ResourceNotFoundException' 'InvalidNetworkInterfaceID.NotFound' \
  'active-release-tasks.sh' 'ecs list-task-definitions' \
  '--started-by "$window_id" --client-token "$run_client_token"' \
  'for attempt in {1..9}' 'for check in {1..385}' 'for page in {1..100}' \
  'for check in {1..61}' 'required_empty_checks=61' \
  'aws:rds:primaryDBInstanceArn' '[ "${#eni_array[@]}" -eq 1 ]' \
  'cleanup_attempted=false' '$cleanup_attempted && return 1' \
  'if ! cleanup; then' 'refusing a duplicate unbounded cleanup attempt' \
  '--argjson residual "$residual_resource_count"' \
  'residualResourceCount:$residual'; do
  grep -F -- "$required" "$runner" >/dev/null
done

# Model the longest successful path from the fixed polling/backoff budgets below. The workflow
# refreshes 120-minute credentials immediately before the runner and reserves cleanup time before
# either the role session or the enclosing 150-minute job can expire.
workflow_budget_seconds=9000
credential_budget_seconds=7200
workflow_pre_runner_seconds=600
workflow_post_runner_seconds=300
runner_preflight_and_evidence_seconds=300
restore_seconds=$((119*15))
managed_secret_seconds=$((19*15))
secret_metadata_seconds=$((12*5))
run_task_trust_seconds=$((2+4+8+16+32+64+90+90))
task_visibility_seconds=$((2+4+8+16+32+64+90))
task_runtime_seconds=$((384*5))
log_visibility_seconds=$((12*5))
success_cleanup_seconds=$((2*5 + 2*5 + 60*15 + 24*5 + 36*5))
runner_forward_seconds=$((runner_preflight_and_evidence_seconds + restore_seconds
  + managed_secret_seconds + secret_metadata_seconds + run_task_trust_seconds
  + task_visibility_seconds + task_runtime_seconds + log_visibility_seconds))
modeled_success_seconds=$((workflow_pre_runner_seconds + runner_forward_seconds
  + success_cleanup_seconds + workflow_post_runner_seconds))
test "$success_cleanup_seconds" -eq 1220
test "$runner_forward_seconds" -eq 4932
test "$modeled_success_seconds" -eq 7052
test "$modeled_success_seconds" -le "$workflow_budget_seconds"
test "$runner_forward_seconds" -lt $((credential_budget_seconds-success_cleanup_seconds))
test $((runner_forward_seconds+success_cleanup_seconds)) -eq 6152

# Ambiguous provider responses reserve cleanup inside the same refreshed 7,200-second session.
unknown_restore_visibility_seconds=$((60*5))
unknown_definition_visibility_seconds=$((60*5))
unknown_task_visibility_seconds=$((60*5))
unknown_db_cleanup_seconds=$((60*15))
unknown_secret_cleanup_seconds=$((24*5))
unknown_eni_cleanup_seconds=$((36*5))
stable_task_cleanup_seconds=$((2*5))
stable_definition_cleanup_seconds=$((2*5))
ambiguous_restore_failure_seconds=$((runner_preflight_and_evidence_seconds
  + stable_task_cleanup_seconds + stable_definition_cleanup_seconds
  + unknown_restore_visibility_seconds + unknown_db_cleanup_seconds))
ambiguous_modify_failure_seconds=$((runner_preflight_and_evidence_seconds + restore_seconds
  + stable_task_cleanup_seconds + stable_definition_cleanup_seconds
  + unknown_db_cleanup_seconds + unknown_secret_cleanup_seconds))
ambiguous_definition_failure_seconds=$((runner_preflight_and_evidence_seconds + restore_seconds
  + managed_secret_seconds + secret_metadata_seconds + stable_task_cleanup_seconds
  + unknown_definition_visibility_seconds + unknown_db_cleanup_seconds
  + unknown_secret_cleanup_seconds))
ambiguous_run_task_failure_seconds=$((runner_preflight_and_evidence_seconds + restore_seconds
  + managed_secret_seconds + secret_metadata_seconds + run_task_trust_seconds
  + unknown_task_visibility_seconds + stable_definition_cleanup_seconds
  + unknown_db_cleanup_seconds + unknown_secret_cleanup_seconds + unknown_eni_cleanup_seconds))
test "$ambiguous_restore_failure_seconds" -eq 1520
test "$ambiguous_modify_failure_seconds" -eq 3125
test "$ambiguous_definition_failure_seconds" -eq 3760
test "$ambiguous_run_task_failure_seconds" -eq 4246
for failure_seconds in "$ambiguous_restore_failure_seconds" \
    "$ambiguous_modify_failure_seconds" "$ambiguous_definition_failure_seconds" \
    "$ambiguous_run_task_failure_seconds"; do
  test "$failure_seconds" -lt "$credential_budget_seconds"
done
for forbidden in \
  'get-secret-value' 'managed-secret.json' 'clone-url' '--secret-string' \
  'create-secret' 'PRODUCTION_A5_CLONE_DATABASE_URL' \
  '{name:"PGDATABASE",valueFrom:' '{name:"PGHOST",valueFrom:' \
  'aws ecs wait tasks-stopped' 'aws rds wait db-instance-available' 'residualResourceCount:0' \
  'instanceAbsent:true' 'secretDeleted:true' 'taskStopped:true'; do
  if grep -F -- "$forbidden" "$runner" >/dev/null; then
    echo "ERROR: clone runner exposes a database credential path: $forbidden" >&2
    exit 1
  fi
done

restore_command="$(awk '
  /aws rds restore-db-instance-from-db-snapshot/{capture=1}
  capture{print}
  capture && $0 !~ /\\$/ {exit}
' "$runner")"
grep -F -- '--tags "file://$OUTPUT_DIR/tags.json"' <<< "$restore_command" >/dev/null
if grep -F -- '--manage-master-user-password' <<< "$restore_command" >/dev/null; then
  echo 'ERROR: PostgreSQL snapshot restore still requests the Oracle-only managed-secret flag' >&2
  exit 1
fi
modify_command="$(awk '
  /aws rds modify-db-instance/{capture=1}
  capture{print}
  capture && $0 !~ /\\$/ {exit}
' "$runner")"
if grep -F -- '--master-user-secret-kms-key-id' <<< "$modify_command" >/dev/null; then
  echo 'ERROR: modify explicitly selects a KMS key instead of the AWS managed default' >&2
  exit 1
fi
grep -F -- '--manage-master-user-password --apply-immediately' <<< "$modify_command" >/dev/null

if grep -F 'watchdog-bms/production/database-url' "$runner" >/dev/null; then
  echo 'ERROR: clone runner references the production writer secret' >&2
  exit 1
fi
if grep -F 'LatestRestorableTime' "$runner" >/dev/null; then
  echo 'ERROR: clone runner treats PITR metadata as snapshot-restore proof' >&2
  exit 1
fi

# Execute the provider state machines with a fake AWS CLI so transition, terminal-state and
# multi-page CloudWatch semantics are proved rather than inferred from static text.
source "$runner"
export AWS_REGION=ap-southeast-1 temporary_id=watchdog-a5-clone-fixture
fake_aws="$fixture/aws"
cat > "$fake_aws" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
count_file="${FAKE_AWS_COUNT:?}"
count=0
[ ! -f "$count_file" ] || count="$(<"$count_file")"
count=$((count+1))
printf '%s' "$count" > "$count_file"
case "${FAKE_AWS_MODE:?}" in
  restore-success)
    status=creating; [ "$count" -ge 3 ] && status=available
    jq -cn --arg status "$status" '{DBInstances:[{DBInstanceStatus:$status}]}'
    ;;
  restore-terminal)
    jq -cn '{DBInstances:[{DBInstanceStatus:"incompatible-restore"}]}'
    ;;
  restore-not-found)
    if [ "$count" -eq 1 ]; then
      echo 'DBInstanceNotFound: clone is not visible yet' >&2
      exit 254
    fi
    jq -cn '{DBInstances:[{DBInstanceStatus:"available"}]}'
    ;;
  secret-success)
    secret=creating; [ "$count" -ge 2 ] && secret=active
    jq -cn --arg secret "$secret" \
      '{DBInstances:[{DBInstanceStatus:"available",MasterUserSecret:{SecretStatus:$secret}}]}'
    ;;
  secret-impaired)
    jq -cn '{DBInstances:[{DBInstanceStatus:"available",MasterUserSecret:{SecretStatus:"impaired"}}]}'
    ;;
  logs)
    case "$count" in
      1) jq -cn '{events:[{message:"first"}],nextForwardToken:"token-1"}' ;;
      2) jq -cn '{events:[],nextForwardToken:"token-2"}' ;;
      3) jq -cn '{events:[{message:"second"}],nextForwardToken:"token-3"}' ;;
      *) jq -cn '{events:[],nextForwardToken:"token-3"}' ;;
    esac
    ;;
esac
SH
chmod +x "$fake_aws"
PATH="$fixture:$PATH"

export FAKE_AWS_COUNT="$fixture/count" FAKE_AWS_MODE=restore-success
rm -f "$FAKE_AWS_COUNT"
production_a5_wait_for_restored_instance "$fixture/restore.json" 3 0
test "$(jq -r '.DBInstances[0].DBInstanceStatus' "$fixture/restore.json")" = available

export FAKE_AWS_MODE=restore-not-found
rm -f "$FAKE_AWS_COUNT"
production_a5_wait_for_restored_instance "$fixture/restore-eventual.json" 2 0
test "$(jq -r '.DBInstances[0].DBInstanceStatus' "$fixture/restore-eventual.json")" = available

export FAKE_AWS_MODE=restore-terminal
rm -f "$FAKE_AWS_COUNT"
if production_a5_wait_for_restored_instance "$fixture/restore-failed.json" 3 0 \
    >/dev/null 2>&1; then
  echo 'ERROR: terminal RDS restore state was accepted' >&2
  exit 1
fi

export FAKE_AWS_MODE=secret-success
rm -f "$FAKE_AWS_COUNT"
production_a5_wait_for_managed_secret "$fixture/secret.json" 2 0
test "$(jq -r '.DBInstances[0].MasterUserSecret.SecretStatus' "$fixture/secret.json")" = active

export FAKE_AWS_MODE=secret-impaired
rm -f "$FAKE_AWS_COUNT"
if production_a5_wait_for_managed_secret "$fixture/secret-failed.json" 2 0 \
    >/dev/null 2>&1; then
  echo 'ERROR: impaired RDS managed secret was accepted' >&2
  exit 1
fi

export FAKE_AWS_MODE=logs
rm -f "$FAKE_AWS_COUNT"
production_a5_collect_log_events fixture-group fixture-stream "$fixture/log-pages.json"
test "$(jq -r '[.events[].message]|join(",")' "$fixture/log-pages.json")" = first,second

jq -cnS '{schemaVersion:1,sourceAppliedMigrations:[],sourceAppliedMigrationsHash:("a"*64),
  sourceDatabaseFingerprint:("b"*64),reviewedManifest:{},candidateMigrationSetHash:("c"*64),
  reviewedMigrationOperationsHash:("d"*64),expectedSchemaDeltaHash:("e"*64),
  expectedDataTransformHash:("f"*64),preflightCatalogHash:("0"*64),
  lockBudgetPolicyHash:("1"*64),expectedSeededRouteHash:("2"*64),
  expectedClosedWhtRouteHash:("3"*64),reimbursementCompatibility:{status:"PASSED"},
  cloneRehearsalWithoutCleanup:{result:"PASSED",engine:"PostgreSQL"}}' > "$fixture/result.json"
digest="$(sha256sum "$fixture/result.json" | awk '{print $1}')"
if base64 -w 0 "$fixture/result.json" > "$fixture/result.base64" 2>/dev/null; then :
else base64 < "$fixture/result.json" | tr -d '\n' > "$fixture/result.base64"; fi
jq -cnS --arg message "A5_CLONE_RESULT 1/1 $digest $(tr -d '\n' < "$fixture/result.base64")" \
  '{events:[{message:$message}]}' > "$fixture/logs.json"
bash "$reconstruct" "$fixture/logs.json" "$fixture/reconstructed.json"
cmp -s "$fixture/result.json" "$fixture/reconstructed.json"

jq '.events += [.events[0]]' "$fixture/logs.json" > "$fixture/duplicate.json"
if bash "$reconstruct" "$fixture/duplicate.json" "$fixture/should-not-exist.json" \
    >/dev/null 2>&1; then
  echo 'ERROR: duplicate clone result chunks were accepted' >&2
  exit 1
fi

jq -cnS '{
  schemaVersion:2,status:"PASSED",engine:"PostgreSQL",engineVersion:"18.3",
  sourceCommit:("a"*40),repositoryCatalogHash:("b"*64),
  sourceAppliedMigrationsHash:("c"*64),pendingCatalogHash:("d"*64),
  postAppliedMigrationsHash:("e"*64),preSchemaFingerprint:("f"*64),
  postSchemaFingerprint:("0"*64),
  pendingMigrations:[{name:"20260812000000_future_safe",sha256:("1"*64)}],
  executedMigrations:[{name:"20260812000000_future_safe",sha256:("1"*64)}],
  migrateDeploy:{durationMs:1250,maxDurationMs:1800000},
  schemaValidation:{status:"PASSED"},compatibility:{status:"PASSED"}
}' > "$fixture/result-v2.json"
digest_v2="$(sha256sum "$fixture/result-v2.json" | awk '{print $1}')"
if base64 -w 0 "$fixture/result-v2.json" > "$fixture/result-v2.base64" 2>/dev/null; then :
else base64 < "$fixture/result-v2.json" | tr -d '\n' > "$fixture/result-v2.base64"; fi
jq -cnS --arg message "A5_CLONE_RESULT 1/1 $digest_v2 $(tr -d '\n' < "$fixture/result-v2.base64")" \
  '{events:[{message:$message}]}' > "$fixture/logs-v2.json"
bash "$reconstruct" "$fixture/logs-v2.json" "$fixture/reconstructed-v2.json" readiness-v2
cmp -s "$fixture/result-v2.json" "$fixture/reconstructed-v2.json"
jq -cS '.executedMigrations=[]' "$fixture/result-v2.json" > "$fixture/result-v2-mismatch.json"
mismatch_digest="$(sha256sum "$fixture/result-v2-mismatch.json" | awk '{print $1}')"
if base64 -w 0 "$fixture/result-v2-mismatch.json" > "$fixture/result-v2-mismatch.base64" 2>/dev/null; then :
else base64 < "$fixture/result-v2-mismatch.json" | tr -d '\n' > "$fixture/result-v2-mismatch.base64"; fi
jq -cnS --arg message "A5_CLONE_RESULT 1/1 $mismatch_digest $(tr -d '\n' < "$fixture/result-v2-mismatch.base64")" \
  '{events:[{message:$message}]}' > "$fixture/logs-v2-mismatch.json"
if bash "$reconstruct" "$fixture/logs-v2-mismatch.json" \
    "$fixture/should-not-exist-v2.json" readiness-v2 >/dev/null 2>&1; then
  echo 'ERROR: V2 clone result accepted a migration execution mismatch' >&2
  exit 1
fi

echo 'production A5 clone runner spec: PASS'
