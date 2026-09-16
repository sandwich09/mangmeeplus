# Agent Memory: UAT main release — 2026-09-16

Status: Deployment and native mail acceptance complete; Sandbox purchase activation blocked on real Admin session and independent approver. Release evidence is recorded in this documentation-only report. No active deploy/source CI.
Owner: Codex under explicit owner authorization; UAT only.
Scope: Latest main application, migrations, Stripe Sandbox/Postmark UAT configuration, actual timing and native acceptance. Production excluded.

Decisions:
- Owner says UAT Sandbox, Production live; proceed without repeating answered policy decisions. Real UAT mail uses dedicated Postmark Live server20950027 and exact tester allowlist.
- Current application main `ee2f55421dde0edc0fb7226aadea66c3cc52b2d0` serves all3 containers. Local Kamal hotfix `20260916T080218Z-b9eb3d90` ACCEPTED_LINE_DEFERRED in396.159s; KMS verified; customerOPEN; AgentCorekamal_uat_a/version9.
- Normal release8c277dea applied31 migrations after188 existing; actual219 names/checksums match, no pending. Initial normal failure/reconciliation and retry retained in report.
- Both PR591/592 had exact head56aba2c6 and candidate tree0c2b8867. Full CI35066936157 SUCCESS validates this exact shared head. Develop duplicate35066933135 failed one Next dev404; same step passed in full CI and two local cold/warm8-group browser runs. No root cause proven or source fix claimed; no CI rerun. Both target merge trees exactly equal tested tree. PRs merged after the full actual success; failed rollup retained and explained in both PR bodies.
- Develop merge db47a2ca, main merge ee2f5542. Documentation-only report changes afterward do not alter application bytes or require redeploy.

Open questions/blockers:
- Chrome Developer current UAT user has no platform-admin permission. Existing async request asks owner to sign into an authorized UAT Admin; no password in chat. Native policy publication needs current-password proof plus another actual authorized approver. Do not forge approval/actors, elevate permissions or directly mutate billing policy.
- Prepared six-offer Sandbox policy is NOT published. No Checkout/payment/customer/subscription created by this task. Actual Sandbox paid e2e remains pending.
- Existing allowlisted tester account returnedLEGACY_LOGIN_REQUIRED after valid real OTP before and after hotfix; explicit passwordless opt-in remains required. No successful passwordless login/new signup claimed.
- Marketing mangmee_web has no enrolled UAT target/workflow; original dirty repo and Production marketing origin untouched. Live LINE remains deferred.

Artifacts:
- Detailed authoritative report: docs/evidence/uat-main-readiness-2026-09-16.md.
- Safe native proof: docs/evidence/uat-provider-native-acceptance-2026-09-16.json.
- Prepared billing policy/gates: docs/evidence/uat-billing-configuration-2026-09-16.json.
- Bounded code plan: docs/plans/uat-provider-activation-hotfix-2026-09-16.md.
- Worktree /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-uat-release; current report branch codex/uat-main-release-report-20260916. Shared .env.kamal links original canonical locks/state; original dirty workspaces preserved.
- Private0600 evidence: .env.kamal/uat/prep-20260916 and exact run directories. Never publish raw credentials, email bodies/codes or full environment/provider responses.

Verification:
- Native Postmark original webhook25832029 verified200 for all3 triggers after hotfix. Zero synthetic business outbox events.
- Actual first UI OTP request succeeded; message91c088a1-fde8-4c57-aef3-cdec45a1f648 accepted08:10:39.225UTC, Gmail SMTP delivered08:10:40, matching app deliveredAt, callbackPUBLISHED08:11:00.258. Entered actual code; legacy-account opt-in guard returned safe login/reset links.
- Actual new rate-limit instance: firstcallallowed, secondlimited, no degradation, isolated random10sTTLkey; no customer counter reset.
- LocalAPIbuild/typecheck; Redis/Postmark39; PostmarkPG13; actualNestHTTP8; Kamal28; realRedis5conditions; productionimagesecurity/pins; diff PASS. Full successful CI includes all repository browser/API/LINE/security suites with simulated providers.
- Code fixes: await shared initial Redis connect; authenticated reserved Postmark verification no-op; Python-B wrappers. No package/dependency/schema/business-price change.
- Stripe test acct_1UEk5IRvebw5L0s3, six paid/six zero prices, exact price/product/policy/portal validators passed. Card charges active; payoutsdisabled. Portalbpc_1UGBvdRvebw5L0s3qCKXmqO6 and webhookwe_1UGByzRvebw5L0s3xN2z7GNH configured. VAToff, Enterprise/receipt-only sales absent.
- Seven UAT secrets/canonical baseline configured via non-root IAM; no root/IAM/Production change. UAT hosts13.212.80.73 and13.213.14.149 remain enrolled.
- Local read-only acceptance script first had SQL quoting syntax error (before execution); retained, corrected and syntaxchecked before successful proof. See report for all earlier failure records.

Next:
- This report batch changes documentation only; final report PR/merge identities belong in the private handoff evidence. Do not rerun source CI or redeploy for docs.
- Hand off current blockers clearly. When genuine Admin/approver sessions are available, continue native policy/Checkout acceptance through reviewed application controls.
- Browser2/Chrome Developer: uatAdminTab325831760 and uatBillingTab325831763 markedhandoff. UATemail325831761 showslegacyoptinrecovery. Postmarkverification25832029 done; research/OTPtemporary tabs need not survive. No active deployment process.
