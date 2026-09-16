#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/validate-production-maintenance-release.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/maintenance-release-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
api_fixture="$fixture/api-web"
full_fixture="$fixture/full"

api_exact_files=(
  infra/api-web/web-api-proxy.mjs
  infra/api-web/Dockerfile.api-web
  infra/api-web/start-api-web-runtime.sh
  apps/api/prisma/migrations/20260810120000_platform_access_control/migration.sql
  apps/api/src/modules/auth/application/platform-access.service.ts
  apps/api/src/modules/auth/application/legal-acceptance.service.ts
  apps/api/src/modules/auth/application/use-cases/password-login.use-case.ts
  apps/api/src/modules/auth/application/use-cases/confirm-password-reset.use-case.ts
  apps/api/src/modules/auth/presentation/platform-access.controller.ts
  apps/api/src/modules/auth/presentation/auth.guard.ts
  apps/api/src/modules/auth/auth.module.ts
  apps/api/src/modules/auth/application/email-access.service.ts
  apps/api/src/modules/auth/application/use-cases/refresh-session.use-case.ts
  apps/web/app/api/auth/login/route.ts
  apps/web/src/features/auth/login-failure-response.server.ts
  apps/web/app/login/page.tsx
  apps/web/app/maintenance/page.tsx
  apps/web/src/common/auth/session-gate.logic.ts
  apps/web/src/common/auth/server-session.ts
  apps/web/app/\(workspace\)/companies/\[companyId\]/layout.tsx
  apps/web/app/system/layout.tsx
  apps/web/app/change-password/page.tsx
  apps/web/app/legal-acceptance/page.tsx
  apps/web/app/system/platform-access/page.tsx
)
api_semantic_files=(
  packages/config/src/index.ts
  apps/api/prisma/schema.prisma
  apps/api/src/common/config/app-config.service.ts
  apps/api/src/modules/audit/domain/models/audit-action.ts
)
presentation_files=(
  apps/web/src/features/auth/LoginPage.tsx
  apps/web/src/features/system-partners/PlatformAccessPage.tsx
  apps/web/src/features/system-partners/system-partners.api.ts
  apps/web/src/common/components/app-shell/SystemHeader.tsx
)
full_exact_files=(
  "${api_exact_files[@]}"
  infra/postmark/config.py
  infra/postmark/config.json
  infra/prod-ecs-express/deploy.sh
  infra/prod-ecs-express/list-service-deployments-all.sh
  infra/prod-ecs-express/verify-deployment.sh
  infra/prod-ecs-express/verify-production-maintenance.sh
  infra/prod-ecs-express/run-release-task.sh
  infra/prod-ecs-express/register-task-definition-with-retry.sh
  infra/prod-ecs-express/run-task-idempotently.sh
  infra/prod-ecs-express/cleanup-one-shot-task.sh
  infra/prod-ecs-express/active-release-tasks.sh
  infra/prod-ecs-express/active-launch-builds.sh
  infra/docker/resolve-production-fast-mode.sh
  apps/api/prisma/verify-applied-migration-catalog.ts
  infra/prod-ecs-express/release-task-network-failure.jq
  infra/prod-ecs-express/wait-production-maintenance-ingress-drain.sh
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

remove_invariant_and_reject() {
  local root="$1" scope="$2" relative="$3" literal="$4" filtered
  filtered="$root/$relative.filtered"
  grep -Fv -- "$literal" "$root/$relative" > "$filtered"
  mv "$filtered" "$root/$relative"
  if bash "$validator" "$root" "$scope" >/dev/null 2>&1; then
    echo "ERROR: maintenance release validator accepted a missing invariant in $relative" >&2
    exit 1
  fi
  cp "$repo_root/$relative" "$root/$relative"
}

bash -n "$validator"
bash "$validator" "$repo_root" full >/dev/null
bash "$validator" "$repo_root" api-web-image >/dev/null

copy_fixture "$api_fixture" "${api_exact_files[@]}" "${api_semantic_files[@]}" "${presentation_files[@]}"
bash "$validator" "$api_fixture" api-web-image >/dev/null
for relative in "${api_exact_files[@]}"; do
  tamper_and_reject "$api_fixture" api-web-image "$relative"
done
for relative in "${api_semantic_files[@]}"; do
  printf '\n// unrelated append-only change remains deployable\n' >> "$api_fixture/$relative"
done
for relative in "${presentation_files[@]}"; do
  printf '\n// presentation-only change remains deployable\n' >> "$api_fixture/$relative"
done
bash "$validator" "$api_fixture" api-web-image >/dev/null
copy_fixture "$api_fixture" "${api_semantic_files[@]}"
remove_invariant_and_reject "$api_fixture" api-web-image packages/config/src/index.ts \
  "SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(300),"
remove_invariant_and_reject "$api_fixture" api-web-image apps/api/prisma/schema.prisma \
  "model PlatformAccessControl {"
remove_invariant_and_reject "$api_fixture" api-web-image apps/api/src/common/config/app-config.service.ts \
  "get productionServingMode(): 'live' | 'maintenance_only' | undefined"
remove_invariant_and_reject "$api_fixture" api-web-image apps/api/src/modules/audit/domain/models/audit-action.ts \
  "PLATFORM_ACCESS_STATE_UPDATE: 'platform.access.state_update',"

copy_fixture "$full_fixture" "${full_exact_files[@]}" "${api_semantic_files[@]}"
bash "$validator" "$full_fixture" full >/dev/null
for relative in "${full_exact_files[@]}"; do
  tamper_and_reject "$full_fixture" full "$relative"
done

echo 'production maintenance release validator: PASS'
