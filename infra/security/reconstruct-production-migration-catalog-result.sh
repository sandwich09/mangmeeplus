#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <cloudwatch-log-events.json> <output.json>" >&2
  exit 2
fi

input="$1"
output="$2"
[ -f "$input" ] && [ ! -L "$input" ] && [ ! -e "$output" ]
jq -e 'type=="object" and (.events|type)=="array" and (.events|length)<=10000' "$input" >/dev/null

frame="$(jq -er '[.events[]?.message
  | capture("^INCIDENT_CATALOG_RESULT 1/1 (?<hash>[0-9a-f]{64}) (?<body>[A-Za-z0-9+/]+={0,2})$")]
  | select(length==1) | .[0] | [.hash,.body] | @tsv' "$input")"
IFS=$'\t' read -r expected encoded <<< "$frame"
work="$(mktemp "${TMPDIR:-/tmp}/production-catalog-result.XXXXXX")"
trap 'rm -f -- "$work"' EXIT
if printf '%s' "$encoded" | base64 -d > "$work" 2>/dev/null; then :
else printf '%s' "$encoded" | base64 -D > "$work"; fi
[ "$(wc -c < "$work" | tr -d '[:space:]')" -le 1048576 ]
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$work" | awk '{print $1}')"
else actual="$(shasum -a 256 "$work" | awk '{print $1}')"; fi
test "$actual" = "$expected"
jq -cS . "$work" > "$output"
cmp -s "$work" "$output"
jq -e '
  (keys|sort)==(["appliedCatalogHash","appliedMigrationCount","migrationCount",
    "pendingCatalogHash","pendingMigrationCount","repositoryCatalogHash","schemaVersion",
    "sourceCommit","status"]|sort)
  and .schemaVersion==1 and (.sourceCommit|test("^[0-9a-f]{40}$"))
  and (.status=="EXACT_MATCH" or .status=="APPEND_ONLY_PENDING")
  and (.migrationCount|type)=="number" and .migrationCount>=1
  and .migrationCount==(.migrationCount|floor)
  and (.appliedMigrationCount|type)=="number" and .appliedMigrationCount>=0
  and .appliedMigrationCount==(.appliedMigrationCount|floor)
  and .appliedMigrationCount<=.migrationCount
  and .pendingMigrationCount==(.migrationCount-.appliedMigrationCount)
  and ((.status=="EXACT_MATCH" and .pendingMigrationCount==0)
    or (.status=="APPEND_ONLY_PENDING" and .pendingMigrationCount>=1))
  and all(.repositoryCatalogHash,.appliedCatalogHash,.pendingCatalogHash;
    type=="string" and test("^[0-9a-f]{64}$"))
' "$output" >/dev/null
