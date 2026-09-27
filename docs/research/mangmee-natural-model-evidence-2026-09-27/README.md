# Evidence: natural Thai conversations and outgoing LINE payloads

Status: failed conversational acceptance; AI-assisted review, not human certification. No native LINE or Production readiness claim.

- `primary.json` / `primary-manifest.json` / `primary-wire.html`: frozen `f9444099`, 60 planned, 56 observed. NAT06 stops after its first turn; four later questions have no primary output.
- `review-01-04.json`, `review-05-08.json`, `review-09-12.json`: actual wire/tool/effect semantic review. PASS/PARTIAL is per stated criterion, never copied from empty legacy goldens.
- `wire-audit.json`: repository envelope and tenant/route checks; no browser authentication or native LINE validation.
- `pdf-guard-nat06*` / `review-pdf-retest.json`: separate `063b7f2a` retest, 5 observed; no financial writes, but QA evidence failure/current-file mismatch.
- `image-final-nat05*` / `review-image-retest.json`: separate `e9d86738` retest, 5 observed; image fields extracted correctly in intake but not delivered to user. No document reader/preview success.
- `qa-final-media*` / `qa-final-wire.html` / `qa-final-reader-output.json` / `review-final-media.json`: final scoped source `a9763631`, planned10, observed6; PDF reader executes but output fails QA contract and event stays delivery_pending until timeout. No acceptance.
- `direct-image-*`: same model/image with a short provider-only prompt, five fields correct. Not an application or LINE test.

All rows use isolated synthetic fixtures. Images/PDFs and authored draft labels are in `../mangmee-ai-natural-assets-2026-09-27/`; original225 assets/labels were not changed. NAT04 lacks two prior receipt sources, so source-selection/preview acceptance stays BLOCKED_FIXTURE.

Published runtime evidence retains actual wire receipts/hashes, tools/results, Gateway client responses, webhook states, provider usage, reservations and captured effects. Legacy aggregate/attempt exact-golden scores and connection/seed database configuration are omitted. Raw-result hashes allow comparison with the local originals; originals and provider traces live in `/tmp/mangmee-natural-20260927/` and are not durable repository dependencies. A `gatewayResponses` client-method result alone does not prove a Gateway HTTP request or provider call. Timings include acknowledgements and failure replies; conservative usage estimates are not provider-reported tokens.

Regenerate an offline HTML view from any published result/manifest pair using the existing report tool:

```sh
pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/line-ai-natural-wire-report.ts docs/research/mangmee-natural-model-evidence-2026-09-27/primary.json /tmp/mangmee-primary-wire.html docs/research/mangmee-natural-model-evidence-2026-09-27/primary-manifest.json
```

For a new provider run, use `buildNaturalConversationRuntimeManifest` and `runLineReliabilityRuntime` with a clean frozen checkout, compiled API/Gateway, isolated Postgres/Redis/versioned S3, local Gateway and the approved provider profile. Do not reuse this evidence as a new run, insert expected answers into prompts, relax evidence/security validators, or interpret sink acceptance as native LINE acceptance.

See [Thai findings and remaining blockers](../mangmee-natural-real-model-results-2026-09-27-th.md).
