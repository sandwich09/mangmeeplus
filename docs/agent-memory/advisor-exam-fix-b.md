# Agent Memory: advisor-exam-fix-b

Status: implemented; verification complete with reproduced baseline failures and an incomplete baseline API typecheck; started 2026-10-17 02:17 UTC, 60-minute cap.
Owner: Codex, lane B.
Scope: source-grounded expense dates/descriptions, optional cash-note vendor, one missing-field question, receipt/no-receipt claim completion, guarded follow-up edits and truthful approval handoff.
Decisions:
- Existing advisor full-capability plan and reimbursement draft workflow remain authoritative: bot prepares, user presses the signed final button; ordinary web use cases retain tenant, scope, permission, status, provenance and evidence guards.
- Ponytail full; no dependencies, flags, package.json, AI budget, final-mutation policy, bank-account or substitute-receipt signing changes. No commit/cloud work.
- Relative day words use Bangkok civil date, including year boundaries; missing/ambiguous dates are not invented. Source item words recover paraphrased model hints only after semantic admission.
- Cash-note vendor/quantity do not block a total-only note; media and legacy OCR provenance retain receipt completeness checks.
- Receipt photo choice prepares a confirmable draft first; after the save, a later owner-bound photo prepares an update of that same draft with another final button. No-receipt reason is requested only when policy requires it.
- Reuse the injected preview store for the pending photo reference; a new active claim, changed owner/epoch, non-draft status or denied update cannot redirect the attachment.
- Named follow-up edits discover candidates only through the permission-checked list use case, require a unique complete result and keep the existing preview/CAS/apply path.
Open questions: full API typecheck remains incomplete because both changed tree and starting HEAD stall in unchanged line-messaging-credentials.service.ts; no product-policy question.
Artifacts:
- docs/evidence/advisor-exam-b-router-replays.json: 13 original conversations / 17 byte-identical webhook-router pairs; no exam evidence from .live is staged or committed.
- Registered process-line-webhook.use-case.spec.ts: 18 action acceptance cases through real controller, use cases and delivery payload; date table in line-ai-value-normalizer.spec.ts; cash/media guard in expense-document.use-case.spec.ts.
- /private/tmp/exam-fix-b-last-message.md; /private/tmp/exam-b-*.log and JSON verification summaries.
Verification:
- Exact replay plus cash/media acceptance: 19/19 pass; date normalizer: 167/167 including 25 new table cases.
- Contracts build PASS; gateway typecheck PASS; TypeScript syntax/semantic diagnostics on 11 changed API files: zero errors (supplementary, not a full package gate; the remaining production change is approval reply copy).
- Full contracts: 474 pass. Full gateway: 2023 pass / 46 cancellations, identical cancellation records to starting HEAD.
- Full API pretest: 16 pass / 131 skip; full API: 11951 pass / 198 skip / 2 localhost listen-EPERM failures, identical names/errors to starting HEAD. Latest post-freeze rerun confirms the same counts and exact baseline failure records.
- All 40 affected/importing API specs plus mandatory real-module DI and delivery-plan table: latest post-freeze run 2295 pass / 130 skip, zero failures. Separate DI/delivery/source-model set: 89/89 pass.
- API package typecheck attempted for 1050 seconds; clean starting-HEAD mirror attempted for 600 seconds. Both trace 137 source-check events and remain inside the same unchanged credentials source. No full API typecheck pass is claimed.
- git diff --check PASS; package manifests/policies unchanged. Offline sandbox has no PostgreSQL/Docker/provider/browser/live LINE verification.
Noisy/invalid exam expectations:
- X087-A judge combines quantity 1 and amount 620 into 1620; original router and visible facts correctly contain 620.
- X061-A expects deletion without a final press; X065-A expects void without required reason/final press. Existing guarded behavior retained.
- F037-A expects no draft after cancelling collection although the preceding turn already saved one; cancelling collection does not authorize deletion.
- X051-A/X056-B (also X049/X050) fail the real web approval evidence guard; truthful web handoff retained, no evidence bypass.
- X063-A has TOOL_INPUT_NOT_AUTHORIZED before ERP execution for an unproven target; leave provenance intact and hand the route/wording issue to lane A. Language-only and PROVIDER_TIMEOUT items are not deterministic lane-B failures.
Next: review the uncommitted diff; rerun full API typecheck where the baseline compiler stall can be resolved, then run a fresh independent live exam when provider/LINE/PostgreSQL access is available.
