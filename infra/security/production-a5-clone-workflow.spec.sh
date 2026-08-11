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
login = job.fetch('steps').find { |step| step['name'] == 'Log in to the dedicated ECR repository' }
raise 'missing ECR login step' unless login
login_run = login.fetch('run')
export_index = login_run.index('export DOCKER_CONFIG="$docker_config"')
login_index = login_run.index('docker login --username AWS --password-stdin')
raise 'ECR login does not use the persisted Docker config' unless export_index && login_index && export_index < login_index
verify = job.fetch('steps').find { |step| step['name'] == 'Pull, verify, sign and record immutable migration tool' }
raise 'missing migration-tool verification step' unless verify
verify_run = verify.fetch('run')
raise 'migration-tool validator is not controller-owned' unless verify_run.include?(
  'bash infra/security/verify-production-a5-migration-tool.sh "$image" "$SOURCE_SHA"'
)
raise 'candidate source controls its own image validator' if verify_run.include?(
  'candidate/infra/security/verify-production-a5-migration-tool.sh'
)
tsx_index = verify_run.index('--tsconfig /app/apps/api/tsconfig.json')
hash_script_index = verify_run.index('/app/apps/api/prisma/production-a5/print-reviewed-candidate-hashes.ts')
raise 'candidate hash printer does not use the API tsconfig' unless tsx_index && hash_script_index && tsx_index < hash_script_index
raise 'migration-tool signing does not retain its bundle' unless verify_run.include?(
  'cosign sign --yes --bundle "$tool_root/migration-tool.signature.bundle" "$image"'
)
raise 'image verification incorrectly passes a bundle flag' if verify_run.match?(/cosign verify --bundle/)
raise 'migration-tool signature is not verified from the registry' unless verify_run.include?(
  'cosign verify --certificate-identity "$identity"'
)
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
  'pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma' \
  'aws ssm get-parameter --name "$name" --output json' \
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
  'aws ssm get-parameters --names' \
  'aws rds modify-db-instance' \
  'aws rds delete-db-snapshot'; do
  if grep -F -- "$forbidden" "$workflow" >/dev/null; then
    echo "ERROR: forbidden production clone workflow capability: $forbidden" >&2
    exit 1
  fi
done

echo 'production A5 clone workflow spec: PASS'
