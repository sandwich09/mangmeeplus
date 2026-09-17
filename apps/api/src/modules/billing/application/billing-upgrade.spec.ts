import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import { proratedPackagePrice } from '../domain/billing-package';
import { upgradePreview, upgradeHistory } from './billing-upgrade';
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
  // A purchased annual extension must still validate the original monthly renewal phase.
  observed=structuredClone(schedule);observed.phases[1].end_date=Date.parse('2028-02-01Z')/1000;
  await (repeat as any).assertOriginalCollection(original,account,{...source,sourceInterval:'month'},'year');
  await assert.rejects(check(original));
  observed=structuredClone(schedule);
  for(const mutate of [(s:Record<string,any>)=>s.phases[1].items[0].price='price_other',
    (s:Record<string,any>)=>s.phases[1].items[0].tax_rates=['txr_other'],(s:Record<string,any>)=>s.phases[1].end_date++,
    (s:Record<string,any>)=>s.phases[0].add_invoice_items=[{}],(s:Record<string,any>)=>s.end_behavior='cancel']){
    observed=structuredClone(schedule);mutate(observed);await assert.rejects(check(original));
  }
  observed=structuredClone(schedule);
  await assert.rejects(check({...original,pending_update:{}}));
  await assert.rejects(check({...original,items:{data:[{...original.items.data[0],price:'price_other'}]}}));
});


test('mixed monthly/annual purchases keep each paid price through successive upgrades', async () => {
  const at=new Date('2026-01-16T00:00:00Z'), monthStart=new Date('2026-01-01Z'), monthEnd=new Date('2026-02-01Z'), yearEnd=new Date('2027-02-01Z');
  const month=billingOffer('STARTER_249','month'), year=billingOffer('STARTER_249','year');
  const grant=(id:string,kind:string,offer:typeof month,start:Date,end:Date)=>({id,kind,sourceKey:id,units:offer.receiptAllowance,serviceStart:start,serviceEnd:end,
    availableAt:monthStart,expiresAt:yearEnd,revokedAt:null,sourceHash:id});
  const grants:any[]=[grant('month','INITIAL',month,monthStart,monthEnd),grant('year','REPEAT',year,monthEnd,yearEnd)];
  const invoice=(g:any,offer:typeof month)=>({id:g.id,appliedAt:at,applyStatus:'APPLIED',providerStatus:'paid',paidSatang:offer.priceSatang,totalSatang:offer.priceSatang,
    refundedSatang:0,disputed:false,evidenceHash:g.id,periodStart:g.serviceStart,periodEnd:g.serviceEnd,contractSnapshot:{quote:{offer},policy:BILLING_DRAFT_POLICY}});
  const invoices:any[]=[invoice(grants[0],month),invoice(grants[1],year)];
  const db:any={billingReceiptGrant:{findMany:async()=>grants},billingInvoice:{findMany:async()=>invoices},billingOperation:{findMany:async()=>[]}};
  const account:any={id:'account',companyId:'company',baseSubscriptionId:'sub',paidThrough:yearEnd};
  const basic=billingOffer('BASIC_499','year');
  const first=await upgradeHistory(db,account,basic,BILLING_DRAFT_POLICY,at.toISOString());
  assert.equal(first.segments[0]!.newOffer!.interval,'month');
  assert.equal(first.segments[0]!.amountSatang,proratedPackagePrice(24900,49900,monthStart,monthEnd,at));
  assert.equal(first.segments[1]!.amountSatang,250000);assert.equal(first.segments[1]!.receiptUnitsAdded,240);
  const delta=grant('upgrade','UPGRADE',basic,at,yearEnd);delta.units=first.receiptUnitsAdded;grants.push(delta);
  const paid:any=invoice(delta,basic);paid.contractSnapshot.upgrade=first;invoices.push(paid);
  const next=await upgradeHistory(db,account,billingOffer('PRO_999','year'),BILLING_DRAFT_POLICY,new Date(+at+1000).toISOString());
  assert.equal(next.segments[0]!.oldOffer.offerKey,'BASIC_499');assert.equal(next.segments[0]!.oldOffer.interval,'month');
  assert.equal(next.segments[1]!.amountSatang,500000);assert.equal(next.segments[1]!.receiptUnitsAdded,600);
  paid.contractSnapshot.upgrade.segments[0].oldOffer={...month,priceSatang:1};
  await assert.rejects(upgradeHistory(db,account,billingOffer('PRO_999','year'),BILLING_DRAFT_POLICY,new Date(+at+1000).toISOString()));
});


test('zero-valued cadence invoices are recognized only when the completed journal recorded them', async () => {
  const start=Date.parse('2026-01-16Z')/1000,end=Date.parse('2027-01-16Z')/1000;
  const account:any={id:'account',baseSubscriptionId:'sub',customerId:'cus',livemode:false};
  const invoice:any={id:'in_update',object:'invoice',livemode:false,customer:'cus',parent:{subscription_details:{subscription:'sub'}},
    status:'paid',total:0,amount_paid:0,amount_remaining:0,currency:'thb',billing_reason:'subscription_update',collection_method:'charge_automatically',starting_balance:0};
  const line:any={pricing:{price_details:{price:'price_zero'}},currency:'thb',quantity:1,livemode:false,
    parent:{subscription_item_details:{subscription:'sub',proration:false}},period:{start,end}};
  const journal={completed:true,phaseStart:start,paidThrough:new Date(end*1000).toISOString(),zeroInvoiceIds:['in_update']};
  const repeat=new BillingRepeat({client:{billingAttempt:{findMany:async()=>[{collectionJson:journal,quoteSnapshot:{repeat:{zeroPriceId:'price_zero'}}}]}}} as any,{} as any,{} as any);
  assert.equal(await repeat.ownedZeroInvoice(account,invoice,[line]),true);
  assert.equal(await repeat.ownedZeroInvoice(account,{...invoice,id:'in_unrelated'},[line]),false);
  assert.equal(await repeat.ownedZeroInvoice(account,{...invoice,total:1},[line]),false);
  assert.equal(await repeat.ownedZeroInvoice(account,{...invoice,customer:'foreign'},[line]),false);
  assert.equal(await repeat.ownedZeroInvoice(account,invoice,[{...line,period:{start,end:end+1}}]),false);
  journal.completed=false;assert.equal(await repeat.ownedZeroInvoice(account,invoice,[line]),false);
});
