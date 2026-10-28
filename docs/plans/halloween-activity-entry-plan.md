# Halloween activity entrance plan

## Campaign popup — 2026-10-28

- [x] Render the real homepage at bare `/halloween`, open chooser once on entry only while active, and retain manual `/` entry and direct-card behavior.
- [x] Update the approved chooser copy, caption/native share destination and QR; preserve visible domain-only branding.
- [x] Verify lifecycle/theme gating, real 390/1280 layout and close/navigation/refresh; record focused tests and TypeScript in [memory](../agent-memory/halloween-event-popup.md).
- [ ] Owner-authorized UAT release and exact signed-artifact Production promotion, with actual current administrator/OPEN/logout acceptance.

Owner subsequently authorized UAT+Production. Historical statuses below refer to earlier increments.

Status: COMPLETE — local first-screen preview, 2026-10-27. Not deployed.

Spec: [activity entrance](../specs/halloween-activity-entry-spec.md).

- [x] Inspect existing homepage, Halloween event boundary, native dialog and repository/Next.js guidance.
- [x] Isolate current `origin/main` (`86e0e4736`) in the attached `codex/halloween-activity-entry` worktree; preserve unrelated checkouts.
- [x] Sol implements scoped entrance, illustrated door chooser and transient introduction state.
- [x] Luna adds a focused runnable browser check and adjusts the existing seasonal-content test for the explicitly additive activity UI.
- [x] Parent reviews design, integration, keyboard/touch behavior, reset/no-storage behavior and bugs. Fix observed issues.
- [x] Record checks/screenshots and show the local preview. No gameplay or publishing in this increment.

Verification: 26/26 public-home tests, Next type generation/TypeScript, web production build and focused Chrome browser check pass. Default PublicHome markup is byte-identical to the pre-edit baseline. Parent inspected mobile, desktop, intro and short-landscape screenshots. Evidence: `docs/evidence/halloween-activity-entry-2026-10-27/`; exact commands and limits are in [memory](../agent-memory/halloween-activity-entry.md).

## Spooky door names and ambient music — 2026-10-27

- [x] Sol removes remaining action arrows, updates door names/descriptions and adds one quiet native Web Audio loop tied to the modal lifecycle.
- [x] Luna updates existing browser expectations and verifies actual audio start/loop/cleanup, repeated opens and blocked-audio fallback.
- [x] Parent reviews source, audio signal limits and 390/1280 screenshots; runs focused homepage checks and TypeScript, records evidence.

Verification: refreshed browser evidence passes, 26/26 homepage tests pass, production build and TypeScript pass. Audio has a nonzero generated signal, gain 0.06 and one looping source throughout the modal; all dismissal/unmount paths dispose it. Browser checks inspect the signal and running clock, without a physical speaker/headphone listening test.

No mute button is added, per the owner's explicit request. Entering the activity supplies the browser gesture; closing the activity stops its music. Gameplay and deployment remain out of scope.

## Full ghost-card artwork — 2026-10-27

- [x] Produce and obtain owner approval for five regional card styles; confirm 22-character roster and exact มั่งมีพลัส / LINE @mangmeeplus footer.
- [x] Generate remaining cards with built-in ImageGen and apply owner corrections to character identity, face variety and poses.
- [x] Inspect all selected cards and preserve 22 PNG originals in `output/halloween-ghost-cards/cards/`.
- [x] Deliver static catalog, manifest, exact available final prompts/reuse provenance and verified ZIP. No gameplay integration in this increment.

Verification: 22 valid PNGs at 1122×1402, unique hashes, source-copy equality, 22 catalog image paths, ZIP CRC and extracted-image hashes pass. Parent reviewed the live 1280 catalog and full-size image navigation. Details and screenshot location are in task memory.


- [x] Countdown increment: fixed Bangkok cutoffs on 29/30 October 2026 at 00:00, live counters on doors/intros, and automatic disappearance at zero. No gameplay added, per owner choice; keep “กำลังเตรียมเกม” until game implementation.

Verification: three focused date/format tests pass within the 38-test public-home suite; standalone TypeScript and the final web production build pass. Real Chromium at 390/1280 and WebKit with an iPhone profile pass both exact deadlines, chooser/intro updates, foreground resync, interval/listener cleanup, first-door availability and theme-off gating. Parent reviewed mobile/desktop chooser and expired-intro screenshots. Browser time is overridden only by the test harness. Evidence: `docs/evidence/halloween-ghost-reveal-2026-10-27/countdown-results.json`.
