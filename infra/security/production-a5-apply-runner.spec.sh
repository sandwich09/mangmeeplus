#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
runner="$repo_root/infra/security/run-production-a5-reviewed-migration.sh"
reconstruct="$repo_root/infra/security/reconstruct-production-a5-apply-result.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-apply-runner.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT

bash -n "$runner" "$reconstruct"
for required in \
  'watchdog-bms-production-a5-apply-execution' 'taskRoleArn==null' \
  'assignPublicIp:"DISABLED"' 'validate-production-a5-private-endpoints.sh' \
  'watchdog-bms/production/database-url' ':::${writer_version}' \
  'run-production-apply.ts' 'reconstruct-production-a5-apply-result.sh'; do
  grep -F -- "$required" "$runner" >/dev/null
done
for forbidden in \
  'prisma migrate deploy' 'sync-permissions' 'sync-feature-launch-gates' \
  'attest-feature-launch-build' 'get-secret-value' 'taskRoleArn:$execution'; do
  if grep -F -- "$forbidden" "$runner" >/dev/null; then
    echo "ERROR: production apply runner contains forbidden authority: $forbidden" >&2
    exit 1
  fi
done

source_sha="$(printf 'a%.0s' {1..40})"
hash="$(printf 'b%.0s' {1..64})"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-migration-tool@sha256:$(printf 'c%.0s' {1..64})"
jq -cnS '{candidateMigrationSetHash:("1"*64),reviewedMigrationOperationsHash:("2"*64),
  expectedSchemaDeltaHash:("3"*64),expectedDataTransformHash:("4"*64),
  preflightCatalogHash:("5"*64),lockBudgetPolicyHash:("6"*64),
  expectedSeededRouteHash:("7"*64),expectedClosedWhtRouteHash:("8"*64)}' \
  > "$fixture/hashes.json"
jq -cnS '{ownerApprovalRef:{artifactKind:"OWNER_U5E_APPROVAL_V1",producerRunId:"10",
  producerRunAttempt:1,artifactName:"owner",contentSha256:("9"*64),artifactDigest:("sha256:"+("a"*64))},
  maintenanceWindow:{windowId:"u5e-1-a1-2-a1",startsAtEpochMs:1000,endsAtEpochMs:100000,
    failurePolicy:"LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL"}}' > "$fixture/authority.json"
jq -cnS --arg source "$source_sha" --arg image "$image" --arg ledger "$hash" \
  --slurpfile hashes "$fixture/hashes.json" --slurpfile authority "$fixture/authority.json" '
  {schemaVersion:1,status:"PASSED",sourceCommit:$source,migrationImage:$image,
   sourceAppliedMigrationsHash:$ledger,manifestHashes:$hashes[0],
   preconditionResults:{status:"VERIFIED"},postSchemaResults:{status:"VERIFIED"},
   postDataResults:{status:"VERIFIED"},
   executedMigrations:{status:"VERIFIED",migrations:[{migrationName:"m1"}],migrationsHash:("d"*64)},
   executionBudgetResults:[{migrationName:"m1",maintenanceWindowId:"u5e-1-a1-2-a1",
     effectiveLockTimeoutMs:2000,effectiveStatementTimeoutMs:300000,lockTimeoutEnforced:true,
     statementTimeoutEnforced:true,lockWaitBelowTimeout:true,observedStatementDurationMs:1000,
     maintenanceWindowStartedAtEpochMs:2000,maintenanceWindowFinishedAtEpochMs:3000}],
   executionBudgetResultsHash:("e"*64),reimbursementInvariantHash:("f"*64),
   productionApplyAuthority:$authority[0]}
' > "$fixture/result.json"
digest="$(sha256sum "$fixture/result.json" | awk '{print $1}')"
if base64 -w 0 "$fixture/result.json" > "$fixture/result.base64" 2>/dev/null; then :
else base64 < "$fixture/result.json" | tr -d '\n' > "$fixture/result.base64"; fi
jq -cnS --arg message "A5_PRODUCTION_APPLY_RESULT 1/1 $digest $(tr -d '\n' < "$fixture/result.base64")" \
  '{events:[{message:$message}]}' > "$fixture/logs.json"
bash "$reconstruct" "$fixture/logs.json" "$source_sha" "$image" "$hash" \
  "$fixture/hashes.json" "$fixture/authority.json" "$fixture/reconstructed.json"
cmp -s "$fixture/result.json" "$fixture/reconstructed.json"

jq '.events += [.events[0]]' "$fixture/logs.json" > "$fixture/duplicate.json"
if bash "$reconstruct" "$fixture/duplicate.json" "$source_sha" "$image" "$hash" \
    "$fixture/hashes.json" "$fixture/authority.json" "$fixture/should-not-exist.json" \
    >/dev/null 2>&1; then
  echo 'ERROR: duplicate production apply chunks were accepted' >&2
  exit 1
fi

echo 'production A5 apply runner spec: PASS'
