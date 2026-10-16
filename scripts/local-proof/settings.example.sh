#!/usr/bin/env bash
# Copy to settings.local.sh and edit that file. Local development credentials only.
# Dependencies already used by the original toolkit: bash, Node/corepack/pnpm,
# Python 3, Perl/POSIX, lsof, and psql (or Docker with psql in its PostgreSQL container).
# common.sh fixes development/local/dev-auth mode and derives API/web URLs, CORS, JWT issuer,
# service identity and E2E URLs from the selected stack; no machine-specific env.sh is needed.

# Trial web port (the runbook's isolated topology, rather than Playwright's 3000).
TRIAL_WEB_PORT=3140
# Trial web bind address; proof web and both APIs always bind to loopback.
WEB_HOST='127.0.0.1'
# Trial API port (rather than Playwright's 3001).
TRIAL_API_PORT=3141
# Proof web port, distinct from the trial stack.
PROOF_WEB_PORT=3150
# Proof API port, distinct from the trial stack.
PROOF_API_PORT=3151
# Trial database; credentials/host/port follow playwright.config.ts, with a separate database.
TRIAL_DATABASE_URL='postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_pvtry?schema=public'
# Disposable proof database; reset.sh is the only script that drops a database.
PROOF_DATABASE_URL='postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_pv_proof?schema=public'
# Exact database name reset is allowed to drop; must match PROOF_DATABASE_URL.
PROOF_DATABASE_NAME='watchdog_pv_proof'
# Database for verification and the real-PostgreSQL specs; never the trial database.
REALPG_DATABASE_URL='postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_pv_land?schema=public'
# PostgreSQL container containing the proof database; empty means native psql via its URL.
POSTGRES_CONTAINER=''
# Role used by psql inside that container (native psql uses the proof URL's credentials).
POSTGRES_CONTAINER_USER='watchdog'
# All logs, summaries, Playwright results and recorded process groups go here (relative paths use the repo root).
LOCAL_PROOF_OUTPUT_DIR="$LOCAL_PROOF_ROOT/.local-proof"
# Shared across worktrees/sessions on this machine; never remove while its owner is running.
HEAVY_LOCK_DIR='/tmp/mangmee-heavy.lock'
# Also coordinate with standalone uses of the original TypeScript checker.
TSC_LOCK_DIR='/tmp/mangmee-tsc.lock'
# Trial API build output, relative to apps/api; keep beneath ignored dist/.
TRIAL_API_DIST_DIR="dist/dev-$TRIAL_API_PORT"
# Proof API build output, separate from the running trial API.
PROOF_API_DIST_DIR="dist/e2e-$PROOF_API_PORT"
# Trial Next.js output, relative to apps/web.
TRIAL_NEXT_DIST_DIR='.next'
# Proof Next.js output, separate from trial (Next may rewrite next-env.d.ts; review it).
PROOF_NEXT_DIST_DIR='.next/proof'
# Trial caches and rate limits: Playwright's local Redis server, database 0.
TRIAL_REDIS_URL='redis://localhost:6379/0'
# Disposable proof caches and rate limits: a different database; proof-reset flushes ONLY this one.
PROOF_REDIS_URL='redis://localhost:6379/3'
# Local object storage default from playwright.config.ts (use port 19000 for compose MinIO).
S3_ENDPOINT='http://localhost:9000'
# Local bucket from playwright.config.ts; it must already exist.
S3_BUCKET='watchdog-bms-local'
# Local object-storage region from playwright.config.ts.
S3_REGION='local'
# Required by the local S3-compatible store.
S3_FORCE_PATH_STYLE='true'
# Local MinIO test access key, as in Playwright's S3 E2E mode.
S3_ACCESS_KEY_ID='watchdog'
# Local MinIO test secret, never production credentials.
S3_SECRET_ACCESS_KEY='watchdog_local_secret'
# AWS SDK credential discovery uses the same local keys.
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
# AWS SDK credential discovery uses the same local secret.
AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
# Local dev-auth secret from playwright.config.ts.
DEV_AUTH_SECRET='local-dev-secret-change-me'
# Local JWT secret from playwright.config.ts (not a cloud ARN).
WATCHDOG_JWT_SECRET_ARN='local-jwt-secret-change-me'
# Local JWT audience from playwright.config.ts; issuer is derived from each API port.
WATCHDOG_JWT_AUDIENCE='watchdog-bms-local'
# Local encryption key from playwright.config.ts, 64 hex characters.
CREDENTIAL_ENCRYPTION_KEY='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
# Local pseudonymization key from playwright.config.ts.
PDPA_PSEUDONYMIZATION_KEY='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
# Local previous pseudonymization key from playwright.config.ts.
PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
# AI gateway URL from playwright.config.ts; this toolkit does not start the gateway.
NEXT_PUBLIC_AI_GATEWAY_BASE_URL='http://127.0.0.1:3002/v1'
# Proof-only synthetic LINE web handoff, as required by e2e/HANDOFF.md.
PROOF_LINE_WEB_HANDOFF_ENABLED='true'
# Synthetic ID from e2e/HANDOFF.md; never a live LIFF application.
PROOF_LINE_LIFF_ID='1234567890-test'
