import type { BillingAccount, BillingOperation, Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { billingError, hashBilling } from '../domain/billing-policy';
import { stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import type { BillingService } from './billing.service';

export const DEAL_SUBSCRIPTION_CANCEL_TYPE = 'DEAL_SUBSCRIPTION_CANCEL';
export type DealSubscriptionCancelSource = { accountId: string; subscriptionId: string; dealRequestId: string; attemptId: string };
type Journal = { startedAt?: string; observed?: boolean };

const json = (value: unknown) => value as Prisma.InputJsonValue;
const review = () => billingError('DEAL_SUBSCRIPTION_CANCEL_PENDING', 'ชำระดีลแล้ว ระบบกำลังยกเลิกการต่ออายุเดิม');

export function canConvertDealSubscription(account: Pick<BillingAccount, 'baseSubscriptionId' | 'renewalMode' | 'subscriptionState' | 'paidThrough' | 'cancelAtPeriodEnd' | 'graceEndsAt'> | null | undefined, now = new Date()): boolean {
  return !!account?.baseSubscriptionId && account.renewalMode === 'CARD_AUTO' && account.subscriptionState === 'active' &&
    !!account.paidThrough && account.paidThrough > now && !account.cancelAtPeriodEnd && !account.graceEndsAt;
}

export function dealSubscriptionCancelled(source: DealSubscriptionCancelSource, account: BillingAccount, subscription: StripeObject): boolean {
  return subscription.id === source.subscriptionId && subscription.object === 'subscription' && subscription.livemode === account.livemode &&
    stripeId(subscription.customer) === account.customerId && subscription.metadata?.billingAccountId === account.id && subscription.status === 'canceled';
}

export async function queueDealSubscriptionCancel(tx: Prisma.TransactionClient, input: {
  account: BillingAccount; source: DealSubscriptionCancelSource; sourceVersion: number; initiatorUserId: string;
}): Promise<string> {
  const source = input.source;
  const row = await tx.billingOperation.create({ data: {
    companyId: input.account.companyId, stripeAccountId: input.account.stripeAccountId, livemode: input.account.livemode,
    type: DEAL_SUBSCRIPTION_CANCEL_TYPE, state: 'QUEUED', referenceId: source.subscriptionId, proposedJson: json(source),
    sourceVersion: input.sourceVersion, reason: 'paid_sales_deal_conversion', initiatorUserId: input.initiatorUserId,
    idempotencyKey: `deal-subscription-cancel:${source.attemptId}`,
    requestHash: hashBilling([source, input.sourceVersion]), expiresAt: new Date(Date.now() + 30 * 86_400_000),
  } });
  return row.id;
}

/** Cancels the old CARD_AUTO subscription only after the one-time deal payment has applied. */
export class BillingDealSubscriptionCancel {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeClient,
    private readonly billing: Pick<BillingService, 'issue'>) {}

  private async fence(tx: Prisma.TransactionClient, account: BillingAccount, operationId: string, lease: string) {
    await lockPlanTermCompany(tx, account.companyId);
    const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.activeCollectionOperationId !== operationId || current.leaseToken !== lease || !current.leaseUntil || current.leaseUntil <= new Date()) throw review();
  }

  async advance(account: BillingAccount, lease: string): Promise<void> {
    const row: BillingOperation = await this.prisma.client.billingOperation.findFirstOrThrow({ where: {
      id: account.activeCollectionOperationId!, companyId: account.companyId, stripeAccountId: account.stripeAccountId,
      livemode: account.livemode, type: DEAL_SUBSCRIPTION_CANCEL_TYPE,
    } });
    const source = row.proposedJson as unknown as DealSubscriptionCancelSource;
    const journal = (row.resultJson as Journal | null) ?? {};
    if (source.accountId !== account.id || !source.subscriptionId || !source.dealRequestId || !source.attemptId) throw review();
    try {
      let subscription = await this.stripe.request('GET', `/subscriptions/${source.subscriptionId}`);
      if (!dealSubscriptionCancelled(source, account, subscription)) {
        if (subscription.id !== source.subscriptionId || subscription.object !== 'subscription' || subscription.livemode !== account.livemode ||
            stripeId(subscription.customer) !== account.customerId || subscription.metadata?.billingAccountId !== account.id) throw review();
        const startedAt = journal.startedAt ?? new Date().toISOString();
        await this.prisma.client.$transaction(async tx => {
          await this.fence(tx, account, row.id, lease);
          await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'RUNNING', errorCode: null,
            resultJson: json({ ...journal, startedAt }), version: { increment: 1 } } });
        });
        journal.startedAt = startedAt;
        subscription = await this.stripe.request('DELETE', `/subscriptions/${source.subscriptionId}`, { prorate: false, invoice_now: false }, `mm:deal-subscription-cancel:${row.id}`);
        if (!dealSubscriptionCancelled(source, account, subscription)) throw review();
      }
      const observedAt = new Date();
      await this.prisma.client.$transaction(async tx => {
        await this.fence(tx, account, row.id, lease);
        await tx.billingAccount.update({ where: { id: account.id }, data: { activeCollectionOperationId: null, observedAt, version: { increment: 1 } } });
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'SUCCEEDED', errorCode: null, observedAt,
          resultJson: json({ ...journal, observed: true }), version: { increment: 1 } } });
        await tx.billingIssue.updateMany({ where: { companyId: account.companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
          kind: 'DEAL_SUBSCRIPTION_CANCEL_PENDING', referenceId: row.id, state: { not: 'RESOLVED' } },
        data: { state: 'RESOLVED', resolvedAt: observedAt, version: { increment: 1 } } });
        await tx.auditLog.create({ data: { companyId: account.companyId, actorType: 'SYSTEM', actorRefId: 'sales-deal',
          action: 'billing.deal_subscription_cancelled', targetType: 'BillingOperation', targetId: row.id, requestId: row.id,
          result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { dealRequestId: source.dealRequestId, subscriptionId: source.subscriptionId } } });
      });
    } catch {
      await this.prisma.client.$transaction(async tx => {
        const current = await tx.billingAccount.findUnique({ where: { id: account.id } });
        if (current?.activeCollectionOperationId !== row.id || current.leaseToken !== lease || !current.leaseUntil || current.leaseUntil <= new Date()) return;
        await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'QUEUED', errorCode: 'DEAL_SUBSCRIPTION_CANCEL_PENDING',
          resultJson: json(journal), version: { increment: 1 } } });
      });
      await this.billing.issue(account.companyId, 'DEAL_SUBSCRIPTION_CANCEL_PENDING', row.id);
    }
  }
}
