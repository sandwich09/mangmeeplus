# Homepage package guide implementation plan

Spec: `docs/specs/public-home-package-guide-spec.md`. Owner approved this local interactive revision on 2026-10-24. Owner subsequently authorized direct main/develop integration on 2026-10-24 (memory item 40); no PR or deployment requested.

1. Extend the existing `HomePricing` with a current-question index and question heading ref. Keep its answer array and recommendation function; recommend/scroll only after completing the last step.
2. Replace the disclosure/form with an inline guide: simple heading, progress, existing mascot image, speech bubble, one answer group, back control and completion/edit view. Allow `HomeAbilityPop` to accept a class name so its existing visibility logic can also reveal this mascot.
3. Replace obsolete chooser CSS with scoped responsive styling, stable image/answer space and a short mascot entrance inside the existing reduced-motion pattern. Use green/default and plum/festival accents.
4. Adapt the existing pricing interaction test to cover the whole ordered journey, pose changes, back/edit, preserved selections, completion scroll, annual prices and no repeated jump; keep the recommendation boundary checks.
5. Run the focused homepage suite and TypeScript, inspect diffs and verify local HTTP availability. Actual-browser access was previously explicitly rejected by tool URL policy: do not bypass it or claim visual QA. Keep that limitation in task memory and local handoff.

Implementation steps 1–4 complete. Homepage suite passes 26/26, including ordered answers/back/edit/pose/completion focus tests and cross-theme content checks; local preview returns HTTP 200. Browser visual verification remains pending under the recorded tool policy rejection. See item 38 in `docs/agent-memory/public-home-content-copy.md` for final verification and handoff.
