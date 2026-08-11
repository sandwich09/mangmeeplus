#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <immutable-image@sha256:...> <source-sha>" >&2
  exit 2
fi

image="$1"
source_sha="$2"
[[ "$image" =~ ^[0-9]{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]

inspect="$(docker image inspect "$image")"
jq -e --arg source "$source_sha" '
  length == 1
  and .[0].Config.User == "node"
  and .[0].Config.WorkingDir == "/app"
  and (.[0].Config.ExposedPorts // {}) == {}
  and (.[0].Config.Healthcheck // null) == null
  and .[0].Config.Labels["org.opencontainers.image.revision"] == $source
  and .[0].Config.Labels["com.watchdog-bms.image-purpose"]
    == "production-a5-migration-tool"
' <<< "$inspect" >/dev/null

docker run --rm --entrypoint sh "$image" -c '
  set -eu
  require_path() {
    mode="$1"
    path="$2"
    if ! test "$mode" "$path"; then
      echo "ERROR: migration-tool image is missing required path: $path" >&2
      exit 1
    fi
  }
  require_path -x /app/apps/api/node_modules/.bin/prisma
  require_path -x /app/node_modules/.bin/tsx
  require_path -f /app/apps/api/prisma/schema.prisma
  require_path -d /app/apps/api/prisma/migrations
  require_path -f /app/apps/api/prisma/production-a5/run-clone-rehearsal.ts
  require_path -f /app/apps/api/prisma/production-a5/run-readonly-evidence-task.ts
  require_path -f /app/apps/api/prisma/production-a5/print-reviewed-candidate-hashes.ts
  require_path -f /app/apps/api/prisma/bootstrap-a5-readonly.ts
  require_path -f /app/apps/api/src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts
  require_path -f /app/pnpm-lock.yaml
'

echo "production A5 migration-tool image: PASS"
