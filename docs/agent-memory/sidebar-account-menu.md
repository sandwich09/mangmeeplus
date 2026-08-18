# Agent Memory: Sidebar Account Menu

Status: Implemented and verified — 2026-08-18
Owner: Codex
Scope: Move authenticated account actions from the workspace header avatar to the user-identity row at the bottom of the responsive sidebar.
Decisions:
- The header keeps company/branch controls and notifications, with no duplicate user avatar.
- Clicking the sidebar footer identity toggles one menu above it, ordered `Reset password` then `ออกจากระบบ`.
- The existing `/change-password` destination, permission gate, logout confirmation, failure dialog, and session helper remain unchanged.
- The menu closes on outside click or Escape through the existing shared hook; no dependency or new shared abstraction was added.
Open questions: None.
Artifacts:
- `apps/web/src/common/components/app-shell/AppHeader.tsx`
- `apps/web/src/common/components/app-shell/AppSidebar.tsx`
- `apps/web/src/common/components/app-shell/WorkspaceShell.tsx`
- `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx`
- `apps/web/src/common/components/app-shell/AppSidebar.spec.ts`
- `e2e/login.spec.ts`
- Account-security and workspace-shell source docs.
Verification:
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/common/components/app-shell/AppSidebar.spec.ts`: 3 passed, 0 failed.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: passed.
- `git diff --check`: passed.
- Local browser at 390x844: header had notification only; hamburger drawer footer showed the user identity; opening it showed `Reset password` above `ออกจากระบบ`; logout opened the existing confirmation dialog.
- Local desktop browser: user-menu trigger count was 0 in `header` and 1 in `aside`.
Next: None; deploy remains a separate operation.
