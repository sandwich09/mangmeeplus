/**
 * billing.get_package_usage on real PostgreSQL (advisor spec §5.1, plan S2a): the numbers the package page
 * shows (BillingService.usage over real receipt lots and OCR admissions), the lot period the projection uses,
 * and the plan-limit counts — ACTIVE branches, ACTIVE members with platform staff excluded.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { addCivilDays, civilDate } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { StripeClient } from '../../billing/infrastructure/stripe.client';
import { BillingService } from '../../billing/application/billing.service';
import { billingMonth } from '../../billing/domain/billing-policy';
import { BillingGetPackageUsageTool } from './use-cases/erp-package-tools.use-case';

const url = process.env.BILLING_TEST_DATABASE_URL;
const DAY = 86_400_000;

describe('billing.get_package_usage on PostgreSQL', { skip: !url }, () => {
  const tag = `pkgu-${randomUUID().slice(0, 8)}`;
  const paidShop = `${tag}-paid`, monthlyShop = `${tag}-monthly`, users = ['owner', 'staff', 'left', 'platform'].map((name) => `${tag}-${name}`);
  const now = new Date(), start = new Date(now.getTime() - 13 * DAY), end = new Date(start.getTime() + 30 * DAY);
  const roleIds: string[] = [];
  let client: PrismaClient; let billing: BillingService; let tool: BillingGetPackageUsageTool;
  const read = async (companyId: string) =>
    (await tool.execute({ companyId, userId: users[0]!, permissions: ['ai.tool.invoke', 'company.plan.manage'], locale: 'th' })).data as any;
  const lot = async (accountId: string, kind: string, units: number, used: number, serviceStart: Date) => {
    const grant = await client.billingReceiptGrant.create({ data: { companyId: paidShop, billingAccountId: accountId, sourceKey: `${tag}-${kind}`,
      sourceHash: `${tag}-${kind}`, kind, units, serviceStart, serviceEnd: new Date(serviceStart.getTime() + 30 * DAY), availableAt: serviceStart,
      expiresAt: end, policyRevisionId: 'SYNTHETIC' } });
    for (const entry of ['RESERVE', 'CONSUME']) await client.receiptUnitEntry.create({ data: { companyId: paidShop, grantId: grant.id,
      operationKey: `${tag}-${kind}`, generation: 1, kind: entry, units: used } });
  };

  before(async () => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url!).hostname)) throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.$connect();
    const prisma = { client } as PrismaService;
    billing = new BillingService(prisma, {} as AppConfigService, {} as StripeClient);
    tool = new BillingGetPackageUsageTool(prisma, billing);
    await client.user.createMany({ data: users.map((id) => ({ id, displayName: 'Synthetic package user', status: 'ACTIVE' as const })) });
    for (const companyId of [paidShop, monthlyShop]) await client.company.create({ data: { id: companyId, name: 'Synthetic package shop' } });
    const account = await client.billingAccount.create({ data: { companyId: paidShop, stripeAccountId: `acct_${tag}`, livemode: false } });
    await client.companyPlanTerm.create({ data: { companyId: paidShop, tierKey: 'PRO_999', branchLimit: 5, employeeLimit: 10, monthlySlipLimit: 100,
      billingReceiptAccountId: account.id, termStartAt: start, termEndsAt: end } });
    await lot(account.id, 'RENEWAL', 100, 70, start);
    await client.branch.createMany({ data: ['A', 'B'].map((code) => ({ companyId: paidShop, code, name: `Branch ${code}` })) });
    await client.branch.create({ data: { companyId: paidShop, code: 'OLD', name: 'Closed branch', status: 'DISABLED' } });
    const member = await client.role.create({ data: { companyId: paidShop, scopeKey: paidShop, key: 'STAFF', name: 'Staff' } });
    roleIds.push(member.id);
    let platform = await client.role.findFirst({ where: { key: 'SYSTEM_ADMIN', scopeKey: 'system', companyId: null, isSystem: true, status: 'ACTIVE' } });
    if (!platform) { platform = await client.role.create({ data: { key: 'SYSTEM_ADMIN', scopeKey: 'system', companyId: null, isSystem: true, name: 'Synthetic platform' } }); roleIds.push(platform.id); }
    for (const [index, userId] of users.entries()) await client.companyMembership.create({ data: { companyId: paidShop, userId,
      status: index === 2 ? 'DISABLED' : 'ACTIVE', roles: { create: { roleId: index === 3 ? platform.id : member.id } } } });
    const { monthKey, resetsAt } = billingMonth(now);
    await client.companyPlanTerm.create({ data: { companyId: monthlyShop, tierKey: 'STARTER_249', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30,
      termStartAt: start, termEndsAt: new Date(Date.parse(resetsAt) + 10 * DAY) } });
    await client.companyOcrUsageEvent.createMany({ data: [
      ...Array.from({ length: 12 }, (_, index) => ({ companyId: monthlyShop, monthKey, sourceRoute: 'receipt-ocr-line', requestId: `${tag}-${index}` })),
      // A bank statement is an accounting import, never one of the shop's receipts.
      { companyId: monthlyShop, monthKey, sourceRoute: 'bank-statement-extract', requestId: `${tag}-bank` },
    ] });
  });

  after(async () => {
    if (!client) return;
    await client.billingReceiptGrant.deleteMany({ where: { companyId: paidShop } });
    await client.companyPlanTerm.deleteMany({ where: { companyId: { in: [paidShop, monthlyShop] } } });
    await client.billingAccount.deleteMany({ where: { companyId: paidShop } });
    await client.companyMembership.deleteMany({ where: { companyId: paidShop } });
    await client.role.deleteMany({ where: { id: { in: roleIds } } });
    await client.company.deleteMany({ where: { id: { in: [paidShop, monthlyShop] } } });
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it('reads a paid allowance: package page figures, its lot period and projection, and the plan-limit counts', async () => {
    const data = await read(paidShop);
    const page = await billing.usage(paidShop);
    assert.deepEqual([data.receipts.used, data.receipts.limit, data.receipts.remaining], [page.used, page.limit, page.remaining]);
    assert.deepEqual([data.receipts.used, data.receipts.limit, data.receipts.remaining], [70, 100, 30]);
    assert.equal(data.receipts.periodStartOn, civilDate(start));
    assert.equal(data.receipts.periodEndsOn, civilDate(end));
    assert.equal(data.receipts.pace.daysElapsed, 14);
    assert.equal(data.receipts.pace.projectedUsed, 150);
    assert.equal(data.receipts.pace.projectedShortfall, 50);
    assert.equal(data.package.label, 'มืออาชีพ (PRO)');
    // Two ACTIVE branches of three; owner and staff, but not the disabled member or platform staff.
    assert.deepEqual(data.capacity, { branches: { used: 2, limit: 5, remaining: 3 }, members: { used: 2, limit: 10, remaining: 8 } });
  });

  it('gives no projection once a lot from the period before is carried alongside', async () => {
    const account = await client.billingAccount.findFirstOrThrow({ where: { companyId: paidShop } });
    await lot(account.id, 'REPEAT', 100, 90, new Date(start.getTime() - 30 * DAY));
    const data = await read(paidShop);
    assert.deepEqual([data.receipts.used, data.receipts.limit, data.receipts.remaining], [160, 200, 40]);
    assert.equal(data.receipts.pace, null);
    assert.equal(data.receipts.periodStartOn, null);
    assert.ok(data.receipts.paceNote);
  });

  it('reads a monthly allowance by calendar month, counting receipt reads only', async () => {
    const data = await read(monthlyShop);
    const { resetsAt } = billingMonth(now);
    assert.deepEqual([data.receipts.used, data.receipts.limit, data.receipts.remaining, data.receipts.cadence], [12, 30, 18, 'รายเดือน เริ่มนับใหม่ทุกต้นเดือน']);
    assert.equal(data.receipts.periodStartOn, `${civilDate(now).slice(0, 7)}-01`);
    assert.equal(data.receipts.periodEndsOn, addCivilDays(civilDate(new Date(resetsAt)), -1));
    assert.equal(data.receipts.resetsOn, civilDate(new Date(resetsAt)));
    assert.equal(data.package.label, 'เริ่มต้น (STARTER)');
  });
});
