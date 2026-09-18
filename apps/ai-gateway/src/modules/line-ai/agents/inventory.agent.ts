/**
 * InventoryAgent – reads inventory stock data.
 * Allowlisted tools: inventory.list_low_stock, inventory.get_stock_balance, inventory.summarize_stock_movements.
 */
import type { AgentContext } from './agent-types';
import type { AgentIntentItem, SpecialistOutput, AgentFact, AgentToolCall } from '@watchdog-bms/contracts';
import { LINE_TOOL_REGISTRY } from '@watchdog-bms/contracts';
import type { ErpToolClient } from '../infrastructure/erp-tool.client';

export const ALLOWED_TOOLS = new Set([
  'inventory.search_products',
  'inventory.get_product_detail',
  'inventory.list_low_stock',
  'inventory.get_stock_balance',
  'inventory.summarize_stock_movements',
]);

export const INVENTORY_SYSTEM_PROMPT = `
You are the Inventory Agent for MangmeePlus LINE AI.
Your job is to summarize stock, low-stock risk, and stock movement information from permission-checked tool results only.
Do not invent SKU, quantity, cost, or location values.
Do not adjust stock, create transfers, approve receiving, or mutate inventory records from LINE.
If data is missing, say that the data is unavailable and suggest web review.
Output language must follow the user's input language.
`.trim();

function hasExplicitShape(data: unknown): boolean {
  if (Array.isArray(data)) return true;
  if (!data || typeof data !== 'object') return data !== undefined && data !== null;
  return Object.values(data as Record<string, unknown>).some(hasExplicitShape);
}

export class InventoryAgent {
  constructor(private readonly erpTools: ErpToolClient) {}

  async run(ctx: AgentContext, intentItem: AgentIntentItem, toolBudget: number, toolInput: Record<string, unknown> = {}): Promise<SpecialistOutput> {
    const requested = new Set(intentItem.requiredTools);
    const tools = LINE_TOOL_REGISTRY
      .filter((t) => ALLOWED_TOOLS.has(t.name))
      .filter((t) => requested.size === 0 || requested.has(t.name))
      .slice(0, toolBudget);

    if (tools.length === 0) {
      return stub('UNSUPPORTED', 'ไม่มีเครื่องมือสต็อกที่พร้อมใช้งาน');
    }

    const toolCalls: AgentToolCall[] = [];
    const facts: AgentFact[] = [];
    const toolData: Array<{ tool: string; data: unknown }> = [];
    let asOf: string | undefined;
    let permissionDenied = false;
    let readFailed = false;

    for (const tool of tools) {
      const t0 = Date.now();
      const result = await this.erpTools.invoke(tool, ctx, toolInput);
      const durationMs = Date.now() - t0;
      const callStatus = result.status === 'ok' ? 'ok' : result.status;
      // M-02 G4: the failure code must reach AiToolInvocation.errorCode, not just the status class.
      toolCalls.push({ name: tool.name, status: callStatus, durationMs, ...(result.errorCode ? { errorCode: result.errorCode } : {}) });

      if (result.status === 'forbidden') { permissionDenied = true; continue; }
      if (result.status !== 'ok') { readFailed = true; continue; }
      if (!hasExplicitShape(result.data)) { readFailed = true; continue; }
      toolData.push({ tool: tool.name, data: result.data });
      if (asOf === undefined) asOf = result.asOf;

      const data = result.data as Record<string, unknown>;
      if (data['found'] === false) {
        facts.push({ label: 'สินค้า', value: 'ไม่พบสินค้าที่ระบุ', ...(result.sourceRefs[0] && { sourceRef: result.sourceRefs[0] }) });
      } else if (tool.name === 'inventory.search_products') {
        const explicitItems = Array.isArray(data['items']) ? data['items'] : Array.isArray(data['products']) ? data['products'] : undefined;
        if (typeof data['total'] !== 'number' && !explicitItems) { readFailed = true; toolData.pop(); continue; }
        facts.push({ label: 'สินค้าที่พบ', value: `${String(data['total'] ?? explicitItems!.length)} รายการ` });
      } else if (tool.name === 'inventory.get_product_detail') {
        if (typeof data['name'] !== 'string' && typeof data['sku'] !== 'string') { readFailed = true; toolData.pop(); continue; }
        facts.push({ label: 'สินค้า', value: `${String(data['name'] ?? '')}${data['sku'] ? ` (${String(data['sku'])})` : ''}`, ...(result.sourceRefs[0] && { sourceRef: result.sourceRefs[0] }) });
      } else if (tool.name === 'inventory.list_low_stock') {
        if (typeof data['count'] !== 'number') { readFailed = true; toolData.pop(); continue; }
        // The permission-checked source has to ride the fact: it is what the answer cites and links to,
        // and the compiled low-stock family reads it from here like every other read family.
        facts.push({ label: 'สินค้าใกล้หมด', value: `${data['count']} รายการ`, ...(result.sourceRefs[0] && { sourceRef: result.sourceRefs[0] }) });
      } else if (tool.name === 'inventory.get_stock_balance') {
        if (!Array.isArray(result.data)) { readFailed = true; toolData.pop(); continue; }
        const items = result.data;
        facts.push({ label: 'สต็อกคงเหลือ', value: `${items.length} รายการ` });
      } else if (tool.name === 'inventory.summarize_stock_movements') {
        if (data['inQty'] === undefined || data['outQty'] === undefined) { readFailed = true; toolData.pop(); continue; }
        facts.push({ label: 'รับเข้า', value: String(data['inQty']) }, { label: 'ส่งออก', value: String(data['outQty']) });
      }
    }

    if (permissionDenied && facts.length === 0) {
      return { ...stub('PERMISSION_DENIED', 'ไม่มีสิทธิ์เข้าถึงข้อมูลสต็อก'), toolCalls };
    }
    if (readFailed && facts.length === 0) {
      return { ...stub('FAILED', 'ไม่สามารถดึงข้อมูลสต็อกได้ในขณะนี้'), toolCalls };
    }

    return {
      agent: 'inventory',
      status: facts.length > 0 ? 'SUCCEEDED' : 'FAILED',
      summary: facts.length > 0 ? facts.map((f) => `${f.label}: ${f.value}`).join(', ') : 'ไม่พบข้อมูลสต็อก',
      facts,
      suggestions: [],
      toolCalls,
      requiresHumanReview: false,
      toolData,
      // The tool's as-of was collected above and then dropped, so every inventory answer claimed no
      // as-of state at all. Carried like the other specialists do.
      ...(asOf ? { asOf } : {}),
    };
  }
}

function stub(status: SpecialistOutput['status'], summary: string): SpecialistOutput {
  return { agent: 'inventory', status, summary, facts: [], suggestions: [], toolCalls: [], requiresHumanReview: false };
}
