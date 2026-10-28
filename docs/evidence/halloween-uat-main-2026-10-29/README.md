# UAT latest-main Halloween door evidence — 2026-10-29

- Target: `https://uat.mangmeeplus.com/halloween`
- Source: `56cdb4ee50bedf3f0c22451faf1583ffb6ec252c`
- Script: `check-door-gates.mjs`
- Browser: installed headless Chromium, Bangkok timezone, 390×844 and 1280×900.
- Method: an isolated init script replaces only browser `Date.now()` for exact cutoff checks. No product flag, UAT setting, server clock or database state is changed.

Passed in both viewports:

- At 1 ms before each cutoff, the relevant door is native `disabled`, `grayscale(1)`, `cursor:not-allowed`, and a programmatic DOM click does not open its game.
- At 29 October 2026 00:00:00 Asia/Bangkok, candy becomes enabled and its real ready screen opens while escape remains disabled.
- At 30 October 2026 00:00:00 Asia/Bangkok, escape becomes enabled and its real ready screen opens.
- Actual 29 October UAT state has candy enabled and escape grey/disabled.
- `previewGame=escape` does not bypass the production build gate.
- No page error or horizontal overflow occurred.

Screenshots: `390-candy-before.png`, `390-candy-at.png`, `390-escape-at.png`, `390-actual-2026-10-29.png` and matching `1280-*` files.

Limit: installed desktop Chromium is real browser execution but is not a physical iPhone/Android device. The authenticated free-expense business journey is outside this door-gate evidence.
