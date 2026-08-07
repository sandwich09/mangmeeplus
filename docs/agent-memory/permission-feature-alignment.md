# Agent Memory: permission-feature-alignment

Status: DONE (code + local verify) — pending deploy to prod
Owner: Claude session 2026-07-11
Scope: Align permissions with enabled features (crm, ai_line_assistant, expenses = the Mangmee baseline); let Manager edit day-to-day employee settings safely.

Decisions:
- `GetAccessMatrixUseCase` now applies `loadEntitledFeatureKeys` + `filterPermissionsByEntitlement` (same chokepoint as the session resolver, AC-FE-2) so the สิทธิ์รายบุคคล page ("เมนูที่…จะเห็นจริง" + toggles) no longer shows menus of disabled features (e.g. รายงานการเงิน for SALES when `reports` is off).
- New prefix rule `crm.ai.` → `ai_line_assistant` (BEFORE `crm.` — first match wins) so inbox AI assist follows the AI toggle, not the CRM toggle.
- MENU_REGISTRY broadcast `view` = `crm.report.read`, mirroring the workspace sidebar gate; `crm.campaign.*` write keys stay forward-declared.
- MANAGER role grants += `access.employee.update`, `access.employee.disable` (role/status/branch edits on สิทธิ์รายบุคคล). Role definitions + credential issuance stay Owner/Admin.
- Escalation guard (`PRIVILEGED_GRANT_KEYS` + `hasPrivilegedGrant`, canonical in `packages/contracts/src/access-matrix.ts`, re-exported by `employee-access.logic.ts`): requester without `access.role.manage` cannot (a) assign a role granting people-manage keys, nor (b) suspend/disable a holder of one. Also hard rules: OWNER/SYSTEM_ADMIN targets — role assignment never changeable, status never changeable from employee management (last-owner lockout protection).
- Controllers pass `requesterPermissions: ctx.permissions` (placed AFTER `...body` spread; whitelist ValidationPipe also strips it).
- Web สิทธิ์รายบุคคล page takes `viewerPermissions` (from `fetchServerSession` in the page server component); controls disable per `access.employee.update`/`access.employee.disable`, role picker hides OWNER/SYSTEM_ADMIN and (for non-`access.role.manage` viewers) privileged roles.

Open questions: none.

Artifacts:
- apps/api/.../get-access-matrix.use-case.ts (+spec), feature-gate.logic.ts (+spec), update-employee.use-case.ts, set-employee-status.use-case.ts, employee.controller.ts, employee-access.logic.ts, permission-registry.ts (+lifecycle/branch-scope specs)
- packages/contracts/src/access-matrix.ts (broadcast view key, PRIVILEGED_GRANT_KEYS, hasPrivilegedGrant)
- apps/web/.../IndividualPermissionsPrototypePage.tsx, app/(workspace)/.../settings/access-overview/page.tsx
- .claude/launch.json += web-verify-3003

Verification:
- API unit: 37/37 pass (tsx --test on the 5 touched spec files); `tsc --noEmit` clean on api + web; web suite 222/222.
- Local DB synced via `prisma/sync-permissions.ts` (1211 grants upserted; MANAGER now carries update/disable — confirmed in issued JWT).
- E2E on api-verify-3011 + web-verify-3003 with dev tokens: Manager assign SALES→200, assign ADMIN→403, suspend Sales→201/201, suspend fellow Manager→403; browser as Owner shows Sales "จะเห็นจริง" WITHOUT รายงานการเงิน (entitled = expenses,crm,ai_line_assistant) and WITH บรอดแคสต์; browser as Manager (ไนซ์) shows enabled role picker/status toggle with Admin/Manager/System Admin hidden.

Next:
- Deploy: prod boot runs sync-permissions after migrate deploy, so MANAGER grants + guards ship with the image. No manual step.
- Note: concurrent session added employee DRAFT wizard guard in set-employee-status (Conflict on DRAFT→ACTIVE) — merged cleanly, tests green together.
- Future: if per-person overrides (สิทธิ์เฉพาะบุคคล) ship, reuse PRIVILEGED_GRANT_KEYS for its granter-scope rule.
- Owner clarification 2026-07-15: this future path must use a real membership-level override store/API/audit and the shared runtime resolver; the disabled switches must not become local-only state. The expense surface is the regression case: show `expense.receipt.line_upload` explicitly instead of treating generic `ค่าใช้จ่าย+ใบเสร็จ` visibility or `expense.create` as proof, and test UI effective access against the LINE webhook decision. Protected system-role defaults remain registry → DB sync.
