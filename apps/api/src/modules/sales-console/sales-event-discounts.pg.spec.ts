/**
 * Sales-event discounts (SD-A) against real PostgreSQL. What only a database can show:
 *
 * 1. Every new column round-trips — nothing compares the migration with schema.prisma.
 * 2. The two PARTIAL unique indexes (one first-bill discount per shop; one ticket per shop per
 *    batch) and the CHECKs, which Prisma cannot model and a fake would never enforce.
 * 3. SD-E01/SD-E02 and the permission table of spec §9 through the real service scoping; the route
 *    permissions are also exercised through the real guard (that part needs no database).
 *
 * Run with:
 *   SALES_EVENT_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15498/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/sales-console/sales-event-discounts.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_PAID_TIERS, billingOffer, type SalesEventBatchInput } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { uniqueConstraintFields } from '../../common/database/prisma-error';
import { DenyByDefaultGuard } from '../../common/security/deny-by-default.guard';
import { ROLE_GRANTS } from '../auth/permission-registry';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { PLATFORM_TENANT_ID } from './application/sales-context';
import { SalesEventsService } from './application/sales-events.service';
import { hashSalesEventQrToken } from './domain/sales-event-claim.logic';
import { SalesEventsController } from './presentation/http/sales-events.controller';

const databaseUrl = process.env.SALES_EVENT_TEST_DATABASE_URL;
const MINUTE = 60_000;

function ctx(userId: string, role: string, companyId = PLATFORM_TENANT_ID): RequestContext {
  return {
    requestId: `req-${randomUUID().slice(0, 8)}`, authSubject: userId, userId, companyId,
    membershipId: `m-${userId}`, roles: [role], permissions: [...(ROLE_GRANTS[role] ?? [])],
    scopes: {}, authProvider: 'watchdog',
  };
}

async function reason(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'no-error';
  } catch (error) {
    const response = (error as { response?: { code?: string } }).response;
    return response?.code ?? (error as Error).constructor.name;
  }
}

async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'no-error';
  } catch (error) {
    const fields = uniqueConstraintFields(error);
    return fields ? `unique:${fields.join(',')}` : `${(error as Error).message} ${JSON.stringify(error)}`;
  }
}

// ── §9 through the real permission guard and the platform-tenant check (no database) ──────────

describe('sales-event routes, permission table of spec §9', () => {
  const guard = new DenyByDefaultGuard(new Reflector());
  const proto = SalesEventsController.prototype as unknown as Record<string, () => unknown>;
  const allowed = (method: string, role: string) => {
    try {
      return guard.canActivate({
        getHandler: () => proto[method]!, getClass: () => SalesEventsController,
        switchToHttp: () => ({ getRequest: () => ({ context: ctx('someone', role) }) }),
      } as unknown as ExecutionContext);
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  };

  it('lets a lead and SYSTEM_ADMIN manage, and never a seller or a shop owner', () => {
    for (const method of ['create', 'update', 'changeState', 'searchAgents', 'revoke']) {
      assert.equal(allowed(method, 'SYSTEM_ADMIN'), true, `admin ${method}`);
      assert.equal(allowed(method, 'MANGMEE_SALES_LEAD'), true, `lead ${method}`);
      assert.equal(allowed(method, 'MANGMEE_SALES'), false, `seller ${method}`);
      assert.equal(allowed(method, 'OWNER'), false, `shop owner ${method}`);
    }
  });

  it('lets every sales role read and show a QR, and no shop role', () => {
    for (const method of ['list', 'get', 'issueQr', 'tickets']) {
      for (const role of ['SYSTEM_ADMIN', 'MANGMEE_SALES_LEAD', 'MANGMEE_SALES']) assert.equal(allowed(method, role), true, `${role} ${method}`);
      for (const role of ['OWNER', 'SALES', 'COMPANY_VIEW']) assert.equal(allowed(method, role), false, `${role} ${method}`);
    }
  });

  it('refuses a caller outside the platform tenant even with a sales permission', async () => {
    const controller = new SalesEventsController({} as never);
    const outsider = ctx('lead-elsewhere', 'MANGMEE_SALES_LEAD', 'some-shop');
    assert.throws(() => controller.list(undefined, { context: outsider } as never), ForbiddenException);
    assert.throws(() => controller.issueQr('batch', { context: outsider } as never), ForbiddenException);
  });
});

// ── against PostgreSQL ────────────────────────────────────────────────────────────────────────

async function harness() {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  // Same rule as sales-console.pg.spec.ts: localhost is not proof of a local database (the prod
  // tunnel is 127.0.0.1 too), so the database NAME must be a disposable one.
  const disposable = url.pathname === '/watchdog_bms' || url.pathname === '/email_otp_test' || url.pathname.endsWith('_ci');
  assert.ok(disposable, `refusing to write to ${url.pathname}: only a disposable test database is allowed`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const tag = `sev-${randomUUID().slice(0, 8)}`;
  const audited: Array<Record<string, unknown>> = [];
  const audit = { async log(entry: Record<string, unknown>) { audited.push(entry); } } as never;
  // Today's catalog: the code prices (STARTER ฿249 a month), priced like a NOT_VAT policy.
  const offers = BILLING_PAID_TIERS.flatMap((tier) => (['month', 'year'] as const).map((interval) => billingOffer(tier, interval)));
  const billing = { catalog: async () => ({ offers, taxTreatment: 'NOT_VAT_REGISTERED' as const }) } as never;
  const service = new SalesEventsService({ client } as never, audit, { lineLiffId: 'event-liff-1' } as never, billing);

  await client.company.upsert({
    where: { id: PLATFORM_TENANT_ID }, update: {},
    create: { id: PLATFORM_TENANT_ID, name: 'มั่งมีพลัส · ระบบภายใน', status: 'ACTIVE' },
  });
  const users = {
    leadA: `${tag}-lead-a`, agentA1: `${tag}-agent-a1`, agentA2: `${tag}-agent-a2`, suspended: `${tag}-agent-sx`,
    leadB: `${tag}-lead-b`, agentB1: `${tag}-agent-b1`, admin: `${tag}-admin`,
  };
  const team: Array<[string, string | null, string]> = [
    [users.leadA, null, 'ACTIVE'], [users.agentA1, users.leadA, 'ACTIVE'], [users.agentA2, users.leadA, 'ACTIVE'],
    [users.suspended, users.leadA, 'SUSPENDED'], [users.leadB, null, 'ACTIVE'], [users.agentB1, users.leadB, 'ACTIVE'],
  ];
  for (const [id, lead, status] of team) {
    await client.user.create({ data: { id, username: id, displayName: `ชื่อ ${id.slice(-8)}`, status: 'ACTIVE' } });
    await client.salesAgentProfile.create({
      data: { userId: id, teamLeadUserId: lead, salesCode: randomUUID().slice(0, 6).toUpperCase(), status, createdByUserId: users.leadA },
    });
  }
  await client.user.create({ data: { id: users.admin, username: users.admin, displayName: 'ผู้ดูแลระบบ', status: 'ACTIVE' } });

  const now = Date.now();
  const batchInput = (overrides: Partial<SalesEventBatchInput> = {}): SalesEventBatchInput => ({
    eventName: `${tag} งานแฟร์`, batchName: 'บูธ A', discountSatang: 10000, rewardChatCreditUnits: 5000, rewardReceiptImageUnits: 20,
    issueCap: 100, claimStartsAt: new Date(now - 10 * MINUTE).toISOString(), claimEndsAt: new Date(now + 24 * 60 * MINUTE).toISOString(),
    scope: { tiers: [...BILLING_PAID_TIERS], intervals: ['month', 'year'] }, agentUserIds: [users.agentA1], ...overrides,
  });

  let serial = 0;
  const ticket = (batchId: string, data: Record<string, unknown> = {}) => {
    serial += 1;
    return client.salesEventTicket.create({
      data: {
        serial: `${tag.slice(4, 8).toUpperCase()}${String(serial).padStart(4, '0')}`, batchId, batchRevision: 1,
        salesUserId: users.agentA1, holderChannelId: `${tag}-channel`, holderProviderUserId: `${tag}-holder-${serial}`,
        discountSatang: 10000, rewardChatCreditUnits: 5000, rewardReceiptImageUnits: 20,
        scopeJson: { tiers: ['STARTER_249'], intervals: ['month'] }, expiresAt: new Date(now + 30 * 24 * 60 * MINUTE),
        claimRequestKey: `${tag}-claim-${serial}`, ...data,
      } as never,
    });
  };

  return {
    client, tag, users, service, audited, batchInput, ticket,
    lead: ctx(users.leadA, 'MANGMEE_SALES_LEAD'), leadB: ctx(users.leadB, 'MANGMEE_SALES_LEAD'),
    agentA1: ctx(users.agentA1, 'MANGMEE_SALES'), agentA2: ctx(users.agentA2, 'MANGMEE_SALES'),
    agentB1: ctx(users.agentB1, 'MANGMEE_SALES'), admin: ctx(users.admin, 'SYSTEM_ADMIN'),
    async teardown() {
      const batches = await client.salesEventBatch.findMany({ where: { eventName: { startsWith: tag } }, select: { id: true } });
      const ids = batches.map((batch) => batch.id);
      await client.salesEventTicket.deleteMany({ where: { batchId: { in: ids } } });
      await client.salesEventBatch.deleteMany({ where: { id: { in: ids } } });
      await client.salesAgentProfile.deleteMany({ where: { userId: { startsWith: tag } } });
      await client.user.deleteMany({ where: { id: { startsWith: tag } } });
      await client.$disconnect();
    },
  };
}

describe('sales-event discounts on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('round-trips every new column of the four tables', async () => {
    const h = await harness();
    try {
      const created = await h.service.create(h.lead, h.batchInput({ agentUserIds: [h.users.agentA1, h.users.agentA2] }));
      const batch = await h.client.salesEventBatch.findUniqueOrThrow({ where: { id: created.id }, include: { agents: true } });
      assert.equal(batch.eventName, `${h.tag} งานแฟร์`);
      assert.equal(batch.batchName, 'บูธ A');
      assert.deepEqual([batch.discountSatang, batch.rewardChatCreditUnits, batch.rewardReceiptImageUnits], [10000, 5000, 20]);
      assert.deepEqual([batch.issueCap, batch.issuedCount, batch.state, batch.revision, batch.version], [100, 0, 'OPEN', 1, 1]);
      assert.deepEqual(batch.scopeJson, { tiers: [...BILLING_PAID_TIERS], intervals: ['month', 'year'] });
      assert.ok(batch.claimEndsAt > batch.claimStartsAt && batch.createdAt instanceof Date && batch.updatedAt instanceof Date);
      assert.equal(batch.createdByUserId, h.users.leadA);
      assert.deepEqual(batch.agents.map((agent) => [agent.salesUserId, agent.active, agent.addedByUserId, agent.removedAt]).sort(),
        [[h.users.agentA1, true, h.users.leadA, null], [h.users.agentA2, true, h.users.leadA, null]]);
      assert.ok(batch.agents.every((agent) => agent.addedAt instanceof Date));

      const qr = await h.service.issueQr(h.agentA1, created.id, 'https://api.example.test/v1');
      const token = await h.client.salesEventQrToken.findFirstOrThrow({ where: { batchId: created.id } });
      assert.match(token.tokenHash, /^[0-9a-f]{64}$/);
      assert.deepEqual([token.salesUserId, token.batchRevision], [h.users.agentA1, 1]);
      assert.equal(token.expiresAt.toISOString(), qr.expiresAt);
      assert.ok(token.createdAt instanceof Date && token.id);

      const used = await h.ticket(created.id, {
        state: 'USED', redeemedAs: 'DISCOUNT', companyId: `${h.tag}-shop`, attemptId: `${h.tag}-attempt`, invoiceId: `${h.tag}-invoice`,
        appliedDiscountSatang: 10000, redeemRequestKey: `${h.tag}-redeem`, reservedAt: new Date(), usedAt: new Date(),
      });
      const revoked = await h.ticket(created.id, {
        state: 'REVOKED', revokedAt: new Date(), revokedByUserId: h.users.leadA, revokeReason: 'แจกผิดคน',
      });
      const back = await h.client.salesEventTicket.findUniqueOrThrow({ where: { id: used.id } });
      assert.equal(back.holderProvider, 'LINE');
      assert.deepEqual(
        [back.serial, back.batchRevision, back.salesUserId, back.holderChannelId, back.discountSatang, back.rewardChatCreditUnits,
          back.rewardReceiptImageUnits, back.state, back.redeemedAs, back.companyId, back.attemptId, back.invoiceId,
          back.appliedDiscountSatang, back.claimRequestKey, back.redeemRequestKey, back.version],
        [used.serial, 1, h.users.agentA1, `${h.tag}-channel`, 10000, 5000, 20, 'USED', 'DISCOUNT', `${h.tag}-shop`,
          `${h.tag}-attempt`, `${h.tag}-invoice`, 10000, used.claimRequestKey, `${h.tag}-redeem`, 1],
      );
      assert.deepEqual(back.scopeJson, { tiers: ['STARTER_249'], intervals: ['month'] });
      assert.ok(back.holderProviderUserId && back.expiresAt && back.reservedAt && back.usedAt && back.createdAt && back.updatedAt);
      const revokedBack = await h.client.salesEventTicket.findUniqueOrThrow({ where: { id: revoked.id } });
      assert.deepEqual([revokedBack.revokedByUserId, revokedBack.revokeReason], [h.users.leadA, 'แจกผิดคน']);
      assert.ok(revokedBack.revokedAt instanceof Date);
    } finally {
      await h.teardown();
    }
  });

  it('allows one ticket per shop per batch (partial unique); another batch is the checkout\'s per-event call (SD-O12)', async () => {
    const h = await harness();
    try {
      const one = await h.service.create(h.lead, h.batchInput());
      const two = await h.service.create(h.lead, h.batchInput({ batchName: 'บูธ B' }));
      const shop = `${h.tag}-shop-c`, other = `${h.tag}-shop-d`;
      await h.ticket(one.id, { state: 'USED', redeemedAs: 'DISCOUNT', companyId: shop, attemptId: `${h.tag}-a1`, invoiceId: `${h.tag}-i1` });
      // SD-O12 (Owner 2026-09-29) dropped SD-O5's lifetime index: a discount from another batch at the same shop is not refused
      // by the database. One ticket per shop per EVENT is decided in the checkout transaction, after the company lock.
      assert.equal(await failure(() => h.ticket(two.id, { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: shop, attemptId: `${h.tag}-a2` })), 'no-error');
      // SD-Q8: one ticket per shop per batch, whichever way — batch one already has the shop's discount, batch two its reservation.
      assert.equal(await failure(() => h.ticket(one.id, { state: 'USED', redeemedAs: 'CREDIT', companyId: shop })), 'unique:batchId,companyId');
      assert.equal(await failure(() => h.ticket(two.id, { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: shop, attemptId: `${h.tag}-a3` })),
        'unique:batchId,companyId');
      const reserved = await h.ticket(two.id, { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: other, attemptId: `${h.tag}-a4` });
      // Releasing a reservation frees its slot again.
      await h.client.salesEventTicket.update({
        where: { id: reserved.id }, data: { state: 'ISSUED', redeemedAs: null, companyId: null, attemptId: null },
      });
      await h.ticket(two.id, { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: other, attemptId: `${h.tag}-a5` });
    } finally {
      await h.teardown();
    }
  });

  it('holds the CHECKs: a reward, the cap, the window and a consistent ticket state', async () => {
    const h = await harness();
    try {
      const base = {
        eventName: `${h.tag} ตรวจ`, batchName: 'x', issueCap: 1, claimStartsAt: new Date(), claimEndsAt: new Date(Date.now() + MINUTE),
        scopeJson: {}, createdByUserId: h.users.leadA,
      };
      assert.match(await failure(() => h.client.salesEventBatch.create({ data: { ...base, discountSatang: 0 } })), /SalesEventBatch_reward_check/);
      assert.match(await failure(() => h.client.salesEventBatch.create({ data: { ...base, discountSatang: 10050 } })), /SalesEventBatch_reward_check/);
      assert.match(await failure(() => h.client.salesEventBatch.create({ data: { ...base, discountSatang: 100, claimEndsAt: base.claimStartsAt } })),
        /SalesEventBatch_window_check/);
      assert.match(await failure(() => h.client.salesEventBatch.create({ data: { ...base, discountSatang: 100, state: 'CLOSED' } })),
        /SalesEventBatch_state_check/);
      const batch = await h.client.salesEventBatch.create({ data: { ...base, discountSatang: 100 } });
      assert.match(await failure(() => h.client.salesEventBatch.update({ where: { id: batch.id }, data: { issuedCount: 2 } })),
        /SalesEventBatch_issue_check/);
      assert.match(await failure(() => h.ticket(batch.id, { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: `${h.tag}-shop` })),
        /SalesEventTicket_state_check/);
      assert.match(await failure(() => h.ticket(batch.id, { state: 'RESERVED', redeemedAs: 'CREDIT', companyId: `${h.tag}-shop`, attemptId: 'a' })),
        /SalesEventTicket_state_check/);
      assert.match(await failure(() => h.ticket(batch.id, { companyId: `${h.tag}-shop` })), /SalesEventTicket_state_check/);
      assert.match(await failure(() => h.ticket(batch.id, { state: 'REVOKED' })), /SalesEventTicket_revoke_check/);
    } finally {
      await h.teardown();
    }
  });

  it('SD-E01: a lead creates a batch for their own team only, checked against today\'s prices, audited', async () => {
    const h = await harness();
    try {
      const made = await h.service.create(h.lead, h.batchInput({
        claimStartsAt: new Date('2026-10-01T09:00+07:00').toISOString(), claimEndsAt: new Date('2099-10-03T18:00+07:00').toISOString(),
        scope: { tiers: ['PRO_999', 'STARTER_249'], intervals: ['year'] },
      }));
      assert.equal(made.claimStartsAt, '2026-10-01T02:00:00.000Z', 'Thai time is stored as the UTC instant');
      assert.deepEqual(made.scope, { tiers: ['STARTER_249', 'PRO_999'], intervals: ['year'] });
      assert.deepEqual([made.state, made.canManage, made.isDistributor], ['OPEN', true, false]);
      const audit = h.audited.find((entry) => entry.targetId === made.id);
      assert.equal(audit?.action, 'sales.event.batch_created');
      assert.equal((audit?.metadataJson as { discountSatang?: number }).discountSatang, 10000);

      assert.equal(await reason(() => h.service.create(h.lead, h.batchInput({ agentUserIds: [h.users.agentB1] }))), 'SALES_AGENT_NOT_FOUND');
      assert.equal(await reason(() => h.service.create(h.lead, h.batchInput({ agentUserIds: [h.users.suspended] }))), 'SALES_AGENT_NOT_FOUND');
      assert.equal(await reason(() => h.service.create(h.admin, h.batchInput({ agentUserIds: [h.users.agentB1, h.users.agentA1] }))), 'no-error');
      assert.equal(await reason(() => h.service.create(h.lead, h.batchInput({
        discountSatang: 0, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0,
      }))), 'SALES_EVENT_REWARD_REQUIRED');
      assert.equal(await reason(() => h.service.create(h.lead, h.batchInput({ discountSatang: 10050 }))), 'SALES_EVENT_BATCH_INVALID');

      // ฿249 − ฿240 = ฿9: under the ฿10 floor for STARTER monthly, and the 400 names it.
      let body: Record<string, unknown> = {};
      try {
        await h.service.create(h.lead, h.batchInput({ discountSatang: 24000 }));
      } catch (error) {
        body = (error as { response: Record<string, unknown> }).response;
      }
      assert.deepEqual([body.code, body.offerKey, body.interval], ['SALES_EVENT_DISCOUNT_TOO_HIGH', 'STARTER_249', 'month']);
      assert.equal(await reason(() => h.service.create(h.lead, h.batchInput({
        discountSatang: 24000, scope: { tiers: ['BASIC_499', 'PRO_999'], intervals: ['month', 'year'] },
      }))), 'no-error');
      assert.equal(await reason(() => h.service.create(h.lead, h.batchInput({ discountSatang: 23900 }))), 'no-error', 'exactly ฿10 left is allowed');
    } finally {
      await h.teardown();
    }
  });

  it('SD-E02: a QR only for an active distributor of an open batch, valid until the batch closes (SD-O11)', async () => {
    const h = await harness();
    try {
      const batch = await h.service.create(h.lead, h.batchInput());
      const qr = await h.service.issueQr(h.agentA1, batch.id, 'https://api.example.test/v1');
      assert.match(qr.qrImageUrl, /^data:image\/svg\+xml;base64,/);
      // Owner 2026-09-29: no five-minute clock — printable, valid until the claim end.
      assert.equal(qr.expiresAt, batch.claimEndsAt);
      const stored = await h.client.salesEventQrToken.findMany({ where: { batchId: batch.id } });
      assert.equal(stored.length, 1);
      assert.equal(stored[0]!.expiresAt.toISOString(), batch.claimEndsAt);
      assert.equal(JSON.stringify(h.audited).includes(stored[0]!.tokenHash), false, 'the hash is not copied into the audit row');
      assert.equal(hashSalesEventQrToken('x').length, 64);

      assert.equal(await reason(() => h.service.issueQr(h.agentA2, batch.id, 'x')), 'SALES_EVENT_AGENT_INACTIVE');
      assert.equal(await reason(() => h.service.issueQr(h.lead, batch.id, 'x')), 'SALES_EVENT_AGENT_INACTIVE');

      const paused = await h.service.changeState(h.lead, batch.id, { action: 'PAUSE', expectedVersion: batch.version });
      assert.equal(await reason(() => h.service.issueQr(h.agentA1, batch.id, 'x')), 'SALES_EVENT_CLAIM_CLOSED');
      const resumed = await h.service.changeState(h.lead, batch.id, { action: 'RESUME', expectedVersion: paused.version });
      assert.equal(await reason(() => h.service.issueQr(h.agentA1, batch.id, 'x')), 'no-error');

      const later = await h.service.create(h.lead, h.batchInput({ claimStartsAt: new Date(Date.now() + 60 * MINUTE).toISOString() }));
      assert.equal(await reason(() => h.service.issueQr(h.agentA1, later.id, 'x')), 'SALES_EVENT_CLAIM_CLOSED');

      await h.client.salesEventBatch.update({ where: { id: batch.id }, data: { issueCap: 3, issuedCount: 3 } });
      assert.equal(await reason(() => h.service.issueQr(h.agentA1, batch.id, 'x')), 'SALES_EVENT_ISSUE_FULL');
      await h.client.salesEventBatch.update({ where: { id: batch.id }, data: { issueCap: 100 } });

      // Taking a seller off the batch stops their QR at once; the row stays for their tickets.
      const current = await h.service.get(h.lead, batch.id);
      assert.equal(current.version, resumed.version, 'a QR press never bumps the batch version');
      await h.service.update(h.lead, batch.id, {
        ...h.batchInput({ agentUserIds: [h.users.agentA2] }), claimStartsAt: current.claimStartsAt, claimEndsAt: current.claimEndsAt,
        expectedVersion: current.version,
      });
      assert.equal(await reason(() => h.service.issueQr(h.agentA1, batch.id, 'x')), 'SALES_EVENT_AGENT_INACTIVE');
      assert.equal(await reason(() => h.service.issueQr(h.agentA2, batch.id, 'x')), 'no-error');
      const removed = await h.client.salesEventBatchAgent.findUniqueOrThrow({
        where: { batchId_salesUserId: { batchId: batch.id, salesUserId: h.users.agentA1 } },
      });
      assert.equal(removed.active, false);
      assert.ok(removed.removedAt instanceof Date);

      // A suspended account cannot show a QR even while still assigned.
      await h.client.salesAgentProfile.update({ where: { userId: h.users.agentA2 }, data: { status: 'SUSPENDED' } });
      assert.equal(await reason(() => h.service.issueQr(h.agentA2, batch.id, 'x')), 'SALES_EVENT_AGENT_INACTIVE');
    } finally {
      await h.teardown();
    }
  });

  it('an edit is a new revision fenced by version, and the cap never drops below what went out', async () => {
    const h = await harness();
    try {
      const batch = await h.service.create(h.lead, h.batchInput());
      const edit = { ...h.batchInput({ batchName: 'บูธ A ใหม่' }), claimStartsAt: batch.claimStartsAt, claimEndsAt: batch.claimEndsAt };
      assert.equal(await reason(() => h.service.update(h.lead, batch.id, { ...edit, expectedVersion: batch.version + 1 })), 'SALES_EVENT_BATCH_STALE');
      await h.client.salesEventBatch.update({ where: { id: batch.id }, data: { issuedCount: 5 } });
      assert.equal(await reason(() => h.service.update(h.lead, batch.id, { ...edit, issueCap: 4, expectedVersion: batch.version })),
        'SALES_EVENT_BATCH_INVALID');
      const saved = await h.service.update(h.lead, batch.id, { ...edit, issueCap: 5, expectedVersion: batch.version });
      assert.deepEqual([saved.batchName, saved.issueCap, saved.revision, saved.version], ['บูธ A ใหม่', 5, 2, batch.version + 1]);
      const audit = h.audited.find((entry) => entry.action === 'sales.event.batch_updated');
      assert.equal((audit?.metadataJson as { before: { batchName: string } }).before.batchName, 'บูธ A');
      // Another lead cannot touch it, and says nothing about it existing.
      assert.equal(await reason(() => h.service.update(h.leadB, batch.id, { ...edit, expectedVersion: saved.version })), 'SALES_EVENT_NOT_FOUND');
    } finally {
      await h.teardown();
    }
  });

  it('walks the batch states, with a reason to suspend and lift, and refuses a stale screen', async () => {
    const h = await harness();
    try {
      const batch = await h.service.create(h.lead, h.batchInput());
      assert.equal(await reason(() => h.service.changeState(h.lead, batch.id, { action: 'SUSPEND', expectedVersion: batch.version })),
        'SALES_EVENT_BATCH_INVALID');
      const suspended = await h.service.changeState(h.lead, batch.id, { action: 'SUSPEND', expectedVersion: batch.version, reason: 'แจกผิดงาน' });
      assert.equal(suspended.state, 'SUSPENDED');
      assert.equal(await reason(() => h.service.changeState(h.lead, batch.id, { action: 'RESUME', expectedVersion: suspended.version })),
        'SALES_EVENT_BATCH_STALE');
      assert.equal(await reason(() => h.service.changeState(h.lead, batch.id, { action: 'LIFT', expectedVersion: batch.version, reason: 'ตรวจแล้ว' })),
        'SALES_EVENT_BATCH_STALE');
      const lifted = await h.service.changeState(h.lead, batch.id, { action: 'LIFT', expectedVersion: suspended.version, reason: 'ตรวจแล้ว' });
      assert.equal(lifted.state, 'PAUSED');
      const moves = h.audited.filter((entry) => entry.action === 'sales.event.batch_state_changed').map((entry) => entry.metadataJson);
      assert.deepEqual(moves, [
        { action: 'SUSPEND', from: 'OPEN', to: 'SUSPENDED', reason: 'แจกผิดงาน' },
        { action: 'LIFT', from: 'SUSPENDED', to: 'PAUSED', reason: 'ตรวจแล้ว' },
      ]);
    } finally {
      await h.teardown();
    }
  });

  it('shows each role exactly its batches and tickets, and never who holds a ticket (spec §9)', async () => {
    const h = await harness();
    try {
      const own = await h.service.create(h.lead, h.batchInput({ agentUserIds: [h.users.agentA1] }));
      const teamB = await h.service.create(h.admin, h.batchInput({ agentUserIds: [h.users.agentB1] }));
      const teamA = await h.service.create(h.admin, h.batchInput({ agentUserIds: [h.users.agentA2] }));
      const ids = async (who: RequestContext) => new Set((await h.service.list(who)).items.map((batch) => batch.id));

      const lead = await ids(h.lead);
      assert.ok(lead.has(own.id) && lead.has(teamA.id) && !lead.has(teamB.id), 'lead: own and team, not another team');
      const leadB = await ids(h.leadB);
      assert.ok(leadB.has(teamB.id) && !leadB.has(own.id) && !leadB.has(teamA.id));
      const agent = await ids(h.agentA1);
      assert.ok(agent.has(own.id) && !agent.has(teamA.id) && !agent.has(teamB.id), 'seller: assigned only');
      const admin = await ids(h.admin);
      assert.ok(admin.has(own.id) && admin.has(teamA.id) && admin.has(teamB.id));
      assert.equal((await h.service.get(h.lead, teamA.id)).canManage, false, 'a team batch the admin made is visible, not manageable');
      assert.equal((await h.service.get(h.admin, own.id)).canManage, true);
      assert.equal(await reason(() => h.service.get(h.agentA1, teamB.id)), 'SALES_EVENT_NOT_FOUND');
      assert.equal(await reason(() => h.service.changeState(h.lead, teamA.id, { action: 'PAUSE', expectedVersion: teamA.version })),
        'SALES_EVENT_NOT_FOUND');

      await h.ticket(own.id, { salesUserId: h.users.agentA1 });
      await h.ticket(own.id, { salesUserId: h.users.agentA2 });
      await h.ticket(own.id, { salesUserId: h.users.agentA1, expiresAt: new Date(Date.now() - MINUTE) });
      const mine = await h.service.tickets(h.agentA1, own.id);
      assert.deepEqual(mine.items.map((ticket) => ticket.salesUserId), [h.users.agentA1, h.users.agentA1]);
      assert.deepEqual(mine.items.map((ticket) => ticket.state).sort(), ['AVAILABLE', 'EXPIRED']);
      assert.equal((await h.service.tickets(h.lead, own.id)).items.length, 3);
      for (const view of mine.items) {
        assert.equal(Object.keys(view).some((key) => /holder|channel|company|attempt|invoice/i.test(key)), false, Object.keys(view).join());
      }
      const counts = (await h.service.get(h.agentA1, own.id)).counts;
      assert.deepEqual([counts.issued, counts.available, counts.expired], [2, 1, 1], 'a seller counts only what they handed out');
      assert.equal((await h.service.get(h.lead, own.id)).counts.issued, 3);
    } finally {
      await h.teardown();
    }
  });

  it('revokes an unused ticket only, with a reason, fenced by version, without giving the cap back', async () => {
    const h = await harness();
    try {
      const batch = await h.service.create(h.lead, h.batchInput());
      await h.client.salesEventBatch.update({ where: { id: batch.id }, data: { issuedCount: 3 } });
      const unused = await h.ticket(batch.id);
      const inPayment = await h.ticket(batch.id, { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: `${h.tag}-shop`, attemptId: `${h.tag}-a` });
      const used = await h.ticket(batch.id, { state: 'USED', redeemedAs: 'CREDIT', companyId: `${h.tag}-shop-2` });

      assert.equal(await reason(() => h.service.revoke(h.lead, unused.id, { reason: 'แจกผิดคน', expectedVersion: unused.version + 1 })),
        'SALES_EVENT_BATCH_STALE');
      assert.equal(await reason(() => h.service.revoke(h.leadB, unused.id, { reason: 'x', expectedVersion: unused.version })), 'SALES_EVENT_NOT_FOUND');
      const view = await h.service.revoke(h.lead, unused.id, { reason: ' แจกผิดคน ', expectedVersion: unused.version });
      assert.deepEqual([view.state, view.revokeReason], ['REVOKED', 'แจกผิดคน']);
      for (const ticket of [inPayment, used]) {
        assert.equal(await reason(() => h.service.revoke(h.lead, ticket.id, { reason: 'x', expectedVersion: ticket.version })),
          'SALES_EVENT_TICKET_NOT_REVOCABLE');
      }
      assert.equal((await h.client.salesEventBatch.findUniqueOrThrow({ where: { id: batch.id } })).issuedCount, 3);
      assert.ok(h.audited.some((entry) => entry.action === 'sales.event.ticket_revoked' && entry.targetId === unused.id));
    } finally {
      await h.teardown();
    }
  });

  it('searches sellers in the lead\'s own team (everyone for admin), ACTIVE only, 50 a page', async () => {
    const h = await harness();
    try {
      const names = async (who: RequestContext, q?: string) => (await h.service.searchAgents(who, q)).items.map((agent) => agent.userId);
      const lead = await names(h.lead, h.tag);
      assert.ok(lead.includes(h.users.leadA) && lead.includes(h.users.agentA1) && lead.includes(h.users.agentA2));
      assert.ok(!lead.includes(h.users.suspended) && !lead.includes(h.users.agentB1), 'suspended and other-team sellers are not offered');
      const admin = await names(h.admin, h.tag);
      assert.ok(admin.includes(h.users.agentB1) && admin.includes(h.users.agentA1));
      const code = (await h.client.salesAgentProfile.findUniqueOrThrow({ where: { userId: h.users.agentA2 } })).salesCode;
      assert.deepEqual(await names(h.lead, code.toLowerCase()), [h.users.agentA2], 'a sales code finds its owner');

      const extra = Array.from({ length: 51 }, (_, index) => `${h.tag}-many-${String(index).padStart(2, '0')}`);
      await h.client.user.createMany({ data: extra.map((id) => ({ id, username: id, displayName: `${h.tag} คนที่ ${id.slice(-2)}`, status: 'ACTIVE' })) });
      await h.client.salesAgentProfile.createMany({
        data: extra.map((id) => ({ userId: id, teamLeadUserId: h.users.leadA, salesCode: randomUUID().slice(0, 6).toUpperCase(), status: 'ACTIVE', createdByUserId: h.users.leadA })),
      });
      const first = await h.service.searchAgents(h.lead, `${h.tag} คนที่`);
      assert.equal(first.items.length, 50);
      assert.ok(first.nextCursor);
      const second = await h.service.searchAgents(h.lead, `${h.tag} คนที่`, first.nextCursor!);
      assert.equal(second.items.length, 1);
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map((agent) => agent.userId)).size, 51);
    } finally {
      await h.teardown();
    }
  });
});
