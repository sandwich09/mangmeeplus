# Agent Memory: substitute-receipt-tax-routing-audit-2026-09-11

Status: Audit complete; recommendations for discussion, no application changes authorized/implemented in this round.
Owner: Codex primary agent
Scope: Tax/accounting conditions for internal substitute receipt versus issuer replacement; inspect current web/API/LINE eligibility and review/confirm boundaries.
Decisions:
- No blanket no-VAT/supporting-only/handwritten/attachment-slot => substitute rule.
- Separate expense evidence, actual payment, CIT treatment, VAT credit and WHT obligations.
- Preserve existing local edits, immutable numbers, issued-document correction rules and tenant/payment boundaries.
- User asked to inspect first and identify changes; do not treat research as approval to change policy or deploy.
Open questions:
- Product decision on accepting reviewed alternative payment/business evidence without requiring an internal certificate; distinguish mandatory company policy from law.
- Scope of a draft-save path and cross-channel explicit review semantics, without breaking existing claim/certificate workflows.
Artifacts:
- docs/research/substitute-receipt-tax-routing-audit-2026-09-11.md (Thai findings, primary sources, decision matrix, code gaps, proposed fix and acceptance cases)
Verification:
- 138 focused existing tests passed (26 suites): expense-document.logic, expense-status.logic, substitute-receipt.use-case.
- /tmp/substitute-tax-audit-tests-20260911.log
- /tmp/substitute-tax-audit-20260911.ts and /tmp/substitute-tax-audit-repro-20260911.log reproduce missing valid-receipt guard for abbreviated invoice and overbroad handwritten reason with synthetic facts; no DB calls.
- Source audit at branch codex/substitute-step3-edit-20260910, HEAD d6abe87e plus pre-existing uncommitted changes.
- No cloud, production/user-data mutations, application edits, merge or deploy.
Next:
- Discuss proposed routes, then implement the smallest shared decision change and missing scenario coverage in the same branch when requested.

Follow-up (2026-09-11): User requested a comprehensive spec before coding. Delivered `docs/specs/expense-evidence-and-substitute-routing-spec.md` and its implementation plan; state is tracked in `docs/agent-memory/expense-evidence-and-substitute-routing-2026-09-11.md`. No application changes in this follow-up. The deeper planning trace also found the repository's in-transaction substitute guard, so both that guard and the use-case guard are explicitly in scope.
