# Agent Memory: employee-access-draft-provisioning

Status: IMPLEMENTED, MIGRATED, AND LIVE-VERIFIED LOCALLY.
Owner: Product / Customer Owner/Admin.
Scope: Prevent incomplete Settings > Add Employee wizard runs from becoming active employees or blocking a later retry with the same Thai ID/passport.

Decisions:
- Step 3 -> credential handoff persists `EmployeeAccessProfile` and `CompanyMembership` as `DRAFT`; active-membership resolution already filters strictly to `ACTIVE`, so drafts fail closed without a second authorization mechanism.
- The same company + identity hash resumes only a `DRAFT`. Any non-draft match remains a blocking duplicate.
- Resuming a draft refreshes its pending fields, role assignment, temporary credential, and LINE-link token in one transaction; prior pending link tokens are revoked.
- Finish uses `POST /companies/:companyId/settings/employees/:employeeId/complete` and atomically changes profile + membership from `DRAFT` to `ACTIVE`.
- Individual access shows a `Draft` badge, allows profile editing from the three-dot menu, disables the account toggle for drafts, and the status use case rejects every direct transition out of `DRAFT`.
- The three-dot edit action opens the same four-step wizard as Add Employee. It edits personal data, contact/full address, identity replacement, role, and branches; identity values remain masked on reads and replacements reuse the existing hash/encryption path.
- The shared add/edit address step lazily queries `ThaiAddressMaster` after a 300ms debounce from the first three postal-code digits (prefix search through five digits), then cascades province -> district -> subdistrict; unmatched postal codes retain free-text entry for compatibility.
- UAT follow-up 2026-07-29: the handoff screen keeps the LINE QR hidden while the employee is still `DRAFT`; Finish activates the profile/membership without navigating away, then exposes the QR so the employee cannot scan before the active-membership guard can succeed.
- Reused the existing `MembershipStatus` enum, employee create permission, credential generation/encryption, audit actions, and active-membership guard. No dependency or parallel provisioning model was added.

Open questions: None.

Artifacts:
- Prisma schema/migration: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260711090000_employee_provisioning_draft/migration.sql`.
- API: create/complete and status use cases, controller, and focused specs under `apps/api/src/modules/employee-access`.
- Web/contracts: `packages/contracts/src/employee-access.ts`, `employee-access.api.ts`, `AddEmployeePrototypePage.tsx`, `EmployeeAccessPages.tsx`, `IndividualPermissionsPrototypePage.tsx`.
- Full-address migration: `apps/api/prisma/migrations/20260711150000_employee_profile_full_address/migration.sql`.
- Thai address master: `apps/api/prisma/migrations/20260711190000_thai_address_master/migration.sql`, sync script/data, lookup use case/API, and the shared employee wizard.
- Docs: employee access spec, plan, master checklist, implementation roadmap, this memory.

Verification:
- `./node_modules/.bin/tsx --test apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.spec.ts` — pass, 14/14 (including create-as-draft, resume same identity, complete-to-active, and non-draft duplicate block).
- `./node_modules/.bin/tsx --test apps/api/src/modules/employee-access/application/use-cases/employee-lifecycle.use-case.spec.ts` — pass, 8/8 (including rejecting direct draft activation).
- `corepack pnpm --filter @watchdog-bms/api typecheck` — pass.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — pass.
- `./node_modules/.bin/tsx --test apps/api/src/modules/employee-access/application/use-cases/update-employee-branch-scope.spec.ts` — pass, 10/10 (including encrypted identity replacement and duplicate rejection).
- Combined employee-access focused run — pass, 32/32 across create/resume/complete, lifecycle guard, branch/role update, and identity editing.
- `corepack pnpm --filter @watchdog-bms/api prisma:validate` — pass.
- Migration reviewed and applied to Docker Postgres `watchdog_bms` on 2026-07-11; only `20260711090000_employee_provisioning_draft` was pending.
- `git diff --check`: pass.
- Existing incomplete local employee `นายมีนา2 ค้าข้าว2` was verified to have no active session or linked identity, then remediated from `ACTIVE/ACTIVE` to `DRAFT/DRAFT` with an audit row.
- Follow-up 2026-07-11: audit confirmed the record had already left `DRAFT` through the status endpoint before the first guard was deployed. The guard now rejects every draft status transition; the exact record was restored to `DRAFT/DRAFT` with a second audit row.
- Local API/Web images rebuilt and restarted. Live API smoke passed: first create `201` -> second create with the same identity `201` and same `employeeId` -> complete `201 ACTIVE`; synthetic smoke rows were removed afterward.
- Live list API returns the remediated employee with `status: DRAFT`; running Web bundle contains the new `บันทึกแบบร่าง` flow.
- Rebuild surfaced an unrelated local-only startup gap: the current AI Gateway image requires a non-empty Bedrock region even while the provider is disabled. `compose.local.yml` now defaults `BEDROCK_REGION` to the same local region used elsewhere (`ap-southeast-1`); runtime restored healthy.
- API, Web, and AI Gateway images were rebuilt after the Draft badge/edit/status-guard follow-up; all local containers are running and API/AI Gateway report healthy.
- Full-address migration `20260711150000_employee_profile_full_address` was applied to local Docker Postgres; API/Web images were rebuilt with the four-step edit wizard and containers restarted successfully.
- Live status smoke: attempting `DRAFT -> ACTIVE` returned `409`; database remained `DRAFT/DRAFT`, and the employee list API returned `status: DRAFT`.
- UAT LINE activation follow-up: Web typecheck passed; focused Playwright `SET-03A` passed and verifies no QR while `DRAFT`, Finish activation keeps the handoff visible, QR appears after `ACTIVE`, then overview navigation succeeds.
- Thai address integration: focused lookup use-case test passes (1/1); contracts build, API typecheck, direct Web TypeScript check, Prisma validation, and `git diff --check` pass. The full Web typecheck's `next typegen` hit the host's `ENFILE` file-table limit, so `tsc --noEmit` was run directly and passed.
- Postal prefix lazy search follow-up: API accepts 3-5 digits with `startsWith`; the shared Web wizard debounces requests by 300ms. Focused API test (1/1), API/Web typechecks, and `git diff --check` pass.
- Local database/API smoke for the new address lookup was not run because Docker Desktop was not running; production startup already runs migration deploy followed by `sync-thai-address-master.ts`.
- Combined App Runner boot fix: `infra/prod-app-runner/Dockerfile.api-web` now generates the API Prisma client before Turbo build. Without this step the combined image reused a stale generated client, so migration and raw upsert passed but `prisma.thaiAddressMaster.count()` crashed because the model accessor was missing.
- Focused Dockerfile order check confirms Prisma generation precedes the combined API/Web build; `git diff --check` passes. Container rebuild was not run because Docker Desktop is unavailable.

Next:
- Start/redeploy the runtime, then verify postal code `10110` returns linked Bangkok district/subdistrict choices in both Add Employee and Edit Employee.
