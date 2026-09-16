#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <release-root> <full|api-web-image>" >&2
  exit 2
fi

root="$1"
scope="$2"
case "$scope" in full|api-web-image) ;; *) echo "ERROR: invalid maintenance release scope" >&2; exit 2 ;; esac
[ -d "$root" ] || { echo "ERROR: maintenance release root is not a directory" >&2; exit 2; }
root="$(cd "$root" && pwd -P)"

# Controller-reviewed bytes. The production workflow pins this validator before executing it.
expected_proxy=ecc7ef18cef71f16e16e8f29b8804d089ba1fe15ee4835d2f2e541b069deca63
expected_api_dockerfile=aa8363e228f7f3efa26a25c5ae3df24d8c3aaeb789d9de239c706dc14d5cf9b9
expected_api_start=4410bd7a8956256b78c8f30cbbc79971837a00012cd61a1577052d0b8c86e82f
expected_platform_migration=3ac9ea81f12d76be503b383aeab6580c91f63a4b000aa58b47e549c2a8fa218a
expected_platform_service=c9aa205b6a8935f3ef52747b56e7357eba0060545dd9045f98be2a6f8d198cb6
expected_legal_acceptance=f05fcdba0c4e4204915642aa23eeb069f17c3e1e6b32cfe6cb86ae5227961189
expected_password_login=0deb1baa2149e6711bac3e02a1524fc5627cf73e811f559305e3004f2c9d5182
expected_password_reset=9f900e6d57fbc39b7e9340e5eb037230fa3351923dbb5b1153a16beff2499755
expected_platform_controller=55fd64ba00ee930f30fec57a956af6dc6b8a49669c705add2d310e3b60273ca5
expected_auth_guard=a8e2b9d9eab3f9ab5f860d38573f3905f87cfe8d84c87e710409528b618b5712
expected_auth_module=61941f9a3643a381aeab4233d12d1a7855de2d3b293db5354e1f8179efd10794
expected_session_refresh=40565d6e1252c3479f9a7fa2496c67afd8eab28d681f39128f78e031bf0e35e6
expected_login_bff=af26e54f6490e856a0b9931dbfd3292a92b55d82da1884f41d22b7760f55e6e9
expected_login_failure=f32db402e2af86707ba1d9b9fd5b4b5aa06f8b522b95b170d7a9c5848f687459
expected_login_route=df86674a0f29bb5560279364e19ed579011cc59f06a23823b3c9c91834835c3c
expected_maintenance_page=96a49e3560a63752c157c3bcbec6d1cfffde5937759c3825e59a21246f096e91
expected_session_gate=6817215d8e1de878c011995a07b22a9e05a4170b0420e6586eccbc7ede80c85f
expected_server_session=3cdec0728244d6087381b1761a76c1cf92f267278fb946e03fbbf608623d6fdf
expected_company_layout=d525a37e57a3a04f727e0af16cf07d47f0d55b2e6d0d82748d0a6886f46f4302
expected_system_layout=35040165540d34a7e70384a483f7696802f491d76b55f5f9dee8072f9b2f2ecb
expected_change_password_route=2e256a37b0a775e7778839bef15c9516d82dc23503f46660a543213713f3e7f7
expected_legal_acceptance_route=f0076607745d2b17e6b34281c71b391ef8eeb8f67089de2c347d12801e0b3007
expected_platform_route=1c72dbc0de94bbb74a4734056b2c67fd8931aeed3f523fbfd48792fc6336e32e
expected_deploy=b103e5f92b1781c96e32c154a32fe13f4a8ff928d40124db9607dc6ffcb4c787
expected_list_service_deployments=fb189137c58cf208191ad24ea2007a9758086bef4dfece967be94f6f7a800620
expected_verify=ac8d718be2f997948b29c1921d593c9359c46f7fc9fa9f3aaf0f5021753d061a
expected_maintenance_verify=291c6742b94a559d06315eeef683d9ca52695820fe3f85b4e18ab6dbb582f9ad
expected_release_task=102e7f651adf8451522281f7d89eb8efd2a0a2f8e4624079b839d5073ab0e353
expected_register_task=c3147096188d1afbc395db8bd4bed2e79ac534bac87cf2b76aac502764f54b77
expected_run_task=4cce82a00a3200f19503b26bb0689dfe8cbb927bbca408f6f33909c0d69e3cb5
expected_cleanup_one_shot_task=78da71bf5e19865352bc234d96712f7dfc5e43a6fee98af27138f935199cca70
expected_active_release_tasks=bf86c88aeb1dbcf115f355ee96ae37d766ef17780dafb2e470b494f54e02780c
expected_active_launch_builds=8f4d3e1191f051b85106fcc7250a9887469a53d31762cffe14607e4252356f05
expected_fast_mode=606d424a84a400ea8f9640d74807670387616b3d4a045f9ff2c619535dfb33d2
expected_migration_catalog=176ef46d013cc2695083e6496c9c4345d3d3c8abf3de472b2ba00ac40c5c184e
expected_release_task_network_failure=82f37664dc2b0a19d1a5951247622004cb6fe6a6d2f951c3154942fa4c87d918
expected_ingress_drain=c1b81490a74f53d483ef0da7d6852517d8e76b8ce7f3f48da6cc95b0fbd53773
expected_s3_storage=f7bfea9d229db933a606e2e65b22eb6444211b061c3bdeecc8b0ca70a23066ab
expected_upload_intent=8e1a8157e7f87f68a7f17c8cfc6d91350daa079879dc5653c79592a420c0642a
expected_download_url=edae1cbed94e06e6e68142dd817e24aef4fa572addb2fe0d0111828117c6192d
expected_ai_middleware=d9dfbf6ca245db162a5de8801d557f41af6144193d43fb88e2129f1442b9b8d5
expected_ai_main=8083baee29b0337f08beb323c18a37e63b6a4c2100582215ff72849536a67e8d
expected_ai_dockerfile=c8a67f95f27d39af9a4ad121b7c60a9672c8ab9c20add234e6a11748957010f9
expected_workers_dockerfile=12916efbc82ac916f876f19f9c451bb254f13700981b45ae4bc9ef8ac471448a
expected_postmark_config=fc146a4620df8ac1e2182c23d236e7320620eb8dde82e83eab0620e79cd6b897
expected_postmark_configuration=0753b73bbfb31954e607bf076e327b20e04e647c48de017406b67d1b24666538
expected_workers_main=4be46aba174cc266f97b1f751f64f0356c70071e4a4d26e12571e06a80bc322d

check_file() {
  local relative="$1" expected="$2" actual
  [ -f "$root/$relative" ] || { echo "ERROR: maintenance release is missing $relative" >&2; exit 1; }
  actual="$(sha256sum "$root/$relative" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || {
    echo "ERROR: reviewed maintenance enforcement bytes differ for $relative" >&2
    echo "Run: node infra/security/sync-production-maintenance-release-pins.mjs" >&2
    exit 1
  }
}

check_literal() {
  local relative="$1" literal="$2"
  [ -f "$root/$relative" ] || { echo "ERROR: maintenance release is missing $relative" >&2; exit 1; }
  grep -Fq -- "$literal" "$root/$relative" || {
    echo "ERROR: maintenance invariant is missing from $relative: $literal" >&2
    exit 1
  }
}

# Whitespace-tolerant variant for Prisma schema lines: `prisma format` realigns column padding
# across the whole file, so a byte-exact literal on a schema field breaks on every reformat while
# the invariant itself (the field, its type, its fail-closed default) is untouched.
check_pattern() {
  local relative="$1" pattern="$2"
  [ -f "$root/$relative" ] || { echo "ERROR: maintenance release is missing $relative" >&2; exit 1; }
  grep -Eq -- "$pattern" "$root/$relative" || {
    echo "ERROR: maintenance invariant is missing from $relative: $pattern" >&2
    exit 1
  }
}

check_file infra/api-web/web-api-proxy.mjs "$expected_proxy"
check_file infra/api-web/Dockerfile.api-web "$expected_api_dockerfile"
check_file infra/api-web/start-api-web-runtime.sh "$expected_api_start"
check_file apps/api/prisma/migrations/20260810120000_platform_access_control/migration.sql "$expected_platform_migration"
check_file apps/api/src/modules/auth/application/platform-access.service.ts "$expected_platform_service"
check_file apps/api/src/modules/auth/application/legal-acceptance.service.ts "$expected_legal_acceptance"
check_file apps/api/src/modules/auth/application/use-cases/password-login.use-case.ts "$expected_password_login"
check_file apps/api/src/modules/auth/application/use-cases/confirm-password-reset.use-case.ts "$expected_password_reset"
check_file apps/api/src/modules/auth/presentation/platform-access.controller.ts "$expected_platform_controller"
check_file apps/api/src/modules/auth/presentation/auth.guard.ts "$expected_auth_guard"
check_file apps/api/src/modules/auth/auth.module.ts "$expected_auth_module"
check_file apps/api/src/modules/auth/application/use-cases/refresh-session.use-case.ts "$expected_session_refresh"
check_file apps/web/app/api/auth/login/route.ts "$expected_login_bff"
check_file apps/web/src/features/auth/login-failure-response.server.ts "$expected_login_failure"
check_file apps/web/app/login/page.tsx "$expected_login_route"
check_file apps/web/app/maintenance/page.tsx "$expected_maintenance_page"
check_file apps/web/src/common/auth/session-gate.logic.ts "$expected_session_gate"
check_file apps/web/src/common/auth/server-session.ts "$expected_server_session"
check_file 'apps/web/app/(workspace)/companies/[companyId]/layout.tsx' "$expected_company_layout"
check_file apps/web/app/system/layout.tsx "$expected_system_layout"
check_file apps/web/app/change-password/page.tsx "$expected_change_password_route"
check_file apps/web/app/legal-acceptance/page.tsx "$expected_legal_acceptance_route"
check_file apps/web/app/system/platform-access/page.tsx "$expected_platform_route"
check_literal packages/config/src/index.ts "SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(300),"
check_literal packages/config/src/index.ts "PRODUCTION_SERVING_MODE: z.enum(['live', 'maintenance_only']).optional(),"
check_literal packages/config/src/index.ts "QUEUE_ENABLED: envBoolean.default(true),"
check_literal packages/config/src/index.ts "bool(config['QUEUE_ENABLED']) !== (servingMode === 'live')"
check_literal apps/api/prisma/schema.prisma "model PlatformAccessControl {"
check_pattern apps/api/prisma/schema.prisma 'state[[:space:]]+PlatformAccessState[[:space:]]+@default\(CLOSED\)'
check_literal apps/api/src/common/config/app-config.service.ts "get signedUrlTtlSeconds(): number { return this.config.SIGNED_URL_TTL_SECONDS; }"
check_literal apps/api/src/common/config/app-config.service.ts "get productionServingMode(): 'live' | 'maintenance_only' | undefined"
check_literal apps/api/src/modules/audit/domain/models/audit-action.ts "PLATFORM_ACCESS_STATE_UPDATE: 'platform.access.state_update',"
if [ "$scope" = full ]; then
  check_file infra/postmark/config.py "$expected_postmark_config"
  check_file infra/postmark/config.json "$expected_postmark_configuration"
  check_file infra/prod-ecs-express/deploy.sh "$expected_deploy"
  check_file infra/prod-ecs-express/list-service-deployments-all.sh "$expected_list_service_deployments"
  check_file infra/prod-ecs-express/verify-deployment.sh "$expected_verify"
  check_file infra/prod-ecs-express/verify-production-maintenance.sh "$expected_maintenance_verify"
  check_file infra/prod-ecs-express/run-release-task.sh "$expected_release_task"
  check_file infra/prod-ecs-express/register-task-definition-with-retry.sh "$expected_register_task"
  check_file infra/prod-ecs-express/run-task-idempotently.sh "$expected_run_task"
  check_file infra/prod-ecs-express/cleanup-one-shot-task.sh "$expected_cleanup_one_shot_task"
  check_file infra/prod-ecs-express/active-release-tasks.sh "$expected_active_release_tasks"
  check_file infra/prod-ecs-express/active-launch-builds.sh "$expected_active_launch_builds"
  check_file infra/docker/resolve-production-fast-mode.sh "$expected_fast_mode"
  check_file apps/api/prisma/verify-applied-migration-catalog.ts "$expected_migration_catalog"
  check_file infra/prod-ecs-express/release-task-network-failure.jq "$expected_release_task_network_failure"
  check_file infra/prod-ecs-express/wait-production-maintenance-ingress-drain.sh "$expected_ingress_drain"
  check_file apps/api/src/modules/data-model-core/infrastructure/storage/s3-storage.adapter.ts "$expected_s3_storage"
  check_file apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts "$expected_upload_intent"
  check_file apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts "$expected_download_url"
  check_file apps/ai-gateway/src/common/http/production-maintenance.middleware.ts "$expected_ai_middleware"
  check_file apps/ai-gateway/src/main.ts "$expected_ai_main"
  check_file apps/ai-gateway/Dockerfile "$expected_ai_dockerfile"
  check_file apps/workers/Dockerfile "$expected_workers_dockerfile"
  check_file apps/workers/src/main.ts "$expected_workers_main"
fi

echo "[maintenance-release] scope=$scope bytes=verified"
