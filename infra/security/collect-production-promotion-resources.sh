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
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
: "${AGENTCORE_CANDIDATE_BINDING:?AGENTCORE_CANDIDATE_BINDING is required}"
: "${LINE_AI_RELEASE_MANIFEST:?LINE_AI_RELEASE_MANIFEST is required}"
bash "$root/infra/ai-gateway/validate-agentcore-candidate-binding.sh" \
  "$AGENTCORE_CANDIDATE_BINDING" "$LINE_AI_RELEASE_MANIFEST" production >/dev/null
agentcore_runtime_arn="$(jq -er '.runtime.arn' "$AGENTCORE_CANDIDATE_BINDING")"
agentcore_runtime_version="$(jq -er '.runtime.version' "$AGENTCORE_CANDIDATE_BINDING")"
agentcore_endpoint_name="$(jq -er '.endpoint.name' "$AGENTCORE_CANDIDATE_BINDING")"
agentcore_execution_role_arn="$(jq -er '.executionRoleArn' "$AGENTCORE_CANDIDATE_BINDING")"
agentcore_approved_source="$(jq -er '.sourceCommit' "$AGENTCORE_CANDIDATE_BINDING")"
agentcore_artifact_sha="$(jq -er '.artifact.sha256' "$AGENTCORE_CANDIDATE_BINDING")"
managed_secret_kms_key_arn=arn:aws:kms:ap-southeast-1:311414082667:key/b2e68e7f-e098-4b88-a92a-5a0f4fe2924a
snapshot_kms_key_arn=arn:aws:kms:ap-southeast-1:311414082667:key/52b4943e-e9d7-4fae-b71c-c13b0b157b27
parameter_prefix=/watchdog-bms/production
secret_prefix=watchdog-bms/production
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

aws rds describe-orderable-db-instance-options --region "$region" --engine postgres \
  --engine-version 18.3 --db-instance-class db.t4g.medium --output json \
  > "$work/orderable-db-options.json"
jq -e '[.OrderableDBInstanceOptions[]|select(
  .Engine=="postgres" and .EngineVersion=="18.3" and .DBInstanceClass=="db.t4g.medium"
  and .Vpc==true and .SupportsStorageEncryption==true and .MultiAZCapable==true)]|length>=1' \
  "$work/orderable-db-options.json" >/dev/null
aws rds describe-account-attributes --region "$region" --output json \
  > "$work/rds-account-attributes.json"
jq -e '[.AccountQuotas[]|select(.AccountQuotaName=="DBInstances")]
  |length==1 and .[0].Max>0 and .[0].Used>=0 and (.[0].Used+1)<=.[0].Max' \
  "$work/rds-account-attributes.json" >/dev/null

aws rds describe-db-instances --region "$region" --db-instance-identifier watchdog-bms-prod-db \
  --output json > "$work/source-db.json"
source_db_groups="$(jq -cer '.DBInstances|select(length==1)|.[0]
  |select(.DBInstanceIdentifier=="watchdog-bms-prod-db"
    and .DBInstanceArn=="arn:aws:rds:ap-southeast-1:311414082667:db:watchdog-bms-prod-db"
    and .Engine=="postgres" and .EngineVersion=="18.3")
  | {subnet:.DBSubnetGroup.DBSubnetGroupName,
     parameter:(.DBParameterGroups|select(length==1)|.[0]
       |select(.ParameterApplyStatus=="in-sync")|.DBParameterGroupName),
     option:(.OptionGroupMemberships|select(length==1)|.[0]
       |select(.Status=="in-sync")|.OptionGroupName)}
  |select(all(.[];type=="string" and length>0))' "$work/source-db.json")"
source_subnet_group="$(jq -r .subnet <<< "$source_db_groups")"
source_parameter_group="$(jq -r .parameter <<< "$source_db_groups")"
source_option_group="$(jq -r .option <<< "$source_db_groups")"
aws rds describe-db-subnet-groups --region "$region" \
  --db-subnet-group-name "$source_subnet_group" --output json > "$work/source-subnet-group.json"
aws rds describe-db-parameter-groups --region "$region" \
  --db-parameter-group-name "$source_parameter_group" --output json > "$work/source-parameter-group.json"
aws rds describe-option-groups --region "$region" \
  --option-group-name "$source_option_group" --output json > "$work/source-option-group.json"
jq -e --arg name "$source_subnet_group" --arg account "$account" '
  .DBSubnetGroups|length==1 and .[0].DBSubnetGroupName==$name and .[0].SubnetGroupStatus=="Complete"
  and .[0].DBSubnetGroupArn==("arn:aws:rds:ap-southeast-1:"+$account+":subgrp:"+$name)' \
  "$work/source-subnet-group.json" >/dev/null
jq -e --arg name "$source_parameter_group" --arg account "$account" '
  .DBParameterGroups|length==1 and .[0].DBParameterGroupName==$name
  and .[0].DBParameterGroupFamily=="postgres18"
  and .[0].DBParameterGroupArn==("arn:aws:rds:ap-southeast-1:"+$account+":pg:"+$name)' \
  "$work/source-parameter-group.json" >/dev/null
jq -e --arg name "$source_option_group" --arg account "$account" '
  .OptionGroupsList|length==1 and .[0].OptionGroupName==$name
  and .[0].EngineName=="postgres" and .[0].MajorEngineVersion=="18"
  and .[0].OptionGroupArn==("arn:aws:rds:ap-southeast-1:"+$account+":og:"+$name)' \
  "$work/source-option-group.json" >/dev/null

aws rds describe-db-snapshots --region "$region" --db-instance-identifier watchdog-bms-prod-db \
  --snapshot-type automated --output json > "$work/source-snapshots.json"
recent_snapshot="$(jq -cer --arg kms "$snapshot_kms_key_arn" '[.DBSnapshots[]|select(
  .DBInstanceIdentifier=="watchdog-bms-prod-db" and .SnapshotType=="automated"
  and (.DBSnapshotArn
    |startswith("arn:aws:rds:ap-southeast-1:311414082667:snapshot:rds:watchdog-bms-prod-db-"))
  and .Status=="available" and .Encrypted==true and .KmsKeyId==$kms)]
  |sort_by(.SnapshotCreateTime)|last' \
  "$work/source-snapshots.json")"
recent_snapshot_epoch="$(jq -er '.SnapshotCreateTime
  |sub("\\.[0-9]+\\+00:00$";"Z")|sub("\\+00:00$";"Z")|sub("\\.[0-9]+Z$";"Z")
  |fromdateiso8601' <<< "$recent_snapshot")"
snapshot_age_seconds="$(( $(date -u +%s) - recent_snapshot_epoch ))"
[ "$snapshot_age_seconds" -ge 0 ] && [ "$snapshot_age_seconds" -le 129600 ]
aws kms describe-key --region "$region" --key-id alias/aws/rds --output json \
  > "$work/snapshot-kms-key.json"
jq -e --arg arn "$snapshot_kms_key_arn" '
  .KeyMetadata.Arn==$arn and .KeyMetadata.Enabled==true and .KeyMetadata.KeyState=="Enabled"
  and .KeyMetadata.KeyManager=="AWS" and .KeyMetadata.KeyUsage=="ENCRYPT_DECRYPT"
  and .KeyMetadata.Origin=="AWS_KMS"' "$work/snapshot-kms-key.json" >/dev/null
aws kms describe-key --region "$region" --key-id alias/aws/secretsmanager --output json \
  > "$work/managed-secret-kms-key.json"
jq -e --arg arn "$managed_secret_kms_key_arn" '
  .KeyMetadata.Arn==$arn and .KeyMetadata.Enabled==true and .KeyMetadata.KeyState=="Enabled"
  and .KeyMetadata.KeyManager=="AWS" and .KeyMetadata.KeyUsage=="ENCRYPT_DECRYPT"' \
  "$work/managed-secret-kms-key.json" >/dev/null

agentcore_runtime_id="${agentcore_runtime_arn##*/}"
[[ "$agentcore_runtime_id" =~ ^[a-zA-Z][a-zA-Z0-9_]{0,99}-[a-zA-Z0-9]{10}$ ]]
aws bedrock-agentcore-control get-agent-runtime --region "$region" \
  --agent-runtime-id "$agentcore_runtime_id" --agent-runtime-version "$agentcore_runtime_version" \
  --output json > "$work/agentcore-runtime.json"
aws bedrock-agentcore-control get-agent-runtime-endpoint --region "$region" \
  --agent-runtime-id "$agentcore_runtime_id" --endpoint-name "$agentcore_endpoint_name" \
  --output json > "$work/agentcore-endpoint.json"
jq -e --arg arn "$agentcore_runtime_arn" --arg id "$agentcore_runtime_id" \
  --arg role "$agentcore_execution_role_arn" --arg source "$agentcore_approved_source" \
  --arg artifactSha "$agentcore_artifact_sha" \
  --slurpfile binding "$AGENTCORE_CANDIDATE_BINDING" '
  .agentRuntimeArn==$arn and .agentRuntimeId==$id and .status=="READY"
  and .agentRuntimeVersion==$binding[0].runtime.version
  and .networkConfiguration.networkMode=="PUBLIC"
  and (.agentRuntimeArtifact.codeConfiguration as $code
    | $code.runtime=="NODE_22" and $code.entryPoint==["runtime.js"]
    and $code.code.s3.bucket==$binding[0].artifact.bucket
    and $code.code.s3.prefix==$binding[0].artifact.prefix
    and $code.code.s3.versionId==$binding[0].artifact.objectVersionId)
  and .protocolConfiguration.serverProtocol=="HTTP"
  and .metadataConfiguration.requireMMDSV2==true
  and .roleArn==$role
  and .environmentVariables.APP_ENV=="production"
  and .environmentVariables.DEPLOY_ENVIRONMENT=="production"
  and .environmentVariables.GIT_SHA==$source
  and .environmentVariables.AGENTCORE_ARTIFACT_SHA256==$artifactSha' \
  "$work/agentcore-runtime.json" >/dev/null
jq -e --arg arn "$agentcore_runtime_arn" --arg name "$agentcore_endpoint_name" \
  --arg version "$agentcore_runtime_version" '
  .agentRuntimeArn==$arn and .name==$name and .status=="READY"
  and .targetVersion==$version and .liveVersion==$version
  and .agentRuntimeEndpointArn==($arn+"/runtime-endpoint/"+$name)
' "$work/agentcore-endpoint.json" >/dev/null

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
  --arg agentcoreArn "$agentcore_runtime_arn" --arg agentcoreRole "$agentcore_execution_role_arn" \
  --arg agentcoreSource "$agentcore_approved_source" --arg agentcoreArtifactSha "$agentcore_artifact_sha" \
  --arg agentcoreEndpointName "$agentcore_endpoint_name" \
  --arg managedSecretKms "$managed_secret_kms_key_arn" \
  --arg snapshotKms "$snapshot_kms_key_arn" \
  --arg snapshotArn "$(jq -er .DBSnapshotArn <<< "$recent_snapshot")" \
  --arg snapshotTime "$(jq -er .SnapshotCreateTime <<< "$recent_snapshot")" \
  --argjson snapshotAge "$snapshot_age_seconds" \
  --slurpfile agentcore "$work/agentcore-runtime.json" \
  --slurpfile agentcoreEndpoint "$work/agentcore-endpoint.json" \
  --slurpfile agentcoreBinding "$AGENTCORE_CANDIDATE_BINDING" \
  --slurpfile rdsOptions "$work/orderable-db-options.json" \
  --slurpfile rdsQuotas "$work/rds-account-attributes.json" \
  --arg sourceSubnetGroup "$source_subnet_group" \
  --arg sourceParameterGroup "$source_parameter_group" \
  --arg sourceOptionGroup "$source_option_group" \
  --argjson typhoonEnabled "$typhoon_enabled" --arg typhoonHash "$typhoon_configuration_sha" '
  ($rdsQuotas[0].AccountQuotas[]|select(.AccountQuotaName=="DBInstances")) as $dbQuota
  | {secrets:$secrets[0],
   typhoon:{enabled:$typhoonEnabled,
     configurationSha256:(if $typhoonEnabled then $typhoonHash else null end)},
   parameters:$parameters[0],
   ecs:{clusterArn:$cluster[0].clusters[0].clusterArn,status:"ACTIVE"},
   network:{defaultVpcId:$vpc[0].Vpcs[0].VpcId,
     publicSubnetIds:([$subnets[0].Subnets[]|select(.State=="available" and .MapPublicIpOnLaunch==true)|.SubnetId]|sort),
     securityGroups:([$groups[0].SecurityGroups[]|{name:.GroupName,id:.GroupId}]|sort_by(.name))},
   s3:{bucket:$bucket,region:"ap-southeast-1",versioning:"Enabled",lifecycleSha256:$lifecycleSha},
   rdsCapacity:{engine:"postgres",engineVersion:"18.3",dbInstanceClass:"db.t4g.medium",
     orderableOptionCount:([$rdsOptions[0].OrderableDBInstanceOptions[]|select(
       .Engine=="postgres" and .EngineVersion=="18.3" and .DBInstanceClass=="db.t4g.medium"
       and .Vpc==true and .SupportsStorageEncryption==true and .MultiAZCapable==true)]|length),
     quotaName:"DBInstances",quotaMax:$dbQuota.Max,quotaUsed:$dbQuota.Used,
     quotaHeadroom:($dbQuota.Max-$dbQuota.Used),sourceDbSubnetGroup:$sourceSubnetGroup,
     sourceDbParameterGroup:$sourceParameterGroup,sourceDbOptionGroup:$sourceOptionGroup,
     recentEncryptedAutomatedSnapshotAvailable:true,snapshotMaxAgeSeconds:129600,
     recentAutomatedSnapshotArn:$snapshotArn,recentAutomatedSnapshotCreateTime:$snapshotTime,
     recentAutomatedSnapshotAgeSeconds:$snapshotAge,
     snapshotKmsKeyArn:$snapshotKms,
     managedSecretKmsKeyArn:$managedSecretKms},
   agentCore:{runtimeArn:$agentcoreArn,runtimeId:$agentcore[0].agentRuntimeId,
     runtimeVersion:$agentcore[0].agentRuntimeVersion,status:"READY",
     networkMode:"PUBLIC",artifactRuntime:"NODE_22",serverProtocol:"HTTP",
     appEnv:"production",deployEnvironment:"production",requireMMDSV2:true,
     executionRoleArn:$agentcoreRole,gitSha:$agentcoreSource,
     artifactSha256:$agentcoreArtifactSha,
     artifactBucket:$agentcore[0].agentRuntimeArtifact.codeConfiguration.code.s3.bucket,
     artifactPrefix:$agentcore[0].agentRuntimeArtifact.codeConfiguration.code.s3.prefix,
     artifactVersionId:$agentcore[0].agentRuntimeArtifact.codeConfiguration.code.s3.versionId,
     entryPoint:$agentcore[0].agentRuntimeArtifact.codeConfiguration.entryPoint,
     endpointArn:$agentcoreEndpoint[0].agentRuntimeEndpointArn,
     endpointName:$agentcoreEndpointName,endpointStatus:"READY",
     endpointVersion:$agentcoreEndpoint[0].liveVersion,
     bindingStrategy:$agentcoreBinding[0].bindingStrategy,
     configurationSha256:$agentcoreBinding[0].configurationSha256,
     contractVersion:$agentcoreBinding[0].contractVersion},
   monitoring:{logGroups:["/ecs/watchdog-bms-prod-ai-gateway","/ecs/watchdog-bms-prod-api-web","/ecs/watchdog-bms-prod-workers"],
     retentionDays:14,kmsKeyArn:$logKms,alertTopicArn:$topic}}' > "$output"
