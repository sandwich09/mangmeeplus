import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  count: number;
  /** True when this decision came from the in-process fallback after the shared store failed. */
  degraded?: boolean;
};

export type LeaseDecision =
  | { acquired: true; token: string; retryAfterSeconds: number; degraded?: boolean }
  | { acquired: false; retryAfterSeconds: number; degraded?: boolean };

/**
 * What a bucket does when the shared store is unavailable in production.
 *
 * `fail-closed` (the default, and what every cost-bearing or credential-guarding bucket uses)
 * refuses the request: an unmetered OCR/LLM call spends real money, and an unmetered login
 * endpoint is an unthrottled credential attack. Losing those controls is worse than the 503.
 *
 * `degrade-to-local` keeps serving on the per-process counter. It exists for the blunt global
 * IP bucket, which guards no spend and no secret — trading the whole API's availability for it
 * is the wrong side of spec §4 rule 6 ("liveness is not sacrificed for safety"). Degraded is not
 * unlimited: the limit still applies, just per task instead of per fleet, so an attacker gets
 * task-count× the budget rather than an open door. Callers that opt in must expect `degraded`.
 */
export type StoreFailurePolicy = 'fail-closed' | 'degrade-to-local';

type RedisCounter = Pick<Redis, 'eval' | 'get' | 'set' | 'ttl' | 'quit' | 'connect'>;
type LocalBucket = { count: number; expiresAt: number };
type LocalLease = { token: string; expiresAt: number };

const CONSUME_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

const CONSUME_ONCE_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  local count = tonumber(redis.call('GET', KEYS[1]) or '0')
  local ttl = redis.call('TTL', KEYS[1])
  return {count, ttl, 1}
end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl, 0}
`;

const RELEASE_LEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class RedisRateLimitService implements OnModuleDestroy {
  private client?: RedisCounter;
  private initialConnection?: Promise<void>;
  private readonly local = new Map<string, LocalBucket>();
  private readonly localOnce = new Map<string, number>();
  private readonly localLeases = new Map<string, LocalLease>();

  // The token has to be stated explicitly: a `Pick<>` annotation emits no runtime type, so Nest
  // has nothing to resolve and the whole API fails to boot. The narrow structural type is kept
  // deliberately — it is what lets specs pass a two-field stub instead of a whole config service.
  constructor(
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'redisUrl' | 'isProduction'>,
  ) {}

  async consume(
    scope: string,
    rawKey: string,
    maxRequests: number,
    windowSeconds: number,
    onStoreFailure: StoreFailurePolicy = 'fail-closed',
  ): Promise<RateLimitDecision> {
    return this.run(scope, rawKey, maxRequests, windowSeconds, true, onStoreFailure);
  }

  async inspect(
    scope: string,
    rawKey: string,
    maxRequests: number,
    windowSeconds: number,
    onStoreFailure: StoreFailurePolicy = 'fail-closed',
  ): Promise<RateLimitDecision> {
    return this.run(scope, rawKey, maxRequests, windowSeconds, false, onStoreFailure);
  }

  /** Atomically spends one bucket slot for one durable operation, even after a lost response. */
  async consumeOnce(
    scope: string,
    rawKey: string,
    idempotencyKey: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision & { replayed: boolean }> {
    const counterKey = this.key('rate-limit', scope, rawKey);
    const onceKey = this.key('idempotency', scope, `${rawKey}:${idempotencyKey}`);
    try {
      await this.ready();
      if (!this.client) return this.localConsumeOnce(counterKey, onceKey, maxRequests, windowSeconds);
      const [count, ttl, replayed] = await this.client.eval(
        CONSUME_ONCE_LUA, 2, counterKey, onceKey, String(windowSeconds),
      ) as [number, number, number];
      return {
        allowed: count <= maxRequests,
        count,
        retryAfterSeconds: Math.max(1, ttl),
        replayed: replayed === 1,
      };
    } catch (error) {
      if (this.config.isProduction) {
        throw new ServiceUnavailableException('Abuse-control store is unavailable.', { cause: error });
      }
      return { ...this.localConsumeOnce(counterKey, onceKey, maxRequests, windowSeconds), degraded: true };
    }
  }

  /**
   * Crash-safe distributed admission lease. Unlike a rate-limit counter it can be released as
   * soon as the cost-bearing action and its ledger write finish; the TTL is only the dead-owner
   * escape hatch. Production fails closed when Redis is unavailable.
   */
  async tryAcquireLease(scope: string, rawKey: string, ttlSeconds: number): Promise<LeaseDecision> {
    const key = this.key('lease', scope, rawKey);
    const token = randomUUID();
    try {
      await this.ready();
      if (!this.client) return this.localLeaseDecision(key, token, ttlSeconds);

      const acquired = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
      if (acquired === 'OK') return { acquired: true, token, retryAfterSeconds: ttlSeconds };
      return { acquired: false, retryAfterSeconds: Math.max(1, await this.client.ttl(key)) };
    } catch (error) {
      if (this.config.isProduction) {
        throw new ServiceUnavailableException('Admission-control store is unavailable.', { cause: error });
      }
      return { ...this.localLeaseDecision(key, token, ttlSeconds), degraded: true };
    }
  }

  /** Releases only the lease owned by `token`; a stale owner can never delete its successor. */
  async releaseLease(scope: string, rawKey: string, token: string): Promise<boolean> {
    const key = this.key('lease', scope, rawKey);
    const local = this.localLeases.get(key);
    if (local?.token === token) {
      this.localLeases.delete(key);
      return true;
    }
    if (!this.client) return false;
    return Number(await this.client.eval(RELEASE_LEASE_LUA, 1, key, token)) === 1;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit();
  }

  private async run(
    scope: string,
    rawKey: string,
    max: number,
    window: number,
    increment: boolean,
    onStoreFailure: StoreFailurePolicy,
  ): Promise<RateLimitDecision> {
    const key = this.key('rate-limit', scope, rawKey);
    try {
      await this.ready();
      if (!this.client) return this.localDecision(key, max, window, increment);
      const result = increment
        ? await this.client.eval(CONSUME_LUA, 1, key, String(window)) as [number, number]
        : [Number(await this.client.get(key) ?? 0), Math.max(1, await this.client.ttl(key))] as [number, number];
      return { allowed: increment ? result[0] <= max : result[0] < max, count: result[0], retryAfterSeconds: Math.max(1, result[1]) };
    } catch (error) {
      if (this.config.isProduction && onStoreFailure === 'fail-closed') {
        throw new ServiceUnavailableException('Abuse-control store is unavailable.', { cause: error });
      }
      return { ...this.localDecision(key, max, window, increment), degraded: true };
    }
  }

  private async ready(): Promise<void> {
    if (!this.client && this.config.redisUrl) {
      const client = this.createClient();
      this.client = client;
      // Share the first connection; offline queuing stays disabled and failures still fail closed.
      this.initialConnection = client.connect().finally(() => { this.initialConnection = undefined; });
    }
    await this.initialConnection;
  }

  private createClient(): RedisCounter {
    return new Redis(this.config.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
      commandTimeout: 1_500,
    });
  }

  private key(prefix: 'rate-limit' | 'lease' | 'idempotency', scope: string, rawKey: string): string {
    const hash = createHash('sha256').update(rawKey.trim().toLowerCase().slice(0, 512)).digest('hex');
    return `${prefix}:v1:${scope}:${hash}`;
  }

  private localDecision(key: string, max: number, windowSeconds: number, increment: boolean): RateLimitDecision {
    const now = Date.now();
    if (this.local.size > 10_000) {
      for (const [candidate, bucket] of this.local) {
        if (bucket.expiresAt <= now) this.local.delete(candidate);
      }
      const oldest = this.local.keys().next().value as string | undefined;
      if (this.local.size > 10_000 && oldest) this.local.delete(oldest);
    }
    const current = this.local.get(key);
    const bucket = !current || current.expiresAt <= now
      ? { count: 0, expiresAt: now + windowSeconds * 1_000 }
      : current;
    if (increment) bucket.count += 1;
    this.local.set(key, bucket);
    return {
      allowed: increment ? bucket.count <= max : bucket.count < max,
      count: bucket.count,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1_000)),
    };
  }

  private localConsumeOnce(
    counterKey: string,
    onceKey: string,
    max: number,
    windowSeconds: number,
  ): RateLimitDecision & { replayed: boolean } {
    const now = Date.now();
    const existing = this.localOnce.get(onceKey);
    if (existing && existing > now) {
      return { ...this.localDecision(counterKey, max, windowSeconds, false), replayed: true };
    }
    this.localOnce.set(onceKey, now + windowSeconds * 1_000);
    return { ...this.localDecision(counterKey, max, windowSeconds, true), replayed: false };
  }

  private localLeaseDecision(key: string, token: string, ttlSeconds: number): LeaseDecision {
    const now = Date.now();
    if (this.localLeases.size > 10_000) {
      for (const [candidate, lease] of this.localLeases) {
        if (lease.expiresAt <= now) this.localLeases.delete(candidate);
      }
      const oldest = this.localLeases.keys().next().value as string | undefined;
      if (this.localLeases.size > 10_000 && oldest) this.localLeases.delete(oldest);
    }
    const current = this.localLeases.get(key);
    if (current && current.expiresAt > now) {
      return { acquired: false, retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1_000)) };
    }
    this.localLeases.set(key, { token, expiresAt: now + ttlSeconds * 1_000 });
    return { acquired: true, token, retryAfterSeconds: ttlSeconds };
  }
}
