import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingAccount,BillingAttempt} from '../../../generated/prisma/client';
import type {RequestContext} from '../../auth/domain/models/request-context.model';
import {StripeRequestError} from '../infrastructure/stripe.client';
import {BillingCheckoutExpiryService} from './billing-checkout-expiry.service';

function fixture(race=false){
  const account={id:'account',companyId:'company',stripeAccountId:'acct_Test',livemode:false,customerId:'cus_Test',activeAttemptId:'attempt',leaseToken:null,leaseUntil:null} as unknown as BillingAccount;
  const attempt={id:'attempt',billingAccountId:'account',checkoutSessionId:'cs_test_Test',quoteId:'quote',policyRevisionId:'revision',consentRevision:'consent',consentAt:new Date(1000),
    quoteSnapshot:{quote:{quoteId:'quote',companyId:'company',policyRevision:'revision',consentRevision:'consent',totalSatang:99900}}} as unknown as BillingAttempt;
  const session={id:'cs_test_Test',object:'checkout.session',livemode:false,mode:'subscription',customer:'cus_Test',client_reference_id:'attempt',
    metadata:{billingAccountId:'account',billingAttemptId:'attempt'},currency:'thb',amount_total:99900,status:'open',payment_status:'unpaid',created:1000,expires_at:2000};
  let posts=0,reconciles=0;
  const stripe={accountId:'acct_Test',livemode:false,assertAccount:async()=>{},request:async(method:string,path:string)=>{
    if(method==='GET'&&path==='/checkout/sessions/cs_test_Test')return {...session};
    assert.equal(method,'POST');assert.equal(path,'/checkout/sessions/cs_test_Test/expire');posts++;
    session.status=race?'complete':'expired';session.payment_status=race?'paid':'unpaid';
    if(race)throw new StripeRequestError('REJECTED','already_complete');return {...session};
  }};
  const tx={$queryRaw:async()=>[],billingAttempt:{findFirst:async()=>attempt},billingAccount:{updateMany:async({where,data}:any)=>{
    if(where.leaseToken&&where.leaseToken!==account.leaseToken)return {count:0};
    if(where.activeAttemptId&&where.activeAttemptId!==account.activeAttemptId)return {count:0};
    Object.assign(account,data);return {count:1};}},auditLog:{create:async()=>({})}};
  const prisma={client:{...tx,$transaction:async(run:(value:typeof tx)=>Promise<unknown>)=>run(tx)}};
  const billing={stripe,assertOwner:async()=>{},account:async()=>account};
  const reconciler={reconcileAccount:async()=>{reconciles++;if(session.status==='expired')account.activeAttemptId=null;}};
  const service=new BillingCheckoutExpiryService(prisma as unknown as ConstructorParameters<typeof BillingCheckoutExpiryService>[0],
    {} as ConstructorParameters<typeof BillingCheckoutExpiryService>[1],billing as unknown as ConstructorParameters<typeof BillingCheckoutExpiryService>[2],
    reconciler as unknown as ConstructorParameters<typeof BillingCheckoutExpiryService>[3]);
  return {service,account,posts:()=>posts,reconciles:()=>reconciles};
}

test('owner can expire only the original unpaid Checkout, then reconciliation releases the attempt',async()=>{
  const f=fixture(),result=await f.service.cancelOwn({companyId:'company',userId:'owner',requestId:'request'} as RequestContext,'attempt');
  assert.equal(result.state,'EXPIRED');assert.equal(f.posts(),1);assert.equal(f.reconciles(),1);assert.equal(f.account.activeAttemptId,null);
});

test('payment completing during cancellation is observed, never marked expired',async()=>{
  const f=fixture(true),result=await f.service.cancelOwn({companyId:'company',userId:'owner',requestId:'request'} as RequestContext,'attempt');
  assert.equal(result.state,'PENDING');assert.equal(f.posts(),1);assert.equal(f.reconciles(),1);assert.equal(f.account.activeAttemptId,'attempt');
});
