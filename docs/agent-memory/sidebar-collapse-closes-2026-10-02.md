# Agent Memory: sidebar collapse closes at once

Status: Fix and tests committed on `claude/sidebar-collapse-closes-20261002` (from `origin/develop` `608b4a6f5`). Not pushed, not merged, not deployed.
Owner: Claude (sidebar lane), handed over to the coordinator of 2026-10-02.
Scope: One behaviour of the desktop workspace sidebar (1024 px and wider). Pressing its collapse button must close it to the 86 px rail at once, also while the pointer rests on it and also from the keyboard; hover opens it again only after the pointer has left and come back. Pinning open, hover opening over the page, the 44 px targets, the drawer below the desktop width, the page margin, reduced-motion handling and focus handling are unchanged.

Decisions:
- Cause, measured in Chromium 149 with the browser's own events written down: the press does collapse the sidebar, but the collapse button (like every label, submenu and the plan card) is mounted only while the sidebar is wide, so the press removes it from under the resting pointer. About 25 ms later the browser reports that pointer again (`mouseover` whose `relatedTarget` is the removed element), React turns a `mouseover` from an element it no longer manages into `onMouseEnter` on every ancestor, and `AppSidebar.tsx` opened the collapsed sidebar by hover: 39 ms after it had collapsed, so its width never visibly changed while the page slid to its 86 px margin underneath.
- The keyboard goes through the same click. It failed the same way whenever the pointer rested on something the collapse removes (the button, a menu label, the brand name), and worked when the pointer rested elsewhere. Focus has no part in the width.
- WebKit 26.5 differs: after a removal it reports the pointer as coming from nowhere (`relatedTarget` null), and when the pointer has ended up outside the sidebar it reports no leave at all. The mouse press never failed there; one keyboard case did (pointer on the brand name, inside the future rail).
- Chosen: a flag in `AppSidebar` (a ref) raised by a collapse press made with the pointer on the sidebar (`aside.matches(':hover')`, the browser's own answer, so a keyboard press with the pointer elsewhere raises nothing). While it is up only an entry coming from an element still in the page counts as the pointer arriving (`isPointerArrival` in `app-sidebar.logic.ts`); it goes down when the pointer leaves or arrives.
- Dropped: (a) ignoring only an enter that comes from a removed element: misses WebKit's entry from nowhere; (b) a plain "closed until the pointer leaves" flag, or tracking pointer-inside: WebKit's unreported leave would keep the flag up and the pointer's real return would be ignored; (c) a reducer in `SidebarContext`: a new shape for the web app, in state shared with the header, the backdrop and the page margin.
- Known ceiling (marked `ponytail:` in the code): when the browser reports no leave, one entry from outside the window is ignored until the pointer leaves again.
- `WorkspaceLayout.tsx` (changed the same day by the billing lane) is not touched. The LINE-AI capability manifest hashes none of the changed files.

Open questions: None for this slice.

Artifacts:
- `apps/web/src/common/components/app-shell/AppSidebar.tsx`, `app-sidebar.logic.ts`, `AppSidebar.spec.ts`.
- `e2e/responsive.spec.ts`, P24-2a desktop branch: 86 px right after the press with the pointer not moved; the pointer leaves and returns, 289; leaves, 86; pinned again by the same button and collapsed with Enter, 86.
- `docs/specs/web-core-workspace-spec.md`, Navigation behavior: one line for the rule.

Verification (throwaway local stack, own containers; each e2e file after a fresh reset and seed):
- Real look, 1024 and 1280 px, identical at both. Before: after the press with the pointer not moved, sidebar 0-289, page from 86, 175 of the dashboard heading's 207 px covered. After: sidebar 0-86 within the 0.3 s transition, page from 86, heading free; pointer back on the rail: 0-289 over the page; pinned again: page from 289. Keyboard, five resting places of the pointer: 86 in each (three of them stayed 289 before). The 390 px drawer opens and closes as before, by mouse and by tap. WebKit at 1280 px: mouse as before, the brand-name keyboard case closes too.
- The new e2e assertions fail on the old code at both widths (`Expected: 86, Received: 289`). The new unit tests fail on the old rule (`expected false, actual true`).
- Web typecheck passes. Whole web suite 2659/2659. `AppSidebar.spec.ts` 13/13.
- `e2e/responsive.spec.ts`: chromium 33 passed and 73 skipped (the phone-only cases); mobile-chromium 103 passed and 3 skipped. `e2e/settings.spec.ts` 20/20, `e2e/reimbursements.spec.ts` 17/17.
- P24-2a at 1024 and 1280 px repeated six times: 12/12. P24-2a under iphone13-chromium and mobile-375: 16/16. The same group under WebKit at desktop size (scratch project): 6/6.
- `git diff --check` clean. Firefox was not looked at: it is not installed on the machine.

Noticed and left as they are (each is the same before the change):
- On a touch-only screen at desktop width the collapsed sidebar has no control to open it again: the button exists only while the sidebar is wide and hover opening is limited to `(hover: hover)`. Only a full reload brings it back.
- A keyboard collapse drops focus to the body (the pressed button is removed): the P24 gap the e2e comment names. In the collapsed rail the menu links have no accessible name (the label is unmounted, the icon is `aria-hidden`), and focus does not open the rail.
- `e2e/sidebar-nav.spec.ts` NAV-02 and NAV-03 fail on develop as well: they read the active rows straight after `page.goto`, before the shell has mounted (it now waits for the plan-term read).
- In the drawer below the desktop width, pressing the link of the page one is already on leaves the drawer open; it closes only on a change of path.

Next: Coordinator reviews, pushes and opens the pull request when the round is done. Nothing else is pending in this slice.
