import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingCapacityOptions } from '@watchdog-bms/contracts';
import { capacityValid, parseCapacitySelection } from './billing-capacity';

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
