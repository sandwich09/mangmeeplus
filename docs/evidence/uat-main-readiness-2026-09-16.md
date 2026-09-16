# UAT main release — 2026-09-16

Status: **DEPLOYED — `20260916T064124Z-125e1228`, signed and customer OPEN**. Native acceptance found two defects; a scoped hotfix is in local verification. Payment activation still needs authorized Admin approval.

The owner authorized latest main on UAT, migrations, usable payment/email configuration and timing. They confirmed Stripe Sandbox on UAT and real Stripe on Production, then instructed proceeding with the proposed setup. No Production deployment is authorized by this release.

## Source, deployment and clock

- Main/controller: `8c277dea4504b18e9537243ade031770d78ead4e`, fresh immediately before apply. PR588 CI35055705698 passed actual Typecheck/Test plus required checks; no new CI was dispatched for this release.
- Previous serving source: `5b2fd63bf82a2917bb47dd0c9a75e2d50edf324c`, Kamal operation20260914T192255Z-e036fe7a. Prior public health/login/signup200 and customer OPEN were read back; they are not proof of the new release.
- Preparation/request clock:05:37:09UTC. Actual deploy started06:18:22.462065UTC: preparation41m13.462s, including provider setup, access/error reconciliation and cloud config convergence. Report separately from deployment duration.
- One command: `infra/kamal/deploy-uat --profile mangmee-kamal-uat --mode normal --apply --uat-smoke-acceptance`. All build artifacts come from clean pinned main.
- Actual DB before apply:188 completed and31 pending migrations, no checksum/unknown/unresolved drift. All31 pass the existing static safety predicate; normal mode applies and verifies them. Hotfix explicitly refuses pending migrations, so this is **not** a migration-free hotfix benchmark.
- Before apply no active Kamal operation or in-progress GitHub release. Queued31611733340 is the unchanged August12 zero-job metadata ghost, already classified in prior release evidence. No duplicate run or cancellation.
- UAT/READY/Production workflow IDs: N/A, local Kamal UAT only. Signed Kamal result recorded below; no Production workflow was dispatched.

## Provider and secret setup

Existing authorized non-root IAM user `watchdog-bedrock-dev` provisioned seven environment-specific Secrets Manager values; `mangmee-kamal-uat` read each AWSCURRENT value back exactly. No root, IAM or access policy changes. Optional tagging was denied (`TagResource`), with no partial secret, so the corrected creation omitted optional tags; ARN/name identity guards remain intact. Initial deployment-role CreateSecret denial is retained. All credentials remain private0600, never tracked or printed.

Canonical Postmark secrets use `watchdog-bms/uat/postmark/`: POSTMARK_SERVER_TOKEN, POSTMARK_WEBHOOK_USERNAME, POSTMARK_WEBHOOK_PASSWORD, EMAIL_OTP_HMAC_KEY, POSTMARK_UAT_ALLOWED_RECIPIENTS. Stripe secret key/signing secret use `watchdog-bms/uat/stripe/`. Current-main native Postmark preflight consumes the actual Secrets Manager values and passes server20950027, Live delivery, outbound Transactional stream, developer sender and OTP versionemail-otp-v1-20260915. UAT mail uses the isolated server and the owner's initial Gmail allowlist for real test delivery; it does not use Production mail server20950034.

Stripe Sandbox account `acct_1UEk5IRvebw5L0s3` was checked through its existing test key. Three products have readable UAT names. Six paid recurring prices cover Starter249/2490, Basic499/4990 and Pro999/9990THB (month/year); six zero recurring prices share their corresponding products for prepaid scheduling. Exact main `assertStripePrice`, `assertStripePortalConfiguration`, policy parsing/readiness and matching-product checks pass. VAT is OFF. The prior diagnostic Pro annual product remains untouched and is not mapped to the customer offer.

Portal `bpc_1UGBvdRvebw5L0s3qCKXmqO6` allows card updates and invoice history; Stripe plan changes/cancellation/customer editing are disabled, consistent with application-owned pack accounting. No Enterprise or receipt-only sale was created.

Stripe webhook `we_1UGByzRvebw5L0s3xN2z7GNH` targets `/v1/public/stripe-events`, is enabled/test, pins API2026-08-26.dahlia and exact18 source events. Native readback and secure signing-secret storage passed. No customer, Checkout, subscription or payment has been created in this preparation.

Postmark webhook25832029 targets `/v1/public/postmark-events` with matching Basic Auth, Delivery/Bounce/SpamComplaint and no full-content inclusion. It is **unverified** until rollout and explicit provider verification. Initial POST attempted verification against the old app and saved nothing. The documented body `Verify:false` was ignored by the actual provider;422/ErrorCode1364 explicitly requested `?verify=false`. A fresh list proved absence before corrected creation; there is one endpoint, no duplicate. Retain both failures. The [Postmark API documentation](https://postmarkapp.com/developer/api/webhooks-api) describes pre-provisioning an unverified webhook and explicit verification after its endpoint is ready; successful creation alone is not delivery proof.

## Authoritative runtime configuration

Parked UAT ECS api-web is the canonical baseline consumed by Kamal. One full9-field roundtrip at06:14:23UTC added BILLING_MODE=test, the Sandbox account ID and two Stripe secret ARNs. All unrelated fields and scaling0/0 were preserved. At06:18:10UTC a single active configuration, no current deployment and exact semantic equality were verified; AWS reordered only the environment array. Revision3061076101182934523/task definition210. No parked ECS workload was started. Kamal separately adds the main-tracked canonical Postmark settings/secret versions.

Application paid sales still require initial versioned policy publication and gates through the existing Admin review/password/independent-approval flow. A complete six-offer [policy and proposed gates](uat-billing-configuration-2026-09-16.json) have been prepared and validated, **not published**. Refunds stay closed until their financial limit is approved; provider-side plan changes stay unsupported. Do not forge independent actors or rewrite database policy/permissions to bypass it. Native email/payment/admin acceptance follows signed deployment.

## Remaining acceptance

1. Completed: all31 migrations and sync catalogs, exact three-service config/images, API/DB/AI/workers/Redis/internal API readiness, public OPEN, build retirement and verified KMS signed result.
2. Verify existing Postmark webhook25832029 after the real route is available. Exercise actual app OTP/email and provider delivery callback; smoke alone is insufficient.
3. Publish the mapped UAT billing policy using authorized Admin sessions/approval, then prove Sandbox Checkout → webhook/reconciliation → paid rights/receipt balance → return/history/document. Record concrete blockers without bypassing controls.
4. Report measured preparation/deploy/acceptance durations and exact residual gaps; never claim all journeys passed from a health probe.

Private evidence: ignored `.env.kamal/uat/prep-20260916/` and the exact Kamal run directory. Do not publish raw captures or provider credentials. `mangmee_web` has no enrolled UAT target/workflow; its dirty original checkout and Production marketing origin are untouched. Production resources and credentials are unchanged.

## Initial operation failure retained

Operation20260916T061822Z-7342e27f ended FAILED after1129.612s (18m49.612s). Build/TypeScript/allfour artifacts passed; configuration guard then found controller-created untrackedPython bytecode ininfra/postmark/__pycache__. No application source changed and no image publication/AgentCore/migration/runtime rollout occurred. Current UAT remains5b2fd63b on allthree services; local/remote locks released and absence verified.

Fix is invocation-levelPYTHONDONTWRITEBYTECODE=1. The actual main module import leaves the checkout clean; the unchanged source inventory guard remains enforced. Allthree built image/config validators, tools migration/sync catalogs and native Kamal config renders now PASS in a local reconciliation check. Fresh canonical config/14secret-version references match. Main still8c277dea. No source/CI change, guard relaxation or database rewrite. The diagnostic harness's initial missing AgentCore artifact path was separately retained and corrected before this proof.

The corrected invocation also uses isolated private Docker config with existing plugins and the real Desktop socket. Exact public pinned-image metadata read took2.243s, versus122s per metadata step with shared desktop credential helper. Shared Docker credentials/settings are unchanged. The first failure, build wait and reconciliation must remain in total elapsed time. Native acceptance remains pending.

Corrected retry started06:41:24.976598UTC as20260916T064124Z-125e1228. Initial failed attempt and4m12.903s reconciliation are retained separately. Same main/controller and all guards; deployment result/native acceptance still pending.

## Accepted deployment and native acceptance

Corrected operation finished2026-09-16T06:46:50.423620UTC, ACCEPTED_LINE_DEFERRED, **325.455s (5m25.455s)**. All11phases passed; KMS ECDSA_SHA_256 verification passed. Signed accepted.json SHA256 `c72784cd879f034313180c696be4773595f845cfce45d5bbb24d541cfee996c4`. Source8c277dea serves allthree; AgentCorekamal_uat_b/version8. Migration authority/catalog verified:188 previous+31 applied=219 completed. Normal-mode DB/sync phase68.600s; native rollout/readback95.463s; build56.355s; customer acceptance8.516s. This deployment smoke does not establish login/logout, LINE or complete business journeys.

Native Postmark verify returnedHTTP200/Success=false, allthree probes400 environment mismatch. Actual provider sample identities (DeliveryServerID23; Bounce/SpamServerID1234; allzeroMessageID/john@example.com/outbound) differ from real UAT events. First actual /email-access request hit503 because lazy Redis with offline queue disabled had not connected; isolated serving-image proof reproduced firstcallfailure/secondcallsuccess. Both defects are covered by [the bounded hotfix plan](../plans/uat-provider-activation-hotfix-2026-09-16.md); no verification/authentication/abuse-control bypass.

Second actual UI OTP request succeeded. Postmark message `1d8d3e1c-a95b-406e-ab27-e587a9f03dea` was accepted06:52:17UTC and delivered06:52:18UTC to the initial UAT allowlisted mailbox. This proves real provider delivery, not OTP confirmation or callback processing; webhook activation still awaits the hotfix. Message body/code was not logged. Billing policy remains PREPARED_NOT_PUBLISHED: current browser user has no platform-admin permission, and publication requires current-password proof plus a distinct authorized approver. No Sandbox payment has been made.
