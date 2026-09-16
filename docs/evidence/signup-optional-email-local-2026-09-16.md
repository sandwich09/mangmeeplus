# Optional LINE email and account OTP — local implementation evidence

Date: 2026-09-16 (Asia/Bangkok). Source worktree: `mangmeeplus-email-otp`, branch `codex/optional-email-otp-billing-20260915`, implementation base `c0c925968e945d452a2b483b4ddd8b5fec99e847`. No package.json/dependency changes. Final commit/CI status belongs in the linked memory.

## Observed local checks

All database tests below use synthetic records in a dedicated local Docker PostgreSQL 16 instance, port 15439. No customer database or native payment/mail provider is used by the test harness.

| Check | Result | Local log |
|---|---|---|
| Complete API unit runner, `pnpm --filter @watchdog-bms/api test` | PASS, exit 0 | `/tmp/email-otp-full-unit-final.log` |
| OTP + company-recipient PostgreSQL + LIFF unit cases | 87 passed, 0 failed/skipped (15 OTP, 7 recipient, 65 LIFF) | `/tmp/email-otp-pg-liff-final2.log` |
| First-password profile regression after session locking | 26 passed, 0 failed/skipped | `/tmp/email-otp-profile-final.log` |
| Request/password budget across changing IPs | 14 passed, 0 failed/skipped | `/tmp/email-otp-budget-final.log` |
| LINE signup PostgreSQL, including blank first/add shop, replay, duplicate-email/manual review and recovery | 30 passed, 0 failed/skipped | `/tmp/email-otp-signup-pg-final.log` |
| LINE signup Chromium, real served HTML/JS/CSP, simulated LINE/status/submit responses | 7 passed at 390/1280 and recovery/reopen paths | `/tmp/email-otp-liff-browser3.log` |
| Real Nest HTTP + PostgreSQL + Next/Chromium, simulated Postmark/LINE/Stripe | PASS, 10 scenario groups: request/confirm, original session LINE OAuth reauth, leading zero, lost response, payment gate, explicit company recipient, 320/390/768/1280, retired link recovery and expired-company billing recovery | `/tmp/email-otp-browser-expired2.log` |
| Renewal cancellation while recipient operation is unresolved | 6 passed, 0 failed/skipped | `/tmp/email-otp-cancellation-regression.log` |
| Native readiness/config functions with injected provider/secret facts | 5 passed | `/tmp/email-otp-provider-final.log` |
| Kamal controller/config tests | 15 passed | `/tmp/email-otp-kamal-last.log` |
| Full maintenance enforcement and pin synchronization | PASS, 47 exact files | `/tmp/email-otp-maintenance-check.log`, `/tmp/email-otp-pin-last.log` |
| API and web TypeScript | PASS on final source before commit | `/tmp/email-otp-api-typecheck-final.log`, `/tmp/email-otp-web-typecheck-release.log` |
| Auth recovery guard and test-runner wiring | 41 passed, 0 failed/skipped | `/tmp/email-otp-guards-wiring-correct.log` |
| Restart HTTP/PG regression | PASS with simulated providers | `/tmp/email-otp-restart-final.log` |
| Upgrade HTTP/PG/Chromium regression | PASS: paid-source changes, lost response, explicit consent, no duplicate payment/grant/time extension | `/tmp/email-otp-upgrade-final.log` |
| Plan change HTTP/PG/Chromium regression | PASS: downgrade, cancel/resume, stale capacity, paid repair and mobile round trip | `/tmp/email-otp-plan-final.log` |
| Repeat purchase HTTP/PG/Chromium regression | PASS: renewal race, expired/lost checkout, original invoice repair, cancellation, notification delivery and admin recovery | `/tmp/email-otp-repeat-final.log` |
| Complete web unit/render/contract runner after develop integration | 1,726 passed, 0 failed/skipped | `/tmp/email-otp-web-full2.log` |
| Signup stale identity, support follow-up, and LINE binding PostgreSQL regressions | 14 + 19 + 15 passed, 0 failed/skipped; last-login rejection and legitimate unlink both covered | `/tmp/email-otp-stale-identity-final.log`, `/tmp/email-otp-support-pg-final.log`, `/tmp/email-otp-binding-pg-final.log` |
| OTP browser after final profile/cache/loading integration | 10 scenario groups passed with simulated providers | `/tmp/email-otp-browser-final-ui.log` |

Some rows overlap; do not add them into a unique test count. Earlier failed runs identified missing fixture prerequisites (LIFF ID, global OWNER role), retired UI assumptions and a real retained-submission correction defect. The larger billing regression exposed legacy fixed/missing customer email fixtures, corrected to the server-derived verified email. Browser regression also found recipient APIs absent from the expiry recovery allowlist; that source defect is fixed. The final rows above name corrected passing runs. The complete primary non-browser billing runner passed in CI35004735415 on source3e31d545; that overall CI still failed later in invoice-import browser coverage. Remote CI on the integrated source remains required before merge.

## Migration rehearsal

A separate empty database `email_otp_migration_test` received all previous migrations, then synthetic legacy no-email user and pending LINK token, then `20260915200000_optional_email_otp`. Readback showed email/verifiedAt null, revision 0 and old LINK REVOKED. Logs: `/tmp/email-otp-migration-before.log`, `...-after.log`, `...-observed.log`. This is a fresh migration/cohort proof, not a live rollout/rollback rehearsal.

## Defects closed during implementation

- Optional LINE email is consistent across validator/DTO/HTML/script/status, with a versioned intake policy; old incomplete evidence takes owned support/retry paths. Rejected field correction uses the edited value; uncertain requests preserve their exact submission.
- Authenticated OTP uses HMAC, persistent attempt/send budgets, same stable session and current security/email revision; it preserves the old email until confirmation. Native-send authorization runs after provider preflight. Cancellation there prevents sending.
- First-password creation requires fresh LINE proof and locks the session, preventing a session-only password bootstrap. Password/identity/merge writers invalidate stale email proof.
- New billing authorization uses the current verified owner's email. Existing paid reconciliation and stop-renewal remain usable. Future company recipient changes require explicit company review/consent and exact provider readback; uncertain outcomes have tracked support issues and never become a new payment.
- Legacy link/direct writers refuse; the legacy page directs to authenticated OTP. No new activation flag exists. Canonical sender/server/key version is environment-specific.
- Expired companies can reach OTP status/request/confirm/cancel, fresh LINE reauthentication, and company recipient review/readback from billing. The browser test exercises a company disabled by the expiry sweep; security/legal/platform/membership checks remain in force. Ordinary ERP access is not restored by email recovery.
- OTP state changes invalidate the profile completeness cache. Existing page assertions now render the shared OTP state and preserve shop/phone/password coverage. Integrated async buttons use develop's existing accessible loading contract; permission/validation-only disabling does not indicate an operation in progress.

## CI observation

[PR #575](https://github.com/MangmeeDev/mangmeeplus/pull/575), source `5dad75da34e5c2a7b2394ede061d54059c428257`, [CI 35003554327](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35003554327) failed the stale LINE identity PostgreSQL suite: six legacy fixtures tried to self-unlink without a usable fallback login. The fixture changes retain the new last-login rule, add an explicit rejection assertion and pass the actual PostgreSQL tests above. Secret Scan, Security Audit, Migration Review and Production Config Validation passed on that head. Later corrected-head CI is still required; this failed run does not authorize merge.

CI35004735415 on3e31d545 passed the core tests and several real browser sequences, then failed waiting for the invoice-import reason field. Bounded failure diagnostics were added; two local invoice-import runs passed9 groups, including a fresh integrated API build. A maintenance fixture omitted the two new canonical config files; corrected fixture/pin-sync tests pass. After integrating d419169b, API/web TypeScript and the OTP browser10 groups pass; full integrated CI remains pending.

## Unverified and release blockers

1. Dependency resolved: PR #558 merged into develop d419169b and main via PR #577 at3baa10c2. The feature branch integrates that complete base, preserving billing controls/history retention. Only the five optional-email commits remained outside develop before integration; the earlier scope question no longer blocks this base. Exact integrated-head CI must succeed before admin merge into develop/main.
2. Read-only AWS metadata on 2026-09-16, account 311414082667, non-root `watchdog-bedrock-dev`, found all nine canonical Postmark/OTP secret references NOT_FOUND; filtered Postmark secret metadata returned no entries. No secret values were read and no cloud/provider writes or sends were performed.
3. Actual credentials, native application OTP delivery/callbacks, key rotation rehearsal, old-writer drain and compatible deployment rollback, human older-user/assistive-technology/200% native zoom walkthrough, and signed UAT/READY/Production/customer OPEN acceptance remain NOT RUN. Earlier Postmark template UI delivery is separate evidence.
4. A provider unable to prove an old recipient update leaves new financial authorization under explicit support review. ERP/read/cancel paths remain available; this is not a promise that every payment completes automatically.

[Spec](../specs/signup-optional-email-otp-billing-spec-th.md) · [Plan](../plans/signup-optional-email-otp-billing-plan-th.md) · [Memory](../agent-memory/signup-optional-email-impact-2026-09-15.md)
