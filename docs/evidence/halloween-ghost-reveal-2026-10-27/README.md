# Halloween mirror — local verification

Latest owner refinements: five fast normal / eight SECRET rotations before the final half-turn, one temple-bell strike at face reveal, embedded source metadata, original-only PNG save separate from the branded9:16 sharing JPEG, SECRET labels, no skip button, Facebook/Instagram/TikTok icons, and homepage return URL `https://mangmeeplus.com`. Disabling the homepage Halloween theme removes the entrance and blocks direct game/card routes. No live deployment.

## Checks

- `corepack pnpm exec tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/public-home/*.spec.ts` — 38 tests passed (`public-home-tests.log`). Includes every one of 1000 random buckets, rejected uint32 tail, 23-card integrity, shared capability failures, homepage parity, production theme-preview isolation and the three countdown date/format checks.
- `corepack pnpm exec tsc --noEmit --pretty false -p apps/web/tsconfig.json` — passed (`typecheck.log`). The repository's build skips type checking, so this separate check is required.
- `BASE_URL=http://127.0.0.1:43841 node docs/evidence/halloween-ghost-reveal-2026-10-27/check-browser.mjs` — passed 21 groups (`browser-results.json`). Viewports 360×800, 390×844, 1280×900, 812×375; all six reveals, full durations, repeated draw presses, image retry, no skip, reduced motion/pause, file sharing/download/cancel/failure/manual copy, focus containment, close/reopen cleanup, metadata, inactive theme and unknown-card rejection. No uncaught browser errors, feature browser API calls or storage/cookie writes.
- `node docs/evidence/halloween-ghost-reveal-2026-10-27/check-reveal-motion.mjs` — all assertions passed (`reveal-motion-results.json`). Six real normal/SECRET runs: bundledChromium at390/1280 and WebKit/iPhone390. CSS performs5/8fullrotations then a finalhalf-turn; RAFsampledangles confirm multipleturns (WebKit screenshotworkcanmissonefullcycle). Front is crisp and held before result; normal4.5s/SECRET7.5s plus testclick/screenshotoverhead. Reducedmotion remains prompt. Screenshots `spin-<engine>-<thai|secret>-<390|1280>-<back|fast|front>.png`; parent inspectedfastspin/front. Optionalimageblur was removed afterWebKitloadtiming caused residualblur atfinalfront.
- `node docs/evidence/halloween-ghost-reveal-2026-10-27/check-modal.mjs` — ready/result screenshots and sticky close at 390/1280; switching to the normal theme removes the entrance (`modal-run.log`).
- `corepack pnpm exec tsx docs/evidence/halloween-ghost-reveal-2026-10-27/check-audio.ts` — seven streams, finite distinct tones plus earlywhooshes and one finaltemplebell (normal3.51s / SECRET6.45s), peakbelow0.2, safe startup/cleanup, hidden→suspended→visible/resumed, no resurrection after close (`audio-result.md`). Browser tests also exercise real AudioContexts using synthetic visibility events. No physical-speaker listening claim.
- `swift docs/evidence/halloween-ghost-reveal-2026-10-27/check-qr.swift docs/evidence/halloween-ghost-reveal-2026-10-27/mangmee-01-krasue-story-9x16.jpg` — the actual exported JPEG QR decodes to the homepage (`qr-verification.log`). Original source hashes are retained in `asset-integrity.json`; current publicPNGs additionally carry origin metadata, with every other byte unchanged (`image-origin-assets.json`).
- Web build command: `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:43842/v1 NEXT_PUBLIC_AI_GATEWAY_BASE_URL=http://127.0.0.1:43843/v1 corepack pnpm --filter @watchdog-bms/web build` (`build.log`).

## Game 2–3 countdown screens

The owner confirmed game 2 at **29 October 2026, 00:00 Asia/Bangkok** (`2026-10-28T17:00:00Z`) and game 3 at **30 October 2026, 00:00 Asia/Bangkok** (`2026-10-29T17:00:00Z`). This increment implements waiting screens only. At each deadline its numbers and date disappear automatically; “กำลังเตรียมเกม” remains until the separately discussed gameplay is implemented. No fake play button is shown.

`node docs/evidence/halloween-ghost-reveal-2026-10-27/check-countdown.mjs` passes Chromium 149 at 390×844 and 1280×900, plus WebKit 26.5 with the iPhone 16 profile (`countdown-results.json`). It checks distinct absolute deadlines, one second before/exactly at/after each cutoff, both door and intro states, immediate foreground resync, repeated close/reopen cleanup, first-door availability, theme-off gating, no overflow, no storage writes and no uncaught browser errors. The harness overrides `Date.now` only in test contexts and uses real browser intervals; visibility events are synthetic. The public countdown uses the device clock and is not a server-enforced access gate.

Parent visually reviewed `countdown-chromium-390-chooser.png`, `countdown-chromium-1280-chooser.png` and `countdown-webkit-iphone-candy-after.png`. Screenshots capture the viewport. All test contexts/browsers are closed after the run. These are desktop browser engines, not physical phone tests.

Historical first-door harness note: the earlier main and motion runners completed their assertions and wrote passing reports, with page/context work complete and Chrome browser processes gone, but their Node processes lingered at final teardown. Root terminated only those two owned runners. Modal/mobile/unit/typecheck/build exited0 normally; no application code was changed for this harness issue. The user’s live IAB was checked with its activity dialog closed and no game mounted. The current bundled-browser motion and countdown runners exit normally.

## iPhone and Android evidence

`SKIP_MOTION=1 corepack pnpm exec tsx docs/evidence/halloween-ghost-reveal-2026-10-27/check-mobile.mjs` passed for this metadata increment (`mobile-results.json`): installed WebKit 26.5 with the iPhone 16 profile and Chromium 149 with the Pixel 7 profile, touch input, no horizontal overflow, 48×48 social controls, no format picker. Original save returns the current metadata-labeled1122×1402PNG (SHA256470ba11d58049641640d87336bb03d4a269fa3ba9b181cf9f29288784399a0f9), with pixels equal to the preceding unmarked download. Native sharing and failure/unsupported downloads retain the framed1080×1920JPEG. The retained earlier WebKit motion evidence records live front-face artwork at3855ms with backfacehidden and the complete180-degree transform; a DOM observer measures the normal transition at4500ms. Native capability detection is recorded before any mocking. A separate native-share stub confirms one JPEG, homepage caption/URL and active user activation for the main share, Instagram and TikTok actions. Facebook's homepage sharer URL is checked without opening/posting.

These are desktop browser engines with mobile profiles, **not physical iOS/Android devices**. Installed app availability, real OS share sheets, receiving-app behavior and actual social posting remain unverified. The older iPhone 13 test profile advertised iOS 15 and correctly reached the existing app compatibility notice (minimum iOS 16.4); the supported profile was used for the game checks. No compatibility policy was weakened.

Before claiming physical-device support, use a real supported iPhone/Safari and Android/Chrome over HTTPS to open the activity, export/save the image, select the installed social app in the OS sheet, check caption/link handling and cancel/return. No account, API permission or live post is created by the automated checks.

## Design and platform notes

The later text-only refinement uses “โลกวิญญาณ” for all ordinary reveal headings and removes the five-world count from the ready copy. Internal region effects and SECRET are unchanged. Standalone TypeScript passes. A focused bundled-Chromium run at 390/1280 verifies ready/reveal text, no dialog overflow and close cleanup (`world-label-results.json`, `world-label-check.log`). Parent reviewed the ready screenshots; capture waits for the card-back artwork to load. All test contexts close after capture. No full build rerun was needed for this subsequent wording-only change.

Parent inspected ready/result at 390/1280, six themes including the staged gold SECRET, iPhone/Android profile screenshots and exported artwork. The separate original-save PNG has no appended sharing footer and remains available if story preparation fails. Native-share failure changes the existing primary action to “บันทึกภาพเพื่อแชร์”; clipboard failure does not. The 9:16 sharing image preserves the complete approved art, brand, homepage and LINE `@mangmeeplus`; the QR leads to the homepage. Historical 4:5 evidence files are from the earlier iteration, no longer a UI option.

The Web Share API lets the user choose an installed target; a webpage does not select Instagram/TikTok on their behalf. Files are prepared before the click and `navigator.share()` is invoked before awaiting. References: [WebKit user activation](https://webkit.org/blog/13862/the-user-activation-api/), [Navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [Web Share specification](https://www.w3.org/TR/web-share/). Facebook offers URL sharing; unsupported native file sharing falls back to a download and action-specific guidance. There is no automatic publishing.

Unknown or inactive routes render the existing not-found UI with noindex and no mounted game/audio. Next's dynamic root layout may stream that response with HTTP 200; this is documented in the bundled `not-found.md`. Theme changes apply on navigation/reload using the existing no-store server resolver; no client polling or participant records are added.

Local preview: `http://127.0.0.1:43841/?preview=events&event=halloween` or `http://127.0.0.1:43841/halloween?preview=events&event=halloween`. Production ignores preview parameters. UAT/READY/Production runs: **NOT_DISPATCHED**.


## Embedded image-origin metadata (latest increment)

The owner asks for mangmeeplus inside every saved image. This is an embedded source label, not pixel-bit steganography, a signature, an identity tracker, or a per-download history. Fields are version1, source `https://mangmeeplus.com`, event `halloween`, cardId, variant (`card`, `back`, `story`). Public front/back PNGs carry a `tEXt` chunk; generated storyJPEGs carry a `COM` segment. Other chunks/encoded image bytes remain intact; source artwork under `output/` is retained. Existing credentials chunks are preserved as bytes, but their signature validity after derivative metadata insertion is not asserted.

Inspection (works on a saved PNG or JPEG, reads only the local file):

```sh
corepack pnpm exec tsx scripts/halloween-image-origin.ts inspect /absolute/path/to/image.png
```

A result with `status: label-found` returns the marker and `authenticated: false`. A matching marker means the file carries this label; it is editable and is not proof of an authentic draw or the downloader. Missing metadata cannot prove a picture is unrelated because re-encoding, stripping metadata or screenshots can remove it. No external service, user data or download log is involved.

To regenerate the25 publicPNG labels after replacing approved artwork:

```sh
corepack pnpm exec tsx scripts/halloween-image-origin.ts stamp
```

The operation replaces its own label and is idempotent. Previous source-copy SHA256 evidence refers to the pre-label PNGs; current provenance evidence records separate original and labeled hashes, with all non-label chunks equal.

Format references: [W3C PNG textual information](https://www.w3.org/TR/png-3/#11textinfo), [JPEG T.81 comment syntax, B.2.4.5](https://www.w3.org/Graphics/JPEG/itu-t81.pdf), [libjpeg-turbo comment utilities](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/doc/usage.txt). All25publicPNG markers pass roundtrip/source-preservation checks (`image-origin-assets.json`). Re-stamping changes0files (`image-origin-stamp.log`). The local inspector reads ordinary/SECRET/back metadata (`image-origin-inspection.jsonl`). Both mobileprofile engines verify markedPNG downloads, all three native-share actions and failure/unsupportedJPEG downloads, exact source/card/variant, active user gesture and pixels equal to the previous artifacts (`mobile-results.json`). The35-test public-home suite, standaloneTypeScript and finalproductionbuild pass. The latestmotion runner exited0 normally; the older teardown note applies only to the earlierChrome-channel run.
