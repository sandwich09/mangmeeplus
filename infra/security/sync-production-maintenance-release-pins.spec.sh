#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
syncer="$repo_root/infra/security/sync-production-maintenance-release-pins.mjs"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/maintenance-pin-sync.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/.github/workflows" "$fixture/infra" "$fixture/apps"
printf 'proxy-v1\n' > "$fixture/infra/proxy.mjs"
printf 'deploy-v1\n' > "$fixture/apps/deploy.sh"
printf 'presentation-v1\n' > "$fixture/apps/presentation.tsx"
cat > "$fixture/infra/security-validator.sh" <<'EOF'
expected_proxy=0000000000000000000000000000000000000000000000000000000000000000
expected_deploy=0000000000000000000000000000000000000000000000000000000000000000
check_file infra/proxy.mjs "$expected_proxy"
check_file 'apps/deploy.sh' "$expected_deploy"
EOF
mkdir -p "$fixture/infra/security"
mv "$fixture/infra/security-validator.sh" \
  "$fixture/infra/security/validate-production-maintenance-release.sh"
cat > "$fixture/.github/workflows/deploy-production.yml" <<'EOF'
env:
  EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256: 0000000000000000000000000000000000000000000000000000000000000000
EOF

if node "$syncer" --check "$fixture" >/dev/null 2>&1; then
  echo "ERROR: pin sync check accepted stale fixture pins" >&2
  exit 1
fi
node "$syncer" "$fixture" >/dev/null
node "$syncer" --check "$fixture" >/dev/null
first_pin="$(awk '/EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256:/ { print $2 }' \
  "$fixture/.github/workflows/deploy-production.yml")"

printf 'presentation-v2\n' > "$fixture/apps/presentation.tsx"
node "$syncer" --check "$fixture" >/dev/null
test "$(awk '/EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256:/ { print $2 }' \
  "$fixture/.github/workflows/deploy-production.yml")" = "$first_pin"

printf 'proxy-v2\n' > "$fixture/infra/proxy.mjs"
if node "$syncer" --check "$fixture" >/dev/null 2>&1; then
  echo "ERROR: pin sync check accepted changed enforcement bytes" >&2
  exit 1
fi
node "$syncer" "$fixture" >/dev/null
node "$syncer" --check "$fixture" >/dev/null
test "$(awk '/EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256:/ { print $2 }' \
  "$fixture/.github/workflows/deploy-production.yml")" != "$first_pin"

node "$syncer" --check "$repo_root" >/dev/null
echo "production maintenance pin sync: PASS"
