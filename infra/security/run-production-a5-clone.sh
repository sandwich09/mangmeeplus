#!/usr/bin/env bash
set -euo pipefail

production_a5_wait_for_restored_instance() {
  local output_file="$1" max_checks="${2:-120}" wait_seconds="${3:-15}"
  local check state error_file="${output_file}.err"
  db_observed=false
  for ((check=1; check<=max_checks; check++)); do
    if db_state="$(aws rds describe-db-instances --region "$AWS_REGION" \
        --db-instance-identifier "$temporary_id" --output json 2> "$error_file")"; then
      db_observed=true
      state="$(jq -er '.DBInstances | select(length==1) | .[0].DBInstanceStatus' \
        <<< "$db_state")"
      case "$state" in
        available) printf '%s' "$db_state" | jq -cS . > "$output_file"; return 0 ;;
        failed|incompatible-*|storage-full)
          echo "ERROR: restored clone entered terminal state: $state" >&2
          return 1
          ;;
      esac
    elif ! grep -F DBInstanceNotFound "$error_file" >/dev/null; then
      cat "$error_file" >&2
      return 1
    fi
    [ "$check" -lt "$max_checks" ] && sleep "$wait_seconds"
  done
  echo 'ERROR: restored clone did not become available within its 30-minute budget' >&2
  return 1
}

production_a5_wait_for_managed_secret() {
  local output_file="$1" max_checks="${2:-20}" wait_seconds="${3:-15}"
  local check state error_file="${output_file}.err"
  secret_state=''
  clone_ready=false
  for ((check=1; check<=max_checks; check++)); do
    if db_state="$(aws rds describe-db-instances --region "$AWS_REGION" \
        --db-instance-identifier "$temporary_id" --output json 2> "$error_file")"; then
      state="$(jq -er '.DBInstances | select(length==1) | .[0].DBInstanceStatus' \
        <<< "$db_state")"
      secret_state="$(jq -r '.DBInstances[0].MasterUserSecret.SecretStatus // empty' \
        <<< "$db_state")"
      case "$state" in
        failed|incompatible-*|storage-full)
          echo "ERROR: managed-secret setup entered terminal DB state: $state" >&2
          return 1
          ;;
      esac
      if [ "$state" = available ] && [ "$secret_state" = active ]; then
        printf '%s' "$db_state" | jq -cS . > "$output_file"
        clone_ready=true
        return 0
      fi
      if [ "$secret_state" = impaired ]; then
        echo 'ERROR: RDS managed clone secret is impaired' >&2
        return 1
      fi
    else
      cat "$error_file" >&2
      return 1
    fi
    [ "$check" -lt "$max_checks" ] && sleep "$wait_seconds"
  done
  echo 'ERROR: RDS managed clone secret did not become active within its 5-minute budget' >&2
  return 1
}

production_a5_collect_log_events() {
  local log_group_name="$1" log_stream_name="$2" output_file="$3"
  local page_file="${output_file}.page" next_token='' observed_token='' page tmp
  jq -cnS '{events:[]}' > "$output_file"
  for page in {1..100}; do
    if [ -z "$next_token" ]; then
      aws logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group_name" \
        --log-stream-name "$log_stream_name" --start-from-head --no-paginate --output json \
        > "$page_file"
    else
      aws logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group_name" \
        --log-stream-name "$log_stream_name" --start-from-head --no-paginate \
        --next-token "$next_token" --output json > "$page_file"
    fi
    jq -e '.events|type=="array"' "$page_file" >/dev/null
    observed_token="$(jq -er '.nextForwardToken|strings|select(length>0)' "$page_file")"
    tmp="${output_file}.tmp"
    jq -cS --slurpfile page "$page_file" '.events += $page[0].events' "$output_file" > "$tmp"
    mv "$tmp" "$output_file"
    [ "$observed_token" != "$next_token" ] || { rm -f -- "$page_file"; return 0; }
    next_token="$observed_token"
  done
  echo 'ERROR: CloudWatch log pagination exceeded 100 pages' >&2
  return 1
}

# Focused specs source only the deterministic provider state machines above with a fake AWS CLI.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

for name in AWS_ACCOUNT_ID AWS_REGION SOURCE_SHA PARENT_RUN_ID PARENT_RUN_ATTEMPT \
  CLONE_RUN_ID CLONE_RUN_ATTEMPT MIGRATION_IMAGE OUTPUT_DIR; do
  [ -n "${!name:-}" ] || { echo "ERROR: $name is required" >&2; exit 2; }
done
test "$AWS_ACCOUNT_ID" = 311414082667
test "$AWS_REGION" = ap-southeast-1
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$PARENT_RUN_ID" =~ ^[1-9][0-9]*$ && "$PARENT_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
[[ "$CLONE_RUN_ID" =~ ^[1-9][0-9]*$ && "$CLONE_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
[[ "$MIGRATION_IMAGE" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
[ -d "$OUTPUT_DIR" ] && [ ! -L "$OUTPUT_DIR" ] && [ -z "$(find "$OUTPUT_DIR" -mindepth 1 -print -quit)" ]
aws_config="$OUTPUT_DIR/aws-cli.config"
printf '%s\n' '[default]' 'cli_connect_timeout = 5' 'cli_read_timeout = 30' \
  'retry_mode = standard' 'max_attempts = 2' > "$aws_config"
export AWS_CONFIG_FILE="$aws_config"
A5_CLONE_PROFILE="${A5_CLONE_PROFILE:-reviewed-v1}"
case "$A5_CLONE_PROFILE" in
  reviewed-v1) clone_program=/app/apps/api/prisma/production-a5/run-clone-rehearsal.ts ;;
  readiness-v2)
    clone_program=/app/apps/api/prisma/production-a5/run-release-readiness-clone.ts
    [[ "${PRODUCTION_READY_EXPECTED_PENDING_CATALOG_HASH:-}" =~ ^[0-9a-f]{64}$ ]]
    [[ "${PRODUCTION_READY_EXPECTED_PENDING_COUNT:-}" =~ ^[1-9][0-9]*$ ]]
    ;;
  *) echo 'ERROR: A5_CLONE_PROFILE must be reviewed-v1 or readiness-v2' >&2; exit 2 ;;
esac

parameter_prefix=/watchdog-bms/production/a5-clone
cluster=watchdog-bms-prod
expected_managed_secret_kms_key_arn=arn:aws:kms:ap-southeast-1:311414082667:key/b2e68e7f-e098-4b88-a92a-5a0f4fe2924a
temporary_id="watchdog-a5-clone-${CLONE_RUN_ID}-a${CLONE_RUN_ATTEMPT}-${SOURCE_SHA:0:8}"
window_id="a5-clone-${CLONE_RUN_ID}-a${CLONE_RUN_ATTEMPT}"
task_family="$temporary_id"
task_arn=''
task_definition_arn=''
managed_secret_arn=''
managed_secret_version=''
eni_ids=''
restore_requested=false
db_observed=false
task_definition_requested=false
run_task_requested=false
delete_requested_at=0
delete_completed_at=0
cleanup_done=false
cleanup_attempted=false
cleanup_instance_absent=false
cleanup_secret_deleted=false
cleanup_task_stopped=false
residual_resource_count=5

sha256_json() { jq -cjS . "$1" | sha256sum | awk '{print $1}'; }
parameter() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$parameter_prefix/$1" \
    --query Parameter.Value --output text
}
network_parameter() {
  aws ssm get-parameter --region "$AWS_REGION" --name "/watchdog-bms/production/a5-network/$1" \
    --query Parameter.Value --output text
}

aws_resource_absent() {
  local expected="$1" output status
  shift
  output="$("$@" 2>&1)"
  status=$?
  [ "$status" -ne 0 ] && grep -F "$expected" <<< "$output" >/dev/null
}

active_clone_tasks() {
  AWS_BIN=aws AWS_REGION="$AWS_REGION" \
    bash "$(dirname "$0")/../prod-ecs-express/active-release-tasks.sh" \
      --cluster "$cluster" --started-by "$window_id"
}

active_clone_task_definitions() {
  aws ecs list-task-definitions --region "$AWS_REGION" --family-prefix "$task_family" \
    --status ACTIVE --output json | jq -c --arg family "$task_family" '[
      .taskDefinitionArns[]
      | select((split("/")[-1] | split(":")[0]) == $family)
    ]'
}

cleanup() {
  $cleanup_done && return 0
  $cleanup_attempted && return 1
  cleanup_attempted=true
  local cleanup_status=0 remaining=1 tasks='[]' definitions='[]' db_json='' db_status=''
  local task_residual=1 definition_residual=1 database_residual=1 secret_residual=1 eni_residual=1
  local empty_checks=0 required_empty_checks=3 status=0 output='' arn='' eni=''
  local observed_eni_ids='' cleanup_eni_ids=''
  set +e

  # Reconcile by the deterministic startedBy value so an accepted RunTask whose response was lost
  # is still found and stopped. When no task ARN was returned, keep observing for ECS's documented
  # five-minute eventual-consistency window before proving the active set empty.
  empty_checks=0
  required_empty_checks=3
  for check in {1..61}; do
    tasks="$(active_clone_tasks 2>"$OUTPUT_DIR/cleanup-tasks.err")"
    status=$?
    if [ "$status" -ne 0 ]; then
      cat "$OUTPUT_DIR/cleanup-tasks.err" >&2
      cleanup_status=1
      break
    fi
    if [ "$(jq 'length' <<< "$tasks")" -eq 0 ]; then
      empty_checks=$((empty_checks+1))
      if $run_task_requested && [ -z "$task_arn" ]; then
        required_empty_checks=61
      else
        required_empty_checks=3
      fi
      [ "$empty_checks" -ge "$required_empty_checks" ] && break
    else
      empty_checks=0
      while IFS= read -r arn; do
        [ -n "$arn" ] || continue
        output="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" \
          --tasks "$arn" --output json 2>/dev/null)"
        if [ "$?" -eq 0 ]; then
          observed_eni_ids="$(printf '%s\n%s\n' "$observed_eni_ids" \
            "$(jq -r '.tasks[]?.attachments[]?.details[]?|select(.name=="networkInterfaceId")|.value' \
              <<< "$output")" | sed '/^$/d' | sort -u | tr '\n' ' ')"
        fi
        aws ecs stop-task --region "$AWS_REGION" --cluster "$cluster" --task "$arn" \
          --reason production-a5-clone-cleanup >/dev/null 2>&1 || cleanup_status=1
      done < <(jq -r '.[]' <<< "$tasks")
    fi
    [ "$check" -lt 61 ] && sleep 5
  done
  task_residual="$(jq 'length' <<< "$tasks" 2>/dev/null)"
  [[ "$task_residual" =~ ^[0-9]+$ ]] || task_residual=1
  [ "$task_residual" -eq 0 ] && [ "$empty_checks" -ge "$required_empty_checks" ] \
    && cleanup_task_stopped=true
  $cleanup_task_stopped || cleanup_status=1

  # Registration can also succeed while its response is lost. Reconcile every ACTIVE revision of
  # this run-specific exact family, then require three stable empty reads.
  empty_checks=0
  required_empty_checks=3
  for check in {1..61}; do
    definitions="$(active_clone_task_definitions 2>"$OUTPUT_DIR/cleanup-task-definitions.err")"
    status=$?
    if [ "$status" -ne 0 ]; then
      cat "$OUTPUT_DIR/cleanup-task-definitions.err" >&2
      cleanup_status=1
      break
    fi
    if [ "$(jq 'length' <<< "$definitions")" -eq 0 ]; then
      empty_checks=$((empty_checks+1))
      if $task_definition_requested && [ -z "$task_definition_arn" ]; then
        required_empty_checks=61
      else
        required_empty_checks=3
      fi
      [ "$empty_checks" -ge "$required_empty_checks" ] && break
    else
      empty_checks=0
      while IFS= read -r arn; do
        [ -n "$arn" ] || continue
        aws ecs deregister-task-definition --region "$AWS_REGION" \
          --task-definition "$arn" >/dev/null 2>&1 || cleanup_status=1
      done < <(jq -r '.[]' <<< "$definitions")
    fi
    [ "$check" -lt 61 ] && sleep 5
  done
  definition_residual="$(jq 'length' <<< "$definitions" 2>/dev/null)"
  [[ "$definition_residual" =~ ^[0-9]+$ ]] || definition_residual=1
  [ "$definition_residual" -eq 0 ] || cleanup_status=1

  # If restore returned no response, first allow the exact deterministic identifier to become
  # visible. Once observed, repeatedly request state-appropriate deletion and distinguish a real
  # DBInstanceNotFound result from access or transport failures.
  if $restore_requested && ! $db_observed; then
    for check in {1..61}; do
      db_json="$(aws rds describe-db-instances --region "$AWS_REGION" \
        --db-instance-identifier "$temporary_id" --output json 2>"$OUTPUT_DIR/cleanup-db.err")"
      status=$?
      if [ "$status" -eq 0 ]; then db_observed=true; break; fi
      if ! grep -F DBInstanceNotFound "$OUTPUT_DIR/cleanup-db.err" >/dev/null; then
        cat "$OUTPUT_DIR/cleanup-db.err" >&2
        cleanup_status=1
        break
      fi
      [ "$check" -lt 61 ] && sleep 5
    done
  fi
  for check in {1..61}; do
    db_json="$(aws rds describe-db-instances --region "$AWS_REGION" \
      --db-instance-identifier "$temporary_id" --output json 2>"$OUTPUT_DIR/cleanup-db.err")"
    status=$?
    if [ "$status" -ne 0 ]; then
      if grep -F DBInstanceNotFound "$OUTPUT_DIR/cleanup-db.err" >/dev/null; then
        database_residual=0
        cleanup_instance_absent=true
        delete_completed_at="$(date -u +%s)"
      else
        cat "$OUTPUT_DIR/cleanup-db.err" >&2
        cleanup_status=1
      fi
      break
    fi
    db_observed=true
    output="$(jq -r '.DBInstances[0].MasterUserSecret.SecretArn // empty' <<< "$db_json")"
    [ -z "$output" ] || managed_secret_arn="$output"
    db_status="$(jq -r '.DBInstances[0].DBInstanceStatus // empty' <<< "$db_json")"
    if [ "$db_status" != deleting ]; then
      [ "$delete_requested_at" -gt 0 ] || delete_requested_at="$(date -u +%s)"
      output="$(aws rds delete-db-instance --region "$AWS_REGION" \
        --db-instance-identifier "$temporary_id" --skip-final-snapshot \
        --delete-automated-backups 2>&1)"
      status=$?
      if [ "$status" -ne 0 ] && ! grep -F InvalidDBInstanceState <<< "$output" >/dev/null; then
        printf '%s\n' "$output" >&2
        cleanup_status=1
        break
      fi
    fi
    [ "$check" -lt 61 ] && sleep 15
  done
  $cleanup_instance_absent || cleanup_status=1

  if [ -n "$managed_secret_arn" ]; then
    secret_residual=1
    for check in {1..25}; do
      if aws_resource_absent ResourceNotFoundException aws secretsmanager describe-secret \
          --region "$AWS_REGION" --secret-id "$managed_secret_arn"; then secret_residual=0; break; fi
      [ "$check" -lt 25 ] && sleep 5
    done
  elif $cleanup_instance_absent; then
    # RDS owns this secret's lifecycle; AWS deletes it and its metadata with the DB instance.
    secret_residual=0
  fi
  [ "$secret_residual" -eq 0 ] && cleanup_secret_deleted=true || cleanup_status=1

  # Only prove absence of ENIs observed on this run's reconciled tasks. A security-group-wide count
  # would incorrectly fail when another allowed clone run uses the same dedicated group.
  cleanup_eni_ids="$(printf '%s\n%s\n' "$eni_ids" "$observed_eni_ids" \
    | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' ')"
  eni_residual=0
  for eni in $cleanup_eni_ids; do
    remaining=1
    for check in {1..37}; do
      if aws_resource_absent InvalidNetworkInterfaceID.NotFound aws ec2 describe-network-interfaces \
          --region "$AWS_REGION" --network-interface-ids "$eni"; then
        remaining=0
        break
      fi
      [ "$check" -lt 37 ] && sleep 5
    done
    eni_residual=$((eni_residual+remaining))
  done
  [ "$eni_residual" -eq 0 ] || cleanup_status=1

  residual_resource_count=$((task_residual+definition_residual+database_residual+secret_residual+eni_residual))
  if [ "$cleanup_status" -eq 0 ] && [ "$residual_resource_count" -eq 0 ]; then
    cleanup_done=true
  else
    cleanup_status=1
  fi
  set -e
  return "$cleanup_status"
}
trap 'status=$?; cleanup || status=1; exit "$status"' EXIT

source_db_identifier="$(parameter source-db-identifier)"
configured_subnet_group="$(parameter db-subnet-group-name)"
db_security_group_id="$(parameter db-security-group-id)"
task_security_group_id="$(parameter task-security-group-id)"
task_subnet_csv="$(parameter task-subnet-ids)"
db_instance_class="$(parameter db-instance-class)"
execution_role_arn="$(parameter execution-role-arn)"
log_group="$(parameter log-group-name)"
vpc_id="$(network_parameter vpc-id)"
endpoint_security_group_id="$(network_parameter endpoint-security-group-id)"
s3_prefix_list_id="$(network_parameter s3-prefix-list-id)"
task_route_table_csv="$(network_parameter task-route-table-ids)"
test "$(network_parameter clone-task-security-group-id)" = "$task_security_group_id"
test "$(network_parameter clone-db-security-group-id)" = "$db_security_group_id"
test "$(network_parameter task-subnet-ids)" = "$task_subnet_csv"
test "$execution_role_arn" = arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone-execution
[[ "$db_security_group_id" =~ ^sg-[0-9a-f]{8,17}$ ]]
[[ "$task_security_group_id" =~ ^sg-[0-9a-f]{8,17}$ ]]
test "$db_security_group_id" != "$task_security_group_id"
IFS=, read -r -a task_subnets <<< "$task_subnet_csv"
[ "${#task_subnets[@]}" -ge 1 ]
for subnet in "${task_subnets[@]}"; do [[ "$subnet" =~ ^subnet-[0-9a-f]{8,17}$ ]]; done

managed_secret_kms_preflight="$OUTPUT_DIR/managed-secret-kms-key.json"
aws kms describe-key --region "$AWS_REGION" --key-id alias/aws/secretsmanager --output json \
  | jq -cS . > "$managed_secret_kms_preflight"
jq -e --arg arn "$expected_managed_secret_kms_key_arn" '
  .KeyMetadata.Arn==$arn and .KeyMetadata.Enabled==true
  and .KeyMetadata.KeyManager=="AWS" and .KeyMetadata.KeyUsage=="ENCRYPT_DECRYPT"
' "$managed_secret_kms_preflight" >/dev/null

task_sg_preflight="$OUTPUT_DIR/task-security-group-preflight.json"
db_sg_preflight="$OUTPUT_DIR/db-security-group-preflight.json"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$task_security_group_id" \
  --output json | jq -cS . > "$task_sg_preflight"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$db_security_group_id" \
  --output json | jq -cS . > "$db_sg_preflight"
bash "$(dirname "$0")/validate-production-a5-clone-security-groups.sh" \
  "$task_sg_preflight" "$db_sg_preflight" "$task_security_group_id" "$db_security_group_id" \
  "$endpoint_security_group_id" "$s3_prefix_list_id" exact

endpoint_ids=()
for name in ecr-api ecr-dkr logs secretsmanager s3; do endpoint_ids+=("$(network_parameter "$name-endpoint-id")"); done
IFS=, read -r -a task_route_tables <<< "$task_route_table_csv"
endpoint_sg_raw="$OUTPUT_DIR/describe-endpoint-security-group.json"
vpc_endpoints_raw="$OUTPUT_DIR/describe-vpc-endpoints.json"
route_tables_raw="$OUTPUT_DIR/describe-route-tables.json"
endpoint_boundary="$OUTPUT_DIR/endpoint-boundary.json"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$endpoint_security_group_id" \
  --output json | jq -cS . > "$endpoint_sg_raw"
aws ec2 describe-vpc-endpoints --region "$AWS_REGION" --vpc-endpoint-ids "${endpoint_ids[@]}" \
  --output json | jq -cS . > "$vpc_endpoints_raw"
aws ec2 describe-route-tables --region "$AWS_REGION" --route-table-ids "${task_route_tables[@]}" \
  --output json | jq -cS . > "$route_tables_raw"
bash "$(dirname "$0")/validate-production-a5-private-endpoints.sh" \
  "$vpc_endpoints_raw" "$route_tables_raw" "$endpoint_sg_raw" "$vpc_id" \
  "$endpoint_security_group_id" "$task_security_group_id" \
  "$(network_parameter reader-task-security-group-id)" \
  "$(network_parameter uat-task-security-group-ids)" \
  "$(network_parameter production-task-security-group-ids)" "$task_subnet_csv" \
  "$task_route_table_csv" "$s3_prefix_list_id" "$endpoint_boundary"

source_db_file="$OUTPUT_DIR/source-db.json"
aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$source_db_identifier" \
  --output json | jq -cS . > "$source_db_file"
jq -e --arg id "$source_db_identifier" --arg subnet "$configured_subnet_group" '
  .DBInstances|length==1 and .[0].DBInstanceIdentifier==$id and .[0].Engine=="postgres"
  and (.[0].EngineVersion|test("^18(\\.[0-9]+){1,2}$"))
  and .[0].StorageEncrypted==true and .[0].PubliclyAccessible==false
  and .[0].DBSubnetGroup.DBSubnetGroupName==$subnet
' "$source_db_file" >/dev/null
source_db_arn="$(jq -er '.DBInstances[0].DBInstanceArn' "$source_db_file")"

snapshots="$OUTPUT_DIR/snapshots.json"
aws rds describe-db-snapshots --region "$AWS_REGION" --db-instance-identifier "$source_db_identifier" \
  --snapshot-type automated --output json | jq -cS . > "$snapshots"
snapshot="$(jq -cer --arg source "$source_db_identifier" '
  [.DBSnapshots[] | select(.DBInstanceIdentifier==$source and .SnapshotType=="automated"
    and .Status=="available" and .Encrypted==true)] | sort_by(.SnapshotCreateTime) | last
' "$snapshots")"
snapshot_arn="$(jq -er '.DBSnapshotArn' <<< "$snapshot")"
snapshot_created_iso="$(jq -er '.SnapshotCreateTime' <<< "$snapshot")"
snapshot_created_epoch="$(date -u -d "$snapshot_created_iso" +%s)"
now_epoch="$(date -u +%s)"
[ "$snapshot_created_epoch" -le "$now_epoch" ] && [ $((now_epoch-snapshot_created_epoch)) -le 129600 ]

jq -cnS --arg parent "$PARENT_RUN_ID" --arg parentAttempt "$PARENT_RUN_ATTEMPT" \
  --arg producer "$CLONE_RUN_ID" --arg producerAttempt "$CLONE_RUN_ATTEMPT" \
  --arg source "$SOURCE_SHA" '[
    {Key:"parentRunAttempt",Value:$parentAttempt},{Key:"parentRunId",Value:$parent},
    {Key:"producerRunAttempt",Value:$producerAttempt},{Key:"producerRunId",Value:$producer},
    {Key:"purpose",Value:"production-a5-clone"},{Key:"sourceCommit",Value:$source}
  ]' > "$OUTPUT_DIR/tags.json"

restore_requested=true
aws rds restore-db-instance-from-db-snapshot --region "$AWS_REGION" \
  --db-instance-identifier "$temporary_id" --db-snapshot-identifier "$snapshot_arn" \
  --db-instance-class "$db_instance_class" --db-subnet-group-name "$configured_subnet_group" \
  --vpc-security-group-ids "$db_security_group_id" --no-publicly-accessible --no-multi-az \
  --backup-retention-period 0 --no-auto-minor-version-upgrade --no-deletion-protection \
  --tags "file://$OUTPUT_DIR/tags.json" >/dev/null
db_raw="$OUTPUT_DIR/describe-db-instances.json"
production_a5_wait_for_restored_instance "$db_raw"

# PostgreSQL snapshot restore can't create an RDS-managed master secret. Enable it only after the
# restored instance is available, then wait for both the DB and its secret to become usable.
aws rds modify-db-instance --region "$AWS_REGION" --db-instance-identifier "$temporary_id" \
  --manage-master-user-password --apply-immediately >/dev/null
production_a5_wait_for_managed_secret "$db_raw"

jq -e --arg id "$temporary_id" --arg sg "$db_security_group_id" \
  --arg secretKms "$expected_managed_secret_kms_key_arn" '
  .DBInstances|length==1 and .[0].DBInstanceIdentifier==$id and .[0].Engine=="postgres"
  and (.[0].EngineVersion|test("^18(\\.[0-9]+){1,2}$")) and .[0].StorageEncrypted==true
  and .[0].PubliclyAccessible==false
  and ([.[0].VpcSecurityGroups[].VpcSecurityGroupId]|sort)==[$sg]
  and (.[0].Endpoint.Address|type=="string" and length>0)
  and (.[0].Endpoint.Port|type=="number" and .==5432)
  and (.[0].DBName|type=="string" and test("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$"))
  and .[0].MasterUserSecret.SecretStatus=="active"
  and (.[0].MasterUserSecret.SecretArn|type=="string" and contains(":secret:rds!db-"))
  and .[0].MasterUserSecret.KmsKeyId==$secretKms
' "$db_raw" >/dev/null
temporary_db_arn="$(jq -er '.DBInstances[0].DBInstanceArn' "$db_raw")"
clone_host="$(jq -er '.DBInstances[0].Endpoint.Address' "$db_raw")"
clone_port="$(jq -er '.DBInstances[0].Endpoint.Port' "$db_raw")"
clone_database="$(jq -er '.DBInstances[0].DBName' "$db_raw")"
clone_engine="$(jq -er '.DBInstances[0].Engine' "$db_raw")"
clone_engine_version="$(jq -er '.DBInstances[0].EngineVersion' "$db_raw")"
kms_key_arn="$(jq -er '.DBInstances[0].KmsKeyId' "$db_raw")"
managed_secret_arn="$(jq -er '.DBInstances[0].MasterUserSecret.SecretArn' "$db_raw")"
managed_secret_kms_key_arn="$(jq -er '.DBInstances[0].MasterUserSecret.KmsKeyId' "$db_raw")"
test "$managed_secret_kms_key_arn" = "$expected_managed_secret_kms_key_arn"

managed_secret_metadata="$OUTPUT_DIR/managed-secret-metadata.json"
for check in {1..13}; do
  if aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$managed_secret_arn" \
      --output json | jq -cS . > "$managed_secret_metadata"; then
    if jq -e --arg db "$temporary_db_arn" '
        .OwningService=="rds"
        and any(.Tags[]?; .Key=="aws:rds:primaryDBInstanceArn" and .Value==$db)
        and ([.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))]|length)==1
      ' \
        "$managed_secret_metadata" >/dev/null; then break; fi
  fi
  [ "$check" -lt 13 ] && sleep 5
done
jq -e --arg arn "$managed_secret_arn" --arg db "$temporary_db_arn" '
  .ARN==$arn and .DeletedDate==null
  and (.Name|type=="string" and startswith("rds!db-"))
  and .OwningService=="rds"
  and any(.Tags[]?; .Key=="aws:rds:primaryDBInstanceArn" and .Value==$db)
  and ([.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))]|length)==1
' "$managed_secret_metadata" >/dev/null
managed_secret_version="$(jq -er '
  [.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))
' "$managed_secret_metadata")"

task_definition="$OUTPUT_DIR/task-definition-input.json"
jq -cnS --arg family "$task_family" --arg executionRole "$execution_role_arn" \
  --arg image "$MIGRATION_IMAGE" --arg secret "$managed_secret_arn" \
  --arg secretVersion "$managed_secret_version" --arg host "$clone_host" \
  --arg port "$clone_port" --arg database "$clone_database" --arg window "$window_id" \
  --arg region "$AWS_REGION" \
  --arg logGroup "$log_group" --arg program "$clone_program" --arg profile "$A5_CLONE_PROFILE" \
  --arg source "$SOURCE_SHA" \
  --arg pendingHash "${PRODUCTION_READY_EXPECTED_PENDING_CATALOG_HASH:-}" \
  --arg pendingCount "${PRODUCTION_READY_EXPECTED_PENDING_COUNT:-}" '
  {family:$family,executionRoleArn:$executionRole,networkMode:"awsvpc",
   requiresCompatibilities:["FARGATE"],cpu:"2048",memory:"4096",
   runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},
   volumes:[{name:"tmp"}],containerDefinitions:[{
     name:"clone",image:$image,essential:true,readonlyRootFilesystem:true,user:"node",
     workingDirectory:"/app",command:["/app/node_modules/.bin/tsx",
       "--tsconfig","/app/apps/api/tsconfig.json",
       $program],
     environment:([{name:"PRODUCTION_A5_EXPECTED_CLONE_HOST",value:$host},
       {name:"PGDATABASE",value:$database},{name:"PGHOST",value:$host},
       {name:"PGPORT",value:$port},
       {name:"PRODUCTION_A5_CLONE_WINDOW_ID",value:$window},
       {name:"GIT_SHA",value:$source},
       {name:"HOME",value:"/tmp"},{name:"TMPDIR",value:"/tmp"},
       {name:"XDG_CACHE_HOME",value:"/tmp/cache"}]
       + (if $profile=="readiness-v2" then [
         {name:"A5_CLONE_PROFILE",value:$profile},
         {name:"PRODUCTION_READY_EXPECTED_PENDING_CATALOG_HASH",value:$pendingHash},
         {name:"PRODUCTION_READY_EXPECTED_PENDING_COUNT",value:$pendingCount}] else [] end)),
     secrets:[
       {name:"PGPASSWORD",valueFrom:($secret+":password::"+$secretVersion)},
       {name:"PGUSER",valueFrom:($secret+":username::"+$secretVersion)}
     ],
     mountPoints:[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}],
     portMappings:[],linuxParameters:{initProcessEnabled:true},stopTimeout:120,
     logConfiguration:{logDriver:"awslogs",options:{"awslogs-group":$logGroup,
       "awslogs-region":$region,"awslogs-stream-prefix":"production-a5"}}
   }]}
' > "$task_definition"
registered="$OUTPUT_DIR/registered-task-definition.json"
task_definition_requested=true
aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "file://$task_definition" \
  --output json | jq -cS . > "$registered"
task_definition_arn="$(jq -er '.taskDefinition.taskDefinitionArn' "$registered")"
jq -e --arg source "$SOURCE_SHA" --arg profile "$A5_CLONE_PROFILE" \
  --arg program "$clone_program" --arg image "$MIGRATION_IMAGE" \
  --arg database "$clone_database" --arg host "$clone_host" --arg port "$clone_port" \
  --arg secret "$managed_secret_arn" --arg version "$managed_secret_version" '
  .taskDefinition as $t
  | ($t.taskRoleArn//null)==null and ($t.containerDefinitions|length)==1
  and $t.containerDefinitions[0].image==$image
  and $t.containerDefinitions[0].command[-1]==$program
  and ([$t.containerDefinitions[0].environment[]|select(.name=="GIT_SHA")|.value])==[$source]
  and ([$t.containerDefinitions[0].environment[]
    | select(.name=="PGDATABASE" or .name=="PGHOST" or .name=="PGPORT")]
    | sort_by(.name)) == [
      {name:"PGDATABASE",value:$database},{name:"PGHOST",value:$host},{name:"PGPORT",value:$port}]
  and $t.containerDefinitions[0].secrets == [
    {name:"PGPASSWORD",valueFrom:($secret+":password::"+$version)},
    {name:"PGUSER",valueFrom:($secret+":username::"+$version)}]
  and (if $profile=="readiness-v2" then
    ([$t.containerDefinitions[0].environment[]|select(.name=="A5_CLONE_PROFILE")|.value])==[$profile]
    and ([$t.containerDefinitions[0].environment[]
      |select(.name=="PRODUCTION_READY_EXPECTED_PENDING_CATALOG_HASH")|.value]|length)==1
    and ([$t.containerDefinitions[0].environment[]
      |select(.name=="PRODUCTION_READY_EXPECTED_PENDING_COUNT")|.value]|length)==1
  else true end)
' "$registered" >/dev/null

network_configuration="$(jq -cn --arg subnets "$task_subnet_csv" --arg sg "$task_security_group_id" '
  {awsvpcConfiguration:{subnets:($subnets|split(",")|sort),securityGroups:[$sg],assignPublicIp:"DISABLED"}}
')"
run_task="$OUTPUT_DIR/run-task.json"
run_task_raw="$OUTPUT_DIR/run-task.raw.json"
run_task_error="$OUTPUT_DIR/run-task.err"
run_client_token="$window_id-${SOURCE_SHA:0:32}"
[ "${#run_client_token}" -le 64 ]
run_task_requested=true
run_task_succeeded=false
run_task_delay=2
for attempt in {1..9}; do
  set +e
  aws ecs run-task --region "$AWS_REGION" --cluster "$cluster" --launch-type FARGATE \
    --platform-version 1.4.0 --task-definition "$task_definition_arn" \
    --network-configuration "$network_configuration" \
    --started-by "$window_id" --client-token "$run_client_token" \
    --output json > "$run_task_raw" 2> "$run_task_error"
  run_task_status=$?
  set -e
  if [ "$run_task_status" -eq 0 ]; then
    jq -cS . "$run_task_raw" > "$run_task"
    run_task_succeeded=true
    break
  fi
  if ! grep -Eiq 'unable to assume[^[:cntrl:]]*role' "$run_task_error"; then
    cat "$run_task_error" >&2
    exit "$run_task_status"
  fi
  [ "$attempt" -lt 9 ] || break
  sleep "$run_task_delay"
  run_task_delay=$((run_task_delay*2))
  [ "$run_task_delay" -le 90 ] || run_task_delay=90
done
if ! $run_task_succeeded; then
  cat "$run_task_error" >&2
  exit 1
fi
jq -e '.failures==[] and (.tasks|length)==1' "$run_task" >/dev/null
task_arn="$(jq -er '.tasks[0].taskArn' "$run_task")"

task_capture="$OUTPUT_DIR/describe-tasks.json"
describe_task_delay=2
for attempt in {1..8}; do
  aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
    --output json | jq -cS . > "$task_capture"
  eni_ids="$(jq -r '[.tasks[0].attachments[]?.details[]?|select(.name=="networkInterfaceId")|.value]
    | unique | sort | join(" ")' "$task_capture")"
  [ -n "$eni_ids" ] && break
  [ "$attempt" -lt 8 ] && sleep "$describe_task_delay"
  describe_task_delay=$((describe_task_delay*2))
  [ "$describe_task_delay" -le 90 ] || describe_task_delay=90
done
[ -n "$eni_ids" ]
read -r -a eni_array <<< "$eni_ids"
[ "${#eni_array[@]}" -eq 1 ]
eni_raw="$OUTPUT_DIR/describe-network-interfaces.json"
aws ec2 describe-network-interfaces --region "$AWS_REGION" --network-interface-ids "${eni_array[@]}" \
  --output json | jq -cS . > "$eni_raw"

task_stopped=false
for check in {1..385}; do
  aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
    --output json | jq -cS . > "$task_capture"
  if jq -e '.failures==[] and (.tasks|length)==1 and .tasks[0].lastStatus=="STOPPED"' \
      "$task_capture" >/dev/null; then
    task_stopped=true
    break
  fi
  [ "$check" -lt 385 ] && sleep 5
done
$task_stopped
jq -e '.failures==[] and (.tasks|length)==1 and .tasks[0].lastStatus=="STOPPED"
  and (.tasks[0].containers|length)==1 and .tasks[0].containers[0].exitCode==0' \
  "$task_capture" >/dev/null
task_id="${task_arn##*/}"
logs_raw="$OUTPUT_DIR/log-events.json"
logs_raw_unsorted="$OUTPUT_DIR/log-events.raw.json"
logs_error="$OUTPUT_DIR/log-events.err"
clone_result="$OUTPUT_DIR/clone-task-result.json"
logs_ready=false
for check in {1..13}; do
  rm -f -- "$clone_result"
  if production_a5_collect_log_events "$log_group" "production-a5/clone/$task_id" \
      "$logs_raw_unsorted" 2> "$logs_error" \
      && jq -cS . "$logs_raw_unsorted" > "$logs_raw" \
      && bash "$(dirname "$0")/reconstruct-production-a5-clone-result.sh" \
        "$logs_raw" "$clone_result" "$A5_CLONE_PROFILE" 2> "$logs_error"; then
    logs_ready=true
    break
  fi
  [ "$check" -lt 13 ] && sleep 5
done
if ! $logs_ready; then
  cat "$logs_error" >&2
  exit 1
fi

db_subnet_ids="$(jq -r '[.DBInstances[0].DBSubnetGroup.Subnets[].SubnetIdentifier]|unique|sort|join(" ")' "$db_raw")"
task_subnet_ids="$(jq -r '[.NetworkInterfaces[].SubnetId]|unique|sort|join(" ")' "$eni_raw")"
read -r -a all_subnets <<< "$(printf '%s\n%s\n' "$db_subnet_ids" "$task_subnet_ids" | tr ' ' '\n' | sort -u | tr '\n' ' ')"
subnets_raw="$OUTPUT_DIR/describe-subnets.json"
aws ec2 describe-subnets --region "$AWS_REGION" --subnet-ids "${all_subnets[@]}" \
  --output json | jq -cS . > "$subnets_raw"
security_groups_raw="$OUTPUT_DIR/describe-security-groups.json"
aws ec2 describe-security-groups --region "$AWS_REGION" \
  --group-ids "$db_security_group_id" "$task_security_group_id" --output json \
  | jq -cS . > "$security_groups_raw"
task_definition_raw="$OUTPUT_DIR/describe-task-definition.json"
aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$task_definition_arn" \
  --output json | jq -cS . > "$task_definition_raw"

aws rds list-tags-for-resource --region "$AWS_REGION" --resource-name "$temporary_db_arn" \
  --output json | jq -e --slurpfile expected "$OUTPUT_DIR/tags.json" '
    ([.TagList[]|{Key,Value}]|sort_by(.Key)) == ($expected[0]|sort_by(.Key))
' >/dev/null

if ! cleanup; then
  trap - EXIT
  echo 'ERROR: clone cleanup was incomplete; refusing a duplicate unbounded cleanup attempt' >&2
  exit 1
fi
test "$delete_requested_at" -gt 0 && test "$delete_completed_at" -ge "$delete_requested_at"
test "$cleanup_done" = true
test "$cleanup_instance_absent" = true
test "$cleanup_secret_deleted" = true
test "$cleanup_task_stopped" = true
test "$residual_resource_count" -eq 0
if ! aws_resource_absent DBInstanceNotFound aws rds describe-db-instances --region "$AWS_REGION" \
    --db-instance-identifier "$temporary_id"; then
  echo 'ERROR: temporary clone still exists after cleanup' >&2
  exit 1
fi
task_status="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
  --query 'tasks[0].lastStatus' --output text)"
test "$task_status" = STOPPED

network_evidence="$OUTPUT_DIR/network-evidence.json"
jq -cnS \
  --slurpfile db "$db_raw" --arg dbHash "$(sha256_json "$db_raw")" \
  --slurpfile eni "$eni_raw" --arg eniHash "$(sha256_json "$eni_raw")" \
  --slurpfile sg "$security_groups_raw" --arg sgHash "$(sha256_json "$security_groups_raw")" \
  --slurpfile subnet "$subnets_raw" --arg subnetHash "$(sha256_json "$subnets_raw")" \
  --slurpfile definition "$task_definition_raw" --arg definitionHash "$(sha256_json "$task_definition_raw")" \
  --slurpfile task "$task_capture" --arg taskHash "$(sha256_json "$task_capture")" \
  --slurpfile secret "$managed_secret_metadata" \
  --arg secretHash "$(sha256_json "$managed_secret_metadata")" \
  --slurpfile endpoints "$vpc_endpoints_raw" --arg endpointsHash "$(sha256_json "$vpc_endpoints_raw")" \
  --slurpfile routes "$route_tables_raw" --arg routesHash "$(sha256_json "$route_tables_raw")" \
  --slurpfile endpointSg "$endpoint_sg_raw" --arg endpointSgHash "$(sha256_json "$endpoint_sg_raw")" \
  --slurpfile boundary "$endpoint_boundary" '
  {describeDbInstances:{raw:$db[0],sha256:$dbHash},
   describeNetworkInterfaces:{raw:$eni[0],sha256:$eniHash},
   describeSecurityGroups:{raw:$sg[0],sha256:$sgHash},
   describeSubnets:{raw:$subnet[0],sha256:$subnetHash},
   describeSecret:{raw:$secret[0],sha256:$secretHash},
   describeVpcEndpoints:{raw:$endpoints[0],sha256:$endpointsHash},
   describeRouteTables:{raw:$routes[0],sha256:$routesHash},
   describeEndpointSecurityGroup:{raw:$endpointSg[0],sha256:$endpointSgHash},
   endpointBoundary:$boundary[0],
   describeTaskDefinition:{raw:$definition[0],sha256:$definitionHash},
   describeTasks:{raw:$task[0],sha256:$taskHash}}
' > "$network_evidence"

clone_infrastructure="$OUTPUT_DIR/clone-infrastructure.json"
jq -cnS --arg sourceDbArn "$source_db_arn" --arg sourceDbId "$source_db_identifier" \
  --arg snapshotArn "$snapshot_arn" --argjson snapshotEpoch "$snapshot_created_epoch" \
  --arg temporaryArn "$temporary_db_arn" --arg temporaryId "$temporary_id" \
  --slurpfile tags "$OUTPUT_DIR/tags.json" --arg engine "$clone_engine" \
  --arg engineVersion "$clone_engine_version" --arg kms "$kms_key_arn" \
  --arg subnetGroup "$configured_subnet_group" --arg dbSg "$db_security_group_id" \
  --arg taskSg "$task_security_group_id" --arg taskArn "$task_arn" \
  --arg definitionArn "$task_definition_arn" --arg image "$MIGRATION_IMAGE" \
  --arg source "$SOURCE_SHA" --arg executionRole "$execution_role_arn" \
  --arg profile "$A5_CLONE_PROFILE" \
  --arg secretArn "$managed_secret_arn" --arg secretVersion "$managed_secret_version" \
  --slurpfile network "$network_evidence" \
  --argjson deleteRequested "$delete_requested_at" --argjson deleteCompleted "$delete_completed_at" \
  --argjson instanceAbsent "$cleanup_instance_absent" \
  --argjson secretDeleted "$cleanup_secret_deleted" \
  --argjson taskStopped "$cleanup_task_stopped" \
  --argjson residual "$residual_resource_count" '
  {sourceDbInstanceArn:$sourceDbArn,sourceDbIdentifier:$sourceDbId,snapshotArn:$snapshotArn,
   snapshotCreatedAtEpoch:$snapshotEpoch,snapshotType:"automated",
   temporaryDbInstanceArn:$temporaryArn,temporaryDbIdentifier:$temporaryId,
   requiredRunTags:($tags[0]|map({key:.Key,value:.Value})|sort_by(.key)),engine:$engine,
   engineVersion:$engineVersion,storageEncrypted:true,kmsKeyArn:$kms,publiclyAccessible:false,
   dbSubnetGroupName:$subnetGroup,
   dbSubnetIds:($network[0].describeDbInstances.raw.DBInstances[0].DBSubnetGroup.Subnets
     | map(.SubnetIdentifier)|unique|sort),dbSecurityGroupIds:[$dbSg],
   migrationTaskSubnetIds:($network[0].describeNetworkInterfaces.raw.NetworkInterfaces
     | map(.SubnetId)|unique|sort),migrationTaskSecurityGroupIds:[$taskSg],
   dbSecurityGroupIngress:[{ipProtocol:"tcp",fromPort:5432,toPort:5432,
     sourceSecurityGroupId:$taskSg}],migrationTaskArn:$taskArn,
   migrationTaskDefinitionArn:$definitionArn,migrationImage:$image,migrationSourceCommit:$source,
   migrationExecutionRoleArn:$executionRole,migrationTaskRoleArn:null,
   temporaryDatabaseSecretArn:$secretArn,temporaryDatabaseSecretVersionId:$secretVersion,
   networkBoundary:$network[0].endpointBoundary,networkEvidence:$network[0],
   cleanup:{deleteRequestedAtEpoch:$deleteRequested,deleteCompletedAtEpoch:$deleteCompleted,
     instanceAbsent:$instanceAbsent,secretDeleted:$secretDeleted,taskStopped:$taskStopped,
     residualResourceCount:$residual}}
  + (if $profile=="readiness-v2" then {rehearsalProfile:$profile} else {} end)
' > "$clone_infrastructure"

trap - EXIT
