# Agent Memory: UAT Redis encryption

Status: `bootstrap-data.sh` creates an encrypted v2 node and the reversible blue/green helper/spec are
implemented. The **live UAT node is still unencrypted** because no AWS mutation was run in this
implementation turn. The destructive migration originally recorded here is superseded by the
blue/green plan in `docs/plans/uat-production-runtime-config-remediation-plan.md`.
Production Redis topology was rebuilt and proven against M-17 on 2026-08-14; M-17 overall remains
open for restore/re-erasure and secret rotation evidence.

Owner: Opus 5, 2026-08-08. Companion: `aws-cost-spike-2026-08.md` (why prod Redis was deleted).

Scope: `infra/uat/bootstrap-data.sh` created the Redis node with no encryption flags at all, while
creating the RDS instance beside it with `--storage-encrypted`. Verified live 2026-08-07:
`AtRestEncryptionEnabled`, `TransitEncryptionEnabled`, `AuthTokenEnabled` all false, secret holds a
`redis://` URL.

## The decision was already in the repo

This was not an open question. **M-17** in `docs/security-remediation-checklist-merged-2026-07-17.md`
covers exactly this and is still open at its "Live closure" checkbox, due "ก่อน production release
ถัดไป". Its repository-controls half was completed 2026-07-28, which is
`infra/security/verify-production-security-baseline.sh` — a read-only verifier that fails closed
unless production Redis reports:

```
atRestEncryptionEnabled == true     transitEncryptionEnabled == true
authTokenEnabled == true            automaticFailover == "enabled"
nodeCount >= 2                      snapshotRetentionDays >= 35
```

It reads `describe-replication-groups`, so production cannot be a standalone node under any
configuration. The cluster deleted on 2026-08-07 was standalone with `SnapshotRetentionLimit: 0` and
would have failed this baseline; rebuilding it is the natural moment to close M-17.

## Decisions

- **UAT gets the confidentiality controls, not the availability ones.** At-rest, in-transit and auth
  token yes; two nodes, failover and 35-day snapshots no. Those three are M-17's production
  requirements and would roughly double UAT's Redis cost while buying no confidentiality. UAT earns
  the confidentiality half because it holds the actor-delegation replay store and the rate-limit
  counters, and its secret namespace carries owner-approved copies of production LINE credentials.
- **The node had to become a replication group.** Not a preference — `create-cache-cluster` exposes
  `AuthToken`, `TransitEncryptionEnabled` and `SnapshotRetentionLimit` but **no**
  `AtRestEncryptionEnabled`. Only `create-replication-group` has it. A single-node replication group
  (`--num-cache-clusters 1`, failover off) is the cheapest encrypted shape.
- **No application code changed.** `REDIS_URL` is `z.string()` with no scheme constraint, and
  ioredis enables TLS from the `rediss://` scheme and reads the password from userinfo. That covers
  BullMQ (`connection: { url }`) and the API rate limiter (`new Redis(url, …)`) without touching
  either.
- **The parameter group moved into the bootstrap** while the creation call was being rewritten, so a
  fresh node never passes through `volatile-lru` — the policy that caused the 2026-08-05 outage.

## Migration facts worth not rediscovering

- `delete-secret` without `--force-delete-without-recovery` holds the name for 7–30 days, and
  `bootstrap-data.sh` refuses to run when the secret exists without a node. That combination bricks
  the rerun.
- Recreating the secret would yield a **new ARN**, but that is no longer the chosen migration.
  Blue/green writes a new value version to the existing secret and retains the old version for rollback.
- UAT was live at capacity 1/2 on the 2026-08-15 read-back. It must be parked and verified at zero
  immediately before cutover so old/new BullMQ consumers can never overlap.
- Migration and UAT deploy now acquire the same no-overwrite SSM mutex. The original read-only lock
  check had a time-of-check/time-of-use race and was rejected during implementation review.

## Verification

- `infra/uat/redis-encryption.spec.sh`: passes. Fails if `create-cache-cluster` returns, if any of
  the three encryption flags is dropped, if the secret reverts to `redis://`, or if the generated
  auth token leaves 16–128 characters or contains `/`, `"`, `@` or a space. The token generator is
  extracted from the script and executed 20 times rather than restated, so the two cannot drift.
- Mutation-checked both ways: reverting the URL to `redis://` and deleting
  `--at-rest-encryption-enabled` each fail the spec.
- `bash -n` clean; the other two `infra/uat/*.spec.sh` still pass.
- `infra/uat/redis-blue-green.spec.sh` covers prepare/cutover/rollback, interrupted-create resume,
  non-zero capacity/tasks, wrong account, shared-mutex exclusion, no secret output and no cache-delete
  permission.
- **Not verified: nothing has been run against AWS.** The encrypted node has never been created, so
  the create call, the waiter and the `rediss://` connection are unproven in practice.

## Next

1. Apply the reviewed operator/deploy-role policies, then schedule the explicit migration window.
2. Park UAT, create the encrypted v2 group, preserve the secret ARN, smoke/soak, then delete the old
   node only after owner sign-off.
3. Keep Production Redis on the dedicated readiness path. Successful readiness run `31789220329`
   and runtime SHA-256 `17148172d4157d19333684c3b84d362c3de53e4de053c76e4f4e62bf8798f8f7`
   prove encryption/auth/failover/two nodes/35-day snapshots for source `748f1fa…`.
