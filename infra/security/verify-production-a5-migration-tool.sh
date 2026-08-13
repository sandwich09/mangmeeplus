#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <immutable-image@sha256:...> <source-sha>" >&2
  exit 2
fi

image="$1"
source_sha="$2"
if ! [[ "$image" =~ ^[0-9]{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$ ]]; then
  echo 'ERROR: migration-tool image must be an immutable Production ECR digest' >&2
  exit 2
fi
if ! [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'ERROR: migration-tool source revision must be a full Git SHA' >&2
  exit 2
fi

inspect="$(docker image inspect "$image")"
jq -e --arg source "$source_sha" '
  length == 1
  and .[0].Config.User == "node"
  and .[0].Config.WorkingDir == "/app"
  and (.[0].Config.Volumes | keys) == ["/tmp"]
  and (.[0].Config.ExposedPorts // {}) == {}
  and (.[0].Config.Healthcheck // null) == null
  and .[0].Config.Labels["org.opencontainers.image.revision"] == $source
  and .[0].Config.Labels["com.watchdog-bms.image-purpose"]
    == "production-a5-migration-tool"
' <<< "$inspect" >/dev/null

docker run --rm --read-only --network none --entrypoint sh "$image" -c '
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
  require_path -f /app/apps/api/tsconfig.json
  require_path -f /app/apps/api/prisma/schema.prisma
  require_path -d /app/apps/api/prisma/migrations
  require_path -f /app/apps/api/prisma/production-a5/run-clone-rehearsal.ts
  require_path -f /app/apps/api/prisma/production-a5/run-release-readiness-clone.ts
  require_path -f /app/apps/api/prisma/production-a5/run-production-apply.ts
  require_path -f /app/apps/api/prisma/production-a5/run-readonly-evidence-task.ts
  require_path -f /app/apps/api/prisma/production-a5/print-reviewed-candidate-hashes.ts
  require_path -f /app/apps/api/prisma/bootstrap-a5-readonly.ts
  require_path -f /app/apps/api/prisma/verify-applied-migration-catalog.ts
  require_path -f /app/apps/api/src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts
  require_path -f /app/pnpm-lock.yaml

  test "$(id -u)" = 1000
  test "$(stat -c "%u:%g:%a" /tmp)" = "0:0:1777"
  probe="/tmp/a5-migration-tool-verifier-$$"
  trap "rm -rf -- \"$probe\"" EXIT
  mkdir "$probe"
  printf verified > "$probe/write"
  test "$(cat "$probe/write")" = verified
  if touch /app/.a5-migration-tool-write-probe 2>/dev/null; then
    echo "ERROR: migration-tool root filesystem is writable" >&2
    exit 1
  fi
  test ! -e /sys/class/net/eth0
  test ! -e /usr/bin/perl
  for package in perl-base libexpat1 fontconfig fontconfig-config; do
    status="$(dpkg-query -W -f="\${Status}" "$package" 2>/dev/null || true)"
    test "$status" != "install ok installed"
  done

  export HOME=/tmp TMPDIR=/tmp XDG_CACHE_HOME=/tmp/cache
  cd /app/apps/api
  /app/apps/api/node_modules/.bin/prisma validate --schema prisma/schema.prisma
  /app/apps/api/node_modules/.bin/prisma migrate diff \
    --from-empty --to-schema prisma/schema.prisma --script > "$probe/schema.sql"
  test -s "$probe/schema.sql"
  /app/node_modules/.bin/tsx --tsconfig tsconfig.json --eval \
    "if (process.cwd() !== \"/app/apps/api\") process.exit(1)"
'

echo "production A5 migration-tool image: PASS"
