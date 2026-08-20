import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toEmployeeSummary } from './employee-access.mapper';

describe('toEmployeeSummary job title', () => {
  it('returns the descriptive job title separately from RBAC roles', () => {
    const summary = toEmployeeSummary({
      id: 'profile-1',
      userId: 'user-1',
      membershipId: 'membership-1',
      displayName: 'มีนา ใจงาม',
      titlePrefix: 'นางสาว',
      jobTitle: 'เจ้าหน้าที่บุคคล',
      legalName: null,
      identityType: 'THAI_NATIONAL_ID',
      identityLast4: '0123',
      phoneNumber: '0812345678',
      status: 'ACTIVE',
      createdAt: new Date('2026-08-21T00:00:00.000Z'),
      updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      user: { email: null, credential: null, externalIdentities: [] },
      membership: {
        roles: [{ role: { id: 'role-hr', key: 'HR', name: 'HR' } }],
        branchScopeMode: 'ALL_BRANCHES',
        defaultBranchId: null,
        branchScopes: [],
      },
    });

    assert.equal(summary.jobTitle, 'เจ้าหน้าที่บุคคล');
    assert.deepEqual(summary.roles, [{ id: 'role-hr', key: 'HR', name: 'HR' }]);
  });
});
