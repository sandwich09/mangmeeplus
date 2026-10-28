# Halloween server draw and concealed reveal

Status: COMPLETE_LOCAL — keyless revision approved 2026-10-28. This specification supersedes its former signed-draw requirements. Owner wants the entertainment game without additional AWS signing-key setup. Verification: docs/evidence/halloween-server-draw-2026-10-28/README.md. Not deployed.

## Current behavior

- Anonymous same-origin POST `/api/public/halloween/draw` selects an allowlisted card using Node randomInt. SECRET is rolled independently at 1%. The first normal draw gives each of22normal cards4.5%; later normal draws are uniform across cards not yet seen in the current tab cycle. Response is only `{cardId}`. No browser-random fallback, key, signature, draw identity/time, account or server history.
- The browser keeps only allowlisted normal-card IDs in `sessionStorage`, sends them in one bounded request header, and clears the cycle after all22normal cards. SECRET never consumes the normal-card cycle. Refresh preserves the cycle; closing the tab clears it. Invalid, duplicate, secret or oversized exclusion input is rejected at the server boundary. A user can clear or alter local storage, which is acceptable for this no-prize entertainment game; the server still performs every random selection and the 1% SECRET roll.
- Preserve current persisted theme gate, development-only preview behavior, same-origin proxy, no-store headers, bounded empty request-body check and anonymous process traffic control. No new AWS configuration, deployment, dependency or DB change.
- Immediate busy/loading says “กำลังเรียกวิญญาณ…”. One request at a time; abort/timeout/retry/stale-completion protection. Audio unlock remains in the original click. Preserve regional effects, temple bell and ordinary4.5s/SECRET7.5s durations.
- During spinning, both sides use back artwork; actual face is absent until reveal. Moving smoke overlays it. Preload actual face off-DOM. Reduced motion waits for the response and avoids spinning. No skip button.
- Original Save directly downloads the existing stamped PNG. Story sharing keeps9:16footer and unsigned metadata `{version,source,event,cardId,variant}`. Visible artwork, pixels and source labels stay unchanged. No authenticity claim or signed proof is attached. Existing source inspection remains possible; labels can be edited or removed.
- Normal repeat play has no per-player daily/lifetime quota while Halloween is active. Anonymous short-term traffic bounds are not a reward/attempt quota. Repeats are prevented only inside the current tab's normal-card cycle; a new tab or cleared browser storage starts a new cycle.

## Acceptance

Production handler draws with an active theme and no signing configuration. No signing/key/proof pipeline remains in active game source or env example. Unknown card responses and desired-card input are rejected; only a bounded allowlisted seen-card exclusion list is accepted. Existing request/theme/error/cancellation controls remain. Tests prove the 1% SECRET gate, uniform unseen-card selection, cycle reset and malformed exclusion rejection. Origin metadata survives actual original save and generatedstory export, with no art changes.

Prior signed implementation and its evidence remain historical only at docs/evidence/halloween-signed-draw-2026-10-28/. The retired signing runbook must not be used to provision keys.
