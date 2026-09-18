# Agent Memory: marketplace buyer expense capture — implementation 2026-09-18

Status: W00 decisions v1 committed (contract appendix); W01 starting
Owner: controller session (Fable 5.1) directs; Opus 5 implements per wave; product owner decides policy (appendix §15)
Scope: implement spec v0.11 / plan v0.11 W01–W08 (machine-verifiable parts) on one branch `codex/marketplace-buyer-expense-capture-20260918`; one PR to `develop`, one to `main` after CI; no deploy
Decisions:
- D01 = capture group as separate aggregate, no capture-only `ExpenseRecord`; derived sources are ordinary expenses with lineage columns + server-set `payerUserId` (appendix §2)
- D02 = original ≤ 10,485,760 bytes all lanes; API preprocessing (pdf-lib/pdfjs+canvas/sharp) into chunks ≤ 4,000,000 bytes/≤ 3 pages, oversize pages rasterised/tiled; gateway `capture-read`/`capture-extract` v1; durable `ExpenseCaptureReadJob` claimed by a BullMQ scan worker → internal drain; OCR count once per file, money per provider call (appendix §4)
- D06/D07/D09 per appendix §5/§6/§8; D03/D04/D08 defaults proposed, owner confirmation pending (§15)
- Lanes: web single image unchanged; web single PDF = expense at init + async job; multi-file/append/personal-items = group; LINE image unchanged + §17.6/§18.4 copy; LINE file = group + async + auto-handoff for single expense document (appendix §3)
Open questions: appendix §15 items 1–5 (discount/shipping policy default, flag ON both envs, 90-day retention for no-handoff groups, certificate wording, Bedrock replay budget)
Artifacts:
- docs base commit e6e41700 (owner working copy of spec/plan/research)
- `docs/specs/marketplace-buyer-expense-capture-contract-appendix-th.md`
Verification: (per wave, recorded below)
Next: W01 foundation brief → Opus; then W02-web ∥ W02-LINE ∥ W03; W04; W05+W07; W06; W08; gate; PRs

## Wave log

| Wave | Agent | Status | Verification | Notes |
|---|---|---|---|---|
| W00 | controller | done 2026-09-18 | docs only | 6 read-only explorer reports consolidated into the appendix |
