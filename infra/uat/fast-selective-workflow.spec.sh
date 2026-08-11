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
grep -Fq 'Verify exact UAT controller policies before image publication' "$workflow"
grep -Fq 'bash infra/uat/verify-deploy-readiness.sh' "$workflow"
test "$(grep -Fc 'bash infra/uat/verify-control-plane-policies.sh' "$workflow")" -eq 2

preflight_line="$(grep -n '^  validate-config:' "$workflow" | cut -d: -f1)"
build_line="$(grep -n '^  build_and_publish:' "$workflow" | cut -d: -f1)"
test "$preflight_line" -lt "$build_line"
sed -n '/^  build_and_publish:/,/^  deploy:/p' "$workflow" | grep -Fq '      - validate-config'

if grep -Fq "if: success() && steps.target.outputs.target == 'all'" "$workflow"; then
  echo "ERROR: auto target must not mint an all-target Production acceptance" >&2
  exit 1
fi

echo "UAT fast selective workflow: pass"
