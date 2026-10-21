# Public homepage event themes

Status: local Cozy Halloween prototype and runtime admin control complete and verified through 2026-10-22. No push, merge or deployment.

## Outcome

Support reusable event and seasonal decorations on the public homepage `/`. Halloween is the first visual prototype; the mechanism must also support future events without rebuilding the normal homepage. The owner requires that every other page remain unaffected and that the normal homepage can be restored after an event.

## Scope and behavior

- Keep a normal/default presentation as the baseline. Preserve its content, links, pricing behavior, section order, layout, metadata, canonical URL and structured data.
- Select one event presentation at a time, or `default`. Future event names identify separate sets of artwork and scoped decorative styles; no event is permanently hardcoded as the site's global theme.
- Choosing `default`, an absent setting or an unsupported event restores the normal homepage and mounts no event decorations.
- Event decorations can add artwork, local color accents and optional motion. They must not obscure text, intercept controls, shift the core content layout or modify business behavior.
- Preserve the current normal-home source/assets at an exact Git baseline. A Git tag is a recovery/reference checkpoint; routine event changes select the homepage presentation, preserving unrelated application updates and customer data.
- The source baseline is `092bad768e9ffb815a50a52bd361eceacf5f4303`, retained with local annotated tag `homepage-baseline-2026-10-21`. It is not a claim about the source currently serving Production; the tag has not been pushed.
- Any later deliberate revision of normal-home content/design must explicitly update its acceptance baseline; switching an event off alone cannot undo unrelated content changes.
- Runtime management was authorized on 2026-10-22; its persistence, permissions and visibility contract is below. Automatic schedules remain out of scope.

## Isolation boundary

- Theme integration lives in the existing `public-home` feature and the `/` route. The existing `.public-home` root is the CSS boundary.
- Scope every event selector and CSS variable under that root and the selected event. Namespace keyframes to avoid collisions.
- Do not place event rules on `html`, `body` or `:root`, change shared design tokens/global styles, or mount decorations in the shared application layout.
- Load selected event artwork/effects only for the homepage. Clean up timers, listeners and effects on navigation; prevent theme leakage even if route CSS remains loaded after client-side navigation.
- Login, signup, password/account flows, legal pages, the ERP workspace and LINE behavior remain visually unchanged. The runtime extension adds only the platform-admin theme control and its narrowly scoped APIs.
- Decorative images use empty alt text and do not receive pointer events. Optional motion respects reduced-motion preferences; mobile layouts reduce decorations as needed.

## Acceptance evidence required before implementation is accepted

1. `default` matches the pinned normal homepage's copy, links, section order and layout at matching viewport/data conditions; verify desktop and mobile screenshots.
2. Selecting an event changes only its decorative presentation. Core content, pricing controls, navigation, signup links and FAQ still work.
3. Missing/unsupported event selection falls back to normal presentation without errors.
4. Verify homepage → login/another non-home route → homepage using client navigation, plus direct loads; no inherited styles, decorations or active event effects outside `/`.
5. Confirm non-home routes do not initiate requests for event artwork/effects.
6. Verify keyboard access, readable content, no horizontal overflow and reduced-motion behavior.
7. Record focused automated checks and browser evidence. Follow the mandatory deployment runbook for any future UAT/Production release or live configuration operation.

## Click/touch and scroll refinement — 2026-10-21

- In Halloween preview, a primary mouse click or completed finger tap releases six small bats from the contact point, scattering and fading within 1.2 seconds. A swipe, keyboard activation, preview control or form edit does not trigger a burst. Cap at three simultaneous bursts; never cancel the original action.
- A small ghost slides down the viewport's right edge as the page scrolls. Fit it in the desktop gutter. On narrow screens, hide it wherever its bounds would overlap text, controls, cards or illustrative content; reappear in clear space. Do not reserve new layout space or cover the mobile CTA.
- Pause/reduced-motion disables these interactions; unmount removes listeners and pending frames. Verify mouse/touch, rapid taps, scroll clearance, existing actions and default/non-home cleanup in the browser.

## Background palette comparison — 2026-10-21

The owner selected plum as Halloween's primary/default palette on 2026-10-21. Forest and warm pumpkin cream remain optional preview comparisons. Select with `palette=forest|pumpkin|plum` in the same development-only preview, with small named color swatches in its toolbar. Missing/unknown/repeated palettes fall back to plum. Match hero, section surfaces, footer and closing panel; adjust foregrounds for readable contrast while preserving all content/layout and interactions. Normal mode ignores the palette. That palette-only step introduced no persistence service. The runtime extension below was authorized separately; the owner still prohibits push/merge.

Owner feedback: plum must remain cohesive through the middle of the page. Include the pricing glow, dark use-case section, mascot/enterprise/security cards, buttons, badges, icons and selected states. Preserve original branding and the contents of actual product screenshots.

Add a subtle 56px grid and the same four-point decorative stars to the plum middle/use-case section. Keep stars in outer gutters and top/bottom padding, with the content above the decorative layer. Reuse existing star motion, pause and reduced-motion behavior. Other palettes keep their current artwork.

## Existing artifacts and next step

The first four [Halloween character prototypes](../prototypes/mangmee-halloween-2026-10-21/README.md) and [local prototype plan](../plans/public-home-event-prototype-plan.md) are complete. Production activation and scheduling remain out of scope.

## Runtime admin selection — authorized 2026-10-22

Implement the [runtime control plan](../plans/public-home-runtime-theme-plan.md) locally. A platform administrator with `system.home_theme.manage` selects normal or an installed event at `/system/home-theme`. Save persists one central DB row and an atomic audit entry. An expected revision prevents silently overwriting another operator. The initial setting is normal; Halloween uses the approved plum palette.

Public reads expose only the effective event ID. Every fresh homepage server request reads the uncached setting with a bounded timeout, falling back to normal on missing, invalid, removed or unavailable configuration. Already-open tabs require reload. Development preview overrides are still local only; deployed pages ignore preview parameters and display the saved choice. The normal page's exact baseline remains the acceptance reference.

Opening/closing/switching installed themes needs no deployment after the initial feature release. Adding or deleting theme code/assets requires deployment; no runtime delete control is provided. Before removal, select normal, then remove the installed entry and code/assets. Test authentication, authorization, validation, persistence, conflicts/audit, frontend error states and admin-to-home behavior, as well as normal/non-home isolation. No push, merge or deployment is authorized by this task.
