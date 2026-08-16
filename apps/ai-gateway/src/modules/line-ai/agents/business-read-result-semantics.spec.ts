import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';
import { AccountingSummaryAgent, ALLOWED_TOOLS as ACCOUNTING_TOOLS } from './accounting-summary.agent';
import { InventoryAgent, ALLOWED_TOOLS as INVENTORY_TOOLS } from './inventory.agent';
import { ResponseComposerAgent } from './response-composer.agent';

const ctx = { companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' };
const READ_CATEGORIES = new Set(['read_summary', 'read_detail', 'report']);
const readTools = LINE_TOOL_REGISTRY.filter((tool) => READ_CATEGORIES.has(tool.category) && (ACCOUNTING_TOOLS.has(tool.name) || INVENTORY_TOOLS.has(tool.name)));
const detailWithoutEmptySuccess = new Set(['company.get_current_context']);

function emptyData(name: string): unknown {
  switch (name) {
    case 'inventory.get_product_detail':
    case 'accounting.get_document_detail':
    case 'expense.get_detail':
    case 'reimbursement.get_detail':
    case 'crm.get_customer_360':
    case 'crm.get_conversation_summary':
    case 'procurement.get_purchase_order_detail':
    case 'ledger.get_period_status': return { found: false };
    case 'workflow.explain_run': return { found: false };
    case 'inventory.search_products': return { total: 0, items: [] };
    case 'inventory.list_low_stock': return { count: 0, items: [] };
    case 'inventory.get_stock_balance': return [];
    case 'inventory.summarize_stock_movements': return { total: 0, inQty: 0, outQty: 0 };
    case 'company.list_branches': return { total: 0, branches: [] };
    case 'notifications.get_daily_summary': return 0;
    case 'ledger.get_financial_summary': return { netProfit: '0', totalAssets: '0' };
    case 'ledger.get_report_summary': return { currency: null, profitAndLoss: { revenue: '0', netProfit: '0' } };
    case 'expense.list_recent': return { total: 0, summary: { totalAmount: 0, pendingAmount: 0, draftAmount: 0, confirmedAmount: 0, paidAmount: 0, unpaidAmount: 0 }, items: [] };
    case 'expense.get_breakdown': return { totalCount: 0, totalAmount: '0', byCategory: [], byBranch: [] };
    case 'expense.get_daily_closing': return {
      date: '2026-08-16', timezone: 'Asia/Bangkok', scope: { kind: 'all_branches' },
      occurredToday: { totals: [], paid: [], outstanding: [], items: { total: 0, shown: 0, remaining: 0, items: [] } },
      submittedToday: { count: 0 },
      dueEndOfDay: { totals: [], items: { total: 0, shown: 0, remaining: 0, items: [] } },
      overdue: { totals: [], items: { total: 0, shown: 0, remaining: 0, items: [] } },
      unscheduledOutstanding: { totals: [], items: { total: 0, shown: 0, remaining: 0, items: [] } },
      pendingReview: { count: 0, items: { total: 0, shown: 0, remaining: 0, items: [] } },
      evidenceBlockers: { count: 0, items: { total: 0, shown: 0, remaining: 0, items: [] } },
      duplicateRisks: { count: 0, items: { total: 0, shown: 0, remaining: 0, items: [] } },
      excluded: { rejected: 0, voided: 0 }, limitations: { neverSubmittedDocumentsObservable: false },
    };
    case 'sales.get_sales_summary': return { totalSales: '0', transactionCount: 0, totalsByCurrency: [] };
    case 'procurement.get_summary': return { total: 0, monetarySummaryAvailable: false };
    case 'procurement.search_suppliers': return { total: 0, items: [] };
    case 'company.get_employee_detail': return { matches: 0, candidates: [] };
    case 'dashboard.get_business_health_summary': return { widgets: [] };
    default: return { total: 0, items: [] };
  }
}

function specialist(name: string, result: Record<string, unknown>) {
  const client = { invoke: async () => ({ toolName: name, sourceRefs: [], asOf: '2026-07-15T00:00:00Z', ...result }) } as any;
  return INVENTORY_TOOLS.has(name) ? new InventoryAgent(client) : new AccountingSummaryAgent(client);
}

function intent(name: string) {
  const meta = LINE_TOOL_REGISTRY.find((tool) => tool.name === name)!;
  return { intent: 'read_summary', subject: meta.businessSubjects[0], agent: INVENTORY_TOOLS.has(name) ? 'inventory' : 'accounting', priority: 1, requiredTools: [name], missingContext: [] } as any;
}

describe('business-read result semantics', () => {
  it('classifies every specialist-reachable read tool as empty-capable or detail/not-found', () => {
    const names = new Set(readTools.map((tool) => tool.name));
    for (const name of detailWithoutEmptySuccess) assert.ok(names.has(name), name);
    assert.equal(readTools.length > detailWithoutEmptySuccess.size, true);
  });

  for (const tool of readTools.filter((entry) => !detailWithoutEmptySuccess.has(entry.name))) {
    it(`${tool.name}: ok plus explicit zero/empty remains a successful answer`, async () => {
      const output = await specialist(tool.name, { status: 'ok', data: emptyData(tool.name) }).run(ctx, intent(tool.name), 1);
      assert.equal(output.status, 'SUCCEEDED');
      assert.ok(output.facts.length > 0);
      assert.match(output.summary, /0|ไม่มี|ยังไม่มี|ไม่พบ/);
      assert.equal(output.toolData?.length, 1);
    });
  }

  for (const tool of readTools) {
    it(`${tool.name}: ok plus structurally empty object never fabricates zero or dash`, async () => {
      const output = await specialist(tool.name, { status: 'ok', data: {} }).run(ctx, intent(tool.name), 1);
      assert.equal(output.status, 'FAILED');
      assert.deepEqual(output.facts, []);
      assert.equal(output.toolData, undefined);
      assert.doesNotMatch(output.summary, /0|-/);
    });

    it(`${tool.name}: forbidden remains permission denied`, async () => {
      const output = await specialist(tool.name, { status: 'forbidden' }).run(ctx, intent(tool.name), 1);
      assert.equal(output.status, 'PERMISSION_DENIED');
      assert.deepEqual(output.facts, []);
    });
  }

  it('unavailable/error are failed reads, not successful empty results', async () => {
    for (const [name, status] of [['accounting.get_summary', 'unavailable'], ['inventory.list_low_stock', 'error']] as const) {
      const output = await specialist(name, { status }).run(ctx, intent(name), 1);
      assert.equal(output.status, 'FAILED');
      assert.deepEqual(output.facts, []);
      assert.equal(output.toolData, undefined);
    }
  });

  it('annotates explicit empty model data and deterministically rejects an unavailable rewrite', async () => {
    let payload: any;
    const fallback = '• สินค้าที่พบ: 0 รายการ';
    const answer = await new ResponseComposerAgent().composeAnswer(
      'มีสินค้ากี่รายการ',
      [
        { tool: 'inventory.search_products', data: { total: 0, items: [] } },
        { tool: 'company.list_branches', data: { total: 2, branches: [{ name: 'A' }, { name: 'B' }] } },
      ],
      fallback,
      { generateText: async ({ messages }) => {
        payload = JSON.parse(messages[0]!.text);
        return { ok: true as const, text: 'ไม่สามารถดึงข้อมูลได้' };
      } },
    );
    assert.equal(payload.systemData[0].state, 'empty');
    assert.equal(payload.systemData[1].state, 'data');
    assert.equal(answer, fallback);
  });
});
