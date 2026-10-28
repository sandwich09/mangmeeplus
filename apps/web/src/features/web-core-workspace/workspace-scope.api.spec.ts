import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accessContextFingerprint } from './workspace-scope.api';
import { canOpenDisbursementVoucherWeb } from '@/features/expenses/disbursement-voucher-entry.logic';

describe('accessContextFingerprint', () => {
  it('WHT-OUTSIDE refreshes shop presentation when wht_50bis changes without a role permission change', () => {
    const reader = { roles: ['EMPLOYEE'], permissions: ['wht.certificate.read'] };
    const outside = accessContextFingerprint({ ...reader, entitledFeatureKeys: ['expenses'] });
    assert.notEqual(outside, accessContextFingerprint({ ...reader, entitledFeatureKeys: ['expenses', 'wht_50bis'] }));
    assert.equal(outside, accessContextFingerprint({ ...reader, entitledFeatureKeys: ['expenses', 'thai_tax', 'inventory'] }));
  });
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

  it('refreshes display metadata when a held custom role is renamed', () => {
    const base = { roles: ['CUSTOM_QA'], permissions: ['expense.read'] };
    assert.notEqual(
      accessContextFingerprint({ ...base, roleNames: { CUSTOM_QA: 'Before' } }),
      accessContextFingerprint({ ...base, roleNames: { CUSTOM_QA: 'After' } }),
    );
  });

  // manual-expense-web-entry-flag spec §6.3: the setting changes no permission, so without this the
  // open tabs of a shop would keep the old menu until somebody reloads.
  it('changes when the manual-expense web entry of the company changes, though the permissions stay the same', () => {
    const base = { roles: ['EMPLOYEE'], permissions: ['expense.create', 'expense.update'] };
    assert.notEqual(
      accessContextFingerprint({ ...base, manualExpenseWebEntry: true }),
      accessContextFingerprint({ ...base, manualExpenseWebEntry: false }),
    );
  });

  it('reads a missing manual-expense web entry as shown, so an answer without the field causes no refresh', () => {
    const base = { roles: ['EMPLOYEE'], permissions: ['expense.create'] };
    assert.equal(accessContextFingerprint(base), accessContextFingerprint({ ...base, manualExpenseWebEntry: true }));
    assert.notEqual(accessContextFingerprint(base), accessContextFingerprint({ ...base, manualExpenseWebEntry: false }));
  });

  it('carries nothing else of the answer: a change the menu does not depend on causes no refresh', () => {
    const base = { roles: ['EMPLOYEE'], permissions: ['expense.create'], manualExpenseWebEntry: true };
    // Fields /auth/me also answers with, and a feature list it must never grow into (spec §6.3).
    const unrelated = { ...base, displayName: 'ชื่อใหม่', legalAcceptanceRequired: true, entitledFeatureKeys: ['expenses', 'inventory'] };
    assert.equal(accessContextFingerprint(base), accessContextFingerprint(unrelated));
    assert.deepEqual(Object.keys(JSON.parse(accessContextFingerprint(base))).sort(),
      ['branchIds', 'disbursementVoucherWebEntry', 'freeExpenseDrafts', 'manualExpenseWebEntry', 'permissions', 'roleNames', 'roles', 'systemWhtCertificates']);
  });

  it('changes when the disbursement-voucher setting changes without a permission change', () => {
    const base = { roles: ['OWNER'], permissions: ['expense.disbursement.read'] };
    assert.notEqual(accessContextFingerprint({ ...base, disbursementVoucherWebEntry: true }),
      accessContextFingerprint({ ...base, disbursementVoucherWebEntry: false }));
  });

  it('changes when server-verified free draft access changes without changing role permissions', () => {
    const base = { roles: ['OWNER'], permissions: ['expense.read_own', 'expense.update'] };
    assert.equal(accessContextFingerprint(base), accessContextFingerprint({ ...base, freeExpenseDrafts: false }));
    assert.notEqual(accessContextFingerprint(base), accessContextFingerprint({ ...base, freeExpenseDrafts: true }));
  });

  it('treats a missing disbursement-voucher setting as hidden in both fingerprint and menu predicate', () => {
    const base = { companyId: 'co', roles: ['OWNER'], permissions: ['expense.disbursement.read'] };
    assert.equal(accessContextFingerprint(base), accessContextFingerprint({ ...base, disbursementVoucherWebEntry: false }));
    assert.notEqual(accessContextFingerprint(base), accessContextFingerprint({ ...base, disbursementVoucherWebEntry: true }));
    assert.equal(canOpenDisbursementVoucherWeb(base, 'co'), false);
    assert.equal(canOpenDisbursementVoucherWeb({ ...base, disbursementVoucherWebEntry: true }, 'co'), true);
    assert.equal(canOpenDisbursementVoucherWeb({ ...base, disbursementVoucherWebEntry: true }, 'other'), false);
    assert.equal(canOpenDisbursementVoucherWeb({ ...base, permissions: [], disbursementVoucherWebEntry: true }, 'co'), false);
    assert.equal(canOpenDisbursementVoucherWeb(null, 'co'), false);
  });
});
