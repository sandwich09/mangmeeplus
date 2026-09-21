# Agent Memory: UAT existing email OTP login

Status: RELEASE IN PROGRESS — NOT DEPLOYED
Owner: Codex
Scope: Urgent existing-account public email OTP loop; API transaction, focused web recovery copy, spec/plan/tests. No direct UAT data mutation or deployment.
Decisions: Owner directed that a registered account email proven by a valid OTP must be able to log in. Treat the browser-bound public OTP as explicit opt-in only when it resolves to one exact User.email and current active/non-privileged/security guards pass. Atomically set missing email verification/login activation and issue the session; do not attach or merge contact emails.
Open questions: None for implementation. Deployment remains a separate owner-authorized operation under the mandatory UAT protocol. The UAT observation also showed that the 14:14–14:15 OTP address belonged to The lobby clube, not The sun coffee; the hotfix never remaps an email between accounts.
Artifacts: `docs/specs/unified-easy-signup-spec-th.md`, `docs/plans/unified-easy-signup-plan-th.md`, API email-access service/PG spec, web email-access recovery copy.
Verification: `EMAIL_ACCESS_TEST_DATABASE_URL=... pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/auth/application/email-access.pg.spec.ts` passed 16/16 on a freshly migrated isolated PostgreSQL database. `pnpm --filter @watchdog-bms/api typecheck` and `pnpm --filter @watchdog-bms/web typecheck` passed. `git diff --check` passed. In the isolated release branch, the repository-wide maintenance pin check is current. The temporary local test database was removed. No live mail, UAT write, or deploy.
Next: Merge the scoped change through required CI into `develop` and `main`, then deploy UAT under the mandatory release protocol. After deployment, test with the exact email stored on the intended account; an email belonging to another account must continue to enter only that account.
