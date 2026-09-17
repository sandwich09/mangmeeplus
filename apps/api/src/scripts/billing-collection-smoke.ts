import assert from 'node:assert/strict';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';
import type { repeatProviderFixture } from './billing-repeat-smoke';

export async function checkBillingCollection(input: {
  request: (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;
  prisma: PrismaService; companyId: string; otherCompanyId: string; membershipId: string; ownerRoleId: string; prepaid: boolean;
  fixture: ReturnType<typeof repeatProviderFixture>; subscription: Record<string, any>; provider: Record<string, Record<string, any>[]>;
  scan: () => Promise<unknown>; drain: () => Promise<unknown>; browser?: Awaited<ReturnType<typeof startBillingBrowser>>;
}) {
  const { prisma, companyId, prepaid, browser } = input, client = prisma.client, base = `/v1/companies/${companyId}/billing`;
  const request: typeof input.request = async (...args) => {
    for (let tries = 0; ; tries++) {
      const result = await input.request(...args);
      if (result.status !== 429 || tries >= 2) return result;
      assert.ok(result.body.retryAfterSeconds <= 60);
      await new Promise(resolve => setTimeout(resolve, Math.min(60, result.body.retryAfterSeconds + 1) * 1000));
    }
  };
  const before = (await request(base)).body, beforeGrants = await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } });
  const preview = (action: string) => request(`${base}/collection/preview`, 'POST', { action });
  const submit = (op: any) => request(`${base}/collection/${op.id}/submit`, 'POST', { expectedVersion: op.version, previewHash: op.previewHash, accepted: true },
    { 'idempotency-key': `billing-collection-${op.id}` });
  const get = (op: any) => request(`${base}/collection/${op.id}`);
  if (prepaid) {
    const schedule = input.fixture.schedules[0]!, paid = schedule.phases[1];
    paid.add_invoice_items = [{ price: 'price_Unexpected' }];
    try { assert.equal((await preview('CANCEL_RENEWAL')).status, 409, 'never erase an unapproved future invoice item'); }
    finally { delete paid.add_invoice_items; }
    input.provider.subscriptions!.push({ ...input.subscription, id: 'sub_duplicate_collection' });
    try { assert.equal((await preview('CANCEL_RENEWAL')).status, 409, 'cannot promise no renewal with another collectible subscription'); }
    finally { input.provider.subscriptions!.pop(); }
  }
  const drift = await preview('CANCEL_RENEWAL'); assert.equal(drift.status, 200);
  const driftCommand = await submit(drift.body); assert.equal(driftCommand.body.state, 'QUEUED');
  const oldTaxes = input.subscription.items.data[0].tax_rates, calls = input.fixture.calls.get('collection') ?? 0;
  input.subscription.items.data[0].tax_rates = ['txr_Unexpected'];
  try { await input.drain(); } finally { input.subscription.items.data[0].tax_rates = oldTaxes; }
  const blocked = (await get(drift.body)).body;
  assert.equal(blocked.state, 'BLOCKED'); assert.equal(input.fixture.calls.get('collection') ?? 0, calls);
  assert.equal((await request(`${base}/collection/${blocked.id}/withdraw`, 'POST', { expectedVersion: blocked.version })).body.state, 'CANCELLED');
  const first = await preview('CANCEL_RENEWAL'); assert.equal(first.status, 200, JSON.stringify(first.body));
  const other = await preview('CANCEL_RENEWAL'); assert.equal(other.status, 200);
  assert.equal((await request(`/v1/companies/${input.otherCompanyId}/billing/collection/${first.body.id}`)).status, 404);
  const queued = await submit(first.body); assert.equal(queued.body.state, 'QUEUED');
  assert.equal((await submit(first.body)).body.id, first.body.id);
  assert.equal((await submit(other.body)).status, 409, 'another intent cannot overtake reserved collection command');
  assert.equal((await request(`${base}/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'owner@example.test' })).body.code, 'BILLING_COLLECTION_PENDING');
  input.fixture.lose('collection'); await input.scan();
  const unknown = await get(first.body); assert.equal(unknown.body.state, 'UNKNOWN'); assert.deepEqual(unknown.body.allowedActions, []);
  input.subscription.items.data[0].tax_rates = ['txr_Unexpected'];
  try { await input.drain(); assert.equal((await get(first.body)).body.state, 'UNKNOWN', 'metadata alone cannot prove unchanged renewal economics'); }
  finally { input.subscription.items.data[0].tax_rates = oldTaxes; }
  await client.membershipRole.delete({ where: { membershipId_roleId: { membershipId: input.membershipId, roleId: input.ownerRoleId } } });
  try { await input.drain(); } finally { await client.membershipRole.create({ data: { membershipId: input.membershipId, roleId: input.ownerRoleId } }); }
  assert.equal((await get(first.body)).body.state, 'SUCCEEDED', 'already-observed provider outcome can complete after payer role withdrawal');
  assert.equal((await request(base)).body.observedAt, (await get(first.body)).body.observedAt, 'account and operation publish one observation timestamp');
  await input.drain();
  const stopped = (await request(base)).body;
  assert.equal(stopped.cancelAtPeriodEnd, true); assert.equal(stopped.nextChargeAt, null); assert.equal(stopped.paidThrough, before.paidThrough);
  assert.deepEqual(await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }), beforeGrants, 'stopping renewal never alters bought quota');
  const withdrawPreview = await preview('RESUME_RENEWAL'); assert.equal(withdrawPreview.status, 200, JSON.stringify(withdrawPreview.body));
  const withdrawn = await submit(withdrawPreview.body);
  assert.equal((await request(`${base}/collection/${withdrawn.body.id}/withdraw`, 'POST', { expectedVersion: withdrawn.body.version })).body.state, 'CANCELLED');
  await input.drain(); assert.equal((await request(base)).body.cancelAtPeriodEnd, true);
  if (browser && prepaid) {
    const page = browser.page;
    await page.goto(`${browser.origin}/companies/${companyId}/billing`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'การต่ออายุและชำระเงิน', exact: true }).click();
    await page.getByRole('button', { name: 'เปิดต่ออายุอัตโนมัติ', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันกลับมาต่ออายุ', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'รอตรวจยืนยันการต่ออายุ' }).waitFor();
    await input.scan();
    await page.getByRole('button', { name: 'ตรวจผลการต่ออายุ', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'ยืนยันกลับมาต่ออายุแล้ว' }).waitFor();
    await page.getByRole('button', { name: 'หยุดต่ออายุอัตโนมัติ', exact: true }).waitFor();
    await page.getByText('ระบบต่ออายุตามสัญญาที่เลือกไว้', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `${browser.evidenceDir}/customer-collection-mobile.png`, fullPage: true });
  } else {
    const resume = await preview('RESUME_RENEWAL'), command = await submit(resume.body);
    assert.equal(command.body.state, 'QUEUED'); await input.drain(); assert.equal((await get(command.body)).body.state, 'SUCCEEDED');
  }
  await input.drain();
  const resumed = (await request(base)).body;
  assert.equal(resumed.cancelAtPeriodEnd, false); assert.equal(resumed.nextChargeAt, before.paidThrough); assert.equal(resumed.paidThrough, before.paidThrough);
  assert.deepEqual(await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }), beforeGrants);
  return [`collection-${prepaid ? 'prepaid' : 'ordinary'}-cancel-lost-response-owner-revocation-and-reconcile`,
    `collection-${prepaid ? 'prepaid' : 'ordinary'}-reservation-withdraw-resume-preserves-paid-days-and-receipts`,
    `collection-${prepaid ? 'prepaid' : 'ordinary'}-provider-drift-before-and-after-command-cannot-overwrite-or-falsely-succeed`,
    ...(prepaid ? ['collection-prepaid-unapproved-extra-line-and-duplicate-subscription-rejected'] : []),
    ...(browser && prepaid ? ['browser-prepaid-resume-confirm-worker-observed-and-mobile'] : [])];
}
