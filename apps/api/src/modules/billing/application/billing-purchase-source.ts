import type { BillingPurchaseSource } from '@watchdog-bms/contracts';
import type { BillingAccount, CompanyPlanTerm } from '../../../generated/prisma/client';
import { termProjectionHash } from '../domain/paid-invoice';

type SourceAccount = Pick<BillingAccount, 'id' | 'baseSubscriptionId' | 'paidThrough' | 'termProjectionHash'>;

/** An account row or customer ID is not payment evidence. A mapped, verified paid term is. */
export function billingPurchaseSource(term: CompanyPlanTerm | null, account: SourceAccount | null, hasPaidInvoice: boolean, now = new Date()): BillingPurchaseSource {
  if (term?.billingReceiptAccountId && term.billingReceiptAccountId !== account?.id) return 'PAID_OTHER_MODE';
  const paidShape = !!(term?.billingReceiptAccountId || account?.baseSubscriptionId || account?.paidThrough || hasPaidInvoice);
  if (paidShape) {
    if (!term || !account || term.billingReceiptAccountId !== account.id || !account.baseSubscriptionId || !account.paidThrough ||
      !account.termProjectionHash || termProjectionHash(term) !== account.termProjectionHash)
      return 'SOURCE_INCONSISTENT';
    return account.paidThrough > now ? 'PAID_CURRENT_MODE' : 'PAID_EXPIRED_CURRENT_MODE';
  }
  if (!term) return 'NO_TERM';
  return term.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : 'ADMIN_MANUAL';
}

export const initialPurchaseSource = (source: BillingPurchaseSource) =>
  source === 'NO_TERM' || source === 'TRIAL' || source === 'ADMIN_MANUAL';
