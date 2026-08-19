import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  DEFAULT_ON_FEATURE_KEYS,
  FEATURE_CATALOG,
  FEATURE_DEPENDENCIES,
  FEATURE_KEYS,
  PLATFORM_INVARIANT_FEATURE_KEYS,
  dependentFeatureKeys,
  requiredFeatureKeys,
  unmetFeatureDependencies,
} from './feature-entitlements.js';
import {
  LINE_CAPABILITY_GROUPS,
  LINE_TOOL_REGISTRY,
  canAdvertiseReceiptCapture,
  inCapabilityGroup,
  usableCapabilityGroupIds,
} from './ai-tools.js';

const onlyThese = (...on: string[]) => (key: string) => on.includes(key);

describe('feature catalog shape (spec §6.1)', () => {
  it('freezes 18 top-level keys, 16 of them sellable', () => {
    assert.equal(FEATURE_KEYS.length, 18);
    assert.equal(FEATURE_CATALOG.filter((feature) => feature.sellable).length, 16);
    assert.deepEqual(
      FEATURE_CATALOG.filter((feature) => !feature.sellable).map((feature) => feature.key).sort(),
      ['company_settings', 'employee_access'],
    );
  });

  it('marks exactly the platform-invariant keys non-sellable', () => {
    for (const key of PLATFORM_INVARIANT_FEATURE_KEYS) {
      const feature = FEATURE_CATALOG.find((candidate) => candidate.key === key);
      assert.ok(feature, `${key} must exist in the catalog`);
      assert.equal(feature.sellable, false);
    }
    // One list, two readings — they must never drift apart.
    assert.deepEqual([...DEFAULT_ON_FEATURE_KEYS], [...PLATFORM_INVARIANT_FEATURE_KEYS]);
  });
});

describe('FEATURE_DEPENDENCIES (spec:264)', () => {
  it('declares exactly one top-level dependency plus the two structural procurement children', () => {
    assert.deepEqual(Object.keys(FEATURE_DEPENDENCIES).sort(), [
      'expense_auto_post',
      'procurement.ap_aging',
      'procurement.supplier_payments',
    ]);
    assert.deepEqual(requiredFeatureKeys('expense_auto_post'), ['double_entry_ledger']);
    assert.deepEqual(requiredFeatureKeys('procurement.ap_aging'), ['procurement.vendor_bills']);
    assert.deepEqual(requiredFeatureKeys('procurement.supplier_payments'), ['procurement.vendor_bills']);
    assert.deepEqual(requiredFeatureKeys('crm'), []);
  });

  it('contains no reimbursement ⇒ expenses and no thai_tax ⇒ double_entry_ledger', () => {
    assert.deepEqual(requiredFeatureKeys('reimbursement'), []);
    assert.deepEqual(requiredFeatureKeys('thai_tax'), []);
  });

  it('references only keys that exist in the catalog', () => {
    const known = new Set(ALL_FEATURE_ENTITLEMENT_KEYS);
    for (const [child, parents] of Object.entries(FEATURE_DEPENDENCIES)) {
      assert.ok(known.has(child), `${child} is not a catalog key`);
      for (const parent of parents) assert.ok(known.has(parent), `${parent} is not a catalog key`);
    }
  });

  it('never makes a platform-invariant key a prerequisite or a dependent', () => {
    for (const key of PLATFORM_INVARIANT_FEATURE_KEYS) {
      assert.deepEqual(requiredFeatureKeys(key), []);
      assert.deepEqual(dependentFeatureKeys(key), []);
    }
  });

  it('has no dependency cycle', () => {
    for (const child of Object.keys(FEATURE_DEPENDENCIES)) {
      const seen = new Set<string>();
      const stack = [...requiredFeatureKeys(child)];
      while (stack.length > 0) {
        const next = stack.pop()!;
        assert.notEqual(next, child, `${child} depends on itself`);
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(...requiredFeatureKeys(next));
      }
    }
  });

  it('lists dependents for a cascade preview in canonical order', () => {
    assert.deepEqual(dependentFeatureKeys('double_entry_ledger'), ['expense_auto_post']);
    assert.deepEqual(dependentFeatureKeys('procurement.vendor_bills'), [
      'procurement.ap_aging',
      'procurement.supplier_payments',
    ]);
    assert.deepEqual(dependentFeatureKeys('crm'), []);
  });
});

describe('unmetFeatureDependencies — both directions', () => {
  it('flags a child enabled without its prerequisite', () => {
    assert.deepEqual(unmetFeatureDependencies(onlyThese('expense_auto_post')), [
      { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger' },
    ]);
  });

  it('flags the same pair when the parent is being turned off under an active child', () => {
    // Direction B is the identical predicate over the proposed FINAL set.
    const finalSet = onlyThese('expense_auto_post', 'expenses');
    assert.deepEqual(unmetFeatureDependencies(finalSet), [
      { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger' },
    ]);
  });

  it('accepts a consistent set and an all-off set', () => {
    assert.deepEqual(unmetFeatureDependencies(onlyThese('expense_auto_post', 'double_entry_ledger')), []);
    assert.deepEqual(unmetFeatureDependencies(() => false), []);
  });

  it('reports every violation, sorted, not just the first', () => {
    assert.deepEqual(
      unmetFeatureDependencies(onlyThese('expense_auto_post', 'procurement.supplier_payments', 'procurement.ap_aging')),
      [
        { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger' },
        { featureKey: 'procurement.ap_aging', requiresFeatureKey: 'procurement.vendor_bills' },
        { featureKey: 'procurement.supplier_payments', requiresFeatureKey: 'procurement.vendor_bills' },
      ],
    );
  });
});

// ── LINE capability groups (spec: line-ai-capability-help-entitlement-spec.md) ─────────────────
// The assistant's self-description is DERIVED from the tool registry, so it can never advertise a
// capability the same turn would refuse. Asserted over the real LINE_TOOL_REGISTRY, not a fixture.

const ALL_FEATURES_ON = new Set<string>([
  'sales_documents', 'expenses', 'expenses.list', 'expenses.upload', 'double_entry_ledger',
  'bank_reconciliation', 'reports', 'thai_tax', 'inventory', 'product_catalog', 'crm', 'crm.inbox',
  'crm.bookings', 'procurement', 'dashboard_notifications',
]);
const EXPENSES_ONLY = new Set<string>(['expenses', 'expenses.list', 'expenses.upload', 'dashboard_notifications']);
// An owner-shaped grant: whatever the registry asks for, this caller has. Isolates the feature axis.
const ALL_PERMISSIONS = [...new Set(LINE_TOOL_REGISTRY.flatMap(
  (tool) => [...tool.requiredPermissions, ...(tool.anyOfPermissions ?? [])],
))];

describe('LINE capability groups', () => {
  it('advertises every group when features and permissions are complete (AC-4)', () => {
    assert.deepEqual(
      usableCapabilityGroupIds(ALL_PERMISSIONS, ALL_FEATURES_ON),
      ['sales', 'expenses', 'finance', 'tax', 'inventory', 'customers', 'bookings', 'procurement', 'alerts'],
    );
  });

  it('hides every switched-off capability on an expenses-only company (AC-1)', () => {
    assert.deepEqual(usableCapabilityGroupIds(ALL_PERMISSIONS, EXPENSES_ONLY), ['expenses', 'alerts']);
  });

  it('treats a legacy company (entitled === null) as fully entitled (AC-5)', () => {
    assert.deepEqual(
      usableCapabilityGroupIds(ALL_PERMISSIONS, null),
      usableCapabilityGroupIds(ALL_PERMISSIONS, ALL_FEATURES_ON),
    );
  });

  it('hides the sales line when sales is off and crm is on (AC-6)', () => {
    // sales.get_sales_summary asks for crm.report.read but reads sales_documents data. Permissions
    // alone cannot catch it — this is the case the entitlement set exists for.
    const crmOnSalesOff = new Set(['crm', 'crm.inbox', 'crm.bookings', 'dashboard_notifications']);
    const groups = usableCapabilityGroupIds(ALL_PERMISSIONS, crmOnSalesOff);
    assert.ok(!groups.includes('sales'), `sales must be hidden, got ${groups.join(',')}`);
    assert.ok(groups.includes('customers'));
  });

  it('advertises nothing to a caller with no permissions (AC-7)', () => {
    assert.deepEqual(usableCapabilityGroupIds([], ALL_FEATURES_ON), []);
    assert.equal(canAdvertiseReceiptCapture([], ALL_FEATURES_ON), false);
  });

  it('groups a tool by its feature keys, never by a secondary business subject', () => {
    // dashboard.get_business_health_summary declares businessSubjects ['company','report']; grouping
    // on subjects lit a finance line for a company with reports/ledger/banking all off.
    const dashboardOnly = new Set(['dashboard_notifications']);
    assert.deepEqual(usableCapabilityGroupIds(['dashboard.read'], dashboardOnly), ['alerts']);
  });

  it('keeps every group backed by a real tool (AC-11)', () => {
    for (const group of LINE_CAPABILITY_GROUPS) {
      const backing = LINE_TOOL_REGISTRY.filter((tool) => inCapabilityGroup(tool, group));
      assert.ok(backing.length > 0, `capability group ${group.id} advertises no tool`);
    }
  });

  it('describes a caller whose only reach is reimbursements or workflow tasks', () => {
    // Both modules were silently outside every group at first: reimbursements carries no feature key
    // by design, and workflow_automation had none of its own. A claims-only approver would then have
    // been told the assistant could do nothing for them, while the tools answered fine.
    assert.deepEqual(usableCapabilityGroupIds(['reimbursement.approve'], null), ['expenses']);
    assert.deepEqual(usableCapabilityGroupIds(['workflow.task.read'], new Set(['workflow_automation'])), ['alerts']);
    assert.deepEqual(usableCapabilityGroupIds(['workflow.task.read'], new Set(['dashboard_notifications'])), []);
  });

  it('advertises no capability for a tool no group owns, rather than widening a neighbour', () => {
    // company/employee/hr context tools are deliberately unadvertised; they must not light a line.
    assert.deepEqual(usableCapabilityGroupIds(['company.branch.read', 'hr.leave.read'], null), []);
  });
});

describe('LINE receipt-capture claim', () => {
  it('follows the intake path permissions, not the capture tool (AC-3)', () => {
    // MANAGER/ACCOUNTANT/MARKETING hold line_upload only; the tool asks for expense.receipt.upload.
    assert.equal(canAdvertiseReceiptCapture(['expense.receipt.line_upload'], ALL_FEATURES_ON), true);
    assert.equal(canAdvertiseReceiptCapture(['expense.receipt.upload'], ALL_FEATURES_ON), true);
    assert.equal(canAdvertiseReceiptCapture(['expense.create'], ALL_FEATURES_ON), true);
    assert.equal(canAdvertiseReceiptCapture(['expense.read'], ALL_FEATURES_ON), false);
  });

  it('disappears when the expenses.upload submenu is off, with expenses still on (AC-2)', () => {
    const uploadOff = new Set(['expenses', 'expenses.list', 'dashboard_notifications']);
    assert.equal(canAdvertiseReceiptCapture(['expense.receipt.line_upload'], uploadOff), false);
    assert.deepEqual(usableCapabilityGroupIds(ALL_PERMISSIONS, uploadOff), ['expenses', 'alerts']);
  });

  it('stays fail-open for a legacy company', () => {
    assert.equal(canAdvertiseReceiptCapture(['expense.receipt.line_upload'], null), true);
  });
});
