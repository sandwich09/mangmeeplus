#!/usr/bin/env bash
set -euo pipefail

for name in AWS_ACCOUNT_ID AWS_REGION SOURCE_SHA A5_STAGE PRODUCER_RUN_ID PRODUCER_RUN_ATTEMPT \
  MIGRATION_IMAGE INPUT_BUNDLE_PATH EXPECTED_READER_SECRET_VERSION_ID OUTPUT_DIR; do
  [ -n "${!name:-}" ] || { echo "ERROR: $name is required" >&2; exit 2; }
done
test "$AWS_ACCOUNT_ID" = 311414082667
test "$AWS_REGION" = ap-southeast-1
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$PRODUCER_RUN_ID" =~ ^[1-9][0-9]*$ && "$PRODUCER_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]
[[ "$EXPECTED_READER_SECRET_VERSION_ID" =~ ^[A-Fa-f0-9-]{32,64}$ ]]
[[ "$MIGRATION_IMAGE" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
case "$A5_STAGE" in
  PRE_MUTATION) stage_slug=pre; profile=LEGACY_PRE_F1 ;;
  POST_MIGRATION) stage_slug=post-migration; profile=F1_CURRENT ;;
  POST_DEPLOYMENT) stage_slug=post-deployment; profile=F1_CURRENT ;;
  *) exit 2 ;;
esac
[ -f "$INPUT_BUNDLE_PATH" ] && [ ! -L "$INPUT_BUNDLE_PATH" ]
[ -d "$OUTPUT_DIR" ] && [ ! -L "$OUTPUT_DIR" ] && [ -z "$(find "$OUTPUT_DIR" -mindepth 1 -print -quit)" ]
input_size="$(wc -c < "$INPUT_BUNDLE_PATH" | tr -d '[:space:]')"
[[ "$input_size" =~ ^[1-9][0-9]*$ ]] && [ "$input_size" -le 8388608 ]
jq -cS . "$INPUT_BUNDLE_PATH" > "$OUTPUT_DIR/input.canonical.json"
cmp -s "$INPUT_BUNDLE_PATH" "$OUTPUT_DIR/input.canonical.json"
if command -v sha256sum >/dev/null 2>&1; then sha256_cmd=(sha256sum); else sha256_cmd=(shasum -a 256); fi
sha_file() { "${sha256_cmd[@]}" "$1" | awk '{print $1}'; }
sha_json() { jq -cjS . "$1" | "${sha256_cmd[@]}" | awk '{print $1}'; }
input_hash="$(sha_file "$INPUT_BUNDLE_PATH")"
encoded_input="$(gzip -n -9 -c "$INPUT_BUNDLE_PATH" | base64 | tr -d '\n')"
# Keep the complete process environment comfortably below Linux ARG_MAX. This is reviewed,
# non-secret input; a larger future catalog must move to an immutable object rather than silently
# relying on implementation-specific ECS environment limits.
[ "${#encoded_input}" -le 60000 ]

cluster=watchdog-bms-prod
cluster_arn=arn:aws:ecs:ap-southeast-1:311414082667:cluster/watchdog-bms-prod
parameter_prefix=/watchdog-bms/production/a5-readonly-runtime
reader_secret_name=watchdog-bms/production/a5-readonly-database-url
family="watchdog-a5-production-reader-${PRODUCER_RUN_ID}-a${PRODUCER_RUN_ATTEMPT}-${stage_slug}"
marker="a5-prod-${PRODUCER_RUN_ID}-a${PRODUCER_RUN_ATTEMPT}-${stage_slug}"
case "$A5_STAGE" in
  PRE_MUTATION) started_stage=p ;;
  POST_MIGRATION) started_stage=m ;;
  POST_DEPLOYMENT) started_stage=d ;;
esac
started_by="a5r-${PRODUCER_RUN_ID}-a${PRODUCER_RUN_ATTEMPT}-${started_stage}"
[ "${#started_by}" -le 36 ]
task_definition_arn=''
task_arn=''

cleanup() {
  local status=$?
  unset encoded_input
  if [ -n "$task_arn" ]; then
    current="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
      --query 'tasks[0].lastStatus' --output text 2>/dev/null || true)"
    if [ "$current" != STOPPED ] && [ "$current" != None ] && [ -n "$current" ]; then
      aws ecs stop-task --region "$AWS_REGION" --cluster "$cluster" --task "$task_arn" \
        --reason production-a5-reader-cleanup >/dev/null 2>&1 || status=1
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
  aws ssm get-parameter --region "$AWS_REGION" --name "/watchdog-bms/production/a5-network/$1" \
    --query Parameter.Value --output text
}
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
test "$(network_parameter reader-task-security-group-id)" = "$task_security_group"
test "$(network_parameter production-db-security-group-id)" = "$db_security_group"
test "$(network_parameter task-subnet-ids)" = "$task_subnet_csv"
test "$db_identifier" = watchdog-bms-prod-db
test "$execution_role" = arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution
test "$log_group" = /ecs/watchdog-bms-production-a5-readonly
[[ "$db_security_group" =~ ^sg-[0-9a-f]{8,17}$ && "$task_security_group" =~ ^sg-[0-9a-f]{8,17}$ ]]
IFS=, read -r -a task_subnets <<< "$task_subnet_csv"
[ "${#task_subnets[@]}" -eq 2 ]
for subnet in "${task_subnets[@]}"; do [[ "$subnet" =~ ^subnet-[0-9a-f]{8,17}$ ]]; done

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
  "$task_security_group" "$(network_parameter uat-task-security-group-ids)" \
  "$task_subnet_csv" "$task_route_table_csv" \
  "$s3_prefix_list" "$endpoint_boundary"
aws ec2 describe-subnets --region "$AWS_REGION" --subnet-ids "${task_subnets[@]}" \
  --output json | jq -cS . > "$subnet_raw"
jq -e --argjson expected "$(printf '%s\n' "${task_subnets[@]}" | sort | jq -R . | jq -s .)" '
  (.Subnets|length)==2 and all(.[];.State=="available" and .MapPublicIpOnLaunch==false)
  and ([.Subnets[].SubnetId]|sort)==$expected
' "$subnet_raw" >/dev/null
aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$db_identifier" \
  --output json | jq -cS . > "$db_raw"
jq -e --arg id "$db_identifier" --arg sg "$db_security_group" '
  (.DBInstances|length)==1 and .DBInstances[0].DBInstanceIdentifier==$id
  and .DBInstances[0].Engine=="postgres"
  and .DBInstances[0].PubliclyAccessible==false and .DBInstances[0].StorageEncrypted==true
  and ([.DBInstances[0].VpcSecurityGroups[]|select(.Status=="active")|.VpcSecurityGroupId])==[$sg]
' "$db_raw" >/dev/null

secret_metadata="$OUTPUT_DIR/reader-secret-metadata.json"
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$reader_secret_name" \
  --output json | jq -cS . > "$secret_metadata"
reader_secret_arn="$(jq -er '.ARN|select(test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-"))' "$secret_metadata")"
reader_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]' "$secret_metadata")"
test "$reader_version" = "$EXPECTED_READER_SECRET_VERSION_ID"

task_definition="$OUTPUT_DIR/task-definition-input.json"
jq -cnS --arg family "$family" --arg execution "$execution_role" --arg image "$MIGRATION_IMAGE" \
  --arg input "$encoded_input" --arg marker "$marker" --arg reader "${reader_secret_arn}:::${reader_version}" \
  --arg source "$SOURCE_SHA" --arg stage "$A5_STAGE" --arg profile "$profile" \
  --arg region "$AWS_REGION" --arg logGroup "$log_group" '
  {family:$family,executionRoleArn:$execution,networkMode:"awsvpc",requiresCompatibilities:["FARGATE"],
   cpu:"2048",memory:"4096",runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},
   volumes:[{name:"tmp"}],containerDefinitions:[{
     name:"reader",image:$image,essential:true,readonlyRootFilesystem:true,user:"node",workingDirectory:"/app",
     command:["/app/node_modules/.bin/tsx","/app/apps/api/prisma/production-a5/run-readonly-evidence-task.ts"],
     environment:[{name:"DEPLOY_ENV",value:"production"},{name:"A5_TARGET_ENVIRONMENT",value:"production"},
       {name:"A5_SCHEMA_PROFILE",value:$profile},{name:"GIT_SHA",value:$source},
       {name:"PRODUCTION_A5_STAGE",value:$stage},{name:"PRODUCTION_A5_RESULT_MARKER",value:$marker},
       {name:"PRODUCTION_A5_INPUT_BUNDLE_B64",value:$input},{name:"HOME",value:"/tmp"},
       {name:"TMPDIR",value:"/tmp"},{name:"XDG_CACHE_HOME",value:"/tmp/cache"}],
     secrets:[{name:"A5_READONLY_DATABASE_URL",valueFrom:$reader}],
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
task_definition_revision="$(jq -er '.taskDefinition.revision' "$registered")"
bash "$(dirname "$0")/validate-production-a5-readonly-task-definition.sh" \
  "$registered" "$family" "$MIGRATION_IMAGE" "$reader_secret_arn" "$reader_version" \
  "$SOURCE_SHA" "$A5_STAGE" "$profile" "$marker" "$input_hash"
unset encoded_input

network="$(jq -cn --arg subnets "$task_subnet_csv" --arg sg "$task_security_group" '
  {awsvpcConfiguration:{subnets:($subnets|split(",")|sort),securityGroups:[$sg],assignPublicIp:"DISABLED"}}
')"
run_task="$OUTPUT_DIR/run-task.json"
aws ecs run-task --region "$AWS_REGION" --cluster "$cluster" --launch-type FARGATE \
  --platform-version 1.4.0 --task-definition "$task_definition_arn" \
  --network-configuration "$network" --started-by "$started_by" \
  --output json | jq -cS . > "$run_task"
jq -e '.failures==[] and (.tasks|length)==1' "$run_task" >/dev/null
task_arn="$(jq -er '.tasks[0].taskArn' "$run_task")"

task_raw="$OUTPUT_DIR/describe-task.json"
eni_ids=''
for _ in {1..90}; do
  aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
    --output json | jq -cS . > "$task_raw"
  eni_ids="$(jq -r '[.tasks[0].attachments[]?.details[]?|select(.name=="networkInterfaceId")|.value]
    |unique|sort|join(" ")' "$task_raw")"
  [ -n "$eni_ids" ] && break
  sleep 2
done
[ -n "$eni_ids" ]
read -r -a eni_array <<< "$eni_ids"
eni_raw="$OUTPUT_DIR/describe-network-interfaces.json"
aws ec2 describe-network-interfaces --region "$AWS_REGION" --network-interface-ids "${eni_array[@]}" \
  --output json | jq -cS . > "$eni_raw"
jq -e --argjson subnets "$(printf '%s\n' "${task_subnets[@]}" | sort | jq -R . | jq -s .)" \
  --arg sg "$task_security_group" '
  (.NetworkInterfaces|length)>=1
  and all(.NetworkInterfaces[]; (.Association//null)==null and (.SubnetId|IN($subnets[]))
    and ([.Groups[].GroupId]|sort)==[$sg] and (.PrivateIpAddress|type=="string" and length>0))
' "$eni_raw" >/dev/null

aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn"
aws ecs describe-tasks --region "$AWS_REGION" --cluster "$cluster" --tasks "$task_arn" \
  --output json | jq -cS . > "$task_raw"
jq -e --arg task "$task_arn" --arg definition "$task_definition_arn" --arg group "family:$family" \
  --arg started "$started_by" '
  .failures==[] and (.tasks|length)==1 and .tasks[0].taskArn==$task
  and .tasks[0].lastStatus=="STOPPED" and .tasks[0].taskDefinitionArn==$definition
  and .tasks[0].group==$group and .tasks[0].startedBy==$started
  and (.tasks[0].containers|length)==1 and .tasks[0].containers[0].exitCode==0
' "$task_raw" >/dev/null
exit_code="$(jq -er '.tasks[0].containers[0].exitCode' "$task_raw")"

task_id="${task_arn##*/}"
log_stream="production-a5/reader/$task_id"
pages="$OUTPUT_DIR/log-pages"
mkdir "$pages"
next_token=''
for page in $(seq 1 100); do
  page_file="$pages/$page.json"
  if [ -z "$next_token" ]; then
    aws logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group" \
      --log-stream-name "$log_stream" --start-from-head --limit 10000 --output json \
      | jq -cS . > "$page_file"
  else
    aws logs get-log-events --region "$AWS_REGION" --log-group-name "$log_group" \
      --log-stream-name "$log_stream" --start-from-head --limit 10000 --next-token "$next_token" \
      --output json | jq -cS . > "$page_file"
  fi
  new_token="$(jq -er '.nextForwardToken' "$page_file")"
  if [ -n "$next_token" ] && [ "$new_token" = "$next_token" ]; then break; fi
  next_token="$new_token"
  [ "$page" -lt 100 ]
done
logs="$OUTPUT_DIR/log-events.json"
jq -csS '{events:[.[]|.events[]]}' "$pages"/*.json > "$logs"
bash "$(dirname "$0")/reconstruct-production-a5-result.sh" "$logs" "$marker" "$OUTPUT_DIR/payload.json"
payload_hash="$(sha_file "$OUTPUT_DIR/payload.json")"
payload_size="$(wc -c < "$OUTPUT_DIR/payload.json" | tr -d '[:space:]')"
frame_count="$(jq -r --arg marker "$marker" '[.events[]|select(.message|startswith("A5_PRODUCTION_RESULT "+$marker+" "))]|length' "$logs")"

task_definition_raw="$OUTPUT_DIR/describe-task-definition.json"
aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$task_definition_arn" \
  --output json | jq -cS . > "$task_definition_raw"
reader_after="$OUTPUT_DIR/reader-secret-after.json"
aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$reader_secret_name" \
  --output json | jq -cS . > "$reader_after"
test "$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  |select(length==1)|.[0]' "$reader_after")" = "$reader_version"

private_ips="$(jq -cS '[.NetworkInterfaces[].PrivateIpAddress]|unique|sort' "$eni_raw")"
runtime="$OUTPUT_DIR/reader-runtime.json"
jq -cnS --arg source "$SOURCE_SHA" --arg stage "$A5_STAGE" --arg image "$MIGRATION_IMAGE" \
  --arg cluster "$cluster_arn" --arg secretArn "$reader_secret_arn" --arg version "$reader_version" \
  --arg secretMetadataHash "$(sha_json "$reader_after")" --arg definition "$task_definition_arn" \
  --arg family "$family" --argjson revision "$task_definition_revision" \
  --arg definitionHash "$(sha_json "$task_definition_raw")" --arg execution "$execution_role" \
  --arg task "$task_arn" --arg started "$started_by" --argjson exitCode "$exit_code" \
  --argjson privateIps "$private_ips" --arg taskSg "$task_security_group" --arg dbSg "$db_security_group" \
  --argjson subnets "$(printf '%s\n' "${task_subnets[@]}" | sort | jq -R . | jq -s .)" \
  --arg db "$db_identifier" --arg taskHash "$(sha_json "$task_raw")" \
  --arg eniHash "$(sha_json "$eni_raw")" --arg taskSgHash "$(sha_json "$task_sg_raw")" \
  --arg dbSgHash "$(sha_json "$db_sg_raw")" --arg subnetHash "$(sha_json "$subnet_raw")" \
  --arg dbHash "$(sha_json "$db_raw")" --arg inputHash "$input_hash" --arg marker "$marker" \
  --arg logGroup "$log_group" --arg logStream "$log_stream" --arg eventsHash "$(sha_json "$logs")" \
  --argjson frames "$frame_count" --argjson payloadBytes "$payload_size" --arg payloadHash "$payload_hash" \
  --slurpfile endpointBoundary "$endpoint_boundary" \
  --arg endpointSgHash "$(sha_json "$endpoint_sg_raw")" \
  --arg endpointsHash "$(sha_json "$vpc_endpoints_raw")" --arg routesHash "$(sha_json "$route_tables_raw")" '
  {schemaVersion:1,sourceCommit:$source,stage:$stage,migrationImage:$image,clusterArn:$cluster,
   readerSecret:{arn:$secretArn,versionId:$version,versionStage:"AWSCURRENT",metadataSha256:$secretMetadataHash},
   taskDefinition:{arn:$definition,family:$family,revision:$revision,sha256:$definitionHash,
     executionRoleArn:$execution,taskRoleArn:null},
   task:{arn:$task,startedBy:$started,lastStatus:"STOPPED",exitCode:$exitCode,
     privateIps:$privateIps,describeTasksSha256:$taskHash,describeNetworkInterfacesSha256:$eniHash},
   network:{assignPublicIp:"DISABLED",privateSubnetIds:$subnets,taskSecurityGroupId:$taskSg,
     databaseSecurityGroupId:$dbSg,databaseInstanceIdentifier:$db,databasePubliclyAccessible:false,
     endpointBoundary:$endpointBoundary[0],
     describeTaskSecurityGroupSha256:$taskSgHash,describeDatabaseSecurityGroupSha256:$dbSgHash,
     describeSubnetsSha256:$subnetHash,describeDbInstanceSha256:$dbHash,
     describeEndpointSecurityGroupSha256:$endpointSgHash,
     describeVpcEndpointsSha256:$endpointsHash,describeRouteTablesSha256:$routesHash},
   inputBundleSha256:$inputHash,
   output:{marker:$marker,logGroup:$logGroup,logStream:$logStream,frameCount:$frames,
     payloadBytes:$payloadBytes,payloadSha256:$payloadHash,eventsSha256:$eventsHash,exitCode:$exitCode}}
' > "$runtime"

# Input/task registration files contain the reviewed bundle. They are local controller scratch and
# never part of the signed/uploaded artifact; only their hashes/revision are retained.
rm -rf -- "$pages"
rm -f -- "$OUTPUT_DIR/input.canonical.json" "$task_definition" "$registered" "$run_task"
aws ecs deregister-task-definition --region "$AWS_REGION" --task-definition "$task_definition_arn" >/dev/null
task_definition_arn=''
trap - EXIT
printf '%s\n' "$OUTPUT_DIR/payload.json" "$runtime"
