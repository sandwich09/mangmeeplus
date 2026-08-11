# Deploy Wave Rollout + Production Promotion Spec

Status: Approved for implementation
Owner: Platform (deploy pipeline)
Related: `docs/agent-memory/ecs-express-rollout-latency.md`, `docs/specs/uat-environment-spec.md`

## 1. Problem

Deploys are slow at both UAT and production, and the time is NOT in build/test:

Measured baseline (UAT run `30529628323`, 2026-07-30, validation-reuse path, commit `45c46785`):

| Stage | Wall clock |
|---|---|
| Resolve + validate config | ~20 s |
| Publish 3 images to ECR (parallel matrix, warm GHA cache) | ~2.5 min |
| Typecheck/test | skipped (reused push CI, ~6 min in its own run) |
| Deploy job (`Deploy UAT/all`) | **34 m 09 s** |
| — of which `deploy.sh all` | **30 m 22 s** = 3 sequential ECS Express managed canary rollouts (~10 min each) |

The ~10 min per rollout is the AWS-managed Express Mode canary + rollback
completion gate. It is not tunable and the team decision (see
`ecs-express-rollout-latency.md`) is to KEEP the gate. Therefore the levers are
**how many rollouts run and whether they run concurrently**, not shortening a
rollout.

Production is additionally slow because `deploy-production.yml` re-runs the full
`ci.yml` (tests + image rebuilds; GHA cache does not cross branches) even though
the UAT-validated immutable digests already exist in the same ECR repositories
(`watchdog-bms-api`, `watchdog-bms-ai-gateway`, `watchdog-bms-workers` — no
stage prefix).

## 2. Goals

- G1: Steady-state UAT `all` deploy job completes in ≤ ~15 min (one wave of 3
  concurrent managed rollouts) while retaining every per-service canary gate.
- G2: Production `all` completes in ≤ ~25 min using two waves (api-web gate
  first, then ai-gateway ∥ workers).
- G3: Production can deploy the **byte-identical** images UAT validated, without
  re-running tests or rebuilding images (promotion path).
- G4: No change to the safety posture: canary + rollback gate per service,
  cosign identity verification, manifest digest validation, release-task
  migration gate, config-preserve step all remain.

## 3. Non-goals / follow-up scope

- Automatic single-service UAT rollout is defined separately in
  `docs/specs/uat-fast-selective-deployment-spec.md`. It deliberately keeps the
  three-image manifest contract and requires a later explicit all-target UAT
  acceptance before Production, so no per-service Production manifest schema is
  introduced.
- Publishing the release-task image from CI in the manifest (today rebuilt in
  every deploy job).
- Trimming legacy `web` / `web-lambda` entries from the `ci.yml` docker-build
  matrix (only bite on the no-reuse path).
- Splitting the repository. Rejected: the dominant cost (managed bake ×
  serialization) is independent of repo layout; images/targets/manifest are
  already per-service; a split would add contracts+Prisma cross-repo
  versioning, duplicated cosign/SBOM plumbing, and api+web ship in ONE image.

## 4. Design — Phase A: wave rollouts in `deploy.sh all`

### 4.1 Wave-mode preconditions

`infra/prod-ecs-express/deploy.sh` target `all` runs in wave mode only when ALL
hold. Its readiness result is a closed contract: status `0` starts the wave,
status `1` alone selects the intentional sequential bootstrap path, and every
other status aborts while preserving that status before either deployment writer
starts, with no deployment mutation. An AWS/SSM read failure is never a bootstrap signal:

- `PRODUCTION_IMAGE_MANIFEST` is set (CI path — no docker builds inside the
  deploy functions; the manifest-less workstation path stays sequential).
- `ECS_EXPRESS_SUBNET_MODE` is not `private` (already an error for `all`).
- Steady state: these SSM params are all non-empty —
  `${PARAM_PREFIX}/ecs-express-api-web-service-arn`,
  `${PARAM_PREFIX}/ecs-express-api-web-url`,
  `${PARAM_PREFIX}/ecs-express-ai-gateway-service-arn`,
  `${PARAM_PREFIX}/ai-gateway-internal-url`,
  `${PARAM_PREFIX}/ecs-express-workers-service-arn`.
  (Bootstrap environments miss these and must keep the sequential ordering,
  including the two-phase api-web URL dance.)

### 4.2 Wave grouping

- `DEPLOY_ENV=uat` → one wave: `api-web ai-gateway workers` (3 concurrent).
- `DEPLOY_ENV=production` → wave 1: `api-web`; wave 2: `ai-gateway workers`.
  Rationale: api-web is the user-facing gate; if its canary rolls back, nothing
  else moves. Wave 2 skew (new gateway/workers against rolled-back old api) is
  bounded by the same N/N-1 compatibility discipline the pipeline already
  imposes (migrations run before rollouts; old+new tasks share the DB during
  every bake).
- Both environments run the SAME wave-runner code; only the grouping data
  differs, so UAT exercises the mechanism used in production.

### 4.3 Wave runner requirements

New sourceable helper `infra/prod-ecs-express/lib-rollout-waves.sh` (pure
functions, no top-level side effects, bash 3.2 compatible — no `wait -n`):

- `run_rollout_wave <service>...` launches each `deploy_<service>` as a
  background job.
- Live-streams each job's stdout+stderr prefixed `[wave:<service>] ` (Actions
  logs must stay live during 10-min bakes, and a failed service must be
  identifiable from the log).
- Waits for ALL jobs in the wave to reach a terminal state — never kills
  siblings (the managed ECS deployment continues server-side regardless;
  killing only blinds us).
- Aggregates exit codes: returns non-zero if any job failed and names every
  failed service.
- A failed wave skips all subsequent waves and the drift guard; the script
  exits non-zero.

### 4.4 One-shot common ensures (race removal)

`preflight`, `ensure_ecs_roles`, `ensure_cluster` are currently called inside
each `deploy_*` function, and `ensure_ecs_roles` writes SHARED temp files
(`/tmp/watchdog-bms-ecs-execution-policy.json`, `…-api-task-policy.json`,
`…-ai-task-policy.json`) then feeds them to `aws iam put-role-policy` —
concurrent invocation is a torn-file race. In wave mode these three MUST run
exactly once before the first wave; the per-function calls become no-ops via a
guard (e.g. export `WATCHDOG_COMMON_ENSURED=1` after the one-shot run and
return early inside the three functions when set — subshells inherit env).
The guard must not depend on `ECS_DEPLOY_MANAGE_IAM=false`.

### 4.5 Endpoint-drift guard (kept)

As today: capture `${PARAM_PREFIX}/ai-gateway-internal-url` before the waves;
after all waves succeed, if it changed (expected never in steady state), run one
sequential `deploy_api_web` refresh.

### 4.6 Unchanged behavior

Single-service targets (`api-web`, `ai-gateway`, `workers`, `s3-cors`),
bootstrap ordering, the manifest-less workstation path, and every per-service
canary/rollback gate are unchanged. Per-service `put_param` writes and the
api-web-only S3 steps run inside their own service's job as today.

Shared mutable state across services (correction, found during
implementation): besides the ensures covered in §4.4,
`deploy_express_service` wrote its ECS create/update request payloads to
SHARED files (`/tmp/watchdog-bms-ecs-express-{create,update}.json`) before
feeding them to `aws ecs …-express-gateway-service --cli-input-json`. Run
concurrently, a torn write there can deploy one service's container
definition into another service — worse than the §4.4 IAM race. These files
MUST be (and now are) per service. The per-service container JSONs
(`/tmp/watchdog-bms-ecs-<service>-container.json`) were already distinct.

### 4.7 Durable service intent and Bash failure boundaries

- Every remote ECS create/update has one durable service-scoped intent committed
  before the AWS call. `target=all` requires terminal evidence for exactly
  `api-web`, `ai-gateway`, and `workers`; a single-service target requires that
  service. Zero OPEN intents is not sufficient when a required service is
  missing. Finalization/reconciliation remains blocked until coverage is exact.
- `legacyBootstrapDescriptor` is valid only for the historical api-web
  first-cutover shape. A normal AI Gateway or workers intent carrying it is
  rejected before any remote mutation.
- `release-intent` and `release-bind` are short row-locked metadata siblings and
  may run concurrently in one wave; they are not detached writers. Every other
  release/F2/retirement/recovery task remains protected by the environment
  writer fence and detached-task check.
- The three metadata siblings share one ECS task-definition family. ECS may
  transiently reject simultaneous `RegisterTaskDefinition` calls with the exact
  concurrent-revision `ClientException`. Registration therefore retries only
  that exact provider response with a bounded backoff before `RunTask`; every
  other error fails immediately and exhaustion fails the wave. A retry never
  repeats the service create/update, closes an intent, or starts more than the
  one metadata task whose registration eventually succeeds.
- A pre-deploy release task deliberately leaves its parent `RUNNING` under a
  90-minute rollout hold while the GitHub controller performs service waves. A
  failed controller must not make an operator wait for that hold to age out when
  the exact lease-owning ECS task is already terminal. Only the signed exact
  recovery workflow, serialized in the same environment deploy concurrency
  group, may reclaim such a live hold early. Before launching the signed recovery
  executor, that controller performs two stable `DescribeTasks` reads proving the
  exact supplied environment parent task is `STOPPED` and passes only the
  canonical evidence. The executor validates it, then row-locks and requires
  `leaseOwner == ecsTaskArn == evidence.taskArn`, the same release/build and a
  still-`RUNNING` parent before changing it to `UNKNOWN` and appending a CRITICAL
  audit entry. A finalizer-owned, running, missing, malformed, moving or different
  task blocks; ordinary release/F2/retirement/reconciliation paths cannot use this
  exception. The fenced task role gains no new ECS permission and no database lock
  is held across either AWS read.
- Bash 3.2 `errexit` is not trusted across command substitution, pipelines, or
  functions called from a conditional context. Intent preparation, AWS
  mutation, causal binding, stable wait, SSM write, and evidence binding each
  propagate a non-zero status explicitly. Failed intent preparation produces
  zero service mutation. A bind failure after the service mutation produces no
  later SSM/service mutation, leaves that exact intent OPEN, fails the wave and
  requires exact intent recovery; finalization/retirement cannot infer success
  from a healthy provider service.
- An SSM service parameter is absent only after an exact `ParameterNotFound`.
  AccessDenied, expired credentials, transport errors, or malformed output stop
  before classifying the operation as CREATE.
- CREATE recovery may fill only the absent intent-owned SSM cache with
  `Overwrite:false`; recovery never overwrites an existing value. A concurrent
  `ParameterAlreadyExists` is idempotent only when two subsequent exact reads
  both equal the intended service ARN. A different or moving value blocks.
- Recovery replay always re-reads the live parent/platform state. A closed intent
  may replay only when its stored terminal status and deployment evidence exactly
  equal the fresh decision. PRE_INTENT may replay only when the stored cleanup
  marker canonically equals the fresh platform evidence. Any mismatch blocks;
  stored success alone is not authority.
- A successful `api-web` legacy first-cutover intent is not resolved merely because
  it is `BOUND`. Parent terminalization and manual reconciliation both remain
  blocked while its `legacyBootstrapDescriptorJson` is present, rollback was not
  observed, and `legacyCutoverCompletedAt` is null. Exact intent recovery must
  re-prove the serving deployment, run launch-build retirement so superseded
  authority is removed, and only then persist `legacyCutoverCompletedAt`. A failed
  retirement cannot be skipped by recovering another intent or by manual reconcile.
- When one parent contains multiple api-web intents/deployments, the recovery target
  is the latest successful, non-no-op `BOUND` api-web intent. After its exact
  retirement succeeds, the same transaction records cutover completion on that row
  and every earlier successful legacy `BOUND` row with the same environment, build,
  and parent; any row with rollback observed is excluded. This grouping does not
  weaken platform evidence: attempting to recover a superseded intent still rejects
  an unexpected later deployment rather than treating it as implicitly covered.
- For every non-terminal intent recovery, exact in-task SSM proof (including any
  create-only repair and its confirming reads) completes before the recovered intent
  is durably closed as `BOUND`/`CONFIRMED_NO_MUTATION` and before a
  cleanup/retirement child starts. The durable rollback-cleanup or cutover marker is
  written only after both SSM proof and that child succeed. A closed recovered intent
  therefore implies exact SSM proof/repair; a cleanup marker additionally implies its
  child succeeded. Terminal replay is different: it performs fresh two-read
  platform/SSM validation and remains read-only; it never repairs SSM, launches
  cleanup, or backfills a marker.
- Retained stopped-task evidence remains the default authority for bounded ORPHAN
  recovery. ECS stopped-task retention is not guaranteed, so the only expired-task
  exception is the reviewed UAT incident parent
  `bf131086-6055-4143-a77c-579bc7d58b57` for
  `watchdog-bms-uat-ai-gateway`. It is eligible only when `DescribeTasks` returns
  zero tasks and exactly three `MISSING` failures for the supplied parent, intent,
  and binder ARNs; a partial retained/missing set is rejected.
- That exception reads
  `infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json`, whose
  exact byte SHA-256
  `f152c3da1b7d6cb54d1d51b6714f8028fb2c43f8dd324efbc829142906fc7cfb`
  is pinned in the neutral `main` recovery workflow. The committed record is not
  sufficient by itself: recovery must revalidate the three exact live task-definition
  registrations, shapes, environment, shared signed image and OCI revision; each
  exact CloudWatch timestamp/message; deployment chronology; and the same current
  two-read service/deployment-history/network/SSM proof used by retained-task
  recovery. Reviewed CloudTrail RunTask event IDs are corroborating audit metadata,
  not live authority, because the deploy role has no `LookupEvents` permission.
  There is no production or generic expired-task fallback.

### 4.8 Settled ECS Express identity

`currentDeployment` is an optional corroborating pointer, not the authority.
For a non-no-op rollout, a non-null value must equal the exact bound deployment.
Null is accepted only when all of the following agree across two bounded reads:

1. the bound deployment is `SUCCESSFUL` and belongs to the exact service and
   target revision;
2. the service is `ACTIVE` with exactly one active configuration/revision, which
   is the bound target and carries the full release SHA;
3. `ListServiceDeployments(maxResults=100)` is unpaginated and unchanged, and
   the bound deployment is the unique newest record (including no equal-time
   ambiguity); and
4. the runtime configuration and SSM service identity remain exact.

Moving reads, multiple active configurations, pagination, malformed timestamps,
another non-null pointer, or a later deployment leave the state unknown. The
same rule applies before retirement, F2 mutation, and bounded recovery. No-op
proof compares the same exhaustive bounded deployment set before/after and
rejects pagination.

The F2 serving-build preflight compares the complete canonical deployment evidence
across both reads: the full `DescribeServiceDeployments` response when the pointer
exists, or the full exhaustive unpaginated deployment history when it does not.
Comparing only the selected newest row is insufficient because the history can move
while the selected winner remains unchanged. Pagination, equal-time newest ties,
or any movement between reads fail closed.

### 4.9 Runtime configuration hash contract

`RuntimeConfigHashV1` is the SHA-256 of compact canonical JSON using raw Unicode
codepoint key ordering plus the trailing newline emitted by `jq -cS`. Arrays
whose order is not semantic are sorted before hashing. Raw active configuration
hashes are retained separately for rollback evidence; desired matching uses the
requested configuration.

ECS Express may append one managed security group. It is removed from desired
matching only after the controller proves that the active set is the one fixed
environment/service egress group plus at most one group in the same VPC whose
description is exactly `Security group for ECS service: <exact service ARN>`.
Trying arbitrary subsets, accepting an extra group, a wrong description, or a
lookalike group is forbidden.

## 5. Design — Phase B: production promotion

### 5.1 Operator contract

`deploy-production.yml` gains an optional `workflow_dispatch` input
`promote_from_run_id` (string, default `''`): the run ID of a **successful UAT
Deploy run** whose `build_and_publish` published the immutable manifest for the
same commit.

- `release_ref` must resolve (existing rules: `release-*` tag or full SHA,
  ancestor of `origin/main`) to the SAME commit the UAT run validated. Promote
  the exact UAT-validated commit SHA (or a `release-*` tag pointing at it) —
  ancestry, not fast-forward, is the requirement, so a merge commit on `main`
  is fine as long as the promoted SHA itself is passed, never the merge commit.
- Empty input = current behavior (full `ci.yml` build), unchanged.

### 5.2 Workflow mechanics

When `promote_from_run_id` is set:

- `build_and_publish` is skipped: `if: inputs.promote_from_run_id == ''`.
- `deploy` job condition handles the skipped dependency:
  `always() && needs.resolve-release.result == 'success' &&
  (needs.build_and_publish.result == 'success' ||
  (inputs.promote_from_run_id != '' && needs.build_and_publish.result == 'skipped'))`.
- Artifact download: same pinned `actions/download-artifact`, with
  `name: production-release-${{ needs.resolve-release.outputs.source_sha }}`
  computed inline (the `needs.build_and_publish.outputs.release_artifact`
  expression is empty when skipped), plus `run-id: <input>` and
  `github-token: ${{ github.token }}` for the cross-run download (deploy job
  already holds `actions: read`). If the pinned v4 hash predates the
  `run-id`/`github-token` inputs, bump the pin to a v4.1+ hash (or use
  `gh run download` with `GH_TOKEN`).
- New belt-and-braces step when promoting: assert via
  `gh api repos/$GITHUB_REPOSITORY/actions/runs/$ID` that the referenced run
  concluded `success` in this repository.
- Every substantive gate is UNCHANGED and remains the real security boundary:
  - `validate-production-manifest.sh`: manifest `sourceCommit` must equal the
    resolved main SHA, and image refs must match production's account/region
    registry (if UAT/prod registries ever diverge, promotion fails loudly).
  - `cosign verify` against the `ci.yml` workflow identity (UAT-published
    images are signed by the same reusable workflow; the certificate identity
    regexp already admits any `refs/(heads|tags)/` ref).
  - Release-task image build + revision-label check + migration release task.
  - `deploy.sh` consumes only manifest digests; `verify-deployment.sh` closes.
- Failure at any promotion step is a LOUD stop. Never silently fall back to a
  rebuild — the operator re-runs without the input to build.

### 5.3 Environment assumptions

UAT and production share one AWS account and the unprefixed ECR repositories
today; manifest validation enforces this at deploy time rather than assuming it.

### 5.4 Minimum-capacity availability invariant

Every user-facing API, AI Gateway and workers ECS Express service must have
`scalingTarget.minTaskCount >= 1`. CPU target tracking cannot recover a service from zero running
tasks because there is no task producing the metric that would request scale-out. Therefore an
outer ECS service status of `ACTIVE`, an `ACTIVE` load balancer or an `ACTIVE` target group is not
health evidence by itself.

Production preflight must bind the exact service ARN, active service revision, scaling target,
running task set, target-group health and HTTP health result. It fails closed when the minimum is
zero, no task is running, a target is unhealthy, or the exact health endpoint is not successful.

The one-time recovery from a legacy `minTaskCount=0` state is a separate, bounded incident action:

- read and preserve the complete active service configuration;
- change only `minTaskCount` from `0` to `1` for the three exact production service ARNs;
- keep image digests, task definitions, environment, secrets, network, CPU/memory, maximum count
  and scaling metric/target byte-equivalent;
- wait for one stable active revision, running/healthy targets and application health; and
- record before/after evidence and stop on any unexpected concurrent revision or configuration
  difference.

The recovery plan is authoritative only when its embedded canonical SHA-256 equals the explicit
apply input. Apply re-proves all three planned service and immutable revision snapshots before the
first write. It may observe the exact bounded transitional deployment returned by its update while
waiting, but accepts only the final stable singleton revision. Final health binds each RUNNING task's
private IP to the complete healthy target set and binds the probed SSM URL to that revision's active
public ingress endpoint. Replaying a fresh plan at an already healthy `minTaskCount=1` state performs
no update and only re-verifies the same health contract.

This recovery does not run migrations, deploy an application image, change an entitlement/route,
or count as production promotion. A later ordinary deploy still has to pass every signed release
gate. The production controller continues to render `minTaskCount: 1`, so the recovered invariant
does not drift back on the next rollout.

## 6. Acceptance criteria

- A1: Steady-state UAT `all`: deploy job shows three concurrent
  `[wave:*]` rollouts, completes ≤ ~15 min, `verify-deployment.sh` passes,
  public smoke (API health 200, web root 302) passes.
- A2: Production `all` via promotion: zero `ci.yml` jobs execute; two waves;
  deployed active digests are byte-equal to the UAT manifest digests;
  total deploy job ≤ ~25 min.
- A3: Injected canary failure in one service of a UAT wave → job exits
  non-zero, the sibling services still reach a terminal state, and the log
  names the failed service. (Evidence may come from the wave-runner spec
  stubs rather than a live broken deploy.)
- A4: Bootstrap-shaped environment (missing steady-state params) still deploys
  via the sequential legacy path.
- A5: `infra/prod-ecs-express/rollout-waves.spec.sh` passes (stubbed
  `deploy_*`: all-success, one-fails, sibling-completes, prefixing, wave
  ordering).
- A6: `promote_from_run_id=''` production runs are byte-identical in behavior
  to today's workflow.
- A7: A failed service-intent preparation stops before the service mutation. A
  post-mutation bind failure stops before SSM or any later service mutation,
  leaves the exact intent OPEN, fails the wave and blocks finalization until
  exact recovery. Concurrent sibling metadata tasks do not trigger false
  detached-task recovery.
- A8: `currentDeployment=null` passes only for the stable singleton, unique
  newest bound deployment. Non-null mismatch, dual active state, moving reads,
  malformed/paginated history, or a newer deployment fails closed.
- A9: An `all` finalizer with fewer than API/AI/workers service intents is
  rejected, and non-api legacy bootstrap evidence is rejected.
- A10: Cross-language hash fixtures prove codepoint ordering, trailing newline,
  requested-SG matching, and rejection of managed-SG spoof/extra cases.
- A11: Wave readiness status `0` invokes exactly the wave writer, status `1`
  invokes exactly the sequential bootstrap writer, and every other status invokes
  neither writer, performs no deployment mutation and preserves the failure.
- A12: Recovery tests prove SSM repair is create-only/no-overwrite, a concurrent
  existing value passes only after two exact equal reads, and both closed-intent
  and PRE_INTENT replay reject fresh evidence that differs from stored evidence.
- A13: When the recovery suite is given an explicit `DATABASE_URL`, connection,
  schema and setup failures fail the suite and real-PostgreSQL cases may not skip.
  Only a developer invocation without an explicit URL may skip when no local
  PostgreSQL server is reachable.
- A14: Retained-task recovery remains the default. The reviewed expired-task path
  accepts only the three exact `MISSING` ARNs for UAT parent
  `bf131086-6055-4143-a77c-579bc7d58b57` and its AI service, validates the pinned
  manifest plus exact live task definitions/logs/image/chronology and current
  two-read platform evidence, rejects partial expiry, and has no production path.
- A15: Serving-build fixtures prove that both reads compare complete canonical
  deployment evidence/history and reject pagination, equal-time newest ties, and
  movement between reads.
- A16: A successful legacy `api-web` BOUND intent with no durable
  `legacyCutoverCompletedAt` blocks both automatic parent terminalization and manual
  reconciliation. Recovery retires superseded launch authority before persisting
  the cutover marker; only the durable marker (or complete rollback cleanup) removes
  this blocker.
- A17: For a parent with multiple api-web deployments, recovery selects the latest
  successful non-no-op BOUND intent. Successful retirement marks the matching
  earlier successful legacy BOUND rows of the same environment/build/parent, excludes
  rollback-observed rows, and never permits unexpected-later evidence while directly
  recovering a superseded intent.
- A18: Failure of in-task SSM proof/repair occurs before recovered-intent closure and
  before any cleanup child or marker. A closed recovered intent proves SSM validation;
  a cleanup/cutover marker additionally proves successful cleanup. Terminal replay
  repeats fresh two-read validation without any mutation.
- A19: An executable AWS stub makes the first two task-definition registrations
  fail with the exact concurrent-revision `ClientException` and the third pass;
  exactly three registrations and one `RunTask` occur. A different registration
  error is attempted once, launches no task and remains non-zero.
- A20: Real-PostgreSQL recovery coverage proves that an unexpired rollout hold can
  become `UNKNOWN` only with canonical two-read `STOPPED` evidence when
  `leaseOwner == ecsTaskArn == evidence.taskArn` for the exact release/build.
  `RUNNING`, missing, moving, wrong-environment/wrong-owner or finalizer-owned
  evidence remains blocked and performs no intent closure. Static tests require
  recovery/deploy to share the non-cancelling environment concurrency group and
  keep `DescribeTasks` in the GitHub controller rather than expanding the fenced
  task role.
- A21: Production preflight rejects `minTaskCount=0`, zero running tasks, unhealthy exact targets,
  or a non-successful application health probe even when ECS reports the service `ACTIVE`.
- A22: The bounded legacy-capacity recovery changes only the three exact services' minimum from
  zero to one, proves all other canonical configuration fields unchanged, and records healthy
  running targets before any feature-entitlement production workflow may continue.

## 7. Risks and mitigations

- Log interleaving during waves → mandatory `[wave:<service>]` prefixes.
- IAM policy temp-file race → one-shot common ensures (4.4).
- Wave 2 partial failure leaves version skew for the failed service until
  re-run → same exposure as today's mid-`all` failure; per-service targets
  exist for incident repair.
- Artifact retention (90 days) or wrong `promote_from_run_id` → loud validation
  failure; operator falls back to the full-build path.
- Credential lifetime: waves shorten wall clock, moving further inside the
  single 1-hour assumed session the workflow standardized on.
- Optional platform pointers or provider-managed network fields can look like
  drift → use the exact settled-identity and proved managed-SG rules above;
  never guess.
- Bash status suppression or missing service intent can leave a successful
  remote mutation without durable evidence → explicit status propagation plus
  exact target-service coverage blocks finalization and requires bounded
  recovery.
- Concurrent metadata tasks can contend on their shared ECS task-definition
  family → retry only the exact transient registration collision before task
  launch, with a finite bound; permanent errors and exhaustion remain loud and
  leave the durable intent recoverable.
- A failed GitHub rollout can leave a valid 90-minute parent hold after its lease
  task has stopped → exact recovery proves the unchanged lease owner `STOPPED`
  twice and reclaims only that parent; never shorten the global hold or let a
  generic writer bypass it.
- ECS may expire stopped-task records before an incident is reconciled → recover
  while retained evidence exists; for this already-expired UAT incident use only
  the byte-pinned reviewed manifest plus fresh independent live proof above. Any
  future expired incident needs a separate reviewed evidence contract, never an
  inferred reuse of this exception.
