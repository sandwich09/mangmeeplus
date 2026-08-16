# Agent Memory: production A5 v2

## 2026-08-16 — live rollout rollback at the customer/internal boundary

- Production deploy run `31897008213` passed Passport/READY validation, the current-runtime and
  mutation-boundary rechecks, maintenance close/drain, and the reviewed Production migration.
- ECS Express rolled back only api-web candidate revision `5017415791246681753`. The provider
  reported `ROLLBACK_SUCCESSFUL` because its generated rollback alarm observed 100% target 5xx.
- Sanitized CloudWatch evidence bound every 5xx to scheduled `/v1/internal/*` worker calls. The new
  API returned `platform_access_closed` while the durable customer switch was CLOSED, even though
  those public internal controllers independently require the exact `X-Worker-Token`.
- Decision: keep customer access fail-closed, keep the rollback alarm enabled, and exempt only
  public `/v1/internal/` machine routes from the customer switch. Each controller's existing
  constant-time machine credential check remains the trust boundary; `maintenance_only` continues
  to stop workers and block internal traffic at the proxy.
- Closed recovery restored all three exact candidate images and passed deep service health, but its
  drain proof rejected a missing `RELEASE_DEPLOY_TARGET=all` workflow binding. The recovery step now
  binds that exact target, and its contract test rejects a future omission.
- Next: complete automatic closed-stage recovery, merge the focused guard regression, issue a fresh
  UAT Passport because the API image changes, then rerun READY and the live Production promotion.

Status: COMPLETE for repeatable technical deployment through `PROMOTED_CLOSED`. Fresh UAT Passport,
Production READY, exact-image Production V2 promotion, global maintenance proof and secret-safe
SYSTEM_ADMIN acceptance passed on 2026-08-14. Customer launch remains intentionally closed.
Owner: Codex / release owner
Scope: Replace the circular A5/U5 Production ceremony with a signed UAT Release Passport V2,
precomputed Production Readiness V2 and a minimal exact-image promotion.

Decisions:

- 2026-08-12 provider-readiness hardening: the one-time non-root ceremony exact-applies and
  bounded-readbacks the UAT deploy policy as well as 16 Production durable roles (17 durable roles
  total), with 12×5s propagation tolerance. READY binds exact PG 18.3 source/snapshot/KMS and the
  approved AgentCore source `eaa9005a1857b3cd582ceda743977496ed955110` to a versioned,
  content-addressed S3 artifact, exact execution role/no boundary, MMDSv2 and Production identity.

## Owner authorization and cost boundary

- เมื่อ 12 สิงหาคม 2569 ผู้ใช้อนุมัติให้ดำเนินงานที่จำเป็นทั้งหมดภายใน repository และ deployment
  control plane เพื่อทำให้เส้นทาง UAT → Production เสถียรในระยะยาว รวมถึงการแก้ source, controller,
  IAM/runtime contracts, tests, docs และ prerequisite automation ที่อยู่ในขอบเขตระบบนี้
- การอนุมัตินี้ไม่ใช่สิทธิ์ให้ใช้ GitHub Actions เป็นเครื่องมือค้นหา error เนื่องจากทุก run มีต้นทุน
  ห้าม dispatch, rerun หรือใช้ CI/deploy workflow จนกว่า proof matrix, local/offline aggregate,
  live read-only exact readback และ non-mutating provider canary ที่จำเป็นจะผ่านครบและมีการ review
  แบบ adversarial แล้ว
- หลังหลักฐานครบ ให้ใช้ GitHub Actions เท่าที่จำเป็นตามเส้นทางเดียวเท่านั้น:
  reviewed PR/CI หนึ่งรอบ → UAT หนึ่งรอบ → Passport/Readiness → Production promotion ห้ามแตกเป็น
  blocker-fix runs หรือ retry โดยไม่มี root-cause evidence ใหม่
- ผู้ใช้อนุญาตให้ Codex self-review และ self-approve/admin-merge exact reviewed commit ได้ต่อเนื่อง
  ตั้งแต่ 2026-08-12 จนกว่าจะยกเลิก การอนุญาตนี้ไม่ลด branch/CI/proof gates: ต้องผูกการอนุมัติกับ
  exact head SHA ที่ local aggregate, provider-faithful fixture และ required CI ผ่านครบ ห้าม bypass
  failing/pending check หรือ merge commit ที่เปลี่ยนหลัง review
- ผู้ใช้ยืนยัน standing self-approval นี้อีกครั้งเมื่อ 2026-08-13 โดยมีเป้าหมายให้ UAT และ Production
  deploy ซ้ำได้อย่างเสถียร สิทธิ์นี้ครอบคลุมการ review/approve/merge และ prerequisite ceremony ที่ผ่าน
  exact proof แล้วเท่านั้น ไม่ครอบคลุมการ dispatch เพื่อค้นหา error หรือการข้าม failed/pending gate

## Permanent execution contract

- ก่อนเสนอหรือรันแผนใด agent ต้องรู้เส้นทางตั้งแต่ต้นจนจบ ไม่ใช่เฉพาะขั้นถัดไป ทุกขั้นต้องระบุ
  caller จริง, command/API จริง, input/output, state mutation, failure/cleanup path และขั้นตอนถัดไปจนถึง
  terminal state ที่ผู้ใช้ต้องการ
- ทุก AWS/GitHub/database/filesystem boundary ต้องมี permission matrix ที่ผูก exact
  `principal + action + resource + condition` เข้ากับ caller ใน repository และต้องพิสูจน์ว่า live
  policy/trust/config ตรงกับ matrix ก่อนรันจริง การมี action อยู่ใน template อย่างเดียวไม่ใช่หลักฐาน
  ว่า API รองรับ resource scope นั้นหรือ live authority ใช้งานได้
- สิทธิ์ในที่นี้รวม runtime semantics ด้วย: container UID/GID, volume ownership/mode, writable paths,
  read-only root filesystem, container dependency, secret/KMS injection, endpoint/network reachability,
  database role/transaction privilege, credential duration, provider response shape และ cleanup authority
  ต้องถูกพิสูจน์ ไม่ใช่ตรวจเฉพาะ IAM JSON
- หลักฐานต้องแบ่งเป็น 4 ชั้น: static contract, focused/adversarial test, live read-only exact readback และ
  provider canary ที่ไม่มี secret/DB/customer-data mutationสำหรับสิ่งที่ read-only พิสูจน์ไม่ได้
  ช่องใดเป็น `UNKNOWN`, `ASSUMED`, stale หรือพิสูจน์ได้แค่จาก task เก่า ให้สถานะทั้ง flow เป็น
  `BLOCKED`; ห้าม dispatch เพื่อใช้ error จริงเป็นตัวค้นหา prerequisite ถัดไป
- ก่อน workflow จริงต้องทำ dry traversal ของทุกขั้นตามลำดับ รวมสิทธิ์/เครื่องมือ/TTL/session budget,
  artifact expiry, main/controller equality, retry/idempotency และ cleanup residual ทุกจุด แล้ว review
  ผลรวมแบบ adversarial อย่างน้อยหนึ่งรอบ ต้องตอบได้ล่วงหน้าว่าแต่ละขั้นจะทำอะไร ใช้อะไร ใช้เวลาประมาณ
  เท่าใด สำเร็จพิสูจน์จากอะไร และล้มแล้วกลับสู่ safe state อย่างไร
- ห้ามแก้แบบเฉพาะ error ล่าสุดแล้ว retry หาก root cause หรือ contract shape ซ้ำใน sibling path ต้องกวาด
  ทุก caller และแก้จุดร่วมใน PR เดียว ก่อน retry ต้อง rerun proof matrix ทั้งหมด ไม่ใช่เฉพาะ focused test
  ของไฟล์ที่เพิ่งแก้
- เป้าหมายก่อน execute คือไม่มี deterministic/configuration/permission/runtime error ที่ควบคุมได้
  เหลืออยู่ Provider outage ที่พิสูจน์ล่วงหน้าไม่ได้ต้องมี bounded retry, idempotency, credential reserve
  และ deterministic cleanup; ห้ามเรียก flow ว่า ready ถ้า failure นั้นอาจทิ้ง mutation หรือ residue
  โดยไม่มี recovery ที่พิสูจน์แล้ว
- การอนุมัติจากผู้ใช้ให้เดินต่อไม่ได้ลด contract นี้ Agent ต้องหยุดเองเมื่อหลักฐานไม่ครบ และรายงานช่อง
  ที่ขาดก่อนขออนุมัติหรือทำ cloud mutation

- UAT remains the only place that runs source CI and builds/signs application release images.
- A resolved-all UAT emits one signed passport containing runtime, release-task and migration-tool
  digests, SBOM/signature evidence, migration catalog and UAT acceptance facts.
- Requested `auto` uses the strict Production-eligible controller checks before target resolution;
  only the later resolved target controls selective image publication/deployment.
- Production readiness is read-only against live Production. No pending migration is the quick
  path; a checksum-valid applied subset uses repository-minus-applied as the exact pending set on a
  private clone. The Production ledger's historical execution order remains hash-bound evidence but
  is not required to equal the current repository directory order.
- Known destructive pending SQL is forbidden from automatic promotion and is checked when
  classifying the ledger, in clone rehearsal and inside the durable Production DB fence.
- Production deploy accepts only an unexpired signed READY whose controller and active baseline
  still match. It does not build, typecheck, test, generate SBOM or sign application images.
- Candidate application bytes come from the accepted source; security/controller bytes come from
  protected `github.workflow_sha` on main.
- Selective deployment fails safe to all. Current split Production baseline requires the first V2
  convergence release to target all.
- OPEN→CLOSED drains signed URLs once for 900 seconds; CLOSED→CLOSED proves continuous closure and
  does not repeat the drain.
- Failed closed-stage rollout recovers the exact UAT candidate in maintenance mode, proves it, then
  reports the requested promotion as failed instead of silently succeeding/opening.
- Technical closed deployment and customer-live legal approval remain separate. Keep one explicit
  owner promotion action after READY.
- One-time A5 bootstrap authority is administrator-created and self-revokes after any attempt to a
  metadata-only recovery policy. That policy cannot mutate IAM, Secrets Manager, ECS, or the
  database; it exists only so an interrupted post-success workflow can prove the sole AWSCURRENT
  reader secret, absent execution role, zero ECS residue, and exact controller state without another
  administrator ceremony. Normal readiness uses the durable read-only role afterward.
- Release-tool ECR tags include workflow run and attempt, so rerunning the same source cannot collide
  with the immutable migration-tool repository; every downstream contract still binds the digest.
- Infra contract specs use runner-standard `grep -E`, not workstation-only `rg`; the consolidated
  suite is verified with an exported failing `rg` shim to prevent this portability regression.
- Production `release-prepare` keeps the Passport-proven release-task image and runner unchanged;
  its controller alone replaces the AWS CLI's approximately 10-minute ECS waiter with one shared
  absolute 35-minute budget across detached reconciliation, subnet retry and the new task. Exact
  DescribeTasks reads use 5s connect/10s read timeouts and two standard attempts.
- Production deploy credentials refresh independently before durable preparation, closed recovery
  and finalization. The 360-minute job ceiling adds no happy-path wait; the bounded 320-minute slow
  failure model leaves 40 minutes for action/provider overhead while every credential phase remains
  below its fresh 7200-second session.
- Consolidate into one reviewed change; do not return to a sequence of blocker-fix PRs.

Open questions:

- Independent approval of the V2 trust boundaries and one-click-after-READY promotion boundary.
- Exact first-green timings for UAT Passport, live quick readiness and A5 restore/rehearse/cleanup.
- Counsel/privacy-owner evidence before `PROMOTED_LIVE`; current legal manifest remains blocked.
- Provider-only proof: DB instance-class orderability/quota, exact policy-token API ability,
  AgentCore/ClamAV active runtime and forced-failure zero-residual canary.

Artifacts:

- `docs/specs/production-a5-v2-spec.md`
- `docs/plans/production-a5-v2-readiness-matrix.md`
- `docs/plans/production-a5-v2-plan.md`
- `.github/workflows/production-a5-reader-bootstrap.yml`
- `.github/workflows/production-readiness.yml`
- `.github/workflows/deploy-production-v2.yml`
- `infra/security/validate-uat-release-passport-v2.sh`
- `infra/security/validate-production-release-ready-v2.sh`
- `infra/security/validate-production-release-result-v2.sh`
- `docs/runbooks/production-a5-u5-promotion-ceremony.md` (V1 frozen reference)
- `docs/runbooks/uat-production-v2-deployment.md` (current operator runbook)

Verification:

- Full `infra/docker/production-image-security.spec.sh` passes, including Passport, artifact
  extraction, readiness, READY, baseline, clone, deploy/result/recovery, serving mode, maintenance,
  release-safety, security preflight and A5 bootstrap contracts.
- API migration classification/DB-fence tests pass 4/4 and API typecheck passes, including
  destructive SQL negative cases.
- Critical workflow YAML parses, changed shell/JSON syntax and maintenance pins pass; `git diff
  --check` passes after the repeat-safe immutable ECR tag fix.
- The controller-only release-prepare waiter passes fake-AWS delayed-success, provider failure,
  unexpected-task, one shared cross-invocation deadline, stuck-call termination, bounded-timeout,
  stopped-nonzero/deferred-exit-check, forwarding and unchanged release-task render-boundary cases.
- PR CI run `31538531091` exposed missing `rg` on GitHub Ubuntu; all four remaining infra-spec
  dependencies were removed and the full security suite passes while `rg` is forced to exit 127.
- PR #37 merged as `cbd87fdef73cf1f503e0a8e70fbc22222ab1b801`; all three administrator
  bootstrap controllers completed with exact read-back and the temporary administrator group was
  removed. First V2 UAT run `31551394010` reused CI and published all runtime images, then stopped
  before UAT mutation because the reusable workflow incorrectly tested `github.event_name` for
  `workflow_call` and skipped the required release-tools artifact. The controller now binds the
  required `source_ref` input instead, with a focused regression assertion.
- PR #38 merged as `ea0919c51585f5c1c46e2facf2ff5cdee05c8171`. UAT run `31555002308`
  proved both release-tool matrix jobs execute, then stopped before UAT mutation because ECR
  rejected the Bookworm migration-tool base at 3 Critical / 6 High findings (`perl`/`expat`). The
  one-shot tool now uses an independently pinned Alpine base; API runtime bytes remain on their
  existing base. A temporary ECR probe of the exact migration-tool target passed the repository's
  real `verify-ecr-scan.sh` gate at index digest
  `sha256:0896d992bd09e563ea7043d5e986a7b8a0611be0855ac0aad8ed1b4822e8e3bc`
  and linux/amd64 child digest
  `sha256:6bf1d96fc9d411721525ddf4b96d66498dec5c342bc841ff9798c9fcb45a9b4b`;
  the diagnostic ECR repository was deleted after verification.
- PR #39 merged as `e919f42cd7f143ab46acd83eff6ea89e81eb7aa4`. UAT run `31557014597`
  reused CI and passed UAT environment readiness, then stopped before UAT mutation because the
  separately published release-task still selected the development-oriented Bookworm `local`
  target and ECR rejected it at the same 3 Critical / 6 High threshold. Release orchestration now
  has its own labelled target inheriting the scanned one-shot Alpine runtime; the local developer
  target and API service runtime remain unchanged. The exact release-task target passed the real
  ECR scan gate at index digest
  `sha256:8a8634752c975f87a9a9a440145ffd316a80e857a7fa18e20741d1c5cb8bc717`
  and linux/amd64 child digest
  `sha256:971259b349d7710d1ab76499c34781af42b5cb4f306f41637ec7e580c147fcde`;
  the diagnostic ECR repository was deleted after verification.
- PR #40 merged as `3155d57053df441d1ddf1a5f88fc197e6f01e75a`. UAT run `31558387102`
  reused exact PR CI and proved all three runtime images plus both one-shot tools through build,
  ECR scan, keyless signing and SBOM generation. It then stopped before the release task, database
  or service mutation because the exact UAT deploy-role template did not include
  `watchdog-bms-migration-tool` in its signature-read resources. Add that repository to the existing
  least-privilege `BatchGetImage`/layer-read statement, bind it with a regression assertion, apply
  and read back the exact policy, then rerun UAT from the same accepted source. The same forward
  audit found that the one-time reader bootstrap verified the private migration-tool image before
  assuming its already-scoped ECR-capable role; move only that image verification after role
  assumption and ECR login, and bind the order in the focused bootstrap spec before rerunning.
- UAT run `31559662937` then passed end-to-end and minted Passport V2 for source
  `672f7f553a6df01b13b824b9bc1dc72c43465db5`. The automatic read-only readiness attempt was
  cancelled before its known missing reader prerequisite, and bootstrap run `31560740448` proved
  Passport/ECR/signature authorization before failing during subnet validation. The jq predicate
  incorrectly iterated the top-level AWS response object with `all(.[]; .State...)` instead of the
  exact `Subnets` array. No reader secret/task/DB role was created. Fix the same malformed predicate
  in bootstrap plus the two legacy A5 runners and bind it against a realistic describe-subnets
  fixture before re-arming the intentionally self-revoked bootstrap roles.
- PR #42 merged as `082610275cf12cac7ab7279839cbc3099294ce82`. The exact templates were
  re-armed after proving the failed run left a deny-all bootstrap controller and no execution role,
  reader secret, task or clone. Bootstrap run `31562759277` then passed Passport, ECR and subnet
  validation before AWS rejected `CreateSecret` with `Access to KMS is not allowed`. The bootstrap
  controller's explicit deny omitted the KMS calls that Secrets Manager performs on the caller's
  behalf. Grant only `kms:GenerateDataKey`/`kms:Decrypt` for creation and `kms:Decrypt` for the four
  secret-reading task execution roles, restricted to the account's exact `aws/secretsmanager` key
  and `kms:ViaService=secretsmanager.ap-southeast-1.amazonaws.com`; bind those limits in the focused
  policy spec before re-arming and retrying the same Passport.
- PR #43 merged as `9b45507df96b5093ef8a97d074ee270b1c298a00`; KMS policy simulation,
  exact-template apply and `CreateSecret` all passed in bootstrap run `31563842280`. ECS then
  rejected the newly registered task because it could not assume the execution role. AWS's ECS
  task-role documentation explicitly says a specific cluster is not supported in `aws:SourceArn`;
  the trust must use the account/region wildcard. Both A5 execution trust templates had the invalid
  cluster task path. Replace only those two SourceArn values with
  `arn:aws:ecs:ap-southeast-1:311414082667:*`, retain exact `SourceAccount`, and bind both focused
  specs before re-arming and retrying the same Passport. Cleanup again proved deny-all controller,
  deleted execution role and absent reader secret.
- Read-only audit from the design phase found existing A5 network/clone resources and Production
  RDS/Redis baselines, but the A5 read-only DB secret is still absent.
- Production active source was split between API/AI and workers at audit time, so the first V2
  release remains all-target.
- The current-health controller recognizes the exact pre-V2 Production source, image digests and
  complete serving-control tuples only as a one-time live bridge because those three services do
  not yet expose `PRODUCTION_SERVING_MODE`. Remove this exact allowlist after the first successful
  closed rollout; every subsequent revision must carry and satisfy the explicit serving-mode
  contract.
- No workflow dispatch, UAT/Production deploy or PR merge was performed in this implementation
  turn. After the complete local/adversarial proof passed, the owner-approved prerequisite
  ceremony applied and exact-read back the reviewed durable IAM/SSM/S3 contracts under the
  temporary non-root bootstrap role; it did not run application code or a deployment workflow.
- Reader-bootstrap replay is now a closed, pre-image state machine: the controller's revoked
  policy permits only exact secret/IAM/ECS metadata reads and explicitly denies everything else.
  A rerun classifies the controller/secret/execution tuple before git, ECR or cosign. Only an exact
  completed tuple may prove the tagged reader secret and sole AWSCURRENT version, execution-role
  NoSuchEntity, exact controller role/policy, and three stable-empty task/task-definition reads,
  then emit EXISTING without mutation. The FULL-policy completed tuple performs that same pure
  readback before the final self-revoke; every unsafe tuple fails before image access. Any
  incomplete normal-path attempt, including one that started with a pre-existing reader secret,
  must delete and stable-prove that secret absent before removing execution/controller authority;
  an unreconciled ambiguous or denied deletion preserves authority and fails closed.
- Live read-only inventory on 2026-08-12 proved all runtime secret metadata (including Typhoon),
  nine SSM pointers, cluster/network, RDS/Redis, logs/KMS/SNS and service-linked roles. Known drift
  is finite: deploy/security/workers/A5/API/AI IAM contracts need the reviewed prerequisite
  bootstrap, and the S3 lifecycle is missing the reviewed noncurrent-version expiration rule.
  `WORKFLOW_WEBHOOK_ALLOWED_HOSTS=none` and the exact `AGENTCORE_RUNTIME_ARN` were added to the
  Production environment and read back successfully on 2026-08-12.
- The consolidated security aggregate now invokes the clone network/bootstrap/runner/workflow and
  shared-deadline release-prepare tests directly, then finishes with
  `production image security scanner: pass`. Changed shell/JSON/YAML syntax and `git diff --check`
  also pass.
- Reader-bootstrap run `31580117628` proved why this permanent contract is required. IAM/ECR/network
  checks passed, but the exact Fargate task failed before application code because the bind-mounted
  `/tmp` was `root:root 0755` while `tsx` ran as non-root `node` and attempted to create
  `/tmp/tsx-1000`. Cleanup then left the task definition ACTIVE because
  `ecs:DeregisterTaskDefinition` does not support resource-level scoping although the policy used a
  task-definition ARN. These were deterministic provider/runtime contracts that should have been
  proved before dispatch. No retry is allowed until the proof matrix covers this shape and every
  sibling one-shot task, plus cleanup, Readiness and Production end to end.
- The converged no-Action audit then found the complete deterministic chain that must be closed in
  one stabilization change: migration-tool needs Dockerfile `chmod 1777 /tmp` plus matching
  `VOLUME ["/tmp"]`; six child calls across clone/readiness/apply must use image-native Prisma/TSX
  binaries instead of absent runtime `pnpm`; bootstrap must list/deregister exact-family task
  definitions at `Resource:"*"` before self-revoke; clone restore must authorize exact subnet,
  parameter and option groups; clone `ListTasks` must use `Resource:"*"` with exact cluster
  condition; Production `LINE_AI_AGENT_RUNTIME` must be `agentcore`. The old Passport pins the
  broken image and is forbidden after these source changes.
- Provider-readiness hardening now binds the independently deployed AgentCore runtime to approved
  source `eaa9005a1857b3cd582ceda743977496ed955110`, its exact versioned S3 artifact, runtime role,
  exact trust/inline policy with no permission boundary or attachment, production deployment
  identity, MMDSv2, protocol and entry point. The signed prerequisite also exact-validates the
  normalized secret/SSM/network/S3/monitoring shapes, optional Typhoon 12/13-secret coupling,
  PostgreSQL 18.3 source/groups/orderability, integer quota arithmetic, a recent encrypted automated
  snapshot and the reviewed AWS-managed Secrets Manager KMS key.
- The consolidated temporary-authority wrapper exact-proves the role and user bridge before use,
  bounds IAM propagation retries, preserves the helper failure status, and unconditionally retires
  bridge → role policy → role with three `NoSuchEntity` proofs after every attempted mutation,
  including accepted-but-lost provider responses. A losing concurrent create-role ceremony does not
  delete the winner's authority. Its same non-root session now applies and exact-reads the UAT deploy
  policy containing `ecs:ListTaskDefinitions` before any new UAT build.
- Promotion baseline comparison no longer treats the entire live prerequisite hash as stable:
  quota/snapshot observations may legitimately change between READY and promotion. The current
  prerequisite artifact is still exact-validated and capacity/headroom must remain safe, while
  immutable runtime/IAM/RDS/Redis baselines remain drift-sensitive.
- Focused offline proof passes for promotion resources, runtime readiness, READY positive and
  adversarial resource shapes, baseline comparison, AgentCore trust boundary, and temporary IAM
  ceremony. No cloud mutation or GitHub Action was run for this proof.
- The final local aggregate passes after the runtime root-cause fixes: the linux/amd64 migration
  image carries `/tmp` as `root:root 1777` through the matching OCI volume, runs direct Prisma/TSX
  offline as uid 1000 with a read-only root filesystem, and has no runtime `pnpm` dependency.
  Bootstrap, reader, catalog, clone and apply keep their exact one-container task shape.
- Shared ECS one-shot control now closes both provider ambiguity classes. Registration and RunTask
  reuse one stable request identity after accepted-but-lost responses; cleanup discovers exact
  late tasks/definitions, stops tasks before deregistration, proves stable absence, rejects foreign
  identity and reports collisions after cleaning owned residue. Release preflight task definitions
  additionally bind mode, source, logical run/operation and the complete canonical network, so a
  new run/attempt/network cannot consume a stale STOPPED preflight while a retry of the same request
  remains idempotent.
- Reader bootstrap classifies controller policy, controller trust, reader-secret state and bootstrap
  execution role trust/inline policy/attachments before git/ECR. Exact completed state is replayable
  under the metadata-only recovery policy without mutation; every unsafe tuple fails before image
  access and every incomplete attempt preserves authority unless cleanup is independently proved.
- Final frozen maintenance byte contract covers 44 controller/runtime files and syncs to validator
  SHA-256 `1a6beafc704ad418ee0dcc301f74fa82076b3631ce8aa56d40fcb9cadfc09b6d`.
  `infra/docker/production-image-security.spec.sh`, focused failure fixtures, changed shell/JSON/YAML
  syntax, exact-key jq negatives and `git diff --check` all pass after that sync. No GitHub Action or
  cloud mutation was used to obtain these results.
- Provider read-only proof binds the latest eligible automated Production snapshot to enabled
  AWS-managed `alias/aws/rds` key
  `52b4943e-e9d7-4fae-b71c-c13b0b157b27`; READY rejects any other snapshot KMS key. Even for this
  AWS-managed RDS key, encrypted restore requires the caller to authorize `kms:CreateGrant` for the
  RDS forward-access session. The clone controller therefore grants only that exact key, only via
  `rds.ap-southeast-1.amazonaws.com`, and only when `kms:GrantIsForAWSResource=true`; direct user
  grants, other keys and other services remain denied.
  AgentCore's versioned artifact read now grants both `s3:GetObject` and `s3:GetObjectVersion`.
- GitHub Production environment variable `LINE_AI_AGENT_RUNTIME` was changed from the stale
  `strands-local` value to exact `agentcore` and read back on 2026-08-12. This config mutation does
  not dispatch a workflow or alter the currently running service; the next candidate still needs
  normal READY/runtime verification.
- The owner-approved prerequisite ceremony completed on 2026-08-12 with the exact root fallback
  boundary: root created and retired only the temporary role/bridge while the assumed non-root
  role applied and exact-read back all 17 durable IAM roles, the three clone SSM group pointers and
  the reviewed Production S3 lifecycle. Independent post-ceremony reads returned `NoSuchEntity`
  for the user bridge, temporary role policy and temporary role; the Production deploy role read
  back `MaxSessionDuration=7200`, clone pointers read back
  `watchdog-bms-prod-db-subnets` / `watchdog-bms-prod-pg18` / `default:postgres-18`, and both S3
  lifecycle rules read back enabled with one-day noncurrent-version expiration. No GitHub Action
  was dispatched.
- A separate post-ceremony read-only provider traversal passed without reading secret values:
  PostgreSQL 18.3 `db.t4g.medium` returned four orderable encrypted Multi-AZ-capable options, the
  DB-instance quota was 2/40 (38 free), the recent encrypted automated snapshot used the exact
  enabled AWS-managed `alias/aws/rds` key, AgentCore was `READY` version 14 with Production
  identity/MMDSv2/versioned artifact, S3 versioning/lifecycle matched, and all 13 secret metadata
  plus nine runtime SSM pointers validated. The ceremony scripts' no-argument “dry run” is only a
  static syntax/template check; it must never be represented as live permission/provider proof.
- Live UAT run `31600821945` completed successfully on source/controller
  `1e6c5f6389c9636c690bc859936999f8de5f398d` and issued the signed Passport V2. It reran full CI
  because it was dispatched with the merge SHA rather than exact reviewed PR head
  `81b2ac26d90b235dbca11326af80a668c71e1139`. Permanent cost rule: dispatch UAT with the exact PR
  head SHA that owns the successful PR CI, after proving it remains an ancestor of both current
  `main` and `develop` and its CI/UAT controller blobs equal current `main`; never substitute the
  merge SHA merely because its tree is equivalent.
- Reader bootstrap run `31603942687` created `watchdog_a5_prod_ro`, produced one AWSCURRENT reader
  secret version, deleted the execution role and installed the exact revoked controller policy.
  Independent ECS readback bound the exact evidence task/family/definition and confirmed its sole
  `bootstrap` container stopped with exit code `0`; the reader data-plane result itself is valid.
  Independent readback then rejected its zero-residue claim. The provider-correct account-wide query
  found three inert ACTIVE definitions:
  `watchdog-a5-production-bootstrap-1e6c5f6389c9:1`,
  `watchdog-a5-production-bootstrap-672f7f553a6d:1` and
  `watchdog-a5-production-bootstrap-672f7f553a6d:2`. AWS ECS
  `ListTaskDefinitions --family-prefix` requires a full family name; it is not an arbitrary prefix.
  Therefore multi-family cleanup must list the account-wide ACTIVE set and filter exact allowed ARNs
  locally. Provider-faithful fixtures must emulate this behavior. Readiness runs `31603782882` and
  `31605514234` were cancelled; the latter stopped during read-only baseline before A5/clone or
  application mutation. Production Readiness stays disabled until this controller fix merges,
  bootstrap is re-armed/rerun once, and independent readback proves zero ACTIVE bootstrap task
  definitions and tasks.
- The same API-semantics sweep found one sibling false proof before another paid run: clone cleanup
  computed a stable-empty threshold for task definitions but terminal success checked only the final
  residual count. The controller now requires both zero residual and the actual threshold. An exact
  late-visible fixture proves that an ARN first seen at poll 60 followed by one empty poll fails
  closed, while appearance at poll 58 followed by three stable empties succeeds. No IAM widening is
  required; the other three `ListTaskDefinitions --family-prefix` callers already pass full family
  names and were reviewed as provider-correct.
- UAT deep database readiness was proved separately without another Action run using the non-root
  `watchdog-bedrock` profile and the AWSCURRENT UAT worker token: the authenticated endpoint returned
  `service=api`, `status=ok`, `db=ok` at `2026-08-12T14:12:06Z`. Token value was not logged.
- Owner directive 2026-08-15 permits a live launch before counsel returns the five legal evidence
  files. The implementation does not falsify the `BLOCKED` manifest: only manual live readiness by
  GitHub actor `MangmeeDev` can bind a validated owner approval reference into signed READY as
  `legal.mode=OWNER_OVERRIDE`. Verified-bundle, Passport, IAM, migration, health, recovery and
  expiry gates remain unchanged. Production result binds the exact READY hash for audit.
- Cleanup hotfix PR `#47` merged as controller `33ed788ccc644502e572fe2d679aac9b2b98cc6e` after
  required CI and independent approval. The owner-approved temporary ceremony then re-armed the
  exact reader controller/execution roles under the assumed non-root principal, exact-read back all
  durable prerequisites, retired the bridge/temporary role and independently returned
  `NoSuchEntity` for all three temporary authority reads. Bootstrap rerun `31610040988` succeeded
  from the existing UAT Passport without rebuilding UAT, retained sole AWSCURRENT reader version
  `ddcfa904-43de-48d1-9169-1910058d3c87`, self-revoked and produced three independent stable reads
  with zero running bootstrap tasks and zero ACTIVE bootstrap task definitions.
- Valid Readiness run `31613163594` bound UAT `31600821945`, `maintenance_closed` and controller
  `33ed788...`; its Passport, image signatures and OIDC security role passed. It failed before the
  first A5/clone step because `require_absent_role` declared `name` and an error path containing
  `$name` in the same `local` command under `set -u`. No clone or Production mutation occurred.
  Local regression now executes the production function itself: the pre-fix bytes reproduce
  `name: unbound variable`, fixed bytes accept only `NoSuchEntity`, and `AccessDenied` explicitly
  returns nonzero without relying on contextual `errexit`. The complete runtime collector then
  passed against live read-only AWS data and emitted valid runtime/prerequisite evidence; all focused
  READY/deploy/signed-evidence contracts and the full production image security aggregate pass.
- Readiness run `31611733340` is a GitHub control-plane ghost created three seconds after enabling
  the workflow: it has no resolved inputs, jobs, check runs, pending deployment, concurrency lease or
  billable time, and both cancel endpoints return HTTP 500. It cannot reach AWS with valid inputs;
  do not treat it as READY or rerun it.
- Runtime-readiness fix PR `#48` merged as controller
  `d3e60cb3beaf0963621a275e69309eee13f67763` after all required CI and exact-head approval.
  Readiness run `31617623221` then passed the previously failing runtime baseline and configured the
  A5 read-only controller, proving that fix on GitHub/OIDC. The catalog step stopped before RunTask:
  AWS registered `watchdog-a5-production-catalog-31617623221-a1:1` and returned the documented
  DescribeTaskDefinition volume normalization `{name:"tmp",host:{}}`, while both catalog and legacy
  A5 read-only validators still expected the unnormalized registration input `{name:"tmp"}`.
  CloudTrail independently proves RegisterTaskDefinition succeeded, no RunTask occurred, and the
  EXIT cleanup deregistered the exact revision before three stable absence reads. The provider-shape
  fix requires exact empty `host:{}` in both validators and rejects any `host.sourcePath`; focused
  fixtures and the actual inactive provider definition pass that contract without another Action.
- Provider-shape PR `#49` merged as controller
  `cce08acca8e918db259f707a663ee655fdf9dced`. Valid Readiness run `31620271256`
  then passed Passport, signatures, complete runtime/prerequisite collection and A5 controller
  configuration. Its Production catalog task launched exact task
  `c8abd5684f974da982b703cb448c3d5d`, exited `1`, and was fully cleaned with the task definition
  `INACTIVE`; clone and Production mutation did not start. A read-only UAT ledger diagnostic proved
  the systemic classifier defect: several older-named migration directories were introduced and
  applied during later releases, but the code required database execution history to equal one
  global lexical repository prefix. The correction validates a unique applied name/checksum subset,
  computes pending as the exact repository set difference, preserves real `started_at,id` order in
  the evidence hash, and shares that pending set with readiness clone and the durable Production
  fence. Unknown/duplicate names, checksum drift and failed/unfinished rows remain fatal. The UAT
  diagnostic also found one historical checksum drift for
  `20260804130000_remote_release_operation_lease`; it does not weaken the Production gate.
  Production's Aug-8 reconciliation/source history binds that migration to the current checksum,
  and the next corrected Production catalog task must still fail closed if live bytes differ.
  Prisma 7.8's official contract says `migrate deploy` applies all pending migrations without a
  drift reset. A local PostgreSQL canary then proved the exact non-prefix case: after applying
  `20260102000000_second`, adding the older-named `20260101000000_first` caused the next deploy to
  apply only `first`; the database ledger correctly remained `second → first` and both tables
  existed. This executable proof is why the classifier preserves DB order while deriving pending by
  set difference.
- Offline verification for the set/checksum correction passed before any further Action: focused
  catalog/READY/clone/apply tests `25/25`, the complete API test suite, workspace `pnpm typecheck`,
  maintenance pin sync/check, and `bash infra/docker/production-image-security.spec.sh` through its
  final `production image security scanner: pass` gate. An exact PostgreSQL 18 upgrade canary then
  applied the 121 migration files from Production source `b6eccc8...`, applied only the ten current
  repository-minus-applied migrations to reach 131, passed the corrected exact catalog verifier,
  and returned `No pending migrations to apply` on an idempotent third deploy.
- Set/checksum PR `#50` passed exact-head CI `31623712999`, was approved on commit
  `5b81d16dca762a7df2b79c5bece346fb7837973b`, and merged as controller
  `d75e06b5cb93420dfa718a8e8c570803af83dc62`. Fresh UAT run `31624931285` correctly reused that CI;
  Resolve, environment policy, all image/tool builds, filesystem verification, Prisma validation,
  ECR vulnerability scans and cosign signatures passed. It stopped before UAT deployment because
  `anchore/sbom-action` tried to fetch Syft `v1.42.3` once from a GitHub release page and received
  HTTP `503`; one failed-job retry received status `000` at the same download. No additional retry
  was dispatched. The durable fix replaces all three action calls with one local generator that
  downloads the exact official Linux asset through its immutable GitHub API asset ID, verifies
  SHA-256 `0d6be741...`, caps the operation at 300 seconds and retries four times for all HTTP/network
  errors before executing Syft. The executable fixture, real Linux Syft scan and complete Production
  security aggregate pass.
- SBOM durability PR `#51` passed exact-head CI and merged as controller
  `4cf85f1d17dfc93219ea8323068a994bda724ace`. Fresh UAT run `31627553314` reused reviewed CI,
  passed all five bounded SBOM/image/tool publication gates, deployed and health-verified the exact
  immutable UAT release, retired superseded builds and issued Passport V2 for source
  `3f58ae175a7939451fd2af250b6abe9250f28c88`; the Passport expires on 2026-08-19.
- Automatic Readiness run `31629222597` bound that Passport and `maintenance_closed`, passed all
  image signatures, live runtime/prerequisite evidence and the corrected Production catalog. It
  classified ten exact pending migrations and entered isolated clone rehearsal. The first
  `RestoreDBInstanceFromDBSnapshot` failed before a clone DB existed with
  `KMSKeyNotAccessibleFault`. CloudTrail bound the subordinate denied call to
  `kms:CreateGrant`, `invokedBy=rds.amazonaws.com`, on exact key
  `52b4943e-e9d7-4fae-b71c-c13b0b157b27`; the identity policy's explicit boundary omitted that
  action. Cleanup completed its ambiguity window; no clone DB, ECS task/definition or Production
  mutation was created. Do not rerun Readiness until the exact grant permission is merged, applied
  through the reviewed temporary non-root ceremony and byte-read back.
- Clone KMS permission PR `#52` passed local adversarial/full aggregate and exact-head PR CI
  `31631336935`, was approved on `a1e314a3b6d6463ab38538678f85c6ac77cd740a` under the standing
  owner authorization, and merged as controller `0e1a18cb6b02b909371891ffa7c5ac8f70e7930d`.
  The first full prerequisite ceremony then stopped before its first durable write: RDS metadata
  read succeeded, but Secrets Manager still returned implicit deny while the newly created role
  policy propagated. The wrapper nevertheless proved temporary bridge, role policy and role
  `NoSuchEntity`; live clone policy remained at the prior bytes. A full retry is forbidden because
  that mode also re-arms the already-complete reader-bootstrap controller/execution tuple. The
  durable correction is a scoped clone-controller mode whose temporary policy can only inspect and
  replace the exact clone role inline policy, with bounded transient retry and executable proof that
  it calls no RDS/Secrets/SSM/S3 or reader-bootstrap API.
- Scoped ceremony PR `#53` passed all exact-head required checks and merged as controller
  `37f9ccf8f1bf89f476c755fd4f0c3efa3bd870ce`. The scoped non-root ceremony applied and exact-read
  the clone controller policy; independent readback proved the reader controller remained in its
  metadata-only recovery state and the bootstrap execution role plus all three temporary authority
  objects returned `NoSuchEntity`. Manual Readiness `31662579595` then proved the complete runtime
  baseline and Production catalog, restored an encrypted PostgreSQL 18.3 isolated clone and reached
  an active RDS-managed secret. Its task failed before establishing a measured DB connection, and
  cleanup exposed a separate exact permission defect: after RDS deleted the clone it removed the
  ownership tag used by the controller's `DescribeSecret` condition, so stable secret-absence proof
  was denied. READY/signing/upload were skipped, the clone DB was deleted, and Production was not
  mutated. The next correction must remove that stale metadata tag dependency, add bounded
  data-plane convergence inside the isolated task, and emit only a finite safe failure-stage code;
  no further Readiness run is allowed until the exact image/policy contracts pass a fresh UAT.
  Independent post-failure readback proved the exact clone DB, RDS-managed secret, ACTIVE task
  definitions, RUNNING tasks and observed ENI were all absent. IAM simulation of the correction
  permits only `DescribeSecret` on `rds!db-*`; `GetSecretValue` and application-secret metadata
  remain implicit-deny. Cleanup accepts a missing primary-DB tag only after the exact secret ARN was
  captured from the exact run-owned DB and that DB reached stable `DBInstanceNotFound`; a conflicting
  owner tag remains fatal. Focused clone/policy/evidence/workflow tests, API typecheck and the full
  Production security aggregate pass. A real linux/amd64 migration-tool build also passes its
  non-root, read-only-root, writable `/tmp`, no-network, Prisma validate and direct TSX import probes.
- Fresh UAT `31666726359` for source `578ad7a6...` reused exact reviewed CI, published and signed all
  immutable images/tools, deployed UAT `all`, passed digest/health verification, retired superseded
  builds and issued Passport V2. Automatic Readiness `31667908525` bound that exact Passport and
  controller `08e2786...`, passed the complete read-only runtime/catalog gates and restored an exact
  encrypted private PostgreSQL 18.3 clone. The clone connected to the database but failed at the
  `migrate_deploy` stage; cleanup independently left no DB. Reproduction with the exact signed
  migration-tool digest against a temporary PostgreSQL 18 instance proved the image contains only
  `schema-engine-debian-openssl-3.0.x` while its Alpine runtime searches for
  `schema-engine-linux-musl-openssl-3.0.x`. The failure therefore occurs before any candidate SQL,
  not from Production data. The smallest fix reuses the existing Debian `system` stage for the
  one-shot image and makes the image verifier execute an offline `prisma migrate diff`, which the
  broken signed image deterministically fails. Independent post-run reads proved the exact clone DB,
  managed-secret tag set, ACTIVE task definitions, RUNNING tasks and task ENI private address all
  absent. A real linux/amd64 fixed image then passed non-root/read-only/no-network schema-engine
  execution, applied all 131 migrations to PostgreSQL 18 and returned `No pending migrations to
  apply` on a second deploy. The exact four API migration suites passed 26/26 and the full Production
  security aggregate reached `production image security scanner: pass`.
- Forward review before the fix PR uses exact linux/amd64 images labelled with the reviewed branch
  commit.
  The migration-tool ran as uid 1000 with a read-only root and no network, and its in-image
  reader/catalog/READY/clone/apply suites passed 28/28. Against PostgreSQL 18.3 it first applied the
  exact 121-migration Production baseline, then the full image applied only the ten migrations
  classified pending by Readiness, and a third deploy returned `No pending migrations to apply`.
  The inherited release-task image has the same exact source label/user/workdir/`/tmp` contract and
  its Prisma native-engine validation passed under the same read-only/no-network boundary. Its one
  in-image unit mismatch is test-only: that spec reads a repository incident fixture never consumed
  by production runtime; the host release-task suites remain in the full aggregate. No migration,
  release or controller runtime command depends on Alpine/musl. The Debian image is about 47 MB
  (16%) larger than the failed Alpine image, with no repository size ceiling and ample existing ECS
  task/job wait budgets; the same pinned Debian base is already used by the UAT-scanned API image.
  The existing executable verifier fixture now also rejects a mutable image reference and truncated
  source SHA before Docker is called, closing the Bash `set -e` regression rather than relying on a
  static grep.
- PR `#55` passed exact-head CI `31677083645`, was approved on
  `d40ac03e99eb38ce7b416fd6f5a434de0b024653`, and merged as controller
  `ed9fae5608630b99a89406df3230a463d2abb030`. Fresh UAT `31678176013` reused that exact CI: all
  validation fan-out was skipped, the UAT environment preflight passed, all three service images
  published successfully, and the fixed migration-tool image passed its immutable filesystem,
  non-root, read-only/no-network and native Prisma schema-engine checks. Its ECR vulnerability gate
  then stopped the run before UAT deployment. Read-only inspection of the exact scanned amd64 child
  digest bound all three Critical and five High findings to unused `perl-base`, and the remaining
  High to `libexpat1` pulled only by the unused fontconfig stack. The migration-tool stage now purges
  the font stack before `perl-base` (so package post-removal scripts remain executable) and its
  executable image verifier rejects all four installed-package residues. Exact local linux/amd64
  migration-tool and inherited release-task builds then passed as uid 1000 with read-only roots,
  no network, writable `/tmp`, Prisma validation/native schema diff and zero target packages. The
  focused clone/bootstrap gates, maintenance pins and full Production security aggregate through
  `production image security scanner: pass` also passed; service runtimes are unchanged. No UAT
  deployment, Passport, Readiness or Production mutation occurred in the failed run.

Next:

1. Open one scoped PR for the locally proved scan remediation and require exact-head CI before one
   fresh UAT `all`; the prior Passport cannot be reused because both tool image digests change.
2. Allow only the automatic Readiness bound to that fresh UAT Passport. Require clone migration PASS,
   computed zero residual resources and signed READY; do not dispatch a duplicate manual run.
3. Freeze `main`, dispatch one `maintenance_closed` Production V2 promotion and verify exact digests,
   global maintenance controls, health, admin-onboard access and signed release evidence.
4. Keep customer launch closed until independent legal evidence is complete.

- PR `#56` passed exact-head CI and independent approval, then merged as controller
  `b6b8489fd5db1f7bd8f5342a9b76a5fdb56b8838`. Fresh UAT `31682462366` reused that CI and passed
  every service/tool build, ECR scan, signature, migration/release task, immutable deployment,
  digest/health check, finalization and Passport V2 publication. Automatic Readiness `31683966766`
  bound the exact Passport, passed the complete runtime/catalog/IAM gates, restored PostgreSQL 18.3,
  applied the ten pending migrations and then failed only at the reimbursement compatibility stage.
  The exact stopped ECS task exited 1 and CloudWatch emitted
  `production_readiness_clone_compatibility_failed`; cleanup independently proved the clone DB
  absent and no RUNNING clone task remained, so Production was not mutated. Local reproduction on a
  clean PostgreSQL 18 database proved the test was stale after
  `20260804170000_reimbursement_cc2_projection_source`: it attempted a cross-company line update
  that the new composite foreign key correctly rejects with exact PostgreSQL `23503`, before the
  older SQL invariant could observe corrupt data. The production gate also still registered the
  historical 13-test count although the two current source suites contain exactly 11 tests. The
  scoped correction now asserts the exact FK rejection and binds 11/11 in code/docs. A clean
  PostgreSQL 18 instance applied all 131 migrations, then the exact linux/amd64 migration image ran
  as uid 1000 with a read-only root and passed the two required suites 11/11 under the clone timeout
  settings. The image also passed its no-network Prisma native-engine validation/diff, API typecheck
  passed, maintenance pins remained current, and the full Production security/image/workflow
  aggregate reached `production image security scanner: pass`. No Readiness retry against the old
  image is allowed; the correction requires one new UAT Passport because migration-tool bytes change.
- Compatibility PR `#57` and develop-to-main PR `#58` passed exact-head CI/review and produced
  controller `670a81c2...`. Fresh UAT `31692876261` issued a signed Passport for source
  `fd8a503a...`. Automatic Readiness `31694622810` restored PostgreSQL 18.3, applied the exact ten
  pending migrations, passed schema and compatibility checks, stopped its task with exit 0, proved
  DB/managed-secret/ENI absence plus an INACTIVE task definition, and issued signed
  `maintenance_closed` READY with residual count zero.
- Production V2 run `31696302063` exact-verified that Passport/READY and all service/IAM/migration
  baselines, then failed before ingress closure or database mutation while starting the read-only
  maintenance preflight. ECS stopped task `7544e194...` during resource initialization because the
  Logs interface endpoint allowed `ecsTaskExecutionRole` only on `/ecs/watchdog-bms-prod-*`, not
  `/ecs/watchdog-bms-release-task`. Forward audit found the next deterministic boundary in the same
  contract: the apply execution role was absent from ECR and Secrets Manager endpoint policies and
  its exact apply log group was absent from Logs. The scoped correction covers all three endpoint
  policies together. Its negative fixture also exposed that the endpoint validator's jq argument
  `$policy` shadowed its zero-argument `policy` decoder, making every policy comparison true; the
  renamed argument now rejects the actual missing release ARN. The correction adds executable drift
  rejection and a temporary non-root repair mode
  restricted to the four existing interface endpoint ARNs. UAT image bytes are unchanged.

Next:

1. Merge the endpoint-contract PR after exact-head CI and review; do not rebuild UAT.
2. Apply/read back the four endpoint policies with the scoped non-root ceremony and prove temporary
   bridge, policy and role `NoSuchEntity`.
3. Run one manual Readiness against UAT `31692876261`, freeze `main`, then dispatch one
   `maintenance_closed` Production V2 promotion and verify signed result plus admin/API controls.
4. Keep customer launch closed until independent legal evidence is complete.

- Endpoint-contract PRs `#59`/`#60` passed exact-head CI/review and produced controller
  `a101a7f5...`. The scoped non-root ceremony exact-applied/read back all four endpoint policies and
  independently proved the temporary bridge, policy and role `NoSuchEntity`. Readiness
  `31702328225` then passed runtime/catalog checks, rehearsed all ten migrations with task exit 0,
  proved clone DB/managed-secret/ENI absence plus an INACTIVE task definition, and issued signed
  zero-residual READY. Production V2 `31704114803` passed the previously failing release-task
  preflight with a RUNNING task and exit 0, then rolled the exact closed candidate to all three
  services before post-rollout maintenance verification failed. Direct provider probes isolated the
  remaining boundary: raw ECS maintenance GET/POST routes and custom-domain POST routes passed, but
  Cloudflare returned Worker exception `1101` for custom-domain GET routes. The exact verifier sends
  `--request GET` together with `--data-binary '{}'`, so the incoming Worker request has a body. Both
  checked-in host proxies then supplied that body to `new Request(..., {method:'GET'})`, which the
  Fetch contract rejects. Ordinary bodyless browser/UAT GETs pass, explaining the apparently
  contradictory live probes. The scoped correction omits the body only for GET/HEAD, preserves POST
  bodies, and binds both UAT and Production workers with one executable request-method contract that
  reproduces the body-carrying GET. Production database preparation never started; bounded
  closed-stage recovery remained active on the exact candidate.

Next:

1. Merge the two-worker edge correction only after exact-head CI/review, then deploy and exact-probe
   both Worker routes without rebuilding UAT images.
2. Reissue READY for the new controller against UAT `31692876261`, freeze `main`, and dispatch one
   `maintenance_closed` Production V2 attempt.
3. Require signed `PROMOTED_CLOSED`, exact health/digest evidence, global maintenance proof and the
   secret-safe admin/API acceptance journey before calling the deployment stable.
4. Keep customer launch closed until independent legal evidence is complete.

- Cloudflare Worker PRs `#61`/`#62` passed exact-head CI/review and produced controller
  `5d9a6fb3...`. UAT Worker version `8d8181ba` and Production version `3c85a888` now omit request
  bodies for GET/HEAD; exact body-carrying GET probes no longer return Worker 1101, POST forwarding
  still reaches the upstream, both roots redirect to `/login`, and the authoritative Production
  maintenance verifier passed `custom-and-raw-ingress=closed` for target `all`.
- Readiness `31712934773` verified the Passport, controller, images, runtime and IAM, then stopped
  before catalog/clone configuration because the current-health collector rejected two real
  provider shapes. Recovery correctly retains the nonempty legal approval reference while disabling
  the approval flag in maintenance mode, and ECS Express service-revision identifiers are opaque
  decimal strings that may begin with zero. The focused contract now requires the legal reference in
  both serving modes, still requires the approval flag only in live mode, accepts decimal revision
  identifiers including leading zero, and rejects missing references or alphabetic identifiers.
  The exact live collector wrote `/tmp/a5health-exact2.mktbOH/current-health.json`; all three services
  were ACTIVE, maintenance-only, quiescent, one-task/one-healthy-target, HTTP 200, and the signed
  `e0_current_health` predicate returned true. The failed readiness created no clone/catalog task,
  artifact or Production mutation. The prior successful readiness `31702328225` already proved the
  unchanged catalog/clone path for the same UAT source, and Production `31704114803` never entered
  release preparation or database migration.

Next:

1. Merge the scoped current-health provider-contract correction after local aggregate, exact-head CI
   and review; UAT images and Passport `31692876261` remain unchanged.
2. Dispatch exactly one `maintenance_closed` Readiness against that Passport and require signed READY
   plus zero clone residue.
3. Freeze `main`, dispatch exactly one `maintenance_closed` Production V2 promotion, and require the
   signed `PROMOTED_CLOSED` result, exact health/digests, maintenance proof and admin/API acceptance.
4. Keep customer launch closed until independent legal evidence is complete.

- Current-health PRs `#63`/`#64` passed exact-head CI/review and produced controller
  `0c8ff74c...`. Readiness `31716802827` then passed the previously failing provider-shaped health
  contract, applied all ten pending migrations plus compatibility tests to an isolated PostgreSQL
  18.3 clone, and issued signed `maintenance_closed` READY after proving clone DB, managed secret,
  task and ENI cleanup with `residualResourceCount=0`.
- Production V2 `31719327358` verified the signed Passport/READY, images, runtime, IAM, migration and
  service baselines at both read-only and mutation boundaries and proved the already-deployed exact
  candidate remained closed across custom and raw ingress. Its release-prepare task then exited 1
  before launching its migration command because the immutable application guard accepted only
  `deploy-production.yml`, while both the shell controller and maintenance proof correctly carried
  `deploy-production-v2.yml`. The guard runs after taking the advisory fence but before
  `beginRemoteReleaseOperation`; the task log contains no `release operation started` line or child
  migration output, so operation `c2ab5085-ccbd-4404-80a2-b95c1a5c6008` has no durable row or DB
  side effect despite the controller artifact's conservative `RECONCILIATION_MAY_BE_REQUIRED`
  classification. No rollout/recovery/finalization ran and the exact candidate remains closed.
- The scoped correction accepts only the two exact Production controller workflows for every
  release lifecycle mode, keeps UAT exact to `deploy-uat.yml`, and carries the same exact distinction
  into retained-task/orphan recovery. Production V2 recovery binds historical controller identity
  to `deploy-production-v2.yml` while independently binding its immutable candidate image signer to
  `deploy-uat.yml`; legacy Production recovery remains unchanged. The executable controller suite
  passed 32/32 against a real temporary PostgreSQL 18 database, including all durable writer,
  UNKNOWN/reconcile, intent/bind/finalize and orphan-recovery state machines.

Next:

1. Merge the V2 controller-provenance correction after full local aggregate and exact-head CI/review.
2. Run a fresh UAT `all` and require a new Passport because the release-task application bytes and
   digest change; do not reuse UAT `31692876261` or READY `31716802827`.
3. Run exactly one `maintenance_closed` Readiness, freeze `main`, then one Production V2 promotion.
4. Require signed `PROMOTED_CLOSED`, exact migration/finalization evidence, maintenance proof and the
   secret-safe admin/API acceptance before calling the repeatable deployment stable.

- Fresh UAT `31723608941` issued a signed Passport for source `cacdc4a9...`; Readiness
  `31725392101` passed the complete runtime/catalog/clone path and issued zero-residual signed
  `maintenance_closed` READY. Production V2 `31727367323` then passed every read-only and mutation
  boundary, deployed that exact candidate closed to all three services and completed release-prepare
  task `706db707...` with exit 0. The durable parent operation
  `91794761-7661-468c-8e9c-91f5a69b1f06` was held before rollout. Rollout and its closed recovery
  both failed before creating any service intent because the workflow supplied
  `RELEASE_DEPLOY_TARGET=all` to `release-intent`/`release-bind`, even though that variable belongs
  only to the pre-deploy release task. Independent reads prove all three exact candidate services
  remain ACTIVE, singleton, settled, globally `maintenance_only`, with the three bootstrap
  deployments SUCCESSFUL and no durable mutation intent.
- The scoped correction removes that inherited variable from normal rollout and closed recovery.
  The existing recovery workflow gains one fail-closed `BOOTSTRAP_CLOSED` mode for this exact
  zero-intent V2 controller failure: it exact-validates the failed run and its 11-member controller
  artifact, derives the parent task from `release-operation.json`, proves all three service/image/
  revision/deployment/maintenance identities plus deep DB readiness and custom/raw maintenance,
  then runs an immutable recovery executor. The executor double-reads the platform, row-locks the
  exact Production parent, requires the original V2 controller, target `all`, empty manifest and
  zero intents, and records only `RECONCILED_FAILED_CONFIRMED`; it never labels the failed release
  successful or mutates an ECS service. Replay is exact and idempotent.
- Look-forward verification caught and fixed two controller assumptions before PR: the Jobs API
  exposes the unnamed artifact step as its pinned `Run actions/upload-artifact@...` action name,
  and the real archive contains `release-prepare.log` for 11 exact members, not ten. The exact YAML
  step was extracted and executed locally against failed run `31727367323`, artifact digest
  `ecfff6b0...`, current AWS service/deployment state, the production worker-token readiness probe
  and both maintenance ingress paths; it passed and emitted the exact parent task from the artifact
  without relying on ECS stopped-task retention. The durable recovery suite passed 34/34 against a
  temporary real PostgreSQL 16 instance, including rejection when even one unexpected intent
  exists, successful terminalization, exact replay and adversarial service/image/platform drift.
  Both workspace and the CI-specific two-file TypeScript compiles, focused workflow/release-task
  contracts, YAML/shell syntax and diff checks pass. The final synchronized 44-file maintenance
  pin contract is current and the full `infra/docker/production-image-security.spec.sh` aggregate
  reached `production image security scanner: pass`. No recovery task or further Production
  mutation has been dispatched yet.

Next:

1. Freeze the correction, sync the maintenance release pins and require the full local Production
   security/image aggregate plus exact-head CI/review before merge.
2. Run one exact production `BOOTSTRAP_CLOSED` recovery against failed run `31727367323` and prove
   the old parent is `RECONCILED_FAILED_CONFIRMED` with zero intents while all services remain closed.
3. Reissue one `maintenance_closed` READY for controller `main`, freeze `main`, then retry Production
   V2 once; require signed `PROMOTED_CLOSED`, exact migration/finalization evidence, global
   maintenance proof and the secret-safe admin/API acceptance.
4. Keep customer launch closed until independent legal evidence is complete.

- Recovery prerequisite CI `31736001098` completed successfully on exact
  `main@9a9f6ab19ae473485002fc2301d3ecefed5d4959`. The first recovery dispatch
  `31737268451` then failed before its first provider read or mutation because the bootstrap-closed
  evidence step referenced `RECOVERY_REF` under `set -u` without binding the workflow input into
  that step's environment. Identity, checkout, exact CI and OIDC credentials had succeeded; image
  build/signing, ECS task launch and database recovery were all skipped.
- The scoped correction adds only the missing exact input binding and an executable workflow
  regression that parses the named step, requires its complete six-key input/environment map and
  exercises the `set -u` boundary. A whole-workflow dataflow sweep found no other missing input
  binding. The exact YAML step was re-extracted and executed read-only against failed run
  `31727367323`, its live artifact and all current ECS/deployment, deep database and custom/raw
  maintenance proofs; it passed without build, task launch or database mutation. Focused recovery,
  RunTask/register/failover contracts, the current 44-file pin check and the full Production image
  security aggregate all pass.

Next:

1. Merge the exact recovery input-binding correction after exact-head CI/review.
2. Dispatch one `BOOTSTRAP_CLOSED` recovery and require the old parent to become
   `RECONCILED_FAILED_CONFIRMED` with zero intents while all services remain closed.
3. Reissue one `maintenance_closed` READY for controller `main`, freeze `main`, then retry Production
   V2 once and require signed `PROMOTED_CLOSED` plus secret-safe admin/API acceptance.
4. Keep customer launch closed until independent legal evidence is complete.

- PRs `#69`/`#70` merged the recovery input binding as
  `main@78d1792708bc07e882d8b3ddc0bbaaea1b7a7a20` after exact-head approval and required CI.
  Main workflow-dispatch CI `31740166671` passed. Recovery `31741442579` then passed the exact
  failed-run artifact and live pre-mutation proof, built/signed the one-shot executor and launched
  task `6f79b450bdcf43adafe74bba51111579`. The task exited 75 before its database transaction because
  the application required `service.currentDeployment === null`; the settled live ECS Express
  response omits that key. The controller's jq check correctly treated missing as null, so all real
  service evidence had already passed. No operation row or ECS service was changed.
- The scoped provider-normalization fix uses the same nullish settled-state rule already used
  elsewhere in the recovery controller and adds an executable missing-key fixture. A repository
  sweep found no second strict-null instance on this platform field. CI-specific two-file TypeScript
  compilation and the recovery suite pass 34/34 against local PostgreSQL 18.3 with no skips. Most
  importantly, the exact failed-run evidence was passed through
  `validateBootstrapClosedRecoveryPlatform` against fresh real AWS JSON for all three Production
  services and bootstrap deployments; the application validator returned all three exact services.
  The exact pre-mutation YAML step, deep database readiness and custom/raw maintenance controls
  still pass; services remain closed.

Next:

1. Merge the scoped provider-normalization fix after full local aggregate and exact-head CI/review.
2. Dispatch exactly one `BOOTSTRAP_CLOSED` recovery and require operation
   `91794761-7661-468c-8e9c-91f5a69b1f06` to become `RECONCILED_FAILED_CONFIRMED` with zero intents.
3. Issue one controller-current `maintenance_closed` READY, freeze `main`, then retry Production V2
   once.
4. Require signed `PROMOTED_CLOSED`, global maintenance proof and secret-safe admin/API acceptance;
   keep customer launch closed.

- PRs `#71`/`#72` merged the provider-normalization fix as
  `main@56f185174367c421b3bab7b09aac7e88db2ea11b`. Exact-main workflow-dispatch CI
  `31744700212` passed every source, typecheck, PostgreSQL recovery, aggregate, image build/push and
  signing boundary, but the `api-web` publish job failed only while downloading Syft for its SBOM.
  The unauthenticated GitHub REST asset endpoint returned HTTP 403 five times; the workers and
  AI-gateway jobs downloaded the same asset successfully seconds earlier. The image digest
  `sha256:cc22eaa1...` was already pushed and signed, so no service or database mutation occurred.
- The scoped stability fix downloads the same versioned Syft asset from its direct GitHub release
  URL instead of the 60-requests/hour unauthenticated REST endpoint, while retaining the exact
  pinned version and SHA-256. The focused executable fixture, a live direct download/hash readback,
  shell syntax/diff checks and the complete Production image-security aggregate pass.

Next:

1. Merge the scoped SBOM downloader fix after exact-head review/CI, then require one successful
   workflow-dispatch CI on the resulting exact `main` SHA.
2. Dispatch exactly one `BOOTSTRAP_CLOSED` recovery and require operation
   `91794761-7661-468c-8e9c-91f5a69b1f06` to become `RECONCILED_FAILED_CONFIRMED` with zero intents.
3. Issue one controller-current `maintenance_closed` READY, freeze `main`, then retry Production V2
   once.
4. Require signed `PROMOTED_CLOSED`, global maintenance proof and secret-safe admin/API acceptance;
   keep customer launch closed.

## Final closure — 2026-08-14

- PRs `#73` and `#74` merged the pinned direct Syft download as final
  `main@854cc362f25fabc2d4346813d6351631ff4f4eae`. Exact-main CI `31748250413` passed every
  required context and all six Production image jobs, including the previously failing api-web SBOM.
- `BOOTSTRAP_CLOSED` recovery `31749393268` reconciled parent operation
  `91794761-7661-468c-8e9c-91f5a69b1f06` with zero intents while all services remained closed.
- Readiness `31749841233` bound UAT Passport `31723608941`, source
  `cacdc4a91aa6bb3e5512f529991bd42b6a3f2580` and controller `854cc362...`; migration was
  `EXACT_MATCH` and it issued signed `maintenance_closed` READY.
- Production V2 `31750329856` completed successfully with signed state `PROMOTED_CLOSED`, target
  `all` and maintenance state `DEPLOYED_NOT_LAUNCHED`. Exact digest/source/health/deep database,
  global maintenance and durable finalization proofs passed.
- Secret-safe Production acceptance passed: SYSTEM_ADMIN login and `/me`, platform-access CLOSED,
  page access, logout and post-logout rejection. No secret value was printed or persisted.
- Customer traffic remains intentionally closed. Future release operators use
  `docs/runbooks/uat-production-v2-deployment.md`; historical `Next:` blocks above describe prior
  incident checkpoints and are not current instructions.

## Live promotion checkpoint — 2026-08-15

- Reviewed candidate `f7be97f13790e0bf13070613a03662fbb53474d6` passed UAT run
  `31888441617`, deep DB readiness and the branch-scope Production pre-audit. Passport
  `uat-release-passport-v2-f7be97f...-attempt-1` remains valid until
  `2026-08-22T14:16:43Z`; owner live override reference is
  `OWNER-DIRECTIVE-2026-08-15-LIVE`.
- Live Readiness `31889653042` passed owner override, immutable image/runtime, A5 reader and
  Production migration classification, then failed safely in the isolated clone before migration.
  It restored automated snapshot `rds:watchdog-bms-prod-db-2026-08-14-20-10`, but current
  Production had subsequently applied `20260815000000_employee_title_prefix`; the clone therefore
  observed two pending migrations while the exact current ledger correctly authorized only
  `20260815120000_dashboard_scope_branch`. Task exit 1 was
  `production_readiness_clone_source_catalog_failed`; Production DB/services were untouched.
- Independent provider readback proved zero residue: clone DB and RDS-managed secret are NotFound,
  active task set and ACTIVE exact-family task definitions are empty, the only task is STOPPED/1,
  and its ENI is deleted/NotFound.
- Durable correction uses a deterministic, exact-tagged encrypted manual snapshot of the current
  Production DB only for `readiness-v2`, deletes and stable-proves that snapshot absent immediately
  after restore, and includes it in residual accounting. Standalone reviewed-v1 retains its
  existing automated-snapshot evidence contract. Application image bytes do not change, so the
  successful UAT Passport can be reused after controller review/merge and exact clone-policy apply.
- Local verification passed: executable accepted-lost create/delete/foreign-tag cleanup fixtures,
  exact IAM boundary and Access Analyzer, clone runner/bootstrap/workflow, signed evidence,
  READY/readiness/deploy validators, pin sync, `git diff --check`, and the full
  `infra/docker/production-image-security.spec.sh` aggregate through its final scanner.

Next:

1. Merge only after exact-head CI and independent review.
2. Apply/read back only the clone controller inline policy with the scoped temporary non-root
   ceremony; prove bridge/policy/role `NoSuchEntity`.
3. Reissue one `live` Readiness from UAT `31888441617` with the exact owner override, require manual
   snapshot/clone residual zero and signed READY, then freeze `main`.
4. Dispatch one Production V2 `live` promotion, require signed `PROMOTED_LIVE`, open the durable
   platform gate with secret-safe SYSTEM_ADMIN control, and complete public/customer acceptance.

### Readiness evidence correction — run 31892969841

- The fresh current-Production snapshot, isolated restore, exact pending migration rehearsal and
  cleanup all passed live. Independent readback proved the manual snapshot, clone DB, managed
  secret, ACTIVE task definition and task ENI absent; the migration task stopped with exit code 0.
- READY construction then rejected its own clone evidence. The jq expression added the
  readiness-only cleanup field in a separate object whose `.cleanup` read the original `null`
  input, replacing the base cleanup object with only `snapshotDeleted:true`. Runtime cleanup was
  correct; serialized evidence was incomplete.
- The correction builds the complete cleanup object once, adds `snapshotDeleted` inside that
  object only for `readiness-v2`, and injects the finished object into clone infrastructure. An
  executable regression asserts all seven readiness cleanup keys/values and confirms reviewed-v1
  still omits the readiness-only field.

Next:

1. Merge the controller-only serialization correction after exact-head CI/review; no IAM or image
   change is required and UAT `31888441617` remains reusable.
2. Reissue one live Readiness, require the full cleanup object and signed READY, then continue with
   the frozen-main Production V2 live promotion and durable platform opening.

## Live launch closure — 2026-08-16

- UAT `31901904745` completed successfully for source
  `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1` on controller
  `d0604d79dd5d9b97e8b36b213cbe495b39893e69`; its Passport digest is
  `sha256:5084fe1990a06155c63258ec2642ee4269dda4835cdb93f5de0bb491e911cba7`.
- Live Readiness `31903027707` bound owner override
  `OWNER-DIRECTIVE-2026-08-15-LIVE`, passed exact image/runtime/IAM and migration checks, and issued
  READY digest `sha256:c3fa10968f145706ace6579f6dc94513a6bb57269d5f136a199063e8d288fb48`.
- Production V2 `31903336753` completed successfully. Signed result artifact digest
  `sha256:473121865a68047431e481d4bf1b847d9276e86d55b948bb42fbfc32f4e54ebe` records
  `PROMOTED_LIVE`, target `all`, the exact UAT/READY/Production run IDs and the exact source and
  controller commits. All three services are `ACTIVE` with no current deployment; Production
  alarms read `OK`.
- Secret-safe SYSTEM_ADMIN acceptance changed durable PlatformAccess from `CLOSED` to `OPEN` only
  after the signed live result. Readback proved serving mode `live`, protected admin identity,
  `SYSTEM_ADMIN` and `system.launch_gate.manage`, public login state `OPEN`, system page `200`,
  logout `204`, and post-logout `/me` `401`. Password, tokens and cookies were not printed or
  retained.
- `docs/runbooks/uat-production-v2-deployment.md` now records the mandatory fast release protocol,
  the real incident/root-cause/prevention matrix and the terminal PlatformAccess acceptance. Root
  `AGENTS.md` requires every future deploy, recovery, gate change and retry to follow that protocol.

Status: Production is live and customer access is open. The historical `Next:` blocks above are
incident checkpoints, not pending instructions.

## LINE AI release prerequisite checkpoint — 2026-08-17

- AWS admin and operator identities were reauthenticated. The first full prerequisite ceremony failed
  before durable mutation because the temporary role's `rds:DescribeDBInstances` permission had not yet
  propagated; the bounded session-authority canary was added, reviewed and merged as
  `main@1c78a57c85c6423b4ed9dd6379c1144b2f8ecd0d`.
- The next ceremony passed that canary but exited silently at the clone restore verifier. Read-only live
  comparison proved the source DB still uses subnet `watchdog-bms-prod-db-subnets`, parameter group
  `watchdog-bms-prod-pg18` and option group `default:postgres-18`; the policy correctly contained those
  five provider resources plus the deterministic manual snapshot
  `snapshot:watchdog-a5-clone-*`. Both duplicated verifiers still expected only the older five-resource
  contract introduced before current-Production snapshots were added.
- Temporary bridge, temporary inline role policy and temporary bootstrap role were independently read
  back as `NoSuchEntity`. The S3 lifecycle matched the reviewed template. No UAT, READY or Production run
  was dispatched from either failed prerequisite attempt.
- The scoped correction keeps the six-resource least-privilege policy unchanged, updates both the full
  prerequisite and clone-bootstrap live-derived verifiers, makes mismatch failure explicit, and adds
  regression checks so the same stale verifier cannot become the next hosted readiness failure.

Next:

1. Merge the verifier correction only after focused and aggregate security checks plus exact-head review.
2. Run one full prerequisite ceremony from the resulting exact `main`, prove exact durable readback and
   temporary authority `NoSuchEntity`, then continue with one immutable UAT dispatch.
