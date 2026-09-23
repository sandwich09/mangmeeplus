# Agent Memory: UAT and Production Kamal release 2026-09-23

Status: In progress.
Owner: thawatchai + Codex.
Scope: Reviewed main candidate to UAT, then promote its signed images to Production; time every phase and retain failures.
Decisions: Owner chose to remove legacy business-category columns in this release campaign. Deploy the application that no longer reads them first; perform the physical drop only after backup, real-data clone rehearsal, exact service readback, and a separately reviewed contract operation.
Open questions: Contract migration procedure and rehearsal remain to be implemented.
Artifacts: PR #762 (stage application), PR #763 (sync develop); UAT failed operation `20260923T132233Z-063a9259` and private `reconciliation.json`.
Verification: UAT failed before applying migration or rolling services. Read-only UAT DB inspection found legacy columns/enum present and no migration ledger row. All three services still served signed `d6b8838a`; public health OK and gate OPEN. Original failed lock was reconciled after these checks. Production was not mutated. Production populated data: 88 Company categories, 1 signup category; UAT: 36 and 2.
Next: Fix the SSM session credential mismatch, complete PR/CI/branch sync, then prepare and apply the corrected UAT candidate. Continue Production only after signed UAT and migration readiness proof.

## Timing ledger (UTC)

- 13:03:13: task clock started.
- `20260923T131255Z-c219bc1c`: Production read-only preflight passed in 19.217 seconds.
- `20260923T131255Z-6e12d0fb`: original UAT prepare passed in 192.169 seconds.
- `20260923T132233Z-063a9259`: UAT apply failed at migration safety in 97.629 seconds; reconciled without native rollout or DB mutation.
- `20260923T134744Z-d4359c17`: staged candidate UAT prepare completed all build/config phases in 103.242 seconds but reported transport cleanup failure. Its two orphaned SSM sessions were terminated using the exact original nonroot role-session identity; active-session readback is zero. No deployment mutation.
