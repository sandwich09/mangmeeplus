import type { BillingPurchaseSource } from '@watchdog-bms/contracts';
import type { BillingAccount, CompanyPlanTerm } from '../../../generated/prisma/client';
import { termProjectionHash } from '../domain/paid-invoice';

type SourceAccount = Pick<BillingAccount, 'id' | 'baseSubscriptionId' | 'activeAttemptId' | 'contractAttemptId' | 'renewalMode' | 'paidThrough' | 'termProjectionHash'>;

/** An account row or customer ID is not payment evidence. A mapped, verified paid term is. */
export function billingPurchaseSource(term: CompanyPlanTerm | null, account: SourceAccount | null, hasPaidInvoice: boolean, now = new Date()): BillingPurchaseSource {
  if (term?.billingReceiptAccountId && term.billingReceiptAccountId !== account?.id) return 'PAID_OTHER_MODE';
  const paidShape = !!(term?.billingReceiptAccountId || account?.baseSubscriptionId || account?.contractAttemptId ||
    account?.paidThrough || (account && account.renewalMode !== 'NONE') || hasPaidInvoice);
  if (paidShape) {
    const oneTime = account?.renewalMode === 'CARD_ONCE' || account?.renewalMode === 'PROMPTPAY_ONCE';
    const promptPayBinding = account?.renewalMode === 'PROMPTPAY_RENEW' && !account.baseSubscriptionId &&
      account.activeAttemptId === account.contractAttemptId;
    const paidContract = oneTime ? !account?.baseSubscriptionId && !!account?.contractAttemptId && hasPaidInvoice
      : promptPayBinding ? !!account?.contractAttemptId && hasPaidInvoice
      : !!account?.baseSubscriptionId && (account.renewalMode === 'NONE' || account.renewalMode === 'CARD_AUTO' || account.renewalMode === 'PROMPTPAY_RENEW');
    if (!term || !account || term.billingReceiptAccountId !== account.id || !paidContract || !account.paidThrough ||
      !account.termProjectionHash || termProjectionHash(term) !== account.termProjectionHash)
      return 'SOURCE_INCONSISTENT';
    return account.paidThrough > now ? 'PAID_CURRENT_MODE' : 'PAID_EXPIRED_CURRENT_MODE';
  }
  if (!term) return 'NO_TERM';
  return term.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : 'ADMIN_MANUAL';
}

export const initialPurchaseSource = (source: BillingPurchaseSource) =>
  source === 'NO_TERM' || source === 'TRIAL' || source === 'ADMIN_MANUAL';

/**
 * Phase 7 follow-up (มติ Owner 2026-09-21) — a purchase that decides the shop's menu set from
 * scratch: a first purchase, or a RESTART after the paid term ended. Both hand the buyer the
 * package they just paid for, so both pin `billingFeaturePlan` into the quote and both are
 * re-checked at Checkout. The difference from `initialPurchaseSource` is only the expired shop:
 * it already has a paid history, but nothing about the package it used to own may survive a
 * purchase of a different one.
 */
export const packageMenuPurchaseSource = (source: BillingPurchaseSource) =>
  initialPurchaseSource(source) || source === 'PAID_EXPIRED_CURRENT_MODE';
