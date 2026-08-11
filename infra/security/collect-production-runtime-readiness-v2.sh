#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <redis-replication-group-id> <output.json>" >&2
  exit 2
fi
redis_id="$1" output="$2"
[[ "$redis_id" =~ ^[a-z][a-z0-9-]{0,39}$ ]]
[ ! -e "$output" ]
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
region=ap-southeast-1
account=311414082667
role=watchdog-bms-production-security-readonly
test "$(aws sts get-caller-identity --region "$region" --query Account --output text)" = "$account"
identity="$(aws sts get-caller-identity --region "$region" --query Arn --output text)"
[[ "$identity" =~ :assumed-role/watchdog-bms-production-security-readonly/ ]]

work="$(mktemp -d "${TMPDIR:-/tmp}/production-runtime-readiness.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
sha_json() {
  if command -v sha256sum >/dev/null 2>&1; then jq -cjS . "$1" | sha256sum | awk '{print $1}'
  else jq -cjS . "$1" | shasum -a 256 | awk '{print $1}'; fi
}
role_json="$work/role.json"; policy_json="$work/policy.json"
aws iam get-role --role-name "$role" --output json | jq -cS . > "$role_json"
aws iam get-role-policy --role-name "$role" --policy-name "$role" --output json | jq -cS . > "$policy_json"
test "$(aws iam list-role-policies --role-name "$role" --output json | jq -cS '.PolicyNames|sort')" \
  = "$(jq -cnS --arg role "$role" '[$role]')"
test "$(aws iam list-attached-role-policies --role-name "$role" --output json | jq -cS '.AttachedPolicies')" = '[]'
jq -e --slurpfile trust "$root/infra/security/production-security-readonly-trust.template.json" '
  .Role.AssumeRolePolicyDocument==$trust[0]
' "$role_json" >/dev/null
jq -e --arg role "$role" --slurpfile expected "$root/infra/security/production-security-readonly-policy.template.json" '
  .PolicyName==$role and .PolicyDocument==$expected[0]
' "$policy_json" >/dev/null
policy_hash="$(jq -cnS --slurpfile role "$role_json" --slurpfile policy "$policy_json" \
  '{trust:$role[0].Role.AssumeRolePolicyDocument,policy:$policy[0].PolicyDocument}' | {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
    else shasum -a 256 | awk '{print $1}'; fi
  })"

rds="$work/rds.json"; redis="$work/redis.json"; primary="$work/primary.json"
aws rds describe-db-instances --region "$region" --db-instance-identifier watchdog-bms-prod-db \
  --output json | jq -cS . > "$rds"
aws elasticache describe-replication-groups --region "$region" --replication-group-id "$redis_id" \
  --output json | jq -cS . > "$redis"
primary_id="$(jq -er '[.ReplicationGroups[0].NodeGroups[].NodeGroupMembers[]
  |select(.CurrentRole=="primary")|.CacheClusterId]|select(length==1)|.[0]' "$redis")"
aws elasticache describe-cache-clusters --region "$region" --cache-cluster-id "$primary_id" \
  --output json | jq -cS . > "$primary"
now="$(date -u +%s)"
jq -cnS --argjson now "$now" --arg security "$policy_hash" --arg redisId "$redis_id" \
  --slurpfile rds "$rds" --arg rdsHash "$(sha_json "$rds")" \
  --slurpfile redis "$redis" --arg redisHash "$(sha_json "$redis")" \
  --slurpfile primary "$primary" --arg primaryHash "$(sha_json "$primary")" '
  ($rds[0].DBInstances|select(length==1)|.[0]) as $db
  | ($redis[0].ReplicationGroups|select(length==1)|.[0]) as $rg
  | ($primary[0].CacheClusters|select(length==1)|.[0]) as $node
  | {schemaVersion:2,observedAtEpoch:$now,securityPolicySha256:$security,
     a5PolicySha256:null,clonePolicySha256:null,
     rds:{identifier:$db.DBInstanceIdentifier,status:$db.DBInstanceStatus,
       storageEncrypted:$db.StorageEncrypted,multiAZ:$db.MultiAZ,
       deletionProtection:$db.DeletionProtection,backupRetentionDays:$db.BackupRetentionPeriod,
       rawSha256:$rdsHash},
     redis:{replicationGroupId:$rg.ReplicationGroupId,status:$rg.Status,
       atRestEncryptionEnabled:$rg.AtRestEncryptionEnabled,
       transitEncryptionEnabled:$rg.TransitEncryptionEnabled,
       authTokenEnabled:$rg.AuthTokenEnabled,automaticFailover:$rg.AutomaticFailover,
       nodeCount:([$rg.NodeGroups[].NodeGroupMembers[]]|length),
       snapshotRetentionDays:$rg.SnapshotRetentionLimit,engine:$node.Engine,
       rawReplicationGroupSha256:$redisHash,rawPrimarySha256:$primaryHash}}
' > "$output"
jq -e --arg redis "$redis_id" '
  .rds.identifier=="watchdog-bms-prod-db" and .rds.status=="available"
  and .rds.storageEncrypted==true and .rds.multiAZ==true and .rds.deletionProtection==true
  and .rds.backupRetentionDays>=35 and .redis.replicationGroupId==$redis
  and .redis.status=="available" and .redis.engine=="redis"
  and .redis.atRestEncryptionEnabled==true and .redis.transitEncryptionEnabled==true
  and .redis.authTokenEnabled==true and .redis.automaticFailover=="enabled"
  and .redis.nodeCount>=2 and .redis.snapshotRetentionDays>=35
' "$output" >/dev/null
