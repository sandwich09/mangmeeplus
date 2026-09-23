# Package and Sale feature scope plan — 2026-09-23

Spec: [commercial feature scope](../specs/package-sale-feature-scope-2026-09-23.md).

1. Put the two narrow rights in the shared feature catalog and paid tier mapping. Keep the existing full Tax entitlement separate.
2. Bind system 50 ทวิ issuance and signature setting to its narrow right, preserving existing full Tax customers.
3. Give ภ.ง.ด.53 a server-checked path for syncing, reading periods/events and computing the report without granting generic Tax routes. Export a dedicated Thai PDF based on the RD main form and attachment, with source and identity validation. Do not use the generic summary PDF for this promise.
4. Show the narrow ภ.ง.ด.53 journey, review issues and manual filed-state action in the workspace and the two added rights on customer offer/deal views.
5. Disable unsellable Sale controls and reject disallowed feature keys on all new/edited snapshot writes. Do not rewrite approved or paid snapshots.
6. Render a representative multi-payment PDF, inspect the main and attachment pages, then run focused catalog, Sale, entitlement/API and web checks. Review package-change impacts and document limits.
