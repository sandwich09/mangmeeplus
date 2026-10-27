# Halloween server draw simplification

Status: COMPLETE_LOCAL — 2026-10-28. Not deployed.
Spec: docs/specs/halloween-signed-draw.md

- [x] Owner accepts removing signatures and key management, preserving server RNG, origin labels and effects.
- [x] Root removes signing/env config and simplifies server/client response to cardId; preserves protections and updates relevant tests.
- [x] Sol removes proof plumbing and signed export overhead; static PNG save and storyJPEG origin label/effects retained; tests updated.
- [x] Root reviewed combined changes: 53 focused tests, TypeScript and production build pass. Real browser draw/save at 390/1280 passes; downloaded PNG is byte-for-byte the source and retains its unsigned source/card label. Evidence: docs/evidence/halloween-server-draw-2026-10-28/README.md.
- [x] Retire signing-key runbook; no AWS setup, cloud access, package changes or deployment.

Historical signed-draw verification is retained separately; its key requirement is no longer current.
