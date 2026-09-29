import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { BillingDocumentAdminService } from './billing-document-admin.service';

const MANAGE = 'system.billing.override.manage';
const READ = 'system.billing.financial.read';
const APPROVE = 'system.billing.approval.approve';
const CONTEXT = { userId: 'admin-1', membershipId: 'mem-1', companyId: 'sys-co', requestId: 'req-1',
  authSubject: 'admin-1', authProvider: 'system', scopes: {}, roles: [], permissions: [MANAGE, READ, APPROVE] } as any;

/** Reusable fake store: `$transaction` runs its callback against the SAME collection mocks, so a
 *  test can assert on writes made either directly or inside a transaction. */
function makeStore(overrides: {
  account?: any; invoice?: any; customer?: any; pendingAdminOp?: any; stripeRequest?: (method: string, path: string, body?: unknown) => Promise<any>;
} = {}) {
  const account = overrides.account ?? { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId: 'cus_1',
    version: 3, activeAttemptId: null, activeCollectionOperationId: null, activeEmailOperationId: null, recipientEmail: 'old@example.com',
    recipientSource: 'ACCOUNT_EMAIL', recipientBouncedAt: null, recipientBounceNotifiedAt: null };
  const invoice = overrides.invoice ?? { id: 'inv-1', billingAccountId: account.id, providerNumber: 'INV-0001', providerStatus: 'paid', applyStatus: 'APPLIED' };
  const operations: any[] = [];
  const auditLogs: any[] = [];
  const emailAttempts: any[] = [];
  const outboxEvents: any[] = [];
  let opSeq = 0;

  const client: any = {
    billingInvoice: { findFirst: async () => invoice },
    billingIssue: { findFirst: async () => null, findUnique: async () => null,
      create: async ({ data }: any) => ({ id: 'iss-1', version: 0, episode: 1, state: 'OPEN', ...data }) },
    billingOperation: {
      create: async ({ data }: any) => { const now = new Date(); const row = { id: `op-${++opSeq}`, version: 0, state: data.state ?? 'PREVIEW', leaseToken: null, leaseUntil: null,
        approverUserId: null, idempotencyKey: null, errorCode: null, observedAt: null, scheduledFor: null, resultJson: null, createdAt: now, updatedAt: now, ...data }; operations.push(row); return row; },
      findFirst: async ({ where }: any) => operations.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: any) => operations.filter((row) => matches(row, where)),
      findUnique: async ({ where }: any) => operations.find((row) => row.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => { const row = operations.find((r) => r.id === where.id); if (!row) throw new Error('not found'); return row; },
      update: async ({ where, data }: any) => { const row = operations.find((r) => r.id === where.id)!; Object.assign(row, resolveData(row, data)); return row; },
      updateMany: async ({ where, data }: any) => { const rows = operations.filter((row) => matches(row, where)); for (const row of rows) Object.assign(row, resolveData(row, data)); return { count: rows.length }; },
    },
    billingAccount: {
      findUnique: async () => account,
      update: async ({ data }: any) => { Object.assign(account, resolveData(account, data)); return account; },
      updateMany: async ({ data }: any) => { Object.assign(account, resolveData(account, data)); return { count: 1 }; },
    },
    auditLog: { create: async ({ data }: any) => { auditLogs.push(data); return data; } },
    emailSendAttempt: { create: async ({ data }: any) => { emailAttempts.push(data); return data; } },
    outboxEvent: { upsert: async ({ create }: any) => { outboxEvents.push(create); return create; } },
    // Only what detectBillingIssue's no-prior-issue path touches (item 4's aged-unknown test):
    // no SLA policy configured, and a plain create so the row it returns has an episode to log.
    billingSettings: { findUnique: async () => null },
    userCredential: { findUnique: async ({ where }: any) => ({ userId: where.userId, status: 'ACTIVE', mustChangePassword: false, expiresAt: null, updatedAt: new Date('2026-01-01T00:00:00.000Z') }) },
    // Row-locking only matters against a real Postgres; the fake store has no concurrency to guard.
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);

  function matches(row: any, where: any): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      if (key === 'proposedJson' && value && typeof value === 'object' && 'path' in (value as any)) {
        const path = (value as any).path as string[], equals = (value as any).equals;
        let cursor: any = row.proposedJson; for (const segment of path) cursor = cursor?.[segment];
        return cursor === equals;
      }
      if (key === 'state' && value && typeof value === 'object' && 'in' in (value as any)) return (value as any).in.includes(row.state);
      if (key === 'id' && value && typeof value === 'object' && 'not' in (value as any)) return row.id !== (value as any).not;
      if (value && typeof value === 'object' && 'gt' in (value as any)) return row[key] instanceof Date && row[key] > (value as any).gt;
      if (value === undefined) return true;
      return row[key] === value;
    });
  }
  function resolveData(row: any, data: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = value && typeof value === 'object' && 'increment' in (value as any) ? (row[key] ?? 0) + (value as any).increment : value;
    }
    return out;
  }

  // Mirrors BillingAdminService.access(): capabilities are exactly the caller's own permissions
  // (scoped to system.billing.*), so a context missing a key genuinely cannot act — the same
  // rule the real ForbiddenException guards.
  const admin = {
    scopedCompany: async (ctx: any) => ({ access: { capabilities: ctx.permissions, platformScope: true, companyIds: [] }, company: { name: 'ร้านทดสอบ' }, account }),
    access: async (ctx: any, key: string) => {
      if (!ctx.permissions.includes(key)) throw new ForbiddenException();
      return { capabilities: ctx.permissions, platformScope: true, companyIds: [] };
    },
  } as any;
  const configuration = {
    requireProof: async () => {},
    operationActor: async (_row: unknown, userId: string, membershipId: string, companyId: string) => ({ userId, membershipId, companyId, permissions: [] }),
    requireApprovalActor: async () => {},
  } as any;
  const billing = {
    stripe: { accountId: 'acct_test', livemode: false, assertAccount: async () => {}, request: overrides.stripeRequest ?? (async (_method: string, path: string) => {
      if (path.includes('/customers/')) return overrides.customer ?? { id: account.customerId, object: 'customer', livemode: false, email: 'old@example.com', metadata: { billingAccountId: account.id } };
      return {};
    }) },
    account: async () => account,
  } as any;
  const appConfig = { postmarkServerId: 'srv-1', postmarkMessageStream: 'outbound' } as any;

  const service = new BillingDocumentAdminService({ client } as any, billing, admin, configuration, appConfig);
  return { service, account, invoice, operations, auditLogs, emailAttempts, outboxEvents, client };
}

describe('BillingDocumentAdminService.review — R-E1', () => {
  it('BILLING_RECIPIENT_NO_CUSTOMER when the account has no Stripe Customer', async () => {
    const { service } = makeStore({ account: { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId: null,
      version: 1, activeAttemptId: null, activeCollectionOperationId: null, activeEmailOperationId: null, recipientEmail: null, recipientSource: null, recipientBouncedAt: null } });
    const result = await service.review(CONTEXT, 'co-1', 'inv-1');
    assert.equal(result.blockedReason, 'BILLING_RECIPIENT_NO_CUSTOMER');
    assert.equal(result.canChange, false);
  });

  it('BILLING_RECIPIENT_BUSY when a purchase is in flight', async () => {
    const { service } = makeStore({ account: { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId: 'cus_1',
      version: 1, activeAttemptId: 'att-1', activeCollectionOperationId: null, activeEmailOperationId: null, recipientEmail: null, recipientSource: null, recipientBouncedAt: null } });
    const result = await service.review(CONTEXT, 'co-1', 'inv-1');
    assert.equal(result.blockedReason, 'BILLING_RECIPIENT_BUSY');
  });

  it('canChange when nothing is in flight', async () => {
    const { service } = makeStore();
    const result = await service.review(CONTEXT, 'co-1', 'inv-1');
    assert.equal(result.canChange, true);
    assert.equal(result.blockedReason, null);
    assert.equal(result.currentEmail, 'old@example.com');
  });
});

describe('BillingDocumentAdminService.preview — R-E1', () => {
  it('rejects an invalid email format', async () => {
    const { service } = makeStore();
    await assert.rejects(() => service.preview(CONTEXT, 'co-1', 'inv-1', { newEmail: 'not-an-email', reason: 'r', sourceHash: 'x' } as any),
      (err: unknown) => { assert.equal((err as any).getResponse?.().code, 'BILLING_RECIPIENT_INVALID'); return true; });
  });

  it('rejects when the new email matches the current recipient', async () => {
    const { service } = makeStore();
    const review = await service.review(CONTEXT, 'co-1', 'inv-1');
    await assert.rejects(() => service.preview(CONTEXT, 'co-1', 'inv-1', { newEmail: 'old@example.com', reason: 'r', sourceHash: review.sourceHash } as any),
      (err: unknown) => { assert.equal((err as any).getResponse?.().code, 'BILLING_RECIPIENT_UNCHANGED'); return true; });
  });

  it('rejects a stale sourceHash (CONTROL_PREVIEW_STALE)', async () => {
    const { service } = makeStore();
    await assert.rejects(() => service.preview(CONTEXT, 'co-1', 'inv-1', { newEmail: 'new@example.com', reason: 'r', sourceHash: 'stale' } as any),
      (err: unknown) => { assert.equal((err as any).getResponse?.().code, 'CONTROL_PREVIEW_STALE'); return true; });
  });

  it('creates a PREVIEW row tagged source ADMIN, type UPDATE_BILLING_EMAIL', async () => {
    const { service, operations } = makeStore();
    const review = await service.review(CONTEXT, 'co-1', 'inv-1');
    const op = await service.preview(CONTEXT, 'co-1', 'inv-1', { newEmail: 'new@example.com', reason: 'ลูกค้าขอเปลี่ยน', sourceHash: review.sourceHash } as any);
    assert.equal(op.state, 'PREVIEW');
    assert.equal(op.newEmail, 'new@example.com');
    assert.equal(op.previousEmail, 'old@example.com');
    assert.equal(operations.length, 1);
    assert.equal(operations[0].type, 'UPDATE_BILLING_EMAIL');
    assert.equal(operations[0].proposedJson.target.source, 'ADMIN');
  });

  it('refuses to preview while a purchase is in flight (BILLING_RECIPIENT_BUSY)', async () => {
    const { service } = makeStore({ account: { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId: 'cus_1',
      version: 1, activeAttemptId: 'att-1', activeCollectionOperationId: null, activeEmailOperationId: null, recipientEmail: 'old@example.com', recipientSource: 'ACCOUNT_EMAIL', recipientBouncedAt: null } });
    const review = await service.review(CONTEXT, 'co-1', 'inv-1');
    assert.equal(review.blockedReason, 'BILLING_RECIPIENT_BUSY');
    await assert.rejects(() => service.preview(CONTEXT, 'co-1', 'inv-1', { newEmail: 'new@example.com', reason: 'r', sourceHash: review.sourceHash } as any),
      (err: unknown) => { assert.equal((err as any).getResponse?.().code, 'BILLING_RECIPIENT_BUSY'); return true; });
  });
});

describe('BillingDocumentAdminService.command — submit/approve/cancel (R-E1, DQ7 single-admin)', () => {
  async function previewOp() {
    const store = makeStore();
    const review = await store.service.review(CONTEXT, 'co-1', 'inv-1');
    const op = await store.service.preview(CONTEXT, 'co-1', 'inv-1', { newEmail: 'new@example.com', reason: 'r', sourceHash: review.sourceHash } as any);
    return { ...store, op };
  }

  it('submit requires override.manage', async () => {
    const { service, op } = await previewOp();
    const noManage = { ...CONTEXT, permissions: [READ] };
    await assert.rejects(() => service.command(noManage, op.id, 'submit', op.version, op.previewHash, 'k'.repeat(20)), ForbiddenException);
  });

  it('submit -> AWAITING_APPROVAL, then a platform admin can self-confirm approve -> QUEUED', async () => {
    const { service, op, operations } = await previewOp();
    const submitted = await service.command(CONTEXT, op.id, 'submit', op.version, op.previewHash, 'k'.repeat(20));
    assert.equal(submitted.state, 'AWAITING_APPROVAL');
    const approved = await service.command(CONTEXT, op.id, 'approve', submitted.version, submitted.previewHash);
    assert.equal(approved.state, 'QUEUED');
    assert.equal(approved.approvalMode, 'SINGLE_ADMIN');
    assert.equal(operations[0].approverUserId, 'admin-1');
  });

  it('cancel moves a PREVIEW op to CANCELLED', async () => {
    const { service, op } = await previewOp();
    const cancelled = await service.command(CONTEXT, op.id, 'cancel', op.version, op.previewHash);
    assert.equal(cancelled.state, 'CANCELLED');
  });
});

describe('BillingDocumentAdminService.resend — R-D1 for admins (DQ10)', () => {
  it('BILLING_RESEND_UNAVAILABLE when the invoice is not paid/applied', async () => {
    const { service } = makeStore({ invoice: { id: 'inv-1', billingAccountId: 'acct-1', providerNumber: 'INV-1', providerStatus: 'open', applyStatus: 'PENDING' } });
    const limits = { inspect: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }), consume: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }) } as any;
    await assert.rejects(() => service.resend(CONTEXT, 'co-1', 'inv-1', 'reason', limits),
      (err: unknown) => { assert.equal((err as any).getResponse?.().code, 'BILLING_RESEND_UNAVAILABLE'); return true; });
  });

  it('BILLING_RESEND_UNAVAILABLE when there is no recipient email yet', async () => {
    const { service } = makeStore({ account: { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId: 'cus_1',
      version: 1, activeAttemptId: null, activeCollectionOperationId: null, activeEmailOperationId: null, recipientEmail: null, recipientSource: null, recipientBouncedAt: null } });
    const limits = { inspect: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }), consume: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }) } as any;
    await assert.rejects(() => service.resend(CONTEXT, 'co-1', 'inv-1', 'reason', limits),
      (err: unknown) => { assert.equal((err as any).getResponse?.().code, 'BILLING_RESEND_UNAVAILABLE'); return true; });
  });

  it('BILLING_RECIPIENT_BOUNCED when the recipient email is flagged bounced', async () => {
    const { service } = makeStore({ account: { id: 'acct-1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false, customerId: 'cus_1',
      version: 1, activeAttemptId: null, activeCollectionOperationId: null, activeEmailOperationId: null, recipientEmail: 'old@example.com', recipientSource: 'ACCOUNT_EMAIL', recipientBouncedAt: new Date() } });
    const limits = { inspect: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }), consume: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }) } as any;
    await assert.rejects(() => service.resend(CONTEXT, 'co-1', 'inv-1', 'reason', limits),
      (err: unknown) => { assert.equal((err as any).getResponse?.().code, 'BILLING_RECIPIENT_BOUNCED'); return true; });
  });

  it('BILLING_RESEND_LIMIT (429) when the 10/day admin budget is spent', async () => {
    const { service } = makeStore();
    const limits = { inspect: async () => ({ allowed: false, retryAfterSeconds: 3600, count: 10 }), consume: async () => ({ allowed: false, retryAfterSeconds: 3600, count: 10 }) } as any;
    await assert.rejects(() => service.resend(CONTEXT, 'co-1', 'inv-1', 'reason', limits), (err: unknown) => {
      assert.ok(err instanceof HttpException);
      assert.equal((err.getResponse() as any).code, 'BILLING_RESEND_LIMIT');
      assert.equal(err.getStatus(), 429);
      return true;
    });
  });

  it('on success: audits billing.document.resent with actor ADMIN and returns remainingToday from the 10/day budget', async () => {
    const { service, auditLogs, outboxEvents } = makeStore({
      stripeRequest: async (method: string, path: string) => {
        if (method === 'GET' && path.startsWith('/invoices/')) return { id: 'in_1', livemode: false, customer: 'cus_1', parent: null, currency: 'thb', status: 'paid', total: 10_000, amount_paid: 10_000 };
        if (path.includes('/invoices/') && path.includes('/send')) return { id: 'in_1' };
        if (path.startsWith('/charges/')) return { receipt_email: 'old@example.com', metadata: {} };
        return { id: 'in_1' };
      },
      invoice: { id: 'inv-1', billingAccountId: 'acct-1', providerNumber: 'INV-1', providerStatus: 'paid', applyStatus: 'APPLIED',
        providerInvoiceId: 'in_1', providerChargeId: null, subscriptionId: null, totalSatang: 10_000, paidSatang: 10_000 },
    });
    const limits = { inspect: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }), consume: async () => ({ allowed: true, retryAfterSeconds: 0, count: 3 }) } as any;
    const result = await service.resend(CONTEXT, 'co-1', 'inv-1', 'ลูกค้าโทรมาขอใบใหม่', limits);
    assert.equal(result.recipientEmail, 'old@example.com');
    assert.equal(result.remainingToday, 7);
    assert.equal(auditLogs.some((entry) => entry.action === 'billing.document.resent' && entry.metadataJson.actor === 'ADMIN'), true);
    assert.equal(outboxEvents.length, 1);
    assert.equal(JSON.stringify(outboxEvents[0]).includes('old@example.com'), false, 'no email in the outbox payload');
  });

  it('records an optional supportRequestId on the audit entry, like the admin recipient change does (item 5)', async () => {
    const { service, auditLogs } = makeStore({
      stripeRequest: async (method: string, path: string) => {
        if (method === 'GET' && path.startsWith('/invoices/')) return { id: 'in_1', livemode: false, customer: 'cus_1', parent: null, currency: 'thb', status: 'paid', total: 10_000, amount_paid: 10_000 };
        if (path.includes('/invoices/') && path.includes('/send')) return { id: 'in_1' };
        if (path.startsWith('/charges/')) return { receipt_email: 'old@example.com', metadata: {} };
        return { id: 'in_1' };
      },
      invoice: { id: 'inv-1', billingAccountId: 'acct-1', providerNumber: 'INV-1', providerStatus: 'paid', applyStatus: 'APPLIED',
        providerInvoiceId: 'in_1', providerChargeId: null, subscriptionId: null, totalSatang: 10_000, paidSatang: 10_000 },
    });
    const limits = { inspect: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }), consume: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }) } as any;
    await service.resend(CONTEXT, 'co-1', 'inv-1', 'ลูกค้าโทรมาขอใบใหม่', limits, 'sup-123');
    const entry = auditLogs.find((row) => row.action === 'billing.document.resent');
    assert.equal(entry?.metadataJson.supportRequestId, 'sup-123');
  });

  it('omits supportRequestId from the audit entry when none is given', async () => {
    const { service, auditLogs } = makeStore({
      stripeRequest: async (method: string, path: string) => {
        if (method === 'GET' && path.startsWith('/invoices/')) return { id: 'in_1', livemode: false, customer: 'cus_1', parent: null, currency: 'thb', status: 'paid', total: 10_000, amount_paid: 10_000 };
        if (path.includes('/invoices/') && path.includes('/send')) return { id: 'in_1' };
        if (path.startsWith('/charges/')) return { receipt_email: 'old@example.com', metadata: {} };
        return { id: 'in_1' };
      },
      invoice: { id: 'inv-1', billingAccountId: 'acct-1', providerNumber: 'INV-1', providerStatus: 'paid', applyStatus: 'APPLIED',
        providerInvoiceId: 'in_1', providerChargeId: null, subscriptionId: null, totalSatang: 10_000, paidSatang: 10_000 },
    });
    const limits = { inspect: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }), consume: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }) } as any;
    await service.resend(CONTEXT, 'co-1', 'inv-1', 'ลูกค้าโทรมาขอใบใหม่', limits);
    const entry = auditLogs.find((row) => row.action === 'billing.document.resent');
    assert.equal('supportRequestId' in (entry?.metadataJson ?? {}), false);
  });
});

describe('BillingDocumentAdminService.run — aged UNKNOWN (item 4, mirrors billing-refunds.service CONTROL_REFUND_AGED_UNKNOWN)', () => {
  it('blocks a recipient change with CONTROL_RECIPIENT_AGED_UNKNOWN once 23h pass with no confirmed Stripe readback', async () => {
    const { service, client, operations } = makeStore();
    const op = await client.billingOperation.create({ data: {
      type: 'UPDATE_BILLING_EMAIL', state: 'UNKNOWN', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false,
      referenceId: 'inv-1', initiatorUserId: 'admin-1', sourceVersion: 3, reason: 'ลูกค้าโทรแจ้งเปลี่ยนอีเมล',
      requestHash: 'hash-1', expiresAt: new Date(Date.now() + 600_000),
      proposedJson: { accountId: 'acct-1', customerId: 'cus_1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false,
        invoiceId: 'inv-1', invoiceNumber: 'INV-0001', membershipId: 'mem-1', actorCompanyId: 'sys-co',
        previousEmail: 'old@example.com', target: { email: 'new@example.com', source: 'ADMIN' }, localHash: 'hash-x' },
      // Dispatched 24h ago; Stripe still reads back the old email (makeStore's default customer fake).
      resultJson: { dispatchedAt: new Date(Date.now() - 24 * 3_600_000).toISOString(), providerKey: 'billing-recipient-admin-prior' },
    } });
    const result = await service.run(CONTEXT, op.id, op.version);
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.errorCode, 'CONTROL_RECIPIENT_AGED_UNKNOWN');
    assert.equal(operations[0].leaseToken, null, 'lease released');
  });

  it('still just leaves it UNKNOWN under 23h old (unaged) so the reconciler keeps polling', async () => {
    // A readback that matches neither the old nor the new email (not the aged case: still needs
    // review, same as before this change) — CONTROL_PREVIEW_STALE with dispatchedAt set stays
    // CONTROL_RECIPIENT_REVIEW/UNKNOWN, unlike the aged branch above.
    const { service, client } = makeStore({ stripeRequest: async (_method: string, path: string) =>
      path.includes('/customers/') ? { id: 'cus_1', object: 'customer', livemode: false, email: 'someone-else@example.com', metadata: { billingAccountId: 'acct-1' } } : {} });
    const op = await client.billingOperation.create({ data: {
      type: 'UPDATE_BILLING_EMAIL', state: 'UNKNOWN', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false,
      referenceId: 'inv-1', initiatorUserId: 'admin-1', sourceVersion: 3, reason: 'ลูกค้าโทรแจ้งเปลี่ยนอีเมล',
      requestHash: 'hash-1', expiresAt: new Date(Date.now() + 600_000),
      proposedJson: { accountId: 'acct-1', customerId: 'cus_1', companyId: 'co-1', stripeAccountId: 'acct_test', livemode: false,
        invoiceId: 'inv-1', invoiceNumber: 'INV-0001', membershipId: 'mem-1', actorCompanyId: 'sys-co',
        previousEmail: 'old@example.com', target: { email: 'new@example.com', source: 'ADMIN' }, localHash: 'hash-x' },
      resultJson: { dispatchedAt: new Date(Date.now() - 60_000).toISOString(), providerKey: 'billing-recipient-admin-prior' },
    } });
    const result = await service.run(CONTEXT, op.id, op.version);
    assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.errorCode, 'CONTROL_RECIPIENT_REVIEW');
  });
});
