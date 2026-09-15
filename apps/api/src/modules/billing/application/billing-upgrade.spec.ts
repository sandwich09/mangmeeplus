import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_DRAFT_POLICY } from '@watchdog-bms/contracts';
import { proratedPackagePrice } from '../domain/billing-package';
import { upgradePreview } from './billing-upgrade';
import { BillingRepeat } from './billing-repeat';

test('money proration uses actual seconds and rounds half up per prepaid segment', () => {
  const start = new Date('2026-01-01Z'), end = new Date('2027-01-01Z'), half = new Date((+start + +end)/2);
  assert.equal(proratedPackagePrice(499000,999000,start,end,half),250000);
  assert.equal(proratedPackagePrice(499000,999000,end,new Date('2028-01-01Z'),half),500000);
  assert.equal(proratedPackagePrice(1,2,start,end,half),1);
  assert.equal(proratedPackagePrice(1,2,start,end,end),0);
  for (const [old,next] of [[2,1],[-1,10],[1,NaN],[1,2147483648]]) assert.throws(()=>proratedPackagePrice(old!,next!,start,end,half));
  assert.throws(()=>proratedPackagePrice(1,2,end,start,half));
});

test('isolated native-shaped invoice preview rejects renewal totals, mode, credits and wrong lines', async () => {
  const preview = { id:'in_preview', object:'invoice', livemode:false, currency:'thb', parent:null, total:25000, amount_due:25000, amount_paid:0,
    starting_balance:0, ending_balance:0, amount_shipping:0, total_taxes:[], discounts:[], total_discount_amounts:[], total_pretax_credit_amounts:[],
    lines:{has_more:false,data:[{amount:25000,currency:'thb',quantity:1,discountable:false,parent:{type:'invoice_item_details',subscription_item_details:null}}]} };
  let current: Record<string,any> = structuredClone(preview);
  const stripe = {livemode:false,request:async (method:string,path:string,params:Record<string,any>)=>{
    assert.equal(method,'POST'); assert.equal(path,'/invoices/create_preview');
    for(const key of ['customer','subscription','schedule','subscription_details']) assert.equal(key in params,false);
    assert.equal(params.invoice_items[0].amount,25000); assert.equal(params.discounts,''); return current;
  }} as Parameters<typeof upgradePreview>[0];
  assert.equal((await upgradePreview(stripe,25000,BILLING_DRAFT_POLICY)).totalSatang,25000);
  const mutations: ((p:Record<string,any>)=>void)[] = [p=>p.total+=999000,p=>p.parent={subscription_details:{}},p=>p.livemode=true,
    p=>p.starting_balance=-1,p=>p.amount_paid=1,p=>p.total_taxes=[{amount:7}],p=>p.lines.has_more=true,p=>p.lines.data.push(p.lines.data[0]),
    p=>p.lines.data[0].amount=24999,p=>p.lines.data[0].discountable=true,p=>p.total_pretax_credit_amounts=[{}]];
  for(const mutate of mutations){current=structuredClone(preview);mutate(current);await assert.rejects(upgradePreview(stripe,25000,BILLING_DRAFT_POLICY));}
});

test('prepaid source recheck accepts later zero cycles but blocks external collection drift before Checkout', async () => {
  const start=Date.parse('2026-01-01Z')/1000, middle=Date.parse('2027-01-01Z')/1000, end=Date.parse('2028-01-01Z')/1000;
  const account={id:'account',baseSubscriptionId:'sub_test',customerId:'cus_test',livemode:false};
  const source={subscriptionId:'sub_test',paidThrough:new Date(end*1000).toISOString(),currentPriceId:'price_zero',currentPeriodStart:middle,
    sourcePriceId:'price_paid',sourceTaxRateId:null,scheduleId:'sub_sched_test',anchorDay:1};
  const original={id:'sub_test',object:'subscription',livemode:false,customer:'cus_test',metadata:{billingAccountId:'account'},status:'active',
    billing_mode:{type:'classic'},collection_method:'charge_automatically',schedule:'sub_sched_test',
    items:{data:[{price:'price_zero',quantity:1,current_period_start:middle,current_period_end:end}]}};
  const schedule={object:'subscription_schedule',livemode:false,status:'active',subscription:'sub_test',customer:'cus_test',end_behavior:'release',current_phase:{start_date:start},
    phases:[{start_date:start,end_date:end,items:[{price:'price_zero',quantity:1,tax_rates:[]}]},
      {start_date:end,end_date:Date.parse('2029-01-01Z')/1000,items:[{price:'price_paid',quantity:1,tax_rates:[]}],billing_cycle_anchor:'phase_start'}]};
  let observed:Record<string,any>=structuredClone(schedule);
  const repeat=new BillingRepeat({} as any,{request:async()=>observed} as any,{} as any);
  const check=(sub:Record<string,any>)=>(repeat as any).assertOriginalCollection(sub,account,source,'year');
  await check(original);
  for(const mutate of [(s:Record<string,any>)=>s.phases[1].items[0].price='price_other',
    (s:Record<string,any>)=>s.phases[1].items[0].tax_rates=['txr_other'],(s:Record<string,any>)=>s.phases[1].end_date++,
    (s:Record<string,any>)=>s.phases[0].add_invoice_items=[{}],(s:Record<string,any>)=>s.end_behavior='cancel']){
    observed=structuredClone(schedule);mutate(observed);await assert.rejects(check(original));
  }
  observed=structuredClone(schedule);
  await assert.rejects(check({...original,pending_update:{}}));
  await assert.rejects(check({...original,items:{data:[{...original.items.data[0],price:'price_other'}]}}));
});
