# M-02 Implementation Plan — AI/API Logging & Per-Tool Audit

Spec: `docs/specs/m-02-ai-api-observability-spec.md`. Owner model split: Fable 5 = spec/plan/final verification; Opus 5 = coding, review, tests. Sequential lanes (shared worktree — no parallel edits).

## Lane 1 — contracts + AI Gateway (Opus 5)

Files:
1. `packages/contracts/src/ai-tools.ts` — add `durationMs?: number` to `ToolResult`.
2. `packages/contracts/src/line-ai.ts` — add `errorCode?: string` to `AgentToolCall`; add `toolCalls?: AgentToolCall[]` to `LineAiTurnResponse`.
3. Rebuild contracts (`pnpm --filter @watchdog-bms/contracts build`) — apps typecheck against dist (known trap).
4. `apps/ai-gateway/src/common/logger/logger.service.ts` — add `NestPinoLoggerBridge implements LoggerService` (log/warn/error/debug/verbose/fatal mapping per spec D1).
5. `apps/ai-gateway/src/common/filters/all-exceptions.filter.ts` (new) — copy of API filter wired to pino logger.
6. `apps/ai-gateway/src/main.ts` — `logger: bridge` in create options; `useGlobalFilters(new AllExceptionsFilter(...))`; keep startup log.
7. `apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client.ts` — measure duration; attach `durationMs` to returned ToolResult (all return sites incl. early errors: policy deny, missing input, missing secret/delegation, timeout, HTTP_x, invalid JSON, source-honesty rejects); emit `ai.tool.invoke.result` with requestId; add requestId to policy allow/deny events.
8. `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts` — populate `toolCalls` on all 3 paths (agentcore: passthrough `result.toolsInvoked`; local: `outputs.flatMap(o => o.toolCalls)`; deterministic: build from ToolResult status+durationMs); set `errorCode` on provider/AgentCore failure refusals; emit `ai.provider.failure` with requestId+path.
9. Specs: extend `erp-tool.client.spec.ts`, `line-ai-turn.use-case.spec.ts`, `logger.spec.ts` (bridge + redaction canary). New spec files must be registered in `apps/ai-gateway/package.json` `test` script (hand-maintained list).

Checks: `pnpm --filter ai-gateway test`, `pnpm --filter ai-gateway typecheck`, `pnpm --filter ai-gateway build && pnpm --filter ai-gateway build:agentcore`.

## Lane 2 — API (Opus 5)

Files:
1. `apps/api/src/common/logger/logger.service.ts` — same `NestPinoLoggerBridge`.
2. `apps/api/src/main.ts` — `logger: bridge` (keep `AllExceptionsFilter` + comment update).
3. `apps/api/src/modules/audit/domain/models/audit-action.ts` — add `AI_TOOL_INVOKE_DENIED`, `AI_TOOL_INVOKE_FAILED` following existing enum/action-string pattern.
4. `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts` — awaited AuditLog on every deny path (reason codes per spec §5) and on execution error; measure invoke duration; include duration in success/deny/error audit metadata.
5. `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — `persistTurn` uses `response.toolCalls` (real status/durationMs/errorCode per tool) when present; legacy fallback when absent.
6. Specs: extend `internal-tools.controller.spec.ts` (audit row per deny/error path — assert action, reasonCode, requestId, awaited), `process-line-webhook.use-case.spec.ts` (real per-tool persistence + fallback + reconstruction drill asserting shared requestId across AiTurn/AiToolInvocation/audit calls). Register any new spec file in `apps/api/package.json` `test` list.

Checks: `pnpm --filter api test`, `pnpm --filter api typecheck`.

## Lane 3 — Independent review + full suites (Opus 5)

- Adversarial review of combined diff against spec §2/§3: redaction coverage on every new emit site; no message text/LINE IDs/inputs/secrets in events; audit awaited (fail-closed) everywhere new; contract additive-only; persistTurn fallback correct when `toolCalls` undefined (old AgentCore artifact); bridge level mapping; no double-logging of 5xx (filter + Nest default both firing is acceptable only if single emit — verify).
- Run: full `pnpm --filter api test`, `pnpm --filter ai-gateway test`, both `typecheck`, `pnpm --filter @watchdog-bms/contracts build`, `pnpm --filter ai-gateway build:agentcore`.
- Fix confirmed findings; re-run affected suites.

## Environment traps (all lanes)

- Node: prefix every shell with `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"` (shell defaults to Node 14).
- Never `git add -A`; do not commit — leave changes in working tree (shared worktree).
- apps/api/.env has stale DB URL; live-DB work (not planned here) must pass `DATABASE_URL` for docker `:15432/watchdog_bms` explicitly.
- Test scripts are hand-maintained `tsx --test` file lists in each package.json — unregistered specs silently never run.
- Re-read files before editing (concurrent sessions possible).

## Acceptance (Fable 5 final check)

- All spec §2 goals mapped to diff + passing focused specs; full suites green; §6 closure evidence produced; checklist M-02 updated with code/test evidence + explicit residual (live log-group/alert work → M-16); memory doc written.
