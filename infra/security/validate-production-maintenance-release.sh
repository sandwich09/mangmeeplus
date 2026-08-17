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
expected_api_dockerfile=7ba817ed3e73bd97dbecf5d563f8af28c8ed9fb4d7cfdf550fc88586545c7ae1
expected_api_start=54c189f5bca70124e1e71e9e56e9f5f92f614dd9cd41953a960af075ea41d6df
expected_platform_migration=3ac9ea81f12d76be503b383aeab6580c91f63a4b000aa58b47e549c2a8fa218a
expected_platform_service=c9aa205b6a8935f3ef52747b56e7357eba0060545dd9045f98be2a6f8d198cb6
expected_legal_acceptance=4ea6431e72d77d07b49132dd7663f0de3bac0fa80256b0add2806ebe02b27619
expected_password_login=5ea25fe73b9c95829fcfe52332d3ae09acec69dbed6299573416d51c36c76137
expected_password_reset=c6ed1623c4efa0ed1c550f966a19767ff3598af0343ac234cc0fdbd1a3cf4084
expected_platform_controller=55fd64ba00ee930f30fec57a956af6dc6b8a49669c705add2d310e3b60273ca5
expected_auth_guard=6e27724b3625944374a4e25f729c082a4dbba738371ab9486243a1da91f04d6e
expected_auth_module=2255b3c3cd91abe2e73d1049abeab4c863a88dfa793dbf579903264c592e2ea8
expected_session_refresh=40565d6e1252c3479f9a7fa2496c67afd8eab28d681f39128f78e031bf0e35e6
expected_login_bff=af26e54f6490e856a0b9931dbfd3292a92b55d82da1884f41d22b7760f55e6e9
expected_login_failure=f32db402e2af86707ba1d9b9fd5b4b5aa06f8b522b95b170d7a9c5848f687459
expected_login_route=df86674a0f29bb5560279364e19ed579011cc59f06a23823b3c9c91834835c3c
expected_maintenance_page=14a4b7c6dbfd36e96c71bcf14d5bbd19a015b8f51a4e05d4a365e904b780a667
expected_session_gate=511032442a25c088e5b6d39cf8b9e7b2440c2fe11e616f8f7ac8bd2354de934a
expected_server_session=86595c816ffe5d5898686ed39092582121c5a4c4c052b11b1b9fc0e02790bc85
expected_company_layout=3efe436770274dc9821270dbcd28fbef877a5db0caef617ee78070303d96e100
expected_system_layout=f74baaadd242180b5cd1ed75c1492eac0fdc7cc3d5872b7144599400e9980393
expected_change_password_route=2e256a37b0a775e7778839bef15c9516d82dc23503f46660a543213713f3e7f7
expected_legal_acceptance_route=f0076607745d2b17e6b34281c71b391ef8eeb8f67089de2c347d12801e0b3007
expected_platform_route=1c72dbc0de94bbb74a4734056b2c67fd8931aeed3f523fbfd48792fc6336e32e
expected_deploy=9f1e6d63cfdc93c3868aaf51ab0d20885a06183aec13f2bbceb6fbc11ecfafe4
expected_list_service_deployments=fb189137c58cf208191ad24ea2007a9758086bef4dfece967be94f6f7a800620
expected_verify=0da72afdaf9721768aec0589b94cf37c8987994e6bdc69339bb80ab45eae5775
expected_maintenance_verify=291c6742b94a559d06315eeef683d9ca52695820fe3f85b4e18ab6dbb582f9ad
expected_release_task=2c180ddcc278752dde8f2b90b3db20f4b4ea545afde5022c4fed555fb56138bc
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
expected_upload_intent=f68b1094dcc34d9feaab2506c16cf5a9f9d0750b3f4167a36e3c8ceb8a1a9adc
expected_download_url=97b500ac1c7a21124897c921e22f7bab2b3e5a5985a84607eb9b8050aef98f9b
expected_ai_middleware=d9dfbf6ca245db162a5de8801d557f41af6144193d43fb88e2129f1442b9b8d5
expected_ai_main=b5c11a109cb15b12e7ed23e45d1633d96bc9531ce947b94d51a1912419a90e8b
expected_ai_dockerfile=0e245edda4654d10654c19d212d515cd35dd68349b4ab5657ed6506f4afff10c
expected_workers_dockerfile=a1f3bf39cdec95971361d8d2e9d4152ff21bd17c8f0f683e22c7b63244b7be43
expected_workers_main=4545b84de096591c9b0fdcd11c502d76aaeada40f9240328bf552282352ac601

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
check_literal apps/api/prisma/schema.prisma "state                        PlatformAccessState @default(CLOSED)"
check_literal apps/api/src/common/config/app-config.service.ts "get signedUrlTtlSeconds(): number { return this.config.SIGNED_URL_TTL_SECONDS; }"
check_literal apps/api/src/common/config/app-config.service.ts "get productionServingMode(): 'live' | 'maintenance_only' | undefined"
check_literal apps/api/src/modules/audit/domain/models/audit-action.ts "PLATFORM_ACCESS_STATE_UPDATE: 'platform.access.state_update',"
if [ "$scope" = full ]; then
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
