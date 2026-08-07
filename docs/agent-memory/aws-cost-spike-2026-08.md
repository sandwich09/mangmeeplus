# Agent Memory: AWS cost spike, August 2026

Status: Diagnosed. The spike is over — UAT workers stopped crash-looping on 2026-08-07 ~05:40 UTC
and now runs 1/1. Bounded-fatal-log guard is committed to `develop` and untested in a real crash.
The steady-state waste (idle NAT, schedule-less UAT) is still unaddressed.

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

## Steady-state waste found (not yet fixed)

- **NAT gateway is idle.** `NatGateway-Hours` $43.90/month against `NatGateway-Bytes` **$0.02**.
  The private subnets hold only the RDS and ElastiCache ENIs, neither of which egresses. UAT Fargate
  runs in public subnets via IGW (`ECS_EXPRESS_SUBNET_MODE` defaults to `public`, and
  `deploy.sh` hard-rejects `private` for api-web). **Do not just delete it** — the A5 clone/audit
  scripts run tasks in private subnets and need it to reach ECR.
- **Public IPv4 $26-28/month across 8 addresses:** 3 ALB ENIs, 3 UAT Fargate tasks, 1 NAT, 1 bastion.
- **UAT runs 24/7** with `uat-api-web` at 2 vCPU / 6 GB while production serves nobody.

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
2. `maxmemory-policy` is `volatile-lru` on **both** clusters; BullMQ needs `noeviction`. Both use
   `default.redis7`, which cannot be edited — needs a custom parameter group.
3. Prod Redis is already at 100% with `watchdog-bms-workers` at `desiredCount=0`. It will crash the
   same way the moment prod scales up on an image without the retention fix.
4. Cost levers, roughly $150/month combined: NAT teardown with A5 re-create, UAT off-hours schedule,
   `uat-api-web` resize. Scheduling UAT from a workstation conflicts with the
   "rollouts only from the environment-owned workflow" rule in `prod-ecs-express/README.md` — do it
   as a scheduled workflow.
5. No CloudWatch alarm exists on `IncomingBytes`. One would have caught this on 2026-08-05 for $7
   instead of $179.
