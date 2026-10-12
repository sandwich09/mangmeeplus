import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BillingFreeDays } from './billing-free-days';
import { schedulePhase } from './billing-schedule';

function fixture() {
  const start = Math.floor(Date.now()/1000)-86400, end = start+31*86400;
  const phases = [schedulePhase(start,end,'price_zero',null),schedulePhase(end,end+31*86400,'price_paid',null,true)];
  const source:any = {after:new Date(end*1000).toISOString(),cancel:false,future:{policy:{taxRateId:null}},phases};
  const schedule:any = {status:'active',end_behavior:'release',metadata:{billingAccountId:'account',mangmeeFreeDaysOperation:'op'},
    current_phase:{start_date:start},phases:phases.map(p=>({...p,default_tax_rates:[],discounts:[],items:p.items.map(i=>({...i,tax_rates:[]}))}))};
  const sub:any={status:'active',collection_method:'charge_automatically',billing_mode:{type:'classic'},items:{has_more:false,data:[{price:'price_zero',quantity:1,tax_rates:[],current_period_start:start,current_period_end:end}]} };
  const service = new BillingFreeDays({} as any,{} as any);
  const observed=(s=sub,g=schedule)=>(service as any).observed({id:'account'},source,s,g,'op');
  return {start,end,source,schedule,sub,observed};
}

test('a gift is observed only with the exact owned zero-cost phase and next charge boundary',()=>{
  const f=fixture();assert.equal(f.observed(),true);
  const mutations:Array<(g:any)=>void>=[g=>g.phases[0].items[0].price='price_paid',g=>g.phases[0].end_date--,
    g=>g.phases[1].start_date++,g=>g.phases[1].end_date++,g=>g.phases[1].items[0].price='price_other',
    g=>g.phases[0].items[0].tax_rates=['txr_foreign'],g=>g.phases[1].billing_cycle_anchor='automatic',
    g=>g.phases[0].add_invoice_items=[{price:'price_extra'}],g=>g.default_settings={automatic_tax:{enabled:true}},
    g=>g.phases[0].items.push({price:'price_extra',quantity:1}),g=>g.metadata.mangmeeFreeDaysOperation='other',
    g=>g.metadata.billingAccountId='other',g=>g.end_behavior='cancel'];
  for(const mutate of mutations){const schedule=structuredClone(f.schedule);mutate(schedule);assert.equal(f.observed(f.sub,schedule),false);}
  assert.equal(f.observed({...f.sub,pause_collection:{behavior:'void'}}),false);
  assert.equal(f.observed({...f.sub,items:{...f.sub.items,has_more:true}}),false);
});

test('gift observation preserves cancellation and accepts an exactly ended original schedule',()=>{
  const f=fixture();f.source.cancel=true;f.source.phases=f.source.phases.slice(0,1);f.schedule.phases=f.schedule.phases.slice(0,1);f.schedule.end_behavior='cancel';
  f.sub.cancel_at=f.end;assert.equal(f.observed(),true);
  f.sub.cancel_at=f.end-1;assert.equal(f.observed(),false);
  const ended=Math.floor(Date.now()/1000)-3600;f.source.after=new Date(ended*1000).toISOString();
  f.source.phases[0].end_date=ended;f.schedule.phases[0].end_date=ended;f.schedule.status='completed';f.schedule.current_phase=null;
  f.sub.items.data[0].current_period_start=ended-86400;f.sub.items.data[0].current_period_end=ended;
  f.source.phases[0].start_date=ended-86400;f.schedule.phases[0].start_date=ended-86400;
  f.sub.status='canceled';f.sub.ended_at=ended;f.sub.cancel_at=null;assert.equal(f.observed(),true);
  f.sub.ended_at--;assert.equal(f.observed(),false);
});
