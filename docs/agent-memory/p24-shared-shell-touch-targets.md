# Agent Memory: P24 Shared-shell Touch Targets

Status: IMPLEMENTED / LOCAL BROWSER VERIFIED; branch-only from `32343c1d` (P9 PR #281, now merged; capture-first scope PR #282 merged as d2b40f37). Final scoped repo E2E 16/16 passed after review corrections. PR/CI integration pending.
Owner: Codex implementation agent; root owns integration, repo E2E and real Chrome evidence.
Scope: P24-2a only — shared company header/sidebar menu toggles and notification bell, 44×44 CSS px at every visible breakpoint. Subscription excluded; full P24 remains open.
Decisions:
- Read AGENTS and ponytail full. AGENTS' legacy `/Users/spare058/WatchDog-BMS` skill path is absent; used the repo's `.agents/skills/ponytail/SKILL.md` from the available-skill catalog.
- Docs-first contract is P24 spec §2.3.1 and P24-2a in the four-lane plan. Scoped `[desktop-visible]` exception overrides legacy mobile-project D2/D11 only for these three targets.
- Reuse existing `h-11 w-11`, focus-visible pattern and responsive fixtures; no new component, harness, dependency, package edit or mutation behavior.
- Keep notification permission gate, menu handlers, route/active-state logic and breakpoints unchanged. Existing focus restoration/collapsed-sidebar keyboard gaps are not claimed fixed.
Open questions: None for the bounded implementation. Root will review and run repo E2E/real Chrome; full real-device P24 remains separate.
Artifacts:
- `docs/specs/mangmee-growth-ux-full-pass-spec-th.md` §2.3.1
- `docs/plans/mangmee-four-lane-gap-closure-plan-th.md` P24-2a
- `AppHeader.tsx`, `AppSidebar.tsx`, `NotificationBell.tsx`: removed only responsive downsizing; kept 44px targets, added existing focus-visible style and header button type/expanded state.
- `e2e/responsive.spec.ts`: six P24-2a cases at 360/640/768/1023/1024/1280px, outside mobile-only describe. Presence/size/viewport, overflow before desktop collapse, pointer/Enter/Escape and unchanged URL; no notification item/financial mutation.
Verification:
- `corepack pnpm install --offline --frozen-lockfile --ignore-scripts` — pass; existing dependencies only, no package/lock changes.
- Config/contracts builds and `corepack pnpm --filter @watchdog-bms/web typecheck` — pass.
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test --test-reporter=spec src/common/components/app-shell/AppSidebar.spec.ts src/features/dashboard-notifications/dashboard-notifications.logic.spec.ts` — 8/8 pass, zero skips.
- `corepack pnpm exec playwright test e2e/responsive.spec.ts --project=chromium --grep 'P24-2a' --list` — six cases registered; listing only, not browser execution.
- Combined `chromium`/`mobile-chromium` listing — 12 registered cases. Active Next dev may regenerate `apps/web/next-env.d.ts` to `.next/dev/types/routes.d.ts`; that generated path change is not part of P24 and must be excluded before commit.
- `git diff --check` — pass. No browser/cloud operations performed by implementation agent.
Next: Rebase the scoped commit onto d2b40f37, then PR/CI to develop. Full P24/device matrix and the existing collapsed-sidebar keyboard restoration remain separate open work.

Root checkpoint 2026-08-27:
- New repo suite: 10/12 pass; desktop chromium 1024/1280 expect collapsed `w-[86px]` but got hover-expanded width. Mobile chromium all six and desktop compact four passed. Do not mark the suite green or merge until hover/pointer behavior is verified and assertions rerun.
- Real Chrome: 1280×900 and 768×900 scoped controls measured 44×44, no horizontal overflow; pointer/Enter/Escape notifications and compact menus exercised, no error/warn log. Mobile 390×844 open menu and notifications captured. Desktop manual collapse reached `w-[86px]`; existing hover behavior requires a separate precise test. Viewport override reset afterward.
- Screenshots in `docs/evidence/p24-shared-shell-touch-targets/`: desktop-notifications.jpg, tablet-menu.jpg, mobile-menu.jpg, mobile-notifications.jpg. Not yet a complete device-matrix/visual acceptance.
- User deferred reconciliation/integrations/P15–P17; P24 remains active for capture UX. New authoritative scope is being recorded on `codex/capture-first-delivery-scope`, not in this UI diff.

Final root verification 2026-08-27 (supersedes the failing first run above):
- Final P24-2a repo E2E **16/16 passed**: six breakpoints in both desktop/touch Chromium (12) plus forced-colors focus at 390/1280 in both projects (4). Collapsed/hover-expanded widths are polled rendered geometry (86/289px), with initial expanded-state precondition. Compact drawer closure uses exact class token + hidden state. Page overflow compares scrollWidth to clientWidth.
- Existing mobile INV-3/INV-6 regressions **3/3 passed**; existing desktop sidebar NAV suite **5/5 passed**. Full web suite **1125/1125**, zero skips, and web typecheck passed again on the final outline-corrected diff.
- Real Chrome settled viewports: 1280×900, 768×900 and 390×844; visible toggles/bell 44×44. Mobile notification panel left/right=12/378 within 390px, bottom548 within844px; settled page scrollWidth390. A synchronous measurement during resize briefly saw width414, but the settled DOM and repeat measurements were390; no permanent overflow is claimed from the transition sample. Desktop collapsed rail measured86 with page scrollWidth1280. Pointer/Enter/Escape exercised, browser errors/warnings empty. No notification item/mark-all-read or financial action was invoked. Viewport override reset.
- Claude CLI `--model opus --effort max` actual model `claude-opus-5` returned REQUEST CHANGES on the first supplied diff. Root addressed the real forced-colors regression with `focus-visible:outline-hidden` (Tailwind4), replaced width substring assertions with rendered geometry, and added forced-colors tests. Root verified the fixture creates a fresh context/page and SidebarProvider uses in-memory initial expanded state (no persistence), so the hypothetical cross-test persisted-state finding is not present; explicit initial geometry still guards it. Notification open only lists items; it does not mark them read. Sidebar/bell already have type=button. Do not relabel that initial Opus verdict as an approval.
- [Tailwind official outline migration](https://tailwindcss.com/docs/upgrade-guide#renamed-outline-utility) confirms why outline-hidden preserves the forced-colors outline while outline-none does not. No new dependency or global CSS rewrite.
- Screenshots visually inspected; [evidence README](../evidence/p24-shared-shell-touch-targets/README.md) records exact files and limits. Browser/Chromium emulation is not physical iOS/Android/iPad/Windows acceptance.
