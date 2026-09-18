# Agent Memory: LINE AI wave 2 — เครดิต AI wording, receipt refusal copy, deterministic reads

Status: spec + plan written 2026-09-18 from owner decisions (message 2026-09-18); implementation starting (H1 wording/receipt copy/billing holds, H2 deterministic reads); nothing deployed.
Owner: thawatchai + Fable 5.1 (controller) + Opus 5 (implementer)
Scope: [spec](../specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md), [plan](../plans/line-ai-credit-wording-and-deterministic-reads-plan-th.md). Continues the A–F remediation ([handoff](line-intake-cost-and-budget-receipt-behavior-2026-09-17.md#delivery-summary-and-handoff--2026-09-18)).
Decisions:
- "เครดิต AI" (not bare "เครดิต") because the ledger/expense UI already uses เครดิต for debit/credit, credit cards and tax credit.
- Document-reading refusals on the picture lane collapse money (OCR bucket / TOTAL on that lane / insufficient) and read-count exhaustion into one customer sentence "เครดิตสำหรับการอ่านเอกสารไม่พอ"; codes, scopes, terminal classes and the R-05 count/money separation are unchanged.
- R5: deterministic families widened (tax/VAT, low stock, AP outstanding, CRM new customers + the daily-closing miss); breakdown/explain questions stay on the grounded agentic path where the composer's numeric guard forbids model-computed numbers; Production keeps the lane enabled (parity default).
- Trial numbers (spec §7): chat 80 THB, receipts 15 (count), OCR money guard 60 THB, total 140 THB — applied per company by an admin after deploy; per-package defaults belong to the coming credit concept.
Open questions:
- Owner authorisation for the R5 corpus replay Bedrock spend (≈ THB 60–100) — W-07 waits for it.
- Owner confirmation of the hold-reconciliation proposal (auto-recover from gateway `ai.usage` logs → admin console release/charge-at-bound → alert) before a spec is written.
Artifacts: (filled per phase)
Verification: (filled per phase)
Next: H1 and H2 implementation in parallel worktrees, controller review, full local gate, PR pairs, strict CI chain.
