# Email OTP signup / passwordless — verification and source delivery

Date: 2026-09-16. Feature checkpoint `1dcd01b1` with final type/security, duplicate-warning and initial-resume corrections; optional-email dependency integration is recorded below. Worktree `mangmeeplus-email-passwordless`; marketing `mangmee_web-email-signup`. No deploy, native mail delivery, payment or customer lead submission.

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
| Full billing HTTP/PostgreSQL | 256 groups PASS | Actual Nest and PostgreSQL; Stripe/Postmark/LINE simulated; exit0, browserE2E=false |
| Final admin regressions | API68/68, web60/60 PASS | Source-aware recovery and duplicate warning; also asserted through actual browser queue |
| Maintenance security pins | PASS | Validator plus tamper tests; new public login and changed AuthModule pinned; no live gate changes |
| Postmark config tests | 5/5 PASS | Local configuration validation only |

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
| E14 dependency | CI35044244378 exposed a missing free-days Stripe customer fixture after the recipient guard changed. Supplied synthetic customer, preserved the real guard; focused23 and full256 groups pass. Latest dependency `e477e171` includes its equivalent fix and an extra verified-recipient assertion; integrated in15a29950; rebuilt and focused23 groups pass after integration (`/tmp/email-passwordless-integrated-gift.log`) |
| E15 static BFF routing | Four static route files avoid `/api/*` rewrite shadowing; real browser reaches BFF rather than a404 upstream route |
| E16 actual signup/admin UX | CTA moved to initial signup view; email-specific approval text; no misleading password mail;390px screenshot inspected |
| E17 return/retry | Sanitized same-app next path, legal/password gate first; invalid/expired proof rotates request key; BFF rejects external next/null body/corrupt cookie; initial status resolves or times out before new input is enabled |
| E18 maintenance | New public login service is in the existing hash validator and tamper fixture; CLOSED session refusal has PG evidence |

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
BILLING_TEST_DATABASE_URL=<local-watchdog_postmark_ci-url> node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
BILLING_TEST_DATABASE_URL=<local-watchdog_postmark_ci-url> BILLING_CONFIG_ONLY=1 BILLING_PLAN_ADJUSTMENTS_ONLY=1 node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
```

Machine-local logs: `/tmp/email-passwordless-*-final.log`, `/tmp/email-passwordless-legacy-pg.log`, `/tmp/email-passwordless-billing-regression.log`; screenshots `/tmp/email-passwordless-browser/email-signup-390.png` and `email-returning-390.png`. Full billing regression passed in `/tmp/email-passwordless-billing-full.log`; the expected synthetic LINE warning did not fail any assertion. Core required CI and develop/main merges are complete; see the final delivery section below.

Marketing is merged: PR4→develop (`d8c25e86`, CI35048055608 PASS) and PR5→main (`d5c141ec`, CI35048182393 PASS). Both validated catalog5/5 and had no deployment. Core CI separately validated the final integrated head; these marketing results do not substitute for it.

## CI navigation failure investigation

Main CI35049794245 attempt1 failed when the existing admin apply-invoice list navigation showed a Next404. The new email signup browser journey passed all5 CI groups before this failure. Develop CI35049514012, with an identical source tree, passed the same complete browser step. Local focused apply-retry passed16 groups; the7 CI browser commands were then replayed in order from a fresh Next cache and all passed (8/7/10/5/7/16/67 groups, overlap included). Logs: /tmp/email-passwordless-main-ci-failure.log, /tmp/email-passwordless-apply-retry-diagnostic.log, /tmp/email-passwordless-ci-sequence.log.

The failure is not reproduced and the underlying cause is not established; do not describe it as a fixed application defect. No production source or assertion was weakened. Wait for the full develop result before a bounded failed-job-only retry of main on the same head. This local evidence does not replace main CI acceptance.

Develop CI35049514012 attempt1 completed SUCCESS on44f3ff7c. After that complete result and local sequence replay, main CI35049794245 was retried once with --failed on unchanged23acbd1f at03:54UTC. Acceptance of main remains pending attempt2; the earlier failed attempt is retained as evidence.

## ส่งมอบ source หลัง CI ผ่าน — 2026-09-16

| Target | Tested head | CI | Merge |
|---|---|---|---|
| develop | `44f3ff7c3e0d5c864b56ec87db2196c94a01dc97` | [35049514012](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35049514012), attempt1 SUCCESS | [PR583](https://github.com/MangmeeDev/mangmeeplus/pull/583), `2361157b1e18a336ff6537d84fa47925b9e0ee64` |
| main | `23acbd1f19a7c2ee3d7ff8315f8d076db25e59ef` | [35049794245](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35049794245), attempt2 SUCCESS | [PR584](https://github.com/MangmeeDev/mangmeeplus/pull/584), `670e88ce856306914809cde7735589f21145234d` |

Admin merge develop occurred at04:58:14UTC, then main at04:58:37UTC, after both runs passed. Required Typecheck and Test, Security Audit, Secret Scan, Migration Review and Production Config Validation all passed. Image/publication jobs were intentionally skipped; no deployment happened.

Both merged trees are `bcabfc01d241f953ae7e3207bf4af8d486dbab8a`. They preserve the four prerequisite completion documents that landed while CI ran; all non-doc files match tested tree `a190b1ff3fec69378d84ec0c7d0ec397f73bc685` exactly. Marketing PR4/5 already merged after their own successful CI.

Main attempt1's admin navigation404 remains recorded above; it was not reproduced in the focused16-group browser run, the full7-command cold-cache replay, develop CI, or main attempt2. One failed-job-only retry was used; no product-code change or weakened assertion was made. The underlying cause was not established, so this is not evidence of a fixed application defect.

Source implementation, automated verification and requested merges are complete. Native Postmark inbox/callback acceptance, deployment and human usability testing were not performed in this task. Future release must follow the existing mandatory runbooks; additive migration and email-only rollback constraints still apply.
