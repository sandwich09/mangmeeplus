# Per-Company AI Budget Override Plan

Spec: `docs/specs/per-company-ai-budget-override-spec.md`

## Sequencing rationale

Phase 1 ships on its own and is worth shipping even if the rest is never built: today nobody
can tell whether any company has ever exhausted its AI budget, so any number chosen in phase 3
would be a guess. Observability first, then the mechanism, then the control surface.

## Phase 1 — Make exhaustion visible (independently shippable)

- Emit a named event when an AI company budget refuses a call, from the shared enforcement
  path, carrying `companyId`, bucket (`ai-llm-company` / `ai-ocr-company`), the effective
  limit, and (after phase 3) whether it came from an override.
- Use `apps/api/src/common/logger/security-event.ts` and add the name to `SECURITY_EVENT`;
  carry a root-level `riskLevel` so the existing CloudWatch metric filter matches. Keep the
  cross-app byte-identity guard test passing — the gateway copy must stay identical.
- Tests: a refused call emits exactly one event with the documented fields; an allowed call
  emits none.

Exit: a refusal is visible in logs and reachable by the existing alarm.

## Phase 2 — One resolver, no behaviour change

- Add `resolveCompanyAiBudget(companyId, kind)` returning the platform default only, and route
  all four enforcement sites through it: `ai-gateway.client.ts:66-76`,
  `crm-ai-gateway.client.ts:63`, `receipt-ocr.client.ts:24`,
  `statement-ai-extract.client.ts:28`.
- No config or schema change yet. This phase must be provably behaviour-preserving.
- Tests: each site consumes with the same scope, key, max and window as before.

Exit: a single seam exists; existing AI tests unchanged and green.

## Phase 3 — Override storage, ceiling, and resolution

- Schema: add `llmMaxPerCompany Int?` and `ocrMaxPerCompany Int?` to `CompanyAiConfiguration`;
  migration timestamp must order after every migration already present in the tree. Decide
  explicitly what a budget-only row means given `modelId` is non-nullable, and record the
  decision — do not default a model silently.
- Config: add `AI_LLM_MAX_PER_COMPANY_CEILING` and `AI_OCR_MAX_PER_COMPANY_CEILING` to the API
  schema with defaults, plus a production rule that each ceiling is ≥ its default. Follow the
  existing `validateProductionConfig` patterns in `packages/config/src/index.ts`.
- Resolver: read the override, fall back to the platform default on absence **or any error**,
  cache per company with a short TTL. No per-call database query.
- Tests: override applied; absent override inherits; a resolver throw falls back to the default
  and never to unlimited; two companies in one window do not interfere; cache respects its TTL.

Exit: budgets are per company at the enforcement boundary, still with no way to set them.

## Phase 4 — Operator control surface

- API: extend the existing `PUT /:partnerCompanyId/ai-model`
  (`partner.controller.ts:217`, permission `system.partner_ai_model.manage`) or add a sibling
  route under the same permission. Reject above-ceiling values with 422; reject zero and
  non-integers; honour `partnerMetadataLockError` exactly as the model change does.
- Use case: mirror `SetPartnerAiModelUseCase` — read existing values, upsert and write the
  CRITICAL audit row **in the same transaction**, recording before/after for both budgets and
  representing a cleared override as a transition to inherited.
- Web: extend `PartnerDetailPage.tsx` and `system-partners.api.ts`. Show the window the limit
  applies to, the inherited value when the field is empty, the ceiling, and recent peak usage.
  Surface the API's 422 rather than clamping client-side. Preserve the page's existing loading,
  error and permission states.
- Tests: above-ceiling rejected and nothing persisted; clearing returns to inherited; audit row
  contains before/after; no tenant-facing route exposes these values; web renders inherited vs
  overridden and the permission-denied state.

Exit: acceptance criteria 1–9 in the spec are all demonstrable.

## Verification

Pin Node in every shell call: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.

- Focused `tsx --test` per phase; register any new API spec in the hand-maintained `test` list
  in `apps/api/package.json` — an unregistered spec silently never runs.
- Full API suite once at the end; typechecks run serially, never two at once.
- `prisma validate` and apply the migration to a scratch database, passing `DATABASE_URL`
  explicitly (`apps/api/.env` holds a stale port that the Prisma CLI would otherwise use).
- `packages/config` tests plus `pnpm config:validate` for the new ceiling rules.
- Rebuild `packages/config` after changing it — the compiled `dist` is what a built app
  resolves, and a stale `dist` silently yields `undefined` for new exports.

## Out of scope

Self-service tenant editing, onboarding-time entry, per-user or per-branch budgets, billing or
spend attribution, and any change to the Redis limiter algorithm.
