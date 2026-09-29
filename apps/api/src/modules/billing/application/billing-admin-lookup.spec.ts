import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BillingAdminService } from './billing-admin.service';

const PLATFORM_MEMBER = {
  user: { status: 'ACTIVE' }, company: { status: 'ACTIVE' },
  roles: [{ role: { status: 'ACTIVE', isSystem: true, scopeKey: 'system', companyId: null, key: 'SYSTEM_ADMIN',
    permissions: [{ permission: { key: 'system.billing.read' } }] } }],
};
const CONTEXT = { userId: 'admin-1', membershipId: 'mem-1', companyId: 'sys-co', requestId: 'req-1',
  authSubject: 'admin-1', authProvider: 'system', scopes: {}, roles: [], permissions: ['system.billing.read'] } as any;

function makeService(rows: { invoices?: any[]; attempts?: any[]; operations?: any[]; issues?: any[]; companyName?: string; accounts?: any[]; ticket?: any; ticketWheres?: any[] } = {}) {
  const prisma = {
    client: {
      companyMembership: { findFirst: async () => PLATFORM_MEMBER },
      // BillingInvoice/BillingAttempt have no declared relation field to BillingAccount, so lookup()
      // resolves in-scope account ids first, then filters by billingAccountId. This fake does not
      // filter by the where clause it is given (see the scope-isolation test below for why that is
      // fine to leave undone here); it just needs a non-empty account list so the invoice/attempt
      // findMany stubs below are reached at all.
      billingAccount: { findMany: async () => rows.accounts ?? [{ id: 'acct-1', companyId: 'co-1' }, { id: 'acct-2', companyId: 'co-2' }] },
      billingInvoice: { findMany: async () => rows.invoices ?? [] },
      billingAttempt: { findMany: async () => rows.attempts ?? [] },
      billingOperation: { findMany: async () => rows.operations ?? [] },
      billingIssue: { findMany: async () => rows.issues ?? [] },
      salesEventTicket: { findFirst: async (args: any) => { rows.ticketWheres?.push(args.where); return rows.ticket ?? null; } },
      company: { findUnique: async () => (rows.companyName === null ? null : { name: rows.companyName ?? 'ร้านทดสอบ' }) },
    },
  } as any;
  const billing = { stripe: { enabled: true, accountId: 'acct_test', livemode: false } } as any;
  return new BillingAdminService(prisma, billing);
}

describe('BillingAdminService.lookup — R-E4/RV27', () => {
  it('refuses a reference under 8 characters that is not invoice-number-shaped', async () => {
    const service = makeService();
    await assert.rejects(() => service.lookup(CONTEXT, 'abcdef'), (err: unknown) => {
      assert.ok(err instanceof ConflictException);
      assert.equal((err as any).getResponse().code, 'BILLING_LOOKUP_TOO_SHORT');
      return true;
    });
  });

  it('accepts an invoice-number-shaped reference under 8 characters', async () => {
    const service = makeService({ invoices: [{ id: 'inv-uuid-1', billingAccountId: 'acct-1' }] });
    const result = await service.lookup(CONTEXT, 'JVWX-0001');
    assert.equal(result.kind, 'INVOICE');
  });

  it('finds an invoice by its 8-char suffix and links to the invoice page', async () => {
    const service = makeService({ invoices: [{ id: 'abababab-cdcd-efef-0000-0123456789ab', billingAccountId: 'acct-1' }] });
    const result = await service.lookup(CONTEXT, '0123-4567 89ab'.replace(' ', ''));
    assert.equal(result.kind, 'INVOICE');
    assert.equal(result.id, 'abababab-cdcd-efef-0000-0123456789ab');
    assert.equal(result.companyId, 'co-1');
    assert.equal(result.href, '/system/billing/companies/co-1/invoices/abababab-cdcd-efef-0000-0123456789ab');
  });

  it('falls through to an attempt when no invoice matches, and links to the checkout page', async () => {
    const service = makeService({ attempts: [{ id: 'att-1', billingAccountId: 'acct-2' }] });
    const result = await service.lookup(CONTEXT, 'ABCD1234');
    assert.equal(result.kind, 'ATTEMPT');
    assert.equal(result.href, '/system/billing/companies/co-2/checkouts/att-1');
  });

  it('links a REFUND operation to the refund page, EXPIRE_CHECKOUT to checkout-expiry, and a repair type to operations', async () => {
    const refundService = makeService({ operations: [{ id: 'op-1', companyId: 'co-3', type: 'REFUND' }] });
    const refund = await refundService.lookup(CONTEXT, 'ABCD1234');
    assert.equal(refund.href, '/system/billing/refunds/op-1');

    const checkoutService = makeService({ operations: [{ id: 'op-1b', companyId: 'co-3', type: 'EXPIRE_CHECKOUT' }] });
    const checkout = await checkoutService.lookup(CONTEXT, 'ABCD1234');
    assert.equal(checkout.href, '/system/billing/checkout-expiry/op-1b');

    const otherService = makeService({ operations: [{ id: 'op-3', companyId: 'co-3', type: 'RECONCILE' }] });
    const other = await otherService.lookup(CONTEXT, 'ABCD1234');
    assert.equal(other.href, '/system/billing/operations/op-3');
  });

  it('links plan-adjustment, receipt-adjustment and configuration-change operation types to their own admin page', async () => {
    const plan = await makeService({ operations: [{ id: 'op-plan', companyId: 'co-3', type: 'GRANT_OVERRIDE' }] }).lookup(CONTEXT, 'ABCD1234');
    assert.equal(plan.href, '/system/billing/plan-adjustments/op-plan');

    const receipts = await makeService({ operations: [{ id: 'op-rcpt', companyId: 'co-3', type: 'GRANT_RECEIPTS' }] }).lookup(CONTEXT, 'ABCD1234');
    assert.equal(receipts.href, '/system/billing/receipt-adjustments/op-rcpt');

    const config = await makeService({ operations: [{ id: 'op-cfg', companyId: 'co-3', type: 'PUBLISH_POLICY' }] }).lookup(CONTEXT, 'ABCD1234');
    assert.equal(config.href, '/system/billing/configuration-changes/op-cfg');
  });

  it('links an admin-created UPDATE_BILLING_EMAIL to recipient-changes, but a customer-created one or a type with no page to the company page', async () => {
    const adminChange = await makeService({ operations: [{ id: 'op-2', companyId: 'co-3', type: 'UPDATE_BILLING_EMAIL', proposedJson: { target: { source: 'ADMIN' } } }] }).lookup(CONTEXT, 'ABCD1234');
    assert.equal(adminChange.href, '/system/billing/recipient-changes/op-2');

    const customerChange = await makeService({ operations: [{ id: 'op-2b', companyId: 'co-3', type: 'UPDATE_BILLING_EMAIL', proposedJson: { target: { source: 'CUSTOMER' } } }] }).lookup(CONTEXT, 'ABCD1234');
    assert.equal(customerChange.href, '/system/billing/companies/co-3');

    const noPage = await makeService({ operations: [{ id: 'op-sync', companyId: 'co-3', type: 'CUSTOMER_PROFILE_SYNC' }] }).lookup(CONTEXT, 'ABCD1234');
    assert.equal(noPage.href, '/system/billing/companies/co-3');
  });

  it('links an issue to the issue page', async () => {
    const service = makeService({ issues: [{ id: 'iss-1', companyId: 'co-4' }] });
    const result = await service.lookup(CONTEXT, 'ABCD1234');
    assert.equal(result.kind, 'ISSUE');
    assert.equal(result.href, '/system/billing/issues/iss-1');
  });

  it('answers ambiguous when two rows of the same kind match the suffix', async () => {
    const service = makeService({ invoices: [{ id: 'inv-1', billingAccountId: 'acct-1' }, { id: 'inv-2', billingAccountId: 'acct-1' }] });
    await assert.rejects(() => service.lookup(CONTEXT, 'ABCD1234'), (err: unknown) => {
      assert.ok(err instanceof ConflictException);
      assert.equal((err as any).getResponse().code, 'BILLING_LOOKUP_AMBIGUOUS');
      return true;
    });
  });

  it('finds the shop that used a sales-event discount by its serial, typed any way (SD-E20)', async () => {
    const ticketWheres: any[] = [];
    const service = makeService({ ticket: { id: 'tkt-1', companyId: 'co-5' }, ticketWheres });
    const result = await service.lookup(CONTEXT, ' abcd-efgh ');
    assert.deepEqual(ticketWheres, [{ serial: 'ABCDEFGH' }]);
    assert.equal(result.kind, 'EVENT_TICKET');
    assert.equal(result.companyId, 'co-5');
    assert.equal(result.href, '/system/billing/companies/co-5');
  });

  it('says a serial no shop has used yet belongs to no shop, instead of a bare not-found', async () => {
    const service = makeService({ ticket: { id: 'tkt-2', companyId: null } });
    await assert.rejects(() => service.lookup(CONTEXT, 'ABCDEFGH'), (err: unknown) => {
      assert.ok(err instanceof ConflictException);
      assert.equal((err as any).getResponse().code, 'BILLING_LOOKUP_EVENT_TICKET_UNUSED');
      return true;
    });
  });

  it('falls through to the id suffixes when a serial-shaped reference is no discount', async () => {
    const service = makeService({ attempts: [{ id: 'att-9', billingAccountId: 'acct-2' }] });
    const result = await service.lookup(CONTEXT, 'ABCDEFGH');
    assert.equal(result.kind, 'ATTEMPT');
  });

  it('never asks for a discount when the reference cannot be a serial (0, 1, O or I)', async () => {
    const ticketWheres: any[] = [];
    await assert.rejects(() => makeService({ ticketWheres }).lookup(CONTEXT, 'ABCD1234'), NotFoundException);
    assert.deepEqual(ticketWheres, []);
  });

  it('answers an empty 404 when nothing matches at all', async () => {
    const service = makeService();
    await assert.rejects(() => service.lookup(CONTEXT, 'ABCD1234'), NotFoundException);
  });

  it('answers an empty 404 for a match outside the scoped operator\'s companies (never confirms it exists)', async () => {
    // A scoped (non-platform) operator's companyIds never include 'co-out-of-scope', so the
    // operation query itself (scoped by companyId: { in: access.companyIds }) would find nothing —
    // modelled here directly since the fake Prisma layer does not filter.
    const scopedMember = { ...PLATFORM_MEMBER, roles: [{ role: { ...PLATFORM_MEMBER.roles[0].role, key: 'BILLING_OPERATOR' } }] };
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => scopedMember, },
        billingOperatorScope: { findMany: async () => [{ companyId: 'co-in-scope' }] },
        billingAccount: { findMany: async () => [] },
        billingInvoice: { findMany: async () => [] },
        billingAttempt: { findMany: async () => [] },
        billingOperation: { findMany: async () => [] },
        billingIssue: { findMany: async () => [] },
        company: { findUnique: async () => null },
      },
    } as any;
    const billing = { stripe: { enabled: true, accountId: 'acct_test', livemode: false } } as any;
    const service = new BillingAdminService(prisma, billing);
    await assert.rejects(() => service.lookup(CONTEXT, 'ABCD1234'), NotFoundException);
  });
});
