/**
 * UAT cmto4xtrx002r4o5tf7o38dls, against real PostgreSQL.
 *
 * A tester had linked their LINE account, unlinked it, and applied for a new shop. Submit read the
 * identity slot with `status: 'ACTIVE'` and so reported `existingAccount: false`; the admin
 * approved; onboarding ran `externalIdentity.create` for a `(provider, providerChannelId,
 * providerUserId)` triple the UNLINKED row still owned, and Postgres raised P2002. The global
 * filter turned that into a generic 409 "Duplicate value" in about 40ms, the request parked at
 * PROVISIONING_FAILED, and every admin retry produced exactly the same 409.
 *
 * No in-memory fake can see this class of bug: the unique index IS the mechanism, and a fake that
 * models identities as a list simply appends a second row and reports green. Everything here runs
 * through the real use-cases against the real constraint.
 *
 * Run with:
 *   LINE_SIGNUP_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/external-signup/line-signup-stale-identity.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { currentLegalRelease } from '../auth/application/legal-acceptance.service';
import { LegalAcceptanceService } from '../auth/application/legal-acceptance.service';
import { LinkLineIdentityUseCase } from '../auth/application/use-cases/link-line-identity.use-case';
import { UnlinkLineIdentityUseCase } from '../auth/application/use-cases/unlink-line-identity.use-case';
import { hashPassword } from '../auth/domain/logic/password-credential.logic';
import { resolveCompanyForLineUser } from '../line-ai/application/use-cases/process-line-webhook.use-case';
import { CreateCompanyOnboardingUseCase } from '../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { CompanySignupCoreService } from './application/company-signup-core.service';
import { ProvisionSignupUseCase } from './application/provision-signup.use-case';
import { SignupAdminQueueUseCase } from './application/signup-admin-queue.use-case';
import { SubmitLineSignupUseCase } from './application/submit-line-signup.use-case';

const databaseUrl = process.env.LINE_SIGNUP_TEST_DATABASE_URL;

const CHANNEL = 'line-signup-pg-channel';
const URLS = { webBaseUrl: 'https://app.example.com', apiBaseUrl: 'https://api.example.com/v1' };
/** Thursday 10:00 Bangkok — inside the MON-SAT 09:00-18:00 window, so the copy path is the normal one. */
const NOW = new Date('2026-09-03T10:00:00+07:00');

function connect(): PrismaClient {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
  // prod to 127.0.0.1 through SSM. This spec writes to the real `public` schema, so it also
  // requires the local docker database by name before it creates a single row.
  assert.equal(url.pathname, '/watchdog_bms', 'refusing to write to anything but the local docker database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
}

/** Every use case in the chain, real, over one client. Only the outside world is faked. */
function wire(client: PrismaClient, options: { adminUserId: string; approvalMode?: string; lineUserId: string }) {
  const prisma = { client } as any;
  const config = {
    credentialEncryptionKey: Buffer.alloc(32, 7),
    lineLiffId: undefined,
    lineSignupApprovalMode: options.approvalMode ?? 'MANUAL',
    lineSignupAutoDailyCap: 20,
    lineSignupWarmupSlips: 10,
    lineFreeAiBudgetSatang: 8000,
    lineSignupBusinessDays: 'MON-SAT',
    lineSignupBusinessHours: '09:00-18:00',
  } as any;
  const core = new CompanySignupCoreService(prisma);
  const legal = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);
  /**
   * Opens the moment onboarding has written the LINE identity row and is STILL inside its company
   * transaction. `recordFromEvidence` is the very next statement after the identity block, so it is
   * the one seam that names that window without reaching into the use case. A timer opens the gate
   * anyway if provisioning never gets there, so a spec fails on its assertion, not on a hang.
   */
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => { openGate = resolve; });
  const backstop = setTimeout(() => openGate(), 5_000);
  backstop.unref?.();
  const recordFromEvidence = legal.recordFromEvidence.bind(legal);
  (legal as any).recordFromEvidence = async (...args: Parameters<typeof recordFromEvidence>) => {
    openGate();
    return recordFromEvidence(...args);
  };
  const onboarding = new CreateCompanyOnboardingUseCase(prisma, config, legal);
  const adminDirectory = { activeSystemAdmins: async () => [{ companyId: 'sys', userId: options.adminUserId }], enqueue: async () => undefined } as any;
  const linePushes: Array<{ id: string; kind: string }> = [];
  const lineNotify = { enqueue: async (id: string, kind: string) => { linePushes.push({ id, kind }); } } as any;
  const opsAlerts = { raise: async () => undefined } as any;
  const provision = new ProvisionSignupUseCase(prisma, core, onboarding, config, adminDirectory, lineNotify, opsAlerts);
  const rateLimit = {
    assertLineSignupAttemptAllowed: async () => undefined,
    assertLineSignupUserAllowed: async () => undefined,
    recordLineSignupUser: async () => undefined,
  } as any;
  const lineIdToken = {
    verify: async () => ({ providerUserId: options.lineUserId, channelId: CHANNEL, displayName: 'นิด' }),
  } as any;
  const claimEmail = { enqueue: async () => undefined, enqueueRejectionNotice: async () => undefined } as any;
  return {
    onboarding,
    provision,
    submit: new SubmitLineSignupUseCase(prisma, config, core, lineIdToken, rateLimit, adminDirectory, provision, opsAlerts),
    queue: new SignupAdminQueueUseCase(prisma, core, { revokeAll: async () => 0 } as any, claimEmail, provision, lineNotify),
    unlink: new UnlinkLineIdentityUseCase(prisma),
    // The OTHER writer of this identity slot (review MED-1). Real, over the same client, so the two
    // flows contend for the same advisory key exactly as they do in production.
    link: new LinkLineIdentityUseCase(
      { verify: async () => ({ subject: options.lineUserId }) } as any,
      prisma,
      { lineMessagingChannelId: CHANNEL, lineLoginChannelId: CHANNEL, isProduction: false } as any,
    ),
    gate,
    linePushes,
  };
}

const submitCmd = (correlationRequestId: string) => ({
  idToken: 'aaaa.bbbb.cccc',
  submissionId: randomUUID(),
  intent: 'FIRST_SHOP' as const,
  companyName: `ร้านใหม่ ${randomUUID().slice(0, 8)}`,
  // Required since Owner 2026-09-05 (spec §3.2); every real submit carries one.
  phoneNumber: '0812345678',
  contactEmail: 'shop@example.test',
  legal: { ...currentLegalRelease('th'), locale: 'th' },
  correlationRequestId,
  ...URLS,
});

const createNewShopDecision = (version: number) => ({
  action: 'CREATE_NEW_SHOP' as const,
  version,
  grantRepeatTrial: true,
  trialGrantNote: 'Regression fixture: explicit repeat-trial authorization',
  acknowledgeSharedContact: true,
  sharedContactNote: 'Regression fixture: reviewed shared contact address',
});

/**
 * The world before the new application: an account with one shop, a plan term, and the LINE
 * identity that owns the unique slot. `shopStatus` decides whether that shop is still running.
 */
async function seedOldShop(
  client: PrismaClient,
  tag: string,
  lineUserId: string,
  // 'OWNER' is the repeat-trial case. 'STAFF' is review B1: an employee whose LINE was linked by
  // the staff QR holds a membership in their EMPLOYER's shop, which is not a trial they ever had.
  roleKey: 'OWNER' | 'STAFF' = 'OWNER',
  // DRAFT is an employee draft nobody finished. Onboarding writes the owner's membership ACTIVE
  // inside the company transaction, so a shop that really opened never sits in DRAFT.
  membershipStatus: 'ACTIVE' | 'DRAFT' = 'ACTIVE',
) {
  const oldUserId = `${tag}-old-user`;
  const oldCompanyId = `${tag}-old-company`;
  const adminUserId = `${tag}-admin`;
  const role = await client.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: roleKey } } });
  await client.user.create({ data: { id: adminUserId, displayName: `${tag} admin`, status: 'ACTIVE' } });
  await client.user.create({ data: { id: oldUserId, displayName: `${tag} owner`, status: 'ACTIVE' } });
  await client.company.create({
    data: { id: oldCompanyId, name: `ร้านเก่า ${tag}`, businessCategory: 'RETAIL', status: 'DISABLED' },
  });
  await client.companyMembership.create({
    data: { id: `${tag}-old-membership`, companyId: oldCompanyId, userId: oldUserId, status: membershipStatus },
  });
  await client.membershipRole.create({ data: { membershipId: `${tag}-old-membership`, roleId: role.id } });
  await client.companyPlanTerm.create({
    data: {
      companyId: oldCompanyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 3, monthlySlipLimit: 15,
      termStartAt: new Date('2026-07-01T00:00:00Z'), termEndsAt: new Date('2026-08-01T00:00:00Z'),
      // The plan-term sweep closed this shop; the queue hint and the LINE assistant both read this.
      termDisabledAt: new Date('2026-08-01T00:00:00Z'),
    },
  });
  await client.externalIdentity.create({
    data: {
      id: `${tag}-identity`, userId: oldUserId, provider: 'LINE',
      providerUserId: lineUserId, providerChannelId: CHANNEL, status: 'ACTIVE',
    },
  });
  // The chat had already resolved to the old shop, which is exactly the stale pointer that must not
  // survive: after the new shop opens, this LINE user must never land back on the disabled one.
  // `aiPausedUntil` is the §8 "ติดต่อเจ้าหน้าที่" hold on the PREVIOUS owner's conversation, live
  // and days from expiring — the new shop must not inherit a silenced assistant (review N4).
  await client.lineCompanyContext.create({
    data: { lineUserId, companyId: oldCompanyId, aiPausedUntil: new Date('2099-01-01T00:00:00Z') },
  });
  return { adminUserId, oldUserId, oldCompanyId };
}

async function addBackupLogin(client: PrismaClient, userId: string) {
  await client.user.update({ where: { id: userId }, data: { username: `${userId}-login`, credential: {
    create: { passwordHash: hashPassword('Synthetic-backup-password-123!'), status: 'ACTIVE' },
  } } });
}

async function cleanup(
  client: PrismaClient,
  tag: string,
  lineUserId: string,
  extra: { companyIds?: string[]; userIds?: string[] } = {},
) {
  const requests = await client.companySignupRequest.findMany({
    where: { lineProviderUserId: lineUserId },
    select: { id: true, companyId: true, ownerUserId: true },
  });
  const companyIds = [
    `${tag}-old-company`,
    ...requests.map((r) => r.companyId).filter((id): id is string => !!id),
    ...(extra.companyIds ?? []),
  ];
  const userIds = [
    `${tag}-old-user`, `${tag}-admin`,
    ...requests.map((r) => r.ownerUserId).filter((id): id is string => !!id),
    ...(extra.userIds ?? []),
  ];
  await client.lineCompanyContext.deleteMany({ where: { lineUserId } });
  await client.companySignupRequest.deleteMany({ where: { id: { in: requests.map((r) => r.id) } } });
  await client.companyOnboardingRun.deleteMany({ where: { companyId: { in: companyIds } } });
  await client.company.deleteMany({ where: { id: { in: companyIds } } });
  await client.user.deleteMany({ where: { id: { in: userIds } } });
  await client.auditLog.deleteMany({ where: { requestId: { startsWith: tag } } });
}

describe('a stale LINE identity on real PostgreSQL', { skip: !databaseUrl }, () => {
  for (const scenario of ['new', 'attached', 'legacy-null', 'new-available', 'attached-empty', 'legacy-username'] as const) {
    it(`keeps shop contact separate from account identity and preserves committed-company retry (${scenario})`, async () => {
      const client = connect(), tag = `lineemail-${randomUUID().slice(0, 8)}`, lineUserId = `U${tag}`;
      const rivalId = `${tag}-email-owner`, contactEmail = `${tag}@example.test`, verifiedAt = new Date('2026-08-01T00:00:00Z');
      const attached = scenario === 'attached' || scenario === 'attached-empty';
      const available = scenario === 'new-available' || scenario === 'attached-empty';
      try {
        const adminUserId = `${tag}-admin`;
        let ownerBefore: Awaited<ReturnType<typeof client.user.findUniqueOrThrow>> | undefined;
        if (attached) {
          const old = await seedOldShop(client, tag, lineUserId);
          ownerBefore = await client.user.update({ where: { id: old.oldUserId }, data: {
            email: available ? null : `${tag}-login@example.test`, emailVerifiedAt: available ? null : verifiedAt, phoneNumber: '0899999999',
          } });
        } else await client.user.create({ data: { id: adminUserId, displayName: tag, status: 'ACTIVE' } });
        const rivalBefore = await client.user.create({ data: { id: rivalId, displayName: 'Mailbox owner',
          email: available || scenario === 'legacy-username' ? `${tag}-rival@example.test` : contactEmail,
          ...(scenario === 'legacy-username' ? { username: contactEmail.toUpperCase() } : {}), emailVerifiedAt: verifiedAt, status: 'ACTIVE',
        } });
        const h = wire(client, { adminUserId, lineUserId });
        const submitted = await h.submit.execute({ ...submitCmd(`${tag}-submit`), contactEmail: ` ${contactEmail.toUpperCase()} ` }, NOW);
        assert.equal(submitted.progress!.existingAccount, attached);
        const pending = await client.companySignupRequest.findUniqueOrThrow({ where: { id: submitted.progress!.requestId } });
        assert.equal(pending.contactEmail, contactEmail); assert.equal(pending.mxValid, null);
        assert.equal(pending.attachUserId, ownerBefore?.id ?? null);
        if (scenario === 'legacy-null') await client.companySignupRequest.update({ where: { id: submitted.progress!.requestId }, data: { contactEmail: null } });
        else {
          const queued = (await h.queue.list()).items.find((item) => item.requestId === submitted.progress!.requestId)!;
          assert.equal(queued.contactEmail, contactEmail);
          assert.equal(queued.attachesToExistingAccount ?? false, attached);
        }
        const collided = await h.submit.execute({
          ...submitCmd(`${tag}-duplicate`), contactEmail: 'changed@example.test',
        }, NOW);
        assert.equal(collided.progress?.requestId, submitted.progress?.requestId,
          'a new client key discovers and resumes the already-open request');
        const unchangedOpen = await client.companySignupRequest.findUniqueOrThrow({ where: { id: pending.id } });
        assert.equal(unchangedOpen.contactEmail,
          scenario === 'legacy-null' ? null : contactEmail,
          'the changed POST payload never rewrites an open request');
        assert.equal(unchangedOpen.companyName, pending.companyName);
        assert.equal(await client.companySignupRequest.count({ where: { lineProviderUserId: lineUserId } }), 1);
        assert.equal(await client.company.count({ where: { id: { startsWith: tag } } }), attached ? 1 : 0,
          'the open-request replay creates no company');
        await h.queue.decide(
          submitted.progress!.requestId,
          createNewShopDecision(pending.version),
          adminUserId,
          `${tag}-approve`,
          URLS,
        );
        const request = await client.companySignupRequest.findUniqueOrThrow({ where: { id: submitted.progress!.requestId } });
        assert.equal(request.state, 'COMPLETED');
        const company = await client.company.findUniqueOrThrow({ where: { id: request.companyId! } });
        assert.equal(company.email, scenario === 'legacy-null' ? null : contactEmail);
        const owner = await client.user.findUniqueOrThrow({ where: { id: request.ownerUserId! } });
        if (available) { assert.equal(owner.email, contactEmail); assert.equal(owner.emailVerifiedAt, null); }
        else if (ownerBefore) assert.deepEqual(owner, ownerBefore);
        else { assert.equal(owner.email, null); assert.equal(owner.emailVerifiedAt, null); assert.notEqual(owner.id, rivalId); }
        assert.equal(await client.userCredential.count({ where: { userId: owner.id } }), 0);
        assert.deepEqual(await client.user.findUniqueOrThrow({ where: { id: rivalId } }), rivalBefore);
        assert.equal(await client.accountClaimToken.count({ where: { signupRequestId: request.id } }), 0);
        assert.equal(await client.emailVerificationToken.count({ where: { userId: owner.id } }), 0);

        // Reproduce a committed company with a failed provisioning tail. Adoption must preserve
        // a contact edited after creation instead of replaying the original intake over it.
        await client.company.update({ where: { id: company.id }, data: { email: 'edited@example.test' } });
        const ownerAfterEdit = await client.user.update({ where: { id: owner.id }, data: { email: `${tag}-edited@example.test` } });
        await client.companySignupRequest.update({ where: { id: request.id }, data: { state: 'PROVISIONING_FAILED' } });
        await h.provision.execute({ requestId: request.id, actorUserId: adminUserId, correlationRequestId: `${tag}-retry`, ...URLS });
        const retried = await client.companySignupRequest.findUniqueOrThrow({ where: { id: request.id } });
        assert.equal(retried.companyId, company.id); assert.equal(retried.ownerUserId, owner.id); assert.equal(retried.state, 'COMPLETED');
        assert.equal((await client.company.findUniqueOrThrow({ where: { id: company.id } })).email, 'edited@example.test');
        assert.deepEqual(await client.user.findUniqueOrThrow({ where: { id: owner.id } }), ownerAfterEdit);
      } finally {
        await cleanup(client, tag, lineUserId, { userIds: [rivalId] });
        await client.$disconnect();
      }
    });
  }

  it('commits both LINE shops when a concurrent email claim loses the real unique index', async () => {
    const first = connect(), second = connect(), tag = `lineemail-race-${randomUUID().slice(0, 8)}`;
    const contactEmail = `${tag}@example.test`, adminUserId = `${tag}-admin`, lineIds = [`U${tag}-1`, `U${tag}-2`];
    let release!: () => void, arrivals = 0, rollbacks = 0;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const backstop = setTimeout(() => release(), 4_000);
    const synchronize = (client: PrismaClient) => new Proxy(client, { get(target, property) {
      if (property === '$transaction') return (fn: any, options?: any) => typeof fn !== 'function' ? target.$transaction(fn, options) : target.$transaction((tx) => fn(new Proxy(tx, { get(transaction, key) {
        if (key === '$queryRaw') return async (...args: any[]) => {
          const rows = await (transaction.$queryRaw as any)(...args);
          if (String(args[0]).includes('lower("email")')) {
            assert.deepEqual(rows, [], 'both independent transactions must see the address as available');
            arrivals += 1; if (arrivals === 2) release(); await bothRead;
          }
          return rows;
        };
        if (key === '$executeRaw') return async (...args: any[]) => {
          if (String(args[0]).includes('ROLLBACK TO SAVEPOINT unverified_owner_email')) rollbacks += 1;
          return (transaction.$executeRaw as any)(...args);
        };
        const value = Reflect.get(transaction, key); return typeof value === 'function' ? value.bind(transaction) : value;
      } })), options);
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    try {
      await first.user.create({ data: { id: adminUserId, displayName: tag, status: 'ACTIVE' } });
      const harnesses = [wire(synchronize(first), { adminUserId, lineUserId: lineIds[0]! }), wire(synchronize(second), { adminUserId, lineUserId: lineIds[1]! })];
      const requests = await Promise.all(harnesses.map((h, index) => h.submit.execute({ ...submitCmd(`${tag}-submit-${index}`), contactEmail }, NOW)));
      const approvals = await Promise.allSettled(harnesses.map((h, index) => h.queue.decide(
        requests[index]!.progress!.requestId,
        createNewShopDecision(requests[index]!.progress!.version),
        adminUserId,
        `${tag}-approve-${index}`,
        URLS,
      )));
      for (const result of approvals) if (result.status === 'rejected') throw result.reason;
      assert.equal(arrivals, 2); assert.equal(rollbacks, 1, 'one actual unique violation is recovered with its savepoint');
      const completed = await first.companySignupRequest.findMany({ where: { id: { in: requests.map((r) => r.progress!.requestId) } } });
      assert.equal(completed.length, 2); assert.ok(completed.every((request) => request.state === 'COMPLETED'));
      const owners = await first.user.findMany({ where: { id: { in: completed.map((r) => r.ownerUserId!) } }, include: { credential: true, externalIdentities: true } });
      assert.equal(owners.length, 2); assert.equal(owners.filter((owner) => owner.email === contactEmail).length, 1);
      for (const owner of owners) {
        assert.equal(owner.emailVerifiedAt, null); assert.equal(owner.username, null); assert.equal(owner.credential, null);
        assert.equal(owner.externalIdentities.filter((identity) => identity.provider === 'LINE' && identity.status === 'ACTIVE').length, 1);
      }
      const companies = await first.company.findMany({ where: { id: { in: completed.map((r) => r.companyId!) } } });
      assert.equal(companies.length, 2); assert.ok(companies.every((company) => company.email === contactEmail));
    } finally {
      clearTimeout(backstop); release();
      const requests = await first.companySignupRequest.findMany({ where: { lineProviderUserId: { in: lineIds } } });
      const runs = await first.companyOnboardingRun.findMany({ where: { createdBySystemAdminUserId: adminUserId } });
      const companyIds = [...requests.map((r) => r.companyId), ...runs.map((r) => r.companyId)].filter((id): id is string => !!id);
      const userIds = [...requests.map((r) => r.ownerUserId), ...runs.map((r) => r.ownerUserId)].filter((id): id is string => !!id);
      await first.lineCompanyContext.deleteMany({ where: { lineUserId: { in: lineIds } } });
      await first.companySignupRequest.deleteMany({ where: { id: { in: requests.map((r) => r.id) } } });
      await first.companyOnboardingRun.deleteMany({ where: { companyId: { in: companyIds } } });
      await first.company.deleteMany({ where: { id: { in: companyIds } } });
      await first.user.deleteMany({ where: { id: { in: [...userIds, adminUserId] } } });
      await first.auditLog.deleteMany({ where: { requestId: { startsWith: tag } } });
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  });

  it('link → unlink → apply → approve opens a NEW shop on the SAME identity row', async () => {
    const client = connect();
    const tag = `linesignup-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const seeded = await seedOldShop(client, tag, lineUserId);
      await client.user.update({ where: { id: seeded.oldUserId }, data: { email: 'shop@example.test' } });
      const h = wire(client, { adminUserId: seeded.adminUserId, lineUserId });

      await assert.rejects(h.unlink.execute({ userId: seeded.oldUserId, requestId: `${tag}-no-backup` }),
        (error: any) => error.getResponse().code === 'LAST_LOGIN_REQUIRED');
      assert.equal((await client.externalIdentity.findUniqueOrThrow({ where: { id: `${tag}-identity` } })).status, 'ACTIVE');

      // The owner severs the link themselves — the real use-case, so the status is the real one.
      await addBackupLogin(client, seeded.oldUserId);
      await h.unlink.execute({ userId: seeded.oldUserId, requestId: `${tag}-unlink` });
      const stale = await client.externalIdentity.findUniqueOrThrow({ where: { id: `${tag}-identity` } });
      assert.equal(stale.status, 'UNLINKED');

      // Snapshots taken AFTER the unlink: nothing below this line may change any of them.
      const oldCompanyBefore = await client.company.findUniqueOrThrow({ where: { id: seeded.oldCompanyId } });
      const oldMembershipBefore = await client.companyMembership.findUniqueOrThrow({ where: { id: `${tag}-old-membership` } });
      const oldTermBefore = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: seeded.oldCompanyId } });
      const oldUserBefore = await client.user.findUniqueOrThrow({ where: { id: seeded.oldUserId } });

      const accepted = await h.submit.execute(submitCmd(`${tag}-submit`), NOW);
      // Before the fix this was the last honest step: the row said "new account" and the failure
      // came later, at the constraint, where nobody could act on it.
      assert.equal(accepted.progress!.existingAccount, false, 'the account that walked away is not the owner');
      assert.equal(accepted.progress!.state, 'PENDING_REVIEW');
      // Submit SAW the stale row. With the old `status: 'ACTIVE'` filter this reads false, because
      // the identity that names this person was invisible to the query that had to find it.
      const submitted = await client.auditLog.findFirstOrThrow({
        where: { action: 'signup.line.submitted', targetId: accepted.progress!.requestId },
      });
      assert.equal((submitted.metadataJson as any).repeatTrial, true);
      assert.equal((submitted.metadataJson as any).emailPreviouslyUsed, true,
        'an UNLINKED historical user is conflict evidence, not the currently proven owner');
      assert.equal((await client.companySignupRequest.findUniqueOrThrow({ where: { id: accepted.progress!.requestId } })).contactEmailConflict,
        true);

      // The queue tells the operator this is a repeat trial, and names the shop it is repeating.
      const queued = (await h.queue.list()).items.find((item) => item.requestId === accepted.progress!.requestId)!;
      assert.equal(queued.priorCompanyName, `ร้านเก่า ${tag}`);
      assert.equal(queued.priorCompanyState, 'EXPIRED');

      const decided = await h.queue.decide(
        accepted.progress!.requestId,
        createNewShopDecision(accepted.progress!.version),
        seeded.adminUserId,
        `${tag}-approve`,
        URLS,
      );
      // The bug: this used to be a 409 from the unique index, twice, with the row left at
      // PROVISIONING_FAILED and every retry identical.
      assert.equal(decided.state, 'COMPLETED');

      const request = await client.companySignupRequest.findUniqueOrThrow({ where: { id: accepted.progress!.requestId } });
      assert.equal(request.state, 'COMPLETED');
      assert.equal(request.failureCode, null, 'nothing failed on the way');
      const newCompanyId = request.companyId!;
      assert.notEqual(newCompanyId, seeded.oldCompanyId);

      // ONE row holds the unique slot, because the unique index says so — and it is the same row.
      const identities = await client.externalIdentity.findMany({
        where: { provider: 'LINE', providerChannelId: CHANNEL, providerUserId: lineUserId },
      });
      assert.equal(identities.length, 1);
      const identity = identities[0]!;
      assert.equal(identity.id, `${tag}-identity`, 're-pointed, not replaced');
      assert.equal(identity.status, 'ACTIVE');
      assert.equal(identity.userId, request.ownerUserId, 'and it belongs to the new shop owner');
      assert.notEqual(identity.userId, seeded.oldUserId);

      // Support can see which account this LINE moved off.
      const moved = await client.auditLog.findFirstOrThrow({
        where: { action: 'auth.identity.repointed', targetId: `${tag}-identity` },
      });
      assert.equal((moved.metadataJson as any).previousUserId, seeded.oldUserId);
      assert.equal((moved.metadataJson as any).ownerUserId, request.ownerUserId);

      // Owner 2026-09-05: re-pointing the identity reactivates NOTHING. The old shop stays closed,
      // its membership and plan term stay exactly as they were, and its owner keeps their status.
      assert.deepEqual(await client.company.findUniqueOrThrow({ where: { id: seeded.oldCompanyId } }), oldCompanyBefore);
      assert.deepEqual(
        await client.companyMembership.findUniqueOrThrow({ where: { id: `${tag}-old-membership` } }),
        oldMembershipBefore,
      );
      assert.deepEqual(
        await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: seeded.oldCompanyId } }),
        oldTermBefore,
      );
      assert.deepEqual(await client.user.findUniqueOrThrow({ where: { id: seeded.oldUserId } }), oldUserBefore);

      // And the chat lands on the new shop. Asserted through the resolver the webhook itself calls,
      // not a copy of it: the stale context still pointed at the disabled company until this ran.
      const context = await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } });
      assert.equal(context.companyId, newCompanyId, 'the stale pointer is overwritten, not left');
      // Review N4: and the previous owner's "a human is handling this" hold does not come with it.
      assert.equal(context.aiPausedUntil, null, 'the new shop starts with its assistant switched on');
      assert.deepEqual(
        await resolveCompanyForLineUser({ client } as any, identity.userId, lineUserId),
        { companyId: newCompanyId },
      );
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('refuses at submit, creating nothing, when the account or the identity is blocked', async () => {
    const client = connect();
    const tag = `linesignup-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const seeded = await seedOldShop(client, tag, lineUserId);
      const h = wire(client, { adminUserId: seeded.adminUserId, lineUserId });

      // The identity is ACTIVE and the account behind it is suspended: there is nowhere to attach a
      // shop, and opening a second account would be a way around the suspension.
      await client.user.update({ where: { id: seeded.oldUserId }, data: { status: 'SUSPENDED' } });
      await assert.rejects(() => h.submit.execute(submitCmd(`${tag}-blocked`), NOW), /line_signup_account_blocked/);

      // The admin kill-switch. Relinking through a signup must not resurrect a disabled identity.
      await client.user.update({ where: { id: seeded.oldUserId }, data: { status: 'ACTIVE' } });
      await client.externalIdentity.update({ where: { id: `${tag}-identity` }, data: { status: 'DISABLED' } });
      await assert.rejects(() => h.submit.execute(submitCmd(`${tag}-disabled`), NOW), /line_signup_identity_disabled/);

      // Review B2, the reviewer's escape hatch: unlink FIRST, then apply. The user-status guard has
      // to run for an UNLINKED identity too — otherwise a suspended owner severs the link and this
      // flow hands them a brand-new ACTIVE account on the same LINE (it reached COMPLETED).
      await client.externalIdentity.update({ where: { id: `${tag}-identity` }, data: { status: 'UNLINKED' } });
      await client.user.update({ where: { id: seeded.oldUserId }, data: { status: 'SUSPENDED' } });
      await assert.rejects(() => h.submit.execute(submitCmd(`${tag}-unlinked-suspended`), NOW), /line_signup_account_blocked/);

      assert.equal(
        await client.companySignupRequest.count({ where: { lineProviderUserId: lineUserId } }),
        0,
        'a refusal leaves no application for an admin to find, and no fence on this LINE account',
      );
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  it('keeps AUTO_FREE from opening a second free shop for a repeat applicant', async () => {
    const client = connect();
    const tag = `linesignup-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const seeded = await seedOldShop(client, tag, lineUserId);
      const h = wire(client, { adminUserId: seeded.adminUserId, lineUserId, approvalMode: 'AUTO_FREE' });
      await addBackupLogin(client, seeded.oldUserId);
      await h.unlink.execute({ userId: seeded.oldUserId, requestId: `${tag}-unlink` });

      const accepted = await h.submit.execute(submitCmd(`${tag}-repeat`), NOW);

      // Owner 2026-09-05: the machine may open a FIRST free trial, never a second one.
      assert.equal(accepted.progress!.state, 'PENDING_REVIEW');
      const request = await client.companySignupRequest.findUniqueOrThrow({ where: { id: accepted.progress!.requestId } });
      assert.equal(request.autoApproved, false, 'no cap slot was burned on it either');
      assert.equal(request.companyId, null, 'and no shop exists yet');
      const flagged = await client.auditLog.findFirstOrThrow({
        where: { action: 'signup.line.auto_approve_repeat_trial', targetId: accepted.progress!.requestId },
      });
      assert.equal((flagged.metadataJson as any).reason, 'repeat_trial_manual_review');
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * Review B1. The staff QR links an employee's LINE to an account that already holds a membership
   * — in their EMPLOYER's shop. Counting any membership made their OWN first shop a repeat trial:
   * AUTO_FREE stopped opening it, and the queue chip named a company that was never theirs.
   */
  it('opens an employee their first shop without calling it a repeat trial', async () => {
    const client = connect();
    const tag = `linesignup-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const seeded = await seedOldShop(client, tag, lineUserId, 'STAFF');
      await client.company.update({ where: { id: seeded.oldCompanyId }, data: { status: 'ACTIVE' } });
      const h = wire(client, { adminUserId: seeded.adminUserId, lineUserId, approvalMode: 'AUTO_FREE' });
      // They leave that job, their LINE is unlinked, and they open a shop of their own.
      await addBackupLogin(client, seeded.oldUserId);
      await h.unlink.execute({ userId: seeded.oldUserId, requestId: `${tag}-unlink` });

      const accepted = await h.submit.execute(submitCmd(`${tag}-employee`), NOW);

      assert.equal(accepted.progress!.state, 'COMPLETED', 'a first shop is a first shop');
      const submitted = await client.auditLog.findFirstOrThrow({
        where: { action: 'signup.line.submitted', targetId: accepted.progress!.requestId },
      });
      assert.equal((submitted.metadataJson as any).repeatTrial, false);
      assert.equal(
        await client.auditLog.count({ where: { action: 'signup.line.auto_approve_repeat_trial', targetId: accepted.progress!.requestId } }),
        0,
      );
      // And the queue never names the employer's shop as a trial this applicant already had.
      const rows = (await h.queue.list()).items.filter((item) => item.requestId === accepted.progress!.requestId);
      for (const row of rows) assert.equal(row.priorCompanyName, undefined);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * Review LOW-4. An admin starts an employee draft, gives it the OWNER role and never finishes it.
   * That is a half-filled form, not a shop — counting it would send a genuine first-time applicant
   * to manual review and name a company nobody ever opened.
   */
  it('does not treat an abandoned DRAFT membership as a shop this person had', async () => {
    const client = connect();
    const tag = `linesignup-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const seeded = await seedOldShop(client, tag, lineUserId, 'OWNER', 'DRAFT');
      const h = wire(client, { adminUserId: seeded.adminUserId, lineUserId, approvalMode: 'AUTO_FREE' });
      await addBackupLogin(client, seeded.oldUserId);
      await h.unlink.execute({ userId: seeded.oldUserId, requestId: `${tag}-unlink` });

      const accepted = await h.submit.execute(submitCmd(`${tag}-draft`), NOW);

      assert.equal(accepted.progress!.state, 'COMPLETED', 'a draft nobody finished is not a previous trial');
      const submitted = await client.auditLog.findFirstOrThrow({
        where: { action: 'signup.line.submitted', targetId: accepted.progress!.requestId },
      });
      assert.equal((submitted.metadataJson as any).repeatTrial, false);
      const rows = (await h.queue.list()).items.filter((item) => item.requestId === accepted.progress!.requestId);
      for (const row of rows) assert.equal(row.priorCompanyName, undefined);
    } finally {
      await cleanup(client, tag, lineUserId);
      await client.$disconnect();
    }
  });

  /**
   * Review MED-1, the cross-flow race. `link-line-identity` re-points the SAME row from a flow an
   * owner can trigger at any moment. Both sides read then update, so before the shared advisory key
   * the second UPDATE simply waited on the row lock and overwrote the first — a link landing beside
   * a fresh provisioning took the LINE credential off the owner of the shop just built, silently.
   */
  it('lets link and approve contend for one stale slot without either overwriting the other', async () => {
    const client = connect();
    const tag = `linesignup-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    try {
      const seeded = await seedOldShop(client, tag, lineUserId);
      const h = wire(client, { adminUserId: seeded.adminUserId, lineUserId });
      await addBackupLogin(client, seeded.oldUserId);
      await h.unlink.execute({ userId: seeded.oldUserId, requestId: `${tag}-unlink` });

      // The other claimant: a real account with a live shop, linking this same LINE to itself.
      const rivalUserId = `${tag}-rival-user`;
      const rivalCompanyId = `${tag}-rival-company`;
      await client.user.create({ data: { id: rivalUserId, displayName: `${tag} rival`, status: 'ACTIVE' } });
      await client.company.create({ data: { id: rivalCompanyId, name: `ร้านคู่แข่ง ${tag}`, businessCategory: 'RETAIL' } });
      await client.companyMembership.create({ data: { companyId: rivalCompanyId, userId: rivalUserId, status: 'ACTIVE' } });

      const accepted = await h.submit.execute(submitCmd(`${tag}-race`), NOW);
      // The window has to be the DANGEROUS one, not any two calls that happen to overlap.
      // `h.gate` opens the instant provisioning has written the identity row and is still inside
      // its transaction. An unlocked link starting there reads the row as it was BEFORE that write
      // (uncommitted), queues its UPDATE on the row lock, and applies it the moment provisioning
      // commits — overwriting a re-point it never saw. Starting the link any earlier or later
      // cannot reproduce that, which is why an untimed race reported green with no lock at all.
      const [approve, link] = await Promise.allSettled([
        h.queue.decide(
          accepted.progress!.requestId,
          createNewShopDecision(accepted.progress!.version),
          seeded.adminUserId,
          `${tag}-approve`,
          URLS,
        ),
        h.gate.then(() => h.link.execute({ userId: rivalUserId, idToken: 'aaaa.bbbb.cccc', requestId: `${tag}-link` })),
      ]);

      const winners = [approve, link].filter((r) => r.status === 'fulfilled');
      assert.equal(winners.length, 1, 'exactly one claims the slot — never both');
      const loser = [approve, link].find((r) => r.status === 'rejected') as PromiseRejectedResult;
      // Whichever order the lock hands out, the loser is TOLD, by name. `line_identity_already_linked`
      // is provisioning refusing a slot that moved; `line_linked_elsewhere` is the link refusing one.
      // The two carry the name in different places — a bare `message` and a `{ code }` body — so a
      // string match on the exception alone would pass on "something threw", which is not the point.
      const refusal = (error: any) => error?.getResponse?.()?.code ?? error?.message ?? String(error);
      assert.match(refusal(loser.reason), /^(line_identity_already_linked|line_linked_elsewhere)$/);

      const identities = await client.externalIdentity.findMany({
        where: { provider: 'LINE', providerChannelId: CHANNEL, providerUserId: lineUserId },
      });
      assert.equal(identities.length, 1, 'the unique slot still holds exactly one row');
      const request = await client.companySignupRequest.findUniqueOrThrow({ where: { id: accepted.progress!.requestId } });
      const expectedOwner = approve.status === 'fulfilled' ? request.ownerUserId : rivalUserId;
      assert.equal(identities[0]!.userId, expectedOwner, 'and it belongs to the winner, not the last writer');
      assert.equal(identities[0]!.status, 'ACTIVE');
      if (approve.status === 'rejected') {
        // The shop is not lost: the application parks with a code an admin can act on and retry.
        assert.equal(request.state, 'PROVISIONING_FAILED');
        assert.equal(request.failureCode, 'line_identity_already_linked');
      }
      await client.lineCompanyContext.deleteMany({ where: { lineUserId } });
      await client.companyMembership.deleteMany({ where: { userId: rivalUserId } });
      await client.company.deleteMany({ where: { id: rivalCompanyId } });
      await client.user.deleteMany({ where: { id: rivalUserId } });
    } finally {
      await cleanup(client, tag, lineUserId, {
        companyIds: [`${tag}-rival-company`], userIds: [`${tag}-rival-user`],
      });
      await client.$disconnect();
    }
  });

  /**
   * Review B3, defence in depth. Nothing reachable today puts two onboarding runs on one UNLINKED
   * slot — the open-application index and the provisioning claim lock both stand in the way — but
   * the re-point itself was an unguarded read-then-update, so if either of those ever moved, two
   * runs would both claim the row and the loser's shop would stand with no way into it.
   */
  it('lets only ONE of two concurrent runs claim a stale identity', async () => {
    const client = connect();
    const tag = `linesignup-${randomUUID().slice(0, 8)}`;
    const lineUserId = `U${tag}`;
    const built: string[] = [];
    const owners: string[] = [];
    try {
      const seeded = await seedOldShop(client, tag, lineUserId);
      const h = wire(client, { adminUserId: seeded.adminUserId, lineUserId });
      await addBackupLogin(client, seeded.oldUserId);
      await h.unlink.execute({ userId: seeded.oldUserId, requestId: `${tag}-unlink` });

      const race = (suffix: string) => h.onboarding.execute({
        companyName: `ร้านแข่ง ${tag} ${suffix}`,
        businessCategory: 'RETAIL',
        ownerDisplayName: 'นิด',
        ownerAuth: { kind: 'line', providerUserId: lineUserId, channelId: CHANNEL },
        allowDuplicateCompanyName: true,
        requestingAdminUserId: seeded.adminUserId,
        requestId: `${tag}-race-${suffix}`,
        ...URLS,
      });
      const results = await Promise.allSettled([race('a'), race('b')]);
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        built.push(result.value.companyId);
        owners.push(result.value.ownerId);
      }

      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'one run keeps the slot');
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      assert.match(String(loser.reason), /line_identity_already_linked/, 'and the other is told why, by name');

      // The unique index says one row; the audit says it moved exactly once.
      const identities = await client.externalIdentity.findMany({
        where: { provider: 'LINE', providerChannelId: CHANNEL, providerUserId: lineUserId },
      });
      assert.equal(identities.length, 1);
      assert.equal(identities[0]!.userId, owners[0]);
      assert.equal(
        await client.auditLog.count({ where: { action: 'auth.identity.repointed', targetId: `${tag}-identity` } }),
        1,
        'the loser rolled its re-point back with the rest of its transaction',
      );
    } finally {
      await cleanup(client, tag, lineUserId, { companyIds: built, userIds: owners });
      await client.$disconnect();
    }
  });
});
