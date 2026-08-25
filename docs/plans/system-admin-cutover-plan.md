# System Admin Cutover Plan

Status: In progress.

1. [x] Add an idempotent `system-admin-cutover.ts` database utility with `ADD` and `REVOKE` modes, transaction-scoped guards, audit records, and secret-free JSON evidence.
2. [x] Add focused tests for the utility and the release-task render boundary.
3. [x] Add production-only release-task modes that inject `DATABASE_URL` and the temporary password by Secrets Manager ARN and run no arbitrary command.
4. [x] Add one owner-only workflow that verifies current `main`, a signed UAT Passport/image, exact inputs, and the fixed Production secret boundary before dispatching the one-off task.
5. [ ] Run focused checks and full required CI, merge through `develop` to `main`, deploy the candidate to UAT for its signed Passport, then close UAT again.
6. Dispatch `ADD` for `prodmangmeeplus`, retrieve the temporary password in memory, and hand it to the owner.
7. After the owner changes the password, dispatch `REVOKE` for `thawatchai.watchdog`, verify evidence/readback, and rotate the cutover secret.
