/**
 * L-13: health and framework reconnaissance disclosure.
 * The public route is @Public() *and* exempt from the API rate limiter, so anything it does per
 * hit is unauthenticated, unmetered work. It must be liveness only; the database probe moves
 * behind the worker-token assert.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnauthorizedException } from '@nestjs/common';
import { GetHealthUseCase } from './application/use-cases/get-health.use-case';
import { HealthController } from './presentation/http/health.controller';
import { HealthInternalController } from './presentation/http/health-internal.controller';

function countingPrisma(failing = false) {
  let queries = 0;
  const prisma = {
    client: {
      $queryRawUnsafe: async (sql: string) => {
        queries += 1;
        if (failing) throw new Error('connect ECONNREFUSED postgres://app:s3cret@db:5432/watchdog');
        return [{ sql }];
      },
    },
  } as any;
  return { prisma, queries: () => queries };
}

describe('public health endpoint', () => {
  it('returns liveness only — no db key for an unauthenticated caller', () => {
    const { prisma } = countingPrisma();
    const body = new HealthController(new GetHealthUseCase(prisma)).getHealth() as Record<string, unknown>;

    assert.deepEqual(Object.keys(body).sort(), ['service', 'status', 'timestamp']);
    assert.equal('db' in body, false, 'the datastore liveness oracle must be gone from the public body');
    assert.equal(body['status'], 'ok');
    assert.equal(body['service'], 'api');
  });

  it('issues no database query, so the rate-limit-exempt route cannot amplify load', () => {
    const { prisma, queries } = countingPrisma();

    new HealthController(new GetHealthUseCase(prisma)).getHealth();

    assert.equal(queries(), 0, 'a SELECT 1 per public hit is an unauthenticated database-load amplifier');
  });

  it('stays a 200 for ALB/ECS health checks', () => {
    const { prisma } = countingPrisma();
    const body = new HealthController(new GetHealthUseCase(prisma)).getHealth() as Record<string, unknown>;
    assert.equal(body['status'], 'ok', 'load-balancer probes must not need a config change');
  });
});

describe('internal readiness endpoint', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];

  beforeEach(() => { process.env['WORKER_INTERNAL_TOKEN'] = 'expected-worker-token'; });
  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  it('requires the worker token', async () => {
    const { prisma, queries } = countingPrisma();
    const controller = new HealthInternalController(new GetHealthUseCase(prisma));

    assert.throws(() => controller.readiness(undefined), UnauthorizedException);
    assert.throws(() => controller.readiness('wrong-token'), UnauthorizedException);
    assert.equal(queries(), 0, 'an unauthenticated caller must not reach the database probe');
  });

  it('reports db status to an authorised caller', async () => {
    const { prisma, queries } = countingPrisma();
    const controller = new HealthInternalController(new GetHealthUseCase(prisma));

    const body = await controller.readiness('expected-worker-token') as Record<string, unknown>;

    assert.equal(body['db'], 'ok');
    assert.equal(body['status'], 'ok');
    assert.equal(queries(), 1);
  });

  it('degrades instead of throwing when the database probe fails, without console.warn', async () => {
    const { prisma } = countingPrisma(true);
    const controller = new HealthInternalController(new GetHealthUseCase(prisma));
    const originalWarn = console.warn;
    let consoleWarnings = 0;
    console.warn = () => { consoleWarnings += 1; };

    try {
      const body = await controller.readiness('expected-worker-token') as Record<string, unknown>;
      assert.equal(body['db'], 'error');
      assert.equal(body['status'], 'degraded');
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(consoleWarnings, 0, 'the raw driver error must go through the redacting logger, not console.warn');
  });
});

describe('framework reconnaissance surface', () => {
  const mainSources = {
    api: join(__dirname, '../../main.ts'),
    'ai-gateway': join(__dirname, '../../../../ai-gateway/src/main.ts'),
  };

  for (const [app, path] of Object.entries(mainSources)) {
    it(`${app}: API docs are gated on the explicit flag in every environment`, () => {
      const source = readFileSync(path, 'utf8');
      assert.match(source, /if \(config\.swaggerEnabled\) \{/, 'docs must require SWAGGER_ENABLED');
      assert.doesNotMatch(
        source,
        /!isProduction \|\| config\.swaggerEnabled/,
        'any non-production APP_ENV would publish the full route and DTO surface',
      );
    });

    it(`${app}: x-powered-by is disabled explicitly`, () => {
      const source = readFileSync(path, 'utf8');
      assert.match(source, /disable\('x-powered-by'\)/, 'must not rely on a framework/helmet default');
    });
  }
});
