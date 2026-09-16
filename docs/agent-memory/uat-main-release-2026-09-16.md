# Agent Memory: UAT main release — 2026-09-16

Status: DEPLOYED; two native defects fixed with local HTTP/DB/Redis proofs. Final review, CI/merges and one UAT hotfix next. No active deploy.
Owner: Root, under explicit owner UAT deployment authorization.
Scope: Latest main, UAT only, existing Kamal path; migrations, complete provider/runtime setup, measured timing and native acceptance. Production excluded.

Decisions:
- Owner: UAT Stripe Sandbox, Production real/live. Owner then “ทำได้เลยนะ รอคำตอบอะไร”: proceed with proposed migration-capable normal mode and existing Gmail allowlist/test. Do not repeat policy/access-mode questions.
- Main/controller8c277dea4504b18e9537243ade031770d78ead4e; exact PR588 CI35055705698 passed actual Typecheck/Test plus checks. No new CI dispatched.
- Read cloud/V2 deployment runbooks before every cloud/release/retry action. Same enrolled hosts/private target/shared locks. No infrastructure bootstrap/Production or root/IAM change.
- Actual DB188 completed,31 pending; no checksum/unknown/unresolved drift; all31 static safety predicates passed. Hotfix refuses migrations. One normal command, no duplicate or automatic retry.
- Clock: request/prep05:37:09UTC; deploy06:18:22.462065UTC; preparation41m13.462s. Report deployment/acceptance separately. No successful deploy-duration claim until terminal.

Open questions:
- Native Admin setup requires a real privileged UAT session: current Chrome Developer user sandwich in WatchDog UAT is owner-only; actual `/system/platform-access` shows no platform-admin permission. Async question sent asking owner to sign into UAT Admin (no password in chat); deploy continues independently.
- Initial policy must use existing current-password and independent-approver flow; source explicitly rejects approving one's own request. Do not forge actors or write policy/permissions directly to DB. Complete mapped policy draft is ready privately, not published.

Artifacts:
- Authoritative detailed evidence: `docs/evidence/uat-main-readiness-2026-09-16.md`.
- Deployment worktree `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-uat-release`, branchcodex/uat-main-release-20260916. Scoped hotfix code and release docs uncommitted. Original dirty repos untouched. Temporary node_modules symlinks for main-validator check removed.
- Shared `.env.kamal` symlink points to original workspace state. Private prep `.env.kamal/uat/prep-20260916/`, credentials0600, directory0700. Never publish raw capture/run/provider files.
- Native provider journals: stripe-uat-setup-ledger.json/configured.json, stripe-webhook-setup.json, postmark-webhook-setup.json, uat-secret-provisioning.json, ecs-api-provider-update-result.json, stripe-main-policy-validation.json, postmark-native-preflight.json, billing-policy-draft.json.

Verification:
- Non-root IAM userwatchdog-bedrock-dev created seven UAT secrets without IAM changes; deployment rolemangmee-kamal-uat read all AWSCURRENT values exactly. Optional Tags initially denied TagResource; no partial secret existed, corrected untagged create. Initial deployment-role CreateSecret denial retained. Never use root profilethawatchai.
- Stripe Sandboxacct_1UEk5IRvebw5L0s3, three readable products, six paid/six zero recurring prices, VAT OFF. Exact main policy/price/product/portal validators PASS. Prior diagnostic product left unchanged.
- Portalbpc_1UGBvdRvebw5L0s3qCKXmqO6: card-update/invoice-history, no provider plan/cancel/email changes. Stripe webhookwe_1UGByzRvebw5L0s3xN2z7GNH enabled/test/exact18 source events/API2026-08-26.dahlia. No customer/checkout/payment created.
- Postmark canonical20950027/Live/outbound/developer sender/email-otp-v1-20260915 passes actual AWS-secret preflight. Gmailthawatchai.phuchana@gmail.com is UAT allowlist. Production20950034 untouched.
- Postmark webhook25832029 created BasicAuth/exact three event types/no full content; remains UNVERIFIED until deploy + POST/webhooks/25832029/verify. Initial create verified old missing route and persisted nothing; bodyVerify:false ignored by actual API,422/1364 explicitly saysuse?verify=false. Confirmed zero endpoint before corrected query-param create. No duplicates; failures retained.
- Parked UAT ECS api-web baseline full9-field roundtrip adds test mode/account/two Stripe secret ARNs, keeps all unrelated values/scaling0/0. Accepted06:14:23UTC, single stable config/no deployment/exact semantic match06:18:10UTC (AWS array ordering only), revision3061076101182934523/taskdefinition210. Kamal consumes baseline plus canonical Postmark versioned secrets.
- Previous serving source5b2fd63b, operation20260914T192255Z-e036fe7a. Actual all3 source readback/public health/login/signup200+OPEN before release. Actual enrolled API13.212.80.73 and AI/workers13.213.14.149 (not historical September11 IPs).
- Preflight20260916T054129Z-5a2dba15 passed10.117s. Before current apply no local/remote active operation or in-progress GitHub run; known August12 zero-job queued31611733340 unchanged, not rerun/cancelled.
- Current deploy started once. TypeScript all4, Nest DI and AgentCore artifact build passed. API/web image built; AI image in progress. Docker credential-helper/base-metadata step delayed then resumed by itself; no kill/restart or settings mutation. An isolated anonymous manifest diagnostic failed locally because empty Docker config lacks buildx plugin; retained, not deployment failure, abandoned once real build resumed.
- Browser: Chrome2/profilemangmeeplus.com Developer; existing UAT tab325831283 owner/sandwich. Temporary admin tab325831760 currently `/system/platform-access` permission-denied; use after owner login/new rollout. API direct-page inspection was blocked by browser; no bypass. Original Postmark tab325831732 untouched. No test mail/charge yet.
- Marketingmain has no UAT workflow/target; original marketing checkout dirty, Production origin untouched.

Next:
- Finish wrapper regression and review; batch one PR/CI per target, admin merge only after actual checks pass. Then mandatory protocol and one UAT hotfix on fresh main.
- Reverify original Postmark endpoint; actual app OTP/provider callback. Admin publication/independent approval and Sandbox purchase still require authorized sessions.
- Record final IDs/timing and native results, preserve all earlier failures. Production untouched.

## First failure and retry proof

- First operation FAILED1129.612s (18m49.612s), first boundaryfresh-config-and-image-validation. All builds/TypeScript passed1109.019s; actual diagnostic `Checkout is dirty`: only untrackedinfra/postmark/__pycache__, created by controller import. Tracked main source unchanged. Original result/logs preserved.
- Moved only that generated cache into private reconciliation evidence, then proved actual source Postmark module import underPYTHONDONTWRITEBYTECODE=1 creates no cache and git source stays clean. No clean-check bypass/source change.
- Ran actual release_inventory.py against same built four artifacts, captured full config/secret versions and overrides: all three native config schemas plus tools catalog PASS (220migration files,35sync files). Harness initially omitted original AgentCore zip beside copied build-result; original log retained, corrected with read-only artifact symlink before PASS. Not a deploy retry.
- Native Kamal render using actual controller PASSED allthree with synthetic credentials/networknone. Fresh exact baseline and14secret-version references unchanged. Native readback allthree stillprevious5b2fd63b and local/remote locks absent. No DB/runtime rollback required. Main unchanged8c277dea; no active GitHub run.
- Docker original metadata steps each122s. Isolated private Docker config with existing plugin symlink and actual Desktop socket reads exact pinned manifest in2.243s. Retry will use this scoped Docker config, not shared settings; ECR login still handled by existing private release controller. PYTHONDONTWRITEBYTECODE=1 prevents source cache writes. No CI/code/main change required.
- Mandatory retry protocol reread; retain initial failure in complete timing, do not claim a clean first attempt.

## Corrected retry active

- Operation20260916T064124Z-125e1228, started06:41:24.976598UTC; session11776. Command is same main normal/apply/UAT-smoke with envPYTHONDONTWRITEBYTECODE=1, privateDOCKER_CONFIG and verifiedDOCKER_HOST, unsetDOCKER_CONTEXT. Controller/source unchanged.
- Target preflight PASSED11.417s. Exact original first failure retained; one retry only. Total first-start-to-retry-start23m02.515s, including initial18m49.612s + reconciliation4m12.903s.

## Retry mutation progress

- Retry build56.355s, config/image/native validation passed, ECR publication and all host pulls passed. Fresh baseline/version readback passed, AgentCore prepared.
- database-and-feature-authority PASSED68.60s; receiptmigrationAndAuthorityVerified=true. All pending migrations/sync/current feature build authority verified by actual controller. Now native-rollout-and-readback. Do not revert DB or restart this active operation.

## Signed deployment and native acceptance defects

- Retry20260916T064124Z-125e1228 ACCEPTED_LINE_DEFERRED325.455s (5m25.455s); all11phasesPASSED, KMS ECDSA signatureverified, publicOPEN. Accepted SHA256c72784cd879f034313180c696be4773595f845cfce45d5bbb24d541cfee996c4; AgentCorekamal_uat_b/version8. Main8c277dea allthree.
- PostmarkverifyHTTP200 butSuccess=false; allthree400Postmark environment mismatch. Original webhookremainsUNVERIFIED, no blindretry. Actual providerUI testpayload: DeliveryServerID23; Bounce/SpamServerID1234; zeroMessageID, john@example.com, outbound. Need narrowly authenticated no-op verification handling, preserving real event identity fencing.
- Actual UAT email-access UI first request503 before mail send. Native serving-image isolated Redis probe confirms lazy connection/offline queue race onfirstrequest and successsameinstance1slater. Scope tests/livecountersuntouched except random10sTTLprobe key. Second actual UI request clicked after diagnosis; outcome pending.
- New bounded plan `docs/plans/uat-provider-activation-hotfix-2026-09-16.md`: Postmark probe handling, shared Redis initial connection, permanentPython-Bwrappers. No majorfeaturechange/approvalbypass. Implement + focusedproof + batchCI/main/develop + oneUAT hotfix under existing user authorization. No newCI dispatched yet.
- CUA tabs: uatEmailTab325831761 at/email-access; postmarkWebhookTab325831762 atwebhooks/25832029/edit with payloads expanded; uatAdminTab325831760 permissiondenied. BasicAuth fields must never be emitted; filter textfield lines or emitfalse/redact. No current Admin session supplied.

## Local hotfix verification and native delivery

- Second actual UI request returned sent/OTP form. Provider message1d8d3e1c-a95b-406e-ab27-e587a9f03dea sent06:52:17UTC, Delivered06:52:18UTC. No code/body logged; OTP confirmation and real callback not yet proved.
- Focused fixes: authenticated reserved Postmark probes no-op; shared initialRedis connect preserving offlineQueue=false/failclosed; Python-Bbothwrappers. No dependencies/schema/price policy changes.
- APIbuild/typecheckPASS, Redisunit8PASS, realisolatedRedis coldcalls/concurrency/sharedbudget/inspect/once/leasePASS. FreshPG18.3 migrations219PASS; realNestHTTP8groupsPASS; PostmarkdeliveryPG13PASS. Kamal28tests + productionimagesecurity/pinsPASS; added real wrapper bytecode test is being finalized.
- Local prerequisite/test-fixture failures retained: missing built config dependency corrected by existing build; wrapper test assumed wrong Production default, corrected to unchangedhotfix. No newCI/deploy for diagnostic iterations.

- Final focused checksPASS: Redis+Postmarkunit39/39, Kamal28/28 including both actual wrappers without inheritedPython suppression; gitdiffcheckPASS. No package.json/dependency/migration changes. Ready for one CI per develop/main PR.
