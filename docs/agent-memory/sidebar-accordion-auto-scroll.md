# Agent Memory: Sidebar Accordion Auto-scroll

Status: Implemented and verified — 2026-08-20
Owner: Codex
Scope: Keep a manually expanded sidebar accordion visible inside the responsive sidebar scroller.
Decisions:
- Route-change scrolling remains targeted at the active menu item.
- Manual expand scrolls only the sidebar nav container, by the minimum distance needed after the 300 ms height transition.
- Manual collapse does not scroll.
- Oversized submenus keep their trigger visible instead of trying to reveal an impossible full height.
Open questions: None.
Artifacts:
- `apps/web/src/common/components/app-shell/AppSidebar.tsx`
- `e2e/responsive.spec.ts`
Verification:
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/common/components/app-shell/AppSidebar.spec.ts`: 3 passed.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: passed.
- `corepack pnpm exec playwright test e2e/responsive.spec.ts --project=mobile-chromium --grep "INV-3"`: 2 passed.
- `corepack pnpm exec playwright test e2e/responsive.spec.ts --project=mobile-375 --grep "expanded bottom accordion"`: 1 passed.
- `corepack pnpm exec playwright test e2e/sidebar-nav.spec.ts --project=chromium --grep "NAV-04|NAV-05"`: 2 passed.
- `git diff --check`: passed.
Next: None; deploy remains separate.
