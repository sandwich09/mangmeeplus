import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingOffer, type BillingCapacityOptions } from '@watchdog-bms/contracts';
import { capacityValid, parseCapacitySelection, purchasedCapacityOffer } from './billing-capacity';
import { termProjectionHash } from '../domain/paid-invoice';
import type { BillingAccount, CompanyPlanTerm } from '../../../generated/prisma/client';

test('continuing purchases preserve paid capacity, accept increases and never convert temporary gifts to purchased rights',()=>{
  const now=new Date('2030-01-01T00:00:00Z'),end=new Date('2030-12-31T00:00:00Z');
  const term={companyId:'company',tierKey:'PRO_999',branchLimit:6,employeeLimit:20,monthlySlipLimit:100,
    termStartAt:now,termEndsAt:end,termDisabledAt:null,billingReceiptAccountId:'account',
    capacityOverride:{branchLimit:100,employeeLimit:100}} as unknown as CompanyPlanTerm;
  const account={id:'account',companyId:'company',paidThrough:end,termProjectionHash:termProjectionHash(term)} as BillingAccount;
  const offer=billingOffer('PRO_999','year'),preserved=purchasedCapacityOffer(offer,term,account,now);
  assert.equal(preserved.branchLimit,6);assert.equal(preserved.employeeLimit,20);assert.equal(preserved.receiptAllowance,1200);
  assert.deepEqual(purchasedCapacityOffer({...offer,branchLimit:8,employeeLimit:30},term,account,now),{...offer,branchLimit:8,employeeLimit:30});
  const upgradeTerm={...term,tierKey:'BASIC_499'},upgradeAccount={...account,termProjectionHash:termProjectionHash(upgradeTerm)};
  assert.equal(purchasedCapacityOffer(offer,upgradeTerm,upgradeAccount,now).branchLimit,6);
  const downgrade=billingOffer('BASIC_499','year');assert.deepEqual(purchasedCapacityOffer(downgrade,term,account,now),downgrade);
  for(const invalid of [null,{...account,companyId:'foreign'},{...account,id:'other'},{...account,termProjectionHash:'stale'},
    {...account,paidThrough:now}])assert.deepEqual(purchasedCapacityOffer(offer,term,invalid,now),offer);
  assert.deepEqual(purchasedCapacityOffer(offer,{...term,termEndsAt:now},account,now),offer);
  assert.deepEqual(purchasedCapacityOffer(offer,null,account,now),offer);
});

const options: BillingCapacityOptions = { companyId: 'company', offerKey: 'STARTER_249', interval: 'year', sourceHash: 'a'.repeat(64), branchLimit: 1, employeeLimit: 2, overCapacity: true,
  branches: [{ id: 'hq', name: 'HQ', headOffice: true, required: true, openReimbursements: 0 }, { id: 'old', name: 'Old', headOffice: false, required: false, openReimbursements: 0 }],
  memberships: [{ id: 'owner', name: 'Owner', owner: true, required: true, allBranches: true, branchIds: [], defaultBranchId: null },
    { id: 'staff', name: 'Staff', owner: false, required: false, allBranches: false, branchIds: ['old'], defaultBranchId: 'old' }] };
const selection = { sourceHash: options.sourceHash, branchIds: ['hq'], memberships: [{ id: 'owner', defaultBranchId: null }] };
test('selection refuses stale, cross-company, duplicate, missing OWNER/head office and implicit scope widening', () => {
  assert.equal(capacityValid(options, selection), true);
  for (const invalid of [{ ...selection, sourceHash: 'b'.repeat(64) }, { ...selection, branchIds: ['foreign'] }, { ...selection, branchIds: ['old'] },
    { ...selection, memberships: [] }, { ...selection, branchIds: ['hq', 'old'] }, { ...selection, memberships: [...selection.memberships, { id: 'staff', defaultBranchId: 'hq' }] },
    { ...selection, memberships: [...selection.memberships, { id: 'staff', defaultBranchId: null }] }]) assert.equal(capacityValid(options, invalid), false);
  assert.throws(() => parseCapacitySelection({ ...selection, branchIds: ['hq', 'hq'] }));
  assert.throws(() => parseCapacitySelection({ ...selection, companyId: 'foreign' }));
  assert.throws(() => parseCapacitySelection({ ...selection, memberships: [{ id: 'owner', defaultBranchId: null, role: 'OWNER' }] }));
});
test('existing pending work must remain and limited users may only keep a currently authorized retained branch', () => {
  const open = structuredClone(options); open.branches[1]!.required = true; open.branches[1]!.openReimbursements = 1;
  assert.equal(capacityValid(open, selection), false);
  const scoped = structuredClone(options); scoped.memberships[1]!.branchIds = ['hq'];
  assert.equal(capacityValid(scoped, { ...selection, memberships: [...selection.memberships, { id: 'staff', defaultBranchId: 'hq' }] }), true);
  scoped.memberships[1]!.required = true;
  assert.equal(capacityValid(scoped, selection), false);
});
