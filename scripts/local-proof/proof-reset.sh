#!/usr/bin/env bash
# Usage: proof-reset.sh — stop the proof API, wipe/recreate only the named proof DB, migrate and seed.
# Safety: exact decoded database-name equality, checked local URL, SQL identifier validation,
# recorded process-group stop, and the shared heavy lock. Starts no servers.
# Safety: FLUSHDB only on the exact configured local proof Redis URL, isolated from trial.
set -eu
source "$(dirname "$0")/common.sh"
lp_heavy "$@"
lp_env proof
python3 - <<'PY'
import os, sys
from urllib.parse import urlsplit, unquote
if unquote(urlsplit(os.environ['DATABASE_URL']).path[1:]) != os.environ['PROOF_DATABASE_NAME']:
    sys.exit('REFUSING: database name does not equal PROOF_DATABASE_NAME.')
PY
bash "$LOCAL_PROOF_DIR/proof-stop.sh" api
DROP="DROP DATABASE IF EXISTS \"$PROOF_DATABASE_NAME\" WITH (FORCE)"
CREATE="CREATE DATABASE \"$PROOF_DATABASE_NAME\""
if [ -n "$POSTGRES_CONTAINER" ]; then
  docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_CONTAINER_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "$DROP" -c "$CREATE"
else
  # Prisma's schema/pool options are not psql options. Use the same server/credentials, admin DB.
  admin_url=$(python3 - <<'PY'
import os
from urllib.parse import urlsplit
print(urlsplit(os.environ['DATABASE_URL'])._replace(path='/postgres', query='', fragment='').geturl())
PY
)
  psql "$admin_url" -v ON_ERROR_STOP=1 -q -c "$DROP" -c "$CREATE"
fi
node <<'JS'
const Redis = require('./apps/api/node_modules/ioredis');
const target = process.env.REDIS_URL;
const url = new URL(target);
if (target !== process.env.PROOF_REDIS_URL || !['redis:', 'rediss:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/\d+$/.test(url.pathname) || url.search || url.hash) {
  throw new Error('REFUSING: Redis reset requires the exact configured local proof URL.');
}
const redis = new Redis(target, { lazyConnect: true, retryStrategy: () => null, connectTimeout: 5000, commandTimeout: 5000 });
redis.on('error', () => {}); // Report a credential-free failure below.
(async () => {
  try {
    await redis.connect();
    await redis.flushdb();
    console.log('PROOF_REDIS_RESET_DONE');
  } catch {
    console.error('Proof Redis reset failed; check the local proof Redis settings/server.');
    process.exitCode = 1;
  } finally { redis.disconnect(); }
})();
JS
cd "$LOCAL_PROOF_ROOT/apps/api"
./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma > "$LP_LOGS/reset-migrate.log" 2>&1
./node_modules/.bin/tsx prisma/sync-permissions.ts > "$LP_LOGS/reset-sync.log" 2>&1
./node_modules/.bin/tsx prisma/sync-feature-launch-gates.ts --verify-specialist-closed >> "$LP_LOGS/reset-sync.log" 2>&1
./node_modules/.bin/tsx prisma/sync-thai-address-master.ts >> "$LP_LOGS/reset-sync.log" 2>&1
./node_modules/.bin/tsx prisma/seed.ts > "$LP_LOGS/reset-seed.log" 2>&1
echo "PROOF_DB_RESET_DONE $(date +%H:%M:%S)"
