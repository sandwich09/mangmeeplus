import { detectBillingIssue } from './billing-issues';
import { recordAttributionDeductions } from './billing-package-request';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { BillingAccount, BillingInvoice, Prisma } from '../../../generated/prisma/client';
import { creditLeftSatang, type CreditTakeBack } from '../../sales-console/domain/sales-attribution.logic';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';

export function assertMappedCharge(charge: StripeObject, account: Pick<BillingAccount, 'customerId' | 'livemode'>,
  invoice: { providerChargeId: string | null; paidSatang: number }) {
  if (charge.id !== invoice.providerChargeId || charge.livemode !== account.livemode || stripeId(charge.customer) !== account.customerId ||
    charge.currency !== 'thb' || charge.status !== 'succeeded' || charge.paid !== true || charge.captured !== true ||
    charge.amount !== invoice.paidSatang || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 ||
    charge.amount_refunded > invoice.paidSatang || typeof charge.disputed !== 'boolean') throw new Error('billing.financial_charge_mismatch');
}

/** Caller holds the account lease and company lock; paid evidence never clears a review case. */
export async function recordBillingFinancials(tx:Prisma.TransactionClient,account:BillingAccount,current:BillingInvoice,
  observed:{refundedSatang:number;disputed:boolean},takeBacks:readonly CreditTakeBack[]=[]) {
  const changed=current.refundedSatang!==observed.refundedSatang||current.disputed!==observed.disputed;
  await tx.billingInvoice.update({where:{id:current.id},data:{...observed,financialObservedAt:new Date(),...(changed?{version:{increment:1}}:{})}});
  // §17.1 (owner 2026-10-02): what went back to the customer takes sales credit back, as dated
  // rows. Recorded here because this is the one place a refund is ever observed, so no sales-side
  // sweep can drift from it. Not tied to `changed`: a dispute is lost, and a pending refund
  // succeeds, without either of these two totals moving.
  await recordAttributionDeductions(tx,{companyId:account.companyId,invoiceId:current.id,takeBacks});
  if(changed)await tx.auditLog.create({data:{companyId:account.companyId,action:'billing.financial.observed',targetType:'BillingInvoice',targetId:current.id,
    requestId:current.id,result:'SUCCESS',riskLevel:'CRITICAL',metadataJson:{previous:{refundedSatang:current.refundedSatang,disputed:current.disputed},observed,entitlementChanged:false}}});
  if(observed.refundedSatang>0||observed.disputed)await detectBillingIssue(tx,{stripeAccountId:account.stripeAccountId,livemode:account.livemode,
    companyId:account.companyId,kind:'FINANCIAL_REVIEW',referenceId:current.id},changed);
}

/**
 * The refunds that succeeded and the disputes that were lost on a payment that carries sales
 * credit, with the provider's own ids, amounts and times (spec §17.1, owner 2026-10-02). The
 * charge only says how much is refunded and whether it is disputed — not when, and not who won —
 * and no dispute outcome is stored anywhere else. Every other payment returns [] without a
 * provider call: one payment per shop carries credit. An entry that is not exactly a settled
 * refund or dispute of this charge is not a fact and is left out, never guessed.
 * ponytail: re-read on every visit while credit is left (one or two GETs for a shop whose first
 * payment was refunded or disputed); store the outcome if that ever shows in reconcile time.
 */
async function creditTakeBacks(prisma: PrismaService, stripe: StripeClient, account: BillingAccount, invoice: BillingInvoice,
  charge: StripeObject): Promise<CreditTakeBack[]> {
  const disputed = charge.disputed || invoice.disputed;
  if (!charge.amount_refunded && !disputed) return [];
  const credit = await prisma.client.salesAttribution.findUnique({ where: { companyId: account.companyId },
    select: { sourceInvoiceId: true, amountSatang: true, refundedSatang: true, deductions: { select: { amountSatang: true } } } });
  if (!credit || credit.sourceInvoiceId !== invoice.id || creditLeftSatang(credit, credit.deductions) === 0) return [];
  // The id is only the key that makes a second sighting write nothing, so any id the provider
  // gives is taken; the amount needs no upper bound because the credit that is left caps it.
  const read = async (path: string, object: string, settled: string, kind: CreditTakeBack['kind']) =>
    (await stripe.list(path, { charge: charge.id })).filter(item => item && item.object === object && item.status === settled &&
      typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 255 && stripeId(item.charge) === charge.id &&
      item.currency === 'thb' && Number.isSafeInteger(item.amount) && item.amount > 0 &&
      Number.isSafeInteger(item.created) && item.created > 0)
      .map((item): CreditTakeBack => ({ kind, providerRef: item.id, amountSatang: item.amount, occurredAt: new Date(item.created * 1000) }));
  return [...(charge.amount_refunded ? await read('/refunds', 'refund', 'succeeded', 'REFUND') : []),
    ...(disputed ? await read('/disputes', 'dispute', 'lost', 'DISPUTE') : [])];
}

/** Revisit the 20 oldest observations per sweep, so long histories progress across bounded leases. */
export async function observeBillingCharges(prisma: PrismaService, stripe: StripeClient, account: BillingAccount, leaseToken: string, chargeId?: string) {
    const rows = await prisma.client.billingInvoice.findMany({ where: { billingAccountId: account.id,
      providerChargeId: chargeId ?? { not: null } }, orderBy: [{ financialObservedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: 20 });
    for (const row of rows) {
      const charge = await stripe.request('GET', `/charges/${row.providerChargeId}`);
      assertMappedCharge(charge, account, row);
      const takeBacks = await creditTakeBacks(prisma, stripe, account, row, charge);
      await prisma.client.$transaction(async tx => {
        await lockPlanTermCompany(tx, account.companyId);
        await tx.$queryRaw`SELECT "id" FROM "BillingAccount" WHERE "id" = ${account.id} FOR UPDATE`;
        const currentAccount = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
        if (currentAccount.leaseToken !== leaseToken || !currentAccount.leaseUntil || currentAccount.leaseUntil <= new Date() ||
          currentAccount.customerId !== account.customerId || currentAccount.stripeAccountId !== stripe.accountId || currentAccount.livemode !== stripe.livemode) throw new Error('billing.financial_lost_lease');
        const current = await tx.billingInvoice.findUniqueOrThrow({ where: { id: row.id } });
        if (current.billingAccountId !== account.id || current.providerChargeId !== row.providerChargeId || current.paidSatang !== row.paidSatang) throw new Error('billing.financial_invoice_changed');
        await recordBillingFinancials(tx,account,current,{refundedSatang:charge.amount_refunded,disputed:charge.disputed},takeBacks);
      });
    }
}
