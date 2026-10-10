import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {StripeClient} from '../infrastructure/stripe.client';
import {settlementMovement,settlementPage,settlementPayout} from './billing-settlement-source';
import {BillingSettlementService} from './billing-settlement.service';
const movement=(values:Record<string,unknown>={})=>({id:'txn_Test',object:'balance_transaction',source:'ch_Test',type:'charge',reporting_category:'charge',
  currency:'thb',amount:10000,fee:300,net:9700,status:'available',created:1000,available_on:1100,...values});
test('settlement arithmetic and availability stay separate from invoice payment and reject malformed pages',()=>{
  assert.equal(settlementMovement(movement({status:'pending'})).net,9700);
  assert.equal('livemode' in settlementMovement(movement()),false);
  assert.equal(settlementMovement(movement({currency:'usd'})).currency,'usd');
  for(const change of [{net:10000},{fee:NaN},{amount:1.1},{status:'paid'},{source:'../customers'},{available_on:null},{created:Infinity}])assert.throws(()=>settlementMovement(movement(change)));
  const window={since:900,until:1100};assert.equal(settlementPage({object:'list',data:[movement()],has_more:false},window,null).nextCursor,null);
  for(const page of [{object:'list',data:[movement(),movement()],has_more:false},{object:'list',data:[],has_more:true},
    {object:'list',data:[movement({created:1100})],has_more:false},{object:'list',data:[movement()],has_more:'false'}])assert.throws(()=>settlementPage(page,window,null));
  assert.throws(()=>settlementPage({object:'list',data:[movement()],has_more:false},window,'txn_Test'));
});
test('only a complete original automatic payout can match its constituent net movements',async()=>{
  const out=settlementMovement(movement({id:'txn_Payout',source:'po_Test',type:'payout',reporting_category:'payout',amount:-9700,fee:0,net:-9700}));
  let p:any={id:'po_Test',object:'payout',livemode:false,currency:'thb',amount:9700,status:'paid',arrival_date:1200,automatic:true,method:'standard',reconciliation_status:'completed',balance_transaction:out.id};
  let rows=[movement()],calls=0;
  const stripe={livemode:false,request:async(method:string,path:string)=>{assert.equal(method,'GET');calls++;return path==='/payouts/po_Test'?p:{object:'list',data:rows,has_more:false};}} as unknown as StripeClient;
  assert.equal((await settlementPayout(stripe,out)).reconciliation,'MATCHED');
  rows=[movement({net:9699,fee:301})];await assert.rejects(settlementPayout(stripe,out));rows=[movement(),movement()];await assert.rejects(settlementPayout(stripe,out));rows=[movement()];
  p={...p,automatic:false,reconciliation_status:'not_applicable'};calls=0;assert.equal((await settlementPayout(stripe,out)).reconciliation,'MANUAL');assert.equal(calls,1);
  p={...p,automatic:true,reconciliation_status:'in_progress'};assert.equal((await settlementPayout(stripe,out)).reconciliation,'PENDING');
  p={...p,livemode:true};await assert.rejects(settlementPayout(stripe,out));
});
test('failed payout reversal binds its original failure movement without claiming settlement or changing paid rights',async()=>{
  const reversal=settlementMovement(movement({id:'txn_Reversal',source:'po_Test',type:'payout_failure',amount:9700,fee:0,net:9700}));
  let p:any={id:'po_Test',object:'payout',livemode:false,currency:'thb',amount:9700,status:'failed',arrival_date:1200,automatic:true,method:'standard',reconciliation_status:'completed',balance_transaction:'txn_Original',failure_balance_transaction:reversal.id};
  const stripe={livemode:false,request:async(method:string)=>{assert.equal(method,'GET');return p;}} as unknown as StripeClient;
  const result=await settlementPayout(stripe,reversal);assert.equal(result.status,'failed');assert.equal(result.reconciliation,'FAILED');
  p={...p,failure_balance_transaction:'txn_Foreign'};await assert.rejects(settlementPayout(stripe,reversal));
});

test('large automatic payouts retain incomplete evidence rather than certifying a bounded prefix',async()=>{
  const out=settlementMovement(movement({id:'txn_Payout',source:'po_Test',type:'payout',amount:-4850000,fee:0,net:-4850000}));
  let page=0;const cursors:string[]=[];
  const stripe={livemode:false,request:async(_method:string,path:string,params:any)=>{
    if(path==='/payouts/po_Test')return {id:'po_Test',object:'payout',livemode:false,currency:'thb',amount:4850000,status:'paid',arrival_date:1200,automatic:true,method:'standard',reconciliation_status:'completed',balance_transaction:out.id};
    assert.equal(params.payout,'po_Test');if(params.starting_after)cursors.push(params.starting_after);
    const offset=page++*100;return {object:'list',has_more:true,data:Array.from({length:100},(_,i)=>movement({id:`txn_Item${offset+i}`}))};
  }} as unknown as StripeClient;
  const result=await settlementPayout(stripe,out);assert.equal(result.reconciliation,'INCOMPLETE');assert.equal(result.constituentCount,500);assert.equal(page,5);assert.equal(new Set(cursors).size,4);
});
test('a PromptPay payment and its refund are read as a card charge and refund are; another id shape or an unmapped payment never matches',async()=>{
  const paths:string[]=[],refundOf=(type:string)=>({type,reporting_category:'refund',amount:-10000,fee:0,net:-10000});
  let mapped=false,method='promptpay',refunded=0;
  const row={id:'invoice',billingAccountId:'account',providerInvoiceId:'in_Test',providerChargeId:'py_Test',subscriptionId:'sub_Test',totalSatang:10000,paidSatang:10000,taxSatang:654,
    refundedSatang:0,disputed:false,contractSnapshot:{quote:{purchaseMode:'PROMPTPAY_ONCE'}}};
  const account={id:'account',companyId:'company',customerId:'cus_Test',stripeAccountId:'acct_Test',livemode:false};
  const charge=(id:string)=>({id,object:'charge',livemode:false,customer:'cus_Test',currency:'thb',status:'succeeded',paid:true,captured:true,balance_transaction:'txn_Test',amount:10000,
    amount_refunded:refunded,disputed:false,payment_intent:'pi_Test',payment_method_details:{type:method}});
  const stripe={accountId:'acct_Test',livemode:false,assertAccount:async()=>{},request:async(verb:string,path:string)=>{assert.equal(verb,'GET');paths.push(path);const id=path.split('/')[2]!;
    if(path.startsWith('/charges/'))return charge(id);
    if(path.startsWith('/refunds/'))return {id,object:'refund',currency:'thb',balance_transaction:'txn_Test',amount:10000,status:'succeeded',charge:id.startsWith('pyr_')?'py_Test':id==='re_Mixed'?'xx_Test':'ch_Test'};
    if(path==='/invoices/in_Test')return {id:'in_Test',livemode:false,customer:'cus_Test',parent:{subscription_details:{subscription:'sub_Test'}},currency:'thb',status:'paid',total:10000,amount_paid:10000,total_taxes:[{amount:654}]};
    if(path==='/invoice_payments')return {object:'list',has_more:false,data:[{id:'inpay_Test',object:'invoice_payment',livemode:false,status:'paid',invoice:'in_Test',payment:{type:'payment_intent',payment_intent:'pi_Test'},amount_paid:10000,currency:'thb'}]};
    return {id:'pi_Test',object:'payment_intent',livemode:false,currency:'thb',status:'succeeded',customer:'cus_Test',amount_received:10000,latest_charge:'py_Test'};}};
  const prisma={client:{$queryRaw:async()=>mapped?[{id:'invoice'}]:[],billingInvoice:{findUniqueOrThrow:async()=>row},billingAccount:{findUniqueOrThrow:async()=>account}}};
  const service=new BillingSettlementService(prisma as any,stripe as any,null as any,null as any);
  const observe=(values:Record<string,unknown>)=>(service as any).observation(settlementMovement(movement(values)));
  assert.equal(settlementMovement(movement({source:'py_Test',type:'payment'})).type,'charge');assert.equal(settlementMovement(movement({source:'pyr_Test',...refundOf('payment_refund')})).type,'refund');
  for(const [source,type] of [['ch_Test','charge'],['py_Test','charge'],['py_Test','payment']])assert.equal((await observe({source,type})).classification,'LOCAL_MISSING',`unmapped ${type} ${source}`);
  for(const [source,type] of [['re_Test','refund'],['pyr_Test','refund'],['pyr_Test','payment_refund']])assert.equal((await observe({source,...refundOf(type!)})).refundState,'succeeded');
  for(const type of ['payment_failure_refund','payment_reversal','adjustment']){const o=await observe({source:'py_Test',type});assert.equal(o.classification,'MANUAL');assert.equal(o.invoiceId,null);}
  paths.length=0;
  for(const type of ['charge','payment'])for(const source of ['xx_Test','re_Test','pyr_Test','pi_Test'])await assert.rejects(observe({source,type}),/settlement_source_invalid/);
  for(const type of ['refund','payment_refund'])for(const source of ['xx_Test','ch_Test','py_Test'])await assert.rejects(observe({source,...refundOf(type)}),/settlement_source_invalid/);
  assert.deepEqual(paths,[],'a foreign shape is refused before any provider read');
  await assert.rejects(observe({source:'re_Mixed',...refundOf('refund')}),/settlement_source_invalid/);
  mapped=true;
  const paid=await observe({source:'py_Test',type:'payment'});
  assert.deepEqual([paid.classification,paid.movement.type,paid.invoiceId,paid.companyId,paid.taxSatang],['MATCHED','charge','invoice','company',654]);
  refunded=10000;assert.equal((await observe({source:'py_Test',type:'payment'})).classification,'DIFFERENT');
  row.refundedSatang=10000;const back=await observe({source:'pyr_Test',...refundOf('payment_refund')});
  assert.deepEqual([back.classification,back.movement.type,back.refundState,back.invoiceId,back.taxSatang],['MATCHED','refund','succeeded','invoice',null]);
  await assert.rejects(observe({source:'py_Test',type:'payment',amount:9999,net:9699}),/settlement_source_invalid/);
  method='card';await assert.rejects(observe({source:'py_Test',type:'payment'}),'the paid contract names PromptPay');
});
