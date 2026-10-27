# Approved card mapping verification — 2026-10-28

Status: complete locally; no deployment or external social posting.

## Assets and contracts

- All22 normal runtime assets are byte-identical to the selected approved sources. See `output/halloween-ghost-cards/revision-2026-10-27/runtime-mapping.json` for source/runtime paths, SHA256, dimensions, quotes and regions.
- Dracula v1; Werewolf/Zombie v2. SECRET image/text, both backs and QR preserved against the pre-integration snapshot. Registry has23 cards; normal22×4.5%,SECRET1%.
- Old Sadako/Yuki-onna/Nine-tailed-fox/Kappa IDs removed from active registry. New Pancake/Payoon/Taew use Thai effects, The Nun Western, Granny Japanese.
- Current catalog/manifest/approved ZIP updated. ZIP integrity and extracted asset hashes match the manifest; original artifacts remain as history.

## Browser evidence

`browser-results.json` and `route-checks-390.json` contain observed UI values.

-390px: `pancake-390.png`, `cheonyeo-390.png`; expected image/quote, no overflow, share buttons330×48. Six more shared routes checked for correct identity, image and quote. Card22 single-line copy confirmed.
-1280px: `taew-1280.png`; expected layout, no overflow, three action buttons510×48. `homepage-draw-1280.png`: actual homepage entry→mirror→random draw gives updated Granny card/quote.
- `removed-sadako-404.png`: removed card route shows the existing not-found screen. `theme-off-route.png` and `theme-off-home.png`: no activity entry/game; direct valid-card URL blocked when theme is default.
- Actual save button downloaded `/Users/thawatchai/Downloads/mangmee-14-pancake.png`. SHA256 `fcadfaea1a6fef2d44a17ca2d163f96aa96bfcdec3f5c8905ec1c932218b363e` matches runtime PNG. Existing provenance inspector returned source `https://mangmeeplus.com`, cardId `14-pancake`, variant `card`. This is a file label, not a signature or person tracking.
- Actual copy action after card22 reveal returned the new single-line quote, `https://mangmeeplus.com` and `https://line.me/R/ti/p/@mangmeeplus`.
- Found/fixed cached SSR image loading before hydration, leaving stale loading overlay; `pancake-390-loading-before-fix.png` is before evidence. Existing onLoad remains; ref/complete/naturalWidth check reconciles cached images. Reload plus actual draws verified after fix.
- Restarted stale local dev server to resolve stale route state, current session79706. No routing bypass introduced.

## Checks

From `apps/web`:

```sh
corepack pnpm exec tsx --test src/features/public-home/home-halloween-cards.spec.ts src/features/public-home/home-halloween-share.spec.ts src/features/public-home/home-halloween-provenance.spec.ts src/features/public-home/home-halloween-countdown.spec.ts src/features/public-home/home-events.spec.ts src/features/public-home/home-theme.server.spec.ts
```

18pass,0fail: `focused-tests.log`. Root TypeScript command `corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit --incremental false` passed; Sol reran `node_modules/.bin/tsc --noEmit --project apps/web/tsconfig.json` after the image lifecycle fix and passed. `git diff --check` passed.

An initial root-cwd test invocation failed to resolve a web-only alias in home-events; the correct apps/web invocation above passes all suites.

Limits: browser viewport tests are not physical iPhone/Android tests; native social destinations were not posted to.9:16 share preparation and existing audio/effect implementations retained, not redesigned. Games2/3 are still countdown/waiting screens under the previously agreed scope.
