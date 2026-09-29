import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingDocumentResend, RESEND_LIMIT, RESEND_NOTICE_EVENT, resendStripeDocuments } from './billing-document-resend';
import { BILLING_NOTICE_EMAIL } from './billing-notifications.service';
import { canResendDocuments } from './billing.service';
import { StripeRequestError } from '../infrastructure/stripe.client';

type Row = Record<string, any>;
const code = (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code;

function fixture(overrides: { account?: Row; invoice?: Row; charge?: Row; leaseBusy?: boolean; stripeFailure?: StripeRequestError } = {}) {
  const account = { id: 'account-1', companyId: 'company-1', customerId: 'cus_1', stripeAccountId: 'acct_1', livemode: false,
    recipientEmail: 'docs@example.test', recipientBouncedAt: null, activeEmailOperationId: null, ...overrides.account };
  const invoice = { id: 'invoice-1', billingAccountId: 'account-1', providerInvoiceId: 'in_1', providerChargeId: 'ch_1', subscriptionId: null,
    providerStatus: 'paid', applyStatus: 'APPLIED', totalSatang: 24900, paidSatang: 24900, ...overrides.invoice };
  const charge = { id: 'ch_1', livemode: false, customer: 'cus_1', currency: 'thb', status: 'succeeded', paid: true, captured: true,
    amount: 24900, amount_refunded: 0, disputed: false, receipt_email: 'old@example.test', ...overrides.charge };
  const events: string[] = [], outbox: Row[] = [], audits: Row[] = [], budget = { count: 0 };
  let lease: string | null = null;
  const stripe = { accountId: 'acct_1', livemode: false, assertAccount: async () => {},
    request: async (method: string, path: string, params: Row = {}) => {
      events.push(`${method} ${path}`);
      if (overrides.stripeFailure && method === 'POST') throw overrides.stripeFailure;
      if (path === '/invoices/in_1') return { id: 'in_1', livemode: false, customer: 'cus_1', parent: null, currency: 'thb', status: 'paid', total: 24900, amount_paid: 24900 };
      if (path === '/invoices/in_1/send') return { id: 'in_1' };
      if (path === '/charges/ch_1' && method === 'GET') return charge;
      if (path === '/charges/ch_1') { charge.receipt_email = params.receipt_email; return charge; }
      throw new Error(`unexpected ${method} ${path}`);
    } };
  const tx = { $queryRaw: async () => [], outboxEvent: { upsert: async ({ create }: Row) => { outbox.push(create); return create; } },
    auditLog: { create: async ({ data }: Row) => { audits.push(data); return data; } } };
  const prisma = { client: {
    company: { findUnique: async () => ({ status: 'ACTIVE', planTerm: null }) },
    billingInvoice: { findFirst: async ({ where }: Row) => where.id === invoice.id && where.billingAccountId === account.id ? invoice : null },
    billingAccount: { updateMany: async ({ where, data }: Row) => {
      if (where.leaseToken) { if (lease !== where.leaseToken) return { count: 0 }; lease = null; events.push('release'); return { count: 1 }; }
      if (overrides.leaseBusy) return { count: 0 };
      lease = data.leaseToken; events.push('lease'); return { count: 1 };
    } },
    $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const limits = {
    inspect: async () => { events.push('inspect'); return { allowed: budget.count < RESEND_LIMIT, count: budget.count, retryAfterSeconds: 3600 }; },
    consume: async () => { events.push('consume'); budget.count++; return { allowed: budget.count <= RESEND_LIMIT, count: budget.count, retryAfterSeconds: 3600 }; },
  };
  const billing = { assertOwner: async () => {}, account: async () => account };
  const service = new BillingDocumentResend(prisma as any, stripe as any, billing as any);
  const run = () => service.run({ companyId: 'company-1', userId: 'user-1', requestId: 'request-1' } as any, 'invoice-1', limits as any);
  return { run, events, outbox, audits, budget, charge, account, invoice, stripe, lease: () => lease };
}

describe('customer document resend (R-D1)', () => {
  it('inspects, calls Stripe under the lease, then consumes; the receipt moves only when its email differs', async () => {
    const f = fixture();
    assert.deepEqual(await f.run(), { invoiceSent: true, receiptUpdated: true, recipientEmail: 'docs@example.test', remainingToday: 2 });
    assert.deepEqual(f.events, ['inspect', 'lease', 'GET /invoices/in_1', 'POST /invoices/in_1/send', 'GET /charges/ch_1', 'POST /charges/ch_1', 'release', 'consume']);
    assert.equal(f.charge.receipt_email, 'docs@example.test'); assert.equal(f.lease(), null);
    assert.equal(f.outbox[0]!.eventType, RESEND_NOTICE_EVENT); assert.deepEqual(f.outbox[0]!.payloadJson, { schemaVersion: 2, data: { recipientUserId: null, resend: true } });
    assert.equal(f.audits[0]!.action, 'billing.document.resent'); assert.doesNotMatch(JSON.stringify([f.outbox, f.audits]), /@/, 'no email in outbox or audit');
    f.events.length = 0;
    assert.deepEqual(await f.run(), { invoiceSent: true, receiptUpdated: false, recipientEmail: 'docs@example.test', remainingToday: 1 });
    assert.equal(f.events.includes('POST /charges/ch_1'), false, 'no charge update when receipt_email already matches');
    assert.notEqual(f.outbox[0]!.eventKey, f.outbox[1]!.eventKey);
  });

  it('refuses the fourth resend of the day without calling Stripe', async () => {
    const f = fixture(); f.budget.count = RESEND_LIMIT;
    await assert.rejects(f.run(), e => code(e) === 'BILLING_RESEND_LIMIT' && (e as any).getStatus() === 429 && (e as any).getResponse().retryAfterSeconds === 3600);
    assert.deepEqual(f.events, ['inspect']);
  });

  it('a Stripe failure is BILLING_RESEND_UNAVAILABLE, releases the lease and is not counted', async () => {
    for (const outcome of ['REJECTED', 'UNKNOWN'] as const) {
      const f = fixture({ stripeFailure: new StripeRequestError(outcome, 'synthetic') });
      await assert.rejects(f.run(), e => code(e) === 'BILLING_RESEND_UNAVAILABLE');
      assert.equal(f.events.includes('consume'), false); assert.equal(f.events.at(-1), 'release'); assert.equal(f.lease(), null);
      assert.equal(f.outbox.length + f.audits.length, 0);
    }
  });

  it('needs a paid applied document, a settled recipient that has not bounced, and a free lease', async () => {
    await assert.rejects(fixture({ invoice: { applyStatus: 'HELD' } }).run(), e => code(e) === 'BILLING_RESEND_UNAVAILABLE');
    await assert.rejects(fixture({ account: { recipientEmail: null } }).run(), e => code(e) === 'BILLING_RESEND_UNAVAILABLE');
    await assert.rejects(fixture({ account: { activeEmailOperationId: 'op-1' } }).run(), e => code(e) === 'BILLING_EMAIL_UPDATE_PENDING');
    await assert.rejects(fixture({ account: { recipientBouncedAt: new Date() } }).run(), e => code(e) === 'BILLING_RECIPIENT_BOUNCED');
    const busy = fixture({ leaseBusy: true });
    await assert.rejects(busy.run(), e => code(e) === 'BILLING_PURCHASE_PENDING');
    assert.equal(busy.events.some(e => e.startsWith('POST')), false);
  });

  it('exports the Stripe half for the admin resend and keeps the notice on the billing mail event', async () => {
    const f = fixture();
    assert.deepEqual(await resendStripeDocuments(f.stripe as any, f.account as any, f.invoice as any, 'docs@example.test'), { invoiceSent: true, receiptUpdated: true });
    assert.equal(RESEND_NOTICE_EVENT, BILLING_NOTICE_EMAIL);
  });
});

describe('resend button availability (documentActions.canResend)', () => {
  it('hides once the recipient has bounced, since the command above refuses BILLING_RECIPIENT_BOUNCED', () => {
    const row = { providerStatus: 'paid', applyStatus: 'APPLIED' };
    const ready = { recipientEmail: 'docs@example.test', activeEmailOperationId: null, recipientBouncedAt: null };
    assert.equal(canResendDocuments(row, ready), true, 'the button shows once everything is settled');
    assert.equal(canResendDocuments(row, { ...ready, recipientBouncedAt: new Date() }), false, 'bounced recipient hides it');
    assert.equal(canResendDocuments(row, { ...ready, recipientEmail: null }), false, 'no recipient hides it');
    assert.equal(canResendDocuments(row, { ...ready, activeEmailOperationId: 'op-1' }), false, 'a pending recipient change hides it');
    assert.equal(canResendDocuments({ ...row, providerStatus: 'open' }, ready), false, 'an unpaid document hides it');
    assert.equal(canResendDocuments({ ...row, applyStatus: 'HELD' }, ready), false, 'a document not yet applied hides it');
  });
});
