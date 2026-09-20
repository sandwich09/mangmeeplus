# Agent Memory: Production Kamal migration and two release paths

Status: COMPLETE under the owner's explicit browser HTTP waiver. Both isolated Production hotfixes are deployed and their behavior is merged into main and develop.
Owner: thawatchai + Codex
Scope: authorized ECS-to-Kamal migration, isolated trial-pricing/cancelled-substitute receipt fix, then isolated trial FAQ card/semantic fix. No unrelated UAT/main backlog deployed.
Decisions: preserve exact Production baselines; retain failed attempts; stop browser checks per owner; sign explicit waiver without fabricated observations.
Open questions: None required for this delivery. Default urllib supplemental public read returned403; cause unproved, while signed OPEN and three public-route/login observations passed.
Artifacts: [Consolidated report](../evidence/production-two-hotfixes-2026-09-18.md); private signed receipts, rollback/closure and bounded runtime observations retained.
Verification: first owner-waived signed operation20260918T113740Z-2b1e04fa; second signed20260918T143800Z-e6c3b860; exact source/config/readiness and customerOPEN; integration CI35348631418/35349893178 passed. Three short runtime samples show4matching containers/restart0/no selected error pattern.
Next: No further deployment or browser verification for this task. Keep exact previous-container/provider snapshots and authorized SSH drift for future operations.

## Historical checkpoints (superseded by completion above)

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

## Pending owner input and exact-head CI checkpoint

- Current PR634 head`169469d992a04ebab23ae17840e2857654f56146`, CI`35324778464`.
  Fresh read: Typecheck and Test (including complete security script), Security Audit, Secret Scan,
  Production Config Validation, Migration Review and Billing Integration(customer) allSUCCESS.
  Billing Integration(operations/backend) remainIN_PROGRESS. No failure reported yet. GitHub still
  saysBLOCKED/REVIEW_REQUIRED. Do not merge until the exact head's complete CI passes and review is
  satisfied, or the owner explicitly waives only the reviewer requirement.
- Async owner questions are pending: normal approving review versus admin merge after allCIpasses;
  and actual funds/payer/payment date/reason for the845baht LeoPard substitute document. No answer
  has been received, and elapsed time is not approval or a financial fact.
- Superseded CI35324442127 is terminalCANCELLED. The attempted cancellation returned “already
  completed”; do not attribute its final cancellation to that unsuccessful call. Current run is the
  legitimate new controller head, not a duplicate deployment. `gh run watch` session86357 watches
  only currentCI, writes migration-preparation/ci-35324778464-watch.log, and exits naturally on terminal.
- All4new-host status alarms areOK. To avoid mistaking missing-data OK for health, actual last10min
  StatusCheckFailed metrics were read:10datapoints/host, maximum0 for everyhost at08:33:39UTC.
  Private host-status-metrics.json retains the results. These are host checks, not app acceptance.
- Chrome developer/profilemangmeeplus.com browser5/adminTab325833565 remains at Production OPEN/live.
  Thawatchai browser4/receiptTab325833568 remains on the linked substitute form step2. Both agent-created
  tabs are markedhandoff. No certificate or legal signature was created; no original expense confirmed.
  Exact auth/me identity/permission/status remains unproved because direct navigation is blocked.
  Native UI activation was interrupted by user activity; continue through the requested profile and
  do not infer identity or bypass browser controls. Both sessions remain logged in for later acceptance.
- Infrastructure remains staged and paid/running, temporary IAM expiry13:53:49.513914UTC unchanged.
  App publication/Proddeploy/traffic/worker handover have NOT started. Serving ECS source remainsfc.
  Staging targetcutoverCompletefalse; no ordinarytarget.json. Preserve old ECS rollback authority.
- This final checkpoint is intentionally a local documentation update while exact-head CI runs;
  committing/pushing it now would invalidate the tested PR head. Include it in the later evidence
  update, preserving the controller commit and source boundaries above.

## Owner-authorized admin merge and first apply — 2026-09-18

- Owner explicitly instructed “admin merge เลย”, waiving only the missing reviewer after full CI.
  Exact head169469d992a04ebab23ae17840e2857654f56146 CI35324778464 completedSUCCESS; all
  validation/security/billing jobs passed, image publication jobs correctlySKIPPED for this PR.
- PR634 admin-merged once2026-09-18T08:56:38Z. Merge/controller main
  `0c308982b4c3df4d1ce0e9f1b18a001174c49e8e`; exact functional controller bytes match main.
  No unfinished GitHub workflow was listed before apply; no active local Production operation or
  enrolled target exists. First local byte-check invocation missed the Python module search path;
  corrected read-only check passed without controller changes. No deploy retry was involved.
- Application candidate remains0b0058adbc7353ec906a33746867af2a235b0934 onfc2838c4 baseline,
  using the retained validated build. UAT/READY/PROD workflow IDsNOT_DISPATCHED. One local first
  migration apply is starting; capture its operation ID/result before any further action.
- The separate financial-facts question for the845baht substitute receipt remains unanswered.
  This admin-merge instruction is not a payment fact or substitute-document signature.

- Single first-apply operation`20260918T085755Z-860908a6` started08:57:55UTC, exec session91119;
  targetpreflight44.752s, prepared build/regressions2.744s, freshconfig6.869s and legacyworkflow
  fence23.107s passed. Publishing/pulling underway; no second apply. The pre-cutover actual Chrome
  DevTools network UI proved authenticatedGET/api/v1/system/platform-access200 withOPEN,live,
  canOpentrue; exact auth/me identity/permissions remain outstanding. This is baseline evidence only.

- First apply publish/pull passed295.221s; four immutable images are in the private publication.json.
  Config freshness8.649s/provider16.237s/database-and-feature-authority49.691s passed.
  New AI/API rollout completed; targetHealthVerifiedtrue covers both API AZs and the AI target.
  Original worker park has INTENT_RECORDED; AWS readback capacity0/0 is replacing1/2. Exact old
  worker taskb70e9f5da6e94727895190e2885f3224 isDEACTIVATING/desiredSTOPPED, not yetSTOPPED.
  New workers and customer traffic have not been switched at this checkpoint. Both legacy Prod
  deploy workflows aredisabled_manually. Do not launch another apply/recovery while this run lives.
- Optional new-group CloudWatch DescribeLogStreams reads with existingwatchdog-bedrock reader were
  denied for both new API/AI groups; no IAM change/root fallback was used. Native logging driver is
  configured, but actual CloudWatch delivery is not yet independently proved. Runtime health proof
  is separate. Browser native close-inspector action was interrupted by user activity; no repeated
  foreground control. Existing browser tabs remain markedhandoff; exact admin identity/logout and
  the real receipt/substitute/cancel/confirm journey remain outstanding.

## First apply failure, retained boundary and explicit ECS recovery

- Operation20260918T085755Z-860908a6 terminalFAILED_RECONCILIATION_REQUIRED1044.582s.
  NewAPI(twoAZs)/DB,AI,workers/Redis/internalAPI allpassed; oldworkersVERIFIED_STOPPED.
  Traffic change setkamal-20260918T085755Z-860908a6-public reachedEXECUTE_FAILED; stack
  UPDATE_ROLLBACK_COMPLETE09:15:26.248UTC. AWS event root cause: missingec2:DescribeImages,
  required to validate the existingAWS::EC2::Image::Id parameter under the non-root deploy role.
- Read-only reconciliation proves exact original template and both operator-only rules restored.
  Old ECS customerAPI/AI and provider remain serving; newworkers are the only active consumers
  until explicit recovery stops them first. No duplicate execute-change-set/redeploy was issued.
  Private reconcile-{change-set,stack,events}.private.json and reconcile-traffic-restored.json retain
  realAWS evidence. Hostalarms all4OK at09:14:04.972591UTC.
- Additional controller defect discovered by code inspection: aws() requiresJSON for everycommand,
  but successfulexecute-change-set returns an empty body. Fix/test both that response handling and
  the missing read-only prerequisite before another forward release; retain the original failure.
- Re-read mandatory deployment protocol; no unfinished GitHub workflow. Explicit reviewed existing
  ECSrollback command started once, execsession8800, same stagedtarget/source/path/testargs with
  --rollback20260918T085755Z-860908a6. Its controller files remain frozen on mergedmain0c308982.
- Recovery operation`20260918T091745Z-318a0d41`; result`.env.kamal/production/runs/20260918T091745Z-318a0d41/result.json`. Do not modify current controller while it runs.

## Owner correction: consolidate complete rehearsal before next fix/retry

- Owner instructed “ให้จำลองไปจนจบก่อน ค่อยแก้ครั้งเดียวจะได้ไม่เสียเวลา”. No next forward
  Production deployment until complete end-to-end simulation covers remaining traffic/readiness,
  actual AWS response formats and IAM prerequisites, browser acceptance, signing/enrollment and
  rollback; gather failures first, then apply one scoped correction set. Clearly distinguish
  simulation proof from actual live acceptance and any untestable external prerequisite.
- Existing explicit ECS recovery20260918T091745Z-318a0d41 was already dispatched before this
  instruction. Let that operation finish safely; do not interrupt it or start duplicate recovery.
  No new forward retry has been dispatched.

## Consolidated correction PR635 / pending real rollback proof

- New isolated correction checkout`/Users/thawatchai/.codex/worktrees/prod-kamal-cutover-rehearsal/mangmeeplus`,
  branchcodex/prod-kamal-cutover-rehearsal-20260918, commit518172a7ae0582ecfa7950a38f765469e4850f3c.
  DraftPR635opened/attached; exactCI35331533827running, watched in execsession8274. No merge/retry.
- Diagnostic full61tests only the2knownfailures, then one correction; final62Kamaltests pass0.972s.
  Realparser is used through simulatedcutover/sign/enroll/rollback after removal of diagnosticshim.
  AddedpreflightreadAMIandownedruletags beforepublication/workerstop. Exactroute/templateguards retained.
- Local releasepins/gitdiffcheckpass. Firstfullsecuritysuite stopped atmissingtsx(exit254), not a fullpass.
  Identical lock and unchanged application tree verified against originalcontroller169469d9; reused its
  installednode_modules via localuntrackedignoredsymlinks. Complete suite rerunexec72678 writes
  rehearsal/security-complete.log. Do not alterpackage.json or claim incompletechecks passed.
- ProposedtemporaryIAMv4SHA2563ebd43982a39fd1d941c1d425087e7765e0af01493c49c8667093510ca47e88e;
  stillNOTINSTALLEDwhilecurrentrecoveryalive. Region/expiryboundedDescribeImages/DescribeTags,
  exact2ownedrulehandlerwrites. Readsimulations4pass and4ownedModifyRule/SetRulePrioritiespass.
  IAMsimulator deniesexacttagactions but officialELBv2supportsexactlistener-ruleARNs; nevergrantstarwrites.
  Ownerbootstrapreadonlytaginventory finds only3AWS-managedCFtags oneachownedrule. Later verifyactual
  scopedAddTags/RemoveTags with temporaryuniqueproofkey, exactreadback/restoration, beforeforwardretry.
- Ownerauth/me JSON and independent renderedownertab325833587 prove currentSYSTEM_ADMIN identity,
  launch-gatemanage and no requiredpassword/legalaction. FreshadminpageOPEN/live. Privatepartial
  identity-observation.json retained; no completebrowser-acceptance.json. NativeChromeAX/screenshot
  unavailable. Oneownerquestionawaits actualfreshcanOpen/effectiveState/servingMode+HTTP200,logout204,
  andpostlogoutauth/me401 asrequiredbyrunbook§E. Keep recovery8800/20260918T091745Z-318a0d41alive.

- Security local completion09:53UTC: all shellcontracts passed; finalTypeScript command initially
  failed4filesbecausegeneratedPrismaclientwasmissing. Ran the sameCIprismagenerate(noDBconnection),
  then exactremaining4specs passed26tests/5suites in977.510ms. No functionalcodewaschangedforenvironment
  setup. Bothfailurelogsandfinalsecurity-typescript-tail.logretained. Removedonlyourtemporarydependency
  symlinksafterchecks; no change to the frozen controller dependencies. PR635bodyupdatedwithtruthful
  composedlocalverification; exactCI35331533827stillrunning and no newcommit/push invalidates itshead.

- AWSAccessAnalyzerValidatePolicy of proposedIAMv4 returnedzero findings andno pagination. This confirms
  policysyntax/service-resourcesupport but doesnotreplaceactuallivepermissionproof. No IAMmutation.
  Privateiam-v4-validation.jsonretained inrehearsalcheckout. Main remainsfrozenpendingrealrollbackproof.

## Real rollback completion — 2026-09-18

- Owner instructed “ทำต่อสิ รออะไร”; resumed nativeChrome worked. Actual fresh Network proved
  platform-access200/OPEN/live/canOpentrue, clickedlogout204, reloadedownercreatedauth/me401.
  Evidencebrowser-network-observation.json plus independentlycheckedidentity bound to the existing
  recovery. No credentials, no gatewrite, no fabricated acceptance.
- Recovery20260918T091745Z-318a0d41 terminalROLLED_BACK_TO_ECS; all5phasespass;
  KMS ECDSA_SHA_256 verified; acceptedSHA256a7d9566a92f7c6dfe510a7759d3141bf2aa6222ee8b78d0853801c03be3599c8.
  Elapsed2541.857s including browserwait2034.622s;
  actualrestorephase459.939s. Originalfc ECS/provider37 retained, legacyworkflowsrestored,
  activeoperation removed. This is rollback success, not hotfixpromotion. Mainfreezenowreleased.

## Reconciled prerequisites after signed rollback

- Temporary scoped IAM v4 installed once and exact readback verified after rollback, using owner
  bootstrap profile thawatchai. Policy SHA2563ebd43982a39fd1d941c1d425087e7765e0af01493c49c8667093510ca47e88e;
  unchanged expiry2026-09-18T13:53:49.513914Z. AccessAnalyzer returned zero findings.
- Actual non-root DescribeImages/DescribeTags passed. Initial AddTags probe with two resources
  returned validation error (only one resource can be tagged at a time), with no changed tags.
  Correct per-rule AddTags/RemoveTags passed on both exact owned rules; exact original tags restored.
  scoped-rule-tag-proof-per-rule.json retains PASSED/restoredExact evidence. No traffic mutation.
- Stopped candidate cleanup stopped-candidate-cleanup-20260918T1005Z passed under shared local and
  native remote locks. Retained full private inspections/logs; removed only four exact failed,
  stopped containers after ID/image/source/restart checks. No images/volumes removed. All four
  app service labels now absent on new hosts; proxies and original ECS services retained.
- Corrected-controller real readonly preflight20260918T100709Z-1a6aa503 passed38.609s,
  PREFLIGHT_PASSED_NO_DEPLOYMENT. No new forward apply or image rebuild. Rehearsal checkout shares
  original authoritative production state through its ignored .env.kamal/production symlink.
- PR635 is ready, exacthead518172a7 unchanged. CI35331533827 Typecheck/Test and customer/operations
  billing passed; backend billing remains running at10:12UTC. No duplicate CI dispatched.

## Second forward operation after consolidated proof

- Exact CI35331533827 completedSUCCESS. PR635 adminmerged10:14:51UTC as
  main39fb9d175e2427e723c3821aff69423a13926d6f; all functionalcontrollerfiles match main.
  No active release/recoveryworkflow, no active localoperation/target beforeapply.
- Readonly preapply import created Python bytecode; moved only created __pycache__ folders into
  ignored private evidence, repeated clean-tree proof with bytecode disabled. No apply occurred
  before this local guard was corrected.
- One forward apply started from corrected B checkout, sharing A state, at10:16:11.808104UTC:
  operation20260918T101611Z-1069a958, execsession59871. Controller/main frozen until signed
  acceptance. Appcandidate0b0058ad, baselinefc2838c4, exact preparedbuild unchanged.
  UAT/READY/PROD workflow IDsNOT_DISPATCHED. Preflight49.717s/preparedbuild+regressions3.452s passed.
  No duplicate retry. Monitor existing operation and retain actual browser evidence for it.

## Second traffic failure and consolidated output-read audit

- Forward20260918T101611Z-1069a958 terminalFAILED_RECONCILIATION_REQUIRED732.44s at native
  rollout/traffic. ECSoldworker601f3d8b...verifiedSTOPPED; all new services ready. Both owned
  listener rules actually reachedUPDATE_COMPLETE10:28:17-18UTC, then stack output resolution
  lackediam:GetRole on exactmangmee-kamal-production-deployrole. This is a brief actual public
  switch followed by AWSrollback, not a claim that traffic never changed.
- StackUPDATE_ROLLBACK_COMPLETE10:28:25.786UTC. Fresh fulltemplate and bothstaging+bothECSrules
  exactlymatch retainedoriginal; change-setARN EXECUTE_FAILED. The name+stack lookup returned
  ChangeSetNotFound; ARN read succeeded and originalfailedread is retained in tool record.
- Consolidated simulation had not modelled nativeCF GetAtt read permissions for unchanged stack
  outputs. Do not call that coverage complete. Audit every output type/required native reads
  together before the next forward attempt, including KMS, IAM, ECR, EC2 and AgentCore.
- One explicit recovery20260918T103003Z-7bfbc4ef startedfromsamefrozencontroller39fb9d17,
  exec78384; migrationrollbackpreflight25.92spassed. No next forward attempt/IAMchange.
  Ownerloggedin currentprodmangmeeplus session again; browseradminOPEN/liveobserved beforefailure.
  Freshrecoveryacceptance remains required. NativeChromeAX/screenshotcurrentlyunavailable;
  owneraskedtoopenDeveloperwindow. ExistingAPI-tabtoolreloadblockedERR_BLOCKED_BY_CLIENT.


## Second rollback signed; complete output audit and UAT comparison

- Recovery20260918T103003Z-7bfbc4ef completed2026-09-18T10:46:02.545899UTC,
  ROLLED_BACK_TO_ECS, all5phasesPASS. Actual restoration465.032s; total957.756s;
  browser/customeracceptance454.240s includes owner wait. Exact original fc2838c4 source/config/
  immutableimages read back running on all3 ECSservices; newworker task e13ae7b192fa4fffbb3ce53375f3cac8.
- Owner supplied current Chrome Developer identity/permission, OPEN/live/canOpen, actual logout204
  and postlogout401. Recorded explicitly as owner-observed evidence, not automated browser capture.
  Controller rechecked publicOPEN/login200 and actual ECSruntime before KMS ECDSA_SHA_256 verification.
  AcceptedSHA2568bbfa19ce385cd96b34228789ad803bea93016b2dce9bb3e206051581b2f1c99.
  Legacy workflows restored, activeoperation absent, target remains unenrolled. Mainfreeze released.
- Compared retained UAT hotfix20260917T141152Z-297dcbcc source1468ea7088a961af81ebce173df9a5d4028c96bd:
  all11phasesPASS279.406s, acceptedSHA256ddeeaaea03bdc52ae96cbb60ee35336454f2de83712ce3c9563ebd53a52581b9;
  actual nonroot KMSVerify re-run true. This is retained signed smoke proof, not a fresh UAT deployment
  or Production browser acceptance. UAT has no first-migration CF/oldworker handover; its policy has no
  IAMGetRole/CFupdate. Its login/logout exception does not apply to Production.
- Audited actual native provider schemas for all15stackoutputs: EC2, IAMRole, ECR, KMS, AgentCore.
  Initial nonroot30readcalls found27denied/3passed; not every denied optionalread is fatal (KMS provider
  soft-fails some metadata reads). Proposedv5 IAM validation0findings and8simulationgroupsallallowed.
  Installedv5 only after signedrollback10:49:25UTC, exact policy readbackPASS; SHA256
  c2e67aa6fe34a88bea9d59a044b7bccca063301ba6763051205cba2c9e1cdf6a. Added8read-only statements,
  exact resource scope where supported, unchangedexpiry13:53:49.513914UTC, no newmutationpermissions.
- Isolatedcontrollercheckout codex/prod-kamal-output-preflight-20260918 from main39fb9d17.
  Full64testdiagnostic ran to end beforefunctionalfix:10failing subcases (5missing outputprovider reads,
  5outputdrift/unknownGetAtt), remainingchainpassed. One bounded output-preflightfix now64testsPASS.
  Tests model actual rules-switch then CFrollback; all10browserchecks and7bindingfields failclosed;
  success chain reaches synthetic KMSsign/enroll and separate signedECSrollback. Synthetic != live proof.
  No thirdforward dispatched. Actualv5 providerread audit in progress; fullCI not started yet.


- Actualv5 nonrootaudit33checksPASS (31successfulresponses,2expectedabsentECRpolicies), noAccessDenied.
  Exactnewcontroller output/trafficprerequisites live-read passed, then complete readonly preflight
  20260918T105515Z-63810cf3PREFLIGHT_PASSED_NO_DEPLOYMENT47.515s. ConditionalSSMDescribeAssociation
  remains simulated-only because noassociationID; LaunchTemplate notapplicable totheseinstances.
- Exactcandidatecleanup stopped-candidate-cleanup-20260918T1055Z removed4verifiedstopped secondattempt
  containers underlocal/remote locks afterretaining fullprivateinspect/logs; images/volumes retained.
- PR638opened/attached https://github.com/MangmeeDev/mangmeeplus/pull/638,
  exactheadf666d27c8098c81fe477124efdd654fd278149fd, CI35336871465inprogress. ControllercheckoutC
  shares authoritativeProdstate throughignoredsymlink. No newforwardapply; no rootcheckoutchanges.
- Freshapplication scope proof confirms exactly2commits and15approvedpaths relativefc baseline,
  noPrisma/package/lock changes andnoUAT/main applicationbacklog. Nativebrowser showsadminlogout/loginpage.


## CI638 customer failure isolated; no forward deployment

- CI35336871465 attempt1 customerjob105573685689 failed10:56:42UTC in plan-change command's
  adminapplyretry:page showedloaderror, nextlinkabsent30stimeout. Outer diagnosticcustomerpage remained
  syntheticStripecheckout; it is not the actualfailedadminpage. NoHTTPstatusretained, rootcauseunproved.
  OtherCIjobs stillrunning. Never relabel this failure or claim productbugfixed.
- App/packages/package+lock trees exactlyunchangedfrompassingparent39fb9d17. Replayed the same2CI
  commands onNode22.23.2, isolatedPostgreSQL18.3/Redis7 andrealheadlessNextbrowser: trial31groupsPASS,
  plan36groupsPASS. No code/assertion/timeouts changed. Initial localsetup failedbeforeexecution due
  missingconfigdist, then completedexistingCIconfigbuild; originalsetuplogretained. PrivateC evidence
  ci-customer-replay-proof.json andbrowser-replay-2-* contain results.
- PriorcomparableunresolvedNextnavigationfailures documented in email-passwordless-signup-2026-09-16.md;
  do not assert this is the same rootcause. OnceexistingCIisterminal, onefailed-job-only replay onexacthead
  is justified by unchangedapp + successfullocalexactcommands. Do not startnewfullCI orProdtestretry.
- Ownerloggedinprodmangmeeplus again at11:04-11:05UTC. ToolactuallyobservedadminOPEN/livepage.
  Keepcurrentsession forpostdeploy; don'tlogoutearly. NativeChromeUIisreadableagain. DevToolspreexisting
  Headersviewcontainedsessionheaders; closedDevTools immediately anddidnotretain/reuseanysecret.
  Passwordpicker didnotautofill; ownerperformedlogin. Existingauthtab maystilldisplayprior401 untilfreshread.
- Actualreadonlyalarmread10:56:43UTC:all19Productionhost/security/rollback/runtimealarmsOK.


- CI35336871465 attempt1 operationsjob105573685687 alsofailed11:05:42UTC onSupportSLAcase detail
  showingloaderror/missingoverduetext30stimeout. NativeHTTPstatus notretained; rootcauseunproved.
  Localexactsource replay of thefailedcommand and2subsequentcommands passed SLA8/schedule12/readiness19
  browsergroups. Read-only untracked localPlaywrightresponseobserver capturedsyntheticHTTPerrors, including
  intentionallyinjectedreadinessfaults; do notlabelthemnewproductfailures. Privateci-operations-replay-proof.json.
  No trackedcode/assertion/timeoutchange. Bothrounds of ownedlocalPostgreSQL/Redis fixtures/volumesremoved.
- CIremaining Typecheck/Test reachedproductionmaintenancecontrols; backendbillingstillrunning.
  No failed-jobrerun yet andnoProdapply. Do onefailed-job-only rerun afterparentterminal.
- Integration inspectiononly: existingmodernmain/developv2evidence contract already permits a reviewed
  SOURCE_DOCUMENT despite retainedoldmissingreason, unlikeoldProd. Do notblindlycherry-picklegacy0bguards
  overv2; carrybehaviourregression pluspricing intointegration afterProd completes. PR629stilldraftunchanged.


## CI attempt 2 and owner session retained

- CI35336871465 attempt1 reached terminal failure with only customer/operations browser jobs failed.
  One failed-job-only retry dispatched2026-09-18T11:18:05.107260UTC on unchanged
  f666d27c8098c81fe477124efdd654fd278149fd; private marker DISPATCHED_ONCE prevents another retry.
  Attempt2 still running at11:24UTC; all other required checks already pass. No new Prod apply.
- Owner again confirmed login; actual Chrome Developer admin DOM shows OPEN/live. Keep the session
  for fresh post-deployment identity/read/logout acceptance, not stale recovery evidence.
- Local browser replay generated next-env paths, a screenshot and Next agent files in C; all retained
  under private generated-browser-fixtures and exact checkout restored. No application diff added.

- While CI638 attempt2 runs, prepared integration locally only: branch codex/line-trial-pricing-integration-20260918
  merged current develope1f81a7c (local merge615c300b), then commit65e20e16 adds retained historical
  missing-receipt reason to the existing cancelled-certificate final-transaction regression. No new
  receipt runtime patch needed on v2. Pricing394/atomic28/contracts10/web37 tests and API typecheck PASS.
  Source is held locally; PR629 not pushed/merged and UAT not deployed. Keep isolated Prodcandidate0b unchanged.


## Owner pause for scope clarification — 2026-09-18T11:33:55.280223+00:00

Owner said “แปบนึง ที่ให้ hotfix ไปมีแค่นิดเดียวเองนะ”. Hold any further merge or forward deploy while clarifying the separation between the two application fixes and the previously authorized ECS-to-Kamal migration. No third forward operation was dispatched. CI638 attempt2 was already running; no new CI or cloud operation started for this pause. Production remains the signed recovered ECS baseline; integration changes remain local.

- Owner resumed with “โอเค งั้นทำต่อ” after clarifying Stripe is a repository CI test, not part of the hotfix. Resume the same authorized scoped migration/hotfix flow; prior hold lifted at 2026-09-18T11:35:03.712525+00:00. CI35336871465 attempt2 is on its final operations browser step; no duplicate CI or forward operation.


## Third forward started after exact-head CI and scoped merge

- CI35336871465 attempt2 terminal SUCCESS on f666d27c8098c81fe477124efdd654fd278149fd, all PR638
  required checks pass. Owner-authorized admin merge completed as e4189b9d7e31e24c00b8b2c94c06656d7300d074.
  Every functional controller file in C matches merged main; checkout clean. Initial local inspection
  needed explicit module search path; generated bytecode retained privately and clean state restored.
- One forward apply started2026-09-18T11:37:40.734456UTC:20260918T113740Z-2b1e04fa, exec26684, PID4121.
  Retained C/rehearsal forward-3-process.json and forward-3-apply.log prevent duplicate dispatch.
  No other deployment/recovery workflow was active, no active operation or target enrollment, and
  temporary migration authority had >130minutes remaining. Main freeze begins at controllere4189b9d.
- Application remains0b0058ad onfc2838c4, exact2commits/15paths. Prepared build reused; no newer
  main/develop/UAT application backlog. UAT/READY/PROD workflowIDs NOT_DISPATCHED (local operation).
- Owner authorized using LeoPard845 receipt and filling test fields for SndPrd business journey.
  Clearly label supplied test values; do not invent actual payment/legal attestation. Journey remains
  pending after deployment; existing admin session retained for fresh same-operation acceptance.

- Forward20260918T113740Z-2b1e04fa reached AWAITING_BROWSER_ACCEPTANCE at11:50:20.497214UTC,
  secondsToWebsiteReady759.766. Native rollout/readback PASSED569.821s; oldworker e13ae... verified
  STOPPED before newworker start, CloudFormation public switch VERIFIED. All earlier phases passed.
  Actual fresh admin page reload shows OPEN/live; initial selected page had moved to supportrequests,
  returned via the visible platform-access link. Native Chrome Network became readable briefly, then
  noWindowsAvailable. Existing standalone auth/me navigation returns401 without request bearer and
  is not the authenticated app request; do not use it as current identity or postlogout proof.
- Owner requested fresh same-operation auth/me identity/permissions, systemplatformaccess200 OPEN/live/
  canOpen and logout204/postlogout401 through Network. No acceptance file has been fabricated.
  Controller exec26684 remains alive with locks/mainfreeze; signed acceptance and enrollment pending.
- Business receipt845 form reloaded on deployed candidate; no business mutation performed yet.


## Current forward browser and business observations; next owner scope

- Fresh native Chrome Network after forward observed system/platform-access HTTP200 with effectiveState OPEN, servingMode live and canOpen true; no gate write. Identity and logout are still pending. A manually entered read-only Console auth/me fetch returned HTTP401 before logout; this is NOT post-logout proof. Earlier inference that the standalone navigation lacked a bearer is unproven: exact source AuthGuard does support cookie fallback. Investigate current browser request/session before certifying acceptance.
- Native macOS control repeatedly reports noWindowsAvailable/ScreenCaptureKit failures or silently leaves Console input unchanged. Owner opened Developer window and said ready; DOM browser control still works. No credential extracted, no acceptance file written, no second deployment dispatched. Active forward process and main freeze remain.
- Authorized Snd Prd LeoPard845 journey: prepared unsigned paper certificate SRC-202609-00003 (cmu6wlblw0008387lqp135z39) on expense cmtxqig2k0gbp204dller8tor using explicitly labelled test fields. No signature/upload/issuance or payment posting. Cancelled it using UI; success toast and cancelled history verified. Original receipt confirmation remains pending.
- Owner added follow-up scope: after current acceptance merge hotfix behavior into main and develop; then a second isolated Prod hotfix for trial FAQ Flex-card formatting and semantic coverage of “หลังหมดโปรฟรีแล้วเป็นยังไงต่อ”. Measure stability and actual times of both rounds, then merge second patch into main+develop. No unrelated application backlog permitted. Current first release must terminalize before another Prod operation.

- At12:22UTC CUA verified original LeoPard845 receipt confirmation succeeded as EXP-202609-00002, status ยืนยันแล้ว. Original attached cash bill visually verified, cancelled SRC-202609-00003 history retained. Still unpaid and awaiting accounting, no payment/signature/journal action. Private same-operation business-receipt-observation.json retained. Browser admin acceptance remains separate and pending.

## Handoff checkpoint 2026-09-18T12:29:37.379167+00:00

- Second scoped application patch prepared in managed trial-faq-card-hotfix-20260918 worktree, branch codex/trial-faq-card-prod-hotfix-20260918, commit1406d3825db2eb7d70987b207c80f89ae05edb3b on exact0b baseline. Standard business bubble with official-package CTA and complete canonical fallback; trial-end matcher variants. Five app/test paths plus memory only,343tests/APItypecheck/diffcheckPASS. No push/second deploy/main+develop merge yet.
- Main remains exact frozen e4189b9d and develop e1f81a7c at fresh remote read. PR629 remains original published draft; locally prepared integration65e20e16 not pushed.
- Fresh AWS alarm read after forward: all19host/security/resource/rollback alarmsOK. Six old ECS TargetTracking alarms separately show highOK/lowALARM or workerINSUFFICIENT_DATA, consistent with retained idle/parked ECS capacity; not counted as19acceptance alarms. No alarm configuration changed.
- Current admin Console read-only auth/me query before logout returned401. Follow-up read-only no-store auth/me+platform query has been placed in Console but CUA cannot send Enter reliably; owner asked only to click at command end and press Enter once. No response yet. Keep this question pending; no fabricated identity/logout acceptance. Public unauthenticated curl confirms401 DYNAMIC/private-no-store, not evidence of logged-in identity.
- Process4121/exec26684 remains alive, AWAITING_BROWSER_ACCEPTANCE. Migration IAM expiry still13:53:49.513914UTC; do not extend/change IAM during this operation. Ordinary next releases also require reviewed ECS rollback-window closure, per infra/kamal/README.md115 and release.py305. Do not remove enrollment guard to bypass it.

## Owner ends additional browser verification

- Owner explicitly said `ไม่ต้องตรวจแล้ว เสียเวลา ฉัน้ข้าไปลองแล้ว` after asking another method. Stop additional browser/HTTP/audit checks; retain owner manual acceptance separately, never mark unobserved identity/logout HTTP checks passed. Exact decision is retained in the active operation owner-acceptance-decision.json.
- Alternate control failed: blocked direct API navigation, native AX/keyboard ineffective, AppleScript timed out, browser read-only scope has no fetch. No further attempts. Temporary read-only support session watchdog-bedrock-dev-39zquavinvlsgnvb6opdrfd554 exited without a SQL query. Direct SSH to both API hosts timed out; no runtime mutation.
- Existing controller only accepts all browser check booleans true and has no owner-waiver or resume path. A truthful terminal owner acceptance needs explicit reconciliation; do not manufacture browser-acceptance.json or delete active/remote locks. Application remains live at 0b0058ad, latest hotfix 1406d382 remains local and verified, main/develop integrations pending.

- Owner-stop handling: interrupted only controller PID4121 at its confirmed browser wait; no container/traffic/DB change. Original result remains `FAILED_RECONCILIATION_REQUIRED`, stopped13:01:48.137930UTC. Command elapsed5047.380s; website ready759.766s; browser wait4287.612s. Do not present84m07.380s as application rollout time.
- Signed separate `owner-accepted.json` with state `OWNER_MANUAL_ACCEPTANCE_BROWSER_HTTP_WAIVED`, explicit unobserved checks and original receipt/business hashes. KMS ECDSA_SHA_256 verify=true; SHA256 `848fe4a50bd26c117e2e197723989c95fce739cb3f54d63d79ea942692c3f50c`. This is owner decision evidence, not a false standard browser-acceptance PASS. Enrollment/remote lock release remain pending; original run artifacts are preserved.
- Concrete connectivity blocker: current workstation egress49.228.220.223 differs from Production SSH allowlist49.229.201.224/32. Both enrolled API hosts are still running with their enrolled addresses. Existing nonroot reader confirms only old/32 on API security group sg-00103756fceaa534a. Asked owner whether to rotate operator access to new/32 or return to prior network. This required access decision is pending; no security-group or IAM change made.
- New application commit1406d3825db2eb7d70987b207c80f89ae05edb3b pushed on codex/trial-faq-card-prod-hotfix-20260918, isolated on first hotfix0b0058ad.343tests/typecheck pass. Production and main/develop merges are still pending reconciliation; no duplicate deploy dispatched.
- DraftPR639 https://github.com/MangmeeDev/mangmeeplus/pull/639 created and attached, base first-hotfix branch; no merge or deployment yet. Next: owner network access choice; truthful same-operation reconciliation; first integration main/develop; reviewed rollback-window closure; second hotfix; second integration. Do not restart browser checks after owner stopped them.

## WiFi rotation, owner reconciliation and rollback-window closure plan

- Owner authorized continuing after changing WiFi. Rotated only the existing three SSH/TCP22 rules from49.229.201.224/32 to49.228.220.223/32; exact rule readback matches. No broader CIDR/IAM/runtime change. Owner bootstrap profile thawatchai used only for this infrastructure prerequisite; releases use nonroot mangmee-kamal-production. Preserve this authorized drift in future stack updates.
- Same operation reconciled under the explicit owner browser waiver: exact4containers/config/proxy readback and retained ECS capacity/build authority checked; signed result state OWNER_ACCEPTED_BROWSER_HTTP_WAIVED, KMS verified, enrollment installed retaining ecsRollbackBaseline. No browser login/logout repeated or falsely certified. Original stopped receipt retained as result-before-owner-reconciliation.json. Only this operation's verified remote/local locks released. Main freeze is lifted under owner acceptance.
- Reviewed next-step scope before mutations: close the retained ECS rollback window by parking only the old API/AI services at0/0 (workers already0/0), await their actual STOPPED tasks, retain their configurations/images/history and shared ALB/RDS/Redis. Verify current Kamal source0b0058ad remains exact; retire obsolete build authority using the existing permission/audit-aware retireLaunchBuilds path. Remove only temporary first-migration-20260918 inline policy, keep ordinary deploy permissions and both legacy Production workflows disabled. Update enrollment only after signed closure evidence. Do not simply delete ecsRollbackBaseline.
- The next isolated card hotfix uses source1406d382 on0b0058ad. Owner stopped repeated browser checks: any no-browser acceptance must explicitly state NOT_PERFORMED_OWNER_WAIVED for login/logout, bind the owner decision and operator override hash, and retain automated source/config/readiness/publicOPEN/signature evidence. It must not claim owner manually tested the future candidate.

- Reconciled first release at13:09:29.471638UTC with actual same-source4container/config/proxy readback and preserved ECS build authority; final accepted.json SHA438fde898c33ee708069e935be59935e04bb305251883c1e5acaa82eed64c71e, KMS verified. State explicitly OWNER_ACCEPTED_BROWSER_HTTP_WAIVED. Private operator reconciliation script retained/hashes auditable; original interruption receipt preserved.
- Old API/AI capacity updates submitted once13:11:27/13:11:29UTC. Classic DescribeServices returned misleading0/0 before actual STOPPED; corrected user update immediately and used Express configurations/task states. API actualSTOPPED13:17:57UTC; AI13:18:31UTC; both complete Express singleton0/0 verified13:18:36–40. Old worker historicalSTOPPED signed proof retained; its old task record has expired from ECS API, no current running tasks. No fake current worker task status.
- Rollback-window closure completed and signed: all old services parked0/0; existing retireLaunchBuilds retired16obsolete authority rows with audit; removed only temporary first-migration-20260918 inline policy. Preserved shared ALB/RDS/Redis, service configs/images/history; legacy Production workflows remain disabled. Target ECS rollback guard removed only after signed actual closure. Subsequent rollback uses native Kamal prior-container/provider snapshots.
- First integration PR629 updated to65e20e164cdab54bb4b9259b46c76ac9d0746f60 and marked ready; exact-head CI35348631418 running. Second integration worktree/branche64a2da6 created locally on that source,427focusedtests pass; first raw tsc attempt hit default4GB Node heap, retry with8GB (same code) running. No duplicate deploy or CI rerun.
- Candidate1406d382 standalone immutable build PASSED13:16:46.426334UTC; command194.790s (3m14.790), start13:13:31.636794UTC. API build109.877s/tools-base82.872s partly parallel, do not sum phase seconds as wall time. Preparation reuses that exact source/build; apply still awaits first integration.

- Second preparation operation20260918T132054Z-07bf4d3d PREPARED_NO_DEPLOYMENT in57.009s (command57.110s): full current Kamal baseline, exact source/build, complete configuration and secret freshness passed after rollback-window closure. Source/build unchanged; no apply yet.
- New integration candidatecefa946b (app cherrypicke64a2da6 plus scoped memory update) pushed as draftPR640 https://github.com/MangmeeDev/mangmeeplus/pull/640 and attached.427tests and8GB APItypecheck passed. Draft stays unmerged until Production card deployment. PR639 is the separate exact isolated source on0b; do not substitute PR640 for Production.
- Operator-only no-repeat-browser wrapper is restricted to1406d382on0b0058ad, production/hotfix/no rollback/no firstmigration. Offline executable contract rejects foreign scope, retains allservice readiness, includes override+ownerdecision hashes, and never asserts browser HTTP checks or future owner testing. Core controller/source/config/security gates unchanged. Final signed state explicitly ACCEPTED_WITH_BROWSER_HTTP_WAIVER.

## First hotfix integration complete; second forward ready

- Exact-head CI35348631418 finishedSUCCESS13:34:07UTC on65e20e164cdab54bb4b9259b46c76ac9d0746f60, all9validationchecksPASS and5publicationjobs correctlySKIPPED. Wall24m02s from13:10:05. No CI retry.
- PR629 owner-authorized admin merge todevelop completed13:35:03UTC as6f4d1b913a4e5ecd740a761d6c6ae42522496111. Same verifiedhead merged tomain with GitHub merge API as75207d31660e75918d31eb248b37554ff59fb970, expected merge tree2c2c5ebeff941c811d31723920dd3a9d9369bb82. Main application diff contains exactly6scopedfiles; no duplicated source CI. RequiredCI was already successful before both merges.
- Second integrationPR640 exact-head CI35349893178 on cefa946bf7ebb33978793c78eaf065db03bc6e9c started13:23:03UTC, running. Do not merge until second live deploy accepted.
- Before secondapply: active.json absent and signedrollback-windowclosure present. Broad workflow scan found old queued Readiness31611733340; inspect its identity/jobs before applying rather than claim zero globalqueuedruns. Controllerbase75207d3 intended frozen during apply. UAT/READY/PRODworkflowIDs NOT_DISPATCHED; secondapply not yet dispatched.

- Queue reconciliation: exact known nonexecutable metadata ghost31611733340 was freshly proved unchanged head33ed788c/timestamp2026-08-12/checksuite85752682208; jobs/check-runs/pending-deployments all0. Existing documented provider incident permits excluding only this identity. No other actual active Production/readiness/recoveryrun. No cancellation/deletion/retry of ghost. Privatecard-zero-active-proof.json retained.
- Secondapply started once13:37:50.270458UTC, localoperation20260918T133750Z-80b36194, PID16738/exec44505; C/rehearsal/card-apply-process.json and card-apply.log retained. Source1406d382 on0b; controller/main75207d3frozen. Existing exact validated build reused. Keep same operation until signed terminal; no duplicate dispatch.


## Second publication reconciliation and accepted forward

- Initial apply20260918T133750Z-80b36194 failed before service mutation at tools docker push240s timeout; terminal374.262s. Exact readback2026-09-18T13:49:25UTC: all4old0bcontainers running/restart0, active/remote locks absent,3applicationimages inECR andtoolsImageNotFound. No process or deployment retry while outcome unknown.
- Registry-only completion of the missing exact tools image took258.563s, finished13:54:23.389772UTC and ECRdigestverified. No service/provider/DB action. The core controller timeout was not changed; this explicitly prepopulates the missing layers and is included in total costs/timing.
- One reviewed retry20260918T143800Z-e6c3b860 started14:38:00UTC with exactsamepreparedsource/build. All11phasesPASS including custom owner-waived customer acceptance; terminalACCEPTED_WITH_BROWSER_HTTP_WAIVER14:42:13.723972UTC, receipt252.880s/command253.009s, website230.844s, native82.306s, signature1.269s.
- KMSverified accepted.json SHA5e4ff39fe097b2e65409d736d8ce93b6abdeba6892234a1ebfc0e7f1130fc5f9. All4runtime source1406d382/fullconfig/deepreadiness matched; publicOPEN. AgentCorekamal_production_a/version5. Prior0bcontainer/provider snapshot preserved for native rollback; this second rollback not exercised. active.json released by controller. Mainfreeze lifted after signedterminal.
- Owner waiver retained inside signedacceptance: login/logout/current-adminHTTP NOT_PERFORMED_OWNER_WAIVED; futureCandidateManuallyTestedByOwner=false. No repeat browser work and no actualLINEsend. Exact-head CI35349893178 passed23m59s on cefa946b without rerun; integration after boundedruntime/public stability observation.


## Final integration and stability

- PR640 mergeddevelop70d1359d18d2db977be57dc8f621a59fdb70cce6 at14:45:05UTC; same validatedheadcefa946b mergedmainad4250871a313908c21a036b20d420008575c87a. Main treea81d0a74 matches reviewed drymerge. PR639 closedasdelivered, no historicalbranchmainmerge and no newdeploy.
- Three postrelease samples14:42:42–14:44:15: exact4sourcecontainers stableIDs, restart0, boundedlogselectederrorcounts0, all6publicrouteHTTP200 and3loginOPENmarkers. State-extractornulls retained; signedcontroller provesstateOPEN. Extra defaulturllibread403retained separately, causeunproved. Alarm19OK with9legacyECScoverage distinguished;6oldECStargettrackingINSUFFICIENT_DATA. This is short observation, not load or long-term proof.
- Full actualtiming, failedattempts, waiverlimits, priorECSrollback and bothbranchmerges recorded in docs/evidence/production-two-hotfixes-2026-09-18.md. No furtherbrowser/LINE/customerdata mutations. Unrelatedrootworkingchanges remain untouched.
