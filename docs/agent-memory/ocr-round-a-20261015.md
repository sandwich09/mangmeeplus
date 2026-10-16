# Agent Memory: OCR round A — receipt/slip reading

Status: Complete locally. All requested checks have passing results; one redundant API recheck remains running because the sandbox denied its stop signal.
Owner: OCR-A, owner direction 2026-10-15.
Scope: Existing receipt extraction/evidence gates, reread decision, Thai slip dates, prompt definitions, tolerant JSON, optional tax ID. OCR-B owns PDF page handling, resizing, orientation and timeouts.

Decisions:
- Follow receipt-tax-integrity spec sections 1–3 and its dated OCR-A correction. The owner's seven findings are the acceptance criteria; this is an existing-flow correction, with no new feature flag, dependency, schema, package.json edit or mutation path.
- Keep source-backed sibling rows and an explicit, prioritized `lines` gap. Unsupported optional unit prices do not invalidate their row. One-pass intake still requires every original row; API apply retains the summary when detail is flagged partial, even if the surviving amounts happen to reconcile.
- Raise both active OCR item-admission limits to 200. The extraction token ceiling stays 8,192 with explicit max_tokens rejection and bounded structural repair; 200 is an admission ceiling, not a promised response capacity.
- Only complete admitted detail with an unexplained arithmetic gap can trigger the existing one image reread. Missing total/VAT, clarification, dropped rows/charges and an alternative VAT mode are not image problems. A replacement still requires the same total, compatible document number and reconciled complete detail.
- Preserve existing tenant, branch, permission, reviewer-source, status and final-mutation boundaries. Both LINE reuse and web upload route through the same extraction/gates; no customer copy or UI flow changes.

Open questions:
- Fresh-model effects of the revised invoice service/delivery instructions are unmeasured: no model calls were allowed. Archived outputs that put purchased delivery/installation rows in additionalCharges remain model errors; this task does not invent quantities to remap them.
- No code/product question remains. A redundant API recheck is still active (session 42462, compiler PID 88164 under pnpm PID 88146). The sandbox denied SIGTERM to that exact verified compiler PID; do not claim it was stopped. The earlier API typecheck passed.

Artifacts:
- `docs/specs/receipt-tax-integrity-spec.md`, dated OCR-A correction.
- Five source files and their five already-registered spec files: gateway controller, classification logic, shared JSON extractor, contracts value normalizer, API receipt apply service.
- Untracked `.ocr-bench/baseline/*.gated.json`: originals copied before replay and verified against the original git sources, 120/120 identical field outputs.
- Untracked `.ocr-bench/gate-replay.ts`: WT points to this worktree; adds classification and reread decisions to replay output.
- Untracked `.ocr-bench/compare.mjs` and `comparison.json`: reuse the supplied analyzer's scoring against root manifest.json for every recorded extraction.
- Untracked `.ocr-bench/audit.ts` and `audit.json`: load original git sources offline, disable one correction at a time for attribution, and simulate final selection using the most recent read before each extraction. This matters when LINE intake is followed by a fresh read; the supplied replay pairs reads by index instead.
- Untracked `.ocr-bench/last-message.md`: compact handoff, at most 40 lines. Do not commit .ocr-bench.

Verification:
- `pnpm --filter @watchdog-bms/contracts build` — PASS.
- `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test src/line-ai-value-normalizer.spec.ts` — 142/142 PASS, including the exact Thai slip headers and English day-first dates before time.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts src/modules/line-ai/domain/logic/business-document-classification.logic.spec.ts src/common/ai/extract-json.spec.ts` — 156/156 PASS. Includes exact benchmark row strings, partial flag saturation, 200/201 bound, unit-price-only drop, VAT wording/negation, compact references, cash/slip tax gaps, due-date counterexamples, local early-brace repair, truncation and the reread decision table.
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts` — 129/129 PASS. Includes a full 60-row apply through reconciliation, preserved total, 200/201 admission and partial-detail summary safety.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck` — PASS after contracts build.
- `pnpm --filter @watchdog-bms/api typecheck` — PASS: shell session 21707 returned exit code 0 at 15:52 UTC. A redundant recheck (42462) remains running, output `/private/tmp/ocra-api-typecheck.log`; it was started before the earlier result was collected. Its exact compiler PID 88164 was verified with `ps -p 88146,88164 -o pid,ppid,etime,%cpu,rss,args`; SIGTERM was denied by the sandbox. No process was stopped by pattern. Do not launch another duplicate.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx ../../.ocr-bench/gate-replay.ts r1 r2 line1 nt` — PASS; 120 stage-2 outputs from 96 run/document cases across the 37-document corpus.
- `node .ocr-bench/compare.mjs` — correct scored fields 851→919 of 960; complete items 79→104; 16 distinct documents improve; ZERO previously-correct scored fields become wrong.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx ../../.ocr-bench/audit.ts` — PASS; baseline matches 120/120, same-source field regressions 0, and final-selection regressions against original recorded responses 0, using chronological read association.
- `git diff --check` — PASS. All five touched specs are in existing package test scripts. No package.json changed. No network/model/cloud/deploy calls or commits.
- Browser/DB E2E was not run: this is a local gate change with no UI change and the sandbox has no network/docker. The registered API apply test exercises the downstream money/reconciliation contract without a database.

Per-finding replay evidence (distinct corpus documents; counts overlap; extraction passes include first/repeated/repair outputs):

| Finding | Distinct documents affected | Recorded pass evidence |
| --- | --- | --- |
| 1. Futile rereads | 10 avoid a reread | 15 of 19 actual image rereads skipped: r1 6/7, r2 5/6, LINE 4/5, nt 0/1. Four genuine gaps remain eligible. |
| 2a. Derived unit price | 1 complete item block rescued | 2 passes; only unsupported unit price removed. |
| 2b. Quotes / partial rows | 8 admit evidence; 5 become complete/correct | 9 passes admit rows, 5 gain a correct complete item block. Partial survivors remain flagged. |
| 2c. 40-row cap | 3 admit rows; 2 become complete/correct | 8 passes affected; 7 gain a correct complete item block. The scanned-PDF model output still lacks rows. |
| 3. Due-date false contradiction | 1 clarification removed | r2 a4-3 first extraction now stays PAID without a HUMAN_REVIEW_REQUIRED escalation. |
| 4. Slip dates | 2 dates restored | 7 passes; four first extractions across runs. Exact requested headers are unit-tested. |
| 5. Definitions / normalization | 3 VAT-mode, 3 whole-baht, 3 reference documents | 4 VAT modes corrected from explicit wording; 6 cash-bill passes gain correct items; 9 references compacted, 3 passes across 2 documents become manifest-correct. Service-row prompt effect on old outputs: 0; requires a future model run. |
| 6. Early JSON brace | 4 parsed without repair | 5 first extractions recover fields; values are unchanged. |
| 7. Optional tax ID | 7 false-gap documents | 23 extraction outputs / 20 run-document cases lose the false flag. Full invoice requirements remain. |

Next: No implementation work remains. Leave the diff and all benchmark artifacts uncommitted. The redundant checker may finish in the background; no deployment is in scope.
