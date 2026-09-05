import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';

const config = {
  passwordLoginMaxPerIdentifier: 2,
  passwordLoginMaxPerIp: 3,
  passwordLoginWindowSeconds: 900,
  customerRegisterMaxPerIpChannel: 2,
  customerRegisterWindowSeconds: 900,
} as never;

function makeService(): AuthRateLimitService {
  return new AuthRateLimitService(
    config,
    new RedisRateLimitService({ redisUrl: '', isProduction: false } as never),
  );
}

describe('AuthRateLimitService password login', () => {
  it('blocks an identifier+IP pair after too many recorded failures (case-insensitive)', async () => {
    const service = makeService();
    await service.assertPasswordLoginAllowed('Napa', '1.1.1.1');
    await service.recordPasswordLoginFailure('napa', '1.1.1.1');
    await service.assertPasswordLoginAllowed('NAPA', '1.1.1.1');
    await service.recordPasswordLoginFailure('napa', '1.1.1.1');
    await assert.rejects(service.assertPasswordLoginAllowed('napa', '1.1.1.1'), /Too many requests/);
    await service.assertPasswordLoginAllowed('napa', '2.2.2.2');
  });

  it('successful attempts consume no quota', async () => {
    const service = makeService();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await service.assertPasswordLoginAllowed('napa', '1.1.1.1');
    }
  });

  it('caps failures per IP across different identifiers', async () => {
    const service = makeService();
    await service.recordPasswordLoginFailure('a', '9.9.9.9');
    await service.recordPasswordLoginFailure('b', '9.9.9.9');
    await service.recordPasswordLoginFailure('c', '9.9.9.9');
    await assert.rejects(service.assertPasswordLoginAllowed('d', '9.9.9.9'), /Too many requests/);
    await service.assertPasswordLoginAllowed('d', '8.8.8.8');
  });
});

// P10-L §9 / review SEC-02: the new buckets must inherit the default fail-closed policy — none of
// them may quietly opt into `degrade-to-local`, which only the blunt global IP bucket is allowed.
describe('AuthRateLimitService LINE-first signup buckets', () => {
  // Review MEDIUM-1: this bucket CHECKS but does not spend, exactly like the login buckets. Three
  // shops a day is generous; three typos in one sitting must not cost a customer their whole day.
  it('caps applications per LINE account at three, counting only the ones that got created', async () => {
    const service = makeService();
    // A rejected submit checks and moves on, however many times.
    for (let attempt = 0; attempt < 10; attempt += 1) await service.assertLineSignupUserAllowed('Uline-1');

    for (let created = 0; created < 3; created += 1) {
      await service.assertLineSignupUserAllowed('Uline-1');
      await service.recordLineSignupUser('Uline-1');
    }
    await assert.rejects(service.assertLineSignupUserAllowed('Uline-1'), /Too many requests/);
    // Another LINE account behind the same NAT is untouched.
    await service.assertLineSignupUserAllowed('Uline-2');
  });

  it('keeps a separate quota per IP, per read and per session exchange', async () => {
    const service = makeService();
    for (let attempt = 0; attempt < 20; attempt += 1) await service.assertLineSignupIpAllowed('1.1.1.1');
    await assert.rejects(service.assertLineSignupIpAllowed('1.1.1.1'), /Too many requests/);
    // Spending the submit bucket must not close the door on reading a status or opening a session.
    await service.assertLineSignupReadAllowed('1.1.1.1');
    await service.assertLineLiffSessionAllowed('Uline-1');
    await service.assertLineSignupIpAllowed('2.2.2.2');
  });

  // Review L-4: the creation bucket deliberately ignores failures, so something has to bound what
  // an account that never succeeds can cost. Separate quota, so a customer fixing a form is fine.
  it('caps attempts per LINE account independently of the creation quota', async () => {
    const service = makeService();
    for (let attempt = 0; attempt < 20; attempt += 1) await service.assertLineSignupAttemptAllowed('Uline-1');
    await assert.rejects(service.assertLineSignupAttemptAllowed('Uline-1'), /Too many requests/);
    // Twenty attempts have not touched the three-a-day creation quota.
    await service.assertLineSignupUserAllowed('Uline-1');
    await service.assertLineSignupAttemptAllowed('Uline-2');
  });

  // Review LOW-4: reading a status must never cost a customer the ability to apply.
  it('keeps status reads on their own quota, away from the submit buckets', async () => {
    const service = makeService();
    for (let read = 0; read < 60; read += 1) await service.assertLineSignupReadUserAllowed('Uline-1');
    await assert.rejects(service.assertLineSignupReadUserAllowed('Uline-1'), /Too many requests/);
    // Sixty reads have spent neither the attempt nor the creation quota.
    await service.assertLineSignupAttemptAllowed('Uline-1');
    await service.assertLineSignupUserAllowed('Uline-1');
  });

  it('fails closed when the counter store is unreachable', async () => {
    const service = new AuthRateLimitService(
      config,
      // A store that cannot answer: the default policy must refuse rather than wave it through.
      { consume: async () => { throw new Error('redis down'); } } as never,
    );
    await assert.rejects(service.assertLineSignupUserAllowed('Uline-1'));
    await assert.rejects(service.assertLineSignupIpAllowed('1.1.1.1'));
    await assert.rejects(service.assertLineSignupAttemptAllowed('Uline-1'));
    await assert.rejects(service.assertLineSignupReadUserAllowed('Uline-1'));
  });
});

/**
 * The support floor is the ONE bucket in this family that may not fail closed, and no non-production
 * environment can show it: outside production every policy already degrades, so a `fail-closed`
 * support bucket looks perfect in UAT and, the first time Redis blinks in production, throws
 * `ServiceUnavailableException` out of `handleStaffContact` — no row, no notice, no reply, on a
 * webhook event already claimed and therefore never redelivered. That is the E1 silence this whole
 * branch exists to remove, reintroduced by its own abuse control.
 *
 * So the store here is real, configured with PRODUCTION semantics, and cannot answer.
 */
describe('AuthRateLimitService support-request floor under a production store failure', () => {
  const brokenProductionStore = () => {
    const store = new RedisRateLimitService({ redisUrl: 'redis://unused', isProduction: true } as never);
    const down = async () => { throw new Error('redis down'); };
    (store as unknown as { client: unknown }).client = { eval: down, get: down, ttl: down };
    return store;
  };

  it('keeps answering, and still bounds the day to three, when Redis is down in production', async () => {
    const service = new AuthRateLimitService(config, brokenProductionStore());

    // The control: a cost-bearing bucket on the same broken store still refuses, which is what
    // proves production semantics are genuinely in force here rather than quietly degraded.
    await assert.rejects(service.assertLineSignupUserAllowed('Uline-1'), /unavailable/i);

    for (let ask = 0; ask < 3; ask += 1) {
      assert.equal(await service.consumeLineSupportRequestSlot('Uline-1'), true, `ask ${ask + 1} reaches a human`);
    }
    // Degraded is not unlimited: the limit still applies, per task instead of per fleet.
    assert.equal(await service.consumeLineSupportRequestSlot('Uline-1'), false);
    assert.equal(await service.consumeLineSupportRequestSlot('Uline-2'), true, 'and it is still per person');
  });

  it('bounds the day to three on a healthy store too', async () => {
    const service = makeService();
    for (let ask = 0; ask < 3; ask += 1) {
      assert.equal(await service.consumeLineSupportRequestSlot('Uline-1'), true);
    }
    assert.equal(await service.consumeLineSupportRequestSlot('Uline-1'), false);
    assert.equal(await service.consumeLineSupportRequestSlot('Uline-2'), true);
  });
});

describe('AuthRateLimitService customer register', () => {
  it('blocks by IP plus LINE channel after the configured limit', async () => {
    const service = makeService();
    await service.assertCustomerRegisterAllowed('1.1.1.1', 'line-ch-1');
    await service.assertCustomerRegisterAllowed('1.1.1.1', 'line-ch-1');
    await assert.rejects(service.assertCustomerRegisterAllowed('1.1.1.1', 'line-ch-1'), /Too many requests/);
    await service.assertCustomerRegisterAllowed('1.1.1.1', 'line-ch-2');
    await service.assertCustomerRegisterAllowed('2.2.2.2', 'line-ch-1');
  });
});
