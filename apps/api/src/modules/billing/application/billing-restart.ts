import type { BillingOffer } from '@watchdog-bms/contracts';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import { billingError } from '../domain/billing-policy';
import { stripeId, type StripeClient } from '../infrastructure/stripe.client';
import { planCapacityUsed } from '../../system-partner-management/application/plan-term-limit';

export type RestartSource = { subscriptionId: string; contractAttemptId: string | null; paidThrough: string; termHash: string | null };
const review = () => billingError('BILLING_RESTART_REVIEW', 'ต้องตรวจสมาชิกหรือยอดค้างเดิมก่อนเริ่มแพ็กเกจใหม่ กรุณาติดต่อทีมงานพร้อมเลขบริษัท');

/** Cheap local preflight; provider debt/dispute/history checks still run before a new payment. */
export async function restartReviewPending(tx: Prisma.TransactionClient, account: BillingAccount, newSubscriptionId?: string): Promise<boolean> {
  return !!(await tx.billingIssue.count({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId,
    livemode: account.livemode, kind: 'FINANCIAL_REVIEW', state: { not: 'RESOLVED' } } }) ||
    await tx.billingInvoice.count({ where: { billingAccountId: account.id,
      ...(newSubscriptionId ? { AND: [{ OR: [{ subscriptionId: null }, { subscriptionId: { not: newSubscriptionId } }] }] } : {}),
      OR: [{ applyStatus: { not: 'APPLIED' } }, { refundedSatang: { not: 0 } }, { disputed: true }] } }));
}

/** A new paid contract may replace a terminal one; its old ledger is never removed. */
export async function restartSource(prisma: PrismaService, stripe: StripeClient, account: BillingAccount, expected?: RestartSource,
  newSubscriptionId?: string): Promise<RestartSource> {
  if (!account.customerId || !account.baseSubscriptionId || !account.paidThrough || account.paidThrough > new Date() ||
    (account.graceEndsAt && account.graceEndsAt > new Date())) throw review();
  if (await restartReviewPending(prisma.client, account, newSubscriptionId)) throw review();
  const source = { subscriptionId: account.baseSubscriptionId, contractAttemptId: account.contractAttemptId,
    paidThrough: account.paidThrough.toISOString(), termHash: account.termProjectionHash };
  if (expected && (expected.subscriptionId !== source.subscriptionId || expected.contractAttemptId !== source.contractAttemptId ||
    expected.paidThrough !== source.paidThrough || expected.termHash !== source.termHash)) throw review();
  await stripe.assertAccount();
  const old = await stripe.request('GET', `/subscriptions/${source.subscriptionId}`);
  if (old.object !== 'subscription' || old.id !== source.subscriptionId || old.livemode !== account.livemode ||
    stripeId(old.customer) !== account.customerId || old.metadata?.billingAccountId !== account.id ||
    !['canceled', 'incomplete_expired'].includes(old.status)) throw review();
  const siblings = await stripe.list('/subscriptions', { customer: account.customerId, status: 'all' });
  if (siblings.some(s => !['canceled', 'incomplete_expired'].includes(s.status) && s.id !== newSubscriptionId)) throw review();
  // Include prior one-time full-package payments as well as subscription invoices.
  const invoices = (await stripe.list('/invoices', { customer: account.customerId })).filter(i => !newSubscriptionId ||
    stripeId(i.parent?.subscription_details?.subscription) !== newSubscriptionId);
  if (invoices.some(i => !['paid', 'void'].includes(i.status))) throw review();
  const paid = invoices.filter(i => i.status === 'paid' && i.total > 0);
  const mapped = await prisma.client.billingInvoice.findMany({ where: { billingAccountId: account.id,
    ...(newSubscriptionId ? { OR: [{ subscriptionId: null }, { subscriptionId: { not: newSubscriptionId } }] } : {}) } });
  if (!mapped.length || mapped.some(m => m.applyStatus !== 'APPLIED' || m.refundedSatang !== 0 ||
      !paid.some(i => i.id === m.providerInvoiceId && i.amount_paid === m.paidSatang)) ||
    paid.some(i => i.livemode !== account.livemode || stripeId(i.customer) !== account.customerId ||
      !mapped.some(m => m.providerInvoiceId === i.id && m.paidSatang === i.amount_paid))) throw review();
  for (const invoice of mapped) {
    if (!invoice.providerChargeId) throw review();
    const charge = await stripe.request('GET', `/charges/${invoice.providerChargeId}`);
    if (charge.id !== invoice.providerChargeId || charge.livemode !== account.livemode || stripeId(charge.customer) !== account.customerId ||
      charge.status !== 'succeeded' || charge.paid !== true || charge.captured !== true || charge.currency !== 'thb' || charge.amount !== invoice.paidSatang ||
      charge.disputed !== false || charge.amount_refunded !== 0) throw review();
  }
  return source;
}

export async function restartFits(tx: Prisma.TransactionClient, companyId: string, offer: BillingOffer): Promise<boolean> {
  const branches = await planCapacityUsed.branches(tx, companyId);
  const members = await planCapacityUsed.members(tx, companyId);
  return branches <= offer.branchLimit && members <= offer.employeeLimit;
}
