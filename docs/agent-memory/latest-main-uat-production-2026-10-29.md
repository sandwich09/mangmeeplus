# Agent Memory: latest main UAT and Production 2026-10-29

Status: COMPLETE — exact latest main is signed and serving on UAT and Production; customer remains `OPEN`.
Owner: Codex
Scope: Release exact `origin/main`/`origin/develop` source `8c112ea70003057fa3063938e859de1b945747d1`, including the unusual expense-document-date discovery correction and all earlier latest-main features, through retained Kamal UAT and signed UAT promotion to Production.
Decisions:
- Use the existing local Kamal normal path with scoped non-root profiles. Workflow `UAT_RUN_ID`, `READY_RUN_ID` and `PROD_RUN_ID` are `NOT_DISPATCHED`; operation IDs below are the release identifiers.
- Candidate has no migration. Focused API 186 and web 130 tests passed before release; `main`, `develop` and the working source matched before UAT prepare/apply and Production preflight/prepare/apply.
- Actual UAT browser acceptance proves `OR670318000742` is discoverable in March 2024 with document date 18 March 2024, intake date 29 October 2026, the retained unusual-date warning and amount 593.85.
- The owner authorized root profile `thawatchai` only for current-release CloudWatch `DescribeAlarms` reads. The owner then explicitly accepted only the unchanged 9 October API security Alarm for this release. No Alarm or customer gate was changed.
- First Production prepare stopped before publication/mutation because API host Docker free space was 3.07 GB. Read-only inspection found old stopped releases and image tags. Cleanup retained the serving and immediately previous rollback releases, removed only older stopped containers/tags, ran the documented image prune, raised free space to 27.89 GB and closed 4/4 SSM sessions. The clean retry then passed with 28.56 GB available against 5.08 GB required.
Open questions:
- None for this release. Production LINE messaging, native LINE/LIFF and external providers were not exercised; this expense-list correction does not change those paths.
Artifacts:
- UAT private runs: `.env.kamal/uat/runs/20261028T174950Z-572dc7d0/`, `20261028T175021Z-c4d1e2b3/`, `20261028T175531Z-b3c61d8a/`.
- Production private runs: `.env.kamal/production/runs/20261028T180126Z-cb71a35d/`, retained failed prepare `20261028T180203Z-17f9f69c/`, successful prepare `20261028T180652Z-51394b31/`, and accepted apply `20261028T180841Z-982f399a/`.
Verification:
- UAT preflight `20261028T174950Z-572dc7d0`: `PREFLIGHT_PASSED_NO_DEPLOYMENT`, 12.410 seconds. Prepare/publish `20261028T175021Z-c4d1e2b3`: `PREPARED_NO_DEPLOYMENT`, 288.546 seconds.
- UAT apply `20261028T175531Z-b3c61d8a`: signed/verified `ACCEPTED_LINE_DEFERRED`, 277.510 seconds; all 12 phases, deep API/DB/AI/worker/Redis/internal-API readiness, public `OPEN`, retirement 19/19 and SSM cleanup 2/2 passed. Result/accepted/signature SHA-256: `622d915b3aa3de99dc9bbb94b59bf6f44a4e7021ee946e376f763de8953ffe9e`, `cfb2483f08ea2f1547381f71d8dec80ac7a228c3392c5f686225778fbd49e76b`, `35c035b6e1502ea7ec9def0bd7a9ef2f988747341ad5db53554436a3cbd19182`.
- Production preflight `20261028T180126Z-cb71a35d`: `PREFLIGHT_PASSED_NO_DEPLOYMENT`, 17.740 seconds. Failed prepare `20261028T180203Z-17f9f69c`: `FAILED` at `host-storage-capacity` before publication/mutation, 39.677 seconds; root cause and cleanup are recorded above. Successful prepare `20261028T180652Z-51394b31`: `PREPARED_NO_DEPLOYMENT`, 48.813 seconds.
- Production apply `20261028T180841Z-982f399a`: signed/verified `ACCEPTED_LINE_DEFERRED`, 445.030 seconds; website ready at 269.769 seconds and browser acceptance took 148.437 seconds. All 12 phases, exact runtime readback on four hosts, deep readiness, customer `live`/`OPEN`, current administrator identity/permission, no password/legal action, authenticated read, logout, post-logout 401, retirement 19/19 and SSM cleanup 4/4 passed.
- The Production runtime matches every immutable image digest in UAT's signed `promotionBundle`; source is exact and AgentCore SHA-256 is `e4b155d85b34631993460fdb0433ee36fc894a92b3148da1b7fadacf5cecc8c6`. No Production rebuild occurred.
- Production result/accepted/signature SHA-256: `eb8bb9c14b2303b39d496cde2f253ca337a7c854562a08b90152379134aa02a4`, `af1e5f4f22a9fb1888de54714fb05f18921dc9a0e327f678a282a56532101dd4`, `fa97543c4a17101104aa06e993753b13f7761c9a0fbc7182cd980f868e483c33`.
- Fresh pre/post Alarm reads: 29 `OK`, zero `INSUFFICIENT_DATA`, and only `watchdog-bms-prod-_ecs_watchdog_bms_prod_api_web-security` remains `ALARM` with the identical 9 October 2026 transition time and reason. Public API health, login 200 and public platform access `OPEN` pass after release.
Next:
- No release action remains. UAT stays running. A later docs-only ledger commit does not change runtime bytes and does not require redeployment.
