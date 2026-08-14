# Agent Memory: UAT / Production runtime config remediation

Status: PARTIAL LIVE — Production alarms installed/verified; UAT Redis migration blocked at IAM preflight
Owner: thawatchai
Scope: Redis/memory, BullMQ/cache configuration, CloudWatch logs, RDS observability,
database audit retention and AWS cost controls across UAT/Production/shared infrastructure.

Decisions:
- Production Redis topology/hardening is not an open sub-finding. CloudTrail, successful signed readiness run
  `31789220329`, runtime baseline SHA-256
  `17148172d4157d19333684c3b84d362c3de53e4de053c76e4f4e62bf8798f8f7` and live nodes agree on
  two encrypted/authenticated nodes, automatic failover and 35-day snapshots. M-17 overall remains
  open for restore/RTO/RPO, post-restore re-erasure and secret rotation/revocation evidence.
- UAT Redis remains an open confidentiality finding. Replace it blue/green, preserve the existing
  secret ARN and keep the old node until soak passes. The previous delete-node/delete-secret-first
  procedure is superseded.
- Redis memory is healthy now and eviction is zero. The August cost incident came from unbounded
  BullMQ history plus huge fatal error serialization; current queue retention/log bounding stopped it.
  Production's Redis memory alarm is not proof of monitoring: it uses `ReplicationGroupId`, has zero
  datapoints and is `OK` only because missing data is treated as non-breaching. Replace it per node.
- Production `maintenance_only` is intentional and outside this remediation.
- Do not implement audit deletion from the unapproved `2555`-day broad-spec default. Close category,
  trigger, legal-hold and end-action decisions first, then add enforcement.
- Remove unused permission/generic cache config instead of building a speculative permission cache.
- Shared alert delivery is acceptable for sanitized operational alarms when alarm names carry the
  environment; data-plane stores remain isolated.
- Existing AWS Budget should be recalibrated, not duplicated. Cost Anomaly Detection remains unknown
  until a platform-admin read-back is available.
- UAT Redis migration and service deploy use one no-overwrite SSM mutex. A read-only lock check was
  found to have a TOCTOU race and was replaced before handoff.
- The migration operator policy enforces v2 identity, encryption/auth, node class, engine/parameter
  group and required cost tags, and intentionally has no cache deletion action.
- The unenforced `AUDIT_RETENTION_DAYS=2555` broad-spec claim was removed. Audit rows were not
  changed; category/hold/end-action approval remains open.
- Production runtime alarms were installed from the reviewed local script only after exact account,
  region, live node, confirmed subscription and historical `PutMetricAlarm` authority checks passed.
  The invalid replication-group alarm remains because current non-root authority cannot prove
  `DeleteAlarms`; no delete probe was made.
- UAT was deliberately left running at 1/2. Parking it before Redis operator authority exists would
  create avoidable downtime with no safe path to complete prepare/cutover.

Open questions:
- Privacy/Legal + Accounting approval for AuditLog/AiUsageEvent retention classes and legal holds.
- Platform admin must prove current Cost Anomaly Detection state and activate cost-allocation tags.
- Owner should confirm the recommended $350 monthly baseline after one clean, incident-free billing month.

Artifacts:
- `docs/plans/uat-production-runtime-config-remediation-plan.md`
- `docs/specs/uat-production-runtime-config-remediation-spec.md`
- `docs/runbooks/cloud-environment-operations.md`
- `infra/uat/README.md`
- `infra/uat/redis-blue-green.sh`
- `infra/uat/redis-blue-green-operator-policy.template.json`
- `infra/monitoring/runtime-alarms.sh`
- `docs/security-evidence/data-retention-deletion-register-v1.md`
- `docs/agent-memory/uat-redis-encryption.md`

Verification:
- Live AWS read-back 2026-08-15, account `311414082667`, region `ap-southeast-1`.
- UAT Redis: standalone t4g.micro, Redis 7.1, encryption/transit/auth false; Production: two available
  t4g.micro nodes with encryption/transit/auth true.
- Redis latest memory: UAT ~18.3 MB/4.54%; Prod ~17.3 MB/4.30% and ~17.1 MB/4.24%; evictions zero.
- Production Redis alarm `watchdog-bms-prod-redis-memory-high`: zero datapoints for its
  `ReplicationGroupId` dimension; state reason explicitly says two missing datapoints were treated
  as non-breaching. Live metrics use `CacheClusterId`/`CacheNodeId`.
- CloudWatch raw ingest Aug 1–14: UAT workers 280,443,735,084 bytes; Aug 6 alone
  214,075,786,774 bytes; latest 24 hours ~2,984,094 bytes.
- Production `IncomingBytes` alarm dimensions are valid: Aug 13–15 metric queries returned
  5/42/42 hourly datapoints for AI/API/workers respectively; current missing periods reflect quiet
  `maintenance_only` services, unlike the invalid Redis replication-group dimension.
- UAT DB read-only aggregate: AuditLog 3,899 rows/3,432,448 bytes, oldest 2026-07-21, newest
  2026-08-14; database 71,644,863 bytes.
- RDS latest: UAT/Prod free storage ~18.25 GB; free memory ~151 MB/~758 MB; no storage/memory alarm.
- Budget `WatchDog-BMS Monthly Cost Budget`: limit $100, actual $387.397, forecast $787.792,
  three active notification conditions and one email subscriber each.
- Cost Explorer Environment grouping attributed all $387.397 to an empty Environment value.
- Workstation IAM denied ElastiCache replication-group/parameter reads, resource tags, cost-allocation
  tags and Cost Anomaly reads. No permission expansion was attempted.
- AWS preflight 2026-08-15 used non-root `arn:aws:iam::311414082667:user/watchdog-bedrock-dev` only.
  All three UAT Express services were ACTIVE at exact 1/2 with one running task and no pending task;
  the migration mutex parameter was absent and the existing Redis secret had one `AWSCURRENT`
  version. No secret value was read.
- Production alarm install/verify passed live at 2026-08-15 01:10 UTC+7 using script SHA-256
  `12a21225a68a133b953490a7fd66764031ff0190e14333b265006063bb126157`: 3 log-ingest, 2 per-node
  Redis memory and 4 RDS alarms. Exact contract read-back showed the expected dimensions,
  thresholds, `notBreaching`, one SNS action, confirmed subscription and real datapoints for all 9.
- The invalid `watchdog-bms-prod-redis-memory-high` remains. CloudTrail event
  `644160fa-cd71-4e6b-8027-dcad13fc3b12` proves the latest workstation monitoring bootstrap policy
  allowed only `PutMetricAlarm`/`DescribeAlarms`, not `DeleteAlarms`; no successful historical delete
  existed and `SimulatePrincipalPolicy` was denied. Retirement was therefore not attempted.
- UAT Redis migration role `watchdog-bms-uat-redis-migration-operator` does not exist. Current
  workstation calls to `DescribeReplicationGroups`, `DescribeCacheParameters`, deploy-policy exact
  read-back and policy simulation were denied. Historical write events do not authorize self-created
  authority, so no role, trust, policy, service capacity, Redis or secret mutation was attempted.
- `bash infra/uat/redis-encryption.spec.sh` — pass.
- `bash infra/uat/redis-blue-green.spec.sh` — pass, including mutual exclusion and interrupted resume.
- `bash infra/monitoring/runtime-alarms.spec.sh` — pass for UAT/Production, zero datapoints and guarded retirement.
- Production `CPUCreditBalance` read-back on 2026-08-15 returned 286 datapoints in 24 hours; keeping
  the existing CPU-credit alarm contract is evidence-based rather than copied blindly.
- `pnpm --filter @watchdog-bms/config test` — pass 118/118.
- Access-control resolver focused test through the API package runner — pass.
- Express capacity/release-safety/UAT-fast-rollout/production-serving-mode shell specs — pass after
  the shared mutex was added.
- `tsx --test apps/workers/src/common/queue.spec.ts apps/workers/src/common/log.spec.ts` — pass 17/17.
- `git diff --check`, shell syntax/JSON parsing and stale active cache/audit config searches — pass
  after the final documentation update.

Next:
1. Owner/provider supplies a temporary non-root platform-admin session. Exact-read then apply the
   reviewed UAT deploy mutex delta and dedicated Redis migration operator role/policy; do not use root.
2. Re-run read-only preflight, park UAT, execute prepare/cutover, reopen, install/verify UAT alarms,
   run acceptance and retain the legacy node through soak.
3. Give the monitoring operator exact `DeleteAlarms`, re-run Production verify, retire only the
   zero-datapoint legacy alarm, and confirm the SNS canary at the mailbox.
4. Obtain the audit retention decision and platform-admin cost-control read-back.
