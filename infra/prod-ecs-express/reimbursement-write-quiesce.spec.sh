#!/usr/bin/env bash
set -euo pipefail

deploy='infra/prod-ecs-express/deploy.sh'

grep -Fq 'REIMBURSEMENT_WRITE_QUIESCE_INPUT="${REIMBURSEMENT_WRITE_QUIESCE:-false}"' "$deploy"
grep -Fq 'REIMBURSEMENT_WRITE_QUIESCE must be exactly true or false' "$deploy"
grep -Fq -- '--arg reimbursementWriteQuiesce "$REIMBURSEMENT_WRITE_QUIESCE_INPUT"' "$deploy"
grep -Fq '{name:"REIMBURSEMENT_WRITE_QUIESCE", value:$reimbursementWriteQuiesce}' "$deploy"

count="$(grep -Fc '{name:"REIMBURSEMENT_WRITE_QUIESCE", value:$reimbursementWriteQuiesce}' "$deploy")"
[ "$count" -eq 1 ] || {
  echo "expected the quiesce flag in api-web only, found $count" >&2
  exit 1
}

echo 'reimbursement write-quiesce deploy contract: PASS'
