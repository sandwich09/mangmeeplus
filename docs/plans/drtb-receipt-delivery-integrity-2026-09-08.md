# Plan: receipt delivery integrity

1. Reuse a small UTF-16-safe LINE preview function; align producer, strict validation and narrowly bounded legacy repair.
2. Persist repairs before replay; retain canonical text on genuine presentation fallback. Stamp authorized company before outcomes are created.
3. Add a permission-scoped receipt status response before generative routing, including several recent receipts and explicit saved/review status.
4. Correct absent missingFields defaults without changing forms, totals, quota or identity data.
5. Add regressions for Thai emoji boundaries, unchanged full content, corrupt outcomes, CAS/replay, multi-receipt status and permissions, and complete OCR metadata.
6. Run focused tests and typecheck; review diff and CI. Commit, push, PR/admin merge develop then main. Record SHAs/PRs and leave both deployments on hold.

Verification and delivery evidence: docs/agent-memory/drtb-three-receipts-delivery-2026-09-08.md.
