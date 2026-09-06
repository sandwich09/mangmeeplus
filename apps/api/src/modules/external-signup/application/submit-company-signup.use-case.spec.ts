import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { SubmitCompanySignupUseCase } from './submit-company-signup.use-case';
import type { CompanySignupInput } from '../domain/company-signup.logic';

const INPUT: CompanySignupInput = {
  externalSignupId: '0f9b1d2e-3c4a-4b5c-8d7e-1f2a3b4c5d6e',
  companyName: 'ร้านมั่งมี',
  ownerFirstName: 'สมชาย',
  ownerLastName: 'ใจดี',
  contactEmail: 'somchai@example.com',
  consentVersion: 'v1',
};

function harness(options: {
  replayed?: boolean;
  state?: string;
  mx?: 'ok' | 'empty' | 'nxdomain' | 'nodata' | 'servfail' | 'refused' | 'hangs';
} = {}) {
  const updates: any[] = [];
  const advances: any[] = [];
  const lookups: string[] = [];
  const announced: string[] = [];

  const prisma = {
    client: { companySignupRequest: { update: async (args: any) => { updates.push(args); return {}; } } },
  } as any;

  const core = {
    receive: async () => ({
      request: { id: 'signup-1', state: options.state ?? 'RECEIVED', contactEmail: INPUT.contactEmail },
      replayed: options.replayed ?? false,
    }),
    advance: async (id: string, state: string) => { advances.push({ id, state }); return {}; },
  } as any;

  // Real `dns.resolveMx` rejections carry a `code`; that code is the whole difference between
  // "this domain takes no mail" and "we could not ask".
  const dnsError = (code: string) => Object.assign(new Error(`queryMx ${code} example.com`), { code });
  const mxResolver = async (domain: string) => {
    lookups.push(domain);
    if (options.mx === 'nxdomain') throw dnsError('ENOTFOUND');
    if (options.mx === 'nodata') throw dnsError('ENODATA');
    if (options.mx === 'servfail') throw dnsError('ESERVFAIL');
    if (options.mx === 'refused') throw dnsError('ECONNREFUSED');
    if (options.mx === 'empty') return [];
    if (options.mx === 'hangs') return new Promise<unknown[]>(() => {});
    return [{ exchange: 'mx.example.com', priority: 10 }];
  };

  // Item 1: the admin announcement is one outbox append, so a dead LINE OA cannot fail a submit.
  const adminNotify = { enqueue: async (id: string) => { announced.push(id); } } as any;

  return {
    useCase: new SubmitCompanySignupUseCase(prisma, core, adminNotify, mxResolver),
    updates, advances, lookups, announced,
  };
}

describe('SubmitCompanySignupUseCase', () => {
  it('validates, checks MX, and queues the application for review', async () => {
    const h = harness();
    const result = await h.useCase.execute(INPUT, 'req-1');

    assert.deepEqual(result, { requestId: 'signup-1' });
    assert.deepEqual(h.lookups, ['example.com']);
    assert.equal(h.updates[0].data.mxValid, true);
    // Flow B: straight into the admin queue, and no email goes out on this path.
    assert.deepEqual(h.advances, [
      { id: 'signup-1', state: 'VALIDATED' },
      { id: 'signup-1', state: 'PENDING_REVIEW' },
    ]);
    // Spec §4C: reaching the queue is what the operators have to hear about.
    assert.deepEqual(h.announced, ['signup-1']);
  });

  it('rejects a domain that accepts no mail, and queues nothing', async () => {
    for (const mx of ['empty', 'nxdomain', 'nodata'] as const) {
      const h = harness({ mx });
      await assert.rejects(
        () => h.useCase.execute(INPUT, 'req-1'),
        (error: unknown) => error instanceof UnprocessableEntityException
          && (error as UnprocessableEntityException).message === 'email_domain_has_no_mx',
      );
      // The failed check is recorded, but the application never reaches an admin.
      assert.equal(h.updates[0].data.mxValid, false);
      assert.deepEqual(h.advances, []);
      assert.deepEqual(h.announced, [], 'nothing reached an admin, so nobody is told');
    }
  });

  // F6. A resolver that cannot answer says NOTHING about the address. Treating a timeout or a
  // SERVFAIL as "no MX" accused a correct address of a typo, and — because the page rotates its
  // idempotency key on a definite rejection — left an orphan RECEIVED row holding the applicant's
  // name, email and phone behind every DNS blip.
  it('separates a domain that takes no mail from a lookup that could not answer', async () => {
    for (const mx of ['servfail', 'refused', 'hangs'] as const) {
      const h = harness({ mx });
      await assert.rejects(
        () => h.useCase.execute(INPUT, 'req-1'),
        (error: unknown) => error instanceof ServiceUnavailableException
          && (error as ServiceUnavailableException).message === 'email_domain_check_unavailable',
        mx,
      );
      // Nothing is recorded about the domain: we did not learn anything about it.
      assert.deepEqual(h.updates, [], mx);
      assert.deepEqual(h.advances, [], mx);
      assert.deepEqual(h.announced, [], mx);
    }
  });

  it('does not let a hung resolver hold the form open', async () => {
    const h = harness({ mx: 'hangs' });
    const started = Date.now();
    await assert.rejects(() => h.useCase.execute(INPUT, 'req-1'), ServiceUnavailableException);
    // The 3s timeout fires; without it this would never settle.
    assert.ok(Date.now() - started < 10_000);
  });

  it('returns the same id for a replay without re-validating', async () => {
    const h = harness({ replayed: true, state: 'PENDING_REVIEW' });
    const result = await h.useCase.execute(INPUT, 'req-2');

    assert.deepEqual(result, { requestId: 'signup-1' });
    // A retry of an already-queued application does no DNS lookup and writes no new evidence: the
    // PENDING_REVIEW advance takes the core's replay branch.
    assert.deepEqual(h.lookups, []);
    assert.deepEqual(h.updates, []);
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'PENDING_REVIEW' }]);
    // R08: the announcement IS re-queued, because its outbox key is the request id — that is what
    // repairs an append the first attempt lost, and duplication is impossible by the key.
    assert.deepEqual(h.announced, ['signup-1']);
  });

  it('leaves an application an admin has already decided alone', async () => {
    const h = harness({ replayed: true, state: 'EMAIL_PENDING' });
    await h.useCase.execute(INPUT, 'req-late');

    assert.deepEqual(h.lookups, []);
    assert.deepEqual(h.advances, []);
    assert.deepEqual(h.announced, [], 'an approved application must never be re-announced');
  });

  it('carries a replay stranded at VALIDATED into the queue', async () => {
    // The first attempt died between VALIDATED and PENDING_REVIEW, so no admin ever saw the row.
    const h = harness({ replayed: true, state: 'VALIDATED' });
    await h.useCase.execute(INPUT, 'req-resume');

    assert.deepEqual(h.lookups, [], 'MX already passed — that is what VALIDATED means');
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'PENDING_REVIEW' }]);
    assert.deepEqual(h.announced, ['signup-1']);
  });

  it('finishes a replay that never got past RECEIVED', async () => {
    // The first attempt died after the row was written but before validation ran.
    const h = harness({ replayed: true, state: 'RECEIVED' });
    await h.useCase.execute(INPUT, 'req-3');
    assert.deepEqual(h.advances, [
      { id: 'signup-1', state: 'VALIDATED' },
      { id: 'signup-1', state: 'PENDING_REVIEW' },
    ]);
  });
});
