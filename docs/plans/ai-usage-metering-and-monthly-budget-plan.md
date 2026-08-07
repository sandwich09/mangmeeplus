# AI Usage Metering & Monthly Budget Plan (Admin-Only)

Spec: `docs/specs/ai-usage-metering-and-monthly-budget-spec.md`

## Sequencing rationale

The CRM model-policy fix goes first: it is a small, independently valuable correctness bug
(the partner console's model choice silently doesn't apply to the customer-facing lane) and it
makes every later phase truthful — the ledger phases record which model ran, and that is only
meaningful once every lane actually honours the configured model. After that, the ledger must
exist before the cap: a budget enforced against no meter is a guess, and a meter needs the
gateway to report usage first. Each phase is independently shippable and leaves behaviour
unchanged for every company until phase 4 turns enforcement on — and even then, only at the
platform default, which is sized well above measured normal usage.

## Phase 1 — CRM per-company model alignment (spec §6.9, §7.8)

- Contracts: add `modelPolicy?: AiModelPolicy` (import from `ai-lineage`) to the seven
  `Crm*Request` types in `packages/contracts/src/crm-ai.ts` and to
  `CrmBroadcastGenerateRequest` in `packages/contracts/src/crm-campaign.ts`.
- Contracts also gain a REQUIRED `companyId: string` on the same eight request types, and the
  nine API call sites thread it (`crm-ai-assist.use-case.ts` ×4, `crm-ai-auto-reply.use-case.ts`
  ×4, `crm-ai-broadcast.use-case.ts` ×1) — repairs the `23c61c08` regression where every CRM
  AI call threw `AI_RATE_LIMIT_COMPANY_REQUIRED` into the callers' fallback paths.
- API: `CrmAiGatewayClient` gains `@Optional() PrismaService` (mirror `ReceiptOcrClient`);
  `postInternal` extracts `companyId` independently of the rate limiter, resolves
  `resolveCompanyAiModelPolicy` once per action, posts
  `{ ...request, ...(modelPolicy && { modelPolicy }) }`; a `TENANT_AI_MODEL_NOT_APPROVED`
  throw propagates (fail closed, same as receipt/statement).
- Gateway: all eight routes in `crm-customer-ai-internal.controller.ts:77-207` change
  `createProvider(this.config)` → `createProvider(this.config, { modelId: body.modelPolicy?.modelId })`.
  This includes `/internal/ai/crm-trust`, which currently has no API-side caller (trust
  scoring is deterministic in `crm-ai-trust.use-case.ts`) — changed anyway so a future caller
  cannot reintroduce the gap.
- Tests: client attaches the policy when a config row exists, omits it when absent, and
  propagates the unapproved throw; gateway route passes the body's `modelId` to the provider
  factory; a company without a row is byte-for-byte unchanged.

Exit: the partner-console model choice governs the CRM lane; spec criteria 13–14 demonstrable.

## Phase 2 — Gateway reports usage (contracts + gateway only)

- `packages/contracts`: add `AiUsageEntry`; add optional `usage?: AiUsageEntry[]` to
  `LineAiTurnResponse`, `LineIntakeRoutePlan`, `ReceiptOcrResponse`,
  `BankStatementAiExtractResponse`, the `Crm*Result` types, `AiDraftGenerationResult`.
- `apps/ai-gateway/src/common/usage/usage-context.ts` (AsyncLocalStorage; no dependency):
  `runWithUsageContext({ companyId })`, `appendUsage`, `drainUsage`; append is a no-op outside
  a context and never throws.
- Both providers append at the existing `logUsage` point; the `ai.usage` line gains
  `companyId` from the context when present, shape otherwise unchanged.
- Interceptor on the three internal AI controllers opens the context (companyId from
  `body.companyId ?? body.userContext?.companyId`) and attaches `usage` to the response;
  health excluded. AgentCore passthrough runtime-coerces `usage` like `toolCalls`.
- Tests (register in the hand-maintained ai-gateway list): two concurrent requests do not
  cross-contaminate; every provider call yields exactly one entry (success and mapped-error);
  OpenAI provider parity; passthrough coercion drops malformed entries; response without
  context still serializes.

Exit: every internal AI response carries per-call usage; nothing consumes it yet.

## Phase 3 — API persists the ledger (no enforcement)

- Migration: `AiUsageEvent` + `CompanyAiMonthlyUsage` (spec §7.3); timestamp must order after
  every migration already in the tree.
- `ai-model-pricing.ts` (pinned USD/MTok map + satang formula, round half-up, max-price
  fallback + warn) and `AI_THB_PER_USD` in `packages/config` + every `.env.example`
  (follow `docs/agent-memory/env-example-sync-local-uat-production.md`).
- `company-ai-usage-meter.ts`: `recordCompanyAiUsage` — one transaction: `createMany` events +
  upsert-increment aggregate; threshold detection from `post − delta` (no event emission yet —
  the SECURITY_EVENT names land with phase 4); callers await, catch, and warn; empty/absent
  usage on a metered route warns `ai.usage.absent`.
- Wire all five seams: `ai-gateway.client.ts`, `crm-ai-gateway.client.ts` (`postInternal`),
  `receipt-ocr.client.ts`, `statement-ai-extract.client.ts`, `ai-gateway-draft.provider.ts`.
- Tests (register in the hand-maintained `apps/api` list): satang formula against the pinned
  prices; `monthKey` Asia/Bangkok boundary (2026-07-31 23:30 UTC → `2026-08`); event+aggregate
  atomicity; unknown-model max-price fallback; recording failure never fails the caller;
  absent-usage compatibility.

Exit: `CompanyAiMonthlyUsage` fills from real traffic; behaviour unchanged.

## Phase 4 — Budget cap enforced

- Migration: `CompanyAiConfiguration.modelId` → nullable (spec §6.8, canonical decision for
  the budget-override spec too; `resolveCompanyAiModelPolicy` treats null like an absent row)
  + `monthlyBudgetSatang Int?`.
- Config: `AI_MONTHLY_BUDGET_SATANG` (default 200000), `AI_MONTHLY_BUDGET_SATANG_CEILING`
  (default 1000000), production rule ceiling ≥ default; rebuild `packages/config` (stale
  `dist` yields `undefined` for new exports).
- `assertCompanyAiBudget`: effective budget (override else default; config cached ≤60s per
  company), live aggregate point read, refuse at `spend >= budget`; fail closed with
  `AI_BUDGET_UNAVAILABLE` on any read error. Wire ahead of all five seams' gateway calls,
  after the existing Redis `consume()` where present; each seam refuses in its existing
  exhaustion shape (spec §7.5).
- Events: add `ai.company_budget.exceeded` (HIGH) and `ai.company_budget.threshold` (HIGH —
  `SecurityEventRisk` has no MEDIUM and the deployed metric filter only matches HIGH/CRITICAL;
  see spec §7.6) to `SECURITY_EVENT` in **both** byte-identical copies (M-02 guard test must
  stay green); emit threshold from `recordCompanyAiUsage`, exceeded from the assert.
- Tests: override vs default resolution; refusal shape per seam; fail-closed on thrown reads;
  in-flight action not aborted (assert only ahead of the call); threshold exactly-once under
  two concurrent recordings; `resolveCompanyAiModelPolicy` unchanged for non-null models and
  inherits on null.

Exit: spend is bounded per company at the platform default; no way to set per-company values
yet.

## Phase 5 — Partner console control surface

- API: extend `PUT /:partnerCompanyId/ai-model` DTO with `monthlyBudgetSatang?: number | null`
  under `system.partner_ai_model.manage` (coordinate with the budget-override spec if it lands
  first); 422 on zero/negative/non-integer/above-ceiling; `partnerMetadataLockError` honoured;
  use case mirrors `SetPartnerAiModelUseCase` — upsert + CRITICAL audit (before/after,
  cleared = inherited) in one transaction. Sibling `GET /:partnerCompanyId/ai-usage` under the
  partner detail read permission: current + previous month aggregates, effective/override
  budget, top-10 tag breakdown.
- Web: "AI usage & budget" card on `PartnerDetailPage.tsx` + `system-partners.api.ts` —
  month-to-date ฿ vs effective budget, last month, tag table, budget input (empty shows
  inherited value; ceiling always shown; 422 surfaced verbatim). Existing loading/error/
  permission-denied patterns.
- Tests: above-ceiling rejected, nothing persisted; clear returns to inherited; audit
  before/after; no tenant-facing route exposes budget or usage; web renders inherited vs
  overridden, usage card, and permission-denied.

Exit: spec acceptance criteria 1–14 all demonstrable.

## Phase 6 — Live FX + DB-backed platform budget settings (owner revision 2026-07-29)

- Migration (idempotent, timestamp after every dir on disk): `AiUsageEvent.thbPerUsd`
  DECIMAL(10,4) — backfill existing rows with 33 (the only rate ever configured) then NOT
  NULL; new `AiFxRate` + `PlatformAiBudgetConfig` tables (spec §7.3).
- Addendum (owner, same day): `AiUsageEvent.thbPerUsdSource` — the resolver's source stamped
  per row (backfill `'env-fallback'`: pre-FX rows were priced straight from env config), so
  fallback-priced rows are trackable by query.
- FX: a small module beside the pricing map — module-level TTL cache (~6h, the expiresAt
  idiom), keyless daily source (`open.er-api.com/v6/latest/USD` → `rates.THB`), ~3s timeout,
  20–60 sanity bound, good fetch upserts `AiFxRate`; resolution order live-cache → fetch →
  stored row → `config.aiThbPerUsd`; exported reset for tests; never throws. The meter passes
  the resolved rate into `computeCostSatang` and stamps it on every row.
- Budget resolution: `resolveEffectiveBudget` reads `PlatformAiBudgetConfig` (cached with the
  same 60s cache, reset on write) before the env getters; ceiling likewise in the write path.
- API: platform settings read/write routes following the shared-LINE-settings route precedent
  (same permission as the per-company budget), use case mirroring `SetPartnerAiModelUseCase`
  (CRITICAL audit, before/after both fields, one transaction, cache reset, ceiling ≥ default
  422). Per-company budget write switches its ceiling check to the effective ceiling.
- Web: platform AI budget page following `SharedLineSettingsPage` (nav + page, English,
  page-local primitives); baht inputs accept ≤ 2 decimals (shared parse helper with the
  partner-detail input, which also gains decimals); source badge shows DB-row vs env-fallback.
- Tests: fx bounds/fallback-chain/cache-reset; meter stamps the rate; migration backfill;
  platform write rules (ceiling < default 422, audit before/after, cache reset); effective
  ceiling in the per-company write; baht-decimal parse (2dp ok, 3dp rejected, satang math
  exact); register new API specs in the hand-maintained list; web specs stay `.spec.ts`.

Exit: spec criteria 15–17 demonstrable; criteria 1–14 unchanged and still green.

## Verification (every phase)

Pin Node per shell: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.

- Focused `tsx --test` per phase; register every new spec file in the hand-maintained test
  lists of the app it lives in (`apps/api/package.json`, ai-gateway equivalent) — an
  unregistered spec silently never runs.
- Typechecks serially, never two at once; full suites of both apps once per phase close.
- Migrations: `prisma validate` + apply to a scratch DB with an explicit `DATABASE_URL`
  (the real local DB is docker `15432/watchdog_bms`; `apps/api/.env` holds a stale
  `5432/mydb` the Prisma CLI would otherwise pick up).
- Gateway DI changes (interceptor/module wiring) verified with a built boot, not a tsx probe
  (`test:boot` / swc build — decorator metadata is absent under tsx).
- `pnpm config:validate` after phase-4 config rules; rebuild `packages/config`.

## Deploy notes (when the time comes)

- All contract changes are additive optional fields, so deploy order between API and gateway
  is safe either way: an old gateway ignores `modelPolicy` on CRM requests and yields
  `ai.usage.absent` warns for the meter; an old API simply never sends/reads the new fields.
  Deploy both from the same tree state to close the gaps.
- Migration-drift preflight applies (dirty-tree deploy history); UAT must follow the
  env-preserve runbook; new envs must reach prod task defs or boot validation fails.
- After phase 4 in prod, watch `ai.company_budget.*` in CloudWatch for false refusals during
  the first days at the default cap.

## Out of scope

Owner-visible pages, tenant alerts, self-service caps, billing/tiers, per-user budgets,
Typhoon metering, limiter algorithm changes, and the Langfuse control-plane direction.
