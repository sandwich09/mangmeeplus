# Single-admin Billing — UAT release and native acceptance, 2026-09-16

Status: **Code merged to develop/main, deployed to UAT, signed result verified and customer OPEN. Sandbox policy published through the genuine Admin UI; published Stripe configuration check passed. Native paid purchase awaits a genuine company-owner login.**

The owner authorized single-admin confirmation in both environments, deployment only to UAT, and admin merge after successful CI. This release preserves current-password proof, impact preview, explicit submit/confirm, exact permissions, current actor/credential checks, idempotency and audit. No synthetic approver, role elevation, new dependency or migration was introduced. Scoped delegates still need an independent reviewer. Production was not deployed or reconfigured.

## Source and CI

- Reviewed source `70168b9187e7ef747e27219781310411b854a3d4`; tree `2b7e5693862dd7306021c2979a08bf0dc989e537`.
- [PR595](https://github.com/MangmeeDev/mangmeeplus/pull/595), [full CI35080266183](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35080266183), **SUCCESS**. Started 09:35:19 UTC, completed 10:36:31 UTC; **1h1m12s**. Only one full source CI was dispatched.
- All actual validation jobs passed: Resolve Source, Production Config Validation, Security Audit, Migration Review, Secret Scan, Typecheck and Test. Image publication jobs were legitimately skipped for the PR.
- Full billing HTTP acceptance passed **257 groups**; that step took 20m29s. All configured CI browser suites passed, including single-admin configuration/schedules, cohorts, invoice discovery/import, LINE simulation, support and receipt/adjustment privileges. These are simulated-provider checks, not native Stripe payment evidence.
- Authorized admin merge to develop at 10:37:30 UTC: `7ccff81178e547817d5d21571aa88ee2dde94628`. Main was normally fast-forwarded to the same merge after exact tree and ancestry checks. The merge tree equals the tested PR tree. GitHub reported the PR-only rule bypass; no force push or protection change was used.
- Documentation follow-up does not alter those application bytes and does not require another full source CI or deployment.

## Deployment and timing

Operation **`20260916T103914Z-350853d8`**, serving source/controller **`7ccff81178e547817d5d21571aa88ee2dde94628`**, Kamal hotfix with the retained owner-authorized UAT readiness acceptance.

- Started 10:39:14.753131 UTC; signed payload completed 10:46:36.115525 UTC.
- Complete command **443.532 seconds — 7m23.532s**. This excludes preceding implementation, CI, read-only preparation and later native billing acceptance.
- Terminal `ACCEPTED_LINE_DEFERRED`; all 11 phases passed. KMS `ECDSA_SHA_256` verification passed.
- `accepted.json` SHA256: `c2f522fbe4c0064f895d4b8db544af5dce338eb50db1b4eb11fa10efcd8eb195`.
- Fresh unauthenticated public readback returned `OPEN`. API/database, AI Gateway, workers/Redis/internal API and exact source/config readback passed.
- The full **219-migration** ledger and feature authority matched source; **0 new and 0 pending migrations** for this hotfix. The earlier normal deployment applied 31 migrations; that evidence remains in the [initial release report](uat-main-readiness-2026-09-16.md).
- AgentCore `kamal_uat_b`, version 10, artifact SHA256 `6566413ae0e465f79f309aa7ad1cb2e29dfe1e059be9e9d7f40c86cbded4cfe9`.
- `UAT_RUN_ID`, `READY_RUN_ID`, `PROD_RUN_ID`: **N/A**, because this is the authorized local Kamal operation, not a release workflow dispatch. No Production promotion or READY claim.

| Phase | Seconds | Result |
|---|---:|---|
| target-preflight | 11.386 | PASSED |
| main-typescript-build | 177.886 | PASSED |
| fresh-config-and-image-validation | 15.863 | PASSED |
| publish-and-pull | 43.291 | PASSED |
| config-freshness-before-mutation | 4.694 | PASSED |
| provider-preparation | 15.155 | PASSED |
| database-and-feature-authority | 57.374 | PASSED |
| native-rollout-and-readback | 97.210 | PASSED |
| customer-acceptance | 8.313 | PASSED |
| retire-observed-builds | 9.539 | PASSED |
| receipt-signature | 1.324 | PASSED |

Exact runtime image IDs, environment hashes, readiness and phase clocks are in the [machine-readable evidence](billing-single-admin-2026-09-16.json). Private signed artifacts and controller logs remain under `.env.kamal/uat/runs/20260916T103914Z-350853d8/`; credentials are not published.

## Native Admin and Stripe result

The owner logged into Chrome Developer as the genuine current platform Admin, then entered and confirmed the current password. The UI proof was valid through 17:54:42 Bangkok. The agent submitted and explicitly confirmed the already reviewed preview before expiry.

- Source draft `8b376fa9-4553-475a-af71-732cb53db90b`, version 0, retained.
- Applied request `69214c53-9bab-48ed-99fe-c2767421a777`, final request version 2; **active settings version 1**.
- Native UI shows **“การตั้งค่านี้มีผลแล้ว”**, **“ยืนยันโดยผู้ดูแลระบบคนเดียว”**, test mode and a published policy. Submission alone was not treated as activation.
- Impact preview:0 existing members, 0 in-flight payments, 0 unused quotes, 0 pending downgrades, 0 renewal commands.
- New sales, repeat/plan-change purchases, card Portal, app cancellation and notifications enabled for all UAT companies including future signups. VAT off, 7-day grace; refunds and provider Portal plan changes remain off under approved policy.
- Native published configuration check **`0fd91395-5017-475a-ae05-c37315db87b4`** completed at **10:55:10UTC**, settings version 1. Policy, Sandbox account, all 6 paid and 6 prepaid-zero prices, Portal and tax match. The worker completed the original request; no duplicate check was created.

| Package | Monthly / receipts | Annual / receipts | Branches / users |
|---|---|---|---|
| Starter | 249 THB / 30 | 2,490 THB / 360 | 1 / 2 |
| Basic | 499 THB / 50 | 4,990 THB / 600 | 2 / 5 |
| Pro | 999 THB / 100 | 9,990 THB / 1,200 | 5 / 10 |

Stripe account `acct_1UEk5IRvebw5L0s3`, THB, TEST, API `2026-08-26.dahlia`. Full price/Portal IDs and gates are in the [published configuration evidence](uat-billing-configuration-2026-09-16.json). Enterprise and receipt-only sales remain hidden. Stripe Sandbox transactions do not move actual funds; use only its test payment data for native acceptance. [Stripe testing documentation](https://docs.stripe.com/testing).

This is native **configuration and administration** acceptance. It does not prove payment, webhook settlement, entitlement activation, invoice or receipt issuance. No native Checkout/payment/subscription was created in this session.

## Remaining genuine-session boundary

A fresh reload of the original customer billing URL shows that the current **UAT MangmeePlus System Admin** has no membership in **WatchDog UAT**. This is the expected tenant boundary. The owner was asked to log into Chrome Developer with the actual company-owner account to continue Sandbox Checkout → webhook/reconciliation → automatic package/receipt rights → return/history/document. Do not grant membership, impersonate an owner, write billing tables directly or bypass current-password checks to manufacture acceptance.

Real Postmark delivery and its authenticated callback were accepted on the earlier hotfix: message `91c088a1-fde8-4c57-aef3-cdec45a1f648`, delivered 08:10:40 UTC, callback PUBLISHED 08:11:00.258 UTC. This unchanged integration was not sent a new message in this single-admin session. The existing tester still needs explicit passwordless opt-in; native passwordless signup/login is not claimed. [Provider acceptance](uat-provider-native-acceptance-2026-09-16.json).

Live LINE is deferred under the retained owner UAT exception; CI LINE simulation is separate. `mangmee_web` has no enrolled UAT target in this operation, and its Production marketing site and dirty checkout were untouched.

## Retained failures and cleanup

Earlier local broad browser R4 failed at a missing simulated Stripe customer GET after preceding changed service groups passed; the fixture was corrected and the final focused refund browser passed 16 groups. Another broad HTTP attempt exceeded the operator 600s timeout without a reported assertion failure and remains incomplete. Final required CI subsequently passed 257 billing HTTP groups and all configured browser suites. Exact failures, focused checks and log hashes are retained in the machine-readable evidence; no failed attempt was relabelled.

Read-only preflight `20260916T093631Z-a5691f5a` passed 9.815s. The first invocation omitted the existing authorized smoke flag and stopped before an operation directory or cloud action; the corrected invocation used the documented flag, without source or guard changes. The exact historical GitHub jobless queue record 31611733340 was reverified as the known non-executable August 12 metadata shell, not an overlapping deployment; no cancellation or rerun was dispatched.

Only owned disposable local PostgreSQL/Redis containers were removed after validation. Original dirty workspace changes and other containers were preserved. Current task state is in [agent memory](../agent-memory/billing-single-admin-2026-09-16.md).
