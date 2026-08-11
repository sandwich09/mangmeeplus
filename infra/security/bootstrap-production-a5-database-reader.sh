#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <watchdog-bms-migration-tool@sha256:digest> <full-main-source-sha> <LEGACY_PRE_F1|F1_CURRENT>" >&2
  exit 2
fi

image="$1"
source_sha="$2"
schema_profile="$3"
account_id=311414082667
region=ap-southeast-1
cluster=watchdog-bms-prod
parameter_prefix=/watchdog-bms/production/a5-readonly-runtime
writer_name=watchdog-bms/production/database-url
reader_name=watchdog-bms/production/a5-readonly-database-url
reader_description='Production-only SELECT credential for signed A5 evidence'
family="watchdog-a5-production-bootstrap-${source_sha:0:12}"
bootstrap_execution_role_name=watchdog-bms-production-a5-bootstrap-execution
task_definition_arn=''
task_arn=''
reader_created=false
completed=false
bootstrap_role_removed=false
bootstrap_cleanup_armed=false
secret_file=''
docker_config=''

case "$schema_profile" in LEGACY_PRE_F1|F1_CURRENT) ;; *) exit 2 ;; esac
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]

remove_bootstrap_execution_authority() {
  $bootstrap_cleanup_armed || return 0
  $bootstrap_role_removed && return 0
  if aws iam get-role --role-name "$bootstrap_execution_role_name" >/dev/null 2>&1; then
    test "$(aws iam list-attached-role-policies --role-name "$bootstrap_execution_role_name" \
      --output json | jq -cS '.AttachedPolicies')" = '[]'
    test "$(aws iam list-role-policies --role-name "$bootstrap_execution_role_name" \
      --output json | jq -cS '.PolicyNames|sort')" \
      = "$(jq -cnS --arg name "$bootstrap_execution_role_name" '[$name]')"
    aws iam delete-role-policy --role-name "$bootstrap_execution_role_name" \
      --policy-name "$bootstrap_execution_role_name"
    aws iam delete-role --role-name "$bootstrap_execution_role_name"
  fi
  if aws iam get-role --role-name "$bootstrap_execution_role_name" >/dev/null 2>&1; then
    echo 'ERROR: bootstrap execution role still exists after revocation' >&2
    return 1
  fi
  bootstrap_role_removed=true
}

cleanup() {
  local status=$?
  unset reader_url reader_password
  [ -z "$secret_file" ] || rm -f -- "$secret_file"
  if [ -n "$docker_config" ] && [ -d "$docker_config" ] \
      && [[ "$docker_config" == "${TMPDIR:-/tmp}"/production-a5-bootstrap-docker.* ]]; then
    rm -rf -- "$docker_config"
  fi
  if [ -n "$task_arn" ]; then
    current="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task_arn" \
      --query 'tasks[0].lastStatus' --output text 2>/dev/null || true)"
    if [ "$current" != STOPPED ] && [ "$current" != None ] && [ -n "$current" ]; then
      aws ecs stop-task --region "$region" --cluster "$cluster" --task "$task_arn" \
        --reason production-a5-bootstrap-cleanup >/dev/null 2>&1 || status=1
      aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task_arn" \
        >/dev/null 2>&1 || status=1
    fi
  fi
  if [ -n "$task_definition_arn" ]; then
    aws ecs deregister-task-definition --region "$region" --task-definition "$task_definition_arn" \
      >/dev/null 2>&1 || status=1
  fi
  remove_bootstrap_execution_authority || status=1
  if $reader_created && ! $completed; then
    # A failed/ambiguous first bootstrap must not leave a secret that appears usable. The DB role
    # may exist with an unreachable password; the next run creates a fresh secret and re-hardens it.
    aws secretsmanager delete-secret --region "$region" --secret-id "$reader_name" \
      --force-delete-without-recovery >/dev/null 2>&1 || status=1
  fi
  exit "$status"
}
trap cleanup EXIT

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = "$account_id"
test "$(aws sts get-caller-identity --region "$region" --query Account --output text)" = "$account_id"
bootstrap_cleanup_armed=true
git fetch --quiet origin main --force
git cat-file -e "${source_sha}^{commit}"
git merge-base --is-ancestor "$source_sha" origin/main
command -v cosign >/dev/null 2>&1
docker_config="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-bootstrap-docker.XXXXXX")"
aws ecr get-login-password --region "$region" \
  | DOCKER_CONFIG="$docker_config" docker login --username AWS --password-stdin \
      "$account_id.dkr.ecr.$region.amazonaws.com" >/dev/null
DOCKER_CONFIG="$docker_config" cosign verify \
  --certificate-identity "https://github.com/MangmeeDev/mangmeeplus/.github/workflows/production-a5-clone.yml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com "$image" >/dev/null
DOCKER_CONFIG="$docker_config" docker pull --platform linux/amd64 "$image" >/dev/null
DOCKER_CONFIG="$docker_config" bash "$(dirname "$0")/verify-production-a5-migration-tool.sh" \
  "$image" "$source_sha" >/dev/null
digest="${image##*@}"
aws ecr describe-images --region "$region" --repository-name watchdog-bms-migration-tool \
  --image-ids "imageDigest=$digest" --output json | jq -e --arg digest "$digest" '
    (.imageDetails|length)==1 and .imageDetails[0].imageDigest==$digest
' >/dev/null

parameter() {
  aws ssm get-parameter --region "$region" --name "$parameter_prefix/$1" \
    --query Parameter.Value --output text
}
network_parameter() {
  aws ssm get-parameter --region "$region" --name "/watchdog-bms/production/a5-network/$1" \
    --query Parameter.Value --output text
}
db_identifier="$(parameter db-instance-identifier)"
db_security_group="$(parameter db-security-group-id)"
task_security_group="$(parameter task-security-group-id)"
task_subnet_csv="$(parameter task-subnet-ids)"
execution_role="$(parameter bootstrap-execution-role-arn)"
log_group="$(parameter bootstrap-log-group-name)"
endpoint_security_group="$(network_parameter endpoint-security-group-id)"
s3_prefix_list="$(network_parameter s3-prefix-list-id)"
test "$(network_parameter reader-task-security-group-id)" = "$task_security_group"
test "$(network_parameter production-db-security-group-id)" = "$db_security_group"
test "$db_identifier" = watchdog-bms-prod-db
test "$execution_role" = arn:aws:iam::311414082667:role/watchdog-bms-production-a5-bootstrap-execution
test "$log_group" = /ecs/watchdog-bms-production-a5-bootstrap
[[ "$db_security_group" =~ ^sg-[0-9a-f]{8,17}$ && "$task_security_group" =~ ^sg-[0-9a-f]{8,17}$ ]]
IFS=, read -r -a task_subnets <<< "$task_subnet_csv"
[ "${#task_subnets[@]}" -eq 2 ]
for subnet in "${task_subnets[@]}"; do [[ "$subnet" =~ ^subnet-[0-9a-f]{8,17}$ ]]; done

network_work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-bootstrap-network.XXXXXX")"
aws ec2 describe-security-groups --region "$region" --group-ids "$task_security_group" \
  --output json > "$network_work/task.json"
aws ec2 describe-security-groups --region "$region" --group-ids "$db_security_group" \
  --output json > "$network_work/database.json"
bash "$(dirname "$0")/validate-production-a5-readonly-security-groups.sh" \
  "$network_work/task.json" "$network_work/database.json" "$task_security_group" "$db_security_group" \
  "$endpoint_security_group" "$s3_prefix_list" exact
aws ec2 describe-subnets --region "$region" --subnet-ids "${task_subnets[@]}" --output json \
  | jq -e --argjson expected "$(printf '%s\n' "${task_subnets[@]}" | jq -R . | jq -sS .)" '
      (.Subnets|length)==2 and all(.[];.State=="available" and .MapPublicIpOnLaunch==false)
      and ([.Subnets[].SubnetId]|sort)==$expected
    ' >/dev/null
rm -rf -- "$network_work"

database="$(aws rds describe-db-instances --region "$region" --db-instance-identifier "$db_identifier" \
  --query 'DBInstances[0]' --output json)"
jq -e --arg id "$db_identifier" --arg sg "$db_security_group" '
  .DBInstanceIdentifier==$id and .Engine=="postgres" and .DBInstanceStatus=="available"
  and .PubliclyAccessible==false and .StorageEncrypted==true
  and ([.VpcSecurityGroups[]|select(.Status=="active")|.VpcSecurityGroupId])==[$sg]
  and (.Endpoint.Address|type=="string" and length>0) and (.Endpoint.Port|type=="number")
  and (.DBName|type=="string" and length>0)
' <<< "$database" >/dev/null
db_host="$(jq -er '.Endpoint.Address' <<< "$database")"
db_port="$(jq -er '.Endpoint.Port' <<< "$database")"
db_name="$(jq -er '.DBName' <<< "$database")"

writer_metadata="$(aws secretsmanager describe-secret --region "$region" --secret-id "$writer_name" --output json)"
writer_arn="$(jq -er '.ARN|select(test("^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/database-url-"))' <<< "$writer_metadata")"
writer_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))' <<< "$writer_metadata")"

reader_status=0
reader_metadata="$(aws secretsmanager describe-secret --region "$region" --secret-id "$reader_name" \
  --output json 2>&1)" || reader_status=$?
if [ "$reader_status" -ne 0 ]; then
  grep -F ResourceNotFoundException <<< "$reader_metadata" >/dev/null
  reader_password="$(openssl rand -base64 48 | tr -d '\n')"
  reader_url="$(READER_PASSWORD="$reader_password" DB_HOST="$db_host" DB_PORT="$db_port" DB_NAME="$db_name" node -e '
    const url = new URL("postgresql://placeholder/placeholder");
    url.username = "watchdog_a5_prod_ro";
    url.password = process.env.READER_PASSWORD || "";
    url.hostname = process.env.DB_HOST || "";
    url.port = process.env.DB_PORT || "5432";
    url.pathname = `/${encodeURIComponent(process.env.DB_NAME || "")}`;
    url.searchParams.set("schema", "public");
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", "/etc/ssl/certs/aws-rds-global-bundle.pem");
    process.stdout.write(url.toString());
  ')"
  secret_file="$(mktemp "${TMPDIR:-/tmp}/production-a5-reader-secret.XXXXXX")"
  chmod 600 "$secret_file"
  printf '%s' "$reader_url" > "$secret_file"
  reader_arn="$(aws secretsmanager create-secret --region "$region" --name "$reader_name" \
    --description "$reader_description" --secret-string "file://$secret_file" \
    --tags Key=purpose,Value=production-a5-readonly --query ARN --output text)"
  reader_created=true
  rm -f -- "$secret_file"
  secret_file=''
  unset reader_url reader_password
  reader_metadata="$(aws secretsmanager describe-secret --region "$region" --secret-id "$reader_name" --output json)"
else
  jq -e --arg name "$reader_name" --arg description "$reader_description" '
    .Name==$name and .Description==$description and .DeletedDate==null
  ' <<< "$reader_metadata" >/dev/null
  reader_arn="$(jq -er '.ARN' <<< "$reader_metadata")"
fi
[[ "$reader_arn" =~ ^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url- ]]
reader_version="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]|select(test("^[A-Fa-f0-9-]{32,64}$"))' <<< "$reader_metadata")"

task_definition="$(mktemp "${TMPDIR:-/tmp}/production-a5-bootstrap-task.XXXXXX")"
jq -cnS --arg family "$family" --arg execution "$execution_role" --arg image "$image" \
  --arg writer "${writer_arn}:::${writer_version}" --arg reader "${reader_arn}:::${reader_version}" \
  --arg source "$source_sha" --arg profile "$schema_profile" --arg region "$region" \
  --arg logGroup "$log_group" '
  {family:$family,executionRoleArn:$execution,networkMode:"awsvpc",requiresCompatibilities:["FARGATE"],
   cpu:"1024",memory:"2048",runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},
   volumes:[{name:"tmp"}],containerDefinitions:[{
     name:"bootstrap",image:$image,essential:true,readonlyRootFilesystem:true,user:"node",
     workingDirectory:"/app",command:["/app/node_modules/.bin/tsx","--tsconfig",
       "/app/apps/api/tsconfig.json","/app/apps/api/prisma/bootstrap-a5-readonly.ts"],
     environment:[{name:"DEPLOY_ENV",value:"production"},{name:"A5_TARGET_ENVIRONMENT",value:"production"},
       {name:"A5_SCHEMA_PROFILE",value:$profile},{name:"GIT_SHA",value:$source},
       {name:"HOME",value:"/tmp"},{name:"TMPDIR",value:"/tmp"}],
     secrets:[{name:"DATABASE_URL",valueFrom:$writer},{name:"A5_READONLY_DATABASE_URL",valueFrom:$reader}],
     mountPoints:[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}],portMappings:[],
     linuxParameters:{initProcessEnabled:true},stopTimeout:120,
     logConfiguration:{logDriver:"awslogs",options:{"awslogs-group":$logGroup,
       "awslogs-region":$region,"awslogs-stream-prefix":"production-a5"}}
   }]}
' > "$task_definition"
registered="$(aws ecs register-task-definition --region "$region" --cli-input-json "file://$task_definition" --output json)"
rm -f -- "$task_definition"
task_definition_arn="$(jq -er '.taskDefinition.taskDefinitionArn' <<< "$registered")"
jq -e --arg execution "$execution_role" --arg image "$image" --arg writerVersion "$writer_version" \
  --arg readerVersion "$reader_version" '
  .taskDefinition.executionRoleArn==$execution and .taskDefinition.taskRoleArn==null
  and (.taskDefinition.containerDefinitions|length)==1
  and .taskDefinition.containerDefinitions[0].image==$image
  and (.taskDefinition.containerDefinitions[0].secrets|length)==2
  and all(.taskDefinition.containerDefinitions[0].secrets[]; . as $secret
    | $secret.valueFrom|endswith(":::"+(if $secret.name=="DATABASE_URL" then $writerVersion else $readerVersion end)))
' <<< "$registered" >/dev/null

network="$(jq -cn --arg subnets "$task_subnet_csv" --arg sg "$task_security_group" '
  {awsvpcConfiguration:{subnets:($subnets|split(",")|sort),securityGroups:[$sg],assignPublicIp:"DISABLED"}}
')"
run="$(aws ecs run-task --region "$region" --cluster "$cluster" --launch-type FARGATE \
  --platform-version 1.4.0 --task-definition "$task_definition_arn" \
  --network-configuration "$network" --started-by "a5-bootstrap-${source_sha:0:12}" --output json)"
jq -e '.failures==[] and (.tasks|length)==1' <<< "$run" >/dev/null
task_arn="$(jq -er '.tasks[0].taskArn' <<< "$run")"
aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task_arn"
task="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task_arn" --output json)"
jq -e --arg definition "$task_definition_arn" '
  .failures==[] and (.tasks|length)==1 and .tasks[0].lastStatus=="STOPPED"
  and .tasks[0].taskDefinitionArn==$definition
  and (.tasks[0].group|startswith("family:watchdog-a5-production-bootstrap-"))
  and (.tasks[0].containers|length)==1 and .tasks[0].containers[0].exitCode==0
' <<< "$task" >/dev/null

# The AWSCURRENT version used by the task must still be the sole current version after hardening.
reader_after="$(aws secretsmanager describe-secret --region "$region" --secret-id "$reader_name" --output json)"
reader_version_after="$(jq -er '[.VersionIdsToStages|to_entries[]|select(.value|index("AWSCURRENT"))|.key]
  | select(length==1)|.[0]' <<< "$reader_after")"
test "$reader_version_after" = "$reader_version"
remove_bootstrap_execution_authority
completed=true
printf '{"artifact":"production-a5-reader-bootstrap","readerRole":"watchdog_a5_prod_ro","readerSecretVersionId":"%s","taskDefinitionArn":"%s","taskArn":"%s"}\n' \
  "$reader_version" "$task_definition_arn" "$task_arn"
