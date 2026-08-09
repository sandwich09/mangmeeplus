/**
 * Registry drift guard: every tool name referenced by an agent ALLOWED_TOOLS set
 * must exist in LINE_TOOL_REGISTRY. If this test fails, a tool was removed from
 * the registry while still being requested by an agent, or a new tool name was
 * added to an agent without a corresponding registry entry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_AGENT_REGISTRY, LINE_TOOL_REGISTRY, hasToolPermissions } from '@watchdog-bms/contracts';
import { AccountingSummaryAgent, ACCOUNTING_SUMMARY_SYSTEM_PROMPT, ALLOWED_TOOLS as ACCOUNTING_TOOLS } from './accounting-summary.agent';
import { InventoryAgent, ALLOWED_TOOLS as INVENTORY_TOOLS } from './inventory.agent';
import { ROUTER_ENABLED_TOOLS } from './intent-router.agent';

const REGISTRY_NAMES = new Set(LINE_TOOL_REGISTRY.map((t) => t.name));

const ALL_AGENT_TOOL_SETS: [string, Set<string>][] = [
  ['AccountingSummaryAgent', ACCOUNTING_TOOLS],
  ['InventoryAgent', INVENTORY_TOOLS],
];

describe('LINE_TOOL_REGISTRY – drift guard', () => {
  it('registry has no duplicate tool names', () => {
    const seen = new Set<string>();
    for (const tool of LINE_TOOL_REGISTRY) {
      assert.equal(seen.has(tool.name), false, `Duplicate tool name in registry: ${tool.name}`);
      seen.add(tool.name);
    }
  });

  it('every tool carries canonical routing metadata', () => {
    for (const tool of LINE_TOOL_REGISTRY) {
      assert.ok(tool.description.trim(), `${tool.name} needs description`);
      assert.ok(tool.businessSubjects.length > 0, `${tool.name} needs businessSubjects`);
      assert.ok(tool.questionKinds.length > 0, `${tool.name} needs questionKinds`);
    }
  });

  it('own-scope tranche-A tools use any-of permission policy', () => {
    for (const name of ['expense.get_detail', 'reimbursement.get_summary', 'reimbursement.get_detail']) {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name)!;
      assert.deepEqual(tool.requiredPermissions, []);
      assert.equal(hasToolPermissions(tool, [name.startsWith('expense.') ? 'expense.read_own' : 'reimbursement.read_own']), true);
      assert.equal(hasToolPermissions(tool, []), false);
    }
  });

  it('accounting tools admit relation-scoped reads but never permissionless calls', () => {
    for (const name of [
      'accounting.get_summary', 'accounting.list_recent_documents',
      'accounting.get_document_detail', 'accounting.get_receivable_summary',
    ]) {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name)!;
      assert.equal(hasToolPermissions(tool, ['accounting.document.read_related']), true, name);
      assert.equal(hasToolPermissions(tool, []), false, name);
    }
  });

  it('tranche-A registry inputs and subjects match the API adapters', () => {
    const expected: Record<string, { subjects: string[]; required?: string[] }> = {
      'inventory.get_product_detail': { subjects: ['product'], required: ['productId'] },
      'accounting.get_document_detail': { subjects: ['accounting_document'], required: ['documentId'] },
      'accounting.get_receivable_summary': { subjects: ['accounting_document', 'payment'] },
      'expense.get_detail': { subjects: ['expense'], required: ['expenseId'] },
      'reimbursement.get_summary': { subjects: ['reimbursement'] },
      'reimbursement.get_detail': { subjects: ['reimbursement'], required: ['reimbursementId'] },
    };
    for (const [name, metadata] of Object.entries(expected)) {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name);
      assert.deepEqual(tool?.businessSubjects, metadata.subjects, name);
      assert.deepEqual(tool?.requiredInputFields, metadata.required, name);
      assert.ok(ROUTER_ENABLED_TOOLS.has(name), `${name} not router-enabled`);
    }
  });

  it('specialists emit grounded tranche-A detail and summary facts', async () => {
    const sourceRef = { label: 'source', module: 'test', entityType: 'test', permissionChecked: true as const };
    const inventory = new InventoryAgent({ invoke: async (tool: { name: string }) => ({
      toolName: tool.name, status: 'ok' as const, data: { name: 'สินค้า A', sku: 'SKU-A' }, sourceRefs: [sourceRef], asOf: '2026-07-15T00:00:00Z',
    }) } as any);
    const product = await inventory.run(
      { companyId: 'c1', userId: 'u1', permissions: ['inventory.product.read'], locale: 'th-TH' },
      { intent: 'read_detail', subject: 'product', agent: 'inventory', priority: 1, requiredTools: ['inventory.get_product_detail'], missingContext: [] }, 1,
    );
    assert.equal(product.status, 'SUCCEEDED');
    assert.match(product.summary, /สินค้า A/);

    const accounting = new AccountingSummaryAgent({ invoke: async (tool: { name: string }) => ({
      toolName: tool.name, status: 'ok' as const, data: { openCount: 3, totalsByCurrency: [{ currency: 'THB', outstandingAmount: '100.00' }] }, sourceRefs: [sourceRef], asOf: '2026-07-15T00:00:00Z',
    }) } as any);
    const receivable = await accounting.run(
      { companyId: 'c1', userId: 'u1', permissions: ['accounting.document.read'], locale: 'th-TH' },
      { intent: 'read_summary', subject: 'payment', agent: 'accounting', priority: 1, requiredTools: ['accounting.get_receivable_summary'], missingContext: [] }, 1,
    );
    assert.equal(receivable.status, 'SUCCEEDED');
    assert.match(receivable.summary, /openCount: 3/);
  });

  it('every tool advertised by the Tax Agent exists and supports tax', () => {
    const tax = LINE_AI_AGENT_REGISTRY.find((agent) => agent.agent === 'tax');
    for (const name of tax?.toolNames ?? []) {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name);
      assert.ok(tool, `tax advertises unknown tool: ${name}`);
      assert.ok(tool!.supportedAgents.includes('tax'), `${name} does not support advertised agent tax`);
    }
  });

  it('Tax Agent is limited-ready and advertises the item-11B read contracts', () => {
    const tax = LINE_AI_AGENT_REGISTRY.find((agent) => agent.agent === 'tax');
    assert.equal(tax?.status, 'limited');
    for (const name of ['tax.get_tax_code_profile', 'tax.get_transaction_tax_summary', 'tax.get_reconciliation_summary']) {
      assert.ok(tax?.toolNames.includes(name), `Tax Agent must advertise ${name}`);
    }
  });

  it('Tax Agent guidance forbids profileless SAP Tax Code assumptions', () => {
    assert.match(ACCOUNTING_SUMMARY_SYSTEM_PROMPT, /Never infer O1/);
    assert.match(ACCOUNTING_SUMMARY_SYSTEM_PROMPT, /legacy SAP ERP O1 and current S\/4HANA O1 can mean different rates/);
  });

  it('Phase 4 CRM tools are registered, enabled, specialist-reachable, and advertised without new agents', () => {
    const names = [
      'crm.get_report_summary', 'crm.get_pipeline_summary', 'crm.list_open_followups',
      'crm.get_booking_summary', 'crm.list_bookings', 'crm.get_inbox_summary',
      'crm.list_conversations', 'crm.get_conversation_summary',
    ];
    const crm = LINE_AI_AGENT_REGISTRY.find((agent) => agent.agent === 'crm');
    const sales = LINE_AI_AGENT_REGISTRY.find((agent) => agent.agent === 'sales');
    for (const name of names) {
      assert.ok(REGISTRY_NAMES.has(name), `${name} missing from registry`);
      assert.ok(ROUTER_ENABLED_TOOLS.has(name), `${name} not enabled`);
      assert.ok(ACCOUNTING_TOOLS.has(name), `${name} not reachable through shared CRM/sales specialist`);
      assert.ok(crm?.toolNames.includes(name), `CRM Agent does not advertise ${name}`);
      assert.ok(sales?.toolNames.includes(name), `Sales Agent does not advertise ${name}`);
    }
  });

  it('Phase 4 CRM registry inputs and ERP permissions match the API adapters', () => {
    const expected: Record<string, { permissions: string[]; required?: string[]; optional?: string[] }> = {
      'crm.get_report_summary': { permissions: ['crm.report.read'], optional: ['branchId', 'period'] },
      'crm.get_pipeline_summary': { permissions: ['crm.opportunity.read'], optional: ['assignedToMe'] },
      'crm.list_open_followups': { permissions: ['crm.follow_up.read'], optional: ['view', 'customerId', 'opportunityId', 'assignedToMe', 'limit'] },
      'crm.get_booking_summary': { permissions: ['crm.booking.read'], optional: ['weekStart', 'branchId'] },
      'crm.list_bookings': { permissions: ['crm.booking.read'], optional: ['weekStart', 'branchId', 'limit'] },
      'crm.get_inbox_summary': { permissions: ['crm.inbox.read'] },
      'crm.list_conversations': { permissions: ['crm.inbox.read'], optional: ['status', 'search', 'overdue', 'assignee', 'customerId', 'limit'] },
      'crm.get_conversation_summary': { permissions: ['crm.inbox.read'], required: ['conversationId'] },
    };
    for (const [name, metadata] of Object.entries(expected)) {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name);
      assert.deepEqual(tool?.requiredPermissions, metadata.permissions, `${name} permission mismatch`);
      assert.deepEqual(tool?.requiredInputFields, metadata.required, `${name} required inputs mismatch`);
      assert.deepEqual(tool?.optionalInputFields, metadata.optional, `${name} optional inputs mismatch`);
    }
  });

  it('CRM source modules match the authoritative adapter SourceRefs', () => {
    const expected: Record<string, string> = {
      'crm.get_customer_summary': 'crm',
      'crm.search_customers': 'crm',
      'crm.get_customer_360': 'crm',
      'crm.get_report_summary': 'crm-inbox',
      'crm.get_pipeline_summary': 'crm',
      'crm.list_open_followups': 'crm',
      'crm.get_booking_summary': 'crm',
      'crm.list_bookings': 'crm',
      'crm.get_inbox_summary': 'crm-inbox',
      'crm.list_conversations': 'crm-inbox',
      'crm.get_conversation_summary': 'crm-inbox',
    };
    for (const [name, sourceModule] of Object.entries(expected)) {
      assert.equal(LINE_TOOL_REGISTRY.find((tool) => tool.name === name)?.sourceModule, sourceModule, name);
    }
  });

  it('Phase 5 procurement and ledger tools have exact subjects, permissions, inputs, and reachability', () => {
    const expected: Record<string, { subjects: string[]; permissions: string[]; required?: string[]; optional?: string[] }> = {
      'procurement.get_summary': { subjects: ['procurement'], permissions: ['procurement.purchase_order.read'], optional: ['fromDate', 'toDate', 'branchId'] },
      'procurement.search_suppliers': { subjects: ['supplier'], permissions: ['procurement.supplier.read'], optional: ['search', 'status', 'supplierType', 'page', 'limit'] },
      'procurement.get_purchase_order_detail': { subjects: ['procurement'], permissions: [], required: ['purchaseOrderId'] },
      'ledger.get_period_status': { subjects: ['ledger'], permissions: ['ledger.period.read'], required: ['periodKey'] },
      'ledger.get_report_summary': { subjects: ['ledger'], permissions: ['ledger.report.read', 'ledger.period.read'], required: ['periodKey'], optional: ['reportType'] },
    };
    for (const [name, metadata] of Object.entries(expected)) {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name)!;
      assert.deepEqual(tool.businessSubjects, metadata.subjects, `${name} subjects`);
      assert.deepEqual(tool.requiredPermissions, metadata.permissions, `${name} permissions`);
      assert.deepEqual(tool.requiredInputFields, metadata.required, `${name} required inputs`);
      assert.deepEqual(tool.optionalInputFields, metadata.optional, `${name} optional inputs`);
      assert.ok(ROUTER_ENABLED_TOOLS.has(name), `${name} not enabled`);
      assert.ok(ACCOUNTING_TOOLS.has(name), `${name} not specialist-reachable`);
      for (const agent of ['accounting', 'cfo', 'general'] as const) {
        assert.ok(LINE_AI_AGENT_REGISTRY.find((entry) => entry.agent === agent)?.toolNames.includes(name), `${agent} does not advertise ${name}`);
      }
    }
    const ledgerReport = LINE_TOOL_REGISTRY.find((tool) => tool.name === 'ledger.get_report_summary')!;
    const purchaseOrderDetail = LINE_TOOL_REGISTRY.find((tool) => tool.name === 'procurement.get_purchase_order_detail')!;
    assert.deepEqual(purchaseOrderDetail.anyOfPermissions, ['procurement.purchase_order.read', 'procurement.purchase_order.read_related']);
    assert.equal(hasToolPermissions(ledgerReport, ['ledger.report.read']), false);
    assert.equal(hasToolPermissions(ledgerReport, ['ledger.period.read']), false);
    assert.equal(hasToolPermissions(ledgerReport, ['ledger.report.read', 'ledger.period.read']), true);
  });

  it('accounting specialist shapes honest procurement and ledger answers with source evidence', async () => {
    const sourceRef = { label: 'source', module: 'test', entityType: 'summary', permissionChecked: true as const };
    const responses: Record<string, Record<string, unknown>> = {
      'procurement.get_summary': { total: 8, monetarySummaryAvailable: false },
      'ledger.get_report_summary': {
        periodKey: '2026-07', currency: null,
        profitAndLoss: { revenue: '100.0000', netProfit: '25.0000' },
      },
    };
    const agent = new AccountingSummaryAgent({ invoke: async (tool: { name: string }) => ({
      toolName: tool.name, status: 'ok' as const, data: responses[tool.name], sourceRefs: [sourceRef], asOf: '2026-07-15T00:00:00Z',
    }) } as any);
    const procurement = await agent.run(
      { companyId: 'c1', userId: 'u1', permissions: ['procurement.purchase_order.read'], locale: 'th-TH' },
      { intent: 'read_summary', subject: 'procurement', agent: 'accounting', priority: 1, requiredTools: ['procurement.get_summary'], missingContext: [] }, 1,
    );
    assert.match(procurement.summary, /8 รายการ/);
    assert.match(procurement.summary, /ไม่มีผลรวมยอดเงินแบบแยกสกุลเงิน/);
    assert.equal(procurement.facts.filter((fact) => fact.sourceRef).length, 1);

    const ledger = await agent.run(
      { companyId: 'c1', userId: 'u1', permissions: ['ledger.report.read', 'ledger.period.read'], locale: 'th-TH' },
      { intent: 'report_request', subject: 'ledger', agent: 'cfo', priority: 1, requiredTools: ['ledger.get_report_summary'], missingContext: [] }, 1,
    );
    assert.match(ledger.summary, /กำไรสุทธิ 25\.0000/);
    assert.match(ledger.summary, /ไม่ได้ระบุสกุลเงิน/);
    assert.doesNotMatch(ledger.summary, /บาท/);
  });

  it('shared CRM specialist emits grounded summary facts for Phase 4 tool results', async () => {
    const sourceRef = { label: 'สรุป Pipeline', module: 'crm', entityType: 'pipeline_summary', permissionChecked: true as const };
    const agent = new AccountingSummaryAgent({
      invoke: async (tool: { name: string }) => ({
        toolName: tool.name, status: 'ok' as const,
        data: { openCount: 4, totalPipelineAmount: '12000.0000' },
        sourceRefs: [sourceRef], asOf: '2026-07-15T00:00:00.000Z',
      }),
    } as any);
    const output = await agent.run(
      { companyId: 'c1', userId: 'u1', permissions: ['crm.opportunity.read'], locale: 'th-TH' },
      { intent: 'read_summary', subject: 'opportunity', agent: 'crm', priority: 1, requiredTools: ['crm.get_pipeline_summary'], missingContext: [] },
      1,
    );
    assert.equal(output.status, 'SUCCEEDED');
    assert.match(output.summary, /openCount: 4/);
    assert.deepEqual(output.facts[0]?.sourceRef, sourceRef);
    assert.deepEqual(output.toolCalls.map((call) => call.name), ['crm.get_pipeline_summary']);
  });

  it('accounting specialist preserves one permission-checked source reference per tool result', async () => {
    const sourceRef = {
      label: 'งวดภาษี 2026-07', module: 'tax', entityType: 'tax_period', entityId: 'period-1',
      permissionChecked: true as const, webPath: '/companies/c1/tax',
    };
    const agent = new AccountingSummaryAgent({
      invoke: async (tool: { name: string }) => ({
        toolName: tool.name, status: 'ok' as const, data: { count: 1 }, sourceRefs: [sourceRef], asOf: '2026-07-14T00:00:00.000Z',
      }),
    } as any);

    const out = await agent.run(
      { companyId: 'c1', userId: 'u1', permissions: ['tax.period.read', 'tax.event.read'], locale: 'th-TH' },
      { intent: 'read_summary', subject: 'tax', agent: 'tax', priority: 1, requiredTools: ['tax.get_vat_summary'], missingContext: [] },
      1,
    );

    assert.deepEqual(out.facts[0]?.sourceRef, sourceRef);
    assert.equal(out.facts.filter((fact) => fact.sourceRef).length, 1);
  });

  it('accounting specialist propagates item-11B ambiguity as human review required', async () => {
    const agent = new AccountingSummaryAgent({
      invoke: async (tool: { name: string }) => ({
        toolName: tool.name,
        status: 'ok' as const,
        data: { reviewRequired: true, reasonCode: 'AMBIGUOUS_ACTIVE_PROFILE', message: 'พบหลาย profile' },
        sourceRefs: [],
        asOf: '2026-07-14T00:00:00.000Z',
      }),
    } as any);

    const out = await agent.run(
      { companyId: 'c1', userId: 'u1', permissions: ['tax.profile.read', 'tax.config.read'], locale: 'th-TH' },
      { intent: 'read_detail', subject: 'tax', agent: 'tax', priority: 1, requiredTools: ['tax.get_tax_code_profile'], missingContext: [] },
      1,
    );

    assert.equal(out.requiresHumanReview, true);
    assert.match(out.summary, /พบหลาย profile/);
  });

  for (const [agentName, tools] of ALL_AGENT_TOOL_SETS) {
    for (const name of tools) {
      it(`${agentName} ALLOWED_TOOL "${name}" exists in LINE_TOOL_REGISTRY`, () => {
        assert.ok(
          REGISTRY_NAMES.has(name),
          `Tool "${name}" in ${agentName}.ALLOWED_TOOLS is not in LINE_TOOL_REGISTRY`,
        );
      });
    }
  }

  it('every registry tool has at least one all-of or any-of permission', () => {
    for (const tool of LINE_TOOL_REGISTRY) {
      assert.ok(
        tool.requiredPermissions.length > 0 || (tool.anyOfPermissions?.length ?? 0) > 0,
        `Tool "${tool.name}" has no permission policy`,
      );
    }
  });

  it('every registry tool requires ERP permission check', () => {
    for (const tool of LINE_TOOL_REGISTRY) {
      assert.equal(
        tool.requiresErpPermissionCheck,
        true,
        `Tool "${tool.name}" has requiresErpPermissionCheck=false`,
      );
    }
  });

  it('tools with requiredInputFields list at least one field', () => {
    for (const tool of LINE_TOOL_REGISTRY) {
      if (tool.requiredInputFields !== undefined) {
        assert.ok(
          tool.requiredInputFields.length > 0,
          `Tool "${tool.name}" has empty requiredInputFields array`,
        );
      }
    }
  });
});
