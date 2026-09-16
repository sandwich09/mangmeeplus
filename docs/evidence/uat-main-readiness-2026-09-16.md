# UAT main release — 2026-09-16

Status: **DEPLOYED, signed result verified, customer OPEN. Native Postmark delivery/callback accepted. Stripe Sandbox catalog prepared; application sales are NOT activated.**

The owner authorized all main application changes on UAT, migrations, complete payment/email preparation and measured timing. UAT uses Stripe Sandbox. Real email testing uses the dedicated Postmark Live UAT server and an exact recipient allowlist. This task did not deploy Production or change its provider credentials.

## Serving release and source delivery

- Serving application/controller: `ee2f55421dde0edc0fb7226aadea66c3cc52b2d0` on API/web, AI Gateway and workers.
- Hotfix operation: `20260916T080218Z-b9eb3d90`, started 2026-09-16T08:02:18.614161+00:00, finished 2026-09-16T08:08:54.787838+00:00.
- Terminal: `ACCEPTED_LINE_DEFERRED`, **396.159 seconds (6m36.159s)**. All 11 phases passed, including API/DB/AI/workers/Redis/internal API readiness, full config readback, customer OPEN and retirement.
- KMS ECDSA_SHA_256 signature verified. `accepted.json` SHA256: `d444d6c0f70ae942391a9837fb30afc171fa5e1dbd126042e5621db9a25ff7a6`.
- AgentCore: `kamal_uat_a`, version 9; previous qualifier `kamal_uat_b`.
- UAT/READY/Production workflow IDs: N/A. These are local Kamal operation IDs; Production workflows were not dispatched.
- PR [591](https://github.com/MangmeeDev/mangmeeplus/pull/591) merged into develop at 08:01:07 UTC, `db47a2ca1b2fdb004dd1c50b9ce6429f849b5698`; PR [592](https://github.com/MangmeeDev/mangmeeplus/pull/592) merged into main at 08:01:17 UTC, `ee2f55421dde0edc0fb7226aadea66c3cc52b2d0`.
- Both PRs have the identical tested head `56aba2c60fc5b05b0194f6b519657da0e87fee9f`. Fresh merge trees for both targets exactly match candidate tree `0c2b88678d4d533a57434a3870af01512035b06c`.
- Full [CI 35066936157](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35066936157) passed all actual validation jobs on that exact head: Typecheck and Test, Security Audit, Secret Scan, Migration Review, Production Config Validation and Resolve Source. Publication/image jobs were intentionally skipped. This exact-commit CI is shared validation for both PRs; see the retained duplicate failure below.

Actual runtime image IDs:

- api-web: `sha256:36853b0d3d5e1717e3f0233264a8728f0c3eb6f86811ca79a60be42c909c9e7c`
- ai-gateway: `sha256:ea92dabae6b7a6d2961bdcd7290356cac22b5d2bf7394e1f89467e6be4b6b2e2`
- workers: `sha256:122f903977873386c63e55108b336ad7ca8e3e71a161bf79535f7fc60777582e`

## Timing and migrations

| Stage | Duration | Outcome |
|---|---:|---|
| Initial preparation, 05:37:09 → 06:18:22 UTC | 41m13.462s | Provider/secret setup, native validation and canonical ECS baseline convergence |
| First normal operation `20260916T061822Z-7342e27f` | 18m49.612s | Failed before image publication, provider/DB/runtime mutation |
| Failure reconciliation before retry | 4m12.903s | Original evidence retained; exact source and controls unchanged |
| Corrected normal operation `20260916T064124Z-125e1228` | 5m25.455s | Signed/OPEN; 31 migrations applied |
| Full successful hotfix CI, 07:07:15 → 07:59:04 UTC | 51m49s | Full validation on the exact commit, concurrent with the failed duplicate |
| Hotfix operation `20260916T080218Z-b9eb3d90` | 6m36.159s | Signed/OPEN; no pending migration |

Preparation, local fixes, CI and native acceptance are additional elapsed time, not part of the deployment command duration. The normal retry reused already-built source/cache; its build took 56.355s. The changed-source hotfix build took 135.848s. These are different cache/source conditions, not a claim that migrations are faster than hotfix deployment.

Before the normal deployment the actual ledger had 188 completed and 31 pending migrations, with no checksum/unknown/unresolved drift. Hotfix mode refuses pending migrations, so that release correctly used normal mode. All 31 applied and the actual post-deploy PostgreSQL ledger matched all **219** source migration names/checksums with zero pending. The later hotfix verified the same catalog and feature/sync authority without adding migrations. Its database/sync phase took 63.742s.

Hotfix phases:

| Phase | Seconds | Result |
|---|---:|---|
| target-preflight | 10.997 | PASSED |
| main-typescript-build | 135.848 | PASSED |
| fresh-config-and-image-validation | 13.550 | PASSED |
| publish-and-pull | 42.559 | PASSED |
| config-freshness-before-mutation | 4.212 | PASSED |
| provider-preparation | 14.645 | PASSED |
| database-and-feature-authority | 63.742 | PASSED |
| native-rollout-and-readback | 90.341 | PASSED |
| customer-acceptance | 7.926 | PASSED |
| retire-observed-builds | 9.623 | PASSED |
| receipt-signature | 1.156 | PASSED |

## Provider configuration and actual acceptance

### Stripe Sandbox

Account `acct_1UEk5IRvebw5L0s3`, THB, test credentials, API `2026-08-26.dahlia`. Three readable UAT products and six paid recurring prices cover Starter 249/2,490, Basic 499/4,990 and Pro 999/9,990 THB, month/year. Six zero recurring prices share the same products for prepaid scheduling. Main policy/price/product/portal validators passed at preparation. VAT is OFF. No Enterprise or receipt-only offer was created; the older diagnostic product remains untouched and unmapped.

Portal `bpc_1UGBvdRvebw5L0s3qCKXmqO6` permits card updates and invoice history; provider-side plan changes, cancellation and customer email editing stay disabled because application rules own those actions. Webhook `we_1UGByzRvebw5L0s3xN2z7GNH` targets `https://uat.mangmeeplus.com/v1/public/stripe-events`, is enabled in test mode, and matches the source's 18 events and API version. Native account readback permits charges/card payments; payouts remain disabled. This is not a completed payment test.

The complete six-offer [reviewable policy and proposed gates](uat-billing-configuration-2026-09-16.json) are **PREPARED_NOT_PUBLISHED**. The UAT billing UI shows test mode, closed new sales, readable history and a return-to-workspace link. No Checkout, customer, subscription or payment was created by this task. Refunds stay closed pending an approved financial limit.

### Postmark and OTP

Dedicated UAT server **20950027**, Live delivery, `outbound` Transactional stream, sender `developer@mangmeeplus.com`, exact allowed tester recipient, and OTP key version `email-otp-v1-20260915`. Production server 20950034 was not activated or changed by this task. Real UAT email is necessary to test OTP; Stripe Sandbox does not imply Postmark Sandbox.

Existing webhook **25832029** at `https://uat.mangmeeplus.com/v1/public/postmark-events` uses matching Basic Auth and Delivery/Bounce/SpamComplaint, with message-body inclusion off. After the hotfix, the native verify API and provider UI confirm **all three triggers verified, HTTP 200**. The reserved authenticated verification probes produce **zero business outbox events**.

Actual first UI OTP request after the hotfix succeeded. Postmark message `91c088a1-fde8-4c57-aef3-cdec45a1f648` was accepted at 08:10:39.225 UTC and delivered to Gmail's SMTP server at 08:10:40 UTC. The same application's send attempt `af5fb947-9952-4b27-90e7-a21e25e9f65d` has that exact `deliveredAt`; its real callback outbox event is PUBLISHED at 08:11:00.258 UTC. This proves app → Postmark → recipient server → authenticated callback → durable application record. It does not prove inbox-versus-spam placement.

The actual emailed code was entered in the browser after the hotfix. The existing tester account has not opted into passwordless login, so the app correctly returns `LEGACY_LOGIN_REQUIRED` with login/reset routes. No successful passwordless login, new account or company creation is claimed. Existing-account opt-in was not bypassed. Code/body/credentials are not published.

A new rate-limit service instance inside the actual serving image accepts its first request without local degradation and rejects the second request at a one-request limit. This uses an isolated random 10-second key; live customer counters are untouched.

Machine-readable safe proof: [native UAT acceptance](uat-provider-native-acceptance-2026-09-16.json).

## Retained failures and corrections

1. Initial deployment failed after 1,129.612s at the clean-source guard: importing Postmark config created untracked Python bytecode. No tracked source changed, and the failure preceded publication/AgentCore/DB/runtime mutation. Only generated cache was moved into private reconciliation evidence. Corrected retry used `PYTHONDONTWRITEBYTECODE=1`; both wrappers now also execute Python `-B`. The source-cleanliness check remains enforced. Original Docker Desktop credential-helper metadata steps took about 122s each; a private Docker config using existing plugins/socket resolved the exact pinned public image in 2.243s. Shared Docker settings were unchanged.
2. Initial native webhook verification returned 400 environment mismatch because Postmark sends reserved sample identities (Delivery server23, Bounce/Spam server1234, zero MessageID, john@example.com/outbound). The receiver now authenticates/parses and acknowledges only that observed shape without enqueueing delivery or suppression. Real server/stream/attempt fences remain. Initial provider creation against the old missing route persisted nothing; actual API required `?verify=false` despite accepting a body field syntactically. The corrected create produced one endpoint, and final verification reused it.
3. First native OTP request returned503 because lazy Redis with offline queue disabled received a command before connection readiness. Shared initial connection waiting fixes consume/inspect/consumeOnce/lease without enabling an offline queue or relaxing fail-closed controls. Local and serving-image proofs passed.
4. Duplicate [CI35066933135](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35066933135) failed at 07:52:56 UTC on one Next dev invoice-scan detail navigation returning404. The identical full step passed in successful CI35066936157 on the **same commit**. Two local exact-source browser replays, fresh then retained dev cache, each passed all8 groups. The root cause remains unestablished; this is not a claimed product fix. GitHub's same-name PR check rollup selected the failed duplicate even though the complete other workflow passed. Merges rely on the actual complete successful workflow and exact merge-tree evidence; no failed check was relabelled, test weakened, source changed or CI rerun dispatched.
5. Local diagnostic failures were retained separately: missing built config dependency before HTTP smoke; wrong Production wrapper default in the new fixture; omitted AgentCore artifact path in initial reconciliation harness; malformed SQL quoting in the first read-only native acceptance script. Each was corrected and its check passed. The last script failed at JavaScript parsing before executing Redis/DB actions. None was a new deployment attempt.

Focused local evidence: API build/typecheck; Redis/Postmark units39/39; real Redis cold concurrency/budget/inspect/idempotency/lease; fresh PostgreSQL18.3 migrations; real Nest/PostgreSQL Postmark HTTP8 groups; Postmark delivery DB13/13; Kamal28/28 including executable wrapper/no-bytecode checks; production image security/pin checks; diff check. Test containers were removed; generated Next guidance files were preserved privately and next-env restored.

## Remaining owner-dependent activation

The current Chrome Developer UAT account is company-owner only; `/system/platform-access` displays no platform-admin access. No enrolled UAT acceptance credential or runtime admin credential is available. Initial billing policy/gates require the existing native Admin preview, current-password reauthentication and a **distinct authorized approver** (`BillingConfigurationService.approve`). The owner has already authorized setup; the missing requirement is authenticated actors, not another product-policy decision. Do not invent users, elevate roles, directly write billing policy/permission tables, or fake independent approval.

Owner follow-up: only one human operator is available. The current runtime still requires a distinct approver; a product amendment for single-operator control is being scoped separately (UAT only versus code support for both environments, still no Production deployment). Do not create a second identity to imitate independent approval.

After an authorized Admin session and the agreed approval flow are available: submit the prepared policy through Admin, approve, then prove actual Sandbox Checkout → callback/reconciliation → automatic paid rights/receipt balance → return/history/document. Existing-account passwordless testing additionally requires its owner to opt in through the existing security flow. Live LINE acceptance remains deferred under the UAT smoke exception. No native paid end-to-end or all-flow completion is claimed.

`mangmee_web` has no enrolled UAT deployment target/workflow in this task. Its original dirty checkout and Production marketing origin were preserved. It was not deployed by this core Kamal release.

Private evidence is in ignored `.env.kamal/uat/prep-20260916/` and the three exact operation directories. Seven UAT provider secrets were provisioned/read back using existing non-root profiles; no IAM/root change. The parked canonical ECS API baseline retained scaling0/0 and all unrelated fields, adding only Stripe test config; its final single-config semantic readback preceded deployment. Secrets remain private0600 and are never included in this report. The subsequent documentation-only report commit does not change the serving application bytes and does not require another deployment.
