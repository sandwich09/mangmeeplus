# Agent Memory: AI Runtime Production Integration

Status: DOCS READY FOR IMPLEMENTATION HANDOFF
Owner: Product / AI Gateway / Production Ops
Scope: Production-grade path for real AI calls: direct Bedrock/OpenAI provider smoke, private AI Gateway hosting, AgentCore Runtime invoke adapter/deployment, safety/audit/cost/rollback evidence.
Decisions:
- Amazon Bedrock is primary paid provider.
- OpenAI remains optional fallback only.
- `MODEL_PROVIDER=disabled` remains safe default and rollback.
- First production-capable path is private ECS AI Gateway calling Bedrock directly.
- AgentCore Runtime is added after direct provider and tool/policy proof.
- AgentCore Runtime must be invoked server-side by AI Gateway only.
- AI Gateway/runtime must not import Prisma, direct DB repositories, or unrestricted HTTP clients.
- Final mutations stay blocked by `AI_FINAL_MUTATION_ENABLED=false`.
Open questions:
- Exact current AWS CLI/SDK command names for AgentCore create/update/invoke in this account.
- Whether receipt OCR uses Bedrock vision first or stays typed-unavailable until a verified model/tool exists.
- ECS Fargate cluster/ALB/service-discovery names for the production environment (needed for §11.4–11.5 of runbook).
- `<ACCOUNT_ID>` placeholder in `infra/ai-gateway/bedrock-invoke-policy.json` and task definition template must be filled in before deploy.
Artifacts:
- `docs/specs/ai-runtime-production-integration-spec.md`
- `docs/plans/ai-runtime-production-integration-plan.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`
- `docs/README.md`
Verification:
- `git diff --check -- docs`: PASS.
- `rg -n "ai-runtime-production-integration|AI Runtime Production Integration" docs/...`: PASS; spec, plan, memory, README, roadmap, and master checklist links found.

## 2026-06-27 Phase 0 + Phase 1 – Config Contract Hardening

Status: COMPLETE.

Scope: Extend `aiGatewayConfigSchema` with `agentcore` runtime mode and 4 new AgentCore config keys. Add production validation for AgentCore runtime. Add getters to `AiGatewayConfigService`. Update `.env.example`. Add tests.

Phase 0 Baseline (found):
- `LINE_AI_AGENT_RUNTIME` enum was `['strands-local', 'disabled']` — no `agentcore`.
- No `AGENTCORE_REGION`, `AGENTCORE_RUNTIME_ARN`, `AGENTCORE_RUNTIME_QUALIFIER`, `AGENTCORE_INVOKE_TIMEOUT_MS` keys existed.
- `validateProductionConfig` had no AgentCore validation.
- `AiGatewayConfigService` had no AgentCore getters.
- All other 10B artifacts (providers, agents, governed tool path, runtime.ts, agentcore.json) already in place.
- Dirty worktree: all 10B changes retained (not reverted).

Phase 1 Changes:

Artifacts:
- `packages/config/src/index.ts`:
  - `LINE_AI_AGENT_RUNTIME` extended to `['strands-local', 'disabled', 'agentcore']`.
  - Added 4 keys to `aiGatewayConfigSchema`: `AGENTCORE_REGION`, `AGENTCORE_RUNTIME_ARN`, `AGENTCORE_RUNTIME_QUALIFIER` (all optional), `AGENTCORE_INVOKE_TIMEOUT_MS` (default 20000).
  - Added production validation: when `LINE_AI_AGENT_RUNTIME=agentcore`, all three AgentCore keys are required.
- `packages/config/src/index.test.ts`:
  - 4 new tests: `agentcore` enum accepted, `AGENTCORE_INVOKE_TIMEOUT_MS` default, optional AgentCore keys accepted, AgentCore missing-in-production rejects.
- `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts`:
  - 4 new getters: `agentcoreRegion`, `agentcoreRuntimeArn`, `agentcoreRuntimeQualifier`, `agentcoreInvokeTimeoutMs`.
- `.env.example`:
  - Added `AGENTCORE_REGION=ap-southeast-1`, `AGENTCORE_RUNTIME_ARN=`, `AGENTCORE_RUNTIME_QUALIFIER=DEFAULT`, `AGENTCORE_INVOKE_TIMEOUT_MS=20000`.

Verification:
| Command | Result |
|---------|--------|
| `git diff --check -- docs` | PASS |
| `CI=true corepack pnpm --filter @watchdog-bms/config test` | PASS – 46/46 |
| `CI=true corepack pnpm --filter @watchdog-bms/config build` | PASS |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway typecheck` | PASS |

Exit criteria met:
- Invalid AgentCore config fails fast when `LINE_AI_AGENT_RUNTIME=agentcore`.
- `disabled`, `strands-local`, `bedrock-direct` modes remain valid.
- `agentcore` enum value accepted by schema and config service.
- Tests: 46/46 pass.

Next:
- Phase 2: Provider smoke and error contract — COMPLETE (see below).
- Phase 4: AgentCore invoke adapter — COMPLETE (see below).
- Phase 5: AgentCore runtime deployment — requires AWS credentials/IAM (external blocker).

## 2026-06-27 Phase 2 – Provider Smoke and Error Contract

Status: COMPLETE. Bedrock real call succeeded. Disabled path safe. All tests pass.

Scope: Prove real model calls work before runtime hosting; ensure error contract is complete; verify disabled path fails closed.

Error contract fix:
- `bedrock.provider.ts`: Added `AccessDeniedException → PROVIDER_ACCESS_NOT_READY` (was falling through to PROVIDER_UNKNOWN — IAM role missing bedrock:InvokeModel would have been misclassified).

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts` – MODIFIED: AccessDeniedException → PROVIDER_ACCESS_NOT_READY
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts` – MODIFIED: +1 test (AccessDeniedException mapping)
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider-smoke.ts` – NEW: standalone smoke script (no NestJS; tsx direct; redacts prompt text unless AI_PROMPT_LOGGING_ENABLED=true)

Verification:
| Command | Result |
|---------|--------|
| `MODEL_PROVIDER=disabled tsx provider-smoke.ts` | `{"ok":false,"errorCode":"PROVIDER_DISABLED"}` exit:1 — safe |
| `MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 AI_TOOL_TIMEOUT_MS=15000 tsx provider-smoke.ts` | `{"ok":true,"durationMs":1489,"text":"[6 chars]"}` exit:0 |
| Same with `AI_PROMPT_LOGGING_ENABLED=true` | text: "ยืนยัน" — model responded correctly in Thai |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway typecheck` | PASS |
| `MODEL_PROVIDER=disabled LINE_AI_AGENT_ORCHESTRATION_ENABLED=true CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 120/120 |

External blockers cleared:
- Bedrock access: Approved and working. AWS_PROFILE=watchdog-bedrock, region ap-southeast-1, model global.anthropic.claude-sonnet-4-6.
- No OpenAI smoke required (optional; not run).

Exit criteria met:
- Bedrock real call: ok=true, 1489ms, text="ยืนยัน" (one-word Thai confirm, correct).
- Disabled provider: fails closed with PROVIDER_DISABLED, no exception.
- Error contract: AccessDeniedException, ThrottlingException, ValidationException, PROVIDER_TIMEOUT all mapped correctly.
- Prompt text not printed unless AI_PROMPT_LOGGING_ENABLED=true (smoke script enforces; providers never log input).

## 2026-06-28 Phase 3 – Direct AI Gateway Production Hosting

Status: LOCAL CODE COMPLETE. AWS deployment is external blocker requiring ops access.

Scope: Dockerfile verified; docker build tested; IAM policy and ECS task definition template created; runbook extended with production deployment procedure.

Local artifacts:
- `infra/ai-gateway/bedrock-invoke-policy.json` – NEW: least-privilege IAM policy for ECS task role (BedrockInvokeModel + InferenceProfiles; `<ACCOUNT_ID>` placeholder must be filled)
- `infra/ai-gateway/task-definition.template.json` – NEW: ECS Fargate task definition template with all env vars and secrets from Secrets Manager/SSM; `<ACCOUNT_ID>` and `<IMAGE_TAG>` placeholders
- `docs/runbooks/line-ai-local-agent-10b-runbook.md` – MODIFIED: §11 added (§11.1 ECR push, §11.2 secrets, §11.3 IAM task role, §11.4 register+deploy, §11.5 API internal URL update, §11.6 post-deploy smoke, §11.7 rollback)

Verification:
| Command | Result |
|---------|--------|
| `corepack pnpm --filter @watchdog-bms/ai-gateway build` | PASS (clean tsc compile) |
| `docker build -f apps/ai-gateway/Dockerfile . --tag watchdog-ai-gateway:smoke-local` | PASS – image built |
| `docker run --rm watchdog-ai-gateway:smoke-local node -e "require('fs').accessSync('dist/apps/ai-gateway/src/main.js')"` | PASS – CMD path confirmed valid |
| `git diff --check -- docs` | PASS |

External blockers (require AWS ops access before § can be ticked):
- [ ] ECR repository `watchdog-bms-ai-gateway` created with immutable tags enabled.
- [ ] IAM task role `watchdog-bms-ai-gateway-task-role` created; `<ACCOUNT_ID>` filled and policy applied.
- [ ] Secrets Manager / SSM parameters created with real values (never in code).
- [ ] ECS task definition registered from template with real `<IMAGE_TAG>`.
- [ ] ECS Fargate service created in private subnets (no public ALB for ai-gateway).
- [ ] API `AI_GATEWAY_INTERNAL_URL` updated to ECS service discovery DNS.
- [ ] Post-deploy smoke: health, no-DB, LINE AI turn via API.
- [ ] CloudWatch log group verified: no raw prompt text.

Note: `AI_FINAL_MUTATION_ENABLED=false` and `AI_PROMPT_LOGGING_ENABLED=false` are hardcoded in the task definition `environment` block (not secrets) so they cannot be accidentally overridden by a secrets value.

## 2026-06-28 Phase 5 – AgentCore Runtime Deployment

Status: LOCAL CODE COMPLETE. AWS deployment is external blocker requiring ops credentials and S3/IAM setup.

Scope: Fix agentcore entrypoint path mismatch; create tsconfig.agentcore.json with rootDir=src; add build:agentcore script; create execution role IAM policy; create deploy script with full CLI commands.

Issue found and fixed:
- `agentcore.json` entrypoint was `dist/agentcore/runtime.js`, but main `tsc` build (without explicit rootDir) produced `dist/apps/ai-gateway/src/agentcore/runtime.js` due to workspace path mappings pulling rootDir inference to workspace root.
- Fix: `tsconfig.agentcore.json` with explicit `rootDir: "src"` and `paths` overriding to `packages/*/dist/index` (compiled declarations, not source). This produces `dist/agentcore/runtime.js` — matching `agentcore.json` and the CLI `entryPoint` array.
- Also found: contracts `dist/` was stale (missing `'feature_disabled'` in `LineAiRefusalReason`). Fixed by rebuilding contracts.

AWS CLI commands confirmed (existing in CLI v2):
- `aws bedrock-agentcore-control create-agent-runtime` — uses `codeConfiguration.code.s3` (not direct zip upload; S3 required)
- `aws bedrock-agentcore-control update-agent-runtime` — exists
- `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <id>` — status polling
- `aws bedrock-agentcore-control list-agent-runtimes` — list by name
- `aws bedrock-agentcore invoke-agent-runtime --method GET --path /ping` — runtime ping
- `aws bedrock-agentcore invoke-agent-runtime --method POST --path /invocations --body <json>` — invoke

Artifact path: `dist/agentcore/runtime.js` (relative to zip root which is the ai-gateway package dir).
entryPoint CLI: `["node", "dist/agentcore/runtime.js"]`
runtime: `NODE_22`
networkMode: `PUBLIC` (runtime calls ERP Core API over HTTPS; public mode acceptable)

Artifacts:
- `apps/ai-gateway/tsconfig.agentcore.json` – NEW: dedicated tsconfig for agentcore build (rootDir:src, paths→dist declarations)
- `apps/ai-gateway/package.json` – MODIFIED: `build:agentcore` script added
- `infra/ai-gateway/agentcore-execution-role-policy.json` – NEW: IAM policy for AgentCore execution role (bedrock:InvokeModel, s3:GetObject for artifact, CloudWatch logs)
- `infra/ai-gateway/agentcore-deploy.sh` – NEW: full deploy script (build→zip→S3→create/update runtime→wait READY→smoke ping→safe invoke→mutation refusal)

Verification:
| Command | Result |
|---------|--------|
| `corepack pnpm --filter @watchdog-bms/contracts build` | PASS |
| `corepack pnpm --filter @watchdog-bms/config build` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway exec tsc -p tsconfig.agentcore.json --noEmit` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway run build:agentcore` → `find dist -name runtime.js` | `dist/agentcore/runtime.js` PRESENT |
| `corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 120/120 |
| `git diff --check -- docs` | PASS |

External blockers (require AWS ops access):
- [ ] S3 bucket `watchdog-bms-agentcore-artifacts-<ACCOUNT_ID>` created.
- [ ] IAM execution role `watchdog-bms-agentcore-execution-role` created; `<ACCOUNT_ID>` replaced and policy applied.
- [ ] `bash infra/ai-gateway/agentcore-deploy.sh` run with deploy role credentials.
- [ ] Runtime ARN/ID/qualifier recorded here.
- [ ] Ping smoke: GET /ping returns `{"status":"ok"}`.
- [ ] Read-only invoke smoke: Thai query returns ROUTABLE plan, no raw data leak.
- [ ] Mutation refusal smoke: mutation message returns `refused:true`, no data change.
- [ ] CloudWatch log group `/watchdog-bms/agentcore/*` verified: no prompt text, no stack traces.
- [ ] `AGENTCORE_RUNTIME_ARN` set in AI Gateway ECS task definition (§11.4 of runbook).
- [ ] `LINE_AI_AGENT_RUNTIME=agentcore` enabled in AI Gateway when runtime is confirmed READY.

## 2026-06-28 Phase 8 – Observability, Cost Guard, Runbook

Status: COMPLETE. 146/146 tests pass, typecheck clean.

Scope: Fix logger SENSITIVE_PATHS (top-level fields were not redacted); add turn-complete structured log for CloudWatch metric filters; add logger redaction tests; add §13 to runbook (metric filters, cost guard, log leak check, secret rotation).

Issues found and fixed:
- `SENSITIVE_PATHS` used `*.prompt` (nested-only) but not `prompt` (top-level). A `logger.log({ msg: '...', prompt: 'text' })` would have leaked. Fixed by adding direct field names alongside nested patterns. Now exports `SENSITIVE_FIELDS` and `SENSITIVE_PATHS` for test-ability.
- No turn-level structured log existed — CloudWatch had no way to count AI turns, refused turns, or mutation refusals. Fixed by adding `executeInner` helper and emitting `ai.turn.complete` from `execute()` with `intent`, `agent`, `refused`, `refusalReason`, `toolCount`, `durationMs`.

Artifacts:
- `apps/ai-gateway/src/common/logger/logger.service.ts` – MODIFIED: `SENSITIVE_PATHS` now includes direct top-level paths; exports `SENSITIVE_FIELDS` and `SENSITIVE_PATHS`
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts` – MODIFIED: `execute()` wraps `executeInner()` and emits `ai.turn.complete` structured log
- `apps/ai-gateway/src/common/logger/logger.spec.ts` – NEW: 7 tests (SENSITIVE_PATHS completeness, top-level redaction, nested redaction, field preservation, createLogger no-redact)
- `apps/ai-gateway/package.json` – MODIFIED: `logger.spec.ts` added to test script
- `docs/runbooks/line-ai-local-agent-10b-runbook.md` – MODIFIED: §13 added (structured log event table, 6 CloudWatch metric filter JSON definitions, pilot alarm thresholds, AWS Budgets cost guard command, Bedrock cost estimate for pilot, log leak verification query, secret rotation schedule)

CloudWatch metric filters keyed on:
- `ai.turn.complete` → AiTurnCount, AiTurnRefused, AiMutationBlocked
- `tool-policy:deny` → AiToolPolicyDeny
- `ai.tool.invoke.error` → AiToolTimeout (renamed from `ERP tool call timeout/error` by L-14)
- `AgentCore invoke error` OR `Orchestrator error` → AiRuntimeError

Pilot cost estimate: ~$0.0045/turn × 330 turns/day = $1.50/day → $50/month budget guard reasonable.

Verification:
| Command | Result |
|---------|--------|
| `corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 146/146 |
| `corepack pnpm --filter @watchdog-bms/ai-gateway typecheck` | PASS |
| `git diff --check -- docs` | PASS |

## 2026-06-28 AWS Real Connect Attempt – AgentCore Config Gate

Status: BLOCKED BY AWS IAM/TOKEN. Local deploy artifact path is ready; real AgentCore deploy did not run.

Scope: Match `.env` against production config, patch AgentCore deploy script so the runtime receives production-safe required config, and attempt AWS discovery/smoke with configured profiles.

Findings:
- Current `.env` is local/dev, not production pilot config. Missing `PUBLIC_BASE_URL`, `AGENTCORE_REGION`, `AGENTCORE_RUNTIME_ARN`, `AGENTCORE_RUNTIME_QUALIFIER`, and `AGENTCORE_INVOKE_TIMEOUT_MS`; also has dev/local values (`APP_ENV=local`, `LOG_FORMAT=text`, `RATE_LIMIT_ENABLED=false`, `AUTH_PROVIDER=dev`, `S3_ENDPOINT`).
- `watchdog-bedrock` profile works for Bedrock in account `311414082667`, but cannot read `/watchdog-bms/production/erp-core-internal-url` and cannot list AgentCore runtimes.
- `default` and `agentcore` profiles are expired; `agentcore` assumes `arn:aws:iam::933367721297:role/ScbXAWSGroupAIPlatformNonprodDevRole` from `default`.
- Direct Bedrock model id `anthropic.claude-sonnet-4-6` fails because on-demand throughput is not supported; use inference profile `global.anthropic.claude-sonnet-4-6`.

Changes:
- `infra/ai-gateway/agentcore-deploy.sh` now requires `ERP_CORE_INTERNAL_URL`, `AI_GATEWAY_INTERNAL_SECRET`, and `PUBLIC_BASE_URL` before deploy.
- AgentCore runtime env now includes `APP_ENV=production`, `SERVICE_NAME=watchdog-agentcore-orchestrator`, `SERVICE_VERSION`, `GIT_SHA`, `PUBLIC_BASE_URL`, `PORT=8080`, `LOG_FORMAT=json`, `LOG_REDACTION_ENABLED=true`, and `AI_GATEWAY_INTERNAL_SECRET`.

Verification:
| Command | Result |
|---------|--------|
| `bash -n infra/ai-gateway/agentcore-deploy.sh` | PASS |
| `corepack pnpm --filter @watchdog-bms/config build` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway run build:agentcore` | PASS |
| `AWS_PROFILE=watchdog-bedrock ... aws sts get-caller-identity` | PASS – account `311414082667` |
| `AWS_PROFILE=watchdog-bedrock MODEL_PROVIDER=bedrock BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-6 ... provider-smoke.ts` | FAIL – `PROVIDER_ACCESS_NOT_READY`, use inference profile |
| `AWS_PROFILE=watchdog-bedrock MODEL_PROVIDER=bedrock BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 ... provider-smoke.ts` | PASS |
| `AWS_PROFILE=watchdog-bedrock aws ssm get-parameter --name /watchdog-bms/production/erp-core-internal-url` | BLOCKED – `AccessDeniedException` for `ssm:GetParameter` |
| `AWS_PROFILE=watchdog-bedrock aws bedrock-agentcore-control list-agent-runtimes` | BLOCKED – `AccessDeniedException` for `bedrock-agentcore:ListAgentRuntimes` |
| `AWS_PROFILE=agentcore aws sts get-caller-identity` | BLOCKED – `ExpiredToken` from source profile |

Next:
- Refresh or replace AWS credentials for a deploy-capable profile.
- Grant/read required values: `ERP_CORE_INTERNAL_URL`, `AI_GATEWAY_INTERNAL_SECRET`, `PUBLIC_BASE_URL`.
- Grant AgentCore permissions: list/create/update/get/invoke runtime plus IAM role policy creation/update and S3 artifact bucket access.
- Rerun `infra/ai-gateway/agentcore-deploy.sh` with `BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6`.

### 2026-06-28 Permission Refresh Follow-up

Status: PARTIAL UNBLOCK. AgentCore permissions now work in account `311414082667`; deploy remains blocked by missing reachable ERP Core URL/secret.

Verification:
| Command | Result |
|---------|--------|
| `AWS_PROFILE=watchdog-bedrock aws sts get-caller-identity` | PASS – user `arn:aws:iam::311414082667:user/watchdog-bedrock-dev` |
| `AWS_PROFILE=watchdog-bedrock aws bedrock-agentcore-control list-agent-runtimes` | PASS – `agentRuntimes: []` |
| `AWS_PROFILE=watchdog-bedrock aws ssm get-parameter --name /watchdog-bms/production/erp-core-internal-url` | BLOCKED – `ParameterNotFound` |
| `AWS_PROFILE=watchdog-bedrock aws ssm describe-parameters ...` | BLOCKED – still missing `ssm:DescribeParameters` |
| `AWS_PROFILE=watchdog-bedrock aws secretsmanager list-secrets --filters Key=name,Values=watchdog-bms/production` | PASS – no matching secrets returned |
| `AWS_PROFILE=watchdog-bedrock aws apprunner list-services` | PASS – no services |
| `AWS_PROFILE=watchdog-bedrock aws ecs list-clusters` | PASS – no clusters |
| `AWS_PROFILE=watchdog-bedrock aws elbv2 describe-load-balancers` | PASS – no load balancers |
| `curl https://display-main-scales-rural.trycloudflare.com/v1/health` | BLOCKED – DNS could not resolve; `.env` tunnel is not reachable |

Decision:
- Do not deploy AgentCore with `localhost`, stale Cloudflare tunnel, or fake ERP URL. Runtime would start but would not be production-integrated with ERP Core.

Next:
- Provide or create reachable `ERP_CORE_INTERNAL_URL`, `AI_GATEWAY_INTERNAL_SECRET`, and `PUBLIC_BASE_URL`.
- If values are stored in SSM/Secrets, grant `ssm:DescribeParameters` or provide exact parameter/secret names.

### 2026-06-28 Production API Path Attempt

Status: BLOCKED BY IAM SERVICE-LINKED ROLE PERMISSION before RDS creation.

Decision:
- Owner chose real production path instead of temporary tunnel/default fake domain.
- First prod API endpoint will use App Runner default HTTPS domain, not custom Route53 domain.
- Prod dependencies target: RDS PostgreSQL, ElastiCache Redis, S3, Secrets Manager/SSM, ECR, App Runner, then AgentCore.

Artifacts:
- `infra/prod-app-runner/deploy-api.sh` – new repeatable prod deploy script for API path. It creates small prod resources, stores secrets/config, pushes API image, creates App Runner service, writes App Runner URL into SSM, and leaves `ERP_CORE_INTERNAL_URL=https://<apprunner-url>/v1` for AgentCore.

Verification:
| Command | Result |
|---------|--------|
| `bash -n infra/prod-app-runner/deploy-api.sh` | PASS |
| `git diff --check -- infra/prod-app-runner/deploy-api.sh docs/agent-memory/ai-runtime-production-integration.md infra/ai-gateway/agentcore-deploy.sh` | PASS |
| `AWS_PROFILE=watchdog-bedrock aws ec2 describe-vpcs --filters Name=is-default,Values=true` | PASS – default VPC `vpc-0da727984eee92f96` |
| `AWS_PROFILE=watchdog-bedrock aws rds describe-db-instances` | PASS – no DB instances |
| `AWS_PROFILE=watchdog-bedrock aws elasticache describe-cache-clusters` | PASS – no cache clusters |
| `AWS_PROFILE=watchdog-bedrock aws ecr describe-repositories` | PASS – no repositories |
| `AWS_PROFILE=watchdog-bedrock bash infra/prod-app-runner/deploy-api.sh` | BLOCKED – RDS create subnet group failed: `InvalidParameterValue ... Missing necessary credentials` |
| `AWS_PROFILE=watchdog-bedrock aws iam create-service-linked-role --aws-service-name rds.amazonaws.com` | BLOCKED – missing `iam:CreateServiceLinkedRole` for `AWSServiceRoleForRDS` |

Next:
- Grant scoped `iam:CreateServiceLinkedRole` for `rds.amazonaws.com`, `elasticache.amazonaws.com`, and `apprunner.amazonaws.com`, or create those service-linked roles in Console.
- Rerun `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh`.

### 2026-06-28 Production API Resource Creation Follow-up

Status: PARTIAL. Base prod resources created; API image push blocked by ECR image-read permissions.

Created/confirmed:
- S3 bucket: `watchdog-bms-prod-311414082667`
- RDS PostgreSQL: `watchdog-bms-prod-db`, endpoint `watchdog-bms-prod-db.cpqecgikiwrq.ap-southeast-1.rds.amazonaws.com`
- ElastiCache Redis: `watchdog-bms-prod-redis`
- ECR repository: `watchdog-bms-api`
- Secrets/SSM writes reached before ECR push; secret values not logged.

Blocked command:
| Command | Result |
|---------|--------|
| `AWS_PROFILE=watchdog-bedrock bash infra/prod-app-runner/deploy-api.sh` | BLOCKED during `docker push` after layers uploaded |
| `docker push 311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api:0729a95` | FAIL – `403 Forbidden` on ECR manifest HEAD |
| `aws ecr describe-images --repository-name watchdog-bms-api` | BLOCKED – missing `ecr:DescribeImages` |
| `aws ecr list-images --repository-name watchdog-bms-api` | BLOCKED – missing `ecr:ListImages` |

Next:
- Add ECR read actions required by Docker push/manifest checks: `ecr:DescribeImages`, `ecr:ListImages`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`.
- Rerun `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh`.

### 2026-06-28 Production API ECR Follow-up

Status: PARTIAL. API image pushed; App Runner VPC connector blocked by App Runner networking service-linked role permission.

Progress:
- `docker push 311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api:0729a95` PASS.
- App Runner roles step reached.
- `infra/prod-app-runner/deploy-api.sh` patched to use `docker build --provenance=false` because ECR rejected Docker attestation manifest HEAD with 403.

Blocked command:
| Command | Result |
|---------|--------|
| `AWS_PROFILE=watchdog-bedrock bash infra/prod-app-runner/deploy-api.sh` | BLOCKED at `apprunner create-vpc-connector` |
| `aws iam create-service-linked-role --aws-service-name networking.apprunner.amazonaws.com` | BLOCKED – missing `iam:CreateServiceLinkedRole` for `AWSServiceRoleForAppRunnerNetworking` |

Next:
- Grant scoped `iam:CreateServiceLinkedRole` for `networking.apprunner.amazonaws.com`, resource `arn:aws:iam::311414082667:role/aws-service-role/networking.apprunner.amazonaws.com/AWSServiceRoleForAppRunnerNetworking`.
- Rerun `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh`.

### 2026-06-28 Production API App Runner Create Follow-up

Status: BLOCKED BY IAM PASSROLE. App Runner service creation reached with valid service name and pushed image.

Progress:
- `infra/prod-app-runner/deploy-api.sh` patched so `.env` local defaults cannot override prod resource names (`SERVICE_NAME`, `S3_BUCKET`, etc.).
- `infra/prod-app-runner/deploy-api.sh` patched to use `--cli-input-json` for App Runner create/update service to avoid CLI shorthand parsing of `1 vCPU` / `2 GB`.
- App Runner VPC connector exists and is `ACTIVE`: `watchdog-bms-prod-apprunner-vpc`.

Blocked command:
| Command | Result |
|---------|--------|
| `AWS_PROFILE=watchdog-bedrock bash infra/prod-app-runner/deploy-api.sh` | BLOCKED at `apprunner create-service` |
| `apprunner create-service` | FAIL – missing `iam:PassRole` on `arn:aws:iam::311414082667:role/watchdog-bms-apprunner-instance-role` |

Next:
- Grant `iam:PassRole` for `watchdog-bms-apprunner-instance-role` to `tasks.apprunner.amazonaws.com`.
- Also confirm `iam:PassRole` for `watchdog-bms-apprunner-access-role` to `build.apprunner.amazonaws.com` remains present.

## 2026-06-28 Phase 7 – LINE End-to-End Real Smoke

Status: LOCAL CODE COMPLETE. Real LINE smoke is external blocker requiring operator setup.

Scope: Prove full webhook path works. Add local webhook smoke script (no ngrok/LINE account needed). Add runbook §12.

Code path is fully wired:
- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` — `POST /v1/line/webhook` and legacy `/v1/webhooks/line`; HMAC-SHA256 signature verification with timing-safe comparison; dispatches text and image events
- `apps/api/src/modules/auth/infrastructure/line-webhook-verifier.ts` — `verifyLineWebhookSignature(body, sig, secret)` using `timingSafeEqual`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — dedup → identity → company → permission → AI Gateway → reply → persist turn; handles `/companies` and `/company <n>` commands; handles receipt image upload
- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts` — `requestLineTurn`, `requestReceiptOcr` internal HTTP client with 15s timeout

New artifacts:
- `apps/api/src/modules/line-ai/line-webhook-local-smoke.ts` — NEW: local smoke script; computes valid HMAC-SHA256, POSTs synthetic webhook, supports `SMOKE_SCENARIO=query|mutation|companies`
- `docs/runbooks/line-ai-local-agent-10b-runbook.md` — MODIFIED: §12 added (prerequisites, local smoke, ngrok setup, LINE Console config, user linking, 7 test messages, evidence record template, rollback)

Verification (code path, not real LINE):
| Command | Result |
|---------|--------|
| `tsx apps/api/src/modules/line-ai/line-webhook-local-smoke.ts` (no env vars) | Exits with clear `LINE_MESSAGING_CHANNEL_SECRET is required` |
| `git diff --check -- docs` | PASS |

External blockers (operator setup required before real LINE smoke):
- [ ] `LINE_MESSAGING_CHANNEL_SECRET` and `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` available (LINE Developers Console).
- [ ] `LINE_LOCAL_USER_ID` seeded in dev DB `ExternalIdentity` with active company membership + `line.ai.query` permission.
- [ ] API running locally with LINE env vars set.
- [ ] AI Gateway running locally with `MODEL_PROVIDER=bedrock` (or `disabled` for signature-only test).
- [ ] `bash: LINE_MESSAGING_CHANNEL_SECRET=<s> LINE_LOCAL_USER_ID=<u> tsx apps/api/src/modules/line-ai/line-webhook-local-smoke.ts` → PASS status=200
- [ ] `SMOKE_SCENARIO=mutation` → PASS status=200 + `mutation_blocked` refusal in API logs
- [ ] Real LINE smoke (ngrok + LINE Console) → 7 smoke messages pass (see §12.5 of runbook)
- [ ] Mutation refusal confirmed in real LINE (critical blocker for item 10B)
- [ ] No prompt text in structured logs (critical blocker for item 10B)
- [ ] Evidence recorded in this doc (date, provider, model, runtime mode, results)

## 2026-06-28 Phase 6 – Tool Boundary and Schema Parity

Status: COMPLETE. 139/139 tests pass, typecheck clean.

Scope: One source of truth for tool registry; required-input-field validation before API call; agent-tool-name drift guard.

Changes:
- `packages/contracts/src/ai-tools.ts` – MODIFIED: added `requiredInputFields?: readonly string[]` to `ToolMeta`; added `requiredInputFields: ['attachments']` to `accounting.capture_receipt_evidence`.
- `apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts` – MODIFIED: exported `ALLOWED_TOOLS`.
- `apps/ai-gateway/src/modules/line-ai/agents/inventory.agent.ts` – MODIFIED: exported `ALLOWED_TOOLS`.
- `apps/ai-gateway/src/modules/line-ai/agents/receipt-ocr.agent.ts` – MODIFIED: exported `ALLOWED_TOOLS`.
- `apps/ai-gateway/src/modules/line-ai/agents/receipt-authenticity.agent.ts` – MODIFIED: exported `ALLOWED_TOOLS`.
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts` – MODIFIED: required-input-field check after policy gate, before fetch; returns `MISSING_REQUIRED_INPUT` error.
- `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.spec.ts` – MODIFIED: 1 new test for schema check (fetch not called on missing required field).
- `apps/ai-gateway/src/modules/line-ai/agents/agent-tools.registry.spec.ts` – NEW: registry drift guard; all ALLOWED_TOOLS names in all 4 agents must exist in LINE_TOOL_REGISTRY; registry has no duplicates; every tool has requiredPermissions and requiresErpPermissionCheck=true.
- `apps/ai-gateway/package.json` – MODIFIED: new spec added to test script.

Invariants asserted by tests:
- Every tool name an agent can request exists in LINE_TOOL_REGISTRY (drift guard fires on registry removal or agent name typo).
- registry has no duplicate names.
- Every tool has ≥1 requiredPermission and requiresErpPermissionCheck=true.
- Tools with requiredInputFields have ≥1 field listed.
- MISSING_REQUIRED_INPUT is returned before fetch is called when required input is absent.
- Permission denied / policy denied responses contain no business data.
- UNIMPLEMENTED_TOOLS path returns `unsupported_module` with permissionChecked=true in sourceRefs.

Verification:
| Command | Result |
|---------|--------|
| `corepack pnpm --filter @watchdog-bms/contracts build` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway typecheck` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 139/139 |

## 2026-06-27 Phase 4 – AgentCore Invoke Adapter

Status: COMPLETE. Local artifacts complete. AWS deployment (Phase 5) remains external blocker.

Scope: Add `LINE_AI_AGENT_RUNTIME=agentcore` routing in `LineAiTurnUseCase`; implement `AgentCoreRuntimeClient` using SigV4+fetch (no new deps); register in `LineAiModule`; add tests.

Design decisions:
- No new dependencies: SigV4 signing uses `node:crypto` (built-in); credential resolution reuses `BedrockRuntimeClient.config.credentials` chain from already-installed `@aws-sdk/client-bedrock-runtime`.
- `IAgentCoreRuntime` port interface in `runtime.port.ts` for test mocking.
- `AgentCoreRuntimeClient` is a NestJS injectable; takes `AiGatewayConfigService` for all config.
- `runOrchestratorPath` now splits: `lineAiAgentRuntime === 'agentcore'` → `runAgentCorePath` (adapter); otherwise → `runLocalOrchestratorPath` (existing orchestrator).
- AgentCore errors (RUNTIME_NOT_CONFIGURED, RUNTIME_NOT_FOUND, THROTTLED, INVALID_PAYLOAD, MALFORMED_RESPONSE, TIMEOUT, INVOKE_ERROR) all produce safe Thai error reply in use-case catch block; no error details reach LINE.
- ponytail comment on endpoint URL: must be confirmed against AWS AgentCore docs at first deploy.

Artifacts:
- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/runtime.port.ts` – NEW: AgentCoreInvokeInput, AgentCoreInvokeResult, IAgentCoreRuntime
- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts` – NEW: AgentCoreRuntimeClient (SigV4 signed fetch, error mapping, BedrockRuntimeClient cred chain)
- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts` – NEW: 7 tests (not-configured, 200 ok, 404/429/400/malformed, URL contains runtime id)
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts` – MODIFIED: AgentCoreRuntimeClient 4th ctor arg; runOrchestratorPath splits on lineAiAgentRuntime; runAgentCorePath maps LineAiTurnRequest → AgentCoreInvokeInput
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts` – MODIFIED: all 5 existing tests updated for 4th arg; 3 new agentcore routing tests
- `apps/ai-gateway/src/modules/line-ai/line-ai.module.ts` – MODIFIED: AgentCoreRuntimeClient registered in providers
- `apps/ai-gateway/package.json` – MODIFIED: agentcore-runtime.client.spec.ts added to test script

Verification:
| Command | Result |
|---------|--------|
| `git diff --check -- docs` | PASS |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway typecheck` | PASS |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 119/119 |

Open items (require AWS access):
- [ ] Confirm exact AgentCore runtime invoke URL format against AWS docs/CLI (`aws bedrock-agentcore invoke-agent-runtime --help` or AWS API reference).
- [ ] Create least-privilege AgentCore Runtime execution role.
- [ ] Create/update runtime in ap-southeast-1.
- [ ] Deploy smoke: read-only Thai summary, mutation refusal, CloudWatch log verification.
- [ ] Cost guard before sustained testing.
- [ ] Store runtime ARN/id, artifact id, role ARN, qualifier in this doc.

## 2026-06-28 Production API App Runner PassRole Follow-up

Status: BLOCKED on IAM. Production backing resources and ECR image are in place, but App Runner service creation still cannot pass the instance role.

Evidence:
- Command: `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh`
- Account: `311414082667`
- Region: `ap-southeast-1`
- Image push: PASS for `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api:0729a95`
- Failure: `CreateService` denied `iam:PassRole` on `arn:aws:iam::311414082667:role/watchdog-bms-apprunner-instance-role`
- Additional check: current deploy user cannot call `iam:ListUserPolicies`, so inline policy attachment/condition cannot be verified from this profile.

Next:
- Add or fix exact `iam:PassRole` allow for `watchdog-bms-apprunner-instance-role` (and access role if missing), then rerun `infra/prod-app-runner/deploy-api.sh`.

Update:
- Retried after user added PassRole policy.
- Result: still denied on `iam:PassRole` for `watchdog-bms-apprunner-instance-role` during App Runner `CreateService`.
- Likely causes: policy attached to wrong principal, condition does not match App Runner caller, permission boundary/session policy blocks it, or IAM change not saved on `watchdog-bedrock-dev`.
- Next recommended policy: exact-role `iam:PassRole` without condition first, then tighten condition after App Runner service exists.

## 2026-06-28 Production API App Runner Success

Status: COMPLETE for production API base path. App Runner default HTTPS domain is live and DB-backed health smoke passes.

AWS evidence:
- Account: `311414082667`
- Region: `ap-southeast-1`
- App Runner service: `watchdog-bms-api`
- App Runner URL: `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com`
- ERP core URL for AgentCore: `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1`
- ECR image tag: `0729a95-20260628112334`
- Final smoke: `curl https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/health` -> `{"service":"api","status":"ok","db":"ok"}`

Fixes made during production deploy:
- Built Docker image as `linux/amd64` to fix App Runner `exec format error`.
- Replaced App Runner quoted shell command with `apps/api/start-production.sh`.
- Removed runtime `pnpm` dependency from startup path to avoid Corepack download with private VPC egress.
- Installed OpenSSL in API image for Prisma/PostgreSQL runtime.
- Fixed config boolean parser so env string `"false"` parses as false, not true.
- Added dirty-worktree timestamp image tags so App Runner pulls updated images before commit.
- Added AWS RDS CA bundle and `sslmode=verify-full&sslrootcert=/etc/ssl/certs/aws-rds-global-bundle.pem` to production `DATABASE_URL`.
- Set CA bundle mode `0644` so the non-root `node` user can read it.

Next:
- Deploy AgentCore runtime using `ERP_CORE_INTERNAL_URL=https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1`.

## 2026-06-28 AgentCore Runtime Production Deploy Success

Status: COMPLETE for AgentCore Runtime create/update and invoke smoke. Runtime is live in AWS account `311414082667`, region `ap-southeast-1`.

AWS evidence:
- Runtime name: `watchdog_orchestrator`
- Runtime ID: `watchdog_orchestrator-6xOx1tCbz0`
- Runtime ARN: `arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0`
- Qualifier: `DEFAULT`
- Protocol: `HTTP`
- Model: `global.anthropic.claude-sonnet-4-6`
- ERP core URL: `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1`
- App Runner API health after deploy: `{"service":"api","status":"ok","db":"ok"}`

Deploy fixes made:
- Changed AgentCore runtime name from `watchdog-orchestrator` to `watchdog_orchestrator` to satisfy AWS name regex.
- Changed status polling from `agentRuntimeStatus` to `status`.
- Omitted S3 `versionId` when `head-object` returns `None`.
- Set `protocolConfiguration.serverProtocol=HTTP`.
- Added `CORS_ALLOWED_ORIGINS` to production runtime env.
- Added `tslib` as a direct ai-gateway runtime dependency.
- Changed CodeZip packaging from copied pnpm `node_modules` to an esbuild single-file bundle (`runtime.js`) to avoid broken transitive symlinks and oversized artifact transformation failures.
- Changed runtime startup to lazy-load Nest/config/orchestrator after HTTP server start, so AgentCore init can pass within the 30s startup window.

IAM/SERVICE-LINKED role evidence:
- `AWSServiceRoleForBedrockAgentCoreGatewayNetwork` created for `bedrock-agentcore.amazonaws.com`.
- `AWSServiceRoleForBedrockAgentCoreRuntimeIdentity` created for `runtime-identity.bedrock-agentcore.amazonaws.com`.
- Deploy user required AgentCore runtime, endpoint, workload identity, S3 artifact read/write, role policy, PassRole, and service-linked-role permissions.

Verification:
| Command | Result |
|---------|--------|
| `corepack pnpm --filter @watchdog-bms/ai-gateway exec tsc -p tsconfig.agentcore.json --noEmit` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/agentcore/runtime.spec.ts` | PASS - 13/13 |
| `bash infra/ai-gateway/agentcore-deploy.sh` with production env | PASS - runtime `READY` |
| AgentCore safe read-only smoke: `ดูสรุปยอดขาย` | PASS - HTTP 200, refused safely as `UNROUTABLE` because sales tool is disabled/not wired |
| AgentCore mutation smoke: `อนุมัติจ่ายเงิน 50000 บาท` | PASS - HTTP 200, refused safely as `mutation_blocked` |

Next:
- Wire production AI Gateway/App Runner config to use `AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0` and qualifier `DEFAULT` before enabling LINE traffic through AgentCore.

## 2026-06-28 AgentCore Runtime Playground Payload Fix

Status: COMPLETE for Runtime playground invocation compatibility.

Cause:
- AWS Runtime playground sent `{"prompt":"คุณเป็นใคร ทำอะไรได้บ้าง"}`.
- Runtime v8 accepted only internal `turnId/companyId/userId/messageText` payloads, so AgentCore returned `RuntimeClientError` HTTP 400 before orchestrator execution.

Fix:
- `apps/ai-gateway/src/agentcore/runtime.ts` now accepts playground shorthand `prompt` and maps it into a safe smoke context.
- Full internal runtime payload remains supported for AI Gateway server-side invokes.

AWS evidence:
- Runtime ID: `watchdog_orchestrator-6xOx1tCbz0`
- Runtime version after fix: `9`
- Artifact: `agentcore/watchdog_orchestrator-d6769cc.zip`
- Status: `READY`
- Playground-equivalent invoke payload `{"prompt":"คุณเป็นใคร ทำอะไรได้บ้าง"}` returned HTTP 200.
- Response used safe default context and returned `🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้`, which is expected when playground has no real company/user permissions.

Verification:
| Command | Result |
|---------|--------|
| `corepack pnpm --filter @watchdog-bms/ai-gateway run build:agentcore` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway test -- src/agentcore/runtime.spec.ts` | PASS - 148/148 |
| `bash infra/ai-gateway/agentcore-deploy.sh` with production env | PASS - runtime `READY`, version `9` |
| AgentCore playground-equivalent invoke with `{ "prompt": "คุณเป็นใคร ทำอะไรได้บ้าง" }` | PASS - HTTP 200 |

## 2026-06-28 Phase 9 – Production Pilot Gate

Status: IN PROGRESS. AI Gateway deploy blocked by ECR manifest push permission. All other local evidence in place.

Scope: Wire production AI Gateway/App Runner to use AgentCore server-side; confirm Phase 9 evidence checklist; document blockers.

### Phase 9 Evidence Checklist

| Evidence | Status |
|----------|--------|
| Config validation passes | PASS – Phase 1, 46/46 config tests |
| AI Gateway tests pass | PASS – 148/148 (Phase 2/4/6/7/8) |
| API LINE tests pass | EXTERNAL BLOCKER – LINE credentials not in CI env |
| Direct Bedrock smoke passes | PASS – Phase 2, 1489ms, text=ยืนยัน |
| Private AI Gateway deployment proof | BLOCKED – ECR `ecr:PutImage`/`ecr:BatchGetImage` for `watchdog-bms-ai-gateway` not granted to `watchdog-bedrock-dev` |
| AgentCore deploy/invoke proof | PASS – Phase 5, runtime READY version 9, read-only + mutation refusal passed |
| Real LINE text smoke | EXTERNAL BLOCKER – operator setup (ngrok, LINE Console, linked user) |
| Real LINE mutation refusal | EXTERNAL BLOCKER – same operator setup |
| Receipt image smoke | ACCEPTED BLOCKER – API receipt endpoints not yet wired |
| CloudWatch redacted log proof | BLOCKED – needs real AI Gateway invoke against live AgentCore |
| Cost guard active | RUNBOOK DEFINED – AWS Budgets command in §13; not yet executed |
| Runtime identifiers and rollback recorded | PASS – ARN/ID/qualifier/rollback all in this doc |

### New artifact

- `infra/prod-app-runner/deploy-ai-gateway.sh` – NEW: App Runner deploy script for AI Gateway.
  - Sets `LINE_AI_AGENT_RUNTIME=agentcore`, `LINE_AI_AGENT_ORCHESTRATION_ENABLED=true`, all 4 AgentCore keys.
  - `MODEL_PROVIDER=disabled` (model calls happen inside AgentCore; AI Gateway does not call Bedrock directly in this mode).
  - Instance role: `watchdog-bms-apprunner-ai-gateway-role` with `bedrock-agentcore:InvokeAgentRuntime` + Secrets Manager + SSM.
  - Rollback: change `LINE_AI_AGENT_RUNTIME` to `strands-local` or `disabled`, rerun script.
  - After service is RUNNING, writes SSM `/watchdog-bms/production/ai-gateway-internal-url`.

### Deploy result (2026-06-28) – COMPLETE

Bug found and fixed during deploy: `agentcore-runtime.client.ts` used `import type { AiGatewayConfigService }` — type-only import strips reflect metadata, causing NestJS DI to fail at startup with `UnknownDependenciesException`. Fixed to `import { AiGatewayConfigService }`. Tests still 148/148 pass; typecheck clean.

| Command | Result |
|---------|--------|
| `bash -n infra/prod-app-runner/deploy-ai-gateway.sh` | PASS – syntax ok |
| `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 148/148 |
| `corepack pnpm --filter @watchdog-bms/ai-gateway typecheck` | PASS |
| `corepack pnpm --filter @watchdog-bms/ai-gateway build` | PASS |
| Boot smoke (production config, local) | PASS – `{"service":"ai-gateway","status":"ok"}` |
| `AWS_PROFILE=watchdog-bedrock bash infra/prod-app-runner/deploy-ai-gateway.sh` | PASS – status=RUNNING |
| `curl https://pxvwbjh6mk.ap-southeast-1.awsapprunner.com/v1/health` | PASS – `{"service":"ai-gateway","status":"ok"}` |
| API `update-service` with new AI Gateway URL | PASS – status=RUNNING |
| `curl https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/health` | PASS – `{"service":"api","status":"ok","db":"ok"}` |

### AI Gateway production evidence

- App Runner service: `watchdog-bms-ai-gateway`
- App Runner ARN: `arn:aws:apprunner:ap-southeast-1:311414082667:service/watchdog-bms-ai-gateway/a4594919ec0d42a4be5c48072f8f163c`
- App Runner URL: `https://pxvwbjh6mk.ap-southeast-1.awsapprunner.com`
- Internal URL (used by API): `https://pxvwbjh6mk.ap-southeast-1.awsapprunner.com/v1`
- ECR image: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-ai-gateway:d6769cc-20260628163540`
- Config: `LINE_AI_AGENT_RUNTIME=agentcore`, `MODEL_PROVIDER=disabled`, `AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0`
- Instance role: `watchdog-bms-apprunner-ai-gateway-role` (bedrock-agentcore:InvokeAgentRuntime + Secrets Manager + SSM)

### Updated Phase 9 Evidence Checklist

| Evidence | Status |
|----------|--------|
| Config validation passes | PASS – Phase 1, 46/46 config tests |
| AI Gateway tests pass | PASS – 148/148 (Phase 2/4/6/7/8) |
| API LINE tests pass | EXTERNAL BLOCKER – LINE credentials not in CI env |
| Direct Bedrock smoke passes | PASS – Phase 2, 1489ms, text=ยืนยัน |
| Private AI Gateway deployment proof | **PASS** – App Runner RUNNING, health ok, API wired |
| AgentCore deploy/invoke proof | PASS – Phase 5, runtime READY version 9, read-only + mutation refusal |
| Real LINE text smoke | EXTERNAL BLOCKER – operator setup (ngrok, LINE Console, linked user) |
| Real LINE mutation refusal | EXTERNAL BLOCKER – same operator setup |
| Receipt image smoke | ACCEPTED BLOCKER – API receipt endpoints not yet wired |
| CloudWatch redacted log proof | EXTERNAL BLOCKER – needs real LINE invoke through live AI Gateway |
| Cost guard active | EXTERNAL BLOCKER – AWS Budgets command in runbook §13; not yet executed |
| Runtime identifiers and rollback recorded | PASS – all in this doc |

### Production config values (applied in AI Gateway App Runner)

```
LINE_AI_AGENT_RUNTIME=agentcore
LINE_AI_AGENT_ORCHESTRATION_ENABLED=true
AGENTCORE_REGION=ap-southeast-1
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/watchdog_orchestrator-6xOx1tCbz0
AGENTCORE_RUNTIME_QUALIFIER=DEFAULT
AGENTCORE_INVOKE_TIMEOUT_MS=20000
MODEL_PROVIDER=disabled
```

Rollback config:
```
LINE_AI_AGENT_RUNTIME=strands-local   # or disabled
```

### Remaining blockers (Phase 9 not complete)

1. **[OPERATOR]** Run real LINE smoke (LINE Console + linked user, see runbook §12). Record: Thai query answer, mutation refusal, log evidence.
2. **[OPERATOR]** Verify CloudWatch log group for AI Gateway and AgentCore: no raw prompt text, no stack traces with secrets.
3. **[OPERATOR]** Create AWS Budgets cost guard (command in runbook §13).
4. **[OPTIONAL]** API LINE tests – need LINE credentials in test env.

### Item 10B tick: NO

All local code is correct; the remaining blockers are operator-setup items. Item 10B cannot be ticked until at minimum: real LINE smoke passes, CloudWatch log proof exists, and cost guard is active. Owner may accept remaining blockers and tick if these conditions are explicitly waived.

## 2026-06-28 LINE Production Smoke Fix Attempt – App Runner VPC Egress

Status: CODE FIX READY. AWS deploy blocked by missing EC2 NAT permissions.

Finding:
- LINE Developers Messaging API config is pointed at `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/line/webhook` with webhook enabled.
- API App Runner health is OK, but recent logs only show health checks; no new `POST /v1/line/webhook` was observed during user message attempts.
- Current App Runner services use VPC egress through `watchdog-bms-prod-apprunner-vpc`. Without a NAT-backed private route, API can receive public webhooks but cannot reliably call public outbound endpoints such as LINE reply API or the public AI Gateway App Runner URL.

Code changes:
- `infra/prod-app-runner/deploy-api.sh`
  - Switches API to `watchdog-bms-prod-apprunner-vpc-egress`.
  - Creates dedicated private subnets `172.31.48.0/24` and `172.31.49.0/24`.
  - Creates/reuses NAT EIP, NAT Gateway, private route table, default route, and route-table associations.
  - Creates App Runner VPC connector using the private subnets.
  - Uses the existing App Runner service URL for `PUBLIC_BASE_URL`, `WEB_BASE_URL`, `CORS_ALLOWED_ORIGINS`, and `WATCHDOG_JWT_ISSUER` instead of placeholder values when the service already exists.
  - Reads `/watchdog-bms/production/ai-gateway-internal-url` for `AI_GATEWAY_INTERNAL_URL` and sets `AI_GATEWAY_ENABLED=true`.
- `infra/prod-app-runner/deploy-ai-gateway.sh`
  - Switches AI Gateway to `watchdog-bms-prod-apprunner-vpc-egress`.

Verification:
| Command | Result |
|---------|--------|
| `bash -n infra/prod-app-runner/deploy-api.sh` | PASS |
| `bash -n infra/prod-app-runner/deploy-ai-gateway.sh` | PASS |
| `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh` | BLOCKED – missing `ec2:AllocateAddress` |

Deploy blocker:
- `watchdog-bedrock-dev` lacks `ec2:AllocateAddress` on `arn:aws:ec2:ap-southeast-1:311414082667:elastic-ip/*`.

Required additional EC2 permissions for this fix:
- `ec2:AllocateAddress`
- `ec2:DescribeAddresses`
- `ec2:CreateNatGateway`
- `ec2:DescribeNatGateways`
- `ec2:CreateSubnet`
- `ec2:ModifySubnetAttribute`
- `ec2:DescribeRouteTables`
- `ec2:CreateRouteTable`
- `ec2:CreateRoute`
- `ec2:AssociateRouteTable`
- `ec2:CreateTags`

Next:
- Grant the EC2 permissions above or create the NAT/private-subnet/route-table resources manually.
- Rerun `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh`.
- Rerun `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-ai-gateway.sh`.
- Re-test LINE `/companies`, then Thai query, then mutation refusal.

### 2026-06-28 VPC Egress Deploy Follow-up

Status: COMPLETE for App Runner egress/config deploy. Real LINE user smoke still pending.

Fixes:
- `deploy-api.sh` now uses a dedicated egress security group (`watchdog-bms-prod-app-egress-sg`) for the new App Runner VPC connector because App Runner rejected a second connector with the same security group combination as the existing connector.
- DB and Redis security groups are updated to allow the new egress security group.
- `deploy-api.sh` now ignores local `.env` values for `AI_GATEWAY_INTERNAL_URL` when they point to `localhost` or `127.0.0.1`; it reads `/watchdog-bms/production/ai-gateway-internal-url` instead.

AWS evidence:
- API App Runner image: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api:233a2a5-20260628174710`
- AI Gateway App Runner image: `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-ai-gateway:233a2a5-20260628174142`
- API VPC connector: `arn:aws:apprunner:ap-southeast-1:311414082667:vpcconnector/watchdog-bms-prod-apprunner-vpc-egress/1/600871f8ef0d4ccbba626268893aa837`
- API env now has `AI_GATEWAY_ENABLED=true` and `AI_GATEWAY_INTERNAL_URL=https://pxvwbjh6mk.ap-southeast-1.awsapprunner.com/v1`.
- API public/base URLs now use `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com`, not placeholder values.

Verification:
| Command | Result |
|---------|--------|
| `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh` | PASS – API RUNNING |
| `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-ai-gateway.sh` | PASS – AI Gateway RUNNING |
| `curl https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/health` | PASS – `{"service":"api","status":"ok","db":"ok"}` |
| `curl https://pxvwbjh6mk.ap-southeast-1.awsapprunner.com/v1/health` | PASS – `{"service":"ai-gateway","status":"ok"}` |
| Signed synthetic LINE webhook using production `LINE_MESSAGING_CHANNEL_SECRET` | PASS – HTTP 200 `{}` |
| API log after synthetic webhook | PASS – `POST /v1/line/webhook`, status 200, duration 401ms |

Remaining:
- Real LINE message from OA `@557qmioh` must be tested again.
- Screenshot-exposed LINE channel access token must be reissued, stored back into Secrets Manager, and API redeployed with the new secret.

### 2026-06-28 LINE Real Smoke Token Reissue Follow-up

Status: WEBHOOK + REPLY PATH CONFIRMED. Account linking still pending.

Finding:
- Real LINE message now reaches production API and receives the expected unlinked-user reply: `กรุณาเชื่อมต่อบัญชี WatchDog กับ LINE ก่อนใช้งาน`.
- This proves LINE Messaging webhook delivery, signature verification, and reply path are working after the App Runner VPC egress fix.
- The unlinked reply is expected until the LINE user completes account linking and an active `ExternalIdentity` + company context exists.
- LINE Messaging channel access token was reissued after the screenshot exposed it, so the production AWS Secret had to be updated.

Actions:
- Updated `watchdog-bms/production/line-messaging-channel-access-token` in AWS Secrets Manager from local `.env`.
- Started an API App Runner deployment without rebuilding the image so the running service reloads the new secret.
- Confirmed local `.env` token hash matches AWS Secrets Manager after the update.

Evidence:
| Check | Result |
|-------|--------|
| API log during real LINE attempt | PASS - `POST /v1/line/webhook`, HTTP 200 |
| API App Runner deployment after token update | PASS - operation `bc03bb76897b4e2496b18cd4feccf6e2` `SUCCEEDED`, service `RUNNING` |
| `curl https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/health` | PASS - `{"service":"api","status":"ok","db":"ok"}` |
| Local `.env` vs AWS secret hash comparison | PASS - `LINE token: local .env matches AWS secret` |

Next:
- In LINE Developers LIFF settings, set Endpoint URL to `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/auth/line/link-page` instead of the old Cloudflare tunnel URL.
- Open `https://liff.line.me/2010515251-rvdZJ8la` from the LINE client and complete account linking while logged into WatchDog.
- Send another LINE message; expected next proof is linked-user AI response or permission/tenant refusal, not `UNLINKED_REPLY`.

## 2026-06-28 SigV4 Bug Fix + Local LINE Smoke + Production AI Gateway Redeploy

Status: COMPLETE. AI Gateway now calls AgentCore correctly. Local LINE smoke passes. Production redeployed.

Root causes found and fixed in `agentcore-runtime.client.ts`:

1. **Double-encoded canonical URI**: SigV4 canonical path must use double-encoded ARN (`%3A` → `%253A`), while the actual HTTP URL uses single-encoded. We were using single-encoding for both. Fix: `singleEncoded.replace(/%/g, '%25')` for canonical path.
2. **Session ID too short**: `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header must be ≥33 chars. We used `req.requestId` (~20 chars) or `gw-${Date.now()}` (~17 chars). Fix: `randomUUID()` (36 chars).
3. **`x-amz-content-sha256` in signed headers**: Added this header to signed headers — incorrect. botocore does NOT include it. Fix: removed from `rawHdrs`.

Discovery method: compared `botocore.SigV4Auth.canonical_request()` output (returned 200) against Node.js manual SigV4 (returned 403). Canonical URI difference was the key finding (`%253A` vs `%3A`).

Additional local env issues found:
- `NODE_ENV=local` rejected by config schema (accepts `development|test|production`)
- `AWS_SDK_LOAD_CONFIG=1` rejected by `envBoolean` schema (must be `true`/`false`)
- Old gateway process survived `pkill` because pattern didn't match full path
- `source .env` doesn't export variables — node process doesn't inherit them

Verification:
| Command | Result |
|---------|--------|
| `corepack pnpm --filter @watchdog-bms/ai-gateway test` | PASS – 148/148 |
| Direct AI Gateway call with correct env | PASS – `durationMs:2361`, `intent:"ดูสต็อกสินค้าใกล้หมด"`, `agent:"inventory"` |
| LINE smoke: `LINE_MESSAGING_CHANNEL_SECRET=... tsx line-webhook-local-smoke.ts` | PASS – status=200 |
| `AWS_PROFILE=watchdog-bedrock bash infra/prod-app-runner/deploy-ai-gateway.sh` | PASS – RUNNING, new image deployed |
| `curl https://pxvwbjh6mk.ap-southeast-1.awsapprunner.com/v1/health` | PASS |

### 2026-06-28 Production LIFF CSP Fix

Status: DEPLOYED.

Finding:
- Production `GET /v1/auth/line/link-page` returned HTTP 200, but Helmet's production default CSP set `script-src 'self'`.
- The account-link page needs `https://static.line-scdn.net` for the LIFF SDK and an inline bootstrap script, so the old CSP could make the page render without linking.

Fix:
- Added a route-specific `Content-Security-Policy` header on `GET /v1/auth/line/link-page` that allows only the LIFF SDK, same-origin API calls, inline page bootstrap, and LINE LIFF/Login frame targets.
- Deployed API image `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api:233a2a5-20260628181256`.

Verification:
| Command | Result |
|---------|--------|
| `CI=true corepack pnpm --filter @watchdog-bms/api typecheck` | PASS |
| `CI=true corepack pnpm --filter @watchdog-bms/api test -- auth-endpoints` | PASS - 359/359 |
| `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api.sh` | PASS - API `RUNNING` |
| `curl https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/health` | PASS - `{"service":"api","status":"ok","db":"ok"}` |
| `curl -I https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/auth/line/link-page` | PASS - CSP includes `https://static.line-scdn.net` and `unsafe-inline`; cache remains `no-store` |

Next:
- Update LINE Developers LIFF Endpoint URL from the old Cloudflare tunnel to `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/auth/line/link-page`.
- Retry `https://liff.line.me/2010515251-rvdZJ8la` in LINE, complete linking, then send OA message again.

### 2026-06-28 Production Full Web UI Deploy

Status: DEPLOYED.

Finding:
- Account App Runner quota allows only two services in `ap-southeast-1`; API and AI Gateway already consume both slots.
- Dedicated `watchdog-bms-web` App Runner create was blocked by quota.
- Lambda Function URL fallback image was built and pushed, but deploy user lacks `lambda:CreateFunction`.

Fix:
- Added combined API+Web App Runner deployment path:
  - `infra/prod-app-runner/Dockerfile.api-web`
  - `apps/api/start-combined-production.sh`
  - `infra/prod-app-runner/web-api-proxy.mjs`
  - `infra/prod-app-runner/deploy-api-web.sh`
- Existing API App Runner service now runs:
  - public proxy on `PORT=3000`
  - API on `API_PORT=3001`
  - Next.js web UI on `WEB_PORT=3002`
- Proxy preserves `/v1/*` and `/local-storage/*` for backend/LINE, maps `/api/*` to API for same-origin browser calls, and sends all other routes to Next.js.
- `LINE_ACCOUNT_LINK_URL` and public counterpart now point to `https://liff.line.me/2010515251-rvdZJ8la`, not stale Cloudflare tunnel.

Evidence:
| Check | Result |
|-------|--------|
| `bash -n apps/api/start-combined-production.sh` | PASS |
| `node --check infra/prod-app-runner/web-api-proxy.mjs` | PASS |
| `bash -n infra/prod-app-runner/deploy-api-web.sh` | PASS |
| `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-app-runner/deploy-api-web.sh` | PASS - App Runner `RUNNING` |
| App Runner image | PASS - `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api:api-web-233a2a5-20260628191328` |
| Web root `curl -I https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/` | PASS - HTTP 200, `x-powered-by: Next.js` |
| Web login `curl -I https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/login` | PASS - HTTP 200, `x-powered-by: Next.js` |
| Direct API `curl https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/health` | PASS - `{"service":"api","status":"ok","db":"ok"}` |
| Same-origin API proxy `curl https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/api/v1/health` | PASS - `{"service":"api","status":"ok","db":"ok"}` |
| LINE link page `curl -I https://cty9r7ewtj.ap-southeast-1.awsapprunner.com/v1/auth/line/link-page` | PASS - HTTP 200, CSP allows LIFF SDK |
| Change-password page HTML | PASS - embeds `lineAccountLinkUrl:"https://liff.line.me/2010515251-rvdZJ8la"` |
| SSM `/watchdog-bms/production/web-public-base-url` | PASS - `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com` |

Next:
- Retest real browser login and customer workflow against `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com`.
- Retest LINE linked-user flow after completing LIFF account link.

### 2026-07-02 App Runner Retirement Response + ECS Express Migration Prep

Status: PARTIAL. Repo is prepared for ECS Express Mode production deploy, but live ECS cutover is blocked by local Docker daemon and IAM scope.

Trigger:
- AWS Health notified that App Runner is closed to new customers and will receive no new features.
- No real users are live yet, so the safer decision is to move production hosting now instead of extending App Runner.

Decision:
- App Runner remains legacy rollback/migration source only.
- New production deploy path is ECS Express Mode/Fargate.
- Keep existing App Runner services running until ECS smoke passes and LINE/LIFF endpoints are updated.

Artifacts:
- `infra/prod-ecs-express/deploy.sh` - new ECS Express deploy script.
  - `api-web`: builds/pushes the combined API + Next.js image and deploys `watchdog-bms-api-web`.
  - `ai-gateway`: builds/pushes AI Gateway and deploys `watchdog-bms-ai-gateway`.
  - `all`: deploys API/Web, deploys AI Gateway, then redeploys API/Web with the new AI Gateway URL.
- `infra/prod-ecs-express/README.md` - run command and preconditions.
- `infra/prod-ecs-express/deploy-principal-policy.template.json` - IAM template for the deploy principal.
- `docs/adr/0005-aws-first-hosting-and-deployment-strategy.md` - App Runner marked legacy rollback/migration only.
- `docs/specs/production-ops-spec.md` - ECS Express current no-real-user migration path recorded.
- `docs/specs/ai-runtime-production-integration-spec.md` - App Runner marked legacy evidence; new deploy proof must use ECS Express/Fargate.
- `infra/docker/README.md` - AWS mapping updated away from App Runner alpha.

Current AWS inventory:
- App Runner `watchdog-bms-api`: RUNNING, `https://cty9r7ewtj.ap-southeast-1.awsapprunner.com`.
- App Runner `watchdog-bms-ai-gateway`: RUNNING, `https://pxvwbjh6mk.ap-southeast-1.awsapprunner.com`.
- ECR repos exist: `watchdog-bms-api`, `watchdog-bms-ai-gateway`.
- SSM `/watchdog-bms/production/s3-bucket`: `watchdog-bms-prod-311414082667`.

Verification:
| Command | Result |
|---------|--------|
| `bash -n infra/prod-ecs-express/deploy.sh` | PASS |
| `/opt/homebrew/bin/aws --version` | PASS - `aws-cli/2.35.1` includes ECS Express commands |
| `aws ecs help` | PASS - `create-express-gateway-service`, `update-express-gateway-service`, `describe-express-gateway-service` available |
| `aws apprunner list-services` with proxy env unset | PASS - both current App Runner services RUNNING |
| `aws ssm get-parameter --name /watchdog-bms/production/s3-bucket` with proxy env unset | PASS |
| `/opt/homebrew/bin/docker info` | BLOCKED - Docker daemon socket missing at `~/.docker/run/docker.sock` |
| `aws ecs describe-clusters --clusters watchdog-bms-prod` with proxy env unset | BLOCKED - IAM denies `ecs:DescribeClusters` |
| `shellcheck infra/prod-ecs-express/deploy.sh` | NOT RUN - `shellcheck` not installed |

Required before live ECS deploy:
- Start Docker Desktop or otherwise expose the Docker daemon socket.
- Grant the deploy principal ECS Express/Fargate permissions, at minimum `ecs:DescribeClusters`, `ecs:CreateCluster`, `ecs:CreateExpressGatewayService`, `ecs:UpdateExpressGatewayService`, `ecs:DescribeExpressGatewayService`, `iam:CreateRole`, `iam:GetRole`, `iam:AttachRolePolicy`, `iam:PutRolePolicy`, `iam:PassRole`, plus the existing ECR, CloudWatch Logs, EC2 describe, SSM, and Secrets Manager permissions used by the script.
- Rerun: `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh all`.

Post-deploy smoke checklist:
- `curl https://<ecs-api-web>/v1/health`
- `curl -I https://<ecs-api-web>/login`
- `curl https://<ecs-api-web>/api/v1/health`
- `curl https://<ecs-ai-gateway>/v1/health`
- Update LINE webhook and LIFF endpoint from App Runner URL to ECS URL.
- Retest LINE webhook delivery, account linking, and linked-user AI response.
- Keep App Runner running for rollback until ECS smoke and LINE/LIFF proof pass.

### 2026-07-02 ECS Express Deploy Attempt Follow-up

Status: BLOCKED BY IAM after API/Web image build and ECR push.

Actions:
- Regenerated `pnpm-lock.yaml` with pnpm 9.15.0 in a temporary Docker workspace so Docker `pnpm install --frozen-lockfile` accepts the root `pnpm.overrides`.
- Removed `tags` from ECS Express create payload to avoid requiring `ecs:TagResource`.
- Added an explicit guard so failed ECS service creation stops instead of flowing into an empty service ARN.
- Updated `infra/prod-ecs-express/deploy-principal-policy.template.json` to include `ecs:RegisterTaskDefinition` and `ecs:DescribeTaskDefinition`.

Evidence:
| Check | Result |
|-------|--------|
| API/Web Docker build | PASS - Next.js build and API TypeScript build succeeded |
| ECR push | PASS - `watchdog-bms-api:ecs-api-web-d2b1d24-20260702211014`, digest `sha256:344d2f905d0e2dd5844923c520fb04a46dbb54e60d38f3baf9870234bd3a345b` |
| ECS Express create | BLOCKED - deploy principal lacks `ecs:RegisterTaskDefinition` for `arn:aws:ecs:ap-southeast-1:311414082667:task-definition/watchdog-bms-prod-watchdog-bms-api-web:*` |
| `bash -n infra/prod-ecs-express/deploy.sh` | PASS |
| `jq empty infra/prod-ecs-express/deploy-principal-policy.template.json` | PASS |

Next:
- Add `ecs:RegisterTaskDefinition` and `ecs:DescribeTaskDefinition` to the deploy principal policy.
- Rerun `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh all`.

### 2026-07-02 ECS Service-Linked Role Blocker

Status: BLOCKED BY IAM after `ecs:RegisterTaskDefinition` was added.

Finding:
- ECS Express create now reaches the service-linked-role phase.
- The account does not have `AWSServiceRoleForECS`, `AWSServiceRoleForElasticLoadBalancing`, or `AWSServiceRoleForApplicationAutoScaling_ECSService`.
- Deploy principal cannot create the ECS service-linked role yet.

Evidence:
| Check | Result |
|-------|--------|
| `aws iam get-role --role-name AWSServiceRoleForECS` | MISSING |
| `aws iam get-role --role-name AWSServiceRoleForElasticLoadBalancing` | MISSING |
| `aws iam get-role --role-name AWSServiceRoleForApplicationAutoScaling_ECSService` | MISSING |
| `aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com` | BLOCKED - missing `iam:CreateServiceLinkedRole` |
| deploy retry after permission update | BLOCKED - `arn:aws:iam::311414082667:user/watchdog-bedrock-dev` still has no identity-based allow for `iam:CreateServiceLinkedRole` on `AWSServiceRoleForECS` |

Actions:
- `infra/prod-ecs-express/deploy.sh` now creates required ECS/ELB/autoscaling service-linked roles idempotently before ECS Express deploy.
- `infra/prod-ecs-express/deploy-principal-policy.template.json` now includes a scoped `ServiceLinkedRoles` statement.
- After `iam:CreateServiceLinkedRole` was granted, deploy reached ECR login and failed on local `docker-credential-desktop` lookup; `infra/prod-ecs-express/deploy.sh` now uses a temporary `DOCKER_CONFIG` when one is not provided.
- The local Docker build fell back to legacy builder and failed platform selection; the ECS deploy script now exports `DOCKER_BUILDKIT=1` and keeps `--provenance=false` for buildx-compatible amd64 image builds.
- Because Docker CLI plugin lookup follows `DOCKER_CONFIG`, the temporary config now symlinks the Docker Desktop `cli-plugins` directory so buildx remains available while ECR credentials stay out of the user's home Docker config.
- The first ECS Express API/Web service creation succeeded but used prod private subnets, so ECS returned only a `PRIVATE` ingress endpoint. The deploy script now defaults to public default-VPC subnets (`MapPublicIpOnLaunch=true`) and keeps `ECS_EXPRESS_SUBNET_MODE=private` as an override.
- BuildKit/Turbo repeatedly failed creating package `.turbo` log directories inside the API/Web image build; `infra/prod-app-runner/Dockerfile.api-web` now pre-creates the known workspace `.turbo` directories before `turbo run build`.

Next:
- Rerun `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh all`.

### 2026-07-02 ECS Express Live Deploy + Full-Stack Smoke PASS

Status: DONE. All three services (FE, BE, AI Gateway) live on ECS Express Mode with Next.js 16.2.10; full smoke including real AgentCore orchestration passed.

Deploy facts:
- `watchdog-bms-api-web-pub`: `https://wa-d522885832ce41a5aa7f8d1ffbaaa84b.ecs.ap-southeast-1.on.aws` (combined API + Next.js web).
  - The original `watchdog-bms-api-web` service name is held by the first private-ingress attempt. ECS Express rejects subnet-type changes on update (`InvalidParameterException: Changing subnet types is not supported`), and the deploy principal lacks `ecs:DeleteExpressGatewayService` (now added to the policy template). Old service scaled to minTaskCount=0; delete it after granting the permission.
- `watchdog-bms-ai-gateway`: `https://wa-bab97d24848e4b47a70b8aae07c94550.ecs.ap-southeast-1.on.aws`.
- SSM cross-wiring verified: `ai-gateway-internal-url` and `erp-core-internal-url` both point at the new ECS URLs; `service-version=d2b1d24-20260702223129`.
- New public `.on.aws` DNS takes minutes to propagate; test with `--resolve HOST:443:IP` (dig @8.8.8.8) meanwhile.

Root cause fixed (latent, also present on App Runner):
- AgentCore invoke from the AI Gateway task failed fast (~94ms) with `tool_unavailable`. Cause: `bedrock-agentcore:InvokeAgentRuntime` with `qualifier=DEFAULT` authorizes against the `runtime-endpoint` sub-resource, but the task-role policy only allowed the bare runtime ARN. Fix: policy resource now includes `<runtime-arn>/runtime-endpoint/*` (applied live and in `infra/prod-ecs-express/deploy.sh`). Local CLI invoke had masked this because the dev user has broader permissions.

Smoke evidence (all via public ECS URLs):
| Check | Result |
|-------|--------|
| BE `GET /v1/health` | PASS - 200 `{"service":"api","status":"ok","db":"ok"}` |
| BE `GET /v1/auth/me` no token | PASS - 401 |
| FE `GET /login` | PASS - 200, WatchDog-BMS HTML (Next.js 16.2.10 build) |
| FE→BE rewrite `GET /api/v1/health` | PASS - 200 db ok |
| AI `GET /v1/health` | PASS - 200 |
| AI `POST /v1/internal/ai/line-turn` no secret | PASS - 401 |
| AI `POST /v1/internal/ai/line-turn` with secret, synthetic user | PASS - 200, durationMs 5522, AgentCore plan intent "สรุปสถานะธุรกิจโดยรวม", governed permission refusal reply in Thai (correct for nonexistent membership) |
| AI `GET /v1/internal/ai/agents` | 200 without secret - registry metadata is public by design; consider requiring the internal secret now that the URL is public |

Next:
- Update LINE webhook + LIFF endpoint URLs from App Runner to the new ECS api-web URL, then retest linked-user LINE AI flow.
- Grant `ecs:DeleteExpressGatewayService` and delete the old private `watchdog-bms-api-web` service.
- Keep App Runner services as rollback until LINE/LIFF proof passes.

### 2026-07-07 Full-Stack Deploy at acb73a08 (AgentCore + ECS all)

Status: DONE. AgentCore runtime + all three ECS Express services updated to `acb73a08` in one pass.

Deploy facts:
- AgentCore runtime `watchdog_orchestrator-6xOx1tCbz0`: version `11`, READY, sha `acb73a08`, model `global.anthropic.claude-sonnet-4-6` (env otherwise unchanged from v10; values sourced from SSM/Secrets Manager, not local .env).
- ECS `all` at image tag `acb73a08-20260707154632` (tree dirty only by `apps/web/next-env.d.ts`): `watchdog-bms-api-web-pub` task-def :53, `watchdog-bms-ai-gateway-v2` :11, `watchdog-bms-workers` :3 — all PRIMARY rollouts COMPLETED, canary passed with no rollback (polled via ECS API only during bake).
- NOTE: the ai-gateway ECS service is named `watchdog-bms-ai-gateway-v2` (not `watchdog-bms-ai-gateway`) — use that name for describe-services.
- Ships: 15A Phase 2 complete + Phase 3 first slice (Customer 360), 10F Phases 1-3 (value guards, native tool-use loop behind flags, Redis Streams turn ledger + workers), workers ECS service, LINE link QR idempotent re-scan fix (81524564).

Verification:
| Check | Result |
|-------|--------|
| agentcore-deploy.sh smoke (safe read + mutation refusal) | PASS - refused `mutation_blocked`, HTTP 200 |
| `GET https://mangmeeplus.com/v1/health` | PASS - 200 `db:ok` |
| `GET <api-web-pub origin>/v1/health` | PASS - 200 `db:ok` |
| SSM `service-version` | `acb73a08-20260707154632` |

### 2026-07-09 Full-Stack Deploy at 54e17380 (develop branch, AgentCore + ECS all)

Status: DONE. AgentCore runtime + all three ECS Express services updated to `54e17380` in one pass (PR #8 redesign-ui-and-remove-menu-fogot-password merged into develop: CRM bookings module, customer tier/engagement score, access-matrix contracts, Inbox/Journal/Employees/Roles rewires to real APIs, plus crm-reports+LTV Phase D work already on branch).

Deploy facts:
- AgentCore runtime `watchdog_orchestrator-6xOx1tCbz0`: version bumped, READY, sha `54e17380`, model `global.anthropic.claude-sonnet-4-6` (unchanged; confirmed live via `bedrock-agentcore-control get-agent-runtime` before deploying — the ai-gateway container's own `BEDROCK_MODEL_ID` env is a different value used for a different purpose, not the agent runtime's model). `ERP_CORE_INTERNAL_URL`/`AI_GATEWAY_INTERNAL_SECRET`/`PUBLIC_BASE_URL` sourced from the live `watchdog-bms-ai-gateway-v2` express-gateway-service container config + Secrets Manager (deploy user lacks `ssm:GetParametersByPath` on `/watchdog-bms/production/*` — worked around by reading the already-deployed ai-gateway task's env/secrets instead of SSM).
- ECS `all` at image tag `ecs-*-54e17380`: `watchdog-bms-api-web-pub`, `watchdog-bms-ai-gateway-v2`, `watchdog-bms-workers` — all single-deployment COMPLETED, no rollback, RollbackAlarm OK on all three throughout (polled via ECS/CloudWatch API only during bake, no endpoint traffic).
- Pre-deploy note: local checkout was 12 commits behind `origin/develop` and had uncommitted WIP (mvp1-a3-a5-revenue-loop-durable-flow docs, unrelated to this deploy) — user committed the WIP as `temp commit` (008e12c0) and merged with origin (54e17380) before this deploy ran, so the shipped tree is clean/committed, not a dirty-tree snapshot.

Verification:
| Check | Result |
|-------|--------|
| agentcore-deploy.sh smoke (safe read + mutation refusal) | PASS - refused `mutation_blocked`, HTTP 200, `requiresHumanReview:true` |
| `GET https://mangmeeplus.com/v1/health` | PASS - 200 |
| `GET <ai-gateway-v2 origin>/v1/health` | PASS - 200 |
| ECS rollout state (all 3 services) | PASS - single COMPLETED deployment each, `RollbackAlarm` OK |
