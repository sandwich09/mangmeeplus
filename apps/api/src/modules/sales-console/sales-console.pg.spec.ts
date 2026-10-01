/**
 * The sales console against real PostgreSQL. Everything here depends on behaviour an in-memory
 * fake cannot show:
 *
 * 1. The two PARTIAL unique indexes. "One non-final deal per company" and the customer's
 *    pre-existing "one OPEN request per company" are database predicates, not application checks,
 *    and the whole S18 design rests on deal rows never colliding with the customer's slot.
 * 2. The Prisma 7 driver adapter's P2002 shape (`meta.driverAdapterError`, never `meta.target`) —
 *    the repo has already shipped one 500 from reading the wrong place.
 * 3. Optimistic concurrency: two approvals racing the same version must not both win.
 * 4. That a lead's list DTO and the audit trail carry no agent PII.
 *
 * Run with:
 *   SALES_CONSOLE_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15498/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/sales-console/sales-console.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import type { SalesAgentSelfProfileInput } from '@watchdog-bms/contracts';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { SalesAgentsService } from './application/sales-agents.service';
import { SalesCompanySearchService } from './application/sales-company-search.service';
import { SalesDealsService } from './application/sales-deals.service';
import { SalesReferralService } from './application/sales-referral.service';
import { PLATFORM_TENANT_ID } from './application/sales-context';
import { SalesSelfProfileDto, SalesTeamCreateDto } from './presentation/http/sales.controller';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../common/pipes/validation-pipe.options';
import { encryptCredential } from '../system-partner-management/domain/logic/credential-cipher.logic';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { applyDealRequest, recordReferralAttribution } from '../billing/application/billing-package-request';
import { quoteTotals } from '../billing/domain/billing-policy';

const databaseUrl = process.env.SALES_CONSOLE_TEST_DATABASE_URL;

const LEAD_PERMISSIONS = ['sales.console.read', 'sales.company.search', 'sales.deal.create',
  'sales.deal.approve', 'sales.team.manage', 'sales.report.read'];
const AGENT_PERMISSIONS = ['sales.console.read', 'sales.company.search', 'sales.deal.create'];

/** AES-256-GCM needs 32 bytes; the value itself is irrelevant to what these cases assert. */
const config = { credentialEncryptionKey: Buffer.alloc(32, 7), webBaseUrl: 'https://app.example.test' };
const noLine = { get: async () => null } as never;
const logger = { warn() {}, error() {}, info() {} } as never;

function ctx(userId: string, roles: string[], permissions: string[]): RequestContext {
  return {
    requestId: `req-${randomUUID().slice(0, 8)}`, authSubject: userId, userId,
    companyId: PLATFORM_TENANT_ID, membershipId: `m-${userId}`, roles, permissions,
    scopes: {}, authProvider: 'watchdog',
  };
}

function snapshotBody(companyId: string) {
  return {
    companyId, base: 'BASIC_499' as const, priceSatang: 39900, months: 12,
    branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50, featureKeys: [],
    aiMonthlyBudgetSatang: null, description: 'ข้อเสนอพิเศษสำหรับร้านคุณ',
    internalReason: 'ลูกค้าเก่าต่อสัญญา',
  };
}

async function harness() {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  // Localhost is NOT proof of a local database: the production recipe port-forwards prod to
  // 127.0.0.1 through SSM on the same host and port shape. This spec writes real rows, so the
  // database NAME has to be one of the disposable ones too — the local docker database, CI's
  // isolated service container, or any `*_ci` scratch database. No production database is named
  // like this, so a mistyped tunnel is refused before a single row is written.
  const disposable = url.pathname === '/watchdog_bms'
    || url.pathname === '/email_otp_test'
    || url.pathname.endsWith('_ci');
  assert.ok(disposable, `refusing to write to ${url.pathname}: only a disposable test database is allowed`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const tag = `sales-${randomUUID().slice(0, 8)}`;

  const audited: Array<Record<string, unknown>> = [];
  const audit = {
    async log(entry: Record<string, unknown>) { audited.push(entry); },
    async logOrThrow(entry: Record<string, unknown>) { audited.push(entry); },
  } as never;
  const prisma = { client } as never;

  const companies = new SalesCompanySearchService(prisma, audit);
  // Phase 5: the deal price writer is a Stripe-side collaborator. This suite never approves an
  // auto-renewing deal, so a stub that refuses is exactly what the one-time paths expect.
  const prices = { ensure: async () => 'SKIPPED' as const, archive: async () => false,
    sweep: async () => ({ provisioned: 0, archived: 0, returnsQueued: 0 }) } as never;
  const deals = new SalesDealsService(prisma, audit, companies, noLine, config as never, prices, logger);
  const agents = new SalesAgentsService(prisma, audit, config as never, noLine);
  const referral = new SalesReferralService(prisma, audit);

  // The platform tenant and the two system roles this module assigns.
  await client.company.upsert({
    where: { id: PLATFORM_TENANT_ID }, update: {},
    create: { id: PLATFORM_TENANT_ID, name: 'มั่งมีพลัส · ระบบภายใน', status: 'ACTIVE' },
  });
  for (const key of ['MANGMEE_SALES_LEAD', 'MANGMEE_SALES']) {
    await client.role.upsert({
      where: { scopeKey_key: { scopeKey: 'system', key } }, update: {},
      create: { scopeKey: 'system', key, name: key, description: key, isSystem: true },
    });
  }

  const leadId = `${tag}-lead`, agentId = `${tag}-agent`, otherId = `${tag}-other`;
  for (const [id, code] of [[leadId, 'LD'], [agentId, 'AG'], [otherId, 'OT']] as const) {
    await client.user.create({ data: { id, username: `${id}`, displayName: `ชื่อ ${code}`, status: 'ACTIVE' } });
    await client.salesAgentProfile.create({
      data: {
        userId: id, salesCode: `${code}${tag.slice(-3).toUpperCase()}`.slice(0, 6),
        teamLeadUserId: id === leadId ? null : leadId,
        legalName: `นามสกุลจริง ${code}`, address: 'ที่อยู่ทดสอบ', bankName: 'กสิกรไทย',
        nationalIdEncrypted: encryptCredential(`national-${code}`, config.credentialEncryptionKey),
        bankAccountEncrypted: encryptCredential(`bank-${code}`, config.credentialEncryptionKey),
        whtRatePercent: 3, status: 'ACTIVE', createdByUserId: leadId,
      },
    });
  }

  const shopId = `${tag}-shop`;
  await client.company.create({ data: { id: shopId, name: `ร้านทดสอบ ${tag}`, status: 'ACTIVE' } });

  return {
    client, tag, shopId, leadId, agentId, otherId, deals, agents, companies, referral, audited,
    lead: ctx(leadId, ['MANGMEE_SALES_LEAD'], LEAD_PERMISSIONS),
    agent: ctx(agentId, ['MANGMEE_SALES'], AGENT_PERMISSIONS),
    other: ctx(otherId, ['MANGMEE_SALES'], AGENT_PERMISSIONS),
    async teardown() {
      // Agents CREATED by a case get a cuid id, so they are found by the tagged username the case
      // gave them, not by an id prefix — without this they survive teardown.
      const created = await client.user.findMany({ where: { username: { startsWith: tag } }, select: { id: true } });
      const userIds = [...created.map((user) => user.id), leadId, agentId, otherId];
      await client.packageChangeRequest.deleteMany({ where: { companyId: { startsWith: tag } } });
      await client.salesAttribution.deleteMany({ where: { companyId: { startsWith: tag } } });
      await client.billingInvoice.deleteMany({ where: { billingAccountId: { startsWith: tag } } });
      await client.auditLog.deleteMany({ where: { companyId: { startsWith: tag } } });
      await client.salesAgentProfile.deleteMany({ where: { userId: { in: userIds } } });
      await client.companySignupRequest.deleteMany({ where: { externalSignupId: { startsWith: tag } } });
      await client.membershipRole.deleteMany({ where: { membership: { userId: { in: userIds } } } });
      await client.companyMembership.deleteMany({ where: { userId: { in: userIds } } });
      await client.userCredential.deleteMany({ where: { userId: { in: userIds } } });
      await client.user.deleteMany({ where: { id: { in: userIds } } });
      await client.company.deleteMany({ where: { id: { startsWith: tag } } });
      await client.$disconnect();
    },
  };
}

async function reason(code: () => Promise<unknown>): Promise<string> {
  try {
    await code();
    return 'no-error';
  } catch (error) {
    const response = (error as { response?: { code?: string } }).response;
    return response?.code ?? (error as Error).constructor.name;
  }
}

it('accepts a complete lead-created payroll profile and validates its nested tax fields', () => {
  const body = {
    username: 'sales.new', displayName: 'เซลล์ใหม่', role: 'MANGMEE_SALES',
    profile: {
      legalName: 'เซลล์ ใหม่', nationalId: '1103700000001', taxId: '1103700000001',
      address: '99 ถนนสีลม สีลม บางรัก กรุงเทพมหานคร 10500',
      bankName: 'ธนาคารกสิกรไทย', bankAccount: '1234567890', whtRatePercent: 3,
    },
  };
  assert.deepEqual(validateSync(plainToInstance(SalesTeamCreateDto, body)), []);
  const invalid = plainToInstance(SalesTeamCreateDto, {
    ...body, profile: { ...body.profile, nationalId: '11037000000012', taxId: '123' },
  });
  assert.ok(validateSync(invalid).some((error) => error.property === 'profile'));
});

it('rejects a self profile attempt to write withholding rate', async () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const input = { legalName: 'เซลล์', nationalId: '1103700000001', taxId: null,
    address: 'ที่อยู่', bankName: 'ธนาคาร', bankAccount: '1234567890' };
  await pipe.transform(input, { type: 'body', metatype: SalesSelfProfileDto });
  await assert.rejects(() => pipe.transform({ ...input, whtRatePercent: 0 },
    { type: 'body', metatype: SalesSelfProfileDto }));
});

it('scopes decrypted profile reads to admin, self and own-team lead before audit', async () => {
  const rows = [
    { id: 'p1', userId: 'agent-1', teamLeadUserId: 'lead-1' },
    { id: 'p2', userId: 'agent-2', teamLeadUserId: 'lead-2' },
  ];
  const queries: Array<Record<string, string>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const prisma = { client: { salesAgentProfile: { findFirst: async ({ where }: { where: Record<string, string> }) => {
    queries.push(where);
    const row = rows.find((item) => item.userId === where.userId && (!where.teamLeadUserId || item.teamLeadUserId === where.teamLeadUserId));
    return row ? { id: row.id, legalName: 'ชื่อจริง', nationalIdEncrypted: null, taxIdEncrypted: null,
      address: 'ที่อยู่', bankName: 'ธนาคาร', bankAccountEncrypted: null, whtRatePercent: 3 } : null;
  } } } } as never;
  const audit = { log: async (entry: Record<string, unknown>) => { audits.push(entry); } } as never;
  const service = new SalesAgentsService(prisma, audit, config as never, noLine);
  const lead = ctx('lead-1', ['MANGMEE_SALES_LEAD'], LEAD_PERMISSIONS);
  const agent = ctx('agent-1', ['MANGMEE_SALES'], AGENT_PERMISSIONS);
  const owner = ctx('owner', ['SYSTEM_ADMIN'], ['sales.agent_profile.manage']);

  assert.equal((await service.readProfile(lead, 'agent-1')).legalName, 'ชื่อจริง');
  assert.deepEqual(queries.at(-1), { userId: 'agent-1', teamLeadUserId: 'lead-1' });
  assert.equal(await reason(() => service.readProfile(lead, 'agent-2')), 'SALES_AGENT_NOT_FOUND');
  assert.deepEqual(queries.at(-1), { userId: 'agent-2', teamLeadUserId: 'lead-1' });
  assert.equal((await service.readProfile(agent, 'agent-1')).legalName, 'ชื่อจริง');
  assert.deepEqual(queries.at(-1), { userId: 'agent-1' });
  const queryCount = queries.length;
  assert.equal(await reason(() => service.readProfile(agent, 'agent-2')), 'SALES_AGENT_NOT_FOUND');
  assert.equal(queries.length, queryCount, 'other-user access fails before reading a PII row');
  assert.equal((await service.readProfile(owner, 'agent-2')).legalName, 'ชื่อจริง');
  assert.equal(audits.length, 3, 'only successful reads produce view audits');
  assert.ok(audits.every((entry) => !JSON.stringify(entry).includes('ชื่อจริง')));
});

it('self profile updates encrypt identities and cannot change withholding rate', async () => {
  let written: Record<string, unknown> | null = null;
  const audits: Array<Record<string, unknown>> = [];
  const row = { id: 'p1', legalName: 'เซลล์', nationalIdEncrypted: null, taxIdEncrypted: null,
    address: 'ที่อยู่เดิม', bankName: 'ธนาคารเดิม', bankAccountEncrypted: null, whtRatePercent: 3 };
  const profile = {
    update: async ({ data }: { data: Record<string, unknown> }) => { written = data; return { id: row.id }; },
    findFirst: async () => row,
  };
  const prisma = { client: { salesAgentProfile: profile, $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
    work({ salesAgentProfile: profile }) } } as never;
  const audit = { log: async (entry: Record<string, unknown>) => { audits.push(entry); } } as never;
  const service = new SalesAgentsService(prisma, audit, config as never, noLine);
  const agent = ctx('agent-1', ['MANGMEE_SALES'], AGENT_PERMISSIONS);
  await service.updateOwnProfile(agent, {
    legalName: 'เซลล์ ใหม่', nationalId: '1103700000001', taxId: null,
    address: 'ที่อยู่ใหม่', bankName: 'ธนาคารใหม่', bankAccount: '1234567890',
    whtRatePercent: 0,
  } as unknown as SalesAgentSelfProfileInput);
  const columns = written as Record<string, unknown> | null;
  assert.ok(columns);
  assert.equal('whtRatePercent' in columns, false);
  assert.notEqual(columns.nationalIdEncrypted, '1103700000001');
  assert.notEqual(columns.bankAccountEncrypted, '1234567890');
  assert.ok(audits.some((entry) => entry.action === 'sales.agent.updated'));
  assert.ok(audits.every((entry) => !JSON.stringify(entry).includes('1103700000001')));
});

describe('sales console on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('allows one non-final deal per company and reports the collision as SALES_DEAL_ALREADY_OPEN', async () => {
    const h = await harness();
    try {
      const first = await h.deals.save(h.agent, snapshotBody(h.shopId));
      assert.equal(first.status, 'DRAFT');
      // The partial unique index is what refuses this, and the adapter's P2002 shape is what the
      // service has to read correctly to turn it into a code the console can show.
      assert.equal(await reason(() => h.deals.save(h.lead, snapshotBody(h.shopId))), 'SALES_DEAL_ALREADY_OPEN');

      // Cancelling frees the slot: the index predicate only covers DRAFT/PENDING_APPROVAL/APPROVED.
      await h.deals.cancel(h.agent, first.id, first.version, 'ลูกค้าเปลี่ยนใจ');
      const second = await h.deals.save(h.agent, snapshotBody(h.shopId));
      assert.equal(second.status, 'DRAFT');
    } finally { await h.teardown(); }
  });

  it('never lets a deal occupy the customer one-OPEN-request slot (S18)', async () => {
    const h = await harness();
    try {
      const deal = await h.deals.save(h.agent, snapshotBody(h.shopId));
      // The customer's own request still opens while a deal is in flight — different index.
      await h.client.packageChangeRequest.create({
        data: {
          companyId: h.shopId, requestedByUserId: h.agentId, requestedTierKey: 'PRO_999',
          status: 'OPEN', kind: 'CUSTOMER_REQUEST',
        },
      });
      const rows = await h.client.packageChangeRequest.findMany({ where: { companyId: h.shopId } });
      assert.equal(rows.length, 2);
      assert.equal(rows.filter((row) => row.status === 'OPEN').length, 1);

      // But approving the deal while that request is open is refused (S18).
      const submitted = await h.deals.submit(h.agent, deal.id, deal.version);
      assert.equal(
        await reason(() => h.deals.approve(h.lead, submitted.id, submitted.version, 'อนุมัติ')),
        'SALES_COMPANY_HAS_OPEN_REQUEST',
      );
    } finally { await h.teardown(); }
  });

  it('walks DRAFT to APPROVED, stamps a 3-day window and records selfApproved only when true', async () => {
    const h = await harness();
    try {
      const draft = await h.deals.save(h.agent, snapshotBody(h.shopId));
      const submitted = await h.deals.submit(h.agent, draft.id, draft.version);
      assert.equal(submitted.status, 'PENDING_APPROVAL');

      const approved = await h.deals.approve(h.lead, submitted.id, submitted.version, 'ราคาโอเค');
      assert.equal(approved.status, 'APPROVED');
      assert.equal(approved.selfApproved, false, 'the lead did not create this deal');
      assert.ok(approved.offerExpiresAt && approved.approvedAt);
      const windowMs = Date.parse(approved.offerExpiresAt) - Date.parse(approved.approvedAt);
      assert.equal(windowMs, 3 * 24 * 60 * 60 * 1000);

      // R4: an approved deal is immutable.
      assert.equal(
        await reason(() => h.deals.save(h.lead, snapshotBody(h.shopId), approved.id)),
        'SALES_DEAL_STATE_CONFLICT',
      );
      const transitions = h.audited.filter((entry) => String(entry['action']).startsWith('sales.deal.'));
      assert.deepEqual(transitions.map((entry) => entry['action']),
        ['sales.deal.created', 'sales.deal.submitted', 'sales.deal.approved']);
      assert.ok(transitions.every((entry) => entry['riskLevel'] === 'CRITICAL'));
    } finally { await h.teardown(); }
  });

  it('refuses an agent approving their OWN deal (R5) and records a lead self-approval (D2)', async () => {
    const h = await harness();
    try {
      // The agent's own deal, so the read passes and the PERMISSION is what refuses — an agent
      // approving someone else's deal is already "not found" and would not prove this rule.
      const ownDraft = await h.deals.save(h.agent, snapshotBody(h.shopId));
      const ownSubmitted = await h.deals.submit(h.agent, ownDraft.id, ownDraft.version);
      assert.equal(
        await reason(() => h.deals.approve(h.agent, ownSubmitted.id, ownSubmitted.version, 'ขออนุมัติเอง')),
        'SALES_DEAL_SELF_APPROVAL',
      );
      await h.deals.cancel(h.agent, ownSubmitted.id, ownSubmitted.version, 'เคลียร์ช่องดีล');

      // D2: a lead approving their own deal is allowed and flagged, never refused.
      const draft = await h.deals.save(h.lead, snapshotBody(h.shopId));
      const submitted = await h.deals.submit(h.lead, draft.id, draft.version);
      const approved = await h.deals.approve(h.lead, submitted.id, submitted.version, 'single admin');
      assert.equal(approved.selfApproved, true);
      const row = await h.client.packageChangeRequest.findUniqueOrThrow({ where: { id: approved.id } });
      assert.equal(row.selfApproved, true);
      // An approval with no note keeps the agent's own internalReason rather than blanking it.
      assert.equal(row.internalReason, 'single admin');
    } finally { await h.teardown(); }
  });

  it('refuses a stale version so two approvals cannot both win', async () => {
    const h = await harness();
    try {
      const draft = await h.deals.save(h.agent, snapshotBody(h.shopId));
      const submitted = await h.deals.submit(h.agent, draft.id, draft.version);
      await h.deals.approve(h.lead, submitted.id, submitted.version, 'first');
      assert.equal(
        await reason(() => h.deals.reject(h.lead, submitted.id, submitted.version, 'second')),
        'SALES_DEAL_STATE_CONFLICT',
      );
    } finally { await h.teardown(); }
  });

  it('derives EXPIRED on read and the sweep closes the row idempotently', async () => {
    const h = await harness();
    try {
      const draft = await h.deals.save(h.agent, snapshotBody(h.shopId));
      const submitted = await h.deals.submit(h.agent, draft.id, draft.version);
      const approved = await h.deals.approve(h.lead, submitted.id, submitted.version, 'อนุมัติ');
      await h.client.packageChangeRequest.update({
        where: { id: approved.id },
        data: { offerExpiresAt: new Date(Date.now() - 60_000) },
      });
      // Derived before any sweep has run (S17).
      assert.equal((await h.deals.get(h.lead, approved.id)).status, 'EXPIRED');

      assert.deepEqual(await h.deals.expireSweep(), { expired: 1 });
      assert.equal((await h.client.packageChangeRequest.findUniqueOrThrow({ where: { id: approved.id } })).status, 'EXPIRED');
      // Idempotent: a second run finds nothing left to close.
      assert.deepEqual(await h.deals.expireSweep(), { expired: 0 });
    } finally { await h.teardown(); }
  });

  it('shows an agent only their own deals and a lead every team', async () => {
    const h = await harness();
    try {
      const mine = await h.deals.save(h.agent, snapshotBody(h.shopId));
      const otherShop = `${h.tag}-shop2`;
      await h.client.company.create({ data: { id: otherShop, name: `ร้านที่สอง ${h.tag}`, status: 'ACTIVE' } });
      const theirs = await h.deals.save(h.other, snapshotBody(otherShop));

      assert.deepEqual((await h.deals.list(h.agent)).items.map((deal) => deal.id), [mine.id]);
      assert.deepEqual(
        (await h.deals.list(h.lead)).items.map((deal) => deal.id).sort(),
        [mine.id, theirs.id].sort(),
      );
      // Another agent's deal is answered as "not found", never as a 403 that confirms it exists.
      assert.equal(await reason(() => h.deals.get(h.agent, theirs.id)), 'SALES_COMPANY_NOT_FOUND');
    } finally { await h.teardown(); }
  });

  it('keeps agent PII out of the lead list DTO and out of every audit row', async () => {
    const h = await harness();
    try {
      const listed = await h.agents.list(h.lead);
      assert.ok(listed.items.length >= 2);
      const serialized = JSON.stringify(listed);
      for (const secret of ['นามสกุลจริง', 'national-', 'bank-', 'ที่อยู่ทดสอบ', 'กสิกรไทย']) {
        assert.equal(serialized.includes(secret), false, `lead list leaked ${secret}`);
      }
      // `hasProfile` tells the lead a payroll record EXISTS without revealing any of it.
      assert.ok(listed.items.every((agent) => agent.hasProfile === true), 'seeded agents all have a record');

      // The Owner CAN read it back, which also proves the ciphertext round-trips.
      const owner = ctx(h.leadId, ['SYSTEM_ADMIN'], [...LEAD_PERMISSIONS, 'sales.agent_profile.manage']);
      const profile = await h.agents.readProfile(owner, h.agentId);
      assert.match(profile.nationalId ?? '', /^national-/);
      assert.match(profile.bankAccount ?? '', /^bank-/);
      // Nothing readable is stored in the clear.
      const stored = await h.client.salesAgentProfile.findUniqueOrThrow({ where: { userId: h.agentId } });
      assert.equal(stored.nationalIdEncrypted?.includes('national-') ?? false, false, 'national id stored in the clear');
      assert.equal(stored.bankAccountEncrypted?.includes('bank-') ?? false, false, 'bank account stored in the clear');

      const draft = await h.deals.save(h.agent, snapshotBody(h.shopId));
      await h.deals.submit(h.agent, draft.id, draft.version);
      const auditText = JSON.stringify(h.audited);
      for (const secret of ['นามสกุลจริง', 'national-', 'bank-', 'ที่อยู่ทดสอบ']) {
        assert.equal(auditText.includes(secret), false, `audit metadata leaked ${secret}`);
      }
      // The PII read itself is an audited event (S10).
      assert.ok(h.audited.some((entry) => entry['action'] === 'sales.agent.profile_viewed'));
    } finally { await h.teardown(); }
  });

  it('resolves a sales code only while the agent is ACTIVE', async () => {
    const h = await harness();
    try {
      const profile = await h.client.salesAgentProfile.findUniqueOrThrow({ where: { userId: h.agentId } });
      assert.deepEqual(await h.referral.resolveCode(profile.salesCode), { salesCode: profile.salesCode, userId: h.agentId });
      // Case-folded: a customer typing lower case must still reach the agent.
      assert.equal((await h.referral.resolveCode(profile.salesCode.toLowerCase()))?.userId, h.agentId);
      assert.equal(await h.referral.resolveCode(null), null);
      assert.equal(await reason(() => h.referral.resolveCode('ZZZZZZ')), 'SALES_CODE_UNKNOWN');

      await h.client.salesAgentProfile.update({ where: { userId: h.agentId }, data: { status: 'SUSPENDED' } });
      // A suspended agent's code is answered exactly like an unknown one — no probing oracle.
      assert.equal(await reason(() => h.referral.resolveCode(profile.salesCode)), 'SALES_CODE_UNKNOWN');
    } finally { await h.teardown(); }
  });

  it('lets a lead create an agent with payroll details and a forced-change temporary password', async () => {
    const h = await harness();
    try {
      const created = await h.agents.create(h.lead, {
        username: `${h.tag}-new`, displayName: 'เซลล์ใหม่', role: 'MANGMEE_SALES',
        profile: {
          legalName: 'เซลล์ ใหม่', nationalId: '1103700000001', taxId: '1103700000001',
          address: '99 ถนนสีลม สีลม บางรัก กรุงเทพมหานคร 10500',
          bankName: 'ธนาคารกสิกรไทย', bankAccount: '1234567890', whtRatePercent: 3,
        },
      });
      assert.match(created.agent.salesCode, /^[A-Z0-9]{3,6}$/);
      assert.equal(created.agent.teamLeadUserId, h.leadId, 'a lead creates inside their own team');
      assert.equal(created.agent.hasProfile, true);
      assert.equal(created.credential.lineNotified, false, 'a brand-new agent has no LINE identity (S28)');
      assert.ok(created.credential.temporaryPassword.length > 0);

      const stored = await h.client.salesAgentProfile.findUniqueOrThrow({ where: { userId: created.agent.userId } });
      assert.equal(stored.address, '99 ถนนสีลม สีลม บางรัก กรุงเทพมหานคร 10500');
      assert.notEqual(stored.nationalIdEncrypted, '1103700000001');
      assert.notEqual(stored.bankAccountEncrypted, '1234567890');
      assert.equal(JSON.stringify(await h.agents.list(h.lead)).includes('1103700000001'), false);
      assert.equal(JSON.stringify(created).includes('1103700000001'), false);

      const credential = await h.client.userCredential.findUniqueOrThrow({ where: { userId: created.agent.userId } });
      assert.equal(credential.mustChangePassword, true);
      assert.equal(credential.status, 'TEMPORARY');

      const membership = await h.client.companyMembership.findFirstOrThrow({
        where: { userId: created.agent.userId }, include: { roles: { include: { role: true } } },
      });
      assert.equal(membership.companyId, PLATFORM_TENANT_ID);
      assert.deepEqual(membership.roles.map((entry) => entry.role.key), ['MANGMEE_SALES']);
      // S09: a sales agent is not an employee anywhere.
      assert.equal(await h.client.employeeAccessProfile.count({ where: { userId: created.agent.userId } }), 0);

      // A duplicate code is refused with a code the console can show.
      assert.equal(
        await reason(() => h.agents.create(h.lead, {
          username: `${h.tag}-new2`, displayName: 'ซ้ำ', role: 'MANGMEE_SALES', salesCode: created.agent.salesCode,
        })),
        'SALES_CODE_TAKEN',
      );
    } finally { await h.teardown(); }
  });

  it('keeps omitted payroll details empty and refuses profile writes without team or admin permission', async () => {
    const h = await harness();
    try {
      const created = await h.agents.create(h.lead, {
        username: `${h.tag}-blank`, displayName: 'เซลล์ยังไม่มีข้อมูลภาษี', role: 'MANGMEE_SALES',
      });
      assert.equal(created.agent.hasProfile, false, 'API callers may still omit payroll data');

      // NULL, not an encrypted empty string: "never captured" must be distinguishable from blank.
      const row = await h.client.salesAgentProfile.findUniqueOrThrow({ where: { userId: created.agent.userId } });
      assert.equal(row.legalName, null);
      assert.equal(row.nationalIdEncrypted, null);
      assert.equal(row.bankAccountEncrypted, null);
      assert.equal(row.address, null);
      assert.equal(row.bankName, null);
      assert.equal(row.whtRatePercent, 3, 'the default withholding rate still applies');

      // The Owner's form opens on an empty record rather than a 404.
      const owner = ctx(h.leadId, ['SYSTEM_ADMIN'], [...LEAD_PERMISSIONS, 'sales.agent_profile.manage']);
      const empty = await h.agents.readProfile(owner, created.agent.userId);
      assert.deepEqual(empty, {
        legalName: null, nationalId: null, taxId: null, address: null,
        bankName: null, bankAccount: null, whtRatePercent: 3,
      });

      // A caller without team or admin permission cannot smuggle payroll data into create.
      assert.equal(
        await reason(() => h.agents.create(h.agent, {
          username: `${h.tag}-pii`, displayName: 'ลอง', role: 'MANGMEE_SALES',
          profile: {
            legalName: 'ห้ามผ่าน', nationalId: '1103700000001', address: 'x',
            bankName: 'y', bankAccount: '123', whtRatePercent: 3,
          },
        })),
        'SALES_AGENT_NOT_FOUND',
      );

      // The export still lists the person, with empty cells where nothing was captured.
      const csv = await h.agents.exportCsv(owner);
      const line = csv.split('\n').find((row) => row.startsWith(created.agent.salesCode));
      assert.ok(line, 'the agent is present in the export');
      assert.equal(line!.split(',').slice(1, 7).join(''), '', 'every payroll cell is empty');
      assert.ok(line!.endsWith(',3,ACTIVE'));

      // Filling it in later flips hasProfile.
      const filled = await h.agents.update(owner, created.agent.userId, {
        profile: {
          legalName: 'ชื่อจริง ตามบัตร', nationalId: '1103700000009', address: 'ที่อยู่',
          bankName: 'กสิกรไทย', bankAccount: '9876543210', whtRatePercent: 3,
        },
      });
      assert.equal(filled.hasProfile, true);
      const after = await h.agents.readProfile(owner, created.agent.userId);
      assert.equal(after.nationalId, '1103700000009');
      assert.equal(after.bankAccount, '9876543210');
    } finally { await h.teardown(); }
  });

  it('returns the offer to its own shop only once approved, and never a draft', async () => {
    const h = await harness();
    try {
      const draft = await h.deals.save(h.agent, snapshotBody(h.shopId));
      const { PackageChangeRequestUseCase } = await import('../external-signup/application/package-change-request.use-case');
      const customerView = new PackageChangeRequestUseCase({ client: h.client } as never);

      assert.deepEqual(await customerView.listForCompany(h.shopId), [], 'a draft deal is invisible to the shop');
      const submitted = await h.deals.submit(h.agent, draft.id, draft.version);
      assert.deepEqual(await customerView.listForCompany(h.shopId), [], 'so is one awaiting approval');

      const approved = await h.deals.approve(h.lead, submitted.id, submitted.version, 'อนุมัติ');
      const [offer] = await customerView.listForCompany(h.shopId);
      assert.equal(offer?.kind, 'SALES_DEAL');
      assert.equal(offer?.deal?.dealId, approved.id);
      assert.equal(offer?.deal?.priceSatang, 39900);
      assert.equal(offer?.deal?.months, 12);
      // S24: the team's internal note is not part of the customer offer.
      assert.equal(JSON.stringify(offer).includes('ลูกค้าเก่าต่อสัญญา'), false);

      // Once the window closes the card disappears without any sweep having run.
      await h.client.packageChangeRequest.update({
        where: { id: approved.id }, data: { offerExpiresAt: new Date(Date.now() - 60_000) },
      });
      assert.deepEqual(await customerView.listForCompany(h.shopId), []);
    } finally { await h.teardown(); }
  });

  // ── sales credit, owner decisions 2026-10-02 (spec §17.1, RB-37) ──────────────────────────

  it('credits a deal and a referral for the same package the same amount, tax on top or tax included', async () => {
    const h = await harness();
    try {
      const paidAt = new Date();
      for (const taxTreatment of ['EXCLUSIVE_VAT_7', 'INCLUSIVE_VAT_7'] as const) {
        const dealShop = `${h.tag}-deal-${taxTreatment}`, referredShop = `${h.tag}-ref-${taxTreatment}`;
        await h.client.company.create({ data: { id: dealShop, name: `ร้านดีล ${taxTreatment}`, status: 'ACTIVE' } });
        const referredAt = new Date(paidAt.getTime() - 24 * 60 * 60 * 1000);
        await h.client.company.create({ data: { id: referredShop, name: `ร้านแนะนำ ${taxTreatment}`, status: 'ACTIVE',
          referralSalesUserId: h.otherId, referredAt, referralSource: 'SIGNUP_CODE' } });
        const draft = await h.deals.save(h.agent, snapshotBody(dealShop));
        const submitted = await h.deals.submit(h.agent, draft.id, draft.version);
        const approved = await h.deals.approve(h.lead, submitted.id, submitted.version, 'อนุมัติ');
        // The same package price a deal sells at, as the reconciler stores a paid catalog invoice.
        const dealInvoice = await paidInvoice(h, dealShop, 39900, taxTreatment);
        const referralInvoice = await paidInvoice(h, referredShop, 39900, taxTreatment);
        await h.client.$transaction(async (tx) => {
          await applyDealRequest(tx, { companyId: dealShop, invoiceId: dealInvoice.id, priceSatang: 39900, paidAt,
            deal: { requestId: approved.id, snapshotHash: 'hash', months: 12, salesUserId: h.agentId, aiMonthlyBudgetSatang: null } });
          await recordReferralAttribution(tx, { companyId: referredShop, invoiceId: referralInvoice.id,
            offer: { interval: 'month', intervalCount: 1 }, paidAt });
        });
        const deal = await h.client.salesAttribution.findUniqueOrThrow({ where: { companyId: dealShop } });
        const referral = await h.client.salesAttribution.findUniqueOrThrow({ where: { companyId: referredShop } });
        assert.deepEqual([deal.source, referral.source], ['DEAL', 'REFERRAL']);
        assert.equal(deal.amountSatang, 39900);
        assert.equal(referral.amountSatang, deal.amountSatang, `${taxTreatment}: the referral is credited on the deal's base`);
      }

      // A first bill lowered by an event discount is credited with the price actually charged.
      const discountedShop = `${h.tag}-ref-discount`;
      await h.client.company.create({ data: { id: discountedShop, name: 'ร้านใช้ส่วนลดงาน', status: 'ACTIVE',
        referralSalesUserId: h.otherId, referredAt: new Date(paidAt.getTime() - 60_000), referralSource: 'SIGNUP_CODE' } });
      const discounted = await paidInvoice(h, discountedShop, 29900, 'EXCLUSIVE_VAT_7');
      await h.client.$transaction((tx) => recordReferralAttribution(tx, { companyId: discountedShop,
        invoiceId: discounted.id, offer: { interval: 'month', intervalCount: 1 }, paidAt }));
      assert.equal((await h.client.salesAttribution.findUniqueOrThrow({ where: { companyId: discountedShop } })).amountSatang, 29900);
    } finally { await h.teardown(); }
  });
});

/** One paid, applied package invoice the way the reconciler stores it: Stripe's total and tax, and the pinned policy. */
async function paidInvoice(h: Awaited<ReturnType<typeof harness>>, companyId: string, priceSatang: number,
  taxTreatment: 'EXCLUSIVE_VAT_7' | 'INCLUSIVE_VAT_7') {
  const totals = quoteTotals(priceSatang, taxTreatment), now = new Date();
  return h.client.billingInvoice.create({ data: { billingAccountId: `${h.tag}-account-${companyId}`,
    providerInvoiceId: `in_${randomUUID().replace(/-/g, '')}`, providerChargeId: `ch_${randomUUID().replace(/-/g, '')}`,
    offerSnapshot: {}, contractSnapshot: { policy: { taxTreatment } }, policyRevisionId: 'policy', currency: 'THB',
    totalSatang: totals.totalSatang, paidSatang: totals.totalSatang, taxSatang: totals.taxSatang,
    periodStart: now, periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), providerStatus: 'paid',
    evidenceHash: 'evidence', applyStatus: 'APPLIED', appliedAt: now } });
}
