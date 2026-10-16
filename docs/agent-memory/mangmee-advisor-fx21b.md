# Agent Memory: mangmee-advisor-fx21b

Status: locally complete; required verification recorded; starting commit c18cdf958, uncommitted diff only.
Owner: Fix-up 21B, 2026-10-16.
Scope: B1 dependent task ordering and retained choices; B2 company editable choices and STAFF guidance; B3 available package buttons; B4 voucher payee.
Decisions:
- Replay exact after-fx20/E01,E02,E04,C10 and after-fx20-b/C04,C05 webhook text and router output; none of these gateway logs contains PROVIDER_UNKNOWN.
- Use existing metered intake, task source ledger, web read/preview/apply guards and signed confirmation cards. Preserve budget and final-mutation policy. Exclude lane 21A claims.
- Execute the first source-dependent expense step, retain the other clauses and offer the next button. Independent writes still require selection; an old E02 tap first prepares its missing source. Untyped retained clauses go to preview tools rather than re-entering capture.
- Read company drafts through ListExpensesUseCase and open their existing web editor from URI buttons; chat-local buttons retain signed preview/confirmation without widening chat correction provenance.
- Available catalog offers remain choices even when the shop currently has no usable purchase modes; purchase guards remain authoritative.
- Missing voucher payees use the existing pending-field question/answer mechanism before confirmation.
Open questions: none.
Artifacts: registered existing webhook/security specs; docs/evidence/mangmee-advisor-fx21b-router-replays.json; .live remains local only.
Verification: exact bound-webhook/LINE HTTP replays: 11 passed (including a tap five seconds later and C05 next-task/no-duplicate capture); focused webhook/security/real-module DI/delivery-plan: 749 passed; voucher security: 179 passed. Full contracts: 445 passed. Full gateway: 2,013 passed, 46 socket cancellations identical on c18cdf958. All 37 API specs referencing changed modules: 2,116 passed, 6 skipped, 33 failures identical in name and error/expected/actual details on exact starting commit. Full API final: 11,327 passed, 175 skipped, 2 socket failures identical on exact base; final API and gateway package typecheck scripts passed. Baseline archive: /private/tmp/fx21b-baseline-faaam82l; comparison: /private/tmp/fx21b-baseline-comparison.json.
Next: review the uncommitted diff and /private/tmp/fixup-21b-last-message.md; no further implementation planned. No package.json, budget/final-mutation gate, lane 21A, cloud or commit changes; .live remains excluded. git diff --check passed.
