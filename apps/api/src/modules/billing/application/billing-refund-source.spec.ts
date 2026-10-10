import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingAccount,BillingInvoice} from '../../../generated/prisma/client';
import {configurationHash} from '../domain/billing-policy';
import {assertOriginalInvoiceCharge,refundNoteProjection,refundParams,refundPreview,refundSource,observedRefund,unrepairableBinding,advanceDealAtBoundary} from './billing-refund-source';
import {StripeRequestError,type StripeClient} from '../infrastructure/stripe.client';

const account={id:'account',customerId:'cus_Test',livemode:false} as BillingAccount;
const invoice={id:'invoice',providerInvoiceId:'in_Test',providerChargeId:'ch_Test',paidSatang:10700,totalSatang:10700,taxSatang:700} as BillingInvoice;
const tax=(amount:number,behavior='inclusive',rate='txr_Original')=>({amount,tax_behavior:behavior,type:'tax_rate_details',tax_rate_details:{tax_rate:rate}});
function note(behavior='inclusive'){
  return {id:'cn_Test',object:'credit_note',livemode:false,currency:'thb',invoice:'in_Test',customer:'cus_Test',amount:1070,total:1070,type:'post_payment',
    pre_payment_amount:0,post_payment_amount:1070,status:'issued',customer_balance_transaction:null,out_of_band_amount:0,amount_shipping:0,discount_amount:0,discount_amounts:[],
    total_excluding_tax:1000,total_taxes:[tax(70,behavior)],memo:'คืนเงิน',number:'CN-1',created:Math.floor(Date.now()/1000),
    metadata:{billingRefundOperationId:'command',billingAccountId:'account',billingSourceHash:'source'},refunds:[{refund:'re_Test',amount_refunded:1070,type:'refund',payment_record_refund:null}],
    lines:{object:'list',has_more:false,data:[{object:'credit_note_line_item',livemode:false,type:'invoice_line_item',invoice_line_item:'il_Test',amount:behavior==='inclusive'?1070:1000,taxes:[tax(70,behavior)]}]}};
}
test('original inclusive/exclusive VAT is retained on partial credit, independent of current sales VAT',()=>{
  for(const behavior of ['inclusive','exclusive']){
    const n=note(behavior),source={total_taxes:[tax(700,behavior)]};
    const p=refundNoteProjection(n,account,invoice,source,1070);assert.equal(p.taxSatang,70);assert.equal(p.totalExcludingTax,1000);assert.equal(p.lines[0].invoiceLineId,'il_Test');
    const stored=JSON.parse(JSON.stringify(p));assert.equal(configurationHash(stored),configurationHash(p));
  }
});
test('mismatched original tax, inflated line, foreign invoice and unsupported credits cannot form a monetary preview',()=>{
  const changes:((n:ReturnType<typeof note>)=>void)[]=[
    n=>{n.invoice='in_Foreign';},n=>{n.customer='cus_Foreign';},n=>{n.livemode=true;},n=>{n.total_excluding_tax=999;},
    n=>{n.total_taxes=[tax(70,'exclusive')];},n=>{n.total_taxes=[tax(70,'inclusive','txr_Other')];},
    n=>{n.lines.data[0]!.amount=0;},n=>{n.lines.data[0]!.taxes=[];},n=>{n.lines.has_more=true;},n=>{n.lines.data.push(n.lines.data[0]!);},
    n=>{n.out_of_band_amount=1;},n=>{(n as any).customer_balance_transaction='cbtxn_Test';},n=>{n.amount_shipping=1;},n=>{n.type='pre_payment';}
  ];
  for(const change of changes){const n=note();change(n);assert.throws(()=>refundNoteProjection(n,account,invoice,{total_taxes:[tax(700)]},1070));}
});
test('a paid-invoice preview must use a real original invoice line and current refundable charge',async()=>{
  let amount=10700;
  const stripe={request:async(_method:string,path:string)=>path==='/credit_notes/preview'?note():{object:'list',has_more:false,data:[{id:'il_Test',livemode:false,currency:'thb',amount}]}} as unknown as StripeClient;
  const source={invoice:{total_taxes:[tax(700)]},charge:{disputed:false,amount_refunded:0},refunds:[],notes:[]} as any;
  assert.equal((await refundPreview(stripe,account,invoice,source,{refund_amount:1070})).taxSatang,70);
  amount=100;await assert.rejects(refundPreview(stripe,account,invoice,source,{refund_amount:1070}));amount=10700;
  await assert.rejects(refundPreview(stripe,account,invoice,{...source,charge:{disputed:false,amount_refunded:10700}},{refund_amount:1070}));
  await assert.rejects(refundPreview(stripe,account,invoice,{...source,refunds:[{status:'pending'}]},{refund_amount:1070}));
});
test('refund params name original invoice lines net of issued notes, the only shape live dahlia previews',async()=>{
  const paid={...invoice,paidSatang:24900,totalSatang:24900,taxSatang:0} as BillingInvoice;
  const stripe={request:async(_method:string,path:string,params:Record<string,any>)=>{
    if(path==='/invoices/in_Test/lines')return {object:'list',has_more:false,data:[{id:'il_B',livemode:false,currency:'thb',amount:14900},{id:'il_A',livemode:false,currency:'thb',amount:10000}]};
    if(path==='/credit_notes/cn_Paged/lines')return {object:'list',has_more:false,data:[{id:'cnli_Paged',object:'credit_note_line_item',type:'invoice_line_item',invoice_line_item:'il_A',amount:6000}]};
    // Live 2026-08-26.dahlia (read-only probe 2026-09-23): credit_amount below 1 is a 400 and an amount-only preview has no lines.
    if(params.credit_amount!==undefined&&!(params.credit_amount>=1))throw new StripeRequestError('REJECTED','request_rejected');
    const amount=params.amount??params.refund_amount,data=(params.lines??[]).map((l:any)=>({object:'credit_note_line_item',livemode:false,type:'invoice_line_item',invoice_line_item:l.invoice_line_item,amount:l.amount,taxes:[]}));
    return {...note(),amount,total:amount,post_payment_amount:amount,total_excluding_tax:amount,total_taxes:[],lines:{object:'list',has_more:false,data}};
  }} as unknown as StripeClient;
  const source={invoice:{total_taxes:[]},charge:{disputed:false,amount_refunded:6000},refunds:[],sourceHash:'source',notes:[
    {id:'cn_Paged',status:'issued',lines:{object:'list',has_more:true,data:[]}},
    {id:'cn_Void',status:'void',lines:{object:'list',has_more:false,data:[{object:'credit_note_line_item',type:'invoice_line_item',invoice_line_item:'il_B',amount:14900}]}}]} as any;
  const params=await refundParams(stripe,account,paid,source,'command',12000,'',false);
  assert.deepEqual(params,{invoice:'in_Test',lines:[{type:'invoice_line_item',invoice_line_item:'il_A',amount:4000},{type:'invoice_line_item',invoice_line_item:'il_B',amount:8000}],
    refund_amount:12000,out_of_band_amount:0,email_type:'none',metadata:{billingRefundOperationId:'command',billingAccountId:'account',billingSourceHash:'source'}});
  assert.deepEqual((await refundPreview(stripe,account,paid,source,params)).lines.map((l:{invoiceLineId:string;amount:number})=>[l.invoiceLineId,l.amount]),[['il_A',4000],['il_B',8000]]);
  const amountOnly={invoice:'in_Test',amount:12000,refund_amount:12000,email_type:'none'};
  await assert.rejects(refundPreview(stripe,account,paid,source,{...amountOnly,credit_amount:0,out_of_band_amount:0}),'the pre-fix params are a live 400');
  await assert.rejects(refundPreview(stripe,account,paid,source,amountOnly),'an amount-only preview has no lines');
  await assert.rejects(refundParams(stripe,account,paid,source,'command',18901,'',false),'only 4000 + 14900 is still creditable');
});
test('positive discovery binds original command, charge and one refund; a note alone never proves bank receipt',async()=>{
  const n=note(),projection=configurationHash(refundNoteProjection(n,account,invoice,{total_taxes:[tax(700)]},1070));
  let refund:any={id:'re_Test',object:'refund',livemode:false,currency:'thb',amount:1070,charge:'ch_Test',status:'pending',created:Math.floor(Date.now()/1000)};
  const stripe={request:async(method:string)=>{assert.equal(method,'GET');return refund;}} as unknown as StripeClient;
  const source={invoice:{total_taxes:[tax(700)]},notes:[n],refunds:[refund]} as any;
  const observe=()=>observedRefund(stripe,account,invoice,source,'command','source',1070,'คืนเงิน',projection);
  assert.equal((await observe())!.refundState,'pending');refund={...refund,status:'succeeded'};assert.equal((await observe())!.refundState,'succeeded');
  refund={...refund,charge:'ch_Foreign'};await assert.rejects(observe());refund={...refund,charge:'ch_Test'};
  source.notes.push(n);await assert.rejects(observe());source.notes.pop();n.metadata.billingSourceHash='changed';await assert.rejects(observe());n.metadata.billingSourceHash='source';
  (n.refunds[0] as any).payment_record_refund={payment_record:'pyr_Test'};await assert.rejects(observe());
});
test('refund source accepts only the payment method in the original paid contract', async () => {
  const qrInvoice = { ...invoice, contractSnapshot: { quote: { purchaseMode: 'PROMPTPAY_ONCE' } } } as BillingInvoice;
  const charge = { payment_intent: 'pi_Test', payment_method_details: { type: 'promptpay' } };
  const stripe = { request: async (_method: string, path: string) => path === '/invoice_payments'
    ? { object: 'list', has_more: false, data: [{ id: 'inpay_Test', object: 'invoice_payment', livemode: false, status: 'paid',
        invoice: 'in_Test', payment: { type: 'payment_intent', payment_intent: 'pi_Test' }, amount_paid: 10700, currency: 'thb' }] }
    : { id: 'pi_Test', object: 'payment_intent', livemode: false, currency: 'thb', status: 'succeeded',
        customer: 'cus_Test', amount_received: 10700, latest_charge: 'ch_Test' } } as unknown as StripeClient;
  await assert.doesNotReject(assertOriginalInvoiceCharge(stripe, account, qrInvoice, charge));
  charge.payment_method_details.type = 'card';
  await assert.rejects(assertOriginalInvoiceCharge(stripe, account, qrInvoice, charge));
});
test('a PromptPay payment is refundable under its own provider ids (py_ charge, pyr_ refund); a foreign shape or charge is not',async()=>{
  const created=Math.floor(Date.now()/1000);
  for(const [mode,method,chargeId,refundId] of [['PROMPTPAY_ONCE','promptpay','py_Test','pyr_Test'],['PROMPTPAY_RENEW','promptpay','py_Test','pyr_Test'],['CARD_RENEW','card','ch_Test','re_Test']] as const){
    const acct={...account,stripeAccountId:'acct_Test'} as BillingAccount;
    const row={...invoice,billingAccountId:'account',subscriptionId:'sub_Test',providerChargeId:chargeId,currency:'THB',providerStatus:'paid',contractSnapshot:{quote:{purchaseMode:mode}}} as unknown as BillingInvoice;
    const n=note();n.refunds[0]!.refund=refundId;
    const charge:any={id:chargeId,object:'charge',livemode:false,customer:'cus_Test',currency:'thb',status:'succeeded',paid:true,captured:true,amount:10700,amount_refunded:1070,disputed:false,
      payment_intent:'pi_Test',payment_method_details:{type:method}};
    const refund:any={id:refundId,object:'refund',livemode:false,currency:'thb',amount:1070,charge:chargeId,status:'pending',created};
    const list=(data:unknown[])=>({object:'list',has_more:false,data});
    const stripe={accountId:'acct_Test',livemode:false,assertAccount:async()=>{},request:async(method:string,path:string)=>{assert.equal(method,'GET');
      if(path==='/invoices/in_Test')return {id:'in_Test',object:'invoice',livemode:false,customer:'cus_Test',parent:{subscription_details:{subscription:'sub_Test'}},currency:'thb',status:'paid',
        total:10700,amount_paid:10700,amount_remaining:0,starting_balance:0,post_payment_credit_notes_amount:1070,total_taxes:[tax(700)]};
      if(path===`/charges/${row.providerChargeId}`)return charge;
      if(path==='/invoice_payments')return list([{id:'inpay_Test',object:'invoice_payment',livemode:false,status:'paid',invoice:'in_Test',payment:{type:'payment_intent',payment_intent:'pi_Test'},amount_paid:10700,currency:'thb'}]);
      if(path==='/payment_intents/pi_Test')return {id:'pi_Test',object:'payment_intent',livemode:false,currency:'thb',status:'succeeded',customer:'cus_Test',amount_received:10700,latest_charge:chargeId};
      if(path==='/credit_notes')return list([n]);
      if(path==='/refunds')return list([refund]);
      if(path===`/refunds/${refund.id}`)return refund;
      throw new Error(path);
    }} as unknown as StripeClient;
    const source=await refundSource(stripe,acct,row);
    assert.deepEqual(source.adjustments.map(a=>[a.id,a.amountSatang,a.status]),[['cn_Test',1070,'issued'],[refundId,1070,'pending']]);
    const projection=configurationHash(refundNoteProjection(n,acct,row,source.invoice,1070));
    assert.equal((await observedRefund(stripe,acct,row,source,'command','source',1070,'คืนเงิน',projection))!.refundId,refundId);
    for(const foreign of ['xx_Test','',mode==='CARD_RENEW'?'pyr_Other':'re_Other']){
      n.refunds[0]!.refund=foreign;await assert.rejects(refundSource(stripe,acct,row),`linked ${foreign}`);await assert.rejects(observedRefund(stripe,acct,row,source,'command','source',1070,'คืนเงิน',projection));
      n.refunds[0]!.refund=refundId;refund.id=foreign;await assert.rejects(refundSource(stripe,acct,row),`listed ${foreign}`);refund.id=refundId;
    }
    refund.charge='py_Other';await assert.rejects(refundSource(stripe,acct,row),'a refund of another charge');refund.charge=chargeId;
    charge.payment_method_details.type=method==='card'?'promptpay':'card';await assert.rejects(refundSource(stripe,acct,row),'the paid contract names the method');charge.payment_method_details.type=method;
    for(const id of ['xx_Test','','py_','pi_Test'])await assert.rejects(refundSource(stripe,acct,{...row,providerChargeId:id} as BillingInvoice),`charge ${id}`);
    await assert.doesNotReject(refundSource(stripe,acct,row));
  }
});

/** Owner 2026-10-10, option "ค": which paid purchase may be refunded while it still holds the account slot, and what a proposal pins of it. */
test('unrepairableBinding: only the active attempt\'s own invoice, with a refused renewal or an advance deal at its boundary and nothing in flight',async()=>{
  const minute=60_000,ago=(m:number)=>new Date(Date.now()-m*minute).toISOString(),at=ago(5);
  const held={id:'account',activeAttemptId:'attempt',baseSubscriptionId:null},bill={billingAccountId:'account',sourceAttemptId:'attempt'};
  const deal=(endsInMinutes:number)=>({advanceDeal:{firstCycleEndsAt:new Date(Date.now()+endsInMinutes*minute).toISOString()}});
  const ask=(attempt:Record<string,unknown>|null,account:Record<string,unknown>=held,invoice:Record<string,unknown>=bill)=>
    unrepairableBinding({billingAttempt:{findUnique:async()=>attempt&&{id:'attempt',billingAccountId:'account',subscriptionId:null,quoteSnapshot:{},collectionJson:null,...attempt}}} as never,account as never,invoice as never);
  const refused={qrSubscriptionRequestedAt:ago(1),qrSubscriptionRefused:{generation:2,at,status:400,code:null}};
  // (a) the refused marker: every pass sends nothing from then on.
  assert.deepEqual(await ask({collectionJson:refused}),{kind:'RENEWAL',pin:`attempt:refused:2:${at}`});
  assert.deepEqual(await ask({quoteSnapshot:deal(9000),collectionJson:{advanceSubscriptionRefused:{generation:1,at}}}),{kind:'ADVANCE_DEAL',pin:`attempt:refused:1:${at}`});
  // Still being repaired, or not this purchase: refused as before.
  assert.equal(await ask({collectionJson:{qrSubscriptionRequestedAt:ago(600),qrSubscriptionGeneration:9}}),null,'generations go on for ever');
  assert.equal(await ask({collectionJson:null}),null);
  assert.equal(await ask({collectionJson:refused},held,{...bill,sourceAttemptId:'earlier'}),null,'another invoice of the shop');
  assert.equal(await ask({collectionJson:refused},held,{...bill,billingAccountId:'other'}),null);
  assert.equal(await ask({collectionJson:refused},{...held,activeAttemptId:null}),null,'nothing holds the slot: the ordinary refund');
  assert.equal(await ask({collectionJson:refused},{...held,baseSubscriptionId:'sub_1'}),null);
  assert.equal(await ask({collectionJson:refused,subscriptionId:'sub_1'}),null,'a subscription was bound');
  assert.equal(await ask({collectionJson:refused,quoteSnapshot:{repeat:{}}}),null,'a repeat purchase is not unwound here');
  assert.equal(await ask({collectionJson:refused,billingAccountId:'other'}),null);
  assert.equal(await ask(null),null);
  // (b) the advance deal at the pass's own boundary, once no send can be in flight.
  assert.deepEqual([advanceDealAtBoundary(deal(61)),advanceDealAtBoundary(deal(59)),advanceDealAtBoundary(deal(-5)),advanceDealAtBoundary({})],[false,true,true,false]);
  assert.deepEqual(await ask({quoteSnapshot:deal(30)}),{kind:'ADVANCE_DEAL',pin:'attempt:advance_boundary:never_sent'});
  const sent=ago(71);
  assert.deepEqual(await ask({quoteSnapshot:deal(30),collectionJson:{advanceSubscriptionRequestedAt:sent}}),{kind:'ADVANCE_DEAL',pin:`attempt:advance_boundary:${sent}`});
  assert.equal(await ask({quoteSnapshot:deal(30),collectionJson:{advanceSubscriptionRequestedAt:ago(69)}}),null,'a send of the last hour ten may still be in flight');
  assert.equal(await ask({quoteSnapshot:deal(30),collectionJson:{advanceSubscriptionRequestedAt:'not a date'}}),null);
  assert.equal(await ask({quoteSnapshot:deal(61)}),null,'before the boundary the system still binds it');
  assert.equal(await ask({quoteSnapshot:deal(30),subscriptionId:'sub_1'}),null);
  assert.equal(await ask({quoteSnapshot:{},collectionJson:{qrSubscriptionRequestedAt:ago(600)}}),null,'QR bills at their boundary end by themselves (endUnboundRenewal), not by a refund');
});
