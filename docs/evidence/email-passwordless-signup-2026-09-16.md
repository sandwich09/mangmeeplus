# Email OTP signup / passwordless — local verification

Date: 2026-09-16. Feature checkpoint `1dcd01b1` on optional-email dependency `3e2f4157`, plus the final TypeScript optional-field narrowing. Worktree `mangmeeplus-email-passwordless`; marketing `mangmee_web-email-signup`. No deploy, native mail delivery, payment or customer lead submission.

## Implemented journey

Marketing CTA → app `/signup` → `/email-access` → six-digit OTP → shop/contact/mobile → existing automatic/manual admission → one owner/company/trial → current legal acceptance → protected receipt page. Logout → new OTP → same owner/company/dates. Existing accounts must explicitly enable email login after fresh identity proof. Legacy contact email alone cannot log in. Billing and backup-password return paths survive login; current legal/password-change gates apply.

## Checks and results

| Check | Result | Actual boundary |
|---|---|---|
| Additive Prisma migration + generate | PASS | Dedicated Docker PostgreSQL16 on127.0.0.1:15443; fresh migrations |
| API build + typecheck | PASS | SWC + TypeScript; no dependencies added |
| Web typecheck | PASS | Next route generation + TypeScript |
| API full unit suite | PASS | Existing pnpm test command, exit0; DOT reporter does not provide a claimed case count |
| Web full unit suite | 1732/1732 PASS | BFF, error display, loading/accessibility, signup/admin regressions included |
| Public email access PostgreSQL | 16/16 PASS | HMAC/browser/current security, single consume/session, audit rollback, opt-in, no-last-login lockout, delivery failures/rate limits |
| Existing email OTP + billing recipient PostgreSQL | 22/22 PASS | Private OTP and checkout-recipient compatibility |
| Marketing catalog contract | 5/5 PASS | Embedded actual template; unchanged package/catalog rules; fixed app origin |
| Real Nest+Next+Chromium+PostgreSQL | 6 scenario groups PASS | Marketing keyboard CTA, mobile signup, wrong code recovery/reload, returning user, legal/receipt page, admin approval with crash/retry |
| Billing plan adjustments HTTP/PostgreSQL | 23 groups PASS | Paid package/collection/free days/feature grants; provider transport simulated, browserE2E=false |

Counts overlap; group counts are not numbers of independent user flows. Browser test uses actual BFF cookies, auth session, onboarding, queue UI and DB. Only Postmark transport is replaced. Native Postmark acceptance/inbox/spam placement and production rollout remain outside this local evidence.

## Review closure

| Spec risk | Implementation / evidence |
|---|---|
| E01–E04 purpose, opt-in, brute force, browser binding | Dedicated EmailAccessChallenge; HMAC+environment/current identity; recipient/IP limits; HttpOnly proof; no raw OTP persisted; real PG and BFF tests |
| E05–E07 duplicate grants, stale authority, returning access | Single-use session transaction; provisioning fence; browser crash after company commit then real admin retry reuses same shop/term; returning login preserves dates |
| E08 LINE/web admission | Same daily advisory lock/count includes both sources; cross-channel duplicate review; existing LINE unit regressions pass |
| E09/E11 source-specific admin and legacy | Email bypasses legacy claim/password mail; READY/stale rows recover in queue; old official-site transitions unchanged; full API/web regressions |
| E10 delivery failures | Durable ACCEPTED/UNKNOWN/CONFIG/PERMANENT outcomes; suppressed preparation503; replay never re-sends a consumed transport intent |
| E12/E13 gates / identity change | Existing legal/platform/company/member guards; current user binding checked again for signup proof and final session; private email proof hashes unchanged until opt-in |
| E14 dependency | Rebases optional-email `3e2f4157`; PR575 was red. Read CI35044244378: free-days Stripe customer fixture missing after recipient-guard change. Added missing synthetic provider customer, preserved real guard; focused23 groups pass |
| E15 static BFF routing | Four static route files avoid `/api/*` rewrite shadowing; real browser reaches BFF rather than a404 upstream route |
| E16 actual signup/admin UX | CTA moved to initial signup view; email-specific approval text; no misleading password mail;390px screenshot inspected |
| E17 return/retry | Sanitized same-app next path, legal/password gate first; invalid/expired proof rotates request key; BFF rejects external next/null body/corrupt cookie |

New P31 company-deletion docs on develop are preserved; this task does not implement their lifecycle changes. Current disabled/archived-company checks are reused. Future identity deletion/revocation must include the new public challenge ledger; raw secrets remain excluded from exports and audit.

## Reproduce locally

Use only a dedicated test database. Commands run from the feature worktree:

```sh
pnpm --filter @watchdog-bms/api build
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/web test
EMAIL_ACCESS_TEST_DATABASE_URL=<local-email_access_test-url> pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/application/email-access.pg.spec.ts
EMAIL_OTP_TEST_DATABASE_URL=<local-email_otp_test-url> pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/application/account-email-otp.postgres.spec.ts src/modules/billing/application/billing-email-recipient.postgres.spec.ts
BILLING_TEST_DATABASE_URL=<local-email_access_test-url> BILLING_EMAIL_ACCESS_ONLY=1 MANGMEE_MARKETING_DIR=<marketing-worktree> BILLING_BROWSER_EVIDENCE_DIR=<evidence-directory> node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
BILLING_TEST_DATABASE_URL=<local-watchdog_postmark_ci-url> BILLING_CONFIG_ONLY=1 BILLING_PLAN_ADJUSTMENTS_ONLY=1 node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
```

Machine-local logs: `/tmp/email-passwordless-*-final.log`, `/tmp/email-passwordless-legacy-pg.log`, `/tmp/email-passwordless-billing-regression.log`; screenshots `/tmp/email-passwordless-browser/email-signup-390.png` and `email-returning-390.png`. Broader combined billing regression/required CI and develop/main integration are recorded separately when completed. This checkpoint does not claim those passed.
