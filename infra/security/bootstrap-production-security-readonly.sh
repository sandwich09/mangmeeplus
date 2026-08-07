#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
role_name=watchdog-bms-production-security-readonly
policy_name=watchdog-bms-production-security-readonly
trust="$repo_root/infra/security/production-security-readonly-trust.template.json"
policy="$repo_root/infra/security/production-security-readonly-policy.template.json"

jq -e . "$trust" "$policy" >/dev/null
if [ "${1:-}" != --apply ]; then
  printf '%s\n' "Dry run only. Re-run with --apply after reviewing both exact policy templates."
  printf '%s\n' "Role: arn:aws:iam::311414082667:role/$role_name"
  exit 0
fi

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = 311414082667
actual_account="$(aws sts get-caller-identity --query Account --output text)"
test "$actual_account" = "$AWS_ACCOUNT_ID"
if aws iam get-role --role-name "$role_name" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$role_name" \
    --policy-document "file://$trust"
else
  aws iam create-role --role-name "$role_name" \
    --assume-role-policy-document "file://$trust" >/dev/null
fi
aws iam put-role-policy --role-name "$role_name" --policy-name "$policy_name" \
  --policy-document "file://$policy"
printf '%s\n' "Provisioned arn:aws:iam::$AWS_ACCOUNT_ID:role/$role_name"
