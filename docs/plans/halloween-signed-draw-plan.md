# Halloween server draw simplification

Status: COMPLETE_LOCAL — 2026-10-28. Not deployed.
Spec: docs/specs/halloween-signed-draw.md

- [x] Owner accepts removing signatures and key management, preserving server RNG, origin labels and effects.
- [x] Root removes signing/env config and simplifies server/client response to cardId; preserves protections and updates relevant tests.
- [x] Sol removes proof plumbing and signed export overhead; static PNG save and storyJPEG origin label/effects retained; tests updated.
- [x] Root reviewed combined changes: 53 focused tests, TypeScript and production build pass. Real browser draw/save at 390/1280 passes; downloaded PNG is byte-for-byte the source and retains its unsigned source/card label. Evidence: docs/evidence/halloween-server-draw-2026-10-28/README.md.
- [x] Retire signing-key runbook; no AWS setup, cloud access, package changes or deployment.

## Tab-scoped no-repeat cycle — 2026-10-28

- [x] Keep SECRET at an independent1% server roll; choose normal results uniformly from unseen allowlisted cards.
- [x] Persist only normal-card IDs in tab `sessionStorage`, reset after22, and send the bounded exclusion list to the existing Backend route.
- [x] Reject malformed exclusion input and verify request/storage/server selection with focused tests. All64 public-home tests, standalone web TypeScript and one real HTTP draw with21 exclusions pass. No database, account, dependency or deployment.

Historical signed-draw verification is retained separately; its key requirement is no longer current.
