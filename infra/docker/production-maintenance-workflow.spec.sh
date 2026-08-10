#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
workflow="$repo_root/.github/workflows/deploy-production.yml"

line_of() {
  local pattern="$1"
  grep -Fn -m1 -- "$pattern" "$workflow" | cut -d: -f1
}

grep -Fq 'maintenance_only:' "$workflow"
grep -Fq 'maintenance_bootstrap:' "$workflow"
grep -Fq 'uses_uat: ${{ steps.intent.outputs.uses_uat }}' "$workflow"
grep -Fq '"$MAINTENANCE_BOOTSTRAP")' "$workflow"
grep -Fq "needs.resolve-release.outputs.release_mode == 'maintenance-bootstrap'" "$workflow"
grep -Fq "needs.resolve-release.outputs.uses_uat == 'true'" "$workflow"
grep -Fq 'PRODUCTION_SERVING_MODE: ${{ needs.resolve-release.outputs.serving_mode }}' "$workflow"
grep -Fq 'Verify maintenance release policy and final source bytes' "$workflow"
grep -Fq 'promotion|maintenance-bootstrap)' "$workflow"
grep -Fq 'Verify bridge carries the complete maintenance execution path' "$workflow"
grep -Fq 'validate-production-maintenance-release.sh "$GITHUB_WORKSPACE/bridge-source" full' "$workflow"
grep -Fq 'PRODUCTION_SERVING_MODE: maintenance_only' "$workflow"
grep -Fq 'maintenance-preflight' "$workflow"
grep -Fq 'MAINTENANCE_BOOTSTRAP_READONLY:' "$workflow"
grep -Fq 'Re-prove the closed bridge immediately before database mutation' "$workflow"
grep -Fq 'verify-production-maintenance.sh all' "$workflow"
grep -Fq 'Expire direct-storage URLs issued before maintenance closure' "$workflow"
grep -Fq 'wait-production-maintenance-ingress-drain.sh' "$workflow"
grep -Fq 'Maintenance proof failed; redeploying the exact validated maintenance manifest before stopping' "$workflow"
grep -Fq 'Maintenance rollout did not converge; retrying the exact validated all-service manifest once' "$workflow"
grep -Fq 'maintenance-ingress-drain.json' "$workflow"
grep -Fq 'if: inputs.maintenance_only == false' "$workflow"
grep -Fq "if: needs.resolve-release.outputs.release_mode == 'promotion' && inputs.maintenance_only == false" "$workflow"
grep -Fq 'if-no-files-found: error' "$workflow"
grep -Fq "steps.pre-mutation-maintenance.outcome == 'success'" "$workflow"
grep -Fq '${{ env.DEPLOYMENT_EVIDENCE_DIR }}/bridge-maintenance-proof.json' "$workflow"
grep -Fq '${{ env.DEPLOYMENT_EVIDENCE_DIR }}/pre-mutation-maintenance-proof.json' "$workflow"

if grep -Fq 'incident-preflight' "$workflow" \
  || grep -Fq 'PARTIAL_INCIDENT_READONLY:' "$workflow"; then
  echo 'ERROR: maintenance still reuses the partial-incident authority path' >&2
  exit 1
fi
if grep -Eiq 'skip[_ -]?legal' "$workflow"; then
  echo 'ERROR: production workflow contains a generic legal bypass' >&2
  exit 1
fi

final_policy="$(line_of 'Verify maintenance release policy and final source bytes')"
legal_pins="$(line_of 'Verify legal evidence gate policy pins')"
bridge_checkout="$(line_of 'path: bridge-source')"
bridge_policy="$(line_of 'Verify bridge carries the complete maintenance execution path')"
bridge_credentials="$(line_of 'Configure AWS bridge image publisher credentials')"
rollout_credentials="$(line_of 'Configure AWS rollout credentials')"
bridge_proof="$(line_of 'Prove the exact UAT-attested bridge is globally closed and build PRE context')"
legal_validation="$(line_of 'Validate legal operator and privacy release evidence')"
deploy_credentials="$(line_of 'Configure AWS deploy credentials')"
fresh_bridge_proof="$(line_of 'Re-prove the closed bridge immediately before database mutation')"
migration="$(line_of 'Apply the exact reviewed migration while the bridge stays quiesced')"
deploy_step="$(line_of 'Deploy immutable manifest')"
health_step="$(line_of 'Verify active digest and health')"
drain_step="$(line_of 'Expire direct-storage URLs issued before maintenance closure')"
proof_step="$(line_of 'Prove custom and raw origins remain closed')"
unquiesce_step="$(line_of 'Prove final quiesced revision and unquiesce the same image last')"

[ "$final_policy" -lt "$legal_pins" ]
[ "$legal_pins" -lt "$bridge_checkout" ]
[ "$bridge_checkout" -lt "$bridge_policy" ]
[ "$bridge_policy" -lt "$bridge_credentials" ]
[ "$bridge_credentials" -lt "$rollout_credentials" ]
[ "$rollout_credentials" -lt "$bridge_proof" ]
[ "$bridge_proof" -lt "$legal_validation" ]
[ "$legal_validation" -lt "$deploy_credentials" ]
[ "$deploy_credentials" -lt "$fresh_bridge_proof" ]
[ "$fresh_bridge_proof" -lt "$migration" ]
[ "$migration" -lt "$deploy_step" ]
[ "$deploy_step" -lt "$health_step" ]
[ "$health_step" -lt "$drain_step" ]
[ "$drain_step" -lt "$proof_step" ]
[ "$proof_step" -lt "$unquiesce_step" ]

echo 'production maintenance workflow contract: PASS'
