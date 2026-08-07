#!/usr/bin/env bash
#
# Deterministic local E2E runner for WatchDog-BMS.
# Encodes the environment landmines so a run is reproducible (see e2e/HANDOFF.md).
#
# Usage:
#   e2e/run-local.sh                     # run the whole suite
#   e2e/run-local.sh --grep @smoke       # run only smoke-tagged tests
#   e2e/run-local.sh e2e/inventory.spec.ts
#   PWDEBUG=1 e2e/run-local.sh --headed  # debug
#
# Playwright's webServer (playwright.config.ts) builds + boots the API (:3001) and
# web (:3000) from source. This script only guarantees the *infra* they need.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root (WatchDog-BMS)

# --- LANDMINE 1: DB port. The SEEDED database is native postgres on :5432, which is
# playwright.config.ts's default. .env / .env.example point at 15433 / 15432 (docker,
# usually DOWN). Force the known-good URL unless the caller overrode it on purpose. ---
export DATABASE_URL="${DATABASE_URL:-postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_bms?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
PSQL_DATABASE_URL="${DATABASE_URL%%\?schema=*}"

# EXP-06 uses compose.local.yml's MinIO when explicitly requested or already up.
if [ "${S3_E2E:-0}" = "1" ] || curl --fail --silent --max-time 1 http://127.0.0.1:19000/minio/health/live >/dev/null 2>&1; then
  export S3_E2E_ACTIVE=1
  export S3_BUCKET="${S3_BUCKET:-watchdog-bms-local}"
  export S3_REGION="${S3_REGION:-local}"
  export S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:19000}"
  export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"
  export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-watchdog}"
  export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-watchdog_local_secret}"
  # AWS SDK credential discovery uses AWS_*; values mirror the compose S3_* credentials.
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-$S3_ACCESS_KEY_ID}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-$S3_SECRET_ACCESS_KEY}"
  echo "  MinIO E2E enabled at $S3_ENDPOINT"
else
  export S3_E2E_ACTIVE=0
  echo "  MinIO unavailable — EXP-06 will be skipped (set S3_E2E=1 after starting compose MinIO)"
fi

echo "==> Preflight"

# 1. Postgres reachable + seeded company present.
if ! psql "$PSQL_DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1; then
  echo "FAIL: cannot reach postgres at $PSQL_DATABASE_URL" >&2
  echo "      Start it (native postgres on :5432, or docker) then re-run." >&2
  exit 1
fi
# 1a. Schema at head. A DB behind the branch does not fail loudly — it 500s on
# /auth/password/login and the seed dies with P2022 ColumnNotFound, both of which read
# as auth bugs. Check before anything else touches the DB.
if ! ( cd apps/api && DATABASE_URL="$DATABASE_URL" corepack pnpm exec prisma migrate status >/dev/null 2>&1 ); then
  echo "FAIL: database schema is behind prisma/migrations." >&2
  echo "      cd apps/api && corepack pnpm exec prisma migrate deploy \\" >&2
  echo "        && corepack pnpm exec prisma generate \\" >&2
  echo "        && corepack pnpm exec tsx prisma/seed.ts" >&2
  exit 1
fi

# 1b. Seed present AND current. Checking only for the company row is not enough: rows added
# to seed.ts later (the qa.* role accounts) are missing from a database seeded before them,
# and every role login then returns 500. Probe a row from the newest seed block too.
company_count=$(psql "$PSQL_DATABASE_URL" -tAc "select count(*) from \"Company\" where id='seed-local-company'" 2>/dev/null || echo 0)
qa_count=$(psql "$PSQL_DATABASE_URL" -tAc "select count(*) from \"User\" where username like 'qa.%'" 2>/dev/null || echo 0)
if [ "${company_count//[[:space:]]/}" != "1" ] || [ "${qa_count//[[:space:]]/}" -lt 10 ]; then
  echo "WARN: seed missing or stale (company=$company_count qa_accounts=$qa_count) — seeding now" >&2
  ( cd apps/api && DATABASE_URL="$DATABASE_URL" corepack pnpm exec tsx prisma/seed.ts )
else
  # Seed already present, so the block above did not run — reconcile grants anyway. Role grants
  # change without any seed row changing, and a permission-model test asserting against a
  # database that still holds a revoked grant is worse than useless. Idempotent, ~2s.
  ( cd apps/api && DATABASE_URL="$DATABASE_URL" corepack pnpm exec tsx prisma/sync-permissions.ts >/dev/null )
fi
echo "  postgres OK, schema at head, seed present (qa accounts: ${qa_count//[[:space:]]/}), permissions synced"

# 2. Redis is optional at boot (only line-ai-ledger uses it). Warn, don't block.
if ! redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
  echo "  WARN: no redis at $REDIS_URL — most tests pass, but line-ai/rate-limit paths may not." >&2
else
  echo "  redis OK"
fi

echo "==> Running Playwright (webServer will build+boot api:${API_PORT:-3001} and web:${WEB_PORT:-3000}; first boot ~2min)"
corepack pnpm exec playwright test "$@"
status=$?

echo "==> Report at: playwright-report/index.html  (open: corepack pnpm exec playwright show-report)"
exit $status
