# AI Usage Metering & Monthly Budget Spec (Admin-Only)

2026-09-29 commercial extension: the [AI credit and receipt-image add-on spec](chat-credit-and-receipt-addons-spec-th.md) (§5, §18) separates grants/funding from cost evidence and operational caps. The Bangkok `monthKey` stays the cost and cap month; for companies cut over to the add-on rules, included AI credit follows the package's paid periods instead of the calendar month, and in the console the monthly budget is labelled "เพดานเครดิต AI ต่อเดือน" (decision T-06). Admin-only costs/holds and their guards stay internal; the customer balance reads commercial units from the canonical projection, not `monthly budget - spent`. The SHARED leased admission of v1 CHAT lanes must become a durable reservation with funding for cut-over companies before AI credit is sold (add-on plan PR D). All callers, corrections and operator recovery must participate in the source mapping before rollout; no activation is implied by this note.

2026-09-17 design extension: the owner requested separate CHAT/OCR caps, accurate refusal/receipt UX, intake cost reduction and usage visibility in the [combined NOGROUP remediation spec](line-ai-ledger-lifecycle-remediation-spec-th.md). Its §11–12 defines additive reporting and opt-in SPLIT reservation semantics; the bounded-overshoot policy below describes legacy SHARED behavior. The extension is specified, not implemented or activated. Admin-only access, Bangkok month, actual metering and OCR/package gates remain authoritative.

## 1. Status

- Date: 2026-07-28 (Asia/Bangkok)
- Owner: Platform/AI with the partner-console owner
- Status: Proposed — not implemented
- Scope decision (owner, 2026-07-28): **system-admin surface only.** The operator sets budgets
  and sees usage from the partner console. Owner-visible usage pages, tenant-facing alerts, and
  self-service caps are explicitly deferred (§5).
- Owner addition (2026-07-28): the CRM per-company model-policy gap is **in scope** — fixed
  here as phase 1 (§6.9, §7.8) rather than tracked separately.
- Related: `docs/specs/per-company-ai-budget-override-spec.md` (per-window rate ceiling — a
  sibling abuse control, not replaced by this spec), `docs/specs/ai-prompt-caching-usage-logging-spec.md`
  (the `ai.usage` line and `usageTag` this spec builds on),
  `docs/specs/m-02-ai-api-observability-spec.md` (the additive-contract precedent),
  `docs/agent-memory/ai-prompt-caching-usage-logging.md` (measured ฿/call baselines).

## 2. Problem

AI spend is real, measured, and per-company — but the platform cannot answer "how much has
company X spent this month?", and nothing stops any company from spending without bound.

- Token counts exist only as a per-process stdout line: `logUsage` in
  `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts:163` emits
  `ai.usage` with `tag`/`modelId`/token counts — **no `companyId`**, and nothing persists it.
  The gateway deliberately has no database, so the line cannot become a ledger where it is.
- The only per-company control is the per-minute call window (`assertBudget`,
  `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts:67`). It throttles bursts;
  it does not bound monthly spend. 60 calls/min sustained is ~฿180k/month of Sonnet if abused.
- One gateway caller has **no limit at all**: `AiGatewayDraftProvider.generate`
  (`apps/api/src/modules/ai-draft/infrastructure/provider/ai-gateway-draft.provider.ts:20`)
  posts to `/internal/ai/draft-generate` without any `consume()` call.
- The CRM lane ignores the per-company model entirely: the `Crm*Request` contracts carry no
  `modelPolicy`, `CrmAiGatewayClient` never resolves it, and all eight gateway CRM routes call
  `createProvider(this.config)` bare (`crm-customer-ai-internal.controller.ts:77-207`) — the
  partner console's model choice silently does not apply to the customer-facing lane. Worse
  (found during phase-1 implementation): the contracts carry no `companyId` either, while the
  per-company rate limit added in `23c61c08` requires one at runtime — since that commit every
  CRM AI call throws `AI_RATE_LIMIT_COMPANY_REQUIRED` and degrades to the deterministic
  fallback.
- `AiTurn` (`apps/api/prisma/schema.prisma:1189`) records model lineage but zero token fields;
  `AiDraftArtifact.tokenUsageJson` exists but is never written.

## 3. Goal

Give the operator a per-company monthly spend meter and a monthly budget cap, measured in
satang, enforced at the existing API-side seams, visible and editable only from the partner
console — so runaway AI cost is bounded per tenant and budget numbers are chosen from a real
ledger rather than guesswork. Along the way the CRM lane starts honouring the per-company
model policy every other lane already respects, so the operator's model choice and the budget
that prices it govern every AI feature.

## 4. Users and journeys

**Operator (system admin / partner console).** Opens a partner company's detail page, sees
month-to-date AI spend in ฿ against the effective budget, last month's total, and a top-tags
breakdown; sets or clears a monthly budget override; sees the change audited.

**Employee/customer of that company.** No visible change while under budget. When the monthly
budget is exhausted, each AI feature refuses in its existing exhaustion shape (same UX as
hitting today's rate window) until the next month or a budget raise.

## 5. Non-goals

- Owner-visible usage dashboards, tenant notifications (`NotificationRule` trigger keys), and
  self-service caps — deferred by scope decision. The data model here must support them later
  without change (usage rows and aggregates are per company), but no tenant-facing route ships.
- Billing, invoicing, plans/tiers, credits.
- Per-user or per-branch budgets.
- Metering Typhoon OCR (free/external) or replacing the per-window Redis limiter.
- The Langfuse/control-plane direction (`docs/specs/ai-control-plane-platform-spec.md`) — this
  spec is the in-repo enforcement that platform would later steer, not the platform itself.

## 6. Decisions that shape the design

### 6.1 Meter in the API, enforce at the client seams

The gateway has no database and learns `companyId` from the caller-supplied body, so it can
neither store a ledger nor be trusted to attribute one. The API already owns the five gateway
seams and the per-company Redis check at four of them. Metering and enforcement live API-side;
the gateway's only new duty is **reporting** usage truthfully on its responses.

### 6.2 Usage returns on the response contract, additively

`ProviderOutput` stays unchanged; instead each internal AI response gains an optional
`usage?: AiUsageEntry[]` field, exactly the additive pattern `LineAiTurnResponse.toolCalls`
used (M-02), including runtime-coercion on the AgentCore passthrough for artifact version skew.
An old gateway (or old AgentCore artifact) that omits the field degrades to "no rows recorded"
plus a warn log — never a crash. This revisits the caching spec's "usage stays a logging
concern" decision deliberately: that was scoped to its task; attribution now requires the
counts to reach the process that owns the database.

### 6.3 The gateway collects per-request usage with AsyncLocalStorage, not by threading

One employee turn is ~6 provider calls across orchestrator, routers, critic, and composer.
Threading a usage accumulator through every agent signature is a wide diff for no information
gain. Instead a request-scoped collector (`AsyncLocalStorage`, node built-in, no dependency)
is initialized per internal AI request; providers append one entry per model call at the same
point `logUsage` already fires; an interceptor attaches the drained entries to the JSON
response. Provider code outside a collector context (unit tests, future scripts) appends
nowhere and must not throw.

### 6.4 Money is computed at write time, in satang; tokens are the durable truth

Each usage row stores raw token counts + `modelId` **and** `costSatang` computed at record
time from a pinned price map and the THB/USD rate in effect — the procurement §19d posture:
money is computed and satang-rounded (round half-up) when recorded, never re-derived later.
Price or FX changes affect only future rows. Budgets are set in satang because the operator
thinks in baht; tokens remain available to re-audit any row.

Revised 2026-07-29 (owner): the rate is **live, not fixed**. It refreshes from a real FX
source on a daily-cached basis (Bedrock bills USD monthly; day-granularity is the honest
precision, not per-call ticks), passes a sanity bound before being trusted, and — the part
that makes rows auditable — **the rate actually used is stored on every usage row**
(`AiUsageEvent.thbPerUsd`). The fetch must never block or fail metering: fallback chain is
live rate → last stored rate (`AiFxRate` row) → the `AI_THB_PER_USD` env value, whose role
changes from "the rate" to "the fallback of last resort". Owner addendum (2026-07-29): each
row also records **where** its rate came from (`thbPerUsdSource`) — a fallback that leaves no
mark on the row cannot be tracked, so env-fallback-priced rows must be distinguishable by
query, not only by a log line that has since rotated.

### 6.5 Month boundary is Asia/Bangkok

`monthKey = YYYY-MM` of `now + 7h` (Thailand has no DST; fixed offset arithmetic, no
dependency). A budget month matches the operator's calendar, not UTC.

### 6.6 Serialized admission with one-action bounded overshoot

Token counts are known only after a call completes, and one user action can fan out into several
model calls. Before the live spend read, the API therefore acquires a Redis lease keyed by
`companyId + Bangkok month`; it holds that lease through the provider action **and the usage-ledger
write**. A concurrent action is refused with `AI_BUDGET_BUSY` plus a bounded retry window instead
of passing the same stale spend check. Redis loss fails closed with `AI_BUDGET_UNAVAILABLE`; the
180-second TTL only recovers a crashed lease owner.

The Bangkok `monthKey` is pinned once at admission and reused by the lease key, live spend read and
ledger write. An action crossing local midnight therefore cannot lock one month and charge another.

An admitted action is never aborted merely because its final cost crosses the cap. Exact cost is
not known beforehand, so worst-case overshoot is one admitted action — no longer N concurrent
request streams.

### 6.7 Fail closed, in both directions

- Spend or budget unreadable → refuse the AI call (`m12` policy: cost-bearing buckets fail
  closed), with a distinct code so an outage is not misread as exhaustion.
- `modelId` missing from the price map → cost at the **highest** configured price plus a warn
  log, never 0 (a silent free model is the deny-all-sentinel lesson applied to money).
- Failure to persist usage rows must warn loudly but never fail the user's already-completed
  AI action.

### 6.8 `CompanyAiConfiguration.modelId` becomes nullable

Both this spec and the budget-override spec need a config row that does not force a model
choice (`schema.prisma:2402`, flagged as an open risk there). Decision, canonical for both:
`modelId String` → `String?`; `null` means inherit the platform default model.
`resolveCompanyAiModelPolicy` treats a null exactly like an absent row; its fail-closed
handling of non-null unapproved values is unchanged.

### 6.9 The CRM lane adopts the existing model-policy pattern, in scope here

Three lanes already implement per-company model governance end to end: resolve
(`resolveCompanyAiModelPolicy`) → attach (`modelPolicy?: AiModelPolicy` on the request) →
consume (`createProvider(config, { modelId: body.modelPolicy?.modelId })`), with the
write-time approved-list check (`SetPartnerAiModelUseCase`) and the gateway's `assertApproved`
as the fail-closed gates. The CRM lane is aligned to that same pattern inside this feature
(owner decision 2026-07-28): a budget makes the operator's model choice a costed commitment,
and a lane that silently ignores the choice undermines both controls. One resolution per CRM
action at the `postInternal` seam — the same place the rate limit and the meter live.

## 7. Contract

### 7.1 Contracts package

```ts
// packages/contracts — shared by API and gateway
export type AiUsageEntry = {
  tag: string;            // usageTag, 'untagged' when the call site passed none
  modelId: string;
  ok: boolean;
  inputTokens: number;    // 0 on failed calls with no usage
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  durationMs: number;
};
```

Additive optional `usage?: AiUsageEntry[]` on every internal AI response:
`LineAiTurnResponse` (`packages/contracts/src/line-ai.ts:362`), `LineIntakeRoutePlan` (`:300`),
`ReceiptOcrResponse` (`:241`), `BankStatementAiExtractResponse`
(`packages/contracts/src/banking.ts:251`), the `Crm*Result` types served by
`/internal/ai/crm-*`, and `AiDraftGenerationResult`.

### 7.2 Gateway

- `apps/ai-gateway/src/common/usage/usage-context.ts`: `AsyncLocalStorage`-backed
  `runWithUsageContext`, `appendUsage(entry)`, `drainUsage()`.
- Both providers (`bedrock.provider.ts`, `openai.provider.ts`) call `appendUsage` at the
  existing `logUsage` point with the same numbers; the `ai.usage` console line is unchanged in
  shape except it **gains `companyId`** when the collector context carries one.
- Bedrock timeout aborts the SDK request with `abortSignal`. Because an aborted Converse response
  carries no usage, that failed entry is priced conservatively at the current approved-model input
  context ceiling (200k) plus the requested maximum output tokens, rather than recording 0. If a
  response carried real usage but parsing later failed, those real counts are retained.
- An interceptor on the three internal AI controllers (`line-ai-internal`,
  `crm-customer-ai-internal`, `ai-draft-internal`) opens the context per request, seeding
  `companyId` from the body (`body.companyId ?? body.userContext?.companyId`), and attaches
  `usage: drainUsage()` to the response object. Health routes excluded.
- AgentCore passthrough (`agentcore-runtime.client.ts`): runtime-coerce `usage` from the
  artifact response — validate shape per entry, drop invalid entries — mirroring the
  `toolCalls` coercion. `strands-local` (the current runtime) flows through the in-process
  collector and needs nothing special.
- The gateway still never touches a database.

### 7.3 API data model

```prisma
model AiUsageEvent {
  id                    String   @id @default(cuid())
  companyId             String
  monthKey              String              // 'YYYY-MM', Asia/Bangkok
  sourceRoute           String              // 'line-turn' | 'line-intake-route' | 'receipt-ocr'
                                            // | 'bank-statement-extract' | 'crm-<name>' | 'draft-generate'
  usageTag              String
  modelId               String
  ok                    Boolean
  inputTokens           Int
  outputTokens          Int
  cacheReadInputTokens  Int
  cacheWriteInputTokens Int
  costSatang            Int
  thbPerUsd             Decimal  @db.Decimal(10, 4) // the rate this row was priced at (§6.4)
  thbPerUsdSource       String   // 'live-cache'|'fetched'|'stored'|'env-fallback' (§6.4 addendum)
  requestId             String?
  createdAt             DateTime @default(now())
  company               Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, monthKey])
  @@index([companyId, createdAt])
}

model AiFxRate {
  id        String   @id // 'THB_USD' — single-row operational cache; rows audit via thbPerUsd
  rate      Decimal  @db.Decimal(10, 4)
  source    String   // fetch URL host, or 'env-fallback'
  fetchedAt DateTime
}

model PlatformAiBudgetConfig {
  id                         String   @id // 'platform' — single row; absent = env fallbacks
  monthlyBudgetSatang        Int
  ceilingSatang              Int
  updatedBySystemAdminUserId String?
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt
}

model CompanyAiMonthlyUsage {
  id                    String   @id @default(cuid())
  companyId             String
  monthKey              String
  costSatang            Int      @default(0)
  callCount             Int      @default(0)
  inputTokens           Int      @default(0)
  outputTokens          Int      @default(0)
  cacheReadInputTokens  Int      @default(0)
  cacheWriteInputTokens Int      @default(0)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  company               Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, monthKey])
}
```

`Int` satang caps at ฿21M/company/month — orders of magnitude above any plausible spend; no
BigInt. Plus `CompanyAiConfiguration`: `modelId String?` (§6.8) and `monthlyBudgetSatang Int?`
(null = inherit platform default).

### 7.4 Pricing and config

- `apps/api/src/modules/line-ai/application/ai-model-pricing.ts`: a pinned map keyed by
  substring match on `modelId` → USD per MTok for input/output/cacheRead/cacheWrite (Sonnet
  4.x: 3 / 15 / 0.30 / 3.75). Keep the map's keys in step with `APPROVED_AI_MODEL_IDS`.
- `costSatang = round((in·pIn + out·pOut + cr·pCr + cw·pCw) / 1e6 × AI_THB_PER_USD × 100)`,
  round half-up. Unknown model → highest configured price + warn (§6.7).
- Env (in `packages/config`, synced to every `.env.example` per
  `docs/agent-memory/env-example-sync-local-uat-production.md`) — all three are **fallbacks**
  as of the 2026-07-29 revision, not the operating values:
  - `AI_THB_PER_USD` — positive number, default `33`; used only when the live fetch AND the
    stored `AiFxRate` row are both unavailable.
  - `AI_MONTHLY_BUDGET_SATANG` / `AI_MONTHLY_BUDGET_SATANG_CEILING` — used only when no
    `PlatformAiBudgetConfig` row exists; production boot rule (ceiling ≥ default) stays.
- FX refresh (2026-07-29): a keyless daily source (`open.er-api.com/v6/latest/USD` → THB)
  fetched lazily with an in-process TTL cache (~6h) and a short timeout; an out-of-bounds
  result (outside 20–60 THB/USD) is treated as a failed fetch, never trusted. A good fetch
  upserts the `AiFxRate` row so restarts and sibling instances converge. Resolution never
  throws and adds no latency beyond the first call per TTL window.
- Platform budget config (2026-07-29): effective platform default =
  `PlatformAiBudgetConfig.monthlyBudgetSatang ?? env`; effective ceiling =
  `.ceilingSatang ?? env`. The write enforces ceiling ≥ default on the post-update pair
  (422). Per-company override writes validate against the **effective** ceiling. Existing
  overrides above a later-lowered ceiling are grandfathered — the ceiling gates writes, not
  reads. Money is entered in the UI in **baht with up to two decimals** and stored as satang
  integers; more than two decimals is rejected, never rounded silently.

### 7.5 Metering and enforcement seams

One shared module, `apps/api/src/modules/line-ai/application/company-ai-usage-meter.ts`, plain
functions in the `company-ai-model-policy.ts` style (that file is already imported
cross-module by the receipt and statement clients):

- `assertCompanyAiBudget(prisma, config, companyId)` — resolves the effective budget
  (current company override else current platform default), reads the live aggregate row and
  refuses when `spendSatang >= budget`. Configuration and spend are read before each new
  cost-bearing action; cached observations cannot authorize spend after an Admin change.
- `runWithCompanyAiBudgetAdmission(...)` — acquires the crash-safe Redis lease, performs the live
  check only after admission, runs the cost-bearing action and keeps ownership through
  `recordCompanyAiUsage`. It pins one month key across all three operations. Production never
  degrades to a process-local lease; local/test mode may.
- `recordCompanyAiUsage(prisma, config, { companyId, sourceRoute, requestId }, entries)` —
  in one transaction: `createMany` the events and upsert-increment the monthly aggregate. The
  upsert returns the post-increment row; `pre = post − delta` detects threshold crossings
  exactly once even under concurrency (the unique row serializes increments). Awaited by
  callers; failures caught and warned, never failing the business call. Absent/empty `usage`
  on a metered route logs a warn (`ai.usage.absent`) so artifact skew is visible.

Call sites — the four existing `consume()` seams plus the uncovered fifth:
`ai-gateway.client.ts:67` (llm + ocr), `crm-ai-gateway.client.ts:63` (covers all crm routes),
`receipt-ocr.client.ts:24`, `statement-ai-extract.client.ts:28`, and
`ai-gateway-draft.provider.ts:20` (which also gains the budget check it never had). Each site
refuses in its existing exhaustion shape: HTTP sites throw 429 with code
`AI_MONTHLY_BUDGET_EXCEEDED`; the receipt client returns `{status:'failed'}`; the draft
provider returns `{ok:false, error:{code:'AI_MONTHLY_BUDGET_EXCEEDED', retryable:false}}`.
Meter-unavailable refusals use `AI_BUDGET_UNAVAILABLE` so outage ≠ exhaustion.
Concurrent admission refusals use `AI_BUDGET_BUSY`; HTTP seams include `retryAfterSeconds`, while
the draft job keeps it retryable and performs no model call.

### 7.6 Events

Two named events via the L-14 emitter (`apps/api/src/common/logger/security-event.ts`), added
to `SECURITY_EVENT` in **both** byte-identical copies (API + gateway — the M-02 guard test
enforces the pairing):

- `ai.company_budget.exceeded` (HIGH) — on each refusal: `companyId`, `spendSatang`,
  `budgetSatang`, whether the budget came from an override.
- `ai.company_budget.threshold` (HIGH) — on crossing 80% of the effective budget, at record
  time, once per company per month by construction (§7.5). HIGH, not MEDIUM (revised
  2026-07-29): `SecurityEventRisk` is `'HIGH' | 'CRITICAL'` and the deployed metric filter
  matches only those — a quieter level would make the one alert this admin-only scope
  delivers invisible to the alarm, and exactly-once-per-company-month cannot spam.

Both carry root-level `riskLevel` so the existing CloudWatch metric filter matches; this is
the operator alert channel for the deferred-owner-alerts scope. Persist failures and unknown
prices are plain `logger.warn` lines, not security events.

### 7.7 Admin API and web

- **Write**: extend `PUT /:partnerCompanyId/ai-model`
  (`apps/api/src/modules/system-partner-management/presentation/http/partner.controller.ts:217`,
  permission `system.partner_ai_model.manage` — the same route the budget-override spec
  extends; coordinate the DTO) with optional `monthlyBudgetSatang?: number | null` (null
  clears to inherit). Reject zero, negatives, non-integers, and above-ceiling values with 422,
  never clamp. Honour `partnerMetadataLockError`. Mirror `SetPartnerAiModelUseCase`: upsert +
  CRITICAL audit row in the same transaction, before/after values, cleared = transition to
  inherited.
- **Read**: sibling `GET /:partnerCompanyId/ai-usage` under the partner detail page's existing
  read permission (no new permission): current + previous `monthKey` aggregates, effective and
  override budget, and a top-10 `usageTag` breakdown (groupBy on `AiUsageEvent`).
- **Web**: an "AI usage & budget" card on `PartnerDetailPage.tsx` (+ `system-partners.api.ts`):
  month-to-date ฿ against the effective budget, last month's total, top-tags table, and the
  budget field showing the inherited value when empty and the ceiling always; surface the
  API's 422 verbatim. Loading/error/permission-denied states follow the page's patterns.

### 7.8 CRM per-company model alignment

- **Contracts**: `modelPolicy?: AiModelPolicy` (from `ai-lineage`) added to the seven
  `Crm*Request` types in `packages/contracts/src/crm-ai.ts` and to
  `CrmBroadcastGenerateRequest` in `crm-campaign.ts` — the same optional field
  `LineAiTurnRequest` (`line-ai.ts:121`), `ReceiptOcrRequest` (`:237`), and
  `BankStatementAiExtractRequest` (`banking.ts:233`) already carry.
- **Contracts (companyId)**: the same eight request types gain a **required**
  `companyId: string`, and the nine API call sites thread it. Implementation surfaced that no
  CRM request ever carried one while the per-company rate limiter (`23c61c08`) demands it at
  runtime — every CRM AI call was throwing `AI_RATE_LIMIT_COMPANY_REQUIRED` into the callers'
  fallbacks. Required rather than optional so the type system forces every present and future
  call site to thread the tenant; the field also feeds the §7.2 usage attribution. The gateway
  does not consume it in this phase.
- **API**: `CrmAiGatewayClient` gains an optional `PrismaService` (mirroring
  `ReceiptOcrClient`), extracts `companyId` in `postInternal` independently of the rate
  limiter, resolves the policy once per action, and posts
  `{ ...request, ...(modelPolicy && { modelPolicy }) }`. A resolver throw
  (`TENANT_AI_MODEL_NOT_APPROVED`) propagates — the CRM action fails closed, exactly as the
  receipt and statement lanes behave.
- **Gateway**: all eight CRM routes in `crm-customer-ai-internal.controller.ts` pass
  `{ modelId: body.modelPolicy?.modelId }` to `createProvider`; `assertApproved` remains the
  gateway-side gate. `/internal/ai/crm-trust` currently has no API-side caller (trust scoring
  is deterministic in `crm-ai-trust.use-case.ts`), but the route changes with its siblings so
  a future caller cannot reintroduce the gap.
- No behaviour change for a company without a `CompanyAiConfiguration` row; with one, the CRM
  lane now runs the configured model, and its usage rows (§7.3) carry that `modelId`.

### 7.9 Platform AI budget settings (admin UI)

A system-admin page following the shared-LINE-settings precedent (nav item + page in the
partner console, English surface): shows the effective platform default and ceiling in baht,
marks whether each comes from the DB row or the env fallback, and lets the operator edit both
as baht with up to two decimals. Writes go through a use case mirroring
`SetPartnerAiModelUseCase`: same permission surface as the per-company budget
(`system.partner_ai_model.manage`), `partnerMetadataLockError` not applicable (no company),
CRITICAL audit row with before/after for both fields in the same transaction, ceiling ≥
default enforced with 422, and the in-process budget cache reset so enforcement follows
within the same process immediately. The per-company budget input on the partner detail page
accepts baht decimals under the same two-decimal rule.

## 8. Acceptance criteria

1. Every internal AI response carries one `usage` entry per provider call; two concurrent
   gateway requests never cross-contaminate entries.
2. The `ai.usage` console line keeps its shape and gains `companyId` when known.
3. For each metered response the API writes one `AiUsageEvent` per entry and increments
   `CompanyAiMonthlyUsage` atomically in one transaction; `monthKey` is Asia/Bangkok (a call
   at 2026-07-31 23:30 UTC lands in `2026-08`).
4. `costSatang` matches the pinned price map at `AI_THB_PER_USD`, rounded half-up; an unknown
   `modelId` records at the highest configured price and warns.
5. A company at/over its effective budget is refused at all five seams in each seam's existing
   exhaustion shape with `AI_MONTHLY_BUDGET_EXCEEDED`; under budget, behaviour is unchanged.
6. Only one cost-bearing action per company/month may pass the live spend check at a time; a
   concurrent action gets `AI_BUDGET_BUSY`. The admitted action is not aborted mid-way and maximum
   budget overshoot is bounded to that one action.
7. Budget resolution: override else platform default; zero/over-ceiling writes rejected with
   422 and nothing persisted; every change writes a CRITICAL audit row atomically with the
   update.
8. Spend/budget read failure refuses with `AI_BUDGET_UNAVAILABLE` — never an unmetered pass.
9. Crossing 80% emits `ai.company_budget.threshold` exactly once per company-month; each
   refusal emits `ai.company_budget.exceeded`; both visible to the existing metric filter.
10. A gateway or AgentCore artifact response without `usage` records nothing, warns
    `ai.usage.absent`, and never crashes (additive compatibility).
11. No tenant-facing route can read or write budgets or usage; the gateway remains DB-free.
12. `modelId` nullable migration preserves existing rows; null inherits the platform default
    model; non-null behaviour of `resolveCompanyAiModelPolicy` is unchanged.
13. Every CRM request carries `companyId`; with `CompanyAiConfiguration.modelId` set it also
    carries `modelPolicy` and the gateway creates its provider with that model; without a row,
    requests omit `modelPolicy` and run the platform default. No CRM gateway call throws
    `AI_RATE_LIMIT_COMPANY_REQUIRED` when company context exists.
14. A configured-but-unapproved model fails the CRM action closed (resolver throw, no gateway
    call), matching the receipt/statement lanes.
15. Every usage row records the `thbPerUsd` it was priced at **and its provenance**
    (`thbPerUsdSource` — the resolver's source verbatim), so env-fallback-priced rows are
    queryable; `costSatang` is reproducible from the row alone. The live rate refreshes at
    most daily-cached, is rejected outside 20–60, and FX unavailability never fails or delays
    metering beyond the fallback chain (live → stored → env).
16. Platform default and ceiling are editable from the admin UI in baht (≤ 2 decimals, stored
    as satang integers), audited CRITICAL with before/after atomically; ceiling ≥ default is
    enforced on write with 422; with no DB row, the env values apply unchanged.
17. Per-company budget writes validate against the effective (DB-first) ceiling; the
    partner-detail input accepts baht with up to two decimals; existing overrides above a
    lowered ceiling keep enforcing as-is (grandfathered).

## 9. Risks

- **ALS context loss** across an exotic async boundary would silently drop entries → the
  console line still fires per call (independent path), and the isolation + attach tests pin
  the collector; any `usage`-less metered response warns (`ai.usage.absent`).
- **Price map rot** as models rotate → keyed to `APPROVED_AI_MODEL_IDS`, which already gates
  invocable models; unknown models cost-out at the max price, so rot over-counts (safe
  direction) and warns.
- **FX drift** (`AI_THB_PER_USD` is static config) → accepted; §19d posture means rows are
  auditable and the rate is an operator lever, not a market feed.
- **Undercount on crash** between the gateway call and `recordCompanyAiUsage` → accepted;
  bounded to the one admitted action, and CloudWatch `ai.usage` lines remain the reconciliation
  source.
- **CRM fail-closed on model drift** (a configured model later removed from
  `APPROVED_AI_MODEL_IDS`) silences customer auto-replies → the write path already rejects
  unapproved models with 422 (`SetPartnerAiModelUseCase`), so the throw only fires on
  deliberate approved-list shrinkage — which *should* stop the lane — and it fails loudly in
  logs, not silently.
- **Two specs extending one route/row** (`ai-model` route, `CompanyAiConfiguration`) → §6.8
  makes the shared decision here; whichever ships second rebases its DTO/migration on the
  first.
## Admin adjustment consistency amendment — 2026-09-15

Cost-bearing admission must read the current company override and, when inherited, the current platform budget before deciding. The older60-second configuration-cache allowance applies only to non-admission observations, not permission to spend after an Admin change. Admin budget/ceiling reads also use the current stored settings. This requires a small DB read per new AI admission; reuse the existing company/month lease and live spend check. Already admitted work may finish and record its actual cost, as before. Configuration invalidation must not clear active admission leases; the full reset remains a test-only seam. Verify lowered/raised/inherited changes from another writer without a local cache reset, read failure, and an active action racing a configuration change.

Platform-setting writes serialize with company override ceiling validation. Read the current audit predecessor and enforce the ceiling within the transaction before a new override write; an exact replay of an already committed value remains a no-op even if the ceiling was subsequently lowered. Platform setting changes do not revoke previously grandfathered overrides.

## Usage metadata extension — 2026-09-17 (remediation §11)

Additive only. Every column is nullable or carries a default equal to today's meaning, so a pre-D1 writer keeps inserting valid rows and a pre-D1 reader is unaffected. Nothing is backfilled and no historical cost is re-priced.

`AiUsageEvent` gains:

- `requestKind` — `TEXT` | `IMAGE` | `OTHER`; NULL = legacy/unknown, reported as `UNKNOWN`.
- `budgetBucket` — `CHAT` | `OCR`; NULL = legacy/unknown. Set by the API from the request it built, before the provider call — never from model output, a `usageTag` prefix, or user text.
- `usageBasis` — `PROVIDER_REPORTED` | `CONSERVATIVE_ESTIMATE`; NULL = legacy/unknown. Carried on `AiUsageEntry` from the gateway provider that measured the call; a timeout ceiling estimate must never be displayed as measured tokens.
- `eventKind` — default `MODEL_CALL`; the only other value is `COST_ADJUSTMENT`.
- `pricingSnapshot` (JSONB) — the USD-per-MTok rates and FX actually charged plus per-component satang and a `rounding` term, so the components sum exactly to `costSatang`. `costSatang` itself is still the one half-up rounding in `computeCostSatang`. NULL on legacy rows: component cost is then UNAVAILABLE, never 0.
- `adjustsEventId` + `correctionKey` (UNIQUE) — an audited append-only correction bound to the original event, with a replay fence.

There is deliberately **no** execution/invocation unique key in this phase: that identity is defined in the split-cap phase, and adding the fence now would turn a metering replay into a lost usage write rather than a deduplicated one.

`recordCompanyAiCostAdjustment` applies signed cost/token deltas to the ORIGINAL row's month aggregate in the same transaction, never increments `callCount`, refuses atomically if any aggregate would go negative, and is idempotent on `correctionKey`. No HTTP endpoint and no caller yet.

`PartnerAiUsageDto` gains (existing fields and meanings unchanged, money still integer satang):

- `breakdown.total` — the event-derived month total, alongside `current`, which stays the running `CompanyAiMonthlyUsage` aggregate. Both are exposed rather than reconciled away.
- `breakdown.byRequestKind` / `byBudgetBucket` / `byUsageBasis` — each always includes its `UNKNOWN` row, so every slice reconciles with `breakdown.total`.
- `breakdown.adjustments`, `breakdown.coverage` (`complete`/`partial`/`none` plus `firstMetadataAt`).
- `topTags` enriched with token components and cache cost, plus `otherTags` so top-10 + other equals the month total.
- `calls` counts `MODEL_CALL` rows only; `_count._all` is no longer used, so a correction can never be shown as a provider call.

Permissions are unchanged (`system.partner_dashboard.read`), there is no tenant endpoint, and the response still carries no request ids, prompts or document data.
