import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';
import { AppConfigService } from '../../../common/config/app-config.service';

export const AI_ACTOR_DELEGATION_AUDIENCE = 'watchdog-erp-core:internal-ai-tools';
export const AI_ACTOR_DELEGATION_WORKLOAD = 'ai-gateway';
export const AI_ACTOR_DELEGATION_TTL_SECONDS = 120;

const ISSUER = 'watchdog-api';
const TOKEN_VERSION = 'v1';
const MAX_TOKEN_LENGTH = 4096;
const MAX_CLOCK_SKEW_SECONDS = 5;

export type ActorDelegationClaims = {
  v: 1;
  iss: typeof ISSUER;
  aud: string;
  workload: string;
  sub: string;
  companyId: string;
  membershipId: string;
  requestId: string;
  toolName: string;
  jti: string;
  iat: number;
  exp: number;
};

export type ActorDelegationExpected = {
  userId: string;
  companyId: string;
  membershipId: string;
  requestId: string;
  toolName: string;
};

export type ActorDelegationReplayStore = {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
  quit?(): Promise<unknown>;
};

export class ActorDelegationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ActorDelegationError';
  }
}

function fail(code: string): never {
  throw new ActorDelegationError(code);
}

function signatureInput(payload: string): string {
  return `${TOKEN_VERSION}.${payload}`;
}

export function signActorDelegationClaims(claims: ActorDelegationClaims, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', key).update(signatureInput(payload)).digest('base64url');
  return `${signatureInput(payload)}.${signature}`;
}

function parseVerifiedClaims(token: string, key: Buffer): ActorDelegationClaims {
  if (!token || token.length > MAX_TOKEN_LENGTH) fail('ACTOR_DELEGATION_INVALID');
  const [version, payload, encodedSignature, extra] = token.split('.');
  if (version !== TOKEN_VERSION || !payload || !encodedSignature || extra !== undefined) {
    fail('ACTOR_DELEGATION_INVALID');
  }

  const supplied = Buffer.from(encodedSignature, 'base64url');
  const expected = createHmac('sha256', key).update(signatureInput(payload)).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail('ACTOR_DELEGATION_INVALID_SIGNATURE');
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    fail('ACTOR_DELEGATION_INVALID');
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    fail('ACTOR_DELEGATION_INVALID');
  }
  const value = claims as Record<string, unknown>;
  const stringClaims = [
    'iss', 'aud', 'workload', 'sub', 'companyId', 'membershipId',
    'requestId', 'toolName', 'jti',
  ];
  if (
    value['v'] !== 1
    || stringClaims.some((claim) => typeof value[claim] !== 'string' || value[claim] === '')
    || !Number.isInteger(value['iat'])
    || !Number.isInteger(value['exp'])
  ) {
    fail('ACTOR_DELEGATION_INVALID');
  }
  return value as ActorDelegationClaims;
}

export function verifyActorDelegationToken(
  token: string,
  key: Buffer,
  expected: ActorDelegationExpected,
  now = Date.now(),
): ActorDelegationClaims {
  const claims = parseVerifiedClaims(token, key);
  const nowSeconds = Math.floor(now / 1000);

  if (
    claims.iss !== ISSUER
    || claims.aud !== AI_ACTOR_DELEGATION_AUDIENCE
    || claims.workload !== AI_ACTOR_DELEGATION_WORKLOAD
  ) {
    fail('ACTOR_DELEGATION_WRONG_AUDIENCE');
  }
  if (claims.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) fail('ACTOR_DELEGATION_NOT_YET_VALID');
  if (claims.exp <= nowSeconds) fail('ACTOR_DELEGATION_EXPIRED');
  if (claims.exp <= claims.iat || claims.exp - claims.iat > AI_ACTOR_DELEGATION_TTL_SECONDS) {
    fail('ACTOR_DELEGATION_INVALID_LIFETIME');
  }
  if (
    claims.sub !== expected.userId
    || claims.companyId !== expected.companyId
    || claims.membershipId !== expected.membershipId
    || claims.requestId !== expected.requestId
    || claims.toolName !== expected.toolName
  ) {
    fail('ACTOR_DELEGATION_CONTEXT_MISMATCH');
  }
  return claims;
}

@Injectable()
export class ActorDelegationService implements OnModuleDestroy {
  private readonly logger = new Logger(ActorDelegationService.name);
  private replayStore: ActorDelegationReplayStore | null = null;

  constructor(private readonly config: AppConfigService) {}

  attachReplayStore(store: ActorDelegationReplayStore): void {
    this.replayStore = store;
  }

  issue(input: ActorDelegationExpected, now = Date.now()): string {
    if (Object.values(input).some((value) => !value)) {
      fail('ACTOR_DELEGATION_CONTEXT_INVALID');
    }
    const iat = Math.floor(now / 1000);
    return signActorDelegationClaims({
      v: 1,
      iss: ISSUER,
      aud: AI_ACTOR_DELEGATION_AUDIENCE,
      workload: AI_ACTOR_DELEGATION_WORKLOAD,
      sub: input.userId,
      companyId: input.companyId,
      membershipId: input.membershipId,
      requestId: input.requestId,
      toolName: input.toolName,
      jti: randomUUID(),
      iat,
      exp: iat + AI_ACTOR_DELEGATION_TTL_SECONDS,
    }, this.config.aiActorDelegationSigningKey);
  }

  async consume(
    token: string,
    expected: ActorDelegationExpected,
    now = Date.now(),
  ): Promise<ActorDelegationClaims> {
    const claims = verifyActorDelegationToken(
      token,
      this.config.aiActorDelegationSigningKey,
      expected,
      now,
    );
    const store = this.redis();
    const ttl = Math.max(1, claims.exp - Math.floor(now / 1000));
    let consumed: 'OK' | null;
    try {
      consumed = await store.set(
        `ai:actor-delegation:v1:${claims.jti}`,
        '1',
        'EX',
        ttl,
        'NX',
      );
    } catch (error) {
      this.logger.warn({ msg: 'AI actor delegation replay store unavailable', error: (error as Error).message });
      fail('ACTOR_DELEGATION_REPLAY_STORE_UNAVAILABLE');
    }
    if (consumed !== 'OK') fail('ACTOR_DELEGATION_REPLAYED');
    return claims;
  }

  private redis(): ActorDelegationReplayStore {
    if (this.replayStore) return this.replayStore;
    try {
      this.replayStore = new Redis(this.config.redisUrl, {
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        commandTimeout: 2000,
      }) as unknown as ActorDelegationReplayStore;
      (this.replayStore as unknown as {
        on?: (event: string, listener: (error: Error) => void) => void;
      }).on?.('error', (error) => {
        this.logger.warn({ msg: 'AI actor delegation Redis error', error: error.message });
      });
      return this.replayStore;
    } catch {
      fail('ACTOR_DELEGATION_REPLAY_STORE_UNAVAILABLE');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.replayStore?.quit?.().catch(() => {});
    this.replayStore = null;
  }
}
