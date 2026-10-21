# Agent Memory: public-home-event-prototype

Status: Prototype complete; runtime control verified. Owner authorized develop/main integration on 2026-10-22; see public-home-runtime-theme.md for current integration status.
Owner: Codex
Scope: Local animated Cozy Halloween prototype from actual main homepage code; reusable event boundary, homepage only.
Decisions:
- User explicitly authorized implementation and local preview, and prohibited push/merge.
- Worktree: /Users/thawatchai/.codex/worktrees/homepage-event-prototype/mangmeeplus
- Branch: codex/homepage-event-prototype
- Baseline: 092bad768e9ffb815a50a52bd361eceacf5f4303; annotated local tag homepage-baseline-2026-10-21. No remote tag push.
- Existing dirty checkout is untouched by application changes.
- Development-only query preview; no runtime admin service or scheduled automation. Native scoped CSS animation with pause/reduced-motion support.
- Owner-approved Halloween default: plum. Forest/pumpkin remain preview alternatives. No production activation authorized.
Open questions:
- None blocking the authorized prototype. Production activation is out of scope.
Artifacts:
- docs/specs/public-home-event-themes-spec.md
- docs/plans/public-home-event-prototype-plan.md
- docs/evidence/homepage-event-prototype-2026-10-21/
- apps/web/public/home/events/halloween/
Verification:
- Offline frozen-lockfile install completed; no dependency/package changes requested.
- `corepack pnpm --filter @watchdog-bms/contracts build` passed.
- `corepack pnpm exec tsx --test src/features/public-home/*.spec.ts` from apps/web: 22/22 passed; evidence unit-tests.tap.
- `corepack pnpm exec next typegen` and `corepack pnpm exec tsc --noEmit` from apps/web passed. Initial partial dependency setup lacked decimal.js used by an existing cross-package test import; installing the API's existing locked dependencies offline resolved it without package/lockfile changes.
- `node docs/evidence/homepage-event-prototype-2026-10-21/check-browser.mjs` passed in actual headless Chrome: baseline text/link/layout parity at 390/1280; themed viewports 360/390/768/1280/1536; reduced-motion, animation movement, pause, client-side theme switching, pricing interval, FAQ, document dialog and Escape; login/privacy direct loads and actual link navigation initiate no event asset requests. No uncaught page errors.
- Normal PublicHome static markup is byte-for-byte identical to the pre-edit main render: SHA-256 c11d867b0e7b97538e533a23f1ff517b5b2e1b4ae2236b71a5db8c80b74b4fd7. This refers to component markup, not Next development scripts or the entire HTTP document.
- Inspected desktop/mobile hero, FAQ, footer and mobile mascot-stage screenshots. Corrected responsive selector specificity so desktop artwork stays hidden at small sizes; preview controls sit above the existing mobile CTA.
- `git diff --check` passed. package.json, lockfile, root layout, global CSS, home content and original public-home.css remain unchanged. Next-generated next-env.d.ts returned to its baseline via next typegen.
- Login/API authentication is not exercised: this is a frontend prototype with local API addresses and no backend running. External LINE handoffs were inspected as links, not submitted.
Next:
- Await owner visual feedback; continue in this attached worktree. Do not push, merge, create a PR or deploy without a subsequent request.

## Preview and launch

- Cozy Halloween: http://127.0.0.1:43831/?preview=events&event=halloween
- Normal comparison with controls: http://127.0.0.1:43831/?preview=events&event=default
- Untouched normal presentation: http://127.0.0.1:43831/
- Toolbar supports theme selection, collapse and pause. OS reduced motion disables event animation. Query controls are ignored outside development mode.
- Live local terminal session at handoff: 52408 (Next 16.3.8, webpack). Browser-open action returned queued for this chat; use the URL directly if necessary.
- Restart from the worktree root:

```sh
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:43832/v1 NEXT_PUBLIC_AI_GATEWAY_BASE_URL=http://127.0.0.1:43833/v1 corepack pnpm --filter @watchdog-bms/web exec next dev --webpack -H 127.0.0.1 -p 43831
```

- Baseline source and local tag retained. All prototype changes remain uncommitted. UAT/READY/Production runs: NOT_DISPATCHED; no cloud environment touched.

## Interaction refinement — 2026-10-21

- Added `HomeEventEffects.tsx`, mounted only for Halloween under the homepage root. Native click handles mouse and completed touch taps; six SVG bats disperse for 1.2 seconds, at most three bursts/18 bats. No new assets, dependencies, global listeners surviving unmount, or business mutations.
- Small ghost moves down the right edge with scroll progress. Its measured bounds avoid text, controls, lists, images, figures, tables, cards and preview tools. Desktop uses the outer gutter; on phones the ghost appears only in clear gaps (intentionally intermittent). Position updates use one scheduled animation frame per scroll/resize, with no delayed transform tween that could carry it through content.
- Existing pause and OS reduced motion hide/disable the interactive effects and clear active bursts. Native actions remain intact; keyboard activation and finger swipes do not generate bats. Effect/listener/observer cleanup is scoped to mount/unmount.
- `node docs/evidence/homepage-event-prototype-2026-10-21/check-interactions.mjs`: final run exited 0 with normal browser teardown. Mouse at 1280, touch/swipe at 390, animation/expiry/cap, pause/reduced motion, keyboard/annual-price actions, theme switch/remount, login navigation and ghost clearance passed. Browser errors: none. Evidence: `interaction-results.json`, `cozy-bats-{390,1280}.png`, `cozy-scroll-ghost-{390,1280}.png`.
- Rechecked browser baseline text/layout at 390/1280; 360/390/768/1280/1536 overflow; original pricing/FAQ/dialog flows; login/privacy isolation. All assertions passed. The first browser runs completed assertions and wrote passing JSON, but required terminating their Node runners after browser teardown lingered.
- Re-ran 22/22 homepage tests, Next type generation, TypeScript and default static-markup comparison. Normal markup remains byte-identical to the pinned main baseline. Inspected mouse/touch and clear-gap ghost screenshots.
- Local preview stays at http://127.0.0.1:43831/?preview=events&event=halloween. No commit, push, merge, PR or deployment.

## Palette comparison and plum refinement — 2026-10-21

- Added development-only `palette=forest|pumpkin|plum` and named swatches to the existing toolbar. The initial forest fallback was superseded by the owner's plum approval below. Event switching retains the preview color choice; default renders no palette attribute or event artwork. No persistence, runtime service or production activation.
- Owner prefers plum and requested removing the abrupt green middle section. Plum now covers the hero, pricing glow, use-case section, mascot/enterprise/security cards, closing panel, footer, headings/icons/badges and control states. Existing `--ink/--muted/--line/--soft` values are overridden only below the plum homepage root. Logos and actual product screenshots retain their source artwork.
- Owner also requested the hero's grid/stars in the plum middle section. Added a 56px faint grid behind content and eight existing four-point SVG stars in side gutters and top/bottom padding. Existing star keyframes, pause and reduced-motion support are reused. No new image assets or dependencies.
- Verification: 22 homepage checks passed after palette integration; the two event checks passed again after adding middle artwork. Next type generation and TypeScript passed. Normal PublicHome static markup remains byte-identical to the main baseline for all three palette props.
- `node docs/evidence/homepage-event-prototype-2026-10-21/check-palettes.mjs` exited 0 after final changes: all three palettes at 390/1280 preserve baseline text and section geometry, no horizontal overflow, swatches at least 44px tall, client palette switching, default restore, retained selection, invalid/repeated fallback, pricing/FAQ/pause and middle-star reduced motion pass. No uncaught browser errors. Evidence: `palette-results.json`, `palette-*.png`.
- Visually inspected pumpkin hero, plum pricing/mascot cards, and desktop/mobile plum middle-grid captures. Additional security/closing screenshots are saved by the browser check. Preview remains local; selected plum link: http://127.0.0.1:43831/?preview=events&event=halloween&palette=plum . No push, merge, PR or deployment.

## Approved Halloween default — 2026-10-21

- User explicitly chose plum as the primary Halloween color and reiterated no push/merge. `DEFAULT_HOME_EVENT_PALETTE` now sets both the resolver fallback and component default to plum. Missing/invalid/repeated palette queries use plum; explicit forest/pumpkin comparisons still work.
- Production remains normal because the development-only preview guard is unchanged. Normal mode still mounts no decorations or palette attributes.
- Verification: two event checks, Next type generation, TypeScript, browser default/fallback/active-swatch/middle-stars checks, explicit forest selection and normal restore passed. Browser evidence: `default-palette-results.json`. Default static markup remains byte-identical to the pinned main baseline.
- Standard Halloween preview now shows the selected design without a palette parameter: http://127.0.0.1:43831/?preview=events&event=halloween . All changes remain uncommitted in this worktree; no push, merge, PR or deployment.

## Runtime selection extension — 2026-10-22

- Owner authorized a backoffice selector without redeploy, homepage only, no push/merge. Implemented and verified in the same attached worktree. Details and commands: `docs/agent-memory/public-home-runtime-theme.md` there.
- `/system/home-theme` saves normal/Halloween (plum) to a dedicated platform setting with admin permission, conflict detection and atomic audit. `/` reads it without cache; failure returns normal. Production query overrides remain disabled, but production code now supports the saved setting once this feature is released.
- API/web builds/types, real local PostgreSQL/HTTP, baseline, admin/browser and permission checks pass. Local review at http://127.0.0.1:43831/system/home-theme and http://127.0.0.1:43831/ ; isolated local API/DB only. All work still uncommitted/unpublished.

## Integration authorization — 2026-10-22

The owner subsequently requested “merge develop+main เลย”. Earlier no-push/no-merge notes above describe the historical prototype scope and are superseded for branch integration. Runtime settings, permissions, real API/DB and browser checks are recorded in `public-home-runtime-theme.md`. No deployment or Production theme activation is included.
