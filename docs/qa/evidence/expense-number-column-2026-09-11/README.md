# EXP column UI follow-up — 2026-09-11

Implemented on `codex/expense-running-number-20260911`, after numbering implementation `3d7379ef`.

- First desktop column: **เลขรายจ่าย (EXP)** / **Expense number (EXP)**. Number is separate from vendor/category, displayed in full and wraps for longer formats.
- Below 1280px, cards put the label and number above the vendor. Missing numbers show explicit Thai/English text.
- No API/data/numbering-policy change. The earlier implementation evidence belongs to commit `3d7379ef`; its source hashes describe that revision, not this presentation follow-up.

Verification: `pnpm --filter @watchdog-bms/web exec tsc --noEmit` passed. Read-only Playwright browser review using the existing local auth harness passed on real API data at 1440, 1280, 1024, 768 and 390px. Header order, number placement, explicit null-number display and no document/table horizontal overflow were checked; zero expense business mutations. Desktop/mobile screenshots visually inspected. See `browser-review.json`.

The local runner was `/tmp/expense-number-impl-run.py`; browser probe retained outside product code at `/tmp/expense-number-column-review.ts` (copy to `scripts/expense-number-column-review.tmp.ts` before invoking API workspace tsx). First probe attempt selected the hidden desktop copy of null-number text at mobile width; narrowed its locator to the visible card list and reran successfully. No persistent test suite added for this presentation change.

Stopped only task-owned API 3011/web 3012, restored generated next-env, and removed the temporary probe from the checkout. No package.json change, merge or deployment.
