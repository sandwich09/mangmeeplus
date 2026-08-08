#!/usr/bin/env bash
set -euo pipefail

# Production data-plane bootstrap - closes blockers B1/B2 in
# docs/plans/production-golive-and-support-access-plan.md
#
#   1. Creates the production Redis replication group that M-17 requires and that was deleted on
#      2026-08-07 (two nodes, encrypted at rest and in transit, auth token, automatic failover,
#      35-day snapshots, noeviction).
#   2. Repoints watchdog-bms/production/redis-url, which still holds the deleted endpoint. Without
#      this every api-web and workers container starts and then fails to reach Redis.
#   3. Optionally applies the RDS hardening M-17 requires, behind an explicit confirmation because
#      it causes a real failover.
#   4. Re-reads everything and asserts the exact conditions
#      infra/security/verify-production-security-baseline.sh checks, so a run that reports success
#      means the baseline verifier will agree rather than "the AWS calls returned 0".
#
# Idempotent. Creates nothing that already exists and never deletes anything.
#
#   CONFIRM_PRODUCTION_COST=CREATE_PRODUCTION_REDIS \
#     bash infra/production/bootstrap-data.sh
#
#   # additionally apply the RDS changes (causes a failover - do this before there are users):
#   CONFIRM_PRODUCTION_COST=CREATE_PRODUCTION_REDIS \
#   CONFIRM_PRODUCTION_RDS_HARDENING=APPLY \
#     bash infra/production/bootstrap-data.sh
#
# Forked from infra/uat/bootstrap-data.sh. The differences are all M-17 availability requirements
# that UAT deliberately does not pay for: two nodes, failover, and snapshot retention.

if [ "${CONFIRM_PRODUCTION_COST:-}" != "CREATE_PRODUCTION_REDIS" ]; then
  echo "ERROR: set CONFIRM_PRODUCTION_COST=CREATE_PRODUCTION_REDIS after approving the two-node" >&2
  echo "       production Redis cost (~\$26/month). See plan D3." >&2
  exit 2
fi

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
expected_account="311414082667"

prefix="watchdog-bms-prod"
secret_prefix="watchdog-bms/production"
db_id="${prefix}-db"
redis_id="${prefix}-redis"
redis_secret="${secret_prefix}/redis-url"
redis_param_group="${prefix}-redis7"
redis_subnet_group="${prefix}-redis-subnets"

redis_auth=""
cleanup() { unset redis_auth; }
trap cleanup EXIT

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    "$aws_bin" "$@"
}

command -v jq >/dev/null 2>&1 || { echo 'ERROR: jq is required' >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo 'ERROR: openssl is required' >&2; exit 1; }

account_id="$(aws_cmd sts get-caller-identity --query Account --output text --region "$region")"
# The security baseline hard-codes this account and region into the ARNs it validates, so a run
# against anything else would build resources that can never satisfy it.
[ "$account_id" = "$expected_account" ] \
  || { echo "ERROR: expected account ${expected_account}, got ${account_id}" >&2; exit 1; }
[ "$region" = ap-southeast-1 ] \
  || { echo "ERROR: production lives in ap-southeast-1, got ${region}" >&2; exit 1; }

say() { printf '[prod-bootstrap] %s\n' "$1"; }

# ---------------------------------------------------------------------------
# Network - reuse what production already has; never invent a second copy
# ---------------------------------------------------------------------------

vpc_id="$(aws_cmd ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text --region "$region")"
[ "$vpc_id" != "None" ] || { echo 'ERROR: cannot resolve the default VPC' >&2; exit 1; }

subnets="$(aws_cmd ec2 describe-subnets \
  --filters "Name=tag:Name,Values=${prefix}-app-private-a,${prefix}-app-private-b" \
    "Name=vpc-id,Values=${vpc_id}" \
  --query 'Subnets[].SubnetId' --output text --region "$region")"
[ "$(wc -w <<< "$subnets")" -eq 2 ] \
  || { echo 'ERROR: expected the existing two private application subnets' >&2; exit 1; }

# Two subnets in two AZs is not a style preference here: automatic failover requires the replica to
# sit in a different AZ from the primary, and ElastiCache picks AZs from the subnet group.
azs="$(aws_cmd ec2 describe-subnets --subnet-ids $subnets \
  --query 'Subnets[].AvailabilityZone' --output text --region "$region" | tr '\t' '\n' | sort -u | wc -l)"
[ "$azs" -ge 2 ] \
  || { echo 'ERROR: the private subnets share one AZ; automatic failover needs two' >&2; exit 1; }

ensure_security_group() {
  local name="$1" description="$2" id
  id="$(aws_cmd ec2 describe-security-groups \
    --filters "Name=group-name,Values=${name}" "Name=vpc-id,Values=${vpc_id}" \
    --query 'SecurityGroups[0].GroupId' --output text --region "$region")"
  if [ "$id" = "None" ]; then
    id="$(aws_cmd ec2 create-security-group --group-name "$name" --description "$description" \
      --vpc-id "$vpc_id" --query GroupId --output text --region "$region")"
  fi
  printf '%s' "$id"
}

app_sg="$(ensure_security_group "${prefix}-app-egress-sg" 'WatchDog BMS production application egress')"
redis_sg="$(ensure_security_group "${prefix}-redis-sg" 'WatchDog BMS production Redis')"

# authorize is not idempotent - it errors on an existing rule - so the failure is swallowed and the
# rule is then verified for real below. Swallowing without verifying would hide a missing rule.
aws_cmd ec2 authorize-security-group-ingress --group-id "$redis_sg" \
  --protocol tcp --port 6379 --source-group "$app_sg" --region "$region" >/dev/null 2>&1 || true
aws_cmd ec2 describe-security-groups --group-ids "$redis_sg" --output json --region "$region" \
  | jq -e --arg app_sg "$app_sg" \
    'any(.SecurityGroups[0].IpPermissions[]?;
       .FromPort == 6379 and .ToPort == 6379
       and any(.UserIdGroupPairs[]?; .GroupId == $app_sg))' >/dev/null \
  || { echo 'ERROR: Redis security group does not accept 6379 from the application group' >&2; exit 1; }

if ! aws_cmd elasticache describe-cache-subnet-groups \
    --cache-subnet-group-name "$redis_subnet_group" --region "$region" >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  aws_cmd elasticache create-cache-subnet-group \
    --cache-subnet-group-name "$redis_subnet_group" \
    --cache-subnet-group-description 'WatchDog BMS production Redis subnets' \
    --subnet-ids $subnets --region "$region" >/dev/null
  say "created cache subnet group ${redis_subnet_group}"
fi

# ---------------------------------------------------------------------------
# Redis parameter group - noeviction
# ---------------------------------------------------------------------------

# default.redis7 ships maxmemory-policy=volatile-lru and cannot be edited. That policy evicts only
# keys carrying a TTL, which in this system means the rate-limit counters and the actor-delegation
# replay store, while the untagged BullMQ job records that actually fill the node are never
# candidates. On 2026-08-05 that combination discarded security state in UAT and then OOM'd every
# worker anyway. Point the group at noeviction before the node exists, not after.
if ! aws_cmd elasticache describe-cache-parameter-groups \
    --cache-parameter-group-name "$redis_param_group" --region "$region" >/dev/null 2>&1; then
  aws_cmd elasticache create-cache-parameter-group \
    --cache-parameter-group-name "$redis_param_group" \
    --cache-parameter-group-family redis7 \
    --description 'WatchDog BMS production Redis: noeviction for BullMQ' \
    --region "$region" >/dev/null
  say "created parameter group ${redis_param_group}"
fi
aws_cmd elasticache modify-cache-parameter-group \
  --cache-parameter-group-name "$redis_param_group" \
  --parameter-name-values ParameterName=maxmemory-policy,ParameterValue=noeviction \
  --region "$region" >/dev/null 2>&1 || true
aws_cmd elasticache describe-cache-parameters --cache-parameter-group-name "$redis_param_group" \
  --region "$region" \
  | jq -e 'any(.Parameters[]?; .ParameterName == "maxmemory-policy" and .ParameterValue == "noeviction")' \
    >/dev/null \
  || { echo "ERROR: ${redis_param_group} is not set to noeviction" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Redis replication group
# ---------------------------------------------------------------------------

if ! aws_cmd elasticache describe-replication-groups \
    --replication-group-id "$redis_id" --region "$region" >/dev/null 2>&1; then
  # Auth-token characters: ElastiCache rejects '/', '@' and '"', and the token also travels inside
  # a URL userinfo field, so '+', '=' and whitespace are stripped as well rather than escaped.
  redis_auth="$(openssl rand -base64 64 | tr -d '/@"+= \n' | cut -c1-48)"
  [ "${#redis_auth}" -ge 32 ] \
    || { echo 'ERROR: generated Redis auth token is too short' >&2; exit 1; }

  # --engine redis is explicit: ElastiCache has begun defaulting new groups to Valkey, and the
  # baseline verifier asserts engine == "redis" exactly.
  #
  # --num-cache-clusters 2 produces one node group with two members, which is what the verifier
  # counts as nodeCount. --automatic-failover-enabled and --multi-az-enabled must both be present;
  # failover alone is not accepted when the group spans one AZ.
  aws_cmd elasticache create-replication-group \
    --replication-group-id "$redis_id" \
    --replication-group-description 'WatchDog BMS production Redis' \
    --engine redis \
    --engine-version 7.1 \
    --cache-node-type cache.t4g.micro \
    --num-cache-clusters 2 \
    --automatic-failover-enabled \
    --multi-az-enabled \
    --snapshot-retention-limit 35 \
    --cache-parameter-group-name "$redis_param_group" \
    --cache-subnet-group-name "$redis_subnet_group" \
    --security-group-ids "$redis_sg" \
    --at-rest-encryption-enabled \
    --transit-encryption-enabled \
    --auth-token "$redis_auth" \
    --region "$region" >/dev/null
  say "creating ${redis_id} (two nodes, encrypted, 35-day snapshots) - this takes several minutes"
  aws_cmd elasticache wait replication-group-available \
    --replication-group-id "$redis_id" --region "$region"

  redis_host="$(aws_cmd elasticache describe-replication-groups --replication-group-id "$redis_id" \
    --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' --output text --region "$region")"

  # rediss:// plus the token in the userinfo field: ioredis turns TLS on from the scheme and reads
  # the password from the URL, so nothing in the application changes because encryption is on.
  redis_url="rediss://:${redis_auth}@${redis_host}:6379"

  # put-secret-value rather than delete + create. The secret ARN is embedded in every task
  # definition's valueFrom, and a new ARN would silently strip Redis from the containers until the
  # next full deploy. Deleting would also reserve the name for 7-30 days without
  # --force-delete-without-recovery.
  if aws_cmd secretsmanager describe-secret --secret-id "$redis_secret" --region "$region" >/dev/null 2>&1; then
    aws_cmd secretsmanager put-secret-value --secret-id "$redis_secret" \
      --secret-string "$redis_url" --region "$region" >/dev/null
    say "repointed ${redis_secret} at the new endpoint (ARN unchanged)"
  else
    aws_cmd secretsmanager create-secret --name "$redis_secret" \
      --secret-string "$redis_url" --region "$region" >/dev/null
    say "created ${redis_secret}"
  fi
  unset redis_url redis_auth
else
  say "${redis_id} already exists; leaving it and its secret untouched"
  aws_cmd secretsmanager describe-secret --secret-id "$redis_secret" --region "$region" >/dev/null 2>&1 \
    || { echo "ERROR: ${redis_id} exists but ${redis_secret} does not; reconcile explicitly" >&2; exit 1; }

  # An existing group is not assumed to be correct, but it is also not silently mutated: the
  # endpoint inside the secret cannot be read back and compared without exposing the token, so the
  # operator is told to check rather than the script guessing.
  say "NOTE: verify by hand that ${redis_secret} holds this group's current primary endpoint"

  # Snapshot retention is the one M-17 property that can drift on an existing group and be repaired
  # in place without touching data, keys or endpoints. Everything else the baseline requires
  # (encryption, auth token, node count, failover) is fixed at creation time, so this branch
  # deliberately repairs only this field rather than pretending it can reconcile the rest.
  # Read it from the replication group, which is where the setting actually lives. The per-member
  # value only appears on SnapshottingClusterId, which ElastiCache defaults to a replica.
  current_retention="$(aws_cmd elasticache describe-replication-groups --replication-group-id "$redis_id" \
    --query 'ReplicationGroups[0].SnapshotRetentionLimit' --output text --region "$region" 2>/dev/null || echo 0)"
  [ "$current_retention" = "None" ] && current_retention=0
  if [ "${current_retention:-0}" -lt 35 ]; then
    say "snapshot retention is ${current_retention}; raising it to 35"
    if aws_cmd elasticache modify-replication-group --replication-group-id "$redis_id" \
        --snapshot-retention-limit 35 --apply-immediately --region "$region" >/dev/null; then
      aws_cmd elasticache wait replication-group-available \
        --replication-group-id "$redis_id" --region "$region"
      say 'snapshot retention updated'
    else
      say 'could not raise snapshot retention (see the AWS error above)'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# RDS hardening (M-17) - verified always, applied only on explicit request
# ---------------------------------------------------------------------------

rds_json="$(aws_cmd rds describe-db-instances --db-instance-identifier "$db_id" \
  --query 'DBInstances[0]' --output json --region "$region")"

rds_gaps="$(jq -r '
  [ (if .StorageEncrypted != true      then "storage not encrypted (cannot be fixed in place)" else empty end)
  , (if .MultiAZ != true               then "not Multi-AZ" else empty end)
  , (if .DeletionProtection != true    then "deletion protection off" else empty end)
  , (if .BackupRetentionPeriod < 35    then "backup retention \(.BackupRetentionPeriod) < 35" else empty end)
  , (if .StorageType != "gp3"          then "storage type \(.StorageType) is not gp3" else empty end)
  , (if .IAMDatabaseAuthenticationEnabled != true then "IAM database auth off (needed by support roles)" else empty end)
  ] | join("; ")' <<< "$rds_json")"

if [ -n "$rds_gaps" ]; then
  if [ "${CONFIRM_PRODUCTION_RDS_HARDENING:-}" = "APPLY" ]; then
    say "applying RDS hardening: ${rds_gaps}"
    # One modify-db-instance rather than several: each call that changes instance class or Multi-AZ
    # costs a failover, and there is no reason to pay for four of them.
    #
    # A failure here must not abort the run. The Redis work above is already committed, and killing
    # the script before the verification block would leave the operator with no confirmation that
    # the part which DID succeed is correct. rds:ModifyDBInstance is also a plausible deliberate
    # guardrail on an automation principal, so being denied is an expected outcome, not a crash.
    if aws_cmd rds modify-db-instance --db-instance-identifier "$db_id" \
        --db-instance-class "${PRODUCTION_DB_INSTANCE_CLASS:-db.t4g.small}" \
        --storage-type gp3 \
        --multi-az \
        --backup-retention-period 35 \
        --deletion-protection \
        --enable-iam-database-authentication \
        --apply-immediately --region "$region" >/dev/null; then
      say 'waiting for RDS to return to available (the failover takes a few minutes)'
      aws_cmd rds wait db-instance-available --db-instance-identifier "$db_id" --region "$region"
    else
      say 'RDS hardening was REFUSED (see the AWS error above).'
      say 'If it is an explicit deny, do not weaken the policy - apply the change from the RDS'
      say 'Console with human credentials instead. Redis work above is unaffected.'
    fi
  else
    say "RDS does NOT meet the M-17 baseline: ${rds_gaps}"
    say 'rerun with CONFIRM_PRODUCTION_RDS_HARDENING=APPLY to fix it, or apply the documented'
    say 'modify-db-instance from the plan by hand. Redis work above is already done.'
  fi
fi

# ---------------------------------------------------------------------------
# Verify against the exact baseline assertions, not against "the calls succeeded"
# ---------------------------------------------------------------------------

say 'verifying against the M-17 baseline assertions'

rg="$(aws_cmd elasticache describe-replication-groups --replication-group-id "$redis_id" \
  --query 'ReplicationGroups[0]' --output json --region "$region")"
primary_id="$(jq -r '.NodeGroups[0].NodeGroupMembers[]
  | select(.CurrentRole == "primary" or .CurrentRole == null) | .CacheClusterId' <<< "$rg" | head -1)"
primary="$(aws_cmd elasticache describe-cache-clusters --cache-cluster-id "$primary_id" \
  --query 'CacheClusters[0]' --output json --region "$region")"

redis_failures="$(jq -rn --argjson rg "$rg" --argjson c "$primary" '
  [ (if $c.Engine != "redis"                    then "engine is \($c.Engine), not redis" else empty end)
  , (if $rg.Status != "available"               then "status \($rg.Status)" else empty end)
  , (if $rg.AtRestEncryptionEnabled != true     then "at-rest encryption off" else empty end)
  , (if $rg.TransitEncryptionEnabled != true    then "transit encryption off" else empty end)
  , (if $rg.AuthTokenEnabled != true            then "auth token off" else empty end)
  , (if $rg.AutomaticFailover != "enabled"      then "automatic failover \($rg.AutomaticFailover)" else empty end)
  , (if ([$rg.NodeGroups[].NodeGroupMembers[]] | length) < 2 then "fewer than 2 nodes" else empty end)
  , (if ($rg.SnapshotRetentionLimit // 0) < 35  then "snapshot retention \($rg.SnapshotRetentionLimit // 0) < 35" else empty end)
  ] | join("; ")')"

rds_failures="$(aws_cmd rds describe-db-instances --db-instance-identifier "$db_id" \
  --query 'DBInstances[0]' --output json --region "$region" | jq -r '
  [ (if .DBInstanceStatus != "available"  then "status \(.DBInstanceStatus)" else empty end)
  , (if .StorageEncrypted != true         then "storage not encrypted" else empty end)
  , (if .MultiAZ != true                  then "not Multi-AZ" else empty end)
  , (if .DeletionProtection != true       then "deletion protection off" else empty end)
  , (if .BackupRetentionPeriod < 35       then "backup retention \(.BackupRetentionPeriod) < 35" else empty end)
  ] | join("; ")')"

status=0
if [ -n "$redis_failures" ]; then
  echo "FAIL redis: ${redis_failures}" >&2
  status=1
else
  say 'PASS redis: encrypted, authenticated, failover enabled, 2 nodes, 35-day snapshots'
fi
if [ -n "$rds_failures" ]; then
  echo "FAIL rds: ${rds_failures}" >&2
  status=1
else
  say 'PASS rds: encrypted, Multi-AZ, deletion-protected, 35-day backups'
fi

if [ "$status" -ne 0 ]; then
  echo '' >&2
  echo 'The M-17 half of the production security baseline is not satisfied yet.' >&2
  exit 1
fi

cat <<EOF

[prod-bootstrap] data plane is ready.

Still required before a production deploy can start (see the plan, W1 and W2):
  1. Append &connection_limit=10 to ${secret_prefix}/database-url   (D1)
  2. LOG_KMS_KEY_ID and SECURITY_ALERT_TOPIC_ARN                    (M-16 - deploy.sh refuses without them)
  3. Confirm the email subscription on the alert topic              (an unconfirmed one delivers nothing)

EOF
