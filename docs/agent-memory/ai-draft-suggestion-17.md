# Agent Memory: item 17 AI Draft and Suggestion Layer

Status: IMPLEMENTED + VERIFIED (2026-07-01). Checklist box left unchecked pending owner review + live migration/seed deploy.
Owner: implementation (Opus 4.8)
Scope: Master Implementation Checklist item 17. Spec `docs/specs/ai-draft-suggestion-layer-spec.md`, plan `docs/plans/ai-draft-suggestion-layer-plan.md`.

## Architecture decisions (ponytail: shortest correct diff)

- Generation runs **inside the API** (allowed to read its own DB): the API gathers grounded
  evidence via source reads. This inherently satisfies "AI Gateway cannot read the DB
  directly" without touching AI Gateway. Authoring itself is AI-only (see next bullet).
- **AI-authored generation (owner directive 2026-07-01: "AI 100%, not deterministic").** The model
  authors the suggestion content; the API only gathers grounded evidence (source reads = tools) and
  validates. Flow: API `SuggestionGeneratorService.collectEvidence` → `LlmDraftPort.generate(evidence)`
  → AI Gateway `POST /internal/ai/draft-generate` runs the model (Bedrock via its existing provider) →
  returns structured JSON → API validates (risk/confidence clamp, citation requirement, safe action
  allowlist) → persist. The model NEVER invents source ids/citations — those stay fixed in the evidence
  pack. No provider configured ⇒ PROVIDER_UNAVAILABLE (never canned product content). Providers:
  `AiGatewayDraftProvider` (production), `FakeLlmDraftProvider` (tests/CI/demo only), `DisabledLlmDraftProvider`.
  Env: `AI_DRAFT_PROVIDER` = gateway|fake|disabled (default: gateway when `AI_GATEWAY_INTERNAL_URL`+secret set,
  else disabled); AI Gateway `MODEL_PROVIDER=bedrock` + `BEDROCK_REGION`/`BEDROCK_MODEL_ID` for real generation.
- Async generation: `CreateDraftRequest` inserts QUEUED; workers `ai-draft` worker drains via
  `POST /internal/ai/draft-requests/drain` (worker-token, mirrors item-16 pattern). Generation is
  idempotent per request. Generation reconstructs the requester's permissions via
  `PermissionResolverService` so source reads are re-checked under the requester.
- Module dependency direction: `workflow` -> `ai-draft` (REQUEST_AI_DRAFT). ai-draft does NOT import
  workflow (no cycle). ai-draft imports Audit, AccessControl, Banking, Crm.
- Safety by design: candidate `actionType` is a closed 9-value allowlist, NO final-mutation type.
  `final_mutation` tool category always blocked; `source_draft_create`/`review_decision` web-only.
- Real source adapter = CRM follow-up (calls `CreateCrmFollowUpUseCase`, re-checks `crm.follow_up.create`).
  CFO cash suggestion = deterministic evidence (banking `GetCashPositionUseCase`), advisory only.
  Inventory/Tax/Workflow = self-owned CREATE_REVIEW_CHECKLIST fallback (no cross-module write).

## Key files

- `packages/contracts/src/ai-draft-suggestion.ts` (+ index export) — enums, DTOs, `AI_PERMISSION_KEYS`.
- `apps/api/src/modules/auth/permission-registry.ts` — 14 `ai.*` keys + role grants.
- `apps/api/src/modules/ai-draft/**` — full hexagonal module (domain logic + tests, repo+mappers,
  template catalog, provider, generator, source-draft adapter, source-state, use cases, controllers, module).
- `apps/api/prisma/schema.prisma` + migration `20260701140000_item17_ai_draft_suggestion`.
- `apps/workers/src/modules/ai-draft/ai-draft-worker.ts` (+ main.ts wiring).
- `apps/api/src/modules/workflow/...workflow-action-runner.use-case.ts` REQUEST_AI_DRAFT + template catalog `ai_draft_requested` AVAILABLE.
- `apps/web/src/features/ai-suggestions/**` + route page + nav entry + dictionary keys.

## Verification (recorded)

- `apps/api`: `npm test` 730/730 passing (84 new); `tsc --noEmit` clean.
- `apps/web`: `npm test` 116/116 (7 new); `tsc --noEmit` clean.
- `apps/workers`: `npm test` 5/5; `tsc --noEmit` clean.
- `apps/ai-gateway`: `tsc --noEmit` clean (contracts change backward-compatible).
- `packages/contracts`: build clean. `apps/api`: `prisma validate` + `prisma generate` OK.
- New spec files registered in `apps/api/package.json` `test` script.

## Caveats / deferred (owner review)

1. Migration NOT deployed + seed NOT run against live Postgres (no DB in env). Run
   `prisma migrate deploy` + `prisma db seed` before production (seed picks up new permissions from registry).
2. LINE request/refusal is implemented + unit-tested as domain logic + `LineAiSuggestionUseCase`
   (exported), but not yet wired into the live `process-line-webhook` turn. Web-only source-draft
   guard IS enforced + tested, so LINE cannot create source drafts today.
3. Real Bedrock generation requires AI Gateway creds (`MODEL_PROVIDER=bedrock` + BEDROCK_REGION/MODEL_ID).
   Verified live 2026-07-01: profile `watchdog-bedrock` in `ap-southeast-1` reaches Bedrock; the working
   model id is the cross-region inference profile `global.anthropic.claude-sonnet-4-6` (the plain
   `anthropic.claude-sonnet-4-6` is NOT on-demand invokable → `PROVIDER_ACCESS_NOT_READY`). A live model
   call succeeds (`provider-smoke.ts` → `{ok:true, text:"ยืนยัน"}`); the AI-gateway round-trip stays
   unit-tested with the model mocked. Item-17 `AiGatewayDraftProvider` uses this same gateway config.
4. Only CRM follow-up real source-draft adapter wired; quotation/tax-cert/inventory drafts degrade
   to review checklists until those source draft APIs are adopted.
5. Admin template management is read/status-only per spec (no prompt-body editing).
6. Suggestion-ready/failed notification dispatch (plan Phase 6) not wired into generation; web queue is
   the surface today. Follow-up: `CreateOrUpdateNotificationEventUseCase` + owner-only high-risk CFO routing.
7. Review-pass bugfix: broad-read roles (MANAGER/FINANCE/ACCOUNTANT/AUDITOR) were granted
   `ai.suggestion.read_own` in addition to `ai.suggestion.read` so the `@RequirePermissions('ai.suggestion.read_own')`
   list/detail/template/provider gates admit them (matches the reimbursement read/read_own precedent; the
   guard uses AND `hasAll` semantics, and `ai.suggestion.read` remains the broad-scope escalation flag).

## Next

- Owner review of deferred items; deploy migration + seed; optionally wire LINE turn + Bedrock provider.
