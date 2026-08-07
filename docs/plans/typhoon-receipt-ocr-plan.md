# Typhoon Receipt OCR Plan

## Status

Ready for implementation handoff. Focused follow-up to [[plans/master-implementation-checklist|Master Implementation Checklist]] item 09.

Linked spec: [[specs/typhoon-receipt-ocr-spec|Typhoon Receipt OCR Spec]]

Parent item docs:

- [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- [[plans/expense-receipt-upload-plan|Expense Receipt Upload Plan]]
- [[agent-memory/expense-receipt-upload-09|Expense Receipt Upload Agent Memory]]

Owner decision 2026-07-03: Typhoon OCR only for receipt/tax-invoice OCR. Avoid multi-provider OCR until production evidence requires it.

## Purpose

Wire Typhoon OCR into the existing AI Gateway receipt OCR endpoint so LINE receipt/tax-invoice images can produce Thai-friendly draft fields instead of relying on the generic AI model provider.

This is not a rewrite of item 09. The current upload, draft, review, permission, audit, and web confirmation boundaries stay intact.

Text-only LINE expense-note capture, transfer-slip/payment-evidence behavior, handwritten cash bill policy, marketplace screenshot behavior, any-language fallback policy, substitute receipt generation, manual category management, and AI semantic classification into the company category catalogue are parent item 09 follow-ups. Do not bundle them into the Typhoon OCR provider slice unless the owner explicitly asks for a combined implementation, and do not build keyword dictionaries around Typhoon output as the classifier.

## Current Code Paths

Read these before editing:

1. `packages/config/src/index.ts`
2. `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts`
3. `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`
4. `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts`
5. `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/openai.provider.ts` for the existing fetch/error-mapping style
6. `packages/contracts/src/line-ai.ts`
7. `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`
8. `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
9. Existing tests:
   - `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts`
   - `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`

## Core Rule

Use the smallest diff:

- Add `TYPHOON_OCR_API_KEY`.
- Add one Typhoon OCR fetch client.
- Keep `ReceiptOcrRequest` and `ReceiptOcrResponse` unchanged.
- Keep LINE/API expense flow unchanged.
- Keep PDF/manual-review behavior unchanged unless PDF support is a tiny tested addition.

## Phase 0: Baseline Check

### Goal

Confirm the current receipt OCR path before editing.

### Tasks

- [ ] Read the current code paths listed above.
- [ ] Confirm `tryExtractReceiptFields` sends OCR only for JPEG/PNG with `contentBase64`.
- [ ] Confirm PDF/file upload currently creates manual-review draft data.
- [ ] Confirm `receiptOcr` is protected by `X-Internal-Secret`.
- [ ] Confirm existing provider-disabled controller test behavior.
- [ ] Confirm no new permission key is needed.

### Exit Criteria

- Exact edit files are known.
- No database, web UI, permission matrix, or Prisma migration change is planned.

## Phase 1: Config

### Goal

Enable Typhoon OCR with one secret and no provider registry.

### Tasks

- [ ] Add `TYPHOON_OCR_API_KEY: z.string().optional()` to `aiGatewayConfigSchema` in `packages/config/src/index.ts`.
- [ ] Add `get typhoonOcrApiKey(): string | undefined` to `AiGatewayConfigService`.
- [ ] Reuse `AI_TOOL_TIMEOUT_MS` for request timeout.
- [ ] Do not add `OCR_PROVIDER`, base URL, model id, or self-host config in this slice.
- [ ] Ensure production validation does not fail when the key is missing; missing key must return `not_configured` at OCR request time.

### Exit Criteria

- AI Gateway config validates with and without `TYPHOON_OCR_API_KEY`.

## Phase 2: Typhoon OCR Client

### Goal

Create the smallest HTTP client needed by `receiptOcr`.

### Suggested File

`apps/ai-gateway/src/modules/line-ai/infrastructure/typhoon-ocr.client.ts`

Keep it near the LINE AI module. Do not create a provider folder hierarchy unless code style already requires it.

### Tasks

- [ ] Implement a small class/function that accepts:
  - API key
  - timeout ms
  - MIME type `image/jpeg` or `image/png`
  - base64 image
  - receipt OCR prompt
- [ ] Call `POST https://api.opentyphoon.ai/v1/chat/completions` with `Authorization: Bearer <key>`.
- [ ] Use fixed `model: "typhoon-ocr"`.
- [ ] Send the existing receipt extraction prompt and image data URI.
- [ ] Set stable low-temperature OCR options only if accepted by the endpoint.
- [ ] Return assistant text only.
- [ ] Map 401/403, 429, timeout, and 5xx/network errors to existing `ProviderError` codes.
- [ ] Never include the API key, image base64, raw OCR text, or full response in error messages/logs.

If the live OpenTyphoon OCR endpoint requires a different image payload than chat-completions, keep the same client file and change only the request mapper after checking official docs/package behavior. Do not add Python/poppler for the image slice.

### Exit Criteria

- Client is covered by mocked-fetch tests.
- No new dependency is added.

## Phase 3: Wire Internal OCR Endpoint

### Goal

Make `POST /internal/ai/receipt-ocr` use Typhoon.

### Tasks

- [ ] In `LineAiInternalController.receiptOcr`, keep existing internal-secret and payload validation.
- [ ] Keep JPEG/PNG MIME guard.
- [ ] If `TYPHOON_OCR_API_KEY` is missing, return:

```json
{ "status": "not_configured", "errorCode": "PROVIDER_CONFIG_MISSING" }
```

- [ ] If configured, call the Typhoon client.
- [ ] Reuse or lightly harden `parseReceiptOcrJson`.
- [ ] Return `status: ok` only when parsed fields are non-empty.
- [ ] Return `OCR_JSON_PARSE_FAILED` for markdown/non-JSON/empty output.
- [ ] Preserve safe failure behavior for provider errors.
- [ ] Remove receipt OCR dependency on `createProvider(this.config)` from this endpoint.
- [ ] Do not change normal `line-turn` provider behavior.

### Exit Criteria

- Controller tests prove configured, missing-key, unsupported-MIME, provider-error, and non-JSON paths.

## Phase 4: Preserve API/LINE Draft Behavior

### Goal

Confirm the API still applies OCR fields safely.

### Tasks

- [ ] Keep `AiGatewayClient.requestReceiptOcr` unchanged unless error typing needs a tiny update.
- [ ] Keep `ProcessLineWebhookUseCase.tryExtractReceiptFields` image-only guard unless PDF support is explicitly added in this slice.
- [ ] Confirm Typhoon-returned fields still pass existing `applyReceiptOcrFields` guards.
- [ ] Add or update one focused API test where mocked AI Gateway returns Typhoon-style fields and the draft receives vendor/date/document/tax/total/line data.
- [ ] Confirm PDF/file LINE upload still creates manual-review draft and does not call OCR.

### Exit Criteria

- LINE image OCR path still creates draft/review fields.
- Manual review fallback still works.
- No final business mutation is added.

## Phase 5: Verification

### Required Local Checks

Use `corepack pnpm` in this repo.

```text
corepack pnpm --filter @watchdog-bms/ai-gateway test
corepack pnpm --filter @watchdog-bms/api test -- src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts
corepack pnpm --filter @watchdog-bms/ai-gateway typecheck
corepack pnpm --filter @watchdog-bms/api typecheck
git diff --check -- docs packages/config apps/ai-gateway apps/api
```

If targeted API test invocation is not supported by the package script, run the full API test script and record that.

### Optional Live Smoke

Run only when a real Typhoon key and a non-sensitive Thai receipt sample are available:

```text
APP_ENV=local SERVICE_NAME=ai-gateway PORT=3002 AI_GATEWAY_INTERNAL_SECRET=<secret> TYPHOON_OCR_API_KEY=<secret> corepack pnpm --filter @watchdog-bms/ai-gateway dev
```

Then call:

```text
POST http://127.0.0.1:3002/v1/internal/ai/receipt-ocr
X-Internal-Secret: <secret>
```

Expected result:

- `status = ok`
- at least vendor/date/document/total or tax fields recognized from the image
- no key/base64/raw OCR output appears in logs

If no key is available, record:

```text
Live Typhoon smoke skipped: TYPHOON_OCR_API_KEY not provided.
```

## Phase 6: Docs and Memory Closeout

### Tasks

- [ ] Update [[agent-memory/expense-receipt-upload-09|Expense Receipt Upload Agent Memory]] with:
  - implementation files
  - verification commands and results
  - live smoke result or skipped reason
  - known Typhoon limitations
- [ ] Update [[plans/master-implementation-checklist|Master Implementation Checklist]] item 09 follow-up status only after implementation and verification.
- [ ] Keep item 09 checked; this is a follow-up provider slice, not a reopen of the original item.

## Review Checklist

- [ ] No new OCR provider abstraction or fallback registry exists.
- [ ] No new runtime dependency exists unless direct fetch proved impossible.
- [ ] Typhoon API key is never logged or returned.
- [ ] Receipt OCR does not use OpenAI/Bedrock when `TYPHOON_OCR_API_KEY` is missing.
- [ ] OCR failures keep manual review available.
- [ ] Typhoon fields are inserted only through existing draft/review validation.
- [ ] PDF/manual-review behavior is explicit.
- [ ] LINE/AI still cannot confirm, pay, void, export, post, or file tax.

## First Handoff Prompt for Sonnet 4.6

```text
Implement Typhoon Receipt OCR follow-up for Master Implementation Checklist item 09.

Read docs/specs/typhoon-receipt-ocr-spec.md and docs/plans/typhoon-receipt-ocr-plan.md first, then inspect the current AI Gateway receipt OCR endpoint and LINE webhook OCR call path. Keep the diff small: add TYPHOON_OCR_API_KEY config, add one fetch-based Typhoon OCR client, make POST /internal/ai/receipt-ocr use Typhoon when configured, return not_configured when the key is missing, keep ReceiptOcrRequest/ReceiptOcrResponse unchanged, and preserve LINE/web draft-review-only boundaries.

Do not add Azure/Google/AWS/ABBYY fallback, OCR_PROVIDER registry, Python/poppler, self-hosting, Prisma migrations, web UI changes, or final accounting/tax/payment mutations. Verify with focused ai-gateway/api tests and run a live Typhoon smoke only if a key and safe sample receipt are available.
```
