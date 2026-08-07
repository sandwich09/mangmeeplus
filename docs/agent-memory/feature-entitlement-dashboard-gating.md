# Agent Memory: Feature-entitlement dashboard/nav gating + admin info icons

Status: Deployed to prod (commit df49a553, 2026-07-08) — see Deploy note at end
Owner: develop
Scope: Make the workspace dashboard tiles honor feature entitlements, gate reimbursement, and explain each toggle in the admin panel.

Decisions:
- Dashboard "เมนูที่คุณเข้าถึงได้" (`CompanyDashboardPage`) was hardcoded — rendered all 15 tiles despite the "permission-aware" subtitle. Now filters the curated tile list through `filterModulesByPermissions(WORKSPACE_MODULES, session.permissions)`, the same gate the sidebar uses. `dashboard/page.tsx` fetches session (extra `/auth/me`; ponytail: avoids context plumbing).
- `expenses` module (ค่าใช้จ่าย+ใบเสร็จ) no longer lists `reimbursement.read` in `requiredAnyPermissions` — that ungated perm leaked the menu when `expenses` was off. Now gated purely by `expenses`.
- Reimbursement (การเบิกจ่าย) packs have no `featureEntitlementKey` (their perms were "ungated" / always-on). Added a prefix rule `reimbursement.` → `['expenses','procurement']` in `feature-gate.logic.ts`, and made PREFIX_FEATURE_RULES checked BEFORE the ungated early-return so it overrides pack membership. OR semantics (either spending feature unlocks it). Rule shape changed `featureKey` → `featureKeys: readonly string[]`.
- Admin Feature Entitlements panel: extracted `FeatureEntitlementsSection` with an ⓘ per feature; click toggles a `FEATURE_IMPACT[key]` blurb (Thai) describing menus unlocked + that disabling denies APIs for every role incl. Owner.

Resolved (user-confirmed):
- การเบิกจ่าย → expenses OR procurement (kept as implemented).
- กล่องข้อความ (inbox) → crm. Added prefix rule `crm.` → ['crm'], which also gates the previously-ungated crm.inbox/channel/template perms (no capability pack). Already-packed crm.* stay crm-gated, so equivalent for them.
- AI แนะนำ (ai-suggestions module) → ai_line_assistant. Added prefix rules `ai.suggestion.`/`ai.draft.` → ['ai_line_assistant'] (these perms had no pack; core ai.tool.invoke/line.ai.query are in pack.core.basics and don't match the prefixes, so they stay on).
- Dashboard KPI cards now feature-aware too: each KPI carries requiredAnyPermissions (sales→accounting.invoice/document.read, bills→same, booking→crm.customer.read, receipts→expense.read/read_own/review) and is filtered by session.permissions like the tiles. Only-expenses → only "ใบเสร็จรอตรวจ" shows.

Artifacts:
- api: modules/employee-access/domain/logic/feature-gate.logic.ts (+ .spec.ts)
- web: features/dashboard-notifications/DashboardPages.tsx, features/web-core-workspace/{constants,components/WorkspaceDashboardPage}.tsx, app/(workspace)/companies/[companyId]/dashboard/page.tsx, features/system-partners/PartnerDetailPage.tsx

Verification:
- `tsx --test feature-gate.logic.spec.ts permission-resolver.spec.ts` → 21 pass (reimbursement + crm-inbox gates). web-core-workspace.spec.ts → 14 pass. web `tsc --noEmit` → 0.
- Live resolver against seed-local-company OWNER (297 perms): only-ai_line_assistant → dashboard tiles {roles, discount, notifications} (inbox/expenses/reimbursement hidden); crm on → inbox back; procurement-only → reimbursement shown, expenses+inbox hidden.

Next: user reviews in local (Next dev hot-reloads); deploy is deferred.

## Follow-up: real owner name + company switcher (same session)
- Owner name was hardcoded "นภา" (dashboard greeting + WorkspaceLayout userName hack). Root cause: `/auth/me`
  returned no name. Added `displayName` to `GET /auth/me` (auth.controller.ts me() — now async, queries
  User.displayName), to `WebSession` type, and threaded it: dashboard greeting `สวัสดี {displayName}`,
  `WorkspaceLayout userName={session.displayName}` (dropped the COMPANY_VIEW→'นภา' hack). Sidebar footer +
  avatar now show the real name.
- No company switcher existed. Backend `GET /auth/me/companies` already returns `{companyId, companyName,
  roles}[]` — added a client `CompanySwitcher` (features/web-core-workspace/CompanySwitcher.tsx) in the top
  bar (companyArea, before BranchSelector): shows current company name; if the user has 2+ active
  memberships it's a dropdown that `router.push(/companies/<id>/dashboard)` (per-company session re-resolves
  in the layout, the already-proven path — no backend switch endpoint needed).
- Verified in browser (dev sign-in = seed OWNER "Local Owner"): greeting "สวัสดี Local Owner", switcher shows
  the company name; with a temp 2nd membership the dropdown listed both companies (temp membership removed
  after). web tsc 0, auth-endpoints spec 15/15.

## Follow-up 2: branch selector + workspace-scope auth fix (same session)
- Root cause branches/switcher never loaded: `workspace-scope.api.ts` used the OLD auth pattern
  (localStorage bearer token via getAccessToken + cross-origin direct call to :3001), and
  `WorkspaceScope.tsx` guarded both fetches with `if (!getAccessToken()) return;`. Cookie sessions have
  no localStorage token → guard bailed → no fetch. Fixed: migrated the api to `authedApiFetch` (same-origin
  `/api/v1/*` BFF + httpOnly cookie), fetchMyContext passes X-Company-Id header; removed the getAccessToken
  guards + export. This fixes the branch filter AND the pre-existing (dead) CompanySwitcher for everyone.
- Consolidated switchers: there was already a `CompanySwitcher` in WorkspaceScope.tsx (unused). Deleted my
  duplicate features/web-core-workspace/CompanySwitcher.tsx and wired the existing one in WorkspaceLayout
  (`<CompanySwitcher companyId fallbackName={companyName} />`).
- Data: seeded branches (scratchpad seed-branches.ts) — seed-local-company +สาขาสีลม/สาขาลาดพร้าว (has HO),
  demo-second-company +สำนักงานใหญ่/สาขาสีลม/สาขาลาดพร้าว. Verified: branch <select> shows 4 options
  (ทุกสาขา + 3), switcher works, web tsc 0.

## Follow-up 3: branch dropdown styling (same session)
- User: native `<select>` branch selector's popup used OS-default look (system font/checkmark), off-theme next
  to the custom CompanySwitcher. Replaced the `<select>` in `BranchSelector` (WorkspaceScope.tsx) with the
  same custom button+menu pattern CompanySwitcher already uses (rounded-xl, shadow-theme-md, brand-700 active
  row + ✓, w-64, local `open` state). Locked/≤1 case unchanged (already a themed chip). Extracted
  `branchLabel()` + `<BranchIcon>` helpers. Verified in browser: dropdown card radius 12px, shadow, 4 items,
  select→label updates + persists to localStorage + menu closes; web tsc 0.

## Deploy (2026-07-08)
- Committed df49a553 (14 files, explicit paths — shared worktree, never `git add -A`), pushed to
  origin/develop. Deployed `api-web` only via `infra/prod-ecs-express/deploy.sh api-web`
  (web + API auth/permission both live in that image; workers/ai-gateway hit the API over HTTP so no
  rebuild). Image `watchdog-bms-api:ecs-api-web-df49a553`.
- Canary bake ran ~8 min IN_PROGRESS → SUCCESSFUL (no rollback). Monitored via ECS
  `describe-service-deployments` — did NOT probe the endpoint during bake (ALB 4xx% RollbackAlarm).
  Verified after promotion: one GET https://mangmeeplus.com/v1/health → 200 {"status":"ok","db":"ok"},
  SSM /watchdog-bms/production/service-version = df49a553.
- Seeds NOT shipped (per user): scratchpad seed scripts are outside the repo (not in Docker build
  context) and the deploy runs no DB seed/migration — demo-second-company + seeded branches + local
  entitlement toggles stay in the local docker DB only.
