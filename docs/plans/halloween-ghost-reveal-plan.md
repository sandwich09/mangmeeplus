# Halloween reveal implementation

Spec: [mirror reveal](../specs/halloween-ghost-reveal-spec.md).

- [x] Inspect current UI/audio/artwork/security/Next guidance and confirm probabilities with owner.
- [x] Root: shared card catalog, unbiased weighted draw, public assets, return routes/metadata; 29 public-home tests passed with the web tsconfig.
- [x] Sol: game state machine, mirror/reveal themes, audio stings, native-dialog integration and responsive accessible layout; root review fixes applied, including hidden-tab audio suspension.
- [x] Luna: file export/native share/download/copy UX and platform guidance, scoped share styles; root review fixes and capability tests applied.
- [x] Sol/root: focused browser verification covering old entrance and new flow, screenshots and failure/lifecycle checks; root completed main runner, Sol completed WebKit/iPhone and Chromium/Android profile checks.
- [x] Root: review design/code, fix observed defects, run 31 focused tests, separate TypeScript and production build, inspect 390/1280, both mobile profiles and final 9:16 export, decode homepage QR; evidence in `docs/evidence/halloween-ghost-reveal-2026-10-27/README.md`.
- [x] Owner follow-up: verify disabling the homepage theme removes the entrance and blocks direct game/card routes, with production preview overrides ignored and theme-read failure closed.
- [x] Owner refinement: SECRET labels, no skip button, one-step 9:16 preparation, social icons, removed persistent help paragraphs, homepage return links/QR. Native sharing/physical-device limitations explicitly recorded.

- [x] Latest refinement: visible two-face card flip with final-face hold; original-only save separate from branded story sharing. Verified browser 390/1280, WebKit/Chromium mobile profiles, source-identical PNG versus story JPEG, QR, TypeScript, 31 focused tests and build.

- [x] Embedded origin: PNG/JPEG metadata helper, all25 publicPNG stamping, storyJPEG integration, local inspector; verify unchanged visual data and saved/shared outputs.

- [x] Latest motion request: several fast spins with quiet whooshes before final-face opening; verify real390/1280 and WebKit motion plus audio lifecycle.

Scope: first game only, no persistence, reward, publishing or cloud operation. Exact interfaces are in spec. Avoid concurrent edits to other agents' owned files; root coordinates shared contracts.

## Social image sharing refinement — 2026-10-28

- [x] Sol: route Facebook and other share triggers through prepared image sharing; best-effort clipboard in same click without awaiting, accurate feedback/manual fallback and late-result cleanup. Add focused regressions for activation/payload/clipboard failure/fallback/cancel.
- [x] Root: review diff and Thai UX, test real390/1280 browser, run focused tests/typecheck and existing web checks.
- [ ] Sol/root: direct merge to main+develop per owner; new UAT candidate/build required. Reconcile retained pre-mutation interrupted Production operation, then promote new signed UAT images and complete administrator/OPEN/logout acceptance.
