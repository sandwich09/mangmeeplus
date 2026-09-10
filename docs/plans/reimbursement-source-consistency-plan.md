# Plan: reimbursement source consistency

Status: member/digital-source scope verified locally; owner authorized commit and develop/main merge on 2026-09-10. Paper/no-account identity remains a separate pending decision. Full ledger integration verification is deferred. No cloud deployment requested.

- [x] Discover current evidence, source lifecycle, projections, signatures/hashes and UI contracts.
- [x] Add nullable per-line source/evidence snapshots and scoped source/recipient contracts; preserve legacy compatibility and separate projection identity.
- [x] Wire locked source assertions through draft → submit → approval → projection → confirmation → payout, including source expense and attachment link/removal guards.
- [x] Add recipient/source selection, exact-source refresh and consistent form/detail/print/export facts using existing components.
- [x] Verify real PostgreSQL races, stale evidence, finance uploads, actual projection/confirmation/payout and idempotency; typechecks and local browser new/edit/detail paths.
- [x] Include retained evidence/policy in A5 classification and reject inappropriate legacy hash fallback, without cloud operations.
- [x] Record field ownership, tax/legacy boundaries, test results and isolated local review entry in task memory.
- [ ] Resolve verified paper payer identity / reimbursement to people without accounts with owner before extending that dependent journey.
