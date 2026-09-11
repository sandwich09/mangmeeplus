# Kamal release commands

Two entry points share the same executor:

```sh
infra/kamal/deploy-prod --profile <deployment-profile>             # read-only preflight
infra/kamal/deploy-uat --profile <deployment-profile>              # read-only preflight
infra/kamal/deploy-prod --profile <deployment-profile> --apply     # hotfix, no pending migrations
infra/kamal/deploy-uat --profile <deployment-profile> --apply      # normal, applies safe pending migrations
```

`--mode hotfix|normal` is explicit and available on either wrapper. The wrapper seals the environment;
passing `--environment` cannot turn the UAT command into Production. There is no implicit bootstrap,
infrastructure creation, gate opening, DNS change or fallback to another environment.

**Current deployment status:** PR551/552 are merged. Main `6b95e505` deployed successfully to real
UAT twice with complete config/readiness and verified KMS signatures, without repair or retry:
`20260911T170623Z-c8d84820` took4m14.836s from merge to exit;
`20260911T171058Z-8c83ebfc` took4m25.786s including operator prechecks (command alone4m21.191s).
Both used existing build caches and reran TypeScript. These are measured UAT runs, not a fixed
future duration or Production benchmark. Production remains on ECS Express and dev is stopped.
[Full timings and signed evidence](../../docs/research/kamal-uat-stable-hotfix-proof-2026-09-11.md).
The earlier failed rollback was reconciled without runtime changes; its failure is retained.

The owner authorized consolidated rehearsal followed by two real UAT deployments,
without login/logout. The explicit `--uat-smoke-acceptance` option is for this real UAT scope:

```sh
infra/kamal/deploy-uat --profile mangmee-kamal-uat --mode hotfix --apply --uat-smoke-acceptance
```

It requires complete image/source/environment readback, all three HTTP health endpoints, API database
readiness, workers' actual Redis PING and internal API connectivity, public OPEN and frontend
availability, observed build retirement and a verified KMS result. The receipt explicitly records
`owner_authorized_uat_config_readiness_smoke` and `loginLogout: NOT_REQUIRED_BY_OWNER`; it does not
claim authenticated or LINE journeys were exercised. This mode rejects Production, dev and combination
with browser acceptance. Production still follows the [V2 protocol](../../docs/runbooks/uat-production-v2-deployment.md).

## Once per environment

Enroll `.env.kamal/production/target.json` or `.env.kamal/uat/target.json`, mode `0600`. Do not commit
private files. The `.env.*` paths are ignored by Git. The target must contain:

| Field | Value to verify during enrollment |
| --- | --- |
| `schemaVersion`, `environment`, `kind` | `1`, `production`/`uat`, matching kind (`dev` only for isolated rehearsal) |
| `account`, `region` | `311414082667`, `ap-southeast-1` |
| `hosts` | `api-web`, `ai-gateway`, `workers`; each is a nonempty array of actual hosts |
| host identity | `instanceId`, IP `address`, `vpcId`, CloudFormation `stack`, verified `ssh-ed25519 …` `hostKey` |
| `repository`, `servicePrefix` | Existing environment ECR repository and `mangmee-…` Kamal service name |
| `publicUrl` | Permanent public HTTPS origin |
| `apiInternalUrl`, `aiInternalUrl` | Reachable HTTPS URLs ending in `/v1`; ingress routing/TLS already installed |
| `sshKey` | Absolute local path to the private deployment key; optional `sshProxyCommand` for a verified bastion |
| `acceptanceCredentials` | Absolute path to private acceptance account JSON below; omitted for explicit UAT browser/smoke acceptance |
| `browserAcceptanceUserId` | Expected real UAT account ID when using `--uat-browser-acceptance`; contains no password |
| `agentcoreRuntimeArn` | Existing environment runtime ARN |
| `agentcoreQualifier`, `agentcoreCandidateQualifier` | Two dedicated, stable, non-DEFAULT endpoints; one active and one spare |
| Real UAT/Production | Actual asymmetric `signingKeyArn`; API hosts separate from AI/worker hosts |
| Production only | `cutoverComplete: true`, at least two API hosts across two AZs |

Real UAT and Production API hosts must be separate from AI/worker hosts to preserve runtime IAM boundaries. All
hosts need Docker, the `kamal` network, Kamal proxy, verified instance profiles and IMDSv2/hop limit2.
Enroll routes, private DB/cache connectivity, actual role permissions, logs, alerts, backups and
ingress before setting `cutoverComplete`. The script checks EC2 identity, routing after deployment,
runtime config and health; it does not create or certify an entire new Production infrastructure.

Acceptance JSON contains `environment`, `kind`, `username`, `password`, `userId`, and optional
`readPaths` (GET `/api/v1/…`). Real UAT/Production require a SYSTEM_ADMIN account with
`system.launch_gate.manage`, no forced password/legal action, and customer access already `OPEN`.
The command preserves gate decisions; it does not silently open a closed platform.

For the owner's manual login on real UAT, use `--uat-browser-acceptance` and enroll
`browserAcceptanceUserId`. This option rejects Production and isolated dev; it also supports UAT rollback with the exact restored source/version binding. The same
process pauses after rollout, runtime/health verification and public OPEN/login-page checks, with
status `AWAITING_BROWSER_ACCEPTANCE`. Notify the owner to log in at the printed URL. Keep this
process running and its locks intact; do not dispatch another deployment to continue acceptance.

The browser operator then verifies the expected identity, SYSTEM_ADMIN and
`system.launch_gate.manage`, customer OPEN, an authenticated system page, logout and rejection of
the logged-out session. Retain actual browser observations (DOM text/screenshots with URLs and
results; no passwords/cookies). Use the generated `browser-acceptance-request.json` as the binding
template, fill its check results and `observer`, and list absolute observation-file paths in
`evidenceFiles`. Only after these actions, write `browser-acceptance.json` atomically in the same
run directory. All six checks must pass. A login by itself is insufficient. The script validates
the operation/source/release/origin/account binding and hashes the retained files; it does not
independently authenticate the operator's browser observations. The signed result explicitly
labels this evidence `operator_browser_attestation`. Runtime, health and public OPEN are checked
again after the wait before retirement/signing. An interrupted process requires reconciliation.

Local operator prerequisites: Git, Python3 (POSIX), pnpm, Node, Docker with Linux amd64 builds,
AWS CLI, SSH, and a non-root deployment principal. Dependencies use the existing lockfile. The
principal needs scoped EC2/ECS discovery, ECR publish/read, Secrets Manager read, AgentCore
runtime/endpoint read and update, and versioned artifact S3 read/write; Real UAT and Production additionally
need KMS sign/verify. Runtime roles separately need the application's DB/cache/storage/AI access.
IAM/quota changes are enrollment work and are never executed by the release command.

The current dev reader policy is [dev-agentcore-read-policy.json](dev-agentcore-read-policy.json).
It grants no provider update/deployment permission. It is attached through the dedicated group
`mangmee-kamal-dev-readers` because this user had exhausted both inline policy bytes and direct
managed-policy attachments. `GetAgentRuntimeEndpoint` needs both the exact runtime ARN and an
allowed dev endpoint ARN; non-dev endpoint access was tested and remains denied.

## Each release

The whole timer starts before target preflight and includes fetching/pinning `origin/main`, clean
checkout, TypeScript, all image builds, full config validation, registry push/pull, provider work,
migration/catalog verification and sync, all three service rollouts, complete image/environment
readback, proxy route checks, deep API/AI health, customer login/read/logout acceptance, build
retirement and receipt signing. Shell invocation to the final `result.json` is the measured span;
reported per-phase times are components of that total, not independent fixed durations.
For manual UAT acceptance, `secondsToWebsiteReady` is only the partial time to public readiness;
`browserAcceptanceStageSeconds` includes the owner's wait/login and browser verification up to
evidence submission. `elapsedSeconds` still includes that stage, subsequent readback, retirement
and signing. Report all three with those boundaries; never present readiness as full acceptance
or subtract the entire browser stage and call the remainder a proven automated release time.

All builds use a clean main checkout, not the operator's dirty app files. Merge this command and its
helpers/config to main before a real UAT/Production release; preflight rejects a mismatched controller.
For the owner's explicit test of the new local command on real UAT, `--uat-controller-sha256`
accepts only the exact hash of all functional controller/helper/config files, records that separate
identity, and rechecks it before mutation. It cannot be used with dev or Production. Application
images still come from a clean, pinned main checkout. This exception does not bypass GitHub review
or represent the command as merged. The current hash can be computed without cloud access:

```sh
python3 -c 'import runpy; m=runpy.run_path("infra/kamal/release.py"); print(m["digest"](m["controller_manifest"]()))'
```

The tools image carries and validates the complete migration/sync catalog. AgentCore code is hashed,
uploaded once under a unique operation key, downloaded at its exact S3 version, and read back before
the gateway is replaced. An unchanged exact source/config/artifact reuses its pinned provider version.
Changed code/config needs an enrolled spare endpoint; it never repoints the endpoint still serving
the old gateway. A missing spare is not solved by deleting endpoints during a release.

Fresh complete ECS environment configuration is the current baseline, with current secret versions
resolved privately. [config.json](config.json) supplies tracked environment changes; `null` removes
a key. New optional settings must be declared there; new secrets must have an authoritative secret
reference in the environment baseline. Never put secret values in tracked config. Unknown secret
values cannot be invented by deployment. Candidate image validators reject missing required settings.
Before mutation, a second read verifies that baseline config and secret versions have not changed.
The new container's entire environment is compared, including unexpected leftover keys.

Hotfix refuses any unapplied migration and runs catalog/sync/feature-authority checks. Normal mode
uses the existing pending-migration safety checks before applying migrations. It is not a substitute
for a Production migration compatibility rehearsal required by the active release protocol.

## Evidence and failure

Each run writes `.env.kamal/<environment>/runs/<operation-id>/result.json`. A successful result is
`ACCEPTED_LINE_DEFERRED`. Real UAT and Production sign and verify `accepted.json` using KMS;
isolated dev records an unsigned checksum. This is the new command's evidence format, not an ECS
V2 Passport/READY/Result. Keep the private run directory for reconciliation/rollback; it includes
resolved config, previous environment and provider requests. Do not publish raw directories.

Any failure stops at that boundary. A possible mutation retains `active.json` and the remote lock;
a second ordinary deploy refuses to run. Inspect the original result and private logs, reconcile
the actual cloud state, and correct all related preconditions before a reviewed retry. Do not delete
locks merely to continue. No automatic deployment retries or rollback after an unknown result.

Explicit rollback is for migration-free hotfix operations only:

```sh
infra/kamal/deploy-prod --profile <deployment-profile> --rollback <terminal-operation-id> --apply
infra/kamal/deploy-uat --profile <deployment-profile> --rollback <terminal-operation-id> --apply
```

It uses retained previous containers and complete environment, verifies preserved provider bindings,
restores native routes, checks images/config/health/customer access, reconciles build authority and
signs the result. Rollback is not DB down-migration. Missing retained containers, mixed old sources,
changed host sets, changed preserved provider endpoints or changed authority stop recovery.

## Isolated dev rehearsal

The retained private target is `.env.kamal/uat/dev-target.private.json`, kind `dev`; it uses a separate
synthetic database and Redis DB15 with scoped UAT integration resources. It does not start UAT ECS.
Its temporary HTTPS tunnel runs on the workstation and is an infrastructure prerequisite, excluded
from the release timer. Do not use that transport, target, acceptance account or IAM profile for Prod.

```sh
infra/kamal/deploy-uat --profile watchdog-bedrock \
  --target .env.kamal/uat/dev-target.private.json --mode hotfix --apply
python3 infra/kamal/release_test.py
python3 infra/kamal/shutdown_test.py
```

Current dev has only one dedicated AgentCore endpoint. Exact main can be reused; a new source needs
another enrolled dev endpoint/runtime before building. The local API supervisor shutdown fix is a
separate app diff and must be merged into main before claiming its behavior in deployed images.
Evidence and measured limits are maintained in
[task memory](../../docs/agent-memory/kamal-production-command-2026-09-11.md).

## Reproducible UAT host setup

`bootstrap-host.sh` is the canonical initial Ubuntu setup: user-owned HOME/Kamal paths, Docker with
bounded logs, official Ubuntu package mirror, and the digest-pinned Kamal2.12-compatible proxyv0.9.2.
Do not run it against a serving host; ordinary deploy never installs packages or replaces the proxy.
`prepare-bootstrap-update.py <private-current-template.json> <new-private-template.json>` embeds that
script and the existing SSH public key into only ApiServer/AiServer UserData. Other resources and
properties are preserved. The input/output may contain private environment values: never commit them.
Review the actual CloudFormation change set before applying; EBS UserData updates restart instances.
The approved setup operation, readback and any address re-enrollment happen before release timing.
The currently serving release must recover healthy after any setup restart before a new deploy starts.

Repeatability proof and limits: `docs/plans/kamal-stability-2026-09-11.md`. Always record each original
full clock, exact source/controller and signed receipt; no repaired attempt counts as a clean run.
