# Agent Memory: AWS cost spike, August 2026

Status: Diagnosed and partly remediated. The spike is over — UAT workers stopped crash-looping on
2026-08-07 ~05:40 UTC and now runs 1/1. Bounded-fatal-log guard is committed to `develop` and
untested in a real crash. The idle NAT gateway and production Redis were deleted on 2026-08-07
(~$60/month). **`watchdog-bms/production/redis-url` now points at a destroyed endpoint** — see Next.

Owner: Opus 5, 2026-08-08.

Scope: Budget alert fired at $173.03 against a $100 monthly budget on account `311414082667`.
Investigated with Cost Explorer, then fixed the log-volume half of the root cause in
`apps/workers`. Companion incident doc: `uat-deploy-ci-unblock-20260807.md` (same OOM, prior repo).

## What actually cost the money

August 1-7 was **$262.75** (the $173.03 in the alert email was already stale; CE keeps posting for
~24h). Breakdown:

| Service | MTD | Note |
| --- | --- | --- |
| CloudWatch | $179.37 | 68% of the bill. **$0.00 in all of July.** |
| ECS (Fargate) | $27.15 | UAT only — prod services sit at `desiredCount=0` |
| RDS x2 / ElastiCache x2 | $15.76 | one prod + one UAT each |
| everything else | ~$23 | NAT, ALB, Secrets, ECR, Bedrock, EC2 |

The CloudWatch line is one usage type, `APS1-DataProcessing-Bytes` (log ingest at $0.70/GB):

```
2026-08-05    15.35 GB   $7.27     crash loop starts (67 task starts)
2026-08-06   137.00 GB   $95.90    846 task starts, ~162 MB of log per crash
```

Each crash was a BullMQ `ReplyError: OOM command not allowed` whose `command.args` carried the whole
stalled-jobs Lua script. Nothing handled it, so Node's default fatal handler `util.inspect`-ed the
entire error object to stderr on every restart.

## Decisions

- **Queue retention was already fixed** in this repo — `common/queue.ts` is the only place allowed
  to call `new Queue`, `queue.spec.ts` enforces it, and all seven queues route through it. The
  deployed UAT image predates it. No code change was needed or made for that half.
- **Added a bounded fatal handler instead** (`fatalDetail` in `common/log.ts`, registered in
  `main.ts`). Caps any crash detail at 2,000 chars, so a future crash loop costs ~1.7 MB/day rather
  than 137 GB. Registered before config parse so a boot-time throw is bounded too.
- **`process.exit` is deferred 50ms.** ECS pipes stdout, so an immediate exit can drop the very line
  explaining the death. `process.exitCode` is set as well, so an unref'd natural exit is still non-zero.
- Kept the crash itself. Failing fast on a full Redis is correct; the cost was the log volume, not
  the restart.

## Measurement traps hit during this investigation

Three estimates were wrong by 20-100x before Cost Explorer access landed. Do not repeat:

- **CloudWatch is billed on raw ingest, `storedBytes` is compressed.** The log group showed 7.15 GB
  stored; actual ingest was ~152 GB. Roughly 20x on repetitive log text. Never price logs from
  `describe-log-groups`.
- **`ecr:DescribeImages` `imageSizeInBytes` double-counts shared layers.** Summing it gave 113 GB
  across four repos; the real bill is $0.52/month. ECR dedupes layers.
- **Bedrock was never the problem** — $3.20 for all of July, despite the account being named
  `watchdog-bedrock-dev`.

## Steady-state waste

- **NAT gateway — DELETED 2026-08-07T18:17Z.** It was idle: `NatGateway-Hours` $43.90/month against
  `NatGateway-Bytes` of **$0.02**. Only two ENIs sat behind it, UAT's RDS and UAT's Redis, and
  neither egresses. Everything else runs in public subnets via IGW (`ECS_EXPRESS_SUBNET_MODE`
  defaults to `public`; `deploy.sh` hard-rejects `private` for api-web). The A5 clone/audit path
  would need it, but `/watchdog-bms/production/a5-network/task-subnet-ids` is `ParameterNotFound` —
  that bootstrap was never run. Recreate the NAT before any A5 run or any `private`-mode deploy.
  Teardown was three steps, not one: deleting the gateway from the console left the Elastic IP
  allocated (still billing) and a `blackhole` default route in `rtb-07f3ced2ad683cd23`. Both cleaned
  up manually afterwards.
- **Production Redis — DELETED 2026-08-07** with no final snapshot; the data is unrecoverable. It
  was full at 100% and unused (all prod ECS services at `desiredCount=0`). ~$13/month.
- **Public IPv4 now 3 addresses**, all on the shared ALB. Was 8 (3 ALB, 3 UAT Fargate tasks, 1 NAT,
  1 bastion). The three UAT task addresses disappear whenever UAT scales to zero.
- **Still open: UAT runs 24/7** with `uat-api-web` at 2 vCPU / 6 GB while production serves nobody.
  ~$102/month of Fargate, the largest remaining line.

## Verification

- `pnpm test` in `apps/workers`: 20 pass / 0 fail, including three new `fatalDetail` cases (drops the
  attached Lua script, bounds oversized detail, survives a non-Error rejection).
- `pnpm typecheck`: clean.
- Simulated a real-shaped `ReplyError`: 20,009 chars under Node's default inspect vs 842 through
  `fatalDetail`. The guarantee is the 2,000-char ceiling, not the ratio.
- Not verified: behaviour in an actual OOM crash. Needs a UAT deploy of current `develop`.

## Open questions

- Does `elasticache:RebootCacheCluster` flush a cluster with no snapshot configured? Assumed yes,
  never confirmed — the dev IAM user cannot read snapshot config.
- Whether prod ECS at `desiredCount=0` is intentional (no users yet) or an unnoticed outage.

## Next

1. Ship current `develop` to UAT. Redis was refilling at ~17 keys/min after the last clear, so the
   270k records that filled it return around 2026-08-18 without the retention fix deployed.
2. ~~`maxmemory-policy` is `volatile-lru`~~ — done 2026-08-07. UAT Redis now uses the custom group
   `watchdog-bms-uat-redis7` (family `redis7`) with `maxmemory-policy=noeviction`; the change
   reached `in-sync` in about 30 seconds with `CacheNodeIdsToReboot` empty, because the parameter is
   dynamic. `default.redis7` cannot be edited, hence the custom group. Worth knowing why this
   mattered beyond BullMQ's warning: `volatile-lru` evicts only keys **with** a TTL, which here are
   the rate-limit counters and the actor-delegation replay store — the untagged BullMQ job records
   that actually filled the cache were never eviction candidates. The cache was quietly discarding
   security state on its way to the same OOM. Attaching a parameter group needs
   `elasticache:ModifyCacheCluster` on **both** the cluster and the parameter-group ARN; scoping it
   to the cluster alone returns AccessDenied naming the parameter group.
3. **Blocking any production deploy: `watchdog-bms/production/redis-url` still holds the endpoint of
   the deleted cluster** (`watchdog-bms-prod-redis.tp6lu7.0001.apse1.cache.amazonaws.com`, secret
   untouched since 2026-06-28). `deploy.sh` injects it into api-web and workers, so the next prod
   rollout starts containers that cannot reach Redis. Recreate the cluster **empty** — never restore
   a snapshot of the full one — attach a custom parameter group with `maxmemory-policy=noeviction`,
   then update the secret. There is no prod bootstrap script in this repo; only `infra/uat/bootstrap-data.sh`
   exists, so the recreate is manual and undocumented. Write it down when it happens.
4. Remaining cost lever, ~$94/month: UAT off-hours schedule plus a `uat-api-web` resize. Scheduling
   UAT from a workstation conflicts with the "rollouts only from the environment-owned workflow"
   rule in `prod-ecs-express/README.md` — do it as a scheduled workflow. After the NAT and prod-Redis
   deletions the steady state is roughly $160/month; this is what gets it under the $100 budget.
5. No CloudWatch alarm exists on `IncomingBytes`. One would have caught this on 2026-08-05 for $7
   instead of $179.
