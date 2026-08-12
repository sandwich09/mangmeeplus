#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
workflow="$repo_root/.github/workflows/deploy-uat.yml"
ci_workflow="$repo_root/.github/workflows/ci.yml"

grep -Fq 'default: auto' "$workflow"
grep -Fq 'bash infra/uat/select-deploy-target.sh' "$workflow"
grep -Fq 'case "$TARGET" in all|auto) production_eligible=true ;; esac' "$workflow"
grep -Fq "publish_release_tools: \${{ needs.validate-config.outputs.resolved_target == 'all' }}" "$workflow"
grep -Fq 'RELEASE_DEPLOY_TARGET: ${{ steps.target.outputs.target }}' "$workflow"
grep -Fq 'TARGET: ${{ steps.target.outputs.target }}' "$workflow"
test "$(grep -Fc "if: success() && steps.target.outputs.target == 'all'" "$workflow")" -ge 3
grep -Fq 'name: uat-release-passport-v2-${{ needs.resolve-release.outputs.source_sha }}-attempt-${{ github.run_attempt }}' "$workflow"
grep -Fq "if: success() && inputs.run_m01_acceptance && steps.target.outputs.target == 'all'" "$workflow"
grep -Fq 'Verify exact UAT controller policies before image publication' "$workflow"
grep -Fq 'bash infra/uat/verify-deploy-readiness.sh' "$workflow"
test "$(grep -Fc 'bash infra/uat/verify-control-plane-policies.sh' "$workflow")" -eq 2
grep -Fq 'uat-${{ matrix.purpose }}-${{ needs.resolve-source.outputs.source_sha }}-${{ github.run_id }}-${{ github.run_attempt }}' "$ci_workflow"

release_tools_job="$(sed -n '/^  publish-release-tools:/,/^  publish-release-tools-manifest:/p' "$ci_workflow")"
grep -Fq "inputs.source_ref != ''" <<< "$release_tools_job"
if grep -Fq "github.event_name == 'workflow_call'" <<< "$release_tools_job"; then
  echo "ERROR: a reusable workflow observes its caller event; release tools must bind the required source_ref input" >&2
  exit 1
fi

preflight_line="$(grep -n '^  validate-config:' "$workflow" | cut -d: -f1)"
build_line="$(grep -n '^  build_and_publish:' "$workflow" | cut -d: -f1)"
test "$preflight_line" -lt "$build_line"
sed -n '/^  build_and_publish:/,/^  deploy:/p' "$workflow" | grep -Fq '      - validate-config'

if grep -Fq "if: success() && inputs.target == 'all'" "$workflow"; then
  echo "ERROR: Production acceptance must follow the deployed target, not the requested target" >&2
  exit 1
fi

echo "UAT fast selective workflow: pass"
