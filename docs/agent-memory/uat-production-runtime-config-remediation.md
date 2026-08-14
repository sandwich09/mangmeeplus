# Agent Memory: UAT / Production runtime config remediation

Status: PARTIAL LIVE — Production alarms and mailbox delivery verified; controller PR CI-green and awaiting independent approval; remaining cloud mutations await non-root platform-admin
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
- UAT deploy workflows load the deploy controller and policy verification from `main`, while candidate
  application images come from `develop`. Therefore the five reviewed controller blobs must land on
  `main` before the live deploy-role mutex delta is applied; promoting the rest of `develop` is out of scope.
- An exact deploy policy delta was technically proven writable, then restored to the
  pre-mutation/controller hash as soon as this integration gate was identified; no UAT workflow or
  resource was mutated.
- Do not bypass the independent-review intent on `main`. Branch protection enforces admins, locks the
  branch and requires approval from someone other than the last pusher.
- Owner confirmed the sanitized Production SNS canary reached the real inbox on 2026-08-15. Do not
  retain the supplied screenshot in the repository because it exposes the mailbox and unsubscribe
  endpoint; the screenshot hash, subject and SNS MessageId are sufficient for this operational gate.
- Owner authorized exact retirement of the invalid alarm and Phase 6 cost-control work. Authority is
  still fail-closed: the active non-root principal cannot grant itself IAM access, and an expired root
  profile is not a substitute for the required temporary non-root platform-admin session.

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
  tags and Cost Anomaly reads. No lasting permission expansion was left in place.
- AWS preflight 2026-08-15 used non-root `arn:aws:iam::311414082667:user/watchdog-bedrock-dev` only.
  All three UAT Express services were ACTIVE at exact 1/2 with one running task and no pending task;
  the migration mutex parameter was absent and the existing Redis secret had one `AWSCURRENT`
  version. No secret value was read.
- Owner-supplied inbox evidence on 2026-08-15 showed subject `[TEST] production runtime alarm pipeline`
  and the expected sanitized canary body. Screenshot SHA-256 is
  `f524646240c97510a4a500e1bcfecedf064e2549f620081dbd586605d09451bb`; matching SNS publish
  MessageId is `198e9125-6a84-5124-866b-f3dc35bfe21e`. The screenshot itself was not copied because
  it contains mailbox and unsubscribe endpoint data. Phase 3 SNS end-to-end delivery is VERIFIED.
- Follow-up authority preflight on 2026-08-15 found only `watchdog-bedrock-dev` usable. Read-only IAM
  inventory and `SimulatePrincipalPolicy` were denied, while profile `thawatchai` was expired. No IAM,
  alarm, billing, anomaly-monitor or resource-tag mutation was attempted.
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
- CloudTrail event `b8e7eaf7-c0fc-4ea6-a347-4a658a094e31` proved the pre-mutation deploy policy
  canonical SHA-256 `7ce3f108a770bee3e636e0ede5a75993744c2f955715c952886a509e7cc84e35`
  matched both `origin/develop` and `origin/main`. The reviewed mutex-only delta
  `d7b1eb3f736a46df781457e7034da360af065f6da1cbe4170cf84f879b1a6638` was applied successfully,
  but restored immediately to the controller hash after proving the UAT workflow is sourced from
  `main`. CloudTrail records exact delta event `36c06109-c7db-4d3b-959b-ae881e9d4aa8` followed by
  exact restore event `1b47a679-a887-4977-bf8b-9525a696bae3`. This leaves the live control plane
  consistent while PR/controller promotion is pending.
- `bash infra/uat/redis-encryption.spec.sh` — pass.
- `bash infra/uat/redis-blue-green.spec.sh` — pass, including mutual exclusion and interrupted resume.
- `bash infra/monitoring/runtime-alarms.spec.sh` — pass for UAT/Production, zero datapoints and guarded retirement.
- Production `CPUCreditBalance` read-back on 2026-08-15 returned 286 datapoints in 24 hours; keeping
  the existing CPU-credit alarm contract is evidence-based rather than copied blindly.
- `pnpm --filter @watchdog-bms/config test` — pass 118/118.
- Access-control resolver focused test through the API package runner — pass.
- Express capacity/release-safety/UAT-fast-rollout/production-serving-mode shell specs — pass after
  the shared mutex was added.
- Clean-branch verification from `origin/develop` caught the expected production maintenance
  release hash drift caused by the `deploy.sh` mutex change. The repository pin sync updated only
  the deploy hash and validator hash; `production-image-security.spec.sh` then passed end to end.
- `tsx --test apps/workers/src/common/queue.spec.ts apps/workers/src/common/log.spec.ts` — pass 17/17.
- `git diff --check`, shell syntax/JSON parsing and stale active cache/audit config searches — pass
  after the final documentation update.
- Runtime remediation PR `#84` merged to `develop` as
  `d88dadf84bf7a32d7848bd7d19f6334cd8ae6cb9` after all required CI passed.
- Controller-only PR `#85` targets `main` from head
  `ceefe0506e7f2d4f4d35835229505c3965551002`; its five file blobs match the reviewed copies on
  `develop`. Local full production image/security gate passed, and GitHub CI run `31829862844`
  passed Resolve Source, Typecheck and Test (12m16s), Security Audit, Secret Scan, Production Config
  Validation and Migration Review. Image/publish jobs skipped by the controller-only workflow path.
- GitHub rejected `gh pr merge 85 --squash --admin` with `New changes require approval from someone
  other than the last pusher`. Live protection read-back confirms `enforce_admins=true`,
  `lock_branch=true`, one required approval, stale-review dismissal and
  `require_last_push_approval=true`; protection was not changed and no alternate identity was used to
  self-approve.

Next:
1. An independent collaborator approves PR `#85`; then merge it, fetch `origin/main` and prove the
   five controller blobs before any UAT IAM mutation.
2. Apply the exact reviewed deploy-role mutex policy delta and verify its canonical policy hash from
   CloudTrail. Owner/provider then supplies a temporary non-root platform-admin session to create the
   dedicated Redis migration operator role/policy; do not use root.
3. Re-run read-only preflight, park UAT, execute prepare/cutover, reopen, install/verify UAT alarms,
   run acceptance and retain the legacy node through soak.
4. Give the monitoring operator exact `DeleteAlarms`, re-run Production verify and retire only the
   zero-datapoint legacy alarm. SNS mailbox delivery is already verified.
5. Obtain the audit retention decision and platform-admin cost-control read-back.
