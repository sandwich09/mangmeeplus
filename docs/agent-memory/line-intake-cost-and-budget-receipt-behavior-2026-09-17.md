# Agent Memory: LINE intake cost and receipt behavior at AI budget cap

Status: Read-only Production diagnosis complete; owner subsequently requested all fixes in the existing NOGROUP spec and selected separate CHAT/OCR caps. Unified spec/plan prepared; no application or budget changes.
Owner: thawatchai + Codex
Scope: Explain the screenshot's THB55.67 `line.intake-route` usage and whether receipt uploads/OCR remain available after the affected company's monthly AI money budget is exhausted.

## Evidence and boundaries

- Incident correlation and deployed source are established in [the original investigation](uat-line-chat-nogroup-2026-09-17.md). Production source inspected: `fc2838c4cb691033f41595c0d43587f10377d33c`.
- Read the cloud operations and Production support access runbooks before access. Used existing non-root `watchdog-bedrock` / `watchdog-bedrock-dev` credentials and the repository's T1 support connector with ticket `INC-20260917-LINE-AI-COST`.
- Both interactive SSM sessions used server-enforced role `watchdog_support_ro`; verified `transaction_read_only=on`, then explicit `BEGIN READ ONLY` / scoped SELECTs / `COMMIT` / exit. No T2 arming, port forwarding, database write, live LINE send, budget adjustment or deploy.
- Query scope was September 2026 for the company resolved by `LineWebhookEventLog.webhookEventId = '01M2QJ10XYHT1JH6XQG3ACSYZ3'`. Read only aggregate usage/model/token/cost data and limited numeric usage-row examples; did not query customer message text.
- SSM sessions `watchdog-bedrock-dev-kd9akkcgz8xdx4qc686u6a6qqi` and `watchdog-bedrock-dev-i694pyuajuirxscha6e7r8dnne` were both verified `Terminated` after exit (19:42:11 and 19:44:35 Bangkok respectively).
- Current usage matches all screenshot rows: 92 provider calls, THB80.62. All rows use `global.anthropic.claude-sonnet-4-6` and `ok=true`. Provider success does not establish parser or business-flow success.

## Meter results

| Tag | Calls | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Recorded THB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `line.intake-route` | 48 | 129,913 | 36,628 | 391,280 | 168,877 | 55.67 |
| `ocr.receipt.extract` | 14 | 15,946 | 11,093 | 26,820 | 48,380 | 13.29 |
| `line.plan-route` | 15 | 7,301 | 1,774 | 89,870 | 44,935 | 8.06 |
| `line.casual` | 7 | 12,960 | 364 | 0 | 0 | 1.46 |
| `ocr.receipt.image-reread` | 2 | 3,976 | 946 | 0 | 0 | 0.86 |
| `ocr.receipt.image-read` | 1 | 1,896 | 712 | 0 | 0 | 0.54 |
| `line.loop` | 4 | 3,973 | 212 | 0 | 0 | 0.49 |
| `line.compose` | 1 | 1,505 | 200 | 0 | 0 | 0.25 |

`line.intake-route` is about 69% of total cost and averages THB1.16 per call. Recomputed all 48 rows using the deployed pinned price map and each row's recorded FX: zero cost mismatches. This verifies the application meter, not reconciliation with the AWS invoice or current vendor list prices.

Approximate component totals for this tag:

- Ordinary input: THB12.84.
- Generated output: THB18.09.
- Cache read: THB3.87.
- Cache write: THB20.86.

The separately rounded components sum to THB55.66; the authoritative sum of per-call rounded costs is THB55.67. There were 15 calls with cache writes and 33 calls with cache reads. Cache is being used; this evidence does not show that cache is broken. No failed-provider rows account for this tag's total, so conservative failed-call/timeout ceiling metering is not the observed explanation.

The highest-cost call was THB3.30, with 2,909 ordinary input tokens, 3,453 output tokens and 10,610 cache-write tokens. Eleven intake calls sharing a request ID with an `ocr.%` row account for THB26.67; the remaining 37 account for THB29.00. Do not label those 37 as text-only: absence of an OCR peer does not prove absence of media.

## Why the tag costs more than its name suggests

- Deployed `IntentRouterAgent.routeIntake()` uses the company-selected model for routing, business context and image understanding. It sends permission/feature context, categories and available conversation/draft/clarification context, plus image content when present.
- With fused planning enabled, the stable glossary/tool catalog is included in a cacheable block. Source comments describe approximately 21 KB of catalog; do not confuse that character/byte size with the approximately 10,600-token cache prefix observed in some calls.
- For images, the response includes `documentText`, a transcription of the document, as well as the route/plan. The 8,000-token image output setting is a ceiling, not a fixed per-call charge. This tag generated 36,628 output tokens in total.
- The receipt OCR controller already reuses valid `documentText` from intake and skips its first image-reading stage when applicable. `ocr.receipt.extract` then converts the text to receipt fields. Therefore THB13.29 under `ocr.receipt.extract` is not the complete cost of receipt understanding, and the two tags alone do not demonstrate duplicate image reading.
- The screenshot's ordinary input/output headline excludes additional cache-token counters. Those counters still contribute to recorded cost.

Code evidence at the deployed source:

- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`: `routeIntake`, `INTAKE_DOCUMENT_MAX_TOKENS`, `documentText` contract.
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts`: prompt cache blocks and usage counters.
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts`: transcription reuse and structured receipt extraction.
- `apps/api/src/modules/line-ai/application/ai-model-pricing.ts`: pinned component rates and per-call satang rounding.

## Receipt behavior when this monthly money budget is exhausted

This is the THB80 monthly AI money cap, shared by chat and receipt AI for the same company. It is separate from receipt-count quotas, OCR entitlement, file limits and expense permissions.

| Entry point | Expected behavior from deployed code |
| --- | --- |
| Web file upload/manual expense entry | File attachment/upload and manual entry can proceed, subject to normal permissions and other gates. Monthly AI money admission is applied at OCR invocation, not file upload. |
| Web automatic OCR | `ReceiptOcrClient.extract()` fails with `AI_MONTHLY_BUDGET_EXCEEDED` before provider execution and OCR count admission. The attachment/draft already exists; OCR failure does not delete it. |
| Fresh receipt image via LINE | Intake and OCR provider admission fail at the shared money cap. For an authorized expense-capture user, the document decision takes the clarification path and can persist pending media. It returns before automatic expense creation; pending media is not a completed expense. |

Do not promise automatic OCR retry after a budget change, indefinite pending-media retention, or that every LINE/manual clarification path succeeds without AI. These were not established here. No live upload was sent after the cap; the receipt behavior above is a deployed-code trace.

Confirmed error-handling gap in Production:

1. `tryRouteIntake()` catches the budget HTTP error and substitutes `ROUTER_UNREACHABLE`.
2. `tryExtractReceiptFields()` catches the OCR HTTP error and returns `OCR_FAILED` without preserving the budget error code.
3. `formatOcrGovernanceClarifyReply()` handles OCR entitlement/count quota errors, but has no explicit monthly AI money-budget case. The failed-read fallback says the document reader is temporarily unavailable and that the image is retained but no expense has been recorded.

Thus a LINE receipt can receive a misleading temporary-failure explanation for an explicit budget denial. This is distinct from the free-text budget card, and distinct from UAT's ledger NOGROUP failure.

Code evidence at the deployed source:

- `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts`: upload lifecycle.
- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts`: failed extraction preserves existing attachment/draft.
- `apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts`: company AI budget before OCR execution/count admission.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`: error conversion, `decideLineBusinessDocument`, pending-media clarification before `initReceiptUpload`.

Decisions:
- Preserve the company cap. Correctly labeling a refusal must not bypass admission.
- Original diagnostic scope kept ledger and budget/media fixes distinct. Superseded by the owner's later request to combine all five work areas in the same NOGROUP spec/plan; implementation has not started.
- Potential cost work: measure and reduce unnecessary routing context/catalog/output while preserving permissions and routing quality; make routing versus document transcription cost understandable in reporting. Existing transcription reuse is already implemented.
- Owner has now explicitly selected separate CHAT/OCR ceilings under the total, without borrowing. See the combined spec §12 for admission, classification, activation and migration. No company-specific amounts or live activation were requested.

Open questions:
- Split policy is resolved. Company-specific caps remain admin inputs; actual cost savings await the planned before/after corpus, and new split admission remains unimplemented.

Artifacts:
- [Combined NOGROUP, budget, cost and split-cap spec](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md).
- [Original incident investigation](uat-line-chat-nogroup-2026-09-17.md).

Verification:
- Scoped read-only SQL aggregates reproduce the screenshot and all 48 intake costs; both support sessions closed and termination checked.
- Compared receipt, routing, pricing and error boundaries against the exact Production source.
- Documentation whitespace/link checks performed. No runtime code changed; no implementation test or live upload performed.

Next:
- Implement the unified [plan](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md) when requested. The earlier explanation is complete; do not ask again whether the owner wants reserve versus split caps.
