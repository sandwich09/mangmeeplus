# Postmark implementation — local evidence 2026-09-12

สถานะ: **LOCAL CHECKS PASS / FULL DELIVERY, BILLING AND BROWSER ACCEPTANCE INCOMPLETE**. Branch `codex/stripe-postmark-implementation-20260912`, based on `2a789aa6`; changes are not committed/merged. [Source hashes](source-hashes.json) identify the checked mail implementation and integration files. No application deployment, live charge, external mail delivery or provider settings change.

| Layer | Result | Scope |
|---|---|---|
| Focused API tests | 146 tests PASS, 0 failed/skipped | New Postmark contract/fault checks plus existing auth, SES, claim token, claim drain and workflow regression tests; not 146 new Postmark journeys |
| Actual PostgreSQL | 10 node tests PASS (9 scenarios plus enclosing test), 0 failed/skipped | Local isolated database, real row/CAS/transaction behavior; fake provider transport |
| Actual Nest HTTP + PostgreSQL | 7 check groups PASS | Full AppModule DI with Postmark selected; HTTP 401/400/413/200/503, durable sanitized/deduped callback, case/trailing slash, malformed JSON redaction |
| Provider API validation L1 | HTTP 200, ErrorCode 0, valid MessageID/SubmittedAt | Actual Postmark API using documented POSTMARK_API_TEST and synthetic content; **no inbox/server-credential/webhook delivery proof** |
| Builds/type checks | Contracts/config build, API no-emit typecheck, SWC build PASS | Compiled Nest decorator metadata exercised by HTTP smoke |
| Test registration | API suite coverage 3 PASS; acceptance catalog 4 PASS; CI YAML parse PASS | New contract is in owned runner, PG/HTTP step registered; GitHub CI itself has not run |

## Regression and fault coverage

- Two concurrent claim intents reserve one active generation. Two dispatches of the same reserved attempt POST at most once; accepted replay sends nothing and mints no replacement claim proof.
- Same intent cannot be reused for another recipient, purpose, server/stream or signup request.
- Expiry/suppression before dispatch persists terminal failure instead of leaving an unsent row SENDING. No network call occurs for those attempts.
- Authenticated bounce before POST response remains SUPPRESSED/EMAIL_FAILED; a late accepted response or Delivery event cannot clear it or verify identity.
- Unknown response waits for lookup. Empty bounded lookup permits a new generation only after backoff with possible-duplicate evidence; mismatched metadata remains UNKNOWN, and incomplete/malformed lookup is never proof of non-delivery.
- Callback binding is serialized; message/server/stream/recipient mismatches cannot alter another attempt. Durable payload excludes Content, Subject, raw proof and authentication headers.
- The provider body limit covers case/trailing slash accepted by routing. Invalid JSON returns fixed diagnostics, not a quoted fragment of email content. Persistence failure returns 503 rather than acknowledging an event that was lost.
- Late SES bounce/complaint is ignored after Postmark owns the current claim, including a concurrent provider change under the existing signup transaction lock. SES failure state and its audit commit together. Outbound rollback cannot turn an accepted replay or a new reminder for that Postmark-owned claim into automatic SES failover.
- SES continues using its existing result field. Postmark IDs are stored in provider-neutral attempts. No transport callback grants membership, trial or paid access.

## Reproduce

From repository root (corepack can be omitted when pnpm is already available):

```sh
corepack pnpm --dir apps/api exec tsx --tsconfig tsconfig.json --test \
  src/modules/auth/infrastructure/postmark.client.spec.ts \
  src/modules/auth/infrastructure/ses-auth-mailer.adapter.spec.ts \
  src/modules/external-signup/application/signup-claim-email.service.spec.ts \
  src/modules/external-signup/application/account-claim-token.service.spec.ts \
  src/modules/workflow/application/use-cases/workflow-outbox-drain.use-case.spec.ts \
  src/modules/auth/auth-endpoints.spec.ts \
  src/modules/external-signup/application/ses-event.use-case.spec.ts
corepack pnpm exec tsc -p packages/contracts/tsconfig.json
corepack pnpm exec tsc -p packages/config/tsconfig.json
node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
corepack pnpm --dir apps/api exec swc src -d dist/apps/api/src --strip-leading-paths --copy-files -q
corepack pnpm --dir apps/api exec tsx --tsconfig tsconfig.json --test src/modules/auth/postmark-delivery.pg.spec.ts
node apps/api/dist/apps/api/src/scripts/postmark-http-smoke.js
```

For the last two commands, securely supply `BILLING_TEST_DATABASE_URL` for a migrated **localhost** database named `mangmee_billing_20260912` or `watchdog_postmark_ci`. The local run used port 15432, applied additive migrations through `20260912150200_email_dispatch_fence`, and removed test rows in cleanup. HTTP smoke requires the variable and fails rather than skips; the ordinary node PG suite skips without it, so a skipped invocation is not evidence. CI supplies a dedicated service-container database. Do not use customer/UAT/production data.

Local build artifacts were written to `/tmp/mangmee-postmark-api-build`; NODE_PATH pointed to the existing API/root node_modules. No dependency or package.json edit. Raw output retained locally in `/tmp/stripe-postmark-mail-focused-latest.tap`, `/tmp/mangmee-postmark-pg-final.log`, `/tmp/mangmee-postmark-http-smoke-final.log` and `/tmp/mangmee-postmark-typecheck-latest.log`; sanitized receipts are copied into this evidence folder. No credential-bearing env file is included.

## Remaining acceptance

- Full browser signup → claim → provision → first upload → returning login/recovery, and complete legacy SES backfill/rollback/retention evidence.
- Operator-visible UNKNOWN/exhausted/config/suppression recovery, metrics/alerts, address correction, approved suppression recovery and explicit resolution of provider-pinned intents during rollback; these must not require SQL or force LINE signup.
- Provider Sandbox L2 and controlled live inbox L3; actual callback configuration/rotation/paused delivery, plan allowance/retention and company supplier Receipt setup.
- Stripe payment/customer documents and all web/LINE/Admin paid flows. Their pack formula depends on [P01–P03](../../specs/mangmee-billing-pack-amendment-2026-09-12.md). Current subscription draft is not wired or ready to merge as the final implementation.
- GitHub CI, review and authorized develop/main merges. No deploy is authorized.

Initial verification attempts that failed were corrected openly: wrong tsx decorator configuration, two outdated outbox event inventories, one inferred UUID test variable type, and invalid `LOG_LEVEL=silent` in the HTTP fixture. The final invocations above passed. Node did not expose a YAML parser dependency, so workflow syntax was checked with Ruby's existing standard YAML library; no package was installed.
