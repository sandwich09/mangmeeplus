#!/usr/bin/env bash
# Express capacity is configurable so UAT can stay parked at zero between test cycles: every update
# payload used to hardcode 1/2, so the next deploy silently restarted UAT and its Fargate bill.
# Production stays pinned at 1/2 because infra/security/collect-production-a5-current-health.sh
# asserts that exact shape against the live service when it collects signed evidence.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
deploy="$repo_root/infra/prod-ecs-express/deploy.sh"

# Every case below must be rejected inside the capacity block, which runs before the script reaches
# any AWS or docker call. A case that is accepted would start a real deploy, so only rejections are
# executed here; the accepted path is covered by the payload assertions further down.
assert_rejected() {
  local label="$1" expected="$2" deploy_env="$3" min="$4" max="$5"
  local out code=0
  out="$(DEPLOY_ENV="$deploy_env" ECS_EXPRESS_MIN_TASKS="$min" ECS_EXPRESS_MAX_TASKS="$max" \
    bash "$deploy" all 2>&1)" || code=$?
  [ "$code" -eq 1 ] || { echo "ERROR: $label exited $code, expected 1" >&2; exit 1; }
  grep -Fq "$expected" <<< "$out" || {
    echo "ERROR: $label did not report \"$expected\"; got: $(head -3 <<< "$out")" >&2
    exit 1
  }
}

assert_rejected 'non-integer minimum' \
  'must be non-negative integers' uat abc 2
# An empty value is not tested: `${VAR:-default}` resolves it to the default, which is correct.
assert_rejected 'negative maximum' \
  'must be non-negative integers' uat 1 -1
assert_rejected 'maximum below minimum' \
  'is below ECS_EXPRESS_MIN_TASKS' uat 3 1
# The expensive mistake this guard prevents: parking production at zero would also silently
# invalidate the A5 health evidence, which compares against the literal 1/2 shape.
assert_rejected 'production parked at zero' \
  'production capacity is pinned to 1/2' production 0 0
assert_rejected 'production widened' \
  'production capacity is pinned to 1/2' production 1 4

# Both payload builders (CREATE and UPDATE) must read the resolved values. A builder that keeps the
# literal is the exact regression this file exists to catch.
literals="$(grep -c 'minTaskCount: 1, maxTaskCount: 2' "$deploy" || true)"
[ "$literals" -eq 0 ] || {
  echo "ERROR: $literals payload builder(s) still hardcode minTaskCount: 1, maxTaskCount: 2" >&2
  exit 1
}

wired="$(grep -c -- '--argjson minTaskCount "\$EXPRESS_MIN_TASKS"' "$deploy" || true)"
[ "$wired" -eq 2 ] || {
  echo "ERROR: expected both CREATE and UPDATE payloads to pass minTaskCount, found $wired" >&2
  exit 1
}

echo "express-capacity.spec.sh: ok"
