#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <watchdog-bms-api@sha256:digest> <full-develop-sha>" >&2
  exit 2
fi

image="$1"
commit="$2"
region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
secret_file=""
docker_config_dir=""
docker_config_parent="$(cd -P -- "${TMPDIR:-/tmp}" && pwd)"
readonly_description="UAT-only SELECT credential for A5/F2 read paths"

cleanup() {
  unset writer_url readonly_password readonly_url
  if [ -n "$secret_file" ] && [ -f "$secret_file" ]; then
    rm -f -- "$secret_file"
  fi
  if [ -n "$docker_config_dir" ] && [ -d "$docker_config_dir" ]; then
    if [ "$(dirname "$docker_config_dir")" = "$docker_config_parent" ] \
      && [[ "$(basename "$docker_config_dir")" == watchdog-a5-docker.* ]]; then
      rm -rf -- "$docker_config_dir"
    else
      echo "WARNING: refusing to remove unexpected Docker config path" >&2
    fi
  fi
}
trap cleanup EXIT

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
[[ "$account_id" =~ ^[0-9]{12}$ ]] || { echo "ERROR: cannot resolve the AWS account" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "ERROR: expected a lowercase full commit SHA" >&2; exit 2; }
[[ "$image" =~ ^${account_id}\.dkr\.ecr\.${region}\.amazonaws\.com/watchdog-bms-api@sha256:[0-9a-f]{64}$ ]] \
  || { echo "ERROR: expected the exact watchdog-bms-api digest in this account/region" >&2; exit 2; }
git fetch --quiet origin develop --force
git merge-base --is-ancestor "$commit" origin/develop \
  || { echo "ERROR: bootstrap commit is not reachable from origin/develop" >&2; exit 2; }
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  bash "$(dirname "$0")/../prod-ecs-express/verify-serving-api-build.sh" uat "$commit" >/dev/null
published_digest="$(aws_cmd ecr describe-images --repository-name watchdog-bms-api \
  --image-ids "imageTag=uat-release-task-${commit}" \
  --query 'imageDetails[0].imageDigest' --output text --region "$region")"
[ "$image" = "${account_id}.dkr.ecr.${region}.amazonaws.com/watchdog-bms-api@${published_digest}" ] \
  || { echo "ERROR: image digest does not match the published UAT release-task tag for this commit" >&2; exit 2; }
registry="${account_id}.dkr.ecr.${region}.amazonaws.com"
docker_config_dir="$(mktemp -d "${docker_config_parent}/watchdog-a5-docker.XXXXXX")"
aws_cmd ecr get-login-password --region "$region" \
  | DOCKER_CONFIG="$docker_config_dir" docker login --username AWS --password-stdin "$registry" >/dev/null
command -v cosign >/dev/null 2>&1 \
  || { echo "ERROR: cosign is required to verify the UAT release-task image" >&2; exit 2; }
DOCKER_CONFIG="$docker_config_dir" \
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  cosign verify \
    --certificate-identity "https://github.com/MangmeeDev/mangmeeplus/.github/workflows/deploy-uat.yml@refs/heads/main" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    "$image" >/dev/null
DOCKER_CONFIG="$docker_config_dir" docker pull --platform linux/amd64 "$image" >/dev/null
[ "$(DOCKER_CONFIG="$docker_config_dir" docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" = "$commit" ] \
  || { echo "ERROR: release-task image label does not match the reviewed full commit SHA" >&2; exit 2; }

writer_name="watchdog-bms/uat/database-url"
readonly_name="watchdog-bms/uat/a5-readonly-database-url"
writer_arn="$(aws_cmd secretsmanager describe-secret --secret-id "$writer_name" --query ARN --output text --region "$region")"
[[ "$writer_arn" =~ ^arn:aws:secretsmanager:${region}:${account_id}:secret:${writer_name}- ]] \
  || { echo "ERROR: UAT writer secret identity mismatch" >&2; exit 1; }

created=false
readonly_describe_status=0
readonly_metadata="$(aws_cmd secretsmanager describe-secret --secret-id "$readonly_name" \
  --query '{arn:ARN,description:Description}' --output json --region "$region" 2>&1)" \
  || readonly_describe_status=$?
if [ "$readonly_describe_status" -eq 0 ]; then
  readonly_arn="$(jq -er '.arn' <<< "$readonly_metadata")"
  [[ "$readonly_arn" =~ ^arn:aws:secretsmanager:${region}:${account_id}:secret:${readonly_name}- ]] \
    || { echo "ERROR: UAT A5 secret identity mismatch" >&2; exit 1; }
  [ "$(jq -r '.description // ""' <<< "$readonly_metadata")" = "$readonly_description" ] \
    || { echo "ERROR: UAT A5 secret description mismatch" >&2; exit 1; }
  echo "[a5-bootstrap] using the existing A5 read-only secret without rotating it"
else
  if [[ "$readonly_metadata" != *"(ResourceNotFoundException) when calling the DescribeSecret operation:"* ]]; then
    printf '%s\n' "$readonly_metadata" >&2
    exit "$readonly_describe_status"
  fi
  readonly_metadata=""
  writer_url="$(aws_cmd secretsmanager get-secret-value \
    --secret-id "$writer_name" --query SecretString --output text --region "$region")"
  readonly_password="$(openssl rand -base64 48 | tr -d '\n')"
  readonly_url="$(WATCHDOG_A5_WRITER_URL="$writer_url" WATCHDOG_A5_PASSWORD="$readonly_password" node -e '
    const url = new URL(process.env.WATCHDOG_A5_WRITER_URL || "");
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("not PostgreSQL");
    url.username = "watchdog_a5_ro";
    url.password = process.env.WATCHDOG_A5_PASSWORD || "";
    process.stdout.write(url.toString());
  ')"
  secret_file="$(mktemp "${TMPDIR:-/tmp}/watchdog-a5-readonly-secret.XXXXXX")"
  chmod 600 "$secret_file"
  printf '%s' "$readonly_url" > "$secret_file"
  readonly_arn="$(aws_cmd secretsmanager create-secret \
    --name "$readonly_name" \
    --description "$readonly_description" \
    --secret-string "file://${secret_file}" \
    --query ARN --output text --region "$region")"
  rm -f -- "$secret_file"
  secret_file=""
  unset writer_url readonly_password readonly_url
  [[ "$readonly_arn" =~ ^arn:aws:secretsmanager:${region}:${account_id}:secret:${readonly_name}- ]] \
    || { echo "ERROR: created A5 secret identity mismatch" >&2; exit 1; }
  created=true
  echo "[a5-bootstrap] created the dedicated UAT A5 secret (value not printed)"
fi

echo "[a5-bootstrap] applying and verifying the fixed SELECT-only database role"
DEPLOY_ENV=uat \
AWS_ACCOUNT_ID="$account_id" \
DATABASE_URL_SECRET_ARN="$writer_arn" \
A5_READONLY_DATABASE_URL_SECRET_ARN="$readonly_arn" \
bash "$(dirname "$0")/../prod-ecs-express/run-release-task.sh" "$image" "$commit" a5-bootstrap

echo "[a5-bootstrap] complete secretCreated=$created role=watchdog_a5_ro"
