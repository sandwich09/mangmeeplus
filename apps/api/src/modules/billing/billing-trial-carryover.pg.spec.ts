import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import { trialReceiptCarryover, grantTrialReceiptCarryover } from './application/billing-trial-carryover';
import { grantPaidPackageReceipts, paidReceiptBalance } from './application/billing-receipt-grants';
import { admitCompanyOcr } from '../line-ai/application/company-ocr-governance';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
test('trial conversion and unrestricted paid carryover on PostgreSQL', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/watchdog_postmark_ci');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const companyId = `trial-carry-${randomUUID()}`, now = new Date(), end = new Date(Date.now() + 365 * 86400000);
  const trialEnd = new Date(Date.now() + 7 * 86400000), giftEnd = new Date(Date.now() + 2 * 86400000);
  const read = (requestId: string, sourceRoute: 'receipt-ocr-web' | 'receipt-ocr-line' | 'bank-statement-extract' = 'receipt-ocr-web') =>
    admitCompanyOcr({ client: db } as PrismaService, { companyId, sourceRoute, requestId, enforceReceiptQuota: true });
  try {
    await db.company.create({ data: { id: companyId, name: 'Synthetic trial carryover' } });
    const account = await db.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${randomUUID()}`, livemode: false } });
    await db.companyPlanTerm.create({ data: { companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2,
      monthlySlipLimit: 15, termStartAt: new Date(now.getTime() - 86400000), termEndsAt: trialEnd } });
    const paid = { companyId, billingAccountId: account.id, sourceKey: 'initial', policyRevisionId: 'TEST_ONLY',
      kind: 'INITIAL' as const, units: 600, serviceStart: now, serviceEnd: end, availableAt: now, expiresAt: end };
    await t.test('actual trial only, no expired/manual eligibility; standard trial cap excludes gifts', async () => {
      assert.equal((await trialReceiptCarryover(db, companyId))?.units, 15);
      await db.companyPlanTerm.update({ where: { companyId }, data: { monthlySlipLimit: 100 } });
      assert.equal((await trialReceiptCarryover(db, companyId))?.units, 15);
      await db.companyPlanTerm.update({ where: { companyId }, data: { monthlySlipLimit: 15, tierKey: 'BASIC_499' } });
      assert.equal(await trialReceiptCarryover(db, companyId), undefined);
      await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'FREE_TRIAL_15', termEndsAt: now } });
      assert.equal(await trialReceiptCarryover(db, companyId), undefined);
      await db.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: trialEnd } });
      await db.billingReceiptGrant.create({ data: { ...paid, billingAccountId: null, kind: 'ADMIN_ADJUSTMENT', units: 100,
        sourceKey: 'gift', sourceHash: 'test', serviceEnd: giftEnd, expiresAt: giftEnd } });
      for (let i = 0; i < 6; i++) assert.equal((await read(`trial-${i}`, i % 2 ? 'receipt-ocr-line' : 'receipt-ocr-web')).allowed, true);
      assert.equal((await read('bank', 'bank-statement-extract')).allowed, true);
      assert.equal((await trialReceiptCarryover(db, companyId))?.units, 9);
      await db.companyPlanTerm.update({ where: { companyId }, data: { monthlySlipLimit: 100 } });
      assert.equal((await trialReceiptCarryover(db, companyId))?.units, 9, 'custom trial allowance cannot refill the standard unused 15');
      await db.companyPlanTerm.update({ where: { companyId }, data: { monthlySlipLimit: 15 } });
    });
    const source = (await trialReceiptCarryover(db, companyId))!;
    await t.test('no grant for missing or expired payment proof and exhausted trial', async () => {
      const input = { companyId, billingAccountId: account.id, invoiceId: 'initial', policyRevisionId: 'TEST_ONLY', source, periodEnd: end };
      assert.equal(await grantTrialReceiptCarryover(db, input), 0);
      assert.equal(await grantTrialReceiptCarryover(db, { ...input, paidAt: trialEnd }), 0);
      await db.companyPlanTerm.update({ where: { companyId }, data: { monthlySlipLimit: 6 } });
      assert.equal(await trialReceiptCarryover(db, companyId), undefined);
      await db.companyPlanTerm.update({ where: { companyId }, data: { monthlySlipLimit: 15 } });
      assert.equal(await db.billingReceiptGrant.count({ where: { companyId, kind: 'TRIAL_CARRYOVER' } }), 0);
    });
    await t.test('checkout consumption is reread; concurrent/replayed initial application grants once', async () => {
      assert.equal((await read('during-checkout')).allowed, true);
      const paidAt = new Date();
      const apply = () => db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${companyId}`}))`;
        const units = await grantTrialReceiptCarryover(tx, { companyId, billingAccountId: account.id, invoiceId: 'initial',
          policyRevisionId: 'TEST_ONLY', source, paidAt, periodEnd: end });
        await grantPaidPackageReceipts(tx, paid);
        await tx.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'BASIC_499', termEndsAt: end } });
        return units;
      });
      assert.deepEqual((await Promise.all([apply(), apply()])).sort(), [0, 8]);
      assert.equal(await apply(), 0);
      assert.equal((await paidReceiptBalance(db, companyId, account.id)).remaining, 708);
      const trial = await db.billingReceiptGrant.findFirstOrThrow({ where: { companyId, kind: 'TRIAL_CARRYOVER' } });
      const { id, createdAt, ...data } = trial;
      await assert.rejects(db.billingReceiptGrant.create({ data: { ...data, sourceKey: 'second' } }));
      await assert.rejects(db.billingReceiptGrant.update({ where: { id }, data: { units: 16 } }));
      // Add-on spec §6 / D8 (plan PR B): package units, the trial carryover among them, go before an Admin
      // gift even when the gift expires first — the order replaced FEFO across every lot on purpose.
      assert.equal((await read('paid-uses-package-before-gift')).allowed, true);
      const event = await db.companyOcrUsageEvent.findFirstOrThrow({ where: { companyId, requestId: 'paid-uses-package-before-gift' } });
      assert.equal((await db.billingReceiptGrant.findUniqueOrThrow({ where: { id: event.billingReceiptGrantId! } })).kind, 'TRIAL_CARRYOVER');
    });
    await t.test('upgrade/repeat preserve hundreds of paid receipts, with fixed trial/admin expiry', async () => {
      await db.$transaction(tx => grantPaidPackageReceipts(tx, { ...paid, sourceKey: 'upgrade', kind: 'UPGRADE', units: 600 }));
      assert.equal((await paidReceiptBalance(db, companyId, account.id)).remaining, 1307);
      const extended = new Date(end.getTime() + 365 * 86400000);
      await db.$transaction(tx => grantPaidPackageReceipts(tx, { ...paid, sourceKey: 'repeat', kind: 'REPEAT', units: 1200,
        serviceStart: end, serviceEnd: extended, expiresAt: extended }));
      assert.equal((await paidReceiptBalance(db, companyId, account.id)).remaining, 2507);
      const trial = await db.billingReceiptGrant.findFirstOrThrow({ where: { companyId, kind: 'TRIAL_CARRYOVER' } });
      assert.equal(trial.expiresAt.toISOString(), end.toISOString());
      assert.equal((await paidReceiptBalance(db, companyId, account.id, new Date(end.getTime() + 1))).remaining, 2400);
      assert.equal(await trialReceiptCarryover(db, companyId), undefined);
      await db.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'FREE_TRIAL_15', billingReceiptAccountId: null, termEndsAt: trialEnd } });
      assert.equal(await trialReceiptCarryover(db, companyId), undefined, 'resetting a term cannot earn a second trial carryover');
    });
  } finally {
    await db.companyOcrUsageEvent.deleteMany({ where: { companyId } });
    await db.companyPlanTerm.deleteMany({ where: { companyId } });
    await db.billingReceiptGrant.deleteMany({ where: { companyId } });
    await db.billingAccount.deleteMany({ where: { companyId } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.$disconnect();
  }
});
