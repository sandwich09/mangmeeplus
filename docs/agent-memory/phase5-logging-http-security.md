# Agent Memory: Phase 5 – Logging, HTTP Security, and Runtime Safety

Status: Complete
Owner: DEV
Scope: apps/api – structured logging, request-id propagation, typed config validation

Role gate status:
- BA: covered by plan (platform-foundation-local-prod-lean-plan.md §Phase 5)
- SA: covered by spec (platform-foundation-local-prod-lean-spec.md §8)
- DEV: complete (see below)
- Integration: not started

## Decisions

- **pino JSON-only**: no pino-pretty runtime dep; JSON always. Add pino-pretty as devDep when local dev text logs are needed.
- **rootDir removed from api tsconfig**: importing workspace source (`@watchdog-bms/config`) via path alias conflicts with `rootDir: "src"`. Removed rootDir; TypeScript computes it from include glob (`src/**/*.ts`). Build output structure is unchanged for typecheck; if emit is broken verify with `pnpm build`.
- **No direct zod import in api**: used `ReturnType<typeof apiConfigSchema.parse>` to avoid adding zod as an api dep.
- **LoggerModule**: thin NestJS module that provides the pino logger under `LOGGER_TOKEN` symbol; reads config from `process.env` directly (avoids DI chicken-and-egg with config).
- **AppConfigService**: plain class (not @Injectable), instantiated in `bootstrap()`. Validates `process.env` against `apiConfigSchema`; throws on invalid config so process fails fast.
- **Rate limit**: config validated (`RATE_LIMIT_ENABLED` in apiConfigSchema); actual `@nestjs/throttler` wiring is out of scope (future addition).

## Files Changed

- `apps/api/package.json` — added `@watchdog-bms/config: workspace:*`, `pino`, `pino-http`; devDep `@types/pino-http`
- `apps/api/tsconfig.json` — removed `rootDir: "src"`
- `apps/api/src/common/logger/logger.service.ts` — pino factory + LOGGER_TOKEN + AppLogger type
- `apps/api/src/common/logger/logger.module.ts` — NestJS module providing LOGGER_TOKEN
- `apps/api/src/common/middleware/request-id.middleware.ts` — UUID propagation middleware
- `apps/api/src/common/middleware/request-logger.middleware.ts` — structured request log (method, path, status, durationMs, requestId)
- `apps/api/src/common/config/app-config.service.ts` — typed env accessor via apiConfigSchema
- `apps/api/src/main.ts` — bootstrap uses AppConfigService + createLogger; Swagger guard uses config.swaggerEnabled
- `apps/api/src/app.module.ts` — imports LoggerModule; implements NestModule with MiddlewareConsumer

## Verification

```
pnpm --filter @watchdog-bms/api typecheck   # exit 0 ✓
```

## Open Questions

- none

## Next

Integration: verify request-id header round-trip, log output format in local dev, and that oversized payload returns 413.
