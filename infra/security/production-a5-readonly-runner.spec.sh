#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validator="$repo_root/infra/security/validate-production-a5-readonly-task-definition.sh"
runner="$repo_root/infra/security/run-production-a5-readonly.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-readonly-runner-spec.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source_sha="$(printf 'a%.0s' {1..40})"
version=12345678-1234-1234-1234-123456789abc
digest="$(printf 'b%.0s' {1..64})"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-migration-tool@sha256:$digest"
secret=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-AbCd12
family=watchdog-a5-production-reader-7001-a2-pre
marker=a5-prod-7001-a2-pre
jq -cnS '{schemaVersion:1,stage:"PRE_MUTATION"}' > "$work/input.json"
if command -v sha256sum >/dev/null 2>&1; then
  input_hash="$(sha256sum "$work/input.json"|awk '{print $1}')"
else
  input_hash="$(shasum -a 256 "$work/input.json"|awk '{print $1}')"
fi
encoded="$(gzip -n -9 -c "$work/input.json"|base64|tr -d '\n')"
jq -cnS --arg family "$family" --arg execution arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution \
  --arg image "$image" --arg reader "${secret}:::${version}" --arg input "$encoded" \
  --arg source "$source_sha" --arg marker "$marker" '{taskDefinition:{family:$family,
    taskDefinitionArn:("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"+$family+":1"),revision:1,
    executionRoleArn:$execution,networkMode:"awsvpc",requiresCompatibilities:["FARGATE"],cpu:"2048",memory:"4096",
    runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},volumes:[{name:"tmp"}],
    containerDefinitions:[{name:"reader",image:$image,essential:true,readonlyRootFilesystem:true,user:"node",
      workingDirectory:"/app",command:["/app/node_modules/.bin/tsx",
        "--tsconfig","/app/apps/api/tsconfig.json",
        "/app/apps/api/prisma/production-a5/run-readonly-evidence-task.ts"],
      environment:[{name:"DEPLOY_ENV",value:"production"},{name:"A5_TARGET_ENVIRONMENT",value:"production"},
        {name:"A5_SCHEMA_PROFILE",value:"LEGACY_PRE_F1"},{name:"GIT_SHA",value:$source},
        {name:"PRODUCTION_A5_STAGE",value:"PRE_MUTATION"},{name:"PRODUCTION_A5_RESULT_MARKER",value:$marker},
        {name:"PRODUCTION_A5_INPUT_BUNDLE_B64",value:$input},{name:"HOME",value:"/tmp"},
        {name:"TMPDIR",value:"/tmp"},{name:"XDG_CACHE_HOME",value:"/tmp/cache"}],
      secrets:[{name:"A5_READONLY_DATABASE_URL",valueFrom:$reader}],
      mountPoints:[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}],portMappings:[],
      linuxParameters:{initProcessEnabled:true},stopTimeout:120,
      logConfiguration:{logDriver:"awslogs",options:{"awslogs-group":"/ecs/watchdog-bms-production-a5-readonly",
        "awslogs-region":"ap-southeast-1","awslogs-stream-prefix":"production-a5"}}}]}}' > "$work/good.json"

validate() {
  bash "$validator" "$1" "$family" "$image" "$secret" "$version" "$source_sha" \
    PRE_MUTATION LEGACY_PRE_F1 "$marker" "$input_hash"
}
validate "$work/good.json"
expect_reject() {
  local label="$1"
  if validate "$work/$label.json" >/dev/null 2>&1; then
    echo "ERROR: $label was accepted" >&2
    exit 1
  fi
}
jq '.taskDefinition.taskRoleArn="arn:aws:iam::311414082667:role/watchdog-bms-api-task-role"' \
  "$work/good.json" > "$work/task-role.json"
expect_reject task-role
jq '.taskDefinition.executionRoleArn="arn:aws:iam::311414082667:role/ecsTaskExecutionRole"' \
  "$work/good.json" > "$work/shared-execution.json"
expect_reject shared-execution
jq '.taskDefinition.containerDefinitions[0].secrets[0].valueFrom |= sub("12345678";"87654321")' \
  "$work/good.json" > "$work/wrong-version.json"
expect_reject wrong-version
jq '.taskDefinition.containerDefinitions[0].environment[] |=
  if .name=="PRODUCTION_A5_INPUT_BUNDLE_B64" then .value="H4sIinvalid" else . end' \
  "$work/good.json" > "$work/wrong-input.json"
expect_reject wrong-input
jq '.taskDefinition.containerDefinitions[0].command=[
  "/app/node_modules/.bin/tsx",
  "/app/apps/api/prisma/production-a5/run-readonly-evidence-task.ts"]' \
  "$work/good.json" > "$work/missing-tsconfig.json"
expect_reject missing-tsconfig

bash -n "$runner" "$validator"
rg -q 'assignPublicIp:"DISABLED"' "$runner"
rg -q '"--tsconfig","/app/apps/api/tsconfig.json"' "$runner"
if [ "$(grep -c "'--tsconfig', '/app/apps/api/tsconfig.json'" \
    "$repo_root/apps/api/prisma/production-a5/run-readonly-evidence-task.ts")" -ne 2 ]; then
  echo 'ERROR: read-only child TSX commands are not bound to the API tsconfig' >&2
  exit 1
fi
rg -q 'Association//null.==null' "$runner" || rg -q 'Association//null)==null' "$runner"
if rg -n 'assignPublicIp:"ENABLED"|ecsTaskExecutionRole|taskRoleArn[[:space:]]*:[[:space:]]*"' "$runner"; then
  echo 'ERROR: public/shared/task role path is present' >&2
  exit 1
fi
if rg -n 'get-secret-value|DATABASE_URL:' "$runner"; then
  echo 'ERROR: controller reads or exports a database URL' >&2
  exit 1
fi

echo 'production A5 read-only runner spec: PASS'
