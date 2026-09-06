# Agent Memory: scheduled-uat-prod-release-2026-09-07

Status: PREPARING CONFIG ACTIVATION — one-time 01:30 heartbeat remains ACTIVE; owner explicitly requested code/script changes, testing, push and merge into develop/main before deployment. No deployment has started.
Owner: thawatchai / GitHub MangmeeDev
Scope: One release, starting 2026-09-07 01:30 Asia/Bangkok (2026-09-06T18:30:00Z): UAT all → signed Passport → Production READY → Production → customer acceptance. Include the current reviewed AI intelligence, auto-register and bug-fix release; audit and reconcile effective configuration across environments.
Decisions: The user explicitly authorized both deployments and adding missing environment values. Do not ask for deployment/env permission again. Preserve environment-specific credentials/resources and existing safety/tenant boundaries. The authorization does not invent missing external values or legal evidence.
Open questions: Resolve candidate/merged PR and legal/live evidence from current repository/provider state before dispatch; these are checks, not a request for more deployment permission.
Artifacts: This ledger; automation `deploy-uat-production-7-01-30` in the same task. Add a secret-safe config comparison and release evidence here or under an associated evidence path.
Verification: AWS profile thawatchai login refreshed and STS account 311414082667/root verified; watchdog-bedrock STS verified IAM user watchdog-bedrock-dev. GitHub CLI authenticated as MangmeeDev. Mandatory runbooks read during preparation. Automation create succeeded; view rendered the saved card; saved configuration readback verified heartbeat, ACTIVE, same task, count one and local 01:30. No release acceptance claimed.
Next: At the scheduled wakeup reread this ledger and mandatory runbooks, refresh source/provider state, fix proven config gaps, and execute the single release end-to-end.

## Timing and user authorization

- User request in this task on 2026-09-06: wait until **01:30 on 7 September 2026**, deploy UAT, then deploy Production; check all UAT/Production config because previous differences disabled/degraded AI; this release includes smarter AI, auto register and many bug fixes; missing env values may be added without another approval.
- Start no deployment or live configuration mutation before the target time. Read-only preparation and recording this plan are allowed.
- This is a one-off deployment, not a daily release. Prevent repeated future dispatches. On a duplicate wakeup, resume the recorded run or report its terminal result; never create another release simply because the scheduler ran again.
- Keep the local machine on and the desktop app running so the scheduled task can access this checkout.

## Mandatory procedure

### Owner clarification before deployment (2026-09-06)

Owner initially selected **all six switches at UAT values** and authorized editing deploy scripts, re-pinning, testing, pushing and merging into develop/main now, plus look-forward diagnostics. This supersedes earlier rollout defaults and comments requiring a separate activation order. It does not represent tests as passed or remove provider constraints.

| Setting | Authorized Production value |
| --- | --- |
| LINE_SIGNUP_ENABLED | true |
| EXTERNAL_SIGNUP_ENABLED | true |
| LINE_SIGNUP_APPROVAL_MODE | AUTO_FREE |
| RECEIPT_QUOTA_ENFORCED | true |
| LINE_AI_DRAFT_EDIT_ENABLED | true |
| EMAIL_PROVIDER | disabled (latest owner message defers email; UAT keeps ses) |

Latest owner clarification: **defer sending email** and deliver Production behavior matching UAT for the remaining features. Keep Production EMAIL_PROVIDER=disabled and its SES activation rejection; do not change SES IAM or submit a sandbox-access request. External web signup may accept requests, but its email-dependent claim path is not a completed customer journey while email is deferred; prioritize the LINE-first path and report this explicit exception honestly.

Implementation: align the five deploy defaults and remove only their obsolete Production activation rejections. Preserve type validation, explicit off/manual overrides, maintenance quiescence, tenant/auth/mutation boundaries and environment identities. Align actual AgentCore prepared/fused/family defaults with ECS, and pass LINE_AI_DRAFT_EDIT_ENABLED into AgentCore so the actual router can expose draft tools. Extend the existing executable config/AgentCore contracts, synchronize enforcement pins, run mandatory focused/security checks, review the exact diff and integrate through normal PR/CI/branch protections. No cloud service rollout before 01:30.

SES diagnostic before deferral: workstation watchdog-bedrock lacks ses:GetAccount (AccessDenied). No SES mutation was performed; all draft SES permission/email changes were removed after the owner deferred email.

Verification completed locally: production-serving-mode.spec.sh PASS (real defaults for UAT and Production, explicit on/off/MANUAL values, invalid booleans, deferred email and existing maintenance gates); h15-trust-boundary.spec.sh PASS (actual AgentCore env render in both environments including prepared/fused/draft defaults and false overrides, secret and final-mutation boundaries). Production security scanner PASS (exit 0); Prisma release/migration tests 26/26 PASS; AI orchestrator tests 40/40 PASS; pin synchronization check and git diff --check PASS. PR CI pending.

PR #465 is now MERGED; main is 01e0bc6bb44bd31d28f3596cc761fe67a8a2bdbc, develop is 54252aeb17205edcfb09bb292c328aee3d8fdbd7, and CI 34045633087 passed Typecheck/Test, Security Audit, Secret Scan, Production Config Validation and Migration Review. Configuration worktree: /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-prod-parity-20260907; branch codex/prod-uat-config-parity-20260907.

### Execution

1. Read `AGENTS.md`, `docs/runbooks/cloud-environment-operations.md` and `docs/runbooks/uat-production-v2-deployment.md` again before acting. Follow the canonical protocol before each deployment, READY, customer gate action, recovery or retry.
2. Use normal non-root AWS access (`watchdog-bedrock` / `watchdog-bedrock-dev`) for inspection and GitHub OIDC workflows for deployment. `thawatchai` is root; renewed login is not permission to bypass runbook IAM boundaries. If a scoped prerequisite ceremony is necessary, read its runbook and establish the required non-root authority.
3. Refresh `origin/main` and `origin/develop` and inspect PR/CI state. Choose the exact reviewed PR head containing the requested release, with successful required CI jobs, not merely a green overall status. Candidate must be an ancestor of both branches and have required workflow blobs compatible with the main controller. Do not deploy unreviewed/unmerged work or silently choose an older partial release.
4. Review and merge only within authorized release integration scope and existing branch protection. Do not bypass required review/checks. Keep the selected main controller unchanged from UAT through final Production acceptance; detect races before each dispatch. Do not edit branch protection to manufacture a freeze.
5. Before every dispatch establish that no UAT/READY/Production run is queued/running. Record exact IDs immediately and monitor the same run to terminal; do not dispatch duplicates to find errors. UAT all triggers an automatic maintenance READY; wait for it to finish before any separate live READY.
6. UAT must establish exact image digests, health, deep DB readiness and a valid signed Passport. Production reuses those immutable images and validated AgentCore artifact/bindings; no application image rebuild in Production.
7. For live Production use verified legal evidence or an applicable recorded owner approval with its real reference. Do not turn an ordinary deploy instruction into a fabricated legal waiver. Preserve/restore the authorized existing live customer outcome using the runbook. A signed PROMOTED_LIVE alone is insufficient: durable PlatformAccess OPEN and complete login/identity/permissions/logout/post-logout acceptance are required.
8. Fail at the first failing boundary. Preserve failed run/attempt, candidate/controller, durable operation/task identity and sanitized evidence, inspect sibling prerequisites read-only, prove a root-cause fix and recovery terminal state before any retry. Respect Passport/READY expiry and source/controller drift rules.
9. Do not touch unrelated untracked work, edit package.json outside dependency changes, or send real emails/LINE messages or create customer transactions merely as test probes without explicit authorization. If code fixes are needed, read the relocated Ponytail skill at `.agents/skills/ponytail/SKILL.md` (the AGENTS.md absolute `/Users/spare058/...` path is stale); use the shortest correct fix and focused executable evidence, then required PR/CI flow.

## Preparation findings to revalidate at wakeup

These are source/provider observations at approximately 23:40 on 6 September, not proof of runtime state at deployment time.

- Existing checkout is on `develop` with unrelated untracked files in docs/output directories. Preserve them and use an isolated checkout for any code changes.
- GitHub PR **#465**, develop → main, head `54252aeb17205edcfb09bb292c328aee3d8fdbd7`, was open; CI run **34045633087** was in progress. It contains wave 3b: open-company-web buttons, AI-off capability answer, LIFF legal hash display cleanup, signup start → dashboard and LINE handoff-token revoke. Re-read its current state and any later intended release changes; do not hardcode this as a passed/merged candidate.
- Earlier wave merge PR CI **34041057521** passed on head `5dabcf16724fc22b78287ca651e24fe1a14ed9dd`. This alone does not cover the later wave.
- `infra/ai-gateway/agentcore-deploy.sh` currently assigns prepared/fused flags and deterministic families for UAT but forces Production false/empty. `docs/agent-memory/line-ai-hosted-baseline-2026-09-03.md` confirmed this exact runtime split: ECS enabled prepared behavior while Production AgentCore actually executing turns had it disabled. This is a known effective-config boundary, not a missing GitHub variable alone.
- `infra/prod-ecs-express/deploy.sh` currently defaults Production `EXTERNAL_SIGNUP_ENABLED=false` and `EMAIL_PROVIDER=disabled`, and rejects Production `EXTERNAL_SIGNUP_ENABLED=true` / `EMAIL_PROVIDER=ses`. Inspect current code, current LINE-first signup design and existing release-manifest/config handling before choosing the minimal activation fix. The user now requests auto-register Production activation; do not treat an old "await owner order" comment as a need for duplicate authorization. Do not enable an obsolete email-first journey indiscriminately.
- App schemas default multiple AI features off and external signup off. Audit effective consumers and deployment rendering, not just variable presence. Model fields in deploy-uat are intentionally sourced through the release manifest, so do not override that contract with guessed environment values.
- Old auto-register review `docs/agent-memory/auto-register-review-2026-09-05.md` is a historical issue list; recent waves may already fix it. Verify the current implementation and journey before treating old findings as remaining bugs or declaring them fixed.
- `docs/runbooks/uat-production-v2-deployment.md` requires a legal/live basis. Resolve current legal evidence or applicable standing owner reference before any live READY; no legal approval was fabricated during scheduling.

## Configuration and acceptance matrix

Produce a complete secret-safe comparison before/after release. For every applicable key report missing/equal/different/expected environment difference and effective value origin; never record secret values, tokens, cookies, credential URLs or private account details.

| Layer | Required comparison / proof |
| --- | --- |
| Repository and manifest | Config schema/defaults, workflow input wiring, rendered runtime values, AI release manifest/model catalog, UAT-only branches and Production hardcoded fallbacks |
| GitHub environments | UAT vs production variable names/values where safe and secret names/metadata only; distinguish unused variables from values consumed by workflows |
| ECS Express | Effective api-web, ai-gateway and workers environment and secret references, source/digest, service status/current deployment; use describe-express-gateway-service, not misleading describe-services counts |
| AgentCore | Runtime/endpoint/version/artifact bound to the release, effective execution environment, model/region/tool API settings and secret/role bindings |
| AI behavior | Gateway/orchestration/runtime enabled, prepared/fused/deterministic families, router/critic/provider settings, timeouts/reuse/affinity, tool/audit access, entitlement and tenant scope, refusal/fallback reasons and representative correctness tests |
| Auto-register | Current LINE/LIFF-first signup, feature activation, matching Production app IDs/callback/webhook URLs, approval/onboarding/trial entitlements, company context, handoff/revocation, loading/error/recovery/permission states; email/SES only where the current journey requires it |
| Environment distinctions | Production URLs, DB/Redis, S3, credentials, LINE channels/LIFF identity, service ARNs, tenant allowlists and security/retention remain Production-specific; no copied UAT credentials, test data or local-console email |
| UAT acceptance | Exact candidate deep DB readiness plus hosted AI and auto-register acceptance; use existing disposable/test paths, report any unavailable mobile/provider proof honestly |
| Production acceptance | Signed result, exact UAT image/artifact use, config readback, AI availability/correct runtime activation, deep readiness, legal/customer OPEN ceremony, public login, SYSTEM_ADMIN identity/permission, logout 204 and post-logout 401, stable services/alarms and no clone residue |

Use relevant existing plans and evidence: `docs/plans/mangmee-auto-register-uat-test-plan-th.md`, `docs/plans/mangmee-external-signup-plan-th.md`, `docs/agent-memory/auto-register-flow-b.md`, `docs/agent-memory/mangmee-brain-real-answers.md`, `docs/agent-memory/mangmee-brain-2-5-day-priority-plan.md`, `docs/agent-memory/prod-parity-uat-flags-2026-08-30.md` and the September 3 hosted baseline. Reconcile current specs before activation rather than following historical plans blindly.

## Release ledger

- Scheduler: `deploy-uat-production-7-01-30`, heartbeat in task `01a0778d-a88f-76c2-a9d4-334b53165360`, ACTIVE, one occurrence at local 01:30; created and verified before midnight on September 6. If editing this schedule use the app automation tool; do not hand-edit scheduler storage.
- Scheduled local time: 2026-09-07 01:30:00 Asia/Bangkok.
- Scheduled UTC: 2026-09-06T18:30:00Z.
- Candidate: pending verified selection.
- Controller: pending freeze.
- Required CI/review evidence: pending.
- UAT_RUN_ID / attempt: not dispatched.
- Passport artifact digest: pending.
- READY_RUN_ID / attempt / mode: not dispatched.
- READY artifact digest: pending.
- Legal evidence / applicable owner reference: pending readback.
- PROD_RUN_ID / attempt: not dispatched.
- Signed Result artifact digest: pending.
- Config comparison / approved expected differences: pending.
- Serving mode / durable customer gate / final acceptance: pending.
- Recovery / residue: no release started.

## Preflight evidence (2026-09-07, before 01:30)

- Read-only `AWS_PROFILE=watchdog-bedrock DEPLOY_ENV=uat bash infra/uat/verify-deploy-readiness.sh` PASS: three singleton stable services, rollout controls, required secret metadata and rollback alarms OK. This does not claim every exact IAM policy check has run.
- Full config inventory: `/tmp/mangmee-release-20260907-config-audit.json`, repeatable secret-safe collector `/tmp/mangmee-release-20260907-config-audit.py`. All current ECS services ACTIVE/singleton. GitHub environment variables paginated to completion. GitHub secret names differ intentionally: UAT TYPHOON_OCR_API_KEY; Production PRODUCTION_POLICY_READ_TOKEN. Runtime secrets are environment-specific references, no missing ECS secret-reference keys.
- API has 18 keys missing from old Production: the new signup/draft/quota/LINE free budget settings plus deferred email metadata. All are rendered by current deploy.sh. AI gateway lacks draft edit on old Production. Remaining ECS differences are source/artifact/version, environment identity, URLs/LINE channels, JWT audience/issuer and S3/secret references. Production OA add/QR links are configured; UAT values are empty and must not overwrite Production.
- Actual AgentCore endpoint mapping verified read-only in the owner's AWS Console because workstation IAM lacks GetAgentRuntimeEndpoint: UAT candidate_uat_f2bd38edc114_22c3d599 → version 53; Production candidate_production_a768e3a27aa0_10fcf6d2 → version 17. Collector asserts the ECS qualifier matches that observed mapping, then reads exactly those versions using normal IAM access. Both READY. Production prepared/fused=false and families empty while UAT true/four families; both omit draft edit. The code fix closes all four gaps. Models match global.anthropic.claude-sonnet-4-6. Do not use latest runtime version as evidence of the currently bound endpoint.
- GitHub UAT LINE_AI_AGENT_RUNTIME is stale strands-local; actual ECS is agentcore on both. deploy-uat.yml sets agentcore and exact binding after candidate runtime creation. Missing UAT timeout/confidence variables use defaults matching actual Production; environment-specific ARNs, KMS/alerts, Redis group and outbound allowlists are intentional differences.
- LINE Production inspected in the owner's Chrome profile: OA @458wpnio, messaging channel 2011037770 and published login channel 2011037668 share provider 2005422657. Provider webhook Verify returned Success. Login callback is https://mangmeeplus.com/api/auth/line-login/callback. LIFF 2011037668-9U7Pc6SJ is Full with openid/profile, endpoint https://mangmeeplus.com/v1/auth/line/link-page, correctly matching nested signup/start/employee routes. Official QR URL matches the Production GitHub value. Login channel linked-OA field is empty; no provider mutation performed. No customer messages or transactions sent.
- Legal manifest remains BLOCKED. Historical owner reference OWNER-DIRECTIVE-2026-08-30-UAT-PARITY is recorded for the old release; no standing legal waiver for this new release has been verified. This must be resolved before live READY, without fabricating a legal approval.
- Synced this branch onto develop f37ed7d8 (includes merged #466) before committing the parity change. #467 was still open; refresh before final release integration.
