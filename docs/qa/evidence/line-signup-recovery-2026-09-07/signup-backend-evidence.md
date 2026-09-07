# Signup backend verification — 2026-09-07

Backend lane is frozen after the checks below. PostgreSQL checks used the isolated task database at `127.0.0.1:15570/watchdog_bms`; no shared/customer database was used.

## Focused API behavior

From `apps/api`:

```sh
pnpm exec tsx --test --test-reporter=spec \
  src/modules/auth/application/auth-rate-limit.service.spec.ts \
  src/modules/external-signup/application/submit-line-signup.use-case.spec.ts \
  src/modules/external-signup/application/line-signup-status-and-package-change.spec.ts \
  src/modules/external-signup/application/line-signup-notify.service.spec.ts \
  src/modules/external-signup/application/line-signup-auto-free.integration.spec.ts \
  src/modules/external-signup/application/provision-signup.use-case.spec.ts \
  src/modules/external-signup/application/signup-admin-queue.use-case.spec.ts \
  src/modules/external-signup/application/signup-suspend-race.spec.ts
```

Result: **241 passed, 0 failed**.

## PostgreSQL duplicate/recovery decisions

```sh
LINE_SIGNUP_REQUIRE_POSTGRES=true \
LINE_SIGNUP_TEST_DATABASE_URL='postgresql://watchdog:***@127.0.0.1:15570/watchdog_bms?schema=public' \
pnpm exec tsx --test --test-reporter=spec \
  src/modules/external-signup/line-signup-duplicate-email.pg.spec.ts
```

Result: **28 passed, 0 failed**.

This includes own completed history, other-account/security holds, actual claim-expiry sweep, approval-day daily cap, concurrent email intake, exact older-key replay, explicit shared-contact review, and REQUEST_INFO support-case/outbox reuse.

## PostgreSQL identity and concurrency

```sh
LINE_SIGNUP_REQUIRE_POSTGRES=true \
LINE_SIGNUP_TEST_DATABASE_URL='postgresql://watchdog:***@127.0.0.1:15570/watchdog_bms?schema=public' \
pnpm exec tsx --test --test-reporter=spec \
  src/modules/external-signup/line-signup-stale-identity.pg.spec.ts
```

Result: **14 passed, 0 failed**.

This includes changed-payload open-request replay without overwrite, UNLINKED own-email conflict, explicit repeat-trial authorization, unique identity re-pointing, provisioning recovery, and real concurrent link/provision and stale-slot races.

## First receipt after LINE signup

```sh
ONBOARDING_RECEIPT_REQUIRE_POSTGRES=true \
ONBOARDING_RECEIPT_TEST_DATABASE_URL='postgresql://watchdog:***@127.0.0.1:15570/watchdog_bms?schema=public' \
pnpm exec tsx --test --test-reporter=spec \
  src/modules/line-ai/onboarding-receipt-allowance.pg.spec.ts
```

Result: **1 passed, 0 failed**. The provisioned trial remains effective at 15 receipts and the first receipt path succeeds.

## Compile and diff checks

- `pnpm typecheck` in `apps/api`: passed.
- `pnpm build` in `packages/contracts`: passed.
- `git diff --check`: passed.

Existing CI flags remain sufficient: `LINE_SIGNUP_REQUIRE_POSTGRES`/`LINE_SIGNUP_TEST_DATABASE_URL` and `ONBOARDING_RECEIPT_REQUIRE_POSTGRES`/`ONBOARDING_RECEIPT_TEST_DATABASE_URL`. No workflow or package-script change is required.
