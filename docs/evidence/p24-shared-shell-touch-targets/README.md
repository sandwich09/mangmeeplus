# P24-2a — shared-shell touch targets

Captured 2026-08-27 on the local seeded OWNER dashboard, `http://127.0.0.1:3000/companies/seed-local-company/dashboard`. Web source: `codex/p24-shared-shell-touch-targets`; API: P9 baseline (same runtime code as develop d2b40f37). No external provider/cloud call or financial mutation.

| Screenshot | Viewport | Observed action/state |
|---|---|---|
| [Desktop notifications](desktop-notifications.jpg) | 1280×900 | Open bell; menu/bell 44×44; notification panel stays inside screen |
| [Desktop collapsed rail](desktop-collapsed-rail.jpg) | 1280×900 | Keyboard collapse, pointer off rail; rendered rail86px, page width1280 |
| [Tablet menu](tablet-menu.jpg) | 768×900 | Open compact drawer; 44px header toggle/bell |
| [Mobile menu](mobile-menu.jpg) | 390×844 | Keyboard-opened menu; focused close toggle and readable navigation |
| [Mobile notifications](mobile-notifications.jpg) | 390×844 | Loaded notification list; panel x12..378, bottom548; page width390 |

Root visually inspected the screenshots. Pointer/Enter/Escape were exercised. Console error/warn entries were empty. Opening the bell only reads notifications; no notification item or mark-all-read action was clicked. Viewport override was reset after testing.

Reproduce from the worktree with local API/web available:

```sh
corepack pnpm exec playwright test e2e/responsive.spec.ts --project=chromium --project=mobile-chromium --grep 'P24-2a' --workers=1
corepack pnpm exec playwright test e2e/responsive.spec.ts --project=mobile-chromium --grep 'INV-3|INV-6' --workers=1
corepack pnpm exec playwright test e2e/sidebar-nav.spec.ts --project=chromium --workers=1
```

Results: **16/16 + 3/3 + 5/5 passed**. The first run's desktop class assertions failed while hover-expansion remained active; the final suite checks initial geometry and real collapsed/hover widths. Four scoped cases emulate forced colors and prove visible focus outlines; this is not a physical Windows test. Fresh test contexts prevent UI state leaking between cases.

Limits: this is three shared-shell controls, not full P24, accounting acceptance, physical-device testing or production acceptance. Existing desktop collapsed-sidebar focus restoration, company/branch selectors and in-panel action sizing remain open. See [task memory](../../agent-memory/p24-shared-shell-touch-targets.md) for review/final verification.
