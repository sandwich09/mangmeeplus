#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
collector="$root/infra/security/collect-production-promotion-resources.sh"
secret_validator="$root/infra/security/validate-production-runtime-secret-inventory.sh"
parameter_validator="$root/infra/security/validate-production-promotion-parameters.sh"
environment_validator="$root/infra/security/validate-production-promotion-environment.sh"
policy="$root/infra/security/production-security-readonly-policy.template.json"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-promotion-resources-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
for file in "$collector" "$secret_validator" "$parameter_validator" "$environment_validator"; do
  bash -n "$file"
done

promotion_env=(
  AWS_DEPLOY_ROLE_ARN=arn:aws:iam::311414082667:role/watchdog-bms-deploy-production
  PUBLIC_DOMAIN_URL=https://mangmeeplus.com WORKFLOW_WEBHOOK_ALLOWED_HOSTS=none
  CLAMAV_HOST=127.0.0.1
  LOG_KMS_KEY_ID=arn:aws:kms:ap-southeast-1:311414082667:key/11111111-1111-1111-1111-111111111111
  SECURITY_ALERT_TOPIC_ARN=arn:aws:sns:ap-southeast-1:311414082667:watchdog-alerts
  LINE_LOGIN_CHANNEL_ID=123456789 LINE_LIFF_ID=123456789-abc_DEF
  LINE_MESSAGING_CHANNEL_ID=987654321 LINE_AI_AGENT_RUNTIME=agentcore
  AGENTCORE_REGION=ap-southeast-1
  AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0
  AGENTCORE_RUNTIME_QUALIFIER=DEFAULT PRODUCTION_POLICY_READ_TOKEN_CONFIGURED=true
)
env "${promotion_env[@]}" bash "$environment_validator" "$work/environment.json"
jq -e '.allConfigured==true and .valuesExposed==false
  and (.requiredVariables|length)==13 and (.requiredVariableValuesSha256|test("^[0-9a-f]{64}$"))' \
  "$work/environment.json" >/dev/null
while IFS= read -r key; do
  if env "${promotion_env[@]}" env -u "$key" bash "$environment_validator" \
      "$work/missing-$key.json" >/dev/null 2>&1; then
    echo "ERROR: promotion environment accepted missing $key" >&2; exit 1
  fi
done < <(jq -r '.requiredVariables[]' "$work/environment.json")
if env "${promotion_env[@]}" PUBLIC_DOMAIN_URL=https://wrong.example \
    bash "$environment_validator" "$work/wrong-origin.json" >/dev/null 2>&1; then
  echo 'ERROR: promotion environment accepted a wrong Production origin' >&2; exit 1
fi

required=(database-url redis-url line-login-channel-secret line-messaging-channel-secret
  line-messaging-channel-access-token ai-gateway-internal-secret
  ai-actor-delegation-signing-key worker-internal-token watchdog-jwt-secret
  credential-encryption-key pdpa-pseudonymization-key pdpa-pseudonymization-previous-keys)
: > "$work/secrets.ndjson"
for name in "${required[@]}" typhoon-ocr-api-key; do
  jq -cn --arg name "watchdog-bms/production/$name" '
    {Name:$name,ARN:("arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:"+$name+"-aaaaaa"),
     VersionIdsToStages:{v1:["AWSCURRENT"]}}' >> "$work/secrets.ndjson"
done
jq -s . "$work/secrets.ndjson" > "$work/secrets.json"
TYPHOON_PROCESSING_REGION=thailand APPROVED_AI_REGIONS=thailand,ap-southeast-1 \
  APPROVED_AI_PROVIDERS=bedrock,typhoon \
  bash "$secret_validator" "$work/secrets.json" "$work/secret-inventory.json"
jq -e 'length==13 and all(.[];.hasCurrentVersion==true)
  and any(.[];.name=="watchdog-bms/production/typhoon-ocr-api-key" and .required==false)' \
  "$work/secret-inventory.json" >/dev/null

assert_secret_rejected() {
  local name="$1" filter="$2"
  jq "$filter" "$work/secrets.json" > "$work/$name.json"
  if TYPHOON_PROCESSING_REGION=thailand APPROVED_AI_REGIONS=thailand,ap-southeast-1 \
      APPROVED_AI_PROVIDERS=bedrock,typhoon \
      bash "$secret_validator" "$work/$name.json" "$work/$name-output.json" >/dev/null 2>&1; then
    echo "ERROR: secret inventory accepted $name" >&2; exit 1
  fi
}
assert_secret_rejected missing-required \
  'map(select(.Name!="watchdog-bms/production/database-url"))'
assert_secret_rejected scheduled-deletion \
  'map(if .Name=="watchdog-bms/production/database-url" then .+{DeletedDate:"2026-08-12"} else . end)'
assert_secret_rejected missing-current \
  'map(if .Name=="watchdog-bms/production/database-url" then .VersionIdsToStages={v1:["AWSPREVIOUS"]} else . end)'
if TYPHOON_PROCESSING_REGION= APPROVED_AI_REGIONS=thailand \
    APPROVED_AI_PROVIDERS=bedrock,typhoon \
    bash "$secret_validator" "$work/secrets.json" "$work/typhoon-missing-output.json" >/dev/null 2>&1; then
  echo 'ERROR: Typhoon inventory accepted missing processing region' >&2; exit 1
fi
if TYPHOON_PROCESSING_REGION=thailand APPROVED_AI_REGIONS=ap-southeast-1 \
    APPROVED_AI_PROVIDERS=bedrock,typhoon \
    bash "$secret_validator" "$work/secrets.json" "$work/typhoon-region-output.json" >/dev/null 2>&1; then
  echo 'ERROR: Typhoon inventory accepted an unapproved region' >&2; exit 1
fi
if TYPHOON_PROCESSING_REGION=thailand APPROVED_AI_REGIONS=thailand \
    APPROVED_AI_PROVIDERS=bedrock \
    bash "$secret_validator" "$work/secrets.json" "$work/typhoon-provider-output.json" >/dev/null 2>&1; then
  echo 'ERROR: Typhoon inventory accepted a missing provider allowlist' >&2; exit 1
fi

api=https://wa-11111111111111111111111111111111.ecs.ap-southeast-1.on.aws
ai=https://wa-22222222222222222222222222222222.ecs.ap-southeast-1.on.aws
workers=https://wa-33333333333333333333333333333333.ecs.ap-southeast-1.on.aws
jq -cn --arg api "$api" --arg ai "$ai" --arg workers "$workers" '
  {Parameters:[
    {Name:"/watchdog-bms/production/ecs-express-api-web-service-arn",Type:"String",Value:"arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub",Version:1},
    {Name:"/watchdog-bms/production/ecs-express-api-web-url",Type:"String",Value:$api,Version:1},
    {Name:"/watchdog-bms/production/erp-core-internal-url",Type:"String",Value:($api+"/v1"),Version:1},
    {Name:"/watchdog-bms/production/ecs-express-ai-gateway-service-arn",Type:"String",Value:"arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-ai-gateway-v2",Version:1},
    {Name:"/watchdog-bms/production/ecs-express-ai-gateway-url",Type:"String",Value:$ai,Version:1},
    {Name:"/watchdog-bms/production/ai-gateway-internal-url",Type:"String",Value:($ai+"/v1"),Version:1},
    {Name:"/watchdog-bms/production/ecs-express-workers-service-arn",Type:"String",Value:"arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-workers",Version:1},
    {Name:"/watchdog-bms/production/ecs-express-workers-url",Type:"String",Value:$workers,Version:1},
    {Name:"/watchdog-bms/production/s3-bucket",Type:"String",Value:"watchdog-bms-prod-311414082667",Version:1}
  ],InvalidParameters:[]}' > "$work/parameters.json"
bash "$parameter_validator" "$work/parameters.json" "$work/parameter-inventory.json"
jq -e 'length==9' "$work/parameter-inventory.json" >/dev/null
assert_parameter_rejected() {
  local name="$1" filter="$2"
  jq "$filter" "$work/parameters.json" > "$work/$name-parameters.json"
  if bash "$parameter_validator" "$work/$name-parameters.json" \
      "$work/$name-parameter-output.json" >/dev/null 2>&1; then
    echo "ERROR: parameter inventory accepted $name" >&2; exit 1
  fi
}
assert_parameter_rejected missing \
  '.Parameters|=map(select(.Name!="/watchdog-bms/production/s3-bucket"))'
assert_parameter_rejected wrong-service \
  '(.Parameters[]|select(.Name|endswith("ecs-express-ai-gateway-service-arn"))).Value|="arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/legacy"'
assert_parameter_rejected stale-internal-url \
  '(.Parameters[]|select(.Name|endswith("ai-gateway-internal-url"))).Value|="https://wa-44444444444444444444444444444444.ecs.ap-southeast-1.on.aws/v1"'
assert_parameter_rejected wrong-bucket \
  '(.Parameters[]|select(.Name|endswith("s3-bucket"))).Value|="watchdog-bms-prod-wrong"'

for required_call in 'secretsmanager describe-secret' 'ssm get-parameters' \
  'ecs describe-clusters' 'ec2 describe-vpcs' 'ec2 describe-subnets' \
  'ec2 describe-security-groups' 's3api get-bucket-location' \
  's3api get-bucket-versioning' 's3api get-bucket-lifecycle-configuration' \
  'logs describe-log-groups' 'kms describe-key' 'sns get-topic-attributes'; do
  grep -F "$required_call" "$collector" >/dev/null
done
if grep -F 'get-secret-value' "$collector" "$secret_validator" >/dev/null; then
  echo 'ERROR: readiness resource inventory reads a secret value' >&2; exit 1
fi
jq -e '
  any(.Statement[];.Sid=="AllowGlobalRead"
    and (.Action|index("secretsmanager:DescribeSecret"))!=null
    and (.Action|index("ssm:GetParameters"))!=null
    and (.Action|index("ecs:DescribeClusters"))!=null
    and (.Action|index("ec2:DescribeVpcs"))!=null
    and (.Action|index("s3:GetLifecycleConfiguration"))!=null
    and (.Action|index("s3:GetBucketVersioning"))!=null
    and (.Action|index("kms:DescribeKey"))!=null)
' "$policy" >/dev/null
echo 'production promotion resource prerequisites: PASS'
