#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 11 ]; then
  echo "Usage: $0 <authorization.json> <source-sha> <release-image> <marker> <manifest-hash> <workflow-sha> <run-id> <run-attempt> <actor> <triggering-actor> <now-epoch>" >&2
  exit 2
fi

authorization="$1"
source_sha="$2"
release_image="$3"
marker="$4"
manifest_hash="$5"
workflow_sha="$6"
run_id="$7"
run_attempt="$8"
actor="$9"
triggering_actor="${10}"
now_epoch="${11}"
repository='MangmeeDev/mangmeeplus'
workflow_ref="${repository}/.github/workflows/a5-capacity-uat.yml@refs/heads/main"

[[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$workflow_sha" =~ ^[0-9a-f]{40}$ \
  && "$manifest_hash" =~ ^[0-9a-f]{64}$ && "$run_id" =~ ^[1-9][0-9]*$ \
  && "$run_attempt" =~ ^[1-9][0-9]*$ && "$now_epoch" =~ ^[1-9][0-9]*$ ]] \
  || { echo 'ERROR: malformed U5-C authorization binding' >&2; exit 1; }
[[ "$release_image" =~ ^[0-9]{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$ ]] \
  || { echo 'ERROR: malformed U5-C release image' >&2; exit 1; }
[[ "$marker" =~ ^U5C-[0-9A-F]{12,32}$ ]] || { echo 'ERROR: malformed U5-C marker' >&2; exit 1; }
[ "$actor" = MangmeeDev ] && [ "$triggering_actor" = MangmeeDev ] \
  || { echo 'ERROR: only repository owner MangmeeDev may authorize U5-C' >&2; exit 1; }
[ -f "$authorization" ] && [ "$(wc -c < "$authorization")" -le 16384 ] \
  || { echo 'ERROR: U5-C authorization is absent or too large' >&2; exit 1; }

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

validator_tmp="$(mktemp -d "${TMPDIR:-/tmp}/u5-capacity-authorization.XXXXXX")"
canonical="$validator_tmp/canonical.json"
trap 'rm -rf "$validator_tmp"' EXIT
jq -cS . "$authorization" > "$canonical"
cmp -s "$authorization" "$canonical" \
  || { echo 'ERROR: U5-C authorization bytes are not canonical jq -cS JSON' >&2; exit 1; }

embedded_manifest_hash="$(jq -r '.workloadBlobs[] | [.path,.blob] | @tsv' "$authorization" | sha256_stream)"
[ "$embedded_manifest_hash" = "$manifest_hash" ] \
  || { echo 'ERROR: U5-C authorization workload blobs do not match the manifest hash' >&2; exit 1; }

marker_hash="$(printf '%s' "$marker" | shasum -a 256 | awk '{print $1}')"
jq -e \
  --arg repository "$repository" --arg workflowRef "$workflow_ref" --arg workflowSha "$workflow_sha" \
  --arg sourceSha "$source_sha" --arg releaseImage "$release_image" --arg marker "$marker" \
  --arg markerHash "$marker_hash" \
  --arg manifestHash "$manifest_hash" --arg runId "$run_id" --arg runAttempt "$run_attempt" \
  --arg actor "$actor" --arg triggeringActor "$triggering_actor" --argjson now "$now_epoch" '
    (keys|sort)==(["actor","approvalRef","artifact","expiresAtEpoch","issuedAtEpoch",
      "marker","markerHash","releaseImage","repository","runAttempt","runId","schemaVersion",
      "sourceSha","triggeringActor","workflowRef","workflowSha","workloadBlobs",
      "workloadManifestHash"]|sort)
    and .artifact=="u5-capacity-authorization-v2" and .schemaVersion==2
    and .repository==$repository and .workflowRef==$workflowRef and .workflowSha==$workflowSha
    and .sourceSha==$sourceSha and .releaseImage==$releaseImage
    and .marker==$marker and .markerHash==$markerHash
    and .workloadManifestHash==$manifestHash and .approvalRef=="owner-approved:2026-08-03:u5-c-v2"
    and .runId==$runId and .runAttempt==$runAttempt and .actor==$actor
    and .triggeringActor==$triggeringActor
    and (.workloadBlobs|type)=="array" and (.workloadBlobs|length)>=6 and (.workloadBlobs|length)<=32
    and all(.workloadBlobs[];
      (keys|sort)==["blob","path"]
      and (.path|type)=="string" and (.path|test("^[A-Za-z0-9._/-]+$"))
      and (.blob|test("^[0-9a-f]{40}$")))
    and ([.workloadBlobs[].path]|length)==([.workloadBlobs[].path]|unique|length)
    and (.issuedAtEpoch|type)=="number" and .issuedAtEpoch==(.issuedAtEpoch|floor)
    and (.expiresAtEpoch|type)=="number" and .expiresAtEpoch==(.expiresAtEpoch|floor)
    and .issuedAtEpoch <= $now and $now < .expiresAtEpoch
    and .expiresAtEpoch-.issuedAtEpoch == 3600
  ' "$authorization" >/dev/null

printf '%s\n' "$(sha256_file "$authorization")"
