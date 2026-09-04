import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SignupAdminQueueUseCase } from './signup-admin-queue.use-case';

const NOW = new Date('2026-09-01T00:00:00.000Z');

const REQUEST = {
  id: 'signup-1',
  state: 'PENDING_REVIEW',
  companyName: 'ร้านมั่งมี',
  ownerDisplayName: 'สมชาย ใจดี',
  contactEmail: 'somchai@example.com',
  phoneNumber: '0982565628',
  businessType: 'ร้านค้าปลีก',
  vatRegistered: false,
  taxId: '0105555000012',
  requestedOfferKey: 'PRO_TRIAL',
  mxValid: true,
  createdAt: new Date('2026-08-25T00:00:00.000Z'),
  approvedAt: null as Date | null,
  claimEmailLastSentAt: null as Date | null,
  pendingPasswordHash: 'scrypt$salt$hash',
};

function harness(options: { request?: any; requests?: any[]; users?: any[]; companies?: any[] } = {}) {
  const audits: any[] = [];
  const updates: any[] = [];
  const advances: any[] = [];
  const enqueued: any[] = [];
  const revoked: string[] = [];
  const userQueries: any[] = [];
  const provisioned: any[] = [];

  const prisma = {
    client: {
      companySignupRequest: {
        findUnique: async () => (options.request === undefined ? { ...REQUEST } : options.request),
        findMany: async () => options.requests ?? [],
        update: async (args: any) => { updates.push(args); return {}; },
      },
      user: { findMany: async (args: any) => { userQueries.push(args); return options.users ?? []; } },
      company: { findMany: async () => options.companies ?? [] },
      auditLog: { create: async (args: any) => { audits.push(args); return {}; } },
    },
  } as any;

  const core = {
    advance: async (id: string, state: string, _corr: string, failureCode?: string) => {
      advances.push({ id, state, ...(failureCode ? { failureCode } : {}) });
      return {};
    },
  } as any;
  const tokens = { revokeAll: async (id: string) => { revoked.push(id); return 2; } } as any;
  const claimEmail = {
    enqueue: async (id: string, reason: string) => { enqueued.push({ id, reason }); },
    enqueueRejectionNotice: async (id: string, rejectionReason?: string) => {
      enqueued.push({ id, reason: 'rejection-notice', rejectionReason });
    },
  } as any;

  const provision = { execute: async (cmd: any) => { provisioned.push(cmd); return {}; } } as any;

  return {
    useCase: new SignupAdminQueueUseCase(prisma, core, tokens, claimEmail, provision),
    audits, updates, advances, enqueued, revoked, userQueries, provisioned,
  };
}

describe('SignupAdminQueueUseCase.list', () => {
  it('surfaces dedupe hints without deciding anything', async () => {
    const h = harness({
      requests: [{ ...REQUEST, approvedAt: new Date('2026-08-20T00:00:00.000Z'), state: 'EMAIL_PENDING' }],
      users: [{ email: 'somchai@example.com' }],
      companies: [{ taxId: '0105555000012', name: 'ร้านเดิม' }],
    });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items.length, 1);
    assert.equal(items[0]!.emailMatchesExistingUser, true);
    assert.equal(items[0]!.taxIdMatchesCompanyName, 'ร้านเดิม');
    assert.equal(items[0]!.daysSinceApproval, 12);
    assert.equal(items[0]!.emailDeliveryFailed, false);
    assert.equal(items[0]!.mxValid, true);
  });

  it('flags a bounced email and omits hints that do not apply', async () => {
    const h = harness({ requests: [{ ...REQUEST, state: 'EMAIL_FAILED', taxId: null }] });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items[0]!.emailDeliveryFailed, true);
    assert.equal(items[0]!.emailMatchesExistingUser, false);
    assert.equal(items[0]!.taxIdMatchesCompanyName, undefined);
    assert.equal(items[0]!.daysSinceApproval, undefined);
  });

  it('never leaks the stored password hash into the queue payload', async () => {
    const h = harness({ requests: [{ ...REQUEST }] });
    const { items } = await h.useCase.list(NOW);
    assert.equal(JSON.stringify(items).includes('scrypt$'), false);
  });

  // Review B-03: the LINE source has no address at all. `in: [null]` is not a query Prisma accepts,
  // and a blank string in the DTO would read to an operator as "we have an address, it is empty".
  it('lists an addressless LINE application without querying a null email', async () => {
    const h = harness({
      requests: [
        { ...REQUEST, id: 'signup-line', source: 'line-oa', contactEmail: null, mxValid: null, taxId: null },
        { ...REQUEST },
      ],
    });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items.length, 2);
    assert.equal(items[0]!.contactEmail, undefined);
    assert.equal(items[0]!.emailMatchesExistingUser, false);
    assert.deepEqual(h.userQueries[0].where.email.in, ['somchai@example.com']);
  });
});

// P10-L §5/§8. What "approve" MEANS depends on the source: the web form still has a mailbox to
// prove, a LINE application proved its human at submit and goes straight to provisioning.
const LINE_REQUEST = {
  ...REQUEST,
  source: 'line-oa',
  contactEmail: null,
  mxValid: null,
  taxId: null,
  pendingPasswordHash: null,
  lineDisplayName: 'นิด',
  autoApproved: false,
  legalAcceptedAt: new Date('2026-08-31T04:00:00.000Z'),
};
const URLS = { webBaseUrl: 'https://app.example.com', apiBaseUrl: 'https://api.example.com/v1' };

describe('SignupAdminQueueUseCase.decide — LINE-first source', () => {
  it('provisions on approval instead of queueing a claim email nobody can receive', async () => {
    const h = harness({ request: LINE_REQUEST });
    const result = await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1', URLS);

    assert.deepEqual(result, { requestId: 'signup-1', state: 'COMPLETED' });
    assert.deepEqual(h.enqueued, [], 'no letter is queued for an application with no address');
    assert.deepEqual(h.advances, [], 'provisioning owns the PROVISIONING transition, not advance');
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    // The stamp lands before provisioning, which reads it as the actor for what it creates.
    assert.equal(h.updates[0].data.approvedByUserId, 'admin-1');
  });

  it('refuses to provision without the bases the owner handoff needs', async () => {
    const h = harness({ request: LINE_REQUEST });
    await assert.rejects(
      () => h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1'),
      /signup_provisioning_urls_required/,
    );
    assert.deepEqual(h.provisioned, []);
  });

  it('treats a second tap on an already-provisioned application as a no-op', async () => {
    for (const state of ['PROVISIONING', 'READY', 'COMPLETED']) {
      const h = harness({ request: { ...LINE_REQUEST, state } });
      const result = await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1', URLS);
      assert.equal(result.state, state);
      assert.deepEqual(h.provisioned, [], `${state} must not provision twice`);
    }
  });

  it('rejects without queueing a letter to an address that does not exist', async () => {
    const h = harness({ request: LINE_REQUEST });
    const result = await h.useCase.decide(
      'signup-1', { action: 'REJECT', notifyApplicant: true }, 'admin-1', 'req-1', URLS,
    );

    assert.equal(result.state, 'REJECTED');
    assert.deepEqual(h.enqueued, [], 'the LINE rejection is a push, sent by the messaging slice');
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'REJECTED' }]);
  });

  it('shows the operator which source a row came from', async () => {
    const h = harness({ requests: [LINE_REQUEST] });
    const { items } = await h.useCase.list(NOW);

    assert.equal(items[0]!.source, 'line-oa');
    assert.equal(items[0]!.lineDisplayName, 'นิด');
    assert.equal(items[0]!.legalAcceptedAt, '2026-08-31T04:00:00.000Z');
    assert.equal(items[0]!.contactEmail, undefined);
  });
});

describe('SignupAdminQueueUseCase.decide — suspend', () => {
  it('stops an auto-approved shop after the fact and revokes anything outstanding', async () => {
    const h = harness({ request: { ...LINE_REQUEST, state: 'COMPLETED', autoApproved: true } });
    const result = await h.useCase.decide('signup-1', { action: 'SUSPEND' }, 'admin-1', 'req-1', URLS);

    assert.deepEqual(result, { requestId: 'signup-1', state: 'SUSPENDED' });
    // A failure state needs a reason code, and the reason is that an admin said so.
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'SUSPENDED', failureCode: 'admin_suspended' }]);
    assert.deepEqual(h.revoked, ['signup-1']);
    assert.equal(h.updates[0].data.pendingPasswordHash, null);
    const audit = h.audits[0].data;
    assert.equal(audit.action, 'signup.line.suspended');
    assert.equal(audit.metadataJson.wasAutoApproved, true);
    assert.equal(audit.metadataJson.fromState, 'COMPLETED');
  });

  it('is a no-op when the application is already suspended', async () => {
    const h = harness({ request: { ...LINE_REQUEST, state: 'SUSPENDED' } });
    const result = await h.useCase.decide('signup-1', { action: 'SUSPEND' }, 'admin-1', 'req-1', URLS);

    assert.equal(result.state, 'SUSPENDED');
    assert.deepEqual(h.advances, []);
    assert.deepEqual(h.audits, []);
  });
});

describe('SignupAdminQueueUseCase.listAutoApproved', () => {
  it('shows what the machine let through, without inventing dedupe hints for it', async () => {
    const h = harness({ requests: [{ ...LINE_REQUEST, state: 'COMPLETED', autoApproved: true }] });
    const { items } = await h.useCase.listAutoApproved(14, NOW);

    assert.equal(items.length, 1);
    assert.equal(items[0]!.autoApproved, true);
    // These rows are settled, so the queue's "is this a duplicate" hints do not apply.
    assert.equal(items[0]!.emailMatchesExistingUser, false);
    assert.equal(items[0]!.taxIdMatchesCompanyName, undefined);
  });
});

describe('SignupAdminQueueUseCase.decide — approve', () => {
  it('approves once, records the approver, and queues exactly one email', async () => {
    const h = harness();
    const result = await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1');

    assert.deepEqual(result, { requestId: 'signup-1', state: 'EMAIL_PENDING' });
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'EMAIL_PENDING' }]);
    assert.equal(h.updates[0].data.approvedByUserId, 'admin-1');
    assert.ok(h.updates[0].data.approvedAt instanceof Date);
    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'approve' }]);
  });

  it('is a no-op when the application is already approved', async () => {
    const h = harness({ request: { ...REQUEST, state: 'EMAIL_PENDING' } });
    const result = await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-2');

    assert.equal(result.state, 'EMAIL_PENDING');
    // No second transition, no second approver stamp, and above all no second email.
    assert.deepEqual(h.advances, []);
    assert.deepEqual(h.enqueued, []);
    assert.deepEqual(h.audits, []);
  });

  it('refuses to approve an application that is past review', async () => {
    for (const state of ['REJECTED', 'COMPLETED', 'READY']) {
      const h = harness({ request: { ...REQUEST, state } });
      await assert.rejects(
        () => h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-3'),
        ConflictException,
      );
      assert.deepEqual(h.enqueued, []);
    }
  });

  it('writes a HIGH audit row with booleans only', async () => {
    const h = harness();
    await h.useCase.decide('signup-1', { action: 'APPROVE' }, 'admin-1', 'req-1');

    const audit = h.audits[0].data;
    assert.equal(audit.action, 'signup.request.approved');
    assert.equal(audit.riskLevel, 'HIGH');
    assert.equal(audit.actorUserId, 'admin-1');
    assert.equal(audit.targetId, 'signup-1');
    assert.deepEqual(audit.metadataJson, { hadTaxId: true, mxValid: true });
    // Applicant PII must never reach evidence.
    const evidence = JSON.stringify(h.audits);
    for (const pii of ['somchai@example.com', 'ร้านมั่งมี', '0105555000012', '0982565628']) {
      assert.equal(evidence.includes(pii), false, `audit leaked ${pii}`);
    }
  });
});

describe('SignupAdminQueueUseCase.decide — reject', () => {
  it('is silent by default and destroys the pending credential material', async () => {
    const h = harness();
    const result = await h.useCase.decide('signup-1', { action: 'REJECT' }, 'admin-1', 'req-1');

    assert.equal(result.state, 'REJECTED');
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'REJECTED' }]);
    assert.equal(h.updates[0].data.pendingPasswordHash, null);
    assert.deepEqual(h.revoked, ['signup-1']);
    // The address is unverified, so no unsolicited mail leaves by default.
    assert.deepEqual(h.enqueued, []);
    assert.deepEqual(h.audits[0].data.metadataJson, { notifyApplicant: false, hadRejectionReason: false });
  });

  it('ignores a reason the admin typed and then unticked the notice for', async () => {
    const h = harness();
    await h.useCase.decide(
      'signup-1', { action: 'REJECT', rejectionReason: 'ข้อมูลไม่ครบ' }, 'admin-1', 'req-1',
    );
    assert.deepEqual(h.enqueued, [], 'a reason alone must not turn a silent reject into an email');
  });

  it('sends a notice only when the admin asks for one', async () => {
    const h = harness();
    await h.useCase.decide('signup-1', { action: 'REJECT', notifyApplicant: true }, 'admin-1', 'req-1');
    assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'rejection-notice', rejectionReason: undefined }]);
    assert.deepEqual(h.audits[0].data.metadataJson, { notifyApplicant: true, hadRejectionReason: false });
  });

  it('passes the admin paragraph through and records only that one existed', async () => {
    const h = harness();
    await h.useCase.decide(
      'signup-1', { action: 'REJECT', notifyApplicant: true, rejectionReason: 'ข้อมูลบริษัทไม่ครบ' },
      'admin-1', 'req-1',
    );
    assert.deepEqual(h.enqueued, [
      { id: 'signup-1', reason: 'rejection-notice', rejectionReason: 'ข้อมูลบริษัทไม่ครบ' },
    ]);
    assert.deepEqual(h.audits[0].data.metadataJson, { notifyApplicant: true, hadRejectionReason: true });
    // Copy written for one inbox is not an audit fact.
    assert.equal(JSON.stringify(h.audits).includes('ข้อมูลบริษัทไม่ครบ'), false);
  });

  it('is idempotent on repeat', async () => {
    const h = harness({ request: { ...REQUEST, state: 'REJECTED' } });
    const result = await h.useCase.decide('signup-1', { action: 'REJECT' }, 'admin-1', 'req-2');
    assert.equal(result.state, 'REJECTED');
    assert.deepEqual(h.advances, []);
    assert.deepEqual(h.audits, []);
  });
});

describe('SignupAdminQueueUseCase.reissue', () => {
  it('revives an application at any age — there is no dead end', async () => {
    for (const state of ['EMAIL_PENDING', 'EMAIL_FAILED', 'EXPIRED']) {
      // Approved two years ago: still reissuable, because the applicant already applied.
      const h = harness({ request: { ...REQUEST, state, approvedAt: new Date('2024-01-01T00:00:00.000Z') } });
      const result = await h.useCase.reissue('signup-1', 'admin-1', 'req-1');

      assert.deepEqual(result, { requestId: 'signup-1', state: 'EMAIL_PENDING', claimEmailQueued: true });
      assert.deepEqual(h.revoked, ['signup-1'], 'old links must die before a new one is sent');
      assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'EMAIL_PENDING' }]);
      assert.deepEqual(h.enqueued, [{ id: 'signup-1', reason: 'reissue' }]);
      // A fresh link earns a fresh reminder.
      assert.equal(h.updates[0].data.claimReminderSentAt, null);
      assert.equal(h.audits[0].data.riskLevel, 'HIGH');
      assert.deepEqual(h.audits[0].data.metadataJson, { fromState: state, revokedTokenCount: 2 });
    }
  });

  it('refuses states where a claim link would make no sense', async () => {
    for (const state of ['PENDING_REVIEW', 'REJECTED', 'COMPLETED', 'READY']) {
      const h = harness({ request: { ...REQUEST, state } });
      await assert.rejects(() => h.useCase.reissue('signup-1', 'admin-1', 'req-1'), ConflictException);
      assert.deepEqual(h.enqueued, []);
    }
  });

  it('404s an unknown application', async () => {
    const h = harness({ request: null });
    await assert.rejects(() => h.useCase.reissue('nope', 'admin-1', 'req-1'), NotFoundException);
    await assert.rejects(() => h.useCase.decide('nope', { action: 'APPROVE' }, 'admin-1', 'req-1'), NotFoundException);
  });
});
