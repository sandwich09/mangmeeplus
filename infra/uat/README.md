# WatchDog-BMS UAT

UAT uses the production-grade images and checks, but isolated AWS state. It never copies production data. The current acceptance cycle has an owner-approved temporary copy of production LINE values in the UAT secret namespace; replace production LINE credentials after acceptance.

## Release flow

1. Bootstrap only the neutral controller files listed in
   `infra/uat/neutral-main-bootstrap-files.txt` into `main`; choose `main` in
   **Use workflow from**. The shared CI controller is included because `deploy-uat` calls it, while
   the allow-list intentionally excludes production deployment and app code.
2. Enter a lowercase full SHA or `uat-*` tag reachable from `develop`.
3. Select `all`, `api-web`, `ai-gateway`, or `workers`. For an actor-delegation acceptance run,
   select `all` and enable `run_m01_acceptance`; the default is off for ordinary/hotfix deploys.
4. `UAT Deploy` tests and publishes immutable digests/SBOMs, migrates the UAT database, deploys, and verifies health.
5. After acceptance, merge the same commit to `main`; production still rejects commits outside `main`.

The controller runs from `main`, but it does not execute `main` application scripts: it resolves a
full SHA reachable from `develop`, checks out that exact detached commit, rechecks ancestry,
and only then runs CI, release, lease/bind/finalize and deployment scripts from that checkout. The
shared CI workflow receives that full SHA as its required `source_ref`; its resolver and every build/
test/publish job check out the resolved SHA (or verify an exact successful pull-request CI run for it), never
the controller's `main` application tree. The
same neutral bootstrap also makes the two F2 PLAN/APPLY controllers dispatchable; it does not promote
the UAT application commit or copy `.github/workflows/deploy-production.yml`/`apps/**` into `main`.

## One-time control plane

Create UAT-only GitHub OIDC and ECS runtime roles:

```sh
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/setup-control-plane.sh
```

For the one audited upgrade case where `watchdog-bms-deploy-uat` exists but the dedicated
`watchdog-bms-uat-release-task-role` is absent and the operator cannot yet read the two inline
policies, run the explicit bridge once:

```sh
UAT_IAM_BOOTSTRAP_APPLY_UNVERIFIED=true \
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/setup-control-plane.sh
```

It may create only that missing role with the exact ECS-task trust and write only the two named
deploy/release policies. Exit `75` with `APPLIED_BUT_UNVERIFIED` is expected. Do not deploy from the
workstation; the next `UAT Deploy` controller must exact-readback both policies before its first
environment mutation. Any other missing role, trust drift, `AccessDenied`, or partial write is an
operator/admin stop condition rather than permission to broaden the bootstrap.

Create the GitHub `uat` environment, restrict it to the `main` workflow source, then set:

```sh
gh api --method PUT repos/MangmeeDev/mangmeeplus/environments/uat \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api --method POST repos/MangmeeDev/mangmeeplus/environments/uat/deployment-branch-policies \
  -f name=main -f type=branch
gh variable set AWS_ACCOUNT_ID --env uat --body 311414082667
gh variable set AWS_REGION --env uat --body ap-southeast-1
gh variable set AWS_ROLE_ARN --env uat --body arn:aws:iam::311414082667:role/watchdog-bms-ci-uat
gh variable set AWS_DEPLOY_ROLE_ARN --env uat --body arn:aws:iam::311414082667:role/watchdog-bms-deploy-uat
```

Add these non-secret UAT LINE variables (the current approved cycle temporarily uses the production values):

- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LIFF_ID`
- `LINE_MESSAGING_CHANNEL_ID`

Optional variables include `PUBLIC_DOMAIN_URL`, LINE links/images, and AI provider settings. The defaults keep CRM auto-reply and AI providers disabled.

## Isolated data services

This creates a dedicated `db.t4g.micro` RDS instance (encrypted at rest via `--storage-encrypted`),
an encrypted single-node `cache.t4g.micro` Redis replication group, S3 bucket, UAT-only security groups,
secrets, and ECS cluster. The live legacy Redis node predates this bootstrap shape and is still
unencrypted; do not confuse a corrected creation script with live migration evidence. It reuses the
existing subnets and adds recurring AWS cost. The RDS and Redis nodes sit in the two private subnets;
the Fargate tasks run in the public ones and egress through the internet gateway, which is why the
NAT gateway was removed on 2026-08-07 after a month of billing $43.90 for 0.4 GB of traffic. Recreate
it before running anything in `ECS_EXPRESS_SUBNET_MODE=private` or the A5 clone/audit path. Export UAT
LINE secrets without putting them on the command line; temporary production values require explicit
owner approval and mandatory production rotation after acceptance:

```sh
export LINE_LOGIN_CHANNEL_SECRET='...'
export LINE_MESSAGING_CHANNEL_SECRET='...'
export LINE_MESSAGING_CHANNEL_ACCESS_TOKEN='...'
CONFIRM_UAT_COST=CREATE_ISOLATED_UAT \
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/bootstrap-data.sh
unset LINE_LOGIN_CHANNEL_SECRET LINE_MESSAGING_CHANNEL_SECRET LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
```

Secrets are stored only under `watchdog-bms/uat/*`. The deployment runs containers with `APP_ENV=production` for production security validation while `DEPLOY_ENV=uat` selects isolated cloud resources.

## Redis parameter group (`noeviction`)

The legacy node was originally created on `default.redis7`, which ships
`maxmemory-policy=volatile-lru` and cannot be edited. That default is actively wrong here:
`volatile-lru` evicts only keys that carry a TTL — the rate-limit counters and the actor-delegation
replay store — while the untagged BullMQ job records that actually fill the cache are never eviction
candidates. The cache sheds security state and then hits OOM anyway, which is what took every UAT
worker down on 2026-08-05. The legacy live node has since been attached to custom
`watchdog-bms-uat-redis7` with `noeviction`; fresh bootstrap creates and attaches that group before
the node starts.

Applied to the legacy UAT node on 2026-08-07. Production Redis was later rebuilt with its own custom
`noeviction` group and proven on 2026-08-14; do not rerun these standalone-node commands against it.
Fresh UAT nodes get the parameter group from bootstrap at create time:

```sh
aws elasticache create-cache-parameter-group \
  --cache-parameter-group-name watchdog-bms-uat-redis7 \
  --cache-parameter-group-family redis7 \
  --description 'UAT: noeviction for BullMQ'

aws elasticache modify-cache-parameter-group \
  --cache-parameter-group-name watchdog-bms-uat-redis7 \
  --parameter-name-values ParameterName=maxmemory-policy,ParameterValue=noeviction

aws elasticache modify-cache-cluster \
  --cache-cluster-id watchdog-bms-uat-redis \
  --cache-parameter-group-name watchdog-bms-uat-redis7 \
  --apply-immediately
```

The family is `redis7` for engine 7.x. `maxmemory-policy` is a dynamic parameter, so the third step returns `CacheNodeIdsToReboot: []` and reaches `ParameterApplyStatus: in-sync` in about thirty seconds with no reboot and no data loss. Confirm with:

```sh
aws elasticache describe-cache-clusters --cache-cluster-id watchdog-bms-uat-redis \
  --query 'CacheClusters[0].CacheParameterGroup'
```

Two IAM details cost time the first time through. `modify-cache-cluster` authorises against **both** the cluster ARN and the parameter-group ARN, so a policy scoped only to the cluster fails with an `AccessDenied` that names the parameter group and reads like the wrong resource is at fault. And `describe-cache-parameters` on `default.redis7` is a separate grant from the custom group, which is why reading the AWS default is not required by the steps above — the new group inherits the family defaults and only the one parameter is overridden.

Doing this at zero capacity (see below) means nothing is connected while the group swaps.

`bootstrap-data.sh` now creates the parameter group and attaches it at create time, so a fresh bootstrap never passes through `volatile-lru`. The three commands above remain the procedure for a node that already exists.

## Redis encryption blue/green migration

The live UAT node is **not encrypted** — `AtRestEncryptionEnabled`, `TransitEncryptionEnabled` and `AuthTokenEnabled` all read false, and the stored URL is `redis://`. It predates the bootstrap change below.

`bootstrap-data.sh` now creates a **single-node replication group** with at-rest encryption, in-transit encryption and an auth token, and writes the secret as `rediss://:<token>@<host>:6379`. The shape is forced: `create-cache-cluster` has no at-rest encryption option at all, so a standalone node can never be encrypted. One node, no failover and no snapshot retention are deliberate — those are M-17's *availability* requirements for production, where `infra/security/verify-production-security-baseline.sh` fails closed without `nodeCount >= 2`, `automaticFailover == "enabled"` and 35-day snapshots. A replica in UAT would buy no confidentiality.

No application change is needed: `REDIS_URL` is an unconstrained string, and ioredis turns on TLS from the `rediss://` scheme and reads the password from the userinfo field, which covers both BullMQ (`connection: { url }`) and the API rate limiter (`new Redis(url, …)`).

Encryption cannot be toggled on the live standalone node, so it has to be replaced. Its contents are
operational state — BullMQ jobs, rate-limit counters and LINE ledger entries — not the durable audit
source of truth, but two runtimes must never consume the old and new queues at the same time.

> **Superseded 2026-08-15:** do not run the old delete-node +
> `delete-secret --force-delete-without-recovery` procedure. It destroyed the rollback target first,
> changed the secret ARN and forced a deploy for an avoidable reason.

The repository implementation is `infra/uat/redis-blue-green.sh`. It has three explicit operations:
`prepare`, `cutover`, and `rollback`. All require exact account/region/resource checks, exact capacity
`0/0`, zero running/pending tasks, and a mode-specific confirmation. Migration and UAT deploy acquire
the same no-overwrite SSM mutex, closing the race where a deploy starts after the parked-state check.
Neither operation prints the URL/token, deletes a cache, or changes ECS capacity.

Before the first run, a platform admin must apply the updated
`infra/uat/github-deploy-role-policy.template.json`; the GitHub deploy preflight compares that policy
exactly and will fail until the role can delete only the mutex parameter. Bind the rendered
`infra/uat/redis-blue-green-operator-policy.template.json` to the migration operator. Its create grant
is limited to v2 and enforces encryption/auth, node type, parameter group and required tags; it has no
ElastiCache delete action.

Run from a reviewed migration window. First park UAT and prove tasks drained, then prepare and cut
over while the old node remains intact:

```sh
ECS_EXPRESS_MIN_TASKS=0 ECS_EXPRESS_MAX_TASKS=0 DEPLOY_ENV=uat \
  bash infra/prod-ecs-express/deploy.sh all

CONFIRM_UAT_REDIS_PREPARE=CREATE_ENCRYPTED_CANDIDATE \
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/redis-blue-green.sh prepare

CONFIRM_UAT_REDIS_CUTOVER=MOVE_CURRENT_TO_ENCRYPTED_V2 \
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/redis-blue-green.sh cutover

ECS_EXPRESS_MIN_TASKS=1 ECS_EXPRESS_MAX_TASKS=2 DEPLOY_ENV=uat \
  bash infra/prod-ecs-express/deploy.sh all
```

The existing `watchdog-bms/uat/redis-url` ARN stays unchanged. `AWSCURRENT` becomes the v2
`rediss://` version and the legacy URL remains `AWSPREVIOUS`. After reopening, run the normal UAT
health/worker/queue/rate-limit/LINE acceptance paths and soak for at least 24 hours or one acceptance
cycle. Keep the legacy node until owner sign-off; its deletion is intentionally not implemented.

If smoke fails, park UAT again before rollback, restore the legacy version, then reopen:

```sh
ECS_EXPRESS_MIN_TASKS=0 ECS_EXPRESS_MAX_TASKS=0 DEPLOY_ENV=uat \
  bash infra/prod-ecs-express/deploy.sh all

CONFIRM_UAT_REDIS_ROLLBACK=RESTORE_LEGACY_CURRENT \
AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
  bash infra/uat/redis-blue-green.sh rollback

ECS_EXPRESS_MIN_TASKS=1 ECS_EXPRESS_MAX_TASKS=2 DEPLOY_ENV=uat \
  bash infra/prod-ecs-express/deploy.sh all
```

An ungraceful process kill may leave `/watchdog-bms/uat/redis-migration-lock`. Read its non-secret
owner/mode/time value and prove no deploy or migration process/workflow is active. Only then may an
operator delete that exact SSM parameter; never delete it merely because a later command is blocked.

`infra/uat/redis-encryption.spec.sh` guards the bootstrap: it fails if the standalone `create-cache-cluster` returns, if any encryption flag is dropped, if the secret reverts to `redis://`, or if the generated auth token leaves the 16–128 character range or contains a character ElastiCache rejects.

## Runtime alarms

After `prepare` has created v2, install UAT alarms using the confirmed shared operations SNS topic.
The verifier rejects a pending/missing subscription and rejects every dimension with zero datapoints,
even when an alarm appears `OK` because missing data is non-breaching:

```sh
SECURITY_ALERT_TOPIC_ARN='arn:aws:sns:ap-southeast-1:311414082667:<confirmed-topic>' \
  bash infra/monitoring/runtime-alarms.sh install uat
SECURITY_ALERT_TOPIC_ARN='arn:aws:sns:ap-southeast-1:311414082667:<confirmed-topic>' \
  bash infra/monitoring/runtime-alarms.sh verify uat
```

UAT gets per-log-group 64 MiB/hour guards, per-node Redis memory at 75%, RDS free storage at 4 GB,
and free memory at 64 MB. Production uses the same script with its documented thresholds; retire the
old invalid Production Redis alarm only through the guarded Production-only mode in
`docs/runbooks/production-golive-aws-commands.md`.

## Parking UAT between cycles

UAT Fargate is the largest recurring line in the account (~$113/month including the three public IPv4 addresses its tasks hold). Park it at zero when no acceptance cycle is running:

```sh
ECS_EXPRESS_MIN_TASKS=0 ECS_EXPRESS_MAX_TASKS=0 bash infra/uat/deploy-with-runtime-mutex.sh all
```

Both default to `1`/`2`. Production rejects any other value, because `infra/security/collect-production-a5-current-health.sh` asserts the live service still reads exactly `{minTaskCount:1,maxTaskCount:2,AVERAGE_CPU,70}` when it collects signed evidence.

Parking leaves the services `ACTIVE` with their image and configuration intact, so bringing UAT back is a capacity change rather than a redeploy. Tasks drain in about four minutes and the ENIs — and their public IPv4 charges — are released a few minutes after that. Note that `run-a5-capacity-mutating.sh` requires `minTaskCount >= 1`, so raise capacity before a U5 capacity run.

## M-01 actor-delegation acceptance

The UAT bootstrap creates the dedicated actor-delegation signing key. A clean CI run
retains `agentcore-runtime-<full-sha>` alongside the immutable image release. Enable
`run_m01_acceptance` only with `target=all`: after health and the durable release finalizer pass,
the exact `deploy-uat.yml@refs/heads/main` controller starts the short-lived `m01-live` task for
the same full source SHA. Workstation/manual invocation is rejected. The task exercises accepted,
substitution, replay, cross-company, wrong-audience, and unreachable-Redis cases against UAT and
writes only sanitized evidence/audit; it never syncs launch gates or opens a route/feature. A failed
M-01 task makes the workflow and its UAT acceptance evidence fail even when service health already
passed. `m01-actor-delegation-alert.sh` installs and verifies the correlated UAT denial alarm. Both
scripts fail closed outside UAT; production has no M-01 mode.

## Required LINE console changes

After the first `api-web` URL is known, configure the UAT LINE Login callback/LIFF endpoint and UAT Messaging webhook to that URL, verify the webhook, then rerun `api-web` if a custom `PUBLIC_DOMAIN_URL` is added.
