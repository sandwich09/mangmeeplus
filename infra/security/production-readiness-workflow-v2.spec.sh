#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
workflow="$root/.github/workflows/production-readiness.yml"
[ -f "$workflow" ]
ruby -e 'require "yaml"; value=YAML.load_file(ARGV[0]); abort unless value.is_a?(Hash)' "$workflow"

for required in \
  'workflow_run:' 'workflows: [UAT Deploy]' 'workflow_dispatch:' \
  'uat-release-passport-v2-' 'validate-uat-release-passport-v2.sh' \
  'collect-production-runtime-readiness-v2.sh' 'collect-production-a5-current-health.sh' \
  'run-production-migration-catalog-readiness.sh' 'APPEND_ONLY_PENDING' \
  'run-production-a5-clone.sh' \
  'validate-production-release-ready-v2.sh' 'PRODUCTION_RELEASE_READY_V2' \
  'production-release-ready-v2-' 'select-deploy-target.sh' \
  'requestedMode:$mode,effectiveTarget:$target'; do
  grep -F -- "$required" "$workflow" >/dev/null
done

for forbidden in \
  'pnpm test' 'pnpm typecheck' 'docker/build-push-action' 'docker build' \
  'cosign sign --yes' 'prisma migrate deploy' 'run-production-a5-reviewed-migration.sh' \
  'deploy.sh production' 'skip_legal'; do
  if grep -F -- "$forbidden" "$workflow" >/dev/null; then
    echo "ERROR: Production readiness contains mutation/rebuild/retest path: $forbidden" >&2
    exit 1
  fi
done

# Every action reference must be an immutable 40-character commit.
if grep -E '^[[:space:]]*-?[[:space:]]*uses:' "$workflow" \
  | grep -Ev '@[0-9a-f]{40}([[:space:]]*#.*)?$' >/dev/null; then
  echo 'ERROR: Production readiness contains an unpinned action' >&2; exit 1
fi

line() { grep -n -F -- "$1" "$workflow" | head -n1 | cut -d: -f1; }
passport="$(line 'Bind protected controller and download exact Passport V2')"
security="$(line 'Configure read-only Production security credentials')"
catalog="$(line 'Prove current services and classify Production migration ledger')"
clone="$(line 'Rehearse exact pending migration suffix and prove cleanup')"
ready="$(line 'Build, validate and sign Production READY V2')"
[ "$passport" -lt "$security" ] && [ "$security" -lt "$catalog" ] \
  && [ "$catalog" -lt "$clone" ] && [ "$clone" -lt "$ready" ]

# Closed mode validates the technical maintenance controller; live mode validates the complete
# legal bundle before the first general Production AWS read credential is configured.
closed="$(line 'Verify the closed-mode maintenance controller')"
legal="$(line 'Provision and fully validate legal evidence for live mode')"
[ "$closed" -lt "$security" ] && [ "$legal" -lt "$security" ]

echo 'Production readiness V2 workflow contract: PASS'
