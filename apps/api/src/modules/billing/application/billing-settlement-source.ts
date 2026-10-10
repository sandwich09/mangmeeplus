import { stripeId, StripeRequestError, type StripeClient, type StripeObject } from '../infrastructure/stripe.client';

const invalid=()=>new StripeRequestError('REJECTED','settlement_source_invalid');
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value);
const timestamp=(value:unknown):value is number=>integer(value)&&value>=0&&Number.isFinite(new Date(value*1000).getTime());
const nativeId=(value:unknown,prefix:string):value is string=>typeof value==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,120}$`).test(value);
export type SettlementMovement={id:string;sourceId:string|null;type:string;category:string;currency:string;amount:number;fee:number;net:number;
  status:'pending'|'available';created:number;availableOn:number;balanceType:string|null};

/** Stripe books a non-card (PromptPay) payment as `payment` and its refund as `payment_refund`; they are read as the card movements are. */
const movementType:Record<string,string>={payment:'charge',payment_refund:'refund'};
/** Stripe balance movements do not have a documented livemode field. The caller verifies the account and source. */
export function settlementMovement(value:StripeObject):SettlementMovement{
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
  const sourceId=stripeId(value.source);
  if(value.object!=='balance_transaction'||!nativeId(value.id,'txn')||!integer(value.amount)||!integer(value.fee)||!integer(value.net)||
    !Number.isSafeInteger(value.amount-value.fee)||value.net!==value.amount-value.fee||!timestamp(value.created)||!timestamp(value.available_on)||
    typeof value.currency!=='string'||!/^[a-z]{3}$/.test(value.currency)||!['pending','available'].includes(value.status)||
    typeof value.type!=='string'||!/^[a-z_]{1,80}$/.test(value.type)||typeof value.reporting_category!=='string'||!/^[a-z_]{1,80}$/.test(value.reporting_category)||
    (value.source!=null&&(!sourceId||!/^[a-z]+_[A-Za-z0-9_]{1,120}$/.test(sourceId)))||
    (value.balance_type!=null&&(typeof value.balance_type!=='string'||!/^[a-z_]{1,80}$/.test(value.balance_type))))throw invalid();
  return {id:value.id,sourceId,type:movementType[value.type]??value.type,category:value.reporting_category,currency:value.currency,amount:value.amount,fee:value.fee,net:value.net,
    status:value.status,created:value.created,availableOn:value.available_on,balanceType:value.balance_type??null};
}
export function settlementPage(value:StripeObject,window:{since:number;until:number},cursor:string|null){
  if(!value||value.object!=='list'||!Array.isArray(value.data)||value.data.length>100||typeof value.has_more!=='boolean'||(value.has_more&&!value.data.length))throw invalid();
  const rows: SettlementMovement[]=value.data.map((item:StripeObject)=>settlementMovement(item));
  if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>r.id===cursor||r.created<window.since||r.created>=window.until))throw invalid();
  return {rows,hasMore:value.has_more as boolean,nextCursor:value.has_more?rows.at(-1)!.id:null};
}
export type SettlementPayout={status:'paid'|'pending'|'in_transit'|'canceled'|'failed';arrivalAt:number;automatic:boolean;
  reconciliation:'MATCHED'|'PENDING'|'MANUAL'|'INCOMPLETE'|'FAILED';reconciliationStatus:string;amount:number;constituentCount:number|null};

/** Observe one original payout; this is neither a payout command nor independent bank confirmation. */
export async function settlementPayout(stripe:StripeClient,movement:SettlementMovement):Promise<SettlementPayout>{
  if(!nativeId(movement.sourceId,'po')||!['payout','payout_failure','payout_cancel'].includes(movement.type))throw invalid();
  const p=await stripe.request('GET',`/payouts/${movement.sourceId}`);
  if(!p||p.object!=='payout'||p.id!==movement.sourceId||p.livemode!==stripe.livemode||p.currency!==movement.currency||!integer(p.amount)||p.amount<1||
    !['paid','pending','in_transit','canceled','failed'].includes(p.status)||!timestamp(p.arrival_date)||typeof p.automatic!=='boolean'||
    !['standard','instant'].includes(p.method)||!['completed','in_progress','not_applicable'].includes(p.reconciliation_status)||
    movement.amount!==(movement.type==='payout'?-p.amount:p.amount)||
    stripeId(movement.type==='payout'?p.balance_transaction:p.failure_balance_transaction)!==movement.id||
    (movement.type==='payout_failure'&&p.status!=='failed')||(movement.type==='payout_cancel'&&p.status!=='canceled'))throw invalid();
  const result:SettlementPayout={status:p.status,arrivalAt:p.arrival_date,automatic:p.automatic,reconciliationStatus:p.reconciliation_status,amount:p.amount,
    reconciliation:['failed','canceled'].includes(p.status)?'FAILED':!p.automatic||p.method!=='standard'||p.reconciliation_status==='not_applicable'?'MANUAL':'PENDING',constituentCount:null};
  if(result.reconciliation==='MANUAL'||p.reconciliation_status!=='completed'||p.status!=='paid'||movement.type!=='payout')return result;
  const ids=new Set<string>();let cursor:string|undefined,total=0n;
  // One payout can contain many payments; never call a bounded prefix a reconciled total.
  for(let page=0;page<5;page++){
    const value=await stripe.request('GET','/balance_transactions',{payout:p.id,limit:100,...cursor?{starting_after:cursor}:{}});
    if(!value||value.object!=='list'||!Array.isArray(value.data)||value.data.length>100||typeof value.has_more!=='boolean'||(value.has_more&&!value.data.length))throw invalid();
    for(const item of value.data){
      const row=settlementMovement(item);
      if(ids.has(row.id)||row.id===movement.id||row.currency!==movement.currency||row.status!=='available'||row.type==='payout'||(row.balanceType&&row.balanceType!=='payments'))throw invalid();
      ids.add(row.id);total+=BigInt(row.net);
    }
    if(!value.has_more){if(total!==BigInt(p.amount))throw invalid();return {...result,reconciliation:'MATCHED',constituentCount:ids.size};}
    cursor=value.data.at(-1)!.id;
  }
  return {...result,reconciliation:'INCOMPLETE',constituentCount:ids.size};
}
