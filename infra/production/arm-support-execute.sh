#!/usr/bin/env bash
set -euo pipefail

# Arm / disarm the T2 EXECUTE database role for one incident.
#
#   arm-support-execute.sh arm <incident-ref> [minutes]
#   arm-support-execute.sh disarm
#   arm-support-execute.sh status
#
# watchdog_support_rw is NOLOGIN at rest. This is the only thing that changes that, and it is
# deliberately a separate script from the connect path so that "who may look" and "who may write"
# are different IAM permissions rather than the same session.
#
# WHERE THIS RUNS - read before wiring it up
#
# It needs two things at once: the writer DATABASE_URL, and a network route to private RDS. The
# intended home is a one-off ECS task with its own task role, matching the existing modes in
# infra/prod-ecs-express/run-release-task.sh, so that the writer credential never lands on the
# bastion. That wiring is a separate change; until it exists this script can be run from the
# bastion, but only with both of these true:
#
#   - the bastion instance profile's secretsmanager:GetSecretValue is scoped to the single
#     watchdog-bms/production/database-url secret and nothing else, and
#   - SSM session logging is on.
#
# The residual risk of the interim path is real and worth stating plainly: anyone who can open a
# bastion session can read the writer credential and therefore bypass every control in this file.
# That is the reason the ECS-task home is a follow-up and not an optional refinement.

usage() {
  echo "usage: $0 arm <incident-ref> [minutes] | disarm | status" >&2
  exit 2
}

region="${AWS_REGION:-ap-southeast-1}"
secret_id="${SUPPORT_WRITER_SECRET_ID:-watchdog-bms/production/database-url}"
state_param="${SUPPORT_ARM_STATE_PARAM:-/watchdog-bms/production/support-rw-armed}"
alert_topic="${SECURITY_ALERT_TOPIC_ARN:-}"
role_name=watchdog_support_rw
default_minutes=60
max_minutes=240

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    aws "$@"
}

command -v psql >/dev/null 2>&1 || { echo 'ERROR: psql is required' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo 'ERROR: jq is required' >&2; exit 1; }

# The URL is fetched into a variable and never echoed, never written to a file, and never placed on
# a command line. psql reads it from the environment so it stays out of the process table.
writer_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    printf '%s' "$DATABASE_URL"
    return 0
  fi
  aws_cmd secretsmanager get-secret-value --secret-id "$secret_id" \
    --query SecretString --output text --region "$region"
}

# psql picks the connection URI up from PGDATABASE (libpq treats a dbname holding a URI or an
# `=` sign as a full conninfo string). Passing it as an argument instead would both expand in the
# caller's environment before the assignment took effect and expose the credential in the process
# table for anyone running `ps` on the same host.
run_sql() {
  PGCONNECT_TIMEOUT=10 PGDATABASE="$(writer_url)" psql -v ON_ERROR_STOP=1 -qtAX -c "$1"
}

notify() {
  local subject="$1" message="$2"
  [ -n "$alert_topic" ] || { echo "WARNING: SECURITY_ALERT_TOPIC_ARN unset; no alert sent" >&2; return 0; }
  aws_cmd sns publish --topic-arn "$alert_topic" \
    --subject "$subject" --message "$message" --region "$region" >/dev/null
}

read_state() {
  aws_cmd ssm get-parameter --name "$state_param" --query 'Parameter.Value' --output text \
    --region "$region" 2>/dev/null || printf '{}'
}

# Truth lives in pg_roles, not in the SSM parameter. The parameter records *why* and *until when*;
# if the two ever disagree, the database is right and the parameter is stale bookkeeping.
role_is_armed() {
  [ "$(run_sql "SELECT rolcanlogin FROM pg_roles WHERE rolname = '${role_name}'")" = "t" ]
}

case "${1:-}" in
  arm)
    incident="${2:-}"
    minutes="${3:-$default_minutes}"
    [ -n "$incident" ] || usage
    # An incident reference is not paperwork. It is the key that ties the transcript, the alert and
    # the follow-up write-up together; without it a session cannot be reviewed later.
    [[ "$incident" =~ ^[A-Za-z0-9._-]{4,64}$ ]] \
      || { echo 'ERROR: incident-ref must be 4-64 chars of [A-Za-z0-9._-]' >&2; exit 2; }
    [[ "$minutes" =~ ^[1-9][0-9]*$ ]] && [ "$minutes" -le "$max_minutes" ] \
      || { echo "ERROR: minutes must be 1-${max_minutes}" >&2; exit 2; }

    if role_is_armed; then
      echo "ERROR: ${role_name} is already armed. Run 'disarm' first, or check 'status'." >&2
      exit 1
    fi

    operator="$(aws_cmd sts get-caller-identity --query Arn --output text --region "$region")"
    armed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    deadline="$(date -u -d "+${minutes} minutes" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
      || date -u -v "+${minutes}M" +%Y-%m-%dT%H:%M:%SZ)"

    run_sql "ALTER ROLE ${role_name} WITH LOGIN" >/dev/null

    aws_cmd ssm put-parameter --name "$state_param" --type String --overwrite --region "$region" \
      --value "$(jq -cn --arg i "$incident" --arg o "$operator" --arg a "$armed_at" --arg d "$deadline" \
        '{incident:$i,operator:$o,armedAt:$a,disarmBy:$d}')" >/dev/null

    notify "[CRITICAL] production support EXECUTE armed - ${incident}" \
"watchdog_support_rw was armed on production.

incident:  ${incident}
operator:  ${operator}
armed at:  ${armed_at}
disarm by: ${deadline}

If you did not expect this, treat it as an active security event and disarm immediately:
  arm-support-execute.sh disarm"

    cat >&2 <<EOF

  ${role_name} is ARMED for incident ${incident}
  DISARM BY ${deadline} (${minutes} minutes)

  Wrap every statement in BEGIN; check the row count; then COMMIT.
  Run 'arm-support-execute.sh disarm' as soon as the fix is verified - do not wait for the deadline.

EOF
    ;;

  disarm)
    if ! role_is_armed; then
      echo "${role_name} is already disarmed (NOLOGIN)."
      aws_cmd ssm delete-parameter --name "$state_param" --region "$region" >/dev/null 2>&1 || true
      exit 0
    fi
    state="$(read_state)"
    incident="$(jq -r '.incident // "unknown"' <<< "$state")"
    operator="$(aws_cmd sts get-caller-identity --query Arn --output text --region "$region")"

    run_sql "ALTER ROLE ${role_name} WITH NOLOGIN" >/dev/null
    # Sessions opened while armed survive NOLOGIN - it only blocks new logins. Terminate them so
    # that "disarmed" means what it says rather than "no new writers from now on".
    run_sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
             WHERE usename = '${role_name}' AND pid <> pg_backend_pid()" >/dev/null

    aws_cmd ssm delete-parameter --name "$state_param" --region "$region" >/dev/null 2>&1 || true
    notify "production support EXECUTE disarmed - ${incident}" \
"watchdog_support_rw was disarmed and its sessions terminated.

incident: ${incident}
by:       ${operator}
at:       $(date -u +%Y-%m-%dT%H:%M:%SZ)

Required follow-up: record what was changed in docs/agent-memory/<incident>.md within 24 hours."
    echo "${role_name} disarmed; open sessions terminated."
    ;;

  status)
    state="$(read_state)"
    if role_is_armed; then
      echo "ARMED"
      jq -r 'to_entries[] | "  \(.key): \(.value)"' <<< "$state" 2>/dev/null || true
      deadline="$(jq -r '.disarmBy // empty' <<< "$state")"
      if [ -n "$deadline" ] && [ "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \> "$deadline" ]; then
        echo "  OVERDUE - disarm now" >&2
        exit 1
      fi
    else
      echo "DISARMED"
    fi
    ;;

  *) usage ;;
esac
