import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accessContextFingerprint } from './workspace-scope.api';

describe('accessContextFingerprint', () => {
  it('ignores server ordering while detecting permission, role, and branch-scope changes', () => {
    const first = accessContextFingerprint({
      roles: ['ACCOUNTANT', 'ADMIN'],
      permissions: ['expense.read', 'expense.approve'],
      scopes: { branchIds: ['branch-2', 'branch-1'] },
    });
    const reordered = accessContextFingerprint({
      roles: ['ADMIN', 'ACCOUNTANT'],
      permissions: ['expense.approve', 'expense.read', 'expense.read'],
      scopes: { branchIds: ['branch-1', 'branch-2'] },
    });

    assert.equal(first, reordered);
    assert.notEqual(first, accessContextFingerprint({
      roles: ['ACCOUNTANT'],
      permissions: ['expense.read'],
      scopes: { branchIds: ['branch-1'] },
    }));
  });

  it('distinguishes unrestricted branch access from an explicitly empty branch scope', () => {
    const base = { roles: ['OWNER'], permissions: ['expense.read'] };
    assert.notEqual(
      accessContextFingerprint(base),
      accessContextFingerprint({ ...base, scopes: { branchIds: [] } }),
    );
  });
});
