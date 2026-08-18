# Deploy Time Reduction Spec (UAT + Production ≤ 10 minutes each)

Status: Proposed — evidence-gathered, awaiting phase-1 implementation
Owner: Platform / release owner
Related: `docs/specs/uat-fast-selective-deployment-spec.md`,
`docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`,
`docs/runbooks/uat-production-v2-deployment.md`,
`docs/plans/deploy-time-reduction-plan.md`

## 1. Problem, with measured evidence

Every number below is read from real GitHub Actions runs (job/step `started_at`/
`completed_at`), not estimated. Reference runs:

| Run | What | Wall clock |
| --- | --- | --- |
| UAT `31901904745` (2026-08-15, CI-reuse path) | `Deploy 3c8de87… → UAT/all`, success | 22m02s |
| UAT `31816168613` (2026-08-14, full-CI path) | `Deploy 51af1be… → UAT/all`, success | 31m56s |
| READY `31903027707` | Production Readiness V2, success | 6m12s |
| Prod `31903336753` (live promote) | `Promote READY 31903027707 → live`, success | 38m28s |
| Prod `31897008213` (failed live promote) | close + failed rollout + recovery | 1h30m01s |

### 1.1 UAT step breakdown (run `31901904745`, deploy job 15m24s)

| Step | Duration | Classification |
| --- | --- | --- |
| build_and_publish reusable CI (publish images + tools) | 5m24s | moveable off critical path |
| Verify and run UAT release task (one-off Fargate) | 199s | Fargate cold start dominated |
| Deploy immutable UAT manifest (3-service wave, zero bake) | 476s | ECS mechanics floor |
| Verify active UAT digest and health | 15s | keep |
| Retire superseded launch builds (second Fargate task) | 172s | Fargate cold start dominated |
| Sign acceptance + Passport | ~5s | keep |

On the full-CI path (`31816168613`) `Typecheck and Test` adds 10m15s serially
before publish. The candidate-selection rule in
`docs/runbooks/uat-production-v2-deployment.md` §Protocol item 1 (use exact
reviewed PR-head SHA so CI is reused) already avoids this; this spec does not
change it.

### 1.2 Production step breakdown (run `31903336753`, promote job 38m19s)

| Step | Duration | Classification |
| --- | --- | --- |
| Recheck image availability + runtime baseline | 128s | duplicate of READY, minutes older |
| Recheck service, IAM and migration baselines | 165s | duplicate of READY, minutes older |
| Recheck stable service identity at mutation boundary | 44s | keep (mutation gate) |
| Recheck signed READY migration authority in DB fence (Fargate) | 169s | Fargate cold start dominated |
| Roll out the exact UAT image digests | 1575s (26m15s) | dominated by bake × 2 serial waves |
| Verify digest/source/serving/health/deep DB | 16s | keep |
| Retire/reconcile + finalize durable release (Fargate) | 174s | Fargate cold start dominated |
| Build/validate/sign Release Result V2 | 2s | keep |

### 1.3 Why the production rollout is 26 minutes

- Production deploys in **two serial waves** (`api-web`, then
  `ai-gateway workers`) per
  `docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md` §4.2, so
  per-service fixed delays are paid twice.
- Each service uses the managed ECS `CANARY` strategy with a canary bake and a
  post-shift bake. UAT already forces both bake values to 0 via
  `infra/prod-ecs-express/lib-uat-fast-rollout.sh` (guard: `DEPLOY_ENV = uat`);
  production keeps its live values. `docs/runbooks/production-golive-aws-commands.md`
  documents a 3-minute canary bake;
  `docs/specs/uat-fast-selective-deployment-spec.md` records UAT's pre-change
  values as 3+3 per service.
- Arithmetic cross-check: UAT's zero-bake 3-service wave costs 476s of pure ECS
  mechanics. 2 prod waves × (~7m mechanics + ~6m bake) ≈ 26m — matches the
  observed 1575s. A 5+5 configuration would predict ~33m and is excluded by the
  observation.
- The failed promote (`31897008213`) shows the same fixed costs multiply on the
  failure path: close-to-maintenance rollout 23m15s, failed candidate rollout
  25m23s, recovery rollout 26m48s.

### 1.4 The two Fargate one-off tasks

Each environment pays two one-off Fargate task executions per release
(pre-rollout release/migration fence, post-rollout retire/finalize):
199s+172s (UAT), 169s+174s (production) — ~6 minutes per environment for
seconds of actual DB work. The task runs the full `watchdog-bms-api` image;
timing is dominated by Fargate provisioning + image pull. (Exact split is a
VERIFY-FIRST measurement in phase 2 — the run logs of
`infra/prod-ecs-express/run-release-task.sh` record task state transitions.)

## 2. Goal

- UAT `all` dispatch → signed Passport in **≤ 10 minutes**.
- Production promote dispatch → signed `PROMOTED_*` result in **≤ 10 minutes**.
- Explicit non-goal: merge-to-production-live under 10 minutes total. The
  UAT-gate model (production deploys only exact UAT-signed digests,
  runbook §Protocol item 4) is retained; the full chain floor is ~18–20m.

Targets by phase (successful-path, CI-reuse candidate):

| Phase | UAT | Prod promote (live) | Mechanism |
| --- | --- | --- | --- |
| today | 22m | 38m (+6m READY) | — |
| 1 | ~20m | ~24–26m | bake policy + poll tuning |
| 2 | ~9–10m redeploy / ~14–15m first dispatch | ~19–21m | publish reuse + fence/retire latency (§5.2 rejected — see there) |
| 3 | ~9–10m | **~9–11m** | READY folded into promote, dedup rechecks |

## 3. Invariants that must not change (all phases)

1. Production mutates only exact UAT-signed immutable digests; no rebuild
   (runbook §Protocol 4).
2. Migration gate runs before rollout; durable release-operation
   fence/bind/finalize semantics unchanged (`run-release-task.sh` contract).
3. Post-rollout digest/source/serving-mode/health/deep-DB verification
   unchanged (`verify-deployment.sh`).
4. `CANARY` strategy, `canaryPercent=5`, rollback alarms wired+enabled, circuit
   breaker enabled — all retained in every environment
   (`validate_uat_fast_rollout_snapshot` shape). Only bake **minutes** change.
5. Signed artifacts (Passport, READY, Result) keep schema, signing identity,
   and validators; maintenance release pins stay in sync
   (`node infra/security/sync-production-maintenance-release-pins.mjs --check`,
   `bash infra/docker/production-image-security.spec.sh`).
6. Customer gate semantics (stage E of the runbook) unchanged.

## 4. Phase 1 — production bake policy + poll cadence (config-scope)

### 4.1 Mode-aware production bake values

Extend the reviewed UAT pattern (`lib-uat-fast-rollout.sh`) with a production
equivalent applied at the same call sites
(`ensure_*` before `update-express-gateway-service`, `verify_*` after
`wait_for_service_url`):

- `requested_serving_mode ∈ {maintenance_closed, maintenance_only}` (no
  customer traffic; the rollback alarm has nothing real to observe):
  `canaryBakeTimeInMinutes=0`, `bakeTimeInMinutes=0`.
- `requested_serving_mode = live`: `canaryBakeTimeInMinutes=0`,
  `bakeTimeInMinutes=3` (unchanged post-shift window at 100% traffic —
  the only window with real detection power at current traffic volume).
- Same fail-closed shape validation as UAT before any timing change
  (single PRIMARY deployment, `rolloutState=COMPLETED`, CANARY strategy,
  alarms+circuit breaker enabled), and post-deploy verify that the
  configuration persisted.

Evidence basis:
- PRECEDENT: identical mechanism runs in UAT on every deploy today
  (`ensure_uat_fast_rollout_configuration`), including the
  `ecs update-service --deployment-configuration` write path and
  `services-stable` convergence wait.
- MEASURED: bake is the only difference between UAT's 476s wave and
  production's ~13m/wave (see §1.3).
- MEASURED (live read-back 2026-08-17, read-only, profile `watchdog-bedrock`):
  all three production services report `strategy=CANARY`, `canaryPercent=5`,
  `canaryBakeTimeInMinutes=3`, `bakeTimeInMinutes=3`, alarms
  `rollback:true,enable:true`, circuit breaker
  `enable:true,rollback:true,resetOnHealthyTask:true,BOUNDED_PERCENT 50`,
  `rolloutState=COMPLETED`. Each `RollbackAlarm` is an ELB target-group
  error-rate expression (4XX+5XX vs RequestCountPerTarget), `Period=60`,
  `EvaluationPeriods=3`, `DatapointsToAlarm=2`, `threshold >1`,
  `TreatMissingData=notBreaching`. Consequences: (a) the alarm needs ≥2
  breaching one-minute datapoints, so 3 minutes is the MINIMUM meaningful bake
  — the retained live post-shift value must not go lower; (b) the alarm reads
  whole-target-group metrics and stays armed through the post-shift bake, so
  zeroing the canary bake removes no detection the alarm could actually
  deliver during a 5% window; (c) `notBreaching` on missing data means
  zero-traffic maintenance windows cannot false-fire, confirming
  maintenance-mode bake=0 is safe.

Expected effect: closed promotes lose ~12m of fixed bake; live promotes lose
~6m (the two canary bakes) and keep 2×3m post-shift.

### 4.2 Poll cadence

`infra/prod-ecs-express/lib-wait-for-service-url.sh` polls every fixed 20s and
`deploy-production-v2.yml` sets `DEPLOYMENT_POLL_ATTEMPTS: 75` (25m ceiling per
service). Change to a 5s interval for the first 2 minutes, then 15s
(state transitions cluster at rollout start/end; the long middle is
bake/drain), keeping the wall-clock ceiling ≥ the longest legitimate rollout
(recompute `DEPLOYMENT_POLL_ATTEMPTS` so interval×attempts stays ≥ 25m for
production, ≥ 12m for UAT). MEASURED effect is small (~30–60s/wave tail
latency); the real reason is faster terminal detection on failure. Risk: AWS
API rate — describe calls are per-service serial; 5s×3 concurrent services is
well inside ECS DescribeServiceDeployments limits.

### 4.3 Explicitly rejected in phase 1

- Zeroing the live post-shift bake (kills the only meaningful auto-rollback
  window; team's own history — `production-first-launch-path-b-decision.md` —
  shows post-deploy detection is the weak point).
- Collapsing the two production waves (owner-reviewed gating rationale in wave
  spec §4.2; revisit only with phase-3 evidence in hand).

## 5. Phase 2 — take builds and Fargate cold starts off the critical path

### 5.1 Publish reuse (UAT)

Today `build_and_publish` republished images inside every UAT run (5m24s on
run `31901904745`) even when CI validation was reused and the exact SHA's
images already exist in ECR with cosign signatures. Add a publish-reuse gate
mirroring the existing CI-validation-reuse gate
(`deploy-uat.yml` step `Reuse exact successful CI validation when safe`):

- Reuse condition: for the exact `source_sha`, all five artifacts (3 runtime
  images, `release-task`, `migration-tool`) exist in ECR **by digest recorded
  in a prior successful run's manifest**, each digest cosign-verifies against
  the `ci.yml` identity, and the stored manifest validates with
  `validate-production-manifest.sh`. Anything less → full publish (fail-open
  to the slow path, never to a weaker check).
- The deploy job already independently cosign-verifies every digest it
  deploys (steps `Verify release image signatures`, `Verify pre-published
  release tools`) — the verification surface after this change is identical.
- PRECEDENT: production already consumes previously-built digests without
  rebuilding (the entire promote path); this extends the same trust decision
  to UAT re-deploys of an already-published SHA.
- Effect: second-and-later UAT runs of a SHA (the common retry/verify case),
  and every run after a merge-triggered publish (below), skip ~5m.

### 5.2 Publish on merge to develop — REJECTED (2026-08-18, evidence-based)

Implementation investigation proved this incompatible with the repo's trust
model on three independent grounds, any one of which is disqualifying:

1. The `uat` GitHub environment's deployment branch policy allows `main` only
   (`GET /environments/uat/deployment-branch-policies` → `[{name: "main"}]`);
   `ci.yml`'s publish jobs bind `environment: uat`, so a push-to-develop run
   can never assume the publisher role without widening that policy — a real
   security change, not a speedup.
2. Disqualifying even if (1) were widened: artifacts published by a
   develop-ref run sign as `ci.yml@refs/heads/develop`, while the deploy job
   pins the exact cosign identity `ci.yml@refs/heads/main`. Pre-published
   artifacts from develop can never pass verification, and calling
   `ci.yml@main` from a new workflow would reintroduce the mutable-ref pattern
   the security spec bans.
3. `develop` advances by merge commits whose head SHA has no exact
   pull-request CI, so the trigger's reuse condition would no-op on every
   push.

Consequence: §5.1 (publish reuse) alone carries phase 2. First UAT dispatch of
a SHA still pays the ~5.5m publish leg; every subsequent UAT run of the same
SHA (retries, redeploys, verification runs) skips it. Revised targets in §2
below. The fence/retire work (§5.3) remains the path to a sub-10m first
dispatch.

### 5.3 Fence/retire task latency

VERIFY-FIRST measurement (phase-2 first task): from existing run logs of
`run-release-task.sh`, split the 169–199s into Fargate
provision/pull/execute. Then, in order of preference:

1. Run the fence/retire container from the already-published
  `migration-tool` image if its closure covers
  `release-tasks`/`retire-launch-builds` entrypoints (it is published and
  signed on every `all` release already) — smaller pull than the full app
  image.
2. If the closure does not cover it, build a dedicated slim `release-task`
  image target in the existing tools matrix (no new registry, no new signing
  path — one more entry in the current publish matrix).
3. Keep task count at two (pre-fence, post-finalize); do NOT make retirement
  async — `releaseFinalized: true` is part of the signed acceptance semantics
  (`deploy-uat.yml` step `Sign exact UAT deployment acceptance`), and an
  unresolved durable operation blocks the next release.

Expected combined phase-2 effect: UAT 20m → ~9–10m (publish leg removed,
fence+retire ~6m → ~3m). Production promote: fence+retire ~5.7m → ~3m.

## 6. Phase 3 — fold READY verification into the promote run

Today `production-readiness.yml` (6m12s) completes, then
`deploy-production-v2.yml` re-verifies overlapping ground (image availability,
service/IAM/migration baselines — 8m26s across four recheck steps) minutes
later. Fold as follows:

- `deploy-production-v2.yml` gains a leading `readiness` job that executes the
  existing readiness checks and emits the signed READY artifact **unchanged in
  schema and signing identity**, then the promote job consumes it in the same
  run. Manual `production-readiness.yml` stays for standalone use
  (controller-only re-READY, rehearsals); the promote no longer requires a
  separate prior run.
- The promote job keeps only the mutation-boundary checks that must be
  re-proven at mutation time: stable service identity (44s), READY migration
  authority inside the DB fence, and Passport expiry/baseline drift rejection.
  The two read-only recheck steps duplicated from READY (128s+165s) collapse
  into the readiness job.
- Owner-override live READY input contract (`owner_legal_override_ref`,
  actor=MangmeeDev) moves onto the combined dispatch unchanged.
- This is the highest-risk phase: it rewrites the promote workflow's signed
  chain. It requires the full pin/validator cascade
  (`sync-production-maintenance-release-pins.mjs`,
  `production-image-security.spec.sh` — 45 pinned files today) and a
  maintenance_closed rehearsal promote before any live use.

Expected effect: operator-observed production path = one dispatch, ~9–11m
(readiness ~4m parallelized against fence + digest pre-checks, rollout ~5–8m
after phases 1–2, finalize ~1.5m).

## 7. Verification protocol (every phase)

1. Local: `bash infra/prod-ecs-express/release-safety.spec.sh`,
   `bash infra/prod-ecs-express/uat-fast-rollout.spec.sh` (+ new fixtures for
   the prod config helper), `bash infra/docker/production-image-security.spec.sh`,
   `node infra/security/sync-production-maintenance-release-pins.mjs --check`,
   `git diff --check`, plus workflow YAML parse.
2. Real-run proof: one full UAT `all` + one production promote per phase using
   a real reviewed candidate, timings recorded in the release ledger and
   compared against the target table in §2. A phase that misses its target by
   >20% is investigated before the next phase lands.
3. Controller-only phases (1 and 3 when no app change is in flight) may reuse
   a valid Passport for a new READY per runbook §1 table row 2 — the cheap
   verification path.
4. Rollback per phase: every change is a revert-able controller commit;
   phase 1 additionally restores prior bake minutes by re-running the ensure
   helper with the previous values (recorded in the read-back evidence before
   first change).

## 8. Out of scope

- Repository split, ECS platform change, removing environments (rejected in
  `deploy-wave-rollout-and-prod-promotion-spec.md` §3 with rationale that
  still holds).
- Weakening any invariant in §3.
- The 15-turn production conversation acceptance and customer-gate ceremony
  (stage E) — human/owner steps, unchanged.
