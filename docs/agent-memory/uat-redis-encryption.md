# Agent Memory: UAT Redis encryption

Status: `bootstrap-data.sh` now creates an encrypted node and is guarded by a spec. The **live UAT
node is still unencrypted** — encryption cannot be toggled, so it has to be replaced; the migration
is written up in `infra/uat/README.md` and not yet run. Production Redis does not exist and must be
rebuilt to the M-17 shape before any production deploy.

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
- Recreating the secret yields a **new ARN**. `deploy.sh` resolves the name to an ARN at deploy time
  and embeds it in `valueFrom`, so the task definitions must be rewritten — bringing UAT back has to
  be a deploy, not just a capacity change.
- UAT is parked at zero capacity right now, which makes this the cheapest window to replace the node.
  Its contents are disposable: BullMQ jobs and rate-limit counters, no durable state.

## Verification

- `infra/uat/redis-encryption.spec.sh`: passes. Fails if `create-cache-cluster` returns, if any of
  the three encryption flags is dropped, if the secret reverts to `redis://`, or if the generated
  auth token leaves 16–128 characters or contains `/`, `"`, `@` or a space. The token generator is
  extracted from the script and executed 20 times rather than restated, so the two cannot drift.
- Mutation-checked both ways: reverting the URL to `redis://` and deleting
  `--at-rest-encryption-enabled` each fail the spec.
- `bash -n` clean; the other two `infra/uat/*.spec.sh` still pass.
- **Not verified: nothing has been run against AWS.** The encrypted node has never been created, so
  the create call, the waiter and the `rediss://` connection are unproven in practice.

## Next

1. Run the UAT migration in `infra/uat/README.md` while capacity is at zero, then bring UAT back
   with a deploy and confirm workers connect over TLS.
2. Rebuild production Redis to the full M-17 shape and close the checklist item — that needs an
   owner decision on the ~2x cost of the second node, which is a production availability
   requirement rather than something to decide silently here.
3. M-17's other halves are untouched by this work: RDS Multi-AZ, deletion protection, 35-day backup
   retention, and secret rotation for 7/7 production secrets.
