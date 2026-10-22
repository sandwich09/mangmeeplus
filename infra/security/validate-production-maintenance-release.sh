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
expected_api_dockerfile=011db89f4263c41ad800f9cf1afb09e68bb6c39231e70dd4f3fdf9cff83b099e
expected_api_start=4410bd7a8956256b78c8f30cbbc79971837a00012cd61a1577052d0b8c86e82f
expected_platform_migration=3ac9ea81f12d76be503b383aeab6580c91f63a4b000aa58b47e549c2a8fa218a
expected_platform_service=c9aa205b6a8935f3ef52747b56e7357eba0060545dd9045f98be2a6f8d198cb6
expected_legal_acceptance=d662145aae1dc8c0a794c1653ab68248ca9946b73640f495dc560a1b6619fbf1
expected_password_login=33325bd3433335f75e079b04019db56071f31726f59401be59be5423da9ce46e
expected_password_reset=9f900e6d57fbc39b7e9340e5eb037230fa3351923dbb5b1153a16beff2499755
expected_platform_controller=55fd64ba00ee930f30fec57a956af6dc6b8a49669c705add2d310e3b60273ca5
expected_auth_guard=f100e02b3e4712969f206fb4bcaaf62aa53d5c081ad1eadf2d46b4882d07c510
expected_auth_module=a1c021183d1cc3bdc4f274cd783ed8134b1fcd912a20d685c6c00b6e8dcce709
expected_email_access=d93c966196b377aa4f1e1f55f22d951b173fb27715ad8b75160982f334609173
expected_session_refresh=40565d6e1252c3479f9a7fa2496c67afd8eab28d681f39128f78e031bf0e35e6
expected_login_bff=af26e54f6490e856a0b9931dbfd3292a92b55d82da1884f41d22b7760f55e6e9
expected_login_failure=f32db402e2af86707ba1d9b9fd5b4b5aa06f8b522b95b170d7a9c5848f687459
expected_login_route=df86674a0f29bb5560279364e19ed579011cc59f06a23823b3c9c91834835c3c
expected_maintenance_page=96a49e3560a63752c157c3bcbec6d1cfffde5937759c3825e59a21246f096e91
expected_session_gate=e0438cf347793c74c4bf34e8085e259c2ea43e35bbbe0daad03456eb5d537307
expected_server_session=c1d3d1a445b2650e76ee60f80fb6ac270b67d1be11ba11e56d080bbce1c42a3b
expected_company_layout=9e46ae419ffca92dd248988f3144a9330f8069ac5564465bcb833726d5e585c6
expected_system_layout=181cea89471fc2becfd3ca874b815a3a5a73df87ea9b9d076bff7311b493f8d7
expected_change_password_route=f7ac9d1dc2d0f349513ce1c4aca4da786402f707caf4e6cb54d36aded117256d
expected_legal_acceptance_route=f0076607745d2b17e6b34281c71b391ef8eeb8f67089de2c347d12801e0b3007
expected_platform_route=1c72dbc0de94bbb74a4734056b2c67fd8931aeed3f523fbfd48792fc6336e32e
expected_deploy=d587642e44799c5300699e35a9eacbcff335bbc699d5c68b8d7b2bc6b1d5ba8a
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
expected_download_url=5208d232bc8ab403b699565c327eb987a41d3adaaa9f7a77465a6c1b2cf43844
expected_ai_middleware=d9dfbf6ca245db162a5de8801d557f41af6144193d43fb88e2129f1442b9b8d5
expected_ai_main=0e8ecad03f7a19ce4f80b041ca914e6636db140850938d35b4a32175ea90a553
expected_ai_dockerfile=4ce10a99b55ea103eb946931830aa8b8b3e69c952285b21227f289edf3d12b5c
expected_workers_dockerfile=7706b5053ed1aaa4d8f29fba41def30b75f992300913e4a28fd1b6316b602a76
expected_postmark_config=f8ec50c6b64b44dbe62fc2a6e7f1f8535f17f2aff77b69efc723d4d39cbddf65
expected_postmark_configuration=0753b73bbfb31954e607bf076e327b20e04e647c48de017406b67d1b24666538
expected_workers_main=bf07e7520c848ccc12d0f1d25eee9ac3567e590da2e32cabde270e04168c38b0

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
check_file apps/api/src/modules/auth/application/email-access.service.ts "$expected_email_access"
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
