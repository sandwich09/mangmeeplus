import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import { BillingService } from './billing.service';
import { BillingEmailRecipient } from './billing-email-recipient';
import { StripeRequestError } from '../infrastructure/stripe.client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';

const databaseUrl = process.env.EMAIL_OTP_TEST_DATABASE_URL;
describe('billing recipient authority, isolation and recovery on PostgreSQL', { skip: !databaseUrl }, () => {
  let prisma: PrismaService;
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/email_otp_test');
    prisma = new PrismaService({ databaseUrl } as any); await prisma.onModuleInit();
  });
  after(async () => { await prisma?.onModuleDestroy(); });
  async function fixture() {
    const id = randomUUID(), userId = randomUUID(), companyId = randomUUID(), lease = randomUUID();
    const stripeAccountId = `acct_${id}`, customerId = `cus_${id}`, email = `${id}@new.example.test`;
    await prisma.client.user.create({ data: { id: userId, displayName: 'Synthetic owner', email, emailVerifiedAt: new Date() } });
    await prisma.client.company.create({ data: { id: companyId, name: 'Synthetic recipient company' } });
    const role = await prisma.client.role.create({ data: { companyId, scopeKey: companyId, key: 'OWNER', name: 'Owner' } });
    const membership = await prisma.client.companyMembership.create({ data: { companyId, userId, roles: { create: { roleId: role.id } } } });
    const account = await prisma.client.billingAccount.create({ data: { companyId, stripeAccountId, customerId, livemode: false,
      leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    const customer = { id: customerId, object: 'customer', livemode: false, email: `${id}@old.example.test`, metadata: { billingAccountId: account.id } };
    let writes = 0, mode: 'ok' | 'unknown' | 'unknown-before' | 'reject' = 'ok';
    let beforeGet: (() => Promise<void>) | undefined;
    const stripe: any = { accountId: stripeAccountId, livemode: false, request: async (method: string, path: string, body?: any, key?: string) => {
      assert.equal(path, `/customers/${customerId}`);
      if (method === 'GET') { const hook = beforeGet; beforeGet = undefined; await hook?.(); return { ...customer }; }
      assert.equal(method, 'POST'); assert.match(key!, /^mm:email-recipient:/); assert.deepEqual(Object.keys(body), ['email']);
      writes++;
      if (mode === 'reject') throw new StripeRequestError('REJECTED', 'invalid_request');
      if (mode === 'unknown-before') throw new StripeRequestError('UNKNOWN', 'lost_before_effect');
      customer.email = body.email;
      if (mode === 'unknown') throw new StripeRequestError('UNKNOWN', 'lost_response');
      return { ...customer };
    } };
    // Use the production authority/account readers; only external Stripe I/O is simulated.
    const billing = Object.assign(Object.create(BillingService.prototype), { prisma, stripe, config: { stripeAccountId } }) as BillingService;
    const service = new BillingEmailRecipient(prisma, stripe, billing);
    const context = { companyId, userId } as RequestContext;
    const queue = async () => { const preview = await service.preview(context); return service.command(context, preview.id, 'submit', preview.version, preview.previewHash, randomUUID()); };
    const advance = async () => service.advance(await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } }), lease);
    return { service, context, account, customer, role, membership, email, queue, advance,
      writes: () => writes, mode: (value: typeof mode) => { mode = value; }, beforeGet: (fn: () => Promise<void>) => { beforeGet = fn; } };
  }
  test('explicit company review, duplicate submit and exact readback; other companies stay unchanged', async () => {
    const a = await fixture(), b = await fixture(), oldB = b.customer.email;
    const preview = await a.service.preview(a.context), key = randomUUID();
    assert.equal(a.writes(), 0); assert.notEqual(preview.previousEmail, preview.newEmail);
    const args = [a.context, preview.id, 'submit', preview.version, preview.previewHash, key] as const;
    const [first, second] = await Promise.all([a.service.command(...args), a.service.command(...args)]);
    assert.equal(first.id, second.id);
    await a.advance(); assert.equal(a.writes(), 1); assert.equal(a.customer.email, a.email);
    assert.equal((await a.service.get(a.context, first.id)).state, 'COMPLETED');
    assert.equal((await a.service.current(a.context)).busy, false); assert.equal(b.customer.email, oldB);
    await assert.rejects(a.service.get(b.context, first.id));
  });
  test('only one reviewed operation can reserve a company', async () => {
    const f = await fixture(); const a = await f.service.preview(f.context), b = await f.service.preview(f.context);
    const results = await Promise.allSettled([a, b].map(p => f.service.command(f.context, p.id, 'submit', p.version, p.previewHash, randomUUID())));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.writes(), 0);
  });
  test('email or owner changes before first provider mutation are blocked and remain cancellable', async () => {
    for (const change of ['email', 'owner', 'company', 'version', 'expiry']) {
      const f = await fixture(), queued = await f.queue();
      f.beforeGet(async () => {
        if (change === 'email') await prisma.client.user.update({ where: { id: f.context.userId }, data: { emailRevision: { increment: 1 } } });
        if (change === 'owner') await prisma.client.membershipRole.deleteMany({ where: { membershipId: f.membership.id } });
        if (change === 'company') await prisma.client.company.update({ where: { id: f.context.companyId }, data: { status: 'DISABLED' } });
        if (change === 'version') await prisma.client.billingAccount.update({ where: { id: f.account.id }, data: { version: { increment: 1 } } });
        if (change === 'expiry') await prisma.client.billingOperation.update({ where: { id: queued.id }, data: { expiresAt: new Date(0) } });
      });
      await f.advance(); assert.equal(f.writes(), 0, change);
      const row = await prisma.client.billingOperation.findUniqueOrThrow({ where: { id: queued.id } });
      assert.equal(row.state, 'BLOCKED', change);
      if (change === 'owner') await prisma.client.membershipRole.create({ data: { membershipId: f.membership.id, roleId: f.role.id } });
      const current = await f.service.get(f.context, row.id); assert.equal(current.canCancel, true);
      await f.service.command(f.context, row.id, 'cancel', current.version, current.previewHash, '');
      assert.equal((await f.service.current(f.context)).busy, false);
    }
  });
  test('provider accepted but response lost is read back after restart without a second POST or new email gate', async () => {
    const f = await fixture(), row = await f.queue(); f.mode('unknown'); await f.advance();
    assert.equal((await f.service.get(f.context, row.id)).state, 'RECONCILING');
    assert.equal((await f.service.get(f.context, row.id)).canCancel, false);
    await prisma.client.user.update({ where: { id: f.context.userId }, data: { emailRevision: { increment: 1 } } });
    f.mode('ok'); await f.advance(); assert.equal(f.writes(), 1);
    assert.equal((await f.service.get(f.context, row.id)).state, 'COMPLETED');
    assert.equal((await prisma.client.billingIssue.findFirstOrThrow({ where: { kind: 'EMAIL_RECIPIENT_REVIEW', referenceId: row.id } })).state, 'RESOLVED');
  });
  test('an aged unknown outcome creates a tracked issue, never reposts, and resolves only after matching provider readback', async () => {
    const f = await fixture(), row = await f.queue(); f.mode('unknown-before'); await f.advance();
    await prisma.client.billingOperation.update({ where: { id: row.id }, data: { resultJson: { startedAt: new Date(Date.now() - 24 * 3600_000).toISOString() } } });
    f.mode('ok'); await f.advance(); assert.equal(f.writes(), 1);
    const issue = await prisma.client.billingIssue.findFirstOrThrow({ where: { kind: 'EMAIL_RECIPIENT_REVIEW', referenceId: row.id } });
    assert.equal(issue.state, 'OPEN'); assert.equal((await f.service.current(f.context)).busy, true);
    assert.equal((await f.service.get(f.context, row.id)).canCancel, false);
    // A later authoritative readback of the original consented update releases the reservation.
    f.customer.email = f.email; await f.advance(); assert.equal(f.writes(), 1);
    assert.equal((await f.service.current(f.context)).busy, false);
    assert.equal((await prisma.client.billingIssue.findUniqueOrThrow({ where: { id: issue.id } })).state, 'RESOLVED');
  });
  test('provider rejection releases the reservation and supports a fresh review', async () => {
    const f = await fixture(), row = await f.queue(); f.mode('reject'); await f.advance();
    assert.equal((await f.service.get(f.context, row.id)).state, 'FAILED');
    assert.equal((await f.service.current(f.context)).busy, false);
    f.mode('ok'); await f.queue(); await f.advance(); assert.equal(f.customer.email, f.email);
  });
  test('a remaining owner can cancel an undispatched request after the original owner leaves', async () => {
    const f = await fixture(), row = await f.queue(), userId = randomUUID();
    await prisma.client.user.create({ data: { id: userId, displayName: 'Remaining owner' } });
    await prisma.client.companyMembership.create({ data: { userId, companyId: f.context.companyId, roles: { create: { roleId: f.role.id } } } });
    await prisma.client.membershipRole.deleteMany({ where: { membershipId: f.membership.id } });
    const context = { ...f.context, userId }, visible = await f.service.get(context, row.id);
    assert.equal(visible.canCancel, true); assert.equal(visible.canSubmit, false);
    await f.service.command(context, row.id, 'cancel', visible.version, visible.previewHash, '');
    assert.equal((await f.service.current(context)).busy, false); assert.equal(f.writes(), 0);
  });
});
