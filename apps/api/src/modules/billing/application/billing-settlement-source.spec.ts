import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {StripeClient} from '../infrastructure/stripe.client';
import {settlementMovement,settlementPage,settlementPayout} from './billing-settlement-source';
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
