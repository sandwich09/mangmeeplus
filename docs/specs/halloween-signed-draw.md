# Halloween server draw and concealed reveal

Status: COMPLETE_LOCAL — keyless revision approved 2026-10-28. This specification supersedes its former signed-draw requirements. Owner wants the entertainment game without additional AWS signing-key setup. Verification: docs/evidence/halloween-server-draw-2026-10-28/README.md. Not deployed.

## Current behavior

- Anonymous same-origin POST `/api/public/halloween/draw` selects an allowlisted card using Node randomInt(1000). SECRET has10buckets (1%); each of22normal cards45buckets (4.5%). Response is only `{cardId}`. No browser-random fallback, key, signature, draw identity/time, account or history.
- Preserve current persisted theme gate, development-only preview behavior, same-origin proxy, no-store headers, bounded empty request-body check and anonymous process traffic control. No new AWS configuration, deployment, dependency or DB change.
- Immediate busy/loading says “กำลังเรียกวิญญาณ…”. One request at a time; abort/timeout/retry/stale-completion protection. Audio unlock remains in the original click. Preserve regional effects, temple bell and ordinary4.5s/SECRET7.5s durations.
- During spinning, both sides use back artwork; actual face is absent until reveal. Moving smoke overlays it. Preload actual face off-DOM. Reduced motion waits for the response and avoids spinning. No skip button.
- Original Save directly downloads the existing stamped PNG. Story sharing keeps9:16footer and unsigned metadata `{version,source,event,cardId,variant}`. Visible artwork, pixels and source labels stay unchanged. No authenticity claim or signed proof is attached. Existing source inspection remains possible; labels can be edited or removed.
- Normal repeat play has no per-player daily/lifetime quota while Halloween is active. Anonymous short-term traffic bounds are not a reward/attempt quota.

## Acceptance

Production handler draws with an active theme and no signing configuration. No signing/key/proof pipeline remains in active game source or env example. Unknown card responses and client-selected outcomes are rejected; existing request/theme/error/cancellation controls remain. Origin metadata survives actual original save and generatedstory export, with no art changes. Relevant odds/security/lifecycle/share/metadata tests, TypeScript/build and real browser draw/save pass.

Prior signed implementation and its evidence remain historical only at docs/evidence/halloween-signed-draw-2026-10-28/. The retired signing runbook must not be used to provision keys.
