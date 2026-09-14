import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingAccount,BillingAttempt} from '../../../generated/prisma/client';
import {checkoutExpiryBinding,checkoutExpirySession} from './billing-checkout-expiry-source';
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
