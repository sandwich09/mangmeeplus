#!/usr/bin/env bash
# UAT Redis holds the actor-delegation replay store, the rate-limit counters, and — during the
# current acceptance cycle — owner-approved copies of the production LINE credentials, so it gets
# the same confidentiality controls as the RDS instance created beside it. `create-cache-cluster`
# has no at-rest encryption option at all, which is why the node must be a replication group.
#
# Availability controls (2 nodes, failover, 35-day snapshots) are deliberately absent: those are
# M-17's production requirements, enforced by infra/security/verify-production-security-baseline.sh.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
bootstrap="$repo_root/infra/uat/bootstrap-data.sh"

fail() { echo "ERROR: $1" >&2; exit 1; }

assert_present() {
  grep -Fq -- "$2" "$bootstrap" || fail "$1 (missing: $2)"
}

# --- the node itself -------------------------------------------------------------------------
assert_present 'the Redis node must be a replication group, the only shape that can be encrypted at rest' \
  'elasticache create-replication-group'
assert_present 'the encrypted group must not collide with the legacy standalone cache id' \
  'redis_id="${prefix}-redis-v2"'
assert_present 'the legacy id must remain explicit for migration detection' \
  'legacy_redis_id="${prefix}-redis"'
assert_present 'at-rest encryption must be requested' '--at-rest-encryption-enabled'
assert_present 'in-transit encryption must be requested' '--transit-encryption-enabled'
assert_present 'an auth token must be set' '--auth-token'
assert_present 'the noeviction parameter group must be attached at create time' \
  '--cache-parameter-group-name "$redis_param_group"'

grep -q 'elasticache create-cache-cluster' "$bootstrap" \
  && fail 'create-cache-cluster is back; a standalone node cannot be encrypted at rest'

# UAT pays for one node on purpose. A replica here buys availability, not confidentiality.
grep -Fq -- '--num-cache-clusters 1' "$bootstrap" \
  || fail 'expected a single-node UAT replication group'

# --- the connection string -------------------------------------------------------------------
# ioredis turns on TLS from the scheme and reads the password from userinfo, so encryption costs
# no application change — but only if the stored URL actually says rediss://.
assert_present 'the stored secret must use the TLS scheme and carry the auth token' \
  'rediss://:${redis_auth}@${redis_host}:6379'

grep -Eq 'create_secret "\$redis_secret" "redis://' "$bootstrap" \
  && fail 'the plaintext redis:// URL is back; clients would connect without TLS'

# --- the generated token, executed for real ----------------------------------------------------
# Extracted from the script rather than restated, so the two cannot drift apart.
token_expr="$(grep -m1 '^  redis_auth=' "$bootstrap")" \
  || fail 'could not find the auth-token generator'

for _ in $(seq 1 20); do
  eval "$token_expr"
  # ElastiCache: 16-128 printable characters, and none of / " @ or space.
  [ "${#redis_auth}" -ge 16 ] && [ "${#redis_auth}" -le 128 ] \
    || fail "auth token length ${#redis_auth} is outside the 16-128 ElastiCache accepts"
  case "$redis_auth" in
    */*|*'"'*|*@*|*' '*) fail "auth token contains a character ElastiCache rejects: $redis_auth" ;;
  esac
done

echo "redis-encryption.spec.sh: ok"
