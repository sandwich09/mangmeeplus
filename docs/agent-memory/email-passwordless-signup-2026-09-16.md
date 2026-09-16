# Agent Memory: email-passwordless-signup-2026-09-16

Status: IMPLEMENTED / LOCAL VERIFIED — E1–E4 complete; core CI and merge gates pending.
Owner: Codex / repository owner
Scope: Email-first signup and returning email OTP login; existing-account explicit opt-in; source-aware admission/admin and shared LINE cap; BFF/UI/tests. No deploy/live sends.
Decisions: 6-digit OTP using Postmark, reuse existing policy durations and delivery. Do not treat account-email verification as login. Keep old password/claim paths. New email accounts enable email login; existing accounts require verified email and fresh reauthentication to opt in. Shared cap/duplicate review with LINE.
Open questions: None blocking first implementation; conservative existing policy reused, no additional auto grants.
Artifacts: docs/specs/unified-easy-signup-spec-th.md; docs/plans/unified-easy-signup-plan-th.md
Verification: Checkpoint: local API unit suite and API/web typechecks pass; web1732/1732; public email-access PostgreSQL16/16; legacy account-email/billing-recipient PostgreSQL22/22; marketing5/5. Real Nest+Next+Chromium+PG browser six groups pass with simulated Postmark, including new/returning signup, current legal gate, real receipt upload screen, actual marketing CTA, real admin UI approval and crash after company commit→retry same trial. Logs /tmp/email-passwordless-*.log; screenshots /tmp/email-passwordless-browser. Safe next-path follow-up passes. Billing plan-adjustment23 and full256 HTTP/PG groups pass; final admin API68/web60, maintenance validator/tamper and Postmark config tests PASS; exact evidence in docs/evidence/email-passwordless-signup-2026-09-16.md.
Next: Integrate dependency e477e171 (PR575 CI35047624780 currently running). Its new synthetic free-days customer fixture is equivalent to the locally fixed version and adds a verified-email assertion; preserve that assertion. Latest develop docs12880798 already preserved. Final core candidate gets one CI before authorized admin merge develop/main. No deploy.

Marketing completed: PR4→develop d8c25e86 (CI35048055608 PASS), PR5→main d5c141ec (CI35048182393 PASS). No deployment.

Isolated worktree: /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-email-passwordless, branch codex/email-passwordless-signup-20260916, base7ef09d8e. Parent optional-email worktree is concurrent and left untouched. Billing already admin-merged; this branch depends on optional-email source and must be integrated/verified before merge.
