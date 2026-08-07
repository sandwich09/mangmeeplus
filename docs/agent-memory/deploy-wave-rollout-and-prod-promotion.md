# Agent Memory: deploy wave rollout + production promotion

Status: held UAT release recovery is complete. Compatibility executor `60dfc12b`
passed exact CI `30772074494`; neutral `main` controller `b91fb84b` then recovered
AI → API/cutover → workers in runs `30772897816`, `30773062124`, `30773209171`,
and the last run terminalized parent `bf131086-6055-4143-a77c-579bc7d58b57`.
All three services remain ACTIVE on held SHA `605a52e2…`; a clean final-SHA UAT
deploy and acceptance/F2 evidence are next. Production deployment is not authorized.
Owner: Codex coordination session 2026-08-03
Scope: wave rollout plus the durable release-intent/recovery boundary used by
`.github/workflows/recover-release-intent.yml`, ECS Express deploy/readback scripts,
and `apps/api/prisma/run-exclusive-release-operation.ts`. UAT application source is
`develop`; `main` remains the production application source. Neutral UAT
workflow controllers are dispatched from `main` but execute an exact allowed UAT SHA.

## Historical Phase A/B record

The decisions, artifacts, verification and next-state text below preserve the
original wave/promotion checkpoint. Its old push/live statements are superseded by
the UAT incident section later in this file.

Decisions:
- Attack rollout count/serialization, NOT bake time — the ~10 min managed
  canary gate stays (prior decision in `ecs-express-rollout-latency.md`).
- UAT = one wave of 3; production = 2 waves (api-web gate first). Same runner
  code both envs; grouping is data.
- Wave mode only with PRODUCTION_IMAGE_MANIFEST + steady-state SSM params;
  bootstrap and workstation paths stay sequential.
- Production promotion downloads the UAT run's `production-release-<sha>`
  artifact; cosign + manifest validation remain the trust boundary; promotion
  failures stop loudly (no silent rebuild).
- Repo split rejected (doesn't touch dominant cost; contracts/Prisma coupling;
  api+web share one image).
- Implementation choices (this session):
  - The wave runner pairs pid to service in one space-separated string instead of
    arrays: bash 3.2 + `set -u` treat an empty indexed array as unbound.
  - Each job is `( set -o pipefail; deploy_<svc> 2>&1 | wave_prefix_stream <svc> ) &`
    so the rollout's exit status survives the prefix pipe. Prefixing is a pure-bash
    read loop because `sed -u` is GNU-only and `sed -l` is BSD-only.
  - Prefixing wraps the whole job, never the inner `$(...)` captures, so
    `deploy_express_service`'s URL result is unaffected.
  - Verified on bash 3.2: a background subshell does NOT inherit the parent's EXIT
    trap, so a finishing wave job cannot run `rm -rf "$DOCKER_CONFIG"` early.
  - The drift guard is now the shared `refresh_api_web_on_endpoint_drift` helper so
    the sequential branch keeps its exact ordering, message strings and behavior.
  - `actions/download-artifact` pin `d3f86a106a0bac45b974a628896c90dbdf5c8093` is
    v4.3.0 and already supports `run-id`/`github-token` (checked the tag list and
    `action.yml` at that exact commit) — NO pin bump needed, and no `gh run download`
    fallback. Read `src/download-artifact.ts` at that commit to confirm `findBy` is
    only set when the token input is non-empty, so the non-promotion path keeps the
    current-run download unchanged.
  - The promoted-run check asserts only `.conclusion == "success"` in this
    repository (plus a numeric-ID regex). It deliberately does NOT assert
    `.head_sha`: a UAT Deploy run's head_sha is the caller branch tip, not the
    release commit. The commit binding comes from the artifact name
    (`production-release-<source_sha>`) and `validate-production-manifest.sh`.
- Deviation from spec §4.6 (deliberate, see Open questions): §4.6 states the only
  shared state is the three ensures, but `deploy_express_service` also wrote the
  SHARED `/tmp/watchdog-bms-ecs-express-{create,update}.json` request files and then
  fed them to the aws CLI. Concurrently that lets one service deploy another
  service's container definition, so both files are now per service.
Open questions:
- None. (Spec §4.6 shared-state inventory corrected by the spec owner after this
  lane flagged it: the create/update request-file race is now recorded in the
  spec itself.)
Artifacts:
- `docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`
- `docs/plans/deploy-wave-rollout-and-prod-promotion-plan.md`
- `infra/prod-ecs-express/lib-rollout-waves.sh` (new)
- `infra/prod-ecs-express/rollout-waves.spec.sh` (new)
- `infra/prod-ecs-express/deploy.sh`
- `.github/workflows/deploy-production.yml`
- Historical commits: `b16158d6` (Phase A), `1f489034` (Phase B).
Verification:
- Baseline measured from UAT run 30529628323: deploy job 34m09s, `deploy.sh`
  step 30m22s = 3 sequential managed rollouts; publish ~2.5 min warm.
- `bash -n infra/prod-ecs-express/deploy.sh`: pass (no output).
- `bash -n infra/prod-ecs-express/lib-rollout-waves.sh`: pass (no output).
- `bash -n infra/prod-ecs-express/rollout-waves.spec.sh`: pass (no output).
- `/bin/bash infra/prod-ecs-express/rollout-waves.spec.sh` (GNU bash 3.2.57,
  macOS system bash): `rollout wave runner: pass`, 7.4 s. Covers all-success → 0,
  concurrency (two 3 s rollouts finish in < 5 s), one-fails → non-zero with the
  failed service named, the slow sibling still running to completion, `[wave:<svc>]`
  prefixes on both stdout and stderr, and declared wave order.
  `/opt/homebrew/bin/bash` does not exist on this machine, so bash 5 was not
  exercised locally (CI runners are bash 5).
- `bash infra/docker/production-image-security.spec.sh`: `production image security
  scanner: pass` (its `AI Gateway endpoint unchanged…` and workflow assertions still
  hold after both phases).
- `DEPLOY_ENV=preview bash infra/prod-ecs-express/deploy.sh all`: still exits 2.
- Service→function mapping checked against deploy.sh: `api-web→deploy_api_web`,
  `ai-gateway→deploy_ai_gateway`, `workers→deploy_workers`; no function-name
  collision between the lib and deploy.sh.
- `ruby -ryaml -e 'YAML.load_file(".github/workflows/deploy-production.yml")'`: pass.
- `git diff` review for A6: the only changes on the non-promotion path are the added
  input, the two `if:` conditions, and the artifact `name:` now computed inline —
  which evaluates to the same string `build_and_publish` outputs (ci.yml resolves
  `source_ref` with `git rev-parse HEAD` after checking out that SHA). All existing
  gate steps are untouched.
- `shellcheck` and `actionlint`: unavailable on this machine (not installed).
- At this historical checkpoint no AWS calls had been made: whether `all` entered wave
  mode against a live environment, and the two-wave production grouping. Wave-branch
  wiring is covered by inspection + the runner spec; live evidence is plan step 12.
Historical next (superseded by the incident plan below):
- Owner-gated: push, PR into `develop`, CI green (plan step 11).
- Live UAT evidence (plan step 12): dispatch UAT Deploy `all`; expect three
  concurrent `[wave:*]` streams, deploy job ≤ ~15 min vs the 34m09s baseline
  (run `30529628323`), `verify-deployment.sh` pass, API health 200 + web root 302.
- Production promotion (plan step 13) stays OWNER-GATED: `release_ref` = the
  UAT-validated SHA, `promote_from_run_id` = that UAT run ID; record that zero
  `ci.yml` jobs ran and the active digests equal the UAT manifest digests.

## UAT held-release recovery hardening — 2026-08-02

Status: code/spec/plan prepared locally; no recovery dispatch, new UAT application
deploy, F2 APPLY, or production mutation has occurred at this checkpoint.

Live incident facts:

- UAT deploy run `30760853050` targeted full SHA
  `605a52e29f67d1dea5599387dbd22919799ebfe9` and is held under parent operation
  `bf131086-6055-4143-a77c-579bc7d58b57`.
- API intent `483aa70a-5a4c-4263-98a3-27ad6635c160` is BOUND but is a successful
  legacy first-cutover whose `legacyCutoverCompletedAt` is not yet durable; it must
  be recovered to retire superseded launch authority before the parent can become
  terminal. It remains the correct recovery target because this incident has only one
  api-web intent/deployment, so it is also the latest successful non-no-op API intent.
  Workers intent `2def7974-c2e1-4c60-b270-a66389af0b8d` remains OPEN. AI was
  successfully deployed but its intent command failed before persistence because the
  historical descriptor carried an api-web-only bootstrap shape and the caller continued.
- All three UAT ECS Express services are ACTIVE singleton configurations serving
  the exact target SHA. Exact terminal deployment suffix/revision evidence is:
  API `watchdog-bms-uat-api-web/2OfhFv7VonMEeZ6sCAOk2` /
  `5109106888590170891`; AI
  `watchdog-bms-uat-ai-gateway/YY4TqbPkz3fpYVDv1Send` /
  `0322447864932317823`; workers
  `watchdog-bms-uat-workers/O64y8W5FAqV4A5Wz-xAkX` /
  `9813000027562926971`.
- The proposed AI intent id was `73bb4f20-1274-4ee0-a22a-edd6ac73b045` but was
  never persisted. The exact historical task ARNs for bounded ORPHAN recovery are:
  parent `arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/3b0a64a9d6c1465998c45f4319b05d9b`
  (task definition revision 28, release exit 0), intent
  `arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/2eaa547afc124fcaacf21fdbb0994b73`
  (revision 30, exit 75), and binder
  `arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/3aa48e9b648346a8a7b0aae286f26ba8`
  (revision 34, exit 75). Bangkok chronology: parent 01:28:51–01:30:10,
  intent 01:33:19–01:33:45, AI deployment 01:34:00, binder
  01:35:45–01:36:11. These facts are inputs to controller revalidation, not
  authority by themselves.
- Discovered impact: ECS stopped-task retention elapsed before recovery, so all
  three exact ARNs now return `MISSING`. Retained-task recovery remains the default;
  a partial retained/missing result is always rejected. The one reviewed exception
  is hard-bound to parent `bf131086-6055-4143-a77c-579bc7d58b57` and
  `watchdog-bms-uat-ai-gateway`, using committed evidence file
  `infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json`
  byte-pinned as SHA-256
  `f152c3da1b7d6cb54d1d51b6714f8028fb2c43f8dd324efbc829142906fc7cfb`
  in the neutral `main` workflow. There is no production or generic fallback.
- The generic F2 dry-run was read-only and approval-ready: 7 planned companies,
  0 failed, 0 dependency exceptions, 7 incomplete, aggregate hash
  `fb1a17f7b91f32360c6722c7d035d8821a559c9ac62c8abcf3f3a37bf603840e`.
  It is diagnostic, non-authorizing and cannot be reused for APPLY; a fresh PLAN is
  required after the fixed-SHA deploy.

Root causes and decisions:

- Every external mutation boundary now uses explicit status propagation; Bash
  conditional/command-substitution contexts may not rely on inherited `errexit`.
- Wave readiness is tri-state: `0` starts the wave, `1` alone selects the
  sequential bootstrap writer, and every other status preserves the failure and
  invokes neither writer. AWS/SSM read failure cannot masquerade as bootstrap.
- Durable target coverage is exact: `all` requires API, AI and workers intents;
  single-service releases require that exact service. Only api-web may use legacy
  bootstrap provenance. Metadata siblings `release-intent` and `release-bind` are
  not detached application operations.
- ECS Express `currentDeployment` is corroboration, not sole identity. A null
  pointer is accepted only after two stable service reads, two stable exhaustive
  unpaginated deployment-history reads, ACTIVE singleton target configuration and
  the exact bound deployment as the unique newest successful record. A mismatched
  non-null pointer, moving/paginated/malformed history, equal-time ambiguity or a
  newer deployment blocks recovery, F2 and retirement.
- Desired runtime hashes use compact canonical JSON with raw Unicode codepoint key
  ordering and the `jq -cS` trailing newline. A provider-managed security group is
  excluded only when the exact service ARN description, environment-owned requested
  group, same VPC and cardinality proof all hold.
- Recovery separates the held target SHA from a newer reviewed executor SHA. The
  executor must descend from the target and the pinned environment fix floor, be
  reachable from the environment source branch, have exact successful push CI, and
  run from its own signed digest with matching OCI revision. Production's fix floor
  remains disabled (all zero) because production recovery/deploy is out of scope.
- CREATE recovery fills only an absent intent-owned SSM cache with
  `Overwrite:false`. `ParameterAlreadyExists` is accepted only after two exact reads
  both equal the intended ARN; a different or moving value blocks without overwrite.
- Bounded `ORPHAN` recovery is limited to this historical non-api UPDATE defect. It
  normally derives facts from the three retained stopped tasks. For the exact expired
  UAT incident only, the pinned reviewed manifest supplies the historical record and
  the controller still revalidates the three exact live task-definition registrations,
  shapes, environments, shared signed image/OCI revision, exact CloudWatch
  timestamp/messages, deployment chronology, and current two-read
  deployment/network/SSM state. Reviewed CloudTrail event IDs are corroborating audit
  metadata rather than live authority because the deploy role lacks `LookupEvents`.
  It then inserts one BOUND intent plus manifest and audit atomically. This is not a
  generic missing-intent escape hatch. Replays perform fresh parent/platform/coverage
  validation before returning success. Closed-intent status/evidence and PRE_INTENT
  cleanup evidence must exactly match the fresh decision; mismatch blocks.
- `verify-serving-api-build.sh` now compares complete canonical deployment evidence
  across the two reads: the full described deployment when a current pointer exists,
  or the entire exhaustive unpaginated history when settled. Its fixtures reject
  pagination, an equal-time newest tie, and history movement even if the selected
  winner would otherwise remain unchanged.
- Confirmed P0: exact service coverage alone was insufficient because the successful
  legacy API intent could remain BOUND without `legacyCutoverCompletedAt`; whichever
  AI/workers recovery ran last could then terminalize the parent and permanently skip
  launch-authority retirement. Automatic terminalization and manual reconcile now
  count that row as unresolved. Exact API intent recovery must re-prove success, run
  `retire-launch-builds.ts`, and durably write the marker before any other intent may
  terminalize the parent. A completed rollback uses its separate durable cleanup
  markers and does not require a false cutover marker.
- Multi-api rule: if a parent contains more than one api-web intent/deployment, recover
  the latest successful non-no-op BOUND intent. Only after its exact retirement child
  succeeds may the transaction mark that cutover and every earlier successful legacy
  BOUND row for the same environment/build/parent; rows with rollback observed are
  excluded. This is marker consolidation, not evidence widening: direct recovery of a
  superseded intent still rejects an unexpected later deployment.
- Recovery ordering invariant: a non-terminal recovery must finish exact in-task SSM
  proof or create-only repair before durably closing the recovered intent and before
  launching any cleanup/retirement child, then write the durable cleanup/cutover
  marker only after that child succeeds. A closed recovered intent therefore implies
  successful SSM proof; a cleanup marker additionally implies successful cleanup.
  Terminal replay remains read-only and returns only after fresh two-read platform/SSM
  validation; it cannot repair, spawn cleanup, or fill a missing marker.

Artifacts changed:

- `.github/workflows/recover-release-intent.yml`
- `apps/api/prisma/run-exclusive-release-operation.{ts,spec.ts}`
- `infra/prod-ecs-express/{deploy,run-release-task,active-launch-builds,verify-express-noop,verify-serving-api-build}.sh`
- `infra/prod-ecs-express/release-safety.spec.sh`
- `infra/docker/production-image-security.spec.sh`
- `infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json`
- Deploy/entitlement specs, plans and `docs/runbooks/feature-launch-control.md`

Verification at this checkpoint:

- Focused release-recovery suite: 29/29 pass, including real-PostgreSQL
  transactional ORPHAN insertion/audit/coverage/replay and the legacy-cutover
  terminalization/reconcile guard. With explicit `DATABASE_URL`, connection,
  schema or setup failure is fatal and real-DB cases cannot skip.
- `corepack pnpm --filter @watchdog-bms/api typecheck`: pass.
- `bash infra/prod-ecs-express/release-safety.spec.sh`: pass.
- `bash infra/docker/production-image-security.spec.sh`: pass.
- Shell syntax and recovery-workflow YAML parse: pass. Full repository suite and
  exact-SHA push CI are still required before any live recovery.
- Documentation consistency audit 2026-08-03: health NULL/absent OPEN blockers,
  wave readiness tri-state, create-only SSM repair, exact replay equality and
  explicit-database test strictness are synchronized across spec/plan/runbook;
  `git diff --check` passes. Runtime tests were not rerun for this docs-only patch.
- Expired-task follow-up audit 2026-08-03: evidence manifest byte hash matches
  `f152c3da1b7d6cb54d1d51b6714f8028fb2c43f8dd324efbc829142906fc7cfb`;
  workflow inspection confirms the exact all-three-`MISSING`, parent/service and
  UAT-only bounds plus fresh live proof. Serving-build inspection confirms complete
  canonical two-read comparison and pagination/tie/movement fixtures.
- Legacy-cutover P0 inspection 2026-08-03: terminalization and manual reconcile both
  query the unresolved legacy BOUND shape, the intent-recovery path runs retirement
  before setting `legacyCutoverCompletedAt`, and the real-DB suite contains successful
  cutover, completed rollback, and reconcile-bypass cases. `node --import tsx --test
  apps/api/prisma/run-exclusive-release-operation.spec.ts` passes 29/29 against the
  local PostgreSQL test database.
- Multi-api follow-up 2026-08-03: normative selection/marking rules are documented;
  `markRecoveredLegacyCutoverCompleted` and its real-DB grouped-marking/rollback
  exclusion case are present, while existing unique-latest validation preserves
  unexpected-later rejection. The focused suite was rerun and passes 29/29 after this
  helper/test and the SSM-before-close ordering regression landed.

Next:

1. Commit/push the final reviewed UAT SHA and require exact successful CI. The
   recovery floor remains UAT-only and production remains all-zero.
2. Deploy `target=all` once from the neutral `main` controller using that exact
   `develop` SHA; verify all three active singleton revisions/full SHAs,
   health, finalization, retirement and M-01. Never retry held SHA `605a52e2…`.
3. Collect `A5-RO` through an honestly read-only DB path plus launch health/shadow;
   keep tenant-bearing output restricted. It gates state-only F2 APPLY.
4. Run a fresh F2 PLAN and review full cohort evidence, exact orphan rows, counts and
   hashes. Resolve/re-plan on any blocker, then APPLY once and independently VERIFY.
5. Run Partner/Reports ON→OFF→retained-history/new-root-denial→ON plus AI/tax smoke.
   `A5-CAPACITY-MUTATING` needs separate approval and gates any bounded batch and
   promotion/GA, not current per-company F2 APPLY. Keep WHT routes CLOSED; production
   promotion remains a separate owner decision.

## Production minimum-capacity recovery D2-D3 — 2026-08-03

Status: helper and adversarial local verification complete; no AWS mutation. The earlier live plan
was not applied. A fresh read-only plan made with the reviewed helper again proved all three exact
production services stable at `min=0,max=2`, all with action `UPDATE_MINIMUM`, and embedded SHA
`99103e2010af038ab0888f6eab701d3c5d64038b8ab3a822b4f32e6e62832f2e`. It remains evidence only;
D5 must explicitly authorize that exact plan/SHA (and regenerate it after any service or helper
change) before apply.

Decisions:

- `infra/prod-ecs-express/recover-production-minimum-capacity.sh` owns a strict PLAN -> explicit
  SHA -> APPLY contract for only the three reviewed production service ARNs. Apply performs two
  stable service reads plus an exact immutable-revision re-read for all services before its first
  write, then sends only `{serviceArn,scalingTarget}` with `minTaskCount` changed from zero to one.
- Transitional ECS state is polling evidence, not an immediate failure. It is bounded to the exact
  service/deployment/revision namespace; acceptance still requires one stable ACTIVE singleton and
  byte-equivalent normalized service and revision configuration.
- Post-state evidence requires the exact task definition, complete RUNNING task set, equality between
  those tasks' private IPs and the healthy target set, and an HTTP `status=ok` probe whose SSM URL is
  exactly the active revision's public ingress endpoint.
- A fresh healthy `min=1` plan produces `VERIFY_ONLY`; apply makes zero update calls. Any approved-plan
  drift, malformed configuration, failed/ambiguous update or unhealthy post-state fails closed.

Artifacts:

- `infra/prod-ecs-express/recover-production-minimum-capacity.sh`
- `infra/prod-ecs-express/recover-production-minimum-capacity.spec.sh`

Verification:

- `bash -n infra/prod-ecs-express/recover-production-minimum-capacity.sh infra/prod-ecs-express/recover-production-minimum-capacity.spec.sh` — pass.
- `bash infra/prod-ecs-express/recover-production-minimum-capacity.spec.sh` — pass, including wrong
  account/pointer/service/cluster, moving/dual reads, invalid/missing/extra scaling/config, pre/post
  image/env/network drift, task-definition drift, failed/invalid update, zero/unhealthy/mismatched or
  paginated task/target state, URL/HTTP failure, bounded startup lag, success and zero-update replay.
- Reviewed helper SHA-256 `a648dd4db363683df6cbef5c73680a926f2df73c8a022ddf5141254ca48cd7f8`;
  adversarial spec SHA-256 `af8dd6ba9245508abbe760222213786305cd47778ed4056f6c3b3affd0af3eba`.
- Reviewed helper live `plan` through `watchdog-bedrock` — pass, exact three `UPDATE_MINIMUM` rows,
  SHA `99103e2010af038ab0888f6eab701d3c5d64038b8ab3a822b4f32e6e62832f2e`; read-only, no apply.

Next: D4 must add the same scaling/task/target/HTTP facts to signed production A5 PRE evidence. Its
workflow and evidence contract are being changed by the active production A5/U5 pass, so this
checkpoint deliberately does not edit those shared files. D5 remains owner-gated and must use the
final reviewed script, a still-current plan and the exact explicitly approved embedded SHA.
