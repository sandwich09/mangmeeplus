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
expected_api_dockerfile=99c33fe43b67c67c94c0e4bd3fc08d484fb9be082832f406739946394067209e
expected_api_start=54c189f5bca70124e1e71e9e56e9f5f92f614dd9cd41953a960af075ea41d6df
expected_config=1b40313a6db56a6d9d5ee8317dc6180c49a8d17b86120423135a0de76b433ed7
expected_prisma_schema=161309e79eda1735b837a8a0f8ca47500576d0feb288d42503fa2fed9fe1a06a
expected_platform_migration=3ac9ea81f12d76be503b383aeab6580c91f63a4b000aa58b47e549c2a8fa218a
expected_app_config=79aa26f028b1580abf1cc8f676fdd0f187ca7119304b0d80caf226faa6d49605
expected_audit_action=499f57dd118974c828bfde8b7805719af834d75ef0960b22cca9572109a07add
expected_platform_service=c9aa205b6a8935f3ef52747b56e7357eba0060545dd9045f98be2a6f8d198cb6
expected_legal_acceptance=d4933596b559297db3b494491b12b06886e43c385e1e373acaeff4395b315eeb
expected_password_login=5ea25fe73b9c95829fcfe52332d3ae09acec69dbed6299573416d51c36c76137
expected_password_reset=c6ed1623c4efa0ed1c550f966a19767ff3598af0343ac234cc0fdbd1a3cf4084
expected_platform_controller=55fd64ba00ee930f30fec57a956af6dc6b8a49669c705add2d310e3b60273ca5
expected_auth_guard=4dfc610564f694abb9f1311d1b1099cb008b607960b99ab780c6538a79c82266
expected_auth_module=2255b3c3cd91abe2e73d1049abeab4c863a88dfa793dbf579903264c592e2ea8
expected_session_refresh=40565d6e1252c3479f9a7fa2496c67afd8eab28d681f39128f78e031bf0e35e6
expected_login_bff=af26e54f6490e856a0b9931dbfd3292a92b55d82da1884f41d22b7760f55e6e9
expected_login_failure=f32db402e2af86707ba1d9b9fd5b4b5aa06f8b522b95b170d7a9c5848f687459
expected_login_route=df86674a0f29bb5560279364e19ed579011cc59f06a23823b3c9c91834835c3c
expected_login_page=95b5d135d82c9009afa077b7d1b23aa4015c7cfc6a88277ebff9e6662a61ea6a
expected_maintenance_page=14a4b7c6dbfd36e96c71bcf14d5bbd19a015b8f51a4e05d4a365e904b780a667
expected_session_gate=511032442a25c088e5b6d39cf8b9e7b2440c2fe11e616f8f7ac8bd2354de934a
expected_server_session=86595c816ffe5d5898686ed39092582121c5a4c4c052b11b1b9fc0e02790bc85
expected_company_layout=3efe436770274dc9821270dbcd28fbef877a5db0caef617ee78070303d96e100
expected_system_layout=f74baaadd242180b5cd1ed75c1492eac0fdc7cc3d5872b7144599400e9980393
expected_change_password_route=2e256a37b0a775e7778839bef15c9516d82dc23503f46660a543213713f3e7f7
expected_legal_acceptance_route=f0076607745d2b17e6b34281c71b391ef8eeb8f67089de2c347d12801e0b3007
expected_platform_route=1c72dbc0de94bbb74a4734056b2c67fd8931aeed3f523fbfd48792fc6336e32e
expected_platform_page=abd9dc94693f5aef0a06b2aede4593817de6f6e8e8cde22fc0c61123e9331c67
expected_system_api=917daa54e1334fe3c03b7764eb1499705aec73234409fddee3ea0b061da4094b
expected_system_header=80184d241b147b2013d1601deba34b56a3bf82f648d0f123734b7a54727c309b
expected_deploy=3f2c189cc520f91d8e8615b31838fa28abad7533f890a61effde632c258c9173
expected_uat_fast_rollout=60f413807ae2baa7289ef5e23bcd394c6c59bd1fe5940f5b80fdd938a95950a8
expected_verify=775612d203c4a43a34818d6f9d31d0f3b4eb66e497889b67886fc24c6bbff045
expected_maintenance_verify=71104181a97f4d49321aa0ae925464aba2c5edbde3e96692a58a87f7e61eb5e4
expected_release_task=a4759b21f286d296cbd51150f612405aef8e55db603befb606470f814be30567
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
    echo "ERROR: maintenance release bytes differ for $relative" >&2
    exit 1
  }
}

check_file infra/api-web/web-api-proxy.mjs "$expected_proxy"
check_file infra/api-web/Dockerfile.api-web "$expected_api_dockerfile"
check_file infra/api-web/start-api-web-runtime.sh "$expected_api_start"
check_file packages/config/src/index.ts "$expected_config"
check_file apps/api/prisma/schema.prisma "$expected_prisma_schema"
check_file apps/api/prisma/migrations/20260810120000_platform_access_control/migration.sql "$expected_platform_migration"
check_file apps/api/src/common/config/app-config.service.ts "$expected_app_config"
check_file apps/api/src/modules/audit/domain/models/audit-action.ts "$expected_audit_action"
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
check_file apps/web/src/features/auth/LoginPage.tsx "$expected_login_page"
check_file apps/web/app/maintenance/page.tsx "$expected_maintenance_page"
check_file apps/web/src/common/auth/session-gate.logic.ts "$expected_session_gate"
check_file apps/web/src/common/auth/server-session.ts "$expected_server_session"
check_file 'apps/web/app/(workspace)/companies/[companyId]/layout.tsx' "$expected_company_layout"
check_file apps/web/app/system/layout.tsx "$expected_system_layout"
check_file apps/web/app/change-password/page.tsx "$expected_change_password_route"
check_file apps/web/app/legal-acceptance/page.tsx "$expected_legal_acceptance_route"
check_file apps/web/app/system/platform-access/page.tsx "$expected_platform_route"
check_file apps/web/src/features/system-partners/PlatformAccessPage.tsx "$expected_platform_page"
check_file apps/web/src/features/system-partners/system-partners.api.ts "$expected_system_api"
check_file apps/web/src/common/components/app-shell/SystemHeader.tsx "$expected_system_header"
if [ "$scope" = full ]; then
  check_file infra/prod-ecs-express/deploy.sh "$expected_deploy"
  check_file infra/prod-ecs-express/lib-uat-fast-rollout.sh "$expected_uat_fast_rollout"
  check_file infra/prod-ecs-express/verify-deployment.sh "$expected_verify"
  check_file infra/prod-ecs-express/verify-production-maintenance.sh "$expected_maintenance_verify"
  check_file infra/prod-ecs-express/run-release-task.sh "$expected_release_task"
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
