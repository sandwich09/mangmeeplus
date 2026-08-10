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
expected_proxy=59ddfca9de3be92a7c97bcf5949c7396b2048b9da8469906952fbb4e29af6fe4
expected_api_dockerfile=99c33fe43b67c67c94c0e4bd3fc08d484fb9be082832f406739946394067209e
expected_api_start=54c189f5bca70124e1e71e9e56e9f5f92f614dd9cd41953a960af075ea41d6df
expected_deploy=413096b11632eb83a860f6a76f7553e0e882fdc3032c47cdcaa9727c12a21e76
expected_verify=775612d203c4a43a34818d6f9d31d0f3b4eb66e497889b67886fc24c6bbff045
expected_maintenance_verify=ba78834d1cfe91cefd17ee89e1908339f9e62f8b47d13d3d6d7f8006b3cee873
expected_release_task=cf5b392265f53594346921659cbf9b76fc3798c398908567a5096830396a6279
expected_ingress_drain=c1b81490a74f53d483ef0da7d6852517d8e76b8ce7f3f48da6cc95b0fbd53773
expected_config=11720bc68c4d9052ddf6013e3c347e7a1b92723f6f9b279b0a9f17105f024a08
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
if [ "$scope" = full ]; then
  check_file infra/prod-ecs-express/deploy.sh "$expected_deploy"
  check_file infra/prod-ecs-express/verify-deployment.sh "$expected_verify"
  check_file infra/prod-ecs-express/verify-production-maintenance.sh "$expected_maintenance_verify"
  check_file infra/prod-ecs-express/run-release-task.sh "$expected_release_task"
  check_file infra/prod-ecs-express/wait-production-maintenance-ingress-drain.sh "$expected_ingress_drain"
  check_file packages/config/src/index.ts "$expected_config"
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
