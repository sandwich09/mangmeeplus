#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <cloudwatch-get-log-events.json> <result.json> [reviewed-v1|readiness-v2]" >&2
  exit 2
fi

input="$1"
output="$2"
profile="${3:-reviewed-v1}"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-clone-result.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

[ -f "$input" ] && [ ! -L "$input" ] && [ ! -e "$output" ]
jq -e -s 'length == 1 and (.[0].events|type) == "array"' "$input" >/dev/null
jq -er '.events[].message | select(startswith("A5_CLONE_RESULT "))' "$input" > "$work/lines"
[ -s "$work/lines" ]

total=''
digest=''
while IFS= read -r line; do
  if [[ ! "$line" =~ ^A5_CLONE_RESULT\ ([1-9][0-9]*)/([1-9][0-9]*)\ ([0-9a-f]{64})\ ([A-Za-z0-9+/=]+)$ ]]; then
    echo 'ERROR: malformed production A5 clone result chunk' >&2
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
actual="$(sha256sum "$work/result.json" | awk '{print $1}')"
[ "$actual" = "$digest" ]
jq -cS . "$work/result.json" > "$work/canonical.json"
cmp -s "$work/result.json" "$work/canonical.json"
if [ "$profile" = reviewed-v1 ]; then
jq -e '
  (keys|sort) == ([
    "candidateMigrationSetHash","cloneRehearsalWithoutCleanup","expectedClosedWhtRouteHash",
    "expectedDataTransformHash","expectedSchemaDeltaHash","expectedSeededRouteHash",
    "lockBudgetPolicyHash","preflightCatalogHash","reimbursementCompatibility",
    "reviewedManifest","reviewedMigrationOperationsHash","schemaVersion",
    "sourceAppliedMigrations","sourceAppliedMigrationsHash","sourceDatabaseFingerprint"
  ]|sort)
  and .schemaVersion == 1
  and (.sourceDatabaseFingerprint|test("^[0-9a-f]{64}$"))
  and (.sourceAppliedMigrationsHash|test("^[0-9a-f]{64}$"))
  and (.sourceAppliedMigrations|type)=="array"
  and (.reviewedManifest|type)=="object"
  and .cloneRehearsalWithoutCleanup.result == "PASSED"
  and .cloneRehearsalWithoutCleanup.engine == "PostgreSQL"
  and .reimbursementCompatibility.status == "PASSED"
' "$work/result.json" >/dev/null
elif [ "$profile" = readiness-v2 ]; then
jq -e '
  (keys|sort)==(["compatibility","engine","engineVersion","executedMigrations","migrateDeploy",
    "pendingCatalogHash","pendingMigrations","postAppliedMigrationsHash","postSchemaFingerprint",
    "preSchemaFingerprint","repositoryCatalogHash","schemaValidation","schemaVersion",
    "sourceAppliedMigrationsHash","sourceCommit","status"]|sort)
  and .schemaVersion==2 and .status=="PASSED" and .engine=="PostgreSQL"
  and (.engineVersion|test("^18(\\.[0-9]+){1,2}$"))
  and (.sourceCommit|test("^[0-9a-f]{40}$"))
  and all(.repositoryCatalogHash,.sourceAppliedMigrationsHash,.pendingCatalogHash,
    .postAppliedMigrationsHash,.preSchemaFingerprint,.postSchemaFingerprint;
      type=="string" and test("^[0-9a-f]{64}$"))
  and (.pendingMigrations|type)=="array" and (.pendingMigrations|length)>=1
  and (.executedMigrations|type)=="array"
  and ([.pendingMigrations[].name])==([.executedMigrations[].name])
  and .schemaValidation.status=="PASSED" and .compatibility.status=="PASSED"
  and .migrateDeploy.durationMs>0 and .migrateDeploy.durationMs<=.migrateDeploy.maxDurationMs
' "$work/result.json" >/dev/null
else
  echo 'ERROR: unknown A5 clone result profile' >&2
  exit 2
fi
install -m 600 "$work/result.json" "$output"
