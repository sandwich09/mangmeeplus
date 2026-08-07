# Agent Memory: M-02 — AI/API logging & per-tool audit investigability

Status: DONE (code/test, locally verified 2026-07-28). Uncommitted in working tree. Deploy + M-16 alert wiring pending.
Owner: Fable 5 (spec/plan/final verification) + Opus 5 (3 lanes: coding, review, test) — per model-tier split.
Scope: checklist `M-02` in `docs/security-remediation-checklist-merged-2026-07-17.md` (ticked with closure evidence). Spec: `docs/specs/m-02-ai-api-observability-spec.md`. Plan: `docs/plans/m-02-ai-api-observability-plan.md`.

Decisions:

- Nest logger bridge (`NestPinoLoggerBridge`) in BOTH apps replaces `logger:false` — byte-identical class bodies enforced by a cross-app guard test in `apps/api/src/common/logger/logger.spec.ts` (edit both together or that test fails).
- Invalid-delegation 401 (earliest) writes NO durable audit row — forged-id audit-spam vector; durable rows start at resolver-catch. STALE_ACTOR_DELEGATION deny DOES write one (signature verified, jti burned).
- `NO_AUTHORITATIVE_ACCESS` rows are company-less (claimed id in `metadataJson.claimedCompanyId`) → invisible to company-scoped audit UI, reachable via requestId/DB. Deliberate.
- AgentCore `toolCalls` passthrough is bounded + runtime-coerced (name string filter, durationMs finite-number-or-0, errorCode string-or-dropped) because the artifact deploys separately (version skew real). `toolsInvoked` derives from the filtered list.
- `persistTurn` fallback (no `toolCalls`) is line-equivalent to the old turn-level derivation — old artifacts keep working.
- Reconstruction pivot (no schema change allowed): `requestId → AuditLog(requestId, indexed) → targetId/webhookEventId → AiTurn(webhookEventId) → AiToolInvocation(turnId)`.
- Accepted residuals in spec §6: double-emit on unhandled non-HttpException 5xx; User-FK race in resolver-catch audit within 120s TTL (fail-closed 500); company-less deny rows.
- Scope boundaries held: ledger `void this.audit.log` outbox → L-10; deep recursive redaction/log-level policy → L-09; CloudWatch retention/metric-filters/alerts → M-16 (event catalog ready in spec §5).

Open questions: none blocking. Optional hardening noted by review (specialists re-measure durationMs instead of consuming `ToolResult.durationMs` — equivalent values, skipped).

Artifacts (uncommitted):

- contracts: `ai-tools.ts` (+`ToolResult.durationMs?`), `line-ai.ts` (+`AgentToolCall.errorCode?`, +`LineAiTurnResponse.toolCalls?`)
- gateway: `common/logger/logger.service.ts` (+bridge) & `logger.spec.ts`, `common/filters/all-exceptions.filter.ts` (NEW), `main.ts`, `erp-tool.client.ts` (+events/duration) & spec, `line-ai-turn.use-case.ts` (3-path toolCalls, provider errorCode, `ai.provider.failure`) & spec, `agents/{inventory,accounting-summary}.agent.ts` (per-tool errorCode), `orchestrator.agent.spec.ts` (pin test)
- api: `common/logger/logger.service.ts` (+bridge, SENSITIVE_PATHS exported) & `logger.spec.ts` (NEW, registered in package.json), `main.ts`, `common/filters/all-exceptions.filter.ts` (comment), `audit-action.ts` (+`ai.tool.invoke.denied|failed`), `internal-tools.controller.ts` (+`auditToolOutcome` awaited deny/error audits) & spec, `process-line-webhook.use-case.ts` (persistTurn real per-tool) & spec

Verification (final, run by verifier 2026-07-28): gateway test 460/460; api test 2516/2516; both typechecks clean; contracts build + gateway build + build:agentcore pass. Adversarial review 12 findings: 3 CONFIRMED (all fixed — missing requestId on 2 events; specialist per-tool errorCode dropped; raw-Error content-free bridge line), rest REFUTED/correct. Redaction canaries both apps.

Next:

1. Deploy (usual immutable-artifact path) then sanity-check module logs actually appear in CloudWatch; log volume rises by design (level via config).
2. M-16: wire retention/metric filters/alerts against spec §5 event catalog.
3. Concurrent M-03 session was active in the same tree (crm-inbox/schema/migration files + its own checklist tick) — attribute dirty files correctly at commit time; commit M-02 files surgically (never `git add -A`).
