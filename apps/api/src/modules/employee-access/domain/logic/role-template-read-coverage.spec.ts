// GAP-01 guard: every job preset that grants a WRITE permission must also grant the paired
// `.read` (sidebar menus gate on `.read`, so a role without it cannot open the screen it works in).
// Self-service packs legitimately read only their own scope, so a `.read_own` sibling is accepted.
// `.read_related` is also a read key, not a mutation that must pull broad `.read` into every preset.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileRole } from './capability.logic';
import { ROLE_TEMPLATES } from '../registries/role-template.registry';
import { PERMISSION_KEYS } from '../../../auth/permission-registry';

const ALL_KEYS = new Set(PERMISSION_KEYS);

function compiledKeys(roleTemplateKey: string): string[] {
  return compileRole({ roleTemplateKey, entitledFeatureKeys: null, granterPermissionKeys: null }).permissionKeys;
}

// Reads missing for a role's non-read keys (base `.read` exists, not held, and no `.read_own` sibling held).
function missingReads(keys: string[]): string[] {
  const held = new Set(keys);
  const missing = new Set<string>();
  for (const k of keys) {
    if (k.endsWith('.read') || k.endsWith('.read_own') || k.endsWith('.read_related')) continue;
    const base = k.replace(/\.[a-z_]+$/, '.read');
    if (!ALL_KEYS.has(base) || held.has(base)) continue;
    const readOwn = k.replace(/\.[a-z_]+$/, '') + '.read_own';
    if (held.has(readOwn)) continue;
    missing.add(base);
  }
  return [...missing].sort();
}

describe('role-template read coverage (GAP-01)', () => {
  it('every preset grants the paired .read for every write it grants', () => {
    const violations: string[] = [];
    for (const tpl of ROLE_TEMPLATES) {
      const missing = missingReads(compiledKeys(tpl.key));
      if (missing.length) violations.push(`${tpl.key} → ${missing.join(', ')}`);
    }
    assert.equal(violations.length, 0, `presets missing paired reads:\n${violations.join('\n')}`);
  });

  it('tpl.x.finance holds all 24 finance reads', () => {
    const held = new Set(compiledKeys('tpl.x.finance'));
    const expected = [
      'accounting.billing_note.read', 'accounting.counterparty.read', 'accounting.credit_note.read',
      'accounting.debit_note.read', 'accounting.document.read', 'accounting.invoice.read',
      'accounting.payment.read', 'accounting.receipt.read',
      'bank.account.read', 'bank.adjustment.read', 'bank.match.read', 'bank.reconciliation.read', 'bank.statement.read',
      'expense.read',
      'procurement.goods_receipt.read', 'procurement.purchase_order.read', 'procurement.supplier.read',
      'procurement.supplier_payment.read', 'procurement.vendor_bill.read',
      'reimbursement.read',
      'tax.certificate.read', 'tax.event.read', 'tax.report.read', 'tax.review_issue.read',
    ];
    for (const k of expected) assert.ok(held.has(k), `tpl.x.finance should hold ${k}`);
  });

  it('tpl.x.accounting holds the 6 ledger/tax reads', () => {
    const held = new Set(compiledKeys('tpl.x.accounting'));
    const expected = [
      'ledger.account.read', 'ledger.period.read', 'ledger.posting-rule.read',
      'tax.config.read', 'tax.period.read', 'tax.profile.read',
    ];
    for (const k of expected) assert.ok(held.has(k), `tpl.x.accounting should hold ${k}`);
  });

  it('adds only the disbursement packs selected for finance, manager, and accounting templates', () => {
    const all = [
      'expense.disbursement.read', 'expense.disbursement.prepare', 'expense.disbursement.approve',
      'expense.disbursement.pay', 'expense.disbursement.issue',
    ];
    const expected: Record<string, string[]> = {
      'tpl.x.finance': all,
      'tpl.trading.finance': all,
      'tpl.service.finance': all,
      'tpl.ecom.finance': all,
      'tpl.x.manager': ['expense.disbursement.read', 'expense.disbursement.approve'],
      'tpl.retail.store_manager': ['expense.disbursement.read', 'expense.disbursement.approve'],
      'tpl.service.manager': ['expense.disbursement.read', 'expense.disbursement.approve'],
      'tpl.x.accounting': ['expense.disbursement.read', 'expense.disbursement.issue'],
    };
    for (const template of ROLE_TEMPLATES) {
      const actual = compiledKeys(template.key).filter((key) => key.startsWith('expense.disbursement.')).sort();
      assert.deepEqual(actual, (expected[template.key] ?? []).slice().sort(), template.key);
    }
  });

  it('finance/accounting presets hold the read_own keys the screens gate on', () => {
    // Self-service screens still keep the narrower compatibility path even though related actors
    // can now enter the same modules through `.read_related`.
    const fin = new Set(compiledKeys('tpl.x.finance'));
    for (const k of ['expense.read_own', 'reimbursement.read_own']) {
      assert.ok(fin.has(k), `tpl.x.finance should hold ${k}`);
    }
    assert.ok(new Set(compiledKeys('tpl.x.accounting')).has('expense.read_own'), 'tpl.x.accounting should hold expense.read_own');
  });

  it('tpl.x.accounting can review reimbursements without gaining payment authority', () => {
    const held = new Set(compiledKeys('tpl.x.accounting'));
    for (const key of ['reimbursement.read', 'reimbursement.read_own', 'reimbursement.read_related', 'reimbursement.finance_review', 'reimbursement.export']) {
      assert.ok(held.has(key), `tpl.x.accounting should hold ${key}`);
    }
    for (const key of ['reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.duplicate.resolve']) {
      assert.ok(!held.has(key), `tpl.x.accounting must not hold ${key}`);
    }
  });

  it('expense capture and review packs include the attachment authority their screens invoke', () => {
    for (const pack of ['pack.expense.self', 'pack.expense.review']) {
      const held = new Set(compileRole({ capabilityPackKeys: [pack], entitledFeatureKeys: null, granterPermissionKeys: null }).permissionKeys);
      assert.ok(held.has('attachment.create'), `${pack} cannot upload its expense evidence`);
    }
  });

  it('tpl.x.finance does not widen into approve/post/close privileges', () => {
    const held = new Set(compiledKeys('tpl.x.finance'));
    for (const k of ['reimbursement.approve', 'journal.entry.post', 'ledger.period.close', 'expense.signature.approve']) {
      assert.ok(!held.has(k), `tpl.x.finance must not hold ${k}`);
    }
  });
});
