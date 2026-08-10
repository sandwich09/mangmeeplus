#!/usr/bin/env bash
# Reset the LINE link for ONE selected LINE account so the link/login flow can be
# tested again from scratch (UAT). Surveys by default; deletes only with --apply.
#
# Clears, for the given LINE user id (the "U…" id):
#   ExternalIdentity     provider='LINE', providerUserId    → the login/link binding itself
#   LineCompanyContext   lineUserId                         → selected-company context (shared OA)
#   LineWebhookEventLog  lineUserIdHash (sha256 hex, 16)    → webhook dedupe/log rows
# Intentionally left alone:
#   EmployeeLineLinkToken — invite tokens are per-membership, not per-LINE-account; issue a fresh QR.
#   CRM identities (CrmChannelIdentity, CrmCustomer.lineUserId) — customer domain, not login link.
#
# Usage (through the UAT tunnel — see infra/uat/db-port-forward.sh):
#   scripts/heal/line-link-reset.sh "$(infra/uat/db-port-forward.sh --url)" <LINE_USER_ID>            # survey
#   scripts/heal/line-link-reset.sh "$(infra/uat/db-port-forward.sh --url)" <LINE_USER_ID> --apply    # delete
set -euo pipefail

url="${1:?usage: line-link-reset.sh <postgres-url> <LINE_USER_ID> [--apply]}"
line_id="${2:?usage: line-link-reset.sh <postgres-url> <LINE_USER_ID> [--apply]}"
mode="${3:-survey}"

case "$url" in
  *prod*)
    echo "ERROR: refusing to run against anything that looks like production" >&2
    exit 1
    ;;
esac

# psql from PATH, else the keg-only homebrew libpq (client-only install, not linked).
psql_bin="${PSQL:-psql}"
command -v "$psql_bin" >/dev/null 2>&1 || psql_bin="/opt/homebrew/opt/libpq/bin/psql"
command -v "$psql_bin" >/dev/null 2>&1 || {
  echo "ERROR: psql not found — brew install libpq (or set PSQL=/path/to/psql)" >&2
  exit 1
}

# Same derivation as hashMessagePreview() in line-ai-classifier.logic.ts: sha256 hex, first 16.
line_hash="$(printf %s "$line_id" | shasum -a 256 | cut -c1-16)"

"$psql_bin" "$url" -v ON_ERROR_STOP=1 -v line_id="$line_id" -v line_hash="$line_hash" <<'SQL'
\echo '== ExternalIdentity (login/link binding) =='
SELECT ei.id, ei.status, ei."providerChannelId", ei."linkedAt", ei."lastLoginAt",
       u.id AS user_id, u.email, u."displayName"
FROM "ExternalIdentity" ei
JOIN "User" u ON u.id = ei."userId"
WHERE ei.provider = 'LINE' AND ei."providerUserId" = :'line_id';

\echo '== LineCompanyContext (selected company) =='
SELECT ctx."companyId", c.name AS company, ctx."selectedAt"
FROM "LineCompanyContext" ctx
LEFT JOIN "Company" c ON c.id = ctx."companyId"
WHERE ctx."lineUserId" = :'line_id';

\echo '== LineWebhookEventLog rows for this LINE user =='
SELECT count(*) AS webhook_log_rows
FROM "LineWebhookEventLog"
WHERE "lineUserIdHash" = :'line_hash';
SQL

if [ "$mode" != "--apply" ]; then
  echo
  echo "Survey only — nothing deleted. Re-run with --apply to delete."
  exit 0
fi

"$psql_bin" "$url" -v ON_ERROR_STOP=1 -v line_id="$line_id" -v line_hash="$line_hash" <<'SQL'
BEGIN;
WITH d_identity AS (
  DELETE FROM "ExternalIdentity"
  WHERE provider = 'LINE' AND "providerUserId" = :'line_id' RETURNING 1
), d_context AS (
  DELETE FROM "LineCompanyContext" WHERE "lineUserId" = :'line_id' RETURNING 1
), d_webhook AS (
  DELETE FROM "LineWebhookEventLog" WHERE "lineUserIdHash" = :'line_hash' RETURNING 1
)
SELECT (SELECT count(*) FROM d_identity) AS external_identities_deleted,
       (SELECT count(*) FROM d_context)  AS company_contexts_deleted,
       (SELECT count(*) FROM d_webhook)  AS webhook_logs_deleted;
COMMIT;
SQL
