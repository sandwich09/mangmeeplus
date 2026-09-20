import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingAccount,BillingInvoice} from '../../../generated/prisma/client';
import {configurationHash} from '../domain/billing-policy';
import {assertOriginalInvoiceCharge,refundNoteProjection,refundPreview,observedRefund} from './billing-refund-source';
import type {StripeClient} from '../infrastructure/stripe.client';

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
  assert.equal((await refundPreview(stripe,account,invoice,source,{amount:1070})).taxSatang,70);
  amount=100;await assert.rejects(refundPreview(stripe,account,invoice,source,{amount:1070}));amount=10700;
  await assert.rejects(refundPreview(stripe,account,invoice,{...source,charge:{disputed:false,amount_refunded:10700}},{amount:1070}));
  await assert.rejects(refundPreview(stripe,account,invoice,{...source,refunds:[{status:'pending'}]},{amount:1070}));
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
