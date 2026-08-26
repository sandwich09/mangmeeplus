# Agent Memory: password-reset-line-self-service

Status: VERIFIED; ready to commit/push/PR
Owner: thawatchai
Scope: OWNER and employee self-service password recovery through the exact LINE identity linked to their account.
Decisions: Use a one-time 30-minute recovery password stored in the existing `PasswordResetToken`. Request time does not change the credential or sessions. First successful recovery login atomically consumes the token, rotates to a temporary credential, revokes sessions, and reuses the existing forced `/change-password` journey. Keep generic responses and existing rate limits.
Open questions: None.
Artifacts: `docs/specs/password-reset-line-self-service-spec.md`; `docs/plans/password-reset-line-self-service-plan.md`.
Verification: API focused auth/reset tests 39/39 passed. API full suite passed. Web focused auth tests 17/17 passed. Web full suite 1051/1051 passed. API and Web typechecks passed. `git diff --check` passed. CI's exact-file maintenance guard required the repository-provided pin sync because `password-login.use-case.ts` is protected; `sync-production-maintenance-release-pins.mjs --check` passed after regeneration. No live LINE push or deploy performed.
Next: Commit, push `codex/line-self-service-recovery`, and open a PR to `develop`.
