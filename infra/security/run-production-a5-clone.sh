#!/usr/bin/env bash
set -euo pipefail

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

parameter_prefix=/watchdog-bms/production/a5-clone
cluster=watchdog-bms-prod
temporary_id="watchdog-a5-clone-${CLONE_RUN_ID}-a${CLONE_RUN_ATTEMPT}-${SOURCE_SHA:0:8}"
window_id="a5-clone-${CLONE_RUN_ID}-a${CLONE_RUN_ATTEMPT}"
task_family="$temporary_id"
task_arn=''
task_definition_arn=''
managed_secret_arn=''
managed_secret_version=''
eni_ids=''
delete_requested_at=0
delete_completed_at=0
cleanup_done=false

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

cleanup() {
  $cleanup_done && return 0
  local cleanup_status=0 task_status='' remaining=''
  set +e
  if [ -n "$task_arn" ]; then
    task_status="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" \
      --tasks "$task_arn" --query 'tasks[0].lastStatus' --output text 2>/dev/null)"
    if [ "$task_status" != STOPPED ] && [ "$task_status" != None ] && [ -n "$task_status" ]; then
      aws ecs stop-task --region "$AWS_REGION" --cluster "$cluster" --task "$task_arn" \
        --reason production-a5-clone-cleanup >/dev/null 2>&1 || cleanup_status=1
      aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" >/dev/null 2>&1
      [ "$?" -eq 0 ] || cleanup_status=1
    fi
  fi
  if [ -n "$task_definition_arn" ]; then
    aws ecs deregister-task-definition --region "$AWS_REGION" \
      --task-definition "$task_definition_arn" >/dev/null 2>&1 || cleanup_status=1
  fi
  if aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$temporary_id" \
      >/dev/null 2>&1; then
    delete_requested_at="$(date -u +%s)"
    aws rds delete-db-instance --region "$AWS_REGION" --db-instance-identifier "$temporary_id" \
      --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 || cleanup_status=1
    aws rds wait db-instance-deleted --region "$AWS_REGION" \
      --db-instance-identifier "$temporary_id" >/dev/null 2>&1 || cleanup_status=1
    delete_completed_at="$(date -u +%s)"
  fi

  if [ -n "$managed_secret_arn" ]; then
    remaining=1
    for _ in {1..60}; do
      if aws_resource_absent ResourceNotFoundException aws secretsmanager describe-secret \
          --region "$AWS_REGION" --secret-id "$managed_secret_arn"; then remaining=0; break; fi
      sleep 5
    done
    [ "$remaining" -eq 0 ] || cleanup_status=1
  fi
  if [ -n "$task_definition_arn" ]; then
    task_definition_status="$(aws ecs describe-task-definition --region "$AWS_REGION" \
      --task-definition "$task_definition_arn" --query taskDefinition.status --output text 2>/dev/null)"
    [ "$task_definition_status" = INACTIVE ] || cleanup_status=1
  fi
  if [ -n "$eni_ids" ]; then
    read -r -a cleanup_enis <<< "$eni_ids"
    for cleanup_eni in "${cleanup_enis[@]}"; do
      remaining=1
      for _ in {1..60}; do
        if aws_resource_absent InvalidNetworkInterfaceID.NotFound aws ec2 describe-network-interfaces \
            --region "$AWS_REGION" --network-interface-ids "$cleanup_eni"; then
          remaining=0
          break
        fi
        sleep 5
      done
      [ "$remaining" -eq 0 ] || cleanup_status=1
    done
  fi
  cleanup_done=true
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
  "$(network_parameter uat-task-security-group-ids)" "$task_subnet_csv" \
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
[ "$snapshot_created_epoch" -le "$now_epoch" ] && [ $((now_epoch-snapshot_created_epoch)) -le 86400 ]

jq -cnS --arg parent "$PARENT_RUN_ID" --arg parentAttempt "$PARENT_RUN_ATTEMPT" \
  --arg producer "$CLONE_RUN_ID" --arg producerAttempt "$CLONE_RUN_ATTEMPT" \
  --arg source "$SOURCE_SHA" '[
    {Key:"parentRunAttempt",Value:$parentAttempt},{Key:"parentRunId",Value:$parent},
    {Key:"producerRunAttempt",Value:$producerAttempt},{Key:"producerRunId",Value:$producer},
    {Key:"purpose",Value:"production-a5-clone"},{Key:"sourceCommit",Value:$source}
  ]' > "$OUTPUT_DIR/tags.json"

aws rds restore-db-instance-from-db-snapshot --region "$AWS_REGION" \
  --db-instance-identifier "$temporary_id" --db-snapshot-identifier "$snapshot_arn" \
  --db-instance-class "$db_instance_class" --db-subnet-group-name "$configured_subnet_group" \
  --vpc-security-group-ids "$db_security_group_id" --no-publicly-accessible --no-multi-az \
  --backup-retention-period 0 --no-auto-minor-version-upgrade --no-deletion-protection \
  --manage-master-user-password --tags "file://$OUTPUT_DIR/tags.json" >/dev/null
aws rds wait db-instance-available --region "$AWS_REGION" --db-instance-identifier "$temporary_id"

db_raw="$OUTPUT_DIR/describe-db-instances.json"
aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$temporary_id" \
  --output json | jq -cS . > "$db_raw"
jq -e --arg id "$temporary_id" --arg snapshot "$snapshot_arn" --arg sg "$db_security_group_id" '
  .DBInstances|length==1 and .[0].DBInstanceIdentifier==$id and .[0].Engine=="postgres"
  and (.[0].EngineVersion|test("^18(\\.[0-9]+){1,2}$")) and .[0].StorageEncrypted==true
  and .[0].PubliclyAccessible==false
  and ([.[0].VpcSecurityGroups[].VpcSecurityGroupId]|sort)==[$sg]
' "$db_raw" >/dev/null
temporary_db_arn="$(jq -er '.DBInstances[0].DBInstanceArn' "$db_raw")"
clone_host="$(jq -er '.DBInstances[0].Endpoint.Address' "$db_raw")"
clone_port="$(jq -er '.DBInstances[0].Endpoint.Port' "$db_raw")"
clone_engine="$(jq -er '.DBInstances[0].Engine' "$db_raw")"
clone_engine_version="$(jq -er '.DBInstances[0].EngineVersion' "$db_raw")"
kms_key_arn="$(jq -er '.DBInstances[0].KmsKeyId' "$db_raw")"
managed_secret_arn="$(jq -er '.DBInstances[0].MasterUserSecret.SecretArn' "$db_raw")"

managed_secret_metadata="$OUTPUT_DIR/managed-secret-metadata.json"
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$managed_secret_arn" \
  --output json | jq -cS . > "$managed_secret_metadata"
jq -e --arg arn "$managed_secret_arn" '
  .ARN==$arn and .DeletedDate==null
  and (.Name|type=="string" and startswith("rds!db-"))
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
  --arg port "$clone_port" --arg window "$window_id" --arg region "$AWS_REGION" \
  --arg logGroup "$log_group" '
  {family:$family,executionRoleArn:$executionRole,networkMode:"awsvpc",
   requiresCompatibilities:["FARGATE"],cpu:"2048",memory:"4096",
   runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},
   volumes:[{name:"tmp"}],containerDefinitions:[{
     name:"clone",image:$image,essential:true,readonlyRootFilesystem:true,user:"node",
     workingDirectory:"/app",command:["/app/node_modules/.bin/tsx",
       "/app/apps/api/prisma/production-a5/run-clone-rehearsal.ts"],
     environment:[{name:"PRODUCTION_A5_EXPECTED_CLONE_HOST",value:$host},
       {name:"PGPORT",value:$port},
       {name:"PRODUCTION_A5_CLONE_WINDOW_ID",value:$window},
       {name:"HOME",value:"/tmp"},{name:"TMPDIR",value:"/tmp"},
       {name:"XDG_CACHE_HOME",value:"/tmp/cache"}],
     secrets:[
       {name:"PGDATABASE",valueFrom:($secret+":dbname::"+$secretVersion)},
       {name:"PGHOST",valueFrom:($secret+":host::"+$secretVersion)},
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
aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "file://$task_definition" \
  --output json | jq -cS . > "$registered"
task_definition_arn="$(jq -er '.taskDefinition.taskDefinitionArn' "$registered")"

network_configuration="$(jq -cn --arg subnets "$task_subnet_csv" --arg sg "$task_security_group_id" '
  {awsvpcConfiguration:{subnets:($subnets|split(",")|sort),securityGroups:[$sg],assignPublicIp:"DISABLED"}}
')"
run_task="$OUTPUT_DIR/run-task.json"
aws ecs run-task --region "$AWS_REGION" --cluster "$cluster" --launch-type FARGATE \
  --platform-version 1.4.0 --task-definition "$task_definition_arn" \
  --network-configuration "$network_configuration" \
  --started-by "a5-clone-${CLONE_RUN_ID}-a${CLONE_RUN_ATTEMPT}" \
  --output json | jq -cS . > "$run_task"
jq -e '.failures==[] and (.tasks|length)==1' "$run_task" >/dev/null
task_arn="$(jq -er '.tasks[0].taskArn' "$run_task")"

task_capture="$OUTPUT_DIR/describe-tasks.json"
for _ in {1..60}; do
  aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
    --output json | jq -cS . > "$task_capture"
  eni_ids="$(jq -r '[.tasks[0].attachments[]?.details[]?|select(.name=="networkInterfaceId")|.value]
    | unique | sort | join(" ")' "$task_capture")"
  [ -n "$eni_ids" ] && break
  sleep 2
done
[ -n "$eni_ids" ]
read -r -a eni_array <<< "$eni_ids"
eni_raw="$OUTPUT_DIR/describe-network-interfaces.json"
aws ec2 describe-network-interfaces --region "$AWS_REGION" --network-interface-ids "${eni_array[@]}" \
  --output json | jq -cS . > "$eni_raw"

aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn"
aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
  --output json | jq -cS . > "$task_capture"
jq -e '.failures==[] and (.tasks|length)==1 and .tasks[0].lastStatus=="STOPPED"
  and (.tasks[0].containers|length)==1 and .tasks[0].containers[0].exitCode==0' \
  "$task_capture" >/dev/null
task_id="${task_arn##*/}"
logs_raw="$OUTPUT_DIR/log-events.json"
aws logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group" \
  --log-stream-name "production-a5/clone/$task_id" --start-from-head --output json \
  | jq -cS . > "$logs_raw"
bash "$(dirname "$0")/reconstruct-production-a5-clone-result.sh" \
  "$logs_raw" "$OUTPUT_DIR/clone-task-result.json"

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

cleanup
test "$delete_requested_at" -gt 0 && test "$delete_completed_at" -ge "$delete_requested_at"
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
  --arg secretArn "$managed_secret_arn" --arg secretVersion "$managed_secret_version" \
  --slurpfile network "$network_evidence" \
  --argjson deleteRequested "$delete_requested_at" --argjson deleteCompleted "$delete_completed_at" '
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
     instanceAbsent:true,secretDeleted:true,taskStopped:true,residualResourceCount:0}}
' > "$clone_infrastructure"

trap - EXIT
