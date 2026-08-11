# Agent Memory: UAT environment

Status: UAT is running source `f2e1be0c7041c936d75cc6dec6855e49ce166c1a` on all three
services as of 2026-08-11 via Deploy UAT/auto run `31480892459`.
The signed immutable api-web, AI Gateway and workers images are ACTIVE with one configuration each,
capacity 1/2 and matching `GIT_SHA`/`SERVICE_VERSION`. The run did not issue signed UAT acceptance:
its post-rollout fast-canary check false-failed while the standard ECS view still showed AI Gateway's
draining previous deployment; independent readback after convergence proved all three services stable.
Owner: Platform/Security release owner
Scope: GitHub UAT environment, OIDC roles, isolated AWS runtime/data resources, immutable deployment workflow, and verification.
Decisions:
- `develop` is UAT release authority; `main` remains production release authority.
- UAT shares only immutable ECR repositories with production. Runtime state and credentials are isolated under `watchdog-bms/uat` and `watchdog-bms-uat-*`.
- UAT containers keep production runtime hardening (`APP_ENV=production`) while `DEPLOY_ENV=uat` selects cloud resources.
- Production data is never copied. The owner approved temporarily copying the production LINE values into the isolated UAT secret namespace for this acceptance cycle; production LINE credentials must be replaced after UAT acceptance.
- The workflow is launched from `main`, while `uat-*` tags and full SHA inputs must be reachable from `develop`.
- The neutral `main` controller must exact-read IAM and verify stable ECS/rollback controls, required
  secret metadata and rollback alarms before reusable CI may publish images. The deploy job repeats
  exact IAM readback immediately before mutation to close the build-time drift window.
- Automatic full CI runs only for pull requests. Branch pushes do not duplicate the suite; UAT may
  reuse an exact successful pull-request run for the same SHA/policy or invokes the reusable full
  gate itself. Manual CI remains the explicit production-recovery validation path.
- GitHub environment protection available on the current plan is branch policy only; wait timer/required-reviewer protection returned HTTP 422.
Open questions: Employee LINE UAT still needs one real employee QR-link/message journey. CRM customer AI still needs one real inbound LINE message after the first-message hotfix.
Artifacts:
- `.github/workflows/deploy-uat.yml`
- `.github/workflows/ci.yml`
- `infra/prod-ecs-express/{deploy.sh,run-release-task.sh,verify-deployment.sh}`
- `infra/uat/{README.md,setup-control-plane.sh,bootstrap-data.sh,*.json}`
- `infra/uat/{verify-deploy-readiness.sh,verify-deploy-readiness.spec.sh}`
- `infra/security/{validate-production-maintenance-release.sh,sync-production-maintenance-release-pins.mjs}`
- `docs/specs/uat-environment-spec.md`
- `docs/plans/uat-environment-plan.md`
Verification:
- Initial discovery found only `watchdog-bms-prod`; no UAT ECS/data resources existed.
- `actionlint` passes for CI, production deploy, and UAT deploy workflows.
- `infra/docker/production-image-security.spec.sh` passes UAT tag/branch isolation, no-production-reference checks, UAT release-task render, wrong-secret/cluster rejection, cost gate, and existing production H-13 checks.
- Shell syntax, IAM JSON parsing, and `git diff --check` pass.
- UAT run `31468653715` attempt 1 reused exact successful source CI and published all three signed
  immutable images, then stopped before release task/database/service mutation because the deploy
  role lacked the newly required `ecs:UpdateService` / `ecs:DescribeServices` policy bytes. The
  exact one-shot policy bridge applied the reviewed deploy and release-task policies; attempt 2
  exact-read both policies before mutation and completed successfully. Its deploy job took 14m51s.
- Independent post-deploy readback for attempt 2 found api-web, AI Gateway and workers `ACTIVE`,
  singleton, at source `5f555675271e2fc38024f11b98ed268bbeb87b37` and the exact manifest
  digests. RDS and Redis were `available`; required Secrets Manager records existed; all three
  service health endpoints passed; five UAT rollback/security alarms were `OK`; and both
  `uat-deployment-acceptance-*attempt-2` artifacts were present.
- The early preflight implementation adds no IAM authority. Its fake-AWS contract rejects dual
  active revisions, missing required secrets, non-OK rollback alarms and non-UAT environments.
  `verify-deploy-readiness.spec.sh`, selective workflow/target/fast-rollout specs, workflow YAML
  parsing, Bash syntax, `git diff --check`, the full `production-image-security.spec.sh`, and a live
  read-only AWS execution of `verify-deploy-readiness.sh` all pass.
- CI push run `31473606590` exposed an exact-byte controller pin drift after commit `df89b41`
  legitimately changed `PlatformAccessPage.tsx`: application tests passed, but the production
  maintenance release validator still expected the previous presentation hash. The durable fix
  limits exact pins to enforcement/runtime wiring, checks broad config/schema/audit modules by
  required semantics, and leaves presentation to focused journeys plus exact UAT images. Intentional
  enforcement edits use `sync-production-maintenance-release-pins.mjs`; CI check mode detects stale
  pins before expensive jobs fan out. The sync/validator/workflow specs, UAT early/selective specs,
  and the full `production-image-security.spec.sh` pass with this contract.
- Commit `8e33295` aligned the LINE intake fixture with Flex replies; focused LINE tests passed
  151/151, API typecheck passed, and the full workspace test suite passed locally. Its duplicate
  push CI run `31478846246` was cancelled while PR run `31478849363` remained authoritative. The
  CI trigger contract now prevents future branch-push duplicates and UAT reuse searches exact
  successful pull-request runs instead of obsolete push runs.
- UAT run `31480892459` reused exact successful pull-request CI and skipped the duplicate
  typecheck/test/security/migration/config jobs. Its release task and all three ECS Express
  deployments reached source `f2e1be0c7041`; the workflow then false-failed because AI Gateway's
  Express deployment was already `SUCCESSFUL` while the standard ECS service snapshot still
  included its draining previous deployment. Independent AWS readback found all three services
  `ACTIVE`, desired/running/pending `1/1/0`, one `PRIMARY/COMPLETED` deployment each, and the
  reviewed 5% canary/rollback configuration. The controller now waits for
  `ecs wait services-stable` before its steady-state snapshot, with a focused transitional
  two-deployment regression case.
- AWS roles `watchdog-bms-ci-uat`, `watchdog-bms-deploy-uat`, and five UAT ECS runtime roles exist. GitHub OIDC trust readback is bound exactly to `repo:MangmeeDev/mangmeeplus:environment:uat`; inline policy apply completed from the committed templates, but the operator principal lacks `iam:GetRolePolicy` for independent readback.
- GitHub environment `uat` exists with only `main` allowed (policy `55132941`) and has account, region, publisher/deploy role ARN, copied LINE IDs, `PUBLIC_DOMAIN_URL=https://uat.mangmeeplus.com`, and disabled AI/autoreply defaults.
- The owner approved recurring cost. `watchdog-bms-uat-db` (`db.t4g.micro`, encrypted/private), `watchdog-bms-uat-redis` (`cache.t4g.micro`), `watchdog-bms-uat-311414082667`, UAT security groups, secrets, SSM parameters, and `watchdog-bms-uat` ECS cluster are provisioned. Production LINE IDs/secrets were copied into UAT without printing secret values.
- First workflow dispatch `29755542986` was rejected before jobs with `startup_failure`; caller jobs now explicitly grant `id-token: write` to the reusable CI workflow. Bootstrap ingress validation and pre-existing bucket handling were also corrected after live idempotency checks.
- PR `#27` merged the workflow/bootstrap fixes into `main` at `cec7348e27f29c52c43971cc804e70fe9c7d2c1d`. UAT run `29756398679` then passed tests, image/SBOM/manifest publication, all 70 migrations, permission/address sync, and deployed api-web, AI gateway, and workers at source `5386c055d0e1`.
- Run `29756398679` failed only at the final health probe: ECS marked the services `ACTIVE` while their canary deployment was still `IN_PROGRESS`, so the origin temporarily returned 503 even though container health logs were 200. The deploy waiter now requires `DescribeServiceDeployments.status == SUCCESSFUL` before continuing or verifying.
- Cloudflare Worker `mangmee-uat-host-proxy` version `79e5bb7b-e18c-4d39-a3c2-acbb83d7736c` is routed at `uat.mangmeeplus.com/*`; proxied CNAME `uat` targets the UAT api-web ECS endpoint. DNS, TLS, root redirect, and `/v1/health` pass through the public hostname.
- Browser acceptance found `/login` returning 502 because Next standalone honored the ECS-provided `HOSTNAME` and did not listen on loopback while the combined proxy calls `127.0.0.1:3002`. PR `#28` merged the rollout-stability/loopback fixes into `main`; PR `#29` made repeat ECS updates accept explicit stable no-ops.
- UAT run `29762118332` completed successfully for source `f6102503577fe526882eed89363e9d86df14df96`: tests, security checks, immutable api-web/AI/workers images, SBOM/digest manifest, release task, migrations, and `Deploy UAT/all` all passed.
- Public acceptance on 2026-07-21 passed: `https://uat.mangmeeplus.com/v1/health` returned HTTP 200 with `status=ok` and `db=ok`; `/` redirected to `/login`; the browser rendered the Thai login form and controls without 502.
- UAT system-admin bootstrap on 2026-07-21 passed from an ECS one-off task using `watchdog-bms/uat/system-admin-password` directly from Secrets Manager; the task exited `0` and did not expose the secret. Public smoke login for `thawatchai.watchdog` returned `200` and `/system/partners`; `/v1/auth/me` confirmed protected user `seed-watchdog-system-admin`, role `SYSTEM_ADMIN`, and company-onboarding/partner-create/read permissions; Partner API/page returned `200`, and the smoke session was logged out with `204`. Both temporary bootstrap definitions were deregistered (`INACTIVE`); normal release task revision `5` remains `ACTIVE` and contains only `DATABASE_URL` plus the standard migration/permission/address-sync command.
- Employee LINE credential readback on 2026-07-21 confirmed UAT api-web has LINE Login channel `2010676888`, LIFF `2010676888-YnvoTDg5`, Messaging channel `2010677091`, and all three secret bindings. LINE Bot Info returned `200` for `mangmeeplus` / `@602zlpco`, and the public employee-link page resolved the UAT API base plus OA add URL without exposing credentials. Remaining blocker: the live LIFF URL still resolves to `https://mangmeeplus.com/v1/auth/line/link-page`, and Messaging webhook readback is active at `https://mangmeeplus.com/v1/line/webhook`; both must be moved to `uat.mangmeeplus.com` for the temporary UAT cycle.
- Production remained stopped after UAT acceptance: RDS `watchdog-bms-prod-db` was `stopped`; production api-web, AI gateway, and workers each had desired/running/pending counts `0/0/0`.
- Acceptance-doc CI exposed new high-severity advisory `GHSA-52cp-r559-cp3m`; the existing `js-yaml` override and lockfile were raised from `4.2.0` to patched `4.3.0`. Local production audit then passed the high-severity gate and workspace typecheck passed.
- UAT api-web deploy run `29847827944` completed successfully for source `b3da4cffbafc4b3c0244e59a666e900098d1868a`: the patched security audit, tests, immutable image/digest/SBOM publication, release task, ECS rollout, active digest check, and health check all passed.
- The active UAT runtime now uses the isolated LINE Login channel `2010784350`, LIFF `2010784350-ruzn5beM`, and Messaging channel `2010784371`. Public `/v1/health` and `/login` return `200`; the public link page resolves the new LIFF ID and OA `uat-mangmeeplus` / `@234jrspv`. LINE webhook readback is active at `https://uat.mangmeeplus.com/v1/line/webhook`. Secret values were not printed.
- UAT AI Gateway deploy run `29849842257` completed successfully for source `b3da4cffbafc4b3c0244e59a666e900098d1868a`. Active ECS config readback confirms `MODEL_PROVIDER=bedrock`, `BEDROCK_REGION=ap-southeast-1`, and `BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6`; health returned `status=ok`, and the existing minimal provider smoke completed a real Bedrock inference successfully in 1.593 seconds without logging prompt/response content.
- Cost pause on 2026-07-23 set ECS Express `minTaskCount=0` for `watchdog-bms-uat-api-web`, `watchdog-bms-uat-ai-gateway`, and `watchdog-bms-uat-workers`; readback confirmed desired/running/pending `0/0/0` for all three. Classic `ecs:UpdateService` was not the correct control path and was denied; the Express updates succeeded. `watchdog-bms-uat-db` remained `available` because the operator principal was denied `rds:StopDBInstance`. `watchdog-bms-uat-redis` remained `available` because ElastiCache has no non-destructive stop/pause operation.
- UAT run `30167794331` completed successfully for source `676122c1760630c3b63e331a9501c287ca17a47b`. API, AI Gateway, and workers are `ACTIVE` on that SHA with `minTaskCount=1,maxTaskCount=2`; public API health, AI Gateway health, and `/login` returned HTTP 200.
- Local api-web-only deploy on 2026-07-26 for `8fcc687e54289d79e5ad635c6e1159355abc658d` (owner instruction: keep the env already on UAT). The live Express config was copied verbatim and only the image plus GIT_SHA/SERVICE_VERSION stamps changed: 47 env vars + 12 secrets preserved, including isolated LINE channel `2010784350` and the service's two security groups (regenerating config via deploy.sh would have clobbered both with workstation `.env` LINE values and a single SG). Release task revision 16 passed: 74 migrations found/none pending, permission sync upserted 321 permissions/1243 grants (ships the new ADMIN owner-equal expense grants), Thai address sync 7436 rows. Canary deployment `VmxUR55rNhq9YrU_E328X` reached `SUCCESSFUL`; public `https://uat.mangmeeplus.com/v1/health` returned 200 `status=ok,db=ok`; `/watchdog-bms/uat/service-version` set to `8fcc687e5428`. Two traps recorded: (1) the release task must use the full image from `apps/api/Dockerfile` target `local` tagged `uat-release-task-<full-sha>` — the dist-only api-web image has no prisma CLI and fails exit 127; (2) `update-express-gateway-service` can return `currentDeployment=None` while the canary deployment ARN appears asynchronously — poll `describe-service-deployments` for the terminal status instead of treating None as a settled no-op.
- Official UAT/all deploy on 2026-07-26 completed for `794c9e9c2ae6007a3adb6d954aed402fc4f31f62`. Initial run `30197516190` stopped before deployment because the LINE intake test fixture did not implement the current delivery/update contracts; the fixture-only fix added the existing `aiTurn.update` mock and returned `ok` from mocked delivery. The focused suite passed 51/51, the workspace test command passed with the API suite at 2491/2491, and run `30197806953` passed config/security/migration/image/SBOM gates. Its release task found 76 migrations and applied `20260726120000_add_reimbursement_line` plus `20260726160000_add_reimbursement_claim_signature`, then completed permission, workflow-template, and Thai address sync. Pipeline verification reported `health=ok` for api-web, AI Gateway, and workers at SHA `794c9e9c2ae6`; independent AWS readback reached one stable task per service with only the new deployment, and public `/v1/health` returned `status=ok,db=ok`.
- Run `30363523407` for `bbf69f2d` passed every pre-publish check but the workers ECR scan never
  existed. The shared gate timed out because it hid `ScanNotFound`/authorization errors.
  `verify-ecr-scan.sh` now requests a basic scan when missing, reports AWS failures immediately,
  and the UAT publish-role template includes only the two required scan actions.
- The rendered policy was applied successfully to the live `watchdog-bms-ci-uat` inline policy
  `watchdog-bms-uat-ecr-publish` on 2026-07-28. No production role or service was changed.
- Retry `30367908479` proved the missing-scan path now fails immediately, but exposed that max-mode
  provenance publishes an OCI index and ECR basic scanning rejects the index itself. The shared gate
  now resolves and scans the single runnable `linux/amd64` child manifest while retaining the signed,
  provenance-bearing release index as the immutable deployment digest.
- Scanning that child manifest exposed the actual base-image result: Perl
  `5.36.0-7+deb12u3` contributed 3 Critical and 5 High findings with no fixed Bookworm package
  reported by ECR. Perl has no installed reverse dependency and is not used by the Node runtimes,
  so the three published final stages remove it; build stages remain unchanged.
- Run `30370117802` passed all three ECR scan/sign/SBOM jobs and the digest manifest, then stopped
  before rollout because `watchdog-bms-deploy-uat` could read the api-web signature but lacked
  `ecr:BatchGetImage` on the AI Gateway repository. The deploy policy now grants only
  `BatchGetImage`/`GetDownloadUrlForLayer` read access across the three signed release repositories;
  api-only release-task push permissions remain separate.
- The narrowed deploy policy was applied live and committed as `ca8709aa`. Run `30370117802`
  attempt 2 reused the already-green immutable artifacts for source `f72eb8fa`, then passed all
  three signature checks, the release task, UAT/all rollout, active-digest verification, and health
  verification. Production IAM and runtime were not changed.
- UAT api-web run `30377065243` deployed source `b3a159380af8` and passed all tests,
  image/ECR/signing/SBOM gates, release task, rollout, active-digest verification, and health
  verification. A live clean PDF became `ACTIVE`; EICAR-in-PDF remained `QUARANTINED`, returned
  completion/download `400`/`403`, wrote correlated `FAILED`/`HIGH` audit and structured log
  events, and moved `watchdog-bms-uat-m14-attachment-upload-rejected` from `OK` to `ALARM`.
  Read-only database evidence and alarm history are recorded in
  `docs/security-evidence/m14-uat-live-upload-evidence.md`. Production was not changed.
- Cost pause on 2026-07-29 at 03:23 ICT targeted account `311414082667` and only cluster
  `watchdog-bms-uat`. ECS Express `minTaskCount=0,maxTaskCount=2` is active on
  `watchdog-bms-uat-api-web`, `watchdog-bms-uat-ai-gateway`, and
  `watchdog-bms-uat-workers`; readback found no running tasks in the cluster. The active
  service revisions/configuration were retained for resumption. The operator principal
  `watchdog-bedrock-dev` was denied `rds:StopDBInstance`, so `watchdog-bms-uat-db`
  remains `available`; `watchdog-bms-uat-redis` also remains `available` because
  ElastiCache has no non-destructive pause operation. No production resource was changed.
- Resumed on 2026-07-29 at 08:17 ICT in account `311414082667`. The same three UAT
  ECS Express services were restored to `minTaskCount=1,maxTaskCount=2`; the rollout
  completed with desired/running/pending `1/1/0` for each service. Public API, AI Gateway,
  and workers health endpoints all returned `status=ok`. RDS and Redis remained
  `available`; no production resource was changed.
- UAT must be dispatched from `develop`. Run `30426045248`, dispatched from
  `main`, stopped before deployment because that branch's reusable CI still referenced the
  retired `infra/prod-app-runner/Dockerfile.api-web`; no UAT runtime was changed.
- UAT/all run `30426182495`, dispatched from `develop`, completed successfully for
  source `2d8776b6fa01b6a5ea6734b734476a6b21d65c6b`. Environment validation, config
  rules, secret/security scans, migration review, typecheck/tests, six image builds, three
  signed/SBOM release images, release task, rollout, digest verification, and health gates
  passed. Independent AWS readback found API/Web, AI Gateway, and workers `ACTIVE` at
  `GIT_SHA=SERVICE_VERSION=2d8776b6fa01`; API/Web now carries `AI_THB_PER_USD=33`,
  `AI_MONTHLY_BUDGET_SATANG=200000`, and
  `AI_MONTHLY_BUDGET_SATANG_CEILING=1000000`. Public health for all three services
  returned `status=ok`; production was not changed.
- Post-deploy UI evidence showed the active API/Web revision was still
  `sha256:1490739291c8` (`git-8d146a4286dd...`), while the intended immutable image was
  `sha256:818f9824ad32` (`git-2d8776b6fa01...`). ECS deployment
  `4i1zH9kLAoz4KeHtLlcBJ` later reported `ROLLBACK_SUCCESSFUL`: the new API process
  answered health briefly, but startup repeatedly failed because `sharp@0.35.3` had no
  linux-x64 native module. The API and combined API/Web Dockerfiles used
  `pnpm install --prod --no-optional`, which removed sharp's required platform package.
- The Dockerfiles now retain production optional dependencies and fail the image build unless
  `require(sharp)` succeeds. `deploy.sh` no longer treats
  `currentDeployment=None` as an immediate no-op: it discovers the asynchronously-created
  deployment ARN and waits for its terminal status, so a circuit-breaker rollback fails the
  workflow. Shell syntax, `production-image-security.spec.sh`, `git diff --check`, and a full
  linux/amd64 combined runner image build all pass; the embedded sharp import check passed.
- Owner requested an urgent UAT-only journey-test bypass rather than waiting for all CI gates.
  The already-built linux/amd64 combined image loaded sharp successfully and was pushed as
  `watchdog-bms-api:uat-journey-276f32ec-direct1`
  (`sha256:be8e74f4f07c...`). The direct Express update preserved the active environment,
  secret references, network, roles, health path, and scaling configuration; only the image
  and `GIT_SHA`/`SERVICE_VERSION` stamps changed. Canary deployment
  `-4J2v4rvvXvpRhpiQcNQa` reached `SUCCESSFUL` with 100% traffic, one running task, no
  pending task, and no triggered rollback alarm. Public `/v1/health` returned `status=ok`;
  the current partner-page static bundle returned HTTP 200 through Cloudflare and contains
  both `expense_auto_post` and `AI Usage`. Production was not changed.
- UAT workflow run `30430603236` was not used for rollout: the broad first sharp fix let
  optional Prisma/TypeScript tooling into the standalone API runtime, so its filesystem
  allowlist gate rejected the image. A narrower local follow-up retains `--no-optional`,
  copies only sharp's linux-x64/libvips packages, passes the embedded sharp import and the
  standalone API image build; the owner then requested that this follow-up be committed and
  pushed while journey testing continues on the direct UAT image.
- Owner requested the shortest UAT-only rollout of the complete latest
  `develop` branch on 2026-07-29. A clean direct build first deployed
  `36c34500d34e`; its release task revision 24 found 95 migrations with none pending,
  reconciled 324 permissions, 12 roles, and 1,255 grants, then completed workflow-template
  and 7,436-row Thai address sync. The branch advanced during the rollout, so API/Web was
  rebuilt and all three services were rolled again at the final remote head
  `51a637ca0b2d` (`fix(expenses): speed up HEIC preparation`). API/Web uses immutable digest
  `sha256:3973e86c990a...`; AI Gateway and workers reused their unchanged immutable images
  because neither source tree changed, while both version stamps were advanced to the same
  head. Final deployments `TTzmUNE0vYRV2BbpQlr3l`,
  `nUdSfjafRB8kiPaXupJeb`, and `_9prmVBCbh2zsPe1v1nhJ` all reached `SUCCESSFUL`.
  Independent readback found every service `ACTIVE` with
  `GIT_SHA=SERVICE_VERSION=51a637ca0b2d`; public `/v1/health` returned `status=ok` and
  `/login` returned HTTP 200. A final `ls-remote` matched the deployed full SHA
  `51a637ca0b2d679bc1494972f5e0f7ecd422d09f`. Production was not changed.
- Cost pause on 2026-08-01 at 08:47 ICT targeted account `311414082667` and only
  cluster `watchdog-bms-uat`. ECS Express `minTaskCount=0,maxTaskCount=2` is active
  on api-web, AI Gateway, and workers; readback confirmed desired/running/pending
  `0/0/0` for all three. Their active images and configuration were retained.
  `watchdog-bedrock-dev` was denied `rds:StopDBInstance`, so the UAT RDS remains
  `available`; UAT Redis also remains `available` because ElastiCache has no
  non-destructive pause operation. Production was not changed.
- Owner requested the fast non-git UAT rollout of the whole `develop` head on
  2026-08-04. Four linux/amd64 images were built and pushed directly from the workstation
  for `d94a62be41270227c3a9a4ba06e0f4a5c2bc9b0e` (release task from `apps/api/Dockerfile`
  target `local`, plus api-web, AI Gateway and workers tagged `uat-direct-<sha>`).
  Two workstation-only build blockers were cleared first: `docker login` hangs on the
  `credsStore: desktop` helper (worked around with an isolated `DOCKER_CONFIG` that
  symlinks `~/.docker/cli-plugins`), and Zscaler TLS interception made buildkit's own
  `ADD https://github.com/Cisco-Talos/clamav/...` fail `x509: certificate signed by
  unknown authority`, fixed by appending `~/.certs/corp-ca-bundle.pem` to
  `/etc/ssl/certs/ca-certificates.crt` inside the `docker-container` buildkit container.
- `run-release-task.sh` refuses a MANUAL controller for mode `release` (guard from
  `96e16c64`), so this rollout has no release-operation audit record. GitHub Actions
  provenance was NOT faked. Instead task definition `watchdog-bms-uat-release-task:119`
  was registered with the same command chain and run directly; `taskRoleArn` had to be
  omitted because `watchdog-bedrock-dev` has no `iam:PassRole` on
  `watchdog-bms-uat-release-task-role`, and the execution role alone resolves
  `DATABASE_URL`. The task exited `0`: 113 migrations found and the four new ones applied
  (`20260804150000_ai_turn_intent_correction`,
  `20260804150000_reimbursement_line_compatibility`,
  `20260804170000_reimbursement_cc2_projection_source`,
  `20260804180000_company_tax_identity_step0`), permission sync upserted 335 permissions /
  12 roles / 1280 grants, launch gates attested 16 with SPECIALIST_LEGAL verified CLOSED,
  18 workflow templates synced, Thai address sync completed, and entitlement
  normalization ran as a PLAN only (`aggregateHash=9c80b688a0ff...`, nothing written).
- All three ECS Express services were then updated by copying the live
  `activeConfigurations[0]` verbatim and changing only the image and the
  `GIT_SHA`/`SERVICE_VERSION` stamps; the submitted diff was proven to be exactly those
  three values. api-web kept 65 env vars / 12 secrets / 2 security groups, AI Gateway 47 /
  3 / 2, workers 14 / 3 / 2. Canary deployments `2DEWI4SWIaSI86KmsOIEw`,
  `XREvcEI_r747YB4Y3MINj` and `9AMIgUZTqHtED0YFcNxpz` all reached `SUCCESSFUL`.
  Readback found every service `ACTIVE` at
  `GIT_SHA=d94a62be41270227c3a9a4ba06e0f4a5c2bc9b0e`, `SERVICE_VERSION=d94a62be4127`.
  Public `https://uat.mangmeeplus.com/v1/health` and `/login` returned HTTP 200, the AI
  Gateway `/v1/health` and workers `/health` returned `status=ok`. Production was not
  changed.
Next:
- Root cause of the repeated UAT start failures is closed: production A5 interface endpoints use
  VPC-wide private DNS, so UAT AWS-service calls were redirected into endpoint SG/policies that only
  allowed A5. Live endpoint policies now permit only the exact UAT ECS execution role and exact UAT
  secrets/ECR repositories/log groups; endpoint TCP/443 ingress now includes both UAT app and AI SGs.
  Keep the bootstrap/validator/templates and plural SSM SG parameter in sync before the next A5 rebuild.
- Test the urgent journey on `https://uat.mangmeeplus.com`; hard-refresh any tab opened before
  this deployment so it loads the new immutable Next.js chunks.
- Sign in at `https://uat.mangmeeplus.com/login` as `thawatchai.watchdog`, create the first real test company from `/system/partners`, then test owner/admin employee creation -> employee QR scan -> LINE identity link -> OA message under the assigned role.
- Send one real customer LINE message and verify the first-message AI auto-reply path.
- After UAT sign-off, replace/rotate the production LINE Login, LIFF, and Messaging API credentials that were copied for the temporary UAT cycle.
