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

Some rows overlap; do not add them into a unique test count. Earlier failed runs identified missing fixture prerequisites (LIFF ID, global OWNER role), retired UI assumptions and a real retained-submission correction defect. The larger billing regression exposed legacy fixed/missing customer email fixtures, corrected to the server-derived verified email. Browser regression also found recipient APIs absent from the expiry recovery allowlist; that source defect is fixed. The final rows above name corrected passing runs. The complete non-browser billing runner was not rerun end to end after the fixture fixes; targeted restart/upgrade/plan-change/repeat checks passed. Remote CI remains required before merge.

## Migration rehearsal

A separate empty database `email_otp_migration_test` received all previous migrations, then synthetic legacy no-email user and pending LINK token, then `20260915200000_optional_email_otp`. Readback showed email/verifiedAt null, revision 0 and old LINK REVOKED. Logs: `/tmp/email-otp-migration-before.log`, `...-after.log`, `...-observed.log`. This is a fresh migration/cohort proof, not a live rollout/rollback rehearsal.

## Defects closed during implementation

- Optional LINE email is consistent across validator/DTO/HTML/script/status, with a versioned intake policy; old incomplete evidence takes owned support/retry paths. Rejected field correction uses the edited value; uncertain requests preserve their exact submission.
- Authenticated OTP uses HMAC, persistent attempt/send budgets, same stable session and current security/email revision; it preserves the old email until confirmation. Native-send authorization runs after provider preflight. Cancellation there prevents sending.
- First-password creation requires fresh LINE proof and locks the session, preventing a session-only password bootstrap. Password/identity/merge writers invalidate stale email proof.
- New billing authorization uses the current verified owner's email. Existing paid reconciliation and stop-renewal remain usable. Future company recipient changes require explicit company review/consent and exact provider readback; uncertain outcomes have tracked support issues and never become a new payment.
- Legacy link/direct writers refuse; the legacy page directs to authenticated OTP. No new activation flag exists. Canonical sender/server/key version is environment-specific.
- Expired companies can reach OTP status/request/confirm/cancel, fresh LINE reauthentication, and company recipient review/readback from billing. The browser test exercises a company disabled by the expiry sweep; security/legal/platform/membership checks remain in force. Ordinary ERP access is not restored by email recovery.

## Unverified and release blockers

1. Stripe/Postmark source dependency PR #558 is OPEN; develop has no Billing module at this checkpoint. The isolated baseline includes subsequent local predecessor work. Do not merge unrelated unfinished changes as a shortcut. Exact integrated head CI must succeed before admin merge into develop/main.
2. Read-only AWS metadata on 2026-09-16, account 311414082667, non-root `watchdog-bedrock-dev`, found all nine canonical Postmark/OTP secret references NOT_FOUND; filtered Postmark secret metadata returned no entries. No secret values were read and no cloud/provider writes or sends were performed.
3. Actual credentials, native application OTP delivery/callbacks, key rotation rehearsal, old-writer drain and compatible deployment rollback, human older-user/assistive-technology/200% native zoom walkthrough, and signed UAT/READY/Production/customer OPEN acceptance remain NOT RUN. Earlier Postmark template UI delivery is separate evidence.
4. A provider unable to prove an old recipient update leaves new financial authorization under explicit support review. ERP/read/cancel paths remain available; this is not a promise that every payment completes automatically.

[Spec](../specs/signup-optional-email-otp-billing-spec-th.md) · [Plan](../plans/signup-optional-email-otp-billing-plan-th.md) · [Memory](../agent-memory/signup-optional-email-impact-2026-09-15.md)
