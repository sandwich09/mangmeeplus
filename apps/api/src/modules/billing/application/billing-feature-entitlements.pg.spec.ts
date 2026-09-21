import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { ALL_FEATURE_ENTITLEMENT_KEYS, FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { humanDecidedKeys } from '../../employee-access/application/normalize-entitlements';
import { exclusiveEntitlementLock } from '../../feature-launch/application/execution-attempt.service';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { applyBillingFeaturePlan, billingFeaturePlan } from './billing-feature-entitlements';
import { supersedeUnpaidPackageRequest } from './billing-package-request';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
test('paid package rights apply atomically on local PostgreSQL', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const companyId = `billing-feature-${randomUUID()}`;
  let ownerUserId = '';
  try {
    await client.company.create({ data: { id: companyId, name: 'Synthetic billing feature company' } });
    ownerUserId = (await client.user.create({ data: { displayName: 'Synthetic billing feature owner' } })).id;
    const { plan, impact } = await billingFeaturePlan(client, companyId);
    assert.ok(impact.removed.some(item => item.featureKey === 'reports'));
    const apply = (invoiceId: string, rollback = false, selectedPlan = plan) => client.$transaction(async tx => {
      await tx.$executeRaw(exclusiveEntitlementLock(companyId));
      await lockPlanTermCompany(tx, companyId);
      const disabled = await applyBillingFeaturePlan(tx, companyId, invoiceId, ownerUserId, selectedPlan);
      if (rollback) throw new Error('synthetic rollback after entitlement apply');
      return disabled;
    });
    await assert.rejects(apply('invoice-rollback', true), /synthetic rollback/);
    assert.equal(await client.companyFeatureEntitlement.count({ where: { companyId } }), 0);
    assert.equal(await client.companyEntitlementNormalization.count({ where: { companyId } }), 0);
    assert.equal(await client.entitlementTransition.count({ where: { companyId } }), 0);
    const disabled = await apply('invoice-paid');
    assert.equal(disabled.length, impact.removed.length);
    assert.equal(await client.companyFeatureEntitlement.count({ where: { companyId } }), ALL_FEATURE_ENTITLEMENT_KEYS.length);
    assert.equal(await client.companyFeatureEntitlement.count({ where: { companyId, enabled: true } }), FEATURE_PACKAGE_PRESETS.starter.featureKeys.length);
    assert.equal((await client.companyEntitlementNormalization.findUniqueOrThrow({ where: { companyId } })).cohortKind, 'EXPLICIT');
    assert.equal((await client.companyEntitlementSet.findUniqueOrThrow({ where: { companyId } })).setVersion, 1);
    assert.equal(await client.runoffSnapshot.count({ where: { companyId } }), disabled.length);
    assert.equal(await client.entitlementTransition.count({ where: { companyId } }), ALL_FEATURE_ENTITLEMENT_KEYS.length);
    assert.equal((await humanDecidedKeys(client, companyId)).size, 0);
    assert.equal(await client.entitlementCommand.count({ where: { companyId } }), 1);
    await assert.rejects(apply('invoice-stale'), /สิทธิ์เมนูเดิมยังไม่พร้อม/);
    await client.$transaction(async tx => {
      await tx.$executeRaw(exclusiveEntitlementLock(companyId));
      await tx.companyFeatureEntitlement.update({ where: { companyId_featureKey: { companyId, featureKey: 'reports' } },
        data: { enabled: true, epoch: 1, lastSeq: 2, updatedBySystemAdminUserId: ownerUserId } });
      await tx.entitlementTransition.create({ data: { companyId, featureKey: 'reports', seq: 2, epoch: 1,
        commandId: 'admin-special-reports', action: 'ENABLE', actorUserId: ownerUserId, reasonJson: { requestId: 'admin-special' } } });
      await tx.companyEntitlementSet.update({ where: { companyId }, data: { setVersion: 2 } });
    });
    const cutoff = (await client.companyFeatureEntitlement.findUniqueOrThrow({ where: {
      companyId_featureKey: { companyId, featureKey: 'expense_auto_post' } } })).updatedAt;
    const { plan: nextPlan, impact: nextImpact } = await billingFeaturePlan(client, companyId);
    assert.deepEqual([...await humanDecidedKeys(client, companyId)], ['reports']);
    assert.equal(nextImpact.preservedAdmin, 1);
    assert.deepEqual(await apply('invoice-second', false, nextPlan), []);
    assert.equal((await client.companyFeatureEntitlement.findUniqueOrThrow({ where: {
      companyId_featureKey: { companyId, featureKey: 'reports' } } })).enabled, true);
    assert.equal((await client.companyFeatureEntitlement.findUniqueOrThrow({ where: {
      companyId_featureKey: { companyId, featureKey: 'expense_auto_post' } } })).updatedAt.getTime(), cutoff.getTime());
    assert.equal(await client.entitlementCommand.count({ where: { companyId } }), 2);
  } finally {
    await client.auditLog.deleteMany({ where: { companyId } });
    await client.company.deleteMany({ where: { id: companyId } });
    if (ownerUserId) await client.user.deleteMany({ where: { id: ownerUserId } });
    await client.$disconnect();
  }
});

test('a paid catalog conversion closes only an earlier unpaid LINE package request', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const companyId = `billing-request-${randomUUID()}`;
  let accountId = '';
  try {
    await client.company.create({ data: { id: companyId, name: 'Synthetic request company' } });
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${randomUUID()}`, livemode: false } });
    accountId = account.id;
    const now = new Date();
    const invoice = await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${randomUUID()}`,
      offerSnapshot: { offerKey: 'STARTER_249' }, policyRevisionId: 'synthetic', currency: 'THB', totalSatang: 24900,
      paidSatang: 24900, periodStart: now, periodEnd: new Date(now.getTime() + 86400000), providerStatus: 'paid',
      evidenceHash: 'synthetic', applyStatus: 'APPLIED', appliedAt: now } });
    const older = new Date(now.getTime() - 60000);
    const unpaid = await client.packageChangeRequest.create({ data: { companyId, requestedByUserId: 'synthetic-owner',
      requestedTierKey: 'PRO_999', createdAt: older } });
    const supersede = () => client.$transaction(async tx => {
      await lockPlanTermCompany(tx, companyId);
      await supersedeUnpaidPackageRequest(tx, companyId, invoice.id);
    });
    await supersede();
    assert.deepEqual(await client.packageChangeRequest.findUnique({ where: { id: unpaid.id }, select: { status: true, paymentState: true } }),
      { status: 'CANCELLED', paymentState: 'CATALOG_SUPERSEDED' });
    await supersede();
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'billing.package_request.superseded' } }), 1);
    const withProof = await client.packageChangeRequest.create({ data: { companyId, requestedByUserId: 'synthetic-owner',
      requestedTierKey: 'PRO_999', slipAttachmentId: 'existing-proof', createdAt: older } });
    await supersede();
    assert.equal((await client.packageChangeRequest.findUniqueOrThrow({ where: { id: withProof.id } })).status, 'OPEN');
  } finally {
    await client.auditLog.deleteMany({ where: { companyId } });
    if (accountId) await client.billingInvoice.deleteMany({ where: { billingAccountId: accountId } });
    await client.billingAccount.deleteMany({ where: { companyId } });
    await client.company.deleteMany({ where: { id: companyId } });
    await client.$disconnect();
  }
});
