# Agent Memory: Production Kamal migration and two release paths

Status: infrastructure/bootstrap and combined build/local DB rehearsal passed; first-migration controller preparation continues. Production remains ECS fc2838c4; no application release or cutover.
Owner: thawatchai + Codex
Scope: Owner explicitly chose migrating Production to Kamal, then requested isolated-hotfix and
UAT-promotion paths. Immediate release is only the LINE trial-pricing fix from current Production.

Decisions:
- Reuse `infra/kamal/deploy-prod` / shared `release.py` and UAT bootstrap/config helpers.
- Preserve the dirty user checkout; controller work is in the managed `prod-kamal-two-release-paths`
  worktree on `codex/prod-kamal-two-release-paths-20260918`, starting at main `4474e4d6`.
- Source candidate `8f5b508a` is separate from integration PR629 (`fb47309a`, develop-based).
- Production has not moved: fresh non-root AWS read at 2026-09-18T06:26:39Z found all three ECS
  services ACTIVE, each with one configuration on `fc2838c4`. No cloud mutation has occurred.
- Existing command is real, but hard-pins main and requires an already migrated/enrolled target.
  No Production target was found in any of 239 registered local worktree roots.
- Existing UAT signed receipts omit the complete image publication/tools bundle. A promotion path
  must extend and verify signed evidence rather than rebuild or trust adjacent unsigned files.
- First cutover must preserve ECS rollback authority and prevent duplicate Production workers.

Open questions:
- A non-root Production provisioning/deployment principal is not yet established. Available profiles
  are `watchdog-bedrock` / `watchdog-bedrock-dev` (same non-root reader), `mangmee-kamal-uat`
  (UAT-scoped role), and `thawatchai` (root; not used).
- Actual Production Kamal hosts, routes/certificate, signing key, spare AgentCore endpoint and
  authenticated acceptance session still require enrollment. Do not fabricate `cutoverComplete`.

Artifacts:
- Plan: `docs/plans/production-kamal-two-release-paths-2026-09-18.md`.
- Original app hotfix memory is in the `line-trial-pricing-prod-hotfix` managed worktree.

Verification:
- Existing current Kamal controller suite: 24 passed in 0.196s. Local controller proof only.
- App Production-base focused suite: 310 passed; API typecheck passed.
- Integration focused suite: 394 passed; API typecheck passed; CI35314179848 still running at last read.
- Docker29.6.2 Linux/aarch64 available. No candidate image build started in this migration turn.

Next:
- Implement the two explicit source/artifact paths and tests, then prepare/enroll the migration
  infrastructure and staging/rollback ceremony. Preserve all current release controls until the
  reviewed replacement contract is ready. No Production operation or release signature exists yet.

## Current implementation checkpoint

- Latest owner steering: **Hotfix first**, then finish the UAT-promotion path. Migration to Kamal
  remains explicitly authorized; application content must remain Production baseline plus patch only.
- Started `release_source.py` with exact declared-diff/ancestry validation, no schema/dependency/build
  policy hotfix changes, and signed UAT bundle validation. Six local contract tests pass.
- In-progress changes to `release.py`: explicit source/artifact selection, baseline source/config
  inspection, hotfix focused tests, baseline config preservation (no new Postmark/main config), trusted
  KMS UAT receipt verification, immutable promoted image checks, and signed complete UAT bundle producer.
  New wrappers: `deploy-prod-hotfix` and `promote-prod`. Existing 24 controller tests still pass.
  These new branches still need orchestration/failure tests and review. They are not deployment-ready.
- Inspected actual installed Kamal2.12 Ruby: `deploy --skip-push` enforces image service label equals
  target service. A UAT→prod metadata wrapper changes the digest. `app boot` retains native asset
  preparation, health barrier, container labels, proxy switching/drain and lock without rebuilding;
  the in-progress promotion path verifies pulled image IDs and uses it. Cleanup/rollback behavior
  and an actual image proof still need verification. Do not claim digest-preserving rollout proven yet.
- Initial migration remains distinct: these ordinary release methods still require an already
  enrolled/cut-over target. Never set `cutoverComplete` true as a workaround. Need staged enrollment,
  real resource bindings, worker handover and explicit preservation of ECS build/traffic rollback.
- Initial provisioning access was blocked: `mangmee-kamal-uat` received AccessDenied for
  `cloudformation:DescribeStacks` on its own UAT stack. No IAM or cloud write attempted. Asked owner
  for a Production provisioning profile. Owner explicitly supplied `thawatchai`; fresh STS confirms
  it is root. Disclosed this and the limited bootstrap scope to the owner. This supersedes the earlier
  pending-profile state: use it only to prepare the new scoped Production infrastructure/role, never
  as the ordinary release principal, and never expand the UAT role. Read-only discovery has succeeded;
  no cloud write has occurred. The controller's non-root deployment check remains unchanged.
- App integration CI35314179848 is now **success** on `fb47309a`; PR629 remains draft/unmerged.
- Exact isolated source `8f5b508a` is checked out cleanly under this worktree at
  `.env.kamal/production/line-pricing-hotfix-preparation/source`. Existing `build-complete.py` is
  running local TypeScript/all-image/AgentCore build into sibling `build/`; exec session21970.
  This is build-only, with no ECR publication, cloud mutation or deployment. Preserve its result/logs.
- Existing Kamal `migrations()` only syncs then verifies already accepted build authority. Read
  `seed-launch-gates`/attestation flow before extending first-cutover; new hotfix SHA must gain legitimate
  authority without changing HUMAN approvals. Existing retirement retires all non-Kamal-source builds,
  so it must not run unchanged while ECS rollback needs its old source accepted.
- Exact candidate build has passed TypeScript, DI, AgentCore, API/web, AI and workers phases; tools
  image is still building in session21970. No rebuild/retry has been dispatched.
- Saved the actual UAT CloudFormation template and current Production ECS/network/runtime-policy
  inventory privately under `.env.kamal/production/migration-preparation/`. UAT uses its own VPC
  peered to the existing data/ALB VPC and dedicated listener rules. Production needs two API AZs,
  independent runtime roles and staged ingress; copying UAT identifiers or enabling its routes is
  not part of the migration.

## Owner scope addition — confirmation of recording

- Owner said another patch concerning “ยืนยันบันทึก” will be added to the isolated Hotfix.
  `8f5b508a` is therefore the validated pricing-only baseline candidate, **not the final release**.
  Asked which branch/PR will contain the addition and to supply its ready commit. Do not deploy the
  pricing-only artifact while that required addition is pending. Infrastructure preparation can proceed.
- Pricing-only complete build finished successfully in537.539s: TypeScript/DI, all four amd64 images,
  AgentCore. Private result remains at
  `.env.kamal/production/line-pricing-hotfix-preparation/build/build-result.json`; no image publication.
  New source will require its own exact diff and focused checks/build evidence.
- Added a local-only stack renderer using current read-only Production inventory. Proposed topology:
  new10.93.0.0/24 VPC; two API hosts acrossAZa/b; distinct AI and worker hosts/roles; encrypted disks,
  IMDSv2, scoped deployment role/signing key, 14-day logs, host status alarms. Staging ALB rules require
  the exact operator /32 and never start applications or queue consumers. Stack validation is pending;
  no CloudFormation execution or customer traffic cutover yet.

- Owner supplied ready commit`0b0058adbc7353ec906a33746867af2a235b0934`, directly following8f5b508a.
  It is now the selected combined candidate. Verified ancestry and complete15-file diff against
  fc2838c4; no schema, dependencies, build inputs, workflows or infra changes. Added API/web/shared
  contract changes release the cancelled-certificate gate only when an active original receipt exists,
  with the same decision rechecked inside the final transaction. No new DB column or mutation script.
- Existing local logs confirm51contract+117web+385API=553tests, browser1passed7.6s, per supplied
  task memory. Browser uses real local auth/components but mocked expense APIs, not live customer data.
  Verified the GET controller preserves the new server-derived response flag through its spread.
- New clean source/build location:`.env.kamal/production/combined-hotfix-preparation/`; build session40667.
  All TypeScript and DI phases passed; remaining image build ongoing. Preserve pricing-only537.539s
  build as historical evidence, never substitute it for the combined candidate.

## Infrastructure execution ledger

- Corrected the local inline template serialization after read-only `ValidateTemplate` rejected the
  pretty-printed body exceeding51,200bytes; retained evidence. Compact form is42KB and provider
  validation passes. Two focused stack boundary tests pass; existing Kamal/source/stability/shutdown
  suite34tests passes. No repeated deployment run was used to discover this local preparation issue.
- Inspected the one change set:63Add resources exactly matching the rendered template, no replacements
  or deletions. Executed once at2026-09-18T07:01:26.554360Z using owner-supplied bootstrap profile.
  Operation/client token:`hotfix-infrastructure-20260918T070019Z`.
  Stack:`arn:aws:cloudformation:ap-southeast-1:311414082667:stack/mangmee-kamal-production/9d03b750-b32e-11f1-b449-0600dee2ee87`.
  Change set:`arn:aws:cloudformation:ap-southeast-1:311414082667:changeSet/hotfix-infrastructure-20260918T070019Z/bcc926c7-7d43-46e7-ab1e-956354cf0661`.
  Template SHA256:`8d0b8634526b385344854df9919328d4d86e9e08141b29eb809974e943a906cd`.
- New staging SSH and ALB test ingress is limited to the freshly observed operator49.229.201.224/32.
  No application container, worker consumer, customer-wide route, DB migration/sync, launch-gate
  mutation, or application release has been started. ECS remains the customer-serving platform.
- Stack is being monitored under that same identity. Do not dispatch a second create/retry on a
  failure; inspect retained events and reconcile first. Deployment principal remains non-root-only.
- Stack reachedCREATE_COMPLETE. Non-root profile`mangmee-kamal-production` now assumes
  `arn:aws:iam::311414082667:role/mangmee-kamal-production-deployrole` from existingwatchdog-bedrock;
  STS verified. No ordinary release uses root. All four EC2 identities/SSH host keys verified from
  AWS console output, then strict SSH checked cloud-init done/errors[], writable Kamal paths/network
  and pinned proxy0.9.2. An early worker console read lacked its host key while boot output was still
  arriving; retained partial read and re-read only, with no unverified SSH or provisioning retry.
- Actual inventory: VPC`vpc-033eebb5100e0dbbf`; APIa`i-04afe07799fd19f5d`54.169.102.70/10.93.0.10;
  APIb`i-01951e536e32a875d`13.213.1.94/10.93.0.42; AI`i-0e04890bef2ec1bfb`18.140.237.182/10.93.0.74;
  workers`i-028c8f2e05fe5cd84`13.212.141.178/10.93.0.106. API AZa/b; AIc, workersa.
  Signing key`arn:aws:kms:ap-southeast-1:311414082667:key/7bb5d36e-5cfd-46a7-a409-60074ff66acd`;
  new AgentCore`watchdog_orchestrator_production_kamal-Ik7N9qDX8R`, two pinned endpoints.
  `migration-preparation/staging-target.json` deliberately retainscutoverComplete=false; ordinary
  target.json is not installed. Only proxies run, no application/consumer. Public Production health200.
- Non-root Production config capture passes: all3services/12currentsecrets. Live support read uses
  verifiedTLS/watchdog_support_ro/READONLY:182migrations,0unfinished;16OPEN ordinary gates allSYSTEM
  lineage,4CLOSED;0RUNNING/UNKNOWN Production RemoteReleaseOperation; customerPlatformAccessOPEN.
  SSMsession`watchdog-bedrock-dev-rvajntx2pfzqjek9hifl7qoxxq` exited after reads; termination verification
  pending. No data/gate/authority writes were made.
- Additional4new release-path orchestration tests pass. Security script first stopped for missing
  worktree dependencies, then missing generated Prisma client; installed frozen dependencies and
  generated the client without changing manifests. Its corrected run is session58582; do not claim
  the complete security suite passed before its terminal result.
- Combined candidate complete build passed360.504s. Local full Production config validation passed
  for all3actual images, preserving captured config plus explicit topology/source identities:
  releaseId`be3576d99f4507b84a06b516e61b5f70a4cfaa247df7a6c4b3d3c58eebbee4fb`.
- Corrected rehearsal's assumption that every candidate must add migrations: compare the real
  migration catalogs; unchanged hotfix must pass, changed catalog must still be refused. Existing
  PostgreSQL18.3/TLS isolated rehearsal passed all5phases, including three real sync/authority runs;
  result`combined-hotfix-preparation/database-rehearsal/result.json`. No AWS/real customer data used.
- Full production-image-security script now passes after installing/generating required local
  dependencies; final log`migration-preparation/security-specs-after-generation.log` ends
  `production image security scanner: pass`. Existing plus new Kamal suite40tests passed before the
  latest shared-contract allowlist regression was added. Maintenance pin check is current; diff clean.
- Support session status explicitly verifiedTerminated. First-cutover controller/rollback and
  final authenticated acceptance are still outstanding; infrastructure and local proofs are not
  a Production release. Current-main equality guard remains enforced for an actual ordinary apply.

## 2026-09-18 current controller and browser checkpoint

- Latest owner explicitly selected existing Chrome profile Thawatchai for company **Snd Prd**
  (`cmsz0hi6d00bc335uhdamyzs8`) and asked for original receipt → substitute certificate → cancel
  substitute → confirm original, allowing existing records. Browser1 (profile `mangmeeplus.com`,
  called developer by owner) has the existing System Admin `/system/platform-access` page showing
  OPEN/live. Browser2 (Thawatchai) is Snd/owner in Snd Prd. No passwords/cookies were extracted,
  no account reset, and no document or customer-gate mutation has occurred. Authenticated identity
  endpoint navigation was blocked by the browser; exact admin user/permissions and logout acceptance
  still need real observation after deployment. Do not mark browser acceptance passed from these pages.
- Existing certificate SRC-202608-00001 / `cmtva89l500jz204d2ct7z3p9` links Anthropic expense
  `cmtv9zt0u00fu204djyniakim`, but its original PDF is USD while OCR shows200baht, so it is unsuitable
  for blind confirmation. No values were changed. Another existing certificate SRC-202609-00001
  / `cmtv8mh9z008b204daov2uw0b` is680baht; its expense is not editable from that certificate.
  Currently inspecting the845baht original LeoPard receipt marked ready for confirmation.
- Added explicit Production browser acceptance bound to current admin
  `cmt8k20fs00000q319isxwkc5`, with identity/no-password-or-legal-action/live/canOpen checks.
  UAT smoke flags remain rejected on Production. No browser proof has been issued.
- Added first-migration handover/rollback helpers: staged-target validation, ECS source/task/config
  baseline, scoped CF listener condition changes, worker drain including desiredSTOPPED tasks still
  exiting, stop/restart-disable candidate consumers before ECS recovery, and preservation of ECS
  launch authority. The apply path still has an explicit under-implementation stop; no app handover
  has been enabled or run. Ordinary main-controller equality remains enforced.
- Prepared image reuse verifies exact clean source/tree, all image IDs/amd64/source labels, build
  phases/logs and AgentCore bytes. Real combined build reuse identity check passed; original measured
  build360.504s remains in the evidence. No rebuild or image publication occurred.
-49focused controller tests passed at checkpoint4 before the latest workflow-fence/logging additions.
  One earlier test-only Mock assertion-name error and an expected-message mismatch were corrected;
  earlier failure logs are retained. Production native logging now targets its provisioned CloudWatch
  groups; actual driver delivery remains untested until staging.
- Live ECS task readback using existing reader proved one RUNNING immutable fc2838c4 task for each
  of API/AI/workers. The first-migration baseline journal is private. No desired count or role config
  of those ECS services has changed.
- Bootstrap-only root added time-bounded inline policy `first-migration-20260918` to the newly created
  non-root role `mangmee-kamal-production-deployrole`, expiring2026-09-18T13:53:49.513914Z.
  Mutation scope: exact old ECS worker service/its task-definition family, exact two original worker
  pass roles, the new CF stack, and its two new listener rules. Existing API/AI ECS update denied.
  Access Analyzer returned no findings;18resource-specific IAM simulation checks allow exactly the
  four expected action/resource pairs and reject unrelated API changes. No traffic/service changed.
- Read-only preparation operation **20260918T075823Z-9f577bf5** FAILED after54.923s before local build
  reuse/publication because the old AgentCore endpoint read also checks its parent runtime ARN.
  Retained that run. Policyv2 adds only that exact parent read ARN, same expiry/mutation scope.
  Verified actual non-root read after fresh role session: retained old provider READY/version37,
  sourcefc2838c4, artifact743e055b63133cf68bfcaeaafbf244596dc4884231b651fea7a7ecf3498334eb.
  An immediate prior read still denied; no second mutation or deploy was used as a probe.
- A second **preparation-only** run started after the permission fix was proved, via exec session60063;
  log `migration-preparation/combined-first-migration-preparation-2.log`. It reuses the complete0b
  build, executes changed regression files, and checks all config/secret/source freshness. Do not edit
  controller files while it runs; its manifest rejects drift. No actual deploy was dispatched.
- Current main fetched ascc17a699; relevant controller/helper files are unchanged from branch base.
  Main requires one approving review (branch protection readback); no controller PR or review exists.
  App PR629 remains separate/draft. UAT/READY/Production workflow run IDs for this hotfix are NONE.

## 2026-09-18 08:23 UTC implementation and read-only verification

- Preparation`20260918T080339Z-c854a9c3` completed`PREPARED_NO_DEPLOYMENT` in64.852s,
  reusing the verified0b build and passing425focused tests (339API+35web+51contracts). Release identity
  e4eb18f2a410134b5a5c942ec025da610f21b7e791871617e4750459bfe2f893. No app publication/deploy.
- First-migration apply is now implemented; the earlier unconditional under-implementation stop
  has been removed. The exact-main controller gate remains and currently prevents unmerged apply.
  Added worker/CF intent tracking, legacy Production deployment workflow fence, exact old provider
  and routes, CloudWatch native logging, signed full artifact bundle, truthful NOT_EXERCISED LINE,
  immutable migration acceptance snapshot and enrollment only after signed customer acceptance.
- First ECS rollback handles failure after workflow fencing but before complete publication: all
  recovery inputs are validated before taking the lock; no publication manifest is required before
  DB sync. Once DB sync begins, complete publication/tools are mandatory. Unknown/moving AWS state
  still fails closed for read-only reconciliation, not an automatic repeat. No live rollback yet.
- Checkpoint5 had two test-fixture errors: Mock reserved assert_* prevented the newly added durable
  operation check. Explicit fixture method fixed it. Checkpoint6 passes51tests in1.818s. CI now runs
  discovery for the full Kamal suite; production maintenance pins current, diff whitespace clean.
- Read-only probe081654 failed because ECS original rules use ForwardConfig weighted100/0, without
  top-level TargetGroupArn. Actual rule readback established the shape; resolver now accepts one
  active nonsticky group and rejects split traffic. No mutation occurred. Probe081929 passes:
  API172.31.15.63, AI172.31.18.83, worker172.31.1.119, oneRUNNING each, allfc2838c4; both original
  healthy ECS rules retained, new routes operator-only, old AgentCore READY/version37/hash743e055b.
- Chrome reconnected with new browserIDs4(Thawatchai)/5(mangmeeplus.com, owner calls developer).
  Developer profile fresh `/system/platform-access` loads System Admin, OPEN/live. Direct browser
  navigation to auth/me is blocked by client, so exact identity/permission/status acceptance is
  still unproved; do not bypass browser controls or infer it from the heading. No logout performed.
  Earlier Snd receipt Next action attempted an unchanged draft autosave before the browser reconnect;
  success still needs fresh inspection. No substitute create/cancel/final confirmation has occurred.
- Main protection freshly read:1approving review, no named required contexts, admin enforcementfalse.
  Canonical runbook still requires CI/review. No approval waiver or controller PR exists yet.
  UAT/READY/PROD workflow IDs NOT_DISPATCHED. ECS remains customer-serving; cutoverCompletefalse.
- Final local security script completed with `production image security scanner: pass`; final51test
  controller log and maintenance pin check pass. Latest maincc17a699 changes only CI's unrelated
  credit-hold Postgres checks among touched controller paths; retain those when rebasing this PR.
- Fresh Snd Prd receipt845 UI now confirms the unchanged draft save reached step2. Opened substitute
  form and acknowledged its informational tax limitation, but created no certificate. Step2 requires
  missing payer/funds, actual payment date and reason; asked owner rather than invent financial facts.
  No payment checkbox, legal signature, substitute cancellation or final expense confirmation done.

## Review artifact and restart-fence correction

- Controller PR634: https://github.com/MangmeeDev/mangmeeplus/pull/634, attached to the task.
  Initial reviewed head0d6facd6 (rebased onto currentmaincc17a699), CI35324442127 started. No duplicate
  deployment was dispatched. Protection reportsREVIEW_REQUIRED. Application source remains0b0058ad.
- Actual non-root KMS challenge sign/verify passed08:28:26UTC using the new Production key.
  Private signing-preflight/result.json is explicitlySIGNING_PREFLIGHT_NOT_RELEASE_ACCEPTANCE.
- Self-review found that stopped containers with restart=always could return after host restart.
  Candidate inventory now includes stopped containers, rollback disables restart before verifying
  their stopped state, and first migration rejects any preexisting app container. Regression proves
  an exited auto-restart worker blocks ECS restoration until restart is disabled.52tests pass1.457s.
  This is a new controller correction, so the next PR-head CI supersedes the initial run; no app image
  rebuild or cloud mutation is needed. The prior full security suite passed before this correction;
  exact updated-head CI must run its security checks before merge.
