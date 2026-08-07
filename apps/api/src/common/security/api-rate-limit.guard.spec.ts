import { ExecutionContext, HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiRateLimitGuard } from './api-rate-limit.guard';
import { RedisRateLimitService } from './redis-rate-limit.service';

/** A production limiter whose shared store is down, as in an ElastiCache failover. */
function limiterWithDeadStore(): RedisRateLimitService {
  const limits = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as never);
  (limits as unknown as { client: unknown }).client = {
    eval: async () => { throw new Error('ElastiCache failover'); },
  };
  return limits;
}

function fakeConfig(overrides: Partial<{
  rateLimitEnabled: boolean;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
}> = {}) {
  return {
    rateLimitEnabled: true,
    rateLimitWindowSeconds: 60,
    rateLimitMaxRequests: 2,
    ...overrides,
  };
}

function httpContext(path = '/v1/test', ip = '203.0.113.10', xForwardedFor?: string) {
  const headers: Record<string, string> = {};
  const requestHeaders = xForwardedFor === undefined ? {} : { 'x-forwarded-for': xForwardedFor };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ path, headers: requestHeaders, socket: { remoteAddress: ip } }),
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      }),
    }),
  } as unknown as ExecutionContext;

  return { context, headers };
}

describe('ApiRateLimitGuard', () => {
  it('returns 429 with Retry-After when the IP exceeds its limit', async () => {
    const guard = new ApiRateLimitGuard(fakeConfig());
    const { context, headers } = httpContext();

    assert.equal(await guard.canActivate(context), true);
    assert.equal(await guard.canActivate(context), true);
    await assert.rejects(
      guard.canActivate(context),
      (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), HttpStatus.TOO_MANY_REQUESTS);
        return true;
      },
    );
    assert.equal(headers['Retry-After'], '60');
  });

  it('allows the IP again after its fixed window resets', async () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;

    try {
      const guard = new ApiRateLimitGuard(fakeConfig({ rateLimitMaxRequests: 1 }));
      const { context } = httpContext();

      assert.equal(await guard.canActivate(context), true);
      await assert.rejects(guard.canActivate(context), HttpException);
      now += 60_000;
      assert.equal(await guard.canActivate(context), true);
    } finally {
      Date.now = originalNow;
    }
  });

  it('passes through when rate limiting is disabled', async () => {
    const guard = new ApiRateLimitGuard(fakeConfig({
      rateLimitEnabled: false,
      rateLimitMaxRequests: 1,
    }));
    const { context } = httpContext();

    assert.equal(await guard.canActivate(context), true);
    assert.equal(await guard.canActivate(context), true);
  });

  it('exempts both health endpoint paths', async () => {
    const guard = new ApiRateLimitGuard(fakeConfig({ rateLimitMaxRequests: 1 }));

    for (const path of ['/health', '/v1/health']) {
      const { context } = httpContext(path);
      assert.equal(await guard.canActivate(context), true);
      assert.equal(await guard.canActivate(context), true);
    }
  });

  it('keys on the last X-Forwarded-For entry so ALB traffic is per-client, spoof-resistant', async () => {
    const guard = new ApiRateLimitGuard(fakeConfig({ rateLimitMaxRequests: 1 }));
    const albIp = '10.0.0.5';

    // Two different real clients behind the same ALB → separate buckets.
    const clientA = httpContext('/v1/test', albIp, '198.51.100.1');
    const clientB = httpContext('/v1/test', albIp, '198.51.100.2');
    assert.equal(await guard.canActivate(clientA.context), true);
    assert.equal(await guard.canActivate(clientB.context), true);

    // A spoofed client-supplied prefix does not escape the real client's bucket.
    const spoofed = httpContext('/v1/test', albIp, '1.2.3.4, 198.51.100.1');
    await assert.rejects(guard.canActivate(spoofed.context), HttpException);
  });

  // M-12 availability decision (2026-07-28): a Redis outage must not be a total API outage. The
  // global bucket guards no spend and no credential, so it degrades; cost-bearing and auth buckets
  // keep the service's default fail-closed policy, which redis-rate-limit.service.spec.ts asserts.
  it('serves from the per-process counter instead of 503-ing when the shared store is down', async () => {
    const guard = new ApiRateLimitGuard(fakeConfig({ rateLimitMaxRequests: 2 }), () => {}, limiterWithDeadStore());
    const { context } = httpContext();

    // Redis is unavailable for all three calls; fail-closed would have 503'd every one of them.
    assert.equal(await guard.canActivate(context), true);
    assert.equal(await guard.canActivate(context), true);
  });

  it('still enforces the limit while degraded — the budget is per process, not absent', async () => {
    const guard = new ApiRateLimitGuard(fakeConfig({ rateLimitMaxRequests: 2 }), () => {}, limiterWithDeadStore());
    const { context, headers } = httpContext();

    assert.equal(await guard.canActivate(context), true);
    assert.equal(await guard.canActivate(context), true);
    await assert.rejects(guard.canActivate(context), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), HttpStatus.TOO_MANY_REQUESTS);
      return true;
    });
    assert.equal(headers['Retry-After'], '60');
  });

  it('fails closed and logs once when the limiter has an internal error', async () => {
    let logCount = 0;
    const brokenConfig = {
      get rateLimitEnabled(): boolean {
        throw new Error('config unavailable');
      },
      rateLimitWindowSeconds: 60,
      rateLimitMaxRequests: 1,
    };
    const guard = new ApiRateLimitGuard(brokenConfig, () => {
      logCount += 1;
    });
    const { context } = httpContext();

    await assert.rejects(guard.canActivate(context), ServiceUnavailableException);
    await assert.rejects(guard.canActivate(context), ServiceUnavailableException);
    assert.equal(logCount, 1);
  });
});
