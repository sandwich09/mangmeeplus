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
  it('includes two narrow WHT rights while keeping platform baseline keys', () => {
    assert.equal(FEATURE_KEYS.length, 20);
    assert.equal(FEATURE_CATALOG.filter((feature) => feature.sellable).length, 18);
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
  'crm.bookings', 'procurement', 'dashboard_notifications', 'wht_50bis', 'wht_pnd53',
]);
const EXPENSES_ONLY = new Set<string>(['expenses', 'expenses.list', 'expenses.upload', 'dashboard_notifications']);
// An owner-shaped grant: whatever the registry asks for, this caller has. Isolates the feature axis.
const ALL_PERMISSIONS = [...new Set(LINE_TOOL_REGISTRY.flatMap(
  (tool) => [...tool.requiredPermissions, ...(tool.anyOfPermissions ?? [])],
))];

describe('LINE capability groups', () => {
  it('keeps shared counterparty gates out of sales, including callers without entitlement rows', () => {
    for (const entitled of [null, EXPENSES_ONLY, new Set(['sales_documents'])]) {
      assert.deepEqual(usableCapabilityGroupIds(['accounting.counterparty.read'], entitled), ['counterparties']);
    }
    assert.deepEqual(usableCapabilityGroupIds(['accounting.counterparty.read'], new Set()), []);
    assert.deepEqual(usableCapabilityGroupIds(['expense.read', 'expense.receipt.line_upload'], EXPENSES_ONLY), ['expenses', 'counterparties']);
  });

  it('advertises team/branch management only through the reachable confirmation preview', () => {
    for (const permission of ['access.employee.create', 'access.employee.update', 'access.employee.disable', 'company.branch.manage']) {
      assert.deepEqual(usableCapabilityGroupIds([permission], new Set()), ['company_management']);
    }
    for (const permissions of [[], ['access.employee.read'], ['company.branch.read'], ['access.role.read']]) {
      assert.equal(usableCapabilityGroupIds(permissions, new Set()).includes('company_management'), false);
    }
  });

  it('scopes team and sold tax documents to their real tools and features', () => {
    assert.deepEqual(usableCapabilityGroupIds(['access.employee.read'], new Set()), ['team']);
    assert.deepEqual(usableCapabilityGroupIds(['wht.certificate.read'], new Set(['wht_50bis'])), ['tax_documents']);
    assert.deepEqual(usableCapabilityGroupIds(['wht.pnd53.read'], new Set(['wht_pnd53'])), ['tax_documents']);
    assert.deepEqual(usableCapabilityGroupIds(['wht.certificate.read'], EXPENSES_ONLY), []);
    assert.deepEqual(usableCapabilityGroupIds(['expense.disbursement.read'], new Set(['expenses', 'wht_50bis'])), ['tax_documents']);
    assert.deepEqual(usableCapabilityGroupIds([], new Set(['expenses', 'wht_50bis'])), []);
  });

  it('advertises every group when features and permissions are complete (AC-4)', () => {
    assert.deepEqual(
      usableCapabilityGroupIds(ALL_PERMISSIONS, ALL_FEATURES_ON),
      ['sales', 'expenses', 'finance', 'tax', 'inventory', 'customers', 'bookings', 'procurement', 'alerts', 'counterparties', 'company_management', 'team', 'tax_documents'],
    );
  });

  it('hides every switched-off capability on an expenses-only company (AC-1)', () => {
    assert.deepEqual(usableCapabilityGroupIds(ALL_PERMISSIONS, EXPENSES_ONLY), ['expenses', 'alerts', 'counterparties', 'company_management', 'team']);
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

  it('advertises the package line only to a caller who manages the package (owner 2026-09-30)', () => {
    // billing.get_package_usage runs for every assistant user and answers a non-manager with a typed
    // refusal, so the tool alone must not light the line.
    assert.deepEqual(usableCapabilityGroupIds(['ai.tool.invoke'], null), []);
    assert.deepEqual(usableCapabilityGroupIds(['ai.tool.invoke', 'company.plan.manage'], EXPENSES_ONLY), ['package']);
    assert.deepEqual(usableCapabilityGroupIds([...ALL_PERMISSIONS, 'company.plan.manage'], EXPENSES_ONLY), ['expenses', 'alerts', 'counterparties', 'company_management', 'team', 'package']);
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
    assert.deepEqual(usableCapabilityGroupIds(ALL_PERMISSIONS, uploadOff), ['expenses', 'alerts', 'counterparties', 'company_management', 'team']);
  });

  it('stays fail-open for a legacy company', () => {
    assert.equal(canAdvertiseReceiptCapture(['expense.receipt.line_upload'], null), true);
  });
});

import { LINE_CHAT_ACTIONS, canUseLineChatAction, lineChatAction } from './ai-tools.js';
import { createLineAiInputEvidence } from './line-ai-input-evidence.js';
import { extractValueCandidatesV2 } from './line-ai-value-normalizer.js';
import { verifyLineAiRetainedTaskSource } from './line-ai.js';
describe('Fix-up 15: action entry × capability group × current access', () => {
  for (const action of LINE_CHAT_ACTIONS) it(`${action.group}/${action.id} requires its real operation permission and feature`, () => {
    const features = new Set([...LINE_CAPABILITY_GROUPS.flatMap(group => [...group.featureKeys]), 'expenses.upload']);
    const permissions = ['ai.tool.invoke', action.permission, ...(action.id === 'approvals' ? ['reimbursement.read'] : [])];
    assert.ok(LINE_CAPABILITY_GROUPS.some(group => group.id === action.group));
    assert.equal(canUseLineChatAction(action.id, permissions, features), true);
    assert.equal(canUseLineChatAction(action.id, ['ai.tool.invoke'], features), false);
    assert.equal(canUseLineChatAction(action.id, permissions, null), true);
    if (!['reimbursement_claim', 'payout_account', 'team_member', 'branch', 'branch_edit', 'package_purchase', 'approvals', 'team'].includes(action.id))
      assert.equal(canUseLineChatAction(action.id, permissions, new Set()), false);
    assert.equal(lineChatAction(action.id)?.command, action.command);
  });
  it('covers every advertised capability group', () => {
    for (const group of LINE_CAPABILITY_GROUPS) assert.ok(LINE_CHAT_ACTIONS.some(action => action.group === group.id), group.id);
    assert.equal(canUseLineChatAction('expense_search', ['expense.read'], new Set(['expenses'])), true);
  });
  it('rejects unregistered actions', () => assert.equal(canUseLineChatAction('approve_everything', ['*'], null), false));
});

it('Fix-up 17B: narrow WHT features govern the exact action independently of general tax', () => {
  for (const [id, permission, feature, other] of [
    ['wht_certificate', 'wht.certificate.issue', 'wht_50bis', 'wht_pnd53'],
    ['pnd53', 'wht.pnd53.read', 'wht_pnd53', 'wht_50bis'],
  ]) {
    const permissions = ['ai.tool.invoke', permission!];
    assert.equal(canUseLineChatAction(id, permissions, new Set(['expenses', feature!])), true);
    assert.equal(canUseLineChatAction(id, permissions, new Set(['expenses', other!, 'thai_tax'])), false);
  }
});

it('Fix-up 17B: a tax form number does not consume เดือนนี้, and untyped previews retain exact source facts', async () => {
  for (const text of ['ทำให้หน่อย สรุป ภ.ง.ด.53 เดือนนี้', 'ภงด53 เดือนนี้', 'PND53 เดือนนี้']) {
    const built = (await createLineAiInputEvidence({ turnKey: 'fx17b-month', parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!;
    const candidates = (await extractValueCandidatesV2(built.inputEvidence, '2026-10-16'))!;
    assert.deepEqual(candidates.periods.map(period => period.monthKey), ['2026-10']);
    const retained = await verifyLineAiRetainedTaskSource({ taskRef: { taskId: 'task', taskRevision: 2, subrequestIndex: 1 }, inputEvidence: built.inputEvidence,
      semanticSubrequest: { index: 1, kind: 'write', goal: 'เตรียม 50 ทวิ', requiredEvidence: [], requestedFilters: {}, dependsOn: [],
        evidenceRefs: [{ partId: 'part-0', rawSha256: built.inputEvidence.parts[0]!.rawSha256, startUtf16: 0, endUtf16: text.length }] } });
    assert.ok(retained); assert.equal(retained.semanticSubrequest.writeIntent, undefined);
    const changed = structuredClone(retained); changed.inputEvidence.parts[0]!.rawText += 'แก้ยอด';
    assert.equal(await verifyLineAiRetainedTaskSource(changed), undefined);
  }
});

it('R21 workflow navigation follows action permission alternatives and current sold entitlements', async () => {
  const { mayOfferWorkflow, LINE_CHAT_ACTIONS } = await import('./ai-tools.js');
  const features = new Set(['expenses', 'wht_50bis']);
  for (const [id, permissions] of [
    ['expense_submit', ['expense.review']], ['expense_delete', ['expense.delete']],
    ['reimbursement_cancel', ['reimbursement.finance_review']], ['reimbursement_claim', ['reimbursement.create']],
  ] as const) {
    assert.equal(mayOfferWorkflow(id, permissions, features), true, id);
    assert.equal(mayOfferWorkflow(id, permissions, new Set()), false, id);
    assert.equal(mayOfferWorkflow(id, permissions, features, { freeExpenseDrafts: true }), false, id);
  }
  assert.equal(mayOfferWorkflow('approvals', [], features, { assignedApprover: true }), true);
  assert.equal(mayOfferWorkflow('approvals', [], features), false);
  assert.equal(mayOfferWorkflow('wht_certificate', ['wht.certificate.issue'], new Set(['expenses'])), false);
  assert.equal(LINE_CHAT_ACTIONS.filter(action => 'workflow' in action && action.workflow).length, 14);
});
