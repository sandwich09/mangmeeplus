import assert from 'node:assert/strict';
import {receiptAdoption,ratio,rankCompanies,spendConcentration} from './executive-analytics';
const rows=(values:(number|null)[])=>values.map((value,i)=>({id:String(i+1).padStart(3,'0'),value}));
const result=(values:(number|null)[])=>spendConcentration(rows(values),x=>x.value);
assert.equal(ratio(40,72)?.toFixed(1),'55.6');assert.equal(ratio(32,72)?.toFixed(1),'44.4');assert.equal(ratio(0,0),null);
assert.deepEqual([0,1,null].map(receiptAdoption),['NEVER','EVER','UNKNOWN']);
assert.deepEqual(rankCompanies([{id:'b',v:3},{id:'d',v:null},{id:'c',v:0},{id:'a',v:3}],x=>x.v).map(x=>x.id),['a','b','c','d']);
for(const [n,k] of [[0,0],[1,1],[4,1],[5,1],[6,2],[72,15]]){const p=result(Array(n).fill(1));assert.equal(p.targetCount,k);}
const p=result([80,20]);assert(p.ready);assert.equal(p.to80.length,1);assert.equal(p.prefixShare,80);assert.equal(p.topShare,80);
const below=result([79,21]);assert(below.ready);assert.equal(below.to80.length,2);
for(const amounts of [[],[0,0],[-20,-10],[0,-99]]){const a=result(amounts);assert(a.ready);assert.equal(a.topShare,null);assert.equal(a.top.length,0);assert.equal(a.to80.length,0);}
const mixed=result([100,50,-50,0]);assert(mixed.ready);assert.equal(mixed.positiveTotal,150);assert.equal(mixed.signedTotal,100);assert.equal(mixed.negativeTotal,-50);assert.equal(mixed.rest.length,3);assert.equal(mixed.topShare,100/150*100);
const missing=result([100,null]);assert.equal(missing.ready,false);
const tied=result([10,10,10,10,10,10]);assert(tied.ready);assert.deepEqual(tied.top.map(c=>c.id),['001','002']);assert.equal(tied.to80.length,5);
const few=result([90,0,0,0,0,0,0,0,0,0]);assert(few.ready);assert.equal(few.targetCount,2);assert.equal(few.top.length,1);assert.equal(few.rest.length,9);
const decimalBoundary=result([8000,2000]);assert(decimalBoundary.ready);assert.equal(decimalBoundary.to80.length,1);
console.log('PASS: receipt 40/72 and 32/72, unknown/zero, null-last and ties, Top20 rounding N0/1/4/5/6/72, exact/below80, zero/refunded/negative/mixed net, incomplete cash, few payers; pure local math only.');
