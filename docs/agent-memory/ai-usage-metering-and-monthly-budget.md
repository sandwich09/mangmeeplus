# Agent Memory: AI Usage Metering & Monthly Budget (Admin-Only)

Status: Spec + plan authored 2026-07-28 (rev 2: CRM folded in same day). Phase 1 committed
`5205d878`; Phase 2 committed `50c32d91`; Phase 3 (ledger persistence) implemented + verified
2026-07-29. Phase 4 (budget cap enforced) implemented + verified 2026-07-29, committed `d21eb117`.
Phase 5 (partner console control surface) committed `2700246c`.
Phase 6 (live FX + DB-backed platform budget settings, owner revision 2026-07-29) implemented +
verified 2026-07-29, uncommitted — **pending main-session review**, including the live UI review of
the new Platform AI Budget page.
Spec §7.6 revised: both budget events are HIGH
(`SecurityEventRisk` has no MEDIUM; the deployed metric filter only matches HIGH/CRITICAL).
Owner: Platform/AI with the partner-console owner.
Scope: Per-company AI spend meter (satang, Asia/Bangkok months) + monthly budget cap, enforced
API-side, visible/editable **only** from the partner console — **plus** the CRM per-company
model-policy alignment as Phase 1 (owner folded it into this feature instead of a separate
task; the standalone chip was withdrawn).
Decisions:
- Owner decision 2026-07-28: system-admin surface only; owner-visible usage, tenant alerts,
  and self-service caps deferred. Data model must support them later without change.
- Meter lives in the API; gateway only reports usage additively on internal response
  contracts (`usage?: AiUsageEntry[]`), collected per-request via AsyncLocalStorage — no
  threading through agents, gateway stays DB-free.
- Money computed at write time in satang (§19d posture), tokens kept as durable truth;
  unknown model prices fail toward the max configured price, never 0.
- `CompanyAiConfiguration.modelId` becomes nullable (null = inherit) — canonical resolution
  of the open risk flagged in `per-company-ai-budget-override-spec.md` §9.
- Enforcement is check-before-act with overshoot bounded to in-flight actions; fail-closed
  (`AI_BUDGET_UNAVAILABLE` ≠ `AI_MONTHLY_BUDGET_EXCEEDED`).
- Discovered during discovery: `ai-gateway-draft.provider.ts` calls
  `/internal/ai/draft-generate` with **no rate limit at all** — it becomes the 5th metered
  seam and gains the budget check.
- CRM alignment (Phase 1) follows the proven pattern: resolve → `modelPolicy` on the request →
  `createProvider(config, { modelId })`; contracts gap spans `crm-ai.ts` (7 request types) +
  `crm-campaign.ts` (broadcast); fail-closed on `TENANT_AI_MODEL_NOT_APPROVED` like
  receipt/statement. `/internal/ai/crm-trust` has NO API-side caller today (trust score is
  deterministic in `crm-ai-trust.use-case.ts`) but changes with its siblings.
- Phase-1 implementation found a live regression: `23c61c08` (P1/P2 hardening) added the
  per-company rate limit to `crm-ai-gateway.client.ts` but NO caller ever passed `companyId`
  → every CRM AI call threw `AI_RATE_LIMIT_COMPANY_REQUIRED` (swallowed into fallback
  replies). Verifier decision: contracts gain REQUIRED `companyId: string` on all 8 CRM
  request types; 9 call sites thread it. Repaired inside Phase 1.
- Phase 2 decisions: the interceptor subscribes to `next.handle()` *inside* `runWithUsageContext`
  (Nest's CallHandler is lazy — subscribing outside the ALS run would collect nothing); `usage` is
  attached only when entries exist, so responses with no model call stay byte-identical, and rows
  already on the response (AgentCore passthrough) are kept, never overwritten. The OpenAI provider's
  `logUsage` moved into a `finally` (Bedrock's shape) so every call yields exactly one entry
  including mapped errors, while its stdout line stays success-only as before. `agentcore/runtime.ts`
  opens its own collector because the artifact entrypoint runs outside the HTTP stack.
Open questions: none blocking; DTO/migration coordination needed if
`per-company-ai-budget-override-plan.md` ships first (both extend the `ai-model` route and
`CompanyAiConfiguration`).
Artifacts:
- `docs/specs/ai-usage-metering-and-monthly-budget-spec.md`
- `docs/plans/ai-usage-metering-and-monthly-budget-plan.md`
Verification (Phase 2, 2026-07-29): ai-gateway 507/507, apps/api 2796/2796, typechecks clean
(contracts → api → ai-gateway, serial). The gateway has no `test:boot`, so the interceptor wiring
was proven by booting the real `tsc` build over HTTP (scratchpad script, not committed): one
request per decorated controller returned `usage` rows, `/internal/ai/agents` stayed unchanged, a
wrong secret still 401'd. Two new specs registered in the hand-maintained list
(`src/common/usage/*.spec.ts`).
Phase 3 decisions: draft lane metered in `GenerateSuggestionUseCase` (the only seam holding
both `companyId` and the usage-bearing result — the provider factory has no DI); price map
carries a `haiku` row besides `sonnet` (haiku is in `DEFAULT_APPROVED_AI_MODEL_IDS`; unmapped
it would over-count ~12× at the max-price fallback and warn on every call); migration SQL
hand-written idempotent (local dev DB carries unrelated drift a raw `migrate diff` would sweep
in). Verification (Phase 3): apps/api 2842/2842, ai-gateway 507/507, typechecks serial clean,
test:boot 290ms, scratch DB replayed all 91 migrations clean, config:validate 37/37.
Phase-4 brief decisions carried in: threshold event riskLevel HIGH; draft-lane budget refusal
stays out of the `providerDown` list (lands as request status FAILED — budget exhaustion is not
a retryable outage).

Phase 4 decisions: `assertCompanyAiBudget` returns a discriminated decision instead of throwing,
because the five seams refuse in three different existing shapes (429 body, `{status:'failed'}`,
provider-error result); refusals omit `retryAfterSeconds` — a monthly cap has no retry window.
The config half is cached per company for 60s in a module-level Map (the `redis-rate-limit.service`
expiresAt idiom, size-cap sweep included) with `__resetCompanyAiBudgetCache()` exported for
deterministic specs; spend is a live point read on the unique aggregate every call, never cached.
Fail-closed reaches three ways: a throwing read, a missing `companyAiMonthlyUsage` delegate, and a
non-finite platform default (the stale-`packages/config`-dist trap) all return `unavailable` →
`AI_BUDGET_UNAVAILABLE`, never an unmetered pass. A missing `companyAiConfiguration` delegate stays
tolerant (the `resolveCompanyAiModelPolicy` precedent for old unit fakes) and inherits the default.
The ceiling ≥ default production rule sits at top level in `validateProductionConfig`, NOT inside
`if (isAiConfig)`: that block keys on `AI_GATEWAY_ENABLED`/`MODEL_PROVIDER`, which only the gateway
schema carries, so the rule would never have run — `Number.isFinite` on both keys is what scopes it.
Nullable `modelId` also forced `list-partners` (`?? undefined`, summary DTO stays optional-string)
and `SetPartnerAiModelUseCase` (returns the validated command model) to adapt.
Verification (Phase 4, 2026-07-29, HEAD `50381d73`): apps/api 2897/2897, ai-gateway 507/507,
config 103/103, `config:validate` 39/39, typechecks clean serially (contracts → api → ai-gateway →
web `tsc --noEmit`), `test:boot` 310ms, scratch DB replayed all 92 migrations clean and the new
migration re-runs idempotently.

Integration verification (2026-07-29): fast-forwarded `develop` through `50381d73`
and restored the Phase 4 work without textual conflicts. Fixed the nullable-model schema
integration in `SetPartnerAiModelUseCase` by returning the validated command model after the
upsert. Prisma validation, config tests (103/103), focused API tests (198/198), API typecheck,
and `git diff --check` pass.

Phase 5 decisions: `PUT :partnerCompanyId/ai-model` became a **partial update** — `modelId` and
`monthlyBudgetSatang` are both optional, an empty body is 422, and `monthlyBudgetSatang: null`
clears the override. `@IsOptional()` could not express that (it skips `null` *and* `undefined`
identically), so the DTO uses the `reimbursement.dtos` `unlessNullish` ValidateIf; the DTO class is
exported so a boundary spec can pin null-vs-absent against the real global pipe (`design:paramtypes`
reflection was tried first and is empty under tsx — the known no-decorator-metadata trap).
The upsert's create-arm writes `null` for whichever field the caller omitted (a fresh row starts
inherited); the update-arm spreads only the provided keys, so a budget-only write never touches the
model and vice versa. The audit row moved HIGH → **CRITICAL** (spec §7.7) and carries before/after
for BOTH fields, a cleared override recorded as a transition to `null`. `__resetCompanyAiBudgetCache()`
is called after a successful budget write only (a model-only write leaves the 60s cache alone).
Read side: new `GET :partnerCompanyId/ai-usage` under the existing `system.partner_dashboard.read`
(no new permission), backed by `GetPartnerAiUsageUseCase` — one `findMany` for both month keys,
the config row, and a `groupBy` on `AiUsageEvent` (cost-desc, take 10), all in one `Promise.all`;
`previousBangkokMonthKey` was added beside `bangkokMonthKey` in the meter.
Web: the operator types **baht**, not satang — `ai-budget.logic.ts` owns the ⇄ conversion, the
percent/clamp and the threshold colours so they are `.spec.ts`-testable (apps/web globs
`src/**/*.spec.ts`; a `.spec.tsx` would silently never run). The card uses only PartnerDetailPage's
local primitives (`SectionCard`/`inputClass`/`btnPrimary`/`showToast`, MembersSection's own-state
loader and table markup) — the page deliberately avoids the shared UI kit. The API's 422 reaches the
toast verbatim (no `apiErrorMessage`). Concurrent lane note: `PartnerDetailPage.tsx` was rewritten
mid-task (FEATURE_CATALOG-driven entitlements, `system-partners.logic.ts`); the card was re-applied
against the new file — re-read before editing.
Verification (Phase 5, 2026-07-29): apps/api full suite exit 0 (dot reporter; focused
partner specs 33/33 then 12/12 after the DTO gate spec was added), ai-gateway 507/507,
apps/web 534/534, typechecks clean serially (contracts → api → ai-gateway → web `tsc --noEmit`),
`test:boot` OK. Three new specs registered/added: `set-partner-ai-model.use-case.spec.ts` and
`get-partner-ai-usage.use-case.spec.ts` (both added to the hand-maintained `apps/api/package.json`
list) and `apps/web/.../ai-budget.logic.spec.ts` (glob-discovered).

Phase 6 decisions: FX lives in its own module (`line-ai/application/ai-fx-rate.ts`) beside the
price map, plain functions with module-level state. Chain is live cache → one fetch per TTL window
→ stored `AiFxRate` row → `AI_THB_PER_USD`, and it NEVER throws. Two module-level variables, not
one: the 6h value cache plus a `nextFetchAt` cooldown, because only a *good* fetch may fill the
cache (otherwise a cached fallback would report itself as `live-cache`) while a dead source must
still not cost a 3s outbound attempt per recording — the cooldown is also what makes the
`ai.fx.env_fallback` warn exactly once per TTL window. A **missing `aiFxRate` delegate
short-circuits to the env fallback before the fetch**: unit fakes predating the table then never
reach the network (the ai-gateway/crm-gateway seam specs stub `globalThis.fetch` and count calls —
an extra FX call would have broken them), and there is nowhere to store a fetched rate anyway.
The 20–60 sanity bound is applied to the stored row too (its only writer is the bounded fetch, but
a hand-edited row would misprice every future row); it is NOT applied to the operator's own
`AI_THB_PER_USD`, which is deliberate config, and a non-finite env value falls to a hard 33 rather
than writing NaN satang. The rate resolves ONCE per recording and is stamped on every row.
Owner addendum (2026-07-29, spec §6.4 addendum + criterion 15): every row also stamps
`thbPerUsdSource` — the resolver's `source` verbatim ('live-cache'|'fetched'|'stored'|
'env-fallback') — so fallback-priced rows are queryable, not merely visible in a log line that
rotates. Migration `20260731130000_ai_usage_fx_source` backfills existing rows to 'env-fallback'
(factual: everything written before the FX module was priced straight from the env value). The
meter now keeps the whole resolver result (`const fx = await resolveThbPerUsd(...)`) instead of
destructuring the rate.
Platform settings: `resolvePlatformAiBudget` shares the phase-4 60s cache under key `'__platform__'`
(the cache entry type gained an optional `platform` field) and the existing
`__resetCompanyAiBudgetCache()`; missing delegate → env, throwing read → propagates → fail closed.
`GetPartnerAiUsageUseCase` now quotes the effective (DB-first) default and ceiling — otherwise the
partner card would advertise an env number the seams no longer enforce. The per-company write
validates against the effective ceiling; reads never consult it (grandfathering, pinned by a test).
New surface mirrors the shared-LINE precedent: `SystemAiBudgetController` at `system/ai-budget`
(GET + PUT, both under `system.partner_ai_model.manage`), `Get/SetPlatformAiBudgetUseCase`, and
`apps/web/src/features/system-partners/PlatformAiBudgetPage.tsx` at `/system/ai-budget` with a
`SystemHeader` nav entry. Web money parse is now regex-based (integer + fraction parts, never
`Number(x)*100`), and `satangToBahtInput` stopped rounding to whole baht so an override with
satang round-trips through the field.
Verification (Phase 6, 2026-07-29; re-run after the addendum: apps/api full suite exit 0 with
4,646 tests, `prisma validate` clean, scratch replay of all 94 migrations clean, a pre-addendum
scratch row backfilled to 'env-fallback', migration re-ran twice as a no-op, API typecheck clean —
gateway/contracts/web were untouched by the addendum and `test:boot` was not re-run because no DI
wiring changed): apps/api full suite exit 0 (4,643 tests, dot reporter),
ai-gateway 507/507, apps/web 536/536, contracts/api/ai-gateway typechecks clean serially,
`test:boot` 368ms, `config:validate` 39/39, `prisma validate` clean, scratch DB replayed all 93
migrations clean, a pre-phase-6 scratch DB backfilled its legacy row to `33.0000` and the migration
re-ran twice as a no-op. The web `tsc --noEmit` reports 56 errors, ALL inside
`.next/verify-3004/dev/types/routes.d.ts` — a concurrent lane's dev server rewrote
`apps/web/next-env.d.ts` to import its own dist dir (already dirty at session start); a scoped
typecheck over `src/**`, `app/**` and `.next/types` is clean.

Next: main-session live UI review of the "AI Usage & Budget" card and the new Platform AI Budget
page, then commit. Deploy note for Phase 4: the two new envs
must reach the prod/UAT task defs or boot validation fails, and the migration-drift preflight
applies to `20260730120000_company_ai_monthly_budget`; watch `ai.company_budget.*` in CloudWatch
for false refusals during the first days at the default cap. Phase 6 adds no new env keys (the
existing three become fallbacks) but adds `20260731120000_ai_fx_and_platform_budget` and
`20260731130000_ai_usage_fx_source` to the same preflight, and the API now makes one outbound call
per 6h to `open.er-api.com` — an egress-blocked environment simply logs `ai.fx.fetch_failed` once
per window, prices at the env rate, and every row it writes carries
`thbPerUsdSource = 'env-fallback'` so the exposure is one query away.
