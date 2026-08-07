# Agent Memory: production required keys vs live config, and the M-09 deny-all sentinel

Status: Code, tests, and deploy templates complete and verified locally. One live blocker
remains (`CLAMAV_HOST`) which needs infrastructure that does not exist yet, plus the M-05
approval reference. Not committed, not deployed.
Owner: This task. The underlying M-09/M-14 rules belong to Codex `/root`
(`p1-security-remediation-m04-m18.md`); the environment wiring belongs to the same owner's
`env-example-sync-local-uat-production.md`, whose recorded "Next" this closes in part.
Scope:
- Verify the live production task definition and secrets against the production required set
  that M-09/M-14 added to `validateProductionConfig`.
- Resolve the contradiction where empty `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` is documented as
  deny-all but refused in production.

Decisions:
- Keep the non-empty production requirement. Its real purpose is to distinguish "deliberately
  deny-all" from "the key was dropped from the task definition", which the old check could not
  tell apart. Accepting empty would have reversed the owner's rule and made a lost key silently
  become deny-all.
- Add reserved value `none` (`WEBHOOK_ALLOWLIST_DENY_ALL`) meaning "deny every outbound
  webhook". It satisfies the non-empty check and resolves to the empty allowlist, which already
  denies every host. Parsing lives in `packages/config` so the validator, the API accessor, and
  the tests share one definition.
- Only the whole value is the sentinel. `none,real.host` leaves `none` as an ordinary,
  unmatchable entry rather than silently disabling the real host.
- The GitHub Actions `preserve` helper gained an optional fallback argument, applied only when
  neither the repository variable nor the live service states a value. A real allowlist already
  on the live service is never overwritten by the default.
- `CLAMAV_HOST` deliberately gets NO default. Attachment scanning fails closed
  (`CLAMAV_NOT_CONFIGURED`), so a placeholder host would break uploads while looking configured.
  This preserves the owner's decision that scanner destinations are environment-owned.

Open questions:
- Who provisions the ClamAV service? No malware scanner exists in the `watchdog-bms-prod`
  cluster (only `api-web-pub`, `ai-gateway-v2`, `workers`), so M-14's live closure needs
  infrastructure, not just a config value.
- `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` is a hard production deploy gate
  (`deploy.sh:120`) and is unset; it needs a real DPO approval reference (M-05).

Artifacts:
- `packages/config/src/index.ts` — `WEBHOOK_ALLOWLIST_DENY_ALL`, `parseWebhookAllowedHosts`
- `apps/api/src/common/config/app-config.service.ts` — accessor uses the shared parser
- `packages/config/src/index.test.ts`, `scripts/validate-prod-config.ts` — sentinel accepted,
  unset still rejected
- `apps/api/src/modules/workflow/domain/logic/workflow-webhook-security.logic.spec.ts` — proves
  the empty allowlist the sentinel resolves to denies every host
- `.env.example`, `infra/prod-ecs-express/deploy.sh`,
  `.github/workflows/deploy-{production,uat}.yml`
- `docs/specs/p1-security-remediation-m04-m18-spec.md` (M-09 section),
  `docs/security-remediation-checklist-merged-2026-07-17.md` (M-09 entry)

Verification:
- Live production API task definition carries NEITHER `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` NOR
  `CLAMAV_HOST`, and no GitHub `production` environment variable supplies them. Boot simulation
  against the live task definition (schema parse + `validateProductionConfig`) reported three
  blockers: `AI_ACTOR_DELEGATION_SIGNING_KEY`, `WORKFLOW_WEBHOOK_ALLOWED_HOSTS`, `CLAMAV_HOST`.
- `AI_ACTOR_DELEGATION_SIGNING_KEY` self-resolves: the secret exists
  (`watchdog-bms/production/ai-actor-delegation-signing-key`) and `deploy.sh:855` already
  renders it. The live task definition simply predates that change (`GIT_SHA=6d66bdc76299`).
- Staged simulation: live → +delegation key → +sentinel → +real `CLAMAV_HOST` = BOOTS.
  `CLAMAV_HOST` is the single remaining boot blocker.
- Both deploy paths fail BEFORE mutating production, not after: `deploy.sh` preflight exits 2,
  and the workflow's preserve step exits 1 ahead of build/deploy. No canary rollback is involved
  — the deploy is blocked, and production is never touched.
- `packages/config` 99/99 (includes the three new sentinel tests); API full suite 2,690/2,690;
  webhook SSRF spec 4/4; extracted `preserve()` fallback matrix 6/6, covering the no-clobber and
  no-invented-host cases; `bash -n` on `deploy.sh`; both workflows parse as YAML; API and config
  typecheck clean.

Production is intentionally scaled to zero (2026-07-28):
- All three prod services sit at desiredCount 0 by owner decision, to save cost — NOT an
  incident. `scalingTarget.minTaskCount` is 0 on all three, and the 13:09→13:18
  `UpdateExpressGatewayService` converged cleanly to zero with no failed-task events. A 503 from
  the public URL is expected in this state. Do not diagnose it as a crash loop or a boot failure.
- Scaling the existing configuration back up is safe regardless of the key gaps below: the
  deployed build `6d66bdc7` (2026-07-19) predates the P1/P2 hardening commit `23c61c08`, and its
  validator contains no occurrence of the new required-key rule. The boot-fail risk is strictly a
  NEW-deploy risk. Live verification goes to UAT while prod is down.

Wider blockers found while verifying (other lanes, NOT touched here):
- The live production services predate the whole P1/P2 security release
  (`GIT_SHA=6d66bdc76299`) and no GitHub Environment variables were ever populated, so the
  required set is unmet well beyond M-09/M-14.
- AI Gateway boot simulated against its live config is blocked by seven rules:
  `WATCHDOG_JWT_SECRET_ARN`, `WATCHDOG_JWT_ISSUER`, `WATCHDOG_JWT_AUDIENCE` (L-04); configured
  model not approved, `global.` Bedrock profile refused, `DOCUMENT_AI_MODEL_ID` not approved
  (M-05, live uses `global.anthropic.claude-haiku-4-5` and `global.anthropic.claude-sonnet-4-6`);
  and `TYPHOON_PROCESSING_REGION` required when Typhoon OCR is enabled.
- `ai_container_json()` in `deploy.sh` renders no `WATCHDOG_JWT_*` at all, so even a successful
  deploy would produce an AI Gateway that cannot boot under L-04. Needs the L-04 owner to decide
  whether the gateway receives the JWT secret ARN and iss/aud.
- The production workflow's `preserve` calls for `APPROVED_AI_PROVIDERS`, `APPROVED_AI_MODEL_IDS`,
  `APPROVED_AI_REGIONS`, `MODEL_PROVIDER` are `required=true` but those keys are absent from the
  live AI service and unset as variables, so the workflow fails at the preserve step.
- `deploy.sh` additionally hard-requires `LOG_KMS_KEY_ID` and `SECURITY_ALERT_TOPIC_ARN` for
  production; neither is set as a variable.

Failures in `scripts/validate-prod-config.ts`, NOT caused by this change:
- `pnpm config:validate` is red on `develop` at 28/31, from two unrelated causes. Its
  `validProd` fixture now trips the tightened `isLowEntropySecret` (`WATCHDOG_JWT_SECRET_ARN has
  too little entropy`) — the L-01–L-15 owner was editing that rule in the shared tree during
  this task, so the fixture is mid-change and was left alone. The third failure, "accepts a valid
  production AI Gateway fixture", is the separate L-04 gap: the `validAiGateway` fixture was
  never updated when iss/aud became required for every JWT-verifying process.
- The one new failing check here, "accepts the deny-all webhook sentinel in production", fails
  only because it spreads `...validProd` and inherits that entropy failure. The equivalent
  assertions in `packages/config/src/index.test.ts` pass, and the sentinel logic is green there.
  It will go green once the fixture's placeholder ARN is refreshed.

Next:
- Release owner: provision the ClamAV service, then set `CLAMAV_HOST` (GitHub `production`
  environment variable, or on the live service) — deploys stay blocked until then.
- Release owner: set `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` with the real approval evidence.
- If any tenant does use outbound webhooks, set a real `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` instead
  of letting the `none` default apply.
