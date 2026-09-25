#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "Usage: $0 <task-definition.json> <family> <image> <secret-arn> <version-id> <source-sha> <log-group>" >&2
  exit 2
fi
input="$1" family="$2" image="$3" secret="$4" version="$5" source="$6" log_group="$7"
[[ "$family" =~ ^watchdog-a5-production-catalog-[1-9][0-9]*-a[1-9][0-9]*$ ]]
[[ "$image" =~ ^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
[[ "$secret" =~ ^arn:aws:secretsmanager:ap-southeast-1:311414082667:secret:watchdog-bms/production/a5-readonly-database-url-[A-Za-z0-9/_+=.@-]+$ ]]
[[ "$version" =~ ^[A-Fa-f0-9-]{32,64}$ && "$source" =~ ^[0-9a-f]{40}$ ]]
test "$log_group" = /ecs/watchdog-bms-production-a5-readonly
[ -f "$input" ] && [ ! -L "$input" ]
jq -e --arg family "$family" --arg image "$image" --arg secret "${secret}:::${version}" \
  --arg source "$source" --arg log "$log_group" '
  .taskDefinition as $t
  | $t.family==$family
  and $t.executionRoleArn=="arn:aws:iam::311414082667:role/watchdog-bms-production-a5-readonly-execution"
  and ($t.taskRoleArn//null)==null and $t.networkMode=="awsvpc"
  and $t.requiresCompatibilities==["FARGATE"] and $t.cpu=="1024" and $t.memory=="2048"
  and $t.runtimePlatform=={cpuArchitecture:"X86_64",operatingSystemFamily:"LINUX"}
  and $t.volumes==[{name:"tmp",host:{}}] and ($t.containerDefinitions|length)==1
  and ($t.containerDefinitions[0] as $c
    | $c.name=="catalog" and $c.image==$image and $c.essential==true
    and $c.readonlyRootFilesystem==true and $c.user=="root" and $c.workingDirectory=="/app"
    and $c.entryPoint==["/bin/sh","-c"]
    and $c.command==["chmod 1777 /tmp && exec setpriv --reuid=node --regid=node --init-groups "+
      "/app/node_modules/.bin/tsx --tsconfig /app/apps/api/tsconfig.json "+
      "/app/apps/api/prisma/verify-applied-migration-catalog.ts"]
    and ($c.environment|sort_by(.name))==([
      {name:"ALLOW_PENDING_MIGRATIONS",value:"true"},{name:"GIT_SHA",value:$source},
      {name:"HOME",value:"/tmp"},{name:"REQUIRE_NO_AWS_CREDENTIALS",value:"true"},
      {name:"TMPDIR",value:"/tmp"},{name:"XDG_CACHE_HOME",value:"/tmp/cache"}]|sort_by(.name))
    and $c.secrets==[{name:"DATABASE_URL",valueFrom:$secret}]
    and $c.mountPoints==[{sourceVolume:"tmp",containerPath:"/tmp",readOnly:false}]
    and $c.portMappings==[] and $c.linuxParameters=={initProcessEnabled:true}
    and $c.stopTimeout==120
    and $c.logConfiguration=={logDriver:"awslogs",options:{"awslogs-group":$log,
      "awslogs-region":"ap-southeast-1","awslogs-stream-prefix":"production-readiness"}})
' "$input" >/dev/null
