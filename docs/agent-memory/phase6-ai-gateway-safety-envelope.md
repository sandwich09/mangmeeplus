# Agent Memory: Phase 6 – AI Gateway Safety Envelope

Status: Complete
Owner: DEV
Scope: apps/ai-gateway – config service, tool policy model, enforcer, pino logger, AiModule

Role gate status:
- BA: covered by plan (platform-foundation-local-prod-lean-plan.md Phase 6)
- SA: covered by spec (platform-foundation-local-prod-lean-spec.md §9 AI Agent Safety)
- DEV: complete (see below)
- Integration: not started

## Decisions

- **rootDir removed from ai-gateway tsconfig**: same issue as Phase 5 API – importing `@watchdog-bms/config` workspace source via path alias conflicts with `rootDir: "src"`. Removed; TS computes from include glob.
- **@watchdog-bms/config as workspace dep**: added directly to package.json as `workspace:*` (local package, not on npm).
- **pino JSON-only**: mirrors API pattern; no pino-pretty runtime dep.
- **AiGatewayConfigService is @Injectable()**: allows NestJS DI via AiModule AND direct instantiation in bootstrap().
- **validateProductionConfig called in constructor**: safe to call even though some checks are API-specific; non-applicable checks are no-ops.
- **ToolPolicyEnforcerService throws, not returns**: fail-fast safety envelope; actual tool execution wiring deferred to Phase 7 (LINE AI).
- **No LoggerModule for ai-gateway**: ponytail – logger is created directly in bootstrap, same minimal pattern as API. Add LoggerModule when request logging is needed.

## Artifacts

- `apps/ai-gateway/package.json` — added `pino`, `@watchdog-bms/config: workspace:*`
- `apps/ai-gateway/tsconfig.json` — removed `rootDir: "src"`
- `apps/ai-gateway/src/common/logger/logger.service.ts` — pino factory + LOGGER_TOKEN + AppLogger type
- `apps/ai-gateway/src/common/config/ai-gateway-config.service.ts` — typed env accessor via aiGatewayConfigSchema
- `apps/ai-gateway/src/common/ai/tool-policy.model.ts` — RiskLevel + ToolPolicy types
- `apps/ai-gateway/src/common/ai/tool-policy-enforcer.service.ts` — safety guard: throws on policy violations
- `apps/ai-gateway/src/common/ai/ai.module.ts` — NestJS module providing + exporting both services
- `apps/ai-gateway/src/app.module.ts` — imports AiModule
- `apps/ai-gateway/src/main.ts` — bootstrap uses AiGatewayConfigService + createLogger; startup log
- `apps/ai-gateway/src/common/ai/tool-policy-enforcer.spec.ts` — 5 node:test tests

## Verification

```
pnpm --filter @watchdog-bms/ai-gateway typecheck   # exit 0 ✓
node --test --require tsx/cjs src/common/ai/tool-policy-enforcer.spec.ts
# pass 5 / fail 0 ✓
```

## Open Questions

- none

## Next

Integration: verify ai-gateway health endpoint still responds after AiModule import; verify startup log format in local dev.
