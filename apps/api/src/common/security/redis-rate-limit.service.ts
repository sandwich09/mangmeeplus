import { createHash } from 'node:crypto';
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

type RedisCounter = Pick<Redis, 'eval' | 'get' | 'ttl' | 'quit'>;
type LocalBucket = { count: number; expiresAt: number };

const CONSUME_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

@Injectable()
export class RedisRateLimitService implements OnModuleDestroy {
  private client?: RedisCounter;
  private readonly local = new Map<string, LocalBucket>();

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
    const key = `rate-limit:v1:${scope}:${createHash('sha256').update(rawKey.trim().toLowerCase().slice(0, 512)).digest('hex')}`;
    try {
      if (!this.client && this.config.redisUrl) {
        this.client = new Redis(this.config.redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 1_500,
          commandTimeout: 1_500,
        });
      }
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
}
