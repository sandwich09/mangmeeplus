#!/usr/bin/env bash
# Usage: realpg.sh <tag> [extra spec paths relative to apps/api...]
# Safety: explicit checked local real-database URL and shared heavy lock; never scrapes credentials.
# Records missing files and every rc in <tag>.realpg; runs every file and returns nonzero on failure.
set -u
source "$(dirname "$0")/common.sh"
lp_tag "${1:-}"; lp_heavy "$@"
FAILED=0
TAG="$1"; shift
OUT="$LP_RESULTS/$TAG.realpg"; : > "$OUT"
cd "$LOCAL_PROOF_ROOT/apps/api" || exit 1
export DATABASE_URL="$REALPG_DATABASE_URL"
FILES=(
  src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts
  src/modules/expenses/infrastructure/prisma-expense.repository.void.spec.ts
  src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts
  src/modules/expenses/infrastructure/substitute-expense-edit.pg.spec.ts
  src/modules/expenses/infrastructure/substitute-funding.pg.spec.ts
  src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts
  src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts
  "$@"
)
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "MISSING $f" >> "$OUT"; FAILED=1; continue; }
  LOG="$LP_LOGS/$TAG.realpg.$(basename "$f").log"
  pnpm exec node --import tsx --test "$f" > "$LOG" 2>&1; RC=$?
  bash "$LOCAL_PROOF_DIR/result.sh" "$f" "$RC" "$LOG" >> "$OUT"
  if [ "$RC" -ne 0 ]; then FAILED=1; fi
done
echo DONE >> "$OUT"

cat "$OUT"
exit "$FAILED"
