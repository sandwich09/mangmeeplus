import {test} from 'node:test';
import assert from 'node:assert/strict';
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
