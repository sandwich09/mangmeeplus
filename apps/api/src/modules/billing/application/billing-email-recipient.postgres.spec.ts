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
  async function fixture(noticeServerId?: number) {
    const id = randomUUID(), userId = randomUUID(), companyId = randomUUID(), lease = randomUUID();
    const stripeAccountId = `acct_${id}`, customerId = `cus_${id}`, email = `${id}@new.example.test`;
    await prisma.client.user.create({ data: { id: userId, displayName: 'Synthetic owner', email, emailVerifiedAt: new Date() } });
    await prisma.client.company.create({ data: { id: companyId, name: 'Synthetic recipient company' } });
    // assertOwner asks for company.plan.manage since the plan-management delegation (48c4ab57).
    const planManage = await prisma.client.permission.upsert({ where: { key: 'company.plan.manage' }, create: { key: 'company.plan.manage', description: 'company.plan.manage' }, update: {} });
    const role = await prisma.client.role.create({ data: { companyId, scopeKey: companyId, key: 'OWNER', name: 'Owner', permissions: { create: { permissionId: planManage.id } } } });
    const membership = await prisma.client.companyMembership.create({ data: { companyId, userId, roles: { create: { roleId: role.id } } } });
    const account = await prisma.client.billingAccount.create({ data: { companyId, stripeAccountId, customerId, livemode: false,
      leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    const customer = { id: customerId, object: 'customer', livemode: false, email: `${id}@old.example.test`, metadata: { billingAccountId: account.id } };
    let writes = 0, mode: 'ok' | 'unknown' | 'unknown-before' | 'reject' | 'read-fails' = 'ok';
    let beforeGet: (() => Promise<void>) | undefined;
    const stripe: any = { accountId: stripeAccountId, livemode: false, request: async (method: string, path: string, body?: any, key?: string) => {
      assert.equal(path, `/customers/${customerId}`);
      if (method === 'GET') { const hook = beforeGet; beforeGet = undefined; await hook?.(); if (mode === 'read-fails') throw new StripeRequestError('UNKNOWN', 'read_failed'); return { ...customer }; }
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
    const service = new BillingEmailRecipient(prisma, stripe, billing, { postmarkServerId: noticeServerId, postmarkMessageStream: 'outbound' });
    const context = { companyId, userId } as RequestContext;
    const queue = async () => { const preview = await service.preview(context); return service.command(context, preview.id, 'submit', preview.version, preview.previewHash, randomUUID()); };
    const advance = async () => service.advance(await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: account.id } }), lease);
    // A company recipient code (R-A8) that was confirmed `ageMs` ago.
    const proof = async (newEmail: string, input: { companyId?: string; userId?: string; status?: 'USED' | 'PENDING'; ageMs?: number } = {}) => {
      const token = await prisma.client.emailVerificationToken.create({ data: { id: randomUUID(), userId: input.userId ?? userId, companyId: input.companyId ?? companyId,
        newEmail, tokenHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''), proofKind: 'BILLING_RECIPIENT', status: input.status ?? 'USED',
        usedAt: input.status === 'PENDING' ? null : new Date(Date.now() - (input.ageMs ?? 0)), expiresAt: new Date(Date.now() + 600_000) } });
      return token.id;
    };
    return { service, context, account, customer, role, membership, email, queue, advance, proof,
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
    // R-A8: the column follows Stripe, the change is audited without an address, and the notice is queued.
    const stored = await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: a.account.id } });
    assert.equal(stored.recipientEmail, a.email); assert.equal(stored.recipientSource, 'ACCOUNT_EMAIL');
    const changed = await prisma.client.auditLog.findFirstOrThrow({ where: { action: 'billing.recipient.changed', targetId: a.account.id } });
    assert.deepEqual(changed.metadataJson, { source: 'ACCOUNT_EMAIL', operationId: first.id, hadPrevious: true });
    const outbox = await prisma.client.outboxEvent.findUniqueOrThrow({ where: { eventKey: `billing:recipient-changed:${first.id}` } });
    assert.deepEqual(outbox.payloadJson, { schemaVersion: 1, data: { operationId: first.id } });
    assert.equal((await a.service.current(a.context)).busy, false); assert.equal(b.customer.email, oldB);
    await assert.rejects(a.service.get(b.context, first.id));
  });
  test('only one reviewed operation can reserve a company', async () => {
    const f = await fixture(); const a = await f.service.preview(f.context), b = await f.service.preview(f.context);
    const results = await Promise.allSettled([a, b].map(p => f.service.command(f.context, p.id, 'submit', p.version, p.previewHash, randomUUID())));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.writes(), 0);
  });
  // 2026-10-10: a request refused before any send is over at once and holds nothing (it was BLOCKED until an owner cancelled).
  test('email or owner changes before first provider mutation end the request and release the shop', async () => {
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
      assert.deepEqual([row.state, row.errorCode], ['FAILED', 'email_authorization_changed'], change);
      assert.equal((await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } })).activeEmailOperationId, null, change);
      assert.equal(await prisma.client.auditLog.count({ where: { action: 'billing.email_recipient.failed', targetId: row.id } }), 1, change);
      if (change === 'owner') await prisma.client.membershipRole.create({ data: { membershipId: f.membership.id, roleId: f.role.id } });
      if (change === 'company') await prisma.client.company.update({ where: { id: f.context.companyId }, data: { status: 'ACTIVE' } });
      assert.equal((await f.service.get(f.context, row.id)).canCancel, false, change);
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
  // 2026-10-10: the former 23-hour hold. Re-send for one hour, then read only; a read equal to the new address finishes at any age.
  test('an unknown outcome is re-sent for one hour, then only read, and a matching readback finishes it', async () => {
    const f = await fixture(), row = await f.queue(); f.mode('unknown-before'); await f.advance();
    await f.advance(); assert.equal(f.writes(), 2, 're-sent inside the window');
    await prisma.client.billingOperation.update({ where: { id: row.id }, data: { resultJson: { startedAt: new Date(Date.now() - 65 * 60_000).toISOString() } } });
    f.mode('ok'); await f.advance(); assert.equal(f.writes(), 2, 'nothing is sent after one hour');
    const issue = await prisma.client.billingIssue.findFirstOrThrow({ where: { kind: 'EMAIL_RECIPIENT_REVIEW', referenceId: row.id } });
    assert.equal(issue.state, 'OPEN'); assert.equal((await f.service.current(f.context)).busy, true);
    assert.equal((await f.service.get(f.context, row.id)).canCancel, false);
    // A read that fails decides nothing, whatever the age.
    await prisma.client.billingOperation.update({ where: { id: row.id }, data: { resultJson: { startedAt: new Date(Date.now() - 25 * 3600_000).toISOString() } } });
    f.mode('read-fails'); await f.advance(); assert.equal((await f.service.get(f.context, row.id)).state, 'RECONCILING');
    // A readback of the new address finishes the request at any age.
    f.mode('ok'); f.customer.email = f.email; await f.advance(); assert.equal(f.writes(), 2);
    assert.equal((await f.service.get(f.context, row.id)).state, 'COMPLETED');
    assert.equal((await f.service.current(f.context)).busy, false);
    assert.equal((await prisma.client.billingIssue.findUniqueOrThrow({ where: { id: issue.id } })).state, 'RESOLVED');
  });
  test('after the bound a third address at the provider ends the request the same way; before it the request waits', async () => {
    const f = await fixture(), row = await f.queue(); f.mode('unknown-before'); await f.advance();
    f.customer.email = 'someone-else@example.test'; f.mode('ok'); await f.advance();
    assert.equal(f.writes(), 1); assert.equal((await f.service.get(f.context, row.id)).state, 'RECONCILING');
    await prisma.client.billingOperation.update({ where: { id: row.id }, data: { resultJson: { startedAt: new Date(Date.now() - 71 * 60_000).toISOString() } } });
    await f.advance(); assert.equal(f.writes(), 1);
    const ended = await f.service.get(f.context, row.id);
    assert.deepEqual([ended.state, ended.errorCode], ['FAILED', 'provider_email_not_target']);
    assert.equal((await f.service.current(f.context)).busy, false);
    assert.equal(await prisma.client.auditLog.count({ where: { action: 'billing.email_recipient.not_changed', targetId: row.id } }), 1);
  });
  test('a provider read that fails before any send leaves the request waiting and cancellable', async () => {
    const f = await fixture(), row = await f.queue(); f.mode('read-fails'); await f.advance();
    const waiting = await f.service.get(f.context, row.id); assert.deepEqual([waiting.state, waiting.canCancel], ['QUEUED', true]);
    f.mode('ok'); await f.advance(); assert.equal((await f.service.get(f.context, row.id)).state, 'COMPLETED');
  });
  test('a dispatched change the provider never applied ends and frees the shop once nothing can still be in flight', async () => {
    const f = await fixture(), row = await f.queue(); f.mode('unknown-before'); await f.advance();
    await prisma.client.billingOperation.update({ where: { id: row.id }, data: { resultJson: { startedAt: new Date(Date.now() - 25 * 3600_000).toISOString() } } });
    f.mode('ok'); await f.advance(); assert.equal(f.writes(), 1, 'nothing is sent again');
    assert.notEqual(f.customer.email, f.email);
    assert.equal((await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } })).activeEmailOperationId, null, 'the shop is no longer held');
    assert.equal((await f.service.get(f.context, row.id)).state, 'FAILED');
    assert.equal((await prisma.client.billingIssue.findFirstOrThrow({ where: { kind: 'EMAIL_RECIPIENT_REVIEW', referenceId: row.id } })).state, 'OPEN', 'the review case is kept');
  });
  test('a request that was never sent and can no longer be sent holds nothing, also one left BLOCKED before this rule', async () => {
    const f = await fixture(), row = await f.queue();
    await prisma.client.billingOperation.update({ where: { id: row.id }, data: { state: 'BLOCKED', errorCode: 'email_authorization_changed' } });
    await f.advance(); assert.equal(f.writes(), 0);
    assert.equal((await f.service.get(f.context, row.id)).state, 'FAILED');
    assert.equal((await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } })).activeEmailOperationId, null, 'the shop is no longer held');
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
  test('a company recipient code changes Stripe and the column, notifies the old address, and is used once (R-A8)', async () => {
    const f = await fixture(9191301), newEmail = `${randomUUID()}@typed.example.test`, proofId = await f.proof(newEmail);
    const preview = await f.service.preview(f.context, proofId);
    assert.equal(preview.newEmail, newEmail); assert.equal(preview.source, 'CUSTOMER_OTP'); assert.equal(f.writes(), 0);
    await assert.rejects(f.service.preview(f.context, proofId), (e: any) => e.getResponse().code === 'BILLING_RECIPIENT_PROOF_INVALID');
    await f.service.command(f.context, preview.id, 'submit', preview.version, preview.previewHash, randomUUID());
    // The operation keeps its proof after the 30-minute review window.
    await prisma.client.emailVerificationToken.update({ where: { id: proofId }, data: { usedAt: new Date(Date.now() - 3_600_000) } });
    await f.advance(); assert.equal(f.writes(), 1); assert.equal(f.customer.email, newEmail);
    const stored = await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    assert.equal(stored.recipientEmail, newEmail); assert.equal(stored.recipientSource, 'CUSTOMER_OTP'); assert.equal(stored.recipientBouncedAt, null);
    const notice = await prisma.client.emailSendAttempt.findFirstOrThrow({ where: { intentKey: `billing-recipient-notice:${preview.id}` } });
    assert.ok(preview.previousEmail); assert.equal(notice.recipient, preview.previousEmail.toLowerCase());
    assert.equal(notice.status, 'READY'); assert.equal(notice.purpose, 'billing_status');
    const outbox = await prisma.client.outboxEvent.findUniqueOrThrow({ where: { eventKey: `billing:recipient-changed:${preview.id}` } });
    assert.deepEqual(outbox.payloadJson, { schemaVersion: 1, data: { operationId: preview.id, noticeAttemptId: notice.id } });
    assert.doesNotMatch(JSON.stringify([outbox.payloadJson, (await prisma.client.auditLog.findFirstOrThrow({ where: { action: 'billing.recipient.changed', targetId: f.account.id } })).metadataJson]), /@/);
    await assert.rejects(f.service.preview(f.context, proofId), (e: any) => e.getResponse().code === 'BILLING_RECIPIENT_PROOF_INVALID');
  });
  test('only a fresh, confirmed code of this company and user opens a review', async () => {
    const f = await fixture(), other = await fixture(), invalid = (e: any) => e.getResponse().code === 'BILLING_RECIPIENT_PROOF_INVALID';
    for (const proofId of [await f.proof('a@typed.example.test', { companyId: other.context.companyId }), await f.proof('b@typed.example.test', { userId: other.context.userId }),
      await f.proof('c@typed.example.test', { status: 'PENDING' }), await f.proof('d@typed.example.test', { ageMs: 31 * 60_000 }), randomUUID()])
      await assert.rejects(f.service.preview(f.context, proofId), invalid);
    await prisma.client.billingAccount.update({ where: { id: f.account.id }, data: { recipientEmail: 'same@typed.example.test' } });
    await assert.rejects(f.service.preview(f.context, await f.proof('same@typed.example.test')), (e: any) => e.getResponse().code === 'BILLING_RECIPIENT_UNCHANGED');
    assert.equal(f.writes(), 0);
  });
  test('an operation proposed before the recipient column still advances on its account email proof', async () => {
    const f = await fixture(), preview = await f.service.preview(f.context);
    const row = await prisma.client.billingOperation.findUniqueOrThrow({ where: { id: preview.id } });
    const { target, ...legacy } = row.proposedJson as Record<string, any>;
    await prisma.client.billingOperation.update({ where: { id: row.id }, data: { proposedJson: { ...legacy, emailProof: target.emailProof } } });
    assert.equal((await f.service.get(f.context, row.id)).newEmail, f.email);
    await f.service.command(f.context, row.id, 'submit', preview.version, preview.previewHash, randomUUID());
    await f.advance(); assert.equal(f.customer.email, f.email);
    const stored = await prisma.client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
    assert.equal(stored.recipientEmail, f.email); assert.equal(stored.recipientSource, 'ACCOUNT_EMAIL');
  });
});
