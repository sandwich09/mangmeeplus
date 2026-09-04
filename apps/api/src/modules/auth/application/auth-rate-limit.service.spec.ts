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
  it('caps applications per LINE account at three, independently of the caller IP', async () => {
    const service = makeService();
    for (let attempt = 0; attempt < 3; attempt += 1) await service.assertLineSignupUserAllowed('Uline-1');
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

  it('fails closed when the counter store is unreachable', async () => {
    const service = new AuthRateLimitService(
      config,
      // A store that cannot answer: the default policy must refuse rather than wave it through.
      { consume: async () => { throw new Error('redis down'); } } as never,
    );
    await assert.rejects(service.assertLineSignupUserAllowed('Uline-1'));
    await assert.rejects(service.assertLineSignupIpAllowed('1.1.1.1'));
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
