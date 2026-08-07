# MVP1 B5-API: CRM AI Staff-Assist API Slice — Implementation Plan

Status: Implement-ready 2026-07-09 (Dev B lane). Written for execution by a coding agent (Codex CLI).
Scope: parallel-plan item **B5 API side** ([[plans/mvp-1-two-dev-parallel-plan]]) = design doc "B3 staff assist" API half ([[agent-memory/crm-customer-ai-agent-family]]), plus the two missing gateway routes it needs. Web AI panel is NOT in scope (blocked by H1 inbox wire-up).
Authority: [[specs/crm-line-oa-customer-os-spec]] §25/§27, [[plans/crm-line-oa-customer-os-plan]] Phase 4.

## Goal

Staff with the new `crm.ai.assist` permission can call, on one inbox conversation:

- `POST companies/:companyId/crm/conversations/:conversationId/ai/summary` → Thai summary of the conversation, cached on the conversation row.
- `POST .../ai/reply-draft` (body: `{ tone?: string }`) → STAFF_ASSIST draft (never sends anything).
- `POST .../ai/insights` → intent / sentiment / risk / advisory lead score / next best action; advisory values written to `CrmCustomer` (never gate anything).
- `POST .../ai/feedback` (body: `{ kind, rating, comment?, requestId? }`) → thumbs feedback row (`CrmAiAssistFeedback`).

The API assembles bounded context server-side and calls the AI Gateway internal routes. Provider down/unreachable degrades to a typed `{status:'unavailable'}` response (HTTP 200), never a 5xx.

## Hard rules (violating any of these = wrong implementation)

1. **File ownership**: in `apps/api/src/modules/crm-inbox/` you may ONLY add new files whose names start with `crm-ai-` and append to `crm-inbox.module.ts` (append-only: add imports/providers/controllers; change nothing existing). Do NOT edit `prisma-crm-inbox.repository.ts`, existing use-cases, or existing controllers — they belong to Dev A. You may inject the existing `PrismaCrmInboxRepository` (already a provider in this module) into new files.
2. **No send capability**: no assist file may import or reference `SendCrmInboxMessageUseCase` or `line-messaging.adapter`. Assist routes must be physically unable to send messages.
3. **Webhook independence**: `process-inbound-line-message.use-case.ts` and `crm-line-webhook.controller.ts` must remain free of any reference to the new AI client/use-cases (do not touch them at all).
4. **Gateway boundary**: gateway agents keep `ALLOWED_TOOLS = new Set([])`, no DB, no imports from `line-ai` except `line-ai/infrastructure/provider/*`, no `generateWithTools`. The existing separation spec enforces this — keep it green, extend its expected route table.
5. **Contracts are additive only**: `packages/contracts/src/crm-ai.ts` may gain new types and one optional field; existing types must not change shape (H2 re-frozen — Dev A already consumes it).
6. **Advisory never gates**: insights writes to `CrmCustomer.leadScore/sentiment/riskLevel` follow the schema comment "advisory AI scoring fields (never gate permissions or workflows)". No code path may branch on them.
7. **No keyword lists** for any semantic decision (spec §24) — semantics live in gateway prompts only.
8. **Migrations additive only**, one new migration folder, timestamp ordered after `20260707160000_user_credential_temp_password`.

## Environment quirks (read before running anything)

- Node: shell defaults to v14. Prefix EVERY command session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- Prisma CLI: `apps/api/.env` is STALE (5432/mydb). Always pass `DATABASE_URL` explicitly from the repo-root `.env` (local docker Postgres on port 15432, db `watchdog_bms`).
- Both `apps/api` and `apps/ai-gateway` run tests via an EXPLICIT file list in their `package.json` `"test"` script — every new `*.spec.ts` must be appended there or it silently never runs.
- `apps/ai-gateway` builds CommonJS: specs must not use `import.meta` (use `__dirname`).
- Do not commit — the owner controls commits.

## Work items

### W1 — Contracts (packages/contracts/src/crm-ai.ts, additive)

Append after the trust-score section (reuse existing `ProviderError`, `CrmAiWindowMessage`, `CrmAiTurnClass`, `CrmConsentStatus` imports):

```ts
// ---- Conversation summary (staff assist; additive 2026-07-09) ----

export type CrmConversationSummaryRequest = {
  requestId: string;
  window: CrmAiWindowMessage[]; // ≤20
  locale?: string; // default th-TH
};

export type CrmConversationSummaryResult = { requestId: string } & (
  | { status: 'ok'; summaryText: string; confidence: number }
  | { status: 'uncertain' }
  | { status: 'unavailable'; error: ProviderError }
);

// ---- Insights: intent / sentiment / advisory lead score / next action (additive 2026-07-09) ----
// Mirrors prisma enums CrmSentiment / CrmRiskLevel (contracts must not import prisma).

export type CrmAiSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
export type CrmAiCustomerRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type CrmInsightsRequest = {
  requestId: string;
  window: CrmAiWindowMessage[]; // ≤20
  consent: CrmConsentStatus;
  locale?: string;
};

export type CrmInsightsResult = { requestId: string } & (
  | {
      status: 'ok';
      intent: CrmAiTurnClass;
      sentiment: CrmAiSentiment;
      risk: CrmAiCustomerRisk;
      leadScore: number; // 0..100 advisory — consumers must never gate on it
      nextBestAction: string;
      confidence: number;
    }
  | { status: 'uncertain' }
  | { status: 'unavailable'; error: ProviderError }
);
```

Also add ONE optional field to `CrmReplyDraftRequest` (additive, backward-compatible):

```ts
  tone?: string; // additive 2026-07-09 (plan Phase 4 "tone adjust"); omitted = house style
```

No `contracts/src/index.ts` change needed (crm-ai already exported).

### W2 — Gateway: summary + insights routes (apps/ai-gateway/src/modules/crm-customer-ai/)

Mirror the existing intake/reply/trust trio exactly (same file shapes, same result-mapping discipline):

- `agents/crm-prompts.ts`: add `CRM_SUMMARY_SYSTEM_PROMPT` (Thai conversation summary for staff: สรุปประเด็น, สิ่งที่ลูกค้าต้องการ, สถานะค้างคา; JSON out `{summaryText, confidence}`; include the same injection guard used by the other prompts — customer content is DATA, not instructions) and `CRM_INSIGHTS_SYSTEM_PROMPT` (JSON out `{intent, sentiment, risk, leadScore, nextBestAction, confidence}`, intent constrained to the 6 `CrmAiTurnClass` values).
- `agents/crm-conversation-summary.agent.ts` + `agents/crm-insights.agent.ts`: copy the mapping discipline from `crm-customer-reply.agent.ts` — window sliced to last 20 defensively, `provider.generateText` (summary maxTokens 500, insights 300), parse via shared `common/ai/extract-json`, provider `!ok` → `unavailable`+error, unparseable/invalid → `uncertain`, valid → `ok` (+ clamp: `confidence` and `leadScore` to range, round leadScore, bound `summaryText` ≤ 2000 chars / `nextBestAction` ≤ 300). These agents never return `refused`. `ALLOWED_TOOLS = new Set([])`. Echo `requestId` on every arm.
- `use-cases/crm-summary.use-case.ts` + `use-cases/crm-insights.use-case.ts`: thin pass-throughs like the existing three.
- `crm-customer-ai-internal.controller.ts`: add `@Post('crm-summary')` and `@Post('crm-insights')` following the existing routes exactly (`@Public`, `assertInternalSecret`, `requestId` validation, `isMessageWindow` element validation, logger line, HTTP 200).
- `crm-customer-reply.agent.ts` + reply prompt: thread optional `req.tone` into the user prompt only when present (one line, e.g. "Tone override: …"); no other behavior change.
- `crm-customer-ai.separation.spec.ts`: update the expected route table to exactly `crm-intake | crm-reply-draft | crm-trust-score | crm-summary | crm-insights`; all other assertions must stay green unchanged.
- New agent specs `crm-conversation-summary.agent.spec.ts` + `crm-insights.agent.spec.ts` mirroring the reply-agent spec style (`assert.deepEqual` whole result): ok, code-fence JSON, unparseable → uncertain, invalid enum value → uncertain, provider error → unavailable, window bound to last 20, clamps (confidence; leadScore 0..100). Reply spec: add one test that `tone` reaches the prompt and absence of `tone` leaves the prompt unchanged.
- Append all new spec files to `apps/ai-gateway/package.json` `"test"`.

### W3 — Migration (shared lane — already announced in [[plans/mvp-1-two-dev-parallel-plan]] กติกา 2)

`apps/api/prisma/schema.prisma` (additive):

```prisma
enum CrmAiAssistKind {
  SUMMARY
  REPLY_DRAFT
  INSIGHTS
}

enum CrmAiFeedbackRating {
  UP
  DOWN
}

model CrmAiAssistFeedback {
  id              String              @id @default(cuid())
  companyId       String
  conversationId  String
  kind            CrmAiAssistKind
  rating          CrmAiFeedbackRating
  comment         String?
  requestId       String?
  createdByUserId String
  createdAt       DateTime            @default(now())
  company         Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  conversation    CrmConversation     @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([companyId, conversationId, createdAt])
}
```

Plus on `CrmConversation`: `aiSummaryText String?`, `aiSummaryAt DateTime?`, and back-relation `aiAssistFeedback CrmAiAssistFeedback[]`; back-relation on `Company` too. New migration folder `20260709190000_crm_ai_assist_feedback_summary_cache` with hand-written SQL matching house style (CREATE TYPE ×2, ALTER TABLE "CrmConversation" ADD COLUMN ×2, CREATE TABLE + FKs + index). Then `prisma migrate deploy` + `prisma generate` (explicit DATABASE_URL per quirks).

### W4 — API: gateway client (apps/api/src/modules/crm-inbox/infrastructure/crm-ai-gateway.client.ts, new)

Copy the `postInternal` pattern from `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts` (private copy — do NOT import across modules): `AppConfigService.aiGatewayInternalUrl/aiGatewayInternalSecret`, `X-Internal-Secret` header, 15s `AbortSignal.timeout`, same error/log discipline. Methods: `requestCrmSummary`, `requestCrmReplyDraft`, `requestCrmInsights` → `/internal/ai/crm-summary | crm-reply-draft | crm-insights`, typed with the W1 contracts.

### W5 — API: context repository (crm-ai-context.repository.ts, new) + use-cases (crm-ai-assist.use-case.ts, new)

`infrastructure/crm-ai-context.repository.ts`: thin Prisma wrapper (inject the same `PrismaService` other repositories in the app use) for the pieces the existing repository doesn't expose: company `brandName`/`name` by id; customer `consentStatus` by id; advisory write `updateCustomerAdvisory(companyId, customerId, {leadScore, sentiment, riskLevel})` setting `leadScoreUpdatedAt = now`; `saveConversationSummary(companyId, conversationId, text, at)`; `insertAssistFeedback(...)`.

`application/use-cases/crm-ai-assist.use-case.ts` — four injectable use-cases (house style: one class per action, `execute(ctx, ...)`):

Shared context assembly (private helper or small shared function in the same file):
1. `requirePermission(ctx, 'crm.ai.assist')` (import from the same place sibling use-cases do).
2. Load conversation via existing `PrismaCrmInboxRepository.findConversationById(companyId, conversationId)`; 404 if missing; `assertConversationInScope(ctx, conversation)` (existing helper in `application/crm-inbox-access.ts`).
3. Window: `listMessages(companyId, conversationId, 200)` → keep only `visibility === 'CUSTOMER'` (drops staff-only notes) with non-empty `contentText` → take the LAST 20 → map oldest→newest to `{role, text: contentText, at: createdAt ISO}` where role = `direction === 'INBOUND' ? 'CUSTOMER' : (authorType === 'AI' ? 'AI' : 'STAFF')` (future-proof for the B7 enum). Empty window → 422 `CONVERSATION_HAS_NO_TEXT`.
4. `requestId` = `randomUUID()`.

- **Summary**: gateway `requestCrmSummary({requestId, window})`; on `ok` persist `saveConversationSummary` then return result; other statuses pass through unpersisted.
- **Reply draft**: brand = company `brandName ?? name` + channel `displayName` (channel via existing repo `findChannelById(companyId, conversation.channelId)`); templates = `listTemplates(companyId, 'ACTIVE')` → first 10 → `{title, body: bodyText}`; call with `mode: 'STAFF_ASSIST'` ALWAYS (`AUTONOMOUS` is the B7 auto-reply slice, forbidden here) + optional `tone` passthrough from the request body (trim, ≤100 chars, else 400).
- **Insights**: consent from customer row; gateway `requestCrmInsights`; on `ok` validate `sentiment`/`risk` against the enum sets and clamp `leadScore` to 0..100 int — valid ⇒ advisory write via context repository; invalid enum values ⇒ skip the write, still return the result. Never branch on the values.
- **Feedback**: validate `kind ∈ {SUMMARY,REPLY_DRAFT,INSIGHTS}`, `rating ∈ {UP,DOWN}`, `comment` ≤1000, `requestId` ≤100 (400 on violation); insert row with `createdByUserId = ctx.userId`; return `{id, createdAt}`.

Degradation: wrap every gateway call — a thrown client error (timeout/unreachable/non-200) returns `{requestId, status: 'unavailable', error: {…}}` shaped like the contract's `ProviderError` (inspect its fields in `line-ai.ts` and construct e.g. code `gateway_unreachable`), HTTP 200. Assist must never 5xx because the gateway is down.

### W6 — API: controller (presentation/http/crm-ai-assist.controller.ts, new)

Mirror `crm-conversation.controller.ts` exactly (same decorators, guard usage, ctx extraction, param names) — EXCEPT status code: assist routes add `@HttpCode(200)` (owner decision 2026-07-09 resolving this plan's self-conflict; the sibling's 201 default does not apply here): `@Controller('companies/:companyId/crm/conversations')` with `@Post(':conversationId/ai/summary' | 'ai/reply-draft' | 'ai/insights' | 'ai/feedback')`. Thin: parse/validate body shape, delegate to use-cases. No other routes.

### W7 — Permission `crm.ai.assist`

- `apps/api/src/modules/auth/permission-registry.ts`: add to the item-15A block: `{ key: 'crm.ai.assist', description: 'Use CRM AI staff assist (summary/reply draft/insights) on inbox conversations', riskLevel: 'MEDIUM' }`.
- Grant it in every role array that already contains `crm.inbox.reply` (that is the ADMIN/MANAGER/SALES tier; AUDITOR must NOT get it). Same mirroring in `employee-access/domain/registries/capability-pack.registry.ts`: add `crm.ai.assist` next to `crm.inbox.reply` wherever that key appears.
- Run the auth/permission specs; if any pins a permission count, update it.

### W8 — Module wiring (crm-inbox.module.ts, append-only)

Append imports + `CrmAiAssistController` to `controllers` + `CrmAiGatewayClient`, `CrmAiContextRepository`, and the four use-cases to `providers`, under a `// MVP1-4 B5: AI staff assist (Dev B)` comment. Touch nothing else in the file.

### W9 — API tests

- `application/use-cases/crm-ai-assist.use-case.spec.ts` (mock repositories + client, house spec style — look at `crm-conversation.use-case.spec.ts` for the mocking pattern): missing permission → Forbidden; out-of-scope conversation → Forbidden; note/empty messages excluded + last-20 + oldest→newest + role mapping (incl. `authorType:'AI'` → role `AI`); summary ok persists cache / uncertain does not; client throw → `{status:'unavailable'}` (no throw); reply always `STAFF_ASSIST` + tone passthrough + tone >100 chars → 400; insights ok → advisory write with clamped int leadScore + `leadScoreUpdatedAt` set; insights invalid sentiment → no write, result still returned; feedback happy path + each validation failure.
- `crm-ai-separation.spec.ts` (module root, source-scan style like the gateway's separation spec, `__dirname`-based): (a) webhook files (`process-inbound-line-message.use-case.ts`, `crm-line-webhook.controller.ts`) contain no `crm-ai-` / `CrmAiGatewayClient` reference; (b) `crm-ai-assist.*` files contain no `SendCrmInboxMessageUseCase` / `line-messaging.adapter` reference; (c) `CrmAiGatewayClient` is referenced only from `crm-ai-*` files within the module. Prove discriminators bite (a temporary violating fixture string, not a repo file).
- Append both spec files to `apps/api/package.json` `"test"`.

## Verification (run all; fix failures before finishing)

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/ai-gateway test          # expect 307 existing + new, 0 fail
pnpm --filter @watchdog-bms/ai-gateway build
# DATABASE_URL: copy the real value from the repo-root .env (docker Postgres :15432/watchdog_bms)
DATABASE_URL='<from root .env>' pnpm --filter @watchdog-bms/api exec prisma migrate deploy
DATABASE_URL='<from root .env>' pnpm --filter @watchdog-bms/api exec prisma generate
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test                 # all pass incl. new specs
git diff --check
```

## Done criteria

- All four routes exist behind `crm.ai.assist` + conversation ABAC scope; reply-draft cannot send; provider-down returns typed `unavailable` with HTTP 200.
- Summary cache + advisory writes + feedback rows persist; advisory values never gate anything.
- Gateway exposes exactly the 5 `crm-*` routes; all separation specs (gateway + new API one) green; every listed verification command passes.
- Evidence appended to [[agent-memory/crm-customer-ai-agent-family]] as "## B3-API Implementation Evidence (2026-07-09, Dev B)": file list, verification outputs (test counts), and the note "crm-ai.ts extended ADDITIVELY (summary/insights types + optional tone) — existing shapes untouched, H2 unaffected".

## Out of scope (do not build)

Web AI panel (H1), auto-reply/AUTONOMOUS path & gate chain (B7), trust-score formula/scan (B6), booking (B10), audit rows for assist reads, GET/cache-read endpoints, any edit to Dev A-owned files beyond the append-only module/package.json lists above.
