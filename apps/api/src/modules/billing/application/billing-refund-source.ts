import type { BillingAccount, BillingInvoice, Prisma } from '../../../generated/prisma/client';
import type { BillingAdjustmentItem } from '@watchdog-bms/contracts';
import { billingError, configurationHash } from '../domain/billing-policy';
import { stripeId, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';
import { originalInvoice, adjustment, chargeIdPrefix, refundIdPrefix } from './billing-invoice-details';
import { assertMappedCharge } from './billing-financial';
import type { BillingSnapshot } from './billing.service';

export const refundReviewRequired=()=>billingError('CONTROL_REFUND_SOURCE_CHANGED','หลักฐานการคืนเงินเปลี่ยนหรือยังไม่ครบ กรุณาตรวจรายการเดิมอีกครั้ง');
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export const nativeId=(v:unknown,prefix:string):v is string=>typeof v==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,120}$`).test(v);

/** A retained unknown create blocks another mutation; a verified issued note only needs observation.
 *  A request never sent to the provider holds nothing once it has expired: `current` refuses to dispatch it, so nothing is in flight. */
export async function pendingRefund(tx:Prisma.TransactionClient,account:Pick<BillingAccount,'companyId'|'stripeAccountId'|'livemode'>,except?:string) {
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BillingOperation" WHERE "companyId"=${account.companyId}
    AND "stripeAccountId"=${account.stripeAccountId} AND livemode=${account.livemode} AND type='REFUND'
    AND state IN ('QUEUED','RUNNING','UNKNOWN','BLOCKED') AND id<>${except??''}
    AND (state IN ('RUNNING','UNKNOWN') OR "resultJson"->>'dispatchedAt' IS NOT NULL OR "expiresAt">${new Date()})
    AND COALESCE("resultJson"->>'mutationResolved','false')<>'true' ORDER BY "createdAt",id LIMIT 1`;
  return rows[0]??null;
}
export async function assertNoPendingRefund(tx:Prisma.TransactionClient,account:Pick<BillingAccount,'companyId'|'stripeAccountId'|'livemode'>) {
  if(await pendingRefund(tx,account))throw billingError('BILLING_REFUND_PENDING','มีคำขอคืนเงินเดิมที่ยังต้องตรวจสอบ กรุณาติดต่อทีมงานก่อนทำรายการใหม่');
}

/** 2026-10-10 (P-5): a refund stops the repair of a paid purchase's subscription binding. True when the invoice of this attempt
 *  shows refunded money, or a refund request exists for it in any state but cancelled or failed (a failed one moved no money, or
 *  the refunded amount above shows it). As in `pendingRefund`, a request never sent holds nothing once it has expired. */
export async function refundStopsBinding(tx:Prisma.TransactionClient,account:Pick<BillingAccount,'id'|'companyId'|'stripeAccountId'|'livemode'>,attemptId:string) {
  const invoice=await tx.billingInvoice.findUnique({where:{sourceAttemptId:attemptId},select:{id:true,billingAccountId:true,refundedSatang:true}});
  if(!invoice||invoice.billingAccountId!==account.id)return false;
  if(invoice.refundedSatang)return true;
  const rows=await tx.billingOperation.findMany({where:{companyId:account.companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode,
    type:'REFUND',referenceId:invoice.id,state:{notIn:['CANCELLED','FAILED']}},select:{state:true,expiresAt:true,resultJson:true}});
  return rows.some(row=>!['PREVIEW','AWAITING_APPROVAL','QUEUED','BLOCKED'].includes(row.state)||row.expiresAt>new Date()||!!(row.resultJson as {dispatchedAt?:string}|null)?.dispatchedAt);
}

/** Bounded complete pages, including empty-list and cross-page duplicate/cycle validation. */
async function completeList(stripe:StripeClient,path:string,params:Record<string,unknown>,prefix:string) {
  const all:StripeObject[]=[],ids=new Set<string>();let cursor:string|undefined;
  for(let page=0;page<5;page++){
    const result=await stripe.request('GET',path,{...params,limit:100,...cursor?{starting_after:cursor}:{}});
    if(result.object!=='list'||!Array.isArray(result.data)||result.data.length>100||typeof result.has_more!=='boolean'||(result.has_more&&!result.data.length))throw refundReviewRequired();
    for(const item of result.data){if(!item||!nativeId(item.id,prefix)||ids.has(item.id))throw refundReviewRequired();ids.add(item.id);all.push(item);}
    if(!result.has_more)return all;cursor=all.at(-1)!.id;
  }
  throw refundReviewRequired();
}

/** How the invoice was paid, from the purchase its own snapshot records: the provider refunds a PromptPay payment differently from a card. */
export const invoicePaymentMethod=(row:Pick<BillingInvoice,'contractSnapshot'>)=>
  (row.contractSnapshot as unknown as BillingSnapshot|null)?.quote.purchaseMode?.startsWith('PROMPTPAY')?'promptpay' as const:'card' as const;

/** Verify the native invoice-payment-intent-charge chain shared by refund and settlement reads. */
export async function assertOriginalInvoiceCharge(stripe:StripeClient,account:BillingAccount,row:BillingInvoice,charge:StripeObject){
  const payments=await completeList(stripe,'/invoice_payments',{invoice:row.providerInvoiceId},'inpay');
  if(payments.length!==1)throw refundReviewRequired();const payment=payments[0]!,intentId=stripeId(payment.payment?.payment_intent);
  if(payment.object!=='invoice_payment'||payment.livemode!==account.livemode||payment.status!=='paid'||stripeId(payment.invoice)!==row.providerInvoiceId||
    payment.payment?.type!=='payment_intent'||!nativeId(intentId,'pi')||payment.amount_paid!==row.paidSatang||payment.currency!=='thb')throw refundReviewRequired();
  const intent=await stripe.request('GET',`/payment_intents/${intentId}`);
  const paymentMethod=invoicePaymentMethod(row);
  if(intent.id!==intentId||intent.object!=='payment_intent'||intent.livemode!==account.livemode||intent.currency!=='thb'||intent.status!=='succeeded'||
    stripeId(intent.customer)!==account.customerId||intent.amount_received!==row.paidSatang||stripeId(intent.latest_charge)!==row.providerChargeId||
    stripeId(charge.payment_intent)!==intent.id||charge.payment_method_details?.type!==paymentMethod)throw refundReviewRequired();
}

export async function refundSource(stripe:StripeClient,account:BillingAccount,row:BillingInvoice) {
  if(row.currency!=='THB'||row.providerStatus!=='paid'||!integer(row.paidSatang)||row.paidSatang===0||row.paidSatang!==row.totalSatang||!nativeId(row.providerChargeId,chargeIdPrefix))throw refundReviewRequired();
  const invoice=await originalInvoice(stripe,account,row),charge=await stripe.request('GET',`/charges/${row.providerChargeId}`);
  assertMappedCharge(charge,account,row);
  if(invoice.object!=='invoice'||invoice.amount_remaining!==0||invoice.starting_balance!==0||invoice.paid_out_of_band===true||
    (invoice.pre_payment_credit_notes_amount??0)!==0||!integer(invoice.post_payment_credit_notes_amount??0)||(invoice.amount_overpaid??0)!==0)throw refundReviewRequired();
  await assertOriginalInvoiceCharge(stripe,account,row,charge);
  const notes=await completeList(stripe,'/credit_notes',{invoice:row.providerInvoiceId},'cn'),refunds=await completeList(stripe,'/refunds',{charge:row.providerChargeId},refundIdPrefix);
  const adjustments=[...notes.map(n=>adjustment(n,'credit-notes',account,row)),...refunds.map(r=>adjustment(r,'refunds',account,row))].sort((a,b)=>a.id.localeCompare(b.id));
  const issued=notes.filter(n=>n.status==='issued');
  if((invoice.post_payment_credit_notes_amount??0)>row.paidSatang||issued.reduce((s,n)=>s+n.amount,0)>row.paidSatang||
    refunds.filter(r=>!['failed','canceled'].includes(r.status)).reduce((s,r)=>s+r.amount,0)>row.paidSatang)throw refundReviewRequired();
  for(const n of issued){
    if(n.type!=='post_payment'||!Array.isArray(n.refunds))throw refundReviewRequired();const seen=new Set<string>();let linkedAmount=0;
    for(const linked of n.refunds){const id=stripeId(linked.refund),r=refunds.find(r=>r.id===id);
      if(!nativeId(id,refundIdPrefix)||seen.has(id)||!r||!integer(linked.amount_refunded)||linked.amount_refunded<1||linked.amount_refunded>r.amount||linked.payment_record_refund!=null||
        (linked.type!=null&&linked.type!=='refund'))throw refundReviewRequired();seen.add(id);linkedAmount+=linked.amount_refunded;
    }
    if(linkedAmount>n.amount)throw refundReviewRequired();
  }
  const financial={invoice:row.providerInvoiceId,charge:row.providerChargeId,customer:account.customerId,paid:row.paidSatang,
    refunded:charge.amount_refunded,disputed:charge.disputed,credited:invoice.post_payment_credit_notes_amount??0,
    taxes:invoice.total_taxes??[],adjustments:adjustments.map(a=>[a.id,a.amountSatang,a.status]),
    noteRefunds:notes.map(n=>[n.id,n.refunds??null,n.customer_balance_transaction??null,n.out_of_band_amount??0]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))};
  return {invoice,charge,notes,refunds,adjustments,sourceHash:configurationHash(financial)};
}

function taxes(value:unknown) {
  if(!Array.isArray(value)||value.length>20)throw refundReviewRequired();
  return value.map((t:StripeObject)=>{
    if(!t||!integer(t.amount)||!['inclusive','exclusive'].includes(t.tax_behavior)||t.type!=='tax_rate_details'||!nativeId(t.tax_rate_details?.tax_rate,'txr'))throw refundReviewRequired();
    return {amount:t.amount,rate:t.tax_rate_details.tax_rate as string,behavior:t.tax_behavior as string};
  });
}
export function refundNoteProjection(note:StripeObject,account:BillingAccount,row:BillingInvoice,invoice:StripeObject,amount:number) {
  if(!note||note.object!=='credit_note'||note.livemode!==account.livemode||note.currency!=='thb'||stripeId(note.invoice)!==row.providerInvoiceId||
    stripeId(note.customer)!==account.customerId||note.amount!==amount||note.total!==amount||note.type!=='post_payment'||note.pre_payment_amount!==0||note.post_payment_amount!==amount||
    note.status!=='issued'||note.customer_balance_transaction!=null||(note.out_of_band_amount??0)!==0||note.amount_shipping!==0||
    (note.discount_amount??0)!==0||(note.discount_amounts?.length??0)!==0||!integer(note.total_excluding_tax)||note.total_excluding_tax>amount||
    note.lines?.object!=='list'||note.lines.has_more!==false||!Array.isArray(note.lines.data)||note.lines.data.length<1||note.lines.data.length>25)throw refundReviewRequired();
  const original=taxes(invoice.total_taxes??[]),tax=taxes(note.total_taxes??[]),sum=tax.reduce((s,t)=>s+t.amount,0);
  if(sum!==amount-note.total_excluding_tax||sum>row.taxSatang||original.reduce((s,t)=>s+t.amount,0)!==row.taxSatang||
    tax.some(t=>!original.some(o=>o.rate===t.rate&&o.behavior===t.behavior)))throw refundReviewRequired();
  const ids=new Set<string>();
  const lines=note.lines.data.map((line:StripeObject)=>{
    if(!line||line.object!=='credit_note_line_item'||line.livemode!==account.livemode||line.type!=='invoice_line_item'||
      !nativeId(line.invoice_line_item,'il')||ids.has(line.invoice_line_item)||!integer(line.amount)||line.amount>amount||
      (line.discount_amount??0)!==0||(line.discount_amounts?.length??0)!==0)throw refundReviewRequired();
    ids.add(line.invoice_line_item);return {invoiceLineId:line.invoice_line_item,amount:line.amount,taxes:taxes(line.taxes??[])};
  }).sort((a:{invoiceLineId:string},b:{invoiceLineId:string})=>a.invoiceLineId.localeCompare(b.invoiceLineId));
  if(lines.reduce((s:number,l:{amount:number})=>s+l.amount,0)+tax.filter(t=>t.behavior==='exclusive').reduce((s,t)=>s+t.amount,0)!==amount)throw refundReviewRequired();
  const grouped=(items:ReturnType<typeof taxes>)=>Object.fromEntries([...new Set(items.map(t=>`${t.rate}:${t.behavior}`))].sort().map(key=>[key,items.filter(t=>`${t.rate}:${t.behavior}`===key).reduce((s,t)=>s+t.amount,0)]));
  if(configurationHash(grouped(lines.flatMap((l:{taxes:ReturnType<typeof taxes>})=>l.taxes)))!==configurationHash(grouped(tax)))throw refundReviewRequired();
  return {amountSatang:amount,taxSatang:sum,totalExcludingTax:note.total_excluding_tax,lines,taxes:tax};
}

/** Live 2026-08-26.dahlia rejects `credit_amount: 0` and previews an amount-only note with no lines, so a refund names the
 *  original invoice lines: the amount fills them in id order, each capped by what issued notes have not credited yet.
 *  ponytail: line amounts exclude exclusive VAT, so such a note over-credits and refundNoteProjection fails it closed;
 *  allocate pre-tax amounts if EXCLUSIVE_VAT_7 refunds are ever needed in-app. */
export async function refundParams(stripe:StripeClient,account:BillingAccount,row:BillingInvoice,source:Awaited<ReturnType<typeof refundSource>>,
  operationId:string,amount:number,memo:string,notifyCustomer:boolean) {
  const credited=new Map<string,number>();
  for(const n of source.notes.filter(n=>n.status==='issued')){
    const embedded=n.lines?.object==='list'&&n.lines.has_more===false&&Array.isArray(n.lines.data)?n.lines.data as StripeObject[]:null;
    for(const l of embedded??await completeList(stripe,`/credit_notes/${n.id}/lines`,{},'cnli')){
      if(!l||l.object!=='credit_note_line_item'||l.type!=='invoice_line_item'||!nativeId(l.invoice_line_item,'il')||!integer(l.amount))throw refundReviewRequired();
      credited.set(l.invoice_line_item,(credited.get(l.invoice_line_item)??0)+l.amount);
    }
  }
  const lines:{type:'invoice_line_item';invoice_line_item:string;amount:number}[]=[];let left=amount;
  for(const o of (await completeList(stripe,`/invoices/${row.providerInvoiceId}/lines`,{},'il')).sort((a,b)=>a.id.localeCompare(b.id))){
    if(o.livemode!==account.livemode||o.currency!=='thb'||!Number.isSafeInteger(o.amount))throw refundReviewRequired();
    const take=Math.min(left,o.amount-(credited.get(o.id)??0));
    if(take>0){lines.push({type:'invoice_line_item',invoice_line_item:o.id,amount:take});left-=take;}
  }
  if(left!==0)throw refundReviewRequired();
  return {invoice:row.providerInvoiceId,lines,refund_amount:amount,out_of_band_amount:0,email_type:notifyCustomer?'credit_note':'none',...memo?{memo}:{},
    metadata:{billingRefundOperationId:operationId,billingAccountId:account.id,billingSourceHash:source.sourceHash}};
}

export async function refundPreview(stripe:StripeClient,account:BillingAccount,row:BillingInvoice,source:Awaited<ReturnType<typeof refundSource>>,params:Record<string,unknown>) {
  if(!integer(params.refund_amount)||Number(params.refund_amount)<1||Number(params.refund_amount)>row.paidSatang-source.charge.amount_refunded||source.charge.disputed||source.refunds.some(r=>!['succeeded','failed','canceled'].includes(r.status))||
    source.notes.some(n=>n.status==='issued'&&(n.customer_balance_transaction!=null||(n.out_of_band_amount??0)!==0)))throw refundReviewRequired();
  let note:StripeObject;
  try{note=await stripe.request('GET','/credit_notes/preview',params);}catch{throw refundReviewRequired();}
  const projection=refundNoteProjection(note,account,row,source.invoice,params.refund_amount as number);
  const originalLines=await completeList(stripe,`/invoices/${row.providerInvoiceId}/lines`,{},'il');
  if(projection.lines.some((line:{invoiceLineId:string;amount:number})=>!originalLines.some(original=>original.id===line.invoiceLineId&&original.livemode===account.livemode&&original.currency==='thb'&&integer(original.amount)&&original.amount>=line.amount)))throw refundReviewRequired();
  return projection;
}

/** Positive discovery is authoritative even after the write gate or staff access is withdrawn. */
export async function observedRefund(stripe:StripeClient,account:BillingAccount,row:BillingInvoice,source:Awaited<ReturnType<typeof refundSource>>,
  operationId:string,sourceHash:string,amount:number,memo:string,projectionHash:string,knownNoteId?:string) {
  const matches=source.notes.filter(n=>n.metadata?.billingRefundOperationId===operationId);
  if(matches.length>1)throw refundReviewRequired();
  if(!matches.length){if(knownNoteId)throw refundReviewRequired();return null;}
  const note=matches[0]!;
  if((knownNoteId&&note.id!==knownNoteId)||note.metadata?.billingAccountId!==account.id||note.metadata?.billingSourceHash!==sourceHash||
    (note.memo??'')!==memo||configurationHash(refundNoteProjection(note,account,row,source.invoice,amount))!==projectionHash||
    !Array.isArray(note.refunds)||note.refunds.length!==1)throw refundReviewRequired();
  const linked=note.refunds[0]!,id=stripeId(linked.refund);
  if(!nativeId(id,refundIdPrefix)||linked.amount_refunded!==amount||linked.payment_record_refund!=null||(linked.type!=null&&linked.type!=='refund'))throw refundReviewRequired();
  const refund=await stripe.request('GET',`/refunds/${id}`),view=adjustment(refund,'refunds',account,row);
  if(view.id!==id||view.amountSatang!==amount||!source.refunds.some(r=>r.id===id&&r.amount===amount))throw refundReviewRequired();
  return {creditNoteId:note.id as string,creditNoteNumber:note.number as string,refundId:id,refundState:view.status as BillingAdjustmentItem['status']};
}
