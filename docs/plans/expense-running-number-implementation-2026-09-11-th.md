# Plan: implement expense numbering and linked-flow corrections

Status: IMPLEMENTED; local verification passed 2026-09-11. Release/activation validation remains separate.
Baseline: origin/main `8f988a16`, isolated worktree `/tmp/mangmee-expense-running-number-20260911`.
Spec: [expense-running-number-flowaccount-spec-th.md](../specs/expense-running-number-flowaccount-spec-th.md).

## Product and architecture

Issue EXP on the first deliberately saved/date-reviewed draft; keep it forever across edit/confirm/pay/void. Keep capture staging recoverable without issuing a number. Preserve historic SRC/RB facts, identity, ownership and accounting boundaries. v1 does not enable manual renumber/reuse or guess a paper payer without an account.

Reuse the existing transaction-capable allocator and canonical fingerprint helper. Add nullable draft idempotency key/hash plus tenant-scoped uniqueness; no historical backfill or destructive schema change. Numbering joins create/update/confirmation/projection transactions. Existing numbers and snapshots are immutable; legacy compatibility is explicit. Draft issuance has a rollout flag disabled by default; confirmation always preserves assigned numbers and uses document month for unnumbered records.

## Implementation checklist

- [x] Update spec with concrete B01–B08 fixes, compatibility boundaries and authorization.
- [x] Implement atomic/idempotent manual draft + date-reviewed update and LINE entry behavior; add additive migration.
- [x] Preserve EXP on confirm, use document month, allocate inside aggregate transaction; handle retained legacy number collisions.
- [x] Number each claim-born projection by its own date without touching original sources/snapshots.
- [x] Fix paper document identity and provide clear draft/legacy/date UI; retain cancelled view-only behavior and single view action.
- [x] Make repeated/concurrent payout void recover successfully after existing permission checks, without duplicate reversal/events.
- [x] Add paper payer limitation guidance at the point of choice.
- [x] Repair focused E2E harness contract/role assumptions and resolve local browser prerequisites.

## Integration evidence required

- [x] Focused use-case/domain checks for numbering/renderer/void retry; API and web typechecks.
- [x] Real PostgreSQL concurrent save/confirm/rollback/failure tests; legacy number/snapshot invariants and flag-off compatible writer. Old deployed clients/workers remain a release validation item.
- [x] Live local manual + staged upload/date-review API (no external OCR) + SRC navigation/read-only + source-backed RB reject/finance return/pay/void/cancel.
- [x] Real generated PDF inspection with both EXP/SRC; mobile 390 + desktop 1440 + 200% text/keyboard.
- [x] Real posted journal reversal and closed-period rejection; preserve source/payment/tax facts and verify no duplicates.
- [x] Record exact remaining limits; no claim of target-user usability approval without real participant feedback.
- [x] Review scoped diff, update task memory and evidence; no package.json edit, no unrelated root checkout changes.

## Rollout and rollback

Apply additive schema first. Deploy compatible readers/confirm writers and inventory legacy cohorts A–H before enabling draft issuance. Isolated local E2E enables `EXPENSE_DRAFT_NUMBERING_ENABLED=true`. Turning the flag off must preserve all already assigned numbers and every historical reference. The pre-feature confirm writer is not a valid rollback target after any draft EXP has been issued. Production activation/deployment, if requested, follows mandatory runbooks separately.

Verification: [current evidence, commands and limitations](../qa/evidence/expense-running-number-implementation-2026-09-11/README.md). The baseline proof remains historical evidence.

## Release items still open

- [ ] Authorized target-environment inventory of cohorts A–H, signed history retrieval, queued old LINE/OCR jobs and old browser sessions.
- [ ] Actual external LINE/OCR provider flows, posted ledger worker journey and multi-projection cancellation interruption in target environment.
- [ ] Representative older/nontechnical user usability acceptance, production-size allocator performance and deployment protocol if release is requested.

Additional local fixes: keep Serializable transactions with P2034-only retry; atomic confirm audit and void reversal/audit/outbox; company EXP namespace lock and retained high-water mark; direct reimbursement deep-link redirect; same-command retry even after clearing a required input.
