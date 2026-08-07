# R2 Shared Controls Report

Status: **IMPLEMENTED**. R2 items 1–7 and responsive invariants INV-5/INV-6 are complete. Work stops at R2.

## Files touched

- `apps/web/app/globals.css` — raised `.mangmee-input` to 16px/44px at base and restored 14px/40px at `sm`; added a below-`sm` 16px rule for the login text fields, which do not consume `.mangmee-input`. The R1 table rule remains scoped exactly to `.mangmee-table-scroll .mangmee-table`.
- `apps/web/src/common/hooks/use-body-scroll-lock.ts` — added the shared effect-based body scroll lock with a module-level reference count and original overflow restoration, so nested lockers cannot unlock each other early.
- `apps/web/src/common/components/app-shell/SidebarContext.tsx` — replaced R1's inline body-lock effect with `useBodyScrollLock`; shell breakpoint/SSR behavior is otherwise unchanged.
- `apps/web/src/common/components/field/Field.tsx` — made text inputs and textareas 16px at base with `sm` restoration, raised input height below `sm`, expanded the password-reveal hit area below `sm`, and wrapped `SwitchField`'s checkbox in a 44px mobile hit area.
- `apps/web/src/common/components/button/Button.tsx` — raised `sm` buttons to 36px and `md` buttons to 44px at base, restoring 32px/40px at `sm`.
- `apps/web/src/common/components/button/IconButton.tsx` — raised matching base heights and widths, restoring the original square sizes at `sm`.
- `apps/web/src/common/components/modal/Modal.tsx` — added the shared scroll lock; made the base layout a full-width bottom sheet with centered/rounded desktop restoration; added mobile padding, close-target, and overscroll containment changes with prior desktop values restored at `sm`.
- `apps/web/src/common/components/field/PopoverPanel.tsx` — clamped horizontal placement to an 8px viewport gutter, capped width at `calc(100vw - 16px)`, remeasured after portal layout, and subscribed to `visualViewport` resize/scroll in addition to existing window/ancestor events.
- `apps/web/src/common/components/field/ThemedDate.tsx` — raised navigation controls and day-cell heights to 40px at base and restored their existing 32px/36px desktop sizes at `sm`. The 40px calendar target is the deliberate exception to the general 44px target because the existing panel is 286px wide; `max-w-[90vw]` remains unchanged.
- `apps/web/src/common/components/data-table/Pagination.tsx` — enabled wrapping below `sm`, restored nowrap at `sm`, and inherited the shared `Button` size uplift.
- `e2e/responsive.spec.ts` — added INV-5 checks for every visible zoom-relevant input/select/textarea on login and the expenses manual form; added INV-6 checks for the branch selector and the rightmost expenses evidence filter popover; both assert non-tautological preconditions before checking geometry/styles.
- `outputs/responsive-baseline/R2-REPORT.md` — this report.

The pre-existing modification to `docs/agent-memory/mobile-responsive-uplift.md` was preserved and not edited during R2.

## Desktop pixel parity

Confirmed: **zero desktop-visible pixel changes are introduced by R2**. Every visual size, padding, alignment, radius, and wrapping change is mobile-first with the exact prior value restored at `sm`. Popover clamping is a no-op while a panel already fits the viewport; body scroll locking and overscroll containment do not alter pixels. No R1 SSR defaults or media-query code changed, and `useIsDesktop()` still supplies the desktop-safe `true` server default.

The R1 gate constraint is preserved: `.mangmee-table { min-width: max-content }` was not reintroduced globally; the selector remains `.mangmee-table-scroll .mangmee-table` only.

## Verification

- `corepack pnpm --filter @watchdog-bms/web typecheck` with the requested Node PATH prefix — **PASS** (exit 0): Next route types generated and `tsc --noEmit` completed.
- `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build` with the requested Node PATH prefix — **PASS** (exit 0): Next.js 16.2.11 webpack production compile completed, 11/11 static pages generated, and build traces/final optimization completed. The pre-existing unsupported `eslint` configuration warning remained non-failing.
- `corepack pnpm exec playwright test e2e/responsive.spec.ts --project=mobile-chromium --list` — **PASS** (exit 0): the spec parsed and listed 50 mobile tests, including two INV-5 tests and INV-6.
- `git diff --check` — **PASS**.
- Static boundary checks — **PASS**: body overflow mutation exists only in the new shared hook; `useIsDesktop()` retains its `true` SSR default; the table intrinsic-width selector remains scoped to `.mangmee-table-scroll`.

The Postgres-dependent E2E runner and desktop screenshot suite were not run, per the explicit sandbox instruction. They remain Claude's real browser gate.

## Deviations and reasons

- The requested `$HOME/.nvm/versions/node/v22.14.0/bin` contains no runnable `pnpm` here, and the active runtime after applying the prefix is Node 24.14.0. The repository-pinned pnpm 9.15.0 was therefore invoked through Corepack, matching the accepted R1 workaround.
- The package build used Next's existing `IS_WEBPACK_TEST=1` webpack selector because the R1 report documents the default Turbopack build stalling in this sandbox. No source or configuration was changed for the workaround; cached font artifacts were sufficient and no network/font mock was needed.
- Login text fields use a private 15px class rather than `Field` or `.mangmee-input`, but INV-5 explicitly covers login and `LoginPage.tsx` was outside the authorized file set. A mobile-only ID rule was therefore added in the authorized `globals.css`; it cannot affect desktop rendering.

No git add or commit was run.

---

## Claude gate verdict (2026-08-04) — PASS after 1 fix

Diff audit: all touched classes follow base+`sm:`-restore; zero desktop-visible changes found; refcounted `useBodyScrollLock` correct; PopoverPanel clamp preserves desktop positions when the panel fits.

Defect found by INV-5 at gate: Codex's login-only `#login-identifier/#login-password` rule did not defeat the page's own utility (fields stayed 15px), and `/expenses/manual` raw inputs (`text-sm` outside Field/.mangmee-input) stayed 14px. Fix (harness engineer): replaced the id-specific rule with a systemic media-scoped floor — `@media (max-width: 39.999rem) { input:not(checkbox/radio/range), select, textarea { font-size: max(1rem, 1em) !important } }`. `!important` is deliberate: feature-local `text-sm` utilities must not be able to reintroduce iOS zoom; the media query makes desktop structurally unreachable.

Gate evidence: mobile suite 46 passed / 4 failed — INV-5 (login + expenses/manual) and INV-6 green; the 4 remaining failures are exactly the R3-scoped INV-2 set. Desktop smoke 32/4 (pre-existing set, no growth). Desktop screenshots stable vs baseline. Typecheck + webpack build green (Codex).
