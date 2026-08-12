#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
runner="$root/infra/security/run-production-migration-catalog-readiness.sh"
validator="$root/infra/security/validate-production-migration-catalog-task-definition.sh"
reconstruct="$root/infra/security/reconstruct-production-migration-catalog-result.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/production-catalog-readiness.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
source="$(printf 'a%.0s' {1..40})"
digest="$(printf 'b%.0s' {1..64})"
image="311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-migration-tool@sha256:$digest"
secret=arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-AbCd12
version=12345678-1234-1234-1234-123456789abc
family=watchdog-a5-production-catalog-7001-a2
log=/ecs/watchdog-bms-production-a5-readonly

jq -cnS --arg family "$family" --arg image "$image" --arg secret "${secret}:::${version}" \
  --arg source "$source" --arg log "$log" '
  {taskDefinition:{family:$family,
   taskDefinitionArn:("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"+$family+":1"),revision:1,
   executionRoleArn:"arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution",
   networkMode:"awsvpc",requiresCompatibilities:["FARGATE"],cpu:"1024",memory:"2048",
   runtimePlatform:{cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"},volumes:[{name:"tmp"}],
   containerDefinitions:[{name:"catalog",image:$image,essential:true,readonlyRootFilesystem:true,
    user:"node",workingDirectory:"/app",command:["/app/node_modules/.bin/tsx","--tsconfig",
      "/app/apps/api/tsconfig.json","/app/apps/api/prisma/verify-applied-migration-catalog.ts"],
    environment:[{name:"ALLOW_PENDING_MIGRATIONS",value:"true"},{name:"GIT_SHA",value:$source},
      {name:"HOME",value:"/tmp"},{name:"REQUIRE_NO_AWS_CREDENTIALS",value:"true"},
      {name:"TMPDIR",value:"/tmp"},{name:"XDG_CACHE_HOME",value:"/tmp/cache"}],
    secrets:[{name:"DATABASE_URL",valueFrom:$secret}],
    mountPoints:[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}],portMappings:[],
    linuxParameters:{initProcessEnabled:true},stopTimeout:120,
    logConfiguration:{logDriver:"awslogs",options:{"awslogs-group":$log,
      "awslogs-region":"ap-southeast-1","awslogs-stream-prefix":"production-readiness"}}}]}}
' > "$work/good.json"

validate() { bash "$validator" "$1" "$family" "$image" "$secret" "$version" "$source" "$log"; }
validate "$work/good.json"
reject() {
  if validate "$work/$1.json" >/dev/null 2>&1; then
    echo "ERROR: catalog task validator accepted $1" >&2; exit 1
  fi
}
jq '.taskDefinition.taskRoleArn="arn:aws:iam::311414082667:role/writer"' "$work/good.json" > "$work/task-role.json"
reject task-role
jq '.taskDefinition.containerDefinitions[0].command[-1]="/app/other.ts"' "$work/good.json" > "$work/command.json"
reject command
jq '.taskDefinition.containerDefinitions[0].environment[] |=
  if .name=="ALLOW_PENDING_MIGRATIONS" then .value="false" else . end' "$work/good.json" > "$work/no-pending.json"
reject no-pending
jq '.taskDefinition.containerDefinitions[0].secrets[0].valueFrom |= sub("12345678";"87654321")' \
  "$work/good.json" > "$work/version.json"
reject version

result="$work/result.json"
jq -cnS --arg source "$source" '
  {schemaVersion:1,sourceCommit:$source,status:"EXACT_MATCH",migrationCount:3,
   appliedMigrationCount:3,pendingMigrationCount:0,repositoryCatalogHash:("1"*64),
   appliedCatalogHash:("2"*64),pendingCatalogHash:("3"*64)}
' > "$result"
if command -v sha256sum >/dev/null 2>&1; then hash="$(sha256sum "$result"|awk '{print $1}')"
else hash="$(shasum -a 256 "$result"|awk '{print $1}')"; fi
if base64 -w 0 "$result" > "$work/body" 2>/dev/null; then :
else base64 < "$result" | tr -d '\n' > "$work/body"; fi
jq -cnS --arg message "INCIDENT_CATALOG_RESULT 1/1 $hash $(<"$work/body")" \
  '{events:[{message:$message}]}' > "$work/logs.json"
bash "$reconstruct" "$work/logs.json" "$work/reconstructed.json"
cmp -s "$result" "$work/reconstructed.json"
jq '.events += [.events[0]]' "$work/logs.json" > "$work/duplicate.json"
if bash "$reconstruct" "$work/duplicate.json" "$work/reject.json" >/dev/null 2>&1; then
  echo 'ERROR: duplicate catalog result was accepted' >&2; exit 1
fi

bash -n "$runner" "$validator" "$reconstruct"
for required in 'assignPublicIp:"DISABLED"' 'REQUIRE_NO_AWS_CREDENTIALS' \
  'validate-production-a5-private-endpoints.sh' 'BackupRetentionPeriod>=35' \
  'repositoryCatalogHash' 'deregister-task-definition' \
  'register-task-definition-with-retry.sh' 'run-task-idempotently.sh' 'run_client_token' \
  'cleanup-one-shot-task.sh' 'registration_requested=true' 'run_task_requested=true'; do
  grep -F -- "$required" "$runner" >/dev/null
done
registration_arm_line="$(grep -n 'registration_requested=true' "$runner" | cut -d: -f1)"
registration_call_line="$(grep -n 'register-task-definition-with-retry.sh' "$runner" | cut -d: -f1)"
run_arm_line="$(grep -n 'run_task_requested=true' "$runner" | cut -d: -f1)"
run_call_line="$(grep -n 'run-task-idempotently.sh' "$runner" | cut -d: -f1)"
test "$registration_arm_line" -lt "$registration_call_line"
test "$run_arm_line" -lt "$run_call_line"
jq -e '
  (.Statement[]|select(.Sid=="AllowExactA5TaskRun")
    |.Action=="ecs:RunTask"
    and .Resource=="arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-a5-production-*:*")
  and (.Statement[]|select(.Sid=="AllowExactA5TaskStop")
    |.Action=="ecs:StopTask"
    and .Resource=="arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/*")
' "$root/infra/security/production-a5-readonly-policy.template.json" >/dev/null
for required in readiness-v2 run-release-readiness-clone.ts \
  PRODUCTION_READY_EXPECTED_PENDING_CATALOG_HASH PRODUCTION_READY_EXPECTED_PENDING_COUNT; do
  grep -F -- "$required" "$root/infra/security/run-production-a5-clone.sh" >/dev/null
done
for forbidden in get-secret-value watchdog-bms/production/database-url 'assignPublicIp:"ENABLED"'; do
  if grep -F -- "$forbidden" "$runner" >/dev/null; then
    echo "ERROR: catalog readiness runner contains forbidden path: $forbidden" >&2; exit 1
  fi
done
echo 'production migration catalog readiness: PASS'
