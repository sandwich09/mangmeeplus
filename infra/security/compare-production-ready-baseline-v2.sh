#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "Usage: $0 <ready.json> <ready-runtime.json> <ready-catalog.json> <current-health.json> <current-runtime.json> <current-catalog.json>" >&2
  exit 2
fi
ready="$1" ready_runtime="$2" ready_catalog="$3"
current_health="$4" current_runtime="$5" current_catalog="$6"
for file in "$ready" "$ready_runtime" "$ready_catalog" "$current_health" "$current_runtime" "$current_catalog"; do
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(wc -c < "$file")" -le 16777216 ]
done

jq -e --slurpfile ready "$ready" '
  def services:
    [.services[] | . as $s
      | .rawEvidence.describeExpressGatewayService.raw.second.service.activeConfigurations[0] as $a
      | ([$a.primaryContainer.environment[]?|select(.name=="GIT_SHA")|.value]) as $source
      | select(($source|length)==1 and ($s.servingMode=="live" or $s.servingMode=="maintenance_only"))
      | {service:$s.service,image:$a.primaryContainer.image,sourceCommit:$source[0],
         servingMode:$s.servingMode,serviceRevisionArn:$s.serviceRevisionArn,
         taskDefinitionArn:$s.taskDefinition.arn}] | sort_by(.service);
  .status=="PASS" and (services == ($ready[0].productionBaseline.services|sort_by(.service)))
' "$current_health" >/dev/null || {
  echo "ERROR: Production service baseline drifted after READY" >&2
  exit 1
}

jq -e --slurpfile expected "$ready_runtime" '
  def stable:
    {schemaVersion,securityPolicySha256,a5PolicySha256,clonePolicySha256,
     rds:(.rds|del(.rawSha256)),
     redis:(.redis|del(.rawReplicationGroupSha256,.rawPrimarySha256))};
  stable == ($expected[0]|stable)
' "$current_runtime" >/dev/null || {
  echo "ERROR: Production runtime/IAM baseline drifted after READY" >&2
  exit 1
}

cmp_catalog="$(jq -cS '{schemaVersion,sourceCommit,status,migrationCount,appliedMigrationCount,
  pendingMigrationCount,repositoryCatalogHash,appliedCatalogHash,pendingCatalogHash}' "$ready_catalog")"
test "$(jq -cS '{schemaVersion,sourceCommit,status,migrationCount,appliedMigrationCount,
  pendingMigrationCount,repositoryCatalogHash,appliedCatalogHash,pendingCatalogHash}' "$current_catalog")" = "$cmp_catalog" || {
  echo "ERROR: Production migration ledger drifted after READY" >&2
  exit 1
}

source_sha="$(jq -er '.sourceCommit|select(test("^[0-9a-f]{40}$"))' "$ready")"
test "$(jq -er '.sourceCommit' "$current_catalog")" = "$source_sha"
printf '%s\n' "$source_sha"
