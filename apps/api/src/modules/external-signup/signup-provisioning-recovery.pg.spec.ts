/**
 * Review R04, against real PostgreSQL.
 *
 * Three properties no in-memory fake can show, because the mechanism IS the database:
 *  1. the `companyId` stamp is written INSIDE the company transaction, and a second onboarding run
 *     carrying the same `linkSignupRequestId` loses the conditional `updateMany` and rolls its
 *     whole transaction back — so it creates nothing at all;
 *  2. a provisioning that dies AFTER that transaction commits leaves the stamp behind, and the
 *     retry adopts the company instead of building a second one (both the new-user lane and the
 *     attach lane);
 *  3. the claim step consumes the single-use token in the SAME transaction that records the claim,
 *     so a request that moved on between the page load and the submit leaves the token unspent
 *     rather than burning the applicant's only link on a claim that was never recorded.
 *
 * Run with:
 *   SIGNUP_RECOVERY_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/external-signup/signup-provisioning-recovery.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { LegalAcceptanceService } from '../auth/application/legal-acceptance.service';
import { CreateCompanyOnboardingUseCase } from '../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { PrismaOutboxRepository } from '../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { AccountClaimTokenService } from './application/account-claim-token.service';
import { CompanySignupCoreService } from './application/company-signup-core.service';
import { ProvisionSignupUseCase } from './application/provision-signup.use-case';
import { PartnerLifecycleTransitionUseCase } from '../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { SignupAdminQueueUseCase } from './application/signup-admin-queue.use-case';
import { SignupClaimEmailService, ACCOUNT_CLAIM_EMAIL_EVENT_TYPE } from './application/signup-claim-email.service';
import { SignupClaimUseCase } from './application/signup-claim.use-case';

const databaseUrl = process.env.SIGNUP_RECOVERY_TEST_DATABASE_URL;
const URLS = { webBaseUrl: 'https://app.example.com', apiBaseUrl: 'https://api.example.com/v1' };

function connect(): PrismaClient {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
  // prod to 127.0.0.1 through SSM. This spec writes to the real `public` schema, so it also
  // requires the local docker database by name before it creates a single row.
  assert.equal(url.pathname, '/watchdog_bms', 'refusing to write to anything but the local docker database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
}

const CONFIG = { credentialEncryptionKey: Buffer.alloc(32, 7), lineLiffId: undefined } as never;

/** Every use case in the chain, real, over one client. Only the outside world is faked. */
function wire(client: PrismaClient, adminUserId: string) {
  const prisma = { client } as never;
  const core = new CompanySignupCoreService(prisma);
  const legal = new LegalAcceptanceService(prisma, { log: async () => undefined } as never);
  const onboarding = new CreateCompanyOnboardingUseCase(prisma, CONFIG, legal);
  const adminDirectory = { activeSystemAdmins: async () => [{ companyId: 'sys', userId: adminUserId }] } as never;
  const provision = new ProvisionSignupUseCase(
    prisma, core, onboarding, CONFIG, adminDirectory,
    { enqueue: async () => undefined } as never,
    { raise: async () => undefined } as never,
    new PartnerLifecycleTransitionUseCase(prisma),
  );
  const tokens = new AccountClaimTokenService(prisma);
  const outbox = new PrismaOutboxRepository(prisma);
  const claimEmail = new SignupClaimEmailService(
    prisma, outbox, tokens, core, null as never, null as never, null as never, null as never, null as never,
  );
  const queueWith = (email: unknown) => new SignupAdminQueueUseCase(
    prisma, core, tokens, email as never, provision, { enqueue: async () => undefined } as never,
  );
  return {
    core, onboarding, provision, tokens, outbox, claimEmail,
    queue: queueWith(claimEmail),
    queueWith,
    claim: new SignupClaimUseCase(prisma, core, tokens, provision),
  };
}

/** A Flow B application an admin has approved, waiting on its claim link. */
async function seedApprovedRequest(client: PrismaClient, tag: string, state = 'EMAIL_PENDING') {
  const adminUserId = `${tag}-admin`;
  await client.user.create({ data: { id: adminUserId, displayName: `${tag} admin`, status: 'ACTIVE' } });
  const approvedAt = new Date('2026-09-01T00:00:00.000Z');
  const request = await client.companySignupRequest.create({
    data: {
      id: `${tag}-signup`,
      source: 'official-site',
      externalSignupId: `${tag}-${randomUUID()}`,
      payloadHash: 'hash',
      companyName: `ร้านใหม่ ${tag}`,
      ownerDisplayName: 'สมชาย ใจดี',
      contactEmail: `${tag}@example.com`,
      consentVersion: 'v1',
      state: state as never,
      mxValid: true,
      approvedAt,
      claimWindowStartedAt: approvedAt,
      approvedByUserId: adminUserId,
    },
  });
  return { adminUserId, request };
}

const provisionCmd = (requestId: string, username: string) => ({
  requestId,
  username,
  correlationRequestId: `req-${randomUUID().slice(0, 8)}`,
  ...URLS,
});

const companiesFor = (client: PrismaClient, name: string) =>
  client.company.findMany({ where: { name }, select: { id: true } });

describe('R04: a provisioning that dies after the company commits (real PostgreSQL)', { skip: databaseUrl ? false : 'set SIGNUP_RECOVERY_TEST_DATABASE_URL' }, () => {
  it('stamps the signup inside the company transaction and refuses a second onboarding for it', async () => {
    const client = connect();
    const tag = `r04a-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag, 'EMAIL_VERIFIED');
      const w = wire(client, adminUserId);

      await w.provision.execute(provisionCmd(request.id, `${tag}user`));

      const after = await client.companySignupRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.ok(after.companyId, 'the company id must be stamped by the transaction that created it');
      assert.equal((await companiesFor(client, request.companyName)).length, 1);

      // The second run's conditional stamp matches nothing, so its ENTIRE transaction rolls back.
      await assert.rejects(
        () => w.onboarding.execute({
          companyName: request.companyName,
          businessCategory: 'OTHER',
          ownerDisplayName: 'สมชาย ใจดี',
          ownerUsername: `${tag}user2`,
          claimedOwner: { email: `${tag}-2@example.com` },
          allowDuplicateCompanyName: true,
          linkSignupRequestId: request.id,
          requestingAdminUserId: adminUserId,
          requestId: 'req-second',
          ...URLS,
        } as never),
        /signup_already_provisioned/,
      );
      assert.equal(
        (await companiesFor(client, request.companyName)).length,
        1,
        'the loser must leave no company behind',
      );
    } finally {
      await client.$disconnect();
    }
  });

  it('leaves the stamp behind on a post-commit failure, and the retry adopts instead of duplicating', async () => {
    const client = connect();
    const tag = `r04b-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag, 'EMAIL_VERIFIED');
      const w = wire(client, adminUserId);

      // The company transaction has committed; the process dies on the very next write.
      const breaking = Object.create(w.core) as CompanySignupCoreService;
      breaking.completeProvisioning = async () => { throw new Error('boom_after_commit'); };
      const failing = new ProvisionSignupUseCase(
        { client } as never, breaking, w.onboarding, CONFIG,
        { activeSystemAdmins: async () => [{ companyId: 'sys', userId: adminUserId }] } as never,
        { enqueue: async () => undefined } as never, { raise: async () => undefined } as never,
        new PartnerLifecycleTransitionUseCase({ client } as never),
      );

      await assert.rejects(() => failing.execute(provisionCmd(request.id, `${tag}user`)), /boom_after_commit/);

      const stranded = await client.companySignupRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(stranded.state, 'PROVISIONING_FAILED');
      assert.ok(stranded.companyId, 'a committed company must never be invisible to the retry');
      const companyId = stranded.companyId!;

      // The admin retries through the real use case.
      const result = await w.provision.execute(provisionCmd(request.id, `${tag}user`));

      assert.equal(result.companyId, companyId, 'the retry must resume from the company that exists');
      assert.equal((await companiesFor(client, request.companyName)).length, 1, 'exactly one shop, ever');
      assert.equal(
        await client.companyMembership.count({ where: { companyId } }),
        1,
        'exactly one owner membership',
      );
      const term = await client.companyPlanTerm.findUnique({ where: { companyId } });
      assert.equal(term?.tierKey, 'FREE_TRIAL_15', 'a recovered shop is still on the trial, not unlimited');
    } finally {
      await client.$disconnect();
    }
  });

  it('adopts rather than duplicates on the attach lane too', async () => {
    const client = connect();
    const tag = `r04c-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag, 'EMAIL_VERIFIED');
      const existingUserId = `${tag}-existing`;
      await client.user.create({
        data: { id: existingUserId, displayName: 'เจ้าของเดิม', username: `${tag}old`, status: 'ACTIVE' },
      });
      await client.companySignupRequest.update({
        where: { id: request.id },
        data: { attachUserId: existingUserId },
      });
      const w = wire(client, adminUserId);

      const breaking = Object.create(w.core) as CompanySignupCoreService;
      breaking.completeProvisioning = async () => { throw new Error('boom_after_commit'); };
      const failing = new ProvisionSignupUseCase(
        { client } as never, breaking, w.onboarding, CONFIG,
        { activeSystemAdmins: async () => [{ companyId: 'sys', userId: adminUserId }] } as never,
        { enqueue: async () => undefined } as never, { raise: async () => undefined } as never,
        new PartnerLifecycleTransitionUseCase({ client } as never),
      );
      await assert.rejects(() => failing.execute(provisionCmd(request.id, `${tag}user`)), /boom_after_commit/);

      const result = await w.provision.execute(provisionCmd(request.id, `${tag}user`));

      assert.equal(result.attachedToExistingUser, true);
      assert.equal((await companiesFor(client, request.companyName)).length, 1);
      assert.equal(
        await client.companyMembership.count({ where: { companyId: result.companyId, userId: existingUserId } }),
        1,
        'the existing account keeps exactly one membership in the new shop',
      );
    } finally {
      await client.$disconnect();
    }
  });
});

describe('F2: a failed web provisioning is visible in the queue and retryable there', { skip: databaseUrl ? false : 'set SIGNUP_RECOVERY_TEST_DATABASE_URL' }, () => {
  it('lists the stranded row and opens the shop when an admin retries it', async () => {
    const client = connect();
    const tag = `f2-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag, 'EMAIL_VERIFIED');
      const w = wire(client, adminUserId);

      // The company transaction commits and the process dies on the next write, exactly as R04.
      const breaking = Object.create(w.core) as CompanySignupCoreService;
      breaking.completeProvisioning = async () => { throw new Error('boom_after_commit'); };
      const failing = new ProvisionSignupUseCase(
        { client } as never, breaking, w.onboarding, CONFIG,
        { activeSystemAdmins: async () => [{ companyId: 'sys', userId: adminUserId }] } as never,
        { enqueue: async () => undefined } as never, { raise: async () => undefined } as never,
        new PartnerLifecycleTransitionUseCase({ client } as never),
      );
      await assert.rejects(() => failing.execute(provisionCmd(request.id, `${tag}user`)), /boom_after_commit/);

      // Before F2 this row was invisible: PROVISIONING_FAILED was listed for `line-oa` only.
      const queued = await w.queue.list();
      const row = queued.items.find((item) => item.requestId === request.id);
      assert.ok(row, 'a shop that failed to open must be findable by an operator');
      assert.equal(row!.state, 'PROVISIONING_FAILED');
      assert.ok(row!.failureCode, 'and it must say why, so the retry is an informed one');

      // ...and the retry is the same button the LINE source already had.
      const decided = await w.queue.decide(
        request.id, { action: 'APPROVE' }, adminUserId, 'req-retry', URLS,
      );

      assert.equal(decided.state, 'LINE_LINK_PENDING');
      const after = await client.companySignupRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(after.state, 'LINE_LINK_PENDING');
      assert.equal((await companiesFor(client, request.companyName)).length, 1, 'exactly one shop');
      assert.equal(await client.companyMembership.count({ where: { companyId: after.companyId! } }), 1);
      // Review F16: a retry is not a decision. Filed as `signup.request.approved` the trail read as
      // two approvals of one application, when the real approval happened days earlier.
      assert.equal(
        await client.auditLog.count({ where: { targetId: request.id, action: 'signup.request.provisioning_retried' } }),
        1,
      );
      assert.equal(
        await client.auditLog.count({ where: { targetId: request.id, action: 'signup.request.approved' } }),
        0,
        'the retry must not add a second approval to the trail',
      );
    } finally {
      await client.$disconnect();
    }
  });
});

describe('F10/R08: approve writes its state, its stamp and its letter in one transaction', { skip: databaseUrl ? false : 'set SIGNUP_RECOVERY_TEST_DATABASE_URL' }, () => {
  const claimEmailRows = (client: PrismaClient, id: string) => client.outboxEvent.findMany({
    where: { aggregateId: id, eventType: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE },
    select: { eventKey: true },
  });

  it('persists nothing at all when the letter cannot be queued', async () => {
    const client = connect();
    const tag = `f10a-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag, 'PENDING_REVIEW');
      await client.companySignupRequest.update({
        where: { id: request.id },
        data: { approvedAt: null, claimWindowStartedAt: null, approvedByUserId: null },
      });
      const w = wire(client, adminUserId);
      const queue = w.queueWith({ enqueue: async () => { throw new Error('outbox_down'); } });

      await assert.rejects(
        () => queue.decide(request.id, { action: 'APPROVE' }, adminUserId, 'req-fail', URLS),
        /outbox_down/,
      );

      const after = await client.companySignupRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(after.state, 'PENDING_REVIEW', 'the applicant must not be left waiting on nothing');
      assert.equal(after.approvedAt, null, 'and no approval may be recorded for a decision that failed');
      assert.equal(after.claimWindowStartedAt, null);
      assert.deepEqual(await claimEmailRows(client, request.id), []);
      // Review F15: the audit is written on the TRANSACTION client, so it rolls back with the
      // decision. Written on `prisma.client` it would survive and assert an approval that never
      // committed — an audit trail that lies is worse than one with a gap.
      assert.equal(
        await client.auditLog.count({ where: { targetId: request.id, action: 'signup.request.approved' } }),
        0,
        'no audit row may outlive the transaction it belongs to',
      );
    } finally {
      await client.$disconnect();
    }
  });

  it('commits state, stamp and letter together, and a retry queues no second one', async () => {
    const client = connect();
    const tag = `f10b-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag, 'PENDING_REVIEW');
      await client.companySignupRequest.update({
        where: { id: request.id },
        data: { approvedAt: null, claimWindowStartedAt: null, approvedByUserId: null },
      });
      const w = wire(client, adminUserId);

      await w.queue.decide(request.id, { action: 'APPROVE' }, adminUserId, 'req-ok', URLS);
      // The retry an operator makes when they are not sure the first one landed.
      await w.queue.decide(request.id, { action: 'APPROVE' }, adminUserId, 'req-ok-2', URLS);

      const after = await client.companySignupRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(after.state, 'EMAIL_PENDING');
      assert.ok(after.approvedAt, 'the stamp rides the same transaction as the state');
      assert.equal(after.approvedByUserId, adminUserId);
      assert.ok(after.claimWindowStartedAt, 'and so does the activation window the sweep reads');
      // The eventKey carries no time bucket, so the repair path can never make a second letter.
      assert.deepEqual(
        await claimEmailRows(client, request.id),
        [{ eventKey: `email:claim:${request.id}` }],
      );
      // One decision, one approval row — the retry files as a repair, not a second approval (F8).
      assert.equal(
        await client.auditLog.count({ where: { targetId: request.id, action: 'signup.request.approved' } }),
        1,
      );
      assert.equal(
        await client.auditLog.count({ where: { targetId: request.id, action: 'signup.request.claim_email_repaired' } }),
        1,
      );
    } finally {
      await client.$disconnect();
    }
  });
});

describe('R04: the claim consumes its token in the transaction that records the claim', { skip: databaseUrl ? false : 'set SIGNUP_RECOVERY_TEST_DATABASE_URL' }, () => {
  it('leaves the link unspent when the request moved on between page load and submit', async () => {
    const client = connect();
    const tag = `r04d-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag);
      const w = wire(client, adminUserId);
      const { rawToken } = await w.tokens.mint(request.id);

      // The applicant loaded the page while the link was live; the 30-day sweep parked the request
      // before they pressed submit. This is the window the claim used to consume the token in.
      const realPeek = w.tokens.peek.bind(w.tokens);
      (w.tokens as { peek: typeof realPeek }).peek = async (raw: string) => {
        const found = await realPeek(raw);
        if (found) {
          await client.companySignupRequest.update({
            where: { id: request.id },
            data: { state: 'EXPIRED', failureCode: 'claim_not_started' },
          });
        }
        return found;
      };

      await assert.rejects(() => w.claim.setPassword({
        token: rawToken,
        username: `${tag}user`,
        password: 'secret12345',
        correlationRequestId: 'req-claim',
        ...URLS,
      }));

      const token = await client.accountClaimToken.findFirstOrThrow({ where: { signupRequestId: request.id } });
      assert.equal(token.usedAt, null, 'the applicant\'s single-use link must not be burnt by a claim that was never recorded');
      const after = await client.companySignupRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(after.pendingPasswordHash, null, 'no credential material may be left on a request that never claimed');
      assert.equal(after.companyId, null, 'and no company may exist for it');
    } finally {
      await client.$disconnect();
    }
  });

  it('still claims exactly once on the happy path, and a second submit of the same link is refused', async () => {
    const client = connect();
    const tag = `r04e-${randomUUID().slice(0, 8)}`;
    try {
      const { adminUserId, request } = await seedApprovedRequest(client, tag);
      const w = wire(client, adminUserId);
      const { rawToken } = await w.tokens.mint(request.id);
      const cmd = {
        token: rawToken,
        username: `${tag}user`,
        password: 'secret12345',
        correlationRequestId: 'req-claim',
        ...URLS,
      };

      const first = await w.claim.setPassword(cmd);
      assert.ok(first.companyId);

      await assert.rejects(() => w.claim.setPassword(cmd), /claim_link_invalid_or_expired/);
      assert.equal((await companiesFor(client, request.companyName)).length, 1);
    } finally {
      await client.$disconnect();
    }
  });
});
