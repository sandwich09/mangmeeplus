#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <output.json>" >&2
  exit 2
fi
output="$1"
[ ! -e "$output" ]
region=ap-southeast-1
account=311414082667
parameter_prefix=/watchdog-bms/production
secret_prefix=watchdog-bms/production
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-promotion-resources.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

runtime_secret_names=(database-url redis-url line-login-channel-secret
  line-messaging-channel-secret line-messaging-channel-access-token
  ai-gateway-internal-secret ai-actor-delegation-signing-key worker-internal-token
  watchdog-jwt-secret credential-encryption-key pdpa-pseudonymization-key
  pdpa-pseudonymization-previous-keys)
secret_metadata="$work/secrets.json"
: > "$work/secrets.ndjson"
for suffix in "${runtime_secret_names[@]}"; do
  aws secretsmanager describe-secret --region "$region" --secret-id "$secret_prefix/$suffix" \
    --output json | jq -cS . >> "$work/secrets.ndjson"
done
if typhoon="$(aws secretsmanager describe-secret --region "$region" \
    --secret-id "$secret_prefix/typhoon-ocr-api-key" --output json 2>"$work/typhoon.err")"; then
  jq -cS . <<< "$typhoon" >> "$work/secrets.ndjson"
elif ! grep -F ResourceNotFoundException "$work/typhoon.err" >/dev/null; then
  cat "$work/typhoon.err" >&2; exit 1
fi
jq -csS . "$work/secrets.ndjson" > "$secret_metadata"

# Secrets encrypted by the default Secrets Manager key omit KmsKeyId. Any explicit key must be
# AWS-managed and enabled; readiness never calls GetSecretValue.
while IFS= read -r key_id; do
  [ -n "$key_id" ] || continue
  key="$(aws kms describe-key --region "$region" --key-id "$key_id" --output json)"
  jq -e '.KeyMetadata.KeyManager=="AWS" and .KeyMetadata.KeyState=="Enabled"' <<< "$key" >/dev/null
  key_arn="$(jq -er '.KeyMetadata.Arn' <<< "$key")"
  jq --arg id "$key_id" --arg arn "$key_arn" '
    map(if (.KmsKeyId? // "")==$id then
      .+{_ReadinessKmsKeyArn:$arn,_ReadinessKmsKeyManager:"AWS",_ReadinessKmsKeyState:"Enabled"}
    else . end)' "$secret_metadata" > "$work/secrets.with-key.json"
  mv "$work/secrets.with-key.json" "$secret_metadata"
done < <(jq -r '.[].KmsKeyId? // empty' "$secret_metadata" | sort -u)
bash "$root/infra/security/validate-production-runtime-secret-inventory.sh" \
  "$secret_metadata" "$work/secret-inventory.json"
typhoon_enabled=false
typhoon_configuration_sha=null
if jq -e 'any(.[];.Name=="watchdog-bms/production/typhoon-ocr-api-key")' \
    "$secret_metadata" >/dev/null; then
  typhoon_enabled=true
  typhoon_configuration="$(jq -cnS --arg region "$TYPHOON_PROCESSING_REGION" \
    --arg regions "$APPROVED_AI_REGIONS" --arg providers "$APPROVED_AI_PROVIDERS" \
    '{processingRegion:$region,approvedRegions:$regions,approvedProviders:$providers}')"
  if command -v sha256sum >/dev/null 2>&1; then
    typhoon_configuration_sha="$(printf '%s' "$typhoon_configuration" | sha256sum | awk '{print $1}')"
  else
    typhoon_configuration_sha="$(printf '%s' "$typhoon_configuration" | shasum -a 256 | awk '{print $1}')"
  fi
  unset typhoon_configuration
fi

parameter_names=(ecs-express-api-web-service-arn ecs-express-api-web-url
  ecs-express-ai-gateway-service-arn ecs-express-ai-gateway-url ai-gateway-internal-url
  ecs-express-workers-service-arn ecs-express-workers-url s3-bucket erp-core-internal-url)
full_parameter_names=()
for name in "${parameter_names[@]}"; do full_parameter_names+=("$parameter_prefix/$name"); done
aws ssm get-parameters --region "$region" --names "${full_parameter_names[@]}" \
  --output json > "$work/parameters.json"
bash "$root/infra/security/validate-production-promotion-parameters.sh" \
  "$work/parameters.json" "$work/parameter-inventory.json"

aws ecs describe-clusters --region "$region" --clusters watchdog-bms-prod --output json \
  > "$work/cluster.json"
jq -e '(.failures|length)==0 and (.clusters|length)==1
  and .clusters[0].clusterArn=="arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod"
  and .clusters[0].status=="ACTIVE"' "$work/cluster.json" >/dev/null

aws ec2 describe-vpcs --region "$region" --filters Name=is-default,Values=true --output json \
  > "$work/vpc.json"
vpc_id="$(jq -er '.Vpcs|select(length==1)|.[0]|select(.State=="available")|.VpcId' "$work/vpc.json")"
aws ec2 describe-subnets --region "$region" --filters Name=vpc-id,Values="$vpc_id" --output json \
  > "$work/subnets.json"
jq -e '[.Subnets[]|select(.State=="available" and .MapPublicIpOnLaunch==true)]|length>=2' \
  "$work/subnets.json" >/dev/null
aws ec2 describe-security-groups --region "$region" --filters Name=vpc-id,Values="$vpc_id" \
  Name=group-name,Values=watchdog-bms-prod-app-egress-sg,watchdog-bms-prod-ai-egress-sg \
  --output json > "$work/security-groups.json"
jq -e '([.SecurityGroups[].GroupName]|sort)
  ==["watchdog-bms-prod-ai-egress-sg","watchdog-bms-prod-app-egress-sg"]' \
  "$work/security-groups.json" >/dev/null

bucket="watchdog-bms-prod-$account"
aws s3api get-bucket-location --bucket "$bucket" --region "$region" --output json \
  > "$work/bucket-location.json"
jq -e '.LocationConstraint=="ap-southeast-1"' "$work/bucket-location.json" >/dev/null
test "$(aws s3api get-bucket-versioning --bucket "$bucket" --region "$region" \
  --query Status --output text)" = Enabled
aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" --region "$region" \
  --output json | jq -cS '{Rules:(.Rules|sort_by(.ID))}' > "$work/lifecycle.json"
jq -cS '{Rules:(.Rules|sort_by(.ID))}' "$root/infra/object-storage-lifecycle.json" \
  > "$work/expected-lifecycle.json"
cmp -s "$work/lifecycle.json" "$work/expected-lifecycle.json" || {
  echo 'ERROR: Production S3 lifecycle differs from the deploy contract' >&2; exit 1;
}

aws logs describe-log-groups --region "$region" --log-group-name-prefix /ecs/watchdog-bms-prod \
  --output json > "$work/log-groups.json"
jq -e --arg kms "$LOG_KMS_KEY_ID" '
  ["/ecs/watchdog-bms-prod-ai-gateway","/ecs/watchdog-bms-prod-api-web","/ecs/watchdog-bms-prod-workers"]
  as $required
  | ([.logGroups[]|select(.logGroupName as $n|$required|index($n))|.logGroupName]|sort)==($required|sort)
  and all(.logGroups[]|select(.logGroupName as $n|$required|index($n));
    .retentionInDays==14 and .kmsKeyId==$kms)' "$work/log-groups.json" >/dev/null
log_key="$(aws kms describe-key --region "$region" --key-id "$LOG_KMS_KEY_ID" --output json)"
jq -e --arg arn "$LOG_KMS_KEY_ID" '.KeyMetadata.Arn==$arn and .KeyMetadata.Enabled==true
  and .KeyMetadata.KeyState=="Enabled"' <<< "$log_key" >/dev/null
topic="$(aws sns get-topic-attributes --region "$region" --topic-arn "$SECURITY_ALERT_TOPIC_ARN" \
  --output json)"
jq -e --arg arn "$SECURITY_ALERT_TOPIC_ARN" --arg account "$account" \
  '.Attributes.TopicArn==$arn and .Attributes.Owner==$account' <<< "$topic" >/dev/null

if command -v sha256sum >/dev/null 2>&1; then
  lifecycle_sha="$(sha256sum "$work/lifecycle.json" | awk '{print $1}')"
else
  lifecycle_sha="$(shasum -a 256 "$work/lifecycle.json" | awk '{print $1}')"
fi
jq -cnS \
  --slurpfile secrets "$work/secret-inventory.json" \
  --slurpfile parameters "$work/parameter-inventory.json" \
  --slurpfile cluster "$work/cluster.json" \
  --slurpfile vpc "$work/vpc.json" --slurpfile subnets "$work/subnets.json" \
  --slurpfile groups "$work/security-groups.json" \
  --arg bucket "$bucket" --arg lifecycleSha "$lifecycle_sha" \
  --arg logKms "$LOG_KMS_KEY_ID" --arg topic "$SECURITY_ALERT_TOPIC_ARN" \
  --argjson typhoonEnabled "$typhoon_enabled" --arg typhoonHash "$typhoon_configuration_sha" '
  {secrets:$secrets[0],
   typhoon:{enabled:$typhoonEnabled,
     configurationSha256:(if $typhoonEnabled then $typhoonHash else null end)},
   parameters:$parameters[0],
   ecs:{clusterArn:$cluster[0].clusters[0].clusterArn,status:"ACTIVE"},
   network:{defaultVpcId:$vpc[0].Vpcs[0].VpcId,
     publicSubnetIds:([$subnets[0].Subnets[]|select(.State=="available" and .MapPublicIpOnLaunch==true)|.SubnetId]|sort),
     securityGroups:([$groups[0].SecurityGroups[]|{name:.GroupName,id:.GroupId}]|sort_by(.name))},
   s3:{bucket:$bucket,region:"ap-southeast-1",versioning:"Enabled",lifecycleSha256:$lifecycleSha},
   monitoring:{logGroups:["/ecs/watchdog-bms-prod-ai-gateway","/ecs/watchdog-bms-prod-api-web","/ecs/watchdog-bms-prod-workers"],
     retentionDays:14,kmsKeyArn:$logKms,alertTopicArn:$topic}}' > "$output"
