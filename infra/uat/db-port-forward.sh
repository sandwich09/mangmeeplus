#!/usr/bin/env bash
# Open localhost:<port> → UAT RDS (watchdog-bms-uat-db) through the SSM bastion.
# The UAT DB is not publicly accessible; this is the supported way to reach it from a
# workstation (docs/runbooks/cloud-environment-operations.md).
#
# Usage:
#   infra/uat/db-port-forward.sh            # open tunnel on 127.0.0.1:55432, Ctrl-C closes
#   infra/uat/db-port-forward.sh --url      # print a psql-ready URL pointed at the tunnel
#   infra/uat/db-port-forward.sh --fields   # print host/port/db/user/password for DBeaver
#   LOCAL_PORT=56000 infra/uat/db-port-forward.sh
#
# 55432 avoids the local docker DB (:15432) and the e2e DB (:5432).
# Needs the AWS session-manager-plugin: brew install --cask session-manager-plugin
set -euo pipefail

region="${AWS_REGION:-ap-southeast-1}"
aws_bin="${AWS_BIN:-aws}"
local_port="${LOCAL_PORT:-55432}"
db_id="watchdog-bms-uat-db"
database_secret="watchdog-bms/uat/database-url"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy "$aws_bin" "$@"
}

if [ "${1:-}" = "--url" ]; then
  # Rewrite the stored URL at the tunnel entrance: host:5432 → 127.0.0.1:<port>.
  # Drop schema=public — that is a Prisma-only param and libpq rejects it as an
  # invalid URI query parameter. verify-full would reject the RDS cert when dialing
  # 127.0.0.1, so drop to sslmode=require (still TLS, no hostname check — fine here).
  aws_cmd secretsmanager get-secret-value --secret-id "$database_secret" \
      --query SecretString --output text --region "$region" \
    | sed -E "s#@[^/]*/#@127.0.0.1:${local_port}/#; s#schema=public&##; s#sslmode=verify-full&sslrootcert=[^&]*#sslmode=require#"
  exit 0
fi

if [ "${1:-}" = "--fields" ]; then
  # Split the stored URL into the fields DBeaver asks for. The password is openssl
  # rand -hex (bootstrap-data.sh), so no URL-encoded characters to decode.
  raw="$(aws_cmd secretsmanager get-secret-value --secret-id "$database_secret" \
    --query SecretString --output text --region "$region")"
  rest="${raw#postgresql://}"
  userpass="${rest%%@*}"; hostportdb="${rest#*@}"
  hostport="${hostportdb%%/*}"; dbq="${hostportdb#*/}"
  echo "RDS host : ${hostport%:*}"
  echo "RDS port : ${hostport##*:}"
  echo "Database : ${dbq%%\?*}"
  echo "Username : ${userpass%%:*}"
  echo "Password : ${userpass#*:}"
  echo
  echo "DBeaver connects through the tunnel, so in the connection use:"
  echo "  Host 127.0.0.1   Port ${local_port}   (start the tunnel first: infra/uat/db-port-forward.sh)"
  exit 0
fi

command -v session-manager-plugin >/dev/null 2>&1 || {
  echo "ERROR: session-manager-plugin not installed (brew install --cask session-manager-plugin)" >&2
  exit 1
}

bastion_id="$(aws_cmd ec2 describe-instances \
  --filters 'Name=tag:Name,Values=watchdog-bms-ssm-bastion' 'Name=instance-state-name,Values=running' \
  --query 'Reservations[0].Instances[0].InstanceId' --output text --region "$region")"
if [ -z "$bastion_id" ] || [ "$bastion_id" = "None" ]; then
  echo "ERROR: bastion watchdog-bms-ssm-bastion is not running" >&2
  exit 1
fi

db_host="$(aws_cmd rds describe-db-instances --db-instance-identifier "$db_id" \
  --query 'DBInstances[0].Endpoint.Address' --output text --region "$region")"

# Fail fast if the UAT DB SG does not admit the bastion SG on 5432 — otherwise the
# tunnel opens fine and every connection just hangs with no error to go on.
db_sg="$(aws_cmd rds describe-db-instances --db-instance-identifier "$db_id" \
  --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text --region "$region")"
bastion_sg="$(aws_cmd ec2 describe-instances --instance-ids "$bastion_id" \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text --region "$region")"
if ! aws_cmd ec2 describe-security-groups --group-ids "$db_sg" --region "$region" \
    --query 'SecurityGroups[0].IpPermissions[?ToPort==`5432`].UserIdGroupPairs[].GroupId' \
    --output text | grep -q "$bastion_sg"; then
  echo "ERROR: UAT DB SG $db_sg does not allow bastion SG $bastion_sg on 5432. Open it with:" >&2
  echo "  aws ec2 authorize-security-group-ingress --group-id $db_sg --protocol tcp --port 5432 --source-group $bastion_sg --region $region" >&2
  exit 1
fi

echo "UAT DB tunnel: 127.0.0.1:${local_port} → ${db_host}:5432 (Ctrl-C closes)"
echo "Connect with: psql \"\$(infra/uat/db-port-forward.sh --url)\""
aws_cmd ssm start-session \
  --target "$bastion_id" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=${db_host},portNumber=5432,localPortNumber=${local_port}" \
  --region "$region"
