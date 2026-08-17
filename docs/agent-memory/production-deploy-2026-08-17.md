# Agent Memory: production-deploy-2026-08-17

Status: In progress
Owner: Product owner / Codex
Scope: Recover the interrupted all-target UAT release, then promote one immutable LINE AI release through UAT, signed READY and Production.
Decisions:
- Hosted concurrency is deferred under `OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONCURRENCY-DEFERRED`; the release remains conditional and the deferred test must still be performed after opening.
- Do not run the TypeScript suite for release/security-only changes. Merge the reviewed change under the owner's admin-bypass authorization, restore branch protection, then create an empty release checkpoint whose CI proves `code_changed=false` and skips TypeScript.
- AWS ECR currently maps `CVE-2026-14456` to Debian source package `openssl` `3.0.20-1~deb12u2`, while its own description says the issue begins with OpenSSL 3.5 QUIC server support. Use only the exact, expiring, digest-recording exception in `infra/docker/ecr-scan-blocking-findings.jq`; all other HIGH/CRITICAL findings remain fail-closed.
Open questions:
- None for the current UAT dispatch. Customer `OPEN` and deferred concurrency remain post-promotion state transitions.
Artifacts:
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
Next:
- Merge the bounded IAM propagation controller fix without re-running unchanged application TypeScript,
  dispatch UAT once, run the armed one-time A5 bootstrap, issue signed live READY, promote the exact UAT
  digests to Production, complete durable customer `OPEN`, then run live parity/conversation verification.
