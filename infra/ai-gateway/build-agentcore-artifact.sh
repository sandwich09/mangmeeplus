#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <output-directory> <full-commit-sha>" >&2
  exit 2
fi

output_dir="$1"
source_commit="$2"
pnpm_bin="${PNPM_BIN:-pnpm}"
if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]] || [ "$(git rev-parse HEAD)" != "$source_commit" ]; then
  echo "ERROR: AgentCore artifact must be built from the exact checked-out commit" >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: AgentCore artifact build requires a clean worktree" >&2
  exit 1
fi

"$pnpm_bin" --filter @watchdog-bms/contracts build
"$pnpm_bin" --filter @watchdog-bms/config build
"$pnpm_bin" --filter @watchdog-bms/ai-gateway run build:agentcore

staging="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-agentcore-build.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"

node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild \
  apps/ai-gateway/src/agentcore/runtime.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --external:sharp \
  --tsconfig=apps/ai-gateway/tsconfig.agentcore.json \
  --outfile="$staging/runtime.js" \
  --log-level=warning

# A bundle that cannot start only fails after rollout ("initialization time exceeded"), so start
# it here: no environment, a free port, /ping within 10 s, or the build stops.
smoke_port="$(node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})")"
(cd "$staging" && exec env -i PATH="$PATH" PORT="$smoke_port" node runtime.js) > "$staging/smoke.log" 2>&1 &
smoke_pid=$!
smoke_ok=no
for _ in $(seq 1 20); do
  sleep 0.5
  if curl -fs -o /dev/null "http://127.0.0.1:$smoke_port/ping"; then smoke_ok=yes; break; fi
done
kill "$smoke_pid" 2>/dev/null || true
wait "$smoke_pid" 2>/dev/null || true
if [ "$smoke_ok" != yes ]; then
  echo "ERROR: AgentCore runtime.js did not answer /ping within 10 s" >&2
  head -c 2000 "$staging/smoke.log" >&2
  exit 1
fi
rm -f "$staging/smoke.log"

# ZIP stores the input mtime even with -X. Normalize it so rebuilding one exact
# source commit cannot produce a second artifact identity and endpoint rollout.
TZ=UTC touch -t 198001010000.00 "$staging/runtime.js"
(cd "$staging" && zip -Xq "$output_dir/agentcore.zip" runtime.js)
artifact_sha="$(shasum -a 256 "$output_dir/agentcore.zip" | awk '{print $1}')"
jq -n \
  --arg sourceCommit "$source_commit" \
  --arg artifact "agentcore.zip" \
  --arg sha256 "$artifact_sha" \
  '{schemaVersion:1,sourceCommit:$sourceCommit,artifact:$artifact,sha256:$sha256}' \
  > "$output_dir/agentcore-artifact.json"

echo "[agentcore-artifact] source=$source_commit sha256=$artifact_sha"
