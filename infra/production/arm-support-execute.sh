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
# The regional Amazon RDS bundle, installed on the bastion 2026-08-08. sslmode=verify-full needs a
# trust anchor and the OS store does not carry Amazon's RDS roots; without this psql fails with
# "certificate verify failed" rather than falling back to something weaker.
ca_bundle="${SUPPORT_RDS_CA_BUNDLE:-/opt/rds-ca/ap-southeast-1-bundle.pem}"
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
# Used to split the writer URL without hand-rolling percent-decoding in shell.
command -v python3 >/dev/null 2>&1 || { echo 'ERROR: python3 is required' >&2; exit 1; }

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

# libpq does NOT expand a URI held in the PGDATABASE *environment variable* - only the dbname
# *parameter* gets conninfo expansion. Verified against psql 16 on the bastion: PGDATABASE set to
# a postgres:// URI ignores it entirely and falls back to the local socket
# (/var/run/postgresql/.s.PGSQL.5432), while the same URI passed positionally connects. Passing it
# positionally is still not an option here - it would expose the writer credential in the process
# table to anyone running `ps` on the same host.
#
# So the URI is split into the discrete PG* variables libpq reads natively. The credential stays in
# the environment and off every command line, which is what the original comment intended.
export_pg_env() {
  local assignments
  assignments="$(DBURL="$(writer_url)" python3 -c '
import os, shlex, urllib.parse, sys
u = urllib.parse.urlparse(os.environ["DBURL"])
q = urllib.parse.parse_qs(u.query)
values = {
    "PGHOST": u.hostname or "",
    "PGPORT": str(u.port or 5432),
    "PGUSER": urllib.parse.unquote(u.username or ""),
    "PGPASSWORD": urllib.parse.unquote(u.password or ""),
    "PGDATABASE": (u.path or "/").lstrip("/"),
    # Never silently weaken TLS: an absent sslmode means verify-full, not "whatever connects".
    "PGSSLMODE": q.get("sslmode", ["verify-full"])[0],
}
if not values["PGHOST"] or not values["PGDATABASE"] or not values["PGUSER"]:
    sys.exit("writer URL is missing host, user or database")
print("\n".join("export %s=%s" % (k, shlex.quote(v)) for k, v in values.items()))
')" || { echo "ERROR: could not parse the writer database URL" >&2; return 1; }
  eval "$assignments"
  export PGSSLROOTCERT="$ca_bundle"
}

run_sql() {
  export_pg_env || return 1
  PGCONNECT_TIMEOUT=10 psql -v ON_ERROR_STOP=1 -qtAX -c "$1"
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
#
# A failed query is not an answer. The previous form - [ "$(run_sql ...)" = "t" ] - returned false
# both when the role was genuinely NOLOGIN and when psql could not run at all (DB unreachable,
# expired IAM token, missing grant). `disarm` reads this as "already disarmed", so it printed
# success, deleted the state parameter and exited 0 while production write access was still open,
# and `status` printed DISARMED for the same reason. A break-glass control that cannot read its own
# state has to stop, not guess: every exit below is deliberate rather than a boolean.
role_is_armed() {
  local answer
  if ! answer="$(run_sql "SELECT rolcanlogin FROM pg_roles WHERE rolname = '${role_name}'")"; then
    echo "ERROR: cannot read ${role_name} from the database; refusing to guess its armed state" >&2
    echo "       Resolve the connection problem first - do not assume it is disarmed." >&2
    exit 3
  fi
  case "$answer" in
    t) return 0 ;;
    f) return 1 ;;
    '') echo "ERROR: role ${role_name} does not exist; run bootstrap-support-roles.sql first" >&2
        exit 3 ;;
    *)  echo "ERROR: unexpected rolcanlogin value for ${role_name}: '${answer}'" >&2
        exit 3 ;;
  esac
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

    # The alert is the second-person control, not a courtesy. Arming production write access and
    # then failing to announce it is the one outcome this script must never leave behind, so a
    # failed publish rolls the arm back rather than exiting non-zero on top of an armed role.
    if ! notify "[CRITICAL] production support EXECUTE armed - ${incident}" \
"watchdog_support_rw was armed on production.

incident:  ${incident}
operator:  ${operator}
armed at:  ${armed_at}
disarm by: ${deadline}

If you did not expect this, treat it as an active security event and disarm immediately:
  arm-support-execute.sh disarm"; then
      run_sql "ALTER ROLE ${role_name} WITH NOLOGIN" >/dev/null 2>&1 || true
      aws_cmd ssm delete-parameter --name "$state_param" --region "$region" >/dev/null 2>&1 || true
      echo "ERROR: the arm alert could not be sent, so ${role_name} was disarmed again." >&2
      echo "       Check sns:Publish on ${alert_topic:-<SECURITY_ALERT_TOPIC_ARN unset>} and retry." >&2
      echo "       Verify with 'arm-support-execute.sh status' before assuming the rollback worked." >&2
      exit 1
    fi

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
