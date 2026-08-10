import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RefreshSessionUseCase } from './refresh-session.use-case';
import { AuthRateLimitService } from '../auth-rate-limit.service';
import { SECURITY_EVENT } from '../../../../common/logger/security-event';

const SECRET = 'refresh-spec-secret';
const ISS = 'watchdog-bms';
const AUD = 'watchdog-bms-api';
const USER_ID = 'user-1';
const FAMILY_ID = 'family-1';

type Row = {
  id: string;
  userId: string;
  tokenId: string;
  previousTokenId: string | null;
  familyId: string | null;
  rotatedAt: Date | null;
  status: string;
  expiresAt: Date;
};

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    authJwtSecret: SECRET,
    watchdogJwtIssuer: ISS,
    watchdogJwtAudience: AUD,
    sessionRefreshReuseGraceSeconds: 30,
    sessionRefreshMaxPerSession: 30,
    sessionRefreshWindowSeconds: 60,
    ...overrides,
  } as any;
}

/** In-memory AuthSession delegate: findFirst(OR), findUnique(previousTokenId|familyId), CAS updateMany. */
function makeStore(seed: Partial<Row> = {}) {
  const rows: Row[] = [{
    id: 'session-row-1',
    userId: USER_ID,
    tokenId: 'token-current',
    previousTokenId: null,
    familyId: FAMILY_ID,
    rotatedAt: null,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    ...seed,
  }];
  const lookups: unknown[] = [];

  const authSession = {
    findFirst: async ({ where }: any) => {
      lookups.push(where);
      const [byToken, byPrevious] = where.OR;
      return rows.find((r) => r.tokenId === byToken.tokenId || (r.previousTokenId !== null && r.previousTokenId === byPrevious.previousTokenId)) ?? null;
    },
    // Mirrors the nullable unique columns: a NULL never matches, so a pre-L-01 row is unreachable.
    findUnique: async ({ where }: any) => {
      lookups.push(where);
      if (where.familyId !== undefined) {
        return rows.find((r) => r.familyId !== null && r.familyId === where.familyId) ?? null;
      }
      return rows.find((r) => r.previousTokenId !== null && r.previousTokenId === where.previousTokenId) ?? null;
    },
    updateMany: async ({ where, data }: any) => {
      const match = rows.filter((r) =>
        r.id === where.id
        && (where.tokenId === undefined || r.tokenId === where.tokenId)
        && (where.status === undefined || r.status === where.status));
      for (const row of match) Object.assign(row, data);
      return { count: match.length };
    },
  };

  return { rows, lookups, prisma: { client: { authSession } } as any };
}

function makeAudit() {
  const entries: any[] = [];
  return { entries, audit: { log: async (entry: unknown) => { entries.push(entry); } } as any };
}

/**
 * The real AuthRateLimitService over a scripted counter, so the 429 shape and the L-14
 * `auth.rate_limit.exceeded` emission are the production ones rather than a stub's.
 */
function makeLimiter(behaviour: 'allow' | 'over-quota' | 'outage' = 'allow') {
  const consumed: string[] = [];
  const events: Record<string, unknown>[] = [];
  const counter = {
    consume: async (scope: string, key: string) => {
      consumed.push(`${scope}:${key}`);
      if (behaviour === 'outage') throw new ServiceUnavailableException('Abuse-control store is unavailable.');
      return { allowed: behaviour === 'allow', retryAfterSeconds: 12, count: 1 };
    },
  };
  const limiter = new AuthRateLimitService(makeConfig(), counter as any);
  (limiter as any).logger = { warn: (entry: Record<string, unknown>) => { events.push(entry); } };
  return { consumed, events, limiter };
}

const jwtService = new JwtService({});

function refreshTokenFor(sid: string, overrides: Record<string, unknown> = {}, signOverrides: Record<string, unknown> = {}) {
  return jwtService.sign(
    { sub: USER_ID, sid, provider: 'watchdog', type: 'refresh', ...overrides },
    { secret: SECRET, algorithm: 'HS256', issuer: ISS, audience: AUD, expiresIn: 3600, ...signOverrides } as any,
  );
}

function claimsOf(token: string): Record<string, unknown> {
  return jwtService.verify(token, { secret: SECRET, algorithms: ['HS256'], issuer: ISS, audience: AUD } as any);
}

function sidOf(token: string): string {
  return claimsOf(token)['sid'] as string;
}

function fidOf(token: string): string | undefined {
  return claimsOf(token)['fid'] as string | undefined;
}

function makeUseCase(store: ReturnType<typeof makeStore>, opts: {
  config?: Record<string, unknown>;
  audit?: any;
  limiter?: any;
  platformAccess?: any;
} = {}) {
  return new RefreshSessionUseCase(
    jwtService,
    store.prisma,
    makeConfig(opts.config),
    null,
    opts.audit ?? null,
    opts.limiter ?? null,
    opts.platformAccess ?? null,
  );
}

describe('RefreshSessionUseCase — L-01 rotation, replay and reuse', () => {
  it('refreshes only SYSTEM_ADMIN sessions while customer access is closed', async () => {
    const closed = { getStatus: async () => ({ effectiveState: 'CLOSED' }) };
    const ordinary = makeStore();
    (ordinary.prisma.client as any).companyMembership = { findFirst: async () => null };
    await assert.rejects(
      () => makeUseCase(ordinary, { platformAccess: closed }).execute(refreshTokenFor('token-current')),
      (error: any) => error.getResponse().code === 'platform_access_closed',
    );
    assert.equal(ordinary.rows[0]!.tokenId, 'token-current');

    const admin = makeStore();
    (admin.prisma.client as any).companyMembership = { findFirst: async () => ({ id: 'system-membership' }) };
    const result = await makeUseCase(admin, { platformAccess: closed }).execute(refreshTokenFor('token-current'));
    assert.ok(result.accessToken);
    assert.notEqual(admin.rows[0]!.tokenId, 'token-current');
  });

  it('rotates on the current token and never extends expiresAt', async () => {
    const store = makeStore();
    const originalExpiry = store.rows[0]!.expiresAt.getTime();
    const { entries, audit } = makeAudit();

    const result = await makeUseCase(store, { audit }).execute(refreshTokenFor('token-current'));

    const row = store.rows[0]!;
    assert.notEqual(row.tokenId, 'token-current', 'tokenId must rotate');
    assert.equal(row.previousTokenId, 'token-current');
    assert.ok(row.rotatedAt instanceof Date);
    assert.equal(row.expiresAt.getTime(), originalExpiry, 'rotation must never extend the session');
    assert.equal(sidOf(result.refreshToken), row.tokenId, 'the new pair must carry the new session id');
    assert.equal(entries[0].result, 'SUCCESS');
    assert.equal(entries[0].metadataJson, undefined, 'a normal rotation carries no replay reason');
  });

  it('answers a replay inside the grace window with a usable pair, without rotating or revoking', async () => {
    const rotatedAt = new Date(Date.now() - 5_000);
    const store = makeStore({ tokenId: 'token-new', previousTokenId: 'token-old', rotatedAt });
    const { entries, audit } = makeAudit();

    const result = await makeUseCase(store, { audit }).execute(refreshTokenFor('token-old'));

    const row = store.rows[0]!;
    assert.equal(row.status, 'ACTIVE', 'an in-grace replay must not revoke');
    assert.equal(row.tokenId, 'token-new', 'a replay must not rotate again');
    assert.equal(row.previousTokenId, 'token-old');
    assert.equal(row.rotatedAt!.getTime(), rotatedAt.getTime(), 'the rotation instant must not move');
    assert.equal(sidOf(result.refreshToken), 'token-new', 'the replay hands back the session current id');
    assert.equal(entries[0].result, 'SUCCESS');
    assert.equal(entries[0].riskLevel, 'LOW');
    assert.equal(entries[0].metadataJson.reason, 'grace_replay');
  });

  it('revokes the session and audits CRITICAL when the previous token is replayed outside the grace window', async () => {
    const store = makeStore({ tokenId: 'token-new', previousTokenId: 'token-old', rotatedAt: new Date(Date.now() - 31_000) });
    const { entries, audit } = makeAudit();

    await assert.rejects(
      () => makeUseCase(store, { audit }).execute(refreshTokenFor('token-old')),
      (err: unknown) => { assert.ok(err instanceof UnauthorizedException); return true; },
    );

    assert.equal(store.rows[0]!.status, 'REVOKED');
    assert.ok((store.rows[0] as Record<string, unknown>)['revokedAt'] instanceof Date, 'revocation timestamp must be recorded');
    assert.equal(entries[0].result, 'DENIED');
    assert.equal(entries[0].riskLevel, 'CRITICAL');
    assert.equal(entries[0].metadataJson.reason, 'refresh_token_reuse_detected');
  });

  it('cannot chain replays to slide the grace window', async () => {
    const rotatedAt = new Date(Date.now() - 5_000);
    const store = makeStore({ tokenId: 'token-new', previousTokenId: 'token-old', rotatedAt });
    const useCase = makeUseCase(store);

    await useCase.execute(refreshTokenFor('token-old'));
    assert.equal(store.rows[0]!.rotatedAt!.getTime(), rotatedAt.getTime(), 'the replay left the window anchor alone');

    // Grace is measured from that untouched anchor, so once it lapses the same token is reuse.
    store.rows[0]!.rotatedAt = new Date(Date.now() - 31_000);
    await assert.rejects(() => useCase.execute(refreshTokenFor('token-old')), UnauthorizedException);
    assert.equal(store.rows[0]!.status, 'REVOKED');
  });

  it('treats any previous-token presentation as reuse when the grace window is zero', async () => {
    const store = makeStore({ tokenId: 'token-new', previousTokenId: 'token-old', rotatedAt: new Date() });

    await assert.rejects(
      () => makeUseCase(store, { config: { sessionRefreshReuseGraceSeconds: 0 } }).execute(refreshTokenFor('token-old')),
      UnauthorizedException,
    );
    assert.equal(store.rows[0]!.status, 'REVOKED');
  });

  it('yields exactly one rotation when two requests race with the same token', async () => {
    const store = makeStore();
    const useCase = makeUseCase(store);
    const token = refreshTokenFor('token-current');

    const results = await Promise.all([useCase.execute(token), useCase.execute(token)]);

    const row = store.rows[0]!;
    assert.equal(row.previousTokenId, 'token-current', 'only one rotation may be recorded');
    assert.equal(row.status, 'ACTIVE', 'a benign race must not revoke the family');
    for (const result of results) {
      assert.equal(sidOf(result.refreshToken), row.tokenId, 'both callers hold a pair for the winning token');
    }
  });

  // Forces the interleaving the in-process race cannot guarantee: the read returns the
  // pre-rotation snapshot, so the CAS predicate misses and the loser must replay, not error.
  it('falls into the replay path on a compare-and-set miss instead of minting a second pair', async () => {
    const store = makeStore();
    const stale = { ...store.rows[0]! };
    let served = false;
    store.prisma.client.authSession.findFirst = async () => {
      if (served) return store.rows[0];
      served = true;
      // A competing refresh already rotated the row between this read and our write.
      Object.assign(store.rows[0]!, { tokenId: 'token-winner', previousTokenId: 'token-current', rotatedAt: new Date() });
      return stale;
    };

    const result = await makeUseCase(store).execute(refreshTokenFor('token-current'));

    assert.equal(store.rows[0]!.tokenId, 'token-winner', 'the loser must not rotate on top of the winner');
    assert.equal(store.rows[0]!.status, 'ACTIVE');
    assert.equal(sidOf(result.refreshToken), 'token-winner');
  });

  it('still answers 401 for a revoked, an expired and an unknown session', async () => {
    for (const seed of [{ status: 'REVOKED' as const }, { expiresAt: new Date(Date.now() - 1) }]) {
      const store = makeStore(seed);
      await assert.rejects(() => makeUseCase(store).execute(refreshTokenFor('token-current')), UnauthorizedException);
    }
    const store = makeStore();
    await assert.rejects(() => makeUseCase(store).execute(refreshTokenFor('never-issued')), UnauthorizedException);
  });

  // L-05: a sid-less refresh token used to reach findUnique with `undefined` and 500.
  it('rejects a sid-less refresh token with 401 and never queries the session table', async () => {
    const store = makeStore();
    const token = jwtService.sign(
      { sub: USER_ID, type: 'refresh' },
      { secret: SECRET, algorithm: 'HS256', issuer: ISS, audience: AUD, expiresIn: 3600 } as any,
    );

    await assert.rejects(
      () => makeUseCase(store).execute(token),
      (err: unknown) => { assert.ok(err instanceof UnauthorizedException); return true; },
    );
    assert.equal(store.lookups.length, 0);
  });

  // L-04: the refresh verify sits on a @Public() endpoint; nothing may be left unpinned.
  it('rejects a refresh token with the wrong algorithm, issuer or audience, and an access token', async () => {
    const store = makeStore();
    const claims = { sub: USER_ID, sid: 'token-current', type: 'refresh', iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 3600 };
    const algNone = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;

    const rejected = [
      algNone,
      jwtService.sign(claims, { secret: SECRET, algorithm: 'HS512' } as any),
      refreshTokenFor('token-current', {}, { issuer: 'evil-issuer' }),
      refreshTokenFor('token-current', {}, { audience: 'evil-audience' }),
      // An access token presented at the refresh endpoint.
      jwtService.sign({ sub: USER_ID, sid: 'token-current' }, { secret: SECRET, algorithm: 'HS256', issuer: ISS, audience: AUD, expiresIn: 900 } as any),
    ];

    for (const token of rejected) {
      await assert.rejects(() => makeUseCase(store).execute(token), UnauthorizedException);
    }
    assert.equal(store.rows[0]!.tokenId, 'token-current', 'no rejected token may rotate the session');
  });
});

describe('RefreshSessionUseCase — L-01 rate-limit ordering', () => {
  it('consumes no session quota for a token whose session is revoked', async () => {
    const store = makeStore({ status: 'REVOKED' });
    const { consumed, limiter } = makeLimiter();

    await assert.rejects(() => makeUseCase(store, { limiter }).execute(refreshTokenFor('token-current')), UnauthorizedException);
    assert.deepEqual(consumed, [], 'the bucket is consumed only after the session is proven ACTIVE');
  });

  it('never lets a stale token burn the live session current bucket', async () => {
    const store = makeStore({ tokenId: 'token-new', previousTokenId: 'token-old', rotatedAt: new Date(Date.now() - 31_000) });
    const { consumed, limiter } = makeLimiter();

    await assert.rejects(() => makeUseCase(store, { limiter }).execute(refreshTokenFor('token-old')), UnauthorizedException);
    assert.equal(consumed.includes('session-refresh:token-new'), false, 'the live session quota must be untouched');
  });

  it('propagates the limiter rejection as 429 once the session is live, and alarms on it', async () => {
    const store = makeStore();
    const { events, limiter } = makeLimiter('over-quota');

    await assert.rejects(
      () => makeUseCase(store, { limiter }).execute(refreshTokenFor('token-current')),
      (err: unknown) => { assert.ok(err instanceof HttpException); assert.equal((err as HttpException).getStatus(), 429); return true; },
    );
    assert.equal(store.rows[0]!.tokenId, 'token-current', 'a throttled refresh must not rotate');
    // L-14: the refresh bucket used to throw its own 429 without the alarm-keyed event.
    assert.deepEqual(
      events.map((entry) => [entry['msg'], entry['riskLevel'], entry['scope']]),
      [[SECURITY_EVENT.authRateLimitExceeded, 'HIGH', 'session-refresh']],
    );
  });

  // Spec §4 rule 6: the refresh bucket is defence in depth over a dependency that can fail. The
  // BFF deletes the auth cookies on a non-OK refresh, so a 503 here would log out every user
  // whose access token expired during a Redis failover, while their sessions are still ACTIVE.
  it('keeps refreshing when the rate-limit store is unavailable', async () => {
    const store = makeStore();
    const { consumed, limiter } = makeLimiter('outage');

    const result = await makeUseCase(store, { limiter }).execute(refreshTokenFor('token-current'));

    assert.deepEqual(consumed, ['session-refresh:token-current'], 'the limiter was consulted, and it failed');
    assert.equal(sidOf(result.refreshToken), store.rows[0]!.tokenId, 'the caller still gets a working pair');
    assert.notEqual(store.rows[0]!.tokenId, 'token-current', 'and the session still rotated');
    assert.equal(store.rows[0]!.status, 'ACTIVE');
  });
});

describe('RefreshSessionUseCase — L-01 token family (reuse beyond one generation)', () => {
  it('carries the family unchanged across rotation and grace replay', async () => {
    const rotating = makeStore();
    const rotated = await makeUseCase(rotating).execute(refreshTokenFor('token-current', { fid: FAMILY_ID }));
    assert.equal(fidOf(rotated.refreshToken), FAMILY_ID, 'a rotation keeps the family');

    const replaying = makeStore({ tokenId: 'token-new', previousTokenId: 'token-old', rotatedAt: new Date(Date.now() - 5_000) });
    const replayed = await makeUseCase(replaying).execute(refreshTokenFor('token-old', { fid: FAMILY_ID }));
    assert.equal(fidOf(replayed.refreshToken), FAMILY_ID, 'an in-grace replay keeps the family');
    assert.equal(replaying.rows[0]!.familyId, FAMILY_ID, 'and never rewrites it');
  });

  // The realistic theft pattern: steal T1, the victim refreshes on to T2 and T3, then replay T1.
  // T1 matches neither the current nor the previous id, so before the family it was a plain 401.
  it('detects reuse two and three generations deep, revoking and auditing CRITICAL', async () => {
    for (const [label, seed] of [
      ['two generations', { tokenId: 'token-g3', previousTokenId: 'token-g2' }],
      ['three generations', { tokenId: 'token-g4', previousTokenId: 'token-g3' }],
    ] as const) {
      const store = makeStore({ ...seed, rotatedAt: new Date() });
      const { entries, audit } = makeAudit();
      const useCase = makeUseCase(store, { audit });
      const events: Record<string, unknown>[] = [];
      (useCase as any).logger = { warn: (entry: Record<string, unknown>) => { events.push(entry); } };

      await assert.rejects(() => useCase.execute(refreshTokenFor('token-g1', { fid: FAMILY_ID })), UnauthorizedException);

      assert.equal(store.rows[0]!.status, 'REVOKED', `${label}: the family must be revoked`);
      assert.equal(entries[0].result, 'DENIED');
      assert.equal(entries[0].riskLevel, 'CRITICAL');
      assert.equal(entries[0].metadataJson.reason, 'refresh_token_reuse_detected');
      assert.deepEqual(
        events.map((entry) => [entry['msg'], entry['riskLevel']]),
        [[SECURITY_EVENT.authSessionRefreshReuse, 'CRITICAL']],
        `${label}: the security event must fire`,
      );
    }
  });

  it('answers a plain 401 when the family resolves to nothing', async () => {
    const store = makeStore({ familyId: 'family-other' });

    await assert.rejects(
      () => makeUseCase(store).execute(refreshTokenFor('token-g1', { fid: FAMILY_ID })),
      UnauthorizedException,
    );
    assert.equal(store.rows[0]!.status, 'ACTIVE', 'a stranger family must not revoke anyone');
  });

  it('never revokes a family that is already dead', async () => {
    for (const seed of [{ status: 'REVOKED' as const }, { expiresAt: new Date(Date.now() - 1) }]) {
      const store = makeStore({ tokenId: 'token-g3', previousTokenId: 'token-g2', ...seed });
      const { entries, audit } = makeAudit();

      await assert.rejects(
        () => makeUseCase(store, { audit }).execute(refreshTokenFor('token-g1', { fid: FAMILY_ID })),
        UnauthorizedException,
      );
      assert.deepEqual(entries, [], 'a dead family needs no second revocation, and no CRITICAL row');
    }
  });

  // Pre-L-01 sessions carry no family, in the row or in the token. They must keep working through
  // the current/previous paths, and an unknown family must never be read as a match.
  it('refreshes a pre-L-01 session and never treats its claimless token as reuse', async () => {
    const legacy = makeStore({ familyId: null });
    const result = await makeUseCase(legacy).execute(refreshTokenFor('token-current'));
    assert.equal(sidOf(result.refreshToken), legacy.rows[0]!.tokenId, 'a claimless token still rotates');
    assert.equal(fidOf(result.refreshToken), undefined, 'and the pair stays claimless');

    // Same claimless token, now retired several generations, against a live family.
    const rotated = makeStore({ tokenId: 'token-g3', previousTokenId: 'token-g2', rotatedAt: new Date() });
    await assert.rejects(() => makeUseCase(rotated).execute(refreshTokenFor('token-g1')), UnauthorizedException);
    assert.equal(rotated.rows[0]!.status, 'ACTIVE', 'no family claim means unknown family, never a match');
  });

  // F3: the CAS loser whose id a *second* rotation already pushed out of previousTokenId used to
  // 401 — which, before the BFF fix, logged the user out on a benign multi-tab race.
  it('resolves a compare-and-set loser through its family after a second rotation landed', async () => {
    const store = makeStore();
    const stale = { ...store.rows[0]! };
    let served = false;
    store.prisma.client.authSession.findFirst = async () => {
      if (served) return store.rows[0];
      served = true;
      // Two competing refreshes land between this read and our write.
      Object.assign(store.rows[0]!, { tokenId: 'token-g3', previousTokenId: 'token-g2', rotatedAt: new Date() });
      return stale;
    };

    const result = await makeUseCase(store).execute(refreshTokenFor('token-current', { fid: FAMILY_ID }));

    assert.equal(store.rows[0]!.tokenId, 'token-g3', 'the loser must not rotate on top of the winners');
    assert.equal(store.rows[0]!.status, 'ACTIVE');
    assert.equal(sidOf(result.refreshToken), 'token-g3', 'and it holds a usable pair for the winning token');
  });
});
