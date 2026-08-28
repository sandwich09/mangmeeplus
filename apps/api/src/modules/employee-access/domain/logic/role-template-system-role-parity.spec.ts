// GAP-06 guard: the crosscutting job presets mirror their corresponding system role — a preset
// must never EXCEED the capability of the system role it stands in for. Every WRITE-class
// permission (not `.read`/`.read_own`/`.export`/`.report`) in the compiled preset must be a key
// the system role's ROLE_GRANTS also holds, except for the documented extras below.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileRole } from './capability.logic';
import { ROLE_TEMPLATES } from '../registries/role-template.registry';
import { ROLE_GRANTS } from '../../../auth/permission-registry';

function compiledKeys(roleTemplateKey: string): string[] {
  return compileRole({ roleTemplateKey, entitledFeatureKeys: null, granterPermissionKeys: null }).permissionKeys;
}

function isWrite(key: string): boolean {
  return !key.endsWith('.read') && !key.endsWith('.read_own') && !key.endsWith('.read_related')
    && !key.endsWith('.export') && !key.endsWith('.report');
}

// Preset ↔ system-role pairs the parity principle applies to (team decision 2026-07-29, GAP-06).
const PARITY_PAIRS: Array<{ templateKey: string; systemRole: string }> = [
  { templateKey: 'tpl.x.finance', systemRole: 'FINANCE' },
  { templateKey: 'tpl.x.accounting', systemRole: 'ACCOUNTANT' },
  { templateKey: 'tpl.x.manager', systemRole: 'MANAGER' },
];

// Documented open questions: write keys the preset holds beyond its system role that were NOT
// covered by the GAP-06 decisions (6.3/6.4/6.5). Each entry is known drift awaiting a team
// decision — do not add to this list without recording the decision in
// docs/specs/finance-accounting-gaps-spec.md. New drift beyond this list fails the test.
const KNOWN_PRESET_EXTRAS: Record<string, string[]> = {
  'tpl.x.finance': [
    // pack.procurement.ap_manage — FINANCE cannot cancel/void purchase orders.
    'procurement.purchase_order.manage',
    // pack.tax.prepare — FINANCE lacks this; among system roles it is ACCOUNTANT/OWNER-level.
    'tax.adjustment.create',
  ],
  'tpl.x.accounting': [
    // pack.bank.reconcile_manage — ACCOUNTANT cannot void statement imports (FINANCE-side key).
    'bank.statement.void',
    // pack.expense.review — the system ACCOUNTANT is read/export-only on expenses.
    'expense.ai.verify', 'expense.category.manage', 'expense.duplicate.resolve', 'expense.review',
  ],
  'tpl.x.manager': [
    // pack.quotation.approve — MANAGER approves quotations but cannot void them.
    'accounting.quotation.void',
    // pack.crm.manage — MANAGER lacks archive/pipeline-configure.
    'crm.customer.archive', 'crm.pipeline.configure',
    // pack.dashboard.manage — MANAGER only reads the dashboard.
    'dashboard.configure', 'dashboard.snapshot.generate',
    // pack.expense.review — MANAGER reviews expenses but lacks these two.
    'expense.ai.verify', 'expense.category.manage',
    // pack.procurement.approve — MANAGER approves purchase orders but cannot issue them.
    'procurement.purchase_order.issue',
  ],
};

describe('role-template ↔ system-role parity (GAP-06)', () => {
  it('crosscutting presets grant no write key their system role lacks (beyond documented extras)', () => {
    const violations: string[] = [];
    for (const { templateKey, systemRole } of PARITY_PAIRS) {
      const roleKeys = new Set(ROLE_GRANTS[systemRole]);
      const allowed = new Set(KNOWN_PRESET_EXTRAS[templateKey] ?? []);
      const excess = compiledKeys(templateKey).filter((k) => isWrite(k) && !roleKeys.has(k) && !allowed.has(k));
      if (excess.length) violations.push(`${templateKey} exceeds ${systemRole} → ${excess.sort().join(', ')}`);
    }
    assert.equal(violations.length, 0, `presets exceed their system role:\n${violations.join('\n')}`);
  });

  it('KNOWN_PRESET_EXTRAS has no stale entries (each is still real drift)', () => {
    const stale: string[] = [];
    for (const { templateKey, systemRole } of PARITY_PAIRS) {
      const roleKeys = new Set(ROLE_GRANTS[systemRole]);
      const held = new Set(compiledKeys(templateKey));
      for (const k of KNOWN_PRESET_EXTRAS[templateKey] ?? []) {
        if (!held.has(k) || roleKeys.has(k)) stale.push(`${templateKey} → ${k}`);
      }
    }
    assert.equal(stale.length, 0, `remove resolved entries from KNOWN_PRESET_EXTRAS:\n${stale.join('\n')}`);
  });

  it('6.3: finance presets can issue and void tax invoices like the FINANCE role', () => {
    for (const key of ['tpl.x.finance', 'tpl.trading.finance', 'tpl.service.finance', 'tpl.ecom.finance']) {
      const held = new Set(compiledKeys(key));
      assert.ok(held.has('accounting.tax_invoice.issue'), `${key} should hold accounting.tax_invoice.issue`);
      assert.ok(held.has('accounting.tax_invoice.void'), `${key} should hold accounting.tax_invoice.void`);
      // Step 0 §10: buyer-evidence remediation rides with the tax-invoice authority, so the
      // finance presets and the FINANCE role stay in parity on it too.
      assert.ok(
        held.has('accounting.tax_document_buyer_evidence.manage'),
        `${key} should hold accounting.tax_document_buyer_evidence.manage`,
      );
    }
  });

  // The other half of that decision: the billing presets that deliberately stop short of tax
  // invoices must not pick the key up through pack.billing.issue.
  it('6.3b: non-tax billing presets cannot edit issued tax invoice evidence', () => {
    for (const key of ['tpl.retail.cashier', 'tpl.ecom.order_ops']) {
      assert.equal(
        new Set(compiledKeys(key)).has('accounting.tax_document_buyer_evidence.manage'),
        false,
        `${key} must not hold accounting.tax_document_buyer_evidence.manage`,
      );
    }
  });

  it('6.4: manager presets no longer approve vendor bills', () => {
    for (const key of ['tpl.x.manager', 'tpl.retail.store_manager', 'tpl.service.manager']) {
      assert.ok(
        !new Set(compiledKeys(key)).has('procurement.vendor_bill.approve'),
        `${key} must not hold procurement.vendor_bill.approve`,
      );
    }
  });

  it('6.7: vendor-bill approval lives with the finance presets, like the FINANCE role', () => {
    for (const key of ['tpl.x.finance', 'tpl.trading.finance', 'tpl.service.finance', 'tpl.ecom.finance']) {
      assert.ok(
        new Set(compiledKeys(key)).has('procurement.vendor_bill.approve'),
        `${key} should hold procurement.vendor_bill.approve`,
      );
    }
  });

  it('6.5: no preset holds goods-receipt post/void (OWNER-only; delegable via a custom role)', () => {
    for (const tpl of ROLE_TEMPLATES) {
      const held = new Set(compiledKeys(tpl.key));
      for (const k of ['procurement.goods_receipt.post', 'procurement.goods_receipt.void']) {
        assert.ok(!held.has(k), `${tpl.key} must not hold ${k}`);
      }
    }
  });
});
