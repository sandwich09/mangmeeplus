# Agent Memory: receipt-ocr-classification-rubric

Status: DONE — VERIFIED on prod 2026-07-14 22:57: both owner sample bills pass the full
isExpenseExtractionEligible simulation 4/4 runs (03 ใบกำกับภาษีอย่างย่อ → TAX_INVOICE,
total 11,875.00, ~10-14s; 04 บิลเงินสดเขียนมือ → HANDWRITTEN_CASH_BILL, total 12,500,
~40-50s). Three extra prompt rounds were needed after the initial rubric: (1) don't
demote kind to NEEDS_REVIEW on completeness gaps, (2) define documentFamily semantics
(settled purchase evidence = EXPENSE_EVIDENCE) + reason codes must not contradict
extracted fields, (3) amountSignals must carry the bare total NUMBER verbatim — a
combined-phrase example caused parseExactSpans (verbatim documentText.includes filter)
to drop every span. Owner still to confirm via UI "อ่านเอกสารอีกครั้ง".
Owner: thawtchai (decision 2026-07-14: "prompt fix แต่ไป research ก่อนว่าบิลต่างๆ ควรเป็นแบบไหนบ้าง เพื่อกำหนดทิศทางจริงๆ ไม่ใช่ handler แค่เคสนี้")
Scope: apps/ai-gateway RECEIPT_OCR_PROMPT (line-ai-internal.controller.ts) + docs/specs/business-document-image-intake-spec.md (§3.4 owner update)

Decisions:
- 2026-07-14 OCR timeout: DOCUMENT_OCR_TIMEOUT_MS=45_000 dedicated const (was borrowing AI_TOOL_TIMEOUT_MS=15s → dense receipts failed; handwritten bill measured 39.5s on prod). DEPLOYED + verified, uncommitted.
- Root cause of NOT_EXPENSE_DOCUMENT on FlowAccount sample bills (owner test docs in ~/Downloads/03_*.jpg, 04_*.jpg):
  1. Prompt drift from spec 5.1(2): spec counts "an explicit receipt title" as settlement evidence; prompt omitted it → titled ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ doc classified ORDER_OR_CHECK_BILL conf 0.95.
  2. businessDirection perspective undefined in prompt AND spec §3.4 (acceptance #22 implies tenant perspective) → model judges from issuer voice → SALES_RECEIVABLE for every supplier-issued bill → fails api gate (isExpenseExtractionEligible: PURCHASE_EXPENSE or UNKNOWN+explicitExpenseContext).
  3. Handwritten grand total seen in amountSignals ("12,500") but not mapped to fields.grandTotalAmount (stage-2 haiku conservatism/quality).
  4. Stage-2 haiku flaky JSON (intermittent OCR_JSON_PARSE_FAILED on same input). Model upgrade offered; owner chose prompt-fix-only for now.
- Gate code (isExpenseExtractionEligible, expense-document.logic.ts) is NOT to be loosened — spec-driven, codex-hardened. Fix the model inputs (prompt), not the gate.

Decisions (post-research):
- Research CONFIRMED title-as-settlement (ม.105: ใบรับ issued "ในทันทีทุกคราวที่รับเงิน") — recorded in docs/research/thai-document-conventions-receipt-ocr.md; spec §3.4.1 owner update adds direction perspective; prompt aligned (title-settlement + phrase lists + PAID/settlementSignals instruction + direction rule + handwritten-total mapping).
- Owner follow-up decision: stage-2 document understanding upgraded to Sonnet via new optional DOCUMENT_AI_MODEL_ID (config + provider factory opts + deploy.sh + .env=global.anthropic.claude-sonnet-4-6); chat/intent-router stays on BEDROCK_MODEL_ID haiku. Unset → falls back to BEDROCK_MODEL_ID.
- .env trap hit: file had no trailing newline → appended comment glued onto CRM_AI_MIN_CONFIDENCE line → `source .env` syntax error → deploy aborted while the poll loop saw the PREVIOUS COMPLETED rollout and reported success. Guard: check deploy script exit before polling; verify .env sources cleanly after appends.

Artifacts:
- Spec authority: docs/specs/business-document-image-intake-spec.md §5 gates, §13 RD references (ม.105, 105ทวิ, 86/4).
- Typhoon spec has no classification rules (no dual-update needed).
- Prod probe harness: POST {ai-gateway ecs URL}/v1/internal/ai/receipt-ocr with X-Internal-Secret (Secrets Manager watchdog-bms/production/ai-gateway-internal-secret); test images in ~/Downloads.

Verification:
- Plan: probe both sample images on prod post-deploy; expect 03 → RECEIPT/TAX_INVOICE + auto-fill eligible; 04 → HANDWRITTEN_CASH_BILL + grandTotal 12,500 mapped + direction UNKNOWN/PURCHASE_EXPENSE.

Next:
- Ingest research output → write intake-spec §3.4 owner update (direction perspective + fail-to-UNKNOWN) → align RECEIPT_OCR_PROMPT (title-as-settlement + Thai settlement phrases + direction rule + handwritten-total mapping hint) → typecheck/test → deploy ai-gateway → probe both images → report + commit.
