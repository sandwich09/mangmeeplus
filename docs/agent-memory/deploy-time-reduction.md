# Agent Memory: deploy-time-reduction

Status: Spec+plan authored; execution blocked until in-flight 2026-08-17
release reaches customer `OPEN` (see `production-deploy-2026-08-17.md`) and
GitHub Actions/API incident resolves.
Owner: Product owner / Claude (Fable 5 orchestrating, Opus 5 implementing)
Scope: 3-phase deploy-time reduction to ≤10m UAT and ≤10m production promote,
per `docs/specs/deploy-time-reduction-spec.md` and
`docs/plans/deploy-time-reduction-plan.md`.
Decisions:
- Sequencing: complete in-flight promotion (UAT `32038712267`, READY
  `32041268834`, then Production V2 live + stage E OPEN) before any controller
  change lands. Rationale: Passport/READY pin exact workflow blobs; a
  controller change now would strand the signed chain.
- Live post-shift bake (3m) is retained in phase 1; only canary bakes and
  maintenance-mode bakes go to 0. Owner may revisit with traffic growth.
Open questions:
- None blocking phase 1. Phase-2 Fargate fence/retire latency split still to be
  measured from run logs (plan §2 step 1).
Artifacts:
- Evidence run set: UAT `31901904745` (22m, step table), UAT `31816168613`
  (32m full-CI), READY `31903027707` (6m), prod live `31903336753` (38m, step
  table), failed prod `31897008213` (1h30m: close 23m / rollout-fail 25m /
  recovery 27m).
Verification:
- Spec §1 tables derived from GitHub Actions job/step timestamps via `gh api`
  on 2026-08-17.
- Phase-1 read-back evidence (2026-08-17, read-only, `watchdog-bedrock`):
  prod ×3 services `CANARY canaryPct=5 canaryBake=3 bake=3`, alarms+circuit
  breaker enabled, rollout COMPLETED. RollbackAlarm: ELB target-group
  error-rate, Period=60, EvaluationPeriods=3, DatapointsToAlarm=2,
  threshold>1, TreatMissingData=notBreaching. Rollback reference for phase-1
  revert: restore canaryBake=3, bake=3 on all three services.
Implementation review (2026-08-18, Fable 5 reviewing Opus 5):
- Phase 1 APPROVED: commit `7e8e60b` on `feat/deploy-speed-phase-1` (8 files,
  +340/−5). lib-prod-rollout-config.sh reuses the UAT shape validators (one
  contract, no copy-drift); live=0/3, maintenance=0/0, unknown mode fails
  closed; adaptive poll keeps ceiling attempts×20 exactly
  (75→1500s, 90→1800s asserted). All gates green incl. full
  production-image-security suite + pin cascade resync
  (validatorSha256 7486173c…, expected_deploy 278cd4ac…). Decision: ci.yml
  release_controller_only allowlist NOT extended — the one phase-1 PR accepts
  a full-CI run (fails safe) instead of widening the most blob-sensitive file.
  Live alarm names confirmed against 2026-08-17 read-back (exact match).
- Phase 2 APPROVED with scope cut: commit `6a00906` on
  `feat/deploy-speed-phase-2` (deploy-uat.yml only, +90/−3): publish-reuse
  gate, fail-open decision table, all needs.build_and_publish references
  traced, download run-id/github-token pattern precedented by
  deploy-production.yml:325. Full suite RC=0 re-run by reviewer after
  pnpm install + prisma generate. §5.2 publish-on-develop REJECTED on
  evidence: uat environment branch policy = main only; cosign identity
  ci.yml@refs/heads/develop cannot satisfy the @refs/heads/main pin; develop
  merge-commit heads have no exact PR CI. Spec §5.2 rewritten accordingly;
  UAT first-dispatch target revised to ~14–15m, redeploy ~9–10m.
- §5.3 fence/retire measurement: blocked locally (watchdog-bedrock profile
  lacks ecr:DescribeImages on migration-tool; newest ECR entries are OCI
  indexes so imageSizeInBytes is manifest size). Plan: capture ECS task
  provision/pull/execute timing live during the upcoming promote run.
- Phase 3 APPROVED: commit `3a81694` on `feat/deploy-speed-phase-3` (5 files,
  +209/−14). Load-bearing design: readiness runs as a reusable-workflow call
  (`uses: ./.github/workflows/production-readiness.yml`) so the Fulcio
  signing subject stays production-readiness.yml@refs/heads/main and NO
  validator changes; artifact/run-id contract satisfied because a called
  workflow reports the caller's run id. readiness_run_id now optional —
  supplied = exact today's behavior (rollback path, no code revert); omitted =
  inline READY, steps 9/11/13 (READY-duplicate rechecks) skipped,
  mutation-boundary steps 15/22 unconditional with a spec assertion that
  fails if they ever gain an `if:`. Mutation-tested. Suite RC=0 re-run by
  reviewer. Merge note: phase-3 adds the same
  AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF env line as the standalone hotfix
  but after APPROVED_AI_REGIONS (hotfix: after AGENTCORE_REGION) — dedupe to
  one line when rebasing onto post-hotfix main. Rehearsal gate (one
  maintenance_closed combined promote before any live use) still required.
- As-built timing honesty (arithmetic from measured components): UAT redeploy
  ~9–10m ✓ target; UAT first dispatch ~14–15m; prod combined maintenance
  ~24–26m; prod combined live ~30m. Prod ≤10m is NOT reached by phases 1–3
  as scoped. Remaining levers, each a deliberate deferred owner decision:
  (a) single-wave production rollout like UAT (−6–7m; wave spec §4.2
  serialization rationale), (b) §5.3 fence/retire slimming (−3m; measure
  during next promote), (c) readiness parallel to the DB fence (−4–5m;
  larger promote restructure). (a)+(b)+(c) ≈ prod ~9–12m.
Verification results (2026-08-18, all run IDs in production-deploy-2026-08-17.md):
- Phase 1 VERIFIED: live promote 32078202452 (candidate 1bb4e9cf, camera fix
  shipped): rollout 26m15s→21m22s (−18.6%), total 38m28s→34m23s. IAM
  prerequisite gap found by first attempt 32070713324 (prod deploy role lacked
  classic ecs:DescribeServices/UpdateService; fail-closed pre-intent, zero
  mutation) — fixed via PR #152 + owner ceremony apply with exact readback +
  policy simulation proof. Reviewer lesson: diff the deploy-role policy for
  every new AWS API a phase introduces.
- Phase 2 VERIFIED with revised numbers: reuse gate works (UAT-F2 32091272835:
  build_and_publish skipped); acceptance contract gap found by UAT-V2
  32082803120 (manifest.workflowRunId == signing run rejected every reused
  release) — fixed as phase 2b (PR #156, publishedByRunId optional field,
  5 pins, coupling audit of 16 sites). F1 publish 22m42s vs F2 reuse 19m05s.
  UAT ≤10m NOT reached: deploy job is the floor (fence 207s + rollout 540s +
  retire 171s + AgentCore staging); remaining levers are §5.3 fence/retire and
  AgentCore staging reuse — out of the agreed three-phase scope, recorded as
  follow-ups.
- Phase 3: inline READY machinery VERIFIED live (combined run 32084651521:
  reusable-call readiness both jobs green, same-run artifact consumption,
  conditional recheck skips, run-name binding). Full-green combined promote
  pending on real digests (75ae7e1 passport) after parent 63adc513 recovery.
  The no-op-repromote rehearsal exposed two pre-existing platform edges:
  (a) ECS Express mints a new service revision for an identical-config update
  without creating a deployment → bind/noop check reports UNKNOWN (affects any
  same-digest re-promote; unchanged by phases; follow-up), (b) pre-intent
  recovery rejected already-serving builds — FIXED (PR #158, attribution to
  the prior finalized release, retirement child skipped only when attributed —
  Opus caught that the unconditional retirement would have closed launch-gate
  authority of the live build). GitHub stale-replica fetches (post-incident)
  intermittently 128 recovery runs whose recovery_ref is a just-merged tip;
  fail-closed, retried.
Next:
- Terminalize parent 63adc513 via the attribution-fixed PRE_INTENT (retry loop
  running), then combined live promote of the 75ae7e1 passport (real digests)
  to close phase 3 with single-dispatch timing; then docs PR #151, ci.yml
  release_controller_only allowlist extension (phase-1/2/3 infra files +
  policy templates) per the owner's pnpm-test-skip request.
