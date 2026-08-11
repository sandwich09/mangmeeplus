#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
validator="$root/infra/security/validate-production-release-result-v2.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-result-v2-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source_sha="$(printf 'a%.0s' {1..40})"; controller="$(printf 'b%.0s' {1..40})"; now=2000000000
sha_file() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"|awk '{print $1}'; else shasum -a 256 "$1"|awk '{print $1}'; fi; }
sha_stream() { if command -v sha256sum >/dev/null 2>&1; then sha256sum|awk '{print $1}'; else shasum -a 256|awk '{print $1}'; fi; }
jq -cnS --arg source "$source_sha" '{schemaVersion:1,sourceCommit:$source,images:
 ["ai-gateway","api-web","workers"]|map({service:.,repository:(if .=="api-web" then "watchdog-bms-api" else "watchdog-bms-"+. end),
  image:("repo/"+.+"@sha256:"+("1"*64)),digest:("sha256:"+("1"*64)),sourceCommit:$source,sbom:("sbom-"+.+".json")})}' \
  > "$work/manifest.json"
jq -cnS --arg source "$source_sha" '{sourceCommit:$source,serving:{requestedMode:"maintenance_closed",effectiveTarget:"all"}}' \
  > "$work/ready.json"
printf '%s\n' '{"deploymentState":"DEPLOYED_NOT_LAUNCHED","target":"all"}' > "$work/maintenance-proof.json"
jq -cnS --arg source "$source_sha" --arg controller "$controller" \
  --arg ready "$(sha_file "$work/ready.json")" --arg manifest "$(sha_file "$work/manifest.json")" \
  --argjson now "$now" --slurpfile images "$work/manifest.json" '
  {schemaVersion:2,artifactKind:"PRODUCTION_RELEASE_RESULT_V2",environment:"production",
   repository:"example/watchdog",sourceCommit:$source,state:"PROMOTED_CLOSED",
   requestedServingMode:"maintenance_closed",effectiveTarget:"all",uatRunId:"8001",
   readinessRunId:"9001",readySha256:$ready,controllerCommit:$controller,
   productionRunId:"10001",productionRunAttempt:1,completedAtEpoch:$now,
   manifestSha256:$manifest,images:$images[0].images,maintenanceProofSha256:$maintenance}
  ' --arg maintenance "$(sha_file "$work/maintenance-proof.json")" > "$work/body.json"
hash="$(jq -cjS . "$work/body.json"|sha_stream)"
jq -cS --arg hash "$hash" '.+{contentSha256:$hash}' "$work/body.json" > "$work/result.json"
bash "$validator" "$work/result.json" "$work/manifest.json" "$work/ready.json" "$source_sha" \
  8001 9001 10001 1 "$controller" example/watchdog "$now" "$work/maintenance-proof.json" >/dev/null
reject() {
  jq -cS "$2" "$work/result.json" > "$work/$1.json"
  if bash "$validator" "$work/$1.json" "$work/manifest.json" "$work/ready.json" "$source_sha" \
      8001 9001 10001 1 "$controller" example/watchdog "$now" "$work/maintenance-proof.json" >/dev/null 2>&1; then
    echo "ERROR: result validator accepted $1" >&2; exit 1
  fi
}
reject wrong-ready '.readySha256=("f"*64)'
reject live-with-closed-proof '.requestedServingMode="live"|.state="PROMOTED_LIVE"'
reject changed-image '.images[0].digest=("sha256:"+("f"*64))'
printf '%s\n' '{"deploymentState":"DEPLOYED_NOT_LAUNCHED","target":"all","drift":true}' \
  > "$work/wrong-maintenance-proof.json"
if bash "$validator" "$work/result.json" "$work/manifest.json" "$work/ready.json" "$source_sha" \
    8001 9001 10001 1 "$controller" example/watchdog "$now" \
    "$work/wrong-maintenance-proof.json" >/dev/null 2>&1; then
  echo 'ERROR: result validator accepted the wrong maintenance proof bytes' >&2
  exit 1
fi
bash -n "$validator"
echo 'production release result V2: PASS'
