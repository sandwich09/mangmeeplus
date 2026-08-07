#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "Usage: $0 <log-events.json> <source-sha> <migration-image> <source-ledger-hash> <expected-hashes.json> <authority.json> <result.json>" >&2
  exit 2
fi

input="$1"
source_sha="$2"
migration_image="$3"
source_ledger_hash="$4"
expected_hashes="$5"
authority="$6"
output="$7"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-apply-result.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$migration_image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
[[ "$source_ledger_hash" =~ ^[0-9a-f]{64}$ ]]
for file in "$input" "$expected_hashes" "$authority"; do
  [ -f "$file" ] && [ ! -L "$file" ]
done
[ ! -e "$output" ]
jq -e -s 'length==1 and (.[0].events|type)=="array"' "$input" >/dev/null
jq -cS . "$expected_hashes" > "$work/expected-hashes.json"
cmp -s "$expected_hashes" "$work/expected-hashes.json"
jq -cS . "$authority" > "$work/authority.json"
cmp -s "$authority" "$work/authority.json"

jq -er '.events[].message | select(startswith("A5_PRODUCTION_APPLY_RESULT "))' \
  "$input" > "$work/lines"
[ -s "$work/lines" ]
total=''
digest=''
while IFS= read -r line; do
  if [[ ! "$line" =~ ^A5_PRODUCTION_APPLY_RESULT\ ([1-9][0-9]*)/([1-9][0-9]*)\ ([0-9a-f]{64})\ ([A-Za-z0-9+/=]+)$ ]]; then
    echo 'ERROR: malformed production A5 apply result chunk' >&2
    exit 1
  fi
  index="${BASH_REMATCH[1]}"
  current_total="${BASH_REMATCH[2]}"
  current_digest="${BASH_REMATCH[3]}"
  chunk="${BASH_REMATCH[4]}"
  [ "$index" -le "$current_total" ]
  if [ -z "$total" ]; then total="$current_total"; digest="$current_digest"; fi
  [ "$current_total" = "$total" ] && [ "$current_digest" = "$digest" ]
  [ ! -e "$work/chunk-$index" ]
  printf '%s' "$chunk" > "$work/chunk-$index"
done < "$work/lines"

[ "$(wc -l < "$work/lines" | tr -d '[:space:]')" = "$total" ]
for ((index=1; index<=total; index++)); do
  [ -f "$work/chunk-$index" ]
  cat "$work/chunk-$index"
done > "$work/result.base64"
if base64 --decode "$work/result.base64" > "$work/result.json" 2>/dev/null; then :
else base64 -D < "$work/result.base64" > "$work/result.json"; fi
size="$(wc -c < "$work/result.json" | tr -d '[:space:]')"
[[ "$size" =~ ^[1-9][0-9]*$ ]] && [ "$size" -le 900000 ]
[ "$(sha256sum "$work/result.json" | awk '{print $1}')" = "$digest" ]
jq -cS . "$work/result.json" > "$work/canonical.json"
cmp -s "$work/result.json" "$work/canonical.json"

jq -e --arg source "$source_sha" --arg image "$migration_image" \
  --arg ledger "$source_ledger_hash" --slurpfile hashes "$expected_hashes" \
  --slurpfile authority "$authority" '
  def exact($keys): keys==($keys|sort);
  def hash: type=="string" and test("^[0-9a-f]{64}$");
  exact(["executedMigrations","executionBudgetResults","executionBudgetResultsHash",
    "manifestHashes","migrationImage","postDataResults","postSchemaResults",
    "preconditionResults","productionApplyAuthority","reimbursementInvariantHash",
    "schemaVersion","sourceAppliedMigrationsHash","sourceCommit","status"])
  and .schemaVersion==1 and .status=="PASSED" and .sourceCommit==$source
  and .migrationImage==$image and .sourceAppliedMigrationsHash==$ledger
  and .manifestHashes==$hashes[0] and .productionApplyAuthority==$authority[0]
  and (.executionBudgetResultsHash|hash) and (.reimbursementInvariantHash|hash)
  and (.preconditionResults.status=="VERIFIED")
  and (.postSchemaResults.status=="VERIFIED") and (.postDataResults.status=="VERIFIED")
  and (.executedMigrations
    | exact(["migrations","migrationsHash","status"])
    and .status=="VERIFIED" and (.migrations|type)=="array" and (.migrations|length)>0
    and (.migrationsHash|hash))
  and (.executionBudgetResults|type)=="array"
  and (.executionBudgetResults|length)==(.executedMigrations.migrations|length)
  and ([.executedMigrations.migrations[].migrationName]
    == [.executionBudgetResults[].migrationName])
  and all(.executionBudgetResults[];
    .effectiveLockTimeoutMs==2000 and .effectiveStatementTimeoutMs==300000
    and .lockTimeoutEnforced==true and .statementTimeoutEnforced==true
    and .lockWaitBelowTimeout==true
    and .maintenanceWindowId==$authority[0].maintenanceWindow.windowId
    and .maintenanceWindowStartedAtEpochMs >= $authority[0].maintenanceWindow.startsAtEpochMs
    and .maintenanceWindowFinishedAtEpochMs <= $authority[0].maintenanceWindow.endsAtEpochMs
    and .maintenanceWindowFinishedAtEpochMs > .maintenanceWindowStartedAtEpochMs
    and .observedStatementDurationMs
      == (.maintenanceWindowFinishedAtEpochMs-.maintenanceWindowStartedAtEpochMs)
    and .observedStatementDurationMs <= 300000)
  ' "$work/result.json" >/dev/null

install -m 600 "$work/result.json" "$output"
