# Agent Memory: email-passwordless-signup-2026-09-16

Status: IMPLEMENTING — E1–E4 implemented and locally verified; broad billing regression and delivery gates pending.
Owner: Codex / repository owner
Scope: Email-first signup and returning email OTP login; existing-account explicit opt-in; source-aware admission/admin and shared LINE cap; BFF/UI/tests. No deploy/live sends.
Decisions: 6-digit OTP using Postmark, reuse existing policy durations and delivery. Do not treat account-email verification as login. Keep old password/claim paths. New email accounts enable email login; existing accounts require verified email and fresh reauthentication to opt in. Shared cap/duplicate review with LINE.
Open questions: None blocking first implementation; conservative existing policy reused, no additional auto grants.
Artifacts: docs/specs/unified-easy-signup-spec-th.md; docs/plans/unified-easy-signup-plan-th.md
Verification: Checkpoint: local API unit suite and API/web typechecks pass; web1732/1732; public email-access PostgreSQL16/16; legacy account-email/billing-recipient PostgreSQL22/22; marketing5/5. Real Nest+Next+Chromium+PG browser six groups pass with simulated Postmark, including new/returning signup, current legal gate, real receipt upload screen, actual marketing CTA, real admin UI approval and crash after company commit→retry same trial. Logs /tmp/email-passwordless-*.log; screenshots /tmp/email-passwordless-browser. Safe next-path follow-up passes. Billing plan-adjustment23 HTTP/PG groups pass; exact evidence in docs/evidence/email-passwordless-signup-2026-09-16.md.
Next: Rebased onto dependency3e2f4157 (feature checkpoint1dcd01b1). Finish broad local billing regression, preserve latest develop docs, then one integrated CI candidate before any merge. Do not trigger repeated paid CI. DependencyPR575 currently red due billing-free-days synthetic customer missing from updated quote recipient guard; read CI35044244378 and add the missing provider fixture before validating. No deploy.

Isolated worktree: /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-email-passwordless, branch codex/email-passwordless-signup-20260916, base7ef09d8e. Parent optional-email worktree is concurrent and left untouched. Billing already admin-merged; this branch depends on optional-email source and must be integrated/verified before merge.
