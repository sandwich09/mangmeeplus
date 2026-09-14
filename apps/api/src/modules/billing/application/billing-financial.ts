import { detectBillingIssue } from './billing-issues';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { BillingAccount } from '../../../generated/prisma/client';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';

export function assertMappedCharge(charge: StripeObject, account: Pick<BillingAccount, 'customerId' | 'livemode'>,
  invoice: { providerChargeId: string | null; paidSatang: number }) {
  if (charge.id !== invoice.providerChargeId || charge.livemode !== account.livemode || stripeId(charge.customer) !== account.customerId ||
    charge.currency !== 'thb' || charge.status !== 'succeeded' || charge.paid !== true || charge.captured !== true ||
    charge.amount !== invoice.paidSatang || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 ||
    charge.amount_refunded > invoice.paidSatang || typeof charge.disputed !== 'boolean') throw new Error('billing.financial_charge_mismatch');
}

/** Revisit the 20 oldest observations per sweep, so long histories progress across bounded leases. */
export async function observeBillingCharges(prisma: PrismaService, stripe: StripeClient, account: BillingAccount, leaseToken: string, chargeId?: string) {
    const rows = await prisma.client.billingInvoice.findMany({ where: { billingAccountId: account.id,
      providerChargeId: chargeId ?? { not: null } }, orderBy: [{ financialObservedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: 20 });
    for (const row of rows) {
      const charge = await stripe.request('GET', `/charges/${row.providerChargeId}`);
      assertMappedCharge(charge, account, row);
      await prisma.client.$transaction(async tx => {
        await lockPlanTermCompany(tx, account.companyId);
        await tx.$queryRaw`SELECT "id" FROM "BillingAccount" WHERE "id" = ${account.id} FOR UPDATE`;
        const currentAccount = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        if (currentAccount.leaseToken !== leaseToken || !currentAccount.leaseUntil || currentAccount.leaseUntil <= new Date() ||
          currentAccount.customerId !== account.customerId || currentAccount.stripeAccountId !== stripe.accountId || currentAccount.livemode !== stripe.livemode) throw new Error('billing.financial_lost_lease');
        const current = await tx.billingInvoice.findUniqueOrThrow({ where: { id: row.id } });
        if (current.billingAccountId !== account.id || current.providerChargeId !== row.providerChargeId || current.paidSatang !== row.paidSatang) throw new Error('billing.financial_invoice_changed');
        const changed = current.refundedSatang !== charge.amount_refunded || current.disputed !== charge.disputed;
        await tx.billingInvoice.update({ where: { id: row.id }, data: { refundedSatang: charge.amount_refunded,
          disputed: charge.disputed, financialObservedAt: new Date(), ...(changed ? { version: { increment: 1 } } : {}) } });
        if (changed) await tx.auditLog.create({ data: { companyId: account.companyId, action: 'billing.financial.observed', targetType: 'BillingInvoice', targetId: row.id,
          requestId: row.id, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { previous: { refundedSatang: current.refundedSatang, disputed: current.disputed },
            observed: { refundedSatang: charge.amount_refunded, disputed: charge.disputed }, entitlementChanged: false } } });
        if (charge.amount_refunded > 0 || charge.disputed) {
          const identity = { stripeAccountId: account.stripeAccountId, livemode: account.livemode, kind: 'FINANCIAL_REVIEW', referenceId: row.id };
          await detectBillingIssue(tx,{...identity,companyId:account.companyId},changed);
        }
      });
    }
}
