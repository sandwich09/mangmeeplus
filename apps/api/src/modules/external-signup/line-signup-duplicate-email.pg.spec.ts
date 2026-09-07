/** Duplicate-email routing uses committed PostgreSQL evidence, never email ownership proof. */
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConflictException } from '@nestjs/common';
import { PrismaClient, type CompanySignupState } from '../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import { currentLegalRelease, LegalAcceptanceService } from '../auth/application/legal-acceptance.service';
import { CreateCompanyOnboardingUseCase } from '../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { CompanySignupCoreService } from './application/company-signup-core.service';
import { ProvisionSignupUseCase } from './application/provision-signup.use-case';
import { SignupAdminQueueUseCase } from './application/signup-admin-queue.use-case';
import { SubmitLineSignupUseCase } from './application/submit-line-signup.use-case';

const databaseUrl = process.env.LINE_SIGNUP_TEST_DATABASE_URL;
if (process.env.LINE_SIGNUP_REQUIRE_POSTGRES === 'true') assert.ok(databaseUrl, 'LINE_SIGNUP_TEST_DATABASE_URL is required');
const URLS = { webBaseUrl: 'https://app.example.test', apiBaseUrl: 'https://api.example.test/v1' };

function connect(): PrismaClient {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only a local disposable database is allowed');
  assert.equal(url.pathname, '/watchdog_bms', 'never write to a forwarded customer database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
}

function wire(client: PrismaClient, tag: string, lineUserId: string) {
  const prisma = { client } as any;
  const config = {
    credentialEncryptionKey: Buffer.alloc(32, 7), lineSignupApprovalMode: 'AUTO_FREE',
    lineSignupAutoDailyCap: 100_000, lineSignupWarmupSlips: 15, lineFreeAiBudgetSatang: 8000,
    lineSignupBusinessDays: 'MON-SAT', lineSignupBusinessHours: '09:00-18:00',
  } as any;
  const core = new CompanySignupCoreService(prisma);
  const legal = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);
  const onboarding = new CreateCompanyOnboardingUseCase(prisma, config, legal);
  const notifications: string[] = [];
  let operatorLookups = 0, provisionCalls = 0;
  const directory = {
    activeSystemAdmins: async () => { operatorLookups += 1; return [{ companyId: 'system', userId: `${tag}-admin` }]; },
    enqueue: async (id: string) => { notifications.push(id); },
  } as any;
  const lineNotify = { enqueue: async () => undefined } as any;
  const opsAlerts = { raise: async () => undefined } as any;
  const provision = new ProvisionSignupUseCase(prisma, core, onboarding, config, directory, lineNotify, opsAlerts);
  const executeProvision = provision.execute.bind(provision);
  provision.execute = async (...args) => { provisionCalls += 1; return executeProvision(...args); };
  const rateLimit = {
    assertLineSignupAttemptAllowed: async () => undefined, assertLineSignupUserAllowed: async () => undefined,
    recordLineSignupUser: async () => undefined,
  } as any;
  const submit = new SubmitLineSignupUseCase(prisma, config, core, {
    verify: async () => ({ providerUserId: lineUserId, channelId: tag, displayName: 'เจ้าของร้านทดสอบ' }),
  } as any, rateLimit, directory, provision, opsAlerts);
  const queue = new SignupAdminQueueUseCase(prisma, core, { revokeAll: async () => 0 } as any, {
    enqueue: async () => { throw new Error('LINE signup must not send claim email'); },
    enqueueRejectionNotice: async () => { throw new Error('unexpected mailbox notification'); },
  } as any, provision, lineNotify);
  return { submit, core, queue, notifications, get operatorLookups() { return operatorLookups; }, get provisionCalls() { return provisionCalls; } };
}

function command(tag: string, email: string, suffix = 'new') {
  return {
    idToken: 'synthetic.line.proof', companyName: `${tag}-${suffix}`, phoneNumber: '0812345678',
    contactEmail: email, legal: { ...currentLegalRelease('th'), locale: 'th' },
    correlationRequestId: `${tag}-${suffix}`, ...URLS,
  };
}

async function fixture(t: TestContext, run: (client: PrismaClient, tag: string) => Promise<void>) {
  const client = connect(), tag = `emailreview-${randomUUID()}`;
  let reachable = false;
  try {
    const unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'LINE_SIGNUP_REQUIRE_POSTGRES');
    if (unreachable) { t.skip(unreachable); return; }
    reachable = true;
    await client.user.create({ data: { id: `${tag}-admin`, displayName: tag, status: 'ACTIVE' } });
    await run(client, tag);
  } finally {
    try {
      if (reachable) {
        const requests = await client.companySignupRequest.findMany({ where: { companyName: { startsWith: tag } } });
        const companies = await client.company.findMany({ where: { name: { startsWith: tag } }, select: { id: true } });
        const companyIds = companies.map((row) => row.id);
        const userIds = requests.flatMap((row) => row.ownerUserId ? [row.ownerUserId] : []);
        await client.lineCompanyContext.deleteMany({ where: { lineUserId: { startsWith: `U${tag}` } } });
        await client.outboxEvent.deleteMany({ where: { OR: [
          { companyId: { in: companyIds } }, { aggregateId: { in: requests.map((row) => row.id) } },
        ] } });
        await client.companySignupRequest.deleteMany({ where: { id: { in: requests.map((row) => row.id) } } });
        await client.companyOnboardingRun.deleteMany({ where: { companyId: { in: companyIds } } });
        await client.company.deleteMany({ where: { id: { in: companyIds } } });
        await client.user.deleteMany({ where: { OR: [{ id: { startsWith: tag } }, { id: { in: userIds } }] } });
        await client.auditLog.deleteMany({ where: { requestId: { startsWith: tag } } });
      }
    } finally { await client.$disconnect(); }
  }
}

async function assertManual(client: PrismaClient, h: ReturnType<typeof wire>, requestId: string, email: string) {
  const request = await client.companySignupRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert.equal(request.state, 'PENDING_REVIEW');
  assert.equal(request.autoApproved, false, 'review must not consume an automatic approval slot');
  assert.equal(request.approvedAt, null);
  assert.equal(request.approvedByUserId, null);
  assert.equal(request.companyId, null);
  assert.equal(request.ownerUserId, null);
  assert.equal(request.pendingPasswordHash, null);
  assert.equal(h.operatorLookups, 0, 'duplicate decision precedes automatic operator lookup');
  assert.equal(h.provisionCalls, 0);
  assert.deepEqual(h.notifications, [requestId]);
  assert.equal(await client.company.count({ where: { name: request.companyName } }), 0);
  const audit = await client.auditLog.findFirstOrThrow({ where: { targetId: requestId, action: 'signup.line.submitted' } });
  const metadata = audit.metadataJson as Record<string, unknown>;
  assert.equal(metadata.emailPreviouslyUsed, true);
  assert.equal(metadata.manualReviewReason, 'email_previously_used');
  assert.equal(JSON.stringify(metadata).toLowerCase().includes(email.trim().toLowerCase()), false, 'audit signal contains no address');
  const listed = await h.queue.list(new Date(), { tab: 'PENDING_REVIEW', limit: 200 });
  assert.equal(listed.items.find((row) => row.requestId === requestId)?.emailPreviouslyUsed, true);
  return request;
}

describe('duplicate LINE signup email on PostgreSQL', { skip: !databaseUrl }, () => {
  it('opens the first fresh email immediately, then sends its normalized repeat to review without a second shop', async (t) => fixture(t, async (client, tag) => {
    const email = `${tag}@example.test`;
    const first = wire(client, tag, `U${tag}-first`);
    const result = await first.submit.execute(command(tag, ` ${email.toUpperCase()} `, 'first'));
    assert.equal(result.state, 'COMPLETED');
    const saved = await client.companySignupRequest.findUniqueOrThrow({ where: { id: result.requestId } });
    assert.equal(saved.contactEmail, email);
    assert.equal(saved.autoApproved, true);
    assert.ok(saved.companyId && saved.ownerUserId);
    assert.equal(first.provisionCalls, 1);
    const owner = await client.user.findUniqueOrThrow({ where: { id: saved.ownerUserId }, include: { credential: true } });
    assert.equal(owner.email, email);
    assert.equal(owner.emailVerifiedAt, null);
    assert.equal(owner.credential, null);
    assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: saved.companyId } })).monthlySlipLimit, 15);
    const next = wire(client, tag, `U${tag}-next`);
    const repeated = await next.submit.execute(command(tag, email, 'next'));
    await assertManual(client, next, repeated.requestId, email);
    assert.equal(await client.company.count({ where: { name: { startsWith: tag } } }), 1);
    assert.equal(await client.companySignupRequest.count({ where: { companyName: { startsWith: tag }, autoApproved: true } }), 1);
  }));

  for (const source of ['account-active', 'account-disabled', 'legacy-username', 'company-active', 'company-archived'] as const) {
    it(`keeps an exact normalized ${source} match manual before any automatic work`, async (t) => fixture(t, async (client, tag) => {
      const email = `${tag}@example.test`, historical = ` ${email.toUpperCase()} `;
      if (source.startsWith('account') || source === 'legacy-username') await client.user.create({ data: {
        id: `${tag}-old-owner`, displayName: tag,
        ...(source === 'legacy-username' ? { username: historical } : { email: historical }),
        status: source === 'account-disabled' ? 'DISABLED' : 'ACTIVE',
      } });
      else await client.company.create({ data: {
        id: `${tag}-old-company`, name: `${tag}-old-company`, businessCategory: 'RETAIL', email: historical,
        status: source === 'company-archived' ? 'ARCHIVED' : 'ACTIVE',
      } });
      const h = wire(client, tag, `U${tag}-new`);
      const result = await h.submit.execute(command(tag, email));
      assert.equal(result.existingAccount, false, 'email alone cannot identify the LINE applicant');
      const request = await assertManual(client, h, result.requestId, email);
      assert.equal(request.attachUserId, null);
    }));
  }

  it('keeps a fresh exact email automatic when only the phone and shop name were used before', async (t) => fixture(t, async (client, tag) => {
    const email = `${tag}+second@example.test`, cmd = command(tag, email);
    await client.company.create({ data: {
      id: `${tag}-old-company`, name: cmd.companyName, phone: cmd.phoneNumber,
      businessCategory: 'RETAIL', email: `${tag}@example.test`, status: 'ACTIVE',
    } });
    const h = wire(client, tag, `U${tag}-new`);
    const result = await h.submit.execute(cmd);
    assert.equal(result.state, 'COMPLETED');
    assert.equal(h.provisionCalls, 1);
    const request = await client.companySignupRequest.findUniqueOrThrow({ where: { id: result.requestId } });
    assert.equal(request.autoApproved, true, 'no alias folding, phone or company-name review rule is introduced');
    assert.ok(request.companyId && request.companyId !== `${tag}-old-company`);
  }));

  const historyStates: CompanySignupState[] = [
    'RECEIVED', 'VALIDATED', 'PENDING_REVIEW', 'EMAIL_PENDING', 'EMAIL_VERIFIED', 'PROVISIONING', 'READY',
    'LINE_LINK_PENDING', 'COMPLETED', 'EMAIL_FAILED', 'PROVISIONING_FAILED', 'SUSPENDED', 'EXPIRED', 'REJECTED',
  ];
  for (const state of historyStates) {
    it(`retains prior application evidence from ${state}`, async (t) => fixture(t, async (client, tag) => {
      const email = `${tag}@example.test`;
      await client.companySignupRequest.create({ data: {
        externalSignupId: `${tag}-history`, companyName: `${tag}-history`, ownerDisplayName: tag,
        payloadHash: tag, consentVersion: 'historical', contactEmail: ` ${email.toUpperCase()} `,
        source: state === 'REJECTED' ? 'line-oa' : 'official-site', state,
      } });
      const h = wire(client, tag, `U${tag}-new`);
      const result = await h.submit.execute(command(tag, email));
      await assertManual(client, h, result.requestId, email);
    }));
  }

  it('does not reopen AUTO_FREE through same-LINE resubmit or a rejected application', async (t) => fixture(t, async (client, tag) => {
    const email = `${tag}@example.test`;
    await client.user.create({ data: { id: `${tag}-old-owner`, displayName: tag, email, status: 'ACTIVE' } });
    const h = wire(client, tag, `U${tag}-new`), cmd = command(tag, email);
    const initial = await h.submit.execute(cmd);
    await assertManual(client, h, initial.requestId, email);
    await assert.rejects(h.submit.execute({ ...cmd, correlationRequestId: `${tag}-retry` }),
      (error: unknown) => error instanceof ConflictException && error.message === 'line_signup_already_pending');
    assert.equal(await client.companySignupRequest.count({ where: { lineProviderUserId: `U${tag}-new` } }), 1);
    await h.queue.decide(initial.requestId, { action: 'REJECT' }, `${tag}-admin`, `${tag}-reject`, URLS);
    const next = wire(client, tag, `U${tag}-new`);
    const repeated = await next.submit.execute(command(tag, email, 'after-reject'));
    assert.notEqual(repeated.requestId, initial.requestId);
    await assertManual(client, next, repeated.requestId, email);
    assert.equal(await client.company.count({ where: { name: { startsWith: tag } } }), 0);
  }));

  it('two committed concurrent fresh applications cannot both auto-provision', async (t) => fixture(t, async (client, tag) => {
    const other = connect(), email = `${tag}@example.test`;
    let release!: () => void, arrived = 0;
    const bothCommitted = new Promise<void>((resolve) => { release = resolve; });
    const timer = setTimeout(release, 5_000);
    try {
      const first = wire(client, tag, `U${tag}-first`), second = wire(other, tag, `U${tag}-second`);
      for (const h of [first, second]) {
        const receive = h.core.receiveNormalized.bind(h.core);
        h.core.receiveNormalized = async (...args) => {
          const committed = await receive(...args);
          arrived += 1;
          if (arrived === 2) release();
          await bothCommitted;
          return committed;
        };
      }
      const results = await Promise.all([
        first.submit.execute(command(tag, email, 'first')),
        second.submit.execute(command(tag, ` ${email.toUpperCase()} `, 'second')),
      ]);
      assert.equal(arrived, 2, 'both real receive transactions reached the committed barrier');
      for (const [index, h] of [first, second].entries()) await assertManual(client, h, results[index]!.requestId, email);
      assert.equal(await client.companySignupRequest.count({ where: { companyName: { startsWith: tag } } }), 2);
      assert.equal(await client.companySignupRequest.count({ where: { companyName: { startsWith: tag }, autoApproved: true } }), 0);
      assert.equal(await client.company.count({ where: { name: { startsWith: tag } } }), 0);
    } finally { clearTimeout(timer); release(); await other.$disconnect(); }
  }));

  it('actual manual approval creates one shop for proven LINE without adopting the other email owner', async (t) => fixture(t, async (client, tag) => {
    const email = `${tag}@example.test`, rivalId = `${tag}-email-owner`;
    const verifiedAt = new Date('2026-08-01T00:00:00Z');
    await client.user.create({ data: { id: rivalId, displayName: tag, email, emailVerifiedAt: verifiedAt, status: 'ACTIVE' } });
    const h = wire(client, tag, `U${tag}-new`);
    const result = await h.submit.execute(command(tag, email));
    await assertManual(client, h, result.requestId, email);
    const approved = await h.queue.decide(result.requestId, { action: 'APPROVE' }, `${tag}-admin`, `${tag}-approve`, URLS);
    assert.equal(approved.state, 'COMPLETED');
    const saved = await client.companySignupRequest.findUniqueOrThrow({ where: { id: result.requestId } });
    assert.equal(saved.autoApproved, false);
    assert.equal(saved.approvedByUserId, `${tag}-admin`);
    assert.ok(saved.ownerUserId && saved.companyId);
    assert.notEqual(saved.ownerUserId, rivalId);
    const owner = await client.user.findUniqueOrThrow({ where: { id: saved.ownerUserId }, include: { credential: true } });
    assert.equal(owner.email, null);
    assert.equal(owner.emailVerifiedAt, null);
    assert.equal(owner.credential, null);
    const rival = await client.user.findUniqueOrThrow({ where: { id: rivalId } });
    assert.equal(rival.email, email);
    assert.deepEqual(rival.emailVerifiedAt, verifiedAt);
    assert.equal((await client.company.findUniqueOrThrow({ where: { id: saved.companyId } })).email, email);
    assert.equal((await client.externalIdentity.findFirstOrThrow({ where: { provider: 'LINE', providerChannelId: tag, providerUserId: `U${tag}-new` } })).userId, owner.id);
    assert.equal(await client.companyMembership.count({ where: { companyId: saved.companyId, userId: rivalId } }), 0);
    await h.queue.decide(result.requestId, { action: 'APPROVE' }, `${tag}-admin`, `${tag}-approve-retry`, URLS);
    assert.equal(await client.company.count({ where: { name: { startsWith: tag } } }), 1);
    assert.equal(await client.companyOnboardingRun.count({ where: { companyId: saved.companyId } }), 1);
  }));
});
