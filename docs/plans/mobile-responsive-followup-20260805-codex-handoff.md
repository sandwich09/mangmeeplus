# Mobile Responsive Follow-up (UAT screenshots 2026-08-04) — Codex CLI Handoff

Status: Implement-ready 2026-08-05. Successor to `docs/plans/mobile-responsive-uplift-codex-handoff.md` — its Hard rules, Environment quirks, and design decisions (esp. **D2 desktop pixel parity**) are binding here too. Task memory: `docs/agent-memory/mobile-responsive-uplift.md`.

Executor: **Codex CLI** (`codex exec`). Codex codes + runs typecheck + self-reviews. Claude reviews the diff, runs the real e2e gate, and commits. **Codex never commits, never `git add`, never runs `git checkout/restore/stash`, never starts dev servers.**

## Why this exists

Owner tested UAT (`uat.mangmeeplus.com`) on an iPhone (390px viewport) on 2026-08-04 22:14–22:16 and found three mobile layout defects that the R0–R5 uplift did not cover. All file:line refs verified today on branch `20260804`.

⚠ **Dirty worktree**: `apps/web/src/features/expenses/ExpenseReviewPage.tsx`, `apps/web/src/common/i18n/workspace-dictionary.ts` and others carry uncommitted in-flight work. Edit **on top** of the current working-tree state. Reverting, restoring, or stashing anything = critical failure. Touch ONLY the four files this doc names.

## Fixes (one phase)

### F1 — Notification bell popover spills past the left viewport edge

`apps/web/src/features/dashboard-notifications/NotificationBell.tsx:84`

The panel is `absolute right-0 … w-[min(360px,calc(100vw-2rem))]`, anchored to the bell button which sits ~60px from the right viewport edge (avatar + gap + page padding are to its right). On a 390px viewport the panel is 358px wide with its right edge at ~330px → it extends ~28px past the LEFT edge of the screen (screenshot shows "การแจ้งเตือน" clipped to "ารแจ้งเตือน").

Fix (mobile-first, desktop restored at `sm`): below `sm` render the panel as a fixed sheet pinned under the app header, spanning the viewport width minus a margin; at `sm+` restore exactly the current classes.

```
fixed inset-x-3 top-[calc(var(--app-header-h)+8px)] z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[var(--shadow-theme-md)]
sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(360px,calc(100vw-2rem))]
```

- `--app-header-h` is defined in `apps/web/app/globals.css:59` (68px) and already used by `AppHeader`.
- The panel stays a DOM child of the `ref` wrapper, so `useCloseOnOutsideClick` keeps working — do not portal it.
- The list scroller on line 91 (`max-h-[380px]`) can push the "ดูการแจ้งเตือนทั้งหมด" footer link off short screens once the panel is viewport-anchored: change to `max-h-[min(380px,60dvh)]`. (`dvh` precedent: `ExpenseReviewPage.tsx` uses `100dvh`.) This is ≤380px on every desktop viewport ≥ ~634px tall; acceptable per D2's spirit, note it in your report.

### F2 — Dashboard period chips wrap, leaving "รีเฟรช" stranded on its own row

`apps/web/src/features/dashboard-notifications/DashboardPages.tsx:270-294`

The controls group `<div className="flex flex-wrap items-center gap-2">` holds 4 period chips + the refresh button (~530px total) — on mobile it wraps into a ragged two-row cluster.

Fix: below `sm`, one horizontally scrollable no-wrap strip (standard mobile segmented-chips pattern); `sm+` restores the current wrap behavior exactly.

- Container → `flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible`
- Every button in the group (4 period chips + refresh) gets `shrink-0 whitespace-nowrap` prepended. Desktop-visually inert: these buttons never shrank or wrapped their labels at desktop widths.
- Do NOT reorder buttons, do not change copy, do not touch the greeting/heading block.

### F3 — Expense review footer buttons wrap chaotically on mobile

`apps/web/src/features/expenses/ExpenseReviewPage.tsx:320-394` (the `modalFooter` block)

Current structure: outer `flex w-full flex-wrap items-center gap-2` containing a left danger group (`flex flex-wrap items-center gap-2`) and a right actions group (`ml-auto flex flex-wrap items-center justify-end gap-2`). On 390px this wraps into mixed-alignment rows (screenshot: ยกเลิกรายการ / ย้อนกลับ ตรวจหารายการซ้ำ / ส่งตรวจสอบ scattered).

Fix: stack full-width on mobile, destructive action last; desktop identical to today.

- Outer div → `flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center`
- Left (danger) group → `flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center`
- Right group → `flex flex-col gap-2 sm:ml-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end`

No per-button changes needed: `.mangmee-btn` is `inline-flex; justify-content:center` (`globals.css:348`), and as a flex-column item it stretches to full width with centered label automatically. Resulting mobile order (top→bottom): ย้อนกลับ → ตรวจหารายการซ้ำ → primary (ส่งตรวจสอบ/ยืนยัน) → ยกเลิกรายการ (danger, visually separated at the bottom). Button JSX/conditions/handlers stay byte-identical — only the three wrapper class strings change.

### F4 — Duplicate-warning rows cram link + actions together on mobile

`apps/web/src/features/expenses/ExpenseReviewPage.tsx:552` and `:560` (`duplicatesCard`)

Both candidate rows use `flex flex-wrap items-center justify-between` — on 390px the link and the two underline actions collide (screenshot: "รายการ 1 · eindqzpx (คะแนน 30)" directly above "ยืนยันว่าเป็นรายการซ้ำ ไม่ใช่รายการซ้ำ" with no breathing room).

Fix, both rows: `flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between`. The two underline buttons at `:565-566` each get `py-1 sm:py-0` prepended for a ≥32px tap target below `sm`. Nothing else changes.

### F5 — Regression guard: cover the bell popover in INV-6

`e2e/responsive.spec.ts:212-223` (mobile-chromium project)

Extend the existing INV-6 test (or add a sibling test in the same describe): from the dashboard route, tap `getByRole('button', { name: 'การแจ้งเตือน' })`, then `expectInViewport(...)` on the opened panel (locate it as the sibling/descendant of the bell wrapper — follow the branch-selector locator idiom at `:215-217`). Assert both edges via the existing `expectInViewport` helper. Use existing `gotoAndSettle` + fixtures; no new helpers.

## Out of scope

- The mobile nav drawer (screenshot 2) is working as designed (289px drawer + backdrop) — do not touch.
- The upload page (screenshot 3) has no defect — do not touch.
- Everything else in the two expense/dashboard files, especially the in-flight uncommitted edits.

## Verify (Codex runs these; nothing else)

```
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
pnpm --filter @watchdog-bms/web typecheck
```

Do NOT run e2e, `next build`, or any server — the sandbox cannot reach the DB and zombie servers on :3000/:3001 poison later runs. Claude runs the e2e gate after review.

Report per file: what changed, why it is desktop-inert (or the one noted `max-h` exception), and the full list of touched files (must be exactly the 4 named above).
