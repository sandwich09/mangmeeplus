import type { BillingStatus } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingAttempt, BillingInvoice, Company, CompanyPlanTerm } from '../../../generated/prisma/client';

/** Shared current-state projection; callers authorize the customer/operator independently. */
export function billingState(company: Pick<Company,'status'> & { planTerm: Pick<CompanyPlanTerm,'termDisabledAt'|'termEndsAt'> | null },
  account: Pick<BillingAccount,'subscriptionState'|'graceEndsAt'> | null, invoice: Pick<BillingInvoice,'sourceAttemptId'|'providerStatus'|'applyStatus'> | null,
  attempt: Pick<BillingAttempt,'id'|'status'> | null, now = new Date()): Pick<BillingStatus,'paymentState'|'applyState'|'accessState'|'documentState'> {
  const held = company.status !== 'ACTIVE' && !(company.status === 'DISABLED' && company.planTerm?.termDisabledAt);
  return {
    paymentState: account?.subscriptionState === 'past_due' || account?.subscriptionState === 'unpaid' ||
      (account?.subscriptionState === 'canceled' && account.graceEndsAt !== null) ? 'FAILED' :
      attempt && invoice?.sourceAttemptId === attempt.id && invoice.providerStatus === 'paid' ? 'PAID' :
      attempt?.status === 'UNKNOWN' ? 'UNKNOWN' : attempt ? 'PENDING' : invoice?.providerStatus === 'paid' ? 'PAID' : 'NONE',
    applyState: (invoice?.applyStatus as BillingStatus['applyState']) ?? 'NONE',
    accessState: held ? 'HELD' : company.planTerm && company.planTerm.termEndsAt <= now ? 'EXPIRED' : 'ACTIVE',
    documentState: invoice ? 'PENDING' : 'NONE',
  };
}
