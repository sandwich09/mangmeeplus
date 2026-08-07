# Agent Memory: prisma-error-mapping-and-enum-parity

Status: Spec + plan written (2026-07-29). Implementation NOT started — separate coding lane implements from the plan.
Owner: thawatchai (product owner decision on open questions); spec/plan lane authored docs on branch `claude/sharp-cori-1a6e2e`.
Scope: (1) Global exception filter in `apps/api` maps four Prisma client failures to 4xx; everything else keeps 500 + enriched 5xx log. (2) Guard test asserting contracts `as const` enum arrays are set-equal to their `apps/api/prisma/schema.prisma` enums. Docs only in this lane; no code, no commits by this lane.

Decisions:
- Mapping: `PrismaClientValidationError` → 400; P2002 → 409; P2025 → 404; **P2003 → 409** (well-formed request vs. data state = conflict class; one deterministic status covers both the bad-reference-on-create and blocked-delete flavors without per-method heuristics; groups with P2002 as "re-check data" vs 400 "fix payload").
- Explicit non-remap list (stays 500 + 5xx log): P2021/P2022 (schema drift — this repo's real prod migration-drift incident class), PrismaClientInitializationError/P1xxx (DB down), P2024 (pool), P2034 (serialization), Unknown/RustPanic, raw DB errors (25P02, P2010), all other known codes. Rule: remap only failures deterministically caused by request content against a healthy DB.
- Detection by `instanceof` against the generated client (`src/generated/prisma/client`, precedent `common/database/prisma.service.ts`), not structural `err.code` sniffing.
- Body = Nest default `{statusCode, message, error}` via built-in exceptions; fixed constant messages; never echo `PrismaClientValidationError.message` (contains query/payload dump); only P2002 `meta.target` column names may be appended. No machine `code` field added (open question below).
- Translated 4xx logs exactly one `warn` line with prismaCode; genuine 5xx logging unchanged; plain HttpException 4xx stay quiet. Translated exception (not the original) is passed to `super.catch`.
- Scope apps/api only; AI Gateway has no Prisma and must not gain one. LINE webhooks unaffected (`@HttpCode(200)` + internal catch).
- Parity test lives in `packages/contracts/src/prisma-enum-parity.spec.ts` (NOT apps/api — apps/api resolves contracts via built dist and `pnpm -r test` doesn't build first → stale-dist false results; contracts spec imports source directly). Parses `schema.prisma` **text** (source of truth; generated client can be stale), set-equality both directions, fails loudly (≥50 enums parsed or fail — never skip), duplicate check.
- Registry is authoritative with 12 day-one pairs (all value-verified 2026-07-29), including three cross-named: `PROCUREMENT_VAT_MODES↔AccountingVatMode`, `CRM_AI_SENTIMENTS↔CrmSentiment`, `CRM_AI_CUSTOMER_RISKS↔CrmRiskLevel`. Discovery sweep (regex over contracts src for same-named `as const` string arrays) flags unregistered additions; cross-named pairs are not discoverable — registry discipline + DTO-conversion recipe cover that. One-side-only enums are simply out of registry scope.
- Both new specs must be registered in the hand-maintained `test` lists (`apps/api/package.json`, `packages/contracts/package.json`) — known silent-never-run trap.
- Spec addendum extends `platform-foundation-local-prod-lean-spec.md` (new §15) rather than a new doc — it is the platform-wide API contract spec and §14 already anchors "API contract starts with shared TypeScript contracts". M-02 observability spec untouched (its 5xx statements remain true).

Accepted assumptions:
- Prisma 7.8 `prisma-client` generator exports `Prisma.PrismaClientKnownRequestError` / `PrismaClientValidationError` with stable constructors `(message, {code, clientVersion, meta})` / `(message, {clientVersion})` — verified exported in `src/generated/prisma/internal/prismaNamespace.ts:32`; coding lane confirms constructor shape when writing the filter spec.
- Bad enum value through `as any` surfaces as `PrismaClientValidationError` (client-side argument validation) — matches the UAT incident behavior; coding lane's filter spec fabricates the class directly so the mapping is verified regardless.
- Single Prisma schema file (no multi-file schema folder); zero `@map` on enum values; zero `@db.VarChar` (P2000 out of scope).
- Owner's counts stand: 53 `@Body() body: any` / 21 files (formatting-exact grep found 51/19 — grep broadly when converting; not re-derived).

Open questions:
- Q1 (owner): Should mapped 4xx bodies carry a stable machine-readable `code` (web `ApiError` already parses `body.code`)? Current decision is NO — clients branch on `statusCode`; adding `P2002` would couple the public contract to Prisma internals. Needs owner call only if a web feature must distinguish conflict causes.
- Q2 (owner): ANSWERED 2026-07-29 — owner asked for the whole conversion to be finished. Done in the proposed order, one commit per module batch. See `docs/agent-memory/dto-boundary-conversion-g1.md`.

Artifacts:
- Spec addendum: `docs/specs/platform-foundation-local-prod-lean-spec.md` §15 (mapping table 15.2, non-remap 15.3, body/log rules 15.4, pipe interaction 15.5, web interaction 15.6, parity invariant 15.8, AC 15.9).
- Plan: `docs/plans/prisma-error-mapping-and-enum-parity-plan.md` (Phase 1 filter + spec, Phase 2 parity test + registry table, Phase 3 verification, Gap Analysis G1/G2, rollback).
- This memory doc.

Verification:
- This lane: docs only — no commands beyond repo inspection. Facts verified by reading: `all-exceptions.filter.ts`, `validation-pipe.options.ts`, `main.ts` wiring, `api-error.logic.ts`/`api-error.model.ts` (web), generated client exports, contracts arrays vs schema enums (12 pairs set-compared by hand), `package.json` test lists (api + contracts + root), webhook controllers' `@HttpCode(200)`.
- Coding lane runs: `pnpm --filter @watchdog-bms/api typecheck && test`, `pnpm --filter @watchdog-bms/contracts typecheck && test`, then root `pnpm typecheck` and `pnpm test` (sequential, never concurrent typecheck+test).

Next:
- Coding lane implements Phase 1–3 per plan; if any registry pair is red at implementation time, stop and report (live drift), do not allowlist.
- Owner answers Q1 when convenient. Q2 is answered: G1 is complete (`dto-boundary-conversion-g1.md`); the parity registry grew to 17 pairs as a result.
