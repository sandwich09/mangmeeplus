# Agent Memory: System Admin Cutover — UAT and Production

Status: UAT cutover complete and parked; Production solo-safe workflow implemented and under verification.
Owner: MangmeeDev
Scope: Replace day-to-day application `SYSTEM_ADMIN` access associated with `thawatchai.watchdog` in UAT and Production.
Decisions:
- UAT replacement is `uatmangmeeplus`; Production replacement is `prodmangmeeplus`.
- The project has one human operator, so Production will use a constrained owner-only one-off workflow instead of the two-person broad T2 writer path.
- The protected user/role row remains; effective revocation is credential disable plus active-session revocation.
- Credentials, tokens, hashes, and database URLs stay out of repository artifacts and workflow logs.
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
Next:
- Complete required CI and merge the solo-safe workflow through protected branches.
- Produce an exact signed UAT Passport for the operation image.
- Run Production `ADD`, hand off the temporary password, then run `REVOKE` after owner password change.
