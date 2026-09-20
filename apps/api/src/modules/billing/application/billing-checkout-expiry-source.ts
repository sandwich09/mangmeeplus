import type {BillingAccount,BillingAttempt} from '../../../generated/prisma/client';
import {billingError,configurationHash} from '../domain/billing-policy';
import {stripeId,type StripeClient,type StripeObject} from '../infrastructure/stripe.client';
import type {BillingSnapshot} from './billing.service';
const invalid=()=>billingError('CONTROL_CHECKOUT_SOURCE_CHANGED','ข้อมูลหน้าชำระเดิมเปลี่ยนหรือยังไม่ครบ กรุณาตรวจรายการเดิมอีกครั้ง');
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const instant=(v:unknown):v is number=>integer(v)&&Number.isFinite(new Date(v*1000).getTime());

export function checkoutExpiryBinding(account:BillingAccount,attempt:BillingAttempt){
  return configurationHash([account.id,account.companyId,account.stripeAccountId,account.livemode,account.customerId,account.activeAttemptId,
    attempt.id,attempt.billingAccountId,attempt.checkoutSessionId,attempt.quoteId,attempt.quoteSnapshot,attempt.policyRevisionId,attempt.consentRevision,attempt.consentAt]);
}
/** Original identity and accepted quote, never today's price or a caller-supplied provider ID. */
export function checkoutExpirySession(account:BillingAccount,attempt:BillingAttempt,session:StripeObject){
  const snapshot=attempt.quoteSnapshot as unknown as BillingSnapshot,quote=snapshot?.quote;
  if(!attempt.checkoutSessionId||!/^cs_[A-Za-z0-9_]{1,220}$/.test(attempt.checkoutSessionId)||!account.customerId||attempt.billingAccountId!==account.id||
    !quote||quote.quoteId!==attempt.quoteId||quote.companyId!==account.companyId||quote.policyRevision!==attempt.policyRevisionId||
    quote.consentRevision!==attempt.consentRevision||!integer(quote.totalSatang)||quote.totalSatang<1||
    !session||session.object!=='checkout.session'||session.id!==attempt.checkoutSessionId||session.livemode!==account.livemode||
    session.mode!==(snapshot.repeat||['CARD_ONCE','PROMPTPAY_ONCE','PROMPTPAY_RENEW'].includes(quote.purchaseMode??'')?'payment':'subscription')||stripeId(session.customer)!==account.customerId||session.client_reference_id!==attempt.id||
    session.metadata?.billingAccountId!==account.id||session.metadata?.billingAttemptId!==attempt.id||session.currency!=='thb'||session.amount_total!==quote.totalSatang||
    !['open','expired','complete'].includes(session.status)||!['paid','unpaid','no_payment_required'].includes(session.payment_status)||
    !instant(session.created)||!instant(session.expires_at)||session.created>=session.expires_at||session.recovered_from!=null||session.after_expiration?.recovery?.enabled===true)throw invalid();
  return {sessionId:attempt.checkoutSessionId,sourceHash:checkoutExpiryBinding(account,attempt),
    providerState:session.status as 'open'|'expired'|'complete',paymentState:session.payment_status as 'paid'|'unpaid'|'no_payment_required',
    expiresAt:new Date(session.expires_at*1000).toISOString(),canExpire:session.status==='open'&&session.payment_status==='unpaid'};
}
export async function readCheckoutExpiry(stripe:StripeClient,account:BillingAccount,attempt:BillingAttempt){
  if(account.stripeAccountId!==stripe.accountId||account.livemode!==stripe.livemode||!attempt.checkoutSessionId||!/^cs_[A-Za-z0-9_]{1,220}$/.test(attempt.checkoutSessionId))throw invalid();
  await stripe.assertAccount();return checkoutExpirySession(account,attempt,await stripe.request('GET',`/checkout/sessions/${attempt.checkoutSessionId}`));
}
