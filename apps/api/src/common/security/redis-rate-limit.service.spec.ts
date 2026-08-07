import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { RedisRateLimitService } from './redis-rate-limit.service';

class FakeRedis {
  readonly values = new Map<string, { count: number; ttl: number }>();

  async eval(_script: string, _keys: number, key: string, ttl: string): Promise<[number, number]> {
    const row = this.values.get(key) ?? { count: 0, ttl: Number(ttl) };
    row.count += 1;
    this.values.set(key, row);
    return [row.count, row.ttl];
  }

  async get(key: string): Promise<string | null> { return String(this.values.get(key)?.count ?? 0); }
  async ttl(key: string): Promise<number> { return this.values.get(key)?.ttl ?? -2; }
  async quit(): Promise<'OK'> { return 'OK'; }
}

describe('RedisRateLimitService', () => {
  it('shares one atomic budget across service instances', async () => {
    const redis = new FakeRedis();
    const first = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as any);
    const second = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as any);
    (first as any).client = redis;
    (second as any).client = redis;

    assert.equal((await first.consume('ocr', 'company-1', 2, 60)).allowed, true);
    assert.equal((await second.consume('ocr', 'company-1', 2, 60)).allowed, true);
    assert.equal((await first.consume('ocr', 'company-1', 2, 60)).allowed, false);
  });

  it('fails closed in production when the shared store is unavailable', async () => {
    const service = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as any);
    (service as any).client = { eval: async () => { throw new Error('down'); } };
    await assert.rejects(service.consume('llm', 'company-1', 1, 60), ServiceUnavailableException);
  });

  // M-12 availability decision (2026-07-28). The default above is the one that matters for every
  // cost-bearing and credential-guarding bucket: an unmetered LLM call spends real money and an
  // unmetered login is an unthrottled credential attack, so those still refuse. Only a caller that
  // names `degrade-to-local` trades the shared window for a per-process one.
  it('keeps fail-closed as the default policy for every caller that does not opt out', async () => {
    const service = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as any);
    (service as any).client = { eval: async () => { throw new Error('down'); } };
    await assert.rejects(service.consume('ai-llm-company', 'company-1', 1, 60, 'fail-closed'), ServiceUnavailableException);
    await assert.rejects(service.inspect('password-login-ip', '203.0.113.10', 1, 60), ServiceUnavailableException);
  });

  it('degrades to a per-process window, still limited, when the caller opts in', async () => {
    const service = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as any);
    (service as any).client = { eval: async () => { throw new Error('failover'); } };

    const first = await service.consume('api-ip', '203.0.113.10', 2, 60, 'degrade-to-local');
    assert.equal(first.allowed, true);
    assert.equal(first.degraded, true, 'the caller must be able to alarm on the degraded condition');
    assert.equal((await service.consume('api-ip', '203.0.113.10', 2, 60, 'degrade-to-local')).allowed, true);
    // Degraded is not unlimited: the same budget applies, just per process.
    assert.equal((await service.consume('api-ip', '203.0.113.10', 2, 60, 'degrade-to-local')).allowed, false);
  });

  it('marks healthy shared-store decisions as not degraded', async () => {
    const service = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as any);
    (service as any).client = new FakeRedis();
    assert.equal((await service.consume('api-ip', '203.0.113.10', 2, 60, 'degrade-to-local')).degraded, undefined);
  });
});
