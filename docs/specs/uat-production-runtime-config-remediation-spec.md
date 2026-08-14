# UAT / Production Runtime Configuration Remediation Spec

Status: **APPROVED FOR REPOSITORY IMPLEMENTATION — AWS execution requires the explicit operator gates below**

Date: 2026-08-15
Plan: `docs/plans/uat-production-runtime-config-remediation-plan.md`

## 1. Outcome

The repository must provide a reversible UAT Redis encryption migration, runtime alarms that consume
real metrics, and a truthful active configuration contract. The implementation must not open
Production, delete the legacy UAT Redis node, delete/recreate the Redis secret, or start audit-data
deletion.

## 2. Proven baseline

- Production Redis topology/hardening passes the M-17 checks. M-17 overall remains open for
  restore/re-erasure and secret rotation evidence.
- UAT Redis is a legacy standalone node without at-rest encryption, transit encryption or auth.
- UAT/Production Redis memory is below 5% and evictions are zero.
- Production Redis memory alarm uses `ReplicationGroupId`, receives zero datapoints and reports `OK`
  only because missing data is non-breaching.
- Production log-ingest alarm dimensions receive real datapoints. UAT has no corresponding alarms.
- `PERMISSION_CACHE_TTL_SECONDS` and the generic cache/idempotency/prefix variables have no runtime
  consumer.
- `AUDIT_RETENTION_DAYS=2555` was also an unenforced broad-spec claim, not an approved lifecycle.
  Audit deletion remains a legal/accounting decision and is outside repository mutation in this spec.

## 3. Scope

### Included

1. Fresh UAT bootstrap creates encrypted Redis under a non-conflicting canonical v2 id.
2. Existing UAT migrates through `prepare`, `cutover`, and `rollback` operations.
3. The existing `watchdog-bms/uat/redis-url` secret ARN is preserved.
4. Runtime alarms cover UAT log ingest, per-node Redis memory and environment-specific RDS capacity.
5. The invalid Production Redis alarm can be retired only after valid per-node alarms have datapoints.
6. Unused cache configuration is removed from active schemas/examples/specs.
7. The unenforced generic audit-retention value is removed from the active environment contract;
   no purge is added.

### Excluded

- Deleting the legacy UAT Redis node. That remains a manual post-soak owner action.
- Changing Production capacity or `maintenance_only` mode.
- Rebuilding/resizing Production Redis.
- Audit purge/archive implementation before the retention decision.
- AWS cost-allocation tag activation, budget mutation and Cost Anomaly creation; those require a
  platform-admin billing session.

## 4. UAT Redis migration contract

### 4.1 Resource identities

| Purpose | Identity |
| --- | --- |
| Legacy rollback node | standalone `watchdog-bms-uat-redis` |
| Encrypted candidate/canonical node | replication group `watchdog-bms-uat-redis-v2` |
| Stable runtime secret | `watchdog-bms/uat/redis-url` |
| Parameter group | `watchdog-bms-uat-redis7`, `maxmemory-policy=noeviction` |

The v2 group is one `cache.t4g.micro` node with Redis 7.1, at-rest encryption, transit encryption and
an auth token. UAT does not add a replica/failover/snapshot retention because this migration closes
confidentiality, not Production availability.

### 4.2 State machine

| State | `AWSCURRENT` | `AWSPENDING` | Runtime | Allowed next action |
| --- | --- | --- | --- | --- |
| Legacy | `redis://` legacy endpoint | absent | legacy | `prepare` |
| Prepared | `redis://` legacy endpoint | `rediss://` v2 endpoint | legacy, parked | `cutover` |
| Cut over | `rediss://` v2 endpoint | absent | v2 after operator reopens UAT | `rollback` or soak |
| Rolled back | `redis://` legacy endpoint | absent | legacy after operator reopens UAT | inspect/fix/re-prepare |

`prepare` stores the generated candidate token temporarily under a non-runtime staging label on the
same secret before creating ElastiCache. This makes a partially failed create resumable without
printing or losing the token. The runtime reads only `AWSCURRENT`.

### 4.3 Mandatory gates

Every mutating transition must:

1. verify AWS account `311414082667`, region `ap-southeast-1` and exact UAT resource names;
2. require a mode-specific confirmation environment value;
3. acquire the same no-overwrite SSM mutex used by UAT deploy and hold it until exit; a read-only
   lock check is insufficient because deploy and migration could both pass it before either mutates;
4. verify all three UAT Express services have exactly one active configuration with
   `minTaskCount=0` and `maxTaskCount=0`;
5. verify each service has zero `RUNNING` and zero `PENDING` tasks;
6. reject an unexpected secret scheme/endpoint/version-stage layout;
7. never echo a Redis URL, auth token or secret value;
8. perform a post-mutation read-back and fail if the requested state was not reached.

The script does not park or reopen UAT itself. Capacity changes remain the existing reviewed deploy
operation, so migration cannot silently broaden its authority.

### 4.4 Prepare

`prepare` must be idempotent and resumable:

- If v2 and a matching `AWSPENDING` already exist, verify and return success.
- If a temporary candidate-token stage exists, reuse it; do not generate a second token.
- If v2 exists without the pending URL or recoverable token, stop with a reconciliation error.
- Create v2 from the legacy subnet group/security group and the custom parameter group.
- Verify status, node count, encryption, auth, endpoint and `noeviction` before writing `AWSPENDING`.
- Remove the temporary token staging label only after the pending URL is durable.

### 4.5 Cutover

`cutover` moves `AWSCURRENT` from the legacy version to the matching `AWSPENDING` version. It must
retain the old version as `AWSPREVIOUS`, remove `AWSPENDING`, and verify the current URL is
`rediss://` with the exact v2 endpoint. No ECS task is started by this operation.

### 4.6 Rollback

`rollback` moves `AWSCURRENT` to the version currently labelled `AWSPREVIOUS` only when that version
is a `redis://` URL matching the still-available legacy endpoint. It verifies the restored scheme and
endpoint. Rollback must fail once the legacy node is unavailable; deleting the legacy node is outside
the script.

## 5. Runtime alarm contract

One idempotent script supports `uat` and `production`.

| Alarm | UAT | Production |
| --- | ---: | ---: |
| Per app log group `IncomingBytes`, Sum/1h | 64 MiB | 512 MiB |
| Per Redis node `DatabaseMemoryUsagePercentage`, Max/5m ×2 | 75% | 75% |
| RDS `FreeStorageSpace`, Min/5m ×2 | 4 GB | 4 GB |
| RDS `FreeableMemory`, Min/5m ×3 | 64 MB | 200 MB |
| RDS `DatabaseConnections`, Max/5m ×2 | — | 150 |
| RDS `CPUCreditBalance`, Min/5m ×2 | — | 50 |

Redis alarms must use both `CacheClusterId` and `CacheNodeId`; `ReplicationGroupId` is forbidden for
this metric. The script discovers node dimensions from `DescribeCacheClusters` and must fail on zero
nodes. Alarm names include the environment and node suffix.

Verification must compare namespace, metric, statistic, period, threshold, dimensions,
missing-data policy and the exact SNS action. It must then call `GetMetricStatistics` and require at
least one datapoint for every alarm dimension. `StateValue=OK` alone is never acceptance evidence.

The invalid `watchdog-bms-prod-redis-memory-high` alarm may be deleted only through an explicit
Production-only retire mode after all valid Production per-node alarms pass verification.

## 6. Active cache configuration contract

- Permission resolution remains direct database resolution; no permission cache is introduced.
- Remove `PERMISSION_CACHE_TTL_SECONDS` from the config schema, `.env.example`, local compose and
  authorization config tables.
- Remove generic `CACHE_TTL_SECONDS`, `IDEMPOTENCY_TTL_SECONDS`, `RATE_LIMIT_REDIS_PREFIX` and
  `QUEUE_REDIS_PREFIX` requirements from the platform environment spec.
- Keep use-case-specific controls in code: rate-limit window/TTL, LINE ledger TTL/max length and
  BullMQ completed/failed/DLQ counts.

The same truthfulness rule applies to audit retention: no generic active environment value is
declared until an approved category-specific policy has runtime enforcement. This change does not
delete, archive or mutate any audit row.

## 7. IAM boundary

The Redis migration operator needs only read access to the three UAT service states/tasks, read/create
access for the exact UAT v2 ElastiCache resources, parameter-group read, and versioned read/write on
the exact UAT Redis secret. It receives no ElastiCache delete permission and no Production resource.
The create grant enforces encryption/auth, node type, engine/parameter group and mandatory cost tags
through ElastiCache request condition keys. The UAT deploy role may delete only the exact mutex
parameter in addition to its existing parameter reads/writes.

The monitoring operator needs CloudWatch put/describe/get-statistics, SNS subscription read and
ElastiCache cache-cluster discovery in `ap-southeast-1`. `DeleteAlarms` is used only for the exact
legacy Production alarm after successful verification.

## 8. Failure and impact rules

| Failure | Required behavior |
| --- | --- |
| Service/task not fully parked | no Redis/secret mutation |
| Deploy or migration already owns the mutex | second operation fails before service/Redis mutation |
| Process is killed and leaves a mutex | fail closed; an operator proves no owner is active before deleting only the mutex parameter |
| Candidate create fails after token staging | keep staged token so `prepare` can resume |
| Candidate validation fails | keep legacy current; no cutover |
| Secret stage drift/multiple current versions | stop; no guessed repair |
| Cutover succeeds but app smoke fails | park UAT, run rollback, then reopen legacy |
| Alarm has zero datapoints | verification fails even if state is `OK` |
| SNS subscription pending/missing | verification fails |
| Audit policy undecided | no audit deletion code/config added |

## 9. Acceptance criteria

- Fresh-bootstrap static test proves v2/encryption/auth/noeviction/single-node shape.
- Migration shell spec covers prepare, interrupted prepare resume, cutover, rollback, non-zero
  capacity/task rejection, mutual exclusion, secret-stage drift and wrong-account rejection without
  AWS access.
- Alarm shell spec covers both environments, exact node dimensions, zero-datapoint rejection and
  guarded retirement of the invalid alarm.
- Config tests/typecheck pass after removal of the unused variable.
- No secret value appears in test logs or script output.
- `git diff --check` and stale-instruction/config searches pass.
