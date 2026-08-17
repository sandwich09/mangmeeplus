#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
workflow="$root/.github/workflows/production-readiness.yml"

grep -Fq 'curl_retry=(--retry 2 --retry-delay 2 --retry-max-time 70 --retry-all-errors)' "$workflow"
grep -Fq 'curl --silent --show-error --location "${curl_retry[@]}"' "$workflow"
[ -f "$workflow" ]
ruby -e 'require "yaml"; value=YAML.load_file(ARGV[0]); abort unless value.is_a?(Hash)' "$workflow"

for required in \
  'workflow_run:' 'workflows: [UAT Deploy]' 'workflow_dispatch:' 'workflow_call:' \
  'AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: ${{ vars.AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF }}' \
  'uat-release-passport-v2-' 'validate-uat-release-passport-v2.sh' \
  'collect-production-runtime-readiness-v2.sh' 'collect-production-a5-current-health.sh' \
  'Stage and read back the exact Production AgentCore candidate' \
  'validate-agentcore-candidate-binding.sh' 'agentcore-production-binding.json' \
  'run-production-migration-catalog-readiness.sh' 'APPEND_ONLY_PENDING' \
  'run-production-a5-clone.sh' \
  'validate-production-release-ready-v2.sh' 'PRODUCTION_RELEASE_READY_V2' \
  'production-release-ready-v2-' 'select-deploy-target.sh' \
  'requestedMode:$mode,effectiveTarget:$target' \
  'owner_legal_override_ref:' 'legal_mode=OWNER_OVERRIDE' \
  'test "$GITHUB_ACTOR" = MangmeeDev' \
  'legal:{mode:$legalMode' 'ownerApprovalRef:' 'approvedBy:' \
  'AWS_DEPLOY_ROLE_ARN: ${{ vars.AWS_DEPLOY_ROLE_ARN }}' \
  'PUBLIC_DOMAIN_URL: ${{ vars.PUBLIC_DOMAIN_URL }}' \
  'WORKFLOW_WEBHOOK_ALLOWED_HOSTS: ${{ vars.WORKFLOW_WEBHOOK_ALLOWED_HOSTS }}' \
  'CLAMAV_HOST: ${{ vars.CLAMAV_HOST }}' \
  'LOG_KMS_KEY_ID: ${{ vars.LOG_KMS_KEY_ID }}' \
  'SECURITY_ALERT_TOPIC_ARN: ${{ vars.SECURITY_ALERT_TOPIC_ARN }}' \
  'LINE_LOGIN_CHANNEL_ID: ${{ vars.LINE_LOGIN_CHANNEL_ID }}' \
  'LINE_LIFF_ID: ${{ vars.LINE_LIFF_ID }}' \
  'LINE_MESSAGING_CHANNEL_ID: ${{ vars.LINE_MESSAGING_CHANNEL_ID }}' \
  'APPROVED_AI_PROVIDERS: ${{ vars.APPROVED_AI_PROVIDERS }}' \
  'APPROVED_AI_REGIONS: ${{ vars.APPROVED_AI_REGIONS }}' \
  'TYPHOON_PROCESSING_REGION: ${{ vars.TYPHOON_PROCESSING_REGION }}' \
  'AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: ${{ vars.AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF }}' \
  'LINE_AI_AGENT_RUNTIME: ${{ vars.LINE_AI_AGENT_RUNTIME }}' \
  'AGENTCORE_REGION: ${{ vars.AGENTCORE_REGION }}' \
  'timeout-minutes: 150' \
  'PRODUCTION_POLICY_READ_TOKEN_CONFIGURED=true'; do
  grep -F -- "$required" "$workflow" >/dev/null
done

if grep -F 'AGENTCORE_RUNTIME_ARN: ${{ vars.AGENTCORE_RUNTIME_ARN }}' "$workflow" >/dev/null \
    || grep -F 'AGENTCORE_RUNTIME_QUALIFIER: ${{ vars.AGENTCORE_RUNTIME_QUALIFIER }}' "$workflow" >/dev/null; then
  echo 'ERROR: readiness still accepts mutable GitHub AgentCore candidate identity' >&2
  exit 1
fi

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
candidate="$(line 'Stage and read back the exact Production AgentCore candidate')"
catalog="$(line 'Prove current services and classify Production migration ledger')"
clone="$(line 'Rehearse exact pending migration suffix and prove cleanup')"
ready="$(line 'Build, validate and sign Production READY V2')"
[ "$passport" -lt "$candidate" ] && [ "$candidate" -lt "$security" ] \
  && [ "$security" -lt "$catalog" ] \
  && [ "$catalog" -lt "$clone" ] && [ "$clone" -lt "$ready" ]

# Closed mode validates the technical maintenance controller; live mode validates the complete
# legal bundle before the first general Production AWS read credential is configured.
closed="$(line 'Verify the closed-mode maintenance controller')"
legal="$(line 'Provision and fully validate legal evidence for live mode')"
override="$(line 'Bind explicit owner legal override for live mode')"
[ "$closed" -lt "$security" ] && [ "$legal" -lt "$security" ] \
  && [ "$override" -lt "$security" ]

grep -Fq "needs.discover.outputs.legal_mode == 'VERIFIED_BUNDLE'" "$workflow"
grep -Fq "needs.discover.outputs.legal_mode == 'OWNER_OVERRIDE'" "$workflow"

# deploy-production-v2.yml calls this same workflow so one dispatch proves READY and promotes.
# The call surface must accept exactly the manual dispatch surface, or the combined path would
# silently drop an input the standalone path enforces (owner override in particular).
ruby - "$workflow" <<'RUBY'
require "yaml"

triggers = (YAML.load_file(ARGV.fetch(0))[true] or abort "no trigger block")
dispatch = triggers.fetch("workflow_dispatch").fetch("inputs")
call = triggers.fetch("workflow_call").fetch("inputs")
abort "workflow_call input set drifted from workflow_dispatch" unless call.keys.sort == dispatch.keys.sort
call.each do |name, spec|
  abort "#{name} required flag drifted" unless spec.fetch("required") == dispatch.fetch(name).fetch("required")
  abort "#{name} must be a workflow_call string input" unless spec.fetch("type") == "string"
end
RUBY

echo 'Production readiness V2 workflow contract: PASS'
