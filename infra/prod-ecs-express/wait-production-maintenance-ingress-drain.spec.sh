#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
script="$repo_root/infra/prod-ecs-express/wait-production-maintenance-ingress-drain.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/maintenance-ingress-drain.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
source_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
manifest="$fixture/manifest.json"
jq -cnS --arg source "$source_sha" '
  {schemaVersion:1,sourceCommit:$source,images:[
    {service:"api-web",image:("repo/api@sha256:"+("1"*64)),sourceCommit:$source},
    {service:"ai-gateway",image:("repo/ai@sha256:"+("2"*64)),sourceCommit:$source},
    {service:"workers",image:("repo/workers@sha256:"+("3"*64)),sourceCommit:$source}]}
' > "$manifest"

bash -n "$script"
closed_at=$(($(date -u +%s) - 901))
PRODUCTION_SERVING_MODE=maintenance_only RELEASE_DEPLOY_TARGET=all \
  SOURCE_SHA="$source_sha" PRODUCTION_IMAGE_MANIFEST="$manifest" \
  MAINTENANCE_CLOSED_AT_EPOCH="$closed_at" \
  bash "$script" "$fixture/proof.json" >/dev/null
jq -e --arg source "$source_sha" --argjson closed "$closed_at" '
  .artifact=="production-maintenance-ingress-drain-proof"
  and .schemaVersion==1 and .mode=="maintenance_only" and .target=="all"
  and .sourceSha==$source and .closedAtEpoch==$closed
  and .maximumPreviouslyIssuedPresignedUrlTtlSeconds==900
  and .completeAfterEpoch==($closed+900) and .result=="EXPIRED"
  and (.manifestSha256|test("^[0-9a-f]{64}$"))
  and (.observedAtUtc|test("Z$"))
' "$fixture/proof.json" >/dev/null

for bad in \
  'PRODUCTION_SERVING_MODE=live RELEASE_DEPLOY_TARGET=all' \
  'PRODUCTION_SERVING_MODE=maintenance_only RELEASE_DEPLOY_TARGET=api-web'; do
  if env $bad SOURCE_SHA="$source_sha" PRODUCTION_IMAGE_MANIFEST="$manifest" \
    MAINTENANCE_CLOSED_AT_EPOCH="$closed_at" \
    bash "$script" "$fixture/rejected.json" >/dev/null 2>&1; then
    echo "ERROR: invalid drain authority was accepted: $bad" >&2
    exit 1
  fi
done

echo 'production maintenance ingress drain: PASS'
