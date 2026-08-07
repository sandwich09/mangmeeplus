#!/usr/bin/env bash
set -euo pipefail

for name in AWS_ACCOUNT_ID AWS_REGION SOURCE_SHA PARENT_RUN_ID PARENT_RUN_ATTEMPT \
  MIGRATION_IMAGE SOURCE_APPLIED_MIGRATIONS_HASH EXPECTED_HASHES_PATH APPLY_AUTHORITY_PATH OUTPUT_DIR; do
  [ -n "${!name:-}" ] || { echo "ERROR: $name is required" >&2; exit 2; }
done
test "$AWS_ACCOUNT_ID" = 311414082667
test "$AWS_REGION" = ap-southeast-1
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$PARENT_RUN_ID" =~ ^[1-9][0-9]*$ && "$PARENT_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
[[ "$MIGRATION_IMAGE" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
[[ "$SOURCE_APPLIED_MIGRATIONS_HASH" =~ ^[0-9a-f]{64}$ ]]
for file in "$EXPECTED_HASHES_PATH" "$APPLY_AUTHORITY_PATH"; do
  [ -f "$file" ] && [ ! -L "$file" ]
done
[ -d "$OUTPUT_DIR" ] && [ ! -L "$OUTPUT_DIR" ] && [ -z "$(find "$OUTPUT_DIR" -mindepth 1 -print -quit)" ]

jq -cS . "$EXPECTED_HASHES_PATH" > "$OUTPUT_DIR/expected-hashes.json"
cmp -s "$EXPECTED_HASHES_PATH" "$OUTPUT_DIR/expected-hashes.json"
jq -cS . "$APPLY_AUTHORITY_PATH" > "$OUTPUT_DIR/apply-authority.json"
cmp -s "$APPLY_AUTHORITY_PATH" "$OUTPUT_DIR/apply-authority.json"
expected_hashes="$(cat "$EXPECTED_HASHES_PATH")"
apply_authority="$(cat "$APPLY_AUTHORITY_PATH")"
[ "${#expected_hashes}" -le 4096 ] && [ "${#apply_authority}" -le 4096 ]

cluster=watchdog-bms-prod
parameter_prefix=/watchdog-bms/production/a5-readonly-runtime
network_prefix=/watchdog-bms/production/a5-network
writer_secret_name=watchdog-bms/production/database-url
family="watchdog-a5-production-apply-${PARENT_RUN_ID}-a${PARENT_RUN_ATTEMPT}"
started_by="a5apply-${PARENT_RUN_ID}-a${PARENT_RUN_ATTEMPT}"
[ "${#started_by}" -le 36 ]
task_definition_arn=''
task_arn=''

cleanup() {
  local status=$?
  unset expected_hashes apply_authority
  if [ -n "$task_arn" ]; then
    current="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
      --query 'tasks[0].lastStatus' --output text 2>/dev/null || true)"
    if [ "$current" != STOPPED ] && [ "$current" != None ] && [ -n "$current" ]; then
      aws ecs stop-task --region "$AWS_REGION" --cluster "$cluster" --task "$task_arn" \
        --reason production-a5-reviewed-apply-cleanup >/dev/null 2>&1 || status=1
      aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
        >/dev/null 2>&1 || status=1
    fi
  fi
  if [ -n "$task_definition_arn" ]; then
    aws ecs deregister-task-definition --region "$AWS_REGION" --task-definition "$task_definition_arn" \
      >/dev/null 2>&1 || status=1
  fi
  exit "$status"
}
trap cleanup EXIT

parameter() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$parameter_prefix/$1" \
    --query Parameter.Value --output text
}
network_parameter() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$network_prefix/$1" \
    --query Parameter.Value --output text
}

test "$(aws sts get-caller-identity --region "$AWS_REGION" --query Account --output text)" = "$AWS_ACCOUNT_ID"
db_identifier="$(parameter db-instance-identifier)"
db_security_group="$(parameter db-security-group-id)"
task_security_group="$(parameter task-security-group-id)"
task_subnet_csv="$(parameter task-subnet-ids)"
execution_role="$(parameter apply-execution-role-arn)"
log_group="$(parameter apply-log-group-name)"
vpc_id="$(network_parameter vpc-id)"
endpoint_security_group="$(network_parameter endpoint-security-group-id)"
s3_prefix_list="$(network_parameter s3-prefix-list-id)"
task_route_table_csv="$(network_parameter task-route-table-ids)"
test "$(network_parameter reader-task-security-group-id)" = "$task_security_group"
test "$(network_parameter production-db-security-group-id)" = "$db_security_group"
test "$(network_parameter task-subnet-ids)" = "$task_subnet_csv"
test "$db_identifier" = watchdog-bms-prod-db
test "$execution_role" = arn:aws:iam::311414082667:role/watchdog-bms-production-a5-apply-execution
test "$log_group" = /ecs/watchdog-bms-production-a5-apply
[[ "$db_security_group" =~ ^sg-[0-9a-f]{8,17}$ && "$task_security_group" =~ ^sg-[0-9a-f]{8,17}$ ]]
IFS=, read -r -a task_subnets <<< "$task_subnet_csv"
[ "${#task_subnets[@]}" -eq 2 ]
for subnet in "${task_subnets[@]}"; do [[ "$subnet" =~ ^subnet-[0-9a-f]{8,17}$ ]]; done

role_json="$OUTPUT_DIR/apply-execution-role.json"
policy_json="$OUTPUT_DIR/apply-execution-policy.json"
aws iam get-role --role-name watchdog-bms-production-a5-apply-execution --output json \
  | jq -cS . > "$role_json"
aws iam get-role-policy --role-name watchdog-bms-production-a5-apply-execution \
  --policy-name watchdog-bms-production-a5-apply-execution --output json | jq -cS . > "$policy_json"
jq -e --slurpfile expected "$(dirname "$0")/production-a5-readonly-execution-trust.template.json" '
  .Role.MaxSessionDuration==7200 and .Role.AssumeRolePolicyDocument==$expected[0]
' "$role_json" >/dev/null
jq -e --slurpfile expected "$(dirname "$0")/production-a5-apply-execution-policy.template.json" '
  .PolicyName=="watchdog-bms-production-a5-apply-execution" and .PolicyDocument==$expected[0]
' "$policy_json" >/dev/null
test "$(aws iam list-attached-role-policies --role-name watchdog-bms-production-a5-apply-execution \
  --output json | jq -cS '.AttachedPolicies')" = '[]'

task_sg_raw="$OUTPUT_DIR/describe-task-security-group.json"
db_sg_raw="$OUTPUT_DIR/describe-database-security-group.json"
subnet_raw="$OUTPUT_DIR/describe-subnets.json"
db_raw="$OUTPUT_DIR/describe-db-instance.json"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$task_security_group" \
  --output json | jq -cS . > "$task_sg_raw"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$db_security_group" \
  --output json | jq -cS . > "$db_sg_raw"
bash "$(dirname "$0")/validate-production-a5-readonly-security-groups.sh" \
  "$task_sg_raw" "$db_sg_raw" "$task_security_group" "$db_security_group" \
  "$endpoint_security_group" "$s3_prefix_list" exact

endpoint_ids=()
for name in ecr-api ecr-dkr logs secretsmanager s3; do endpoint_ids+=("$(network_parameter "$name-endpoint-id")"); done
IFS=, read -r -a task_route_tables <<< "$task_route_table_csv"
endpoint_sg_raw="$OUTPUT_DIR/describe-endpoint-security-group.json"
vpc_endpoints_raw="$OUTPUT_DIR/describe-vpc-endpoints.json"
route_tables_raw="$OUTPUT_DIR/describe-route-tables.json"
endpoint_boundary="$OUTPUT_DIR/endpoint-boundary.json"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$endpoint_security_group" \
  --output json | jq -cS . > "$endpoint_sg_raw"
aws ec2 describe-vpc-endpoints --region "$AWS_REGION" --vpc-endpoint-ids "${endpoint_ids[@]}" \
  --output json | jq -cS . > "$vpc_endpoints_raw"
aws ec2 describe-route-tables --region "$AWS_REGION" --route-table-ids "${task_route_tables[@]}" \
  --output json | jq -cS . > "$route_tables_raw"
bash "$(dirname "$0")/validate-production-a5-private-endpoints.sh" \
  "$vpc_endpoints_raw" "$route_tables_raw" "$endpoint_sg_raw" "$vpc_id" \
  "$endpoint_security_group" "$(network_parameter clone-task-security-group-id)" \
  "$task_security_group" "$task_subnet_csv" "$task_route_table_csv" \
  "$s3_prefix_list" "$endpoint_boundary"
aws ec2 describe-subnets --region "$AWS_REGION" --subnet-ids "${task_subnets[@]}" --output json \
  | jq -cS . > "$subnet_raw"
jq -e --argjson expected "$(printf '%s\n' "${task_subnets[@]}" | sort | jq -R . | jq -s .)" '
  (.Subnets|length)==2 and all(.[];.State=="available" and .MapPublicIpOnLaunch==false)
  and ([.Subnets[].SubnetId]|sort)==$expected
' "$subnet_raw" >/dev/null
aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$db_identifier" \
  --output json | jq -cS . > "$db_raw"
jq -e --arg id "$db_identifier" --arg sg "$db_security_group" '
  (.DBInstances|length)==1 and .DBInstances[0].DBInstanceIdentifier==$id
  and .DBInstances[0].Engine=="postgres" and (.DBInstances[0].EngineVersion|test("^18(\\.[0-9]+){1,2}$"))
  and .DBInstances[0].DBInstanceStatus=="available" and .DBInstances[0].PubliclyAccessible==false
  and .DBInstances[0].StorageEncrypted==true
  and ([.DBInstances[0].VpcSecurityGroups[]|select(.Status=="active")|.VpcSecurityGroupId])==[$sg]
' "$db_raw" >/dev/null
db_host="$(jq -er '.DBInstances[0].Endpoint.Address' "$db_raw")"
test "$(jq -er '.DBInstances[0].Endpoint.Port' "$db_raw")" = 5432

writer_metadata="$OUTPUT_DIR/writer-secret-metadata.json"
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$writer_secret_name" \
  --output json | jq -cS . > "$writer_metadata"
writer_arn="$(jq -er '.ARN|select(test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-"))' "$writer_metadata")"
writer_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))' "$writer_metadata")"

task_definition="$OUTPUT_DIR/task-definition-input.json"
jq -cnS --arg family "$family" --arg execution "$execution_role" --arg image "$MIGRATION_IMAGE" \
  --arg writer "${writer_arn}:::${writer_version}" --arg source "$SOURCE_SHA" \
  --arg host "$db_host" --arg ledger "$SOURCE_APPLIED_MIGRATIONS_HASH" \
  --arg hashes "$expected_hashes" --arg authority "$apply_authority" \
  --arg region "$AWS_REGION" --arg logGroup "$log_group" '
  {family:$family,executionRoleArn:$execution,networkMode:"awsvpc",requiresCompatibilities:["FARGATE"],
   cpu:"2048",memory:"4096",runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},
   volumes:[{name:"tmp"}],containerDefinitions:[{
     name:"apply",image:$image,essential:true,readonlyRootFilesystem:true,user:"node",workingDirectory:"/app",
     command:["/app/node_modules/.bin/tsx","/app/apps/api/prisma/production-a5/run-production-apply.ts"],
     environment:[{name:"SOURCE_SHA",value:$source},{name:"PRODUCTION_A5_MIGRATION_IMAGE",value:$image},
       {name:"PRODUCTION_A5_EXPECTED_DATABASE_HOST",value:$host},
       {name:"PRODUCTION_A5_SOURCE_APPLIED_MIGRATIONS_HASH",value:$ledger},
       {name:"PRODUCTION_A5_EXPECTED_HASHES_JSON",value:$hashes},
       {name:"PRODUCTION_A5_APPLY_AUTHORITY_JSON",value:$authority},
       {name:"HOME",value:"/tmp"},{name:"TMPDIR",value:"/tmp"},{name:"XDG_CACHE_HOME",value:"/tmp/cache"}],
     secrets:[{name:"DATABASE_URL",valueFrom:$writer}],
     mountPoints:[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}],portMappings:[],
     linuxParameters:{initProcessEnabled:true},stopTimeout:120,
     logConfiguration:{logDriver:"awslogs",options:{"awslogs-group":$logGroup,
       "awslogs-region":$region,"awslogs-stream-prefix":"production-a5"}}
   }]}
' > "$task_definition"
registered="$OUTPUT_DIR/register-task-definition.json"
aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "file://$task_definition" \
  --output json | jq -cS . > "$registered"
task_definition_arn="$(jq -er '.taskDefinition.taskDefinitionArn' "$registered")"
jq -e --arg family "$family" --arg execution "$execution_role" --arg image "$MIGRATION_IMAGE" \
  --arg writerVersion "$writer_version" --arg source "$SOURCE_SHA" '
  .taskDefinition.family==$family and .taskDefinition.executionRoleArn==$execution
  and .taskDefinition.taskRoleArn==null and .taskDefinition.networkMode=="awsvpc"
  and (.taskDefinition.containerDefinitions|length)==1
  and .taskDefinition.containerDefinitions[0].name=="apply"
  and .taskDefinition.containerDefinitions[0].image==$image
  and .taskDefinition.containerDefinitions[0].readonlyRootFilesystem==true
  and (.taskDefinition.containerDefinitions[0].environment
    | any(.name=="SOURCE_SHA" and .value==$source))
  and (.taskDefinition.containerDefinitions[0].secrets|length)==1
  and .taskDefinition.containerDefinitions[0].secrets[0].name=="DATABASE_URL"
  and (.taskDefinition.containerDefinitions[0].secrets[0].valueFrom|endswith(":::"+$writerVersion))
' "$registered" >/dev/null

network="$(jq -cn --arg subnets "$task_subnet_csv" --arg sg "$task_security_group" '
  {awsvpcConfiguration:{subnets:($subnets|split(",")|sort),securityGroups:[$sg],assignPublicIp:"DISABLED"}}
')"
run_task="$OUTPUT_DIR/run-task.json"
aws ecs run-task --region "$AWS_REGION" --cluster "$cluster" --launch-type FARGATE \
  --platform-version 1.4.0 --task-definition "$task_definition_arn" \
  --network-configuration "$network" --started-by "$started_by" --output json \
  | jq -cS . > "$run_task"
jq -e '.failures==[] and (.tasks|length)==1' "$run_task" >/dev/null
task_arn="$(jq -er '.tasks[0].taskArn' "$run_task")"
aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn"
task_raw="$OUTPUT_DIR/describe-task.json"
aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
  --output json | jq -cS . > "$task_raw"
jq -e --arg task "$task_arn" --arg definition "$task_definition_arn" \
  --arg group "family:$family" --arg started "$started_by" '
  .failures==[] and (.tasks|length)==1 and .tasks[0].taskArn==$task
  and .tasks[0].lastStatus=="STOPPED" and .tasks[0].taskDefinitionArn==$definition
  and .tasks[0].group==$group and .tasks[0].startedBy==$started
  and (.tasks[0].containers|length)==1 and .tasks[0].containers[0].exitCode==0
' "$task_raw" >/dev/null

task_id="${task_arn##*/}"
pages="$OUTPUT_DIR/log-pages"
mkdir "$pages"
next_token=''
for page in $(seq 1 100); do
  page_file="$pages/$page.json"
  if [ -z "$next_token" ]; then
    aws logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group" \
      --log-stream-name "production-a5/apply/$task_id" --start-from-head --limit 10000 --output json \
      | jq -cS . > "$page_file"
  else
    aws logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group" \
      --log-stream-name "production-a5/apply/$task_id" --start-from-head --limit 10000 \
      --next-token "$next_token" --output json | jq -cS . > "$page_file"
  fi
  new_token="$(jq -er '.nextForwardToken' "$page_file")"
  if [ -n "$next_token" ] && [ "$new_token" = "$next_token" ]; then break; fi
  next_token="$new_token"
  [ "$page" -lt 100 ]
done
logs="$OUTPUT_DIR/log-events.json"
jq -csS '{events:[.[]|.events[]]}' "$pages"/*.json > "$logs"
bash "$(dirname "$0")/reconstruct-production-a5-apply-result.sh" \
  "$logs" "$SOURCE_SHA" "$MIGRATION_IMAGE" "$SOURCE_APPLIED_MIGRATIONS_HASH" \
  "$EXPECTED_HASHES_PATH" "$APPLY_AUTHORITY_PATH" "$OUTPUT_DIR/apply-result.json"

writer_after="$(aws secretsmanager describe-secret --region "$AWS_REGION" \
  --secret-id "$writer_secret_name" --output json | jq -er '
  [.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]|select(length==1)|.[0]')"
test "$writer_after" = "$writer_version"
jq -cnS --arg task "$task_arn" --arg definition "$task_definition_arn" \
  --arg image "$MIGRATION_IMAGE" --arg source "$SOURCE_SHA" --arg secretVersion "$writer_version" \
  --arg resultHash "$(sha256sum "$OUTPUT_DIR/apply-result.json" | awk '{print $1}')" \
  --slurpfile boundary "$endpoint_boundary" '
  {schemaVersion:1,status:"PASSED",sourceCommit:$source,migrationImage:$image,
   taskArn:$task,taskDefinitionArn:$definition,taskRoleArn:null,writerSecretVersionId:$secretVersion,
   privateEndpointBoundary:$boundary[0],resultSha256:$resultHash}
' > "$OUTPUT_DIR/apply-runtime.json"

trap - EXIT
cleanup
