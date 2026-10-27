# Signed Halloween draw and concealed reveal — 2026-10-28

SUPERSEDED: owner subsequently removed signatures/key setup. This folder records the historical signed implementation only; its signature-specific scripts/tests are not current acceptance. Current spec: docs/specs/halloween-signed-draw.md. New evidence: docs/evidence/halloween-server-draw-2026-10-28/README.md. Do not provision a signing key based on this historical report.

Status: COMPLETE_LOCAL. No deployment. [Spec](../../specs/halloween-signed-draw.md), [plan](../../plans/halloween-signed-draw-plan.md), [signing-key operations](../../runbooks/halloween-draw-signing.md).

## Result

- One anonymous same-origin POST selects a server cryptographic random bucket from0–999: SECRET10buckets; each normal45. Server signs its own allowlisted card ID, unique draw ID, timestamp, event/version/odds with Ed25519. Request body/query cannot choose or sign arbitrary data. Removed browser RNG fallback.
- Private key is server runtime configuration only. Production/test fail closed without a valid dedicated Ed25519 key. Local development may generate an ephemeral identity. Existing proxy/theme rules plus bounded empty-body inspection and anonymous process rate control protect the new route; no player/IP histories/database.
- Immediate loading says “กำลังเรียกวิญญาณ…” and uses the shared busy spinner/disabled button. Abort, timeout, duplicate and stale-result guards; error/retry text. Audio context unlock happens in the original click, then regional audio starts after response.
- Spinning DOM has back art on both sides and layered moving smoke. No character face exists in it before reveal. Actual face preloads off-DOM; ordinary4.5s/SECRET7.5s and temple bell retained. Reduced motion waits for server result without spinning.
- SavePNG and storyJPEG invisibly carry the current signed-result proof in existing origin metadata. No visible card/footer/pixel edits. Unsigned shared previews never invent a proof. Both prepared files remain bound to the current card+proof and URLs are revoked on replacement/unmount/failure; no silent unsigned fallback.

## Verification

- **55 focused tests pass**: [log](focused-tests.log). Includes real signature/wrong-key/tampered-payload checks; exact odds; inactive theme/prod preview override/cross-origin/arbitrary input/empty stream/spoofed body/rate bound; client invalid-response/error/abort; rendered loading/duplicate/ordinary+SECRET/no-face/close+late/reduced-motion; audio gesture/timing; original PNG and storyJPEG proof preservation, scan bytes and cleanup.
- **Standalone TypeScript passes**: [log](typecheck.log). A test literal-union typing error was corrected before the successful rerun.
- **Production build passes** on Next16.4.3: [log](web-build.log), includes `/api/public/halloween/draw`. Separate typecheck required because existing build configuration skips full TSchecking. Client static output scan found neither `HALLOWEEN_DRAW_PRIVATE_KEY` nor `createSignedHalloweenDraw`.
- **Real browser**: [results](browser-results.json). [Loading1280](loading-1280.png) shows busy/disabled216×40button, same width as idle. At390readybuttons216×44. [Smoke390](smoke-390.png) and [smoke1280](smoke-1280.png) have two back images and no card face. [Result390](result-390.png)/[result1280](result-1280.png) preserve layout and no horizontal overflow; share actions334×48/510×48. Repeated draw works; close during spin/reopen resets to ready. Theme-off entry/game absent and direct card route not-found.
- **Actual download**: `/Users/thawatchai/Downloads/mangmee-12-mummy.png`, metadata readback in [JSON](download-readback.json), [reproducible inspector](inspect-downloaded.ts).64-byte Ed25519signature, matching card12 payload. Replacing signed metadata with original source label yields byte-for-byte original file. Preview public key is intentionally not exported; this actual file's signature was not independently checked against that key. Real trusted-key verification is exercised in the server and image tests.
- Root found an actual integration issue: Next represents empty POSTs with a body stream. Initial blanket rejection produced400; replaced with bounded first-chunk check and timeout, with a regression. [Initial error screenshot](request-error-390.png) is historical diagnostic evidence, not an outstanding error. Shared Button `loading` prop fixes the busy state it owns.

Run focused checks from apps/web:

```sh
corepack pnpm exec tsx --test src/features/public-home/home-halloween-draw*.spec.ts src/features/public-home/HalloweenGhostGame.lifecycle.spec.ts src/features/public-home/home-halloween-reveal-audio.spec.ts src/features/public-home/home-halloween-cards.spec.ts src/features/public-home/home-halloween-share*.spec.ts src/features/public-home/home-halloween-provenance.spec.ts src/features/public-home/home-theme.server.spec.ts src/features/public-home/home-halloween-countdown.spec.ts src/features/public-home/home-events.spec.ts src/common/auth/proxy.spec.ts src/common/auth/middleware.logic.spec.ts
corepack pnpm exec tsc --noEmit --incremental false
```

## Precise limits and next state

The signature authenticates embedded server-result data, not image pixels, a player's identity or exclusive ownership. Copying a valid proof remains possible, and social re-encoding may remove it. No verification webpage, QR change, per-player save/daily draw quota or history was added. Static assets remain public. The process-wide rate bucket has a30request burst/10persecond refill; it is an anonymous abuse bound, not a distributed DDoS control or lifetime play limit.

Viewport checks do not establish physical iPhone/Android native share behavior. No external social posting/message occurred. All local tests and build pass; no production key or live infrastructure was accessed/provisioned. Production requires a persistent signing key injected into every web replica before release, using the mandatory deployment protocol. Local dev preview restored on43841(session42043), with a temporary development identity. No commit/push/deploy.
