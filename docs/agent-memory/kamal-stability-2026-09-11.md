# Agent Memory: Kamal stability closure

Status: COMPLETE for the latest owner scope: consolidated proof plus two successful UAT smoke deployments.
Owner: release owner / Codex
Scope: close repeatability gaps and prove two complete latest-main UAT deployments without login/logout. Production untouched; dev stopped. The former live rollback/restore sequence was superseded.
Decisions:
- Owner explicitly says close all three gaps, wants stable deploy without37minute repair overhead. Admin merge authorized earlier; no repeat approval request for scoped PR after checks.
- Isolated worktree .env.kamal/uat/stability-source, branch codex/kamal-stability-20260911, base main863e0d02. Main contains PR545 changes since deployed12025691; migration/config catalog diff is empty.
- Existing UAT operation20260911T143807Z-9ac5610f accepted with recovery, locks released; this remains historical and cannot count as clean proof.
- Cloud/template updates must be reviewed before apply; AWS documents EBS UserData update restarts instances. Preserve volumes/resources/network and re-enroll actual public addresses if changed. Setup clock separate before merge/application clock.
- Real rollback defects found by code inspection before live action: manual browser rejected rollback; default inspection names invented a new version rather than restored version; restore manifest/env files incomplete for common readback. Fix and positively exercise the entire rollback method locally first.
Artifacts: docs/plans/kamal-stability-2026-09-11.md; prior evidence under docs/qa/evidence/kamal-uat-real-2026-09-11/ in original workspace.
Verification: nonroot mangmee-kamal-uat identity passes; no queued/running release found; target real UAT, no active lock file, owner manual browser ID enrolled, no stored admin credentials.
Next: no remaining work for the authorized two-run UAT proof. No Production deployment or further live rollback is authorized by this proof.


## Final outcome (authoritative; checkpoints below are historical)

- PR552 merged main `6b95e50555c9905aa32d17d1372241bb4889cc1b`; exact PR-head CI34623709238 passed.
- `20260911T170623Z-c8d84820`: all phases passed, KMS verified, no repair/retry; merge-to-exit254.835608s =4m14.836s.
- `20260911T171058Z-8c83ebfc`: all phases passed, KMS verified, no repair/retry; repeat command261.190664s plus prechecks4.595408s, complete clock265.786046s =4m25.786s.
- Both serve exact main6b95e505, with all managed env111/56/19 plus image/native env validated, API/DB/AI/workers/Redis/internal-API readiness and public OPEN passed. Login/logout explicitly not required; LINE journeys deferred. AgentCore qualifier `kamal_uat_b`, version4, exact source/artifact; second run reuses the exact provider.
- No active operation locks remain. Dev `i-0883f1ff88440ca07` freshly verified stopped; Production cloud/runtime unchanged. No UAT/READY/Production workflow was dispatched (Kamal operation IDs above).
- Report: `docs/research/kamal-uat-stable-hotfix-proof-2026-09-11.md`; sanitized summaries and original KMS-signed payloads/signatures: `docs/qa/evidence/kamal-stability-2026-09-11/`.
- Accepted SHA256: first `62ab943c84c5daa98abe36fae50a5403d7724ec1936b26892c9a31b465d42314`, repeat `53df8c813aa4fd90713b6df8c5a390d642d868c4ee31fa90648ce8ae4a9b01ab`.
- Fixed worker readiness delay7s is included. Other durations vary; both use warm cache. No guarantee of identical future timings, cold-cache behavior, full business journeys, fresh-OS bootstrap or new live rollback is implied.

Consolidated local checkpoint:
- Controller tests15pass; rollback/bootstrap tests2pass (normal restore plus stale-image and incomplete-browser rejection); inventory3positive/28negative controls pass; actual supervisor2checks pass. Existing required production-image-security suite passes; maintenance pins synchronized only for scoped shutdown source and validated45files. New CI step runs these offline contracts.
- Actual CloudShell current UAT template canonicalSHA61b387f04b1a8c39186579b62341a3174b707186f2d10a24e8bff9cf7244c5c8 matches retained original. Owner Console reportsroot principal for infrastructure setup; regular deployment remains nonroot mangmee-kamal-uat. No app release executed via root.
- Corrected bootstrap-host.sh SHA980446c578ec2a7930267974e99c4dde9a1139ea8886f0d1d8ab66864f384f77; patcher e569a4c725821d7688f43f3331745e383c6bbc26e7f60b7f530e92c7759e7635; both transported to CloudShell and exactly verified. New private template SHA7b5904a9b9ffe7d52a714f37241433dabb4ee132dd85030c4163a1bff96412f0 matches local output; both new userdata SHA bd36981e7e4e3d37fcc342d518ca48f15dd4f08e1905f09574a1328384fd0cb9.
- Change set stable-bootstrap-v2-20260911/2310447c-131e-47c2-9d2b-06efb5dccd6a CREATED but NOT executed at this checkpoint. Inspect exact2UserData-onlyModify, noReplacement/IAM/network changes before execution. CloudShell files retained ~/kamal-uat-stability/.
- Initial local inventory test invocation lacked its required artifact argument; corrected standalone synthetic CI inventory and28negative cases pass. Initial rollbacktestfixture lacked aws_prefix; fixed fixture before testpass. Native rollback --help without config failed; testing with actual generated config instead. These are local preparation checks, not deployment failures.

Live preparation checkpoint15:56Z:
- PR551 head b73284c365909ff0fee7f25b94e098f9825a441f, CI34618421913 in progress. TypeScript and new rollback/bootstrap tests already passed. Main still863e0d02.
- CFN reviewed exacttwoUserData changes, Conditional replacement; bothactualrootdevicesEBS. Executed ONCE15:47:18.127524Z; UPDATE_COMPLETE15:48:07.379Z,49.251476s. Actualtemplateequalsreviewedprivatev2. No resource replacement/IAM/network change. NewpublicIPs API52.77.223.9 and AI47.129.248.19; originalinstanceIDs/privateIPs/hostkeys retained. target.json re-enrolled againstactualAWS andoriginalSSHhostkeys, oldtargetbackedupprivately.
- Read-onlybaseline operation20260911T155433Z-2e90e0bd passed all3 exactoriginalcontainerIDs/image/fullenv, proxyroute, DB/API/AIhealth afterrestart; source12025691 unchanged. Bootstrap schema passed actualcloud-init onbothhosts; freshOSbootstrap has notbeenrun.
- Rollback preserves originalKAMAL_HOSTmetadata evenwhenSSHpublicaddresschanged; focusedtest passes. Sessionobserver generalized privately for exactoperation/sourceclock/newtarget; no password/token fields.
- UAT_RUN_ID/READY_RUN_ID/PROD_RUN_ID=notdispatched (localKamaloperation follows owner-authorized alternative); no newapplicationdeployyet. Dev remains stopped, Production untouched.

Clean update started:
- CI34618421913 succeeded on b73284c365909ff0fee7f25b94e098f9825a441f; no concurrent queued/running workflows. PR551 admin-merged16:06:51Z, mainca50f0a6ed73e52beacf2f89c09c5c4808522f91.
- Single operation20260911T160653Z-45db64e5 invoked16:06:53.025229Z by exact committed controller; live execsession5174 must be monitored, never dispatch another release. Original timing ledger .env.kamal/uat/stability-audit/update-invocation.json.
- Await owner browser acceptance only after websiteReady, then sameprocess readback/retirement/KMS signature. Rollback and restore remain pending.

Clean update awaiting owner browser acceptance:
- Operation20260911T160653Z-45db64e5 passed all preflight/build/typecheck/fullconfig/publish/freshness/provider/migration/authority/rollout/readbacks without error or repair. WebsiteReady16:14:47.279169Z,473.656s from controller start. This is PARTIAL, not total acceptance. Exactmainca50f0a6 all3containers/config/proxy/deephealth pass; providerkamal_uat_a version3, previousb/version2retained.
- TypeScript56.557s overlapsAPIbuild135.905s; aggregatebuild258.153s. Toolsbase export98.112s recompiles because localPrismageneration adds ignoredsource files to Docker context (19.68MB first vs58.93MBsecond). All commands exit0; no ad-hoc correction. Treat as remaining build optimization, not a fixed constant.
- CustomerOPEN/publicloginHTTP200 passed; originalprocess5174 continues waiting. Asyncownerlogin question sent for this operation; no newownerlogin observed16:15:28.829Z. Do not invent acceptance, reset password, launch rollback or restartdeploy before this sameoperationterminal.
- Manualobserver .env.kamal/uat/stability-audit/observe-admin-session.py takes OPERATION_ID LABEL. Evidence request in run/browser-acceptance-request.json; fill only after actualadminUI/identity/permissions/logout/rejectedroute observations, using boundoperation/source/release.

Clean update COMPLETE:
- Operation20260911T160653Z-45db64e5 exit0 ACCEPTED_LINE_DEFERRED; KMS ECDSA_SHA_256 verified, allphasespass, no deployment recovery/retry. Outer invocation781.938292s =13m1.938s; merge16:06:51Z→exit16:19:54.965841Z =783.965841s =13m3.966s. Browserstage290.870s includesownerwait andoperatorwork, notonlyhumanwait. Websitepartial473.656s isNOTfulltotal. Ten-minuteend-to-endgoal NOTmetthisrun.
- Newowner sessioncreated16:17:14.556Z, actualUIadminOPEN/partnersreadpass, actuallogoutrevoked16:18:26.594Z, subsequentadminnavigationredirectedlogin. DirectauthHTTPcodesnotcaptured; signedoperatorbrowserattestationwithretainedDB/session/UIevidence.
- Oldall3containers/images/fullenv retained andstopped; rollbackreadinessproof .env.kamal/uat/stability-audit/rollback-ready.json. Nextoneexplicitrollbackthenrestore; noappcode/configeditsbetweenruns.

LATEST OWNER STEERING / failure closure:
- User explicitly authorizes full consolidated rehearsal, fix all findings together, then ONE successful deployment and latest-main deployment again. No more live rollback sequence is required. Login/logout no longer required for UAT proof; complete config and all-service readiness required.
- Rollback20260911T162022Z-09c1f20e FAILED_RECONCILIATION_REQUIRED in12.968s(controller)/13.058841s(outer), before any provider/DB/native rollout. Error docker notfound. Actual cause confirmed: fake rendering replaces inherited app PATH with synthetic-PATH; passing real app PATH also removes Kamal Ruby bin. Shared prefixed environment transport is the correct fix. Runtime not changed; failed local/remote operation locks still held and must be read-only reconciled, not blindly deleted.
- New branch codex/kamal-runtime-env-stability-20260911 from mergedmainca50f0a6; only isolated worktree. Current uncommitted changes: shared KAMAL_APP_ environment aliases, explicit --uat-smoke-acceptance, worker HTTP readiness, terminal failed browser status; .dockerignore excludes apps/api/src/generated/prisma. These are not yet tested/committed. Existing dirty memory/cloud docs retained. No second PR yet.
- CUA session reset; Chrome browser ID now1(profilemangmeeplus.com), ownerUatTab325829960 loggedout atlogin?next=/system/platform-access. OldAWS handle lost but tab325829937 still exists. No pending loginquestion.
- Next: finish focused tests and actual complete rehearsal / sibling boundary audit, reconcile old locks after unchanged-runtime proof, review/CI/adminmerge scopedfix, then exactlytwo UATsmoke deployments with full clocks. Production untouched anddevstopped.

## Consolidated rehearsal checkpoint 16:35 UTC

- Operation `20260911T163445Z-9fa39adf`: all 20 actual boundary checks passed. Both normal and complete rollback environment passed real Kamal config and SSH app-details commands on all three services.
- Real current UAT image/source/full environment/proxy, AgentCore pinned artifact/version, database catalog, feature authority, API/AI readiness and worker Redis PING/internal-API readiness passed. New public OPEN/config/readiness smoke and KMS sign/verify passed. The signed state explicitly says `REHEARSAL_ONLY_NOT_DEPLOYED`.
- This rehearsal did not replay live provider/DB/rollout/retirement mutations. Their unchanged implementation has retained successful operation `20260911T160653Z-45db64e5`; full pipeline failure contracts cover ordering and fail-closed results. A fresh candidate build/config rehearsal remains before live deployment.
- `release_test.py`: 15 passed; `stability_test.py`: 4 passed; maintenance pin check passed. Failed rollback remains retained and its exact owned locks require reconciliation before the next release.

## Candidate rehearsal findings and reconciliation

- Candidate probe `97755012` passed TypeScript and all image build commands, but the tools-base export still took114.776s: excluding only the Prisma leaf leaves its newly created parent directory in Docker context. Exclude the whole untracked `apps/api/src/generated` directory; the Dockerfile creates the client itself and no tracked application file is removed. The probe checkout was then modified for cache diagnosis; it is not the final clean-source evidence and is not eligible for deployment.
- Exact failed rollback reconciliation `20260911T164232Z-d7577358` verified the original accepted KMS signature and unchanged live container IDs/full config/readiness/provider/public OPEN, then released only the local and remote locks owned by `20260911T162022Z-09c1f20e`. Original failure artifacts remain unchanged. An earlier read-only reconciliation helper lacked host metadata and stopped before lock release; the corrected helper completed. No runtime mutation occurred.
- PR552 CI34623365363 checks head97755012. The final generated-directory correction requires its own exact-head CI and clean build before merging or deploying.

## Final pre-merge proof checkpoint

- Final reviewed head: `7b799784d9eaad222c5515c8d6d7ffa4ee886f7c`, PR552, exact-head CI `34623709238` still running. Superseded head97755012 CI34623365363 was automatically cancelled when the final cache correction was pushed; no duplicate deployment was dispatched.
- Clean-source full build passed76.406s: TypeScript52.387s and every image/AgentCore/tool artifact succeeded; export-tools-base is now cached0.861s. This is a warm build rehearsal, not deployment time.
- Actual artifact rehearsal `20260911T164559Z-dbe02852` passed all5 checks: target, fresh AWS secrets/full candidate config, actual native config, freshness, real ECR publication/digest/RootFS verification and host pulls. It performed no live provider/DB/route/container rollout.
- Config inventory covers4838 tracked source files,189 migration files,35 sync/catalog files, and API111/AI56/workers19 environment keys. Values remain private.
- Consolidated matrix `.env.kamal/uat/stability-audit/consolidated-proof.json` combines actual20-boundary runtime rehearsal, fresh full build, actual5-boundary artifact rehearsal, local positive/negative contracts, and eight AST-extracted mutation methods proven byte-identical to signed successful operation20260911T160653Z-45db64e5. Prior successful live mutations are retained evidence, not mislabeled as replayed.
- New one-shot harness `.env.kamal/uat/stability-audit/run-smoke-proof.py` will admin merge only after exact CI passes, then run `smoke-first`; `smoke-repeat` requires that first signed acceptance. Both use `--uat-smoke-acceptance`, count through process exit, and never retry automatically.

## Live smoke proof execution

- CI34623709238 passed every executed required job for exact head7b799784. PR552 admin merged17:06:21Z to main`6b95e50555c9905aa32d17d1372241bb4889cc1b`.
- Before merge the one-shot queue precheck encountered the exact historical GitHub metadata ghost31611733340 (created/updated2026-08-12, source33ed788c, checkSuite85752682208). Cancel reports completed; jobs/check-runs/pending-deployments are all zero. The documented classification in release-receipt-signup-2026-09-07.md was reverified; only that exact identity is excluded, without deleting or rerunning it. Preparation failure is retained in `smoke-first-preparation-blocked.json`; there was no merge or deployment before reconciliation.
- First actual deployment operation`20260911T170623Z-c8d84820`, invocation17:06:23.045251Z, source exactmain6b95e505. Capture full merge-to-process-exit time. UAT/READY/Production workflow run IDs are N/A for this local Kamal UAT release; no new GitHub deployment workflow or Production cloud mutation.
