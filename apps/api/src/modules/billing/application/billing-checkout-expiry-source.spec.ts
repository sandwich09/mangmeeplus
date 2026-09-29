import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingAccount,BillingAttempt} from '../../../generated/prisma/client';
import {checkoutExpiryBinding,checkoutExpirySession} from './billing-checkout-expiry-source';
import {BILLING_DRAFT_POLICY,billingOffer} from '@watchdog-bms/contracts';
import {quoteTotals} from '../domain/billing-policy';
const account={id:'account',companyId:'company',stripeAccountId:'acct_Test',livemode:false,customerId:'cus_Test',activeAttemptId:'attempt'} as BillingAccount;
const attempt={id:'attempt',billingAccountId:account.id,checkoutSessionId:'cs_test_Test',quoteId:'quote',policyRevisionId:'revision',consentRevision:'consent',consentAt:new Date(1000),
  quoteSnapshot:{quote:{quoteId:'quote',companyId:'company',policyRevision:'revision',consentRevision:'consent',totalSatang:99900}}} as unknown as BillingAttempt;
const session={id:'cs_test_Test',object:'checkout.session',livemode:false,mode:'subscription',customer:'cus_Test',client_reference_id:'attempt',metadata:{billingAccountId:'account',billingAttemptId:'attempt'},
  currency:'thb',amount_total:99900,status:'open',payment_status:'unpaid',created:1000,expires_at:2000};
test('checkout expiry only admits original open unpaid session, and keeps paid/expired observation distinct',()=>{
  assert.equal(checkoutExpirySession(account,attempt,session).canExpire,true);
  assert.equal(checkoutExpirySession(account,attempt,{...session,status:'expired'}).canExpire,false);
  const paid=checkoutExpirySession(account,attempt,{...session,status:'complete',payment_status:'paid'});assert.equal(paid.providerState,'complete');assert.equal(paid.canExpire,false);
  assert.equal(checkoutExpirySession(account,attempt,{...session,payment_status:'paid'}).canExpire,false);
  const repeat={...attempt,quoteSnapshot:{...attempt.quoteSnapshot as object,repeat:{}}} as BillingAttempt;
  assert.equal(checkoutExpirySession(account,repeat,{...session,mode:'payment'}).canExpire,true);
});
test('foreign/malformed/recoverable session and changed original account/quote cannot masquerade as the reviewed checkout',()=>{
  for(const values of [{id:'cs_Foreign'},{livemode:true},{customer:'cus_Foreign'},{client_reference_id:'other'},{metadata:{}},{currency:'usd'},{amount_total:99800},
    {mode:'payment'},{status:'unknown'},{created:NaN},{expires_at:Infinity},{expires_at:500},{recovered_from:'cs_Other'},{after_expiration:{recovery:{enabled:true}}}])assert.throws(()=>checkoutExpirySession(account,attempt,{...session,...values}));
  assert.throws(()=>checkoutExpirySession(account,{...attempt,quoteId:'changed'},session));
  assert.notEqual(checkoutExpiryBinding(account,attempt),checkoutExpiryBinding({...account,customerId:'cus_Changed'},attempt));
  assert.notEqual(checkoutExpiryBinding(account,attempt),checkoutExpiryBinding({...account,activeAttemptId:'new'},attempt));
  assert.equal(checkoutExpiryBinding(account,attempt),checkoutExpiryBinding(account,{...attempt,updatedAt:new Date(),status:'EXPIRED',version:123}));
});
test('a sales-event discounted Checkout is still the original session: its own discounted total, never the undiscounted one',()=>{
  const snapshot={quote:{...(attempt.quoteSnapshot as {quote:object}).quote,purchaseMode:'CARD_ONCE',purchase:{kind:'REPEAT'},offer:billingOffer('BASIC_499','month'),totalSatang:49900},
    policy:{...BILLING_DRAFT_POLICY,taxTreatment:'NOT_VAT_REGISTERED'},eventDiscount:{choice:'USE',ticketSerial:'ABCD2345',eventName:'งาน',expiresAt:'2026-11-01T00:00:00.000Z',
      discountSatang:10000,shownDiscountSatang:10000,applied:{unitAmountSatang:39900,subtotalSatang:39900,taxSatang:0,totalSatang:39900},ticketId:'t',ticketVersion:1,batchId:'b',salesUserId:'u'}};
  const discounted={...attempt,quoteSnapshot:snapshot} as unknown as BillingAttempt,paying={...session,mode:'payment'};
  assert.equal(checkoutExpirySession(account,discounted,{...paying,amount_total:39900}).canExpire,true);
  assert.throws(()=>checkoutExpirySession(account,discounted,{...paying,amount_total:49900}));
  // A snapshot whose discount does not add up proves nothing: back to the quote's own total, so the discounted session is refused.
  const tampered={...attempt,quoteSnapshot:{...snapshot,eventDiscount:{...snapshot.eventDiscount,discountSatang:20000}}} as unknown as BillingAttempt;
  assert.throws(()=>checkoutExpirySession(account,tampered,{...paying,amount_total:39900}));
  // SD-O13: a discounted CARD_AUTO first period is a one-time payment session; without the discount it stays a subscription session.
  const card={...attempt,quoteSnapshot:{...snapshot,quote:{...snapshot.quote,purchaseMode:'CARD_AUTO',purchase:{kind:'INITIAL'}}}} as unknown as BillingAttempt;
  assert.equal(checkoutExpirySession(account,card,{...paying,amount_total:39900}).canExpire,true);
  assert.throws(()=>checkoutExpirySession(account,card,{...session,amount_total:39900}));
  const declined={...attempt,quoteSnapshot:{...(card.quoteSnapshot as object),eventDiscount:{choice:'DECLINE',offeredTicketId:'t'}}} as unknown as BillingAttempt;
  assert.equal(checkoutExpirySession(account,declined,{...session,amount_total:49900}).canExpire,true);
});
test('a CARD_AUTO advance deal is a one-time payment Checkout at the deal total, so its owner can cancel it',()=>{
  // As quote()/checkout() build it: the deal's own price plus exclusive VAT (a deal never takes an event discount), paid in a
  // `mode:'payment'` session that saves the card (setup_future_usage off_session) for the subscription bound after it.
  const at='2026-10-01T00:00:00.000Z',ends='2026-11-01T00:00:00.000Z',offer={...billingOffer('BASIC_499','month'),label:'Basic · ข้อเสนอพิเศษ',priceSatang:39900};
  const snapshot={quote:{...(attempt.quoteSnapshot as {quote:object}).quote,purchaseMode:'CARD_AUTO',offer,...quoteTotals(39900,'EXCLUSIVE_VAT_7'),
    deal:{dealId:'deal',months:1,description:'ดีล',baseLabel:'Basic'},purchase:{kind:'ADVANCE_DEAL',previousPaidThrough:at,projectedPaidThrough:ends},
    advanceDeal:{startsAt:at,firstCycleEndsAt:ends,nextChargeAt:ends}},policy:{...BILLING_DRAFT_POLICY,taxTreatment:'EXCLUSIVE_VAT_7'},
    deal:{requestId:'deal',snapshotHash:'hash',months:1,salesUserId:'sales',aiMonthlyBudgetSatang:null,creditScope:'CHAT',cadence:'month'},
    advanceDeal:{invoiceId:'invoice',contractAttemptId:'previous',paidThrough:at,firstCycleEndsAt:ends,anchorDay:1},priceId:'price_Deal',productId:'prod_Basic'};
  const advance={...attempt,quoteSnapshot:snapshot} as unknown as BillingAttempt,paying={...session,mode:'payment',amount_total:42693};
  assert.equal(checkoutExpirySession(account,advance,paying).canExpire,true);
  assert.equal(checkoutExpirySession(account,advance,{...paying,status:'expired'}).providerState,'expired');
  for(const values of [{mode:'subscription'},{amount_total:39900},{customer:'cus_Foreign'},{client_reference_id:'other'},{metadata:{billingAccountId:'account'}}])
    assert.throws(()=>checkoutExpirySession(account,advance,{...paying,...values}));
});
