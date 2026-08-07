# Deploy Wave Rollout + Production Promotion Plan

Spec: `docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`
Task memory: `docs/agent-memory/deploy-wave-rollout-and-prod-promotion.md`

Working rules for this task:

- Ponytail full mode (`.agents/skills/ponytail/SKILL.md`): shortest correct
  diff, reuse existing patterns, no new dependencies.
- Shared worktree: never `git add -A`; stage only the files this plan touches.
- Do NOT run `deploy.sh` against AWS from the workstation to test; verification
  below is static checks + the stubbed spec script + a real UAT workflow run.
- Both phases are independent; land Phase A and Phase B as separately
  revertable commits.

## Phase A — wave rollouts in deploy.sh

1. [x] Read `infra/prod-ecs-express/deploy.sh` end to end (note: `deploy_*`
   functions print their URL result via stdout capture; `ensure_ecs_roles`
   writes shared `/tmp/watchdog-bms-ecs-*-policy.json` files — this is the race
   spec §4.4 removes; container-JSON temp files are already per-service).
2. [x] Add `infra/prod-ecs-express/lib-rollout-waves.sh`: sourceable, no
   top-level side effects, bash-3.2 compatible (no `wait -n`, no associative
   arrays). Provide `run_rollout_wave <service>...` per spec §4.3: background
   `deploy_<service>` jobs, live `[wave:<service>] ` prefixes on stdout+stderr,
   wait ALL to terminal state, never kill siblings, aggregate exit codes and
   name every failure.
3. [x] Add `infra/prod-ecs-express/rollout-waves.spec.sh`: sources the lib,
   defines stub `deploy_*` functions (fast success, delayed success, failure),
   asserts: all-success → 0; one-fails → non-zero AND failing name printed AND
   slow sibling ran to completion; output lines carry the right prefix; waves
   run in declared order. Must run with plain `bash`, no AWS, exit non-zero on
   any assertion failure.
4. [x] Rework the `all` case in `deploy.sh`: keep the existing sequential body
   as the intentional bootstrap branch; add wave mode gated on spec §4.1 preconditions
   (manifest set + subnet-mode public + the five steady-state params
   non-empty). Wave grouping per §4.2 (uat: one wave of three; production:
   `api-web` then `ai-gateway workers`). One-shot `preflight` +
   `ensure_ecs_roles` + `ensure_cluster` before the first wave with the
   `WATCHDOG_COMMON_ENSURED` guard per §4.4 (guard must not depend on
   `ECS_DEPLOY_MANAGE_IAM`). Keep the ai-gateway endpoint-drift guard per §4.5.
   Readiness status `0` selects the wave, `1` alone selects bootstrap, and every
   other status preserves the error and invokes neither writer. A failed wave
   skips later waves and the drift guard and exits non-zero.
5. [x] Static verification, record outputs in task memory:
   - `bash -n infra/prod-ecs-express/deploy.sh`
   - `bash -n infra/prod-ecs-express/lib-rollout-waves.sh`
   - `bash infra/prod-ecs-express/rollout-waves.spec.sh`
   - `shellcheck` both files if available (record "unavailable" otherwise)
   - `bash infra/docker/production-image-security.spec.sh` (guards Dockerfile
     policy; proves no accidental drift)

## Phase B — production promotion

6. [x] Edit `.github/workflows/deploy-production.yml` per spec §5.2:
   - add `promote_from_run_id` input (string, optional, default `''`);
   - `build_and_publish.if: inputs.promote_from_run_id == ''`;
   - deploy-job `if` with the skipped-needs pattern from §5.2 (model on the
     `always() && needs...result` pattern already used by
     `publish-production-images` in `ci.yml`);
   - artifact download: compute `name: production-release-<source_sha>` inline;
     when promoting pass `run-id` + `github-token`. Check the pinned
     `actions/download-artifact` hash supports `run-id`/`github-token` (v4.1+);
     bump the pin if not, or use `gh run download` with
     `GH_TOKEN: ${{ github.token }}`;
   - new promoted-run validation step (`gh api .../actions/runs/$ID` asserts
     `.conclusion == "success"`), only when promoting;
   - all existing gates (validate-production-manifest, cosign verify,
     release-task, deploy.sh, verify-deployment) untouched; promotion failures
     stop loudly, no silent rebuild fallback.
7. [x] Verify workflow syntax: `ruby -ryaml -e 'YAML.load_file(".github/workflows/deploy-production.yml")'`
   (and `actionlint` if available). Confirm with `git diff` that the
   non-promotion path is textually unchanged except for the added
   input/conditions (spec A6).

## Phase C — release evidence and UAT incident hardening

C1. [x] Make every Bash intent/AWS/bind/wait/SSM/evidence boundary propagate a
    non-zero result explicitly; only exact SSM `ParameterNotFound` means absent.
C2. [x] Keep concurrent `release-intent`/`release-bind` siblings out of the
    detached-writer scan while every real writer remains fenced.
C3. [x] Restrict legacy bootstrap provenance to api-web and require exact target
    coverage (`all` = API + AI Gateway + workers) before finalization or recovery
    terminalization.
C4. [x] Implement settled-null verification: two stable service/history reads,
    singleton exact active target, unpaginated bounded history, unique-newest
    deployment; use the same gate for rollout, retirement, F2 and recovery.
C5. [x] Align TypeScript with `jq -cS | shasum` (codepoint ordering + trailing
    newline) and normalize only one controller-proved ECS-managed security group.
C6. [x] Add bounded ORPHAN recovery from immutable stopped tasks; verify the old
    image signer/OCI revision, task shape/controller/SHA/chronology, platform,
    SSM and no conflicting service intent. Persist BOUND intent + manifest +
    CRITICAL audit atomically. Recovery SSM repair is create-only with
    `Overwrite:false`; a concurrent existing value passes only after two exact
    reads agree, never by overwrite.
C7. [x] Separate held target SHA from recovery executor SHA; require executor
    ancestry from target and a pinned reviewed fix floor, exact successful push
    CI, signed executor digest, and persist both SHAs/digest/CI/signer evidence.
C8. [x] Add focused real-DB/pure/shell/security tests for service coverage,
    orphan persistence/replay, null pointer, later/paginated/moving state,
    config hash/network proof, no-op history, workflow trust, stored-vs-fresh
    replay equality and wave readiness `0|1|other`. An explicitly supplied
    `DATABASE_URL` makes connection/schema/setup failure fatal; CI may not skip
    the real-PostgreSQL cases.
C9. [ ] Pin the UAT recovery-fix floor to the reviewed implementation commit,
    push `develop`, and require green CI for the exact executor SHA.
C10. [ ] Recover the held `605a52e…` operation in this order: bounded AI ORPHAN;
     API BOUND intent `483aa70a-5a4c-4263-98a3-27ad6635c160` so successful legacy
     cutover retires superseded launch authority and durably records
     `legacyCutoverCompletedAt`; then workers OPEN intent last. Confirm exact
     API/AI/workers coverage and parent `RECONCILED_FAILED_CONFIRMED`.
C11. [ ] Deploy the new reviewed fixed SHA with `target=all`; require health,
     exact service intents, finalization, retirement, digest/SHA verification and
     optional M-01 evidence before F2.
C12. [x] Rule: do not retry the old SHA as a normal deployment; ordinary deploy code is
    still sourced from its target commit. Do not touch production in this phase.
C13. [x] Add the UAT-only expired-task exception discovered when ECS stopped-task
     retention elapsed: retained tasks remain the default; fallback requires all
     three exact historical ARNs to be `MISSING` (never a partial set), and is
     hard-bound to parent `bf131086-6055-4143-a77c-579bc7d58b57` plus the UAT AI
     service. Pin the committed evidence manifest
     `infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json` by
     byte SHA-256 in the neutral `main` workflow, then revalidate exact live task
     definition registration/shape/env, signed image and OCI revision, exact
     CloudWatch events, chronology, and current two-read platform/network/SSM
     state. CloudTrail event IDs remain audit metadata because the deploy role
     cannot call `LookupEvents`; ship no production or generic fallback.
C14. [x] Strengthen `verify-serving-api-build.sh` so both stability reads compare
     the complete canonical deployment response/history, not only the selected
     newest row; cover pagination, equal-time newest ties, and history movement
     with fail-closed fixtures.
C15. [x] Treat successful legacy api-web `BOUND` as unresolved until
     `legacyCutoverCompletedAt` is durable. Make both automatic terminalization and
     manual reconciliation block; exact intent recovery must run launch-build
     retirement successfully before writing the marker. Cover successful cutover,
     completed rollback, and manual-reconcile bypass attempts in the real-DB suite.
C16. [x] For multiple api-web intents under one parent, recover the latest successful
     non-no-op BOUND deployment. After exact retirement, mark its cutover plus all
     earlier successful legacy BOUND rows for the same environment/build/parent,
     excluding rollback-observed rows. Keep unexpected-later evidence fail-closed for
     a superseded intent; add real-DB coverage for selection, grouped marking, and
     rejection.
C17. [x] Order every non-terminal intent recovery as exact in-task SSM proof/repair,
     then durable intent closure, then cleanup/retirement child, then durable
     cleanup/cutover marker. Add focused failure tests proving an SSM mismatch/repair
     failure neither closes the intent nor launches a child/writes a marker. Keep
     terminal replay fresh-two-read and mutation-free.
C18. [ ] Close live UAT run `30781342632` task-family contention: make
     `run-release-task.sh` retry only ECS's exact concurrent
     `RegisterTaskDefinition` `ClientException` with a bounded backoff before
     `RunTask`; fail every other error immediately. Add executable success-after-
     retry and permanent-error tests. Recover workers intent
     `ea43e4f8-c9e2-49fa-a727-8cdd4d64e4f7` under parent
     `56706288-8f34-4e2f-b2d2-04e982e2ca0f`, require exact platform/SSM proof and
     parent terminalization, then deploy a new reviewed SHA. Do not change a
     company entitlement, OPEN WHT, or touch production.
C19. [ ] Close the live-hold recovery gap exposed by recovery run `30783394599`:
     keep the 90-minute rollout hold for active controllers, but let only the
     exact signed recovery executor reclaim it early after its same-concurrency
     GitHub controller performs two stable `DescribeTasks` reads of the supplied
     parent task. Pass canonical STOPPED evidence; under the DB lock require
     `leaseOwner == ecsTaskArn == evidence.taskArn` and the exact release/build,
     then audit the transition. Do not expand the fenced task role. Add workflow,
     renderer, static and real-DB negative/positive coverage and rerun the exact
     workers recovery before any new deploy.

## Phase D — production minimum-capacity recovery

D1. [x] Read the exact production ECS Express state without mutation. Record the three active
    service/revision/task-definition/image identities, `min=0,max=2`, zero running tasks and repeated
    HTTP 503 results; compare with healthy UAT `min=1,max=2`.
D2. [x] Add one fail-closed recovery helper/controller that accepts only the three reviewed
    production service ARNs, two stable identical reads and canonical active configuration with
    `minTaskCount=0`. Render an update that changes only the minimum to `1`; reject every other diff.
    The approved authority is the canonical plan's embedded SHA plus the same explicit apply input;
    apply re-reads all three services and immutable revisions before its first write.
D3. [x] Add executable fixtures for wrong account/cluster/service, moving/dual revisions,
    min already nonzero, missing/extra configuration, image/env/network drift, failed update,
    unhealthy/zero post-state and replay. A successful replay at the exact healthy `min=1` state is
    read-only.
D4. [ ] Extend production read-only preflight evidence with exact scaling target, running task set,
    target-group health and HTTP health. `ACTIVE` outer resource status alone must fail.
D5. [ ] Run the recovery only through the reviewed controller and exact production role. Capture
    before/after signed evidence, then require the ordinary U5/production workflow to start from the
    healthy result. Do not run migrations, deploy images or change feature/route state in recovery.

D2-D3 verification: `bash infra/prod-ecs-express/recover-production-minimum-capacity.spec.sh`
passes the fail-closed matrix, including an observed transitional deployment before the new singleton
revision settles, exact RUNNING-task-IP/healthy-target equality, active-ingress/SSM health URL binding,
three-update success and zero-update healthy replay. `bash -n` passes both scripts. No production
mutation was performed. A fresh read-only plan from the reviewed helper re-proved all three exact
services as `UPDATE_MINIMUM` at embedded SHA
`99103e2010af038ab0888f6eab701d3c5d64038b8ab3a822b4f32e6e62832f2e`; it is evidence only until
that exact plan/SHA is explicitly authorized for D5. D4 remains open while the production A5/U5
controller files are under their separate active implementation pass.

## Docs + evidence

8. [x] Update `docs/specs/uat-environment-spec.md` §deploy statement (currently
   "ECS Express canary completion remains the release gate…") to add: in steady
   state `all` runs the managed rollouts as concurrent waves (UAT one wave,
   production two) with the canary gate retained per service.
9. [x] Update `docs/agent-memory/ecs-express-rollout-latency.md` `Next:` to
   point at this task (supersedes "no follow-up pending").
10. [x] Keep `docs/agent-memory/deploy-wave-rollout-and-prod-promotion.md`
    current: decisions, verification command outputs, evidence links.

## Integration gates (after merge)

11. [x] Historical integration step — superseded by C9; do not execute a second
    push/PR path separately.
12. [ ] Live UAT evidence: dispatch UAT Deploy (`all`) on the merged SHA.
    Record: deploy-job duration (target ≤ ~15 min), three concurrent
    `[wave:*]` rollout streams in the log, `verify-deployment.sh` pass, API
    health 200 + web root 302. Compare against the 34m09s baseline run
    `30529628323`.
13. [ ] OWNER-GATED — do not run without explicit owner go: next production
    release via promotion (`release_ref` = the UAT-validated SHA,
    `promote_from_run_id` = that UAT run). Record: zero ci.yml jobs ran,
    active digests equal the UAT manifest digests, two-wave timing.

## Review checklist mapping

- Product: operator journeys (§5.1 promotion contract, unchanged UAT dispatch)
  and the latency acceptance targets are in spec §2/§6.
- Architecture: wave preconditions/fallback (§4.1), shared-ensure race (§4.4),
  promotion trust boundary = manifest validation + cosign, not the artifact
  transport (§5.2).
- Implementation: steps 2–7 above, smallest-diff, two revertable commits.
- Integration: steps 11–13 with recorded timings and digest-equality evidence.
