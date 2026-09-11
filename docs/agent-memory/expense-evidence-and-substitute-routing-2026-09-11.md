# Agent Memory: expense-evidence-and-substitute-routing-2026-09-11

Status: FINAL INTEGRATION — latest user authorized resolving conflicts, pushing, waiting for CI and admin merge. Concurrent PR539/540 have already delivered the base evidence review and numbering to develop/main. Reconcile their claim fix with the extra transaction-bound authority checks and integration tests on this same branch. No deployment requested.
Owner: Codex primary agent
Scope: Latest user authorized implementation of the evidence/SRC routing spec and bug/gap/impact checks. Work in existing `/tmp/mangmee-substitute-step3-edit-20260910`, branch `codex/substitute-step3-edit-20260910`, base `d6abe87e`. Preserve earlier uncommitted changes; pre-implementation patch is `/tmp/expense-evidence-pre-implementation-20260911.patch`.

Decisions:
- No accountant send/assignment/queue/notification/REQUEST_REVIEW feature. Pending selections save/reopen the same expense.
- Three explicit evidence routes: reviewed source document, reviewed alternative evidence, substitute receipt. Non-creditable VAT/handwriting alone does not require a certificate.
- Shared v2 review metadata/fingerprint in existing JSON; current facts and scoped active files acknowledged by authorized reviewer, not AI. Confirm/prepare recheck at the transaction boundary.
- Preserve VAT/WHT, cash proof policy, signatures, claim authority, funding, period/finalized locks and immutable document numbers. Existing prepared amendments remain accessible.
- OCR reread retains choices/history but invalidates approval; JSONB order, no-op decimals and generated artifacts do not cause stale loops.
- Latest user additionally authorized commit/push to develop and main. No UAT/Production/cloud or customer-data mutation in this integration request.

Open questions:
- No information needed for the implemented scope. T34 requires representative older/non-accounting users and remains NOT RUN. Full browser/device/failure matrix is not complete; do not claim every path proven.

Artifacts:
- docs/specs/expense-evidence-and-substitute-routing-spec.md
- docs/plans/expense-evidence-and-substitute-routing-plan.md
- docs/research/expense-evidence-implementation-verification-2026-09-11.md
- docs/research/expense-evidence-implementation-evidence-2026-09-11.json
- docs/research/expense-evidence-implementation-checks-2026-09-11.sh
- docs/research/expense-evidence-implementation-mobile-2026-09-11.png
- Baseline research/recovery files remain historical, not post-fix proof.

Verification:
- Final runnable focused checks: API/contracts 761 + web 111 passed, 0 failures/skips. Earlier broader web regression 193 passed; overlapping counts are not additive.
- PostgreSQL source-continuity: 17 passed, 0 failed/skipped. API + web typechecks passed; API used 10 GiB heap after default-heap exhaustion.
- Existing Playwright harness EXP-05, EXP-08, EXP-EVIDENCE: 3 passed after final API/contracts rebuild. Explicit file review fixtures updated; stale edited amounts require review again.
- Actual synthetic source/alternative/SRC journeys all reached CONFIRMED. Alternative real CAS409 preserved input. SRC zero-file review→prepare→unsigned PDF→synthetic paper upload→accept/issue→confirm retained number; local MinIO used.
- First source/alternative metadata-only previews were 404; this is not image-rendering evidence. Real storage was tested in SRC and EXP-05/08.
- Mobile390 fresh context had no horizontal overflow; desktop1440 inspected. T33 broader matrix and T34 are partial/not-run as detailed in report.
- Cleaned exact own 9 expenses, 1 certificate, 1 payment, 10 attachment rows, 8 local MinIO keys. All scoped remaining entity/outbox/journal/number counts zero; counters were not reset. No customer data touched.
- Logs/results: /tmp/evidence-implementation-final-checks.log, /tmp/evidence-{api,web}-types.log, /tmp/evidence-source-pg-tests.log, /tmp/evidence-final-e2e.json, /tmp/evidence-implementation-cleanup-result.json. Durable summary and source hashes in evidence JSON.

Next:
- Push the conflict resolution against main e5baef9b, wait for all CI on the new head, then admin-merge PR536 under the latest user authorization. Do not deploy in this request. For any future release read the mandatory runbooks; finish desired manual/CI acceptance and ship matching backend/contracts/FE/LINE behavior. No destructive migration/backfill or rollback deleting alternative-evidence assessments.
- Local API is running with the task build (`/tmp/step3-local-run.py api`, session28023); web3000 and isolated PostgreSQL15432/MinIO19000 remain available. Only own test records were removed.

## Integration request

Latest user: commit/push develop and main. Inspect remote branches, preserve newer signing/navigation changes, commit the scoped implementation/docs, run PR CI and integrate both branches. Existing PR514/515 are already merged; their old approval was specific to PR515. No new deployment or cloud operation is part of this request.

Integration verification:
- Main PR536 / develop PR537, initial candidate e201b7c0 includes current main8f988a16/develop21fb6f67. Post-merge local focused872, web typecheck and DIGITAL/PAPER read-only/cancelled browser2 passed.
- CI34574009544 and34574012540 failed three web assertions: missing Thai labels for two new errors and two source-wiring expectations from the superseded automatic check-bill behavior. Added actionable Thai text and updated tests to require explicit current review while preserving read-only navigation. No business guard relaxed.
- Main requires one reviewer; requested admin approval specifically for PR536 after all CI passes. Old PR515 approval does not automatically cover it. Develop has no reviewer requirement.

Integration result (2026-09-11 07:53 UTC):
- Published head: 997835cbc594a10eb67ff738dc908459dbb146d8. CI34574926718 and34574927022 both SUCCESS, including full monorepo tests, PostgreSQL, LINE whole-chain and boot checks. Production Image intentionally skipped for pull requests.
- Develop PR537 MERGED at 07:53:25Z, merge97ae64527d8abeb1f7730a6065ef3ccc4e0f6bb7; fetched origin/develop contains published head.
- Main PR536 OPEN/MERGEABLE/BLOCKED, REVIEW_REQUIRED, no reviews. Main remains8f988a16108d20adbd2b08c15acc08b2c3b88ef5. Awaiting async admin permission for this PR; do not reuse PR515 approval.
- The earlier status note was local while awaiting approval; it is now included with the conflict-resolution merge. Only other untracked paths are temporary node_modules symlinks; never stage them.

## Conflict resolution authorized

Latest user: resolve conflict, push again, wait for CI, and use admin merge. Main advanced to e5baef9b (PR538 expense numbering).
- Combined category-nullability/evidence metadata with immutable draft idempotency fields in the contracts/models. Kept current review fixtures with the new atomic-confirm constructor and transactional number allocation. All automatic merges inspected; no product guard weakened.
- Post-merge focused checks: 761 API/contracts + 111 web passed, zero failures/skips; API/web typechecks passed.
- New numbering PG fixtures originally lacked the now-required explicit evidence review (initial failure and cascading flag-off failures retained in /tmp/evidence-conflict-number-pg-initial.log). They now attach a scoped test file and call the real UpdateExpenseDraftUseCase to acknowledge it. Added a combined date/evidence/number save regression. Final 14 real PostgreSQL tests passed, zero failures/skips; local test-owned rows cleaned by suite teardown.
- Logs: /tmp/evidence-conflict-focused.log, /tmp/evidence-conflict-{api,web}-types.log, /tmp/evidence-conflict-number-pg-final.log. Additive migration applied only to isolated local test DB.
- Next: new PR CI must pass before admin merge; previous head CI is not sufficient for this merge.

Post-merge linked-flow check found a real T30 compatibility gap: an approved reimbursement with an attached/source-linked receipt passed `allowMissingReceiptWithReason: false`, so its generated expense projection was incorrectly asked for an expense-side review. The signed/approved claim already owns this decision.
- Keep missing-receipt permission separate from evidence-review authority. Only executeForReimbursement supplies request/line-bound review authority; the repository matches both IDs to the persisted projection after the existing source/hash checks. Normal expense confirm and a wrong claim-line authority still fail without writes. An actual SRC still requires its artifact.
- Final linked PG checks: 47 passed, zero failures/skips, including the real claim confirmation/payout and ordinary/direct/wrong-line negative controls. Focused 872 and API typecheck passed again after this fix. Logs: /tmp/evidence-conflict-linked-pg-final.log, /tmp/evidence-conflict-authority-focused.log, /tmp/evidence-conflict-authority-types.log.
- Push this correction and use CI for the resulting head; CI34577820066 on58a7a308 is superseded. Existing develop numbering PR539 belongs to the concurrent numbering work; do not alter that branch.

## Concurrent main/develop integration

While CI34578313483 ran on035cef7a, PR539 merged develop asfccf06c2 and PR540 merged main as725207a1. Both target trees are identical and include the original evidence implementation plus an independent claim-compatibility fix.
- Resolve the overlap once: retain incoming claim wording/behavior, keep the explicit request/line check in the final transaction, retain both incoming preflight and new repository negative tests, and use real evidence review in numbering tests. No unrelated incoming docs discarded.
- Combined PostgreSQL suite after reconciliation: 61 passed (14 numbering + 31 SRC/source edit + 16 reimbursement), zero failures/skips; /tmp/evidence-main540-integrated-pg.log. Production-code delta against both current targets is three use-case lines and the transaction authority check; remaining changes are tests and task/spec documentation.
- Include both current target ancestries before push, then run CI on that exact final head. Main PR536 and a small develop follow-up carry the same scoped correction so both branches retain it.
