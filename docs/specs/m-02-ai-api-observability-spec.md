# M-02 — AI/API Logging & Per-Tool Audit Investigability Spec

- **Source finding:** `docs/security-remediation-checklist-merged-2026-07-17.md` §2 M-02 (merged Opus `L13`, `I10`, `I14`, `I16`, `I18`)
- **Status:** Spec approved 2026-07-28 (Fable 5 spec owner). Implementation lanes: Opus 5.
- **Scope boundary:** This item makes AI/API events *visible, correlated, and durable*. It does NOT cover: transactional/outbox guarantee for ledger `void this.audit.log(...)` mutation paths (→ `L-10`), deep recursive redaction-by-key + production log-level policy hardening (→ `L-09`), CloudWatch retention/metric filters/alert routing (→ `M-16` live config). Those stay open under their own checklist items.

## 1. Problem (verified in code 2026-07-28)

| # | Gap | Evidence |
|---|-----|----------|
| G1 | Both apps boot Nest with `logger: false`; every `new Logger()` module call is dropped (API ~78 call sites / 28 files, Gateway 18 call sites). API mitigates only 5xx via `AllExceptionsFilter`→pino. Gateway has **no** exception filter: gateway 5xx and all operational logs are silent. | `apps/ai-gateway/src/main.ts:31`, `apps/api/src/main.ts:101-102` |
| G2 | No per-tool correlation: `ErpToolClient.invoke` logs (dropped anyway) omit `requestId`; no per-tool duration measured; policy allow/deny events not durable. | `erp-tool.client.ts:100-166` |
| G3 | Durable audit at the API tool boundary is selective: AuditLog written only when `meta.sensitiveAudit && result.status === 'ok'`. Deny paths (no access, missing `ai.tool.invoke`, ERP permission denied, unknown tool) and execution errors leave only dropped `logger.warn`. | `internal-tools.controller.ts:228-303, 305-333` |
| G4 | Per-tool rows are fabricated from turn-level data: `persistTurn` writes `AiToolInvocation` rows with the whole-turn `durationMs` and `status` derived from turn `errorCode`, for every tool name. Real per-tool `AgentToolCall {name,status,durationMs}` already exists in contracts and flows through the AgentCore path (`runtime.ts:279`) and local orchestrator (`SpecialistOutput.toolCalls`) but `LineAiTurnResponse.toolsInvoked` flattens to `string[]`. | `process-line-webhook.use-case.ts:1007-1025`, `packages/contracts/src/line-ai.ts:356-374,425-429` |
| G5 | Provider failures leave no durable trace: `runAgentCorePath`/`runLocalOrchestratorPath` catch → `buildRefusedResponse('tool_unavailable')` without `errorCode`, so `AiTurn.errorCode` stays null and the only record is a dropped `logger.error`. | `line-ai-turn.use-case.ts:183-188, 208-213` |

## 2. Goals (Definition of Done for the code/test part)

1. **Operational logs wired (G1):** Both apps emit module `Logger` output as structured redacted JSON (pino) at the configured level. Gateway gains 5xx visibility equivalent to the API's `AllExceptionsFilter`.
2. **Request/tool correlation (G2):** Every gateway per-tool event carries `requestId`, `toolName`, `companyId`, `userId`, `status`, `durationMs` (measured around the ERP fetch), `errorCode` when failed. Turn-level `ai.turn.complete` (already coded) becomes visible and correlates via `requestId`.
3. **Durable allow/deny/error audit (G3):** The API internal tool boundary writes an awaited AuditLog row for every invoke outcome class: delegation consumed (exists), denied (each deny reason), execution error, and success (sensitive tools as today; non-sensitive success remains durable via real `AiToolInvocation` rows from G4 — no new AuditLog row required for non-sensitive OK). Denied/error audit rows carry `requestId`, `toolName`, reason code, and `result: 'DENIED' | 'FAILED'`. Audit writes stay awaited (fail-closed like the existing delegation-consume audit) — no new fire-and-forget.
4. **Real per-tool records (G4):** `LineAiTurnResponse` gains optional `toolCalls?: AgentToolCall[]`; `AgentToolCall` gains optional `errorCode?: string`. All three gateway paths populate it (AgentCore passthrough, local orchestrator flatMap, deterministic path from measured `ToolResult`s). `persistTurn` persists real per-tool `status`/`durationMs`/`errorCode` when `toolCalls` present; falls back to current derivation when absent (older AgentCore artifact compatibility). `toolsInvoked: string[]` stays for wire compatibility.
5. **Provider-failure trace (G5):** Provider/AgentCore failure paths set a typed `errorCode` on the refused `LineAiTurnResponse` (from `ProviderErrorCode` or `AGENTCORE_INVOKE_FAILED`), so `AiTurn.errorCode` persists it; the gateway log event `ai.provider.failure` carries `requestId` + code.
6. **No secret/PII in new logs:** All new events reuse the existing pino redaction paths; no message text, LINE user IDs, tool inputs, tokens, or delegation material in log/audit payloads. Canary tests prove redaction on the wired path.
7. **Security-metrics-ready event catalog:** Stable `msg` codes documented (§5) so M-16 can build CloudWatch metric filters without code changes.

## 3. Design decisions

- **D1 — Nest logger bridge, not filter-only.** Implement a small `LoggerService` bridge class wrapping the existing pino `createLogger` (per app, in each app's `common/logger/`), passed via `NestFactory.create(AppModule, { logger: bridge })` (replacing `logger: false`). Keep `AllExceptionsFilter` (API) as-is; add the same 34-line filter to the gateway wired to its pino logger. Map Nest levels→pino (`log`→info, `verbose`→trace, `debug`→debug, `warn`→warn, `error`→error, `fatal`→fatal). The bridge must serialize Nest's `(message, ...optionalParams)` calling convention: object message → pino object; string message → `{ msg }`; trailing string context param → `context` field. Respect `config.logLevel`; redaction always on per existing config default.
- **D2 — Per-tool events in `ErpToolClient`.** Measure `Date.now()` around the fetch; emit one `ai.tool.invoke.result` event per call (all statuses) plus keep `ai.tool.policy.allow|deny`. Include `requestId: ctx.requestId`. Return measured `durationMs` to callers by attaching it to the returned `ToolResult` via a new optional contract field `durationMs?: number` on `ToolResult` (additive) so the deterministic path and specialists can build `AgentToolCall` without re-measuring.
- **D3 — Deny/error audit actions.** Reuse `AuditAction` registry: add `AI_TOOL_INVOKE_DENIED` and `AI_TOOL_INVOKE_FAILED` (or string actions consistent with the existing `ai.` action prefix convention — follow the existing `AuditAction` enum pattern in `audit-action.ts`). `metadataJson` limited to `{ toolName, reasonCode, durationMs }`. `riskLevel: 'MEDIUM'` for denies at the ERP boundary, `'LOW'` for unknown-tool, `'HIGH'` for execution errors on sensitive tools, else `'MEDIUM'`. Awaited.
- **D4 — Contract changes are additive-only.** `AgentToolCall.errorCode?`, `LineAiTurnResponse.toolCalls?`, `ToolResult.durationMs?`. No field removed/renamed → an older deployed AgentCore artifact keeps working; `persistTurn` fallback covers missing `toolCalls`.
- **D5 — `AiToolInvocation.inputHash` semantics unchanged** (message preview hash). Renaming is schema churn out of scope.
- **D6 — Log volume.** New per-tool events are bounded by existing tool budgets (≤3 tools deterministic, model-loop budget elsewhere). Turning on module logs raises volume; production level stays `info` via config; noisy findings during review get demoted to `debug`, not deleted.

## 4. Non-goals

- No new metrics stack, no CloudWatch alarm/retention changes (M-16), no log-shipping changes.
- No outbox refactor of existing `void this.audit.log` financial paths (L-10).
- No change to AI Gateway↔API auth model (M-01 owns delegation) or to what tools may run.
- No UI changes. No schema migration (all persistence uses existing tables/columns).

## 5. Event catalog (stable codes for M-16 metric filters)

| Event (`msg`) | Emitter | Required fields |
|---|---|---|
| `ai.turn.complete` | gateway `LineAiTurnUseCase` | requestId, companyId, intent, agent, refused, toolCount, durationMs |
| `ai.tool.policy.allow` / `ai.tool.policy.deny` | gateway `ErpToolClient` | requestId, toolName, companyId, userId(, reason) |
| `ai.tool.invoke.result` | gateway `ErpToolClient` | requestId, toolName, status, durationMs(, errorCode) |
| `ai.provider.failure` | gateway turn use-case / providers | requestId, code, path (`agentcore`\|`orchestrator`) |
| `unhandled exception` | both apps' `AllExceptionsFilter` | requestId, method, path, err.stack |
| AuditLog `AI_ACTOR_DELEGATION_CONSUME` | API controller (exists) | requestId, jti, workload, toolName |
| AuditLog `AI_TOOL_INVOKE` (sensitive OK, exists) | API controller | requestId, toolName, sourceRefs |
| AuditLog `AI_TOOL_INVOKE_DENIED` (new) | API controller | requestId, toolName, reasonCode |
| AuditLog `AI_TOOL_INVOKE_FAILED` (new) | API controller | requestId, toolName, reasonCode |

Reason codes at the API boundary: `NO_AUTHORITATIVE_ACCESS`, `AI_TOOL_GATE_MISSING`, `ERP_PERMISSION_DENIED`, `TOOL_NOT_FOUND`, `SOURCE_MODULE_NOT_READY`, `TOOL_EXECUTION_ERROR`, `STALE_ACTOR_DELEGATION` (delegation valid+consumed but company/membership no longer match current access — jti is burned, so the attempt MUST leave a durable row; actor identity is signature-verified at that point).

Implemented action strings: `ai.tool.invoke.denied` (result `DENIED`), `ai.tool.invoke.failed` (result `FAILED`) — `ai.` prefix keeps them inside the existing `security` audit category mapping.

**Invalid-delegation boundary (spec decision):** the earliest 401 (delegation signature/consume failure) writes NO durable row — nothing about the caller is verified there, and a row keyed to caller-claimed ids would be an audit-spam vector for forged identities. Durable deny audits start at the first point with a verified anchor (resolver-catch onward, including the stale-delegation mismatch which follows a successful signature check). The wired `logger.warn` provides visibility for the pre-verification 401.

**Reconstruction pivot (spec §6 drill, as built):** `AiTurn`/`AiToolInvocation` have no `requestId` column and M-02 adds no migration, so the investigator pivot chain is `requestId → AuditLog rows (requestId col) → targetId/webhookEventId → AiTurn (webhookEventId) → AiToolInvocation (turnId)`, with per-tool durations proven distinct from the turn duration.

**Accepted residuals:** (a) unhandled non-`HttpException` 5xx emits twice post-wiring (rich filter row + Nest `ExceptionsHandler` row) — both structured, nothing lost (and the bridge's Error branch makes the second row carry name/message/stack instead of being content-free); (b) resolver-catch deny audit `actorUserId: delegation.sub` can hit a User-FK failure if that user row is deleted inside the 120s delegation TTL → request 500s instead of returning `forbidden`; fail-closed and deny-preserving, extraordinary race, accepted; (c) `NO_AUTHORITATIVE_ACCESS` deny rows are company-less by design (no verified company exists at that point; claimed id lives in `metadataJson.claimedCompanyId`) — they do not appear in the company-scoped audit UI query and are reachable by `requestId`/direct DB query only, which is the correct trade against forged-company audit spam.

## 6. Closure evidence mapping (checklist «หลักฐานปิดงาน»)

- **Synthetic allow/deny/error/provider-failure events ปรากฏครบ:** focused specs drive each path (policy deny, ERP deny, unknown tool, execution error, provider failure, happy path) and assert the emitted event + durable row (AuditLog / AiToolInvocation) with matching `requestId`.
- **Reconstruction drill:** one spec reconstructs a turn end-to-end from captured writes: same `requestId` present on gateway events, `AiTurn`, `AiToolInvocation` (real per-tool status/duration), and AuditLog rows — proving an investigator can pivot on `requestId` alone.
- **โดยไม่ log secret/PII:** canary spec logs payloads containing `authorization`, `token`, `actorDelegation(s)`, `prompt`, LINE user id fields through the wired bridge and asserts `[REDACTED]`/absence in serialized output; review lane greps new events for message-text/PII fields.
- **Alert part:** event catalog (§5) documented for M-16; no live alarm work claimed here.
