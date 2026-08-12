#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
workflow="$repo_root/.github/workflows/production-a5-clone.yml"

ruby - "$workflow" <<'RUBY'
require 'yaml'
path = ARGV.fetch(0)
source = File.read(path)
raise 'candidate source controls production security authority' if source.include?('candidate/infra/security/')
doc = YAML.safe_load(source, aliases: true)
dispatch = doc.fetch(true).fetch('workflow_dispatch')
expected_inputs = %w[parent_production_run_id parent_production_run_attempt uat_acceptance_run_id]
raise 'unexpected clone inputs' unless dispatch.fetch('inputs').keys.sort == expected_inputs.sort
raise 'permissions widened' unless doc.fetch('permissions') == {
  'actions' => 'read', 'contents' => 'read', 'id-token' => 'write'
}
job = doc.fetch('jobs').fetch('clone')
raise 'wrong environment' unless job.fetch('environment') == 'production'
raise 'wrong timeout' unless job.fetch('timeout-minutes') == 150
steps = job.fetch('steps')
login = steps.find { |step| step['name'] == 'Log in to the dedicated ECR repository' }
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
workflow_run = job.fetch('steps').map { |step| step['run'] }.compact.join("\n")
raise 'registry evidence validator is not controller-owned' unless workflow_run.include?(
  'bash infra/security/collect-production-a5-migration-tool-registry-evidence.sh'
)
raise 'candidate source controls its own registry evidence validator' if workflow_run.include?(
  'candidate/infra/security/collect-production-a5-migration-tool-registry-evidence.sh'
)
raise 'clone runner is not controller-owned' unless workflow_run.include?(
  'bash infra/security/run-production-a5-clone.sh'
)
tsx_index = verify_run.index('--tsconfig /app/apps/api/tsconfig.json')
hash_script_index = verify_run.index('/app/apps/api/prisma/production-a5/print-reviewed-candidate-hashes.ts')
raise 'candidate hash printer does not use the API tsconfig' unless tsx_index && hash_script_index && tsx_index < hash_script_index
raise 'migration-tool signing is not uploaded to the registry' unless verify_run.include?(
  'cosign sign --yes "$image"'
)
raise 'image signing incorrectly requests a local bundle' if verify_run.match?(/cosign sign .*--bundle/)
raise 'image verification incorrectly passes a bundle flag' if verify_run.match?(/cosign verify --bundle/)
raise 'migration-tool signature is not verified from the registry' unless verify_run.include?(
  'cosign verify --certificate-identity "$identity"'
)
raise 'registry verification output is not retained as evidence' unless verify_run.include?(
  'migration-tool.signature.verify.json'
)
clone_index = steps.index { |step| step['name'] == 'Restore, rehearse and destroy the isolated clone' }
raise 'missing clone runner step' unless clone_index
refresh = steps.fetch(clone_index - 1)
raise 'clone credentials are not refreshed immediately before restore' unless refresh['name'] ==
  'Refresh clone controller credentials immediately before restore'
raise 'clone refresh action pin drifted' unless refresh['uses'] ==
  'aws-actions/configure-aws-credentials@ec61189d14ec14c8efccab744f656cffd0e33f37'
refresh_with = refresh.fetch('with')
raise 'clone refresh role drifted' unless refresh_with['role-to-assume'] ==
  'arn:aws:iam::311414082667:role/watchdog-bms-production-a5-clone'
raise 'clone refresh duration is not the full role session' unless
  refresh_with['role-duration-seconds'] == 7200
raise 'clone refresh retains stale credentials' unless refresh_with['unset-current-credentials'] == true
uses = steps.map { |step| step['uses'] }.compact
raise 'floating action reference' unless uses.all? { |ref| ref.match?(/\A[^@]+@[0-9a-f]{40}\z/) }
raise 'setup-node pin drifted from CI-proven pin' unless uses.include?(
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
)
RUBY

for required in \
  'watchdog-bms-production-a5-clone' \
  'watchdog-bms-production-a5-clone-execution' \
  'infra/security/production-a5-clone-bootstrap.spec.sh' \
  'infra/security/production-a5-clone-runner.spec.sh' \
  'infra/security/production-a5-clone-trust.template.json' \
  'infra/security/production-a5-clone-policy.template.json' \
  'infra/security/production-a5-clone-execution-trust.template.json' \
  'infra/security/production-a5-clone-execution-policy.template.json' \
  'validate-uat-deployment-acceptance.sh' \
  'pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma' \
  'aws ssm get-parameter --name "$name" --output json' \
  '/watchdog-bms/production/a5-clone/db-parameter-group-name' \
  '/watchdog-bms/production/a5-clone/option-group-name' \
  'test "${#parameters[@]}" -eq 10' \
  'target: migration-tool' \
  'provenance: mode=max' \
  'sbom: true' \
  'MIGRATION_TEMPORARY_TAG' \
  'run-production-a5-clone.sh' \
  'PRODUCTION_A5_CLONE_REHEARSAL_V1' \
  'outputSha256:$signatureHash' \
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
  'aws rds delete-db-snapshot' \
  'bundleSha256' \
  'migration-tool.signature.bundle'; do
  if grep -F -- "$forbidden" "$workflow" >/dev/null; then
    echo "ERROR: forbidden production clone workflow capability: $forbidden" >&2
    exit 1
  fi
done

echo 'production A5 clone workflow spec: PASS'
