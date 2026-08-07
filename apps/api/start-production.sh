#!/bin/sh
set -eu

./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
./node_modules/.bin/tsx prisma/sync-permissions.ts
# --verify-specialist-closed: `set -eu` aborts the boot if any SPECIALIST_LEGAL route is OPEN (v5.1).
./node_modules/.bin/tsx prisma/sync-feature-launch-gates.ts --verify-specialist-closed
./node_modules/.bin/tsx prisma/sync-thai-address-master.ts
if [ "${APP_ENV:-}" = "local" ]; then
  ./node_modules/.bin/tsx prisma/seed.ts
fi
# F2/CC7: legacy entitlement normalization PREFLIGHT. `--dry-run` is hard-wired here, not left to
# F2_APPLY: booting an app task must never write entitlements, and an F2_APPLY that leaked onto a
# service task definition must not be able to arm the writer. It plans, prints the artifact and
# always exits 0. The one-time APPLY belongs to the release task (infra/prod-ecs-express/run-release-task.sh).
# UAT r7 P0-4: `--allow-exceptions` keeps that "always exits 0" promise. A PLAN with dependency
# exceptions is now NOT approval-ready and fails by default — correct for the approval job in
# f2-normalize.yml, fatal here, where `set -eu` would turn one unresolved tenant into a boot loop.
# The artifact still carries approvalReady=false, which is what actually stops an APPLY.
./node_modules/.bin/tsx prisma/normalize-entitlements.ts --dry-run --allow-exceptions
if [ -n "${SEED_SYSTEM_ADMIN_PASSWORD:-}" ]; then
  ./node_modules/.bin/tsx prisma/reset-system-admin-password.ts
fi
exec node dist/apps/api/src/main.js
