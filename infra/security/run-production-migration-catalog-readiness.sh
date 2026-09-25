#!/usr/bin/env bash
set -euo pipefail

for name in AWS_ACCOUNT_ID AWS_REGION SOURCE_SHA READINESS_RUN_ID READINESS_RUN_ATTEMPT \
  MIGRATION_IMAGE PASSPORT_MIGRATION_CATALOG OUTPUT_DIR; do
  [ -n "${!name:-}" ] || { echo "ERROR: $name is required" >&2; exit 2; }
done
test "$AWS_ACCOUNT_ID" = 311414082667
test "$AWS_REGION" = ap-southeast-1
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$READINESS_RUN_ID" =~ ^[1-9][0-9]*$ && "$READINESS_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
[[ "$MIGRATION_IMAGE" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
[ -d "$OUTPUT_DIR" ] && [ ! -L "$OUTPUT_DIR" ] && [ -z "$(find "$OUTPUT_DIR" -mindepth 1 -print -quit)" ]

root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cluster=watchdog-bms-prod
cluster_arn=arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod
parameter_prefix=/watchdog-bms/production/a5-readonly-runtime
network_prefix=/watchdog-bms/production/a5-network
reader_secret_name=watchdog-bms/production/a5-readonly-database-url
family="watchdog-a5-production-catalog-${READINESS_RUN_ID}-a${READINESS_RUN_ATTEMPT}"
started_by="a5-catalog-${READINESS_RUN_ID}-a${READINESS_RUN_ATTEMPT}"
[ "${#started_by}" -le 36 ]
task_definition_arn=''
task_arn=''
registration_requested=false
run_task_requested=false

sha_json() {
  if command -v sha256sum >/dev/null 2>&1; then jq -cjS . "$1" | sha256sum | awk '{print $1}'
  else jq -cjS . "$1" | shasum -a 256 | awk '{print $1}'; fi
}
sha_text() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'; fi
}
parameter() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$parameter_prefix/$1" \
    --query Parameter.Value --output text
}
network_parameter() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$network_prefix/$1" \
    --query Parameter.Value --output text
}
cleanup() {
  local status=$?
  AWS_BIN=aws bash "$root/infra/prod-ecs-express/cleanup-one-shot-task.sh" \
    "$AWS_ACCOUNT_ID" "$AWS_REGION" "$cluster" "$family" "$started_by" \
    "$registration_requested" "${task_definition_arn:--}" \
    "$run_task_requested" "${task_arn:--}" production-readiness-catalog-cleanup || status=1
  exit "$status"
}
trap cleanup EXIT

test "$(aws sts get-caller-identity --region "$AWS_REGION" --query Account --output text)" = "$AWS_ACCOUNT_ID"
db_identifier="$(parameter db-instance-identifier)"
db_security_group="$(parameter db-security-group-id)"
task_security_group="$(parameter task-security-group-id)"
task_subnet_csv="$(parameter task-subnet-ids)"
execution_role="$(parameter reader-execution-role-arn)"
log_group="$(parameter reader-log-group-name)"
vpc_id="$(network_parameter vpc-id)"
endpoint_security_group="$(network_parameter endpoint-security-group-id)"
s3_prefix_list="$(network_parameter s3-prefix-list-id)"
task_route_table_csv="$(network_parameter task-route-table-ids)"
test "$db_identifier" = watchdog-bms-prod-db
test "$execution_role" = arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution
test "$log_group" = /ecs/watchdog-bms-production-a5-readonly
test "$(network_parameter reader-task-security-group-id)" = "$task_security_group"
test "$(network_parameter production-db-security-group-id)" = "$db_security_group"
test "$(network_parameter task-subnet-ids)" = "$task_subnet_csv"
[[ "$db_security_group" =~ ^sg-[0-9a-f]{8,17}$ && "$task_security_group" =~ ^sg-[0-9a-f]{8,17}$ ]]
IFS=, read -r -a task_subnets <<< "$task_subnet_csv"
[ "${#task_subnets[@]}" -eq 2 ]
for subnet in "${task_subnets[@]}"; do [[ "$subnet" =~ ^subnet-[0-9a-f]{8,17}$ ]]; done

task_sg="$OUTPUT_DIR/task-security-group.json"
db_sg="$OUTPUT_DIR/database-security-group.json"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$task_security_group" \
  --output json | jq -cS . > "$task_sg"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$db_security_group" \
  --output json | jq -cS . > "$db_sg"
bash "$root/infra/security/validate-production-a5-readonly-security-groups.sh" \
  "$task_sg" "$db_sg" "$task_security_group" "$db_security_group" \
  "$endpoint_security_group" "$s3_prefix_list" exact

endpoint_ids=()
for name in ecr-api ecr-dkr logs secretsmanager s3; do endpoint_ids+=("$(network_parameter "$name-endpoint-id")"); done
IFS=, read -r -a route_tables <<< "$task_route_table_csv"
endpoint_sg="$OUTPUT_DIR/endpoint-security-group.json"
endpoints="$OUTPUT_DIR/vpc-endpoints.json"
routes="$OUTPUT_DIR/route-tables.json"
endpoint_boundary="$OUTPUT_DIR/endpoint-boundary.json"
aws ec2 describe-security-groups --region "$AWS_REGION" --group-ids "$endpoint_security_group" \
  --output json | jq -cS . > "$endpoint_sg"
aws ec2 describe-vpc-endpoints --region "$AWS_REGION" --vpc-endpoint-ids "${endpoint_ids[@]}" \
  --output json | jq -cS . > "$endpoints"
aws ec2 describe-route-tables --region "$AWS_REGION" --route-table-ids "${route_tables[@]}" \
  --output json | jq -cS . > "$routes"
bash "$root/infra/security/validate-production-a5-private-endpoints.sh" \
  "$endpoints" "$routes" "$endpoint_sg" "$vpc_id" "$endpoint_security_group" \
  "$(network_parameter clone-task-security-group-id)" "$task_security_group" \
  "$(network_parameter uat-task-security-group-ids)" \
  "$(network_parameter production-task-security-group-ids)" "$task_subnet_csv" \
  "$task_route_table_csv" "$s3_prefix_list" "$endpoint_boundary"

subnets="$OUTPUT_DIR/subnets.json"
db="$OUTPUT_DIR/database.json"
aws ec2 describe-subnets --region "$AWS_REGION" --subnet-ids "${task_subnets[@]}" \
  --output json | jq -cS . > "$subnets"
jq -e --argjson expected "$(printf '%s\n' "${task_subnets[@]}" | sort | jq -R . | jq -s .)" '
  (.Subnets|length)==2 and ([.Subnets[].SubnetId]|sort)==$expected
  and all(.Subnets[];.State=="available" and .MapPublicIpOnLaunch==false)
' "$subnets" >/dev/null
aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$db_identifier" \
  --output json | jq -cS . > "$db"
jq -e --arg id "$db_identifier" --arg sg "$db_security_group" '
  (.DBInstances|length)==1 and .DBInstances[0].DBInstanceIdentifier==$id
  and .DBInstances[0].DBInstanceStatus=="available" and .DBInstances[0].Engine=="postgres"
  and .DBInstances[0].StorageEncrypted==true and .DBInstances[0].PubliclyAccessible==false
  and .DBInstances[0].MultiAZ==true and .DBInstances[0].DeletionProtection==true
  and .DBInstances[0].BackupRetentionPeriod>=35
  and ([.DBInstances[0].VpcSecurityGroups[]|select(.Status=="active")|.VpcSecurityGroupId])==[$sg]
' "$db" >/dev/null

secret_metadata="$OUTPUT_DIR/reader-secret.json"
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$reader_secret_name" \
  --output json | jq -cS . > "$secret_metadata"
reader_secret_arn="$(jq -er '.ARN|select(test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-"))' "$secret_metadata")"
reader_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  |select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))' "$secret_metadata")"

task_input="$OUTPUT_DIR/task-definition-input.json"
jq -cnS --arg family "$family" --arg execution "$execution_role" --arg image "$MIGRATION_IMAGE" \
  --arg secret "${reader_secret_arn}:::${reader_version}" --arg source "$SOURCE_SHA" \
  --arg log "$log_group" '
  {family:$family,executionRoleArn:$execution,networkMode:"awsvpc",requiresCompatibilities:["FARGATE"],
   cpu:"1024",memory:"2048",runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},
   volumes:[{name:"tmp"}],containerDefinitions:[{name:"catalog",image:$image,essential:true,
   readonlyRootFilesystem:true,user:"root",workingDirectory:"/app",entryPoint:["/bin/sh","-c"],
    command:["chmod 1777 /tmp && exec setpriv --reuid=node --regid=node --init-groups "+
      "/app/node_modules/.bin/tsx --tsconfig /app/apps/api/tsconfig.json "+
      "/app/apps/api/prisma/verify-applied-migration-catalog.ts"],
    environment:[{name:"ALLOW_PENDING_MIGRATIONS",value:"true"},{name:"GIT_SHA",value:$source},
      {name:"HOME",value:"/tmp"},{name:"REQUIRE_NO_AWS_CREDENTIALS",value:"true"},
      {name:"TMPDIR",value:"/tmp"},{name:"XDG_CACHE_HOME",value:"/tmp/cache"}],
    secrets:[{name:"DATABASE_URL",valueFrom:$secret}],
    mountPoints:[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}],portMappings:[],
    linuxParameters:{initProcessEnabled:true},stopTimeout:120,
    logConfiguration:{logDriver:"awslogs",options:{"awslogs-group":$log,
      "awslogs-region":"ap-southeast-1","awslogs-stream-prefix":"production-readiness"}}}]}
' > "$task_input"
registered="$OUTPUT_DIR/registered-task-definition.json"
registration_requested=true
task_definition_arn="$(AWS_BIN=aws \
  bash "$root/infra/prod-ecs-express/register-task-definition-with-retry.sh" \
    "$task_input" "$AWS_REGION")"
aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$task_definition_arn" \
  --output json | jq -cS . > "$registered"
bash "$root/infra/security/validate-production-migration-catalog-task-definition.sh" \
  "$registered" "$family" "$MIGRATION_IMAGE" "$reader_secret_arn" "$reader_version" \
  "$SOURCE_SHA" "$log_group"

network="$(jq -cn --arg subnets "$task_subnet_csv" --arg sg "$task_security_group" '
  {awsvpcConfiguration:{subnets:($subnets|split(",")|sort),securityGroups:[$sg],assignPublicIp:"DISABLED"}}')"
run="$OUTPUT_DIR/run-task.json"
run_raw="$OUTPUT_DIR/run-task.raw.json"
run_client_token="$(printf '%s' "catalog:$SOURCE_SHA:$family:$started_by" | sha_text)"
run_task_requested=true
AWS_BIN=aws bash "$root/infra/prod-ecs-express/run-task-idempotently.sh" \
  "$run_client_token" -- ecs run-task --region "$AWS_REGION" --cluster "$cluster" --launch-type FARGATE \
  --platform-version 1.4.0 --task-definition "$task_definition_arn" \
  --network-configuration "$network" --started-by "$started_by" \
  --output json > "$run_raw"
jq -cS . "$run_raw" > "$run"
rm -f -- "$run_raw"
jq -e '.failures==[] and (.tasks|length)==1' "$run" >/dev/null
task_arn="$(jq -er '.tasks[0].taskArn' "$run")"
task="$OUTPUT_DIR/task.json"
eni_ids=''
for _ in $(seq 1 60); do
  aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
    --output json | jq -cS . > "$task"
  eni_ids="$(jq -r '[.tasks[0].attachments[]?.details[]?
    |select(.name=="networkInterfaceId")|.value]|unique|sort|join(" ")' "$task")"
  [ -z "$eni_ids" ] || break
  sleep 2
done
[ -n "$eni_ids" ]
read -r -a eni_array <<< "$eni_ids"
enis="$OUTPUT_DIR/network-interfaces.json"
aws ec2 describe-network-interfaces --region "$AWS_REGION" --network-interface-ids "${eni_array[@]}" \
  --output json | jq -cS . > "$enis"
jq -e --argjson subnets "$(printf '%s\n' "${task_subnets[@]}" | sort | jq -R . | jq -s .)" \
  --arg sg "$task_security_group" '
  (.NetworkInterfaces|length)>=1
  and all(.NetworkInterfaces[];(.Association//null)==null and (.SubnetId|IN($subnets[]))
    and ([.Groups[].GroupId]|sort)==[$sg] and (.PrivateIpAddress|type)=="string")
' "$enis" >/dev/null
aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn"
aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
  --output json | jq -cS . > "$task"
jq -e --arg arn "$task_arn" --arg definition "$task_definition_arn" --arg started "$started_by" '
  .failures==[] and (.tasks|length)==1 and .tasks[0].taskArn==$arn
  and .tasks[0].taskDefinitionArn==$definition and .tasks[0].startedBy==$started
  and .tasks[0].lastStatus=="STOPPED" and (.tasks[0].containers|length)==1
  and .tasks[0].containers[0].exitCode==0
' "$task" >/dev/null

task_id="${task_arn##*/}"
log_stream="production-readiness/catalog/$task_id"
pages="$OUTPUT_DIR/log-pages"
mkdir "$pages"
token=''
for page in $(seq 1 20); do
  page_file="$pages/$page.json"
  args=(logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group"
    --log-stream-name "$log_stream" --start-from-head --limit 10000 --output json)
  [ -z "$token" ] || args+=(--next-token "$token")
  aws "${args[@]}" | jq -cS . > "$page_file"
  next="$(jq -er '.nextForwardToken' "$page_file")"
  if [ -n "$token" ] && [ "$next" = "$token" ]; then break; fi
  token="$next"
  [ "$page" -lt 20 ]
done
logs="$OUTPUT_DIR/log-events.json"
jq -csS '{events:[.[]|.events[]]}' "$pages"/*.json > "$logs"
bash "$root/infra/security/reconstruct-production-migration-catalog-result.sh" \
  "$logs" "$OUTPUT_DIR/catalog-result.json"
test "$(jq -er '.sourceCommit' "$OUTPUT_DIR/catalog-result.json")" = "$SOURCE_SHA"
test "$(jq -er '.repositoryCatalogHash' "$OUTPUT_DIR/catalog-result.json")" = \
  "$(jq -er '.repositoryCatalogHash' "$PASSPORT_MIGRATION_CATALOG")"

secret_after="$OUTPUT_DIR/reader-secret-after.json"
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$reader_secret_name" \
  --output json | jq -cS . > "$secret_after"
test "$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  |select(length==1)|.[0]' "$secret_after")" = "$reader_version"
runtime="$OUTPUT_DIR/catalog-runtime.json"
jq -cnS --arg source "$SOURCE_SHA" --arg image "$MIGRATION_IMAGE" --arg cluster "$cluster_arn" \
  --arg task "$task_arn" --arg definition "$task_definition_arn" --arg execution "$execution_role" \
  --arg secret "$reader_secret_arn" --arg version "$reader_version" --arg started "$started_by" \
  --arg log "$log_group" --arg stream "$log_stream" --arg taskSg "$task_security_group" \
  --arg dbSg "$db_security_group" --argjson subnets "$(printf '%s\n' "${task_subnets[@]}" | sort | jq -R . | jq -s .)" \
  --arg dbHash "$(sha_json "$db")" --arg networkHash "$(sha_json "$endpoint_boundary")" \
  --arg eniHash "$(sha_json "$enis")" --arg taskHash "$(sha_json "$task")" \
  --arg resultHash "$(sha_json "$OUTPUT_DIR/catalog-result.json")" '
  {schemaVersion:2,sourceCommit:$source,migrationImage:$image,clusterArn:$cluster,
   taskArn:$task,taskDefinitionArn:$definition,executionRoleArn:$execution,taskRoleArn:null,
   readerSecret:{arn:$secret,versionId:$version,stage:"AWSCURRENT"},startedBy:$started,
   network:{assignPublicIp:"DISABLED",privateSubnetIds:$subnets,taskSecurityGroupId:$taskSg,
     databaseSecurityGroupId:$dbSg,boundarySha256:$networkHash,interfacesSha256:$eniHash},
   database:{identifier:"watchdog-bms-prod-db",observationSha256:$dbHash},
   output:{logGroup:$log,logStream:$stream,taskSha256:$taskHash,resultSha256:$resultHash}}
' > "$runtime"

rm -rf -- "$pages"
aws ecs deregister-task-definition --region "$AWS_REGION" --task-definition "$task_definition_arn" >/dev/null
task_definition_arn=''
task_arn=''
registration_requested=false
run_task_requested=false
trap - EXIT
printf '%s\n' "$OUTPUT_DIR/catalog-result.json" "$runtime"
