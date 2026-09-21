import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { hashBilling } from '../domain/billing-policy';
import { termProjectionHash } from '../domain/paid-invoice';
import { capacityOptions } from './billing-capacity';
import { BillingReconcilerService } from './billing-reconciler.service';
import { BillingService } from './billing.service';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;

test('one-time purchase source requires the exact applied invoice and preserves the PromptPay binding recovery state',
  { skip: !databaseUrl }, async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const run = randomUUID(), companyId = `billing-source-${run}`, attemptId = `attempt-${run}`, userId = `owner-${run}`;
    let accountId = '';
    try {
      await client.company.create({ data: { id: companyId, name: 'Synthetic one-time source company',
        addressJson: { line1: '99 ถนนทดสอบ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } } });
      await client.user.create({ data: { id: userId, displayName: 'Synthetic one-time owner', email: `${userId}@example.test`, emailVerifiedAt: new Date() } });
      const account = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${run}`, livemode: false,
        customerId: `cus_${run}` } });
      accountId = account.id;
      const policy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_Synthetic', priceIds: {
        'STARTER_249:month': 'price_StarterMonth', 'STARTER_249:year': 'price_StarterYear',
        'BASIC_499:month': 'price_BasicMonth', 'BASIC_499:year': 'price_BasicYear',
        'PRO_999:month': 'price_ProMonth', 'PRO_999:year': 'price_ProYear' } };
      const currentOffer = { ...billingOffer('BASIC_499', 'month', policy), availability: 'AVAILABLE' as const, reason: null };
      const startsAt = new Date(Date.now() - 60_000), paidThrough = new Date(Date.now() + 86_400_000);
      let term = await client.companyPlanTerm.create({ data: { companyId, tierKey: currentOffer.offerKey, branchLimit: currentOffer.branchLimit,
        employeeLimit: currentOffer.employeeLimit, monthlySlipLimit: currentOffer.monthlySlipLimit, termStartAt: startsAt, termEndsAt: paidThrough,
        billingReceiptAccountId: account.id } });
      const invoice = await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${run}`,
        sourceAttemptId: attemptId, offerSnapshot: currentOffer,
        contractSnapshot: { quote: { offer: currentOffer }, policy },
        policyRevisionId: 'synthetic', currency: 'THB', totalSatang: 49900, paidSatang: 49900,
        periodStart: startsAt, periodEnd: paidThrough, providerStatus: 'paid', evidenceHash: `evidence-${run}`,
        applyStatus: 'APPLIED', appliedAt: new Date() } });
      await client.billingReceiptGrant.create({ data: { companyId, billingAccountId: account.id, sourceKey: invoice.id,
        sourceHash: `grant-${run}`, kind: 'INITIAL', units: currentOffer.receiptAllowance, serviceStart: startsAt, serviceEnd: paidThrough,
        availableAt: startsAt, expiresAt: paidThrough, policyRevisionId: 'synthetic' } });
      await client.billingAccount.update({ where: { id: account.id }, data: { contractAttemptId: attemptId,
        renewalMode: 'PROMPTPAY_ONCE', paidThrough, billingAnchorDay: startsAt.getUTCDate(), termProjectionHash: termProjectionHash(term) } });
      const service = { prisma: { client }, config: { stripeAccountId: `acct_${run}` },
        stripe: { accountId: `acct_${run}`, livemode: false, enabled: true, assertAccount: async () => {},
          request: async (_method: string, path: string, params?: any) => path === '/invoices/create_preview'
            ? { id: `upcoming_${run}`, object: 'invoice', livemode: false, currency: 'thb', parent: null,
              total: params.invoice_items[0].amount, amount_due: params.invoice_items[0].amount, amount_paid: 0,
              starting_balance: 0, ending_balance: 0, amount_shipping: 0, total_taxes: [], discounts: [],
              total_discount_amounts: [], total_pretax_credit_amounts: [], pre_payment_credit_notes_amount: 0,
              lines: { has_more: false, data: [{ amount: params.invoice_items[0].amount, currency: 'thb', quantity: 1,
                discountable: false, parent: { type: 'invoice_item_details', subscription_item_details: null },
                discount_amounts: [], pretax_credit_amounts: [] }] } }
            : path.startsWith('/customers/')
            ? { id: `cus_${run}`, metadata: { billingAccountId: account.id }, email: `${userId}@example.test` }
            : { id: path.split('/').at(-1), object: 'price', livemode: false, active: true, type: 'recurring',
              product: path.includes('Starter') ? 'prod_Starter' : path.includes('Basic') ? 'prod_Basic' : 'prod_Pro', currency: 'thb',
              unit_amount: path.includes('Year') ? path.includes('Starter') ? 249000 : path.includes('Basic') ? 499000 : 999000
                : path.includes('Starter') ? 24900 : path.includes('Basic') ? 49900 : 99900,
              recurring: { interval: path.includes('Year') ? 'year' : 'month', interval_count: 1, usage_type: 'licensed' },
              billing_scheme: 'per_unit' } },
        assertOwner: async () => {},
        assertTaxSettings: async () => {},
        account: (id: string, tx = client) => tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: {
          companyId: id, stripeAccountId: `acct_${run}`, livemode: false } } }),
        purchaseSource: (company: Parameters<BillingService['purchaseSource']>[0], current: Parameters<BillingService['purchaseSource']>[1], tx = client) =>
          BillingService.prototype.purchaseSource.call({ prisma: { client } }, company, current, tx),
        settings: async () => ({ policy, revision: { id: 'synthetic-revision' }, settings: { version: 1 },
          gates: Object.fromEntries(BILLING_ACTIONS.map(action => [action, true])) }),
        usage: async () => ({ used: 0, limit: 50, remaining: 50, resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: paidThrough.toISOString() }),
      } as unknown as BillingService;
      const source = () => client.company.findUniqueOrThrow({ where: { id: companyId }, include: { planTerm: true } })
        .then(company => client.billingAccount.findUniqueOrThrow({ where: { id: account.id } })
          .then(current => BillingService.prototype.purchaseSource.call(service, company, current)));
      const status = () => BillingService.prototype.status.call(service, { companyId } as Parameters<BillingService['status']>[0]);

      assert.equal(await source(), 'PAID_CURRENT_MODE');
      let view = await status();
      assert.equal(view.purchaseEligibility, 'ELIGIBLE');
      assert.ok(view.allowedActions.includes('new_sales'));
      assert.deepEqual(view.availablePurchaseModes, ['CARD_ONCE', 'PROMPTPAY_ONCE']);
      assert.equal(view.nextChargeAt, null);
      const context = { companyId, userId, requestId: run } as Parameters<BillingService['quote']>[0];
      const quote = (purchaseMode: 'CARD_AUTO' | 'CARD_ONCE' | 'PROMPTPAY_ONCE' | 'PROMPTPAY_RENEW', offerKey = 'BASIC_499', interval = 'month') =>
        BillingService.prototype.quote.call(service, context, { offerKey, interval, billingEmail: 'ignored@example.test', purchaseMode });
      for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE'] as const) {
        const repeat = await quote(mode);
        assert.equal(repeat.purchase?.kind, 'REPEAT');
        assert.equal(repeat.previousSource, 'PAID_CURRENT_MODE');
        assert.equal(repeat.purchaseMode, mode);
      }
      for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) await assert.rejects(quote(mode),
        (error: any) => ['BILLING_MODE_CHANGE_PENDING'].includes(error.getResponse?.().code));
      const upgraded = await quote('CARD_ONCE', 'PRO_999');
      assert.equal(upgraded.purchase?.kind, 'UPGRADE');
      assert.equal(upgraded.purchase?.projectedPaidThrough, paidThrough.toISOString());
      assert.ok(upgraded.totalSatang > 0 && upgraded.totalSatang < 99900);
      assert.ok(upgraded.purchase!.receiptUnitsAdded > 0);
      const downgraded = await quote('PROMPTPAY_ONCE', 'STARTER_249');
      assert.equal(downgraded.purchase?.kind, 'SCHEDULED_CHANGE');
      assert.equal(downgraded.purchase?.previousPaidThrough, paidThrough.toISOString());
      assert.ok(Date.parse(downgraded.purchase!.projectedPaidThrough) > paidThrough.getTime());
      assert.equal(downgraded.totalSatang, 24900);
      const cadence = await quote('CARD_ONCE', 'BASIC_499', 'year');
      assert.equal(cadence.purchase?.kind, 'SCHEDULED_CHANGE');
      assert.equal(cadence.totalSatang, 499000);
      await client.billingAccount.update({ where: { id: account.id }, data: { renewalMode: 'CARD_ONCE' } });
      assert.equal(await source(), 'PAID_CURRENT_MODE');
      view = await status();
      assert.equal(view.purchaseEligibility, 'ELIGIBLE');
      assert.ok(view.allowedActions.includes('new_sales'));

      await client.billingAccount.update({ where: { id: account.id }, data: { contractAttemptId: `missing-${run}` } });
      assert.equal(await source(), 'SOURCE_INCONSISTENT');
      view = await status();
      assert.equal(view.purchaseEligibility, 'SOURCE_REVIEW_REQUIRED');
      assert.ok(!view.allowedActions.includes('new_sales'));
      await client.billingAccount.update({ where: { id: account.id }, data: { contractAttemptId: attemptId } });
      await client.billingInvoice.update({ where: { sourceAttemptId: attemptId }, data: { applyStatus: 'HELD', appliedAt: null } });
      assert.equal(await source(), 'SOURCE_INCONSISTENT');
      await client.billingInvoice.update({ where: { sourceAttemptId: attemptId }, data: { applyStatus: 'APPLIED' } });
      assert.equal(await source(), 'SOURCE_INCONSISTENT');
      await client.billingInvoice.update({ where: { sourceAttemptId: attemptId }, data: { appliedAt: new Date(), providerStatus: 'open' } });
      assert.equal(await source(), 'SOURCE_INCONSISTENT');
      await client.billingInvoice.update({ where: { sourceAttemptId: attemptId }, data: { applyStatus: 'APPLIED', appliedAt: new Date(),
        providerStatus: 'paid', periodEnd: new Date(paidThrough.getTime() + 1000) } });
      assert.equal(await source(), 'SOURCE_INCONSISTENT');
      await client.billingInvoice.update({ where: { sourceAttemptId: attemptId }, data: { periodEnd: paidThrough } });

      await client.billingAccount.update({ where: { id: account.id }, data: { renewalMode: 'PROMPTPAY_RENEW', activeAttemptId: attemptId } });
      assert.equal(await source(), 'PAID_CURRENT_MODE');
      view = await status();
      assert.equal(view.purchaseEligibility, 'ELIGIBLE');
      assert.ok(!view.allowedActions.includes('new_sales'));
      await client.billingAccount.update({ where: { id: account.id }, data: { activeAttemptId: null } });
      assert.equal(await source(), 'SOURCE_INCONSISTENT');
      await client.billingAccount.update({ where: { id: account.id }, data: { baseSubscriptionId: `sub_${run}` } });
      assert.equal(await source(), 'PAID_CURRENT_MODE');

      const expired = new Date(Date.now() - 1000);
      term = await client.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: expired } });
      await client.billingInvoice.update({ where: { sourceAttemptId: attemptId }, data: { periodEnd: expired } });
      await client.billingAccount.update({ where: { id: account.id }, data: { baseSubscriptionId: null, activeAttemptId: null,
        renewalMode: 'CARD_ONCE', contractAttemptId: attemptId, paidThrough: expired,
        termProjectionHash: termProjectionHash(term) } });
      assert.equal(await source(), 'PAID_EXPIRED_CURRENT_MODE');
      view = await status();
      assert.equal(view.purchaseEligibility, 'ELIGIBLE');
      assert.ok(view.allowedActions.includes('new_sales'));
      assert.deepEqual(view.availablePurchaseModes, ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW']);
      for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'] as const) {
        const restarted = await quote(mode);
        assert.equal(restarted.previousSource, 'PAID_EXPIRED_CURRENT_MODE');
        assert.equal(restarted.purchase?.kind, 'RESTART');
        assert.equal(restarted.purchase?.previousPaidThrough, null);
      }
    } finally {
      await client.billingQuote.deleteMany({ where: { companyId } });
      await client.billingReceiptGrant.deleteMany({ where: { companyId } });
      if (accountId) await client.billingInvoice.deleteMany({ where: { billingAccountId: accountId } });
      await client.companyPlanTerm.deleteMany({ where: { companyId } });
      await client.billingAccount.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });

test('a prepaid one-time plan change blocks on stale capacity, accepts a fresh selection, and applies once',
  { skip: !databaseUrl }, async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const run = randomUUID(), companyId = `billing-change-${run}`, userId = `owner-${run}`;
    const stripeAccountId = `acct_${run}`, attemptId = `attempt-${run}`, lease = `lease-${run}`;
    let accountId = '';
    try {
      await client.company.create({ data: { id: companyId, name: 'Synthetic prepaid plan change' } });
      await client.user.create({ data: { id: userId, displayName: 'Synthetic prepaid owner', email: `${userId}@example.test` } });
      const account = await client.billingAccount.create({ data: { companyId, stripeAccountId, livemode: false,
        customerId: `cus_${run}`, renewalMode: 'CARD_ONCE', leaseToken: lease, leaseUntil: new Date(Date.now()+120_000) } });
      accountId = account.id;
      const ownerRole = await client.role.create({ data: { companyId, scopeKey: companyId, key: 'OWNER', name: 'Owner' } });
      const owner = await client.companyMembership.create({ data: { companyId, userId, roles: { create: { roleId: ownerRole.id } } } });
      const head = await client.branch.create({ data: { companyId, code: 'HQ', name: 'Head office', type: 'HEAD_OFFICE' } });
      const extra = await client.branch.create({ data: { companyId, code: 'B2', name: 'Second branch', type: 'BRANCH' } });
      const policy = { ...BILLING_DRAFT_POLICY, priceIds: { 'STARTER_249:month': 'price_StarterMonth' } };
      const currentOffer = { ...billingOffer('BASIC_499', 'month', policy), availability: 'AVAILABLE' as const, reason: null };
      const targetOffer = { ...billingOffer('STARTER_249', 'month', policy), availability: 'AVAILABLE' as const, reason: null };
      const effectiveAt = new Date(Date.now()-60_000), newEnd = new Date(Date.now()+30*86_400_000);
      const term = await client.companyPlanTerm.create({ data: { companyId, tierKey: currentOffer.offerKey,
        branchLimit: currentOffer.branchLimit, employeeLimit: currentOffer.employeeLimit, monthlySlipLimit: currentOffer.monthlySlipLimit,
        termStartAt: new Date(Date.now()-30*86_400_000), termEndsAt: newEnd, billingReceiptAccountId: account.id } });
      const options = await capacityOptions(client, companyId, targetOffer);
      const staleSelection = { sourceHash: options.sourceHash, branchIds: [head.id], memberships: [{ id: owner.id, defaultBranchId: null }] };
      await client.branch.update({ where: { id: extra.id }, data: { name: 'Second branch changed after payment' } });
      const snapshot = { quote: { quoteId: `quote-${run}`, companyId, companyName: 'Synthetic prepaid plan change',
        policyRevision: 'synthetic', expiresAt: new Date(Date.now()+600_000).toISOString(), offer: targetOffer,
        subtotalSatang: targetOffer.priceSatang, taxSatang: 0, totalSatang: targetOffer.priceSatang,
        taxTreatment: 'NOT_VAT_REGISTERED', consentRevision: 'synthetic', purchaseMode: 'CARD_ONCE', paidStart: 'IMMEDIATE',
        billingEmail: `${userId}@example.test`, trialEndsAt: null, usage: { used: 0, limit: 50, remaining: 50,
          resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: effectiveAt.toISOString() } },
        priceId: 'price_StarterMonth', productId: 'prod_Starter', policy, termVersion: term.updatedAt.toISOString(),
        termHash: termProjectionHash(term), oneTime: { invoiceId: `source-${run}`, paidThrough: effectiveAt.toISOString(),
          anchorDay: effectiveAt.getUTCDate(), offerKey: currentOffer.offerKey, interval: currentOffer.interval },
        oneTimeChange: { effectiveAt: effectiveAt.toISOString(), currentOffer }, capacity: staleSelection };
      await client.billingAttempt.create({ data: { id: attemptId, billingAccountId: account.id, initiatingUserId: userId,
        quoteId: `quote-${run}`, channel: 'web', idempotencyKey: `idem-${run}`, requestHash: `request-${run}`,
        quoteSnapshot: snapshot, policyRevisionId: 'synthetic', consentRevision: 'synthetic', consentAt: new Date(), status: 'COMPLETED' } });
      const invoice = await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${run}`,
        sourceAttemptId: attemptId, offerSnapshot: targetOffer, contractSnapshot: snapshot, policyRevisionId: 'synthetic',
        currency: 'THB', totalSatang: targetOffer.priceSatang, paidSatang: targetOffer.priceSatang,
        periodStart: effectiveAt, periodEnd: newEnd, providerStatus: 'paid', evidenceHash: `evidence-${run}`,
        applyStatus: 'APPLIED', appliedAt: new Date() } });
      await client.billingReceiptGrant.create({ data: { companyId, billingAccountId: account.id, sourceKey: invoice.id,
        sourceHash: `grant-${run}`, kind: 'REPEAT', units: targetOffer.receiptAllowance, serviceStart: effectiveAt,
        serviceEnd: newEnd, availableAt: effectiveAt, expiresAt: newEnd, policyRevisionId: 'synthetic' } });
      const operation = await client.billingOperation.create({ data: { companyId, stripeAccountId, livemode: false,
        type: 'CUSTOMER_PREPAID_PLAN_CHANGE', state: 'SUCCEEDED', referenceId: attemptId, sourceVersion: account.version,
        proposedJson: { accountId: account.id, action: 'PREPAID_PLAN_CHANGE', subscriptionId: null,
          paidThrough: newEnd.toISOString(), effectiveAt: effectiveAt.toISOString(), prepaidInvoiceId: invoice.id,
          sourceHash: hashBilling([attemptId, invoice.id, snapshot.oneTimeChange, staleSelection]), sourceTermHash: termProjectionHash(term),
          snapshot, change: { previousId: null, currentSnapshot: { quote: { offer: currentOffer } }, selection: staleSelection },
          method: 'POST', path: '', params: {} }, reason: 'paid_one_time_plan_change', initiatorUserId: userId,
        requestHash: hashBilling([attemptId, invoice.id, targetOffer]), expiresAt: newEnd, scheduledFor: effectiveAt, observedAt: new Date() } });
      await client.billingAccount.update({ where: { id: account.id }, data: { contractAttemptId: attemptId, paidThrough: newEnd,
        billingAnchorDay: effectiveAt.getUTCDate(), termProjectionHash: termProjectionHash(term), pendingPlanChangeId: operation.id } });
      const runner = { prisma: { client }, assertLease: async (tx: typeof client, id: string, token: string) => {
        const locked = await tx.billingAccount.findUniqueOrThrow({ where: { id } });
        assert.equal(locked.leaseToken, token);
      } };
      const apply = (current: Awaited<ReturnType<typeof client.billingAccount.findUniqueOrThrow>>, token: string) =>
        (BillingReconcilerService.prototype as any).applyDueOneTimePlanChange.call(runner, current, token) as Promise<boolean>;
      assert.equal(await apply(await client.billingAccount.findUniqueOrThrow({ where: { id: account.id } }), lease), false);
      let blocked = await client.billingOperation.findUniqueOrThrow({ where: { id: operation.id } });
      assert.equal(blocked.state, 'BLOCKED');
      assert.equal(blocked.errorCode, 'BILLING_CAP_SELECTION_REQUIRED');
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } })).tierKey, currentOffer.offerKey);
      await client.billingAccount.update({ where: { id: account.id }, data: { leaseToken: null, leaseUntil: null } });
      const fresh = await capacityOptions(client, companyId, targetOffer);
      const freshSelection = { sourceHash: fresh.sourceHash, branchIds: [head.id], memberships: [{ id: owner.id, defaultBranchId: null }] };
      const billing = { prisma: { client }, assertOwner: async () => {}, account: (id: string, tx = client) =>
        tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: { companyId: id, stripeAccountId, livemode: false } } }) };
      await BillingService.prototype.repairPlanCapacity.call(billing as any, { companyId, userId, requestId: run } as any,
        operation.id, blocked.version, freshSelection, randomUUID());
      const secondLease = `lease-2-${run}`;
      await client.billingAccount.update({ where: { id: account.id }, data: { leaseToken: secondLease, leaseUntil: new Date(Date.now()+120_000) } });
      assert.equal(await apply(await client.billingAccount.findUniqueOrThrow({ where: { id: account.id } }), secondLease), true);
      blocked = await client.billingOperation.findUniqueOrThrow({ where: { id: operation.id } });
      assert.equal(blocked.state, 'APPLIED');
      assert.equal(blocked.errorCode, null);
      const appliedTerm = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
      assert.equal(appliedTerm.tierKey, targetOffer.offerKey);
      assert.equal(appliedTerm.termStartAt.toISOString(), effectiveAt.toISOString());
      assert.equal(appliedTerm.termEndsAt.toISOString(), newEnd.toISOString());
      assert.equal((await client.branch.findUniqueOrThrow({ where: { id: extra.id } })).status, 'DISABLED');
      const appliedAccount = await client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
      assert.equal(appliedAccount.pendingPlanChangeId, null);
      assert.equal(appliedAccount.termProjectionHash, termProjectionHash(appliedTerm));
      assert.equal(await apply(appliedAccount, secondLease), false);
    } finally {
      await client.outboxEvent.deleteMany({ where: { companyId } });
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.billingIssue.deleteMany({ where: { companyId } });
      await client.billingOperation.deleteMany({ where: { companyId } });
      await client.billingReceiptGrant.deleteMany({ where: { companyId } });
      if (accountId) await client.billingInvoice.deleteMany({ where: { billingAccountId: accountId } });
      await client.billingAttempt.deleteMany({ where: { billingAccountId: accountId || 'missing' } });
      await client.companyPlanTerm.deleteMany({ where: { companyId } });
      await client.membershipRole.deleteMany({ where: { membership: { companyId } } });
      await client.companyMembership.deleteMany({ where: { companyId } });
      await client.role.deleteMany({ where: { companyId } });
      await client.branch.deleteMany({ where: { companyId } });
      await client.billingAccount.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });
