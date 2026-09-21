import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import { BillingCollection } from './billing-collection';
import { collectionContract, currentSchedulePhase, schedulePhase } from './billing-schedule';
import type { BillingSnapshot } from './billing.service';
import { appendPackageInterval } from '../domain/billing-package';

const snapshot = (tier: 'BASIC_499' | 'STARTER_249', price: string): BillingSnapshot => ({ priceId: price, policy: { ...BILLING_DRAFT_POLICY },
  quote: { offer: billingOffer(tier,'month'), totalSatang: tier === 'BASIC_499' ? 49900 : 24900 } } as BillingSnapshot);
function fixture() {
  const current=snapshot('BASIC_499','price_basic'), future=snapshot('STARTER_249','price_starter');
  const start=Date.parse('2027-01-31T00:00:00Z')/1000, end=Date.parse('2027-02-28T00:00:00Z')/1000;
  const account={id:'account',companyId:'company',stripeAccountId:'acct_test',livemode:false,customerId:'cus_test',baseSubscriptionId:'sub_test',paidThrough:new Date(end*1000)} as BillingAccount;
  const sub:any={id:'sub_test',status:'active',items:{data:[{price:'price_basic',quantity:1,current_period_start:start,current_period_end:end,tax_rates:[]}]}};
  const schedule:any={id:'sched_test',status:'active',end_behavior:'release',current_phase:{start_date:start},
    phases:[schedulePhase(start,end,'price_basic',null),schedulePhase(end,Date.parse('2027-03-28T00:00:00Z')/1000,'price_starter',null,true)]};
  for(const p of schedule.phases){p.default_tax_rates=[];p.discounts=[];p.items[0].tax_rates=[];}
  const tx={billingAttempt:{findMany:async()=>[{collectionJson:{scheduleId:schedule.id}}]}} as unknown as Prisma.TransactionClient;
  return {current,future,account,sub,schedule,tx,start,end};
}
test('future phase_start on February 28 uses March 28 while purchased extension keeps original day 31 and rejects arbitrary future price',async()=>{
  const f=fixture();
  assert.equal(appendPackageInterval(f.account.paidThrough!,'month',31).toISOString(),'2027-03-31T00:00:00.000Z');
  assert.equal((await currentSchedulePhase(f.tx,f.account,f.sub,f.schedule,f.current,f.future)).items[0]!.price,'price_basic');
  f.schedule.phases[1].items[0].price='price_unreviewed';await assert.rejects(()=>currentSchedulePhase(f.tx,f.account,f.sub,f.schedule,f.current,f.future));
});
test('completed historical phases do not block normal management of the current final paid phase',async()=>{
  const f=fixture();f.schedule.phases.unshift({...f.schedule.phases[0],start_date:f.start-86400,end_date:f.start});
  f.schedule.phases.pop();
  assert.equal((await currentSchedulePhase(f.tx,f.account,f.sub,f.schedule,f.current,f.current)).end_date,f.end);
  f.schedule.default_settings={application_fee_percent:5};
  await assert.rejects(()=>currentSchedulePhase(f.tx,f.account,f.sub,f.schedule,f.current,f.current));
});
test('latest equal-boundary consent uses monotonic database revision and validates pending account binding',async()=>{
  const f=fixture();let query:any;const row:any={id:'op',type:'CUSTOMER_SCHEDULE_DOWNGRADE',state:'SUCCEEDED',companyId:'company',stripeAccountId:'acct_test',livemode:false,
    proposedJson:{accountId:'account',subscriptionId:'sub_test',paidThrough:f.account.paidThrough!.toISOString(),snapshot:f.future,change:{previousId:null,currentSnapshot:f.current}}};
  f.account.pendingPlanChangeId='op';
  const tx={billingSubscriptionContract:{findFirst:async(q:any)=>{query=q;return {snapshotJson:f.future};}},billingOperation:{findUnique:async()=>row}} as unknown as Prisma.TransactionClient;
  assert.equal((await collectionContract(tx,f.account)).current.priceId,'price_basic');
  assert.deepEqual(query.orderBy,[{effectiveAt:'desc'},{revision:'desc'}]);row.proposedJson.accountId='foreign';await assert.rejects(()=>collectionContract(tx,f.account));
});
test('lost scheduling response can be observed after the future phase starts, with exact economics',()=>{
  const f=fixture(), now=Math.floor(Date.now()/1000), end=now-5, futureEnd=now+86400;
  const desired=[schedulePhase(now-86400,end,'price_basic',null),schedulePhase(end,futureEnd,'price_starter',null,true)];
  const p:any={action:'SCHEDULE_DOWNGRADE',paidThrough:new Date(end*1000).toISOString(),method:'POST',params:{phases:desired},snapshot:f.future};
  const sub:any={status:'active',billing_mode:{type:'classic'},collection_method:'charge_automatically',billing_cycle_anchor:end,cancel_at:null,items:{data:[{price:'price_starter',quantity:1,current_period_start:end,current_period_end:futureEnd,tax_rates:[]}]}};
  const phase={...desired[1],default_tax_rates:[],discounts:[],items:[{price:'price_starter',quantity:1,tax_rates:[]}]};
  const schedule:any={status:'active',end_behavior:'release',current_phase:{start_date:end},metadata:{mangmeeCollectionOperation:'op'},phases:[phase]};
  const service=new BillingCollection({} as any,{} as any,{} as any);
  assert.equal((service as any).observed(p,sub,schedule,'op'),true);
  sub.billing_cycle_anchor=end-86400;assert.equal((service as any).observed(p,sub,schedule,'op'),false);sub.billing_cycle_anchor=end;
  phase.items[0]!.tax_rates=['txr_unapproved'] as never[];assert.equal((service as any).observed(p,sub,schedule,'op'),false);
});
