import type { BillingCapacitySelection } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import { appendPackageInterval } from '../domain/billing-package';
import { billingError, hashBilling } from '../domain/billing-policy';
import { stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import type { BillingSnapshot } from './billing.service';

export type PlanChangeSource = { previousId: string | null; currentSnapshot: BillingSnapshot; selection?: BillingCapacitySelection };
export type ScheduledChange = { accountId: string; subscriptionId: string; paidThrough: string; snapshot: BillingSnapshot; change: PlanChangeSource };
export const scheduleReview = () => billingError('BILLING_COLLECTION_REVIEW', 'ข้อมูลการต่ออายุเปลี่ยน กรุณาตรวจรายการเดิมหรือติดต่อทีมงานพร้อมเลขอ้างอิง');
export const scheduleTaxes = (values: unknown): (string | null)[] => Array.isArray(values) ? values.map(stripeId).sort() : [];
export const sameScheduleTaxes = (actual: unknown, expected: string | null) => hashBilling(scheduleTaxes(actual)) === hashBilling(expected ? [expected] : []);
export const simpleCollection = (value: StripeObject) => !value.automatic_tax?.enabled && !(value.discounts?.length ?? 0) &&
  !(value.default_tax_rates?.length ?? 0) && !(value.add_invoice_items?.length ?? 0) && !value.billing_thresholds &&
  (!value.collection_method || value.collection_method === 'charge_automatically') && !value.transfer_data && !value.application_fee_percent;
export function schedulePhase(start: number, end: number, price: string, tax: string | null, future = false) {
  return { start_date: start, end_date: end, items: [{ price, quantity: 1, tax_rates: tax ? [tax] : '' }],
    default_tax_rates: '', discounts: '', proration_behavior: 'none', ...(future ? { billing_cycle_anchor: 'phase_start' } : {}) };
}
export async function pendingChange(tx: Prisma.TransactionClient, account: BillingAccount): Promise<{ row: BillingOperation; proposed: ScheduledChange } | null> {
  if (!account.pendingPlanChangeId) return null;
  const row = await tx.billingOperation.findUnique({ where: { id: account.pendingPlanChangeId } });
  const proposed = row?.proposedJson as unknown as ScheduledChange | undefined;
  if (!row || row.type !== 'CUSTOMER_SCHEDULE_DOWNGRADE' || row.state !== 'SUCCEEDED' || row.companyId !== account.companyId ||
    row.stripeAccountId !== account.stripeAccountId || row.livemode !== account.livemode || !proposed?.change ||
    proposed.accountId !== account.id || proposed.subscriptionId !== account.baseSubscriptionId || proposed.paidThrough !== account.paidThrough?.toISOString()) throw scheduleReview();
  return { row, proposed };
}
export async function collectionContract(tx: Prisma.TransactionClient, account: BillingAccount) {
  if (!account.paidThrough) throw scheduleReview();
  const contract = await tx.billingSubscriptionContract.findFirst({ where: { billingAccountId: account.id, effectiveAt: { lte: account.paidThrough } },
    orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }] });
  if (!contract) throw scheduleReview();
  const future = contract.snapshotJson as unknown as BillingSnapshot, pending = await pendingChange(tx, account);
  if (pending && (future.priceId !== pending.proposed.snapshot.priceId || hashBilling(future.quote.offer) !== hashBilling(pending.proposed.snapshot.quote.offer))) throw scheduleReview();
  return { future, current: pending?.proposed.change.currentSnapshot ?? future, pending };
}
export async function ownedSchedule(tx: Prisma.TransactionClient, account: BillingAccount, scheduleId: string) {
  const attempts = await tx.billingAttempt.findMany({ where: { billingAccountId: account.id, status: 'COMPLETED' }, select: { collectionJson: true } });
  if (attempts.some(a => (a.collectionJson as { scheduleId?: string } | null)?.scheduleId === scheduleId)) return true;
  const commands = await tx.billingOperation.findMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId,
    livemode: account.livemode, type: { in: ['CUSTOMER_SCHEDULE_DOWNGRADE', 'GRANT_FREE_DAYS'] }, state: { in: ['SUCCEEDED', 'SUPERSEDED', 'APPLIED'] } }, select: { proposedJson: true, resultJson: true } });
  return commands.some(o => (o.proposedJson as unknown as ScheduledChange).accountId === account.id &&
    (o.resultJson as { scheduleId?: string } | null)?.scheduleId === scheduleId);
}
/** Validate only the currently active and future phases; Stripe can also return completed phases. */
export async function currentSchedulePhase(tx: Prisma.TransactionClient, account: BillingAccount, sub: StripeObject, schedule: StripeObject,
  current: BillingSnapshot, future: BillingSnapshot) {
  const target = account.paidThrough!.getTime()/1000, item = sub.items?.data?.[0];
  const phases = schedule.phases?.filter((p: StripeObject) => p.end_date > schedule.current_phase?.start_date);
  const phase = phases?.[0], next = phases?.[1];
  const zeroId = current.repeat?.zeroPriceId ?? current.policy.zeroPriceIds?.[`${current.quote.offer.offerKey as 'PRO_999'}:${current.quote.offer.interval}`];
  const currentId = stripeId(phase?.items?.[0]?.price), zero = currentId === zeroId;
  const tax = zero ? null : current.policy.taxRateId;
  if (!await ownedSchedule(tx, account, schedule.id) || schedule.status !== 'active' || !['release', 'cancel'].includes(schedule.end_behavior) ||
    !simpleCollection(schedule.default_settings ?? {}) || !Array.isArray(phases) || !phase || phase.start_date !== schedule.current_phase?.start_date ||
    !Number.isSafeInteger(phase.start_date) || phase.start_date >= target || phase.end_date !== target ||
    (!zero && currentId !== current.priceId) || stripeId(item?.price) !== currentId || !sameScheduleTaxes(item?.tax_rates, tax) ||
    !Number.isSafeInteger(item?.current_period_start) || item.current_period_start < phase.start_date || item.current_period_start >= target ||
    (!zero && item.current_period_end !== target) || phases.some((p: StripeObject) => !simpleCollection(p) || p.trial_end ||
      p.items?.length !== 1 || p.items[0].quantity !== 1 || (p.items[0].discounts?.length ?? 0)) ||
    !sameScheduleTaxes(phase.items[0].tax_rates, tax) ||
    (schedule.end_behavior === 'cancel' || (!zero && phases.length === 1) ? phases.length !== 1 : phases.length !== 2 || !next || next.start_date !== target ||
      next.end_date !== Math.floor(appendPackageInterval(account.paidThrough!, future.quote.offer.interval).getTime()/1000) ||
      stripeId(next.items[0].price) !== future.priceId || !sameScheduleTaxes(next.items[0].tax_rates, future.policy.taxRateId) || next.billing_cycle_anchor !== 'phase_start')) throw scheduleReview();
  return schedulePhase(phase.start_date, target, currentId!, tax);
}
export async function subscriptionGraph(stripe: StripeClient, account: BillingAccount) {
  await stripe.assertAccount();
  const sub = await stripe.request('GET', `/subscriptions/${account.baseSubscriptionId}`);
  if (sub.id !== account.baseSubscriptionId || stripeId(sub.customer) !== account.customerId || sub.livemode !== account.livemode ||
    sub.metadata?.billingAccountId !== account.id || sub.object !== 'subscription') throw scheduleReview();
  const scheduleId = stripeId(sub.schedule), schedule = scheduleId ? await stripe.request('GET', `/subscription_schedules/${scheduleId}`) : null;
  if (schedule && (schedule.id !== scheduleId || stripeId(schedule.customer) !== account.customerId || stripeId(schedule.subscription) !== sub.id ||
    schedule.object !== 'subscription_schedule' || schedule.livemode !== account.livemode)) throw scheduleReview();
  const siblings = await stripe.list('/subscriptions', { customer: account.customerId, status: 'all' });
  if (siblings.some(s => s.id !== sub.id && !['canceled', 'incomplete_expired'].includes(s.status))) throw scheduleReview();
  return { sub, schedule };
}
