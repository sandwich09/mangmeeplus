import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ActorDelegationError,
  ActorDelegationService,
  AI_ACTOR_DELEGATION_TTL_SECONDS,
  signActorDelegationClaims,
  type ActorDelegationReplayStore,
} from './actor-delegation.service';

const KEY = Buffer.from('33'.repeat(32), 'hex');
const NOW = Date.parse('2026-07-25T00:00:00.000Z');
const expected = {
  userId: 'user-1',
  companyId: 'company-1',
  membershipId: 'membership-1',
  requestId: 'request-1',
  toolName: 'inventory.list_low_stock',
};

class FakeReplayStore implements ActorDelegationReplayStore {
  readonly keys = new Set<string>();

  async set(key: string): Promise<'OK' | null> {
    if (this.keys.has(key)) return null;
    this.keys.add(key);
    return 'OK';
  }
}

function service(store: ActorDelegationReplayStore = new FakeReplayStore()): ActorDelegationService {
  const result = new ActorDelegationService({
    aiActorDelegationSigningKey: KEY,
    redisUrl: 'redis://unused',
  } as any);
  result.attachReplayStore(store);
  return result;
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ActorDelegationError && error.code === code;
}

describe('ActorDelegationService', () => {
  it('binds actor, company, membership, request, and tool claims', async () => {
    const delegation = service();
    const token = delegation.issue(expected, NOW);

    for (const mismatch of [
      { ...expected, userId: 'substituted-user' },
      { ...expected, companyId: 'other-company' },
      { ...expected, membershipId: 'other-membership' },
      { ...expected, requestId: 'other-request' },
      { ...expected, toolName: 'ledger.get_financial_summary' },
    ]) {
      await assert.rejects(
        () => delegation.consume(token, mismatch, NOW),
        hasCode('ACTOR_DELEGATION_CONTEXT_MISMATCH'),
      );
    }

    const claims = await delegation.consume(token, expected, NOW);
    assert.equal(claims.sub, expected.userId);
    assert.equal(claims.companyId, expected.companyId);
    assert.equal(claims.membershipId, expected.membershipId);
    assert.equal(claims.requestId, expected.requestId);
    assert.equal(claims.toolName, expected.toolName);
  });

  it('atomically rejects replay of a consumed delegation', async () => {
    const delegation = service();
    const token = delegation.issue(expected, NOW);

    await delegation.consume(token, expected, NOW);
    await assert.rejects(
      () => delegation.consume(token, expected, NOW),
      hasCode('ACTOR_DELEGATION_REPLAYED'),
    );
  });

  it('rejects wrong audience and expired delegations', async () => {
    const delegation = service();
    const iat = Math.floor(NOW / 1000);
    const wrongAudience = signActorDelegationClaims({
      v: 1,
      iss: 'watchdog-api',
      aud: 'other-service',
      workload: 'ai-gateway',
      sub: expected.userId,
      companyId: expected.companyId,
      membershipId: expected.membershipId,
      requestId: expected.requestId,
      toolName: expected.toolName,
      jti: 'wrong-audience',
      iat,
      exp: iat + AI_ACTOR_DELEGATION_TTL_SECONDS,
    }, KEY);

    await assert.rejects(
      () => delegation.consume(wrongAudience, expected, NOW),
      hasCode('ACTOR_DELEGATION_WRONG_AUDIENCE'),
    );

    const expired = delegation.issue(expected, NOW);
    await assert.rejects(
      () => delegation.consume(expired, expected, NOW + AI_ACTOR_DELEGATION_TTL_SECONDS * 1000),
      hasCode('ACTOR_DELEGATION_EXPIRED'),
    );
  });

  it('rejects a token whose signature was changed', async () => {
    const delegation = service();
    const token = delegation.issue(expected, NOW);
    // Tamper the FIRST character of the signature segment: every one of its 6 bits is
    // significant. The last character was flaky — base64url of a 32-byte HMAC leaves it
    // only 4 significant bits, and 'a'/'b' share those, so ~3% of runs the "tampered"
    // token decoded to the identical signature and verified successfully.
    const sigStart = token.lastIndexOf('.') + 1;
    const replacement = token[sigStart] === 'a' ? 'b' : 'a';
    const tampered = `${token.slice(0, sigStart)}${replacement}${token.slice(sigStart + 1)}`;

    await assert.rejects(
      () => delegation.consume(tampered, expected, NOW),
      hasCode('ACTOR_DELEGATION_INVALID_SIGNATURE'),
    );
  });

  it('fails closed when shared replay protection is unavailable', async () => {
    const delegation = service({
      set: async () => {
        throw new Error('redis unavailable');
      },
    });
    await assert.rejects(
      () => delegation.consume(delegation.issue(expected, NOW), expected, NOW),
      hasCode('ACTOR_DELEGATION_REPLAY_STORE_UNAVAILABLE'),
    );
  });
});
