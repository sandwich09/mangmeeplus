# Agent Memory: System Admin Cutover — UAT and Production

Status: UAT cutover complete and parked; Production workflow merged; exact security-waiver recovery in progress before a fresh Passport.
Owner: MangmeeDev
Scope: Replace day-to-day application `SYSTEM_ADMIN` access associated with `thawatchai.watchdog` in UAT and Production.
Decisions:
- UAT replacement is `uatmangmeeplus`; Production replacement is `prodmangmeeplus`.
- The project has one human operator, so Production will use a constrained owner-only one-off workflow instead of the two-person broad T2 writer path.
- The protected user/role row remains; effective revocation is credential disable plus active-session revocation.
- Credentials, tokens, hashes, and database URLs stay out of repository artifacts and workflow logs.
- Owner explicitly renewed only the exact `CVE-2026-14456`/OpenSSL 3.0.20 provider-mapping waiver through `2026-08-27T00:00:00Z`; every other HIGH/CRITICAL finding remains blocking.
Open questions:
- None for implementation. Production `REVOKE` waits for owner confirmation that the temporary password was changed.
Artifacts:
- `docs/specs/system-admin-cutover-spec.md`
- `docs/plans/system-admin-cutover-plan.md`
- `.github/workflows/system-admin-cutover.yml`
- `apps/api/prisma/system-admin-cutover.ts`
- `infra/prod-ecs-express/system-admin-cutover.spec.sh`
- UAT replacement user id: `cmt8cpfkd000066k18ekt5rqy`
Verification:
- 2026-08-25 UAT: `uatmangmeeplus` login and `SYSTEM_ADMIN` resolution passed; owner changed the temporary password.
- UAT old credential is `DISABLED`; 27 active sessions were revoked; active session count is zero; audit request `UAT-SYSTEM-ADMIN-CUTOVER-20260825` succeeded.
- UAT API/Web, AI Gateway, and Workers are parked at `0/0`; all close deployments succeeded and no tasks remain running.
- 2026-08-25 local: full workspace typecheck passed after the same contracts build used by CI.
- 2026-08-25 local: full workspace test suite passed.
- 2026-08-25 local PostgreSQL: fresh-clone migrations applied; ADD/fresh-only/replay/readiness/REVOKE/session tests passed (2/2).
- 2026-08-25 local: release-task/workflow render contract passed; `git diff --check` passed.
- Production workflow candidate `6e9ba816ab3642c5163fad979e2730d1bfba146e` passed PR CI run `32826570842`, merged through PRs `#229` and `#230`, and reached `main` controller `8cf66bd07259f22f396d3ac73229b2d59cd1f8ea`.
- UAT run `32829457833` attempt 1 failed before mutation because UAT was parked; after opening and passing the canonical preflight, attempt 2 failed before deploy because the exact ECR waiver expired at `2026-08-25T00:00:00Z`.
- Attempt 2 reproduced only `CVE-2026-14456`, provider severity `HIGH`, source package `openssl` `3.0.20-1~deb12u2`; OpenSSL's vendor range starts at 3.5.0. UAT was read back parked at `0/0` after failure.
- 2026-08-25 waiver renewal: focused ECR policy, Production Security Preflight, signed-evidence, maintenance-pin check, `git diff --check`, and the full production image security scanner all passed.
Next:
- Pass focused checks and required CI for the exact expiring waiver renewal, then merge its new candidate through protected branches.
- Open UAT, produce a fresh signed Passport from one new dispatch, record the automatic READY run, and park UAT again.
- Run Production `ADD`, hand off the temporary password, then run `REVOKE` after owner password change.
