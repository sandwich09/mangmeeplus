#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <evidence-file>" >&2
  exit 2
fi

evidence_file="$1"
[ "${PRODUCTION_SERVING_MODE:-}" = maintenance_only ] || {
  echo "ERROR: maintenance ingress drain requires PRODUCTION_SERVING_MODE=maintenance_only" >&2
  exit 2
}
[ "${RELEASE_DEPLOY_TARGET:-}" = all ] || {
  echo "ERROR: maintenance ingress drain is valid only for an all-target release" >&2
  exit 2
}

source_sha="${SOURCE_SHA:-}"
manifest="${PRODUCTION_IMAGE_MANIFEST:-}"
closed_at="${MAINTENANCE_CLOSED_AT_EPOCH:-}"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ERROR: SOURCE_SHA must be a full lowercase commit SHA" >&2
  exit 2
}
[[ "$closed_at" =~ ^[1-9][0-9]*$ ]] || {
  echo "ERROR: MAINTENANCE_CLOSED_AT_EPOCH must be a positive epoch" >&2
  exit 2
}
[ -f "$manifest" ] || {
  echo "ERROR: PRODUCTION_IMAGE_MANIFEST is required" >&2
  exit 2
}
jq -e --arg source "$source_sha" '
  .sourceCommit==$source
  and ([.images[].service]|sort)==["ai-gateway","api-web","workers"]
  and all(.images[];.sourceCommit==$source and (.image|type)=="string")
' "$manifest" >/dev/null || {
  echo "ERROR: production manifest does not match SOURCE_SHA" >&2
  exit 1
}

# The reviewed source contract caps issued upload URLs at 300 seconds and uses a
# fixed 900-second download URL. Once api-web is a singleton maintenance revision,
# it cannot mint another URL. Wait out the larger lifetime before claiming closure.
maximum_url_ttl_seconds=900
complete_after=$((closed_at + maximum_url_ttl_seconds))
now="$(date -u +%s)"
[ "$now" -ge "$closed_at" ] || {
  echo "ERROR: maintenance closure epoch is in the future" >&2
  exit 1
}
while [ "$now" -lt "$complete_after" ]; do
  remaining=$((complete_after - now))
  interval=60
  [ "$remaining" -lt "$interval" ] && interval="$remaining"
  echo "[maintenance-drain] waiting ${remaining}s for previously issued direct-storage URLs"
  sleep "$interval"
  now="$(date -u +%s)"
done

mkdir -p "$(dirname "$evidence_file")"
manifest_sha="$(sha256sum "$manifest" | awk '{print $1}')"
observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -cnS --arg sourceSha "$source_sha" --arg manifestSha256 "$manifest_sha" \
  --arg observedAtUtc "$observed_at" --argjson closedAtEpoch "$closed_at" \
  --argjson completeAfterEpoch "$complete_after" \
  --argjson maximumUrlTtlSeconds "$maximum_url_ttl_seconds" '
  {artifact:"production-maintenance-ingress-drain-proof",schemaVersion:1,
    mode:"maintenance_only",target:"all",sourceSha:$sourceSha,
    manifestSha256:$manifestSha256,closedAtEpoch:$closedAtEpoch,
    maximumPreviouslyIssuedPresignedUrlTtlSeconds:$maximumUrlTtlSeconds,
    completeAfterEpoch:$completeAfterEpoch,observedAtUtc:$observedAtUtc,
    result:"EXPIRED"}
' > "$evidence_file"

echo "[maintenance-drain] previously issued direct-storage URLs expired"
