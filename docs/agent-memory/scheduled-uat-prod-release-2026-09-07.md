# Agent Memory: scheduled-uat-prod-release-2026-09-07

Status: Signed production deployment completed for the recorded release; public gate OPEN. Authenticated admin/customer acceptance remains pending as described below. This historical record is not a declaration that the later signup/receipt fixes have been deployed.
Owner: thawatchai / GitHub MangmeeDev
Scope: One release, starting 2026-09-07 01:30 Asia/Bangkok (2026-09-06T18:30:00Z): UAT all → signed Passport → Production READY → Production → customer acceptance. Include the current reviewed AI intelligence, auto-register and bug-fix release; audit and reconcile effective configuration across environments.
Decisions: The user explicitly authorized both deployments and adding missing environment values. Do not ask for deployment/env permission again. Preserve environment-specific credentials/resources and existing safety/tenant boundaries. The authorization does not invent missing external values or legal evidence.
Open questions: Owner must unlock Mac and login current Production admin prodmangmeeplus in Chrome Developer. No further deploy/legal/admin-merge permission needed; do not request a password in chat.
Artifacts: This ledger; automation `deploy-uat-production-7-01-30` in the same task. Add a secret-safe config comparison and release evidence here or under an associated evidence path.
Verification: AWS profile thawatchai login refreshed and STS account 311414082667/root verified; watchdog-bedrock STS verified IAM user watchdog-bedrock-dev. GitHub CLI authenticated as MangmeeDev. Mandatory runbooks read during preparation. Automation create succeeded; view rendered the saved card; saved configuration readback verified heartbeat, ACTIVE, same task, count one and local 01:30. No release acceptance claimed.
Next: Use current administrator prodmangmeeplus / cmt8k20fs00000q319isxwkc5 after Mac unlock. Complete BFF login200, no forced password/legal gate, exact identity + SYSTEM_ADMIN + system.launch_gate.manage, authenticated OPEN/canOpen readback, logout204 and post-logout401. Finish final report and integrate prepared docs-only runbook correction after acceptance. Keep main frozen; no new deploy/READY or seed reset.

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

- Scheduler: `deploy-uat-production-7-01-30`, same-task one-off, PAUSED after the scheduled wakeup; no new release dispatch from this schedule.
- Requested time: 2026-09-07 01:30 Asia/Bangkok (2026-09-06T18:30:00Z). Latest owner legal/live authorization received before this morning's actual release.
- Candidate: `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`, exact CI `34048730318` required jobs passed, ancestor of develop/main.
- Current frozen controller: `3720db9a2414bd671c63be3fdd69270487f1402a`. Previous failed controller: `255c889917e3c56511fdff562c36e605c72ecc98`.
- UAT_RUN_ID / attempt: `34068520561` / 1, SUCCESS.
- Passport archive digest: `sha256:752c9bb1bfaf55ac82b9268c2c1613f73db3c3d021de8736f5c6d0416794db79`.
- Automatic maintenance READY: `34069876587` / 1, SUCCESS; archive `sha256:578a051003c9694fbf38e23fcd0152a0adfac00783be356dbd07cf32197de7ba`.
- Previous live READY: `34071132693` / 1, SUCCESS (superseded controller/baseline); archive `sha256:a1bba6a26616c1d94903be6352ad3ed493c56eae5ddae5e4ec4405f4c3428c5d`.
- Current live READY_RUN_ID / attempt: `34076680047` / 1, SUCCESS on controller3720db9a; archive digest `sha256:1ed9e9af6c1d9abcadd634c46210b95c2e063e2afb2ca97b10b2031e9cf0cd94`. Canonical validator and exact cosign identity PASS.
- Legal mode/reference: OWNER_OVERRIDE, approvedBy MangmeeDev, `OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY`; actual approval quoted in the later execution section. Legal manifest remains BLOCKED.
- Failed PROD_RUN_ID / attempt: `34072334980` / 1, FAILURE. Both API attempts rollback successful; controller artifact proves no parent/DB intent created; terminal platform proof passes. Superseded by corrected run34078121808 after terminal proof, fix/CI and new READY. Failed artifact archive digest `sha256:888697d97a1129a355519ebb75a175e419dc055ea0574269fa95b6f75bdebb75`.
- Current PROD_RUN_ID / attempt: `34078121808` / 1, SUCCESS at2026-09-07T04:03:56Z; title Promote READY34076680047 → live; source604ac785/controller3720db9a.
- Result: PROMOTED_LIVE, canonical validator/cosign PASS; archive sha256:5f3f8496b812a484e4be7ec48147f4244d238b403f087a73e0ca6c6e7017b821. Public OPEN/login marker PASS. Current-admin authenticated acceptance still pending; do not call the release fully accepted.

## Preflight evidence (2026-09-07, before 01:30)

- Read-only `AWS_PROFILE=watchdog-bedrock DEPLOY_ENV=uat bash infra/uat/verify-deploy-readiness.sh` PASS: three singleton stable services, rollout controls, required secret metadata and rollback alarms OK. This does not claim every exact IAM policy check has run.
- Full config inventory: `/tmp/mangmee-release-20260907-config-audit.json`, repeatable secret-safe collector `/tmp/mangmee-release-20260907-config-audit.py`. All current ECS services ACTIVE/singleton. GitHub environment variables paginated to completion. GitHub secret names differ intentionally: UAT TYPHOON_OCR_API_KEY; Production PRODUCTION_POLICY_READ_TOKEN. Runtime secrets are environment-specific references, no missing ECS secret-reference keys.
- API has 18 keys missing from old Production: the new signup/draft/quota/LINE free budget settings plus deferred email metadata. All are rendered by current deploy.sh. AI gateway lacks draft edit on old Production. Remaining ECS differences are source/artifact/version, environment identity, URLs/LINE channels, JWT audience/issuer and S3/secret references. Production OA add/QR links are configured; UAT values are empty and must not overwrite Production.
- Actual AgentCore endpoint mapping verified read-only in the owner's AWS Console because workstation IAM lacks GetAgentRuntimeEndpoint: UAT candidate_uat_f2bd38edc114_22c3d599 → version 53; Production candidate_production_a768e3a27aa0_10fcf6d2 → version 17. Collector asserts the ECS qualifier matches that observed mapping, then reads exactly those versions using normal IAM access. Both READY. Production prepared/fused=false and families empty while UAT true/four families; both omit draft edit. The code fix closes all four gaps. Models match global.anthropic.claude-sonnet-4-6. Do not use latest runtime version as evidence of the currently bound endpoint.
- GitHub UAT LINE_AI_AGENT_RUNTIME is stale strands-local; actual ECS is agentcore on both. deploy-uat.yml sets agentcore and exact binding after candidate runtime creation. Missing UAT timeout/confidence variables use defaults matching actual Production; environment-specific ARNs, KMS/alerts, Redis group and outbound allowlists are intentional differences.
- LINE Production inspected in the owner's Chrome profile: OA @458wpnio, messaging channel 2011037770 and published login channel 2011037668 share provider 2005422657. Provider webhook Verify returned Success. Login callback is https://mangmeeplus.com/api/auth/line-login/callback. LIFF 2011037668-9U7Pc6SJ is Full with openid/profile, endpoint https://mangmeeplus.com/v1/auth/line/link-page, correctly matching nested signup/start/employee routes. Official QR URL matches the Production GitHub value. Login channel linked-OA field is empty; no provider mutation performed. No customer messages or transactions sent.
- Legal manifest remains BLOCKED. Historical owner reference OWNER-DIRECTIVE-2026-08-30-UAT-PARITY is recorded for the old release; no standing legal waiver for this new release has been verified. This must be resolved before live READY, without fabricating a legal approval.
- Synced this branch onto develop f37ed7d8 (includes merged #466) before committing the parity change. #467 was still open; refresh before final release integration.

### Release preparation update

- Config PR: https://github.com/MangmeeDev/mangmeeplus/pull/469, head 73eaaf944ca1b6c1abdb68df782cc5ddce465d6d, CI 34047788806. Security Audit, Secret Scan, Production Config Validation and Migration Review PASS; Typecheck and Test running at this update.
- #467 merged develop. Existing develop→main integration PR #468 is open, head a1272090b4db681b9c2bf2e88e46d03ebf0e0aa3 at last read. Main requires one approval; no required review has been bypassed during this task.
- Deep DB readiness of the currently running UAT and Production both PASS (17:14/17:15 UTC). Production worker token is an opaque 44-character value, not the UAT runbook's 64-hex format; do not apply the UAT-only token-shape assertion to Production or rotate a valid token. It worked against Production internal readiness. Public gate read with Python's default user agent returned HTTP 403; no customer gate failure established. Use the runbook browser/BFF acceptance after promotion.
- Confirmed LINE linked-OA omission is relevant: https://developers.line.biz/en/docs/line-login/link-a-bot/ requires linking the OA to the Login channel for bot_prompt=normal/Add friend option. Schedule a config correction linking Production Login 2011037668 to its existing OA @458wpnio; current callback/LIFF endpoint/QR remain correct. No provider change yet.
- One-time scheduler prompt updated to current five flags/email deferral, isolated worktree path, PR/CI, exact AgentCore audit limitation and unresolved legal basis. It remains ACTIVE at the original 01:30 local time; no duplicate schedule created.

### Integration and audited baseline

- #469 merged normally after full exact-head CI 34047788806 succeeded. Merge/develop SHA: 604ac785479ced5b9858d0b46d89f8d11cf2b9f6. This includes #467 and all earlier requested waves.
- #468 merged main as 187b6f49bb945d0edf3df6018c08432a791a00ec. New integration PR #470 (develop→main) contains only the seven parity files, exact head 604ac785479ced5b9858d0b46d89f8d11cf2b9f6, CI 34048730318 running. This is the intended candidate if its full CI passes and head remains unchanged. Main controller will be recorded after merge.
- Complete secret-safe BEFORE report: docs/qa/evidence/release-2026-09-07/config-parity-before.md and .json under the main checkout. 251 config entries across five layers, 17 runtime secret-reference entries. AI_GATEWAY_ENABLED, AI_AGENT_REGISTRY_ENABLED, tool policy and tool audit verified true; final mutation/prompt logging false. Expanded audit returned zero errors with exact console-observed endpoint versions. Repeat and compare after release using the NEW signed binding, not the old version map.
- Public Production gate read using curl succeeded: HTTP 200, state OPEN. Python default User-Agent's earlier 403 was not a gate-state failure. Use curl for the runbook BFF/customer acceptance, with credentials only in stdin/config/in-memory.
- Prior successful READY 34022420598 (UAT 34021347375, source f2bd38ed...) artifact downloaded to /tmp/mangmee-release-20260907-prior-ready. It reports all seven checks PASS, migrations APPEND_ONLY_PENDING/15, clone-result PASSED, closed-mode legal NOT_APPLICABLE. No migration or IAM policy-template changes between that source and current integration. All 15 SQL files reviewed: additive/nullable changes and explicit backfills, no destructive table/data deletion. Prior evidence is preflight context only; it is not the READY for the new candidate.
- Async question sent to owner for an applicable existing legal owner-override reference for this release; none supplied yet. Continue independent CI/integration work; do not fabricate approval or treat elapsed waiting as approval.

### Final preparation boundary (00:46–00:48 Bangkok)

- CI 34048730318 completed SUCCESS at exact head 604ac785479ced5b9858d0b46d89f8d11cf2b9f6. Resolve Source, Typecheck and Test, Security Audit, Secret Scan, Production Config Validation and Migration Review all SUCCESS. Image publication jobs correctly skipped in PR CI; UAT will build/sign images.
- Normal `gh pr merge 470 --merge --match-head-commit 604ac785...` was REJECTED by GitHub base branch policy. Main requires one approving review; latestReviews=[]; enforce_admins=false. No admin override or branch-protection edit was performed. This is a GitHub policy rejection, not a Codex automatic approval-review rejection.
- Sent one consolidated async question asking owner to explicitly authorize (1) admin merge of the now-green concrete PR #470 and (2) legal owner override for this release with manifest still BLOCKED. The earlier question about an existing legal reference remains unanswered. Do not infer approval from either the scheduler text or elapsed time.
- After an actual affirmative owner response, record the exact response/task reference and authorize the two exceptions. Use `--admin --match-head-commit` only after rechecking the approved PR head and successful CI. A legal reference label may then be assigned to that real recorded approval (for example OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY); this label is NOT approved at present. Do not mark the legal manifest VERIFIED.
- Verified candidate is reachable from origin/develop, and candidate ci.yml/deploy-uat.yml blobs match the current main controller. Pins current and diff checks pass in the isolated worktree. Candidate is not yet in main because #470 is still open. Record final controller and recheck both ancestry relations after merge.
- No UAT/READY/Production release run has been dispatched by this task, no cloud service configuration changed, no LINE provider setting changed, no IAM or email-provider mutation performed. Keep the one-time 01:30 wakeup; if prerequisites are still missing, report the concrete block and do not substitute an older partial candidate. If owner confirmation arrives after the target time, resume this same one-off release with the recorded ledger and no duplicate dispatch.

## Scheduled wakeup — 2026-09-07 01:30 Asia/Bangkok

- Heartbeat fired at 2026-09-06T18:30:00.694Z. Reread AGENTS and mandatory deployment/cloud runbooks, current ledger and current task messages. No owner answer to the consolidated exception question had arrived.
- Fresh GitHub read: PR #470 remains OPEN / BLOCKED / REVIEW_REQUIRED, latestReviews=[], exact head 604ac785479ced5b9858d0b46d89f8d11cf2b9f6. Main is still 187b6f49bb945d0edf3df6018c08432a791a00ec; develop still 604ac785...; CI 34048730318 remains SUCCESS. No merge retry or admin override was attempted.
- Active release inventory: no in-progress UAT/READY/Production run. Queued listing contains only historical ghost 31611733340, unchanged created/updated 2026-08-12T15:20:13Z, jobs=[], no pending deployments. This exact ghost is documented in production-a5-v2.md and main-ui-qa-uat-release-2026-08-28.md as having no executable job graph and not being a competing release; do not cancel/rerun or use it as READY. Recheck real active runs before any eventual dispatch.
- Completed independent authorized provider config: in LINE Developers, Production Login channel 2011037668, changed Linked LINE Official Account from empty to @458wpnio/มั่งมี Plus using its Edit → select → Update UI. Saved readback shows the OA text, selected option and returned Edit button. Same provider/owner/channel previously verified; LIFF Add friend option already On(normal). No message, email, customer transaction, credential rotation or other provider field was changed.
- No UAT, READY or Production run dispatched. No ECS/AgentCore/IAM/customer-gate mutation occurred. The LINE provider link above is the only live config change at this wakeup.
- Pause the already-fired one-time heartbeat; do not schedule a daily retry. Task remains awaiting the owner's concrete confirmation (admin merge #470 and applicable legal owner override). Once an actual affirmative reply arrives, record it and continue this same release immediately since the requested time has passed, preserving all exact-source/CI/no-duplicate/release-acceptance checks.

## Owner-approved execution — 2026-09-07

- Actual owner message in task `01a0778d-a88f-76c2-a9d4-334b53165360`: **“อนุมัติ legal owner  และ deploy prod เพื่อเปิดใช้งานจริง”**. Received in response to the release exception question. This explicitly approves legal owner override and live Production for this release.
- Auditable reference assigned to that actual approval: `OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY`. This records the owner's decision; legal manifest remains BLOCKED, not VERIFIED. Email deferral remains in force.
- PR #470 was already MERGED at 2026-09-06T23:50:06Z before this execution resumed. No admin merge, self-review or protection edit by this continuation was needed/performed.
- Candidate: `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`; controller/main: `255c889917e3c56511fdff562c36e605c72ecc98`; develop: `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`. Candidate ancestor of both branches, CI/deploy-uat blobs identical to controller, isolated worktree clean. Main is held unchanged through final customer acceptance, with remote SHA checks before dispatch.
- Exact CI `34048730318` read back SUCCESS with actual required jobs SUCCESS. GitHub actor `MangmeeDev`; non-root AWS account `311414082667` / IAM user `watchdog-bedrock-dev`.
- No in-progress runs. Only queued entry is documented unchanged ghost `31611733340`, jobs count 0/check-runs count 0, created/updated 2026-08-12T15:20:13Z. Excluded as a known non-executable platform incident; no cancellation/rerun performed.
- Execution resumed after the requested time. One-off scheduler stays PAUSED; this is the original authorized release, not a new scheduled occurrence.
- Approval and source readback recorded at 2026-09-07T00:01:46.699377+00:00.

- UAT preflight PASS. Dispatched exactly once: `UAT_RUN_ID=34068520561`, attempt `1`, candidate `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`, controller `255c889917e3c56511fdff562c36e605c72ecc98`, target all, run_m01_acceptance false. URL: https://github.com/MangmeeDev/mangmeeplus/actions/runs/34068520561 . READY/Production not dispatched.

- UAT build/publication progressed successfully through all three application images and both release tools; required exact-head CI was reused. Main readback remains 255c889917e3c56511fdff562c36e605c72ecc98. Prepared secret-safe customer acceptance helper `/tmp/mangmee-release-20260907-customer-acceptance.py` (not executed yet), and AFTER collector `/tmp/mangmee-release-20260907-config-audit-after.py` which requires new signed bindings and verifies their complete runtime configuration hash.

- UAT rollout step and exact digest/health step completed successfully. Secret-safe hosted checks at 2026-09-07T00:24:33Z PASS: deep DB readiness; external signup enabled; LINE login available; signup status route enabled and identity-guarded (401 without ID token); LIFF signup/start/employee pages; signup/welcome/claim-account pages; exact configured LINE webhook + active=true; LINE provider test success/200. Evidence: docs/qa/evidence/release-2026-09-07/uat-hosted-checks.json. Browser UAT /signup rendered the full form/trial/terms/privacy content successfully, no application submitted. In-app agent-created hidden browser tab id 2. These checks do not claim a mobile LINE signup transaction or J1–J4 was executed.

- Browser LIFF signup initialized successfully and navigated to LINE Login for UAT channel 2010784350 / LIFF 2010784350-ruzn5beM, callback under the registered UAT link-page scope with nested signup and bot_prompt=normal. No credentials entered, no legal consent accepted and no signup submitted. Agent-created browser tab 2 closed. OAuth ephemeral URLs/state not retained.

- `UAT_RUN_ID=34068520561`, attempt 1, completed SUCCESS. Auto `MAINTENANCE_READY_RUN_ID=34069876587`, attempt 1, created 2026-09-07T00:27:28Z, controller 255c889917e3c56511fdff562c36e605c72ecc98, title Production readiness from UAT 34068520561. No manual READY or Production dispatched; wait for this auto run to finish before live READY.

- Downloaded exact UAT Passport to docs/qa/evidence/release-2026-09-07/uat-passport-34068520561; archive SHA-256 verified against GitHub: `sha256:752c9bb1bfaf55ac82b9268c2c1613f73db3c3d021de8736f5c6d0416794db79`. Canonical full Passport validator PASS and cosign Verify OK with deploy-uat.yml@main identity, repository/ref/trigger/controller bound. Passport validatedCiRunId=34048730318; issuedAtEpoch=1788740835, expiresAtEpoch=1788827235. UAT AgentCore exact signed endpoint candidate_uat_604ac785479c_540132fc, version 54.

- UAT exact live readback at 2026-09-07T00:29:51Z PASS: three ACTIVE singleton Express services, currentDeployment null, each exact Passport image/source. API signup/external/AUTO_FREE/quota/draft all ON; email ses remains UAT-only. Gateway binding equals signed UAT endpoint. Actual AgentCore v54 complete configuration hash equals signed binding; prepared/fused/draft=true, four deterministic families, Sonnet4.6. Evidence docs/qa/evidence/release-2026-09-07/uat-runtime-readback.json. DOCUMENT_AI_MODEL_ID is not a consumed AgentCore runtime key (document model is set on ECS gateway), so null in this subset is not a missing feature.

- Read completed UAT job 101582624753 AgentCore smoke output: both calls returned HTTP 200 and model usage ok=true on global.anthropic.claude-sonnet-4-6, runtimeIdentity source604ac785/artifact540132fc matched the signed binding. Synthetic read correctly hit `forbidden` with no tools/data (fixture lacks business authority); synthetic payment approval hit `mutation_blocked` with no tools. This proves hosted provider/runtime availability and refusal boundaries, not successful customer-data retrieval. No real LINE messages/business transactions were sent by these workflow probes.

- Auto maintenance READY 34069876587 SUCCESS. Downloaded artifact SHA `sha256:578a051003c9694fbf38e23fcd0152a0adfac00783be356dbd07cf32197de7ba`; canonical READY validator PASS; cosign Verify OK for workflow_run/readiness.yml@main and exact controller. All seven checks PASS; APPEND_ONLY_PENDING/15 migrations; clone-result PASSED. Evidence docs/qa/evidence/release-2026-09-07/auto-ready-34069876587.
- Before live READY reread canonical Protocol/§D; main still255c889917e3c56511fdff562c36e605c72ecc98, no in-progress flow; queued list only unchanged known ghost31611733340.
- Dispatched live READY exactly once: `READY_RUN_ID=34071132693`, attempt1, UAT34068520561, requested_serving_mode=live, owner_legal_override_ref=`OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY`. URL https://github.com/MangmeeDev/mangmeeplus/actions/runs/34071132693 . Production not dispatched yet.

- Auto READY cleanup proof: instanceAbsent=true, residualResourceCount=0, secretDeleted/snapshotDeleted/taskStopped=true. Live READY run34071132693 eventworkflow_dispatch actor/triggering_actorMangmeeDev and exactcontroller verified.
- Staged AgentCore parity readback at2026-09-07T00:52:47Z PASS: actual UATv54 versus staged Productionv25, all39 runtime environment keys present on both; each complete config hash equals its signed binding. Only eight expected environment differences (secret ARN references, CORS, env identity, ERP/public URLs and JWT audience/issuer). Models/source/AI flags/families equal. Evidence docs/qa/evidence/release-2026-09-07/staged-agentcore-parity.json. This is a staged candidate, not live Production; use final live READY binding after promotion.

- LIVE READY 34071132693 attempt1 SUCCESS. Exact archive digest verified `sha256:a1bba6a26616c1d94903be6352ad3ed493c56eae5ddae5e4ec4405f4c3428c5d`; canonical full READY validator PASS, cosign Verify OK (readiness.yml@main, workflow_dispatch, exact255controller). Signed requestedMode=live/effectiveTarget=all; legal.mode=OWNER_OVERRIDE, approvedBy=MangmeeDev, ownerApprovalRef=OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY, checks legalModeOWNER_OVERRIDE and all other sixPASS. All15 migrations executed successfully on clone, schemaValidation/compatibilityPASSED; cleanup instanceAbsent/secretDeleted/snapshotDeleted/taskStoppedtrue and residualResourceCount0. Evidence docs/qa/evidence/release-2026-09-07/live-ready-34071132693.
- Before Production dispatch reread Protocol/§D/§E/two-dispatch/failure rules; main still255c889917e3c56511fdff562c36e605c72ecc98. No in-progress release; queued only unchanged known non-executable ghost31611733340. Production alarms15/15OK at look-forward read. Email remains disabled; WEB_BASE_URL rendering is unconditional and uses Production PUBLIC_DOMAIN_URL=https://mangmeeplus.com, so LINE handoff does not depend on email-provider activation.

- Production dispatched exactly once: `PROD_RUN_ID=34072334980`, attempt1, UAT34068520561, READY34071132693, requested_serving_mode=live. URL https://github.com/MangmeeDev/mangmeeplus/actions/runs/34072334980 . Final signed result/customer acceptance not yet complete.

## First Production failure boundary — 2026-09-07

- Run34072334980, attempt1, candidate604ac785, controller255c8899, step `Close the exact candidate before any Production database mutation` remains in progress at diagnosis. No later database migration step has run. Do not cancel/rerun blindly.
- New API task definition `watchdog-bms-prod-watchdog-bms-api-web-pub:211` tasks61eded19b99246cdaa6a2c62aec8752a and6ab1d93c2be342a5887e305418e49db3 exited1 / EssentialContainerExited. Old API task :210 remained RUNNING. API deployment ARN arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/watchdog-bms-prod/watchdog-bms-api-web-pub/o9qtTbJv6EK7cYNcw14SP remained IN_PROGRESS/SCALE_UP, no triggered rollback alarm at diagnosis.
- Actual API startup error: Config validation failed, invalid email at SES_FROM_ADDRESS. Sanitized log docs/qa/evidence/release-2026-09-07/production-api-startup-sanitized.log.
- Root cause: deploy.sh emits SES_FROM_ADDRESS even when EMAIL_PROVIDER=disabled; default disabled Production sender is empty, but packages/config SES_FROM_ADDRESS uses z.string().email().optional(), so empty string is invalid. UAT default sender is contact@mangmeeplus.com. Production V2 workflow has no SES_FROM_ADDRESS env wiring, so adding a GitHub variable alone would not fix it.
- Latest partial service read: AI gateway and workers ACTIVE singleton on candidate604ac785 in maintenance_only; API was transitioning candidate604 maintenance_only alongside olda768 live. Need exact failed-run controller/durable evidence and terminal platform states before recovery/retry.
- Minimal proposed fix: wire Production V2 job SES_FROM_ADDRESS from its environment variable with the established UAT contact@mangmeeplus.com fallback, keeping EMAIL_PROVIDER disabled and all SES send IAM unchanged. This is a controller-only configuration correction; prove actual app config before/after plus required workflow/security checks. No app image rebuild needed if current Passport validator permits new controller. Do not merge main while the active durable release is unresolved.
- Continue recovery protocol using exact parent/intent/task identities from failed-run evidence once terminal; no fabricated BOOTSTRAP_CLOSED/PRE_INTENT identity, no broad cancel, no new dispatch to discover errors.

## Controller sender fix proof (2026-09-07T01:51Z onward)

- Isolated worktree `../mangmeeplus-prod-email-fix-20260907`, branch `codex/fix-production-disabled-email-env-20260907`, base controller 255c889917e3c56511fdff562c36e605c72ecc98.
- One code line: Production workflow passes `SES_FROM_ADDRESS` from its variable or existing UAT fallback `contact@mangmeeplus.com`; provider remains disabled. Covers initial close, built-in recovery and live deploy.
- Secret-safe `docs/qa/evidence/release-2026-09-07/email-disabled-config-proof.json`: failed task definition 211 plaintext config plus surrogate secrets has only SES_FROM_ADDRESS invalid; changing sender passes apiConfigSchema and validateProductionConfig, email remains disabled. No secret values read for probe.
- Mandatory security shell sections passed; final Prisma subset initially could not start because the new worktree lacked generated client. Generated Prisma and contracts, reran subset: 26/26 PASS. Running full mandatory script again with complete prerequisites for a single terminal success record.
- Canonical Passport validator succeeds from the new controller checkout against existing source/passport; image, application and migration files unchanged. Pin check current (45 files, validator hash e5745e073a9a061ba6df920bcc2a85d6eff221c85a40232eac2adf692df31e05).
- Platform observation: original API deployment o9qtTbJv6EK7cYNcw14SP ROLLBACK_SUCCESSFUL. Built-in recovery created API deployment RKOxLc0VVAXDLvFfQBGNp using the same empty sender, IN_PROGRESS. AI/workers each ACTIVE singleton candidate 604ac785 maintenance_only. API old a768e3a2 live remains among active configurations while candidate recovery rolls. This is an intermediate observation, not terminal proof.

- Sender fix committed as `ad65f4c0c82c7e886eaac3768662b64885030f44`; PR #471 targets develop. Exact CI `34074743418` in progress: Resolve Source, Migration Review, Production Config Validation, Secret Scan and Security Audit success; actual Typecheck/Test PostgreSQL jobs are running. Full local security script now PASS exit0, 26/26 Prisma tests; no package.json changes.
- Final acceptance helper tightened to exact result productionRunId/controllerCommit/live/all fields; future invocation requires the new controller SHA argument. No customer gate mutation performed.

## Failed Production terminal workflow evidence (02:06:39Z onward)

- Run 34072334980 attempt1 completed FAILURE; first failure initial maintenance close, built-in closed recovery also failed on the same API config. Both API deployments o9qtTbJv6EK7cYNcw14SP and RKOxLc0VVAXDLvFfQBGNp reached ROLLBACK_SUCCESSFUL, latter at 2026-09-07T02:06:39Z.
- Exact controller artifact downloaded and archive digest verified: sha256:888697d97a1129a355519ebb75a175e419dc055ea0574269fa95b6f75bdebb75, folder docs/qa/evidence/release-2026-09-07/failed-production-34072334980. Controller/source/attempt/UAT/READY exact; controller state PRE_MUTATION and release-operation.json absent. Each of six bootstrap/recovery service records exactly matches its append-only history. PRE_MUTATION here does not mean no ECS changes: bootstrap changed AI/workers and attempted API, but never reached durable database preparation.
- No RELEASE_PARENT_OPERATION_ID, DB intent UUID, parent/release-prepare/binder task identity was created. Do not invent PRE_INTENT or BOOTSTRAP_CLOSED external recovery input for an absent parent. Platform must still settle to stable singletons and no active release task before a retry.
- First post-workflow platform proof correctly refused API with two active configurations despite currentDeployment null. Wait for provider cleanup; do not weaken singleton gate.

- Platform terminal proof docs/qa/evidence/release-2026-09-07/failed-production-platform-terminal.json PASS at 02:09Z: two identical live reads per service, ACTIVE/singleton/currentDeployment null, latest deployment successful/rollback successful. API old a768e3a2 live; AI/workers candidate604ac785 maintenance_only. Exactly three service tasks RUNNING, no non-service task, all15 alarms OK. Failed operation is terminal; reviewed controller integration may now proceed.

## Sender fix integration

- PR #471 normal merge successful 2026-09-07T02:18:52Z. Head ad65f4c0c82c7e886eaac3768662b64885030f44; develop merge 4b91953ff7f6e270a07f83c394fef233ce00aa76. No admin bypass. Exact CI34074743418 SUCCESS with all actual required jobs, PostgreSQL, LINE whole-chain and release/security checks.
- PR #472 targets main from the same exact fix head ad65f4c0; this avoids changing the reviewed code while both branches receive the patch. Main remains255c8899. Main PR CI34075616561 is in progress; branch requires one approval, reviewDecision REVIEW_REQUIRED. No attempt to bypass it. No new UAT/READY/Production dispatch.
- Prepared /tmp/mangmee-release-20260907-audit-summary.py to assert final enabled feature values/source/image parity and generate a full table, failing on unclassified runtime differences. Must inspect actual collected differences and classify explicitly before final report.

- Owner-authorized missing non-secret env added after failed run/platform terminal: GitHub Production SES_FROM_ADDRESS was absent; set to contact@mangmeeplus.com and readback verified. The one-line workflow consumes it, fallback remains identical. EMAIL_PROVIDER unchanged/disabled, no SES IAM or sending activation. After-audit GitHub layer will include this extra input and explicitly classify it against UAT's equal runtime fallback.

## Explicit admin merge authorization (owner, current task)

Owner: **“ใช้ admin merge ได้เลย”**. This explicitly authorizes admin merge of the prepared main fix PR #472 when its required CI completes successfully. Preserve branch protection settings; bypass only the missing independent review under this owner exception. Do not ask again for admin merge, legal override, env addition or Production deployment. Main PR exact head remains ad65f4c0c82c7e886eaac3768662b64885030f44; #471 already merged into develop.

## Corrected controller and new live READY (2026-09-07T02:33:33Z)

- PR #472 admin merge completed 02:32:10Z under the owner's explicit authorization. Exact head ad65f4c0c82c7e886eaac3768662b64885030f44. CI #47134074743418 and #47234075616561 both SUCCESS; all actual required jobs, PostgreSQL recovery/journey specs, app tests, LINE AI whole-chain, release/security/maintenance controls passed. Branch protection remains strict=true, reviewCount1, adminEnforced=false; no protection edits.
- NEW FROZEN MAIN/CONTROLLER: `3720db9a2414bd671c63be3fdd69270487f1402a`. Develop:4b91953ff7f6e270a07f83c394fef233ce00aa76. Local operational worktree ../mangmeeplus-prod-email-fix-20260907 fast-forwarded to3720db9a, clean. Original candidate604ac785 reachable from both branches; apps/packages/infra/lockfile diff empty; CI/UAT workflow blobs match original source.
- Reread mandatory Protocol, live owner-override, failure/retry and Express provider rules. Canonical Passport validator PASS from new main, UAT controller remains255c8899 in its historic signature. No active real release/recovery runs; only verified ghost31611733340 unchanged timestamp/head and zero jobs.
- NEW READY_RUN_ID: `34076680047`, attempt1, workflow_dispatch main, head3720db9a, created02:33:33Z, title Production readiness from UAT34068520561. Requested live, owner_legal_override_ref OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY. Exactly one dispatch. Await this run's signed READY and full validation before Production retry.

- Production LINE credential identity readback PASS at 02:37:56Z: the actual token referenced by Production resolves through LINE GET /v2/bot/info to basicId @458wpnio, matching the owner-provided OA console. Proof docs/qa/evidence/release-2026-09-07/production-line-oa-identity.json. Credential stayed in memory/stdin; no message sent.

- Additional look-forward proof docs/qa/evidence/release-2026-09-07/actual-api-config-proof.json PASS at 02:45:06Z. Compared old API task210 and failed211: all12 secret reference keys/ARNs identical. The config library diff old live a768e3a2→candidate604ac785 adds feature fields only; secret validation rules unchanged. Then read all12 exact AWSCURRENT secret values only in memory/stdin and validated the actual failed environment: sole error SES_FROM_ADDRESS. With fixed sender, full apiConfigSchema + validateProductionConfig PASS in maintenance and with projected authorized live controls; EMAIL_PROVIDER disabled in both. No secret values persisted or printed. This augments, not replaces, final actual live task/health readback.

## Corrected live READY verification complete

- READY34076680047 attempt1 SUCCESS. Downloaded exact artifact to docs/qa/evidence/release-2026-09-07/live-ready-34076680047; archive digest verified against GitHub: sha256:1ed9e9af6c1d9abcadd634c46210b95c2e063e2afb2ca97b10b2031e9cf0cd94. Canonical READY validator PASS and cosign Verified OK for readiness.yml@main, controller3720db9a, workflow_dispatch, MangmeeDev/mangmeeplus.
- Signed source604ac785, live/all, OWNER_OVERRIDE approvedByMangmeeDev and exact owner ref. All six technical checks PASS, legalMode OWNER_OVERRIDE. APPEND_ONLY_PENDING15; all15 clone migrations executed, schemaValidation/compatibility PASSED. Cleanup: instanceAbsent/secretDeleted/snapshotDeleted/taskStopped true, residualResourceCount0. Live RDS read shows clone watchdog-a5-clone-34076680047-a1-604ac785 absent.
- Signed Production AgentCore binding reuses exact READY version25 (not latest), endpoint candidate_production_604ac785479c_540132fc; runtime watchdog_orchestrator_production_candidate-FWHp0D4V34. Artifact540132fcfcdb891929b9f005e74d309e1e15723a1ecc4afddf149b4b2a78807d; config hash8aeb2072dde4811b21f23894ef869b33c109140667966037d033d23b12ad1e72. Use this binding for final actual-runtime audit.
- Reread mandatory Protocol/owner-live/OPEN/failure rules immediately before corrected Production dispatch. Do not change main3720db9a through final acceptance.

## Corrected Production dispatch (2026-09-07T02:59:57Z)

- Pre-dispatch zero-active proof checks queued/in_progress/waiting/requested/pending release/recovery workflows: no real active run, only known ghost31611733340 unchanged with zero jobs. Remote main exactly3720db9a; Production SES_FROM_ADDRESS readback contact@mangmeeplus.com.
- PRODUCTION RUN `34078121808`, attempt1, workflow_dispatch main, head3720db9a2414bd671c63be3fdd69270487f1402a, title **Promote READY34076680047 → live**, created02:59:57Z. Inputs UAT34068520561, READY34076680047, requested_serving_mode live. Exactly one corrected dispatch.
- Persist through this exact run; never cancel/rerun during durable operations. After success download/validate/signature-verify exact result, then run customer acceptance helper with controller3720db9a argument and Prod34078121808, followed by hosted/LIFF exact-production-ID checks and full config audit with the current READY binding.

- Corrected Production progression at 03:18Z: all rechecks and maintenance compatibility passed; current step initial candidate close before DB mutation. API deployment5lFn2a9zXadcJWXsNu353 now targets source604ac785 maintenance_only with actual SES_FROM_ADDRESS=contact@mangmeeplus.com and EMAIL_PROVIDER=disabled. AI/workers stable singleton source604ac785 maintenance_only. API rollout still active; no completion claimed.

### Corrected API startup and maintenance closure — 03:25 UTC

- Production34078121808 closed-stage candidate rollout succeeded at03:21:24Z. Taskdefinition213 uses the correct sender while EMAIL_PROVIDER remains disabled. New taskdd504ac047f04be684aeb5800bf85ed1 is RUNNING; its first100 CloudWatch events contain `server started` and no ConfigValidationError.
- Workflow is in the reviewed900-second direct-storage ingress drain, expected to finish no earlier than03:36:24Z. This is the existing URL expiry contract, not a stalled rollout. Durable release preparation and DB migrations have not started at this snapshot. Continue monitoring the same run; no cancellation or duplicate dispatch.

### Durable preparation and transient alarm — 03:38 UTC

- Ingress drain completed at03:36Z; workflow persisted its operation identity and entered signed READY/database-fence preparation. Production34078121808 remains the only current run.
- Read-only monitoring found API RollbackAlarm ALARM during closure. Its metrics were4XX, with no5XX values; API log sample showed health/platform-access/deep-readiness200 and no server-error level. Service itself was ACTIVE/singleton with successful deployment. No HTTP probes were added during canary and no alarm/config/control-plane mutation was performed.
- At03:38Z all15 Production alarms were back toOK. Saved metrics in `docs/qa/evidence/release-2026-09-07/production-maintenance-alarm-readback.json`; root cause of the4XX traffic was not established, so do not label it an application failure or a proved false alarm. Recheck all alarms at final acceptance.

### Production migrations and model execution proved — 03:56 UTC

- Durable operation UUID: `55d9d582-628f-4204-9515-2ac799187e19`. Release-prepare task `c9bad60e6b0241639ee2aedb44c3a4b8`, taskdefinition209, exited0. Actual log lists all15 migrations and `All migrations have been successfully applied.`; sanitized proof `docs/qa/evidence/release-2026-09-07/production-migration-execution.json`.
- Production READY34076680047 actually ran both AgentCore smoke invocations on source604ac785/artifact540132fc. Extracted exact turn IDs from logs: safe `smoke-read-01` HTTP200, Sonnet4.6 usage ok=true, permission-refused `forbidden` with zero tools; `smoke-mutation-01` HTTP200, Sonnet4.6 usage ok=true, mutation_blocked with zero tools. This proves real model execution and mutation refusal, not successful customer data access. Proof `production-agentcore-smoke-evidence.json`.
- AI Gateway and workers completed live rollout; API live rollout began03:52:47Z. Continue same Production run through finalization and signed result before customer acceptance.

### Signed live release, complete config/hosted proof, current-admin acceptance pending — 04:16 UTC

- Production34078121808 SUCCESS, finalization04:03:47Z, signing04:03:49Z, workflow04:03:56Z. Exact result canonical validation and cosign PASS, source604ac785 / controller3720db9a / live/all. Result archive `sha256:5f3f8496b812a484e4be7ec48147f4244d238b403f087a73e0ca6c6e7017b821`; controller archive `sha256:02c9e2c7c21d7f5f32a0edab6f89311a76081c51d1df9a86f1eb7975a2c426a0`.
- Actual final config comparison253 entries /17 secret references PASS. All five features and AI runtime/model/source/images match UAT. Only approved email deferral and exact environment identity/infra differences. EMAIL_LOGO_URL was individually read back as each public domain plus the same brand path before classifying it as an expected difference.
- Final platform proof PASS: threeACTIVE singleton live services, no current deployment, three service tasks and15 alarmsOK. Hosted Production tests PASS including proper Production LIFF ID, external signup availability, guarded LINE signup, deepDB and provider webhook verification. Public gateOPEN / login200+open marker PASS; no gate write performed.
- First full acceptance hit401 at the old seed login. Bounded diagnostic confirmed401 Invalid username or password; no credential reset or service redeploy was attempted. Root cause is stale runbook identity: signed cutover ADD32840045983 created `prodmangmeeplus` / `cmt8k20fs00000q319isxwkc5`; signed REVOKE32843219991 disabled old `thawatchai.watchdog` / `seed-watchdog-system-admin` and revoked38 sessions. Both archive hashes and exact cosign identities verified. Do not use the seed secret or cutover temporary secret; owner changed the current password.
- CUA getState reported Mac locked and automatic unlock unavailable. Asked owner asynchronously to unlock and login current admin in Chrome Developer; no password requested in chat. Continue authenticated acceptance when available. Do not fabricate login/logout proof from publicOPEN.
- Prepared docs-only correction to §E in isolated checkout `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-prod-email-fix-20260907/docs/runbooks/uat-production-v2-deployment.md`; `git diff --check` PASS. Not committed/pushed; main remains3720db9a pending final acceptance.
- Report: `docs/qa/evidence/release-2026-09-07/release-report.md`; machine summary `release-summary.json`. All evidence under that directory is sanitized. Mobile LINE J1–J4 / actual signup business transaction not run; email-dependent journeys remain deferred.

## Next deployment requirement — owner directive after receipt remediation, 2026-09-07

The owner explicitly requires the NEXT UAT → Production deployment to enable:

- `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true` in both UAT and Production.
- `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true` in both UAT and Production.

Carry the receipt remediation delivered in PR #473/#474. Verify workflow/deploy-script env wiring and actual running values; setting only a GitHub variable or relying on the existing `false` defaults is insufficient. Enable and exercise both in UAT before promotion, then verify Production values and LINE behavior, including partial draft continuation and delivery recovery without duplicate OCR/business writes. Record fresh UAT/READY/Production evidence under the mandatory protocol; historical run IDs above are not proof of this new activation.

See the [next-deployment checklist](../plans/receipt-reliability-and-draft-continuity-plan.md#required-flags-for-the-next-deployment--owner-directive-2026-09-07) and [receipt delivery memory](receipt-reliability-and-draft-continuity.md). This is a documentation-only instruction for the next release; no deployment or live env mutation is requested by the owner's request to record it.
