# Kamal release commands

Explicit release paths share the same executor:

```sh
infra/kamal/deploy-prod --profile <deployment-profile>             # read-only preflight
infra/kamal/deploy-uat --profile <deployment-profile>              # read-only preflight
infra/kamal/deploy-prod --profile <deployment-profile> --prepare   # build main + full config/image checks, no deployment
infra/kamal/deploy-uat --profile <deployment-profile> --apply      # normal, applies safe pending migrations
infra/kamal/deploy-prod-hotfix --help                             # isolated Production source
infra/kamal/promote-prod --help                                  # signed UAT artifacts, no rebuild
```

`deploy-prod --apply` no longer silently selects latest main. The wrappers seal their environment and release path;
passing `--environment` cannot turn the UAT command into Production. There is no implicit bootstrap,
infrastructure creation, gate opening, DNS change or fallback to another environment.

## Preparing the Production command

Production uses the same build/config/rollout executor as UAT, with its own target, live ECS baseline,
Secrets Manager versions, AgentCore endpoints, registry, signing key and acceptance account.
[production-target.example.json](production-target.example.json) lists the enrollment fields. It is
intentionally rejected as a target: all resource placeholders need verified Production values and
`cutoverComplete` is false. Create the private `.env.kamal/production/target.json` only as part of
actual enrollment; do not copy UAT's target or turn this flag on to bypass infrastructure preparation.
API hosts must span two AZs and be separate from AI/workers. AI and workers may share a host.

After enrollment, run from the checkout containing the command:

```sh
infra/kamal/deploy-prod --profile <non-root-production-profile> --prepare
```

This runs the existing target preflight, fetches and pins `origin/main`, builds TypeScript and all
four images plus AgentCore, validates the complete Production environment/secrets against the built
images and migration/sync artifact catalog, renders all three native Kamal configs, and rereads
baseline configuration/secret versions for drift. A local controller can be prepared before merge;
its file hashes are recorded. Application code and tracked `config.json` still come from pinned main.
Default invocation without `--prepare` or `--apply` remains target preflight only.

Preparation performs local builds and cloud reads. It never acquires a remote lock, pushes/pulls to
target hosts, updates AgentCore, writes database/catalog state, deploys containers, changes customer
access, retires builds, or signs deployment acceptance. Existing unresolved deployments and local
concurrent operations still block it. Success is `PREPARED_NO_DEPLOYMENT` in the private run's
`result.json`; errors are terminal, with no automatic retry. `--prepare` rejects both `--apply` and
`--rollback` combinations. It is also supported by `deploy-uat`.

Ordinary preparation is for an enrolled target; first migration uses the separate staged target below.
It does not prove write permissions, migration compatibility with the live DB, target pull/start
behavior, customer journeys, or future runtime readiness. A full accepted Production deployment has
not been measured; UAT's timings are not a Production guarantee. Do not count preparation time as
zero when reporting an end-to-end release. `--prepared-build <build-directory>` can reuse an exact
clean main or isolated-hotfix build only after checking every phase/log, source tree, image
ID/architecture/label and AgentCore archive. A hotfix still reruns its selected regressions; every
path reruns full config/freshness checks. Preparation
acceptance never substitutes live rollout, signing or customer acceptance.

For UAT, prepare the reviewed exact main once and pass that run's `build/` directory to `--apply`.
The apply path targets 600 seconds, caps an unprepared build at 240 seconds, and stops before the
first provider/database mutation if pre-mutation work exceeds 360 seconds. This is a time boundary,
not permission to skip validation or retry an unreconciled run.

After review/CI and merge of the controller, choose one Production path:

```sh
infra/kamal/deploy-prod-hotfix --profile <non-root-production-profile> \
  --source-sha <full-hotfix-sha> --production-baseline <full-serving-sha> \
  --hotfix-path <changed-path> --regression-test <tracked-test-path> \
  --production-browser-acceptance --apply
infra/kamal/promote-prod --profile <non-root-production-profile> \
  --uat-release <signed-uat-run-directory> --mode normal \
  --production-browser-acceptance --apply
```

Repeat `--hotfix-path` for **every** changed path and `--regression-test` for the relevant tests.
Hotfix proves ancestry and the complete Production-base diff; schema/dependency/build/controller
changes are rejected. It preserves verified serving config instead of importing main's settings.
UAT promotion verifies the enrolled `trustedUatSigningKeyArn`, the signed receipt (maximum24hours),
all four immutable images and AgentCore archive. It copies exact image digests without rebuilding or
rewriting metadata. Historical receipts without a signed `promotionBundle` are rejected; create a
new UAT acceptance with this controller. Enroll the trusted UAT key and its scoped KMS verify permission
before promotion. Normal mode applies migrations; hotfix mode requires an unchanged catalog.

### First ECS-to-Kamal migration

The authorized September18 candidate is `0b0058adbc7353ec906a33746867af2a235b0934`, based on serving
`fc2838c4cb691033f41595c0d43587f10377d33c`. Infrastructure is staged, not deployed application code.
Use the hotfix command with `--first-migration --target <private-staging-target.json>` and the exact
complete path/test arguments. This mode requires `cutoverComplete:false`, migration state
`INFRASTRUCTURE_STAGED_NO_APPLICATION`, actual stack ARN, baseline SHA and unexpired temporary
authority; it never accepts an ordinary completed enrollment. `--prepare` still only reads AWS.

Preflight reads the stack's Ubuntu AMI and both owned rule tags before publishing or changing workers.
The temporary migration role needs `ec2:DescribeImages` and ELB `DescribeTags` (read actions require
resource`*`, bounded by region/expiry). The ListenerRule provider declares ModifyRule,
SetRulePriorities, AddTags and RemoveTags; constrain writes to the two owned rule ARNs. Do not grant
wildcard tag writes to satisfy IAM simulator differences. Verify actual scoped API permissions
before the forward run. Stable `UPDATE_ROLLBACK_COMPLETE` is accepted only with the same retained
route/template checks; in-progress or failed rollback remains blocked. Successful ExecuteChangeSet
has an empty body; completion still requires matching operation events and exact template/rule readback.

Apply requires controller bytes from current main. Freeze main and all Production release/recovery
work for the operation. The controller fences the two legacy Production deployment workflows and
checks for unfinished durable operations. Keep the shared recovery workflow idle; it is not disabled
because UAT also uses it. API/AI stage behind operator-only routes; the old ECS services/provider and
build authority remain available. Old workers reach STOPPED before new consumers start. Exactly two
owned listener conditions are switched using a reviewed CloudFormation change set. Existing ECS
rules are retained, including the actual weighted100/0 target selection. CloudWatch logging uses
the preprovisioned groups. No Cloudflare, DNS, schema migration or gate-opening mutation is implied.

Recovery uses the **same staged target/source/path/test arguments**, replacing the action with
`--apply --rollback <terminal-first-migration-operation-id>`. It stops and verifies candidate
consumers, restores operator-only rules and the exact old worker service body, then verifies ECS and
customer acceptance before signing `ROLLED_BACK_TO_ECS`. A publication failure before DB sync can
recover without a completed publication manifest. After DB sync starts, that manifest/tools image
is mandatory. Moving AWS state, configuration drift or an uncertain mutation requires read-only
reconciliation of its retained intent; do not start another deployment or blindly repeat recovery.
This path has local orchestration tests; it is not evidence of a live rollback drill.

Only signed forward acceptance installs `target.json` with `cutoverComplete:true`. It retains
`ecsRollbackBaseline`; ordinary subsequent releases are blocked while this rollback window remains
enrolled. Closing that window requires an explicit reviewed follow-up to retire old authority and
infrastructure, remove temporary migration policy and update enrollment. Do not delete the field
just to bypass the guard. Legacy Production workflows stay disabled after successful migration and
are restored to their original state after accepted ECS rollback.

Production requires `--production-browser-acceptance`, current administrator
`cmt8k20fs00000q319isxwkc5`, actual SYSTEM_ADMIN/launch-gate permission, live/canOpen/OPEN and
logout/session rejection. Existing owner sessions are allowed; no seed or password reset. Keep the
operation alive while gathering real observations. Record the extra Production checks in its
generated browser request; do not infer API statuses/identity from a page heading. UAT smoke flags
remain rejected. [Canonical acceptance protocol](../../docs/runbooks/uat-production-v2-deployment.md).

**Historical UAT proof:** PR551/552 are merged. Main `6b95e505` deployed successfully to real
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

### Isolated database and runtime rehearsal

`rehearse-database.py` exercises the actual DB controller against an empty PostgreSQL bootstrapped
from a supplied exact deployed-source migration catalog, followed by the candidate image's normal
upgrade and hotfix checks. Optional runtime checks start the three actual images on an internal
Docker network, regenerate every secret, compare complete container environments and run the shared
deep-readiness probes in deploy order. They reject runtime error logs and remove only their own test
containers/network. They never publish a host port or pass cloud credentials into containers.

```sh
python3 infra/kamal/rehearse-database.py \
  --manifest <validated-private-inventory.json> \
  --baseline-ref <exact-deployed-source-sha> \
  --postgres-image postgres:18.3-alpine \
  --runtime-baseline <private-capture-config-directory> \
  --redis-image <existing-local-redis-image> \
  --tls \
  --output <new-private-output-directory>
```

Use the engine observed in Production, not an assumed local default. `--tls` uses a disposable CA,
the same `verify-full` database URL options, and authenticated `rediss`; plaintext database TCP is
rejected. The actual database client reads its session's TLS state. The CA replacement is test-only;
this does not prove the AWS certificate chain, managed Redis version, cloud connectivity or HA.
Omit the two runtime options
for DB-only checks. The source-based schema is not a live migration ledger/data snapshot. Local
containers do not prove ECR, IAM, AgentCore, native multi-host rollout, AWS TLS/HA, storage or customer
acceptance. [Observed results and remaining gaps](../../docs/agent-memory/kamal-prod-simulation-2026-09-13.md).

### Isolated AWS core rehearsal

`rehearse-cloud.py` runs the existing shared Release build/config/ECR/migration/native rollout and
readback methods on the exact enrolled disposable Dev. It captures fresh Production config, replaces
every secret and external data route, uses synthetic PostgreSQL18.3/TLS plus authenticated Redis TLS,
and validates all candidate environment keys. The baseline catalog must match the observed live ledger.
The private target, existing bootstrap tools image and official dependency digests are explicit inputs:

```sh
python3 infra/kamal/rehearse-cloud.py \
  --target <enrolled-private-dev-target.json> --profile <dev-deploy-profile> \
  --baseline-ref <verified-production-source-sha> \
  --bootstrap-tools-image <existing-dev-tools-image> \
  --postgres-image <official-postgres-digest> --redis-image <official-redis-digest>
```

It only accepts the existing Dev instance/service and powers it off in `finally`. It parks previous Dev
workloads without deleting their data. The operator must verify AWS stopped state and remove only any
approved temporary ingress. Retained fixtures may restart with the host: inspect them before reuse.
Do not rerun after failure until original logs, lock and cloud state are reconciled. Linux Redis fixtures
run as their private config owner with a private writable data mount; do not make secret files public.

Setup and deploy clocks are separate; all phases, errors and shutdown time are retained. This bypasses
the full release orchestration for an explicitly scoped core experiment: no provider update, launch
retirement, customer OPEN/signing or Production target acceptance. A passed result must never be
called a Production release or stable full-deploy time. First AWS core proof passed507.797s with cache
(whole command569.800s), gate CLOSED, then Dev was stopped and temporary ingress removed.
[Evidence and parity gaps](../../docs/agent-memory/kamal-prod-simulation-2026-09-13.md).

### Target enrollment

Enroll `.env.kamal/production/target.json` or `.env.kamal/uat/target.json`, mode `0600`. Do not commit
private files. The `.env.*` paths are ignored by Git. The target must contain:

| Field | Value to verify during enrollment |
| --- | --- |
| `schemaVersion`, `environment`, `kind` | `1`, `production`/`uat`, matching kind (`dev` only for isolated rehearsal) |
| `account`, `region` | `311414082667`, `ap-southeast-1` |
| `hosts` | `api-web`, `ai-gateway`, `workers`; each is a nonempty array of actual hosts |
| host identity | `instanceId`, **primary private IP** `address` for `sshTransport:ssm` (a direct target may use a reachable address), `vpcId`, CloudFormation `stack`, verified `ssh-ed25519 …` `hostKey` |
| `repository`, `servicePrefix` | Existing environment ECR repository and `mangmee-…` Kamal service name |
| `publicUrl` | Permanent public HTTPS origin |
| `apiInternalUrl`, `aiInternalUrl` | Reachable HTTPS URLs ending in `/v1`; ingress routing/TLS already installed |
| `sshKey` | Absolute local path to the private deployment key used inside the SSM SSH tunnel |
| `sshTransport` | `ssm` for enrolled UAT/Production hosts; direct public SSH is legacy-only |
| `acceptanceCredentials` | Absolute path to private acceptance account JSON below; omitted for explicit browser/smoke acceptance |
| `browserAcceptanceUserId` | Expected account ID for the explicit environment browser flag; Production requires the current administrator above |
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

### SSM host identity reconciliation

The root project can reconcile an already enrolled SSM target after an intentional host-key rotation
without depending on public IPv4 or a workstation CIDR. This is **not** a deployment and never acquires
a remote release lock, publishes an image, or changes application infrastructure:

```sh
infra/kamal/deploy-uat --profile <uat-deploy-profile> --reconcile-host-identity \
  --accept-host-key-rotation --host-key-rotation-reason '<approved incident/change reason>'
infra/kamal/deploy-prod --profile <production-deploy-profile> --reconcile-host-identity \
  --accept-host-key-rotation --host-key-rotation-reason '<approved incident/change reason>'
```

It only accepts the existing target instance IDs after EC2 state/VPC/stack/IMDS and SSM readback,
captures each `ssh-ed25519` key through that host's SSM tunnel, and updates the private target only
after it proves controller-owned SSM sessions were closed. It changes every enrolled address to the
primary private IPv4. A matching key needs no rotation flag; a changed key requires both explicit
flags above and records the reason in the private result receipt. It cannot enroll replacement
instance IDs: that remains a reviewed environment enrollment because it changes the trust boundary.

Ordinary UAT and Production releases remain fail-closed for a changed host key. Never make a release
accept a new key, add public TCP/22, or use an Elastic IP as a workaround.

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
AWS CLI, Session Manager plugin, SSH, and a non-root deployment principal. Dependencies use the existing lockfile. The
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

Main/UAT builds use a clean main checkout; isolated hotfixes use their explicitly pinned Production-base source.
Promotion uses signed UAT artifacts. Merge this command and its
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
