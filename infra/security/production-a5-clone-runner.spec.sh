#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
runner="$repo_root/infra/security/run-production-a5-clone.sh"
reconstruct="$repo_root/infra/security/reconstruct-production-a5-clone-result.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-clone-runner.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT

bash -n "$runner" "$reconstruct"
for required in \
  'snapshot-type automated' '86400' '--manage-master-user-password' \
  'watchdog-bms-production-a5-clone-execution' 'migrationTaskRoleArn:null' \
  'name:"PGDATABASE"' 'name:"PGHOST"' 'name:"PGPASSWORD"' 'name:"PGUSER"' \
  'temporaryDatabaseSecretVersionId' \
  'DBInstanceNotFound' 'ResourceNotFoundException' 'InvalidNetworkInterfaceID.NotFound' \
  'task_definition_status" = INACTIVE' 'residualResourceCount:0'; do
  grep -F -- "$required" "$runner" >/dev/null
done
for forbidden in \
  'get-secret-value' 'managed-secret.json' 'clone-url' '--secret-string' \
  'create-secret' 'PRODUCTION_A5_CLONE_DATABASE_URL'; do
  if grep -F -- "$forbidden" "$runner" >/dev/null; then
    echo "ERROR: clone runner exposes a database credential path: $forbidden" >&2
    exit 1
  fi
done
if grep -F 'watchdog-bms/production/database-url' "$runner" >/dev/null; then
  echo 'ERROR: clone runner references the production writer secret' >&2
  exit 1
fi
if grep -F 'LatestRestorableTime' "$runner" >/dev/null; then
  echo 'ERROR: clone runner treats PITR metadata as snapshot-restore proof' >&2
  exit 1
fi

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

echo 'production A5 clone runner spec: PASS'
