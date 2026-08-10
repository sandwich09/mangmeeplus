#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
template="$repo_root/infra/security/object-version-cleanup-worker-policy.template.json"
prod="$repo_root/infra/prod-ecs-express/deploy.sh"
uat="$repo_root/infra/uat/setup-control-plane.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/object-version-cleanup-iam.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

sed 's/<S3_BUCKET>/example-cleanup-bucket/g' "$template" > "$tmp_dir/policy.json"
jq -e '
  .Version == "2012-10-17"
  and (.Statement | length) == 1
  and .Statement[0].Effect == "Allow"
  and ((.Statement[0].Action | if type == "array" then sort else [.] end) == ["s3:DeleteObjectVersion"])
  and (.Statement[0].Resource | sort) == ([
    "arn:aws:s3:::example-cleanup-bucket/evidence/*",
    "arn:aws:s3:::example-cleanup-bucket/report-export/*",
    "arn:aws:s3:::example-cleanup-bucket/*/generated/expense-substitute/*"
  ] | sort)
  and ([.Statement[] | select(has("NotAction") or has("NotResource"))] | length) == 0
' "$tmp_dir/policy.json" >/dev/null

# The permission is data-plane-only on the workers role. Keeping the action literal in the shared
# template makes an accidental copy into API policy blocks visible here.
if grep -qF 's3:DeleteObjectVersion' "$prod" "$uat"; then
  echo 'DeleteObjectVersion must be sourced only from the dedicated workers policy template' >&2
  exit 1
fi

grep -qF 'object-version-cleanup-worker-policy.template.json' "$prod"
grep -qF 'watchdog-bms-prod-workers-object-version-cleanup' "$prod"
grep -qF -- '--role-name "$WORKERS_TASK_ROLE"' "$prod"
grep -qF 'workers-cleanup-policy-actual.json' "$prod"
grep -qF 'object-version-cleanup-worker-policy.template.json' "$uat"
grep -qF 'watchdog-bms-uat-workers-object-version-cleanup' "$uat"
grep -qF -- '--role-name "$workers_role"' "$uat"
grep -qF 'workers-cleanup-policy-actual.json' "$uat"

bash -n "$prod"
bash -n "$uat"

# The deploy controller reads this inline policy back before it mutates anything, so whichever
# principal runs the deploy needs iam:GetRolePolicy on the WORKERS role — not only on the release
# task role. Both GitHub deploy policies shipped without it, so the UAT deploy died at the readback
# with AccessDenied on watchdog-bms-uat-ecs-workers-role after the release task had already applied
# nine migrations, leaving the environment on a new schema with the old image. Asserted per
# environment because production's grant lives in a different template from UAT's.
assert_readback_grant() {
  local policy_file="$1" workers_role="$2"
  jq -e --arg role "$workers_role" '
    [.Statement[]
      | select(.Effect == "Allow")
      | select((.Action | if type == "array" then . else [.] end) | index("iam:GetRolePolicy"))
      | (.Resource | if type == "array" then . else [.] end)
      | .[]
      | select(endswith(":role/" + $role))]
    | length > 0
  ' "$policy_file" >/dev/null || {
    echo "ERROR: $(basename "$policy_file") must grant iam:GetRolePolicy on $workers_role, or the deploy cannot read the cleanup policy it verifies" >&2
    exit 1
  }
}

assert_readback_grant "$repo_root/infra/uat/github-deploy-role-policy.template.json" \
  watchdog-bms-uat-ecs-workers-role
assert_readback_grant "$repo_root/infra/prod-ecs-express/github-deploy-role-policy.template.json" \
  watchdog-bms-ecs-express-workers-role

echo 'object-version cleanup IAM contract: PASS'
