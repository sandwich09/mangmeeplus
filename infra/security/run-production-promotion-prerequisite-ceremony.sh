#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
account=311414082667
role=watchdog-bms-production-promotion-bootstrap
role_policy=watchdog-bms-production-promotion-bootstrap
user=watchdog-bedrock-dev
user_policy=watchdog-bms-production-promotion-bootstrap-assume
trust="$root/infra/security/production-promotion-bootstrap-trust.template.json"
full_principal="$root/infra/security/production-promotion-bootstrap-principal-policy.template.json"
clone_principal="$root/infra/security/production-promotion-clone-controller-principal-policy.template.json"
bridge="$root/infra/security/production-promotion-bootstrap-user-policy.template.json"
helper="$root/infra/security/bootstrap-production-promotion-prerequisites.sh"

jq -e . "$trust" "$full_principal" "$clone_principal" "$bridge" >/dev/null
case "${1:-}" in
  --apply) principal="$full_principal"; helper_mode=--apply ;;
  --apply-clone-controller) principal="$clone_principal"; helper_mode=--apply-clone-controller ;;
  *)
    echo 'Dry run only. This wrapper creates, proves, uses, retires, and proves absence of the exact temporary promotion authority.'
    echo 'Use --apply-clone-controller when only the reviewed clone controller policy changed.'
    exit 0 ;;
esac

test "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}" = "$account"
admin_profile="${PROMOTION_ADMIN_PROFILE:?PROMOTION_ADMIN_PROFILE is required}"
operator_profile="${PROMOTION_OPERATOR_PROFILE:-watchdog-bedrock}"
attempts="${PROMOTION_IAM_MAX_ATTEMPTS:-12}"
retry_seconds="${PROMOTION_IAM_RETRY_SECONDS:-5}"
ceremony_id="${PROMOTION_CEREMONY_ID:-$(date -u +%s)-$$-${RANDOM:-0}}"
[[ "$attempts" =~ ^[1-9][0-9]*$ ]]
[[ "$retry_seconds" =~ ^[0-9]+$ ]]
[[ "$ceremony_id" =~ ^[A-Za-z0-9_.+=,@-]{1,64}$ ]]
export AWS_PAGER=

profile_aws() {
  local profile="$1"; shift
  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    -u AWS_SECURITY_TOKEN -u AWS_ROLE_ARN -u AWS_WEB_IDENTITY_TOKEN_FILE \
    AWS_PROFILE="$profile" AWS_DEFAULT_PROFILE="$profile" aws "$@"
}
admin_aws() { profile_aws "$admin_profile" "$@"; }
operator_aws() { profile_aws "$operator_profile" "$@"; }
pause() { [ "$1" -ge "$attempts" ] || sleep "$retry_seconds"; }

retry_admin_mutation() {
  local attempt
  for ((attempt=1; attempt<=attempts; attempt++)); do
    admin_aws "$@" && return 0
    pause "$attempt"
  done
  echo "ERROR: temporary IAM mutation did not converge after $attempts attempts: $*" >&2
  return 1
}

admin_identity="$(admin_aws sts get-caller-identity --output json)"
jq -e --arg account "$account" '.Account==$account' <<< "$admin_identity" >/dev/null
admin_arn="$(jq -er '.Arn' <<< "$admin_identity")"
if [ "$admin_arn" = "arn:aws:iam::$account:root" ]; then
  approval="${PROMOTION_ROOT_EXCEPTION_APPROVAL_REF:-}"
  [ -n "${approval//[[:space:]]/}" ] || {
    echo 'ERROR: root may perform this temporary ceremony only with PROMOTION_ROOT_EXCEPTION_APPROVAL_REF.' >&2
    exit 2
  }
fi
test "$(operator_aws sts get-caller-identity --query Arn --output text)" \
  = "arn:aws:iam::$account:user/$user"

work="$(mktemp -d "${TMPDIR:-/tmp}/production-promotion-ceremony.XXXXXX")"
ceremony_started=0

wait_absent() {
  local label="$1"; shift
  local attempt error="$work/absent.err"
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if admin_aws "$@" > /dev/null 2> "$error"; then
      :
    elif grep -Fq NoSuchEntity "$error"; then
      return 0
    fi
    pause "$attempt"
  done
  echo "ERROR: $label did not converge to NoSuchEntity" >&2
  cat "$error" >&2
  return 1
}

delete_temporary() {
  local label="$1"; shift
  local attempt error="$work/delete.err"
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if admin_aws "$@" > /dev/null 2> "$error"; then
      return 0
    fi
    if grep -Fq NoSuchEntity "$error"; then
      return 0
    fi
    pause "$attempt"
  done
  echo "ERROR: could not retire $label" >&2
  cat "$error" >&2
  return 1
}

cleanup() {
  local original_status="$?" cleanup_status=0
  trap - EXIT HUP INT TERM
  set +e
  if [ "$ceremony_started" -eq 1 ]; then
    # Every mutation may have succeeded server-side even when its response was lost.
    delete_temporary bridge iam delete-user-policy --user-name "$user" \
      --policy-name "$user_policy" || cleanup_status=1
    delete_temporary role-policy iam delete-role-policy --role-name "$role" \
      --policy-name "$role_policy" || cleanup_status=1
    delete_temporary role iam delete-role --role-name "$role" || cleanup_status=1
    wait_absent bridge iam get-user-policy --user-name "$user" \
      --policy-name "$user_policy" || cleanup_status=1
    wait_absent role-policy iam get-role-policy --role-name "$role" \
      --policy-name "$role_policy" || cleanup_status=1
    wait_absent role iam get-role --role-name "$role" || cleanup_status=1
  fi
  rm -rf -- "$work"
  if [ "$original_status" -ne 0 ]; then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Refuse to overwrite authority left by another ceremony.
wait_absent bridge iam get-user-policy --user-name "$user" --policy-name "$user_policy"
wait_absent role iam get-role --role-name "$role"

ceremony_started=1
if admin_aws iam create-role --role-name "$role" --max-session-duration 3600 \
    --assume-role-policy-document "file://$trust" \
    --tags "Key=WatchdogCeremonyId,Value=$ceremony_id" \
    >/dev/null 2> "$work/create-role.err"; then
  :
else
  create_status="$?"
  if grep -Fq EntityAlreadyExists "$work/create-role.err"; then
    # The CLI may have retried after AWS accepted our first request, or another ceremony may have
    # won the race. The create-time tag is atomic and distinguishes ownership before cleanup.
    role_owner=unknown
    for ((attempt=1; attempt<=attempts; attempt++)); do
      if tags="$(admin_aws iam list-role-tags --role-name "$role" --output json 2>/dev/null)"; then
        if jq -e --arg id "$ceremony_id" \
            '.Tags==[{Key:"WatchdogCeremonyId",Value:$id}]' <<< "$tags" >/dev/null; then
          role_owner=ours
          break
        elif jq -e --arg id "$ceremony_id" '
            any(.Tags[]?;.Key=="WatchdogCeremonyId" and .Value!=$id)' \
            <<< "$tags" >/dev/null; then
          role_owner=foreign
          break
        fi
      fi
      pause "$attempt"
    done
    if [ "$role_owner" != ours ]; then
      ceremony_started=0
    fi
  fi
  cat "$work/create-role.err" >&2
  exit "$create_status"
fi
retry_admin_mutation iam put-role-policy --role-name "$role" --policy-name "$role_policy" \
  --policy-document "file://$principal"
retry_admin_mutation iam put-user-policy --user-name "$user" --policy-name "$user_policy" \
  --policy-document "file://$bridge"

prove_exact_authority() {
  local role_json="$work/role.json" role_policy_json="$work/role-policy.json"
  local bridge_json="$work/bridge.json" inline_json="$work/inline.json"
  local attached_json="$work/attached.json" tags_json="$work/tags.json"
  admin_aws iam get-role --role-name "$role" --output json > "$role_json" 2>/dev/null || return 1
  admin_aws iam get-role-policy --role-name "$role" --policy-name "$role_policy" \
    --output json > "$role_policy_json" 2>/dev/null || return 1
  admin_aws iam get-user-policy --user-name "$user" --policy-name "$user_policy" \
    --output json > "$bridge_json" 2>/dev/null || return 1
  admin_aws iam list-role-policies --role-name "$role" --output json > "$inline_json" 2>/dev/null || return 1
  admin_aws iam list-attached-role-policies --role-name "$role" \
    --output json > "$attached_json" 2>/dev/null || return 1
  admin_aws iam list-role-tags --role-name "$role" \
    --output json > "$tags_json" 2>/dev/null || return 1
  jq -e --arg arn "arn:aws:iam::$account:role/$role" --slurpfile expected "$trust" '
    .Role.Arn==$arn and .Role.Path=="/" and .Role.MaxSessionDuration==3600
    and .Role.AssumeRolePolicyDocument==$expected[0]' "$role_json" >/dev/null || return 1
  jq -e --arg name "$role_policy" --slurpfile expected "$principal" '
    .PolicyName==$name and .PolicyDocument==$expected[0]' "$role_policy_json" >/dev/null || return 1
  jq -e --arg user "$user" --arg name "$user_policy" --slurpfile expected "$bridge" '
    .UserName==$user and .PolicyName==$name and .PolicyDocument==$expected[0]' \
    "$bridge_json" >/dev/null || return 1
  jq -e --arg name "$role_policy" '.PolicyNames==[$name]' "$inline_json" >/dev/null || return 1
  jq -e '.AttachedPolicies==[]' "$attached_json" >/dev/null || return 1
  jq -e --arg id "$ceremony_id" '.Tags==[{Key:"WatchdogCeremonyId",Value:$id}]' \
    "$tags_json" >/dev/null
}

exact=0
for ((attempt=1; attempt<=attempts; attempt++)); do
  if prove_exact_authority; then exact=1; break; fi
  pause "$attempt"
done
[ "$exact" -eq 1 ] || { echo 'ERROR: temporary promotion authority did not match its reviewed contract' >&2; exit 1; }

session=''
for ((attempt=1; attempt<=attempts; attempt++)); do
  if session="$(operator_aws sts assume-role \
    --role-arn "arn:aws:iam::$account:role/$role" \
    --role-session-name production-promotion-prerequisites \
    --duration-seconds 3600 --output json 2> "$work/assume.err")"; then
    break
  fi
  session=''
  pause "$attempt"
done
[ -n "$session" ] || { cat "$work/assume.err" >&2; exit 1; }

AWS_ACCESS_KEY_ID="$(jq -er '.Credentials.AccessKeyId' <<< "$session")" \
AWS_SECRET_ACCESS_KEY="$(jq -er '.Credentials.SecretAccessKey' <<< "$session")" \
AWS_SESSION_TOKEN="$(jq -er '.Credentials.SessionToken' <<< "$session")" \
AWS_ACCOUNT_ID="$account" \
PROMOTION_IAM_MAX_ATTEMPTS="$attempts" \
PROMOTION_IAM_RETRY_SECONDS="$retry_seconds" \
  env -u AWS_PROFILE -u AWS_DEFAULT_PROFILE bash "$helper" "$helper_mode"
