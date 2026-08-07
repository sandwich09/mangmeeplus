# R1 Foundation + Shell Report

Status: **IMPLEMENTED**. R1 items 1–10 are complete. Web typecheck is green. The package build script is green with the sandbox-only offline-font and webpack flags documented below; the default Turbopack build could not complete under the available Node 24 runtime.

## Files touched

- `apps/web/app/layout.tsx` — exported the device-width, 1× scale, `viewport-fit=cover` viewport contract.
- `apps/web/app/globals.css` — added `--app-header-h`; converted the three shell/page `vh` heights to `dvh`; added safe-area-aware content padding at every existing padding rung; added the table scroll foundation and intrinsic table minimum; made segmented controls horizontally scrollable with hidden scrollbars; added the below-`sm` page-header/action stack.
- `apps/web/src/common/hooks/use-media-query.ts` — added the SSR-safe `useSyncExternalStore` media-query hook and the shared 64rem desktop boundary.
- `apps/web/src/common/components/app-shell/SidebarContext.tsx` — replaced the 768px resize listener with `useIsDesktop`; closes the mobile drawer at the 1024px boundary; locks and restores body scroll while the drawer is open.
- `apps/web/src/common/components/app-shell/AppSidebar.tsx` — aligned drawer offset/height to the header token; capped mobile drawer width; gated hover expansion to hover-capable devices; added Escape close; made the closed mobile drawer invisible, `aria-hidden`, and inert; increased base logout/collapse hit areas with `sm` restoration; added safe-area footer padding.
- `apps/web/src/common/components/app-shell/AppHeader.tsx` — consumed the header-height token; replaced the inline 1024px check with `useIsDesktop`; increased base hamburger/avatar hit areas with `sm` restoration; lowered the header to the documented shell z-index scale.
- `apps/web/src/common/components/app-shell/WorkspaceShell.tsx` — removed the inert `xl:flex` class.
- `apps/web/src/common/components/app-shell/SystemHeader.tsx` — made the navigation a no-scrollbar horizontal scroller below `md`, restoring its prior overflow/whitespace behavior at `md`.
- `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx` — constrained both dropdown widths to the viewport and used fixed right-edge-safe mobile positioning, restoring the original absolute left positioning at `sm`.
- `outputs/responsive-baseline/R1-REPORT.md` — this report.

`apps/web/src/common/components/app-shell/Backdrop.tsx` was inspected but did not need an edit: it already uses `z-40`; lowering `AppHeader` to `z-30` makes the existing backdrop dim/block the header while the drawer remains at `z-50`.

Pre-existing unrelated `apps/web/next-env.d.ts` and `test-results/*` worktree changes were preserved and are not R1 changes.

## Desktop-visible changes (exact list)

1. Drawer alignment: its 64px offset/height subtraction now consumes the shared 68px `--app-header-h`, fixing the 4px mismatch.
2. Header z-index: `z-[99999]` became `z-30`; the documented stack is header `z-30`, backdrop `z-40`, drawer `z-50`, modal/popover portals `z-[99999]+`.
3. `WorkspaceShell` no longer carries the inert `xl:flex` class (rendering no-op by analysis).

No other desktop-visible change is intended. Base touch/layout/position changes restore existing values at `sm`, `md`, or `lg`; safe-area insets evaluate to zero on ordinary desktop viewports. The handoff-mandated table and segmented foundations retain existing `width: 100%`/fitting behavior at desktop sizes.

## Verification

- `pnpm --filter @watchdog-bms/web typecheck` — **PASS** (exit 0): route types generated and `tsc --noEmit` completed.
- `pnpm --filter @watchdog-bms/web build` — **PASS with sandbox workaround** (exit 0): Next.js 16.2.11 webpack production compile completed, 11/11 static pages generated, build traces collected. The existing unsupported `eslint` key warnings remained non-failing.
- `git diff --check` — **PASS**.
- Static checks — no `100vh` remains in `globals.css`; `.mangmee-content { overflow-x: clip }` remains; no old 768/1024 inline shell width check remains.

No E2E runner, dev server, or manual browser screenshot pass was run, per instruction that the sandbox cannot reach Postgres and Claude owns all Playwright gates.

## Deviations and reasons

- The requested `$HOME/.nvm/versions/node/v22.14.0/bin` directory is absent. The only installed runtime is Node 24.14.0, and no `pnpm` shim is installed, so verification invoked the repository-pinned pnpm 9.15.0 through `corepack pnpm` after applying the requested PATH prefix.
- Default Next/Turbopack `pnpm ... build` entered `Creating an optimized production build ...` but produced no further output or artifact activity: two attempts were stopped after 15 minutes, and an offline-font attempt after 5 minutes. The sandbox also cannot resolve `fonts.googleapis.com`. To obtain a complete production-build signal, the successful package-script run used Next's `IS_WEBPACK_TEST=1` selector plus its official `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` offline test hook. A direct webpack diagnostic produced the same green result. No source/config file was changed for this workaround.
- `Backdrop.tsx` remains byte-identical because its existing `z-40` already satisfies R1 once the header is lowered; changing it would add an unnecessary diff.
- No R1 screenshots are attached because Playwright/browser gates belong to the harness engineer in this sandbox.

No git add or commit was run. Work stops at R1.

---

## Claude gate verdict (2026-08-04) — PASS after 2 fixes

Codex implementation reviewed file-by-file; two defects found and fixed by the harness engineer before commit:

1. **SSR sidebar flash (desktop parity violation)** — `useIsDesktop` server snapshot was `false`, so desktop SSR HTML rendered the sidebar collapsed (86px) and animated open after hydration on every load. Fixed: `useMediaQuery(query, serverDefault)` with `useIsDesktop` passing `true`. Bonus: the R0 baseline dashboard screenshot shows the OLD code had this flash too — R1 now renders the expanded sidebar deterministically.
2. **`.mangmee-table { min-width: max-content }` desktop regression** — screenshot diff showed `/accounting` losing PAYMENT/POSTING columns and `/reimbursements` pushing its action column off-screen on desktop (unwrapped/legacy-wrapped tables widened). Fixed: scoped to `.mangmee-table-scroll .mangmee-table` only; legacy tables keep today's rendering until R3 migrates them site-by-site.

Gate evidence (full run after fixes):
- Mobile `responsive.spec.ts`: 43 passed / 4 failed — the 4 failures are exactly the R3-scoped INV-2 clipped tables (`/accounting`, `/sales-documents`, `/inventory/products`, `/settings/crm-catalog`). **INV-3 drawer suite now green** (open/close, backdrop, Escape, body scroll-lock).
- Desktop smoke: 32 passed / 4 failed — identical to the R0 pre-existing set; no growth.
- Desktop screenshot parity vs R0 baseline: `reimbursements` and `accounting` byte-identical; `settings` identical; `journal` ±2 bytes; `expenses` −0.5% (smoke-created seed rows); `dashboard` differs by the tagged [desktop-visible] flash fix only.
- Web typecheck green after both fixes.
