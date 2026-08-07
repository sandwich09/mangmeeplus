/**
 * Boot smoke: resolves the whole Nest dependency graph and fails if any provider is unwireable.
 *
 * Why this exists as a compiled script rather than a `*.spec.ts`: every spec in this app builds
 * its subject with `new`, so nothing in the 2,500-test suite ever asks Nest to wire anything. A
 * DI mistake is therefore invisible to `pnpm test` and only surfaces when the container starts.
 * `RedisRateLimitService` shipped that way in `23c61c08` — its constructor took
 * `Pick<AppConfigService, …>`, a mapped type that compiles to `design:paramtypes: [Object]`
 * because `Pick` has no runtime value, so Nest had no token and the API died at boot on a fully
 * green suite.
 *
 * It cannot run under `tsx --test`: tsx compiles with esbuild, which does not implement
 * `emitDecoratorMetadata`, so *every* parameter looks unresolvable there. Only the swc build
 * (`.swcrc` sets `decoratorMetadata: true`) emits the metadata Nest reads, which is why this runs
 * against `dist/`.
 *
 * No database, Redis, or S3 is needed: Nest resolves the graph before `onModuleInit`, so the
 * bogus connection strings below are never dialled. Anything other than a clean resolve is a
 * failure — including config-validation errors, which would otherwise let this exit 0 while
 * silently testing nothing.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

/** The smallest env the config schema accepts. Real values would only add flakiness. */
const SMOKE_ENV: Record<string, string> = {
  APP_ENV: 'local',
  SERVICE_NAME: 'boot-di-smoke',
  S3_BUCKET: 'boot-di-smoke',
  DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/nodb',
};

async function main(): Promise<void> {
  for (const [key, value] of Object.entries(SMOKE_ENV)) process.env[key] ??= value;

  // Imported after the env is in place: the config schema validates at module load.
  const { AppModule } = await import('../app.module');

  Logger.overrideLogger(false);
  const started = Date.now();
  const context = await NestFactory.createApplicationContext(AppModule, { abortOnError: false });
  await context.close();
  Logger.overrideLogger(true);
  console.log(`boot-di-smoke: Nest resolved every provider in ${Date.now() - started}ms`);
}

main().then(
  // Redis/Prisma clients hold the loop open; the graph resolved, so leaving is correct.
  () => process.exit(0),
  (error: unknown) => {
    Logger.overrideLogger(true);
    console.error('boot-di-smoke: the API would not start.\n');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
