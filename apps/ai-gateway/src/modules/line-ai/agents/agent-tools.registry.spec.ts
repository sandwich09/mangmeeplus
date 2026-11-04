import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeProductHelpPack, PRODUCT_HELP_PACK, PRODUCT_HELP_DRAFT_PACK, PRODUCT_HELP_V6_PACK } from './approved-product-help';
import { eligibleKnowledgeCards, knowledgeCardHash, knowledgePackHash, renderApprovedKnowledge, validateKnowledgePack, type KnowledgeAccess } from './approved-knowledge';
const access = (): KnowledgeAccess => ({ release: '2.4.0', permissions: [], featureKeys: [], capabilities: [], member: true, now: new Date('2026-10-15T00:00:00Z') });
const rehash = (pack: typeof PRODUCT_HELP_PACK) => { for (const card of pack.cards) card.contentHash = knowledgeCardHash(card); pack.contentHash = knowledgePackHash(pack); return pack; };
/**
 * Registry drift guard: every tool name referenced by an agent ALLOWED_TOOLS set
 * must exist in LINE_TOOL_REGISTRY. If this test fails, a tool was removed from
 * the registry while still being requested by an agent, or a new tool name was
 * added to an agent without a corresponding registry entry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_AGENT_REGISTRY, LINE_TOOL_REGISTRY, hasToolPermissions, TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
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
      if (tool.name === 'public.lookup') {
        // Public admission is intentionally isolated from the ERP intent vocabulary.
        assert.deepEqual(tool.businessSubjects, []);
        assert.deepEqual(tool.questionKinds, []);
        assert.equal(tool.sourceModule, 'public');
        assert.deepEqual(tool.requiredPermissions, ['ai.tool.invoke']);
      } else {
        assert.ok(tool.businessSubjects.length > 0, `${tool.name} needs businessSubjects`);
        assert.ok(tool.questionKinds.length > 0, `${tool.name} needs questionKinds`);
      }
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
      'procurement.get_summary': { subjects: ['procurement'], permissions: ['procurement.purchase_order.read'], optional: ['periodKey', 'fromDate', 'toDate', 'branchId'] },
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

describe('owner-approved v7 product help and previous v6/v4 records', () => {
  it('serves all 69 owner-approved v7 cards and retains the previous approved v6/v4 records', () => {
    validateKnowledgePack(PRODUCT_HELP_DRAFT_PACK);
    assert.equal(PRODUCT_HELP_DRAFT_PACK.version, 7); assert.equal(PRODUCT_HELP_DRAFT_PACK.status, 'APPROVED');
    assert.deepEqual(PRODUCT_HELP_DRAFT_PACK.reviewers, ['owner-review:2026-11-04:chat:ตามแนะนำ', 'owner-review:2026-11-04:Q4:e-WHT']); assert.equal(PRODUCT_HELP_DRAFT_PACK.cards.length, 69);
    assert.equal(PRODUCT_HELP_PACK.cards.length, 12); assert.equal(PRODUCT_HELP_PACK.status, 'APPROVED');
    assert.ok(eligibleKnowledgeCards(PRODUCT_HELP_DRAFT_PACK, { ...access(), permissions: ['expense.disbursement.read', 'wht.certificate.read', 'wht.pnd53.read', 'expense.create'], featureKeys: ['expenses', 'wht_50bis', 'wht_pnd53'] }).some(card => card.id === 'wht.calculation'));
    const root = resolve(__dirname, '../../../../../..');
    for (const card of PRODUCT_HELP_DRAFT_PACK.cards.slice(12)) {
      assert.equal(createHash('sha256').update(readFileSync(resolve(root, card.sourceFile))).digest('hex'), card.sourceHash);
      assert.equal(card.contentHash, knowledgeCardHash(card));
      const [guide, anchor] = card.sourceURL.split('/user-guide/')[1]!.split('#');
      assert.ok(readFileSync(resolve(root, `apps/web/app/(workspace)/companies/[companyId]/user-guide/${guide}/page.tsx`)));
      const source = readFileSync(resolve(root, card.sourceFile), 'utf8');
      assert.ok(card.sourceFile.endsWith('getting-started-guide.content.ts') ? source.includes(`"${anchor}":`) : source.includes(`id: '${anchor}'`), card.id);
    }
  });
  it('filters owner-approved v7 cards by their source permissions and sold features', () => {
    const pack = activeProductHelpPack();
    const all = { ...access(), permissions: ['expense.disbursement.read', 'wht.certificate.read', 'wht.pnd53.read', 'expense.create'], featureKeys: ['expenses', 'wht_50bis', 'wht_pnd53'] };
    assert.deepEqual(eligibleKnowledgeCards(pack, all).filter(c => /^(voucher|wht)\./.test(c.id)).map(c => c.id), ['voucher.meaning', 'wht.certificate-meaning', 'wht.pnd53-due', 'wht.calculation']);
    assert.deepEqual(eligibleKnowledgeCards(pack, { ...all, featureKeys: ['expenses'] }).filter(c => c.id.startsWith('wht.')).map(c => c.id), ['wht.certificate-meaning', 'wht.calculation']);
    assert.equal(eligibleKnowledgeCards(pack, { ...all, permissions: [] }).some(c => c.id.startsWith('wht.')), false);
    assert.match(renderApprovedKnowledge(pack, ['wht.calculation'], all, 'company-A')!.replyText, /จ่ายค่าอะไร/);
  });
  it('LINE-HELP-APPROVE serves reviewed v7 while preserving the previous v6/v4 bytes', () => {
    assert.equal(activeProductHelpPack(), PRODUCT_HELP_DRAFT_PACK);
    assert.equal(PRODUCT_HELP_V6_PACK.contentHash, '0bab85e0afa9cc83d0ab71af7d12f2110f7749f7461532c8c159711c81c008c0');
    assert.equal(PRODUCT_HELP_PACK.contentHash, 'd900b41d31287179551c270635e1333d56432b86627ce7f5b7ad3bfd2571ab14');
    for (const original of PRODUCT_HELP_PACK.cards) {
      const draft = PRODUCT_HELP_V6_PACK.cards.find(card => card.id === original.id)!;
      assert.notEqual(draft.body, original.body); assert.equal(draft.sourceHash, original.sourceHash);
      assert.equal(draft.version, original.version + 1);
    }
    for (const card of PRODUCT_HELP_DRAFT_PACK.cards) assert.ok(card.questions.length >= 4, card.id);
    assert.equal(eligibleKnowledgeCards(PRODUCT_HELP_DRAFT_PACK, { ...access(), permissions: PRODUCT_HELP_DRAFT_PACK.cards.flatMap(c => c.permissionAnyOf),
      featureKeys: null, capabilities: LINE_TOOL_REGISTRY.map(t => t.name) }).length, 69);
    const oversized = structuredClone(PRODUCT_HELP_DRAFT_PACK);
    oversized.cards[0]!.summary = 'ก'.repeat(11000); rehash(oversized);
    assert.throws(() => validateKnowledgePack(oversized), /METADATA_LIMIT/);
    const tooMany = structuredClone(PRODUCT_HELP_DRAFT_PACK);
    tooMany.cards = Array.from({ length: 81 }, () => tooMany.cards[0]!); rehash(tooMany);
    assert.throws(() => validateKnowledgePack(tooMany), /CARD_LIMIT/);
  });
  it('LINE-HELP-ALL-3 uses only one or two warm face emoji or the brand heart within its budgets', () => {
    const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
    const words = new Intl.Segmenter('th', { granularity: 'word' });
    const allowedEmoji = new Set(['😊', '☺️', '🙂', '😄', '😁', '😆', '🥰', '😳', '🤗', '😉', '💚']);
    for (const card of PRODUCT_HELP_DRAFT_PACK.cards) {
      const emoji = [...graphemes.segment(card.body)].filter(part => /\p{Extended_Pictographic}/u.test(part.segment));
      const exactOwnerCopy = ['expense.vat-display', 'expense.export', 'wht.calculation', 'expense.vat-credit'].includes(card.id);
      if (exactOwnerCopy) assert.equal(emoji.length, 0, card.id);
      else assert.ok(emoji.length >= 1 && emoji.length <= 2, card.id);
      for (const part of emoji) assert.ok(allowedEmoji.has(part.segment), `${card.id}: ${part.segment}`);
      if (!exactOwnerCopy) assert.ok(emoji.some(part => part.segment !== '💚'), `${card.id}: a warm face accompanies the answer`);
      assert.match(card.body, /ค่ะ|นะคะ/, card.id);
      assert.doesNotMatch(card.body, /🤖|ครับ|อย่า(?!ง)|ห้าม|การถาม.*ยังไม่ได้|\*\*|```/, card.id);
      assert.ok(Buffer.byteLength(card.body) <= 4096, card.id);
      // Q4's verbatim L-7 and E44 have their own reviewed word bounds.
      const wordLimit = card.id === 'wht.e-wht' ? 99 : card.id === 'wht.calculation' ? 87 : 85;
      assert.ok([...words.segment(card.body)].filter(part => part.isWordLike).length <= wordLimit, card.id);
      assert.ok(card.body.split('\n').length <= 6, card.id);
      for (const name of card.body.matchAll(/“([^”]+)”/gu)) assert.doesNotMatch(name[1]!, /\p{Extended_Pictographic}/u, card.id);
    }
    validateKnowledgePack(PRODUCT_HELP_DRAFT_PACK);
  });
  it('LINE-HELP-ALL-2 pins every named label to its real UI or command source line', () => {
    const root = resolve(__dirname, '../../../../../..');
    const sheet = readFileSync(resolve(root, 'docs/agent-memory/line-help-cards-review-2026-10-20.md'), 'utf8');
    const audit = sheet.split('## ตรวจชื่อปุ่ม/เมนู')[1]!;
    assert.ok(audit);
    const labels = new Set<string>();
    for (const row of audit.split('\n')) {
      const match = row.match(/^\| (.+?) \| .+? \| `([^`]+):(\d+)` \|$/u);
      if (!match) continue;
      const [, label, file, line] = match;
      assert.ok(!labels.has(label!), label); labels.add(label!);
      const source = readFileSync(resolve(root, file!), 'utf8').split('\n')[Number(line) - 1];
      assert.ok(source?.includes(label!), `${label}: ${file}:${line}`);
    }
    for (const card of PRODUCT_HELP_DRAFT_PACK.cards) for (const name of card.body.matchAll(/“([^”]+)”/gu)) {
      if (name[1] === 'ใช้ VAT ตอนยื่นภาษี') {
        assert.ok(readFileSync(resolve(root, 'packages/contracts/src/expenses.ts'), 'utf8').includes(name[1]));
        continue;
      }
      if (name[1] === E_WHT_WORDS['W-F3']) {
        assert.ok(readFileSync(resolve(root, 'packages/contracts/src/tax.ts'), 'utf8').includes(name[1]));
        assert.ok(readFileSync(resolve(root, 'apps/web/src/common/i18n/workspace-dictionary.ts'), 'utf8').includes("'expenses.wht_remittance_bank': E_WHT_WORDS['W-F3']"));
        continue;
      }
      assert.ok(labels.has(name[1]!), `${card.id}: ${name[1]}`);
    }
    assert.ok(labels.has('เปิดร้านใหม่')); // The unchanged public-policy card uses the same LINE door.
  });
  it('LINE-HELP-ALL pins one owner-review row per approved card with its exact answer and guide anchor', () => {
    const root = resolve(__dirname, '../../../../../..');
    const sheet = readFileSync(resolve(root, 'docs/agent-memory/line-help-cards-review-2026-10-20.md'), 'utf8');
    assert.match(sheet, /Status: APPROVED.*2026-10-21/);
    for (const card of PRODUCT_HELP_V6_PACK.cards) {
      const rows = sheet.split('\n').filter(line => line.startsWith(`| ${card.id} |`));
      assert.equal(rows.length, 1, card.id);
      assert.ok(rows[0]!.includes(card.body.replace(/\|/g, '\\|').replace(/\n/g, '<br>')), card.id);
      assert.ok(rows[0]!.includes(card.sourceURL.split('/user-guide/')[1]!), card.id);
      for (const question of card.questions) assert.ok(rows[0]!.includes(question), `${card.id}: ${question}`);
    }
  });
  it('LINE-HELP-ALL gates owner steps, capabilities and system certificates per role and all four packages', () => {
    const pack = activeProductHelpPack();
    const ownerPermissions = [...new Set(pack.cards.flatMap(c => [...c.permissionAnyOf, ...c.requiredPermissions]))];
    for (const [tier, featureKeys] of Object.entries(TIER_FEATURE_PRESETS)) {
      const eligible = eligibleKnowledgeCards(pack, { ...access(), permissions: ownerPermissions, featureKeys: [...featureKeys], capabilities: LINE_TOOL_REGISTRY.map(t => t.name) });
      assert.equal(eligible.some(c => c.id === 'wht.system'), tier === 'ENTERPRISE_1999', tier);
      assert.ok(eligible.some(c => c.id === 'wht.outside'), tier);
      assert.ok(eligible.some(c => c.id === 'home.range'), tier);
    }
    const staff = eligibleKnowledgeCards(pack, { ...access(), permissions: ['line.ai.query', 'expense.receipt.line_upload', 'expense.read_own', 'reimbursement.create'],
      featureKeys: [...TIER_FEATURE_PRESETS.STARTER_249], capabilities: [] }).map(c => c.id);
    assert.ok(staff.includes('shop.staff-open')); assert.ok(staff.includes('line.receipt'));
    for (const id of ['shop.open', 'staff.invite', 'staff.roles', 'package.buy', 'wht.system', 'line.totals', 'claim.create']) assert.ok(!staff.includes(id), id);
    const accountant = eligibleKnowledgeCards(pack, { ...access(), permissions: ['expense.read', 'expense.export', 'wht.external_certificate.link'],
      featureKeys: [...TIER_FEATURE_PRESETS.PRO_999], capabilities: [] }).map(c => c.id);
    assert.ok(accountant.includes('expense.export')); assert.ok(accountant.includes('wht.outside'));
    assert.ok(!accountant.includes('shop.open')); assert.ok(!accountant.includes('wht.system'));
  });
});
