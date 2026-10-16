#!/usr/bin/env bash
# Usage: verify.sh <tag> — whole local verification, summary in results/<tag>.summary.
# Safety: checked real-database URL and shared heavy lock; runs every check and returns failure if any failed.
source "$(dirname "$0")/common.sh"
lp_tag "${1:-}"; lp_heavy "$@"
export DATABASE_URL="$REALPG_DATABASE_URL"
FAILED=0
TAG="$1"; OUT="$LP_RESULTS/$TAG.summary"; : > "$OUT"
echo "HEAD $(git rev-parse --short HEAD) tree $(git rev-parse --short 'HEAD^{tree}') $(date +%H:%M)" >> "$OUT"
step() {
  local name="$1"; shift
  local log="$LP_LOGS/$TAG-$name.log" rc
  ( "$@" ) > "$log" 2>&1; rc=$?
  bash "$LOCAL_PROOF_DIR/result.sh" "$name" "$rc" "$log" >> "$OUT"
  if [ "$rc" -ne 0 ]; then FAILED=1; fi
}
step contracts-build corepack pnpm --filter @watchdog-bms/contracts build
step prisma-validate corepack pnpm --filter @watchdog-bms/api prisma:validate
step prisma-generate corepack pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma
step migration-review corepack pnpm --filter @watchdog-bms/api migration:review
step pins node infra/security/sync-production-maintenance-release-pins.mjs --check
step di-metadata node apps/api/scripts/check-di-metadata.mjs
step tsc bash "$LOCAL_PROOF_DIR/tsc.sh" both
step typecheck-others corepack pnpm --filter '!@watchdog-bms/api' --filter '!@watchdog-bms/web' -r --if-present typecheck
step contracts-test corepack pnpm --filter @watchdog-bms/contracts test
step web-test corepack pnpm --filter @watchdog-bms/web test
step loading-audit node scripts/qa/action-loading-coverage.mjs --check
# The registered API command uses dot output (no counts or failure names). Keep its file list,
# only select TAP for the gate; never edit package.json or infer tests from dot characters.
api_test() {
  node <<'JS'
const { spawnSync } = require('node:child_process');
const command = require('./apps/api/package.json').scripts.test.replace('--test-reporter=dot', '--test-reporter=tap');
// No database is handed to the suite, as in `pnpm --filter @watchdog-bms/api test`: given one, its
// skip-unless-reachable database specs all run at once on the same rows and race (first seen:
// execution-attempt.service.race.spec.ts lost its company to another file). realpg.sh runs them one file at a time.
const { DATABASE_URL: _none, ...env } = process.env;
const result = spawnSync('corepack', ['pnpm', '--filter', '@watchdog-bms/api', 'exec', 'sh', '-c', command], { stdio: 'inherit', env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
JS
}
step api-test api_test
step harness corepack pnpm test:harness
step whole-chain node scripts/run-line-ai-whole-chain-acceptance.mjs
step m01 corepack pnpm --filter @watchdog-bms/api test:m01
step p1 corepack pnpm --filter @watchdog-bms/api test:p1
step ai-gateway-test corepack pnpm --filter @watchdog-bms/ai-gateway test
step pins-validator-spec bash infra/security/validate-production-maintenance-release.spec.sh
step pins-sync-spec bash infra/security/sync-production-maintenance-release-pins.spec.sh
echo "DONE $(date +%H:%M)" >> "$OUT"

cat "$OUT"
exit "$FAILED"
