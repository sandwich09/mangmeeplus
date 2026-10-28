# Campaign popup verification — 2026-10-28

- Sol: `corepack pnpm exec tsx --test 'src/features/public-home/*.spec.ts'`: 57/57; `corepack pnpm exec next typegen && corepack pnpm exec tsc --noEmit`: pass.
- Sol: `corepack pnpm --filter @watchdog-bms/web test`: 5,083 tests, zero failures/skips/cancellations, exit0; full log `web-tests.tap`.
- Root: real in-app browser at390×844 and1280×900. Bare `/halloween?preview=events&event=halloween` opens chooser after hydration; X/Escape/backdrop close; homepage pricing/brand navigation works while closed; manual entry reopens; refresh reopens; ordinary homepage stays manual. Both widths have document scrollWidth equal clientWidth. Screenshots: chooser/closed/theme-off for both widths.
- Theme-off bare route renders the real normal homepage, without activity/game. Theme-off card URL and active unknown-card URL show not-found. Active known-card URL retains result preview and share controls. No live theme mutations.
- Actual copy action resolves to `caption.txt`: `https://mangmeeplus.com/halloween` plus unchanged approved quote/LINE. The clipboard operation completes only after the preview is visible/focused; initial immediate read returned previous clipboard contents and was not accepted as evidence.
- Static QR uses existing installed qrcode-generator2.0.4, M correction, auto version, four-module margin; no dependency change. Native Vision decode after resizing to148px (actual export placement) returns exactly `https://mangmeeplus.com/halloween`. Visible canvas footer still says `mangmeeplus.com`. No original PNG edits.
- Browser logs included development-only React Performance.measure negative-timestamp warnings on navigation. No product error state or interaction failure; built-UAT verification remains required. No physical iPhone/Android or social posting claim.
- `production-alarms-before.json`: current read-only Production alarm snapshot; owner permits root read only and accepts the unchanged October9 API security alarm for this release. Deployment remains scoped non-root.

Release ledger and exact IDs: [task memory](../../agent-memory/halloween-event-popup.md).
