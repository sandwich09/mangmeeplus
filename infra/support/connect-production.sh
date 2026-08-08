#!/usr/bin/env bash
set -euo pipefail

# Single entry point from an operator workstation into production support access.
#
#   connect-production.sh view    <incident-ref>            # T1 - read-only psql
#   connect-production.sh execute <incident-ref>            # T2 - write psql (must be armed)
#   connect-production.sh arm     <incident-ref> [minutes]  # arm T2 (different person)
#   connect-production.sh disarm
#   connect-production.sh status
#
# Everything runs as an interactive command *on the bastion*, never as a port forward. That is the
# whole point: SSM records a Standard_Stream session keystroke for keystroke, while a port-forward
# session records only that a tunnel existed. A GUI client would be more comfortable and would
# leave no answer to "which customer's data was read on the 8th".
#
# Prerequisites on the bastion (see docs/runbooks/production-support-access.md):
#   - postgresql client, jq, awscli
#   - RDS CA bundle at /opt/rds-ca/global-bundle.pem
#   - instance profile with rds-db:connect for both support db users, and rds:DescribeDBInstances
#   - SSM session logging enabled to S3 + CloudWatch, KMS encrypted
#
# Prerequisites on the workstation: awscli and the Session Manager plugin.

usage() {
  echo "usage: $0 view|execute <incident-ref> | arm <incident-ref> [minutes] | disarm | status" >&2
  exit 2
}

region="${AWS_REGION:-ap-southeast-1}"
bastion_name="${SUPPORT_BASTION_NAME:-watchdog-bms-ssm-bastion}"
db_instance="${SUPPORT_DB_INSTANCE:-watchdog-bms-prod-db}"
db_name="${SUPPORT_DB_NAME:-watchdog_bms}"
ca_bundle="${SUPPORT_RDS_CA_BUNDLE:-/opt/rds-ca/ap-southeast-1-bundle.pem}"
arm_script="${SUPPORT_ARM_SCRIPT:-/opt/watchdog/arm-support-execute.sh}"

mode="${1:-}"
[ -n "$mode" ] || usage

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    aws "$@"
}

command -v session-manager-plugin >/dev/null 2>&1 \
  || { echo 'ERROR: the AWS Session Manager plugin is not installed' >&2; exit 1; }

require_incident() {
  [ -n "${1:-}" ] || usage
  # Same shape the arm script enforces, checked here too so a typo fails on the workstation
  # instead of halfway through opening a production session.
  [[ "$1" =~ ^[A-Za-z0-9._-]{4,64}$ ]] \
    || { echo 'ERROR: incident-ref must be 4-64 chars of [A-Za-z0-9._-]' >&2; exit 2; }
}

resolve_instance_id() {
  local id
  id="$(aws_cmd ec2 describe-instances --region "$region" \
    --filters "Name=tag:Name,Values=${bastion_name}" 'Name=instance-state-name,Values=running' \
    --query 'Reservations[].Instances[].InstanceId' --output text)"
  case "$(printf '%s' "$id" | wc -w)" in
    1) printf '%s' "$id" ;;
    0) echo "ERROR: no running instance tagged Name=${bastion_name} in ${region}" >&2; return 1 ;;
    *) echo "ERROR: ${bastion_name} matches more than one running instance: ${id}" >&2; return 1 ;;
  esac
}

start_command() {
  local instance_id="$1" command="$2"
  aws_cmd ssm start-session --region "$region" --target "$instance_id" \
    --document-name AWS-StartInteractiveCommand \
    --parameters "command=[\"$(printf '%s' "$command" | sed 's/\\/\\\\/g; s/"/\\"/g')\"]"
}

# The operator identity travels into application_name so every server-side log line can be tied
# back to a person and an incident. `%a` must be in log_line_prefix for this to be worth anything.
psql_command() {
  local db_user="$1" incident="$2" operator="$3" host="$4"
  cat <<EOF
set -eu
host='${host}'
export PGPASSWORD="\$(aws rds generate-db-auth-token --hostname \$host --port 5432 --username ${db_user} --region ${region})"
exec psql "host=\$host port=5432 dbname=${db_name} user=${db_user} sslmode=verify-full sslrootcert=${ca_bundle} application_name=support:${incident}:${operator}"
EOF
}

case "$mode" in
  view|execute)
    incident="${2:-}"
    require_incident "$incident"

    instance_id="$(resolve_instance_id)"
    host="$(aws_cmd rds describe-db-instances --db-instance-identifier "$db_instance" \
      --query 'DBInstances[0].Endpoint.Address' --output text --region "$region")"
    operator="$(aws_cmd sts get-caller-identity --query Arn --output text --region "$region" \
      | sed 's#.*/##' | cut -c1-32)"

    if [ "$mode" = view ]; then
      db_user=watchdog_support_ro
      cat >&2 <<EOF

  T1 VIEW - read-only. The server enforces it; you cannot write even by mistake.
  incident ${incident}   statement_timeout 15s   lock_timeout 2s
  This session is recorded in full. Read only what the incident needs.

EOF
    else
      db_user=watchdog_support_rw
      cat >&2 <<EOF

  T2 EXECUTE - this session can write to production.
  incident ${incident}   statement_timeout 30s   lock_timeout 2s

  BEGIN; run the statement; check the row count; only then COMMIT.
  If the fix is possible through the API or the UI, stop and do it there instead - those paths
  carry permission checks, ABAC and audit that raw SQL bypasses.
  Every data fix caused by a bug needs a code fix to follow, or it will come back.

EOF
      # Failing here beats failing after a psql prompt appears: a NOLOGIN role produces an
      # authentication error that reads like a broken setup rather than "nobody armed it".
      if ! aws_cmd ssm get-parameter --name /watchdog-bms/production/support-rw-armed \
            --region "$region" >/dev/null 2>&1; then
        echo "ERROR: watchdog_support_rw is not armed. A second person must run:" >&2
        echo "         connect-production.sh arm ${incident}" >&2
        exit 1
      fi
    fi

    start_command "$instance_id" "$(psql_command "$db_user" "$incident" "$operator" "$host")"
    ;;

  arm)
    incident="${2:-}"
    require_incident "$incident"
    minutes="${3:-60}"
    start_command "$(resolve_instance_id)" "sudo ${arm_script} arm '${incident}' '${minutes}'"
    ;;

  disarm)
    start_command "$(resolve_instance_id)" "sudo ${arm_script} disarm"
    ;;

  status)
    start_command "$(resolve_instance_id)" "sudo ${arm_script} status"
    ;;

  *) usage ;;
esac
