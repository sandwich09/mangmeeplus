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
Verification:
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
- Live read-only proof exact-hashed S3 object version `cFg.n5jIOA8DKy9rOQNzqen_ihB93W59` to
  `762f9e79f030edd444d22f30e0133831fd16b8018cda9046c99f68de96e8dbbd`, equal to runtime v4/source
  `c64e091...`; active ECS protects zero endpoints and the reviewed selector identifies exactly the two
  stale UAT candidate endpoints.
Next:
- Finish one batched AgentCore lifecycle/order repair, focused non-TypeScript proof, one reviewed merge
  and one scoped prerequisite ceremony. Then run exactly one UAT, signed READY, Production promotion,
  live parity/conversation verification and customer `OPEN`.
