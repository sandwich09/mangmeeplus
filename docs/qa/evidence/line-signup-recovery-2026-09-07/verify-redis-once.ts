import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Redis from '../../../../apps/api/node_modules/ioredis';
import { RedisRateLimitService } from '../../../../apps/api/src/common/security/redis-rate-limit.service';

async function main() {
  const client = new Redis('redis://127.0.0.1:16569');
  await client.ping();
  const service = new RedisRateLimitService({ redisUrl: '', isProduction: true });
  (service as any).client = client;
  const scope = `signup-recovery-evidence-${randomUUID()}`;
  try {
    const raced = await Promise.all(Array.from({ length: 20 }, () => service.consumeOnce(scope, 'same-line', 'same-request', 10, 60)));
    assert.equal(raced.filter((r) => !r.replayed).length, 1);
    assert.ok(raced.every((r) => r.count === 1));
    const evaluate = client.eval.bind(client);
    (client as any).eval = async (...args: any[]) => {
      await (evaluate as any)(...args);
      throw new Error('synthetic lost response after Redis committed');
    };
    await assert.rejects(service.consumeOnce(scope, 'same-line', 'lost-response-request', 10, 60), /store is unavailable/i);
    (client as any).eval = evaluate;
    const resumed = await service.consumeOnce(scope, 'same-line', 'lost-response-request', 10, 60);
    assert.equal(resumed.replayed, true);
    assert.equal(resumed.count, 2);
    assert.ok(resumed.retryAfterSeconds > 0);
    const other = await service.consumeOnce(scope, 'other-line', 'same-request', 10, 60);
    assert.equal(other.count, 1);
    assert.equal(other.replayed, false);
    console.log('PASS actual Redis: 20 concurrent retries consume once; lost response replay consumes no extra slot; LINE principals isolated.');
  } finally {
    const keys = await client.keys(`*:${scope}:*`);
    if (keys.length) await client.del(...keys);
    await service.onModuleDestroy();
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
