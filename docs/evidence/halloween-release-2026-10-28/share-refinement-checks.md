# Sharing refinement verification

2026-10-28. Owner approved image+caption sharing and release.

- Sol:21 focused share/provenance/lifecycle/safe-error tests passed; standalone TypeScript passed. Tests exercise all four real click handlers, pending clipboard ordering, sameJPEG/caption/homepage payload, duplicate clicks, denied/missing clipboard, JPEG fallback, cancellation and stale completion. PurePNG save does not write clipboard.
- Root: `pnpm --filter @watchdog-bms/web test` passed5082tests/631suites,0failures,17.744s; `git diff --check` passed.
- Real IAB localhost at390×844 and1280×900: approved zombie card renders, no horizontal overflow; action buttons48px/equal width, icons48×48; Facebook is now a button. Actual clipboard readback matches the full zombie caption,https://mangmeeplus.com andLINE https://line.me/R/ti/p/@mangmeeplus.
- Native Chrome/macOS: each social icon opens the OS share sheet, shows accurate target guidance and confirmed copy status; Escape preserves card and enables retry. No third-party post or account permission was submitted. Native observation text and screenshots retained alongside this file.
- Limits: native social destinations differ by installed app/browser/OS; this is not physical iPhone/Android or completed Facebook/Instagram/TikTok posting evidence. Appending caption automatically to every destination is not guaranteed; clipboard/manual fallback remains.
