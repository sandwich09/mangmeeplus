# Typhoon Receipt OCR Spec

## 1. Status

Ready for implementation handoff. This is a focused item 09 follow-up for real OCR provider wiring.

Canonical parent: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 09.

Linked plan: [[plans/typhoon-receipt-ocr-plan|Typhoon Receipt OCR Plan]]

Owner decision 2026-07-03: use Typhoon OCR as the single receipt/tax-invoice OCR provider for the AI receipt capture path. Do not build Azure/Google/AWS/ABBYY fallback or a generic OCR provider registry until real production evidence requires it.

Active implementer target: Sonnet 4.6 or later.

External reference:

- https://docs.opentyphoon.ai/en/ocr/
- https://docs.opentyphoon.ai/en/api-reference/
- https://docs.opentyphoon.ai/en/rate-limits/

## 2. Goal

Replace the current receipt/tax-invoice OCR model call in AI Gateway with Typhoon OCR for Thai receipt images, while preserving the existing item 09 boundaries:

- LINE/web upload creates draft/review expense data only.
- Typhoon OCR extracts suggested fields for Thai receipts, bills, supplier tax invoices, and receipt-like images when the field evidence is visible.
- Parent item 09 validation gates decide which suggested fields may be inserted into draft/review fields.
- Finance still reviews and confirms in web.
- LINE/AI never confirms, pays, voids, exports, posts ledger entries, files tax, or mutates confirmed expenses.

This slice is intentionally narrow. It should make the existing `POST /internal/ai/receipt-ocr` path use Typhoon OCR when configured, without redesigning LINE upload, expense persistence, AI Gateway agents, or the item 09 web review flow.

## 3. Non-Goals

- Multi-provider OCR registry, fallback chain, benchmark framework, or vendor selector.
- Azure Document Intelligence, Google Document AI, AWS Textract, ABBYY, or other OCR vendor integration.
- Self-hosted Typhoon/vLLM/Ollama deployment.
- Adding Python, `typhoon-ocr`, poppler, or a sidecar service for the first image slice.
- Broad AI provider replacement. `MODEL_PROVIDER` remains for normal AI Gateway chat/agent/draft behavior.
- PDF OCR in the first Typhoon image slice. Current code stores LINE file/PDF uploads without `contentBase64`; keep PDF manual-review unless implementation can add it with the same small path and focused tests.
- Final accounting, payment, tax filing, export, or ledger posting mutation from OCR output.
- Paypers-parity text-only LINE expense-note capture, transfer-slip/payment-evidence behavior, handwritten-cash-bill policy, marketplace-screenshot behavior, substitute receipt generation, any-language acceptance policy, and expense category administration. Those belong to the parent item 09 flow; this slice may return source document type or category hints from OCR output only when the existing parent validation/category guards accept them. Do not build keyword dictionaries around Typhoon output as the classifier.
- Guaranteeing OCR quality for every language/script. Parent item 09 must still create reviewable drafts and manual fallback for any-language documents.

## 4. Current Repo Baseline

Current code already has the correct boundary and a narrow insertion point:

- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
  - Downloads LINE image bytes.
  - Sends only JPEG/PNG `contentBase64` to AI Gateway via `tryExtractReceiptFields`.
  - Applies returned `ReceiptOcrFieldResult` to draft expense fields through `applyReceiptOcrFields`.
  - Keeps PDF/file uploads as draft/manual-review because file uploads do not retain `contentBase64`.
- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`
  - Calls `POST /internal/ai/receipt-ocr` with `X-Internal-Secret`.
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`
  - Owns `POST /internal/ai/receipt-ocr`.
  - Currently calls the generic model provider with image input and parses JSON.
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/*`
  - General AI provider port for OpenAI/Bedrock/disabled. Do not expand this into a generic OCR abstraction unless a second OCR implementation is approved.
- `packages/contracts/src/line-ai.ts`
  - Defines `ReceiptOcrRequest`, `ReceiptOcrResponse`, and `ReceiptOcrFieldResult`.
- `packages/config/src/index.ts`
  - Defines AI Gateway env schema. Add only the minimum Typhoon OCR secret/config here.

## 5. Provider Rule

Use Typhoon OCR only for receipt/tax-invoice OCR.

First implementation default:

```text
TYPHOON_OCR_API_KEY=<secret>
```

Rules:

- If `TYPHOON_OCR_API_KEY` is present, `POST /internal/ai/receipt-ocr` uses Typhoon OCR.
- If `TYPHOON_OCR_API_KEY` is absent, return `status: not_configured` for receipt OCR and keep manual review available.
- Do not add `OCR_PROVIDER` yet. The owner has chosen Typhoon; one provider does not need a registry.
- Use the existing `AI_TOOL_TIMEOUT_MS` for Typhoon OCR request timeout.
- Use fixed defaults in code for first slice:
  - base URL: `https://api.opentyphoon.ai/v1`
  - model: `typhoon-ocr`
- Add base URL/model env vars only if a real deployment needs self-hosting or vendor-provided production endpoint differences.
- Do not log the API key, base64 image, raw OCR output, prompts, full provider response, or LINE ids.

## 6. OCR Request Behavior

Typhoon OCR supports PNG, JPEG, and PDF according to official docs, but the repo's active LINE OCR path currently sends only JPEG/PNG base64. First slice supports:

```text
image/jpeg
image/png
```

Implementation target:

- AI Gateway receives existing `ReceiptOcrRequest`.
- Validate internal secret, request id, company id, user id, attachment id, MIME type, and `contentBase64`.
- Send a direct HTTP request with `fetch`; do not add a new SDK dependency.
- Target the OpenAI-compatible OpenTyphoon API:
  - `POST https://api.opentyphoon.ai/v1/chat/completions`
  - `Authorization: Bearer ${TYPHOON_OCR_API_KEY}`
  - `model: "typhoon-ocr"`
  - message content includes the existing receipt field prompt and the image data URI.
- Ask the model to return compact JSON only, matching `ReceiptOcrFieldResult`.
- Parse the first assistant text response using the existing JSON extraction guard.
- If the Typhoon response is markdown or non-JSON, return `status: failed`, `errorCode: OCR_JSON_PARSE_FAILED`, and let the API keep the draft in manual review. Do not ship a fragile markdown regex parser in the first slice.

If the direct chat-completions image payload differs from the current OpenTyphoon API/package behavior, implement exactly one tiny `TyphoonOcrClient` mapper that mirrors the official request shape, then keep the same controller contract.

## 7. Field Schema

Typhoon output must map to existing `ReceiptOcrFieldResult` fields only:

```text
vendorName
vendorTaxId
vendorBranchCode
documentNumber
expenseDate
description
quantity
unitPrice
vatRate
subtotalAmount
discountAmount
taxableAmount
vatAmount
whtRate
whtAmount
grandTotalAmount
vatMode
additionalCharges
confidence
missingFields
```

Rules:

- Use strings for money and quantity fields.
- `expenseDate` must be ISO `YYYY-MM-DD` when visible.
- `vatMode` must be one of `NO_VAT`, `VAT_INCLUDED`, `VAT_EXCLUDED`, `EXEMPT`, `NEEDS_REVIEW`.
- Do not invent missing values.
- If Typhoon does not provide confidence, omit `confidence`; do not fake one.
- Keep unknown or low-confidence fields out of persisted draft fields and list them in `missingFields`.
- `additionalCharges` is an optional bounded array of positive printed charges. Each entry uses a supported kind, positive amount, optional decimal VAT rate (including explicit `0`), and a short exact `evidenceSignal`; discounts and negative rounding are never duplicated into it.
- `whtRate` and `whtAmount` are emitted only when printed. `grandTotalAmount` remains gross before WHT.
- Canonical reconciliation and fallback behavior: [[specs/receipt-additional-charges-reconciliation-spec|Receipt Additional Charges and Total Reconciliation Spec]].

## 8. Validation and Persistence Boundaries

Typhoon OCR output is suggestion data, not accounting truth.

AI Gateway:

- Does not import Prisma, API repositories, LINE SDK, or expense repositories.
- Does not write expense data directly.
- Returns `ReceiptOcrResponse` only.
- Maps provider errors into bounded error codes.

API:

- Applies only validated fields through the existing `applyReceiptOcrFields` path.
- Keeps `aiVerificationStatus = PARTIAL` or `NEEDS_REVIEW`; never marks OCR output as human-confirmed.
- Uses existing date, VAT mode, money normalization, and unit-price derivation guards.
- Keeps finance review mandatory before confirmation.

Persisted metadata:

- Store normalized fields and redacted warning/error codes.
- Store hashes/counts where useful.
- Do not store raw image bodies, full Typhoon responses, raw prompts, object keys, signed URLs, or provider secrets in audit/outbox/logs.

## 9. Error Handling

Map errors safely:

```text
missing TYPHOON_OCR_API_KEY -> status not_configured, errorCode PROVIDER_CONFIG_MISSING
401/403 -> status failed, errorCode PROVIDER_ACCESS_NOT_READY
429 -> status failed, errorCode PROVIDER_THROTTLED
timeout -> status failed, errorCode PROVIDER_TIMEOUT
5xx/network -> status failed, errorCode PROVIDER_UNKNOWN
non-JSON output -> status failed, errorCode OCR_JSON_PARSE_FAILED
unsupported MIME -> status failed, errorCode UNSUPPORTED_MIME_TYPE
```

All failures must leave the receipt draft available for manual review.

## 10. Rate Limit Policy

Official Typhoon OCR docs list `typhoon-ocr` at 2 requests/second and 20 requests/minute for the documented API tier.

First slice:

- Do not build a queue, cache, or rate limiter before evidence says traffic needs it.
- On `429`, return a safe failure and keep manual review.
- Log only request id, status/error code, duration, and attachment id.

Add a queue/backoff later only when production logs show real throttling.

## 11. Acceptance Criteria

- [ ] `TYPHOON_OCR_API_KEY` is accepted by AI Gateway config without exposing the value.
- [ ] `POST /internal/ai/receipt-ocr` uses Typhoon OCR when the key is configured.
- [ ] Missing key returns `not_configured` and does not call OpenAI/Bedrock for receipt OCR.
- [ ] JPEG and PNG inputs are accepted; unsupported MIME returns `UNSUPPORTED_MIME_TYPE`.
- [ ] Typhoon success maps to existing `ReceiptOcrFieldResult`.
- [ ] Non-JSON or partial Typhoon output fails safe with manual review still available.
- [ ] 401/403, 429, timeout, and 5xx/network errors map to bounded error codes.
- [ ] Logs, audit, and outbox do not contain Typhoon API key, image base64, raw OCR output, full prompt, full provider response, object key, signed URL, or raw LINE user id.
- [ ] Existing LINE image flow still creates `LINE_UPLOAD` draft and inserts only validated draft/review fields.
- [ ] PDF/file uploads still create manual-review drafts unless this implementation also adds PDF base64 support with focused tests.
- [ ] No LINE or AI final confirmation/payment/void/export/posting mutation exists.

## 12. Test Cases

- Unit: Typhoon client sends Authorization header, `model: typhoon-ocr`, image data URI, and timeout signal.
- Unit: Typhoon client maps 401/403, 429, timeout, and 5xx/network errors.
- Unit: OCR JSON parser accepts compact JSON and strips markdown fences if present.
- Unit: OCR JSON parser rejects empty/non-JSON output with `OCR_JSON_PARSE_FAILED`.
- Controller: missing internal secret rejects.
- Controller: missing `TYPHOON_OCR_API_KEY` returns `not_configured`.
- Controller: unsupported MIME returns `UNSUPPORTED_MIME_TYPE`.
- Controller: mocked Typhoon success returns `status: ok` with normalized receipt fields.
- Integration: LINE image upload path receives mocked Typhoon fields and updates draft vendor/date/document/tax/total/line fields through existing API use case.
- Security: log/audit metadata remains redacted.

## 13. Handoff Notes

Shortest correct implementation path:

1. Add `TYPHOON_OCR_API_KEY` to AI Gateway config schema and service getter.
2. Add one fetch-based Typhoon OCR client next to the LINE AI Gateway receipt OCR code.
3. In `receiptOcr`, call Typhoon when the key exists; otherwise return `not_configured`.
4. Keep the response contract unchanged.
5. Add focused mocked tests.
6. Run a live smoke only when an API key is available; record skipped smoke with the exact reason.

Do not change database schema, web UI, LINE account linking, expense confirmation, or the general AI provider factory for this slice.
