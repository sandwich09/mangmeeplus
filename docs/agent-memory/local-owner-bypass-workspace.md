# Agent Memory: Local Owner Bypass Workspace

Status: COMPLETE / VERIFIED (2026-06-25)
Owner: Codex
Scope: Web-only temporary login bypass for local workspace access. Backend auth/RBAC remains enforced.

Role gate status:
- BA: Goal is let the user enter the workspace without login for now and see every menu as company OWNER. Target user is project owner/local operator. Journey: open `/`, click workspace, land on owner company dashboard, navigate all modules. Rule: this is temporary local/product-preview bypass, not production auth policy. Acceptance: no `demo-company` entry path, every menu visible/clickable, old demo route redirects.
- SA: Architecture fit is frontend-only session fallback using existing `WebSession`, module registry, permission filter, and Next route redirect. No backend permission, Prisma, token, or ABAC changes. State transition: `demo-company` route -> `owner-company`; missing web session -> local OWNER session. Scope boundary: API calls still require real backend/dev token when backend is used.
- DEV: Ponytail read. Smallest correct diff added `local-owner-session.ts`, wired owner fallback into workspace layout, made non-disabled modules clickable, changed root card link to `owner-company`, redirected `demo-company`, and replaced raw dashboard 404 text with a clearer backend/API-not-ready message.
- Integration: Web typecheck/test/build pass. Localhost smoke verified root link uses owner company, demo route redirects, owner dashboard renders company context and all Thai menu labels. Visual browser automation tool was not exposed, so verification used HTML smoke.

Decisions:
- Temporary bypass lives only in `apps/web`.
- Company id is `owner-company`; header label is `Owner company`.
- `demo-company` is redirected to `/companies/owner-company/dashboard`.
- Planned modules are clickable unless explicitly `disabled`, because placeholder/feature routes already exist and owner asked for all menus.
- No fake dashboard or notification data was added; API unavailable state stays honest.

Open questions:
- None.

Artifacts:
- `apps/web/app/(workspace)/companies/[companyId]/layout.tsx`
- `apps/web/src/features/platform-foundation/platform-foundation.constants.ts`
- `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx`
- `apps/web/src/features/web-core-workspace/local-owner-session.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
- `apps/web/src/features/dashboard-notifications/dashboard-notifications.api.ts`
- `docs/agent-memory/local-owner-bypass-workspace.md`

Verification:
- `pnpm --filter @watchdog-bms/web typecheck`: pass.
- `pnpm --filter @watchdog-bms/web test`: sandbox run failed with `listen EPERM` on tsx IPC pipe; escalated rerun passed 93/93.
- `pnpm --filter @watchdog-bms/web build`: pass.
- Temporary dev server started on `http://127.0.0.1:3003` because port 3000 was already in use.
- Localhost smoke `/`: 200, includes `/companies/owner-company/dashboard`, no `/companies/demo-company/dashboard`.
- Localhost smoke `/companies/demo-company/dashboard`: 307 to `/companies/owner-company/dashboard`.
- Localhost smoke `/companies/owner-company/dashboard`: 200, includes `Owner company` and all module labels (`แดชบอร์ด`, `คลังสินค้า`, `บัญชี`, `ค่าใช้จ่าย`, `ภาษี`, `ลูกค้า`, `รายงาน`, `เวิร์กโฟลว์`, `ตั้งค่า`).

Next:
- When real login/session is ready, replace `createLocalOwnerSession` fallback with `GET /v1/auth/me` and remove the `demo-company` redirect.
