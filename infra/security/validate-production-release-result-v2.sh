#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 12 ]; then
  echo "Usage: $0 <result.json> <manifest.json> <ready.json> <source> <uat-run> <ready-run> <promotion-run> <attempt> <controller> <repository> <now> <maintenance-proof.json|->" >&2
  exit 2
fi
result="$1" manifest="$2" ready="$3" source="$4" uat_run="$5" ready_run="$6"
promotion_run="$7" attempt="$8" controller="$9" repository="${10}" now="${11}"
maintenance_proof="${12}"
for file in "$result" "$manifest" "$ready"; do
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(wc -c < "$file")" -le 2097152 ]
done
[[ "$source" =~ ^[0-9a-f]{40}$ && "$controller" =~ ^[0-9a-f]{40}$ ]]
[[ "$uat_run" =~ ^[1-9][0-9]*$ && "$ready_run" =~ ^[1-9][0-9]*$ ]]
[[ "$promotion_run" =~ ^[1-9][0-9]*$ && "$attempt" =~ ^[1-9][0-9]*$ && "$now" =~ ^[1-9][0-9]*$ ]]
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]

sha_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"|awk '{print $1}'
  else shasum -a 256 "$1"|awk '{print $1}'; fi
}
sha_stream() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum|awk '{print $1}'
  else shasum -a 256|awk '{print $1}'; fi
}
work="$(mktemp -d "${TMPDIR:-/tmp}/production-result-v2.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
jq -cS . "$result" > "$work/canonical.json"
cmp -s "$result" "$work/canonical.json"
content="$(jq -cjS 'del(.contentSha256)' "$result"|sha_stream)"
manifest_hash="$(sha_file "$manifest")"
ready_hash="$(sha_file "$ready")"
if [ "$maintenance_proof" != - ]; then
  [ -f "$maintenance_proof" ] && [ ! -L "$maintenance_proof" ] \
    && [ "$(wc -c < "$maintenance_proof")" -le 4194304 ]
  jq -e '.deploymentState=="DEPLOYED_NOT_LAUNCHED" and .target=="all"' \
    "$maintenance_proof" >/dev/null
fi

jq -e --arg source "$source" --arg uat "$uat_run" --arg readyRun "$ready_run" \
  --arg promotion "$promotion_run" --argjson attempt "$attempt" --arg controller "$controller" \
  --arg repository "$repository" --arg readyHash "$ready_hash" --arg manifestHash "$manifest_hash" \
  --arg content "$content" --argjson now "$now" --slurpfile ready "$ready" \
  --slurpfile manifest "$manifest" '
  def exact($keys):(keys|sort)==($keys|sort);
  def hash:type=="string" and test("^[0-9a-f]{64}$");
  exact(["artifactKind","completedAtEpoch","contentSha256","controllerCommit","effectiveTarget",
    "environment","images","maintenanceProofSha256","manifestSha256","productionRunAttempt",
    "productionRunId","readinessRunId","readySha256","repository","requestedServingMode",
    "schemaVersion","sourceCommit","state","uatRunId"])
  and .schemaVersion==2 and .artifactKind=="PRODUCTION_RELEASE_RESULT_V2"
  and .environment=="production" and .repository==$repository and .sourceCommit==$source
  and .uatRunId==$uat and .readinessRunId==$readyRun and .readySha256==$readyHash
  and .controllerCommit==$controller and .productionRunId==$promotion
  and .productionRunAttempt==$attempt and .manifestSha256==$manifestHash
  and .requestedServingMode==$ready[0].serving.requestedMode
  and .effectiveTarget==$ready[0].serving.effectiveTarget
  and ((.requestedServingMode=="maintenance_closed" and .state=="PROMOTED_CLOSED"
      and (.maintenanceProofSha256|hash))
    or (.requestedServingMode=="live" and .state=="PROMOTED_LIVE"
      and .maintenanceProofSha256==null))
  and .images==$manifest[0].images and $manifest[0].sourceCommit==$source
  and (.completedAtEpoch|type)=="number" and .completedAtEpoch<= $now
  and .completedAtEpoch>=($now-3600)
  and .contentSha256==$content and (.contentSha256|hash)
  ' "$result" >/dev/null
if [ "$(jq -er '.state' "$result")" = PROMOTED_CLOSED ]; then
  test "$maintenance_proof" != -
  test "$(sha_file "$maintenance_proof")" = "$(jq -er '.maintenanceProofSha256' "$result")"
else
  test "$maintenance_proof" = -
fi
printf '%s\n' "$source"
