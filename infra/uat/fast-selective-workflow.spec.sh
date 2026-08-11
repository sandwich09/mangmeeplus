#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
workflow="$repo_root/.github/workflows/deploy-uat.yml"

grep -Fq 'default: auto' "$workflow"
grep -Fq 'bash infra/uat/select-deploy-target.sh' "$workflow"
grep -Fq 'RELEASE_DEPLOY_TARGET: ${{ steps.target.outputs.target }}' "$workflow"
grep -Fq 'TARGET: ${{ steps.target.outputs.target }}' "$workflow"
grep -Fq "if: success() && inputs.target == 'all'" "$workflow"
grep -Fq "if: success() && inputs.run_m01_acceptance && steps.target.outputs.target == 'all'" "$workflow"

if grep -Fq "if: success() && steps.target.outputs.target == 'all'" "$workflow"; then
  echo "ERROR: auto target must not mint an all-target Production acceptance" >&2
  exit 1
fi

echo "UAT fast selective workflow: pass"
