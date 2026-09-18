import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {aiAdjustmentDetails} from './partner-ai-adjustment-history';

test('history exposes only supported scalar changes, source and a bounded reason',()=>{
  assert.deepEqual(aiAdjustmentDetails({source:'ADMIN_ADJUSTMENT',reason:'เพิ่มให้ร้าน',fromMonthlyBudgetSatang:null,toMonthlyBudgetSatang:12000,
    fromEnabled:true,toEnabled:false,fromModelId:'same',toModelId:'same',apiToken:'never-expose',providerPayload:{secret:true}}),{
    source:'ADMIN_ADJUSTMENT',reason:'เพิ่มให้ร้าน',changes:[{field:'monthlyBudgetSatang',before:null,after:12000},{field:'enabled',before:true,after:false}],
  });
});
test('missing or malformed historical values are not invented or copied as raw metadata',()=>{
  for(const input of [null,[],{}, {source:'STRIPE',reason:' ',fromMonthlyBudgetSatang:{secret:true},toMonthlyBudgetSatang:100},
    {reason:'x'.repeat(501),fromMonthlyLimit:-1,toMonthlyLimit:10}, {fromModelId:'x'.repeat(201),toModelId:'model'}]){
    assert.deepEqual(aiAdjustmentDetails(input),{source:'LEGACY_ADMIN',reason:null,changes:[]});
  }
});
// Hold reconciliation (hold spec §4.2): the three operator decisions become rows in the SAME
// history card, so a status transition and a breach acknowledgement each read as a before/after
// pair with the reason beside them.
test('an operator hold decision renders as one status or breach transition',()=>{
  assert.deepEqual(aiAdjustmentDetails({source:'ADMIN_ADJUSTMENT',reason:'ปล่อยคืนหลังตรวจกับผู้ให้บริการ',
    reservationId:'res-1',monthKey:'2026-09',bucket:'OCR',stepKind:'receipt-ocr',releasedSatang:47,proof:'operator_released',
    fromCreditHoldStatus:'UNRESOLVED',toCreditHoldStatus:'CANCELLED'}),{
    source:'ADMIN_ADJUSTMENT',reason:'ปล่อยคืนหลังตรวจกับผู้ให้บริการ',
    changes:[{field:'creditHoldStatus',before:'UNRESOLVED',after:'CANCELLED'}],
  });
  assert.deepEqual(aiAdjustmentDetails({source:'ADMIN_ADJUSTMENT',reason:'รับทราบแล้ว',
    fromCreditBreachAcknowledged:false,toCreditBreachAcknowledged:true}),{
    source:'ADMIN_ADJUSTMENT',reason:'รับทราบแล้ว',
    changes:[{field:'creditBreachAcknowledged',before:false,after:true}],
  });
});
test('the three operator actions are read into the same history list as the cap edits',()=>{
  const source=readFileSync(join(__dirname,'partner-ai-adjustment-history.ts'),'utf8');
  for(const action of ['ai.credit_hold.released','ai.credit_hold.charged_at_bound','ai.credit_breach.acknowledged']){
    assert.ok(source.includes(`'${action}'`),`${action} must be in ACTIONS or the history hides it`);
  }
});
