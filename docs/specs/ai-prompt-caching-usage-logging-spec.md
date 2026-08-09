# AI Prompt Caching & Token Usage Logging Spec

## 1. Status

Ready for implementation. Authored 2026-07-26 (Fable 5 planning lane); implementation lane: Opus 5.

Linked plan: [[plans/ai-prompt-caching-usage-logging-plan|AI Prompt Caching & Usage Logging Plan]]

Owner decision 2026-07-26: enable Bedrock prompt caching on both chat lanes (employee LINE AI + CRM customer AI) and the document OCR lane, and emit per-call token usage logs. Fable 5 plans/specs and verifies business correctness; Opus 5 implements, tests, and reviews.

## 2. Goal

Cut repeated-prefix Bedrock spend without changing any reply behavior, and make token spend observable per call site so future cost questions are answered from real data instead of reconstruction.

Measured baselines (2026-07-26, Bedrock CountTokens on real prompts, Sonnet 4.6 at $3/$15 per MTok):

- Receipt OCR stage-2: system prompt 2,210 tokens resent every scan (≈ ฿0.22/scan of ฿0.44 total).
- Employee business question: 6 model calls, ~11.1k input tokens; the two biggest stable chunks are the intake-router system (~1.9k tokens) and the intent-router feature catalog (~3.5k tokens, currently inside the varying user message so it can never cache in place).
- Customer auto-reply: ~3.0k input tokens/answered message; CRM reply system ≈ 1.2k tokens stable.

Expected effect: employee business question ≈ ฿1.33 → ~฿0.6–0.7; receipt scan ≈ ฿0.44 → ~฿0.25; customer answered message ≈ ฿0.39 → ~฿0.30 (5-minute TTL windows; savings realized under sustained traffic).

## 3. Scope

In scope (all inside `apps/ai-gateway`; ERP core API untouched):

1. `BedrockProvider` (`ConverseCommand` path): inject `cachePoint` blocks and log usage.
2. Provider port: two optional input fields (`cacheableContext`, `usageTag`) on `ProviderInput` and `ProviderToolsInput`.
3. Intent router `route()`: move the deterministic feature catalog into `cacheableContext`.
4. All AI-gateway provider call sites: pass a `usageTag`.
5. Unit tests + registration in the hand-maintained `apps/ai-gateway` test list.
6. One live smoke proving cache read > 0 on the second call (dev credentials, ap-southeast-1).

Non-goals (explicitly out):

- No 1-hour TTL, no cross-request message-history checkpoints (loop history is per-turn; 5-min default TTL only).
- No caching on the OpenAI provider (it must keep byte-equivalent *behavior* when the new fields are passed: prepend context, ignore caching).
- No change to the AgentCore runtime path, Typhoon client (free/external), disabled provider semantics, or any ERP-core API code.
- No deploy in this task (deploy + UAT verify is a follow-up; UAT must follow the env-preserve runbook).
- No cost computation, aggregation, or dashboard — raw counts in logs only.
- No restructuring of `routeIntake()`'s payload (its stable parts are below the cacheable minimum; its 1.9k-token system prompt is covered by the automatic system checkpoint).

## 4. Design

### 4.1 Cache mechanics (Bedrock Converse)

The provider uses the Converse API, so caching uses `{ cachePoint: { type: 'default' } }` content blocks (not the Anthropic-native `cache_control`). Installed `@aws-sdk/client-bedrock-runtime` 3.1075.0 already types `CachePointBlock` and returns `usage.cacheReadInputTokens` / `usage.cacheWriteInputTokens`; no dependency change.

Constraints honored:

- Claude Sonnet 4.x minimum cacheable prefix = 1,024 tokens. Below the minimum a checkpoint is silently ignored (no cache write, no extra billing) — the size gate exists to avoid dead checkpoints, not billing risk. Threshold: `CACHE_MIN_CHARS = 4000` characters ≈ 1,270 tokens at the measured ~3.14 chars/token (review round corrected the initial 3,000, which landed under the floor). Exported so specs assert against the real boundary.
- Max 4 checkpoints per request; this design uses at most 2 (system + cacheableContext).
- Cache scope is per AWS account + model + byte-identical prefix. A hit requires the exact same prefix bytes, so per-company/per-user variation simply misses — there is no cross-tenant readback surface; the cache changes billing, never content.

### 4.2 Provider port additions (`provider.port.ts`)

```ts
export type ProviderInput = {
  ...existing...
  /** Deterministic, byte-stable context rendered as the FIRST content block of the first
   *  user message, before that message's text. Bedrock adds a cachePoint after it when
   *  long enough; OpenAI prepends it to the first user text (same model-visible content,
   *  no caching). Callers must pass byte-identical strings for identical logical context. */
  cacheableContext?: string;
  /** Short call-site label for usage logs, e.g. 'ocr.receipt.extract'. */
  usageTag?: string;
};
```

Same two fields on `ProviderToolsInput`. `ProviderOutput`/`ProviderToolsOutput` unchanged — usage stays a logging concern inside providers; no contract widening.

### 4.3 BedrockProvider behavior

- `system`: when `systemPrompt.length >= CACHE_MIN_CHARS`, send `system: [{ text }, { cachePoint: { type: 'default' } }]`; otherwise `[{ text }]` as today.
- `cacheableContext`: always rendered as a leading `{ text: context }` block of the first user message (so model-visible content is deterministic regardless of caching); a `cachePoint` block follows it only when `context.length >= CACHE_MIN_CHARS`. Attachment blocks (images/documents) keep riding the last user message, after its text — unchanged.
- `generateWithTools`: same system rule. Tools render in the same cached prefix (tools → system precede messages), so one system checkpoint covers toolConfig + system; distinct tool sets create distinct cache entries, which still pays off within one turn's loop iterations (write 1.25× + read 0.1× < 2 full-price calls).
- Usage logging: after every `client.send` resolution (success or mapped error), emit one line via `console.log(JSON.stringify(...))` — same observability pattern as `crm.autonomy.decision`:

```json
{"msg":"ai.usage","tag":"ocr.receipt.extract","modelId":"...","ok":true,
 "inputTokens":2627,"outputTokens":374,"cacheReadInputTokens":2210,"cacheWriteInputTokens":0,
 "durationMs":4180}
```

  - `tag` defaults to `'untagged'` when the caller passed none. `ok:false` lines carry
    `errorCode`; real response usage is retained on a later parse error. A Bedrock timeout aborts
    the SDK request and reports `usageEstimated:true` with a conservative 200k-input + requested
    max-output estimate because the aborted response has no exact usage.
  - No message content, prompts, or user data in the log line — counts and identifiers only.

### 4.4 OpenAI provider parity

`cacheableContext` is prepended to the first user message text (`context + '\n' + text`) so both providers show the model the same information; no OpenAI caching in this task. `usageTag`: if the Responses API result carries usage numbers, log the same `ai.usage` shape (fields that exist); otherwise skip silently. Disabled provider: ignores both fields.

### 4.5 Intent router catalog split (`intent-router.agent.ts` `route()` only)

Today: `route()` serializes `{ messageText, hasAttachment, ...catalog }` into one user string — `messageText` first, so the ~3.5k-token catalog can never form a stable prefix. Change to:

- `cacheableContext: JSON.stringify(buildFeatureCatalog())` — deterministic registry order, byte-stable across all messages.
- message text: `JSON.stringify({ messageText, hasAttachment, conversationContext?, openClarifications?, correction? })` (same keys as today minus the catalog spread).

`INTENT_ROUTER_SYSTEM_PROMPT` keeps the sentence "Use the feature/tool catalog from the user payload…" — the catalog still arrives in the user turn (as its leading block). No prompt wording change.

`routeIntake()` payload is unchanged (see non-goals).

### 4.6 usageTag assignments

| Call site | tag |
|---|---|
| receipt OCR PDF stage-1 read | `ocr.receipt.pdf-read` |
| receipt OCR image stage-1 re-read (only when the first reading left no usable total) | `ocr.receipt.image-reread` |
| receipt OCR stage-2 extract | `ocr.receipt.extract` |
| bank statement extract | `ocr.bank-statement` |
| intake router (`routeIntake`) | `line.intake-route` |
| plan router (`route`) | `line.plan-route` |
| orchestrator native/JSON loop | `line.loop` |
| coverage critic | `line.critic` |
| composeAnswer | `line.compose` |
| polishLanguage | `line.polish` |
| CRM intake / reply / booking / trust / summary / insights / broadcast / profile-extract | `crm.intake`, `crm.reply`, `crm.booking-extract`, `crm.trust`, `crm.summary`, `crm.insights`, `crm.broadcast`, `crm.profile-extract` |
| AI draft suggestion | `ai.draft` |

Prompt-cache beneficiaries at current prompt sizes (as-built, threshold 4,000 chars): `ocr.receipt.extract` (7.2k chars → live-verified cache read 2,174 tokens), `line.intake-route` (6.3k), `line.plan-route` (system 3.2k rides under the catalog checkpoint — live-verified cache read 5,094 tokens covering system+catalog together), `crm.reply` (4,013 chars — only 13 above the gate; trimming that prompt silently drops CRM reply caching). NOT cached at current sizes: `line.loop` (loop system prompts measured ~1.9–2.1k chars, not the ~4.2k first estimated — the employee-question saving is correspondingly smaller than first projected). Everything else logs usage only — checkpoints are size-gated, not tag-gated, so prompts that grow past the threshold start caching automatically.

## 5. Business rules preserved (verification anchors)

1. Reply text, refusal templates, gates, and JSON contracts are unchanged — this task adds request metadata and logs only. Specifically untouched: `isExpenseExtractionEligible` gate, CRM auto-reply consent/cap/confidence gates, orchestrator permission checks, provider error mapping.
2. Model-visible content is equivalent: the only content restructure is `route()`'s catalog moving from "first part of one JSON string" to "leading content block of the same user turn". The existing intent-router spec assertions and the business-query regression corpus must still pass.
3. AI Gateway boundary: no DB access added, no ERP-core changes, `X-Internal-Secret` paths untouched.
4. Logs carry no customer/message content (PDPA posture unchanged).

## 6. Acceptance criteria

- A1 Bedrock `generateText` with a ≥3,000-char system prompt sends `system: [{text},{cachePoint}]`; below threshold sends `[{text}]`. Same rule in `generateWithTools`.
- A2 `cacheableContext` renders as leading first-user-message block (+ checkpoint iff ≥ threshold); attachments still attach to the last user message.
- A3 Every provider call emits exactly one `ai.usage` line: tagged, with input/output/cacheRead/cacheWrite token counts on success, `errorCode` on failure.
- A4 `route()` sends the catalog via `cacheableContext`; its message JSON no longer contains `enabledFeatures`/`disabledFeatures`; router plans still parse and the regression corpus spec passes.
- A5 OpenAI provider prepends `cacheableContext` to the first user text; behavior otherwise unchanged.
- A6 `pnpm --filter @watchdog-bms/ai-gateway typecheck` and `test` pass; any new spec file is registered in the hand-maintained test list.
- A7 Live smoke (dev creds, `watchdog-bedrock` profile or default chain, region `ap-southeast-1`, model from `.env` `BEDROCK_MODEL_ID`): two identical `generateText` calls with the real `RECEIPT_OCR_PROMPT`; call 2's `ai.usage` line shows `cacheReadInputTokens > 0`. This proves the model/region accepts `cachePoint` before we rely on it.
- A8 No new dependency; no ERP-core (apps/api, apps/web) file touched.

## 7. Risks

- `ValidationException` if a model/region rejects `cachePoint` → caught by A7 live smoke before rollout; if rejected, abort and record (do not ship a swallow-errors fallback).
- Sub-minimum checkpoints are silently ignored by Bedrock (harmless); the char threshold exists to avoid pointless 1.25× cache writes, not correctness.
- Catalog JSON must stay byte-stable: `buildFeatureCatalog()` derives from static registries, so ordering is deterministic today; the plan adds a spec assertion that two consecutive builds serialize identically.
- Cost regression risk for one-shot prompts (write 1.25× never read): bounded by the threshold and by the fact that every targeted lane is high-repetition.
