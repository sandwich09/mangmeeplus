# Agent Memory: expense-evidence-and-substitute-routing-2026-09-11

Status: INTEGRATING — user authorized commit/push to develop and main. Locally verified; manual acceptance limitations recorded. No deployment requested.
Owner: Codex primary agent
Scope: Latest user authorized implementation of the evidence/SRC routing spec and bug/gap/impact checks. Work in existing `/tmp/mangmee-substitute-step3-edit-20260910`, branch `codex/substitute-step3-edit-20260910`, base `d6abe87e`. Preserve earlier uncommitted changes; pre-implementation patch is `/tmp/expense-evidence-pre-implementation-20260911.patch`.

Decisions:
- No accountant send/assignment/queue/notification/REQUEST_REVIEW feature. Pending selections save/reopen the same expense.
- Three explicit evidence routes: reviewed source document, reviewed alternative evidence, substitute receipt. Non-creditable VAT/handwriting alone does not require a certificate.
- Shared v2 review metadata/fingerprint in existing JSON; current facts and scoped active files acknowledged by authorized reviewer, not AI. Confirm/prepare recheck at the transaction boundary.
- Preserve VAT/WHT, cash proof policy, signatures, claim authority, funding, period/finalized locks and immutable document numbers. Existing prepared amendments remain accessible.
- OCR reread retains choices/history but invalidates approval; JSONB order, no-op decimals and generated artifacts do not cause stale loops.
- User approved implementation only in this round: no merge, UAT/Production/cloud or customer-data mutation.

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
- Hand off the scoped implementation and local evidence. Do not commit/merge/deploy unless requested. For any future release read the mandatory runbooks; finish desired manual/CI acceptance and ship matching backend/contracts/FE/LINE behavior. No destructive migration/backfill or rollback deleting alternative-evidence assessments.
- Local API is running with the task build (`/tmp/step3-local-run.py api`, session28023); web3000 and isolated PostgreSQL15432/MinIO19000 remain available. Only own test records were removed.

## Integration request

Latest user: commit/push develop and main. Inspect remote branches, preserve newer signing/navigation changes, commit the scoped implementation/docs, run PR CI and integrate both branches. Existing PR514/515 are already merged; their old approval was specific to PR515. No new deployment or cloud operation is part of this request.
