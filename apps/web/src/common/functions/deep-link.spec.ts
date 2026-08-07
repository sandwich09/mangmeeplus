import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeepLinkPath, parseDeepLinkPath } from './deep-link';

describe('buildDeepLinkPath', () => {
  it('dashboard', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'dashboard', companyId: 'abc' }), '/companies/abc/dashboard');
  });
  it('product', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'product', companyId: 'abc', productId: 'p1' }), '/companies/abc/inventory/products/p1');
  });
  it('stockMovement', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'stockMovement', companyId: 'abc', movementId: 'm1' }), '/companies/abc/inventory/movements/m1');
  });
  it('invoice', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'invoice', companyId: 'abc', invoiceId: 'inv1' }), '/companies/abc/accounting/invoices/inv1');
  });
  it('expense', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'expense', companyId: 'abc', expenseId: 'exp1' }), '/companies/abc/expenses/exp1');
  });
  it('taxPeriod', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'taxPeriod', companyId: 'abc', taxPeriodId: 'tp1' }), '/companies/abc/tax/periods/tp1');
  });
  it('customer', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'customer', companyId: 'abc', customerId: 'c1' }), '/companies/abc/crm/customers/c1');
  });
  it('approval', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'approval', companyId: 'abc', approvalId: 'a1' }), '/companies/abc/approvals/a1');
  });
  it('report', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'report', companyId: 'abc', reportKey: 'sales-monthly' }), '/companies/abc/reports/sales-monthly');
  });
  it('settingsUser', () => {
    assert.strictEqual(buildDeepLinkPath({ type: 'settingsUser', companyId: 'abc', userId: 'u1' }), '/companies/abc/settings/users/u1');
  });
});

describe('parseDeepLinkPath', () => {
  it('dashboard path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/dashboard'), { type: 'dashboard', companyId: 'abc' });
  });
  it('company root resolves to dashboard', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc'), { type: 'dashboard', companyId: 'abc' });
  });
  it('product path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/inventory/products/p1'), { type: 'product', companyId: 'abc', productId: 'p1' });
  });
  it('stockMovement path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/inventory/movements/m1'), { type: 'stockMovement', companyId: 'abc', movementId: 'm1' });
  });
  it('invoice path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/accounting/invoices/inv1'), { type: 'invoice', companyId: 'abc', invoiceId: 'inv1' });
  });
  it('expense path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/expenses/exp1'), { type: 'expense', companyId: 'abc', expenseId: 'exp1' });
  });
  it('taxPeriod path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/tax/periods/tp1'), { type: 'taxPeriod', companyId: 'abc', taxPeriodId: 'tp1' });
  });
  it('customer path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/crm/customers/c1'), { type: 'customer', companyId: 'abc', customerId: 'c1' });
  });
  it('approval path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/approvals/a1'), { type: 'approval', companyId: 'abc', approvalId: 'a1' });
  });
  it('report path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/reports/sales-monthly'), { type: 'report', companyId: 'abc', reportKey: 'sales-monthly' });
  });
  it('settingsUser path', () => {
    assert.deepStrictEqual(parseDeepLinkPath('/companies/abc/settings/users/u1'), { type: 'settingsUser', companyId: 'abc', userId: 'u1' });
  });
  it('unknown path returns null', () => {
    assert.strictEqual(parseDeepLinkPath('/companies/abc/unknown/path'), null);
  });
  it('non-company path returns null', () => {
    assert.strictEqual(parseDeepLinkPath('/dashboard'), null);
  });
});

describe('round-trip', () => {
  const targets = [
    { type: 'dashboard' as const, companyId: 'abc' },
    { type: 'product' as const, companyId: 'abc', productId: 'p1' },
    { type: 'stockMovement' as const, companyId: 'abc', movementId: 'm1' },
    { type: 'invoice' as const, companyId: 'abc', invoiceId: 'inv1' },
    { type: 'expense' as const, companyId: 'abc', expenseId: 'exp1' },
    { type: 'taxPeriod' as const, companyId: 'abc', taxPeriodId: 'tp1' },
    { type: 'customer' as const, companyId: 'abc', customerId: 'c1' },
    { type: 'approval' as const, companyId: 'abc', approvalId: 'a1' },
    { type: 'report' as const, companyId: 'abc', reportKey: 'sales-monthly' },
    { type: 'settingsUser' as const, companyId: 'abc', userId: 'u1' },
  ];
  for (const target of targets) {
    it(`round-trip ${target.type}`, () => {
      const path = buildDeepLinkPath(target);
      const parsed = parseDeepLinkPath(path);
      assert.deepStrictEqual(parsed, target);
    });
  }
});
