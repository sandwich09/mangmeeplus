#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
script="$root/infra/security/collect-production-runtime-readiness-v2.sh"
bash -n "$script"
for required in watchdog-bms-production-security-readonly watchdog-bms-prod-db \
  production-security-readonly-policy.template.json describe-replication-groups \
  AtRestEncryptionEnabled TransitEncryptionEnabled AuthTokenEnabled AutomaticFailover \
  SnapshotRetentionLimit BackupRetentionPeriod DeletionProtection; do
  grep -F -- "$required" "$script" >/dev/null
done
for forbidden in get-secret-value put-role-policy modify-db-instance delete-db-instance; do
  if grep -F -- "$forbidden" "$script" >/dev/null; then
    echo "ERROR: runtime readiness collector contains mutation/secret path: $forbidden" >&2; exit 1
  fi
done
jq -e . "$root/infra/security/production-security-readonly-policy.template.json" \
  "$root/infra/security/production-security-readonly-trust.template.json" >/dev/null
echo 'production runtime readiness V2 collector: PASS'
