# Agent Memory: production-deploy-2026-08-17

Status: PROMOTED_LIVE + customer OPEN verified (2026-08-17T20:1xZ); remaining: 15-turn real
Production conversation acceptance (owner/LINE step) and deferred concurrency test per
OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONCURRENCY-DEFERRED
Owner: Product owner / Codex
Scope: Recover the interrupted all-target UAT release, then promote one immutable LINE AI release through UAT, signed READY and Production.
Decisions:
- Hosted concurrency is deferred under `OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONCURRENCY-DEFERRED`; the release remains conditional and the deferred test must still be performed after opening.
- Do not run the TypeScript suite for release/security-only changes. Merge the reviewed change under the owner's admin-bypass authorization, restore branch protection, then create an empty release checkpoint whose CI proves `code_changed=false` and skips TypeScript.
- AWS ECR currently maps `CVE-2026-14456` to Debian source package `openssl` `3.0.20-1~deb12u2`, while its own description says the issue begins with OpenSSL 3.5 QUIC server support. Use only the exact, expiring, digest-recording exception in `infra/docker/ecr-scan-blocking-findings.jq`; all other HIGH/CRITICAL findings remain fail-closed.
Open questions:
- None for the current UAT dispatch. Customer `OPEN` and deferred concurrency remain post-promotion state transitions.
Artifacts:
- Reviewed candidate `292e750526257ea4265e53ba888e82cf5e0a864d` is merged into frozen
  `main` controller `a637b73d2512e032bf10715812d8e1c363e4dba1`. Exact focused CI
  `32038402236` passed without the application TypeScript suite.
- UAT `32038712267` attempt 2 succeeded with signed Passport artifact
  `uat-release-passport-v2-292e750526257ea4265e53ba888e82cf5e0a864d-attempt-2`
  (artifact id `9291776229`). The finalizer completed with `HEALTH_VERIFIED=true`; the first
  attempt was a pre-job GitHub codeload 429 and made no durable mutation.
- One-time A5 reader bootstrap `32040230695` attempt 2 succeeded. Signed artifact
  `production-a5-reader-bootstrap-v2-32040230695-attempt-2` (artifact id `9291979306`)
  proves the bootstrap execution role absent and the reader controller self-revoked. Do not re-arm
  or rerun A5.
- Live READY uses run `32041268834`, UAT `32038712267`, and owner reference
  `OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONDITIONAL-LIVE`. Attempts 1/2 stopped before checkout or
  AWS because GitHub codeload returned 429. Attempt 3 verified the Passport signature and source,
  then stopped before AWS when GitHub's branch-protection API returned 503. GitHub Status confirms
  a critical incident with API Requests and Actions in `major_outage`; no Production mutation exists.
- UAT `32031052119` built and rolled exact candidate `ed8ce3b4b3b5329ed83922b8f1841e8471bbdb16`
  to api-web and workers, but ai-gateway stopped before durable intent or ECS mutation. AgentCore had
  correctly issued artifact-bound qualifier `candidate_uat_ed8ce3b4b3b5_053c8938`; the shared ECS
  deploy and verifier still accepted only the superseded source-only shape. Parent operation
  `dbc89233-8108-43f8-bcad-0503b2063ed1` therefore has bound api-web intent
  `48811bcc-69c5-4471-bfb0-c22053b853e2` and workers intent
  `110a2d8d-3ebb-4b60-b5e3-c955392a9623`, with no ai-gateway intent. Exact partial all-target recovery
  is required before a new UAT dispatch.
- The shared UAT/Production ECS deploy and verifier now require the same
  `candidate_<environment>_<source12>_<artifact8>` identity emitted and signed by the AgentCore
  binding, including an exact source/artifact comparison. This closes both the observed UAT failure
  and the equivalent later Production deploy/verification failure rather than relaxing the check.
- Recovery `32033671870` stopped before AWS credentials or mutation because the code-neutral UAT
  proof understood only an entirely skipped `Typecheck and Test` job. CI `32030400724` instead ran
  one successful release-controller shell step while skipping install, TypeScript, PostgreSQL and
  application tests. The recovery gate now accepts that exact shape only after its existing Git
  byte-diff proves all recovery executable/dependency inputs unchanged; the release-controller CI
  classifier also covers the shared ECS AgentCore deploy/verify bundle and runs its focused shell spec.
- Recovery attempts `32034504773`, `32034578189` and `32034911876` also stopped before AWS mutation:
  the first pair lacked a CI run whose head branch matched the UAT recovery contract; the exact
  develop checkpoint `32034753695` fixed that identity but correctly proved the current recovery
  executable differs from the older PostgreSQL proof. Refresh the focused hosted PostgreSQL proof;
  do not run the unrelated application TypeScript/test suite.
- UAT `32023560885` deployed exact candidate `30718c34a5668ac0d942567260b55d2db32b4609`
  successfully to all three ECS Express services and passed both hosted AgentCore smokes. The run
  failed only because `verify-deployment.sh` compared the signed AgentCore source to `commit` before
  assigning `commit` (`line 64: commit: unbound variable`). The durable parent
  `9d6fb59a-75fd-451b-9c4f-3f41912768d9` was reconciled to `FAILED_CONFIRMED` by the workflow.
- Manual read-only replay of the patched verifier against live UAT passed exact image/source,
  serving-mode and public health for api-web, ai-gateway and workers. Secret-safe deep readiness also
  returned `{service:"api",status:"ok",db:"ok"}`. Production uses the same verifier, so the fix and
  maintenance pins cover both UAT and Production callers.
- Looking-forward Production readback found one prerequisite drift before READY: the live Production
  deploy role lacks only `UpdateAgentRuntimeEndpoint` and `DeleteAgentRuntimeEndpoint` from the
  reviewed template. The already-approved full prerequisite ceremony will exact-apply this before
  READY. The absent Production candidate execution role is expected first-stage state: the scoped
  deploy policy and `agentcore-deploy.sh` create it, then replace its name-bound wildcard trust with
  the exact runtime ARN before the runtime is accepted.
- The owner-approved prerequisite ceremony exact-applied and read back the Production deploy policy,
  including both endpoint actions, under the non-root `thawatchai` principal. It left the one-time A5
  reader bootstrap controller intentionally armed; after the next signed UAT Passport, run
  `production-a5-reader-bootstrap.yml` once and prove it self-revokes before issuing the live READY.
- The first real Production AgentCore stage exposed an AWS IAM propagation boundary: immediately after
  creating the candidate execution role, `CreateAgentRuntime` returned `Role validation failed`. The
  controller now retries only that provider error with a bounded 12 x 5-second policy and fails every
  other error immediately. The focused shell fixture proves one transient failure followed by exactly
  one successful retry.
- A real replay with the patched controller then created Production runtime
  `watchdog_orchestrator_production_candidate-FWHp0D4V34` and endpoint
  `candidate_production_30718c34a566`; both reached `READY`. Hosted safe-read and mutation-refusal
  smokes returned HTTP 200 with exact source `30718c34a5668ac0d942567260b55d2db32b4609` and artifact
  `ef0c34be5fbf464e8487706dde22414dbc7fdafdf1bd92777b771260d1d6a6c4`. The readiness workflow can
  therefore reuse the exact staged identity rather than cross the new-role propagation window again.
- UAT `32028628294` stopped before its durable release task and before any ECS/DB mutation. Rebuilding
  the exact source produced different ZIP bytes (`f2189d69...` versus the active `ef0c34be...`) because
  ZIP retained esbuild's current output mtime, while the endpoint identity contained only the source.
  The active ECS service correctly protected that endpoint from being repointed. Normalize the ZIP
  input mtime and bind new endpoint names to both source and artifact prefixes; this preserves the old
  live endpoint through service drain and makes every subsequent rebuild of one source byte-identical.
- Failed UAT runs: `32004507684`, `32007029995`, `32007856084`, `32009924946`.
- UAT `32009924946` deployed api-web/workers but failed before the ai-gateway intent because `deploy.sh` compared the 40-character AgentCore expected source with the 12-character ECS label. Parent operation `ffb80c83-401f-4995-a7a0-871e82bd9ee9` is being closed by exact PRE_INTENT recovery run `32011940733` using stopped parent task `arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/76a7a21e421046c68754631f54f35a7d`.
- Root fix merged as `a877cfe61534b110c3c2b35c3fbca26005b55a71`. Recovery run `32011940733` made no AWS mutation because its executor was older than the held release. UAT recovery may reuse exact successful PostgreSQL CI `32002605508` only while Git proves all recovery executable, test and dependency inputs are byte-identical to `33266c1220b3a71cfae86cbd3aeb5b0ad6607118`; Production remains strict.
- Recovery `32013376633` proved the checkpoint/STOPPED parent but correctly refused PRE_INTENT because api-web intent `18e11c6d-db7c-4d0d-aec6-527666c9572a` and workers intent `4d3c31c5-21c9-43ed-893d-a87a7772d807` exist. The all-target ai-gateway path failed before intent creation, so add fail-closed partial all-target recovery: each existing intent must be freshly revalidated and durably marked; missing intent proves no ECS mutation because intent creation precedes mutation.
- Partial all-target recovery implementation is at `e91fa7ca2128f4eed8aea06ddd62b1dccecb3a90`. CI `32014619947` exposed one test-state error: the new PostgreSQL test called terminalization while its parent was still `RUNNING`; that single failure left an `UNKNOWN` writer fence which caused nine downstream failures, rather than ten independent implementation defects.
- Initial affected runnable digests: api-web `sha256:f9b5cf18a53487487e823a7e1e443359e0a7eaef4c953e26f1f2bdc970ecfc63`; release-task `sha256:b89651b3b19cbc00a3bd9bf1ddfb545bf04a1db198f6d9d29f0f6d3b8fb56dc7`.
- Previous image hardening commits: `3c6cccfaabff86810db7fd0ee6ac5eace9f181b2`, `0c046a90bb38935e386022d87d3f8d5d279b7b4d`.
- Recovery runs `32015768902` (api-web) and `32016248227` (workers) terminalized parent
  `ffb80c83-401f-4995-a7a0-871e82bd9ee9`. PR `#134` merged the recovery controller to main as
  `45427ae0603f297cc07096c6fbf7c89206390990`; exact candidate/recovery checkpoint remains
  `c64e0910049f9adec533cc05bd0c8f38705487de`.
- UAT `32016719525` stopped before AWS mutation because candidate/controller workflow blobs differed.
  UAT `32016996071` then completed its release task but failed before ECS service intent/rollout when
  AgentCore endpoint creation hit `maxEndpointsPerAgent`. Held zero-intent parent is
  `1412bcbf-d8a4-4c1b-9d9a-1dbed0725558`, stopped task
  `arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/0b4cf52780924717a3c7afcbd65de9ef`.
- Live AgentCore readback: candidate runtime `watchdog_orchestrator_uat_candidate-NwJNiqG5Jd` is READY
  at version 4/source `c64e091...`; endpoints are `DEFAULT`, `candidate_uat_85f98ed6b442` and
  `candidate_uat_2a9cec123ed4`. Active UAT AI Gateway references another runtime/DEFAULT and
  `strands-local`, so both custom candidate endpoints are unreferenced. Root repair is bounded stale
  endpoint retirement plus idempotent runtime reuse and AgentCore-before-release-task ordering.
- Exact zero-intent recovery run `32018662895` succeeded and terminalized the held parent; no new UAT
  may start until the batched controller/policy repair is merged and exact-applied.
- Last successful no-TypeScript CI: `32007755936`; prior release checkpoint `9ec9f59889c6c939959d453e6cac77beaee313aa`.
- PR `#135` merged the batched lifecycle/order controller as main `c251e43441cb285553357f65c5f46ce9f4424d49`;
  reviewed candidate `19a495c6f6a77988a4529a0e788b751366eda8a4` passed CI `32020554160` with the
  application TypeScript suite skipped. UAT prerequisite ceremony and exact readiness passed before the
  only dispatch, UAT run `32021165284`.
- UAT `32021165284` failed before the durable release task because S3 returned `403` for a missing
  content-addressed key under a no-ListBucket deploy role. Manual continuation with its exact signed
  artifact exposed the next controller defect: underscores in the stale endpoint name made the delete
  client token invalid. After manual deletion with provider-valid tokens, runtime v5 and endpoint
  `candidate_uat_19a495c6f6a7` reached READY; safe-read and mutation-refusal hosted smokes both returned
  HTTP 200 with exact source/artifact identity. A reversible second proof then showed AWS tombstones even
  a valid create token after endpoint deletion and returns `ConflictException` instructing a retry without
  that token. Endpoint lifecycle must use deterministic identity/readback without optional client tokens.
  The patched controller then reused exact S3 version `Ugs0dQHWIujNHrgd2HUgnRlnSbGDQWq_`, runtime v5,
  recreated the source endpoint and passed both hosted smokes against AWS; this is controller proof, not
  a signed UAT Passport. The CI controller-only classifier now requires this shell controller and both
  focused contracts rather than unrelated files from the already-merged first batch, keeping unchanged
  application TypeScript skipped while all non-application gates remain enabled.
  No DB parent or ECS rollout was created by the failed run.
Verification:
- Read-only Production preflight during the GitHub outage: all three ECS Express services are
  `ACTIVE` at capacity `1/2`; Production alarms are `OK`; RDS is available, Multi-AZ, encrypted,
  private and deletion-protected; Redis is available with two members, encryption and automatic
  failover; the one-time A5 bootstrap execution role is absent. `origin/main` remains frozen at
  `a637b73d2512e032bf10715812d8e1c363e4dba1`.
- `bash infra/prod-ecs-express/production-serving-mode.spec.sh` passes with the artifact-bound
  AgentCore qualifier in deploy and verifier fixtures.
- `bash infra/docker/production-image-security.spec.sh` passes end to end after pin sync: all UAT,
  A5, READY, Production V2, signed-result and 26 Node migration/authority tests pass without the
  application TypeScript suite.
- `bash infra/prod-ecs-express/production-serving-mode.spec.sh` passes with an ordering assertion that
  prevents AgentCore source comparison before manifest/source resolution.
- Patched `verify-deployment.sh` passes against the three live UAT services at candidate `30718c...`;
  UAT deep database readiness passes separately without exposing the worker token.
- `bash infra/docker/ecr-scan-blocking-findings.spec.sh` passes.
- `bash infra/security/production-security-preflight.spec.sh` passes, including accepted exact waiver and rejected forged waiver.
- Live AWS scan JSON for api-web runnable digest is fully covered (1 raw HIGH, 1 exact waiver, 0 blocking); `infra/docker/verify-ecr-scan.sh` passes that digest.
- Focused recovery TypeScript compilation passes locally.
- Real PostgreSQL recovery integration passes locally: 36 tests, 36 passed, 0 failed, including partial all-target recovery only after every existing intent has exact revalidation evidence.
- `node infra/security/sync-production-maintenance-release-pins.mjs --check` passes (`exactFiles=45`, pins current).
- `bash infra/docker/production-image-security.spec.sh` passes end to end, including recovery controller identity, release-intent ordering, UAT Passport, A5, READY and Production V2 contracts.
- Focused AgentCore controller checks pass: shell syntax, H-15 trust boundary, UAT/Production candidate
  policy actions, endpoint selection fixture, AgentCore-before-release ordering and pre-parent cleanup.
- The complete non-TypeScript production image security aggregate passes after the lifecycle repair;
  workflow YAML parses, maintenance pins remain current and `git diff --check` passes.
- `bash -n infra/ai-gateway/agentcore-deploy.sh`, `bash infra/ai-gateway/h15-trust-boundary.spec.sh`
  and `bash infra/uat/agentcore-candidate-policy.spec.sh` pass for the bounded IAM propagation repair;
  the real Production stage is the provider-side proof of that path.
- Live read-only proof exact-hashed S3 object version `cFg.n5jIOA8DKy9rOQNzqen_ihB93W59` to
  `762f9e79f030edd444d22f30e0133831fd16b8018cda9046c99f68de96e8dbbd`, equal to runtime v4/source
  `c64e091...`; active ECS protects zero endpoints and the reviewed selector identifies exactly the two
  stale UAT candidate endpoints.
- 2026-08-17T17:02Z (post-recovery window): branch-protection endpoint returned the exact protected
  policy on two consecutive reads; zero active UAT/READY/Production runs except stale ghost readiness
  run `31611733340` (2026-08-12, zero jobs, cancel still returns HTTP 500 — platform ghost, isolated
  per runbook known-issues table). Reran only failed jobs of READY `32041268834` (attempt 5).
- READY `32041268834` attempt 5 failed at "Stage and read back the exact Production AgentCore
  candidate": instant silent exit 1 from its first command `test -n
  "$AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF"`. Proven root cause: the readiness job env block never
  maps `vars.AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` (deploy-uat.yml:154 and
  deploy-production-v2.yml:80 both do); the step reads the undeclared `env.` value. The `production`
  environment variable exists (`DPO-2026-07-23-bedrock-global`, 2026-08-07). Attempts 1–4 died
  earlier in the platform incident, so attempt 5 was the first execution of this gate. No AWS
  mutation: the step failed before any aws call; prior steps were read-only Passport
  download/verification. Rerunning `32041268834` again cannot succeed — every rerun executes the
  same defective frozen controller blob.
- Controller-only fix branch pushed: `fix/readiness-ai-global-approval-ref` (one env-mapping line in
  production-readiness.yml). Local gates: production-image-security.spec.sh RC=0 end-to-end,
  maintenance pins exactFiles=45 status=current (file not pinned), YAML parses, git diff --check
  clean. PR creation is pending GitHub API write-path recovery (three bounded attempts returned 503;
  a new "Incident with GitHub.com" is open).
- Parallel-operator reconciliation (2026-08-17T17:3x–18:0xZ): a second operator session merged the
  equivalent readiness env fix as PR `#148` (step-level `vars.` mapping; main → `96b4e7e`) and
  dispatched live READY `32050706417`, which SUCCEEDED at 17:56:19Z. This session's identical
  hotfix branch `fix/readiness-ai-global-approval-ref` was never opened as a PR (no duplicate) and
  is obsolete. READY artifact
  `production-release-ready-v2-292e750…-run-32050706417-attempt-1` validated field-by-field:
  requestedMode=live, legal.mode=OWNER_OVERRIDE, approvedBy=MangmeeDev,
  ownerApprovalRef=OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONDITIONAL-LIVE, source `292e750…`,
  uatRun `32038712267`, controller `96b4e7e…`, expiry ~2026-08-18T17:24Z. origin/main equals the
  READY controller. A HIGH npm advisory (GHSA-ggr8-5vv4-36mx, deepmerge-ts<8) published today
  fails Security Audit on every branch; fix is PR `#149` (pnpm override → 8.0.1, proven locally)
  — HELD from merge until the promote completes so origin/main keeps matching the READY controller.
- Production V2 `32052830392` (dispatched 18:00:00Z by the parallel operator with the correct
  inputs: UAT 32038712267, READY 32050706417, live) FAILED attempt 1 at the FIRST step ("Bind the
  protected controller and verify signed Passport/READY artifacts") with a silent exit 1 at
  18:00:22 — before any AWS credential configuration or mutation; the evidence upload failed on
  "no path" because the evidence dir was never created. Root-cause analysis: the 6.5s silent
  window after `git fetch` matches the protection-endpoint curl with `--retry 2 --retry-delay 2`
  exhausting retries on a platform 5xx and the bare `test "$status" = 200` failing silently;
  the same protection read passes the workflow's exact jq minutes later, origin/main is unchanged
  at `96b4e7e` (rules out controller drift), and the READY-run field checks pass by hand. Same
  GitHub instability class as READY attempts 3–4 (unresolved GitHub incident was still open at
  dispatch time). No production mutation exists.
- Promote attempt 2 (rerun 18:08Z after 3-min operator-collision grace + 3×200 endpoint probes)
  failed IDENTICALLY: silent exit 1, 6.69s after the step's git fetch (attempt 1: 6.56s). Root
  cause PROVEN by full local replay of the bind step (185 lines, my token, cosign installed,
  read-only): every check through the AgentCore binding validation PASSES locally — protection
  jq shape, READY/UAT run fields, artifact metadata/extraction, BOTH cosign bundle verifies,
  ready/passport validators, manifests. The one component not exonerated was the very first
  network call, and it was then caught red-handed: GitHub's
  `GET /branches/main/protection` intermittently returns 503 (observed live at ~18:4xZ from this
  machine while `GET /branches/main` reports protected=true). The step's curl uses
  `--retry 2 --retry-delay 2 --retry-all-errors` = ~6-7s of retries before writing the 503, then
  the bare `test "$status" = 200` dies silently — matching both attempts' 6.5-6.7s signatures to
  the decimal. READY 32050706417 passed the same call at 17:32 by winning the same lottery the
  promote lost twice. GitHub incident still unresolved; PAT and branch protection are healthy.
- Latent defect found during replay (report upstream, do not fix mid-release): the
  `zipinfo -1 | grep -Fxq clone-result.json && profile=migration` idiom is SIGPIPE-racy under
  pipefail (grep -q early-exit can 141 the pipeline and silently select the wrong profile);
  reproduced once on macOS. Also: the silent `test "$status" = 200` should echo the status on
  failure — one-line diagnosability fix for a follow-up PR, not now.
- RELEASE COMPLETE (2026-08-17): promote `32052830392` attempt 3 (rerun by the parallel operator
  session at ~18:44Z after the endpoint stabilized) succeeded at 20:02:20Z. Signed result
  `production-release-result-v2-292e750…-attempt-3`: state=PROMOTED_LIVE,
  requestedServingMode=live, effectiveTarget=all, controller `96b4e7e…`, UAT `32038712267`,
  production run `32052830392`. Stage E verified by this session at ~20:1xZ: durable
  PlatformAccess already OPEN (persisted from the 2026-08-16 opening; no rewrite performed),
  servingMode=live, canOpen=true, SYSTEM_ADMIN seed login/identity/permission pass,
  public sessionless readback OPEN, /login page `data-platform-access="open"`, system page 200
  with session, logout 204, post-logout /me 401, no secrets retained. §E.7: all three services
  ACTIVE with exact source `292e750…`, PRODUCTION_SERVING_MODE=live, currentDeployment=null,
  all three RollbackAlarms + security posture OK. Release ledger: UAT_RUN_ID=32038712267,
  READY_RUN_ID=32050706417, PROD_RUN_ID=32052830392 attempt 3.
Next:
- Owner: run the 15-turn real Production conversation acceptance over LINE (note: candidate
  292e750 does NOT include the camera-size intake fix — photo turns may 413; the fix is PR
  #146/#147 and ships next). Then the deferred concurrency test.
- Post-release queue progress (2026-08-17T20:0x–20:39Z): #149 merged (main `88434a4`,
  minimal enforce_admins lift-merge-restore, protection byte-exact readback ×2); develop synced
  `430ed93`; #146 branch updated → 11 checks green → merged normally (`e424227`); #147
  auto-closed via sync `12cf3ce`; deploy-speed phase 1 PR #150 (rebased `0bd7c73`, full gates
  re-run green) merged, develop synced `572de3b`; docs PR #151 open and HELD (main freeze).
- Phase-1 verification chain + camera-fix release: candidate `1bb4e9cf` (PR #146 head, 11-check
  PR CI green; ancestor of develop ✓; ci.yml/deploy-uat.yml blobs match controller
  `9756559f` ✓; zero active release runs except the documented 08-12 ghost). UAT dispatched
  20:39:37Z → UAT_RUN_ID=32066977783 (title verified). Main FROZEN from this dispatch until the
  chain completes. Plan: after Passport + deep DB readiness, wait auto-READY terminal, dispatch
  live READY reusing OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONDITIONAL-LIVE (the directive governs
  this conditional-live launch window per its ledger decision — recorded here for audit), then
  promote live and record phase-1 step timings vs spec targets (live rollout expected
  26m→~19-20m: canary bakes 0, post-shift 3m kept, adaptive polling).
- Phase-1 verification promote `32070713324` FAILED 21:22→21:32 at the rollout step:
  `watchdog-bms-deploy-production` lacks classic `ecs:DescribeServices` (AccessDeniedException on
  all three services inside ensure_prod_rollout_configuration — the UAT role has held
  DescribeServices/UpdateService since the UAT fast-rollout helper; the production role only held
  Express Gateway actions and nothing production-side used classic APIs until phase 1). Fail-closed
  worked as designed: error BEFORE intent creation → zero ECS mutation, services stayed
  ACTIVE @ `292e750` live, alarms OK throughout, customers unaffected. Reviewer lesson recorded:
  phase reviews must include the deploy role policy diff for every new AWS API a change introduces.
  Held parent `63b12332-629e-4f76-934f-b8f9c9a5a4ef` (HELD_FOR_ROLLOUT, zero intents, stopped task
  `…ee0e225e…`): PRE_INTENT recovery attempt 1 `32072088963` failed its executor-CI gate (used the
  merge-commit main SHA which has no exact CI — known contract); attempt 2 `32072293160` uses
  CI-validated `1bb4e9cf` as recovery_ref. IAM fix PR `#152` open (2-action template diff, gates
  green); prerequisite ceremony apply BLOCKED on owner: `thawatchai` AWS session expired and the
  one-time bootstrap role is absent by design. Passport `1bb4e9cf` valid to ~2026-08-18T21:07Z —
  ample time.
- IAM prerequisite applied (2026-08-17T22:1xZ): owner re-authenticated the `thawatchai` profile
  (NOTE: it resolved to the account ROOT principal this time, deviating from the prior ceremony's
  non-root thawatchai IAM user — recorded as an owner-accepted deviation for this narrow apply).
  Rendered the merged reviewed template (PR #152, main `d68ecad…` lineage) with account
  substitution, validated JSON + zero placeholders, snapshotted the prior policy for rollback,
  `iam put-role-policy watchdog-bms-deploy-production/watchdog-bms-production-deploy`, exact
  readback matched on attempt 1 (12×5s budget), and `iam simulate-principal-policy` proves
  ecs:DescribeServices + ecs:UpdateService = allowed on the prod service ARNs.
- Recovery attempts 1–3 of parent `63b12332…` all failed pre-mutation at controller gates:
  attempt 1 `32072088963` (merge-SHA recovery_ref has no CI), attempt 2 `32072293160`
  (PR-CI is event=pull_request; production requires workflow_dispatch CI on main), attempt 3
  `32073996121` (git 128 `Not a valid commit name 9756559f` inside the recover job's own
  fetch-depth:0 checkout — unexplained; sidestepped by using the branch TIP as recovery_ref).
  Exact-main CI dispatched on the post-#152 tip: `32074224710` @ `d68ecad…`; recovery attempt 4
  will use that tip as recovery_ref once its Typecheck+PostgreSQL proof is green.
- Chain progress: UAT `32066977783` SUCCESS 20:39:38→21:07:05 (27m27s; CI reused, publish leg
  8.8m with cold api-web build 7m50s, deploy job 17m06s incl. the new AgentCore staging step);
  Passport `…1bb4e9cf…-attempt-1` present; deep DB readiness ok/ok. Auto-READY `32069421348`
  SUCCESS (maintenance shape, proves #148 env fix live). Live READY `32070082331` SUCCESS —
  artifact validated: live/OWNER_OVERRIDE/MangmeeDev/exact directive ref/source `1bb4e9cf`/UAT
  `32066977783`/controller `9756559f`. Promote dispatched 21:21:57Z →
  PROD_RUN_ID=32070713324 (title verified, main==controller). Phase-1 measurement run.
- (superseded) After GitHub API is provably healthy: open/merge the reviewed controller fix PR on `main`, then per
  runbook §1 row 2 (controller-only change, images unchanged) dispatch ONE new live READY on the
  updated controller reusing the still-valid Passport:
  `production-readiness.yml -f uat_run_id=32038712267 -f requested_serving_mode=live -f
  owner_legal_override_ref=OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONDITIONAL-LIVE` (supersedes the
  earlier "rerun only failed jobs" instruction, which attempt 5 proved impossible). Passport expiry
  ~2026-08-18T14:40Z. Then validate the signed live READY artifact, dispatch Production V2 once with
  UAT `32038712267` and the new READY ID, complete durable customer `OPEN`, and run the 15-turn real
  Production conversation acceptance.
- Retry UAT only after the post-`services-stable` standard ECS view requires two agreeing
  stable snapshots. Run `32036388019` proved the Express deployments and the finalizer were
  healthy, but workers was read 159 ms after its steady-state event and the one-shot verifier
  incorrectly classified that transient view as drift. Persistent transition remains bounded;
  reviewed-control drift still fails immediately.
- Reconcile both exact intents of UAT parent `dbc89233-8108-43f8-bcad-0503b2063ed1`, merge the shared
  qualifier-contract repair with unchanged application TypeScript skipped, then dispatch UAT once.
  After its signed Passport: run the armed one-time A5 bootstrap, issue signed live READY, promote the
  exact UAT digests to Production, complete durable customer `OPEN`, then run live parity/conversation
  verification.
