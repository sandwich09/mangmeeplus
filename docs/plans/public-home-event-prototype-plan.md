# Public homepage event prototype plan

Status: COMPLETE — local prototype ready for owner review, 2026-10-21; no push, merge or deployment.

## Product and architecture

Implement the [homepage event spec](../specs/public-home-event-themes-spec.md) against exact main source `092bad768e9ffb815a50a52bd361eceacf5f4303` in an isolated worktree. The locally retained annotated tag is `homepage-baseline-2026-10-21`. Keep the normal homepage output intact and restrict event styles/decoration to its existing `.public-home` boundary.

Prototype control: in development only, `/?preview=events&event=halloween` selects Cozy Halloween and displays a small collapsible preview toolbar. `event=default`, missing and unsupported values render the normal homepage. Production ignores preview queries. Theme selection uses request parameters without storage, business API, shared layout changes or automatic schedules. The toolbar switches modes; a native checkbox pauses decorative CSS animations. This is a visual prototype, not a released runtime-management feature.

## Implementation

- [x] Pin the exact source locally and isolate the checkout; read repo/Next.js/Thai UX instructions and the ponytail skill.
- [x] Capture the unchanged homepage render and browser baseline before editing its implementation.
- [x] Add small event selection/artwork components and narrowly scoped CSS using the existing character assets. Preserve copy, structure, metadata, original stylesheet and product interactions.
- [x] Add warm amber accents, gently floating broom/ghost, peeking mascot and pumpkin; keep the reading area clear and reduce decorations on phones.
- [x] Verify normal-render parity, allowed/unknown selection, pause, reduced motion, existing homepage interactions and isolation on non-home routes.
- [x] Inspect real browser screenshots at 390 and 1280, plus 360/768/1536 overflow checks. Local preview running; opening its Codex browser panel was queued by the app.

### Requested interaction refinement

- [x] Add one homepage-only client effect for native click/tap bursts and a scroll-positioned edge ghost, with bounded particles and cleanup.
- [x] Reuse the existing pause control and reduced-motion preference; keep original layout and pointer behavior intact.
- [x] Check mouse/touch, swipe, burst expiry/cap, scroll clearance, pause, reduced motion, theme/route cleanup and desktop/mobile screenshots.

### Background palette comparison

- [x] Reuse development query selection and add three preview swatches; use owner-approved plum as the Halloween default, retaining forest/pumpkin as comparisons.
- [x] Add scoped pumpkin-cream/plum surfaces and matching readable foregrounds, with no layout/content edits.
- [x] Carry plum through the pricing/use-case/card/control surfaces after owner feedback; add a faint grid and eight existing-style stars to its middle section.
- [x] Check desktop/mobile comparison screenshots, palette selection/fallback, normal baseline, pause/reduced motion and protected files.

## Constraints and handoff

No new dependencies, package.json edits, global tokens, shared root layout, database, permission or business contract changes. No push, merge, PR or cloud operation. Keep evidence, the exact launch command and limitations in task memory; leave the local preview running for review.

Verification: 22 homepage unit/rendered checks pass; web TypeScript check passes; browser acceptance passes with no uncaught browser errors. The default PublicHome static markup is byte-identical to the pinned baseline. See [task memory](../agent-memory/public-home-event-prototype.md) and [browser evidence](../evidence/homepage-event-prototype-2026-10-21/browser-results.json).
