import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { currentLegalRelease } from '../../auth/application/legal-acceptance.service';
import { SubmitLineSignupUseCase } from './submit-line-signup.use-case';

const RELEASE = currentLegalRelease('th');
const LEGAL = { ...RELEASE, locale: 'th' };

const CMD = {
  idToken: 'aaaa.bbbb.cccc',
  companyName: 'ร้านมั่งมี',
  legal: LEGAL,
  userAgent: 'LINE/14 iOS',
  correlationRequestId: 'req-1',
  webBaseUrl: 'https://app.example.com',
  apiBaseUrl: 'https://api.example.com/v1',
};

/** Thursday 10:00 Bangkok — inside the MON-SAT 09:00-18:00 window. */
const NOW = new Date('2026-09-03T10:00:00+07:00');

function harness(options: {
  approvalMode?: 'MANUAL' | 'AUTO_FREE';
  autoDailyCap?: number;
  approvedToday?: number;
  identity?: { userId: string } | null;
  verifyThrows?: Error;
  createThrows?: unknown;
  /** null = a verified token that carries no profile name, which LINE permits. */
  displayName?: string | null;
} = {}) {
  const created: any[] = [];
  const advances: any[] = [];
  const audits: any[] = [];
  const updates: any[] = [];
  const notified: string[] = [];
  const provisioned: any[] = [];
  const userQuotas: string[] = [];

  const prisma = {
    client: {
      externalIdentity: { findFirst: async () => options.identity ?? null },
      companySignupRequest: {
        count: async () => options.approvedToday ?? 0,
        update: async (args: any) => { updates.push(args); return {}; },
      },
      auditLog: { create: async (args: any) => { audits.push(args); return {}; } },
    },
  } as any;

  const config = {
    lineSignupApprovalMode: options.approvalMode ?? 'MANUAL',
    lineSignupAutoDailyCap: options.autoDailyCap ?? 20,
    lineSignupBusinessDays: 'MON-SAT',
    lineSignupBusinessHours: '09:00-18:00',
  } as any;

  const core = {
    receiveNormalized: async (data: any) => {
      if (options.createThrows) throw options.createThrows;
      created.push(data);
      return { id: 'signup-1', ...data };
    },
    advance: async (id: string, state: string) => { advances.push({ id, state }); return {}; },
  } as any;

  const lineIdToken = {
    verify: async () => {
      if (options.verifyThrows) throw options.verifyThrows;
      const displayName = options.displayName === undefined ? 'นิด' : options.displayName;
      return { providerUserId: 'Uline-1', channelId: 'channel-1', ...(displayName ? { displayName } : {}) };
    },
  } as any;

  const rateLimit = {
    assertLineSignupUserAllowed: async (key: string) => { userQuotas.push(key); },
  } as any;
  const adminNotify = { enqueue: async (id: string) => { notified.push(id); } } as any;
  const provision = { execute: async (cmd: any) => { provisioned.push(cmd); return {}; } } as any;

  return {
    useCase: new SubmitLineSignupUseCase(prisma, config, core, lineIdToken, rateLimit, adminNotify, provision),
    created, advances, audits, updates, notified, provisioned, userQuotas,
  };
}

describe('SubmitLineSignupUseCase — identity and clickwrap', () => {
  it('never touches the database when the token does not verify', async () => {
    const h = harness({ verifyThrows: new UnauthorizedException('bad token') });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), UnauthorizedException);
    assert.deepEqual(h.created, []);
    assert.deepEqual(h.userQuotas, [], 'and no quota is spent on a request that proved nothing');
  });

  it('refuses evidence for a release that is no longer current', async () => {
    const h = harness();
    const stale = { ...CMD, legal: { ...LEGAL, statementSha256: 'f'.repeat(64) } };
    await assert.rejects(() => h.useCase.execute(stale, NOW), /legal_release_changed/);
    assert.deepEqual(h.created, [], 'consent to text nobody saw is not consent');
  });

  it('stores every evidence field and stamps the SERVER clock as the acceptance time', async () => {
    const h = harness();
    await h.useCase.execute(CMD, NOW);

    const row = h.created[0];
    assert.equal(row.legalDocumentVersion, RELEASE.documentVersion);
    assert.equal(row.legalStatementSha256, RELEASE.statementSha256);
    assert.equal(row.legalReleaseFingerprintSha256, RELEASE.releaseFingerprintSha256);
    assert.equal(row.legalDisplayChallenge, RELEASE.displayChallenge);
    assert.equal(row.legalLocale, 'th');
    assert.equal(row.legalUserAgent, 'LINE/14 iOS');
    assert.equal(row.legalAcceptedAt.getTime(), NOW.getTime());
    assert.equal(row.consentVersion, RELEASE.documentVersion);
  });

  it('mints the idempotency key from the identity it verified, and keeps no address', async () => {
    const h = harness();
    await h.useCase.execute(CMD, NOW);

    const row = h.created[0];
    assert.match(row.externalSignupId, /^line:channel-1:Uline-1:[0-9a-f-]{36}$/);
    assert.equal(row.source, 'line-oa');
    assert.equal(row.contactEmail, undefined, 'this flow never asks for an address');
    assert.equal(row.lineDisplayName, 'นิด');
    // DATA-MIN-01: display name and typed fields only, never a picture.
    assert.equal(JSON.stringify(row).toLowerCase().includes('picture'), false);
    assert.deepEqual(h.userQuotas, ['Uline-1']);
  });

  it('labels an owner whose LINE token carries no profile name', async () => {
    const h = harness({ displayName: null });
    await h.useCase.execute(CMD, NOW);
    // A neutral label, never an empty string that would render as a blank row in the admin queue.
    assert.equal(h.created[0].ownerDisplayName, 'เจ้าของร้าน');
    assert.equal(h.created[0].lineDisplayName, undefined);
  });

  it('maps the open-application index violation to a conflict the shop owner can act on', async () => {
    const h = harness({ createThrows: Object.assign(new Error('unique'), { code: 'P2002' }) });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /line_signup_already_pending/);
  });

  it('rejects a phone number that is not a Thai mobile, and accepts a blank one', async () => {
    const h = harness();
    await assert.rejects(
      () => h.useCase.execute({ ...CMD, phoneNumber: '12345' }, NOW),
      UnprocessableEntityException,
    );
    await h.useCase.execute({ ...CMD, phoneNumber: '081-234-5678' }, NOW);
    assert.equal(h.created[0].phoneNumber, '0812345678');
    await h.useCase.execute(CMD, NOW);
    assert.equal(h.created[1].phoneNumber, undefined, 'the field is optional by design');
  });
});

describe('SubmitLineSignupUseCase — where the application goes', () => {
  it('MANUAL queues it for an admin and says so', async () => {
    const h = harness();
    const result = await h.useCase.execute(CMD, NOW);

    assert.deepEqual(result, {
      requestId: 'signup-1', state: 'PENDING_REVIEW', existingAccount: false, businessHours: true,
    });
    assert.deepEqual(h.advances, [
      { id: 'signup-1', state: 'VALIDATED' },
      { id: 'signup-1', state: 'PENDING_REVIEW' },
    ]);
    assert.deepEqual(h.notified, ['signup-1']);
    assert.deepEqual(h.provisioned, []);
  });

  it('AUTO_FREE provisions inline and never enters the queue', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE' });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED');
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'VALIDATED' }], 'no PENDING_REVIEW hop');
    assert.deepEqual(h.notified, [], 'and no admin is woken up');
    assert.equal(h.updates[0].data.autoApproved, true);
    assert.equal(h.provisioned[0].requestId, 'signup-1');
    assert.equal(h.audits.at(-1).data.actorRefId, 'line-signup-auto-approve');
  });

  it('falls back to the queue once the daily cap is spent (spec §9 item 3)', async () => {
    const h = harness({ approvalMode: 'AUTO_FREE', autoDailyCap: 20, approvedToday: 20 });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.state, 'PENDING_REVIEW');
    assert.deepEqual(h.provisioned, [], 'the cap is a stop, not a suggestion');
    assert.deepEqual(h.notified, ['signup-1']);
    const capped = h.audits.find((entry: any) => entry.data.action === 'signup.line.auto_approve_capped');
    assert.equal(capped.data.metadataJson.dailyCap, 20);
  });

  it('opens a second shop on the account this LINE user already owns', async () => {
    const h = harness({ identity: { userId: 'user-9' } });
    const result = await h.useCase.execute(CMD, NOW);

    assert.equal(result.existingAccount, true);
    assert.equal(h.created[0].attachUserId, 'user-9');
  });

  it('tells the LIFF page which waiting message to show', async () => {
    const inHours = await harness().useCase.execute(CMD, NOW);
    assert.equal(inHours.businessHours, true);
    // Sunday: the office is shut, so the page promises the next business day instead.
    const sunday = await harness().useCase.execute(CMD, new Date('2026-09-06T10:00:00+07:00'));
    assert.equal(sunday.businessHours, false);
  });

  it('keeps applicant text out of the audit trail', async () => {
    const h = harness({ identity: { userId: 'user-9' } });
    await h.useCase.execute({ ...CMD, phoneNumber: '0812345678' }, NOW);

    const evidence = JSON.stringify(h.audits);
    for (const pii of ['ร้านมั่งมี', '0812345678', 'Uline-1', 'นิด']) {
      assert.equal(evidence.includes(pii), false, `audit leaked ${pii}`);
    }
    assert.equal(h.audits[0].data.action, 'signup.line.submitted');
    assert.equal(h.audits[0].data.metadataJson.existingAccount, true);
  });
});

describe('SubmitLineSignupUseCase — conflicts are exceptions, not silent successes', () => {
  it('surfaces a non-unique database error unchanged', async () => {
    const h = harness({ createThrows: new Error('connection reset') });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), /connection reset/);
  });

  it('never returns a ConflictException as a state', async () => {
    const h = harness({ createThrows: Object.assign(new Error('unique'), { code: 'P2002' }) });
    await assert.rejects(() => h.useCase.execute(CMD, NOW), ConflictException);
  });
});
