#!/usr/bin/env bash
set -euo pipefail

# Read-only inspection of the production database's applied-migration state, compared against the
# migration files in this checkout. Answers the one question that decides whether the release task
# will apply cleanly or fail mid-flight: does every applied row's checksum still match the file
# whose bytes it recorded?
#
#   bash infra/production/inspect-migration-state.sh
#
# WHERE THIS RUNS: on the bastion, which has both a route to private RDS and (via its instance
# profile) read access to the database-url secret. It reads nothing but pg_catalog and
# _prisma_migrations, opens a READ ONLY transaction, and writes only to a temp file it then
# removes. It never calls `prisma migrate` and never mutates a row.
#
# Prisma's checksum is a plain sha256 of migration.sql's bytes (confirmed in
# migration-drift-diagnosis.md against 91/96 dev rows), so the comparison is reproducible here
# without Prisma installed.

region="${AWS_REGION:-ap-southeast-1}"
secret_id="${MIGRATION_DB_SECRET_ID:-watchdog-bms/production/database-url}"
repo_root="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
migrations_dir="$repo_root/apps/api/prisma/migrations"

aws_cmd() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
    aws "$@"
}

command -v psql >/dev/null 2>&1 || { echo 'ERROR: psql is required (run this on the bastion)' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 && SHA=sha256sum || SHA="shasum -a 256"
[ -d "$migrations_dir" ] || { echo "ERROR: cannot find $migrations_dir (run inside the repo checkout)" >&2; exit 1; }

# Fetch the URL into the environment only; never echo it, never put it on a command line.
writer_url() {
  if [ -n "${DATABASE_URL:-}" ]; then printf '%s' "$DATABASE_URL"; return 0; fi
  aws_cmd secretsmanager get-secret-value --secret-id "$secret_id" \
    --query SecretString --output text --region "$region"
}

psql_ro() {
  PGCONNECT_TIMEOUT=10 PGDATABASE="$(writer_url)" \
    psql -v ON_ERROR_STOP=1 -qtAX -c "SET default_transaction_read_only = on;" -c "$1"
}

echo '== production migration-state inspection =='

# 1. Does the table exist at all? A fresh database (this repo never deployed here) has no
#    _prisma_migrations, and the release task will simply apply all files in order.
exists="$(psql_ro "SELECT to_regclass('public._prisma_migrations') IS NOT NULL;")"
if [ "$exists" != t ]; then
  echo 'RESULT: _prisma_migrations does not exist.'
  echo 'The production schema is empty. The first release task applies all migrations from zero;'
  echo "there is no drift to reconcile. Files in this checkout: $(find "$migrations_dir" -name migration.sql | wc -l | tr -d ' ')."
  exit 0
fi

applied_count="$(psql_ro "SELECT count(*) FROM _prisma_migrations;")"
failed_count="$(psql_ro "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;")"
rolledback_count="$(psql_ro "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NOT NULL;")"
file_count="$(find "$migrations_dir" -name migration.sql | wc -l | tr -d ' ')"

echo "applied rows        : $applied_count"
echo "files in checkout   : $file_count"
echo "in-progress/failed  : $failed_count"
echo "rolled back         : $rolledback_count"
echo

# 2. Compare applied checksums against the files. Dump applied rows once, compute file hashes once,
#    and diff in memory - no per-row database round-trips.
applied_dump="$(psql_ro "SELECT migration_name || ' ' || checksum FROM _prisma_migrations ORDER BY started_at, migration_name;")"

status=0
mismatch=0
orphan=0
missing_file=0

while IFS=' ' read -r name checksum; do
  [ -n "$name" ] || continue
  file="$migrations_dir/$name/migration.sql"
  if [ ! -f "$file" ]; then
    # A row whose file is absent from the checkout: either an orphan (drift) or a migration from a
    # newer line than this checkout. Either way the release from THIS commit cannot reconcile it.
    echo "ORPHAN  applied '$name' has no migration.sql in this checkout"
    orphan=$((orphan + 1)); status=1
    continue
  fi
  file_hash="$($SHA "$file" | cut -d' ' -f1)"
  if [ "$file_hash" != "$checksum" ]; then
    echo "DRIFT   '$name' applied checksum ${checksum:0:12}... != file ${file_hash:0:12}..."
    mismatch=$((mismatch + 1)); status=1
  fi
done <<< "$applied_dump"

# 3. Files present in the checkout but never applied are normal (the release will apply them) -
#    report the count only, and flag if any sits BEFORE an already-applied one, which is the
#    genuinely dangerous shape (an out-of-order insert Prisma will refuse).
pending=0
last_applied=""
while IFS= read -r dir; do
  name="$(basename "$(dirname "$dir")")"
  if ! grep -q "^$name " <<< "$applied_dump"; then
    pending=$((pending + 1))
  else
    last_applied="$name"
  fi
done <<< "$(find "$migrations_dir" -name migration.sql | sort)"

echo
echo "pending (will apply): $pending"

if [ "$failed_count" -ne 0 ]; then
  echo
  echo "WARNING: $failed_count migration row(s) are in-progress/failed. prisma migrate deploy will"
  echo "refuse to proceed until each is resolved with 'prisma migrate resolve'. Do NOT delete the"
  echo "rows by hand - verify-applied-migration-catalog.ts checks them."
  status=1
fi

echo
if [ "$status" -eq 0 ]; then
  echo 'RESULT: PASS. Every applied checksum matches its file; the release task can apply the'
  echo "        $pending pending migration(s) cleanly."
else
  echo 'RESULT: DRIFT PRESENT. Do not deploy yet.'
  echo "        mismatches=$mismatch orphans=$orphan failed=$failed_count"
  echo '        Reconcile using the playbook in docs/agent-memory/migration-drift-diagnosis.md,'
  echo '        record what was changed, and re-run this check until it passes.'
fi
exit "$status"
