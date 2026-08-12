#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 10 ]; then
  echo "Usage: $0 <registered.json> <family> <image> <reader-secret-arn> <version-id> <source-sha> <stage> <profile> <marker> <input-sha256>" >&2
  exit 2
fi
registered="$1"
family="$2"
image="$3"
secret_arn="$4"
version="$5"
source_sha="$6"
stage="$7"
profile="$8"
marker="$9"
input_hash="${10}"
execution=arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution
[[ "$family" =~ ^watchdog-a5-production-reader-[1-9][0-9]*-a[1-9][0-9]*-(pre|post-migration|post-deployment)$ ]]
[[ "$image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
[[ "$secret_arn" =~ ^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url- ]]
[[ "$version" =~ ^[A-Fa-f0-9-]{32,64}$ && "$source_sha" =~ ^[0-9a-f]{40}$ && "$input_hash" =~ ^[0-9a-f]{64}$ ]]

jq -e --arg family "$family" --arg execution "$execution" --arg image "$image" \
  --arg reader "${secret_arn}:::${version}" --arg source "$source_sha" --arg stage "$stage" \
  --arg profile "$profile" --arg marker "$marker" '
  .taskDefinition as $definition
  | $definition.family==$family and $definition.executionRoleArn==$execution
  and ($definition.revision|type)=="number" and $definition.revision>=1
  and $definition.taskDefinitionArn==("arn:aws:ecs:ap-southeast-1:311414082667:task-definition/"
    + $family + ":" + ($definition.revision|tostring))
  and $definition.taskRoleArn==null and $definition.networkMode=="awsvpc"
  and $definition.requiresCompatibilities==["FARGATE"] and $definition.cpu=="2048"
  and $definition.memory=="4096" and $definition.runtimePlatform=={
    cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"}
  and $definition.volumes==[{name:"tmp",host:{}}]
  and ($definition.containerDefinitions|length)==1
  and ($definition.containerDefinitions[0] as $container
    | $container.name=="reader" and $container.image==$image and $container.essential==true
      and $container.readonlyRootFilesystem==true and $container.user=="node"
      and $container.workingDirectory=="/app"
      and $container.command==["/app/node_modules/.bin/tsx",
        "--tsconfig","/app/apps/api/tsconfig.json",
        "/app/apps/api/prisma/production-a5/run-readonly-evidence-task.ts"]
      and $container.secrets==[{name:"A5_READONLY_DATABASE_URL",valueFrom:$reader}]
      and ($container.environment|map({key:.name,value:.value})|from_entries) as $env
      | ($env|keys|sort)==(["A5_SCHEMA_PROFILE","A5_TARGET_ENVIRONMENT","DEPLOY_ENV","GIT_SHA",
          "HOME","PRODUCTION_A5_INPUT_BUNDLE_B64","PRODUCTION_A5_RESULT_MARKER",
          "PRODUCTION_A5_STAGE","TMPDIR","XDG_CACHE_HOME"]|sort)
        and $env.DEPLOY_ENV=="production" and $env.A5_TARGET_ENVIRONMENT=="production"
        and $env.A5_SCHEMA_PROFILE==$profile and $env.GIT_SHA==$source
        and $env.PRODUCTION_A5_STAGE==$stage and $env.PRODUCTION_A5_RESULT_MARKER==$marker
        and ($env.PRODUCTION_A5_INPUT_BUNDLE_B64|type=="string" and length>0)
      and $container.mountPoints==[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}]
      and $container.portMappings==[] and $container.linuxParameters.initProcessEnabled==true
      and $container.stopTimeout==120
      and $container.logConfiguration=={logDriver:"awslogs",options:{
        "awslogs-group":"/ecs/watchdog-bms-production-a5-readonly",
        "awslogs-region":"ap-southeast-1","awslogs-stream-prefix":"production-a5"}})
' "$registered" >/dev/null

encoded="$(jq -er '.taskDefinition.containerDefinitions[0].environment[]
  |select(.name=="PRODUCTION_A5_INPUT_BUNDLE_B64")|.value' "$registered")"
[ "${#encoded}" -le 60000 ]
work="$(mktemp -d "${TMPDIR:-/tmp}/production-a5-task-definition.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
printf '%s' "$encoded" > "$work/input.base64"
if base64 --decode < "$work/input.base64" 2>/dev/null | gzip -d > "$work/input.json"; then :
else base64 -D < "$work/input.base64" | gzip -d > "$work/input.json"; fi
size="$(wc -c < "$work/input.json" | tr -d '[:space:]')"
[[ "$size" =~ ^[1-9][0-9]*$ ]] && [ "$size" -le 8388608 ]
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$work/input.json" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$work/input.json" | awk '{print $1}')"
fi
[ "$actual" = "$input_hash" ]
jq -cS . "$work/input.json" > "$work/canonical.json"
cmp -s "$work/input.json" "$work/canonical.json"
