/**
 * L-14: proof that the two API-side denial paths this lane owns actually emit their named
 * security event with a root-level riskLevel the production metric filter can see.
 *
 * These live here rather than beside each subject because `api-rate-limit.guard.spec.ts` and the
 * workflow webhook use-case are being edited by a concurrent session; adding cases to those files
 * would collide. Both emitters route through Nest's `Logger`, which main.ts bridges to the
 * redacting pino stream (M-02), so `Logger.overrideLogger` is the honest capture point.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiRateLimitGuard } from '../security/api-rate-limit.guard';
import { RedisRateLimitService } from '../security/redis-rate-limit.service';
import { CreateWorkflowWebhookEndpointUseCase } from '../../modules/workflow/application/use-cases/workflow-webhook.use-case';
import {
  __resetCompanyAiBudgetCache,
  assertCompanyAiBudget,
  recordCompanyAiUsage,
} from '../../modules/line-ai/application/company-ai-usage-meter';

function captureWarnings(): { lines: Array<Record<string, unknown>>; restore: () => void } {
  const lines: Array<Record<string, unknown>> = [];
  Logger.overrideLogger({
    log: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {},
    warn: (message: unknown) => void lines.push(message as Record<string, unknown>),
  });
  return { lines, restore: () => Logger.overrideLogger(false) };
}

function httpContext(path = '/v1/auth/login', ip = '203.0.113.10') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ path, method: 'POST', headers: { 'x-request-id': 'req-bot-1' }, socket: { remoteAddress: ip } }),
      getResponse: () => ({ setHeader: () => {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('L-14 auth.rate_limit.exceeded (global per-IP limiter)', () => {
  it('emits the named event with riskLevel=HIGH when an IP is throttled', async () => {
    const { lines, restore } = captureWarnings();
    try {
      const guard = new ApiRateLimitGuard(
        { rateLimitEnabled: true, rateLimitWindowSeconds: 60, rateLimitMaxRequests: 1 } as never,
      );
      const context = httpContext();
      assert.equal(await guard.canActivate(context), true);
      await assert.rejects(guard.canActivate(context), (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), HttpStatus.TOO_MANY_REQUESTS);
        return true;
      });

      const event = lines.find((line) => line['msg'] === 'auth.rate_limit.exceeded');
      assert.ok(event, 'a 429 used to be completely invisible: no log, no audit, no counter');
      assert.equal(event['riskLevel'], 'HIGH');
      assert.equal(event['bucket'], 'api-ip');
      assert.equal(event['clientIp'], '203.0.113.10');
      assert.equal(event['path'], '/v1/auth/login');
      assert.equal(event['method'], 'POST');
      assert.equal(event['requestId'], 'req-bot-1');
    } finally {
      restore();
    }
  });

  it('does not emit while the client is inside its quota', async () => {
    const { lines, restore } = captureWarnings();
    try {
      const guard = new ApiRateLimitGuard(
        { rateLimitEnabled: true, rateLimitWindowSeconds: 60, rateLimitMaxRequests: 5 } as never,
      );
      assert.equal(await guard.canActivate(httpContext('/v1/companies', '198.51.100.7')), true);
      assert.equal(lines.filter((line) => line['msg'] === 'auth.rate_limit.exceeded').length, 0);
    } finally {
      restore();
    }
  });
});

/**
 * M-12 availability decision (2026-07-28): the global bucket now degrades to the per-process
 * counter rather than 503-ing the whole API when Redis is down. Silent degradation of an abuse
 * control is unacceptable, so the condition itself is the alarm — HIGH riskLevel, caught by the
 * existing L-14 metric filter with no infrastructure change.
 */
describe('M-12 api.rate_limit.store_degraded (shared store unavailable)', () => {
  function guardWithDeadStore() {
    const limits = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as never);
    (limits as unknown as { client: unknown }).client = {
      eval: async () => { throw new Error('ElastiCache failover'); },
    };
    return new ApiRateLimitGuard(
      { rateLimitEnabled: true, rateLimitWindowSeconds: 60, rateLimitMaxRequests: 50 } as never,
      () => {},
      limits,
    );
  }

  it('emits the named event with riskLevel=HIGH when the shared store starts failing', async () => {
    const { lines, restore } = captureWarnings();
    try {
      assert.equal(await guardWithDeadStore().canActivate(httpContext('/v1/companies')), true);

      const event = lines.find((line) => line['msg'] === 'api.rate_limit.store_degraded');
      assert.ok(event, 'a silently degraded abuse control is the thing this decision must not ship');
      assert.equal(event['riskLevel'], 'HIGH');
      assert.equal(event['bucket'], 'api-ip');
      assert.equal(event['state'], 'degraded-to-local');
    } finally {
      restore();
    }
  });

  it('alarms on the transition, not once per request', async () => {
    const { lines, restore } = captureWarnings();
    try {
      const guard = guardWithDeadStore();
      for (let call = 0; call < 5; call += 1) {
        assert.equal(await guard.canActivate(httpContext('/v1/companies')), true);
      }
      assert.equal(
        lines.filter((line) => line['msg'] === 'api.rate_limit.store_degraded').length,
        1,
        'an outage lasts thousands of requests; the alarm must key on the edge, not the volume',
      );
    } finally {
      restore();
    }
  });

  it('does not emit while the shared store is healthy', async () => {
    const { lines, restore } = captureWarnings();
    try {
      const guard = new ApiRateLimitGuard(
        { rateLimitEnabled: true, rateLimitWindowSeconds: 60, rateLimitMaxRequests: 5 } as never,
      );
      assert.equal(await guard.canActivate(httpContext('/v1/companies', '198.51.100.9')), true);
      assert.equal(lines.filter((line) => line['msg'] === 'api.rate_limit.store_degraded').length, 0);
    } finally {
      restore();
    }
  });
});

describe('L-14 workflow.webhook.blocked (SSRF / host allowlist)', () => {
  const ctx = {
    companyId: 'co-1',
    userId: 'user-1',
    requestId: 'req-ssrf-1',
    permissions: ['workflow.webhook.manage'],
  } as never;

  function useCase(allowedHosts: string[]) {
    const repo = { createWebhookEndpoint: async () => assert.fail('a blocked URL must never reach the repository') };
    const audit = { log: async () => assert.fail('a blocked URL must never be audited as a create') };
    return new CreateWorkflowWebhookEndpointUseCase(repo as never, audit as never, {
      workflowWebhookAllowedHosts: allowedHosts,
    } as never);
  }

  for (const [label, url] of [
    ['a non-allowlisted host', 'https://evil.example.com/hook'],
    ['a link-local metadata address', 'https://169.254.169.254/latest/meta-data'],
    ['a plaintext scheme', 'http://hooks.partner.example/hook'],
    ['embedded credentials', 'https://user:pw@hooks.partner.example/hook'],
  ] as const) {
    it(`emits workflow.webhook.blocked with riskLevel=HIGH for ${label}`, async () => {
      const { lines, restore } = captureWarnings();
      try {
        await assert.rejects(() =>
          useCase(['hooks.partner.example']).execute(ctx, { name: 'hook', url } as never),
        );
        const event = lines.find((line) => line['msg'] === 'workflow.webhook.blocked');
        assert.ok(event, `${url} must emit the named event`);
        assert.equal(event['riskLevel'], 'HIGH');
        assert.equal(event['companyId'], 'co-1');
        assert.equal(event['actorUserId'], 'user-1');
        assert.equal(event['requestId'], 'req-ssrf-1');
        assert.equal(typeof event['reason'], 'string');
      } finally {
        restore();
      }
    });
  }

  it('does not emit for an allowlisted URL (the denial signal stays meaningful)', async () => {
    const { lines, restore } = captureWarnings();
    try {
      // Fails later on the missing secretRef, which is exactly the point: policy passed.
      await assert.rejects(() =>
        useCase(['hooks.partner.example']).execute(ctx, { name: 'hook', url: 'https://hooks.partner.example/h' } as never),
      );
      assert.equal(lines.filter((line) => line['msg'] === 'workflow.webhook.blocked').length, 0);
    } finally {
      restore();
    }
  });
});

/**
 * Metering spec §7.6. Both budget events are HIGH: `SecurityEventRisk` has no MEDIUM and the
 * deployed metric filter matches only HIGH/CRITICAL, so a quieter level would make the single
 * alert this admin-only scope delivers invisible to the alarm.
 */
describe('ai.company_budget.* (per-company monthly AI cap)', () => {
  const config = { aiThbPerUsd: 33, aiMonthlyBudgetSatang: 200_000 } as never;

  const meterPrisma = (monthlyBudgetSatang: number | null, costSatang: number) => ({
    client: {
      companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang }) },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang }) },
      $transaction: async (fn: (tx: never) => Promise<unknown>) => fn({
        aiUsageEvent: { createMany: async (args: { data: unknown[] }) => ({ count: args.data.length }) },
        companyAiMonthlyUsage: { upsert: async () => ({ costSatang }) },
      } as never),
    },
  }) as never;

  const usage = [{
    tag: 'line_turn',
    modelId: 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
    ok: true,
    inputTokens: 10_000,
    outputTokens: 2_000,
    cacheReadInputTokens: 50_000,
    cacheWriteInputTokens: 8_000,
    durationMs: 1234,
  }];

  it('emits ai.company_budget.exceeded with riskLevel=HIGH on a refusal', async () => {
    __resetCompanyAiBudgetCache();
    const { lines, restore } = captureWarnings();
    try {
      const decision = await assertCompanyAiBudget(meterPrisma(40_000, 40_000), config, 'co-1');
      assert.equal(decision.allowed, false);

      const event = lines.find((line) => line['msg'] === 'ai.company_budget.exceeded');
      assert.ok(event, 'a refusal the operator cannot see is a cap nobody can tune');
      assert.equal(event['riskLevel'], 'HIGH');
      assert.equal(event['companyId'], 'co-1');
      assert.equal(event['spendSatang'], 40_000);
      assert.equal(event['budgetSatang'], 40_000);
      assert.equal(event['override'], true);
    } finally {
      restore();
    }
  });

  it('emits ai.company_budget.threshold with riskLevel=HIGH when spend crosses 80%', async () => {
    __resetCompanyAiBudgetCache();
    const { lines, restore } = captureWarnings();
    try {
      // Budget 1,000 → the line is 800; the single recorded entry costs 347, and the fake
      // reports a post-increment total of 900, so this recording is the crossing.
      await recordCompanyAiUsage(meterPrisma(1_000, 900), config, { companyId: 'co-1', sourceRoute: 'line-turn' }, usage);

      const event = lines.find((line) => line['msg'] === 'ai.company_budget.threshold');
      assert.ok(event, 'the 80% warning is the operator lever before the cap actually bites');
      assert.equal(event['riskLevel'], 'HIGH');
      assert.equal(event['companyId'], 'co-1');
      assert.equal(event['spendSatang'], 900);
      assert.equal(event['budgetSatang'], 1_000);
      assert.equal(event['override'], true);
    } finally {
      restore();
    }
  });

  it('emits neither event while the company is comfortably under budget', async () => {
    __resetCompanyAiBudgetCache();
    const { lines, restore } = captureWarnings();
    try {
      await assertCompanyAiBudget(meterPrisma(null, 10), config, 'co-1');
      await recordCompanyAiUsage(meterPrisma(null, 10), config, { companyId: 'co-1', sourceRoute: 'line-turn' }, usage);

      assert.equal(lines.filter((line) => String(line['msg']).startsWith('ai.company_budget.')).length, 0);
    } finally {
      restore();
    }
  });
});
