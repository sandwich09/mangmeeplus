#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
workflow="$repo_root/.github/workflows/production-a5-clone.yml"

ruby - "$workflow" <<'RUBY'
require 'yaml'
path = ARGV.fetch(0)
doc = YAML.safe_load(File.read(path), aliases: true)
dispatch = doc.fetch(true).fetch('workflow_dispatch')
expected_inputs = %w[parent_production_run_id parent_production_run_attempt uat_acceptance_run_id]
raise 'unexpected clone inputs' unless dispatch.fetch('inputs').keys.sort == expected_inputs.sort
raise 'permissions widened' unless doc.fetch('permissions') == {
  'actions' => 'read', 'contents' => 'read', 'id-token' => 'write'
}
job = doc.fetch('jobs').fetch('clone')
raise 'wrong environment' unless job.fetch('environment') == 'production'
raise 'wrong timeout' unless job.fetch('timeout-minutes') == 120
uses = job.fetch('steps').map { |step| step['uses'] }.compact
raise 'floating action reference' unless uses.all? { |ref| ref.match?(/\A[^@]+@[0-9a-f]{40}\z/) }
raise 'setup-node pin drifted from CI-proven pin' unless uses.include?(
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
)
RUBY

for required in \
  'watchdog-bms-production-a5-clone' \
  'watchdog-bms-production-a5-clone-execution' \
  'validate-uat-deployment-acceptance.sh' \
  'target: migration-tool' \
  'provenance: mode=max' \
  'sbom: true' \
  'MIGRATION_TEMPORARY_TAG' \
  'run-production-a5-clone.sh' \
  'PRODUCTION_A5_CLONE_REHEARSAL_V1' \
  'signed_evidence_validate_payload_contract' \
  'cosign sign-blob --yes --bundle' \
  'contentSha256:("0"*64)' \
  'test "$(find "$output" -mindepth 1 -maxdepth 1'; do
  grep -F -- "$required" "$workflow" >/dev/null
done

for forbidden in \
  'watchdog-bms/production/database-url' \
  'get-secret-value' \
  'managed-secret.json' \
  'clone-url' \
  '--secret-string' \
  'PRODUCTION_A5_CLONE_DATABASE_URL' \
  'ecsTaskExecutionRole' \
  'aws ecs update-service' \
  'aws rds modify-db-instance' \
  'aws rds delete-db-snapshot'; do
  if grep -F -- "$forbidden" "$workflow" >/dev/null; then
    echo "ERROR: forbidden production clone workflow capability: $forbidden" >&2
    exit 1
  fi
done

echo 'production A5 clone workflow spec: PASS'
