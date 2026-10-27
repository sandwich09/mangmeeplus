# Halloween draw without signing keys — 2026-10-28

Status: COMPLETE_LOCAL. Supersedes the previous signed-draw evidence for current acceptance. No cloud access or deployment.

The owner accepted removing signatures and key setup. Server `randomInt(1000)` still selects SECRET at 1% and each of 22 normal cards at 4.5%. Anonymous POST returns only `{cardId}`. Origin/theme/body/rate/no-store controls and client validation/cancellation remain. Original PNG save and 9:16 story export keep unsigned source/card metadata; these labels do not prove authenticity. No artwork, CSS or audio changes in this simplification.

## Automated verification

- `focused-tests.log`: 53 tests passed, zero failed. Covers draw odds, production handler without keys, origin/theme/body restrictions, request errors/abort/retry, lifecycle and reveal timing, audio, sharing/URL cleanup, metadata, countdown/events and proxy boundaries.
- `typecheck.log`: `corepack pnpm exec tsc --noEmit --incremental false` from apps/web exited 0.
- `web-build.log`: `corepack pnpm --filter @watchdog-bms/web build` exited 0 with Next 16.4.3.
- No active signing/proof/key symbols remain in public-home draw/share code or the env example. Original metadata tests cover all 25 static assets and PNG/JPEG data preservation.

Focused command, from apps/web:

```sh
corepack pnpm exec tsx --test src/features/public-home/home-halloween-draw*.spec.ts src/features/public-home/HalloweenGhostGame.lifecycle.spec.ts src/features/public-home/home-halloween-reveal-audio.spec.ts src/features/public-home/home-halloween-cards.spec.ts src/features/public-home/home-halloween-share*.spec.ts src/features/public-home/home-halloween-provenance.spec.ts src/features/public-home/home-theme.server.spec.ts src/features/public-home/home-halloween-countdown.spec.ts src/features/public-home/home-events.spec.ts src/common/auth/proxy.spec.ts src/common/auth/middleware.logic.spec.ts
```

## Real browser and downloaded file

At http://127.0.0.1:43841/?preview=events&event=halloween, opened the activity, mirror and draw. Observed disabled “กำลังเรียกวิญญาณ…” loading, then drawing DOM with two back-standard images and smoke, then a complete Payoon result. No horizontal overflow at 390 or 1280. Screenshots: `result-390.png` and `result-1280.png`.

Clicked Save in the real UI. `/Users/thawatchai/Downloads/mangmee-15-payoon.png` is byte-for-byte identical to `apps/web/public/home/events/halloween/cards/15-payoon.png`. `download-inspection.json` records its five-field source/card metadata with `authenticated:false`. No signed proof or generated-image footer was added to the original save. Repeat draw remains available.

These are desktop browser viewport checks, not physical iPhone/Android or native social-posting tests. No social content was posted. Existing story export has automated canvas/metadata coverage.

Local preview restarted after build on port 43841 in exec session 96209. No backend started, no package/dependency changes for this scope, no key provisioned, no commit/push/deploy. Prior dependency remediation and artwork work remain preserved.
