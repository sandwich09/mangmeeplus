import assert from 'node:assert/strict';
import {test} from 'node:test';
import {currentCapacityOverride,effectivePlanCapacity} from './plan-capacity';
import {termProjectionHash} from '../../../billing/domain/paid-invoice';
const now=new Date('2026-09-15T00:00:00.000Z'),end=new Date('2026-10-15T00:00:00.000Z');
const baseline={tierKey:'BASIC_499',branchLimit:2,employeeLimit:5,monthlySlipLimit:50,billingReceiptAccountId:'local-account',termEndsAt:end};
const override={operationId:'11111111-1111-4111-8111-111111111111',accountId:'local-account',tierKey:'PRO_999',branchLimit:5,employeeLimit:10,
  effectiveAt:now.toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString()};
test('temporary capacity expires at the exact instant without changing purchased evidence or receipt allowance',()=>{
  const row={...baseline,capacityOverride:override};
  assert.equal(effectivePlanCapacity(row,now).branchLimit,5);
  assert.deepEqual(effectivePlanCapacity(row,new Date(override.expiresAt)),{tierKey:'BASIC_499',branchLimit:2,employeeLimit:5});
  assert.equal(termProjectionHash(row),termProjectionHash(baseline));assert.equal(row.monthlySlipLimit,50);
});
test('expiry and revocation expose the latest paid baseline; repurchase never extends the gift',()=>{
  const upgraded={...baseline,tierKey:'PRO_999',branchLimit:5,employeeLimit:10,termEndsAt:new Date('2027-10-15T00:00:00.000Z'),capacityOverride:{...override,tierKey:'STARTER_249',branchLimit:1,employeeLimit:2}};
  assert.equal(effectivePlanCapacity(upgraded,now).branchLimit,1);
  assert.equal(effectivePlanCapacity(upgraded,new Date(override.expiresAt)).branchLimit,5);
  assert.equal(effectivePlanCapacity({...upgraded,capacityOverride:null},now).branchLimit,5);
});
test('foreign, malformed, future, held and expired sources never activate temporary limits',()=>{
  for(const capacityOverride of [[],true,{...override,extra:1},{...override,accountId:'foreign'},{...override,tierKey:'FREE_TRIAL_15'},
    {...override,branchLimit:2147483648},{...override,employeeLimit:0},{...override,operationId:'not-an-operation'},
    {...override,effectiveAt:'2026-09-16T00:00:00.000Z'},{...override,expiresAt:'invalid'}])assert.equal(currentCapacityOverride({...baseline,capacityOverride},now),null);
  assert.equal(currentCapacityOverride({...baseline,capacityOverride:override,termDisabledAt:now},now),null);
  assert.equal(currentCapacityOverride({...baseline,capacityOverride:override,termEndsAt:now},now),null);
});
