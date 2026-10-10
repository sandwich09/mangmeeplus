import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';

export async function checkBillingFinancial(input: {
  prisma: PrismaService; companyId: string; userId: string; membershipId: string;
  provider: Record<string, Record<string, any>[]>; reconcile: (id: string) => Promise<void>;
  request: (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;
  event: (type: string, objectId: string, eventId: string) => Promise<number>; drain: () => Promise<{ status: number; body: any }>;
  browser?: Awaited<ReturnType<typeof startBillingBrowser>>;
}) {
  const { prisma: { client }, companyId, provider, request, browser } = input, cases: string[] = [], base = `/v1/companies/${companyId}/billing`;
  const account = await client.billingAccount.findFirstOrThrow({ where: { companyId } });
  const invoice = await client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: account.id, subscriptionId: null, applyStatus: 'APPLIED' } });
  const charge = provider.charges!.find(c => c.id === invoice.providerChargeId)!; assert.ok(charge);
  const grants = await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } });
  const term = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
  // The journeys before this one share the shop's command limiter (30 per window): the window may be full here. Wait it out, as billing-configuration-smoke does.
  const quote = async () => {
    for (let tries = 0; ; tries++) {
      const result = await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'owner@example.test' });
      if (result.status !== 429 || tries >= 2) return result;
      assert.ok(result.body.retryAfterSeconds <= 60);
      await new Promise(resolve => setTimeout(resolve, Math.min(60, result.body.retryAfterSeconds + 1) * 1000));
    }
  };
  charge.amount_refunded = 5000;
  const refused = await quote(); assert.equal(refused.status, 409, JSON.stringify(refused.body));
  await input.reconcile(account.id); await input.reconcile(account.id);
  const recorded = await client.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(recorded.refundedSatang, 5000); assert.ok(recorded.financialObservedAt);
  const issueWhere = { companyId, kind: 'FINANCIAL_REVIEW', referenceId: invoice.id };
  assert.equal(await client.billingIssue.count({ where: issueWhere }), 1);
  assert.equal(await client.auditLog.count({ where: { companyId, action: 'billing.financial.observed', targetId: invoice.id } }), 1);
  const eventId = `evt_financial${randomUUID().replaceAll('-', '')}`;
  assert.equal(await input.event('charge.refunded', charge.id, eventId), 200); assert.equal(await input.event('charge.refunded', charge.id, eventId), 200);
  const drained = await input.drain(); assert.equal(drained.body.failed, 0, JSON.stringify(drained.body));
  assert.equal(await client.billingIssue.count({ where: { companyId, kind: 'FINANCIAL_REVIEW', referenceId: { in: [invoice.id, charge.id] } } }), 1);
  assert.equal(await client.auditLog.count({ where: { companyId, action: 'billing.financial.observed', targetId: invoice.id } }), 1);
  charge.disputed = true; await input.reconcile(account.id); await input.reconcile(account.id);
  assert.equal((await client.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).disputed, true);
  assert.equal(await client.auditLog.count({ where: { companyId, action: 'billing.financial.observed', targetId: invoice.id } }), 2);
  assert.equal(await client.billingIssue.count({ where: issueWhere }), 1);
  assert.deepEqual(await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }), grants);
  assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } })).termEndsAt.toISOString(), term.termEndsAt.toISOString());
  const history = (await request(`${base}/history`)).body.items.find((i: { id: string }) => i.id === invoice.id);
  assert.equal(history.refundedSatang, 5000); assert.equal(history.disputed, true); assert.ok(history.financialObservedAt);
  assert.doesNotMatch(JSON.stringify(history), /providerChargeId|customerId|https:/);
  cases.push('financial-late-one-time-refund-without-webhook-and-replay-observed-once');
  cases.push('financial-dispute-case-and-history-preserve-quota-until-manual-review');
  const role = await client.role.create({ data: { scopeKey: 'system', isSystem: true, key: `FINANCE_${randomUUID()}`, name: 'Synthetic financial reader',
    permissions: { create: (await client.permission.findMany({ where: { key: { in: ['system.billing.read', 'system.billing.financial.read'] } } })).map(p => ({ permissionId: p.id })) } } });
  const scope = await client.billingOperatorScope.create({ data: { userId: input.userId, companyId, stripeAccountId: account.stripeAccountId,
    livemode: account.livemode, createdByUserId: input.userId } });
  try {
    await client.membershipRole.create({ data: { membershipId: input.membershipId, roleId: role.id } });
    const finance = await request(`/v1/system/billing/companies/${companyId}`, 'GET', undefined, { 'x-company-id': companyId });
    assert.equal(finance.status, 200, JSON.stringify(finance.body));
    const item = finance.body.financial.invoices.find((i: { id: string }) => i.id === invoice.id);
    assert.equal(item.refundedSatang, 5000); assert.equal(item.disputed, true);
    if (browser) {
      const { page, origin, evidenceDir } = browser;
      await page.goto(`${origin}/companies/${companyId}/billing`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'ประวัติ', exact: true }).click();
      await page.getByRole('region', { name: 'ประวัติการชำระเงิน' }).getByText(/ยอดคืนเงินที่ Stripe บันทึก.*50/).waitFor();
      await page.screenshot({ path: `${evidenceDir}/customer-financial-observation-mobile.png`, fullPage: true });
      await page.goto(`${origin}/system/billing/companies/${companyId}?view=payments`, { waitUntil: 'domcontentloaded' });
      await page.getByText(/ยอดคืนเงินที่ Stripe บันทึก.*50/).first().waitFor();
      await page.getByText('มีข้อพิพาท ต้องตรวจเป็นรายกรณี', { exact: true }).first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `${evidenceDir}/admin-financial-observation-mobile.png`, fullPage: true });
      cases.push('browser-customer-and-scoped-finance-see-observed-refund-dispute-and-case');
    }
  } finally {
    await client.membershipRole.deleteMany({ where: { roleId: role.id } }); await client.role.delete({ where: { id: role.id } });
    await client.billingOperatorScope.delete({ where: { id: scope.id } });
  }
  const savedCustomer = charge.customer; charge.customer = 'cus_wrongFinancialOwner';
  await assert.rejects(input.reconcile(account.id), /financial_charge_mismatch/); charge.customer = savedCustomer;
  const current = await client.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(current.refundedSatang, 5000); assert.equal(current.disputed, true);
  cases.push('financial-charge-ownership-fence-and-scoped-finance-contract');
  return cases;
}
