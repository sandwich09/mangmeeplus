#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/validate-production-maintenance-release.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/maintenance-release-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
api_fixture="$fixture/api-web"
full_fixture="$fixture/full"

api_files=(
  infra/api-web/web-api-proxy.mjs
  infra/api-web/Dockerfile.api-web
  infra/api-web/start-api-web-runtime.sh
)
full_files=(
  "${api_files[@]}"
  infra/prod-ecs-express/deploy.sh
  infra/prod-ecs-express/verify-deployment.sh
  infra/prod-ecs-express/verify-production-maintenance.sh
  infra/prod-ecs-express/run-release-task.sh
  infra/prod-ecs-express/wait-production-maintenance-ingress-drain.sh
  packages/config/src/index.ts
  apps/api/src/modules/data-model-core/infrastructure/storage/s3-storage.adapter.ts
  apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts
  apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts
  apps/ai-gateway/src/common/http/production-maintenance.middleware.ts
  apps/ai-gateway/src/main.ts
  apps/ai-gateway/Dockerfile
  apps/workers/Dockerfile
  apps/workers/src/main.ts
)

copy_fixture() {
  local root="$1"
  shift
  local relative
  for relative in "$@"; do
    mkdir -p "$root/$(dirname "$relative")"
    cp "$repo_root/$relative" "$root/$relative"
  done
}

tamper_and_reject() {
  local root="$1" scope="$2" relative="$3"
  printf '\n# maintenance release spec drift\n' >> "$root/$relative"
  if bash "$validator" "$root" "$scope" >/dev/null 2>&1; then
    echo "ERROR: maintenance release validator accepted changed bytes for $relative" >&2
    exit 1
  fi
  cp "$repo_root/$relative" "$root/$relative"
}

bash -n "$validator"
bash "$validator" "$repo_root" full >/dev/null
bash "$validator" "$repo_root" api-web-image >/dev/null

copy_fixture "$api_fixture" "${api_files[@]}"
bash "$validator" "$api_fixture" api-web-image >/dev/null
for relative in "${api_files[@]}"; do
  tamper_and_reject "$api_fixture" api-web-image "$relative"
done

copy_fixture "$full_fixture" "${full_files[@]}"
bash "$validator" "$full_fixture" full >/dev/null
for relative in "${full_files[@]}"; do
  tamper_and_reject "$full_fixture" full "$relative"
done

echo 'production maintenance release validator: PASS'
