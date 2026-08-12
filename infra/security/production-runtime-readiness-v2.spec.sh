#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
script="$root/infra/security/collect-production-runtime-readiness-v2.sh"
environment_validator="$root/infra/security/validate-production-promotion-environment.sh"
resource_collector="$root/infra/security/collect-production-promotion-resources.sh"
for file in "$script" "$environment_validator" "$resource_collector"; do bash -n "$file"; done
for required in watchdog-bms-production-security-readonly watchdog-bms-prod-db \
  production-security-readonly-policy.template.json describe-replication-groups \
  AtRestEncryptionEnabled TransitEncryptionEnabled AuthTokenEnabled AutomaticFailover \
  SnapshotRetentionLimit BackupRetentionPeriod DeletionProtection \
  promotion-prerequisites.json promotionPrerequisitesSha256 \
  watchdog-bms-deploy-production watchdog-bms-production-deploy \
  watchdog-bms-prod-workers-object-version-cleanup \
  watchdog-bms-production-a5-readonly-execution \
  watchdog-bms-production-a5-readonly \
  watchdog-bms-production-a5-reader-bootstrap \
  watchdog-bms-production-a5-bootstrap-execution \
  watchdog-bms-production-a5-apply-execution \
  watchdog-bms-production-a5-clone \
  watchdog-bms-production-a5-clone-execution \
  production-a5-reader-bootstrap-revoked-policy.template.json NoSuchEntity require_absent_role \
  collect-production-promotion-resources.sh production-ecs-execution-policy.template.json \
  production-release-task-policy.template.json production-api-task-policy.template.json \
  production-ai-task-policy.template.json record_runtime_role record_service_linked_role \
  ecsTaskExecutionRole watchdog-bms-release-task-role ecsInfrastructureRoleForExpressServices \
  watchdog-bms-ecs-express-api-role watchdog-bms-ecs-express-ai-gateway-role \
  AWSServiceRoleForECS AWSServiceRoleForElasticLoadBalancing \
  AWSServiceRoleForApplicationAutoScaling_ECSService \
  requiredVariableValuesSha256 promotion-environment.json \
  PRODUCTION_POLICY_READ_TOKEN_CONFIGURED PUBLIC_DOMAIN_URL WORKFLOW_WEBHOOK_ALLOWED_HOSTS \
  LINE_AI_AGENT_RUNTIME AGENTCORE_REGION AGENTCORE_RUNTIME_ARN AGENTCORE_RUNTIME_QUALIFIER; do
  grep -F -- "$required" "$script" "$environment_validator" "$resource_collector" >/dev/null
done
for forbidden in get-secret-value put-role-policy modify-db-instance delete-db-instance; do
  if grep -F -- "$forbidden" "$script" >/dev/null; then
    echo "ERROR: runtime readiness collector contains mutation/secret path: $forbidden" >&2; exit 1
  fi
done
grep -F 'promotion_prerequisites_hash="$(sha_file "$prerequisites")"' "$script" >/dev/null
if sed -n '/jq -cnS --arg deployRole/,/> "$prerequisites"/p' "$script" | grep -F observedAtEpoch >/dev/null; then
  echo 'ERROR: promotion prerequisite hash includes a volatile observation time' >&2; exit 1
fi
if grep -F 'record_exact_role watchdog-bms-production-a5-bootstrap-execution' "$script" >/dev/null; then
  echo 'ERROR: readiness re-armed the one-time reader bootstrap execution role' >&2; exit 1
fi
revoked="$root/infra/security/production-a5-reader-bootstrap-revoked-policy.template.json"
jq -e '.Statement==[{Sid:"BootstrapRevoked",Effect:"Deny",Action:"*",Resource:"*"}]' \
  "$revoked" >/dev/null
if jq -e --slurpfile expected "$revoked" '.==$expected[0]' \
    "$root/infra/security/production-a5-reader-bootstrap-policy.template.json" >/dev/null; then
  echo 'ERROR: active reader bootstrap policy was accepted as revoked' >&2; exit 1
fi
jq -e . "$root/infra/security/production-security-readonly-policy.template.json" \
  "$root/infra/security/production-security-readonly-trust.template.json" \
  "$root/infra/prod-ecs-express/github-deploy-role-policy.template.json" \
  "$root/infra/prod-ecs-express/github-deploy-role-trust.template.json" \
  "$root/infra/security/object-version-cleanup-worker-policy.template.json" "$revoked" >/dev/null
echo 'production runtime readiness V2 collector: PASS'
