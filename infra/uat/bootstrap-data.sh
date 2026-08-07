#!/usr/bin/env bash
set -euo pipefail

if [ "${CONFIRM_UAT_COST:-}" != "CREATE_ISOLATED_UAT" ]; then
  echo "ERROR: set CONFIRM_UAT_COST=CREATE_ISOLATED_UAT after approving dedicated RDS/Redis cost" >&2
  exit 2
fi
for key in LINE_LOGIN_CHANNEL_SECRET LINE_MESSAGING_CHANNEL_SECRET LINE_MESSAGING_CHANNEL_ACCESS_TOKEN; do
  if [ -z "${!key:-}" ]; then
    echo "ERROR: $key must contain a separate UAT credential" >&2
    exit 2
  fi
done

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
prefix="watchdog-bms-uat"
secret_prefix="watchdog-bms/uat"
bucket="${prefix}-${account_id}"

secret_exists() {
  aws_cmd secretsmanager describe-secret --secret-id "$1" --region "$region" >/dev/null 2>&1
}

create_secret() {
  local name="$1" value="$2"
  if secret_exists "$name"; then
    return
  fi
  aws_cmd secretsmanager create-secret --name "$name" --secret-string "$value" --region "$region" >/dev/null
}

create_random_secret() {
  local name="$1"
  if ! secret_exists "$name"; then
    create_secret "$name" "$(openssl rand -hex 32)"
  fi
}

vpc_id="$(aws_cmd ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text --region "$region")"
subnets="$(aws_cmd ec2 describe-subnets \
  --filters Name=tag:Name,Values=watchdog-bms-prod-app-private-a,watchdog-bms-prod-app-private-b Name=vpc-id,Values="$vpc_id" \
  --query 'Subnets[].SubnetId' --output text --region "$region")"
if [ "$vpc_id" = "None" ] || [ "$(wc -w <<< "$subnets")" -ne 2 ]; then
  echo "ERROR: expected the existing two private application subnets" >&2
  exit 1
fi

ensure_security_group() {
  local name="$1" description="$2" id
  id="$(aws_cmd ec2 describe-security-groups --filters Name=group-name,Values="$name" Name=vpc-id,Values="$vpc_id" --query 'SecurityGroups[0].GroupId' --output text --region "$region")"
  if [ "$id" = "None" ]; then
    id="$(aws_cmd ec2 create-security-group --group-name "$name" --description "$description" --vpc-id "$vpc_id" --query GroupId --output text --region "$region")"
  fi
  printf '%s' "$id"
}

app_sg="$(ensure_security_group "${prefix}-app-egress-sg" 'WatchDog BMS UAT application egress')"
ensure_security_group "${prefix}-ai-egress-sg" 'WatchDog BMS UAT AI egress; never authorize on data services' >/dev/null
db_sg="$(ensure_security_group "${prefix}-db-sg" 'WatchDog BMS UAT PostgreSQL')"
redis_sg="$(ensure_security_group "${prefix}-redis-sg" 'WatchDog BMS UAT Redis')"

aws_cmd ec2 authorize-security-group-ingress --group-id "$db_sg" --protocol tcp --port 5432 --source-group "$app_sg" --region "$region" >/dev/null 2>&1 || true
aws_cmd ec2 authorize-security-group-ingress --group-id "$redis_sg" --protocol tcp --port 6379 --source-group "$app_sg" --region "$region" >/dev/null 2>&1 || true
for rule in "$db_sg:5432" "$redis_sg:6379"; do
  group="${rule%%:*}"
  port="${rule##*:}"
  if ! aws_cmd ec2 describe-security-groups --group-ids "$group" --output json --region "$region" |
    jq -e --argjson port "$port" --arg app_sg "$app_sg" \
      'any(.SecurityGroups[0].IpPermissions[]?; .FromPort == $port and .ToPort == $port and any(.UserIdGroupPairs[]?; .GroupId == $app_sg))' >/dev/null; then
    echo "ERROR: missing UAT data ingress from application security group" >&2
    exit 1
  fi
done

db_subnet_group="${prefix}-db-subnets"
if ! aws_cmd rds describe-db-subnet-groups --db-subnet-group-name "$db_subnet_group" --region "$region" >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  aws_cmd rds create-db-subnet-group --db-subnet-group-name "$db_subnet_group" --db-subnet-group-description 'WatchDog BMS UAT DB subnets' --subnet-ids $subnets --region "$region" >/dev/null
fi

redis_subnet_group="${prefix}-redis-subnets"
if ! aws_cmd elasticache describe-cache-subnet-groups --cache-subnet-group-name "$redis_subnet_group" --region "$region" >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  aws_cmd elasticache create-cache-subnet-group --cache-subnet-group-name "$redis_subnet_group" --cache-subnet-group-description 'WatchDog BMS UAT Redis subnets' --subnet-ids $subnets --region "$region" >/dev/null
fi

db_id="${prefix}-db"
database_secret="${secret_prefix}/database-url"
if ! aws_cmd rds describe-db-instances --db-instance-identifier "$db_id" --region "$region" >/dev/null 2>&1; then
  if secret_exists "$database_secret"; then
    echo "ERROR: ${database_secret} exists but UAT RDS does not; remove or reconcile the stale secret explicitly" >&2
    exit 1
  fi
  db_password="$(openssl rand -hex 24)"
  aws_cmd rds create-db-instance \
    --db-instance-identifier "$db_id" \
    --db-instance-class db.t4g.micro \
    --engine postgres \
    --engine-version 18.3 \
    --allocated-storage 20 \
    --storage-type gp3 \
    --storage-encrypted \
    --master-username watchdog \
    --master-user-password "$db_password" \
    --db-name watchdog_bms \
    --db-subnet-group-name "$db_subnet_group" \
    --vpc-security-group-ids "$db_sg" \
    --no-publicly-accessible \
    --no-multi-az \
    --backup-retention-period 1 \
    --auto-minor-version-upgrade \
    --region "$region" >/dev/null
  aws_cmd rds wait db-instance-available --db-instance-identifier "$db_id" --region "$region"
  db_host="$(aws_cmd rds describe-db-instances --db-instance-identifier "$db_id" --query 'DBInstances[0].Endpoint.Address' --output text --region "$region")"
  create_secret "$database_secret" "postgresql://watchdog:${db_password}@${db_host}:5432/watchdog_bms?schema=public&sslmode=verify-full&sslrootcert=/etc/ssl/certs/aws-rds-global-bundle.pem"
elif ! secret_exists "$database_secret"; then
  echo "ERROR: UAT RDS exists but ${database_secret} does not; recover/reset its password explicitly" >&2
  exit 1
fi

redis_id="${prefix}-redis"
redis_secret="${secret_prefix}/redis-url"
if ! aws_cmd elasticache describe-cache-clusters --cache-cluster-id "$redis_id" --region "$region" >/dev/null 2>&1; then
  if secret_exists "$redis_secret"; then
    echo "ERROR: ${redis_secret} exists but UAT Redis does not; remove or reconcile the stale secret explicitly" >&2
    exit 1
  fi
  aws_cmd elasticache create-cache-cluster \
    --cache-cluster-id "$redis_id" \
    --engine redis \
    --engine-version 7.1 \
    --cache-node-type cache.t4g.micro \
    --num-cache-nodes 1 \
    --cache-subnet-group-name "$redis_subnet_group" \
    --security-group-ids "$redis_sg" \
    --region "$region" >/dev/null
  aws_cmd elasticache wait cache-cluster-available --cache-cluster-id "$redis_id" --region "$region"
  redis_host="$(aws_cmd elasticache describe-cache-clusters --cache-cluster-id "$redis_id" --show-cache-node-info --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' --output text --region "$region")"
  create_secret "$redis_secret" "redis://${redis_host}:6379"
elif ! secret_exists "$redis_secret"; then
  echo "ERROR: UAT Redis exists but ${redis_secret} does not" >&2
  exit 1
fi

if ! aws_cmd s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  if ! create_bucket_output="$(aws_cmd s3api create-bucket --bucket "$bucket" --create-bucket-configuration LocationConstraint="$region" --region "$region" 2>&1)"; then
    if [[ "$create_bucket_output" != *BucketAlreadyOwnedByYou* ]]; then
      echo "$create_bucket_output" >&2
      exit 1
    fi
  fi
fi
aws_cmd s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
aws_cmd s3api put-bucket-encryption --bucket "$bucket" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
aws_cmd s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled >/dev/null
aws_cmd s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration file://infra/object-storage-lifecycle.json >/dev/null
aws_cmd ssm put-parameter --name /watchdog-bms/uat/s3-bucket --type String --value "$bucket" --overwrite --region "$region" >/dev/null

create_secret "${secret_prefix}/line-login-channel-secret" "$LINE_LOGIN_CHANNEL_SECRET"
create_secret "${secret_prefix}/line-messaging-channel-secret" "$LINE_MESSAGING_CHANNEL_SECRET"
create_secret "${secret_prefix}/line-messaging-channel-access-token" "$LINE_MESSAGING_CHANNEL_ACCESS_TOKEN"
create_random_secret "${secret_prefix}/ai-gateway-internal-secret"
create_random_secret "${secret_prefix}/ai-actor-delegation-signing-key"
create_random_secret "${secret_prefix}/worker-internal-token"
create_random_secret "${secret_prefix}/watchdog-jwt-secret"
create_random_secret "${secret_prefix}/credential-encryption-key"
create_random_secret "${secret_prefix}/pdpa-pseudonymization-key"
# Optional: Typhoon is the only image receipt/bank-statement OCR provider. Without this secret
# the ai-gateway binding is dropped and image OCR returns PROVIDER_CONFIG_MISSING (PDF OCR
# reads through Bedrock and is unaffected). Deploys cannot create it — they only describe.
if [ -n "${TYPHOON_OCR_API_KEY:-}" ]; then
  create_secret "${secret_prefix}/typhoon-ocr-api-key" "$TYPHOON_OCR_API_KEY"
fi
if ! secret_exists "${secret_prefix}/pdpa-pseudonymization-previous-keys"; then
  previous_key="$(aws_cmd secretsmanager get-secret-value --secret-id "${secret_prefix}/credential-encryption-key" --query SecretString --output text --region "$region")"
  create_secret "${secret_prefix}/pdpa-pseudonymization-previous-keys" "$previous_key"
fi

aws_cmd ecs describe-clusters --clusters "$prefix" --query 'clusters[0].clusterArn' --output text --region "$region" | grep -q '^arn:' || \
  aws_cmd ecs create-cluster --cluster-name "$prefix" --region "$region" >/dev/null

echo "[uat-bootstrap] isolated RDS, Redis, S3, secrets, network, and ECS cluster are ready"
