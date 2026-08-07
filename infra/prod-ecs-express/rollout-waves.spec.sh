#!/usr/bin/env bash
# Spec for infra/prod-ecs-express/lib-rollout-waves.sh (spec §4.3 / acceptance A5).
# The deploy_* functions are stubs: no AWS, no rollout, plain bash.
#   bash infra/prod-ecs-express/rollout-waves.spec.sh
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
# shellcheck source=infra/prod-ecs-express/lib-rollout-waves.sh
. "$repo_root/infra/prod-ecs-express/lib-rollout-waves.sh"

work="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-bms-wave-spec.XXXXXX")"
trap 'rm -rf "$work"' EXIT

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

# Service name -> function name mapping is part of the contract (api-web -> deploy_api_web).
deploy_slow_a() { sleep 3; echo "slow-a rollout complete"; }
deploy_slow_b() { sleep 3; echo "slow-b rollout complete"; }
deploy_canary_fail() { echo "canary rolled back" >&2; return 1; }
deploy_slow_ok() { sleep 3; echo "slow-ok rollout complete"; : > "$work/slow-ok.done"; }
deploy_order_slow() { sleep 1; printf 'slow\n' >> "$work/order"; }
deploy_order_fast() { printf 'fast\n' >> "$work/order"; }

# All services succeed: exit 0, concurrent, every line carries its service prefix.
started="$SECONDS"
output="$(run_rollout_wave slow-a slow-b 2>&1)" || fail "all-success wave returned non-zero: $output"
elapsed="$((SECONDS - started))"
grep -Fqx '[wave:slow-a] slow-a rollout complete' <<<"$output" || fail "missing [wave:slow-a] prefix: $output"
grep -Fqx '[wave:slow-b] slow-b rollout complete' <<<"$output" || fail "missing [wave:slow-b] prefix: $output"
test "$elapsed" -lt 5 || fail "wave ran sequentially (${elapsed}s for two 3s rollouts)"

# One service fails: non-zero exit, the failure is named, and the slow sibling is
# never killed — it runs to completion and its output still reaches the log.
if output="$(run_rollout_wave canary-fail slow-ok 2>&1)"; then
  fail "failing wave returned zero: $output"
fi
grep -Fq '[wave] FAILED: canary-fail' <<<"$output" || fail "failed service not named: $output"
grep -Fqx '[wave:canary-fail] canary rolled back' <<<"$output" || fail "job stderr not prefixed: $output"
test -f "$work/slow-ok.done" || fail "sibling did not run to completion"
grep -Fqx '[wave:slow-ok] slow-ok rollout complete' <<<"$output" || fail "sibling output missing: $output"

# Waves are ordered: the runner blocks until the whole wave is terminal, so a slow
# first wave still finishes before a fast second wave starts.
run_rollout_wave order-slow >/dev/null
run_rollout_wave order-fast >/dev/null
test "$(tr '\n' ' ' < "$work/order")" = "slow fast " || fail "waves ran out of declared order: $(tr '\n' ' ' < "$work/order")"

echo "rollout wave runner: pass"
